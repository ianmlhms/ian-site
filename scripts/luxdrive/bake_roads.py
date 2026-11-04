#!/usr/bin/env python3
"""Bake the OSM road network of Lux Drive into pb/lux-drive/data/roads.bin and names.json.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_roads.py

Every public road of the area (the OSM admin boundaries of Luxembourg and Niederanven plus a
300 m buffer) is baked with its REAL width, its number of lanes, its one-way flag, its bridge /
tunnel / layer flags and its name (Luxembourgish first).

The geometry is clipped to the area polygon, so a road that leaves the area ends exactly on the
boundary (where the invisible wall turns the car back) - never in the middle of a field.

roads.bin layout (little endian):
    u32 count
    per road:
      u16 kind        (see ROAD_KINDS below)
      u16 flags       bit0 bridge, bit1 tunnel, bit2 oneway, bit3 roundabout,
                     bits 4-7 the material of the way (0 = the default of the class, else the code + 1),
                     bit 8 the way rides over the ground (a bridge or a layer above the others)
      i16 layer       (OSM layer: +1 above the ground, -1 below)
      u16 lanes       (total lanes of the way, both directions unless one-way)
      u16 nameId      (index into names.json, 0xffff = none)
      f32 width       (m, total carriageway width of the way)
      f32 sidewalk    (m, width of the pavement on each side, 0 = none)
      f32 offset      (m, distance from the centre line to the right-hand lane centre: Luxembourg drives on the right)
      u16 npts
      i32 x0 (decimetres), i32 z0 (decimetres)
      varint zigzag deltas of x and z (decimetres)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, lonlat_to_luref, luref_to_world  # noqa: E402
from shapely.geometry import LineString, Point, Polygon, MultiPolygon, box  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

# kind code -> (lanes per direction, directions, lane width, shoulder per side, pavement per side)
#
# The width of a road is NOT a free number: it is the lanes of the way times the lane width of its class,
# plus the shoulder on each side.  A residential street is one lane per direction at 3.00 m plus a 20 cm
# shoulder: 6.40 m.  The classes with 0 lanes (a pedestrian way) are not carriageways at all: they are paved
# areas of a fixed width (PEDESTRIAN_WIDTH).
ROAD_KINDS = {
    'motorway':    (2, 2, 3.65, 2.5, 0.0),
    'trunk':       (1, 2, 3.50, 1.2, 0.0),
    'primary':     (1, 2, 3.40, 0.4, 2.5),
    'secondary':   (1, 2, 3.30, 0.3, 2.0),
    'tertiary':    (1, 2, 3.20, 0.2, 1.8),
    'unclassified':(1, 2, 3.10, 0.2, 1.6),
    'residential': (1, 2, 3.00, 0.2, 1.5),
    'living_street':(1, 2, 3.50, 0.0, 0.0),
    'pedestrian':  (0, 1, 4.00, 0.0, 0.0),
    'service':     (1, 2, 3.00, 0.2, 0.0),
    'busway':      (1, 2, 3.20, 0.2, 0.0),
    'track':       (1, 1, 2.60, 0.6, 0.0),
    'cycleway':    (1, 1, 1.80, 0.3, 0.0),
    'path':        (1, 1, 1.50, 0.4, 0.0),
    'footway':     (1, 1, 1.50, 0.4, 0.0),
    'bridleway':   (1, 1, 2.40, 0.5, 0.0),
    'steps':       (1, 1, 1.20, 0.2, 0.0),
    'road':        (1, 2, 3.00, 0.2, 1.0),
}
# the *_link classes are the slip roads of their parent class: one lane, one way
for _link, _parent in (('motorway_link', 'motorway'), ('trunk_link', 'trunk'),
                       ('primary_link', 'primary'), ('secondary_link', 'secondary'),
                       ('tertiary_link', 'tertiary')):
    ROAD_KINDS[_link] = (1, 1) + ROAD_KINDS[_parent][2:]
KIND_NAMES = sorted(ROAD_KINDS)
KIND_CODE = {k: i for i, k in enumerate(KIND_NAMES)}

# the width of a paved area (a pedestrian way): the OSM width tag when it is there, else this
PEDESTRIAN_WIDTH = 10.0

# The pavement of a street of the city.  The reviewer: "urban streets get pavements (OSM sidewalk tags, else
# ~2.5 m default on urban roads) in a paving colour; the land class urban is hard ground, not lawn".
URBAN_PAVEMENT = 2.5
URBAN_PAVEMENT_CLASSES = {"primary", "secondary", "tertiary", "unclassified", "residential",
                           "service", "road", "busway", "primary_link", "secondary_link", "tertiary_link"}
# How close a street has to come to the built-up area to count as a street of the city (m).
URBAN_NEAR = 20.0
# The landuse of the town: the areas that are built up.
URBAN_LANDUSE = {"residential", "commercial", "industrial", "retail"}

FLAG_BRIDGE = 1
FLAG_TUNNEL = 2
FLAG_ONEWAY = 4
FLAG_ROUNDABOUT = 8
FLAG_SURFACE_SHIFT = 4        # bits 4-7 hold the material of the way (0 = the default of the class)
FLAG_OVER = 256               # bit 8: the way rides OVER the ground: it is never carved into the height function,
                              # it gets a deck (decks.bin) at its own height and the ground under it stays the ground

# The material of a way: the OSM surface tag says what it is really made of.  The classes have a default
# (the browser knows it), the tag overrides it: a street with surface=sett is cobbled, a pedestrian area with
# surface=paving_stones is paved.  The codes are the ones the ground shader switches on.
SURFACE_CODES = {'asphalt': 0, 'cobble': 1, 'concrete': 2, 'gravel': 3, 'dirt': 4, 'stone': 5}
SURFACE_BY_TAG = {
    'asphalt': 'asphalt', 'bitumen': 'asphalt', 'tarmac': 'asphalt',
    'cobblestone': 'cobble', 'cobble': 'cobble', 'sett': 'cobble', 'setts': 'cobble',
    'unhewn_cobblestone': 'cobble', 'pebblestone': 'cobble',
    'concrete': 'concrete', 'concrete:lanes': 'concrete', 'concrete:plates': 'concrete',
    'paving_stones': 'stone', 'paved': 'stone', 'tiles': 'stone', 'slabs': 'stone', 'brick': 'stone',
    'gravel': 'gravel', 'fine_gravel': 'gravel', 'unpaved': 'gravel', 'compacted': 'gravel',
    'dirt': 'dirt', 'earth': 'dirt', 'ground': 'dirt', 'mud': 'dirt', 'grass': 'dirt', 'sand': 'dirt',
}
SIMPLIFY_M = 0.3
NO_NAME = 0xffff


def varint(n, out):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zigzag(n):
    return (n << 1) ^ (n >> 63)


def parse_float_list(value):
    """'3.5' -> [3.5]; '2.5;3' -> [2.5, 3.0]; '6' -> [6.0]."""
    out = []
    for part in str(value).replace(",", ";").split(";"):
        part = part.strip().split()[0] if part.strip() else ""
        try:
            out.append(float(part))
        except ValueError:
            continue
    return out


def lane_count(tags):
    """Total number of lanes of the way (both directions unless one-way)."""
    raw = tags.get("lanes")
    if raw:
        vals = parse_float_list(raw)
        if vals:
            return max(1, int(round(sum(vals))))
    return None


def one_way(tags):
    v = tags.get("oneway")
    if v in ("yes", "true", "1"):
        return True
    if v == "-1":                      # reversed one-way: the way is one-way against its direction
        return True
    if v in ("no", "false", "0"):
        return False
    if tags.get("junction") == "roundabout":
        return True
    if tags.get("highway") == "motorway":
        return True
    return False


def reversed_way(tags):
    return tags.get("oneway") == "-1"


def geometry_of(way, nodes):
    """LUREF (easting, northing) points of an OSM way."""
    xs, zs = [], []
    for nid in way["n"]:
        p = nodes.get(str(nid))
        if p is None:
            return []
        xs.append(p[0])
        zs.append(p[1])
    if len(xs) < 2:
        return []
    e, n = lonlat_to_luref(xs, zs)
    return list(zip(e.tolist(), n.tolist()))


def main():
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))
    nodes = osm["nodes"]
    area = json.load(open(os.path.join(RAW_DIR, "area_luref.json"), encoding="utf-8"))

    polys = []
    for rings in area["polygons"]:
        ext = rings[0]
        holes = rings[1:]
        p = Polygon(ext, holes)
        polys.append(p if p.is_valid else p.buffer(0))
    clip = unary_union(polys)
    print("clip area %.1f km2" % (clip.area / 1e6))

    names = []
    name_ids = {}

    def name_id(text):
        if not text:
            return NO_NAME
        if text not in name_ids:
            name_ids[text] = len(names)
            names.append(text)
        return name_ids[text]

    # ---- the built-up area: the streets of the city have a pavement ----------
    # A street in the town has a pavement, a street in the country has not.  The built-up area is the OSM
    # landuse of the town (residential, commercial, industrial, retail) and the buildings themselves.
    urban_shapes = []
    for way in osm["ways"]:
        tags = way["t"]
        is_building = tags.get("building") not in (None, "no")
        if not is_building and tags.get("landuse") not in URBAN_LANDUSE:
            continue
        pts = geometry_of(way, nodes)
        if len(pts) < 3:
            continue
        if abs(pts[0][0] - pts[-1][0]) > 1e-7 or abs(pts[0][1] - pts[-1][1]) > 1e-7:
            continue                        # only the closed ways are areas
        try:
            poly = Polygon(pts)
        except Exception:
            continue
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            continue
        urban_shapes.append(poly)
    urban_tree = STRtree(urban_shapes) if urban_shapes else None
    print("built-up areas: %d" % len(urban_shapes))

    def in_town(line):
        """True when the street runs through the built-up area (a street of the town)."""
        if urban_tree is None:
            return False
        return len(urban_tree.query(line.buffer(URBAN_NEAR))) > 0

    roads = []
    stats = {"bridge": 0, "tunnel": 0, "oneway": 0, "over": 0, "skipped": 0, "clipped": 0, "split": 0}
    for way in osm["ways"]:
        tags = way["t"]
        hw = tags.get("highway")
        if hw not in ROAD_KINDS:
            continue
        pts = geometry_of(way, nodes)
        if len(pts) < 2:
            stats["skipped"] += 1
            continue
        line = LineString(pts)
        if not line.intersects(clip):
            continue
        # clip to the area: a road that leaves the area ends exactly on the boundary
        parts = line.intersection(clip)
        if parts.is_empty:
            continue
        if parts.geom_type == "MultiLineString":
            # A way that leaves the area and comes back is several roads inside the area, one for every
            # piece of it.  The bake used to keep only the longest piece and throw the others away: 10.6 km
            # of road inside the area was missing, and the streets that met those pieces ended in nowhere.
            pieces = [g for g in parts.geoms if g.length >= 4]
        elif parts.geom_type == "LineString":
            pieces = [parts]
        else:
            continue
        if not pieces:
            continue
        if len(pieces) > 1:
            stats["split"] += 1

        lanes_per_dir, dirs, lane_w, shoulder, pavement = ROAD_KINDS[hw]
        ow = one_way(tags)
        # the width: the OSM width tag wins (it is surveyed), then the lanes of the way
        width_tag = None
        if "width" in tags:
            vals = parse_float_list(tags["width"])
            if vals:
                width_tag = max(vals)
        tagged_lanes = lane_count(tags)
        if width_tag is not None:
            width = width_tag
            total_lanes = tagged_lanes or max(1, lanes_per_dir * dirs)
        elif lanes_per_dir == 0:
            # a paved area (a pedestrian way): it has no lanes, it has a width
            width = PEDESTRIAN_WIDTH
            total_lanes = 1
        else:
            # The OSM lanes tag counts the lanes of the whole way (both directions unless it is one way);
            # the class default counts the lanes of ONE direction.
            if tagged_lanes:
                per_dir = float(tagged_lanes) if ow else tagged_lanes / 2.0
            else:
                per_dir = float(lanes_per_dir)
            sides = 1 if ow else dirs
            width = (per_dir * lane_w + shoulder) * sides
            total_lanes = max(1, int(round(per_dir * sides)))
        if width < 2.0:
            width = 2.0
        if width > 30.0:
            width = 30.0        # a "street" 30 m wide is a square, not a road

        bridge = tags.get("bridge") not in (None, "no", "false")
        tunnel = tags.get("tunnel") not in (None, "no", "false")
        layer = int(tags.get("layer", 0) or 0)
        flags = 0
        if bridge:
            flags |= FLAG_BRIDGE
            stats["bridge"] += 1
        if tunnel:
            flags |= FLAG_TUNNEL
            stats["tunnel"] += 1
        if ow:
            flags |= FLAG_ONEWAY
            stats["oneway"] += 1
        if tags.get("junction") == "roundabout":
            flags |= FLAG_ROUNDABOUT
        # A way that rides over the ground: a bridge, or a way that OSM puts on a layer above the others.  It is
        # never carved into the height function (the ground under it stays the ground), it gets a deck instead.
        if bridge or layer >= 1:
            flags |= FLAG_OVER
            stats["over"] += 1
        # the material of the way: the OSM surface tag (0 = the default of the class, the browser knows it)
        surf_name = SURFACE_BY_TAG.get((tags.get("surface") or "").strip().lower())
        if surf_name:
            flags |= (SURFACE_CODES[surf_name] + 1) << FLAG_SURFACE_SHIFT
        # the name: Luxembourgish first
        nm = tags.get("name:lb") or tags.get("name") or tags.get("name:de") or tags.get("name:fr") or ""
        nid = name_id(nm)

        for part in pieces:
            if part.length < line.length - 0.5:
                stats["clipped"] += 1
            # the pavement: from the OSM tag when it is there, else the class default
            sw = pavement
            if "sidewalk" in tags:
                v = tags["sidewalk"]
                if v in ("both", "left", "right", "yes"):
                    sw = max(sw, 1.8)
                elif v in ("no", "none"):
                    sw = 0.0
                else:
                    vals = parse_float_list(v)
                    if vals:
                        sw = vals[0]
            elif hw in URBAN_PAVEMENT_CLASSES and in_town(part):
                # A street of the town without a pavement tag gets the 2.5 m of a real pavement: the reviewer found
                # the grass growing right up to the walls of the houses.
                sw = URBAN_PAVEMENT
            # The right-hand lane centre, relative to the centre line. Luxembourg drives on the right, so the
            # car sits in the rightmost lane: +offset when it travels with the way, -offset against it.
            offset = max(0.0, width / 2 - lane_w / 2)
            part = part.simplify(SIMPLIFY_M, preserve_topology=False)
            luref = list(part.coords)
            if len(luref) < 2:
                continue
            wx, wz = luref_to_world([p[0] for p in luref], [p[1] for p in luref])
            pts = list(zip(wx.tolist(), wz.tolist()))
            roads.append({
                "kind": KIND_CODE[hw], "flags": flags, "layer": layer, "lanes": total_lanes,
                "nameId": nid, "width": round(width, 2), "sidewalk": round(sw, 2),
                "offset": round(offset, 2), "pts": pts, "id": way["id"], "highway": hw,
            })

    blob = bytearray()
    blob += (len(roads)).to_bytes(4, "little")
    total_pts = 0
    for r in roads:
        pts = r["pts"]
        blob += r["kind"].to_bytes(2, "little")
        blob += r["flags"].to_bytes(2, "little")
        blob += int(r["layer"]).to_bytes(2, "little", signed=True)
        blob += min(65535, r["lanes"]).to_bytes(2, "little")
        blob += r["nameId"].to_bytes(2, "little")
        blob += struct_pack_f32(r["width"])
        blob += struct_pack_f32(r["sidewalk"])
        blob += struct_pack_f32(r["offset"])
        blob += len(pts).to_bytes(2, "little")
        px, pz = round(pts[0][0] * 10), round(pts[0][1] * 10)
        blob += px.to_bytes(4, "little", signed=True)
        blob += pz.to_bytes(4, "little", signed=True)
        for x, z in pts[1:]:
            qx, qz = round(x * 10), round(z * 10)
            varint(zigzag(qx - px), blob)
            varint(zigzag(qz - pz), blob)
            px, pz = qx, qz
        total_pts += len(pts)
        r["length"] = sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))

    with open(os.path.join(OUT_DIR, "roads.bin"), "wb") as fh:
        fh.write(blob)
    with open(os.path.join(OUT_DIR, "names.json"), "w", encoding="utf-8") as fh:
        json.dump(names, fh, ensure_ascii=False, separators=(",", ":"))

    km = {}
    for r in roads:
        k = r["highway"]
        km[k] = km.get(k, 0) + r["length"]
    print("roads %d  points %d  names %d" % (len(roads), total_pts, len(names)))
    print("stats", stats)
    print("km by class:", {k: round(v / 1000, 1) for k, v in sorted(km.items(), key=lambda kv: -kv[1])})
    print("roads.bin %.2f MB, names.json %.1f kB" %
          (len(blob) / 1048576.0, os.path.getsize(os.path.join(OUT_DIR, "names.json")) / 1024.0))


def struct_pack_f32(v):
    import struct
    return struct.pack("<f", v)


if __name__ == "__main__":
    main()
