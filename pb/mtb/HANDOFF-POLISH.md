# HANDOFF-POLISH (polish wave, branch mtb-play, worktree website-mtb-play)

Brief: scratchpad/brief-mtb-polish.md. Montages go to ~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/polish/. Scratch shots: scratchpad/polish/.

## Done (committed)
1. Schiessentuempel cascade: ONE sandstone ledge, four falls side by side between big mossy boulders, plunge pool, foam puffs.
   - `trails.js channelBed` ledge mode (`cascade.ledge`, `span`, `drop`), pool kernel widened (`CARVE.poolWiden`, `maxRadius`), scour below the face; `landmarks.js` SCHIESSENTUEMPEL.x/z = the lip (river sample), `attachCascades` now gives a way several cascades.
   - `cascade.js` (pure: placeCascade, CHUTES, BOULDERS, bankBoulders, cascadeCollide, buildCascadeWater, finishView, finishFov), `cascade-model.js` (ledge + boulders + bank boulders geometry, rock-view landmark material seed 3.4), `water-view.js` (ledge sheet + pool patch, chute curtains replace findFalls near the ledge, puffs), `water.js` skips the ribbon between the lip and 2 samples below. `world-build.js` returns `cascade`; `rocks.js` skips lip/pool boulders for `bankOnly` falls; `play-world.js collide` has the ledge wall + `finishView`.
   - harness.js: staircase check replaced by 8 ledge checks. harness-play 163 green.
2. Finish view: `ui.js/ui.css` compact foldable card at the left (wide) or bottom (portrait), no dim; `ui.finishFree()` -> `main.js applyViewOffset` shifts the picture into the free area (eased lens shift); finish camera `world.finishView` (searched spot with clear line of sight to every fall) + `finishFov`. i18n key finish.fold in 4 languages.
3. Weather: `env.js` WEATHER cloudy/fog retuned, shafts muted in fog (`effects.js`). Tool `scripts/mtb/weather-shots.mjs`.
4. Buildings pipeline started: `scripts/mtb/bake_buildings.py` -> `pb/mtb/data/buildings.json` (791 rectangles, 3 castles, 2 churches, 37 KB). Refs downloaded in mtb-refs (beaufort_*, berdorf_*).

## Open (in order)
- 4: runtime `town.js` (houses: rendered walls + windows + slate roofs, dormers, chimneys; church with spire; chunked + distance culled), `castle.js` (medieval ruin L-shaped curtain wall with round towers + Renaissance castle at the OSM polygons), wire in main.js, viewpoint collectibles near each, harness checks (houses on ground, none on ways), montages vs refs, perf budgets.
- 5: iPad check (scripts/mtb/ipad-check.mjs), WebKit at iPad sizes low/medium + touch, frame time, JS heap + texture memory, auto quality low on iPad (main.js autoQuality: coarse pointer + <=4 cores -> low, else medium: must be low for iPads), checklist for Ian.
- Gates: harness, harness-play, harness-save, harness-audio, run_all.mjs mtb, run_webkit.mjs, check_site, cv_head, montages (cascade vs photo, finish desktop + iPad portrait/landscape, weather sheet, Beaufort, Berdorf).
