#!/usr/bin/env python3
"""Façades step 2 (houses17): pull the ACT oblique-photo texture atlases the façade area needs out of the 5.4 GB
Luxembourg-Ville zip of "Bâtiments 3D 2023" (CC0) with HTTP range requests - only the listed members are read.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/facade_fetch.py [area.json] [--reuse <dir>]

--reuse <dir>: texture JPEGs already on disk (e.g. the houses research download) are hard-linked instead of fetched.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from facade_area import TEX_DIR, WORK, ZIP_TEX_PREFIX, ZIP_URL  # noqa: E402

UA = "ian-site-luxdrive/1.0 (https://ian.lu)"
TIMEOUT_S = 120


class HttpFile(io.RawIOBase):
    """A seekable read-only file over HTTP range requests (what zipfile needs to read single members)."""

    def __init__(self, url):
        super().__init__()
        self.url, self.pos, self.fetched = url, 0, 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        self.size = int(urllib.request.urlopen(req, timeout=TIMEOUT_S).headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={"User-Agent": UA, "Range": f"bytes={self.pos}-{end}"})
        data = urllib.request.urlopen(req, timeout=TIMEOUT_S).read()
        self.fetched += len(data)
        self.pos += len(data)
        return data

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def main():
    args = sys.argv[1:]
    reuse = None
    if "--reuse" in args:
        i = args.index("--reuse")
        reuse = os.path.expanduser(args[i + 1])
        args = args[:i] + args[i + 2:]
    area_path = args[0] if args else os.path.join(WORK, "act", "area.json")
    area = json.load(open(area_path))
    names = sorted({v[0] for v in area["tex"].values()})
    os.makedirs(TEX_DIR, exist_ok=True)
    todo = []
    for n in names:
        dst = os.path.join(TEX_DIR, n)
        if os.path.exists(dst):
            continue
        src = os.path.join(reuse, n) if reuse else None
        if src and os.path.exists(src):
            os.link(src, dst)
        else:
            todo.append(n)
    print(f"facade_fetch: {len(names)} images, {len(names) - len(todo)} on disk, {len(todo)} to fetch")
    if not todo:
        return
    raw = HttpFile(ZIP_URL)
    z = zipfile.ZipFile(io.BufferedReader(raw, buffer_size=1 << 20))
    have = set(z.namelist())
    missing = [n for n in todo if ZIP_TEX_PREFIX + n not in have]
    if missing:
        raise SystemExit(f"facade_fetch: {len(missing)} images are not in the zip, e.g. {missing[:3]}")
    for k, n in enumerate(todo):
        tmp = os.path.join(TEX_DIR, n + ".part")
        with open(tmp, "wb") as f:
            f.write(z.read(ZIP_TEX_PREFIX + n))
        os.replace(tmp, os.path.join(TEX_DIR, n))
        if k % 50 == 0:
            print(f"  {k}/{len(todo)}  {raw.fetched / 1e6:.0f} MB", flush=True)
    print(f"facade_fetch: done, {raw.fetched / 1e6:.0f} MB over HTTP")


if __name__ == "__main__":
    main()
