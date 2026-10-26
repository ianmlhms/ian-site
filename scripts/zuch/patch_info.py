#!/usr/bin/env python3
"""What is in a station patch: the flagged station building(s), platforms, rails and the biggest buildings near the track, in the patch frame.
   patch_info.py <key> [--near 70]"""
import json, os, sys
import numpy as np
key = sys.argv[1]
near = float(sys.argv[sys.argv.index("--near") + 1]) if "--near" in sys.argv else 70.0
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "train-sim", "data", "stations", key + ".json")))
print(d["name"], "side", d["side"], "heading", d["origin"]["headingDeg"])
def bb(r):
    a = np.array(r); return [round(float(a[:, 0].min()), 1), round(float(a[:, 0].max()), 1), round(float(a[:, 1].min()), 1), round(float(a[:, 1].max()), 1)]
for p in d["platforms"]:
    print("platform x %s z %s" % tuple(bb(p["ring"])[0:2]) if False else "platform  x[%.1f..%.1f] z[%.1f..%.1f]" % tuple(bb(p["ring"])))
for r in d["rails"]:
    pts = np.array(r["pts"]); print("rail", r["kind"], "x[%.1f..%.1f] z[%.1f..%.1f]" % (pts[:, 0].min(), pts[:, 0].max(), pts[:, 1].min(), pts[:, 1].max()))
rows = []
for b in d["buildings"]:
    x0, x1, z0, z1 = bb(b["ground"])
    dist = min(abs(x0), abs(x1)) if x0 * x1 > 0 else 0
    if b.get("station") or dist < near and (x1 - x0) * (z1 - z0) > 60:
        rows.append((b.get("station", 0), b["kind"], b.get("levels"), b["roof"], b["h"], "x[%.1f..%.1f] z[%.1f..%.1f]" % (x0, x1, z0, z1), b["id"]))
for r in sorted(rows, key=lambda r: -r[0]):
    print("BLD station=%s %s lv=%s roof=%s h=%.1f %s %s" % r)
print("poi", sorted({p["t"] for p in d["poi"]}))
for p in d["poi"]:
    if p["t"] in ("shelter", "ticket", "bus_stop") : print("  poi", p["t"], p["x"], p["z"])
