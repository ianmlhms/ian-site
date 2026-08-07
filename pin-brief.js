import { openPinDialog } from "./auth-ui.js?v=3";
import { esc, translate } from "./pin-pad.js?v=2";

const SKIP_PREFIX = "pinBriefSkip:";
const VISIT_KEY = "pinBriefVisit";
const RECOVERY_TYPE = "recovery";
const RECOVERY_AT_LOAD = new URLSearchParams(
  window.location.hash.replace(/^#/, ""),
).get("type") === RECOVERY_TYPE;

let checking = false;
let checkedMarker = "";
let brief = null;
let recoveryPending = RECOVERY_AT_LOAD;

function t(key, fallback) {
  return translate(key, fallback);
}

function visitMarker() {
  try {
    const existing = sessionStorage.getItem(VISIT_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(VISIT_KEY, created);
    return created;
  } catch {
    return "page";
  }
}

function sessionMarker(session) {
  const user = session?.user;
  if (!user?.id) return "";
  return `${user.id}:${visitMarker()}`;
}

function skipKey(userId) {
  return `${SKIP_PREFIX}${userId}`;
}

function hasSkipped(session) {
  const userId = session?.user?.id;
  if (!userId) return false;
  try {
    return localStorage.getItem(skipKey(userId)) ===
      sessionMarker(session);
  } catch {
    return false;
  }
}

function rememberSkip(session) {
  const userId = session?.user?.id;
  if (!userId) return;
  try {
    localStorage.setItem(
      skipKey(userId),
      sessionMarker(session),
    );
  } catch { /* private mode: dismiss for this page */ }
}

function recoveryRequested() {
  if (recoveryPending) return true;
  const hash = new URLSearchParams(
    window.location.hash.replace(/^#/, ""),
  );
  return hash.get("type") === RECOVERY_TYPE;
}

function clearRecoveryHash() {
  if (!recoveryRequested()) return;
  recoveryPending = false;
  const clean = window.location.pathname +
    window.location.search;
  window.history.replaceState(null, "", clean);
}

function removeBrief() {
  brief?.remove();
  brief = null;
}

function briefingMarkup() {
  return `<div class="auth-box pin-brief">
    <h3>${esc(t("pin.briefTitle", "Nei: Umelle mat PIN"))}</h3>
    <p>${esc(t(
      "pin.briefText",
      "Du kanns elo e 4- oder 6-stellege PIN benotzen. " +
        "Dat ass um Handy méi séier.",
    ))}</p>
    <p class="pin-note">${esc(t(
      "pin.passwordForever",
      "Däi Passwuert funktionéiert fir ëmmer weider. " +
        "Du gëss ni ausgespaart.",
    ))}</p>
    <p class="pin-note">${esc(t(
      "pin.recoveryAdvice",
      "Wann s de däi PIN vergëss, schreif dem Ian. " +
        "En E-Mail-Reset ass net garantéiert.",
    ))}</p>
    <div class="pin-row">
      <button class="auth-go" id="pinBriefSet">${esc(t(
        "pin.setNow",
        "PIN elo setzen",
      ))}</button>
      <button class="auth-tab" id="pinBriefLater">${esc(t(
        "pin.later",
        "Méi spéit",
      ))}</button>
    </div>
  </div>`;
}

function showBriefing(deps, session) {
  if (brief || document.getElementById("pin-brief-modal")) return;
  brief = document.createElement("div");
  brief.id = "pin-brief-modal";
  brief.className = "auth-modal open";
  brief.innerHTML = briefingMarkup();
  document.body.appendChild(brief);
  brief.querySelector("#pinBriefLater").addEventListener(
    "click",
    () => {
      rememberSkip(session);
      removeBrief();
    },
  );
  brief.querySelector("#pinBriefSet").addEventListener(
    "click",
    () => {
      removeBrief();
      openPinDialog(deps, {
        required: false,
        hasPin: false,
      });
    },
  );
}

function showRequiredPin(deps, recovery) {
  openPinDialog(deps, {
    required: !recovery,
    recovery,
    hasPin: false,
    onDone: clearRecoveryHash,
  });
}

async function inspectSession(deps, current) {
  const status = await deps.pinStatus();
  if (recoveryRequested()) {
    showRequiredPin(deps, true);
    return;
  }
  if (status.hasPin) return;
  if (!status.isLegacy) {
    showRequiredPin(deps, false);
    return;
  }
  if (!hasSkipped(current)) showBriefing(deps, current);
}

export async function startPinBriefing(deps) {
  if (deps.pinSetupPending?.()) return;
  const current = deps.session();
  const marker = sessionMarker(current);
  if (!marker) {
    checkedMarker = "";
    checking = false;
    removeBrief();
    return;
  }
  if (checking || checkedMarker === marker) return;
  checking = true;
  try {
    await inspectSession(deps, current);
    checkedMarker = marker;
  } catch (error) {
    console.warn("PIN status check failed", error);
  } finally {
    checking = false;
  }
}

export function resetPinBriefing() {
  checkedMarker = "";
  checking = false;
  removeBrief();
}

export async function openProfilePinDialog(deps) {
  try {
    const status = await deps.pinStatus();
    openPinDialog(deps, {
      required: false,
      hasPin: status.hasPin,
    });
  } catch (error) {
    console.warn("PIN status check failed", error);
    openPinDialog(deps, {
      required: false,
      hasPin: true,
    });
  }
}
