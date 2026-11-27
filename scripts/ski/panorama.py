#!/usr/bin/env python3
"""The printed piste map of a resort (the "Pistekaart" the game opens): a hand-painted-looking panorama, painted from the game's own
baked data only (no published piste map was looked at, traced or copied).

    nice -n 10 ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/panorama.py <rid> [<rid> ...] [--draft] [--data DIR] [--out DIR]
    then: python3 scripts/gamedata_manifest.py        node scripts/ski/pano-check.mjs

Run it after bake.py (it needs resort.json, far.bin, classes.bin, buildings.json, roads.json and uses the 5 m DEM cache for the fine
relief when it is there). It works for any resort: without an entry in CAMERAS the look direction is picked by score (how much of the
pistes faces the observer, nothing hidden behind a ridge, a page-like shape). It writes pb/ski/data/<rid>/panorama.webp (<= MAX_BYTES)
and the camera as resort.json "panorama" (bake.py keeps that key). Projection: pano_proj.py == pb/ski/pano.js.

How it is painted: one look-up buffer (world point, height, normal, land cover per pixel), then gouache: banded snow light with blue
shadows, rock and snow brush strokes dragged down the slope (line integral convolution), conifer dabs drawn back to front with the
piste aisles left free, little houses from the real footprints, valley roads, frozen lakes, glacier ice, haze into the distance, sky.
"""
import io
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pano_proj import Projection, S_MAX, S_MIN, hidden_by, load_far, load_resort  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
MAX_BYTES = 300 * 1024
PIXELS = 4.2e6                      # output pixels (decoded RGBA = 4 x)
SUPER = 1.35                        # painted this much larger, then scaled down
SKY = 0.05                         # of the map's height: sky above the highest point of the skyline
SEED = 11

# Per resort: az = look direction (degrees from north, clockwise), f0 / f1 = sine of the look-down angle at the front / back edge of
# the ski area, E = vertical exaggeration, pad = margins beyond the pistes (left, right, bottom) as a part of their extent.
DEFAULT = {"f0": 0.78, "f1": 0.56, "fi": 0.07, "lam": 2200.0, "K": 60000.0, "Kb": 14000.0, "E": 1.2}
CAMERAS = {
    "killy": {"az": 204},                                  # from above Les Brévières: Val d'Isère left, Tignes right, the Grande Motte behind
    "3vallees": {"az": 120, "f0": 0.74, "f1": 0.52},       # Courchevel left, Méribel in the middle, Val Thorens right
    "zermatt": {"az": 170, "f0": 0.72, "f1": 0.60},      # from above Täsch: the Matterhorn right, Cervinia behind the ridge
    "arlberg": {"az": 0, "f0": 0.76, "f1": 0.58},          # St. Anton in front, Lech and Warth behind, the Sonnenkopf left
    "kronplatz": {"az": 208},                              # from above Bruneck
    "davos": {"az": 15, "f0": 0.78, "f1": 0.6},            # from above Glaris looking north up the valley: Rinerhorn and Jakobshorn in front, Davos and the Parsenn in the middle, Klosters and Madrisa behind
    "soelden": {"az": 200},                                # from above the Windach valley looking north: Sölden bottom-left, Giggijoch / Gaislachkogl in the middle, the glaciers top-right
}


def log(*a):
    print(*a, flush=True)


def resample(p, step):
    d = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0], np.cumsum(d)])
    if s[-1] <= 0:
        return p[:1]
    q = np.linspace(0, s[-1], max(2, int(s[-1] / step) + 1))
    return np.stack([np.interp(q, s, p[:, 0]), np.interp(q, s, p[:, 1])], 1)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ camera
def network_points(resort, step=60.0):
    rows = [resample(np.array(n["p"], float).reshape(-1, 2), step) for n in resort["network"] if not n.get("a")]
    rows += [resample(np.array(lf["pts"], float).reshape(-1, 2), step) for lf in resort["lifts"]]
    return np.concatenate(rows)


def place_camera(cfg, az, pts, y):
    cam = dict(DEFAULT, **{k: v for k, v in cfg.items() if k in DEFAULT})
    cam.update(az=az, cx=0.0, cz=0.0, L=10000.0, y0=float(round(np.percentile(y, 10))))
    r, s = Projection(cam).rs(pts[:, 0], pts[:, 1])
    cx, cz = Projection(cam).world((r.min() + r.max()) / 2, s.min())
    cam.update(cx=round(float(cx), 1), cz=round(float(cz), 1), L=round(float(s.max() - s.min()), 1))
    return cam


def pick_camera(rid, resort, far):
    pts = network_points(resort)
    y = far(pts[:, 0], pts[:, 1])
    cfg = dict(CAMERAS.get(rid, {}), **({"az": float(os.environ["PANO_AZ"])} if os.environ.get("PANO_AZ") else {}))
    if "az" in cfg:
        return place_camera(cfg, cfg["az"], pts, y), pts, y
    gx = (far(pts[:, 0] + 40, pts[:, 1]) - far(pts[:, 0] - 40, pts[:, 1])) / 80
    gz = (far(pts[:, 0], pts[:, 1] + 40) - far(pts[:, 0], pts[:, 1] - 40)) / 80
    best = None
    for az in range(0, 360, 15):
        cam = place_camera(cfg, az, pts, y)
        pr = Projection(cam)
        u, v = pr.uv(pts[:, 0], pts[:, 1], y)
        vis = float((hidden_by(pr, far, pts[:, 0], pts[:, 1], y, step=60, reach=4000) <= 0).mean())
        a = math.radians(az)
        facing = float((gx * math.sin(a) - gz * math.cos(a)).mean())
        aspect = float((u.max() - u.min()) / (v.max() - v.min()))
        score = 4 * facing - 8 * (1 - vis) - 0.45 * abs(math.log(aspect / 1.4))
        if best is None or score > best[0]:
            best = (score, az, cam)
    log("%s: look direction picked by score: %d degrees" % (rid, best[1]))
    return best[2], pts, y


def frame_camera(cam, far, pts, y, resort):
    """The page: every piste and lift inside with a margin, the skyline and a strip of sky on top."""
    pr = Projection(cam)
    u, v = pr.uv(pts[:, 0], pts[:, 1], y)
    W, H = u.max() - u.min(), v.max() - v.min()
    u0, u1 = u.min() - 0.045 * W, u.max() + 0.045 * W
    vb = v.min() - 0.06 * H
    # the skyline over the page's width
    us = np.linspace(u0, u1, 160)
    top = np.full(us.shape, -1e9)
    for s in np.arange(0, S_MAX - 200, 100.0):
        x, z = pr.world(us / pr.R(s), s)
        top = np.maximum(top, pr.F(s) + pr.G(s) * (far(x, z) - cam["y0"]))
    vt = max(float(top.max()), float(v.max())) if top.max() < v.max() + 0.5 * H else v.max() + 0.5 * H
    vt = vt + SKY * (vt - vb)
    w_m, h_m = u1 - u0, vt - vb
    aspect = w_m / h_m
    if aspect < 1.12:                              # a page that is too tall: more land left and right
        grow = (1.12 * h_m - w_m) / 2
        u0, u1 = u0 - grow, u1 + grow
        w_m, aspect = u1 - u0, 1.12
    w = int(round(math.sqrt(PIXELS * aspect) / 4)) * 4
    k = w / w_m
    h = int(round(h_m * k))
    cam.update(u0=round(float(u0), 2), v1=round(float(vt), 2), k=round(float(k), 6))
    return w, h


# ------------------------------------------------------------------------------------------------ look-up buffer
def gbuffer(cam, far, w, h, scale):
    """Per pixel of the (scaled) page: depth s, side r, or NaN in the sky. Every column is marched front to back; the running maximum of
    the projected heights gives the first ground that covers each row."""
    pr = Projection(cam)
    W, H = int(round(w * scale)), int(round(h * scale))
    k = cam["k"] * scale
    s = np.concatenate([np.arange(-3500, cam["L"] + 3000, 14.0), np.arange(cam["L"] + 3000, S_MAX - 100, 40.0)])
    f, g, rr = pr.F(s), pr.G(s), pr.R(s)
    depth = np.full((H, W), np.nan, np.float32)
    rows = cam["v1"] - (np.arange(H) + 0.5) / k                          # v of each row, descending
    chunk = 64
    for c0 in range(0, W, chunk):
        cols = np.arange(c0, min(W, c0 + chunk))
        u = cam["u0"] + (cols + 0.5) / k
        r = u[:, None] / rr[None, :]
        x, z = pr.world(r, s[None, :])
        inside = (x > -far.margin) & (x < far.margin * 0 + (far.g.shape[1] - 1) * far.step - far.margin) & (z > -far.margin) & (z < (far.g.shape[0] - 1) * far.step - far.margin)
        v = f[None, :] + g[None, :] * (far(x, z) - cam["y0"])
        v = np.where(inside, v, -1e9)
        top = np.maximum.accumulate(v, axis=1)
        for i, col in enumerate(cols):
            t = top[i]
            idx = np.searchsorted(t, rows)                               # first step whose running max reaches the row
            ok = (idx < len(s)) & (idx > 0)
            j = np.clip(idx, 1, len(s) - 1)
            a, b = t[j - 1], t[j]
            q = np.where(b > a, (rows - a) / np.maximum(b - a, 1e-6), 1.0)
            q = np.where(a < -1e8, 1.0, np.clip(q, 0, 1))
            depth[ok, col] = (s[j - 1] + (s[j] - s[j - 1]) * q)[ok]
    u = cam["u0"] + (np.arange(W) + 0.5) / k
    sky = np.isnan(depth)
    dd = np.where(sky, 0, depth).astype(np.float64)
    r = u[None, :] / pr.R(dd)
    x, z = pr.world(r, dd)
    return dict(W=W, H=H, k=k, s=depth, r=r.astype(np.float32), x=x.astype(np.float32), z=z.astype(np.float32), sky=sky, pr=pr)


def detail_height(rid, resort, far, data_dir):
    """A height grid of the box at 10 m: the 5 m DEM cache of the bake when it is there, else the shipped tiles over the far grid."""
    W, D = resort["width"], resort["depth"]
    nx, nz = int(W / 10), int(D / 10)
    try:
        from common import Frame
        import bake
        frame = Frame(rid)
        frame.rid = rid
        if frame.width == W and frame.depth == D:
            m = bake.load_mosaic(rid, frame)
            return ndimage.uniform_filter(m, 2)[:nz * 2:2, :nx * 2:2].astype(np.float32)
    except (Exception, SystemExit) as error:                             # no cache on this machine: the shipped data does
        log("  no DEM cache (%s): shipped tiles + far grid" % str(error)[:80])
    from pano_proj import decode_grid
    jj, ii = np.mgrid[0:nz, 0:nx]
    g = far(ii * 10.0, jj * 10.0).astype(np.float32)
    for tx, tz, _ in resort["tiles"]["list"]:
        with open(os.path.join(data_dir, "t", "%d_%d.bin" % (tx, tz)), "rb") as fh:
            t = decode_grid(fh.read())
        g[tz * 128:tz * 128 + 128, tx * 128:tx * 128 + 128] = t[:256:2, :256:2]
    return g


def load_classes(data_dir, meta):
    """classes.bin: the run-length raster of bake.py rle() (u16 nx, u16 nz, then value + varint run)."""
    with open(os.path.join(data_dir, "classes.bin"), "rb") as fh:
        blob = fh.read()
    values, runs, i = [], [], 4
    while i < len(blob):
        values.append(blob[i])
        i += 1
        run = shift = 0
        while True:
            byte = blob[i]
            i += 1
            run |= (byte & 0x7F) << shift
            shift += 7
            if byte < 0x80:
                break
        runs.append(run)
    return np.repeat(np.array(values, np.uint8), runs).reshape(meta["nz"], meta["nx"])


# ------------------------------------------------------------------------------------------------ painting helpers
def lic(noise, vx, vy, length, steps):
    """Line integral convolution: the noise smeared along the vector field = brush strokes."""
    H, W = noise.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    acc = noise.copy()
    n = 1
    for sign in (1, -1):
        px, py = xx.copy(), yy.copy()
        for _ in range(steps):
            ix, iy = np.clip(px, 0, W - 1).astype(np.int32), np.clip(py, 0, H - 1).astype(np.int32)
            px += sign * vx[iy, ix] * length / steps
            py += sign * vy[iy, ix] * length / steps
            ix, iy = np.clip(px, 0, W - 1).astype(np.int32), np.clip(py, 0, H - 1).astype(np.int32)
            acc += noise[iy, ix]
            n += 1
    acc /= n
    acc -= acc.mean()
    return acc / (acc.std() + 1e-9)


def blurred_noise(rng, shape, sigma):
    n = ndimage.gaussian_filter(rng.standard_normal(shape).astype(np.float32), sigma)
    return (n - n.mean()) / (n.std() + 1e-9)


def mix(a, b, t):
    return a + (np.asarray(b, np.float32) - a) * t[..., None]


C = lambda *rgb: np.array(rgb, np.float32) / 255.0  # noqa: E731


def sample(grid, x, z, step, order=1):
    return ndimage.map_coordinates(grid, [z / step, x / step], order=order, mode="nearest")


def paint(rid, resort, far, cam, w, h, data_dir, classes, draft):
    scale = 0.5 if draft else SUPER
    t0 = time.time()
    G = gbuffer(cam, far, w, h, scale)
    log("  buffer %dx%d %.0f s" % (G["W"], G["H"], time.time() - t0))
    W, H, k, pr, sky = G["W"], G["H"], G["k"], G["pr"], G["sky"]
    x, z, s = G["x"], G["z"], np.where(sky, S_MAX, G["s"]).astype(np.float32)
    unit = k / 0.16                                                      # brush size: 1 at 0.16 px per metre (the Killy page at full size)
    rng = np.random.default_rng(SEED)
    bw, bd = resort["width"], resort["depth"]
    inbox = (x > 5) & (x < bw - 15) & (z > 5) & (z < bd - 15) & ~sky

    # ---- relief: normals from the 10 m grid in the box (a touch smoothed), from the far grid outside
    det = detail_height(rid, resort, far, data_dir)
    det = ndimage.gaussian_filter(det, 1.8)
    gz_d, gx_d = np.gradient(det, 10.0)
    fs = ndimage.gaussian_filter(far.g, 0.6)
    gz_f, gx_f = np.gradient(fs, far.step)
    fx, fz = (x + far.margin), (z + far.margin)
    nx_ = np.where(inbox, sample(gx_d, x, z, 10.0), sample(gx_f, fx, fz, far.step)).astype(np.float32)
    nz_ = np.where(inbox, sample(gz_d, x, z, 10.0), sample(gz_f, fx, fz, far.step)).astype(np.float32)
    hgt = sample(far.g, fx, fz, far.step).astype(np.float32)
    # slope in camera axes: right, away
    gr = nx_ * pr.ca + nz_ * pr.sa
    ga = nx_ * pr.sa - nz_ * pr.ca
    slope = np.degrees(np.arctan(np.hypot(gr, ga)))
    ex = 1.35
    n_len = np.sqrt(1 + (gr * ex) ** 2 + (ga * ex) ** 2)
    def lam(lr, lu, la):
        L = np.array([lr, lu, la], float)
        L /= np.linalg.norm(L)
        return np.clip((-gr * ex * L[0] + L[1] - ga * ex * L[2]) / n_len, 0, 1)
    light = 0.62 * lam(-0.66, 0.70, 0.06) + 0.38 * lam(-0.2, 0.9, -0.5)
    # valleys a little darker, ridges a little lighter (broad ambient occlusion)
    ao_f = np.clip((far.g - ndimage.gaussian_filter(far.g, 9)) / 220.0, -1, 1) * 0.6 + np.clip((far.g - ndimage.gaussian_filter(far.g, 3)) / 70.0, -1, 1) * 0.4
    ao = sample(ao_f.astype(np.float32), fx, fz, far.step)
    light = np.clip(light + 0.10 * ao, 0, 1)
    log("  relief %.0f s" % (time.time() - t0))

    # ---- brush strokes down the fall line (image space)
    ratio = (pr.G(s) / np.maximum(pr.R(s), 1e-3)).astype(np.float32)
    fl = np.hypot(gr, ga) + 1e-4
    dr, da = -gr / fl, -ga / fl                                          # downhill in (right, away)
    vx = dr
    vy = -(da * pr.f(s).astype(np.float32) - fl * ratio)                 # screen y down
    vl = np.hypot(vx, vy) + 1e-6
    vx, vy = (vx / vl).astype(np.float32), (vy / vl).astype(np.float32)
    base_noise = rng.standard_normal((H, W)).astype(np.float32)
    strokes = lic(ndimage.gaussian_filter(base_noise, 0.8 * max(unit, 0.5)), vx, vy, 13 * unit, 9)
    wide = lic(ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 2.2 * max(unit, 0.5)), vx, vy, 34 * unit, 11)
    log("  strokes %.0f s" % (time.time() - t0))

    # ---- snow: warm light, blue shade, a hint of gouache steps
    q = light + 0.022 * strokes + 0.022 * wide
    steps = 6.0
    band = np.round(q * steps) / steps
    q = q * 0.55 + band * 0.45
    hi, mid, lo, deep = C(255, 254, 250), C(232, 240, 250), C(188, 208, 236), C(142, 168, 214)
    t = np.clip((q - 0.22) / 0.66, 0, 1)
    col = np.where((t < 0.33)[..., None], mix(np.broadcast_to(deep, (H, W, 3)), lo, np.clip(t / 0.33, 0, 1)),
          np.where((t < 0.68)[..., None], mix(np.broadcast_to(lo, (H, W, 3)), mid, np.clip((t - 0.33) / 0.35, 0, 1)),
                   mix(np.broadcast_to(mid, (H, W, 3)), hi, np.clip((t - 0.68) / 0.24, 0, 1)))).astype(np.float32)

    # ---- land cover
    bits = resort["classes"]["bits"]
    ci = np.clip((x / 10).astype(np.int32), 0, classes.shape[1] - 1)
    cj = np.clip((z / 10).astype(np.int32), 0, classes.shape[0] - 1)
    def cover(name, blur=1.0, w_=1.0):
        g = ndimage.gaussian_filter(((classes & bits[name]) > 0).astype(np.float32), blur)
        return np.where(inbox, sample(g, x - 5, z - 5, 10.0), 0).astype(np.float32) * w_
    glacier = cover("glacier", 3)
    col = mix(col, col * C(222, 243, 252) + 0.02, np.clip(glacier, 0, 1) * 0.55)

    # rock: steep faces and mapped rock, painted in warm grey-brown strokes
    rk = smooth(37, 52, slope + 4.5 * wide + 3.0 * strokes)
    rk = np.maximum(rk, smooth(0.35, 0.9, np.maximum(cover("rock", 1.2), 0.75 * cover("scree", 1.2)) * smooth(26, 40, slope) + 0.12 * strokes) * 0.9)
    piste = cover("piste", 2.0)
    rk = rk * (1 - np.clip(piste * 1.6, 0, 1))
    rl = np.clip(light * 1.05 + 0.10 * strokes, 0, 1.1)
    rock = mix(np.broadcast_to(C(82, 80, 96), (H, W, 3)), C(196, 178, 160), np.clip(rl, 0, 1)).astype(np.float32)
    col = mix(col, rock, np.clip(rk, 0, 1) * 0.86)

    # ---- valley ground below the tree line, and the forest floor
    forest = cover("forest", 0.9)
    scrub = cover("scrub", 1.2)
    tree_line = float(np.percentile(hgt[inbox & (forest > 0.5)], 97)) if (inbox & (forest > 0.5)).any() else 2000.0
    out_f = np.where(inbox | sky, 0, smooth(tree_line + 60, tree_line - 120, hgt + 60 * wide) * smooth(46, 36, slope) * smooth(-0.6, 0.6, wide + 0.4)).astype(np.float32)
    floor = np.clip(forest * 1.15 + scrub * 0.35, 0, 1)
    fcol = mix(np.broadcast_to(C(52, 82, 86), (H, W, 3)), C(124, 152, 118), np.clip(light * 1.1 + 0.06 * strokes, 0, 1)).astype(np.float32)
    col = mix(col, fcol, floor * 0.82)
    # outside the box (no land cover there): a snow-dusted, pale forested valley instead of the dark green floor, which turned the brush
    # strokes of the steep slopes into green-grey fern streaks (Davos, 24 Nov 2026); no stroke term, a soft light-driven tint
    ocol = mix(np.broadcast_to(C(140, 168, 162), (H, W, 3)), C(222, 234, 232), np.clip(light * 1.1, 0, 1)).astype(np.float32)
    col = mix(col, ocol, out_f * 0.62)
    built = cover("built", 2.2)
    col = mix(col, C(236, 226, 210) * (0.75 + 0.3 * light[..., None]), np.clip(built, 0, 1) * 0.55)
    water = cover("water", 0.8)
    col = mix(col, mix(np.broadcast_to(C(158, 204, 222), (H, W, 3)), C(210, 234, 240), np.clip(0.5 + 0.35 * wide, 0, 1)), smooth(0.35, 0.65, water))
    # groomed corridors: the ski area a touch brighter and warmer, so the snow of the pistes reads through
    col = mix(col, C(255, 254, 250), np.clip(piste, 0, 1) * 0.35)

    # ---- distance: the land away from the pistes pales, the far mountains go blue
    pts = network_points(resort, 80)
    g40 = np.ones((int(bd / 40) + 1, int(bw / 40) + 1), bool)
    g40[np.clip((pts[:, 1] / 40).astype(int), 0, g40.shape[0] - 1), np.clip((pts[:, 0] / 40).astype(int), 0, g40.shape[1] - 1)] = False
    dist = ndimage.distance_transform_edt(g40).astype(np.float32) * 40
    away = np.where(inbox, sample(dist, x, z, 40.0), 4000)
    pale = smooth(900, 4200, away)
    col = mix(col, col * 0.62 + C(222, 232, 243) * 0.38, pale * 0.75)
    haze = np.clip((s - cam["L"] * 0.8) / (9000.0 + 0.5 * cam["L"]), 0, 1)
    haze = 1 - np.exp(-2.0 * haze)
    col = mix(col, C(196, 217, 240), haze * 0.80)

    # ---- sky: painted bands with soft clouds
    yy = (np.arange(H) / H)[:, None]
    sk = np.clip(yy / max(1e-3, 0.26), 0, 1)
    sc = mix(np.broadcast_to(C(92, 152, 214), (H, W, 3)), C(214, 231, 246), np.broadcast_to(sk ** 0.8, (H, W))).astype(np.float32)
    cl = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (7 * unit * 1.3, 46 * unit * 1.3))
    cl = (cl - cl.mean()) / (cl.std() + 1e-9)
    sc = mix(sc, C(255, 255, 255), smooth(0.5, 2.0, cl) * 0.6)
    col = np.where(sky[..., None], sc, col)
    # a thin light rim where land meets the sky or a nearer ridge stands before a further one (ink-less silhouettes read on print)
    jump = np.zeros((H, W), np.float32)
    jump[1:] = np.clip((s[:-1] - s[1:] - 160) / 500, 0, 1)
    rim = np.maximum(jump, np.roll(jump, 1, axis=0) * 0.6)
    col = mix(col, col * C(120, 138, 178) * 1.2, ndimage.gaussian_filter(np.clip(np.roll(jump, -1, axis=0), 0, 1), 0.7) * 0.55)
    col = mix(col, C(255, 255, 252), rim * 0.35 * (1 - np.clip(floor, 0, 1)))

    img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8), "RGB")
    log("  colours %.0f s" % (time.time() - t0))
    draw_roads(img, resort, far, cam, scale, data_dir, G)
    draw_things(img, resort, far, cam, scale, data_dir, classes, G, rng, unit, tree_line, dist)
    log("  trees and houses %.0f s" % (time.time() - t0))
    # paper grain, very light
    a = np.asarray(img, np.float32)
    a *= (1 + 0.010 * blurred_noise(rng, (H, W), 1.1))[..., None]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    return img.resize((w, h), Image.LANCZOS)


# ------------------------------------------------------------------------------------------------ vector things
def project(pr, far, cam, scale, x, z, lift=0.0):
    y = far(x, z)
    px, py = pr.px(x, z, y + lift)
    r, s = pr.rs(x, z)
    return px * scale, py * scale, s, y


def visible(G, px, py, s, tol=70.0):
    ix, iy = np.clip(px.astype(int), 0, G["W"] - 1), np.clip(py.astype(int), 0, G["H"] - 1)
    inside = (px >= 0) & (py >= 0) & (px < G["W"]) & (py < G["H"])
    d = G["s"][iy, ix]
    up = G["s"][np.clip(iy - 1, 0, G["H"] - 1), ix]
    with np.errstate(invalid="ignore"):
        return inside & (np.isnan(d) | (np.abs(d - s) < tol) | (np.abs(up - s) < tol))


def draw_roads(img, resort, far, cam, scale, data_dir, G):
    path = os.path.join(data_dir, "roads.json")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        j = json.load(fh)
    unit = j.get("unit", 0.5)
    d = ImageDraw.Draw(img)
    pr = G["pr"]
    for r in j["roads"]:
        hw = r[0] / 10
        if hw < 2.6:
            continue
        p = np.array(r[1:], float).reshape(-1, 2) * unit
        p = np.cumsum(p, axis=0)
        if len(p) < 2:
            continue
        p = resample(p, 25)
        px, py, s, _ = project(pr, far, cam, scale, p[:, 0], p[:, 1])
        vis = visible(G, px, py, s)
        w = max(1, int(round((1.0 if hw < 3.4 else 1.6) * scale)))
        for i in range(len(p) - 1):
            if vis[i] and vis[i + 1]:
                d.line([px[i], py[i], px[i + 1], py[i + 1]], fill=(172, 160, 150), width=w + 1)
        for i in range(len(p) - 1):
            if vis[i] and vis[i + 1]:
                d.line([px[i], py[i], px[i + 1], py[i + 1]], fill=(247, 240, 224), width=w)


def draw_things(img, resort, far, cam, scale, data_dir, classes, G, rng, unit, tree_line, dist):
    """Conifers and houses, sorted back to front."""
    d = ImageDraw.Draw(img)
    pr = G["pr"]
    bits = resort["classes"]["bits"]
    k = cam["k"] * scale
    items = []
    # trees: one per TREE_M square of forest (jittered), thinner in the scrub; bigger than life like on any printed map
    tree_m = max(20.0, 4.6 / k)
    nx, nz = int(resort["width"] / tree_m), int(resort["depth"] / tree_m)
    jj, ii = np.mgrid[0:nz, 0:nx]
    tx = (ii.ravel() + rng.random(ii.size)) * tree_m
    tz = (jj.ravel() + rng.random(ii.size)) * tree_m
    cj, ci = np.clip((tz / 10).astype(int), 0, classes.shape[0] - 1), np.clip((tx / 10).astype(int), 0, classes.shape[1] - 1)
    c = classes[cj, ci]
    r1 = rng.random(ii.size)
    aisle = np.ones(classes.shape, bool)
    aisle &= ndimage.distance_transform_edt((classes & bits["piste"]) == 0) > 2.0      # 20 m free along the groomed snow
    keep = (((c & bits["forest"]) > 0) & (r1 < 0.96)) | (((c & bits["scrub"]) > 0) & (r1 < 0.16))
    keep &= aisle[cj, ci] & ((c & (bits["water"] | bits["built"])) == 0)
    # and lone trees out in the painted far forest are left to the floor colour (haze)
    tx, tz = tx[keep], tz[keep]
    px, py, s, y = project(pr, far, cam, scale, tx, tz)
    vis = visible(G, px, py, s, 90)
    tx, tz, px, py, s, y = tx[vis], tz[vis], px[vis], py[vis], s[vis], y[vis]
    gx = (far(tx + 40, tz) - far(tx - 40, tz)) / 80
    gz = (far(tx, tz + 40) - far(tx, tz - 40)) / 80
    lit = np.clip(0.55 + 0.55 * (gx * pr.ca + gz * pr.sa), 0, 1)          # slopes that fall to the left are in the sun
    away = dist[np.clip((tz / 40).astype(int), 0, dist.shape[0] - 1), np.clip((tx / 40).astype(int), 0, dist.shape[1] - 1)]
    pale = smooth(900, 4200, away) * 0.5 + np.clip((s - cam["L"] * 0.8) / 14000, 0, 0.6)
    size = (6.6 * max(unit, 0.75) * (0.8 + 0.45 * rng.random(len(tx)))) * np.clip(pr.R(s), 0.5, 1.05)
    for i in range(len(tx)):
        items.append((s[i], 0, px[i], py[i], size[i], lit[i], pale[i], rng.random()))
    # houses
    bpath = os.path.join(data_dir, "buildings.json")
    if os.path.exists(bpath):
        with open(bpath, encoding="utf-8") as fh:
            rows = json.load(fh)
        b = np.array([[q[0], q[1], q[2], q[3], q[4], q[8]] for q in rows], float)
        if len(b):
            hx, hy, hs, _ = project(pr, far, cam, scale, b[:, 0], b[:, 1])
            hv = visible(G, hx, hy, hs, 90)
            for i in np.nonzero(hv)[0]:
                L = max(b[i, 2], b[i, 3])
                items.append((hs[i], 1, hx[i], hy[i], float(np.clip(L * k * 1.5, 3.6 * max(unit, 0.7), 13 * max(unit, 0.7))), 0.0, 0.0, (i * 0.6180339) % 1.0))
    items.sort(key=lambda it: -it[0])
    walls = [(224, 196, 160), (206, 168, 128), (238, 224, 200), (186, 142, 104)]
    for _, kind, X, Y, sz, lt, pl, rnd in items:
        if kind == 0:
            hh, hw = sz * 1.25, sz * 0.46
            dark = np.array([54, 90, 84]) * (0.92 + 0.2 * rnd)
            light = np.array([98, 140, 108]) * (0.80 + 0.34 * lt)
            if pl > 0:
                dark, light = dark + (np.array([176, 196, 214]) - dark) * pl, light + (np.array([206, 220, 230]) - light) * pl
            tip = (X, Y - hh)
            d.polygon([tip, (X + hw, Y), (X - hw * 0.1, Y)], fill=tuple(int(v) for v in dark))
            d.polygon([tip, (X, Y), (X - hw, Y)], fill=tuple(int(v) for v in light))
        else:
            w2, hh = sz * 0.5, sz * 0.55
            wall = walls[int(rnd * 4) % 4]
            sh = tuple(int(v * 0.72) for v in wall)
            d.polygon([(X - w2, Y), (X - w2, Y - hh * 0.7), (X + w2 * 0.25, Y - hh * 0.55), (X + w2 * 0.25, Y + hh * 0.12)], fill=wall)
            d.polygon([(X + w2 * 0.25, Y + hh * 0.12), (X + w2 * 0.25, Y - hh * 0.55), (X + w2, Y - hh * 0.7), (X + w2, Y)], fill=sh)
            d.polygon([(X - w2 * 1.12, Y - hh * 0.62), (X - w2 * 0.45, Y - hh * 1.35), (X + w2 * 0.6, Y - hh * 1.35), (X + w2 * 0.25, Y - hh * 0.48)], fill=(252, 252, 250))
            d.polygon([(X + w2 * 0.6, Y - hh * 1.35), (X + w2 * 1.12, Y - hh * 0.62), (X + w2 * 0.25, Y - hh * 0.48)], fill=(176, 124, 96) if rnd > 0.5 else (204, 212, 226))
    log("  %d trees and houses" % len(items))


def preview_lines(img, resort, far, cam):
    """--lines: the pistes and lifts drawn on top (to choose a camera; the game draws its own)."""
    d, pr = ImageDraw.Draw(img), Projection(cam)
    cols = {"g": (46, 160, 80), "b": (40, 96, 200), "r": (205, 45, 45), "k": (25, 25, 28)}
    for n in resort["network"]:
        if n.get("a"):
            continue
        p = resample(np.array(n["p"], float).reshape(-1, 2), 30)
        x, y, _, _ = project(pr, far, cam, 1.0, p[:, 0], p[:, 1])
        xy = list(zip(x.tolist(), y.tolist()))
        d.line(xy, fill=(255, 255, 255), width=8)
        d.line(xy, fill=cols.get(n["d"], (40, 96, 200)), width=5)
    for lf in resort["lifts"]:
        p = np.array(lf["pts"], float).reshape(-1, 2)
        x, y, _, _ = project(pr, far, cam, 1.0, p[[0, -1], 0], p[[0, -1], 1])
        d.line([x[0], y[0], x[1], y[1]], fill=(20, 20, 24), width=2)


# ------------------------------------------------------------------------------------------------ main
def save_webp(img, path):
    for q in range(84, 27, -3):
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            break
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    return buf.tell(), q


def main():
    args = sys.argv[1:]
    draft = "--draft" in args
    opt = lambda n: args[args.index(n) + 1] if n in args else None  # noqa: E731
    data_root, out_dir = opt("--data") or os.path.join(REPO, "pb", "ski", "data"), opt("--out")
    skip = {opt("--data"), opt("--out")}
    for rid in [a for a in args if not a.startswith("--") and a not in skip]:
        t0 = time.time()
        data_dir = os.path.join(data_root, rid)
        resort, far = load_resort(data_dir), load_far(data_dir)
        classes = load_classes(data_dir, resort["classes"])
        cam, pts, y = pick_camera(rid, resort, far)
        w, h = frame_camera(cam, far, pts, y, resort)
        log("%s: %d x %d, %.3f px/m, az %s" % (rid, w, h, cam["k"], cam["az"]))
        img = paint(rid, resort, far, cam, w, h, data_dir, classes, draft)
        if "--lines" in args:
            preview_lines(img, resort, far, cam)
        if draft or out_dir:
            path = os.path.join(out_dir or ".", "%s-pano.png" % rid)
            img.save(path)
            log("  ->", path)
        if draft:
            continue
        path = os.path.join(data_dir, "panorama.webp")
        size, q = save_webp(img, path)
        while size > MAX_BYTES:                          # a very wooded page: a little smaller until it fits
            w, h, cam["k"] = int(w * 0.95 / 4) * 4, int(round(int(w * 0.95 / 4) * 4 / w * h)), round(cam["k"] * (int(w * 0.95 / 4) * 4) / w, 6)
            img = img.resize((w, h), Image.LANCZOS)
            size, q = save_webp(img, path)
        rp = os.path.join(data_dir, "resort.json")
        with open(rp, encoding="utf-8") as fh:
            raw = json.load(fh)
        raw["panorama"] = {"file": "panorama.webp", "w": w, "h": h, "cam": cam}
        with open(rp, "w", encoding="utf-8") as fh:
            json.dump(raw, fh, ensure_ascii=False, separators=(",", ":"))
        log("  %s %.0f KB (quality %d), %.0f s" % (path, size / 1024, q, time.time() - t0))


if __name__ == "__main__":
    main()
