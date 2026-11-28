#!/usr/bin/env python3
"""Surgical lift edits of a LIVE resort (28 Nov 2026, official-map alignment): remove / rename / add lifts without a re-bake.

    python3 scripts/ski/prune_lifts.py <rid> [--remove "osm:123;Name"] [--rename "osm:123=New name"] [--add file.json] [--dry]

Only resort.json `lifts` changes (every other key and lift stays byte for byte; compact form asserted). A lift is addressed by its OSM id
("osm:<id>") or its exact name. --add takes a JSON list of complete lift rows (appended at the END, never inserted: lift_index.mjs is
append-only). The lift index (modes/lift-index.js) keeps a removed lift as a dead slot."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))


def dump(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def match(lift, key):
    return str(lift.get("osm")) == key[4:] if key.startswith("osm:") else lift["name"] == key


def main():
    args = sys.argv[1:]
    rid = args[0]
    opt = {a: args[i + 2] for i, a in enumerate(args[1:]) if a in ("--remove", "--rename", "--add") and i + 2 < len(args)}
    remove = [x for x in opt.get("--remove", "").split(";") if x]
    rename = dict(x.split("=", 1) for x in opt.get("--rename", "").split(";") if x)
    add = json.load(open(opt["--add"], encoding="utf-8")) if "--add" in opt else []
    path = os.path.join(REPO, "pb", "ski", "data", rid, "resort.json")
    text = open(path, encoding="utf-8").read()
    r = json.loads(text)
    assert dump(r) == text, "resort.json is not in the compact form"
    for k in remove + list(rename):
        n = sum(1 for l in r["lifts"] if match(l, k))
        assert n == 1, "%s matches %d lifts" % (k, n)
    out = []
    for l in r["lifts"]:
        if any(match(l, k) for k in remove):
            print("  removed %-30s %s osm %s %d m" % (l["name"], l["kind"], l.get("osm"), l["len"]))
            continue
        for k, v in rename.items():
            if match(l, k):
                print("  renamed %s -> %s" % (l["name"], v))
                l = dict(l, name=v)
        out.append(l)
    for l in add:
        print("  added   %-30s %s osm %s %d m" % (l["name"], l["kind"], l.get("osm"), l["len"]))
        out.append(l)
    print("%s: lifts %d -> %d" % (rid, len(r["lifts"]), len(out)))
    if "--dry" not in args:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(dump(dict(r, lifts=out)))


if __name__ == "__main__":
    main()
