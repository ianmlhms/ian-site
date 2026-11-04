# Landmarks (branch `lux-drive-landmarks`) — report

## What was done
New modules (all pure geometry, no THREE except the view): `landmark-soup.js` (flat-shaded solids), `landmark-palette.js`,
`landmark-util.js`, `landmark-bridges.js`, `landmark-buildings.js`, `landmarks.js` (registry, hide lists, collision walls),
`landmark-view.js` (one mesh per landmark, shared solid material). Hooks in `main.js` (v=17), `buildings.js`,
`building-view.js` (hidden block ids), `harness.js` (landmark checks + deck fix).

| landmark | state |
|---|---|
| Pont Adolphe | stone arch (84.65 m span) with spandrel arcade, balustrade, lamps, cycle footbridge with brackets; valley open; car kept on the deck by collision walls |
| Pont Grande-Duchesse Charlotte | red steel box girder, two splayed-leg pylons, concrete abutments, tram bed, masts; deck ends carried on to the approach road (the baked ends made a 27° ramp) |
| Philharmonie | ellipse of 60 white columns, glass drum, roof slab; replaces the LOD2 block |
| Cour de justice | bronze podium + 3 towers (108 / 108 / 132 m); replaces 5 LOD2 blocks |
| Cathédrale Notre-Dame | limestone body, slate roofs, buttresses/windows, 3 spires (screenshots are from BEFORE the buttress detail) |
| Palais grand-ducal | sandstone block with slate mansard + corner tower |
| Gëlle Fra | obelisk with the golden figure |
| Oberanven church | block + gable + tower (built, not yet looked at in the browser) |

## Gates (software WebGL in a cloud container)
* `harness.js`: **47 checks passed, 0 failed** (landmark checks: nothing floats, no invisible collision left on replaced blocks, 13 997 triangles).
* `luxdrive_world.mjs`: all checks ok except two that fail **identically on the untouched `lux-drive` branch** in this container
  ("the car drove 1.6 m" / "did not fly over the kerb": the scripted drive is time-dependent and software GL runs at a few fps).
  Draw calls: low 45 / medium 48 / high 49; triangles medium 162 871. Landmark meshes cost at most 8 draw calls.
* `luxdrive_holes.mjs`: **PASS, 0 hole pixels over 72 poses**.

## Honest list of what is wrong / missing
* **No reference photos**: Wikimedia was rate-limiting this container, so no side-by-side photo comparison was done. Pont Rouge pylon shape,
  the Adolphe arcade rhythm, the ECJ tower positions and the Cathedral spire layout are from memory and the LOD2 footprints.
* **Not built**: Bock/casemates walls, Viaduc (Passerelle), Kirchberg Coque, Mudam/Fort Thüngen, Grund bridge, BCEE tower.
* Cathedral reads as a plain box from a distance; Palais is a simple mansard block; the ECJ podium is crude and the tower stripes are heavy.
* Pont Rouge: a short step remains where the road meets the abutment at the east end.
* 193 of 604 baked deck ends elsewhere in the city have the same cliff-pinning ramp as the Pont Rouge had (not touched, outside scope).
* The camera shots used for the montages are single poses; the Palais shot sits inside neighbouring buildings and shows nothing useful.
