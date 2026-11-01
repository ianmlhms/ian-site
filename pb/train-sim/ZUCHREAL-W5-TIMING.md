# Zuch & Tram Sim, W5 timing (Offart / Ukommen)

Complaint (Ian): even at a normal pace you stand ~30 s at a stop after the passengers are done, for tram and train.

## Root causes (measured with `scripts/zuch/drive_bot.mjs`, bot at 90 % of the limits)
1. **Dwell was a fixed 30 - 45 s** (`DWELL_MIN/MAX`) whatever the stop needs. The real exchange (`passengers.js`) takes 7 - 25 s at a normal stop (emu 10 - 20 s), so 15 - 30 s were pure waiting.
2. **Origin departure at 75 s** for every service: 50 - 55 s of waiting at the first stop.
3. **Premium floor**: `minExchange` for rail trains (the W4 "premium train dwell") was computed from the old bot formula (4 s + 0.6 s per alighting + 0.7 s per boarding passenger), i.e. 55 - 70 s on kiss / hst, far above the real 15 - 40 s: median wait 52 - 68 s on metz / brussels / paris.
4. The speed profile of the leg ran at an unrealistically slow model (accel x 0.5, brake x 0.6, share 0.8, no grade, no train length), so a driver at 90 % arrived 13 s early per leg and waited that out as well.
5. The tram had no model at all (random 30 - 45 s), but its exchange is 10 - 55 s (5 doors, capacity 420).

## What changed (`sim.js`)
* `exchangeSeconds(train, alighting, boarding)`: fit of `passengers.js` (`scripts/zuch/exchange_probe.mjs`, 6 trains x 9 count pairs, medium quality; +-15 % single-run spread; `low` quality is a few seconds slower in a crowd).
* `buildTimetable`: follows the expected passengers through the service (`expectedExchange`, same constants as `planFor`; `TS.sim.paxModel` is shared with the shell) and sets `dwell = 1.5 s open lag + 1.05 x exchange + 1.5 s close lag + 4.2 s door cycle + 1 s`, min 18 s, +-2 s jitter (keeps the random stream). A crowd incident of the plan lengthens its stop. Origin: dwell of the first boarding + 5 s, min 40 s.
* Leg times: `legTravelSeconds` uses the sim's own traction (`tractionModel`: full force to the knee, constant power above, running resistance), the gradient, the rail train's length against limit increases, 90 % of the limit (tram 94 %), the service brake at 0.5 and 5 s per leg (tram 3 s) for start-up and the last creep. Fitted so that a driver at 85 - 97 % is within about +-5 % of each leg.
* Early departure: the lever may go to power `EARLY_OK_S` = 10 s before the scheduled time without the `EARLY_FINE` (was: 8 s at the moment the train had moved 3 m, i.e. ~4 s on the lever). Judged at the first power notch after the doors closed (`vis.leaveT`). Late departure is unchanged (fine only above `ON_TIME_S` = 30 s). Lateness of arrival and its payment (`career.js` punctuality) are untouched.
* `departFreeSec` in the step state; the HUD badge counts down to "Ofaart fräi" (`hudDepFreeIn`) and, when the wait is longer than 6 s, says why ("Fréi do" = ahead of time) next to the scheduled time; the hint line says "you are ahead of time: wait for ...".

## Resume
Snapshots store the timetable rows (`tt`) and `timetableFrom` restores them verbatim, so a snapshot made with the old timetable resumes with exactly those times (flow `train-sim-timing`). `resume.js` validation is unchanged (`VERSION` stays 1).

## Not changed
AI trams (`luxtram-traffic.js` `ONC_DWELL_MS`) keep their own dwell; passengers.js untouched.

## Fares (follow-up)
The schedules got 10-26 % shorter, so `routeRules.fareScale` (config.js; Luxtram sections in luxtram.js) scales the whole fare of a service (career.js `reward`) by new / old scheduled minutes: EUR per scheduled minute stays within +-1 % on every rail route and tram section (`scripts/zuch/career_probe.mjs` now covers the tram). Prices are unchanged, so runs-to-buy rise by the same factor. Nothing is stored in save data.

## Gradient (follow-up)
`legTravelSeconds` now lets an uphill pull the speed below the cap (sustainable speed from traction curve - resistance - slope, evaluated under the train's centre) and a downhill helps the brake. The remaining railcar lateness on north / wittlich was not the grade but the per-leg start-up / creep overhead of a slow-accelerating train on short legs: 3 s -> 5 s per leg for rail.
