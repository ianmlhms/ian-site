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

**Shipped data — 10 364 754 B = 9.88 MB of the 30 MB budget (33 %).**

| file | bytes | what |
|---|---:|---|
| terrain.bin | 6 738 985 | MBG1 grid, 4 m nodes (4225 × 3713), 0.1 m quantisation, de-spiked LiDAR DTM |
| far.bin | 499 770 | MBG1 grid, 32 m nodes, box + 8 km, the distant hills |
| canopy.bin | 376 178 | MBG1 grids, 16 m nodes: the tree height and the tree cover |
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

## Milestone 2 — drive: IN PROGRESS

The MTB engine is copied into `pb/lux-drive/` and adapted: the world constants (16.9 × 14.8 km,
4 m near grid), the way network (roads instead of trails), the bridge decks, the car physics and
the chase camera.

## Milestone 3 — city: NOT STARTED

## Milestone 4 — gates: NOT STARTED

## Milestone 5 — UI: NOT STARTED
