"""Reader for the baked road network (pb/lux-drive/data/roads.bin) - used by the probes.

The browser has its own decoder in pb/lux-drive/roads.js; this one is the Python twin, so the
probes see exactly the geometry the game sees.
"""
import json
import os
import struct

from common import OUT_DIR

KIND_NAMES = ['bridleway', 'busway', 'cycleway', 'footway', 'living_street', 'motorway',
              'motorway_link', 'path', 'pedestrian', 'primary', 'primary_link', 'residential',
              'road', 'secondary', 'secondary_link', 'service', 'steps', 'tertiary',
              'tertiary_link', 'track', 'trunk', 'trunk_link', 'unclassified']

FLAG_BRIDGE = 1
FLAG_TUNNEL = 2
FLAG_ONEWAY = 4
FLAG_ROUNDABOUT = 8
FLAG_SURFACE_SHIFT = 4        # bits 4-7 hold the material of the way (0 = the default of the class)
FLAG_OVER = 256               # bit 8: the way rides over the ground (a bridge, or a layer above it): it is never
                              # carved into the height function, it gets a deck (decks.bin) instead

# the material of a way, as the number the ground shader switches on
SURFACE_NAMES = ['asphalt', 'cobble', 'concrete', 'gravel', 'dirt', 'stone']
CLASS_SURFACE = {              # the default of every class (the same table as the browser, roads.js)
    'motorway': 'asphalt', 'motorway_link': 'asphalt', 'trunk': 'asphalt', 'trunk_link': 'asphalt',
    'primary': 'asphalt', 'primary_link': 'asphalt', 'secondary': 'asphalt', 'secondary_link': 'asphalt',
    'tertiary': 'asphalt', 'tertiary_link': 'asphalt', 'unclassified': 'asphalt', 'residential': 'asphalt',
    'living_street': 'cobble', 'pedestrian': 'stone', 'service': 'asphalt', 'busway': 'asphalt',
    'road': 'asphalt', 'track': 'gravel', 'cycleway': 'concrete', 'path': 'gravel', 'footway': 'concrete',
    'bridleway': 'dirt', 'steps': 'concrete',
}

# the classes a car may drive on: the foot ways are painted on the ground, not carved
DRIVABLE = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
            'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
            'residential', 'living_street', 'pedestrian', 'service', 'busway', 'road', 'track'}


class Reader:
    def __init__(self, data):
        self.d = data
        self.p = 0

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
        return v

    def i16(self):
        v = struct.unpack_from("<h", self.d, self.p)[0]
        self.p += 2
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.d, self.p)[0]
        self.p += 4
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.p)[0]
        self.p += 4
        return v

    def f32(self):
        v = struct.unpack_from("<f", self.d, self.p)[0]
        self.p += 4
        return v

    def varint(self):
        n = 0
        s = 0
        while True:
            b = self.d[self.p]
            self.p += 1
            n |= (b & 0x7F) << s
            if b < 0x80:
                return n
            s += 7


def unzig(n):
    return (n >> 1) ^ -(n & 1)


def decode_roads(path=None, names_path=None):
    """-> (list of road dicts, list of names)."""
    path = path or os.path.join(OUT_DIR, "roads.bin")
    names_path = names_path or os.path.join(OUT_DIR, "names.json")
    names = json.load(open(names_path, encoding="utf-8"))
    blob = open(path, "rb").read()
    r = Reader(blob)
    count = r.u32()
    roads = []
    for _ in range(count):
        kind = r.u16()
        flags = r.u16()
        layer = r.i16()
        lanes = r.u16()
        name_id = r.u16()
        width = r.f32()
        sidewalk = r.f32()
        offset = r.f32()
        n = r.u16()
        x = r.i32() / 10.0
        z = r.i32() / 10.0
        pts = [(x, z)]
        px, pz = x, z
        for _i in range(n - 1):
            dx = unzig(r.varint())
            dz = unzig(r.varint())
            px += dx / 10.0
            pz += dz / 10.0
            pts.append((px, pz))
        kind = KIND_NAMES[kind] if kind < len(KIND_NAMES) else "road"
        # the material of the way: the OSM surface tag, else the default of its class
        surf_bits = (flags >> FLAG_SURFACE_SHIFT) & 15
        surface = SURFACE_NAMES[surf_bits - 1] if surf_bits else CLASS_SURFACE.get(kind, "asphalt")
        roads.append({
            "kind": kind,
            "kindCode": kind, "flags": flags, "layer": layer, "lanes": lanes,
            "nameId": name_id, "name": names[name_id] if name_id < len(names) else "",
            "width": width, "sidewalk": sidewalk, "offset": offset, "pts": pts,
            "bridge": bool(flags & FLAG_BRIDGE), "tunnel": bool(flags & FLAG_TUNNEL),
            "over": bool(flags & FLAG_OVER),
            "oneway": bool(flags & FLAG_ONEWAY), "surface": surface,
        })
    return roads, names


def road_length(r):
    p = r["pts"]
    return sum(((p[i][0] - p[i - 1][0]) ** 2 + (p[i][1] - p[i - 1][1]) ** 2) ** 0.5
               for i in range(1, len(p)))
