# W1 "Brain": notes for the reviewer and for W5

Run: `node pb/fouer/harness.js [--table]` (737 checks, about 1 s) and `node pb/park/harness.js` (229 checks, untouched).
`node pb/fouer/harness.js --sync-pitches` rewrites the pitch table in `data.js` from `pitches.json`.

## Files (lines)
| File | Lines | What |
|---|---|---|
| `data.js` | 158 | rules, 33 catalogue items (30 + gold carousel, old-park kiosk, Hämmi statue), levels (incl. Gold), star points, voucher map, embedded copy of the 34 pitches |
| `pitches.json` | 36 | the authored pitch table (W2 and the baker read this) |
| `calendar.js` | 165 | `fouerDates`, `eventsAt`, `economyContext`, `bannersAt` (Intl, Europe/Luxembourg) |
| `sim.js` | 362 | state, `economy`, commands, `tick`, `offline`, gifts, stamps, fireworks gift, `listActions`, `tipFor`, `nextGoal` |
| `save.js` | 291 | v2 codec, exact jsonb size model, merge rule, `createPersistence`, backup |
| `legacy.js` | 208 | lazy v1 kernel, `readV1`, `planMigration`, `migrate`, `resolveStartup`, `backupV1`, `lg` snapshot |
| `i18n.js` | 237 | lb / de / en (132 keys each), `t`, `formatMoney`, `formatDuration`, `formatDate` |
| `harness.js` | 1279 | 737 checks |

`economy-sim.proposal.py` is deleted (superseded by the JS bot in `harness.js`). `pitches.proposal.json` is left as it was.

## Economy (greedy bot of `harness.js`, active play, swaps allowed)
Same bot logic as the proposal: best euro-per-minute gained per euro spent, waits for the cash, uses the real commands.

| Star | Reached at | Income/min at that moment |
|---|---|---|
| 2 | 13.9 min | 128 |
| 3 | 54.9 min | 466 |
| 4 | 117.9 min (1.97 h) | 1,209 |
| 5 | 229.9 min (3.83 h) | 2,622 |

Income/min over time: 0.25 h 128, 0.5 h 235, 1 h 512, 2 h 1,231, 4 h 2,710, 8 h 4,161, 12 h 4,793. Rating at 8 h: 855 (max reachable with 34 gold items: 1,306).
End game: the bot makes 175 purchases and runs out of profitable ones at **12.5 h**. At 8 h it still has 4 profitable builds/upgrades (all gold upgrades, 522,500 euro) plus 16 profitable swaps; 0 pitches are empty. Real players are 1.5-2x slower. A bot that never swaps still reaches star 5 but runs out of plain builds/upgrades after about 5.8 h; swaps (replace, 50 % refund) are what stretch the optimal path to 12.5 h, so the 8-hour guarantee counts swaps as purchases. At star 5 `nextGoal` points at the best move that still raises income (build, upgrade, gold or swap) and never at one that lowers it.
First two minutes (scripted like section 1): free starter stall earns 25 euro/min, with the carousel (bought at 0:45 for 300) 54 euro/min, 136 euro in hand at 2:00, the 90-euro upgrade is affordable before 1:45.

What was retuned (catalogue costs, caps, prices of section 3.1 are unchanged):
- `ECONOMY`: guests base 6 -> 4, per point 0.55 -> 0.35, uses per guest 3.6 -> 3. Star points `[0, 18, 70, 200, 500]` (only star 5 changed, 480 -> 500; star 2 and 3 are fixed by the pioneer arithmetic: rb 68 stays at star 2, rb 75 gives star 3).
- Levels (cap / price / appeal): L2 1.5 / 1.15 / 1.35, L3 2.0 / 1.3 / 1.7, **Gold 2.5 / 1.45 / 2.1** at 2.5 x base. Third copy per type at 2 x base (`fl` bit 4 remembers it for refunds).
- Demand of a category is split by **base appeal** (not level-scaled): with level-scaled weights an upgrade of a cheap stall could pull guests from a dearer neighbour and lower income (the bot found two such cases). Now an upgrade never lowers income (harness check).

## Migration results (synthetic v1 blobs built with the frozen kernel)
| Blob | v1 parkValue | P | cash | rb | tb0 | vouchers |
|---|---|---|---|---|---|---|
| untouched | 6,200 | 0 | 350 | 0 | 2,000 | none (gold carousel + kiosk always) |
| median (10 objects) | 10,259 | 4,059 | 4,649 | 68 (star 2) | 34,472 | geister, wheel, wurscht, kanner, mandel |
| maxed (>= 56 objects) | > 26,200 | 20,000 (cap) | 13,350 | 75 (star 3) | 160,000 | booster x5 (launch coasters) |

Also covered: forged cash (capped identically), forged stub (`pv` 1e12), corrupt/oversize blob (cash 1,350 = 350 + 1,000 thank-you, pioneer badge, tb0 2,000), stub only (`pv` 10,259 -> cash 4,409, rb 68, tb0 34,472), top-up from a richer second device (cash += min(9000,P_B) - min(9000,mg), rb max, mg, vouchers filled to 5, tb += tb0 difference), never twice, v2-without-pioneer-flag + blob ("late" migration), v2 + older blob ignored, startup order (`resolveStartup`) incl. backup restore after an old client overwrote the local save.
Snapshot `lg`: 13 / 135 / 333 chars for the three blobs, hard limit 900 (longest path runs are kept when over budget), `inflateSnapshot(lg)` rebuilds a v1 state for the diorama.

## Save size
Maximum content (34 gold pitches with flags, 5 vouchers, 900-char `lg`, 50 gift ids, 12 stamp years, 24-char name): **2,201 bytes JSON, jsonb 2,441 bytes** (limits 3,000 / 8,192). With 16-digit gift ids and a 24-emoji name it is still under 3,000.
`jsonbSize()` replays PostgreSQL's jsonb layout exactly. Calibrated against `pg_column_size()` on the live database (read-only query, 22 Oct 2026): 410 / 2,123 / 1,206 / 3,770 bytes for four fixtures, estimator identical to the byte (fixtures are in `harness.js`). It also reproduces the 19,208 bytes of the v1 grid.

## Harness output
- `node pb/fouer/harness.js` -> `PASS: 737 checks; stars at 13.9/54.9/117.9/229.9 min; save 2201 B JSON, 2441 B jsonb.`
- `node pb/park/harness.js` -> `PASS: 229 checks; all 6 milestones in 16.75 days; end-game save 5732/7000 bytes.`

## Deviations from DESIGN.md (and why)
1. **Relative imports** (`./data.js`) instead of `/pb/fouer/x.js`: relative module specifiers resolve against the module's own absolute URL, so they are safe in the srcdoc iframe (only the HTML's own `<script src>` needs absolute paths, as v1 does) and Node runs them without a loader. `legacy.js` finds the v1 kernel with `new URL("../park/…", import.meta.url)`.
2. **P07 moved from u 70 to u 76** in `pitches.json`: it overlapped the wheel pitch P24 (u 26-66) by 4 m. Minimum gap between any two pitches is now 1 m.
3. **`pitches.json` plus an embedded copy** in `data.js` (harness asserts equality, `--sync-pitches` regenerates): keeps `sim.js` synchronous and avoids JSON imports on old iPad Safari.
4. **Familljendag / Lescht Dag multipliers** got a capacity factor so they are never a loss for full stalls: Familljendag guests x1.4, price x0.8, **cap x1.25** (net +12 % demand-limited, >= 1.0 capped); Lescht Dag until 20:00 guests x1.25, price x0.5, uses x1.6, **cap x2** (exactly neutral either way). Without it the family day cost a full stall 20 %.
5. **Hämmelsmarsch bonus** x1.3 for one hour applies to the pitches facing the main alley (zones M1, M2), as a per-zone multiplier in `ctx.zones`.
6. **Top-up** also adds `tb` (the tb0 difference) and a "late migration" path exists for a v2 save that never had the pioneer flag; not spelled out in 7.7 but needed for consistency.
7. **tb0 = 2000 + 8 P exactly**, so it is below the old score for parks under 6,800 (P < 600, includes the untouched 6,200). The harness checks `tb0 >= PV` for every generated park from 6,800 up and counts the others. The arcade keeps each player's best score, so I did not add a floor; adding `Math.max(tb0, PV)` is a one-liner in `planMigration` if Ian wants it.
8. `readV1` uses the kernel's `readLayout` (the same `decodeSave` as `restoreSave`, but it returns null instead of a fresh park, which the corrupt path needs).
9. Save has one extra field `fw` (year of the claimed closing-night gift, ~10 bytes) and `ea` is a flag string (`g` = starter stall gift used). `st` is `"2027:mh33,2028:1"`, newest 12 years.
10. Offline uses a neutral `ctx` (no event multipliers); the fair period adds +10 points / +2 h via `{ period: true }` as in 2.4. The "+10 % guests" applies to live play only.
11. Item ids (`alpina`, `jules`, `hangover`, ...) are the internal ids of the design table; all visible strings are generic (harness scans them for brand names and the city mascot).
12. The alley-frontage pitch check is loose (front edge within 16 m of an alley line at w -3 / 28 / 59 / 90 or u 66 / 130 / 190 / 250): the real alley graph belongs to W2.

## Open issues / hand-over for W5 (UI wiring)
- **Settled state**: `createPersistence({ getState })` must get a state that is already settled to now (`tick` or `offline` plus `touch`), like `settle()` in bus-tycoon. `pushSave` uses `state.t` as given.
- **Startup**: `await resolveStartup({ local: window.__pbSave, cloud, backup: readBackup text, now, name })`; show the letter from `report` (`fresh | stub | corrupt | late | topup | ignored | none`), call `backupV1(storage, v1Source)`, then `offline(state, now, { period: events.fair.active })` for the "Wëllkomm zeréck" card. Cloud arrives later through `applyIncoming` (only-if-higher); after adopting it run `offline` again from the winner's `t`.
- **Live gifts**: `IdleExtras.liveGifts({ game: "park", read: () => state.gi, apply: (amount, ids) => state = sim.applyGift(state, ids.at(-1), amount).state, ... })` (the new id is the last element). `GIFT_WHAT.park` is still missing in `idle-extras.js` (lb Suen / de Geld / en cash; strings are in `i18n.js` as `gift.what`).
- **Events**: call `eventsAt(now)` about once a second, `economyContext(events)` as `ctx` for `tick`/`economy`, `stampToday(state, events)` on open and at midnight, `claimFireworks(state, events)` from the closing-night card. The Hämmelsmarsch collectible sheep and the stamp-reward cosmetics (bulbs, ticket booth, crown plaque) are only derived (`stampRewards`), not stored.
- **Goal card**: `nextGoal(state)` returns data (`firstBuild | voucher | star | fill | replace | upgrade | gold | maxed`, plus `tip` for stars); the texts are `goal.*` / `goal.tip.*`.
- **Build menu**: `buildQuote(state, id)` (price incl. 3rd copy and the starter gift), `freePitchFor`, `itemUnlocked`, `pitchOpen`, `upgradeCost`, `refundFor`; refusal ids have texts `reason.*`.
- `tu` is the tutorial step 0..8 (8 = done); pioneers are `pi: 1` and the gold carousel / kiosk become buildable (free) automatically.
- Test mode (`__pbTestMode`): the persistence layer posts nothing and writes no backup; W5 must build the unlocked test state itself.
- SQL stubs for W7 must not contain a numeric `tb` (the keep-progress trigger compares it); `{v:2, stub:1, pv}` is handled by `classifyRaw`/`migrate`.
- Day length: a state's `tick(state, dtSec)` is closed form, so any frame rate works; for an open but idle tab multiply `dtSec` by `activityRate(stars, idleMs, period)`.
