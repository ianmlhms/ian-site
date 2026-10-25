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

## 3. Other lines (Wave 2+)

* West (Lëtzebuerg - Kleinbettingen, line 70): Hollerich/Bertrange/Mamer/Capellen; the A6 parallel, fields of the Grand Duchy; Mamer-Lycée is not a stop.
* South (line 60 / 6e: Lëtzebuerg - Bettembuerg - Esch - Belval - Déifferdang - Péiteng - Rodange): the Minett, blast furnaces at Belval, Esch viaduct.
* North (line 10: Lëtzebuerg - Walfer - Lëntgen - Miersch - Ettelbréck - Kautebaach - Wëlwerwolz - Clierf): Alzette valley, Pafendall viaduct, the tunnels in the Éislek.
* Abroad (Metz, Brussels, Paris): lowest priority.
