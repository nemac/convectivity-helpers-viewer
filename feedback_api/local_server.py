"""
The feedback Lambda function's local copy, plus the dev inbox
=============================================================
A small HTTP server on http://127.0.0.1:8788 (this Mac only) that:

  * answers POST /feedback, GET /health and GET /limits with the very code
    the feedback Lambda function runs (feedback_lambda.http), so feedback
    sent from the dev server is checked by the same rules and kept in a
    gitignored folder, feedback_api/local_data/feedback/;
  * serves the dev inbox, which AWS does not have at all:
        GET   /feedback?source=local|aws&limit=&after=&bucket=   one page of items
        GET   /feedback/<id>?source=...&bucket=                  one item
        GET   /feedback/<id>.jpg?source=...&bucket=              its screenshot
        PATCH /feedback/<id>?source=...&bucket=  {status, note?} mark it done or open
                                                 (POST works too)
        DELETE /feedback/<id>?source=local       remove one item and its screenshot
        POST  /feedback/clear?source=local  {"confirm": "clear"}
                                                 remove every item in the local folder
    Deleting is for test feedback on this computer only: both refuse
    source=aws, so real feedback in a bucket is never deleted from the inbox.
    source=local reads the local folder; source=aws reads and updates the
    real feedback buckets with this Mac's own AWS login (boto3 when it can
    be imported, else the aws command line tool). The buckets are every one
    listed in feedback_api/.bucket, which deploy.sh adds to on each deploy
    and before --remove, so feedback is still found after the stack is
    removed and redeployed with a new bucket. Their items are read together
    as one list, each marked with its bucket; bucket=<name> keeps to one of
    them. --bucket, FEEDBACK_INBOX_BUCKET or FEEDBACK_BUCKET name one
    bucket instead, and --newest-only reads only the last one listed. The
    inbox routes need the inbox code (VITE_FEEDBACK_ADMIN_CODE) in the
    x-feedback-admin header and an Origin of http://localhost:5190 or
    http://127.0.0.1:5190. Items come back exactly as kept, a tester's
    context (a drawn area or routes) included.

    python3 feedback_api/local_server.py [--port 8788] [--data feedback_api/local_data]
                                         [--bucket NAME ...] [--newest-only]

The codes are read from the viewer's .env.development.local at start
(FEEDBACK_SITE_CODE and VITE_FEEDBACK_ADMIN_CODE, read as Vite reads them),
salted with a random salt made at start, and kept only as hashes in memory.
They are never printed or written. Standard library only (boto3 optional).
"""

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import envval  # noqa: E402
import feedback_core as core  # noqa: E402
import feedback_lambda  # noqa: E402

DEFAULT_BUCKET = "nemac-road-network-feedback"
# deploy.sh lists every bucket that holds feedback here, oldest first (gitignored)
BUCKET_FILE = os.path.join(HERE, ".bucket")
BUCKET_NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
INBOX_METHODS = "GET, POST, PATCH, DELETE, OPTIONS"
PAGE = 100                       # items in one page of GET /feedback
MAX_REQUEST = 6 * 1024 * 1024    # a Function URL's own limit on a request body
MSG_LOCAL = "The feedback inbox only works from the viewer running on this computer."
MSG_GONE = "This feedback was not found."
MSG_NO_DELETE = "Deleting is only for test feedback on this computer."
# what an item's own files are called; anything else in the folder (a write
# still in progress) is left alone by a delete or a clear
ITEM_FILE = re.compile(r"^([0-9a-f]{32})\.(json|jpg)$")
HOST_OK = re.compile(r"^(localhost|127\.0\.0\.1):\d{1,5}$")

CONFIG = {"data": os.path.join(HERE, "local_data"), "buckets": [DEFAULT_BUCKET], "trust_forwarded": False,
          "port": 8788, "s3_factory": None}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class AwsError(Exception):
    """The bucket could not be reached with this Mac's AWS login."""


# ---------------------------------------------------------------- the bucket, with the Mac's login
#
# Three things answer the same four calls: boto3, the aws command line tool
# (used when boto3 is not installed, as on this Mac), and a fake in test.py,
# so the inbox code is the same whichever is used and tests never call AWS.

class Boto3S3:
    def __init__(self, bucket):
        import boto3
        self.bucket = bucket
        self.s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))

    def list_page(self, prefix, start_after):
        """(keys under prefix after start_after, up to 1000; whether more follow)."""
        try:
            kw = {"Bucket": self.bucket, "Prefix": prefix, "MaxKeys": 1000}
            if start_after:
                kw["StartAfter"] = start_after
            out = self.s3.list_objects_v2(**kw)
        except Exception as exc:   # noqa: BLE001
            raise AwsError(str(exc)) from exc
        return [o["Key"] for o in out.get("Contents", [])], bool(out.get("IsTruncated"))

    def get_many(self, keys):
        """{key: bytes} for the keys that exist."""
        def one(k):
            try:
                return k, self.s3.get_object(Bucket=self.bucket, Key=k)["Body"].read()
            except self.s3.exceptions.NoSuchKey:
                return k, None
            except Exception as exc:   # noqa: BLE001
                raise AwsError(str(exc)) from exc
        with ThreadPoolExecutor(8) as ex:
            return {k: v for k, v in ex.map(one, keys) if v is not None}

    def put(self, key, data, content_type):
        try:
            self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type,
                               CacheControl="no-store")
        except Exception as exc:   # noqa: BLE001
            raise AwsError(str(exc)) from exc


class CliS3:
    """The same calls through the aws command line tool. A page of items is
    fetched with one `aws s3 cp --recursive` rather than one call per item,
    since each start of the tool takes about half a second."""

    def __init__(self, bucket):
        self.bucket = bucket
        self.aws = os.environ.get("AWS_CLI") or shutil.which("aws") or "aws"
        self.region = os.environ.get("AWS_REGION", "us-east-1")

    def _run(self, args, data=None):
        try:
            p = subprocess.run([self.aws, *args, "--region", self.region], input=data,
                               capture_output=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise AwsError(f"the aws tool could not be run ({exc.__class__.__name__})") from exc
        return p

    @staticmethod
    def _reason(p):
        lines = [x for x in p.stderr.decode("utf-8", "replace").strip().splitlines() if x.strip()]
        return lines[-1][:300] if lines else f"the aws tool stopped with code {p.returncode}"

    def list_page(self, prefix, start_after):
        args = ["s3api", "list-objects-v2", "--bucket", self.bucket, "--prefix", prefix,
                "--no-paginate", "--output", "json"]
        if start_after:
            args += ["--start-after", start_after]
        p = self._run(args)
        if p.returncode != 0:
            raise AwsError(self._reason(p))
        try:
            out = json.loads(p.stdout or b"{}") or {}
        except ValueError as exc:
            raise AwsError("the aws tool gave an answer that could not be read") from exc
        keys = [o["Key"] for o in out.get("Contents") or []]
        return keys, bool(out.get("IsTruncated", len(keys) >= 1000))

    def get_many(self, keys):
        if not keys:
            return {}
        prefix = os.path.commonprefix(keys)
        prefix = prefix[:prefix.rfind("/") + 1]
        tmp = tempfile.mkdtemp(prefix="aws_get_", dir=_ensure(os.path.join(CONFIG["data"], "tmp")))
        try:
            args = ["s3", "cp", f"s3://{self.bucket}/{prefix}", tmp, "--recursive", "--only-show-errors",
                    "--exclude", "*"]
            for k in keys:
                args += ["--include", k[len(prefix):]]
            p = self._run(args)
            if p.returncode != 0:
                raise AwsError(self._reason(p))
            out = {}
            for k in keys:
                f = os.path.join(tmp, k[len(prefix):])
                if os.path.isfile(f):
                    with open(f, "rb") as fh:
                        out[k] = fh.read()
            return out
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def put(self, key, data, content_type):
        p = self._run(["s3", "cp", "-", f"s3://{self.bucket}/{key}", "--content-type", content_type,
                       "--cache-control", "no-store", "--only-show-errors"], data=data)
        if p.returncode != 0:
            raise AwsError(self._reason(p))


def default_s3(bucket):
    try:
        import boto3  # noqa: F401
        return Boto3S3(bucket)
    except ImportError:
        return CliS3(bucket)


def _ensure(folder):
    os.makedirs(folder, exist_ok=True)
    return folder


# ---------------------------------------------------------------- the two sources

class LocalInbox:
    def __init__(self, folder):
        self.dir = os.path.join(folder, "feedback")

    def page(self, after, limit):
        try:
            names = sorted(n for n in os.listdir(self.dir) if n.endswith(".json"))
        except OSError:
            return [], None
        if after:
            names = [n for n in names if n > f"{after}.json"]
        page, more = names[:limit], len(names) > limit
        items = [i for i in (self.get(n[:-5]) for n in page) if i]
        return items, (page[-1][:-5] if more and page else None)

    def get(self, fid):
        try:
            with open(os.path.join(self.dir, f"{fid}.json"), encoding="utf-8") as fh:
                got = json.load(fh)
            return got if isinstance(got, dict) else None
        except (OSError, ValueError):
            return None

    def jpg(self, fid):
        try:
            with open(os.path.join(self.dir, f"{fid}.jpg"), "rb") as fh:
                return fh.read()
        except OSError:
            return None

    def save(self, item):
        core.FolderStore(os.path.dirname(self.dir)).put(f"feedback/{item['id']}.json",
                                                        core.dumps(item).encode("utf-8"), "application/json")

    def delete(self, fid):
        """Removes an item's .json and .jpg. Whether there was anything."""
        gone = False
        for ext in ("json", "jpg"):
            try:
                os.remove(os.path.join(self.dir, f"{fid}.{ext}"))
                gone = True
            except FileNotFoundError:
                pass
        return gone

    def clear(self):
        """Removes every item and screenshot. How many items there were."""
        try:
            names = os.listdir(self.dir)
        except OSError:
            return 0
        items = set()
        for n in names:
            m = ITEM_FILE.match(n)
            if not m:
                continue
            try:
                os.remove(os.path.join(self.dir, n))
            except FileNotFoundError:
                continue
            items.add(m.group(1))
        return len(items)


class AwsInbox:
    PREFIX = "feedback/"

    def __init__(self, s3, bucket=None):
        self.s3 = s3
        self.bucket = bucket

    def page(self, after, limit):
        """Keys come back in name order; a page is the next `limit` items
        after `after`, found by listing until one more is seen."""
        keys, start, more = [], (self.PREFIX + f"{after}.json") if after else None, False
        while True:
            got, truncated = self.s3.list_page(self.PREFIX, start)
            for k in got:
                if k.endswith(".json") and "/" not in k[len(self.PREFIX):]:
                    if len(keys) == limit:
                        more = True
                        break
                    keys.append(k)
            if more or not truncated or not got:
                break
            start = got[-1]
        blobs = self.s3.get_many(keys)
        items = []
        for k in keys:
            try:
                it = json.loads(blobs[k])
            except (KeyError, ValueError):
                continue   # one unreadable object never hides the rest
            if isinstance(it, dict):
                items.append(it)
        return items, (keys[-1][len(self.PREFIX):-5] if more and keys else None)

    def get(self, fid):
        raw = self.s3.get_many([f"{self.PREFIX}{fid}.json"]).get(f"{self.PREFIX}{fid}.json")
        try:
            got = json.loads(raw) if raw else None
        except ValueError:
            return None
        return got if isinstance(got, dict) else None

    def jpg(self, fid):
        return self.s3.get_many([f"{self.PREFIX}{fid}.jpg"]).get(f"{self.PREFIX}{fid}.jpg")

    def save(self, item):
        self.s3.put(f"{self.PREFIX}{item['id']}.json", core.dumps(item).encode("utf-8"), "application/json")


class BucketsInbox:
    """Several buckets read as one inbox. A --remove keeps its bucket and
    the next deploy makes a new one, so feedback can be spread over more
    than one; the inbox should show it all without anyone having to know
    which. Ids are random, so they never clash, and a page is the first
    `limit` ids after `after` across every bucket, which each bucket's own
    first `limit` are enough to find. Each item carries "bucket", so a done
    mark goes back to the bucket the item came from."""

    def __init__(self, boxes):
        self.boxes = boxes   # newest first, so a lookup finds new feedback first
        self.unread = []     # buckets that could not be read this time

    def _each(self, fn):
        """fn(box) for every bucket. One that cannot be read (deleted by
        hand, or no longer allowed to this login) is passed over and named
        in `unread`, so it never hides the feedback in the others; only
        when none can be read is that an error."""
        out, err = [], None
        for box in self.boxes:
            try:
                out.append((box, fn(box)))
            except AwsError as exc:
                err = exc
                self.unread.append(box.bucket)
                log(f"bucket {box.bucket} could not be read: {exc}")
        if err and not out:
            raise err
        return out

    def page(self, after, limit):
        merged, more, nexts = {}, False, []
        for box, (items, nxt) in self._each(lambda b: b.page(after, limit)):
            if nxt:
                more = True
                nexts.append(nxt)
            for it in items:
                fid = str(it.get("id", ""))
                if fid and fid not in merged:
                    merged[fid] = {**it, "bucket": box.bucket}
        ids = sorted(merged)
        # A bucket that stopped at `nxt` has not been read past it, so ids
        # after the lowest such stop may skip that bucket's later items (its
        # page comes up short when one of its items could not be read). The
        # page ends there, and the next one starts from it.
        stop = min(nexts) if nexts else None
        if stop is not None:
            ids = [i for i in ids if i <= stop]
        if len(ids) > limit:
            ids = ids[:limit]
            return [merged[i] for i in ids], ids[-1]
        # `stop` rather than the last id shown, so items that could not be
        # read are not listed again
        return [merged[i] for i in ids], stop

    def _first(self, fn):
        """fn(box) in each bucket, newest first, until one has the item, so a
        lookup costs one bucket read when the item is in the newest (each read
        is a subprocess of about half a second with the aws tool). A bucket
        that cannot be read is passed over, but when no other bucket has the
        item that is an error, not "not found", since the item may be in it."""
        failed = []
        for box in self.boxes:
            try:
                got = fn(box)
            except AwsError as exc:
                failed.append(box.bucket)
                self.unread.append(box.bucket)
                log(f"bucket {box.bucket} could not be read: {exc}")
                continue
            if got:
                return box, got
        if failed:
            raise AwsError(f"the bucket{'s' if len(failed) > 1 else ''} {', '.join(failed)} could not be read, "
                           "and this feedback may be there")
        return None, None

    def get(self, fid):
        box, it = self._first(lambda b: b.get(fid))
        return {**it, "bucket": box.bucket} if it else None

    def jpg(self, fid):
        return self._first(lambda b: b.jpg(fid))[1]

    def save(self, item):
        item = dict(item)   # the caller's copy keeps "bucket" for its answer
        name = item.pop("bucket", None)
        box = next((b for b in self.boxes if b.bucket == name), None)
        if box is None:
            # never written to a bucket it was not read from
            raise AwsError(f"the bucket {name!r} is not one this server reads")
        box.save(item)


def inbox_for(source, only=None):
    if source == "local":
        return LocalInbox(CONFIG["data"])
    make = CONFIG["s3_factory"] or default_s3
    names = [only] if only else list(reversed(CONFIG["buckets"]))
    return BucketsInbox([AwsInbox(make(b), b) for b in names])


# ---------------------------------------------------------------- the inbox routes

def _out(req, item, source):
    """An item as the inbox gets it: where it came from, and the address of
    its screenshot on this server (which needs the inbox header too)."""
    host = req.headers.get("host", "")
    base = f"http://{host}" if HOST_OK.match(host) else f"http://127.0.0.1:{CONFIG['port']}"
    shot = None
    if item.get("has_screenshot"):
        shot = f"{base}/feedback/{item.get('id')}.jpg?source={source}"
        if item.get("bucket"):
            # straight to the right bucket, rather than asking each in turn
            shot += f"&bucket={item['bucket']}"
    return {**item, "source": source, "screenshot_url": shot}


def inbox(req, path):
    e = lambda status, msg: core.error(status, msg, req, INBOX_METHODS)   # noqa: E731
    if not req.local:
        return e(403, MSG_LOCAL)
    locked = core.locked_out(req)
    if locked:
        return e(429, locked)
    if not core.code_ok(req.headers.get(core.ADMIN_HEADER), req, "admin"):
        return core.wrong_code(req, INBOX_METHODS)
    source = req.param("source") or "local"
    if source not in ("local", "aws"):
        return e(400, "Say source=local or source=aws.")
    deleting = req.method == "DELETE" or path == "/feedback/clear"
    if deleting and source != "local":
        # before anything else about the request, so no bucket is ever touched
        return e(400, MSG_NO_DELETE)
    only = req.param("bucket") or None
    if only is not None and (source != "aws" or only not in CONFIG["buckets"]):
        return e(400, "That bucket is not one this server reads. The buckets are listed in feedback_api/.bucket.")
    box = inbox_for(source, only)

    if path == "/feedback":
        if req.method != "GET":
            return e(404, "There is nothing at this address.")
        try:
            limit = max(1, min(PAGE, int(req.param("limit") or PAGE)))
        except ValueError:
            return e(400, core.MSG_READ)
        after = req.param("after") or None
        if after is not None and not core.FEEDBACK_ID.match(after):
            return e(400, core.MSG_READ)
        items, nxt = box.page(after, limit)
        items = [i for i in items if core.FEEDBACK_ID.match(str(i.get("id", "")))]
        return core.reply(200, {"count": len(items), "items": [_out(req, i, source) for i in items],
                                "next": nxt, "source": source,
                                "buckets": list(reversed(CONFIG["buckets"])) if source == "aws" else None,
                                "unread_buckets": getattr(box, "unread", None) or None},
                          req, INBOX_METHODS)

    if path == "/feedback/clear":
        if req.method != "POST":
            return e(404, "There is nothing at this address.")
        body = req.json()
        # asked for in so many words, so a stray POST never empties the folder
        if body is None or body.get("confirm") != "clear":
            return e(400, 'Send {"confirm": "clear"} to delete every item on this computer.')
        n = box.clear()
        log(f"cleared {n} local item{'' if n == 1 else 's'}")
        return core.reply(200, {"deleted": n, "source": source}, req, INBOX_METHODS)

    m = re.match(r"^/feedback/([^/]+?)(\.jpg)?$", path)
    if not m or req.method not in ("GET", "PATCH", "POST", "DELETE") or (m.group(2) and req.method != "GET"):
        return e(404, "There is nothing at this address.")
    fid = m.group(1)
    if not core.FEEDBACK_ID.match(fid):
        return e(404, MSG_GONE)
    if m.group(2):
        data = box.jpg(fid)
        if not data:
            return e(404, "This feedback has no screenshot.")
        return core.reply_bytes(200, data, "image/jpeg", req, f"{fid}.jpg", INBOX_METHODS)
    if req.method == "GET":
        item = box.get(fid)
        return core.reply(200, _out(req, item, source), req, INBOX_METHODS) if item else e(404, MSG_GONE)
    if req.method == "DELETE":
        if not box.delete(fid):
            return e(404, MSG_GONE)
        return core.reply(200, {"deleted": fid, "source": source}, req, INBOX_METHODS)

    # PATCH (or POST, for a client that cannot send PATCH): done or open, and a note
    body = req.json()
    if body is None:
        return e(400, core.MSG_READ)
    status = body.get("status")
    if status is not None and status not in ("open", "done"):
        return e(400, core.MSG_READ)
    has_note = "note" in body
    note, msg = core.clean_text(body.get("note"), core.MAX_TEXT, "the note")
    if msg:
        return e(400, msg)
    if status is None and not has_note:
        return e(400, core.MSG_READ)
    item = box.get(fid)
    if not item:
        return e(404, MSG_GONE)
    if status == "done" and item.get("status") != "done":
        item.update(status="done", done_at=core.utc_iso())
    elif status == "open":
        item.update(status="open", done_at=None)
    if has_note:
        item["note"] = note
    item.pop("source", None)
    item.pop("screenshot_url", None)
    box.save(item)
    return core.reply(200, _out(req, item, source), req, INBOX_METHODS)


def route(event):
    """One request, as a Function URL event. Feedback taking and the health
    check go to the Lambda function's own code; the inbox is handled here."""
    req = core.Request(event)
    if not req.allowed:
        return core.error(403, core.MSG_ORIGIN)
    path = req.path.rstrip("/") or "/"
    if req.method == "OPTIONS":
        # the inbox needs PATCH and the header, so the preflight names them
        return core.reply(204, None, req, INBOX_METHODS)
    if (path == "/feedback" and req.method == "POST") or not (path == "/feedback" or path.startswith("/feedback/")):
        return feedback_lambda.http(event)
    try:
        return inbox(req, path)
    except AwsError as exc:
        log(f"bucket error: {exc}")
        return core.error(502, f"The feedback bucket could not be read with your AWS login: {exc}",
                          req, INBOX_METHODS)


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "feedback-local"
    protocol_version = "HTTP/1.1"

    def log_request(self, code="-", size="-"):
        # the method, path and status only: never headers or bodies, which
        # hold codes, nor the query string
        log(f"{self.command} {self.path.split('?')[0]} -> {code}")

    def log_message(self, fmt, *a):
        log(f"{self.command} {getattr(self, 'path', '').split('?')[0]}: {fmt % a}")

    def _send(self, out):
        status = int(out["statusCode"])
        body = out.get("body") or ""
        body = base64.b64decode(body) if out.get("isBase64Encoded") else body.encode("utf-8")
        self.send_response(status)
        for k, v in (out.get("headers") or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _go(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_REQUEST:
            # refused unread, as a Function URL does
            self.close_connection = True
            self._send(core.error(413, core.MSG_TOO_BIG))
            return
        raw = self.rfile.read(n) if n else b""
        path, _, query = self.path.partition("?")
        headers = {k.lower(): v for k, v in self.headers.items()}
        if not CONFIG["trust_forwarded"]:
            # only test.py's own server takes a made-up address, to try the
            # per-address caps; this one is always the socket's. Both headers
            # the shared code reads an address from are dropped, since on
            # this server any caller could send them
            headers.pop("x-forwarded-for", None)
            headers.pop("cloudfront-viewer-address", None)
        event = {"version": "2.0", "rawPath": path, "rawQueryString": query, "headers": headers,
                 "requestContext": {"http": {"method": self.command, "path": path,
                                             "sourceIp": self.client_address[0]}},
                 "body": base64.b64encode(raw).decode("ascii") if raw else "", "isBase64Encoded": bool(raw)}
        try:
            out = route(event)
        except Exception as exc:   # noqa: BLE001
            log(f"error: {exc!r}")
            out = core.error(500, "Something went wrong. Try again in a minute.", core.Request(event))
        self._send(out)

    do_GET = do_HEAD = do_POST = do_PATCH = do_DELETE = do_OPTIONS = _go


def make_server(port, data, trust_forwarded=False, buckets=(DEFAULT_BUCKET,), s3_factory=None):
    """The server, bound to 127.0.0.1 only. Points the shared code at the
    local folder and counters, and never at a bucket or table, so feedback
    sent here never reaches AWS. `buckets` are the ones source=aws reads,
    oldest first."""
    if isinstance(buckets, str):
        buckets = [buckets]
    for k in ("FEEDBACK_BUCKET", "COUNTER_TABLE"):
        os.environ.pop(k, None)
    os.environ["FEEDBACK_DIR"] = _ensure(data)
    os.environ["COUNTER_DIR"] = _ensure(os.path.join(data, "counters"))
    # No daily limits on this computer unless asked for (the user's rule for
    # local work, as for the drawing and routes tools): every local request
    # comes from 127.0.0.1, so the AWS caps would block a day of testing.
    # The wrong-code lockout stays.
    for k in ("FEEDBACK_PER_DAY", "FEEDBACK_ALL_PER_DAY", "FEEDBACK_MB_PER_DAY"):
        os.environ.setdefault(k, "1000000")
    CONFIG.update(data=data, buckets=list(buckets) or [DEFAULT_BUCKET], trust_forwarded=trust_forwarded,
                  s3_factory=s3_factory)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    CONFIG["port"] = srv.server_address[1]
    return srv


def load_codes(env_file):
    """The two codes from the env file, kept only as salted hashes in this
    process's environment. Unless the hashes were given already (test.py's
    own server uses made-up codes)."""
    if os.environ.get("CODE_HASH_FEEDBACK") or os.environ.get("CODE_HASH_FEEDBACK_ADMIN"):
        return
    if not os.path.isfile(env_file):
        log(f"No env file at {env_file}: every code will be refused.")
        return
    salt = secrets.token_hex(16)
    os.environ["CODE_SALT"] = salt
    for env_name, var in (("FEEDBACK_SITE_CODE", "CODE_HASH_FEEDBACK"),
                          ("VITE_FEEDBACK_ADMIN_CODE", "CODE_HASH_FEEDBACK_ADMIN")):
        v = envval.read(env_file, env_name)
        if v:
            os.environ[var] = hashlib.sha256((salt + v).encode("utf-8")).hexdigest()
        else:
            log(f"{env_name} is missing in the env file: that code will be refused.")
        v = None


def inbox_buckets(env=None, bucket_file=BUCKET_FILE, newest_only=False):
    """The buckets that source=aws reads, oldest first: FEEDBACK_INBOX_BUCKET
    or FEEDBACK_BUCKET alone when set, else every name deploy.sh listed in
    feedback_api/.bucket (only the last with newest_only), else the
    template's default. The file is what keeps feedback findable after
    `deploy.sh --remove`: the stack, and with it the stack's output naming
    the bucket, is gone then, but the bucket and its feedback stay, and a
    redeploy adds its new bucket below the old. Read before make_server,
    which takes FEEDBACK_BUCKET out of the environment so that feedback sent
    here never goes to S3."""
    env = os.environ if env is None else env
    for k in ("FEEDBACK_INBOX_BUCKET", "FEEDBACK_BUCKET"):
        if (env.get(k) or "").strip():
            return [env[k].strip()]
    names = []
    try:
        with open(bucket_file, encoding="utf-8") as fh:
            for line in fh:
                # what comes before any "#", as stack_input.bucket_on_line
                # reads it, so a name with a note after it still counts
                n = line.split("#", 1)[0].strip()
                if BUCKET_NAME.match(n) and n not in names:
                    names.append(n)
    except OSError:
        pass
    if not names:
        return [DEFAULT_BUCKET]
    return names[-1:] if newest_only else names


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--port", type=int, default=8788)
    ap.add_argument("--data", default=os.path.join(HERE, "local_data"),
                    help="where local feedback and counters are kept (gitignored)")
    ap.add_argument("--env-file", default=os.path.join(VIEWER, ".env.development.local"))
    ap.add_argument("--bucket", action="append", default=None,
                    help="a feedback bucket for source=aws to read; give it again for more (default: "
                         "FEEDBACK_INBOX_BUCKET, FEEDBACK_BUCKET, every bucket in feedback_api/.bucket, then "
                         + DEFAULT_BUCKET + ")")
    ap.add_argument("--newest-only", action="store_true",
                    help="read only the last bucket listed in feedback_api/.bucket")
    a = ap.parse_args()
    bad = [b for b in a.bucket or [] if not BUCKET_NAME.match(b)]
    if bad:
        ap.error(f"not a bucket name: {bad[0]!r}")
    buckets = a.bucket or inbox_buckets(newest_only=a.newest_only)
    load_codes(a.env_file)
    srv = make_server(a.port, os.path.abspath(a.data), buckets=buckets)
    tool = "boto3" if isinstance(default_s3(buckets[0]), Boto3S3) else "the aws tool"
    log(f"Feedback on http://127.0.0.1:{CONFIG['port']} (folder {CONFIG['data']}; source=aws reads "
        f"{', '.join('s3://' + b for b in buckets)} with {tool})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
