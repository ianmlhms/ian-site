/* arcade-feature.js — a dated "Nei:" feature for the Arcade (Ian, 22 Nov 2026: Ski Alpen).
 *
 * While FEATURED is on, the homepage's arcade block shows the featured game as the big tile on the left (the game
 * of the week moves into the first of the four small tiles, the last small tile drops out), and the homepage and
 * the Arcade hub show a "Nei: <game>" banner. Before `from` and after `until` both pages look exactly as without
 * this file. The window is checked in the browser, so it switches on and off by itself, without a deploy.
 *
 * Loaded as a plain <script> in <head> (after i18n.js), so <html data-arcade-feature="ski"> is set before the first
 * paint: the markup carries both layouts, .arc-feat (only while featured) and .arc-nofeat (only while not), and the
 * rules below pick one. A page left open across `from` / `until` switches at the next minute tick.
 *
 * Its texts live here (lb · de · en, like i18n-dict.js) and fill [data-feat-text="<key>"] elements: keeping them out of
 * i18n-dict.js means the next feature changes this file only, not the dictionary's ?v= on two dozen pages.
 *
 * Preview for testing, this tab only, never stored: ?featured=ski (on now) or ?featured=off (today's layout).
 * Next feature: change FEATURED + TEXTS (and the banner/tile markup in index.html + pixelbreak.html). */
(function () {
  "use strict";

  var FEATURED = Object.freeze({
    id: "ski",
    from: "2026-11-23T06:00:00+01:00",   // Monday 23 Nov 2026, 06:00 Luxembourg
    until: "2026-12-07T06:00:00+01:00",  // two weeks later, Monday 7 Dec 2026, 06:00 Luxembourg
  });
  var TEXTS = Object.freeze({
    new: { lb: "Nei", de: "Neu", en: "New" },
    kick: { lb: "Nei an der Arcade", de: "Neu in der Arcade", en: "New in the Arcade" },
    line: { lb: "5 echt Skigebidder an 3D · Free Ride · Challenges · Online", de: "5 echte Skigebiete in 3D · Free Ride · Challenges · Online", en: "5 real ski areas in 3D · free ride · challenges · online" },
  });
  var DEFAULT_LANG = "lb";
  var PREVIEW_PARAM = "featured";
  var PREVIEW_OFF = "off";
  var ATTRIBUTE = "data-arcade-feature";
  var RECHECK_MS = 60000;
  var STYLE_ID = "arcade-feature-styles";
  var STYLES =
    "html:not([" + ATTRIBUTE + "]) .arc-feat{display:none!important}" +
    "html[" + ATTRIBUTE + "] .arc-nofeat{display:none!important}" +
    ".arc-new{flex-direction:row!important;align-items:center;justify-content:flex-start!important;gap:6px 16px!important;" +
      "padding:12px 20px!important;background:var(--green);color:var(--on-green)!important;text-decoration:none;flex-wrap:wrap}" +
    ".arc-new-tag{flex:none;padding:2px 8px;border:1px solid currentColor;font:600 12px/1.5 \"Geist Mono\",ui-monospace,monospace;" +
      "letter-spacing:.06em;text-transform:uppercase}" +
    ".arc-new-text{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;min-width:0;flex:1 1 16rem}" +
    ".arc-new-text b{font-size:18px;font-weight:800;letter-spacing:-.02em}" +
    ".arc-new-line{font-size:14px;opacity:.88;overflow-wrap:anywhere}" +
    ".arc-new-go{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;font-weight:600;font-size:15px;margin-left:auto}" +
    ".arc-new-go svg{width:1em;height:1em;fill:currentColor;transition:transform .2s ease}" +
    ".arc-new:hover .arc-new-go svg{transform:translateX(4px)}" +
    ".arc-new:hover .arc-new-text b{text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:2px}" +
    ".arc-new:focus-visible{outline:3px solid var(--ink)!important;outline-offset:-6px!important}" +
    "@media (max-width:700px){.arc-new{flex-wrap:nowrap;gap:6px 12px!important;padding:12px 16px!important}.arc-new-text{flex:1 1 0}.arc-new-go{font-size:14px}}" +
    "@media (prefers-reduced-motion:reduce){.arc-new-go svg{transition:none}}";

  function previewChoice() {
    try { return new URLSearchParams(location.search).get(PREVIEW_PARAM); } catch (e) { return null; }
  }

  function isLiveAt(feature, now) {
    var time = now.getTime();
    return time >= Date.parse(feature.from) && time < Date.parse(feature.until);
  }

  function activeFeature() {
    var preview = previewChoice();
    if (preview === PREVIEW_OFF) return null;
    if (preview === FEATURED.id) return FEATURED;
    return isLiveAt(FEATURED, new Date()) ? FEATURED : null;
  }

  function apply() {
    var feature = activeFeature();
    var root = document.documentElement;
    var before = root.getAttribute(ATTRIBUTE);
    if (feature) root.setAttribute(ATTRIBUTE, feature.id);
    else root.removeAttribute(ATTRIBUTE);
    if (before !== root.getAttribute(ATTRIBUTE)) {
      document.dispatchEvent(new CustomEvent("arcade-feature:change", { detail: { feature: feature } }));
    }
    return feature;
  }

  function text(key) {
    var entry = TEXTS[key];
    if (!entry) return key;
    var lang = (window.I18N && window.I18N.lang) || DEFAULT_LANG;
    return entry[lang] || entry[DEFAULT_LANG];
  }

  function translate() {
    document.querySelectorAll("[data-feat-text]").forEach(function (node) {
      node.textContent = text(node.getAttribute("data-feat-text"));
    });
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  installStyles();
  apply();
  setInterval(apply, RECHECK_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", translate);
  else translate();
  document.addEventListener("i18n:change", translate);

  window.ArcadeFeature = Object.freeze({
    config: FEATURED,
    /* the feature on right now (or null) */
    current: activeFeature,
    isLiveAt: isLiveAt,
    text: text,
  });
})();
