# HANDOFF (W1 -> next agent)

Context used so far was large (over 400k tokens), so this is a clean restart point. Everything below is committed on branch `mtb`.

## Done and verified (numbers in W1-NOTES.md)
Pipeline, quadtree terrain, stitching, carve, physics surface, harness (34 checks), flows (world / holes / ride, Chromium + WebKit), gates (check_site, cv_head), screenshots + montages.

## Where things live
- Frame: x east, z south, y up; origin NW corner of the box; constants `pb/mtb/config.js`, `scripts/mtb/common.py` (keep the two in sync: 5632 x 5632, origin LUREF 87900 / 100308).
- Zero-holes chain: `heightfield.js` (height function) -> `trails.js` (carve) -> `surface.js` (1 m lattice blocks = physics) -> `tile-mesh.js` (tiles built from the same blocks, stitching `stitchesOf` / `polylineValue`) -> `quadtree.js` (selection). Any change to these must keep `node pb/mtb/harness.js` green.
- Rendering: `main.js` boots everything; `window.__mtb` (with `?debug=1`) exposes bike, camera, terrain, forest, env for tests (`setBike`, `teleport`, `setInput`, `setCamera`, `step`).
- Data: rebake with the venv `/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/<script>.py`; order: `fetch_osm.py` (slow, cached, both tiles), `fetch_lidar.py`, `bake_terrain.py`, `bake_trails.py`, `bake_ways.py`, `bake_classes.py`. Raw downloads: `~/Library/Caches/mtb-work/`.
- New trail: add an entry to `scripts/mtb/trails.def.json` (via points in world metres; use `mapcrop.py` to see them), rerun `bake_trails.py`, `bake_ways.py`; the harness picks it up (E and G rides) and `trails[0]` is the default trail in `main.js` (`?trail=<id>`).

## Open items for W2 (detail in W1-NOTES.md "Known issues")
1. Five more trails + checkpoints, medals, ghosts, crash/respawn, start/finish, trail features (kickers, rollers, drops) in `trails.js` bed profile + closed solids for bridges; harness check per feature (no gaps, scripted rider finishes).
2. Medal times from the scripted rider (`harness.js` G section is the starting point; make it a module).
3. Marathon trail from `mtb/gpx/beaufort-berdorf.gpx` stitched over the others.
4. Keep `scripts/flows/mtb_*.mjs` and the budgets updated; screenshot series: `node scripts/mtb/report_shots.mjs <dir>` (adapt scenes).
