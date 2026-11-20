"""
Print one value from a dotenv file, read the way Vite (dotenv) reads it
======================================================================
    python3 feedback_api/envval.py <file> <NAME>

Used by deploy.sh, local_server.py and test.py to read the feedback codes
from the viewer's .env.development.local, so the server checks exactly the
code the dev server would send. The rules follow dotenv's: an optional
"export ", spaces around "=", a value in single, double or back quotes kept as
written (double quotes turn \\n into a new line), and in an unquoted value a
" #" starts a comment. The last line naming NAME wins. Prints nothing when
NAME is missing. Standard library only. (A copy of the analysis repo's
ondemand_api/envval.py, so this folder stands on its own.)
"""

import re
import sys

LINE = re.compile(r"""^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$""",
                  re.MULTILINE)


def read(path, name):
    with open(path, encoding="utf-8") as fh:
        text = fh.read().replace("\r\n", "\n").replace("\r", "\n")
    found = None
    for m in LINE.finditer(text):
        if m.group(1) != name:
            continue
        v = (m.group(2) or "").strip()
        q = v[:1]
        v = re.sub(r"^(['\"`])([\s\S]*)\1$", r"\2", v)
        if q == '"':
            v = v.replace("\\n", "\n").replace("\\r", "\r")
        found = v
    return found


if __name__ == "__main__":
    v = read(sys.argv[1], sys.argv[2])
    if v:
        sys.stdout.write(v)
