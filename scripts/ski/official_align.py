#!/usr/bin/env python3
"""Official-map alignment of a LIVE resort, surgical (28 Nov 2026): lifts removed / renamed, piste names / refs / colour words.

    python3 scripts/ski/official_align.py <rid> PLAN.json [--dry]

PLAN.json = {"remove_lifts": [osm id, ...], "rename_lifts": {"osm id": "name"},
             "edit_lifts": {"osm id": {field: value, ...}},     (shallow merge, e.g. a line re-placed after a GPS check)
             "pistes": {"piste id": {"name": "...", "ref": "..."}},       (either key optional)
             "colour_word": ["piste id", ...]}   (name word "(Blo..." / "(Rout..." follows the piste's CURRENT diff)
Pistes themselves are removed / recoloured by prune_pistes.py (run it first: it also drops the painted network ways). Only resort.json
changes (like prune_pistes.py: no re-bake, ids and order stay). A lift's osm id stays reserved by modes/lift-index.js (append-only).
Park / landmarks / first-lift names that point at a removed lift stop the script."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORD = {"green": "Gréng", "blue": "Blo", "red": "Rout", "black": "Schwaarz"}
WORD_RE = re.compile(r"\((Gréng|Blo|Rout|Schwaarz)")


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def main():
    rid, plan_path = sys.argv[1], sys.argv[2]
    dry = "--dry" in sys.argv
    plan = json.load(open(plan_path, encoding="utf-8"))
    path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
    text = open(path, encoding="utf-8").read()
    r = json.loads(text)
    assert dump(r) == text, "resort.json is not in the compact form"

    drop = {int(x) for x in plan.get("remove_lifts", [])}
    ren = {int(k): v for k, v in plan.get("rename_lifts", {}).items()}
    edit = {int(k): v for k, v in plan.get("edit_lifts", {}).items()}
    have = {l.get("osm") for l in r["lifts"]}
    for o in list(drop) + list(ren) + list(edit):
        assert o in have, "no lift with osm id %s" % o
    gone_names = {l["name"] for l in r["lifts"] if l.get("osm") in drop}
    survivors = {l["name"] for l in r["lifts"] if l.get("osm") not in drop}
    assert r["park"].get("lift") not in (gone_names - survivors), "the park's lift %s is removed" % r["park"].get("lift")
    lifts = []
    for l in r["lifts"]:
        o = l.get("osm")
        if o in drop:
            print("  lift removed  %-34s %s %d m osm %s" % (l["name"] or "(unnamed)", l["kind"], l["len"], o))
            continue
        if o in ren:
            print("  lift renamed  %-34s -> %s" % (l["name"], ren[o]))
            l = dict(l, name=ren[o])
        if o in edit:
            print("  lift edited   %-34s %s" % (l["name"], ", ".join(edit[o])))
            l = dict(l, **edit[o])
        lifts.append(l)

    by_id = {p["id"]: p for p in r["pistes"]}
    edits = plan.get("pistes", {})
    word_fix = set(plan.get("colour_word", []))
    for i in list(edits) + list(word_fix):
        assert i in by_id, "no piste with id %s" % i
    pistes = []
    for p in r["pistes"]:
        q = p
        if p["id"] in edits:
            q = dict(q, **edits[p["id"]])
        if p["id"] in word_fix:
            q = dict(q, name=WORD_RE.sub("(" + WORD[q["diff"]], q["name"], count=1))
        if q is not p:
            print("  piste         %-34s %-30s %-6s -> %s %s" % (p["id"], p["name"], p["ref"], q["name"], q["ref"]))
        pistes.append(q)

    new = dict(r, lifts=lifts, pistes=pistes)
    print("%s: lifts %d -> %d, pistes %d (renamed %d)" % (rid, len(r["lifts"]), len(lifts), len(pistes), len(edits) + len(word_fix)))
    if not dry:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(dump(new))


if __name__ == "__main__":
    main()
