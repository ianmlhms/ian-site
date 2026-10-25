# W3 art wave: notes for the reviewer

Branch `mtb`, worktree `/Users/Ian/Library/Caches/website-mtb`, nothing pushed, nothing deployed. Montages: `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/w3-art/` (`montage-w3-1..4` photo | ours from the same viewpoint, `montage-w3-before-after-*` W2 vs now from identical poses, `montage-w3-sunny-beech-3pose`, single shots in `shots/`, W2 shots in `before/`).

## Gates
| Gate | Result |
|---|---|
| `node pb/mtb/harness.js` | PASS 59 checks (56 + 3 new: deck in the physics surface, deck ramps end in the banks, ramp normal; plus the path-exclusion checks) |
| `run_all.mjs mtb` (Chromium) | 3/3 pass, includes a new gorge-pose budget assertion at low / medium / high |
| `run_webkit.mjs mtb-world mtb-holes mtb-ride` | 3/3 pass |
| `check_site.py` | no new warnings (the `karttracker-ios-privacy.html` orphan is on main already) |
| `cv_head.py` | PROBLEMS: 0 |
| Gorge budgets (`scripts/mtb/perf_probe.mjs`, 7 poses) | high max 807 k tris / 157 calls (budget 900 k / 230), medium max 462 k / 129 (520 k / 190), low max 329 k / 107 (330 k / 140). W2 peaked at 1.07 M on high. |
| Data | 4.49 MB baked + 0.95 MB painted textures = 5.4 MB (limit 6 MB) |

## The painted texture set (the big lever)
`scripts/mtb/gen_textures.py` (rerunnable, skips what exists, `--rebuild` re-tiles from cached raw pictures without an API call): gpt-image-2, `medium`, 1024 px, one shared STYLE string. **16 images were generated** (11 tiles incl. sky, 4 sprite sheets, +1 first test of sandstone counted once; no re-rolls): sandstone, sandstone+moss, wet rock, beech bark, oak bark, summer litter, autumn litter, moss, trail dirt with roots, foam, meadow grass, painted sky; beech / oak / fern / ivy sprig sheets. Raw pictures stay outside the repo (`~/Library/Caches/mtb-texgen/raw`). Tiles are made seamless with a wandering-seam offset blend (3 x 3 preview checked), the sprig sheets are cut out with Apple Vision (`depalma-promo/cutout`), pale background pockets removed, packed into a 4 x 4 `leaf-atlas.webp`. Outputs in `pb/mtb/data/tex/` (0.95 MB), log in `COST.txt`. Loaded before the first frame (`textures.ready`, one `await` line in `main.js`); the canvas textures remain as fallback.

## What changed (by reviewer item)
1. **Schiessentuempel**: thick white foaming curtains (painted foam streaks, arc out over the pool), big dark mossy boulders on the lips and banks (`rocks.js`), white churned plunge pool (`uFalls` in the water shader), spray particles (`water-view.js` MIST), fern thicket on the banks (`undergrowth.js`), the bridge deck is in the physics surface (below). Water sound hook: `__mtb.water.soundSources(cx, cz)` returns `[{ kind: 'fall', x, y, z, gain, size }]` for the audio of the gameplay wave.
2. **Rocks**: new slab model (`rock-models.js slabGeometry`): stacked bedding bands, rounded blocks, V joint grooves, ledges (moss on treads, dark crevices from vertex AO), overhangs; painted triplanar sandstone/moss/wet-rock shader with luminance bump (`bumpNormal`, no extra files), moss curtains and a damp foot. Distance LOD: near/far models existed; near radius reduced (high 54 m, medium 42 m).
3. **Light**: ACES-fit tone map + saturation in `PAINT_LIGHT_GLSL`; painted cloud tile sky with calmer horizon haze; summer leaf grade (no lime-yellow crowns); litter calmed.
4. **Trees**: painted bark (beech smooth grey-green, oak/dead wood furrowed, bump), girth variety with a few big old trees (`girthOf`, shared by renderer and collision), painted beech/oak leaf sprigs (3 variants each in the atlas).
5. **Stream look**: deep brown-green water mirroring the canopy at grazing angles, sky only where it looks up, painted foam streaks sliding along the flow, broken threads at the banks (no hard rims).
6. **Reviewer round 2**: corridor walls = many smaller blocks with grooves; summer = green; sky has clouds.
7. **From the gameplay agent**: `KEEP_CLEAR` 2.5 m from the centre line of EVERY trail/path/track for slabs, corridor walls, boulders, logs, stumps (`ridden` index in `world-build.js`, `RIDDEN_KINDS`), saplings 3 m, shrubs 3.2 m, hedges 3.0 m, ferns 1.9 m; holly/bramble/hedge cards are about 35 % smaller; crop rows softened (45 % strength, fade from 25 m). Harness checks them for all ways that exist in the data, so they hold after the merge.

## Bridge deck (merge note)
`surface.js` got a small overlay: `surface.addDeck(deck)` (height = max(terrain, deck profile) inside the footprint, normal on the ramp, `surface.terrainHeight` = plain lattice). Render tiles are untouched. `landmarks.js bridgeDeck(bridge)` builds the spec; `main.js` calls `surface.addDeck(bridgeDeck(bridge))` (one line + import). The abutment grew to 3.6 m for gentler ramps. NOT done: the parapet walls are visual only (a rider can leave the deck at the sides) and there are no steps.

## Small fixes found on the way
- The W2 harness never looked at fallen logs (`u.length * 0 + ...` was NaN): fixed, which exposed 6 floating and 1 buried log; log placement now rejects hollows and drops.

## Merge notes (files outside my lane that I touched)
`main.js` (3 tiny hooks: `await textures.ready`, `uSkyPaint`, `foamTexture`, `surface.addDeck`), `surface.js` (deck overlay), `config.js` (QUALITY near radii only), `scripts/flows/mtb_world.mjs` (gorge pose). `forest.js` changed (girth, reachMax 24) which is shared with collision.

## Honest list of what still does not match
- **Schiessentuempel** is recognisable (arched bridge, mossy boulders, white falls, white pool, spray) but the photo is much darker and wetter: our surrounding forest is bright and the falls are three steps in series, not three parallel falls over one ledge (that needs a 2D cascade in `trails.js channelBed`).
- Rocks: now stacked blocks with moss, but no big overhangs/crevices in the silhouette yet and little ivy; the textures are still a bit orange next to the grey-green photo.
- Beech trail: green and lively now, but the crowns are still separate balls on thin trunks, not one continuous high canopy; one olive-yellow oak remains in c2.
- Beaufort castle ruin and Berdorf village edge: NOT done (budget alert).
- Ground on steep slopes still shows stretched moss streaks (side projection of the ground shader).
- Two trails of the gameplay agent were not available to me, so the exclusion is proven on the W2 data only.
