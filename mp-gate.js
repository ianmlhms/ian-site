/* mp-gate.js — the small in-game half of the shared lobby. Classic script, first <script> in the game page:
 *   <script src="mp-gate.js?v=4" data-game="connect4"></script>
 *
 * 1. Gate: a visit with neither ?room= nor ?ai=1 (arcade card, old bookmark, ?lobby=CODE) is sent to lobby.html. The old
 *    links page?room=CODE&role=host|guest and page?ai=1 keep working untouched — they never see the lobby.
 *    While the redirect is under way MPGate.redirecting is true: the game must not open its channel (it would join the "demo" room).
 *    (window.stop() would cancel the redirect too, so the game checks the flag instead.)
 * 2. Context: when the lobby started the game (?lb=CODE) the roster and the host's settings are available as
 *      MPGate.ctx = { game, code, room, role, cfg, roster:[{id,name,uid,avatar,role}] }   (null for old links)
 * 3. Back to lobby: a floating button (rematch / change settings / add people). setOver(true) tells it the match is
 *    finished (one tap, highlighted); mid-match it asks for a second tap so nobody leaves by accident.
 *    Games without their own setOver() calls can add  data-over="#rematch"  to the script tag: "over" then simply follows
 *    whether that element (the game's own rematch / new-game button) is shown.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var game = (script && script.getAttribute("data-game")) || "";
  var params = new URLSearchParams(location.search);
  var LOBBY = "lobby.html";
  var CTX_KEY = "mpl.ctx";
  var MAX_AGE_MS = 6 * 3600 * 1000;
  var gate = (window.MPGate = { redirecting: false, game: game, code: "", ctx: null, over: false, setOver: function () {}, backToLobby: function () {}, lobbyUrl: lobbyUrl });

  function cleanCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); }
  function lobbyUrl(code, back) {
    var q = new URLSearchParams({ g: game });
    if (code) q.set("c", cleanCode(code));
    if (back) { q.set("back", "1"); if (params.get("role") === "host") q.set("host", "1"); }
    return LOBBY + "?" + q.toString();
  }

  var hasRoom = params.has("room"), isAi = params.get("ai") === "1";
  if (!hasRoom && !isAi) {
    gate.redirecting = true;
    location.replace(lobbyUrl(params.get("lobby") || ""));
    return;
  }

  var lbCode = cleanCode(params.get("lb"));
  gate.code = lbCode;
  gate.ctx = readCtx();
  if (lbCode) onReady(mountChip);

  function readCtx() {
    if (!lbCode) return null;
    try {
      var c = JSON.parse(sessionStorage.getItem(CTX_KEY) || "null");
      if (!c || c.v !== 1 || c.game !== game || c.code !== lbCode || !Array.isArray(c.roster) || Date.now() - Number(c.at) > MAX_AGE_MS) return null;
      return Object.freeze({
        game: c.game, code: c.code, room: String(c.room || ""), role: c.role === "host" ? "host" : "guest",
        cfg: c.cfg && typeof c.cfg === "object" ? c.cfg : {},
        roster: c.roster.slice(0, 16).map(function (r) { return Object.freeze({ id: String(r.id || ""), name: String(r.name || "?").slice(0, 16), uid: String(r.uid || ""), avatar: String(r.avatar || ""), role: r.role === "host" ? "host" : "guest" }); }),
      });
    } catch (e) { return null; }
  }

  function onReady(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }

  var TEXT = {
    lb: { lobby: "‹ Lobby", back: "↩ Zréck an d'Lobby", sure: "Sécher? Nach eng Kéier tippen", aria: "Zréck an d'Lobby" },
    de: { lobby: "‹ Lobby", back: "↩ Zurück zur Lobby", sure: "Sicher? Nochmal tippen", aria: "Zurück zur Lobby" },
    en: { lobby: "‹ Lobby", back: "↩ Back to lobby", sure: "Sure? Tap again", aria: "Back to the lobby" },
  };
  function lang() { try { var l = localStorage.getItem("site_lang"); return TEXT[l] ? l : "lb"; } catch (e) { return "lb"; } }

  /* data-over="#sel": over = the element is displayed (the game shows its rematch button exactly when the match is finished) */
  function watchOver() {
    var sel = script && script.getAttribute("data-over");
    var el = sel ? document.querySelector(sel) : null;
    if (!el || typeof MutationObserver === "undefined") return;
    var last = null;
    function sync() {
      var shown = getComputedStyle(el).display !== "none";
      if (shown !== last) { last = shown; gate.setOver(shown); }
    }
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ["style", "hidden", "class"] });
    sync();
  }

  function mountChip() {
    var tx = TEXT[lang()];
    var style = document.createElement("style");
    style.textContent =
      ".mpg-chip{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:900;display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;" +
      "border:2px solid var(--border,#2a2a4a);background:var(--card-opaque,#161625);color:var(--text,#e8e8f0);font:700 14px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;cursor:pointer;touch-action:manipulation;box-shadow:0 6px 18px rgba(0,0,0,.35)}" +
      ".mpg-chip:hover{border-color:var(--accent,#6ea8fe)}.mpg-chip[data-over='1']{background:var(--accent,#6ea8fe);border-color:var(--accent,#6ea8fe);color:var(--accent-foreground,#000)}" +
      ".mpg-chip:focus-visible{outline:3px solid var(--focus-ring,var(--accent2,#4de8ff));outline-offset:2px}@media print{.mpg-chip{display:none}}";
    document.head.appendChild(style);
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "mpg-chip"; btn.id = "mpgBack";
    btn.setAttribute("aria-label", tx.aria);
    var armed = 0, timer = 0;
    function paint() { btn.textContent = armed ? tx.sure : (gate.over ? tx.back : tx.lobby); btn.dataset.over = gate.over ? "1" : "0"; }
    function go() { location.href = lobbyUrl(lbCode, true); }
    btn.addEventListener("click", function () {
      if (gate.over || armed) { go(); return; }
      armed = 1; paint(); clearTimeout(timer);
      timer = setTimeout(function () { armed = 0; paint(); }, 3000);
    });
    gate.setOver = function (over) { gate.over = !!over; armed = 0; paint(); };
    gate.backToLobby = go;
    paint();
    document.body.appendChild(btn);
    watchOver();
  }
})();
