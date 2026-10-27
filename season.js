/* season.js — seasonal decoration layer for ian.lu (currently: Halloween).
 *
 * Loaded as a plain classic <script> BEFORE theme.js on every page that wants
 * seasonal theming, so window.SEASON exists synchronously by the time theme.js
 * runs its own first-paint apply() — no flash of the wrong default accent.
 *
 * What it owns:
 *   - the date window (Europe/Luxembourg) that turns the look on/off by itself
 *   - the user's own on/off override (localStorage, read by the theme picker)
 *   - the exclusion rules: never inside a game, never inside an iframe
 *   - the <html data-season="halloween"> attribute halloween.css is scoped to
 *   - the hand-drawn SVG decorations (pumpkins, cobwebs, bats, leaves)
 *
 * Next year: change HALLOWEEN_START_MONTH_DAY / HALLOWEEN_END_MONTH_DAY (and
 * the two SEASON_ACCENT_* colours if the look changes) — nothing else here is
 * date-specific.
 *
 * Kept deliberately separate from theme.js (which only asks window.SEASON for
 * the one thing it needs: a seasonal default accent) so the two stay small and
 * independently testable. */
(function () {
  "use strict";

  var HALLOWEEN_START_MONTH_DAY = "10-24";
  var HALLOWEEN_END_MONTH_DAY = "11-02";
  var SEASON_TIME_ZONE = "Europe/Luxembourg";
  var SEASON_ATTRIBUTE = "data-season";
  var SEASON_VALUE = "halloween";
  var TOGGLE_KEY = "site_halloween";
  var OVERRIDE_PARAM = "season-date"; // ?season-date=2026-10-31 — this tab only, never persisted
  var SEASON_ACCENT_DARK = "#ff8a3d";
  var SEASON_ACCENT_LIGHT = "#c2540f";
  var DECORATED_FLAG = "hwDecorated";

  var HERE = new URL(".", document.currentScript ? document.currentScript.src : location.href);
  var HALLOWEEN_CSS_URL = new URL("halloween.css?v=5", HERE).href;

  function monthDayIn(date, timeZone) {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone, month: "2-digit", day: "2-digit" }).formatToParts(date);
    var month, day;
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].type === "month") month = parts[i].value;
      if (parts[i].type === "day") day = parts[i].value;
    }
    return month + "-" + day;
  }

  function overrideDate() {
    try {
      var raw = new URLSearchParams(location.search).get(OVERRIDE_PARAM);
      if (!raw) return null;
      var parsed = new Date(raw + "T12:00:00");
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (error) {
      return null; // malformed query string: behave as if no override was given
    }
  }

  function isWithinHalloweenWindow(date) {
    var monthDay = monthDayIn(date || overrideDate() || new Date(), SEASON_TIME_ZONE);
    return monthDay >= HALLOWEEN_START_MONTH_DAY && monthDay <= HALLOWEEN_END_MONTH_DAY;
  }

  // The games themselves, and anything running inside an iframe, must never be
  // themed — however this script ended up loaded there.
  //
  // `data-no-season` on <html> is the explicit, synchronous marker for a
  // standalone game page (wordle.html, geometrydash.html, mordsfall.html, …):
  // season.js runs in <head>, before the parser has even reached that page's
  // OWN <script src="pb/arcade-kit.js" data-arcade-id> tag further down, so
  // checking for that script here would miss it on first paint. The attribute
  // has no such ordering problem. The script-tag check is kept too, as a
  // second line of defence for any future game page that forgets the marker
  // (it still protects the DOM-injected decorations, added after full parse).
  function isExcludedContext() {
    if (document.documentElement.hasAttribute("data-no-season")) return true;
    if (window.top !== window) return true; // any iframe, including a game's own sandboxed srcdoc frame
    if (/\/pb\//i.test(location.pathname)) return true; // pb/*.html game pages, if ever loaded top-level
    if (/^\/(trails|mtb)\//i.test(location.pathname)) return true; // generated SEO clusters
    if (document.querySelector('script[src*="arcade-kit.js"][data-arcade-id]')) return true;
    return false;
  }

  function readToggle() {
    try {
      var value = localStorage.getItem(TOGGLE_KEY);
      return value === "on" || value === "off" ? value : null;
    } catch (error) {
      return null; // private mode: behave as if nothing was ever chosen
    }
  }

  function writeToggle(value) {
    try { localStorage.setItem(TOGGLE_KEY, value ? "on" : "off"); } catch (error) { /* private mode: not remembered this session */ }
  }

  function isEnabled() {
    if (isExcludedContext()) return false;
    var toggle = readToggle();
    if (toggle === "on") return true;
    if (toggle === "off") return false;
    return isWithinHalloweenWindow();
  }

  function defaultAccent(mode) {
    if (isExcludedContext() || !isEnabled()) return null;
    return mode === "light" ? SEASON_ACCENT_LIGHT : SEASON_ACCENT_DARK;
  }

  function injectStylesheet(url) {
    if (document.querySelector('link[href="' + url + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
  }

  function applyAttribute() {
    if (isExcludedContext()) {
      document.documentElement.removeAttribute(SEASON_ATTRIBUTE);
      return false;
    }
    injectStylesheet(HALLOWEEN_CSS_URL); // always loaded (scoped + display:none by default) so the toggle works live, any day of the year
    var on = isEnabled();
    if (on) document.documentElement.setAttribute(SEASON_ATTRIBUTE, SEASON_VALUE);
    else document.documentElement.removeAttribute(SEASON_ATTRIBUTE);
    return on;
  }

  function setToggle(enabled) {
    writeToggle(enabled);
    applyAttribute();
    document.dispatchEvent(new CustomEvent("season:change", { detail: { enabled: isEnabled() } }));
  }

  var enabledNow = applyAttribute(); // run synchronously, before theme.js's own first apply()

  // ---------------------------------------------------------------- decorations
  var svgIdCounter = 0;
  function nextId(prefix) { svgIdCounter += 1; return prefix + svgIdCounter; }

  // One jack-o'-lantern, drawn in its own 120x118 box (round: body 104x84 plus
  // stem and leaf) so it keeps its natural proportions at every size — it is
  // always sized by width alone, never stretched to fit a strip. Five ribbed
  // lobes, each shaded left-to-right, a curved stem, a leaf with a tendril, a
  // warm glow carved through eyes / nose / zig-zag grin, and a soft ground
  // shadow whose centre sits on the viewBox's bottom edge region (so CSS can
  // stand the pumpkin ON a ground line). `glowClass` lets one pumpkin per hero
  // pulse its inner glow (opacity only).
  function pumpkinSvg(extraClass, glowClass) {
    var id = nextId("hwPk");
    var lobe = function (cx, rx, ry) {
      return '<ellipse cx="' + cx + '" cy="68" rx="' + rx + '" ry="' + ry + '" fill="url(#' + id + 'b)" stroke="#9c3607" stroke-width="1.4" stroke-opacity=".7"/>';
    };
    var eyeL = "M30 66L40 50L50 66Z";
    var eyeR = "M70 66L80 50L90 66Z";
    var nose = "M56 74L60 67L64 74Z";
    var mouth = "M29 79L40 84L47 79L55 86L60 80L65 86L73 79L80 84L91 79Q88 96 60 99Q32 96 29 79Z";
    var carve = function (d) {
      return '<path d="' + d + '" fill="url(#' + id + 'f)" stroke="#6b2203" stroke-width="1.8" stroke-linejoin="round"/>';
    };
    var halo = function (d) {
      return '<path d="' + d + '" fill="none" stroke="#ffd36a" stroke-width="5" stroke-linejoin="round" opacity=".28"/>';
    };
    return (
      '<svg class="hw-pumpkin-art' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 120 118" aria-hidden="true" focusable="false">' +
      "<defs>" +
      '<linearGradient id="' + id + 'b" x1="0" x2="1" y1="0" y2="0">' +
      '<stop offset="0" stop-color="#bd4709"/><stop offset=".3" stop-color="#ee741b"/><stop offset=".52" stop-color="#ff9b3d"/>' +
      '<stop offset=".74" stop-color="#ee741b"/><stop offset="1" stop-color="#b94309"/></linearGradient>' +
      '<radialGradient id="' + id + 's" cx=".5" cy=".4" r=".72"><stop offset=".6" stop-color="#501600" stop-opacity="0"/><stop offset="1" stop-color="#501600" stop-opacity=".5"/></radialGradient>' +
      '<radialGradient id="' + id + 'f" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#fff4b8"/><stop offset=".55" stop-color="#ffc23d"/><stop offset="1" stop-color="#ff8a1f"/></radialGradient>' +
      '<radialGradient id="' + id + 'g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd66e" stop-opacity=".7"/><stop offset="1" stop-color="#ff9628" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 't" x1="0" x2="1"><stop offset="0" stop-color="#8aa63c"/><stop offset="1" stop-color="#46601d"/></linearGradient>' +
      "</defs>" +
      '<ellipse cx="60" cy="112.5" rx="50" ry="5" fill="#000" opacity=".38"/>' +
      lobe(24, 21, 35) + lobe(96, 21, 35) + lobe(40, 23, 40) + lobe(80, 23, 40) + lobe(60, 21, 42) +
      '<ellipse cx="60" cy="68" rx="54" ry="42" fill="url(#' + id + 's)"/>' +
      '<ellipse cx="38" cy="45" rx="9" ry="5" fill="#fff" opacity=".2" transform="rotate(-25 38 45)"/>' +
      '<circle class="hw-pumpkin-glow' + (glowClass ? " " + glowClass : "") + '" cx="60" cy="74" r="40" fill="url(#' + id + 'g)"/>' +
      halo(eyeL) + halo(eyeR) + halo(nose) + halo(mouth) +
      carve(eyeL) + carve(eyeR) + carve(nose) + carve(mouth) +
      '<ellipse cx="61" cy="30" rx="9" ry="3.5" fill="#7a2c05" opacity=".6"/>' +
      '<path d="M67 31C76 20 92 20 98 27C92 36 76 37 67 31Z" fill="#4f8a2c" stroke="#33601c" stroke-width="1"/>' +
      '<path d="M69 30Q84 27 96 27" fill="none" stroke="#2f5a18" stroke-width="1" opacity=".8"/>' +
      '<path d="M70 22C78 12 90 14 88 20C86 24 81 22 83 19" fill="none" stroke="#5f9a35" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M55 35C52 25 56 15 65 9C69 8 72 10 70 13C64 19 64 26 67 35Z" fill="url(#' + id + 't)" stroke="#3a4d17" stroke-width="1" stroke-linejoin="round"/>' +
      "</svg>"
    );
  }

  // Pumpkin patch for the bottom of a hero: each pumpkin is its own element,
  // positioned by % across the FULL viewport width (the hero's sky layer is
  // full-bleed) and sized in px, so none is ever stretched or clipped. `x` is
  // the centre as a % of the viewport, `w` the desktop width in px (48-120;
  // halloween.css scales it down on phones), `tilt` degrees, `flip` mirrors it,
  // `extra` hides it on narrow screens, `lit` gives it the pulsing glow.
  var HOME_PUMPKINS = [
    { x: 7, w: 58, tilt: -7, flip: 1 },
    { x: 20, w: 88, tilt: 4, flip: -1 },
    { x: 34, w: 62, tilt: 0, flip: 1, extra: true },
    { x: 50, w: 120, tilt: -2, flip: 1, lit: true },
    { x: 65, w: 76, tilt: -5, flip: -1 },
    { x: 80, w: 104, tilt: 5, flip: 1 },
    { x: 93, w: 52, tilt: 9, flip: -1, extra: true },
  ];
  var ARCADE_PUMPKINS = [
    { x: 8, w: 62, tilt: -6, flip: 1 },
    { x: 28, w: 92, tilt: 4, flip: -1 },
    { x: 52, w: 118, tilt: -1, flip: 1, lit: true },
    { x: 74, w: 70, tilt: -6, flip: -1, extra: true },
    { x: 89, w: 100, tilt: 6, flip: 1 },
  ];
  function patchHtml(slots) {
    return slots.map(function (slot) {
      return '<span class="hw-pk' + (slot.extra ? " hw-pk--extra" : "") + '" style="left:' + slot.x + "%;--w:" + slot.w +
        "px;--tilt:" + slot.tilt + "deg;--flip:" + slot.flip + '">' + pumpkinSvg("", slot.lit ? "hw-pumpkin-glow--lit" : "") + "</span>";
    }).join("");
  }

  // A clean radial + spiral cobweb (not a scribble): true straight spokes
  // from one pivot in the corner, crossed by true concentric circular arcs
  // (real SVG arcs, not wobbly curves) — the textbook cobweb construction,
  // so it reads as an actual web at a glance even at a few dozen px.
  function cobwebSvg() {
    return (
      '<svg class="hw-cobweb-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-linecap="round">' +
      '<path stroke-width="1.3" opacity=".85" d="M0 0L61.4 8.6M0 0L56.6 25.2M0 0L47.5 39.9M0 0L34.7 51.4M0 0L19.2 59M0 0L2.2 62"/>' +
      '<path stroke-width="1.1" opacity=".7" d="M13.9 2A14 14 0 0 1 .5 14"/>' +
      '<path stroke-width="1.1" opacity=".7" d="M25.8 3.6A26 26 0 0 1 .9 26"/>' +
      '<path stroke-width="1" opacity=".6" d="M39.6 5.6A40 40 0 0 1 1.4 40"/>' +
      '<path stroke-width="1" opacity=".5" d="M55.5 7.8A56 56 0 0 1 2 56"/>' +
      "</g></svg>"
    );
  }

  // Small spider dangling on its own thread, drawn separately from the web
  // so it can bob independently.
  function spiderSvg() {
    return (
      '<svg class="hw-spider-art" viewBox="0 0 20 24" aria-hidden="true" focusable="false">' +
      '<line x1="10" y1="0" x2="10" y2="9" stroke="currentColor" stroke-width="1.1" opacity=".6"/>' +
      '<g fill="currentColor">' +
      '<path d="M2 13q8-6 16 0M2 17q8 5 16 0M5 10l-3-3M15 10l3-3M5 18l-3 3M15 18l3 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".95"/>' +
      '<ellipse cx="10" cy="15" rx="3.2" ry="4"/>' +
      '<circle cx="10" cy="10" r="2.4"/>' +
      "</g></svg>"
    );
  }

  function batSvg() {
    return (
      '<svg class="hw-bat-art" viewBox="0 0 48 26" aria-hidden="true" focusable="false">' +
      '<path d="M24 11c-2-6-10-9-24-7 7 2 12 5 15 9-6 0-12 3-15 8 9 1 16-2 21-7 1 2 2 4 3 5 1-1 2-3 3-5 5 5 12 8 21 7-3-5-9-8-15-8 3-4 8-7 15-9-14-2-22 1-24 7z" fill="currentColor"/>' +
      "</svg>"
    );
  }

  function leafSvg() {
    return (
      '<svg class="hw-leaf-art" viewBox="0 0 28 28" aria-hidden="true" focusable="false">' +
      '<path d="M14 2c7 3 11 9 11 15-4 2-9 2-11-1-2 3-7 3-11 1 0-6 4-12 11-15z" fill="currentColor"/>' +
      '<path d="M14 2v24" stroke="#00000022" stroke-width="1"/>' +
      "</svg>"
    );
  }

  function ensureAnchor(element) {
    if (!element) return null;
    if (getComputedStyle(element).position === "static") element.classList.add("hw-anchor");
    element.classList.add("hw-isolate");
    return element;
  }

  function addDecoration(container, html, extraClass) {
    var holder = document.createElement("div");
    holder.className = "hw-deco " + extraClass;
    holder.setAttribute("aria-hidden", "true");
    holder.innerHTML = html;
    ensureAnchor(container).appendChild(holder);
    return holder;
  }

  function addHeroFx(hero, slots, withMoon) {
    ensureAnchor(hero);
    var layer = document.createElement("div");
    layer.className = "hw-hero-fx";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML =
      (withMoon ? '<span class="hw-moon-zone"></span>' : "") +
      '<span class="hw-ground"></span>' +
      patchHtml(slots) +
      '<span class="hw-bat hw-bat--a">' + batSvg() + "</span>" +
      '<span class="hw-bat hw-bat--b">' + batSvg() + "</span>" +
      '<span class="hw-bat hw-bat--c">' + batSvg() + "</span>" +
      '<span class="hw-leaf hw-leaf--a">' + leafSvg() + "</span>" +
      '<span class="hw-leaf hw-leaf--b">' + leafSvg() + "</span>";
    hero.appendChild(layer);
  }

  function wireEasterEgg(pumpkinHolder) {
    if (!pumpkinHolder) return;
    var art = pumpkinHolder.querySelector(".hw-pumpkin-art");
    if (!art) return;
    pumpkinHolder.classList.add("hw-deco--interactive");
    pumpkinHolder.setAttribute("role", "button");
    pumpkinHolder.setAttribute("tabindex", "0");
    pumpkinHolder.setAttribute("aria-hidden", "false");
    pumpkinHolder.setAttribute("aria-label", "🎃");
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var laughing = false;
    function laugh() {
      if (laughing) return;
      laughing = true;
      pumpkinHolder.classList.add("hw-deco--active");
      if (!reduceMotion) art.classList.add("hw-pumpkin-art--flicker");
      var bubble = document.createElement("span");
      bubble.className = "hw-pumpkin-laugh";
      bubble.textContent = "heh heh 😈";
      pumpkinHolder.appendChild(bubble);
      setTimeout(function () {
        pumpkinHolder.classList.remove("hw-deco--active");
        art.classList.remove("hw-pumpkin-art--flicker");
        bubble.remove();
        laughing = false;
      }, 1600);
    }
    pumpkinHolder.addEventListener("click", laugh);
    pumpkinHolder.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); laugh(); }
    });
  }

  function decorate() {
    if (isExcludedContext()) return;
    if (document.body.dataset[DECORATED_FLAG]) return;
    document.body.dataset[DECORATED_FLAG] = "1";

    var header = document.querySelector("body > header, header.ui-header, header.bar");
    var footer = document.querySelector("footer");
    var hero = document.querySelector(".today-hero, .arc-hero"); // only the two heroes that carry the sky
    var isArcadeLobby = !!document.querySelector(".arc-hero");
    var isHomePage = document.body.classList.contains("home");

    if (header) {
      addDecoration(
        header,
        cobwebSvg() + '<span class="hw-spider">' + spiderSvg() + "</span>",
        "hw-deco--cobweb hw-deco--corner-tl"
      );
    }

    var footerPumpkin = null;
    if (footer) footerPumpkin = addDecoration(footer, pumpkinSvg("", ""), "hw-deco--pumpkin hw-deco--corner-br hw-deco--mini");
    if (hero) addHeroFx(hero, isArcadeLobby ? ARCADE_PUMPKINS : HOME_PUMPKINS, isHomePage);
    if (isHomePage && footerPumpkin) wireEasterEgg(footerPumpkin);
  }

  function bootDecorations() {
    if (document.body) decorate();
    else document.addEventListener("DOMContentLoaded", decorate);
  }
  bootDecorations();

  window.SEASON = Object.freeze({
    isWithinWindow: isWithinHalloweenWindow,
    isExcludedContext: isExcludedContext,
    isEnabled: isEnabled,
    defaultAccent: defaultAccent,
    getToggle: readToggle,
    setToggle: setToggle,
    refresh: applyAttribute,
  });
})();
