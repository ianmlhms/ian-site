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

**Shipped data — 11 389 488 B = 10.86 MB of the 30 MB budget (36 %).**

| file | bytes | what |
|---|---:|---|
| terrain.bin | 6 738 985 | MBG1 grid, 4 m nodes (4225 × 3713), 0.1 m quantisation, de-spiked LiDAR DTM |
| far.bin | 499 770 | MBG1 grid, 32 m nodes, box + 8 km, the distant hills |
| canopy.bin | 1 400 912 | MBG1 grids, 16 m nodes: the tree height and the tree cover |
| roads.bin | 862 486 | 19 314 OSM ways: real widths, lanes, one-way, bridge / tunnel / layer |
| classes.bin | 881 975 | the land classes on an 8 m grid (RLE): grass, forest, water, park, urban, farmland, sand, scrub |
| buildings.bin | 849 945 | 25 336 LOD2 buildings: footprint, eaves, ridge, roof |
| lines.bin | 33 790 | the tram and the railway |
| stops.bin | 24 897 | 2 263 tram / train / bus stops |
| decks.bin | 37 330 | 361 bridge decks with their real height from the LiDAR DSM |
| names.json | 21 772 | the 1 079 road names (Luxembourgish first) |
| stopnames.json | 16 581 | the stop names |
| places.json | 20 098 | the start point (Place de l'Europe, Kirchberg) and the landmarks |
| terrain.json, classes.json, decks.json | 945 | the checksums and the grid metadata |

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

**Measured by the flow `luxdrive-world`** (`scripts/flows/luxdrive_world.mjs`, the first of the
Milestone 4 harnesses — it is already a gate):

| what | result |
|---|---|
| the baked data | 10.88 MB (≤ 30 MB) |
| the start | Place de l'Europe, Kirchberg (5906, 7999), the car stands on the ground |
| driving | 30.8 m, 51 km/h, on the tarmac |
| the camera | never below the ground (3.82 m above it) |
| the ride height | 0.42 m above the ground for the whole drive, never sunk, never floated, never left the wheels |
| the kerb | the car rides over the edge of the carriageway (17.1 m from the centre line) without sinking or flying |
| the bridges | Nei Bréck (Pont Adolphe) 3.1 m above the valley, Roud Bréck (Pont Rouge) 14.2 m, the A1 at Grünewald 2.9 m: solid decks, the car stands on them |
| the edge of the area | the car drove up to the border and was pushed back: it never left the play area |
| draw calls / triangles | low 67 / 230 k, medium 74 / 248 k, high 93 / 296 k |

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

## Milestone 3 — city: NOT STARTED
## Milestone 4 — gates: NOT STARTED

## Milestone 5 — UI: NOT STARTED
