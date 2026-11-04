# Lux Drive - the city finish (branch `lux-drive-city`)

Cloud session, Claude.  Everything below was done on this branch from the shipped data (`pb/lux-drive/data/`); the raw LiDAR / LOD2 / OSM
`.pbf` are not in the container, so nothing was re-baked.  The pictures are in this folder (`m1` ... `m6`, each <= 300 kB).  They were made with
`scripts/luxdrive/shotd.mjs` (a screenshot daemon: one page stays open, poses go in over HTTP), software GL, medium quality, 1180 x 820, noon.
Software GL renders about a frame a second, so the daemon builds the world around the camera in plain loops before it shoots (the same tiles and cells
the game builds, only not at 3 tiles per frame).

## What I did

| # | task | result |
|---|---|---|
| 1 | verify the start | **OK, measured by the flow.**  Avenue John F. Kennedy, asphalt, 1.02 m right of the centre line of the 7.2 m carriageway, heading = direction of the way, 91 m from the middle of Place de l'Europe, not on the plaza (`m1`, `m3_spots_a`) |
| 2 | Luxtram | real line from `lines.bin` (2 x 12.5 km, 22 stops per track), grooved slab / grass bed, catenary, up to 44 platforms with shelters (not where a carriageway would run through them), 3 CAF Urbos vehicles on their rails, stop at stops, brake for a car, car collides with them (`m2`, `m6`) |
| 3 | parks | mown lawn with soft stripes, 594 benches beside the park paths, OSM park trees and footpaths (`m4`) |
| 4 | street lights | 9 054 lamps along the urban streets, instanced, lit head + warm light pool at dusk / night, solid for the car (`m6`) |
| 5 | city LOD | cells beyond 420 m (medium) use a cheap vertex-colour material (no window bands), the city now reaches 1300 m (was 520 m) at 74-139 draw calls (`m4`) |
| 6 | look fixes | straight kerbs / pavements (`m1`), markings cut before junctions, fields as a patchwork of crops, no grey wash from empty `urban` plots (`m4`) |

Details (what is built how, and why) are in `pb/lux-drive/PROGRESS.md`, section "City finish".

## Gates

| gate | result |
|---|---|
| `node scripts/flows/luxdrive_world.mjs` | **PASS**, 73 checks, 0 failures: boot without console errors, 11.13 MB data, the start (above), drive 33.7 m / 70 km/h on tarmac, camera 3.65 m above the ground, ride height never sunk / floated, painted asphalt within 1.5 m of the OSM width on 14 sampled roads, kerb crossing, ground beside roads, Nei Bréck / Roud Bréck / A1 decks, edge of the area, budgets |
| `node scripts/flows/luxdrive_holes.mjs` | **PASS**, **0 hole pixels** below the horizon over 72 poses; the self-test (one 32 m tile removed) reports 42 741 hole pixels, so the detector works |
| `node pb/lux-drive/harness.js --quick` | **PASS** (see `HARNESS_RESULT` below).  A-G unchanged and green; the new section H (Luxtram, lamps, benches) is green |

`HARNESS_RESULT`: see the end of this file (filled in by the last run).

### Draw calls and triangles (medium quality, steady state: every tile and cell built, 5 s of frames)

| spot | draw calls | triangles | building cells |
|---|---:|---:|---:|
| start / Place de l'Europe | 137 | 382 477 | 106 |
| Avenue J.F. Kennedy | 139 | 387 366 | 103 |
| Hamilius (Boulevard Royal) | 85 | 288 167 | 43 |
| Gare (Place de la Gare) | 93 | 292 949 | 43 |
| Grund (Rue Munster) | 91 | 306 563 | 39 |
| Pfaffenthal (Rue Vauban) | 99 | 300 576 | 40 |
| Oberanven (Rue Andethana) | 91 | 280 714 | 40 |
| A1 at Senningerberg | 87 | 252 055 | 34 |
| field near Ernster | 74 | 225 095 | 17 |
| limit of the brief | <= 260 | | |

The worst case is the dense Kirchberg (103-106 cells in reach).  What this branch adds to the draw calls: the Luxtram vehicles 3 (instanced), the track chunks within 700 m (one mesh per bed and one per catenary
per chunk), the platforms 1, street lamps 2 (lamps + light pools, night only for the pools), benches 1.  The world flow measures 32-36 draw calls at the three qualities because it counts
2 s after boot, when the world is still building on a machine without a GPU: the table above is the steady state.

## What the photographs said (reference photos: Wikimedia Commons, licences below; NOT in the game)

* **Luxtram livery.**  My first model was white with turquoise doors.  The photograph (`m2`, top left) shows a **silver-grey body, one band of dark glass (windows
  and doors together) and a dark windscreen**.  The model was repainted: silver, dark glass, the turquoise only on the chin of the nose and as a thin
  stripe low on the side (the colour Ian asked for on the front).  Pantographs on the 2nd and 4th section, lit windows at night.
* **Track on a bridge** (Pont Rouge photo): concrete slab, rails with grooves, low platform beside it.  The slab bed (light grey, dark grooves) is that.
* **Place de l'Europe paving**: calm grey-beige slabs with fine joints: the existing painted paving matches that calm look.
* **Grund**: ochre / sandstone walls, dark slate roofs, green valley (see "still wrong").

## What still looks wrong (honest list)

1. **Grund walls are grey, not ochre.**  Rue Munster (`m3_spots_b`, `m5`): the apartment style uses the grey `BLOCKS` palette of `building-mesh.js`; the real Grund is ochre
   sandstone.  That palette belongs to the building owner; I did not touch it.  Pfaffenthal (cream / ochre) looks right.
2. **The pale paving blob next to the start** (steps + footways + the pedestrian way "Place de l'Europe", all `stone`, 2-10 m wide) still has a lumpy outline: the
   OSM ways themselves wiggle (a stroked polyline, not the polygon of the square).  The edges of every *road* are now straight; this one is data.
3. **Sawtooth in a narrow median** (A1 at Senningerberg, `m3_spots_b`): the grass strip between the two carriageways has a toothed edge at 2 m spacing; the union distance
   of two nearly parallel carriageways is creased exactly there.  Cosmetic, from the driver's seat it is a texture.
4. **Trams: two vehicles can share a crossover** for a few tens of metres (the line has real crossovers; the two tracks are chosen right-hand, but a crossover
   belongs to both).  They never run into each other (the harness measures >= 5 m clear in 20 minutes of the line) because they keep a safety distance on the
   same track, but a tram on the other track could pass through one standing on a crossover.  The Findel branch is drawn, not driven.  Terminus turn-back is "out of
   sight for 16 s", not drawn.
5. **No tram bell / sound**, no pedestrians on the platforms.
6. **Tram windows at night are one amber colour**, no passengers.  The nose is a faceted wedge, not the rounded Urbos mask.
7. **Bench / lamp / pole collision** is a circle (0.22 m / 0.8 m): a car that hits a lamp at more than 9 m/s is a crash and respawns, like a tree.
8. **Software-GL only**: I could not measure frame times on a GPU or an iPad.  The cost argument for the city LOD (cheap fragment shader far away, same triangles) is
   structural, not measured in ms.  The memory of the far ring (up to ~100 cells of vertex data) was not measured either.
9. The thin green vertical lines in some pictures are trees in their 0.45 s grow-in animation (the game clamps a frame to 0.1 s, software GL renders 1 frame / s), not a bug of this branch.

## Files of this branch (new)

`tram-network.js`, `tram-sim.js`, `tram-view.js`, `tram-parts.js`, `part-builder.js`, `part-material.js`, `street-lights.js`, `street-light-view.js`, `park-benches.js`,
`bench-view.js`, `props.js`; changed: `road-network.js`, `heightfield.js`, `surface.js`, `tile-mesh.js`, `terrain-view.js`, `ground-shader.js`, `world-map.js`,
`building-mesh.js` (wall drop), `building-view.js` (LOD), `config.js`, `main.js` (small, marked hooks), `harness.js` (section H), `pb/lux-drive.html` (`main.js?v=17`).
Tools: `scripts/luxdrive/shotd.mjs` (screenshot daemon), `scripts/luxdrive/shot.mjs` (one-shot), `scripts/luxdrive/montage.py`; `scripts/flows/lib.mjs` finds the Linux
Chromium and starts it with SwiftShader; `luxdrive_world.mjs` steps the physics instead of timing it, `luxdrive_holes.mjs` builds the tiles in a loop (both work on the Mac too).

## Reference photographs (not shipped in the game)

* Luxtram on Pont Rouge - "Tram Luxexpo pont rouge.jpg", Procrastineur49, CC0 - https://commons.wikimedia.org/wiki/File:Tram_Luxexpo_pont_rouge.jpg
* Grund und Eglise Saint-Jean - Wikimedia Commons, CC BY-SA 4.0 - https://commons.wikimedia.org/wiki/File:Luxembourg_(LU),_Grund_und_%C3%89glise_Saint-Jean_--_2023_--_8132.jpg
* Luxembourg Kirchberg pl Europe Congress Center - Cayambe, CC BY-SA 3.0 - https://commons.wikimedia.org/wiki/File:Luxembourg_Kirchberg_pl_Europe_Congress_Center_01.jpg

## HARNESS_RESULT (last run, `node pb/lux-drive/harness.js --quick`, 263 s)

`PASS  61 checks passed, 0 failed`.  New numbers of section H: 2 tracks of 12.5 km, 22 + 22 stops, 0 tram samples inside a house (viaducts that carry the
track excluded), top speed 17.0 m/s, 9 054 street lamps (0 in a house, 0 in a carriageway), 594 park benches (0 in a house or carriageway).
