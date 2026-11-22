# Ski Alpen: handoff (phase 1 + rounds 2-5 + round 6: free ride main game, lift rides, ski types; 21 Nov 2026)

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
  61 km/h), course rides with the game's collisions 1350/1351 -> folyeres-variante-blue fixed after (pocket escape; single re-run ok);
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
