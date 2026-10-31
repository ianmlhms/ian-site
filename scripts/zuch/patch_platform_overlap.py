#!/usr/bin/env python3
"""Buildings (OSM footprints / LOD2) that stand on the player's platform: for every station of the audit json (scripts/zuch/station_audit.mjs) the platform rectangle of the game
(x from the track: side * [edge, edge + width], z = -(s - sMid) over platformStart..platformEnd) is intersected with the building footprints of the patch.
   patch_platform_overlap.py audit.json [--min 2] [--route R]
Prints one line per overlap: station, building id, kind, h, overlap m2, solid-wall flag (LOD2 wall faces in the rectangle), style canopy skip ids are listed in STYLE_SKIP."""
import json, os, sys, unicodedata
from shapely.geometry import Polygon, box
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '..', '..', 'pb', 'train-sim', 'data', 'stations')
args = sys.argv[1:]
PEN_MIN = float(args[args.index('--pen') + 1]) if '--pen' in args else 0.8
mn = float(args[args.index('--min') + 1]) if '--min' in args else 2.0
only = args[args.index('--route') + 1] if '--route' in args else None
rows = json.load(open(args[0]))
def key_of(n):
    s = unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode().lower()
    return ''.join(c if c.isalnum() else '-' for c in s).strip('-')
idx = {}
for f in ('index.json', 'index-routes.json'):
    idx.update(json.load(open(os.path.join(D, f)))['stations'])
def load(key):
    p = os.path.join(D, key + '.json')
    if os.path.exists(p): return json.load(open(p))
    c = json.load(open(os.path.join(D, key + '.c.json'))); h = json.load(open(os.path.join(D, key + '.h.json')))
    c.update({k: v for k, v in h.items() if k != 'v'}); return c
seen = set()
for r in rows:
    if only and r['route'] != only: continue
    if not r.get('hasPatch'): continue
    name = r['name']
    k = idx.get(r['route'] + '/' + name) or idx.get(name)
    if not k or (k, r['plat'][0]) in seen: continue
    seen.add((k, r['plat'][0]))
    d = load(k)
    side = 1 if r['side'] == 'right' else -1
    x0, x1 = sorted([side * r['edge'], side * (r['edge'] + r['width'])])
    zs = sorted([-(r['plat'][1] - r['sMid']), -(r['plat'][0] - r['sMid'])])
    rect = box(x0, zs[0], x1, zs[1])
    cpath = os.path.join(D, k + '.c.json'); drops = set(((json.load(open(cpath)) if os.path.exists(cpath) else d).get('fit') or {}).get('drop', []))   # W5: buildings the renderer drops (patch_platform_fit.py)
    rings = [Polygon(pl['ring']).buffer(0) for pl in d.get('platforms', []) if len(pl['ring']) > 2]
    for b in d['buildings']:
        try: p = Polygon(b['ground']).buffer(0)
        except Exception: continue
        # the renderer's own filters (station-surround-mesh.js): the flagged station building is drawn only with a style / an osm-kind station; a building whose centre lies on a platform polygon is not drawn
        if b.get('station') and not (r.get('style') or r.get('osm')): continue
        if any(ring.contains(p.centroid) for ring in rings): continue
        if b['id'] in r.get('skipIds', []) or b['id'] in drops: continue
        inter = p.intersection(rect)
        a = inter.area
        if a >= mn:
            # lateral penetration: how far the building reaches from the platform's far edge towards the track (m), and the stretch along the platform it does so over
            bx0, bz0, bx1, bz1 = inter.bounds
            far = x0 if side > 0 else x1          # the platform edge away from the track (building side)
            pen = (bx1 - bx0)
            near_gap = (min(abs(bx0), abs(bx1)) - r['edge'])   # < 0: the building reaches the platform edge / the track
            if pen < PEN_MIN: continue
            walls = 0
            for w in b.get('walls', []):
                xs = [q[0] for q in w]; zz = [q[2] for q in w]
                if min(xs) < x1 and max(xs) > x0 and min(zz) < zs[1] and max(zz) > zs[0] and max(q[1] for q in w) - min(q[1] for q in w) > 1.5: walls += 1
            print('%-22s %-9s %-24s %-10s h=%.1f st=%s  overlap %.0f m2 (rect %.0f) reaches %.1f m into the platform, z %.0f..%.0f, solid walls %d' % (name, r['route'], b['id'], b['kind'], b['h'], b.get('station', 0), a, rect.area, pen, bz0, bz1, walls))
