# Landmarks, round 2 (branch `lux-drive-landmarks`, worked on `claude/lux-drive-landmarks-n1avfm`) — report

Round-1 report is kept at the bottom. Montages of this round: `r2_01 … r2_04` (software GL, 960x600 per shot, camera 3.2 m over a road
unless noted).

## 1. Stray poles — root cause found and fixed
`tree-view.js` divided the baked tree girth by 100 a second time (`world-data.js` already turns the byte into 0.52..0.95), so every
street / park tree of OSM was a 0.5 % wide needle 15-25 m tall with its crown squeezed into the stick: the green poles in the lawn and
the "dark sticks" on the Philharmonie plaza. Found by hiding the `trees*` meshes (the poles vanished). Fix: the girth is crown width / height
(`CROWN_WIDTH` = 0.66 of the model). The city branch did not fix this. Effect: the street trees are real trees now, quite dark / large
(not my scope, but they hide a lot of landmarks in Park Dräi Eechelen).

## 2-5, 7 landmarks (what changed)
* **Cour de justice**: black-glass long low podium (13 m) with bronze mullions, three towers (108 / 108 / 128 m) clad in vertical anodised
  bronze fins on a dark-bronze body. Overpass was unreachable from the container (only `overpass.osm.ch`, Switzerland only, answered), so tower
  **positions are estimated**, not taken from OSM `building:part`: Nominatim gave me the old palace outline (`way 24457478`, 27 m) and the
  complex centre; the LOD2 bake has the whole complex as lumps (eave 28 m) with no towers. Honest status: plausible, not verified.
* **Cathédrale**: pale yellow-grey sandstone, lancet windows + buttresses on every edge, plinth and cornice, pointed portal and tall window on the front,
  two slim front towers and the crossing needle in almost black slate (octagonal spires, pinnacles), slate-grey roofs.
* **Philharmonie**: 168 slim white columns in a dense ring, grey drum behind (no blue), white roof slab.
* **Palais grand-ducal**: facade on the street edge facing the Krautmaart (found from the road names): ochre stone with dark bands, two storeys of
  windows with stone surrounds, ground-floor arches, two corner oriel turrets with black slate caps, a central pavilion, steep slate roof with dormers.
  The real facade is longer than the 31 m edge of the LOD2 block.
* **New**: Bock (stone skin + parapet + bastions + dark casemate mouths draped on the cliffs found from the terrain), Passerelle / Al Bréck viaduct (2-tier
  arcade, 20 bays, rail, deck of the bake), Coque (low wide shell on the OSM outline), Fort Thüngen (OSM outline walls + 3 domed round towers; **tower
  positions are guesses**: three farthest corners), Mudam (limestone body + glass hall prism on the OSM outline), BCEE clock tower + block at Place de Metz.
  Footprints from Nominatim (OSM, ODbL) are embedded in `landmark-site-data.js`.

## 6. Montage poses
`scripts/luxdrive/pick_pose.mjs` picks a road point with no house / landmark wall / wood tree / baked-tree crown within 8 m (building clearance 2.5 m in
the Palais street, which has no 8 m of free space) and a clear sight line (houses, tree crowns). Thüngen / Mudam / Coque were taken at 12-14 m camera height
(a bus-top view) because the park trees block every road-level view; they are still on roads.

## 8. Reference photos
**Not done.** Commons / Wikipedia API answered HTTP 429 from this container for the whole session even at 1 request / 5-30 s
(`scripts/luxdrive/fetch_ref.py` retries with back-off and was left running; nothing arrived). No side-by-side comparison with photos was possible; the
shapes come from memory and OSM outlines.

## Gates
| gate | result |
|---|---|
| `pb/lux-drive/harness.js --quick` | **64 passed, 0 failed** (the "no landmark floats" check now measures every vertex against the land under it; the old bbox-corner version false-positived on cliffs) |
| `luxdrive_world.mjs` | **PASS**, 73 ok, draw calls low 49 / medium 50 / high 43, triangles medium 166 001 |
| `luxdrive_holes.mjs` | **PASS**, 0 hole pixels over 72 poses (self-test 42 741) |
| landmark triangles | 35 127 total of 60 000 (14 landmarks) |

## Still wrong (honest)
* Tree crowns are very dark and hide Fort Thüngen / Mudam / Coque from the ground; those three are barely visible in the montage.
* ECJ tower positions and Fort Thüngen tower places are estimates; the Palais facade is short; Mudam is a box + glass roof, not Pei's geometry.
* Bock skin is a draped overlay on the terrain (can look like pale slabs; terrain LOD may poke through by < 1 m); casemate mouths are flat dark quads.
* Passerelle: two lower footway decks of the bake (ids 11, 14) were left drawn by the generic deck view; not checked for clipping against the arcade.
* Philharmonie columns read grey in shade (lighting), the drum is a plain cylinder.
* No photo comparison (see 8).

---
## Round 1 report

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
