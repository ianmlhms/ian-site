# Smooth pass (27 Oct 2026), branch mtb-smooth

Ian's screen recordings (Safari, 60 fps capture, Hallerbach-Flow) showed a 67-83 ms hitch roughly once per second and a flat teal band behind the trunks. Tool: `scripts/mtb/smooth_probe.mjs` (rides a trail with the scripted bot in the LIVE loop, times every requestAnimationFrame gap and every game callback, wraps terrain / forest / rocks / town / props / render with timers, `--cpu 4` emulates a 4x slower CPU in Chromium).

## The hitch: terrain stitch scan
100 % of the main-thread callbacks above 20 ms were `terrain.update` (Chromium, 60 s ride at ~30 km/h): 43-55 ms median-ish on medium (max 96), 59-80 ms on high (max 113), 29-43 ms on low, one every 0.48 s, i.e. every `RESELECT_DISTANCE` (4 m). At Ian's 15-20 km/h that is about once a second.
Cause: every re-selection recomputed `stitchSignature()` for EVERY leaf (hundreds): `stitchesOf` walked each boundary vertex and called `tilesTouching` (4 x `leafAt`, each building a string key per quadtree level). Profile: `tilesTouching` 719 ms + `stitchesOf` 395 ms per 10 s of riding. Not props, not the forest rebuild (forest peak 1.2-4 ms per frame, time-sliced as designed).
Fixes:
- `terrain-view.js`: per-leaf signature cache; only leaves that touch a quadtree node whose split state changed are recomputed (`changedBoxes`). Builds now come from a queue (missing tiles first, then re-stitches) with a 2 ms wall-clock budget per frame (at least one tile), instead of up to 3-12 tiles in one frame.
- `tile-mesh.js stitchesOf`: the four edges are probed once each (a coarser neighbour spans a whole edge), only the four corners use the 4-way `tilesTouching`. Checked against the old function on 18 287 leaves: identical signatures.
- `trails.js carve()` (10 000 calls per 32 m surface block): the spatial hash used a template string key per lookup (9 per call); now a numeric key. Heights are bit-identical (harness render==physics 0 m).
- `main.js prewarmShaders()`: `renderer.compile(scene, camera)` behind the loading screen, plus the other quality level's ground shader on a spare mesh. The dust and town materials used to compile on their first use mid-ride (render 9-13 ms at 1x, more on a slower GPU/driver).
- `forest-view.js`: the staging arrays of the time-sliced rebuild are reused (one MB of typed arrays was allocated per scan), only the live range of each instance buffer is uploaded (`addUpdateRange`), and `par` is now marked for upload on every commit (before, a commit that left nothing fading could keep stale yaw/seed on the GPU).
Remaining per-frame work: terrain re-select 1-3 ms every 4 m, forest scan 1.2 ms budget, rock refill up to 6 ms (a new rock block is generated) at 4x CPU slowdown = about 1.5 ms real.

## The teal band
The mid/far distance is the FAR LOD tier (`farBeech` / `farOak` blobs of 20 faces, `farSpruce` stacked cones), flat vertex colours with no leaf texture: `[0.32, 0.5, 0.18]` through the cool sky ambient turned into a saturated teal, and the 20 faces read as flat cut-outs, a "painted fence" behind the trunks. Fix in the forest fragment shader only (no triangles added): leaf-sized noise breaks the colour up, the green is warmed towards the painted mid-tier leaves, the lower crown is darker (shade of the stand), the normal leans to the sky (no flat facets), and an air-haze mix towards the fog colour from 50 m to 220 m pushes the far stand back. Trunks are untouched (the crown test is `r < 0.85 g`).

## Check
`scripts/flows/mtb_smooth.mjs` (flow `mtb-smooth`, in `run_all.mjs` and `run_webkit.mjs`): 30 s medium + 15 s low scripted ride in the live loop; fails when a frame after the 3 s warm-up exceeds 40 ms (a failing ride is repeated once, headless timing is noisy), p99 > 34 ms or a game callback > 30 ms. It fails on the old code (81 frames over 25 ms, max 67 ms) and passes now (max 16.8 ms).

## Numbers (Chromium full headless on the Mac Mini, 1440x900, 60 s ride at ~30 km/h, bot speedScale 0.5, frames after the 3 s warm-up)
| trail / quality | before p50 / p99 / max, frames > 25 ms | after p50 / p99 / max, frames > 25 ms |
|---|---|---|
| Hallerbach low | 16.7 / 49.9 / 66.7 ms, 125 | 16.7 / 16.8 / 16.8 ms, 0 |
| Hallerbach medium | 16.7 / 50.0 / 100 ms, 151 | 16.7 / 16.8 / 16.8 ms, 0 |
| Hallerbach high | 16.7 / 83.3 / 116.7 ms, 133 | 16.7 / 16.8 / 16.8 ms, 0 |
| Black trail medium | 16.7 / 66.7 / 83.4 ms, 184 | 16.7 / 16.8 / 16.8 ms, 0 |
With `--cpu 4` (a 4x slower CPU) the slowest game callback after the fixes is 15-30 ms (4x), i.e. 4-8 ms real. WebKit (30 s, headless): low before p99 39 / max 59 ms, 67 frames > 25 ms; medium after the terrain fix p99 19 / max 23 ms, 0 frames > 25 ms (measured before the shader pre-warm and forest changes; WebKit could not be re-run at the end, the Mini's display went offline and Playwright WebKit hangs in newPage).
