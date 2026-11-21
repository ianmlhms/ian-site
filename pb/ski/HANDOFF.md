# Ski Alpen: handoff (phase 1 + rounds 2-3 + 4A modes, 21 Nov 2026)

Arcade id `ski`, page `pb/ski.html`, code `pb/ski/`, pipeline `scripts/ski/`, data `pb/ski/data/<resort>/`. Phase 1 = the engine and one
resort, Espace Killy (Val d'Isère + Tignes). The game must NOT go live before the other four resorts are in (3 Vallées, Zermatt-Cervinia,
St. Anton, Kronplatz): Kronplatz and St. Anton are in since round 2B; the picker lists the rest as "geschwënn".

## Data pipeline (resort-generic, one `RESORTS` entry per resort in `scripts/ski/common.py`)
Venv: `~/Library/Caches/luxtram-work/.venv/bin/python`. Raw downloads cache in `~/Library/Caches/ski-work/<resort>/`.
1. `fetch_osm.py <rid>`: Overpass (pistes, lifts, buildings, land cover, water, roads, peaks / places).
2. `fetch_dem.py <rid>`: 5 m height tiles (1280 m, 257x257 nodes) + the 40 m far grid (box + 14 km). Sources per resort in `RESORTS[rid]["dem"]`
   / `["far"]`: `ign-rgealti` (Géoplateforme WMS-R, BIL float32, Lambert-93, 1 request/s) and `copernicus-glo30` (AWS COGs, range reads) are
   implemented, `swissalti3d` + `vda-dtm` (round 2A, `dem_merge.py`), and since round 2B `bz-dtm` (South Tyrol WCS) and `at-dgm` (BEV ALS
   DTM COGs). The world frame is the resort's own projected CRS (`crs`): EPSG:2154 France, EPSG:2056 Switzerland, EPSG:25832 (UTM 32N) for
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
- Engine: one resort per page (switching: see round 3). `resort.json` `start` = first piste. Flows: `ski` switches to both new resorts; `SKI_RESORT=<id>`
  runs `ski-ipad-start` for one resort (Killy 3.6 s, Zermatt 4.1 s, 3 Vallées 5.0 s to Start live).
- Dev tools: `shot.mjs --poses "name:x,z,above,tx,tz,above2,fov;..."`, `compare.py "label|photo|before|after"`. Shots and sheets:
  `~/Library/Caches/ski-work/round2a/cmp-*.png`.
- Still wrong: the Matterhorn's faces carry more snow than in reality (the shader's rock needs > ~40 degrees at the far LOD); the
  altiport reads by its tower / hangar / chalet more than by the runway; the Klein Matterhorn station is a plain block; a first-time
  player who picks a new resort pays a second boot (~+3 s, not measured on the iPad profile).
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
- Resort switching: see round 3 (one mechanism for both rounds).
- Tests: `node pb/ski/harness.js kronplatz|arlberg --all` (49/50 and 136/140 to the bottom, zero tile steps); flows `ski-resorts`
  (switching, boards, credits, landmarks) and `SKI_RESORT=<rid> node scripts/flows/ski_ipad_start.mjs`.
- Overpass was overloaded on 21 Nov (502 / 504, mail.ru mirror has a self-signed cert): a layer may need a retry by hand.

## Round 3 (21 Nov 2026): all five resorts in one branch + polish
- Integration: 2A (3 Vallées, Zermatt) + 2B (Kronplatz, Arlberg) merged; all five `ready` in resort-data.js RESORTS. Credits: `credits(rid)`
  (bake.py) from `dem/sources.json` + `SOURCE_CREDITS` (common.py, all six sources). `start` in RESORTS = a piste id or name
  (`default_piste`), else the longest red.
- Resort switching (one mechanism): the picker's `switchResort(id)` saves the pick (progress `last`, piste null) and sets the session flag
  `pb_ski_open_map`; standalone it replaces the URL with `?resort=<id>&map=1` (shareable, minus `piste`), in the arcade's srcdoc frame it
  reloads (the saved pick chooses the resort, the flag opens its map once). Boot: `?resort=` > saved > Espace Killy; `?map=1` or the flag
  -> piste map, else the picker. ski.html preloads the asked / saved resort (any id; main.js ignores a non-ready one).

- Polish (round 3, all five resorts rebaked):
  - Winter rock: the class bit "rock" is now baked by `winter_rock` (bake.py) from the 5 m slope (base `ROCK_SLOPE` 38.5 deg) lowered on
    ridges (curvature), sunny faces and above 2600 m, raised in gullies and on glaciers, with painted strata (`ROCK_BAND` 32 m) and OSM
    rock / cliffs only where steep; OSM scree only above 24 deg. The shader (snow-shader.js) paints grey layered rock from it at every
    distance (coarse tiles average the raster, field.js `rockShare`), ledges and gullies keep snow, strata only on real faces. Rock
    covers 14-27 % of a box; classes.bin grew 0.3-0.4 MB (3 Vallées 10.5 MB in all now).
  - Lac du Chevril: `reservoirs` (common.py) lowers the lake 40 m with 65 m banks (bake.py `apply_drawdown`; banks lose the water bit);
    landmark kind `dam` (landmarks.js): the arch along the OSM crest, painted giant on the downstream face (canvas texture, our own brush).
  - Modern architecture: villages flagged `"modern"` (Kronplatz summit, Trockener Steg, Klein Matterhorn) -> row kind 4 (stone plinth,
    larch slats, glass ribbons, flat roof, <= 2 floors unless OSM says more); OSM towers -> kind 5 (slim red-white shaft). MMM = faceted
    concrete shards with glass faces cut into the ridge. Landmarks are merged per material (`flatten`: a few draw calls each).
  - Stations: lifts.js seats every station on a stone foundation down to the lowest ground under it; summit-station variants `antenna`
    (Valluga: stone hall, roof deck, mast), `glacier` (Matterhorn glacier paradise), `cross` (summit deck + cross). Option `clear` now drops
    OSM buildings whose footprint comes within r m (Galzig duplicate gone).
  - Chains: `chains` in RESORTS joins pistes into one named run (bake.py `chain_runs`, joins where the next piste passes closest).
    Kandahar = Kandahar-Kapall + Fang (2.3 km, 901 m drop): the Kandahar-Galzig does not meet the Kapall part (805 m apart), it stays a run
    of its own. Board ids: `ski-arlberg-kandahar` (the old kandahar-kapall board is gone from ski-v1.sql).
  - No stuck pistes: herringbone climb in skier.js (`climbSpeed`, `climbMax`: push walks up rises to ~20 deg), the bot slows before sharp
    bends. Harness: every piste of every resort reaches the bottom (`--only id,id --trace` to debug one).
  - Village streets: bake.py `build_roads` -> `roads.json` (OSM roads near houses / in village circles, never on pistes, 22-98 KB),
    roads.js drapes them as ploughed streets (packed snow, wet tracks, snow banks), merged per 2560 m, built when all tiles are in.
  - Start stays live once a piste was ready (main.js `updateStartStatus`): tiles streaming in elsewhere no longer flip it off under a tap
    (that was the ski-ipad-start flake).
  - Dev tools: `scripts/ski/poses.py <rid> [names]` (look-check cameras by lon / lat for shot.mjs --poses), perf-probe.mjs `--resort`.
    Sheets (photo / before / after): `~/Library/Caches/ski-work/round3/sheet-*.jpg`.

## Known gaps (honest)
- Mid-distance terrain self-shadowing beyond the shadow box is still only the baked 40 m raster (+ the occlusion term).
- Streets are draped ribbons: on coarse far tiles they can sink into / float over the terrain (shown only within the building radius).
- Building styles are guessed from size and tags (no per-village style); L-shaped chalets use their oriented box.
- The Chevril giant is our own simple figure (not a copy of the fresco); the frozen lakes still read mostly as snow fields.
- The Concordia bell is only seen from the summit dome itself (the convex top hides it from lower plateau views).
- Sound is synthesised only (no menu music); not heard on a real iPad yet.
- Frame times measured on the Mini (CPU x4, GPU not throttled): every level holds 60 fps there; a real-iPad GPU check is still due.
- Skier is a box-and-capsule figure (stylised). Tricks and the cloud save came in round 4A (below).

## Round 4A (21 Nov 2026): game modes (stars, snow park, free ride all day)
All in `pb/ski/modes/` (pure modules first, then views / DOM); main.js, ui.js, map.js, input.js, env.js, field.js, skier.js,
skier-model.js got small hooks marked "round 4A". main.js talks to the modes only through `modes/host.js` (begin / step / after /
hudTick / finishRun / finishPark / rideUp / end / onTiles).
- **Stars** (`challenges.js`): every timed run is also the piste's challenge. ★1 finish (valid run), ★2 under the target time = a 1D
  ride down the piste's own far-grid profile (friction, drag, colour speed cap, bend limit, slalom section capped 12 m/s) x 1.10,
  rounded up to 0.5 s; the careful scripted skier makes it on nearly every piste (harness D prints `bot time / ★2 target`: median
  0.94-0.95, p90 ~1.0). ★3 drawn per piste from its id (FNV): slalom pistes "all gates clean", else nocrash / flags (4-10 flags along
  the line, alternating sides, `views.js createFlagsView`, one instanced draw call) / speed (85 % of the profile's tuck top speed,
  5 km/h steps, 40-105). Stars = bit mask per piste under `"<resort>/<hash5 of id>"`, OR-ed, never lost.
- **Unlocks**: greens / blues always open; reds / blacks at `UNLOCK[rid]` stars in that resort (Killy 6 / 18, 3 Vallées 8 / 24, Zermatt
  5 / 15, Arlberg 6 / 18, Kronplatz 4 / 12); a piste with a best time, a run or a star is always open. Old saves: a best time = ★1
  (`migrateStars`). The map opens on an open piste (`openPisteNear`: the resort's start piste if open, else the open piste whose top is
  nearest to it). Outfits Neon 10 ★, Retro 30, Gold 60, Weltcup 120 (OUTFITS `stars`); the six old ones stay free.
- **Cloud save** (`cloud.js`): arcade game_saves row `ski` via the `__pbSave` / `__pbWantSave` / `__pbLoadSave` protocol (as MTB). The
  record is compact: `{ v, tb: total stars (monotone, the keep-progress trigger), s: {rid: "hhhhhm…"}, p: {rid: park points},
  b: {rid: "hhhhhtttttt…" best times, dropped first} }`; all 746 pistes x 3 stars ≈ 4.6 KB. Merge = union. Test mode: nothing.
- **Snow park** (`park.js`): `resort.json "park"` from `scripts/ski/park_osm.py` (OSM `piste:type=snow_park`, new fetch_osm layer
  `parks`; fun zones / cross / kids parks skipped) + `scripts/ski/park_site.mjs <rid>` (straight line down the fall line 260-420 m,
  scored on gradient / smoothness / open snow / lift; else placed by a lift). bake.py keeps an existing `park`. Parks: Killy
  "Snowpark Grattalu" (Tignes), 3 Vallées "VT Park", Zermatt "Snowpark Furggsattel", Kronplatz "Korer Snow Park" (260 m, no L),
  Arlberg "SANTON Park" (Rendl, 260 m). The corridor (hw 18 m + 10 m feather) is flattened to the baked profile through
  `createField({ park })` (no relief / piste kickers inside, counts as groomed). Features in lanes: kickers S/M/L (terrain:
  run-up h = H q^3.4, table, landing), 2 boxes + 2 rails (objects, fed by 6 m snow ramps), halfpipe (2.8 m deep, 45° walls on the
  lattice) when the line is ≥ 340 m. Physics `stepPark` around stepSkier: run-up holds the skier down, the lip launches him along
  its analytic slope (the 2.5 m lattice rounds lips off), rail capture / slide (steer = across), pipe lip turns the flight upward,
  soft speed check 15 m/s. `skier.js` trick mode (`world.tricks`): spin 9 rad/s by steering, flip 6.6 rad/s by pitch, grab = trick
  held, settling onto the nearest half turn / flip without input, landing judged (clean / sketchy / fall; SKI.spin*/flip*).
  Judge (`createTrickJudge`): spins 180-1080, flips, grabs, air time, feature multiplier (S 1, M 1.3, L 1.6, pipe 1.25, natural
  0.6), sketchy x0.5, combo x1.25 per trick within 4 s (max x3), a fall loses the open combo. Board `ski-<rid>-park`, stored
  **1,000,000 - points** (all ski-* boards stay lower-is-better), format `skipark` in pixelbreak-records.js (?v=71); make_sql.py
  adds `max_ms` to ski_board_floors and one row per park (stored 750,000..999,999 = 1..250,000 points). SQL NOT applied.
  Park view (`views.js createParkView`): one merged mesh (rails, boxes, legs, lip paint, coping dashes, nets, sign).
- **Controls**: F / Shift = trick (grab), W / S in the air = flip, steer in the air = spin, L / Enter = ride the lift; touch: a
  Trick button (park / free ride) + the pad dragged up / down while Trick is held = flip; gamepad Y, stick.
- **Free ride all day** (`freeride.js`): map tab "Fräi fueren" lists every lift (dots on the map, tap one); start on the piste that
  begins nearest its top. No clock, off-piste anywhere inside the box (150 m margin), rails slide here too. At a lift bottom (28 m,
  < 6 m/s) "Mam Lift erop" (L): fade, wait for the top's tiles (≤ 4 s), up; the clock moves on by the ride time. Day clock 9:00 ->
  16:30 (1 game hour = 4 real min); `env.setDayHour` blends the three looks while the time choice is "Zoufälleg" (a fixed time
  keeps its light). HUD: clock, km / vertical / lifts, minimap (`minimap.js`, 1.4 km, north up).
- Tests: `node pb/ski/harness.js <rid> --park` (section E, `modes/park-check.js`: every kicker, 360 / 720 grab / backflip, every
  rail / box, the pipe, a scored run; all 5 resorts green); flows `ski-challenges`, `ski-park`, `ski-freeride` (+ ski, ski-resorts,
  ski-ipad-start seeded / adjusted: reds need stars now). Shots: `~/Library/Caches/ski-work/round4a/`.
- Still rough: kickers are snow-shaded terrain (the lip paint marks them; no side walls); the pipe is a mini-pipe on the 2.5 m
  lattice; the scripted park rider rarely gets pipe air (players do with a steep line); trick button + pad flip not yet tried on a
  real iPad; MODES.challenge is only an alias (every run is the challenge).
