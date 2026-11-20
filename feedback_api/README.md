# The feedback Lambda function

Takes tester feedback (suggested word changes and comments) from the viewer's
Feedback mode and keeps it in its own S3 bucket. It stands on its own: no other
part of the viewer or the analysis depends on it, and the same folder can be
copied into another nemac.org project.

- Web address: `https://feedbackconnectivityviewer.nemac.org`
- Stack: `road-network-feedback` (us-east-1), from `template.yml`
- Bucket: `nemac-road-network-feedback`, items at `feedback/<id>.json`,
  screenshots at `feedback/<id>.jpg`, kept until removed by hand, also after
  the stack is removed. If a redeploy after `--remove` has to make a new
  bucket, it is that name with the date added (such as
  `nemac-road-network-feedback-20270120`), and `-2`, `-3` and so on after a
  second remove the same day. The old ones keep the earlier feedback.
  `feedback_api/.bucket` (gitignored) lists every bucket that holds
  feedback, oldest first, one a line; `deploy.sh` adds to it and never
  takes a name off, and the local inbox reads them all. A name added by
  hand may have a note after a `#`. A line that is anything else is not
  read, but is kept as written, and the next deploy names it.

On AWS the function only **accepts** feedback. Nothing there reads, lists or
changes it. The dev inbox reads the bucket with your own AWS login through the
local server (below).

Feedback is **temporary**. It ends after an end date (60 days after the first
deploy unless `--until` says otherwise). After it, `POST /feedback` answers
`410` with "Feedback has ended. Thank you for your help.", `GET /health`
says `ended: true`, and the viewer hides the Feedback switch on the published
site. `deploy.sh --remove` then deletes everything that costs money and keeps
the bucket.

## Who may call it

Only pages on nemac.org and the local dev server:

- `https://nemac.org` and `https://<anything>.nemac.org` (https only, no port)
- `http://localhost:5190` and `http://127.0.0.1:5190`

Any other Origin, and a request with no Origin, gets `403` with no CORS
headers. CloudFront refuses them before the function runs (a CloudFront
Function), and the function checks again.

An Origin header can be faked by any program that is not a browser. The
origin rule keeps other websites from using the function from a visitor's
browser; the tester code, the lockout and the daily caps are what really
guard it.

## Routes (AWS)

| Route | What it does |
|---|---|
| `POST /feedback` | Keeps one item. Answers `201 {id, created_at, has_screenshot}`. |
| `GET /health` (or `/limits`) | `{ok, service, on, ended, ends_at, ends_on, max_text, max_words, max_screenshot_bytes, max_context_bytes}`. `ends_at` is the moment feedback stops, in UTC (midnight US Eastern after `ends_on`), or `null` with no end date. |
| `OPTIONS` | The browser's preflight check. |

Behind CloudFront, a POST must carry `x-amz-content-sha256`: the hex SHA-256 of
the body (`api()` in `src/ondemandApi.ts` adds it for `https://` bases).

### What to send

```json
{
  "code": "<the tester code>",
  "item": {
    "kind": "words | comment",
    "name": "Tester's name (up to 80 characters)",
    "tester_id": "random id the browser keeps (6 to 64 of A-Z a-z 0-9 _ -)",
    "tab": "isolation",
    "url_hash": "#tab=isolation&hazard=...",
    "target": {"area": "Legend", "selector": "...", "doc": "notes-pinch.md",
               "lnglat": [-82.84, 35.53], "zoom": 14.2},
    "original": "the words as they were",
    "suggested": "the words as the tester would have them",
    "why": "optional reason",
    "text": "the comment",
    "viewport": {"w": 1440, "h": 900},
    "context": {"type": "drawn_hazard | routes", "...": "what the tester had open"}
  },
  "screenshot": "optional base64 JPEG, with or without a data: prefix"
}
```

- `words` needs `original` and a different `suggested`; `comment` needs `text`.
- `target.area` is required. Text caps: 4,000 characters for `why`, `text` and
  notes, 8,000 for `original` and `suggested`.
- The screenshot must be a JPEG of 1.5 MB or less (`413` if larger); the whole
  body 2.9 MB or less (2.6 MB for a full screenshot and text, and 300 KB
  for a full context).
- `url_hash` must start with `#`. Any `feedback=` part is dropped before it is
  kept.
- `context` is optional: the drawn area (`"type": "drawn_hazard"`) or the
  alternate routes (`"type": "routes"`) the tester had open, so the inbox
  can show them after the drawn area or route link has expired. It is kept
  exactly as sent and never read for meaning. Its shape is checked only:
  - an object whose `type` is `drawn_hazard` or `routes`; any other fields
    are up to the viewer;
  - objects and lists at most 12 inside one another, the context itself
    counting as 1 (a GeoJSON MultiPolygon in a FeatureCollection is 9);
  - only strings and numbers as values: no `true`, `false` or `null`, so the
    viewer turns those into numbers or strings, or leaves the field out.
    Whole numbers between -2^53 and 2^53; names of 200 characters or fewer;
  - 300,000 bytes or less as `JSON.stringify` writes it (compact, UTF-8).
  Anything else is refused with `400`.

The server adds `id`, `created_at`, `status: "open"`, `done_at`, `note`,
`has_screenshot` and `origin`.

### Answers

| Status | When |
|---|---|
| `400` | Something is missing or too long, or the body is not JSON. |
| `401` | Wrong code. Ten wrong codes from one address in 10 minutes give `429` for the rest of them; 100 from everyone together give `429` to everyone for the rest of them. |
| `403` | The page is not on nemac.org or the dev server, or the rate limit (300 requests or 60 posts per address in 5 minutes). |
| `410` | Feedback has ended (the end date has passed). |
| `413` | Too large. |
| `429` | This address sent 200 items today, everyone together sent 1,000 items or 100 MB today, or a lockout. Days are US Eastern. An IPv6 address counts by its /64. |
| `503` | Feedback is turned off. |

The sender's address, for the caps and the lockout, is CloudFront's
`CloudFront-Viewer-Address` header, which the template's own origin request
policy forwards and which a sender cannot set. Only when it is missing is it
the last `X-Forwarded-For` entry.

## Codes

Both live in the viewer's gitignored `.env.development.local`. Never write
them anywhere else.

- `FEEDBACK_SITE_CODE`: the tester code. Testers type it when they turn
  Feedback on; it is never in a link. AWS gets only a salted hash.
- `VITE_FEEDBACK_ADMIN_CODE`: the dev inbox code. It never goes to AWS.

## The local server

```
python3 feedback_api/local_server.py        # http://127.0.0.1:8788
```

`npm run dev:local` starts it too, with its log in
`feedback_api/local_data/server.log`, and stops it on Ctrl+C. The viewer's
"This computer / AWS (live)" switch on the dev server picks where Feedback
mode sends items (this server or AWS) and which the inbox reads
(`source=local` or `source=aws`, always through this server).

Listens on 127.0.0.1 only. Reads both codes from the env file at start and
keeps only salted hashes in memory.

- `POST /feedback`, `GET /health`: the same code as the function on AWS.
  Feedback goes to `feedback_api/local_data/feedback/` (gitignored). From
  localhost the inbox code works as a tester code too.
- The dev inbox. Each needs the inbox code in the `x-feedback-admin` header
  (never in a URL) and an Origin of `http://localhost:5190` or
  `http://127.0.0.1:5190`. `source=local` reads the local folder,
  `source=aws` the real buckets. Items come back exactly as kept, with
  their `context` (or `null`).

| Route | What it does |
|---|---|
| `GET /feedback?source=&limit=&after=&bucket=` | One page (up to 100) in id order: `{count, items, next, source, buckets, unread_buckets}`. Pass `next` as `after` for the next page. Each item has `source` and a `screenshot_url` on this server (which needs the header too); with `source=aws`, also `bucket`. |
| `GET /feedback/<id>?source=&bucket=` | One item. |
| `GET /feedback/<id>.jpg?source=&bucket=` | Its screenshot. |
| `PATCH /feedback/<id>?source=&bucket=` | `{status: "done" or "open", note?}`, written back to the bucket the item came from. `POST` works too. |

With `source=aws` every bucket listed in `feedback_api/.bucket` is read as
one list, newest bucket first when looking an item up. `buckets` names
them; `bucket=<name>` keeps to one of them (`400` for a name not listed). A
bucket that cannot be read (deleted by hand, say) is named in
`unread_buckets` and passed over, so it never hides the others; only when
none can be read is the answer `502`. Looking up one item stops at the first
bucket that has it; when none does and one could not be read, the answer is
`502` naming that bucket, not `404`, since the item may be there. A page of 100 items with full
contexts can be about 30 MB, which is fine on this Mac.

`source=aws` uses your own AWS login (the default profile, or `AWS_PROFILE`):
boto3 if Python has it, otherwise the `aws` command line tool. Your login needs
`s3:ListBucket` on the bucket and `s3:GetObject` and `s3:PutObject` on
`feedback/*`, in each bucket. If the login fails, the inbox answers `502`
with the reason. The buckets are the first of: `--bucket` (give it more than
once for several), `FEEDBACK_INBOX_BUCKET`, `FEEDBACK_BUCKET`, every name in
`feedback_api/.bucket`, and `nemac-road-network-feedback`. `--newest-only`
reads only the last name in that file. The file is what keeps the feedback
findable once the stack (and its output naming the bucket) is gone.

## Deploying

Only with approval. It needs the AWS command line tool and a login that can
deploy CloudFormation stacks.

```
bash feedback_api/deploy.sh                     # build, deploy, put the code in, check
bash feedback_api/deploy.sh --until 2027-03-31  # the same, ending after that day (US Eastern)
bash feedback_api/deploy.sh --until 2026-11-01 --force-date   # a day already past, on purpose
bash feedback_api/deploy.sh --turn-off          # POST answers 503
bash feedback_api/deploy.sh --turn-on
bash feedback_api/deploy.sh --remove            # delete the stack, keep the bucket
```

- **End date.** A first deploy ends feedback 60 days later unless `--until`
  gives a day. It is kept as the stack's `EndsOn` setting, so later deploys
  keep it unless `--until` is given again (`--until` also works with
  `--turn-on` and `--turn-off`). A day already past would end feedback the
  moment it deploys, and one more than a year away would leave it running
  long after testing, so both are refused as likely typos unless
  `--force-date` is added. Today is fine: feedback is taken through the end of that day.
- **Removing.** `--remove` asks before it deletes the function, CloudFront,
  the rate limit and the counter table (the costs stop), and first adds the
  bucket's name to `feedback_api/.bucket`, unless it is known to be gone: a
  first create that failed and rolled back has taken its bucket with it, and
  a bucket AWS answers 404 for is not there. Any other answer (a login with
  fewer rights, throttling, no network) lists it to be safe, since the
  inbox passes over a listed bucket it cannot read. The bucket and its policy are kept
  (`RetainExceptOnCreate` in `template.yml`). A later deploy treats every
  name in `.bucket`, and any name AWS does not answer 404 for (403 is
  someone else's, 301 another region's), as taken, and makes a new bucket
  with the date added (and `-2`, `-3` if needed), listed below the others.
  When AWS cannot answer (throttling, a timeout) the deploy stops before
  changing anything, rather than guess.
- **Settings from earlier deploys** are kept on a full deploy only when
  `template.yml` still has them; one taken out of the template is dropped
  (and named), since CloudFormation refuses an update naming a setting the
  template lacks. An `EXTRA_PARAMS` setting the template does not have is
  refused before anything reaches AWS.
- **Checking first.** `FEEDBACK_DEPLOY_CHECK_ONLY=1 bash feedback_api/deploy.sh`
  runs the read-only checks (certificate, concurrency room, bucket name)
  and stops before building or changing anything.
- **Codes and salt.** `stack_input.py` reads the testers' code from the env
  file and writes the salt and hash to a file only you can read, which the
  aws tool reads with `--cli-input-json`, so none of them is on a command
  line. The salt is kept in `feedback_api/.deploy_salt` (gitignored) and used
  again, so a redeploy keeps the daily caps and lockouts; without that file
  (another computer) a new salt starts them over.
- **Turning on or off** changes only `ServiceOn`, on the template as last
  deployed, so edits to `template.yml` go live only with a full deploy and
  its matching code.

- The certificate and the nemac.org hosted zone are read from the
  `road-network-connectivity` stack (the `*.nemac.org` certificate covers this
  name). `CERT_ARN` and `HOSTED_ZONE_ID` override them. Before a first deploy
  the script checks that the certificate is issued and covers the name.
- The stack makes the A and AAAA records for the name itself. No DNS record
  has to be added by hand while nemac.org's zone is in Route 53 in this
  account.
- A first deploy starts with feedback off, puts the code in, then turns it on.
- `EXTRA_PARAMS="RateLimitOn=false"` and other settings in `template.yml`.

## Cost

At a few hundred items a month, the function, the table, the bucket and
CloudFront together come to a few cents. The rate limit (AWS WAF) adds about
$7 a month; `RateLimitOn=false` leaves it out. The function can never run more
than 5 at a time.

## Tests

```
python3 feedback_api/test.py            # a test server inside the test, the aws source, deploy.sh
python3 feedback_api/test.py running    # also the server running on 8788, only when named
python3 feedback_api/test.py --live     # the deployed function (with approval)
```

The default run starts its own server on a free port with made-up codes and
stops it when done, so it never touches the server on 8788. Every wrong-code
check is there, so no run moves this Mac toward a lockout; `running` sends
the real codes only, never a wrong one.

The tests never call AWS: `source=aws` is tried against fake buckets, and
`deploy.sh` and the `aws` tool against a stand-in for the tool. cfn-lint
checks `template.yml`.
