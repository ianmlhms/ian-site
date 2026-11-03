# Lux Drive: build brief (MiniMax builder, Claude reviewer)

You are the BUILD agent for a new browser driving game on Ian's public website ian.lu (repo
github.com/ianmlhms/ian-site). A reviewer (Claude) checks your work between milestones and finishes
the look at the end. Your job: a solid, correct, fast foundation. Work autonomously.

## Where you work
- Git worktree `~/Library/Caches/website-luxdrive`, branch `lux-drive`. Commit after every milestone
  (and often in between) with clear messages. NEVER push, never touch `main` or other worktrees.
- Game files: `pb/lux-drive.html` + `pb/lux-drive/*.js` + `pb/lux-drive/data/`. Bake scripts:
  `scripts/luxdrive/`. Large raw/intermediate data ONLY in `~/Library/Caches/luxdrive-work/` (never
  in the repo). Screenshots / logs ONLY in `~/Library/Caches/luxdrive-work/shots/` (not in the repo).
- Keep `pb/lux-drive/PROGRESS.md` up to date: per milestone DONE / IN PROGRESS, gate results, open bugs.
  When all milestones are done, write the line `ALL MILESTONES DONE` in PROGRESS.md.

## The game
Like "Trailhead" (drive real roads in the browser), but only **Luxembourg City (commune) + the
commune of Niederanven** (they border each other at Kirchberg / Senningerberg; about 95 km^2).
Players know these places, so they must look recognisably real. Free driving on every public road,
arcade car physics, chase camera, minimap. No goals needed yet.

## BASE IT ON THE MTB ENGINE (most important instruction)
`pb/mtb/` (game "MTB Mëllerdall") already solves the hard parts. READ FIRST: `pb/mtb/DESIGN.md`
(esp. section 5 "Zero holes: the architecture"), `pb/mtb/HANDOFF.md`, `pb/mtb/W2-NOTES.md`.
Reuse its architecture by COPYING modules into `pb/lux-drive/` and adapting them (never edit `pb/mtb/`):
- one height function, roads carved into it (like trails), one lattice for render + physics
  (`heightfield.js`, `surface.js`, `trails.js` -> roads), CDLOD quadtree tiles (`quadtree.js`,
  `tile-mesh.js`), camera never below ground (`camera.js`), painted ground (`ground-shader.js`,
  `paint-textures.js`), towns/buildings (`town-*.js`), env/light/weather (`env.js`), input/touch,
  harness (`harness.js`), quality auto-steps, data codec (`codec.js` / `scripts/mtb/codec.py`).
- Bake pipeline: adapt `scripts/mtb/*.py` (fetch_lidar, bake_terrain, bake_ways, bake_buildings,
  bake_classes) into `scripts/luxdrive/`. Python: `~/Library/Caches/luxtram-work/.venv/bin/python`
  (or `~/Library/Caches/zuch-work/osm-venv/bin/python`).
- Local data already on this machine: `~/Library/Caches/zuch-work/lux.osm.pbf` (OSM Luxembourg),
  `~/Library/Caches/zuch-work/lidar/`, `~/Library/Caches/zuch-work/lod2/` (official LOD2 3D
  buildings), `~/Library/Caches/zuch-work/dem/`. Read `scripts/zuch/lod2_zone_buildings.py` and
  `scripts/zuch/build_station_patch.py` for how LOD2 / LiDAR are read. Prefer local data over
  downloads; if you must download (LiDAR tiles), do it once into luxdrive-work.
- A throw-away trial of this game exists in `~/Library/Caches/minimax-claude/runs/build1/` (one
  1 km square at Kirchberg). Its scripts may help (LOD2 extraction, LUREF EPSG:2169 transforms), but
  its look was bad (grey, giant walls) and its data far too big (12 MB per km^2). Do not copy its renderer.

## Milestones (in order; commit + update PROGRESS.md after each)
1. **Area + data bake.** Area = union of the OSM admin boundaries (admin_level 8) of the communes
   Luxembourg and Niederanven + 300 m buffer. Bake terrain (LiDAR, de-spiked), roads (OSM highway=*
   drivable classes with real widths, lanes, bridges/tunnels/layers), buildings (LOD2: real footprints,
   heights, simple roof shapes; simplify), land classes (fields, forest, parks, water), tram + rail lines,
   names (prefer `name:lb`). HARD BUDGET: all shipped game data <= 30 MB (report the exact size); decode
   fast. Check: tile coverage of the whole area, sizes.
2. **Drive.** Car (arcade physics, cannot pass through buildings or leave the road network area
   badly), chase camera, roads carved into the height function with kerbs/pavements, bridges as real
   solid decks (Pont Adolphe, Pont Rouge, Grünewald / A1 bridges), tunnels (René Konen etc.) or at least
   correct portals. Start position: Place de l'Europe, Kirchberg.
3. **City.** LOD2 buildings in the painted low-poly look (walls light stone/render colours, darker roofs,
   window bands as texture, no satellite/photo textures), trees, parks, tram line (Luxtram) along
   Avenue J.F. Kennedy, street lights optional. Distance LOD so the old town / Kirchberg stay smooth.
4. **Gates (automatic checks, must PASS):** adapt `pb/mtb/harness.js` and
   `scripts/flows/mtb_holes.mjs` into `pb/lux-drive/harness.js` + `scripts/flows/luxdrive_holes.mjs`;
   add `scripts/luxdrive/probe_roads.py` (roads ending in nowhere: a road end inside the area that is not
   a real dead end / turning circle in OSM -> FAIL), `probe_buildings` (building base floating > 0.3 m
   above or cut into the ground > 1 m), cars-on-rails / road-through-building checks, draw calls
   <= 260 and triangles budget at medium quality. Run them, fix until PASS, record results in PROGRESS.md.
5. **UI.** Menu + HUD in Luxembourgish first (lb, plus de/en/fr like the MTB game's `i18n.js`), touch
   controls for iPad, minimap (`Kaart`), weather/time chooser in the menu AND in game (random = default),
   quality auto-step. Not linked from the arcade yet.

## Standards (Ian, strict)
No holes in the ground, nothing floating, nothing inside something else, no roads to nowhere, no cars on
rails. Real places must be recognisable. Smooth on school iPads (WebKit, medium quality: <= 260 draw
calls). Code style: match the MTB code (small modules, named constants, comments that explain why, never
mutate inputs, explicit errors with context, never swallow errors). Bump `?v=` of changed assets.

## Machine rules (shared Mac mini, 16 GB) - HARD
- EVERY browser start goes through `python3 ~/Library/Caches/browser-slot.py <command> [args]`. Max ONE
  browser at a time from you, workers=1, close it in try/finally. Run flows with
  `FLOW_VIDEO_DIR=~/Library/Caches/luxdrive-work/videos`.
- At most ONE heavy process (bake) at a time, no multiprocessing pools, no `&` background jobs, use
  timeouts. Kill every server you start (`python3 -m http.server`) before you stop.
- Never read or print secrets, never read outside the repo, `~/Library/Caches/*-work/`, and the trial
  folder. No network except OSM/LiDAR/Wikimedia data downloads. Never push. Never run SQL.
