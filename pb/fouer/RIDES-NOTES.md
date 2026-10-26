# Rides wave: "Make more attractions rideable" (23 Oct 2026)

Every ride attraction of Schueberfouer Tycoon can now be ridden from the walk (👣). Before: only the Riserad (gondola) and the coasters (front-seat `ridePath`). Now 19 attractions: the Riserad, three coasters, the flume, the ghost train, the bumper cars, and 12 seat rides.
Flow: `fouer-rides` (registered in `scripts/flows/run_all.mjs`). Pure logic: `pb/fouer/harness-rides.js` (190 checks, also called from `harness.js`). Screenshots: `website-overnight/reports/fouer/rides/`.

## Files
| file | what |
|---|---|
| `rides/catalog.js` | pure: the 19 ride definitions (`RIDE_DEFS`: kind, duration, spin-up / cruise speed, sound, flag, icon), `RIDE_FLAGS`, `speedAt`, `createProgram` (the ride clock), `swingAngle`, `rotorTilt` |
| `rides/rigs.js` | the seat rig (any model with `ud.rideSeat`), the track rig (coasters, flume), `hookClock`, `levelAssist` (comfort), `createSmoother` |
| `rides/anchors.js` | `attachSeats` (invisible Object3D seats inside the animated part groups), `frameOfObject`, circle helpers |
| `rides/bumper.js` | pure: bumper-car physics (circles, restitution, barrier, AI, bump events with a cooldown) |
| `rides/drive.js` | the Autoscooter rig (input -> car 0, the model's cars follow `ud.drive`, the festive hall, the cockpit, sparks, hits, music) |
| `rides/mesh.js` | merged vertex-colour / textured mesh builders and the procedural canvas textures (steel floor, airbrush murals, cobweb, vortex stripes, glow) used by the two interiors |
| `rides/ghost.js` | the Geeschterbunn rig: path, interior (decor, props, doors), scares |
| `rides/fx.js` / `rides/sound.js` / `rides/settings.js` | DOM overlay (info pill, strobe, spray, vignette, black, hit flash, hints, score) / procedural ride sounds on audio.js's context and mute / the reduce-motion option |
| `ride.js` | orchestration: board, fade, rig, flag + stamp + Spaass, abort; the Riserad / Probefahrt code is unchanged |
| `walk.js` | one generic ride target for every ride (`kind: "ride"`), `driveControls()`, arrow keys steer the car, a passive ride hides the stick, tiles stay on except at the wheel |
| `models/rides-small.js` | seat anchors for kanner, gold, kette, bayern, happy, break, musik, takeoff (+ kette swing hook) |
| `models/towers.js` | analytic `ud.rideSeat.frame` for jules, hangover, booster, infinity (their seats are CPU-skinned, there is no scene node to attach to) |
| `models/hall-scooter.js` | `ud.drive(j, matrix)` hook, `ud.floor / floorY / ceilY` |
| `game.js` / `save.js` | `game.fun(ride)` (the Spaass buff), flags up to 32 characters (was 8) |
| `ui.js` / `ui.css` / `i18n.js` | the reduce-motion chip in the settings menu, the ride overlay CSS, 11 new strings per language (lb / de / en), `act.leave` = "Ausstäigen" / "Aussteigen" / "Get off" |

## Rideable attractions (button "Fueren" / "Fahren" / "Ride" appears at the front, within 4.2 m)
All rides: tap the round button (or E / Enter / Space / a mouse click) -> 0.4 s fade -> ride -> fade -> back where you stood. Drag looks around (relative to the seat). Red round button "Ausstäigen" or Esc gets off early (no stamp). The info pill shows the name, the time left and a bar.

| attraction | how it works | what you see / feel | ~s |
|---|---|---|---|
| Kannerkarussell, Gëllent Karussell (`kanner`, `gold`) | camera on an odd horse (no L3 rider) in the bobbing group B, eye above the head, a little beside the pole; the rotor spins up from rest | up and down (bob 0.2 m) while the fair turns past; the organ voice of audio.js is right next to you | 46 |
| Kettekarussell (`kette`) | seat anchor in the rotor; the camera is shifted by the chair swing (`uSwing`, set from the rotor speed: `atan(w^2 r / g)`, up to 0.8 rad) and the canopy tilts (`rotorTilt`) | chairs fly out as it speeds up, the view is turned 30 degrees outwards over the plaza | 54 |
| Bayern-Kurve, Musik Express (`bayern`, `musik`) | seat in the rotating ring (Musik: ring B, backwards like the real one, the ring rises and falls) | the next car, the whole fair streaking past | 50 / 54 |
| Schëffskarussell (`happy`) | odd boat (bobbing group B), looks along the bow | the boats bob while the deck turns | 50 |
| Break Dance (`break`) | seat on a platform at the end of an arm, facing the platform centre; the rotor wobbles | platform, hub and the skyline, fast | 56 |
| Take Off (`takeoff`) | outer seat of the tilted spinning arm | the horizon tilts, you look over the fair from 6 m | 54 |
| Tuerm-Schaukel (`jules`) | analytic seat from the model's phase (`rig`: theta, y, w): the crown rises to 62 m while the swing flies out; the camera looks towards the tower (comfort assist flattens pitch and roll) | the lattice tower, the other swings flying, the fair and Luxembourg below | 50 |
| Falltuerm (`hangover`) | analytic seat on the saucer ring; the ride time is mapped on the model's cycle: slow lift (15 s), 4 s pause at the top, free fall, brake, bounce | the city from 80 m, whoosh + scream at the fall, `shake` + clank at the brake | 30 |
| Booster, Pendelarm (`booster`, `infinity`) | analytic seats on the pod of the 25 m arm / on the spinning ring at the end of the 21 m arm | upside down over the city, through the A-frame towers | 44 / 46 |
| Wëll Maus, Looping-Bunn, Alpebunn (`maus`, `looping`, `alpina`) | `ud.ridePath` as before (W6) but the model clock starts 2.2 s before the train leaves the station (no more waiting), the eye sits at the nose of the front car | lift hill, the whole fair from the top, drops, the loop | 40-50 |
| Waasserbunn (`splash`) | the boat on its channel via `ridePath` on the same clock | the lift, the turn, the chute, the splash: 110 drops run over the lens, shake, whoosh, scream | 40 |
| Geeschterbunn (`geister`) | a rig of its own, see below | dark room, scares, doors, the balcony in daylight | 44 |
| Autoscooter (`scooter`) | you drive car 0 | see below | 60 |
| Riserad (`wheel`) | W6 ride, point of view fixed 24 Oct 2026 (see below): you sit in the gondola, 2 revolutions, stamp "Op der Spëtzt" | the bench, the safety bar and the window frames around you, the fair through the front window | 47 |

### Riserad: the point of view is inside the gondola (24 Oct 2026)
Ian: "In the Riserad, you are not in a cabin but outside." Cause: not a wrong frame (the anchor was right after the pitch rotation), but two decisions of the W6 ride: the camera was pushed `EYE_OUT = 2.1 m` out of the hidden gondola (so the rim and spokes would not fill the view) and the anchor's eye / floor did not match the mesh (eye 0.7 m below the hanger = under the roof edge, floor at -1.8 while the floor pan lies at -2.325). With the cabin hidden nothing was left around the camera.
- `models/wheel.js`: `GONDOLA` (the cabin box relative to the hanger: floor -2.325, roof edge -0.3, x +-1.1, z +-0.8625, glass planes x +-0.93 / z +-0.68). `gondolaAnchor(i)` now has the **seated eye** (1.2 m above the floor, x = 0, z = -0.3 on the back bench), the real floor, `box` (the cabin's world Box3) and `dims`; `ud.gondolaStyle` gives the gondola colours (body / band / roof / trim / gold).
- `rides/cabin.js` (new): the first-person cabin, two meshes (vertex colours, MeshBasicMaterial, dimmed by the night factor, no culling): floor + mat, kick panels, window pillars + mullions (none in the middle), fascia + roof edge, bench along the back and a short one on each side, the chrome safety bar across the front window, the door on the right wall (frame, latch, handle), a small lamp under the front fascia. `ride.js` places it on the anchor every time the camera frame is read (so the camera and the shell can never differ), sets the near plane to 0.08 (restored afterwards), removes and disposes it in `finish`.
- Look: `ride.lookLimits` (wheel only) -> `walk.applyCamera` clamps yaw to +-100 degrees and pitch to -48 .. +55 degrees. Reduce motion: the wheel cruises at 4x instead of 6x (`wheelSpeedAt(p, calm)`, about 60 s instead of 47 s). Boarding from the walk and from the builder's "Fueren" both go through `begin`; exit is unchanged.
- What you see: through the front window (outward, toward the field) the fair; the rim and the spoke trusses pass 0.2 - 1 m outside the glass, so in the lower half of the turn and at the sides a big yellow / white band or a lattice crosses the view for a moment (that is what the real wheel does too).
- Flow (`fouer_walk.mjs`, the wheel section): every frame of the ride the camera is inside the gondola's `box`, on the anchor's eye (< 1 mm), the shell on the anchor, seated eye height 1.1 - 1.3 m, centred, between the two rims (|z| < 0.6 where the rim starts at 0.9) and > 0.6 m from the nearest rim / spoke vertex; look limits; near plane restored; shell removed. `fouer_walk_a.mjs` checks the builder start too.

### Geeschterbunn
**Rebuilt 26 Oct 2026 (Ghost wave) into a proper 10-scene dark ride: see `pb/fouer/GHOST-NOTES.md` for the full scene list, timings, performance numbers and
screenshots.** Summary for readers of this file: the castle is still a solid hall (carts vanish at painted doors), so the ride still brings its own interior
while it runs (added to the model group, removed afterwards; textures and geometry disposed). New this wave: ten distinct scenes (coffin + waving vampire,
portrait gallery with following eyes, mirror room with a looming ghost, mad-scientist lab, library of flying books, a stretching column, cobwebs with a
lens puff, a ghost that rushes the cart and bursts into sparkles, a skeleton band at the organ, a fake-out door finale into daylight), each with a build-up,
a pop and a release; the cart turns gently towards each scene (levelled, capped at ~26°) and the ride dashes between scenes and nearly stops at each one;
black-light UV colours, flickering lamps, ambient thunder through the windows, floor fog and dust in the light beams; **the main camera is switched to the
ride's own dedicated layer while the cart is sealed inside the castle, so none of the fair/world/crowd is drawn at all for that span** (nothing of it is
visible through solid walls anyway) — the ride's own geometry is the entire cost there, well inside a 120-draw budget. Outside (the approach, the balcony,
the gate) the camera is back on the normal layer and the real fair is the backdrop, same as any other ride. Outside the ride, in walk mode, the facade now
has one animated figure (a pale wraith waving from the clock-tower window) and the ground-gate doors bang open and shut on a loop (`models/hall-geister.js`
`buildExtras`).
- **Cost**: sealed inside the castle, the ride's own geometry (shell, floor, decor, 4 murals, light cones, haze/fog/dust, red glow, webs, up to ~5 scene
  props at once, 8 door leaves, the hood) peaks well under the 120-draw budget — see GHOST-NOTES.md for the measured number. Outside the castle the ride
  shows the ordinary fair, same budget as every other ride (DESIGN 5: walk ≤ 220 draws / 300k triangles).

### Autoscooter (drive)
WASD / arrows / left joystick (up = throttle, right = steer right); the arrow keys steer here and do not turn the view; drag still looks. `rides/bumper.js`: circles of 0.95 m, accel 7.5 m/s^2 up to 6.4 m/s, the tyres grip sideways, steering only while rolling, restitution 0.72 (cars) / 0.5 (barrier), 7-11 AI cars (about half hunt the nearest car), reported bumps need an impact > 1.1 m/s and a cooldown of 0.4 s per pair.
- **Your car in first person** (car 0 of the model is hidden): sloping bonnet with a stripe in the car's colour, a dashboard, the rubber bumper ring (rounded rectangle with a chrome band), a tilted steering wheel with a gold hub and spokes, your two hands in orange sleeves on the wheel, the pole behind you.
- **The hall**: a dark-steel floor texture (1.6 m plates with seams and rivets, scuffs and black rubber arcs, coloured UV pools, long sheen streaks of the three light bars and dots of the bulb rows), an airbrush wall (planets, palms, stars) and a mirror wall (diagonal sheen panels), three rows of festive bulbs under the ceiling and a row on the barrier rail (one additive Points mesh), a dance beat (kick, clap, hats, bass, arpeggio at 126 bpm, procedural, through the mute) on top of the hum.
- **Sparks**: the flickering flashes at the poles under the ceiling grid are bigger (1 m soft sprites); when your own pole sparks, the top third of the screen flashes blue-white (`rd-spark`). Per player bump: bump sound, zap, shake, red edge flash, "Stéiss: n" counter. 60 s timer.

### Infinity (Pendelarm)
The eye sits just outside the ring's rim (radius 3.95 m, 1.25 m above the ring plane) and looks 14 degrees up out of the ring plane, so the ring's plates and seat backs stay below the view at every swing angle: the screenshots show the sky, the A-frame, the axle and the fair below.

## Comfort and options
- Seat frames are smoothed a little (`createSmoother`, tau 0.07 s; 0.28 s with reduce motion), seats that swing out are leveled (`levelAssist`: jules pitch 0.85 / roll 0.7 plus 12 degrees down, kette 0.3 / 0.3).
- Shake (`fx.shake`) comes only from events (the brake of the drop tower 1.0, bumps 0.2-1.0, doors 0.25-0.35, the splash 0.9) and decays at 1.6/s.
- **Reduce motion** (settings menu, "Fahrten: weniger Wackeln" / "Rides: less shake", stored as `pb_fouer_reduce_motion`, default = `prefers-reduced-motion`): shake x0.3, strobe x0.35, vignette x0.6, head-bob off (bumper car), more smoothing and leveling, spin cruise speed only 45 % of the way above 1x, tower cycles at 80 % (the ride lasts 25 % longer). Read once per ride.
- FOV stays the walk's 70.

## Stamps, flags, "Spaass"
- Each ride has one flag letter in the save's `ea` (`RIDE_FLAGS`: k o e s b h d m t j v x i u l a w c; r = Riserad as before, g and p unchanged). The first completed ride (>= 90 %) sets the flag and shows the stamp card ("Rode the Kids' carousel!", icon of the ride). An early exit gives nothing. **`ea` may now be 32 characters** (was 8: 3 + 18 flags would not fit); `save.js` accepts `[a-z0-9]{0,32}`, `game.setFlag` stops at 32. An old client (cached page) would drop a longer `ea` as invalid when it reads such a save.
- **Spaass** (`game.fun`): every completed ride gives x1.03 income for 2 minutes through the same `ctx.bonus` as Foodie (they multiply); one buff at a time, riding again only refreshes it. Chip in the walk HUD next to Foodie, toast "Spaass-Bonus: +3 % fir 2 Minutten". Nothing else in the economy changed; offline credit ignores it.

## How a ride runs (for the next person)
- `ride.board(i)` -> `begin(id, ud, pitch)`: fade out, make the pit live (`ensureLive`), `createXRig(env)`, `rig.start()`, fade in. `rig.update(dt)` runs in main.js's frame loop **after** `fair.update` and **before** `walk.update`; the rig holds a smoothed `frame` {position, forward, up} that `walk.applyCamera` uses as the base orientation (the drag-look is added on top). `finish()` restores everything while the screen is dark.
- **The ride clock**: the fair layer keeps calling `ud.animate(time, dt, night)` every frame; `hookClock(ud, clock)` swaps `ud.animate` for a wrapper that passes the ride clock instead (spin-up, cruise, spin-down; towers: a mapped cycle; coasters: starts 2.2 s before the departure). Restored in `stop()`.
- **Model contract** (new, optional): `ud.rideSeat = { count, preferred, frame(i, out) }` with `out = {position, forward, up}` in world space from the current pose (`attachSeats` does it for w3 models; towers compute it from their phase). `ud.drive = null | (j, matrix) => bool` (hall-scooter). `ud.ridePath` / `ud.run` / `ud.tImpact` (coasters, flume) as before.
- A tall ride sets `crowd.setMode("ride")` (the whole crowd spread over the fair); low rides keep the crowd around the walker. Only the Riserad switches the tiles off.
- Test hooks (only with `?fouerDebug=1`): `__fouerGame.ride.{info() (cam, rig debug), setTestSpeedup(k) (rigs get dt*k in sub-steps of at most 0.12 s), board(i), canRide(i), fx, sound}`, `walk.driveControls()`, `walk.setInputKeys([...])`.

## Tests
- `node pb/fouer/harness.js`: 1118 checks pass (190 of them the rides: every ride attraction has a ride, unique flags, speed profiles and programs (40-60 s), the drop-tower map, comfort helper, bumper physics (throttle, steering, grip, 70 s random driving stays inside, head-on and barrier bounces, bump cooldown, determinism), the ghost path (four doorways in / out / in / out, 92 m, 69 % inside, level frames), 21 flags fit one save and survive the codec, Spaass and Foodie multiply and expire). `node pb/fouer/harness-rides.js` runs only these.
- `node scripts/flows/fouer_rides.mjs` (`fouer-rides`, iPad portrait, the full fair at level 3, medium, evening; ~10 minutes): for each of the 18 attractions (the wheel keeps its W6 flow): the entrance offers the ride, the button says "Fueren", a **touch tap** boards, an early Esc leaves without a flag and puts the walker back, then the fast-forwarded ride (x6): the camera moves (path length), stays within the ride's reach, never underground, the expected height change, every frame finite / unit / orthogonal, the up vector sane, perf <= 220 draws / 300k triangles, the ride ends by itself, the walker is back at the entrance to 1e-6 m, the flag is stored exactly once, the stamp card was shown, no leftovers in the scene; plus: kette chairs fly out, drop tower lift / pause / fall / brake + shake, flume splash drops, ghost train inside and outside + 7 scares + doors + strobe, Autoscooter (W drives, D / A steer, arrows do not turn the view, bumps counted, cars stay inside, AI cars drive, the timer ends the ride, flag once), the Riserad button, the reduce-motion chip and its effect, zero console errors (our own `[fouer]` warnings count).
- Not mine, seen in `run_all.mjs fouer` while the Looks agent was working in the same tree: `fouer-models` (lukas stall footprint +0.21 m) and `fouer-launch` (`bx is not defined` in `models/plots.js:172`) failed.
- `fouer-walk`'s coaster check was adjusted (`kind` "ride" / "track" instead of "coaster").

## Numbers (headless Chromium, iPad 820 x 1180, `fouerQ=medium`, full fair at level 3, evening; DESIGN 5 walk budget 220 draws / 300k triangles)
Max over each ride (sampled every 20 frames, tiles on except at the Riserad); **411 flow checks, all pass** (`fouer-rides`), `fouer-walk` (coaster check adjusted), `fouer-game`, `fouer-migration`, `fouer-world`, `fouer-big-models` pass.
| ride | draws / triangles | | ride | draws / triangles |
|---|---|---|---|---|
| kanner | 176 / 279k | | hangover | 88 / 175k |
| gold | 171 / 267k | | booster | 174 / 267k |
| kette | 159 / 255k | | infinity | 161 / 262k |
| bayern | 171 / 270k | | maus | 185 / 272k |
| happy | 172 / 272k | | looping | 142 / 223k |
| break | 174 / 272k | | alpina | 139 / 220k |
| musik | 159 / 254k | | splash | 149 / 241k |
| takeoff | 165 / 263k | | geister | 208 / 286k |
| jules | 177 / 271k | | scooter | 182 / 272k |

All inside the medium walk budget (220 / 300k). The ground-level rides sit near the budget because the walker stands in the middle of the fair (the walk's own start spot is 290k, see W6 notes): a ride adds nothing heavy (no extra draws except the ghost train's about 14 and a Points mesh for the bumper-car sparks). Keeping the tiles on for the towers / coasters / flume cut their triangles by 20-25 % against the first version (booster was 302k with the merged batches). The ride camera does no heavy work: one world-matrix update of an anchor or two matrix products per frame.


## Screenshots (`website-overnight/reports/fouer/rides/`, `fouer-rides.<ride>-<progress>.png`) and verdicts
| file | moment | verdict |
|---|---|---|
| `kanner-40`, `gold-40` | on a horse, looking over its neck, a rider on the next horse | GOOD: reads as a carousel ride (blocky horse); the pole is beside the view |
| `kette-45` | chairs flying out, view turned over the plaza (crowd, lamps, tents) | GOOD |
| `bayern-45`, `musik-50`, `happy-45` | in the ring, the next car ahead; the fair streaking past | OK: the next car's seat back is a big dark block in the lower middle; the surroundings (Riserad, Booster, Break Dance) are great |
| `break-50` | on the platform, hub and skyline | OK |
| `takeoff-50` | tilted horizon over the whole fair from the arm | GOOD |
| `jules-50` | in the swing at 60 m, looking at the lattice tower, the other swings flying out, the Riserad and Kirchberg below | BEST SHOT |
| `hangover-35`, `hangover-83` | rising / at the top before the fall: Luxembourg and the fair from 80 m | GOOD (the saucer roof's edge is a dark band at the top, true to the model) |
| `booster-45` | upside down over the city at 55 m | GOOD |
| `infinity-34`, `infinity-60` | the fair from above at a steep swing, the A-frame with the axle against the sky | GOOD (the ring no longer fills the view) |
| `maus-50`, `alpina-50`, `looping-43` | on the lift hills: structure, the whole fair, the Riserad | GOOD, looping-43 is the best (the Riserad from above) |
| `splash-80`, `splash-87` | drop and splash: drops on the lens | GOOD: clearly a log flume |
| `geister-19`, `geister-47` | spider on its thread in a violet cone, cobwebs, the airbrushed vampire with red lamp glow; the moon mural in a red cone with a strobe-lit skeleton | GOOD: reads as a dark ride; flat-shaded props, no real lighting |
| `scooter-drive`, `scooter-bump` | first person in the car: steel floor with sheen, the other cars with poles and flags, bulb rows, red / white barrier, your hands on the wheel; against the mirror wall | GOOD: clearly a bumper car, the floor is no longer a void |

Overall: each ride clearly feels like its attraction in a still; the passive rides from 6-80 m show the Fouer from places the builder camera never goes. What a still cannot show: the motion (spin-up, swing-out, the fall), the screams and the doors.


## For the others / open gaps
- **fair.js (Looks' file): a rebuilt pit on an unchanged live set stays frozen.** `clearPit` sets `pit.live = false`, `lodUpdate` only re-evaluates when the key of the live set changes, so a new attraction (or an upgrade) on a pit that was live is not animated until the live set changes. The rides work around it (`ensureLive` calls `fair.setQuality(fair.quality())` to reset the key); the builder view has the same bug for plain upgrades. A `lastLiveKey = ''` in `applySpec` fixes it.
- The kette's swing shader (`materials.js`, Looks' file) lowers a chair by `depth * (1 - cos)` when it flies out (a real chair rises). The ride raises the camera instead; the chair meshes (not in view) still sink, so the chairs hang 0.8 m higher than in W3 to stay above the deck.
- Riders on the other seats: no extra figures (the models already seat figures at L3+; the ridden seats are chosen without one). The crowd exports no figure geometry for it.
- Sound is procedural and untested by ear (headless): bed (hum + air rush by speed), screams, whoosh, clank on lifts, thud / bump / zap / splash / door bang / stinger. The organ / beat / rattle of each attraction is audio.js's positional voice (the camera is on the ride, so it is loud and right).
- The geister interior is cheap, flat-shaded (no real light on the props, the cones are additive); the ride path is not the model's cart path (the model's own carts keep their lap outside).
- The booster pod of the low quality (far LOD only) does not counter-spin, the camera then does not either.
- Real-iPad frame time of the ride overlays is unverified (headless numbers only); the overlay writes 5 style opacities only when they change.
- `pb/fouer.html`: `ui.css?v=4`, `main.js?v=4` (the Looks agent may bump the same two lines).
