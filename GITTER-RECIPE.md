# Gitter recipe: convert a page to the new look

Reference pages: `profile.html` (form + stats), `pixelbreak.html` (listing + tiles), `index.html` (home, own `home.css`).
Look: one hairline grid, radius 0, paper `#f6f6f3` / ink `#16171a` / ONE green `#1f7a4d`, Geist + Geist Mono, light only, Luxembourgish only.

## 1. Head
- `<html lang="lb">`, `<meta name="theme-color" content="#f6f6f3">`.
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
