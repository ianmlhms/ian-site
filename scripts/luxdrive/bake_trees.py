#!/usr/bin/env python3
"""Bake the trees of Lux Drive: the trees OSM knows and the rows of trees along the streets.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_trees.py

The woods are not in here: they come from the LiDAR canopy at run time (a forest is a cover, not a list of trees).
What OSM knows are the trees a person mapped one by one: the plane trees of the boulevards, the trees of the parks,
the old trees of the villages.  The rows of trees (`natural=tree_row`) are the lines of trees along the streets:
they are spread out here at the real spacing of a street tree (9 m), so the Avenue des Arts gets its avenue of trees.

trees.bin layout (little endian):
    u32 count
    per tree:
      i32 x (decimetres), i32 z (decimetres)
      u8  height (decimetres)
      u8  kind      0 = a broadleaf, 1 = a conifer, 2 = a bush
      u8  girth     the width of the crown in per cent of the height
      u8  flags     bit0 = the tree stands in a street (the trees of a row)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, lonlat_to_luref, luref_to_world  # noqa: E402
from roads_io import DRIVABLE, decode_roads  # noqa: E402
from buildings_io import decode_buildings  # noqa: E402

KIND_BROADLEAF, KIND_CONIFER, KIND_BUSH = 0, 1, 2
FLAG_IN_STREET = 1
ROW_SPACING = 9.0             # m between the trees of a row (the plane trees of the boulevards)
STREET_HEIGHT = 13.0          # m, the height of a street tree
FIELD_HEIGHT = 12.0           # m, the height of a tree in a park or a meadow
PAVEMENT = 1.3                # m, how far past the kerb a tree of a row stands
TREE_CLEAR = 0.6              # m, a tree that stands this close to a wall is inside the house
SAMPLE_SPACING = 4.0          # m between the samples of a centre line (ROAD.sampleSpacing in config.js)
LINE_SMOOTHING = 3.0          # m, sigma of the Gaussian that rounds the corners (ROAD.lineSmoothing)


def height_of(tags, default, seed):
    """The height of a tree: the surveyed height when there is one, else a default that varies with the seed."""
    raw = tags.get("height")
    if raw:
        digits = ""
        for ch in raw.strip():
            if ch.isdigit() or ch == ".":
                digits += ch
            else:
                break
        try:
            value = float(digits)
            if 1.0 <= value <= 25.0:
                return value
        except ValueError:
            pass
    return max(2.0, default + ((seed * 37) % 7) - 3.0)


def resample(points, spacing):
    """The polyline every `spacing` metres (the twin of `resample` in `pb/lux-drive/road-network.js`)."""
    xs = [points[0][0]]
    zs = [points[0][1]]
    carry = 0.0
    for i in range(1, len(points)):
        ax, az = points[i - 1]
        bx, bz = points[i]
        seg = math.hypot(bx - ax, bz - az)
        while carry + seg >= spacing:
            k = (spacing - carry) / seg
            ax += (bx - ax) * k
            az += (bz - az) * k
            xs.append(ax)
            zs.append(az)
            seg = math.hypot(bx - ax, bz - az)
            carry = 0.0
        carry += seg
    last = points[-1]
    if math.hypot(last[0] - xs[-1], last[1] - zs[-1]) > spacing * 0.35:
        xs.append(last[0])
        zs.append(last[1])
    return list(zip(xs, zs))


def gaussian_smooth(values, sigma_samples):
    """A Gaussian smoothing of a series of values (the ends are renormalised)."""
    n = len(values)
    radius = max(1, int(math.ceil(sigma_samples * 2.5)))
    kernel = [math.exp(-(k * k) / (2 * sigma_samples * sigma_samples)) for k in range(-radius, radius + 1)]
    out = []
    for i in range(n):
        total = weight = 0.0
        for k in range(-radius, radius + 1):
            j = i + k
            if j < 0 or j >= n:
                continue
            w = kernel[k + radius]
            total += values[j] * w
            weight += w
        out.append(total / weight)
    return out


def game_line(points):
    """The centre line of a way as the game draws it: resampled, and the corners rounded."""
    rs = resample(points, SAMPLE_SPACING)
    if len(rs) > 4:
        sx = gaussian_smooth([p[0] for p in rs], LINE_SMOOTHING / SAMPLE_SPACING)
        sz = gaussian_smooth([p[1] for p in rs], LINE_SMOOTHING / SAMPLE_SPACING)
        rs = [(rs[0][0], rs[0][1])] + list(zip(sx[1:-1], sz[1:-1])) + [(rs[-1][0], rs[-1][1])]
    return rs


class RoadIndex:
    """The ways a car may drive on, as segments with their half width, in a coarse grid: a tree that OSM
    mapped on the centre line of a street has to be moved to the pavement, or the car drives into it.

    Only the drivable ways count: a tree on a footpath is a tree on a footpath, and the game paints no
    footpath, so nothing is in the way of the car.

    The centre line is the one the GAME draws: the polyline of the way resampled and its corners rounded
    (`game_line` below, the twin of `resample` + `gaussianSmooth` in `pb/lux-drive/road-network.js`).  The
    rounded line is up to a metre away from the OSM polyline, and a tree that stands on the OSM line is then
    in the middle of the street the game paints.
    """

    CELL = 32.0

    def __init__(self, roads):
        self.ways = []                    # the polylines and their half width
        self.cells = {}                   # cell -> the segments (the way, the segment)
        for r in roads:
            if r["kind"] not in DRIVABLE:
                continue
            pts = game_line(r["pts"])
            if len(pts) < 2:
                continue
            wi = len(self.ways)
            self.ways.append((pts, max(0.8, r["width"] / 2.0)))
            for i in range(len(pts) - 1):
                ax, az = pts[i]
                bx, bz = pts[i + 1]
                self.add(wi, i, ax, az, bx, bz)

    def add(self, wi, si, ax, az, bx, bz):
        key = (wi, si)
        for cx in range(int(min(ax, bx) // self.CELL), int(max(ax, bx) // self.CELL) + 1):
            for cz in range(int(min(az, bz) // self.CELL), int(max(az, bz) // self.CELL) + 1):
                self.cells.setdefault((cx, cz), []).append(key)

    def nearest(self, x, z):
        """The nearest centre line: (distance, half width, the point on the line, the way, the segment)."""
        best = None
        for c in self._candidates(x, z):
            if best is None or c[0] < best[0]:
                best = c
        return best

    def containing(self, x, z):
        """The way whose carriageway the point is in: the one the point is deepest in.

        The edge of the carriageway belongs to the carriageway (a tree that stands exactly on the kerb is
        in the way of the car), so the test is the same one the game makes.
        """
        best = None
        for c in self._candidates(x, z):
            margin = c[1] - c[0]
            if margin < 0:
                continue
            if best is None or margin > best[0]:
                best = (margin, c)
        return best[1] if best else None

    def inside(self, x, z):
        """Is the point in the carriageway of ANY way?  The deepest one is not enough: the boulevards have
        two carriageways side by side, and a tree that is out of one of them stands in the other."""
        for c in self._candidates(x, z):
            if c[1] - c[0] >= 0:
                return True
        return False

    def direction(self, wi, si):
        """The direction of the way at the segment: the average of the segments around it.

        The average is what makes the move work at a corner: the tree is moved along the bisector of the way,
        so it does not land in the band of the next segment.
        """
        pts, _hw = self.ways[wi]
        ux = uz = 0.0
        for k in (si - 1, si, si + 1):
            if k < 0 or k + 1 >= len(pts):
                continue
            ax, az = pts[k]
            bx, bz = pts[k + 1]
            ex, ez = bx - ax, bz - az
            length = math.hypot(ex, ez)
            if length < 1e-6:
                continue
            ux += ex / length
            uz += ez / length
        length = math.hypot(ux, uz)
        if length < 1e-6:
            return 1.0, 0.0
        return ux / length, uz / length

    def _candidates(self, x, z):
        """The ways near the point: (distance, half width, the point on the line, the way, the segment)."""
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for wi, si in self.cells.get((int(x // self.CELL) + dx, int(z // self.CELL) + dz), []):
                    pts, hw = self.ways[wi]
                    ax, az = pts[si]
                    bx, bz = pts[si + 1]
                    ex, ez = bx - ax, bz - az
                    ll = ex * ex + ez * ez
                    t = 0.0 if ll < 1e-9 else max(0.0, min(1.0, ((x - ax) * ex + (z - az) * ez) / ll))
                    qx, qz = ax + ex * t, az + ez * t
                    yield (math.hypot(x - qx, z - qz), hw, qx, qz, wi, si)


class HouseIndex:
    """The footprints of the baked houses: a tree that stands inside a house is a mapping error."""

    CELL = 32.0

    def __init__(self):
        self.cells = {}
        try:
            houses = decode_buildings()
        except (OSError, ValueError):
            return
        for b in houses:
            pts = b["pts"]
            # the whole box of the house, not only the cells its wall crosses: a tree in the middle of a big
            # factory is inside it, and the wall is far away
            xs = [p[0] for p in pts]
            zs = [p[1] for p in pts]
            for cx in range(int(min(xs) // self.CELL), int(max(xs) // self.CELL) + 1):
                for cz in range(int(min(zs) // self.CELL), int(max(zs) // self.CELL) + 1):
                    self.cells.setdefault((cx, cz), []).append(pts)

    def too_close(self, x, z, margin):
        """Is the point inside a house, or within `margin` of its wall?"""
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for poly in self.cells.get((int(x // self.CELL) + dx, int(z // self.CELL) + dz), []):
                    if point_in_poly(poly, x, z):
                        return True
                    if dist_to_poly(poly, x, z) < margin:
                        return True
        return False


def point_in_poly(poly, px, pz):
    """Is the point inside the polygon?  The ring is not closed."""
    hit = False
    n = len(poly)
    for i in range(n):
        j = (i - 1) % n
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > pz) != (zj > pz) and px < (xj - xi) * (pz - zi) / (zj - zi) + xi:
            hit = not hit
    return hit


def dist_to_poly(poly, px, pz):
    """The distance from the point to the ring of the polygon."""
    best = 1e30
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        ax, az = poly[i]
        bx, bz = poly[j]
        ex, ez = bx - ax, bz - az
        ll = ex * ex + ez * ez
        t = 0.0 if ll < 1e-9 else max(0.0, min(1.0, ((px - ax) * ex + (pz - az) * ez) / ll))
        d = math.hypot(px - (ax + ex * t), pz - (az + ez * t))
        if d < best:
            best = d
    return best


def quantized(x, z):
    """The position as the file stores it: the trees are written in decimetres, so the game reads the
    rounded position and the clearance has to be checked there."""
    return round(x * 10.0) / 10.0, round(z * 10.0) / 10.0


def clear_spots(index, x, z, depth=3):
    """The places near (x, z) where no car can drive, nearest first.

    A tree that OSM mapped on the centre line of a street has to be moved to the pavement, or the car drives
    into it.  The tree is moved sideways, along the way, to the edge of the carriageway plus the width of a
    pavement; both sides are tried, because the pavement of one street may be the carriageway of the next one
    (the medians of the boulevards have no room at all).

    The places are given nearest first, and there may be none: a tree in the middle of a square that is
    ringed by streets has no place off the tarmac, and the caller drops it.
    """
    seen = set()
    frontier = [quantized(x, z)]
    for _ in range(depth + 1):
        nxt = []
        for (px, pz) in frontier:
            key = (round(px, 1), round(pz, 1))
            if key in seen:
                continue
            seen.add(key)
            if not index.inside(px, pz):
                yield px, pz
                continue
            hit = index.containing(px, pz)
            d, hw, qx, qz, wi, si = hit
            ux, uz = index.direction(wi, si)
            # to the side of the way the tree is on: the sign of the cross product
            side = 1.0 if (ux * (pz - qz) - uz * (px - qx)) >= 0 else -1.0
            for s in (side, -side):
                nxt.append(quantized(qx - uz * s * (hw + PAVEMENT), qz + ux * s * (hw + PAVEMENT)))
        frontier = nxt


def place(index, houses, x, z):
    """Where the tree stands: off the tarmac and out of the houses.  None when it has no place."""
    for (px, pz) in clear_spots(index, x, z):
        if houses.too_close(px, pz, TREE_CLEAR):
            continue
        return px, pz
    return None


def main():
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))
    roads, _names = decode_roads()
    index = RoadIndex(roads)
    houses = HouseIndex()
    trees = []

    # ---- the trees that OSM knows one by one --------------------------------
    dropped = 0
    for p in osm["pois"]:
        t = p["t"]
        if t.get("natural") not in ("tree", "shrub"):
            continue
        x, z = luref_to_world(*lonlat_to_luref(p["lon"], p["lat"]))
        bush = t.get("natural") == "shrub"
        kind = KIND_BUSH if bush else KIND_BROADLEAF
        h = height_of(t, 3.0 if bush else FIELD_HEIGHT, p["id"])
        girth = 95 if bush else int(52 + (p["id"] % 23))
        spot = place(index, houses, float(x), float(z))
        if spot is None:
            dropped += 1                # a tree in a house or in the tarmac is a mapping error, not a tree
            continue
        trees.append({"x": spot[0], "z": spot[1], "h": h, "kind": kind, "girth": girth, "flags": 0})

    # ---- the rows of trees along the streets ---------------------------------
    nodes = osm["nodes"]
    rows = 0
    moved = 0
    for w in osm["ways"]:
        t = w["t"]
        if t.get("natural") != "tree_row":
            continue
        pts = []
        for nid in w["n"]:
            p = nodes.get(str(nid))
            if p:
                pts.append(p)
        if len(pts) < 2:
            continue
        lons = [p[0] for p in pts]
        lats = [p[1] for p in pts]
        e, n = lonlat_to_luref(lons, lats)
        wx, wz = luref_to_world(e, n)
        pts = list(zip(wx.tolist(), wz.tolist()))
        # spread the row out at the real spacing of a street tree
        for i in range(1, len(pts)):
            ax, az = pts[i - 1]
            bx, bz = pts[i]
            length = ((bx - ax) ** 2 + (bz - az) ** 2) ** 0.5
            if length < 1.0:
                continue
            count = max(1, int(length // ROW_SPACING))
            for k in range(count):
                f = (k + 0.5) / count
                h = height_of(t, STREET_HEIGHT, w["id"] + k)
                tx, tz = ax + (bx - ax) * f, az + (bz - az) * f
                # a row that OSM mapped on the centre line of the street: the trees stand on the pavement
                spot = place(index, houses, tx, tz)
                if spot is None:
                    dropped += 1
                    continue
                ox, oz = quantized(tx, tz)
                if abs(spot[0] - ox) > 0.5 or abs(spot[1] - oz) > 0.5:
                    moved += 1
                trees.append({"x": spot[0], "z": spot[1], "h": h,
                              "kind": KIND_BROADLEAF, "girth": 58, "flags": FLAG_IN_STREET})
            rows += count
    print("the rows: %d trees, %d of them moved onto the pavement" % (rows, moved))
    print("%d trees dropped: no place off the tarmac" % dropped)

    blob = bytearray()
    blob += (len(trees)).to_bytes(4, "little")
    for t in trees:
        blob += int(round(t["x"] * 10)).to_bytes(4, "little", signed=True)
        blob += int(round(t["z"] * 10)).to_bytes(4, "little", signed=True)
        blob += int(round(t["h"] * 10)).to_bytes(1, "little")
        blob += t["kind"].to_bytes(1, "little")
        blob += t["girth"].to_bytes(1, "little")
        blob += t["flags"].to_bytes(1, "little")
    with open(os.path.join(OUT_DIR, "trees.bin"), "wb") as fh:
        fh.write(blob)

    from collections import Counter
    print("trees %d (%s), the rows %d, trees.bin %.1f kB" %
          (len(trees), dict(Counter(t["kind"] for t in trees)), rows, len(blob) / 1024.0))


if __name__ == "__main__":
    main()
