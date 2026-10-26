#!/usr/bin/env python3
"""Post-process of the Lëtzebuerg Gare Centrale patch (data/stations/luxembourg.json) for the yard renderer (pb/train-sim/station-yard.js).  Idempotent.
  patch_lux_yard.py [--check]
What it does (everything from open data: OSM + the patch's own LOD2 / platform / rail data; no orthophoto):
  * ground classes: platform polygons -> paving (1); the footprints of the platform canopies (LOD2 holds them as 'buildings') are NOT building ground any more:
    gravel (5) outside the platforms; the forecourt (Place de la Gare, between the station building and Avenue de la Gare) was default lawn: paving;
  * the Luxtram tracks of the Place de la Gare (OSM railway=tram) are appended to `rails` with kind "tram" (rigid transform into the patch frame: the track is straight there).
"""
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PATCH = os.path.join(HERE, "..", "..", "pb", "train-sim", "data", "stations", "luxembourg.json")
CANOPY_IDS = ["w362239328", "w1312992341", "ACT_4e24b351-eab5-4dc2-b87f-8f4802b32639", "w52094233", "w52094232", "w362239327", "w1289589204"]
FORECOURT = (-96.0, -6.0, -60.0, 150.0)       # x0, x1, z0, z1 (patch frame): lawn / meadow in here becomes paving
E0, N0, HEADING = 77559.24, 73908.75, 19.78


def log(*a):
    print(*a, file=sys.stderr)


def tram_rails(box):
    sys.path.insert(0, HERE)
    import build_station_patch as B
    recs = B.read_osm("lines", (E0 - 450, N0 - 450, E0 + 450, N0 + 450))
    h = math.radians(HEADING)
    out = []
    for r in recs:
        if r["t"].get("railway") != "tram":
            continue
        pts = []
        for (E, N) in r["g"].coords:
            dE, dN = E - E0, N - N0
            u = dE * math.sin(h) + dN * math.cos(h)
            v = dE * math.cos(h) - dN * math.sin(h)
            pts.append([round(v, 2), round(-u, 2)])
        keep = [p for p in pts if box[0] <= p[0] <= box[1] and box[2] <= p[1] <= box[3]]
        if len(keep) >= 2:
            out.append({"pts": [[p[0], p[1], 0.0] for p in keep], "kind": "tram", "main": 0, "osm": r["id"]})
    return out


def main():
    d = json.load(open(PATCH))
    c = d["classes"]
    arr = np.array(Image.open(io.BytesIO(base64.b64decode(c["png"]))).convert("L")) // 16
    H, W = arr.shape
    x0, z0, res = c["x0"], c["z0"], c.get("res", 1)

    def px(x, z):
        return ((x - x0) / res, (z - z0) / res)

    def mask_poly(rings):
        im = Image.new("L", (W, H), 0)
        g = ImageDraw.Draw(im)
        for ring in rings:
            g.polygon([px(*p) for p in ring], fill=255)
        return np.array(im) > 0

    canopy = mask_poly([b["ground"] for b in d["buildings"] if b["id"] in CANOPY_IDS])
    plat = mask_poly([p["ring"] for p in d["platforms"]])
    im = Image.new("L", (W, H), 0)
    g = ImageDraw.Draw(im)
    for r in d["rails"]:
        if r.get("kind") == "tram":
            continue
        g.line([px(p[0], p[1]) for p in r["pts"]], fill=255, width=int(5 / res))
    bed = np.array(im) > 0
    out = arr.copy()
    out[canopy & (arr == 7)] = 5
    out[plat] = 1
    out[bed & ~plat] = 8
    xs = (np.arange(W) * res + x0)[None, :]
    zs = (np.arange(H) * res + z0)[:, None]
    fc = (xs >= FORECOURT[0]) & (xs <= FORECOURT[1]) & (zs >= FORECOURT[2]) & (zs <= FORECOURT[3])
    out[fc & ((arr == 2) | (arr == 3))] = 1
    log("classes changed: canopy %d platforms %d bed %d forecourt %d" % (int(((arr != out) & canopy).sum()), int(((arr != out) & plat).sum()), int(((arr != out) & bed).sum()), int(((arr != out) & fc).sum())))
    buf = io.BytesIO()
    Image.fromarray((out * 16).astype(np.uint8), "L").save(buf, "PNG", optimize=True)
    c["png"] = base64.b64encode(buf.getvalue()).decode()
    d["rails"] = [r for r in d["rails"] if r.get("kind") != "tram"] + tram_rails((-160, 160, -320, 320))
    log("tram rails:", sum(1 for r in d["rails"] if r.get("kind") == "tram"))
    if "--check" in sys.argv:
        return
    with open(PATCH, "w") as fh:
        json.dump(d, fh, separators=(",", ":"), ensure_ascii=False)


main()
