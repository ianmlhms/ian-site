#!/usr/bin/env python3
"""Roofs (and optionally façades) step 3 (houses17): bake the real roof photos of the game's LOD2 buildings of the area.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_facades.py [--roof-ppm 3] [--quality 80] [--dry]
        [--walls --ppm 4]    ALSO bake the cleaned-up façade textures of the walls (off: Ian shipped roofs only, the painted walls stay)
        [--sheet <png>]      a contact sheet of walls (kept / fallback, with their numbers) for tuning the checks

What ships (roofs only, the default): pb/lux-drive/data/roofs/index.json + r_<cx>_<cz>_<page>.webp, streamed by roof-view.js.
The wall pipeline below still runs (its numbers decide which houses were seen well, and the white balance of the area comes
from the lit walls, so the roofs come out exactly as with --walls) but its pictures are only written with --walls; the game
has no runtime for them any more (facade-view.js / facade-data.js of commit 6965b107 draw them: restore those to use them).

Source: the ACT "Bâtiments 3D 2023" CityGML LOD2.2 (CC0), whose every wall and roof carries a texture cut from oblique
aerial photos (facade_parse.py, facade_fetch.py).  The game's buildings are the same survey, simplified (bake_buildings.py):
footprints extruded to a flat top at the highest wall point of the ACT building, a hip roof above.

Per game wall (an edge of a game footprint):
  1. Rectify.  The ACT polygons of the same building that face the same way are rendered orthographically onto the game
     wall, nearest first (a z-buffer): walls, and the steep roof planes over the eaves, so the top of a game wall that stands
     where the real house already has its mansard shows that mansard.  Every polygon is mapped with a homography from its
     corners' uv (the photo is a perspective view of a plane).  The texture's top row is the top of the game wall (= the
     highest wall point of the ACT building); its bottom row is BAND metres above the real ground at that wall.
  2. Clean up.  The lowest BAND metres (cars, shadows, people, the smeared shop fronts) are never baked: the game paints its
     own shop fronts / doors there, in the colour of the wall above (the `paint` table).  A wall the cameras did not see
     well - little coverage, little detail (smudged), trees in front, a blurry source - is not baked either: it keeps the
     painted wall with its painted windows, in the measured colour.  The rest is de-hazed (dark-object subtraction per
     photo atlas), its baked-in sun / shade levelled out (the game lights the wall again), graded to the painted palette
     (a little brighter and more saturated than the hazy aerial) and sharpened.
  3. Pack.  The walls of each 256 m cell of the building view go into one atlas (WebP), so a cell's façades are one draw
     call and can be streamed in and out with the car.

Output: pb/lux-drive/data/roofs/index.json + r_<cx>_<cz>_<page>.webp (the game streams them: roof-view.js).
With --walls the walls go into the same packs (index "walls" rows, "wallPaint" colours) and the default output dir is data/facades.
"""
import argparse
import json
import math
import os
import sys
import time
from collections import OrderedDict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
import shapely

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from buildings_io import decode_buildings  # noqa: E402
from common import OUT_DIR  # noqa: E402
from facade_area import BOX, TEX_DIR, WORK  # noqa: E402

CELL = 256                 # m, the cell of the building view (building-mesh.js CELL): one atlas per cell
PPM_SAMPLE = 8.0           # px / m: the rectified sampling (the ACT walls carry ~8 px / m), downsampled to --ppm after
BAND = 3.4                 # m: the painted ground floor (the shop band of building-material.js) - never baked
PARTY_PROBE = 0.8          # m: how far outside a wall the party-wall probe looks for the neighbour
MIN_EDGE = 1.5             # m: shorter game walls stay painted (not worth an atlas slot)
MIN_DEPTH = 1.5            # m: a wall with less than this above the band stays painted
FACE_DOT = 0.3             # an ACT wall is seen on a game wall when its normal and the wall's agree at least this much
ROOF_DOT = 0.75            # an ACT roof only when it is steep (> ~49 deg: the mansards); a flatter roof photo seen side-on is a smear
DEPTH_NEAR, DEPTH_FAR = -2.5, 14.0   # m behind the game wall (+ = into the house) an ACT surface may stand and still be drawn
MATCH_SHARE = 0.3          # an ACT building belongs to a game footprint when this share of either one overlaps the other
# the checks of a wall (tuned on the contact sheet): what is not good enough stays painted
MIN_COVER = 0.72           # share of the wall the ACT polygons cover
MIN_DETAIL = 0.020         # mean |laplacian| of the luminance (0..1) at PPM_SAMPLE: below = smudged / blurred
MAX_ABOVE = 0.5            # a wall that is mostly roof zone (the game wall far over the real eave) stays painted
MAX_GREEN = 0.18           # share of tree-green pixels: a tree in front of the wall
MIN_SRC_PPM = 3.0          # px / m of the photo: below = a wall seen almost edge-on, smeared
# what the oblique cameras could not see: a wall point is hidden behind the houses across the street when the line from it
# up towards the camera (OBLIQUE_TAN = tan of its elevation; the ACT obliques are ~45 deg) meets their walls
OBLIQUE_TAN = 1.2          # tuned on the dumps (raw_*.png in WORK/bake/dump): 1.0 cut clean storeys, 1.4 kept smears
OCC_START, OCC_STEP, OCC_REACH = 2.5, 0.75, 45.0   # m: the march of that line away from the wall (from OCC_START: the neighbour whose LOD2 foot pokes past the simplified game wall is no obstacle)
DSM_STEP, DSM_MARGIN = 0.5, 60.0   # m: the roof raster of the occlusion test
OCC_MARGIN = 1.0           # m over the computed line: the photo smears a little above it (the roof edge across, the camera angle)
OCC_PCT = 75               # the occlusion line of a wall: this percentile over its columns
STOREY = (2.8, 4.6)        # m: plausible storey heights (the repeat of the lowest clean storey down the hidden part)
STOREY_DEFAULT = 3.5
MIN_VISIBLE = 0.10         # share of a wall (top to the painted band) that must be really seen, else it stays painted
# the grade: the hazy aerial photo towards the painted world (building-style.js: light render, L ~ 0.85)
HAZE_K = 0.9               # share of the darkest-pixel level taken as haze
TARGET_L = 0.80            # luminance the lit wall colour of a building is brought to
GAIN_RANGE = (0.9, 1.9)
LEVEL_RANGE = (0.7, 1.7)   # how much one wall's baked-in light may be levelled to its building's
SATURATION = 1.15
MAX_TOTAL_GAIN = 2.2       # level x gain: more amplifies the photo's noise into colour
CHROMA_KEEP = 0.4          # share of the photo's own colour on a lit wall (the rest: the building's measured colour)
CHROMA_KEEP_SHADE = 0.15   # ... on a wall that was in the shade (levelled by more than SHADE_LEVEL)
SHADE_LEVEL = 1.25
PALETTE_REF = (0.89, 0.83, 0.70)   # the mean of CITY_WALLS (building-style.js): the hue the median house is balanced to
WB_RANGE = (0.8, 1.3)
ROOF_GAIN = 0.9            # the roofs from above came out pale (light flat roofs and the haze in the median): a little darker
ROOF_MARGIN = 1.0          # m around the game footprint in a roof photo (the eave of the game roof is the footprint)
MIN_ROOF_COVER = 0.8       # share of the roof photo box the ACT roofs (or the outside of the footprint) cover, else the measured colour
PAD = 4                    # px of edge-extended border around every wall in the atlas (no bleeding into mipmaps)
ATLAS_W = 2048
ATLAS_MAX_H = 2048
IMG_CACHE = 28

_images = OrderedDict()
_sizes = {}


def image_size(name):
    """(height, width) of a photo atlas from its header (no decode)."""
    if name not in _sizes:
        path = os.path.join(TEX_DIR, name)
        if not os.path.exists(path):
            raise FileNotFoundError(f"bake_facades: texture {name} missing in {TEX_DIR} (run facade_fetch.py)")
        with Image.open(path) as im:
            _sizes[name] = (im.size[1], im.size[0])
    return _sizes[name]


def dehaze(a):
    """Dark-object subtraction: the oblique photos are taken through ~1 km of air, which lifts the blacks with a bluish veil.
    The 1st percentile of each channel over the non-empty atlas pixels is that veil; it is removed."""
    px = a.reshape(-1, 3)
    px = px[px.sum(1) > 15]
    if len(px) < 500:
        return a
    veil = np.percentile(px, 1, axis=0) * HAZE_K
    return np.clip((a.astype(np.float32) - veil) / (255.0 - veil), 0.0, 1.0)


def image(name):
    if name in _images:
        _images.move_to_end(name)
        return _images[name]
    path = os.path.join(TEX_DIR, name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"bake_facades: texture {name} missing in {TEX_DIR} (run facade_fetch.py)")
    a = dehaze(np.asarray(Image.open(path).convert("RGB")))
    _images[name] = (a * 255.0 + 0.5).astype(np.uint8) if a.dtype != np.uint8 else a       # uint8: 28 atlases fit in ~350 MB
    if len(_images) > IMG_CACHE:
        _images.popitem(last=False)
    return _images[name]


def lum(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


# ---- the ACT polygons ---------------------------------------------------------------------------------------------

def newell(pts):
    n = np.zeros(3)
    for a, b in zip(pts, np.roll(pts, -1, axis=0)):
        n += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
    ln = np.linalg.norm(n)
    return n / ln if ln > 1e-9 else None


def fit_homography(src, dst):
    """DLT with Hartley normalisation: dst ~ H src.  None when the corners do not pin a homography down."""
    def norm(p):
        c = p.mean(0)
        s = math.sqrt(2) / max(np.sqrt(((p - c) ** 2).sum(1)).mean(), 1e-9)
        return np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1]])
    ts, td = norm(src), norm(dst)
    sh = (ts @ np.c_[src, np.ones(len(src))].T).T
    dh = (td @ np.c_[dst, np.ones(len(dst))].T).T
    rows = []
    for (x, y, _), (u, v, _) in zip(sh, dh):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    _u, s, vt = np.linalg.svd(np.array(rows))
    if s[-2] < 1e-6:
        return None
    h = np.linalg.inv(td) @ vt[-1].reshape(3, 3) @ ts
    return h / h[2, 2] if abs(h[2, 2]) > 1e-12 else None


def apply_h(h, p):
    q = np.c_[p, np.ones(len(p))] @ h.T
    return q[:, :2] / q[:, 2:3]


class ActPoly:
    """One textured ACT polygon: its plane, and the map from a 3D point on it to the photo pixel."""

    def __init__(self, kind, pts, tex):
        p = np.asarray(pts, dtype=np.float64)
        if len(p) > 3 and np.allclose(p[0], p[-1]):
            p = p[:-1]
        self.kind, self.pts = kind, p
        self.n = newell(p)
        self.ok = self.n is not None and len(p) >= 3 and tex is not None
        if not self.ok:
            return
        self.c = p.mean(0)
        e1 = p[1] - p[0]
        e1 = e1 - self.n * (e1 @ self.n)
        if np.linalg.norm(e1) < 1e-6:
            self.ok = False
            return
        self.e1 = e1 / np.linalg.norm(e1)
        self.e2 = np.cross(self.n, self.e1)
        self.img = tex[0]
        hgt, wid = image_size(self.img)
        uv = np.asarray(tex[1], dtype=np.float64).reshape(-1, 2)[:len(p)]
        if len(uv) < len(p):
            self.ok = False
            return
        q = np.c_[(p - self.c) @ self.e1, (p - self.c) @ self.e2]
        px = np.c_[uv[:, 0] * wid, (1.0 - uv[:, 1]) * hgt]
        self.h = None
        if len(p) >= 4:
            h = fit_homography(q, px)
            if h is not None and np.abs(apply_h(h, q) - px).max() < 2.0:
                self.h = h
        if self.h is None:
            coef, *_ = np.linalg.lstsq(np.c_[q, np.ones(len(q))], px, rcond=None)
            self.h = np.vstack([coef.T, [0, 0, 1]])
        # the photo's resolution on this polygon (px per metre)
        area_m = Polygon(q).area
        area_px = Polygon(px).area if len(px) >= 3 else 0.0
        self.src_ppm = math.sqrt(area_px / area_m) if area_m > 0.05 and area_px > 0 else 0.0

    def to_pixel(self, xyz):
        d = xyz - self.c
        return apply_h(self.h, np.c_[d @ self.e1, d @ self.e2])


def sample(img, px):
    """Bilinear sample of the photo at pixel positions (k, 2) -> (k, 3)."""
    hgt, wid = img.shape[:2]
    x = np.clip(px[:, 0] - 0.5, 0, wid - 1.001)
    y = np.clip(px[:, 1] - 0.5, 0, hgt - 1.001)
    x0, y0 = x.astype(int), y.astype(int)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    a, b = img[y0, x0], img[y0, x0 + 1]
    c, d = img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 255.0


def act_buildings(area):
    """ACT buildings -> (footprint polygon, textured polys, top of the walls, ground)."""
    out = []
    for b in area["buildings"]:
        polys, ground_rings, wall_y, ground_y = [], [], [], []
        for s in b["surfaces"]:
            ys = [p[1] for p in s["pts"]]
            if s["t"] == "ground":
                ground_rings.append(Polygon([(p[0], p[2]) for p in s["pts"]]).buffer(0))
                ground_y += ys
                continue
            if s["t"] == "wall":
                wall_y += ys
            p = ActPoly(s["t"], s["pts"], area["tex"].get(s["pid"]))
            if p.ok:
                polys.append(p)
        if not wall_y:
            continue
        foot = unary_union(ground_rings) if ground_rings else None
        if foot is None or foot.is_empty or foot.area < 1.0:
            low = min(wall_y)
            pts = [(p[0], p[2]) for s in b["surfaces"] if s["t"] == "wall" for p in s["pts"] if p[1] < low + 0.5]
            foot = MultiPoint(pts).convex_hull if len(pts) >= 3 else None
        if foot is None or foot.is_empty or foot.area < 1.0:
            continue
        out.append({"id": b["id"], "foot": foot, "polys": polys, "top": max(wall_y),
                    "ground": min(ground_y) if ground_y else min(wall_y)})
    return out


# ---- one game wall ------------------------------------------------------------------------------------------------

def render_wall(ax, az, bx, bz, nrm, top, polys):
    """The ACT polygons seen on the game wall a->b (outward normal nrm), from the top of the wall down to DEPTH_FAR
    below it: (rgb, covered mask, per-pixel source ppm, lowest wall point per column), sampled at PPM_SAMPLE."""
    length = math.hypot(bx - ax, bz - az)
    ex, ez = (bx - ax) / length, (bz - az) / length
    n3 = np.array([nrm[0], 0.0, nrm[1]])
    a3 = np.array([ax, 0.0, az])
    seen = [p for p in polys if p.n @ n3 > (FACE_DOT if p.kind == "wall" else ROOF_DOT)]
    if not seen:
        return None
    bottom = min(p.pts[:, 1].min() for p in seen)
    wid = int(math.ceil(length * PPM_SAMPLE))
    hgt = int(math.ceil((top - bottom) * PPM_SAMPLE))
    if wid < 4 or hgt < 4:
        return None
    rgb = np.zeros((hgt, wid, 3), np.float32)
    zbuf = np.full((hgt, wid), np.inf, np.float32)
    src = np.zeros((hgt, wid), np.float32)
    is_wall = np.zeros((hgt, wid), bool)
    for p in seen:
        s = (p.pts[:, 0] - ax) * ex + (p.pts[:, 2] - az) * ez
        depth = (a3 - p.pts) @ n3
        if s.max() < 0 or s.min() > length or depth.max() < DEPTH_NEAR or depth.min() > DEPTH_FAR:
            continue
        cols, rows = s * PPM_SAMPLE, (top - p.pts[:, 1]) * PPM_SAMPLE
        c0, c1 = max(0, int(cols.min())), min(wid, int(math.ceil(cols.max())) + 1)
        r0, r1 = max(0, int(rows.min())), min(hgt, int(math.ceil(rows.max())) + 1)
        if c1 <= c0 or r1 <= r0:
            continue
        m = Image.new("L", (c1 - c0, r1 - r0), 0)
        ImageDraw.Draw(m).polygon([(c - c0, r - r0) for c, r in zip(cols, rows)], fill=255)
        rr, cc = np.nonzero(np.asarray(m) > 0)
        if not len(rr):
            continue
        rr, cc = rr + r0, cc + c0
        sx = (cc + 0.5) / PPM_SAMPLE
        hy = top - (rr + 0.5) / PPM_SAMPLE
        x = np.c_[ax + sx * ex, hy, az + sx * ez]
        t = ((x - p.c) @ p.n) / (n3 @ p.n)              # how far the ray goes into the house before it meets the plane
        keep = (t >= DEPTH_NEAR) & (t <= DEPTH_FAR) & (t < zbuf[rr, cc])
        if not keep.any():
            continue
        rr, cc, x, t = rr[keep], cc[keep], x[keep], t[keep]
        y = x - t[:, None] * n3
        rgb[rr, cc] = sample(image(p.img), p.to_pixel(y))
        zbuf[rr, cc] = t
        src[rr, cc] = p.src_ppm
        is_wall[rr, cc] = p.kind == "wall"
    covered = np.isfinite(zbuf)
    if covered.sum() < 50:
        return None
    # above the highest surface of a column the real house has its roof (the game wall stands up to the highest wall
    # point of the building, a gable or a fire wall): that part is painted as the roof seen side-on, it is not a hole
    first = np.where(covered.any(0), covered.argmax(0), hgt)
    above = np.arange(hgt)[:, None] < first[None, :]
    # the real ground at this wall: the lowest wall pixel of every column (median over the columns)
    low = [top - (np.nonzero(is_wall[:, c])[0].max() + 1) / PPM_SAMPLE for c in range(wid) if is_wall[:, c].any()]
    ground = float(np.median(low)) if low else bottom
    return rgb, covered, src, ground, above


def hidden_wall(ax, az, bx, bz, nrm, foot, feet, tree):
    """A party wall: just outside it stands another game house (the probes PARTY_PROBE m out, at 3 points of the wall)."""
    hits = 0
    for t in (0.2, 0.5, 0.8):
        p = Point(ax + (bx - ax) * t + nrm[0] * PARTY_PROBE, az + (bz - az) * t + nrm[1] * PARTY_PROBE)
        if any(feet[k].contains(p) and not feet[k].equals(foot) for k in tree.query(p)):
            hits += 1
    return hits >= 2


class Dsm:
    """The roofs of every ACT building of the area as a height raster (m a.s.l., DSM_STEP grid): what stands in the line of
    sight of an oblique camera.  (The highest wall point of a whole block was too coarse: one tower at the back of a
    block 'hid' every street front around it.)"""

    def __init__(self, area):
        x0, x1, z0, z1 = BOX
        self.x0, self.z0 = x0 - DSM_MARGIN, z0 - DSM_MARGIN
        self.nx = int((x1 - x0 + 2 * DSM_MARGIN) / DSM_STEP) + 1
        self.nz = int((z1 - z0 + 2 * DSM_MARGIN) / DSM_STEP) + 1
        self.h = np.full((self.nz, self.nx), -np.inf, np.float32)
        for b in area["buildings"]:
            for srf in b["surfaces"]:
                if srf["t"] != "roof":
                    continue
                p = np.asarray(srf["pts"], dtype=np.float64)
                n = newell(p)
                if n is None or abs(n[1]) < 0.05:
                    continue
                cols, rows = (p[:, 0] - self.x0) / DSM_STEP, (p[:, 2] - self.z0) / DSM_STEP
                c0, c1 = max(0, int(cols.min())), min(self.nx, int(math.ceil(cols.max())) + 1)
                r0, r1 = max(0, int(rows.min())), min(self.nz, int(math.ceil(rows.max())) + 1)
                if c1 <= c0 or r1 <= r0:
                    continue
                m = Image.new("L", (c1 - c0, r1 - r0), 0)
                ImageDraw.Draw(m).polygon([(c - c0, r - r0) for c, r in zip(cols, rows)], fill=255, outline=255)
                rr, cc = np.nonzero(np.asarray(m) > 0)
                x, z = self.x0 + (cc + c0 + 0.5) * DSM_STEP, self.z0 + (rr + r0 + 0.5) * DSM_STEP
                y = p[0, 1] - (n[0] * (x - p[0, 0]) + n[2] * (z - p[0, 2])) / n[1]      # the roof plane
                y = np.clip(y, p[:, 1].min(), p[:, 1].max())
                cur = self.h[rr + r0, cc + c0]
                self.h[rr + r0, cc + c0] = np.maximum(cur, y)

    def at(self, x, z):
        c = ((x - self.x0) / DSM_STEP).astype(int)
        r = ((z - self.z0) / DSM_STEP).astype(int)
        ok = (c >= 0) & (c < self.nx) & (r >= 0) & (r < self.nz)
        out = np.full(x.shape, -np.inf, np.float32)
        out[ok] = self.h[r[ok], c[ok]]
        return out


def occlusion_line(ax, az, bx, bz, nrm, dsm, tan=None):
    """Per metre along the wall: the height (m a.s.l.) below which the obliques saw the roofs across, not this wall."""
    length = math.hypot(bx - ax, bz - az)
    ns = max(2, int(length) + 1)
    s = np.linspace(0.25, length - 0.25, ns) / length
    d = np.arange(OCC_START, OCC_REACH, OCC_STEP)
    px = (ax + (bx - ax) * s)[:, None] + nrm[0] * d[None, :]
    pz = (az + (bz - az) * s)[:, None] + nrm[1] * d[None, :]
    line = (dsm.at(px, pz) - d[None, :] * (tan or OBLIQUE_TAN)).max(1)
    return np.linspace(0.0, length, ns), line


def debug_occlusion(rgb, top, rows, wall, name):
    """The raw rectified wall with the occlusion line for a few camera elevations (tuning OBLIQUE_TAN)."""
    img = Image.fromarray((np.clip(rgb[:rows], 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for tan, colr in ((0.7, (0, 255, 0)), (1.0, (255, 0, 0)), (1.4, (255, 255, 0)), (2.0, (0, 255, 255))):
        s, line = occlusion_line(*wall, tan=tan)
        pts = [(sv * PPM_SAMPLE, (top - (h + OCC_MARGIN)) * PPM_SAMPLE) for sv, h in zip(s, line) if np.isfinite(h)]
        if len(pts) > 1:
            d.line(pts, fill=colr, width=2)
    os.makedirs(os.path.join(WORK, "bake", "dump"), exist_ok=True)
    img.save(os.path.join(WORK, "bake", "dump", f"raw_{name}.png"))


def storey_height(rgb, rows):
    """The storey of a façade from the rhythm of its window rows (autocorrelation of the dark share per row)."""
    lu = lum(rgb[:rows])
    if rows < STOREY[1] * PPM_SAMPLE * 1.6:
        return STOREY_DEFAULT
    dark = (lu < np.median(lu) * 0.75).mean(1)
    p = dark - dark.mean()
    if p.std() < 1e-3:
        return STOREY_DEFAULT
    ac = np.correlate(p, p, "full")[len(p) - 1:]
    ac = ac / ac[0]
    i0, i1 = int(STOREY[0] * PPM_SAMPLE), min(int(STOREY[1] * PPM_SAMPLE), len(ac) - 1)
    k = i0 + int(np.argmax(ac[i0:i1]))
    trough = float(ac[int(STOREY[0] * PPM_SAMPLE * 0.4):k].min()) if k > int(STOREY[0] * PPM_SAMPLE * 0.4) else ac[k]
    return k / PPM_SAMPLE if ac[k] - trough > 0.15 and k not in (i0, i1 - 1) else STOREY_DEFAULT


def repeat_storeys(rgb, covered, start, storey_px):
    """The hidden rows from `start` down: the storey just above them, repeated (a façade's floors are alike); a soft seam."""
    out, cov = rgb.copy(), covered.copy()
    src0 = start - storey_px
    for r in range(start, rgb.shape[0]):
        k = src0 + (r - start) % storey_px
        out[r], cov[r] = rgb[k], covered[k]
    return out, cov


def checks(rgb, covered, src, above):
    """The numbers of a wall: cover (the roof zone above the highest surface counts as covered), detail, green,
    source ppm, bright colour, share of roof zone."""
    cov = float((covered | above).mean())
    lu = lum(rgb)
    lap = np.abs(ndimage.laplace(ndimage.gaussian_filter(lu, 0.7)))
    inner = ndimage.binary_erosion(covered, iterations=2)
    detail = float(lap[inner].mean()) if inner.sum() > 30 else 0.0
    px = rgb[covered]
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    green = float(((g > r + 0.03) & (g > b + 0.01) & (px.max(1) - px.min(1) > 0.06)).mean()) if len(px) else 1.0
    srcppm = float(np.median(src[covered])) if covered.any() else 0.0
    v = lu[covered]
    bright = v >= np.percentile(v, 45) if len(v) else v
    col = np.median(px[bright], axis=0) if len(v) else np.zeros(3)
    return {"cover": cov, "above": float(above.mean()), "detail": detail, "green": green, "src": srcppm, "col": col, "lum": float(np.median(v)) if len(v) else 0.0}


def fill_holes(rgb, covered):
    if covered.all():
        return rgb
    _d, (iy, ix) = ndimage.distance_transform_edt(~covered, return_indices=True)
    out = rgb[iy, ix]
    soft = np.stack([ndimage.gaussian_filter(out[..., k], 3) for k in range(3)], -1)
    return np.where(covered[..., None], rgb, soft)


def roof_zone(rgb, above, roof):
    """The roof seen side-on over the real eave: slate rows in the roof's own colour, a dark line at the eave."""
    hgt = rgb.shape[0]
    rows = np.arange(hgt)[:, None]
    course = 0.9 + 0.1 * ((rows // 2) % 2)                       # the courses of slate (~0.25 m at PPM_SAMPLE)
    tile = np.broadcast_to(np.asarray(roof)[None, None, :] * course[..., None], rgb.shape)
    out = np.where(above[..., None], tile, rgb)
    eave = above & ~np.vstack([above[1:], np.zeros((1, above.shape[1]), bool)])
    eave = eave | np.vstack([eave[1:], np.zeros((1, above.shape[1]), bool)])
    return np.where(eave[..., None], out * 0.55, out)


def roof_colour(polys):
    """The median colour of a house's roofs seen from above (None without textured roofs)."""
    px_all = []
    for p in polys:
        if p.kind != "roof" or p.n[1] <= 0.3:
            continue
        img = image(p.img)
        hgt, wid = img.shape[:2]
        px = apply_h(p.h, np.c_[(p.pts - p.c) @ p.e1, (p.pts - p.c) @ p.e2])
        m = Image.new("L", (wid // 8, hgt // 8), 0)
        ImageDraw.Draw(m).polygon(list(zip(np.clip(px[:, 0], 0, wid - 1) / 8, np.clip(px[:, 1], 0, hgt - 1) / 8)), fill=255)
        rr, cc = np.nonzero(np.asarray(m) > 0)
        px_all.append(img[rr * 8, cc * 8] / 255.0)
    if not px_all or sum(len(r) for r in px_all) <= 10:
        return None
    return np.median(np.concatenate(px_all), axis=0)


def roof_photo(pts, polys, ppm):
    """The ACT roofs of a house seen from straight above over the game footprint's box (the highest roof wins):
    (rgb, covered, cover share, x0, z0) - the game lays it on its own (hip) roof faces by x / z, so dormers, chimneys, the slate and the
    flat gravel roofs are the real ones even where the game's roof shape is simpler."""
    if not polys:
        return None
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    x0, z0 = min(xs) - ROOF_MARGIN, min(zs) - ROOF_MARGIN
    wid = int(math.ceil((max(xs) + ROOF_MARGIN - x0) * ppm))
    hgt = int(math.ceil((max(zs) + ROOF_MARGIN - z0) * ppm))
    if wid < 2 or hgt < 2 or wid > ATLAS_W - 2 * PAD:
        return None
    rgb = np.zeros((hgt, wid, 3), np.float32)
    zbuf = np.full((hgt, wid), -np.inf, np.float32)
    for p in polys:
        cols, rows = (p.pts[:, 0] - x0) * ppm, (p.pts[:, 2] - z0) * ppm
        c0, c1 = max(0, int(cols.min())), min(wid, int(math.ceil(cols.max())) + 1)
        r0, r1 = max(0, int(rows.min())), min(hgt, int(math.ceil(rows.max())) + 1)
        if c1 <= c0 or r1 <= r0:
            continue
        m = Image.new("L", (c1 - c0, r1 - r0), 0)
        ImageDraw.Draw(m).polygon([(c - c0, r - r0) for c, r in zip(cols, rows)], fill=255)
        rr, cc = np.nonzero(np.asarray(m) > 0)
        if not len(rr):
            continue
        rr, cc = rr + r0, cc + c0
        x, z = x0 + (cc + 0.5) / ppm, z0 + (rr + 0.5) / ppm
        y = p.pts[0, 1] - (p.n[0] * (x - p.pts[0, 0]) + p.n[2] * (z - p.pts[0, 2])) / p.n[1]
        keep = y > zbuf[rr, cc]
        if not keep.any():
            continue
        rr, cc, x, y, z = rr[keep], cc[keep], x[keep], y[keep], z[keep]
        rgb[rr, cc] = sample(image(p.img), p.to_pixel(np.c_[x, y, z]))
        zbuf[rr, cc] = y
    covered = np.isfinite(zbuf)
    foot = Image.new("L", (wid, hgt), 0)
    ImageDraw.Draw(foot).polygon([((px - x0) * ppm, (pz - z0) * ppm) for px, pz in pts], fill=255)
    inside = np.asarray(foot) > 0
    if inside.sum() < 4 or not covered.any():
        return None
    share = float((covered | ~inside).mean())     # outside the footprint nothing is drawn: it never counts as a hole
    return rgb, covered, share, x0, z0


def white_balance(cols):
    """Per-channel gains that bring the median house colour to the hue of the painted city palette (same luminance)."""
    med = np.median(np.asarray(cols), axis=0)
    ref = np.asarray(PALETTE_REF) * (lum(med) / lum(np.asarray(PALETTE_REF)))
    return np.clip(ref / np.maximum(med, 1e-3), *WB_RANGE)


def grade(rgb, level, gain, paint=None, keep=1.0):
    """Level the wall's baked light to its building, bring the building to the painted brightness, a little saturation.
    With `paint` (the building's graded colour), the photo's own colour is kept only by `keep`: the rest is the photo's
    luminance (the windows, frames, cornices) in the building's colour.  The chroma of an aerial photo is its weakest part -
    JPEG blocks, blue sky light in the shade, magenta fringes - and a north wall amplified 3x turned purple (BGL, r1)."""
    a = rgb * min(level * gain, MAX_TOTAL_GAIN)
    g = lum(a)[..., None]
    a = g + (a - g) * SATURATION
    if paint is not None and keep < 1.0:
        p = np.asarray(paint, dtype=np.float32)
        recol = p[None, None, :] * (g / max(lum(p), 1e-3))
        a = a * keep + recol * (1.0 - keep)
    return np.clip(a, 0.0, 1.0)


def finish(rgb, w_out, h_out):
    img = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).resize((w_out, h_out), Image.LANCZOS)
    return img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=85, threshold=2))


# ---- the atlas -----------------------------------------------------------------------------------------------------

def pack(items):
    """Shelf packing of (w, h) boxes (with PAD) into pages of ATLAS_W x <= ATLAS_MAX_H; -> [(page, x, y)], [page heights]."""
    order = sorted(range(len(items)), key=lambda i: -items[i][1])
    place = [None] * len(items)
    pages = [[0, 0, 0]]                   # x, y of the shelf, height of the shelf
    for i in order:
        w, h = items[i][0] + 2 * PAD, items[i][1] + 2 * PAD
        if w > ATLAS_W:
            raise ValueError(f"bake_facades: a wall of {w} px is wider than the atlas")
        pg = pages[-1]
        if pg[0] + w > ATLAS_W:
            pg[0], pg[1], pg[2] = 0, pg[1] + pg[2], 0
        if pg[1] + h > ATLAS_MAX_H:
            pages.append([0, 0, 0])
            pg = pages[-1]
        place[i] = (len(pages) - 1, pg[0] + PAD, pg[1] + PAD)
        pg[0] += w
        pg[2] = max(pg[2], h)
    heights = [int(math.ceil((p[1] + p[2]) / 64.0) * 64) for p in pages]
    return place, heights


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ppm", type=float, default=4.0)
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--roof-ppm", type=float, default=3.0, help="px / m of the roof photos seen from above (0 = measured colour only); 3: 4 was crisper but 2x the GPU memory, the source is ~5-8")
    ap.add_argument("--walls", action="store_true", help="also bake the façade textures (needs the façade runtime of commit 6965b107; default output dir data/facades)")
    ap.add_argument("--dry", action="store_true", help="measure only, write nothing to the game")
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--dump", default="", help="id/edge,...: write these walls' images (kept or not) to WORK/bake/dump")
    ap.add_argument("--sheet-box", default=None, help="x0,x1,z0,z1: only walls of buildings there go on the sheet")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    if args.out is None:
        args.out = os.path.join(OUT_DIR, "facades" if args.walls else "roofs")
    t0 = time.time()
    area = json.load(open(os.path.join(WORK, "act", "area.json")))
    acts = act_buildings(area)
    dsm = Dsm(area)
    tree = STRtree([a["foot"] for a in acts])
    games = decode_buildings()
    x0, x1, z0, z1 = BOX
    near_ids = [i for i, g in enumerate(games) if len(g["pts"]) >= 3 and
                x0 - 100 <= g["pts"][0][0] <= x1 + 100 and z0 - 100 <= g["pts"][0][1] <= z1 + 100]
    near_feet = [Polygon(games[i]["pts"]).buffer(0) for i in near_ids]
    game_tree = STRtree(near_feet)
    report = []                                    # every wall's numbers and verdict (WORK/bake/walls.json, for tuning)
    stats = {"buildings": 0, "matched": 0, "walls": 0, "seen": 0, "kept": 0, "fallback": {}}
    walls, paint, wall_paints, sheet, houses, roofs = [], {}, {}, [], [], []
    def cell_order(gid):
        p = games[gid]["pts"]
        return (math.floor(p[0][0] / 64), math.floor(p[0][1] / 64))
    for gid in sorted(range(len(games)), key=cell_order):          # nearby houses one after the other: their photos stay cached
        gb = games[gid]
        pts = gb["pts"]
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if not (x0 <= cx <= x1 and z0 <= cz <= z1) or len(pts) < 3:
            continue
        stats["buildings"] += 1
        foot = Polygon(pts).buffer(0)
        if foot.is_empty:
            continue
        mine, mine_ix, best = [], set(), (0.0, None)
        for k in tree.query(foot):
            a = acts[k]
            ov = a["foot"].intersection(foot).area
            if ov > MATCH_SHARE * min(a["foot"].area, foot.area):
                mine.append(a)
                mine_ix.add(int(k))
                if ov > best[0]:
                    best = (ov, a)
        if not mine:
            continue
        stats["matched"] += 1
        top = best[1]["top"]                        # the game wall's top (bake_buildings.py: the eave = the highest wall point)
        polys = [p for a in mine for p in a["polys"]]
        bwalls = []
        for i in range(len(pts)):
            (ax, az), (bx, bz) = pts[i], pts[(i + 1) % len(pts)]
            length = math.hypot(bx - ax, bz - az)
            if length < MIN_EDGE:
                continue
            stats["walls"] += 1
            nx, nz = -(bz - az) / length, (bx - ax) / length
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            sign = -1 if foot.contains(Point(mx + nx * 0.3, mz + nz * 0.3)) else 1   # the side away from the house
            nx, nz = nx * sign, nz * sign
            if hidden_wall(ax, az, bx, bz, (nx, nz), foot, near_feet, game_tree):
                stats["party"] = stats.get("party", 0) + 1
                report.append({"id": gid, "edge": i, "why": "party"})
                continue
            r = render_wall(ax, az, bx, bz, (nx, nz), top, polys)
            if r is None:
                report.append({"id": gid, "edge": i, "why": "unseen"})
                continue
            rgb, covered, src, ground, above = r
            depth = top - ground - BAND
            rows = int(depth * PPM_SAMPLE)
            if depth < MIN_DEPTH or rows < 4:
                report.append({"id": gid, "edge": i, "why": "low", "depth": round(depth, 2)})
                continue
            stats["seen"] += 1
            rgb, covered, src, above = rgb[:rows], covered[:rows], src[:rows], above[:rows]
            if f"{gid}/{i}" in args.dump.split(","):
                debug_occlusion(rgb, top, rows, (ax, az, bx, bz, (nx, nz), dsm), f"{gid}_{i}")
            # the part the cameras saw: above the occlusion line (the houses across the street hide the rest)
            _s, occ = occlusion_line(ax, az, bx, bz, (nx, nz), dsm)
            h_occ = float(np.percentile(occ, OCC_PCT)) + OCC_MARGIN if np.isfinite(occ).any() else -np.inf
            r_occ = int(np.clip((top - h_occ) * PPM_SAMPLE, 0, rows)) if np.isfinite(h_occ) else rows
            roof_rows = int(np.percentile(np.argmax(~above, axis=0), 75)) if above.any() else 0
            seen = (r_occ - roof_rows) / max(rows - roof_rows, 1)
            hidden_part = r_occ < rows
            storey_px = 0
            if hidden_part and seen >= MIN_VISIBLE:
                storey_px = int(round(storey_height(rgb[roof_rows:], r_occ - roof_rows) * PPM_SAMPLE))
                if r_occ - storey_px >= roof_rows:
                    rgb, covered = repeat_storeys(rgb, covered, r_occ, storey_px)
                else:
                    storey_px = -1
            c = checks(rgb[:max(r_occ, 8)], covered[:max(r_occ, 8)], src[:max(r_occ, 8)], above[:max(r_occ, 8)])
            c["seen"] = seen
            why = None
            if seen < MIN_VISIBLE or storey_px < 0:
                why = "hidden"
            elif c["cover"] < MIN_COVER:
                why = "cover"
            elif c["green"] > MAX_GREEN:
                why = "trees"
            elif c["src"] < MIN_SRC_PPM:
                why = "edge-on"
            elif c["above"] > MAX_ABOVE:
                why = "roof"
            elif c["detail"] < MIN_DETAIL:
                why = "smudged"
            report.append({"id": gid, "edge": i, "why": why, "depth": round(depth, 2), "len": round(length, 1),
                           **{k: round(float(v), 4) for k, v in c.items() if k != "col"}})
            bwalls.append({"edge": i, "len": length, "depth": depth, "rgb": rgb, "covered": covered, "above": above, "c": c, "why": why,
                           "sign": sign, "area": length * depth})
        if not bwalls:
            continue
        # the building's colour: its lit walls (the shaded ones only darken it)
        lit = sorted([w for w in bwalls if w["c"]["cover"] > 0.4], key=lambda w: -w["c"]["lum"])
        lit = lit[:max(1, (len(lit) + 1) // 2)] or bwalls[:1]
        wsum = sum(w["area"] for w in lit)
        houses.append({"gid": gid, "cx": cx, "cz": cz, "walls": bwalls, "roof": roof_colour(polys), "pts": pts,
                       "roof_polys": [p for p in polys if p.kind == "roof" and p.n[1] > 0.05],
                       "col": sum(w["c"]["col"] * w["area"] for w in lit) / wsum})
    # the white balance of the area: the haze of the aerial photos is blue; the median house is brought to the palette's
    wb = white_balance([h["col"] for h in houses])
    print(f"bake_facades: white balance {np.round(wb, 3).tolist()}")
    for h in houses:
        gid, col, roof_raw = h["gid"], h["col"] * wb, h["roof"]
        on_sheet = args.sheet and len(sheet) < 400 and (not args.sheet_box or in_box(h["cx"], h["cz"], args.sheet_box))
        gain = float(np.clip(TARGET_L / max(lum(col), 1e-3), *GAIN_RANGE))
        wall_paint = np.clip(grade(col[None, None, :], 1.0, gain)[0, 0], 0, 1)
        roof_paint = np.clip(roof_raw * wb * ROOF_GAIN, 0, 1) if roof_raw is not None else None
        if roof_paint is not None:
            paint[gid] = [round(float(v), 3) for v in roof_paint]
        if args.walls:
            wall_paints[gid] = [round(float(v), 3) for v in wall_paint]
        if args.roof_ppm > 0 and roof_paint is not None:
            r = roof_photo(h["pts"], h["roof_polys"], args.roof_ppm)
            if r is not None:
                rgb, covered, share, x0, z0 = r
                if share >= MIN_ROOF_COVER:
                    rgb = np.clip(fill_holes(rgb, covered) * wb * ROOF_GAIN, 0, 1)
                    img = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=2))
                    roofs.append({"id": gid, "img": img, "x0": round(x0, 2), "z0": round(z0, 2),
                                  "cell": f"{math.floor(h['cx'] / CELL)},{math.floor(h['cz'] / CELL)}"})
                    stats["roofs"] = stats.get("roofs", 0) + 1
        for w in h["walls"]:
            why = w["why"]
            if why:
                stats["fallback"][why] = stats["fallback"].get(why, 0) + 1
            else:
                stats["kept"] += 1
            level = float(np.clip(lum(col) / max(lum(w["c"]["col"] * wb), 1e-3), *LEVEL_RANGE))
            dump = f"{gid}/{w['edge']}" in args.dump.split(",")
            if (not why and args.walls) or on_sheet or dump:
                keep = CHROMA_KEEP_SHADE if level > SHADE_LEVEL else CHROMA_KEEP
                rgb = grade(fill_holes(w["rgb"], w["covered"]) * wb, level, gain, wall_paint, keep)
                if roof_paint is not None and w["above"].any():
                    rgb = roof_zone(rgb, w["above"], roof_paint)
                w_out = max(2, int(round(w["len"] * args.ppm)))
                h_out = max(2, int(round(w["depth"] * args.ppm)))
                img = finish(rgb, w_out, h_out)
                if on_sheet:
                    sheet.append((img, w, gid))
                if dump:
                    os.makedirs(os.path.join(WORK, "bake", "dump"), exist_ok=True)
                    img.resize((img.size[0] * 2, img.size[1] * 2), Image.NEAREST).save(
                        os.path.join(WORK, "bake", "dump", f"{gid}_{w['edge']}_{why or 'keep'}.png"))
                if not why and args.walls:
                    walls.append({"id": gid, "edge": w["edge"], "sign": w["sign"], "depth": round(w["depth"], 2), "img": img,
                                  "cell": f"{math.floor(h['cx'] / CELL)},{math.floor(h['cz'] / CELL)}"})
    print(f"bake_facades: {stats}  ({time.time() - t0:.0f} s)")
    os.makedirs(os.path.join(WORK, "bake"), exist_ok=True)
    with open(os.path.join(WORK, "bake", "walls.json"), "w") as f:
        json.dump(report, f)
    if args.sheet:
        contact_sheet(sheet, args.sheet)
    px_total = sum(w["img"].size[0] * w["img"].size[1] for w in walls)
    print(f"bake_facades: {len(walls)} walls baked at {args.ppm} px/m, {px_total / 1e6:.2f} Mpx")
    print(f"bake_facades: {len(roofs)} roofs at {args.roof_ppm} px/m, {sum(r['img'].size[0] * r['img'].size[1] for r in roofs) / 1e6:.2f} Mpx")
    write_packs(walls, roofs, paint, wall_paints, args)


def in_box(x, z, box):
    x0, x1, z0, z1 = (float(v) for v in box.split(","))
    return x0 <= x <= x1 and z0 <= z <= z1


def write_packs(walls, roofs, paint, wall_paints, args):
    out_dir = args.out if not args.dry else os.path.join(WORK, "bake", f"dry_{args.ppm:g}")
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.startswith(("f_", "r_")) and f.endswith(".webp"):
            os.remove(os.path.join(out_dir, f))
    cells = {}
    for w in walls:
        cells.setdefault(w["cell"], []).append(w)
    for r in roofs:
        cells.setdefault(r["cell"], []).append(r)
    packs, total_bytes, gpu_bytes = [], 0, 0
    for key, ws in sorted(cells.items()):
        place, heights = pack([w["img"].size for w in ws])
        pages = [Image.new("RGB", (ATLAS_W, h), (128, 128, 128)) for h in heights]
        rows, roof_rows = [], []
        for w, (pg, x, y) in zip(ws, place):
            img = w["img"]
            a = np.pad(np.asarray(img), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
            pages[pg].paste(Image.fromarray(a), (x - PAD, y - PAD))
            if "edge" in w:
                rows.append([w["id"], w["edge"], w["sign"], pg, x, y, img.size[0], img.size[1], w["depth"]])
            else:                                  # a roof photo: its pixel (0, 0) is the world point (x0, z0), rows run south
                roof_rows.append([w["id"], pg, x, y, img.size[0], img.size[1], w["x0"], w["z0"], args.roof_ppm])
        cx, cz = (int(v) for v in key.split(","))
        files = []
        for k, page in enumerate(pages):
            name = f"{'f' if args.walls else 'r'}_{cx}_{cz}_{k}.webp"
            page.save(os.path.join(out_dir, name), "WEBP", quality=args.quality, method=6)
            size = os.path.getsize(os.path.join(out_dir, name))
            total_bytes += size
            gpu_bytes += page.size[0] * page.size[1] * 4 * 4 // 3
            files.append({"file": name, "w": page.size[0], "h": page.size[1], "bytes": size})
        pack_row = {"key": key, "centre": [(cx + 0.5) * CELL, (cz + 0.5) * CELL], "pages": files, "roofs": roof_rows}
        if args.walls:
            pack_row["walls"] = rows
        packs.append(pack_row)
    # version 2: roofs only; "paint" = the measured colour of each roof (the painted roof under / far from the photo)
    index = {"version": 2, "roofPpm": args.roof_ppm, "box": BOX, "packs": packs,
             "paint": {str(k): v for k, v in sorted(paint.items())}}
    if args.walls:
        index.update({"ppm": args.ppm, "band": BAND, "wallPaint": {str(k): v for k, v in sorted(wall_paints.items())}})
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"bake_facades: {len(packs)} packs, {sum(len(p['pages']) for p in packs)} pages, "
          f"{total_bytes / 1e6:.2f} MB WebP, GPU (RGBA8 + mips, all packs) {gpu_bytes / 1e6:.1f} MB, "
          f"index {os.path.getsize(os.path.join(out_dir, 'index.json')) / 1e3:.0f} kB -> {out_dir}")


def contact_sheet(items, path):
    """Walls side by side with their numbers (green = baked, red = falls back to the painted wall)."""
    tiles = []
    for img, w, gid in items:
        t = img.copy()
        t.thumbnail((220, 160))
        tile = Image.new("RGB", (230, 200), (40, 40, 40))
        tile.paste(t, (5, 5))
        d = ImageDraw.Draw(tile)
        c = w["c"]
        d.text((5, 168), f"{gid}/{w['edge']} cov{c['cover']:.2f} det{c['detail']:.3f}", fill=(255, 255, 255))
        d.text((5, 183), f"grn{c['green']:.2f} src{c['src']:.1f} {w['why'] or 'KEEP'}", fill=(255, 120, 120) if w["why"] else (120, 255, 120))
        tiles.append(tile)
    cols = 8
    sheet = Image.new("RGB", (cols * 230, ((len(tiles) + cols - 1) // cols) * 200), (0, 0, 0))
    for k, t in enumerate(tiles):
        sheet.paste(t, ((k % cols) * 230, (k // cols) * 200))
    sheet.save(path)


if __name__ == "__main__":
    main()
