# Autoscooter "bigger inside" (24 Oct 2026)

Ian after playtesting: "The Autoscooter area is still too small." He chose **Bigger inside**: the hall on the map stays on its L pitch (30 x 18 m, footprint, unlock and model unchanged), but **riding it puts you in the ride's own interior hall of 40 x 22 m** (880 m2; the map's hall floor is 27 x 13.7 = 370 m2), like the ghost train's built interior, with fewer, more spread-out cars (player + 7 AI, every one with a rider; the map's hall has 10 - 12).

## Files
| file | what |
|---|---|
| `rides/scooter-hall.js` (new) | `HALL` (floor, walls, light bars) and `buildScooterHall(T, { pal, floorY, ceilY, title, calm })`: the whole interior as one Group, `update(t)` (pulsing UV bars, alternating bulbs), `dispose()`. Textures: floor, synthwave / fun / mirror murals, fair backdrop, neon signs (canvas, disposed afterwards) |
| `rides/scooter-cars.js` (new) | `createFleet`: the hall model's own car (`buildRideCars` in `models/hall-scooter.js`: car, rider, pole) as ONE geometry with a vertex range per car (`K.dynamic`, CPU skinning like the model), unlit (`MeshBasicMaterial`, the top light is baked into the vertex colours) |
| `rides/drive.js` | the rig: sim, cockpit (bonnet, wheel 19 %, hands, pole: unchanged), sparks, camera, hits, music, 60 s timer; builds / removes the interior, switches the camera layer |
| `rides/bumper.js` | AI: crowded cars try more spots and spread out, hunters go for the player (lead of 0.35 s) with at most two chasing him at once and a hunt lasting 4.5 s then 3.5 s of wandering, wandering cars steer around a car right ahead, a car stuck for > 1.1 s reverses out, AI speed 2.8 - 5.0 m/s |
| `rides/mesh.js` | `canvas`, `rnd`, `tex` are exported now (no other change) |
| `models/hall-scooter.js` | `PAL`, `CEIL`, `FLOOR_Y` exported, `buildRideCars` added. The model itself is unchanged |

## How the transition works
`ride.js` is unchanged: board at the real hall's entrance -> fade to black -> `rig.start()` builds the interior (canvas painting, behind the black screen) -> fade in; the timer / Esc / the red button -> fade to black -> `rig.stop()` -> fade in at the entrance (or `leaveToBuilder()` for "Fueren" from the builder). `finish()` never moves the walker.
- The interior is a child of **`r.scene`** (not of the model), placed with the model's world matrix, so the model's frame, the audio positions and the walker's spot stay consistent.
- **The map is not drawn**: the interior's objects are on camera layer 6 (`RIDE_LAYER`), `r.camera.layers.set(6)` while riding, the mask is restored in `stop()` (also on an instant `abort`). Nothing of the fair, the crowd or the sky is rendered; a dark dome (vertex colours) covers whatever the hall does not. Robust against objects that get added or shown later, no visibility bookkeeping.
- Exposure: the sky module changes `toneMappingExposure` with the hour; a `r.on("frame")` listener (runs after it) pins it to 1 during the ride and `stop()` puts the old value back.
- Cost: **21 draws / 16k triangles** for the whole picture (hall ~12k, cars 4k), the old hall in the ride was 200 draws / 264k.

## The hall (frame of the model: x along the hall, +z = open side towards the alley)
- Floor 40 x 22 m (x -20..20, z -11..11): dark steel plates 1.6 m with seams, rivets, scuffs, rubber arcs, skid marks, UV pools, long sheen streaks under the **five UV light bars** (z = -8.8, -4.4, 0, 4.4, 8.8) and dots of the bulb rows (one 2048 x 1152 canvas). Barrier on the floor's edge (red / white or the look's colours, bright rail, bulb row), a striped gate in the middle of the open side.
- Closed long side (back wall) and both ends: six / three mural panels each, synthwave sun and grid, the fun planets and palms, mirror panels with diagonal sheen, between columns, neon lines on top and bottom.
- Roof: a dark tent roof with ribs, seven rows of bulbs under it, a haze of soft coloured light; under it the see-through **contact grid** (thin bars every 2.2 / 2.5 m, girders) at 3.9 m, the UV bars with their bulb rows (pulsing, two groups in anti-phase, constant with reduce motion); the cars' poles reach the grid and spark there.
- Open side: the barrier with the gate, the **porch** (3.4 m deep, canopy at 4.25 m, a curtain of bulbs on its edge) with 58 spectators (24 leaning on the rail, some holding up a lit phone, some children), beyond it the dark alley with stall boxes, two tents and three strings of festoon lights at different depths, and a 140 x 22 m **painted backdrop** at 34 m (dusk sky, two Ferris wheels, a drop tower, tents with bulb outlines, stall fronts, crowd heads). Not the real map: the same backdrop at every time of day.
- Right end bay: raised **cash booth** ("KASSA" neon sign, warm window, token trays, two cashiers). Left end bay: **DJ desk** and speaker stacks under the neon "AUTOSCOOTER" (the item name of the language, upper case).
- Look = the model's palette `PAL[look]` (barrier, rail, UV colour, bulbs, car colours), so the three looks differ inside too.

## Checks
- `harness-rides.js`: the interior floor >= 38 x 20 and 7 - 9 cars, light bars over the floor and walls outside it, three seeds x 60 s: cars start >= 3.5 m apart, roam the whole floor (> 28 x 14 m), never more than two chase the player, nobody leaves the barrier, at most one car stands still afterwards.
- `fouer-rides` (scooter part): own camera layer 6 and the map not drawn, <= 80 draws / 120k triangles, floor >= 38 x 20 m, 8 cars with riders, spread out at the start (closest pair >= 3.5 m, nearest to you >= 6 m), W drives, A / D steer, arrows do not turn the view, bumps counted, cars stay inside, AI drives, the wheel stays at 8 - 21 % of the screen height (portrait and landscape), the timer ends the ride, flag once, walker back at the entrance, afterwards layer mask 1 and no `scooter-interior` in the scene.
- Screenshots: `website-overnight/reports/fouer/scooter-big/`.

## Not done / notes
- No planar reflection in the "mirror" walls (a painted texture), no real shadows; everything is unlit and painted like the ghost train.
- The real hall's own model cars keep their Lissajous idle paths on the map; `ud.drive` stays `null` (the contract stays for old callers, `canRide` still tests `"drive" in ud`).
