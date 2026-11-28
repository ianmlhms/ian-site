#!/usr/bin/env python3
"""Official-map alignment of a LIVE resort (28 Nov 2026), surgical like prune_pistes.py (no re-bake).

    python3 scripts/ski/official_edit.py <rid> [--dry]

Reads scripts/ski/official/<rid>.json:
  removePistes [id]            -> prune_pistes.py --remove (painted ways go with them, ids must be added to reserved_ids in common.py)
  colour {id: colour}          -> prune_pistes.py --colour (diff + painted ways + the colour word of "Rout 36")
  pistes {id: {name?, ref?}}   -> name / ref from the official map (ids never change)
  removeLifts [osm id]         -> lifts that are not on the official lift list / map leave resort.json `lifts`
  liftNames {osm id: name}     -> official lift names
Only resort.json changes (compact form kept); lift_index / piste_index stay append-only. OSM decides geometry only, never existence."""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def main():
    rid = sys.argv[1]
    dry = "--dry" in sys.argv
    spec = json.load(open(os.path.join(HERE, "official", rid + ".json"), encoding="utf-8"))
    py = sys.executable
    pp = [py, os.path.join(HERE, "prune_pistes.py"), rid]
    if spec.get("removePistes"):
        pp += ["--remove", ",".join(spec["removePistes"])]
    if spec.get("colour"):
        pp += ["--colour", ",".join("%s=%s" % kv for kv in spec["colour"].items())]
    if len(pp) > 3:
        subprocess.run(pp + (["--dry"] if dry else []), check=True)
    path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
    r = json.load(open(path, encoding="utf-8"))
    by_id = {p["id"]: p for p in r["pistes"]}
    for i in spec.get("pistes", {}):
        assert i in by_id, "no piste %s" % i
    pistes = []
    for p in r["pistes"]:
        e = spec.get("pistes", {}).get(p["id"])
        if e:
            print("  piste %-30s %r %r -> %r %r" % (p["id"], p["name"], p["ref"], e.get("name", p["name"]), e.get("ref", p["ref"])))
            p = dict(p, **e)
        pistes.append(p)
    rm = set(spec.get("removeLifts", []))
    have = {l["osm"] for l in r["lifts"]}
    assert rm <= have, "unknown lift osm ids %s" % (rm - have)
    names = {int(k): v for k, v in spec.get("liftNames", {}).items()}
    lifts = []
    for l in r["lifts"]:
        if l["osm"] in rm:
            print("  lift removed %s %r %s m" % (l["osm"], l["name"], l["len"]))
            continue
        if l["osm"] in names:
            print("  lift %s %r -> %r" % (l["osm"], l["name"], names[l["osm"]]))
            l = dict(l, name=names[l["osm"]])
        lifts.append(l)
    new = dict(r, pistes=pistes, lifts=lifts)
    print("%s: pistes %d, lifts %d -> %d" % (rid, len(pistes), len(r["lifts"]), len(lifts)))
    if not dry:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(dump(new))


if __name__ == "__main__":
    main()
