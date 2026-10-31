#!/usr/bin/env python3
"""Plan view of a station patch in the station frame (train drives to the RIGHT of the image, left of travel at the top), drawn from the json alone:
buildings (orange = flagged station building, tan = others, red outline = overlaps a platform), platforms (blue), rails (black), roads (grey), the main track (x = 0, thick black).
   patch_plan.py <key[.c|.h]> out.png [--zmin -200 --zmax 200 --xmin -80 --xmax 80 --scale 4]
Heavy halves (.h) hold buildings / rails / platforms; the core (.c) holds roads and the relief only, so give the key without the suffix (the script merges both)."""
import json, os, sys
from PIL import Image, ImageDraw
args = sys.argv[1:]
def flag(n, d):
    if '--' + n in args:
        i = args.index('--' + n); v = args[i + 1]; del args[i:i + 2]; return float(v)
    return d
zmin, zmax, xmin, xmax, sc = flag('zmin', -200), flag('zmax', 200), flag('xmin', -80), flag('xmax', 80), flag('scale', 4)
key, out = args[0], args[1]
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'pb', 'train-sim', 'data', 'stations')
d = {}
for suffix in ('', '.c', '.h'):
    p = os.path.join(base, key + suffix + '.json')
    if os.path.exists(p):
        for k, v in json.load(open(p)).items():
            d.setdefault(k, v)
W, H = int((zmax - zmin) * sc), int((xmax - xmin) * sc)
im = Image.new('RGB', (W, H), (236, 236, 228)); g = ImageDraw.Draw(im, 'RGBA')
def P(z, x):  # image: right = travel (z decreasing), up = left (x negative at top)
    return ((zmax - z) * sc, (x - xmin) * sc)
def ring(r, **k): g.polygon([P(p[1], p[0]) for p in r], **k)
for r in d.get('roads', []):
    pts = [P(p[1], p[0]) for p in r['pts']]
    if len(pts) > 1: g.line(pts, fill=(170, 170, 170, 255), width=max(1, int(r.get('w', 4) * sc * 0.6)))
for p in d.get('platforms', []): ring(p['ring'], fill=(90, 140, 220, 140), outline=(30, 60, 160, 255))
for r in d.get('rails', []):
    pts = [P(p[1], p[0]) for p in r['pts']]
    if len(pts) > 1: g.line(pts, fill=(20, 20, 20, 255), width=1)
g.line([P(zmax, 0), P(zmin, 0)], fill=(0, 0, 0, 255), width=3)
try:
    from shapely.geometry import Polygon
    plats = [Polygon(p['ring']).buffer(0) for p in d.get('platforms', []) if len(p['ring']) > 2]
except Exception:
    plats = []
for b in d.get('buildings', []):
    gr = b['ground']
    hit = False
    if plats:
        poly = Polygon(gr).buffer(0)
        hit = any(poly.intersection(pl).area > 4 for pl in plats)
    ring(gr, fill=(240, 150, 40, 200) if b.get('station') else (200, 180, 140, 190), outline=(220, 0, 0, 255) if hit else (120, 90, 40, 255))
for z in range(int(zmin // 20 * 20), int(zmax) + 1, 20):
    x, y = P(z, xmin); g.line([(x, 0), (x, 8)], fill=(0, 0, 0, 255)); g.text((x + 2, 8), str(z), fill=(0, 0, 0, 255))
im.save(out); print(out, im.size)
