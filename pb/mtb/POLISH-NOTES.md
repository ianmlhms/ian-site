# MTB polish wave (26 Oct 2026), branch mtb-play

Montages: `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/polish/` (`montage-p1..p7` photo | ours, `finish-sheet.jpg`, `weather/weather-sheet.jpg`, `ipad-*.json`).

## What changed
1. **Schiessentuempel**: one sandstone ledge with four falls side by side between big mossy boulders, a wide plunge pool with foam puffs and mist. `cascade.js` (layout, collision, water geometry, finish camera), `cascade-model.js` (ledge + boulders + bank boulders), `trails.js channelBed` ledge mode (the carve makes a ramp, the model makes the vertical face), `water-view.js` (ledge sheet, pool, curtains, puffs). Bank boulders are clamped into the slope and keep 2.4 m off every way. Pool walls are mossy rock (ground shader), not gravel.
2. **Finish view**: compact card at the left (wide) or bottom (portrait), foldable, no screen dim, touch controls hidden while it is up. The picture is shifted into the free area (`ui.finishFree`, eased lens shift in `main.js`) on all trails; on the Schiessentuempel trail the camera glides to a spot in front of the falls with a clear line of sight to every fall (`finishView`) and the field of view is fitted to the free area (`finishFov`).
3. **Fog vs cloudy** (`env.js`): cloudy = clear air (fog x0.55), flat bright sky, sun 0.14 (soft shadows); fog = x48 distance fog + height fog, milky 0.9, light shafts muted.
4. **Beaufort and Berdorf**: `scripts/mtb/bake_buildings.py` -> `data/buildings.json` (OSM footprints, LiDAR heights; 798 rectangles, 36 KB). `town-data.js` (pure, collision), `town-model.js` (houses, church, medieval ruin with round towers, Renaissance castle with a tower), `town-material.js` (painted walls, windows lit at night, slate rows, ashlar), `town-view.js` (one mesh per 256 m cell, culled by quality reach). Houses on a trail, path or track are left out (OSM footpaths run through footprints, the Marathon through Beaufort); the church and castles stay. Two new viewpoint collectibles (castle, church).
5. **iPad**: touch devices (coarse pointer, or an iPad in desktop mode) now auto-pick `low`. `scripts/mtb/ipad-check.mjs` measures in WebKit/Chromium at iPad sizes.

## iPad numbers (Mini GPU, iPad Pro 11" sizes, DPR 2 but the game caps the pixel ratio: low 1.0, medium 1.25)
| | low 1194x834 | medium 1194x834 | low 834x1194 | medium 834x1194 |
|---|---|---|---|---|
| canvas | 1194x777 | 1492x971 | 834x1137 | 1042x1421 |
| ms per frame (readback-synced, WebKit) at 5 busy places | 3-4 | 6-7 | 3-4 | 5-6 |
| fps riding 12 s (WebKit, vsync 60) min / avg | 55 / 58.7 | 56 / 58.4 | 56 / 59.1 | 56 / 58.2 |
| draw calls / triangles | 118-145 / 210-345 k | 133-167 / 230-500 k | | |
| JS heap (Chromium) | 195 MB | 235 MB | | |
| textures + buffers (estimate) | 77 MB | 86 MB | | |
So about 270 MB (low) and 320 MB (medium) of heap plus GPU memory, under the 400 MB aim. WebKit process RSS cannot be isolated from other browsers on the machine (a blank WebGL page alone costs 190 MB).

## Known issues
- Real-iPad speed is unknown: the Mini is an M-class GPU. Low draws ~3-4 ms there; an iPad GPU is slower, but there is more than 5x headroom against 33 ms.
- The cascade is 10 m from the bridge (the carve ramp is 3 m wide); the falls are straight curtains, the photo's are more broken. Boulders are lumpy domes, not photographic rock.
- Beaufort: the ruin is four wings with two to four round towers (the real one has a big square tower block and a dry moat: the moat is not modelled). The Renaissance castle has one tower at a guessed corner. Houses are rectangles (1-3 per footprint), L-shapes are approximated.
- Berdorf: only the OSM buildings (some new houses in the south east are missing in OSM), no gardens or fences. Houses are solid walls for the bike; the roofs cannot be ridden.
- Medium and high at the village poses: up to 20 town draw calls (still inside the budgets).
