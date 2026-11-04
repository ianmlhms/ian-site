#!/usr/bin/env python3
"""Probe: no house of Lux Drive floats and no house is cut into the hill.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/probe_buildings.py

The house of Lux Drive stands on the ground the game draws: the bottom of its walls follows the ground under
every point of its footprint, and the top of the walls is flat, at the height of the eaves above the ground of
the middle of the house (the same rule as pb/lux-drive/building-mesh.js).

The probe is the Python twin of the game.  It reads the baked houses (pb/lux-drive/data/buildings.bin), the
terrain the game draws (pb/lux-drive/data/terrain.bin, the de-spiked LiDAR) and the road network (roads.bin),
and it carves the roads into the terrain the way pb/lux-drive/road-network.js carves them.  Then it measures,
for every house and for every point of the bottom of its walls:

  * floating: the base of the house is more than 0.3 m above the ground  -> the house stands on stilts;
  * buried:   the ground is more than 1 m above the base of the house  -> the hill eats the house.

A house that fails either way is a FAIL (exit code 1).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, NEAR_STEP, sample_bicubic  # noqa: E402
from codec import decode_np  # noqa: E402
from buildings_io import decode_buildings  # noqa: E402
from roads_io import decode_roads, DRIVABLE  # noqa: E402

# ---- the constants of the game (pb/lux-drive/config.js and pb/lux-drive/road-network.js)
CELL = 22.0                # m, the cell of the spatial hash of the road segments
MAX_RADIUS = 22.0          # m, no kernel reaches farther than this
EMBANKMENT = 18.0          # m, how far the batter reaches past the pavement
MAX_BATTER_SLOPE = 0.8     # m up per m out, the slope limit of the ground beside a road
BED_CLAMP = 1.2            # m, how far the bed of a road may leave the ground
BED_SMOOTH = 6.0           # m, the sigma of the smoothing of the bed along the centre line
LINE_SMOOTH = 3.0          # m, the sigma of the rounding of the corners of the centre line
SAMPLE_SPACING = 4.0       # m, the spacing of the samples of a centre line
KERB_HEIGHT = 0.13         # m, the height of the kerb
KERB_WIDTH = 0.35          # m, the width of the kerb face
KERB_SURFACES = {"asphalt", "cobble", "concrete"}
LEVEL_FULL = 4.0           # m, a road shapes the ground that lies at its own level within this
LEVEL_FADE = 14.0          # m, and its influence is gone at this distance
PROTECT_MARGIN = 4.0       # m, the ground beside a way that rides over the others is protected this far
PROTECT_FADE = 10.0        # m, the protection fades out over this distance
PROTECT_CELL = 64.0        # m, the cell of the spatial hash of the protected corridors
OVER_LEVEL = 1.5           # m, at a crossing the way this much higher rides over the other one
BATTER_STEP = 2.0          # m, the step of the walk that finds where the batter gives up
BATTER_TOL = 0.05          # m, how close the land must be to the road for the batter to end
CROSS_CELL = 32.0          # m, the cell of the grid of the centre lines that finds the crossings

# ---- the rule of the house (pb/lux-drive/building-mesh.js)
EDGE_STEP = 1.0            # m, the spacing of the points along one edge of the footprint
EDGE_TOL = 0.15            # m, how far the ground may leave the line between two corners before a point is kept
MIN_WALL = 0.3             # m, the shortest wall a house may keep where the ground climbs over its eaves
FLOAT_LIMIT = 0.3          # m, the base of a house may not be this far above the ground
BURY_LIMIT = 1.0           # m, the ground may not be this far above the base of a house
KEEP = 12                  # how many offenders are printed

_grid = decode_np(open(os.path.join(OUT_DIR, "terrain.bin"), "rb").read())
_nx, _nz = _grid.shape[1], _grid.shape[0]
_flat = _grid.astype(float).ravel().tolist()


def land(x, z):
    """The land: the de-spiked LiDAR, sampled exactly as the browser samples it."""
    return sample_bicubic((_nx, _nz, _flat), x / NEAR_STEP, z / NEAR_STEP)


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def gaussian_smooth(values, sigma):
    """The Gaussian of the game (pb/lux-drive/road-network.js), the same kernel and the same edges."""
    n = len(values)
    radius = max(1, int(math.ceil(sigma * 2.5)))
    kernel = [math.exp(-(k * k) / (2.0 * sigma * sigma)) for k in range(-radius, radius + 1)]
    out = []
    for i in range(n):
        total = 0.0
        weight = 0.0
        for k in range(-radius, radius + 1):
            j = i + k
            if j < 0 or j >= n:
                continue
            w = kernel[k + radius]
            total += values[j] * w
            weight += w
        out.append(total / weight if weight > 0 else values[i])
    return out


def resample(points, spacing):
    """The centre line of a way, resampled every `spacing` m (the Python twin of resample() in the game)."""
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
    return xs, zs


def batter_length(px, pz, nx, nz, bed, a0, max_edge):
    """How far the batter reaches on one side of a way: the ramp from the level of the way reaches the land,
    and where it does not, the land is steeper than the slope limit and the batter runs its full length."""
    last_fail = -1.0
    e = 0.0
    while e <= max_edge + 1e-6:
        g = land(px + nx * (a0 + e), pz + nz * (a0 + e))
        if abs(g - bed) > MAX_BATTER_SLOPE * e + BATTER_TOL:
            last_fail = e
        e += BATTER_STEP
    if last_fail < 0:
        return max_edge
    return min(max_edge, last_fail + BATTER_STEP)


def build_network():
    """The road network of the game: the centre lines, the beds, the batters and the ways that ride over."""
    roads, _names = decode_roads()
    ways = []
    corridors = []          # the corridors of the ways that ride over the others: their ground is protected
    for r in roads:
        tagged = bool(r["over"]) or r["layer"] >= 1
        x, z = resample(r["pts"], SAMPLE_SPACING)
        n = len(x)
        if n < 2:
            continue
        if n > 4:                       # round the corners of the (sparse) OSM polyline
            sx = gaussian_smooth(x, LINE_SMOOTH / SAMPLE_SPACING)
            sz = gaussian_smooth(z, LINE_SMOOTH / SAMPLE_SPACING)
            for i in range(1, n - 1):
                x[i] = sx[i]
                z[i] = sz[i]
        hw = max(0.8, r["width"] / 2.0)
        kerb_h = KERB_HEIGHT if r["surface"] in KERB_SURFACES else 0.0
        kerb_w = KERB_WIDTH if kerb_h > 0 else 0.0
        pw = max(0.0, r["sidewalk"])
        bench = hw + kerb_w
        a0 = bench + pw
        reach = min(MAX_RADIUS, bench + EMBANKMENT)
        if tagged and not r["tunnel"]:
            # the way rides over the ground: it is never carved and the ground under it stays the ground
            corridors.append((x, z, a0 + PROTECT_MARGIN))
            continue
        if r["kind"] not in DRIVABLE or r["tunnel"] or tagged:
            continue
        # the bed of the way: the land along the centre line, smoothed, and never further from the ground than
        # the clamp allows (a street over a cliff must not be smoothed into the cliff face)
        ground = [land(x[i], z[i]) for i in range(n)]
        bed = gaussian_smooth(ground, BED_SMOOTH / SAMPLE_SPACING)
        for i in range(n):
            bed[i] = max(ground[i] - BED_CLAMP, min(ground[i] + BED_CLAMP, bed[i]))
        notch_l = []
        notch_r = []
        fade_l = []
        fade_r = []
        for i in range(n):
            if i == 0:
                dx, dz = x[1] - x[0], z[1] - z[0]
            elif i == n - 1:
                dx, dz = x[n - 1] - x[n - 2], z[n - 1] - z[n - 2]
            else:
                dx, dz = x[i + 1] - x[i - 1], z[i + 1] - z[i - 1]
            length = math.hypot(dx, dz) or 1.0
            nx, nz = -dz / length, dx / length         # to the right of the way, the way the traffic runs
            max_edge = reach - bench
            fade_r.append(batter_length(x[i], z[i], nx, nz, bed[i], bench, max_edge))
            fade_l.append(batter_length(x[i], z[i], -nx, -nz, bed[i], bench, max_edge))
            # the notch of the way on each side: how deep the bench of the way is cut into the land
            notch_r.append(land(x[i] + nx * bench, z[i] + nz * bench) - bed[i])
            notch_l.append(land(x[i] - nx * bench, z[i] - nz * bench) - bed[i])
        ways.append({"x": x, "z": z, "bed": bed, "notchL": notch_l, "notchR": notch_r,
                     "fadeL": fade_l, "fadeR": fade_r, "bench": bench, "a0": a0, "reach": reach})
    over = find_crossings(ways)
    for i in over:
        ways[i]["over"] = True
    return ways, corridors, over


def crossing(ax, az, bx, bz, cx, cz, dx, dz):
    """Where the segment AB crosses the segment CD: the parameters t (on AB) and u (on CD), or None."""
    rx, rz = bx - ax, bz - az
    sx, sz = dx - cx, dz - cz
    den = rx * sz - rz * sx
    if abs(den) < 1e-9:
        return None
    qx, qz = cx - ax, cz - az
    t = (qx * sz - qz * sx) / den
    u = (qx * rz - qz * rx) / den
    if t < 0 or t > 1 or u < 0 or u > 1:
        return None
    return t, u


def find_crossings(ways):
    """The ways that OSM does not tag as bridges but that ride over another way: at a crossing, the way whose
    bed is more than OVER_LEVEL higher keeps its own earthworks and the ground under it is protected."""
    grid = {}
    for wi, w in enumerate(ways):
        for i in range(1, len(w["x"])):
            for cx in range(int(math.floor(min(w["x"][i - 1], w["x"][i]) / CROSS_CELL)),
                            int(math.floor(max(w["x"][i - 1], w["x"][i]) / CROSS_CELL)) + 1):
                for cz in range(int(math.floor(min(w["z"][i - 1], w["z"][i]) / CROSS_CELL)),
                                int(math.floor(max(w["z"][i - 1], w["z"][i]) / CROSS_CELL)) + 1):
                    grid.setdefault((cx, cz), []).append((wi, i))
    over = set()
    for wi, w in enumerate(ways):
        for i in range(1, len(w["x"])):
            ax, az = w["x"][i - 1], w["z"][i - 1]
            bx, bz = w["x"][i], w["z"][i]
            for cx in range(int(math.floor(min(ax, bx) / CROSS_CELL)), int(math.floor(max(ax, bx) / CROSS_CELL)) + 1):
                for cz in range(int(math.floor(min(az, bz) / CROSS_CELL)), int(math.floor(max(az, bz) / CROSS_CELL)) + 1):
                    for (wj, j) in grid.get((cx, cz), ()):
                        if wj <= wi:
                            continue
                        other = ways[wj]
                        hit = crossing(ax, az, bx, bz, other["x"][j - 1], other["z"][j - 1],
                                       other["x"][j], other["z"][j])
                        if hit is None:
                            continue
                        bed_a = w["bed"][i - 1] + (w["bed"][i] - w["bed"][i - 1]) * hit[0]
                        bed_b = other["bed"][j - 1] + (other["bed"][j] - other["bed"][j - 1]) * hit[1]
                        if bed_a > bed_b + OVER_LEVEL:
                            over.add(wi)
                        elif bed_b > bed_a + OVER_LEVEL:
                            over.add(wj)
    return over


class Ground:
    """The ground of the game: the terrain with the roads carved into it (the Python twin of the carve of
    pb/lux-drive/road-network.js)."""

    def __init__(self, ways, corridors):
        self.seg = []
        for wi, w in enumerate(ways):
            no_batter = 1 if w.get("over") else 0
            for i in range(len(w["x"]) - 1):
                self.seg.append((
                    w["x"][i], w["z"][i], w["x"][i + 1], w["z"][i + 1],
                    w["bed"][i], w["bed"][i + 1], w["bench"], w["a0"], w["reach"],
                    w["notchL"][i], w["notchL"][i + 1], w["notchR"][i], w["notchR"][i + 1],
                    w["fadeL"][i], w["fadeL"][i + 1], w["fadeR"][i], w["fadeR"][i + 1], no_batter,
                ))
        # the spatial hash of the segments
        self.buckets = {}
        for i, s in enumerate(self.seg):
            reach = s[8]
            for cx in range(int(math.floor(min(s[0], s[2]) / CELL)), int(math.floor(max(s[0], s[2]) / CELL)) + 1):
                for cz in range(int(math.floor(min(s[1], s[3]) / CELL)), int(math.floor(max(s[1], s[3]) / CELL)) + 1):
                    self.buckets.setdefault((cx, cz), []).append(i)
        # the protected corridors: the ground under a way that rides over the others stays the ground
        self.prot = {}
        self.prot_seg = []
        self.prot_half = []
        for (x, z, half) in corridors:
            for i in range(1, len(x)):
                self.prot_seg.append((x[i - 1], z[i - 1], x[i], z[i]))
                self.prot_half.append(half)
                self._add_prot(len(self.prot_seg) - 1, x[i - 1], z[i - 1], x[i], z[i])
        for w in ways:
            if not w.get("over"):
                continue
            for i in range(len(w["x"]) - 1):
                self.prot_seg.append((w["x"][i], w["z"][i], w["x"][i + 1], w["z"][i + 1]))
                self.prot_half.append(w["a0"] + PROTECT_MARGIN)
                self._add_prot(len(self.prot_seg) - 1, w["x"][i], w["z"][i], w["x"][i + 1], w["z"][i + 1])

    def _add_prot(self, s, ax, az, bx, bz):
        for cx in range(int(math.floor(min(ax, bx) / PROTECT_CELL)), int(math.floor(max(ax, bx) / PROTECT_CELL)) + 1):
            for cz in range(int(math.floor(min(az, bz) / PROTECT_CELL)), int(math.floor(max(az, bz) / PROTECT_CELL)) + 1):
                self.prot.setdefault((cx, cz), []).append(s)

    def candidates(self, minx, minz, maxx, maxz):
        """The segments that can shape the ground inside a box."""
        out = []
        seen = set()
        for cx in range(int(math.floor(minx / CELL)), int(math.floor(maxx / CELL)) + 1):
            for cz in range(int(math.floor(minz / CELL)), int(math.floor(maxz / CELL)) + 1):
                for i in self.buckets.get((cx, cz), ()):
                    if i in seen:
                        continue
                    seen.add(i)
                    s = self.seg[i]
                    reach = s[8]
                    if maxx < min(s[0], s[2]) - reach or minx > max(s[0], s[2]) + reach:
                        continue
                    if maxz < min(s[1], s[3]) - reach or minz > max(s[1], s[3]) + reach:
                        continue
                    out.append(i)
        return out

    def protection(self, x, z):
        cx = int(math.floor(x / PROTECT_CELL))
        cz = int(math.floor(z / PROTECT_CELL))
        p = 0.0
        for ox in (-1, 0, 1):
            for oz in (-1, 0, 1):
                for s in self.prot.get((cx + ox, cz + oz), ()):
                    ax, az, bx, bz = self.prot_seg[s]
                    ex, ez = bx - ax, bz - az
                    ll = ex * ex + ez * ez
                    t = ((x - ax) * ex + (z - az) * ez) / ll if ll > 1e-9 else 0.0
                    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                    d = math.hypot(x - (ax + ex * t), z - (az + ez * t)) - self.prot_half[s]
                    if d <= 0:
                        return 1.0
                    if d < PROTECT_FADE:
                        v = 1.0 - d / PROTECT_FADE
                        if v > p:
                            p = v
        return p

    def at(self, x, z, cand):
        """The ground at a point: the terrain, with the roads carved into it."""
        ground = land(x, z)
        dev_sum = 0.0
        dev_w = 0.0
        for i in cand:
            s = self.seg[i]
            reach = s[8]
            if x < min(s[0], s[2]) - reach or x > max(s[0], s[2]) + reach:
                continue
            if z < min(s[1], s[3]) - reach or z > max(s[1], s[3]) + reach:
                continue
            ax, az = s[0], s[1]
            ex, ez = s[2] - ax, s[3] - az
            ll = ex * ex + ez * ez
            t = ((x - ax) * ex + (z - az) * ez) / ll if ll > 1e-9 else 0.0
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            rx, rz = x - (ax + ex * t), z - (az + ez * t)
            length = math.sqrt(ll) or 1.0
            lat = (rx * -ez + rz * ex) / length       # the signed offset from the LINE of the way
            d = math.hypot(rx, rz)                    # the distance to the SEGMENT of the way
            if d >= reach:
                continue
            bench = s[6]
            edge = d - bench if d > bench else 0.0
            bed = s[4] + (s[5] - s[4]) * t
            if lat >= 0:
                notch = s[11] + (s[12] - s[11]) * t
                fade = s[15] + (s[16] - s[15]) * t
            else:
                notch = s[9] + (s[10] - s[9]) * t
                fade = s[13] + (s[14] - s[13]) * t
            if fade <= 0:
                continue
            off = ground - bed
            level = 1.0 if notch >= 0 else 1.0 - smoothstep(LEVEL_FULL, LEVEL_FADE, -off)
            if s[17]:
                continue                             # a way that rides over the others has no batter at all
            if notch >= 0:
                # a cut: the land beside the way is the land itself, shifted down by the notch
                reach_c = reach - bench
                if reach_c <= 0 or edge >= reach_c:
                    continue
                dev = -notch * (1.0 - smoothstep(0.0, reach_c, edge)) if edge > 0 else bed - ground
                claim_reach = reach_c
            else:
                # a fill: the ground beside the way is a ramp of at most the slope limit from the level of the way
                if edge >= fade:
                    continue
                lim = MAX_BATTER_SLOPE * edge
                shaped = bed + (lim if off > lim else (-lim if off < -lim else off))
                dev = level * (shaped - ground)
                claim_reach = fade
            fall = 1.0 - edge / claim_reach
            claim = fall * fall
            dev_sum += claim * dev
            dev_w += claim
        prot = self.protection(x, z)
        if dev_w > 0:
            return ground + (1.0 - prot) * (dev_sum / dev_w)
        return ground


def wall_bottom(ax, az, bx, bz, ay, by, limit, height_at):
    """The bottom of a wall: the corners, and the points where the ground leaves the line between them."""
    length = math.hypot(bx - ax, bz - az)
    steps = max(1, int(round(length / EDGE_STEP)))
    keep = [(ax, ay, az)]
    for s in range(1, steps):
        t = s / float(steps)
        x = ax + (bx - ax) * t
        z = az + (bz - az) * t
        h = height_at(x, z)
        line = ay + (by - ay) * t
        if abs(h - line) > EDGE_TOL:
            keep.append((x, h, z))
    keep.append((bx, by, bz))
    return [(p[0], min(p[1], limit), p[2]) for p in keep]


def measure(buildings, ground, bottom_shift=0.0):
    """The measurement: every house, every point of the bottom of its walls.

    `bottom_shift` pushes the bottom of the walls down: it is only used by the self-test."""
    floating = []
    buried = []
    inverted = 0
    points = 0
    for b in buildings:
        pts = b["pts"]
        n = len(pts)
        if n < 3:
            continue
        cx = sum(p[0] for p in pts) / n
        cz = sum(p[1] for p in pts) / n
        minx = min(p[0] for p in pts)
        maxx = max(p[0] for p in pts)
        minz = min(p[1] for p in pts)
        maxz = max(p[1] for p in pts)
        cand = ground.candidates(minx - MAX_RADIUS, minz - MAX_RADIUS, maxx + MAX_RADIUS, maxz + MAX_RADIUS)

        def height_at(x, z):
            return ground.at(x, z, cand)

        # the eaves of the house: on the ground the player sees, so a house beside a road on an embankment does
        # not sink into it
        ground_y = max(land(cx, cz), height_at(cx, cz))
        eave_y = ground_y + b["eave"]
        limit = eave_y - MIN_WALL - bottom_shift
        # the corners of the house: their ground
        corners = [height_at(p[0], p[1]) for p in pts]
        for g in corners:
            if g > eave_y:
                inverted += 1
        worst_float = 0.0
        worst_bury = 0.0
        for i in range(n):
            ax, az = pts[i]
            bx, bz = pts[(i + 1) % n]
            bottom = wall_bottom(ax, az, bx, bz, corners[i], corners[(i + 1) % n], limit, height_at)
            for (x, y, z) in bottom:
                points += 1
                g = height_at(x, z)
                if y - g > FLOAT_LIMIT:
                    worst_float = max(worst_float, y - g)
                if g - y > BURY_LIMIT:
                    worst_bury = max(worst_bury, g - y)
        if worst_float > 0:
            floating.append({"x": round(cx), "z": round(cz), "over": round(worst_float, 2)})
        if worst_bury > 0:
            buried.append({"x": round(cx), "z": round(cz), "under": round(worst_bury, 2)})
    return {"floating": floating, "buried": buried, "inverted": inverted, "points": points}


def main():
    self_test = "--self-test" in sys.argv
    ways, corridors, over = build_network()
    ground = Ground(ways, corridors)
    buildings = decode_buildings()
    result = measure(buildings, ground)
    floating = result["floating"]
    buried = result["buried"]
    inverted = result["inverted"]

    print("probe: the houses of Lux Drive")
    print("  the houses:                %d" % len(buildings))
    print("  the points of their base:  %d" % result["points"])
    print("  the ways that ride over:    %d" % len(over))
    print("  standing on stilts:        %d houses" % len(floating))
    print("  cut into the hill:         %d houses" % len(buried))
    print("  the hill over the eaves:   %d corners" % inverted)
    for f in floating[:KEEP]:
        print("    on stilts at (%d, %d): %.2f m" % (f["x"], f["z"], f["over"]))
    for f in buried[:KEEP]:
        print("    cut into the hill at (%d, %d): %.2f m" % (f["x"], f["z"], f["under"]))

    if self_test:
        # the self-test: the probe must catch a house that the hill eats.  Every house of the map is measured
        # with the bottom of its walls sixty metres too low: the ground must be over nearly all of them, or the
        # probe measures nothing.
        low = measure(buildings, ground, 60.0)
        caught = len(low["buried"])
        print("self-test: with the bottom of the walls sixty metres too low, the probe catches %d of %d houses"
              % (caught, len(buildings)))
        if caught < len(buildings) * 0.99:
            print("FAIL: the self-test did not catch the houses it should have caught")
            return 1
        print("the self-test passes")

    if floating or buried or inverted:
        print("FAIL: %d houses float, %d are cut into the hill, %d corners are upside down"
              % (len(floating), len(buried), inverted))
        return 1
    print("PASS: every house stands on the ground and the hill never eats it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
