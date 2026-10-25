# HANDOFF (W2 -> next agent)

State: everything is committed on branch `mtb`; W2 is done, see `W2-NOTES.md` (gates, what exists, honest open list). W3 = all trails, game loop, bike feel, crashes; W4 = menus, saves, scores, tile, audio, polish.

Where things live (new in W2): `world-build.js` (pure world, used by `main.js` and `harness.js`), `forest*.js` `undergrowth.js` `tree-models.js` `leaf-textures.js` (vegetation), `rocks.js` `rock-models.js` `rock-view.js` (sandstone), `water.js` `water-view.js` `landmarks.js` `bridge-model.js` (water, falls, Schiessentümpel), `rider.js` `camera.js`, `env.js` `light-glsl.js` (light, weather, lamp), `effects.js` `hikers.js` (life), `ground-shader.js` (fields, wet, `LOW` variant).

Dev tools (one browser at a time!): `scripts/mtb/report_shots.mjs OUT [prefix,...]` (the W1 camera poses), `compare.mjs OUT [name]` (photo | screenshot montages, poses in the SPECS array), `lab.mjs` (rock models on flat ground), `lookat.mjs`, `shot.mjs`, `atlas_preview.mjs`. Rebake: `fetch_osm.py`, `fetch_lidar.py`, `bake_terrain.py`, `bake_trails.py`, `bake_ways.py`, `bake_classes.py`, `bake_features.py` with the luxtram venv.

Next steps I would take: (1) distance LOD for rocks and corridor walls to bring the gorge scenes under 900 k triangles; (2) brighter canopy light and warmer-neutral bark; (3) rock shape: more overhangs, ivy, fern and litter at the foot; (4) Schiessentümpel pool and bank detail, bridge steps, deck in the physics surface (a "bridge deck" layer read by `surface.height`, with a harness check); (5) W3 trails: new trails go into `scripts/mtb/trails.def.json`; corridor walls, roots and falls follow automatically.
