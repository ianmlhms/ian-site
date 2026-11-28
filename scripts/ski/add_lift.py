#!/usr/bin/env python3
"""Adds ONE lift of a LIVE resort from an OSM way (any tag state, e.g. construction=yes) without a re-bake (28 Nov 2026).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/add_lift.py <rid> <osm way id> [--name "Name"] [--ref R] [--seats N] [--dry]

It runs bake.build_lifts() on that single way (same projection, same DEM cache, same pylons / stations / kind rules as the bake) and appends
the row to resort.json `lifts`; nothing else changes (terrain tiles keep no station pad: the lift stands on the baked ground). The lift index
is append-only (run scripts/ski/lift_index.mjs afterwards). Official map decides WHETHER the lift exists; OSM only gives the line."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bake  # noqa: E402
from bake import Dem, Frame, apply_drawdown, build_lifts, load_mosaic, load_osm  # noqa: E402
from common import RESORTS  # noqa: E402


def main():
    a = sys.argv[1:]
    rid, wid = a[0], int(a[1])
    opt = {k: a[i + 3] for i, k in enumerate(a[2:]) if k in ("--name", "--ref", "--seats") and i + 3 < len(a)}
    cfg = RESORTS[rid]
    frame = Frame(rid)
    frame.rid = rid
    raw = load_mosaic(rid, frame)
    raw, _, _ = apply_drawdown(frame, cfg, raw, load_osm(rid, "areas"))
    dem = Dem(raw)
    els = load_osm(rid, "lifts")
    way = next(e for e in els if e["type"] == "way" and e["id"] == wid)
    tags = {k: v for k, v in way["tags"].items() if k not in ("construction",)}
    way = dict(way, tags=tags)
    stations = [e for e in els if e.get("tags", {}).get("aerialway") == "station"]
    orig = bake.load_osm
    bake.load_osm = lambda r, n: [way] + stations if n == "lifts" else orig(r, n)
    try:
        rows = build_lifts(frame, dem)
    finally:
        bake.load_osm = orig
    assert len(rows) == 1, "expected one lift, got %d" % len(rows)
    row = rows[0]
    if "--name" in opt:
        row["name"] = opt["--name"]
    if "--ref" in opt:
        row["ref"] = opt["--ref"]
    if "--seats" in opt:
        row["seats"] = int(opt["--seats"])
    print(json.dumps({k: v for k, v in row.items() if k not in ("pylons",)}, ensure_ascii=False))
    if "--dry" in a:
        return
    path = os.path.join(os.path.dirname(os.path.dirname(HERE)), "pb", "ski", "data", rid, "resort.json")
    r = json.load(open(path, encoding="utf-8"))
    assert all(l["osm"] != wid for l in r["lifts"]), "lift already in the data"
    r["lifts"] = r["lifts"] + [row]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(r, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
