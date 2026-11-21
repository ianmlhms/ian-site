"""Round 7-B: the lift-related parts of the bake (bake.py calls them; the client's lift-site.js / lift-path.js are the reference).

  arrange(lifts)            drag lifts get `track` = -1 when their track (the up lane beside the pylons) is better on the left of the
                            line (away from a neighbouring lift: twin T-bars), and a pylon standing in another lift's carrier lane is
                            moved along its own line until it is out (crossing lines)
  pad_stations(mosaic, lifts)   every station stands on a level pad: the 5 m heights under its footprint are set to the ground at the
                            line's end, blended out over PAD_BLEND m (so the hall, the platform and the boarding zone are flat)
  aisle_mask(shape, step, lifts, dem)   cells of the class raster where no tree may stand: the lift aisles (where the carriers pass
                            less than AISLE_HIGH m over the treetops), the stations and the pylon bases
The lane sizes mirror lift-path.js LIFT_SPEC / carrierBox (keep them in step)."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# lift-path.js: side (up lane), back (return lane), carrier half width, the drop under the rope, pylon and wheel heights
LANE = {"chair": (2.4, None, None, 2.68, 10.5, 2.68), "gondola": (3.0, 3.0, 1.0, 4.25, 15.0, 4.48), "cable": (5.0, 5.0, 2.25, 6.25, 34.0, 6.62),
        "drag": (2.4, 1.8, 0.55, 1.5, 6.5, 3.8), "rope": (1.35, 0.9, 0.1, 0.25, 1.35, 1.05), "carpet": (0.5, 0.5, 0.5, 0.0, 0.0, 0.0),
        "train": (2.1, 2.1, 1.32, 0.0, 0.0, 0.0), "funicular": (2.1, 2.1, 1.32, 0.0, 0.0, 0.0)}
# lift-site.js AISLE (half widths, m) and the station footprints (a = outward along the line, b = across, +b = the up lane's side)
AISLE = {"chair": 8, "gondola": 9, "cable": 12, "drag": 7, "rope": 5.5, "carpet": 4.5, "train": 8, "funicular": 8}
RECT = {"chair": (-10, 6, -10, 10), "gondola": (-15.5, 7.5, -8, 10.5), "cable": (-14, 13.5, -12.5, 12.5), "drag": (-6, 5, -3.5, 8.5),
        "rope": (-5, 2.5, -2.5, 5.5), "carpet": (-1, 2.5, -1.5, 1.5), "train": (-18.5, 2.6, -8, 8), "funicular": (-18.5, 2.6, -8, 8)}
AISLE_HIGH = 15.0                 # m between the carriers and the treetops where the forest may stay
TREE_TOP = 17.0
PAD_BLEND = 12.0                  # m over which a station pad blends into the slope
PAD_MAX = 9.0                     # m: the pad never cuts or fills more than this (a summit station on a ridge keeps its foundation)


def key_of(lf):
    if lf["kind"] == "drag" and lf.get("type") == "rope_tow":
        return "rope"
    return lf["kind"]


def lane(lf):
    """(side, back, carrier half width, drop, tower, wheel) of a lift (chairs: the width by the seat count, like lift-path.js)."""
    k = key_of(lf)
    side, back, hw, drop, tower, wheel = LANE.get(k, LANE["chair"])
    if k == "chair":
        w = max(1.6, min(4.2, (lf.get("seats") or 4) * 0.52))
        hw = w / 2 + 0.05
        side = max(2.4, hw + 0.95)
        back = side
    return side, back if back is not None else side, hw, drop, tower, wheel


def pts_of(lf):
    p = lf["pts"]
    return np.array(p, dtype=np.float64).reshape(-1, 2)


def project(p, x, z):
    """Nearest point of polyline p to (x, z): (arc length s, signed lateral (+ = right of the direction, r = (-dz, dx)), distance)."""
    best = (0.0, 0.0, 1e18)
    acc = 0.0
    for k in range(len(p) - 1):
        ax, az = p[k]
        dx, dz = p[k + 1] - p[k]
        L = math.hypot(dx, dz) or 1.0
        t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (L * L)))
        px, pz = ax + dx * t, az + dz * t
        d = math.hypot(x - px, z - pz)
        if d < best[2]:
            best = (acc + t * L, ((x - px) * -dz + (z - pz) * dx) / L, d)
        acc += L
    return best


def at(p, s):
    seg = np.hypot(*(np.diff(p, axis=0).T))
    cum = np.concatenate([[0], np.cumsum(seg)])
    s = max(0.0, min(float(cum[-1]), s))
    i = min(len(seg) - 1, int(np.searchsorted(cum, s, side="right") - 1))
    t = (s - cum[i]) / (seg[i] or 1.0)
    x, z = p[i] + (p[i + 1] - p[i]) * t
    d = (p[i + 1] - p[i]) / (seg[i] or 1.0)
    return float(x), float(z), float(d[0]), float(d[1])


def arrange(lifts, log=print):
    """The drag lifts' track side and the pylons out of other lifts' lanes (in place on the baked rows, before they are written)."""
    lines = [pts_of(lf) for lf in lifts]
    centres = [(p.mean(axis=0), float(np.hypot(*(np.diff(p, axis=0).T)).sum())) for p in lines]
    flipped = 0
    for i, lf in enumerate(lifts):
        if lf["kind"] != "drag":
            continue
        p = lines[i]
        length = centres[i][1]
        right = left = 1e9
        for s in np.arange(0, length, 10.0):
            x, z, dx, dz = at(p, s)
            for j, q in enumerate(lines):
                if j == i or np.hypot(*(centres[j][0] - (x, z))) > centres[j][1] / 2 + 60:
                    continue
                sj, _, d = project(q, x, z)
                if d > 25:
                    continue
                ox, oz, _, _ = at(q, sj)                       # the other line's nearest point, seen from this line
                rel = (ox - x) * -dz + (oz - z) * dx
                if rel >= 0:
                    right = min(right, abs(rel))
                else:
                    left = min(left, abs(rel))
        if left > right + 0.5:
            lf["track"] = -1
            flipped += 1
    moved = 0
    for j, lf in enumerate(lifts):
        if not lf.get("pylons"):
            continue
        p = lines[j]
        length = centres[j][1]
        new = []
        for s0 in lf["pylons"]:
            best = s0
            for shift in [0] + [v for k in range(1, 16) for v in (2.0 * k, -2.0 * k)]:
                s = s0 + shift
                if s <= 8 or s >= length - 8:
                    continue
                x, z, _, _ = at(p, s)
                if not in_other_lane(lifts, lines, centres, j, x, z):
                    best = s
                    break
            if best != s0:
                moved += 1
            new.append(round(best, 1))
        lf["pylons"] = sorted(set(new))
    log("lift layout: %d drag tracks on the left, %d pylons moved out of another lift's lane" % (flipped, moved))


def in_other_lane(lifts, lines, centres, j, x, z, pad=1.4):
    for i, lf in enumerate(lifts):
        if i == j or lf["kind"] == "carpet" or (lf["kind"] in ("funicular", "train") and lf.get("tunnel")):
            continue
        if np.hypot(*(centres[i][0] - (x, z))) > centres[i][1] / 2 + 30:
            continue
        side, back, hw, _, _, _ = lane(lf)
        sign = -1 if lf.get("track") == -1 else 1
        s, lat, d = project(lines[i], x, z)
        if s <= 0.01 or s >= centres[i][1] - 0.01:
            continue
        lat *= sign
        if -back - hw - pad < lat < side + hw + pad:
            return True
    return False


def end_frame(lf, which):
    p = pts_of(lf)
    if which == 0:
        x, z = p[0]
        d = p[1] - p[0]
    else:
        x, z = p[-1]
        d = p[-1] - p[-2]
    d = d / (np.hypot(*d) or 1.0)
    f = -d if which == 0 else d
    sign = -1 if lf.get("track") == -1 else 1
    r = np.array([-d[1], d[0]]) * sign
    return float(x), float(z), f, r


def pad_stations(mosaic, lifts, step, log=print):
    """Level pads under every station (in place on a copy of the 5 m mosaic)."""
    out = mosaic.astype(np.float64).copy()
    nz, nx = out.shape
    count = 0
    for lf in lifts:
        k = key_of(lf)
        a0, a1, b0, b1 = RECT.get(k, RECT["chair"])
        for which in (0, 1):
            x, z, f, r = end_frame(lf, which)
            i0, j0 = x / step, z / step
            if not (0 <= i0 < nx - 1 and 0 <= j0 < nz - 1):
                continue
            target = float(ndimage.map_coordinates(mosaic, [[j0], [i0]], order=1)[0])
            reach = max(abs(a0), abs(a1), abs(b0), abs(b1)) + PAD_BLEND + 2
            ilo, ihi = max(0, int((x - reach) / step)), min(nx - 1, int((x + reach) / step) + 1)
            jlo, jhi = max(0, int((z - reach) / step)), min(nz - 1, int((z + reach) / step) + 1)
            jj, ii = np.mgrid[jlo:jhi + 1, ilo:ihi + 1]
            wx, wz = ii * step - x, jj * step - z
            a = wx * f[0] + wz * f[1]
            b = wx * r[0] + wz * r[1]
            da = np.maximum(0, np.maximum(a0 - a, a - a1))
            db = np.maximum(0, np.maximum(b0 - b, b - b1))
            dist = np.hypot(da, db)
            w = np.clip(1 - dist / PAD_BLEND, 0, 1)
            w = w * w * (3 - 2 * w)
            cur = out[jlo:jhi + 1, ilo:ihi + 1]
            delta = np.clip(target - cur, -PAD_MAX, PAD_MAX)
            out[jlo:jhi + 1, ilo:ihi + 1] = cur + w * delta
            count += 1
    log("station pads: %d" % count)
    return out.astype(np.float32)


def rope_profile(lf, dem):
    """Rough rope heights along the line (the stations' wheels, the pylon tops, straight between): for the tree aisles."""
    p = pts_of(lf)
    length = float(np.hypot(*(np.diff(p, axis=0).T)).sum())
    side, back, hw, drop, tower, wheel = lane(lf)
    sup = [(0.0, wheel)] + [(s, tower) for s in lf.get("pylons") or [] if 6 < s < length - 6] + [(length, wheel)]
    sup.sort()
    ss = np.arange(0, length + 0.01, 5.0)
    xs, zs = [], []
    for s in ss:
        x, z, _, _ = at(p, s)
        xs.append(x)
        zs.append(z)
    g = dem(np.array(xs), np.array(zs))
    ys = []
    for s in ss:
        k = max(0, min(len(sup) - 2, int(np.searchsorted([q[0] for q in sup], s, side="right") - 1)))
        (sa, ha), (sb, hb) = sup[k], sup[k + 1]
        ia, ib = int(round(sa / 5)), int(round(sb / 5))
        ga, gb = g[min(ia, len(g) - 1)], g[min(ib, len(g) - 1)]
        t = (s - sa) / ((sb - sa) or 1)
        ys.append(ga + ha + (gb + hb - ga - ha) * t)
    return ss, np.array(xs), np.array(zs), g, np.array(ys), drop


def aisle_mask(shape, step, lifts, dem):
    """The class-raster cells where no tree may stand (True)."""
    nz, nx = shape
    img = Image.new("L", (nx, nz), 0)
    d = ImageDraw.Draw(img)
    for lf in lifts:
        k = key_of(lf)
        if lf["kind"] in ("funicular", "train") and lf.get("tunnel"):
            ends = True
        else:
            ends = False
        side, back, hw, drop, _, _ = lane(lf)
        half = max(AISLE.get(k, 8), max(side, back) + hw + 4.2)
        ss, xs, zs, g, ys, drop = rope_profile(lf, dem)
        aerial = k in ("chair", "gondola", "cable")
        length = ss[-1]
        for n in range(len(ss) - 1):
            if ends and AISLE_HIGH < ss[n] < length - 60:
                continue                                   # an underground line: only its ends at the surface
            low = (not aerial) or (min(ys[n], ys[n + 1]) - drop - (max(g[n], g[n + 1]) + TREE_TOP) < AISLE_HIGH)
            if not low:
                continue
            d.line([(xs[n] / step, zs[n] / step), (xs[n + 1] / step, zs[n + 1] / step)], fill=255, width=max(1, int(round(2 * half / step))))
        for which in (0, 1):
            x, z, f, r = end_frame(lf, which)
            a0, a1, b0, b1 = RECT.get(k, RECT["chair"])
            corners = [(x + f[0] * a + r[0] * b, z + f[1] * a + r[1] * b) for a, b in ((a0 - 4, b0 - 4), (a1 + 4, b0 - 4), (a1 + 4, b1 + 4), (a0 - 4, b1 + 4))]
            d.polygon([(cx / step, cz / step) for cx, cz in corners], fill=255)
        p = pts_of(lf)
        for s in lf.get("pylons") or []:
            x, z, _, _ = at(p, s)
            rr = 5.0 / step
            d.ellipse([x / step - rr, z / step - rr, x / step + rr, z / step + rr], fill=255)
    return np.asarray(img) > 0
