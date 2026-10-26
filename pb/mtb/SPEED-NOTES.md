# Speed pass (26 Oct 2026), branch mtb-play

Ian: "a bit slow, only 20 km/h even after fully pushing". Goal: fast and fun, still controllable. Numbers measured by `harness-play.js` (checks P) and the reference rider; nothing is pushed.

## Before / after (trail bike unless a column says otherwise; dirt unless said)
| | before | after |
|---|---|---|
| top speed, flat dirt, full pedal | hardtail 28.6 / trail 28.2 / enduro 27.2 / downhill 25.1 km/h | **35.9 / 35.0 / 34.2 / 32.4 km/h** |
| 0 to 25 km/h, dirt (road) | 12.9 / 14.5 / 18.0 / >30 s (9.9 / 11.2 / 13.3 / 18.9) | **4.5 / 5.1 / 5.5 / 6.5 s (4.1 / 4.6 / 5.0 / 5.9)** |
| 8 % climb, full pedal | 12.6 / 11.7 / 10.8 / 9.2 km/h | **20.7 / 19.8 / 19.2 / 18.0** |
| 12 % climb | 9.2 / 8.5 / 8.0 / 7.5 | **17.5 / 16.7 / 16.1 / 15.0** |
| fire road, 8 % descent (track, pedalling) | 53 / 53 / 53 / 51 (soft cap) | **55 / 54 / 54 / 52** (drag) |
| fire road, 12 % descent | 57 all (soft cap 56 km/h) | **63 / 63 / 62 / 61**, coasting 54 |
| 30 % drop (dirt) | 64 all (soft cap) | 83 (drag; hard cap 86); a root descent of 12 % stays 8+ km/h below the fire road |
| reference rider (trail bike), avg / max km/h and time | ernz 22 / 33, 269 s; haller 25 / 39, 413 s; schiess 20 / 40, 557 s; binzelt 21 / 41, 221 s; black 38 / 40, 123 s; marathon 18 / 44, 2043 s | **ernz 28 / 42, 209 s; haller 31 / 49, 328 s; schiess 26 / 45, 414 s; binzelt 28 / 44, 165 s; black 45 / 48, 104 s; marathon 25 / 52, 1435 s** |

The reference rider does not pump or jump and brakes for every bend (0.55 g), so a human with a line and pumps beats it. The schiessentuempel time before (557 s) included about 18 s of hike-a-bike at a 50 % bank; the faster bike used to wedge there for 100 s until the slope assist (below).

## What changed
- `config.js BIKE`: power 270 -> 480 W, `launchBoost` 0.5 (sprint from a standstill, `launchFade` 2..6.5 m/s), pedal force 330 -> 460 N, CdA 0.52 -> 0.6 (the drag that ends the speed), **soft cap removed** (`softCapStart/Drag` deleted), hard cap stays 24 m/s. `BIKES`: hardtail powerK 1.08, enduro 0.97, downhill 0.9 (the downhill bike is slower on the flat and still gets to 25 km/h in 6.5 s).
- `bike.js`: sprint boost; the push assist also carries 0.9 of the pull of the slope (`PLAY.pushSlope`), because with the faster bike a 50 % bank (Schiessentuempel, x 1764 z 5317) wedged the reference rider for 100 s; state carries `rough` for the camera.
- `PLAY.hitCrash` 5.4 -> 6.2 m/s (a glancing trunk at 12 m/s is a bump, a head-on hit still crashes). Grip, steering, landing and slide thresholds were checked at the new speeds and left alone: a full-lock turn at 15 m/s scrubs speed and never crashes, rear skids and front wash work (harness P), kickers / drops / rollers land at 5-7 m/s normal speed from 6..15 m/s with the trail, hardtail and downhill bikes (crash limits 9.6 / 11.5 / 15.2).
- Bot: `vmax` 13 / 16 / 14 / 12.5, `aLat` 5.4, `aBrake` 6, `lookPerMs` 0.45. All four bikes finish all six trails with 0 crashes (enduro / downhill need 1 rescue on a trail or two).
- Medals (`data/medals.json`, regenerated): gold 0.95 / silver 1.12 / bronze 1.5 of the reference time as before. Gold now: ernz 199 s, haller 312 s, schiess 393 s, binzelt 157 s, black 98.5 s, marathon 1363 s. Saved medals, best times and ghosts stay valid (old times are slower, so they stay beatable and their medals stay).
- **Time floor**: the client floor is length / 20 m/s: 65 s for the 1.3 km black trail (gold 98.5 s), the server floor is 60 s. A legit fast run of the black trail should stay above 80 s (estimate, no human has ridden it yet), so both floors hold. No SQL change needed.
- Feel: `camera.js` FOV +17 degrees between 4 and 18 m/s (was +13.6 between 6 and 22), shake from 8 m/s scaled by the roughness of the ground, camera boom grows with speed; `audio.js` wind rises from 3 m/s to full at 17 m/s and its pitch climbs; `speed-feel.js` (pure, checked in Node) + `speed-fx.js`: dust trail by ground (one instanced draw call, 28 / 56 / 96 puffs by quality, none on wood, damped by rain, mud and water spray still work, a landing throws a ring), speed lines (a half-resolution 2D canvas, drawn only above 29 km/h, none on the card or finish screen); `ui.js` / `ui.css` speedometer: gauge bar, five colour tiers at 20 / 35 / 50 / 62 km/h with a pulse when a tier is reached, top speed on the finish card (`finish.top`, four languages).
- Not done: trees closer to the trail. The forest corridor already follows the carved way width (2 m either side of the centre line) and the trunks that stay are collidable, so moving them in would add crashes; at 45 km/h the existing trunks pass about 2 m away, which reads as close.

## Screenshots
`~/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/mtb/speed/` (`waschbrunnen-black-trail-medium-{14,25,35,42,46}kmh.png`, `hallerbach-flow-trail-medium-{14..46}kmh.png`, `hallerbach-flow-trail-medium-boost.png` at 62 km/h).
