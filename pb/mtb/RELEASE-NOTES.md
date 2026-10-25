# MTB Mëllerdall: release notes (integration wave, 25 Oct 2026)

Branch `mtb-play` (worktree `~/Library/Caches/website-mtb-play`) = the art branch `mtb` + the gameplay branch, merged and finished. Nothing pushed, nothing deployed, no SQL run. The reviewer ships.

## What the player gets
- **A real 3D valley**: 5.6 x 6.1 km of the Mullerthal around Berdorf, Beaufort, Müllerthal village and the Schiessentümpel, built from LiDAR terrain and OSM paths, everything painted (hand-painted gpt-image-2 texture set, no satellite or photo ground). One heightfield for rendering and physics, so there are no holes (the harness proves it).
- **Six trails on real paths**, green to black, each with a start gate, finish arch, checkpoints with splits against your best, painted signposts, berms, kickers, drops, rollers, roots, mud, boardwalks and wooden bridges:
  1. Haller-Waldwee (green, 1.7 km): the first ten seconds are in the beech forest between sandstone walls, a creek at the side.
  2. Hallerbaach-Flow (blue, 2.9 km), 3. Schiessentümpel-Trail (blue, 3.1 km: up the Black Ernz valley and over the stone arch bridge, the trail ends ON the bridge with the falls beside the finish card), 4. Binzelt-Fielsen (red, 1.3 km), 5. Waschbrunnen (black, 1.3 km, 174 m drop), 6. Mëllerdall Maratoun (red, 10.3 km, the part of the official GPX inside the world box).
- **Bike feel**: four bikes (hardtail, trail, enduro, downhill) with real differences, separate front and rear brakes, grip per surface (dirt, rock, roots, mud, leaves, wood) and rain, pumping on rollers, jump pop and graded landings, soft crashes with a respawn at the last checkpoint in 1.4 s.
- **Game loop**: start card with a big "Fueren" button, 3-2-1-Go, medals (bronze, silver, gold) that unlock trails, bikes, colours and helmets, a ghost of your best run, free ride with 60 discoverable viewpoints, a daily challenge.
- **Weather and time of day** are always player-choosable (menu, HUD buttons, T and G keys; Random is the default and the choice is saved). Weather never changes a medal or a score.
- **Four languages** (lb, de, en, fr), **sound** all synthesised (freewheel, tyres per surface, wind, birds, the waterfall, rain), **touch controls** for iPads (portrait and landscape, 2.9 % of the screen, 44 px minimum targets), quality low / medium / high picked automatically.
- **Arcade**: tile in `pixelbreak.html` with a thumbnail from a real in-game screenshot (`pb/thumbs/mtb.webp`, 640 x 400, 28 KB) and lb / de / en descriptions (the arcade has no French UI). One leaderboard per trail (score = 10,000,000 - milliseconds); the arcade header "Best:" now shows the best TIME of the trail on the start card (the old header number was the meaningless overall points value, no longer posted).

## What changed in the integration wave
- **Merge** of `mtb` (art) into `mtb-play`: conflicts only in `main.js`, `harness.js` and `mtb_world.mjs`, both behaviours kept. **One deck system**: `decks.js` carries every bridge as a deck with a piecewise profile (knots); plank bridges have two knots, the Schiessentümpel stone arch (`landmarkDeck`) has four (ramp, flat top over the arch, ramp). The art branch's overlay in `surface.js` is gone (the surface is the plain lattice again); the bike, the finish camera and the harness read the same deck code.
- **Finish validation** (the gold medal for 0:16.299 on a 2 km trail): it was a flow artifact. `scripts/mtb/play-tour.mjs` teleported the rider 40 m before the finish arch with `reset(i)`, which skipped every checkpoint. The game had no check, so it is now strict: a run only counts when every checkpoint was passed in order (reaching the arch without them sends the rider back to the first missed one: "Checkpoint 2 missed"), and the time must be at least trail length / 20 m/s (`PLAY.maxRunSpeed`, `minRunMs` in `game.js`). An impossible time is shown with a note and is never saved, medalled, ghosted or posted (`main.js onFinish`; the score reporter also refuses it, `save.js minMsFor`; the daily RPC is not called). The tour now rides the real loop. 3 new checks in `harness-play.js`, 2 in `harness-save.js`.
- **Unlock rows** show a green check mark (the open-lock emoji looked like a closed lock).
- **Arcade header**: the game no longer posts the overall points number to the plain `mtb` board (`publishOverall: false`), and the active board follows the trail on the start card, so "Best:" is that trail's best time (empty until the first run).
- **First impression**: the first trail was a field track near Consdorf (65 % farmland, corduroy crop stripes). It is now the Haller valley: 93 % forest, sandstone rocks within 25 m along 91 % of it. The id `ernz-waldwee` is kept, the name is "Haller-Waldwee" (lb / de / en / fr). Medals regenerated (gold 4:15.8).
- **Schiessentümpel trail** now follows the real forest road all the way up to the falls, crosses the stone arch bridge on its axis (`stoneBridge` in `trails.def.json`) and finishes on the deck; the finish arch is narrowed to the deck, and after the finish the camera glides to a spot below the bridge so the cascade sits beside the finish card. The last metres before the bridge drop 3 m from a terrace over steps (ridden as a short drop).
- **Spray**: the "flat glass sheets" across the cascade were the foam rings of the stream stones (flat discs at water level, one per big boulder at the pool). They are capped in size and fainter; the real mist is camera-facing soft sprites and stays. The water ribbon also shrinks to its white core around falls.
- **Camera**: the speed shake could push the lens 1 mm below the ground clearance (the harness caught it); it is clamped after the shake now.
- **Keep off the trails**: the art branch's exclusion corridor (KEEP_CLEAR 2.5 m around every trail, path and track for rocks, logs, stumps; ferns 1.9, shrubs 3.2, hedges 3.0) is checked in `harness.js` for every OSM path, track and all six trails; a new per-trail probe (1.2 m radius) reports 0 rock hits on all six trails (the only overlap left is 6 m of the Marathon that runs behind the face of a big slab buried in the hill: invisible, the game lets the bike ride through it).
- **Notes**: `W3-PLAY-NOTES.md` has the pump numbers re-measured at 270 W (trail bike +0.9 m/s, hardtail +2.6, downhill +0.0), the flat and climb speeds, and the soft speed cap (a 30 % descent tops out near 63 km/h).

## Gate numbers (final build)
| Gate | Result |
|---|---|
| `node pb/mtb/harness.js` (zero holes etc.) | PASS 86 checks (52 s): crack-free 1.66 M edge samples, render == physics over 100,945 trail points, camera min clearance 0.55 m, all trails clear of rocks |
| `node pb/mtb/harness-play.js` | PASS 163 checks (physics, the six trails ridden by the reference rider with 0 crashes and 0 rescues, game loop, finish validation, i18n lb / de / en / fr) |
| `node pb/mtb/harness-save.js` | 301 passed |
| `node pb/mtb/harness-audio.js` | 167 passed |
| `node scripts/flows/run_all.mjs mtb` (Chromium) | FLOWS_CHROMIUM |
| `node scripts/flows/run_webkit.mjs mtb-world mtb-holes mtb-ride mtb-menu mtb-touch mtb-trails` | FLOWS_WEBKIT |
| `python3 scripts/check_site.py` | CHECK_SITE |
| `cv_head.py` | CV_HEAD |
| Draw calls at the start card | low 138 (budget 140), medium 156, high 174; gorge poses (art): high max 807 k triangles, medium 462 k, low 329 k |
| Data | 4.5 MB baked + 0.95 MB painted textures (limit 6 MB) |

## SQL the reviewer must run (never run by the client or the builder)
1. **`scripts/mtb.sql`** (REQUIRED for the daily challenge only): the table `daily_scores` accepts the game id `mtb-daily`, `submit_daily_score` and `daily_board` know it (score cap 10,000,000, a floor of 60 s). **If it is not run**: the daily challenge still starts and plays, but its result cannot be posted (the finish card shows no "sent" note) and the daily board is empty. Everything else works without SQL: trail boards (`mtb-<trail>`) use the arcade's generic score path, the save is one small jsonb (2 to 7 KB, the existing keep-progress trigger), the tile needs nothing.
2. **`scripts/mtb-floor.sql`** (OPTIONAL, recommended): a trigger that ignores trail scores for times under 60 s (the same rule the game applies on the client) and deletes any such rows. Without it only the client protects the boards.

Requires the usual arcade SQL to be applied already (`paket-daily.sql`, `scores-numeric-v1.sql`, `scores-keep-best.sql`).

## Known issues (honest)
- **Feel is verified by physics unit checks and a reference rider, not by a human on a bike.** The first hour of play will find numbers to adjust (all in `config.js`, documented in `W3-PLAY-NOTES.md`).
- **Real-iPad performance is unknown** (measured on the Mini's GPU only). The low setting keeps the start card at 138 draw calls.
- **Schiessentümpel**: the cascade is three steps in series, the real one is 3 to 4 parallel falls over one ledge; the surrounding forest is brighter than the dark real gorge. The last 20 m before the bridge are steep (a 3 m drop from a terrace); the west bank beyond the bridge climbs at 50 %+ (the finish is on the deck, so nobody rides it). The finish card covers the middle of the screen, so the falls sit at the left edge of the view.
- **Weather**: fog and cloudy look almost the same inside the gorges (the fog distance is longer than the view down a corridor); rain and night read clearly.
- **Marathon** is point to point, 10.3 km, not a 20 km loop: only that much of the 38 km GPX lies inside the world box.
- **Beaufort castle ruin and the Berdorf village edge** (art wave "if time allows") were not done.
- **Do not run `scripts/mtb/bake_ways.py`** after changing a trail: the committed `ways.bin` was baked earlier and re-baking cuts other edges out of the network (it changes the ride times of other trails). Bake trails with `bake_trails.py` only, then `node pb/mtb/harness-play.js --rides --write-medals`.
- The 16:10 thumbnail is 28 KB (about 25 KB asked): the rock-corridor scene is detail-heavy.

## Dev tools added
`scripts/mtb/trail-shots.mjs` (ride a trail in the real loop and shoot at chosen distances), `scripts/mtb/release-shots.mjs` (every release screenshot in one session), `scripts/mtb/play-tour.mjs` (now finishes by riding), `scripts/mtb/compare.mjs` (photo | sim montages, poses updated for the new first trail).

Montages: `~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/release/` (11 sheets, single shots in `shots/`).
