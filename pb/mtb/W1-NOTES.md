# W1 "World": notes for the reviewer

Branch `mtb` (worktree `/Users/Ian/Library/Caches/website-mtb`), 5 commits, nothing pushed, nothing deployed.
Run: `node pb/mtb/harness.js` (34 checks, ~15 s), `node scripts/flows/run_all.mjs mtb` (3 flows, Chromium), `node scripts/flows/run_webkit.mjs mtb-world mtb-holes mtb-ride` (WebKit, all pass), open `/pb/mtb.html` (`?debug=1` gives `window.__mtb`, `?q=low|medium|high`, `?time=dawn|morning|noon|evening|dusk|night`, `?weather=clear|cloudy|fog|rain`, `?holes=1` hole-detector mode).

## What was built
| Area | Files |
|---|---|
| Design | `DESIGN.md` (17 sections, wave plan) |
| Data pipeline | `scripts/mtb/`: `common.py` (frame), `fetch_osm.py`, `fetch_lidar.py`, `bake_terrain.py`, `codec.py`, `bake_trails.py` + `trails.def.json`, `bake_ways.py`, `bake_classes.py`, `network.py`, dev tools `mapcrop.py` `shot.mjs` `report_shots.mjs` |
| Baked data (3.9 MB, `pb/mtb/data/`) | terrain 2.78 MB, far hills 0.21, canopy 0.54, classes 0.15, ways 0.17, trails 2.4 KB, landmarks 121 |
| Zero-holes core (pure JS, runs in Node) | `config.js` `codec.js` `world-data.js` `base-field.js` `trails.js` `heightfield.js` `surface.js` `quadtree.js` `tile-mesh.js` `noise.js` |
| Game core (pure JS) | `bike.js` (physics) `camera.js` `forest.js` (placement + trunk collision) `world-map.js` |
| Rendering | `main.js` `terrain-view.js` `ground-shader.js` `paint-textures.js` `env.js` (sky, sun, fog, time + weather) `forest-view.js` `tree-models.js` `rider.js` `input.js` `i18n.js` `ui.css`, page `pb/mtb.html` |
| Checks | `harness.js`; flows `scripts/flows/mtb_world.mjs` `mtb_holes.mjs` `mtb_ride.mjs` (registered in `run_all.mjs` and `run_webkit.mjs`) |

## The world, as baked
- Box 5632 x 5632 m (31.7 km2): LUREF (87900, 100308) north-west corner. It was first 6144 x 4608 and moved south by 1.2 km once Wikipedia coordinates showed that Müllerthal village and the Schiessentümpel lie at lat 49.789-49.792 (z 5200-5300 in the box), south of where I had guessed. Beaufort castle z ~370, Haller z ~1930, Berdorf z ~1790, Müllerthal village z ~5200.
- 1901 ways (path 72 km, track 122 km, road 64 km), 2838 buildings in the land-cover raster, 1 trail baked (Hallerbaach-Flow, blue, 2881 m, -86 m, steepest 20 m = 12 %).
- Spikes: 40 single-node LiDAR pits/peaks > 2.5 m clipped in the 2 m terrain; checked by harness A.

## Gate numbers
| Gate | Result |
|---|---|
| `node pb/mtb/harness.js` | **PASS 34 checks**. Worst edge disagreement between neighbouring tiles **2.3e-5 m over 1,027,357 samples / 16,468 tile edges** (all LOD pairings); render == physics **0 m over 13,960 trail points** (every 0.5 m); camera min clearance 0.55 m over 28,628 poses; scripted rider rides the whole 2881 m trail in 427 s with collisions on; 2990 trees sampled, none on a way; every trail probe (0.9 m) free of trunks; tile selection reaches 9 km in 8 directions; selections have <= 206 leaves (avg 187) |
| `node scripts/flows/run_all.mjs mtb` | **3/3 pass** (mtb-world ~35 checks, mtb-holes 72 poses + detector self-test, mtb-ride) |
| WebKit (`run_webkit.mjs mtb-...`) | **3/3 pass** (headless WebKit has WebGL here) |
| `python3 scripts/check_site.py` | no new warnings (the one orphan warning, `karttracker-ios-privacy.html`, is on main already) |
| `cv_head.py` | **PROBLEMS: 0** |
| Hole detector (browser) | **0 hole pixels** over 72 poses (12 along the trail at rider height, 12 looking down the trail, 28 random up to 120 m high, 16 at the four world edges looking out); self-test with one 32 m tile removed (trees hidden, seen from 12 m up) reports 22,329 hole pixels in Chromium and 16,072 in WebKit |
| Budgets (flow-asserted) | low <= 130 calls / 330 k tris, medium <= 190 / 520 k, high <= 230 / 900 k. Measured (headless, desktop GPU): low 117 calls / 287 k, medium 121-135 / 308-408 k, high 57-156 / 345-541 k. Data 3.9 MB (flow limit 6 MB). JS heap 121 MB, ready after 1.6 s on the Mini |

## Screenshots and montages
`~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/w1/`: `montage-overview.jpg` (12 shots), `montage-ipad.jpg` (portrait medium, landscape low, landscape medium with touch controls), `montage-holes.jpg`, `montage-ref-1..4` (real photo | our screenshot), single PNGs `01`..`40d`, `60-schiessentuempel-location-*`, `perf.json`. Photos used: `~/Library/Caches/mtb-refs/` (`SOURCES.md`; not in the repo).

## Decisions and deviations from the brief
1. **Quadtree instead of fixed chunks with LOD** (explained in DESIGN 5): one CDLOD tree gives the same guarantees with far fewer tiles over a 5.6 km box plus 8 km of hills; the harness covers "every chunk at every LOD".
2. **Physics lattice = the LOD 0 tiles** (1 m, 32 m blocks), not a separate collider. The rider's 3 x 3 tiles are always LOD 0 (`splitFactor` 1.0, protected up to 128 m nodes also at the low quality setting).
3. **World moved and enlarged** to 5.6 x 5.6 km (brief: 3-5 x 3-4) because the heart of the Mullerthal (Schiessentümpel, Müllerthal village) needs it; terrain data stays at 2.8 MB.
4. **Trails are routed over OSM** (cheapest path with a grade penalty per colour), not copied from the GPX; the GPX is the Marathon's backbone in W2.
5. **Score design**: higher-is-better (`10,000,000 - time ms`) needs no SQL; only the daily board needs `scripts/mtb.sql` (W5). `data-arcade-lower-is-better` is therefore NOT set in `pb/mtb.html`.
6. No arcade tile yet (W6 in the plan, as the brief lists "tile" with the later waves).

## Known issues / open (honest list)
- **Visual polish is first-pass**: rider is a primitive model (readable, not pretty), trees are lumpy blobs with painted leaf patches (not individual leaves), no ferns / undergrowth, water is a flat painted stripe, night / dusk / rain / fog are dark or barely different (no rain particles, fog colour not tuned), meadows look a bit like camouflage from the air, farmland rows missing. All planned for W3-W6.
- **No landmark is modelled yet** (waterfall, bridge, castle, rock arches): W4. The photo montages are therefore direction checks, plus a location check of the Schiessentümpel valley.
- Forest floor, lighting and fog exposure: dark under dense canopy at low sun.
- The terrain fragment shader is the heavy part on an iPad (about 11 texture reads); `low` quality still uses it. Real-iPad numbers are unknown (measured only on the Mini's GPU); budget fallback ideas: drop the side-mapping samples and the cloud shadow at `low`, bake the 4 m maps into the vertex colour of tiles beyond 300 m.
- `bike.js` is a first model (no front/rear brake split, no pump, a hit against a tree only slides and slows). No crash / respawn yet; `R` puts the rider back on the trail.
- Touch controls exist and are small (< 15 % of the screen) but are only tested with synthetic pointers.
- The trail start (x 400) lies inside the 192 m border of the world; fine, but a start card would be nicer.
- LOD pop of tile geometry at the 64 m / 128 m rings is visible as subtle shading changes (normals come from the lattice of each level); hysteresis prevents flicker.
- Overpass is slow: `scripts/mtb/fetch_osm.py` needs several tries; the first (north) tile was downloaded before the box moved, hence the two tiles (`_s` = south strip).
