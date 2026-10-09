# Bus Tycoon balance and verification

Passengers 🧍 are the only currency: spending lowers `p`, never lifetime `tb`.
All lines run automatically. A tap welcomes 1 passenger initially. Driver level
`d` gives `1 + 2*d*d` passengers per tap; hiring costs `100 * 5**d`, maximum 18.
Stars multiply tap and passive earnings by `1 + 0.1*st`.

| Line | First cost | Base passengers / second | Base payback |
| --- | ---: | ---: | ---: |
| Schoulbus | 15 | 0.5 | 30 seconds |
| City Bus Lëtzebuerg | 180 | 2 | 90 seconds |
| Gare | 2,160 | 6 | 6 minutes |
| Kirchberg | 25,920 | 15 | 28.8 minutes |
| Belval | 311,040 | 40 | 2.16 hours |
| Night bus | 3,732,480 | 100 | 10.37 hours |
| Electric fleet | 44,789,760 | 250 | 49.77 hours |
| Tram | 537,477,120 | 600 | 248.83 hours |
| Trier / Metz / Arlon | 6,449,725,440 | 1,500 | 1,194.39 hours |
| Findel | 77,396,705,280 | 4,000 | 5,374.77 hours |
| Hyperloop | 928,760,463,360 | 10,000 | 25,798.9 hours |

These paybacks are for ONE unboosted line. Repeat purchases cost
`baseCost * 1.15**owned`. At 10 / 25 / 50 / 100 / 200 units, the route doubles
production, cumulatively up to 32×. The five one-time network upgrades cost
500 / 50,000 / 5,000,000 / 500,000,000 / 50,000,000,000 and each doubles all
lines, cumulatively up to 32×. Ownership is capped at 1,000 per tier.
Balances and leaderboard totals saturate at `Number.MAX_SAFE_INTEGER` so
saves stay finite and `Arcade.score(floor(tb))` remains accepted.

`node scripts/bus_tycoon_check.mjs` executes the actual game/reward code in a
minimal DOM and includes a deterministic balance benchmark. After 15 initial
taps it chooses the purchase minimizing waiting time + payback time, using
actual game production. With continuous online production, no gifts, no further
taps and no stars, it opens City at 0.06 h, Gare 0.10 h, Kirchberg 0.22 h,
Belval 0.60 h, Night 1.03 h, Electric 3.86 h, Tram 8.10 h, cross-border 35.00 h,
and reaches the first rebirth at **74.40 hours**. This is a reproducible example,
not an optimality claim or a prediction for every player. School iPad sessions,
8-hour offline caps and 50% initial offline efficiency extend calendar progress.
Findel and Hyperloop reward longer rounds or repeated star accumulation.

Rebirth grants `floor(sqrt(rb / 1e12))` stars. It resets available passengers,
lines, drivers and upgrades. Lifetime `tb`, gift day and existing stars stay;
`rbc` increments. A stale pre-rebirth cloud round cannot restore businesses;
its greater lifetime total can still be preserved. Higher `rbc` wins for state,
and merged lifetime and stars never decrease. Saves contain
`{v,p,tb,rb,st,rbc,gd,savedAt,owned,upgrades,drivers}`.

Rebirth UI, offline earnings, gift calendar/streak multiplier and pumpkins all
come from **pb/idle-extras.js**, without reward-rule copies. Offline cap is
`min(12,8+0.25*st)` hours, credited at `min(1,0.5+0.025*st)`. Daily gifts grant
600 seconds of production times `min(2,1+0.1*(streak-1))`, once per Luxembourg
day. Halloween preview uses the parent-injected `__pbHalloween`; pumpkins give
30 seconds of production and send the existing `__pbEvent` message.

The real-browser flow is `scripts/flows/bus_tycoon.mjs` in `run_all.mjs`.
Only its pumpkin spawn timer is shortened; real game intervals remain intact.
The SVG thumbnail is 640×400, matching existing WebP thumbnails; sandbox
restrictions prevent Chromium / the local flow server from launching here.

Geometry Dash: `node scripts/gd_level_check.mjs` evaluates the exact browser
CORE block and replays cached, deterministic frame inputs from
`scripts/gd_replays.json`. `--write` generates/replaces proofs by bounded search.
Every successful result is replayed without state quantization. A failed search
is not an impossibility proof. Level IDs, save key and levels 1–10 course data
remain stable; level 10 completion unlocks 11, through 15 in sequence.
