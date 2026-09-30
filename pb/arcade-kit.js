(function () {
  "use strict";

  const SCORE_LIMIT = Number.MAX_SAFE_INTEGER;
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
  let restartHandler = null;
  let muteHandler = null;
  let lastKeyboardAt = Number(sessionGet(KEYBOARD_SESSION_KEY) || 0);
  let pendingScore = null;
  let scoreTimer = 0;

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

  function emitScore(value, final) {
    const detail = Object.freeze({ score: value, final: Boolean(final) });
    if (!options.standalone) {
      try { window.parent.postMessage({ __pb: 1, score: value, ...(final ? { final: true } : {}) }, "*"); }
      catch (error) { warn("Could not report the score to Arcade.", error); }
      return;
    }
    window.dispatchEvent(new CustomEvent("arcade:score", { detail }));
  }

  function report(value, final) {
    if (options.noScore || !validScore(value)) {
      if (!options.noScore) warn("Ignored an invalid score: " + String(value));
      return;
    }
    if (final) {
      if (scoreTimer) window.clearTimeout(scoreTimer);
      scoreTimer = 0;
      pendingScore = null;
      emitScore(value, true);
      return;
    }
    pendingScore = value;
    if (scoreTimer) return;
    scoreTimer = window.setTimeout(() => {
      scoreTimer = 0;
      const next = pendingScore;
      pendingScore = null;
      if (next !== null) emitScore(next, false);
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
      .arcade-bar{box-sizing:border-box;min-height:56px;flex:none;display:flex;align-items:center;gap:8px;
        padding:max(6px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) 6px max(10px,env(safe-area-inset-left));
        border-bottom:1px solid color-mix(in srgb,var(--border,#2a2a4a) 82%,transparent);
        background:color-mix(in srgb,var(--bg,#0d0d1a) 86%,transparent);color:var(--text,#e8e8f0);
        backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);
        font-family:-apple-system,"SF Pro Text","SF Pro Display",BlinkMacSystemFont,"Segoe UI",sans-serif;
        position:relative;z-index:1000}
      .arcade-bar__back,.arcade-bar__button{box-sizing:border-box;min-width:44px;min-height:44px;display:inline-flex;
        align-items:center;justify-content:center;border:1px solid transparent;border-radius:11px;background:transparent;
        color:inherit;text-decoration:none;font:650 14px/1 -apple-system,"SF Pro Text",BlinkMacSystemFont,"Segoe UI",sans-serif;
        letter-spacing:.01em;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .18s cubic-bezier(.2,.8,.2,1),background .18s ease,border-color .18s ease}
      .arcade-bar__back{padding:0 10px;color:var(--muted,var(--text2,#9b9bb8));white-space:nowrap}
      .arcade-bar__button{padding:0 11px;font-size:18px;border-color:var(--border,#2a2a4a);background:var(--card,#161625)}
      .arcade-bar__back:hover,.arcade-bar__button:hover{background:var(--card2,#1e1e35);color:var(--text,#fff)}
      .arcade-bar__back:active,.arcade-bar__button:active{transform:scale(.94)}
      .arcade-bar__back:focus-visible,.arcade-bar__button:focus-visible{outline:3px solid var(--accent,#6ea8fe);outline-offset:2px}
      .arcade-bar__title{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px;line-height:1.15;font-weight:700;letter-spacing:-.012em}
      .arcade-bar__spacer{flex:1;min-width:4px}.arcade-bar__best{color:var(--muted,var(--text2,#9b9bb8));font-size:12px;font-weight:650;white-space:nowrap}
      .arcade-context{box-sizing:border-box;min-height:44px;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:4px 14px;
        border-bottom:1px solid var(--border,#2a2a4a);background:var(--bg,#0d0d1a);color:var(--muted,var(--text2,#9b9bb8));
        font:650 13px/1.2 -apple-system,"SF Pro Text",BlinkMacSystemFont,"Segoe UI",sans-serif}
      .arcade-context code{color:var(--text,#e8e8f0)}.arcade-context [data-arcade-hidden-control]{display:none!important}
      .arcade-hardware-keyboard [data-arcade-touch-controls]{display:none!important}
      @media(max-width:520px){.arcade-bar{gap:4px}.arcade-bar__back{font-size:13px;padding-inline:7px}.arcade-bar .arcade-bar__title{font-size:15px}.arcade-bar__best{display:none}.arcade-bar__button{padding:0 8px}.arcade-context{justify-content:center;flex-wrap:wrap}}
      @media(prefers-reduced-motion:reduce){.arcade-bar__back,.arcade-bar__button{transition:background .12s ease,border-color .12s ease}.arcade-bar__back:active,.arcade-bar__button:active{transform:none}}
      @media(prefers-reduced-transparency:reduce){.arcade-bar{background:var(--bg,#0d0d1a);backdrop-filter:none;-webkit-backdrop-filter:none}}
      @media(prefers-contrast:more){.arcade-bar{background:var(--bg,#0d0d1a);border-bottom-color:currentColor}}
    `;
    document.head.appendChild(style);
  }

  function button(className, label, text, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.setAttribute("aria-label", label);
    element.title = label;
    element.textContent = text;
    element.addEventListener("click", onClick);
    return element;
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
    bar.append(back, title, spacer, best);

    if (!config.noScore) {
      const board = button("arcade-bar__button arcade-bar__leaderboard", "Leaderboard", "🏆", config.onLeaderboard || (() => window.PB?.openBoard?.()));
      bar.appendChild(board);
    }
    if (config.restart !== false) {
      const restart = button("arcade-bar__button arcade-bar__restart", "Restart", "↻", config.onRestart || runRestart);
      bar.appendChild(restart);
    }
    const mute = button("arcade-bar__button arcade-bar__mute", muted() ? "Unmute" : "Mute", muted() ? "🔇" : "🔊", () => {
      const next = !muted();
      applyMute(next);
      mute.textContent = next ? "🔇" : "🔊";
      mute.setAttribute("aria-label", next ? "Unmute" : "Mute");
      if (config.onMute) config.onMute(next);
    });
    bar.appendChild(mute);

    if (!host) {
      const replaceTarget = config.replace ? document.querySelector(config.replace) : null;
      if (replaceTarget) replaceTarget.replaceWith(bar);
      else document.body.prepend(bar);
    }
    return Object.freeze({ bar, title, best, mute });
  }

  function reportKeyboardInput(event) {
    if (!event.isTrusted || !CONTROL_KEYS.has(event.key)) return;
    lastKeyboardAt = Date.now();
    sessionSet(KEYBOARD_SESSION_KEY, String(lastKeyboardAt));
    if (!options.standalone) window.parent.postMessage({ __pbKeyboard: 1 }, "*");
    document.documentElement.classList.add("arcade-hardware-keyboard");
  }

  function reportTouchInput(event) {
    if (!event.isTrusted || event.pointerType !== "touch" || Date.now() - lastKeyboardAt < KEYBOARD_IDLE_MS) return;
    try { sessionStorage.removeItem(KEYBOARD_SESSION_KEY); }
    catch (error) { warn("Could not clear session storage.", error); }
    if (!options.standalone) window.parent.postMessage({ __pbTouch: 1 }, "*");
    document.documentElement.classList.remove("arcade-hardware-keyboard");
  }

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
    if (options.noScore || !options.id) return;
    import("../pixelbreak-records.js?v=19").then(() => {
      window.PB?.registerStandalone?.({
        id: options.id,
        name: options.title,
        noScore: options.noScore,
        lowerIsBetter: options.lowerIsBetter,
      });
    }).catch((error) => warn("Could not start standalone score saving.", error));
  }

  const Arcade = Object.freeze({
    score(value) { report(value, false); },
    gameOver(value) { report(value, true); },
    onRestart(handler) { restartHandler = typeof handler === "function" ? handler : null; },
    onMute(handler) {
      muteHandler = typeof handler === "function" ? handler : null;
      if (muteHandler) muteHandler(muted());
    },
    mountBar,
    options,
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
