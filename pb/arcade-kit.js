(function () {
  "use strict";

  /* Any finite score up to 1e300 (the idle games reach 1e25 and far beyond); the database columns are double
   * precision with the same range check, and pixelbreak-records.js uses the same limit. */
  const SCORE_LIMIT = 1e300;
  const KEYBOARD_IDLE_MS = 10_000;
  const KEYBOARD_SESSION_KEY = "pb_hardware_keyboard_at";
  const CONTROL_KEYS = new Set([
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "w", "a", "s", "d", "W", "A", "S", "D", " ", "Enter",
  ]);
  const SCRIPT = document.currentScript;
  const options = Object.freeze({
    id: SCRIPT?.dataset.arcadeId || "",
    title: SCRIPT?.dataset.arcadeTitle || document.title.split(/[–—-]/)[0].trim(),
    noScore: SCRIPT?.hasAttribute("data-arcade-no-score") || false,
    lowerIsBetter: SCRIPT?.hasAttribute("data-arcade-lower-is-better") || false,
    standalone: window.parent === window,
    replace: SCRIPT?.dataset.arcadeReplace || "",
    restart: SCRIPT?.hasAttribute("data-arcade-restart") || false,
    leaderboardTarget: SCRIPT?.dataset.arcadeLeaderboardTarget || "",
  });
  /* Test mode (arcade owner only). The arcade injects window.__pbTestMode=true into a game frame before any game
   * script runs. A game that is opened as its own page (href games such as geometrydash.html) gets the same flag
   * from a sessionStorage token the arcade sets when the owner picks "Test mode" for that game. */
  const TEST_TOKEN_KEY = "pb_testmode_game";
  if (window.__pbTestMode !== true && window.parent === window && options.id) {
    try { if (sessionStorage.getItem(TEST_TOKEN_KEY) === options.id) window.__pbTestMode = true; }
    catch (error) { warn("Could not read the test mode token.", error); }
  }
  const testMode = window.__pbTestMode === true;
  let restartHandler = null;
  let muteHandler = null;
  let lastKeyboardAt = Number(sessionGet(KEYBOARD_SESSION_KEY) || 0);
  let pendingScore = null;
  let pendingBoardId = "";
  let scoreTimer = 0;
  let runNumber = 0, finalSent = false;
  let currentBoard = null; // optional sub-leaderboard chosen by the game, e.g. one per level

  function warn(message, error) {
    console.warn("[Arcade] " + message, error || "");
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch (error) { warn("Could not read local storage.", error); return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch (error) { warn("Could not write local storage.", error); }
  }

  function sessionGet(key) {
    try { return sessionStorage.getItem(key); }
    catch (error) { warn("Could not read session storage.", error); return null; }
  }

  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, value); }
    catch (error) { warn("Could not write session storage.", error); }
  }

  function validScore(value) {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= SCORE_LIMIT;
  }

  function emitScore(value, final, boardId) {
    if (testMode) return;   // test mode never reports a score
    const board = boardId || "";
    const detail = Object.freeze({ score: value, final: Boolean(final), ...(board ? { board } : {}), ...(final ? { run: runNumber } : {}) });
    if (!options.standalone) {
      try { window.parent.postMessage({ __pb: 1, score: value, ...(final ? { final: true, run: runNumber } : {}), ...(board ? { board } : {}) }, "*"); }
      catch (error) { warn("Could not report the score to Arcade.", error); }
      return;
    }
    window.dispatchEvent(new CustomEvent("arcade:score", { detail }));
  }

  function flushPending() {
    if (scoreTimer) window.clearTimeout(scoreTimer);
    scoreTimer = 0;
    const next = pendingScore;
    pendingScore = null;
    if (next !== null) emitScore(next, false, pendingBoardId);
  }

  /* A game with several leaderboards (one per level) names the active one. Scores that follow are saved under
   * that id; ids must be the game's own id or start with it plus "-", which the records module double-checks. */
  function setBoard(spec) {
    if (spec === null) { flushPending(); currentBoard = null; announceBoard(null); return null; }
    const valid = spec && typeof spec.id === "string" && spec.id.length > 0 && spec.id.length <= 48 && /^[a-z0-9-]+$/.test(spec.id) &&
      typeof spec.name === "string" && spec.name.length > 0 && spec.name.length <= 80;
    if (!valid) { warn("Ignored an invalid leaderboard: " + JSON.stringify(spec)); return currentBoard; }
    if (options.id && spec.id !== options.id && !spec.id.startsWith(options.id + "-")) {
      warn("Ignored a leaderboard that does not belong to " + options.id + ": " + spec.id);
      return currentBoard;
    }
    flushPending();
    currentBoard = Object.freeze({ id: spec.id, name: spec.name, format: typeof spec.format === "string" ? spec.format : "" });
    announceBoard(currentBoard);
    return currentBoard;
  }

  function announceBoard(board) {
    if (!options.standalone) {
      try { window.parent.postMessage({ __pbBoard: 1, board }, "*"); }
      catch (error) { warn("Could not report the leaderboard to Arcade.", error); }
      return;
    }
    window.dispatchEvent(new CustomEvent("arcade:board", { detail: Object.freeze({ board }) }));
  }

  function startRun() {
    runNumber += 1;
    finalSent = false;
    if (scoreTimer) window.clearTimeout(scoreTimer);
    scoreTimer = 0;
    pendingScore = null;
  }

  function report(value, final) {
    if (options.noScore || !validScore(value)) {
      if (!options.noScore) warn("Ignored an invalid score: " + String(value));
      return;
    }
    if (!final && finalSent) startRun();
    const boardId = currentBoard ? currentBoard.id : "";
    if (final) {
      if (finalSent) return;
      finalSent = true;
      if (scoreTimer) window.clearTimeout(scoreTimer);
      scoreTimer = 0;
      pendingScore = null;
      emitScore(value, true, boardId);
      return;
    }
    pendingScore = value;
    pendingBoardId = boardId;
    if (scoreTimer) return;
    scoreTimer = window.setTimeout(() => {
      scoreTimer = 0;
      const next = pendingScore;
      pendingScore = null;
      if (next !== null) emitScore(next, false, pendingBoardId);
    }, 250);
  }

  function muted() { return storageGet("pb_muted") === "1"; }

  function applyMute(nextMuted) {
    storageSet("pb_muted", nextMuted ? "1" : "0");
    document.querySelectorAll("audio,video").forEach((media) => { media.muted = nextMuted; });
    if (muteHandler) {
      try { muteHandler(nextMuted); }
      catch (error) { warn("The game mute handler failed.", error); }
    }
    window.dispatchEvent(new CustomEvent("arcade:mute", { detail: { muted: nextMuted } }));
  }

  function runRestart() {
    if (restartHandler) {
      try { restartHandler(); }
      catch (error) { warn("The game restart handler failed.", error); }
      return;
    }
    location.reload();
  }

  function barCss() {
    if (document.getElementById("arcade-kit-css")) return;
    const style = document.createElement("style");
    style.id = "arcade-kit-css";
    style.textContent = `
      .arcade-bar{--k-paper:#f6f6f3;--k-white:#fcfcfa;--k-ink:#16171a;--k-muted:#62656a;--k-green:#1f7a4d;
        box-sizing:border-box;min-height:56px;flex:none;display:flex;flex-wrap:nowrap;align-items:center;gap:8px;
        padding:max(6px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) 6px max(10px,env(safe-area-inset-left));
        border-bottom:1px solid var(--k-ink);background:var(--k-paper);color:var(--k-ink);
        font-family:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;position:relative;z-index:1000}
      .arcade-bar__back,.arcade-bar__button{box-sizing:border-box;min-width:44px;min-height:44px;display:inline-flex;
        align-items:center;justify-content:center;border:1px solid transparent;border-radius:0;background:transparent;
        color:inherit;text-decoration:none;font:600 14px/1 "Geist",system-ui,-apple-system,"Segoe UI",sans-serif;
        cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color .15s,border-color .15s,color .15s}
      .arcade-bar__back{padding:0 10px;color:var(--k-muted);white-space:nowrap}
      .arcade-bar__button{padding:0 11px;font-size:18px;border-color:var(--k-ink);background:var(--k-white)}
      .arcade-bar__back:hover{color:var(--k-green)}
      .arcade-bar__button:hover{background:var(--k-white);border-color:var(--k-green);color:var(--k-green)}
      .arcade-bar__button:active{background:var(--k-ink);color:var(--k-paper)}
      .arcade-bar__back:focus-visible,.arcade-bar__button:focus-visible{outline:2px solid var(--k-green);outline-offset:2px}
      .arcade-bar__title{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:1.15;font-weight:800;letter-spacing:-.01em}
      .arcade-bar__badge{flex:none;padding:3px 8px;border:1px solid var(--k-green);color:var(--k-green);font:500 11px/1.4 "Geist Mono",ui-monospace,monospace;letter-spacing:.06em;white-space:nowrap}
      .arcade-bar__spacer{flex:1;min-width:4px}.arcade-bar__best{color:var(--k-muted);font:500 11px/1 "Geist Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
      .arcade-context{box-sizing:border-box;min-height:44px;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:4px 14px;
        border-bottom:1px solid #16171a;background:#fcfcfa;color:#62656a;
        font:500 13px/1.2 "Geist",system-ui,-apple-system,"Segoe UI",sans-serif}
      .arcade-context code{color:#16171a;font-family:"Geist Mono",ui-monospace,monospace}.arcade-context [data-arcade-hidden-control]{display:none!important}
      .arcade-hardware-keyboard [data-arcade-touch-controls]{display:none!important}
      @media(max-width:520px){.arcade-bar{gap:4px}.arcade-bar__back{font-size:13px;padding-inline:7px}.arcade-bar .arcade-bar__title{font-size:15px}.arcade-bar__best{display:none}.arcade-bar__button{padding:0 8px}.arcade-context{justify-content:center;flex-wrap:wrap}}
      @media(prefers-reduced-motion:reduce){.arcade-bar__back,.arcade-bar__button{transition:none}}
    `;
    document.head.appendChild(style);
  }

  // Phosphor-style line icons (the bar used emoji before the Gitter look)
  const ICONS = Object.freeze({
    trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0V4Zm0 2H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4m-4 2h8"/>',
    restart: '<path d="M19 12a7 7 0 1 1-2.05-4.95L19 9m0-4v4h-4"/>',
    soundOn: '<path d="M4 9.5h3l5-4v13l-5-4H4v-5Zm12.5 0a4 4 0 0 1 0 5m2.5-8a8 8 0 0 1 0 11"/>',
    soundOff: '<path d="M4 9.5h3l5-4v13l-5-4H4v-5Zm12 .5 5 5m0-5-5 5"/>',
  });
  const iconSvg = (name) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  function button(className, label, icon, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.setAttribute("aria-label", label);
    element.title = label;
    element.innerHTML = iconSvg(icon);
    element.addEventListener("click", onClick);
    return element;
  }

  // Pages that centre their game with a grid or flex-row body would centre the bar too.
  // Move their content into a wrapper that keeps the body's layout, so the bar spans the top.
  const LAYOUT_PROPS = Object.freeze(["display", "flexDirection", "placeItems", "alignItems", "justifyContent", "justifyItems", "gap"]);
  function wrapNonColumnBody() {
    const body = document.body;
    const style = getComputedStyle(body);
    const isColumn = style.display.includes("flex") && style.flexDirection.startsWith("column");
    if (isColumn || !/grid|flex/.test(style.display)) return;
    const main = document.createElement("div");
    main.className = "arcade-standalone-main";
    LAYOUT_PROPS.forEach((prop) => { main.style[prop] = style[prop]; });
    Object.assign(main.style, { flex: "1", minHeight: "0", width: "100%", position: "relative" });
    const movable = [...body.childNodes].filter((node) => node.nodeName !== "SCRIPT");
    main.append(...movable);
    Object.assign(body.style, { display: "flex", flexDirection: "column", alignItems: "stretch" });
    body.prepend(main);
  }

  function mountBar(config = {}) {
    barCss();
    const host = typeof config.host === "string" ? document.querySelector(config.host) : config.host;
    const bar = host || document.createElement("header");
    bar.classList.add("arcade-bar");
    bar.replaceChildren();

    const back = document.createElement("a");
    back.className = "arcade-bar__back";
    back.href = config.backHref || (options.standalone && location.pathname.includes("/pb/") ? "../pixelbreak.html" : "pixelbreak.html");
    back.textContent = "‹ Arcade";
    if (config.onBack) back.addEventListener("click", config.onBack);
    const title = document.createElement("h1");
    title.className = "arcade-bar__title";
    title.textContent = config.title || options.title || "Game";
    const spacer = document.createElement("span");
    spacer.className = "arcade-bar__spacer";
    const best = document.createElement("span");
    best.className = "arcade-bar__best";
    best.id = config.bestId || "arcadeBest";
    bar.append(back, title);
    if (testMode || config.badge) {
      const badge = document.createElement("span");
      badge.className = "arcade-bar__badge";
      badge.setAttribute("role", "status");
      badge.setAttribute("aria-label", "Testmodus");
      badge.textContent = "TEST";
      bar.append(badge);
    }
    bar.append(spacer, best);

    if (!config.noScore) {
      const board = button("arcade-bar__button arcade-bar__leaderboard", "Rangleescht", "trophy", config.onLeaderboard || (() => window.PB?.openBoard?.()));
      bar.appendChild(board);
    }
    if (config.restart !== false) {
      const restart = button("arcade-bar__button arcade-bar__restart", "Nei starten", "restart", config.onRestart || runRestart);
      bar.appendChild(restart);
    }
    const mute = button("arcade-bar__button arcade-bar__mute", muted() ? "Toun un" : "Toun aus", muted() ? "soundOff" : "soundOn", () => {
      const next = !muted();
      applyMute(next);
      mute.innerHTML = iconSvg(next ? "soundOff" : "soundOn");
      mute.setAttribute("aria-label", next ? "Toun un" : "Toun aus");
      if (config.onMute) config.onMute(next);
    });
    bar.appendChild(mute);

    if (!host) {
      const replaceTarget = config.replace ? document.querySelector(config.replace) : null;
      if (replaceTarget) replaceTarget.replaceWith(bar);
      else {
        wrapNonColumnBody();
        document.body.prepend(bar);
      }
    }
    return Object.freeze({ bar, title, best, mute });
  }

  function isEditableTarget(target) {
    return target instanceof Element && target.closest("input,textarea,select,[contenteditable]") !== null;
  }

  function reportKeyboardInput(event) {
    // Typing into a field (an on-screen keyboard included) says nothing about a hardware keyboard.
    if (!event.isTrusted || !CONTROL_KEYS.has(event.key) || isEditableTarget(event.target)) return;
    lastKeyboardAt = Date.now();
    sessionSet(KEYBOARD_SESSION_KEY, String(lastKeyboardAt));
    if (!options.standalone) window.parent.postMessage({ __pbKeyboard: 1 }, "*");
    document.documentElement.classList.add("arcade-hardware-keyboard");
  }

  function reportTouchInput(event) {
    if (!event.isTrusted || event.pointerType !== "touch") return;
    // The hub shares this session key, so its keystrokes count too.
    lastKeyboardAt = Math.max(lastKeyboardAt, Number(sessionGet(KEYBOARD_SESSION_KEY) || 0));
    if (Date.now() - lastKeyboardAt < KEYBOARD_IDLE_MS) return;
    lastKeyboardAt = 0;
    try { sessionStorage.removeItem(KEYBOARD_SESSION_KEY); }
    catch (error) { warn("Could not clear session storage.", error); }
    if (!options.standalone) window.parent.postMessage({ __pbTouch: 1 }, "*");
    document.documentElement.classList.remove("arcade-hardware-keyboard");
  }

  /* Test mode keeps a game away from the player's real storage. The function is self-contained on purpose: the
   * arcade injects its source into the game frame (see pixelbreak-records.js) and the kit runs it for href games.
   * It redirects this window's localStorage so nothing the game writes lands on a real key:
   *   pb_save_<id>  -> pb_testsave_<id>     pb_best_<id> -> pb_testbest_<id>     anything else -> pb_testls_<game>_<key>
   * Reads see only test data (a clean sandbox). Login, language, theme and sound keys pass through untouched.
   * Only getItem/setItem/removeItem/clear are covered; key(), length and property access are not. */
  function testStorageShim(gameId) {
    var store;
    try { store = window.localStorage; } catch (error) { return; }
    if (!store || window.__pbTestStorage) return;
    window.__pbTestStorage = true;
    var proto = Storage.prototype, getItem = proto.getItem, setItem = proto.setItem, removeItem = proto.removeItem;
    var PASS = /^(sb-.+-auth-token|site_.+|pb_muted|pb_input_mode|pb_hardware_keyboard_at|playerName|pb_mode_last|pb_test.*)$/;
    var LS_PREFIX = "pb_testls_" + gameId + "_";
    function map(key) {
      var k = String(key);
      if (PASS.test(k)) return k;
      if (k.indexOf("pb_save_") === 0) return "pb_testsave_" + k.slice(8);
      if (k.indexOf("pb_best_") === 0) return "pb_testbest_" + k.slice(8);
      return LS_PREFIX + k;
    }
    proto.getItem = function (key) { return getItem.call(this, this === store ? map(key) : key); };
    proto.setItem = function (key, value) { return setItem.call(this, this === store ? map(key) : key, value); };
    proto.removeItem = function (key) { return removeItem.call(this, this === store ? map(key) : key); };
    proto.clear = (function (clear) {
      return function () {
        if (this !== store) return clear.call(this);
        var doomed = [];
        for (var i = 0; i < store.length; i += 1) {
          var k = store.key(i);
          if (k && (k.indexOf(LS_PREFIX) === 0 || k === "pb_testsave_" + gameId || k === "pb_testbest_" + gameId)) doomed.push(k);
        }
        doomed.forEach(function (k) { removeItem.call(store, k); });
      };
    })(proto.clear);
  }
  if (testMode && options.standalone && options.id) testStorageShim(options.id);

  function bootStandalone() {
    const oldBar = options.replace ? document.querySelector(options.replace) : null;
    const leaderboardTarget = options.leaderboardTarget ? document.querySelector(options.leaderboardTarget) : null;
    const contextItems = oldBar ? Array.from(oldBar.children).filter((child) =>
      !child.matches("a.home,a.home-link,h1,.spacer,#mute,.mute")) : [];
    contextItems.forEach((item) => item.remove());
    if (leaderboardTarget) leaderboardTarget.setAttribute("data-arcade-hidden-control", "");
    mountBar({
      host: oldBar,
      title: options.title,
      noScore: options.noScore && !leaderboardTarget,
      restart: options.restart,
      onLeaderboard: leaderboardTarget ? () => leaderboardTarget.click() : undefined,
    });
    if (oldBar && contextItems.length) {
      const context = document.createElement("div");
      context.className = "arcade-context";
      context.append(...contextItems);
      oldBar.insertAdjacentElement("afterend", context);
    }
    if (!options.id) return;
    import("../pixelbreak-records.js?v=59").then(() => {
      window.PB?.registerStandalone?.({
        id: options.id,
        name: options.title,
        noScore: options.noScore,
        lowerIsBetter: options.lowerIsBetter,
      });
    }).catch((error) => warn("Could not start standalone score saving.", error));
  }

  const Arcade = Object.freeze({
    startRun,
    score(value) { report(value, false); },
    gameOver(value) { report(value, true); },
    setBoard,
    getBoard() { return currentBoard; },
    onRestart(handler) { restartHandler = typeof handler === "function" ? handler : null; },
    onMute(handler) {
      muteHandler = typeof handler === "function" ? handler : null;
      if (muteHandler) muteHandler(muted());
    },
    mountBar,
    options,
    testMode,
    // internal: the arcade injects this function's source into game frames when the owner plays in test mode
    testStorageShim,
  });
  window.Arcade = Arcade;

  window.addEventListener("keydown", reportKeyboardInput, { capture: true });
  window.addEventListener("pointerdown", reportTouchInput, { capture: true });
  window.addEventListener("message", (event) => {
    if (event.data?.__pbCommand === "restart") runRestart();
    if (event.data?.__pbSndMute !== undefined) applyMute(Boolean(event.data.__pbSndMute));
  });
  if (lastKeyboardAt > 0) document.documentElement.classList.add("arcade-hardware-keyboard");

  if (options.standalone && options.id) {
    if (document.body) bootStandalone();
    else document.addEventListener("DOMContentLoaded", bootStandalone, { once: true });
  }
})();
