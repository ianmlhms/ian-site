/* Shared Supabase auth for ian.lu. ES module. */
import "./i18n-dict.js?v=27";
import { openAuthDialog } from "./auth-ui.js?v=4";
import { esc } from "./pin-pad.js?v=2";
import {
  openProfilePinDialog,
  resetPinBriefing,
  startPinBriefing,
} from "./pin-brief.js?v=4";

const cfg = window.PB_CONFIG || {};
const PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789-_";
const RANDOM_PASSWORD_LENGTH = 32;
const PIN_FUNCTION = "auth-pin";

export const authConfigured =
  /^https:\/\/.+\.supabase\.co\/?$/.test(
    (cfg.url || "").trim(),
  ) && (cfg.anonKey || "").trim().length > 20;

// One cache for every URL variant of this module. Multiple
// GoTrue clients race on refresh and corrupt the session.
const _g = (window.__pbAuth = window.__pbAuth || {
  sb: null,
  ready: null,
  session: null,
  cbs: [],
});

async function getCreateClient() {
  if (window.supabase?.createClient) {
    return window.supabase.createClient;
  }
  try {
    const module = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );
    return module.createClient;
  } catch {
    const module = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    return module.createClient;
  }
}

function storedSession() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(
        localStorage.getItem(key) || "null",
      );
      const stored = parsed?.currentSession || parsed;
      if (stored?.access_token &&
          stored?.refresh_token && stored?.user) {
        return stored;
      }
    }
  } catch { /* unreadable storage means no recovery hint */ }
  return null;
}

async function recoverSession(sb, data) {
  if (data.session) return data;
  const stored = storedSession();
  if (!stored) return data;
  try {
    const result = await sb.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    });
    return result.data?.session ? result.data : data;
  } catch {
    return data;
  }
}

function notifyAuth(event, current) {
  _g.session = current;
  const userId = current?.user?.id || null;
  const changed = userId !== _g.lastUid;
  if (changed && current) {
    void ensureProfile().finally(schedulePinBriefing);
  } else {
    schedulePinBriefing();
  }
  const quiet = event === "TOKEN_REFRESHED" ||
    event === "SIGNED_IN" || event === "INITIAL_SESSION";
  if (quiet && !changed) return;
  _g.lastUid = userId;
  _g.cbs.forEach((callback) => callback(current));
}

async function ensureProfile() {
  const current = _g.session;
  const name = current?.user?.user_metadata?.username;
  if (!_g.sb || !current || !name) return;
  const { error } = await _g.sb.rpc("upsert_profile", {
    p_username: String(name).slice(0, 24),
  });
  if (error) console.warn("profile setup failed", error.message);
}

function schedulePinBriefing() {
  injectCss();
  if (document.body) {
    void startPinBriefing(uiDeps);
    return;
  }
  document.addEventListener(
    "DOMContentLoaded",
    () => void startPinBriefing(uiDeps),
    { once: true },
  );
}

async function initializeClient() {
  const createClient = await getCreateClient();
  _g.sb = createClient(
    cfg.url.replace(/\/$/, ""),
    cfg.anonKey,
  );
  const initial = await _g.sb.auth.getSession();
  const data = await recoverSession(_g.sb, initial.data);
  _g.session = data.session;
  _g.lastUid = data.session?.user?.id || null;
  _g.sb.auth.onAuthStateChange(notifyAuth);
  await ensureProfile();
  schedulePinBriefing();
  return _g.sb;
}

export async function client() {
  if (_g.sb) return _g.sb;
  if (!_g.ready) _g.ready = initializeClient();
  await _g.ready;
  return _g.sb;
}

export const session = () => _g.session;

export const username = () => _g.session
  ? (_g.session.user.user_metadata?.username ||
    _g.session.user.email)
  : null;

export function onAuth(callback) {
  _g.cbs.push(callback);
}

function randomPassword() {
  const bytes = new Uint8Array(RANDOM_PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (byte) => PASSWORD_ALPHABET[byte & 63],
  ).join("");
}

/* Thrown when auth-pin itself is unreachable, as opposed to it answering
 * "those credentials are wrong". Only the former may fall back to GoTrue —
 * falling back on a genuine rejection would just retry a bad password. */
class PinServiceDown extends Error {}

/** A rejection carries our own JSON body; anything else is the service failing. */
function isServiceDown(error, data) {
  if (!error) return !data;
  const status = error.context?.status;
  return typeof status !== "number" || status === 404 || status >= 500;
}

async function invokePin(body) {
  const sb = await client();
  const { data, error } = await sb.functions.invoke(
    PIN_FUNCTION,
    { body },
  );
  if (error || !data || data.error) {
    if (isServiceDown(error, data)) throw new PinServiceDown("PIN service unavailable");
    throw new Error("PIN request failed");
  }
  return data;
}

export async function loginWithPin(identifier, pin) {
  const sb = await client();
  const data = await invokePin({
    action: "login",
    identifier,
    pin,
  });
  if (!data.hashed_token) throw new Error("PIN request failed");
  const result = await sb.auth.verifyOtp({
    type: "email",
    token_hash: data.hashed_token,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function loginWithPassword(
  identifier,
  password,
) {
  const sb = await client();
  let data;
  try {
    data = await invokePin({ action: "login", identifier, password });
  } catch (error) {
    // auth-pin down. Legacy accounts still have a real password GoTrue knows,
    // so sign them in directly rather than locking the whole site out — which
    // is exactly what happened when the frontend shipped ahead of the function.
    // Only works with an email; username resolution needs the service role.
    if (!(error instanceof PinServiceDown) || !identifier.includes("@")) throw error;
    const direct = await sb.auth.signInWithPassword({ email: identifier, password });
    if (direct.error) throw direct.error;
    return direct.data;
  }
  const accessToken = data.session?.access_token;
  const refreshToken = data.session?.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error("Password request failed");
  }
  const result = await sb.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function signIn(identifier, password) {
  return loginWithPassword(identifier, password);
}

export async function signUp(email, _password, uname) {
  return signUpRandom(email, uname);
}

export async function signUpRandom(email, uname) {
  const sb = await client();
  const password = randomPassword();
  _g.pinSetupPending = true;
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { username: uname, pin_account: true },
    },
  });
  if (error) {
    _g.pinSetupPending = false;
    throw error;
  }
  if (!data.session) _g.pinSetupPending = false;
  return data;
}

export async function setPin(pin, length, proof = {}) {
  _g.pinSetupPending = true;
  try {
    const data = await invokePin({
      action: "set",
      pin,
      length,
      currentCredential: proof.currentCredential || "",
      recovery: proof.recovery === true,
    });
    _g.pinSetupPending = false;
    schedulePinBriefing();
    return data;
  } catch (error) {
    _g.pinSetupPending = false;
    throw error;
  }
}

export async function pinStatus() {
  const sb = await client();
  const [pinResult, edgeStatus] = await Promise.all([
    sb.rpc("has_pin"),
    invokePin({ action: "status" }),
  ]);
  if (pinResult.error) throw pinResult.error;
  return Object.freeze({
    hasPin: pinResult.data === true,
    isLegacy: edgeStatus.isLegacy === true,
  });
}

export async function resetPin(email) {
  const sb = await client();
  const redirectTo = location.href.replace(/#.*$/, "");
  const { error } = await sb.auth.resetPasswordForEmail(
    email,
    { redirectTo },
  );
  if (error) throw error;
}

export async function signOut() {
  const sb = await client();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
  resetPinBriefing();
}

const uiDeps = Object.freeze({
  session,
  username,
  signOut,
  loginPin: loginWithPin,
  loginPassword: loginWithPassword,
  signUpRandom,
  setPin,
  pinStatus,
  resetPin,
  pinSetupPending: () => _g.pinSetupPending === true,
});

/* Appended last so it outranks the per-page <style> blocks, which would
 * otherwise dictate how the modal's inputs and buttons look. */
function injectCss() {
  if (document.getElementById("auth-css")) return;
  const link = document.createElement("link");
  link.id = "auth-css";
  link.rel = "stylesheet";
  link.href = "auth.css?v=1";
  document.head.appendChild(link);
}

export function openAuthModal() {
  injectCss();
  openAuthDialog(uiDeps);
}

export function openPinSetup() {
  injectCss();
  if (!session()) {
    openAuthModal();
    return;
  }
  void openProfilePinDialog(uiDeps);
}

export function mountAccountButton(host) {
  injectCss();
  const existing = host.querySelector(".auth-btn");
  const button = existing || document.createElement("button");
  const sync = () => {
    const label = session()
      ? `👤 ${esc(username())}`
      : "👤 " + esc(window.I18N?.t?.("auth.signinShort") || "Sign in");
    button.innerHTML = label;
  };
  if (!existing) {
    button.className = "auth-btn";
    button.addEventListener("click", openAuthModal);
    host.appendChild(button);
    onAuth(sync);
    client().then(sync).catch(sync);
  }
  sync();
  return button;
}
