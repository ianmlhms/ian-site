"""Reader for the baked buildings (pb/lux-drive/data/buildings.bin) - used by the probes."""
import os
import struct

from common import OUT_DIR

ROOF_FLAT = 0
ROOF_PITCHED = 1


class Reader:
    def __init__(self, data):
        self.d = data
        self.p = 0

    def u8(self):
        v = self.d[self.p]
        self.p += 1
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.d, self.p)[0]
        self.p += 4
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
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


def decode_buildings(path=None):
    """-> a list of building dicts (x, z in metres)."""
    path = path or os.path.join(OUT_DIR, "buildings.bin")
    blob = open(path, "rb").read()
    r = Reader(blob)
    count = r.u32()
    out = []
    for _ in range(count):
        roof = r.u8()
        style = r.u8()
        ridge_dir = r.u8()
        levels = r.u8()
        eave = r.u16() / 10.0
        ridge = r.u16() / 10.0
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
        out.append({"roof": roof, "style": style, "ridgeDir": ridge_dir * 2 * 3.14159265 / 256,
                    "levels": levels, "eave": eave, "ridge": ridge, "pts": pts})
    return out


def poly_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return s * 0.5
