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
