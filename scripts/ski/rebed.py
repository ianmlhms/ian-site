#!/usr/bin/env python3
"""Re-bake only the TERRAIN of resorts that are already live (road beds, 28 Nov 2026), leaving everything else as committed.

    python3 scripts/ski/rebed.py killy 3vallees ...

bake.py rewrites every output of a resort, and its code has moved on since the older resorts were baked (piste order / ids, buildings, class
raster come out differently): a full re-bake would rename pistes (leaderboards, saves, piste index). The street beds only change what depends on
the groomed 5 m mosaic: the height tiles (t/*.bin), far.bin, the mountain shadows and the tile list of resort.json. So: bake, then put every
other file (and every other key of resort.json) back as it was before. The park profile, pistes, lifts, buildings, classes, map, panorama stay.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PY = os.path.expanduser("~/Library/Caches/luxtram-work/.venv/bin/python")
TAKE = ("far.bin",)                              # from the new bake; shadow-*.webp too; t/ as a whole


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def main():
    for rid in sys.argv[1:]:
        d = os.path.join(REPO, "pb", "ski", "data", rid)
        keep = os.path.join(os.environ.get("TMPDIR", "/tmp"), "rebed-" + rid)
        shutil.rmtree(keep, ignore_errors=True)
        shutil.copytree(d, keep)
        old = open(os.path.join(keep, "resort.json"), encoding="utf-8").read()
        assert dump(json.loads(old)) == old, "resort.json is not in the compact form"
        subprocess.run(["nice", "-n", "10", PY, os.path.join(HERE, "bake.py"), rid], check=True, stdout=subprocess.DEVNULL)
        new = json.load(open(os.path.join(d, "resort.json"), encoding="utf-8"))
        taken = {"t"} | set(TAKE) | {f for f in os.listdir(d) if f.startswith("shadow-")}
        for f in os.listdir(d):
            if f not in taken:
                src = os.path.join(keep, f)
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(d, f))
        res = json.loads(old)
        assert [t[:2] for t in res["tiles"]["list"]] == [t[:2] for t in new["tiles"]["list"]], "the shipped tile set changed"
        res["tiles"] = new["tiles"]
        with open(os.path.join(d, "resort.json"), "w", encoding="utf-8") as fh:
            fh.write(dump(res))
        print(rid, "ok")


if __name__ == "__main__":
    main()
