#!/bin/bash
# Deploy, update or remove the feedback Lambda function on AWS (us-east-1,
# the default profile unless AWS_PROFILE is set). Run it only with the
# user's approval; nothing else runs it.
#
#   bash feedback_api/deploy.sh                    build the zip, deploy the stack, put the code in, check
#   bash feedback_api/deploy.sh --until 2027-03-31 the same, and feedback ends after that day (US Eastern)
#                                                  (a day already past, or over a year away, is
#                                                  refused as a likely typo; --force-date takes it)
#   bash feedback_api/deploy.sh --turn-off         POST /feedback answers 503 until --turn-on
#   bash feedback_api/deploy.sh --turn-on          take feedback again; also sets the concurrency back
#   bash feedback_api/deploy.sh --remove           delete the stack to stop its costs; keeps the bucket
#   EXTRA_PARAMS="RateLimitOn=false LocalOrigins=none" bash feedback_api/deploy.sh
#                                                  other stack settings (see template.yml)
#   FEEDBACK_DEPLOY_CHECK_ONLY=1 bash feedback_api/deploy.sh
#                                                  steps 0 to 2 only (the checks and the bucket
#                                                  name), then stops before building or changing
#                                                  anything; test.py runs it with a stand-in aws tool
#
# Feedback is temporary. A first deploy sets the end date to 60 days later
# (the user's choice) unless --until gives another; later deploys keep it
# unless --until is given again. After it, POST answers 410 ("Feedback has
# ended. Thank you for your help.") and GET /health says so, which hides the
# Feedback switch on the published site. --until also works with
# --turn-on and --turn-off.
#
# --remove deletes the function, CloudFront, the rate limit and the counter
# table, so nothing is left that costs money, but keeps the bucket and every
# piece of feedback in it (template.yml retains it). The bucket's name is
# added to feedback_api/.bucket first, when the bucket is really there (a
# first deploy that failed took its bucket with it). That file lists every
# bucket that still holds feedback, oldest first, and the local inbox
# (local_server.py) reads them all. It asks before deleting; --yes skips the
# question.
#
# Safe to run again: a re-run updates the stack in place and leaves feedback
# on or off, the end date and every EXTRA_PARAMS setting as they were. What
# a deploy does:
#   0. checks the stack's state. A first deploy that failed and rolled back
#      is deleted so it can be made again; a stack that is busy or broken
#      stops the script with a sentence saying so;
#   1. stack_input.py reads the testers' code (FEEDBACK_SITE_CODE) from the
#      viewer's .env.development.local the way Vite reads it, and writes the
#      salt and the salted SHA-256 hash into a file only you can read, which
#      the aws tool reads with --cli-input-json. Neither is ever on a
#      command line. The salt is kept in feedback_api/.deploy_salt
#      (gitignored) and used again, so a redeploy keeps the daily caps and
#      lockouts going. The inbox code (VITE_FEEDBACK_ADMIN_CODE) never goes
#      to AWS: the inbox reads the bucket with your own AWS login through
#      local_server.py;
#   2. reads the certificate and the nemac.org hosted zone from the existing
#      stack road-network-connectivity (CERT_ARN and HOSTED_ZONE_ID override
#      them). Before a first deploy it checks that the certificate is issued
#      and covers feedbackconnectivityviewer.nemac.org (the *.nemac.org one
#      does), that the account has room for the reserved concurrency, and
#      that the bucket name is free. After a --remove the old bucket is
#      still there, so a new one gets the date added to its name, and a
#      counter too if that name is taken as well (a second remove and
#      redeploy on the same day). Every bucket listed in .bucket counts as
#      taken, whatever AWS says;
#   3. builds build/feedback_lambda.zip (two Python files, no libraries);
#   4. deploys template.yml as the stack road-network-feedback. A first
#      deploy is made with feedback turned off. The stack makes the DNS
#      records for the name itself, so none has to be added by hand;
#   5. puts the zip into the function (update-function-code) and waits;
#   6. on a first deploy, turns feedback on (the template as deployed, only
#      ServiceOn changed);
#   7. adds the bucket's name to feedback_api/.bucket, and checks GET
#      /health from the site's origin (200) and from another website (403,
#      refused at CloudFront).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIEWER="$(cd "$HERE/.." && pwd)"
ENVF="${ENV_FILE:-$VIEWER/.env.development.local}"
REGION=us-east-1
export AWS_DEFAULT_REGION="$REGION"
export AWS_PROFILE="${AWS_PROFILE:-default}"
STACK="${STACK:-road-network-feedback}"
SITE_STACK="${SITE_STACK:-road-network-connectivity}"
DOMAIN=feedbackconnectivityviewer.nemac.org
SITE_ORIGIN=https://road-network-connectivity.nemac.org
DEFAULT_BUCKET=nemac-road-network-feedback
# every bucket that holds feedback, oldest first; test.py points it elsewhere
BUCKET_FILE="${FEEDBACK_BUCKET_FILE:-$HERE/.bucket}"
ZIP="$HERE/build/feedback_lambda.zip"

SWITCH=""
UNTIL=""
FORCE_DATE=0
REMOVE=0
YES=0
while [ $# -gt 0 ]; do
    case "$1" in
        --turn-off) SWITCH=false ;;
        --turn-on) SWITCH=true ;;
        --until) [ $# -ge 2 ] || { echo "--until needs a date, such as 2027-03-31." >&2; exit 2; }
                 UNTIL="$2"; shift ;;
        --until=*) UNTIL="${1#--until=}" ;;
        --force-date) FORCE_DATE=1 ;;
        --remove) REMOVE=1 ;;
        --yes) YES=1 ;;
        # the comment block at the top, however long it grows
        -h|--help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
        *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done
if [ "$REMOVE" = 1 ] && { [ -n "$SWITCH" ] || [ -n "$UNTIL" ]; }; then
    echo "--remove goes on its own." >&2; exit 2
fi
if [ "${FEEDBACK_DEPLOY_CHECK_ONLY:-}" = 1 ] && { [ "$REMOVE" = 1 ] || [ -n "$SWITCH" ]; }; then
    # those change the stack before any check, so a check-only run of them would not be one
    echo "FEEDBACK_DEPLOY_CHECK_ONLY=1 goes with a plain deploy only." >&2; exit 2
fi
if [ "$FORCE_DATE" = 1 ] && [ -z "$UNTIL" ]; then
    echo "--force-date goes with --until." >&2; exit 2
fi
if [ -n "$UNTIL" ]; then
    FD=()
    [ "$FORCE_DATE" = 1 ] && FD=(--force-date)
    UNTIL="$(python3 "$HERE/stack_input.py" --end-date "$UNTIL" ${FD[@]+"${FD[@]}"})" || exit 2
fi

# Files that hold the salt and hash on their way to the aws tool, readable
# by you only, and gone when the script ends however it ends.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/feedback_deploy.XXXXXX")"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n== %s\n' "$*"; }

stack_status() {
    aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo NONE
}
stack_param() {
    aws cloudformation describe-stacks --stack-name "$1" \
        --query "Stacks[0].Parameters[?ParameterKey=='$2'].ParameterValue" --output text
}
stack_output() {
    aws cloudformation describe-stacks --stack-name "$STACK" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
# the stack as it is now, for stack_input.py to keep every setting not changed
save_current() {
    aws cloudformation describe-stacks --stack-name "$STACK" --output json > "$TMP/current.json"
}

# create-stack or update-stack with the input stack_input.py wrote, then
# wait. An update that changes nothing is not an error.
apply_stack() {
    local verb="$1" err
    if ! err="$(aws cloudformation "$verb-stack" --cli-input-json "file://$TMP/input.json" --output text 2>&1 >/dev/null)"; then
        case "$err" in
            *"No updates are to be performed"*) echo "Nothing to change in the stack."; return 0 ;;
            *) echo "$err" >&2; return 1 ;;
        esac
    fi
    echo "Waiting for CloudFormation ..."
    aws cloudformation wait "stack-$verb-complete" --stack-name "$STACK"
}

health() {
    local url out ok=0
    url="$(stack_output ApiUrl)"
    say "Health check of $url"
    for _ in 1 2 3 4 5 6; do
        if out="$(curl -sS --max-time 20 -H "Origin: $SITE_ORIGIN" -w ' (HTTP %{http_code})' "$url/health")"; then
            echo "From the site:        $out"
            case "$out" in *"(HTTP 200)") ok=1; break ;; esac
        fi
        sleep 10
    done
    [ "$ok" = 1 ] || echo "$url/health did not answer 200 yet. A new name can take a few minutes; try again later."
    out="$(curl -sS --max-time 20 -o /dev/null -H "Origin: https://example.com" -w '%{http_code}' "$url/health" || true)"
    echo "From another website: HTTP $out (want 403)"
}

service_state() {
    local ends
    case "$(stack_param "$STACK" ServiceOn)" in
        false) echo "Feedback is turned off (POST answers 503). Turn it on with: bash feedback_api/deploy.sh --turn-on" ;;
        *) echo "Feedback is turned on." ;;
    esac
    ends="$(stack_param "$STACK" EndsOn)"
    if [ -z "$ends" ] || [ "$ends" = None ]; then
        echo "No end date is set. Set one with: bash feedback_api/deploy.sh --until YYYY-MM-DD"
    elif [[ "$ends" < "$(TZ=America/New_York date +%Y-%m-%d)" ]]; then   # YYYY-MM-DD sorts as dates do
        echo "Feedback ended after $ends (US Eastern): POST answers 410. Move the date with --until, or remove the stack with --remove."
    else
        echo "Feedback ends after $ends (US Eastern). Change it with --until YYYY-MM-DD."
    fi
}

restore_concurrency() {
    local fn n
    fn="$(stack_output FunctionName)"
    n="$(stack_param "$STACK" Concurrency)"
    aws lambda put-function-concurrency --function-name "$fn" --reserved-concurrent-executions "$n" >/dev/null
    echo "$fn: up to $n at once"
}

# Adds a bucket to feedback_api/.bucket as the newest, keeping every name
# already there: each holds feedback that the local inbox still reads.
keep_bucket() {
    python3 "$HERE/stack_input.py" --keep-bucket "$1" --bucket-file "$BUCKET_FILE"
    echo "Bucket: $1 (listed in feedback_api/.bucket for the local inbox)"
}
remember_bucket() {
    local b
    b="$(stack_output BucketName)"
    if [ -n "$b" ] && [ "$b" != None ]; then keep_bucket "$b"; fi
}

# ---------------------------------------------------------------- 0. the stack's state
STATUS="$(stack_status)"
FIRST=0

# ---------------------------------------------------------------- remove
if [ "$REMOVE" = 1 ]; then
    case "$STATUS" in
        NONE) echo "There is no stack $STACK to remove." >&2; exit 1 ;;
        *_IN_PROGRESS) echo "The stack $STACK is busy ($STATUS). Wait for it to finish, then run this again." >&2; exit 1 ;;
    esac
    BUCKET="$(stack_output BucketName 2>/dev/null || true)"
    [ -n "$BUCKET" ] && [ "$BUCKET" != None ] || BUCKET="$(stack_param "$STACK" BucketName 2>/dev/null || true)"
    [ "$BUCKET" != None ] || BUCKET=""
    # Left off the list only when it is known to be gone: after a first create
    # that failed (ROLLBACK_COMPLETE), where RetainExceptOnCreate has already
    # deleted it, or when AWS says 404. Any other answer (a login with fewer
    # rights, throttling, no network) leaves it listed: the stack is about to
    # be deleted, and an unlisted bucket's feedback would be found by nothing,
    # while a listed one that cannot be read is only named and passed over by
    # the inbox.
    if [ -n "$BUCKET" ] && [ "$STATUS" = ROLLBACK_COMPLETE ]; then
        echo "The bucket $BUCKET went with the first deploy that failed, so it is not listed in feedback_api/.bucket."
        BUCKET=""
    elif [ -n "$BUCKET" ]; then
        if HB="$(aws s3api head-bucket --bucket "$BUCKET" 2>&1)"; then
            keep_bucket "$BUCKET"
        elif [[ "$HB" == *"(404)"* || "$HB" == *"Not Found"* ]]; then
            echo "The bucket $BUCKET is not there (AWS says Not Found), so it is not listed in feedback_api/.bucket."
            BUCKET=""
        else
            keep_bucket "$BUCKET"
            echo "The bucket $BUCKET could not be checked just now, so it is listed in feedback_api/.bucket"
            echo "to be safe. If it turns out to be gone, the inbox names it and reads the others."
        fi
    fi
    say "Removing the stack $STACK"
    echo "This deletes the feedback Lambda function, its CloudFront address ($DOMAIN),"
    if [ -n "$BUCKET" ]; then
        echo "the rate limit and the counter table. The bucket $BUCKET and all the"
        echo "feedback in it are kept; the local inbox still reads them (feedback_api/.bucket)."
    else
        echo "the rate limit and the counter table. There is no bucket to keep."
    fi
    if [ "$YES" != 1 ]; then
        printf 'Type remove to go on: '
        read -r answer
        [ "$answer" = remove ] || { echo "Nothing was removed."; exit 1; }
    fi
    aws cloudformation delete-stack --stack-name "$STACK"
    echo "Waiting for CloudFormation (CloudFront takes 15 minutes or more to go) ..."
    aws cloudformation wait stack-delete-complete --stack-name "$STACK"
    echo "The stack is gone."
    if [ -n "$BUCKET" ] && [ "$BUCKET" != None ]; then
        if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
            echo "The bucket $BUCKET is still there with the feedback. Read it with the local inbox (source=aws)."
        else
            echo "The bucket $BUCKET could not be found with your login. If the first deploy had failed, it held nothing."
        fi
    fi
    exit 0
fi

case "$STATUS" in
    NONE) FIRST=1 ;;
    ROLLBACK_COMPLETE)
        if [ -n "$SWITCH" ]; then echo "The first deploy of $STACK failed. Run this script without --turn-on or --turn-off." >&2; exit 1; fi
        if [ "${FEEDBACK_DEPLOY_CHECK_ONLY:-}" = 1 ]; then
            # a check changes nothing, so the failed stack is only named
            say "The first deploy of $STACK failed and was rolled back. A real run deletes it first"
        else
            say "The first deploy of $STACK failed and was rolled back. Deleting it so it can be made again"
            aws cloudformation delete-stack --stack-name "$STACK"
            aws cloudformation wait stack-delete-complete --stack-name "$STACK"
        fi
        FIRST=1 ;;
    *_IN_PROGRESS)
        echo "The stack $STACK is busy ($STATUS). Wait for it to finish, then run this again." >&2; exit 1 ;;
    *_FAILED)
        echo "The stack $STACK is in the state $STATUS. Look at its events in the CloudFormation console, fix the cause, then run this again." >&2; exit 1 ;;
esac

# ---------------------------------------------------------------- turn on or off only
# The template as it was last deployed (UsePreviousTemplate) with every other
# setting kept, so only ServiceOn (and the end date, with --until) changes.
# With the template on disk, edits made since the last full deploy would go
# live here without the code that matches them.
if [ -n "$SWITCH" ]; then
    [ "$FIRST" = 0 ] || { echo "The stack $STACK does not exist yet. Deploy it first." >&2; exit 1; }
    save_current
    SETS=(--set "ServiceOn=$SWITCH")
    [ -n "$UNTIL" ] && SETS+=(--set "EndsOn=$UNTIL")
    say "Setting ServiceOn=$SWITCH${UNTIL:+ and EndsOn=$UNTIL} (every other setting stays as it is)"
    python3 "$HERE/stack_input.py" --stack "$STACK" --previous-template --current "$TMP/current.json" \
        "${SETS[@]}" --out "$TMP/input.json"
    apply_stack update
    if [ "$SWITCH" = true ]; then
        say "Reserved concurrency"
        restore_concurrency
    fi
    service_state
    health
    exit 0
fi

# ---------------------------------------------------------------- 1. the settings
# EXTRA_PARAMS, e.g. "RateLimitOn=false"; each is kept on later deploys until changed
EXTRA=()
[ -n "${EXTRA_PARAMS:-}" ] && read -r -a EXTRA <<< "$EXTRA_PARAMS"
extra_value() {   # the value EXTRA_PARAMS gives a setting, or nothing
    local p v=""
    for p in ${EXTRA[@]+"${EXTRA[@]}"}; do
        case "$p" in "$1="*) v="${p#*=}" ;; esac
    done
    printf '%s' "$v"
}
SETS=()
for p in ${EXTRA[@]+"${EXTRA[@]}"}; do SETS+=(--set "$p"); done

say "End date"
if [ -n "$UNTIL" ]; then
    ENDS="$UNTIL"
elif [ "$FIRST" = 1 ]; then
    ENDS="$(python3 "$HERE/stack_input.py" --end-date)"
else
    ENDS="$(stack_param "$STACK" EndsOn 2>/dev/null || true)"
    if [ -z "$ENDS" ] || [ "$ENDS" = None ]; then
        # a stack made before end dates existed
        ENDS="$(python3 "$HERE/stack_input.py" --end-date)"
    else
        ENDS=""   # kept as it is
    fi
fi
if [ -n "$ENDS" ]; then
    SETS+=(--set "EndsOn=$ENDS")
    echo "Feedback will end after $ENDS (US Eastern)."
else
    echo "Kept: feedback ends after $(stack_param "$STACK" EndsOn) (US Eastern)."
fi

# ---------------------------------------------------------------- 2. certificate, hosted zone, room, bucket name
say "Certificate and hosted zone"
CERT="${CERT_ARN:-$(stack_param "$SITE_STACK" CertificateArn)}"
ZONE="${HOSTED_ZONE_ID:-$(stack_param "$SITE_STACK" HostedZoneId)}"
[ -n "$CERT" ] && [ "$CERT" != None ] && [ -n "$ZONE" ] && [ "$ZONE" != None ] \
    || { echo "Could not read CertificateArn and HostedZoneId from $SITE_STACK. Set CERT_ARN and HOSTED_ZONE_ID." >&2; exit 1; }
SETS+=(--set "CertificateArn=$CERT" --set "HostedZoneId=$ZONE")
if [ "$FIRST" = 1 ]; then
    CERT_STATUS="$(aws acm describe-certificate --certificate-arn "$CERT" --query 'Certificate.Status' --output text)"
    CERT_NAMES="$(aws acm describe-certificate --certificate-arn "$CERT" --query 'Certificate.SubjectAlternativeNames' --output text)"
    [ "$CERT_STATUS" = ISSUED ] || { echo "The certificate is $CERT_STATUS, not ISSUED." >&2; exit 1; }
    covered=0
    for n in $CERT_NAMES; do
        if [ "$n" = "$DOMAIN" ] || [ "$n" = "*.${DOMAIN#*.}" ]; then covered=1; fi
    done
    [ "$covered" = 1 ] || { echo "The certificate does not cover $DOMAIN (it covers: $CERT_NAMES). Use a *.nemac.org certificate, or request one for $DOMAIN in ACM (us-east-1), add the validation record it asks for, and run this again with CERT_ARN=<its arn>." >&2; exit 1; }
    echo "The certificate covers $DOMAIN."

    # Lambda keeps 100 unreserved; the template reserves Concurrency (5
    # unless EXTRA_PARAMS says otherwise, which is the way out this check
    # itself suggests)
    CONC="$(extra_value Concurrency)"
    CONC="${CONC:-5}"
    NEED=$(( 100 + CONC ))
    FREE="$(aws lambda get-account-settings --query 'AccountLimit.UnreservedConcurrentExecutions' --output text)"
    [ "$FREE" -ge "$NEED" ] || { echo "The account has room for $FREE Lambda calls at once; this needs $NEED. Ask AWS Support to raise the Lambda concurrent executions quota, or deploy with EXTRA_PARAMS=\"Concurrency=1\"." >&2; exit 1; }
    echo "Lambda concurrency: $FREE unreserved, $NEED needed."

    # After a --remove the bucket is still there under its name, and a new
    # stack cannot make a bucket with a name already taken. The new one gets
    # today's date added, and -2, -3 and so on when that is taken too (a
    # second remove and redeploy the same day); the old ones keep the
    # earlier feedback. A name in .bucket counts as taken without asking
    # AWS, since it is ours and holds feedback.
    KEPT="$(python3 "$HERE/stack_input.py" --kept-buckets --bucket-file "$BUCKET_FILE")"
    # Only a 404 means free. 403 is someone else's bucket, 301 or 400 one in
    # another region; anything else (throttling, a timeout) cannot tell, and
    # calling that free would send create-stack at a taken name, which rolls
    # back and picks the same name on every re-run.
    taken() {
        local hb
        [ -n "$KEPT" ] && grep -qxF "$1" <<< "$KEPT" && return 0
        hb="$(aws s3api head-bucket --bucket "$1" 2>&1)" && return 0
        [[ "$hb" == *"(404)"* || "$hb" == *"Not Found"* ]] && return 1
        [[ "$hb" == *"(403)"* || "$hb" == *Forbidden* || "$hb" == *"(301)"* || "$hb" == *"(400)"* ]] && return 0
        echo "Could not tell whether the bucket name $1 is free (AWS said: ${hb:0:200})." >&2
        echo "Nothing was changed. Try again in a minute." >&2
        exit 1
    }
    WANT="$(extra_value BucketName)"
    WANT="${WANT:-$DEFAULT_BUCKET}"
    if taken "$WANT"; then
        BASE="$WANT-$(date +%Y%m%d)"
        NEW="$BASE"
        n=2
        while taken "$NEW"; do
            [ "$n" -le 20 ] || { echo "Twenty bucket names for today are taken. Name one with EXTRA_PARAMS=\"BucketName=<name>\"." >&2; exit 1; }
            NEW="$BASE-$n"
            n=$(( n + 1 ))
        done
        [ "${#NEW}" -le 63 ] || { echo "The bucket name $NEW is longer than 63 characters. Name a shorter one with EXTRA_PARAMS=\"BucketName=<name>\"." >&2; exit 1; }
        echo "The bucket name $WANT is taken (a bucket kept by an earlier --remove, or someone else's)."
        echo "This deploy makes the bucket $NEW."
        if [ -n "$KEPT" ]; then
            echo "Earlier feedback stays in $(printf '%s' "$KEPT" | paste -sd ',' - | sed 's/,/, /g'), listed in"
            echo "feedback_api/.bucket; the local inbox reads every bucket listed there."
        else
            echo "If $WANT holds earlier feedback, feedback_api/.bucket on this computer does not list it."
            echo "Add $WANT as a line at the top of that file and the local inbox reads it too."
        fi
        SETS+=(--set "BucketName=$NEW")
    else
        echo "The bucket name $WANT is free."
    fi
fi

if [ "${FEEDBACK_DEPLOY_CHECK_ONLY:-}" = 1 ]; then
    say "Checks done. Stopping here, as FEEDBACK_DEPLOY_CHECK_ONLY=1 asks; nothing was built or changed"
    exit 0
fi

# ---------------------------------------------------------------- 3. the zip
say "Building $ZIP"
mkdir -p "$HERE/build"
python3 - "$HERE" "$ZIP" <<'PY'
import os, sys, zipfile
here, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
    for name in ("feedback_core.py", "feedback_lambda.py"):
        z.write(os.path.join(here, name), name)
    # the template's handler is index.handler (the placeholder's name)
    z.writestr("index.py", "from feedback_lambda import handler  # noqa: F401\n")
os.replace(out + ".tmp", out)
PY
echo "$(wc -c < "$ZIP" | tr -d ' ') bytes"

# ---------------------------------------------------------------- 4. the stack
say "Reading the testers' feedback code (not printed) and deploying the stack $STACK"
echo "(CloudFront can take 5 to 15 minutes the first time.)"
[ "$FIRST" = 1 ] && SETS+=(--set "ServiceOn=false")
if [ "$FIRST" = 1 ]; then
    rm -f "$TMP/current.json"
    python3 "$HERE/stack_input.py" --stack "$STACK" --template "$HERE/template.yml" --code-from "$ENVF" \
        "${SETS[@]}" --out "$TMP/input.json"
    apply_stack create
else
    save_current
    python3 "$HERE/stack_input.py" --stack "$STACK" --template "$HERE/template.yml" --code-from "$ENVF" \
        --current "$TMP/current.json" "${SETS[@]}" --out "$TMP/input.json"
    apply_stack update
fi
rm -f "$TMP/input.json"

# ---------------------------------------------------------------- 5. the code
FN="$(stack_output FunctionName)"
say "Putting the code into $FN"
aws lambda update-function-code --function-name "$FN" --zip-file "fileb://$ZIP" \
    --query 'CodeSha256' --output text
aws lambda wait function-updated --function-name "$FN"
echo "Code in place."

# ---------------------------------------------------------------- 6. on, after a first deploy
if [ "$FIRST" = 1 ]; then
    say "Turning feedback on, now that the code is in place"
    save_current
    python3 "$HERE/stack_input.py" --stack "$STACK" --previous-template --current "$TMP/current.json" \
        --set "ServiceOn=true" --out "$TMP/input.json"
    apply_stack update
fi

# ---------------------------------------------------------------- 7. check
say "On or off"
remember_bucket
service_state
health
