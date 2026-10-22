# W5 "Game": notes (23 Oct 2026)

`pb/fouer.html` now boots the first playable game. `?models=1` (W3 preview) and `?stage=1` (W2's empty Glacis, used by the `fouer-world` flow) still work.
Flows: `fouer-game` (standalone page + the real arcade), `fouer-migration` (in the arcade), both registered in `run_all.mjs`. Screenshots: `website-overnight/reports/fouer/w5/`.

## Files
| file | size | what |
|---|---|---|
| `main.js` | 12 KB | boot: renderer, world, models (`loadBigModels`), fair layer, env, `game.start()`, scene bridge, UI, frame loop, live gifts, fly-in, `window.__fouerHooks`, debug hook |
| `game.js` | 26 KB | DOM-free controller: state (always replaced), wall-clock tick, events, offline credit, onboarding logic, commands, startup/migration, persistence, late cloud migration |
| `scene.js` | 18 KB | state -> `fair.setPitch` + W2 pitch markers, build grow-in + ring + sparkles, selection ribbon, closed entrance barriers, screen anchors, tap picking, camera focus |
| `ui.js` + `ui.css` | 43 + 26 KB | HUD, goal ticket, build / manage sheets, Hämmi bubble + finger, coin pops, queue clocks, letter / offline / stamp / fireworks cards, settings, toasts |
| `sfx.js` | 3 KB | five tiny WebAudio blips (coin, build, upgrade, star, error); W6 owns the real soundscape |
| `i18n.js` | +96 lines | 80 new keys per language (lb / de / en), harness still green |
| `pb/fouer.html` | 4.6 KB | critical loader CSS inline, `ui.css`, `idle-extras.css/js`, arcade-kit, entry switch |
| `scripts/flows/fouer_game.mjs`, `fouer_migration.mjs` | 36 + 21 KB | the flows |

## What a fresh player sees, minute by minute
- **0:00** loading bar with the sheep (localised "D'Fouer gëtt opgebaut"). Start hour is golden afternoon (17:30), weather clear, both still "Random" (they drift on).
- **0:01-0:04** camera floats in from the bus park over the Glacis to the starter pitches. HUD: cash `€350` and the star bar, nothing else (no buttons, no goal card, DESIGN 1). Hämmi's bubble "Moien! D'Fouer fänkt un. Dëst ass deng Plaz." fades in after the fly-in, a pointing finger pulses on the one glowing pitch (P01). "Ech weess et" skips.
- **0:10** tap the pitch: camera lifts it above a bottom sheet with exactly ONE card (Gromperekichelcher, free gift). Tap "Opbauen": the stall grows out of the ground (1 s), gold ring, sparkles, jingle.
- **0:20** coins pop over the stall, "Gesäis de? D'Leit bezuele." Cash and the "+€25/min" line tick.
- **0:25** (3 s after the first coin) P02 glows, one card: Kannerkarussell (€300 of the €350). **Two attractions after ~13 s in the flow** (limit 120 s).
- **0:45** upgrade step: "Spuer nach €x" until the €90 is there (game time is the real economy; the flow fast-forwards), then tap the stall: ONE big "Verbessere (€90)" button, no look/replace clutter. The model changes (level 1 -> 2).
- **~1:45** the goal ticket appears ("Ziel: ⭐2, nach 10 Punkten") with OK, then the 👣 button appears; tapping it ends the tutorial (`tu` 8). From then on: the goal ticket (always exactly one goal from `nextGoal`, dismissable to a 🎯 chip), cash, stars, and the buttons weather/time, frame, settings.
- Pioneers (migrated players): letter first, then 3 steps: place a voucher (the first affordable one, else the free Gëllent Karussell), "see the crowd" (OK), upgrade.

`tu` mapping: 1 = pitch + Build (DESIGN steps 1+2 merged, the sheet state is derived), 3 = first coin, 4 = second build, 5 = upgrade, 6 = goal, 7 = walk, 8 = done. Pioneer: 1 place, 2 crowd, 3 upgrade.

## Behaviour notes
- **Persistence**: `createPersistence` as W1 wrote it (`__pbSave` posts, `__pbWantSave`, only-if-higher cloud merge, test mode posts nothing). Startup sources: `window.__pbSave`, the arcade's `localStorage.pb_save_park` (a reload of the srcdoc frame would otherwise get the stale injected copy), `pb_fouer_bak`. Autosave every 5 s, `pagehide`, hidden tab. Standalone play (no parent) mirrors to `pb_save_park` itself. `window.score = tb`.
- **Cloud rows that are not v2** (pioneer stub, v1) arrive after start via `__pbLoadSave`; `game.js` migrates them late (`migrate(raw, state)`), shows the letter, pushes a v2 save.
- **Time**: income by the wall clock (frame-rate independent). A gap > 45 s between two frames (hidden tab, mocked clock) becomes an offline credit with the "Wëllkomm zeréck" card; the credit is applied first, the button only dismisses and rains coins. Untouched tab: `activityRate`.
- **Live gifts**: `IdleExtras.liveGifts({game:'park'})`, `ready()` after `game.start()` (local save loaded, `__pbWantSave` sent). The toast uses idle-extras' fallback text (`GIFT_WHAT.park` is W7's: it currently says "Cash" in every language).
- **Test mode** (`__pbTestMode`): `unlockEverything` (all stars via a virtual rating of 1000, all pitches, pioneer items, stamps, €50M, no tutorial); nothing is persisted. `?fouerDate=` is honoured ONLY in test mode.
- **Entrances**: closed entrances (`ENTRANCES[].star` from props.js) show red-white barriers with as many gold diamonds as stars needed (one merged mesh, one draw call); a star removes them + toast.
- **Language**: `pb_fouer_lang` > `site_lang` (fr falls back to en). Changing it in settings rebuilds the UI live and never touches the site language.
- **Hooks for W6**: `window.__fouerHooks.startWalk()/endWalk()/onWalkChange(on)` (placeholder: flies close to the first stall and shows a "Zeréck" bar); `scene.anchor/pick/focus`; `game.on(...)` events (`change`, `built`, `upgraded`, `star`, `earn`, `offline`, `letter`, ...).

## Test results
- `node pb/fouer/harness.js` 737 checks pass, `node pb/park/harness.js` 229 pass, `check_site.py` 0 errors, `cv_head.py` PROBLEMS: 0.
- `fouer-game`: PASS (onboarding by taps only, 2 attractions in ~13 s, upgrade changes the model, goal card updates, look switcher, replace shows refund, weather/time do not change income, lb/en/de, reload restores, offline +6 h card (right amount) and +20 h capped at 8.25 h, closed entrances, perf, test mode writes nothing, events with `?fouerDate`, then inside the real arcade (park tile rewritten to `pb/fouer.html`, srcdoc frame): `__pbWantSave` before `__pbGiftReady`, save through `__pbSave` (localStorage + `game_saves` row of ~250 bytes), `window.score = tb`, mocked `__pbGift` pays once / toast / `__pbGiftApplied` / redelivery pays nothing, richer cloud save adopted, poorer one ignored). Zero console errors.
- `fouer-migration`: PASS (letter shows 34,472 / €4,649 / +68 (⭐2) / the five voucher chips / golden carousel / a drawn 2D map of the old park; `pb_park_v1_backup` is the untouched blob; pioneer tutorial by taps; a voucher on a LOCKED pitch (kanner on P31, Riserad half price on P24); no double migration on reopen, also when an old v1 client overwrote the local save; untouched / corrupt / stub-only / top-up paths).
- `fouer-models`, `fouer-big-models` pass. **`fouer-world` fails on its own triangle budget (168-182k vs 165k)** because of world changes that are not W5 (the new `world/trees.js`, W2's world only; the page is `?stage=1` now). Its URLs got `stage=1` (see hooks below).

## Performance (headless Chromium, iPad-medium profile `fouerQ=medium`, 820x1180, DESIGN 5 budget 140 draws / 300k triangles)
| view | draw calls | triangles |
|---|---|---|
| fresh start (empty fair, NPC background + props) | 42 | 177k |
| star-3 park (15 attractions), whole field | 72 | 225k |
| full fair, 34 attractions at gold level, whole field | 82 | 246k |
| full fair, close (live rides) | 60-64 | 215-230k |
The fair layer itself is 16 draws / 55k triangles at full content (W3 batching), plus the W4 models with their own materials. Debug: `?fouerDebug=1` exposes `window.__fouerGame.snapshot()` (draws, triangles, `fair.stats()`, state), `fillFair(level, maxStar)`, `advance(sec)`. Real-iPad smoothness is still unverified.

## Integration hooks / edits in files W5 does not own
- `scripts/flows/fouer_world.mjs`: its three page URLs got `stage=1` (the default page is the game now). Nothing else of W1-W4 was changed; `pb/fouer/models/*` and `pb/fouer/world/*` are untouched.
- `scripts/flows/run_all.mjs`: registered `fouer-game`, `fouer-migration`.
- Used from the fair layer without change: `fair.pits` (holder / `near.userData.height`), `setPitch`, `update(dt, camera)`, `setQuality`; the fair is put into `world.parts` as a `setNight`/`dispose` wrapper only (preview.js registers the fair itself, which makes `world.update` advance it twice).
- Things the next polish agent should know: the game relies on `pitches.setState/setMode/pick/rect` (W2), `props.js ENTRANCES`, the `userData.height` of models (picking of tall rides), and the night convention `world.setNight`. W2's `renderer.setPose(…, true)` does not cancel a running flight, `scene.focus` clears `rig.flight` itself.

## Known gaps / open issues
- **W6 (walk)**: `startWalk()` is a placeholder. The 👣 button, the tutorial step 7 and the hook are in place; the crowd, first-person camera, eating, the Riserad ride and the real audio are W6. Queue "figures" are a red clock badge (DOM) with the figure count, not 3D people.
- **W7**: `GIFT_GAMES` / `GIFT_WHAT.park` / SQL (gifts allowlist, pioneer stubs, `game_name`) and the tile `src` + title ("Theme Park Tycoon" still shows in the arcade bar), gallery (publish / museum cards: only the "Mäin ale Park" letter view exists), opening ceremony / Hämmelsmarsch / fireworks *visuals* (banners, stamp card and the fireworks gift card exist), sw.js cache bump, thumbnails.
- The 3 s build animation of DESIGN 1 is a 1.1 s grow-in (temporary model scaled out of the ground) + ring + sparkles; planks/awning/bulb-by-bulb is not done. Looks/levels are picked on the manage sheet, previews are emoji icons (no rendered model thumbnails).
- Item icons are emoji, the letter's 2D map is a pixel map (4 px per tile), not the 3D diorama (the kiosk model exists; W7 can open the diorama).
- The arcade's `pb_muted` is honoured by `sfx.js`; no tests for sound (flows run with `--mute-audio`).
- The first-time start (golden hour, clear) re-rolls the random weather with the public env API (`setWeatherNow('cloudy')` + `setWeather('random')`) because the sky module has no "random, starting clear" call; a small hook in `world/sky.js` would make that exact (note for the polish agent, which owns that file).
- lb strings are drafts for Ian to proofread (80 new keys).
