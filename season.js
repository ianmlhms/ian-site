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
  var HALLOWEEN_CSS_URL = new URL("halloween.css?v=1", HERE).href;

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

  function pumpkinSvg() {
    var glow = nextId("hwGlow");
    return (
      '<svg class="hw-pumpkin-art" viewBox="0 0 64 56" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="' + glow + '" cx="50%" cy="58%" r="55%">' +
      '<stop offset="0%" stop-color="#ffe9b0" stop-opacity=".95"/>' +
      '<stop offset="100%" stop-color="#ffb347" stop-opacity="0"/>' +
      "</radialGradient></defs>" +
      '<rect x="29" y="2" width="6" height="11" rx="3" fill="#5a7d3a"/>' +
      '<ellipse cx="32" cy="34" rx="28" ry="20" fill="#ff8a3d"/>' +
      '<path d="M11 34c3-13 10-20 21-20s18 7 21 20" fill="none" stroke="#e8680f" stroke-width="2" opacity=".45"/>' +
      '<path d="M20 16c2 6 2 30 0 36" fill="none" stroke="#e8680f" stroke-width="1.5" opacity=".35"/>' +
      '<path d="M44 16c-2 6-2 30 0 36" fill="none" stroke="#e8680f" stroke-width="1.5" opacity=".35"/>' +
      '<circle cx="32" cy="33" r="17" fill="url(#' + glow + ')"/>' +
      '<path d="M18 29l7-6v12z" fill="#3a1d05"/>' +
      '<path d="M46 29l-7-6v12z" fill="#3a1d05"/>' +
      '<path d="M17 42q15 9 30 0l-4 5-5-3-4 4-4-4-5 3-4-4-4-1z" fill="#3a1d05"/>' +
      "</svg>"
    );
  }

  function cobwebSvg() {
    return (
      '<svg class="hw-cobweb-art" viewBox="0 0 60 60" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M0 0L60 60M0 20L34 0M0 40L50 0M20 0L60 34M40 0L60 50"/>' +
      '<path d="M3 3Q16 0 29 3M3 3Q0 16 3 29M3 29Q16 32 29 29M29 29Q32 16 29 3" opacity=".9"/>' +
      '<path d="M8 8Q24 3 40 8M8 8Q3 24 8 40M8 40Q24 45 40 40M40 40Q45 24 40 8" opacity=".7"/>' +
      '<path d="M14 14Q32 7 50 14M14 14Q7 32 14 50" opacity=".5"/>' +
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

  function addHeroFx(hero) {
    ensureAnchor(hero);
    var layer = document.createElement("div");
    layer.className = "hw-hero-fx";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML =
      '<span class="hw-bat hw-bat--a">' + batSvg() + "</span>" +
      '<span class="hw-bat hw-bat--b">' + batSvg() + "</span>" +
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

    if (header) addDecoration(header, cobwebSvg(), "hw-deco--cobweb hw-deco--corner-tl");
    if (header && isArcadeLobby) addDecoration(header, pumpkinSvg(), "hw-deco--pumpkin hw-deco--corner-tr hw-deco--mini");

    var footerPumpkin = null;
    if (footer) footerPumpkin = addDecoration(footer, pumpkinSvg(), "hw-deco--pumpkin hw-deco--corner-br hw-deco--mini");
    if (hero) addHeroFx(hero);
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
