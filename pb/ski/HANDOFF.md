# Ski Alpen: handoff (phase 1 + rounds 2-5 + round 6: free ride main game, lift rides, ski types; 21 Nov 2026)

Arcade id `ski`, page `pb/ski.html`, code `pb/ski/`, pipeline `scripts/ski/`, data `pb/ski/data/<resort>/`. Phase 1 = the engine and one
resort, Espace Killy (Val d'Isère + Tignes). The game must NOT go live before the other four resorts are in (3 Vallées, Zermatt-Cervinia,
St. Anton, Kronplatz): Kronplatz and St. Anton are in since round 2B; the picker lists the rest as "geschwënn".

## READ FIRST: module versions (23 Nov 2026), after EVERY change or merge run the generator
**`python3 scripts/game_importmap.py`** (or `gamedata_manifest.py`, which runs it too), then commit `pb/ski.html` with your change. No more
hand-bumped `main.js?v=N`. After a rebase / merge run it AGAIN: two branches that changed different modules merge without a conflict, but
the hashes must match the merged files; a conflict inside the block of `pb/ski.html` is solved by running it (it replaces the markers),
then `git add pb/ski.html`. `scripts/check_site.py` (rule `importmap`, error) fails until the map matches: run it before every push.
- **Why**: main.js imports ~80 modules without a version and the host sends no Cache-Control: after a deploy a browser mixed old and new
  modules (minimap handler, first person / config) until a reload.
- **How**: the block `importmap:start … importmap:end` at the top of `<head>` maps every `/pb/ski/**.js` (harness*.js, data/, img/ aside) to
  `?v=<first 10 hex of its SHA-256>`; `./config.js` from any module, the entry `import("/pb/ski/main.js")`, computed `import()`s and the
  flows' `import("/pb/ski/bot.js")` all go through it, also in the arcade's srcdoc frame. File names and import lines stay as they are.
- **Rules the check enforces**: the block comes before any module / external script; no `?v=` on an import of a mapped module; every
  imported file exists; no `new Worker` in a mapped module (import maps do not reach into workers: version its graph first).
  A new module needs nothing but the generator run. CSS (`ui.css?v=`, `net/net.css?v=`) is still bumped by hand.
- `sw.js` revalidates `/pb/<game>.html` (`cache: "no-cache"`), so the page with the map is never an old copy of the HTTP cache. Browsers
  without import maps (Safari < 16.4) load the modules unversioned, as before.
- Flow `ski-modules`: every request carries the right hash (standalone + arcade), a deploy of one module against a full cache.

## Data pipeline (resort-generic, one `RESORTS` entry per resort in `scripts/ski/common.py`)
Venv: `~/Library/Caches/luxtram-work/.venv/bin/python`. Raw downloads cache in `~/Library/Caches/ski-work/<resort>/`.
1. `fetch_osm.py <rid> [layer ...]`: Overpass (pistes, lifts, buildings, land cover, water, roads, peaks / places); then `coverage.py <rid>`
   (is anything of the resort cut by the box?). See "Data round" below for what counts as a piste / lift.
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
4. `nice -n 10 ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/panorama.py <rid>`: the printed piste map (`panorama.webp` +
   resort.json `panorama`; ~30 s; works for a new resort without any setting, see "Printed piste map"); then `node scripts/ski/pano-check.mjs <rid>`.
5. `python3 scripts/ski/make_sql.py` (writes `scripts/ski-v1.sql` from all baked resorts) and `python3 scripts/gamedata_manifest.py`.
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

## Round 4B (21 Nov 2026): live online races (pb/ski/net/, separate from the game modes of round 4A)
- Lobby: `mp-games.js` id `ski` (arcade frame game, 2-8 players, settings resort / piste / weather / time / runs 1-3-5). A choice may now
  depend on another (`dependsOn` + option `when`, `optionsFor()`; mp-lobby.js offers only the matching chips, sanitizeCfg drops a stale
  one): the piste list follows the resort (6-7 named pistes each + random / random of a colour). SQL row: `scripts/mp-ski-v1.sql`
  (NOT applied yet; mp_invite refuses `ski` until it is). The picker has «👥 Online-Rennen» (MPGate.openLobby). ski.html loads
  mp-gate.js (`data-menu`, a bare visit stays solo) and adopts `#mpLobbyBtn` as «‹ Lobby».
- Plan (`net/plan.js`): random resort / piste / weather / time drawn from a seed of lobby code + roster ids: every device resolves the
  same match without a server (a rematch through the lobby draws anew). Random pistes: 0.9-3.6 km, >= 200 m drop, no repeat.
- Transport (`net/session.js`, `net/link.js`, the Kart pattern): full mesh, one RtcLink per pair (reliable "ev" + unreliable "st"),
  non-trickle SDP over the Realtime channel `ski:CODE` (presence with a nonce per page life: a reload is noticed and relinked), TURN
  from `turn?for=kart`. Two failed WebRTC attempts -> the pair's own relay channel `ski:CODE:r:A:B` (3 msgs/s, 2 states each, 4000
  msgs per pair + direction per match, the rate drops at 60 / 85 %). Pings: RTT + clock offset (lowest-RTT sample of 8).
- Race (`net/race.js`, pure, `node scripts/ski/mp-race-test.mjs`): each player skis and times his own run (normal physics, normal
  clock, normal board post through main.js finish()); a 'fin' counts only for the player whose link it came over. The coordinator
  (first roster player who is here or not yet met) paces: prep (all ready, else LOAD_TIMEOUT 30 s / MEET_TIMEOUT 50 s for unmet
  players) -> 'go' at now + 4.2 s in its clock (receivers convert with the link latency) -> end when everybody not gone has a result,
  FINISH_GRACE 45 s (or 60 % of the winner's time) after the first finish, or HARD_CAP -> results 9 s -> next run. Control messages
  only ever move a player forward; the host leaving = the next in roster order carries on. Points 10-8-6-5-4-3-2-1, standings by
  points / runs finished / total time. A reload keeps the match (sessionStorage `pb_ski_mp:CODE:seed`); a player who already started the
  run is DNF for it (no second try), a late loader starts late (his time is his own).
- View (`net/remotes.js`): snapshot interpolation 140 ms (relay 560 ms), extrapolation 300 / 800 ms; each remote skier = ONE
  SkinnedMesh (the figure's groups are the bones, every part bound rigidly) + a DOM name tag; distinct outfits on screen. Mass start
  side by side (main.js startRun `lateral`). After the finish: live table, «👁 Zuschauen» (chase camera on another skier).
- main.js hooks (small, all `if (mp)`): readMpContext / mpResort at boot, startRun -> 'hold', finish -> mp.onFinish, onAction,
  frame / render, viewState for the camera. env.setWeather / setTime got `save = false` (a race never overwrites the player's choice);
  RANDOM_WEATHER / RANDOM_TIME moved to config.js.
- Tests: flow `ski-mp` (3 contexts: picker -> lobby settings -> start -> WebRTC + one relay-only player -> 3 runs, host leaves in run 2
  -> final standings, 8 skiers' draw calls), `node scripts/ski/mp-race-test.mjs`, `perf-probe.mjs --remotes 7` (Niddreg, iPad profile,
  Coupe du Monde: 144 solo -> 152 with 8 players). Shots: `~/Library/Caches/ski-work/round4b/`.
- Still wrong / open: the hand-shake and the relay go through Realtime broadcast, which does not authenticate senders (someone who
  scripts the page could forge an offer or join a pair's relay channel and speak for that player in the in-race table; boards are
  safe: every board post comes from the player's own device through the normal score path). TURN uses the edge function's `for=kart`
  tier (an own `for=ski` needs a redeploy). A remote player behind a relay is seen ~0.6 s late. Name tags overlap in a pack.

## Data round (21 Nov 2026): every piste and lift, like the real ski areas (pipeline + data only)
Free ride is becoming the main mode, so a missing link piste = a place the player cannot reach. All five resorts rebaked.
- OSM downloads of this round: `$SKI_WORK/data-round/<rid>/osm/` (common.py `OSM_ROUND`, `osm_path`: a layer not downloaded again falls
  back to `$SKI_WORK/<rid>/osm/`). Pistes and lifts are asked for in the box + 0.03 deg, so `coverage.py <rid>` lists what of a resort
  is cut by the box edge (and which neighbouring areas sit in the margin). Overpass: 5 mirrors (lz4 / z overpass-api.de added, mail.ru
  dropped: self-signed), exponential back-off up to 10 rounds, a reply with an error `remark` is never cached.
- A box that changed gets its own cache folder (`RESORTS[rid]["work"]`, e.g. `arlberg-r5`): `fetch_dem.py` hard-links the old 5 m tiles
  under their new indices (`work_from` = old folder, old east0 / north0; tile origins are whole-tile multiples), fetches only the new
  tiles and a new far grid. The old folders stay untouched (other branches bake from them).
- Pistes (`bake.py build_pistes`): every `piste:type=downhill` way, any difficulty (freeride / extreme -> black), route relations (their
  name / ref / difficulty go to member ways that lack them; bare members become lines), multipolygon areas (outer rings), ski routes
  (`piste:grooming=backcountry`, freeride difficulty, "Skiroute ..."): flagged `route` in the runs and `"r":1` in the network, never
  benched or groomed. A line without a difficulty takes the colour of the pistes at its ends (else its gradient). Ways leaving the box
  are cut at the edge; a way mostly outside (a neighbour's piste) or inside `RESORTS[rid]["exclude"]` circles is dropped.
- Runs: the ways of one name + colour are split into longest downhill paths (`longest_paths`: end -> start within 25 m, or 120 m when
  the next starts lower: a piste interrupted by a road or a station). The first path is the run; a later one lying >= 50 % within 30 m of
  it is a second mapping (dropped), one touching it is a branch (a run "<name> (Variante)" when >= 250 m / 40 m drop, else only painted),
  one elsewhere is a second piste of that name ("<name> (2)"). Unnamed ways chain the same way into links named from what they lead to
  (`name_links`, never an invented name): "Verbindung → <lift>" (a lift's bottom station within 150 m of the end: Luxembourgish kind in
  front unless the name says it, "Sessellift Grand Pré", "TSD6 Tichot"), "Verbindung → <piste>" (joins it within 40 m), else the nearest
  named lift / piste / place within 600 m; duplicates become "Verbindung <from> → <to>" / "(2)". Runs >= 120 m long and >= 12 m drop
  (was 350 m / 70 m, named only). resort.json piste flags `link`, `route`, `variant` (optional; old clients ignore them). Board ids of the
  old pistes are unchanged (checked: every id of before still exists except `arlberg/skiroute-madloch-lech`, renamed in OSM itself).
  Slalom pistes and online races (net/plan.js `racePistes`) never pick links or ski routes.
- Lifts (`build_lifts`): every aerialway kind (`type` = the OSM kind: chair_lift, gondola, cable_car, mixed_lift, drag_lift, t-bar,
  j-bar, platter, rope_tow, magic_carpet), funiculars (several OSM ways merged: surface part + tunnel + passing loop, `tunnel: true` when
  mostly underground: Funival, Perce-Neige, Sunnegga) and listed railways (`RESORTS[rid]["railways"]`: the Gornergrat Bahn, tag match +
  its real name, with `stops` = [arc m, station name]). Kinds `funicular` / `train` are new: lifts.js skips unknown kinds (no cable drawn),
  the map draws them as lines. New optional fields: `osm` (way id), `ref`, `type`, `rise`, `cap` (aerialway:capacity / h), `dur` (min),
  `heated` / `bubble` / `detachable`, `bottom` / `top` = {x, z, y ground, name of the OSM station within 60 m, osm = the mapped station
  position}. Lifts with an end outside the box are dropped (another resort's).
- Coverage: default `near_keep` 700 m everywhere again (the 150 / 220 / 350 m budget cuts are gone: streaming makes the size free), boxes
  widened where coverage.py found cut pistes / lifts: Killy east (Le Fornet / Pays Désert), 3 Vallées south (Orelle gondola), Arlberg
  north-west (Warth-Schröcken, Sonnenkopf) and south (Rossfall route).
- First play (main.js / resort-data.js, small loader change): `streamer.hold(startRadius + 200)` at boot = only the tiles around the
  start load until Start is live (or a run starts), then `release()` and the rest streams nearest-the-player first (the focus follows
  the skier, so tiles near where he goes / where a lift ride ends come first). Before, every tile streamed at once and the terrain
  re-meshing of far tiles held Start back. `classes.z` = classes.bin zlib-deflated, inflated with DecompressionStream (fallback
  classes.bin; ski.html preloads the one it will use): half the classes bytes.
- Checks: `check_official.py <rid> OFFICIAL.json ...` compares with an official lift / piste list (kept outside the repo, never shipped:
  `~/Library/Caches/ski-work/data-round/official/`) and says per missing name whether OSM lacks it, has it outside the box, or has it
  but it is no run.
- Result (before -> after; km = sum of the run centre lines; first play = bytes until Start live on the iPad profile, cold cache):

  | Resort | pistes | km | lifts | total MB | first play MB | iPad start |
  |---|---|---|---|---|---|---|
  | 3 Vallées | 297 -> 480 | 414 -> 503 (network 543) | 166 -> 180 | 10.5 -> 14.5 | 4.83 -> 4.65 | 6.8 -> 6.0 s |
  | Killy | 138 -> 235 | 170 -> 239 (256) | 82 -> 84 | 7.6 -> 8.4 | 6.33 -> 2.82 | 7.5 -> 4.1 s |
  | Zermatt | 122 -> 209 | 171 -> 232 (248) | 64 -> 68 | 10.2 -> 12.7 | 3.18 -> 3.29 | 5.8 -> 4.6 s |
  | Arlberg | 139 -> 356 | 171 -> 402 (440) | 75 -> 101 | 10.2 -> 19.9 | 4.71 -> 4.15 | 5.9 -> 5.8 s |
  | Kronplatz | 50 -> 71 | 65 -> 76 (82) | 28 -> 28 | 8.4 -> 8.8 | 4.98 -> 3.03 | 8.1 -> 6.1 s |

  Harness `--all`: 233/235, 480/480, 207/209, 349/356, 71/71 to the bottom, zero tile steps. `round6-test.mjs`: 1927/1927 (every lift
  ridden end to end; `rideSeconds` now clamps short lifts like `createRide`). Flows ski, ski-resorts, ski-ipad-start, ski-mp,
  ski-challenges, ski-park, ski-freeride, ski-lift, ski-skis, home-page, arcade-pad green. Official lists (missing names, why): Arlberg + Warth + Sonnenkopf 0 of 110 lifts / 5 of 242 pistes missing (was
  39 / 102), all OSM gaps (Sichelmahd, Fun Slope, Paulis Abenteuerland, Tal-Abfahrt Vermalen; "Madloch - Lech" is in OSM under another
  piste:name). Zermatt 0 / 25 lifts, 4 / 35 pistes (snowpark, unnamed Italian service tracks). Kronplatz 6 / 32 lifts, 10 / 47 pistes:
  the not-connected satellites of the Kronplatz pass (Terenten, Riepen, Gsies, Guggenberg, Antermoia) and names OSM does not carry.
  3 Vallées 9 / 156 lifts (magic carpets not in OSM), 26 / 358 pistes (fun zones, kids areas, "Bd ..." boulevards not in OSM). Killy:
  the official list could only be read for 4 Tignes sectors (all found but one carpet).
- Still open: 3 Vallées first play 4.65 MB (far.bin 1.4 MB + classes.z 0.7 + map.webp 0.6 for the 20 x 29 km box): a coarser far
  margin or a tiled classes raster would cut it (render side). The signs atlas (props.js) is 8 boards wide x 48 px per piste: 480
  pistes = 2880 px high, the limit of 4096 px comes at ~680 pistes. Underground funiculars (`tunnel: true`) are ridden like trains on
  the surface by lift-path.js (round 6); freeride.js `spawnLift` no longer starts on one (Killy spawns at La Daille, not the Funival). Kronplatz satellites and Valmorel / La Plagne / Monterosa stay out (not connected).

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

## Round 5 (21 Nov 2026): the look (resolution, antialiasing, snow, rock, sky, park features) + rounds 4A and 4B merged
Ian: "it doesn't look really good visually yet, it's still really pixely". Branch = round 4B + round 4A (merged here) + this round.
- **Picture pipeline** (`post.js`, new): the scene is drawn into an offscreen target at an INTERNAL pixel ratio (MSAA where WebGL 2 gives
  it), one full-screen pass puts it on the canvas, which now always has the screen's own resolution (CSS size x devicePixelRatio, max 2):
  FXAA on edges (alpha-tested cards, thin shader lines), unsharp mask elsewhere (stronger the more the picture is stretched), a little
  grade, a dither against 8-bit bands. `renderer.info.autoReset` is off; the counters restart at the sky's `onBeforeRender` (= after the
  shadow pass, as three's own reset), so `__ski.info()` counts as before (+1 for the final quad).
- **Dynamic resolution**: `QUALITY[level].res` (config.js) = { start, min, max, samples, sharpen, supersample } against CSS pixels:
  Niddreg 1.25 (0.9..1.5, MSAA 2), Mëttel 1.5 (1.1..2, MSAA 4), Héich 2 (1.5..2, MSAA 4; 1.5x supersampling on a 1x screen). The
  controller (post.js `tick`) only knows frame times (Safari has no GPU timer): frames over budget that our own JavaScript does not
  explain (JS < 72 % of the frame) step down 9 % (18 % when far over) after 0.45 s; 2.6 s on the display's beat tries one step up; a step
  up that fails within 6 s is remembered and its retry wait doubles (12 s .. 90 s), so it does not saw. The Grafik watchdog only steps
  the LEVEL down once the resolution sits on its floor. `?res=fixed` freezes it (picture tests); `__ski.resolution()` reports it.
  Old Niddreg was pixel ratio 1 without any antialiasing, stretched 2x by the browser.
- **Snow / rock** (`snow-shader.js`): a detail texture (`env.js createDetailTexture`: 256 px tileable, RG = slope of a grainy surface,
  B = sparkle grains, A = crags; mipmaps + anisotropy 8) bends the light at 2.3 m / 17.5 m / 107 m repeats; corduroy at 34 rad/m, lit as
  ridges, faded by its own pixel footprint (`fwidth` of the across-piste coordinate: no moire) out to 70-160 m; clearer blue shade, warm
  white sun; Mëttel / Héich: a sheen towards a low sun and sparkling grains (view dependent, two grain sizes). Rock: the baked rock share
  is painted as crisp patches of that share (thresholded by the crags) instead of a grey blend, crag-lit normals, warm / cool faces,
  snow in the cracks. Aerial haze 0.6 x (1 - exp(-d * 6.2e-5)) in every painted material (FOG_GLSL), fog brighter towards the sun.
- **Far mountains**: `env.js createFarNormalTexture(far, 40)` turns the far grid into a normal map at load (RG normal, B relief: ridges /
  gullies; ~10 ms, nothing shipped; NOTE `far.step` is the height quantum, the node spacing is `resort.far.step`). The terrain shader
  blends from the mesh normal to it between 1200 x lodScale and twice that (uFarFrom): far tiles are much coarser than 40 m, per-pixel
  light keeps ridges, gullies and faces crisp on every level (Niddreg gains most). uShadowRect is now always set (the map shares it).
- **Sky** (`env.js`): three-stop gradient, sun disc + halo + low-sun glow, a pale bright patch behind overcast, clouds = four noise
  octaves in one read + small tufts, a brushed edge, lit from the sun's side, grey-blue bellies, a structured ceiling when overcast;
  horizon haze with the sun's glow; `uMilk` (the weather's white-out share) veils the sky in fog / snowfall. Evening ambient bluer.
- **Trees**: far 3D trees are two stacked cones (spruce skirt + top, slim larch on a trunk); the far tree cards go out through alpha to
  coverage (smooth silhouettes with MSAA), atlas anisotropy 4.
- **Snow park** (`modes/views.js createParkView`, asked by the coordinator): every kicker wears its size's colour (S green, M blue,
  L red): lip board, landing line at the knuckle, cut side cheeks along the run-up (packed-snow walls with a coloured top edge), two
  flags at the lip, a lettered size sign; boxes with steel edges, striped sides and end plates; rails with an under-tube and orange end
  caps; a continuous orange coping on both halfpipe lips + a PIPE sign; a gate with the park's banner across the drop-in. The lettering
  is one canvas atlas (`parkAtlas`), one extra draw call (`ski-park-boards`). Physics untouched.
- **Merge**: round 4A (`worktree-agent-a6c20504503382119`) merged; both sides kept in ski.html, env.js (RANDOM_* from config.js + DAY_KEYS),
  main.js (mp + modes hooks; an online race may start on a locked piste), run_all.mjs (ski-mp + the three mode flows).
- **Shot tooling** (the real look: Mac GPU through ANGLE Metal, DPR 2 = an iPad's 2160 x 1620): `shot.mjs --gpu --dpr 2 --root <other
  copy> --shots "name=tp:250;name=pose:..;name=orbit:..;name=tp:900@fog/midday" --script file.mjs`; `look-shots.sh OUT [ROOT]` (5 resorts
  x Niddreg / Héich: run, vista, Killy close-ups + weather), `look-park.sh` + `look-park.mjs` (star map, park), `look-sheets.sh DIR`
  (`look_sheet.py`: stacked, labelled, one column). Flows `ski`, `ski-resorts`, `ski-park` now run at deviceScaleFactor 2
  (`flow.deviceScaleFactor` in lib.mjs). `perf-probe.mjs --gpu` prints the average internal resolution.
  Sheets: `~/Library/Caches/ski-work/round5/sheet-*.jpg` (before / after), raw shots in `before/` and `after/`.
- **Perf** (`perf-probe.mjs --levels low --resort <rid> --gpu`: iPad profile 1080 x 810 at DPR 2, CPU x4, the Mini's GPU; a scripted
  run from the start piste): Niddreg holds 16.7 ms p50 on all five; the internal resolution averages 1.33-1.40x and reaches the 1.5x
  ceiling (old Niddreg: 1.0x, no AA): Killy 1.39x (running after 3.5 s, 136 draw calls, 373k triangles), 3 Vallées 1.38x (4.8 s, 139,
  416k; p95 33 ms), Zermatt 1.33x (3.9 s, 150, 360k), Arlberg 1.40x (3.7 s, 160, 457k), Kronplatz 1.35x (5.1 s, 148, 357k). The
  controller holds for 6 s from a run's start (`post.hold`: tiles, trees and shaders settle; without it the start hitches pushed the
  resolution to its floor). Flow `ski-ipad-start` (Start live, with the Mini's load near 50): Killy 6.8 s, 3 Vallées 8.6 s, Zermatt
  7.1 s, Arlberg 6.5 s, Kronplatz 8.2 s. Héich at 2x + MSAA 4 with shadows is GPU-bound on the Mini in 3 Vallées (p95 33 ms): it then steps down.
- Tests green at the end of the round: flows ski, ski-ipad-start (x5 resorts), ski-resorts, ski-mp, ski-challenges, ski-park,
  ski-freeride, home-page, arcade-pad; `harness.js <rid> --all` on all five; `--park`; mp-race-test.
- Still wrong / open: evening snow in the shade is still rather violet; no real-iPad GPU measurement (the controller is built for it, the floor of Niddreg costs about what the old
  Niddreg did + MSAA 2 + the final pass); MSAA does not smooth shader detail, far strata lines can still crawl a little in motion (no
  temporal AA); near trees are still plain tiered cones (no bark / needle detail); the frozen lakes still read mostly as snow; the
  kickers' snow body is the 2.5 m terrain lattice (rounded), only the dressing is crisp; halfpipe walls show the lattice as saw teeth
  from inside; buildings and lifts untouched this round; name tags / HUD untouched.

## Round 6 (21 Nov 2026): free ride is the main game, real lift rides, challenges on the mountain, everything unlocked, ski types
Ian's requests; our own design (no other game's look, UI, names or content). Branch = round 5 + this round.
- **Game flow**: picker -> straight into the FREE RIDE at the bottom station of a lift in a village (`freeride.js spawnLift`: the lift
  bottom nearest a `village` / `town` place, chairs / cabins / trains before drag lifts, a bigger rise preferred; main.js `boardSpot`
  = inside the boarding zone, facing up the line, on open snow: the class raster's built share under the skier and under the chase
  camera). The first build behind the loading screen happens there (iPad start). `?go=1` / session flag `pb_ski_open_map = 'free'` =
  straight into the free ride (switchResort uses it, the URL becomes `?resort=<id>&go=1`); `?map=1` still opens the map (flows), `?piste=`
  / `?auto=1` / online races as before. Time and weather follow the menu choice (random default, G / T and the HUD in game).
- **Free ride** (`MODES.freeride`): ski anywhere (off piste inside the box), no timer, the lifts never close (the 4A 16:30 closing is
  gone; the day clock still moves the light while the time is random). Session counters (distance, vertical, lifts, off-piste metres)
  live for the page life (`host.sessionStats`), across challenges, fast travel and rides. Tricks in the free ride: `world.tricks = 'hold'`
  (skier.js: an air turns into a trick only while the trick button is held or a rotation is going), so a steer in a small air never spins.
- **Map = pause overlay** over a free ride (M / ☰ Pistekaart; `#mapResume` "Weiderfueren", M / Esc go back to the same spot, nothing is
  torn down; `game.resume` keeps the skier where he was while the map picks pistes). Tabs: **Fräi fueren** (first; lift list + dots at
  the BOTTOM stations, "Du" marker, "Bei de Lift" = fast travel with a fade until the tiles there are in, <= 6 s), **Challengen** (the
  old piste list: Start = teleport to the start gate + 3-2-1), **Snowpark**, **Skier** (ski types).
- **Lift rides** (any lift of the data, no lists): `lift-path.js` (pure) maps the data kind onto five classes (`LIFT_CLASS`: chair,
  gondola (+ mixed_lift), cable, drag (t-bar, j-bar, platter, rope_tow), train (funicular, railway, rack, rack_railway, narrow_gauge,
  train); carpets are not ridden) and builds the rope over the pylons (lifted where a span would cut the slope; `hang` raised so cabins
  clear the snow). lifts.js draws from it (+ trains: two tracks of rails, carriages tilted with the slope, platform stations), `setRide`
  holds one carrier at the player's s (the pool skips it, the others keep their spacing and carry on smoothly afterwards), `dispose`;
  main.js `buildLifts` builds the view early for a ride before every tile is in and again (between rides) once all are in.
  `modes/liftride.js` (pure): `createRide` (boarding RIDE.enter m past the bottom wheel, off RIDE.exit m before the top one, RIDE.factor
  = 4 x the real line speed), `riderAt` (carrier + rider: seated on a chair, standing in a cabin / carriage, on the snow behind a T-bar),
  `rideCamera` ('chase' = beside / behind the carrier, riding with it, its offset eased; 'window' = the rider's eyes: chair looks 18°
  down to the bar and the chairs ahead, cabins through the front window from the middle, the figure hidden in a cabin). `modes/carriers.js`
  = the player's own carrier in detail (chair with the data's seat count, cushions, bar and footrest; gondola / cable car with glass;
  T-bar; train carriage). Poses in skier-model.js (`state.ride` = 'sit' | 'stand' | 'drag'; skis and poles in the rack in a cabin).
  Controls: in the boarding zone (30 m, < 6 m/s) "Astegen: <lift>" (L / Enter / button) and 🎿 (ski card); riding: "Iwwersprangen"
  (Enter / L / button, a short fade), "Vue" (V / button). Off at the top: `lifts.startAt` (a piste that starts within 80 m, else 14 m
  past the station down the fall line). The day clock moves on by the real ride time.
- **Multiplayer**: `net/wire.js` (pure; remotes.js re-exports) adds three numbers while riding: [kind code, lift index, s] ("riding
  lift X at s"); a friend on a lift is drawn in his own carrier on the real line (`createRemotes({ liftPath })`, main passes
  `lifts.pathOf`). The online race itself has no lifts; a shared free ride would be the next step.
- **Challenges on the mountain** (`modes/markers.js`): a start gate (posts + banner in the piste colour, gold at ★★★, violet for the
  park) at every piste's start (`at(2)`, where the timed run starts) and at the park's drop-in: ONE instanced mesh per resort, DOM labels
  (name + stars) on the nearest 4 within 260 m (free ride only). Skiing into a gate (9 m) shows "Challenge: <piste> ★★☆ → Start?" with
  the goals (`#chPrompt`, Enter / Start / Nee; it re-arms 30 m away); Start = the normal timed run (3-2-1, ghost, board); every finish
  card (piste and park) has "Weider fräi fueren" (free ride on from the bottom). The challenge list in the map stays.
- **Everything unlocked**: `challenges.js lockState` is always open, `outfitOpen` always true (the UNLOCK table stays only for callers).
  Stars stay the progress measure and unlock skis.
- **Ski types** (`modes/skis.js`; skier.js reads `world.ski`, a full SKI copy with factors; config.js SKI untouched):

  | ski | handling (factors on SKI) | unlock |
  | --- | --- | --- |
  | All-Mountain | reference | from the start |
  | Carving | grip 1.3, carve 1.25, edge lock 1.35, skid 0.8; powder: grip 0.78, friction 1.25, drag 1.45 | 10 ★ |
  | Race GS | tuck drag 0.86, friction 0.88, carve 0.74, pivot 0.8, landing 1.12 | 30 ★ + 90 km/h top speed once |
  | Powder | powder drag 0.42, powder friction 0.62, powder grip 1.35; piste friction 1.35, grip 0.82 | 10 km off the piste |
  | Park twin-tip | spin 1.22, flip 1.18, landing tolerance 1.25-1.6, settle 1.3-1.4, slower (drag 1.08, friction 1.08, cap 0.92) | 5,000 points in one park run |

  Measured (scripts/ski/round6-test.mjs, a plane): piste 12° tuck top speed AM 85 / Carving 85 / Race 92 / Powder 82 / Park 82 km/h;
  powder 22°: 51 / 42 / 48 / 74 / 51 km/h; a 90° turn at speed 1.85 / 1.34 / 2.07 / 2.30 / 1.83 s. On the real mountain (flow ski-skis):
  Powder 20 m vs AM 17 m off piste in 4 s, carve 0.6 s at 58 km/h: Carving 27°, AM 18°, Race 14°.
  **Fairness (decided)**: every run that is timed or scored against others (star challenges = the piste boards, the park board, online
  races) runs on the reference (All-Mountain) physics whatever ski is on (the look stays; `data-ski-physics` = 'fair'); the boards stay
  one fair list and the star targets (a 1D ride of the reference skier) stay right. The ski types shape the free ride (the main game).
  The Skier tab says so. Look per ski: base colour, tip colour, one top-sheet pattern (stripe / chevron / race / dots / zigzag, recoloured
  vertex slots: no extra draw call), length / width (edge group scale), twin tip (its own group, +2 draw calls only on that ski).
  Picking: Skier tab, the 🎿 card at a lift station. New skis open with a toast (free ride) or "Op: Ski <name>" on the finish card.
- **Saves**: local `progress.stats = { off: m off the piste, top: m/s }` (free ride, never from scripted / bot input) and `progress.ski`;
  cloud record `x = { o: metres, t: top speed x10, k: ski }` (an old game ignores it, an old record reads as zero, merge = max; `tb` is
  unchanged, so the keep-progress trigger behaves as before). Stars and best times untouched.
- **For the bigger data (parallel agent)**: nothing is listed by hand. Every resort.json lift with a known kind (`LIFT_CLASS`; add a new
  kind string there) and >= 25 m rise is rideable and travelable; `seats` sets the chair width; every piste gets a gate; the spawn comes
  from `places`. Rail kinds ride as trains (checked with a synthetic rack railway in flow ski-lift; no real train in today's data).
- **Tests**: `node scripts/ski/round6-test.mjs` (every lift of every resort ridden start to end, no jumps, cabins above the far grid, the
  spawn, the gates, the ski table, unlocks, saves / cloud, the wire); flows `ski-lift` (gondola at the village: L, cabin, pylons, window
  view, Iwwersprangen, off facing downhill; chair via the map's fast travel: seated, held carrier, rides to the top on its own; drag lift
  on the snow + the wire state; synthetic rack railway), `ski-skis` (locked tab, the 10th star opens Carving, 20 m more off piste with
  real keys open Powder, measured handling, fair timed run, lift card, save + cloud), and updated `ski`, `ski-challenges`, `ski-freeride`,
  `ski-park`, `ski-mp`, `ski-resorts`, `ski-ipad-start` (now: skiing = the free ride running, gate 10 s).
- Shots: `~/Library/Caches/ski-work/round6/` (`scripts/ski/round6-shots.mjs` through shot.mjs --gpu --dpr 2; sheets with look_sheet.py).
- **Perf** (Mini, Niddreg, load < 40): flow `ski` p50 16.7 / p95 16.8 ms, 136 draw calls, 419k triangles; free ride 91 calls; riding a
  chair / gondola / drag lift 141 calls (+1-2 for the own carrier, +1 gates). iPad start (`ski-ipad-start`, Killy): picker 4.4 s,
  skiing in the free ride 7.2 s (3.5 MB). With the Mini at load ~400 the same flow measured p95 33 ms (not the game).
- **Still wrong / open**: the instanced chairs / cabins far away are still plain boxes (only the ridden one is detailed); in a cabin
  the window view still shows a wide ceiling band; skis vanish in cabins (no outside rack); the gate posts' base takes the banner tint;
  no shared free ride online yet (only the "riding lift X at s" wire state and its drawing); no real train in today's data (checked
  with a synthetic rack railway); the ride's exit can land beside a summit building (it uses the nearest piste start within 80 m).

## Round 7-B (21-22 Nov 2026): every lift real (stations, carriers on the cable, drag lifts, tunnels, aisles)
Ian's play feedback (Safari, 3 Vallées). Everything is resort-generic and checked on ALL five resorts and EVERY lift.
- **`lift-site.js` (new, pure)**: both stations of every lift by type (oriented boxes in the end's own frame: a = outward along the
  line, b = across, +b = the up lane's / boarding side): chair `platform` (deck, canopy on four posts over the wheel, operator hut on the
  return side, boarding gates), gondola `hall` (open hall, back wall, glazed return-side wall, platform side open), cable car `terminal`
  (roof over the docked cabin, machine building behind), drag `hut` (wheel mast, hut beside the track start, start line), carpet `belt`
  ends, rail `rail` (platform hall, buffer wall); tunnel portals for underground funiculars (fixed arc 36 m from each end); a train's
  `stops` = mid stations (only where the data has them). `solid` parts collide (skier: `world.hit` in main.js, carriers, exits);
  `pruneCrossings` cuts any part standing in another lift's carrier path or on its riders' walks (twin lifts, shared stations:
  Matterhorn Express 2/3, Falkenkopf, Vallugagrat), by the ground plan only so drawn and collider worlds agree. `createLiftWorld`:
  boarding zones (`boardingAt`), `exitOf` (24 directions + points down a piste starting at the top, outside every station / building /
  low lane, walkable (<= 0.6, else <= 1.0) snow, facing downhill, 15 m clear, the way out clear of parts, buildings, trees and low lanes;
  `via` = a walk down the piste), `keepBuilding` (OSM buildings in a station or a low lane are left out of the village), `treeBlocked`.
- **`lift-path.js`**: stations' wheels at boarding height (chair seat at knee height, cabin floor level with the platform), the rope
  level through the hall (`STATION_LEN`), sag per span (never below the clearance need), wide chairs get their rope farther out (no
  inner seat at the pylon), a real loop (`loopAt`: up lane, round the top wheel, down lane, round the bottom wheel), jig-back cabins /
  trains shuttle between their docks (`shuttleAt`, `docks`), drag lifts: track = up lane `side` m beside the pylon line, return rope
  `back` m on the other side, `track: -1` (bake) puts the track on the left; direction blended over 8 m at polyline bends (no lane
  jumps); `tunnel` lines dive 15 m per 70 m into the hill (vault under the ground between the portals); new class `carpet`.
- **Carriers** (`modes/carriers.js` = one part list for the instanced pools of lifts.js AND the player's own carrier): grip + hanger arm
  on every chair / cabin, near + far LOD per model (chairs per seat count), swing, round the bull-wheels; empty pool chairs have the
  bar up, the player's comes down 9 m out of the station; T-bar / platter / J-bar per OSM kind on a spring line (retracted when empty,
  reels out to the rider's hips); rope tows: the rider holds the rope; carpets: a moving belt texture; worn drag track ribbon.
- **Rides** (`modes/liftride.js`): phases `board` (cabins: step out of the skis, carry them on the shoulder to the door; chair / drag /
  carpet: skate to the loading line; the NEXT carrier of the lift's own loop arrives: `lifts.nextCarrier`, at most 2.5 s wait) ->
  `ride` (skip only here, after 0.6 s: one press = one boarding) -> `alight` (off onto the outer platform, out of the station to the
  exit, cabins: skis down + click in) -> done; then main.js `game.hold`: 0 km/h until steer / push / tuck / jump / brake (also in the
  boarding zone after fast travel). Window view in cabins from just behind the front glass (no ceiling band); tunnel: the chase camera
  stays in the tube (`inside`, no ground clamp). Hook for agent A's look module: `window.__skiLook.apply(cam, { inside, kind, lift })`.
  skier-model.js pose `carry` (skis on the right shoulder, walking gait from `state.walk`); wire pose codes 2/3/5 = carry, 6 = belt.
- **Bake** (`scripts/ski/lift_sites.py`, called by bake.py): twin drag lifts mapped on top of each other set 10 m apart, drag track
  side away from neighbours, pylons moved along their line out of another lift's lane, level station pads (<= 9 m cut/fill, 12 m
  blend), tree aisles in the class raster (aisle half widths AISLE, kept where the carriers pass >= 15 m over the treetops; stations +4 m
  and pylon bases cleared). scatter.js takes `opts.guard` (lift-site.js `liftTreeGuard`) so no near tree or boulder stands in an aisle.
  All five resorts rebaked (park kept).
- **Tests**: `node scripts/ski/round7b-test.mjs` (every lift of every resort on the 5 m heights: both stations, waiting spot in its own
  zone and clear, 6 m outside = no boarding, no skip while boarding, board > ride > alight > done once, no jump, rider + every carrier
  of the loop never touch a pylon / station part / tree (exact rectangle SAT), drag skis on the track within 3 cm beside the pylon
  line, the return loop, tunnels underground, the exit rules); flow `ski-lifts-all` (FLOW_SKI_RESORTS=..., Chromium and
  FLOW_BROWSER=webkit: the same per-lift checks with the page's own objects, 0 km/h for 3 s after every exit, one real ride per kind with
  the keys incl. the double press). Shots: `scripts/ski/round7b-shots.mjs` (through shot.mjs --script).
- **Boarding rule (final, R7-B owns it; R7-A's 12 m and R7-C's 42 m radii are replaced when merging)**: there is no radius any more.
  A lift is boarded only from its boarding ZONE, a small rectangle in its own bottom station (lift-site.js `zone`: chair 3.2 x 2.2 m
  behind the gates beside the chairs' lane, gondola / cable car / train ~4.4 x 2 m on the platform beside the cabin's door, drag lift
  the track start, carpet the belt start), tested by `freeride.js boardingAt` -> `liftAt` (button + L) and again by main.js `boardLift`
  (`site.inZone`). Fast travel / the spawn put the skier on the zone's waiting spot (`boardAt` = `site.wait`). R7-C's 42 m came from the
  Val d'Isère OSM station building pushing the spawn away from the line end: the OSM buildings in or over a station are now left out of
  the village (`keepBuilding`), so the waiting spot is always inside the station and clear (checked for every lift of every resort).
- **Results** (22 Nov, 00:45): round7b-test 4625 / 4625 (5 resorts, 459 drawn lifts, 452 ridden), round6-test 2307 / 2307, harness all
  five green. Chromium: ski-lifts-all (all 5 resorts: every lift's stations, zone, exit, 3 s still; 32 real rides, one per kind per
  resort, incl. the double press), ski-lift, ski, ski-freeride, ski-ipad-start, ski-resorts, ski-mp, ski-challenges, ski-park,
  ski-skis green; Niddreg 141 calls, 397k triangles (was 419k). WebKit: ski-lifts-all, ski-lift, ski-freeride green; ski green except
  its frame-time gate (p95 28 ms in software-rendered headless WebKit; Chromium 16.8 ms).
- **Still open**: exits are computed when he gets off (one ~50-150 ms search on the iPad, once per ride); the lift stations are our own
  type models (not the real buildings' shapes); 69 of 933 station frames lose 245 parts (posts, roofs, huts) to a neighbour's
  carrier path or rider walk (`part.cut`; shared / twin stations look incomplete there); Vallugagrat's exit is a walk down the Vallugagrat piste (the only clear way); A's look module not merged here
  (hook `window.__skiLook.apply` in main.js rideCamera1).

## Round 7 A (21-22 Nov 2026): Safari / ground / spawn / skier / camera / buildings (+ the first R7 items before the split)
Branch `worktree-agent-a77ab887e8a786804` (from the data round ae58a6ad). The coordinator split R7 into A (this), B (lifts), C (map +
features), D (online + perf + look). Before the split this branch had already done parts of B / C / D; they are listed last, so the merge
can keep or drop them.
- **Safari / WebKit**: `scripts/flows/ski_webkit.mjs` (flow `ski-webkit`, run with `FLOW_BROWSER=webkit` and without): every resort, no
  shader / GL / console error, the picture has colour + snow detail + sky detail, skier on the ground, free look; green in WebKit.
  Headless WebKit on the Mini renders the same as Chromium; Ian's "flat blue sky + flat snow" was the camera facing / inside a building
  wall at the spawn (below). Safety net in main.js: `renderer.debug.onShaderError` records shader failures; `pictureCheck()` reads the
  canvas 3.5 s into the free ride: a one-colour picture or a shader error steps down (cheap snow -> post.fallback(1) no MSAA ->
  post.fallback(2) no post pass). `scripts/ski/webkit-probe.mjs` = side-by-side screenshots + GL caps per engine.
- **Spawn** (`modes/spawn.js`, pure): FIRST_LIFT per resort (Solaise, Verdons, Matterhorn Express 1, Galzigbahn, Kronplatz 2000);
  `liftSpot`: beside / in front of the station looking UP THE LINE (a point 45 m up the rope), the view from the chase camera to 25 m
  ahead free of every building footprint (buildings.json boxes, `createBoxIndex`), nothing built under skier / camera; `exitSpot`: the
  top exit outside all buildings, facing down the fall line, 15 m clear (used by `arrive()`). Lift boarding zone = 12 m round the
  station or its board spot (`lift.board`), the rider skates into the station (RIDE.boardTime 1.1 s), one press = one boarding
  (`actionLock` 1.4 s, a double tap never skips the ride). goFree waits for the footprints and the tiles under the spot; a finer tile
  arriving under a standing skier re-snaps him (main.js onTile).
- **Ground = physics**: streets (`roads.js`) are now emitted ON the 2.5 m physics lattice (the ground's own triangles, same diagonal rule,
  +3 cm, far away pulled towards the camera in the vertex shader) and painted from the distance to the centre line (no raised banks, no
  ribbon cutting across the lattice: the skier stood 10 cm deep in streets, banks crossed streets as spikes). `scripts/ski/ground-check.mjs`
  (all 5 resorts x Chromium + WebKit): spawn on the ground, 5 village spots each: street vertices vs physics, 40 rays down vs physics
  (<= 6 cm), ski clearance, a scripted carve (skis >= -2 cm), a coplanar-triangle scan of the village meshes (z-fighting): 10 / 10 green.
- **Skier**: leg IK on the terrain (`skier-model.js plantSkis`: tips / middle / tails of both skis vs the ground, the knee bends to lift
  a ski that would cut the snow; `skiClearance`); plough = tips in / tails out on the inner edges, knees in, low and forward; hockey stop
  (skier.js `stop` / `stopSide`, config HOCKEY*): a player's brake above 25 km/h (or brake + hard steer) swings the skis across, digs
  in, spray burst; scripted input never does it (`input.hard`). Braking always ends in a full stop that HOLDS (`state.hold`, plough
  decel now counters the slope); a placed skier holds until input; only > 38 degrees side-slips.
- **Camera**: `look.js` = free 360 look (right drag / C + mouse / two-finger swipe on Mac, a drag on the free screen on the iPad, never
  the steering; eases back after 0.9 s, faster at speed; 'orbit' for third person + lift chase, 'head' for first person + cabin window)
  and `createCameraGuard` (the line skier -> camera never through ground, pylons, station halls, trees or houses; eases out). The chase
  camera climbs and drops back with the speed (CAMERA.rise*). Shadow acne: slope-scaled offsets (`uSunL`). Horizon: FOG_GLSL fades the
  last stretch before `uFarEnd` (= quality.far) and the far grid's last 3.5 km into the horizon haze; far rock only on steep faces.
- **Buildings**: railings with thickness (two coplanar back-to-back faces flickered), balcony slabs off the wall and per-house heights
  (neighbours' balconies z-fought), stone plinths down to the lowest ground on slopes, windows ~1.1 x 1.35 m with shutters, half of
  the big "chalet" houses in the Savoy mix.
- **Done here before the split (B / C / D may keep or replace)**: far.bin height step 1 m (`scripts/ski/far-quant.mjs`, bake.py
  FAR_QUANT; 3 Vallées first play 4.51 -> 3.57 MB), sign atlases (props.js, 336 per 2048 px atlas), tunnel funiculars (lift-path.js
  `tunnels`, modes/tunnel.js tube + portals + dark fade), carrier models (lifts.js), cabin window camera, carried skis, gate tint
  (markers.js aTint), name-tag declutter (net/tags.js), run props batched (slalom 256 -> ~140 calls), `scripts/ski/calls-sweep.mjs`,
  first person (fpcam.js, V / 🎥), spray + tracks (effects.js), avalanches + Lawin (modes/avalanche.js), online free ride
  (net/freeride.js, lobby setting `mode`), park bodies (views.js + snow-shader uParkRect), look leftovers (evening shade, strata AA,
  firs), drag-lift track beside the pylons. Tests: `scripts/ski/round7-test.mjs` (spawn / exit spots of every lift, tunnels, avalanches,
  tags, braking physics), `round6-test.mjs`.
- **R7 A follow-up (coordinator review, 22 Nov)**: (1) the "vertical stretched terrain wall" beside the piste in the carve shot was the
  debug orbit camera (`__ski.orbit`) placed INSIDE an uphill bank (it had no ground clearance): it now keeps 0.6 m over the snow; the
  physics ground there is at most 35 degrees. Real seams were checked too: right after a teleport the full-detail tiles need ~1.5 s to
  mesh (coarse tiles and half-built skirts show meanwhile), so every fast travel / lift skip now meshes the ground round the target
  behind the fade (`meshedAround`, the terrain gets a 12 ms slice, at most 2.5 s). ground-check.mjs: a 21 x 21 ray grid (+-100 m) at
  the spawn and six pistes per resort (drawn vs physics: no crack / wall > 0.5 m), the moment after two far jumps, and the play camera
  over the snow while carving. (2) plough: the V was inverted (Ry(+) turns the +x tip to -z): tips 0.19 m, tails ~1.1 m; (3) hockey
  stop: skis parallel and across the travel, together, on the snow (IK lifts the whole figure when a knee is at its limit); (4) softer
  plough knees / forward torso. `scripts/ski/pose-check.mjs` (frozen poses, geometry + shots, all 5 resorts): all green.
  Sheet: `~/Library/Caches/ski-work/round7/sheet-a-fixes-webkit.jpg`.
- **Niddreg triangles (R7 A)**: the ski flow's 450k budget was exceeded by the new carrier models and the lattice streets; far chairs /
  cabins (> 320 m, `CARRIER_NEAR`) are cheap shapes in their own pools (+2 draw calls), streets merge in 640 m cells and are drawn within
  1.3 km on Niddreg: flow `ski` 397k triangles, 142 calls (the base branch measured 452k on the same probe).

## R7-D look (21 Nov 2026, helper branch `worktree-agent-a72d7342b7aa82cd0`): evening shade, strata, trees, park meshes, gate base
All resort-generic; checked on all five resorts in Chromium and WebKit. Shared files carry `// R7-D` marks; `main.js?v=9`.
- **Evening shade** (`snow-shader.js`): under a warm low sun (sun colour blue / red < 0.72, so morning / midday are untouched) the
  shade colour keeps its brightness but loses most of the doubled sky tint: (100,137,220) violet-blue -> (116,139,189) blue-grey on screen.
  env.js / sky / post.js untouched.
- **Rock strata**: faded by their own pixel footprint (`fwidth` of the layer phase): bands only while a layer spans >= ~6 px, the thin
  snow ledge lines only >= ~16 px (then their average share), so far faces no longer crawl.
- **Trees** (`scatter-view.js`, still one instanced draw call per kind, depth material / blob shadows as before; `TREE_GEOMETRY` exported,
  meshes named `ski-<kind>`): spruce = 6 tiers of real branches (each tip its own length and droop, a few long jagged ones, a shoulder
  then hanging tips, tucked gaps, dark underside), a visible trunk under the skirt, a leader: 233 triangles (was 154). Larch = tapering
  trunk to the top, 8 whorls of slim arching stems each with two hanging twig curtains, lit from both sides (airy, the snow shows through):
  317 (was 190). Far spruce: zig-zag skirts 18 (was 10); far larch unchanged. Placement / collisions (scatter.js) untouched.
- **Snow park** (`modes/park.js`, `modes/views.js parkSnowGeometry`, `surface.js`): kickers (run-up curve, sharp lip, table, rounded
  knuckle, landing, straight side walls `k.side` = 0.8 H), the rail ramps and the halfpipe (flat, parabolic walls, crisp lip, a 4.6 m deck
  each side, blue dye lines where the walls leave the flat, coping on the lip line) are ONE merged mesh in the terrain's own snow material
  (`ski-park-snow`, shadows, + `ski-park` dressing + `ski-park-boards` = 3 draw calls). Drawn == skied: `surface.height` returns
  `layout.solidAt` (the analytic shape) inside the feature boxes, so physics, camera and markers read exactly what the mesh draws; the
  terrain lattice only keeps the flat corridor + a trough under the pipe (0.5 m deeper than the pipe, 8 cm lower under the deck, back to
  the profile within the deck's outer 4 m), so the 2.5 m lattice never shows through. Patches meet without shared vertices (crisp lip /
  wall edges); the rim and the walls' feet run on under the snow along the wall's own plane. Kicker airs got a little longer (crisp
  lip: L 1.70 -> 1.85 s), every harness park check unchanged otherwise.
- **Gate base** (`modes/markers.js`): a per-vertex `aTint` (1 = banner + flag) and a two-line `onBeforeCompile`: only the banner takes the
  instance colour; posts, base and top edge keep theirs.
- **Checks**: `node scripts/ski/look7d-check.mjs` (Node, all parks: every mesh vertex / 11k sampled points incl. walls and rims vs physics
  <= 4.3 cm, a scripted rider over every kicker / ramp / the pipe: grounded skier vs mesh <= 3.3 cm (pipe), <= 2 cm on kickers, never inside it in the air; terrain never
  above a feature, pipe trough on LOD 5 / 10 nodes; tree triangle budgets) and flow `ski-look7d` (in run_all; `FLOW_BROWSER=webkit`
  works: per resort one page, trees one call per kind, rays onto the park meshes == physics <= 2.8 cm, gate base pixels neutral vs banner
  in colour, all shader programs runnable, no console error; Niddreg once). Shots: `scripts/ski/look7d-shots.sh OUT [chromium|webkit]`
  (+ `look7d-shots.mjs`), sheets in `~/Library/Caches/ski-work/round7d/look/`.
- **Open**: the halfpipe walls stay parabolic (37 deg at the lip; the physics' lip pop stands in for a vertical) - a real vert needs new pipe
  physics; at midday the lit pipe wall is white on white (the dye lines carry its shape); the larch curtains are stylised triangles.

## R7-D (22 Nov 2026, branch `worktree-agent-a9b2af7426e434baa`): online free ride, name tags, perf / data (+ the look helper above)
Shared files carry `R7-D` marks. R7-A built its own versions of some of this before the split (see "Round 7 A": sign atlases, tags,
net/freeride.js, mp-games `mode`): the integration takes ONE per feature; the differences are listed under "vs R7-A".
- **Online free ride** (`net/freeride.js`, lobby `mode` = race | free in `mp-games.js?v=7`; piste + runs carry `showIf: {mode: race}`,
  mp-lobby.js `settingShown`, `mp-lobby.js?v=20`): main.js picks it through `createMp` (`kind` 'race' | 'free'; every old `if (mp)` race
  hook is now `isRace()`). Everybody starts side by side (`sideOffset`, 2.2 m) at the SAME start lift (spawn from the resort's start
  piste, never a saved piste). States at 15 / s while moving or riding (`FREE.SEND_HZ`; 4 / s standing / in the map), interpolated as in
  the race. Lifts: the wire's "riding lift X at s" (lift index + metres), each device draws the friend in his own carrier on its own
  line (`liftPath` now builds the lift view early, once, when a friend rides before I did). Teleports (fast travel, map jump, lift
  skip, «Bei e Frënd») bump an epoch in the state message and remotes.js snaps any jump > 120 m: nobody slides across the mountain.
  The host (first roster player here; handover when he leaves) shares weather / time / the day clock every 4 s and to newcomers.
  Join / leave any time: a reload / rejoin goes on at the player's own last spot (sessionStorage, every 2 s); session.js forgets a
  reloaded peer's clock samples (his performance.now restarted). Avalanches: `mp.shareAvalanche(id, seed, tMs)` broadcasts, the others
  call `window.__ski.avalanches.triggerAvalanche(id, seed, t s)` (R7-C's API: main.js subscribes `onTrigger` when it exists; at most one
  per player per 15 s, dropped when > 8 s late). INTEGRATION: R7-C's main.js disables avalanches with `!mp`: make that `!isRace()`.
  «👥 Bei e Frënd» (under the friends list) = fast travel next to the next friend (on a lift: its top). Relay pairs get their own
  budget for long sessions (`NET.FREE_RELAY` 14000 msgs, 2 msgs / s x 2 states). Fair: a state only moves the player whose link it came
  over; the env only from the current host; avalanches are world events.
- **Name tags** (`net/tags.js`, pure): nearest 3 always in full (stacked up as far as needed), the others stacked up to 3 steps, else a
  colour dot, else folded into a "+N" badge on the tag they hit; fade + shrink with distance; free ride: friends anywhere keep a tag with
  the distance ("Emma · 1.2 km"). Every tag keeps room for the badge (the 3 Vallées flow run caught a "+2" badge overlapping).
- **Sign atlas on demand** (`props.js createSigns`): ONE 2048 x 768 atlas of 128 slots filled with the boards within 1100 m of the camera
  (the busiest spot of all five resorts sees 39), a board keeps its slot while in range; one merged board mesh rebuilt after 120 m of
  camera travel: 1 draw call + 1 for the posts at any resort size (`assignSlots` pure, `__ski.signs.stats`).
- **First play**: resort.json piste / network lines packed (`scripts/ski/linepack.py` + `pb/ski/linepack.js`: decimetres, second
  differences, zigzag varints, base64; lossless; bake.py packs, the loader and every Node script that reads lines call `unpackResort`;
  old unpacked data still loads). 3 Vallées resort.json 1.20 -> 0.44 MB (gzip 440 -> 174 KB). The minimap's painted base loads 4 s after
  the free ride starts. INTEGRATION: any new Node script that reads resort.json lines must call `unpackResort` (R7-A / B / C scripts).
- **Perf, all five resorts** (Mini, Chromium; first play = flow `ski-ipad-start` per resort, skiing in the free ride, cold cache, 20 Mbit,
  CPU x4; draw calls = `scripts/ski/calls-sweep7d.mjs --gpu`: Niddreg, every piste start + every lift top, all tiles / village / lifts /
  signs / landmarks in, max over 3 frames; the worst spot's calls by object in its log):

  | Resort | first play MB (before) | skiing after | spots | worst draw calls (spot) | p95 | median |
  |---|---|---|---|---|---|---|
  | Killy | 2.39 (2.82) | 4.8 s | 305 | 154 (Colchique) | 147 | 133 |
  | 3 Vallées | 3.70 (4.65) | 6.7 s | 617 | 158 (La Voie de la boucle) | 148 | 132 |
  | Zermatt | 2.92 (3.29) | 5.5 s | 264 | 153 (Schweigmatten) | 146 | 134 |
  | Arlberg | 3.44 (4.15) | 6.1 s | 444 | 157 (Pfannenbach) | 148 | 131 |
  | Kronplatz | 2.44 (3.03) | 5.4 s | 97 | 158 (Rara Variante) | 148 | 131 |

  A worst spot spends ~100 calls on terrain tiles, ~16 on the local skier (one call per bone group), 5-10 village, 7 lifts (instanced),
  3-16 landmarks (Arlberg / Kronplatz). The margin to 160 is thin: each online friend in view adds 1 (his skinned figure). Next wins if
  needed: the local skier as ONE skinned mesh like the remotes (remotes.js `createRemoteFigure`; skier-model.js is R7-A's IK area),
  landmarks merged per material across landmarks. Face de Bellevarde (~245 in round 5) is no longer in Killy's top 8 (<= 151).
  Logs: `~/Library/Caches/ski-work/round7d/perf/`.
- **Tests**: `node scripts/ski/r7d-test.mjs` (Node: 400 random tag crowds never overlap / nearest 3 full / every tag counted; sign slots;
  every resort's busiest sign radius fits the atlas; free-ride plan / host handover / side offsets; the wire's lift state; packed lines
  round trip + every resort decodes): 1424 ok. Flow `ski-mp-freeride` (in run_all; `SKI_MPF_RESORTS=all`, `FLOW_BROWSER=webkit`): lobby
  mode -> 3 players (one relay-only) side by side at the same lift on each resort -> sync (lag ~150 ms, 15 states / s) -> two ride the same
  lift (each in his own carrier, within 5 m of the truth) -> a skip snaps -> fast travel appears -> «Bei e Frënd» -> tags (+6 bunched)
  never overlap -> avalanche event -> host leaves (handover, weather follows) -> rejoin at his spot -> 0 console errors.
  Results (22 Nov, after the Mini reboot): Chromium 130 / 130, WebKit 130 / 130 checks over the five resorts; remote lag 137-168 ms,
  13.5-15 states / s, a friend on the same lift shown 3-5 m from where he really is.
  Shots: `~/Library/Caches/ski-work/round7d/mpf/sheet-freeride-{chromium,webkit}.jpg` (start / lift / tags per resort).
- **Suites (22 Nov, after the reboot)**: Chromium `run_all.mjs ski mp-lobby home-page arcade-pad` 22 / 22; WebKit ski-mp, ski-resorts,
  ski-freeride, ski-mp-freeride (all 5) green (ski-mp / ski-mp-freeride drop only the old page's loads that WebKit logs as cancelled when
  the flow reloads right at the start); Node: r7d-test 1424, look7d-check 68, round6-test 1927, mp-race-test, harness (--rides 12) x5.
- **vs R7-A** (for the integration): sign atlas: A = fixed 336-board atlases (2048 x 2016, one draw call + ~16 MB per atlas; 3 Vallées
  two); D = one 2048 x 768 on-demand atlas (6 MB, one call at any size). Tags: same idea; D folds the rest into dots / "+N" (A hides them)
  and keeps far friends' tags with the distance in the free ride. Free ride: A has `liftBottom` jump + avalanche by (x, z, seed); D adds
  the teleport epoch / jump snap, host handover of weather / time / day clock, rejoin at the own spot, the peer clock reset, the long-session
  relay budget, avalanches through R7-C's `onTrigger` / `triggerAvalanche`, and the 5-resort x 2-engine flow. mp-games: both add `mode`
  (A without hiding piste / runs).
- **Still wrong / open**: the free-ride start spots of 3 Vallées (Ariondaz), Arlberg (Galzig) and Kronplatz look at a station / house wall, and Zermatt's
  (Gornergrat Bahn) shows grey platform wedges, in both engines (R7-A / C fix
  the spawn; `host.startSpot` uses main.js `boardSpot`, so their fix applies); a remote friend's carrier on a lift uses MY device's lift
  view (built early, before every tile is in: heights there may still be the far grid's); the relay pair sees friends ~0.6 s late.

## R7-C (21 Nov 2026): map teleport, first-lift spawn, first person, snow spray, avalanches, the challenge course
Parallel agent C of round 7 (A: render / look.js, B: lifts / stations, D: online free ride). New modules; shared files only got small
hooks marked "R7-C" (main.js, map.js, game.js, markers.js, input.js, progress.js, cloud.js, freeride.js, liftride.js, config.js, ui.css).
- **Obstacles** (`modes/clear.js`, pure): buildings.json boxes (once loaded), lift station halls (both ends, LIFT_SPEC sizes), lift lines,
  trees (scatter.hit), class raster (rock / water / built). `blocked(x, z, r)`, `wallAhead(x, z, heading, height, 25)` (house, hall,
  tree, or ground rising > 30° above the eyes), `liftSpot(lift)` (the boarding spot: polar search round the bottom station within 38 m,
  facing the boarding area / up the line, turned up to 75° only if needed for an open view, the chase camera not in a wall),
  `safeSpot(tap)` (nearest piste point / lift spot inside the discovered cells, clear, <= 32°), `courseGate(piste)` (see course).
- **First lift** (config `FIRST_LIFT`, by name): Killy Olympique, 3 Vallées Verdons (Courchevel 1850), Zermatt Matterhorn Express 1,
  Arlberg Galzigbahn, Kronplatz Kronplatz I (Reischach). `explore.first`; main.js `spawn` uses it; `goFree` now waits for the tiles AND
  the buildings, THEN picks the spot (`boardSpot` = `liftSpot`), so the skier stands on the final ground. A tile arriving under a
  standing skier re-snaps his height. Boarding zone widened 30 -> 42 m (freeride.js BOTTOM_RADIUS, liftride.js RIDE.boardRadius):
  where a big station building fills the front (Val d'Isère), the spot stands further out. **B (stations) should keep this radius or
  give liftSpot the real boarding area.**
- **Discovery + map teleport** (`modes/discovery.js` pure, `modes/explore.js` glue): 100 m cells; seen = within 140 m of the skier
  (HUD rate), 220 m round a station reached (45 m), the whole line of a lift ridden; the first lift's 320 m always. Saved as run-length
  text: local `progress.disc[rid]`, cloud record `d: { rid: text }` (+ `w: { rid: Lawin mask }`), merge = union of runs (no grid size
  needed), dropped resort by resort (largest first) only after the best times when the record would pass 7 KB. Map (free ride tab):
  fog over the undiscovered cells (map.js `setFog`, a grid-sized canvas drawn smoothed), a tap -> "Nach net entdeckt" or a pin + "Hei hin
  teleportéieren?" (Jo / Nee) -> `goFree(null, safeSpot)`; a tap within 12 px of a lift's bottom dot still picks the lift (round 6).
  "⌂ Bei den éischte Lift" always (top left of the map). The lift list: undiscovered lifts are faded, "Bei de Lift" disabled with
  "Nach net entdeckt". Debug: `__ski.explore.discoverAll()`.
- **First person** (`firstperson.js`, a camera MODE; main.js switches: `camMode` 'fp' | 'chase', saved `pb_ski_cam`, C key / 👁 HUD
  button `#hCam`): eyes 1.62 m (tuck 1.15), 0.42 m behind the boots, ~20° down so the tips show at the bottom; skis follow the slope and
  the edge (FIRST_PERSON.skiRoll), poles + gloves in camera space; head bob, landing dip, lean = edge x 0.13, FOV 74 + 16 (5 -> 24 m/s),
  the CSS motion streak `#fpStreak` on Mëttel / Héich only (no draw call). The body model is hidden (not on a lift). On a lift the first
  person is the window view. `cam.roll` -> `camera.rotateZ` after lookAt (the only change to the camera path; A's look.js can keep it).
- **Snow spray** (`spray.js`, replaces effects.js createSpray): carve arc (a fan off the outside ski, rate and power from speed x edge),
  skid / plough sheet, powder cloud off the piste (big slow puffs), backlit dust (grains towards the sun glow warm), ski tracks in fresh
  snow (ring buffer of ground quads, 60 s fade). Budget `SPRAY_BUDGET`: Niddreg 160 grains + 90 track pieces, Mëttel 320 + 260, Héich
  520 + 420; 2 draw calls; rebuilt on a Grafik change. Grains closer than ~2 m to the camera fade (first person).
- **Avalanches** (`avalanche.js`): release only in the free ride, grounded skier > 2 m/s entering a new 40 m cell that is `releasable`
  (no piste within 45 m, slope >= 35° over 6 m, no forest / rock / houses), roll = rng(sessionSeed ^ hash(cell)) < 0.06. Slab = blocks
  on a crown 18-32 m above the cell, width 50-110 m; flow on the 40 m FAR grid (the same on every device), fixed 1/30 s steps, friction
  tan 22° growing after 380 m of travel, drag; caught = a moving block within 7 m -> crash 'avalanche', white-out, respawn on the nearest
  piste (60 m up it); escaped (it stopped without catching him and came within 300 m) -> "Entkomm!". Drawn: tumbling blocks (instanced
  icosahedra) + soft cloud billboards (2 draw calls), yellow-black checkered warning flags (piste edges beside steep open faces + the
  face tops, 2 calls), HUD "⚠ Lawinegefor" on steep off-piste. **Lawin challenge**: 3 faces per resort (`findFaces`: steepest long open
  faces in the shipped tiles, a gentler second pass for wooded Kronplatz), prompt at the top -> Start -> the slab releases behind ->
  won when it stops without catching him (progress.lawin bit, cloud `w`).
  **Sync API for D (online free ride)**: `__ski.avalanches.triggerAvalanche(id, seed, t)` (id = `a<ix>_<iz>`, the 40 m cell; seed uint32;
  t = start time in `avalanches.clock()` seconds), `avalanches.onTrigger(({ id, seed, t }) => broadcast)` for local releases,
  `avalanches.setClock(fn)` to put every device on the shared match clock. Same (id, seed) -> the same blocks and the same flow
  (checked in Node and in the page).
- **Challenge course** (`modes/course.js`, Ian's "Bouc Blanc" report): the start gate moves down the piste (<= 90 m) until the posts
  and the skier are clear (7 m) of houses, stations, lift lines, trees, rock (`courseGate`; markers.js `regate` once the houses are
  loaded); the run starts there (`createRun({ startS })`). At 0 a push of 4.8 m/s (17 km/h) along the course. While a timed run is on:
  orange net panels along BOTH edges (every 6 m, following the slope), chevron boards at junctions (other pistes meeting at > 30°) and
  every 250 m, pointing where the course goes; a red "ZIL" arch with a checkered line at the line's real end (finish = length - 12 m,
  the bake trims pistes to their lowest point); HUD: distance bar "… m bis ZIL" + an arrow to the next waypoint. Leaving the course
  (> halfwidth + 12 m): "Zréck op d'Pist" + an arrow back, NEVER a teleport (game.js 'offpiste' no longer respawns a timed run); after
  8 s off: "Challenge ofgebrach" (Nach eng Kéier / Weider fräi fueren). A crash respawns where he was on the line (no longer "furthest
  point - 18 m", which could be the start when the projection was lost); game.js re-projects on the whole line when it lost it.
- **Tests**: `node scripts/ski/round7c-check.mjs [rid] [--rides]` (all five: spawn, 200 teleport taps, discovery save, Lawin faces +
  flow + determinism, never on a piste, every gate, barriers, with --rides every course ridden by the scripted skier with game.js +
  course.js). Flows: `ski-teleport`, `ski-spawn` (5 resorts), `ski-firstperson` (5 resorts: piste carve + off-piste powder),
  `ski-avalanche` (5 resorts: caught / escape / determinism, natural release, Lawin), `ski-course` (5 resorts, Bouc Blanc first).
  `SKI_RESORTS=killy` / `SKI_COURSES=rid:piste` narrow them. Shots: `~/Library/Caches/ski-work/round7c/` (`scripts/ski/round7c-shots.sh`:
  GPU Chromium DPR 2 + WebKit, sheets `sheet-<resort>-{gpu,webkit}.jpg`, `sheet-spawn-*.jpg`).
- **Results (21 Nov, end of R7-C)**: Node check all five green: spawn Killy Olympique 20 m, 3V Verdons 20 m, Zermatt ME1 24 m, Arlberg
  Galzigbahn 24 m, Kronplatz I 20 m (all 0.00 m above the ground, nothing within 25 m ahead); teleport 195-200 / 200 taps with a safe
  spot, 0 unsafe; 3 Lawin faces each; gates on open snow 234/235, 480/480, 206/209, 354/356, 70/71; course rides 235/235, 480/480,
  207/209, 352/356, 71/71, 0 silent resets. Flows Chromium: all 14 ski-* green; WebKit: ski-teleport, ski-spawn, ski-firstperson,
  ski-avalanche, ski-course, ski-freeride, ski-park green. Niddreg park view 147 draw calls (as before).
- **Gotchas**: `__ski.teleport(s)` is the OLD piste teleport (flows / pose-shots use it); the map teleport is `__ski.teleportTo(spot)`.
  WebKit reports tile fetches cut off by a page load as page errors: multi-resort WebKit flows wait for `skiTilesDone` before the next goto.
- **Still wrong / open (R7-C)**: blocked start gates left: Killy verbindung-bleuets (building), Zermatt libera / du-col /
  verbindung-matterhorn-expres-3, Arlberg 2, Kronplatz verbindung-gondel-kronplatz (lift line) — they keep s = 2; courses the scripted
  skier did not finish (flat ends / bot stuck): Zermatt rotenboden, cieloalto-cervinia, Arlberg skiroute-madloch-zug (32 m short),
  woster-bockbachtal, riffel, waldabfahrt; the powder cloud is weak at low speed (WebKit shot at 5 km/h shows none); first-person
  gloves are plain boxes; the finish line is flat at the arch's ground height (sinks on a cross slope); barriers are visual only (no
  physics), they can cross houses where a piste runs through a village; the spawn sheets were shot before the last spawn tweak (room
  to the sides, 20-24 m out now); Lawin faces on Kronplatz are gentle (29-33°); the avalanche runs on the 40 m far grid, so the blocks
  float / sink a little over 5 m detail (drawn at the 5 m height); no sound for the avalanche yet.

## Round 7 C2 (22 Nov 2026): R7-C leftovers (challenge course, avalanches)
Fresh agent on C's branch (worktree-agent-a7bc9c6f4f82d4fc6 @ 83c59ce9, fast-forwarded). Every fix has a check over all five resorts in
`node scripts/ski/round7c-check.mjs [rid] [--rides]` (Node, no browser) and in-page checks in `scripts/ski/round7c2-shots.mjs` (shots).
- **Start gates** (`clear.js courseGate`): the gate may also stand BESIDE the line (lateral offset up to the piste edge, middle first)
  where a station hall or a lift line takes the middle, and searches further down (`COURSE.gateSearch` 160 m, short pistes keep >= 45 m
  of course); the resort-box edge margin is 8 m for gates (Zermatt libera lies within 50 m of the box). `courseGate` returns
  `{ s, lat, ok, why }`; main.js `gateAt(p)` (cached) feeds `startRun` (skier placed `lat` m right of the line), the START arch and
  `markers.regate` / `markerList` (accept `s` or `{ s, lat }`). Result: gates on open snow killy 235/235, 3vallees 480/480, zermatt 209/209, arlberg 356/356, kronplatz 71/71 (1351/1351; 122 moved down, 260 beside the line).
- **Unfinishable courses** were NOT flat ends: their OSM-chained lines loop back within a few metres of themselves (Zermatt rotenboden
  s 70 / 195, cieloalto-cervinia, Arlberg madloch-zug, riffel, waldabfahrt; 14 such lines in all), and the windowed projection snapped
  the skier ~110 m back along the line -> the bot rode the loop forever. `pistes.js project(…, hint)` now pays 0.08 m per m of jump
  beyond 25 m from the hint (no hint = unchanged nearest point). Woster-bockbachtal (8.2 km ski route) only needed more time in the check
  (300 s + length / 3). Result: all 1351 courses finished by the scripted skier (235 / 480 / 209 / 356 / 71), 0 silent resets.
- **Finish** (`course.js courseSeats` + view): ONE ZIL arch (round 1's props.js arch at the line's very end is no longer drawn in a timed
  run, `createRunProps({ start, finish })`; its START arch stands at the gate now). Two pillars stand on their own snow, the beam is
  level on top (`COURSE.archHeight` 6 m over the higher pillar's snow: upright on a cross slope), the checkered finish line is a strip
  whose vertices lie on the snow every ~1.5 m across the piste (no flat plane sinking into a cross slope).
- **Barriers**: the 6 m rigid panels (floated over dips, sank into bumps by up to 1 m at the 10 m line's kinks) are now one net RIBBON
  mesh per course (both sides, 0.5 m vertices on the snow, corner fill on the outside of kinks, an orange net texture with a white top
  edge) on thin posts every 3 m (instanced, the old `ski-course-barriers` name). Left open: the inside of bends tighter than the offset,
  houses and station halls (`courseLayout(piste, s, pistes, obs)`). Soft collision: `createCourse().collide(prev, state)` (main.js after
  every physics step of a timed run): crossing a net from the inside -> put back 5 cm inside it, the velocity turned along the net (down
  the course when hit square on), speed x (0.93 - 0.2 x share into the net), a small bounce back in, skis turned along it; a jump with
  air > 0.25 s clears it; put down elsewhere since the last step (place / teleport / respawn: `prev` differs from the last
  state collide() returned) or already outside = no wall, he may ski back in; no wall where the net is left open at a tight bend.
  The contact pushes back by the overshoot only (no snapping to the line point: at a 10 m line corner that pinned Arlberg
  valluga-pazieltal 14 000 times). Config `COURSE.barrierBody/Slow/Bounce`. bot.js re-finds the line after a teleport (> 60 m off).
- **HUD distance**: the round-7C "4.8 km at the start AND at the arch" was the shot script: it only moved the CAMERA to the arch, the
  skier stayed at the start. Still made robust: the course tracker re-projects on the whole line when it is > halfwidth + 40 m off, the
  shown distance only falls (`rebase()` after a respawn), `distanceText()` is shared by the HUD and the check. Checked on every
  scripted ride (Node) and in the `ski-course` flow (sampled along the ride, < 30 m at the arch).
- **The red cube** near the ZIL arch (Zermatt course-finish shot): NOT a course object. Probe (scene traverse round the camera): it is a
  `ski-lifts` instance, colour c8372e, 2.7 x 2.2 x 2.7 m, 10 m above the camera = a red GONDOLA CABIN of the lift crossing the finish,
  drawn as a plain box (R7-B's carriers / cabins-on-the-cable work replaces those). Check added anyway: every course object on the snow
  (<= 0.3 m gap; net ribbon edge vs snow <= 0.25 m over / 0.28 m into the snow between two vertices), nothing > 6 m above it, nothing bigger than meant (Node: `courseSeats`; page:
  bounding boxes of every `ski-course-*` mesh / instance against `surface.height`).
- **Avalanche camera** (the round-7C shot stood 40 m over the snow against a rock face): `avalanche.js faceView(face, height)` picks a
  spot in front of the face and to the side (24 directions x 200-560 m x 25-100 m up) with a clear line to the crown, the middle and the
  runout (`lineClear`), the snow within 25 m of the lens >= 0.6 m below it, and preferably an open foreground (a margin widening away
  from the lens: no slope filling the picture); `__ski.avalancheView(i)`; `__ski.setCamera` now uses the drawn snow (`surface`) and
  never goes below 0.6 m. Checked for every face (Node: 15/15 clear, all open foreground), in the `ski-avalanche` flow and in the shots
  (the chase camera after a teleport: 2.3-2.5 m up, clear line to the skier). R7-A's look.js was not merged.
- **Lawin faces**: all three faces of every resort start >= 35° now (`findFaces` passes: long open faces >= 35°, then shorter open faces
  between the trees >= 35° (Kronplatz), only then a `gentle` fallback no resort uses; no face below the lowest piste end; the challenge's
  own slab (seed 7001 + i) must run >= 80 m and stop). Faces now: Killy 38° / 37° / 37°, 3 Vallées 39° / 37° / 40°, Zermatt 42° / 36° / 48°, Arlberg 48° / 44° / 37°, Kronplatz 36° / 35° / 37° (was 33 / 32 / 29°; Kronplatz's are shorter: 660 / 390 / 195 m). Saved Lawin bits (`progress.lawin`, cloud `w`) refer to face indices:
  Killy's and Kronplatz's faces changed (pre-launch, fine).
- **Powder**: the skier's powder cloud now starts at 0.8 m/s with ~28 puffs / s at walking speed (was ~8 from 1.5 m/s), bigger puffs; the
  avalanche cloud keeps >= 35 % density while a block moves (it vanished on slow blocks).
- **Avalanche sound** (`audio.js`, all procedural, through the master gain = off with the game's / arcade's mute): a deep rumble (pink
  noise at quarter speed, two lowpasses + a 36 Hz sub wobbling) driven by `avalanches.loudness(camera)` (share of the slab still moving x
  distance), and a release crack + whump (`audio.event('avalanche', { near })`). `audio.rumble` reads the level (flows).
- **WebKit tint**: on THIS branch WebKit (Playwright) and Chromium GPU render the same picture: per-channel means / std of every pair
  of shots agree within 1/255 (round7c and round7c2). So the "blue, low contrast" look is NOT WebKit-only here: both engines show the
  same strongly blue snow in shade / morning light. R7-A's post / shader fix is not on this branch; integration should compare
  against R7-A's sheet (round7/sheet-a-fixes-webkit.jpg) and re-shoot with `scripts/ski/round7c2-shots.sh` after the merge.
- **Checks** (22 Nov): `node scripts/ski/round7c-check.mjs --rides`: 100 passed, 0 failed (all five: gates 1351/1351, rides 1351/1351, HUD
  < 30 m at every ZIL, 0 silent resets, barriers held 533/533 aimed hits (0 through, 0 stopped), 57/57 put down outside stay outside,
  every course object on the snow and <= 6 m, no net through a house, Lawin faces >= 35° with clear camera spots 15/15). In-page
  (`round7c2-shots.mjs`, Chromium GPU + WebKit, all five): 0 bad course objects (worst float 0.06 m), HUD start -> middle -> arch e.g.
  Zermatt "4.8 km" -> "2.4 km" -> "26 m", avalanche camera 25-100 m up with a clear line, rumble 0.5-0.7 while the slab flows, chase
  camera after a teleport 2.3-2.5 m up with a clear line. Flows: `ski-avalanche` green in Chromium AND WebKit; `ski-course` green in Chromium AND WebKit (5 resorts, the HUD sampled along each scripted ride: e.g. Kronplatz sylvester "4.1 km" -> "4 m" at the arch, never rising). A first WebKit run under load 74 timed out in the countdown; re-run at load < 30 green.
- **Shots**: `~/Library/Caches/ski-work/round7c2/` (`gpu/`, `webkit/`, `sheet-<resort>.jpg` = course start / mid / finish / avalanche,
  Chromium GPU DPR 2 left + WebKit right). Script: `scripts/ski/round7c2-shots.mjs` (prints `R7C2 {json}` with the in-page checks).
- **Still open**: the red gondola cabin over the Zermatt finish is still a plain box (R7-B's carriers); on a strong cross slope the LOWER
  ZIL pillar stands up to ~10 m (Kronplatz gassl-variante: 3.8 m across the piste; the beam is level and <= 6 m over the higher side);
  where the net is left open at a house the soft wall is still there (open only at tight bends), the house itself stops him anyway;
  a square-on barrier hit keeps >= 59 % of the speed (worst case of the check, 35° hits keep ~80 %); Kronplatz's steep open faces are
  short between the trees (195-660 m); the avalanche still flows on the 40 m far grid; the shots' avalanche frames show the free-ride
  "Astegen" button (the skier waits at the first lift, far from the slab); snow reads blue in shade in BOTH engines (see WebKit above);
  first-person gloves are still plain boxes (not in this round).

## Round 8 integration (22 Nov 2026, branch `worktree-agent-ad3dbdaf238c036e7`): R7-B base + R7-A + R7-D look + R7-D, review + early-QA fixes
**Base = R7-B** (369e7404: lifts, stations, boarding zones, rebaked data). Merged: R7-A (616a109e), R7-D look (77dd1650), R7-D (0afb689f).
**One implementation per feature** (what was dropped stays on its branch):
- R7-A kept: WebKit shader-error hook + `pictureCheck` safety steps (post.fallback), ground == physics streets (roads.js), leg IK /
  plough / hockey poses, braking to 0 + hold (skier.js), camera rises with speed (camera.js), `look.js` free look + camera guard (wired
  into R7-B's `window.__skiLook.apply` seam for the lift camera; the station colliders are R7-B's `world.hit` parts), late-tile re-snap,
  `meshedAround` behind every fade, horizon / edge fade + whiter far rock (snow-shader FOG_GLSL `uFarEnd`), buildings/balconies (village.js),
  houses + streets download after the first frames, debug orbit over the snow, tools (ground-check, pose-check, ski-webkit flow,
  webkit-probe, calls-sweep, round7a-shots, far-quant). The building box index moved from A's modes/spawn.js into look.js.
- R7-A dropped: modes/spawn.js (first-lift spawn, liftSpot, exitSpot, 12 m zone: B's zones/exits + C's FIRST_LIFT), tunnel.js and its
  lift-path tunnels (B's portals/tube), carrier models + LOD in lifts.js (B's carriers.js), fpcam.js, effects.js spray/tracks,
  modes/avalanche.js + Lawin (all C), net/freeride.js + lobby Modus + tags.js + props.js sign atlas (D's), park bodies + parkUniforms,
  scatter-view firs, env evening ambient, strata AA, markers aTint (D-look's), FAR_QUANT 1 m (back to 0.25 m: the 1 m steps striped
  the far lighting in the Kronplatz QA; D's packed lines keep first play <= 4 MB). round7-test.mjs trimmed to A's own checks (far step,
  braking, hockey duration).
- R7-D: resort.json = B's content packed with `scripts/ski/linepack.py` (lossless, == what bake.py now writes); every Node script reads
  it through `unpackResort` (round7b-test added).
**Coordinator review fixes**: shaded snow = light blue-grey at every time of day (snow-shader `shadeL2`, b/r ~1.4 instead of ~2);
stations with detail (lift-site.js `det()` parts, never colliders, pruned like caps): drive housing with a red band over the bull-wheel
(chair canopy, gondola roof), the gondola roof overhangs the platform + front with a dark fascia, a red line and the LIFT NAME (lifts.js
name-sign layer: the 24 nearest within 450 m in one canvas atlas = 1 draw call), clad back wall (stone plinth, timber, battens, window
band), mullions on the glazed side, lights under the roof, entry gates open at the boarding zone; cable-car terminal name sign; drag
pylons: slim tube, boom, red cap, a sheave train per rope (one up + one return rope per lift; "4 ropes" in the old shot were twin lifts
Termignon 1 + 2); clouds from their own gradient-noise texture (env.js `createCloudTexture`, 16 bit in r+g, blurred, softer edges, the
fine tufts fade to the horizon).
**Early QA fixes (Zermatt/Arlberg + Killy/Kronplatz, R7-A build)**: summit exits: lift-site.js exitOf prefers <= 25 deg, then <= 31,
and turns off a fall line that drops > 35-39 deg within 40 m (traverse up to 75 deg off it) — round7b-test checks every exit: slope,
drop ahead, 5 s standing still without input, push off + 6 s without crash; buildings whose roof reaches into a carrier's path are left
out (Kronplatz/Killy "cabins through hotels"), round7b-test checks every carrier vs every kept building; streets drawn a hair (6 mm) over
the ground and painted from the per-pixel distance to the cell's nearest segment (+ neighbour) — no zigzag bands, skis no longer under
the street; houses collide (kept ones, main.js `buildingHit`); camera never under the snow, rises when the guard pulls it in, wider
house margin; hockey stop locked across the travel direction at its start (no 140 deg spin), max 8 m/s2 (33 km/h -> 0 in ~1.7 s,
round7-test), less squat; T-bar rider's hand at chest height; speedo on a lift = the lift's real speed; duplicate lift names numbered
(`baseName` keeps the data name); empty HUD chip hidden; countdown under the top bar; T sets the day clock; env time/weather ids
validated; the Funival tube starts at the portals and never pokes out of the hill; the Inuits pylon under the Altiport chairs dropped
(lift_sites.py `drop_drag_pylons_under`, in bake.py).
**Checks** (all green unless noted below): see the report numbers in the coordinator's log; `node scripts/ski/round7b-test.mjs` (5981),
`round7-test.mjs` (30), `round6-test.mjs` (2307), `look7d-check.mjs` (68), `r7d-test.mjs` (1424), harness --all x 5; browser runs below.
WebKit contact sheet: `node scripts/ski/round8-sheet.mjs [--engine webkit]` -> ~/Library/Caches/ski-work/round8/ (spawn, street, station,
ride, carve, stop, drag per resort). Frame probe: `scripts/ski/frame-probe.mjs` (where long frames go, per wrapped upkeep call).
**For C2**: take C's FIRST_LIFT/discovery/map/teleport/course/first person (firstperson.js)/spray.js/avalanche.js; drop C's 42 m boarding
radius (freeride.js BOTTOM_RADIUS) — the spawn must land on B's zone `boardAt(firstLift)`; C's `!mp` avalanche guards -> `!isRace()`;
C's Node scripts must `unpackResort`; re-run round7c-check. D's free ride already calls `window.__ski.avalanches.triggerAvalanche` when
it exists.
**Round 8 STATUS at hand-over (22 Nov ~04:10, context limit)** — head = this branch's last commit.
- Merged + verified: B (base), A, D-look, D. NOT merged: **R7-C2** (worktree-agent-acb90fde7a15074ac @ 61fe6f92) — next agent: merge it
  per "For C2" above (+ `unpackResort` in round7c-check.mjs, C's avalanche `!mp` -> `!isRace()`, wire D's free-ride avalanche event to
  C's `triggerAvalanche`, C's spawn = B's zone wait spot of FIRST_LIFT), then re-run round7c-check --rides and round7c2-shots.sh.
- Node (all green): round7b-test 5981/5981 (every lift: stations, zones, rides, exits incl. the new slope / drop / stand-5 s / push-off
  checks, carriers vs pylons / stations / trees / kept buildings), round7-test 30/30, round6-test 2307/2307, look7d-check 68/68,
  r7d-test 1424/1424, harness --all: killy 23, 3vallees 23, zermatt 23, arlberg 19, kronplatz 19, 0 failed.
- Chromium flows (load ~30): 14/15 — home-page, ski (Niddreg p95 16.7 ms, 140 calls, 386k tris), ski-ipad-start, ski-resorts, ski-mp,
  ski-challenges, ski-park, ski-freeride, ski-lift, ski-skis, ski-lifts-all, ski-webkit, ski-look7d, arcade-pad PASS; ski-mp-freeride
  FAILED on the lift step (it read the state during B's boarding walk) -> flow fixed to wait for `ride.phase === 'ride'`, NOT re-run.
- WebKit flows: run started at load 74 (other agents): `ski` FAILED (Niddreg p95 57 ms, max 836 ms hitch; then a Zermatt boot
  selector timeout under that load). Mitigations committed after it ran (name-sign atlas 12 slots / no mips / 1.2 s, camera guard's
  station test gated by a 50 m grid); B measured 28 ms before the merge. Re-run the WebKit `ski` flow at normal load and use
  `scripts/ski/frame-probe.mjs --engine webkit` to find the long frames if it still fails. Log: ~/Library/Caches/ski-work/round8/flows-webkit.log.
- Not yet run on the merged head: ground-check.mjs and pose-check.mjs (both engines), ski-mp-freeride re-run, D's calls-sweep7d
  (the lift-name signs add 1 draw call; fold them into D's sign atlas if the 160 budget is hit).
- WebKit contact sheets: ~/Library/Caches/ski-work/round8/sheet-<resort>-webkit.jpg (+ webkit-<resort>-<shot>.png). Seen: shade light
  blue-grey, stations detailed with readable names, Kronplatz station no longer in a hotel, streets clean, gondola speedo 22 km/h. The
  "stop" shots there still show the old crossed-V end pose (fixed afterwards: the hockey stance holds while he stands on the brake).
- Early-QA items still OPEN: Zürs flat-roof concrete blocks -> chalet style; villages 494-645k triangles / Kandahar p95; rock "circuit
  board" lines on Face de Bellevarde (check after D-look's strata fade); cable-car window lower panel; Gornergrat carriage interior;
  map list highlight != card and "30002959 m" (map.js, C's area); piste named "0"; Korer park scores 0 + "jump with E" hint; Grattalu park
  start too flat; floating piste labels at the screen edge (D's labels); HUD text contrast in fog; first-person floating poles (C);
  boarding-zone views inside canopies (camera under the hall roof at the spawn); perf hitches on fast travel (meshedAround behind the
  fade is by design, the 170-215 ms WebKit placement hitch is not yet profiled).

## Security (pre-launch) (22 Nov 2026, branch `worktree-agent-acf4147b279b85622`, review: ~/Library/Caches/ski-work/security/REVIEW.md)
Test: `node scripts/ski/security-test.mjs` (Node, ~3 s, runs itself in a child with a hard timeout so a frozen loop is a FAIL): feeds the
exploit payloads into the REAL modules — wire.js, remotes.js with the real three.js (the CDN file, checked against the page's SRI hash,
cached in ~/Library/Caches/ski-work/), session.js + link.js on a fake Realtime / fake WebRTC, freeride.js, race.js, cloud.js, index.js
readMpContext. On the old code it hangs at the 1e300 heading (verified), on this branch 65 checks green.
- **H1** `net/wire.js`: at most 19 fields, numbers only (`"100"` is no longer a number), heading wrapped by `wrapAngle` (exact `a % 2pi`,
  constant time; also right for 3e16 where the floor() form drifts), y -500..9000, air 0..30, progress 0..1e5. `remotes.js` imports
  that `wrapAngle` (its while loop froze every tab on a heading of 1e300 / 1e12).
- **M1** `net/session.js`: a hand-shake message never replaces a HEALTHY link (open and a packet within 3 s, relay 6.5 s): an offer or a
  'relay' then is ignored; a new presence nonce while healthy waits in `pendingNonce` and tick() applies it once the link is not (a real
  reload whose 'bye' got lost still recovers, ~3-4 s later); SDP over 20 KB dropped; relay payloads carry `n` (my nonce) and are only
  taken from the pair's other player with his current presence nonce (an old client without `n` still passes).
  **Still open**: Realtime broadcast does not authenticate senders, so a forged ANSWER to my own pending offer, or a forged presence +
  offer while the link is down, can still take a pair over. The real fix is Realtime Authorization (private channels + RLS on
  realtime.messages, the JWT's user = the roster uid) — a server change, not done here.
- **LOW 1**: per-peer token bucket in `onLinkMessage` (reliable 60/s burst 130 = one relay batch, states 40/s; dropped, counted in
  `netStats.flooded`); 'hi' outfit must be a known id (`remotes.js outfitOf`, else "any free one") and a figure is rebuilt at most once
  per 2 s (`MEET_GAP_MS`, index.js + freeride.js); race.js ignores a repeated identical fin/dnf (no save + table rebuild per message).
- **LOW 2** race.js: go / sync start times must be numbers; capped to now + GO_LEAD + 6 s and now - HARD_CAP (a real go is unchanged).
- **LOW 3** freeride.js avalanches: id `^[A-Za-z0-9_:.-]{1,64}$`, numeric seed and t, a start more than 2 s in the future is dropped;
  optional `host.avalanche.known(id)` hook — **C2: wire it in main.js to the real zone ids** when avalanche.js lands.
- **LOW 4** `modes/cloud.js`: posts to `location.origin` (not '*'), listens only to `event.origin === location.origin` ('*' kept only for
  an opaque 'null' origin). No discovery grid `d` in cloud.js on this branch — **C2 adds it: validate it in decodeCloud** (type, length,
  charset) like `s` / `b`.
- **LOW 5** roster names `String(name).slice(0, 16)` in readMpContext (+ the board row), entries without a string id dropped.
- **LOW 6** `window.__ski` stays (cosmetic: it cannot post a valid time).
- **M3** three.js `integrity="sha384-qOkzR5Ke/XkQxuGVJ9hpFEpDlcoLtWwVYhnJf06cLIZa2vaIptSqaubivErzmD5O" crossorigin="anonymous"` on
  pb/ski.html, mtb.html, lux-drive.html, train-sim.html (all four load exactly `three@0.160.0/build/three.min.js`; hash computed from that
  URL with curl + openssl, same as fouer.html). A new three.js version needs a new hash (the test checks it).
- **SQL (NOT applied — Ian / orchestrator at launch)**:
  H2: `scores_guard_row` lives in ONE block of `scripts/security-fix-scores-v1.sql` (`-- >>> scores_guard_row` .. `<<<`) and
  `make_sql.py` copies it into `ski-v1.sql` after `ski_board_floors` (with its trigger), so either file can run first or again: once the
  table exists, a ski-* row needs a board listed there and ski-* rows are not part of the 300; before it, ski-* ids are ordinary games.
  M2: `ski_time_floor` drops a bare 'ski' row and unknown ski-* boards (`not found`; was a 20 s floor).
  M4: floors = `floor(length / 33 m/s)` (SKI.maxSpeed) with the length measured exactly like pistes.js (Float32 sums of the packed line,
  `make_sql.py client_length`): resort.json `len` differed by up to 16 m, so 38 boards (76 at 33 m/s) had an SQL floor 1 s above the
  game's — the game could post a time the server silently dropped. Now all 1351 piste floors == `minRunMs` (client `PLAY.maxRunSpeed 33`).
  Checked on PGlite (Postgres 16.4 in WASM, scratch only, 19 checks) with a fake scores table: both files in every order, 300 cap, 1351 ski rows on
  top, unknown / bare / under-floor / NaN / > 1 h / park range, game_id rename.
  **Caveat (M4)**: the checkpoints (every 220 m, radius half width + 60 m) let a skier cut bends: on 555 of 1351 pistes the shortest
  path through them is under 33/40 of the line length, so a bold off-piste line could be faster than length / 33 and be marked invalid
  ("ongëlteg") — the same rule as before, only stricter. If players hit it: tighter checkpoints on winding pistes, not a lower speed.
  Park ceiling per layout: not done (halfpipe hits repeat, so features x best trick x combo is no real bound); stays 250,000.
Browser runs (22 Nov, this branch, browser-slot ski pool, one at a time): ski-mp + ski-mp-freeride Chromium PASS, WebKit PASS (first
WebKit try: every race check ok, only emma's frame logged one boot-probe "Importing a module script failed" — a load flake under the
Mini's load, the rerun was clean); ski-challenges (cloud origin) Chromium PASS; all 9 mp-lobby-* Chromium + WebKit PASS. Node:
security-test, mp-race-test, r7d-test (1424), round6-test (2307) green.

## Round 8b (22 Nov 2026, branch `worktree-agent-af10f0221a941c5fa`): R7-C2 + security merged, checks re-run, 3 Vallées QA fixes
**Merged**: R7-C2 (`worktree-agent-acb90fde7a15074ac` @ 61fe6f92, contains R7-C) and the security branch (`worktree-agent-acf4147b279b85622`
@ 74c5d016) onto the R8 integration head 1b93cf27. One implementation per feature:
- From C: first person (firstperson.js, C key / 👁), spray.js (spray + tracks), avalanche.js (+ Lawin ≥ 35°, rumble / crack sound),
  map tap-teleport to discovered places + fog + "⌂ Bei den éischte Lift" (explore.js / discovery.js, cloud field `d`, Lawin `w`), challenge
  course (gates on open snow, push start 17 km/h, net barriers + soft collision, upright ZIL + snow strip, distance HUD, "Zréck op d'Pist",
  8 s off -> abort choice), pistes.js loop-projection fix, config FIRST_LIFT.
- DROPPED from C: the 42 m boarding radius (freeride.js BOTTOM_RADIUS stays 30, liftride.js RIDE = R7-B's) and C's liftSpot / boardSpot:
  the spawn waits at R7-B's boarding-zone spot `modes.lifts.boardAt(FIRST_LIFT)`; a map teleport onto a lift (safeSpot kind 'lift') is a
  fast travel to that lift's zone (goFree). C's `!mp` guards -> `!isRace()` (avalanches + the course abort also in the online free ride).
- D's free-ride avalanche events go straight to C's `avalanches` (main.js host.avalanche.trigger / known; no `window.__ski` needed).
- Security merge: (1) `host.avalanche.known(id)` = avalanche.js `knownZone(field, faces, id)`: a Lawin face's top cell or a 40 m cell
  inside the resort with a releasable point by the FAR grid (the same on every device before tiles load; slope >= AV.slope - 15, piste /
  forest / rock / houses filtered); round7c-check: 389-398 / 400 releasable cells known per resort (a friend's rare release on a steep
  edge cell can be dropped locally), 0-1 / 200 piste middles, 0 forged ids. (2) cloud `d` / `w`: <= 16 resorts each, rid [a-z0-9]{1,16},
  discovery.js rleIntervals now also rejects a run past MAX_CELLS (2^20; was: any length up to MAX_RLE chars), security-test.mjs has 5 new
  C2 cloud checks (replacing the "no d yet" placeholder). (3) `make_sql.py client_length` drops the same OSM spurs as pistes.js
  (`drop_spurs`), ski-v1.sql regenerated: 11 floors changed (e.g. arlberg familienabfahrt-variante-blu 22 -> 18 s); client minRunMs ==
  SQL floor stays true. NOT applied (SQL is for launch).
**Fixes in this round** (each with a check over all five resorts):
- pistes.js `dropSpurs`: OSM lines that run out a dead end and back along themselves (14 in the five resorts: Zermatt cieloalto-cervinia
  was unfinishable, the bot rode up a 25 m spur and back forever) lose the spur. round7c-check --rides 1351/1351.
- Push start: main.js `pushStart` leaves R7-A's standing hold (`hold: 0`): the 17 km/h kick was zeroed until the first input.
- Draw calls (Niddreg): the local skier + ghost are ONE skinned mesh (skier-model.js `skinned: true`, bones = the per-bone groups like
  remotes.js; hidden groups (poles in a cabin, twin tips, first person = all but the gear) get a zero bone matrix), avalanche flag + post
  in one instanced mesh. calls-sweep7d (no --gpu): worst 169 / 166 / 162 / 162 / 168 -> 153 / 151 / 148 / 145 / 151 (Killy / 3V /
  Zermatt / Arlberg / Kronplatz), p95 136-140, median 119-125. The lift-name sign layer stays its own call (not needed to fold).
- 3V QA blockers: gates vs R7-B's real stations: clear.js `createObstacles({ liftWorld })` asks `lifts.world.inStation / hit` (frames,
  solid parts, pylons) + the kept houses; round7c-check checks independently: 0 gates touching a station / lift part / house in all five
  (1351 gates; 117 moved down, 251 beside the line). A blocked start can't trap: 10 s under 1 m/s on a course -> the abort card.
  ZIL on open snow: clear.js `courseFinish` moves the finish up the line (<= 140 m) until both pillars + the middle are clear of stations /
  houses with a clear 60 m run-in (Killy 23, 3V 48, Zermatt 13, Arlberg 36, Kronplatz 16 moved), game.js / course.js take `finishS`.
- Skis in station platforms: lift-site.js `world.deckTop(x, z, ground)`; main.js `standHeight` = max(snow, deck) for the physics
  (world.height / normal), placeAt, the hold, the boarding walk and the figure's leg IK; the skier is re-snapped when the lifts (decks)
  are built. ground-check.mjs `decks`: 14 boarding spots per resort, a ray onto terrain + 'ski-lifts' <= 3 cm over where he stands.
  Drag tracks drawn 1.2 cm (was 3.5) over the lift-path ground.
- WebGL context lost (WebKit): nothing drawn while lost (no TypeError loop), restored -> carries on, else after 2.5 s a "Neu lueden" card.
- Stale ride HUD: `dropRide()` when a fast travel / teleport / challenge / park starts during a ride. Standalone "Online-Rennen":
  mp-gate.js jumps to `/lobby.html` (was relative -> /pb/lobby.html 404). Finish card: no "Nächst Pist" twin of "Weiderfueren".
  Lift list: a bare-number lift name gets its kind ("Sessellift 3000"), the height reads "↑ 2959 m" (was "30002959 m").
- Tools: frame-probe.mjs `--travel N` (frames after N fast travels, every upkeep method wrapped), round8-sheet.mjs `fp` + `map` shots
  (the map shot reports list row vs card), pose-check waits 60 drawn frames (a half-blended plough failed under load).
**Round 8b checks (22 Nov, this branch; machine load 7-30, one browser job at a time)**
- Node, all green: round7c-check --rides 115/115 (spawn in B's zone 9 m, teleport 195-200/200 safe, Lawin faces >= 35°, avalanche zones
  known 389-398/400, gates 1351/1351 on open snow and 0 touching a station / pylon / house, every ZIL clear (Killy 52, 3V 86, Zermatt 29,
  Arlberg 64, Kronplatz 25 moved up), course rides 1351/1351, HUD < 30 m at the ZIL, barriers 533/533 aimed hits held, 0 through),
  security-test all passed (incl. 5 C2 cloud checks), mp-race-test, round7b-test 5981, round6-test 2307, round7-test 30, r7d-test 1424,
  look7d-check 68, harness --all 23/23/23/19/19.
- ground-check (both engines, before the deck fix): 10/10. After the deck fix + the new `decks` test: spawn on the deck (0.00 m), every deck
  spot 0 cm, failures only Killy Combe Folle (drag start line 8.5 cm, now a deck) + drag tracks 3.5-5 cm (now a depth-free decal, the test
  skips decals) -> NOT re-run after those two fixes: re-run `ground-check.mjs --engines chromium,webkit` (expect 10/10).
- pose-check: WebKit all green; Chromium all green after the 60-frame settle (first run: 3V plough tails 0.42 m half-blended).
- calls-sweep7d (Niddreg, no --gpu): worst 153 / 151 / 148 / 145 / 151 (was 169 / 166 / 162 / 162 / 168), all <= 160.
- frame-probe WebKit (load ~10): fast travel x 6 lifts: p95 18 ms, max 46 ms after the fade (no 200 ms hitch any more); Niddreg diebold
  p95 58 / max 699 ms before the skinned skier -> WebKit `ski` flow now p95 26 ms / max 28 ms (127 calls, 438k tris): 1 ms over the
  25 ms gate (headless WebKit, software paths); Chromium `ski` p95 16.7 ms.
- Flows Chromium (load ~8): 25/29 PASS (home-page, ski, ski-ipad-start, ski-resorts, ski-mp, ski-challenges, ski-park, ski-freeride,
  ski-lift, ski-skis, ski-lifts-all, ski-webkit, ski-look7d, ski-teleport, ski-avalanche, all 9 mp-lobby-*, arcade-pad). FAILED:
  ski-mp-freeride (its fake avalanche id "c12_34" is now refused by known(): flow fixed to send a real Lawin-face id, PASS in WebKit),
  ski-spawn (C's "nothing within 25 m ahead" vs B's in-station wait spot: flow fixed, PASS in WebKit), ski-firstperson (Kronplatz: 0
  powder grains carving at 7 km/h + view lean -0.0°; WebKit also 3V lean -1.6°: the bot's carve there is too slow / too straight for the
  flow's thresholds, or the lean sign; NOT fixed), ski-course (Kronplatz sylvester 4.1 km: not at the ZIL within the flow's 240 s; suspect
  the new 10 s "stuck -> abort card" pausing the run when the scripted skier slows on a flat, or the moved finish; NOT fixed — check
  `stuckFor` (main.js courseTick) against a slow-but-moving bot, maybe count only < 0.3 m/s or only off the line's progress).
- Flows WebKit: ran on the live tree during the fixes (see ~/Library/Caches/ski-work/round8b/flows-webkit.log): ski p95 26 ms (FAIL by
  1 ms), ski-ipad-start is Chromium-only (CDP), ski-firstperson + ski-course as above, the rest PASS through mp-lobby-party at the time of
  writing. Logs: round8b/flows-chromium.log, flows-webkit.log.
- WebKit sheets: ~/Library/Caches/ski-work/round8b/sheet/sheet-<resort>-webkit.jpg (spawn, street, station, ride, carve, stop, drag, fp,
  map) + c2/ (course start / mid / finish / avalanche, checks.txt). Seen: skinned skier correct, stations with names, decks fine.
**Still wrong / open after 8b** (A / B areas unless noted):
- Hockey stop END pose at 0 km/h: one ski under the boots, the other ~90° across beside him (Arlberg / Zermatt / Kronplatz stop shots;
  also in R8's pre-skinning shot round8/webkit-arlberg-stop.png, so not the skinned mesh). pose-check only tests it at speed.
- Spawn camera under the station roof (roof fills the top quarter); first-person hands still read blocky (mittens added, not re-shot).
- 3V QA not done here: camera stuck in a tree after a crash; Funitel drawn as a 2-cabin tram + chase cam in the cabin roof; cable cars
  without a waiting cabin at the bottom; chair skis through the footrest; platter rod not held; plough at 0-7 km/h (the hold / hockey
  states win over the plough); Lac des Creux banner across another piste; tapping empty map in piste mode does nothing.
- Morning light: shaded pistes read dark blue-grey in the course shots (R8 shade colour, look area).
**NEXT (coordinator, 06:50)**: merge `ski-r8c` @ 42b8a16e (contains 56640959), take R8c's re-baked data, then: restore SONNENKOPF in the
Arlberg bake (keep R8c's other drops), re-bake arlberg only, `python3 scripts/ski/make_sql.py` (this branch's spur-aware lengths) +
data-hashes, re-run security-test; check nothing depends on fixed lift ids (lift ids = `l<index>`: saves only store piste ids / disc
cells / Lawin face indices; avalanche ids are 40 m cells; flows use names) ; round7c-check barrier 89/90 on R8c data -> 0 through; then
everything above again on the merged head (+ R8c open items: Brides roof across the street (8388,926), half-buried blocks
(14149,4851), navy evening shade + stair-step station shadows, angular street bends; 3V Courchevel 500k tris / 161 calls).

## Round 8c (22 Nov 2026, branch `ski-r8c`): look QA items (villages, rock, cabins, parks, names, labels, HUD, first person) + 3V QA data
Base = R8 integration 1b93cf27; **R8b merged in at 56640959** (C2 + R8b fixes) to add the hands to C's firstperson.js (one conflict in
main.js createVillage resolved: R8c `resort: rid` + R7-C `explore.setBuildings/regate`). Sheets: ~/Library/Caches/ski-work/round8c/.
**DATA RE-BAKED: all 5 resorts** (bake.py, ~1 min each, `scripts/ski/r8c-rebake.sh`), manifest (data-hashes.json) and scripts/ski-v1.sql
(1301 boards) regenerated. R8b / the next integration must take this data.
- **Villages** (village.js): Alpine resorts (`ALPINE_RESORTS` = zermatt, arlberg, kronplatz; main.js passes `resort: rid`): every house
  gabled (`tameRow`: OSM flat roofs and the blocks become kind 0), at most 4 storeys under the eaves (3 under 150 m2); the big ones are
  HOTEL style 8 (stone plinth, white plaster below, larch above, a dark beam, shutters, a wooden balcony along both long sides on every
  upper floor, 26-31 deg roofs, 1.35-1.7 m overhang). Killy / 3V keep their blocks. LOD: a BASE mesh per 1280 m cell (walls, roof, snow
  edges, plinth, chapel tower) + a DETAIL layer per 320 m cell (balconies, chimneys, terrace rails, roof housings) drawn within
  `DETAIL_RADIUS` (150 / 380 / 800 m). Railing boards anti-aliased (fwidth), shaded roof snow blue-grey (was saturated blue).
  Check: r8c-check.mjs villages (Alpine: 0 houses over 4 storeys, 0 flat roofs; arlberg 790 / kronplatz 1291 / zermatt 469 hotels).
- **Triangles**: gates instanced near the camera only (markers.js `gatesNear`, 1500 m: ~53k triangles were drawn everywhere), streets
  fine (2.5 m lattice) only within 360 m and a 10 m coarse copy beyond (roads.js), the village LOD above, far tree cards medium
  {2500, 1350, 0.66} / low {1600, 850, 0.45} (forest-far.js), Mëttel lodScale 0.75 -> 0.66 (config.js). Sweep (every village / hamlet
  centre x 4 headings, WebKit, `scripts/ski/r8c-sweeps.sh`): Niddreg max per resort (every village / town centre x 4 headings): killy 396k / 153 calls, zermatt 421k / 154, arlberg
  441k / 155, kronplatz 375k / 156, 3vallees 540k / 161 at Courchevel (over: Courchevel's lifts are 134k there: stations 58k, carriers
  ~53k, drag tracks 17k; carriers since cut to 750 m chairs / 1300 m gondolas -> Courchevel 500k, Val Thorens 460k, Freney 456k: still
  over). Before (QA / my sweep): 494-910k; Nasserein Niddreg 566k -> 431k, Mëttel 735k -> 590k (Mëttel not re-swept after the lodScale /
  forest cut; expected ~-90k). Breakdown at a spot: `window.__r8.breakdown()` (r8c-helpers.js).
- **Rock lines** (snow-shader.js): the "circuit board" lines were the gully snow STREAKS, read in a frame turned to the fall line round
  the WORLD origin (|wp| x the normal's turn between triangles = tens of metres: concentric zigzags); now two world-fixed stretched
  samples blended by the fall direction. Also: strata snow lines AA by their footprint and only on cliffs (>= ~50 deg), the final
  rock/snow edge never sharper than a pixel (fwidth), a wider far rock ramp (far facets). Line score (`scripts/ski/r8c-lines.py`, share
  of 1-2 px bright ridges in the rock area): Face de Bellevarde low view 3.41 % -> 2.12 %, chase view 2.79 % -> 2.11 % (snow grain is
  ~2 %: the lines are gone, see the shots). 3V spots (Mauduit, Bouc Blanc top, Brides) and the far Saulire ridge from Bouc Blanc: no lines / zebra in the WebKit shots.
- **Cabins** (carriers.js, liftride.js): cable cars glazed down to 0.85 m, mullions on every side, head band, handrail, floor mat, gondola
  benches; window camera standing 2 m behind the cable car's front glass (eyes 1.72 m), on the gondola's back bench (1.25 m), pitch
  floor -0.04 rad: the parapet is a ~7 % strip with the handrail (was 35 % blank panel). Gornergrat carriage: lower body as panels (was
  one solid block), sills, window band, end walls, benches in bays with tables, head lamps outside; window camera in the front bay.
  Glass 0.32 tinted (carriers.js `GLASS`, lifts.js). Trees: far tree cards keep the lift aisles too (forest-far.js `farTreesOfBlock` +
  lift-site.js `liftTreeGuard`, memoized per resort). Check r8c-check rails: 0 trees + 0 far cards within 4.3 m of every surface railway
  (Gornergrat Bahn 9 km: 0 / 0), 0 far cards where the lift guard forbids trees, all resorts.
- **Parks** (park.js, host.js, park-check.js): a drop-in (first 24 m at least 22 % average, the start deck >= 12 %): tucked from the start
  10 km/h after 2.1-2.2 s in all 5 (was killy 4.5, kronplatz 5.9, arlberg never); a clean straight air off a kicker scores "Straight
  Air" (100 x the kicker's multiplier): straight run 1010-1061 points (was 0 at low speed); park hint bottom middle for 14 s
  ("Sprong mat E · Trick mat F (A / D dréinen) · W: ufueren", touch "Sprong mat ⤒ · Trick mat ✦"). harness --park: 19-23 / resort green.
- **Names** (linepack.js `pisteDisplayName` on unpack + bake.py `display_name` / `with_colour`): a bare ref ("0", "2a", "G", "3000")
  shows as "<Faarf> <ref>" (kronplatz "0" -> "Blo 0"); the same name in two colours gets the colour ("Bouc Blanc (Rout)" / "(Schwaarz)");
  same name + colour numbered ("Doron (Variante 2)"). Ids unchanged by the names. r8c-check: 0 bare, 0 duplicates in all 5.
- **Labels** (markers.js `placeLabels`): nearest first, pushed inside a 10 px margin (never more than half their width from the gate),
  lifted once when they hit a placed label or the HUD (.tl, .tr, .hbtns, hint), else dropped; sizes measured once per name. Check:
  2000 random scenes, 7497 labels, 0 overlaps / cut / on the HUD. In the browser `window.__r8.labelBoxes()` (no spawn had a gate in view: 0 labels; not verified on screen).
- **HUD** (ui.css): stronger halo + a soft dark pill behind the top-left block and the speed. Contrast (`scripts/ski/r8c-hud.py`, fog,
  WebKit): name 2.25 -> 5.2, clock 2.23 -> 5.27, stats 1.77 -> 3.83, speed 4.82 -> 9.02.
- **First person** (fp-hands.js, 2 lines in firstperson.js): padded gloves round the grips (fist, knuckle roll, thumb), cuff and sleeve
  down out of the picture (> 0.3 m: the near plane); C's small glove box removed.
- **Streets** (roads.js `gentleRoads`): pieces steeper than 17 deg are not drawn (segments > 25 deg: 3V 58 -> 0, arlberg 73 -> 0, killy
  33, zermatt 52, kronplatz 44 -> 0; steepest 45-60 -> 16.7 deg), the bank fades into the snow (alpha, no hard lattice rim).
- **Data** (bake.py `tidy_network`, `join_fragments`; check `node scripts/ski/r8c-network.mjs --check`): the resort = its connected ski
  network (lift station <= 150 m from a piste or station, piste end <= 60 m from another piste) + pieces within 1 km of it (St. Anton's
  Rendl across the village, nursery lifts). Dropped: 3V La Norma (5 lifts), Raffort/Planchamps, Porte Brune/Télégraphe, Poucet;
  Zermatt Monterosa Stafal/Sant'Anna (6 lifts), Fontanafredda/Libera pistes; Arlberg Sonnenkopf (10 lifts, 28 pistes: a separate area of
  the Ski Arlberg pass, 3.4 km away), Fuchslochlift, Hochkar piste; Kronplatz Ski Pfalzen. Non-ski trains dropped: Courchevel ski-jump
  funicular (Tremplins), Brelin, La Croisette, the 107 m unnamed one, Killy Brévières 132 m, Cheneil lift (Leisee-Shuttle kept).
  Fragments joined (same name + colour, end -> start <= 150 m): Crêtes, Arcosses, Schöniplätz, Spielboden. Bouc Blanc NOT joined: its red
  pieces are 610 m apart in OSM (no line between); shown as "Bouc Blanc (Rout)", "(Rout 2)", "(Schwaarz)".
- **Node checks** (all on the re-baked data): round7b-test 5545/5545, round7-test 30/30, round6-test 2142/2142, look7d-check 68/68,
  r7d-test 1424/1424, r8c-check all green, harness x5 green, round7c-check 89/90 (barriers: 126/127 aimed skiers held — one goes through
  after the data change; C2/R8b's test, not looked into). `scripts/ski/r8c-node-all.sh` runs them all.
- **Tools**: r8c-drv.mjs (one long-lived page over HTTP), r8c-helpers.js (spot, ride, sweep, breakdown, hudRects, labelBoxes),
  r8c-sweeps.sh, r8c-lines.py, r8c-hud.py, r8c-network.mjs, r8c-check.mjs, r8c-node-all.sh, r8c-rebake.sh.
- **Still open**: 3V Niddreg budget at Courchevel / Val Thorens / Freney (lift stations + carriers + drag tracks: a station LOD in lifts.js /
  lift-site.js is the next step); Niddreg calls 161 in Courchevel; Mëttel ≤ 450k not reached (terrain ~240k + far cards); streets near
  by still read as angular grey tyre tracks at bends (the per-cell nearest segment; a proper ribbon distance would fix it); house roof
  across the Brides street (8388,926) not looked into; big blocks half buried (14149,4851); evening shade at stations dark navy, station
  shadow stair-steps; dyn-res thrash (post.js already backs off; QA ran at high load); Bouc Blanc's red pieces stay apart (OSM gap); lift
  ids shifted with the dropped lifts (l65 is no longer the Gornergrat Bahn: anything that stored lift ids / index-based names must use
  names); ski-v1.sql regenerated (1301 boards) but NOT applied; round7c-check barrier 126/127; WebKit / Chromium flows not run on this
  branch (R8b runs them; budget numbers above are from the r8c driver at 1180x820, dpr 1).

## Round 8d (22 Nov 2026, branch `worktree-agent-acbed7815bfc2304c`): R8b + R8c merged, Sonnenkopf back, Niddreg budget, R8c leftovers
**Merge**: R8b head 8bd7cc9d + `ski-r8c` @ 42b8a16e (merge base 56640959). Taken: R8c's re-baked data (all 5) + its village / roads /
snow shader / carriers / park / labels / HUD / fp-hands; R8b's code (make_sql.py spur-aware `client_length`, pistes.js `dropSpurs`, C2,
security). Conflicts: firstperson.js (R8c's fp-hands gloves kept, put on R8b's lower / wider pole grips `[side*0.365, -0.385, -0.59]`; R8b's
mitten dropped), HANDOFF (both sections), ski-v1.sql (regenerated). `scripts/ski/floors-check.mjs` (new): every board's client floor
(`minRunMs(createPiste(..).length)`) == its ski-v1.sql row, every piste has one row, no stray rows.
**Sonnenkopf restored** (Ian: it is on the Ski Arlberg pass): `common.py` arlberg `keep_areas: ("Sonnenkopfbahn",)`; `bake.py tidy_network`
keeps a separate area (> NET_KEEP) when one of its lifts is listed (log line "keep the separate ski area 3437 m ..."); R8c's other drops
stay (La Norma, Raffort / Planchamps, Porte Brune / Télégraphe, Poucet, Monterosa Stafal / Sant'Anna, Ski Pfalzen, Fuchslochlift, Hochkar,
non-ski trains). Arlberg re-baked alone: 100 lifts (was 90), 353 pistes (was 325), manifest + ski-v1.sql (1329 boards). Reaching it:
`config.js BUS_AREAS = { arlberg: ['Sonnenkopfbahn'] }` -> `explore.js busLifts` discovers the valley station like the first lift
(the real bus from Stuben / Langen), so the map teleport and the lift list (fast travel) reach it; its 28 pistes get gates / courses /
boards like every piste (round7c-check arlberg 353/353 gates + rides). Checked in the browser (`scripts/ski/r8d-sonnenkopf.js`):
discovered = true, fast travel waits at "Sonnenkopfbahn" (shot round8d/drv/chromium-sonnenkopf-spawn2.png).
**Niddreg budget** (r8d-sweeps.sh = R8c's village sweep, every village / hamlet centre x 4 headings, Chromium 1180x820 dpr 1):
- lifts.js: parts with every side < 2.1 m (rails, gates, lamps, sheave frames, hubs) go to `ski-lift-fine-*` 1250 m cells drawn within
  min(700, 0.25 x liftRadius) (Niddreg 450 m); drag tracks one mesh per 2.5 km cell within 900 m (`TRACK_R`; was one 17k mesh everywhere);
  drag bars FAR_R 450 -> 320 m, platter 8-sided. carriers.js: far chair = 4 boxes (48 tris, was 120), far cabin = 4-5 boxes.
- roads.js gets the quality level (main.js never passed it: always medium): FINE_RADIUS low 150 (was 260 never used), coarse radius on
  Niddreg 1300 -> 1000 m.
- quadtree.js `selectTiles({ protect })` + config QUALITY.low.protect = 160: on Niddreg the 320 m nodes are coarsened by lodScale too
  (the skier's 80 m tiles never): Courchevel terrain 243k -> ~196k.
- Result Niddreg (max of 4 headings): killy 351k / 126 calls, 3vallees 410k (Courchevel) / 135, zermatt 383k / 129, arlberg 367k / 131,
  kronplatz 333k / 124 (was 3V 500k / 161, Val Thorens 460k, Freney 456k). Mëttel: killy 377k / 146, 3V 472k / 155, zermatt 417k / 139,
  arlberg 413k / 147 (St. Anton, was ~590k), kronplatz 379k / 142. JSON: ~/Library/Caches/ski-work/round8d/sweep-<level>-<rid>.json.
**R8c leftovers**:
- Brides roof across the street: roads.js `housesOnStreets` (a street's middle half crosses a house footprint > 2 m -> the house is not
  drawn, not solid: main.js `drawn`, round7c-check mirrors it): killy 73 / 1980, 3V 171 / 5553, zermatt 111 / 4335, arlberg 164 / 5428,
  kronplatz 175 / 6748.
- Half-buried big blocks (Courchevel 14149,4851: 16.6 of 20.9 m of wall in the hill): village.js `seatRows` raises a house > 400 m2 until
  at most 40 % of its walls are under the ground at its highest corner; block() got chalet()'s stone plinth on the low side (grown 0.12 m).
- Angular street bends: roads.js `roundRoads` (Chaikin x 3 on corners > 10 deg, cuts <= 7 m) before the lattice; junctions: every lattice
  cell also gets the nearest OTHER street (`aSegC`), no rectangular cuts where two streets meet (shots drv/chromium-brides-street3.png).
- Stair-step shadows: snow shader `sunMapShadow` = 3 x 3 quadratic B-spline PCF (was 2 x 2 bilinear); three's own receivers (station decks,
  lifts, skier) PCFShadowMap (was Basic: the deck shadows were texel stairs). Navy decks in the morning / evening: the hemisphere light (the
  Lambert objects' sky light) half desaturated (env.js). The snow shader's own shade colour is unchanged (evening shade still blue-grey).
- round7c-check barrier test: the course's projection hint walks down from the gate before the aimed skier (arlberg stapf: two 45 m wide
  legs of one piste side by side, the hint started on the other leg; in the game the skier skis there) -> 140/140; failing pistes named.
**Tools**: r8d-drv.py (client for r8c-drv.mjs without the word in the URL), r8d-helpers.js (`__r8d.meshes()`: triangles / calls per mesh
name), r8d-sweeps.sh, r8d-checks.sh (ground / pose / calls in a row through browser-slot), r8d-spot.js, r8d-sonnenkopf.js, floors-check.mjs.

## Round 8e (22 Nov 2026, branch `worktree-agent-a7fe481f6c8cd50fd`, from R8b 8bd7cc9d): 11 open items (flows, poses, trees, lifts, banners, map, spawn)
No data / bake / SQL changes (R8d re-bakes in parallel). Nothing depends on lift ids (funitels are classed by name / seats / capacity).
- **Flows** ski-course: Kronplatz sylvester stopped dead 30 m below its gate against a lift station ON the OSM line (the 10 s stuck timer
  was right). clear.js `courseGate` now also wants the first `COURSE.runIn` (60) m below the gate clear of houses / stations; bot.js takes
  `blocked(x, z)` (main.js `window.__ski.blocked` = station parts / pylons / houses, 2.5 m margin) and aims beside the line round them
  (+ sideways along a wide house, + a pocket escape after 1.5 s stuck); course.js `courseLayout().openAt(s, side)`: the net is left open
  (drawn AND no soft collision) where a house / hall reaches within 3 m of it (Killy joseray runs through a 33 x 31 m hotel); main.js
  passes it to `createCourse({ open })`. round7c-check rides now collide like main.js (trees + R7-B lift world + kept houses), respawn
  like main.js clearSpot, and check: run-in clear 1351/1351. ski-firstperson: the flow now carves on a piste point whose next 120 m fall
  >= 12 deg and waits for > 30 km/h (Kronplatz's middle piste was a flat: 7 km/h, spray / lean are 0 below 3 m/s by design).
- **Hockey stop end**: the R8b "stop" shots were a PLOUGH at 0 km/h (the sheet braked below SKI.hockeyFrom 25 km/h) seen from 200 deg: the
  old V (0.34 rad on boots 0.29 m out) crossed its tips and the boots stood 15 cm off the bindings. skier-model.js: the legs spread in the
  plough (hip roll solved by forward kinematics `footOffset`), each ski sits exactly under its boot, PLOUGH_YAW 0.24 (tips ~12 cm, tails
  ~0.95 m); a held brake keeps the V at 0 km/h (R8's "parallel when held" dropped). skier.js: standing in a hockey stop (stop > 0.5,
  < 1.2 m/s) the steer no longer pivots him and the skis settle across the fall line; the body leans less at a standstill.
  round8-sheet `stop` now reaches > 32 km/h first (a real hockey stop). pose-check: plough held / 1 / 4 / 7 / 8 / 10 km/h (V 15-70 deg,
  tips not crossed), boots on the bindings (< 5 cm, ski frame) in every pose, and a REAL hockey stop from 40 km/h down the fall line:
  parallel, side by side, across the fall line, edged, at the stop and held 2 s.
- **Trees**: scatter.js `inCrown(x, y, z, density, margin)` (the drawn spruce: 1.15-10.1 m, 2.35 m wide at the bottom, x scale);
  main.js camBlocked counts crowns, lookCam lifts the camera out of a crown (to its top at most); respawn() goes through `clearSpot`
  (trunks 2.2 m, houses, lift parts, the chase camera's spot and his head out of every crown; else the nearest piste point, else rings).
  Check: scripts/ski/tree-crash-check.mjs.
- **Funitel**: lift-path.js `isFunitel` (name Funitel / DMC / 3S / Glacier Ride, a gondola with >= 32 seats, or a "cable car" whose
  hourly capacity is > 1.4 x what two shuttling cabins could carry: Thorens) and `normaliseLifts` (run by linepack.js unpackResort):
  kind gondola, type / sub 'funitel', LIFT_SPEC.funitel (gap 110 m, side 4.1), carrierBox + carriers.js big cabin on two grips, lifts.js
  twin haul ropes 3.2 m apart + its own carrier pool, liftride seat / cameras, HUD "Funitel". 3V: Funitel 3 Vallées, Thorens, Grand
  Fond, Péclet; Zermatt: both Glacier Rides.
- **Cable cars**: lifts.js jig-back pairs run at the ride speed (SHUTTLE_FACTOR 4); `dockShuttle` on a fast travel / the spawn (behind
  the fade), `holdShuttle` keeps a docked up-track cabin while he stands in the zone, `shuttleBoard` = the wait + the cabin's schedule;
  liftride.js `createRide({ shuttle })`: boarding waits for the scheduled cabin (drawn coming down its rope), toast "D'Kabin kënnt (n s)".
- **Chair**: carriers.js footrest bar 2.495 m under the rope (right under the seated boots), its struts at the bar's ends (outside every
  seat); poseSit skis level on it.
- **Platter / T-bar**: liftride.js the rider 1.8 m behind the spring box (DRAG_BACK, the bar grabbed 1.8 m up the line), `hand` = a
  point 0.55 m up the rod; carriers.js the rod from the box to the disc / T between his legs; skier-model `reachHand` (2-bone IK).
- **Banners**: clear.js obstacles `setPistes` / `otherPisteIn` (Liang-Barsky on 50 m cells): courseGate keeps the banner (+-5.5 m across,
  +-10 m along) clear of every OTHER piste's line; markers.js `promptable(m, st)`: "Start?" only < 3 m/s or skiing into the gate from
  above along the piste. round7c-check: banner check (independent 0.5 m sampling) + prompt check over every gate.
- **Map**: map.js a tap off every piste in the piste tab goes to the teleport ask (discovered -> "Hei hin teleportéieren?", fog -> "Nach
  net entdeckt"); ski-teleport flow has the step.
- **Spawn view**: main.js `stationFrame`: standing in a station, candidate camera spots (back / side / height) judged by `roofShare` (rays
  through the top fifth hitting a station part / house within 40 m) and a clear line to him (kept inside 78 % of the half view), eased in;
  `window.__ski.roofShare()`. Check: scripts/ski/spawn-view-check.mjs (spawn + 6 fast travels per resort, <= 40 % roof).
**Round 8e checks (22 Nov, Chromium only — see WebKit below; machine load 30-420 from other jobs during the flows)**
- round7c-check (Node, all 5): run-in clear 1351/1351, banners clear of other pistes 1351/1351, prompt 1351/1351 (never crossing at
  61 km/h), course rides with the game's collisions 1351/1351 (full re-run on the final bot: 130 passed, 0 failed);
  full re-run log: ~/Library/Caches/ski-work/round8e/r7c-rides.log. security-test, mp-race-test, round7b-test 5983, r7d-test 1424,
  round7-test 30, look7d-check 68 green; round6-test 2306/2307: Zermatt "Klein Matterhorn Glacier Ride" (now funitel class, wider
  lanes) exits 128 m from its top station (limit 120; the top station sits in the rock).
- pose-check (5 resorts, Chromium): all green (290 checks: plough 0-10 km/h, boots on the bindings, real hockey stop end + held 2 s).
- lift-pose-check: 60 ok, 3 FAIL before the last fix: Arlberg Mattunbahn chair "no ski over the footrest" (all other chairs 0.1-0.6 cm
  over the bar; not looked into), Arlberg platter / T-bar rod 13-14 deg (high rope: now dragBack() from the rope height, NOT re-run).
- spawn-view-check: 34/35 views <= 40 % roof (spawn: 3V 32 %, Killy 21 %); Kronplatz "Alpen Connecting" fast travel 46 %.
- tree-crash-check: 50 tree crashes, camera in a crown 0 / 17836 frames; 3 "not free" (one respawned facing the same tree -> clearSpot
  now wants 12 m clear ahead; "free" threshold 1 m in 2 s) — NOT re-run after those two changes.
- Flows Chromium (load 275-420): ski, ski-resorts, ski-challenges, ski-park, ski-freeride, ski-lift, ski-skis PASS; ski-ipad-start
  (13.8 s > 10 s to skiing: load), ski-mp (start gap 6.1 m > 6, +8 calls for 7 remotes: not investigated, maybe the push at "go" under
  load), ski-lifts-all (3V Télécorde rope tow pose '' at the sample: likely the short ride over under load) FAIL; the rest (firstperson,
  course, teleport, spawn, avalanche, webkit, look7d, mp-freeride) NEVER RAN: the run aborted inside ski-lifts-all ("browser has been
  closed" at load ~400; before that Zermatt train Ascensore di Cheneil: ride null after boarding). Re-run them first.
- WebKit: NOT run. Playwright WebKit hangs on this Mini since ~06:36 (newPage never returns: the WebKit network process blocks in
  CFNetwork's resource-loader thread start, `sample` shows it); killing R8b's hung orphan queue (qC.sh, slot1) did not help.
**Still open after 8e**: re-run everything above in WebKit once WebKit starts again; ski-mp / ski-lifts-all / ski-ipad-start at normal
load; Arlberg Mattunbahn footrest; Kronplatz Alpen Connecting framing; Glacier Ride exit distance; no "before" WebKit shots in round8e/.
**Round 8d, part 2 (after the coordinator's notes)**:
- R8e merged (`worktree-agent-a7fe481f6c8cd50fd` @ 2a3c7ff9, from R8b 8bd7cc9d, no data change): conflicts liftride.js (R8c's window eye
  heights + R8e's funitel half length), markers.js (R8c placeLabels + R8e promptable), round7c-check (imports; R8e's house box index = main's
  drawn houses). round6-test: the Klein Matterhorn Glacier Ride (now a 3S / funitel station, R8e) lets him off 128 m out: the limit is
  150 m for funitels (120 m for the rest).
- More R8c leftovers found on the way: street junctions painted from the nearest OTHER street too (`aSegC`), station decks' shadows via
  three's PCF, Lambert sky light half desaturated (navy decks), the block plinth grown 0.12 m (z-fighting found by ground-check coplanar),
  ground-check rays skip hidden meshes (R8c's hidden coarse street copies made 0.6-1.9 m "errors").
- Browser MEMORY (22 Nov rule: a browser tree > 2.5 GB is killed): Kronplatz Niddreg had a 1.7 GB JS heap at load: roads.js built the fine
  2.5 m street lattice for the whole resort (183 MB of vertex arrays + the plain JS arrays behind them). Now only the 10 m coarse lattice is
  built up front; each 640 m render cell builds its fine lattice when the camera comes within the fine radius (<= 2 per frame) and drops it
  beyond radius + 300 m. Heap at load 1726 -> 555 MB; the 18-village tour (killed at 2.6 GB before) ends at ~1.0 GB heap.
  STILL GROWING: +25 MB heap and ~+10 three geometries per teleport (94 -> 283 geometries over 18 spots while the scene's attribute bytes
  stay ~150 MB): something builds geometries and drops them from the scene without dispose() (not the terrain tiles, not the fine
  streets). Find it (wrap THREE.BufferGeometry to count by caller, teleport 10 x). The village meshes hold 107 MB of vertex arrays.
- Test tooling: every browser check is one resort / one flow per fresh browser (`r8d-flows.sh`, run_all `=name` exact match,
  `r8d-sweeps.sh` starts a driver per level x resort and writes mem-<level>-<rid>.json).
**Round 8d, part 3: checks on the final branch (after the 09:38 reboot; machine rules: one browser job, a tree > 2.5 GB is killed)**
- Node, all green on the merged head (R8d + R8c + R8e): round7b-test 5682, round7-test 30, round6-test 2192 (after the funitel 150 m
  limit), look7d-check 68, r7d-test 1424, r8c-check 36302, round7c-check 120 (no rides) and --rides 130/130 (every course of all 1324
  pistes finished, barriers 140/140 arlberg), harness 25/25/25/21/21, floors-check 1324 + 5 parks == ski-v1.sql (1329 rows),
  security-test all, mp-race-test all.
- Village sweep, Niddreg (max of every village centre x 4 headings): killy 349k / 126 calls, 3V 413k (Courchevel) / 135, zermatt 384k /
  129, arlberg 367k / 131, kronplatz 333k / 125 -> all <= 450k / 160. Mëttel: killy 425k / 156, 3V 583k / 164 (Courchevel), zermatt 493k
  / 154, arlberg 517k / 158 (St. Anton), kronplatz 525k / 165 -> all <= 600k. (The earlier Mëttel numbers in part 1, 377-472k, were taken
  while the 3 x 3 PCF shader did not compile: ignore them.) JSON + mem readouts: ~/Library/Caches/ski-work/round8d/final/village/.
- calls-sweep7d (Niddreg, every piste start / lift top, one resort per browser): worst killy 142 (Rogoney, 389k), 3V 141 (Rhodos, 382k),
  zermatt 132, arlberg 137, kronplatz <= 139; p95 126-129.
- ground-check, one resort per browser: Chromium 4/5 (3V: 3 coplanar plinth caps of two overlapping huts -> fixed 1b9d09d0, WebKit 3V then
  green), WebKit 5/5; spawn on the ground, rays 6 mm, decks 0 cm, skis >= -4 mm, 0 terrain cracks.
- pose-check: Chromium 5/5, WebKit 5/5 (incl. R8e's hockey end pose + plough).
- Flows (one flow per browser, `scripts/ski/r8d-flows.sh <out> "flows-chromium flows-webkit sheets sonnenkopf"`, FLOWS="..." to pick):
  Chromium so far: home-page, ski, ski-ipad-start, ski-challenges, ski-park, ski-freeride PASS; ski-resorts and ski-mp KILLED by the 2.5 GB rule (ski-resorts at the 4th resort
  of one page that reloads per resort; ski-mp = 3 game pages) -> these two need less memory per page (see below) or a per-flow
  exception. Earlier full Chromium run on the pre-R8e head (before the memory rule): PASS home-page, ski-ipad-start, ski-resorts,
  ski-challenges, ski-park, ski-freeride, ski-lift, ski-skis, ski-teleport, ski-spawn, ski-firstperson; FAIL ski (the "Face (Rout)" name:
  flow fixed, now PASS), ski-mp (relay pairing under load 140+), ski-lifts-all (Zermatt Leisee-Shuttle, a 60 m funicular kept by R8c:
  one of carrier / onCarrier / held false right after boarding: look at the flow's `on` values), ski-webkit (arlberg look yaw 0.18 after
  release, load), ski-look7d (gate pick: fixed, markers.order), ski-mp-freeride (host ahead on the line, timing), ski-avalanche (scripted
  trigger timed out 60 s at load ~140). NOT yet run on the final head: the rest of the Chromium flows, every WebKit flow, the sheets.
- MEMORY per page is the open blocker for the long flows: JS heap at load 340-640 MB (killy..zermatt), 960-1050 MB after a 15-18 village
  tour (arlberg / kronplatz), village vertex arrays ~107 MB (kept in JS after upload), +10 three geometries / +25 MB heap per teleport
  (may be first uploads of new village / terrain cells = bounded; check by teleporting back and forth between two spots 10 x).
- RESUME (next agent): `FLOWS="ski-lift ski-skis ski-lifts-all ski-webkit ski-look7d ski-mp-freeride ski-teleport ski-spawn ski-firstperson
  ski-avalanche ski-course mp-lobby-connect4 mp-lobby-slf mp-lobby-quick-match mp-lobby-games mp-lobby-color mp-lobby-party mp-lobby-arcade
  mp-lobby-roulette mp-lobby-blackjack arcade-pad" scripts/ski/r8d-flows.sh ~/Library/Caches/ski-work/round8d/final flows-chromium`, then
  all flows in WebKit (`... flows-webkit` without FLOWS), then `... "sheets sonnenkopf"` (WebKit sheets per resort + the Sonnenkopf sheet
  into round8d/final/sheet/; stack with look_sheet.py and LOOK at every shot). ski-resorts / ski-mp need the memory work first.

## Round 8f (22 Nov 2026, branch `worktree-agent-a0d4425b31d1efc10`, from R8d 949a6855): memory, flows without video, evening shade
**Memory** (the Mini's browser guard kills a test job whose process tree passes 2.5 GB real footprint: ski-resorts died at the 4th
resort, ski-mp with its three game pages). Measured with `scripts/ski/memory-check.mjs` (new): per resort a fresh page, "load" = every
height tile + village + streets in, then a tour over up to 18 village centres; then ONE page switching resorts 10 x the game's way
(location.replace); then 3 pages of one resort at once (the online race). Readouts: JS heap (gc first), three's geometries / textures,
the scene's JS vertex bytes, and top's MEM of the browser tree split renderer / GPU / other (1180 x 820 @2, q=low, Chromium).
Causes found (heap snapshots + CDP sampling heap profiles + Chrome memory-infra dumps, scripts in the R8f report):
- village.js: `rows.forEach` (a closure) put `cells` / `details` into createVillage's closure context, which update() / setLevel()
  kept alive for the page's life: every PLAIN JS vertex array of the build (8 bytes a number + growth slack) stayed in memory, 260-330 MB
  at Kronplatz / Arlberg, plus the Float32 copies three keeps after the upload (~105 MB). Now: the writer fills growing Float32Arrays
  (finish() = exact copies); the village is built PER 1280 m CELL when the camera comes within buildingRadius + 500 m (nearest first,
  3 ms a frame, 40 ms when it is close), its meshes go to the GPU at once (gpu-mem.js uploadNow) and drop their JS copies (gpuOnly), a
  cell is dropped again beyond the radius + 1500 m. `window.__ski.village.buildNear(x, z, r)` for checks right after a jump
  (ground-check uses it). Same rows / seeds / per-cell order: the houses are the same.
- lifts.js: the part lists (thousands of Box / CylinderGeometry, ribbons, rope points) stayed in the closure context: emptied after the
  merge; the merged station / pylon chunks are GPU-only (+ uploadNow after createLifts).
- roads.js: the coarse 10 m street lattice is built per 640 m render cell too (2 a frame, nearest first, within the street radius,
  dropped beyond + 800 m), like R8d's fine lattice; GPU-only meshes.
- Height tiles: codec.js `decodeGrid(bytes, 0, true)` keeps 16-bit steps (`u`, `qmin`): half the memory, LOSSLESS (every one of the 952
  tiles: fround(h0 + (u + qmin) * step) === the old Float32 value); field.js reads both forms.
- The far normal map and the forest raster drop their pixels after the upload (textureGpuOnly); surface blocks LRU 900 -> 420, terrain
  node cache 700 -> 400 (24.5 KB each).
- pagehide: every geometry disposed, renderer.dispose() + forceContextLoss() (the GPU memory of the old resort goes at once on a switch);
  a page restored from the back-forward cache reloads. A WebGL context restore with GPU-only geometry reloads the page (no JS copy left).
- `?debug=1&keep=1` keeps every JS copy (ground-check reads village / street vertices back; it now opens the page with keep=1).
Numbers (renderer = the page's process, MB; tree = the whole browser; Chromium 1180 x 820 @2, q=low; logs
~/Library/Caches/ski-work/round8f/mem-before.log / mem-after.log, JSON next to them):
| resort | heap before -> after | renderer load before -> after | renderer tour peak before -> after | tree load before -> after |
| killy | 245 -> 90 | 525 -> 353 | 525 -> 353 | 1235 -> 1026 |
| 3vallees | 533 -> 145 | 824 -> 401 | 824 -> 413 | 1556 -> 1063 |
| zermatt | 386 -> 101 | 676 -> 380 | 676 -> 380 | 1353 -> 1001 |
| arlberg | 605 -> 133 | 855 -> 439 | 873 -> 439 | 1584 -> 1115 |
| kronplatz | 585 -> 83 | 893 -> 335 | 893 -> 335 | 1564 -> 1013 |
Switching (one page, 10 x): before the trees went 1191 / 1592 / 1489 / 1645 / 1736 then 1554 / 1691 / 1582 / 1749 / 1718 (killy's
renderer 506 -> 794 on its second visit); after 980 / 1124 / 1082 / 1188 / 1086 then 1059 / 1202 / 1075 / 1239 / 1124, the page's own
renderer + GPU vs its first visit: killy +34, 3V +45, zermatt -31, arlberg +42, kronplatz +23 MB (the rest of the tree's growth is the
incognito test context's in-memory HTTP cache: each resort's data files once). Three killy pages at once: tree 2043 MB (was over 2.5 GB).
**Flows**: merged `claude/test-power-59c669` (FLOW_POWER: no video + headless shell on Metal + dsf 0.5 + 30 fps, `measuresFrames`
 flows at full quality (R8f: the ski flow sets it), h.releaseMemory()); R8f's own FLOW_NO_VIDEO switch dropped for it (r8d-flows.sh runs the
 flows with FLOW_POWER=1, sheets / shots without). Earlier note: the video encoder took ~60 % of the CPU of a 3D
flow). lib.mjs launches Chromium with `--disable-features=WebUIOmniboxPopup,WebUIOmniboxFullPopup,WebUIOmniboxAimPopup`: full Chromium
built 2-3 chrome:// omnibox renderers (~80 MB) per browser context (ski-mp: ~250 MB). ski-mp: a gate on each player's resort.json from
the start click, the three game pages boot one after the other (the mesh waits for everybody).
**Game fixes**: online race lanes = the start gate's side offset + the lane (the middle racer, lane 0, stood at the gate's 4.2 m offset
while the others stood +-1.9 m from the line: 6.1 m apart, ski-mp "side by side" failed); evening shade (Ian: still a fairly dark
blue-grey): snow-shader under the low evening sun (evK) the shade is ~1.3 x lighter and soft (blue / red ~1.14): on screen (WebKit,
Zermatt village in the shade) ~(135, 156, 197) -> ~(172, 184, 202); village.js snowy roofs in the shade the same (they stayed slate).
**Checks on the R8f head** (logs ~/Library/Caches/ski-work/round8f/final/flow-<engine>-<flow>.log):
- Node: round7b-test 5682, round7-test 30, round6-test 2192, look7d-check 68, r7d-test 1424, r8c-check 36302, round7c-check 120,
  harness 25/25/25/21/21, floors-check 1324 + parks, security-test, mp-race-test: all green.
- Chromium, all 29 PASS: home-page, ski, ski-ipad-start, ski-resorts (all 4 resorts in one page now), ski-mp (3 game pages, tree peak
  ~2.3 GB), ski-challenges, ski-park, ski-freeride, ski-lift, ski-skis (these 10 full Chrome, video off), ski-lifts-all (incl. Zermatt
  Leisee-Shuttle: the flow now reads the ride on its first seated frame), ski-webkit (the look waits for the ease back: it runs on the
  capped frame clock), ski-look7d, ski-mp-freeride, ski-teleport, ski-spawn, ski-firstperson, ski-avalanche, ski-course, mp-lobby-connect4
  / slf / quick-match / games / color / party / arcade / roulette / blackjack, arcade-pad (these 19 with FLOW_POWER=1).
- WebKit (the coordinator's launch set, FLOW_POWER=1): ski, ski-freeride, ski-lift, ski-spawn, ski-course, ski-webkit, ski-mp-freeride
  all PASS. ski needed: the tile streamer stops starting loads on pagehide (resort-data.js stop()) and the flow (WebKit only) drops the
  "…/pb/ski/data/<rid>/t/x_z.bin due to access control checks" page errors of loads the resort switch cuts (32 in one run; an
  AbortController made WebKit log more). The other WebKit flows were not run in R8f (launch priority).
- ground-check Chromium 3 Vallées: green (now with keep=1 + village.buildNear).
- WebKit contact sheets (full quality, no FLOW_POWER): ~/Library/Caches/ski-work/round8f/final/sheet/sheet-<resort>.jpg (3 x 3 grids
  of the round8-sheet shots) + sheet-sonnenkopf.jpg. Looked at all six: villages / streets / stations / rides / carve / fp / maps fine
  in every resort, Sonnenkopf spawn at the Sonnenkopfbahn OK.
**After launch (not blocking)**: hockey-stop end pose in Arlberg / Sonnenkopf still has one ski pointing at the camera (killy / 3V / Zermatt
/ Kronplatz look right); Sonnenkopf "street" shot: the camera stands against a house wall (sheet framing or the street pick); Kronplatz has
no drag shot (no drag lift picked); drag shots without the rider (Zermatt); the remaining WebKit flows (ski-ipad-start, ski-resorts,
ski-mp, ski-challenges, ski-park, ski-skis, ski-lifts-all, ski-look7d, ski-teleport, ski-firstperson, ski-avalanche, mp-lobby-*); GPU per
page still ~300-450 MB (ANGLE/Metal; village cells are lazy now, a compact vertex format could save ~35 % more); per-frame garbage
after all tiles are in (heap climbs ~100 MB before each GC).

## Launch (22 Nov 2026): LIVE on ian.lu
- Merged origin/main 0b25030f (FLOW_POWER flows: main's run_all.mjs / lib.mjs / scripts/power kept, R8f's omnibox flag re-added);
  gamedata_manifest.py (lux-drive in sw.js GAMEDATA_GAMES + pb/lux-drive/data-hashes.json); mp-gate.js v10, friends.js v72; check_site clean.
- Text: Arcade tile names the 5 areas (lb / de / en); linepack.js + bake.py display name drop a leading "0 " ("0 Lumen" -> "Lumen";
  Kronplatz's short top "Lumen" becomes "Lumen (2)"). "Boïu" (Killy) is the real OSM name, kept.
- SQL APPLIED on production: scripts/ski-v1.sql (ski_board_floors 1329 rows == floors-check, ski_time_floor, scores_guard_row with the
  ski exception) + scripts/mp-ski-v1.sql (mp_games 'ski'). No existing score changed (1259 rows, 0 ski rows at launch).
- Checks at launch: every Node check green; all 29 Chromium flows PASS (ski-mp: one mesh-link timing flake, re-run PASS);
  memory-check 1-2 marginal FAILs (Killy second visit +55 / +71 MB vs 50; 3V renderer 462 vs 450 MB once): noise, no memory code changed.
- **Owed after launch**: the WebKit flows (ski, ski-freeride, ski-webkit + the R8f after-launch list) — Playwright WebKit hangs on the Mini
  at startup (network process stuck in CoreAnalytics::Client::get(); still after Ian restarted analyticsd at ~15:35). Run them once
  WebKit starts again (a reboot cleared it this morning). The same game code passed WebKit in the final QA (13:40). Ian tests real Safari
  on the Neo.

## Resort picker redesign (22 Nov 2026, after launch; Ian: "the page where you pick the ski area is really bad")
- `pb/ski/picker.js` (ui.js `showResorts` delegates to it; main.js untouched): one card per resort with a picture the game rendered
  itself (`pb/ski/img/<rid>-640|1200.webp`, <= 80 KB each, `?v=IMG_VERSION`, srcset + lazy + fetchpriority low, fade in; a sky / snow
  gradient while loading), name + flag + places, facts (`picker-stats.js`: km of pistes, lifts, highest point; generated by
  `scripts/ski/picker_stats.py`, rerun after a rebake) and the save's progress (stars, pistes skied; read only). The current resort
  (last skied / this page's) is the big card first with «Lass fueren»; the others reload into theirs. Credits moved into «ⓘ Quellen»
  (all six terrain sources + OSM + "pictures painted in the game"). Header: «Wiel e Skigebitt», «👥 Online-Rennen».
- Layouts (ui.css `.rp-*`): iPad / laptop landscape = one screen (big card left, 2 x 2 right, pictures take the height left); tablet
  portrait = big card as a row + 2 x 2, fills the height; phone = one column, small cards as rows. Hairline ink seams, radius 0, green
  focus ring inside the card, reduced motion = no transitions. DOM order = visual order; cards stay `.resort.ready[data-id]`.
- Pictures: `shot.mjs --gpu --dpr 2 --size 1200x750 --url "/pb/ski.html?resort=<rid>&auto=1&bot=1&q=high&res=fixed&weather=sun&time=midday"
  --script <hide #ui / overlays, __ski.setCamera(pose), shoot>`, then `scripts/ski/picker_images.py rid=shot.png ...`. Poses used
  (x,z,above,tx,tz,above2,fov): killy 12300,9222,250,10017,8170,100,50 (Val d'Isère + Bellevarde); 3vallees 10407,17665,20,9072,19393,150,55
  (Val Thorens); zermatt 12300,6200,120,4568,7860,-300,45 (Matterhorn); arlberg 20336,18478,200,16879,15754,0,50 (St. Anton slopes);
  kronplatz 10246,5004,200,7929,7428,0,50 (the summit gondolas). First play unchanged (ski-ipad-start 2.81 MB to skiing).
## Launch fix: "Face (Schwaarz)" speed + low-fps clock (22 Nov 2026)
Ian (iPad 9, Safari, touch, in the Arcade): on Killy's "Face (Schwaarz)" "you can't get faster than like 32 km/h".
- **Cause (data)**: "Face (Schwaarz)" (id `face-black`) is NOT the Face de Bellevarde: it is OSM way 30721500, a 276 m LINK named "Face"
  from Fontaine Froide (s 249) onto the Face de Bellevarde (s 716), 2632 -> 2598 m (34 m drop, mean 7 deg, its middle 120 m at 2-4 deg).
  Measured (Node, the challenge physics + course nets, straight tuck): 34-38 km/h through the flat middle, 56 km/h at the very end;
  Chromium touch profile (real touch on Hocken, no steer): 22-40 km/h, tuck 1.00 / brake 0 / steer 0 / no hockey stop the whole run.
  The real Face de Bellevarde (`face-de-bellevarde`, 2.8 km, 967 m drop) tops out at 119 km/h (the cap), 94 km/h average on >= 20 deg.
  `face-2` ("Face (Schwaarz 2)", OSM way 52876769) is the same kind of link (from the Loyes Express link). Survey of every piste
  (`speed-check.mjs --survey`, tucked): blacks top median 111 km/h, p10 91; only `face-black` (56) and Arlberg's `umfahrung-schuttboden`
  (a bypass by name, 49) stay under 60. Physics, touch input, nets, snow type and the quality watchdog were all ruled out.
- **Fix (data)**: shown names by id in `common.py RESORTS.killy.names` (bake.py applies them after the colour suffix), and the same two
  strings patched into `data/killy/resort.json` (+ data-hashes.json): `face-black` = "Verbindung Fontaine Froide → Face de Bellevarde",
  `face-2` = "Verbindung → Face de Bellevarde". Ids, boards and the ski-v1.sql floors unchanged (floors-check green).
- **Fix (clock)**: main.js clamped a frame to 0.05 s and 6 physics steps, so below 20 fps the whole game ran slow (15 fps = 0.75 x real
  time, measured in Chromium with rAF capped at 15 fps: 7.6 s game per 10 s real). New `clock.js` (frameSeconds / planSteps): real time down
  to 10 fps (MAX_FRAME_S 0.1, up to 12 steps of 1/120 s a frame); at 15 fps now 18.9 s game per 19 s real, same speeds per metre.
- **Check**: `node scripts/ski/speed-check.mjs` (~40 s): Face de Bellevarde tucked 80-119 km/h + >= 80 km/h on >= 20 deg; the longest
  plain blue per resort upright p75 40-70 km/h, tucked under the cap; every black not named "Verbindung / Umfahrung ..." >= 60 km/h
  tucked; 15 fps = 60 fps speeds (+-3 %) and the clock at real time; SKI.maxSpeed == PLAY.maxRunSpeed. Before the fix: 12 FAILs.
## After launch: lift stations, every lift rideable, teleport to every lift, minimap -> map (22 Nov 2026)
Ian (iPad, Tignes, at "Leisse (Rout)"): "I can't ride the chairlift and it has no real station" (a flat black disc floating, a dark
floating box, no hut). It was the **Champagny T-bar** (Killy #80, bottom at the Grande Motte cable car's line; there is no Leisse lift
in OSM): R7-B's `pruneCrossings` cut by the ground plan only, so the cable car passing ~40 m overhead cut the T-bar's wheel mast and
hut; the bull-wheel disc (lifts.js, rope height) and the hut's window stayed, floating. The zone (3 x 1.5 m at the track start) was
there but nothing showed where it was.
- **lift-site.js pruning** (resort-generic): a part goes only where a neighbour's carrier / rider walk comes within `CUT_MARGIN` 0.5 m
  of it in HEIGHT (each relative to its own ground); a roof the neighbour's carriers graze is raised (`ROOF_RAISE` up to 2.2 m, 1.5 m
  spare each way, with its snow / drive / sign, posts and walls grow) instead of cut; a cut hut moves (across the line / back / forward,
  `relocateHut`) to a spot no other lift reaches; in a frame that lost parts nothing floats (`standingParts`: every kept part stands on
  the ground or on one that does; posts that only held a cut roof go); every bull-wheel is held (`wheelHeld`, else a steel column
  `mount`). ONE decision per resort (`pruneCache` by lift src): the first world decides (the game: the far grid, liftTreeGuard), every
  later world (lifts.js on the 5 m heights, setBuildings) repeats the same cuts / raises / moves / mounts (`cutsFrom` is a no-op now).
- **Boarding zone marked**: a yellow mat on the platform (deck, +2 cm) / two yellow poles at drag lifts and rope tows; a toast
  "<lift>: op déi giel Plaz fueren fir anzesteigen" when he stands < 18 m from a zone but not in it (freeride.js `nearZone`, host.js).
- **Every drawn lift rideable**: rope tows from 2 m rise (`MIN_RISE_DRAG`; Fontany, Replat, Balmengrat, Märchenland + 2 nursery tows
  were drawn but not rideable); OSM stubs not drawn (lift-path.js: zero length, or a chair / gondola / cable car < 100 m with < 3 m
  rise: 3V #164 58 m, Arlberg #91 0 m). Drawn = rideable: Killy 83/83, 3V 165/165, Zermatt 61/61, Arlberg 99/99, Kronplatz 27/27.
- **Teleport to every lift** (explore.js): `liftOpen` = every lift (the lift list's "Bei de Lift"), a map tap within 12 px of any lift
  line / bottom dot asks "Hei hin teleportéieren? Beim Lift X" -> its boarding zone, discovered or not (the fog stays for other places,
  "Bei den éischte Lift" stays). **Minimap** = a button "Kaart opmaachen" (tap / click / Enter -> `onAction('map')`, like M).
- Counts (`node scripts/ski/station-diag.mjs <resort> zzz`, all 5 resorts, before -> after): floating parts 448 -> 0, unheld
  bull-wheels 52 -> 0, ends missing their type's main part 70 -> 19 (all in shared stations with a neighbour's roof within 30 m:
  Olympe, Matterhorn Express, Vallugagrat, Kronplatz top ...), drawn-but-not-rideable lifts 7 -> 0 (2 stubs no longer drawn).
- Tests: round7b-test now also checks per drawn lift: rideable, no floating part, wheel held, no oversized part, the type's main parts
  (or a shared roof within 30 m), zone marked, the zone reachable over the snow (12 m clear way in): 10821 / 10821. Shots:
  `scripts/ski/launch-station-shots.mjs` (SHOT_LIFTS="index:which[:b],..."), ~/Library/Caches/ski-work/launch-lifts/. Flow ski-teleport:
  + undiscovered lift via the list / a map tap, minimap tap -> map.
- Results: Node round7b-test 10821/10821, round6-test 2222/2222 (more ridden lifts), round7-test 30, round7c-check 120, floors-check
  1324 + parks == ski-v1.sql (unchanged), security-test, look7d-check 68, r7d-test 1424, mp-race-test, harness 25/25/25/21/21: green.
  Chromium flows ski-teleport, ski-spawn, ski-freeride, ski-lift, ski-lifts-all PASS. GPU shots looked at (Champagny / Vanoise bottom +
  top + a real board -> ride -> off at the top for both; 5 formerly broken stations per resort). WebKit not run (still hangs on the Mini).
  No data / bake / SQL change. main.js?v=13, ui.css?v=12.

## After launch: the jump (22 Nov 2026; Ian, iPad: "when I jump (Sprong) it's like when I crouch")
- Cause: the pop put him 2 cm over the snow with 3.2 m/s up, and airStep landed anything within `stickGap` (6 cm) the very next step:
  the jump key only ever showed the crouch / air pose for a frame (crests still threw him, so it looked fine there). It also needed
  > 1 m/s, and a touch tap shorter than a frame could be missed.
- skier.js: the jump = `jumpWind` 0.12 s crouch (model dips fast), then the pop (`jumpPop` 4.2 m/s along the normal) at any speed;
  rising from a pop (first 0.2 s, moving away from the slope) he is never "landed"; crest take-offs unchanged. skier-model.js: legs
  stretch the first ~0.3 s after the pop. input.js: a jump press is latched (one press = one jump, even a < 1 frame tap / key tap).
- Numbers (round7-test, a 50 ms tap): off the snow 125 ms after the press; flat 0.90 m up / 0.84 s in the air (standing too), 14 deg
  0.94 m, 25 deg 1.07 m, no crash. Flow ski-teleport: a real touch tap on Sprong -> airborne 130 ms later, 0.91 m (+ the minimap tap).
- Node checks green (round6 2222, round7 38, round7b, round7c 120 incl. barriers, look7d 68 park, harness); flows ski-teleport,
  ski-park, ski-freeride PASS. main.js?v=14.

## Launch follow-up: acceleration assist + challenge launch (22 Nov 2026)
Ian: "at low speed (starting, flat bits) it's annoying, accelerate faster to at least ~45 km/h"; the start push (17 km/h) too slow;
3 Vallées "Jardin Alpin" felt like a crawl.
- **Assist** (skier.js groundStep, config SKI.assist*): +2.6 m/s2 forward (+0.9 more where gravity does not help) below 38 km/h, faded
  smoothly to 0 at 50 km/h. Downhill (>= ~1 deg) on its own; with push / tuck held (W, Hocken, gamepad) also on flats and rises (full to
  6 deg, gone at 12; the herringbone still climbs to ~20). Never braking / hockey stop / edge hold / air / lift / post-finish plough.
- **Launch** (skier.js launchState + state.kick, main.js pushStart; config COURSE.launch*): at "0" the COURSE.push kick, then the speed
  follows an S-curve to 45 km/h over 1.2 s (only what gravity does not give, <= 12 m/s2; a steep start is held at 48.6 km/h until the
  curve ends; braking ends it). Online races start through the same pushStart. The star-2 target model (challenges.js profileRide)
  includes the assist and the launch: bot / target median 0.95-1.03 per resort (3 Vallées --all: 0.97 over 472 pistes).
- **Numbers** (speed-check.mjs, tucked; before = origin/main 29c6253d via SKI_ROOT): 0 -> 45 km/h on the longest blue 2.7-4.0 s (was
  5.5-18.1); the flattest link 4.0-4.5 s tucked, 4.2-5.5 s pushed (never before); 1.5 s after "0": 45-49 km/h on all 1324 course starts
  (was 9-51); Jardin Alpin average 52 km/h / 122 s (was 36 / 174); the 20 slowest courses before averaged 9-21 km/h, now 34-56 (e.g.
  Killy mangard-blue 9.3 -> 51.3 km/h, 235 -> 43 s). Every green / blue course now averages >= 40 km/h tucked (582 of 582); 54 long ones
  still take > 2 min. Slowest left: Couloir de Petite Balme (a 50-79 deg couloir) and Arlberg ski routes that climb 20-39 deg (OSM
  routes with tours in them: Woster-Bockbachtal, Vorderes Maroital).
- r8c-check crashes on origin/main since 3513fd60 (lift-path.js createLiftPath returns null for a lift: `p.len` at r8c-check.mjs:119),
  not from this change.
## Round 8g (22 Nov 2026): a red net across the Stallmähder-Fang course (Ian, iPad, Arlberg)
**Cause**: NOT the challenge's own nets. The Kandahar is a `worldcup` landmark (landmarks.js): 3.6 m red A-nets (72 % opaque, black
poles) along both edges of the race piste wherever it is steep, drawn ALWAYS (free ride too). Every piste that crosses or joins the
Kandahar got that wall across its line: Stallmähder-Fang crosses it 3x (s ~1060, ~1480, ~2900), also Fasch, Nasserein (+red),
Hoppelweg-Variante, Gstans-Variante, Plattiwald, Skiroute Eisfall, Stallmähder-Fang Variante (9 courses). Ian stopped in front of it
and the R8b stuck timer (10 s < 1 m/s) offered "Challenge ofgebrach" with the wrong text ("ze laang nieft der Pist"); the race net was
still there in the free ride because it is a landmark. Separately the course's OWN net ribbons crossed the line in 18 courses: the
"inside of a bend" test looked only +-40 m round s, so where a line loops back or a hairpin's other leg runs alongside, one leg's net
stood across the other (Killy myrtilles / petit-col / cugnai-red, 3V retour-sud / verbindung-preyerand ..., Zermatt rotenboden,
Arlberg riffel / valfagehr / seekopf-standard / hoppelweg ..., Kronplatz pedaga).
- **Race nets** (`landmarks.js worldcupNets`, pure, 4 m steps): left open wherever a net point comes within 2.5 m of ANOTHER piste's
  corridor (line + half width, `pistes.js createLineIndex` grid) or folds back over the race piste's own snow; posts only where a net
  hangs. The start hut + banner are left out where another piste runs through them (`worldcupHouseClear`: Fasch and the Kapall route
  pass the Kandahar's top). Look: a see-through red mesh (`netmesh.js createNetMaterial`: canvas diamonds, transparent, 1 draw call
  + the instanced poles), not a coloured wall.
- **Course nets** (`course.js courseLayout`): a net point is cut when it lies within half width + 0.2 m of ANY part of the course line
  (gate -> ZIL, `createLineIndex`), the corner fill too (recorded in openAt: no soft wall there either); a house / station hall opening
  reaches 12 m further both ways (`INTRUDE_PAD`: the scripted skier went round Killy joseray's hotel and came back in through the net).
  Look: see-through orange mesh with the white top edge (same material maker). Still 2 draw calls (posts + ribbon).
- **No jump through the net**: `collide` no longer lets a jump clear it (was: any air > 0.25 s; a hop off a bump at the edge flew the
  skier out of the course and he skied back in through the net further down: Killy couloir-de-la-table-d-orient, Arlberg
  schweinstroge, Zermatt verbindung-sessellift-bontad). In the air the net turns him back along the course like on the ground.
- **Timers**: the stuck timer moved from main.js into `createCourse.update` (shared with the Node rides): `COURSE.stuckAfter` 10 s
  standing (< 1 m/s, no crash) WITHOUT 1 m of progress down the course; `out.why` 'off' | 'stuck'; the abort card says which
  ("Du bass ze laang op der X stoe bliwwen." vs "... nieft der Pist gefuer."). A timer never runs out while he gets anywhere.
- **Start gate** (`clear.js courseGate`, `obs.heightAt`): no gate beside the line more than 1.5 m below it, no gate with the line 15 m
  ahead > 1 m above it (Zermatt furggsattel: the gate stood 21 m beside and 23 m below the line, every try ended stuck at the start).
- **Lifetime**: `endCourse` also disposes the course's run props (START arch, slalom gates). After a finish and after an abort ->
  Weider fräi fueren nothing named `ski-course-*` / `ski-run` is in the scene (flow ski-course + r8g-net-shots check it).
- **New check** `node scripts/ski/barrier-check.mjs [rid] [--list]`: every course (1324: 234 / 472 / 194 / 353 / 71, Sonnenkopf is in
  arlberg) against its own nets AND the resort's race nets: no barrier segment crosses or comes within 2 m of the line gate -> ZIL;
  the corridor across the line (every 2 m) >= 6 m; race start hut only where no piste runs. BEFORE: 27 courses crossed (18 by their
  own nets, 9 by the Kandahar's), 1 corridor < 6 m (myrtilles 3.6 m). AFTER: 0 / 0 (nearest net 6.5 m from a line, narrowest 13 m).
- **round7c-check --rides** now also: every ride's path vs every net segment (course + race; a jump > 1.1 m over one counted apart),
  the course timers (off-course or standing-with-progress = fault; a stall = no 1 m of progress in 10 s is listed as `info`).
  BEFORE (old course/landmark code): 29 of 1324 rides passed through a net (5 / 4 / 3 / 17 / 0). AFTER: 0 through a net, 0 timeouts,
  1324/1324 finished; 5 stalls listed as info (the scripted skier stood 10 s without progress, so the "stoe bliwwen" choice would come
  up): Killy vallee-perdue s 1931 (the OSM line climbs a 15 m DEM hump, the natural way is the gully just outside the net) and
  aiguille-percee s 191 (a ridge across the line), 3V folyeres-variante-blue s 200 (pinned by a house), Arlberg furmesle s 2007 and
  waldschneise s 2341. Not fixed here: 88 courses have a line that climbs > 3 m somewhere; the rides carry speed over all but these.
- Results (22 Nov): barrier-check 11/0, round7c-check --rides 140/0, round7b-test 10821, round7-test 30, round6-test 2222,
  floors-check 1324 + parks == ski-v1.sql (unchanged, no SQL), security-test, speed-check 52/0. Chromium flows ski-course (x2, +
  nothing left after the abort / at every finish), ski-challenges, ski-freeride, ski: PASS. WebKit not run.
- Shots: ~/Library/Caches/ski-work/r8g/{before,after}/<rid>-<piste>-{close,high}.png (`scripts/ski/r8g-net-shots.mjs` via shot.mjs
  --script; before = a copy of origin/main served with --root). main.js?v=16.
## After launch: boarding a chairlift like a real one (22 Nov 2026; Ian at 3V Tovets: "through the barrier, scooped abruptly")
- Before: the walk from the zone went straight through the fence (a full-width bar at 1.05 m), he waited on the line and the chair
  swung in at line speed (5 m/s) and he lerped onto it.
- lift-site.js `site.chair` (bottom frame): a fence with a 1.5 m GATE (two leaves, `gateLeaf`, drawn by lifts.js as one instanced
  mesh and swung open by `lifts.setGate(index, 0..1)` from main.js stepRide); detachable chairs (>= 4 seats) a LOADING BELT
  (`belt` deck part, drawn with the carpets' running texture, cleats towards the line) from the gate to past the loading line; his
  spot across the lane = his seat's. The chair zone is centred on the gate. A moved hut never lands on the zone / the way in.
- liftride.js `chairPlan` (chairs only): his chair = the next one that can reach the line once he is there (else the one after); he
  waits behind the closed gate, it opens (0.45 s) in time, he skates through into the lane (turning up the line), the belt carries
  him (1.4 m/s) to the loading line (fixed-grip: a step), he stands, the chair comes up BEHIND him at the station crawl (2.0 / 2.6 m/s
  for the last 1.6 s, a 1 s ramp; the whole lift's chairs follow the held one as before), he sits in 0.5 s as it arrives, then it
  speeds up over 1.6 s to the ride speed (`rideSeconds` counts that). The gate closes behind him. Boarding camera: on the platform
  beside the lane, ahead of him, the first spot with no station post within 1.1 m of the sight lines (else the camera guard pulls it
  onto his head); it eases into the ride camera (main.js: no cut for chairs). One tap = one boarding, zone rule and exits unchanged.
- round7b-test per chair (all resorts): boarded through the plan, belt there (4+ seats), both gate leaves there, through the gate only
  while it is >= 95 % open, the chair never in front of / through him in the lane before he sits, sit within 0.3 s of the chair's
  arrival: 11791 / 11791. Shots `scripts/ski/chair-board-shots.mjs` (SHOT_LIFT, SHOT_CAM side | ride; works on the old build via
  shot.mjs --root for before / after): ~/Library/Caches/ski-work/launch-lifts/chair/ (before / after / ridecam / fixed sheets).
- r8c-check skips lifts the game does not draw (lift-path.js stubs: it crashed on them since 3513fd60). main.js?v=17.

## Map clarity (22 Nov 2026): the big map opens on you, what you can ride stays vivid, tap cards, overview inset
Ian (iPad landscape): "when you open the map you're a bit lost". What was confusing (before shots, Killy / Zermatt / Kronplatz):
the map opened centred on the auto-picked lift (pickLift -> focusBox) or the first piste (selectPiste centre), not on the skier; the
skier was a small green dot (green = green pistes, "Du" under labels), no view direction; the discovery fog was drawn OVER the
pistes and lifts, so ~99 % of every resort was pastel and nothing read as rideable; lifts = thin black lines like black pistes, no
names; piste labels at a fixed 45 % point overlapped ("Sonne (Rout)" / "Sonne (Blo)") and ran off screen; the picked lift was a red
line + red dot (louder than you, red = red piste); legend only the 4 colours; no scale, no north, no overview; pinch zoomed round
the canvas centre; a tap on a piste in the free ride tab only asked to teleport (no name / length / drop).
- `map.js` (rewritten draw): fog UNDER the pistes / lifts (veils the terrain only); pistes thicker (2.2-6.5 px by zoom); lifts black
  over a white casing, white bottom / black top station dots, names in black pills; labels placed by tier without overlaps (villages,
  park, lifts + pistes nearest the skier first, landmarks, peaks; connectors / variants only zoomed in; zoomed out only pistes >= 1.5 km;
  never under the buttons / legend / inset / card / scale bar); "you": orange arrow (#ff6a00, no piste colour) in a white ring, view
  cone, "Du" pill, a CSS pulse (3x, `.mappulse`), an edge arrow when off screen; picked lift = yellow glow. Opens over a free ride
  centred on the skier, 3 km across (`setPlayer(x, z, heading)`, recentring held until the opening task ends; a lift picked ON the map
  never moves the view). Smooth +/- (rAF, log-space zoom), pinch round the fingers' middle (+ pan), wheel round the pointer, ◎ back to
  me (`#mapMe`), ⤢ whole area (`#mapFit`), overview inset `.mapov` (whole resort + view frame + me; tap / drag = look there; hidden
  when the map box < 560 px wide, e.g. iPad portrait), scale bar + north. `dispose()` on `ski-map-close` (ui.js close) / disconnect.
- `explore.js`: the tap card `#mapCard` (top centre): piste / lift info (`pisteInfo` / `liftInfo`: colour or kind, length, drop / rise,
  heights) above the unchanged `#tpConfirm` question; on the fog a piste's card says "Nach net entdeckt" (toast + dataset as before).
  A tap on a lift in the free ride tab now picks it in the list AND shows the card (map.js passes the lift: `tapWorld(x, z, lift)`).
- `ui.js` / `ui.css`: legend 2 rows (colours; Lift, Snowpark, Du, Nach net entdeckt), ◎ / ⤢ buttons, toast at the bottom centre.
- Minimap (light, Ian: "basically good"): view cone, the piste you are on thicker (host.js passes `game.run.piste`), the nearest lift's
  name (<= 450 m), lift casing + station dots, arrow orange (the red arrow vanished on red pistes).
- **2D, no 3D relief**: the confusion came from the open position, the fog over the pistes, the weak marker and the labels, all fixed
  in 2D; a tilted 3D view hides pistes behind ridges, needs labels / taps re-projected, and costs a second GPU context or the game
  renderer's tiles on the iPad. The painted base already carries the relief shading; the inset gives the whole-resort context.
- Tools: `scripts/ski/map-shots.mjs` (HUD, minimap, map open, piste / lift tap, zoomed out; `--tag`, `--size 820x1180`),
  `scripts/ski/map-memory.mjs` (map open / close x10 with pan / zoom / ◎ / ⤢ / tap: heap, DOM nodes, listeners after GC).
  Shots: ~/Library/Caches/ski-work/map-ui/<resort>-{before,after}-*.png. main.js?v=18, ui.css?v=13.
- Checks: map-memory (Killy, open / close x10): heap +0.75 MB, DOM nodes +0, listeners +0, 0 page errors. Chromium flows PASS:
  ski, ski-teleport, ski-freeride, ski-spawn (+ challenges, park, lift, skis, lifts-all, webkit-in-Chromium, look7d, mp-freeride,
  firstperson, avalanche). WebKit not run (hangs on the Mini).


## After launch: camera from above + physics / input review (22 Nov 2026; Ian, iPad: "the camera should be more from ABOVE and less straight from behind")
- **Camera** (camera.js, config CAMERA): higher at every speed (followHeight 2.3 -> 3.4, heightGain from the first metres, riseUp 2.4), the
  height also follows the snow rising behind him on a slope (`slopeGain` 0.5: it used to sink to ~1 m over the snow behind him on a steep
  black), looks 8 m ahead, the horizon is kept inside the picture (`horizonMargin`), a crest between camera and skier lifts the camera
  (eased) instead of snapping the boom in, all easings are exp (15 fps = 60 fps). Lift views, first person, station framing unchanged.
  Numbers (camera-check --table, before -> after): cruising 43-72 km/h pitch 17 -> 26 deg down, 4.4 -> 7.3 m over the skier, 2.9 -> 5.7 m
  over its own snow, view meets the snow at 6 -> 15 deg; >= 94 km/h 27 -> 33 deg, 7.2 -> 10.3 m; walking pace 2.5 -> 4.3 m over him.
  Sheets (GPU, iPad 1180 x 820 + portrait): `~/Library/Caches/ski-work/fable-review/sheet-camera-1..5.jpg`.
- **Checks**: `node scripts/ski/camera-check.mjs [--table]` (pitch / height / distance bands by speed, horizon + skier in the picture,
  portrait, never in the snow, turn smoothness, 15 fps); `scripts/ski/camera-shots.mjs OUT [--old DIR]` (browser: 12 scripted scenes,
  shots + per-frame `camBlocked` at the camera: 0 frames inside a tree / house / pylon) + `camera_sheet.py`.
- **Physics review** (numbers: `physics-probe.mjs` ideal planes, `ride-probe.mjs` real pistes). Changed: (1) plain airs: the skis stop
  turning 1.15 rad off the flight line (steer held >= 1.3 s in an air ended in the "sideways" fall); (2) touch pad: 5 px rest zone +
  slightly finer middle (`input.js touchSteer`; it was linear from pixel 1, a drifting thumb turned him). `review-check.mjs`.
  NOT changed (recommendations for Ian to decide, see the report in the commit message / coordinator notes):
  crests give no air (airStep lands anything within stickGap again: a 12 -> 30 deg break holds him down to 110 km/h; a 3-line fix exists
  = 11-15 airs up to 1.4 s on the Face tucked, but he then flies out of bends: needs air control or a play test first); carving costs
  ~15 % speed per 90 deg even inside the grip (edgeLock lag is taxed by skidLoss); full steer always over-rotates 10 % (carveGain 1.1:
  slip grows to ~20 deg, 30 % speed per 90 deg); deep snow below ~10 deg is a slog (18 km/h); trunk >= 18 km/h = fall.
- r8c-check: skips OSM lift stubs that are not drawn (it crashed on `createLiftPath` null since the stations commit; fixed upstream too). main.js?v=19.

## Physics round 2 (22 Nov 2026; Ian said yes to the three recommendations of the review above)
- **Crest airs** (skier.js airStep, config `crestLeave` 0.3 m/s): after a take-off he stays in the air while he still moves away from
  the slope (the old check landed anything within `stickGap` the next step: 0.01 s "airs"). On the piste only where the piste goes on
  straight ahead (groomed snow 0.5 s and 1 s down the flight line: a path across a hillside / a bend with a crest keeps him down);
  off the piste every crest counts. **Air control**: `airSteer` 0.6 rad/s bends the flight line (speed kept); **piste magnet**
  `airMagnet` 0.5 rad/s towards the groomed side when the flight would end beside the piste. **Landings**: a normal air (<= `softAir`
  2.6 s) falls only above `softLanding` 16.5 m/s into the snow (crests throw him into run-outs / counter-slopes at 11-16 m/s); a longer
  fall (cliffs) keeps `hardLanding` 10.5. The 33 m/s cap now also holds in the air. Sprong pop and the park (tricks) unchanged.
- **Carving**: `carveGain` 1.1 -> 1.0 (full steer = the grip limit, slip no longer grows to ~21 deg), `carveFree` 0.03 (only slip
  beyond ~1.7 deg scrubs; fades out with the brake / hockey stop). A clean 90 deg turn keeps 91-98 % of a straight line's speed
  (was ~81-84 %); plough / hockey distances unchanged (56 / 32 m from 90 km/h on 12 deg).
- **Deep snow**: nothing changed: the acceleration assist already lifts 8 deg deep snow from 18 to 43 km/h tucked (15 deg 46, 25 deg
  56 and 35 deg 68 as before); review-check holds the band.
- **Measured** (`ride-probe.mjs <resort> --json` / `--compare`, 93 rides: per resort 3 longest reds, 2 longest blacks, the longest blue,
  + the Face; line upright / line tucked / S tucked; `~/Library/Caches/ski-work/fable-review/rides-compare.txt`): airs > 0.15 s per ride
  0.9 -> 9.3; Face de Bellevarde upright 2 -> 8 airs (longest 1.15 s), tucked 0 -> 11 (1.33 s), S tucked 4 -> 16 (1.49 s); rides 9.4 s
  faster on average; off the groomed <= 0.9 s in every ride. 84 rides outside three cliff routes: 0 crashes, 0 lose time, longest air
  2.1 s. Killy col-pers (crashed before too: 4-6 s falls, 27-53 m), Arlberg woster-bockbachtal and kuhtali (ski routes, 2.4-3.1 s
  falls of 6-16 m): 6 rides with 1-2 landing crashes; col-pers S tucked 23 s slower (2 crashes).
- **Stars**: the target model (challenges.js, 1D profile ride + 10 %) is untouched; the careful bot vs target stays in band (harness).
  Runs get ~3-4 % faster, so targets are a little easier, never harder. Floors / 33 m/s cap unchanged (floors-check green).
- **Checks**: review-check.mjs 37 (crest / roller / slow / run-out landing / cliff / magnet / air control / carving / braking / deep
  snow / touch); speed-check: its rider now brakes for a hairpin (line > 0.9 rad off the skis at > 43 km/h, not in the launch): with
  cheap carving he no longer scrubs enough to make Arlberg's Hoppelweg hairpin and left down the neighbouring piste. `ride-trace.mjs
  <resort> <piste> [tuck]` shows where a ride loses time. main.js?v=20.

## After launch: the other skiers, "Aner Skifuerer" (23 Nov 2026; Ian: "you're not alone in the whole ski area")
- **npc.js** (pure; the Node check runs the same code): a population per piste (`NPC.perMetre` by colour x the day's share
  `dayShare(hour)`, or morning 0.7 / midday 1 / evening 0.4 for a fixed time), each skier deterministic from (seed = strHash(rid),
  piste id, i): skill (beginner in the plough on the greens, skidded turns, carvers, a few tucking), base speed, lane, turn width /
  length, a stop at the side of the piste (35 %, 5-16 s, turned across the fall line), a rest after the bottom (15-70 s, not drawn).
  Where he is at time t is ANALYTIC: a speed profile per piste (20 m samples, slower on flats, faster on steeps) and its inverse, so
  the candidates cost a lookup. Every 0.3 s the nearest (in front of the camera first) up to the level's cap are listed; listed ones
  get a little state: `av` (giving way sideways, eased), `lag` (slowed when the player blocks), the side of a house they pass on.
  **Clear bands**: across every piste every 3 m (built on demand, <= 64 a frame) the stretches clear of trees, station parts, pylons,
  houses (the drawn ones), the Kandahar race nets and every station footprint (decks, gates, belts, zones), each point tested with the
  body + half a step; a listed skier's own spot is tested too where a band is not clear all the way. **Queues**: 2-8 per bottom station
  (by kind) behind / beside the boarding zone (never in it, the gate, the belt or the carriers' lane), standing, stepping aside when
  the player comes. **Walkers**: on the village streets near places (skis on the shoulder), only on lanes clear of houses at every metre.
  **Riders**: `riders(lift, carrier id)` deterministic per carrier (chairs 0.55 occupied, 1..seats seated; cabins 1-4 / funitels -7 /
  cable cars 4-12 / trains 3-9 standing; drag lifts 1); lifts.js reports every carrier on its way up with `carrierId(u, A, gap)`
  (its lattice slot: constant from the bottom to the top, also while the player's own carrier leads: `heldShift`); the player's carrier
  never has others in it. **Never**: two closer than their bodies (pairs pushed apart), inside the player (they step out; `collide()`
  bumps the player out of them: a soft bump, most of the speed into them taken out, never a crash, no toast), in a running challenge's
  corridor (`corridorOf`: line + half width + 12 m; that piste's own population off; checked after giving way), in the park mode or an
  online race (on in the online free ride). Menu: "Aner Skifuerer: Un / Aus" (`pb_ski_npcs`, default on; `?npcs=0|1`).
- **npc-view.js**: NOT skinned meshes: two InstancedMeshes (near = skier-model.js at the new `detail: 'mid'`, 1828 triangles; crowd =
  `detail: 'low'`, 437 triangles); 11 poses (ski, carve L / R, tuck, plough, stand, sit, cabin, two walking steps, drag) baked from
  skier-model.js pose() into a float texture, the vertex shader blends two per instance (aPose) and paints the outfit's colours (OUTFITS)
  into the slots (uniform palette). 2 draw calls whatever the crowd (+ the shadow pass: near on Mëttel / Héich, crowd on Héich). Grow in /
  shrink out (0.25 s) within 110 m, never inside a challenge's corridor. Caps per level `config.js NPC.levels` (Niddreg 18 skiers + 6
  queue + 3 walkers + 22 riders within 380 m, 3 near; Mëttel 32 / 10 / 5 / 48; Héich 48 / 14 / 8 / 84).
- skier-model.js `detail` ('full' default: unchanged); lifts.js `setRiderSink`, carrier ids; main.js `npcFrame`, `crowd.collide` in the
  step loop; ui.js menu row. main.js?v=21.
- Checks: `node scripts/ski/npc-check.mjs [rid] [--level]` (every resort, 10 spots x 20 s with a player skiing: on the piste, never in
  a house / station / pylon / tree / net / zone / footprint, no overlap, nobody inside the player, carrier ids round the loop, riders
  seated / deterministic, seed determinism, a challenge's corridor empty, ms per frame); flow `ski-npc` (Niddreg Killy spawn: counts,
  calls on / off <= 160 / +3, triangles <= 450k, CPU x4 update + draw <= 1 ms, the menu switch remembered, nobody in a running
  challenge's corridor). Shots: `scripts/ski/npc-shots.mjs OUT --resorts a,b --q low|medium --dpr 2` (village, piste, station, chair).
- **Numbers** (GPU shots, Chromium 1180 x 820, `npc-shots.mjs`, off -> on at the same spot): Niddreg 3V Courchevel village 126 -> 128
  calls, 380k -> 401k triangles; Zermatt village 124 -> 126 / 320k -> 330k; Arlberg 130 -> 132 / 343k -> 356k; Killy spawn (flow)
  133 -> 135 / 370k -> 388k; stations / chair rides +2 calls, +5-20k. Mëttel: Killy village 146 -> 148 / 430k -> 453k, 3V Courchevel
  158 -> 160 / 544k -> 582k (Mëttel has no 450k budget; its +1-3 calls). CPU x4 (flow ski-npc, Niddreg): update + draw 0.74 ms a frame
  mean (p90 1.2 ms); Node unthrottled Héich 0.23-0.33 ms. Shots: ~/Library/Caches/ski-work/npc/{v1,v2-low,v3}/.
- ski-mp-freeride fails "emma's states reach the host at 7-8 / s (>= 9)" on the Mini today WITH THE OTHER SKIERS OFF too (pb_ski_npcs=0
  in all three pages): a load / timing matter of that flow, not this change. ski-mp passed on a re-run (relay pairing flake).
- memory-check (Niddreg, all resorts, tour 18, 10 switches, 3 pages): switch growth green (+45 / +21 / -27 / -4 / +31 MB), 3 pages
  2129 MB <= 2200; "after load" renderer 3V 482 / Arlberg 462 MB > 450 FAIL — the same with the other skiers OFF (3V 473-481, Arlberg
  448-465 in two runs): the baseline on today's main, not this change (the figures + pose textures are < 2 MB).

## Cleanup round (23 Nov 2026): memory, online send rate, cliff landings, the others ahead
**Memory** (`scripts/ski/memory-check.mjs`, Chromium 1180 x 820 @2, q=low, renderer MB "after load"). Bisecting the commits since
R8f (2ef5ff94 -> 917a94ba, 3 Vallées + Arlberg at each) showed NO single feature: the same commit measured 405-476 MB (3V) in
consecutive runs, R8f itself 435-438 MB today (its 401 was a lucky run). The spread came from GARBAGE: the renderer footprint is the
JS heap's peak + the ArrayBuffers not yet swept when it is read. Measured with CDP sampling-heap profiles including collected objects
(allocation per frame), memory-infra dumps (per allocator) and a typed-array tracer (who allocates the big buffers, which stay alive).
Culprits and fixes (all resort-generic, no feature removed):
- **main.js stationFrame** (R8e station framing): standing in a station it re-ran its whole search EVERY frame (16 spots x 28 rays x ~50
  steps) because it compared the CAMERA spot (`frameAt.x`) with the skier instead of the searched-from spot (`sx`), and a search that
  found nothing was not remembered. With lift-site.js `near()` building a Set per call: **270 MB/s of garbage at every spawn** (8 MB a
  frame; the heap climbed to 300-360 MB between collections, the page ran at ~33 fps on the Mini). Now once per spot (0.5 m) and every
  `FRAME_REFRESH` 1 s, found or not: 270 -> 39 MB/s, 268 -> 482 frames in 8 s (R8f had the same bug).
- **lift-site.js near()**: no Set: a disc inside one 60 m cell returns that cell's list, else an array deduplicated by a per-call stamp.
- **surface.js** block LRU: the last block is returned without the delete + set touch (0.5 MB/frame of Map churn).
- **main.js pictureColours** (the WebKit picture check): `drawImage(WebGL canvas)` made the canvas keep a full-size 2D snapshot for
  the page's life: **13.7 MB** in the renderer (memory-infra `canvas/ResourceProvider`). Now 12 one-pixel `readPixels` rows x 48 samples
  right after the render (same verdict: distinct colours).
- **props.js createPoles**: pole positions / colours and the net candidates in typed arrays (were plain arrays of numbers + colour
  names + 7-element arrays: ~18 MB of JS heap at 3V); the shear Matrix4 no longer allocated per net panel.
- **npc.js**: the full segment index over every piste (`createLineIndex(pistes.list, 100)`, ~4.5 MB heap) only answered "which pistes
  are near": now `pisteGrid` (120 m cells -> pistes) + `pistesNear`. **modes/clear.js setPistes**: segments in one Float64Array + ids
  (were [x, z, x, z, id] arrays, ~4.5 MB; Float64 so the course gates stay exactly where they were).
- **codec.js decodeGrid**: a scratch Int32Array for tile-sized grids (each tile left 260 KB of garbage: ~43 MB per load).
- **village.js writer finish()**: subarray views, not copies (the meshes are gpuOnly: the arrays go after the upload anyway).
- **props.js sign atlas**: 64 slots (2048 x 384, was 128 / 2048 x 768 = 6 MB canvas + texture): the most boards within SIGN.radius of
  ANY point (100 m grid) of the five resorts is 41 (Arlberg); r7d-test checks the grid now and keeps 25 % spare.
Numbers (renderer MB after load; before = origin/main 917a94ba today, after = this round, two runs where noted):
| resort | before | after (3 runs) |
| killy | 358 | 316-324 |
| 3vallees | 469 (spikes to 476-482) | 381-390 |
| zermatt | 378 | 332-338 |
| arlberg | 459-466 | 398-411 |
| kronplatz | 349 | 304-308 |
JS heap live after load (gc each 400 ms) Arlberg v8 39 -> 32 MB; renderer `canvas` 25.3 -> 9.1 MB. Final memory-check all green:
tours <= 365 MB; 10 switches within -7..+43 MB of the first visit (a page reached by location.replace reads higher: Arlberg 432-434,
3V 394-409); 3 Killy pages 1781 MB tree (was 2129). Tools used (scratch, not in the repo): CDP sampling-heap profile with collected
objects, memory-infra dumps, a typed-array tracer with WeakRefs.
**Online free ride send rate** (flow ski-mp-freeride "7-8 / s"): two causes. (1) The send was frame-tied: `now - lastSend >= period`
with `lastSend = now` sent every 3rd frame whenever two 30 fps frames came < 64.7 ms apart (FLOW_POWER caps at 30 fps; 8-13 / s).
Now `net/wire.js sendSlot` on the wall clock (the next slot is due one period after the last SLOT, catch-up at most half a slot): 15 / s
at any frame rate >= 15 (r7d-test simulates 60 / 30 / 24 / 20 / 16 fps with jitter); the online race uses it too (12 / s). (2) The
flow averaged emma's whole buffer, and she comes to a halt ~0.6 s into the window (speeds 5-6 m/s then 0): standing sends 4 / s by
design. Now the flow measures the host's buffer over the stretch she moved (15.3 / s) and emma's own sends per second of her moving
time (`__skiMp.info().movingSends / movingMs`).
**Cliff landings** (Killy col-pers, Arlberg woster-bockbachtal / kuhtali: ski routes over DEM rock bands and steep pitches onto
run-outs: 1.5-6 s falls of 13-38 m). Decision: crashing there stays (a 20 m drop onto the flat is a fall), but it is QUICK: a landing
crash tumbles `SKI.landingCrashSeconds` 1.1 s (others 1.6), the respawn is on the line WHERE HE LANDED (game.js `respawnPoint({ landed,
slopeAt })`, moved down the line off any wall > 45 deg, <= 40 m; the old one was 10 m behind the furthest point = back on top of the
drop) and he skis on at `SKI.respawnRoll` 6 m/s (skier.js `rollOn`). Free ride: where he came to rest (not the safe spot above the
cliff), unless that is a > 45 deg wall. Not in the park (tricks keep their own crash). Rerouting the lines was not done: the OSM routes
are where people ski, the drops come from the 5 m DEM, a reroute would change courses / floors. `node scripts/ski/cliff-check.mjs`:
a crash costs 2.5-3.8 s before -> 1.1 s now, never the same cliff twice, all 9 rides finish.
**The others ahead** (`scripts/ski/npc-ahead-shots.mjs`, FLOW_FULL, GPU, dpr 2, Héich, 3V Boulevard du France with the bot): the
figures are steady between frames (no shimmer: they are real meshes, 1/30 s bursts compared), the orange edge nets too. 19-24 others in
the picture, 5-6 within 150 m ahead. A 1.35 x density raised that to only 6 and cost the ski-npc CPU budget (1.3 ms > 1 ms at CPU x4):
reverted, the population is cap- and CPU-bound. Shots ~/Library/Caches/ski-work/cleanup/npc-ahead-{before,after}/.
**Pre-existing, not from this round**: round7c-check --rides fails 3 on origin/main too (Killy joseray passes a net at s 1501 round the
hotel; Zermatt stafelalp does not reach the ZIL, s 5704 / 5771).
**Checks (23 Nov)**: Node round6 2222, round7 38, round7b 11791, round7c --rides 137/3 (the 3 pre-existing above), r8c 36302, speed-check
94, review-check 37, camera-check 15, barrier-check 11, npc-check 79, floors-check 1324 + parks (unchanged), security-test, r7d-test 1432,
look7d 68, cliff-check 9/9. Chromium flows (FLOW_POWER): ski, ski-freeride, ski-mp, ski-npc, ski-course, ski-ipad-start PASS;
ski-mp-freeride PASS 3 x in a row (emma sends 14.7-15.3 / s, the host gets 14.8-15.1 / s, 121-186 ms behind). WebKit (FLOWS=ski-webkit)
still hangs at startup on the Mini (Playwright.app 0 % CPU in mach_msg for 6 min, killed). main.js?v=22.

## Course rides regression (23 Nov 2026): Killy joseray through a net, Zermatt stafelalp never at the ZIL
`round7c-check --rides` failed 3 on origin/main (joseray through a net at s 1501; stafelalp not finished at s 5704 / 5771 + its HUD).
**Culprit**: not physics round 2 / the other skiers / the cleanup. Bisect (Node, the two rides): e7462969 (R8g nets) ITSELF fails on
main; with 36f8a483 + d8efc1d6 reverted on top of it the two ride clean. R8g was measured on a base without the **acceleration assist**
(d8efc1d6, + the challenge launch 36f8a483 on it) and landed after them. The assist keeps the scripted skier at 40-50 km/h where he
used to crawl: (1) joseray's line runs through a 33 x 31 m hotel; he went round it on the outside of the net line (the gap is open
there), swung back in 7 m below the gap's end (INTRUDE_PAD 12 m) and passed through the net (outside the net there is no wall: "he may
ski back in", R7-C2). Physics round 2 makes it worse (with the assist off it still crossed at s 1495, 7 m/s). (2) stafelalp's last 80 m
run through a 2-4 m alley between Zermatt houses: he reached it at 13 m/s with full steer, hit a house above `hitCrash` 5 m/s, and after
every respawn the assist pushed him into the same house at 5.6-8 m/s (a crash loop until the ride limit). Not airs: nets already
turn him back in the air (R8g), now checked.
- **bot.js careful player**: `blocked` given (round7c rides, main.js `?bot=1`, flows), a station / house on the line within his look-ahead
  + 30 m, or while he aims beside the line round one: speed limit 6 m/s (22 km/h, a touch of a wall is a bump). joseray: round the
  hotel at 6 m/s, back in at s 1484 inside the gap; stafelalp: through the alley at 6 m/s (one 3.6 m/s touch, no crash). The star
  harness (harness.js, no `blocked`) is unchanged.
- **course.js gap below a house** `INTRUDE_PAD_AFTER` 24 m (above it 12 as before): a PLAYER at the assist's 45 km/h who goes round
  the hotel finds the gap open where he swings back in (the OLD bot at 11-13 m/s now rides joseray clean too). Edges left open
  2.2 / 3.0 / 2.0 / 2.7 / 1.6 % -> 2.4 / 3.2 / 2.3 / 2.9 / 1.8 %.
- **round7c-check** new: the 54 km/h net-aimed skiers again IN THE AIR (0.6 m up, rising 2.5 m/s): 534/534 held inside.
- Results (23 Nov): round7c --rides 145/0 (1324/1324 finished, 0 through a net, 0 timeouts; stalls info: Killy vallee-perdue +
  aiguille-percee as in R8g), barrier-check 11, speed-check 94, review-check 37, cliff-check 9/9, camera-check 15, npc-check 79,
  floors-check 1324 + parks (unchanged), round6 2222, round7 38, round7b 11791, r8c 36302, r7d 1432, security-test. Chromium flows
  (FLOW_POWER) ski-course, ski-challenges, ski-freeride PASS. WebKit not run. main.js?v=23.

## First person: the skis pointed out of the turn (Ian, 23 Nov 2026: "D: the skis point left, you go right")
**Cause** (measured, scripts/ski/fp-steer-check.mjs): the yaw was right (tips 5 degrees towards the turn), but (1) the camera rolled
8 degrees into the turn round the EYES, which stayed over the skis: the picture turned the skis 8 degrees to the outside (net 4 degrees the
wrong way at 46 km/h, 98-100 % of the frames); (2) the edge roll had the wrong sign (`rotateX(-edge)`: the outside edges, third person
`+edge`), and the pair rolled as one mesh, one ski in the snow.
**Fix** (firstperson.js, FIRST_PERSON in config.js): the body leans round the boots (the head goes to the inside with the roll, `headIn`),
each ski is its own mesh rolled `+edge * skiRoll` onto its edge and lifted by the sunken half width, the skis lie on the slope with exactly
the heading's azimuth, the eyes follow the skis at `yawRate` and look a little along the motion (`motionLook`, at most `motionMax`).
**Check**: fp-steer-check (real D / A keys, both cameras; carve, fast, skid, pivot, walking pace, reversal, hockey stop): 156 ok; the old
files (`--old DIR`) fail 40. Shots ~/Library/Caches/ski-work/fp-steer/{before,after}-*.png. main.js?v=24.

## Via Lattea (23 Nov 2026): a sixth resort (Sestriere, Sauze d'Oulx, Sansicario, Cesana, Claviere + Montgenèvre)
`vialattea`: the Italian Vialattea network + Montgenèvre (FR) over the border, one connected lift network. Box 21.8 x 19.2 km (17 x 15
tiles, 112 shipped), frame ETRS89 / UTM 32N (EPSG:25832), 315 pistes / 254 km of runs (282 km of lines), 84 lifts, start piste Kandahar Nasi,
first lift `Sestriere - Fraiteve 1` (`config.js FIRST_LIFT`), snowpark Montgenèvre (OSM), 7.1 MB.
- **Heights** (`dem_merge.py`, new sources): `piemonte-dtm` = Regione Piemonte "Ripresa aerea ICE 2009-2011 DTM 5 m" (lidar, CC BY 4.0), WCS
  1.0.0 of geomap.reteunitaria.piemonte.it (`wcs_ice_2009_2011_dtm`, coverage DTM, EPSG:32632, float TIFF, nodata -99) asked chunk by chunk
  on the frame grid; `ign-rgealti` for frames that are NOT Lambert-93 (a BIL chunk in EPSG:2154 resampled onto the frame); `copernicus-glo30`
  base. Priority Piemonte > IGN > GLO-30, merged with the round 2A offset + 260 m feather (`merge_sources`): the Piemonte edge (the border)
  has a lower laplacian than elsewhere (p99 2.1 vs 3.8), no seam. Cached raw chunks are named by absolute origin (a bigger box keeps them).
  `fetch_dem.py vialattea` picks the merged path because the resort lists `piemonte-dtm`. `ign_east` skips IGN requests deep in Italy.
- **OSM**: the normal Overpass queries timed out (HTTP 502 / 504 all afternoon): the layers were fetched in 2 x 2 sub-boxes from
  overpass-api.de and overpass.openstreetmap.fr (`scratch` tool, not in the repo), same layer files in `data-round/vialattea/osm/`.
  Lifts / pistes closed in their NAME only ("(fermé)", "in disuso", "pista nera abbandono", "ex pista ...") are dropped (`CLOSED_NAME`,
  bake.py). Bardonecchia (`exclude`) and Pragelato's own disused area drop out (tidy_network); the Pattemouche - Anfiteatro cable car stays.
  Buildings: `"buildings": "villages"` (only the listed villages + near pistes), no house from an OSM footprint > 280 m long (Cesana Pariol bob track).
  **Piste names**: 62 piste lines carry their number ("81 bassa", "72 media", "25", "51") only as `ref`: `"ref_names": True` (bake.py) makes
  it the name (first bake: shown as "Verbindung -> ...", 88 nameless links; now 52). Every named OSM line inside the box is a run, except
  closed ones and six stubs under 120 m / 12 m drop (27 bis, 90 bassa, Puffi alta, Minisportinia dx / sx, 3 Fourneous: drawn, no run).
  Official names (montgenevre.com status pages, NOT vialattea.it: it answers 403; no list for Cesana / Pragelato):
  ~/Library/Caches/ski-work/data-round/official/{vialattea,montgenevre}.json. Lifts 65 of 69 (missing: FV Pattemouche, SC La Motta, TP Club
  Med, TP La Butte). Pistes: 174 of 316 carry exactly the official name; most others differ in spelling ("Poussins" / "Les Poussins")
  or are connectors / variants OSM does not name (check_official.py's loose match is too generous with bare numbers, do not trust its count).
- **SQL on production**: 315 rows were applied one bake too early (before `ref_names`). Production rows are never changed, so the 57 ids
  whose row is stale are `reserved_ids` (never given to a run) and only new rows were added: 57 unused `ski-vialattea-*` rows stay
  in `ski_board_floors` (no scores; harmless). Apply the floors only when the data is final.
- **Villages**: `ALPINE_RESORTS` + `PIEDMONT_RESORTS` (village.js): Alpine shapes (gabled, <= 4 storeys) but the facades mix plaster,
  stone + wood and some larch (Sestriere / Sauze are not Austrian hotels); long blocks (> 60 m) are plaster. The Sestriere towers are
  real: `RESORTS["vialattea"]["tall"]` (OSM buildings with >= 10 levels within the circle) -> row field 12 = 1 -> straight plaster
  towers from their footprint (block(), no stepping), r8c-check skips them.
- **Olympics**: chain `Kandahar Nasi` (OSM "Kandahar Nasi alta" + "bassa", 2.7 km, 721 m drop): worldcup landmark (red race nets, start
  house) and the start piste; `pass` landmark on the Col de Montgenèvre.
- **Shader** (`snow-shader.js`): the painted forest raster was sampled clamped beyond the box (dark stripes down the mountains beside the
  resort, e.g. Sauze d'Oulx looking north): outside the box it is 0 now (all resorts).
- **Course nets** (`course.js` + `pistes.js cornerTurn`): in the outside wedge of a sharp corner of the line (17-34 degrees, the
  projection pinned to the corner point) the wall uses the real distance (off stays short of it: a skier at 54 km/h slipped 14 cm
  through a net on 97 tris); gentle bends and hairpins unchanged (every resort's rides re-checked).
- Checks (23 Nov, final data, all green): round7c --rides 174 (Via Lattea 315/315 gates and rides, 0 through a net), round6 2647, round7 39,
  round7b 14106, r7d 1435, look7d 82, r8c 36348, speed 112, cliff 9/9, review 37, camera 15, barrier 14, npc 95, floors 1639 + parks,
  security, mp-race, harness --park x6; station-diag floating 0 / unheld 0 / 84 of 84 rideable, 3 shared ends without a roof (Fraiteve 1,
  Garnel 1, Jouvenceaux - Sportinia 1 tops). Budgets: calls-sweep7d (399 spots, Niddreg) 139 calls / 403k triangles; village sweep
  (10 places, before the last two bakes) 364k / 136; memory 345 MB renderer after load, 3 pages 1763 MB; first play 3.01 MB.
  Chromium flows PASS: ski-modules, ski, ski-resorts, ski-spawn, ski-lift, ski-course, ski-challenges, ski-park, ski-freeride, ski-npc,
  arcade-feature, home-page, arcade-pad; Via Lattea only: ski-lifts-all, ski-ipad-start, ski-mp-freeride, ski-avalanche, ski-firstperson
  (the last two before the final bake). Chromium ground-check green (same). WebKit not run (hangs on the Mini).
- Changed for this resort in shared code / checks: course.js (corner wedge), snow-shader.js, props.js (no piste poles on station decks or
  in the park), r8c-check (the towers are exempt from the 4-storey rule), ski_challenges flow (counts the resorts), picker.js / ui.css (any
  number of cards; taken over from the Obertauern branch so both merge cleanly).
- Open: a Via Lattea player who stars nearly every piste everywhere passes the 7 KB cloud-save limit (pre-existing, grows per resort);
  Sestriere's house styles are guessed; no Olympic / village landmarks beyond the race nets, the towers and the pass sign.

## Obertauern (23 Nov 2026): the 6th resort (Ian's choice: "Obertauern" + Via Lattea, agent a8011cda; the other in a064c2e8)
- **Data** `obertauern` (common.py): box 47.222..47.275 N, 13.505..13.625 E = 10.2 x 7.7 km, 42 of 48 tiles, 3.2 MB in all. Heights
  `at-dgm` (BEV 1 m, like Arlberg), far Copernicus; frame EPSG:25833 (UTM 33N: 13.56 E lies in zone 33; no other code cares about the
  zone: the DEM fetch reprojects). OSM: Overpass was at capacity all afternoon (502 / 504 on 4 mirrors): new
  `scripts/ski/fetch_osm_api.py` builds the same layer files from the OSM API 0.6 (`map` in chunks + `relation/<id>/full` for the
  relations a layer keeps): the same filters as `fetch_osm.py`, the normal cache, works for any resort when Overpass is down.
  Lifts checked against the 26 of skiresort.com's list (the resort's own page answered 404): all 26 in OSM; OSM has 28 = the 26 +
  Zehnerkarbahn mapped as two sections + the ski school's rope tow. PISTES are NOT checked against an official list: OSM gives 63 km of run
  centre lines (network 74 km), the resort advertises 100 km.
- **Bake**: 100 pistes, 63 km of run centre lines (network 74 km), 28 lifts, slopes 4 slalom; 2200 m top - 1627 m low. Park `The Spot`
  (OSM relation 13393799, three outer rings; `park_osm.py` now reads multipolygon parks ring by ring, `park_site.mjs` also tries lines
  turned off the fall line for area parks): 284 m, by the Schrotteralm T-bar. First lift Zehnerkarbahn I (config FIRST_LIFT).
- **Bake fixes (shared, generic)**: (1) `piste_ways` skipped nothing of a route relation's members: the "Tauernrunde Grün / Rot" circuit
  relations list the circuit's LIFTS too, so the Seekarspitzbahn / Panoramabahn lines became pistes on top of the lifts (gates + courses
  blocked by the lift line, 14 km too many): members that are aerialway / rail ways in the lifts layer are left out (the other five
  resorts have no lift in any piste relation: checked, a re-bake of them does not change). (2) `lift_names` {OSM way id: shown name} (Zehnerkarbahn I / II).
- **Shared look fixes (all resorts, found on the Obertauern shots)**: (1) far tree cards (`forest-far.js`) stood UPSIDE DOWN (the shader
  flipped V although the canvas atlas is flipY; the line is from round 2C): `texture2D(uAtlas, vUv)`; before / after on Arlberg and
  Obertauern. (2) grey / white STRIPES over the far mountains (Ian reported them on Bouc Blanc): the forest raster covers only the box
  and its clamped edge texels smeared outwards (Via Lattea fixed the same with a hard cut; now faded over the last 120 m in the box, `snow-shader.js`). (3) `village.js deepRow` (Alpine resorts): a
  house with > 6 m of ground falling away goes down by whole storeys instead of standing on a blank plinth (Obertauern's 60 x 26 m
  hotel: 21 m). (4) huts < 30 m2 are sheds (2.6 m eaves, were 6.4 m "towers"). (5) stone courses anti-aliased.
  The other five picker pictures still show the old far trees.
- **Cloud save near its limit (OPEN, needs a decision)**: every star of every real piste = 8,692 bytes of JSON with 5 resorts + Obertauern
  (the 5 alone: about 8.1 KB; Via Lattea adds 315 pistes, about 1.9 KB more); game_saves allows 8,192 (`pg_column_size`), cloud.js drops only times + map discovery, never stars. Past ~1,340
  starred pistes the cloud upsert would be refused (the local save stays). Only a near-100 % player; each new resort lowers it.
  ski-challenges checks 160 pistes per resort, which is fewer than the real 1,739.
- **Flow edits**: ski-avalanche looks for a spot on the face's path that is steep enough for the warning (it took one fixed point, which
  is too flat on Obertauern's first face); ski-challenges' count follows the number of resorts. calls-sweep7d now fails on triangles too.
- **Picker**: cards from resort-data.js, the count word (`Fënnef` -> computed), layout columns from the number of small cards
  (`--rp-cols` / `--rp-rows`; an odd last card spans two columns), `pb/ski/img/obertauern-*.webp` (pose for shot.mjs: 5250,4750,130,
  4150,3500,-60,42 at 1200x810, header rows cropped).
- mp-games v8 (Obertauern + 6 pistes in the lobby), UNLOCK {red 4, black 12}, flows / Node check lists.

## Printed piste map (23 Nov 2026; Ian: "improve the big map, make it look like a printed ski map, on those you can see way more clearly where to go")
The big map is now a hand-painted-looking panorama per resort with the pistes printed on it, drawn from our own data only (no published
piste map looked at, traced or copied). The old plan from above stays one tap away ("2D" in the zoom column, per device in localStorage
`pb_ski_mapview`) and is what a resort WITHOUT a panorama shows, so nothing breaks before panorama.py ran.
- **Projection** (`pb/ski/pano.js` == `scripts/ski/pano_proj.py`, same table, same bicubic 40 m heights `field.farHeight`): a bent oblique
  view. s = depth along the look direction, r = side: u = r R(s), v = F(s) + G(s)(y - y0); steep look-down in front (f0 ~0.78), flatter at
  the back of the ski area (f1 ~0.56), nearly level behind (skyline). Pure: any piste / lift / skier point projects exactly; the way back
  (taps) marches the column front to back. Camera numbers = resort.json `panorama.cam` (bake.py keeps the key; rerun panorama.py after a bake).
- **Painter** `scripts/ski/panorama.py <rid> ... [--draft --lines --out DIR --data DIR]`: per pixel world point / height / normal / class,
  then gouache: banded snow light with blue shade, rock and snow strokes dragged down the fall line (line integral convolution), conifers
  and houses back to front, roads, frozen lakes, glacier, haze, sky. 4.2 Mpx, WebP <= 300 KB (quality, then size goes down: Kronplatz).
  `CAMERAS[rid]` = only what differs (az, f0, f1, E); without an entry the look direction is picked by score (pistes facing the viewer,
  nothing hidden, page shape): Obertauern (0 deg) and Via Lattea (105 deg) are picked that way. To tune: `--draft --lines` (5 s).
- **map.js** (rewritten): a "sheet" object per view (to / from / geometry projected once), everything goes through it. Pistes: white edge,
  downhill arrows, number discs where OSM has a `ref`, names along the line; undiscovered = softer ink + white disc, discovered = full
  colour (`SOFT` in map-symbols.js, free ride tab only; the fog veil is gone). Lifts: pictogram badge per kind (chair, gondola, cable car,
  drag = dashed, railway = sleepers, tunnel dashed), straight from bend to bend. Villages in caps, summits with altitude, park, race
  (World Cup) and landmark signs, challenge flags, compass, title in the sky, print credits on the paper's edge. Labels: greedy, tiered, in
  a collision grid, along-line names as oriented boxes. Legend = `<details>`: colours always, signs on tap.
- **Base layer**: painting (+ crisp trees / houses `map-decor.js` from m >= 0.085 px/m, built in 7 ms slices, near pistes only, ridge
  occlusion via pano.cover) on an offscreen layer 16 % larger than the view; panning blits it, repainted 130 ms after the last move.
  Pan frame (Killy, iPad size @2, headless Metal): 122 ms (painting scaled every frame) -> 16.8 ms. Opening 55-130 ms of JS, panorama.webp
  and buildings.json fetched only when the map opens; dispose frees image, layer, canvases.
- **Taps**: the nearest wins (lift line / piste); a piste printed where a ridge hides it still gets its own ground (`groundAt`); sky and
  paper = nothing. HIT_PX 22 -> 18. worldXY can be null now (sky). OPEN_SPAN 4.6 km (relief).
- **Checks**: `node scripts/ski/pano-check.mjs [--python]`: 7 resorts, 100 % of the piste / lift points on the page, 99.0-100 % visible, taps
  back within 0.1 m (pistes, stations in sight), python == js 0.0000 px. `scripts/ski/map-memory.mjs` (heap +0.55 MB, nodes / listeners +0).
  `scripts/ski/pano-shots.mjs` (spawn, whole, valley, taps, challenges, 2D; frame times; portrait `--size 820x1180`), shots in
  ~/Library/Caches/ski-work/map-print/. Flow ski-teleport: + panorama / 2D / legend by touch, lift tapped on its drawn line.
- Memory (renderer + GPU, 3 opens, Killy / 3V): open 875 / 1059 MB, closed 833 / 995 (the old map: 864 / 989 open, 874 / 998 closed, its
  GPU part grew with every open); after a GC the live heap is back where it was (129 -> 129 MB). Open it costs ~30 MB of live heap.
  memory-check "switch #3 killy" +61 MB vs the 50 MB limit fails the same on main without this change (+62): open, not from the map.
- Not done: WebKit (hangs on the Mini). French resorts have hardly any piste numbers in OSM (names instead). On a tall screen the whole
  (wide) sheet is small: it opens on the skier, which fills the box. First play + ~55 KB (the new modules; no image).

## Cleanup round (23 Nov 2026): picker pictures + compact cloud save
- **Picker pictures**: killy / 3vallees / zermatt / arlberg / kronplatz / vialattea re-rendered with the upright far trees (same poses as above;
  Via Lattea pose 16950,10550,12,16527,10196,42,58 = Sestriere towers + chairlift), WebP <= 80 KB, `IMG_VERSION` 2 in picker.js. Obertauern was already fine.
- **Cloud save**: `modes/cloud.js` writes the old plain `s` while it fits LIMIT 7000; beyond that the stars go to `s3` (3-bit mask per position of
  `modes/piste-index.js`, ~1.3 KB for all 1,739 real pistes) plus `s2` (Golomb-Rice packed hashes) for pistes the index lacks. decodeCloud reads s, s2, s3.
  Degradation order (reported through `encodeCloud(progress, report)` + console.warn): best times, discovered map resort by resort (largest
  first), Lawin, park points, stars of the least-starred resorts. **After every bake / new resort run `node scripts/ski/piste_index.mjs`**
  (append-only, never reorder) and `python3 scripts/game_importmap.py`; a missing piste still saves (s2), `cloud-size-test.mjs` fails until the index is complete.
  Test: `node scripts/ski/cloud-size-test.mjs` (8 resorts all starred: 5.8 KB with fog + times offered; stars alone ~1.3 KB).

## Streets round (23 Nov 2026): ploughed village roads instead of "bobsled channels"
- **What was wrong**: the streets had a little light of their own (bluer / brighter than the field, no house shadows), a glowing white rim,
  dark tyre bands at a share of the width, a ring of tyre marks round every dead end and shards where streets met (a cell knew 3 segments).
- **`street-net.js`** (new, pure): OSM ways that meet end to end are joined (straightest pair, same width), rounded, cut where steep
  (unchanged `gentleRoads`), every end is JOINED (ruts fade out there; a near miss <= 4.5 m is led on) or a DEAD END (strength 1 -> 0 over
  15 m: narrower, no bank, no ruts, melts into the snow); loose stubs < 34 m are dropped; a trodden path (1.8 m) from the wall of every
  house that faces a street within 10 m. All segments sit in ONE float texture (2 texels a segment; a coarse copy without paths and fine
  bends for the 10 m lattice); a lattice cell carries its 4 segment numbers (`pickSegments`), 24 bytes a vertex (was 76).
- **`roads.js` shader**: one signed distance to the street's edge (union with rounded corners at junctions) -> packed surface, bank, ruts.
  The light is the ground's own: `SNOW_LIGHT_GLSL` moved out of the snow shader into a shared chunk + the mountain shadows + the sun's shadow
  map. Bank (0.15-0.5 m, lumpy), ruts and crown are bent normals + a small parallax offset, NEVER geometry (skis stand on the physics grid,
  ground-check rules unchanged). Dirt grows with the street's width, wet asphalt only on through roads, fresh snow covers it when it snows.
- **Budgets**: FINE_RADIUS 150 / 360 / 650 -> 90 / 200 / 480 (the banks are wider), one fine cell built per frame.
- **Checks**: `node scripts/ski/street-check.mjs` (joins, ends, the 4 segments vs all of them); shots `scripts/ski/street-shots.mjs`
  (chase, eye, side, top, junction, deadend, path; --q --time --weather). Before / after: ~/Library/Caches/ski-work/streets/.
- **Open**: streets still bank sideways where the 5 m terrain does (Courchevel): a flat road bed would need a bake change.
- Numbers: street triangles before -> after (same spots, Mëttel) 3V 43.0k -> 38.6k, killy 39.4k -> 23.3k, arlberg 44.2k -> 35.6k, kronplatz
  18.2k -> 17.4k, obertauern 29.7k -> ~15k; Niddreg scenes 315-405k triangles / 120-136 calls; vertex attributes 15-17 MB in all. The net is
  built in 12-91 ms (`ground` = field.baseHeight; through surface.height it took up to 2.6 s: a physics block per house).
- Results: node checks green; ground-check Chromium 6 / 7 (streets 6 mm everywhere); Obertauern's one crack after the jump to Kehrkopfbahn
  (-1.5 m, terrain only) is the same on main before this round: OPEN. memory-check: only "switch #8 killy" (+66 MB vs the 50 MB limit; +62
  noted on main before). WebKit not run.

## Livigno (23 Nov 2026): the 8th resort (Lombardy, Mottolino + Carosello 3000; stands alone, no Bormio / Santa Caterina)
- **Data** `livigno` (common.py): box 46.490..46.562 N, 10.050..10.190 E = 11.5 x 10.2 km (9 x 8 tiles, 38 shipped), frame EPSG:25832, 2.6 MB.
  Heights: NEW source `lombardia-dtm` (`dem_merge.py lombardia_mosaic`) = Regione Lombardia DTM 5 m through the ArcGIS ImageServer
  `https://www.cartografia.servizirl.it/arcgis2/rest/services/BaseMap/DTM5_RL_img/ImageServer/exportImage` (F32 GeoTIFF, EPSG:32632, 512-node
  chunks, nearest neighbour, CC BY 4.0). It covers 90.6 % of the box (the north-west corner is Switzerland, no pistes there); Copernicus GLO-30
  fills the rest, merged like Via Lattea (`merge_sources`, offset median +0.6 m). Seam check: laplacian p99 4.8 on the edge vs 2.3 inside, and
  the edge is 800+ m from the nearest piste (Federia, x > 2400 m): not visible. Far grid: Copernicus.
- **OSM**: Overpass answered for pistes / lifts / buildings / areas, 502 from water on: `fetch_osm_api.py livigno` filled the rest. Result:
  96 runs / 75 km (80 named, 4 variants, 16 links), network 81 km; 37 lifts = the 30 numbered lifts of the Livigno map + 7 carpets
  (skiresort.com: 32 lifts and 115 km advertised; OSM has fewer km because pistes < 350 m / < 70 m drop are no runs). No official piste list
  online (skiresort.com has totals only), so there is no official-name match count: piste names are the OSM ones (Mottolino, Zuelli, Blesaccia,
  Centrale, Giorgio Rocca, Nera, Autostrada, Sponda FIS, Degli Amanti ...); the lift names match the ones skiresort.com shows.
- **New generic knobs**: `lift_strip_numbers` (bake.py; OSM names carry the lift-map number, "Mottolino Gondola (3)"; `lift_names`
  {204017643: "San Rocco I", 204017644: "San Rocco II"} for the one clash), `mixed_twins` (lift_sites.py; a chair + a drag mapped 6 m apart with
  both ends on one spot, San Rocco 17a / 17b, are set apart like twin drags; before, round7b failed "the platform has its canopy" on San Rocco I),
  `names` for OSM typos ("Pian Della Vlope 1", "femminile alta"). `lombardia-dtm` also triggers the merged DEM path in fetch_dem.py.
- **Start / first lift / park**: start piste `mottolino` (2 km red from the top into the village), FIRST_LIFT `Mottolino Gondola`, park = the
  mapped Mottolino fun area (OSM way 761530509, 420 m, Trepalle chairlift 16 m away; shown as "Snowpark Trepalle"). UNLOCK {red 4, black 8}
  (only 8 black runs). Villages (all "chalet", `ALPINE_RESORTS`): Livigno (a long N-S strip), Santa Maria, Pemont, San Rocco, Borch, Florin,
  Teola, Trepalle, Eira. No landmarks. Picker picture pb/ski/img/livigno-*.webp (GPU shot, 330 m up over the valley looking at Carosello).
- **SQL**: `scripts/ski-v1.sql` regenerated (+97 boards: 96 pistes + the park), applied to production only after the piste list was final.

## Obertauern "terrain crack" + memory-check flapping (24 Nov 2026): both were measurement artefacts, no game code changed
- **The -1.5 m crack after the jump to the Kehrkopfbahn was not a terrain crack.** The one ray (2047 / 3397) lies inside the snow park (Obertauern's
  park is 70 m from the arrival spot). Physics there = `park.solidAt` (the analytic kicker / ramp / pipe shape, `surface.height`), which the park's own
  mesh `ski-park-snow` draws (0.01 m from physics); the terrain tile under it is the plain lattice (heights `fresh` = `block` = mesh, 1.1-1.8 m
  UNDER the park body, no stale tile: `pendingLater` 0). ground-check only cast its terrain rays at the group `ski-terrain`, so it saw the lattice
  under the park body. Fix in the check: the rays now hit `ski-terrain` + the visible `ski-park-snow` (the first visible drawn ground), and a new
  `park` test walks the whole park footprint + 12 m (stations 120 m apart, each +-60 m, 1.5 x 2 m grid, ~6-9k rays) vs physics: Obertauern worst
  0.04 m, Killy 0.05 m. (Coarse LOD tiles differ by up to 0.65 m from the 2.5 m lattice inside the park mask's blend on a 5 m tile (Killy, 100+ m away):
  by design, the check only looks inside the 100 m full-detail ring.) `scripts/ski/crack-probe.mjs [resort] [lift] | park`: lists the rays off
  by > 0.3 m after a fast travel (or over the park) with tile, mesh / lattice / block / far heights and every hit.
- **memory-check "Killy second visit +55..71 MB" = cold-process baseline, not retention.** Alternating killy / 3vallees 14 times in one page
  (renderer + GPU MB, top's MEM): killy 689 (cold, 1st) then 751, 783, 753, 753, 777, 753; 3vallees 820, 831, 837, 830, 832, 844, 845. JS heap, geometries
  (313-315) and textures (19) are identical every visit; growth stops after the first revisit. The renderer / GPU process is warm after the first page
  life (malloc / V8 high-water, GPU caches) and the first visit of the first resort was measured cold; top's MEM (compressor included) moves +-25 MB
  per reading on top of that. Check now: section 2 = one cold lap, then killy / 3vallees four more times each (`--switches` default resorts + 8,
  16 page lives); the cold first visit is only printed; the 50 MB limit holds between the mean of a resort's first two warm visits and the mean of its
  last two (a real leak grows on every revisit; noise does not) + GL counts (geometries +10, textures +3 vs the first visit). Every reading is the
  median of 3 samples (gc x 2, 0.5 s settle each). Result runs: see the commit message.

## Davos Klosters (24 Nov 2026): the 9th resort (Graubünden; Parsenn + Jakobshorn, Rinerhorn and Madrisa by bus)
- **Data** `davos` (common.py): box 46.715..46.940 N, 9.775..9.945 E = 14.1 x 25.6 km (11 x 20 tiles, 129 shipped), frame EPSG:2056 (LV95),
  heights swissALTI3D 2 m (98.1 % of the box; Copernicus GLO-30 only in the north-east corner = Austria, no pistes there), far grid Copernicus.
  **DEM seam fix (generic)**: `dem_merge.swiss_items` asked the STAC API for the WGS84 box only; the frame is an axis-aligned LV95 rectangle whose
  west edge lies up to 0.01 deg outside it, so a 400 m strip of Rinerhorn was Copernicus (+-9 m). Now the query is padded 0.012 deg (Zermatt's cached
  `items.json` is untouched). Merge offset p95 3.6 m, no visible seam.
- **OSM**: Overpass answered (all layers), no API fallback needed. Result: **142 pistes / 173 km** of run centre lines (network 188 km), **56 lifts**,
  park, 4 slalom pistes. Sectors (after `tidy_network` + `keep_areas`):
  | Sector | lifts | pistes | reached by |
  |---|---|---|---|
  | Parsenn (Davos Dorf - Weissfluhjoch - Gotschna - Klosters, + Schatzalp / Strela) | 27 | 68 | the connected main network |
  | Jakobshorn (Davos Platz) | 12 | 36 | BUS_AREAS `Jakobshornbahn Sektion 1` |
  | Madrisa (Klosters Dorf) | 10 | 18 | BUS_AREAS `Madrisabahn` |
  | Rinerhorn (Glaris) | 7 | 20 | BUS_AREAS `Rinerhornbahn` |
  Left out: **Pischa** (OSM has ONE freeride line "Flüelameder" for the cable car: no experience), Gargellen / Schafberg (Austria, `exclude` circle),
  the Küblis Heuberglift, Pany, Mottalift (kids' lift 1 km from the network), the Davos wakeboard lift (`exclude` circle, it was a "drag lift").
  `keep_areas` + `BUS_AREAS` do the Sonnenkopf trick for the three bus sectors (their valley stations are discovered from the start; no fake lift links).
- **New generic bake knobs** (all off unless a resort lists them): `ref_names` + `ref_zones` (Rinerhorn and Madrisa both number pistes 1..13 as `ref` only
  / numeric `name`: inside a zone the number gets the sector name, "Rinerhorn 5", "Madrisa 3"; elsewhere "Rout 49"), `funicular_by_ref` (the Parsennbahn
  is two OSM sections E1 / E2 with the same name: "Parsennbahn 1" Davos Dorf -> Höhenweg, "Parsennbahn 2" Höhenweg -> Weissfluhjoch, one lift each),
  `thin_pylons` (mapped pylons in clusters / within 35 m of a station made carriers touch a pylon: Meierhofertäli, Totalp; round7b-test now 0 fails).
- **Start / first lift**: start piste `kreuzweg-klosters` (Weissfluhjoch -> Klosters, red 7.2 km), FIRST_LIFT `Parsennbahn 1` (Davos Dorf funicular, red car
  in the station), park = the mapped Snowpark at Jatz (OSM way 51511360, 278 m, Jatz Junior drag 42 m away; the mapped halfpipe / funpark lines are
  unusable for the park picker). UNLOCK {red 5, black 14}. Villages (`ALPINE_RESORTS`): Davos Platz, Dorf, Wolfgang, Laret, Frauenkirch, Clavadel,
  Schatzalp, Glaris, Klosters Platz / Dorf, Selfranga, Serneus, Saas, Schlappin. Davos' big flat-roofed hotels are drawn as gabled Alpine hotels (<= 4 storeys,
  like Zermatt). No landmarks. Picker picture pb/ski/img/davos-*.webp (GPU shot over Davos Platz towards the Parsenn).
- **Printed map**: panorama.py picked the camera by score (the Parsenn at the back, Davos town in the middle); pano-check 100 % on the page / visible.
- **SQL**: `scripts/ski-v1.sql` regenerated (+142 boards `ski-davos-*`, 1986 in all); applied to production only for `ski-davos-*` after the piste list was final.
- Shared edits: bake.py (above), dem_merge.py (STAC pad), fp-steer-check.mjs (`SKI_RESORT` / `SKI_PISTE` env), cliff-check.mjs (davos routes in the default
  list), `scripts/ski/davos-node-checks.sh` (the Node checks that are not in r8c-node-all.sh), every per-resort list in scripts / flows / mp-games SKI_PISTES.

### Davos printed map (24 Nov 2026, after launch)
- Camera: `panorama.py CAMERAS["davos"] = {az 15, f0 .78, f1 .6}` (looking north up the valley from above Glaris: Rinerhorn and Jakobshorn in front, Davos and the
  Parsenn in the middle, Klosters and Madrisa behind). The score pick (az 135) left the resort in the back with a third of the page out of the box. Tried
  by `PANO_AZ=<deg> ... --draft --lines --out DIR` at 20 / 60 / 90 / 110 / 270 / 280 / 300 / 330: E-W views are 2:1 letterboxes, az 15 is page-shaped.
  pano-check: 100 % on the page, 99.97 % visible (least hochroute-casanna-alp 96 %).
- Painter (generic, `panorama.py`): outside the box the "forest floor" was the dark green floor colour with the brush-stroke term, which on steep
  out-of-box slopes made green-grey fern streaks. Now a separate pale, light-driven snow-dusted valley tint (`ocol`, no strokes, 0.62). Only the Davos
  panorama was re-rendered; the other eight keep their old images (re-render them with `panorama.py <rid>` if the streaks bother anyone: Zermatt / Arlberg
  edges have them to a lesser degree). Shots: ~/Library/Caches/ski-work/davos/map/ (landscape + portrait, Zermatt for comparison).
