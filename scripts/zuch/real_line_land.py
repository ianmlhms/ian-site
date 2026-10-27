#!/usr/bin/env python3
"""Land classes along a real centre line (OSM landuse / natural / place polygons), used for the biome tokens and for the scenery raster."""
import numpy as np
import shapely
from shapely import STRtree

# raster / biome classes
FIELD, MEADOW, FOREST, VINE, RESID, INDUS, WATER, ORCHARD, URBAN, SCRUB, QUARRY, CEMETERY, PARK, RAIL = range(14)
CLASS_NAMES = ["field", "meadow", "forest", "vine", "resid", "indus", "water", "orchard", "urban", "scrub", "quarry", "cemetery", "park", "rail"]
# later entries win where polygons overlap
PRIORITY = {RAIL: 7, WATER: 9, URBAN: 8, INDUS: 7, RESID: 6, QUARRY: 6, CEMETERY: 5, PARK: 5, VINE: 4, ORCHARD: 4, FOREST: 3, SCRUB: 3, MEADOW: 2, FIELD: 1}


def classify(t, rail=False):
    lu, nat, leis = t.get("landuse"), t.get("natural"), t.get("leisure")
    if nat == "water" or lu in ("reservoir", "basin"):
        return WATER
    if lu in ("commercial", "retail"):
        return URBAN
    if lu == "railway" and rail:
        return RAIL            # W3 (opt-in, abroad routes): railway land is bare ballast, not a ploughed field
    if lu == "industrial":
        return INDUS
    if lu in ("residential", "garages", "allotments") or t.get("place") in ("village", "hamlet", "town", "suburb", "neighbourhood", "city", "locality") and lu is None and nat is None:
        return RESID
    if lu in ("quarry",):
        return QUARRY
    if lu in ("cemetery",):
        return CEMETERY
    if lu in ("vineyard",):
        return VINE
    if lu in ("orchard",) or t.get("landuse") == "plant_nursery":
        return ORCHARD
    if lu == "forest" or nat == "wood":
        return FOREST
    if nat in ("scrub", "heath", "wetland", "grassland") or lu == "greenfield":
        return SCRUB
    if lu in ("meadow", "grass", "village_green", "recreation_ground") or leis in ("park", "garden", "pitch", "playground", "golf_course", "sports_centre", "stadium"):
        return PARK if leis else MEADOW
    if lu in ("farmland", "farmyard"):
        return FIELD
    return None


class LandIndex:
    def __init__(self, landuse_feats, rail=False):
        self.geoms, self.cls = [], []
        for f in landuse_feats:
            c = classify(f["t"], rail)
            g = f["g"]
            if c is None or g is None or g.is_empty:
                continue
            if g.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            if c == RESID and f["t"].get("place") and not f["t"].get("landuse"):
                continue            # place polygons without landuse are administrative areas, not built-up land
            self.geoms.append(g)
            self.cls.append(c)
        self.cls = np.array(self.cls)
        self.tree = STRtree(self.geoms)
        self.prio = np.array([PRIORITY[c] for c in self.cls])

    def add_rails(self, rail_geoms, dist=14.0):
        """W3 (abroad routes): land that no polygon covers but that lies within `dist` m of a railway=rail way (yards and sidings that nobody mapped as landuse=railway) is RAIL, not FIELD."""
        self.rail_tree = STRtree(list(rail_geoms)) if len(rail_geoms) else None
        self.rail_dist = dist

    rail_tree = None
    rail_dist = 14.0

    def at(self, e, n, default=FIELD, ids=False):
        """Class at points (vectorised): the highest-priority polygon covering each point.  ids=True also returns the polygon index (parcel id, -1 = none)."""
        e, n = np.asarray(e, float), np.asarray(n, float)
        pts = shapely.points(e, n)
        pi, gi = self.tree.query(pts, predicate="within")
        best = np.full(len(e), -1)
        out = np.full(len(e), default)
        pid = np.full(len(e), -1)
        for p, g in zip(pi, gi):
            if self.prio[g] > best[p] or (self.prio[g] == best[p] and self.geoms[g].area < self.geoms[pid[p]].area):
                best[p] = self.prio[g]
                out[p] = self.cls[g]
                pid[p] = g
        if self.rail_tree is not None and default == FIELD:
            free = np.nonzero(pid < 0)[0]
            if len(free):
                hit = np.unique(self.rail_tree.query(pts[free], predicate="dwithin", distance=self.rail_dist)[0])
                out[free[hit]] = RAIL
        return (out, pid) if ids else out
