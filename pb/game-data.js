/* Shared by the big games (MTB Mëllerdall, Schueberfouer Tycoon, Zuchsimulator): keeps their worlds on the device.
 *
 * The caching itself is done by the service worker (sw.js, "Game data": pb/<game>/data/** by content hash). This file does the two things only a page can:
 *  1. asks the browser to keep the site's storage (navigator.storage.persist), because Safari may throw away the stored worlds of a site that was not opened
 *     for 7 days unless the storage is persistent. Once per page, guarded: a browser without the API, or one that says no, changes nothing else;
 *  2. when every data file of this open came from the device, says so for a moment ("vum Apparat gelueden"), in the language of the game.
 * Loaded with a plain <script src="/pb/game-data.js?v=1" defer></script> after arcade-kit.js. */
(function () {
  "use strict";
  if (window.__gameDataHelper) return;
  window.__gameDataHelper = true;

  var SETTLE_MS = 1200;          // quiet time after the first report before the note may show
  var SHOW_MS = 2800;
  var FADE_MS = 400;
  var LANGS = ["lb", "de", "en", "fr"];
  var TEXT = {
    lb: "vum Apparat gelueden",
    de: "vom Gerät geladen",
    en: "loaded from this device",
    fr: "chargé depuis l'appareil"
  };

  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }   // storage blocked (private window): fall back to the default
  }

  function keepStorage() {
    var storage = navigator.storage;
    if (!storage || typeof storage.persist !== "function") return;
    var already = typeof storage.persisted === "function" ? storage.persisted() : Promise.resolve(false);
    Promise.resolve(already)
      .then(function (isPersistent) { return isPersistent || storage.persist(); })
      .catch(function (error) { console.info("[game-data] persistent storage request failed", error); });
  }

  function pickLang(game) {
    var own = readStore("pb_" + game + "_lang");
    var site = readStore("site_lang");
    return LANGS.indexOf(own) >= 0 ? own : LANGS.indexOf(site) >= 0 ? site : "lb";
  }

  function showNote(game) {
    var note = document.createElement("div");
    note.setAttribute("role", "status");
    note.textContent = "⚡ " + TEXT[pickLang(game)];
    note.style.cssText = "position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483000;" +
      "padding:6px 14px;border-radius:999px;background:rgba(10,20,26,.82);color:#e9f1f3;font:600 12px/1.2 system-ui,-apple-system,sans-serif;" +
      "pointer-events:none;opacity:0;transition:opacity " + FADE_MS + "ms";
    document.body.appendChild(note);
    requestAnimationFrame(function () { note.style.opacity = "1"; });
    setTimeout(function () { note.style.opacity = "0"; }, SHOW_MS);
    setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, SHOW_MS + FADE_MS + 100);
  }

  function watchSource() {
    if (!("serviceWorker" in navigator)) return;
    var latest = null;
    var timer = 0;
    var shown = false;
    navigator.serviceWorker.addEventListener("message", function (event) {
      var report = event.data;
      if (!report || report.type !== "ianlu-gamedata" || shown) return;
      latest = report;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (shown || !latest || latest.misses > 0 || latest.hits < 1) return;   // anything fetched from the network: say nothing
        shown = true;
        showNote(latest.game);
      }, SETTLE_MS);
    });
  }

  keepStorage();
  watchSource();
})();
