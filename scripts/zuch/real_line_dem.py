#!/usr/bin/env python3
"""Elevation lookups for the real-line pipeline: Copernicus GLO-30 (30 m, open, AWS COG tiles cached in ~/Library/Caches/zuch-work/dem).
Grades only need ~200 m smoothing, so the 30 m surface model is enough (it includes trees, which average out)."""
import math
import os
import urllib.request

import numpy as np
import pyproj
import rasterio

from osm_rail import WORK

DEM_DIR = os.path.join(WORK, "dem")
URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_%s_00_%s_00_DEM/Copernicus_DSM_COG_10_%s_00_%s_00_DEM.tif"
TO_WGS = pyproj.Transformer.from_crs(25832, 4326, always_xy=True)


def tile_file(lat, lon):
    la, lo = int(math.floor(lat)), int(math.floor(lon))
    ns = "N%02d" % la
    ew = "E%03d" % lo
    path = os.path.join(DEM_DIR, "%s_%s.tif" % (ns, ew))
    if not os.path.exists(path):
        os.makedirs(DEM_DIR, exist_ok=True)
        print("downloading DEM tile", ns, ew, flush=True)
        urllib.request.urlretrieve(URL % (ns, ew, ns, ew), path + ".part")
        os.replace(path + ".part", path)
    return path


class Dem:
    def __init__(self):
        self.ds = {}

    def _open(self, lat, lon):
        p = tile_file(lat, lon)
        if p not in self.ds:
            ds = rasterio.open(p)
            self.ds[p] = (ds, ds.read(1).astype(np.float32))
        return self.ds[p]

    def height(self, e, n):
        """Bilinear elevation (m) for UTM arrays e, n."""
        e = np.atleast_1d(np.asarray(e, float))
        n = np.atleast_1d(np.asarray(n, float))
        lon, lat = TO_WGS.transform(e, n)
        out = np.empty(len(e))
        for i in range(len(e)):
            ds, arr = self._open(lat[i], lon[i])
            col = (lon[i] - ds.transform.c) / ds.transform.a - 0.5
            row = (lat[i] - ds.transform.f) / ds.transform.e - 0.5
            c0, r0 = int(math.floor(col)), int(math.floor(row))
            fc, fr = col - c0, row - r0
            c0 = min(max(c0, 0), arr.shape[1] - 2)
            r0 = min(max(r0, 0), arr.shape[0] - 2)
            out[i] = (arr[r0, c0] * (1 - fc) * (1 - fr) + arr[r0, c0 + 1] * fc * (1 - fr) + arr[r0 + 1, c0] * (1 - fc) * fr + arr[r0 + 1, c0 + 1] * fc * fr)
        return out
