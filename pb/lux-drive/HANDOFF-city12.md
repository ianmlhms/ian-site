# HANDOFF city12 (6 Nov 2026) - branch lux-drive-city12, worktree ~/Library/Caches/website-luxdrive-look

State: all gates pass on the committed tree (harness 156/156, world, holes medium/low, ui, webkit); main.js ?v=57.  See PROGRESS "City 12".

## Open: reuse the train simulator's landmark models (Ian, via the coordinator, arrived at the end of the round)
`pb/train-sim/luxtram-landmarks.js` (TS.luxLandmarks) + `pb/train-sim/data/luxtram-landmarks.json` (1.8 MB). NEVER edit pb/train-sim: copy / adapt into pb/lux-drive.
Findings so far:
* The JSON has real LOD2 geometry per landmark: `j.gare.b` = [{role 'main' (OSM 209293282), roofs: 667 polygons, walls: 657}, {role 'pavilion' (OSM 123661455)}];
  `j.etoile.b` (roles radbury 210440175, centre 210440141), `j.hamilius.b` (lafayette, lafayette2, lafayette3).  No 'rouge' entry (the bridge is procedural: def 'rouge').
* Each polygon is a flat array x, z, y in DECIMETRES (decodeLod: /10) relative to the landmark anchor FP[key].a (gare: lat 49.599979, lon 6.134014) projected by the
  train sim's defaultProject (check its axis signs: z may be north-positive); y is relative to the LOD2 baseline a0, `dy = a0 - ad` puts it on the terrain.
  Map the anchor with scripts/luxdrive/osm_query.py to_world() (EPSG:2169, origin E 72192 / N 83968 top) and verify against GARE_OUTLINES in landmark-gare.js.
* Their Gare: LOD2 walls + roofs coloured by slope (steep slate #41464e, > 24 m copper #4f9a86, flat grey), clock dials on the LOD2 tower top, six platform canopies.
  Ours: hand-built on the OSM outline (landmark-gare.js, 2 091 tris).  Plan: build the LOD2 roofs/walls into a Soup (triangulate each planar polygon: landmark-soup triangulate
  after projecting to its plane), keep our tower details / clocks / arch window / glass hall where they match the photos, compare in a montage with refs/The_Gateway_to_Luxembourg.jpg
  from city12 poses gare_place / gare_front / gare_lib.  Triangle budget: non-campus landmarks ~58 200 of 60 000 - 1 334 LOD2 polygons will need a decimation or savings elsewhere.
* Étoile: their model is the two corner blocks' LOD2 (slate mansards); in Lux Drive those blocks exist in the bake already - check whether the bake's versions are poorer before
  replacing (hide by id via hideBuildings).
* Hamilius (Royal-Hamilius, Bd Royal): faceted atlas skin; needs the atlas cells or a vertex-colour version.
* Draw calls: one landmark mesh each (medium today 150 of 200 in the world gate).
