#!/usr/bin/env python3
"""Adds MISSING official pistes to a LIVE resort without a re-bake (28 Nov 2026, "missing-pistes" round).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/add_pistes.py <rid> [--dry] [--sql OUT.sql]

Reads scripts/ski/official/<rid>.add.json:
    {"season": "2026/27", "pistes": [
       {"id": "fang", "name": "Fang", "ref": "34", "diff": "black", "route": false,
        "source": "OSM way 29709866 (piste:type=downhill, 15 nodes: below the bake minimum)",     # free text, printed + HANDOFF
        "lonlat": [[lon, lat], ...],                      # the geometry (OSM way(s) chained, an official GPX, the owner's track, ...)
        "snap": 40,                                        # m: end points within this of another piste line are moved onto it (connected)
        "smooth": 3, "hw": 14.0}]}                        # optional

What it does per piste (the same pieces bake.py uses, no terrain / class change): project to the resort frame, orient downhill (ground height
= the shipped 5 m tiles, the far grid elsewhere), resample 5 m + smooth (bake.make_run), snap both ends onto the nearest existing piste line,
then append a `pistes` row (id, name, ref, diff, len, drop, top, bottom, hw, slalom, route, lz = lines resampled to 10 m) and a painted
`network` row (d, w, pz[, r]). Idempotent (a piste id that is already there is skipped). New ids must not be reserved. Afterwards:
piste_index.mjs, goals_data.mjs, make_sql.py (floors rows), game_importmap.py; production gets ONLY the additive insert (see --sql)."""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import RESORTS, Frame  # noqa: E402
from linepack import pack_line, unpack_line  # noqa: E402
from pano_proj import FarGrid, decode_grid  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
HALF_WIDTH = {"green": 17, "blue": 18, "red": 15, "black": 13}      # bake.py HALF_WIDTH
LETTER = {"green": "g", "blue": "b", "red": "r", "black": "k"}
MAX_RUN_SPEED = 33


def resample(p, step):
    seg = np.hypot(*(np.diff(p, axis=0).T))
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < step:
        return p.copy()
    t = np.linspace(0, s[-1], int(math.ceil(s[-1] / step)) + 1)
    return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], axis=1)


def smooth_line(p, radius_pts):
    if len(p) < 2 * radius_pts + 3:
        return p
    out = p.copy()
    k = np.ones(2 * radius_pts + 1) / (2 * radius_pts + 1)
    for c in range(2):
        padded = np.concatenate([np.full(radius_pts, p[0, c]), p[:, c], np.full(radius_pts, p[-1, c])])
        out[:, c] = np.convolve(padded, k, mode="valid")
    out[0], out[-1] = p[0], p[-1]
    return out


def polyline_len(p):
    return float(np.sum(np.hypot(*(np.diff(p, axis=0).T)))) if len(p) > 1 else 0.0


def dp_simplify(p, tol):
    if len(p) < 3:
        return p
    keep = np.zeros(len(p), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ab = p[b] - p[a]
        L = math.hypot(*ab) or 1e-9
        d = np.abs((p[a + 1:b, 0] - p[a, 0]) * ab[1] - (p[a + 1:b, 1] - p[a, 1]) * ab[0]) / L
        i = int(np.argmax(d))
        if d[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return p[keep]


def flat(p, nd=1):
    return [round(float(v), nd) for v in p.reshape(-1)]


class Ground:
    """Ground height like the game: shipped 5 m tiles (bilinear), the 40 m far grid where no tile is shipped."""

    def __init__(self, rid):
        self.rid = rid
        d = os.path.join(REPO, "pb", "ski", "data", rid)
        meta = json.load(open(os.path.join(d, "resort.json"), encoding="utf-8"))
        self.far = FarGrid(decode_grid(open(os.path.join(d, "far.bin"), "rb").read()), meta["far"]["step"], meta["far"]["margin"])
        self.tiles = {}
        self.dir = d

    def tile(self, tx, tz):
        key = (tx, tz)
        if key not in self.tiles:
            f = os.path.join(self.dir, "t", "%d_%d.bin" % key)
            self.tiles[key] = decode_grid(open(f, "rb").read()) if os.path.exists(f) else None
        return self.tiles[key]

    def one(self, x, z):
        tx, tz = int(x // 1280), int(z // 1280)
        g = self.tile(tx, tz)
        if g is None:
            return float(self.far(x, z))
        u, v = (x - tx * 1280) / 5.0, (z - tz * 1280) / 5.0
        i, j = min(int(u), 255), min(int(v), 255)
        fu, fv = u - i, v - j
        return float((g[j, i] * (1 - fu) + g[j, i + 1] * fu) * (1 - fv) + (g[j + 1, i] * (1 - fu) + g[j + 1, i + 1] * fu) * fv)

    def __call__(self, x, z):
        return np.array([self.one(a, b) for a, b in zip(np.atleast_1d(x), np.atleast_1d(z))])


def nearest_on_lines(q, lines, skip_self=None):
    """(distance, foot point) of the nearest point on any existing piste line / lift line"""
    best = (1e18, None)
    for ln in lines:
        for (ax, az), (bx, bz) in zip(ln, ln[1:]):
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((q[0] - ax) * dx + (q[1] - az) * dz) / L2))
            fx, fz = ax + t * dx, az + t * dz
            d = math.hypot(q[0] - fx, q[1] - fz)
            if d < best[0]:
                best = (d, (fx, fz))
    return best


def pts_of(flat_list):
    return [(flat_list[i], flat_list[i + 1]) for i in range(0, len(flat_list) - 1, 2)]


def build(spec, frame, ground, lines):
    lonlat = np.array(spec["lonlat"], float)
    x, z = frame.to_world_many(lonlat[:, 0], lonlat[:, 1])
    p = np.stack([x, z], axis=1)
    h = ground(p[:, 0], p[:, 1])
    if spec.get("keep_order") is not True and h[0] < h[-1]:
        p = p[::-1].copy()
    snap = spec.get("snap", 40.0)
    notes = []
    for end in (0, -1):
        d, foot = nearest_on_lines(p[end], lines)
        if foot is not None and d <= snap:
            notes.append("%s end snapped %.1f m onto a piste / lift" % ("start" if end == 0 else "bottom", d))
            if d > 1.0:
                p = np.concatenate([[foot], p]) if end == 0 else np.concatenate([p, [foot]])
        else:
            notes.append("%s end NOT connected (nearest piste / lift %.0f m)" % ("start" if end == 0 else "bottom", d))
    q = resample(p, 5.0)
    q = smooth_line(q, spec.get("smooth", 3))
    hh = ground(q[:, 0], q[:, 1])
    return q, hh, notes


def apply_edit(row, nrows, spec, frame, ground, lines):
    """Replaces the stretch of an existing piste between the vertices nearest to spec["from"] and spec["to"] (lon, lat) by spec["pts"]
    (lon, lat; end points included). Recomputes len / drop / top / bottom / lz, adds the new stretch as a painted network row."""
    a = unpack_line(row["lz"])
    pts = np.array(pts_of(a), float)
    f = np.array(frame.to_world(*spec["from"]), float)
    t = np.array(frame.to_world(*spec["to"]), float)
    i = int(np.argmin(np.hypot(*(pts - f).T)))
    j = int(np.argmin(np.hypot(*(pts - t).T)))
    assert i < j, "edit: from must come before to along the piste (%s)" % row["id"]
    ll = np.array(spec["pts"], float)
    x, z = frame.to_world_many(ll[:, 0], ll[:, 1])
    mid = resample(np.stack([x, z], axis=1), 10.0)
    new = np.concatenate([pts[:i], mid, pts[j + 1:]])
    h = ground(new[:, 0], new[:, 1])
    out = dict(row, len=round(polyline_len(new)), drop=round(float(h[0] - h[-1])), top=round(float(h[0])), bottom=round(float(h[-1])),
               lz=pack_line(flat(new)))
    hw = row["hw"]
    nrow = {"d": LETTER[row["diff"]], "w": round(hw, 1), "pz": pack_line(flat(dp_simplify(mid, 1.5)))}
    if row.get("route"):
        nrow["r"] = 1
    return out, nrow, polyline_len(new) - polyline_len(pts)


def main():
    a = sys.argv[1:]
    rid = a[0]
    dry = "--dry" in a
    sql_out = a[a.index("--sql") + 1] if "--sql" in a else None
    specs = json.load(open(os.path.join(HERE, "official", rid + ".add.json"), encoding="utf-8"))
    path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
    r = json.load(open(path, encoding="utf-8"))
    frame = Frame(rid)
    ground = Ground(rid)
    reserved = set(RESORTS[rid].get("reserved_ids", ()))
    have = {p["id"] for p in r["pistes"]}
    lines = [pts_of(unpack_line(p["lz"])) for p in r["pistes"]] + [pts_of(l["pts"]) for l in r["lifts"]]
    rows, net, boards = [], [], []
    for spec in specs["pistes"]:
        pid = spec["id"]
        if pid in have:
            print("  skip (already there): %s" % pid)
            continue
        assert pid not in reserved, "%s is a reserved id" % pid
        q, hh, notes = build(spec, frame, ground, lines)
        length, drop = polyline_len(q), float(hh[0] - hh[-1])
        hw = spec.get("hw") or HALF_WIDTH[spec["diff"]] * (0.7 if spec.get("route") else 1.0)
        line10 = resample(q, 10.0)
        row = {"id": pid, "name": spec["name"], "ref": spec.get("ref", ""), "diff": spec["diff"], "len": round(length), "drop": round(drop),
               "top": round(float(hh[0])), "bottom": round(float(hh[-1])), "hw": round(hw, 1), "slalom": False}
        if spec.get("route"):
            row["route"] = True
        if spec.get("variant"):
            row["variant"] = True
        row["lz"] = pack_line(flat(line10))
        nrow = {"d": LETTER[spec["diff"]], "w": round(hw, 1), "pz": pack_line(flat(dp_simplify(q, 1.5)))}
        if spec.get("route"):
            nrow["r"] = 1
        rows.append(row)
        net.append(nrow)
        lines.append(pts_of(unpack_line(row["lz"])))
        flo = math.floor(length / MAX_RUN_SPEED) * 1000
        boards.append(("ski-%s-%s" % (rid, pid))[:48])
        print("  + %-34s %-6s %-8s %5d m drop %4d  %4d -> %4d  | %s | %s" % (pid, spec.get("ref", ""), spec["diff"], length, drop, hh[0], hh[-1],
                                                                          spec["source"], "; ".join(notes)))
        if drop < 12 or length < 100:
            print("    WARNING: short / flat (below the bake minimum 120 m / 12 m)")
    edited = {}
    for e in specs.get("edits", []):
        base = edited.get(e["id"]) or next(p for p in r["pistes"] if p["id"] == e["id"])
        probe = np.array(frame.to_world(*e["pts"][len(e["pts"]) // 2]), float)
        if np.min(np.hypot(*(np.array(pts_of(unpack_line(base["lz"])), float) - probe).T)) < 4.0:
            print("  skip edit (already applied): %s" % e["id"])
            continue
        out, nrow, grow = apply_edit(base, net, e, frame, ground, lines)
        edited[e["id"]] = out
        net.append(nrow)
        print("  ~ %s extended by %+.0f m: %s" % (e["id"], grow, e["source"]))
    if not rows and not edited:
        print("%s: nothing to add" % rid)
        return
    new = dict(r)
    new["pistes"] = [edited.get(p["id"], p) for p in r["pistes"]] + rows
    new["network"] = r["network"] + net
    print("%s: pistes %d -> %d, network %d -> %d" % (rid, len(r["pistes"]), len(new["pistes"]), len(r["network"]), len(new["network"])))
    if not dry:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(new, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
