#!/usr/bin/env python3
"""Lateral position x of every non-main rail of a patch at some z values (patch frame).   patch_rails.py <key> [z ...]"""
import json, os, sys
import numpy as np
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "train-sim", "data", "stations", sys.argv[1] + ".json")))
zs = [float(v) for v in sys.argv[2:]] or [-120, -60, -20, 0, 20, 60, 120]
print("z:", *["%7.0f" % z for z in zs])
for i, r in enumerate(d["rails"]):
    p = np.array(r["pts"]); o = np.argsort(p[:, 1]); p = p[o]
    row = []
    for z in zs:
        row.append("%7.1f" % np.interp(z, p[:, 1], p[:, 0]) if p[0, 1] <= z <= p[-1, 1] else "      -")
    print("%-6s%2d" % (r["kind"], i), *row, "  z[%.0f..%.0f]" % (p[0, 1], p[-1, 1]))
