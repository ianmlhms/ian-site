"""Orthophoto clean-up under the big named Luxtram bridges (Pont Grande-Duchesse Charlotte / "Red Bridge", Pont Adolphe).

The national orthophoto is a true ortho: the bridge deck (carriageways, cycle path, parapets) is photographed where the deck is, 40-70 m above
the valley.  Draped on the terrain that image paints the deck's road lanes on the valley floor, and the real valley road / river / forest below
the deck is simply missing.  This module
  1. measures the deck footprint of every OSM bridge way called Charlotte / Adolphe from the LiDAR (rectangle along the way, lateral extent where
     the surface model stays at deck level),
  2. re-paints those pixels from the orthophoto on both sides of the deck (linear blend across the deck, a little darker = bridge shadow),
  3. draws the valley roads / paths that run under the deck (OSM, not on a bridge) on top.
The deck itself (road lanes, tram bed, kerbs) is meshed at deck height by luxtram-world.js (buildBridge / buildNamedDeck).

Used by build_luxtram_geo.py (tiles step, and the `deckortho` step that only re-writes the affected tiles).
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import luxtram_geo as G

NAMES = ("Charlotte", "Adolphe")
EDGE_MARGIN = 0.7          # m: the mask is the LiDAR deck footprint grown by this (parapet, shadow fringe)
MASK_H = 8.0              # m: only where the deck is well clear of the ground (near the abutments the ortho is the real road on the fill)
SHADE = 0.9                # valley under the deck is a little darker than the open ground beside it
MIN_H = 5.0                # m: surface model above the bare earth for a deck cell (the bridges are 20-70 m high)
# the CFL Pfaffenthal line (not in the OSM extract: measured on the orthophoto, N-S through the Red Bridge at local x = -2247)
EXTRA_LINES = [("rail", 3.4, [(-2247.0, -1560.0), (-2247.0, -1180.0)])]
PATH_CLASSES = ("footway", "path", "steps", "cycleway", "track", "pedestrian")
ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service")


def _unit(a, b):
    d = np.array(b, float) - np.array(a, float)
    ln = float(np.hypot(*d))
    return d / ln, ln


def find_decks(B, dsm, dtm):
    """Deck footprints: [{name, A, d, r, len, lat0, lat1}] in the local frame (lat measured to the right of A->B)."""
    decks = []
    seen = set()
    for el in B.load_many(B.RAW_DEFAULT, "road"):
        if el["type"] != "way" or el["id"] in seen or not el.get("geometry"):
            continue
        seen.add(el["id"])
        tg = el.get("tags", {})
        nm = tg.get("name") or ""
        if tg.get("bridge") not in ("yes", "viaduct") or not any(n in nm for n in NAMES):
            continue
        pts = [B.proj(p["lat"], p["lon"]) for p in el["geometry"]]
        for a, b in zip(pts[:-1], pts[1:]):
            d, ln = _unit(a, b)
            if ln < 30:
                continue
            r = np.array([-d[1], d[0]])
            # lateral extent of the deck: contiguous run around the way where the surface stays within 4 m of the deck level
            lats = np.arange(-45.0, 45.01, 0.5)
            ext = []
            for t in (0.3, 0.4, 0.5, 0.6, 0.7):
                p = np.array(a) + d * ln * t
                P = p[None, :] + lats[:, None] * r[None, :]
                h = dsm.at(P[:, 0], P[:, 1]) - dtm.at(P[:, 0], P[:, 1])
                i0 = int(np.argmin(np.abs(lats)))
                h0 = h[i0]
                if not np.isfinite(h0) or h0 < MIN_H:
                    continue
                ok = np.isfinite(h) & (np.abs(h - h0) < 4.0)
                lo = i0
                while lo > 0 and ok[lo - 1]:
                    lo -= 1
                hi = i0
                while hi < len(lats) - 1 and ok[hi + 1]:
                    hi += 1
                ext.append((lats[lo], lats[hi]))
            if not ext:
                continue
            lat0 = float(np.median([e[0] for e in ext]))
            lat1 = float(np.median([e[1] for e in ext]))
            decks.append({"name": nm, "id": el["id"], "A": np.array(a), "d": d, "r": r, "len": ln, "lat0": lat0, "lat1": lat1})
    return decks


class OrthoSrc:
    """The raw (un-painted) orthophoto tiles, sampled in world metres."""

    def __init__(self, meta):
        self.t = {}
        self.meta = meta

    def tile(self, i, j):
        k = (i, j)
        if k not in self.t:
            p = os.path.join(G.RAW_GEO, "ortho", "%d_%d.png" % (i, j))
            m = self.meta.get("%d_%d" % (i, j))
            self.t[k] = (np.asarray(Image.open(p).convert("RGB")), m["res"]) if os.path.exists(p) and m else None
        return self.t[k]

    def at(self, X, Z):
        X = np.asarray(X, float)
        out = np.zeros(X.shape + (3,), float)
        ok = np.zeros(X.shape, bool)
        fi = np.floor(X / G.TILE).astype(int)
        fj = np.floor(np.asarray(Z, float) / G.TILE).astype(int)
        for key in set(zip(fi.ravel().tolist(), fj.ravel().tolist())):
            tl = self.tile(*key)
            if tl is None:
                continue
            arr, res = tl
            m = (fi == key[0]) & (fj == key[1])
            cx = np.clip(((X[m] - (key[0] * G.TILE - res)) / res).astype(int), 0, arr.shape[1] - 1)
            cz = np.clip(((np.asarray(Z, float)[m] - (key[1] * G.TILE - res)) / res).astype(int), 0, arr.shape[0] - 1)
            out[m] = arr[cz, cx]
            ok[m] = True
        return out, ok


def _local_roads(B, decks):
    """OSM roads / paths (not on a bridge, not tunnels) that touch a deck footprint: [(cls, width, pts)]."""
    out = []
    seen = set()
    for el in B.load_many(B.RAW_DEFAULT, "road"):
        if el["type"] != "way" or el["id"] in seen or not el.get("geometry"):
            continue
        seen.add(el["id"])
        tg = el.get("tags", {})
        hw = tg.get("highway")
        if tg.get("bridge") or tg.get("tunnel") or hw not in ROAD_CLASSES + PATH_CLASSES:
            continue
        pts = [B.proj(p["lat"], p["lon"]) for p in el["geometry"]]
        P = np.array(pts)
        for dk in decks:
            al = (P - dk["A"]) @ dk["d"]
            lat = (P - dk["A"]) @ dk["r"]
            # any segment that crosses the rectangle
            hit = False
            for k in range(len(P) - 1):
                for u in np.linspace(0, 1, 9):
                    q = P[k] + (P[k + 1] - P[k]) * u
                    a_ = (q - dk["A"]) @ dk["d"]
                    l_ = (q - dk["A"]) @ dk["r"]
                    if 0 <= a_ <= dk["len"] and dk["lat0"] - 3 <= l_ <= dk["lat1"] + 3:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                cls = "path" if hw in PATH_CLASSES else "road"
                w = B.parse_height(tg.get("width")) or (2.0 if cls == "path" else B.ROAD_WIDTH.get(B.ROAD_CLASS.get(hw, 4), 5.4) * 0.9)
                out.append((cls, w, pts))
                break
    for cls, w, pts in EXTRA_LINES:
        P = np.array(pts)
        for dk in decks:
            if any(0 <= (q - dk["A"]) @ dk["d"] <= dk["len"] and dk["lat0"] - 3 <= (q - dk["A"]) @ dk["r"] <= dk["lat1"] + 3 for q in np.linspace(P[0], P[1], 200)):
                out.append((cls, w, pts))
                break
    return out


def deck_mask_world(dk, X, Z, dsm=None, dtm=None):
    """True where world points lie inside the (grown) deck footprint rectangle and the surface is at deck level."""
    al = (X - dk["A"][0]) * dk["d"][0] + (Z - dk["A"][1]) * dk["d"][1]
    lat = (X - dk["A"][0]) * dk["r"][0] + (Z - dk["A"][1]) * dk["r"][1]
    m = (al >= -1.0) & (al <= dk["len"] + 1.0) & (lat >= dk["lat0"] - EDGE_MARGIN) & (lat <= dk["lat1"] + EDGE_MARGIN)
    if dsm is not None and m.any():
        h = dsm.at(X[m], Z[m]) - dtm.at(X[m], Z[m])
        hh = np.zeros(X.shape)
        hh[m] = np.nan_to_num(h, nan=0.0)
        m = m & (hh > MASK_H)
    return m, al, lat


def inpaint_decks(im, i, j, res, decks, src, roads, dsm, dtm):
    """Return the tile image with every deck footprint pixel replaced by the valley below (blend of the two sides + valley roads)."""
    x0, z0 = i * G.TILE - res, j * G.TILE - res
    rect_hit = [dk for dk in decks if _rect_touches_tile(dk, i, j)]
    if not rect_hit:
        return im, False
    w, h = im.size
    xs = x0 + (np.arange(w) + 0.5) * res
    zs = z0 + (np.arange(h) + 0.5) * res
    X, Z = np.meshgrid(xs, zs)
    arr = np.asarray(im).astype(float).copy()
    changed = False
    mask_all = np.zeros((h, w), bool)
    for dk in rect_hit:
        m, al, lat = deck_mask_world(dk, X, Z, dsm, dtm)
        if m.sum() < 8:
            continue
        mask_all |= m
        # blend the two sides: sample the ortho beside the deck at the same position along the axis
        W = dk["lat1"] - dk["lat0"] + 2 * EDGE_MARGIN
        t = np.clip((lat - (dk["lat0"] - EDGE_MARGIN)) / W, 0, 1)
        t = t * t * (3 - 2 * t)
        sides = []
        for sgn, base in ((-1, dk["lat0"] - EDGE_MARGIN), (1, dk["lat1"] + EDGE_MARGIN)):
            acc = np.zeros(X[m].shape + (3,))
            nacc = np.zeros(X[m].shape)
            for off in (0.8, 1.6, 2.4, 3.2, 4.0):
                for da in (-3.0, -1.5, 0.0, 1.5, 3.0):
                    L = base + sgn * off
                    px = dk["A"][0] + dk["d"][0] * (al[m] + da) + dk["r"][0] * L
                    pz = dk["A"][1] + dk["d"][1] * (al[m] + da) + dk["r"][1] * L
                    c, ok = src.at(px, pz)
                    acc += c * ok[:, None]
                    nacc += ok
            sides.append(acc / np.maximum(nacc, 1)[:, None])
        col = sides[0] * (1 - t[m])[:, None] + sides[1] * t[m][:, None]
        # a soft, low-frequency variation so the strip does not read as a flat gradient
        rng = np.random.default_rng(int(abs(i * 977 + j * 31 + dk["id"] % 997)))
        nz = np.zeros((h, w))
        for cell, amp in ((max(2, int(round(5.0 / res))), 0.16), (max(2, int(round(1.6 / res))), 0.12)):
            g = rng.normal(0, 1, (h // cell + 2, w // cell + 2))
            nz += amp * (np.asarray(Image.fromarray(((g * 40) + 128).clip(0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(float) - 128) / 40
        col = col * SHADE * (1 + nz[m])[:, None]
        arr[m] = np.clip(col, 0, 255)
        changed = True
    if not changed:
        return im, False
    # valley roads / paths under the deck, painted in the colour of the same road just outside the deck
    layer = Image.new("L", (w, h), 0)
    for cls, wd, pts in roads:
        lm = Image.new("L", (w, h), 0)
        ImageDraw.Draw(lm).line([((x - x0) / res, (z - z0) / res) for x, z in pts], fill=255, width=max(2, int(round(wd / res))), joint="curve")
        sel = (np.asarray(lm) > 0) & mask_all
        if not sel.any():
            continue
        # colour: ortho pixels on the road line, just outside the mask
        ring = (np.asarray(lm.filter(ImageFilter.MaxFilter(1))) > 0) & ~mask_all
        near = ring & (np.asarray(Image.fromarray((mask_all * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * int(round(6 / res)) + 1))) > 0)
        base = np.asarray(im).astype(float)
        if near.sum() < 6:
            c = np.array([112.0, 112.0, 110.0]) if cls == "road" else np.array([150.0, 144.0, 130.0])
        else:
            c = np.median(base[near], axis=0)
        sh = 0.86 if cls == "road" else 0.9
        rng2 = np.random.default_rng(7)
        arr[sel] = np.clip(c * sh + rng2.normal(0, 3, (int(sel.sum()), 1)), 0, 255)
        if cls == "rail":
            # two rails 1.435 m apart
            for off in (-0.72, 0.72):
                rl = Image.new("L", (w, h), 0)
                ImageDraw.Draw(rl).line([((x + off - x0) / res, (z - z0) / res) for x, z in pts], fill=255, width=max(1, int(round(0.18 / res))))
                rs = (np.asarray(rl) > 0) & mask_all
                arr[rs] = np.clip(c * 0.45, 0, 255)
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8)), True


def _rect_touches_tile(dk, i, j):
    # conservative: the deck rectangle's bounding box against the tile (+ margin)
    c = [dk["A"] + dk["d"] * a + dk["r"] * l for a in (0, dk["len"]) for l in (dk["lat0"] - 2, dk["lat1"] + 2)]
    xs = [p[0] for p in c]
    zs = [p[1] for p in c]
    return not (max(xs) < i * G.TILE - 3 or min(xs) > (i + 1) * G.TILE + 3 or max(zs) < j * G.TILE - 3 or min(zs) > (j + 1) * G.TILE + 3)
