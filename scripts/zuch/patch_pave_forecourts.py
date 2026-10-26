#!/usr/bin/env python3
"""Pave the forecourts of the station patches (generic, idempotent).  patch_pave_forecourts.py [key ...] [--check]

build_station_patch.py paints every pixel near a building that OSM does not cover with a landuse as LAWN (class 2), and landuse commercial / retail / institutional /
industrial as lawn too: a station square (cobbles, asphalt, parking, bus bays) came out as bright green.  Rule applied to the finished patches (the classes are the only
thing changed; OSM grass areas that touch no station building stay lawn):
  lawn (2) / meadow (3) within FORECOURT_M of a building flagged `station`, or within PLATFORM_M of a platform polygon  ->  paving (1)
Trees (the LiDAR canopy, class 4) and water are never touched.  build_station_patch.py itself paints the same area as paving for new builds (`lawn_fill`)."""
import base64, io, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "..", "pb", "train-sim", "data", "stations")
FORECOURT_M = 60.0
PLATFORM_M = 14.0
LAWN, MEADOW, PAVING = 2, 3, 1


def process(path, check):
    d = json.load(open(path))
    c = d["classes"]
    arr = np.array(Image.open(io.BytesIO(base64.b64decode(c["png"]))).convert("L")) // 16
    H, W = arr.shape
    res = c.get("res", 1)

    def raster(rings):
        im = Image.new("L", (W, H), 0)
        g = ImageDraw.Draw(im)
        for ring in rings:
            if len(ring) >= 3:
                g.polygon([((x - c["x0"]) / res, (z - c["z0"]) / res) for x, z in ring], fill=255)
        return np.array(im) > 0

    sb = raster([b["ground"] for b in d.get("buildings", []) if b.get("station")])
    pl = raster([p["ring"] for p in d.get("platforms", [])])
    if not sb.any() and not pl.any():
        return 0
    near = np.zeros_like(sb)
    if sb.any():
        near |= ndi.distance_transform_edt(~sb) * res < FORECOURT_M
    if pl.any():
        near |= ndi.distance_transform_edt(~pl) * res < PLATFORM_M
    sel = near & ((arr == LAWN) | (arr == MEADOW))
    n = int(sel.sum())
    if n and not check:
        arr[sel] = PAVING
        buf = io.BytesIO()
        Image.fromarray((arr * 16).astype(np.uint8), "L").save(buf, "PNG", optimize=True)
        c["png"] = base64.b64encode(buf.getvalue()).decode()
        with open(path, "w") as fh:
            json.dump(d, fh, separators=(",", ":"), ensure_ascii=False)
    return n


def main():
    keys = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    for f in sorted(os.listdir(DIR)):
        if not f.endswith(".json") or f.startswith("index") or f.endswith(".c.json"):
            continue
        key = f[:-5]
        if keys and key not in keys:
            continue
        try:
            n = process(os.path.join(DIR, f), check)
        except Exception as e:  # noqa: BLE001
            print("FAILED", key, e, file=sys.stderr)
            continue
        print("%-24s %6d px %s" % (key, n, "(would be paved)" if check and n else "paved" if n else ""))


main()
