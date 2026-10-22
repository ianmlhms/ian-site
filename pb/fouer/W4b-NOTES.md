# W4b "Coasters and halls": notes (23 Oct 2026)

Seven models: `maus`, `looping`, `alpina`, `splash` (file `coasters.js`) and `geister`, `scooter`, `tent` (file `halls.js`). Same contract as W4a (`MODELS[id].build({look, level, quality, seed, [lang]})`, see W4a-NOTES.md), same preview (`/pb/fouer/preview-big.html?only=maus&look=1&level=4&time=night&lod=near`, `window.__big.shot('maus','three')`), flow `fouer-big-models` extended (it now boots all twelve big models).

## Files
| file | bytes | what |
|---|---|---|
| `pb/fouer/models/coasters.js` / `halls.js` | 0.5 K / 0.4 K | registries: `MODELS = {maus, looping, alpina, splash}` / `{geister, scooter, tent}` |
| `models/coaster-kit.js` | 24 K | track toolkit: `makeSpline` (closed centripetal Catmull-Rom, arc-length table, rotation-minimising frames so loops stay upright, banking), `resample`, merged sweeps (`girder`, `rails`, `sleepers`, `diamonds`, `diamondsTop`, `ledRuns`, `ledWallRuns`), `makeRun` (speed profile: dwell, lift, energy, hairpin and brake limits), `carMatrix`, `supportPoints`, and `buildTrackRide(spec)` (the shared model wrapper) |
| `models/coaster-props.js` | 5 K | `litSign` (dot-matrix lettered sign), `ticketBooth`, `queueRails`, `collar`, `patch`, generic ride names `NAMES` (lb/de/en) |
| `models/coaster-maus.js` / `-looping.js` / `-alpina.js` / `-splash.js` | 15 / 13 / 21 / 18 K | one ride each |
| `models/hall-scooter.js` / `-geister.js` / `-tent.js` | 17 / 26 / 17 K | one hall each |
| `models/big-kit.js` (+~6 K, additive) | 31 K | new exports: `pixelText` / `pixelTextWidth` (5x7 dot-matrix lettering from quads, no textures), `padSlab`, `festoon`, `railing`, `pennant`, `wrap`. Existing API untouched |
| `preview-big.html` | 16 K | + 7 spots (`tent P04, maus P11, geister P21, scooter P13, splash P22, alpina P28, looping P33`), + shots per model, `applyLod` ignores hidden groups |
| `scripts/flows/fouer_big_models.mjs` | 37 K | + W4b steps (see Tests) |

**W5 must add `./coasters.js` and `./halls.js` to `BIG_FILES` in `models/index.js` (W3's file, I did not touch it).** Nothing else is needed: both files `export const MODELS`.

## Contract (as W4a) and what is new
- Group named `id`, origin = pitch centre on the ground, +z = front (face), rotation by `face` as in preview-big `placeOnPitch`. Footprints (every vertex at every height, not only the ground, checked in the flow): L models x +-15, z -9..+9 (maus 14.5 / -7..8.8, splash / geister / scooter / tent about 14.4..15 / -9..8.9); **alpina and looping are XL**: x +-28, z -15..+15 (they also fit nothing smaller: DESIGN lets an L item stand on an XL pitch, these two are XL items and only go there).
- `userData`: `animate(t, dt, k)`, `setNight(k)`, `setLOD(0|1)`, `setAnimated(b)`, `stats()`, `footprint`, `height`, `cycle` (s), `phaseAt(t)`, `dispose()`, `parts.{near,far}.{static, cars, dyn, handles}`, `tier`. Everything is a pure function of `t` (no integrated state), so `animate` can be called with any `t` and `phaseAt` is exact. `quality: 'low'` builds only the far model.
- Every model = 2 draw calls per LOD (one static merged mesh + one CPU-skinned `cars` mesh), single shared lit material, night lamp scalar `0.45 + 0.55 k` (checked in the flow).
- `lang` option ('lb' | 'de' | 'en', default lb) picks the lettering (`NAMES` in coaster-props.js: WËLL MAUS, LOOPING-BUNN, ALPEBUNN, WAASSERBUNN, GEESCHTERBUNN, AUTOSCOOTER, BIERZELT). No brand or showman names anywhere (flow greps the sources). The bear is a generic fibreglass bear in a dirndl; the mascot sheep (Hämmi) is on the L3 forecourts; the maus has a corn-cob mascot (own design).

## API for W5 / W6
- Coasters, flume, ghost train (`maus looping alpina splash geister`): `ud.track` (spline: `length`, `at(s) -> {p,t,u,r}` in model-local metres), `ud.run` (`period`, `sAt(t, shift)`, `vAt`), `ud.phaseAt(t) -> {s, v, p, t, y}` of the lead vehicle, `ud.carFrames(t)` (per train / car frames), and **`ud.ridePath(t, {train=0, car=0, eye=[0,1.15,0.3]}) -> {position, forward, up, speed, s, length, period}` in WORLD space** (uses the group's current matrixWorld, so it works on any pitch). For a first-person ride: each frame set the camera to `position` looking along `forward` with `up`; hide nothing (the lead car's mesh sits around the eye; if it clips, offset `eye` by 0.2 up or hide train 0 by scaling, there is no per-car visibility switch). Train 0 runs `trains[0].shift` ahead of the clock, so `ridePath(t)` is where the first train is at model time `t`; `speed` is 0 during the station dwell. Periods: maus 42.6 s, looping 46.8 s, alpina 45.9 s, splash 40.3 s, geister 27.7 s (cart speed 2.1 m/s, constant).
- Trains: maus 3 single cars, looping 2 x 4 cars, alpina 2 x 5 cars, splash 3 boats, geister 4 carts (each cart hides inside the building: `hide` when z < 1.2).
- Splash extras: `ud.impact` (model-local splash point), `ud.tImpact` (time the lead boat hits), `ud.dropCount`; 3 boats, up to 16 droplets each and one ripple ring per boat (all CPU-skinned quads in the cars mesh, droplets scale and fall ballistically for 1.5 s).
- Scooter: `ud.carCount` (8 / 9 / 10 / 12 by level), `ud.floor` = {x0,x1,z0,z1} (model-local floor rectangle), `phaseAt(t).cars -> [{x, z, yaw}]` (cars drift on closed Lissajous paths with a soft push-apart, period 48 s, they loop exactly).
- Tent: 3 ring chandeliers turn (60 s period), steam puffs from the kitchen at L3+. Geister: smoke puffs at the cart gate at L3+.
- Levels (every level adds meshes only, the merged static mesh just contains more): **L1** the plain ride; **L2** lit lettered name sign (dot-matrix, bulbs), second ticket booth, pennants / flags, festoons; **L3** LED outlines that chase (track sides, loops, fascia, barrier, tent gable), the mascot (corn cob / Hämmi / bear), railings, extra effects (smoke, tikis, spray count 16, steam); **L4** gold trim (collars, balustrades, finials, cuffs). Looks: 0 Traditioun, 1 Neon, 2 Retro (palette dictionaries `PAL[0..2]` per file).

## Numbers (headless Chromium, `?fouerQ=medium`, 1280x800; L4 worst case over all looks)
| model | near tris / draws | far tris / draws | height | cycle |
|---|---|---|---|---|
| maus | 10,731 / 2 | 2,695 / 2 | 21.5 m | 42.6 s |
| looping | 11,200 / 2 | 4,008 / 2 | 37 m | 46.8 s |
| alpina | 11,859 / 2 | 4,823 / 2 | 24 m | 45.9 s |
| splash | 4,744 / 2 | 3,436 / 2 | 17.2 m | 40.3 s |
| geister | 7,669 / 2 | 3,341 / 2 | 19.6 m | 27.7 s |
| scooter | 8,322 / 2 | 3,151 / 2 | 9.2 m | 48 s |
| tent | 7,936 / 2 | 2,806 / 2 | 11 m | 60 s |
Frame-the-field preset (renderer.info delta, all seven far, L4): **14 draw calls, 24,260 triangles** (budget 20 / 35,000). W4a's five add 13 / 10,041, so all twelve big models together are 27 draws / ~34k triangles (the sum of both budgets, W5 should spend only the nearest-N near models on top). Worst near model 11.9k triangles / 2 draws (budget 6 / 12k). `animate()` cost per frame at near L4: 0.02 to 0.07 ms (budget 1.5 ms, CPU skinning of <= 600 vertices plus lamp chase). 252 builds (7 x 3 looks x 4 levels x 3 qualities) finish in well under 10 s total.

## Tests (`node scripts/flows/run_all.mjs fouer-big-models`, one full-Chromium run, ~10 s for the whole flow)
All 252 builds are finite, API complete, near / far present (`low` = far only), every vertex inside the pitch; level 4 has more geometry than level 1; near budget; far budget; every train lap: arc length goes 0 -> length once per cycle and never backwards; every visible car stays within 1.3 m of its spline frame at the right height above the rail (measured from the actual skinned vertices) and inside the pitch; `ridePath` is finite and unit-length; geister carts vanish (148 hidden vs 92 visible samples); splash: 3 boats climb to 12.6 m and return, 16 droplets + ripple right after the hit, 0 droplets 1.3 s later; scooter: no car leaves the floor, 0.09 % of pairs closer than 0.9 m, loops exactly; tent chandeliers turn; LOD / nearest-N rule with the coasters; renderer.info delta; night scalar; no brand names. Also run: `node pb/fouer/harness.js` (737 checks pass), `python3 scripts/check_site.py` (only the old karttracker-privacy orphan warning), `cv_head.py` (0 problems).

## Photo comparison (montages in `website-overnight/reports/fouer/w4b/`; references are not in the repo)
Each `<id>.png` = reference photos (top) against the model at day front, day 3/4 and night (bottom). Each `<id>_levels_looks.png` = L1, L2, L3, L4 night, Neon L4 night, Retro L4 noon. `scooter_interior.png`, `tent_interior.png` show the inside.
| model | montage | verdict |
|---|---|---|
| maus | `maus.png`, `maus_levels_looks.png` | GOOD: lime tubular tower frame, five levels of purple ladder track with flat hairpins joined by diagonals and a lift, white cars with striped nose, corn-cob mascot, bulb pylon, lit sign. The photo's hairpins are broad ovals that overhang the frame and the real frame is a looser tangle of leaning tubes; ours is a regular grid |
| looping | `looping.png`, `looping_levels_looks.png` | GOOD: white lattice supports with flags, orange box track, 35 m lift, five coloured loops in a row (blue, yellow, black, green, red), painted hoarding behind, trains of four. Real ride has more track (two helices, a Bayern-curve pavilion next to it); ours is a single circuit |
| alpina | `alpina.png`, `alpina_levels_looks.png` | GOOD: dark-timber two-storey chalet with deep eaves, floral bargeboards, flower boxes, balcony with a waving fibreglass bear in a dirndl, lime-green splayed tubular supports, blue track with the white diamond pattern (sides and top), flags in a row, alpine mural, firs and lawn. Chalet is simpler than the real one (no carved fretwork, no antlers), supports are plain tubes |
| splash | `splash.png`, `splash_levels_looks.png` | GOOD: yellow timber A-frame trestle, blue/white chute, conveyor lift, thatched station, painted wave backdrop with lettering, palms, tikis, three barge boats with painted panels, pool with a spray burst. The real flume is a long channel with several drops and a much bigger trestle; ours has one lift and one drop |
| geister | `geister.png`, `geister_levels_looks.png` | GOOD: grey ashlar castle, clock tower with the jester, crenellated turret with the giant hand, balcony with stone balustrade, skulls, gargoyle, green dragon head, airbrushed panels, entry ramp, lit roof sign, carts that cross the upper balcony and the ground gate and disappear. Missing: ivy and the busy real mural detail, the second tower |
| scooter | `scooter.png`, `scooter_interior.png`, `scooter_levels_looks.png` | GOOD (exterior), needs-work (minor, interior): red/cream hall with a bright four-row bulb front, lit sign, floor with padded barrier, glowing floor stripes, UV bars, mural wall, up to 12 cars with pole + flag drifting and bumping. Cars are boxy (no airbrush, tail lights are tiny); the real hall interior is a dense forest of poles and mirrors |
| tent | `tent.png`, `tent_interior.png`, `tent_levels_looks.png` | GOOD: 30 x 16 m white gabled hall tent with lower aisles, scalloped valances, lettered gable, open sides showing the striped fabric ceiling, turning ring chandeliers, long tables and a stage, terrace with barrels, steam. Ceiling is plain stripes (the photo's tent has draped, swagged fabric and a timber structure); no people (W6) |

## Known gaps
No shadows; no riders / queues / crowd (W6); cars are rigid boxes (no suspension, wheels, restraint motion); coaster tracks are single circuits (maus 192 m, looping 296 m, alpina 173 m); the spline banking is a heuristic (looks right at the hairpins and helix, loops are planar so never banked); trains do not slow for the lift-top "brake" cosmetics beyond the speed profile; the maus and splash cars have only a lead-vehicle `ridePath` (cars of one train share one frame function with spacing, `car: n` gives the n-th); `ridePath` eye offset is a fixed seat guess per model; splash droplets are quads not particles; scooter car-to-car collisions are a push-apart on pre-defined paths, not physics; Headless numbers only, no real iPad frame time.
