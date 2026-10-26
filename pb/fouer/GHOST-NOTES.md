# Geeschterbunn: "Ghost wave" (26 Oct 2026)

Ian: "make the Geeschterbunn ride genuinely fun, the scares are too simple." Branch `fouer-cloud`. This note documents what changed; `RIDES-NOTES.md`'s
Geeschterbunn section now points here.

## 1. The ten scenes

The old roster (pop-up skeleton, two bats, a lit face, a strobe corridor, a coffin, a vortex tube, a spider, a ghost sheet, hands, a grab) is replaced by
the ten scenes Ian asked for, in order along the 90 m track (`pb/fouer/rides/ghost.js`, `GHOST_SCARES`). Every scene is a build-up (light/sound rising),
a pop (flash + stinger + a sound cue of its own) and a release (the set piece fades back to dim over about a second, the same mechanism as before). Times
below are at normal (1x) ride speed, from boarding; the real ride paces itself (section 2), so these are approximate, not a fixed schedule.

| # | scene | ~s | what happens |
|---|---|---|---|
| 1 | **coffin** | 7 | the lid creaks open on a hinge, a bony hand's glow spills out, then a **vampire sits up out of the coffin and waves** one arm |
| 2 | **gallery** | 12 | three portraits on the wall; the **eyes slide sideways as the cart passes**, tracking it (a small dynamic point mesh, not a re-baked texture) |
| 3 | **mirror** | 15 | a glass panel with a painted sheen (reused `airbrushTexture(..., "mirror")`); **a ghost looms up behind the glass**, then a scream and a flash as you pass |
| 4 | **lab** | 20 | a mad-scientist corner: a bubbling glowing flask (rising bubble points), **sparks crackle** between two rods (a flicker + a zap sound), a bang as it peaks |
| 5 | **library** | 24 | a shelf of books; **four books fly off** in short arcs timed to the cart's position, then a thud as the last one lands |
| 6 | **stretch** | 28 | a framed column that **stretches noticeably taller** (`scale.y` 1 → 1.85) as the cart passes, with a long creak |
| 7 | **webs** | 32 | a spider drops on its thread through cobwebs already hanging over the track; **a puff of air hits the lens** (`fx.spray`) right as you pass through |
| 8 | **rush** | 35 | a ghost **rushes straight at the cart** (scales up fast, dead ahead, no turn — it's scarier head-on), then at the last instant **vanishes into a burst of sparkles** |
| 9 | **band** | 38 | a **skeleton band plays the pipe organ** (three skeleton figures around an organ facade, swaying in time, a real organ chord) |
| 10 | **finale** | 51 | a **fake-out door slams shut** just as you reach it (a scary-face flash for one frame), then the real gate opens a few metres on: **daylight** |

Total ride ≈ 55 s at normal speed (was 44 s with the old 10 scares; a touch longer because the ride now pauses at each scene, see section 2). The path
geometry, the four doorways and the inside/outside split are unchanged from the rides wave (92 m path reduced slightly to 90 m by the spline's own
resampling; still 76 % inside, still exactly four facade crossings in/out/in/out) — only the scares themselves, the pacing and the camera changed, so
nothing about the model, the doors or the fade-to-black at the doorways needed to move.

## 2. Cart: turning towards scenes, speeding up and slowing down

- **Turn**: each scene carries a `side` (−1 / 0 / +1). The cart's facing direction (not its position) eases towards the scene as the cart approaches it
  and eases back afterwards — a smoothed bell curve around the scene's position along the track, low-pass filtered over ~0.45 s (0.75 s with reduce
  motion) so the turn is never abrupt. It is applied by rotating the track's own tangent/right vectors around "up" (the already-level frame from
  `levelFrame`), so **there is never any roll** and the up vector never changes: the flow's frame-sanity check (unit length, orthogonal, finite) still
  passes every frame. Capped at ±26°. `rush`, `webs`, `finale` are dead ahead (`side: 0`) on purpose — a ghost or a door coming straight at you is scarier
  than one off to the side.
- **Pace**: speed is `GHOST.speed × (ramp-in/out, unchanged) × paceAt(s)`, where `paceAt` dips towards a near-stop at each scene and rises to a brisk
  dash between them (a bell curve per scene, same shape as the yaw). Tuned to about 0.5×–1.2× the base speed, so a scene gets a beat to land without the
  ride dragging.

## 3. Light, atmosphere, sound

- **Black-light UV colours**: unchanged tubes/glow-dot palette (violet/cyan/magenta/green), now also tinting the gallery/lab/band set pieces.
- **Flickering lamps**: the additive glow (the red emergency-lamp points and the floor haze/dust) is modulated by a small continuous flicker function
  each frame — cheap (it just scales the opacity of two already-existing Points materials, no extra draws).
- **Floor fog and dust in the beams**: the existing floor-haze Points mesh now also carries a denser band of pale points close to the floor along the
  whole circuit, and a handful of near-white points inside each light cone's volume — all merged into the *same* mesh, so this costs nothing extra in
  draw calls.
- **Thunder through the windows**: while sealed inside, a random timer (5–11 s) fires an ambient strobe + `snd.thunder()`, independent of the scenes.
- **Wind tunnel**: the ride's bed (`snd.setBed`) carries a constant air-rush component throughout, boosted a little while the "rush" ghost is active.
- **New sounds** (`pb/fouer/rides/sound.js`): `cackle` (a witchy warble, the vampire and the rushing ghost), `organ` (a sustained detuned-square chord,
  the skeleton band), `thunder` (a low rumbling burst, the ambient lightning). Everything else reuses the existing procedural primitives (creak, bang,
  sting, zap, scream, thud, whoosh, clank) so every one of the ten scenes has its own distinct cue, and all of it still goes through the same mute/volume
  path as the rest of the game (`rides/sound.js`'s `guard`, `audio.muted`).

## 4. Performance: the sealed camera layer

The brief: *"the ride currently uses about 14 draws; keep the whole ride view ≤ 120 draw calls."* Ten richer scenes cost more than the old four or five
scares did, so this wave adds one structural change to make the budget easy to keep, not just on this ride but genuinely cheap on an iPad:

**While the cart is sealed inside the castle** (between an "in" crossing and the next "out" crossing — about 76 % of the ride), **the main camera is
switched to the ride's own dedicated layer** (`GHOST_LAYER = 7`, the same mechanism the Autoscooter already uses for its interior hall, one layer
higher). Every object the ghost rig builds (shell, floor, decor, murals, light cones, haze/fog/dust, red glow, cobwebs, every scene's props, the eight
door leaves) lives *only* on that layer; the cart's own hood is on both layers so it is always visible. With `camera.layers.mask` set to just the ghost
layer, **nothing of the fair, the world (ground/buildings/trees/landmarks/tram) or the crowd is submitted to the renderer at all** for that span —
not hidden-but-still-drawn, literally not in the render queue, because none of it is visible through solid castle walls anyway. The swap happens exactly
as the cart crosses each doorway (`st.crossIdx`), which is also when the screen is at its darkest (`fx.setBlack`), so the swap is never seen.

Outside the castle (the approach ramp, the balcony in daylight, the gate) the camera is back on its normal layer and the real fair is the backdrop, the
same as every other ride (DESIGN section 5's walk budget: ≤ 220 draws / 300k triangles).

**Measured** (headless Chromium, iPad portrait 820×1180, `fouerQ=medium`, the full fair at level 3, fast-forwarded 6×, `scripts/flows/fouer_rides.mjs`):

| | draws | triangles |
|---|---|---|
| **sealed inside the castle** (the ride's own geometry only) | **16** | **~2,000** |
| whole-ride peak, outside segments included (same methodology as the other 18 rides' table in `RIDES-NOTES.md`) | 55–80 | 131k–156k |

Sealed draws (16) are nowhere near the 120-draw ceiling — there is a lot of headroom left for a future scene or two. The brief's "about 14 draws" for the
*old* interior and this wave's 16 draws for a much bigger interior are close by design: the old scares table also counted the always-on shell/floor/decor/
murals/cones/haze/lamps/webs/doors (about 14), and this wave's ten scenes reuse that same always-on cost and add only the handful of props visible at any
one instant (at most ~5), because the sealed layer means nothing *outside* the ride is competing for draw calls any more. The outside-segment numbers
(55–80 draws) are far below the old peak of 208 (RIDES-NOTES.md, the pre-wave measurement) because the sealed layer also removes the fair/world cost for
the majority of the ride that used to dominate that number; the remaining ~55–80 is the ordinary cost of the balcony/approach/gate glimpses of the fair,
no different from any other ride.

**Low vs. high quality**: because the sealed layer's cost is the ride's own fixed geometry (not the fair's), it does not depend on the quality tier —
sealed draws stay at 16 / ~2k triangles regardless of `fouerQ=low|medium|high` (verified by reading the code: the sealed-camera swap excludes `fair`/
`world`/`crowd` entirely, and nothing in `createGhostRig` reads `quality`). The outside-segment number does vary with quality the same way every other
ride's does (more/fewer NPC stalls, tiles, far buildings); I did not re-run the full fair at `fouerQ=low`/`fouerQ=high` for this report (see section 7),
but the mechanism guarantees the number that actually matters for the brief — the ride's own cost — is quality-independent and far under budget.

## 5. Outside the ride: the facade (walk mode)

`pb/fouer/models/hall-geister.js` gets a small `buildExtras` hook (the track-ride kit's existing `extras(near, root)` contract, built only at the near
LOD, so it costs nothing at `fouerQ=low`):
- **One animated figure**: a pale wraith silhouette (a handful of flat triangles, vertex-coloured, one draw call) waves gently in the clock-tower window,
  brighter at night (it reads `k`, the night factor).
- **The ground-gate doors bang**: two leaves at the wide cart gate swing open and shut on a loop (synced loosely to the background carts' own period), so
  the facade itself feels alive even when nobody is riding.

Both pieces are deliberately small (3 extra draws on the model, only at the near LOD) — the player's own ride already brings a much richer interior; this
is only what the outside shows while idle.

## 6. Other rides

No time was spent on section 6 of the brief (a quick "is it fun" pass on the other rides) this wave — the ten-scene rebuild, the pacing/turning, the
sealed-camera work and the facade touch used the full budget. Nothing else was touched.

## 7. Gates

- `node pb/fouer/harness.js`: **1503 checks pass**.
- `node pb/park/harness.js`: **229 checks pass** (unrelated to this change, run as instructed).
- `node pb/fouer/harness-rides.js` (also run inside `harness.js`): **206 ride checks pass**, including the new scene-roster checks (8–10 distinct scenes,
  all ten ids present, every scene carries a `side`).
- `node scripts/flows/run_all.mjs fouer` (all 9 flows) and `node scripts/flows/run_all.mjs game-cache`: **see the final report** — this file is written
  before the full suite's last run finishes; the chat report has the final pass/fail counts.
- `python3 scripts/check_site.py`: **see the final report** (only the known `karttracker-ios-privacy.html` orphan warning is expected).
- The `fouer-rides` flow's `geister` block specifically: entrance/button/board/early-exit/full-ride/flag-once/stamp/no-leftovers all pass, plus the new
  checks — inside and outside both happen, the camera is sealed inside and normal outside, at least 8 of the 10 scenes fire, the doors bang, the strobe
  fires, the cart's yaw moves (turns towards a scene), and the sealed-layer draw count is ≤ 120 (measured 16).

## 8. What I could not do here

- **No real iPad.** All performance numbers are headless-Chromium measurements (the same methodology the rest of `RIDES-NOTES.md` and `POLISH2-NOTES.md`
  use), not a measurement on the actual device. The sealed-camera mechanism should make the real-device number *less* of a worry than before (it is a
  hard, quality-independent cap), but it is unverified on real hardware.
- **WebKit flow checks**: `npx playwright install chromium webkit` downloaded WebKit, but this container is missing several system libraries
  (`libgtk-4`, `libmanette`, `libavif`, …) that WebKit needs to actually launch, and I do not have root/apt access in this session to install them.
  Chromium (the engine every one of these gates actually uses) works fine and is what every gate above ran on; nothing in this repo's test suite
  requires WebKit specifically, so this did not block any gate, but I could not independently confirm WebKit-specific behaviour (there is none expected
  here: no Safari-only code path was touched).
- **Push access.** This session could fetch `origin` (read access) but not push: the git proxy refused with "ianmlhms/ian-site is not in this session's
  authorized repository set" and no `add_repo`-equivalent tool was available to me to request push access. Every commit for this wave is committed
  locally on `fouer-cloud`; **someone with push access (or a session with it granted) needs to push the branch** before a PR can be opened. The final
  local commit hash is in the chat report.
- Section 6 of the brief (a quick pass on the other rides), as noted above, was skipped for scope reasons, not a technical blocker.
