#!/usr/bin/env python3
"""Lux Drive: reference photos of a landmark from Wikimedia Commons, for the side-by-side QA (never shipped in the game).

    python3 -I scripts/luxdrive/fetch_ref.py "Category:Cathédrale Notre-Dame de Luxembourg" outdir [--n 4] [--list]

One request per 5 seconds, a User-Agent with a contact (the rules of the Wikimedia API).  Saves thumbnails (900 px wide jpg) and a
credits.txt (title, author, licence) next to them.  --list only prints the files of the category."""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "ian-site-luxdrive/1.0 (konto@ian.lu)"
API = "https://commons.wikimedia.org/w/api.php"
GAP = 5.0
_last = [0.0]


def api(params):
    wait = GAP - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                _last[0] = time.time()
                return json.load(r)
        except Exception as e:
            _last[0] = time.time()
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"Commons did not answer: {url}")


def members(cat, limit=60):
    d = api({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmtype": "file", "cmlimit": limit})
    return [m["title"] for m in d["query"]["categorymembers"]]


def download(title, outdir):
    d = api({"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 900})
    page = next(iter(d["query"]["pages"].values()))
    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})
    strip = lambda k: re.sub(r"<[^>]+>", "", meta.get(k, {}).get("value", ""))
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", title.replace("File:", ""))[:60]
    if not name.lower().endswith((".jpg", ".jpeg")):
        name += ".jpg"
    time.sleep(GAP)
    with urllib.request.urlopen(urllib.request.Request(info["thumburl"], headers={"User-Agent": UA}), timeout=90) as r:
        data = r.read()
    path = os.path.join(outdir, name)
    open(path, "wb").write(data)
    open(os.path.join(outdir, "credits.txt"), "a").write(f"{name}\t{title}\t{strip('Artist')}\t{strip('LicenseShortName')}\n")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("category")
    ap.add_argument("outdir")
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--pick", action="append", default=[], help="a substring of a title to take (repeatable); default: the first n")
    a = ap.parse_args()
    files = members(a.category)
    if a.list:
        print("\n".join(files))
        return
    os.makedirs(a.outdir, exist_ok=True)
    chosen = [f for p in a.pick for f in files if p.lower() in f.lower()][: a.n] if a.pick else files[: a.n]
    for t in chosen:
        print(download(t, a.outdir))


if __name__ == "__main__":
    main()
