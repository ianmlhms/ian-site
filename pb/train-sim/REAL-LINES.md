# Real lines in the Zuchsimulator: decision and stop lists

Status: written in Wave 1 of the "zuchreal" work (25 Oct 2026).  Wave 2 implements the curve derivation below for the Mosel line first, then the other lines.

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

## 3. Other lines (Wave 2+)

* West (Lëtzebuerg - Kleinbettingen, line 70): Hollerich/Bertrange/Mamer/Capellen; the A6 parallel, fields of the Grand Duchy; Mamer-Lycée is not a stop.
* South (line 60 / 6e: Lëtzebuerg - Bettembuerg - Esch - Belval - Déifferdang - Péiteng - Rodange): the Minett, blast furnaces at Belval, Esch viaduct.
* North (line 10: Lëtzebuerg - Walfer - Lëntgen - Miersch - Ettelbréck - Kautebaach - Wëlwerwolz - Clierf): Alzette valley, Pafendall viaduct, the tunnels in the Éislek.
* Abroad (Metz, Brussels, Paris): lowest priority.
