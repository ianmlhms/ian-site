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
