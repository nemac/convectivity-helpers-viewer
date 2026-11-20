"""
The feedback Lambda function
============================
Takes tester feedback for the road network connectivity viewer (and any
other nemac.org page that sets up Feedback mode) and keeps it in its own
bucket. It only ACCEPTS feedback: there is no route on AWS that reads, lists,
shows a screenshot of, or changes what was sent. The dev inbox reads the
bucket with the developer's own AWS login through local_server.py instead,
so a leaked code can add feedback but never read it.

Behind a Function URL that only CloudFront may call (origin access control),
at https://feedbackconnectivityviewer.nemac.org. README.md describes the API
for developers; feedback_core.py holds the rules.

Routes:
    POST    /feedback   {code, item (with an optional context), screenshot?}
                        -> 201 {id, created_at, has_screenshot};
                        410 once the end date (FEEDBACK_ENDS_ON) has passed
    GET     /health     {ok, service, on, ended, ends_at, ends_on, max_text, max_words,
                        max_screenshot_bytes, max_context_bytes}
    GET     /limits     the same as /health
    OPTIONS             the browser's preflight check

Every route needs an allowed Origin (nemac.org or a subdomain, or the dev
server on localhost:5190); any other origin, or none, gets 403 with no CORS
headers.

Environment: see feedback_core.py. On AWS: FEEDBACK_BUCKET, COUNTER_TABLE,
CODE_SALT, CODE_HASH_FEEDBACK, ALLOWED_DOMAIN, ALLOWED_LOCAL_ORIGINS, the
caps, FEEDBACK_ENDS_ON and SERVICE_ON. CODE_HASH_FEEDBACK_ADMIN is never set
here.

Packaged as a plain zip with no dependencies (boto3 is in the Lambda
runtime). deploy.sh adds index.py, which only imports handler from here, so
the handler name stays index.handler, the one the template's placeholder
code uses.
"""

import traceback

import feedback_core as core

METHODS = "GET, POST, OPTIONS"


def http(event):
    req = core.Request(event)
    if not req.allowed:
        return core.error(403, core.MSG_ORIGIN)
    if req.method == "OPTIONS":
        return core.reply(204, None, req)
    path = req.path.rstrip("/") or "/"
    if path in ("/health", "/limits") and req.method in ("GET", "HEAD"):
        return core.reply(200, core.health_body(), req)
    if path == "/feedback" and req.method == "POST":
        return core.post_feedback(req)
    return core.error(404, "There is nothing at this address.", req)


def handler(event, context):
    try:
        return http(event if isinstance(event, dict) else {})
    except Exception:   # noqa: BLE001  (the sender gets a plain sentence; the log keeps the detail)
        traceback.print_exc()
        req = core.Request(event if isinstance(event, dict) else {})
        return core.error(500, "Something went wrong. Try again in a minute.", req if req.allowed else None)
