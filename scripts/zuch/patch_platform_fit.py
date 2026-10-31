#!/usr/bin/env python3
"""W5: fits the player's platform to the real buildings of a station patch (nothing standing on the platform).

The game's platform of the player's track has a default width (5.2 m, 7 m for big stations, `pw` of the route) and the real OSM / LOD2 buildings of the patch often stand closer than that
(a house 2.5 m behind the kerb: the platform ran into its wall).  For every station with a patch this tool intersects the platform rectangle (x = side * [edge, edge + width],
z = -(s - sMid) over platformStart..platformEnd, from the audit json of scripts/zuch/station_audit.mjs) with the footprints of the buildings that the renderer draws, and writes
    "fit": { "w": <platform width m>, "drop": [<building ids not drawn>] }
into the patch (core half of a split patch, else the patch file).  Rules:
  * a building that is not the styled station building and that reaches into the platform: if the platform narrowed to (its distance to the track - edge - GAP) is still >= MIN_W the
    platform gets that width (the real platform ends at the facade), else the building is dropped (a house / shed 2 m behind a platform is not worth a 3 m platform);
  * a styled / osm-kind station building is real and stays: the platform narrows down to MIN_W_STATION at most;
  * footprints under 4 m2 or reaching less than 0.5 m into the platform are ignored.
    patch_platform_fit.py audit.json [--model model-footprint.json] [--skip Name,Name] [--dry]
  --model (scripts/zuch/model_footprint.mjs): the cells where the station's own photo / hand model stands; a drawn OSM building (not the styled station building) with >= MODEL_COVER of its
  footprint in these cells is dropped as well (the model draws its own hall: a real footprint under it is something inside something else).
Run it AFTER the patch is (re)built / split: build_station_patch.py and split_station_patches.py do not write `fit`."""
import json, os, sys, unicodedata
from shapely.geometry import Polygon, box
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '..', '..', 'pb', 'train-sim', 'data', 'stations')
MIN_W, MIN_W_STATION, GAP, MIN_AREA, MIN_PEN = 3.0, 3.0, 0.4, 4.0, 0.5
args = sys.argv[1:]
skip = set(args[args.index('--skip') + 1].split(',')) if '--skip' in args else set()
dry = '--dry' in args
model = json.load(open(args[args.index('--model') + 1])) if '--model' in args else {}
MODEL_COVER = 0.35
SMALL_LEN, SMALL_AREA = 12.0, 25.0      # a shed / hut shorter than this along the platform is dropped, never worth a narrower platform
rows = json.load(open(args[0]))
idx = {}
for f in ('index.json', 'index-routes.json'):
    idx.update(json.load(open(os.path.join(D, f)))['stations'])
def paths(key):
    c = os.path.join(D, key + '.c.json')
    return (c, os.path.join(D, key + '.h.json')) if os.path.exists(c) else (os.path.join(D, key + '.json'), None)
done = {}
for r in rows:
    name = r['name']
    if not r.get('hasPatch') or name in skip: continue
    k = idx.get(r['route'] + '/' + name) or idx.get(name)
    if not k: continue
    base = r['pw'] or (7.0 if (r.get('size') or 0) >= 3 else 5.2)
    cpath, hpath = paths(k)
    core = json.load(open(cpath)); heavy = json.load(open(hpath)) if hpath else core
    side = 1 if r['side'] == 'right' else -1
    edge = 1.7
    zs = sorted([-(r['plat'][1] - r['sMid']), -(r['plat'][0] - r['sMid'])])
    rings = [Polygon(pl['ring']).buffer(0) for pl in heavy.get('platforms', []) if len(pl['ring']) > 2]
    def rect(w):
        x0, x1 = sorted([side * edge, side * (edge + w)]); return box(x0, zs[0], x1, zs[1])
    drawn = []
    for b in heavy['buildings']:
        if b.get('station') and not (r.get('style') or r.get('osm')): continue
        try: p = Polygon(b['ground']).buffer(0)
        except Exception: continue
        if any(ring.contains(p.centroid) for ring in rings) or b['id'] in r.get('skipIds', []): continue
        drawn.append((b, p, bool(b.get('station'))))
    w, drop, notes = base, [], []
    rc = rect(base)
    for b, p, is_station in drawn:
        inter = p.intersection(rc)
        if inter.is_empty or inter.area < MIN_AREA: continue
        bx0, bz0, bx1, bz1 = inter.bounds
        if (bx1 - bx0) < MIN_PEN: continue
        dmin = min(abs(bx0), abs(bx1))                    # distance of the intruding part to the track axis
        fitw = dmin - edge - GAP
        if is_station:
            w = min(w, max(MIN_W_STATION, fitw)); notes.append('station %s fitw %.1f' % (b['id'], fitw))
        elif fitw >= MIN_W and (bz1 - bz0) >= SMALL_LEN and inter.area >= SMALL_AREA:
            w = min(w, fitw); notes.append('narrow to %.1f by %s' % (fitw, b['id']))
        else:
            drop.append(b['id']); notes.append('drop %s (%.0f m2, %.1f m in)' % (b['id'], inter.area, bx1 - bx0))
    # what still intrudes after the narrowing: dropped as well (except the station building)
    rn = rect(w)
    for b, p, is_station in drawn:
        if b['id'] in drop or is_station: continue
        inter = p.intersection(rn)
        if not inter.is_empty and inter.area >= MIN_AREA * 0.5 and (inter.bounds[2] - inter.bounds[0]) >= MIN_PEN * 0.6:
            drop.append(b['id']); notes.append('drop %s after narrowing' % b['id'])
    mf = model.get(r['route'] + '/' + name)
    if mf:
        cell = mf['cell']; occ = {tuple(c) for c in mf['cells']}
        for b, p, is_station in drawn:
            if is_station or b['id'] in drop: continue
            x0, z0, x1, z1 = p.bounds
            tot = hit = 0
            for ix in range(int(x0 // cell), int(x1 // cell) + 1):
                for iz in range(int(z0 // cell), int(z1 // cell) + 1):
                    sq = box(ix * cell, iz * cell, (ix + 1) * cell, (iz + 1) * cell)
                    a = p.intersection(sq).area
                    if a <= 0: continue
                    tot += a
                    if (ix, iz) in occ: hit += a
            if tot > 0 and hit / tot >= MODEL_COVER:
                drop.append(b['id']); notes.append('drop %s under the model (%.0f%% of %.0f m2)' % (b['id'], 100 * hit / tot, tot))
    w = round(w, 2)
    fit = {'w': w, 'drop': sorted(set(drop))}
    if k in done:      # the same patch from another route: the narrower width and both drop lists
        fit = {'w': min(fit['w'], done[k]['w']), 'drop': sorted(set(fit['drop']) | set(done[k]['drop']))}
        if fit == done[k]: continue
    done[k] = fit
    print('%-22s %-9s base %.1f -> w %.2f drop %d  %s' % (name, r['route'], base, w, len(fit['drop']), '; '.join(notes)[:150]))
    if not dry:
        core['fit'] = fit
        with open(cpath, 'w') as fh: json.dump(core, fh, separators=(',', ':'), ensure_ascii=False)
