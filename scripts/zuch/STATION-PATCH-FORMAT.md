# Station patch data (real surroundings of a railway station)

One JSON file per station: `pb/train-sim/data/stations/<key>.json` (key = ascii lowercase station name, e.g. `munsbach`).
Written by `scripts/zuch/build_station_patch.py`, read by `pb/train-sim/station-surround.js`.
Everything is in the **station frame**, metres, already *straightened*: the real main track is mapped to a straight line.

## Frame
* The real **main track** of the station = the track next to the platform that carries the station building (the game's "player track").
  Its centre line (OSM `railway=rail`, service main) is resampled and every real point is converted to curvilinear coordinates:
  `u` = arc length along that track in the **direction of travel** (Luxembourg -> east/Germany = increasing km), `v` = signed distance to its right
  (right of the travel direction; for travel heading H in (east, north), right = H rotated by -90 deg).
* Station frame: `x = v` (lateral, + = right of travel), `z = -(u - u0)` (the train drives towards **-z**), origin `u0` = middle of the platform(s) along
  the main track.  So a point 50 m ahead of the platform middle and 12 m left of the track is `x = -12, z = -50`.
* Heights: `y` in metres relative to the **formation level of the main track in the station** (= median DTM height on the track corridor within
  +-60 m of the origin).  The game puts the formation 0.55 m below the rail head, so rail head = +0.55 here.
* Patch extent: `x` in [-160, 160], `z` in [-320, 320] (clip everything to it).

## File
```
{
  "v": 1, "key": "munsbach", "name": "Munsbach",
  "origin": { "lat": ..., "lon": ..., "headingDeg": <compass heading of travel at the origin>, "epsg2169": [E, N] },
  "side": "left" | "right",            // side of the travel direction on which the main station building / platform lies
  "extent": { "x": [-160, 160], "z": [-320, 320] },
  "dem": { "res": 2, "nx": 161, "nz": 321, "x0": -160, "z0": -320, "dm": "<base64 of little-endian int16, row-major z then x, units 0.1 m>" },
  "classes": { "res": 1, "nx": 320, "nz": 640, "x0": -160, "z0": -320, "png": "<base64 PNG, 8-bit grayscale (mode L), pixel value = class * 16>" },
  "roads":  [ { "cls": "primary|secondary|tertiary|residential|service|track|path|footway|cycleway|steps", "w": <carriageway width m>, "oneway": 0|1,
                "name": "...", "bridge": 0|1, "pts": [[x, z, y], ...] } ],
  "rails":  [ { "pts": [[x, z, y], ...], "kind": "main|siding|yard", "main": 0|1 } ],      // all other railway lines in the patch (the straightened main track itself is not listed)
  "platforms": [ { "ring": [[x, z], ...] } ],                                                // OSM railway=platform polygons / lines buffered
  "water":  [ { "ring": [[x, z], ...], "y": <water surface y>, "kind": "river|pond" } ],     // polygons; rivers as buffered centre lines
  "buildings": [ { "id": "...", "kind": "house|apartments|commercial|industrial|retail|garage|shed|church|other", "levels": <int>, "station": 0|1,
                   "roof": "gable|hip|flat|other", "h": <eave-to-ground height m>, "base": <ground y>,
                   "ground": [[x, z], ...],                                                  // footprint ring
                   "roofs": [ [[x, y, z], ...], ... ],                                        // LOD2 roof faces (planar rings, absolute y in this frame)
                   "walls": [ [[x, y, z], ...], ... ] } ],                                    // LOD2 wall faces
  "trees": [ [x, z, height, crownRadius], ... ],                                              // from the LiDAR canopy (DSM - DTM), outside buildings; <= 1500
  "poi": [ { "t": "tree|bench|bus_stop|lamp|bin|parking|bike_parking|shelter|ticket", "x": .., "z": .., "y": .. } ]
}
```
Coordinates in the arrays are plain JSON numbers rounded to 0.01 m (`[x, z, y]` / `[x, y, z]` order exactly as written above).

## Classes (class PNG: 8-bit GRAYSCALE, no palette / gamma / ICC chunks, pixel value = class * 16 (0,16,...,128) because the browser reads it through a canvas; 1 m / px, row = z, column = x)
0 asphalt (carriageways, parking, yards)  1 paving (sidewalks, plazas, platforms, cycle ways)  2 lawn / garden  3 meadow / field / farmland
4 forest floor / hedges / dense canopy  5 gravel / ballast / bare soil / dirt tracks  6 water  7 building footprint  8 rail bed (ballast of the
tracks, incl. main track corridor +-4.5 m)  9 reserved.
The classification uses OSM landuse / natural / highway / railway / building + the LiDAR canopy (nDSM) to separate lawn / meadow / forest; **no
orthophoto pixel may be shipped or used for colours**.

## Quality bar
* The straightening must be smooth: no kinks, and the station building / platform of the real station must end up at the right place and on the
  declared `side`.
* The DEM is the LiDAR DTM (CC0, data.public.lu COG, see scripts/fetch_luxtram_geo.py for the URLs and the range-read approach) resampled to 2 m;
  fill gaps; heights relative to the formation level as above; the main track corridor (+-5 m) should be flat (bake the median).
* Buildings: LOD2.2 CityGML 2023 from data.public.lu (see scripts/luxtram_lod2.py); keep only those whose footprint touches the patch; mark the
  station's own building(s) (OSM building near the platform with railway/public_transport tags or inside the station area) with `station: 1`.

## Index
`pb/train-sim/data/stations/index.json` = `{"v":1,"stations":{"Munsbach":"munsbach"}}` (display name -> file key).  `build_station_patch.py` merges its station into
it on every run (never overwrites other entries).

## Details of the implementation (build_station_patch.py)
* **Rings are implicitly closed**: the first vertex is NOT repeated at the end (building ground / roof / wall faces, platforms, water).  Faces are planar LOD2 polygons
  (roofs/walls are taken from the national LOD2.2 model; the vertices are transformed one by one with the same straightening).
* **Vertical straightening**: the real track gradient is removed from *all* heights (`y = z_abs - y0 - profile(z)`), so the straightened main track is level at y = 0
  (corridor |x| <= 5 m is baked flat, blended out to |x| = 9 m).  The removed profile is stored as `"trackY": [[z, y], ...]` (20 m steps, rail-level relative to y0) so the
  game may add the grade back.  `--keep-grade` keeps the gradient in the heights instead.  At Munsbach the profile is within +-0.2 m.
* LOD2 building heights are shifted by the median (LOD2 ground - DTM) offset when it exceeds 0.25 m, so the buildings sit on the DTM (Munsbach: 0.52 m).
* Buildings without a LOD2 model (sheds, new buildings) are emitted from the OSM footprint with `roofs: []` and `walls: []` (renderer extrudes `h`).  `h` = eave height
  above `base` (LOD2: lowest roof vertex minus lowest ground vertex).  `building=roof` (platform canopies) are not buildings; they become `shelter` POIs.
* Water `y` is the DTM level at the river / pond (25th percentile of the outline heights); long rivers are cut into 60 m pieces so the surface follows the gradient.
* `trees` come only from the LiDAR canopy; OSM `natural=tree` nodes are added as `poi` `tree` only where no canopy tree is within 3 m.
* The straightening is a pure projection onto the smoothed track (Gaussian sigma 8 m on the OSM way chain, ends extended straight).  Inside a curve of radius R
  features at lateral distance d are compressed along z by the factor 1 - d/R (outside: stretched); the script logs the tightest radius.

## Germany (`--country de`, Wave 2b)
`build_station_patch.py <key> --country de` builds a patch for a station in Rheinland-Pfalz with the same frame and format; only the sources change:
* CRS EPSG:25832 (UTM 32N); `origin` carries `epsg25832: [E, N]` instead of `epsg2169`.
* OSM from `rlp.osm.pbf` (Geofabrik Rheinland-Pfalz; same layers / tags).
* Relief: GeoBasis-RLP open data **DGM1** (1 m GeoTIFF, 1 km tiles) as DTM and **DOM1** as DSM (canopy = DOM1 - DGM1), from `https://geobasis-rlp.de/data/{dgm1,dom1}/current/tif/`
  (tiles cached in `~/Library/Caches/zuch-work/de/`, downloaded with the system curl because python's urllib does not trust the server chain).
* Buildings: GeoBasis-RLP **LoD2** CityGML 1.0 (`geb3dlo/current/gml/`, 2 km tiles, axis order E, N, z); `storeysAboveGround` and the ALKIS building function fill `levels` / `kind`
  where OSM has no tag.  Buildings without LoD2 face (new buildings) are emitted from the OSM footprint as in Luxembourg.
* The patch gets a top level `"credit"` string (data licence dl-de/by-2-0); `station-surround.js` appends the credits of all patches on the route to its credit line.
* `scripts/zuch/build_de_patches.py` runs all stops of the RB 83 (and Kreuz Konz / Trier Sued / Trier Hbf as stage 2).
* `--country de` extras: `"deckZ": [[z0, z1], ...]` (optional) = z ranges where the main track is on a bridge or in a tunnel (OSM `bridge=*` / `tunnel=*` on the chain): the
  track profile is interpolated across them and the +-5 m corridor is NOT flattened there (the valley stays open under the game's bridge); `"extrudeFaceless": true` tells the
  renderer to extrude buildings with `roofs: []` / `walls: []` from ground ring + `h` + `roof` (gable / hip on rectangular footprints, else flat).  `--max-kb` (default 700 for de)
  strips the LOD2 faces of the farthest buildings so the json stays small.  `--side left|right` picks the (platform, main track) pair on the side declared in real-mosel.js.
