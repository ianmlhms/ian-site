# Zuchsimulator "zuchreal" - Wave 1 notes (25 Oct 2026)

Branch `zuchreal` (worktree `~/Library/Caches/website-zuchreal`), based on origin/main.  Nothing pushed, nothing deployed.

## What Wave 1 contains

1. **Level-crossing roads** (task 1, done for every crossing of every rail route; the Luxtram is untouched).
   * `crossing-roads.js` (plan), `crossing-roads-mesh.js` (asphalt, verges, lines, signs), `crossing-traffic.js` (vehicles).
   * Every crossing gets a real road on both sides: it leaves the line straight, then ends in a T into a parallel asphalt road (130-300 m each way), bends into one
     (R = 26 m), or meets a gravel field track (110-230 m each way) with turning places at the dead ends.  Reach >= 120 m on both sides everywhere (flow-checked).
   * The ground follows: `track.terrainHeightAt` is wrapped (`plan.adjust`), so the strip mesh, the far ground and every tree / house query see the same road corridor
     (cuts and fills, slope 1:2.6, profile clamped to 5.5 % and pinned to the crossing level, then to the height the cross road arrives with at the junction).  The strip mesh gets
     extra rows / columns along the roads (`track.meshHints`), so no triangle spans a road.
   * White edge lines, dashed centre line on the parallel road, T-junction corner fans, warning triangle "Bahnübergang mit Schranken" + 3/2/1-stripe markers on the right of
     approaching traffic, yield sign at the junction, gravel verges.  infra.js: the old 22 m stub is now 13 m (the planned road starts there), edge lines follow the road profile.
   * Traffic (luxtram vehicle bodies, plus a tractor and a cyclist): hatch / sedan / estate / SUV / van / lorry / tractor / bike; they queue at the stop line while the barriers are
     closed (8.2 m beyond the outer rail), a vehicle that cannot stop any more clears the crossing, and drive on after the barriers open.  Simulated only within 760 m of the train.
   * Landscape trees / houses / fields keep off the roads (`track.isReserved`, `onRoad` in landscape.js).
2. **The Mosel line, built once** (Ian's request): `moselBody` in routes.js, `sceneryId: 'mosel'`.  `east` (10 stops, now with Munsbach, Roodt-Syr, Wecker), the new `wittlich`
   (21 stops, 12 000 EUR, rail trains, route order after east) and `trier` (23 stations, an express: 12 stops, 11 passed at 110 km/h) run on slices of it.  Same curves, stations,
   crossings, bridges and scenery on every service.  Passing = `route.passNames` -> `track.passFixed` -> `sim.planService` (pattern RE).  Saves / careers: route ids unchanged,
   old resume snapshots of east / trier are rejected by the existing station-count check.  Stop list, sources, and the **Weststrecke question**: pb/train-sim/REAL-LINES.md.
3. **Munsbach = the template station** (task 2): photo-modelled building (stations-lu-c.js, from 10 Commons photos), real surroundings from open data
   (`station-surround*.js`, data `pb/train-sim/data/stations/munsbach.json`, 446 kB): LiDAR 2024 relief blended into the generic ground inside +-160 m x +-320 m,
   painted ground (OSM + canopy classes, no photo), 129 LOD2 buildings with painted facades / roofs, 634 canopy trees, the Syre, street furniture.  Platform width 3.2 m (real).
   The pipeline `scripts/zuch/build_station_patch.py` (format: scripts/zuch/STATION-PATCH-FORMAT.md) is generic: a new station is one command + one `reg()` model.
4. **Hole detector** (task 4): `scripts/zuch/hole_lib.mjs` (+ `hole_scan.mjs`), flow `train-sim-world`.  Render check (magenta clear colour, sky / hills / safety plane hidden,
   far ground mesh magenta: a magenta pixel below the horizon whose point lies inside the strip footprint is a PIT, one that hits nothing is a VOID) and ray check
   (vertical rays through the strip mesh vs `landscape.groundHeightAt`).  Findings fixed in Wave 1: the pit at every river bridge (the strip is carved below the far mesh:
   the far mesh now follows the carve, `carveRiver`), steep valley walls (finer rows / columns around bridges >= 6 m, `valleyRows` in track.js).
5. QA harness `scripts/zuch/` (zlib.mjs: free camera via `__tsTest.setFreeCam`, screenshots with the UI hidden; crossing_shots, crossing_cab, station_shots, hole_scan, montage.py).

## Files

New: pb/train-sim/{crossing-roads,crossing-roads-mesh,crossing-traffic,station-surround,station-surround-mesh,stations-lu-c}.js, REAL-LINES.md, this file,
data/stations/{index,munsbach}.json, scripts/zuch/*, scripts/flows/train_sim_world.mjs.
Changed: routes.js (master line, `pw`, `passNames`), track.js (crossing plan, surround patches, mesh hints, valley hints, pass limit, sceneryId, platform width),
landscape.js (extra rows / columns, carve, traffic, surround, hole-mode hooks), infra.js (crossing stub 13 m, waiting-car boxes removed), sim.js (fixed passes), config.js / menu.js
(wittlich), stations-lu-b.js (exports its kit), train-sim.js (free-cam test hook, preload, crossing notify), train-sim.html (scripts, versions).

## Numbers (see the report for the gate results)

* Munsbach vs a typical station on the same line (renderer.info, high, desktop Chrome, shadows on): cab view 1.68 M triangles / 237 draws, aerial 1.05 M / 121; before (Oetrange):
  0.60 M / 262 and 0.57 M / 207.  The extra comes from the forest chunks of the new Roodt leg (tree instancing at quality high) - the station patch itself is ~120 k
  triangles in 13 draw calls.  iPads default to `medium` (trees x0.6, patch trees x0.6); not measured on a real iPad yet.
* Crossings: 3 (west) 4 (south) 3 (east) 9 (wittlich / trier) 2 (north) 3 (metz) 3 (brussels) 0 (paris).

## Known problems / open (details in the handoff)

* Weststrecke decision (REAL-LINES.md).  Cents-Hamm is not a stop (RB 83 skips it).
* Munsbach's real level crossing (Rue de Beyren, ~110 m ahead of the platform middle) is painted ground only: no barriers / lights / traffic there yet.
* Munsbach model vs photos: kerb / paver texture of the platforms, catenary masts, taller right block of the building, glazing panels are only visible from higher viewpoints.
* Patch roads are painted only (no markings, no traffic, no bus stops with buses).
* Roodt-Syr, Wecker, Igel, Kreuz Konz, Tréier Süd, Ehrang, Föhren, Hetzerath, Sehlem, Salmtal are generic stations.
* Village roads / lamps on valley walls under viaducts can still float (original landscape code, `ribbonMesh` samples every 8 m).
* Bridges: the water slab under a river bridge is a plain rectangle.
