# Polish wave "Glow & density": notes (23 Oct 2026)

Goal: night that reads as a blaze of light, white hall tents, a packed field, painted murals, real trees and sky. No photo textures, no new network assets.
Montages (before / after / reference): `website-overnight/reports/fouer/polish/*.jpg` (+ `trees_*`, `sky_*` PNGs from the tree/sky sub-task).

## What changed
| item | change |
|---|---|
| 1 Bulb halos | `models/materials.js` bulb shader rewritten: hard core + additive bloom sized in WORLD metres (shrinks with distance, lights shine through haze), per-bulb `aGain` (kit.js `haloGain`) keeps dense bulb rows from saturating, chase/twinkle unchanged. Still ONE Points draw per merged batch. Big rides (own emissive material): `models/halos.js` clusters lamp vertices (1.3 m voxels, <= 240) into bloom-only Points (aPh = -1, invisible by day) added as a child of the mesh; skinned meshes (`K.dynamic`) drop them. Cost: +1 draw per emissive mesh. |
| 2 Light on ground + walls | NEW `world/glow.js` (`createGlow`): every bulb of the fair is splatted (gaussian, wider/weaker with height) into one RGBA8 light map (0.6 m/texel medium; 526x290), sqrt encoded. `patchLit` in materials.js makes solid / fabric / sign / signLit / swing / big-lit / tree materials add `albedo x light` as emissive by world position, fading with height; one additive ground overlay mesh (4 m grid, only lit cells, ~5k tris, 1 draw). Debounced re-bake (~40 ms) when batches rebuild. No dynamic lights. |
| 3 Emissive + colour | lamp gain x1.45 at night, lit signs up to 1.4, big-lit lamp x1.4 + self-lit paint 0.1+0.34k, day saturation boost (uSat 1.16) on all fair materials, window glass of NPC stalls is a lit amber lamp surface, all NPC signs lit. Airbrush murals in `atlas.js` (`airbrushPainter`): alpine, space, circus, sea, comic, jungle (+ kind 6 print, 7 rosette); `Builder.mural(kind, ...)` kinds 0-5 are the new themes; used on pizza trailer, tiki bar, bouncy castle, funhouse, souvenir container, camelot banners and the Kette cornice. Atlas is now 2048x2048 (was 1536 high). |
| 4 White tents | new `fabric` channel/material (HDR albedo 1.4-1.75, DoubleSide); NPC hall tents + camelot roofs use it, W4b `hall-tent.js` roof/walls use HDR white + a G-bucket warm interior glow. Night: fabric tints warm and glows (`CFG.fabric`). |
| 5 Density | NPC skins 15 -> 24 (pizza trailer, popcorn cart, ice-cream van, balloon darts, tiki bar, claw machines, bouncy castle, funhouse, souvenir container); NPC stalls 206 -> 229. NEW `models/clutter.js`: alley-edge dressing (standing tables + parasols, crates, barrels, A-frame boards, bins, banner poles), flag lines + bulb strings over the cross alleys, flood masts, free-field filler (tables, pallets, gensets, cable ramps, portaloos), SE service lane (caravans, gensets, fence panels); `dressPitch` adds crates/tables/bins in the slack of every non-XL pitch model. Free ground (empty asphalt in the field polygon) 26 % -> see montages. `lukas`: knight 11 m tall with gold bands + cross, ladder tower 9.2 m with 11 rank plates + cards (height now 11.2). Camelot tarps: striped / printed, roll-up opening, painted banner, HDR roof. |
| 6 Trees + sky | by sub-agent: `world/trees.js` plane trees (mottled trunks, 9-lobe crowns, 2 LODs 416 / 34 tris, 40 near max), `world/sky.js` cumulus / evening / starry night + city glow / Kirchberg haze. |
| Wheel | dense warm rim bulbs (2 x 132 on medium) + own bloom, hub sunburst brighter. |

## New API (W5 / W6)
- `env.start({ weather, hour, thenRandom })` (sky.js): `start({ weather: 'clear', hour: 19.25, thenRandom: true })` = begin clear at golden hour, then Random (weather rotates after 240-480 s, day drifts on). Without `thenRandom` the modes freeze. Not persisted. W5's `main.js` should replace its re-roll loop with it.
- `createFairLayer({ ..., glow: true })` creates the glow itself (`fair.glow`, `fair.glow.stats()`, `glow.tune({ amp, ground, wall, haloK, haloI, lampGain, fabric })` for look tuning); `fair.setNight(k)` / `setQuality(q)` / `dispose()` forward to it. W5's `main.js` needs no change: it already forwards `setNight` and `setQuality`. Pass `glow: false` to disable.
- Bulb registration is unchanged: `Builder.bulb / bulbRow / bulbRing` (kit.js) and big-kit `bulb()` / lamp buckets. Anything registered before a batch rebuild lights the ground automatically. A free light: `glow.addLight(x, y, z, hex, w)` then `glow.setLightsFrom(fair.group, true)`.
- New materials contract: `M.fabric`, `M.patchLit(mat, key)` (use on any new lit material that should receive the night light map), `M.cfg` (look constants), `M.U.uLM/uLMR/uLMP`. `Builder` channel `'fabric'` (`b.box(..., { ch: 'fabric' })`).
- `Builder.mural(kind 0-5 = alpine|space|circus|sea|comic|jungle, seed, ...)`; `airbrushPainter(theme, seed, look)` in atlas.js.
- `buildNpcFair` result now also returns `grid` + `gridDims` (occupancy) for clutter.

## Numbers (headless Chromium, 1280x800, full fair `?models=1&view=fair` L4, frame view; before = commit 0d599e5d)
| quality | before draws / tris | after draws / tris |
|---|---|---|
| low, day / night | 84 / 227k, 85 / 227k | 103 / 248k, 105 / 253k |
| medium, day / night | 85 / 246k, 86 / 246k | 104 / 271k, 107 / 277k |
| high, day / night | 85 / 336k, 87 / 340k | 104 / 287k, 106 / 292k |
Wheel-view camera (more of the fair): medium night 87 / 255k -> 107 / 286k; high night 90 / 348k -> 109 / 309k (high is desktop; the iPad-medium budget 140 draws / 300k holds). `preview-big.html` night: low 63 -> 80 draws, medium 64 -> 81, high 64 -> 81 (tris about equal, high 271k -> 194k thanks to the cheaper trees). Game page (`pb/fouer.html`, `fillFair(2,3)`, medium, builder view): 76 / 233k -> 89 / 265k day, 90 / 269k night. GPU time per frame (30 renders, readPixels) is within noise on the dev machine (3-5 ms); real-iPad speed is still unverified.
Light bake 40 ms (once per batch change), light map 0.5 MB, ground overlay 5k tris.
Flow thresholds I changed (explained in the flow files): `fouer-models` W3 share 60k -> 90k tris (clutter, 24 skins, murals; scene total still asserted <= 140 draws / 300k); `fouer-big-models` budgets 20 -> 32 draws (bloom Points) and wheel 15000 -> 16500 tris (rim bulbs).

## Verdict (honest, see montages)
- Night: from dim dots to a lit, glowing fair: bloom on every bulb, saturated LED outlines, warm light pools on the asphalt and on stall walls, white tents glow. A neutral viewer would now call the night alley and the top view "lively and glowing". Still short of the real photo: the real wheel rim is a solid blaze of yellow, ours is a bloom chain around a bright yellow rim; our ground is a flat additive pool (no reflections, no wet asphalt look); no crowd.
- Day: tents brighter and the field fuller, murals add saturated colour, but facades are still smaller flat panels, not full airbrushed fronts; stalls are still simple boxes.
- Trees/sky: much better than lollipops/gradient, not photo-real (see the sub-task report above in the montages `trees_*`, `sky_*`).

## Remaining gaps
- Rides with own materials (W4a/W4b) get murals only where W4 placed them; a full airbrushed front on every ride would need per-model work.
- Light map is 2D (height only fades it): a wall under a high string of bulbs is lit the same as the ground below.
- Night trees are very dark (hemisphere light); fair light only reaches avenue trees close to bulbs.
- 0.5 s near-LOD pop of trees; far LOD trees are two-lobe blobs.
- Quality `low` still gets the full glow (cost is small); could skip the ground overlay.
- Real-iPad performance unverified; if needed drop `glow: false` or `M.cfg.haloK` first.
