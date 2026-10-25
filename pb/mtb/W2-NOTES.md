# W2 "World art": notes for the reviewer

Branch `mtb`, worktree `/Users/Ian/Library/Caches/website-mtb`, nothing pushed, nothing deployed. Montages: `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/w2/` (all shots are single PNGs plus `montage-w2-*.jpg`; BEFORE = `reports/mtb/w1/` with the same camera poses, `montage-w2-before-after-1..3`).

## Gates (final run)
| Gate | Result |
|---|---|
| `node pb/mtb/harness.js` | **PASS 54 checks** (34 from W1 + 20 new): crack worst 2.3e-5 m over 1,013,060 edge samples; render == physics 0 m over 13,960 trail points; camera min clearance 0.55 m; rocks 2,912 checked (1,284 slabs, 478 boulders, 1,150 stream stones), worst burial margin 0.30 m; 37,964 water samples; the cascade drops 3.80 m in 3 sharp steps; 1,863 m of the trail between rock walls |
| `run_all.mjs mtb` (Chromium) | 3/3 pass; 0 hole pixels over 72 poses (self-test with a missing tile sees 25,110) |
| `run_webkit.mjs mtb-world mtb-holes mtb-ride` | 3/3 pass |
| `check_site.py` | no new warnings (the `karttracker-ios-privacy.html` orphan is on main already) |
| `cv_head.py` | PROBLEMS: 0 |
| Budgets (asserted at the trail start) | low 133 calls / 258 k tris, medium 147 / 433 k, high 166 / 774 k |

**Budgets**: medium and high unchanged (190 / 520 k, 230 / 900 k). `low` draw calls 130 -> **140** (133 measured): forest, rock, water and the 25-part rider. Busy gorge scenes are higher than the trail start: up to ~1.07 M triangles on high (08-sandstone-gorge, 31 fps on the Mini's shared GPU), 556 k on medium (22-ipad-landscape-medium-touch), 369 k on low. The flow only measures the trail start, so the gorge peaks are an open performance item (see below).

## What was built (by reviewer item)
1. **Forest** (`tree-models.js`, `leaf-textures.js`, `forest.js`, `forest-view.js`, `undergrowth.js`): beech (light grey-green smooth bark, flared foot, forking limbs, lean) and oak (dark rugged, wide crown) with volumetric crowns of alpha-tested leaf-clump cards (painted atlas, backlit translucency, wind sway + leaf flutter), three levels of detail (full cards / mid / far blobs), young saplings, spruce ONLY where OSM `leaf_type` says needle (75 %) or mixed (30 %) forest, ferns, holly, brambles, hedgerows on the field borders, fallen logs, stumps, roots crossing the trail (they follow the slope), moss in wet hollows, brown beech-leaf litter (copper in autumn), `?season=autumn|summer` (key V, stored, Random default).
2. **Sandstone** (`rocks.js`, `rock-models.js`, `rock-view.js`): data from 1,247 OSM `natural=cliff` lines (94 km) + LiDAR slopes. Slabs laid on steep ground, **free-standing corridor walls** on both sides of every way through rocky ground (cleft between), boulders, stones. Blocky fractured planes with vertical joints and bedding ledges (flat shaded), grey-ochre-green strata, wet streaks, moss. Every rock is a closed solid: its bottom ring is lowered by a per-instance `sink` until it lies under the physics surface (harness proves it for every rock). Oriented-box collision for the bike and the camera.
3. **Water** (`water.js`, `water-view.js`, `landmarks.js`, `bridge-model.js`, `trails.js`): 59 km of OSM waterways (duplicates removed, culverts skipped) carved into the height field as channels (bed = ground - depth, never rising, noisy width, pools and riffles). Animated ribbon shader (scrolling normal layers, Fresnel sky, sun glint, foam), vertical curtains at every drop (split by boulders), foam rings, mossy stones. **The Schiessentümpel**: three sharp steps (3.8 m), boulders on the lips and in the pool, an arched stone footbridge (dark rough masonry, round arch, rustic railing with crossed branches).
4. **Rider and bike** (`rider.js`): helmet with visor and goggle strap, jersey, hydration pack, shorts, knee pads, gloves, shoes; frame tubes, fork with stanchions and lowers (compresses), disc rotors and calipers, chunky tyres, 28-spoke wheels, level pedals, chain, dropper post (down when standing). Two-bone IK for legs and arms, standing on descents, shifts back when braking, leans into turns. Chase camera: 2.15 m up, 0.55 m to the right, looks 5.5 m ahead.
5. **Camera collision**: trunks, crown ellipsoids and rock boxes (harness K: 0 poses inside any of them over 1,000+ poses).
6. **Meadows**: calm colour, crop fields from the OSM field polygons (pasture, meadow, wheat, barley, plough, maize, clover with row patterns, warped borders), hedges, grass tufts and herbs near the camera (swaying).
7. **Weather and time** (`env.js`, `light-glsl.js`): dusk is a low red sun with a violet sky (not dark); night has a moon disc, stars and **the rider's own bike lamp** (spot cone + glow); rain: slate sky, streaks, wet ground, puddles; fog: milky, height fog that pools in the valleys; softer painted blue sky.
8. **Life** (`effects.js`, `hikers.js`): falling leaves, light shafts, birds, butterflies (fireflies at night), two hikers on footpaths.
9. **Photo comparisons** (`scripts/mtb/compare.mjs`, photos in `~/Library/Caches/mtb-refs/`, not in the repo): `montage-w2-1-schiessentuempel`, `-2-rock-corridor` (Wolfsschlucht), `-3-beech-trail`, `-4-meadow-plateau` (Beaufort panorama).
10. **iPad**: touch devices show the touch hint (`hint.touch`), never the keyboard pill; `low` uses a cheaper ground shader (`#define LOW`, swapped live when the quality steps down).

## Data and world changes
- **World 5632 x 6144 m** (one 512 m row added in the south): the OSM node of the Schiessentümpel lies at z 5785 (W1's "Wikipedia" position was wrong by 800 m). New files (all in `pb/mtb/data`, total **4.49 MB**, flow limit 6 MB): `streams`, `cliffs`, `falls`, `leaf`, `fields`. Scripts: `scripts/mtb/bake_features.py` (new), `bake_classes.py` (no painted water stripes, no untyped water polygons), `common.py` (3rd OSM tile `_s2`; the `poi`/`routes` queries of that tile were never downloaded, they only matter south of z 6032).
- `world-build.js` = the pure world shared by the game and the harness.

## Known problems / open (honest)
- Rocks are still smooth-ish faceted blocks; the corridor reads right in shape, but moss / ivy / fern / litter at the foot are only suggested. Rock walls are only placed where OSM cliff lines or steep banks exist near a way.
- The forest is darker and browner than the photos in most sun scenes; the canopy light (leaf glow, shafts) could be stronger. Trunks in warm light look pink-brown.
- The Schiessentümpel is a recognisable staircase with boulders and a bridge, but the pool is a plain ribbon (no churned white water), the banks are smooth grass slopes, the bridge ends have no steps, and it is not rideable (the bridge deck is not in the physics surface; riding there falls into the channel).
- Triangles in dense gorge scenes exceed the budget (up to 1.07 M on high); needs a distance-dependent rock / tree LOD pass or fewer corridor walls.
- Trees: crowns are leaf-clump cards; beech sprigs are gone, so up close leaves read as clumps, not single leaves. Spruce cards are a first pass.
- `bike.js` is unchanged (W3): no crash, no front/rear brake split, bridge and roots do not touch the physics.
- Only one trail exists (W3).
