#!/usr/bin/env python3
"""Build the "station patch" (real surroundings of a railway station, straightened station frame) for the browser train simulator.

Format: scripts/zuch/STATION-PATCH-FORMAT.md.   Output: pb/train-sim/data/stations/<key>.json (+ index.json merge).

    /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/zuch/build_station_patch.py munsbach --name Munsbach \
        --lat 49.63055 --lon 6.26852 --heading-hint east

Open data only (no orthophoto anywhere): OSM (Geofabrik extract lux.osm.pbf), LiDAR 2024 DTM/DSM (data.public.lu COG, window range reads),
LOD2.2 buildings 2023 (CityGML, one commune zip each, only the .gml member).  Everything is cached in ~/Library/Caches/zuch-work/.
Needs the venv: numpy rasterio pyogrio shapely pillow pyproj scipy lxml.  Geodata (c) ACT Luxembourg / OpenStreetMap contributors.
"""
import argparse
import base64
import io
import json
import math
import os
import pickle
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
import zlib

import numpy as np
import pyproj
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from shapely.ops import transform as _st


def shapely_transform(fn, g):
    return _st(fn, g)

# ------------------------------------------------------------------------------------------------------------------------------ constants
XMIN, XMAX, ZMIN, ZMAX = -160.0, 160.0, -320.0, 320.0
DEM_RES = 2.0
CLS_RES = 1.0
SS = 4                      # class raster supersampling
MAX_TREES = 1500
CORRIDOR = 4.5              # rail bed half width of the main track corridor (class 8)
FLAT_HALF = 5.0             # DEM flattened to the track level within +-5 m
PLATFORM_MAX_TRACK_DIST = 12.0
EXT_M = 1500.0              # straight extension of the centre line beyond its ends
WORK = os.environ.get("ZUCH_WORK", os.path.expanduser("~/Library/Caches/zuch-work"))
OSM_PBF = os.path.join(WORK, "lux.osm.pbf")
UA = "ian.lu-zuch-sim/1.0 (konto@ian.lu)"
COG_BASE = "https://download.data.public.lu/resources/bd-l-lidar2024-releve-3d-du-territoire-luxembourgeois/20241223-093912/"
COGS = {"dtm": COG_BASE + "MNT_Lidar2024.tif", "dsm": COG_BASE + "MNS_Lidar2024.tif"}
LOD2_DATASET = "https://data.public.lu/api/1/datasets/base-de-donnees-nationale-des-batiments-3d-2023/"
LOD2_PREFIX = "act2023v2-bati3d-"
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(REPO, "pb", "train-sim", "data", "stations")

TO_LUREF = pyproj.Transformer.from_crs(4326, 2169, always_xy=True)
TO_WGS = pyproj.Transformer.from_crs(2169, 4326, always_xy=True)

# --country de (Rheinland-Pfalz): EPSG:25832, rlp.osm.pbf, GeoBasis-RLP open data (DGM1 / DOM1 GeoTIFF 1 km tiles, LoD2 CityGML 2 km tiles, dl-de/by-2-0)
DE_BASE = "https://geobasis-rlp.de/data/"
DE_DIR = os.path.join(WORK, "de")
DE_CREDIT = "Geodata (c) GeoBasis-RLP / Landesamt fuer Vermessung und Geobasisinformation Rheinland-Pfalz (dl-de/by-2-0)"
COUNTRY = "lu"
CREDIT = None


def set_country(c):
    """Switch the module to Germany (Rheinland-Pfalz).  The Luxembourg defaults above stay untouched when this is never called."""
    global COUNTRY, OSM_PBF, TO_LUREF, TO_WGS, CREDIT
    if c == "de":
        COUNTRY = "de"
        OSM_PBF = os.path.join(WORK, "rlp.osm.pbf")
        TO_LUREF = pyproj.Transformer.from_crs(4326, 25832, always_xy=True)
        TO_WGS = pyproj.Transformer.from_crs(25832, 4326, always_xy=True)
        CREDIT = DE_CREDIT

CLS_ASPHALT, CLS_PAVING, CLS_LAWN, CLS_MEADOW, CLS_FOREST, CLS_GRAVEL, CLS_WATER, CLS_BUILDING, CLS_BED = range(9)
CLASS_RGB = [(88, 88, 94), (196, 190, 178), (118, 176, 84), (178, 194, 104), (42, 102, 52), (176, 154, 122), (70, 128, 206), (206, 96, 74),
             (122, 106, 96), (255, 0, 255)]

HEADINGS = {"north": 0, "n": 0, "northeast": 45, "ne": 45, "east": 90, "e": 90, "southeast": 135, "se": 135, "south": 180, "s": 180,
            "southwest": 225, "sw": 225, "west": 270, "w": 270, "northwest": 315, "nw": 315}

HW_OUT = {"motorway": "primary", "motorway_link": "primary", "trunk": "primary", "trunk_link": "primary", "primary": "primary",
          "primary_link": "primary", "secondary": "secondary", "secondary_link": "secondary", "tertiary": "tertiary",
          "tertiary_link": "tertiary", "unclassified": "residential", "residential": "residential", "living_street": "residential",
          "service": "service", "track": "track", "path": "path", "bridleway": "path", "footway": "footway", "pedestrian": "footway",
          "cycleway": "cycleway", "steps": "steps"}
ROAD_W = {"primary": 7.0, "secondary": 6.4, "tertiary": 6.0, "residential": 5.2, "service": 3.4, "track": 3.0, "path": 1.2, "footway": 1.8,
          "cycleway": 2.2, "steps": 2.0}
SIDEWALK_W = {"primary": 2.4, "secondary": 2.2, "tertiary": 2.0, "residential": 1.8}
PAVED = ("asphalt", "paved", "concrete", "paving_stones", "sett", "cobblestone", "concrete:plates", "concrete:lanes", "bricks", "metal", "wood")


def log(*a):
    print("[%6.1fs]" % (time.time() - T0), *a, flush=True)


T0 = time.time()


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in polys_of(x)]
    return []


def lines_of(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in lines_of(x)]
    return []


def fix(g):
    if g is not None and not g.is_valid:
        g = shapely.make_valid(g)
        g = unary_union(polys_of(g)) if polys_of(g) else Polygon()
    return g


def r2(v):
    return round(float(v), 2)


def clean_ring(pts, dims=2):
    """Round to 0.01 m, drop consecutive duplicates and the closing vertex (rings are implicitly closed).  None if < 3 vertices remain."""
    out = []
    for p in pts:
        q = [r2(c) for c in p]
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else None


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------------------------------------ downloads
def http_get(url, headers=None, tries=6, timeout=120):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=dict({"User-Agent": UA}, **(headers or {})))
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + 3 * k)
    raise RuntimeError("GET failed %s: %s" % (url[:140], last))


class HttpFile(io.RawIOBase):
    """Read-only seekable file over HTTP range requests (zipfile lists a huge zip, we then pull one member)."""

    def __init__(self, url, block=1 << 20):
        self.url, self.pos, self.block, self.cache = url, 0, block, {}
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def get(self, a, b):
        return http_get(self.url, {"Range": "bytes=%d-%d" % (a, b)})

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        a, end = self.pos, self.pos + n - 1
        if n > self.block:
            data = self.get(a, end)
            self.pos = end + 1
            return data
        out = b""
        while a <= end:
            k = a // self.block
            if k not in self.cache:
                if len(self.cache) > 16:
                    self.cache.pop(next(iter(self.cache)))
                s0 = k * self.block
                self.cache[k] = self.get(s0, min(self.size - 1, s0 + self.block - 1))
            blk = self.cache[k]
            off = a - k * self.block
            take = min(len(blk) - off, end - a + 1)
            out += blk[off:off + take]
            a += take
        self.pos = end + 1
        return out

    def readinto(self, buf):
        d = self.read(len(buf))
        buf[:len(d)] = d
        return len(d)


def lod2_listing():
    path = os.path.join(WORK, "lod2", "dataset.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        with open(path, "wb") as fh:
            fh.write(http_get(LOD2_DATASET))
    with open(path) as fh:
        ds = json.load(fh)
    out = {}
    for r in ds["resources"]:
        b = r["url"].rsplit("/", 1)[-1]
        if b.startswith(LOD2_PREFIX) and b.endswith(".zip"):
            out[b[len(LOD2_PREFIX):-4]] = r["url"]
    return out


def lod2_gml(slug):
    """Path of the commune CityGML file; only the .gml member of the commune zip is fetched (range requests), cached on disk."""
    dst = os.path.join(WORK, "lod2", slug + ".gml")
    if os.path.exists(dst):
        return dst
    old = os.path.expanduser("~/Library/Caches/luxtram-work/geo/lod2/%s.gml" % slug)     # read-only reuse of the Luxtram download
    if os.path.exists(old):
        return old
    f = HttpFile(lod2_listing()[slug])
    z = zipfile.ZipFile(f)
    info = [i for i in z.infolist() if i.filename.lower().endswith(".gml")][0]
    log("LOD2 %s: %s %d MB compressed, %d MB xml" % (slug, info.filename, info.compress_size >> 20, info.file_size >> 20))
    f.seek(info.header_offset)
    hdr = f.read(30)
    start = info.header_offset + 30 + int.from_bytes(hdr[26:28], "little") + int.from_bytes(hdr[28:30], "little")
    end = start + info.compress_size
    dec, pos, step = zlib.decompressobj(-15), start, 8 << 20
    tmp = dst + ".part"
    with open(tmp, "wb") as out:
        while pos < end:
            blk = f.get(pos, min(end, pos + step) - 1)
            out.write(dec.decompress(blk))
            pos += len(blk)
        out.write(dec.flush())
    os.replace(tmp, dst)
    return dst


# ------------------------------------------------------------------------------------------------------------------------------ OSM
TAG_RE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def lonlat_bbox(e0, n0, e1, n1):
    lo0, la0 = TO_WGS.transform(e0, n0)
    lo1, la1 = TO_WGS.transform(e1, n1)
    return (min(lo0, lo1), min(la0, la1), max(lo0, lo1), max(la0, la1))


def read_osm(layer, bb2169, where=None):
    """Features of a Geofabrik extract layer inside an EPSG:2169 bbox: [{id, g (shapely, EPSG:2169), t (merged tag dict)}]."""
    from pyogrio.raw import read
    meta, _, geom, fields = read(OSM_PBF, layer=layer, bbox=lonlat_bbox(*bb2169), where=where)
    names = [str(n) for n in meta["fields"]]
    out = []
    for i in range(len(geom)):
        if geom[i] is None:
            continue
        t = {}
        osm_id = way_id = None
        for k, n in enumerate(names):
            v = fields[k][i]
            if n == "other_tags":
                if isinstance(v, str):
                    for a, b in TAG_RE.findall(v):
                        t[a.replace('\\"', '"')] = b.replace('\\"', '"')
            elif n == "osm_id":
                osm_id = v if isinstance(v, str) else None
            elif n == "osm_way_id":
                way_id = v if isinstance(v, str) and v else None
            elif n == "z_order":
                continue
            elif isinstance(v, str) and v:
                t[n] = v
        g = shapely_transform(TO_LUREF.transform, shapely.from_wkb(geom[i]))
        oid = ("w" + way_id) if way_id else (("r" if layer == "multipolygons" else "w") + str(osm_id))
        out.append({"id": oid, "g": g, "t": t})
    return out


def parse_num(v):
    if not v:
        return None
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)", str(v))
    return float(m.group(1).replace(",", ".")) if m else None


# ------------------------------------------------------------------------------------------------------------------------------ frame
class Frame:
    """Curvilinear station frame: forward (E,N)->(u,v), inverse (u,v)->(E,N).  u = arc length along the smoothed main track."""

    def __init__(self, pts):
        d = np.diff(pts, axis=0)
        L = np.hypot(d[:, 0], d[:, 1])
        self.P = pts
        self.s = np.r_[0.0, np.cumsum(L)]
        self.T = d / L[:, None]
        self.Rn = np.c_[self.T[:, 1], -self.T[:, 0]]                       # right normal of each segment
        tv = np.vstack([self.T[:1], self.T[:-1] + self.T[1:], self.T[-1:]])
        tv /= np.hypot(tv[:, 0], tv[:, 1])[:, None]
        self.Tv = tv
        self.Rv = np.c_[tv[:, 1], -tv[:, 0]]
        self.idx = np.arange(len(pts), dtype=float)
        self.tree = cKDTree(pts)

    def forward(self, E, N):
        E = np.asarray(E, float)
        shp = E.shape
        p = np.c_[E.ravel(), np.asarray(N, float).ravel()]
        _, i = self.tree.query(p)
        best_d = np.full(len(p), np.inf)
        u = np.zeros(len(p))
        v = np.zeros(len(p))
        for off in (-1, 0):
            sg = np.clip(i + off, 0, len(self.P) - 2)
            A, B = self.P[sg], self.P[sg + 1]
            ab = B - A
            L2 = (ab ** 2).sum(1)
            t = np.clip(((p - A) * ab).sum(1) / L2, 0, 1)
            q = A + ab * t[:, None]
            d = np.hypot(*(p - q).T)
            better = d < best_d
            best_d = np.where(better, d, best_d)
            u = np.where(better, self.s[sg] + t * np.sqrt(L2), u)
            v = np.where(better, ((p - q) * self.Rn[sg]).sum(1), v)
        return u.reshape(shp), v.reshape(shp)

    def inverse(self, u, v):
        u = np.asarray(u, float)
        shp = u.shape
        fi = np.interp(u.ravel(), self.s, self.idx)
        i0 = np.clip(np.floor(fi).astype(int), 0, len(self.P) - 2)
        f = (fi - i0)[:, None]
        P = self.P[i0] * (1 - f) + self.P[i0 + 1] * f
        R = self.Rv[i0] * (1 - f) + self.Rv[i0 + 1] * f
        R /= np.hypot(R[:, 0], R[:, 1])[:, None]
        q = P + R * np.asarray(v, float).ravel()[:, None]
        return q[:, 0].reshape(shp), q[:, 1].reshape(shp)

    def tangent(self, u):
        fi = np.interp(np.asarray(u, float), self.s, self.idx)
        i0 = np.clip(np.floor(fi).astype(int), 0, len(self.P) - 1)
        return self.Tv[i0]


def line_endpoints_match(a, b, tol=0.8):
    return float(np.hypot(*(np.asarray(a) - np.asarray(b)))) <= tol


def chain_track(ways, start, need):
    """Chain OSM ways (list of (n,2) arrays) end to end through shared nodes, starting from ways[start]; choose the straightest continuation
    at junctions.  `need` = metres wanted beyond the start way on each side.  Returns one (m,2) array."""
    used = {start}
    chain = ways[start].copy()

    def grow(chain, front):
        total = 0.0
        while total < need:
            end = chain[0] if front else chain[-1]
            ref = chain[min(len(chain) - 1, 8)] if front else chain[max(0, len(chain) - 9)]
            d0 = end - ref
            d0 /= max(np.hypot(*d0), 1e-9)
            best, bscore = None, 1e9
            for k, w in enumerate(ways):
                if k in used:
                    continue
                for rev in (False, True):
                    ww = w[::-1] if rev else w
                    if line_endpoints_match(ww[0], end):
                        d1 = ww[min(len(ww) - 1, 8)] - ww[0]
                        d1 /= max(np.hypot(*d1), 1e-9)
                        ang = math.degrees(math.acos(float(np.clip((d0 * d1).sum(), -1, 1))))
                        if ang < bscore and ang < 50:
                            best, bscore = (k, ww), ang
            if best is None:
                break
            used.add(best[0])
            ww = best[1]
            total += float(np.hypot(*np.diff(ww, axis=0).T).sum())
            chain = np.vstack([ww[::-1][:-1], chain]) if front else np.vstack([chain, ww[1:]])
        return chain

    chain = grow(chain, False)
    chain = grow(chain, True)
    return chain, used


def resample(pts, step=1.0):
    d = np.hypot(*np.diff(pts, axis=0).T)
    s = np.r_[0, np.cumsum(d)]
    keep = np.r_[True, d > 1e-6]
    s, pts = s[keep], pts[keep]
    t = np.arange(0, s[-1], step)
    return np.c_[np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])]


def smooth_line(pts, sigma):
    """Gaussian smoothing along the line with straight-line padding (so the ends do not shrink)."""
    pad = int(4 * sigma)
    t0 = pts[0] - pts[min(30, len(pts) - 1)]
    t1 = pts[-1] - pts[max(0, len(pts) - 31)]
    t0 /= np.hypot(*t0)
    t1 /= np.hypot(*t1)
    k = np.arange(1, pad + 1)[:, None]
    ext = np.vstack([pts[0] + t0 * k[::-1] * 1.0, pts, pts[-1] + t1 * k * 1.0])
    out = np.c_[ndi.gaussian_filter1d(ext[:, 0], sigma, mode="nearest"), ndi.gaussian_filter1d(ext[:, 1], sigma, mode="nearest")]
    return out[pad:-pad]


def extend_straight(pts, meters):
    t0 = pts[0] - pts[20]
    t1 = pts[-1] - pts[-21]
    t0 /= np.hypot(*t0)
    t1 /= np.hypot(*t1)
    k = np.arange(1, int(meters) + 1)[:, None]
    return np.vstack([pts[0] + t0 * k[::-1], pts, pts[-1] + t1 * k])


# ------------------------------------------------------------------------------------------------------------------------------ LiDAR
class Raster:
    def __init__(self, arr, left, top, res):
        self.arr, self.left, self.top, self.res = arr, left, top, res

    def sample(self, E, N):
        E = np.asarray(E, float)
        col = (E - self.left) / self.res - 0.5
        row = (self.top - np.asarray(N, float)) / self.res - 0.5
        out = ndi.map_coordinates(self.arr, [np.atleast_1d(row), np.atleast_1d(col)], order=1, mode="nearest").astype(np.float64)
        return out.reshape(E.shape)


def fetch_lidar(key, bb):
    """DTM + DSM windows (float32, 0.5 m) over bb=(e0,n0,e1,n1), cached as npz.  Returns (dtm, dsm) Raster objects, gaps filled."""
    import rasterio
    from rasterio.windows import from_bounds
    cache = os.path.join(WORK, "lidar", key + ".npz")
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    if os.path.exists(cache):
        z = np.load(cache)
        if z["bb"][0] <= bb[0] and z["bb"][1] <= bb[1] and z["bb"][2] >= bb[2] and z["bb"][3] >= bb[3]:
            return Raster(z["dtm"], *z["geo"]), Raster(z["dsm"], *z["geo"])
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", VSI_CACHE="TRUE",
                       VSI_CACHE_SIZE="268435456", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2")
    out = {}
    with env:
        for k, u in COGS.items():
            ds = rasterio.open("/vsicurl/" + u)
            win = from_bounds(*bb, ds.transform).round_offsets().round_lengths()
            a = ds.read(1, window=win, boundless=True, fill_value=-9999.0).astype(np.float32)
            tr = ds.window_transform(win)
            bad = a <= -9000
            if bad.any():
                if bad.all():
                    raise RuntimeError("no LiDAR coverage for " + key)
                idx = ndi.distance_transform_edt(bad, return_distances=False, return_indices=True)
                a = a[tuple(idx)]
            out[k] = a
            geo = np.array([tr.c, tr.f, tr.a])
            log("LiDAR", k, a.shape, "range %.1f..%.1f" % (a.min(), a.max()), "nodata %.2f%%" % (100 * bad.mean()))
    np.savez_compressed(cache, dtm=out["dtm"], dsm=out["dsm"], geo=geo, bb=np.array(bb))
    return Raster(out["dtm"], *geo), Raster(out["dsm"], *geo)


# ------------------------------------------------------------------------------------------------------------------------------ GeoBasis-RLP (Germany)
def de_listing(name):
    """{(E_km, N_km): url} of the newest tile per 1 km / 2 km cell of an opendata directory listing (cached on disk).
    name: dgm1 | dom1 (GeoTIFF, 1 m) | geb3dlo (LoD2 CityGML, 2 km tiles)."""
    sub = {"dgm1": "dgm1/current/tif/", "dom1": "dom1/current/tif/", "geb3dlo": "geb3dlo/current/gml/"}[name]
    path = os.path.join(DE_DIR, "listing-%s.txt" % name)
    os.makedirs(DE_DIR, exist_ok=True)
    if not os.path.exists(path):
        curl_to(DE_BASE + sub, path)
    with open(path, errors="replace") as fh:
        txt = fh.read()
    out = {}
    for m in re.finditer(r"((?:dgm1|dom1|LoD2)_32_(\d+)_(\d+)_\d_(?:rp|RP)(?:_\d+)?\.(?:tif|gml))", txt):
        k = (int(m.group(2)), int(m.group(3)))
        if k not in out or m.group(1) > out[k][0]:
            out[k] = (m.group(1), DE_BASE + sub + m.group(1))
    return {k: v[1] for k, v in out.items()}


def curl_to(url, dst):
    """Download with the system curl (the geobasis-rlp.de TLS chain is only trusted by the macOS keychain, not by python's certifi-less urllib)."""
    import subprocess
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(["curl", "-sSfL", "--retry", "4", "--retry-delay", "3", "-m", "900", "-A", UA, "-o", dst + ".part", url], check=True)
    os.replace(dst + ".part", dst)


def de_download(url, sub):
    dst = os.path.join(DE_DIR, sub, url.rsplit("/", 1)[-1])
    if not os.path.exists(dst):
        curl_to(url, dst)
    return dst


def fetch_dem_de(key, bb):
    """DTM (DGM1) + DSM (DOM1) mosaics at 1 m over bb=(e0,n0,e1,n1) in EPSG:25832 from the GeoBasis-RLP open data tiles; cached as npz.
    Gaps (tile missing / nodata) are filled from the nearest valid cell.  Returns (dtm, dsm) Raster objects."""
    import rasterio
    cache = os.path.join(DE_DIR, "dem", key + ".npz")
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    if os.path.exists(cache):
        z = np.load(cache)
        if z["bb"][0] <= bb[0] and z["bb"][1] <= bb[1] and z["bb"][2] >= bb[2] and z["bb"][3] >= bb[3]:
            return Raster(z["dtm"], *z["geo"]), Raster(z["dsm"], *z["geo"])
    x0, y0, x1, y1 = [int(math.floor(bb[0] / 1000.0)), int(math.floor(bb[1] / 1000.0)), int(math.floor(bb[2] / 1000.0)), int(math.floor(bb[3] / 1000.0))]
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    out = {}
    for nm in ("dgm1", "dom1"):
        lst = de_listing(nm)
        arr = np.full((ny * 1000, nx * 1000), -9999.0, np.float32)
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                url = lst.get((tx, ty))
                if url is None:
                    log("WARNING: no %s tile %d_%d" % (nm, tx, ty))
                    continue
                with rasterio.open(de_download(url, nm)) as ds:
                    a = ds.read(1).astype(np.float32)
                    if ds.nodata is not None:
                        a[a == ds.nodata] = -9999.0
                    if a.shape != (1000, 1000):
                        raise RuntimeError("unexpected %s tile shape %s" % (nm, a.shape))
                    r0 = (y1 - ty) * 1000
                    c0 = (tx - x0) * 1000
                    arr[r0:r0 + 1000, c0:c0 + 1000] = a
        bad = arr <= -9000
        if bad.all():
            raise RuntimeError("no %s coverage for %s" % (nm, key))
        if bad.any():
            idx = ndi.distance_transform_edt(bad, return_distances=False, return_indices=True)
            arr = arr[tuple(idx)]
        out[nm] = arr
        log("RLP", nm, arr.shape, "range %.1f..%.1f" % (arr.min(), arr.max()), "nodata %.2f%%" % (100 * bad.mean()))
    geo = np.array([x0 * 1000.0, (y1 + 1) * 1000.0, 1.0])
    np.savez_compressed(cache, dtm=out["dgm1"], dsm=out["dom1"], geo=geo, bb=np.array([x0 * 1000.0, y0 * 1000.0, (x1 + 1) * 1000.0, (y1 + 1) * 1000.0]))
    return Raster(out["dgm1"], *geo), Raster(out["dom1"], *geo)


def lod2_de_tiles(bb):
    """LoD2 2 km tile URLs ({tile: url}) that intersect bb=(e0,n0,e1,n1)."""
    lst = de_listing("geb3dlo")
    res = {}
    for tx in range(int(math.floor(bb[0] / 2000.0)) * 2, int(math.floor(bb[2] / 2000.0)) * 2 + 1, 2):
        for ty in range(int(math.floor(bb[1] / 2000.0)) * 2, int(math.floor(bb[3] / 2000.0)) * 2 + 1, 2):
            if (tx, ty) in lst:
                res["%d_%d" % (tx, ty)] = lst[(tx, ty)]
    return res


# ------------------------------------------------------------------------------------------------------------------------------ LOD2
NS_B = "{http://www.opengis.net/citygml/building/2.0}"
NS_G = "{http://www.opengis.net/gml}"


def parse_lod2(path, win, ns_b=None, axis="ne"):
    """Buildings of a CityGML file whose ground-surface centroid is inside win=(e0,n0,e1,n1) (EPSG:2169; win None = all).  Axis order in the Luxembourg
    file: N, E, z (axis="ne"); the RLP files are E, N, z (axis="en") in CityGML 1.0 (ns_b = building namespace).
    Returns [{gid, roofs, walls, ground}] with rings as (k,3) arrays (E, N, z)."""
    from lxml import etree
    NS_B = ns_b or globals()["NS_B"]
    out = []
    seen = 0
    for _, el in etree.iterparse(path, events=("end",), tag=NS_B + "Building", huge_tree=True):
        seen += 1
        surf = {"roof": [], "wall": [], "ground": []}
        for bs in el.iter(NS_B + "RoofSurface", NS_B + "WallSurface", NS_B + "GroundSurface", NS_B + "OuterCeilingSurface",
                          NS_B + "OuterFloorSurface", NS_B + "ClosureSurface"):
            kind = {"RoofSurface": "roof", "WallSurface": "wall", "GroundSurface": "ground"}.get(etree.QName(bs).localname, "roof")
            for poly in bs.iter(NS_G + "Polygon"):
                ext = poly.find(NS_G + "exterior")
                pl = ext.find(".//" + NS_G + "posList") if ext is not None else None
                if pl is None or not pl.text:
                    continue
                a = np.array(pl.text.split(), dtype=float).reshape(-1, 3)
                if len(a) >= 2 and np.abs(a[0] - a[-1]).max() < 1e-6:
                    a = a[:-1]
                if len(a) >= 3:
                    surf[kind].append(np.c_[a[:, 1], a[:, 0], a[:, 2]] if axis == "ne" else a)
        gid = el.get(NS_G + "id")
        attr = {}
        for nm in ("measuredHeight", "storeysAboveGround", "roofType", "function"):
            e_ = el.find(NS_B + nm)
            if e_ is not None and e_.text:
                attr[nm] = e_.text.strip()
        el.clear()
        while el.getprevious() is not None:
            del el.getparent()[0]
        allp = surf["ground"] + surf["roof"] + surf["wall"]
        if not allp or not (surf["roof"] or surf["wall"]):
            continue
        pts = np.vstack(allp)
        c = pts[:, :2].mean(0)
        if win is not None and not (win[0] <= c[0] <= win[2] and win[1] <= c[1] <= win[3]):
            continue
        out.append({"gid": gid, "roofs": surf["roof"], "walls": surf["wall"], "ground": surf["ground"], "attr": attr, "c": (float(c[0]), float(c[1]))})
    log("LOD2", os.path.basename(path), "scanned", seen, "kept", len(out))
    return out


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def communes_for(patch_poly, bb):
    """Commune slugs (LOD2 zips) whose OSM admin_level=8 area intersects the patch."""
    listing = lod2_listing()
    res = []
    for f in read_osm("multipolygons", bb, where="boundary='administrative' AND admin_level='8'"):
        g = fix(f["g"])
        if g.is_empty or not g.intersects(patch_poly):
            continue
        cands = [f["t"].get("name", "")] + [f["t"].get(k, "") for k in ("name:fr", "name:de", "name:en", "official_name")]
        slug = next((slugify(c) for c in cands if c and slugify(c) in listing), None)
        if slug is None:
            log("WARNING: no LOD2 zip for commune", cands)
        elif slug not in res:
            res.append(slug)
    return res


# ------------------------------------------------------------------------------------------------------------------------------ main pieces
def parse_heading(h):
    if h is None:
        return None
    try:
        return float(h)
    except ValueError:
        return HEADINGS[h.lower()]


def find_station(osm_lines, polys, pts, name, node):
    """Station building, main platform, main track way index (all EPSG:2169)."""
    sb = None
    best = 1e9
    for f in polys:
        t = f["t"]
        if not t.get("building"):
            continue
        if t["building"] in ("train_station", "station") or t.get("railway") in ("station", "halt") or t.get("public_transport") == "station":
            d = f["g"].distance(node)
            if d < best and d < 150:
                sb, best = f, d
    plat = []
    for f in polys:
        if f["t"].get("railway") == "platform" and f["g"].distance(node) < 250:
            plat += [(f, g) for g in polys_of(fix(f["g"]))]
    for f in osm_lines:
        if f["t"].get("railway") == "platform" and f["g"].distance(node) < 250:
            plat += [(f, f["g"].buffer(1.5))]
    return sb, plat


def find_station_building_de(polys, node, points):
    """Germany: the Empfangsgebaeude is usually an untagged building=yes that carries the address of the station node (addr:street + housenumber), or a
    building named like the station / "Bahnhof" within 80 m.  Returns the OSM feature or None (halts without a building)."""
    st = None
    for f in points:
        t = f["t"]
        if t.get("railway") in ("station", "halt") and f["g"].distance(node) < 60 and (st is None or f["g"].distance(node) < st["g"].distance(node)):
            st = f
    best, bd = None, 1e9
    for f in polys:
        t = f["t"]
        if not t.get("building") or t["building"] in ("roof", "garage", "garages", "carport", "shed", "hut"):
            continue
        d = f["g"].distance(node)
        if d > 150:
            continue
        hit = False
        if st is not None and st["t"].get("addr:street") and t.get("addr:street") == st["t"].get("addr:street") and t.get("addr:housenumber") == st["t"].get("addr:housenumber"):
            hit = True
        nm = (t.get("name") or "").lower()
        if nm and ("bahnhof" in nm or (st is not None and (st["t"].get("name") or "").lower().split(" ")[0] in nm and "bahnhof" in nm)):
            hit = True
        if t.get("railway") or t.get("public_transport") or t.get("building") in ("train_station", "station"):
            hit = True
        if hit and d < bd:
            best, bd = f, d
    return best


def road_width(t, cls):
    w = parse_num(t.get("width")) or parse_num(t.get("est_width"))
    if w:
        return float(min(max(w, 0.8), 30.0))
    w = ROAD_W[cls]
    lanes = parse_num(t.get("lanes"))
    oneway = t.get("oneway") in ("yes", "1", "true") or t.get("junction") == "roundabout"
    if cls in ("primary", "secondary", "tertiary", "residential", "service"):
        if lanes:
            w = max(3.0 if oneway else w, 3.1 * lanes + (0.5 if not oneway else 0.8))
        elif oneway and cls in ("residential", "tertiary"):
            w = 4.4
        if t.get("service") == "driveway":
            w = 3.0
        elif t.get("service") == "parking_aisle":
            w = 5.0
        elif t.get("service") in ("alley", "emergency_access", "drive-through"):
            w = 3.2
    return float(w)


def landuse_class(t):
    lu, nat, lei = t.get("landuse"), t.get("natural"), t.get("leisure")
    if t.get("amenity") == "parking" or lu == "garages":
        return CLS_ASPHALT
    if nat in ("water", "bay") or lu in ("reservoir", "basin") or t.get("waterway") == "riverbank":
        return CLS_WATER
    if lu in ("forest",) or nat in ("wood", "scrub", "tree_row"):
        return CLS_FOREST
    if lu in ("meadow", "farmland", "farmyard", "orchard", "vineyard", "plant_nursery", "greenfield") or nat in ("grassland", "heath", "wetland", "fell"):
        return CLS_MEADOW
    if lu in ("grass", "village_green", "recreation_ground", "cemetery", "allotments", "residential", "flowerbed", "greenhouse_horticulture", "religious") \
            or lei in ("park", "garden", "playground", "pitch", "golf_course", "dog_park", "common", "sports_centre", "stadium"):
        if lei == "pitch" and t.get("surface") in PAVED:
            return CLS_ASPHALT
        return CLS_LAWN
    if lu in ("industrial", "commercial", "retail", "construction", "education", "institutional", "military"):
        return CLS_LAWN
    if lu in ("railway", "quarry", "brownfield", "landfill") or nat in ("bare_rock", "scree", "sand", "shingle"):
        return CLS_GRAVEL
    return None


class Canvas:
    """Supersampled painter's-algorithm class raster in station coordinates (x right, z down), 1 m / px final."""

    def __init__(self, base):
        self.w, self.h = int((XMAX - XMIN) * SS), int((ZMAX - ZMIN) * SS)
        self.img = Image.new("L", (self.w, self.h), base)
        self.d = ImageDraw.Draw(self.img)

    def px(self, c):
        c = np.asarray(c)
        return np.c_[(c[:, 0] - XMIN) * SS, (c[:, 1] - ZMIN) * SS]

    def poly(self, g, cls):
        for pg in polys_of(g):
            if pg.is_empty:
                continue
            ext = [tuple(p) for p in self.px(np.asarray(pg.exterior.coords))]
            if not pg.interiors:
                self.d.polygon(ext, fill=cls)
                continue
            x0, y0, x1, y1 = [int(v) for v in (min(p[0] for p in ext) - 2, min(p[1] for p in ext) - 2, max(p[0] for p in ext) + 3, max(p[1] for p in ext) + 3)]
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, self.w), min(y1, self.h)
            if x1 <= x0 or y1 <= y0:
                continue
            m = Image.new("L", (x1 - x0, y1 - y0), 0)
            md = ImageDraw.Draw(m)
            md.polygon([(p[0] - x0, p[1] - y0) for p in ext], fill=255)
            for r in pg.interiors:
                md.polygon([(p[0] - x0, p[1] - y0) for p in self.px(np.asarray(r.coords))], fill=0)
            self.img.paste(cls, (x0, y0), m)

    def result(self):
        a = np.asarray(self.img).reshape(int(ZMAX - ZMIN), SS, int(XMAX - XMIN), SS)
        cnt = np.stack([(a == k).sum(axis=(1, 3)) for k in range(10)], axis=-1)
        return cnt.argmax(-1).astype(np.uint8)


def build(args):
    key, name = args.key, args.name or args.key.title()
    os.makedirs(OUT_DIR, exist_ok=True)
    E0, N0 = TO_LUREF.transform(args.lon, args.lat)
    node = Point(E0, N0)
    hint = parse_heading(args.heading_hint)
    # ---------------------------------------------------------------------------------------------------- station objects (OSM)
    R = 1700.0
    near_bb = (E0 - 400, N0 - 400, E0 + 400, N0 + 400)
    polys0 = read_osm("multipolygons", near_bb)
    lines0 = read_osm("lines", near_bb)
    sbld, plats = find_station(lines0, polys0, None, name, node)
    if sbld is None and COUNTRY == "de":
        sbld = find_station_building_de(polys0, node, read_osm("points", near_bb, where="other_tags LIKE '%\"railway\"=>%'"))
    log("station building:", sbld["id"] if sbld else None, "| platforms near:", len(plats))
    allrail = [f for f in read_osm("lines", (E0 - R, N0 - R, E0 + R, N0 + R), where="railway IS NOT NULL") if f["t"].get("railway") == "rail"]
    # main-line candidates only (no sidings / yards / spurs / crossovers)
    cand = [f for f in allrail if f["t"].get("service") not in ("siding", "yard", "spur", "crossover") and f["t"].get("usage") not in ("industrial",)]
    if not cand:
        raise SystemExit("no railway=rail lines found near the station")
    ref_geom = sbld["g"] if sbld else node
    if plats:
        main_plat = min(plats, key=lambda p: p[1].distance(ref_geom))
        ref_geom = main_plat[1]
    near = [f for f in cand if f["g"].distance(ref_geom) < 60]
    main = min(near or cand, key=lambda f: f["g"].distance(ref_geom))
    log("main track way", main["id"], "distance to platform %.1f m" % main["g"].distance(ref_geom))
    ways = [np.asarray(f["g"].coords)[:, :2] for f in cand]
    start = [f["id"] for f in cand].index(main["id"])
    chain, used_ways = chain_track(ways, start, 1200.0)
    chain_ids = {cand[k]["id"] for k in used_ways}
    pts = resample(chain, 1.0)
    # orientation: heading at the station projection vs hint
    ps = shapely.line_locate_point(LineString(pts), node)
    ik = int(np.clip(ps, 30, len(pts) - 31))
    h = pts[ik + 25] - pts[ik - 25]
    comp = math.degrees(math.atan2(h[0], h[1])) % 360
    if hint is not None and math.cos(math.radians(comp - hint)) < 0:
        pts = pts[::-1]
    elif hint is None:
        log("WARNING: no --heading-hint, keeping the OSM way direction")
    raw_pts = pts.copy()
    pts = smooth_line(pts, 8.0)
    dev = np.hypot(*(pts - raw_pts).T)
    log("centre line: %d m chain, smoothing deviation max %.2f m, mean %.2f m" % (len(pts), dev.max(), dev.mean()))
    pts = resample(extend_straight(pts, EXT_M), 1.0)
    frame = Frame(pts)
    # origin: middle of the platforms along the track
    track_line = LineString(pts)
    pl_u = []
    for f, g in plats:
        if g.distance(track_line) <= PLATFORM_MAX_TRACK_DIST:
            c = np.asarray(g.exterior.coords)
            pl_u += list(frame.forward(c[:, 0], c[:, 1])[0])
    u_node = float(frame.forward(E0, N0)[0])
    u0 = (min(pl_u) + max(pl_u)) / 2 if pl_u else u_node
    log("platform u-range %.1f..%.1f (length %.0f m) -> origin u0 %.1f (station node at %.1f)" % (min(pl_u or [u0]), max(pl_u or [u0]), (max(pl_u) - min(pl_u)) if pl_u else 0, u0, u_node))
    oE, oN = frame.inverse(u0, 0.0)
    oE, oN = float(oE), float(oN)
    tg = frame.tangent(u0)
    heading = math.degrees(math.atan2(tg[0], tg[1])) % 360
    lon, lat = TO_WGS.transform(oE, oN)
    # side
    side_ref = sbld["g"] if sbld else (main_plat[1] if plats else None)
    if side_ref is not None:
        c = side_ref.centroid
        vv = float(frame.forward(c.x, c.y)[1])
        side = "left" if vv < 0 else "right"
        log("station %s centroid lateral offset v=%.1f m -> side %s" % ("building" if sbld else "platform", vv, side))
    else:
        side = "left"
        log("WARNING: no station building / platform found, side defaulted")

    def to_xz(E, N):
        u, v = frame.forward(E, N)
        return v, -(u - u0)

    def to_en(x, z):
        return frame.inverse(u0 - np.asarray(z), x)

    def geom_to_frame(g):
        return shapely_transform(lambda a, b, c=None: to_xz(np.asarray(a), np.asarray(b)), g)

    def dens(line, step=4.0):
        if line.length < step:
            return line
        return shapely.segmentize(line, step)

    # patch geometry in world + data window
    gx = np.linspace(XMIN, XMAX, 33)
    gz = np.linspace(ZMIN, ZMAX, 129)
    edge = np.vstack([np.c_[np.full(129, XMIN), gz], np.c_[np.full(129, XMAX), gz], np.c_[gx, np.full(33, ZMIN)], np.c_[gx, np.full(33, ZMAX)]])
    eE, eN = to_en(edge[:, 0], edge[:, 1])
    patch_world = Polygon(np.c_[eE, eN]).convex_hull
    pb = patch_world.bounds
    # fold / curvature sanity
    uu = np.linspace(u0 - 360, u0 + 360, 19)
    tt = frame.tangent(uu)
    turn = math.degrees(abs(np.unwrap(np.arctan2(tt[:, 0], tt[:, 1]))[-1] - np.unwrap(np.arctan2(tt[:, 0], tt[:, 1]))[0]))
    dang = np.abs(np.diff(np.unwrap(np.arctan2(tt[:, 0], tt[:, 1]))))
    rmin = 40.0 / max(float(dang.max()), 1e-9)                       # heading change per 40 m
    log("track turns %.1f deg over +-360 m (tightest ~%.0f m radius over 40 m, lateral compression at +-160 m inside the curve down to %.0f%%); heading %.1f deg" % (turn, rmin, 100 * max(0.0, 1 - 160.0 / rmin), heading))
    # ---------------------------------------------------------------------------------------------------- LiDAR
    margin = 40.0
    lbb = (math.floor(pb[0] - margin), math.floor(pb[1] - margin), math.ceil(pb[2] + margin), math.ceil(pb[3] + margin))
    dtm, dsm = fetch_dem_de(key, lbb) if COUNTRY == "de" else fetch_lidar(key, lbb)
    # DEM at 2 m (4x4 area average per cell), absolute heights
    nx, nz = int((XMAX - XMIN) / DEM_RES) + 1, int((ZMAX - ZMIN) / DEM_RES) + 1
    dx = np.array([-0.75, -0.25, 0.25, 0.75])
    X = XMIN + DEM_RES * np.arange(nx)
    Z = ZMIN + DEM_RES * np.arange(nz)
    acc = np.zeros((nz, nx))
    for sx in dx:
        for sz in dx:
            xx = np.clip(X[None, :] + sx, XMIN, XMAX) + np.zeros((nz, 1))
            zz = np.clip(Z[:, None] + sz, ZMIN, ZMAX) + np.zeros((1, nx))
            E, N = to_en(xx, zz)
            acc += dtm.sample(E, N)
    dem_abs = acc / 16.0
    corr = np.abs(X) <= FLAT_HALF
    row_med = np.median(dem_abs[:, corr], axis=1)
    row_med = ndi.median_filter(row_med, size=9, mode="nearest")
    row_med = ndi.gaussian_filter1d(row_med, 2.0, mode="nearest")
    y0 = float(np.median(row_med[np.abs(Z) <= 60]))
    prof = row_med - y0 if not args.keep_grade else np.zeros_like(row_med)
    log("formation level y0 = %.2f m (abs); track profile over the patch: %.2f .. %.2f m relative (grade removed: %s)" % (
        y0, (row_med - y0).min(), (row_med - y0).max(), not args.keep_grade))
    def base_at(z):
        return y0 + np.interp(z, Z, prof)

    dem = dem_abs - (y0 + prof)[:, None]
    # flatten the corridor: cross-section equals the track level
    trk = row_med - (y0 + prof)                                       # 0 (grade removed) or the real profile
    w = 1.0 - smoothstep(FLAT_HALF, FLAT_HALF + 4.0, np.abs(X))
    dem = dem * (1 - w[None, :]) + trk[:, None] * w[None, :]
    dem = np.clip(dem, -40, 60)
    dem_q = np.round(dem * 10).astype("<i2")
    log("DEM relative range %.1f .. %.1f m" % (dem.min(), dem.max()))

    def dem_at(x, z):
        x = np.asarray(x, float)
        c = (x - XMIN) / DEM_RES
        r = (np.asarray(z, float) - ZMIN) / DEM_RES
        return ndi.map_coordinates(dem, [np.atleast_1d(r), np.atleast_1d(c)], order=1, mode="nearest").reshape(x.shape)

    # ---------------------------------------------------------------------------------------------------- OSM in the patch
    obb = (pb[0] - 60, pb[1] - 60, pb[2] + 60, pb[3] + 60)
    polys = read_osm("multipolygons", obb)
    lines = read_osm("lines", obb)
    points = read_osm("points", obb)
    log("OSM in patch bbox: %d polygons, %d lines, %d points" % (len(polys), len(lines), len(points)))
    clip = box(XMIN, ZMIN, XMAX, ZMAX)
    clip_pad = box(XMIN - 30, ZMIN - 30, XMAX + 30, ZMAX + 30)

    world_clip = patch_world.buffer(40)

    def fr(g, pad=False):
        """OSM geometry -> station frame, clipped (pre-clipped in the world so far-away vertices cannot fold into the patch; densified so curvature is kept)."""
        g = g.intersection(world_clip)
        if g.is_empty:
            return Polygon()
        if isinstance(g, (LineString, MultiLineString)):
            g = shapely.segmentize(g, 4.0)
        elif isinstance(g, (Polygon, MultiPolygon)):
            g = shapely.segmentize(g, 4.0)
        return geom_to_frame(g).intersection(clip_pad if pad else clip)

    # ---- rails
    rails_out, rail_geoms = [], []
    for f in lines:
        t = f["t"]
        if t.get("railway") not in ("rail", "light_rail", "narrow_gauge"):
            continue
        if t.get("tunnel") in ("yes", "building_passage") and t.get("railway") != "rail":
            continue
        g = f["g"]
        if f["id"] in chain_ids:                       # the straightened main track itself is not listed
            continue
        gf = fr(g)
        for ls in lines_of(gf):
            if ls.length < 3:
                continue
            c = np.asarray(ls.coords)
            kind = "yard" if t.get("service") == "yard" else ("siding" if t.get("service") in ("siding", "spur", "crossover") else ("main" if t.get("usage") in ("main", "branch") else "siding"))
            rail_geoms.append(ls)
            rails_out.append({"pts": c, "kind": kind, "main": int(kind == "main")})
    # ---- roads
    roads_out, carriage, footways, sidew, bridges, tracks, paths = [], [], [], [], [], [], []
    for f in lines:
        t = f["t"]
        hw = t.get("highway")
        if hw not in HW_OUT or t.get("tunnel") in ("yes", "culvert", "building_passage") or t.get("area") == "yes":
            continue
        if t.get("access") == "no" and hw in ("service", "track"):
            continue
        if hw == "footway" and t.get("footway") == "crossing" and False:
            continue
        cls = HW_OUT[hw]
        wd = road_width(t, cls)
        bridge = int(t.get("bridge") in ("yes", "viaduct", "movable", "boardwalk") or t.get("man_made") == "bridge")
        gf = fr(f["g"])
        for ls in lines_of(gf):
            if ls.length < 1.0:
                continue
            ls = ls.simplify(0.08)
            rec = {"cls": cls, "w": wd, "oneway": int(t.get("oneway") in ("yes", "1", "true") or t.get("junction") == "roundabout"),
                   "name": t.get("name") or t.get("ref") or "", "bridge": bridge, "pts": np.asarray(ls.coords), "_t": t}
            roads_out.append(rec)
            half = wd / 2
            surf = t.get("surface", "")
            if cls in ("primary", "secondary", "tertiary", "residential", "service"):
                (bridges if bridge else carriage).append(ls.buffer(half, cap_style="flat", join_style="round"))
                sw = t.get("sidewalk", t.get("sidewalk:both", ""))
                sl = t.get("sidewalk:left", sw if sw in ("left", "both", "yes") else "")
                sr = t.get("sidewalk:right", sw if sw in ("right", "both", "yes") else "")
                swd = SIDEWALK_W.get(cls, 0)
                if swd and not bridge:
                    for side_, flag in ((1, sl), (-1, sr)):
                        if flag in ("yes", "left", "right", "both", "separate") and flag != "separate":
                            try:
                                off = ls.offset_curve(-side_ * (half + swd / 2))      # frame is mirrored w.r.t. the world: world-left = negative offset
                                sidew.append(off.buffer(swd / 2, cap_style="flat"))
                            except Exception:  # noqa: BLE001
                                pass
            elif cls in ("footway", "steps"):
                if t.get("footway") == "crossing" or t.get("highway") == "crossing":
                    continue
                footways.append(ls.buffer(half, cap_style="flat"))
            elif cls == "cycleway":
                footways.append(ls.buffer(half, cap_style="flat"))
            elif cls == "track":
                (carriage if surf in PAVED else tracks).append(ls.buffer(half, cap_style="flat"))
            elif cls == "path":
                (footways if surf in PAVED else paths).append(ls.buffer(max(half, 0.6), cap_style="flat"))
    # ---- platforms
    plat_out, plat_geoms = [], []
    for f in polys + lines:
        if f["t"].get("railway") != "platform":
            continue
        g = f["g"] if not isinstance(f["g"], (LineString, MultiLineString)) else f["g"].buffer(1.5)
        for pg in polys_of(fr(fix(g))):
            if pg.area < 1:
                continue
            plat_geoms.append(pg)
            plat_out.append({"ring": np.asarray(pg.simplify(0.05).exterior.coords)})
    # ---- water
    water_out, water_polys = [], []
    for f in polys:
        t = f["t"]
        if t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("landuse") in ("reservoir", "basin"):
            for pg in polys_of(fr(fix(f["g"]))):
                if pg.area >= 4:
                    water_polys.append((pg, "pond" if pg.area < 8000 else "river"))
    for f in lines:
        t = f["t"]
        ww = t.get("waterway")
        if ww in ("river", "stream", "canal") and t.get("tunnel") not in ("yes", "culvert") and t.get("layer", "0") in ("0", "1", ""):
            wd = parse_num(t.get("width")) or {"river": 9.0, "canal": 6.0, "stream": 2.5}[ww]
            gf = fr(f["g"])
            for ls in lines_of(gf):
                if ls.length >= 2:
                    water_polys.append((ls.buffer(wd / 2, cap_style="flat"), "river"))
    # ---------------------------------------------------------------------------------------------------- buildings
    bld_osm = [f for f in polys if f["t"].get("building") and f["t"]["building"] not in ("roof",) and f["g"].area >= 3]
    roofs_osm = [f for f in polys if f["t"].get("building") == "roof"]
    lod = []
    if COUNTRY == "de":
        slugs = []
        win = (pb[0] - 40, pb[1] - 40, pb[2] + 40, pb[3] + 40)
        for tile, url in lod2_de_tiles(win).items():
            cpath = os.path.join(DE_DIR, "lod2", "tile-%s.pkl" % tile)
            if os.path.exists(cpath):
                with open(cpath, "rb") as fh:
                    got = pickle.load(fh)
            else:
                got = parse_lod2(de_download(url, "lod2"), None, ns_b="{http://www.opengis.net/citygml/building/1.0}", axis="en")
                with open(cpath, "wb") as fh:
                    pickle.dump(got, fh)
            lod += [b for b in got if win[0] <= b["c"][0] <= win[2] and win[1] <= b["c"][1] <= win[3]]
            slugs.append(tile)
        log("LoD2 tiles:", slugs, "buildings in window:", len(lod))
    else:
        slugs = args.communes.split(",") if args.communes else communes_for(patch_world, obb)
        log("communes for LOD2:", slugs)
    for sl in ([] if COUNTRY == "de" else slugs):
        cpath = os.path.join(WORK, "lod2", "%s-%s-%d_%d.pkl" % (key, sl, int(pb[0]) // 10, int(pb[1]) // 10))
        if os.path.exists(cpath):
            with open(cpath, "rb") as fh:
                got = pickle.load(fh)
        else:
            got = parse_lod2(lod2_gml(sl), (pb[0] - 40, pb[1] - 40, pb[2] + 40, pb[3] + 40))
            with open(cpath, "wb") as fh:
                pickle.dump(got, fh)
        lod += got
    # footprints (EPSG:2169)
    for b in lod:
        gp = [Polygon(r[:, :2]) for r in b["ground"] if len(r) >= 3]
        gp = [fix(p) for p in gp if p.area > 0.01] or [fix(Polygon(r[:, :2])) for r in b["roofs"] if len(r) >= 3]
        b["fp"] = unary_union(gp)
        b["gz"] = float(np.min(np.vstack(b["ground"])[:, 2])) if b["ground"] else float(np.min(np.vstack(b["walls"] or b["roofs"])[:, 2]))
    lod = [b for b in lod if not b["fp"].is_empty and b["fp"].area > 1.0]
    # LOD2 vs DTM offset
    offs = []
    for b in lod:
        bd = np.asarray(max(polys_of(b["fp"]), key=lambda p: p.area).exterior.coords)
        offs.append(b["gz"] - float(np.mean(dtm.sample(bd[:, 0], bd[:, 1]))))
    lod_off = float(np.median(offs)) if offs else 0.0
    log("LOD2 ground z - DTM: median %.2f m (p10 %.2f, p90 %.2f), n=%d" % (lod_off, np.percentile(offs, 10) if offs else 0, np.percentile(offs, 90) if offs else 0, len(offs)))
    if abs(lod_off) < 0.25:
        lod_off = 0.0
    otree = shapely.STRtree([f["g"] for f in bld_osm])

    def bkind(tag, area, h):
        m = {"house": "house", "detached": "house", "semidetached_house": "house", "terrace": "house", "residential": "house", "bungalow": "house",
             "apartments": "apartments", "dormitory": "apartments", "commercial": "commercial", "office": "commercial", "retail": "retail",
             "supermarket": "retail", "industrial": "industrial", "warehouse": "industrial", "factory": "industrial", "manufacture": "industrial",
             "garage": "garage", "garages": "garage", "carport": "garage", "shed": "shed", "hut": "shed", "cabin": "shed", "service": "shed",
             "church": "church", "chapel": "church", "cathedral": "church"}
        if tag in m:
            return m[tag]
        if tag in ("train_station", "station", "school", "public", "civic", "hospital", "kindergarten", "university", "college", "sports_hall", "transportation"):
            return "other"
        if area < 30:
            return "shed"
        if area > 1200:
            return "commercial" if h < 18 else "other"
        return "house" if area < 400 else "other"

    def roof_type(roofs_xyz):
        if not roofs_xyz:
            return "flat"
        nz_w = []
        dirs = []
        for r in roofs_xyz:
            if len(r) < 3:
                continue
            n = np.cross(r[1] - r[0], r[2] - r[0])
            for k in range(3, len(r)):
                n = n + np.cross(r[k - 1] - r[0], r[k] - r[0])
            L = np.linalg.norm(n)
            if L < 1e-6:
                continue
            n = n / L
            if n[2] < 0:
                n = -n
            ar = L / 2
            nz_w.append((n[2], ar))
            if n[2] < 0.97:
                dirs.append((math.atan2(n[1], n[0]), ar, n[2]))
        tot = sum(a for _, a in nz_w) or 1
        flat = sum(a for z_, a in nz_w if z_ > 0.97) / tot
        if flat > 0.7:
            return "flat"
        if not dirs:
            return "other"
        # cluster slope directions into 15-degree bins
        bins = {}
        for ang, ar, _ in dirs:
            k = int(round(math.degrees(ang) / 20.0)) % 18
            bins[k] = bins.get(k, 0) + ar
        big = [k for k, a in bins.items() if a > 0.15 * tot]
        if len(big) == 2:
            return "gable"
        if len(big) >= 3:
            return "hip"
        return "other"

    buildings, used_osm = [], set()
    station_poly = sbld["g"] if sbld else None
    for b in lod:
        fp = b["fp"]
        hits = otree.query(fp, predicate="intersects")
        best, bo = None, 0.0
        for i in hits:
            o = bld_osm[int(i)]
            inter = fp.intersection(o["g"]).area
            if inter / min(fp.area, o["g"].area) > 0.45 and inter > bo:
                best, bo = o, inter
        for i in hits:
            o = bld_osm[int(i)]
            if o["g"].intersection(fp).area / o["g"].area > 0.35:
                used_osm.add(int(i))
        b["osm"] = best

    def finish(ring_en):
        E, N = ring_en[:, 0], ring_en[:, 1]
        return to_xz(E, N)

    for b in lod:
        fpf = fix(geom_to_frame(shapely.segmentize(b["fp"], 6.0))) if not b["fp"].is_empty else None
        if fpf is None or fpf.is_empty or not fpf.intersects(clip):
            continue
        t = b["osm"]["t"] if b["osm"] else {}
        pgs = polys_of(fpf)
        pg = max(pgs, key=lambda p: p.area)
        ground = np.asarray(pg.simplify(0.05).exterior.coords)[:-1]
        allz = np.vstack(b["roofs"] + b["walls"] + b["ground"])
        gz = b["gz"]
        roofz = np.vstack(b["roofs"])[:, 2] if b["roofs"] else allz[:, 2]
        eave = float(roofz.min())
        centroid = pg.centroid
        base_abs = gz - lod_off
        zc = centroid.y
        yb = base_abs - float(base_at(zc))
        def conv(rings, rel=True):
            out = []
            for r in rings:
                x, z = to_xz(r[:, 0], r[:, 1])
                y = r[:, 2] - lod_off - base_at(z)
                out.append(np.c_[x, y, z])
            return out
        roofs3 = conv(b["roofs"])
        walls3 = conv(b["walls"])
        area = b["fp"].area
        height = eave - gz
        top = float(roofz.max()) - gz
        tag = t.get("building", "yes")
        attr = b.get("attr") or {}
        lv = parse_num(t.get("building:levels")) or parse_num(attr.get("storeysAboveGround")) or max(1, round(height / 3.0))
        is_station = int(bool(station_poly is not None and b["fp"].intersection(station_poly).area / min(b["fp"].area, station_poly.area) > 0.4))
        kind = bkind(tag, area, top)
        fn = attr.get("function", "")
        if tag == "yes" and fn:                                                        # ALKIS building function (RLP LoD2) where OSM has no usable tag
            if fn.startswith("31001_1"):
                kind = "house" if area < 400 else "apartments"
            elif fn.startswith("31001_2"):
                kind = "industrial" if area > 1500 else "commercial"
            elif fn.startswith("31001_3"):
                kind = "other"
            elif fn.startswith("51009") and area < 60:
                kind = "shed"
        buildings.append({"id": (b["osm"]["id"] if b["osm"] else b["gid"]), "kind": kind, "levels": int(lv), "station": is_station,
                          "roof": roof_type([r for r in (np.c_[q[:, 0], q[:, 2], q[:, 1]] for q in roofs3)]), "h": r2(max(height, 0.5)), "base": r2(yb),
                          "ground": ground, "roofs": roofs3, "walls": walls3, "_area": area, "_top": top})
    n_lod = len(buildings)
    for i, o in enumerate(bld_osm):
        if i in used_osm:
            continue
        pgf = fix(geom_to_frame(shapely.segmentize(o["g"], 6.0)))
        if pgf is None or pgf.is_empty or not pgf.intersects(clip):
            continue
        t = o["t"]
        pg = max(polys_of(pgf), key=lambda p: p.area)
        lv = parse_num(t.get("building:levels"))
        hh = parse_num(t.get("height")) or ((lv or 2) * 3.0 + 1.5)
        is_station = int(bool(station_poly is not None and o["g"].intersection(station_poly).area / o["g"].area > 0.4))
        kind = bkind(t.get("building", "yes"), o["g"].area, hh)
        yb = float(dem_at(pg.centroid.x, pg.centroid.y))
        buildings.append({"id": o["id"], "kind": kind, "levels": int(lv or max(1, round(hh / 3))), "station": is_station, "roof": "gable" if kind in ("house", "shed") else "flat",
                          "h": r2(hh - 1.5 if kind == "house" else hh), "base": r2(yb), "ground": np.asarray(pg.simplify(0.05).exterior.coords)[:-1],
                          "roofs": [], "walls": [], "_area": o["g"].area, "_top": hh})
    log("buildings: %d with LOD2 faces, %d OSM-only footprints; station-flagged %d" % (n_lod, len(buildings) - n_lod, sum(b["station"] for b in buildings)))
    if sbld and not any(b["station"] for b in buildings):
        pgf = fix(geom_to_frame(shapely.segmentize(sbld["g"], 6.0)))
        if not pgf.is_empty and pgf.intersects(clip):
            pg = max(polys_of(pgf), key=lambda p: p.area)
            buildings.append({"id": sbld["id"], "kind": "other", "levels": 2, "station": 1, "roof": "gable", "h": 5.0, "base": r2(float(dem_at(pg.centroid.x, pg.centroid.y))),
                              "ground": np.asarray(pg.exterior.coords)[:-1], "roofs": [], "walls": [], "_area": pg.area, "_top": 7.0})
    bpolys = [Polygon(b["ground"]) for b in buildings]
    bunion = unary_union([p.buffer(0) for p in bpolys]) if bpolys else Polygon()
    # ---------------------------------------------------------------------------------------------------- canopy / trees
    cs = 0.5
    cx = XMIN + cs * (np.arange(int((XMAX - XMIN) / cs)) + 0.5)
    cz = ZMIN + cs * (np.arange(int((ZMAX - ZMIN) / cs)) + 0.5)
    CX, CZ = np.meshgrid(cx, cz)
    CE, CN = to_en(CX, CZ)
    chm = np.clip(dsm.sample(CE, CN) - dtm.sample(CE, CN), 0, 45)
    def rast(geoms, res):
        im = Image.new("L", (int((XMAX - XMIN) / res), int((ZMAX - ZMIN) / res)), 0)
        d = ImageDraw.Draw(im)
        for g in geoms:
            for pg in polys_of(g):
                d.polygon([((x - XMIN) / res, (z - ZMIN) / res) for x, z in pg.exterior.coords], fill=255)
        return np.asarray(im) > 0
    excl_geoms = [bunion.buffer(1.2)]
    excl_geoms += [ls.buffer(6.5) for ls in rail_geoms] + [LineString([(0, ZMIN - 5), (0, ZMAX + 5)]).buffer(7.5)]
    excl_geoms += [b.buffer(1.0) for b in bridges] + [g for g, _ in water_polys] + plat_geoms
    excl = rast(excl_geoms, cs)
    chm_m = np.where(excl, 0, chm)
    sm = ndi.gaussian_filter(chm_m, 1.2)
    mx = ndi.maximum_filter(sm, size=7)
    lab, nl = ndi.label((sm == mx) & (sm >= 2.8))
    cents = ndi.center_of_mass(sm, lab, range(1, nl + 1)) if nl else []
    trees = []
    ang = np.linspace(0, 2 * math.pi, 16, endpoint=False)
    for (r_, c_) in cents:
        ri, ci = int(round(r_)), int(round(c_))
        peak = float(chm_m[max(0, ri - 2):ri + 3, max(0, ci - 2):ci + 3].max())
        if peak < 3.0:
            continue
        dists = []
        for a in ang:
            dd = 0.0
            for step in range(1, 22):
                rr, cc = int(round(ri + math.sin(a) * step)), int(round(ci + math.cos(a) * step))
                if not (0 <= rr < chm_m.shape[0] and 0 <= cc < chm_m.shape[1]) or chm_m[rr, cc] < 0.45 * peak:
                    break
                dd = step * cs
            dists.append(dd)
        rad = float(np.median(dists)) + 0.4
        if rad < 1.3:
            continue
        trees.append([float(cx[ci]), float(cz[ri]), peak, min(rad, 9.0)])
    trees.sort(key=lambda t_: -(t_[2] * t_[3] ** 2))
    n_tree_all = len(trees)
    trees = trees[:MAX_TREES]
    log("trees: %d candidates, %d kept" % (n_tree_all, len(trees)))
    # dense canopy mask at 1 m for forest floor
    c1 = chm.reshape(chm.shape[0] // 2, 2, chm.shape[1] // 2, 2).max(axis=(1, 3))
    ex1 = ~rast(excl_geoms, 1.0)
    can1 = (c1 > 2.5) & ex1
    dens_c = ndi.uniform_filter(can1.astype(float), size=7)
    forest_mask = ndi.binary_opening(dens_c > 0.55, iterations=1) & can1
    forest_mask = ndi.binary_dilation(forest_mask, iterations=2) & (dens_c > 0.25) & ex1
    # ---------------------------------------------------------------------------------------------------- class map
    cv = Canvas(CLS_MEADOW)
    areas = []
    for f in polys:
        c_ = landuse_class(f["t"])
        if c_ is None or f["t"].get("building"):
            continue
        for pg in polys_of(fr(fix(f["g"]))):
            areas.append((pg, c_))
    # big areas first; parking/pitch (fine surfaces) last
    areas.sort(key=lambda a: (a[1] == CLS_ASPHALT, -a[0].area))
    covered = []
    for pg, c_ in areas:
        if c_ == CLS_WATER:
            continue
        cv.poly(pg, c_)
        covered.append(pg)
    base_arr = cv.result()
    cov_mask = rast(covered, 1.0) if covered else np.zeros((640, 320), bool)
    near_b = ndi.distance_transform_edt(~rast([bunion], 1.0)) < 28
    lawn_fill = near_b & ~cov_mask
    # re-paint on the canvas at SS resolution from the 1 m masks
    ov = Image.fromarray((lawn_fill * 255).astype(np.uint8)).resize((cv.w, cv.h), Image.NEAREST)
    cv.img.paste(CLS_LAWN, (0, 0), ov)
    ov = Image.fromarray((forest_mask * 255).astype(np.uint8)).resize((cv.w, cv.h), Image.NEAREST)
    cv.img.paste(CLS_FOREST, (0, 0), ov)
    for f in lines:                                                                                                       # hedges
        if f["t"].get("barrier") == "hedge":
            for ls in lines_of(fr(f["g"])):
                cv.poly(ls.buffer(0.7), CLS_FOREST)
    for pg, c_ in areas:
        if c_ == CLS_WATER:
            cv.poly(pg, CLS_WATER)
    for g, _ in water_polys:
        cv.poly(g, CLS_WATER)
    # rail bed: all rails 2.6 m, main corridor +-4.5 m
    for ls in rail_geoms:
        cv.poly(ls.buffer(2.6, cap_style="flat"), CLS_BED)
    cv.poly(box(-CORRIDOR, ZMIN, CORRIDOR, ZMAX), CLS_BED)
    for g in tracks + paths:
        cv.poly(g, CLS_GRAVEL)
    for f in polys:
        if f["t"].get("amenity") == "parking" and not f["t"].get("building"):
            for pg in polys_of(fr(fix(f["g"]))):
                cv.poly(pg, CLS_ASPHALT)
    for g in sidew:
        cv.poly(g, CLS_PAVING)
    for g in footways:
        cv.poly(g, CLS_PAVING)
    for g in carriage:
        cv.poly(g, CLS_ASPHALT)
    for g in plat_geoms:
        cv.poly(g, CLS_PAVING)
    for g in bridges:
        cv.poly(g, CLS_ASPHALT)
    for p in bpolys:
        cv.poly(p.buffer(0), CLS_BUILDING)
    cls_arr = cv.result()
    log("class histogram:", {k: int((cls_arr == k).sum()) for k in range(9)})
    # ---------------------------------------------------------------------------------------------------- POIs
    poi = []
    for f in points:
        t = f["t"]
        kind = None
        if t.get("highway") == "bus_stop" or (t.get("public_transport") == "platform" and t.get("bus") == "yes"):
            kind = "bus_stop"
        elif t.get("amenity") == "bench" or t.get("leisure") == "picnic_table":
            kind = "bench"
        elif t.get("amenity") in ("waste_basket", "waste_disposal"):
            kind = "bin"
        elif t.get("amenity") == "bicycle_parking":
            kind = "bike_parking"
        elif t.get("highway") == "street_lamp":
            kind = "lamp"
        elif t.get("amenity") == "shelter":
            kind = "shelter"
        elif t.get("amenity") == "vending_machine" and "ticket" in t.get("vending", ""):
            kind = "ticket"
        elif t.get("amenity") == "parking":
            kind = "parking"
        elif t.get("natural") == "tree":
            kind = "tree"
        if kind is None:
            continue
        x, z = to_xz(f["g"].x, f["g"].y)
        if XMIN <= x <= XMAX and ZMIN <= z <= ZMAX:
            if kind == "tree" and any(math.hypot(x - t_[0], z - t_[1]) < 3 for t_ in trees):
                continue
            poi.append({"t": kind, "x": float(x), "z": float(z)})
        if kind == "bus_stop" and t.get("shelter") == "yes" and XMIN <= x <= XMAX and ZMIN <= z <= ZMAX:
            poi.append({"t": "shelter", "x": float(x) + 0.0, "z": float(z) + 0.0})
    for f in polys:
        t = f["t"]
        kind = "parking" if t.get("amenity") == "parking" and not t.get("building") else ("bike_parking" if t.get("amenity") == "bicycle_parking" else (
            "shelter" if t.get("amenity") == "shelter" or t.get("building") == "roof" else None))
        if kind is None:
            continue
        c = f["g"].centroid
        x, z = to_xz(c.x, c.y)
        if XMIN <= x <= XMAX and ZMIN <= z <= ZMAX:
            poi.append({"t": kind, "x": float(x), "z": float(z)})
    for p in poi:
        p["y"] = float(dem_at(p["x"], p["z"]))
    # ---------------------------------------------------------------------------------------------------- road / rail / water heights
    def ypts(c, bridge=False):
        y = dem_at(c[:, 0], c[:, 1])
        if bridge and len(c) >= 2:
            E, N = to_en(c[:, 0], c[:, 1])
            top = dsm.sample(E, N) - base_at(c[:, 1])
            top = ndi.median_filter(top, size=min(len(top), 5), mode="nearest")
            y = np.maximum(y, np.minimum(top, y + 12.0))
        return y

    out_roads = []
    for r in roads_out:
        c = r["pts"]
        y = ypts(c, bool(r["bridge"]))
        out_roads.append({"cls": r["cls"], "w": r2(r["w"]), "oneway": r["oneway"], "name": r["name"], "bridge": r["bridge"],
                          "pts": [[r2(a), r2(b), r2(d)] for (a, b), d in zip(c, y)]})
    out_rails = []
    for r in rails_out:
        c = r["pts"]
        y = dem_at(c[:, 0], c[:, 1])
        out_rails.append({"pts": [[r2(a), r2(b), r2(d)] for (a, b), d in zip(c, y)], "kind": r["kind"], "main": r["main"]})
    # water polygons with surface y: DTM at the polygon (river pieces split to <= 60 m so the surface follows the gradient)
    for g, kind in water_polys:
        pieces = [g]
        if kind == "river" and g.bounds[3] - g.bounds[1] > 80:
            z0_ = g.bounds[1]
            pieces = [g.intersection(box(XMIN - 5, a, XMAX + 5, a + 60)) for a in np.arange(z0_, g.bounds[3], 60.0)]
        for pc in pieces:
            for pg in polys_of(pc):
                if pg.area < 3:
                    continue
                c = np.asarray(pg.exterior.coords)
                ys = dem_at(c[:, 0], c[:, 1])
                inner = pg.representative_point()
                y = float(np.percentile(np.r_[ys, float(dem_at(inner.x, inner.y))], 25))
                rg = clean_ring(np.asarray(pg.simplify(0.1).exterior.coords))
                if rg:
                    water_out.append({"ring": rg, "y": r2(y), "kind": kind})
    # track profile (removed from the heights; the game may re-add it)
    zs_ = np.arange(ZMIN, ZMAX + 1, 20.0)
    track_y = [[r2(z), r2(float(np.interp(z, Z, row_med - y0)))] for z in zs_]
    # ---------------------------------------------------------------------------------------------------- assemble
    def bld_json(b):
        return {"id": str(b["id"]), "kind": b["kind"], "levels": b["levels"], "station": b["station"], "roof": b["roof"], "h": b["h"], "base": b["base"],
                "ground": clean_ring(b["ground"]),
                "roofs": [r for r in (clean_ring(q) for q in b["roofs"]) if r],
                "walls": [r for r in (clean_ring(q) for q in b["walls"]) if r]}

    png = io.BytesIO()
    Image.fromarray((cls_arr * 16).astype(np.uint8)).save(png, format="PNG", optimize=True)
    b64 = lambda b: base64.b64encode(b).decode("ascii")                                  # noqa: E731
    patch = {
        "v": 1, "key": key, "name": name,
        "origin": dict({"lat": round(lat, 7), "lon": round(lon, 7), "headingDeg": round(heading, 2)},
                       **({"epsg25832": [round(oE, 2), round(oN, 2)]} if COUNTRY == "de" else {"epsg2169": [round(oE, 2), round(oN, 2)]})),
        "side": side, "extent": {"x": [XMIN, XMAX], "z": [ZMIN, ZMAX]},
        "dem": {"res": 2, "nx": nx, "nz": nz, "x0": XMIN, "z0": ZMIN, "dm": b64(dem_q.astype("<i2").tobytes())},
        "classes": {"res": 1, "nx": int(XMAX - XMIN), "nz": int(ZMAX - ZMIN), "x0": XMIN, "z0": ZMIN, "png": b64(png.getvalue())},
        "roads": out_roads, "rails": out_rails,
        "platforms": [{"ring": clean_ring(p["ring"])} for p in plat_out if clean_ring(p["ring"])],
        "water": water_out, "buildings": [bld_json(b) for b in buildings if clean_ring(b["ground"])],
        "trees": [[r2(a), r2(b), r2(c), r2(d)] for a, b, c, d in trees],
        "poi": [{"t": p["t"], "x": r2(p["x"]), "z": r2(p["z"]), "y": r2(p["y"])} for p in poi],
        "trackY": track_y,
    }
    if CREDIT:
        patch["credit"] = CREDIT
    text = json.dumps(patch, separators=(",", ":"), ensure_ascii=False)
    out_path = args.out or os.path.join(OUT_DIR, key + ".json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as fh:
        fh.write(text)
    idx_path = os.path.join(os.path.dirname(out_path), "index.json")
    import fcntl
    with open(os.path.join(WORK, "index.lock"), "w") as lock:                          # several builds may run in parallel: serialise the read-modify-write
        fcntl.flock(lock, fcntl.LOCK_EX)
        idx = {"v": 1, "stations": {}}
        if os.path.exists(idx_path):
            try:
                with open(idx_path) as fh:
                    idx = json.load(fh)
            except Exception:  # noqa: BLE001
                log("WARNING: could not read existing index.json, rewriting")
        idx.setdefault("stations", {})[name] = key
        idx["v"] = 1
        with open(idx_path, "w") as fh:
            json.dump(idx, fh, ensure_ascii=False, separators=(",", ":"))
    log("wrote %s (%.0f kB), index %s" % (out_path, len(text) / 1024, idx_path))
    summary = {"size_kB": round(len(text) / 1024), "buildings": len(buildings), "trees": len(trees), "roads": len(out_roads), "rails": len(out_rails),
               "water": len(water_out), "platforms": len(plat_out), "poi": len(poi), "dem_min": float(dem.min()), "dem_max": float(dem.max()),
               "side": side, "headingDeg": round(heading, 2), "origin": [round(lat, 6), round(lon, 6)], "y0_abs": round(y0, 2)}
    print(json.dumps(summary))
    if args.debug_png:
        debug_png(args.debug_png, cls_arr, patch, dem, buildings, trees, out_roads, out_rails, plat_out, water_out, poi, name, side, heading)
    return patch


def debug_png(path, cls_arr, patch, dem, buildings, trees, roads, rails, plats, waters, poi, name, side, heading):
    """1280x640 top-down view: travel direction to the right (u increases to the right), right-of-travel downwards, 2 px / m."""
    S = 2
    W, H = int((ZMAX - ZMIN) * S), int((XMAX - XMIN) * S)

    def P(x, z):
        return ((-z - ZMIN) * S, (x - XMIN) * S)               # screen x = -z (travel direction), screen y = x
    rgb = np.array(CLASS_RGB, np.uint8)[cls_arr]                # (nz, nx, 3): rows z, cols x
    img = Image.fromarray(np.ascontiguousarray(np.transpose(rgb[::-1], (1, 0, 2))))    # rows x, cols -z
    img = img.resize((W, H), Image.NEAREST)
    d = ImageDraw.Draw(img, "RGBA")
    for r in roads:
        pts = [P(a, b) for a, b, _ in r["pts"]]
        if len(pts) > 1:
            d.line(pts, fill=(255, 235, 120, 255) if r["cls"] in ("primary", "secondary", "tertiary", "residential", "service") else (255, 140, 40, 255), width=1)
    for r in rails:
        pts = [P(a, b) for a, b, _ in r["pts"]]
        if len(pts) > 1:
            d.line(pts, fill=(30, 30, 30, 255), width=1)
    for p in plats:
        d.polygon([P(a, b) for a, b in p["ring"]], outline=(255, 255, 255, 255))
    for w in waters:
        d.polygon([P(a, b) for a, b in w["ring"]], outline=(255, 255, 255, 255))
    for b in buildings:
        col = (255, 40, 200, 255) if b["station"] else (255, 255, 255, 255)
        d.polygon([P(a, c) for a, c in b["ground"]], outline=col)
        if b["station"]:
            d.polygon([P(a, c) for a, c in b["ground"]], fill=(255, 40, 200, 90))
    for x, z, h, r in trees:
        px, py = P(x, z)
        g = int(60 + min(h, 30) * 4)
        d.ellipse([px - r * S, py - r * S, px + r * S, py + r * S], outline=(0, g, 0, 255))
    pc = {"bus_stop": (0, 200, 255), "bench": (255, 160, 0), "bin": (120, 120, 120), "bike_parking": (0, 255, 160), "lamp": (255, 255, 0), "parking": (160, 160, 255),
          "shelter": (255, 0, 0), "ticket": (255, 0, 255), "tree": (0, 255, 0)}
    for p in poi:
        px, py = P(p["x"], p["z"])
        d.rectangle([px - 2, py - 2, px + 2, py + 2], fill=pc.get(p["t"], (255, 255, 255)) + (255,))
    d.line([P(0, ZMIN), P(0, ZMAX)], fill=(255, 0, 0, 255), width=1)       # track axis
    ox, oy = P(0, 0)
    d.line([ox, oy - 12, ox, oy + 12], fill=(255, 0, 0, 255), width=2)
    d.line([ox - 12, oy, ox + 12, oy], fill=(255, 0, 0, 255), width=2)
    for k in range(-300, 301, 100):
        px, py = P(0, k)
        d.line([px, 0, px, 6], fill=(0, 0, 0, 255))
        d.text((px + 2, 8), "z=%d" % k, fill=(0, 0, 0, 255))
    d.text((6, H - 14), "%s  side=%s  heading=%.0f  travel ->  (right of travel = down)" % (name, side, heading), fill=(0, 0, 0, 255))
    img.save(path)
    # shaded DEM next to it
    gy, gx = np.gradient(dem, DEM_RES)
    shade = np.clip(0.5 + 0.8 * (gx * 0.6 + gy * 0.8), 0, 1)
    rel = (dem - dem.min()) / max(dem.max() - dem.min(), 1e-6)
    v = (60 + 150 * shade * 0.6 + 100 * rel * 0.4).clip(0, 255).astype(np.uint8)
    im2 = Image.fromarray(np.ascontiguousarray(np.transpose(v[::-1], (1, 0)))).resize((W, H), Image.BILINEAR)
    im2.save(path.replace(".png", "-dem.png"))
    log("debug PNG", path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("key")
    ap.add_argument("--name")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--heading-hint", default=None, help="direction of travel: east|north|... or compass degrees (default: keep OSM way direction)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--debug-png", default=None)
    ap.add_argument("--communes", default=None, help="comma separated LOD2 commune slugs (default: from OSM admin boundaries)")
    ap.add_argument("--keep-grade", action="store_true", help="keep the track gradient in the heights instead of levelling the track at y=0")
    ap.add_argument("--country", default="lu", choices=("lu", "de"), help="lu = Luxembourg (default: EPSG:2169, lux.osm.pbf, LiDAR + LOD2); de = Rheinland-Pfalz (EPSG:25832, rlp.osm.pbf, GeoBasis-RLP DGM1 / DOM1 / LoD2)")
    args = ap.parse_args()
    set_country(args.country)
    build(args)


if __name__ == "__main__":
    main()
