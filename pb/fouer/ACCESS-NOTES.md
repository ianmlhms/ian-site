# Access wave "Walkways and access": notes (23 Oct 2026)

Owner's bug report: "For some attractions, like the Autoscooter, there are stands in front of it and you can't really access it. Rework walkways everywhere."
Screenshots (before / after, plan with the network overlay): `website-overnight/reports/fouer/access/`. No photos, no secrets, no network assets in the repo.

## What was wrong
The density passes (polish 2 `packFree`, looks) packed NPC stalls into every free rectangle, and the only things kept free were the two long alleys and a few nominal "cross alleys" that the pitch table itself ignored:
- **M2 row (P07, P13, P22, P28, P33)**: the pitches sat 7-8 m behind the Haaptallee (L / M) and the filler put a row of stalls between the alley and the pitch front (nearest-alley facing), i.e. exactly the Autoscooter case (P13). With the old data, 12 pitches (P01, P02, P07, P10, P12, P13, P17, P18, P22, P28, P33, P34) had NPC stalls inside the space a forecourt needs.
- **S row (P14, P15, P23, P29, P30, P34)** faced -w towards the *backs* of the M2 pitches: the nearest alley was 32-36 m away. They were reachable only through gaps.
- **Cross alleys at u 66 / 130 / 190 / 250** existed only as filler corridors; the pitches P09, P16, P22, P24, P28, P33 stood right in them.
- **Riserad (P24)** faces +u but P07 stood 2 m in front of it (its forecourt was a 2 m slit); **E5 / E6** (NW gates) ended in two pitches; **P31** has its front half outside the field.
- The "alley" numbers lived in five places (npc.js CORRIDORS + ROWS, props.js ALLEYS, clutter.js AL / CROSS, events.js ALLEY, walk.js gate gaps) and disagreed by tenths of a metre.

## The layout data model (`pb/fouer/layout.js`, pure, no THREE)
- `ALLEYS`: axis-aligned walkways `{ id, kind: main|cross|lane, u: [a, b], w: [c, d], min, axis, entrance? }`. Haaptallee 12 m (w 50-62), Fressgaass 8 m (w 24-32), south alley `sud-west` (w 92-99) + `sud-ost` (w 93-100) 7 m, Riserad passage `cross-wheel` (u 58-67, 9 m) and `cross-seam` (u 171-178) from the Haaptallee to the south alley, `cross-west / -a / -c` (Fressgaass <-> Haaptallee, 7 m), one 7 m entrance lane per gate (`lane-e2 .. lane-e7`, `cross-a` is E5's lane), `lane-e1 / lane-e7` are the 12 m runs through the SW booms and the NE portal.
- `SERVICE`: the SE service lane, a 5.2 m quad 3 m inside the rim (u 110-214), crossed by the E2 / E3 lanes.
- `ENTRANCES`: the seven entrances (moved here from props.js, which re-exports them); **E5 moved u 112 -> 98 and E6 u 196 -> 178** because pitches stood in front of the old doors.
- `forecourtOf(pitch)`: the clear rectangle on the `face` side, full pitch width, depth S 3.5 / M 5.5 / L 7.5 / XL and W 9 m, stretched to the alley when the gap is <= 6.5 m (`APRON_MAX`; S pitches 5 m away from their alley get a paved apron).
- `queue-<id>` zones (follow-up): the first 8 queue slots of both sides of every pitch (`QUEUE_OUT/START/STEP/RESERVED`, same formula as crowd.js `queueSlot`, which now imports the constants) are reserved like the forecourt (a 13.8 x 3.6 m strip, trimmed at neighbouring pitches); `validateStatic` insists that 8 slots fit inside the field and clear of other pitches on one side. A queue row therefore never depends on the NPC seed.
- `createReservations(pitches)`: `hits / hitsFrontage / blocksCircle / isKerb` for the packers; `rasterZones()` for the fine NPC grid, the ground wear texture and the overlay; `corridors()` hands the crowd graph its centre lines (cross alleys reach the centre of the alley they join, the service lane is diagonal, the NE lane reaches the street).
- Rules: NPC stalls, tents, camelots, tables / umbrellas, crates, banners, plots dressing never intersect an alley, a forecourt or an entrance lane. **Frontage**: stalls keep 1.2 m + 0.25 m (`FRONTAGE.main`) back from the long alleys (their 0.95 m awnings stay clear of the walkway); the dressing (tables, crates, A-frames, bins, banner poles, `clutter.js` gets the stall list) fills the gaps between them, outside the walkway. **Kerb furniture** (lamp posts, bins, banner poles, flood masts: radius <= 0.26 m, centre <= 0.6 m outside an alley edge, i.e. on the kerb line 0.27 m outside the rectangle) may stand in a forecourt strip that overlaps the alley; nothing else does.
- Who reads it: `models/npc.js` (CORRIDORS, ROWS in terms of alley edges, zone bits in the coarse grid, exact zones + frontage in the 0.5 m grid, `rectOk` for rows and greedy passes, `faceToward` = towards the nearest alley), `props.js` (lamps, bins, benches on the kerb line, moved along the kerb at crossings), `clutter.js` (edge dressing outside the walkway, banner poles on the cross-alley kerbs, masts, rim fence panels, free-field filler through the coarse grid), `crowd.js` (`line` of a corridor), `world/glacis.js` (`setWearField`: the whole network, forecourts included, as a 1 m raster texture: swept lighter ground + tyre marks), `events.js` (ALLEY / BANNER = Haaptallee of the layout), `models/fair.js`, `main.js`, `models/access-debug.js` (overlay).

## Pitch changes (data: `pitches.json` + `data.js`, ids / sizes / faces / stars unchanged, same table sync)
| pitch | before (u, w) | after | why |
|---|---|---|---|
| P24 Riserad | 46, 86 | 38, 86 | its +u forecourt (9 m) needs u 58-67; the field edge allows u >= 18 |
| P07 (M) | 76, 78 | 75, 71 | front flush with the Haaptallee (was 8 m back), forecourt end of the wheel |
| P13 Autoscooter pitch (L) | 100, 78 | 99, 72 | front flush with the Haaptallee (was 7 m back behind a stall row) |
| P22 (L) | 190, 78 | 193, 72 | flush; leaves the 7 m `cross-seam` between it and P28 |
| P28 (XL) | 146, 78 | 143, 78 | `cross-seam` |
| P33 (XL) | 236, 78 | 237, 78 | fits the field edge with the seam open |
| P14, P15 (S) | 80 / 96, 98 / 100 | w 103 | fronts on the south alley (w 99) instead of the backs of M2 |
| P23, P30 (M) | w 106 / 111 | w 108 | fronts on the south alley (w 100) |
| P34 (M) | 236, 113 | 233, 108 | south alley; its corner was outside the field |
| P31 (S) | 284, 41 | 277, 41 | its apron towards the Haaptallee lay outside the field |
The harness keeps its old pitch checks (no overlaps, >= 1 m gaps, inside the wedge, front within 16 m of an alley line, wheel at the SW end).

## The validator (`layout.js validateLayout`, harness.js + flow)
`validateStatic` (widths vs `min`, alleys inside the field, pitch overlaps an alley / the service lane, face points to an alley <= 6.5 m away and not the wrong way (alley behind is nearer by > 1.5 m), forecourt depth >= min and not blocked by another pitch), `validateFootprints` (stalls / boxes / solids vs zones, kerb exception, names the stall index, kind, rectangle and the zone), `validateStallFaces` (a stall touching an alley faces one it touches or looks at an alley / the service lane within reach), and the **BFS**: for stars 1..5 (fresh fair with locked pitches solid and open ones fenced, star 3 half built, full) the real `createMask` is asked on a 0.5 m grid, one flood fill from every open entrance (4 m inside its door), every pitch's entrance point (1.2 m in front of the front edge) must be reached from every one of them. Every failure names the pitch / stall / alley id; `assertLayout` throws with the list.
- `node pb/fouer/harness.js`: **1263 checks** (1118 before). New: the layout (widths, forecourts of all 34 pitches, 7 entrances), negative tests (a stall in front of P13 is reported with `forecourt-P13`, a wrongly faced P13, a pitch pushed onto the Riserad passage, a Haaptallee of 8 m, a wall of stalls across the Haaptallee: "not reachable"), the BFS for stars 1-5 and without the SW entrance, and **the real NPC fair, props and clutter** (`harness-access.js`: a child process builds `buildNpcFair / buildProps / buildClutter` with a tiny stand-in for THREE, ten seeds (8 medium, 2 low), ~290 stalls + ~110 solids) with 0 footprints on a walkway and every pitch reachable with all of it in the way. The harness takes ~8 s.
- Flow `fouer-access` (`scripts/flows/fouer_access.mjs`, registered in run_all.mjs, ~1.5 min): the same validator on the real built fair in the page; layout.js outline == baked world outline; crowd graph is one connected network on 11 named lanes; queue slots / destinations free in front of every pitch; P13 forecourt clear; **simulated walking** (BFS path + string pulling, then the real controller: keys forward + run, steering by yaw, `walk.update` at 30 Hz, ~9.7 km walked) from the NE portal (E7) and the SW entrance (E1) to the front of **all 34 pitches** (19 rides incl. the wheel's platform, 15 stalls), the action is offered there (`ride:`, `eat:`, `play:`, `wheel`), the round button says "Fueren" and boards **all 19 rides from both entrances** (early exit); perf; zero console errors.

## Follow-up: two flaky checks made deterministic
- `fouer-access` "P32: only 5 of 15 queue slots are free": the queue area is now reserved in the layout (`queue-<id>` zones above) and the flow demands `QUEUE_RESERVED` free slots. While testing ten seeds the harness found a real latent bug in `packFree`'s service-strip branch (`models/npc.js`): the strip was as wide as the free run but its depth was only checked over the first 3.3 m, so a shorter column let it poke into a neighbouring zone (it hit the queue strip of P17 for one seed); the depth is now taken over the whole width.
- `fouer-rides` "scooter: the walker is back at the entrance": the test holds forward + right until the 60 s ride ends and used to read the walker 250 ms - 1.1 s later (polling + a sleep), i.e. after it had strolled away from the restored spot unless a kerb post stopped it; with the lamp posts / bins moved to the kerb line it exceeded 1 m now and then. The flow now reads the walker on the first frame after the ride is over and releases the keys in the same tick (0.03 m off).

## Numbers (headless Chromium, iPad-medium profile, night, `renderer.info`; before = origin/main, after = this tree)
| scene | before draws / tris | after draws / tris |
|---|---|---|
| medium builder fresh | 60 / 238k | 60 / 220k |
| medium builder full (`fillFair(3, 5)`) | 107 / 286k | 107 / 268k |
| medium walk full, u 60 w 56 (crowd) | 177 / 278k | 174 / 253k |
| medium walk full, u 150 w 56 | 121 / 226k | 120 / 205k |
| low builder full | 104 / 213k | 104 / 203k |
| low walk full, u 60 w 56 | 152 / 195k | 153 / 183k |
| low walk full, u 150 w 56 | 109 / 161k | 107 / 155k |
Limits (DESIGN 5): builder 140 / 300k, walk 220 / 300k: all inside, a little lighter than before (fewer NPC stalls). The access flow measures 116 draws / 266k (builder) and 156 / 240k (walk, full fair, alley start) in its own scene. The ground wear raster adds no draw call (one 320 x 170 RGBA texture, 218 KB).
Density: the walkway network takes 33.1 % of the field (the old filler corridors 25 %, and those were partly under pitches), pitches 37.4 %, NPC stalls 13.6 % of the field (20 % before) with 296 stalls (374 before; camelots on the tram lane unchanged); 5 % are the frontage strips, 11 % margins between stalls and slivers too thin to build on (only ~1200 m^2 are free 3 x 3 m windows).

## Verdict (screenshots, honest)
See `website-overnight/reports/fouer/access/`: `before-scooter-*` vs `after-scooter-*` (Würfelbud and tables in front of the Autoscooter -> an open 7.5 m forecourt and the whole front visible), `after-plan` (network overlay: alleys blue, lanes red, service lane orange, forecourts green), the fronts of the tent, Alpina, the Break Dance, a small stall and the wheel, and the wheel views. Walkways now read as walkways (lighter swept surface for the whole network incl. forecourts, lamp posts on the kerb line, dressing in the frontage). The cost is density: the field is less wall-to-wall than after polish 2 (more bare asphalt in the forecourts and on the south alley).

## Known gaps / ideas
- Density: the forecourt aprons of the 12 S pitches that stand 5 m behind their alley (M1 / N rows) are bare; moving those pitches flush to the alley (a 5 m data nudge each) would give the filler back ~500 m^2. The south-west plaza (wheel forecourt + passage + south alley) is open by design.
- The service lane is a dead-end strip reached from the E2 / E3 lanes; the crowd uses it little.
- `PIT_F` of npc.js is unused now (the forecourt replaces it); the old `GATE_LANES` export is an empty list.
- `FIELD_POLY` is a copy of the baked outline (the flow asserts equality); a re-bake needs it updated.
- The kerb exception means a lamp post can stand 0.25 m inside a pitch slot at a flush pitch front.

## Hooks used from files this wave does not own
`world/glacis.js` (wear texture, `setWearField`), `crowd.js` (corridor `line`), `events.js` (ALLEY from the layout), `models/fair.js`, `main.js` (`__fouerGame.accessOverlay(on)` in debug), `pb/fouer.html` (`main.js?v=5`).
