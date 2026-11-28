#!/usr/bin/env python3
"""Official-map alignment (owner's rule, 28 Nov 2026): the official piste map of the season decides WHAT exists and its colour / number /
name; OpenStreetMap is only the geometry. Surgical edit of an already baked pb/ski/data/<resort>/resort.json (never a re-bake: older bakes
drift) from a spec file scripts/ski/official/<resort>.spec.json:

    {"season": "2025/26", "source": "...",
     "remove_pistes": ["id", ...],                  # not on the official map (the piste + the painted network lines that lie on it)
     "recolour": {"id": "red"},                     # colour of the official map (piste + the network lines that lie on it)
     "set": {"id": {"name": "...", "ref": "..."}},
     "remove_lifts": ["name", ...],
     "lift_set": {"name": {"ref": "...", "seats": 10}},
     "lift_cut": {"name": {"keep_m": 859, "keep": "top"}}}   # a lift rebuilt shorter on (part of) the old line: keep the last keep_m

    python3 scripts/ski/official_apply.py davos [--dry]

Idempotent. Removed piste ids go into RESORTS[rid]["reserved_ids"] (common.py) by hand: a later re-bake must not give them out again
(their boards / floors stay in the database, nothing is deleted there). The piste / lift indexes of the cloud save are append-only
and stay as they are. Afterwards: panorama.py <rid> (the printed map), goals_data.mjs, game_importmap.py.
"""
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from linepack import unpack_line  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
LETTER = {"green": "g", "blue": "b", "red": "r", "black": "k"}
NEAR = 12.0           # m: a network line "lies on" a piste when its points are this close
SAMPLE = 6.0


def pts_of(flat):
    return [(flat[i], flat[i + 1]) for i in range(0, len(flat) - 1, 2)]


def densify(pts, step=SAMPLE):
    out = []
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, z1 - z0) / step))
        for k in range(n):
            out.append((x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n))
    if pts:
        out.append(pts[-1])
    return out


class Grid:
    def __init__(self, cell=NEAR):
        self.cell = cell
        self.h = {}

    def add(self, pts):
        c = self.cell
        for x, z in pts:
            self.h.setdefault((int(x // c), int(z // c)), []).append((x, z))

    def near(self, x, z):
        c = self.cell
        gx, gz = int(x // c), int(z // c)
        for i in (gx - 1, gx, gx + 1):
            for j in (gz - 1, gz, gz + 1):
                for px, pz in self.h.get((i, j), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 <= c * c:
                        return True
        return False


def share(row_pts, grid):
    if not row_pts:
        return 0.0
    return sum(1 for x, z in row_pts if grid.near(x, z)) / len(row_pts)


def tile_height(rid, x, z, cache={}):
    """Ground height (m) from the shipped 5 m tiles (bilinear); None where no tile is shipped."""
    from pano_proj import decode_grid
    tx, tz = int(x // 1280), int(z // 1280)
    key = (rid, tx, tz)
    if key not in cache:
        f = os.path.join(REPO, "pb", "ski", "data", rid, "t", "%d_%d.bin" % (tx, tz))
        cache[key] = decode_grid(open(f, "rb").read()) if os.path.exists(f) else None
    g = cache[key]
    if g is None:
        return None
    u, v = (x - tx * 1280) / 5.0, (z - tz * 1280) / 5.0
    i, j = min(int(u), 255), min(int(v), 255)
    fu, fv = u - i, v - j
    return float((g[j, i] * (1 - fu) + g[j, i + 1] * fu) * (1 - fv) + (g[j + 1, i] * (1 - fu) + g[j + 1, i + 1] * fu) * fv)


def cut_lift(rid, lift, keep_m, keep):
    if keep != "top":
        raise SystemExit("lift_cut: only keep=top is implemented")
    pts = pts_of(lift["pts"])
    total = lift["len"]
    drop_m = total - keep_m
    # walk from the bottom until drop_m metres are behind us
    acc = 0.0
    out = None
    for k in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[k], pts[k + 1]
        seg = math.hypot(x1 - x0, z1 - z0)
        if acc + seg >= drop_m:
            t = (drop_m - acc) / seg
            out = [(round(x0 + (x1 - x0) * t, 1), round(z0 + (z1 - z0) * t, 1))] + pts[k + 1:]
            break
        acc += seg
    if out is None:
        raise SystemExit("lift_cut: line shorter than expected")
    lift["pts"] = [round(v, 1) for p in out for v in p]
    lift["pylons"] = [round(p - drop_m, 1) for p in lift["pylons"] if p - drop_m > 40]
    lift["len"] = keep_m
    bx, bz = out[0]
    by = tile_height(rid, bx, bz)
    if by is None:                                   # outside the shipped tiles: linear along the old line
        by = lift["top"]["y"] - lift["rise"] * keep_m / total
    by = round(by, 1)
    old_dur = lift.get("dur")
    lift["bottom"] = {"x": bx, "z": bz, "y": by, "osm": [bx, bz]}
    lift["rise"] = round(lift["top"]["y"] - by)
    if old_dur:
        lift["dur"] = round(old_dur * keep_m / total, 1)


def main():
    rid = sys.argv[1]
    dry = "--dry" in sys.argv
    spec = json.load(open(os.path.join(HERE, "official", rid + ".spec.json"), encoding="utf-8"))
    path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
    # 1. pistes: remove / recolour with the cleanup tool (painted network ways go with them, ids stay reserved)
    cur = {p["id"] for p in json.load(open(path, encoding="utf-8"))["pistes"]}
    remove = [i for i in spec.get("remove_pistes", []) if i in cur]
    colour = {i: c for i, c in spec.get("recolour", {}).items() if i in cur}
    if remove or colour:
        cmd = [sys.executable, os.path.join(HERE, "prune_pistes.py"), rid]
        if remove:
            cmd += ["--remove", ",".join(remove)]
        if colour:
            cmd += ["--colour", ",".join("%s=%s" % kv for kv in colour.items())]
        if dry:
            cmd.append("--dry")
        subprocess.run(cmd, check=True)
    r = json.load(open(path, encoding="utf-8"))
    by_id = {p["id"]: p for p in r["pistes"]}
    # 2. names / numbers of the official map
    for pid, fields in spec.get("set", {}).items():
        if pid in by_id:
            by_id[pid].update(fields)
    # 3. lifts
    n0 = len(r["lifts"])
    rm = set(spec.get("remove_lifts", []))
    r["lifts"] = [l for l in r["lifts"] if l["name"] not in rm]
    for l in r["lifts"]:
        if l["name"] in spec.get("lift_set", {}):
            l.update(spec["lift_set"][l["name"]])
        if l["name"] in spec.get("lift_cut", {}):
            c = spec["lift_cut"][l["name"]]
            if l["len"] != c["keep_m"]:
                cut_lift(rid, l, c["keep_m"], c.get("keep", "top"))
                print("  lift %s cut to %d m: bottom %s" % (l["name"], c["keep_m"], l["bottom"]))
    print("%s: lifts %d -> %d, set %s" % (rid, n0, len(r["lifts"]), list(spec.get("set", {}))))
    if not dry:
        open(path, "w", encoding="utf-8").write(json.dumps(r, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
