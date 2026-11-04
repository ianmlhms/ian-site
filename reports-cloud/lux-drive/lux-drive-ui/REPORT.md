# Lux Drive — UI + car feel (branch `lux-drive-ui`)

Cloud session, Milestone 5. Scope: menus, weather / time chooser, touch controls, the Kaart, quality step, the car and its
handling, the Luxembourgish texts. The world (roads, buildings, trees, look) is untouched; `main.js` / `lux-drive.html` got
small hooks only (viewport meta, `?v=17`, the UI wiring).

## What I did

1. **Menus** (`ui.js`, `ui.css`): start menu, pause menu (Esc / ☰), settings, help, in the MTB game's dark rounded style.
   Luxembourgish first, de / en / fr, the language changes live. The car waits behind every menu.
2. **Weather + time of day**: chips with **Random first and selected by default**, in the start menu, in the settings and in the
   game (⛅ button). Rain: -28 % grip (steering authority, braking, drive), wet sheen, CSS rain streaks, "Naass Strooss" hint.
   Fog: thick air. Both come from `env.js`; the flow measures grip 0.72 vs 1.00 and fog density 0.0168 vs 0.0003.
3. **Touch controls**: analog steering pad (the wheel follows the thumb), gas 128 px, brake 96 px, handbrake 70 px, multi-touch
   (3 fingers at once measured), `touch-action: none`, `user-scalable=no`, gesture events blocked, safe-area insets. Checked at
   1180x820 and 1024x768 with touch emulation (flow `luxdrive_ui.mjs`); nothing overlaps, the HUD never sits on a control.
4. **Kaart**: shared road index; a painted base map made from the land-class raster (woods, fields, town, rivers: no data
   file); the minimap turns with the car; **full-screen map** (M, 🗺, tap the minimap): pan, pinch / wheel / ±, street names,
   towns, the car. **Tap on a road → the car stands on that road**, right-hand lane, facing along it (the direction closest to
   where it looked; one-way with the traffic), bridges on their deck. The pose is checked against houses, tunnel portals, trees:
   the placement walks along the road to the nearest clear pose (found by the flow: a road end at a tunnel portal put the car
   inside the portal wall and the collision threw it off a bridge deck).
5. **Quality auto-step** (`quality-step.js`): down after 2.5 s over 27 ms, back up after 25 s under 15 ms, never above the
   chosen quality, never into a level that was too slow, hitches ignored, `?q=` pins it.
6. **Car**: new low-poly hatchback (`car-model.js`): hull, greenhouse with pillars, bumpers, grille, plates, mirrors, arches,
   12-sided wheels that roll and (front) steer, headlamps, tail lamps that flare when braking, reversing lamps, 8 paint colours.
   Handling (`car.js`): see PROGRESS.md; the two real bugs were **reverse never worked** (the car crept at 0.7 m/s backwards)
   and **no slip at all** (velocity was turned with the heading; the handbrake did nothing). Now steering is capped by tyre
   grip (no spin: 99 deg / 66 deg / 39 deg in 2 s at 30 / 50 / 90 km/h), the handbrake drifts, two collision circles keep the
   bonnet out of walls, a wedged car is put back on the road after 3.5 s. Speed-limit sign in the HUD.
7. **Luxembourgish**: rewritten in LOD spelling (Ufank, Beem, Brécken, Fueren, Owend, Wollekeg, Haftung ...), broken sentences
   (`set.note`, `orient.rotate`, `help.drive`, `start.hint`) fixed. 106 keys x 4 languages; the flow checks keys and placeholders.

## Gate results (cloud container, Chromium + software WebGL, 3 frames / s)

| gate | result |
|---|---|
| `node pb/lux-drive/harness.js` | **PASS - 44 checks passed, 0 failed** (212 s) |
| `node scripts/flows/luxdrive_world.mjs` | **PASS** - low 42 / medium **51** / high 54 draw calls (limits 140 / 200 / 240; the brief: medium <= 260), 154k / 174k / 201k triangles |
| `node scripts/flows/luxdrive_holes.mjs` | **PASS** - 0 hole pixels over 72 poses (see PROGRESS.md for the final run) |
| `node scripts/flows/luxdrive_ui.mjs` (new) | **PASS** - ~110 checks: menus, languages, random defaults, chooser, pause freezes the car, touch (2 sizes, multi-touch, no scroll / zoom), map + teleport x3, stepper, car (wheels, lights), handling, unstick, no console errors |

The flows count their loops in **game seconds** (`window.__lux.clock()`), not frames or wall time, so they give the same answer on
a Mac and in this container (the old frame-counted loops drove 10x too far at 3 fps and "failed" the kerb check). Playwright is
found through `PLAYWRIGHT_DIR` (the flows never used `browser-slot.py`, so nothing to switch).

## Pictures (this folder)

`01-menus.jpg` start (lb), language chooser (de), pause, settings, in-game chooser, help · `02-touch-and-rain.jpg` touch at
both sizes with fingers down, rain at dusk · `03-kaart.jpg` map, zoomed out, street level, after a tap · `04-night.jpg`
headlights and tail lamps · `05-car-vs-reference.jpg` the car next to a real hatchback (VW Golf VII, Wikimedia Commons,
KarleHorn, CC BY-SA; reference only, never shipped).

## What still looks wrong / is not done (honest)

* **Not tested on a real iPad / WebKit.** Only Chromium with touch emulation. Frame rate cannot be measured here (software
  GL); only draw calls / triangles are. The stepper thresholds (27 ms / 15 ms) are reasoned, not measured on a device.
* **Speed limits are class defaults**, not OSM `maxspeed`: the baked roads do not carry the tag and Overpass was not reachable
  from the container. Real 30 zones and the 70 / 90 zones of the city motorway stretches are therefore wrong in places. The code
  already prefers `road.maxspeed` (km/h) when a bake provides it.
* **Luxembourgish was written by me, not proof-read by a native speaker.** Please let Ian check: *Owenddämmerung, Terrain,
  Vitesslimit, Haftung, Wollekeg, Hannert dem Auto, Elo op {name}*.
* The hatchback is simplified: the hood is long and low, the tailgate is slanted, the greenhouse is a little short compared with
  the Golf. It reads as a hatchback from the chase camera, not up close.
* Tapping the map also picks service roads, tracks and pedestrian plazas (all are drivable in the data); Place de l'Europe is a
  closed pedestrian ring, the car then faces along the ring.
* The rain is a 2D overlay (CSS streaks), not on the windscreen; there is no sound.
* Seen in passing, **not my scope**: the pavement / kerb paint along some streets is a zig-zag of light-grey triangles
  (`02-touch-and-rain.jpg`, left), the Kirchberg verges are pale concrete-grey, night is very blue.
