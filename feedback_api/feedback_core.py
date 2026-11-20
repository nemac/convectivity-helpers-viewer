"""
What the feedback Lambda function and the local server share
=============================================================
feedback_lambda.py (on AWS) and local_server.py (on this Mac) take tester
feedback through the same code, so a rule tried locally is the rule on AWS:

  * who may call: a page whose Origin is https://nemac.org or any
    https://<name>.nemac.org (any depth, https only, no port), or the dev
    server at http://localhost:5190 or http://127.0.0.1:5190. Every other
    origin, and a request with no Origin, gets 403 and no CORS headers.
    CloudFront runs the same rule before the function is called
    (template.yml, OriginGate), so most refused requests never reach it;
  * the testers' code, kept only as a salted SHA-256 hash and compared in
    constant time. A wrong code is answered at once, and after
    WRONG_CODES_PER_WINDOW wrong codes from one address in 10 minutes that
    address gets 429 without its code being checked. After
    WRONG_CODES_ALL_PER_WINDOW wrong codes from everyone together in 10
    minutes, every code check is refused until the window ends, since one
    person with many addresses (an IPv6 /48 holds 65,536 /64s) could
    otherwise keep guessing;
  * an end date: feedback is taken only for a while. After the end of
    FEEDBACK_ENDS_ON (a day, US Eastern) POST answers 410 with a thank-you,
    and GET /health says when it ended;
  * daily caps (days are US Eastern): items per address, items and megabytes
    for everyone together. An IPv6 address counts by its /64, since one home
    is usually handed a whole /64 and could otherwise change address for
    every request;
  * the checks on what is sent: text lengths, a JPEG screenshot under
    1.5 MB, safe ids, the viewer's address cleaned of any feedback= part,
    and an optional context (a drawn area or a set of routes) of 300 KB at
    most, kept as sent.

Counters live in a DynamoDB table on AWS (COUNTER_TABLE) and in JSON files
in a folder locally (COUNTER_DIR). Items go to S3 on AWS (FEEDBACK_BUCKET)
and to a folder locally (FEEDBACK_DIR). Standard library only, except boto3,
which Lambda provides and which is imported only when a table or bucket is
named.

Environment (read at call time, so a test can change it):
    CODE_SALT, CODE_HASH_FEEDBACK     the testers' code; unset refuses everyone
    CODE_HASH_FEEDBACK_ADMIN          the dev inbox's code. Never set on AWS;
                                      locally it also opens the inbox routes
                                      and may send feedback from localhost
    ALLOWED_DOMAIN                    default nemac.org
    ALLOWED_LOCAL_ORIGINS             default http://localhost:5190,http://127.0.0.1:5190
                                      ("none" allows no dev server)
    FEEDBACK_PER_DAY                  items one address may send a day (200)
    FEEDBACK_ALL_PER_DAY              items everyone together may send a day (1000)
    FEEDBACK_MB_PER_DAY               megabytes everyone together may send a day (100)
    WRONG_CODES_PER_WINDOW            wrong codes per address per 10 minutes (10)
    WRONG_CODES_ALL_PER_WINDOW        wrong codes from everyone per 10 minutes (100)
    FEEDBACK_ENDS_ON                  YYYY-MM-DD, the last day feedback is taken
                                      (US Eastern); unset means no end. A value
                                      that is not a date counts as ended
    SERVICE_ON                        "false" makes POST answer 503
    COUNTER_TABLE or COUNTER_DIR      where the counters are
    FEEDBACK_BUCKET or FEEDBACK_DIR   where the items are
"""

import base64
import binascii
import datetime as dt
import fcntl
import glob
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import time
import uuid

try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:   # no time zone data: a fixed offset (standard time) is close enough for a daily cap
    EASTERN = dt.timezone(dt.timedelta(hours=-5))

WRONG_CODE_WINDOW_S = 600
FEEDBACK_ID = re.compile(r"^[0-9a-f]{32}$")
TESTER_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
KINDS = ("words", "comment")
MAX_TEXT = 4000          # a comment, a reason, a note
MAX_WORDS = 8000         # original and suggested words: room for a long paragraph of a methods note
MAX_SHOT = 1_500_000     # screenshot bytes, decoded
MAX_CONTEXT = 300_000    # item.context as compact JSON in UTF-8: a drawn area or a set of routes
MAX_CONTEXT_DEPTH = 12   # objects and lists inside one another; a GeoJSON MultiPolygon in a
                         # FeatureCollection inside the context is 9 deep
MAX_CONTEXT_KEY = 200    # characters in one name inside the context
CONTEXT_TYPES = ("drawn_hazard", "routes")
# The whole request: a full-size screenshot in base64 (2,000,000), the text
# fields with room for escaping, and a full-size context
MAX_BODY = 2_600_000 + MAX_CONTEXT

MSG_ORIGIN = "This service only answers pages on nemac.org."
MSG_CODE = "That feedback code is not right."
MSG_LOCKED = "Too many wrong feedback codes were tried from this connection. Try again in 10 minutes."
MSG_LOCKED_ALL = "Too many wrong feedback codes were tried lately. Try again in 10 minutes."
MSG_ENDED = "Feedback has ended. Thank you for your help."
MSG_READ = "Something was wrong with what was sent. Please try again."
MSG_OFF = "Feedback is turned off for now."
MSG_TOO_BIG = "This is too large to send. Try again without the screenshot."
MSG_SHOT_BIG = "The screenshot is too large to send. Try again without it."
MSG_SHOT_JPEG = "Send the screenshot as a JPEG picture."
MSG_ALL_DAY = "No more feedback can be taken today. Try again after midnight, Eastern time."
MSG_CONTEXT = "The drawn area or routes sent with this could not be read. Please try again."
MSG_CONTEXT_BIG = "The drawn area or routes sent with this are too large to keep."
ADMIN_HEADER = "x-feedback-admin"


def _num(name, default, cast=int):
    try:
        return cast(os.environ.get(name, "") or default)
    except ValueError:
        return cast(default)


def service_on():
    return os.environ.get("SERVICE_ON", "true").strip().lower() not in ("false", "0", "no", "off")


# ---------------------------------------------------------------- origins

def _domain():
    return (os.environ.get("ALLOWED_DOMAIN") or "nemac.org").strip().lower().strip(".")


def local_origins():
    raw = os.environ.get("ALLOWED_LOCAL_ORIGINS", "http://localhost:5190,http://127.0.0.1:5190")
    if raw.strip().lower() == "none":
        return []
    return [o.strip().lower() for o in raw.split(",") if o.strip()]


_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"


def origin_kind(origin):
    """"site" for https://nemac.org or https://<any>.nemac.org, "local" for
    an allowed dev server, None for anything else. The whole origin must
    match: scheme, host and nothing after it, so https://evil-nemac.org,
    https://nemac.org.evil.com, http://x.nemac.org and https://x.nemac.org:8443
    are all refused. Browsers send origins in lower case; matching ignores
    case so a hand-made request cannot slip through on case alone."""
    if not isinstance(origin, str) or not origin or len(origin) > 300:
        return None
    o = origin.lower()
    if o in local_origins():
        return "local"
    pat = r"https://(?:" + _LABEL + r"\.)*" + re.escape(_domain())
    return "site" if re.fullmatch(pat, o) else None


# ---------------------------------------------------------------- requests

class Request:
    """A Lambda Function URL event (version 2.0), reduced to what is used.
    local_server.py builds the same event, so both read requests one way."""

    def __init__(self, event):
        self.headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
        self.origin = self.headers.get("origin", "")
        http = (event.get("requestContext") or {}).get("http") or {}
        self.source_ip = http.get("sourceIp") or ""
        self.method = (http.get("method") or "GET").upper()
        self.path = "/" + (event.get("rawPath") or http.get("path") or "/").strip("/")
        body = event.get("body") or ""
        if body and event.get("isBase64Encoded"):
            try:
                body = base64.b64decode(body).decode("utf-8")
            except Exception:   # noqa: BLE001  (unreadable is answered as unreadable, below)
                body = "\0"
        self.body = body
        self.query = event.get("rawQueryString") or ""
        self.kind = origin_kind(self.origin)
        self.site = self.kind == "site"
        self.local = self.kind == "local"
        self.allowed = self.kind is not None

    def json(self):
        try:
            out = json.loads(self.body or "{}")
        except (ValueError, RecursionError):
            # RecursionError: a body of lists inside lists thousands deep,
            # which is unreadable rather than a fault of this server
            return None
        return out if isinstance(out, dict) else None

    def client_ip(self):
        """The sender's address. Behind CloudFront it is read from
        CloudFront-Viewer-Address ("<ip>:<port>"), which CloudFront sets
        itself from the connection it was handed, and which template.yml's
        origin request policy forwards. Keying on it does not depend on how
        the Function URL treats X-Forwarded-For: if that header were replaced
        rather than added to, every sender would share a CloudFront edge's
        address, and one person could lock out every tester there.

        Only when that header is missing: the last X-Forwarded-For entry,
        which CloudFront adds (anything before it was sent by the sender and
        may be made up), with the Function URL's own copy of CloudFront's
        address dropped. Locally it is the socket's address, since
        local_server.py removes both headers from what a caller sends."""
        cva = self.headers.get("cloudfront-viewer-address", "").strip()
        if cva:
            # IPv6 comes without brackets ("2001:db8::1:443"), so the port is
            # whatever follows the last colon
            ip = cva.rsplit(":", 1)[0].strip("[]") if ":" in cva else cva
            try:
                return str(ipaddress.ip_address(ip))
            except ValueError:
                pass
        xff = [p.strip() for p in self.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if xff and xff[-1] == self.source_ip and len(xff) > 1:
            xff.pop()
        return xff[-1] if xff else (self.source_ip or "unknown")

    def param(self, name):
        from urllib.parse import parse_qs
        v = parse_qs(self.query, keep_blank_values=True).get(name)
        return v[0] if v else None


# ---------------------------------------------------------------- replies

def dumps(obj):
    return json.dumps(obj, separators=(",", ":"), allow_nan=False)


def cors_headers(req, methods="GET, POST, OPTIONS"):
    """CORS headers that echo an allowed origin, and none for any other, so
    a page elsewhere cannot read the answer even when it reaches us."""
    if req is None or not req.allowed:
        return {}
    return {"Access-Control-Allow-Origin": req.origin,
            "Access-Control-Allow-Headers": f"content-type, x-amz-content-sha256, {ADMIN_HEADER}",
            "Access-Control-Allow-Methods": methods,
            "Access-Control-Max-Age": "600",
            "Vary": "Origin"}


def reply(status, body, req=None, methods="GET, POST, OPTIONS"):
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store",
               "X-Content-Type-Options": "nosniff", **cors_headers(req, methods)}
    return {"statusCode": status, "headers": headers, "body": "" if status == 204 else dumps(body)}


def reply_bytes(status, data, content_type, req=None, filename=None, methods="GET, POST, OPTIONS"):
    """A binary reply (a screenshot, on the local server's inbox). nosniff
    keeps a browser from reading it as anything but its type, since only the
    first bytes were checked when it was taken."""
    headers = {"Content-Type": content_type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
               **({"Content-Disposition": f'inline; filename="{filename}"'} if filename else {}),
               **cors_headers(req, methods)}
    return {"statusCode": status, "headers": headers, "isBase64Encoded": True,
            "body": base64.b64encode(data).decode("ascii")}


def error(status, message, req=None, methods="GET, POST, OPTIONS"):
    return reply(status, {"error": message}, req, methods)


# ---------------------------------------------------------------- addresses and codes

def addr_key(ip):
    """The part of an address that names one connection: an IPv6 address by
    its /64, an IPv4 address (or one written IPv4-in-IPv6) whole."""
    try:
        a = ipaddress.ip_address(ip.strip())
    except ValueError:
        return ip
    if a.version == 6:
        if a.ipv4_mapped:
            return str(a.ipv4_mapped)
        return str(ipaddress.ip_network(f"{a}/64", strict=False))
    return str(a)


def addr_hash(req):
    """The address as a salted hash, the only form in which one is kept."""
    return hashlib.sha256((os.environ.get("CODE_SALT", "") + addr_key(req.client_ip())).encode()).hexdigest()[:20]


def _window():
    return int(time.time() // WRONG_CODE_WINDOW_S)


def _bad_code_key(req):
    return f"badcode#{addr_hash(req)}#{_window()}"


def _bad_code_all_key():
    # "all" can never be an address hash, which is 20 hex digits
    return f"badcode#all#{_window()}"


def locked_out(req):
    """The message to refuse with when too many wrong codes were sent
    lately, by everyone together or from this address; None otherwise. A
    counter failure never locks anyone out."""
    try:
        if int(counters().get(_bad_code_all_key()).get("n", 0)) >= _num("WRONG_CODES_ALL_PER_WINDOW", 100):
            return MSG_LOCKED_ALL
        if int(counters().get(_bad_code_key(req)).get("n", 0)) >= _num("WRONG_CODES_PER_WINDOW", 10):
            return MSG_LOCKED
    except Exception as exc:   # noqa: BLE001
        print(f"lockout check failed: {exc!r}")
    return None


def code_ok(code, req, which="feedback"):
    """True when `code` is the testers' code (which="feedback") or the dev
    inbox's code (which="admin", localhost origins only), compared as salted
    hashes in constant time."""
    salt = os.environ.get("CODE_SALT", "")
    if which == "admin":
        want = os.environ.get("CODE_HASH_FEEDBACK_ADMIN") if req.local else None
    else:
        want = os.environ.get("CODE_HASH_FEEDBACK") if req.allowed else None
    if not want or not salt or not isinstance(code, str) or not code or len(code) > 200:
        return False
    got = hashlib.sha256((salt + code).encode("utf-8")).hexdigest()
    return hmac.compare_digest(got, want)


def wrong_code(req, methods="GET, POST, OPTIONS"):
    """401 at once, counted against this address and against everyone."""
    for key in (_bad_code_key(req), _bad_code_all_key()):
        try:
            counters().add(key, {"n": 1})
        except Exception as exc:   # noqa: BLE001
            print(f"wrong-code count failed: {exc!r}")
    return error(401, MSG_CODE, req, methods)


# ---------------------------------------------------------------- dates

def now_eastern():
    return dt.datetime.now(EASTERN)


def today():
    return now_eastern().date()


def utc_iso(t=None):
    t = t or dt.datetime.now(dt.timezone.utc)
    return t.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class _Bad:
    """FEEDBACK_ENDS_ON is set but is not a date."""


def ends_at():
    """When feedback stops being taken: midnight at the end of
    FEEDBACK_ENDS_ON, US Eastern, as an aware time; None when there is no
    end date; _Bad when the setting is not a date. deploy.sh and the
    template only let a real date through, so _Bad means something was
    changed by hand, and it is treated as ended: feedback is meant to be
    temporary, so a broken setting stops it rather than keeping it open."""
    raw = (os.environ.get("FEEDBACK_ENDS_ON") or "").strip()
    if not raw:
        return None
    try:
        day = dt.date.fromisoformat(raw)
    except ValueError:
        print(f"FEEDBACK_ENDS_ON is not a date: {raw[:40]!r}")
        return _Bad
    nxt = day + dt.timedelta(days=1)
    return dt.datetime(nxt.year, nxt.month, nxt.day, tzinfo=EASTERN)


def has_ended(when=None):
    end = ends_at()
    if end is None:
        return False
    if end is _Bad:
        return True
    return (when or dt.datetime.now(dt.timezone.utc)) >= end


# ---------------------------------------------------------------- counters

class LocalCounters:
    """Counters in one JSON file, locked while it is changed, so two requests
    at once on the local server cannot lose a count."""

    def __init__(self, folder):
        os.makedirs(folder, exist_ok=True)
        self.path = os.path.join(folder, "counters.json")

    def _read(self):
        try:
            with open(self.path) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}

    def get(self, key):
        return dict(self._read().get(key, {}))

    def _update(self, fn):
        with open(self.path + ".lock", "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                st = self._read()
                res = fn(st)
                tmp = self.path + ".tmp"
                with open(tmp, "w") as fh:
                    json.dump(st, fh, indent=1)
                os.replace(tmp, self.path)
                return res
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)

    def take(self, key, want):
        """Add each field's increment if every field stays within its limit.
        `want` is {field: (increment, limit)}. Returns (taken, counts)."""
        def fn(st):
            row = st.setdefault(key, {})
            cur = {f: row.get(f, 0) for f in want}
            if any(inc > 0 and cur[f] + inc > lim for f, (inc, lim) in want.items()):
                return False, cur
            for f, (inc, _) in want.items():
                row[f] = row.get(f, 0) + inc
            return True, {f: row[f] for f in want}
        return self._update(fn)

    def add(self, key, fields):
        def fn(st):
            row = st.setdefault(key, {})
            for f, v in fields.items():
                row[f] = row.get(f, 0) + v
        self._update(fn)


class DynamoCounters:
    """Counters in one DynamoDB table (partition key "pk"), changed with
    atomic ADD under a condition, so a cap holds with five calls at once.
    Rows expire through the table's TTL attribute "expires_at": wrong-code
    rows after a day, day rows after 40."""

    def __init__(self, table):
        import boto3
        self.table = table
        self.db = boto3.client("dynamodb")

    @staticmethod
    def _ttl(key):
        return str(int(time.time()) + (1 if key.startswith("badcode#") else 40) * 86400)

    def get(self, key):
        item = self.db.get_item(TableName=self.table, Key={"pk": {"S": key}},
                                ConsistentRead=True).get("Item") or {}
        return {k: int(float(v["N"])) for k, v in item.items() if "N" in v and k != "expires_at"}

    def take(self, key, want):
        names, vals, adds, conds = {"#ttl": "expires_at"}, {":ttl": {"N": self._ttl(key)}}, [], []
        for i, (f, (inc, lim)) in enumerate(want.items()):
            names[f"#f{i}"] = f
            vals[f":i{i}"] = {"N": str(inc)}
            adds.append(f"#f{i} :i{i}")
            if inc > 0:
                vals[f":l{i}"] = {"N": str(lim - inc)}
                conds.append(f"(attribute_not_exists(#f{i}) OR #f{i} <= :l{i})")
        kw = {"ConditionExpression": " AND ".join(conds)} if conds else {}
        try:
            out = self.db.update_item(
                TableName=self.table, Key={"pk": {"S": key}},
                UpdateExpression="SET #ttl = :ttl ADD " + ", ".join(adds),
                ExpressionAttributeNames=names, ExpressionAttributeValues=vals,
                ReturnValues="ALL_NEW", **kw)
        except self.db.exceptions.ConditionalCheckFailedException:
            cur = self.get(key)
            return False, {f: cur.get(f, 0) for f in want}
        attrs = out.get("Attributes") or {}
        return True, {f: int(float(attrs.get(f, {"N": "0"})["N"])) for f in want}

    def add(self, key, fields):
        names, vals, adds = {"#ttl": "expires_at"}, {":ttl": {"N": self._ttl(key)}}, []
        for i, (f, v) in enumerate(fields.items()):
            names[f"#f{i}"] = f
            vals[f":v{i}"] = {"N": str(v)}
            adds.append(f"#f{i} :v{i}")
        self.db.update_item(TableName=self.table, Key={"pk": {"S": key}},
                            UpdateExpression="SET #ttl = :ttl ADD " + ", ".join(adds),
                            ExpressionAttributeNames=names, ExpressionAttributeValues=vals)


_COUNTERS = {}


def counters():
    """The counters for the current settings. Keyed by them, so a test that
    points COUNTER_DIR somewhere new gets fresh counters."""
    table, folder = os.environ.get("COUNTER_TABLE"), os.environ.get("COUNTER_DIR", "/tmp/feedback_counters")
    key = ("table", table) if table else ("dir", folder)
    if key not in _COUNTERS:
        _COUNTERS[key] = DynamoCounters(table) if table else LocalCounters(folder)
    return _COUNTERS[key]


# ---------------------------------------------------------------- where items go

class FolderStore:
    """Items in a folder: <folder>/feedback/<id>.json and .jpg. Each file is
    written to a temporary name and moved into place, so a reader never sees
    half of one."""

    def __init__(self, folder):
        self.folder = folder

    def _p(self, key):
        p = os.path.join(self.folder, key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def put(self, key, data, content_type):
        p = self._p(key)
        with open(p + ".tmp", "wb") as fh:
            fh.write(data)
        os.replace(p + ".tmp", p)


class BucketStore:
    """Items in the feedback bucket. The function's role may only put objects
    under feedback/, so this has no reads at all."""

    def __init__(self, bucket):
        import boto3
        self.bucket = bucket
        self.s3 = boto3.client("s3")

    def put(self, key, data, content_type):
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type,
                           CacheControl="no-store")


_STORES = {}


def store():
    bucket, folder = os.environ.get("FEEDBACK_BUCKET"), os.environ.get("FEEDBACK_DIR", "/tmp/feedback_local")
    key = ("bucket", bucket) if bucket else ("dir", folder)
    if key not in _STORES:
        _STORES[key] = BucketStore(bucket) if bucket else FolderStore(folder)
    return _STORES[key]


# ---------------------------------------------------------------- what is sent

def clean_hash(v):
    """The viewer's address after "#", as kept with an item: it must start
    with "#", and any feedback= part is dropped, so a code that a page
    failed to take out of its address is never stored. Returns False when
    it does not start with "#"."""
    if v is None:
        return None
    if not v.startswith("#"):
        return False
    from urllib.parse import parse_qsl, unquote, urlencode
    keep = [(k, x) for k, x in parse_qsl(v[1:], keep_blank_values=True)
            if unquote(k).strip().lower() != "feedback"]
    return ("#" + urlencode(keep)) if keep else None


def clean_text(v, limit, what, keep_lines=True):
    """(text or None, message or None). Control characters other than new
    lines and tabs are dropped; None and "" both mean nothing was given."""
    if v is None:
        return None, None
    if not isinstance(v, str):
        return None, MSG_READ
    v = v.replace("\r\n", "\n").replace("\r", "\n")
    v = (re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", v) if keep_lines
         else re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", v)))
    v = v.strip()
    if len(v) > limit:
        return None, f"Keep {what} to {limit:,} characters or fewer."
    return (v or None), None


def _num_in(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi


def read_item(item):
    """(the item as stored, without id and times, or None; message or None)."""
    if not isinstance(item, dict):
        return None, MSG_READ
    kind = item.get("kind")
    if kind not in KINDS:
        return None, MSG_READ
    out = {"kind": kind}
    name, msg = clean_text(item.get("name"), 80, "your name", keep_lines=False)
    if msg:
        return None, msg
    if not name:
        return None, "Add your name first."
    out["name"] = name
    tid = item.get("tester_id")
    if tid is not None and not (isinstance(tid, str) and TESTER_ID.match(tid)):
        return None, MSG_READ
    out["tester_id"] = tid
    for key, limit in (("tab", 40), ("url_hash", 2000)):
        out[key], msg = clean_text(item.get(key), limit, "the address", keep_lines=False)
        if msg:
            return None, MSG_READ
    out["url_hash"] = clean_hash(out["url_hash"])
    if out["url_hash"] is False:
        return None, MSG_READ

    t = item.get("target")
    if not isinstance(t, dict):
        return None, MSG_READ
    target = {}
    for key, limit in (("area", 300), ("selector", 2000), ("doc", 200)):
        target[key], msg = clean_text(t.get(key), limit, "the place", keep_lines=False)
        if msg:
            return None, MSG_READ
    if not target["area"]:
        return None, MSG_READ
    ll = t.get("lnglat")
    if ll is not None:
        if isinstance(ll, dict):
            ll = [ll.get("lng", ll.get("lon")), ll.get("lat")]
        if not (isinstance(ll, (list, tuple)) and len(ll) == 2
                and _num_in(ll[0], -180, 180) and _num_in(ll[1], -90, 90)):
            return None, MSG_READ
        ll = [round(float(ll[0]), 6), round(float(ll[1]), 6)]
    target["lnglat"] = ll
    z = t.get("zoom")
    if z is not None and not _num_in(z, 0, 24):
        return None, MSG_READ
    target["zoom"] = None if z is None else round(float(z), 2)
    out["target"] = target

    for key, limit, what in (("original", MAX_WORDS, "the original words"),
                             ("suggested", MAX_WORDS, "the suggested words"),
                             ("why", MAX_TEXT, "the reason"), ("text", MAX_TEXT, "the comment")):
        out[key], msg = clean_text(item.get(key), limit, what)
        if msg:
            return None, msg
    if kind == "words":
        if not out["original"]:
            return None, MSG_READ
        if not out["suggested"]:
            return None, "Type the words you suggest first."
        if out["suggested"] == out["original"]:
            return None, "The suggested words are the same as the original. Change them first."
        out["text"] = None
    else:
        if not out["text"]:
            return None, "Write a comment first."
        out["suggested"] = None   # a comment may keep the element's words in `original`, for context

    vp = item.get("viewport")
    if vp is not None:
        if not (isinstance(vp, dict) and _num_in(vp.get("w"), 0, 100000) and _num_in(vp.get("h"), 0, 100000)):
            return None, MSG_READ
        vp = {"w": int(vp["w"]), "h": int(vp["h"])}
    out["viewport"] = vp
    out["context"], msg = read_context(item.get("context"))
    if msg:
        return None, msg
    return out, None


def _context_leaf_ok(v):
    """Strings and plain numbers only. JSON has no integers too big for a
    browser, so neither may a context: past 2**53 a number would come back
    changed. NaN and Infinity (which Python's reader takes) are refused
    because they are not JSON and could not be written back out."""
    if isinstance(v, str):
        return True
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return -(2 ** 53) <= v <= 2 ** 53
    return isinstance(v, float) and math.isfinite(v)


def read_context(ctx):
    """(the context as sent, or None; message or None). item.context is
    what the tester had open when they wrote: a drawn area (type
    "drawn_hazard") or a set of alternate routes (type "routes"), so the
    inbox can show it again after the drawn area or route link has expired.

    It is kept exactly as sent and never read for meaning, so the only
    checks are on its shape: an object with a known type, objects and lists
    no more than MAX_CONTEXT_DEPTH inside one another, strings and numbers
    as the only values (no true, false or null, which keeps the contract
    small), and MAX_CONTEXT bytes of JSON at most. Walked with a list
    rather than by recursion, so a deep one cannot exhaust the stack."""
    if ctx is None:
        return None, None
    if not isinstance(ctx, dict) or ctx.get("type") not in CONTEXT_TYPES:
        return None, MSG_CONTEXT
    todo = [(ctx, 1)]
    while todo:
        node, depth = todo.pop()
        if depth > MAX_CONTEXT_DEPTH:
            return None, MSG_CONTEXT
        if isinstance(node, dict):
            for k, v in node.items():
                if len(k) > MAX_CONTEXT_KEY:
                    return None, MSG_CONTEXT
                if isinstance(v, (dict, list)):
                    todo.append((v, depth + 1))
                elif not _context_leaf_ok(v):
                    return None, MSG_CONTEXT
        else:
            for v in node:
                if isinstance(v, (dict, list)):
                    todo.append((v, depth + 1))
                elif not _context_leaf_ok(v):
                    return None, MSG_CONTEXT
    # measured close to the way the browser's JSON.stringify writes it
    # (compact, letters outside ASCII as themselves). Numbers can differ by a
    # byte: Python writes 1.5e-07 where JavaScript writes 1.5e-7 (and 1e-05
    # where it writes 0.00001), so the viewer aims 2 KB under the limit.
    # surrogatepass so a lone surrogate is measured, not a crash
    size = len(json.dumps(ctx, separators=(",", ":"), ensure_ascii=False).encode("utf-8", "surrogatepass"))
    if size > MAX_CONTEXT:
        return None, MSG_CONTEXT_BIG
    return ctx, None


def read_screenshot(s):
    """(JPEG bytes or None, status, message): a base64 JPEG, with or
    without a data: prefix."""
    if s is None or s == "":
        return None, None, None
    if not isinstance(s, str):
        return None, 400, MSG_READ
    if s.startswith("data:"):
        head, _, s = s.partition(",")
        if not head.startswith("data:image/jpeg") or ";base64" not in head:
            return None, 400, MSG_SHOT_JPEG
    if len(s) > MAX_SHOT * 4 // 3 + 8:
        return None, 413, MSG_SHOT_BIG
    try:
        data = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        return None, 400, MSG_READ
    if len(data) > MAX_SHOT:
        return None, 413, MSG_SHOT_BIG
    if not data.startswith(b"\xff\xd8\xff"):
        return None, 400, MSG_SHOT_JPEG
    return data, None, None


# ---------------------------------------------------------------- the two routes everyone may call

def health_body():
    """What GET /health (and /limits) answers: whether feedback is taken,
    when it ends (ends_at, an ISO time in UTC, or None for no end) and the
    size limits, so a page can check before it sends. The viewer reads
    ends_at once a visit and hides the Feedback switch after it."""
    end = ends_at()
    ended = has_ended()
    return {"ok": True, "service": "feedback", "on": service_on() and not ended, "ended": ended,
            "ends_at": utc_iso(end) if isinstance(end, dt.datetime) else None,
            "ends_on": (os.environ.get("FEEDBACK_ENDS_ON") or "").strip() or None,
            "max_text": MAX_TEXT, "max_words": MAX_WORDS, "max_screenshot_bytes": MAX_SHOT,
            "max_context_bytes": MAX_CONTEXT}


def post_feedback(req):
    """POST /feedback: {code, item, screenshot?} -> 201 {id, created_at,
    has_screenshot}. The order matters: size first and the lockout before
    the body is parsed, so a refused sender costs as little as possible.
    After the end date, 410 before anything else is looked at, so a
    finished run never counts a wrong code or a cap again."""
    if has_ended():
        return error(410, MSG_ENDED, req)
    if len(req.body or "") > MAX_BODY:
        return error(413, MSG_TOO_BIG, req)
    if not service_on():
        return error(503, MSG_OFF, req)
    locked = locked_out(req)
    if locked:
        return error(429, locked, req)
    body = req.json()
    if body is None:
        return error(400, MSG_READ, req)
    code = body.get("code")
    # The inbox code is accepted from localhost only where it is configured,
    # which is the local server; on AWS it is never set.
    if not (code_ok(code, req) or code_ok(code, req, "admin")):
        return wrong_code(req)
    item, msg = read_item(body.get("item"))
    if msg:
        return error(400, msg, req)
    shot, status, msg = read_screenshot(body.get("screenshot"))
    if msg:
        return error(status, msg, req)
    day = today().isoformat()
    per_day = _num("FEEDBACK_PER_DAY", 200)
    ok, _ = counters().take(f"feedback#day#{day}#{addr_hash(req)}", {"posts": (1, per_day)})
    if not ok:
        return error(429, f"This connection has sent {per_day:,} pieces of feedback today, the most "
                          "allowed. Try again after midnight, Eastern time.", req)
    # everyone together, so what the bucket can gain in a day has a ceiling
    # however many addresses send
    size = len(shot or b"") + len(dumps(item)) + 400
    ok, _ = counters().take(f"feedback#all#day#{day}",
                            {"posts": (1, _num("FEEDBACK_ALL_PER_DAY", 1000)),
                             "bytes": (size, int(_num("FEEDBACK_MB_PER_DAY", 100, float) * 1_000_000))})
    if not ok:
        return error(429, MSG_ALL_DAY, req)
    fid = uuid.uuid4().hex
    st = store()
    if shot:
        st.put(f"feedback/{fid}.jpg", shot, "image/jpeg")
    rec = {"id": fid, **item, "created_at": utc_iso(), "status": "open", "done_at": None, "note": None,
           "has_screenshot": bool(shot), "origin": req.origin.lower()}
    # written last: an item is complete once its JSON is there
    st.put(f"feedback/{fid}.json", dumps(rec).encode("utf-8"), "application/json")
    print(json.dumps({"event": "feedback", "id": fid, "kind": item["kind"], "shot_bytes": len(shot or b"")}))
    return reply(201, {"id": fid, "created_at": rec["created_at"], "has_screenshot": rec["has_screenshot"]}, req)
