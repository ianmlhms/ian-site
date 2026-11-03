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
