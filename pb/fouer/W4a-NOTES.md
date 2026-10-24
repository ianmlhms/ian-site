# W4a "Big wheel and towers": notes (23 Oct 2026)

Files: `pb/fouer/models/wheel.js` (Riserad), `towers.js` (jules, hangover, booster, infinity), `big-kit.js` (private builder: merged-per-material geometry, one lit material, CPU skinning, lattice mast, small props; W5 may merge it into kit.js), `pb/fouer/preview-big.html` (standalone preview on the W2 world), `scripts/flows/fouer_big_models.mjs` (`fouer-big-models`, registered in run_all.mjs). Preview: `/pb/fouer/preview-big.html?look=0..2&level=1..4&q=low|medium|high&time=noon|evening|night|<hour>&lod=auto|near|far&only=wheel,jules&bare=1&hud=0`, `window.__big` (rebuild, shot, solo, advance, freeCam, snapshot).

## Contract (as agreed with W3)
`MODELS[id].build({look, level, quality, seed})` -> `THREE.Group` named `id`, origin = pitch centre on the ground, +z = front, `userData.animate(t, dt, nightK)`, `setNight(k)`. Extras on every model: `setLOD(0|1)`, `setAnimated(bool)`, `stats()` -> {tris, draws}, `footprint`, `height`, `cycle` (period s), `phaseAt(t)`, `dispose()`.
- Night: one shared material (`ud.uniforms`): bulbs/LEDs are emissive vertex colour on the lamp channel, scalar `0.45 + 0.55 k`; windows glow and a little self-lit paint ramp with k. `setNight` is global per module graph (one kit), calling it on one model sets it for all (fine, k is global).
- Rotation on a pitch: `rotation.y = {'+w':0,'-w':PI,'+u':PI/2,'-u':-PI/2}[face]` (preview-big.html `placeOnPitch`, W5 reuses). Wheel footprint is local x +-12 (24 m, along the rim plane) by z -10..+20: on pitch W (40 x 24, face +u) the rim plane runs along w and the front/boarding side faces the field. jules/hangover/infinity fit 16 x 16 (z -8..+8), booster 30 x 18 (x +-15, z -9..+9). Rim, arms, seats and the crown fly out over the neighbours (only high above the ground), all ground structure stays inside the pitch (flow checks it for all 180 builds, ground pad + queue + flags included).
- Place with `y = world.groundY(u, w)` of the pitch centre; each model has a 1.1 m thick pad slab that reaches 0.8 m below y = 0 to hide slopes (pitch slopes in the baked world are up to 1 m).

## Wheel API (for W6)
- `ud.ride = { count: 44, period: 120 (s per revolution at speed 1), speed (get/set, x), angle(), setAngle(a), boardingIndex(), board() -> {position, radius}, setGondolaVisible(i, on) }`
- `ud.gondolaAnchor(i)` -> `{ index, position (cabin floor, 2.325 m below the hanger, world), eye (seated eye, 1.2 m above the floor, centred, 0.3 m behind the middle, world; was 0.7 m below the hanger until 24 Oct 2026), pivot, quaternion (= the group's yaw only, so the cabin is always upright), matrix, up (0,1,0), forward (the group's +z, i.e. toward the field side), angle, box (the cabin's world Box3), dims (`GONDOLA`) }`; recomputed from the live rotation each call. `ud.gondolaStyle` = the gondola colours for the ride's first-person cabin (`rides/cabin.js`). Attach the camera to `eye` every frame; call `ride.setGondolaVisible(i, false)` for the ridden cabin (the eye sits inside its mesh; the ride draws its own interior shell there) and show it again afterwards. For the 2-revolution 40 s ride set `ride.speed = 120 / 20 = 6`.
- `ud.hubWorld()`, `ud.parts` (debug).
- Gondolas are CPU-translated vertices in one merged mesh (never rotated, so they stay upright by construction; the flow checks size drift 4e-6).

## LOD and the nearest-N rule
`quality: 'low'` builds only the far model. Otherwise both exist and `ud.setLOD(1|0)` swaps; `big-kit.js updateLODs(models, cameraPos, {nearN: 3, distance: 80})` ranks by distance (+ height bias), gives the full model to rides within 80 m (10 % hysteresis) and animates only the nearest N, others keep their pose. At the frame-the-field preset everything is far. The far wheel still rotates (cheap) when animated.

## Numbers (L4, medium; headless Chromium)
| model | near (tris / draws) | far (tris / draws) | height | cycle |
|---|---|---|---|---|
| wheel | 13,987 / 4 | 4,024 / 4 | 50.4 m | 120 s per turn |
| jules | 5,795 / 4 | 2,095 / 3 | 85 m | 60 s |
| hangover | 3,948 / 2 | 1,332 / 2 | 90 m | 38 s |
| booster | 3,537 / 3 | 1,181 / 2 | 60 m | 56 s |
| infinity | 3,263 / 3 | 1,409 / 2 | 30 m | 52 s |
Frame-the-field preset (renderer.info delta, all five far): **13 draw calls, 10,041 triangles** (budget 20 / 35,000); wheel alone 4 / 4,024 (budget 8 / 15,000). Worst case with every model near: 30.6k triangles / 16 draws but the nearest-N rule keeps at most 2-3 near. World+rides at frame preset: ~49 draws / ~164k triangles (world ~37 / 154k).
Build time: all 180 combos in well under 5 s total in the flow.

## Photo comparison (montages in `website-overnight/reports/fouer/w4a/`)
| model | montage | verdict |
|---|---|---|
| Riserad day | `wheel_day.png` | GOOD: double yellow rim, 20 lattice spokes + cable web (no disc), 44 upright green/cream gondolas, green/white spiral legs with catwalks, LED sunburst hub (the "B" logo and BELLEVUE panel intentionally replaced by a star and plain lit panels, DESIGN 11.2) |
| Riserad night | `wheel_night.png`, `wheel_farend_night.png` | GOOD: reads as the icon from across the field; hub sunburst chases, rim chases at L3+; the real hub is a denser bulb matrix and glows more |
| Riserad platform / ride | `wheel_station_fp.png`, `wheel_ride_view.png` | GOOD: ticket booths, queue rails, gate, Hämmi plinth at L3; first-person from a top gondola works via gondolaAnchor |
| Tower swing | `jules.png` | GOOD: 80 m green mast with gold bracing, crown of 12 arms with paired seats on wires that fly out, parchment-scroll plaque (plain, no lettering), brick/cream steampunk booths, airship backdrop. Wires are thin lines; the real crown has more arms (12 vs ~20) |
| Drop tower | `hangover.png` | GOOD: white mast with three yellow blocks, maroon/gold saucer ring that rises/drops (free fall + brake + bounce), purple tube gate with lit diamond, vertical colour LED strips; seats are simple |
| Booster | `booster.png` | GOOD: magenta-to-yellow tower, cream box arm with oval windows, bulbs and hazard stripes, yellow pod, silver canopy arc, red skirt, comic wings; mural is flat colour blocks |
| Pendulum arm | `infinity.png` | needs-work (minor): two magenta A-towers with LED zig-zag, swinging arm + spinning ring, winged lit sign, round emblems. Missing: the pale-blue tripod pylon and the busy airbrush backdrop of the photo |
`all_five_night_frame.png` / `all_five_night_field.png` show the five on their pitches in the W2 world (the surrounding fair is W3's).

## Cycles (pure functions of t; all return to rest at t = k * period)
jules: board 0-8 s, crown rises 10-22 s to 62.5 m while spinning up, hold, down 42-54 s. hangover: 6 s board, 11 s slow rise to 80 m, hold 2.5 s, free fall at 25 m/s^2 (peak ~50 m/s), brake at 27 m, bounce. booster: 7 turns of the arm with the pod counter-spinning. infinity: swing amplitude +-100 deg with a spinning ring.

## Notes for W5 / W6
- Call `ud.animate(t, dt, k)` for each ride every frame (only `animated` ones do work) and `updateLODs` every ~0.25 s; `k` from `world.setNight`/`env.getState().night`. `setLOD(1)` on the ridden wheel while in the ride.
- `ud.stats()` is a cheap per-model triangles/draws counter for the perf probe.
- Levels: L1 plain, L2 booths + lit signs + bulb festoons + flags, L3 sheep mascot + chasing LED lines (+ plinth/railing on the wheel), L4 gold trim. Looks: 0 Traditioun, 1 Neon, 2 Retro (palettes per ride).
- No names: panels are plain lit plates; `bulb`, `flag`, `sheep` (Hämmi) helpers are exported from big-kit.js for reuse.

## Known gaps
No shadows (none in the world either); hub is a sunburst of 40-72 flat blades, not a real bulb matrix; rim LEDs are two ribbons, not individual bulbs; gondola interiors are empty; tower seats are boxes; no riders/crowd (W6); rain/wet look not applied to the lit material; headless Chromium numbers only, no real iPad frame time yet; `?bare=1` stub ground in the preview is flat (heights differ by up to 1 m on real pitches, covered by the pad slab).
