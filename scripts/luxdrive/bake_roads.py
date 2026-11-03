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
      u16 flags       bit0 bridge, bit1 tunnel, bit2 oneway, bit3 roundabout
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

# kind code -> (default lanes per direction, lane width, shoulder per side, pavement per side)
ROAD_KINDS = {
    'motorway':    (0, 2, 3.65, 2.5, 0.0),
    'trunk':       (1, 2, 3.50, 1.2, 0.0),
    'primary':     (2, 2, 3.40, 0.4, 2.5),
    'secondary':   (3, 2, 3.30, 0.3, 2.0),
    'tertiary':    (4, 2, 3.20, 0.2, 1.8),
    'unclassified':(5, 2, 3.10, 0.2, 1.6),
    'residential': (6, 2, 3.00, 0.2, 1.5),
    'living_street':(7, 2, 3.50, 0.0, 0.0),
    'pedestrian':  (8, 1, 4.00, 0.0, 0.0),
    'service':     (9, 1, 3.00, 0.2, 0.0),
    'busway':      (10, 1, 3.20, 0.2, 0.0),
    'track':       (11, 1, 2.60, 0.6, 0.0),
    'cycleway':    (12, 1, 1.80, 0.3, 0.0),
    'path':        (13, 1, 1.50, 0.4, 0.0),
    'footway':     (14, 1, 1.50, 0.4, 0.0),
    'bridleway':   (15, 1, 2.40, 0.5, 0.0),
    'steps':       (16, 1, 1.20, 0.2, 0.0),
    'road':        (17, 2, 3.00, 0.2, 1.0),
}
# the *_link classes are the slip roads of their parent class: one lane per direction
for _link, _parent in (('motorway_link', 'motorway'), ('trunk_link', 'trunk'),
                       ('primary_link', 'primary'), ('secondary_link', 'secondary'),
                       ('tertiary_link', 'tertiary')):
    ROAD_KINDS[_link] = (ROAD_KINDS[_parent][0], 1) + ROAD_KINDS[_parent][2:]
KIND_NAMES = sorted(ROAD_KINDS)
KIND_CODE = {k: i for i, k in enumerate(KIND_NAMES)}

FLAG_BRIDGE = 1
FLAG_TUNNEL = 2
FLAG_ONEWAY = 4
FLAG_ROUNDABOUT = 8
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

    roads = []
    stats = {"bridge": 0, "tunnel": 0, "oneway": 0, "skipped": 0, "clipped": 0}
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
            parts = max(parts.geoms, key=lambda g: g.length)
        elif parts.geom_type != "LineString":
            continue
        if parts.length < 4:
            continue
        if parts.length < line.length - 0.5:
            stats["clipped"] += 1
        parts = parts.simplify(SIMPLIFY_M, preserve_topology=False)
        luref = list(parts.coords)
        if len(luref) < 2:
            continue
        wx, wz = luref_to_world([p[0] for p in luref], [p[1] for p in luref])
        pts = list(zip(wx.tolist(), wz.tolist()))

        default_lanes, default_dir, lane_w, shoulder, pavement = ROAD_KINDS[hw]
        ow = one_way(tags)
        total_lanes = lane_count(tags) or (default_lanes * default_dir)
        if ow:
            dir_lanes = max(1, total_lanes)
        else:
            dir_lanes = max(1, total_lanes // 2)
        # the width: the OSM width tag wins (it is surveyed), then the lanes, then the class default
        width_tag = None
        if "width" in tags:
            vals = parse_float_list(tags["width"])
            if vals:
                width_tag = max(vals)
        if width_tag is not None:
            width = width_tag
        else:
            carriage = dir_lanes * lane_w + shoulder
            width = carriage if ow else carriage * 2
        if width < 2.0:
            width = 2.0
        if width > 30.0:
            width = 30.0        # a "street" 30 m wide is a square, not a road
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
        # The right-hand lane centre, relative to the centre line. Luxembourg drives on the right, so
        # the car sits in the rightmost lane: +offset when it travels with the way, -offset against it.
        if ow:
            offset = width / 2 - width / (2 * dir_lanes)
        else:
            offset = width / 2 - width / (4 * dir_lanes)

        bridge = tags.get("bridge") not in (None, "no", "false")
        tunnel = tags.get("tunnel") not in (None, "no", "false")
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
        layer = int(tags.get("layer", 0) or 0)
        # the name: Luxembourgish first
        nm = tags.get("name:lb") or tags.get("name") or tags.get("name:de") or tags.get("name:fr") or ""
        roads.append({
            "kind": KIND_CODE[hw], "flags": flags, "layer": layer, "lanes": total_lanes,
            "nameId": name_id(nm), "width": round(width, 2), "sidewalk": round(sw, 2),
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
