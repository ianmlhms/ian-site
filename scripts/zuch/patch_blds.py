#!/usr/bin/env python3
"""All buildings of a patch near the track: id, kind, levels, roof, eave h, base, x/z extents, #roof faces.   patch_blds.py <key> [--x0 -40 --x1 40 --z0 -100 --z1 100]"""
import json, os, sys
import numpy as np
a = sys.argv[1:]
def opt(n, d):
    if "--" + n in a:
        i = a.index("--" + n); v = float(a[i + 1]); del a[i:i + 2]; return v
    return d
x0, x1, z0, z1 = opt("x0", -40), opt("x1", 40), opt("z0", -100), opt("z1", 100)
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "train-sim", "data", "stations", a[0] + ".json")))
for b in d["buildings"]:
    g = np.array(b["ground"])
    if g[:, 0].max() < x0 or g[:, 0].min() > x1 or g[:, 1].max() < z0 or g[:, 1].min() > z1: continue
    ridge = max([p[1] for r in b["roofs"] for p in r], default=0)
    print("%s st=%s %-10s lv=%s %-5s h=%.1f ridge=%.1f base=%.1f x[%.1f..%.1f] z[%.1f..%.1f] roofs=%d walls=%d" % (b["id"], b.get("station", 0), b["kind"], b.get("levels"), b["roof"], b["h"], ridge, b["base"], g[:, 0].min(), g[:, 0].max(), g[:, 1].min(), g[:, 1].max(), len(b["roofs"]), len(b["walls"])))
