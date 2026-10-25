#!/usr/bin/env python3
"""Developer tool: a labelled hillshade + ways crop of the world to pick trail waypoints.
    python scripts/mtb/mapcrop.py X0 Z0 W H OUT.png [mpp]      (world metres; mpp = metres per pixel, default 2)
Ways: orange = path, blue = track, grey = road, red = path/track with mtb:scale, green = the official GPX loop, magenta = baked trails."""
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OSM_DIR, OUT_DIR, RAW_DIR, REPO, lonlat_to_world  # noqa: E402

x0, z0, w, h = [float(v) for v in sys.argv[1:5]]
out = sys.argv[5]
mpp = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0
a = np.load(os.path.join(RAW_DIR, "dtm2.npy"))
gy, gx = np.gradient(a, 2.0)
sh = np.clip(0.62 + (gx * 0.6 + gy * 0.6) * 0.55, 0, 1)
base = Image.fromarray((sh * 255).astype("uint8")).convert("RGB")
# crop the 2 m raster then resample to the wanted mpp
c = base.crop((int(x0 / 2), int(z0 / 2), int((x0 + w) / 2), int((z0 + h) / 2)))
img = c.resize((int(w / mpp), int(h / mpp)), Image.LANCZOS)
d = ImageDraw.Draw(img)
f = ImageFont.load_default()
T = lambda x, z: ((x - x0) / mpp, (z - z0) / mpp)
col = {"path": (255, 140, 0), "footway": (255, 170, 0), "steps": (255, 220, 0), "track": (60, 60, 255), "cycleway": (0, 190, 255), "service": (120, 120, 120)}
for e in json.load(open(os.path.join(OSM_DIR, "ways.json"), encoding="utf-8"))["elements"]:
    t = e["tags"]
    xs, zs = lonlat_to_world([p["lon"] for p in e["geometry"]], [p["lat"] for p in e["geometry"]])
    if xs.max() < x0 or xs.min() > x0 + w or zs.max() < z0 or zs.min() > z0 + h:
        continue
    cc = col.get(t["highway"], (150, 150, 150))
    if "mtb:scale" in t and t["highway"] in ("path", "track", "footway"):
        cc = (255, 0, 0)
    d.line([T(x, z) for x, z in zip(xs, zs)], fill=cc, width=1)
gpx = open(os.path.join(REPO, "mtb", "gpx", "beaufort-berdorf.gpx")).read()
for seg in re.findall(r"<trkseg>(.*?)</trkseg>", gpx, re.S):
    p = [(float(la), float(lo)) for la, lo in re.findall(r'lat="([\d.]+)" lon="([\d.]+)"', seg)]
    xs, zs = lonlat_to_world([q[1] for q in p], [q[0] for q in p])
    d.line([T(x, z) for x, z in zip(xs, zs)], fill=(0, 220, 0), width=2)
tj = os.path.join(OUT_DIR, "trails.json")
if os.path.exists(tj):
    for tr in json.load(open(tj))["trails"]:
        d.line([T(x, z) for x, z in tr["line"]], fill=(255, 0, 255), width=2)
        d.text(T(*tr["line"][0]), tr["id"], fill=(255, 0, 255), font=f)
step = 100 if w <= 1600 else 200
gxv = int(x0 // step) * step
while gxv < x0 + w:
    if gxv >= x0:
        px, _ = T(gxv, z0)
        d.line([(px, 0), (px, img.size[1])], fill=(255, 255, 255), width=1)
        d.text((px + 2, 2), str(int(gxv)), fill=(0, 0, 160), font=f)
    gxv += step
gzv = int(z0 // step) * step
while gzv < z0 + h:
    if gzv >= z0:
        _, py = T(x0, gzv)
        d.line([(0, py), (img.size[0], py)], fill=(255, 255, 255), width=1)
        d.text((2, py + 2), str(int(gzv)), fill=(0, 0, 160), font=f)
    gzv += step
img.save(out)
print(out, img.size)
