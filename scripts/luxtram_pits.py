#!/usr/bin/env python3
"""Road pits of the Luxtram world: ramps that sink into a cutting (the exit ramp of an underground car park).

  /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/luxtram_pits.py [--dry]

Run AFTER smooth_luxtram_roads.py.  The LiDAR ground model has a real trench there (OSM way 82882383, a parking aisle that leaves the layer -2 tunnel
under Avenue J.F. Kennedy at route s ~4785 and climbs 4.8 m to the street over ~44 m).  A draped carriageway and the cars on it cannot follow a 5 m wide,
4.8 m deep, nearly vertical-sided trench on a 2 m grid: the asphalt bridged it / dipped into it and cars beside it sat tilted on the rim.  So the trench is
built as a structure (luxtram-pits.js: floor, retaining walls, coping, railing, tunnel portal) and the terrain is FILLED here to the level of the street
around it (a flat "lid" that the ground shaders cut away inside the pit's footprint, see luxtram-ground.js uPit).

What this script does:
  1. reads the pit definitions below (OSM way, portal station, wall half width, the LiDAR depth profile),
  2. measures the street level on both sides of the pit from the shipped tiles (rim line C(a) + cross slope k) and writes everything the runtime needs into
     structures.json ("pits"),
  3. fills the tile nodes of the trench up to the lid  C(a) + k * b  (b = lateral offset from the ramp axis), so terrain, kerbs, lamps, trees, the
     sidewalk and the carriageways around the pit are level.  Nodes that are already at / above the lid are not touched (idempotent).
After a run bump "v" in index.json (the tiles changed) and the ?v= of structures.json in luxtram-world.js.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import luxtram_ground_model as M  # noqa: E402
import build_luxtram as B  # noqa: E402
import smooth_luxtram_roads as R  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pb", "train-sim", "data", "luxtram")
DATA_IN = os.environ.get("LUXTRAM_DATA_IN", DATA)
DATA_OUT = os.environ.get("LUXTRAM_DATA_OUT", DATA_IN)
TILE = R.TILE

# way: OSM way of the ramp (its first segment is the axis); a0: portal face (m along the axis from the way start); hw: half width between the wall faces;
# cop: coping width on top of each wall; depth0 / grade: LiDAR floor depth below the street, depth(a) = depth0 - grade * a (0 at the top end), measured on the
# pristine tiles (the floor is the minimum of the lateral profile, 12 m of ramp per 1.4 m, a straight line within 5 cm); tunnel: length of the covered part
# behind the portal that is built (m); clear: its headroom.
PITS = [
    {"way": 82882383, "a0": 1.0, "hw": 2.65, "cop": 0.35, "depth0": 4.96, "grade": 0.1137, "tunnel": 5.0, "clear": 3.4},
]
RIM_B = (4.5, 5.0, 5.5)            # lateral offsets (both sides) where the street level beside the pit is read (m)
FILL_B = 5.3                       # the fill reaches this far from the axis (the trench side slopes of a 2 m grid are 2-3 m wide)
FILL_MIN = 0.04                    # a node is lifted only when it is lower than the lid by more than this (m)


def way_axis(way_id):
    for el in M.load_all_elements("road"):
        if el["id"] == way_id:
            pts = [B.proj(p["lat"], p["lon"]) for p in el["geometry"]]
            return np.array(pts[0]), np.array(pts[1])
    raise SystemExit("OSM way %d not found" % way_id)


def load_tiles(src):
    idx = json.load(open(os.path.join(src, "index.json")))
    hq = R.HQ_OLD if idx.get("v", 1) < 5 else R.HQ_NEW
    tiles, steps = {}, {}
    for key, meta in idx["tiles"].items():
        tiles[key] = R.decode_heights(open(os.path.join(src, "h", key + ".bin"), "rb").read(), hq)
        steps[key] = float(meta["step"])
    return idx, tiles, steps


def main():
    dry = "--dry" in sys.argv
    idx, tiles, steps = load_tiles(DATA_IN)
    dem = R.Dem(tiles, steps)
    out = []
    for P in PITS:
        p0, p1 = way_axis(P["way"])
        u = p1 - p0
        u = u / np.hypot(*u)
        n = np.array([-u[1], u[0]])
        a_end = P["depth0"] / P["grade"]
        # street level beside the pit: the median of the tile heights at +-RIM_B, fitted as a line along the axis over the pit + 12 m (a street is straight enough)
        A = np.arange(-4.0, a_end + 12.0, 1.0)

        def rim(sgn):
            return np.nanmedian(np.stack([dem.at(p0[0] + u[0] * A + n[0] * sgn * b, p0[1] + u[1] * A + n[1] * sgn * b) for b in RIM_B]), axis=0)

        rl, rr = rim(-1.0), rim(1.0)
        ok = np.isfinite(rl) & np.isfinite(rr)
        c = (rl + rr) / 2
        k = float(np.nanmean((rr - rl)[ok]) / (2 * np.mean(RIM_B)))                 # cross slope of the street (m per m of lateral offset)
        c1, c0 = np.polyfit(A[ok], c[ok], 1)
        res = float(np.nanmax(np.abs(np.polyval([c1, c0], A[ok]) - c[ok])))
        print("pit way %d: axis from (%.1f, %.1f) dir (%.3f, %.3f), top end at %.1f m" % (P["way"], p0[0], p0[1], u[0], u[1], a_end))
        print("  street level C(a) = %.3f %+.4f a   cross slope %.4f   fit residual %.2f m" % (c0, c1, k, res))
        out.append({
            "id": P["way"], "p0": [round(float(p0[0]), 2), round(float(p0[1]), 2)], "u": [round(float(u[0]), 5), round(float(u[1]), 5)],
            "a0": P["a0"], "a1": round(a_end + 0.5, 2), "hw": P["hw"], "cop": P["cop"], "tunnel": P["tunnel"], "clear": P["clear"],
            "c": [round(float(c0), 3), round(float(c1), 5)], "k": round(k, 5), "d": [P["depth0"], P["grade"]],
        })
        # ---- fill the trench in the tiles (a pure function of the node position: tiles share their border nodes)
        moved = 0
        deepest = 0.0
        for key, h in list(tiles.items()):
            ti, tj = (int(v) for v in key.split("_"))
            st = steps[key]
            nn = h.shape[0]
            xs = ti * TILE + np.arange(nn) * st
            zs = tj * TILE + np.arange(nn) * st
            X, Z = np.meshgrid(xs, zs)                              # rows = z, columns = x
            if X.max() < p0[0] - 80 or X.min() > p0[0] + 80 or Z.max() < p0[1] - 80 or Z.min() > p0[1] + 80:
                continue
            a = (X - p0[0]) * u[0] + (Z - p0[1]) * u[1]
            b = (X - p0[0]) * n[0] + (Z - p0[1]) * n[1]
            inside = (a > -3.0) & (a < a_end + 14.0) & (np.abs(b) < FILL_B)
            lid = c0 + c1 * a + k * b
            low = inside & (h < lid - FILL_MIN)
            if low.any():
                deepest = max(deepest, float((lid - h)[low].max()))
                moved += int(low.sum())
                tiles[key] = np.where(low, lid, h)
        print("  lifted %d nodes (deepest %.2f m)" % (moved, deepest))
    if dry:
        return
    for key, h in tiles.items():
        buf = R.encode_heights(h, R.HQ_NEW)
        path = os.path.join(DATA_OUT, "h", key + ".bin")
        if not os.path.exists(path) or open(path, "rb").read() != buf:
            open(path, "wb").write(buf)
    sp = os.path.join(DATA_OUT, "structures.json")
    st = json.load(open(sp)) if os.path.exists(sp) else {"over": []}
    st["pits"] = out
    json.dump(st, open(sp, "w"), separators=(",", ":"))
    print("written", sp)


if __name__ == "__main__":
    main()
