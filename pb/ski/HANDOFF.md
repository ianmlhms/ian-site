# Ski Alpen: handoff (phase 1, 21 Nov 2026)

Arcade id `ski`, page `pb/ski.html`, code `pb/ski/`, pipeline `scripts/ski/`, data `pb/ski/data/<resort>/`. Phase 1 = the engine and one
resort, Espace Killy (Val d'Isère + Tignes). The game must NOT go live before the other four resorts are in (3 Vallées, Zermatt-Cervinia,
St. Anton, Kronplatz): the resort picker already lists them as "geschwënn".

## Data pipeline (resort-generic, one `RESORTS` entry per resort in `scripts/ski/common.py`)
Venv: `~/Library/Caches/luxtram-work/.venv/bin/python`. Raw downloads cache in `~/Library/Caches/ski-work/<resort>/`.
1. `fetch_osm.py <rid>`: Overpass (pistes, lifts, buildings, land cover, water, roads, peaks / places).
2. `fetch_dem.py <rid>`: 5 m height tiles (1280 m, 257x257 nodes) + the 40 m far grid (box + 14 km). Sources per resort in `RESORTS[rid]["dem"]`
   / `["far"]`: `ign-rgealti` (Géoplateforme WMS-R, BIL float32, Lambert-93, 1 request/s) and `copernicus-glo30` (AWS COGs, range reads) are
   implemented, `swissalti3d` + `vda-dtm` too (round 2A, `dem_merge.py`); `bz-dtm`, `at-dgm` belong to round 2B. The world frame is the resort's
   own projected CRS (`crs`): EPSG:2154 for France, EPSG:2056 Switzerland, EPSG:25832 South Tyrol, EPSG:31287 Austria planned.
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

## Round 2A (21 Nov 2026): Les 3 Vallées + Zermatt-Cervinia
- **3vallees**: all three valleys (box 45.236..45.456 N, 6.475..6.690 E: Courchevel / La Tania, Méribel / Mottaret / Brides, Saint-Martin /
  Les Menuires / Val Thorens / Orelle side to Plan Bouchet; Valmorel, La Plagne and the Maurienne valley stay out). 297 pistes, 124 of 300
  tiles, 10.0 MB. To fit the budget: `near_keep` 150 m and `"buildings": "villages"` (only buildings in the listed village circles or within
  160 m of a piste / lift; the valley towns would pull in ~90 tiles). Start piste Combe de la Saulire. Altiports (OSM `aeroway`, new optional
  layer) are groomed like piste areas; no trees on piste areas / runways or within 20 m.
- **zermatt**: Zermatt + Breuil-Cervinia + Valtournenche (45.862..46.040 N, 7.600..7.830 E), 122 pistes, 152 of 238 tiles, 9.8 MB.
  `keep` ships the Matterhorn's 5 m tiles (2-3 km from any piste). Start piste Riffelalp (Riffelberg, the Matterhorn ahead).
- **DEMs** (`dem_merge.py`, used when a resort lists `swissalti3d` / `vda-dtm`): one whole-box mosaic per source cached in
  `dem/src/<source>.npy`, merged lowest priority first: the base gets the smoothed difference measured along the higher source's edge
  (fading out over 2.5 km), then a 260 m smoothstep feather inside the higher source. No seam: laplacian at the swiss data edge p99 12.6
  vs 13.2 elsewhere, harness steps 0.000 m. swissALTI3D: STAC API, 224 tiles of 1 km, newest year (2024), 2 m GeoTIFF box-averaged to 5 m;
  it covers the Italian side up to its km tiles too. Aosta Valley DTM 2005/2008: only one 2.6 GB zip (a 9.9 GB ASCII grid, Deflate64:
  streamed through `unzip -p`); the server answers HTTP 500 to ranges beyond ~512 MB and its firewall then blocks the IP for a while, so
  it is downloaded whole once (~90 s), the box is cut out (`raw/vda-dtm/crop.npz`) and the zip deleted. ED50 -> LV95 shift checked
  against swissALTI3D on the overlap: best 0, 0 m (MAD 3 m, glacier change). `dem/sources.json` lists what was used: `credits(rid)` in
  bake.py builds the in-game credit lines from `SOURCE_CREDITS` (common.py).
- Per-resort config keys (all optional): `near_keep`, `keep`, `buildings`, `skip_ways` (OSM piste ways to drop), `start`, village flag
  `"chalet"` (big blocks painted as chalets: Méribel, Courchevel, Zermatt). The far-grid despike only runs on IGN data (it blunted peaks).
- Engine: one resort per page. The picker reloads with `?resort=<id>&map=1` for another resort (straight onto its map); ski.html preloads
  the `?resort=` or the last resort. `resort.json` `start` = first piste. Flows: `ski` switches to both new resorts; `SKI_RESORT=<id>`
  runs `ski-ipad-start` for one resort (Killy 3.6 s, Zermatt 4.1 s, 3 Vallées 5.0 s to Start live).
- Dev tools: `shot.mjs --poses "name:x,z,above,tx,tz,above2,fov;..."`, `compare.py "label|photo|before|after"`. Shots and sheets:
  `~/Library/Caches/ski-work/round2a/cmp-*.png`.
- Still wrong: the Matterhorn's faces carry more snow than in reality (the shader's rock needs > ~40 degrees at the far LOD); the
  altiport reads by its tower / hangar / chalet more than by the runway; the Klein Matterhorn station is a plain block; a first-time
  player who picks a new resort pays a second boot (~+3 s, not measured on the iPad profile).

## Known gaps (honest)
- Mid-distance terrain self-shadowing beyond the shadow box is still only the baked 40 m raster (+ the occlusion term).
- Roads and village streets are not drawn (OSM roads.json is fetched but unused); villages read lighter than the photos from far.
- Building styles are guessed from size and tags (no per-village style); L-shaped chalets use their oriented box.
- No dam wall at Lac du Chevril; lake drawdown banks are not modelled.
- Sound is synthesised only (no menu music); not heard on a real iPad yet.
- Frame times measured on the Mini (CPU x4, GPU not throttled): every level holds 60 fps there; a real-iPad GPU check is still due.
- Skier is a box-and-capsule figure (stylised); no tricks yet, no cloud save of the progress (local only).
