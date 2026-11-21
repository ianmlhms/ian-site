# Ski Alpen: handoff (phase 1 + rounds 2B / 2C, 21 Nov 2026)

Arcade id `ski`, page `pb/ski.html`, code `pb/ski/`, pipeline `scripts/ski/`, data `pb/ski/data/<resort>/`. Phase 1 = the engine and one
resort, Espace Killy (Val d'Isère + Tignes). The game must NOT go live before the other four resorts are in (3 Vallées, Zermatt-Cervinia,
St. Anton, Kronplatz): Kronplatz and St. Anton are in since round 2B; the picker lists the rest as "geschwënn".

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

## Known gaps (honest)
- Mid-distance terrain self-shadowing beyond the shadow box is still only the baked 40 m raster (+ the occlusion term).
- Streets are draped ribbons: on coarse far tiles they can sink into / float over the terrain (shown only within the building radius).
- Building styles are guessed from size and tags (no per-village style); L-shaped chalets use their oriented box.
- The Chevril giant is our own simple figure (not a copy of the fresco); the frozen lakes still read mostly as snow fields.
- The Concordia bell is only seen from the summit dome itself (the convex top hides it from lower plateau views).
- Sound is synthesised only (no menu music); not heard on a real iPad yet.
- Frame times measured on the Mini (CPU x4, GPU not throttled): every level holds 60 fps there; a real-iPad GPU check is still due.
- Skier is a box-and-capsule figure (stylised); no tricks yet, no cloud save of the progress (local only).
