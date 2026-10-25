# Zuchsimulator "zuchreal" - handoff after Wave 2, part 1 (task 1 mostly done; tasks 2-4 open)

Worktree `/Users/Ian/Library/Caches/website-zuchreal`, branch `zuchreal` (Wave 1 is on origin/main), commit often, **no push / no deploy / not main**.  Reviewer: Claude Opus.
Rules (brief `scratchpad/brief-zuch.md` + `brief-zuch-w2.md`): painted realism only (no orthophoto), reference photos + photo | screenshot montage for every station touched, weather / time stay player-choosable, ONE browser at a time
(Mac mini 16 GB), iPad performance (instancing, quality levels), new small modules, don't break saves / career / the Tramsimulator lock.  Photos: `~/Library/Caches/zuch-refs/<Station>/` (not in the repo).
Open data caches: `~/Library/Caches/zuch-work/` (`lux.osm.pbf`, `rlp.osm.pbf` = Rheinland-Pfalz extract 260 MB, `realline/corridor-*.pkl`, `dem/` Copernicus tiles, `scratch/` probes).
Python: `/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python` (numpy rasterio pyogrio shapely pillow pyproj scipy).  Reports: `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/zuchreal/w2/`.
A side agent (trees, perf, Munsbach fixes; brief `scratchpad/brief-zuch-w2-trees-perf.md`) works in parallel on the same branch: its files are `tree-kit*.js` (new) + local edits in landscape.js / stations-lu-c.js / infra.js; check `git log` for its commits and its report.

## Done in Wave 2 (task 1, numbers verified by `scripts/zuch/route_probe.mjs`)

* **RB 83 decision implemented** (stop list verified against the SPNV-Nord press release, see REAL-LINES.md "Wave 2"): `wittlich` = Lux - Cents-Hamm - ... - Igel - Zewen - Euren - West - Pallien - Hafenstraße - Ehrang Ort - Quint -
  Schweich - Föhren - Hetzerath - Sehlem - Salmtal - Wittlich (25 stops, 28.4 km game length); `trier` = A + Kreuz Konz - Tréier Süd - Tréier Hbf + tail + authored Cochem / Koblenz (26 stations, 33.0 km); `east` = Lux .. Wasserbëlleg (11 stops).
  Both branches have the same game length, so the tail stations are at the same s on both services (Hafenstraße platformStart 19071 on both).  NOT done: the world POSITION of the tail differs between the two services (branch end poses are not
  forced to be equal): the generic ground noise (hills) of the shared tail therefore differs; real data (rivers, roads, land classes) is keyed by leg and identical.
* **OSM -> leg geometry tool** (`scripts/zuch/build_real_line.py` + `real_line_*.py`, `osm_rail.py`, `fetch_corridor.py`): real curve sequence / sides / radii, grades (DEM), maxspeed, bridges, tunnels, level crossings, biomes per leg.  Output
  `pb/train-sim/real-mosel.js` (+ `data/real/mosel-layout.json`, `data/real/mosel-features.json`).  Re-run: see REAL-LINES.md.  QA plot of real vs game heading: `build_real_line.py layout --route wittlich --plot x.png`.
* **Real scenery** (`real-line.js`, `real-scenery.js`, hooks in `track.js` / `landscape.js` / `train-sim.js` / `train-sim.html`): rivers on the real side with real offset / width (Syre 7 m, Sauer 28, Mosel 55 half width), real relief (DEM height 220 m
  left / right), land classes (forest / fields / vineyards / meadows / orchards / residential / urban / industry) from OSM landuse, real roads (A1, N1, CR, village streets) as ribbons with cars, houses along the real residential streets, churches at village centres.
  Roads stop at the strip edge (+-150 m); ribbons on steep ground (cross slope > 1.7 m) are not drawn (they would float).
* Aerial screenshots: `w2/aerial1/` (Munsbach - Roodt: villages along the real streets, A1 viaduct road).

## NOT done / open (in priority order)

1. **Gates not finished** (the 35 min `run_all.mjs train` was started at the end of the session and its result is not in this file; `train_sim_world.mjs` encodes Wave 1 expectations: station counts of east / wittlich / trier, `trier` passes 11 stations, "identical
   stations +-6 m" - update it for 25 / 26 stations, the branches, 11-stop east, Cents-Hamm).  `check_site.py`, `cv_head.py`: not run after Wave 2 code.
2. **Far ground colour**: the strip (+-150 m) is coloured by biome, the far ground by noise: visible colour step at the strip edge (dark green vs yellow).  `pipeline`: the features file now also has `far` rasters (60 m cells, +-1500 m;
   `real_line_scenery.far_raster`, run `build_real_line.py emit` again, not yet regenerated).  JS: in landscape.js `farColor(x, z, nY)` use `track.nearest` + `track.real.farClassAt(s, lat)` (add to real-line.js; classes -> colours: field gold-green,
   meadow light green, forest dark green, vine yellow-green, resid / urban grey-green, indus grey, water blue); and in `groundColor` blend the strip ground by `real.landAt(s, lat)` (forest floor darker, fields lighter).
3. **Real level crossings**: positions come from the OSM crossings that survived the layout (about 10 of 21 on `wittlich`; dropped: inside station blocks, on arcs, too close to bridges / tunnels).  The crossing roads are still the Wave 1 synthetic
   ones: `crossing-roads.js` should take the real hints (`real.crossings` has `s`, `barrier`, nearest real road on the left / right (lat, class)) so the road T-junctions into the REAL parallel road; the real ribbons of `real-scenery.js` currently
   draw the same parallel roads again beside the synthetic ones (look at the crossings in `w2/` shots).  Munsbach's Rue de Beyren crossing: the side agent owns it.
4. **Task 2 stations on this line** (nothing done): Roodt (Syre), Oetrange, Betzder, Wecker, Sandweiler-Contern, Manternach, Mertert, Wasserbëlleg, Cents-Hamm (new, generic), then Igel, Zewen, Euren, West, Pallien, Hafenstraße, Ehrang Ort, Quint, Schweich,
   Föhren, Hetzerath, Sehlem, Salmtal, Wittlich Hbf, Kreuz Konz, Trier Süd, Trier Hbf: photos from Wikimedia Commons into `~/Library/Caches/zuch-refs/<Station>/`, `scripts/zuch/build_station_patch.py` (Luxembourg only: LiDAR + LOD2; for German stations
   it needs OSM buildings + the Copernicus DEM or RLP open LiDAR / LoD2), `reg()` model (see stations-lu-c.js Munsbach), montage.  Station sides are now computed from OSM platforms (`real-mosel.js` `stations[...].side`; where the OSM platform was not found
   the side of the previous stop was used: Zewen, Euren, West, Pallien, Hafenstraße, Ehrang Ort, Föhren, Sehlem, Salmtal are guesses) - check each against photos.  The existing models (stations-lu-b.js: Sandweiler-Contern, Oetrange, Betzder, Manternach, Mertert,
   Wasserbëlleg; stations-abroad.js: Tréier Hbf, Schweich, Wittlich) use the sides given by the old authored routes: compare with `real-mosel.js` and flip the model if needed.
5. **Task 3 Lëtzebuerg Gare Centrale** (nothing done): station building with clock tower, platforms, long canopy, forecourt; real surroundings via the patch pipeline; photos + montage.
6. **Task 4 leftovers**: floating road ribbons / lamps on steep viaduct walls (the new real roads skip steep ribbons; generic `ribbonMesh` villages still float), plain water slab under bridges, hairline cracks / ray failures (north Pafendall, brussels), hole scan on the tram.
7. Task 5 other routes (north first) not started: the same pipeline works for any line (`PLAN` / `STOPS` in `real_line_path.py` are Mosel-specific: generalise).
8. Pose closing of the two branches (see above) and Cochem / Koblenz legs are authored.
9. `real_line_scenery.roads_of_leg` keeps only roads with both ends cut at +-11 m of the corridor; overpasses of real roads over the line are not modelled (the road simply ends at the corridor).

## How to run things

```
node scripts/zuch/route_probe.mjs wittlich [--shots dir --every 2500]      # route basics (stations, crossings, bridges, tunnels) + cab shots
node scripts/zuch/route_aerial.mjs wittlich dir 5800 7400 400              # aerial shots along s
node scripts/flows/run_all.mjs train                                       # all train flows (35 min)
node scripts/zuch/station_shots.mjs <dir> east Munsbach --focusZ -82 --forecourtLat 12 --tag v1
$PY scripts/zuch/montage.py out.png --cols 2 --w 800 "caption=img.png" ...
$PY scripts/zuch/build_real_line.py emit        # regenerate real-mosel.js + data/real/*.json from the cached corridor
```
Test hooks: `?test=1` -> `__tsTest.setFreeCam`, `placeAt`, `internals()`, `trackInfo()`; `world.landscape.setHoleMode(on)`, `.groundHeightAt`, `.crossingTraffic()`; `track.real` (resolved scenery data).
