# W2 "Ground": notes (22 Oct 2026)

Standalone page `pb/fouer.html` (`?fouerDebug=1`, `?fouerNoFly=1`, `?fouerQ=low|medium|high`, `?fouerTime=19.5`, `?fouerWeather=rain`). Flow: `scripts/flows/fouer_world.mjs` (`fouer-world`, registered in run_all.mjs).

## Files
- `scripts/bake_fouer_world.py` (run with `/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python`, needs numpy + Pillow) builds `pb/fouer/data/glacis-world.bin` (**~621 KB**, one raw-deflate stream, JS inflate fallback in `world/inflate.js`).
- `scripts/bake_fouer_landmarks.mjs` runs the real `luxtram-landmarks.js` in headless Chromium and exports Theatre (hi), Institut (lo), Red Bridge (lo) as int16/int8 geometry + a 128 px compact atlas (webp, 8 KB). Cached in `luxtram-work/fouer/lm.json`; `--refresh-landmarks` re-runs it.
- `pb/fouer/renderer.js` camera / input / loop / quality / debug; `pb/fouer/world/`: `bundle.js frame.js dem.js inflate.js glacis.js landmarks.js tram.js sky.js pitches.js envmenu.js index.js stage.js`.

## Reuse from Luxtram
- Data: h/ (LiDAR), g/ (painted ground), bf/ (LOD2), t/ (trees), f/ (far ring), luxtram-track.json (s 8250-9060), OSM tree nodes, OSM landmarks footprints. Cropped to 30 detailed tiles (<= 165 m from the field + the Theatre) and 47 far tiles (2.3 km).
- Code (classic scripts, unchanged): `luxtram-ground.js` (splat ground, draped roads/kerbs/bays/zebras) and `luxtram-facades.js` (facade atlas, lit windows, `setNight`). Host shim = `world/glacis.js` (chunks of 2x2 tiles: 1 terrain + 1 merged decor + 1 facade + 1 tree mesh per chunk; far ring = 1 terrain + 1 building mesh). `decodeHeights` ported (`dem.js`). `luxtram-world.js`, landmarks.js (runtime), traffic.js, trains.js, stations-luxtram.js are NOT loaded; tram vehicle and stops are new procedural models (photo-modelled).
- Bake changes for the fair: parked cars removed on Glacis + bus park (1233), carriageway polygons on the field dropped, bay lines kept but thinner (x0.55 width, x0.55 colour at runtime), the 19 m LOD2 ghost block dropped, LiDAR "trees" on the field dropped, 129 OSM avenue trees added (Allee Scheffer double row). Far heights use 2 cm steps (HQ 50) unlike the near tiles (5 mm).

## Frames
Bundle + world root are Luxtram local metres (x east, z south), `y = LiDAR - oy` (oy = 311). `world.root` is rotated by -0.7335 rad so the scene is the **game frame** (u NE along the tram, w toward Boulevard de la Foire, anchor 49.6167784/6.1237435 = (140, 62)). `world.groundY(u, w)`, `world.toGame(x,z)`, `world.toLocal(u,w)`. Add attractions to `renderer.gameRoot` (game frame, unrotated), y from `world.groundY`.

## API for W3/W4
- Place on a pitch: `world.parts.pitches.rect(id)` -> `{u, w, du, dw, y, size}`; `setState(id,'locked'|'open'|'built')` (open = pulsing gold), `setMode('off'|'outline'|'glow')`, `pick(u,w,slack)`. Tap: `renderer.on('tap', e => e.ground /* {u,w,y} */)`; `renderer.screenToGround`. Pitches are read from `pb/fouer/pitches.json` (falls back to the proposal).
- Night/emissive convention: `world.setNight(k)` (0..1) fans out to `world.parts.*.setNight`; `env.on` change also gives `getState().night`. Models should use vertex colours + a MeshBasic "lamp" mesh whose `color` scalar is `0.45 + 0.55k`, like `fouer-stops-lamps`; facades use the Luxtram lit atlas; landmarks `emissiveIntensity = k*1.15` with a gold emissive tint.
- Lights: one HemisphereLight + one DirectionalLight (`env.sunLight`, `env.hemi`), FogExp2 (`env.fog`), no real-time shadows, no dynamic lights. Lambert/standard materials get fog for free.
- LOD hooks: `renderer.state.quality` + `renderer.on('quality')`; world chunks are exposed (`world.glacis.chunks`, per-chunk group) so far attractions can be switched per distance; trees/decor tiers are decided at build time by quality.
- Budget left (medium, builder presets): ~150-157k triangles, 33-41 draw calls. W3+ must stay under roughly 25 draw calls and 140k triangles more.
- Tram: `world.parts.tram.debug.{state(), callTram(dir), fastForward(s), skipTo('theater')}`, `track.place(s, lat, h)` (local metres), stops have both platforms (46 m, OSM geometry). One tram every 5-8 min (first after 40 s), <= 19.4 km/h, 20 s dwell at Theater, 10 s at Faiencerie, dithered fade at both ends, no wire.
- Env: `createEnv()` -> `setWeather/ setTime / getState`, localStorage `pb_fouer_weather`, `pb_fouer_time`; UI `mountEnvUi` (button + menu). Random drifts a day per 12 min, weather every 4-8 min.
- Debug hook (`?fouerDebug=1`): `window.__fouer = {renderer, r, world, env, tram, pitches, performanceSnapshot(), setTime(h|mode), setWeather(w), cameraPreset(name), showPitches(mode), setFreeCamera({eye,look,fov})}`.

## Numbers (headless Chromium, iPad-medium profile `?fouerQ=medium`, 1280x800)
frame (fit field) 157k tris / 40 draws, close 150k / 35, top 149k / 33; low quality ~150k with fewer trees; high ~245k (desktop). Bundle 621 KB. Load ~1.5 s locally.

## Photo comparison (montages in website-overnight/reports/fouer/w2/)
v1 overview from the wheel: GOOD (wedge field, Theatre + Kirchberg + valley at the end; tents/rides are W3+). v1b drone aerial: GOOD layout (bus park, field, villas, plane rows); kiosk missing, trees stylised. v2 Allee Scheffer: GOOD (lane, edge strips, rails, lamp, blocks; stalls are W3). v3 Theater stop: GOOD (shelter, plate, ticket machine, hedge; ad poster generic). v4 Faiencerie: GOOD (two platforms, iron railing + plinth, bars, villa, trees). v5 Grand Theatre: GOOD (colonnade, foyer glass, frieze, masts, fountain; parvis flat). v6 Boulevard de la Foire: GOOD layout (mansard villas, boulevard planes), specific villa not matched. Also env_day/evening/night/rain/fog/cloudy shots.

## Gaps / next
Painted-style trees are low-poly lollipops (OK from the builder view, crude at street level); no shadow maps; no SW-corner kiosk; far woods pale (fog); Kirchberg towers are plain boxes (landmarks kad1/kad2/ecj could be baked as lo LODs if bundle budget allows ~+60 KB); two tracks drawn but only the outer one runs; stop lamp poles are generic; ground at night is dark by design (the fair lights it); real-iPad smoothness unverified.
