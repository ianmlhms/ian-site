# Ski Alpen: handoff (phase 1 + rounds 2B / 2C, 21 Nov 2026)

Arcade id `ski`, page `pb/ski.html`, code `pb/ski/`, pipeline `scripts/ski/`, data `pb/ski/data/<resort>/`. Phase 1 = the engine and one
resort, Espace Killy (Val d'Isère + Tignes). The game must NOT go live before the other four resorts are in (3 Vallées, Zermatt-Cervinia,
St. Anton, Kronplatz): Kronplatz and St. Anton are in since round 2B; the picker lists the rest as "geschwënn".

## Data pipeline (resort-generic, one `RESORTS` entry per resort in `scripts/ski/common.py`)
Venv: `~/Library/Caches/luxtram-work/.venv/bin/python`. Raw downloads cache in `~/Library/Caches/ski-work/<resort>/`.
1. `fetch_osm.py <rid>`: Overpass (pistes, lifts, buildings, land cover, water, roads, peaks / places).
2. `fetch_dem.py <rid>`: 5 m height tiles (1280 m, 257x257 nodes) + the 40 m far grid (box + 14 km). Sources per resort in `RESORTS[rid]["dem"]`
   / `["far"]`: `ign-rgealti` (Géoplateforme WMS-R, BIL float32, Lambert-93, 1 request/s) and `copernicus-glo30` (AWS COGs, range reads) are
   implemented, and since round 2B `bz-dtm` (South Tyrol WCS) and `at-dgm` (BEV ALS DTM COGs); `swissalti3d`, `vda-dtm` are named for
   Zermatt. The world frame is the resort's own projected CRS (`crs`): EPSG:2154 France, EPSG:2056 Switzerland, EPSG:25832 (UTM 32N) for
   Kronplatz AND Arlberg (no MGI datum shift between DEM, OSM and frame).
3. `nice -n 10 ... bake.py <rid>`: pistes (OSM ways chained by name + colour, oriented downhill, trimmed from the highest to the lowest point,
   kept when >= 350 m long and >= 70 m drop; 4 slalom pistes), grooming (heights smoothed under the piste mask), shipped tiles (within 700 m
   of a piste / lift / village), classes raster (forest, scrub = open stands, rock, scree, water, built, piste area, glacier; derived larch
   stands below 2150 m on shady slopes / 2000 m on sunny ones where OSM has no forest), buildings (oriented boxes), lifts (+ mapped pylons),
   the painted map base `map.webp`, mountain-shadow rasters `shadow-<time>.webp` (sun of env.js TIMES, keep `SUNS` in step).
4. `python3 scripts/ski/make_sql.py` (writes `scripts/ski-v1.sql` from all baked resorts) and `python3 scripts/gamedata_manifest.py`.
Killy: 114 of 168 tiles shipped, 7.2 MB in total (tiles 5.1 MB, far 1.0 MB, json 0.46 MB, map 0.26 MB, shadows 0.23 MB).

## Engine (pattern of MTB, copied and adapted, MTB untouched)
- `field.js` THE height function: far grid everywhere, 5 m tiles blended in with a 160 m feather where a neighbour is missing or still
  streaming (continuous while tiles arrive), wind drifts / piste rollers, kickers on blue / red / black pistes every 320 m. The Catmull-Rom
  clamp is per row then per column (the 4-corner clamp of MTB's base-field jumps by metres at steep steps: the harness caught it).
- `surface.js` 2.5 m physics lattice == LOD 0 render tiles; `quadtree.js` / `tile-mesh.js` / `terrain-view.js` CDLOD with exact stitching
  (from MTB; root set per resort, `invalidate()` for streamed tiles).
- `skier.js` pure, serialisable physics (carve / skid / tuck / snowplough / skate / jump pop / take-off at crests / crashes);
  `game.js` one run (clock, checkpoints, slalom gates +5 s, finish, respawn, ghost samples); `ghost.js` (MTB codec, +-60 m lateral).
- Look: `snow-shader.js` (painted snow, corduroy, rock by slope, painted far forest from the class texture, baked mountain shadows, fog),
  `scatter*.js` (instanced spruce / bare larch, boulders, collisions), `village.js`, `lifts.js`, `props.js`, `env.js`, `effects.js`.
- UI `ui.js` / `ui.css` (Gitter look, Luxembourgish), `map.js` (pan / pinch / tap piste map), `main.js` (boot, loop, screens, watchdog).

## Leaderboards
Board per piste `ski-<resort>-<piste>` (<= 48 chars), score = milliseconds, lower is better (GAMES `lowerIsBetter`, kit
`data-arcade-lower-is-better`, format `ski` in `pixelbreak-records.js`). `scripts/ski-v1.sql` MUST be applied before launch (keep-best and the
anti-cheat think higher is better otherwise). Bot / scripted runs never post (flows opt in with `window.__skiAllowBotScore`).

## Tests
`node pb/ski/harness.js killy [--rides N|--all]` (continuity, render == physics, the scripted skier on N pistes);
`node scripts/flows/run_all.mjs ski` (flows `ski` and `ski-ipad-start`); dev tools `scripts/ski/shot.mjs` (poses: `__ski.setCamera`),
`compare.py` (photo | game sheets), `hub-check.mjs`. Every browser run through `python3 ~/Library/Caches/browser-slot.py`.

## Hooks for the next rounds
- Modes: `config.js MODES` has `challenge`, `park`, `race` (game.js treats unknown modes like free ride). Stars: `progress.stars` (saved,
  empty). Snowpark: `progress.park`, the jump key and `state.air` exist; tricks need rotation state in `skier.js`.
- Multiplayer: the skier state is plain JSON (`serialise`), physics is deterministic per fixed step; a remote skier = `createSkierModel`
  + interpolated states (see `pb/kart-letzebuerg/` for the lobby / mp-gate wiring).
- Free ride all day: `MODES.free` exists (after a finish, "Weiderfueren" onto a connected piste); a whole-area free ride needs a start
  point picker on the map and no guide line.

## Round 2C (look and sound, 21 Nov 2026): what changed, all resort-generic
- Shadows: `shadows.js` = THREE's sun shadow map (Mëttel 1024 / 95 m box, Héich 2048 / 150 m box, ahead of the camera, texel-snapped),
  sampled by every painted shader through `SHADOW_GLSL` (bilinear PCF, normal offset); terrain tiles, trees (own depth material),
  buildings, lifts, signs, nets and the skier cast. Off in fog / thick cloud (sunStrength < 0.3). Niddreg: blob shadows (skier blob,
  tilted blobs under near trees / rocks in `scatter-view.js`). Terrain occlusion per vertex (`tile-mesh.js occlusion()`: curvature in
  3 rings, every second node, ~0.7 ms per tile) darkens hollows and gullies.
- Tile vertex attribute `aExtra` = (groom direction x, z, occlusion, 0); `aInfo.w` is now `water - built` (signed, interpolates cleanly).
- Snow (`snow-shader.js`): corduroy along the nearest piste line (field.groomDir) in groomer lanes, no check pattern; packed piste vs
  wind-crusted powder; frozen lakes (flat, ice streaks, cracks, darker shore); white-blue flat light in fog (env.js WEATHER + milk).
- Distant forests: `forest-far.js` painted tree cards (canvas atlas, alpha-sharpened) from the class raster, rings per level
  (1.7 / 2.8 / 4.2 km); the painted canopy on the ground is only a light underlay now.
- Buildings: `bake.py build_buildings` appends [footprint (dm, simplified), roof code, levels] to each row (old 9-field rows still work).
  `village.js` builds chalets (stone base, wood, shutters, gable balconies, snow cap, chimney), gabled Savoy / plaster blocks, chapels
  with a bell tower, and the big purpose-built blocks (> 1300 m2, or OSM flat roof) from the real footprint with terraces stepping
  back uphill; two detail levels per 1280 m cell. Lift stations: hall + bull-wheel + canopy (`lifts.js stationGeometry`).
- Pistes: `bake.py widen_from_areas` (half width from the mapped piste area where the line has no width tag), `bench()` cuts every
  piste line flat across (BENCH_* constants; mean 1.2 m, max 6.7 m on Killy). Props: orange safety nets where the ground falls away
  > 8.5 m within 10 m of the edge, signposts with the name at every piste top (`props.js createSigns`, one atlas).
- Skier (`skier-model.js`): new figure, merged into one draw call per bone, outfits (OUTFITS, `pb_ski_outfit`, "Kleedung" in the map
  card and the pause menu), two-bone leg solve, carve lean + angulation, pole plant, tuck, plough, jump tuck, landing absorb, tumble.
  `effects.js` spray: off the outside ski in a fan, bursts on landing and crashes.
- Sound (`audio.js`): all synthesised (wind by speed, carve / powder / scrape / glide, lift hum + clacks, birds, village murmur,
  land / crash / countdown / gate / finish); honours pb_muted + `arcade:mute`; menu "Toun" and key N. Credit line in the map's ⓘ.
- Dev tools: `scripts/ski/pose-shots.mjs` (skier poses via `__ski.orbit`), `perf-probe.mjs` (iPad profile per level),
  `before_after.py` (sheets). Shots: `~/Library/Caches/ski-work/round2c/` (compare-photos, gameplay, new-details).
- Other resorts: rebake them with this bake.py (footprints, widths from areas, benches); the client copes with old data meanwhile.

## Round 2B (Kronplatz + St. Anton am Arlberg, 21 Nov 2026)
- `kronplatz`: Reischach / Olang / St. Vigil / Piz de Plaies - Piculin, box 14.1 x 16.6 km, 134 of 143 tiles, 8.2 MB, 50 pistes, 28 lifts,
  start piste Sylvester. Heights: `bz-dtm` = DTM 2.5 m of the Autonomous Province of Bolzano (GeoServer WCS 2.0.1 on geoservices9.civis.bz.it,
  coverage `p_bz-Elevation__D…TerrainModel-2.5m`, asked at 5 m with SCALEFACTOR=0.5 + Deflate, ~0.2 MB a tile; CC0 1.0). Far: Copernicus.
- `arlberg`: St. Anton, St. Christoph, Stuben, Rendl + Zürs and Lech (Warth-Schröcken and Sonnenkopf left out), box 19.2 x 16.6 km,
  164 of 195 tiles (`near_keep` 350 m to stay under 10 MB), 9.7 MB, 140 pistes (Skirouten included: OSM tags them with a difficulty),
  75 lifts, start piste Kandahar-Kapall. Heights: `at-dgm` = BEV "ALS DTM" 1 m (the Länder laser scans as one Austrian mosaic,
  CC BY 4.0), 50 km COGs in EPSG:3035 on data.bev.gv.at, read by range requests from the 4 m overview, newest file first
  (20250915, 20240915, ...). Why not tiris / data.gv.at: gis.tirol.gv.at times out from outside Austria (TCP connect never answers), and
  the data.gv.at district zips are Gigabytes; the BEV mosaic is the same Länder data and covers Tirol + Vorarlberg in one source.
  Copernicus GLO-30 stays the fallback for any NaN (none in either box) and the far grid of both resorts.
- New per-resort options in `RESORTS`: `start` (piste name the map opens on, baked into resort.json `start`), `tree_line` /
  `derived_forest` (north of the Alps the forest ends ~1900 m), `near_keep` (tile budget), `landmarks` (below). Credits come from the
  sources per resort (`SOURCE_CREDITS` in bake.py).
- Landmarks: `RESORTS[rid]["landmarks"]` -> resort.json `landmarks` (world x/z/y) -> `pb/ski/landmarks.js` (built with the lifts once the
  tiles are in, hidden beyond quality.buildingRadius) + violet labels on the piste map. Kinds: `bell` (Concordia 2000, OSM tower 21.8 m),
  `mmm` (Messner Mountain Museum Corones: concrete cowls, glass towards `face`), `summit-station` (`antenna` = Valluga mast + cross;
  `big` = Galzig top station), `pass` (Arlbergpass sign + flag row), `chapel` (St. Christoph spire over the Hospiz), `worldcup` (red A-nets
  along a piste where it is steep + start house; the Kandahar is two OSM pistes, `house: false` on the second). Option `clear: r` drops the
  OSM building boxes within r m (the museum, the Galzig station). Spots come from OSM footprints / roads (see the comments in common.py).
- Resort switching: the picker saves the resort (progress `last`) and reloads the page (one resort per page life); `?resort=` wins;
  ski.html preloads the saved / asked resort (its READY regex lists the baked ids: add new ones there and in resort-data.js RESORTS).
- Tests: `node pb/ski/harness.js kronplatz|arlberg --all` (49/50 and 136/140 to the bottom, zero tile steps); flows `ski-resorts`
  (switching, boards, credits, landmarks) and `SKI_RESORT=<rid> node scripts/flows/ski_ipad_start.mjs`.
- Overpass was overloaded on 21 Nov (502 / 504, mail.ru mirror has a self-signed cert): a layer may need a retry by hand.

## Known gaps (honest)
- Mid-distance terrain self-shadowing beyond the shadow box is still only the baked 40 m raster (+ the occlusion term).
- Roads and village streets are not drawn (OSM roads.json is fetched but unused); villages read lighter than the photos from far.
- Building styles are guessed from size and tags (no per-village style); L-shaped chalets use their oriented box.
- No dam wall at Lac du Chevril; lake drawdown banks are not modelled.
- Sound is synthesised only (no menu music); not heard on a real iPad yet.
- Frame times measured on the Mini (CPU x4, GPU not throttled): every level holds 60 fps there; a real-iPad GPU check is still due.
- Skier is a box-and-capsule figure (stylised); no tricks yet, no cloud save of the progress (local only).
