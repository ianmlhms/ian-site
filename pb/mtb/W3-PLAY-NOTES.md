# W3 "Play": notes for the reviewer

Branch `mtb-play` (worktree `/Users/Ian/Library/Caches/website-mtb-play`, starts from `mtb` at W2), nothing pushed, nothing deployed, no SQL run. The art agent works on `mtb`; the lane split is in `HANDOFF-PLAY.md`.
Run: `node pb/mtb/harness-play.js` (play harness), `node pb/mtb/harness.js` (zero holes), `node pb/mtb/harness-save.js`, `node pb/mtb/harness-audio.js`, `node scripts/flows/run_all.mjs mtb`, `node scripts/flows/run_webkit.mjs mtb-world mtb-ride mtb-menu mtb-touch mtb-trails`.
Dev tools: `scripts/mtb/play-tour.mjs OUTDIR [--touch] [--size WxH] [--only card,count,run,finish,menu,bikes]` (screenshots of the real game, the reference rider drives).

## What was built
| Area | Where |
|---|---|
| Six trails baked on real OSM paths | `scripts/mtb/trails.def.json` -> `bake_trails.py` + `trail_features.py` -> `data/trails.json` (checkpoints, signposts, features, bridge crossings, straightened bridge stretches, trimmed ends) |
| Trail features carved into the bed | `trail-features.js` (offsets: roller, kicker, drop, slab, roots, mud; surfaces: dirt, rock, roots, mud, leaves, wood), `trails.js` (applied to the carve, `yield` so two trails never carve the same path twice, per-sample surface and way kind), `decks.js` (bridge decks as closed solids, ground composition) |
| Bike physics | `bike.js` (rewritten), `config.js` (`SURFACES`, `PLAY`, `BIKES`), `bot.js` (the reference rider) |
| Game loop | `game.js` (pure state machine), `play-world.js` (trail runtime), `main.js` (shell), `ui.js` + `ui.css` + `map-paint.js` (screens, painted valley map), `props.js` (gates, arch, signposts, flags, bridges, roots, boardwalks, patches, viewpoint foxes), `i18n.js` (lb / de / en / fr) |
| Save, scores | `progress.js`, `save.js`, `ghost.js` (written by a helper agent, 298 checks), `scripts/mtb.sql` (daily only), `pixelbreak.html` tile + `pixelbreak-records.js` `mtb` score format |
| Sound | `audio.js` (helper agent, 167 checks): freewheel, chain, tyres per surface, brakes, wind, birds / crickets, waterfall, rain, one-shots |
| Input | `input.js` (keys, touch, gamepad), `camera.js` (helmet / far camera, shake, FOV), `rider.js` (four bikes, ghost rider, tumble) |

## The six trails (all finishable by the reference rider with 0 crashes, 0 rescues, trunks and rocks on)
| id | grade | length | descent | notes |
|---|---|---|---|---|
| `ernz-waldwee` | green | 2.0 km | 14 m | wide forest track in the Black Ernz valley, rollers + roots, no jumps |
| `hallerbach-flow` | blue | 2.9 km | 86 m | the W1 trail, now with kickers, berms, boardwalk, mud |
| `schiessentuempel` | blue | 2.9 km | 126 m | down the Black Ernz valley, through Müllerthal village, ends on the gorge path 100 m from the Schiessentümpel (see open problems) |
| `binzelt-rocks` | red | 1.3 km | 32 m | the MTB-tagged paths above the Binzeltschlüff, rock stairs, drops |
| `waschbrunnen-black` | black | 1.3 km | 174 m | Felsenweg info -> Totenkammer -> Waschbrunnen -> Steinkreuz: 76 % MTB-tagged paths, 14 % mean grade, drops and kickers |
| `maratoun` | red | 10.25 km | 297 m | the part of the official GPX inside the world box (Berdorf NE to Beaufort); the GPX is a 38 km chain of which only 10.3 km lies inside the 5.6 x 6.1 km box, so the Marathon is point to point |

Features per trail are listed by `bake_trails.py` (e.g. Marathon: 16 berms, 12 root stretches, 8 kickers, 5 drops, 6 slabs, 5 bridges ...). Bridges are found where a trail crosses a stream: the line is straightened there, the trail does not carve under the deck, the deck is a closed solid with buried abutments (the harness checks the ends meet the banks and nothing is below the ground).

## Bike feel: what the numbers do (tuning notes)
All in `config.js`; every number below has a unit check in `harness-play.js` (P section).
- **Power**: 270 W for a few seconds (a rider gives more than the sustained 200 W): 18 km/h after 5 s, 23 km/h after 10 s, 26 km/h after 20 s on the flat; an 8 % climb is ridden at about 10 km/h. Below 2.4 m/s a "push" assist (1.7 m/s2, 3x after a one second stall) turns a stall on a steep bank into hike-a-bike: nobody gets stuck. The game also puts a rider back on the trail after 3.4 s of pedalling on the spot, or 4 s more than 38 m from the line.
- **Brakes**: one input is split 55 % front / 85 % rear (touch, S key); Q = rear only, E = front only. The weight moves forward (0.49 per g): the front brake stops a 9 m/s bike in 5.2 m, the rear one in 10.2 m, both in 5.9 m. The rear wheel skids first (`skid`, rear lateral grip 70 %), the front washes in a corner (up to 50 % lateral grip at full lever and full lock), and front only on a 34 % descent goes over the bars (a soft crash). Braking distance from 10 m/s: trail bike 7.2 m, downhill bike 6.5 m, hardtail 7.6 m.
- **Surfaces** (`SURFACES`): grip / rolling resistance / roughness for dirt, gravel track, road, rock, roots, mud, leaves, wood, grass, water, forest litter. Rolling distance in 6 s from 8 m/s: road > dirt > leaves > grass > mud (43 / 41 / 38 / 35 / 31 m). Rain (`wet` 0..1: clear 0, cloudy 0.1, fog 0.25, rain 1) takes `wetLoss` of the grip: dirt 20 %, track 14 %, road 30 %, rock 42 %, roots 40 %, wood 45 %, mud 8 %, leaves 28 %, grass 22 %; braking from 10 m/s on wet roots 9.3 m instead of 7.3 m, wet wood 9.1 m, wet rock 8.1 m. The daily challenge uses the daily weather for the physics so every rider has the same grip; ordinary runs use the weather the player chose. **Medals and scores are times only**: weather never changes a threshold or a score, it only changes how the bike grips (a player who rides in the rain is slower, a player who prefers a dry run can choose clear in two taps).
- **Pump** (hold Space over the crest, release in the dip): crouching costs `h * N * dp / v`, extending gains `h * N * preload / v` with `N = g cos(slope) + v2 * kappa` (kappa = curvature of the ground along the travel direction, + in a valley), so the gain exists only because the normal force in the dip is bigger than on the crest: 8 rollers of 0.4 m at 7 m/s give +0.9 m/s with the trail bike, +1.4 m/s with the hardtail (rigid frames pump best), +0.0 with the downhill bike. A pump never launches the bike (a valley with more than 1.5 g takes the pop away).
- **Pop**: holding Space pre-loads for 0.32 s; a tap (< 0.04 s) pumps, 0.18 s pops 0.2 m, a full hold 0.67 m / 0.73 s of air at 8 m/s.
- **Landings**: graded by the normal speed at touch-down: perfect < 2.5 m/s, good < 5.5 m/s; above the bike's `hardImpact` the landing costs speed (5 % per m/s); above `crashImpact` (hardtail 9.6, trail 11.5, enduro 13.2, downhill 15.2 m/s) or sideways above 6.5 m/s it is a crash. A 0.6 m roll-off lands at 4.9 m/s, a 3.2 m drop at 9.5 m/s (fine on the trail bike), 8 m is a crash.
- **Crashes**: stylised tumble (the rider pitches over, rolls, lies beside the bike) and a respawn at the last checkpoint after 1.4 s, 1.5 s of shield afterwards (no crash possible). Causes: landing, sideways landing, hitting a trunk or a rock faster than 5.4 m/s, sliding sideways faster than 8.5 m/s, over the bars.
- **Four bikes** (`BIKES`): hardtail (84.5 kg, 100 mm, climbs best, pumps best, crash threshold 9.6 m/s), trail (86 kg, 130 mm), enduro (88.5 kg, 170 mm, +6 % grip), downhill (92 kg, 200 mm, +12 % grip, crash threshold 15.2 m/s, climbs worst: 2.0 vs 2.8 m/s on an 8 % climb). Unlocks: trail bike at 3 medal points, enduro at 8, downhill at 14 (bronze 1, silver 2, gold 3; max 18).
- **Speed sensation**: FOV 62 degrees widening to 75 with speed, camera shake from 9 m/s (and on rough ground), helmet and far cameras (C), wind noise from 4 m/s.
- **Tuning by riding**: the reference rider (`bot.js`) rides all six trails every run of the harness: pure pursuit with a speed plan from the curvature (cornering 4.6 m/s2, braking plan 5.2 m/s2, max 8.6 / 10.4 / 11.4 / 10.2 m/s for green / blue / red / black). Its times are the medal times (`data/medals.json`, written by `harness-play.js --rides --write-medals`): gold 0.95, silver 1.12, bronze 1.5 times the reference time. The harness fails when a stored time drifts more than 4 % from a fresh ride (a physics change must regenerate the medals).

## Gates (see the report for the final numbers)
`harness-play.js` (physics, trails, rides, game loop, i18n), `harness.js` (zero holes: now with the six trails, the reference rider on every trail and the bridge decks), `harness-save.js`, `harness-audio.js`, flows `mtb-world mtb-holes mtb-ride mtb-trails mtb-menu mtb-touch`, `check_site`, `cv_head`.

## Decisions and deviations
1. **Marathon is point to point and 10.25 km, not a 20 km loop**: only 10.3 km of the 38 km official GPX lies inside the world box. Extending the box was out of scope.
2. **Schiessentümpel trail**: the falls lie 25 m ABOVE the village (the Black Ernz flows from the falls to the village), the last 100 m to the falls are stairs (87 % grade) and the bridge over the cascade belongs to the art agent's deck layer. The trail therefore ends on the gorge path 100 m from the falls, with the finish arch there; the falls are one of the free-ride viewpoints (and the waterfall sound is full at that distance). Before merging, the art agent's bridge deck could carry a short extension.
3. **Per-trail leaderboards**: the arcade's board mechanism (`Arcade.setBoard({id:'mtb-<trail>', format:'mtb'})`) is used, one board per trail, score = `10,000,000 - ms` (higher is better, no SQL). The plain arcade tile board `mtb` carries an overall number (medal points x 10,000 + viewpoints x 100 + best-time bonus). Only the daily board needs SQL (`scripts/mtb.sql`).
4. **Daily challenge**: seeded by the Luxembourg day number, a trail from the five non-marathon trails + time of day + weather; same for everybody (`dailyChallenge`); the weather of the day sets the grip for that run, the view stays choosable.
5. **Rocks on the Marathon**: three art rocks (around x 1650 z 1618 and x 1598 z 1626 and x 1386 z 1505) stand on the carved path; the bike ignores rocks inside the carve (`play-world.js`), the art agent should move them.
6. `arcade-kit.js` and 49 pages got `?v=34` -> `?v=35` (cache bump rule of `check_site`), because `pixelbreak-records.js` changed (the `mtb` score format) and arcade-kit imports it.

## Known problems / open (honest)
- Feel is verified by physics unit checks and a reference rider, not by a human on a bike: the first hour of play will find numbers to adjust (all in `config.js`).
- The Schiessentümpel trail ends 100 m before the falls (see above); the Marathon's slab / root / mud features on shared paths are only drawn once (the first trail owns the carve).
- The art rocks and trees near some trail bends still clip the camera sometimes; the camera collision code is W2's.
- The ghost replay on the finish screen is a chase camera replay of the just finished run (no cinematic spline).
- Real-iPad performance is unknown: the Mini's GPU only. Draw calls at the start card: low 138 (budget 140), medium 156, high 174.
