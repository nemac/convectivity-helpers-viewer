"""
Checks of the feedback Lambda function and its local server
===========================================================
    python3 feedback_api/test.py            own, deploy and aws below: servers inside this
                                            process only, never the one on 8788, never AWS
    python3 feedback_api/test.py own        a second server inside this process, on a free
                                            port, with made-up codes, low caps and a throwaway
                                            folder: the caps per address (IPv6 by its /64) and
                                            for everyone, the lockout, turned off, sizes, a
                                            drawn area or routes kept with an item, the origin
                                            rule in Python and in the CloudFront Function (with
                                            node, if installed), and that the Lambda function
                                            has no read routes, and Delete and Clear in the
                                            inbox (local folder only, never a bucket). Every
                                            wrong-code check is here, with made-up codes and
                                            made-up addresses
    python3 feedback_api/test.py deploy     what deploy.sh hands to AWS (stack_input.py), the end
                                            date and bucket settings in template.yml, the list
                                            of kept buckets and where the local inbox finds
                                            them, and deploy.sh itself run against a stand-in
                                            for the aws tool. Never calls AWS.
    python3 feedback_api/test.py aws        the inbox's source=aws against fake buckets (one,
                                            and several kept by earlier removes), and the aws
                                            command line path with a stand-in for the tool.
                                            Nothing here ever calls AWS.
    python3 feedback_api/test.py running    only when named: the server already running on
                                            127.0.0.1:8788 (FEEDBACK_BASE to point elsewhere),
                                            with the real codes: origins, what is taken and
                                            refused, the inbox on the local folder, done marks.
                                            Removes the items it adds. Sends no wrong code at
                                            all, so running it any number of times never moves
                                            this Mac toward that server's lockout (10 wrong
                                            codes in 10 minutes would refuse the viewer too).
    python3 feedback_api/test.py --live [--post]
                                            the deployed function: health, the origin rule,
                                            no inbox. --post also sends one item with the
                                            testers' code and prints how to remove it.
                                            Only with the user's approval.

The real codes are read from the viewer's .env.development.local at run
time (or FEEDBACK_CODE and FEEDBACK_ADMIN_CODE in the environment) and are
never printed or written. Standard library only.
"""

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
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import envval  # noqa: E402

LOCAL = "http://localhost:5190"
LOCAL2 = "http://127.0.0.1:5190"
SITE = "https://road-network-connectivity.nemac.org"
OTHER = "https://example.com"
LIVE_BASE = "https://feedbackconnectivityviewer.nemac.org"
ENV_FILE = os.environ.get("ENV_FILE", os.path.join(VIEWER, ".env.development.local"))
RESULTS = []

# Every origin rule case, with whether it is allowed. The same list checks
# the Python rule and the CloudFront Function.
ORIGINS = [
    ("https://road-network-connectivity.nemac.org", True), ("https://nemac.org", True),
    ("https://a.b.nemac.org", True), ("HTTPS://X.NEMAC.ORG", True), (LOCAL, True), (LOCAL2, True),
    ("https://evil-nemac.org", False), ("https://nemac.org.evil.com", False), ("http://x.nemac.org", False),
    ("https://x.nemac.org:8443", False), ("https://x.nemac.org/", False), ("https://.nemac.org", False),
    ("https://x..nemac.org", False), ("https://-x.nemac.org", False), ("null", False), ("", False),
    ("http://localhost:5191", False), ("https://localhost:5190", False), ("https://x.nemac.org.", False),
    ("https://evil.com#.nemac.org", False), ("https://evil.com/.nemac.org", False), (None, False),
]


def code(env_name, env_file_name):
    """A code from the environment, else from the env file. Never printed."""
    v = os.environ.get(env_name) or (envval.read(ENV_FILE, env_file_name) if os.path.isfile(ENV_FILE) else None)
    if not v:
        sys.exit(f"{env_name} is not set and {env_file_name} is not in {ENV_FILE}")
    return v


# Headers stay as the HTTPMessage, whose .get ignores case: through
# CloudFront the Lambda function URL sends them in lower case.
def call(base, method, path, origin=None, body=None, headers=None, raw_body=None, sha=False):
    """(status, headers, parsed JSON or None, raw bytes)."""
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    h = {**({"Content-Type": "application/json"} if data is not None else {}), **(headers or {})}
    if origin:
        h["Origin"] = origin
    if sha and data is not None:   # what CloudFront's origin access control needs on a POST
        h["x-amz-content-sha256"] = hashlib.sha256(data).hexdigest()
    req = urllib.request.Request(base + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, hdrs, raw = r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, raw = e.code, e.headers, e.read()
    try:
        js = json.loads(raw) if raw and hdrs.get("Content-Type", "").startswith("application/json") else None
    except ValueError:
        js = None
    return status, hdrs, js, raw


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"{'OK ' if ok else 'BAD'} {label}" + (f"  | {detail}" if detail and not ok else ""), flush=True)


def expect(base, label, method, path, origin, body, want, cors=None, headers=None, raw_body=None, sha=False):
    status, hdrs, js, raw = call(base, method, path, origin, body, headers, raw_body, sha)
    acao = hdrs.get("Access-Control-Allow-Origin")
    ok = status == want
    if cors is True:
        ok = ok and acao == origin
    if cors is False:
        ok = ok and acao is None
    msg = js.get("error") if isinstance(js, dict) else ""
    check(f"{label}: {status} (want {want})" + ("" if cors is None else ", CORS " + ("echoed" if cors else "none")),
          ok, f"{msg or ''} acao={acao}")
    return status, js


def tiny_jpeg(extra=200):
    """Bytes that start and end like a JPEG; only the start is checked."""
    return b"\xff\xd8\xff\xe0" + bytes(range(256)) * (extra // 256 + 1) + b"\xff\xd9"


FB_WORDS = {"kind": "words", "name": "Test checker", "tester_id": "feedback_test", "tab": "isolation",
            "url_hash": "#tab=isolation&hazard=flood_canton1&minutes=10",
            "target": {"area": "What the map shows", "selector": "[data-guide=what] p:nth-of-type(1)"},
            "original": "Places out of reach within a 10 minute drive",
            "suggested": "Places that can no longer be reached in a 10 minute drive",
            "why": "Says what is lost.", "viewport": {"w": 1440, "h": 900}}
FB_COMMENT = {"kind": "comment", "name": "Test checker", "tester_id": "feedback_test", "tab": "isolation",
              "url_hash": "#tab=isolation&hazard=flood_canton1",
              "target": {"area": "Map", "lnglat": [-82.8412, 35.5326], "zoom": 14.25},
              "text": "This road looks like it should be cut off.", "viewport": {"w": 1280, "h": 800}}


# What the viewer sends as item.context: the drawn area or the routes the
# tester had open. Made up; the server keeps them as sent and never reads
# them for meaning, so markup in a string stays plain text.
CTX_DRAWN = {"type": "drawn_hazard", "run_id": "a" * 32, "name": "Bridge on Main Street, ä and 東", "minutes": 10,
             "area": {"type": "Polygon", "coordinates": [[[-82.84, 35.53], [-82.83, 35.53], [-82.83, 35.54],
                                                          [-82.84, 35.53]]]},
             "counts": {"cut_off_buildings": 13, "in_hazard_buildings": 2, "closed_roads": 8, "feet": 1828.5},
             "note": "<b>kept as text</b>"}
CTX_ROUTES = {"type": "routes", "route_id": "b" * 32, "overture_id": "08b2a1072e7affff0200f3e0c2b1d4a6",
              "road": "Soco Road", "fewer_routes": 0,
              "routes": [{"n": 1, "miles": 3.2, "minutes": 7.5,
                          "line": {"type": "LineString", "coordinates": [[-83.1, 35.5], [-83.0, 35.6]]},
                          "steps": ["Turn left onto Main Street", "Keep right"]}]}


def nested(depth):
    """A context whose deepest list is `depth` objects and lists down,
    counting the context itself as 1."""
    v = 1
    for _ in range(depth - 1):
        v = [v]
    return {"type": "routes", "deep": v} if depth > 1 else {"type": "routes"}


def summary():
    print(f"\n{sum(RESULTS)} of {len(RESULTS)} checks passed", flush=True)


# ---------------------------------------------------------------- against the running server

def running_checks(base=None):
    base = base or os.environ.get("FEEDBACK_BASE", "http://127.0.0.1:8788")
    fc = code("FEEDBACK_CODE", "FEEDBACK_SITE_CODE")
    ac = code("FEEDBACK_ADMIN_CODE", "VITE_FEEDBACK_ADMIN_CODE")
    adm = {"x-feedback-admin": ac}
    jpg = tiny_jpeg()
    shot = base64.b64encode(jpg).decode()
    made = []
    E = lambda *a, **k: expect(base, *a, **k)   # noqa: E731

    print(f"== running server at {base}: who may call")
    _, js = E("GET /health, localhost", "GET", "/health", LOCAL, None, 200, cors=True)
    check("  says it is on, with the size limits", (js or {}).get("on") is True and (js or {}).get("max_screenshot_bytes"))
    check("  says whether and when feedback ends (no end date on this server)",
          "ends_at" in (js or {}) and (js or {}).get("ended") is False, json.dumps(js))
    E("GET /limits, the site", "GET", "/limits", SITE, None, 200, cors=True)
    E("GET /health, another nemac.org page", "GET", "/health", "https://data.nemac.org", None, 200, cors=True)
    for o in (OTHER, "https://evil-nemac.org", "https://nemac.org.evil.com", "http://road-network-connectivity.nemac.org"):
        E(f"GET /health, {o}", "GET", "/health", o, None, 403, cors=False)
    E("GET /health, no Origin", "GET", "/health", None, None, 403, cors=False)
    status, hdrs, _, _ = call(base, "OPTIONS", "/feedback", LOCAL)
    check(f"OPTIONS /feedback, localhost: {status} (want 204), allows PATCH, the inbox header and the body hash",
          status == 204 and hdrs.get("Access-Control-Allow-Origin") == LOCAL
          and "PATCH" in hdrs.get("Access-Control-Allow-Methods", "")
          and "x-feedback-admin" in hdrs.get("Access-Control-Allow-Headers", "")
          and "x-amz-content-sha256" in hdrs.get("Access-Control-Allow-Headers", ""))
    E("OPTIONS /feedback, evil-nemac.org", "OPTIONS", "/feedback", "https://evil-nemac.org", None, 403, cors=False)

    print("== running server: feedback taken")
    ok_body = {"code": fc, "item": FB_WORDS, "screenshot": shot}
    for label, origin, body in (
            ("words with a screenshot, the site, testers' code", SITE, ok_body),
            ("map comment, no screenshot, localhost, testers' code", LOCAL, {"code": fc, "item": FB_COMMENT}),
            ("comment, another nemac.org page, testers' code", "https://www.nemac.org", {"code": fc, "item": FB_COMMENT}),
            ("comment with a data: screenshot, 127.0.0.1, inbox code", LOCAL2,
             {"code": ac, "item": {**FB_COMMENT, "target": {"area": "Legend", "selector": "#legend"},
                                   "original": "Cut off completely or closed"},
              "screenshot": "data:image/jpeg;base64," + shot})):
        status, js = E(f"POST /feedback, {label}", "POST", "/feedback", origin, body, 201, cors=True)
        fid = (js or {}).get("id", "")
        if status == 201:
            made.append(fid)
        check(f"  a 32 digit id, has_screenshot {bool(body.get('screenshot'))}",
              bool(re.fullmatch(r"[0-9a-f]{32}", fid)) and (js or {}).get("has_screenshot") is bool(body.get("screenshot"))
              and (js or {}).get("created_at"))
    status, js = E("POST /feedback, an address holding feedback=<a code>", "POST", "/feedback", LOCAL,
                   {"code": fc, "item": {**FB_COMMENT, "url_hash": "#tab=pinch&feedback=xyz&zoom=9"}}, 201)
    hash_id = (js or {}).get("id")
    if hash_id:
        made.append(hash_id)

    print("== running server: feedback refused")
    for o in (OTHER, "https://evil-nemac.org", "https://nemac.org.evil.com", "http://x.nemac.org", None):
        E(f"POST /feedback, right code, from {o or 'no Origin'}", "POST", "/feedback", o, ok_body, 403, cors=False)
    # (wrong codes are tried only in `own`: each one here would count
    # against this Mac on the server the viewer uses)
    w, c = FB_WORDS, FB_COMMENT
    for label, over, want in [
            ("suggested words the same as the original", {"item": {**w, "suggested": w["original"]}}, 400),
            ("no suggested words", {"item": {**w, "suggested": "  "}}, 400),
            ("a word change with no original", {"item": {**w, "original": None}}, 400),
            ("a comment with no text", {"item": {**c, "text": ""}}, 400),
            ("no name", {"item": {**w, "name": " "}}, 400),
            ("an unknown kind", {"item": {**w, "kind": "bold"}}, 400),
            ("no place named", {"item": {**w, "target": {"selector": "p"}}}, 400),
            ("a map spot off the earth", {"item": {**c, "target": {"area": "Map", "lnglat": [-200, 35]}}}, 400),
            ("a zoom of 30", {"item": {**c, "target": {"area": "Map", "lnglat": [-82, 35], "zoom": 30}}}, 400),
            ("a bad tester id", {"item": {**w, "tester_id": "<script>"}}, 400),
            ("a 4,001 character comment", {"item": {**c, "text": "x" * 4001}}, 400),
            ("an 8,001 character suggestion", {"item": {**w, "suggested": "y" * 8001}}, 400),
            ("an 81 character name", {"item": {**w, "name": "n" * 81}}, 400),
            ("no item", {"item": None}, 400),
            ("a PNG screenshot", {"screenshot": base64.b64encode(b"\x89PNG\r\n\x1a\n" + jpg).decode()}, 400),
            ("a data:image/png screenshot", {"screenshot": "data:image/png;base64," + shot}, 400),
            ("a screenshot that is not base64", {"screenshot": "not base64 at all!"}, 400),
            ("a 1.6 MB screenshot", {"screenshot": base64.b64encode(tiny_jpeg(1_600_000)).decode()}, 413),
            ("an address that does not start with #", {"item": {**w, "url_hash": "tab=isolation"}}, 400)]:
        E(f"POST /feedback, {label}", "POST", "/feedback", LOCAL, {**ok_body, **over}, want, cors=True)
    E("POST /feedback, a body that is not JSON", "POST", "/feedback", LOCAL, None, 400, raw_body=b"not json")
    E("POST /feedback, a 3.0 MB body", "POST", "/feedback", LOCAL, None, 413, raw_body=b"x" * 3_000_000)

    print("== running server: the inbox, source=local")
    E("GET /feedback, the site's origin, inbox code", "GET", "/feedback", SITE, None, 403, cors=True, headers=adm)
    E("GET /feedback, another website, inbox code", "GET", "/feedback", OTHER, None, 403, cors=False, headers=adm)
    E("GET /feedback?source=elsewhere", "GET", "/feedback?source=elsewhere", LOCAL, None, 400, headers=adm)
    E("GET /feedback?after=not-an-id", "GET", "/feedback?after=nope", LOCAL, None, 400, headers=adm)
    E("GET /feedback?limit=many", "GET", "/feedback?limit=many", LOCAL, None, 400, headers=adm)
    status, js = E("GET /feedback, localhost, inbox code", "GET", "/feedback", LOCAL, None, 200, cors=True, headers=adm)
    check("  a page with a count, next and source local", isinstance(js, dict)
          and js.get("count") == len(js.get("items", [])) and "next" in js and js.get("source") == "local")
    every, pages, after = [], 0, None
    while pages < 5000:
        st, _, js1, _ = call(base, "GET", "/feedback?source=local&limit=1" + (f"&after={after}" if after else ""),
                             LOCAL, headers=adm)
        if st != 200:
            break
        pages += 1
        every += js1.get("items", [])
        after = js1.get("next")
        if not after:
            break
    items = {i["id"]: i for i in every}
    check(f"paged one at a time ({pages} pages): every new item there, each once",
          all(i in items for i in made) and len(items) == len(every) == pages)
    if made:
        got = items.get(made[0], {})
        check("the word change came back as sent, open, with its origin and a screenshot link",
              got.get("kind") == "words" and got.get("original") == w["original"]
              and got.get("suggested") == w["suggested"] and got.get("why") == w["why"]
              and got.get("target", {}).get("selector") == w["target"]["selector"]
              and got.get("url_hash") == w["url_hash"] and got.get("viewport") == w["viewport"]
              and got.get("status") == "open" and got.get("done_at") is None and got.get("origin") == SITE
              and got.get("has_screenshot") is True and (got.get("screenshot_url") or "").endswith(
                  f"/feedback/{made[0]}.jpg?source=local"), json.dumps(got)[:300])
        m = items.get(made[1], {}) if len(made) > 1 else {}
        check("the map comment kept its spot and zoom, and has no screenshot",
              m.get("target", {}).get("lnglat") == c["target"]["lnglat"] and m.get("target", {}).get("zoom") == 14.25
              and m.get("suggested") is None and m.get("screenshot_url") is None)
        if hash_id:
            check("the address was kept without its feedback= part",
                  items.get(hash_id, {}).get("url_hash") == "#tab=pinch&zoom=9")
        st, hdrs, _, raw = call(base, "GET", f"/feedback/{made[0]}.jpg?source=local", LOCAL, headers=adm)
        check(f"GET /feedback/<id>.jpg: {st}, the same JPEG, nosniff, inline",
              st == 200 and raw == jpg and hdrs.get("Content-Type") == "image/jpeg"
              and hdrs.get("X-Content-Type-Options") == "nosniff"
              and hdrs.get("Content-Disposition", "").startswith("inline")
              and hdrs.get("Access-Control-Allow-Origin") == LOCAL)
        # (a screenshot asked for without the inbox code is checked in `own`,
        # since here it would be a wrong code from this Mac)
        if len(made) > 1:
            E("GET /feedback/<id>.jpg, an item with no screenshot", "GET", f"/feedback/{made[1]}.jpg", LOCAL, None,
              404, headers=adm)
        _, js = E("GET /feedback/<id>", "GET", f"/feedback/{made[0]}", LOCAL, None, 200, headers=adm)
        check("  the same item", (js or {}).get("id") == made[0])
        E("GET /feedback/<32 digits never made>", "GET", "/feedback/" + "0" * 32, LOCAL, None, 404, headers=adm)
        E("GET /feedback/not-an-id", "GET", "/feedback/not-an-id", LOCAL, None, 404, headers=adm)
        E("GET /feedback/../counters/counters", "GET", "/feedback/..%2Fcounters%2Fcounters", LOCAL, None, 404,
          headers=adm)

        print("== running server: done marks")
        _, js = E("PATCH /feedback/<id> done", "PATCH", f"/feedback/{made[0]}", LOCAL, {"status": "done"}, 200,
                  cors=True, headers=adm)
        done_at = (js or {}).get("done_at")
        check("  done, with done_at", (js or {}).get("status") == "done" and done_at)
        time.sleep(1.1)   # so a second "done" would get a new time if it were not kept
        _, js = E("PATCH done again", "PATCH", f"/feedback/{made[0]}", LOCAL, {"status": "done"}, 200, headers=adm)
        check("  done_at kept from the first time", (js or {}).get("done_at") == done_at)
        _, js = E("POST /feedback/<id> open with a note (POST for PATCH)", "POST", f"/feedback/{made[0]}", LOCAL,
                  {"status": "open", "note": "Changed in config.ts"}, 200, headers=adm)
        check("  open again, done_at cleared, note kept", (js or {}).get("status") == "open"
              and (js or {}).get("done_at") is None and (js or {}).get("note") == "Changed in config.ts")
        with open(os.path.join(HERE, "local_data", "feedback", f"{made[0]}.json")) as fh:
            stored = json.load(fh)
        check("  the file kept the change, without source or screenshot_url",
              stored.get("note") == "Changed in config.ts" and "source" not in stored and "screenshot_url" not in stored)
        E("PATCH an unknown status", "PATCH", f"/feedback/{made[0]}", LOCAL, {"status": "maybe"}, 400, headers=adm)
        E("PATCH with nothing to change", "PATCH", f"/feedback/{made[0]}", LOCAL, {}, 400, headers=adm)
        E("PATCH an id never made", "PATCH", "/feedback/" + "0" * 32, LOCAL, {"status": "done"}, 404, headers=adm)
        E("PATCH from the site's origin", "PATCH", f"/feedback/{made[0]}", SITE, {"status": "done"}, 403, headers=adm)
        E("PATCH a screenshot", "PATCH", f"/feedback/{made[0]}.jpg", LOCAL, {"status": "done"}, 404, headers=adm)

    folder = os.path.join(HERE, "local_data", "feedback")
    gone = 0
    for i in made:
        for ext in (".json", ".jpg"):
            p = os.path.join(folder, i + ext)
            if os.path.isfile(p):
                os.remove(p)
                gone += ext == ".json"
    print(f"removed the {gone} test items from {folder}")


# ---------------------------------------------------------------- a server of our own

class FakeS3:
    """A bucket in memory with the calls the inbox makes, so source=aws can
    be tried without AWS. Lists 3 keys at a time to make the inbox page
    through the listing."""

    def __init__(self, objects):
        self.objects = dict(objects)
        self.calls = []
        self.fail = None

    def _maybe_fail(self, what):
        self.calls.append(what)
        if self.fail:
            import local_server
            raise local_server.AwsError(self.fail)

    def list_page(self, prefix, start_after):
        self._maybe_fail("list")
        keys = sorted(k for k in self.objects if k.startswith(prefix) and (not start_after or k > start_after))
        return keys[:3], len(keys) > 3

    def get_many(self, keys):
        self._maybe_fail("get")
        return {k: self.objects[k] for k in keys if k in self.objects}

    def put(self, key, data, content_type):
        self._maybe_fail("put")
        self.objects[key] = data


def start_own_server(fake):
    """A second server in this process with made-up codes, so caps and the
    lockout can be tried without touching the real one or its folder."""
    tmp = tempfile.mkdtemp(prefix="feedback_test_")
    salt, fc, ac = secrets.token_hex(8), secrets.token_hex(12), secrets.token_hex(16)
    h = lambda c: hashlib.sha256((salt + c).encode()).hexdigest()   # noqa: E731
    os.environ.update(CODE_SALT=salt, CODE_HASH_FEEDBACK=h(fc), CODE_HASH_FEEDBACK_ADMIN=h(ac),
                      FEEDBACK_PER_DAY="3", FEEDBACK_ALL_PER_DAY="5", FEEDBACK_MB_PER_DAY="100",
                      WRONG_CODES_PER_WINDOW="3", SERVICE_ON="true")
    import local_server
    srv = local_server.make_server(0, os.path.join(tmp, "data"), trust_forwarded=True,
                                   buckets=["made-up-bucket"], s3_factory=lambda bucket: fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}", fc, ac, tmp


def own_checks(srv_info):
    import feedback_core as core
    import feedback_lambda
    srv, base, fc, ac, tmp = srv_info
    E = lambda *a, **k: expect(base, *a, **k)   # noqa: E731
    post = {"code": fc, "item": FB_COMMENT}

    def ip(addr):
        return {"x-forwarded-for": addr}

    print(f"== own server at {base}: the origin rule")
    wrong = [o for o, want in ORIGINS if (core.origin_kind(o) is not None) != want]
    check(f"feedback_core.origin_kind gets all {len(ORIGINS)} origins right", not wrong, str(wrong))
    tpl = open(os.path.join(HERE, "template.yml"), encoding="utf-8").read()
    m = re.search(r"FunctionCode: !Sub \|\n((?: {8}.*\n|\n)+)", tpl)
    node = shutil.which("node")
    if m and node:
        js = "".join(line[8:] + "\n" for line in m.group(1).splitlines())
        js = js.replace("${AllowedDomain}", "nemac.org").replace("${LocalOrigins}", f"{LOCAL},{LOCAL2}")
        js += ("var cases = " + json.dumps([[o, w] for o, w in ORIGINS]) + ";\nvar bad = [];\n"
               "cases.forEach(function (c) { var ev = {request: {headers: c[0] === null ? {} : "
               "{origin: {value: c[0]}}}}; if ((handler(ev) === ev.request) !== c[1]) bad.push(c[0]); });\n"
               "console.log(JSON.stringify(bad));\n")
        f = os.path.join(tmp, "gate.js")
        with open(f, "w") as fh:
            fh.write(js)
        out = subprocess.run([node, f], capture_output=True, text=True, timeout=30)
        check(f"the CloudFront Function gets all {len(ORIGINS)} origins right", out.stdout.strip() == "[]",
              out.stdout + out.stderr)
    else:
        check("the CloudFront Function's code found in template.yml (node not installed: not run)", bool(m))

    print("== own server: the Lambda function has no read routes")
    def lam(method, path, body=None, origin=LOCAL, headers=None, addr="192.0.2.200"):
        ev = {"rawPath": path, "rawQueryString": "", "headers": {"origin": origin, "x-forwarded-for": addr,
                                                                   **(headers or {})},
              "requestContext": {"http": {"method": method, "path": path, "sourceIp": "10.9.9.9"}},
              "body": json.dumps(body) if body is not None else "", "isBase64Encoded": False}
        return feedback_lambda.handler(ev, None)
    adm = {"x-feedback-admin": ac}
    for method, path in (("GET", "/feedback"), ("GET", "/feedback/" + "a" * 32), ("GET", "/feedback/" + "a" * 32 + ".jpg"),
                         ("PATCH", "/feedback/" + "a" * 32), ("POST", "/feedback/" + "a" * 32),
                         ("DELETE", "/feedback/" + "a" * 32)):
        out = lam(method, path, {"status": "done"} if method != "GET" else None, headers=adm)
        check(f"Lambda {method} {path[:20]}... with the inbox code: {out['statusCode']} (want 404)",
              out["statusCode"] == 404)
    saved = os.environ.pop("CODE_HASH_FEEDBACK_ADMIN")
    try:
        out = lam("POST", "/feedback", {"code": ac, "item": FB_COMMENT}, addr="192.0.2.201")
        check(f"Lambda POST with the inbox code, as on AWS where it is not set: {out['statusCode']} (want 401)",
              out["statusCode"] == 401)
    finally:
        os.environ["CODE_HASH_FEEDBACK_ADMIN"] = saved
    out = lam("GET", "/health", origin="https://nemac.org.evil.com")
    check(f"Lambda GET /health from nemac.org.evil.com: {out['statusCode']} (want 403), no CORS",
          out["statusCode"] == 403 and "Access-Control-Allow-Origin" not in out["headers"])
    out = lam("GET", "/health", origin=SITE)
    check(f"Lambda GET /health from the site: {out['statusCode']} (want 200), CORS echoed",
          out["statusCode"] == 200 and out["headers"].get("Access-Control-Allow-Origin") == SITE)
    r = core.Request({"headers": {"x-forwarded-for": "203.0.113.5, 198.51.100.9, 10.1.1.1"},
                      "requestContext": {"http": {"sourceIp": "10.1.1.1"}}})
    check("with no CloudFront-Viewer-Address, the sender's address is CloudFront's last X-Forwarded-For entry",
          r.client_ip() == "198.51.100.9")
    xff = "203.0.113.5, 198.51.100.9, 10.1.1.1"
    for label, cva, want in (
            ("IPv4 with its port", "192.0.2.44:51234", "192.0.2.44"),
            ("IPv6 with its port, no brackets", "2001:db8:7:8::5:443", "2001:db8:7:8::5"),
            ("IPv6 in brackets", "[2001:db8:7:8::6]:443", "2001:db8:7:8::6"),
            ("not an address: X-Forwarded-For instead", "nonsense:12", "198.51.100.9")):
        r = core.Request({"headers": {"CloudFront-Viewer-Address": cva, "x-forwarded-for": xff},
                          "requestContext": {"http": {"sourceIp": "10.1.1.1"}}})
        check(f"CloudFront-Viewer-Address comes first: {label}", r.client_ip() == want, r.client_ip())
    tpl_ok = ("OriginRequestPolicyId: !Ref OriginHeaders" in tpl and "- CloudFront-Viewer-Address" in tpl
              and "b689b0a8-53d0-40ab-baf2-68738e2966ac" not in tpl)
    check("template.yml forwards CloudFront-Viewer-Address through its own origin request policy", tpl_ok)
    check("addresses: IPv6 by its /64, IPv4-in-IPv6 as IPv4, IPv4 whole",
          core.addr_key("2001:db8:1:2:aaaa::1") == "2001:db8:1:2::/64" and core.addr_key("::ffff:192.0.2.9") == "192.0.2.9"
          and core.addr_key("192.0.2.9") == "192.0.2.9")
    check("the address cleaned of feedback=",
          core.clean_hash("#tab=pinch&feedback=abc&zoom=9") == "#tab=pinch&zoom=9"
          and core.clean_hash("#feedback=abc") is None and core.clean_hash("#FeedBack=abc&x=1") == "#x=1"
          and core.clean_hash("tab=1") is False and core.clean_hash(None) is None)

    print("== own server: one address's cap (3 a day here), IPv6 by its /64")
    for i in range(3):
        E(f"post {i + 1} of 3 from 2001:db8::{i + 1}", "POST", "/feedback", LOCAL, post, 201, headers=ip(f"2001:db8::{i + 1}"))
    _, js = E("post 4 from another address in the same /64", "POST", "/feedback", LOCAL, post, 429,
              cors=True, headers=ip("2001:db8::ff"))
    check("  says this connection's limit is reached", "this connection" in ((js or {}).get("error") or "").lower())
    E("post from another /64", "POST", "/feedback", LOCAL, post, 201, headers=ip("2001:db8:0:1::1"))
    print("== own server: everyone's cap (5 a day here)")
    E("post 5 of 5 for everyone, from IPv4", "POST", "/feedback", LOCAL, post, 201, headers=ip("198.51.100.7"))
    _, js = E("post 6 for everyone, from a new address", "POST", "/feedback", LOCAL, post, 429, headers=ip("198.51.100.8"))
    check("  says no more can be taken today", "No more feedback" in ((js or {}).get("error") or ""))
    print("== own server: everyone's megabytes")
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_mb"), FEEDBACK_MB_PER_DAY="0.004",
                      FEEDBACK_ALL_PER_DAY="1000")
    shot = base64.b64encode(tiny_jpeg(1500)).decode()
    E("a 2 KB item under a 4 KB day", "POST", "/feedback", LOCAL, {**post, "screenshot": shot}, 201,
      headers=ip("198.51.100.20"))
    _, js = E("a second 2 KB item over it", "POST", "/feedback", LOCAL, {**post, "screenshot": shot}, 429,
              headers=ip("198.51.100.21"))
    check("  says no more can be taken today", "No more feedback" in ((js or {}).get("error") or ""))
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_lock"), FEEDBACK_MB_PER_DAY="100")

    print("== own server: the lockout (3 wrong codes here), by /64, before the body is read")
    for i in range(3):
        E(f"wrong code {i + 1} of 3 from 2001:db8:5::{i + 1}", "POST", "/feedback", LOCAL, {**post, "code": "nope"},
          401, headers=ip(f"2001:db8:5::{i + 1}"))
    E("the right code from another address in that /64", "POST", "/feedback", LOCAL, post, 429,
      headers=ip("2001:db8:5::99"))
    E("a body that is not JSON from that /64 (429, not 400)", "POST", "/feedback", LOCAL, None, 429,
      raw_body=b"not json", headers=ip("2001:db8:5::98"))
    E("the inbox from that /64, right inbox code", "GET", "/feedback", LOCAL, None, 429,
      headers={**adm, **ip("2001:db8:5::97")})
    E("the right code from another /64", "POST", "/feedback", LOCAL, post, 201, headers=ip("2001:db8:6::1"))
    E("the inbox with no code (counted as wrong)", "GET", "/feedback", LOCAL, None, 401, headers=ip("192.0.2.90"))
    E("a screenshot with no inbox code", "GET", "/feedback/" + "a" * 32 + ".jpg", LOCAL, None, 401,
      headers=ip("192.0.2.91"))

    print("== own server: the lockout keys on CloudFront-Viewer-Address, whatever X-Forwarded-For says")
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_cva"))
    for i in range(3):
        E(f"wrong code {i + 1} of 3 from 198.51.100.60 (X-Forwarded-For says 192.0.2.{i + 1})", "POST", "/feedback",
          LOCAL, {**post, "code": "nope"}, 401,
          headers={"cloudfront-viewer-address": f"198.51.100.60:{40000 + i}", **ip(f"192.0.2.{i + 1}")})
    E("the right code from 198.51.100.60, a new X-Forwarded-For", "POST", "/feedback", LOCAL, post, 429,
      headers={"cloudfront-viewer-address": "198.51.100.60:40100", **ip("192.0.2.77")})
    E("the right code from 198.51.100.61 with the locked address in X-Forwarded-For", "POST", "/feedback", LOCAL,
      post, 201, headers={"cloudfront-viewer-address": "198.51.100.61:40101", **ip("198.51.100.60")})

    print("== own server: the wrong-code limit for everyone together (4 in 10 minutes here)")
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_all"), WRONG_CODES_ALL_PER_WINDOW="4")
    try:
        for i in range(4):
            E(f"wrong code {i + 1} of 4, each from its own /64", "POST", "/feedback", LOCAL, {**post, "code": "nope"},
              401, headers=ip(f"2001:db8:{100 + i}::1"))
        _, js = E("the right code from an address that sent none", "POST", "/feedback", LOCAL, post, 429,
                  cors=True, headers=ip("2001:db8:200::1"))
        check("  says too many wrong codes were tried lately, not 'from this connection'",
              (js or {}).get("error") == core.MSG_LOCKED_ALL, json.dumps(js))
        E("the inbox code is refused too, from another address", "GET", "/feedback", LOCAL, None, 429,
          headers={**adm, **ip("192.0.2.201")})
        E("GET /health still answers", "GET", "/health", LOCAL, None, 200, headers=ip("192.0.2.202"))
        os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_all2"))
        E("a new window (fresh counters): the right code is taken again", "POST", "/feedback", LOCAL, post, 201,
          headers=ip("2001:db8:200::1"))
    finally:
        os.environ.pop("WRONG_CODES_ALL_PER_WINDOW", None)

    print("== own server: the end date")
    import datetime as dt
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_end"))
    today = core.today()
    try:
        os.environ["FEEDBACK_ENDS_ON"] = (today - dt.timedelta(days=1)).isoformat()
        _, js = E("POST /feedback the day after the end date", "POST", "/feedback", LOCAL, post, 410, cors=True,
                  headers=ip("192.0.2.110"))
        check("  says 'Feedback has ended. Thank you for your help.'",
              (js or {}).get("error") == "Feedback has ended. Thank you for your help.", json.dumps(js))
        E("POST /feedback after the end date, a wrong code: still 410, not counted", "POST", "/feedback", LOCAL,
          {**post, "code": "nope"}, 410, headers=ip("192.0.2.110"))
        _, js = E("GET /health after the end date", "GET", "/health", LOCAL, None, 200, headers=ip("192.0.2.110"))
        check("  ended, off, and ends_at at midnight Eastern after that day",
              (js or {}).get("ended") is True and (js or {}).get("on") is False
              and (js or {}).get("ends_on") == os.environ["FEEDBACK_ENDS_ON"]
              and (js or {}).get("ends_at", "").endswith(("T05:00:00Z", "T04:00:00Z"))
              and (js or {}).get("ends_at", "")[:10] == today.isoformat(), json.dumps(js))
        E("the inbox still answers after the end date", "GET", "/feedback", LOCAL, None, 200,
          headers={**adm, **ip("192.0.2.111")})
        os.environ["FEEDBACK_ENDS_ON"] = today.isoformat()
        E("POST /feedback on the last day", "POST", "/feedback", LOCAL, post, 201, headers=ip("192.0.2.112"))
        _, js = E("GET /health on the last day", "GET", "/health", LOCAL, None, 200, headers=ip("192.0.2.112"))
        check("  not ended yet", (js or {}).get("ended") is False and (js or {}).get("on") is True)
        os.environ["FEEDBACK_ENDS_ON"] = "2026-13-45"
        E("an end date that is not a date counts as ended", "POST", "/feedback", LOCAL, post, 410,
          headers=ip("192.0.2.113"))
        os.environ["FEEDBACK_ENDS_ON"] = "2026-11-20"
        end = core.ends_at()
        check("ends_at for 2026-11-20 is 2026-11-21 05:00 UTC (midnight EST)",
              core.utc_iso(end) == "2026-11-21T05:00:00Z", core.utc_iso(end))
        check("has_ended: a second before is open, the moment itself is ended",
              not core.has_ended(end - dt.timedelta(seconds=1)) and core.has_ended(end))
    finally:
        os.environ.pop("FEEDBACK_ENDS_ON", None)

    print("== own server: turned off")
    os.environ["SERVICE_ON"] = "false"
    try:
        _, js = E("GET /health while off", "GET", "/health", LOCAL, None, 200, headers=ip("192.0.2.95"))
        check("  says it is off", (js or {}).get("on") is False)
        E("POST /feedback while off", "POST", "/feedback", LOCAL, post, 503, cors=True, headers=ip("192.0.2.95"))
        E("the inbox still answers while off", "GET", "/feedback", LOCAL, None, 200, headers={**adm, **ip("192.0.2.96")})
    finally:
        os.environ["SERVICE_ON"] = "true"

    print("== own server: codes in the wrong place (made-up codes, made-up addresses)")
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_place"))
    E("POST /feedback with the inbox code from the site", "POST", "/feedback", SITE, {**post, "code": ac}, 401,
      cors=True, headers=ip("192.0.2.120"))
    E("the inbox with the testers' code as inbox code", "GET", "/feedback", LOCAL, None, 401,
      headers={"x-feedback-admin": fc, **ip("192.0.2.121")})

    print("== own server: a drawn area or routes kept with an item (item.context)")
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_ctx"), FEEDBACK_PER_DAY="1000",
                      FEEDBACK_ALL_PER_DAY="1000", FEEDBACK_MB_PER_DAY="100")
    try:
        _, js = E("GET /health names the context limit", "GET", "/health", LOCAL, None, 200, headers=ip("192.0.2.130"))
        check("  max_context_bytes is 300,000", (js or {}).get("max_context_bytes") == 300_000, json.dumps(js))
        shot = base64.b64encode(tiny_jpeg()).decode()
        _, js = E("a comment with a drawn area and a screenshot", "POST", "/feedback", LOCAL,
                  {**post, "item": {**FB_COMMENT, "context": CTX_DRAWN}, "screenshot": shot}, 201, cors=True,
                  headers=ip("192.0.2.131"))
        drawn_id = (js or {}).get("id", "")
        _, js = E("a word change with routes", "POST", "/feedback", LOCAL,
                  {**post, "item": {**FB_WORDS, "context": CTX_ROUTES}}, 201, headers=ip("192.0.2.132"))
        routes_id = (js or {}).get("id", "")
        _, js = E("a comment with no context", "POST", "/feedback", LOCAL, post, 201, headers=ip("192.0.2.133"))
        plain_id = (js or {}).get("id", "")
        _, js = E("GET /feedback/<id> of the drawn area", "GET", f"/feedback/{drawn_id}", LOCAL, None, 200,
                  headers={**adm, **ip("192.0.2.134")})
        check("  the context comes back exactly as sent, markup and all", (js or {}).get("context") == CTX_DRAWN,
              json.dumps((js or {}).get("context"))[:300])
        _, js = E("GET /feedback, the list", "GET", "/feedback?limit=100", LOCAL, None, 200,
                  headers={**adm, **ip("192.0.2.135")})
        got = {i["id"]: i for i in (js or {}).get("items", [])}
        check("  the list has the routes as sent, and null for the item with none",
              got.get(routes_id, {}).get("context") == CTX_ROUTES and plain_id in got
              and got[plain_id].get("context") is None)
        _, js = E("PATCH the drawn area's item done", "PATCH", f"/feedback/{drawn_id}", LOCAL, {"status": "done"}, 200,
                  headers={**adm, **ip("192.0.2.136")})
        with open(os.path.join(tmp, "data", "feedback", f"{drawn_id}.json"), encoding="utf-8") as fh:
            stored = json.load(fh)
        check("  a done mark keeps the context, in the answer and in the file",
              (js or {}).get("context") == CTX_DRAWN and stored.get("context") == CTX_DRAWN
              and stored.get("status") == "done")

        pad = 300_000 - len(json.dumps({"type": "routes", "pad": ""}, separators=(",", ":")))
        big = {"type": "routes", "pad": "x" * pad}
        full_shot = base64.b64encode(tiny_jpeg(1_499_000)[:1_500_000]).decode()
        E("a context of exactly 300,000 bytes with a full 1.5 MB screenshot", "POST", "/feedback", LOCAL,
          {**post, "item": {**FB_WORDS, "why": "w" * 4000, "context": big}, "screenshot": full_shot}, 201,
          headers=ip("192.0.2.137"))
        _, js = E("a context one byte over", "POST", "/feedback", LOCAL,
                  {**post, "item": {**FB_COMMENT, "context": {**big, "pad": "x" * (pad + 1)}}}, 400,
                  cors=True, headers=ip("192.0.2.138"))
        check("  says it is too large", (js or {}).get("error") == core.MSG_CONTEXT_BIG, json.dumps(js))
        _, js = E("a context measured in bytes, not letters (150,000 two-byte letters)", "POST", "/feedback", LOCAL,
                  {**post, "item": {**FB_COMMENT, "context": {"type": "routes", "pad": "é" * 150_000}}}, 400,
                  headers=ip("192.0.2.139"))
        check("  says it is too large", (js or {}).get("error") == core.MSG_CONTEXT_BIG, json.dumps(js))
        E(f"a context {core.MAX_CONTEXT_DEPTH} deep", "POST", "/feedback", LOCAL,
          {**post, "item": {**FB_COMMENT, "context": nested(core.MAX_CONTEXT_DEPTH)}}, 201, headers=ip("192.0.2.140"))
        for n, (label, ctx) in enumerate([
                (f"{core.MAX_CONTEXT_DEPTH + 1} deep", nested(core.MAX_CONTEXT_DEPTH + 1)),
                ("not an object", ["routes"]), ("a plain string", "routes"),
                ("no type", {"run_id": "a" * 32}), ("an unknown type", {"type": "map"}),
                ("a true in it", {"type": "routes", "fewer": True}),
                ("a null in it", {"type": "drawn_hazard", "name": None}),
                ("a null inside a list", {"type": "routes", "line": [[-83.1, None]]}),
                ("a whole number past 2**53", {"type": "routes", "n": 2 ** 60}),
                ("a 201 letter name", {"type": "routes", "k" * 201: 1})]):
            _, js = E(f"a context that is {label}", "POST", "/feedback", LOCAL,
                      {**post, "item": {**FB_COMMENT, "context": ctx}}, 400, headers=ip(f"192.0.2.{150 + n}"))
            if n == 0:
                check("  says what was sent with it could not be read", (js or {}).get("error") == core.MSG_CONTEXT)
        raw = json.dumps({**post, "item": {**FB_COMMENT, "context": {"type": "routes", "x": float("nan")}}}).encode()
        E("a context holding NaN (not JSON, though Python reads it)", "POST", "/feedback", LOCAL, None, 400,
          raw_body=raw, headers=ip("192.0.2.170"))
        raw = (b'{"code":"x","item":{"kind":"comment","context":' + b"[" * 100_000 + b"]" * 100_000 + b"}}")
        E("a body 100,000 lists deep: 400, not a server fault", "POST", "/feedback", LOCAL, None, 400, raw_body=raw,
          headers=ip("192.0.2.171"))
        _, js = E("a body over the new limit (2.9 MB)", "POST", "/feedback", LOCAL, None, 413,
                  raw_body=b"x" * (core.MAX_BODY + 1), headers=ip("192.0.2.172"))
        check("the body limit grew by the context's 300 KB and no more", core.MAX_BODY == 2_900_000)
        check("read_context keeps a lone surrogate's size without failing",
              core.read_context({"type": "routes", "s": "\ud800"}) == ({"type": "routes", "s": "\ud800"}, None))
    finally:
        os.environ.update(FEEDBACK_PER_DAY="3", FEEDBACK_ALL_PER_DAY="5", FEEDBACK_MB_PER_DAY="100")


def delete_checks(srv_info, fake):
    """Delete and Clear in the dev inbox: test feedback on this computer
    only. Never a bucket, real or fake."""
    import local_server
    srv, base, fc, ac, tmp = srv_info
    E = lambda *a, **k: expect(base, *a, **k)   # noqa: E731
    os.environ.update(COUNTER_DIR=os.path.join(tmp, "counters_delete"), FEEDBACK_PER_DAY="1000",
                      FEEDBACK_ALL_PER_DAY="1000", FEEDBACK_MB_PER_DAY="100")
    folder = os.path.join(tmp, "data", "feedback")
    adm = lambda addr: {"x-feedback-admin": ac, "x-forwarded-for": addr}   # noqa: E731
    on_disk = lambda fid: [x for x in ("json", "jpg") if os.path.exists(os.path.join(folder, f"{fid}.{x}"))]  # noqa: E731
    # stands in for real feedback: a delete or clear must never reach it
    fake.objects["feedback/" + "c" * 32 + ".json"] = b'{"id": "' + b"c" * 32 + b'"}'
    before_bucket = dict(fake.objects)
    try:
        print("== own server: deleting test feedback on this computer")
        status, hdrs, _, _ = call(base, "OPTIONS", "/feedback/" + "a" * 32, LOCAL)
        check(f"OPTIONS /feedback/<id>, localhost: {status} (want 204), allows DELETE",
              status == 204 and "DELETE" in hdrs.get("Access-Control-Allow-Methods", ""))
        shot = base64.b64encode(tiny_jpeg()).decode()
        ids = []
        for n in range(3):
            _, js = E(f"post test item {n + 1} of 3" + (" with a screenshot" if n < 2 else ""), "POST", "/feedback",
                      LOCAL, {"code": fc, "item": FB_COMMENT, **({"screenshot": shot} if n < 2 else {})}, 201,
                      headers={"x-forwarded-for": f"192.0.2.{180 + n}"})
            ids.append((js or {}).get("id", ""))
        check("  the first is kept with its screenshot", on_disk(ids[0]) == ["json", "jpg"], str(on_disk(ids[0])))

        E("DELETE one item from the site's origin", "DELETE", f"/feedback/{ids[0]}?source=local", SITE, None, 403,
          headers=adm("192.0.2.185"))
        E("DELETE one item with no inbox code (counted as wrong)", "DELETE", f"/feedback/{ids[0]}?source=local",
          LOCAL, None, 401, headers={"x-forwarded-for": "192.0.2.186"})
        check("  still there after both", on_disk(ids[0]) == ["json", "jpg"])
        _, js = E("DELETE one item, source=aws", "DELETE", f"/feedback/{ids[0]}?source=aws", LOCAL, None, 400,
                  cors=True, headers=adm("192.0.2.187"))
        check("  says deleting is only for test feedback on this computer",
              (js or {}).get("error") == "Deleting is only for test feedback on this computer.", json.dumps(js))
        _, js = E("DELETE one item, source=aws and a bucket it reads", "DELETE",
                  f"/feedback/{'c' * 32}?source=aws&bucket=made-up-bucket", LOCAL, None, 400, headers=adm("192.0.2.187"))
        check("  the same answer", (js or {}).get("error") == local_server.MSG_NO_DELETE)
        _, js = E("DELETE one item, source=local", "DELETE", f"/feedback/{ids[0]}?source=local", LOCAL, None, 200,
                  cors=True, headers=adm("192.0.2.188"))
        check("  answers with its id", (js or {}).get("deleted") == ids[0], json.dumps(js))
        check("  its .json and .jpg are gone, the others are not",
              on_disk(ids[0]) == [] and on_disk(ids[1]) == ["json", "jpg"] and on_disk(ids[2]) == ["json"])
        E("DELETE it again", "DELETE", f"/feedback/{ids[0]}?source=local", LOCAL, None, 404, headers=adm("192.0.2.188"))
        E("GET it after", "GET", f"/feedback/{ids[0]}?source=local", LOCAL, None, 404, headers=adm("192.0.2.188"))
        E("DELETE an id that is not one", "DELETE", "/feedback/..%2Fcounters?source=local", LOCAL, None, 404,
          headers=adm("192.0.2.188"))
        E("DELETE a screenshot's address", "DELETE", f"/feedback/{ids[1]}.jpg?source=local", LOCAL, None, 404,
          headers=adm("192.0.2.188"))
        check("  which leaves it", on_disk(ids[1]) == ["json", "jpg"])

        print("== own server: clearing all test feedback on this computer")
        stray = os.path.join(folder, "not-an-item.tmp")
        with open(stray, "w") as fh:
            fh.write("x")
        _, js = E("GET /feedback, before", "GET", "/feedback?source=local&limit=100", LOCAL, None, 200,
                  headers=adm("192.0.2.189"))
        n_before = (js or {}).get("count", 0)
        _, js = E("clear, source=aws", "POST", "/feedback/clear?source=aws", LOCAL, {"confirm": "clear"}, 400,
                  cors=True, headers=adm("192.0.2.189"))
        check("  says deleting is only for test feedback on this computer",
              (js or {}).get("error") == local_server.MSG_NO_DELETE, json.dumps(js))
        E("clear with no confirm", "POST", "/feedback/clear?source=local", LOCAL, {}, 400, headers=adm("192.0.2.189"))
        E("clear with the wrong confirm", "POST", "/feedback/clear?source=local", LOCAL, {"confirm": "yes"}, 400,
          headers=adm("192.0.2.189"))
        E("clear with no inbox code (counted as wrong)", "POST", "/feedback/clear?source=local", LOCAL,
          {"confirm": "clear"}, 401, headers={"x-forwarded-for": "192.0.2.190"})
        E("clear from the site's origin", "POST", "/feedback/clear?source=local", SITE, {"confirm": "clear"}, 403,
          headers=adm("192.0.2.191"))
        E("GET /feedback/clear", "GET", "/feedback/clear?source=local", LOCAL, None, 404, headers=adm("192.0.2.189"))
        check("  nothing removed by any of those", on_disk(ids[1]) == ["json", "jpg"] and on_disk(ids[2]) == ["json"])
        _, js = E("clear, source=local", "POST", "/feedback/clear?source=local", LOCAL, {"confirm": "clear"}, 200,
                  cors=True, headers=adm("192.0.2.192"))
        check(f"  says it deleted every item ({n_before})", (js or {}).get("deleted") == n_before and n_before >= 2,
              json.dumps(js))
        left = sorted(os.listdir(folder))
        check("  no item or screenshot is left, and a file that is not an item is", left == ["not-an-item.tmp"],
              str(left))
        _, js = E("GET /feedback, after", "GET", "/feedback?source=local", LOCAL, None, 200, headers=adm("192.0.2.192"))
        check("  the list is empty", (js or {}).get("count") == 0 and (js or {}).get("items") == [])
        _, js = E("clear an empty folder", "POST", "/feedback/clear?source=local", LOCAL, {"confirm": "clear"}, 200,
                  headers=adm("192.0.2.192"))
        check("  says it deleted none", (js or {}).get("deleted") == 0)
        E("a new item is taken after a clear", "POST", "/feedback", LOCAL, {"code": fc, "item": FB_COMMENT}, 201,
          headers={"x-forwarded-for": "192.0.2.193"})
        check("the fake bucket is exactly as it was: nothing deleted or written", fake.objects == before_bucket)
    finally:
        fake.objects.pop("feedback/" + "c" * 32 + ".json", None)
        os.environ.update(FEEDBACK_PER_DAY="3", FEEDBACK_ALL_PER_DAY="5", FEEDBACK_MB_PER_DAY="100")


def aws_checks(srv_info, fake):
    srv, base, fc, ac, tmp = srv_info
    E = lambda *a, **k: expect(base, *a, **k)   # noqa: E731
    adm = {"x-feedback-admin": ac, "x-forwarded-for": "192.0.2.150"}
    ids = [f"{i:032x}" for i in range(1, 8)]
    jpg = tiny_jpeg()
    for n, fid in enumerate(ids):
        fake.objects[f"feedback/{fid}.json"] = json.dumps(
            {"id": fid, **FB_COMMENT, "status": "open", "done_at": None, "note": None,
             "has_screenshot": n == 0, "created_at": "2026-11-20T12:00:00Z", "origin": SITE}).encode()
    fake.objects[f"feedback/{ids[0]}.jpg"] = jpg
    ctx_item = json.loads(fake.objects[f"feedback/{ids[3]}.json"])
    fake.objects[f"feedback/{ids[3]}.json"] = json.dumps({**ctx_item, "context": CTX_ROUTES}).encode()
    fake.objects["feedback/" + "f" * 32 + ".json"] = b"{not json"          # unreadable: skipped
    fake.objects["feedback/sub/" + "e" * 32 + ".json"] = b"{}"             # not directly under feedback/
    fake.objects["other/" + "d" * 32 + ".json"] = b"{}"                    # another folder

    print(f"== own server: the inbox, source=aws, against a fake bucket")
    seen, after, pages = [], None, 0
    while pages < 20:
        status, js = E(f"GET /feedback?source=aws page {pages + 1}, limit 3", "GET",
                       "/feedback?source=aws&limit=3" + (f"&after={after}" if after else ""), LOCAL, None, 200,
                       cors=True, headers=adm)
        pages += 1
        seen += [i["id"] for i in (js or {}).get("items", [])]
        check("  every item says source aws", all(i.get("source") == "aws" for i in (js or {}).get("items", [])))
        after = (js or {}).get("next")
        if not after:
            break
    check(f"the 7 good items, each once, in {pages} pages; the unreadable and nested ones left out",
          seen == ids and pages == 3, str(seen))
    _, js = E("GET /feedback/<id>?source=aws, an item with routes", "GET", f"/feedback/{ids[3]}?source=aws", LOCAL,
              None, 200, headers=adm)
    check("  the context comes back exactly as kept, and the item names its bucket",
          (js or {}).get("context") == CTX_ROUTES and (js or {}).get("bucket") == "made-up-bucket")
    st, hdrs, _, raw = call(base, "GET", f"/feedback/{ids[0]}.jpg?source=aws", LOCAL, headers=adm)
    check(f"GET /feedback/<id>.jpg?source=aws: {st}, the same JPEG", st == 200 and raw == jpg
          and hdrs.get("Content-Type") == "image/jpeg")
    E("GET /feedback/<id>.jpg?source=aws, no screenshot", "GET", f"/feedback/{ids[1]}.jpg?source=aws", LOCAL, None,
      404, headers=adm)
    _, js = E("PATCH /feedback/<id>?source=aws done", "PATCH", f"/feedback/{ids[2]}?source=aws", LOCAL,
              {"status": "done", "note": "Fixed"}, 200, headers=adm)
    stored = json.loads(fake.objects[f"feedback/{ids[2]}.json"])
    check("  written back to the bucket: done, note, no source, screenshot_url or bucket",
          stored.get("status") == "done" and stored.get("done_at") and stored.get("note") == "Fixed"
          and "source" not in stored and "screenshot_url" not in stored and "bucket" not in stored)
    E("PATCH /feedback/<id>?source=aws, an id not in the bucket", "PATCH", "/feedback/" + "c" * 32 + "?source=aws",
      LOCAL, {"status": "done"}, 404, headers=adm)
    fake.fail = "AccessDenied when calling the ListObjectsV2 operation"
    _, js = E("GET /feedback?source=aws when the login is refused", "GET", "/feedback?source=aws", LOCAL, None, 502,
              cors=True, headers=adm)
    check("  says the bucket could not be read with the AWS login", "AWS login" in ((js or {}).get("error") or ""))
    fake.fail = None
    check("the local folder was not touched by source=aws",
          not os.path.isdir(os.path.join(tmp, "data", "feedback"))
          or all(f"{i}.json" not in os.listdir(os.path.join(tmp, "data", "feedback")) for i in ids))

    print("== own server: several buckets, kept by earlier removes, read as one inbox")
    import local_server
    old_ids = [f"{i:032x}" for i in (0x0, 0x10, 0x12)]   # one before the newer ones, two after
    old = FakeS3({f"feedback/{i}.json": json.dumps({"id": i, **FB_COMMENT, "status": "open", "has_screenshot": True,
                                                    "context": CTX_DRAWN}).encode() for i in old_ids})
    old.objects[f"feedback/{old_ids[0]}.jpg"] = jpg
    gone = FakeS3({})
    gone.fail = "NoSuchBucket when calling the ListObjectsV2 operation"
    fakes = {"kept-oldest": gone, "kept-older": old, "made-up-bucket": fake}
    saved = dict(local_server.CONFIG)
    local_server.CONFIG.update(buckets=["kept-oldest", "kept-older", "made-up-bucket"], s3_factory=lambda b: fakes[b])
    try:
        seen, after, pages, unread = [], None, 0, set()
        while pages < 20:
            _, js = E(f"GET /feedback?source=aws over three buckets, page {pages + 1}", "GET",
                      "/feedback?source=aws&limit=4" + (f"&after={after}" if after else ""), LOCAL, None, 200,
                      headers=adm)
            pages += 1
            seen += [(i["id"], i.get("bucket")) for i in (js or {}).get("items", [])]
            unread |= set((js or {}).get("unread_buckets") or [])
            after = (js or {}).get("next")
            if not after:
                break
        want = sorted([(i, "made-up-bucket") for i in ids] + [(i, "kept-older") for i in old_ids])
        check(f"every item from both readable buckets, each once, in id order, each naming its bucket ({pages} pages)",
              seen == want and pages == 3, str(seen))
        check("  the bucket that could not be read is named, and hides nothing", unread == {"kept-oldest"})
        check("  the answer lists the buckets read, newest first",
              (js or {}).get("buckets") == ["made-up-bucket", "kept-older", "kept-oldest"])
        _, js = E("GET /feedback?source=aws&bucket=kept-older", "GET", "/feedback?source=aws&bucket=kept-older", LOCAL,
                  None, 200, headers=adm)
        check("  only that bucket's items", [i["id"] for i in (js or {}).get("items", [])] == old_ids)
        E("GET /feedback?source=aws&bucket=<one not listed>", "GET", "/feedback?source=aws&bucket=someone-else",
          LOCAL, None, 400, headers=adm)
        E("GET /feedback?source=local&bucket=kept-older", "GET", "/feedback?source=local&bucket=kept-older",
          LOCAL, None, 400, headers=adm)
        _, js = E("GET an older bucket's item by id alone", "GET", f"/feedback/{old_ids[0]}?source=aws", LOCAL, None,
                  200, headers=adm)
        url = (js or {}).get("screenshot_url") or ""
        check("  found, with its context, and its screenshot link names its bucket",
              (js or {}).get("context") == CTX_DRAWN and url.endswith(f"?source=aws&bucket=kept-older"), url)
        st, _, _, raw = call(base, "GET", url[url.index("/feedback/"):], LOCAL, headers=adm)
        check(f"  the screenshot from that link: {st}, the same JPEG", st == 200 and raw == jpg)
        E("PATCH an older bucket's item done", "PATCH", f"/feedback/{old_ids[1]}?source=aws", LOCAL,
          {"status": "done"}, 200, headers=adm)
        stored = json.loads(old.objects[f"feedback/{old_ids[1]}.json"])
        check("  written back to the bucket it came from, without a bucket field, the context kept",
              stored.get("status") == "done" and "bucket" not in stored and stored.get("context") == CTX_DRAWN
              and f"feedback/{old_ids[1]}.json" not in fake.objects)
        _, js = E("GET an id in no readable bucket, with one bucket unreadable: 502, not 404", "GET",
                  "/feedback/" + "c" * 32 + "?source=aws", LOCAL, None, 502, headers=adm)
        check("  names the bucket that could not be read", "kept-oldest" in ((js or {}).get("error") or ""), str(js))
        E("PATCH an id in no readable bucket, with one bucket unreadable: 502, not 404", "PATCH",
          "/feedback/" + "c" * 32 + "?source=aws", LOCAL, {"status": "done"}, 502, headers=adm)
        fake.calls.clear(); old.calls.clear(); gone.calls.clear()
        E("GET the newest bucket's item by id alone", "GET", f"/feedback/{ids[1]}?source=aws", LOCAL, None, 200,
          headers=adm)
        check("  only the newest bucket was asked", fake.calls and not old.calls and not gone.calls,
              f"{fake.calls} {old.calls} {gone.calls}")
        old.fail = fake.fail = "AccessDenied"
        E("GET /feedback?source=aws when no bucket can be read", "GET", "/feedback?source=aws", LOCAL, None, 502,
          headers=adm)
    finally:
        old.fail = fake.fail = None
        local_server.CONFIG.clear()
        local_server.CONFIG.update(saved)

    print("== several buckets: a short page in one bucket never skips its later items")
    # Bucket a holds ids 0..10 with id 3 unreadable, so its page of 10 ends at
    # id 10 with 9 items; bucket b holds 11..30. The merged page must stop at
    # a's own stopping point, or item 10 is never listed.
    a_ids = [f"{i:032x}" for i in range(0, 11)]
    b_ids = [f"{i:032x}" for i in range(11, 31)]
    fa = FakeS3({f"feedback/{i}.json": (b"{not json" if n == 3 else json.dumps({"id": i}).encode())
                 for n, i in enumerate(a_ids)})
    fb = FakeS3({f"feedback/{i}.json": json.dumps({"id": i}).encode() for i in b_ids})
    box = local_server.BucketsInbox([local_server.AwsInbox(fb, "b"), local_server.AwsInbox(fa, "a")])
    got, after = [], None
    for _ in range(20):
        items, after = box.page(after, 10)
        got += [i["id"] for i in items]
        if not after:
            break
    want = [i for n, i in enumerate(a_ids) if n != 3] + b_ids
    check("every readable item over both buckets, each once, in id order", got == want,
          f"missing {sorted(set(want) - set(got))}")

    print("== the aws command line path, with a stand-in for the tool (no AWS)")
    cli = local_server.CliS3("made-up-bucket")
    seen_args = []

    def fake_run(args, data=None):
        seen_args.append((list(args), data))
        class P:
            returncode, stdout, stderr = 0, b"", b""
        p = P()
        if args[:2] == ["s3api", "list-objects-v2"]:
            p.stdout = json.dumps({"Contents": [{"Key": "feedback/a.json"}, {"Key": "feedback/a.jpg"}],
                                   "IsTruncated": True}).encode()
        elif args[:2] == ["s3", "cp"] and args[2].startswith("s3://") and "--recursive" in args:
            dest = args[3]
            for k in [a for i, a in enumerate(args) if i and args[i - 1] == "--include"]:
                if k != "missing.json":
                    with open(os.path.join(dest, k), "wb") as fh:
                        fh.write(b"data of " + k.encode())
        elif args[:2] == ["s3", "cp"] and args[2] == "-":
            pass
        else:
            p.returncode, p.stderr = 1, b"An error occurred (AccessDenied)\n"
        return p
    cli._run = fake_run
    keys, more = cli.list_page("feedback/", "feedback/0.json")
    check("list_page reads keys and IsTruncated, and passes --start-after",
          keys == ["feedback/a.json", "feedback/a.jpg"] and more is True
          and "--start-after" in seen_args[-1][0] and "--no-paginate" in seen_args[-1][0])
    got = cli.get_many(["feedback/x.json", "feedback/missing.json"])
    check("get_many fetches a page with one recursive copy and leaves out what is missing",
          got == {"feedback/x.json": b"data of x.json"} and len(seen_args) == 2)
    cli.put("feedback/x.json", b"{}", "application/json")
    check("put sends the bytes on stdin to s3://bucket/key with the type",
          seen_args[-1][0][:4] == ["s3", "cp", "-", "s3://made-up-bucket/feedback/x.json"]
          and seen_args[-1][1] == b"{}" and "application/json" in seen_args[-1][0])
    try:
        cli._run = lambda args, data=None: type("P", (), {"returncode": 255, "stdout": b"",
                                                          "stderr": b"Unable to locate credentials\n"})()
        cli.list_page("feedback/", None)
        check("a failing aws tool raises AwsError", False)
    except local_server.AwsError as exc:
        check("a failing aws tool raises AwsError with its last line", "credentials" in str(exc))


# ---------------------------------------------------------------- deploy.sh and what it hands to AWS

def deploy_checks():
    """What deploy.sh relies on, without calling AWS: stack_input.py, the
    template's end date and bucket settings, where the local inbox finds the
    bucket, and the script itself."""
    import datetime as dt
    import local_server
    import stack_input as si
    print("== deploy: the end date")
    today = dt.date(2026, 11, 20)
    check("no --until: 60 days on (2027-01-19)", si.end_date(None, today) == ("2027-01-19", None))
    check("--until 2027-03-31 is taken", si.end_date("2027-03-31", today) == ("2027-03-31", None))
    for bad in ("2027-02-30", "03/31/2027", "2027-3-31", "soon", "1999-12-31"):
        check(f"--until {bad} is refused with a sentence", si.end_date(bad, today)[0] is None
              and si.end_date(bad, today)[1])
    check("--until today is taken (feedback runs through the end of the day)",
          si.end_date("2026-11-20", today) == ("2026-11-20", None))
    day, msg = si.end_date("2026-11-19", today)
    check("--until yesterday is refused: feedback would end at once", day is None and "already passed" in msg
          and "--force-date" in msg, msg)
    check("--until a year from today is taken", si.end_date("2027-11-20", today) == ("2027-11-20", None))
    day, msg = si.end_date("2027-11-21", today)
    check("--until a year and a day away is refused", day is None and "more than a year" in msg, msg)
    check("--force-date takes a past date and a far one",
          si.end_date("2026-01-15", today, force=True) == ("2026-01-15", None)
          and si.end_date("2030-06-01", today, force=True) == ("2030-06-01", None))
    check("--force-date still refuses what is not a date, or not 20xx",
          si.end_date("2027-02-30", today, force=True)[0] is None and si.end_date("2100-01-01", today, force=True)[0] is None)
    check("a year on from February 29 is February 28", si._a_year_on(dt.date(2028, 2, 29)) == dt.date(2029, 2, 28))
    check("stack_input.py --end-date 2020-01-01 exits 1; with --force-date it prints the date",
          si.main(["--end-date", "2020-01-01"]) == 1 and si.main(["--end-date", "2020-01-01", "--force-date"]) == 0)
    tpl = open(os.path.join(HERE, "template.yml"), encoding="utf-8").read()
    pat = re.search(r"EndsOn:\n(?:\s+.*\n)*?\s+AllowedPattern: \"(.*)\"", tpl)
    pat = pat.group(1).replace("\\\\", "\\") if pat else None
    check("template.yml's EndsOn takes a date or nothing, and nothing else",
          bool(pat) and all(bool(re.fullmatch(pat, v)) == ok for v, ok in
                            (("2027-01-19", True), ("", True), ("2027-13-01", False), ("2027-1-19", False),
                             ("tomorrow", False))), str(pat))
    check("the function gets FEEDBACK_ENDS_ON and WRONG_CODES_ALL_PER_WINDOW from the stack",
          "FEEDBACK_ENDS_ON: !Ref EndsOn" in tpl and "WRONG_CODES_ALL_PER_WINDOW: !Ref WrongCodesAllPerWindow" in tpl)
    m = re.search(r"  FeedbackBucket:\n    Type: AWS::S3::Bucket\n    DeletionPolicy: (\S+)\n    UpdateReplacePolicy: (\S+)", tpl)
    check("the bucket is kept when the stack is deleted or the bucket replaced",
          bool(m) and m.group(1).startswith("Retain") and m.group(2) == "Retain", m.group(0) if m else "")

    print("== deploy: stack_input.py")
    tmp = tempfile.mkdtemp(prefix="feedback_deploy_test_")
    try:
        env = os.path.join(tmp, "env")
        salt_file = os.path.join(tmp, "salt")
        made = secrets.token_hex(10)
        with open(env, "w") as fh:
            fh.write(f"FEEDBACK_SITE_CODE={made}\nVITE_FEEDBACK_ADMIN_CODE={secrets.token_hex(12)}\n")
        p1, note1 = si.code_params(env, salt_file)
        p2, note2 = si.code_params(env, salt_file)
        check("the salt is made once and kept for the next deploy, so the hash and the caps stay",
              p1 == p2 and "new salt" in note1 and "kept" in note2
              and p1["CodeHashFeedback"] == hashlib.sha256((p1["CodeSalt"] + made).encode()).hexdigest())
        check("the salt file is readable by its owner only", (os.stat(salt_file).st_mode & 0o077) == 0)
        check("the note never holds the code or the salt", made not in note1 + note2 and p1["CodeSalt"] not in note1)
        with open(env, "w") as fh:
            fh.write(f"FEEDBACK_SITE_CODE={made}\nVITE_FEEDBACK_ADMIN_CODE={made}\n")
        try:
            si.code_params(env, salt_file)
            check("the same code for testers and the inbox is refused", False)
        except SystemExit as exc:
            check("the same code for testers and the inbox is refused", "must differ" in str(exc) and made not in str(exc))
        current = {"Stacks": [{"Parameters": [{"ParameterKey": k, "ParameterValue": "x"} for k in
                                              ("ServiceOn", "EndsOn", "RateLimitOn", "CodeSalt", "CodeHashFeedback")]}]}
        out = si.build("s", {"ServiceOn": "true"}, current, previous_template=True)
        keep = {p["ParameterKey"] for p in out["Parameters"] if p.get("UsePreviousValue")}
        check("turning on or off: the deployed template and every other setting kept",
              out.get("UsePreviousTemplate") is True and "TemplateBody" not in out
              and keep == {"EndsOn", "RateLimitOn", "CodeSalt", "CodeHashFeedback"}
              and {"ParameterKey": "ServiceOn", "ParameterValue": "true"} in out["Parameters"]
              and out["Capabilities"] == ["CAPABILITY_IAM"])
        out = si.build("s", {"EndsOn": "2027-03-31"}, current, template_body="tpl")
        check("a full update: the new template, --until set, the rest kept",
              out.get("TemplateBody") == "tpl" and "UsePreviousTemplate" not in out
              and {"ParameterKey": "EndsOn", "ParameterValue": "2027-03-31"} in out["Parameters"]
              and not any(p["ParameterKey"] == "EndsOn" and p.get("UsePreviousValue") for p in out["Parameters"]))
        out = si.build("s", {"ServiceOn": "false"}, None, template_body="tpl")
        check("a first deploy: only what is set, nothing kept", out["Parameters"] == [
            {"ParameterKey": "ServiceOn", "ParameterValue": "false"}])

        names = si.template_params(tpl)
        check("the settings template.yml has are read from it (20, ServiceOn and EndsOn among them)",
              names is not None and len(names) == 20 and {"ServiceOn", "EndsOn", "BucketName", "CodeSalt"} <= names,
              str(sorted(names or [])))
        check("a JSON template's settings are read too, and none found gives None",
              si.template_params('{"Parameters": {"A": {}, "B": {}}}') == {"A", "B"}
              and si.template_params("Resources:\n  X: 1\n") is None and si.template_params("") is None)
        old = {"Stacks": [{"Parameters": [{"ParameterKey": k, "ParameterValue": "x"} for k in
                                          ("ServiceOn", "EndsOn", "RateLimitOn", "OldSetting")]}]}
        out = si.build("s", {"EndsOn": "2027-03-31"}, old, template_body=tpl)
        keep = {p["ParameterKey"] for p in out["Parameters"] if p.get("UsePreviousValue")}
        check("a full update keeps only the settings the new template still has",
              keep == {"ServiceOn", "RateLimitOn"} and "OldSetting" not in json.dumps(out["Parameters"]), str(keep))
        check("  and names the one dropped", si.kept_params(old, {"EndsOn": "x"}, names)[1] == ["OldSetting"])
        out = si.build("s", {"ServiceOn": "true"}, old, previous_template=True)
        check("turning on or off keeps every setting, the old one too (the template is the deployed one)",
              {p["ParameterKey"] for p in out["Parameters"] if p.get("UsePreviousValue")}
              == {"EndsOn", "RateLimitOn", "OldSetting"})
        try:
            si.build("s", {"RateLimtOn": "false"}, old, template_body=tpl)
            check("a setting the template does not have is refused before AWS", False)
        except SystemExit as exc:
            check("a setting the template does not have is refused before AWS", "RateLimtOn" in str(exc))
        dest = os.path.join(tmp, "input.json")
        with open(env, "w") as fh:
            fh.write(f"FEEDBACK_SITE_CODE={made}\n")
        real_salt = os.path.isfile(si.SALT_FILE)
        rc = si.main(["--stack", "s", "--template", os.path.join(HERE, "template.yml"), "--code-from", env,
                      "--salt-file", salt_file, "--set", "ServiceOn=false", "--out", dest])
        check("the checks never make or change the real feedback_api/.deploy_salt",
              os.path.isfile(si.SALT_FILE) == real_salt)
        with open(dest) as fh:
            data = json.load(fh)
        check("the input file is written for its owner only, with the hash and not the code",
              rc == 0 and (os.stat(dest).st_mode & 0o077) == 0 and made not in json.dumps(data)
              and {p["ParameterKey"] for p in data["Parameters"]} == {"ServiceOn", "CodeSalt", "CodeHashFeedback"})
        try:
            si.parse_sets(["RateLimitOn"])
            check("a setting with no value is refused", False)
        except SystemExit:
            check("a setting with no value is refused", True)

        print("== deploy: the list of kept buckets, and where the local inbox finds them")
        bf = os.path.join(tmp, ".bucket")
        D = local_server.DEFAULT_BUCKET
        check("with nothing set: the template's default bucket", local_server.inbox_buckets({}, bf) == [D])
        with open(bf, "w") as fh:
            fh.write(f"{D}\n")
        check("a one-line file from before the list reads as a list of one",
              si.kept_buckets(bf) == [D] and local_server.inbox_buckets({}, bf) == [D])
        si.keep_bucket(f"{D}-20270120", bf)
        si.keep_bucket(f"{D}-20270120-2", bf)
        check("each deploy adds its bucket below the others, and none is lost",
              si.kept_buckets(bf) == [D, f"{D}-20270120", f"{D}-20270120-2"])
        si.keep_bucket(f"{D}-20270120", bf)
        check("a bucket listed already moves to the end once, as the newest",
              si.kept_buckets(bf) == [D, f"{D}-20270120-2", f"{D}-20270120"])
        try:
            si.keep_bucket("Not A Bucket", bf)
            check("a name that is not a bucket name is refused", False)
        except SystemExit:
            check("a name that is not a bucket name is refused", si.kept_buckets(bf)[-1] == f"{D}-20270120")
        check("the local inbox reads every kept bucket, oldest first",
              local_server.inbox_buckets({}, bf) == [D, f"{D}-20270120-2", f"{D}-20270120"])
        check("--newest-only reads the last one",
              local_server.inbox_buckets({}, bf, newest_only=True) == [f"{D}-20270120"])
        check("FEEDBACK_BUCKET wins over the file",
              local_server.inbox_buckets({"FEEDBACK_BUCKET": "other-bucket"}, bf) == ["other-bucket"])
        check("FEEDBACK_INBOX_BUCKET wins over both",
              local_server.inbox_buckets({"FEEDBACK_INBOX_BUCKET": "inbox-b", "FEEDBACK_BUCKET": "x"}, bf) == ["inbox-b"])
        with open(bf, "w") as fh:
            fh.write("not a bucket name!\n\n")
        check("lines that are not bucket names are passed over",
              local_server.inbox_buckets({}, bf) == [D] and si.kept_buckets(bf) == [])
        rc = si.main(["--keep-bucket", "from-the-command-line", "--bucket-file", bf])
        check("stack_input.py --keep-bucket writes the file deploy.sh uses",
              rc == 0 and si.kept_buckets(bf) == ["from-the-command-line"])
        check("  and keeps the line it could not read, as it was",
              open(bf).read().splitlines()[0] == "not a bucket name!")
        with open(bf, "w") as fh:
            fh.write(f"{D}-handmade  # from the other Mac\n{D}\n")
        check("a name added by hand with a note after it is read by both",
              si.kept_buckets(bf) == [f"{D}-handmade", D]
              and local_server.inbox_buckets({}, bf) == [f"{D}-handmade", D])
        si.keep_bucket(f"{D}-20270121", bf)
        check("  and survives the next deploy's write, note and all",
              open(bf).read() == f"{D}-handmade  # from the other Mac\n{D}\n{D}-20270121\n"
              and not os.path.exists(bf + ".tmp"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("== deploy: the script")
    sh = open(os.path.join(HERE, "deploy.sh"), encoding="utf-8").read()
    p = subprocess.run(["bash", "-n", os.path.join(HERE, "deploy.sh")], capture_output=True, text=True)
    check("deploy.sh parses", p.returncode == 0, p.stderr)
    check("no salt, hash or code on an aws command line (they go in a file, --cli-input-json)",
          "--parameter-overrides" not in sh and "CodeSalt=" not in sh and "CodeHashFeedback=" not in sh
          and "--cli-input-json" in sh)
    check("turning on or off keeps the deployed template", sh.count("--previous-template") >= 2)
    check("the concurrency check follows EXTRA_PARAMS Concurrency", "NEED=$(( 100 + CONC ))" in sh)
    check("--remove lists the bucket before the stack goes", sh.index('keep_bucket "$BUCKET"')
          < sh.index("aws cloudformation delete-stack --stack-name \"$STACK\"\n    echo \"Waiting"))
    check("nothing in deploy.sh overwrites the bucket list", '> "$BUCKET_FILE"' not in sh)
    for args, want in ((["--until", "2027-02-30"], "not a real date"), (["--remove", "--turn-on"], "on its own"),
                       (["--bogus"], "Unknown option"), (["--until", "2020-01-01"], "already passed"),
                       (["--until", "2099-01-01"], "more than a year"), (["--force-date"], "goes with --until")):
        p = subprocess.run(["bash", os.path.join(HERE, "deploy.sh"), *args], capture_output=True, text=True,
                           timeout=30)
        check(f"deploy.sh {' '.join(args)} stops before calling AWS: {want!r}",
              p.returncode == 2 and want in p.stderr, p.stderr[-200:])


# A stand-in for the aws command line tool, put first on PATH for deploy.sh,
# so its bucket naming and --remove can be run end to end without AWS. It
# logs every call and answers only what those paths ask; anything else
# fails loudly, so a path that would change something real shows up.
FAKE_AWS = r'''#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
with open(os.environ["FAKE_AWS_LOG"], "a") as fh:
    fh.write(json.dumps(a) + "\n")
def arg(name):
    return a[a.index(name) + 1] if name in a else ""
q = arg("--query")
taken = [b for b in os.environ.get("FAKE_TAKEN", "").split(",") if b]
if a[:2] == ["cloudformation", "describe-stacks"]:
    if arg("--stack-name") == "road-network-connectivity":
        print("arn:aws:acm:us-east-1:000000000000:certificate/made-up" if "CertificateArn" in q else "ZMADEUP")
        sys.exit(0)
    status = os.environ.get("FAKE_STATUS", "NONE")
    if status == "NONE":
        sys.stderr.write("An error occurred (ValidationError): Stack does not exist\n")
        sys.exit(254)
    if "StackStatus" in q:
        print(status)
    elif "Outputs" in q and "BucketName" in q:
        print(os.environ.get("FAKE_OUTPUT_BUCKET") or "None")
    elif "Parameters" in q and "BucketName" in q:
        print(os.environ.get("FAKE_PARAM_BUCKET") or "None")
    else:
        print("None")
    sys.exit(0)
if a[:2] == ["acm", "describe-certificate"]:
    print("ISSUED" if "Status" in q else "*.nemac.org\tnemac.org")
    sys.exit(0)
if a[:2] == ["lambda", "get-account-settings"]:
    print("1000")
    sys.exit(0)
# FAKE_HEAD_FAIL: bucket=answer pairs, for head-bucket answers other than
# found (FAKE_TAKEN) and 404 (the rest): throttle, 403 or 301
fails = dict(x.split("=", 1) for x in os.environ.get("FAKE_HEAD_FAIL", "").split(",") if "=" in x)
if a[:2] == ["s3api", "head-bucket"]:
    if arg("--bucket") in taken:
        sys.exit(0)
    how = fails.get(arg("--bucket"))
    if how == "throttle":
        sys.stderr.write("An error occurred (SlowDown) when calling the HeadBucket operation: Please reduce your request rate.\n")
        sys.exit(254)
    if how == "403":
        sys.stderr.write("An error occurred (403) when calling the HeadBucket operation: Forbidden\n")
        sys.exit(254)
    if how == "301":
        sys.stderr.write("An error occurred (301) when calling the HeadBucket operation: Moved Permanently\n")
        sys.exit(254)
    sys.stderr.write("An error occurred (404) when calling the HeadBucket operation: Not Found\n")
    sys.exit(254)
if a[:2] in (["cloudformation", "delete-stack"], ["cloudformation", "wait"]):
    sys.exit(0)
sys.stderr.write("the stand-in aws tool was not expecting: " + " ".join(a) + "\n")
sys.exit(99)
'''


def deploy_sh_checks():
    """deploy.sh itself, with the stand-in aws tool: the new bucket's name
    after one and two removes on the same day, and what --remove lists."""
    print("== deploy: deploy.sh with a stand-in for the aws tool (no AWS)")
    tmp = tempfile.mkdtemp(prefix="feedback_deploy_sh_")
    try:
        bindir = os.path.join(tmp, "bin")
        os.makedirs(bindir)
        tool = os.path.join(bindir, "aws")
        with open(tool, "w") as fh:
            fh.write(FAKE_AWS)
        os.chmod(tool, 0o755)
        bf, logf = os.path.join(tmp, ".bucket"), os.path.join(tmp, "aws.log")
        D = "nemac-road-network-feedback"
        today = time.strftime("%Y%m%d")

        def run(args, bucket_list=None, **fake):
            if bucket_list is None:
                if os.path.exists(bf):
                    os.remove(bf)
            else:
                with open(bf, "w") as fh:
                    fh.write("".join(b + "\n" for b in bucket_list))
            if os.path.exists(logf):
                os.remove(logf)
            env = {k: v for k, v in os.environ.items() if not k.startswith(("FAKE_", "EXTRA_PARAMS", "AWS_"))}
            env.update(PATH=bindir + os.pathsep + os.environ.get("PATH", ""), FEEDBACK_BUCKET_FILE=bf,
                       FAKE_AWS_LOG=logf, ENV_FILE=os.path.join(tmp, "no_env_file"),
                       **{f"FAKE_{k.upper()}": v for k, v in fake.items()})
            if "--remove" not in args:
                env["FEEDBACK_DEPLOY_CHECK_ONLY"] = "1"
            p = subprocess.run(["bash", os.path.join(HERE, "deploy.sh"), *args], capture_output=True, text=True,
                               timeout=60, env=env)
            calls = []
            if os.path.exists(logf):
                with open(logf) as fh:
                    calls = [json.loads(x) for x in fh]
            kept = open(bf).read().split() if os.path.exists(bf) else None
            return p, calls, kept

        def changed(calls):
            return [c for c in calls if c[:2] in (["cloudformation", "create-stack"], ["cloudformation", "update-stack"],
                                                  ["cloudformation", "delete-stack"])]

        p, calls, _ = run([])
        check("a first deploy with the name free keeps it, and changes nothing in a check-only run",
              p.returncode == 0 and f"The bucket name {D} is free." in p.stdout and not changed(calls),
              p.stdout[-300:] + p.stderr[-300:])
        p, calls, _ = run([], taken=D)
        check(f"after one remove (the name taken, no list on this computer): {D}-{today}",
              p.returncode == 0 and f"This deploy makes the bucket {D}-{today}." in p.stdout
              and "does not list it" in p.stdout, p.stdout[-400:] + p.stderr[-300:])
        p, calls, _ = run([], [D, f"{D}-{today}"])
        check(f"after two removes the same day: {D}-{today}-2, since a listed name counts as taken whatever AWS says",
              p.returncode == 0 and f"This deploy makes the bucket {D}-{today}-2." in p.stdout
              and f"Earlier feedback stays in {D}, {D}-{today}" in p.stdout and not changed(calls),
              p.stdout[-400:] + p.stderr[-300:])
        p, calls, _ = run([], [D], taken=f"{D},{D}-{today},{D}-{today}-2")
        check(f"and {D}-{today}-3 when -2 is taken too",
              p.returncode == 0 and f"This deploy makes the bucket {D}-{today}-3." in p.stdout,
              p.stdout[-400:] + p.stderr[-300:])
        p, calls, _ = run([], [D], status="ROLLBACK_COMPLETE")
        check("a check-only run on a failed first deploy deletes nothing",
              p.returncode == 0 and not changed(calls), p.stdout[-300:] + p.stderr[-300:])
        p = subprocess.run(["bash", os.path.join(HERE, "deploy.sh"), "--remove"], capture_output=True, text=True,
                           timeout=30, env={**os.environ, "FEEDBACK_DEPLOY_CHECK_ONLY": "1",
                                            "PATH": bindir + os.pathsep + os.environ.get("PATH", ""),
                                            "FAKE_AWS_LOG": logf, "FEEDBACK_BUCKET_FILE": bf})
        check("a check-only --remove is refused before anything runs",
              p.returncode == 2 and "plain deploy only" in p.stderr, p.stderr[-200:])

        p, calls, kept = run(["--remove", "--yes"], [D], status="UPDATE_COMPLETE",
                             output_bucket=f"{D}-{today}", taken=f"{D},{D}-{today}")
        check("--remove adds the stack's bucket below the earlier one, before the stack goes",
              p.returncode == 0 and kept == [D, f"{D}-{today}"] and changed(calls)
              and calls.index(["s3api", "head-bucket", "--bucket", f"{D}-{today}"]) < calls.index(changed(calls)[0]),
              p.stdout[-300:] + p.stderr[-300:])
        p, calls, kept = run(["--remove", "--yes"], [D], status="ROLLBACK_COMPLETE", param_bucket=f"{D}-{today}",
                             taken=f"{D},{D}-{today}")
        check("--remove after a failed first deploy lists nothing, and keeps the list as it was",
              p.returncode == 0 and kept == [D] and "not listed" in p.stdout, p.stdout[-300:] + p.stderr[-300:])
        p, calls, kept = run(["--remove", "--yes"], [D], status="UPDATE_ROLLBACK_COMPLETE",
                             output_bucket=f"{D}-{today}", taken=D)
        check("--remove lists no bucket that is not really there",
              p.returncode == 0 and kept == [D] and "not listed" in p.stdout, p.stdout[-300:] + p.stderr[-300:])
        p, calls, kept = run(["--remove", "--yes"], [D], status="UPDATE_COMPLETE",
                             output_bucket=f"{D}-{today}", taken=D, head_fail=f"{D}-{today}=throttle")
        check("--remove still lists the stack's bucket when AWS cannot say whether it is there",
              p.returncode == 0 and kept == [D, f"{D}-{today}"] and "could not be checked" in p.stdout,
              p.stdout[-300:] + p.stderr[-300:])
        p, calls, kept = run(["--remove", "--yes"], [D], status="UPDATE_COMPLETE",
                             output_bucket=f"{D}-{today}", taken=D, head_fail=f"{D}-{today}=403")
        check("--remove lists the stack's bucket when this login may not look at it (403)",
              p.returncode == 0 and kept == [D, f"{D}-{today}"], p.stdout[-300:] + p.stderr[-300:])
        p, calls, _ = run([], head_fail=f"{D}=throttle")
        check("a deploy stops, changing nothing, when AWS cannot say whether the bucket name is free",
              p.returncode == 1 and "Could not tell whether" in p.stderr and not changed(calls),
              p.stdout[-300:] + p.stderr[-300:])
        p, calls, _ = run([], head_fail=f"{D}=301")
        check(f"a bucket name in use in another region (301) counts as taken: {D}-{today}",
              p.returncode == 0 and f"This deploy makes the bucket {D}-{today}." in p.stdout,
              p.stdout[-300:] + p.stderr[-300:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- the deployed function

def live_checks(post):
    base = os.environ.get("FEEDBACK_LIVE_BASE", LIVE_BASE)
    E = lambda *a, **k: expect(base, *a, **k)   # noqa: E731
    print(f"== live at {base}")
    _, js = E("GET /health, the site", "GET", "/health", SITE, None, 200, cors=True)
    check("  says it is on", (js or {}).get("on") is True)
    E("GET /health, another nemac.org page", "GET", "/health", "https://www.nemac.org", None, 200, cors=True)
    for o in (OTHER, "https://evil-nemac.org", "https://nemac.org.evil.com", None):
        E(f"GET /health, {o or 'no Origin'} (refused at CloudFront)", "GET", "/health", o, None, 403, cors=False)
    status, hdrs, _, _ = call(base, "OPTIONS", "/feedback", SITE)
    check(f"OPTIONS /feedback, the site: {status} (want 204)", status == 204
          and hdrs.get("Access-Control-Allow-Origin") == SITE)
    E("GET /feedback: no inbox on AWS", "GET", "/feedback", SITE, None, 404, headers={"x-feedback-admin": "x"})
    E("PATCH /feedback/<id>: no inbox on AWS", "PATCH", "/feedback/" + "0" * 32, SITE, {"status": "done"}, 404,
      sha=True)
    if post:
        fc = code("FEEDBACK_CODE", "FEEDBACK_SITE_CODE")
        item = {**FB_COMMENT, "name": "Live check", "text": "A check after a deploy. Remove me."}
        status, js = E("POST /feedback, testers' code (one item)", "POST", "/feedback", SITE,
                       {"code": fc, "item": item}, 201, cors=True, sha=True)
        if status == 201:
            print(f"Remove it with your AWS login: aws s3 rm s3://{os.environ.get('FEEDBACK_INBOX_BUCKET', 'nemac-road-network-feedback')}"
                  f"/feedback/{js['id']}.json")


def main():
    args = sys.argv[1:]
    if "--live" in args:
        live_checks("--post" in args)
        summary()
        return
    what = args[0] if args else "all"
    if what not in ("all", "running", "deploy", "own", "aws"):
        sys.exit(f"Unknown group {what!r}: say own, deploy, aws, running or --live.")
    # "running" talks to the server the viewer uses, so only when asked for
    if what == "running":
        running_checks()
    if what in ("all", "deploy"):
        deploy_checks()
        deploy_sh_checks()
    if what in ("all", "own", "aws"):
        fake = FakeS3({})
        info = start_own_server(fake)
        try:
            if what in ("all", "own"):
                own_checks(info)
                delete_checks(info, fake)
            if what in ("all", "aws"):
                aws_checks(info, fake)
        finally:
            info[0].shutdown()
            shutil.rmtree(info[4], ignore_errors=True)
    summary()
    sys.exit(0 if all(RESULTS) else 1)


if __name__ == "__main__":
    main()
