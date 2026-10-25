# HANDOFF-ART (W3 art wave) - written early, updated as I go

Branch `mtb`, worktree /Users/Ian/Library/Caches/website-mtb. Nothing pushed.

## Done (committed unless noted)
- `scripts/mtb/gen_textures.py` (rerunnable, skips existing): gpt-image-2 painted set -> `pb/mtb/data/tex/*.webp` (+ `leaf-atlas.webp`, `COST.txt`). Raw API pictures cached OUTSIDE the repo (~/Library/Caches/mtb-texgen/raw). Images generated: 16 in total (see W3-ART-NOTES.md).
- `paint-textures.js`: loads the webp set (`textures.ready`, awaited in main.js), canvas textures stay as fallback. Leaf atlas is now 4x4 (tiles 8..15 painted variants).
- Rocks: new slab builder (bands, blocks, joint grooves, ledges) in `rock-models.js`; painted triplanar rock shader with luminance bump (`bumpNormal` in light-glsl.js) in `rock-view.js`.
- Trees: painted bark (aLeaf -2 dark / -3 beech), girth variety (`girthOf` in forest.js, used by collision too), summer leaf grading.
- Light: ACES-fit tone map in `PAINT_LIGHT_GLSL` (`tonemapPaint`); painted cloud tile sky (env.js, `uSkyPaint`).
- Water: deep dark water shader with canopy reflection, painted foam streaks, plunge-pool churn, thick curtains, spray (`water-view.js`), `soundSources(cx, cz)` hook for audio.
- Schiessentuempel: big boulders on lips/banks (`rocks.js`), fern thicket (`undergrowth.js`).

## Open (in order)
1. Path exclusion corridor for rocks/logs/undergrowth around ALL OSM path/track ways (gameplay agent's trails) + harness check.
2. Giant leaf cards near the camera; crop field corduroy texture softening.
3. Bridge deck physics layer in surface.js (+ harness check), bridge arch/steps.
4. Rock/tree LOD for gorge scenes (900k/520k tri budgets), ivy/fern at wall feet.
5. Gates: harness, run_all mtb, webkit, check_site, cv_head; montages in website-overnight/reports/mtb/w3-art/.
6. DATA budget: flow limit 6 MB vs data 4.49 MB + tex ~1 MB => adjust DATA_BUDGET in scripts/flows/mtb_world.mjs if needed.
Dev tools: `scripts/mtb/art_shots.mjs OUT [prefix]` (fixed poses), `montage.py`.


## Update: everything above is done except what W3-ART-NOTES.md lists as 'honest list' (Beaufort/Berdorf, darker Schiess mood, parapets/steps on the bridge). Gates are green; see W3-ART-NOTES.md.
