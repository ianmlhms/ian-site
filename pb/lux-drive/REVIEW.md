# Reviewer fix list (Claude) - read before continuing; these come BEFORE new milestone work

Review 1 (3 Nov, 22:30), from `luxdrive-world.quality-medium.png` and `luxdrive-hill.high-north.png`:

1. **Roads are blobs, far too wide (most severe).** From above, the road network is fat dark-grey
   blobs with round lumps at junctions; streets look 30-60 m wide. Real roads are crisp ribbons of
   their real width (lane ~3.2 m, kerb, pavement 2-3 m). Find the cause (carve kernel / paint radius /
   width units / summed contributions at junctions painting asphalt where the kernel only blends height)
   and make the PAINTED asphalt follow the true carriageway edge exactly; height blending may be wider,
   paint may not. Add a check that measures painted asphalt width vs OSM width along sampled roads.
2. **Place de l'Europe paving** is one huge plaza with a "candy dot" texture (coloured dots, obvious
   tiling). Use a calm painted stone/paving colour with subtle variation, and only where OSM says
   pedestrian area / plaza. Asphalt roads must not use the paving texture.
3. **Sky: the clouds are colourful noise blobs** (purple / red / blue specks). Clouds must be white /
   soft grey (copy the MTB `env.js` sky exactly, it is correct there).
4. **Cliffs / walls next to roads** (right side of the medium shot: a steep grey slab running up the
   hill with a slit). Road carving must never create vertical walls: limit the side slope (max ~35-40
   degrees, 1:1.5 embankment), use the real terrain otherwise. Add it to the harness (max slope beside
   roads).
5. **Small dark boxes** float near roads in the high-north view (bridge decks or stops?). Every solid
   must sit on or span the ground correctly; check `decks.bin` placement (a deck far from any bridge
   road = wrong) and make the probe flag them.
6. Terrain colour is blotchy (bright green patches, brown stripes on hills that look like height
   bands). Use the MTB ground shader colours and the land classes; no colour by height.

Keep going with M2 / M3 after these. Commit each fix separately with a clear message.

---
Review 2 (4 Nov, 00:25), from `luxdrive-wall.wall-c.png`. Roads now look right (A1 width + markings: good).
You spent a whole chunk on item 4 without a commit. **Commit your current work now**, then:

7. **Overpass = pit (root cause of the "walls").** Where Rue du Grünewald crosses OVER the A1, the A1's
   cut is carved into the crossing road, so the bridge road dives into a dark pit. Rule: a way with
   `bridge=*` / `layer>=1` is NEVER carved into the height function and the lower road's carve must not
   lower the ground under the upper road's approach. The upper road crosses on a solid deck (decks.bin,
   with abutments) at its own height; the ground stays the ground. Look at how `pb/train-sim`
   `overbridges.js` / `overbridges-mesh.js` (W5 roads2) solved exactly this for roads over the railway.
8. **Jagged edges** (staircase along the A1 median and verges): the edge is decided per 1 m lattice
   vertex. Paint the carriageway edge per PIXEL in the shader from a smooth distance (signed distance to
   the road centreline minus half width, interpolated), so edges are straight lines.
9. **Time box:** if 7 is not solved within ~80 turns, write what you found in PROGRESS.md, leave it, and
   START MILESTONE 3 (city buildings). The reviewer will take the remaining wall cases. Buildings are now
   more important than perfection on item 4.

---
Review 3 (4 Nov, 02:30), from `luxdrive-city.vieilleville-high.png` and `luxdrive-city.kirchberg-street.png`.
Walls + overpass fixed, the city exists: good progress. Next, in this order:

10. **Roofs are mostly flat dark slabs.** Use the LOD2 roof geometry (eaves + ridge -> gable / hip /
    mansard); the old town (Vieille Ville, Grund, Pfaffenthal, Clausen) is pitched dark slate roofs.
    Flat only where LOD2 says flat (offices, Kirchberg).
11. **Façade style must fit the place.** Shutters + small windows only on houses (residential, <= 5
    floors, old town / villages). Kirchberg, the Cloche d'Or-style offices, banks, EU buildings,
    anything office / commercial / public or > 25 m: modern façades (glass bands, metal mullions,
    lighter stone), NO shutters. Ground floors in the old town: shop windows.
12. **No grass up to the walls in town.** Urban streets get pavements (OSM sidewalk tags, else ~2.5 m
    default on urban roads) in a paving colour; the land class `urban` is hard ground, not lawn.
13. In the Kirchberg street shot the carriageway looks like light stone paving; default road surface is
    asphalt unless OSM `surface` says otherwise. Check the surface default.
Then trees (you are on it), then Milestone 4 (gates).

---
Review 4 (4 Nov, 04:20), from `luxdrive-facade.kirchberg-facade.png` and `luxdrive-facade.grund-facade.png`.
Big improvement: Kirchberg glass façades and Grund (church, shuttered houses, asphalt) now read as real.
14. **Start position**: the car starts on the paved plaza between office blocks. Start on the carriageway of
    Avenue John F. Kennedy next to Place de l'Europe, facing along the road.
15. **Ragged pavement edges**: pavements / kerbs are blotchy light-grey shapes spilling into yards. Same
    per-pixel distance treatment as the carriageway (item 8): straight kerb lines, constant width.
16. **Road markings break into fragments** (stray dashes / arrow pieces near junctions). Markings only
    along the continuous centreline / lane lines of a way, cut cleanly before junction areas.
PRIORITY NOW: finish M3 with 14-16 quickly, then **Milestone 4 (gates) is the top priority**: the
reviewer needs the hole flow, the road-end probe, the building float probe and the draw-call numbers
before 08:00. Milestone 5 (UI) after that.
