#!/usr/bin/env python3
"""Reference photos of a station from Wikimedia Commons (upload.wikimedia.org thumbnails, 1280 px) into ~/Library/Caches/zuch-refs/<Dir>/ (outside the repo: the repo is public).
    python3 scripts/zuch/fetch_refs.py <Dir> "search term" ["search term" ...] [--max 10]
Writes credits.json (title, author, licence, page URL) next to the images."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

UA = "ian.lu-zuch-sim/1.0 (konto@ian.lu)"
API = "https://commons.wikimedia.org/w/api.php"
OUT = os.path.expanduser("~/Library/Caches/zuch-refs")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    args = sys.argv[1:]
    mx = 10
    if "--max" in args:
        i = args.index("--max")
        mx = int(args[i + 1])
        del args[i:i + 2]
    d, terms = args[0], args[1:]
    os.makedirs(os.path.join(OUT, d), exist_ok=True)
    credits, seen = [], set()
    for term in terms:
        q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrsearch": "filetype:bitmap " + term, "gsrnamespace": 6, "gsrlimit": 30,
                                    "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 1280})
        data = json.loads(get(API + "?" + q))
        pages = sorted((data.get("query", {}).get("pages", {})).values(), key=lambda p: p.get("index", 0))
        for p in pages:
            if len(credits) >= mx:
                break
            ii = (p.get("imageinfo") or [{}])[0]
            title = p["title"]
            if title in seen or not ii.get("thumburl") or ii.get("width", 0) < 900:
                continue
            seen.add(title)
            meta = ii.get("extmetadata", {})
            name = re.sub(r"[^A-Za-z0-9._-]+", "_", title.replace("File:", ""))[:90]
            if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                name += ".jpg"
            path = os.path.join(OUT, d, name)
            if not os.path.exists(path):
                try:
                    open(path, "wb").write(get(ii["thumburl"]))
                except Exception as e:  # noqa: BLE001
                    print("skip", title, e)
                    continue
            credits.append({"file": name, "title": title, "author": re.sub("<[^>]+>", "", meta.get("Artist", {}).get("value", "")), "licence": meta.get("LicenseShortName", {}).get("value", ""),
                            "page": ii.get("descriptionurl", "")})
            print("ok", name)
    old = []
    cp = os.path.join(OUT, d, "credits.json")
    if os.path.exists(cp):
        old = json.load(open(cp))
    have = {c["file"] for c in credits}
    json.dump(credits + [c for c in old if c["file"] not in have], open(cp, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
