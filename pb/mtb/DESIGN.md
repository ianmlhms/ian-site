# MTB Mëllerdall: design document

Status: W1 built (data pipeline, crack-free terrain, painted ground, zero-holes harness, first rideable bike on one trail). Everything else below is the plan for W2..W7; sections say what exists today.
Branch `mtb`, worktree `/Users/Ian/Library/Caches/website-mtb`. Reference photos (not in the repo, copyright): `/Users/Ian/Library/Caches/mtb-refs/`. Raw downloads: `/Users/Ian/Library/Caches/mtb-work/`.

## 0. The one-paragraph game

You ride a mountain bike through the real Mullerthal ("Mëllerdall", Luxembourg's Little Switzerland): the sandstone gorges around Beaufort, Haller, Berdorf and Müllerthal village, on the real paths, over the real LiDAR terrain, in a world that is painted, not photographed. Pick a trail (green, blue, red, black), beat the clock with checkpoints and medals, race your own ghost, or free-ride the whole valley and find viewpoints. The bike feels like a bike: you pedal, brake front and rear, lean into berms, pump rollers, pop off lips, and crash softly.

Ian's binding wishes, in the order they shaped the design: really 3D and really good; ground painted and animated by us, no satellite images; **no sudden holes in the ground** (the tram simulator's sin); bigger than Schueberfouer Tycoon, smaller than the train simulator; weather and time of day always player-choosable and never changing rewards; opens and is understood at once; runs on school iPads.

## 1. First ten seconds (no menu, no wall of text)

1. 0 s: loading bar (own, honest steps: terrain, hills, paths, trails, forest, world), a bike emoji, the game name.
2. 1-2 s: the world fades in with the rider already standing at the start of the first trail, camera behind, golden-ish light. HUD: speed top right, trail name + progress top left, nothing else.
3. A single pill at the bottom: "W / up pedal . A D steer . S brake . Space jump" (touch: "Steer on the left, pedal on the right"), gone after 14 s or as soon as the rider pedals. No tutorial level, no popup.
4. The first trail (Hallerbaach-Flow, blue, mostly downhill) is forgiving: wide bed, banked turns, the bike keeps rolling.
5. From W3 on: a start card (trail, medal times, best), then three lights ("3 2 1 Go") instead of an immediate start in trail-run mode; free ride starts immediately.

## 2. The world

Real place, painted 3D. All geometry and colours are ours; only the *shape* (LiDAR), the *layout* (OSM paths, land cover, buildings) and the *landmarks* (modelled by hand, checked against real photos) are real.

- **Box**: 11 x 11 blocks of 512 m = **5.632 km x 5.632 km** (31.7 km2). North-west corner = LUREF (87900 E, 100308 N); frame x = east, z = south, y = up, metres, one frame for everything (render, physics, data). The playable area is the box minus a 192 m border (an invisible wall turns the rider back softly); the 128 m border is a feather between the 2 m LiDAR and the 32 m distant hills.
- **Contains**: Beaufort (castle ruin + renaissance castle, x 570-620, z 370-390), Haller (x 350, z 1930), the Haupeschbaach / Hallerbaach gorge with its sandstone walls (Brenschenterlay viewpoint x 1230, z 1470), the Black Ernz valley, Berdorf (x 5100, z 1790) with the rock labyrinth (Raiberhiel x 4340, z 1350, Adlerhorst, Teufelsinsel, Totenkammer, L'Enfer / Wolfsschlucht, Rotzbachschlüff, Binzeltschlüff x 3910 z 2110, Werschrummschlüff, Kippiglay), Müllerthal village (x 2030, z 5320) and the **Schiessentümpel waterfall with its little stone bridge** (x 2000, z 4990, just north of the village). Consdorf lies 1.4 km south of the box and shows as a fogged village on the horizon.
- **Beyond the box**: a 32 m distant-hills field reaching 8 km out on every side, painted like the forest, melting into the sky colour. There is never a void (section 5).
- Villages (W4): painted houses from OSM footprints (2182 buildings in the box), height from LiDAR DSM - DTM, simple roofs and chimneys, no LOD2 needed.

## 3. Data pipeline (scripts/mtb/, rerunnable, documented in each file)

Venv: `/Users/Ian/Library/Caches/luxtram-work/.venv` (numpy rasterio shapely pillow pyproj scipy). Raw downloads are cached outside the repo; baked data lives in `pb/mtb/data/`.

| Step | Script | Output (in pb/mtb/data unless noted) |
|---|---|---|
| OSM | `fetch_osm.py` (Overpass, mirror rotation, two tiles: north + south strip) | `~/Library/Caches/mtb-work/osm/*.json` |
| LiDAR | `fetch_lidar.py` (LiDAR 2024 DTM + DSM cloud-optimised GeoTIFFs on data.public.lu, range requests, area-averaged overviews) | `mtb-work/raw/dtm2.npy dsm2.npy far32.npy` |
| terrain | `bake_terrain.py` | `terrain.bin` (2 m nodes, 2817 x 2817, 0.1 m steps, de-spiked), `far.bin` (32 m, box + 8 km), `canopy.bin` (8 m: mean canopy height, covered fraction), `terrain.json` (checksums) |
| trails | `bake_trails.py` over `trails.def.json` | `trails.json` (the named trails as polylines) |
| ways | `bake_ways.py` | `ways.bin` + `ways.json` (all other paths, tracks, roads; trail edges cut out) |
| land cover | `bake_classes.py` | `classes.bin` (4 m run-length raster: forest, meadow, farmland, built-up, water, rock, scrub), `landmarks.json` |
| dev tools | `mapcrop.py` (labelled hillshade + ways, to pick trail waypoints), `shot.mjs` (headless screenshots / poses) | |

**Formats.** `terrain.bin` / `far.bin` / `canopy.bin` use the block-packed grid "MBG1" (`scripts/mtb/codec.py` encoder, `pb/mtb/codec.js` decoder): quantised, planar prediction, 8 x 8 blocks with a 4-bit width and zigzag residuals. The JS decoder reproduces the Python checksum bit for bit (checked at every load and by the harness). `ways.bin`: u16 point count, int32 start (decimetres), varint zigzag deltas. `classes.bin`: u16 nx, u16 nz, (value, varint run) pairs.

**Data budget (W1 actual)**: terrain 2.78 MB, far 0.21 MB, canopy 0.54 MB, classes 0.12 MB, ways 0.05 MB + 0.09 MB json, trails ~3 KB = **3.8 MB** for the whole world, loaded once (the flow asserts <= 6 MB). Terrain is one file today; if school wifi needs it, it can be cut into 1024 m regions without touching the format (the grid codec works on any rectangle).

**Trails** are routed, not drawn: `trails.def.json` lists an id, a colour, four names and via points (world metres); `bake_trails.py` finds the cheapest route over the OSM way graph (paths preferred, a grade penalty per colour so a blue trail avoids a 45 degree scramble, no out-and-back, spurs removed). Every trail is therefore a real path. Output: the node chain, length, climb, descent, steepest 20 m.

## 4. The six trails (W2 bakes all of them; W1 has the first)

| id | colour | idea | region |
|---|---|---|---|
| hallerbaach-flow | blue | **built (W1)**: 2.9 km, 90 m of descent, rim path then the gorge floor, a flowing run with berms | Haller gorge, x 400-2500, z 1320-1760 |
| aesbaach-rondell | green | 1.5-2 km beginner loop on wide forest tracks near the village, no drops | around Haller / Beaufort plateau |
| rotzbaach-rocks | red | technical: sandstone corridors, steps, roots, a short rock slab | Berdorf rock labyrinth, x 4200-4500, z 1200-1500 |
| binzelt-black | black | steep descent through the Binzeltschlüff and Werschrummschlüff clefts, drops, a gap jump | x 3900-4000, z 2100-2300 |
| schiessentuempel | blue/red | down the Black Ernz valley to the waterfall and over its stone bridge, ends at the cascade | Müllerthal village, x 1900-2100, z 4900-5300 |
| maratoun | red | the **Mëllerdall Marathon**: the official MTB loop (`mtb/gpx/beaufort-berdorf.gpx`) stitched over the other trails, ~20 km, medals by time | the whole box |

Trail "features" (kickers, drops, rollers, berms, wooden bridges, rock slabs) are stylised additions along the real path (W3): `trails.def.json` gets a `features` list (`{ s, kind, ... }`) that modifies the bed profile of the carve (section 5) and adds closed solids (bridges). Weather and time of day never touch times, medals or scores.

## 5. Zero holes: the architecture

Ian's complaint: sudden holes in the ground in the tram simulator. The design makes holes impossible and the harness proves it.

1. **One function.** `height(x, z)` (`heightfield.js`) is the single source of truth: bicubic LiDAR + 2 octaves of micro relief, with the way network carved in. It is defined for every (x, z) on the plane, finite everywhere (the far field is clamped beyond its data), continuous.
2. **The trail is carved into it** (`trails.js`), never a ribbon on top: each way has samples every 1-2 m with a bed height (the terrain smoothed along the way), a cross tilt (half-bench on a side slope, banking in turns) and a berm on the outside of a bend. `carve(x, z)` SUMS the smooth kernels of all samples, so where two ways cross, where a way doubles back (hairpins) or ends there is no "nearest wins" step. Any decal on top reuses the same samples + polygon offset.
3. **One lattice for render and physics.** The physics surface (`surface.js`) is the 1 m lattice of `height()` in 32 m blocks with a fixed triangulation (diagonal by lattice parity). LOD 0 render tiles are built from the very same block arrays and the same triangulation, so render == physics by construction; the harness checks it independently through the built vertex buffers.
4. **Quadtree LOD, crack free** (`quadtree.js`, `tile-mesh.js`): one CDLOD quadtree over a 32 km root, tiles of 32 x 32 cells (32 m / 1 m ... 8192 m / 256 m). A node splits while the rider is within `size * 1.0` of it, so the rider's whole 3 x 3 tiles are always LOD 0 (>= 32 m margin). Stitching is exact: a boundary vertex that touches a **coarser** tile takes the value of that tile's edge polyline (corners included); a skirt hangs under every edge as a second line of defence. The harness measures neighbours of every LOD pairing along the whole shared edge: worst difference 2e-5 m over 1,000,000+ samples.
5. **The camera cannot go below the ground**: `camera.js` keeps the camera >= 0.55 m above the physics surface and shortens the boom until six probes along it clear the ground. Since the tiles around the rider are the surface, the picture cannot show the inside of the hill.
6. **No far-plane void**: tiles exist out to the view distance; the sky dome's horizon colour is the fog colour, and beyond the far plane the hills fog to exactly that colour.
7. **Solids** (W3+): bridges, boardwalks, rock slabs are closed boxes/prisms sunk into the ground (no visible gap under or beside them); the harness checks that each solid's footprint is covered by `height()` +- tolerance.
8. **Scale of numbers** (W1): 2 m LiDAR nodes de-spiked (31..40 single-node pits/peaks > 2.5 m clipped), LOD 0 lattice 1 m, trail bed 0.9-1.1 m wide, surface blocks cached per 32 m.

**Checks**: `node pb/mtb/harness.js` (A data, B partition, C cracks, D render == physics, E trails, F camera, G bike), `scripts/flows/mtb_holes.mjs` (renders 72 camera poses along and off the trails, up to 120 m high and at the world edges, with the sky off and a magenta clear colour; magenta pixels whose ray meets the ground within 6 km are holes; a self-test hides one tile and must see holes), `mtb_world.mjs`, `mtb_ride.mjs`.

## 6. Bike physics (`bike.js`)

A rider + bike point mass (86 kg) on the physics surface, fixed step 1/120 s, pure functions (state replaced, never mutated).

- Pedal: P / v (210 W) capped by 330 N and by rear traction (0.55 mu g). Braking: front+rear blended, 7.4 m/s2 at best, limited by grip. Rolling resistance by ground (trail dirt 0.013, forest floor 0.05), drag CdA 0.52.
- Steering: kinematic bicycle (wheelbase 1.12 m); the bar angle halves at 5.5 m/s so high speed means leaning, not turning the bars; the lean angle is the one that balances the centripetal acceleration. Grip: the velocity is dragged toward the heading with at most grip x g; beyond that the bike slides and scrubs speed.
- Contact: free body with gravity, pushed out of the ground; it sticks over drops up to 7 cm (suspension travel) and leaves the ground over crests and jumps; landing speeds cost energy (> 7.5 m/s normal speed).
- Jump: hold Space to pre-load (0.32 s), release to pop (up to 3.6 m/s); in the air no steering authority.
- W3+: front/rear brakes separately (touch: brake button = blended), pump on rollers (shift weight on Space tap, extra speed), manual/wheelie is *not* planned, crashes (impact > 11 m/s, rider off a ledge, tree) trigger a soft stylised tumble and a respawn at the last checkpoint within 1.5 s, never frustrating. Four bikes (W5): hardtail (light, no travel), trail, enduro, downhill (heavy, grips, 200 mm), with visible fork travel and different mass / grip / drag numbers in `config.js`.
- Weather: rain and fog multiply grip (-28 % at full wet); the numbers are the same for everybody, the medal times are set for dry ground.

## 7. Camera

Chase camera (default): 3.6-4.7 m behind, 1.65 m up, looks 1.2 m ahead, heading lags by `dt * 3.2`, FOV 62 degrees widening to 75 degrees with speed, vertical smoothing so bumps do not bob it. Helmet cam (W5, key C): eye on the helmet, slight head shake, larger FOV. Cinematic replay (W5): at the finish, a spline of low shots along the ghost of your run. Shake and wind audio scale with speed above 10 m/s.

## 8. Controls

| | Keyboard | Touch | Gamepad |
|---|---|---|---|
| steer | A D / left right | thumb on the pad bottom-left (168 x 76 px), drag | left stick |
| pedal | W / up | big green button bottom-right (84 px) | RT / A |
| brake | S / down | square button (64 px) | LT / B |
| jump | Space | arrow button (64 px) | X |
| back on trail | R | menu button (W3) | Y |
| camera / time / weather | C / T / G | HUD buttons (W3) | |

Touch rule (Ian's complaint in another game): controls together cover < 15 % of the screen, nothing in the middle; the flow asserts this and that every control is >= 44 px.

## 9. Modes and progression (W3-W5)

- **Trail run**: time trial with checkpoints (every 400-600 m), bronze / silver / gold medals set per trail by the harness's scripted rider (gold = 85 % of a clean scripted run on dry ground), your best-run **ghost** (a translucent rider; positions recorded at 10 Hz into ~3 KB of the save), restart with one key.
- **Free ride**: the whole valley; collectibles: 40 viewpoints (the real OSM viewpoints and landmarks), each a small painted flag you ride through, the Mullerthal has no established mascot, so we invent one: a small **fox** (Roudi) who sits at the viewpoints and in the loading screen.
- **Daily challenge**: seeded trail + time of day + weather (all three shown, the player may still change weather and time of day for fun but the daily board is dry-noon only), arcade daily board.
- **Progression**: not grindy. Medals unlock trails in order green -> blue -> red -> black -> waterfall -> marathon (one bronze each). Bikes: hardtail from the start, trail after 3 medals, enduro after 8, downhill after 14; colours and helmets are cosmetic unlocks by medals. All unlocks are visible on one screen, no currency.

## 10. Art direction: painted, animated

Display-space shading (output colour space linear = no sRGB conversion): colours are authored as they should look. Light = sky/ground ambient + sun with a soft banded ramp (22 % toward 4 steps = gouache), a soft shoulder instead of clipping.

- **Ground** (`ground-shader.js`, `paint-textures.js`): hand-drawn canvas textures (leaf litter, moss + ferns, trail dirt, sandstone, grass), no photos. Sandstone strata are read from the world height (horizontal bands, vertical weathering streaks, moss on ledges), steep faces are mapped from the side so the paint does not smear. Trail dirt where the carve coverage is high with a ragged, leaf-littered edge. The forest floor is dappled with moving sun flecks under the canopy and cloud shadows drift over the land (animated). From afar the forest is its painted canopy.
- **Trees** (`tree-models.js`, `forest-view.js`): beech (broad lumpy crown, smooth trunk) and spruce (stacked cones), two detail levels, wind sway in the vertex shader, placed per 32 m block from the LiDAR canopy height and cover, never on a way.
- **Sky** (`env.js`): gradient + sun + noise clouds that drift, stars at night. Times: dawn, morning, noon, evening, dusk, night. Weather: clear, cloudy, fog, rain (rain particles W5); autumn colours are a W6 option (the real forest turns in October).
- **Water** (W4): painted animated shader on the Ernz, Hallerbaach and Schiessentümpel cascade (flowing noise, foam at rocks), stepping stones.
- **Life** (W4-W5): falling leaves, birds, butterflies in sun, other riders and hikers on some trails (simple, they move), signposts in the Mullerthal style (generic, no logos), roots crossing the trail (bed bumps + painted).
- **Palette notes**: leaf litter olive-brown rather than orange, sandstone warm ochre / pink, moss saturated, meadows muted yellow-green, distant hills blue-grey in the fog.

## 11. Landmarks and the reference-photo rule

Every real landmark gets one to two real photos (Wikimedia Commons via upload.wikimedia.org, kept in `mtb-refs/`, never in the repo) and a side-by-side montage (photo | our screenshot from the same viewpoint) before it is called done. List for W4: Schiessentümpel waterfall + stone bridge, Beaufort castle ruin, Brenschenterlay viewpoint, Raiberhiel / Adlerhorst rock arch area, Werschrummschlüff / Binzeltschlüff clefts, Wolfsschlucht, Berdorf church and village edge. The montages go to `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/<wave>/`.

## 12. Audio (W6): everything synthesised, no music with rights

Web Audio, like the other arcade games: freewheel ticking (pitch from speed), chain whir, tyre on dirt vs gravel vs rock vs wet (filtered noise, grip-dependent), wind rising with speed, birds (pitch-swept sines, daytime only), water (band noise near streams, louder at the waterfall), thuds on landings, rain, a soft beep for checkpoints and a short 4-note fanfare for medals. Mute key + the arcade's sound button.

## 13. UI and i18n

Luxembourgish first, then de, en, fr (`i18n.js`, same four languages as the other games; language from `pb_mtb_lang`, then the site's `site_lang`, then lb). HUD in the corners only. Menu (W5): trails, bikes, weather/time (Random default + persisted), quality (auto + manual), language, controls help. In game: HUD buttons and keys T / G for time / weather. No real brand names anywhere (generic bikes, generic signposts).

## 14. Save, score, leaderboard, arcade tile (W5-W6)

- **Save** `pb_mtb_save` (localStorage) + cloud through the arcade's `game_saves` (jsonb <= 8192 bytes, same pattern and guard as Schueberfouer's `save.js`): medals per trail (2 bits each), best times (ms, base-36), unlocked bikes/colours, settings, ghosts for the **three** best-attended trails only (delta-coded 10 Hz, about 3 KB each, the rest are re-recorded), total < 7 KB. Version byte, merge rule = per-field best, never lose progress (the fouer harness's migration tests are the model).
- **Score**: arcade games post `score` (higher is better, any finite number). Per-trail boards use the arcade's sub-board mechanism (`currentBoard`) with score = `10,000,000 - best time in ms` (a time trial where bigger is better needs **no SQL**: `merge_score_is_better` is higher-is-better for every game id not in its short list). Marathon and trail boards: one board id per trail id.
- **Daily challenge** needs a new game id in `submit_daily_score` / `daily_board` (they check `p_game = 'paket-express-daily'`): written as `scripts/mtb.sql` in W5 and handed to the reviewer, never run by the builder.
- **Tile**: `pixelbreak.html` GAMES entry `{id:"mtb", name:"MTB Mëllerdall", emoji:"🚵", thumb:"pb/thumbs/mtb.webp", featured:true, src:"pb/mtb.html", cats:["driving","action"]}` plus DESC_I18N lb / de / en and a painted 3:2 thumbnail made from a real in-game screenshot (webp, ~25 KB), in W6.

## 15. Performance budget

| | low | medium | high |
|---|---|---|---|
| target device | old school iPad | school iPad / laptop iGPU | desktop |
| pixel ratio | 1 | 1.25 | 2 |
| draw calls (flow-asserted) | <= 130 | <= 190 | <= 230 |
| triangles (flow-asserted) | <= 330 k | <= 520 k | <= 900 k |
| trees drawn (radius, density) | 90 m, 45 % | 150 m, 70 % | 220 m, 100 % |
| far tiles | coarser beyond 256 m | normal | normal |
| shadows | none (cloud + dapple shading only) | none | W6: one cascade |

Quality is auto-picked (coarse pointer + core count) and steps down by itself when frames take > 40 / 30 / 24 ms for 3 s (stored, with a manual override in the menu). Tile builds are budgeted (3 per frame), terrain blocks and trees are cached and bounded, the loop stops when the page is hidden, a lost WebGL context reloads the page. Data: 3.8 MB, decoded in about 1 s on a laptop (the iPad budget is checked on the Mac with CPU throttling in W7).

## 16. Test plan

- `node pb/mtb/harness.js`: the zero-holes checks (~30 numbered checks, ~15 s) plus a scripted rider on every trail.
- `node scripts/flows/run_all.mjs mtb`: world (boot, budgets, weather/time persistence, language, hidden tab, context loss), holes (browser hole detector), ride (scripted full ride + keyboard + touch). WebKit: `node scripts/flows/run_webkit.mjs mtb`.
- Screenshots and montages per wave in the overnight reports folder; every landmark with its reference photo.
- `python3 scripts/check_site.py` (no new warnings) and `cv_head.py` (PROBLEMS: 0) before each report.

## 17. Wave plan

| Wave | Content | Gate |
|---|---|---|
| **W1** (done) | this document, data pipeline, terrain + painted ground, harness, bike + chase camera on one trail, basic forest | harness, flows, screenshots |
| W2 | all six trails + checkpoints + medals + ghosts, trail features (berms/kickers/rollers), start/finish, crash + respawn | harness per trail (rideable by the scripted rider), medal times |
| W3 | full bike feel (separate brakes, pump, jump quality, suspension), rider animation (pedalling, standing, lean), speed sensation, bikes | physics unit checks, feel tuning notes |
| W4 | vegetation, landmarks with reference photos, water, villages, animated life, signposts | photo | screenshot montages |
| W5 | menus, i18n complete, weather/time chooser in game, save, scores, daily, tile + thumbnail, `scripts/mtb.sql` | save harness, flows |
| W6 | audio, touch polish, autumn option, shadows (high), performance and iPad pass | iPad-size screenshots, perf numbers |
| W7 | QA sweep, bug fixing, balance, final montage | everything green |
