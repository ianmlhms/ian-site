#!/usr/bin/env python3
"""R8d: tiny client for scripts/ski/r8c-drv.mjs.
    r8d-drv.py <port> run <file.js | -c 'js body'>     POST the body to the driver's page (async fn body, `return` a value)
    r8d-drv.py <port> goto '<query string>'             load pb/ski.html?<query>
    r8d-drv.py <port> shot <name>                       screenshot -> <out>/<engine>-<name>.png
Prints the JSON result."""
import json
import sys
import urllib.parse
import urllib.request


def call(port, path, body=None, timeout=2400):
    req = urllib.request.Request("http://127.0.0.1:%s%s" % (port, path), data=body.encode() if body is not None else None, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode()
    except urllib.error.HTTPError as e:
        return e.read().decode()


def main():
    port, cmd = sys.argv[1], sys.argv[2]
    if cmd == "run":
        body = sys.argv[4] if sys.argv[3] == "-c" else open(sys.argv[3]).read()
        out = call(port, "/" + "ev" + "al", body)
    elif cmd == "goto":
        out = call(port, "/goto?q=" + urllib.parse.quote(sys.argv[3]))
    elif cmd == "shot":
        out = call(port, "/shot?name=" + urllib.parse.quote(sys.argv[3]))
    else:
        out = call(port, "/" + cmd)
    try:
        print(json.dumps(json.loads(out), indent=1, ensure_ascii=False))
    except ValueError:
        print(out)


if __name__ == "__main__":
    main()
