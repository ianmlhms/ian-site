# Zuchsimulator "zuchreal" - handoff after Wave 1

Worktree `/Users/Ian/Library/Caches/website-zuchreal`, branch `zuchreal` (based on origin/main 8199762a), commit often, **no push / no deploy / not main**.  The reviewer is Claude Opus.
Rules that matter (from the brief): painted realism only (no orthophoto anywhere visible), reference photos + photo | screenshot montage for every station touched, weather / time stay
player-choosable, one browser at a time (Mac mini 16 GB), iPad performance (instancing, quality levels), small new modules instead of growing the 140 KB files, don't break saves /
career / the Tramsimulator lock.  Reference photos live in `~/Library/Caches/zuch-refs/<Station>/` (NOT in the repo).  Open-data caches: `~/Library/Caches/zuch-work/`.
Python env for the data pipeline: `/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python`.

## Done and verified (numbers in the Wave 1 report)

* Crossing roads everywhere (plan / mesh / traffic).  Verified by flow `train-sim-world`: all crossings of all 9 rail routes have a planned road, reach >= 120 m on both sides, grade <= 11 %
  sample-to-sample (clamped to 5.5 %), terrain function = design height within 0.2 m, the strip mesh within +0.2 / -0.35 m of the road surface; vehicles queue at the stop line and flow again.
* Shared Mosel line: east / wittlich / trier have identical stations (+-6 m) and crossings; trier passes 11 stations; wittlich is registered (price 12 000, order after east, `~r` works).
* Munsbach: model + real patch; flow checks the patch is built (1 group, > 2000 triangles) and the corridor is flat.
* Hole detector (render + ray) in the flow for west and east; whole-line scans of all routes were run before / after the river-bridge fix (see the report).

## Done, not verified (or only by eye)

* iPad / WebKit performance (never run on WebKit here; only desktop Chrome).  Medium quality numbers were not collected.
* The crossing roads on the return directions (`~r`) were only checked by the flow's start check, not by screenshots.
* Night / rain look of the crossing roads and the Munsbach patch (materials are Lambert, so they follow the scene lights, but nobody looked).

## Open items (root causes and where to work)

1. **Weststrecke decision** (REAL-LINES.md): RB 83 uses the left bank since 3 Mar 2025 (Zewen, Euren, West, Pallien, Hafenstraße, no Trier Hbf / Ehrang).  Wave 1 follows the brief
   (via Kreuz Konz / Trier Süd / Trier Hbf / Ehrang).  Switching = edit the legs and station names between Igel and Schweich in `moselBody` (routes.js), keep `sceneryId`.
2. **Real level crossings** (REAL-LINES.md has the OSM list): replace the authored `X` flags on the Mosel line by the real ones; where a station patch exists the patch road is the
   crossing road (Munsbach: Rue de Beyren ~110-130 m ahead of the platform middle; today it is painted ground, tracks pass through it with no equipment).  Plan: add the crossing to
   `comp.crossings` in track.js from the patch road that crosses the corridor, mark it `real: true`, let `planCrossing` build only the infra record (no synthetic road) and let
   crossing-traffic use the patch road polyline.
3. **Munsbach vs photos** (montage in the report folder): platform kerb (concrete with recesses) and tan paver texture are generic, catenary masts are the generic ones (real: tall rusty
   concrete masts), the building's right block is taller in reality, no roof drain / gutters, the far platform has no shelter; patch roads are painted only: add 3D road ribbons
   with kerbs / markings from `data.roads` (see how crossing-roads-mesh.js builds ribbons) and traffic on them (crossing-traffic.js can take any polyline).
4. **More stations** (task 2 list): Lëtzebuerg Gare, Ettelbréck, Esch-Uelzecht, Belval-Université, Bettembuerg, Miersch, Clierf, Wasserbëlleg, Kautebaach, Pafendall-Kierchbierg are
   photo-modelled but have generic surroundings: `build_station_patch.py <key> --name ... --lat --lon --heading-hint ...`, then `reg()` side / z of the building from the
   patch (`station: 1` building ring), add the name to the loader index automatically (index.json is merged).  The Mosel line stations without a model (Roodt-Syr, Wecker, Igel,
   Kreuz Konz, Tréier Süd, Ehrang, Föhren, Hetzerath, Sehlem, Salmtal) need references + models.  Each needs photo | screenshot montage.
5. **Real line geometry** (REAL-LINES.md section 1): `scripts/zuch/build_real_line.py` does not exist yet.  Mosel line first (data: Geofabrik extract for Luxembourg; for Germany the
   Rheinland-Pfalz extract from download.geofabrik.de, ~400 MB; Overpass is blocked from this machine, SSL handshake failure).
6. **Pits / floating things**: the hole scan shows only hairline cracks (1-9 px) after the carve fix (probably chunk seams where the extra columns differ: see `valleyLats` margin in track.js and `extraLats` for roads / patches), but village road ribbons / lamps on steep valley walls under viaducts float (landscape.js
   `ribbonMesh` samples every 8 m, `addRoadRibbon` for villages in `buildChunk`); the water slab under river bridges is a plain rectangle (landscape.js water section).
7. Patch data limits: the straightening shrinks features on the inside of tight curves (Munsbach: tightest radius ~583 m, 73 % at 160 m lateral); DEM shows faint ghost edges of building
   footprints; trees are removed within 7.5 m of the track; sidewalks only where OSM tags them.
8. `train_sim_world.mjs` takes ~6 minutes (9 routes x crossing checks + hole scan on 2 routes); `run_all.mjs train` takes ~35 minutes in total.
9. check_site.py warns about `karttracker-ios-privacy.html` (orphan): pre-existing, not from this branch.
10. The luxtram files (`luxtram*.js`, `data/luxtram`) were not touched; the tram routes have no crossing roads (planner skips `kind === 'tram'`) and no hole scan yet (run
    `node scripts/zuch/hole_scan.mjs luxtram-kierchbierg,...`; the tram strip is `ownScenery`).

## How to run things

```
node scripts/flows/run_all.mjs train                      # all train flows incl. train-sim-world
node scripts/flows/run_all.mjs train-sim-world            # only the new world flow
node scripts/zuch/hole_scan.mjs west,east --step 300 --out <dir>     # render + ray hole detector, exit 1 on findings
node scripts/zuch/crossing_shots.mjs <dir> west,south,wittlich,north,metz,brussels [--root <other worktree>]
node scripts/zuch/crossing_cab.mjs <dir> west 0           # the driver's view, barriers closed, queue
node scripts/zuch/station_shots.mjs <dir> east Munsbach --focusZ -82 --forecourtLat 12 --tag v1   # 8 viewpoints; compare with the photos
$PY scripts/zuch/montage.py out.png --cols 2 --w 800 "caption=img.png" ...                         # photo | screenshot sheets
$PY scripts/zuch/build_station_patch.py munsbach --name Munsbach --lat 49.63055 --lon 6.26852 --heading-hint east
$PY scripts/zuch/check_station_patch.py pb/train-sim/data/stations/munsbach.json
```
Test hooks in the game: `?test=1` -> `__tsTest.setFreeCam({pos, look, fov})`, `placeAt(s, kmh)`, `internals()`, `trackInfo()`; `world.landscape.setHoleMode(on)`,
`.terrainMeshes()`, `.groundHeightAt(x, z)`, `.crossingTraffic()` (`.state()`, `.setClosed(s, bool)`, `.sites`).
The "before" screenshots were taken from a detached origin/main worktree with only the free-cam hook patched in (removed again).

## Reports / screenshots

`~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/zuchreal/w1/`: `crossings-before/`, `crossings-after/` (4 views per crossing), `montage-crossings/` (before | after per
crossing), `cab/` (driver's view with the queue), `munsbach/` (viewpoints + photo | screenshot montages), `holes/` (scan reports).
