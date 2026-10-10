/* Remote actions share the presence timer; returning false defers to its next ping. */
import "./i18n-dict.js?v=47";
const FLUSH_TIMEOUT_MS = 3_000;
const RELOAD_TOAST_MS = 2_000;
const CLOSE_TOAST_MS = 5_000;
const BLOCKING_MODALS = 'dialog[open], .pb-modal.open, #class-gate, .acct-card, .site-notice, .auth-modal.open';

export function commandsSafe() {
  if (document.querySelector(BLOCKING_MODALS)) return false;
  // Check a focused same-origin game frame as well as the parent page.
  let doc = document;
  try {
    while (doc.activeElement?.tagName === "IFRAME") {
      const child = doc.activeElement.contentDocument;
      if (!child) break;
      doc = child;
      if (doc.querySelector(BLOCKING_MODALS)) return false;
    }
    const focused = doc.activeElement;
    if (!focused) return true;
    if (focused.matches("input, textarea, select")) return !String(focused.value || "");
    if (focused.isContentEditable) return !focused.textContent;
  } catch (error) {
    console.warn("[commands] could not check focused field", error);
    return false;
  }
  return true;
}

function text(key) {
  if (window.I18N) return window.I18N.t(key);
  let lang = "lb";
  try { lang = localStorage.getItem("site_lang") || lang; }
  catch (error) { console.warn("[commands] language read failed", error); }
  return window.I18N_DICT?.[key]?.[lang] || window.I18N_DICT?.[key]?.lb || key;
}

function toast(key, reason, duration) {
  const element = document.createElement("div");
  element.className = "client-command-toast";
  element.setAttribute("role", "status");
  // textContent keeps an admin-supplied reason literal, including HTML characters.
  element.textContent = text(key) + (reason ? ` ${String(reason)}` : "");
  element.style.cssText = "position:fixed;z-index:100002;bottom:24px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100% - 32px);padding:14px 18px;border-radius:12px;background:var(--card-opaque,var(--card,#161625));color:var(--text,#e8e8f0);border:1px solid var(--border,#444);box-shadow:0 8px 32px #0004;font:600 14px/1.5 system-ui;overflow-wrap:anywhere;pointer-events:none";
  document.body.appendChild(element);
  setTimeout(() => element.remove(), duration);
}

async function flushGame() {
  if (!window.PB?.current || typeof window.__pbFlushSave !== "function") return;
  let timeout;
  try {
    await Promise.race([
      Promise.resolve().then(() => window.__pbFlushSave()),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("save flush timed out")), FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn("[commands] save flush failed; continuing", error);
  } finally {
    clearTimeout(timeout);
  }
}

async function reload(cmd, eligible = () => true) {
  if (!eligible() || !commandsSafe()) return false;
  await flushGame();
  if (!eligible() || !commandsSafe()) return false;
  toast("commands.reloading", cmd.reason, RELOAD_TOAST_MS);
  await new Promise((resolve) => setTimeout(resolve, RELOAD_TOAST_MS));
  if (!eligible() || !commandsSafe()) return false;
  // Capture any saves posted during the toast, immediately before leaving.
  await flushGame();
  if (!eligible() || !commandsSafe()) return false;
  location.reload();
  return true;
}

async function closeGame(cmd, eligible = () => true) {
  const game = window.PB?.current;
  if (!game || (cmd.game_id !== null && cmd.game_id !== undefined && cmd.game_id !== game.id)) return true;
  if (!eligible() || !commandsSafe()) return false;
  await flushGame();
  if (!eligible() || !commandsSafe()) return false;
  if (window.PB?.current !== game) return true;
  if (typeof window.closeGame !== "function") throw new Error("arcade close hook unavailable");
  window.closeGame();
  toast("commands.closed", cmd.reason, CLOSE_TOAST_MS);
  return true;
}

window.__ianCommands = { reload, closeGame, ...window.__ianCommands };
