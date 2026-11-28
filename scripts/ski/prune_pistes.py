#!/usr/bin/env python3
"""Surgical piste edits of a LIVE resort (28 Nov 2026): remove dead pistes / recolour pistes without a re-bake.

    python3 scripts/ski/prune_pistes.py <rid> [--remove id,id,...] [--colour id=black,id2=blue,...] [--dry]

A full re-bake of an older resort drifts (piste ids / order, buildings, classes) and would rename boards and saves, so this only touches
resort.json: every other key, every untouched piste / network row stays byte for byte (packed lines are not re-packed).
- --remove: the piste leaves `pistes` and the painted network ways that belong to it (>= 90 % of the way's points within TOL m of the
  piste line, and NOT >= 50 % within TOL m of any piste that stays: a branch shared with a living piste stays painted). The id stays
  RESERVED (RESORTS[rid]["reserved_ids"] in common.py: add it there, the script prints the line): never given to another run, its
  ski_board_floors row on production stays (no destructive DB change), and modes/piste-index.js keeps its slot (append-only).
  A landmark / start pointing at a removed piste stops the script.
- --colour: the piste's `diff` and the `d` letter of its painted ways (only ways matching that piste alone).
Nothing else changes: the terrain tiles, classes, map, panorama and buildings stay as baked (a removed piste leaves a smooth strip)."""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from linepack import unpack_line  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
LETTER = {"green": "g", "blue": "b", "red": "r", "black": "k"}
TOL = 5.0
WORD = {"green": "Gréng", "blue": "Blo", "red": "Rout", "black": "Schwaarz"}   # bake.py DIFF_WORD: "Rout 36" is a name made from the colour


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def pts_of(arr):
    return [(arr[i], arr[i + 1]) for i in range(0, len(arr) - 1, 2)]


def dist_to_line(p, line):
    best = 1e18
    for (ax, az), (bx, bz) in zip(line, line[1:]):
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2))
        best = min(best, math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz)))
    return best


def share(row_pts, line):
    """part of the row's points (every vertex + midpoints) within TOL m of the line"""
    samples = list(row_pts) + [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(row_pts, row_pts[1:])]
    return sum(1 for q in samples if dist_to_line(q, line) <= TOL) / max(1, len(samples))


def main():
    args = sys.argv[1:]
    rid = args[0]
    opt = {a: args[i + 2] for i, a in enumerate(args[1:]) if a in ("--remove", "--colour") and i + 2 < len(args)}
    remove = [x for x in opt.get("--remove", "").split(",") if x]
    colour = dict(x.split("=") for x in opt.get("--colour", "").split(",") if x)
    dry = "--dry" in args
    path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
    text = open(path, encoding="utf-8").read()
    r = json.loads(text)
    assert dump(r) == text, "resort.json is not in the compact form"
    by_id = {p["id"]: p for p in r["pistes"]}
    for i in remove + list(colour):
        assert i in by_id, "no piste with id %s" % i
    assert all(c in LETTER for c in colour.values()), colour
    lines = {p["id"]: pts_of(unpack_line(p["lz"])) for p in r["pistes"]}
    for lm in r.get("landmarks", []):
        assert lm.get("piste") not in remove, "landmark %s points at a removed piste" % lm
    assert r.get("start") not in remove, "the start piste is removed"
    keep_ids = [i for i in by_id if i not in remove]
    rows = [(n, pts_of(unpack_line(n["pz"]))) for n in r["network"] if "pz" in n and not n.get("a")]
    drop_rows, recolour = set(), {}
    for n, rp in rows:
        mine = [i for i in remove if share(rp, lines[i]) >= 0.9]
        if mine and not any(share(rp, lines[i]) >= 0.5 for i in keep_ids):
            drop_rows.add(id(n))
        for i, c in colour.items():
            if n["d"] == LETTER[by_id[i]["diff"]] and share(rp, lines[i]) >= 0.9:
                others = [j for j in keep_ids if j != i and share(rp, lines[j]) >= 0.5 and by_id[j]["diff"] != by_id[i]["diff"]]
                if not others:
                    recolour[id(n)] = LETTER[c]
    new_network, painted = [], 0
    for n in r["network"]:
        if id(n) in drop_rows:
            continue
        if id(n) in recolour:
            n = dict(n, d=recolour[id(n)])
            painted += 1
        new_network.append(n)
    new = dict(r)
    def recoloured(p):
        c = colour[p["id"]]
        name = p["name"]
        if name.startswith(WORD[p["diff"]] + " "):
            name = WORD[c] + name[len(WORD[p["diff"]]):]
        return dict(p, diff=c, name=name)
    new["pistes"] = [recoloured(p) if p["id"] in colour else p for p in r["pistes"] if p["id"] not in remove]
    new["network"] = new_network
    print("%s: pistes %d -> %d, network ways %d -> %d (%d dropped), %d painted ways recoloured" % (
        rid, len(r["pistes"]), len(new["pistes"]), len(r["network"]), len(new_network), len(drop_rows), painted))
    for i in remove:
        print("  removed %-34s %s %s %d m" % (i, by_id[i]["name"], by_id[i]["diff"], by_id[i]["len"]))
    for i, c in colour.items():
        print("  colour  %-34s %s %s -> %s" % (i, by_id[i]["name"], by_id[i]["diff"], c))
    if remove:
        print('  reserved_ids to add in common.py RESORTS["%s"]: %s' % (rid, ", ".join('"%s"' % i for i in remove)))
    if not dry:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(dump(new))


if __name__ == "__main__":
    main()
