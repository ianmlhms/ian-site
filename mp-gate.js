/* mp-gate.js — the small in-game half of the shared lobby. Classic script, first <script> in the game page:
 *   <script src="mp-gate.js?v=6" data-game="connect4"></script>
 *
 * 1. Gate: a visit with neither ?room= nor ?ai=1 (arcade card, old bookmark, ?lobby=CODE) is sent to lobby.html. The old
 *    links page?room=CODE&role=host|guest and page?ai=1 keep working untouched — they never see the lobby.
 *    While the redirect is under way MPGate.redirecting is true: the game must not open its channel (it would join the "demo" room).
 *    (window.stop() would cancel the redirect too, so the game checks the flag instead.)
 * 2. Context: when the lobby started the game (?lb=CODE) the roster and the host's settings are available as
 *      MPGate.ctx = { game, code, room, role, cfg, roster:[{id,name,uid,avatar,role}] }   (null for old links)
 * 3. Back to lobby: a floating button (rematch / change settings / add people). setOver(true) tells it the match is
 *    finished (one tap, highlighted); mid-match it asks for a second tap so nobody leaves by accident.
 * 4. Arcade games (pong, tank-wars, fighters, air-hockey) run in the arcade's sandboxed frame: there the context comes from the shell's URL
 *    (pixelbreak.html?g=pong&room=..&role=..&lb=..), a lobby jump is a postMessage to the shell ({__pbLobby:{url}}, handled by pixelbreak.html),
 *    data-menu keeps the bare visit on the game's own menu (its «Host online game» button calls MPGate.openLobby instead), and
 *    data-adopt="#hudMenu,#menuBtn" turns the game's own Menu buttons into the «‹ Lobby» button instead of floating a second one over the canvas.
 *    Games without their own setOver() calls can add  data-over="#rematch"  to the script tag: "over" then simply follows
 *    whether that element (the game's own rematch / new-game button) is shown.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var game = (script && script.getAttribute("data-game")) || "";
  var inFrame = false;
  try { inFrame = window.parent !== window; } catch (e) { /* cross-origin parent: not ours */ }
  var search = location.search;
  if (inFrame) { try { search = window.parent.location.search; } catch (e) { search = ""; } }
  var params = new URLSearchParams(search);
  var menuEntry = !!(script && script.hasAttribute("data-menu"));
  var LOBBY = "lobby.html";
  var CTX_KEY = "mpl.ctx";
  var MAX_AGE_MS = 6 * 3600 * 1000;
  var gate = (window.MPGate = { redirecting: false, game: game, code: "", ctx: null, over: false, setOver: function () {}, backToLobby: function () {}, lobbyUrl: lobbyUrl, inFrame: inFrame, openLobby: function (code) { jump(lobbyUrl(code)); } });

  function cleanCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); }
  function lobbyUrl(code, back) {
    var q = new URLSearchParams({ g: game });
    if (code) q.set("c", code === "new" ? "new" : cleanCode(code));
    if (back) { q.set("back", "1"); if (params.get("role") === "host") q.set("host", "1"); }
    return LOBBY + "?" + q.toString();
  }

  /* leave for the lobby: a normal page navigates, a sandboxed arcade frame asks the shell to (it may not touch the top window itself) */
  function jump(url) {
    if (inFrame) { try { window.parent.postMessage({ __pbLobby: { url: url } }, "*"); } catch (e) { /* no shell */ } }
    else location.href = url;
  }

  var hasRoom = params.has("room"), isAi = params.get("ai") === "1";
  if (!hasRoom && !isAi && !menuEntry) {
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
      var c = JSON.parse(window.sessionStorage.getItem(CTX_KEY) || "null");
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
    lb: { lobby: "‹ Lobby", back: "↩ Zréck an d'Lobby", sure: "Sécher? Nach eng Kéier tippen", sureShort: "Sécher?", aria: "Zréck an d'Lobby" },
    de: { lobby: "‹ Lobby", back: "↩ Zurück zur Lobby", sure: "Sicher? Nochmal tippen", sureShort: "Sicher?", aria: "Zurück zur Lobby" },
    en: { lobby: "‹ Lobby", back: "↩ Back to lobby", sure: "Sure? Tap again", sureShort: "Sure?", aria: "Back to the lobby" },
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
    /* data-adopt: the game's own buttons that become «‹ Lobby». A leading "!" = one tap always (e.g. the start menu the game falls back to
     * when the opponent has left: there is no match to lose any more). */
    var specs = ((script && script.getAttribute("data-adopt")) || "").split(",").map(function (q) { return q.trim(); }).filter(Boolean);
    var adopt = specs.map(function (q) { var el = document.querySelector(q.replace(/^!/, "")); return el ? { el: el, instant: q.charAt(0) === "!" } : null; }).filter(Boolean);
    var btns = adopt.length ? adopt.map(function (a) { return a.el; }) : [document.createElement("button")];
    var armed = 0, timer = 0, compact = adopt.length > 0;
    function paint() {
      var label = armed ? (compact ? tx.sureShort : tx.sure) : (gate.over ? (compact ? tx.lobby : tx.back) : tx.lobby);
      btns.forEach(function (b) { b.textContent = b.dataset.mpgInstant ? tx.lobby : label; b.dataset.over = gate.over ? "1" : "0"; });
    }
    function go() { jump(lobbyUrl(lbCode, true)); }
    function onClick(e) {
      if (gate.over || armed || (e && e.currentTarget.dataset.mpgInstant)) { go(); return; }
      armed = 1; paint(); clearTimeout(timer);
      timer = setTimeout(function () { armed = 0; paint(); }, 3000);
    }
    btns.forEach(function (b, i) {
      b.setAttribute("aria-label", tx.aria);
      b.onclick = onClick;
      if (!adopt.length) { b.type = "button"; b.className = "mpg-chip"; b.id = "mpgBack"; }
      else { b.dataset.mpg = "1"; b.hidden = false; if (adopt[i].instant) b.dataset.mpgInstant = "1"; }
    });
    gate.setOver = function (over) { gate.over = !!over; armed = 0; paint(); };
    gate.backToLobby = go;
    paint();
    if (!adopt.length) document.body.appendChild(btns[0]);
    watchOver();
  }
})();
