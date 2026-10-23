# Polish wave 2 "Density, ground, walk fixes": notes (23 Oct 2026)

Goal (reviewer verdict after polish 1): the field read as a car park with holes from above, halos were big white blobs overhead, the ground was flat grey, the crowd was blocky, the walk had invisible walls and the budgets were tight.
Montages (before / after / reference): `website-overnight/reports/fouer/polish2/*.jpg`. No photos, no secrets, no new network assets in the repo.

## What changed
| # | item | change |
|---|---|---|
| 1a | **Free plots** | NEW `models/plots.js` `buildPlot`: an open (unlocked, still empty) pitch is a "free plot for rent": draped light gravel (2-3 m cells, tonal noise, a darker track from the gate), a low red-white barrier on three sides + the front (opening in the middle), a lit "FRÄI PLAZ" sign on two posts, a parked living trailer with crates / generator / skip bin (more for L / XL). One small w3 model per pitch in the normal contract, merged into the pitch batch (no extra draw call). `fair.js` builds it for `state: 'open'` (a pitch is now `applied` once, so `setPitch(id, {state:'open'})` always builds it). The gold hint outline / pulse of W2's markers still shows on top. |
| 1b | **Dense NPC fair** | `models/npc.js` `buildNpcFair`: after the old rows + greedy passes a new 0.5 m occupancy grid is packed with `packFree` (scan from the lower-left, every free corner picks a skin whose natural size fits the free run, a thin leftover is absorbed, nothing fits = a service strip of crates / pallets / gensets). Halls (+ new `tentS`, a small white gabled tent) dominate the NW restaurant section, the SE rim becomes a service lot. Locked S / M pitches are no longer one lonely stall in a 16 m slot: `pitchCluster` packs the whole slot (`packFree` again, own 0.5 m grid) on a steel-plate floor. Every stall stands on a ground pad (steel plate / rubber / decking / turf / tarp, corner heights follow the terrain) so the whole footprint reads as occupied. Built w3 rides get a slot floor (`dressPitch`), W4 rides a floor in the pitch batch (`buildFloor`), the wheel worksite gets gravel and is rotated the right way (it was 90 degrees off its slot). The filler leaves 0.45 m (was 0.7) round a pitch and 0.5 m (was 0.8) in front. Stalls far from the alleys / `low` quality are drawn as `simpleStall` (a box + a canvas gable, ~20 triangles; most roofs white like the photos). |
| 2 | **Halos** | `models/materials.js` bulb shader: the bloom shrinks from far above (`farK = smoothstep(14, 100, dist)`: bloom factor x0.3, pixel cap 58 -> 24, intensity x0.6) and big lamps (flood masts, pylons) bloom relatively less (`clamp(0.16 / aSize, 0.35, 1)`). Street level (< 14 m) is unchanged: the walk alley night shot is the same look. `world/glow.js`: ground overlay grid 4 -> 6 m, and skipped on `low`. |
| 3 | **Ground** | `world/glacis.js` `patchWear`: the two ground shaders (terrain splat + the merged surface material) get a worn-field term from the world position, gated on asphalt-like albedo and the field box: big soft patches (age / repairs), oil stains, long dark tyre streaks along the alleys, swept lighter alleys (`world.glacis.setWearAlleys`, called by `fair.js` with `CORRIDORS`), worn bay paint (more in the alleys), rain: `world.glacis.setWet(k)` (called by `sky.js`) = darker bluer surface with sky-coloured puddles. No texture, no extra draw call (low keeps the patches at half strength). The faded parking-bay paint is dropped from the ground decor wherever a stall, pitch or plot covers it (`cullFieldBays`, only alleys keep it). |
| 4 | **Crowd** | `crowd.js` `figureArrays(level)`: LOD0 `'hi'` = 142 triangles (rounded 6-sided torso with neck, tapered legs + shoes, tapered arms, icosphere head, skirt, long hair, hat brim), LOD1 `'base'` (the default call, still 60-100 for the harness) = 94 triangles. Variants are drawn by the shader (`iVar`: hair short / long / bald, cap / sun hat, build, skirt), kids get a bigger head (x1.28), arms swing against the legs. Two instanced meshes (within 15 m / beyond) + the dots: **3 draw calls** (was 2). Instance data is written compactly each frame (no collapsed instances in the triangle count). `makeLook` appends `hairStyle`, `hat`, `build` after its old random calls (determinism of the old fields kept). |
| 5 | **Walk fixes** | `buildNpcFair` returns `stalls: [{u0,u1,w0,w1}]` (exact footprints); `buildProps` / `buildClutter` return `solids: [{u,w,r}]` (lamp posts, bins, standing tables + parasols, banner poles, flood masts, barrels / crates) and `boxes` (benches, caravans). `fair.js` hangs them on the occupancy array (`npc.grid.stalls / solids / boxes`), `createMask` reads them from there (explicit `stalls` / `solids` / `boxes` options win), so **main.js needed no change**; without them it falls back to the grid runs. Open plots get their barrier as thin boxes (`plotFence`, gate opening in the middle); the walker pushes out of the barrier. NW gates E5 / E6: the camelots leave a 6.5 m gap in front of each gate (npc.js `GATE_GAP`, walk.js `NW_GATE_GAP`) and `GATE_LANES` keep a 7 m lane free of stalls behind it. NE end: the forecourt of the Grand Théâtre is a world of its own (roads), so it is a **soft boundary**: a walker who keeps pushing against the border beyond u 288 is turned gently back towards the fair (`mask.move` returns `edge`, `walk.js` eases the heading, no text needed). |
| 6 | **Perf** | `fair.js` `Batch`: base + pitches can be cut into spatial tiles (medium 4 x 2, low 4 x 2, high 8 x 4; triangles split by centroid, real bounding spheres, frustum culled). Built on demand and toggled by `fair.setTiled(on)`: **only the walk uses them** (builder / wheel / ride keep the merged meshes: everything is in view there, tiles would only add draws). `glacis.setTiled` does the same for the big indexed ground / terrain meshes (> 6k triangles, 2 x 2 or 3 x 3 tiles sharing the vertex buffers). `low`: all NPC stalls in the cheap form, no ground light overlay, no far-building ring (renderer's `farBuildings: false` was never honoured), ground-decor tier no longer FINER than medium (4.5 m -> 9 m). |

## New / changed API
- `fair.setTiled(on)`, `fair.tiled()`; `fair.baseInfo.solids / boxes`, `npc.stalls`, `npc.triKind` (triangles per skin, diagnostics), `npc.packed`.
- `models/npc.js`: `GATE_LANES`, `GATE_GAP`, `PIT_M / PIT_F`, `packFree(...)` (exported, pure), skin `tentS`; `buildPitchNpc({ ..., groundY })`.
- `models/plots.js`: `buildPlot`, `buildFloor`; `models/kit.js`: `drape(b, hx, hz, ly, colorFn, cell, lift)`; `models/clutter.js` exports its pieces (`caravan`, `crateStack`, ...) + `backLot`.
- `world.glacis`: `setWet(k)`, `setWearAlleys(list)`, `setWear(k)`, `cullFieldBays(keep)`, `setTiled(on)`.
- `walk.js`: `plotFence(rect, face)`, `pitchSolids(rects, solidAt, holes, { fenceAt, faces })`, `createMask({ ..., stalls, solids, boxes })`, `mask.posts`, `mask.move` returns `{ ..., edge }`.
- `crowd.js`: `figureArrays(level = 'base' | 'hi')`, `stats.hi`.

## Hooks used from files this wave does not own
None edited. W7 please (a) add `pb/fouer/models/plots.js` to whatever the service worker pre-caches / versions and bump its cache (a new module), (b) `CROWD_CAP` is pinned by `harness.js` (`70 / 150 / 320`): the walk is denser at the low end through `crowdTarget`'s floor instead (0.4 -> 0.5), raise the caps there if the real iPad allows.

## Numbers (headless Chromium, 1280 x 800, `renderer.info` of the frame; before = HEAD 8a798222, after = this tree)
`mid` = `fillFair(2, 3)` (24 attractions at level 2), `fresh` = 2 attractions at star 1, `full` = `fillFair(3, 5)` (every pitch at level 3, the fair of the W6 walk flow). Builder = the framed overview, walk = the start of the Haaptallee (u 60, w 56) with the crowd.

| quality | scene | before draws / tris | after draws / tris |
|---|---|---|---|
| low | builder mid night | 87 / 235k | 85 / 188k |
| low | builder fresh day | 58 / 195k | 56 / 148k |
| low | builder full night | 106 / 258k | 104 / 201k |
| low | walk mid night | 85 / 227k | 139 / 174k |
| low | walk full night | 104 / 251k | 164 / 188k |
| medium | builder mid night | 88 / 261k | 89 / 276k |
| medium | builder fresh day | 59 / 220k | 59 / 234k |
| medium | builder full night | 107 / 285k | 108 / 290k |
| medium | walk mid night | 89 / 278k | 147 / 278k |
| medium | walk full night | 109 / 303k | 172 / 290k |
| high | builder mid night | 88 / 283k | 89 / 293k |
| high | builder fresh day | 59 / 240k | 59 / 251k |
| high | walk mid night | 92 / 306k | 263 / 321k with tiles 8 x 4 (since 6 x 3: walk full night 240 / 344k, limit 300 / 700k) |

- **Medium holds its budget with a fair about twice as dense**: builder 108 draws / 290k (limit 140 / 300k), walk 172 / 290k (limit 220 / 300k; the old walk was 303k). The packed fair costs about +25k triangles; they were paid back by: `simpleStall` for stalls away from the alleys, no parking-bay paint under the stalls, 3 x 3 / 2 x 2 tiles of the big ground meshes in the walk, medium near trees 40 -> 32, far LOD of pitches / big rides at 65 m (was 80), glow overlay cells 6 m, fewer hedge boxes / pickets at the tram stops, no far-ring sheds < 45 m2.
- **Tiling is a walk-only trade**: the merged meshes cost fewer draws, the tiles fewer triangles (walk medium: 142 -> 151 draws for -18k with the ground tiles, base + pitches 4 x 2). Spatial tiles of 6 x 3 saved ~6k more triangles but cost +50 draws, so medium and low use 4 x 2. High walk measured 263 draws with 8 x 4 (limit 300), 240 with 6 x 3.
- **Low is clearly below medium** (-32 % builder / -37 % walk triangles on `full`) but **not yet at the ideal 90 draws / 150k**: 85 / 188k (mid), 56 / 148k (fresh), 104 / 201k (full). The rest is the world (ground decor 20k, facades 17k, stops 7k, landmarks 8k, tram bed 5k) and the rides; it needs a world LOD wave, not more fair tricks.
- Light bake / ground overlay: unchanged (40 ms once per batch change; the overlay is 3k triangles at night on medium, off on low).
- JS: the packed fair adds some boot time (not measured separately, boot to ready stayed within the flows' timeouts); crowd update cost unchanged (the figure arrays are rewritten only for the drawn guests).

## Coverage (the #1 reviewer gap)
Measured on the **wheel view** (camera 60 m above the SW end, looking NE, fov 58, day, `u >= 75`, alleys / gate zones excluded by their rectangles): the fraction of ground pixels that change when the whole fair layer is hidden (`group.visible = false`, identical camera), threshold 24 / 765 of colour distance:
| | before | after | after, without flat plates / gravel |
|---|---|---|---|
| mid-game fair (star 3) | 53.2 % | **87.1 %** | 82.7 % |
| fresh player (star 1) | 54.9 % | **88.0 %** | 83.7 % |
"Covered" includes the free plots (gravel + barrier + sign + trailer: intentional dressing) and the steel plates under stalls and rides; the third column removes every flat plate and all gravel, i.e. what is covered by buildings, tents, trailers and props alone. What stays bare: the aisles (0.35 - 0.8 m) between stalls, the 0.5 m strip in front of pitches, the 1-2 m edge next to the alleys.
Debug switch: `globalThis.__fouerNoFloors = true` before the page boots drops the plates / gravel.

## Verdict (honest, see montages)
- From the wheel view the field now reads as a packed fair: rows of white gabled tents like the photos, coloured stalls in between, rides standing on plates, and the empty pitches look like what they are (a fenced gravel plot with a sign and a trailer). The fresh-player first impression went from "car park with a few stalls" to "a fair waiting for your rides". Still short of the real photos: our tents are plain boxes with a gable (no sagging canvas, no sponsor banners, no people on the roofs of the camelots), the plots are flat and a little toy-like at XL (56 x 30 m of gravel), and the figures are still small boxes with heads (better than before, not a crowd of thousands).
- Night: halos are dots from above and the same glow at street level; the plots light up a little warm (the light map lights flat sand as well as walls).
- Walk: the ground has patches, swept alleys, tyre streaks, worn bay paint, puddles in the rain; the crowd silhouettes are noticeably better at 2 - 8 m (rounded torso, tapered limbs, hair, hats, kids with big heads); lamp posts, bins, benches, tables and exact stall footprints replace the invisible walls.

## Remaining gaps
- Low is over its 150k ideal (see above). Medium has ~10k triangles of headroom at the worst spot: a richer fair needs another trick (LOD of the facades, instancing the NPC halls).
- The NE end is a soft border (a nudge), not a walkable forecourt: the Grand Théâtre side is a world of roads; making it walkable needs the paving polygons and a collision layer for the traffic islands.
- E5 / E6 lead between two pitches (a 1.6 m slit) once the neighbouring pitches are built: the gap in the camelots and the 7 m lane behind the gate are there, the pitches (data) close it again.
- The tyre streaks / puddles use the game-frame rectangles of `CORRIDORS`; a changed alley layout needs `setWearAlleys` to be called again.
- `CROWD_CAP` is pinned to 70 / 150 / 320 by `harness.js`; the crowd is denser only at the low end of the economy (floor 0.5).
- Real-iPad speed, again, unverified; if needed drop `fair.setTiled` (walk) or the wear shader (`world.glacis.setWear(0)`) first.

## Tests
- `node pb/fouer/harness.js`: 927 checks pass.
- `node scripts/flows/run_all.mjs fouer`: **7 / 7 pass** (world, models, big-models, game, migration, walk, launch). Walk flow perf on the iPad profile: start of the alley 173 draws / 288k, mid alley 115 / 235k, Fressgaass 114 / 234k, Riserad 59 / 139k, Allée Scheffer 85 / 175k, NE portal 62 / 151k (limit 220 / 300k); builder with crowd 104 / 287k. Flow edits: `fouer-models` W3 share 90k -> 110k and the open-pitch check now expects a free plot; `fouer-world` rain check measures its "before" from a clear sky (it was flaky when the random weather started as rain); `fouer-walk` walks the collision test down a lane that is free of the new small solids.
- `python3 scripts/check_site.py` 0 errors (the old karttracker-privacy orphan warning), `cv_head.py` PROBLEMS: 0.

