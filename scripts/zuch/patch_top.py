#!/usr/bin/env python3
"""Top view of a station patch (patch frame) as PNG: platforms, rails, roads, buildings (ids), shelters, the main track at x=0.
   patch_top.py <key> out.png [--z0 -120] [--z1 120] [--x0 -60] [--x1 60] [--scale 8]   (z up = ahead; x right)"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
a = sys.argv[1:]
def opt(n, d):
    if "--" + n in a:
        i = a.index("--" + n); v = float(a[i + 1]); del a[i:i + 2]; return v
    return d
z0, z1, x0, x1, sc = opt("z0", -120), opt("z1", 120), opt("x0", -60), opt("x1", 60), opt("scale", 8)
key, out = a[0], a[1]
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "train-sim", "data", "stations", key + ".json")))
W, H = int((x1 - x0) * sc), int((z1 - z0) * sc)
im = Image.new("RGB", (W, H), (236, 232, 222)); dr = ImageDraw.Draw(im)
f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 13)
P = lambda x, z: ((x - x0) * sc, (z - z0) * sc)   # ahead (-z) = up in the picture
def PP(x, z): return ((x - x0) * sc, H - (z - z0) * sc)
P = PP
for gx in range(int(x0 // 10) * 10, int(x1) + 1, 10):
    dr.line([P(gx, z0), P(gx, z1)], fill=(215, 211, 200)); dr.text((P(gx, z0)[0] + 2, H - 14), str(gx), fill=(120, 120, 120), font=f)
for gz in range(int(z0 // 10) * 10, int(z1) + 1, 10):
    dr.line([P(x0, gz), P(x1, gz)], fill=(215, 211, 200)); dr.text((2, P(x0, gz)[1] - 14), str(gz), fill=(120, 120, 120), font=f)
for r in d["roads"]:
    dr.line([P(p[0], p[1]) for p in r["pts"]], fill=(150, 150, 150), width=max(1, int(r["w"] * sc * 0.7)))
for p in d["platforms"]:
    dr.polygon([P(*q) for q in p["ring"]], fill=(190, 170, 130))
for r in d["rails"]:
    dr.line([P(p[0], p[1]) for p in r["pts"]], fill=(60, 60, 200) if r["kind"] == "main" else (130, 130, 220), width=2)
dr.line([P(0, z0), P(0, z1)], fill=(200, 0, 0), width=2)
for b in d["buildings"]:
    col = (225, 90, 70) if b.get("station") else (120, 120, 130)
    dr.polygon([P(*q) for q in b["ground"]], fill=col, outline=(0, 0, 0))
    cx = sum(q[0] for q in b["ground"]) / len(b["ground"]); cz = sum(q[1] for q in b["ground"]) / len(b["ground"])
    dr.text(P(cx, cz), "%s %s" % (b["id"][-6:], b["kind"][:4]), fill=(255, 255, 255), font=f)
for p in d["poi"]:
    if p["t"] in ("shelter", "ticket", "bus_stop", "bike_parking", "bench"):
        x, z = P(p["x"], p["z"]); dr.ellipse([x - 4, z - 4, x + 4, z + 4], fill=(0, 160, 0)); dr.text((x + 5, z - 6), p["t"][:5], fill=(0, 100, 0), font=f)
im.save(out); print(out, im.size)
