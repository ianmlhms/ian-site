# W6 "Walk": notes (23 Oct 2026)

The 👣 button now does what DESIGN 5 promises: a real first-person walk through the fair, with a crowd, a soundscape, eating, the Riserad ride and a coaster point of view. Everything is on top of W5's game (`pb/fouer.html`); `?fouerDebug=1` exposes `window.__fouerGame.{walk, crowd, audio, ride, mask}` for the flows.
Flow: `fouer-walk` (registered in `run_all.mjs`). Screenshots: `website-overnight/reports/fouer/w6/`.

## Files
| file | size | what |
|---|---|---|
| `walk.js` | 41 KB | pure part (harness-tested): `createMask` (walkable region + circle-vs-box collision), `circleVsBox/Obb`, `subtractBox`, pitch helpers; controller `createWalk` (input, camera, interaction targets, eating, photo, HUD DOM, tram obstacle) |
| `crowd.js` | 47 KB | pure part: `crowdTarget`, `buildGraph`, `edgePoint`, `queueSlot`, `figureArrays`, `makeLook`; `createCrowd` (instanced figures, dots, behaviour, queues, Hämmi) |
| `audio.js` | 35 KB | pure part: `organPhrase`, `pickVoices`, `voiceGain`, `voiceKindFor`; `createAudio` (one context, master + limiter, ambient bed, 6 attraction voices, tram, rain, fireworks, one-shots) |
| `ride.js` | 10 KB | Riserad ride (2 revolutions at 6x, pioneer Probefahrt on a temporary wheel), coaster POV via `ridePath` |
| `sfx.js` | 2 KB (was 3) | the five UI blips now run on audio.js's context (folded, same API) |
| `main.js` / `game.js` / `ui.js` / `ui.css` / `i18n.js` | about +90 / +52 / +10 / +58 / +96 lines | wiring; Foodie + flags in game.js; sheep tap, foodie pill, no coin pops in the walk in ui.js; walk HUD CSS; 31 new strings per language (lb / de / en) |
| `harness.js` | +170 lines | 80 new checks (817 in total) |
| `scripts/flows/fouer_walk.mjs` | 36 KB | the flow; `fouer_game.mjs` got its 2 lines for the real walk HUD instead of the placeholder bar |
| `pb/fouer.html` | 2 refs | `ui.css?v=2`, `main.js?v=2` (W7 still owns the sw.js cache) |

## Controls
- **Desktop**: W A S D or arrows up / down move (A = left, D = right, the v1 swap is gone), arrows left / right turn, Shift runs, mouse drag looks, `L` toggles pointer lock, `E` / Enter / Space / a click uses what the round button shows, `P` photo, `Esc` leaves (a ride: gets off first).
- **iPad / phone**: left-thumb joystick (the push scales the speed, the last 7 % of the stick = run), drag anywhere else on the canvas looks, one round button appears only near something useful (stall: Iessen, Riserad / coaster: Fueren, game stall: Spillen, Hämmi: Streelen, pioneer Probefahrt), 📷 photo, "Zeréck" exits. A tap on Hämmi bleats in the walk and in the builder view.
- Eye 1.65 m, FOV 70, pitch limit +-75 degrees, near plane 0.2 (restored to 1.5 / FOV 32 on exit). Walking speed is **2.0 m/s, run 4.0 m/s**, a deliberate change from DESIGN's 1.4 / 3.0 (the site is 300 m long; 1.4 m/s is three and a half minutes from the Riserad to the portal).
- The walk starts 7.5 m in front of the most recently built or upgraded attraction, looking at it (fallback: the first built, else P01). Exit restores the exact builder camera (rig + camera position / orientation / FOV / near, checked to 1e-3 m in the flow).
- Walkable: the Glacis polygon + the open gates (gates open with the star count like the barriers) + the Allée Scheffer ribbon (reached through the NE portal and the Theater stop). Solid: built / locked pitches (open ones are walkable, the Riserad keeps a boarding corridor from its platform to the front edge), the NPC stalls (from the filler's occupancy grid), the camelots beside the rails, the tram (a moving box).

## Crowd
- One `InstancedBufferGeometry` figure of **74 triangles** (legs, torso, arms with sleeves, head with hair, a held snack), colours per instance (shirt / trousers / hair / skin / item), walk cycle + bob in the vertex shader, fog and day / night light from the env's hemisphere + sun: **1 draw call**. Beyond 40 m (walk) / 110 m (ride) / 175 m (builder) a guest becomes a coloured dot (1 draw call). Hämmi: 1 draw call, ~570 triangles.
- Counts: low 70, medium 150, high 320 at full economy; the economy's guest rate `lambda` scales it from 52 % to 100 % (`crowdTarget`); the builder view shows 60 % of that. Families, couples, friends, kids (scale 0.5-0.66), some carry a snack for 20-40 s after a food stall.
- Behaviour: a graph from the real alley centre lines (Haaptallee, Fressgaass, four cross alleys, the Allée Scheffer street, 45 edges, ~1.5 km) built from the walkable mask, two lanes per alley (right-hand traffic, widths clamped by the free space), guests follow smoothed "ideal points" so nothing teleports; they leave the lane for a stall or ride with a probability from the economy's demand (`row.demand`), stand there 3-14 s, then carry on. Overloaded attractions (`row.problem`) get a real row of up to 15 guests 3 m in front (at most 30 % of the crowd), facing the attraction. In the walk the crowd is concentrated around and in front of the walker (log-uniform 8-115 m), guests behind are recycled ahead out of sight; guests step aside for the walker.
- The red queue clocks of W5 are not shown in the walk (CSS + `updateCoins`), they stay in the builder view.
- Hämmi walks the Haaptallee, 0.5 m/s with pauses; tap = bleat (sound, hop, toast). **The sim has no daily-gift function**, so the gift is cosmetic (nothing is paid, nothing stored).

## Audio (all procedural, nothing downloaded)
One `AudioContext` (created at the first tap), master gain -> compressor/limiter, three buses (ambient / voices / sfx). The arcade mute (`pb_muted` + `arcade:mute`) and the game's own `pb_fouer_sound` silence it and suspend the context; it resumes when the tab comes back.
- Ambient bed (30 % in the builder, 100 % in the walk): crowd murmur (two bands of brown noise with slow swells, level follows the nearby guests), laughter and kids' shrieks (formant-filtered sawtooth pulses, random pan), generator hum (50 Hz + harmonics), rain on canvas (noise + patter, level = the sky's rain), tram (rumble + whine on a PannerNode at the tram, bell ding-ding at departure, two-tone chime at arrival), distant fireworks on the closing night.
- Attraction voices, max 6 nearest, each through an equal-power `PannerNode` (inverse distance, per-kind reach 24-95 m): carousel organ (a generated 8-bar waltz tune per carousel, oom-pah bass, vibrato lead), calliope on the Riserad, tent band, dance beat (kick / hat / bass / arp) for Musik Express / Break Dance / Take Off, scooter zaps + bumps + buzz, coaster rattle + scream swells (period = the model's cycle), flume splash, ghost train drone + creaks + laughs, tower whoosh + pneumatic hiss, shooting-gallery pops, Lukas thump + bell, lottery plinks, fryer sizzle at every food stall.
- One-shots: eating crunch, bleat, shutter, game stalls, wheel clunk + bell, ride wind.
- Not testable headless: how it sounds. The flow checks the graph (running context, ambient layers, <= 6 voices, 0 errors, mute).

## Eating, Foodie, flags
- At a food stall (front side, within 3.4 m) the round button shows "Iessen": 2 s animation (a hand holding the item rises from the bottom, steam, bite sounds), a thought bubble in the chosen language (9 foods), sparkles at the stall.
- **Foodie** is the economy's own `ctx.bonus` (sim.economy already multiplies income by it), **no change to sim.js**: `game.eat(item)` keeps up to 3 `{item, until}` entries (3 min each, wall clock), `bonus = 1.05^stacks`, one buff per distinct food per session (a repeat is "known", a 4th food while 3 are active is refused), expiry in `game.update`. HUD chip in the walk, pill in the builder banners. Offline credit ignores it (neutral ctx).
- `game.hasFlag / setFlag(ch)`: one letter in the save's `ea` string (max 8 chars, the save codec already allows `[a-z0-9]`): `r` = "Op der Spëtzt" earned, `p` = Probefahrt used (`g` was the starter gift).

## Rides
- **Riserad**: interact on the boarding platform -> fade -> the camera sits in the hidden gondola's seated eye inside a first-person cabin shell (since 24 Oct 2026, see RIDES-NOTES; until then it was 2.1 m in front of the gondola, outside the rim), the wheel eases up to 6x, 2 revolutions (~47 s with the ease in / out, `wheelSpeedAt`), free look by dragging (relative to the upright cabin frame), eases down to a 1.5x landing, fade, back on the platform at the same spot, the wheel's speed restored. First completed ride: stamp card "Op der Spëtzt" + flag `r`. The crowd switches to its "ride" mode (full crowd spread over the fair) while you are up there.
- **Probefahrt**: a pioneer (`pi = 1`) without a built wheel, flag `p` unused, standing at the Riserad pitch's front gets "Probefahrt (gratis)": `fair.setPitch` puts a temporary level-2 wheel on the pitch, 3 revolutions (~62 s), then the previous spec (the padlock stall) is restored (also when aborted); only a completed ride sets `p`.
- **Coasters** (`maus looping alpina splash geister`): the button at the front, the camera follows `ud.ridePath(fairTime, {train: 0, car: 0})` for one lap (the fair time is mirrored in main.js, `fairTime += dt` next to `fair.update`), `Esc` / the red button gets off. The train may still stand in the station for the first seconds.

## Hooks used from files W6 does not own (for the polish agent: please keep them)
- `fair.baseInfo.npc.grid / gridDims` (`[NU, NW, CELL, U0, W0]`) and `CORRIDORS` from `models/npc.js`, `ENTRANCES` from `models/props.js`, `sampleLane(world, step)` from `models/fair.js`. The mask reconstructs "marked and not reserved by a pitch / corridor" = NPC stall, with the same rounding as `grid.mark`. If `buildNpcFair` changes its marking, the cells and the mask drift.
- `fair.pits.get(id).near.userData.{ride, gondolaAnchor, ridePath, cycle, setLOD, setAnimated}`, `fair.setPitch / getPitch / flush`, `world.parts.tram.{debug.state, track.at}`, `env.hemi / sunLight / getState()`.
- Wish list (not needed for W6 to work): (1) `buildNpcFair` could return `stalls: [{u0, u1, w0, w1}]` (exact footprints instead of 2 m cells, which put an invisible wall up to 1-2 m in front of some NPC stalls); (2) `props` could return its lamp posts / bins / benches as small solids (the walker walks through lamp posts); (3) the merged batches in `fair.js` have `frustumCulled = false`: cutting `base` and `pitches` into ~4 x 2 spatial tiles with real bounding spheres would drop the walk's triangle count by roughly a third (see numbers below, the alley start is at 290k of 300k).

## Numbers (headless Chromium, iPad profile 820 x 1180, `fouerQ=medium`, 34 attractions at level 3, evening, with the polish agent's work in progress in the tree)
Walk (draw calls / triangles, `renderer.info` of the frame, DESIGN 5 walk budget medium: 220 / 300k; fps 60 in headless Chromium, real-iPad speed is unverified):

| position (medium) | draws | triangles |
|---|---|---|
| start of the Haaptallee (u 40) | 103 | 290k |
| mid alley | 80 | 281k |
| Fressgaass | 80 | 279k |
| Riserad platform | 51 | 211k |
| Allée Scheffer | 67 | 244k |
| NE portal | 55 | 215k |

| quality | guests | walk (start spot) draws / tris | builder overview draws / tris | builder close |
|---|---|---|---|---|
| low (cap 70) | 70 | 49 / 192k | 105 / 255k (42 guests, thinner) | 78 / 234k |
| medium (cap 150) | 150 | see above | 105 / 284k (90 guests) | 77-82 / 271-274k |
| high (cap 320) | 320 | 48 / 247k | 105 / 312k (192 guests) | 76 / 300k |

- The crowd itself costs 2 draw calls + Hämmi 1, and (near figures <= 200 x 74 triangles) 7-16k triangles; the rest is the world and the fair layer. **The alley start is at 290k of the 300k budget**: the merged fair batches have `frustumCulled = false`, so the whole fair layer counts whichever way you look (see the polish wish list). The numbers include the polish agent's work in progress (trees, glow, clutter).
- **Over budget, not caused by W6**: builder low = 105 draws / 255k (budget 90 / 150k), walk low = 192k (150k), builder high 312k at the overview is fine (700k). The medium builder budget (140 / 300k) holds.
- Riserad ride (camera at 47 m): ~210k triangles.
- JS cost, measured on this Mac by calling the update functions 120 times: `crowd.update` 0.10 ms average (0.4 ms worst) at 150 guests and 0.11 ms at 320, `walk.update` 0.01 ms, `audio.update` 0.01 ms. An iPad 9 will be several times slower, still well under 1 ms.

## Tests
- `node pb/fouer/harness.js`: **818 checks pass** (737 before; 81 new: collision primitives, the mask, gates, the carved Riserad corridor, the tram obstacle, pitch helpers, the A/D right-hand rule, crowd caps and density, the alley graph on a synthetic cross, lanes, queue slots, the 74-triangle figure, deterministic tunes in time order, voice picking (max 6), the wheel speed curve = 2 revolutions in 38-52 s and the Probefahrt in 55-72 s, Foodie stacking / session rule / expiry / flags through the real `createGame`). `node pb/park/harness.js` 229 pass.
- `node scripts/flows/run_all.mjs fouer-game fouer-migration fouer-walk`: **all three PASS** (fouer-walk also standalone and as the only flow). `fouer-models` and `fouer-big-models` PASS. `fouer-world` was not run (it fails on W2's own triangle budget since the trees, see W5 notes). `check_site.py` 0 errors (the old karttracker-privacy orphan warning), `cv_head.py` PROBLEMS: 0.
- `fouer-walk` (~11 minutes, iPad portrait, one page at a time, reloads for low / high): enter / exit restore the builder camera to 0 m and 0 quaternion error (button and Esc); the walk starts at the last upgraded stall; W S A D, arrows, Shift and the joystick measured against the real camera right vector (A = left, stick-left = left); look drag by touch and mouse, pitch limit; collision at a built stall (stops at w 45.54, face 45), at an NPC stall (50.34 vs 50.00), through the open NE portal (u 294.8) and stopped at the closed one (281.1); eating (button only near a stall, bubble text in lb, x1.05, 8007 -> 8407 EUR/min, three stack to x1.1576, the fourth refused); queue rows at 6 overloaded attractions (5-10 guests each, all in front of their attraction); the Riserad (camera to 46.8 m, upright to 1e-3, ends after two revolutions, back at the same spot, wheel speed restored, flag r + stamp card); coaster POV (10.4 m in 5 s, Esc leaves the ride only); Probefahrt (temporary wheel, pitch restored to the padlock stall, flag p, no second one); the walker is pushed 1.84 m out of the tram; Hämmi bleat by tap, pet button; audio (running context, 5 ambient layers, 6 voices, 0 errors, arcade mute and unmute); photo (a 730 KB PNG download); perf at six positions; builder with red clocks back and a thinner crowd; low = 70 and high = 320 guests; zero console errors.
- Debug hooks the flow uses (only with `?fouerDebug=1`): `__fouerGame.walk.{teleport, setLook, setInputKeys, setStick, interact, targets}`, `crowd.{stats, queueCounts, sheepPosition, graph, agents}`, `ride.{info, setTestSpeedup}`, `audio.stats()`, `mask.{allowed, stats, setGates}`.

## Photo comparison / honest verdict (`website-overnight/reports/fouer/w6/`)
All shots are iPad portrait unless named otherwise, headless Chromium, with the polish agent's work in progress in the tree, 34 attractions at level 3.
| file | what | verdict |
|---|---|---|
| `walk_alley_day.png` | down the Haaptallee at 15:00 | GOOD: reads as a fair: bunting over the alley, lamp posts, the tower and the Looping behind a crowd of ~35 visible guests (families, couples, kids). Weak: the asphalt is a flat grey, the figures are blocks, and a guest who passes close fills a third of the screen |
| `walk_alley_night.png` | the same at 21:50 | BEST SHOT: bulb strings, glow, lit stalls and the crowd silhouettes in front of them; this is the Fouer |
| `walk_eating_kachel.png` | the Gromperekichelcher stall, 1 s into eating | GOOD: the hand with the tray and the potato cake, steam, the bubble "Gromperekichelcher mat Apelmouss, lecker!", the Foodie chip. The stall's own queue stands between you and the counter (correct, but hides the stall) |
| `walk_in_queue.png` | behind a queue at the shooting gallery | OK: a real row of guests facing the Schéissbud, large at 2.6 m (blocky up close) |
| `walk_riserad_platform.png` | on the boarding platform with the round "Fueren" button | GOOD |
| `walk_riserad_top_portrait.png`, `_b.png` | at the top, looking over the field | GOOD: the whole fair, the towers, the Looping, the Grand Théâtre and Kirchberg behind |
| `wheel_top_landscape_field.png`, `wheel_top_landscape_theatre.png`, **`wheel_view_vs_photos.jpg`** | 1280 x 960, high quality, next to the two Commons photos taken from the wheel | layout and landmarks match (the avenue of office blocks on the left, the tower, the Looping, the road with trees on the right, the Théâtre / Kirchberg in the distance). **Density does not**: the photos show a continuous carpet of white tent roofs, rides and thousands of people; ours has ~320 guests as dots and a visibly emptier ground (about 40 % of the photo). The sky and the plane-tree row in the photo's foreground are missing |
| `walk_allee_scheffer_tram.png` | in the lane between the camelots, the tram 50 m away | GOOD: the grooved-rail lane, continuous stalls both sides, plane trees, guests, the tram coming. The camelot tarps are flat colours |
| `walk_theater_stop_tram.png` | the Theater stop, tram at the platform, doors open (teal) | GOOD: passengers waiting on the platform, shelter, hedge |
| `walk_haemmi_sheep.png` | Hämmi face to face | OK: cream face, pink ears, wool tufts, red-white-light-blue ribbon; blocky like everything |

Overall: it feels like walking the fair, not an empty test level: the alley, the queue rows, the tram street and the ride views carry it. What would still move it up: a ground texture (the asphalt), more figure detail up close, more NPC density (the photo), and the sound, which I could not listen to.

## Open items for W7
- Wheel of the arcade: `GIFT_WHAT.park`, the tile text, sw.js cache (W5 list unchanged). W6 changed `ui.css?v=2` / `main.js?v=2` in `pb/fouer.html`; every other module is imported without a version, so the sw.js bump is what invalidates them.
- Real-iPad frame time, battery and sound levels are unverified (the flows run with `--mute-audio` in headless Chromium). The loudness balance (ambient 0.3 / voices / sfx buses) was set by ear-less reasoning: please listen once on a real device.
- Hämmi's daily gift needs a sim function (a gift id window like `gi`, or a date flag); today it is cosmetic.
- The Hämmelsmarsch brass loop, the parade flock and the opening ceremony are still W7 (audio.js has the `organ` / `band` voices to build on: `organPhrase(seed)` is a melody generator, a fixed tune would be a second table).
- Walking beyond the portal ends at the Allée Scheffer ribbon (no bus park, no Boulevard); the E5 / E6 gates (NW) lead into the camelot wall and stay shut for walkers.
- Photo mode saves a plain PNG (HUD hidden by construction: the HUD is DOM, the canvas has only the scene); share / gallery upload is W7.
- Crowd figures are 74-triangle blocks: they read well from 8 m on, not up close. A skirt flag exists in `makeLook` but is not drawn; no pushchairs yet.
