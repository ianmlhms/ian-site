# Feedback B: stall placement, floating objects, Autoscooter, Bayern-Kurve (23 Oct 2026)

Ian's walk-mode playtest (Safari, screenshots 55-59). Part A (walking speed, walk pin, loading screen, collision, builder -> ride) is a separate change in the same tree.
Screenshots (before / after from the same spots): `website-overnight/reports/fouer/feedback-b/`. No photos, no secrets, no network assets in the repo.

## 1. Stalls stand behind each other, two identical Spukhaeuser behind the "Fraei Plaz" plots

**Cause.** `models/npc.js` gave every stall a face "towards the nearest alley" (`faceToward`) without asking whether anything stood in front of it. The three packers (the rows along the alleys, the greedy
gap passes, `packFree`) then filled the gaps with more stalls: a stall behind another one looked at its back (screenshot 58), the two `funhouse` skins (Spukhaus) in the NW strip looked at open plots
(59).  On top of that the rows re-rolled the size of every stall after it had been fitted (`drawSkin`), so fronts stood up to 3 m back from the alley; stalls turned to face +u / -u were drawn with the
footprint of a +w stall (swapped width / depth); the same fixed skin stood twice side by side (`popcorn`, `icecream`, two Spukhaeuser).  The old validator only asked "does a stall at an alley face it?".
Before: 70 of 280 stalls failed the new front rule in every seed (backs, plots, field edge), 20 identical neighbours.

**Rule (data + validator, `layout.js`).** `FRONT_REACH` = 3.4 m: walking straight out of the front of a stall (centre line and the two quarter lines) the centre line must reach a walkway (alley,
entrance lane, service lane, forecourt, queue strip) before anything else is in the way (another stall, a plot, the edge of the field).  `validateStallFronts` also rejects two stalls of the same
fixed-look skin (`DUP_SKINS`: Spukhaus, bouncy castle, kids' ride, chair swing, tiki, temple, fisher, arch, claw, popcorn, ice cream, pizza, balloon, souvenir, sweets, game, kiosk, chalet, trailer)
closer than `DUP_GAP` = 2.5 m, and two big themed skins (`BIG_SKINS`: funhouse, bouncy, kids, chair) within `BIG_SPACING` = 40 m (one per block).  Tents and the generic hall tents may stand in a row.
`frontProbe` is the exact probe, `validateLayout` runs the check, `harness-access.js` runs it for all ten NPC fair builds (8 medium, 2 low) and the flow `fouer-access` on the real fair.

**Packer (`models/npc.js buildNpcFair`).** A 0.5 m occupancy grid of stall and plot footprints (`occ`) and the exact zone list drive a grid version of the probe (`probeFront`, a bit stricter than the
validator: shorter reach, wider margins).  Rows, gap passes and `packFree` ask `openFace` / `probeFront` before they place a stall: the stall is only built when the probe succeeds, and the strip
between its front and the walkway is reserved (`reserveFront`: fine grid + coarse grid, so nothing else is packed or dressed into it).  `skinOk` keeps identical neighbours and Spukhaeuser apart.
A stall that stands within the frontage of an alley still has to face it (`touchesAlleyAway`, the old `validateStallFaces` rule).  Stalls are drawn at exactly the size that was fitted and
`worldDims` gives the right footprint for +u / -u faces; `packFree` offers every skin turned as well (depth along u, front +u / -u).  `packFree` now tries up to 8 candidates in score order
(`put` may refuse) and falls back to back-of-house at the size of the best candidate (before: a 3.2 m strip).  Back-of-house = `backLot` (caravans, crates, generators, fenced storage) or the new
`storeTent` (a white hall tent with `closed: true` in `models/tents.js hallTent`: blank end wall, no door, no lettered panel, no porch).  Locked pitches (`pitchCluster`) are packed from the front edge
of the slot backwards with the same rule: only the front row has shop fronts, the rows behind are back-of-house.

**Numbers (seed 1, medium).** 250 footprints: 86 shop fronts + 164 back-of-house lots / closed tents (was 180 + 114).  Area covered by footprints is unchanged (4.8k m2); from above the fair looks as dense
as before (see `overview-*.jpg`), at eye level every shop front opens onto an alley, a lane or a forecourt.  The check passes for 30 seeds; harness: 0 problems in all ten builds.

## 2. Something floating in the air (screenshots 56, 57)

**Causes found (by the audit below).**
- `props.js`: the flag strings over the Haaptallee started 1.2 m beside the lamp posts (the one in 57 hangs in the sky).  They now hang from the two posts of the crossing.
- `clutter.js`: the flag lines over every cross alley / entrance lane (every 11 m) had no pole at either end.  Each one now gets a pole on both kerbs (solid r 0.1, the kerb exception of layout.js);
  where there is no room for both poles there is no line.
- `kit.js pennants`: the line the flags hang from ran straight from a to b above the sagging flags; it follows the sag now.  `dressEdge` (every player stall at L2+) strung its flag line 0.6 m above
  the awning edge, fastened to nothing: two little masts on the edge now.
- `stallkit.js` pylon sign (game stalls): the posts stood at 0.34 w, outside a narrow sign, which then hung between them (3.6 m signs in the air at 4.5 m).
- Parasols (`clutter.js parasol`, `kit.js table`, camelot umbrella) stood on a pole that ended below the apex; kids' ride and chair swing canopies sat on a pole that did not touch them; the tiki bar's board hung from nothing; the camelot board
  hung in front of the counter; the hall tent's porch valance was drawn along the tent's middle line (`fringe` with the wrong axis); `schiess` targets, Take Off's bulb wheels and ellipse sign, Musik Express hub roof.
- **Screenshot 56** is the player's `fesch` stall (the "Fouerfesch" fascia): the fish sign stood on a dark 0.12 m post that vanishes against the night sky, so the lit golden fish (and, at L4, the gold ball
  6.35 m up) floated.  It is a pale 0.2 m post that runs on above the fish now (`stalls.js`).
- Musik Express turned the wrong way round, see 5.

**Audit (`float-audit.js`, pure).**  Every triangle of every Builder is sampled onto a 0.2 m voxel grid, touching voxels are one piece, a piece is grounded when a voxel is within 0.25 m of the terrain,
a bulb (halo sprite) needs grounded geometry within 0.6 m.  Single precision on purpose (the browser sees float32).  `kit.js finish` hands every Builder to `globalThis.__fouerRawSink` when a test sets it.
- `harness-access.js` (node, stand-in THREE): the NPC fair + props + clutter (seeds 1, 2 medium, 3 low) and all 22 Builder-kit models (food / game stalls, small rides) at all 4 levels x 3 looks.
- flow `fouer-models` (real THREE, real meshes through their world matrix): the same models, the NPC fair, props and clutter (seeds 1, 4).
- negative tests in `harness.js` (a flag line between two missing poles, a hovering post, a bulb with no fixture).
Not covered (documented): the big-kit rides (wheel, towers, coasters, halls): their gondolas, swings and steam are animated pieces that hang from pivots at rest, the audit would report them.
Wall-clock: the audit adds about 10 s to `node pb/fouer/harness.js` (now about 25 s).

## 3. Autoscooter (`rides/drive.js`, `models/hall-scooter.js`, `rides/bumper.js`)
- **Ghost riders.** `rider()` in `hall-scooter.js`: a seated crowd-style figure (box torso, ball head, hair / cap / hood / bun, five skin tones, eight hair colours, twelve shirt colours, sleeve and
  trousers variants, scale 0.8 - 0.96) in every car, hands on the wheel; the far LOD gets torso + head.  `ud.riders` = number of cars.
- **Wheel.** The old wheel (r 0.21 m, 0.67 m in front of a 1.25 m eye) filled about half the screen.  Eye now 1.5 m above the floor and 0.42 m behind the car centre; wheel r 0.09 m, 0.72 m ahead and 0.38 m below the eye:
  19 % of the screen height in portrait 820 x 1180 (limit 21 %; measured by the flow from the projected rim, landscape 1600 x 900 checked the same), at the bottom.  Slim bonnet (stripe 0.1 m), dash lamps smaller, hands on the rim at 3 and 9 o'clock,
  and the wheel turns with the stick (`wheelAngle`, +-0.95 rad).
- **Bigger floor.** `FL` 26 x 11.5 m -> 27 x 13.7 m (370 m2 of the pitch's 30 x 18; the porch is 2.4 m deep, the booths and the entrance arch moved forward, the queue rails are gone, the back wall moved
  to z -8.8).  Cars 8 - 12 -> 10 - 12 (9 - 11 AIs), the UV bars and the bulb rows follow the floor (`UV_Z`), the Lissajous idle paths use the whole floor.  `bumper.js`: AIs head for the emptiest of three
  random spots (spread), hunting is 40 % (was 55 %) and starts after 5 s, no car spawns in the 3.4 m strip in front of the player's start.
- **Footprint note for A's solids table:** the hall still lies inside the L pitch (x +-14.4, z -8.9 .. 8.4, padSlab 29.6 x 17.9); nothing outside the old pitch rectangle.  Perf: 200 draws / 264k triangles in the ride (budget 220 / 300k).

## 4. Bayern-Kurve (`models/rides-small.js`, `rides/catalog.js`)
**Cause.** The model was a flat ring of 12 cars that faced +tangent while the ring turned -t (backwards): "you ride the wrong way", and no hills, no banking.  The seat frame was the car's flat frame.
**Fix.** A closed circular track (R 5.35 m) on steel legs, three hills of 0.55 m (the track rises and falls by 1.1 m) and a banking that swings between 0.27 and 0.63 rad towards the pavilion,
`bayernAt(angle)` gives centre, forward (follows the slope), up (leans into the curve), right and bank.  Eight bobsleigh-style cars (two rows of seats with high backs, flag-coloured shells, head and tail lights,
riders at L3) are animated parts `car0 .. car7` that the model's `animate` puts on the track (position + basis from `bayernAt`), moving in the direction their noses point.  The seat rig reads the front
seat of car 1 (`ud.rideSeat`, anchors inside the car parts): the camera looks along the track from the first frame, rises and falls with the hills and leans with the bank.  Comfort: `assist: { pitch 0.3, roll 0.45 }`
in `catalog.js` (the screen leans about 20 degrees at most, up to 27 measured), reduce motion adds the usual extra levelling + slower smoothing.
Checks (flow `fouer-rides`): looks along the direction of travel (forward . velocity 0.99), height range >= 0.6 m, roll 10 - 32 degrees, track hills >= 1.0 m, banking 0.2 - 0.7 rad; perf 174 draws / 251k triangles.
Montage with the photos in `website-overnight/reports/fouer/feedback-b/bayern-vs-photos.jpg`.

## 5. Initial look direction of the other rides
Probe (`rideprobe`: first second of every seat ride, forward . velocity / forward . direction to the centre): Kids' carousel, gold carousel, Happy Sailor 1.0, Kettenkarussell 0.86 (outwards-forward, chairs swing out),
Break Dance 1.0 towards the centre, Jules Verne swing 1.0 towards the tower, Take Off / Booster / Infinity look outwards from the arm (the real seat orientation, kept), **Musik Express looked backwards (-1.0)**:
its ring turned `-t` while the cars face +x of their radial frame ("like the real one" in the old notes).  The ring turns `+t` now; the camera starts looking forward.
The flow `fouer-rides` checks it for the carousels, Bayern-Kurve, Happy Sailor, Musik Express (forward), Break Dance and the Jules Verne swing (centre).

## Verification (this tree, 24 Oct)
- `node pb/fouer/harness.js`: PASS, 1484 checks (about 25 s; with A's solids checks).  `node pb/fouer/harness-rides.js`: 190 ride checks.  `python3 scripts/check_site.py`: no errors; `cv_head.py`: PROBLEMS: 0.
- Flows: `fouer-world`, `fouer-models` (new: floating audit + front rule on the real THREE geometry), `fouer-big-models`, `fouer-rides` (all 18 rides: look direction, Bayern hills / bank, scooter wheel share / riders / floor) PASS.
  `fouer-access` passes every check (including the new front-to-walkway check on the real fair: 250 footprints, 0 problems; walk 152 draws / 244k triangles) except "the crowd lanes form one connected network"
  (69 nodes, 4 reached), which comes from the walk collision work: with the old `walk.js` served for the same page the crowd graph is connected (64 / 64 nodes).  `fouer-game` / `fouer-launch` /
  `fouer-migration` / `fouer-walk` were not run to the end here (`run_all.mjs fouer` hung in `fouer-game` on the loading-screen steps of the parallel change).

## Files
`layout.js` (front rule, validator), `models/npc.js`, `models/tents.js` (`closed` tent, porch valance), `models/props.js`, `models/clutter.js`, `models/kit.js` (pennants, dressEdge, raw sink), `models/stallkit.js`,
`models/stalls.js` (fesch, schiess), `models/rides-small.js` (Bayern-Kurve, Musik, Take Off), `models/hall-tent.js` (chandelier rod), `models/hall-scooter.js`, `rides/drive.js`, `rides/bumper.js`,
`rides/catalog.js`, `float-audit.js` (new), `harness-access.js`, `harness.js` (negative tests), flows `fouer_models.mjs`, `fouer_rides.mjs`.

## Known gaps / ideas
- The audit does not look at the big-kit rides; their pieces hang from pivots.  The steam puffs of the Bierzelt (L3) rise through the air on purpose.
- The fair has fewer shop fronts than before (86 vs 180); the back-of-house lots in the interior are caravans / crates / closed tents, with no shop front.  If it feels too sparse at eye level, a second row of
  stalls facing a new service lane would be a data edit in `layout.js`, not a packer change.
- The crowd lanes flow check `fouer-access` "the crowd lanes form one connected network" fails in this tree for another reason than this change (the mask of the walk collision work): with my model files
  swapped back to origin/main the graph is just as disconnected.
