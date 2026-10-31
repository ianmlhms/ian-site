#!/usr/bin/env python3
"""W5: a building without LOD2 faces (OSM footprint + height, extruded by the renderer) stands on its LOWEST ground, not on the median one.

The older builders (Luxembourg OSM-only buildings, Rheinland-Pfalz) set `base` from the median relief under the footprint, so on a slope the downhill side of 31 buildings hung 1.7 - 5 m
above the ground (patch_geometry_check floating test, OPEN since W4).  The W4 builder (France / Belgium) already uses the lowest ground.  This sets base = lowest DEM height under the
footprint (vertices, edge middles, centre) for every faceless building whose base is more than TOL above it; `h` stays (eave height above the base: the uphill side is buried, like a house on a slope).
    patch_faceless_base.py [key ...] [--dry]      keys: patch file stems (luxembourg, arlon.h, ...); default all"""
import base64, glob, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '..', '..', 'pb', 'train-sim', 'data', 'stations')
TOL = 0.3
args = [a for a in sys.argv[1:] if not a.startswith('--')]
dry = '--dry' in sys.argv
files = sorted(f for f in glob.glob(os.path.join(D, '*.json')) if not os.path.basename(f).startswith('index') and not f.endswith('.c.json'))
total = fixed = 0
for f in files:
    stem = os.path.basename(f)[:-5]
    if args and stem not in args: continue
    d = json.load(open(f))
    dem = d.get('dem')
    if not dem and stem.endswith('.h'):
        core = os.path.join(D, stem[:-2] + '.c.json')
        if os.path.exists(core): dem = json.load(open(core)).get('dem')
    if not dem: continue
    h = np.frombuffer(base64.b64decode(dem['dm']), dtype='<i2').reshape(dem['nz'], dem['nx']) * 0.1
    def at(x, z):
        ix = int(round((x - dem['x0']) / dem['res'])); iz = int(round((z - dem['z0']) / dem['res']))
        if ix < 0 or iz < 0 or ix >= dem['nx'] or iz >= dem['nz']: return None
        return float(h[iz, ix])
    changed = 0
    for b in d.get('buildings', []):
        if b.get('roofs') or b.get('walls'): continue
        g = b['ground']
        if len(g) < 3: continue
        pts = list(g) + [[(g[i][0] + g[(i + 1) % len(g)][0]) / 2, (g[i][1] + g[(i + 1) % len(g)][1]) / 2] for i in range(len(g))]
        pts.append([sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)])
        ys = [y for y in (at(p[0], p[1]) for p in pts) if y is not None]
        total += 1
        if ys and b.get('base', 0) - min(ys) > TOL:
            b['base'] = round(min(ys), 2); changed += 1; fixed += 1
    if changed:
        print('%-26s %d faceless buildings lowered to their lowest ground' % (stem, changed))
        if not dry:
            with open(f, 'w') as fh: json.dump(d, fh, separators=(',', ':'), ensure_ascii=False)
print('faceless buildings %d, lowered %d' % (total, fixed))
