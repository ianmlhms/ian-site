# Real lines in the Zuchsimulator: decision and stop lists

Status: written in Wave 1 of the "zuchreal" work (25 Oct 2026).  Wave 2 implements the curve derivation below for the Mosel line first, then the other lines.


## Wave 2: what is implemented (26 Oct 2026)

**Decision (Ian, 25 Oct):** `wittlich` follows today's real RB 83 = the Trier Weststrecke on the left bank (no Trier Hbf); `trier` (RE, via Trier Hbf) keeps its own routing.
Verified stop list of the RB 83 since 3 Mar 2025 (SPNV-Nord press release 11/2024, "Reaktivierungsprojekt Weststrecke Trier"): Luxemburg, **Cents-Hamm**, Sandweiler-Contern, Oetrange,
Munsbach, Roodt/Syre, Betzdorf, Wecker, Manternach, Mertert, Wasserbillig, Igel, Trier-Zewen, Trier-Euren, Trier West, Trier-Pallien, Trier Hafenstraße, **Ehrang Ort, Quint**, Schweich, Föhren, Hetzerath,
Sehlem, Salmtal, Wittlich.  (The Wave 1 note "Cents-Hamm is not a stop" and "no Ehrang" were wrong for the RB 83; Pfalzel is only served by RB 71 / RE.)  RB 84 (Hafenstraße - Zewen - Kreuz Konz - Konz) and
RE 11 cross the Konzer Moselbrücke to Kreuz Konz.

**Geometry (scripts/zuch/build_real_line.py, real_line_path.py, real_line_fit.py, real_line_dem.py, real_line_land.py, real_line_scenery.py, osm_rail.py, fetch_corridor.py):**
`fetch_corridor.py` caches the OSM features of five corridor tiles (Geofabrik Luxembourg + Rheinland-Pfalz extracts, `~/Library/Caches/zuch-work/realline/corridor-*.pkl`); `build_real_line.py emit` then
1. builds the main-track graph (railway=rail, no yard / siding / spur; near-miss switches snapped at 2.6 m) and a Dijkstra chain per segment: A (Lux - Igel), W (Igel - Zewen - Euren - West - Pallien - Ehrang Ort),
   H (Igel - Kreuz Konz - Süd - Hbf - Pfalzel - Ehrang Ort), tail B (Hafenstraße - Wittlich); dead-end spurs the shortest path takes at switches are cut out;
2. the branches split at J1 (about 1.8 km behind Igel, where the Konz bridge line leaves) and are cut 260 m before the Hafenstraße block (J2); the tail geometry of the Weststrecke is used for both services;
3. fits every leg (real stretch between two station blocks of 290 m) with straights / arcs (piecewise-linear heading by dynamic programming), keeps the real radius (capped at the radius the line speed needs, floor 380 m) and compresses
   the LENGTH (game length = 0.27 x real, clamped 480 - 1750 m; arcs compressed at most 2.2x), so a 15 degree real bend becomes a shorter bend of the same radius;
4. takes grades from the Copernicus 30 m surface model (smoothed, 0.25 % steps, +-1 % authored = x2.4 in the sim), maxspeed from the OSM tags, bridges / tunnels from the way tags (kind and height from the DEM and the nearest river),
   level crossings from railway=level_crossing, biomes from the landuse around the line (city / suburb / industrial / vineyard / forest / farmland);
5. emits `pb/train-sim/real-mosel.js` (layout, loaded before routes.js) and `data/real/mosel-features.json` (scenery per leg in game coordinates: land-class raster 20 x 15 m up to +-330 m, river windows, roads, relief,
   villages, level crossing hints).  The two branches get the same game length (shorter one is stretched), so the tail has the same s on both services.
`routes.js` builds `moselBodyWest` (A + W + B) and `moselBodyHbf` (A + H + B + the authored Cochem / Koblenz tail); leg items carry `legId`.  `track.js` takes relief (terrain height 220 m left / right of the line) and river
(side, offset, width) from the data; `real-line.js` resolves the data per track (also mirrored for the return direction); `real-scenery.js` fills every chunk (real roads as ribbons, houses along the real streets in
residential cells, fields / vineyards / meadows, forest trees, industry sheds); landscape.js skips its generic villages / farms / fields / woods / country roads / trees when `track.real` exists.
Re-run: `/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/zuch/fetch_corridor.py lux trier wittlich cochem gap koblenz` (once, ~10 min) then `.../python scripts/zuch/build_real_line.py emit` (~2 min).
Cochem / Koblenz stay authored (the real Wittlich - Cochem line is 28 km, Cochem - Koblenz 48 km).

## 1. How a line becomes "recognisably the real one"

The routes are authored layouts (`routes.js`, token language: straights, curves, grades, flags `T` tunnel / `B` bridge / `X` level crossing / `b` biome).  The legs are compressed
(real station spacing 2.5 - 6 km -> 0.8 - 1.7 km of play) so a service stays playable.  Decision: **keep the compressed lengths, but derive the sequence of features from the real
OSM railway geometry of that leg**:

1. Take the real centre line of the leg (OSM `railway=rail` between the two station nodes, main track), resample every 10 m, compute heading and curvature.
2. Segment it into straights and constant-curvature arcs (radius from the median curvature of the arc, direction L/R from the sign, turning angle preserved).
3. Compress along the leg by k = realLength / gameLength and scale every radius by 1/k, so a real 90 degree bend stays a 90 degree bend, only tighter; clamp to the radii the
   sim accepts (>= 250 m for rail, speed limit follows the curve).  Arcs shorter than about 150 m real are merged into the neighbouring straight.
4. Bridges / viaducts / tunnels come from OSM (`bridge=*`, `tunnel=*`, `man_made=bridge`, with the real kind: viaduct, steel truss over the Sauer, river bridge) and keep their real
   order and relative position; their length is compressed with the leg (min lengths per kind).
5. Rivers: side and distance from `waterway=river` / `natural=water` polygons relative to the line (left/right, near/far) -> the `river` biome windows and the water side; the
   Syre, Sauer, Mosel, Alzette, Sauer (Ettelbréck), Wiltz, Clerve get their real side.
6. Grades from the LiDAR DTM profile along the line (smoothed over 200 m) times the existing GRADE_SCALE; level crossings from OSM `railway=level_crossing` on the line (position
   in the leg, road class and direction -> the crossing road planner uses the real road character and side where known).
7. Biomes from OSM landuse along the leg (residential, industrial, farmland, forest, vineyard, water).
8. Villages passed where they really are (OSM `place=village|hamlet` within 600 m of the line -> a village chunk on the right side at the right position).

Tooling (Wave 2): `scripts/zuch/build_real_line.py <line>` writes the tokens for every leg plus a diff report; the result is pasted into `routes.js` as data.  The token
format stays as it is, so saves, careers and the track compiler are untouched.

## 2. One line, several services (the Mosel line)

The Mosel line is authored ONCE (`moselBody` in routes.js, `sceneryId: 'mosel'`).  Three services run on slices of it and are identical wherever they share track (curves,
stations, scenery, crossings, bridges):

| id | name | slice | stops |
|---|---|---|---|
| `east` | Lëtzebuerg - Wasserbëlleg | up to Wasserbëlleg | all 10 |
| `wittlich` | Lëtzebuerg - Tréier - Wittlich | up to Wittlich | all 21 |
| `trier` | Lëtzebuerg - Tréier - Koblenz | whole line | express: 12 of 23 (the others are passed at 110 km/h, `passNames`) |

Mechanics: `makeRoute` takes `passNames`; `track.js` raises the limit through passed stations to 110 km/h (`PASS_LIMIT`) and exposes `track.passFixed` (station indices);
`sim.planService` always passes those stations (pattern RE) and never adds random extra passes on such a route.  `sceneryId` seeds the ground noise, the landscape chunks and the
crossing-road planner, so a place looks the same on every service.  Route ids and the career / save format are unchanged (`wittlich` is a new route: 12 000 EUR, rail trains).

### Stop list used (verified, with sources)

Luxembourg side (OSM station nodes, CFL network, all on the line, coordinates from the Geofabrik Luxembourg extract of 25 Oct 2026):
Luxembourg (49.59997 N 6.13425 E) - Sandweiler-Contern (49.59909, 6.21175) - Oetrange (49.60273, 6.25802) - Munsbach (49.63055, 6.26852) - Roodt (Roodt-sur-Syre, 49.66651, 6.30311) -
Betzdorf (49.68888, 6.34868; game name "Betzder") - Wecker (49.70011, 6.38741) - Manternach (49.70645, 6.42330) - Mertert (49.70322, 6.47931) - Wasserbillig (49.71290, 6.49941).
Cents-Hamm (49.61501, 6.16598) also exists on the line, but the RB 83 timetable runs Luxembourg -> Sandweiler-Contern without it (SPNV-Nord Linienfahrplan RB 83: Luxembourg 7 min
to Sandweiler-Contern), so it is not a stop here.

German side: Igel - Kreuz Konz - Trier Süd - Trier Hbf (RE 11 pattern Trier Hbf, Trier Süd, Kreuz Konz, Igel, Wasserbillig, Sandweiler-Contern, Luxembourg, signal.eu.org timetable
26 Jan - 13 Jun 2026) - Trier-Ehrang - Schweich - Föhren - Hetzerath - Sehlem - Salmtal - Wittlich Hbf (Bahnstrecke Trier-Koblenz, de.wikipedia; stops with km: Wittlich 76.4,
Salmtal 86.1, Sehlem 88.5, Hetzerath 92.3, Föhren 95.6, Schweich 99.6, Quint 102.3, Ehrang 105.4, Trier Hbf 111.6) - Cochem - Koblenz Hbf (existing legs).
Quint (halt between Schweich and Ehrang) is not modelled.  RE 1 stops at Wittlich, Föhren, Schweich, Trier Hbf; this is the `trier` pattern on the German side.

**Open decision for the reviewer / Ian (Weststrecke):** since 3 March 2025 the RB 83 Wittlich - Luxembourg no longer runs via Trier Hbf but over the reactivated Weststrecke on
the left bank of the Mosel (stops Igel, Trier-Zewen, Trier-Euren, Trier-West, Trier-Pallien, Trier-Hafenstraße which replaces Ehrang, then north to Wittlich; sources: DB Regio
Südwest "Trierer Weststrecke", trier.de "Reaktivierung der Trierer Weststrecke").  Wave 1 follows the brief (stop list via Kreuz Konz / Trier Hbf / Ehrang, which is still what
the RE 11 / RE 1 serve and what the line looked like before 2025).  If Ian wants today's RB 83, only the stop list and the legs between Igel and Hafenstraße in `moselBody` change.

### Real stations of this line, state after Wave 1

Photo-modelled before: Sandweiler-Contern, Oetrange, Betzder, Manternach, Mertert, Wasserbëlleg (stations-lu-b.js), Tréier Hbf, Schweich, Wittlich, Cochem, Koblenz Hbf
(stations-abroad.js).  New in Wave 1: **Munsbach** (stations-lu-c.js, the template station with real surroundings, see ZUCHREAL-W1-NOTES.md).  Still generic: Roodt-Syr, Wecker,
Igel, Kreuz Konz, Tréier Süd, Ehrang, Föhren, Hetzerath, Sehlem, Salmtal.

### Real level crossings on line 30 (OSM `railway=level_crossing`, Geofabrik extract 25 Oct 2026) - for the Wave 2 real positions

The authored `X` flags are placeholders.  The real line has these (lat, lon; barrier type from the tags):
Sandweiler-Contern + 0.9 km (49.5929, 6.2520, double half barrier); Oetrange - Munsbach (49.6210, 6.2672, signals, barrier); **Munsbach station, Rue de Beyren, ~110-130 m ahead of the
platform middle** (49.6308, 6.2686, full barrier); before Roodt (49.6544, 6.2975, lights + bell); **Roodt station** (49.6657, 6.3029, double half); Roodt - Betzdorf (49.6774, 6.3145) and
(49.6797, 6.3191), lights + bell; **Betzdorf station** (49.6890, 6.3493, double half); (49.6932, 6.3642); **Wecker** (49.7004, 6.3904, full); **Manternach station** (49.7065, 6.4240, half) and
(49.7073, 6.4298, double half / full); Mertert area: several (49.6942-49.6961, 6.4657-6.4694, no barrier = tracks / paths) and (49.7026, 6.4774-6.4774, half / full).
In the Luxembourg city section there are none on the main line.  The crossing planner must take the real road class and direction from the OSM road through the node
(Wave 2: `plan.ctx.realCrossings` + the patch roads of a station with a patch: the road of the patch IS the crossing road there, no synthetic one).

## W2c: stop lists of the other routes (audit of 26 Oct 2026, with sources)

**Method.** Real service patterns come from the OSM public-transport route relations (`route=train`, ordered `stop` members) of the Geofabrik extracts of 25 / 26 Oct 2026 (Luxembourg, Belgium, Lorraine, Champagne-Ardenne,
Ile-de-France), read with pyosmium (`scripts/zuch/osm_route_relations.py`), cross-checked against de.wikipedia "Bahnstrecke Luxemburg-Troisvierges" (km, tunnels,
viaducts, "Nahverkehr ... zwischen Luxemburg und Troisvierges"), en.wikipedia "CFL Line 50 / 60", sncf-connect.com Luxembourg - Paris timetable (11 Jul 2026 sample).  Relations used: CFL-1 (all stops), RE Rodange - Troisvierges (OSM id 20663266),
CFL-50 (555543), L-12 (SNCB, 7396154), CFL-60 (8388183), RE Pétange - Mersch (20663109), CFL-70 (572347), K59, IC-16 (3920818), IC-33, TER C40+ (1061467), TGV InOui 803B (8536525 / 8536618).  The earlier route lists were authored, not verified.

| route | old stops | verified service | new stops (game names) | change |
|---|---|---|---|---|
| `west` (line 50) | Lëtzebuerg, **Bartreng**, Mamer, Capellen, Kleinbettingen | CFL-50: Luxembourg - Bertrange-Strassen - **Mamer Lycée** - Mamer - Capellen - Kleinbettingen - Arlon; SNCB L-12 the same up to Libramont (Kleinbettingen, Arlon, Viville, Stockem, Habay, Marbehan, Neufchâteau). Hollerich is NOT a stop of line 50 in OSM (it is on line 70). | Lëtzebuerg, Bertrange-Strassen, Mamer-Lycée, Mamer, Capellen, Kleinbettingen (6 stops, 17.9 km real, 6.4 km game) | name fixed, Mamer-Lycée added.  The service runs on to Arlon (3 km, Belgium); the game route ends at Kleinbettingen (terminus kept so saves / bests stay valid; Arlon is a stop of `brussels`). |
| `south` (line 60) | Lëtzebuerg, **Hollerich**, Berchem, Bettembuerg, Esch-Uelzecht, Belval-Université, Déifferdang, Péiteng, Rodange | CFL-60 (every stop): Luxembourg - Howald - Berchem - Bettembourg - Noertzange - Schifflange - Esch-sur-Alzette - Belval-Université - Belval Lycée - Belval-Rédange - Belvaux-Soleuvre - Oberkorn - Differdange - Niederkorn - Pétange - Lamadelaine - Rodange.  The OSM "RE" relations (Pétange - Mersch, Rodange - Troisvierges) skip Berchem / Howald / Belval-Lycée / Belval-Rédange / Belvaux / Oberkorn / Niederkorn on some patterns.  Hollerich is on line 70 (Luxembourg - Hollerich - Leudelange - Dippach-Reckange - Schouweiler - Bascharage-Sanem - Pétange - Lamadelaine - Rodange), not on line 60. | all 17 stops of the RB pattern (15.8 km game, 39.4 km real) | Hollerich removed (line 70, its model stays registered for a later route), Howald, Noertzange, Schifflange, Belval-Lycée, Belval-Rédange, Belvaux-Soleuvre, Oberkorn, Niederkorn, Lamadelaine added. |
| `north` (line 10) | Lëtzebuerg, Pafendall-Kierchbierg, Walfer, Lëntgen, Miersch, Ettelbréck, Kautebaach, Wëlwerwolz, Clierf | CFL-1 RB (every stop, OSM 912932 / 8387186): Luxembourg - Pfaffenthal-Kirchberg - Dommeldange - Walferdange - Heisdorf - Lorentzweiler - Lintgen - Mersch - Cruchten - Colmar-Berg - Schieren - Ettelbruck - Michelau - Goebelsmühle - Kautenbach - Wilwerwiltz - Drauffelt - Clervaux - Troisvierges.  The RE (Rodange - Troisvierges) calls at Luxembourg, Pfaffenthal-Kirchberg, Dommeldange, Walferdange, Mersch, Ettelbruck, Goebelsmühle, Kautenbach, Wilwerwiltz, Drauffelt, Clervaux, Troisvierges; the IC 33 (Liège) at Mersch, Ettelbruck, Michelau, Goebelsmühle, Kautenbach, Wilwerwiltz, Drauffelt, Clervaux, Troisvierges. | RB, all 18 stops up to Clervaux (60.5 km real, 20.5 km game) | Dommeldange, Heisdorf, Lorentzweiler, Cruchten, Colmar-Berg, Schieren, Michelau, Goebelsmühle, Drauffelt added; the route still ends at Clierf (Clervaux).  Real km of the line (Wikipedia: Luxembourg 16.65 ... Clervaux 77.17 = 60.5 km) agrees with the OSM path (60.55 km). |
| `paris` (TGV) | Lëtzebuerg, Metz-Ville, Champagne-Ardenne TGV, Paris-Est | TGV InOui 803B: Luxembourg - **Thionville** - Metz - (Champagne-Ardenne TGV) - Paris-Est.  The reviewer's note "Champagne-Ardenne TGV is not served" is wrong: the OSM relations 8536525 / 8536617 name it, and the sncf-connect timetable of 11 Jul 2026 lists Thionville, Metz, Meuse TGV and Champagne-Ardenne TGV on Luxembourg - Paris trains; some trains run Metz - Paris direct.  Meuse TGV is served by some. | Lëtzebuerg, Thionville, Metz-Ville, Champagne-Ardenne TGV, Paris-Est | Thionville added (every 803B stops there); Champagne-Ardenne TGV stays. |
| `metz` (TER) | Lëtzebuerg, Bettembuerg, Thionville, Metz-Ville, Pont-à-Mousson, Nancy-Ville | TER C40+ Nancy - Metz - Luxembourg (OSM 1061467): Nancy, Pont-à-Mousson, Pagny-sur-Moselle, Metz, Walygator Parc, Hagondange, Uckange, Thionville, Hettange-Grande, Bettembourg, Howald, Luxembourg (C50 / C50+ Luxembourg - Metz: Howald, Bettembourg, then the French stops). | see the abroad section below | |
| `brussels` (IC) | Lëtzebuerg, **Kleinbettingen**, Arlon, Libramont, Namur, Bruxelles-Midi | IC 16 (OSM 3920818 / 241358): Luxembourg - Arlon - Marbehan - Libramont - Rochefort-Jemelle - Marloie - Ciney - Namur - Gembloux - Ottignies - Bruxelles-Luxembourg - Schuman - Nord - Central - Midi.  Kleinbettingen is served by the CFL-50 / L-12 regional trains, not by the IC. | see the abroad section below | Kleinbettingen is not an IC stop. |

Not decided by data: names of the new stations are the Luxembourgish forms where the game already used them (Walfer, Lëntgen, Miersch, Ettelbréck, Kautebaach, Wëlwerwolz, Clierf, Esch-Uelzecht, Déifferdang, Péiteng) and the CFL spelling elsewhere (Dummeldeng, Heisdref, Kruchten,
Colmer-Bierg, Giewelmillen, Houwald, Schëffleng, Uewerkuer, Nidderkuer are common lb forms, not taken from an official list).

## W2c: real geometry and scenery for the single-line routes (north, south, west), pipeline changes

All of this is additive; nothing of the Mosel line (`build_real_line.py`, `real-mosel.js`, its data) was changed.

* **`scripts/zuch/build_real_route.py`** (+ `real_route_defs.py` = stop lists, `fetch_route_corridor.py` = OSM corridor cache): the single-line version of `build_real_line.py`.  It imports its fit / DEM / land /
  scenery code, joins the stops with Dijkstra on the rail graph (a stop is an OSM station / halt node, with a `(lat, lon)` hint for duplicates like the two Pétanges, or just the hint when the stop is only a
  `railway=stop` as in France), builds the legs exactly like the Mosel legs (same 0.27 compression, clamps, R_MIN, grades, speeds, crossing thinning) and emits `pb/train-sim/real-<id>.js`
  (`TS.realLines[id]`, loaded before routes.js) + `data/real/<id>-layout.json` + `data/real/<id>-features.json`.  Differences: a long high bridge over a river is a viaduct WITH water up to 45 m
  (Pfaffenthal 28 m, Pulvermuehle), the first station block and big stations get an urban halo (landuse=railway around the Gare is not "city"), forest / farmland beyond Ettelbruck is the
  `ardennes` biome, and every station carries its OSM layout: platform polygons (`plat`: edge lateral, width, s0 / s1 relative to the stop), other tracks (`trk`), side of the station building (`bside`),
  and its lat / lon / heading (for the station patch).  Platform side = the building's side when that platform is next to the track, else the nearest platform.
  Commands: `fetch_route_corridor.py` (once; `--extra` adds the platform polygons / station buildings to an existing tile), then `build_real_route.py plan|emit north|south|west`.  `plan` prints the path, the
  stops with platforms and the leg tokens; `--plot x.png` the heading QA sheet.  Re-run: ~5 s (west), 18 s (south), 33 s (north).
* **`real-line.js`**: the data set of a route is `def.sceneryId` when `TS.realLines[sceneryId]` exists (its `data/real/<id>-features.json`), `mosel` for the Mosel line; several can be cached.  `routes.js`: `realLineBody(id)`.
* **`stations-osm.js`**: every station of north / south / west without a photo model gets a model built from its OSM layout (other platforms with width / length, other tracks, a shelter, the far fence);
  `station-surround-mesh.js` draws the LOD2 station building of such a station (a photo-modelled station draws its own).  Photo-modelled stations keep their models.
* **Station patches**: `build_route_patches.py` builds the real surroundings (LiDAR, LOD2, OSM; `build_station_patch.py --index index-routes.json`, a new option) of every Luxembourg station of the three routes;
  `station-surround.js` merges `index-routes.json` into `index.json`.
* **Seam fix (`landscape.js terrainMesh`)**: extra lateral columns that exist only in one of two neighbouring chunks (river trench, valley wall, road or patch columns that start inside a chunk) made a T-junction on
  the chunk seam = a hairline crack (found at south s 10250: the far mesh shone through).  The extra vertices of a seam row are now put on the straight line between the neighbour's columns.  Benefits every route.
* **Flow `train_sim_routes.mjs`** (registered in `run_all.mjs`): stop lists, geometry, scenery, tunnels / viaduct, patches for every station, `~r`, OSM layout of Mamer-Lycée, hole scan on the three routes.
* Result numbers (26 Oct 2026): west 6 stops 6.4 km game / 17.9 km real, south 17 stops 15.8 km / 39.4 km, north 18 stops 20.5 km / 60.5 km (19 real tunnels -> 15 game tunnels, Pfaffenthal + Clausen + Pulvermuehle viaducts,
  Alzette / Sûre / Wiltz / Clerve bridges).  Hole scans (300 m steps): north 0 / 0, west 0 / 0, south 0 poses + 6 terrain-function steps of 0.5 - 1 m (mesh vs `groundHeightAt`, no gap).

## W2c: reviewer fixes (26 Oct 2026, wave 2)

* **White ground (landscape.js)**: the pale flat areas with houses on them were the "safety plane" under the far terrain (`flat`, 12.5 m below the track): in the real valleys (Alzette, Kor, Chiers) the DEM drops
  further than that over hundreds of metres, so the plane showed through as a pale quad.  On a route with `track.real` the plane now lies 3 m under the lowest far vertex of the two far levels (`level.minH`).  Other routes unchanged.
* **Water "checkerboard" (landscape.js)**: the 128 px normal map of the river had wave numbers up to (3, -2) / (-1, 3) and repeated every 6 m, which aliased into a blue-white lattice from the air.  Only low wave numbers now, UVs
  stretched to 16 x 28 m, softer normal scale / specular.  Shared with the Mosel line (water only).
* **Download size (station-surround.js, `split_station_patches.py`)**: the patches of the route stations (north / south / west, `index-routes.json` with `"split": 1`) are split into `<key>.c.json` (core: 4 m relief, roads,
  water, platforms, origin; 15 - 25 kB gzip each; fetched for all stations of the SELECTED route before the track is built, with a 15 s timeout per file) and `<key>.h.json` (class map, LOD2 buildings, trees, rails, poi;
  fetched by `create().update()` for patches up to 3000 m ahead / 1200 m behind the train, nearest first, 2 at a time, 25 s timeout; the first patch is awaited before the start, at most 6 s).  The 4 m relief is the 2 m
  grid sub-sampled (rms 0.2 m, only the steep valley walls differ by up to 3 m; the terrain strip samples it every 5 m anyway).  A heavy half that is slow or missing: `track.inSurround` stays false for that patch (the generic
  scenery grows there), the light patch (crossing road, water) is still drawn from the core, `landscape.refreshChunksAround` rebuilds the chunks when the scenery half arrives late.  `data` / `state` / `meshReady` are getters
  of the height patches.  Munsbach (index.json, Mosel line) stays one file.  Measured (`scripts/zuch/download_probe.mjs`, clean cache, medium): start of a service = cores + real data + first scenery half: west 0.73 MB raw,
  south 1.44 MB raw / 0.40 MB gzip, north 1.80 MB raw / 0.51 MB gzip (the Mosel line: 1.4 MB raw), the rest of the 20 MB streams while driving.  Rebuilding patches: `build_route_patches.py` splits them automatically.
* **Career (config.js, `scripts/zuch/career_probe.mjs`, `drive_bot.mjs`)**: the game's passenger model run 600 times per route (railcar): west 2.4 k per service (11.9 min, unchanged), south 5.9 k -> 8.5 k (20 -> 33 min, 255 EUR / min),
  north 6.3 k -> 9.7 k (22 -> 39 min, 248 EUR / min), east 4.5 k (23.6 min), wittlich 12.3 k (54.6 min); EUR per minute stays in the 190 - 255 band.  North's price 16 000 -> 24 000 (the same 2.5 services as before);
  south stays 1 800 (one west service).  `drive_bot.mjs` drives the game's own sim at 97 % of the limit (no overspeed): south / north / west / east / wittlich all keep the timetable (worst lateness 1 - 7 s, punctuality window 30 s),
  at 80 % of the limit still <= 9 s on south / north (wittlich 20 s).
* **WebKit / budgets (`webkit_smoke.mjs --station`, medium, 1024 x 768)**: Esch-Uelzecht 204 draws / 389 k triangles (cab), 160 / 386 k (aerial); Ettelbréck 230 / 360 k, 119 / 211 k; Mamer 196 / 343 k, 117 / 264 k; the crossing views 225 / 259 / 216
  draws, 367 k / 421 k / 346 k triangles; Munsbach (east) 234 / 345 k.  Chrome medium scan every 400 m (`perf_probe.mjs --scan`): worst cab view north 259 draws / 433 k triangles, south 248 / 483 k, west 238 / 392 k (W1 budget:
  about 260 draws, 680 k triangles at Munsbach).  Headless WebKit holds 16.7 ms (vsync) everywhere; no real iPad measurement.

## W2c: wave 3 (26 Oct 2026): station halls, landmarks

* Hall positions follow the OSM / LOD2 station building of each patch (`scripts/zuch/station_plan.mjs` draws the OSM outline over the model): Ettelbréck hall across the tracks (lateral -18.6 .. -27.8, 10 .. 75 m ahead; island platform with the wave canopy on the player's side),
  Miersch z -25 .. -3, Clierf z +94 .. +121 (behind), Esch-Uelzecht z -92 .. -42 (ahead), Bettembuerg +22 m, Belval vault -52 .. +62 / pod +70.  A reversed service mirrors z (`api.track.reverse`).
* `station-surround-mesh.js`: buildings centred inside a platform polygon (OSM platform roofs) are not drawn (they appeared as 250 m windowed walls).
* `real-landmarks.js` + `landscape.js` chunk hook: `TS.realLandmarks.resolve(track)` / `draw(kind, ctx)`; DEFS south: Belval furnaces A / B; north: Clervaux castle, Saint-Maurice abbey (relative to the station block, legs beyond 250 m compressed x 0.27, hill landmarks clamped to the strip).

## 3. Other lines (Wave 2+)

* West (Lëtzebuerg - Kleinbettingen, line 70): Hollerich/Bertrange/Mamer/Capellen; the A6 parallel, fields of the Grand Duchy; Mamer-Lycée is not a stop.
* South (line 60 / 6e: Lëtzebuerg - Bettembuerg - Esch - Belval - Déifferdang - Péiteng - Rodange): the Minett, blast furnaces at Belval, Esch viaduct.
* North (line 10: Lëtzebuerg - Walfer - Lëntgen - Miersch - Ettelbréck - Kautebaach - Wëlwerwolz - Clierf): Alzette valley, Pafendall viaduct, the tunnels in the Éislek.
* Abroad (Metz, Brussels, Paris): lowest priority.


## W2b (26 Oct 2026): real crossings, station patches, LOD2 station buildings

* **Real level crossings** (`scripts/zuch/real_line_crossings.py`, called from `build_real_line.py emit`): for every crossing the layout keeps, the roads of the OSM way through the
  `railway=level_crossing` node are followed outward on both sides (through OSM's way splits) to the first junction with another road, to 150 m lateral, or to the way's end, and written as
  `crossings[].arms.{l,r}` = `{ c: highway class, end: junction|lat|open|len, p: [[a, l], ...] }` (a = game metres along the track from the crossing, l = real lateral metres) into
  `mosel-features.json`.  The ribbon pieces of those roads are dropped from `roads` (no double road).  `crossing-roads.js` builds the crossing road on exactly that polyline (class -> width, `track` -> gravel,
  corner cutting, cut at tunnels / viaducts / platforms, terrain cut and fill as before); a crossing without a usable arm (shorter than 38 m, game crossing more than 42 m away from the real one) falls back to
  the Wave 1 synthetic road.  Crossing windows in `build_real_line.py` are now allowed closer to station blocks / bridges / each other (CROSS_* constants) and on gentle curves (the window is made straight when it
  loses at most 3.5 degrees of heading).  Result: 11 crossings on `wittlich` (4 in station blocks come from the station patches).  Real list: 21 (15 between stations, 6 in station blocks).
* **Station patches for every Luxembourg stop of the line** (`build_station_patch.py`, one command each, 15-35 s): Cents-Hamm, Sandweiler-Contern, Oetrange, Betzder, Wecker, Manternach, Mertert, Wasserbëlleg, Roodt-Syr,
  and Lëtzebuerg (heading hint 20 degrees: the platforms run NNE).  `station-surround.js` places the patches with the BASE track's frames (a reversed service now shows the same real station).
* **Real station buildings from LOD2** (`station-building.js`, styles in `stations-styles-lu.js`): the LOD2 faces of the building flagged `station: 1` are painted per wall face (plaster, plinth, floor bands, windows by bay,
  doors from the photos, round gable windows, green copper above `copperAbove`) with a roof material per slope; other buildings of the station area by OSM id (`others`: goods shed, toilet hut, canopies). The station models
  (`stations-lu-d.js`) only add furniture / canopies / boards.  Tools: `scripts/zuch/fetch_refs.py` (Commons photos into ~/Library/Caches/zuch-refs, outside the repo), `contact.py`, `patch_info.py`,
  `station_montage.mjs <views.json>` (photo | sim from the same viewpoint, views in the patch frame, files `scripts/zuch/views/*.json`).
* **Shared-tail hills**: the generic hill noise is taken in the frame of the tail anchor (Tréier Hafestrooss platform start) on the shared tail, blended in over 700 m: `wittlich` and `trier` now have identical ground
  there (`scripts/zuch/tail_hills_probe.mjs`: max difference 0.00 m).
* Ribbons: road ribbons are sampled every 3 m (were 8 m); the river under a river bridge of a real line is narrower (0.62 x) and meanders.


## W2d (26 Oct 2026): Gare Centrale rebuilt from its patch, LOD2 render bugs, forecourts, geometry check

* **Root causes of the broken Lëtzebuerg**: (1) the station was declared on the RIGHT of the track (authored default) while the real building and platform 1 are on the LEFT
  (patch `side: left`); `SIDE_FIX` in routes.js now has `Lëtzebuerg: 'left'` (the west / south / north services keep their authored 'right': the patch is bound to the Mosel scenery);
  (2) the LOD2 platform roofs are "buildings" in the data and were drawn as a 250 m window wall (also fixed by the routes agent: a building centred on a platform polygon is not
  drawn); (3) **triangle winding**: LOD2 rings have an arbitrary direction, a DoubleSide material flips the normal of a back face, so about half of all roofs of every patch were lit from
  below (black / "LOD2 roofs render darker than in the photos"); `MB.fixWinding()` in station-surround-mesh.js now winds every triangle with its normal; (4) the normals of the LOD2
  faces were not rotated from the patch frame into the world frame (`rotN`); (5) `triangulate3` now drops rings whose triangulation does not cover the ring's own area (warped faces
  came out as spikes / ribbons).
* **station-yard.js** (+ `station-yard-props.js`), called from station-surround-mesh.js for a patch whose style has `yard`: the real tracks of the patch (ballast with painted sleepers, rails,
  contact wire; 12 tracks of the Gare Centrale converge at both ends like the real ones), the platforms as paved slabs with a tactile band, the platform roofs from their LOD2 roof faces
  (glass / steel) with columns standing on the platforms (and on the ground under roofs with no platform: nothing floats), blue "Voie" signs, benches, the Luxtram tracks of the
  forecourt (OSM `railway=tram`) with a tram standing at its stop and buses at the bus stops.  Style: `yard: { canopies: [LOD2 ids], platformTop, platformFrom, voie: { index: label } }`
  (stations-styles-lu.js).  The hand-built Gare Centrale of stations-lu-a.js is only used on the authored west / south / north lines.
* **Patch post-process** `scripts/zuch/patch_lux_yard.py` (idempotent): ground classes of the platforms / canopy footprints / track beds, the forecourt paved, the OSM tram tracks appended to
  `rails` (kind `tram`), the LiDAR platform height (0.9-1.0 m) flattened to the slab height in the relief.
* **Forecourts of all stations** (reviewer): `build_station_patch.py` painted every pixel near a building that OSM does not cover as lawn; `patch_pave_forecourts.py` (idempotent, run on all
  finished patches) paves lawn / meadow within 60 m of the station building and within 14 m of a platform; the pipeline does the same for new builds (`lawn_fill`).  The patch fetch
  carries `?v=DATA_VERSION` (station-surround.js) because the patches are fetched with `force-cache`.
* **Geometry check**: `scripts/zuch/patch_geometry_check.mjs` (node, no browser; also step 1 of `train_sim_world.mjs`): per building face degenerate, huge (> 220 m), twisted (> 2 m off
  its plane), outside its footprint, buildings whose walls float > 1.6 m above the highest ground of their footprint.  Reviewed exceptions in `patch_geometry_allow.json` with reasons.
* **Cab sweep**: `scripts/zuch/cab_sweep.mjs <outDir> <route> ...` (cab at every stop, contact sheet per route and direction); sheets in `reports/zuchreal/w2d/cab/`.

## W2e (26 Oct 2026): draw-call batching of the station patches, Place de la Gare paved

* **Draw calls**: `station-building.js` painted one mesh (and one canvas texture) per LOD2 wall face: 657 draws at the Gare Centrale.  `TS.stationBuilding.newBatch()` (created per patch in
  `station-surround-mesh.js`, flushed after the building loop) now collects the faces of the station building and of the styled buildings (`style.others`): the painted face canvases are packed into
  texture atlases (2048 px wide, shelf packing, 4 px edge-extruded gutter), the small faces / skirts / roofs / extras are merged per material.  The pixel result is the same (before / after
  screenshots differ in < 0.001 % of the pixels).  `station-yard-props.js`: the "Voie" signs share one label atlas and one mesh, the benches and vehicles go into the mesh of the canopy columns.
  Station patches are now ~35 meshes at the Gare Centrale (was ~690).  Tool: `scripts/zuch/draw_census.mjs` (visible meshes of a view by owner group).
* **Place de la Gare**: root cause of the "lawn": a terminus patch (Lëtzebuerg is the start of the Mosel services, s = 0 right behind the platforms) reaches 320 m behind the platforms, i.e. to
  s < 0, and `frame(s)` clamped s to the track, so everything there (square, roads, tram tracks, platforms, buildings) collapsed onto the end point and the generic terrain showed through.
  `station-surround-mesh.js` `frame()` now continues straight along the end tangent beyond either track end.  `patch_lux_yard.py`: FORECOURT paving to the patch edge (Avenue de la Gare medians / verges).
  Patch fetch version `w2e1`.  Tool: `scripts/zuch/lux_ab.mjs` (cab / place / forecourt / air shots, `--root` for a before copy).

## W3 (26 Oct 2026): steelworks, Bettembourg yard, Gare Centrale trains / masts / hall

* **Industry layer (`scripts/zuch/build_industry.py <route>`, new `lod2_zone_buildings.py`, runtime `real-industry.js`)**: run AFTER `build_real_route.py emit` (it adds `legs[<id>].industry` to `data/real/<route>-features.json`; emit rewrites the file without it).  Zones = OSM
  `landuse=industrial` polygons within 750 m of the line (>= 6000 m2); buildings = the LOD2.2 footprints / eave / ridge heights of the communes along the route that lie in a zone (parsed once per commune, cached `zuch-work/lod2/zone-*.pkl`);
  OSM `man_made` chimney / storage_tank / silo / cooling tower.  Classification: chimney (footprint <= 14 m, ridge >= 30 m), tank (round, 30 - 2600 m2), pipe rack (long thin elevated), hall (the rest).  Objects go through the leg mapping
  (the legs are compressed x 0.27 along s, the lateral distance is kept); a hall is stretched back along the track as far as it does not touch its neighbours (<= 1.9x, <= 200 m).  Objects inside a station patch are dropped (the patch draws the LOD2 itself).
  South: 133 objects (halls 100+, 11 chimneys, 26 tanks, 6 cooling towers, 2 pipe racks) + 1500 yard pieces; `features.json` 485 -> 586 kB.  Differdange works (OSM `Site ArcelorMittal`, 1.4 km2 right beside the line at Uewerkuer - Nidderkuer),
  Belval, Rodange rolling mill, Esch / Schifflange zones, Livange / Bettembourg logistics halls.
* **Rendering (`real-industry.js`, hook in `landscape.js` before the real scenery)**: halls as extruded polygons with plinth, 6 m cladding panels in alternate shades (rust / grey / pale), a glazing band under the eave, multi-bay gable roofs (rectangles) or flat roofs with
  skylight monitors (other shapes), pipe bundles on the long face of big halls; chimneys (red / white bands above 55 m), tanks, hyperboloid cooling towers, pipe racks on posts.  Everything goes into the chunk's merged wall mesh (no extra draw call).
  NOTE matBlock is single sided and very bright on top faces: roofs are wound upwards and dark (x 0.34), walls wound outwards (`orient()`).
* **Belval blast furnaces (`real-landmarks.js furnace()`)**, after the Commons photos (`zuch-refs/Belval-Furnaces`): steel tower (4 columns, platforms every 11 m, bracing, charging gantry, 105 m), furnace shell inside, inclined skip hoist, fat dust catcher, four cowper stoves with
  domes, hot-blast pipe tangle, bustle pipe, brick chimney, black-brown rust.  Montage `reports/zuchreal/w3/belval-furnaces-photo-sim.png`.
* **Bettembourg yard**: `yard` records (`{"k":"y"}`) = 45 m pieces of the OSM yard / siding tracks inside `landuse=railway` areas >= 120 000 m2, 8 - 150 m from the main line, outside the station patches; drawn as ballast + rails (`mbRoad`), standing wagons (boxcars, tanks,
  flat cars with two boxes, 58 % of the pieces) and now and then a 24 m floodlight mast.  Montage `bettembourg-yard-sheet.png`.
* **Gare Centrale** (`station-yard.js`, `station-yard-trains.js`, style `yard.hall` / `yard.trains` in `stations-styles-lu.js`): catenary masts (steel pole + cantilever, every 46 m, only where no platform stands, <= 140), Grande Halle (`w362239328`) = glass canopy, the other canopies grey
  standing-seam sheet metal; three parked trains (CFL white / red, SNCB blue / white) on the tracks beside platforms 1 - 3, the game's own `trains.js` models baked with the Luxtram `createBake` (<= 9 meshes per train, no seats, no doors).  WebKit medium at Lëtzebuerg: 223 draws / 478 k triangles.
* **Staggered platforms (Zewen / Euren / Ehrang Ort)**: already built as staggered pairs in `stations-de-a.js` (`simpleStop` near / far z ranges from the OSM platforms); top-down check `reports/zuchreal/w3/staggered-platforms-topdown.png`.
* Tools: `scripts/zuch/w3_views.mjs <route> <dir> --tag t "Station:dz:lat:up:yawDeg:pitchDeg:fov:name"` (stations by name, shots with draw counts).  NOTE: `/tmp` is shared with other agents, keep scripts in the scratchpad.

## W3 (26 Oct 2026, fresh agent): Luxtram hole scan, south steps, abroad routes (metz, brussels, paris)

**Luxtram hole scan** (`scripts/zuch/tram_hole_lib.mjs` `scanTram`, CLI `tram_hole_scan.mjs`, flow `train_sim_tram_holes.mjs`): the rail detector only knows the procedural strip.  The tram scan places the train at s, waits until every tile of the stream window (detailed + far) is built, then (1) renders poses (cab, left / right down, high, back) into a magenta target with sky / hills / old far strip AND the coarse far tiles hidden: a magenta pixel below the horizon whose ray meets the tram world's `groundAt` within 150 m is a hole (the band of detailed tiles is the ground there; the far tiles are the ground beyond); (2) vertical rays over a lateral grid must hit the tile mesh within 1.5 m of the DEM-blended ground.  Poses inside a tunnel box or inside a bank are skipped.  Self-test: hiding one tile is detected.  Findings and fixes in `luxtram-world.js` / `luxtram-pits.js`:
* trench / tunnel walls ended at the ground shelf, the collar / cap lies 3 cm above it: a hairline slit along every wall top (sky / far ground shone through) -> walls end `WALL_LAP` (6 cm) higher;
* the approach walls were only built for 3 m segments lying completely inside the slot: up to 3 m of wall were missing at both ends of every open approach (a see-through gap beside each portal) -> segments are clipped to the slot; the 0.2 m gap between the cover and the approach slot is closed;
* terrain cells that straddle an approach wall are culled (steep) and left a notch inside the corridor beyond the 5 m concrete floor -> a 2.2 m dark apron along both wall feet over the whole approach;
* road pit (Kennedy): the coping's outer face stopped at the street level while the terrain beside it lies a few cm lower (slit under the coping), the floor was narrower than the terrain clip and ended exactly at it -> face reaches 0.6 m below the street, floor out to the coping and 0.6 m under the street at its end, coping runs to the end of the footprint and is closed.
Result (step 100): 815 render poses + 6144 rays clean on `luxtram`; flow (step 200) 410 poses + 4106 rays.  Left over: grazing-angle sub-pixel slivers at the end of the Kennedy pit floor (not hit by any pose).

**South steps (s 8795, 11675, 15185)**: cause = a real river that crosses the line at a steep angle.  The legs are compressed along s, so a crossing at 45 degrees is nearly perpendicular in game space and its trench is only ~8 m wide ALONG s; the 5 - 10 m rows of the terrain mesh averaged it into a wide V (0.7 m off the terrain function).  `track.js riverRows`: rows every 2 m across such a crossing (`RIVER_CROSS_SLOPE` 0.8).  South hole scan: 0 poses, 0 rays (was 6 steps).

**Abroad routes** (`metz`, `brussels`, `paris`; ids unchanged, new stop lists as audited in "W2c: stop lists"):
* `fetch_route_corridor.py <id>` = two-stage fetch: stage 1 rails + station nodes of the wide lon / lat box (`ROUTES[id]["fetch"]["box"]`) -> real path (Dijkstra, `build_real_route.build_path`); stage 2 every other layer inside `corridor_m` (2.6 km) of that path, read with `osm_rail.read_layer(mask=...)` (GDAL tests each feature against the corridor polygon while reading: no box around a 376 km route).  Metz 75 s, brussels 9 min, paris 6.5 min (Geofabrik Lorraine / Belgium / Champagne-Ardenne / Picardie / Ile-de-France PBFs in `zuch-work/abroad/`).
* Route definitions carry their own parameters (`real_route_defs.py`): `params` (game metres per real metre and leg min / max: metz 0.15 / 600 / 2800, brussels 0.06 / 700 / 3400, paris 0.05 / 1500 / 8500: the old game lengths with the real stops), `snap_gap` (dead ends within 8 m are joined: the Namur station throat has a 5.3 m mapping gap, `osm_rail.RailGraph(gap=)`), `rail_class`, `ardennes_between` (forest / farmland between two stops = `ardennes` biome), `highspeed_biome` (farmland beside a line with maxspeed >= 200 = `highspeed`), station hints for every stop.  Real paths: metz 119 km (OSM line, 12 stops, 11 bridges, 1 tunnel, 16 crossings), brussels 231 km (12 stops incl. the Brussels north-south tunnel, 6 bridges, 18 tunnels), paris 376 km (via the Vandieres connection onto the LGV Est, vmax 320 median from km 90 to 345, 5 stops, 29 bridges incl. the Meuse / Marne valleys).  Game: metz 19.9 km, brussels 17.6 km, paris 20.1 km.
* New land class `rail` (13): `landuse=railway` and land within 14 m of a `railway=rail` way that no polygon covers (yards nobody mapped) is bare ballast ground, not a ploughed field (`real_line_land.py` opt-in `rail_class`, `real-line.js CLASS.rail`, `landscape.js CLS_GROUND / CLS_FAR`, `real-scenery.js`: no trees, no fields).  The LU routes are unchanged.
* `build_leg` keeps >= 40 m of fill straight (the minimum lengths of tunnels / bridges / crossings could push the fixed pieces past the leg: `routes.js` warned "leg overfull" for Ottignies - Bruxelles-Luxembourg).
* `build_real_route.emit`: `crossings` was a (records, arms) tuple since W2b: only the records are stored.
* Crossing planner (`crossing-roads.js`): (a) a real river can run closer than 58 m: the roads stop before its bank (`RIVER_LAT_MIN` 30; metz s 17007: a bend road floated 4.5 m over the channel); (b) crossings closer together than their parallel roads (metz: 110 - 140 m) put two parallel roads on top of each other, the terrain cannot follow both profiles (0.4 m off): the later cross road T-joins the earlier parallel road (`info.sides[].shared`, pinned to its height; the world flow counts a shared side as reaching 120 m).  Plans without clashes are unchanged.
* Portals (`infra.js railPortalGeometry / addRailPortal`): the portal wall's foot reaches 4 m below the formation and the wing walls 4 m below the rails: where the cutting falls away beside a portal (brussels s 947) a slit showed the far ground.
* Stations: no LOD2 / LiDAR abroad, so no surroundings patch: generic stations get their OSM platforms (`stations-osm.js`), the Luxembourg stops (Lëtzebuerg, Houwald, Bettembuerg) keep their patches.  Photo models: Metz-Ville (forecourt: arched gable, entrance canopy, wing windows added; it was a blank wall), Thionville, Pont-à-Mousson, Nancy-Ville, Arlon, Libramont, Namur (forecourt arch + clock), Bruxelles-Midi (platform canopy, concourse, Tour du Midi), Champagne-Ardenne TGV, Paris-Est (hall with the fan window).  Montages (photo | sim): `reports/zuchreal/w3/abroad/{metz-ville,namur,bruxelles-midi,paris-est}-photo-sim.png`, cab sheets `abroad/cab/<route>-sheet.png`, aerial sheets `abroad/<route>-aerial-sheet.png`.
* Career: prices metz 52 000 -> 72 000, brussels 72 000 -> 108 000, paris 140 000 -> 160 000 (`career_probe.mjs`: runs to buy 1.8 / 1.9 / 3.3 with the longer fares, 2.6 / 2.9 / 3.9 before; eur / min 1069 / 1335 / 2394 vs 1231 / 1438 / 2772).  KNOWN: `drive_bot.mjs` (97 % of the limit) is late with the premium trains on every route, more with more stops: kiss metz 573 s (6 stops before: 142 s), brussels 339 s (112 s), hst paris 338 s (258 s), trier kiss 283 s; the railcar keeps the timetable (metz 42 s worst, brussels 3 s, paris 74 s late).  The cause is the exchange time of big trains (4 s + 0.6 / 0.7 s per passenger) against the 30 - 45 s dwell: not tuned.
* Gates: `train-sim-abroad` flow (stop lists, lengths, real data, rail class, `~r`, start data metz 1.37 MB / brussels 1.39 MB / paris 1.49 MB (decoded; features 1.0 / 1.2 / 1.3 MB raw, 195 / 213 / 230 kB gzip, the Mosel line 188 kB), hole scan).  Hole scans step 300 (`hole_scan.mjs`): metz 330 poses / 5104 rays (one terrain-function step of 0.72 m at s 4115: a 4 m relief step the 10 m rows smooth), brussels 255 / 3812, paris 320 / 4604, all LU routes clean except north s 2945 lat 68 (0.98 m, present on the W3 baseline too: Dummeldeng patch fade).  WebKit medium (webkit_smoke): metz 243 draws (forest leg, worst), brussels 226, paris 208; Chrome medium scan every 400 m: mean draws metz 199 / brussels 198 / paris 161.

## W5 (31 Oct 2026, agent zroads): roads beside the rail track, vehicles on drawn roads only

**Root causes found**
* *Combs and tongues*: a leg is compressed along the track by k = real / game length (west / south / north 1.2 - 3.7, mosel 1.7 - 5.4, metz 3.3 - 9.8, brussels 8 - 17, paris 19 - 21) while the lateral distance is kept (`LegGeom.game_of`).  A road at real angle a to the line gets atan(k tan a) in game space: the near-parallel roads (15 - 30 % of the road metres: the main road, the track beside the line) became diagonal "tongues" across the fields, and the perpendicular village streets (52 % of all road metres on west / south / north, 74 - 91 % on metz / brussels / paris) kept their real lateral length but a k times smaller spacing (a street every 3 - 10 m = barcode).  Not fixable by the planner: the data itself is squashed.
* *Roads over the rails*: a few simplified road segments (Douglas 3 m in `roads_of_leg`) span the corridor although the vertices inside +-11 m are cut (south S01 near Gare Centrale: tertiary from lat -11.6 to +118): the ambient cars of landscape.js (`carMesh`, they drive on the drawn chunk roads) then drove ON the main tracks of the first station of south / east / wittlich / trier / metz.  This was the "cars on the tracks where there is no road".
* *Crossing traffic without a road*: `crossing-traffic.js` activated a crossing within 760 m of the train whether or not its road was built: a station-patch crossing (Munsbach, Betzder, Zewen, Euren, Hetzerath) is drawn by `station-surround.js` only after the scenery half of the patch has loaded and within 850 / 1100 m (lazy loading on a slow iPad = cars queueing on bare rails).
* A real T-junction onto the middle of a way counted as a free end (only end-to-end meetings did), so tapered stubs were drawn at real junctions.
* Synthetic parallel roads of the crossing planner were laid beside / across real parallel roads (west, south, north have no real arms in their data: `emit` was never re-run for them since W2).

**Fixes**
* `scripts/zuch/real_line_roads_tidy.py` (also called by `build_real_route.py` / `build_real_line.py` emit, per leg, with k from the leg meta; standalone for the committed data, raw copy in `$ZUCH_WORK/realline/<route>-features.raw.json`, file marked `"tidy": 1`): 0 cut roads that span the corridor (|lat| < 16) - 1 SHEAR roads whose real angle is < 22 deg back to that angle (lat' = lat_ref + (lat - lat_ref) / k) - 2 SNAP the ends of roads and crossing arms that touch a sheared road - 3 TRIM cut ends within 17 m of the axis back to 21 m - 4 drop skewed minor roads (14 - 66 deg), short pieces, isolated stubs < 60 m, THIN perpendicular minor roads closer than 26 m (same side) - and mark real free ends (`f` bit 0 / 1; `real-line.js` uses it, T-junctions count as junctions).  Road counts west 1545 -> 616, south 4129 -> 1561, north 3980 -> 1591, mosel 8103 -> 2965, metz 10390 -> 2928, brussels 12305 -> 3090, paris 13769 -> 3307 (features files 40 - 60 % smaller).  `DATA_VERSION` 5.
* `crossing-roads.js`: a crossing without a real arm T-joins a real parallel road beside the line (`real.parallelRoadAt`, `ctx.realParallel`) instead of drawing a second synthetic parallel road; the traffic drives on that cross road.
* `crossing-traffic.js`: `roadsDrawn(crossing)` (landscape.js `crossingRoadsDrawn`: the chunk that holds the crossing exists / the patch mesh is built, `station-surround.js isBuilt`) gates activation; vehicles vanish when the road goes away.
* Probes: `scripts/zuch/traffic_probe.mjs [routes] [--ret] [--lazy] [--root dir]` (vehicle paths vs rail corridor, vs a rendered road surface (ray down; meshes under groups tagged `userData.road`), 5 simulated minutes of crossing traffic per site, ambient cars along the whole route, return direction), `gauge_scan.mjs` (rays along the loading gauge), `road_ends_shots.mjs`, `aerial_sheet.sh`.
* Reports: `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/zuchreal/w5/roads/` (`before/`, `after/`).

* West / south / north now have real crossing arms: `build_real_route.py emit <route> --features-only` re-runs the scenery / road / crossing stage and leaves the layout JSON and `real-<route>.js` untouched (it keeps the `industry` layer and refuses to write when a leg length differs from the committed one).  The crossing records of these three files were stale (W02 west: record at 154.8 m, the game crossing at 243.9 m), so the real-arm hint never matched: west 2 / south 3 / north 9 crossings now follow the real road.  Tram: `scripts/zuch/tram_traffic_probe.mjs` (static scan of every drawn ground road against the rails outside `cross` / `along` ranges + 12 spots of live traffic): 462 roads, 24 617 points, 8 101 vehicle samples, nothing on the rails.  `scripts/zuch/trackside_sweep.mjs` takes aerial + cab sheets of every route in one browser session.

**Open**:  roads over the line (overbridges) are not modelled, they simply end 21 m from the axis; the real-scenery ribbons are not cut where a synthetic parallel road remains; station-patch crossing lanes sit 0.7 - 1 m under / over the patch road at north s 10329 and wittlich s 15891 (PATCH_ARM heights, stations agent area).

## W5 roads2 (1 Nov 2026, agent zroads2): overbridges, steep-valley steps, portal wings, patch lanes

**Overbridges** (the real road that crosses the line on a bridge used to end 21 m from the axis on both sides)
* Pipeline: `scripts/zuch/real_line_overbridges.py` (called by `build_real_route.py emit` / `build_real_line.py write_features` between `roads_of_leg` and the tidy).  A highway way with `bridge=*` / `layer>=1` that crosses the rail path is followed through the ways that continue it (same trace as the level crossing arms) and written as ONE polyline per structure, leg key `ob`: `{ s, c, w, n, r, p: [[s, lat], ...] }` (game coordinates, far end on one side to far end on the other, at most 215 m / lat 112 on each side).  The ribbons along it are removed from `roads` (`claim_ribbons`), twin carriageways are one structure (`dedupe`), structures within 85 m of a leg end, 60 m of a tunnel / bridge / level crossing piece are not emitted (the road keeps its old stub).  `build_real_line.py emit --features-only` (new) rebuilds only the features of the Mosel line; `tidy_leg(..., obs)` counts an overbridge as a junction for free-end detection.
* Runtime: `overbridges.js` (plan + design: deck 8.2 m over the rail head = 7.25 m clear under the slab, catenary mast head 6.9 m; abutment faces 4.9 m outside the outer track axis, single span, no pier near a rail; in a cutting the abutments move out to where the ground reaches the deck; embankment ramp with the class grade, steeper only when the claimed road is short, never under the ground; structures that would need more than 18 %, or that lie within 240 m of a platform / a diamond crossing / a tunnel are handed back to ordinary ribbons, `plan.skipped`), `overbridges-mesh.js` (slab with chamfer, footways, kerb wall + steel railing, stone end posts, abutment blocks, wing walls, 1:2 grass slopes with the terrain material and colours, guard rails, asphalt + edge / centre lines; four draw calls per chunk, shadow only on high).  The ground is NOT changed: the embankment is a solid mesh that ends 15 cm under the terrain, so `terrainHeightAt` and the hole scan are untouched; `onRoad` / `track.isReserved` keep trees and houses off the footprint; the landscape cars drive over the deck (`chunkRoads` with heights; `ambientCarPoses` has `y`). 
* Tools: `ob_probe.mjs` (clearance, edge distance, flat deck, profile vs ground, slopes reach the ground, meshes built), `ob_shots.mjs` (cab / under / side / aerial / ramp views of every structure), `poses.mjs`, `draws_at.mjs`, flow `train_sim_overbridges.mjs`.
* **Not modelled: underpasses** (road under the line, OSM tunnel / layer -1).  The game ground has no embankment profile beside the formation: a road dipping 6.7 m under the rail needs a trench with retaining walls and a hole in the terrain strip (the carve with slopes leaves 6 m cliffs at the portals, a hole needs quad edges that follow a skewed road); a box that sticks out of the slope fits nowhere (checked on metz / brussels / south / west: 0 of 20 sites have the ground 6.7 m under the rail within 36 m).  The road keeps ending at the line there.

**Terrain steps on steep valley sides** (hole scan "step" 0.9 - 1.3 m: north s 2945 lat 68, metz s 15320 lat -54)
* north: the LiDAR grid of a station patch has 4 m cells, the strip rows / columns inside a patch were 5 m apart and missed its nodes: on a real wall edge the mesh was up to 1.3 m off the bilinear function.  `station-surround.js` rows / columns now lie on the grid lines of the patch (4 m, fade zones 2 m): max difference 0.02 m.
* metz: a river bank crossing the line at a steep angle drops 2.7 m within 12 m of s; rows were 12.5 m apart.  `landscape.js terrainMesh` adds adaptive rows (a row in the middle of two rows when the function differs from the line between them by more than 0.3 m at a probed column, down to 1.6 m, only inside the chunk so the seams are unchanged): max difference 0.24 m.
* `real-line.js`: the relief of two consecutive records (a leg and the 290 m block of its station) differed by 1 - 2 m at 220 m beside the line (end rows smoothed differently); the mismatch is split and faded over 40 m (`joins`).

**Other**: tunnel portal wing walls (`infra.js addPortalWings`: retaining walls that leave the portal face at 45 degrees, top follows the ground + 0.5 m, foot under the formation; were two 12.8 m tall tilted slabs); station-patch crossing lanes follow `track.terrainHeightAt` (the drawn road does) instead of the base terrain (`crossing-traffic.js groundAt`, `PATCH_ARM_MAX_GRADE` 0.45): the 0.7 - 1.0 m offsets are gone; station trees: crown radius cut to the distance of the nearest building footprint instead of a fixed 7 m keep-out (`station-surround-mesh.js`); brussels / paris (k 8 - 21): the tidy drops minor perpendicular roads whose far end touches nothing and thins the rest to 70 m spacing (`HI_K`).
