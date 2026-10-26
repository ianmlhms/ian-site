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
  var HALLOWEEN_CSS_URL = new URL("halloween.css?v=4", HERE).href;

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

  // A single jack-o'-lantern, in its own local 64x56 box, bottom-anchored
  // (so instances can be translated/scaled onto a patch baseline). `glow`
  // draws the carved-face glow (and gets the flicker animation hook);
  // kept optional so only 1-2 pumpkins per patch actually animate.
  function pumpkinMarkup(glowId, flip) {
    var face =
      '<path d="M18 29l7-6v12z" fill="#3a1d05"/>' +
      '<path d="M46 29l-7-6v12z" fill="#3a1d05"/>' +
      '<path d="M17 42q15 9 30 0l-4 5-5-3-4 4-4-4-5 3-4-4-4-1z" fill="#3a1d05"/>';
    return (
      '<g' + (flip ? ' transform="scale(-1,1) translate(-64,0)"' : "") + '>' +
      '<rect x="29" y="1" width="6" height="11" rx="3" fill="#5a7d3a"/>' +
      '<path d="M32 2c5 3 9 7 9 2" fill="none" stroke="#4a6a2f" stroke-width="2" stroke-linecap="round"/>' +
      '<ellipse cx="32" cy="34" rx="28" ry="20" fill="#ff8a3d"/>' +
      '<path d="M11 34c3-13 10-20 21-20s18 7 21 20" fill="none" stroke="#c6540c" stroke-width="2" opacity=".55"/>' +
      '<path d="M20 16c2 6 2 30 0 36" fill="none" stroke="#c6540c" stroke-width="1.5" opacity=".4"/>' +
      '<path d="M44 16c-2 6-2 30 0 36" fill="none" stroke="#c6540c" stroke-width="1.5" opacity=".4"/>' +
      (glowId ? '<circle class="hw-pumpkin-glow" cx="32" cy="33" r="18" fill="url(#' + glowId + ')"/>' : "") +
      face +
      "</g>"
    );
  }

  function pumpkinSvg() {
    var glow = nextId("hwGlow");
    return (
      '<svg class="hw-pumpkin-art" viewBox="0 0 64 56" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="' + glow + '" cx="50%" cy="58%" r="55%">' +
      '<stop offset="0%" stop-color="#ffe9b0" stop-opacity=".95"/>' +
      '<stop offset="100%" stop-color="#ffb347" stop-opacity="0"/>' +
      "</radialGradient></defs>" +
      pumpkinMarkup(glow, false) +
      "</svg>"
    );
  }

  // A small patch of 3-5 jack-o'-lanterns of different sizes along a curly
  // vine, for the bottom of a hero. One shot: own viewBox, own baseline, so
  // it drops in as a single wide strip with no per-pumpkin positioning math
  // in CSS.
  function patchSvg(count) {
    // BASE is the ground line. Pumpkins (tallest scale 1.15 => ~64 units
    // tall) stay well clear of both the top of the viewBox and the bottom
    // margin below BASE, and preserveAspectRatio="none" (set in CSS/markup
    // below) stretches this box to exactly fill whatever strip it is given —
    // never cropping a pumpkin, however wide or short that strip ends up.
    var W = 920, H = 150, BASE = 118;
    var slots = [
      { x: 70, scale: 0.6, flip: false },
      { x: 232, scale: 0.88, flip: true },
      { x: 460, scale: 1.1, flip: false, glow: true },
      { x: 682, scale: 0.82, flip: true },
      { x: 846, scale: 0.58, flip: false },
    ].slice(0, count);
    var defs = "";
    var groups = "";
    var shadows = "";
    var vineX = [];
    slots.forEach(function (slot) {
      var glowId = null;
      if (slot.glow) {
        glowId = nextId("hwPatchGlow");
        defs += '<radialGradient id="' + glowId + '" cx="50%" cy="58%" r="55%">' +
          '<stop offset="0%" stop-color="#ffe9b0" stop-opacity=".95"/>' +
          '<stop offset="100%" stop-color="#ffb347" stop-opacity="0"/>' +
          "</radialGradient>";
      }
      var tx = slot.x - 32 * slot.scale;
      var ty = BASE - 54 * slot.scale;
      vineX.push(slot.x);
      shadows += '<ellipse cx="' + slot.x + '" cy="' + (BASE + 5) + '" rx="' + (26 * slot.scale) +
        '" ry="' + (6 * slot.scale) + '" fill="#000" opacity=".22"/>';
      groups += '<g class="hw-patch-pumpkin" transform="translate(' + tx + ' ' + ty + ') scale(' + slot.scale + ')">' +
        pumpkinMarkup(glowId, slot.flip) + "</g>";
    });
    var vine = "M-10 " + (BASE + 2);
    vineX.forEach(function (x, i) {
      vine += " Q " + (x - 70) + " " + (BASE + (i % 2 ? 10 : -8)) + " " + x + " " + (BASE + 2);
    });
    vine += " Q " + (W - 60) + " " + (BASE - 6) + " " + (W + 10) + " " + (BASE + 2);
    var leaves =
      '<path class="hw-patch-leaf" d="M150 116c6-10 16-14 24-10-4 6-14 10-24 10z" fill="#5a8a3a" opacity=".85"/>' +
      '<path class="hw-patch-leaf" d="M560 120c-7-9-18-11-25-6 5 6 16 9 25 6z" fill="#4a7a30" opacity=".85"/>' +
      '<path class="hw-patch-leaf" d="M760 114c6-9 15-12 22-8-4 6-13 9-22 8z" fill="#5a8a3a" opacity=".85"/>' +
      '<path d="M310 112q10-10 6-22" fill="none" stroke="#4a7a30" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>' +
      '<path d="M620 110q-9-9-4-20" fill="none" stroke="#4a7a30" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>';
    return (
      '<svg class="hw-patch-art" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      (defs ? "<defs>" + defs + "</defs>" : "") +
      shadows +
      '<path class="hw-patch-vine" d="' + vine + '" fill="none" stroke="#3f6b28" stroke-width="3" stroke-linecap="round" opacity=".55"/>' +
      leaves + groups +
      "</svg>"
    );
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

  function addHeroFx(hero, patchCount, withMoon) {
    ensureAnchor(hero);
    if (withMoon) {
      var moon = document.createElement("div");
      moon.className = "hw-moon-zone";
      moon.setAttribute("aria-hidden", "true");
      hero.appendChild(moon);
    }
    var layer = document.createElement("div");
    layer.className = "hw-hero-fx";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML =
      '<span class="hw-patch">' + patchSvg(patchCount) + "</span>" +
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
    var hero = document.querySelector(".today-hero, .arc-hero, .hero");
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
    if (footer) footerPumpkin = addDecoration(footer, pumpkinSvg(), "hw-deco--pumpkin hw-deco--corner-br hw-deco--mini");
    if (hero) addHeroFx(hero, isArcadeLobby ? 3 : 5, isHomePage);
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
