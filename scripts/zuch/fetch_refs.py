#!/usr/bin/env python3
"""Reference photos for a station from Wikimedia Commons (kept OUTSIDE the repo, ~/Library/Caches/zuch-refs/<Station>/).

    python3 scripts/zuch/fetch_refs.py <Station> "search term" ["another term" ...] [--cat "Category:Name"] [--max 12] [--width 1280]

Searches the File namespace for every term (and lists the files of a category with --cat), downloads a 1280 px rendition of each hit (upload.wikimedia.org only).
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "ian.lu-zuch-sim/1.0 (konto@ian.lu)"
API = "https://commons.wikimedia.org/w/api.php"
OUT = os.path.expanduser("~/Library/Caches/zuch-refs")


def api(params, tries=6):
    url = API + "?" + urllib.parse.urlencode(dict(params, format="json"))
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries - 1:
                wait = float(e.headers.get("Retry-After", 8 * (attempt + 1))) if e.headers else 8 * (attempt + 1)
                time.sleep(min(wait, 60))
                continue
            raise


def main():
    args = sys.argv[1:]
    mx, width, cat, match = 12, 1280, None, None
    for flag in ("--max", "--width", "--cat", "--match"):
        if flag in args:
            i = args.index(flag)
            v = args[i + 1]
            del args[i:i + 2]
            if flag == "--max":
                mx = int(v)
            elif flag == "--width":
                width = int(v)
            elif flag == "--match":
                match = re.compile(v, re.I)
            else:
                cat = v
    station, terms = args[0], args[1:]
    titles = []
    for t in terms:
        d = api({"action": "query", "list": "search", "srsearch": t, "srnamespace": 6, "srlimit": 30})
        titles += [x["title"] for x in d["query"]["search"]]
    if cat:
        d = api({"action": "query", "list": "categorymembers", "cmtitle": cat, "cmtype": "file", "cmlimit": 60})
        titles += [x["title"] for x in d["query"]["categorymembers"]]
    seen, uniq = set(), []
    for t in titles:
        if t not in seen and t.lower().endswith((".jpg", ".jpeg", ".png")):
            seen.add(t)
            uniq.append(t)
    if match:
        uniq = [t for t in uniq if match.search(t)]
    uniq = uniq[:mx]
    dest = os.path.join(OUT, station)
    os.makedirs(dest, exist_ok=True)
    for t in uniq:
        d = api({"action": "query", "titles": t, "prop": "imageinfo", "iiprop": "url|size", "iiurlwidth": width})
        page = next(iter(d["query"]["pages"].values()))
        ii = (page.get("imageinfo") or [None])[0]
        if not ii:
            continue
        url = (ii.get("thumburl") or ii["url"]).split("?")[0].replace("https://thumb.wikimedia.org/", "https://upload.wikimedia.org/")
        if not url.startswith("https://upload.wikimedia.org/"):
            continue
        fn = os.path.join(dest, t.replace("File:", "").replace("/", "_"))
        if os.path.exists(fn):
            print("have", fn)
            continue
        for attempt in range(5):
            try:
                time.sleep(2.0)
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                    data = r.read()
                with open(fn, "wb") as f:
                    f.write(data)
                print("ok  ", os.path.basename(fn), ii["width"], "x", ii["height"])
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(8 * (attempt + 1))
                    continue
                print("FAIL", t, e)
                break
            except Exception as e:
                print("FAIL", t, e)
                break


if __name__ == "__main__":
    main()
