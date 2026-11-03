#!/usr/bin/env python3
"""Phase 1 of the area extraction: read the commune boundaries out of the local Luxembourg OSM extract.

    ~/Library/Caches/zuch-work/osm-venv/bin/python scripts/luxdrive/fetch_admin.py

The osm-venv has pyosmium but no pyproj/shapely, so this step only collects the raw rings
(degrees) and writes them to ~/Library/Caches/luxdrive-work/raw/admin_rings.json.
Phase 2 (bake_area.py, in the venv with pyproj/shapely) projects them and builds the world box.
"""
import json
import os
import sys

import osmium

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
RAW = os.path.join(WORK, "raw")
os.makedirs(RAW, exist_ok=True)

PBF = os.path.expanduser("~/Library/Caches/zuch-work/lux.osm.pbf")

COMMUNES = ("Luxembourg", "Niederanven")
ADMIN_LEVEL = "8"


def stitch(chains):
    """Joins the way fragments of one role into closed rings.

    A multipolygon relation stores its outer boundary as many ways; the ring only exists when the
    fragments are linked end to end by a shared node id.  Every endpoint of a well formed boundary
    has degree two, so the fragments form one cycle: we walk it from any fragment and extend the
    chain at its end (reversing a fragment when it is stored the other way round).
    """
    used = [False] * len(chains)
    rings = []
    for i0 in range(len(chains)):
        if used[i0]:
            continue
        used[i0] = True
        ring = list(chains[i0]["nodes"])
        start = ring[0]
        cur_end = ring[-1]
        grew = True
        while grew and cur_end != start:
            grew = False
            for j, ch in enumerate(chains):
                if used[j]:
                    continue
                nodes = ch["nodes"]
                if nodes[0] == cur_end:
                    ring += nodes[1:]
                    cur_end = nodes[-1]
                elif nodes[-1] == cur_end:
                    rev = nodes[::-1]
                    ring += rev[1:]
                    cur_end = rev[-1]
                else:
                    continue
                used[j] = True
                grew = True
                break
        if cur_end != start:
            print("  dropped an unclosed boundary fragment (%d nodes)" % len(ring))
            continue
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        rings.append(ring)
    return rings


def main():
    relations = {}

    class Rel(osmium.SimpleHandler):
        def relation(self, r):
            t = r.tags
            if t.get("boundary") != "administrative" or t.get("admin_level") != ADMIN_LEVEL:
                return
            if t.get("name") not in COMMUNES:
                return
            relations[r.id] = {"name": t.get("name"),
                               "members": [(m.type, m.ref, m.role) for m in r.members]}

    Rel().apply_file(PBF, locations=False)
    if not relations:
        raise SystemExit("no admin_level=8 boundary found for %s in %s" % (COMMUNES, PBF))
    print("commune relations:", {i: r["name"] for i, r in relations.items()})

    need = set()
    for info in relations.values():
        for typ, ref, role in info["members"]:
            if typ == "w" and role in ("outer", "inner"):
                need.add(ref)

    way_nodes = {}

    class Way(osmium.SimpleHandler):
        def way(self, w):
            if w.id in need:
                way_nodes[w.id] = [n.ref for n in w.nodes]

    Way().apply_file(PBF, locations=False)

    node_xy = {}

    class Nde(osmium.SimpleHandler):
        def node(self, n):
            if n.location.valid():
                node_xy[n.id] = (n.location.lon, n.location.lat)

    Nde().apply_file(PBF, locations=True)

    out = {}
    for rid, info in relations.items():
        outer, inner = [], []
        for typ, ref, role in info["members"]:
            if typ != "w" or role not in ("outer", "inner"):
                continue
            chain = way_nodes.get(ref)
            if chain and len(chain) >= 2:
                (outer if role == "outer" else inner).append({"nodes": chain})
        rings_o = stitch(outer)
        rings_i = stitch(inner)
        out[info["name"]] = {"outer": rings_o, "inner": rings_i}
        print("%-14s %d outer rings (%d nodes), %d inner rings" %
              (info["name"], len(rings_o), sum(len(r) for r in rings_o), len(rings_i)))
        for r in rings_o + rings_i:
            miss = sum(1 for nid in r if nid not in node_xy)
            if miss:
                print("  ring with %d nodes missing coordinates" % miss)

    path = os.path.join(RAW, "admin_rings.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(to_coords(out, node_xy), fh, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path) // 1024, "kB")


def to_coords(out, node_xy):
    """Replaces the node ids by their (lon, lat) so phase 2 does not need the PBF any more."""
    conv = {}
    for name, info in out.items():
        conv[name] = {
            "outer": [[node_xy[nid] for nid in ring if nid in node_xy] for ring in info["outer"]],
            "inner": [[node_xy[nid] for nid in ring if nid in node_xy] for ring in info["inner"]],
        }
    return conv



if __name__ == "__main__":
    sys.exit(main())
