#!/usr/bin/env python3
"""W2c: builds the station patches (real surroundings, build_station_patch.py) of every Luxembourg station of the single-line routes from their layout files
(pb/train-sim/data/real/<route>-layout.json: lat / lon / heading of the stop on the real main track).  Patches land in pb/train-sim/data/stations/<key>.json and are
registered in index-routes.json (the Mosel line keeps index.json).  Skips stations that already have a patch (rerun with --force) and the Gare Centrale (home-line branch).

    /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/zuch/build_route_patches.py north south west [--only Name,Name] [--force]
"""
import json
import os
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
REAL = os.path.join(REPO, "pb", "train-sim", "data", "real")
OUT = os.path.join(REPO, "pb", "train-sim", "data", "stations")
SKIP = {"Lëtzebuerg"}
LUX_BBOX = (49.40, 5.70, 50.20, 6.55)       # lat0, lon0, lat1, lon1: the LiDAR / LOD2 data cover Luxembourg only


def key_of(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return "".join(c if c.isalnum() else "-" for c in s).strip("-")


def main():
    args = sys.argv[1:]
    force = "--force" in args
    only = set()
    if "--only" in args:
        i = args.index("--only")
        only = set(args[i + 1].split(","))
        del args[i:i + 2]
    routes = [a for a in args if not a.startswith("--")]
    done, failed = [], []
    for r in routes:
        doc = json.load(open(os.path.join(REAL, "%s-layout.json" % r)))
        for name, st in doc["stations"].items():
            if name in SKIP or (only and name not in only):
                continue
            if not (LUX_BBOX[0] <= st["lat"] <= LUX_BBOX[2] and LUX_BBOX[1] <= st["lon"] <= LUX_BBOX[3]):
                continue
            key = key_of(name)
            if os.path.exists(os.path.join(OUT, key + ".json")) and not force:
                print("have", name, flush=True)
                continue
            cmd = [sys.executable, os.path.join(HERE, "build_station_patch.py"), key, "--name", name, "--lat", str(st["lat"]), "--lon", str(st["lon"]),
                   "--heading-hint", str(st["heading"]), "--index", "index-routes.json"]
            print("build", r, name, flush=True)
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                failed.append(name)
                print("FAILED", name, res.stderr[-600:], flush=True)
            else:
                done.append(name)
                print((res.stdout.strip().splitlines() or [""])[-1][:240], flush=True)
    print("built", len(done), "failed", failed)


if __name__ == "__main__":
    main()
