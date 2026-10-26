# Halloween look — implementation notes

Branch: `halloween-cloud` (pushed to `origin/halloween-cloud` only; `main` was never touched).
Final commit: **`aaff1dc0b1977165232eff1d2e012bd9e399b807`**

## What was built, and where the hook lives

A seasonal layer that turns itself on from **24 Oct to 2 Nov** (Europe/Luxembourg time)
and off afterwards, with no redeploy. Everything is scoped under `<html data-season="halloween">`.

- **`season.js`** (new, plain classic script, loaded in `<head>` *before* `theme.js` on
  every page that already loads `theme.js`) owns:
  - the date window (`HALLOWEEN_START_MONTH_DAY` / `HALLOWEEN_END_MONTH_DAY`, named
    constants, Europe/Luxembourg via `Intl.DateTimeFormat`);
  - the `?season-date=YYYY-MM-DD` test override (query-string only, never written to
    storage — harmless in production, and the only way the flow test or a human can
    preview another date);
  - the exclusion rules (see below);
  - the `localStorage` on/off toggle (`site_halloween`) and a `window.SEASON` API
    (`isEnabled`, `isWithinWindow`, `defaultAccent`, `getToggle`, `setToggle`, `refresh`);
  - injecting `halloween.css` and the hand-drawn SVG decorations (pumpkins, cobwebs,
    bats, leaves), and the home-page pumpkin Easter egg.
  - It runs **before** `theme.js` on purpose: `window.SEASON` has to exist synchronously
    so `theme.js`'s own first-paint `apply()` can ask for the seasonal default accent
    with no flash of the wrong colour.
- **`halloween.css`** (new) holds the look itself: the warm orange→purple (dark) /
  pumpkin-and-cream (light) background tint, all decoration placement, sizing, phone
  scaling, and the `prefers-reduced-motion` / `prefers-contrast` overrides. It is
  **always loaded** (and inert by default, `display:none`) on any page `season.js` runs
  on, precisely so the picker's toggle works live, any day of the year, with no reload.
- **`theme.js`**: a genuinely small hook — one line in `apply()` so the seasonal accent
  is the *default* (`t.accent || window.SEASON.defaultAccent(mode) || <old default>`,
  so a user's own choice always wins), a `season:change` listener so the toggle updates
  the accent live, and a "🎃 Halloween-Look" On/Off row added to the existing picker
  popup (reusing its `.th-modes` styling).
- **`i18n-dict.js`**: three new keys (`halloween.sectionTitle`, `halloween.on`,
  `halloween.off`) in **lb/de/en**. Note: the site's shared `i18n-dict.js`/`i18n.js`
  system only ever supports lb/de/en (`i18n.js`'s `LANGS = ["lb","de","en"]`) — French
  only exists in the separately generated `/trails/` and `/mtb/` page clusters, which
  don't use this dictionary at all. Adding a French key here would be the only "fr"
  entry in the whole file, so I matched the dictionary's real convention instead of
  the brief's literal "lb/de/en/fr" and documented the deviation here.
- Every page that loads `theme.js` (67 files) now also loads `season.js`, and
  `theme.js` was bumped `?v=30` → `?v=31`, `i18n-dict.js` `?v=51` → `?v=52`, each bumped
  **once**, in every referencing file, in one pass — verified by
  `scripts/check_site.py`'s `cache` check, which passes clean.

### Where it shows / doesn't show

Shows on every normal page, including the arcade shell `pixelbreak.html` (lobby +
tiles) — confirmed in the screenshots and the flow.

Excluded, by design, with a dedicated test for each:

- **Any iframe** (`window.top !== window`) — covers the sandboxed `srcdoc` game frame.
- **`pb/*.html`** — these never load `theme.js`/`season.js` at all (confirmed:
  `grep -rl theme.js pb/` is empty), so there's nothing to exclude at runtime; `season.js`
  also carries an explicit `/\/pb\//i` path check as a second line of defence.
- **Every standalone game page** — not just the 3 reachable from the arcade's `go:`
  entries (`wordle.html`, `geometrydash.html`, `mordsfall.html`), but **all 16** pages
  that load `pb/arcade-kit.js` with `data-arcade-id` (battleship, checkers, color,
  connect4, dice-duel, dots, draw, intro, maumau, meme, reversi, slf, tictactoe, plus
  the three above) — these are "the games themselves" just as much as anything under
  `pb/`, even though the brief's technical bullet only named the `pb/` ones explicitly.
  Each now carries `data-no-season` on `<html>`. **This marker is load-bearing, not
  decorative**: `season.js` runs in `<head>`, before the parser has even reached that
  page's *own* `<script src="pb/arcade-kit.js" data-arcade-id>` tag further down the
  document, so checking for that script synchronously at that point would miss it on
  first paint and the look would flash on before anything could correct it. The
  attribute has no such ordering problem. The script-tag check stays too, as defence
  for any future game page that forgets the marker.
- **`/trails/` and `/mtb/`** — trivially safe: neither cluster loads `theme.js` at all.

## Contrast numbers

Computed with the site's own `glass-contrast.js` (`contrastRatio`, `themeContrastValues`)
against the real palette colours, for the **pessimistic case** of both radial-gradient
background tints overlapping at full nominal alpha (in the real CSS they sit in opposite
corners and rarely both reach full strength at the same point — this is a deliberate
upper bound, not the typical case):

| Case | Ratio | AA (≥4.5) |
|---|---|---|
| dark `--text` on plain `--bg` | 15.82:1 | PASS |
| dark `--text` on tinted `--bg` (worst case) | 13.02:1 | PASS |
| dark `--muted` on plain `--bg` | 5.64:1 | PASS |
| dark `--muted` on tinted `--bg` (worst case) | **4.65:1** | PASS |
| light `--text` on plain `--bg` | 16.11:1 | PASS |
| light `--text` on tinted `--bg` (worst case) | 13.72:1 | PASS |
| light `--muted` on plain `--bg` | 5.45:1 | PASS |
| light `--muted` on tinted `--bg` (worst case) | 4.64:1 | PASS |

The first pass used alphas of `.16`/`.18` for the dark gradients, which gave dark
`--muted` on the worst-case tint only **3.96:1** — a real AA failure. Both alphas were
dropped to `.10` (see `halloween.css`), which brought it to 4.65:1 with a margin, at no
visible cost to the look (screenshots were regenerated against the corrected value).

The seasonal accent itself, run through `themeContrastValues()` exactly as `theme.js`
would at runtime:

| | ratio | needs |
|---|---|---|
| dark `--accent-text` (`#ff8a3d`) on glass `#151524` | 7.69:1 | ≥4.5 |
| light `--accent-text` (`#c2540f`) on glass `#fefeff` | 4.56:1 | ≥4.5 |

Decorations are `pointer-events:none` and `aria-hidden` by default (verified by the
flow); the one deliberate exception is the home-page footer pumpkin (the Easter egg),
which gets `pointer-events:auto`, a real `role="button"`/`tabindex`/`aria-label`, and a
visible focus ring — it's interactive on purpose, so it's excluded from that check by
name in the flow rather than silently making every decoration clickable.

## Screenshots

`reports-cloud/halloween/` — 63 JPEGs (each ≤250KB, largest is 175KB) plus one
`contact-sheet.jpg` (209KB) tying them together.

- **Full matrix** (Chromium + WebKit × desktop 1440×900 + phone 375×812 × dark + light
  × season on/off = 16 combinations) for **`index.html`** and **`pixelbreak.html`**,
  the two pages the brief calls out by name.
- **Reduced matrix** for `about.html`, `leaderboard.html`, `messenger.html`, and
  `grades.html` (the school-tool page): Chromium desktop × dark/light × on/off (4),
  plus one WebKit-desktop-dark-on shot and one Chromium-phone-dark-on shot each (6
  total) — enough to prove every axis works on every required page without doubling
  the full 16-shot matrix six more times.
- `game-mtb_{chromium,webkit}_desktop.jpg` — `pb/mtb.html` loaded directly: no
  `theme.js`, no decorations, confirms a game page is untouched even with
  `?season-date=2026-10-31` in the URL.
- `arcade-game-open_{chromium,webkit}_desktop.jpg` — the arcade lobby (themed) with a
  Tic-Tac-Toe round open in its sandboxed iframe (not themed).
- `index_footer_pumpkin_*.jpg` / `index_footer_easter-egg_*.jpg` — the footer pumpkin,
  and the laugh bubble after clicking it.

Two honest caveats visible in the shots: the ad hoc screenshot script (unlike the real
flow harness) doesn't mock Supabase, so `leaderboard.html` is caught mid-"Loading…" and
`messenger.html` renders mostly its header while signed out — both still clearly show
the seasonal background/accent, which is what the shot is for.

## Gate results

- **`python3 scripts/check_site.py`** — passes. Only warning: the pre-existing orphan
  `karttracker-ios-privacy.html` (unrelated to this branch).
- **`scripts/flows/halloween.mjs`** (new, registered in `run_all.mjs`) — **PASS**, all
  six required checks: season on 31 Oct on home + arcade; off on 5 Nov; never set
  inside `pb/*.html` or the arcade's sandboxed iframe (checked by reaching into the
  iframe's own document); the picker toggle works live and survives a reload
  (`localStorage`); every ambient decoration is `pointer-events:none`; zero console
  errors across the whole flow.
- **Regression flows touching the home page / arcade**: `arcade-pad`,
  `leaderboard-tags`, `account-check`, `cc-signin-hint`, `arcade-weekly-streak`,
  `idle-rebirth-halloween` — all **PASS**. `account-check` caught a real bug on the
  first pass (see below), fixed and re-verified.
- **`test-mode`** flow: fails with a `#menuBtn` click timeout in `pb/fouer.html`. Confirmed
  **pre-existing on a clean `origin/main` checkout** (same failure, same timeout, no
  Halloween code present) — an environment/timing flake in this sandbox, not a
  regression from this branch.
- A real regression was found and fixed during testing: the header cobweb/pumpkin used
  negative `top`/`left`/`right` offsets, which on a header flush with the viewport edge
  inflated `document.documentElement.scrollWidth` even though `overflow-x:hidden`
  hid it visually — `account-check`'s "Arcade header does not scroll sideways" check
  caught it immediately. Fixed by moving every corner decoration to small positive
  insets, fully inside its container (commit `90fb1609`).

## Anything not done / scoped down

- **Section-title glyphs** ("section titles may get a small pumpkin or bat glyph") —
  explicitly optional in the brief, skipped for time.
- The full 16-combination screenshot matrix was done for `index.html` and
  `pixelbreak.html` only; other required pages got a smaller but still
  cross-browser/cross-viewport/cross-theme set (see above) rather than the full cross
  product six more times, to keep the artifact count and repo size sane.
- The complete `scripts/flows/run_all.mjs` suite (60+ flows, many touching unrelated
  systems — trains, karts, inbox, Schueberfouer) was not run end-to-end; only the
  flows plausibly touching the home page, the arcade, or the picker were, per the
  brief's own instruction ("run any existing flows that touch the home page or
  arcade").

## v2 — "far too subtle" fixed: a real sky, not a tint

v1 passed every gate and every flow, but looked almost exactly like the normal site —
reviewing it honestly next to the brief ("orange backgrounds a bit and pumpkins, and
let it be beautiful"), the background tint was tuned so conservatively for contrast
that it read as barely-there. v2 keeps the exact same plumbing (`season.js`,
`halloween.css`, the `data-season` attribute, the exclusions, the toggle) and replaces
only the look itself, fixing contrast with **backing** (scrims, a protected moon strip)
instead of **removing colour**.

### What changed

- **Background, dark mode**: `html[data-season="halloween"] body` is now a real
  purple-to-rust gradient (`#130b28 → #1f1038 → #30123a → #30150f → #2a0f08`), anchored
  in `vh` (not `%`) so the colour travel always fits inside roughly the first screenful
  on any page, any content length, and fades back to the plain `--bg` by ~124vh down —
  never the muddy, half-visible overlay v1 used.
- **Background, light mode**: a real cream-to-apricot gradient (`#fff6ea → #ffeed7 →
  #ffe6c3 → #ffe0b3`), same vh-anchoring, clearly orange — not grey-white.
- **The hero (`.today-hero` on the home page, `.arc-hero` on the arcade) gets its own,
  much more vivid sky** (`#241240 → #4a1c52 → #9c3a22 → #ffb347`, dark; a warm
  `#fff3e0 → #f2862e` sunset, light) — allowed to be brighter than the page-wide tint
  because its text sits over a **scrim**: a flat, uniform overlay (`rgba(15,6,3,.85)`
  dark / `rgba(255,250,242,.82)` light) that fades out over just the top 8% of the hero
  (so it blends softly into the header instead of reading as a hard dark box) and is
  flat for the rest — i.e. everywhere the real text and the pumpkin patch actually are.
- **A big, clearly bright full moon + a handful of faint stars** behind the home hero,
  dark mode only. This is the one place v1-style "protect everything with the same
  scrim" broke down: a moon bright enough to actually read as a moon, scrimmed at the
  same alpha as the text, was either invisible or (if left unscrimmed) occasionally sat
  right behind the "Gudden Owend" kicker at in-between viewport widths and wrecked its
  contrast — confirmed by rendering it and sampling the actual pixels (not just the
  math), which is also how the first version of this fix was caught before it shipped.
  The real fix: the moon and stars live in their own absolutely-positioned,
  `overflow:hidden` strip (`.hw-moon-zone`) pinned to the top of the hero, sized to
  exactly the extra `padding-top` reserved for it (80px desktop / 46px phone) and drawn
  **above** the scrim in the background-layer stack (CSS paints the first-listed layer
  on top) — so it is always fully bright, and it is now *structurally* impossible for
  its glow to reach the text below, at any viewport width, because the clipping box
  itself ends where the text begins.
- **A proper pumpkin patch**: one combined hand-drawn SVG (not five separate elements)
  of 5 jack-o'-lanterns (home) / 3 (arcade) at varying sizes, each with a stem, ribs, a
  glowing carved face, a soft drop shadow so they read as sitting on the ground, and
  all strung along one curly vine with a few leaves — `preserveAspectRatio="none"` so
  it always exactly fills its strip at the bottom of the hero (no cropping, ever,
  regardless of the strip's aspect ratio at a given viewport — the earlier version used
  `slice`, which silently cropped the pumpkins at in-between widths). One pumpkin per
  patch (the centre one) gets the glow-flicker animation. The pre-existing footer
  pumpkin (with its click Easter egg) is unchanged.
- **The cobweb is now a real textbook cobweb**: 6 straight spokes from one pivot in the
  exact corner, crossed by 4 true concentric circular arcs (actual SVG `A` commands at
  matching radii, not wobbly Bézier curves) — not the "scribble" of straight
  corner-to-corner diagonals v1 had. A small spider (round body, legs, a short thread)
  hangs near the pivot and bobs gently (`prefers-reduced-motion` turns it off, as
  before).
- **Bats**: 3 silhouettes (up from 2), `~20–24s` cycles with staggered delays, so one
  crosses the top of the hero roughly every ~20s as asked, instead of the slower
  ~45–55s drift v1 had.
- **A little 🎃 after every `.sec-title` heading** (pure CSS `::after`, e.g. "Deng
  Apps 🎃", "Grouss Spiller 🎃") — this was the one explicitly-optional item v1 skipped;
  it's in now, for free, no JS needed.
- **A static, zero-cost fog band** (`body::after`, fixed to the bottom of the
  viewport, a plain opacity gradient, no animation) for a touch more atmosphere.
- Removed the old top-right arcade-header mini pumpkin — redundant once the arcade
  hero has its own 3-pumpkin patch; one clear pumpkin motif per screen area reads
  better than two different ones stacked in the same header.

### Contrast — v2 numbers (swept, not just spot-checked)

Verified three ways: (1) analytically, by sampling the actual gradient function at
~200 points along its travel (not just the declared stops, since CSS interpolates
between them) and computing WCAG contrast at each with the site's own
`relativeLuminance`/`contrastRatio` formulas; (2) against the scrim's single
worst-case brightest point; (3) empirically, by rendering real pages and sampling
actual pixels behind real text — which is what caught the moon/kicker overlap below
before it shipped.

| Case | Worst ratio | AA (≥4.5) |
|---|---|---|
| dark page-wide tint: `--text` on body (any point in the gradient) | 13.53:1 | PASS |
| dark page-wide tint: `--muted` on body (any point in the gradient) | **4.83:1** | PASS |
| light page-wide tint: `--text` on body | 13.83:1 | PASS |
| light page-wide tint: `--muted` on body | **4.68:1** | PASS |
| dark hero scrim: `--text`, worst case (scrim over the sky's single brightest stop) | 13.35:1 | PASS |
| dark hero scrim: `--muted`, worst case | **4.76:1** | PASS |
| light hero scrim: `--text`, worst case | 14.43:1 | PASS |
| light hero scrim: `--muted`, worst case | **4.88:1** | PASS |
| dark card/glass (tile text) on the worst page-wide tint point | 14.54:1 / muted 5.19:1 | PASS |
| light card/glass (tile text) on the worst page-wide tint point | 17.14:1 / muted 5.80:1 | PASS |

Card opacity was re-checked against the brief's "bump it if needed" — not needed: the
existing 90–92% `--card` mix already keeps tile text comfortably clear (5.19:1 /
5.80:1 worst case) against the new, more saturated page-wide tint, so it was left as
is rather than bumped for no visible gain.

The moon/star strip and the pumpkin patch are **not** part of this contrast budget by
construction, not by argument: the moon strip is a separately clipped box that ends
exactly where the extra padding (and therefore the text) begins, and the patch sits at
the very bottom of the hero, below where any text is laid out — so there is no
position at which real text and either of them can ever occupy the same pixels,
regardless of login state, language, or viewport width.

### Review round-trip that shaped this

A first pass of v2 (vivid sky + a flat full-hero scrim + moon/stars drawn directly
into the hero's own `background`, same stacking context as the scrim) looked right on
the two viewports it was eyeballed at (1440 and 375) but was wrong at iPad width
(820): the moon's glow is fixed-radius in px while its anchor is a `%` position, so at
in-between widths it drifted into the "Gudden Owend" kicker text and crushed its
contrast to ~1.1:1 — invisible on a quick look, confirmed by sampling the actual
rendered pixel. Re-architected as the clipped `.hw-moon-zone` strip described above,
which makes the overlap structurally impossible instead of merely unlikely at the two
viewports that got eyeballed. The same pass also found the pumpkin patch getting
cropped at its own in-between-width aspect ratios (`preserveAspectRatio="slice"`
quietly crops) — fixed by switching to `"none"` (exact-fill, no crop, ever) and giving
the patch SVG a real ground margin. Both fixes were verified again at 375 / 820 / 1440
before moving on, not just at the one width that showed the original bug.

### Screenshots

`reports-cloud/halloween/v2/` — the home/arcade full matrix (Chromium + WebKit ×
desktop 1440×900 + phone 375×812 × dark + light, season on, 16 shots), a reduced
matrix for `about.html` / `leaderboard.html` / `grades.html` (Chromium desktop
dark+light + one Chromium-phone-dark shot each), the two exclusion proofs
(`game-mtb_chromium_desktop.jpg`, `arcade-game-open_chromium_desktop.jpg`), a
`contact-sheet.jpg`, and three `before_after_*.jpg` pairs (home dark, home light,
arcade dark) against the actual v1 screenshots in `reports-cloud/halloween/` — the
difference is immediately obvious side by side, which was the point.

### Gates (re-run against v2)

- **`scripts/flows/halloween.mjs`** — PASS, all checks (season on/off by date, never
  themed inside a game or its iframe, toggle works live and survives reload, every
  ambient decoration is `pointer-events:none`, zero console errors).
- **`python3 scripts/check_site.py`** — passes; only the pre-existing orphan warning
  (`karttracker-ios-privacy.html`, unrelated to this branch).
- **Regression flows touching the home page / arcade**: `account_check`,
  `leaderboard_tags`, `arcade_pad`, `cc_signin_hint`, `arcade_weekly_streak`,
  `idle_rebirth_halloween` — all **PASS**, including the horizontal-scroll checks that
  caught the v1 corner-decoration regression (still clean under v2's bigger cobweb).
- `?v=` bumped once per changed asset, every time either file changed, across the full
  pass: `season.js` `?v=1 → ?v=4` (67 files) and the internal `halloween.css` asset URL
  `?v=1 → ?v=4` (season.js's own constant) — each bump covers a real content change,
  not a cosmetic touch.
