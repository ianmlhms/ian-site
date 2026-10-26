#!/usr/bin/env python3
"""Station patch (real surroundings) for a station abroad (France / Belgium: no LiDAR / LOD2 there, unlike Luxembourg).

Format: scripts/zuch/STATION-PATCH-FORMAT.md (same schema the Luxembourg patches use, so station-surround*.js render it with no code change beyond the
facade/region bias in station-surround-mesh.js).  Sources: OSM (scripts/zuch/fetch_osm_bbox.py cache, the official OSM API, ODbL) for buildings / streets /
water / parks, Copernicus GLO-30 (30 m, open) for relief.  No orthophoto anywhere.

    python3 scripts/zuch/build_abroad_station_patch.py <key> <name> <lat> <lon> <headingDeg> <left|right> <fr|be>

Differences from build_station_patch.py (Luxembourg): the station frame is a straight projection (equirectangular around the station, rotated by the
given heading) instead of a curvilinear fit to the chained OSM rail way -- these stations do not need the real rail geometry chained here (the route's
own track and its grade already come from data/real/<routeId>-layout.json; this patch only supplies the LATERAL relief and the surrounding town, so the
longitudinal profile baked into the DEM is removed, like build_station_patch.py's "profile(z)" but never added back, matching what the runtime does for
the Luxembourg patches).  Buildings carry no LOD2 faces (OSM footprint + a height only): `extrudeFaceless: true`, like the Rheinland-Pfalz patches.
Honest gaps (no fake data): no `rails` (the other tracks of the station throat are not chained here), no `platforms` (already solved, in real
layout json, out of scope for this patch), no `trees` canopy (no LiDAR abroad; isolated OSM `natural=tree` nodes become `poi` instead).
"""
import argparse
import base64
import io
import json
import math
import os
import sys
import time

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

T0 = time.time()
WORK = os.environ.get("ZUCH_ABROAD_WORK", os.path.expanduser("~/zuch-work/abroad-osm"))
DEM_DIR = os.environ.get("ZUCH_DEM_DIR", os.path.expanduser("~/zuch-work/dem"))
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(REPO, "pb", "train-sim", "data", "stations")
CREDIT = "Geodata (c) OpenStreetMap contributors (ODbL, openstreetmap.org/copyright) - relief Copernicus GLO-30 DEM (c) ESA / Copernicus 2021"

XMIN, XMAX, ZMIN, ZMAX = -160.0, 160.0, -320.0, 320.0
DEM_RES = 2.0
CLS_RES = 1.0
SS = 4                     # class raster supersampling (painter's algorithm, like build_station_patch.py)
CORRIDOR = 4.5             # rail bed half width of a railway way
FLAT_HALF = 5.0            # dem flattened (longitudinal baseline removed exactly) within +-this many metres of the track
FLAT_BLEND = 9.0
FORECOURT_R = 55.0         # paved disc around the origin (the platform / building polygon is a separate dataset, out of scope here: the origin point stands in for it)
MAX_BUILDINGS = 380
MAX_TREE_POI = 220

CLS_ASPHALT, CLS_PAVING, CLS_LAWN, CLS_MEADOW, CLS_FOREST, CLS_GRAVEL, CLS_WATER, CLS_BUILDING, CLS_BED = range(9)

HW_OUT = {"motorway": "primary", "motorway_link": "primary", "trunk": "primary", "trunk_link": "primary", "primary": "primary",
          "primary_link": "primary", "secondary": "secondary", "secondary_link": "secondary", "tertiary": "tertiary",
          "tertiary_link": "tertiary", "unclassified": "residential", "residential": "residential", "living_street": "residential",
          "service": "service", "track": "track", "path": "path", "bridleway": "path", "footway": "footway", "pedestrian": "footway",
          "cycleway": "cycleway", "steps": "steps"}
ROAD_W = {"primary": 7.0, "secondary": 6.4, "tertiary": 6.0, "residential": 5.2, "service": 3.4, "track": 3.0, "path": 1.2, "footway": 1.8,
          "cycleway": 2.2, "steps": 2.0}

BUILDING_KIND = {
    "house": "house", "detached": "house", "semidetached_house": "house", "terrace": "house", "bungalow": "house", "cabin": "house",
    "apartments": "apartments", "residential": "apartments", "dormitory": "apartments",
    "commercial": "commercial", "office": "commercial", "civic": "other", "public": "other", "government": "other",
    "retail": "retail", "shop": "retail", "kiosk": "retail", "supermarket": "retail",
    "industrial": "industrial", "warehouse": "industrial", "manufacture": "industrial",
    "garage": "garage", "garages": "garage", "parking": "garage",
    "shed": "shed", "hut": "shed", "service": "shed", "construction": "shed",
    "church": "church", "cathedral": "church", "chapel": "church", "religious": "church", "mosque": "church", "temple": "church",
}
# default eave height (m) and level count when the tags give neither height nor levels, per task brief: shop ~4m single floor, residential ~3.2m/floor,
# a public building (mairie / hotel de ville) taller.
DEFAULT_H = {"house": (2, 3.2), "apartments": (4, 3.2), "commercial": (2, 3.6), "retail": (1, 4.0), "industrial": (1, 6.5),
             "garage": (1, 3.0), "shed": (1, 2.8), "church": (1, 11.0), "other": (3, 3.9)}
ROOF_OF = {"house": "gable", "church": "gable", "apartments": "flat", "commercial": "flat", "retail": "flat", "industrial": "flat",
           "garage": "flat", "shed": "flat", "other": "hip"}


def log(*a):
    print("[%6.1fs]" % (time.time() - T0), *a, flush=True)


def r2(v):
    return round(float(v), 2)


# ---------------------------------------------------------------------------------------------------------------------- frame
class Frame:
    """Straight station frame: equirectangular metres around (lat0, lon0), rotated so +z is the direction of travel reversed (x = lateral, right of
    travel; z = -(distance travelled), matching STATION-PATCH-FORMAT.md).  No curvature: the real route's own curvature / grade are supplied by the
    game's track, not this patch (see module docstring)."""

    def __init__(self, lat0, lon0, heading_deg):
        self.lat0, self.lon0 = lat0, lon0
        h = math.radians(heading_deg)
        self.fe, self.fn = math.sin(h), math.cos(h)     # forward (east, north)
        self.re, self.rn = math.cos(h), -math.sin(h)    # right of travel (east, north)
        self.mlat = 110540.0
        self.mlon = 111320.0 * math.cos(math.radians(lat0))

    def fwd(self, lat, lon):
        dx = (lon - self.lon0) * self.mlon
        dy = (lat - self.lat0) * self.mlat
        u = dx * self.fe + dy * self.fn
        v = dx * self.re + dy * self.rn
        return v, -u                     # x, z

    def inv(self, x, z):
        u, v = -z, x
        dx = u * self.fe + v * self.re
        dy = u * self.fn + v * self.rn
        return self.lat0 + dy / self.mlat, self.lon0 + dx / self.mlon

    def fwd_arr(self, latlon):
        lat = np.asarray([p[0] for p in latlon]); lon = np.asarray([p[1] for p in latlon])
        dx = (lon - self.lon0) * self.mlon
        dy = (lat - self.lat0) * self.mlat
        u = dx * self.fe + dy * self.fn
        v = dx * self.re + dy * self.rn
        return np.c_[v, -u]


# ---------------------------------------------------------------------------------------------------------------------- DEM (Copernicus GLO-30, WGS84 tiles)
class Dem:
    def __init__(self):
        self.ds = {}

    def _open(self, ilat, ilon):
        key = (ilat, ilon)
        if key not in self.ds:
            ns = "N%02d" % ilat if ilat >= 0 else "S%02d" % -ilat
            ew = "E%03d" % ilon if ilon >= 0 else "W%03d" % -ilon
            path = os.path.join(DEM_DIR, "Copernicus_DSM_COG_10_%s_00_%s_00_DEM.tif" % (ns, ew))
            ds = rasterio.open(path)
            self.ds[key] = (ds, ds.read(1).astype(np.float32))
        return self.ds[key]

    def height(self, lat, lon):
        ilat, ilon = int(math.floor(lat)), int(math.floor(lon))
        ds, arr = self._open(ilat, ilon)
        col = (lon - ds.transform.c) / ds.transform.a - 0.5
        row = (lat - ds.transform.f) / ds.transform.e - 0.5
        c0, r0 = int(math.floor(col)), int(math.floor(row))
        fc, fr = col - c0, row - r0
        c0 = min(max(c0, 0), arr.shape[1] - 2); r0 = min(max(r0, 0), arr.shape[0] - 2)
        return float(arr[r0, c0] * (1 - fc) * (1 - fr) + arr[r0, c0 + 1] * fc * (1 - fr)
                     + arr[r0 + 1, c0] * (1 - fc) * fr + arr[r0 + 1, c0 + 1] * fc * fr)

    def height_many(self, lats, lons):
        return np.array([self.height(a, b) for a, b in zip(lats, lons)])


# ---------------------------------------------------------------------------------------------------------------------- OSM helpers
def load_osm(key):
    with open(os.path.join(WORK, key + ".json")) as fh:
        return json.load(fh)


def building_default_height(tags):
    bkind = BUILDING_KIND.get(tags.get("building"), None)
    if bkind is None:
        if tags.get("amenity") in ("townhall", "public_building") or tags.get("office") == "government":
            bkind = "other"
        elif tags.get("shop") or tags.get("amenity") in ("supermarket",):
            bkind = "retail"
        else:
            bkind = "house"
    levels_tag = tags.get("building:levels")
    height_tag = tags.get("height")
    def_levels, def_h_per_level = DEFAULT_H[bkind]
    if height_tag:
        try:
            h = float("".join(c for c in height_tag if c.isdigit() or c == "."))
            levels = max(1, round(h / def_h_per_level))
            return bkind, max(2.2, h), levels
        except ValueError:
            pass
    if levels_tag:
        try:
            levels = max(1, int(float(levels_tag)))
            return bkind, levels * def_h_per_level, levels
        except ValueError:
            pass
    return bkind, def_levels * def_h_per_level, def_levels


def classify_background(tags):
    landuse = tags.get("landuse"); natural = tags.get("natural"); leisure = tags.get("leisure")
    if natural in ("wood",) or landuse == "forest":
        return CLS_FOREST
    if landuse in ("farmland", "meadow", "orchard", "vineyard", "farmyard") or natural == "scrub":
        return CLS_MEADOW
    if natural == "grassland" or landuse == "grass" or leisure in ("park", "garden", "pitch", "playground") or landuse in ("cemetery", "village_green", "recreation_ground"):
        return CLS_LAWN
    if landuse in ("residential", "commercial", "retail", "industrial", "institutional", "railway"):
        return CLS_LAWN            # build_station_patch.py also paints these as lawn by default (patch_pave_forecourts.py then paves what is near the station)
    return None


# ---------------------------------------------------------------------------------------------------------------------- class raster
class Canvas:
    """Supersampled painter's-algorithm class raster, like build_station_patch.py's Canvas (x right, z down), 1 m / px final."""

    def __init__(self, base):
        self.w, self.h = int((XMAX - XMIN) * SS), int((ZMAX - ZMIN) * SS)
        self.img = Image.new("L", (self.w, self.h), base)
        self.d = ImageDraw.Draw(self.img)

    def px(self, pts):
        return [((x - XMIN) * SS, (z - ZMIN) * SS) for x, z in pts]

    def poly(self, ring, cls):
        pts = self.px(ring)
        if len(pts) >= 3:
            self.d.polygon(pts, fill=cls)

    def line(self, pts, width_m, cls):
        w = max(1, int(round(width_m * SS)))
        self.d.line(self.px(pts), fill=cls, width=w, joint="curve")

    def result(self):
        a = np.asarray(self.img).reshape(int(ZMAX - ZMIN), SS, int(XMAX - XMIN), SS)
        cnt = np.stack([(a == k).sum(axis=(1, 3)) for k in range(10)], axis=-1)
        return cnt.argmax(-1).astype(np.uint8)


def ring_of_way(frame, way):
    pts = frame.fwd_arr(way["nodes"])
    return pts


def in_extent(pts, mx=190, mz=350):
    return np.any((np.abs(pts[:, 0]) <= mx) & (np.abs(pts[:, 1]) <= mz))


PATCH_BOX = box(XMIN, ZMIN, XMAX, ZMAX)
LINE_BOX = box(XMIN - 2, ZMIN - 2, XMAX + 2, ZMAX + 2)   # a touch wider so a line ending exactly on the edge is not chopped mid-pixel


def clip_line_runs(pts):
    """A road polyline clipped to the patch box: one or more runs of >= 2 points (a way that leaves and re-enters the patch becomes several runs,
    never a long chord jumping across the gap)."""
    try:
        clipped = LineString([tuple(p) for p in pts]).intersection(LINE_BOX)
    except Exception:  # noqa: BLE001  a self-intersecting way after projection is skipped, not invented
        return []
    if clipped.is_empty:
        return []
    geoms = list(clipped.geoms) if clipped.geom_type.startswith("Multi") else [clipped]
    return [list(g.coords) for g in geoms if g.geom_type == "LineString" and len(g.coords) >= 2]


def clip_polygon_rings(ring_pts, buf=0.0):
    """A closed ring (or a buffered line) clipped to the patch box; returns a list of exterior rings (a shape straddling the edge may clip into
    several pieces, each emitted on its own -- never a ring that reaches thousands of metres outside the patch)."""
    try:
        geom = Polygon([tuple(p) for p in ring_pts]) if buf <= 0 else LineString([tuple(p) for p in ring_pts]).buffer(buf)
        geom = geom.intersection(PATCH_BOX)
    except Exception:  # noqa: BLE001
        return []
    if geom.is_empty:
        return []
    polys = list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]
    out = []
    for p in polys:
        if p.geom_type == "Polygon" and p.area > 1.0:
            out.append(list(p.exterior.coords)[:-1])
    return out


# ---------------------------------------------------------------------------------------------------------------------- build
def build(key, name, lat, lon, heading, side, region, radius):
    osm = load_osm(key)
    frame = Frame(lat, lon, heading)
    dem = Dem()

    # ---- relief: absolute elevation grid, then the longitudinal baseline (median within the +-FLAT_HALF corridor at each z) removed, matching what
    # the Luxembourg pipeline does so the patch supplies only the LATERAL relief (the real route's own along-track grade is already in the game's track).
    nx = int((XMAX - XMIN) / DEM_RES) + 1
    nz = int((ZMAX - ZMIN) / DEM_RES) + 1
    xs = np.linspace(XMIN, XMAX, nx)
    zs = np.linspace(ZMIN, ZMAX, nz)
    elev = np.zeros((nz, nx), dtype=np.float64)
    for iz, z in enumerate(zs):
        for ix, x in enumerate(xs):
            la, lo = frame.inv(x, z)
            elev[iz, ix] = dem.height(la, lo)
    corridor = np.abs(xs) <= FLAT_HALF
    baseline_raw = np.median(elev[:, corridor], axis=1)
    # smooth the baseline a little (30 m DEM posts are noisy over a 2 m grid)
    k = np.ones(5) / 5.0
    padded = np.pad(baseline_raw, 2, mode="edge")
    baseline = np.convolve(padded, k, mode="valid")
    rel = elev - baseline[:, None]
    # flatten exactly to 0 within FLAT_HALF, blended out to FLAT_BLEND
    t = np.clip((np.abs(xs) - FLAT_HALF) / (FLAT_BLEND - FLAT_HALF), 0, 1)
    w = t * t * (3 - 2 * t)
    rel = rel * w[None, :]
    dem_q = np.clip(np.round(rel * 10), -32000, 32000).astype(np.int16)

    def relief_at(x, z):
        ix = min(max(int(round((x - XMIN) / DEM_RES)), 0), nx - 1)
        iz = min(max(int(round((z - ZMIN) / DEM_RES)), 0), nz - 1)
        return float(rel[iz, ix])

    # ---- buildings
    buildings = []
    for w_ in osm["ways"]:
        tags = w_["tags"]
        if "building" not in tags and "building:part" not in tags:
            continue
        if tags.get("building") == "roof" or tags.get("layer") == "-1":
            continue
        pts = ring_of_way(frame, w_)
        if len(pts) < 4 or not in_extent(pts, 165, 325):
            continue
        ring = pts[:-1] if np.allclose(pts[0], pts[-1]) else pts
        if len(ring) < 3:
            continue
        area = 0.0
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            area += a[0] * b[1] - b[0] * a[1]
        area = abs(area) / 2
        if area < 6:
            continue
        kind, h, levels = building_default_height(tags)
        cx, cz = float(ring[:, 0].mean()), float(ring[:, 1].mean())
        base = relief_at(cx, cz)
        buildings.append({"id": "w" + w_["id"], "kind": kind, "levels": levels, "station": 0, "roof": ROOF_OF.get(kind, "flat"),
                           "h": r2(h), "base": r2(base), "ground": [[r2(p[0]), r2(p[1])] for p in ring], "roofs": [], "walls": [],
                           "_d2": cx * cx + cz * cz})
    buildings.sort(key=lambda b: b["_d2"])
    buildings = buildings[:MAX_BUILDINGS]
    for b in buildings:
        del b["_d2"]

    # ---- roads
    roads = []
    for w_ in osm["ways"]:
        tags = w_["tags"]
        hw = tags.get("highway")
        if not hw or hw not in HW_OUT:
            continue
        pts = ring_of_way(frame, w_)
        if not in_extent(pts, 175, 335):
            continue
        cls = HW_OUT[hw]
        for run in clip_line_runs(pts):
            pts_list = [[r2(p[0]), r2(p[1]), r2(relief_at(p[0], p[1]))] for p in run]
            if len(pts_list) < 2:
                continue
            roads.append({"cls": cls, "w": ROAD_W[cls], "oneway": 1 if tags.get("oneway") == "yes" else 0, "name": tags.get("name", ""),
                           "bridge": 1 if tags.get("bridge") else 0, "pts": pts_list})

    # ---- water (ponds / lakes as rings, rivers as buffered centre lines)
    water = []
    for w_ in osm["ways"]:
        tags = w_["tags"]
        is_water_poly = tags.get("natural") == "water" or tags.get("landuse") == "reservoir"
        is_river = tags.get("waterway") in ("river", "canal", "stream")
        if not is_water_poly and not is_river:
            continue
        pts = ring_of_way(frame, w_)
        if not in_extent(pts, 170, 330):
            continue
        cx, cz = float(np.clip(pts[:, 0].mean(), XMIN, XMAX)), float(np.clip(pts[:, 1].mean(), ZMIN, ZMAX))
        y = relief_at(cx, cz) - 0.3
        if is_water_poly and w_["closed"]:
            for ring in clip_polygon_rings(pts[:-1]):
                water.append({"ring": [[r2(p[0]), r2(p[1])] for p in ring], "y": r2(y), "kind": "pond"})
        else:
            for ring in clip_polygon_rings(pts, buf=7.0 if tags.get("waterway") == "river" else 4.0):
                water.append({"ring": [[r2(p[0]), r2(p[1])] for p in ring], "y": r2(y), "kind": "river"})

    # ---- tree poi (no LiDAR canopy abroad: isolated OSM natural=tree nodes only, never a synthetic forest)
    poi = []
    for n in osm["nodes"]:
        if n["tags"].get("natural") != "tree":
            continue
        x, z = frame.fwd(n["lat"], n["lon"])
        if abs(x) <= 158 and abs(z) <= 318:
            poi.append({"t": "tree", "x": r2(x), "z": r2(z), "y": r2(relief_at(x, z))})
    poi = poi[:MAX_TREE_POI]

    # ---- ground class raster
    canvas = Canvas(CLS_LAWN)
    # background landuse / natural polygons (painted first, lowest priority)
    for w_ in osm["ways"]:
        if not w_["closed"] or len(w_["nodes"]) < 4:
            continue
        cls = classify_background(w_["tags"])
        if cls is None:
            continue
        pts = ring_of_way(frame, w_)
        if not in_extent(pts):
            continue
        for ring in clip_polygon_rings(pts[:-1]):
            canvas.poly(ring, cls)
    # water over everything so far
    for wd in water:
        canvas.poly(wd["ring"], CLS_WATER)
    # roads: carriageway asphalt / paved paths as paving, tracks as gravel
    for rd in roads:
        cls = CLS_GRAVEL if rd["cls"] in ("track", "path") else (CLS_PAVING if rd["cls"] in ("footway", "cycleway", "steps") else CLS_ASPHALT)
        canvas.line([(p[0], p[1]) for p in rd["pts"]], rd["w"], cls)
    # building footprints
    for b in buildings:
        canvas.poly(b["ground"], CLS_BUILDING)
    # the forecourt: a paved disc around the origin stands in for the platform / station-building polygon (a separate, already-solved dataset; see
    # module docstring), only where it would otherwise be lawn / meadow (never over water, forest or a building)
    cls_arr = canvas.result()
    yy, xx = np.mgrid[0:cls_arr.shape[0], 0:cls_arr.shape[1]]
    xm = XMIN + (xx + 0.5) * CLS_RES
    zm = ZMIN + (yy + 0.5) * CLS_RES
    near = (xm * xm + zm * zm) <= (FORECOURT_R * FORECOURT_R)
    pave = near & ((cls_arr == CLS_LAWN) | (cls_arr == CLS_MEADOW))
    cls_arr[pave] = CLS_PAVING

    png_buf = io.BytesIO()
    Image.fromarray((cls_arr * 16).astype(np.uint8)).save(png_buf, format="PNG", optimize=True)
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731

    patch = {
        "v": 1, "key": key, "name": name,
        "origin": {"lat": round(lat, 7), "lon": round(lon, 7), "headingDeg": round(heading, 2)},
        "side": side, "region": region,
        "extent": {"x": [XMIN, XMAX], "z": [ZMIN, ZMAX]},
        "dem": {"res": DEM_RES, "nx": nx, "nz": nz, "x0": XMIN, "z0": ZMIN, "dm": b64(dem_q.tobytes())},
        "classes": {"res": CLS_RES, "nx": int(XMAX - XMIN), "nz": int(ZMAX - ZMIN), "x0": XMIN, "z0": ZMIN, "png": b64(png_buf.getvalue())},
        "roads": roads, "rails": [], "platforms": [], "water": water, "buildings": buildings, "trees": [], "poi": poi,
        "credit": CREDIT, "extrudeFaceless": True,
    }
    text = json.dumps(patch, separators=(",", ":"), ensure_ascii=False)
    out_path = os.path.join(OUT_DIR, key + ".json")
    with open(out_path, "w") as fh:
        fh.write(text)
    log("wrote %s (%.0f kB): %d buildings, %d roads, %d water, %d tree poi" % (out_path, len(text) / 1024, len(buildings), len(roads), len(water), len(poi)))
    return patch


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("key"); ap.add_argument("name"); ap.add_argument("lat", type=float); ap.add_argument("lon", type=float)
    ap.add_argument("headingDeg", type=float); ap.add_argument("side", choices=("left", "right")); ap.add_argument("region", choices=("fr", "be"))
    ap.add_argument("--radius", type=float, default=450.0, help="informational only (the OSM fetch box radius used); the patch extent itself is fixed "
                                                                 "at x[-160,160] z[-320,320] like every station patch (station-surround.js EXT_X/EXT_Z)")
    args = ap.parse_args()
    build(args.key, args.name, args.lat, args.lon, args.headingDeg, args.side, args.region, args.radius)


if __name__ == "__main__":
    main()
