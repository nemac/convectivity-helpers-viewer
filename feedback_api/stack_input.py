"""
The input deploy.sh hands to CloudFormation
===========================================
    python3 feedback_api/stack_input.py --stack NAME --out FILE
        [--template FILE | --previous-template]
        [--current FILE]          describe-stacks output for the stack, if it exists
        [--code-from ENV_FILE]    add CodeSalt and CodeHashFeedback
        [--set Key=Value ...]     other parameters

Writes a JSON file for `aws cloudformation create-stack` or `update-stack`
with --cli-input-json, readable by its owner only. Why a file and not
`aws cloudformation deploy --parameter-overrides`:

  * the salt and the code's hash never appear on a command line, where any
    program on the Mac can read them (ps), and the code itself never passes
    through the shell at all: it is read here from the env file, as Vite
    reads it (envval.py);
  * on an update, every parameter of the stack that is not being set is
    sent as UsePreviousValue, so a setting given once (EXTRA_PARAMS, the end
    date, ServiceOn) is kept, and with --previous-template turning feedback
    on or off changes nothing but ServiceOn, whatever has been edited in
    template.yml since the last full deploy.

The salt is kept in feedback_api/.deploy_salt (gitignored) and used again on
later deploys. The salt also keys the addresses in the daily caps and the
wrong-code lockout, so a new salt on every deploy would have started them
all over. Without that file (a first deploy, or another computer) a new salt
is made and saved.

On a full update (a new template.yml), only the settings that template
still has are kept: CloudFormation refuses an update that names a setting
the template no longer holds, so one removed from template.yml is dropped
(and said so), and a --set naming a setting the template does not have is
refused with a sentence before anything reaches AWS.

Also:
    python3 feedback_api/stack_input.py --end-date [YYYY-MM-DD] [--force-date]
prints the date checked (or 60 days from today, US Eastern, when none is
given) and exits 1 with a sentence when it is not a real date, is already
past, or is more than a year away. A past date would end feedback at once
and hide the switch on the published site, which is almost always a typo;
--force-date takes such a date anyway.

    python3 feedback_api/stack_input.py --kept-buckets [--bucket-file FILE]
prints the buckets listed in feedback_api/.bucket, oldest first, one a line.

    python3 feedback_api/stack_input.py --keep-bucket NAME [--bucket-file FILE]
adds NAME to that list as the newest (moving it to the end if it is there
already). deploy.sh calls it for the stack's bucket after every deploy and
before --remove, so every bucket that still holds feedback stays listed and
the local inbox reads them all.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import envval  # noqa: E402

SALT_FILE = os.path.join(HERE, ".deploy_salt")
BUCKET_FILE = os.path.join(HERE, ".bucket")
BUCKET_NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
DEFAULT_DAYS = 60   # the user's choice: feedback runs for about two months
KEY = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,254}$")

try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:   # no time zone data: standard time is close enough for a date
    EASTERN = dt.timezone(dt.timedelta(hours=-5))


def eastern_today():
    return dt.datetime.now(EASTERN).date()


def _a_year_on(today):
    try:
        return today.replace(year=today.year + 1)
    except ValueError:   # February 29
        return today.replace(year=today.year + 1, day=28)


def end_date(given=None, today=None, force=False):
    """(YYYY-MM-DD, message or None). No date given: 60 days from today.
    A day before today, or more than a year after it, is refused unless
    `force`: the first ends feedback the moment it is deployed, the second
    leaves it running long after the testing is over. Today itself is fine:
    feedback is taken through the end of that day."""
    today = today or eastern_today()
    if not given:
        return (today + dt.timedelta(days=DEFAULT_DAYS)).isoformat(), None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", given):
        return None, f"--until needs a date written YYYY-MM-DD, such as {today + dt.timedelta(days=DEFAULT_DAYS)}."
    try:
        day = dt.date.fromisoformat(given)
    except ValueError:
        return None, f"{given} is not a real date."
    # the template only takes 20xx, whatever --force-date says
    if day.year < 2000 or day.year > 2099:
        return None, f"{given} is too far off."
    if not force and day < today:
        return None, (f"{given} has already passed (today is {today}, US Eastern), so feedback would end at once. "
                      "Check the date, or add --force-date if that is what you want.")
    if not force and day > _a_year_on(today):
        return None, (f"{given} is more than a year away. Check the date, or add --force-date if that is "
                      "what you want.")
    return day.isoformat(), None


def salt(path=SALT_FILE):
    """(salt, kept): the saved salt, or a new one saved for next time."""
    try:
        with open(path, encoding="utf-8") as fh:
            s = fh.read().strip()
        if re.fullmatch(r"[0-9a-f]{32}", s):
            return s, True
    except OSError:
        pass
    s = secrets.token_hex(16)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(s + "\n")
    return s, False


def code_params(env_file, salt_file=SALT_FILE):
    """{CodeSalt, CodeHashFeedback} and a sentence for the log. Refuses (by
    raising SystemExit with a sentence) a missing code, or a testers' code
    that is the same as the inbox code. Nothing here prints a code."""
    if not os.path.isfile(env_file):
        raise SystemExit(f"Missing {env_file} (it holds FEEDBACK_SITE_CODE).")
    code = envval.read(env_file, "FEEDBACK_SITE_CODE")
    admin = envval.read(env_file, "VITE_FEEDBACK_ADMIN_CODE")
    if not code:
        raise SystemExit(f"FEEDBACK_SITE_CODE is empty or missing in {env_file}")
    if admin and admin == code:
        raise SystemExit("The testers' feedback code and the inbox code must differ.")
    s, kept = salt(salt_file)
    h = hashlib.sha256((s + code).encode("utf-8")).hexdigest()
    note = "Salted hash made (salt kept from the last deploy)." if kept else \
        "Salted hash made (a new salt: the daily caps and lockouts start over)."
    if len(code) < 12:
        # a warning only: the global wrong-code limit bounds guessing, but a
        # short code is still the weak point
        note += " The testers' code is short; one of 16 characters or more is safer."
    return {"CodeSalt": s, "CodeHashFeedback": h}, note


def template_params(body):
    """The parameter names a template declares, or None when they cannot be
    found (then nothing is dropped and CloudFormation has the last word).
    Reads JSON, or the YAML layout template.yml uses (a top-level
    "Parameters:" with its names one indent in), without a YAML library,
    since template.yml's !Ref and !Sub tags need one that knows them."""
    if not body:
        return None
    text = body.lstrip()
    if text.startswith("{"):
        try:
            got = json.loads(text).get("Parameters")
        except (ValueError, AttributeError):
            return None
        return set(got) if isinstance(got, dict) else None
    m = re.search(r"^Parameters:[ \t]*\r?\n((?:(?:[ \t#].*)?\r?\n?)*)", body, re.M)
    if not m:
        return None
    first = re.search(r"^([ \t]+)[A-Za-z0-9]+:", m.group(1), re.M)
    if not first:
        return None
    names = re.findall(r"^" + re.escape(first.group(1)) + r"([A-Za-z0-9]+):", m.group(1), re.M)
    return set(names) or None


def kept_params(current, sets, allowed=None):
    """(names kept as they are, names dropped). Every parameter the stack
    has and `sets` does not name is kept, unless `allowed` (the new
    template's names) leaves it out."""
    have = [p["ParameterKey"] for p in ((current or {}).get("Stacks") or [{}])[0].get("Parameters") or []]
    rest = [k for k in have if k not in sets]
    if allowed is None:
        return rest, []
    return [k for k in rest if k in allowed], [k for k in rest if k not in allowed]


def build(stack, sets, current=None, template_body=None, previous_template=False):
    """The --cli-input-json body. `current` is describe-stacks output (or
    None when the stack does not exist yet). Every parameter the stack has
    and `sets` does not name is kept as it is, as long as the template
    being deployed still has it."""
    allowed = None if previous_template else template_params(template_body)
    if allowed is not None:
        unknown = sorted(k for k in sets if k not in allowed)
        if unknown:
            raise SystemExit(f"Not a setting in the template: {', '.join(unknown)}. "
                             "Check the spelling against template.yml's Parameters.")
    params = [{"ParameterKey": k, "ParameterValue": str(v)} for k, v in sets.items()]
    if current:
        keep, _ = kept_params(current, sets, allowed)
        params += [{"ParameterKey": k, "UsePreviousValue": True} for k in keep]
    out = {"StackName": stack, "Parameters": params, "Capabilities": ["CAPABILITY_IAM"]}
    if previous_template:
        if not current:
            raise SystemExit(f"The stack {stack} does not exist yet, so it has no template to keep.")
        out["UsePreviousTemplate"] = True
    else:
        out["TemplateBody"] = template_body
    return out


def bucket_on_line(line):
    """The bucket name a line of the list holds, or None. A name added by
    hand may carry a note after it ("name  # from the other Mac"), so the
    name is what comes before any "#". Anything else (two words, say) is not
    guessed at: its first word could pass for a name. local_server.py reads
    lines the same way."""
    text = line.split("#", 1)[0].strip()
    return text if BUCKET_NAME.match(text) else None


def kept_buckets(path=BUCKET_FILE):
    """The buckets listed in the file, oldest first, each once. A file from
    before the list (one line) reads as a list of one."""
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return []
    out = []
    for x in lines:
        b = bucket_on_line(x)
        if b and b not in out:
            out.append(b)
    return out


def keep_bucket(name, path=BUCKET_FILE):
    """Adds `name` to the list as the newest. Every other line is written
    back exactly as it was, notes and lines that hold no bucket name
    included: a bucket left by an earlier --remove still holds feedback, so
    nothing anyone wrote there may drop off the list. A line that holds no
    bucket name is named on stderr, since the inbox does not read it.
    Written to a temporary file and moved into place, so a reader never
    sees half of it."""
    if not BUCKET_NAME.match(name or ""):
        raise SystemExit(f"Not a bucket name: {name!r}")
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except FileNotFoundError:
        lines = []
    for n, x in enumerate(lines, 1):
        if x.split("#", 1)[0].strip() and not bucket_on_line(x):
            print(f"Line {n} of {os.path.basename(path)} holds no bucket name the inbox can read, "
                  f"so it is kept as it is: {x.strip()[:80]!r}", file=sys.stderr)
    lines = [x for x in lines if bucket_on_line(x) != name] + [name]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("".join(x + "\n" for x in lines))
    os.replace(tmp, path)
    return kept_buckets(path)


def parse_sets(items):
    sets = {}
    for it in items or []:
        k, sep, v = it.partition("=")
        if not sep or not KEY.match(k):
            raise SystemExit(f"Not a stack setting: {it!r} (write Key=Value, as in RateLimitOn=false)")
        sets[k] = v
    return sets


def main(argv=None):
    ap = argparse.ArgumentParser(description="The input deploy.sh hands to CloudFormation.")
    ap.add_argument("--end-date", nargs="?", const="", default=None)
    ap.add_argument("--force-date", action="store_true", help="take an --end-date in the past or over a year away")
    ap.add_argument("--kept-buckets", action="store_true")
    ap.add_argument("--keep-bucket")
    ap.add_argument("--bucket-file", default=BUCKET_FILE, help="the bucket list (test.py uses its own)")
    ap.add_argument("--stack")
    ap.add_argument("--out")
    ap.add_argument("--template")
    ap.add_argument("--previous-template", action="store_true")
    ap.add_argument("--current")
    ap.add_argument("--code-from")
    ap.add_argument("--salt-file", default=SALT_FILE, help="where the salt is kept (test.py uses its own)")
    ap.add_argument("--set", action="append", default=[])
    a = ap.parse_args(argv)

    if a.kept_buckets:
        for b in kept_buckets(a.bucket_file):
            print(b)
        return 0
    if a.keep_bucket is not None:
        keep_bucket(a.keep_bucket, a.bucket_file)
        return 0
    if a.end_date is not None:
        day, msg = end_date(a.end_date or None, force=a.force_date)
        if msg:
            print(msg, file=sys.stderr)
            return 1
        print(day)
        return 0

    if not a.stack or not a.out or not (a.template or a.previous_template):
        ap.error("--stack, --out and --template (or --previous-template) are needed")
    sets = parse_sets(a.set)
    current = None
    if a.current and os.path.isfile(a.current) and os.path.getsize(a.current):
        with open(a.current, encoding="utf-8") as fh:
            current = json.load(fh)
    if a.code_from:
        secret, note = code_params(a.code_from, a.salt_file)
        sets.update(secret)
        print(note, file=sys.stderr)
    body = None
    if a.template:
        with open(a.template, encoding="utf-8") as fh:
            body = fh.read()
    data = build(a.stack, sets, current, body, a.previous_template)
    if current and not a.previous_template:
        _, dropped = kept_params(current, sets, template_params(body))
        if dropped:
            print(f"No longer in the template, so dropped from the stack: {', '.join(dropped)}", file=sys.stderr)
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
