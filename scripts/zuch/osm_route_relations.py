#!/usr/bin/env python3
"""Real service patterns: the `route=train` relations of an OSM extract with their ordered stops (the stop-list audit of REAL-LINES.md "W2c").
    ~/Library/Caches/zuch-work/osm-venv/bin/python scripts/zuch/osm_route_relations.py <extract.osm.pbf> "<regex over the relation's tag values>"
Needs pyosmium (`uv venv ~/Library/Caches/zuch-work/osm-venv && uv pip install --python .../python osmium`).  Slow on big extracts (about 80 s for Belgium)."""
import re
import sys

import osmium

pbf, pat = sys.argv[1], re.compile(sys.argv[2])


class Relations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rels = []

    def relation(self, r):
        t = dict(r.tags)
        if t.get("route") == "train" and pat.search(" ".join(str(v) for v in t.values())):
            self.rels.append((r.id, t, [(m.type, m.ref, m.role) for m in r.members]))


class Nodes(osmium.SimpleHandler):
    def __init__(self, need):
        super().__init__()
        self.need, self.n = need, {}

    def node(self, n):
        if n.id in self.need:
            self.n[n.id] = (n.tags.get("name"), n.location.lat, n.location.lon)


rel = Relations()
rel.apply_file(pbf)
nodes = Nodes({ref for _, _, m in rel.rels for ty, ref, _ in m if ty == "n"})
nodes.apply_file(pbf, locations=True)
for rid, t, members in rel.rels:
    stops = [nodes.n[ref][0] for ty, ref, role in members if ty == "n" and ref in nodes.n and role.startswith("stop")]
    print(rid, t.get("ref"), "|", t.get("name"), "|", t.get("operator"), "|", len(stops))
    print("    ", " > ".join(str(x) for x in stops))
