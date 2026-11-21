#!/usr/bin/env python3
"""Compares a baked resort with the official lift / piste list of the resort (read from the resort's website by hand or by an agent,
kept OUTSIDE the repo: their lists are for checking only, never shipped).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/check_official.py arlberg OFFICIAL.json [OFFICIAL2.json ...]

OFFICIAL.json = {"lifts": [{"name", "type"}], "pistes": [{"name", "colour"}]}. Prints, for every official name that the baked
resort.json does not have: whether OSM has it at all (in the download, anywhere in the box + margin) and why it is not in the game:
    not in OSM        nobody mapped it (or under another name): an OSM gap, left as it is (no invented geometry)
    OSM, outside box  mapped, but outside the baked box
    OSM, not a run    mapped, but too short / flat for a run, a second mapping of another piste, or only an area
Names are compared loosely (accents, case, type words like TSD / Sessel / -bahn, numbers in front are ignored; one name inside the other
counts as found).
"""
import difflib
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RESORTS, Frame, REPO, osm_path, resort_arg  # noqa: E402

TYPE_WORDS = re.compile(r"\b(tsd\d*|tsf\d*|ts\d*|tc\d*|tk|tph|tps|dmc|tsdb\d*|tcd\d*|telesiege|teleski|telecabine|telepherique|telemix|funitel|"
                        r"funiculaire|teleporte|seggiovia|cabinovia|funivia|skilift|sessellift|sesselbahn|gondelbahn|kabinenbahn|pendelbahn|"
                        r"schlepplift|express|bahn|lift|jet|piste|abfahrt|skiroute|route|run|the|de|du|des|la|le|les|l|d|di|del|della|der|die|das)\b")


ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "deux": "2", "trois": "3", "zwei": "2", "drei": "3", "due": "2", "tre": "3"}


def norm(name):
    t = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"^\s*([a-z]|\d+)\s+(?=\w{3,})", " ", t)           # "A Sonnenkopfbahn", "12 Schindler"
    t = TYPE_WORDS.sub(" ", t)
    t = " ".join(ROMAN.get(w, w) for w in t.split())          # "Olang II" = "Olang 2"
    t = re.sub(r"(bahn|lift|jet|express)\b", " ", t)
    return " ".join(t.split())


def found(name, pool):
    n = norm(name)
    if not n:
        return True
    for p in pool:
        if not p:
            continue
        if n == p or (len(n) >= 4 and (n in p or p in n)):
            return True
    return bool(difflib.get_close_matches(n, [p for p in pool if p], n=1, cutoff=0.86))


def osm_names(rid, layer, frame):
    """{norm name: inside box?} of every named OSM way of the layer (with the names of route relations)."""
    out = {}
    with open(osm_path(rid, layer), encoding="utf-8") as fh:
        els = json.load(fh)["elements"]
    for e in els:
        t = e.get("tags", {})
        name = t.get("piste:name") or t.get("name")
        if not name:
            continue
        geom = e.get("geometry") or [g for m in e.get("members", []) for g in (m.get("geometry") or []) if g]
        if "lat" in e:
            geom = [{"lat": e["lat"], "lon": e["lon"]}]
        inside = False
        for g in geom[::3]:
            x, z = frame.to_world(g["lon"], g["lat"])
            if 0 <= x <= frame.width and 0 <= z <= frame.depth:
                inside = True
                break
        k = norm(name)
        out[k] = out.get(k, False) or inside
        for part in re.split(r"[/,;]| - | – ", name):
            if part.strip() and norm(part) != k:
                out.setdefault(norm(part), inside)
    return out


def main():
    rid = resort_arg()
    files = [a for a in sys.argv[2:] if a.endswith(".json")]
    frame = Frame(rid)
    with open(os.path.join(REPO, "pb", "ski", "data", rid, "resort.json"), encoding="utf-8") as fh:
        resort = json.load(fh)
    game = {"lifts": [norm(l["name"]) for l in resort["lifts"]] + [norm(l.get("ref", "")) for l in resort["lifts"]],
            "pistes": [norm(p["name"]) for p in resort["pistes"]]}
    osm = {"lifts": osm_names(rid, "lifts", frame), "pistes": osm_names(rid, "pistes", frame)}
    total = {"lifts": [0, 0], "pistes": [0, 0]}
    for path in files:
        with open(path, encoding="utf-8") as fh:
            off = json.load(fh)
        print("\n== %s (%s)" % (os.path.basename(path), ", ".join(off.get("sources", [])[:3])))
        for layer in ("lifts", "pistes"):
            names = []
            for item in off.get(layer, []):
                if item.get("name") and item["name"] not in names:
                    names.append(item["name"])
            miss = [n for n in names if not found(n, game[layer])]
            total[layer][0] += len(names)
            total[layer][1] += len(miss)
            print("  %s: %d official names, %d in the game, %d missing" % (layer, len(names), len(names) - len(miss), len(miss)))
            for n in miss:
                pool = osm[layer]
                hit = [k for k in pool if k and (k == norm(n) or (len(norm(n)) >= 4 and (norm(n) in k or k in norm(n))))]
                hit = hit or difflib.get_close_matches(norm(n), [k for k in pool if k], n=1, cutoff=0.86)
                why = "not in OSM" if not hit else "OSM, not a run" if any(pool[k] for k in hit) else "OSM, outside box"
                item = next(i for i in off[layer] if i.get("name") == n)
                print("     - %-44s %-14s %s" % (n[:44], (item.get("colour") or item.get("type") or "")[:14], why))
    print("\nTOTAL lifts %d official, %d missing; pistes %d official, %d missing" % (total["lifts"][0], total["lifts"][1], total["pistes"][0], total["pistes"][1]))


if __name__ == "__main__":
    main()
