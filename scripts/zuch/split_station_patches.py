#!/usr/bin/env python3
"""W2c: splits the station patches of index-routes.json into a small CORE file and a HEAVY file (download size of the school iPads).

    pb/train-sim/data/stations/<key>.json    full patch written by build_station_patch.py (23 MB for the 37 route stations)
 -> <key>.c.json   core: everything the track build needs (terrain DEM at 4 m, roads for the level-crossing detection / the crossing road, platforms, water, trackY, origin);
                   fetched for ALL stations of the selected route before the track is built (about 25 kB gzip per station)
    <key>.h.json   heavy: ground class map, LOD2 buildings, trees, rails, poi; fetched lazily ahead of the train (station-surround.js)

The full file is deleted after the split (it stays in git history; build_station_patch.py writes it again on a rebuild, then run this script again).  index-routes.json gets
"split": 1 so that station-surround.js knows to fetch the two files.  Idempotent.

    python3 scripts/zuch/split_station_patches.py [key ...]        (default: every station of index-routes.json)
"""
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "pb", "train-sim", "data", "stations")
HEAVY_KEYS = ("buildings", "trees", "rails", "poi", "classes")
DEM_FACTOR = 2           # 2 m grid -> 4 m grid (the terrain strip samples it every 5 m, the painted ground every 4 m)


def dem4(dem):
    nx, nz = dem["nx"], dem["nz"]
    raw = base64.b64decode(dem["dm"])
    vals = [int.from_bytes(raw[i:i + 2], "little", signed=True) for i in range(0, len(raw), 2)]
    assert len(vals) == nx * nz
    ix = list(range(0, nx, DEM_FACTOR))
    iz = list(range(0, nz, DEM_FACTOR))
    out = bytearray()
    for z in iz:
        for x in ix:
            out += int(vals[z * nx + x]).to_bytes(2, "little", signed=True)
    return {"res": dem["res"] * DEM_FACTOR, "nx": len(ix), "nz": len(iz), "x0": dem["x0"], "z0": dem["z0"], "dm": base64.b64encode(bytes(out)).decode()}


def split(key):
    src = os.path.join(OUT, key + ".json")
    if not os.path.exists(src):
        return False
    d = json.load(open(src))
    core = {k: v for k, v in d.items() if k not in HEAVY_KEYS}
    core["dem"] = dem4(d["dem"])
    heavy = {k: d[k] for k in HEAVY_KEYS if k in d}
    heavy["key"] = key
    with open(os.path.join(OUT, key + ".c.json"), "w") as f:
        json.dump(core, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(OUT, key + ".h.json"), "w") as f:
        json.dump(heavy, f, separators=(",", ":"), ensure_ascii=False)
    os.remove(src)
    return True


def main():
    idx_path = os.path.join(OUT, "index-routes.json")
    idx = json.load(open(idx_path))
    keys = sys.argv[1:] or sorted(set(idx["stations"].values()))
    n = sum(1 for k in keys if split(k))
    idx["split"] = 1
    with open(idx_path, "w") as f:
        json.dump(idx, f, separators=(",", ":"), ensure_ascii=False)
    print("split %d patches (%d keys), index split=1" % (n, len(keys)))


if __name__ == "__main__":
    main()
