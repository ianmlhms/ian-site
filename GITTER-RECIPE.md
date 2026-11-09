# Gitter recipe: convert a page to the new look

Reference pages: `profile.html` (form + stats), `pixelbreak.html` (listing + tiles), `index.html` (home, own `home.css`).
Look: one hairline grid, radius 0, paper `#f6f6f3` / ink `#16171a` / ONE green `#1f7a4d`, Geist + Geist Mono, Luxembourgish only. Light AND dark (Gitter-dark, Nov 2026, see section 6).

## 1. Head
- `<html lang="lb">`, then as the FIRST thing after the charset/viewport metas: `<script src="gitter-theme.js?v=1"></script>` (sync, no defer: it sets `<html data-theme>` before first paint and injects the header toggle) and the theme-color pair `<meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)" data-gt="light">` + `<meta name="theme-color" content="#121314" media="(prefers-color-scheme: dark)" data-gt="dark">`.
- Add `<link rel="preload" href="assets/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>` and `<link rel="stylesheet" href="gitter.css?v=N">` (bump N when gitter.css changes; update every page that loads it).
- Keep `theme.js`, `i18n-dict.js`, `i18n.js` (other scripts need them; the picker is hidden by `body.gt`).
- Drop: `season.js`, `site-ui.css`, old page-level colour/gradient CSS, any language switcher, the Halloween layer.
- Page-only rules go in a small `<style>` after gitter.css; use the tokens (`--ink`, `--muted`, `--soft`, `--green`, `--tint`, `--white`), never hard-coded colours.

## 2. Markup
```html
<body class="gt">
<main class="gt-page">
  <div class="gt-grid">                       <!-- 6 columns, one column on phones -->
    <header class="c full gt-nav">
      <div class="gt-nav-l"><a class="gt-back" href="index.html">‹ Heem</a><h1 class="gt-page-title">Titel</h1></div>
      <div class="gt-navr"><button class="gt-acct" id="gtAcct">Umellen</button></div>
    </header>
    <section class="c half"> ... </section>   <!-- cells: .c + .full / .half / .third -->
    <div class="c full gt-lbl">Rubrik</div>   <!-- tinted label row -->
  </div>
</main>
```
- JS-rendered content: put it in `<div id="x" class="gt-contents">` (display: contents) so its `.c` children are grid cells.
- Nested grids (stats, tiles): see `.gt-stats` in profile.html (container without border, children are `.c`).
- Components in gitter.css: `.gt-btn` (+ `.ghost`), `.gt-input`, `.gt-field`, `.gt-tag`, `.gt-msg` (+ `.err`), `.gt-hint`, `.gt-h`, `.gt-big`, `.gt-link`, `.gt-row`, `.gt-table`, `.gt-toast`, `.gt-panel`, `.gt-mono`. Scripts that still emit `ui-btn` / `ui-card` are styled by compat rules.
- Icons: inline Phosphor `<symbol>` sprite (copy needed symbols from `index.html`), `<svg class="ic"><use href="#i-name"/></svg>`. No emoji as UI icons (emoji are fine as content: avatars, game art).
- Header account button: text only ("Umellen" / username), click -> `auth.openAuthModal`.

## 3. Wording (Luxembourgish)
Follow the homepage: Heem, Umellen, Ofmellen, Späicheren, Gespäichert ✓, Lued …, Zréck, Siche, Kont, Klass, Benotzernumm, Passwuert, Gewonne / Néierlagen, Probéier nach eng Kéier. Translate hint texts and error messages too. Keep `data-i18n` where the dict already has an lb string; otherwise write static lb text.

## 4. Do not touch
Supabase calls / RPC names / table columns, ids that scripts or flows query, URLs and `?param=` contracts, game files in `pb/`, `GAMES` / `BIG_GAME_IDS` (merge conflicts with other branches), `index.html` + `home.css`. Presentation and strings only.

## 5. Test
- Run through the slot wrapper: `python3 ~/Library/Caches/browser-slot.py node scripts/flows/<flow>.mjs` (one at a time, max 2 browsers).
- Run the page's own flow(s) (`grep -l "<page>.html" scripts/flows/*.mjs`) plus `home_page.mjs`. If a flow asserts an old English string or old selector you changed deliberately, update the assertion and say so.
- New page without a flow: copy `scripts/flows/profile_page.mjs` (visitor gate, signed-in render, lb strings, no horizontal scroll at 375 / 820 / 1280, no console errors).
- Look at it at 375 px and 1280 px; touch targets >= 44 px; no horizontal scroll.

## 6. Dark mode (Gitter-dark)
- Default follows the device (`prefers-color-scheme`); the header toggle (`#gtTheme`, injected by `gitter-theme.js` into `.gt-navr`, else `.ui-header .header-right` / `header.bar` / `.studio-bar` ...) cycles Auto -> Hell -> Däischter and stores `localStorage["gt-theme"]`. `html[data-theme="light|dark"]` is always the RESOLVED theme; `data-theme-pref` is auto|light|dark. A page that must stay light puts `data-gt-light` on `<html>` (Mordsfall).
- Palette (tokens on `body.gt` in gitter.css / home.css; the dark set is `html[data-theme="dark"] body.gt` + the same under `@media (prefers-color-scheme: dark) { html:not([data-theme="light"]) body.gt }`): paper `#121314`, surface `--white` `#1a1b1d`, sunk `--sunk` `#222326`, ink `#ececea`, muted `#9a9b98`, grid `--line` `#34363a`, green `#3fae76`, danger `#e5645f`, `--on-green` (text on green/danger fills) `#fff` light / `#07140d` dark.
- Rules for page CSS: never write a literal colour. Use `--paper --white --sunk --ink --muted --line --soft --tint --green --danger --on-green`. Text on a green/danger fill is `var(--on-green)` (never `#fff`: white on the dark-mode green fails AA). Containers use `--line` for borders, controls (buttons, inputs, tags) use `--ink`. Translucent ink: `rgb(var(--ink-rgb) / .28)`; green tints: `color-mix(in srgb, var(--green) 12%, transparent)`. No shadows/glow (they show on dark).
- Page-level `:root{...}` palettes (fs, hotel) need their own dark block: `html[data-theme="dark"]{...}` + the media fallback. Never set colours from JS inline on `<html>` (it beats the stylesheet); canvases read tokens with `getComputedStyle(document.body)` and re-read on a `data-theme` MutationObserver (see fs.html `tokens()`).
- Games: `pb/arcade-ui.css` has the dark board palette (`--bg --card --text --accent ...` and the `--g-*` chrome tokens, plus `--g-on-green --g-veil --g-sunk --g-board --g-card2`). The hub (`pixelbreak.html`, `withTheme()`) writes `data-theme` on the srcdoc game's `<html>`; `arcade-kit.js` resolves it itself when a game runs standalone and follows `postMessage({__gtTheme})`. Own-CSS games: put colours behind `--g-*` tokens (see `tokenize.py` pattern: `:root` light set + `html[data-theme="dark"]` set at the top of the Gitter block). Canvas games that hard-code colours branch on `document.documentElement.getAttribute('data-theme') === 'dark'` inside their draw/render (2048 `TILE_DARK`, dino).
- Contrast: every text/background pair AA (4.5:1; 3:1 for large text and component borders). Verified pairs (dark): ink on paper 15.7, muted on paper 6.7 (on surface 6.2, on sunk 5.6), green on paper 6.7 (on surface 6.2), on-green on green 6.75, on-green on danger 5.7, danger on paper 5.6 (surface 5.2). The grid `--line` is decorative (1.5:1); every control border uses `--ink`.
- Check: screenshot with `FLOW_COLOR_SCHEME=dark` (lib.mjs emulates the scheme), flow `scripts/flows/theme_toggle.mjs`.
