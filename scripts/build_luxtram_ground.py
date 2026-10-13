#!/usr/bin/env python3
"""Build the painted ground of the Luxtram world (no photograph is read, shipped or shown).

  /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/build_luxtram_ground.py [tiles] [far] [debug] [<i>_<j> ...]

Reads   raw OSM (road_/land_/ground_/bld_/poi_/tram_ways), the LiDAR DTM / DSM (luxtram-work/geo/h, far/h_*): canopy stands from the nDSM, nothing from colour;
        context defaults from the building density (dense blocks = paving, open land = lawn / meadow patchwork, built-up landuse = asphalt yards + paved aprons).
Writes  pb/train-sim/data/luxtram/g/<i>_<j>.bin   per detailed tile:  'LG2' u32 pngLen u32 shadeLen u32 jsonLen | class map PNG (256x256, 0.5 m/px, grey = class * 32)
                                                                      | AO PNG | JSON (vector layers incl. "pk" = parked-car stalls; cm integers relative to the tile corner)
        pb/train-sim/data/luxtram/f/c_<i>_<j>.png   far ring class maps (640 m tiles, 4 m/px)
Classes: 0 asphalt 1 paving 2 lawn 3 meadow 4 forest floor 5 gravel/soil 6 sett (stone setts) 7 water
"""
import json
import math
import os
import struct
import sys
from collections import defaultdict

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree
from shapely.ops import substring as shapely_substring
import rasterio.features
from rasterio.transform import Affine

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_luxtram as B  # noqa: E402
import luxtram_geo as G  # noqa: E402
from luxtram_ground_model import *  # noqa: E402,F401,F403
import luxtram_ground_model as M  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pb", "train-sim", "data", "luxtram")
TILE = 128.0
RES = 0.5
N = 256
FAR_TILE = 640.0
FAR_N = 160
ASPH, PAVE, LAWN, MEADOW, FOREST, GRAVEL, SETT, WATER = range(8)
GRASS = 12          # OSM landuse=grass: lawn in town / small verges, meadow when large and rural (decided per pixel from the building density)
PALETTE = [(70, 72, 76), (190, 186, 176), (118, 168, 70), (160, 170, 90), (42, 82, 42), (178, 160, 120), (150, 140, 130), (60, 100, 140)]
HARD = (ASPH, PAVE, SETT)

VEG_LAND = {
    ("landuse", "grass"): GRASS, ("landuse", "meadow"): MEADOW, ("landuse", "village_green"): LAWN, ("landuse", "recreation_ground"): LAWN,
    ("landuse", "cemetery"): LAWN, ("landuse", "allotments"): MEADOW, ("landuse", "farmland"): MEADOW, ("landuse", "orchard"): MEADOW,
    ("landuse", "greenfield"): MEADOW, ("landuse", "forest"): FOREST, ("landuse", "flowerbed"): LAWN, ("landuse", "plant_nursery"): MEADOW,
    ("leisure", "park"): LAWN, ("leisure", "garden"): LAWN, ("leisure", "playground"): GRAVEL, ("leisure", "golf_course"): LAWN,
    ("leisure", "dog_park"): LAWN, ("leisure", "nature_reserve"): MEADOW,
    ("natural", "wood"): FOREST, ("natural", "scrub"): MEADOW, ("natural", "grassland"): MEADOW, ("natural", "heath"): MEADOW,
    ("natural", "wetland"): MEADOW, ("natural", "bare_rock"): GRAVEL, ("natural", "sand"): GRAVEL, ("natural", "beach"): GRAVEL, ("natural", "mud"): GRAVEL,
    ("landuse", "brownfield"): GRAVEL, ("landuse", "construction"): GRAVEL, ("landuse", "railway"): GRAVEL, ("landuse", "quarry"): GRAVEL,
    ("landuse", "garages"): ASPH, ("landuse", "industrial"): None, ("landuse", "depot"): GRAVEL,
}
LANDCTX = {"residential": "res", "commercial": "com", "retail": "com", "industrial": "ind", "garages": "ind", "depot": "ind", "port": "ind", "military": "ind",
           "education": "inst", "institutional": "inst", "religious": "inst", "farmyard": "ind"}
RESIDENTIAL_B = ("house", "detached", "semidetached_house", "terrace", "residential", "apartments", "garage", "garages", "shed", "carport", "roof", "farm", "greenhouse", "cabin", "hut", "static_caravan", "dormitory", "bungalow", "allotment_house")
PITCH = {"asphalt": ASPH, "concrete": PAVE, "tartan": ASPH, "clay": GRAVEL, "sand": GRAVEL, "grass": LAWN, "artificial_turf": LAWN, "gravel": GRAVEL, "paved": ASPH}


def log(*a):
    print(*a, flush=True)


# ----------------------------------------------------------------------------------------------------------------------------- base classes (no photo)
# The class map comes from OSM geometry + LiDAR heights + context defaults only.  Nothing here looks at a photograph.
CTX_CELL = 4.0
CTX_X0, CTX_Z0, CTX_X1, CTX_Z1 = -6800.0, -6800.0, 6800.0, 6200.0
NDSM_TREE = 2.6          # m: crowns (parked vans / buses stay below this; hedges and bushes are lawn anyway)


def tile_ndsm(H_dtm, H_dsm, i, j, n=N):
    a, b = H_dtm.tile(i, j), H_dsm.tile(i, j)
    if a is None or b is None:
        return None
    nd = np.nan_to_num(b - a, nan=0.0)
    u = (np.arange(n) + 0.5) * (TILE / n)           # metres from the tile corner (node k at k m)
    uu, vv = np.meshgrid(u, u)
    return ndi.map_coordinates(nd, [vv, uu], order=1, mode="nearest")


def mode_filter(cls, ncls, k):
    sc = np.stack([ndi.uniform_filter((cls == c).astype(np.float32), k) for c in range(ncls)])
    return np.argmax(sc, 0).astype(np.uint8)


def drop_small(cls, protect, min_px, ncls=8):
    """components of one class smaller than min_px (and not protected) take the class of their surroundings (clean, calm areas: no speckle)"""
    out = cls.copy()
    for c in range(ncls):
        m = out == c
        if not m.any():
            continue
        lab, n = ndi.label(m)
        if not n:
            continue
        areas = ndi.sum(m, lab, index=np.arange(1, n + 1))
        small = np.zeros(n + 1, bool)
        small[1:] = areas < min_px
        sm = small[lab] & m & ~protect
        if sm.any():
            keep = ~sm
            if keep.any():
                idx = ndi.distance_transform_edt(sm, return_distances=False, return_indices=True)
                out = np.where(sm, out[idx[0], idx[1]], out)
    return out


class Context:
    """Building density (the 'how urban is it here' signal) on a 4 m grid over the whole frame, from the OSM footprints of the corridor + the far-ring footprints."""

    def __init__(self, polys):
        self.nx = int((CTX_X1 - CTX_X0) / CTX_CELL)
        self.nz = int((CTX_Z1 - CTX_Z0) / CTX_CELL)
        m = np.zeros((self.nz, self.nx), np.uint8)
        tr = Affine(CTX_CELL, 0, CTX_X0, 0, CTX_CELL, CTX_Z0)
        shapes = [(p, 1) for p in polys if p is not None and not p.is_empty]
        if shapes:
            rasterio.features.rasterize(shapes, out=m, transform=tr, all_touched=True)
        f = m.astype(np.float32)
        self.fine = ndi.gaussian_filter(f, 22.0 / CTX_CELL)        # ~ 40 m neighbourhood
        self.wide = ndi.gaussian_filter(f, 90.0 / CTX_CELL)        # ~ 150 m neighbourhood

    def at(self, X, Z, which="fine"):
        g = self.fine if which == "fine" else self.wide
        u = (np.asarray(X, float) - CTX_X0) / CTX_CELL - 0.5
        v = (np.asarray(Z, float) - CTX_Z0) / CTX_CELL - 0.5
        return ndi.map_coordinates(g, [v, u], order=1, mode="nearest")


def far_building_polys():
    out = []
    d = os.path.join(OUT, "f")
    for f in os.listdir(d):
        if f.startswith("b_") and f.endswith(".json"):
            try:
                for e in json.load(open(os.path.join(d, f))):
                    fl = e[2]
                    if len(fl) >= 6:
                        pg = Polygon([(fl[i], fl[i + 1]) for i in range(0, len(fl) - 1, 2)])
                        out.append(pg if pg.is_valid else pg.buffer(0))
            except Exception as ex:
                print("far buildings", f, ex)
    return out


def lattice_noise(X, Z, cell, seed):
    """smooth 0..1 value noise of world coordinates (so neighbouring tiles agree)"""
    gx, gz = np.asarray(X, float) / cell, np.asarray(Z, float) / cell
    ix, iz = np.floor(gx).astype(np.int64), np.floor(gz).astype(np.int64)
    fx, fz = gx - ix, gz - iz

    def hv(a, b):
        v = (a * 374761393 + b * 668265263 + seed * 2147483629) & 0xFFFFFFFF
        v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
        v = v ^ (v >> 16)
        return (v & 0xFFFF) / 65535.0

    sx, sz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a = hv(ix, iz) * (1 - sx) + hv(ix + 1, iz) * sx
    b = hv(ix, iz + 1) * (1 - sx) + hv(ix + 1, iz + 1) * sx
    return a * (1 - sz) + b * sz


def value_noise(h, w, cell, seed):
    """smooth 0..1 noise (cell = px per lattice step)"""
    rng = np.random.RandomState(seed)
    gh, gw = h // cell + 3, w // cell + 3
    g = rng.rand(gh, gw).astype(np.float32)
    return ndi.zoom(g, cell, order=1)[:h, :w]


# ----------------------------------------------------------------------------------------------------------------------------- world model
class World:
    def __init__(self):
        idx = json.load(open(os.path.join(OUT, "index.json")))
        self.tiles = list(idx["tiles"].keys())
        self.far = list(idx["far"].keys())
        self.tile_meta = idx["tiles"]
        self.idx = idx
        self.ctx = None                   # building-density context (see Context)
        self.landctx = []                 # (kind, polygon) built-up landuse for the untagged-ground defaults
        self.pspaces = []                 # amenity=parking_space polygons (single stalls)
        self.load_osm()

    # ------------------------------------------------------------------------- OSM
    def load_osm(self):
        log("OSM ...")
        roads, sidewalks, crossings = [], [], []
        for el in M.load_all_elements("road"):
            if el["type"] != "way" or not el.get("geometry"):
                continue
            t = el.get("tags", {})
            hw = t.get("highway")
            if hw is None or hw not in HW_CLASS:
                continue
            if t.get("area") == "yes" or t.get("highway") == "construction" and False:
                continue
            if len(el["geometry"]) < 2:
                continue
            if hw in ("footway", "path", "cycleway", "pedestrian") and t.get("footway") == "crossing":
                crossings.append(el)
                continue
            r = Road(el)
            if r.line is None or r.line.length < 0.5:
                continue
            if hw == "footway" and t.get("footway") == "sidewalk":
                sidewalks.append(r)
                continue
            if t.get("access") == "private" and r.cls == 5 and not t.get("service") in ("parking_aisle",):
                pass
            roads.append(r)
        self.roads, self.sidewalk_ways, self.crossing_els = roads, sidewalks, crossings
        log("  roads", len(roads), "sidewalk ways", len(sidewalks), "crossings", len(crossings))
        # areas
        self.veg, self.hard, self.water_polys, self.water_lines, self.rails, self.platforms = [], [], [], [], [], []
        self.parking = []
        self.crossing_nodes, self.bus_stops = [], []
        for prefix in ("land", "ground"):
            for el in M.load_all_elements(prefix):
                t = el.get("tags", {})
                if el["type"] == "node":
                    if t.get("highway") == "crossing":
                        self.crossing_nodes.append((B.proj(el["lat"], el["lon"]), t))
                    elif t.get("highway") == "bus_stop":
                        self.bus_stops.append(B.proj(el["lat"], el["lon"]))
                    continue
                self.classify_area(el, t)
        self.veg_key = None
        # tram corridor (both tracks)
        tw = json.load(open(os.path.join(RAW, "tram_ways.json")))["elements"]
        lines = []
        for el in tw:
            if el["type"] == "way" and el.get("geometry") and el.get("tags", {}).get("railway") in ("tram", "construction"):
                lines.append(LineString([B.proj(p["lat"], p["lon"]) for p in el["geometry"]]))
        self.tram_lines = lines
        self.tram_corr = unary_union([l.buffer(2.0) for l in lines]) if lines else Polygon()
        # buildings
        bl = []
        self.big_bld = []             # large non-residential buildings: stadiums, halls, malls, terminals (they get a paved forecourt)
        for el in M.load_all_elements("bld"):
            tg = el.get("tags", {})
            if tg.get("building") is None and tg.get("building:part") is None:
                continue
            pgs = M.el_polygons(el)
            bl += pgs
            if tg.get("building") not in RESIDENTIAL_B and tg.get("building:part") is None:
                self.big_bld += [q for q in pgs if q.area > 1500]
        self.bld = unary_union([b for b in bl if not b.is_empty])
        log("  buildings", len(bl), "water", len(self.water_polys), "veg polys", len(self.veg), "rails", len(self.rails), "parking", len(self.parking))

    def classify_area(self, el, t):
        hw = t.get("highway")
        # water
        if t.get("natural") in ("water", "bay") or t.get("waterway") == "riverbank" or (el["type"] == "relation" and t.get("waterway") in ("riverbank",)):
            # retention basins are mostly dry grass, fountains are paved: only real water is water
            if t.get("water") in ("basin", "fountain", "wastewater", "reflecting_pool", "pool", "swimming_pool"):
                if t.get("water") == "basin":
                    self.veg.append((MEADOW, M.el_polygons(el), 0))
                return
            if t.get("tunnel") != "yes" and t.get("covered") != "yes":
                self.water_polys += M.el_polygons(el)
            return
        if el["type"] == "way" and t.get("waterway") in ("river", "stream", "canal") and el.get("geometry"):
            if t.get("tunnel") in ("yes", "culvert") or t.get("covered") == "yes" or t.get("bridge") == "yes" and False:
                return
            w = {"river": 8.0, "canal": 6.0, "stream": 1.6, "drain": 0.8, "ditch": 0.8}[t["waterway"]]
            ww = M.parse_w(t.get("width")) or w
            self.water_lines.append((LineString([B.proj(p["lat"], p["lon"]) for p in el["geometry"]]), ww, t.get("bridge") == "yes"))
            return
        # railways
        if t.get("railway") in ("rail", "light_rail", "narrow_gauge", "funicular") and el["type"] == "way" and el.get("geometry"):
            if t.get("tunnel") in ("yes",):
                return
            self.rails.append((LineString([B.proj(p["lat"], p["lon"]) for p in el["geometry"]]), t))
            return
        if t.get("railway") == "platform":
            if el["type"] == "way" and el.get("geometry"):
                ring = M.ring_poly(el["geometry"])
                if ring:
                    self.platforms += M.el_polygons(el)
                else:
                    self.platforms.append(LineString([B.proj(p["lat"], p["lon"]) for p in el["geometry"]]).buffer(1.2))
            return
        if t.get("railway") in ("abandoned", "disused", "razed"):
            return
        # parking
        if t.get("amenity") == "parking" or t.get("amenity") == "parking_space":
            if t.get("parking") in ("underground", "multi-storey", "rooftop") or t.get("location") in ("underground", "rooftop"):
                return
            if t.get("amenity") == "parking_space":
                self.pspaces += M.el_polygons(el)
                return
            self.parking += M.el_polygons(el)
            return
        # hard areas
        if t.get("area:highway") or (hw in ("pedestrian", "footway", "service", "living_street") and t.get("area") == "yes") or hw == "pedestrian" and el["type"] == "relation":
            code = t.get("area:highway") or hw
            surf = t.get("surface", "")
            c = PAVE
            if code in ("service", "residential", "unclassified", "tertiary", "secondary", "primary", "cycleway", "living_street", "motorway", "trunk", "driveway", "traffic_island"):
                c = ASPH if code not in ("traffic_island",) else PAVE
            if surf in SETT_SURF or (code == "pedestrian" and surf not in ("asphalt", "concrete")):
                c = SETT
            if surf in GRAVEL_SURF:
                c = GRAVEL
            self.hard.append((c, M.el_polygons(el)))
            return
        if t.get("amenity") == "fountain":
            return
        if t.get("leisure") in ("pitch", "track", "sports_centre", "stadium"):
            c = PITCH.get(t.get("surface", ""), LAWN if t.get("leisure") != "track" else ASPH)
            if t.get("leisure") in ("sports_centre", "stadium"):
                return
            self.veg.append((c, M.el_polygons(el), 5))
            return
        lu = t.get("landuse")
        if lu in LANDCTX:
            for pg in M.el_polygons(el):
                self.landctx.append((LANDCTX[lu], pg))
        for k in ("landuse", "leisure", "natural"):
            if k in t and (k, t[k]) in VEG_LAND:
                c = VEG_LAND[(k, t[k])]
                if c is None:
                    return
                if el["type"] == "way" and k == "natural" and t[k] == "tree_row":
                    return
                self.veg.append((c, M.el_polygons(el), 0 if c != ASPH else 6))
                return
        if t.get("natural") == "cliff" or t.get("natural") == "tree_row":
            return

    # ------------------------------------------------------------------------- base classes (OSM + LiDAR + context; no photo)
    def load_base(self, dtm=None, dsm=None):
        log("context (building density) ...")
        polys = poly_list(self.bld) + far_building_polys()
        self.ctx = Context(polys)
        self.dtm, self.dsm = dtm, dsm
        self.bld_layer = Layer(poly_list(self.bld) + far_building_polys())
        aprons = []
        for g in self.big_bld:
            aprons.append(g.buffer(20 if g.area > 6000 else 11))
        for pl in self.platforms:
            if isinstance(pl, Polygon):
                aprons.append(pl.buffer(7))
        self.apron_layer = Layer(aprons)
        self.landctx_layer = Layer([pg for k, pg in self.landctx])
        self.landctx_kind = {id(pg): k for k, pg in self.landctx}
        self.veg_sorted = sorted([(c, p, force) for c, polys_, force in self.veg for p in polys_ if not p.is_empty], key=lambda e: -e[1].area)
        self.veg_layer = Layer([e[1] for e in self.veg_sorted])
        self.veg_info = {id(e[1]): e for e in self.veg_sorted}

    def base_at(self, x, z):
        """default ground class at a point (only used to decide sidewalks of untagged streets): paving in built-up blocks, lawn elsewhere"""
        return PAVE if float(self.ctx.at([x], [z])[0]) > 0.13 else LAWN

    def veg_raster(self, bx, x0, z0, n, res, urb=None):
        """OSM vegetation polygons rasterised (255 = none); big polygons first so the small ones sit on top.  landuse=grass is lawn in town, meadow in the open."""
        tr = Affine(res, 0, x0, 0, res, z0)
        ov = np.full((n, n), 255, np.uint8)
        forced = np.zeros((n, n), bool)
        for g in sorted(self.veg_layer.query(bx.buffer(2.0)), key=lambda q: -q.area):
            c, _, force = self.veg_info[id(g)]
            tmp = np.zeros((n, n), np.uint8)
            gi = g.intersection(bx.buffer(2.0))
            if gi.is_empty:
                continue
            rasterio.features.rasterize([(gi, 1)], out=tmp, transform=tr)
            sel = tmp.astype(bool)
            if c == GRASS:
                if g.area > 6000 and urb is not None:
                    ov[sel] = np.where(urb[sel] < 0.07, MEADOW, LAWN)
                else:
                    ov[sel] = LAWN
            else:
                ov[sel] = c
            if force:
                forced[sel] = True
        return ov, forced

    def default_classes(self, bx, x0, z0, n, res, nd=None, far=False):
        """the ground where OSM says nothing: lawn / meadow in the open, paving in dense blocks and around buildings of built-up land, asphalt in industrial yards,
        forest floor under LiDAR canopy stands"""
        u = x0 + (np.arange(n) + 0.5) * res
        v = z0 + (np.arange(n) + 0.5) * res
        UU, VV = np.meshgrid(u, v)
        urb = self.ctx.at(UU, VV, "fine")
        arr = np.full((n, n), LAWN, np.uint8)
        tr = Affine(res, 0, x0, 0, res, z0)
        # land-use context
        ctxm = np.zeros((n, n), np.uint8)       # 1 res 2 commercial 3 industrial 4 institutional
        code = {"res": 1, "com": 2, "ind": 3, "inst": 4}
        order = sorted(self.landctx_layer.query(bx.buffer(1.0)), key=lambda g: -g.area)
        for g in order:
            gi = g.intersection(bx.buffer(1.0))
            if gi.is_empty:
                continue
            tmp = np.zeros((n, n), np.uint8)
            rasterio.features.rasterize([(gi, 1)], out=tmp, transform=tr)
            ctxm[tmp.astype(bool)] = code[self.landctx_kind[id(g)]]
        # buildings (footprints) and the apron around them
        bm = np.zeros((n, n), bool)
        shapes = [(g.intersection(bx.buffer(8.0)), 1) for g in self.bld_layer.query(bx.buffer(8.0))]
        shapes = [(g, vv) for g, vv in shapes if not g.is_empty]
        if shapes:
            tmp = np.zeros((n, n), np.uint8)
            rasterio.features.rasterize(shapes, out=tmp, transform=tr)
            bm = tmp.astype(bool)
        dist_b = ndi.distance_transform_edt(~bm) * res if bm.any() else np.full((n, n), 99.0)
        dense = urb > 0.36
        arr[dense] = PAVE
        # open land: patchwork of mown lawn and long-grass meadow (~35 m patches), deterministic in world coordinates
        open_ = (urb < 0.07) & (arr == LAWN)
        nz_ = lattice_noise(UU, VV, 34.0 if not far else 150.0, 7) * 0.7 + lattice_noise(UU, VV, 11.0 if not far else 50.0, 19) * 0.3
        arr[open_ & (nz_ > 0.56)] = MEADOW
        com = ctxm == 2
        arr[com] = np.where((urb[com] > 0.2) & (dist_b[com] < 6.0), PAVE, ASPH)        # commercial / retail land: paved apron by the buildings, yards and lots beyond
        arr[(ctxm == 3)] = ASPH
        apron = (dist_b < (1.8 if not far else 0.0)) & ((urb > 0.2) | (ctxm == 2) | (ctxm == 3))
        arr[apron & (arr == LAWN)] = PAVE
        if not far:             # forecourts of big buildings, tram / rail platforms and bus stops
            ap = np.zeros((n, n), np.uint8)
            shp = [(g.intersection(bx.buffer(1.0)), 1) for g in self.apron_layer.query(bx.buffer(1.0))]
            shp = [(g, vv) for g, vv in shp if not g.is_empty]
            if shp:
                rasterio.features.rasterize(shp, out=ap, transform=tr)
                arr[ap.astype(bool) & (arr == LAWN)] = PAVE
        # canopy stands from the LiDAR (no colour): tall + rough crowns, not roofs
        if nd is not None and far:
            roof = ndi.binary_dilation(bm, iterations=2) if bm.any() else bm
            can = (nd > 4.0) & ~roof
            can = ndi.gaussian_filter(can.astype(np.float32), 1.0) > 0.5
            return arr, can, urb, ctxm
        if nd is not None:
            roof = ndi.binary_dilation(bm, iterations=int(round(2.5 / res))) if bm.any() else bm
            win = max(3, int(round(3.5 / res)) | 1)
            m1 = ndi.uniform_filter(nd, win); m2 = ndi.uniform_filter(nd * nd, win)
            rough = np.sqrt(np.maximum(m2 - m1 * m1, 0.0))
            can = (nd > NDSM_TREE) & ~roof & ((rough > 0.35) | (nd > 8.0))
            can = ndi.binary_opening(can, iterations=max(1, int(round(0.8 / res)))) if can.any() else can
            can = ndi.gaussian_filter(can.astype(np.float32), 1.6 / res * 0.6) > 0.5      # calm outlines
            can = ndi.binary_closing(can, iterations=int(round(2.0 / res))) if can.any() else can
            return arr, can, urb, ctxm
        return arr, None, urb, ctxm

    def base_tile(self, key, nd):
        i, j = map(int, key.split("_"))
        x0, z0 = i * TILE, j * TILE
        bx = box(x0, z0, x0 + TILE, z0 + TILE)
        arr, can, urb, ctxm = self.default_classes(bx, x0, z0, N, RES, nd)
        ov, forced = self.veg_raster(bx, x0, z0, N, RES, urb)
        osm_soft = ov != 255
        arr = np.where(osm_soft, ov, arr)
        # canopy stands (>= 100 m2; in dense town only real stands >= 150 m2) become forest floor; single trees keep the class around them (the 3D tree is the tree)
        if can is not None and can.any():
            lab, nlab = ndi.label(can)
            areas = ndi.sum(can, lab, index=np.arange(1, nlab + 1)) * RES * RES if nlab else []
            keep = np.zeros(nlab + 1, bool)
            for k in range(nlab):
                a = areas[k]
                keep[k + 1] = a >= 100.0
            stand = keep[lab]
            town = np.isin(arr, (PAVE, ASPH, SETT))
            if town.any():
                big = np.zeros(nlab + 1, bool)
                big[1:] = areas >= 150.0
                stand = stand & (~town | big[lab])
            arr = np.where(stand & ~forced & ~(np.isin(arr, (ASPH, SETT)) & ~osm_soft), FOREST, arr)
        # calm, clean areas: mode filter on what OSM did not draw, then drop speckle below ~12 m2
        osm_geom = osm_soft
        sm = mode_filter(arr, 8, 7)
        arr = np.where(osm_geom, arr, sm)
        arr = drop_small(arr, osm_geom, int(12.0 / (RES * RES)))
        return arr

# ----------------------------------------------------------------------------------------------------------------------------- geometry
def side_sign_for(tag):
    """-> (left, right) booleans (OSM: left / right of the way direction in the map)."""
    if tag in ("both", "yes"):
        return True, True
    if tag == "left":
        return True, False
    if tag == "right":
        return False, True
    if tag in ("no", "none", "separate"):
        return False, False
    return None


def line_sides_polys(line, hw, sw, left, right):
    """sidewalk strips next to a centre line (x east, z south).  shapely's single-sided buffer: +d = shapely-left = the *map-right* of the way."""
    out = []
    if sw <= 0:
        return out
    try:
        if right:   # OSM right = shapely left (z axis flipped)
            out.append(line.buffer(hw + sw, single_sided=True, cap_style=2).difference(line.buffer(hw, single_sided=True, cap_style=2)))
        if left:
            out.append(line.buffer(-(hw + sw), single_sided=True, cap_style=2).difference(line.buffer(-hw, single_sided=True, cap_style=2)))
    except Exception:
        pass
    return out


class Geo:
    def __init__(self, W, dtm, dsm):
        self.W, self.dtm, self.dsm = W, dtm, dsm
        self.build()

    # ---------------------------------------------------------------------
    def build(self):
        W = self.W
        roads = W.roads
        self.ground_roads = [r for r in roads if r.cls in CARRIAGE and not r.bridge and not r.tunnel and not (r.layer < 0)]
        over = []
        try:
            sd = json.load(open(os.path.join(OUT, "structures.json")))
            for o in sd.get("over", []):
                pl = o["poly"]
                over.append(Polygon([(pl[i], pl[i + 1]) for i in range(0, len(pl), 2)]).buffer(2.5))
        except Exception as e:
            print("structures.json:", e)
        self.over_polys = unary_union(over) if over else Polygon()
        # the overpass decks of structures.json (plane-fitted, drawn by luxtram-world.js buildDecksFor) are not drawn twice
        self.deck_roads = [r for r in roads if r.bridge and not r.tunnel and r.cls <= 10 and not any(n in r.name for n in ("Charlotte", "Adolphe"))
                           and not (not self.over_polys.is_empty and r.line.intersects(self.over_polys))]
        self.named_deck_roads = [r for r in roads if r.bridge and any(n in r.name for n in ("Charlotte", "Adolphe"))]
        log("carriageways ...")
        bufs = [r.line.buffer(r.hw, cap_style=2, join_style=1) for r in self.ground_roads]
        self.road_bufs = bufs
        self.carriage = unary_union(bufs).simplify(0.04) if bufs else Polygon()
        # pedestrian streets / plazas drawn as paving (cls 6) are *surface* not carriageway
        # water first (sidewalks / kerbs avoid it)
        wl = [ln.buffer(w / 2) for ln, w, br in W.water_lines if not br]
        self.water = unary_union(list(W.water_polys) + wl) if (W.water_polys or wl) else Polygon()
        log("sidewalks ...")
        self.make_sidewalks()
        log("paths ...")
        self.make_paths()
        log("markings ...")
        self.make_markings()
        self.make_crossings()
        self.make_parking()
        self.make_rails()
        log("decks ...")
        self.make_decks()
        self.make_water_levels()

    # ---------------------------------------------------------------------
    def make_sidewalks(self):
        W = self.W
        sw_ways = []
        for r in W.sidewalk_ways:
            if r.bridge or r.tunnel:
                continue
            sw_ways.append(r.line)
        self.sw_tree = STRtree(sw_ways) if sw_ways else None
        self.sw_lines = sw_ways
        pieces = []
        n_inferred = 0
        for r in self.ground_roads:
            sw = SIDEWALK_W.get(r.cls, 0.0)
            if sw <= 0:
                continue
            tag = r.tags.get("sidewalk")
            sides = side_sign_for(tag)
            if sides is None:
                l, rr = side_sign_for(r.tags.get("sidewalk:left") or ""), side_sign_for(r.tags.get("sidewalk:right") or "")
                if l or rr:
                    sides = ((l[0] or l[1]) if l else None, (rr[0] or rr[1]) if rr else None)
                    sides = (bool(sides[0]), bool(sides[1]))
            if sides is not None:
                pieces += line_sides_polys(r.line, r.hw, sw, sides[0], sides[1])
                continue
            # untagged: infer from the building density (built-up = sidewalks) + existing separate OSM sidewalks
            L = r.line.length
            n = max(1, int(L // 8))
            for k in range(n):
                a, b = k * L / n, (k + 1) * L / n
                seg = shapely_substring(r.line, a, b)
                if seg is None or seg.length < 1:
                    continue
                mid = seg.interpolate(0.5, normalized=True)
                p0 = seg.interpolate(0.0, normalized=True)
                p1 = seg.interpolate(1.0, normalized=True)
                dx, dz = p1.x - p0.x, p1.y - p0.y
                dl = math.hypot(dx, dz) or 1.0
                rx, rz = -dz / dl, dx / dl           # map-right in (x, z)
                for side in (1, -1):                 # +1 = map right
                    hits = 0
                    for off in (0.8, 1.5, 2.2):
                        c = W.base_at(mid.x + rx * side * (r.hw + off), mid.y + rz * side * (r.hw + off))
                        if c in (PAVE, ASPH, SETT):
                            hits += 1
                    if hits < 3:
                        continue
                    # separate OSM sidewalk way close by on that side?  then it is drawn from that
                    q = Point(mid.x + rx * side * (r.hw + 2.0), mid.y + rz * side * (r.hw + 2.0))
                    if self.near_sw(q, 2.6):
                        continue
                    n_inferred += 1
                    pieces += line_sides_polys(seg, r.hw, sw, side < 0, side > 0)
        log("  inferred sidewalk pieces", n_inferred)
        sw_sep = [l.buffer(1.0, cap_style=2) for l in sw_ways]
        allsw = unary_union(pieces + sw_sep) if (pieces or sw_sep) else Polygon()
        # close small gaps between sidewalk and kerb, fill junction corners
        try:
            closed = unary_union([allsw, self.carriage]).buffer(0.9, join_style=2).buffer(-0.9, join_style=2)
            allsw = closed
        except Exception:
            pass
        sub = unary_union([self.carriage, W.bld.buffer(0.15), W.tram_corr, self.water])
        allsw = allsw.difference(sub)
        polys = [p for p in polys_of(allsw) if p.area > 0.6]
        self.sidewalk = unary_union(polys).simplify(0.05) if polys else Polygon()
        # kerb lines: the carriageway boundary where it touches a sidewalk
        try:
            kb = self.carriage.boundary.intersection(self.sidewalk.buffer(0.2))
            kl = [l for l in lines_of(kb) if l.length > 0.8]
            sw = prep(self.sidewalk)
            out = []
            for l in kl:
                # orient every kerb line so that the sidewalk lies on its left ((-dz, dx) in the x/z plane): the runtime builds the stone face from that
                votes = 0
                for f in (0.25, 0.5, 0.75):
                    a = l.interpolate(max(0.0, l.length * f - 0.4)); b = l.interpolate(min(l.length, l.length * f + 0.4))
                    dx, dz = b.x - a.x, b.y - a.y
                    dl = math.hypot(dx, dz) or 1.0
                    m = l.interpolate(l.length * f)
                    pl = Point(m.x - dz / dl * 0.35, m.y + dx / dl * 0.35)
                    votes += 1 if sw.contains(pl) else -1
                out.append(LineString(list(l.coords)[::-1]) if votes < 0 else l)
            self.kerbs = out
        except Exception as e:
            print("kerb orientation failed", e)
            self.kerbs = []

    def near_sw(self, p, d):
        if not self.sw_tree:
            return False
        for i in self.sw_tree.query(p.buffer(d)):
            if self.sw_lines[i].distance(p) < d:
                return True
        return False

    # ---------------------------------------------------------------------
    def make_paths(self):
        W = self.W
        groups = defaultdict(list)    # code -> polygons
        self.steps = []
        for r in W.roads:
            if r.bridge or r.tunnel or r.layer < 0:
                continue
            if r.cls in CARRIAGE:
                continue
            code = {9: 0, 6: 0, 7: 3, 8: 1, 10: 4}.get(r.cls, 0)
            s = r.surf
            if r.cls in (6, 9) and s in SETT_SURF:
                code = 2
            elif r.cls in (6, 9) and s in GRAVEL_SURF:
                code = 1
            elif r.cls in (6, 9) and s in ("asphalt",):
                code = 3
            elif r.cls == 6 and s not in ("concrete", "asphalt"):
                code = 2 if s in SETT_SURF else 0
            groups[code].append(r.line.buffer(r.hw, cap_style=2, join_style=1))
        self.paths = {}
        cut = unary_union([self.carriage, W.bld.buffer(0.1), W.tram_corr, self.water, self.sidewalk])
        for code, lst in groups.items():
            u = unary_union(lst).difference(cut)
            self.paths[code] = [p for p in polys_of(u) if p.area > 0.5]

    # ---------------------------------------------------------------------
    @staticmethod
    def is_continuation(a, b):
        for p in (a.pts[0], a.pts[-1]):
            for q in (b.pts[0], b.pts[-1]):
                if B.dist(p, q) < 0.1:
                    if a.cls == b.cls:
                        return True
        return False

    def make_markings(self):
        W = self.W
        self.marks = []       # (kind, shapely LineString)
        self.quads = []       # (kind, [(x, z) * 4])  kind 0 = white paint
        lines = [r.line for r in self.ground_roads]
        tree = STRtree(self.road_bufs)
        zebra_cut_polys = []
        for i, r in enumerate(self.ground_roads):
            if r.cls > 4 or r.w < 4.3 or r.line.length < 6:
                continue
            if r.tags.get("surface") in SETT_SURF and r.cls >= 4:
                continue
            hw = r.hw
            L = r.line
            specs = []   # (kind, offset)
            if r.oneway:
                n = max(1, round(r.w / 3.1)) if not r.lanes else r.lanes
                for k in range(1, n):
                    specs.append((2, -hw + k * r.w / n))
            else:
                n = r.lanes if r.lanes >= 2 else (2 if r.w >= 5.0 else 1)
                if r.w >= 11.0 and n < 4:
                    n = 4
                if n % 2:
                    n += 1
                if n >= 2:
                    for k in range(1, n):
                        off = -hw + k * r.w / n
                        specs.append((1 if abs(off) > 0.1 else (3 if n >= 4 else 1), off))
            if r.cls <= 3 and r.w >= 6.0:
                specs.append((4, hw - 0.28))
                specs.append((4, -hw + 0.28))
            if not specs:
                continue
            # cut zones: other roads of the same or higher importance that are not a continuation of this way
            cuts = []
            for j in tree.query(L.buffer(hw + 1.0)):
                if j == i:
                    continue
                o = self.ground_roads[j]
                if o.cls > r.cls or self.is_continuation(r, o):
                    continue
                if self.road_bufs[j].intersects(L):
                    cuts.append(o.line.buffer(o.hw + 0.6, cap_style=2))
            cutu = unary_union(cuts) if cuts else None
            for kind, off in specs:
                try:
                    ln = L.offset_curve(-off) if abs(off) > 1e-3 else L          # shapely-left is the map-right
                except Exception:
                    continue
                for part in lines_of(ln):
                    if cutu is not None:
                        part = part.difference(cutu)
                    for seg in lines_of(part):
                        # keep clear of dead ends / junction mouths
                        if seg.length < 2.0:
                            continue
                        # inside the carriageway, outside the tram corridor
                        seg2 = seg.difference(W.tram_corr)
                        for s3 in lines_of(seg2):
                            if s3.length >= 1.5:
                                self.marks.append((kind, s3))
        # stop lines at junctions of a minor road into a major road
        for i, r in enumerate(self.ground_roads):
            if r.cls < 3 or r.cls > 5 or r.w < 3.5:
                continue
            for end in (0, 1):
                p = r.pts[0] if end == 0 else r.pts[-1]
                for j in tree.query(Point(p).buffer(1.0)):
                    o = self.ground_roads[j]
                    if o is r or o.cls > 3 or o.cls >= r.cls or self.is_continuation(r, o):
                        continue
                    if o.line.distance(Point(p)) > 0.6:
                        continue
                    # stop line one major half width + 1.2 m back from the junction, on the approach lane (right-hand traffic)
                    L = r.line
                    d_end = 0.0 if end == 0 else L.length
                    back = o.hw + 1.4
                    s = back if end == 0 else L.length - back
                    if s < 0 or s > L.length:
                        continue
                    a = L.interpolate(max(0, s - 0.5)); b = L.interpolate(min(L.length, s + 0.5))
                    dx, dz = b.x - a.x, b.y - a.y
                    dl = math.hypot(dx, dz) or 1.0
                    dx, dz = dx / dl, dz / dl
                    rx, rz = -dz, dx
                    c = L.interpolate(s)
                    # lane lies on the right of the direction of travel *towards* the junction
                    toward = -1 if end == 0 else 1                       # direction vector of travel towards the junction in along-line coordinates
                    if r.oneway:
                        # skip when the way leads away from the junction
                        pass
                    tx, tz = dx * toward, dz * toward
                    rtx, rtz = -tz, tx
                    lane0 = 0.15 if not r.oneway else -r.hw + 0.15
                    lane1 = r.hw - 0.15 if not r.oneway else r.hw - 0.15
                    if not r.oneway:
                        c0 = (c.x + rtx * 0.15, c.y + rtz * 0.15)
                        c1 = (c.x + rtx * (r.hw - 0.2), c.y + rtz * (r.hw - 0.2))
                    else:
                        c0 = (c.x - rtx * (r.hw - 0.2), c.y - rtz * (r.hw - 0.2))
                        c1 = (c.x + rtx * (r.hw - 0.2), c.y + rtz * (r.hw - 0.2))
                    hwid = 0.2
                    q = [(c0[0] - tx * hwid, c0[1] - tz * hwid), (c1[0] - tx * hwid, c1[1] - tz * hwid), (c1[0] + tx * hwid, c1[1] + tz * hwid), (c0[0] + tx * hwid, c0[1] + tz * hwid)]
                    self.quads.append((0, q))
                    break

    # ---------------------------------------------------------------------
    def make_crossings(self):
        W = self.W
        carriage = self.carriage
        prepared = prep(carriage)
        used = []
        roadtree = STRtree(self.road_bufs)

        def stripes(a, b, kind):
            ls = LineString([a, b])
            if ls.length < 2:
                return
            inside = ls.intersection(carriage)
            for seg in lines_of(inside):
                if seg.length < 2.0:
                    continue
                p0, p1 = seg.coords[0], seg.coords[-1]
                dx, dz = p1[0] - p0[0], p1[1] - p0[1]
                dl = math.hypot(dx, dz)
                ux, uz = dx / dl, dz / dl          # along the walking direction (across the road)
                vx, vz = -uz, ux                    # along the traffic direction
                # stripes are 0.5 m wide along u, 3.0 m long along v, 0.5 m gaps; centred on the segment
                n = int((dl - 0.2) // 1.0)
                if n < 2:
                    continue
                start = (dl - (n * 1.0 - 0.5)) / 2.0
                if kind == "signals":
                    # two edge bars only (signalised crossing)
                    for o in (0.0, dl - 0.35):
                        self.add_stripe(p0, ux, uz, vx, vz, o + 0.17, 0.35, 3.0)
                    continue
                for k in range(n):
                    self.add_stripe(p0, ux, uz, vx, vz, start + k * 1.0 + 0.25, 0.5, 3.0)

        for el in W.crossing_els:
            t = el.get("tags", {})
            cr = t.get("crossing") or t.get("crossing:markings") or ""
            if cr in ("unmarked", "no") or t.get("crossing:markings") == "no":
                continue
            g = [B.proj(p["lat"], p["lon"]) for p in el["geometry"]]
            a, b = g[0], g[-1]
            kind = "signals" if cr in ("traffic_signals", "pedestrian_signals") and t.get("crossing:markings") not in ("zebra", "yes", "surface") else "zebra"
            stripes(a, b, kind)
            used.append(LineString(g).buffer(3.0))
        usedu = unary_union(used) if used else None
        # crossing nodes on roads without a crossing way: stripes across the road under the node
        for (p, t) in W.crossing_nodes:
            cr = t.get("crossing", "")
            if cr in ("unmarked", "no", "island") or t.get("crossing:markings") == "no":
                continue
            pt = Point(p)
            if usedu is not None and usedu.contains(pt):
                continue
            best = None
            for j in roadtree.query(pt.buffer(2.0)):
                o = self.ground_roads[j]
                if o.cls > 4:
                    continue
                d = o.line.distance(pt)
                if d < 1.5 and (best is None or d < best[0]):
                    best = (d, o)
            if not best:
                continue
            o = best[1]
            s = o.line.project(pt)
            a = o.line.interpolate(max(0, s - 0.5)); b = o.line.interpolate(min(o.line.length, s + 0.5))
            dx, dz = b.x - a.x, b.y - a.y
            dl = math.hypot(dx, dz) or 1.0
            rx, rz = -dz / dl, dx / dl
            c = o.line.interpolate(s)
            kind = "signals" if cr in ("traffic_signals", "pedestrian_signals") else "zebra"
            stripes((c.x - rx * (o.hw + 0.5), c.y - rz * (o.hw + 0.5)), (c.x + rx * (o.hw + 0.5), c.y + rz * (o.hw + 0.5)), kind)

    def add_stripe(self, p0, ux, uz, vx, vz, c_along, w, length):
        cx, cz = p0[0] + ux * c_along, p0[1] + uz * c_along
        hw, hl = w / 2, length / 2
        q = [(cx - ux * hw - vx * hl, cz - uz * hw - vz * hl), (cx + ux * hw - vx * hl, cz + uz * hw - vz * hl),
             (cx + ux * hw + vx * hl, cz + uz * hw + vz * hl), (cx - ux * hw + vx * hl, cz - uz * hw + vz * hl)]
        self.quads.append((0, q))

    # ---------------------------------------------------------------------
    def make_parking(self):
        """Painted stalls of every parking area: double-loaded rows (5 m bays, 6 m aisles) along the dominant direction of the lot, clipped to the lot minus
        carriageways / buildings / the tram corridor; single parking_space ways are drawn as they are.  self.bays = paint lines, self.slots = (x, z, heading deg)
        for the parked cars (runtime picks ~55 % of them)."""
        import shapely.affinity as SA
        W = self.W
        self.bays, self.slots = [], []
        excl = unary_union([self.carriage.buffer(0.25), W.bld.buffer(0.3), W.tram_corr.buffer(0.5)])
        excl_prep = prep(excl) if not excl.is_empty else None
        BAY_W, BAY_D, AISLE = 2.5, 5.0, 6.0
        lots = [p for p in W.parking if 40 <= p.area <= 90000]
        spaces = [q for q in W.pspaces if 6 <= q.area <= 30]
        sp_tree = STRtree([q.centroid for q in spaces]) if spaces else None
        gen_lots = []
        for p in lots:
            n_sp = []
            if sp_tree is not None:
                n_sp = [i for i in sp_tree.query(p) if p.contains(spaces[i].centroid)]
            if len(n_sp) >= 6:
                continue        # mapped stall by stall: drawn from those below
            inner = p.buffer(-0.3)
            if inner.is_empty:
                continue
            if excl_prep is not None:
                inner = inner.difference(excl)
                if inner.is_empty:
                    continue
            # dominant edge direction of the lot (length-weighted, mod 90 deg)
            hist = np.zeros(90)
            ext = list(p.exterior.coords)
            for a, b in zip(ext[:-1], ext[1:]):
                dx, dz = b[0] - a[0], b[1] - a[1]
                ln = math.hypot(dx, dz)
                if ln < 1.0:
                    continue
                hist[int(math.degrees(math.atan2(dz, dx)) % 90) % 90] += ln
            hist = np.convolve(np.concatenate([hist[-2:], hist, hist[:2]]), np.ones(5) / 5, "valid")
            th = int(np.argmax(hist))
            gen_lots.append(p)
            for polys_ in polys_of(inner):
                if polys_.area < 15:
                    continue
                self._bays_for(polys_, th, SA, BAY_W, BAY_D, AISLE)
        # stall-by-stall parking_space ways (those inside a lot that got a generated layout are skipped)
        lot_gen = prep(unary_union(gen_lots)) if gen_lots else None
        for q in spaces:
            if lot_gen is not None and lot_gen.contains(q.centroid):
                continue
            try:
                rect = q.minimum_rotated_rectangle
                c = list(rect.exterior.coords)[:4]
            except Exception:
                continue
            e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
            l0, l1 = math.hypot(*e0), math.hypot(*e1)
            if min(l0, l1) < 1.6 or max(l0, l1) > 8.5:
                continue
            ax = e0 if l0 >= l1 else e1
            cx = sum(v[0] for v in c) / 4; cz = sum(v[1] for v in c) / 4
            if excl_prep is not None and excl_prep.contains(Point(cx, cz)):
                continue
            self.bays.append(LineString(list(q.exterior.coords)))
            self.slots.append((cx, cz, math.degrees(math.atan2(ax[1], ax[0])) % 360))
        log("  parking: %d lots, %d stalls, %d paint lines" % (len(lots), len(self.slots), len(self.bays)))

    def _bays_for(self, poly, th, SA, BAY_W, BAY_D, AISLE):
        t = math.radians(th)
        ca, sa = math.cos(t), math.sin(t)
        to_l = [ca, sa, -sa, ca, 0, 0]          # (x, z) -> (u, v)
        to_w = [ca, -sa, sa, ca, 0, 0]          # (u, v) -> (x, z)
        loc = SA.affine_transform(poly, to_l)
        u0, v0, u1, v1 = loc.bounds
        swap = False
        if (v1 - v0) > (u1 - u0) * 1.05:       # rows run along the long dimension
            th2 = th + 90
            t = math.radians(th2); ca, sa = math.cos(t), math.sin(t)
            to_l = [ca, sa, -sa, ca, 0, 0]; to_w = [ca, -sa, sa, ca, 0, 0]
            loc = SA.affine_transform(poly, to_l)
            u0, v0, u1, v1 = loc.bounds
        wv = v1 - v0
        lp = prep(loc)
        shrink = loc.buffer(-0.12)
        shrink_p = prep(shrink) if not shrink.is_empty else lp
        out_lines, out_slots = [], []
        def fits(rc):
            if not shrink_p.intersects(rc):
                return False
            if shrink_p.contains(rc):
                return True
            return shrink.intersection(rc).area >= 0.82 * rc.area
        parallel = wv < 4.6
        if parallel:
            va = (v0 + v1) / 2 - 1.15; vb = va + 2.3
            u = u0 + 0.2
            while u + 5.4 <= u1:
                if fits(box(u + 0.15, va + 0.15, u + 5.25, vb - 0.15)):
                    out_lines.append(LineString([(u, va), (u, vb)]))
                    out_slots.append((u + 2.7, (va + vb) / 2, 0.0))
                    out_lines.append(LineString([(u + 5.4, va), (u + 5.4, vb)]))
                u += 5.6
        else:
            best = None
            for off in range(0, 16, 2):
                bands = []
                pos = v0 - off
                cyc = [("a", AISLE), ("b", BAY_D), ("b", BAY_D)]
                k = 0
                while pos < v1:
                    kind, ln = cyc[k % 3]
                    if kind == "b":
                        bands.append((pos, pos + ln))
                    pos += ln
                    k += 1
                cnt = 0
                lines, slots = [], []
                for va, vb in bands:
                    vva, vvb = max(va, v0), min(vb, v1)
                    if vvb - vva < 3.2:
                        continue
                    depth = vvb - vva
                    for kk in range(int((u1 - u0) / BAY_W) + 1):
                        uu = u0 + 0.3 + kk * BAY_W
                        if uu + BAY_W > u1:
                            break
                        if depth >= 4.2 and fits(box(uu + 0.1, vva + 0.1, uu + BAY_W - 0.1, vva + min(depth, BAY_D) - 0.1)):
                            slots.append((uu + BAY_W / 2, (vva + vvb) / 2 if depth <= BAY_D + 0.1 else vva + BAY_D / 2, 90.0))
                        ln_ = LineString([(uu, vva), (uu, vvb)]).intersection(loc.buffer(-0.2))
                        for q in lines_of(ln_):
                            if q.length > 1.2:
                                lines.append(q)
                if best is None or len(slots) > len(best[1]):
                    best = (lines, slots)
            if best:
                out_lines, out_slots = best
        for l in out_lines:
            self.bays.append(SA.affine_transform(l, to_w))
        th_w = math.degrees(math.atan2(to_w[2], to_w[0]))        # world angle of the local u axis
        for (uc, vc, a) in out_slots:
            x = to_w[0] * uc + to_w[1] * vc
            z = to_w[2] * uc + to_w[3] * vc
            self.slots.append((x, z, (th_w + a) % 360))

    # ---------------------------------------------------------------------
    def make_rails(self):
        W = self.W
        self.rail_lines = []
        for ln, t in W.rails:
            if t.get("railway") == "funicular":
                continue
            self.rail_lines.append(ln)
        # the CFL Pfaffenthal line is missing in the OSM extract (surveyed once, see luxtram_decks.py)
        self.rail_lines.append(LineString([(-2247.0, -1560.0), (-2247.0, -1180.0)]))
        self.ballast = unary_union([l.buffer(2.6, cap_style=2) for l in self.rail_lines]) if self.rail_lines else Polygon()

    # ---------------------------------------------------------------------
    def make_decks(self):
        self.decks = []
        for r in self.deck_roads:
            L = r.line
            if L.length < 3:
                continue
            n = max(2, int(L.length // 3.0))
            ss = np.linspace(0, L.length, n + 1)
            pts, ys = [], []
            for s in ss:
                p = L.interpolate(float(s))
                a = L.interpolate(max(0.0, float(s) - 1.0))
                b = L.interpolate(min(L.length, float(s) + 1.0))
                dx, dz = b.x - a.x, b.y - a.y
                dl = math.hypot(dx, dz) or 1.0
                rx, rz = -dz / dl, dx / dl
                lat = np.linspace(-0.6 * r.hw, 0.6 * r.hw, 5) if r.hw > 1.2 else np.array([0.0])
                X = p.x + rx * lat
                Z = p.y + rz * lat
                ds = self.dsm.at(X, Z)
                g = float(self.dtm.at(np.array([p.x]), np.array([p.y]))[0])
                dm = float(np.nanmin(ds)) if np.isfinite(ds).any() else g
                pts.append((p.x, p.y))
                ys.append((g, dm))
            g = np.array([a for a, b in ys]); d = np.array([b for a, b in ys])
            ok = np.isfinite(g)
            if ok.sum() < 2:
                continue
            xs_ = np.arange(len(g))
            g = np.interp(xs_, xs_[ok], g[ok])
            d = np.where(np.isfinite(d), d, g)
            deck = np.where(np.isfinite(d) & (d - g > 0.7), d, g)
            # despike (vehicles, canopy under the deck edge) and smooth
            deck = ndi.median_filter(deck, size=5, mode="nearest")
            deck = ndi.uniform_filter1d(deck, size=5, mode="nearest")
            # where the deck is at ground level (ramps) follow the ground
            hgt = deck - g
            deck = np.where(hgt < 0.45, g, deck)
            if (hgt > 1.5).sum() < 2:
                continue      # a culvert / low slab: the ground mesh carries it
            self.decks.append({"r": r, "pts": pts, "y": [float(v) for v in deck], "g": [float(v) for v in g]})
        log("  bridge decks", len(self.decks))

    def make_water_levels(self):
        W = self.W
        self.water_items = []
        polys = []
        for p in polys_of(self.water):
            if p.area < 8:
                continue
            ring = list(p.exterior.coords)
            xs = np.array([c[0] for c in ring[::max(1, len(ring) // 24)]])
            zs = np.array([c[1] for c in ring[::max(1, len(ring) // 24)]])
            h = self.dtm.at(xs, zs)
            h = h[np.isfinite(h)]
            if len(h) == 0:
                continue
            self.water_items.append((p.simplify(0.15), float(np.percentile(h, 35)) - 0.05))


# ----------------------------------------------------------------------------------------------------------------------------- dashes
DASH = {1: (2.0, 4.0), 2: (1.5, 3.5), 3: None, 4: None}
MARK_W = {1: 0.12, 2: 0.12, 3: 0.14, 4: 0.15}


def dashes_of(line, on, off, phase=1.0):
    out = []
    s = phase
    L = line.length
    while s < L:
        e = min(L, s + on)
        if e - s > 0.3:
            seg = shapely_substring(line, s, e)
            if seg is not None and not seg.is_empty and seg.length > 0.2:
                out.append(seg)
        s += on + off
    return out


# ----------------------------------------------------------------------------------------------------------------------------- tiles
def poly_list(g):
    return [p for p in polys_of(g) if not p.is_empty and p.area > 0.02]


class Layer:
    """spatial index over a list of shapely geometries"""

    def __init__(self, geoms):
        self.g = list(geoms)
        self.t = STRtree(self.g) if self.g else None

    def query(self, bx):
        if not self.t:
            return []
        return [self.g[i] for i in self.t.query(bx)]


def flat_ring(coords, x0, z0):
    out = []
    for (x, z) in coords[:-1] if len(coords) > 3 and coords[0] == coords[-1] else coords:
        out.append(int(round((x - x0) * 100)))
        out.append(int(round((z - z0) * 100)))
    return out


def flat_poly(p, x0, z0):
    rings = [flat_ring(list(p.exterior.coords), x0, z0)]
    for h in p.interiors:
        if Polygon(h).area > 0.2:
            rings.append(flat_ring(list(h.coords), x0, z0))
    return rings


def rasterize_into(arr, shapes, transform, value_fn=None):
    """paint (geom, value) shapes onto arr (in place, in order)"""
    shapes = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
    if not shapes:
        return
    rasterio.features.rasterize(shapes, out=arr, transform=transform, all_touched=False)


def inpaint(arr, mask):
    if not mask.any() or mask.all():
        return arr
    idx = ndi.distance_transform_edt(mask, return_distances=False, return_indices=True)
    return arr[idx[0], idx[1]]


SHADE_N = 64            # ambient-occlusion map: 2 m / px
_bld_layer = {}


def shade_map(W, bx, x0, z0):
    """Ground darkening next to buildings (soft contact shadow / street-canyon occlusion), baked from the OSM footprints: 255 = open ground."""
    if "t" not in _bld_layer:
        _bld_layer["t"] = Layer(poly_list(W.bld))
    pad = 12.0
    big = box(x0 - pad, z0 - pad, x0 + TILE + pad, z0 + TILE + pad)
    n = SHADE_N + int(2 * pad / 2.0)
    tr = Affine(2.0, 0, x0 - pad, 0, 2.0, z0 - pad)
    m = np.zeros((n, n), np.uint8)
    shapes = [(g.intersection(big), 1) for g in _bld_layer["t"].query(big)]
    shapes = [(g, v) for g, v in shapes if not g.is_empty]
    if shapes:
        rasterio.features.rasterize(shapes, out=m, transform=tr)
    d = ndi.distance_transform_edt(m == 0) * 2.0
    ao = 1.0 - 0.34 * np.exp(-d / 3.2)
    ao[m == 1] = 1.0
    ao = ndi.gaussian_filter(ao, 0.8)
    o = int(pad / 2.0)
    return np.clip(ao[o:o + SHADE_N, o:o + SHADE_N] * 255, 0, 255).astype(np.uint8)


def build_tiles(W, Gm, only=None, dtm_at=None):
    os.makedirs(os.path.join(OUT, "g"), exist_ok=True)
    lay = {
        "carriage": Layer(poly_list(Gm.carriage)),
        "sidewalk": Layer(poly_list(Gm.sidewalk)),
        "kerbs": Layer(Gm.kerbs),
        "ballast": Layer(poly_list(Gm.ballast)),
        "rails": Layer(Gm.rail_lines),
        "bays": Layer(Gm.bays),
        "plat": Layer(sum([poly_list(p) for p in W.platforms if not isinstance(p, LineString)], [])),
        "veg": Layer([]),
    }
    slots_arr = np.array(Gm.slots, float).reshape(-1, 3)
    path_layers = {c: Layer(v) for c, v in Gm.paths.items()}
    water_layer = Layer(poly_list(Gm.water))
    # dashes and solid marks
    solids, dashes = [], []        # (kind, geom)
    for kind, ln in Gm.marks:
        d = DASH.get(kind)
        if d is None:
            solids.append((kind, ln))
        else:
            for s in dashes_of(ln, d[0], d[1]):
                dashes.append((kind, s))
    for b in Gm.bays:
        solids.append((5, b))
    solid_layer = Layer([g for k, g in solids]); solid_kind = {id(g): k for k, g in solids}
    dash_layer = Layer([g for k, g in dashes]); dash_kind = {id(g): k for k, g in dashes}
    quad_polys = [Polygon(q) for k, q in Gm.quads]
    quad_layer = Layer(quad_polys)
    # vegetation / hard area layers
    veg_items = [(c, p, force) for c, polys, force in W.veg for p in polys if not p.is_empty]
    veg_items.sort(key=lambda e: -e[1].area)
    veg_layer = Layer([e[1] for e in veg_items]); veg_info = {id(e[1]): e for e in veg_items}
    hard_items = [(c, p) for c, polys in W.hard for p in polys if not p.is_empty]
    hard_layer = Layer([e[1] for e in hard_items]); hard_info = {id(e[1]): e for e in hard_items}
    park_layer = Layer([p for p in W.parking if not p.is_empty])
    # bridge decks high above the ground hide the real ground below: their footprint is inpainted in the class map
    deck_foot = unary_union([d["r"].line.buffer(d["r"].hw + 1.0) for d in Gm.decks if max(np.array(d["y"]) - np.array(d["g"])) > 3.0]) if Gm.decks else Polygon()
    deck_foot_layer = Layer(poly_list(deck_foot))
    # deck pieces per tile
    deck_pieces = defaultdict(list)
    for d in Gm.decks:
        r = d["r"]
        pts, ys = d["pts"], d["y"]
        cur, cur_tile = [], None
        for k in range(len(pts) - 1):
            mx, mz = (pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2
            tk = (int(math.floor(mx / TILE)), int(math.floor(mz / TILE)))
            if tk != cur_tile:
                if cur:
                    deck_pieces[cur_tile].append((r, cur))
                cur, cur_tile = [k], tk
            else:
                cur.append(k)
        if cur:
            deck_pieces[cur_tile].append((r, cur))
        d["__pieces"] = True
    deck_by_road = {id(d["r"]): d for d in Gm.decks}

    keys = only or W.tiles
    n_done = 0
    total_bytes = 0
    for key in keys:
        i, j = map(int, key.split("_"))
        x0, z0 = i * TILE, j * TILE
        bx = box(x0, z0, x0 + TILE, z0 + TILE)
        bxm = bx.buffer(2.0)
        tr = Affine(RES, 0, x0, 0, RES, z0)
        arr = W.base_tile(key, tile_ndsm(W.dtm, W.dsm, i, j))
        # hide the real ground below high decks
        foot = [g.intersection(bx) for g in deck_foot_layer.query(bx)]
        if foot:
            m = np.zeros((N, N), np.uint8)
            rasterio.features.rasterize([(g, 1) for g in foot if not g.is_empty], out=m, transform=tr)
            arr = inpaint(arr, m.astype(bool))
        # hard areas, parking, ballast, platforms, water
        hs = [(g.intersection(bx), hard_info[id(g)][0]) for g in hard_layer.query(bxm)]
        rasterize_into(arr, hs, tr)
        rasterize_into(arr, [(g.intersection(bx), ASPH) for g in park_layer.query(bxm)], tr)
        rasterize_into(arr, [(g.intersection(bx), PAVE) for g in lay["plat"].query(bxm)], tr)
        rasterize_into(arr, [(g.intersection(bx), GRAVEL) for g in lay["ballast"].query(bxm)], tr)
        rasterize_into(arr, [(g.intersection(bx), WATER) for g in water_layer.query(bxm)], tr)
        for code, pl in path_layers.items():
            c = {0: PAVE, 1: GRAVEL, 2: SETT, 3: ASPH, 4: PAVE}[code]
            rasterize_into(arr, [(g.intersection(bx), c) for g in pl.query(bxm)], tr)
        rasterize_into(arr, [(g.intersection(bx), PAVE) for g in lay["sidewalk"].query(bxm)], tr)
        rasterize_into(arr, [(g.intersection(bx), ASPH) for g in lay["carriage"].query(bxm)], tr)
        # soften one-pixel specks of the classification (the mode filter is applied to veg classes only so crisp road edges survive)
        # ------------------------------------------------------------------ vector layers
        V = {}
        def rings_of(geoms, clip=True):
            out = []
            for g in geoms:
                for p in poly_list(g.intersection(bx) if clip else g):
                    out.append(flat_poly(p, x0, z0))
            return out
        a = rings_of(lay["carriage"].query(bx))
        if a:
            V["a"] = a
        s = rings_of(lay["sidewalk"].query(bx))
        if s:
            V["s"] = s
        k = []
        for g in lay["kerbs"].query(bx):
            for ln in lines_of(g.intersection(bx)):
                if ln.length > 0.5:
                    k.append(flat_ring(list(ln.coords) + [(0, 0)], x0, z0)[:-2] if False else [int(round(v)) for xz in ln.coords for v in ((xz[0] - x0) * 100, (xz[1] - z0) * 100)])
        if k:
            V["k"] = k
        p_out = []
        for code, pl in path_layers.items():
            for g in pl.query(bx):
                for p in poly_list(g.intersection(bx)):
                    p_out.append([code] + flat_poly(p, x0, z0))
        if p_out:
            V["p"] = p_out
        m_out = []
        for g in solid_layer.query(bx):
            kk = solid_kind[id(g)]
            for ln in lines_of(g.intersection(bx)):
                if ln.length > 0.15:
                    m_out.append([kk, int(MARK_W.get(kk, 0.1) * 100)] + [int(round(v)) for xz in ln.coords for v in ((xz[0] - x0) * 100, (xz[1] - z0) * 100)])
        if m_out:
            V["m"] = m_out
        d_out = defaultdict(list)
        for g in dash_layer.query(bx):
            kk = dash_kind[id(g)]
            c = g.centroid
            if not (x0 <= c.x < x0 + TILE and z0 <= c.y < z0 + TILE):
                continue
            co = list(g.coords)
            d_out[kk].extend([int(round((co[0][0] - x0) * 100)), int(round((co[0][1] - z0) * 100)), int(round((co[-1][0] - x0) * 100)), int(round((co[-1][1] - z0) * 100))])
        if d_out:
            V["d"] = [[kk, int(MARK_W[kk] * 100)] + v for kk, v in d_out.items()]
        q_out = []
        for g in quad_layer.query(bx):
            c = g.centroid
            if not (x0 <= c.x < x0 + TILE and z0 <= c.y < z0 + TILE):
                continue
            q_out.extend([int(round(v)) for xz in list(g.exterior.coords)[:4] for v in ((xz[0] - x0) * 100, (xz[1] - z0) * 100)])
        if q_out:
            V["q"] = q_out
        if len(slots_arr):
            sel = (slots_arr[:, 0] >= x0) & (slots_arr[:, 0] < x0 + TILE) & (slots_arr[:, 1] >= z0) & (slots_arr[:, 1] < z0 + TILE)
            pk = []
            for sx, sz, sa in slots_arr[sel]:
                pk += [int(round((sx - x0) * 100)), int(round((sz - z0) * 100)), int(round(sa)) % 360]
            if pk:
                V["pk"] = pk
        w_out = []
        for g in water_layer.query(bx):
            for p in poly_list(g.intersection(bx)):
                # every ring vertex carries the bank height of the terrain model (the river falls ~0.5 %): the surface is meshed between them
                rings = [p.exterior] + [r for r in p.interiors if Polygon(r).area > 1.0]
                ent = []
                for r in rings:
                    ls = LineString(list(r.coords)).segmentize(8.0)
                    co = list(ls.coords)[:-1]
                    xs = np.array([c[0] for c in co]); zs = np.array([c[1] for c in co])
                    h = dtm_at(xs, zs)
                    ok = np.isfinite(h)
                    if ok.sum() < 2:
                        h = np.full(len(co), np.nan)
                    else:
                        h = np.interp(np.arange(len(h)), np.arange(len(h))[ok], h[ok])
                        h = ndi.median_filter(h, size=5, mode="wrap")
                    ent.append([[int(round(v)) for c in co for v in ((c[0] - x0) * 100, (c[1] - z0) * 100)],
                                [int(round((v - 0.12) * 100)) if np.isfinite(v) else 0 for v in h]])
                if all(e[1][0] != 0 for e in ent):
                    w_out.append(ent)
        if w_out:
            V["w"] = w_out
        rl = []
        for g in lay["rails"].query(bx):
            for ln in lines_of(g.intersection(bx)):
                if ln.length > 1.0:
                    rl.append([int(round(v)) for xz in ln.coords for v in ((xz[0] - x0) * 100, (xz[1] - z0) * 100)])
        if rl:
            V["r"] = rl
        bal = rings_of(lay["ballast"].query(bx))
        if bal:
            V["b"] = bal
        dk = []
        for (r, ks) in deck_pieces.get((i, j), []):
            d = deck_by_road[id(r)]
            lo, hi = ks[0], ks[-1] + 1
            a0, a1 = max(0, lo - 1), min(len(d["pts"]) - 1, hi + 1)
            pts = d["pts"][a0:a1 + 1]
            ys = d["y"][a0:a1 + 1]
            gs = d["g"][a0:a1 + 1]
            flat = [int(round(v)) for q in pts for v in ((q[0] - x0) * 100, (q[1] - z0) * 100)]
            dk.append({"c": r.cls, "h": int(round(r.hw * 100)), "o": 1 if r.oneway else 0, "n": r.lanes, "pre": lo - a0, "post": a1 - hi, "p": flat,
                       "y": [int(round(v * 100)) for v in ys], "g": [int(round(v * 100)) for v in gs], "s": 2 if r.surf in SETT_SURF else (1 if r.surf in GRAVEL_SURF else 0)})
        if dk:
            V["x"] = dk
        # ------------------------------------------------------------------ write
        import io
        im = Image.fromarray((arr.astype(np.uint16) * 32).astype(np.uint8), "L")       # grey = class * 32 (robust against colour management)
        bio = io.BytesIO()
        im.save(bio, "PNG", optimize=True)
        png = bio.getvalue()
        shade = shade_map(W, bx, x0, z0)
        bio = io.BytesIO()
        Image.fromarray(shade, "L").save(bio, "PNG", optimize=True)
        sh = bio.getvalue()
        js = json.dumps(V, separators=(",", ":")).encode()
        with open(os.path.join(OUT, "g", key + ".bin"), "wb") as fh:
            fh.write(b"LG2\0" + struct.pack("<III", len(png), len(sh), len(js)) + png + sh + js)
        total_bytes += len(png) + len(sh) + len(js) + 16
        n_done += 1
        if n_done % 50 == 0:
            log("  tiles", n_done, "/", len(keys), "%.1f MB" % (total_bytes / 1e6))
    log("tiles done", n_done, "%.2f MB" % (total_bytes / 1e6))


def far_ndsm(key, n):
    p = os.path.join(G.RAW_GEO, "far", "h_%s.npz" % key)
    if not os.path.exists(p):
        return None
    f = np.load(p)
    nd = np.nan_to_num(f["dsm"] - f["dtm"], nan=0.0)
    m = nd.shape[0]
    u = (np.arange(n) + 0.5) * ((m - 1) / n)
    uu, vv = np.meshgrid(u, u)
    return ndi.map_coordinates(nd, [vv, uu], order=1, mode="nearest")


def build_far(W, Gm):
    """Far ring class maps (640 m tiles, 4 m/px): the same recipe as the near tiles at lower resolution: context defaults + LiDAR canopy stands + OSM
    vegetation / water / main roads where OSM data exists.  No photo."""
    os.makedirs(os.path.join(OUT, "f"), exist_ok=True)
    FN = FAR_N
    px_m = FAR_TILE / FN
    water_layer = Layer(poly_list(Gm.water))
    road_layer = Layer([r.line.buffer(max(r.hw, 2.2), cap_style=2) for r in Gm.ground_roads if r.cls <= 3])
    hard_items = [(c, p) for c, polys in W.hard for p in polys if not p.is_empty]
    hard_layer = Layer([e[1] for e in hard_items]); hard_info = {id(e[1]): e for e in hard_items}
    park_layer = Layer([p for p in W.parking if not p.is_empty])
    n = 0
    for key in W.far:
        i, j = map(int, key.split("_"))
        x0, z0 = i * FAR_TILE, j * FAR_TILE
        bx = box(x0, z0, x0 + FAR_TILE, z0 + FAR_TILE)
        nd = far_ndsm(key, FN)
        arr, can, urb, ctxm = W.default_classes(bx, x0, z0, FN, px_m, nd, far=True)
        ov, forced = W.veg_raster(bx, x0, z0, FN, px_m, urb)
        osm_soft = ov != 255
        arr = np.where(osm_soft, ov, arr)
        if can is not None and can.any():
            lab, nlab = ndi.label(can)
            if nlab:
                areas = ndi.sum(can, lab, index=np.arange(1, nlab + 1)) * px_m * px_m
                keep = np.zeros(nlab + 1, bool)
                keep[1:] = areas >= 500.0
                stand = keep[lab]
                arr = np.where(stand & ~forced & ~(np.isin(arr, (ASPH, SETT)) & ~osm_soft), FOREST, arr)
        sm = mode_filter(arr, 8, 3)
        arr = np.where(osm_soft, arr, sm)
        arr = drop_small(arr, osm_soft, 6)
        tr = Affine(px_m, 0, x0, 0, px_m, z0)
        rasterize_into(arr, [(g.intersection(bx), hard_info[id(g)][0]) for g in hard_layer.query(bx)], tr)
        rasterize_into(arr, [(g.intersection(bx), ASPH) for g in park_layer.query(bx)], tr)
        rasterize_into(arr, [(g.intersection(bx), WATER) for g in water_layer.query(bx)], tr)
        rasterize_into(arr, [(g.intersection(bx), ASPH) for g in road_layer.query(bx)], tr)
        Image.fromarray((arr.astype(np.uint16) * 32).astype(np.uint8), "L").save(os.path.join(OUT, "f", "c_%s.png" % key), optimize=True)
        n += 1
    log("far tiles", n)


def main():
    steps = sys.argv[1:] or ["tiles"]
    from build_luxtram_geo import HGrid
    W = World()
    dtm, dsm = HGrid("dtm"), HGrid("dsm")
    W.load_base(dtm, dsm)
    Gm = Geo(W, dtm, dsm)
    if "debug" in steps:
        import pickle
        return W, Gm
    if "tiles" in steps:
        only = [a for a in steps if "_" in a and a[0] in "-0123456789"]
        build_tiles(W, Gm, only or None, dtm.at)
    if "far" in steps:
        build_far(W, Gm)


if __name__ == "__main__":
    main()
