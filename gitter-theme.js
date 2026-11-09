/* gitter-theme.js — light / dark for the Gitter look (Nov 2026).
 * Load FIRST in <head>, synchronous (no defer/async/module): it sets <html data-theme="light|dark"> before the first paint.
 *   preference  localStorage "gt-theme" = "light" | "dark" (missing = Auto = follow the device, prefers-color-scheme)
 *   html attrs  data-theme = the RESOLVED theme, data-theme-pref = auto | light | dark; inline color-scheme
 *   <meta theme-color> pair (media light / dark) is kept in sync so iPad Safari's bars match
 *   toggle      #gtTheme (Auto -> Hell -> Däischter) is injected into the page header on body.gt pages
 *   games       window.gtTheme.onChange(fn); srcdoc game frames get data-theme + a postMessage {__gtTheme}
 * <html data-gt-light> keeps a page light-only (no toggle). API: window.gtTheme = { pref(), resolved(), set(pref), cycle(), onChange(fn) }. Event: "gt-theme" on window. */
(function () {
  "use strict";
  var KEY = "gt-theme";
  var root = document.documentElement;
  var COLOR = { light: "#f6f6f3", dark: "#121314" };
  var LABEL = { auto: "Auto", light: "Hell", dark: "Däischter" };
  var NEXT = { auto: "light", light: "dark", dark: "auto" };
  var ICON = {
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 1 0-17z" fill="currentColor" stroke="none"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    dark: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2z"/>'
  };
  var media = null;
  try { media = window.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { /* no matchMedia */ }
  var listeners = [];

  function readPref() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch (e) { return "auto"; }
  }
  function resolve(pref) { return pref === "auto" ? (media && media.matches ? "dark" : "light") : pref; }

  /* Two theme-color metas with media queries; an explicit choice pins both to the chosen colour. */
  function syncMeta(pref, resolved) {
    var head = document.head;
    if (!head) return;
    var light = head.querySelector('meta[name="theme-color"][data-gt="light"]');
    var dark = head.querySelector('meta[name="theme-color"][data-gt="dark"]');
    if (!light || !dark) {
      var old = head.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < old.length; i += 1) old[i].parentNode.removeChild(old[i]);
      light = document.createElement("meta"); light.name = "theme-color"; light.setAttribute("data-gt", "light"); light.media = "(prefers-color-scheme: light)";
      dark = document.createElement("meta"); dark.name = "theme-color"; dark.setAttribute("data-gt", "dark"); dark.media = "(prefers-color-scheme: dark)";
      head.appendChild(light); head.appendChild(dark);
    }
    light.content = pref === "auto" ? COLOR.light : COLOR[resolved];
    dark.content = pref === "auto" ? COLOR.dark : COLOR[resolved];
  }

  function frames(resolved, pref) {
    var list = document.querySelectorAll("iframe");
    for (var i = 0; i < list.length; i += 1) {
      try {
        var doc = list[i].contentDocument;
        if (doc && doc.documentElement) { doc.documentElement.setAttribute("data-theme", resolved); doc.documentElement.style.colorScheme = resolved; }
        if (list[i].contentWindow) list[i].contentWindow.postMessage({ __gtTheme: resolved, pref: pref }, "*");
      } catch (e) { /* cross-origin frame: leave it */ }
    }
  }

  function apply(announce) {
    var pref = readPref();
    var resolved = root.hasAttribute("data-gt-light") ? "light" : resolve(pref);   // <html data-gt-light>: the page stays light (Mordsfall)
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-pref", pref);
    root.style.colorScheme = resolved;
    syncMeta(pref, resolved);
    paintButton();
    if (announce) {
      frames(resolved, pref);
      for (var i = 0; i < listeners.length; i += 1) { try { listeners[i](resolved, pref); } catch (e) { /* listener bug must not stop the others */ } }
      try { window.dispatchEvent(new CustomEvent("gt-theme", { detail: { theme: resolved, pref: pref } })); } catch (e) { /* old browser */ }
    }
  }

  function set(pref) {
    try {
      if (pref === "light" || pref === "dark") localStorage.setItem(KEY, pref); else localStorage.removeItem(KEY);
    } catch (e) { /* private mode: the choice lasts until reload */ }
    apply(true);
  }
  function cycle() { set(NEXT[readPref()]); }

  /* ---- toggle button ---- */
  var button = null;
  function paintButton() {
    if (!button) return;
    var pref = readPref();
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICON[pref] + "</svg>";
    var text = "Look: " + LABEL[pref];
    button.setAttribute("aria-label", text + " (tippen fir ze wiesselen)");
    button.title = text;
    button.setAttribute("data-pref", pref);
  }
  function mount() {
    if (button || !document.body || !document.body.classList.contains("gt") || root.hasAttribute("data-gt-light")) return;
    button = document.createElement("button");
    button.type = "button"; button.id = "gtTheme"; button.className = "gt-theme";
    button.addEventListener("click", cycle);
    var host = document.querySelector(".gt-navr");
    if (host) host.insertBefore(button, host.firstChild);
    else {
      var bar = document.querySelector(".ui-header .header-right, header.bar:not(.arcade-bar), .studio-bar, .ops-bar, .topbar, .command-bar, .command-toolbar");
      if (bar) {
        var acct = bar.querySelector(".gt-acct, .auth-btn, #authBtn");
        if (acct && acct.parentNode) acct.parentNode.insertBefore(button, acct); else bar.appendChild(button);
      }
      else { button.className += " gt-theme-float"; document.body.appendChild(button); }
    }
    paintButton();
  }

  if (media) {
    var follow = function () { if (readPref() === "auto") apply(true); };
    if (media.addEventListener) media.addEventListener("change", follow); else if (media.addListener) media.addListener(follow);
  }
  window.addEventListener("storage", function (event) { if (event.key === KEY) apply(true); });
  /* Games in srcdoc frames: the hub tells them, they only need the attribute. */
  window.addEventListener("message", function (event) {
    if (window.parent !== window && event.data && event.data.__gtTheme) {
      root.setAttribute("data-theme", event.data.__gtTheme); root.style.colorScheme = event.data.__gtTheme;
      for (var i = 0; i < listeners.length; i += 1) { try { listeners[i](event.data.__gtTheme, event.data.pref); } catch (e) { /* ignore */ } }
    }
  });

  window.gtTheme = {
    pref: readPref,
    resolved: function () { return resolve(readPref()); },
    set: set,
    cycle: cycle,
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); }
  };

  apply(false);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
