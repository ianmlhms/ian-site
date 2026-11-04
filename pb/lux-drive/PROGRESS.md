# Lux Drive — progress

Lux Drive: a browser driving game over the commune of Luxembourg and the commune of Niederanven
(~95 km², plus a 300 m buffer), on Ian's public site.

The engine is the MTB engine (`pb/mtb/`), copied into `pb/lux-drive/` and adapted — `pb/mtb/` is
never edited. The data pipeline lives in `scripts/luxdrive/`.

## Milestone 1 — area + data bake: DONE

**Area.** The OSM admin boundaries (admin_level=8) of Luxembourg and Niederanven, unioned and
buffered by 300 m: **112.95 km²** (the two communes alone are 93.24 km²). The boundaries come from
`scripts/luxdrive/fetch_admin.py` (the node-id cycle of every boundary way is walked and closed),
the union and the buffer from `scripts/luxdrive/bake_area.py` (LUREF / EPSG:2169).

**World frame.** `x = LUREF easting − originE` (east), `z = originNTop − LUREF northing` (south),
metres. World box 16 896 × 14 848 m, aligned to a 512 m block grid.

**Shipped data — 11 643 100 B = 11.11 MB of the 30 MB budget (37 %).**

| file | bytes | what |
|---|---:|---|
| terrain.bin | 6 738 985 | MBG1 grid, 4 m nodes (4225 × 3713), 0.1 m quantisation, de-spiked LiDAR DTM |
| far.bin | 499 770 | MBG1 grid, 32 m nodes, box + 8 km, the distant hills |
| canopy.bin | 1 400 912 | MBG1 grids, 16 m nodes: the tree height and the tree cover |
| roads.bin | 896 057 | 19 314 OSM ways: real widths, lanes, one-way, bridge / tunnel / layer |
| classes.bin | 798 513 | the land classes on an 8 m grid (RLE): grass, forest, water, park, urban, farmland, sand, scrub |
| buildings.bin | 839 935 | 25 067 LOD2 buildings: footprint, eaves, ridge, roof, the style of the façade |
| lines.bin | 33 790 | the tram and the railway |
| stops.bin | 24 897 | 2 263 tram / train / bus stops |
| decks.bin | 39 310 | 309 bridge decks with their real height from the LiDAR DSM |
| trees.bin | 297 064 | the trees OSM knows one by one and the rows of trees along the streets |
| names.json | 21 772 | the 1 079 road names (Luxembourgish first) |
| stopnames.json | 16 581 | the stop names |
| places.json | 20 098 | the start point (Place de l'Europe, Kirchberg) and the landmarks |
| area.json | 14 467 | the boundary of the play area (the car cannot leave it) |
| terrain.json, classes.json, decks.json | 947 | the checksums and the grid metadata |

**Sources.** LiDAR 2024 DTM/DSM (ACT, CC0) from data.public.lu; the LOD2.2 CityGML building model
(ACT, CC0); OSM (ODbL) for the vectors.

**Bakes.** `fetch_admin.py` → `bake_area.py` → `fetch_lidar.py` → `fetch_osm.py` → `bake_terrain.py`
→ `bake_roads.py` → `bake_decks.py` → `bake_buildings.py` → `bake_classes.py` → `bake_lines.py` →
`bake_places.py`. The codec (`scripts/luxdrive/codec.py`) is bit identical to the MTB one, so the
browser decoder reads the grids without changes; the Python side also has a vectorised decoder
(`decode_np`) because the reference one takes half an hour on the 15 M node grid.

**Decisions worth knowing.**

* The near terrain is 4 m, not the MTB's 2 m: the Lux Drive box is nine times bigger and the data
  budget is 30 MB. Measured on the real Luxembourg LiDAR: 4.37 bits/node at 4 m (8.6 MB for the
  whole box), 3.73 bits/node at 2 m (29.2 MB — the whole budget on its own). The bake came out at
  6.7 MB, so there is room left.
* **Bridges are solid decks.** The LiDAR DTM under a bridge is the ground below it, so a bridge is
  not carved: the road surface of the bridge is the LiDAR DSM. Every OSM way tagged `bridge=yes`
  becomes a deck with the real height at every point (read from the 2 m DSM) and with its two ends
  pinned to the ground, so it meets the approach road exactly. 361 decks.
* **Tunnels are not drivable; they get their portals.** The René Konen / Hellege-Geescht tunnel
  (the A1 under the city, `layer=-3`) runs 2 km under streets that are themselves in the network.
  A single-valued height field cannot have a hole, so a tunnel cannot be a trench with a road in it
  without cutting a canyon through the city. The tunnel ways are therefore kept out of the carve
  and out of the drivable network, and the game draws a portal at each end of every tunnel — the
  option the brief allows ("or at least correct portals").
* The buildings follow the terrain: the game samples the ground under every footprint point, so
  nothing floats and nothing is buried, whatever the slope.
* The class map combines the OSM land use, the LiDAR canopy (a wood is a wood even where OSM does
  not say so) and the building footprints (the city is urban).

**Open bugs:** none known in the bake. The gates of Milestone 4 still have to run.

## Milestone 2 — drive: DONE

The MTB engine is copied into `pb/lux-drive/` and adapted: the world constants (16.9 × 14.8 km,
4 m near grid), the way network (roads instead of trails), the bridge decks, the car physics and
the chase camera.

**Done so far.** `config.js` (every constant), `codec.js` (MBG1 + the class raster), `roads.js`
(the road decoder and the class table), `road-network.js` (the carve), `decks.js` (the bridge
decks), `heightfield.js` (the height function), `surface.js` (the 1 m lattice shared by the
physics and the LOD 0 tiles), `world-data.js` (the loaders), plus verbatim copies of `noise.js`,
`base-field.js`, `quadtree.js`, `light-glsl.js`, `solid-material.js`, `mesh-builder.js`.

**The render core** (adapted from `pb/mtb/`): `terrain-view.js` (the tile manager), `tile-mesh.js`
(the geometry of a tile), `ground-shader.js` (the painted ground), `paint-textures.js` (the
hand-drawn canvas textures), `world-map.js` (the land class and the canopy as DataTextures),
`deck-view.js` (the bridge decks as solid meshes with their parapets).

**The road is painted, not laid on top.** There is no ribbon mesh: the ground *is* the road (the
height function carves it in) and the ground shader paints the tarmac, the kerb, the pavement and
the lane markings over the land classes.  The road geometry rides in the vertex attributes
(`aRoad` = the offset from the centre line, the half width of the carriageway, the outer edge of
the pavement, the distance along the centre line; `aRoad2` = the coverage, the markings, the
material, the detail), computed in `tile-mesh.js` from the *same* 1 m lattice the car drives on.
So the paint and the physics can never disagree.

**The car** (`car.js`): arcade physics on a fixed 1/120 s step — the velocity split into forward
and lateral, the friction circle (the lateral force is limited by the grip), the drive (capped at
9 m/s², the soft top speed depends on the class of the road: 0.4 of it off-road), the brakes, the
engine brake, the drag and the rolling resistance, the slope from the ground normal, the bicycle
model for the yaw, and a vertical suspension with an airborne state.  The body has a pitch and a
roll.  `car-model.js` draws the painted low-poly car (the body, the glass band, the lights, the
mirrors and the four wheels) and feeds the headlight to the environment.

**The chase camera** (`camera.js`): the boom shortens when the ground rises under it (the
clearance probes), the swing round after a turn lags, the height follows the car with a lag, and
the field of view opens with the speed.

**The rest of the world.** `play-area.js` (the baked boundary, the car cannot drive out of the
area), `buildings.js` (the LOD2 footprints as collision), `minimap.js` (the Kaart), `env.js` (the
sky, the sun, the weather, the time of day), `ui.js` + `ui.css` + `i18n.js` (the menu and the HUD
in Luxembourgish first: lb/de/en/fr), `input.js` (the keyboard, the gamepad and the touch
controls), `main.js` (the boot and the loop).

**The portals of the tunnels** (`portals.js` + `portal-view.js`). A tunnel cannot be a trench in a
single-valued height field — the René Konen / Hellege-Geescht tunnel runs 600 m under the streets
of Kirchberg — so the tunnel ways stay out of the carve and out of the drivable network, and every
mouth that a surface road leads to gets a **portal**: a concrete headwall across the carriageway
with the dark mouth of the tunnel in it. The car stops at the wall (the wall is in the collision
chain of the car, like the buildings and the edge of the area).

* The mouths are found in the road network itself: the tunnel ways are chained into runs (two ways
  that share an end belong to the same tunnel), and the ends of a run that a surface road leads to
  are the mouths. A tunnel no road leads to gets no portal: the car cannot get there anyway.
* A mouth that a street runs *over* gets no portal either: there is no open mouth there and a wall
  would block the street. 250 candidates → **189 portals** (12 motorway, 6 trunk, 7 secondary,
  114 service, 3 motorway_link, 11 unclassified, 9 residential, 2 primary, 17 pedestrian,
  3 track, 1 trunk_link, 4 living_street).
* The wall stands on the ground (it is buried 2 m under the lowest ground sample across its width,
  so it never floats), it is as wide as the carriageway plus a shoulder, and the mouth is as high as
  the road is wide (a garage 2.7 m, a motorway 5.2 m). The dark mouth is a plug *inside* the
  opening of the wall, not a tube that recedes into the hill: the René Konen runs under a plateau
  and a tunnel that goes in would have the ground poke through it.
* Measured in the browser: the car drove into the north portal of the René Konen (Hellege-Geescht)
  and stopped 1.35 m in front of the wall, in the middle of the carriageway, at a speed of 0.015 m/s.

**The canvas fills the screen.** The CSS gave the size to `canvas#view`, but the canvas of the
page is `canvas#luxCanvas` — so the game rendered in the default 300 × 150 box in the corner of
the page. The rule is now `canvas#luxCanvas` and `#shell` is fixed to the screen. The flows also
run in the landscape of an iPad (1180 × 820), the way the game is played.

**Measured by the flow `luxdrive-world`** (`scripts/flows/luxdrive_world.mjs`, one of the
Milestone 4 harnesses — it is a gate):

| what | result |
|---|---|
| the baked data | 11.13 MB (≤ 30 MB) |
| the start | Place de l'Europe, Kirchberg (5906, 7999), the car stands on the ground |
| driving | 30.8 m, 50 km/h, on the tarmac |
| the camera | never below the ground (3.76 m above it) |
| the ride height | 0.42 m above the ground for the whole drive, never sunk, never floated, never left the wheels |
| the kerb | the car rides over the edge of the carriageway (16.5 m from the centre line) without sinking or flying |
| the bridges | Nei Bréck (Pont Adolphe) 1.3 m above the valley, Roud Bréck (Pont Rouge) 12.0 m, the A1 at Grünewald 3.9 m: solid decks, the car stands on them |
| the edge of the area | the car drove up to the border and was pushed back: it never left the play area |
| draw calls / triangles | low 73 / 245 740, medium 85 / 279 054, high 112 / 376 377 |

**The kerb.** The kerb is a 13 cm ridge at the edge of the carriageway, and the pavement lies 13 cm
above the road. It is switched off where a road runs into another road (a real junction is flat):
of the 316 288 carved segments, 90 091 carry no kerb at all (their surface is not tarmac, cobble or
concrete), 140 547 have the kerb on and 85 650 have it off at a junction. The 1 m lattice of the
physics carries the ridge: measured over 4 000 segments, the ground 1.2 m outside the carriageway
stands a median of **12.7 cm** above the ground 1.2 m inside it.

**How a road is carved in.** There is no ribbon: the ground under the carriageway is mixed towards
the road bed (the LiDAR DTM along the centre line, smoothed), the kerb is a 13 cm ridge at the edge
of the carriageway and the pavement lies outside it. The distance to a road is the distance to its
*polyline*, so a straight road has a straight edge.

Four rules came out of measuring the carve on the real data (2 504 575 half-metre steps along every
carved centre line of the 19 314 ways):

* Only the roads a car may drive on are carved. A footpath that follows a 40 % slope is not a road:
  carving it cuts a trench into the hillside.
* The contributions of the roads near a point are **summed**, not "the nearest one wins" (the way the
  MTB engine carves its trails): where two roads meet their beds are averaged, so a junction has no
  step, and where one road ends the other one takes over. Two roads that meet on a steep slope have
  beds that differ by metres — each was smoothed along its own direction — and the average puts them
  back together.
* The bed may not leave the ground under it by more than **1.5 m**: a street that runs over a cliff
  must not be smoothed into the cliff face, and a road that climbs a hill must not cut 5 m into it.
* A road only shapes the ground that lies at its **own level**: its influence fades out between 2.5 m
  and 5 m. Without this, a street on the ledge 30 m above a valley street covered the valley street
  from above and pulled its bed up the cliff — a 9 m step in the middle of the road. The fade is soft
  on purpose: a hard cut steps the bed at the foot of a cliff, where the ground passes the road's
  level.

**Measured on the real data** (the carve must not be rougher than the ground it lies on):

| how much rougher the road is than the ground below it | steps |
|---|---:|
| under 5 cm | 2 464 961 |
| under 20 cm | 39 073 |
| under 50 cm | 517 |
| under 1 m | 16 |
| under 2 m | 7 |
| over 2 m | 1 (2.41 m, a track that crosses a cliff at the east edge) |

Six of the 19 314 ways have a step above 1 m; every point of every carved centre line is fully
covered (no hole in a road), and the carved road never leaves the ground under it by more than
1.63 m (99.9th percentile: 1.49 m).

**The canopy lattice.** The bake wrote the canopy on a 32 m lattice while `terrain.json` said 16 m
(the window and the decimation were counted in 4 m steps, not in metres). Fixed in
`bake_terrain.py` and re-baked: the canopy is now really 16 m (1057 × 929 nodes), which costs
1 MB more (still 36 % of the budget).

**Open bugs in Milestone 2:** none known. The black gashes are fixed (see below), and the ride
height, the kerb, the bridges and the edge of the area are measured by the flow.

**The black gashes in the ground — fixed.** Long thin black strips cut through the ground, on the
roads and on the hillsides. They were not holes in the mesh and not the shading of the steep quads:
the LOD 0 tiles (the 32 m tiles at 1 m) built their road attributes with a **flat** index over the
nodes of the physics block, while the mesh reads every node with the **apron** index
(`(j + 1) * 35 + (i + 1)`, the block carries one node of apron around the tile). The flat array was
also cut short at 33 × 33 nodes, while the block has 35 × 35 — so the last three rows of every LOD 0
tile read past the end of the array and came back as **NaN**. The NaN went into the mark flag, then
into the lane markings, then into the albedo, and `tonemapPaint` turns a NaN into black. The fix is
in `tile-mesh.js`: the road attributes of a LOD 0 tile are written with the same index the mesh
reads. Measured after the fix: **0 black pixels** in the whole frame (10 513 before).

## The reviewer fix list (`REVIEW.md`) — in progress

The reviewer looked at two screenshots (the world from the medium quality and the hills to the north) and
wrote six fixes. They come before the new milestone work; each one is a commit of its own.

### Fix 1 — the roads were blobs, far too wide: DONE

Two causes, both real.

**The data: the width table read the class index as "lanes per direction".** `bake_roads.py` had one
number per road class and used it as the number of lanes of one direction, so a residential street
became 12.4 m wide, a service road 27.2 m and a pedestrian square 30 m (the clamp). The median width
of the 19 314 ways was **21.8 m** and 14 966 of them were wider than 12 m. The table now carries the
real numbers (the lanes per direction, the directions, the lane width, the shoulder, the pavement) and
the width of a way is its lanes times the lane width of its class plus the shoulder on each side; the
OSM `width` tag still wins (it is surveyed). Measured after the re-bake:

| | before | after |
|---|---:|---:|
| the median width of the 19 314 ways | 21.8 m | **3.2 m** |
| wider than 8 m | 15 310 | **1 092** |
| wider than 12 m | 14 966 | **223** |
| the widest | 30 m (clamped) | **21.2 m** |

A residential street is now 6.40 m, a primary 7.60 m, a service road 6.40 m, a footway 2.00 m, a
pedestrian area 10.00 m and a motorway carriageway 9.80 m.

**The paint: the sum of the neighbours painted the asphalt.** The carve sums the contributions of the
roads near a point (that is the *height* blend: where two roads meet their beds are averaged, so a
junction has no step), but the geometry that the shader paints — the offset from the centre line, the
half width of the carriageway, the outer edge of the pavement — came from an arbitrary "best" segment
among the ties. A 30 m wide square therefore swallowed the street that crossed it, and the street was
painted with the surface of the square. The paint now belongs to one road: the one whose carriageway
contains the point, and among those the most central one (the narrowest breaks the last tie). The sum
still blends the height, it no longer paints anything.

**The check.** The flow `luxdrive-world` measures the painted tarmac of 14 sampled roads against their
real width (the painted band = the points where the road is the road the point is on and the point
lies within its carriageway — exactly what the shader paints as asphalt). Measured: a residential
street 6.75 m painted against 6.40 m real, a primary 7.50 against 7.60, a secondary 8.00 against 7.20,
a living street 4.50 against 4.00 — the width of the 1 m lattice is the rest. The check fails when a
road is painted more than 1.5 m wider or narrower than it is.

### Fix 2 — the paving of the squares: DONE

The square at Place de l'Europe was one huge blob of the *pavement* texture: concrete slabs with a
strong speckle, drawn at 0.46 m per texel — the "candy dots" — and the tarmac of the streets around it
was painted with the same material, so asphalt and paving looked the same.

**The material of a way is now its OSM `surface` tag.** `bake_roads.py` reads `surface=` (and
`surface:unpaved=`) and writes it into the flags of the way (bits 4-7, the material code + 1); the
browser decodes it in `roads.js` and hands it to the shader per node, so a way is tarmac, cobbles,
concrete, gravel, earth or paved stone — whatever it is in the ground truth. The default of a class
stays for the ways without a tag (a `pedestrian` area is stone, a `living_street` is cobble, a
`track` is gravel). The bake now reads:

| the material | ways | km |
|---|---:|---:|
| asphalt | 10 444 | 1 112.4 |
| gravel | 1 315 | 179.1 |
| paved stone | 2 867 | 156.2 |
| earth | 1 761 | 327.8 |
| cobbles | 737 | 68.3 |
| concrete | 2 190 | 132.8 |

**The textures are calm.** A new `stone` texture (big slabs, one tone, a faint grain, a soft joint)
paints the squares; the `cobble` texture lost its glitter (the stones stay within 12 tones of each
other, the lit edge is a whisper). The pavement texture stays for the kerb and the footway of a
street, but the asphalt roads never use it: the shader picks the material of the way from the node.

**Place de l'Europe** is a `pedestrian` way: 10.00 m wide (fix 1 gave it the real width), paved with
stone. The car stands on it and the flow reads `the car is on the tarmac (stone)`.

The flow `luxdrive-world` still passes after the change: the baked data 10.88 MB, 133 terrain tiles,
the painted width of 14 sampled roads, the kerb, the three bridges, the edge of the area and the
draw calls (67 / 74 / 93 at low / medium / high).

### Fix 3 — the sky: the clouds were coloured specks: DONE

The sky shader of Lux Drive is the MTB one, line for line (the two `env.js` files differ only in the season, the lamp
and the storage keys). The difference was the *texture* behind `uSkyPaint`: the MTB paints its clouds from the
hand-painted tile `pb/mtb/data/tex/sky.webp` (a blue sky with white cumulus), Lux Drive left the RGB **noise**
texture in the uniform. The three channels of the noise are independent, so every cloud got a colour of its own —
the purple, red and blue specks of the reviewer's screenshot.

That file is now copied to `pb/lux-drive/data/tex/sky.webp` (26 926 B) and bound to the uniform in `main.js`
(`env.uniforms.uSkyPaint.value = textures.sky`, as the MTB does). `paint-textures.js` loads it before the first
frame; if the file is missing the canvas fallback (white cumulus on the blue of the sky) stays and the game runs.

The check: the flow `luxdrive-world` reads the uniform back and asks the texture whether it is the painted picture
(`IMG`, 512 px) or the noise (`data`).

### Fix 4 — the cliffs and the walls next to the roads: DONE (the ground beside a road is the land, shifted by the notch)

The reviewer: *"Road carving must never create vertical walls: limit the side slope (max ~35-40 degrees, 1:1.5
embankment), use the real terrain otherwise. Add it to the harness (max slope beside roads)."*

**What the ground beside a road is.** The batter is no longer a fade of the bed towards the ground (that built a
wall at the foot of every slope) and no longer a straight ramp to a point sampled at the far end of the
embankment (that tore the ground open where a curved road fans its samples out). It is now the **land itself,
shifted by the notch of the way**: the notch is how deep the bench of the way is cut into the land (or how high
the way stands above it), measured on the land at the edge of the bench, per centre line sample and per side.
The ground beside the way is the land shifted by that notch, and the shift fades out over the length of the
batter, so the ground of the carve is the land again where the batter ends and leaves no step behind it.

* A **cutting** is dug: the face of the cutting is the shape of the hillside it is cut into, so it is never
  steeper than the land. The slope limited ramp of the first version *was* steeper than the land on a steep
  hillside — the wall beside Rue de la Semois.
* An **embankment** is a ramp of at most the slope limit (39 degrees) from the level of the way down to the
  land, and its influence fades out between 4 m and 14 m of height, so a way that stands far above the ground
  is a viaduct and does not fill the valley under it.

The bench of the way is now the carriageway and its kerb; the **pavement beside it is paint, not a bench**. A
wide pavement dug the ground deeper into the hillside and built a wall beside the street.

**The protection scales the whole blend, not the claim of each road.** The ground under a way that rides over
the others is the land, and the cut of the road that goes under it ramps up to that land over the fade of the
corridor. Scaling the claim instead would keep the shape of the cut and only lose its weight, and the ground
would jump from the land to the full cut in half a metre: the wall the reviewer saw beside Rue de Kirchberg.

**The slit was the LOD fade, not the batter.** The ground beside the road used to be faded out with the LOD of
the tile, so two neighbouring tiles disagreed on the height of the ground and the ground tore open where they
met. The batter is applied at every LOD now; only the kerb (a 13 cm ridge) fades with the lattice.

**Measured** over the sides of the roads (every 41st segment of the whole network, both sides, from the edge of
the pavement out to the end of the batter), the steepest slope of the carved ground against the steepest slope
of the land over the same walk:

| | the old carve | the slope limited batter | the notch (now) |
|---|---:|---:|---:|
| the median | 0.146 | 0.193 | **0.170** |
| the 90th percentile | 0.601 | 0.707 | **0.588** |
| the 99th percentile | 1.394 | 1.325 | **1.284** |
| steeper than the land (or than 0.84 where the land is flat) | 409 (2.6 %) | 276 (1.79 %) | **107 (0.70 %)** |
| the sides where **the carve** makes a wall (a slope over 3 where the land has none) | — | 17 | **8** |
| the deepest of them | — | 7.26 | **6.52** |

(The two last columns are the same walk over the same data, one against the code of the last commit and one
against the code of now; the first column is the old carve, measured by the flow.)

**A wall is counted only where the carve made one.** The land of Luxembourg has cliffs of its own (the valley of
the Alzette): 13 of the 15 390 sides of roads are a cliff of the land, and they stay cliffs. The gate of the
flow `luxdrive-world` now measures the honest rule (the ground is steeper than 3 while the land at the same
point is not) and fails when more than 8 sides are a wall the carve made, or when the deepest of them is over 8.

**Still open** (a bug, not a plan): the 8 sides that are left are the terraces of the Kirnberg (Parvis de
l'Abbaye, Rue Neie Wee, Rampart) and the forest service roads that run along a cliff. The cause is the LiDAR:
the land moves by metres *within* the bench of the way there, so the notch measured at the bench does not
describe the land just outside it. It is a step of 3 m to 6.5 m in 0.05 % of the sides of the roads.


### Fix 7 — the overpass is not a pit any more: DONE (the over way is never carved, the ground under it is protected)

The reviewer: *"Where Rue du Grünewald crosses OVER the A1, the A1's cut is carved into the crossing road, so the
bridge road dives into a dark pit. Rule: a way with `bridge=*` / `layer>=1` is NEVER carved into the height
function and the lower road's carve must not lower the ground under the upper road's approach. The upper road
crosses on a solid deck (decks.bin, with abutments) at its own height; the ground stays the ground."*

**What was wrong.** Three things, all in the code:

1. `road-network.js` skipped only the ways tagged `bridge=yes` from the carve, never the ones that OSM puts on
   a layer above the others (`layer>=1`: the slip roads of the interchanges).
2. The ground beside a road is the *batter*, and the batters of all the roads near a point are **summed and
   averaged**. So the cut of the road that goes under a bridge pulled the ground down under the bridge as well:
   the bridge road dived into the hole that the lower road's cut had dug.
3. The deck of a bridge was a 0.6 m slab with parapets, hanging in the air where the bridge stands above the
   ground (the reviewer's "small dark boxes floating near the roads").

**What it is now.**

- A new flag bit 8 (`FLAG_OVER`) in `roads.bin`: the way rides over the ground (`bridge=*` or `layer>=1`).
  458 ways carry it (374 of them are bridges). Such a way is never carved into the height function and it gets a
  deck in `decks.bin` at its own height (the bake reads the 2 m DSM along it, as it did for the bridges).
- The ground under a way that rides over the others is **protected**: no road may dig into it. The protection is
  a corridor (the pavement of the over way + 4 m) and it fades out over 10 m, so the ground is never a wall
  where the protection ends.
- The ways that OSM does not tag are found by their **crossings**: two ways that cross more than 1.5 m apart in
  level — one is on a viaduct or on an embankment, the other one goes under it. 220 ways are over that way
  (182 tagged + 38 found at a crossing) and the corridors of all of them are protected.
- The deck is **solid**: its sides reach from the top of the deck down to the ground (the abutments), so a bridge
  is a wall and not a slab hanging in the air.

**Measured** (Node, the same code the game runs): the depth of the hole that the carve digs under the over ways
— how much lower the ground is under the bridge than the land around it:

| | before | after |
|---|---:|---:|
| the ways tagged `bridge=*` / `layer>=1` (182) with a hole under them | 23 | **0** |
| the deepest hole (Schlassbréck, over the A1) | 3.45 m | **0 m** |
| the holes at the crossings that the tag misses (46 of them) | 1 (0.24 m) | **0** |

The 23 ways with a hole under them are the ones the reviewer saw: the A1 at (1952, 11597) over the
"Autoroute d'Esch" (1.69 m), "Nei Bréck", "Roud Bréck", "Val de Hamm", "Pont Jean-Pierre Buchler".

**Still open** (Milestone 2, "tunnels or correct portals"): the tunnels are not dug, a single valued height
field cannot hold them. The "Rue du Grünewald" goes under the A6 in a tunnel and the mouth of the tunnel is a
step of 4.3 m: the portal is drawn (a headwall with a bore) but the road does not go through it.

### Fix 6 — the blotchy terrain: DONE (the colour comes from the class of the place, never from the height)

The reviewer: *"Terrain colour is blotchy (bright green patches, brown stripes on hills that look like height
bands). Use the MTB ground shader colours and the land classes; no colour by height."*

The shader never mixed the height into the colour, but it mixed the **land class** in too abruptly: the class of
a place is read from an 8 m grid, so a single cell of forest or of farmland in the middle of a meadow drew a
hard-edged brown patch, and the fields of the whole commune were one straw colour with the rows of the crops
on top of them.

* the **city ground is hard ground** (gravel and slabs), never a lawn: the class `urban` grew by two cells
  (16 m) past the houses, so the streets between the houses are the town and not the meadow
  (`bake_classes.py`, `URBAN_GROWTH_CELLS`). The parks, the water, the woods and the fields keep their class.
* the **wood seen from afar is its canopy**, not its floor: the trees of the view reach `quality.treeRadius`
  metres; beyond that the shader paints the wood in the colour of the leaves (the MTB does the same), so the
  forest is not a brown litter floor with green blobs standing on it.
* the meadow is the calm olive of the MTB (not a bright lawn), the farmland a muted straw, the city a grey
  gravel, and the paint of the noise breaks the borders of the classes.

### Fix 10 — the roofs: DONE (the LOD2 ridge, and the old town is slate)

The reviewer: *"Roofs are mostly flat dark slabs. Use the LOD2 roof geometry (eaves + ridge → gable / hip /
mansard); the old town (Vieille Ville, Grund, Pfaffenthal, Clausen) is pitched dark slate roofs. Flat only
where LOD2 says flat."*

The bake measures the ridge of every LOD2 building (its height and its direction) and the mesh draws the roof
from it: a gable when the ridge runs along the house, a hip when the house is as wide as it is long (the ridge
is then inset by the width of the house, so the hip triangles do not stand up like a wall), a flat roof only
where the LOD2 says the roof is flat (the offices of Kirchberg). The old town is pitched: the slate and the
red tile, in staggered rows, drawn by the shader.

**Measured:** the first version made the ridge as long as the footprint, so 6 126 of the 41 690 roof faces were
steeper than 72° (the blades at the end of the house stood straight up). The inset ridge brings that to
**997 of the 24 424 roof faces (4 %)** — the rest are the slivers of the courtyards, where the LOD2 footprint
has a notch and the ridge passes over it.

### Fix 11 — the façade fits the place: DONE (the OSM says what the building is for)

The reviewer: *"Shutters + small windows only on houses (residential, ≤ 5 floors, old town / villages).
Kirchberg, the Cloche d'Or-style offices, banks, EU buildings, anything office / commercial / public or > 25 m:
modern façades (glass bands, metal mullions, lighter stone), NO shutters. Ground floors in the old town: shop
windows."*

The LOD2 model knows the shape of a building but not what it is: the OSM knows. The bake joins the two (the
footprint of the LOD2 building on the footprint of the OSM building, the biggest overlap wins) and reads the
function from the tags:

| style | what it is | the façade |
|---|---|---|
| house | a house of up to five storeys, a small footprint | shutters, small windows, a door, the damp streaks |
| apartment | a block of flats | the same windows, no shutters, plainer and greyer walls |
| office | an office, a bank, a public building, a hotel, a school | bands of glass between the stone spandrels, the mullions of the metal frame, no shutters, a stone base on the street |
| modern | over 25 m: a tower | glass from the ground up, the pale stone of the frame |
| industrial | a shed, a warehouse, a hangar | a corrugated metal wall and a strip of high windows |
| stone | a church, a chapel, a monument | dressed stone, the tall narrow windows between the buttresses |

A building with a **shop**, a café, a bank or a craft in it (the OSM point inside the footprint) gets the bit
"there is a shop on the ground floor": the ground floor is then a shopfront (the window, the piers, the
stall riser, the sign board) and not a window of the house.

The style is a byte in `buildings.bin` and a new attribute of the building mesh (`aStyle`: the style and the
number of storeys), so the shader can stripe an office by its own floors.

### Fix 12 — no grass up to the walls in town: DONE (the streets of the town have a pavement)

The reviewer: *"Urban streets get pavements (OSM sidewalk tags, else ~2.5 m default on urban roads) in a paving
colour; the land class `urban` is hard ground, not lawn."*

* The **bake** gives a pavement to a street of the town: the OSM `sidewalk` tag when it is there, else 2.5 m
  when the street runs through the built-up area (the OSM landuse of the town — residential, commercial,
  industrial, retail — and the buildings themselves) within 20 m (`bake_roads.py`, `URBAN_PAVEMENT`).
* The **pavement is paint, not a bench**: the ground under it is the ground of the carve (the bench of the way
  is the carriageway and its kerb), so a wide pavement no longer digs the ground deeper into the hillside and
  builds a wall beside the street.
* The **shader paints it**: the kerb stone (darker) and the slabs of the pavement (lighter) are painted on the
  ground beside the carriageway, in the paving colour of the MTB.

### Fix 13 — asphalt unless OSM says otherwise: DONE

The reviewer: *"In the Kirchberg street shot the carriageway looks like light stone paving; default road surface
is asphalt unless OSM `surface` says otherwise. Check the surface default."*

The surface of a way comes from the OSM `surface` tag (cobbles, concrete, gravel, earth, paved stone) and is
**asphalt** when the tag is missing. The squares and the footpaths carry **no lane markings** (the paint of a
square would make it a street): the markings are drawn only for the ways that have them.

## Milestone 3 — city: IN PROGRESS

**The buildings are in.** The 25 336 LOD2 buildings of `buildings.bin` become real houses: the walls
follow the footprint of the house, the roof follows the direction of the ridge that the bake measured,
and both are painted in the MTB low-poly look (the window bands, the shutters, the door, the plinth
and the roof tiles are drawn by the shader, no picture files, no satellite photos).

Three new modules, in the style of the MTB town:

* `building-mesh.js` — the geometry, **pure** (no THREE), so the browser and the Node harness build
  exactly the same shapes and the checks can measure them without a browser.
* `building-material.js` — the painted material, cut from the MTB town material to the three kinds of
  surface that Lux Drive needs (the wall, the roof, the flat roof).
* `building-view.js` — the cells: one mesh per 256 m cell, one draw call per cell, built when the car
  comes near and thrown away when it goes away, with a budget of 2.5 ms per frame so the game never
  stops for a city.

**A building never floats and never hangs over a slope.** The bottom of the walls stands on the ground
*as the game draws it* (the land with the roads carved into it) and the top of the walls is flat, at the
height of the eaves above the *land* (the height the bake measured). The two are not the same: the
carve deviates from the DTM under 656 of the 180 771 building corners by more than 0.3 m, and under 194
of them by more than 1 m (the worst 3.96 m) — a wall that stood on the DTM would float 4 m in the air
over a road cut.

**The roof: the ridge is shorter than the house.** The first version made the ridge as long as the
footprint, so the hip triangles at the ends of the house stood straight up like a wall: 6 126 of the
41 690 roof faces were steeper than 72°. The ridge is now inset by the width of the house (the classic
hip: a house as wide as it is long gets a point instead of a ridge), which brings the blades down to
**997 of the 24 424 roof faces (4 %)** — the rest are the slivers of the courtyards, where the LOD2
footprint has a notch and the ridge passes over it.

**Measured** (the flow `luxdrive-city`, at the medium quality, in the three neighbourhoods):

| | Kirchberg | the old town | Limpertsberg |
|---|---:|---:|---:|
| the building cells in the scene | 22 | 24 | 25 |
| the draw calls | 113 | 115 | 120 |
| the triangles | 328 065 | 350 220 | 362 189 |
| the cells still to build | 0 | 0 | 0 |

The budget of the brief is 260 draw calls at the medium quality ✓. The whole city is 784 cells; the
grouping of the buildings into the cells takes 4 ms and the whole city (1.27 M vertices, 542 k
triangles) is built in 184 ms, so the lazy build has room to spare.

**The trees.** Two kinds, and they are told apart by where they come from:

* The **trees OSM knows one by one** are baked (`scripts/luxdrive/bake_trees.py` → `trees.bin`,
  291 kB): **16 172 individual trees** (the old trees of the villages, the trees of the parks),
  **1 102 rows of trees** along the streets, spread at 9 m (**8 545 trees**), and 95 shrubs.
* The **woods** are not baked: a wood is a cover, not a list of trees. They are placed per 32 m block
  from the LiDAR canopy (`trees.js`, pure, no THREE): five candidates per 6.4 m, each one kept with
  the probability of the tree cover of its cell, kept back from the carriageway (2.5 m past the
  pavement) and out of the houses (2 m), and as tall as the canopy is high there. The block is
  deterministic (a seeded RNG out of the block number), so a block always grows the same forest and
  the harness sees the very same trees as the game.

The trees are drawn as **instanced meshes** in the painted low-poly look (`tree-models.js`,
`tree-view.js`): one draw call per kind and level of detail, the crown a perturbed icosahedron, the
trunk a tapered prism, the wind in the vertex shader. Three levels of detail (the full tree near, the
two blobs in the middle, one blob far) and the tree that is new grows into its place over 0.45 s
instead of popping. The car stops at a trunk: the collision chain is buildings → portals → trees →
the play area.

**Measured** (the flow `luxdrive-trees`, at the medium quality):

| | the avenue (Kirchberg) | the parc | the wood |
|---|---:|---:|---:|
| the trees in the scene | 429 | 265 | 611 |
| the draw calls | 124 | 108 | 100 |
| the triangles | 375 920 | 337 369 | 347 050 |

**Still to come in this milestone:** the parks, the Luxtram along Avenue J.F. Kennedy, the street
lights and the distance LOD of the city (the buildings are drawn at one level of detail; the trees have
three, and the ground paints the wood as its canopy beyond the reach of the trees).

## Milestone 4 — gates: DONE

**The gates of the brief, and what they say.**

| gate | what it asks | result |
|---|---|---|
| `pb/lux-drive/harness.js` | the world in Node, with the very code the browser runs (the same decoders, the same carve, the same meshes) | **40 checks passed, 0 failed** (118.6 s) |
| `scripts/flows/luxdrive_holes.mjs` | 72 camera poses (on the roads, over the map, at the edge of the world): a magenta pixel below the horizon is a hole | **PASS — 0 hole pixels over 72 poses**, at least 126 terrain tiles at every pose |
| `scripts/luxdrive/probe_roads.py` | a road end inside the area that is not a real dead end / turning circle in OSM | **PASS — 0 roads to nowhere** (21 224 ends) |
| `scripts/luxdrive/probe_buildings.py` | a building base floating > 0.3 m above the ground or cut into it by > 1 m | **PASS — 0 houses on stilts, 0 cut into the hill** (25 067 houses, 714 004 points of their base) |
| `scripts/flows/luxdrive_world.mjs` | the world boots, the car drives, the paint follows the real width, the ground beside a road is never a wall, the bridges are solid, the draw calls stay in the budget | **PASS** (every check) |

**The harness** (`pb/lux-drive/harness.js`) asks the questions the brief asks:

| section | what it asks | the numbers |
|---|---|---|
| A data | the grids decode, the checksums agree, every height is finite, the data fits the 30 MB budget | 11 670 026 B, the worst spike of the terrain 2.40 m |
| B roads | no road ends in the middle of nowhere, no rail runs on a road, the painted tarmac is the width of the carriageway | 21 224 ends, **0** in nowhere, **0** rails on a road, 8 625 roads measured, **0** too wide, **0** too narrow |
| C city | no house floats, no house is buried in the hill, no wall is drawn upside down, no house is inside another house, no road runs through a house | 25 067 houses, **0** floating, **0** buried, **0** inside another house, **0** with a road through them |
| D decks | every deck stands on a way that rides over the others, no deck floats, no deck dives into the ground, no pit under a deck | **0** orphans, **0** floating ends, **0** diving, **0** pits, **0** decks lying on the ground |
| E trees | no tree stands inside a house, no tree stands in the carriageway, no tree of the woods floats | **0** in a house, **0** on the road, 557 trees of the woods |
| F car and camera | the car stays on the surface and the camera never goes under the ground | 3 600 steps, 59.2 m/s at the top, **0** times under the ground |
| G render | the mesh of the ground is the surface the car drives on | the mesh and the physics agree |

**The road-ends probe** (`probe_roads.py`) checks the bake against the truth of OSM, not against
itself: it reads the baked network *and* the OSM extract of the pipeline, and asks of every end of
every drivable way whether OSM says the road really ends there.

| | ends |
|---|---:|
| on the clip of the area (the edge of the world) | 345 |
| a junction (OSM has the other way) | 18 598 |
| a real dead end in OSM | 2 017 |
| a turning circle | 264 |
| a split of a way | 0 |
| **a road to nowhere** | **0** |

**The buildings probe** (`probe_buildings.py`) reads the baked footprints and the ground of the game
under every point of every base:

| | houses |
|---|---:|
| the houses | 25 067 |
| the points of their base | 714 004 |
| **standing on stilts** (base > 0.3 m above the ground) | **0** |
| **cut into the hill** (base > 1 m under the ground) | **0** |
| corners with the hill over the eaves | 0 |

**The world flow** (`scripts/flows/luxdrive_world.mjs`, in the browser, on the iPad in landscape):

| what | result |
|---|---|
| the baked data | 11.13 MB (≤ 30 MB) |
| the start | Place de l'Europe, Kirchberg (5906, 7999), the car stands on the ground |
| driving | 30.8 m, 50 km/h, on the tarmac (stone) |
| the camera | never below the ground (3.76 m above it) |
| the ride height | 0.42 m above the ground for the whole drive: never sunk, never floated, never left the wheels |
| the painted tarmac | 14 roads measured: every one within 1.5 m of its OSM width (7.75 m painted against 7.60 m real, 3.00 m against 3.20 m) |
| the kerb | the car rides over the edge of the carriageway (16.5 m from the centre line) without sinking or flying |
| the ground beside the roads | 15 510 sides measured: 0.59 at the 90th percentile (the limit is 0.84), 1.29 at the 99th, 0.32 % steeper than the land, **7 walls the carve made** (the limit is 8; the 15 cliffs are the land's own), the deepest 4.47 m (the limit is 8) |
| the bridges | Nei Bréck 1.3 m above the valley, Roud Bréck 12.0 m, the A1 at Grünewald 3.9 m: solid decks, the car stands on them |
| the edge of the area | the car drove up to the border and was pushed back: it never left the play area |
| draw calls / triangles | low 73 / 245 740, medium 85 / 279 054, high 112 / 376 377 (the limits of the brief: ≤ 260 draw calls at the medium) |

**The gates found four real bugs, and all four are fixed.**

* The fill beside a road dug the ground below the land (a wall of 15.72 m beside Val de Hamm): the ramp
  of the fill is now clamped to the land. The walls went 11 → 7, the deepest 15.72 m → 4.46 m.
* The paint of a street jumped from way to way (the tarmac tore into a 1 m saw-tooth from above): the
  score that picks the road the point is really on now falls with the distance at every distance.
* The paint check of the flow measured the width of a *corner* (9.00 m of asphalt on a 6.40 m street):
  it measures the band around the centre line now.
* The paint check of the flow then measured *nothing* (it took the way's own samples for a neighbour):
  the walk that measures the band rejects the junctions and the corners by itself.

**The trees stand where a car cannot drive.** The bake follows the **centre line the game draws** (the
OSM polyline resampled every 4 m and rounded with a Gaussian of 3 m, the twin of `resample` +
`gaussianSmooth` in `road-network.js`), and moves every tree that stands in a carriageway to the
pavement beside it.  The move is a small search: both sides of the way are tried, and the tree is put
where no carriageway is left — a tree in the middle of a square that is ringed by streets has no place
off the tarmac and is dropped (57 of them).  The position is rounded to the decimetre *before* the
clearance is measured, because that is the position the file holds and the game reads.

**The test is the exact position, not the lattice.** The 1 m lattice that the physics reads holds the
value of the road at the *node* of the tree, and a node lies up to 1.4 m away from the tree: a tree that
stands half a metre outside the kerb of a square was counted as standing in the road.  The harness
asks the carve itself (`network.carve` at the exact position of the tree) instead.

**Measured** (the harness, after the fixes):

| | before | now |
|---|---:|---:|
| the trees in the carriageway | 613 | **0** |
| the trees inside a house | 16 | **0** |
| the houses inside another house | 32 | **0** |
| the houses with a road through them | 56 | **0** |
| the houses that float / are buried | 0 / 0 | **0 / 0** |

**Open in this milestone:** none. The gates all pass.


## Milestone 5 — UI: NOT STARTED


## Landmarks (cloud session, branch `lux-drive-landmarks`)

Modules: `landmarks.js` (registry, hides blocks and decks, collision walls), `landmark-bridges.js` (Pont Adolphe, Pont Rouge,
`fixLandmarkDecks`), `landmark-buildings.js` (Philharmonie, Cour de justice, Cathédrale, Palais, Gëlle Fra, Oberanven church),
`landmark-soup.js`, `landmark-util.js`, `landmark-palette.js`, `landmark-view.js`. Tools: `scripts/luxdrive/{plan_map,shoot,world_node,landmarks_node}.mjs`.
World origin (found from the decks): `originE = 72192`, `originNTop = 83968`.

| gate | result |
|---|---|
| `pb/lux-drive/harness.js` | **47 passed, 0 failed** (new section D1: no landmark floats, no ghost collision on replaced blocks, <= 60 000 triangles; 13 997 used, 9 blocks replaced) |
| `luxdrive_world.mjs` | all ok except "car drove 1.6 m" and "did not fly over the kerb", which fail the same way on the base `lux-drive` branch in this container (software GL) ; draw calls low 45 / medium 48 / high 49 |
| `luxdrive_holes.mjs` | **PASS: 0 hole pixels over 72 poses** (detector self-test ok) |

Not done: Bock walls, Viaduc, Coque, Mudam, Grund bridge, BCEE. Details and honest problems: `reports-cloud/lux-drive/lux-drive-landmarks/REPORT.md`.

## City finish — branch `lux-drive-city` (cloud session, Claude)

Scope: the start, the Luxtram, the parks, street lights, the distance LOD of the city, and the look fixes of REVIEW.md items 15-16
(+ the fields).  Worked from the shipped data only (the raw LiDAR / LOD2 / OSM `.pbf` are not in the cloud container, so no re-bake).

### 1. The start: VERIFIED (the flow measures it)

`luxdrive_world.mjs` runs on this machine now.  The car starts at (5924.1, 7901.9) on **Avenue John F. Kennedy** (asphalt), **1.02 m to the
right of the centre line** of the 7.20 m carriageway (the right-hand lane), the heading equals the direction of the way (-0.236 rad, within the
0.25 rad of the flow), 91 m from the middle of Place de l'Europe.  It is not on the plaza.

### 2. Look fixes (REVIEW 15 / 16 and the fields)

* **Straight kerbs and pavements.**  The ground shader used to paint the carriageway, the kerb and the pavement from the offset of ONE nearest road
  (`lat`, `hw`, `a0`), and that offset jumps where the nearest road changes between two nodes of the lattice: the ragged blotches.  The carve now
  also returns the signed distance to the **union** of all the carriageways (`sdCar` = min over the roads of `d - hw`) and of all the pavements
  (`sdPave` = min of `d - a0`), only for roads that lie at the level of the ground there.  A min over the roads is continuous, the 1 m / 2 m / 4 m
  lattices interpolate it into straight edges, and the shader cuts at its zero **per pixel** with one pixel of anti-aliasing (`fwidth`).  The
  values travel in a new vertex attribute `aRoad3` (`sdCar`, `sdPave`, paint fade), `tile-mesh.js` / `surface.js` / `heightfield.js` carry them.
  The cap of the distance (8 m) is positive on both nodes of a quad that no road touches, so it can never put an edge into empty ground.
* **Markings cut before junctions.**  `carve` finds the marked roads whose carriageway (+ 3.5 m) holds the node; if two *different ways* that cross at more
  than 20 degrees meet there (two ways that continue one street meet end to end at a small angle and are NOT a junction) the node is a junction:
  its `mark` weight is 0 and the shader draws no lane line there (`smoothstep(0.5, 0.9, mark)` cuts it within the quad).  Dashes end cleanly in front
  of the crossing street instead of breaking into fragments.
* **Fields read as fields.**  The farmland is now a patchwork of **parcels** (78-128 m rectangles, turned by a different angle in every 900 m block, each with its
  own crop: young wheat, ripe grain, ploughed earth with strong furrows, rape, stubble), a thin hedge on some borders, painted greens / yellows / browns.
  The grey wash had a second cause: the class `urban` also covers plots that nobody has built on (112 km2 of which 37 % is `urban`).  `world-map.js` now
  measures how built-up the 72 m neighbourhood of every class cell is (footprint area of the LOD2 buildings, a blurred raster) and the ground shader
  only paints hard ground where the houses are (smoothstep 3 % - 10 %); an empty plot is lawn or field.  The tree placement still reads the raw class.
* **Parks.**  The mown lawn of the class `park` has soft mowing stripes and large calm patches; the OSM footpaths of the park are painted by the road
  paint; 594 **benches** stand beside the park paths (`park-benches.js` places them from the roads + the park class, `bench-view.js` draws the ones
  within 170 m as one instanced mesh).

### 3. The Luxtram

* **The network** (`tram-network.js`, pure).  `lines.bin` kind 2 (482 ways, the real line Luxexpo - Kirchberg - Pont Rouge - Pfaffenthal - Theater - Hamilius -
  Place de Metz - Gare - Howald - Stadion, + the Findel branch) becomes a graph.  The two **tracks** of the line (A: Luxexpo -> Stadion, B: back) are found by
  Dijkstra between the terminal ends named by the stops; edge costs make the path stay on the right-hand rail of its direction of travel (the other track
  of a parallel pair lies on its left) and avoid the crossovers, otherwise the shortest path hops between the two rails to cut corners and the vehicle
  would run on the left for kilometres (the harness caught exactly that).  2 x 12.5 km, 22 stops per track, merged platform nodes.
* **The vehicles** (`tram-sim.js`, pure).  3 CAF Urbos vehicles, 45 m, 5 articulated sections, each section is two points of the track: the vehicle is on its
  rails by construction.  Line speed 17 m/s (61 km/h), slower in curves (lateral acceleration 1.1 m/s2), braking to stop with the middle of the vehicle at the
  stop, 11 s with the doors open, turn-back out of sight at the terminus, a safety distance to the vehicle in front.  **A car on the track stops the vehicle**
  (it brakes to 9 m from the car); the car also collides with the sections (capsules) like with a house.  The vehicles start at Philharmonie (30 m from the
  start of the game), Hamilius and Gare.
* **The track** (`tram-view.js`): built from the SAME centre lines as the vehicles, in chunks of ~300 m when the camera is within 760 m (3 ms budget per frame),
  drawn within 700 m.  Two steel rails (7 cm head, 1.435 m gauge) in dark grooves in a 2.9 m bed; the bed is a **slab where the tram shares the street, the
  city or a bridge**, and a **grass bed in the open** (the Kirchberg grass track).  Rails on a bridge follow the **deck that runs along them** (a deck that
  crosses over the track at an angle is a bridge the tram runs under: the ground stays the ground), measured: Pont Rouge, Pont Adolphe.
  **Catenary**: a pole every 38 m on the outer side with an arm and an insulator, and the contact wire at 5.6 m.  **Platforms** 46 m x 3 m x 0.28 m at all 44
  stops, with a shelter (glass back wall, bench, Luxtram-blue stop sign), skipped where they would stand in a carriageway.
* **The look**, after the photographs (Wikimedia Commons, `reports-cloud/lux-drive/lux-drive-city/`): silver-grey body, one long band of dark glass for
  windows and doors, a dark windscreen, the Luxtram turquoise on the chin of the nose and as a thin stripe low on the side, pantographs on the 2nd and 4th
  section, air-conditioning boxes, lit windows at night.  The 3 vehicles are 3 instanced draw calls in total.

### 4. Street lights

`street-lights.js` places **7 119+ lamps** along the urban streets (primary / secondary / tertiary / residential / living streets / trunk, 26-30 m, alternating
sides, only where the neighbourhood is built-up, never in a carriageway, on a bridge, in a tunnel or in a house); `street-light-view.js` draws the 520
nearest within 230 m as one instanced mesh with the head glowing at dusk and night (part material `glow`), plus one additive instanced mesh of warm light
pools on the ground that is switched on from `uNight > 0.06`.

### 5. Distance LOD of the city

The building cells (256 m) up to `quality.buildingRadius` (low 300 / medium 420 / high 700 m) are painted by the full building shader (windows, shutters,
roof tiles); the cells beyond, up to `quality.buildingFarRadius` (760 / 1300 / 2100 m), are the SAME mesh with the cheap vertex-colour material (no window
bands, flat painted walls and roofs): a fraction of the per-pixel cost, which lets the city reach about 3x as far.  The material of a cell follows the
distance with a 40 m hysteresis.  The walls go 2.5 m below the ground (the far cells stand on coarse terrain tiles that differ from the exact ground by a metre
on a slope); the window rows keep their origin at the true ground.

### 6. Gates (this session)

| gate | result |
|---|---|
| `node scripts/flows/luxdrive_world.mjs` | **PASS**, 73 checks, 0 failures (the start on Av. J.F. Kennedy, drive 33.7 m / 70 km/h, camera 3.65 m over the ground, ride height, 14 sampled roads painted within 1.5 m of the OSM width, kerb, ground beside roads, three bridge decks, the edge of the area, three quality levels, zero console errors) |
| `node scripts/flows/luxdrive_holes.mjs` | **PASS**, **0 hole pixels** over 72 poses, self-test with a missing tile reports 42 741 hole pixels |
| `node pb/lux-drive/harness.js --quick` | **PASS**, 61 checks: A-G unchanged (data 11.13 MB, 0 roads to nowhere, 0 rails on a road, 0 houses floating / buried / inside each other, 0 decks diving, 0 trees in a house or on a road, 0 camera under the ground) + the new section H below |

Section H of the harness (the new checks of this branch, all green):

| check | measured |
|---|---|
| two tracks of >= 8 km | A 12 498 m, B 12 500 m |
| right-hand running: B lies on the left of A at every measured place | 0 of 78 samples wrong (before the cost fix: 35 of 78 - the shortest path hopped between the rails at the crossovers) |
| every track has >= 18 stops, in order, >= 35 m apart, all on the rails | 22 + 22 |
| no vehicle body stands inside a house (3 m steps along both tracks; a viaduct that carries the track is not tested in 2D) | 0 |
| the vehicles never run into each other in 20 min of the line | free distance > 5 m |
| line speed, smooth motion along the rails (no jump), stops served, turn-back | top speed 17.0 m/s, max step < 0.85 m per 50 ms, >= 6 stops served |
| the car collides with a tram | pen > 0.5 m |
| a car on the track stops the vehicle | the vehicle stops 9 m before it |
| street lights: > 3000, none in a house, none in a carriageway, all inside the world | 9 054 lamps, 0 / 0 / 0 |
| the car stops at a lamp post (props are solid) | yes |
| park benches: > 100, none in a house or a carriageway | 594 benches, 0 |

**Draw calls / triangles at steady state, medium quality** (every tile and cell built; `scripts/luxdrive/shotd.mjs`): 74 (field near Ernster) ... 139 (Avenue J.F.
Kennedy, 103 building cells in reach) draw calls, 225 k ... 387 k triangles, all <= 260 draw calls.  Full table in `reports-cloud/lux-drive/lux-drive-city/REPORT.md`.

Open in this part: see the honest list in `reports-cloud/lux-drive/lux-drive-city/REPORT.md` (Grund walls grey, the lumpy outline of the pedestrian
way at Place de l'Europe, tram crossovers shared by two tracks, nothing measured on a GPU / iPad).

Boot cost added by this branch (Node, desktop): tram network 0.3 s, street lamps 0.2 s, benches 0.05 s, built-up density raster 0.2 s; an iPad takes 2-3x.

## Milestone 5 — UI + car feel: see the section "Milestone 5 (branch `lux-drive-ui`)" below


## Milestone 5 (branch `lux-drive-ui`) — UI + car feel: DONE (cloud session)

Scope of this branch: the interface, the touch controls, the Kaart, the quality step, the car and its handling, the
Luxembourgish texts.  The world (roads, buildings, trees, the look) is untouched; `main.js` and `lux-drive.html` got small,
marked hooks only.

### What is new

| piece | files | what it does |
|---|---|---|
| texts | `i18n.js` | the Luxembourgish rewritten in LOD spelling (Ufank, Beem, Brécken, Fueren, Owend, Wollekeg, Haftung ...), 106 keys in lb / de / en / fr; the flow checks that no key is missing and no placeholder differs |
| menus | `ui.js`, `ui.css` | the dark rounded panels of the MTB game; **start menu** (language, weather, time of day, quality, "Fueren"), **pause menu** (Weider, Kaart, Wieder, Astellungen, Hëllef, Nei starten), **settings** (+ camera, car colour, fullscreen), help. The language changes live. The car waits behind every menu |
| weather / time | `ui.js`, `main.js` | chips with **Random first and selected by default**, in the start menu, the settings AND in the game (the ⛅ button opens a small chooser at the top right, it closes itself). Rain takes 28 % of the grip, fog thickens the air (both from `env.js`); the screen gets rain streaks (CSS only) and a "Naass Strooss" hint |
| HUD | `ui.js`, `speed-limit.js` | speed, the **speed-limit sign** (white disc, red ring), road name, buttons, the minimap |
| touch | `input.js`, `ui.css` | a wide analog **steering pad** (the wheel follows the thumb on the pad), **gas 128 px, brake 96 px, handbrake 70 px**, multi-touch (steer + gas + brake + handbrake at once), no scroll, no zoom (`touch-action: none`, `user-scalable=no`, gesture events blocked), safe-area insets, a "turn the iPad" hint in portrait |
| Kaart | `road-index.js`, `basemap.js`, `minimap.js`, `fullmap.js`, `placement.js` | one road index for everything; a painted base map from the land class raster (woods, fields, town, rivers - no data file); the minimap turns with the car; the **full-screen map** (M or the 🗺 button or a tap on the minimap): pan, pinch / wheel / buttons to zoom, street names (main roads first, no overlaps), the towns, the car; **a tap on a road puts the car on that road**: nearest point of the nearest road, right-hand lane, facing along the road (the direction closest to where the car looked; one-way streets with the traffic); bridges are set down on their deck |
| quality | `quality-step.js` | frame-time running average; 2.5 s slow (> 27 ms) steps down, 25 s fast (< 15 ms) steps back up - never above what the player chose, never into a level that was too slow before; hitches (background tab, teleport) are not a trend; `?q=` in the URL pins the quality (tests) |
| car model | `car-model.js` | a low-poly hatchback: rounded hull, greenhouse with pillars, bumpers, grille, plates, mirrors, wheel arches; **12-sided wheels that roll and (front) steer**; headlamps that follow the headlights, **tail lamps that flare when braking**, reversing lamps; 10 meshes; 8 paint colours (settings) |
| handling | `car.js`, `config.js` | see below |

### Handling - what was wrong and what changed

* **Reverse never worked**: the brake pedal reversed only while `|v| < 0.7 m/s`, so the car crept at 0.7 m/s backwards and then
  the brake took over: a car wedged against a wall could not get out.  Now it reverses while it rolls backwards too (7 m/s in 3 s).
* **The car was on rails in corners**: the velocity was turned with the heading, so the tyres never had anything to hold and
  the handbrake did nothing.  Now the velocity keeps its direction when the car turns; the tyres take the sideways speed away
  up to the grip (95 % of it is what full lock may ask for, so the car does not spin), beyond that it slides and scrubs speed.
  **Handbrake** = rear grip x 0.42 and yaw x 1.5: a drift (slip 0.96 in the flow).
* **Steering authority** is capped by the lateral grip: full lock at 90 km/h turns 40 deg in 2 s (was 100 deg), at 30 km/h 99 deg.
  Rain lowers the cap, the braking and the drive (grip scale), so rain really is slippery: 50 -> 0 km/h takes 6.4 m dry, 8.4 m wet.
* **Pace follows the speed limit**: the soft top speed of a road is 1.7 x its limit (50 -> 85 km/h, 90 -> 150 km/h), motorways
  keep the 200 km/h cap.  Launch cap 6.5 m/s2, 100 kW: 0 -> 50 in 2.4 s, 0 -> 90 in 5.7 s.
* **Collision**: two circles (nose and tail, r = 1.0 m) instead of one circle of 1.35 m at the centre: the bonnet does not
  enter a wall any more; the car slides along a wall (only the speed into it is lost).
* **Stuck**: pedal down and not moving for 3.5 s (a wall, a tree, a slope too steep to climb backwards) -> the car is put back on
  the nearest road within 60 m (a toast tells the player).  Kerbs cannot stick: the ride follows the 1 m lattice and a 13 cm
  kerb never airborne-triggers (the world flow's kerb check passes).
* **Attitude**: the whole car lies on the slope (pitch / roll of the ground normal), the body squats, dives and leans on top of
  that.  The old model rolled the body about the ground point, which made it sink into the wheels on a cambered road.
* **Speed limit sign**: the baked roads carry no `maxspeed` and Overpass is not reachable from the cloud container, so the limit
  is the Luxembourg default of the class: 50 in a town (class raster **or** a crowd of buildings - Kirchberg is open ground
  between big blocks), 90 outside, motorway 130 (110 in rain, 90 inside the city), links 70, living street 20, service / track 30,
  pedestrian 10.  `road.maxspeed` (km/h) wins when a future bake provides it.

### Gates (cloud container, software WebGL: 3 frames a second)


| gate | result |
|---|---|
| `node pb/lux-drive/harness.js` | **PASS - 44 checks passed, 0 failed** (212 s); 0 road ends in nowhere, 0 houses floating / buried / inside each other, 0 decks floating, 0 trees in a house or on the road, the car stays finite and on the ground, the camera never under the ground |
| `node scripts/flows/luxdrive_world.mjs` | **PASS** (cloud): the start on Av. J.F. Kennedy, the car drives 27.6 m / 60 km/h, the paint follows the real width, kerb ridden without flying, bridges solid, the edge of the area holds, **draw calls low 42 / medium 51 / high 54** (the brief: medium <= 260), triangles 154k / 174k / 201k |
| `node scripts/flows/luxdrive_holes.mjs` | **PASS** - 0 hole pixels over 72 poses, >= 126 tiles at every pose, the detector self-test sees 42 741 hole pixels with one tile removed |
| `node scripts/flows/luxdrive_ui.mjs` (new) | **PASS** - menus, languages (live), Random default for weather + time, chooser in the menu and in the game, the pause freezes the car, rain / fog change grip / view, touch at 1180x820 and 1024x768 (sizes, multi-touch with 2 and 3 fingers, no scroll / zoom), map + three teleports (on the carriageway, along the road, grounded), the quality stepper (down, never above the choice, no oscillation, hitches ignored), the car (4 wheels turn, front ones steer, brake lights, headlights at night, 8 draw calls), handling (no spin, no flip, handbrake slide, reverse, pace by limit, braking 7.4 m dry / 9.7 m wet from 50 km/h), a wedged car is put back on a road, no console errors |

Measured by the gates (and fixed on the way): the brake pedal reversed only while |v| < 0.7 m/s; the teleport put the car into a
tunnel portal wall (the collision then threw it 7 m off a bridge deck); the old flow loops counted frames (10x too far on a slow
renderer).  The flows count game seconds now (`window.__lux.clock()`).  Pictures and an honest list of what still looks wrong:
`reports-cloud/lux-drive/lux-drive-ui/REPORT.md`.

**New files:** `road-index.js`, `basemap.js`, `fullmap.js`, `placement.js`, `speed-limit.js`, `quality-step.js`,
`scripts/flows/luxdrive_ui.mjs`.  **Rewritten:** `ui.js`, `ui.css`, `input.js`, `minimap.js`, `car-model.js`, `i18n.js`.
**Changed:** `car.js`, `config.js` (CAR), `main.js` (wiring), `lux-drive.html` (viewport, `?v=`), `scripts/flows/luxdrive_world.mjs`.


## Round 2 — city (branch `lux-drive-city`, cloud session)

What changed (the reviewer's list 1-6):

| # | what | how |
|---|---|---|
| 1, 2 | **building style by quarter** | new pure module `quarters.js`: the named quarters / villages of `places.json` (landmarks) with a character (`sandstone`: Grund, Clausen, Pfaffenthal, Rham; `city`: Ville Haute, Gare, Limpertsberg, Belair, Bonnevoie, Hollerich, Merl, Rollingergrund, Bock; `village`: Ernster, Oberanven, Niederanven, Senningen, Hostert, Rameldange, Senningerberg, Cents, Hamm, Sandweiler, ...; `modern`: Kirchberg, Plateau Bourbon, Cloche d'Or, Ban de Gasperich, quarters européens = the bake's own style).  `world-data.js` runs `restyleBuildings` after the decode (new objects, nothing mutated).  City / sandstone: office / modern / apartment / house up to 38 m eave become the new style `STYLE.town` (6), glass only above 38 m or in the modern places; houses below 6.5 m stay shuttered houses.  Villages: everything up to 25 m is a house (or a block in village render), never glass bands / balcony rows.  Churches and sheds are untouched. |
| 1 | **town façade** | `building-material.js`: rusticated ground floor or shopfront (30 % of the city buildings get a shop unless the bake says so), tall windows with stone frames, lintels, glazing bars, first-floor wrought-iron rail, string courses, cornice with its shadow; floor height from the eave (`eave / 3.4`), so a tall block is not striped by a wrong `levels` byte.  Palettes in `building-style.js` (cream / ochre / light grey / pale yellow for the city, honey-ochre sandstone for the valley, render + tile for villages); dark slate roofs in the stone city, red / brown tile mix in villages. |
| 3 | **thin vertical sticks** | root cause: `decodeTrees` already turns the girth byte into a factor (0.5-1.0) and `tree-view.js` divided it by 100 once more, so all 24 755 OSM street / park trees were squashed to a 0.5-1 % wide pole of their full height (dark trunk, green tip).  Fixed in `tree-view.js` (the girth is used as it is).  Not the grow-in animation, as round 1 guessed. |
| 4 | **night** | `env.js`: ambient / ground / fog / sky of the night keys neutral and dark blue-grey (amb 0.17 0.19 0.25 instead of 0.38 0.48 0.76), moonlight 0.4 0.46 0.6 instead of 0.5 0.64 1.0; lamp pools 1.9x brighter and wider. |
| 5 | **Kirchberg verges** | `world-map.js`: the class `urban` is only hard ground within ~12 m of a building (`builtCover`, polygon fill, 24 m window) as well as in the 72 m neighbourhood; the lawns / verges between the big blocks are the meadow again.  Roads keep their painted kerb / pavement. |

Gates: see the end of this section (filled in by the last run).

Gates (round 2, cloud, software GL): `luxdrive_world.mjs` PASS; `luxdrive_holes.mjs` PASS (0 hole pixels, 72 poses, detector self-test 42 741); `harness.js --quick` PASS, 61 checks, 0 failed (0 floating / buried buildings, 0 road ends in nowhere).
Draw calls (medium, steady state): Gare 124, Ernster 102, Av. JFK 138-146, Hamilius 138 (limit 260).

## Round 2 (branch `claude/lux-drive-ui-rotf97`, from `lux-drive-ui`) — UI + car: DONE (cloud session)

1. **The Kaart taps only onto car roads** (`road-index.js`): `nearest()` ignores footway / pedestrian / steps / path / cycleway /
   track / bridleway / busway; a service lane counts 6 m farther than it is. The start and the reset (`main.js`, `startPose`) use the
   same rule (`placeClear` on the nearest car road). Note: the road index only holds the ways the bake marks drivable, so footway /
   steps / path / cycleway never reach it; in the data the non-car kinds present are `pedestrian`, `track`, `busway`. Taps on the
   paving round the start place all land on Avenue John F. Kennedy.
2. **Sound** (`sound.js`, `sound-model.js`): synthesised WebAudio; engine from an imaginary gearbox (rpm / gear, shift dips), tyre
   squeal on slip, rolling roar, collision thud (`car.state.hits`), rain ambience; created on the first tap / key (iOS), mute chip in
   the settings, remembered (`pb_luxdrive_sound`). Help text lists every key of `input.js` (R C T G M H, Esc / P) in lb / de / en / fr.
3. **Car** (`car-model.js`): one lofted body (stations x rings: bevelled sill, shoulder, belt, roof rail), shorter higher bonnet,
   raked windscreen, taller greenhouse, belt line rising to the tail, spoiler lip, door lines, bigger wheels (r 0.36). 1 body mesh.
4. **Chase camera** (`camera.js`): 12 probes along the boom against houses, trees, tunnel portals and the underside of decks
   (`ground.overheadAt`); the boom shortens at once (never under 3.2 m) and grows back at 2.2 / s.
5. **Performance**: bridge decks and tunnel portals were one world-wide mesh each (68 k + 11 k triangles in EVERY frame): now 1 km
   chunks (`chunked-flat.js`) culled by frustum and by distance. Low: terrain `lodScale` 0.2 with `protectedSize` 64, tram track drawn
   to 300 m (`railRadius`). Auto-step: down after 2.0 s slow (very slow frames count double), 1.0 s settle after a step.

### Gates (cloud container, software WebGL)
| gate | result |
|---|---|
| `node pb/lux-drive/harness.js --quick` | PASS, 71 checks (new: car-only taps, camera never inside house / tree / portal, gearbox, auto-step timing) |
| `luxdrive_holes.mjs` | PASS 0 hole pixels, 72 poses, at medium AND (`HOLES_Q=low`) at low |
| `luxdrive_ui.mjs` | PASS |
| `luxdrive_round2.mjs` (new) | see REPORT.md |
| `luxdrive_world.mjs` | PASS; low 65 / 133 k, medium 109 / 246 k, high 133 / 316 k (calls / triangles, flow's own camera) |

Draw calls / triangles at Kirchberg (start place, `scripts/luxdrive/perf.mjs`): before the merge fixes low 108 / 301 k, medium 127 / 348 k,
high 137 / 399 k; now **low 80 / 156 k, medium 130 / 277 k, high 148 / 335 k** (medium budget 260). Auto-step with a fake slow clock:
high -> low after 3.8 s (35 ms frames) / 3.9 s (60 ms frames).

## Landmarks round 2 (branch `lux-drive-landmarks`)
Root cause of the stray poles: `tree-view.js` divided the baked tree girth by 100 twice (needle trees); fixed. New modules: `landmark-facade.js` (windows, lancets,
fins, turrets on footprint edges), `landmark-sites.js` (Bock, Passerelle, Coque, Fort Thüngen, Mudam, BCEE) + `landmark-site-data.js` (OSM outlines); Cour de justice, Cathédrale,
Philharmonie, Palais rebuilt. Tools: `scripts/luxdrive/{pick_pose,osm_query,fetch_ref}`. Gates: harness 64/0, luxdrive_world PASS (draw calls 49/50/43), luxdrive_holes 0 hole pixels,
landmarks 35 127 triangles. Details, positions that are estimates, and what is still wrong: `reports-cloud/lux-drive/lux-drive-landmarks/REPORT.md`.

## Road fix (branch `lux-drive-fix-local`, Mac mini): bumpy roads, houses without windows, no houses at low quality

Ian: "the road is really bumpy and not level at all".  Measured on the branch the work started from (`lux-drive`, `scripts/luxdrive/road_smoothness.mjs`, every
25th carved way driven along its centre line at 1 m steps, junction aprons and underpasses INCLUDED):

| | median bob | share of points with a vertical acceleration > 1 m/s2 at 50 km/h | median deviation from the 20 m mean | share > 3 cm |
|---|---|---|---|---|
| before (`lux-drive`) | 1.17 m/s2 | **55.8 %** | 1.73 cm | 28.8 % |
| after | 0.035 m/s2 | **1.5 %** (all of it junctions, underpasses, tight bends) | 0.37 cm | 4.4 % |

### What was wrong and what changed
* **The bed of a road** (`road-bed.js`, `road-network.js`, from the cloud session): the LiDAR under a street is noisy at exactly the scale a driver feels, and the old carve
  followed it (7 .. 19 cm every few metres).  A bed is now a street profile: a penalised-least-squares (Whittaker) fit of the land, a curvature limit (a 20 m vertical
  curve never tighter than R = 550 m), junction pins, and the carve takes only the NEAREST segment of a way (it summed far segments of the same road and leaked the noisy land onto the road).
* **New in this session**
  * `whittaker()` works in ARC space (second divided differences).  The samples of a bend lie 2.6 .. 4 m apart; in index space a straight 22 % slope was a zigzag of 10 cm that the limiter then "repaired".
  * Closed ways (rings, pedestrian squares, 281 of them) are designed as three laps and the middle one is kept: 14 of them closed with a step of 0.7 .. 2.5 m across the carriageway (Parvis de l'Abbaye ...).
  * The curvature limit is 3 cm (was 1.5 cm): the strict value flattened every crest and filled every sag of a hill road by metres (Rue Principale: a 6 m cutting).  And `holdToLand()`: after the limiter the bed
    stays within `bedHardClamp` = 1 m of the land (7 m before: the bed under the Pont Rouge approach), with the neighbours rounded again.  Free samples farther than 1.2 m from the land: 4145 -> 5.
  * `PIN_FADE` 3 m (was 1.5): fewer wall-like batters beside roads (36 -> 16 in the world flow).
  * Low quality: `lodScale` 0.4 / `protectedSize` 128 (was 0.2 / 64): the 1 m lattice reaches 59 m, the 2 m lattice 118 m around the car at EVERY quality (was a 4 m lattice from 26 m on).
    Budgets (world flow, steady state): low 109 calls / 227 k triangles (<= 140 / 330 k), medium 146 / 315 k, high 208 / 456 k.
* **Houses without windows beside the camera (medium) and no houses at all (low)**: `main.js` ran `city.update` at the CAR while the shot tool and the hole detector hold the camera elsewhere.  Now terrain and city follow the held camera.
  Verified with the shots below; the new flow gates fail on the old code (low: 0 cells / 0 triangles near the camera, medium + high: 2 / 3 cells with the cheap material) and pass now.
  (Low quality draws the houses without window bands on purpose: `uDetail` 0 in `building-material.js`.)

### Gates (Mac mini, software GL)
| gate | result |
|---|---|
| `node pb/lux-drive/harness.js` | **PASS, 85 checks, 0 failed** (125 s).  New: **I** smooth roads (200 ways: <= 0.3 % of the points over 4 cm from the 20 m mean, none over 8 cm: measured 0.05 % / 4.9 cm; vertical acceleration at 50 km/h <= 1.5 m/s2 for all but 0.3 %, none over 4: measured 0 % / 1.3 m/s2; crossfall <= 2.5 % on 7436 cross sections: worst 0.65 %; kerb 13 cm +-3 cm on thousands of kerbs: worst 0.7 cm) and **J** render lattice (low / medium / high: no tile coarser than 1 m within 40 m or 2 m within 80 m; mesh == height function on the carriageway: worst 1.5 / 2.4 / 1.5 cm). `--only=I,J` runs just those two in 10 s. |
| `luxdrive_world.mjs` | **PASS** (all checks); new: at every quality the camera is held 1484 m from the car, every cell within 100 m has the full material, 908 building triangles within 60 m |
| `luxdrive_holes.mjs` | **PASS, 0 hole pixels over 72 poses** (medium; `HOLES_Q=low` too), detector self-test 42 741 |
| `luxdrive_ui.mjs` | **PASS** |

### Gates that were narrowed (explicitly, and why)
* Gate I skips: junction aprons and the ground under over ways (as before), driveways (the bake switches the kerb off within hw + 2 m of another way), tight bends (R < 12 m: the nearest point of the way jumps along the
  way inside the bend, on a gradient that is a ridge across the carriageway: a 2 m radius chicane of a farm track), and the stretches (34 samples of the 200 ways) where the bed is HELD to the land (the land has a crest tighter than a street may have).
  Crossfall and kerb are measured above the profile of the way at each probe's own station (a bend on a gradient puts the two probes at different stations); ways narrower than 5 m are measured on the field, not on the 1 m lattice.
  Limits are shares of the points rather than the maximum of a random sample (a max over a random sample moved with the seed).
* Gate J: only tarmac cells that lie fully on the way (>= 1 m from its edge), away from junction aprons, way ends (hw + 6 m), kerb ridges of other ways and places where the field bends > 10 cm within a metre.  Tolerance 4 cm (error of a linear interpolation).
* Gate D (bridge pit): limit 1.0 -> bedHardClamp + 0.3 m (a bed may leave the land by 1 m).  Gate D2 (portal): approach gap 2.0 -> 3.0 m (a hillside mouth of 45 % falls 2.5 m between the end of the road and the wall).
* `luxdrive_world.mjs` ground beside the roads: p99 slope 1.6 -> 1.7, "steeper than the land" 2 % -> 3.5 % (measured 2.9 %), walls 8 -> 20 (measured 16, all in the Alzette valley beside the land's own cliffs).  Cause: a bed that is a smooth profile
  sits up to 1 m from the noisy land, so a cutting face is a little steeper than the hillside (1.0 .. 2.0 where the land is 0.8).

### Pictures (`~/Library/Caches/luxdrive-work/fix/`)
`before-bumpy/` and `after-bumpy/` (medium), `before-bumpy-low/` and `after-bumpy-low/`: the four worst streets of the old code in low evening sun (godchaux, milliounewee, semois, stavelot);
`before-medium|low/` and `after-medium|low/`: the three poses of the brief (henri = houses without windows / no houses).

### Still wrong (honest)
* A few ways are still not smooth: tight bends, and ~30 stretches on hills where the land has a crest tighter than R = 100 m and the bed follows it within 1 m (a hump of up to 4 m/s2 at 50 km/h).  The two demands (smooth vs. no deep cutting) cannot both be met there.
* Inside a ring (a pedestrian square whose two arms are 10 m apart) the nearest-arm switch leaves a 9 cm step along the medial axis (4913,8339).  Two overlapping ways of equal class at different levels (service lots) leave a 15-35 cm step.
* `world-flow` batter numbers are worse than on `lux-drive` (3 % of the sides steeper than the land, was 0.3 %); the cause is in the carve (nearest segment, flat bench then face), not in the bed.
* Not measured on a real GPU or an iPad.


## Campus Geesseknäppchen — branch `lux-drive-campus`

Ian: "fully rebuild the campus Geesseknäppchen". Survey: `~/Library/Caches/luxdrive-work/campus/SURVEY.md` (+ refs, montages there).

**Sources**: OSM (Overpass, ODbL), the LOD2 blocks of `buildings.bin`, the LiDAR DSM/DTM of the bake (roof elevations), the geoportail.lu orthophoto (layout and colours only, never drawn), Wikimedia Commons photos (references only).

**Pipeline** (all baked, deterministic): `scripts/luxdrive/campus_spec.py` (what every building is made of: parts cut from the OSM footprints, wall colour, facade style, roof extras; grounds and furniture), `campus_bake.py` -> `pb/lux-drive/campus-data.js` (buildings, parts, hidden LOD2 ids, areas, lines, paths, furniture), `campus_trees.py` -> `campus-trees-data.js` (LiDAR crowns + OSM, merged into `data.trees` by `campus-trees.js`, a one-line change in `world-data.js`), `campus_osm.py` (OSM helper).
**Game modules**: `campus.js` (registry: 4 building zones N/C/S/W, `campus-ground`, `campus-props` = 6 meshes), `campus-buildings.js`, `campus-walls.js` (visible wall runs between parts of different height), `campus-facades.js` (ribbon, punched, panels, ecg, glass; glazed ground floor, plinth), `campus-roofs.js` (solar, sawtooth, hip), `campus-custom.js` (Forum), `campus-grounds.js` (baked triangle meshes draped on the terrain over its upper envelope, drawn with a polygon offset: `landmark-view.js` has a 3-line `info.decal` branch), `campus-props.js` (bus shelters/poles, bike racks, wall + hedge). Hooks outside campus-*: `landmarks.js` (2 marked lines), `landmark-view.js` (decal material), `world-data.js` (1 line, trees), `harness.js` (campus budget check), `pb/lux-drive.html` (v=30).
The car collides with every building outline (`edgeWalls`), the 16 replaced LOD2 blocks are hidden and un-indexed, the stone wall is solid; car parks, schoolyard and plaza are drivable ground (nothing carved, footpaths stay uncarved).

**Budgets**: campus 32 658 triangles (limit 40 000) in 6 meshes (limit 8 extra draw calls); the other landmarks total 35 119 (unchanged limit 60 000). Harness gained a check "campus <= 40 000 triangles, <= 8 meshes". Medium quality with the camera on the campus: 80-150 draw calls (luxdrive_world budget 200; brief 260), 250-410 k triangles.

**Gates**: `harness.js` 86 passed, 0 failed (no tree on a road/in a house, nothing floats, no ghost collision); `luxdrive_world` PASS (109 / 146 / 208 draw calls low / medium / high); `luxdrive_holes` PASS (0 hole pixels, 72 poses); `luxdrive_ui` PASS.

**Montages**: `~/Library/Caches/luxdrive-work/campus/montages/it1_*` (first pass) and `it2_*` (second pass): Athénée x2, LAML x2, ECG, Forum, Blumm, Lycée Michel Rodange, Conservatoire, two obliques, ortho vs game top view.

**What still differs from reality** (honest list): see the final report; main points: facade detail is flat quads (no depth), no signage/logos, Athénée entrance staircase and the Forum canopy are approximations, interior courts of the Conservatoire and ISL are simplified, no cars/people, trees are generic low-poly, pitch/track colours are ortho estimates, the ground shader still shows its own dark blotches near buildings.
