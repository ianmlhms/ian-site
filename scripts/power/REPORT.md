# Power-efficient testing on the Mac mini (22 Nov 2026)

Measured on the 16 GB Mac mini (Apple M1, Chrome for Testing / headless shell 155.0.8059.12, Playwright 1.64-alpha), with
the Ski Alpen round running next to it. Flows came from the integrated Ski branch `worktree-agent-af10f0221a941c5fa` @ 8bd7cc9d
(exported read-only, never touched in place). Every browser job ran through `python3 ~/Library/Caches/browser-slot.py`
(shared pool), one at a time, 1-min load at the start 4–17.

**How it was measured** (`scripts/power/measure.py`): wall and CPU seconds from `/usr/bin/time -l` (user + sys of the whole
reaped tree, so slot waiting is not counted). Peak memory is the sum of `top -l 2 -stats pid,ppid,mem` over the job's process
tree, sampled every ~2.5 s. MEM is the real footprint; `ps` rss under-counts Chrome about 3×. Pass = exit code 0. Raw data:
`~/Library/Caches/ski-work/power-test/results.jsonl`, logs in `…/logs/`, tables from `scripts/power/summarize.py`.
Single runs where only one is shown. Repeat runs moved CPU by ±5 % and peak memory by ±10 %.
**Not measured:** GPU energy (`powermetrics` needs sudo). CPU seconds are the energy proxy. The GPU work falls with the
economy settings too, but that saving is not in these numbers.

## TL;DR

| setup | 6 flows in one run* | CPU s | peak tree MB | wall s | pass |
|---|---|---:|---:|---:|---|
| today (video, Chrome for Testing) | run_all | 131.4 | 1621 | 94.5 | 6/6 |
| no video + economy | run_all | 64.5 (−51 %) | 1422 (−12 %) | 92.6 | 6/6 |
| **`FLOW_POWER=1`** (no video + economy + headless shell on Metal) | run_all | **58.7 (−55 %)** | **1257 (−22 %)** | 92.8 | 6/6 |

\* home-page, arcade-pad, mp-lobby-connect4, ski-freeride, mtb-ride, ski-ipad-start. On 10 more 3D flows in one run the
default setup was **killed by the guard** (2583 MB at train-sim-touch); `FLOW_POWER` got through at a 1749 MB peak
(section 7).

1. **Video recording is the biggest CPU cost.** Turning it off cuts 3D flows by 58–63 % of CPU seconds (ski 98.7 → 36.1 s).
   It also stops ~1.2 GB of webm syncing into OneDrive.
2. **The headless shell with Metal flags** (`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`) passes every 3D flow
   I tried that passes in Chrome for Testing, at 20–40 % less memory than Chrome for Testing. Without the flags it falls back to SwiftShader: 3D flows then
   fail and burn 5–12× the CPU. That fallback is why `lib.mjs` currently says "the shell stalls".
3. **No leak when switching resort**, but the old resort's garbage is collected late. One page visiting several resorts
   piles up 2.6–3.5 GB, and **the guard kills `ski-spawn`, `ski-lifts-all` and `train-sim-routes` today**. A new
   `h.releaseMemory()` (about:blank + CDP GC) between resorts fixed `ski-spawn`: 5/5 resorts at a 1850 MB peak.
4. **Lightpanda**: 7 of 16 non-3D flows pass at about half the memory, but those flows are cheap already (1–4 CPU s), and
   it has no layout, so layout checks pass without checking anything. Not worth adopting.
5. **Safari via safaridriver**: skipped. "Allow Remote Automation" is off. Playwright WebKit passed `ski-freeride` this time.
6. **Node instead of a browser**: a proof moves two of `ground-check`'s checks into Node. All 5 resorts take 23 s
   (one 2-engine browser run is ~10 × 42 s). The Node version covers every house instead of 5 spots, and finds
   overlapping same-plane triangles (possible z-fighting) the browser check never looks at.
7. **Economy must not force Grafik "low".** Train Sim builds no saloon on low, so `train-sim-touch` lost its "inside"
   camera. Economy is now half pixels + 30 fps only, and the flow keeps its own Grafik level.

## 1. Chromium headless shell vs Chrome for Testing

Today non-3D flows already run in the headless shell when run alone. 3D flows (`fullChromium`) and every flow in a
`run_all` that contains one run in Chrome for Testing (new headless).

**GL actually used** (`WEBGL_debug_renderer_info`): Chrome for Testing = `ANGLE Metal Renderer: Apple M1`; shell =
`SwiftShader driver` (software); shell + the 3 flags = `ANGLE Metal Renderer: Apple M1`.

| flow | Chrome for Testing (no video) | shell, no flags | shell + Metal flags |
|---|---|---|---|
| ski-freeride | 26.4 s · 1461 MB · 17.4 CPU s ✔ | 37.8 s · 1183 MB · 187 CPU s ✘ | 28.9 s · **1169 MB** · 14.7 CPU s ✔ |
| mtb-ride | 22.1 s · 1083 MB · 16.9 ✔ | 50.1 s · 894 MB · 256 ✘ | 22.3 s · **868 MB** · 16.0 ✔ |
| ski (incl. frame budget p95 ≤ 25 ms) | 64.2 s · 1910 MB · 36.1 ✔ | 210 s · 1331 MB · 1203 ✘ | 63.9 s · **1405 MB** · 35.7 ✔ |
| ski-ipad-start | 17.3 s · 1540 MB · 21.5 ✔ | – | 17.3 s · **1101 MB** · 20.6 ✔ |
| arcade-pad (non-3D, opens canvas/WebGL games) | 15.0 s · 807 MB · 6.8 ✔ | 22.6 s · 585 MB · **56.6** ✔ | 13.9 s · 533 MB · **4.7** ✔ (`FLOW_POWER`) |
| home-page | 7.9 s · 721 MB · 4.8 ✔ | 7.3 s · 356 MB · 3.0 ✔ | – |
| mp-lobby-connect4 | 8.4 s · 903 MB · 9.2 ✔ | 6.9 s · 529 MB · 4.6 ✔ | – |

So: **shell + Metal flags for every flow**. It is the lightest Chromium, and it no longer needs a second browser binary
for 3D. `arcade-pad` in the plain shell is a hidden cost today: 57 CPU s on SwiftShader vs 4.7 s on Metal.

## 2. Economy mode for 3D flows

`FLOW_ECONOMY=1`: deviceScaleFactor 0.5 (same CSS layout, ¼ of the pixels) and requestAnimationFrame capped at 30 fps by
an init script (sleeps on setTimeout between frames, no vsync wake-ups). The first version also forced Grafik `low`
(`localStorage arcade_gfx`). That changed what games offer: Train Sim builds no saloon on low (`hasSaloonCam`), so
`train-sim-touch` lost its "inside" camera, and `paket-express` timed out waiting for its traffic count. It is now off by
default (`FLOW_ECONOMY_GFX=low` opts in). The tables below with "economy" used the first version where they say so. The ski game clamps dt at 50 ms, so game time stays right down to 20 fps. I chose deviceScaleFactor
over a 640×400 viewport because a smaller viewport changes the layout and the tap targets. Settle times are not shortened:
most pauses wait for game time (distance after 7 s, light after 600 ms), so shortening them breaks checks rather than
saving power.

| ski-freeride (2 runs avg where 2) | wall s | peak MB | CPU s | pass |
|---|---:|---:|---:|---|
| base (video) | 26.6 | 1548 | 43.0 | ✔ |
| no video | 26.6 | 1489 | 17.2 | ✔ |
| no video + economy v1 (dsf 0.5, gfx low, 30 fps) | 26.9 | 1371 | 14.2 | ✔ |
| … economy v1 at dsf 1 | 26.7 | 1464 | 13.6 | ✔ |
| … economy v1 at 20 fps | 27.3 | 1443 | 12.7 | ✔ |
| shell + Metal + economy v1 | 26.2 | 1234 | 11.7 | ✔ |
| **`FLOW_POWER=1`** (final: shell + Metal, dsf 0.5, 30 fps, no video) | 26.3 | 1206 | 11.7 | ✔ |

| mtb-ride | wall s | peak MB | CPU s | pass |
|---|---:|---:|---:|---|
| base (video) | 22.6 | 1246 | 43.9 | ✔ |
| no video | 22.2 | 1081 | 16.8 | ✔ |
| no video + economy v1 | 22.2 | 1067 | 15.8 | ✔ |
| shell + Metal + economy v1 | 22.4 | 935 | 15.1 | ✔ |
| **`FLOW_POWER=1`** (final) | 22.4 | 993 | 14.9 | ✔ |

| ski-ipad-start (mostly boot) | wall s | peak MB | CPU s | pass |
|---|---:|---:|---:|---|
| base | 18.1 | 1589 | 22.7 | ✔ |
| no video | 17.3 | 1540 | 21.5 | ✔ |
| economy | 16.8 | 1536 | 21.3 | ✔ |
| shell + Metal + economy | 17.9 | 1079 | 21.7 | ✔ |

Economy on top of "no video" saves another 5–20 % CPU (and GPU work, not measured). Its main effect is lower memory in
Chrome for Testing. **What the flows still test:** gameplay, state and DOM checks pass unchanged. **One that can't run
under economy:** the `ski` flow's frame budget (p95 ≤ 25 ms on Niddreg) failed at 30 fps (p95 66.6 ms, a 30 fps frame
is 33 ms by design). Such flows now set `measuresFrames: true` and always run at real pixels and frame rate. Screenshots
and videos under economy are half resolution, so a look/compare run (shots, sheets) should run without it.
`FLOW_POWER` on 10 further 3D flows: see section 7.

## 3. Short-lived browsers and resort switching

**One long `run_all` vs one browser per flow:** no growth between flows. `runFlow` gives each flow a fresh context, which
releases its renderer. The 6-flow run peaked at 1621 MB vs 1598 MB for the biggest single flow. CPU is the same (131 vs
~129 s summed); wall time is 11 s shorter in one run (fewer browser launches). **A browser per flow adds nothing.**

**Inside a flow, resort after resort** (`scripts/power/resort-switch.mjs`, Ski at q=low, 8 s settle per resort; tree MB /
page JS heap MB):

| load | 1 killy | 2 3vallees | 3 zermatt | 4 arlberg | 5 kronplatz | 6–10 again |
|---|---|---|---|---|---|---|
| one page, `location.replace` (the game's own switch) | 1186 / 310 | 2139 / 1158 | 1871 / 647 | 2282 / 1236 | **3482 / 2475 → KILLED by the guard** | – |
| new context per resort | 1187 / 438 | 1884 / 857 | 1624 / 730 | 1907 / 859 | 2250 / 1393 | 1153–2564 (peak 2564) |
| new browser per resort | 1184 / 314 | 1700 / 669 | 1431 / 729 | – | – | peak 2327 |
| **one page + full GC before reading (`--gc`)** | 1047 / 301 | 1565 / 643 | 1366 / 469 | (killy 1089/300, 3vallees 1500/643 on later visits) | kronplatz alone: 1531 / 747 | |

three.js `renderer.info.memory` per resort, on every visit: geometries 136 / 128 / 129 / 139 / 113, textures 14–16,
programs 29–32, the same before and after switching. **There is no leak.** After a GC every resort comes back to the
same retained heap (killy 301 → 300 MB, 3vallees 643 → 643 MB). The growth is garbage: a resort's boot creates far more
temporary heap than it keeps (Kronplatz keeps 747 MB but sits at 1.4–2.5 GB until V8 collects). V8 collects late, so
5 resorts in one page reach 2.6–3.5 GB.

Flows that do this and are **killed by the 2.5 GB guard today** (no video, Chrome for Testing): `ski-spawn` (2761 MB at
Arlberg), `ski-lifts-all` (2670 MB), `train-sim-routes` (2640 MB). The `run_all` of 10 more 3D flows was also killed at
`train-sim-touch` (2583 MB, section 7).
**Fix (proof):** `h.releaseMemory()` in `lib.mjs` (go to about:blank, CDP `HeapProfiler.collectGarbage`) between resorts.
`ski-spawn` with it: **✔ 5/5 resorts, peak 1850 MB**, 35.7 s, 38.3 CPU s (`FLOW_POWER=1`: ✔, 1948 MB, 34.3 CPU s).
`ski-lifts-all` with it: still **killed** in Chrome for Testing (2560 MB at 3vallees, the resort alone with every tile
loaded is that big). With it + `FLOW_POWER`: **✔ 389 s, peak 2458 MB, 176.6 CPU s**, only just under the limit, so it
should move to Node (section 6). `train-sim-routes` (one context per line already) with `FLOW_POWER`: **✔ 133.5 s,
2044 MB**, killed at 2640 MB without it.

Side note for the Ski agent (not a test problem): Kronplatz's boot peaks at 1.4–2.5 GB JS heap on q=low. On a 3 GB iPad
that transient matters more than the 747 MB it keeps.

## 4. Lightpanda (1.0.5, `~/Library/Caches/lightpanda/`, CDP, telemetry off) for non-3D flows

`scripts/power/lightpanda-run.sh` starts `lightpanda serve`, and `lib.mjs` connects with `FLOW_CDP` (connectOverCDP), no video.

| flow | Lightpanda | headless shell (no video) | why it fails in Lightpanda |
|---|---|---|---|
| geld-page | ✔ 2.2 s · 176 MB · 0.6 CPU s | ✔ 2.5 s · 321 MB · 1.9 | |
| friends-add | ✔ 3.9 s · 155 MB · 0.6 | ✔ 3.8 s · 219 MB · 1.1 | |
| messenger-new-group | ✔ 6.2 s · 169 MB · 0.7 | ✔ 6.3 s · 256 MB · 1.6 | |
| profile-page | ✔ 4.2 s · 170 MB · 0.8 | ✔ 4.3 s · 266 MB · 1.9 | |
| slf-round | ✔ 4.9 s · 159 MB · 0.6 | ✔ 5.0 s · 219 MB · 1.3 | |
| leaderboard-tags | ✔ 5.0 s · 202 MB · 0.8 | ✔ 5.2 s · 410 MB · 3.6 | |
| account-check | ✔ 19.4 s · 183 MB · 0.8 | ✔ 20.2 s · 396 MB · 4.3 | |
| home-page | ✘ 7.0 s · 180 MB · 0.7 | ✔ 7.3 s · 356 MB · 3.0 | 2 visibility checks (no CSS layout) |
| mp-lobby-connect4 / -slf / -quick | ✘ at once | ✔ | "Cannot have more than one browser context at a time" |
| quick-login | ✘ | ✔ | no `WebAuthn.enable` over CDP |
| arcade-pad, client-commands, invites-light | ✘ timeouts | ✔ | canvas games / waits on layout |
| mordsfall | ✘ | ✔ | computed styles (background rgb 0,0,0), taps by position |
| idle-softcap | ✘ | ✘ (fails in Chromium too) | |

7 of 16 pass, at about half the memory and ⅓ of the CPU. **Not recommended.** The flows that pass cost only 1–4 CPU s in
the shell anyway, so a full run would save about 1 CPU minute. Lightpanda has no layout engine, so the "no horizontal
scroll" checks passed there without checking anything (home-page reported every column 1920 px wide). Multi-context flows
can't run at all. Keep it in mind for a pure-DOM smoke test later.

## 5. Real Safari (safaridriver) vs Playwright WebKit

`scripts/power/safari-ski.mjs` (W3C WebDriver, Ski boot + bot + frames + page errors) → **skipped**: *"You must enable
'Allow remote automation' in the Developer section of Safari Settings"*. The session is refused before any window opens.
To enable: Safari › Settings › Advanced › "Show features for web developers", then Develop › "Allow Remote Automation"
(or `safaridriver --enable` with an admin password). Then run
`python3 ~/Library/Caches/browser-slot.py node scripts/power/safari-ski.mjs --root <ski checkout>`.
Playwright WebKit `ski-freeride` (5-min alarm): **✔ 27.3 s**, no hang this time. Its memory and CPU can't be priced this
way, because WebKit's WebContent/GPU processes are started by launchd (XPC) and are not in the job's process tree. The
browser-slot guard can't see them either: a WebKit job is **not protected by the 2.5 GB kill**.

## 6. Browser checks that can be plain Node (three.js without a renderer)

Proof: `scripts/power/ski-ground-node.mjs`. It loads the page's own three.js r160 build (same SRI hash) into Node and
builds the street and village meshes with `roads.js` / `village.js` and the houses the lift world keeps. Then it runs
ground-check's **streets** check (every street vertex vs `surface.height`) and its **coplanar** check (z-fighting) over
the whole resort.

| | browser `ground-check.mjs` | Node `ski-ground-node.mjs` |
|---|---|---|
| killy | 42.6 s · 1572 MB · 22.1 CPU s (Chromium only) | 1.8 s · 420 MB · 2.5 CPU s |
| all 5 resorts | default = 5 resorts × Chromium + WebKit ≈ 10 × that (~7 min, ~220 CPU s + WebKit) | 23 s · 1223 MB · 26.6 CPU s |
| coverage | streets within 80 m of 5 village spots, houses within 120 m of them | every street vertex (0.48–2.3 M per resort), every house |
| result | 1/1 green (killy) | streets: worst 0.000 m everywhere ✔. Coplanar: killy 16, 3vallees 47, zermatt 286, arlberg 38, kronplatz 190 overlapping pairs **outside the 5 spots** ✘ |

The coplanar pairs are real coplanar overlaps (e.g. killy: two flat slabs at y 1836.81 overlapping around x 11444 z 8866;
a shared wall plane at x 5302 z 6839). Whether they flicker on screen (or are hidden inside walls) needs a look by the
Ski agent. The Node check reports where they are.

Candidates (estimates from the timings above; a 3D browser check ≈ 1–2 CPU s per wall second and 1.2–2.5 GB):

| check | what it really reads | in Node | saving (est.) |
|---|---|---|---|
| `scripts/ski/ground-check.mjs` | geometry + Raycaster on CPU, in 2 engines (the engine can't change a CPU raycast) | streets + coplanar done; terrain cracks (tile-mesh.js `buildTileMesh`, harness C already) and decks (lifts.js meshes) next; carve/skis need skier-model | ~7 min / ~200 CPU s / 1.5–2.5 GB → < 1 min. Keep `--shots` + a 1-resort WebKit smoke in the browser |
| `scripts/ski/pose-check.mjs` | skier-model.js pose geometry at a frozen state | skier-model.js + skier state in Node | 5 × 9 s / 8 CPU s / 1.3 GB (WebKit by default) → seconds |
| flow `ski-spawn` | the spawn spot vs ground / houses / lift | **already in** `round7c-check.mjs` ("spawn", Node) | drop it from the browser runs, or 1 resort as a smoke |
| flow `ski-lifts-all` | lift-site.js stations, boarding, exits, hold physics, every lift of 5 resorts after every tile | lift-site.js / freeride.js / skier.js are pure | killed at 2670 MB today; Node ≈ seconds |
| `train-sim-routes`, `-timing`, `-stock` | stop lists, timing model, roster/migration (no shots, no pixels; "about 4 / 2 minutes") | likely pure data/logic (scripts/zuch has a drive bot) | minutes each; to check with the train agent |
| not candidates | `*-holes` (magenta pixel truth), frame budgets, screenshots / look sheets, touch/input flows | | |

## 7. FLOW_POWER on more 3D flows

`run_all` of game-cache, mtb-holes, mtb-smooth, fouer-world, fouer-rides, train-sim-touch, paket-express,
kart-letzebuerg-arcade, test-mode, small3d-ipad-start in one browser:

| setup | result | peak MB | CPU s | wall s |
|---|---|---:|---:|---:|
| today (video, Chrome for Testing) | **KILLED by the guard** at train-sim-touch (2583 MB), 5/5 passed before | 2589 | – | – |
| `FLOW_POWER=1` v1 (gfx low) | 7/10: ✘ train-sim-touch, paket-express (gfx low, see section 2), kart-letzebuerg-arcade | 1749 | 373 | 815 |

The failures, flow by flow (alone, no video):

| flow | Chrome for Testing | shell + Metal | economy v1 (gfx low) | `FLOW_POWER` final |
|---|---|---|---|---|
| train-sim-touch | ✔ 165 s · 2436 MB · 157.6 CPU s | ✔ 175 s · 2187 MB · 155.8 | ✘ no "inside" camera | **✔ 157 s · 2154 MB · 118.1** |
| paket-express | ✔ 45 s · 1555 MB · 29.4 | ✔ 51 s · 1146 MB · 29.0 | ✘ traffic count timeout | **✔ 45 s · 1222 MB · 23.2** |
| kart-letzebuerg-arcade | ✘ | ✘ | ✘ | ✘ 39 s · 937 MB · 17.8 |

`kart-letzebuerg-arcade` fails the same way everywhere ("Supabase requests stay low": 34 > 30, double `scores` posts).
It is already broken on this branch, not caused by the setup. The mtb-holes pass under the shell at half pixels is a good
sign that the shell on Metal renders the same picture: it is the magenta-pixel hole check. The 7 flows that passed under
v1 were not re-run under the final version, which only drops the forced gfx low.

## Recommended setup

1. **`FLOW_POWER=1` for every agent run** = `FLOW_NO_VIDEO=1 FLOW_ECONOMY=1 FLOW_CHROME=shell` (shell on Metal). Each
   part can be switched back off: `FLOW_NO_VIDEO=0` when someone wants to watch a video, `FLOW_ECONOMY=0` for look /
   screenshot rounds (full pixels), `FLOW_CHROME=full` to compare with Chrome for Testing.
2. **Flows that load several heavy pages** (resorts, routes) call `h.releaseMemory()` between them.
3. **Move pure-geometry checks to Node** (ground-check, pose-check, ski-lifts-all), and drop `ski-spawn`, which is a
   duplicate of round7c-check.
4. No Lightpanda, no browser-per-flow. Safari only once "Allow Remote Automation" is on.

## Exact changes

**Already on branch `claude/test-power-59c669`** (opt-in, default behaviour unchanged):
- `scripts/flows/lib.mjs`: `FLOW_POWER`, `FLOW_NO_VIDEO`, `FLOW_ECONOMY` (+`FLOW_ECONOMY_DSF`, `FLOW_ECONOMY_GFX`), `FLOW_FPS`,
  `FLOW_CHROME=shell|full` (shell gets the Metal flags on macOS, `FLOW_SHELL_ARGS` overrides), `FLOW_CDP`,
  `flow.measuresFrames`, `h.releaseMemory()`.
- `scripts/power/`: `measure.py`, `matrix.sh`, `summarize.py`, `lightpanda-run.sh`, `resort-switch.mjs`,
  `safari-ski.mjs`, `ski-ground-node.mjs`, this report.

- `scripts/flows/run_all.mjs`: says "no videos" when they are off.

**For the Ski branch** (the Ski agent should apply these; I only changed my exported copy). All of it is in
`~/Library/Caches/ski-work/power-test/ski-branch.patch` (`git apply --check` clean on the ski worktree @ 8bd7cc9d):
- Merge the `lib.mjs` change (the ski lib has `flow.deviceScaleFactor || 1`; keep it as the non-economy value).
- `scripts/flows/ski.mjs`: `measuresFrames: true`.
- `ski_spawn.mjs` and `ski_lifts_all.mjs`: `await h.releaseMemory()` before each next resort (2 lines, shown working in
  the copy).
- Move ground-check's streets + coplanar into Node (`ski-ground-node.mjs` → `scripts/ski/`), then look at the coplanar
  pairs it finds.

**`~/Library/Caches/browser-slot.py` (NOT changed, needs Ian's OK):**
- Give every job the measured setup unless it opts out: in `main()` before `Popen`,
  `env = dict(os.environ); env.setdefault("FLOW_POWER", "1")` and `Popen(..., env=env)`. A job that wants video or full
  pixels sets `FLOW_POWER=0`.
- `WATCH_S = 10 → 3`: the tree went from under 2.5 GB to 3.4–3.5 GB between two 10 s checks before it was killed.
- Keep `MAX_TREE_MB = 2500`. With `releaseMemory` and `FLOW_POWER` every measured flow stays under it, but
  `ski-lifts-all` only just (2458 MB) and `train-sim-touch` at 2154 MB. Those two should not run at the same time as
  another big job.
- Optional, for a fair kill decision: count launchd-spawned WebKit XPC processes (`com.apple.WebKit.*`) while a job runs
  with `FLOW_BROWSER=webkit`. Today they are invisible to the guard.
