# Zuchsimulator "zuchroutes" (W2c) - handoff

Worktree `/Users/Ian/Library/Caches/website-zuchroutes`, branch `zuchroutes` (from `zuchreal` / origin/main with Wave 2 of the home line).  Brief: `scratchpad/brief-zuch-routes.md` (+ `brief-zuch.md`).  Nothing pushed, nothing deployed.
Python: `/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python`.  Caches: `~/Library/Caches/zuch-work/` (`realline/route-*.pkl` = OSM corridor tiles of north / south / west, `abroad/*.osm.pbf` = Geofabrik Lorraine, Champagne-Ardenne,
Ile-de-France, Picardie, Belgium (1.4 GB, downloaded for the abroad routes), `osm-venv/` = pyosmium for route relations, `scratch/` probes).  Reference photos: `~/Library/Caches/zuch-refs/<Station>/` (+ `credits.json`).  Report dir:
`~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/zuchreal/w2c/`.  Disk is tight (15 GB free at the time): `~/Library/Caches/zuch-work/lod2/*.gml` (110 MB each, re-downloaded when needed) can be deleted.

## Done and verified (26 Oct 2026)

1. **Stop-list audit with sources** -> `REAL-LINES.md` "W2c: stop lists" (OSM route relations CFL-1 / CFL-50 / CFL-60 / CFL-70 / RE / IC-16 / TER C40+ / TGV 803B, de.wikipedia line 10 km list, sncf-connect).  Findings: west missing Mamer-Lycée and "Bartreng" is
   Bertrange-Strassen, the service goes on to Arlon; south has no Hollerich (line 70), 9 stops missing; north missing 9 stops; **paris: Champagne-Ardenne TGV IS served** (OSM 803B + sncf-connect timetable of 11 Jul 2026), Thionville is the missing
   stop; brussels: Kleinbettingen is not an IC stop.  metz / brussels / paris new stop lists are decided (see below) but NOT built.
2. **Generic single-line pipeline** `scripts/zuch/build_real_route.py` (+ `real_route_defs.py`, `fetch_route_corridor.py`): described in REAL-LINES.md "W2c: real geometry ...".  `real-west.js`, `real-south.js`, `real-north.js` (+ `data/real/<id>-layout.json`, `-features.json`)
   are generated.  `routes.js` uses them (`realLineBody`), ids unchanged.  west 6 stops, south 17, north 18 (Lëtzebuerg ... Clierf).  Re-run: `fetch_route_corridor.py` once, `build_real_route.py emit north|south|west`.
3. **JS**: `real-line.js` (per-route data, `TS.realLines`), `stations-osm.js` (OSM platform layouts for 19 stations without a photo model), `station-surround*.js` (index-routes.json, LOD2 station building drawn for OSM stations), `landscape.js` (seam fix, see REAL-LINES),
   `menu.js` fallback counts, `train-sim.html` scripts.  `stations-lu-a.js`: model key `Bartreng` -> `Bertrange-Strassen`.
4. **Station patches** (real LiDAR relief, LOD2 buildings, OSM ground, trees) for all 37 Luxembourg stations of the three routes except the Gare Centrale (`build_route_patches.py`; `data/stations/*.json` 23 MB, `index-routes.json`).
5. **Flow** `scripts/flows/train_sim_routes.mjs` (registered in `run_all.mjs`): PASS.  `train-sim-world` PASS (all routes' crossing roads reach >= 120 m).  Hole scans (step 300, `scripts/zuch/hole_scan.mjs`): north 0 / 0, west 0 / 0, south 0 poses / 6 terrain-function steps 0.5-1 m (mesh vs `groundHeightAt`, no gap).
   `check_site.py`: only the old karttracker-ios-privacy orphan.  `cv_head.py`: PROBLEMS: 0.  Full `node scripts/flows/run_all.mjs train` (26 Oct, after the last commit): 6/6 PASS (train-sim, -audio, -touch, -career-lock, -world, -routes).  Fixes needed for that: `train_sim.mjs` expects "RE · 5" (west has 6 stations), `sim.js` TSR clearances scale with short legs (the real legs are too short for the old 800 / 900 m clearances: 0 restrictions planned), `patch-crossings.js` adopts only gentle real roads (grade / reach / valley walls / patch fade), `train_sim_world.mjs` MAX_PATCH_ROAD_GRADE 0.18 -> 0.30.
6. Montage (cab sheets + aerial sheets per route): `reports/zuchreal/w2c/{north,south,west}-{cab,aerial}-sheet.png`; raw shots in the subfolders.


## Wave 2 (27 Oct 2026, reviewer fixes 1-5) - DONE, details + numbers in REAL-LINES.md "W2c: reviewer fixes"

1. White ground = the far-terrain safety plane in deep valleys: fixed in `landscape.js` (plane under `level.minH` on real routes).  2. Checkerboard river = water normal map aliasing: low wave numbers, stretched UVs, softer specular (also Mosel water).
3. Download size: `<key>.c.json` core (all stations of the selected route, 4 m relief) + `<key>.h.json` scenery half (streamed ahead of the train, first one awaited <= 6 s), failure falls back to generic scenery; start of a service south 1.44 MB raw / 0.40 MB gzip, north 1.80 / 0.51, west 0.73 raw.
   `scripts/zuch/split_station_patches.py` (run by `build_route_patches.py`), `download_probe.mjs`, flow steps in `train_sim_routes.mjs` (budgets, streaming after a jump, all halves blocked).  `zlib.mjs start()` loads all scenery halves unless `{ lazy: true }`.
4. WebKit / Chrome medium budgets met (REAL-LINES.md numbers).  5. Career: north price 24 000, others unchanged; `career_probe.mjs` / `drive_bot.mjs`.
Gates (27 Oct, commit 48122581): `run_all.mjs train` 6/6 PASS, hole scans north / south / west clean, check_site only the old orphan, cv_head PROBLEMS: 0.  Not pushed.

## Wave 3 (26 Oct 2026, items 6 + 7) - DONE, details in REAL-LINES.md "W2c: wave 3"

* **Station sides / positions (item 6)**: every photo-modelled big station now stands where OSM + the LOD2 station building of its patch put it: Ettelbréck hall moved to the far side (across the second track + old side platform; the served platform is the new island with the wavy canopy, lifts, next track at 13.2), Miersch hall 45 m
  forward (z -25 .. -3), island platform from OSM; Clierf hall at the Luxembourg end (z 94 .. 121 behind the stop), island platform / footbridge from OSM; Esch-Uelzecht hall 42 .. 95 m ahead (authored apartment blocks dropped: LOD2 has the real ones); Bettembuerg hall +22 m behind;
  Belval vault z -52 .. +62, pod at +70 over the platform end.  All mirrored in z for a reversed service.  Montages (photo | sim): `reports/zuchreal/w2c/station-montage-*.png`, raw shots + plan views in `w2c/st6/`.  Tools: `scripts/zuch/station_plan.mjs` (top-down plan with the OSM building outlines), `station_poses.mjs` (photo-match poses in the station frame).
* **Bug found on the way (station-surround-mesh.js)**: OSM platform roofs (building=roof tagged commercial) were drawn as 250 m long windowed walls along the platforms in every patch; buildings whose centre lies in a platform polygon are no longer drawn (the stations draw their own canopies).
* **Landmarks (item 7, partly)**: `real-landmarks.js` (+ hook in `landscape.js`, replaces the generic castle): Belval blast furnaces A / B (stack, stoves, dust catcher, hoist, chimney) at their OSM positions, Clervaux castle + Saint-Maurice abbey at their OSM bearing (hill landmarks pulled in to the strip edge: ground height unknown beyond it).
  NOT done of item 7: Esch / Schifflange / Differdange steelworks (OSM `Site ArcelorMittal` landuse is at Differdange 49.5224 .. 49.5382 N, 5.8932 .. 5.9069 E; halls + chimneys still missing), Bettembourg marshalling-yard tracks (`landuse=railway` unclassified).

## Still open (priority order) after wave 3

* Steelworks + Bettembourg yard (see above), abroad routes (item 8, plan below), Esch canopy columns are plain (photo: black cast-iron historic canopy).

## NOT done / open (priority order) - written after wave 1, see above for what changed

1. **Photo | sim montage of the big stations** (Ettelbréck, Esch-Uelzecht, Belval-Université, Bettembuerg, Miersch, Clierf): photos are fetched (`~/Library/Caches/zuch-refs/{Ettelbreck,Esch-Uelzecht,Belval-Universite,Bettembuerg,Miersch,Clierf}/`, Commons, CC BY-SA, `credits.json`;
   `python3 scripts/zuch/fetch_refs.py <Dir> "search" ...` fetches more).  The models exist (stations-lu-a.js: Esch `buildEsch`, Belval `buildBelval`, Bettembuerg; stations-lu-b.js: Miersch, Ettelbréck, Clierf) from an earlier photo pass, and now stand in their real patches.
   Not yet compared with the photos from the same viewpoint: use `node scripts/zuch/station_shots.mjs <dir> <route> <Station> --tag x` (views 1-9; `1-across` is hidden by the train, move it) or `view` / `pose_shot.mjs`, pair with `montage.py`.  The sides of the models may have flipped
   (the route sides now come from OSM: Pafendall right, Lëntgen right, Miersch left, Ettelbréck right, Kautebaach left, Wëlwerwolz right, Clierf left): the models mirror with `sx`, but check the building is on the real side.  The photo-modelled stations were not compared with the OSM platform layouts
   (`TS.realLines[id].stations[name].plat / trk`; e.g. extra platforms the model lacks).  Belval-Université: the blast furnaces A / B (OSM "Haut fourneau A" 49.50126 5.94802, "B" 49.50215 5.94821, 250 m NE of the station) come out of the LOD2 as dark extruded boxes (aerial shot south 8100):
   replace by a hand model (tower + stoves + pipes) and skip those footprints in the patch.
2. **Landmarks** (not started): Clervaux castle (OSM 50.05443 6.03014) and Saint-Maurice abbey (50.05717 6.0222) at their real positions (about 800 m / 550 m south of the station: seen on the approach), blast furnaces, Esch / Schifflange steelworks (OSM industrial polygons, no chimneys / halls yet),
   Bettembourg marshalling yard (the yard tracks are not drawn: `landuse=railway` is unclassified in `real_line_land.classify` -> field; a `railway_class` option for `LandIndex` + yard ribbons would fix it).  Plan: `landmarks` list per leg in the features JSON (like `places`), resolved in `real-line.js`,
   drawn by a new `real-landmarks.js`; `landscape.js` still has the hard-coded generic castle for `track.id === 'north'` (`L - 560`, right 120 m) to replace.
3. **Abroad routes (metz, brussels, paris)** - not started.  Decided stop lists (REAL-LINES.md): metz = TER C40+ Lux - Howald - Bettembourg - Hettange-Grande - Thionville - Uckange - Hagondange - Walygator Parc - Metz - Pagny-sur-Moselle - Pont-à-Mousson - Nancy;
   brussels = IC 16 Lux - Arlon - Marbehan - Libramont - Rochefort-Jemelle - Marloie - Ciney - Namur - Gembloux - Ottignies - Bruxelles-Luxembourg - (Schuman, Nord, Central underground, not modelled as stops) - Midi; paris = Lux - Thionville - Metz - Champagne-Ardenne TGV - Paris-Est.
   Station coordinates found: Hettange-Grande 49.40776 6.15678, Thionville 49.35400 6.16997, Uckange 49.30346 6.15627, Hagondange 49.25383 6.16417 (only `railway=stop`), Walygator Parc 49.22391 6.15964, Metz 49.10899 6.17734, Pagny-sur-Moselle 48.98548 6.02546 (stop), Pont-à-Mousson 48.90026 6.05063,
   Nancy 48.68973 6.17378; Belgium: Arlon 49.68042 5.80953, Marbehan 49.72742 5.53939, Libramont 49.92024 5.37931, Rochefort-Jemelle 50.15998 5.26716, Marloie 50.20250 5.31396, Ciney 50.29138 5.09145, Namur 50.46866 4.86253, Gembloux 50.57018 4.69111, Ottignies 50.67456 4.56856,
   Bruxelles-Luxembourg 50.83820 4.37365, Midi 50.83578 4.33605.  `stop_node(.., hint)` already falls back to the hint coordinates.  Needed: (a) corridor tiles from `~/Library/Caches/zuch-work/abroad/*.osm.pbf` (Lorraine, Champagne-Ardenne, Ile-de-France, Belgium): a two-stage fetch
   (rails only for a wide box -> Dijkstra path -> tiles along the path for the other layers), `fetch_route_corridor.py` `TILES` only has the Luxembourg tiles; (b) `real_route_defs.py` entries with route parameters (`PARAMS` in `build_real_route.py` is global: `per_real` 0.15 / min 600 / max 2800 for metz, 0.05 / 700 / 3000 for brussels, 0.05 / 1500 / 8500 for paris would keep
   the old game lengths; make them part of the route def); (c) DEM tiles (auto-download, Copernicus), (d) generic stations + silhouettes for Metz-Ville, Namur, Bruxelles-Midi, Paris-Est (models exist in `stations-abroad.js`, built for the old authored sides - compare with `plat` / side);
   (e) the stop relations are reproducible with `~/Library/Caches/zuch-work/osm-venv/bin/python scripts/zuch/osm_route_relations.py <pbf> "<regex>"`.
4. **west to Arlon / line 70**: the CFL-50 service ends in Arlon (3 km, Belgium); the game route ends at Kleinbettingen on purpose.  Line 70 (Lux - Hollerich - Leudelange - Dippach-Reckange - Schouweiler - Bascharage-Sanem - Pétange - Lamadelaine - Rodange) as an own route is optional and not built (Hollerich's model stays registered).
5. **Quality leftovers**: (a) a pale / white ground band at the horizon beside Esch / Differdange (south aerial 008100 / 011400: far ground beyond the far raster?); (b) the 6 terrain-function steps on the south valley walls (s 8795, 11675, 15185: relief data changes between legs);
   (c) the station patches are 23 MB in total and all patches of a route are fetched before the track is built (north: 17): not measured on WebKit / iPad (`scripts/zuch/webkit_smoke.mjs`, `perf_probe.mjs` were not run), consider loading the patches of the first stations first;
   (d) `1-across` view of `station_shots.mjs` stands inside the arriving train; (e) career balance of the longer routes not tuned (prices unchanged: west 0, south 1800, north 16000 - the old south had 9 stops, now 17; check `economy` if the pacing feels off);
   (f) the station sides of `Lëtzebuerg` are forced to `right` on all three routes (`first_side`), the Gare Centrale model belongs to the home-line branch.
6. **Merge notes**: files both branches touch: `train-sim.html` (script lines + versions), `real-line.js` (per-route data), `routes.js` (west / south / north blocks replaced, Mosel block untouched), `landscape.js` (`terrainMesh` seam rows), `station-surround.js` (index merge),
   `station-surround-mesh.js` (station building flag), `run_all.mjs` (one import), `REAL-LINES.md` (W2c sections only), `build_station_patch.py` (`--index` option).  New files: `real-{west,south,north}.js`, `stations-osm.js`, `data/real/{west,south,north}-*.json`, `data/stations/*.json` + `index-routes.json`,
   `scripts/zuch/{build_real_route,real_route_defs,fetch_route_corridor,build_route_patches,fetch_refs,net404,pose_shot,seam_probe}.py/.mjs`, `scripts/flows/train_sim_routes.mjs`.

## How to run things

```
PY=/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python
$PY scripts/zuch/build_real_route.py plan north --plot x.png      # path, stops with OSM platforms, leg tokens
$PY scripts/zuch/build_real_route.py emit north                   # real-north.js + data/real/north-*.json (33 s)
$PY scripts/zuch/build_route_patches.py north south west [--only Name] [--force]   # station patches (30 s each; needs network for LiDAR / LOD2)
node scripts/flows/run_all.mjs train-sim-routes                   # this branch's flow
node scripts/zuch/hole_scan.mjs north,south,west --step 300       # hole detector; hole_pose_shot.mjs / pose_shot.mjs / miss_probe.mjs / seam_probe.mjs to look into a finding
node scripts/zuch/station_shots.mjs <dir> west Mamer-Lycée --tag v1
node scripts/zuch/route_aerial.mjs south <dir> 1500 15000 3300 --up 160
```

## W3 (26 Oct 2026, fresh agent) - items 1 - 4 done, 5 and 6 NOT started (token budget)

Done: steelworks silhouettes (industry layer) + Belval furnaces, Bettembourg yard, Gare Centrale trains / masts / Grande Halle, staggered platforms verified (details REAL-LINES.md "W3").  Reports `website-overnight/reports/zuchreal/w3/`.
OPEN, in order:
 5. **Tram hole scan**: `hole_lib.mjs` / `hole_scan.mjs` are rail only (`scanRoute(sim, routeId)`, `zlib.mjs start(routeId)` -> `__tsTest.startService`).  The Luxtram world (`luxtram-world.js`, `luxtram.js`) needs its own start (tram career) and camera; extend `zlib.mjs` with a tram start and run the same ray / sky checks along the tram track (data `data/luxtram-track.json`).
 6. **Abroad routes** (metz, brussels, paris): plan unchanged from "NOT done / open 3" above (stop lists decided, station coordinates listed, PBFs in `zuch-work/abroad/`).  Steps: (a) `fetch_route_corridor.py` two-stage fetch (rails for a wide box -> Dijkstra path -> tiles along the path), (b) `real_route_defs.py` entries with per-route length params (`PARAMS` out of `build_real_route.py`),
    (c) DEM auto-download, (d) generic stations + silhouettes for Metz-Ville, Namur, Bruxelles-Midi, Paris-Est (models in `stations-abroad.js`), (e) Thionville stop for paris, (f) split core / heavy data so the download stays near the LU routes.  `build_industry.py` only has a `south` CFG (add communes / boxes for other LU routes; France / Belgium have no LOD2 -> OSM footprints with default heights).
 Small leftovers: wagons next to the main line at yard lat 8 m look big in the cab (raise YARD_LAT[0] to 10); the huge Differdange hall is one LOD2 polygon (72 000 m2, drawn as one slab with skylight strips); Schifflange works: no big LOD2 hall in the OSM zone (nothing drawn); the grey `indus` ground class is flat.
