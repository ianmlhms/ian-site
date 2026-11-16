/* Sign-in without typing the PIN. ES module, imported by auth.js.
 *
 * Two independent ways, both optional extras next to the normal PIN/password
 * login, which never depends on them:
 *
 * 1. Passkey ("Mat Face ID aloggen"): Supabase Auth's native passkeys
 *    (WebAuthn, enabled on the project with rpID ian.lu). The device checks
 *    Face ID / Touch ID itself; Supabase only stores a public key.
 *
 * 2. Face scan ("Mam Gesiicht aloggen"): face-scan.js matches the camera image
 *    on this device against a face template saved in this browser. When it
 *    matches, the device key saved next to it is traded for a session by the
 *    auth-face edge function. The face template never leaves the device.
 *
 * Hardening (v2, 16 Nov 2026, scripts/security-fix-face-v2.sql):
 *  - enrolling a face (and turning on a passkey) needs the PIN or password again;
 *  - the device key changes on every face login (the server keeps only hashes),
 *    an old key used again revokes the device, unused devices expire after 60 days;
 *  - admin accounts cannot use the face scan;
 *  - faces saved by v1 (no PIN check when they were made) must be scanned again. */

const FACE_FUNCTION = "auth-face";
const FACE_STORE_KEY = "ianlu-face-v1";   // the key stays; the format inside is versioned
const FACE_STORE_VERSION = 2;
const FACE_TEMPLATE_SIZE = 128;
const UUID_SHAPE = /^[0-9a-f-]{36}$/i;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;
/* Server answers after which the saved device key is useless: drop it here too. */
const DEVICE_GONE = new Set(["invalid_login", "device_revoked", "expired", "reenroll", "admin_forbidden"]);

function faceError(code, message, cause) {
  return Object.assign(new Error(message), { code, cause });
}

/* ---------- passkeys ---------- */

export function passkeySupported() {
  return window.isSecureContext &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.get === "function";
}

export async function passkeyLogin(sb) {
  const { data, error } = await sb.auth.signInWithPasskey();
  if (error) throw error;
  if (!data?.session) throw new Error("passkey sign-in returned no session");
  return data;
}

export async function passkeyRegister(sb) {
  const { data, error } = await sb.auth.registerPasskey();
  if (error) throw error;
  return data;
}

export async function passkeyList(sb) {
  const { data, error } = await sb.auth.passkey.list();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function passkeyRemove(sb, passkeyId) {
  const { error } = await sb.auth.passkey.delete({ passkeyId });
  if (error) throw error;
}

/** The person closed the Face ID sheet, or this device has no passkey for ian.lu. */
export function passkeyCancelled(error) {
  const name = error?.cause?.name || error?.name;
  return name === "NotAllowedError" || error?.code === "ERROR_CEREMONY_ABORTED";
}

/** Registering again on a device that already has this passkey. */
export function passkeyAlreadyHere(error) {
  return error?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED";
}

/* ---------- face scan: what this browser remembers ---------- */

function validEntry(entry) {
  return Boolean(entry) &&
    typeof entry.userId === "string" &&
    typeof entry.username === "string" &&
    UUID_SHAPE.test(entry.deviceId || "") &&
    typeof entry.secret === "string" &&
    Array.isArray(entry.face) &&
    entry.face.length === FACE_TEMPLATE_SIZE &&
    entry.face.every((value) => Number.isFinite(value));
}

/* Entries saved by v1 are kept (so the login can say "scan again") but marked
 * legacy: their device keys were made without a PIN check and the server has
 * deleted them. */
function readFaceStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FACE_STORE_KEY) || "null");
    const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    const fromV1 = parsed?.v !== FACE_STORE_VERSION;
    return accounts.filter(validEntry).map((entry) => Object.freeze({
      ...entry,
      legacy: fromV1 || entry.legacy === true,
    }));
  } catch (error) {
    console.warn("[face] saved faces unreadable", error);
    return [];
  }
}

function writeFaceStore(accounts) {
  try {
    localStorage.setItem(FACE_STORE_KEY, JSON.stringify({ v: FACE_STORE_VERSION, accounts }));
    return true;
  } catch (error) {
    console.warn("[face] could not save", error);
    return false;
  }
}

/** Accounts whose face is saved on this device (with their device keys). */
export const faceEntries = () => readFaceStore();

export const faceEntryFor = (userId) =>
  readFaceStore().find((entry) => entry.userId === userId) || null;

function forgetLocally(userId) {
  writeFaceStore(readFaceStore().filter((entry) => entry.userId !== userId));
}

/* Drops the entry only while it still holds the key that was refused: a newer
 * key saved meanwhile (another tab, a fresh scan) must survive. */
function forgetIfUnchanged(entry) {
  const accounts = readFaceStore();
  const kept = accounts.filter((item) =>
    !(item.deviceId === entry.deviceId && item.secret === entry.secret));
  if (kept.length !== accounts.length) writeFaceStore(kept);
}

/* Saves the device key the server just issued, in place of the one it retired. */
function saveRotated(entry, nextSecret) {
  const accounts = readFaceStore();
  const next = accounts.map((item) =>
    item.deviceId === entry.deviceId && item.secret === entry.secret
      ? Object.freeze({ ...item, secret: nextSecret, legacy: false })
      : item);
  if (!writeFaceStore(next)) console.warn("[face] new device key not saved; the next face login will fail safely");
}

const DEVICE_KINDS = Object.freeze([
  ["iPad", (ua) => /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)],
  ["iPhone", (ua) => /iPhone/.test(ua)],
  ["Android", (ua) => /Android/.test(ua)],
  ["Chromebook", (ua) => /CrOS/.test(ua)],
  ["Mac", (ua) => /Macintosh/.test(ua)],
  ["Windows", (ua) => /Windows/.test(ua)],
  ["Linux", (ua) => /Linux/.test(ua)],
]);
const BROWSERS = Object.freeze([
  ["Edge", /Edg[A-Z]*\//],
  ["Chrome", /(CriOS|Chrome)\//],
  ["Firefox", /(FxiOS|Firefox)\//],
  ["Safari", /Safari\//],
]);

/** "iPad · Safari": what the profile's device list shows for this device. */
export function deviceLabel(ua = navigator.userAgent || "") {
  const kind = DEVICE_KINDS.find(([, test]) => test(ua))?.[0] || "Apparat";
  const browser = BROWSERS.find(([, pattern]) => pattern.test(ua))?.[0];
  return browser ? `${kind} · ${browser}` : kind;
}

/* ---------- face scan: server side ---------- */

/* functions.invoke hides a non-2xx body in error.context (the Response). */
async function serverErrorCode(error, data) {
  if (typeof data?.error === "string") return data.error;
  const response = error?.context;
  if (typeof response?.clone === "function") {
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string") return body.error;
    } catch { /* not JSON: fall through to the status */ }
  }
  return response?.status === 401 ? "invalid_login" : "unavailable";
}

async function invokeFace(sb, body) {
  const { data, error } = await sb.functions.invoke(FACE_FUNCTION, { body });
  if (error || !data || data.error) {
    const code = await serverErrorCode(error, data);
    throw Object.assign(faceError(code, "face request failed", error), {
      status: error?.context?.status,
    });
  }
  return data;
}

/** Checks the signed-in player's PIN (or old password) on the server. */
export async function faceReauth(sb, credential) {
  await invokeFace(sb, { action: "reauth", credential: String(credential ?? "") });
}

/** Saves `face` for the signed-in user on this device. Replaces an older one. */
export async function faceEnroll(sb, { userId, username, face, credential }) {
  const previous = faceEntryFor(userId);
  const device = await invokeFace(sb, {
    action: "enroll",
    credential: String(credential ?? ""),
    name: deviceLabel(),
  });
  if (!UUID_SHAPE.test(device.deviceId || "") || !SECRET_SHAPE.test(device.secret || "")) {
    throw faceError("unavailable", "enroll returned no device key");
  }
  const entry = Object.freeze({
    userId,
    username,
    deviceId: device.deviceId,
    secret: device.secret,
    face,
    savedAt: new Date().toISOString(),
  });
  const others = readFaceStore().filter((item) => item.userId !== userId);
  if (!writeFaceStore([...others, entry])) {
    await invokeFace(sb, { action: "forget", deviceId: entry.deviceId, secret: entry.secret })
      .catch((error) => console.warn("[face] cleanup failed", error));
    throw faceError("storage", "face not saved");
  }
  if (previous && !previous.legacy) {
    void invokeFace(sb, { action: "forget", deviceId: previous.deviceId, secret: previous.secret })
      .catch((error) => console.warn("[face] old device key not removed", error));
  }
  return entry;
}

let faceLoginRunning = false;

/** Signs in as `entry` (already matched by face). Saves the new device key the
 *  server hands out; drops the entry when the server no longer accepts it. */
export async function faceLogin(sb, entry) {
  if (entry.legacy) {
    forgetLocally(entry.userId);
    throw faceError("reenroll", "face saved before v2: scan again");
  }
  // Two logins with one key would make the server see the second as a replay.
  if (faceLoginRunning) throw faceError("busy", "face login already running");
  faceLoginRunning = true;
  try {
    let data;
    try {
      data = await invokeFace(sb, {
        action: "login",
        deviceId: entry.deviceId,
        secret: entry.secret,
      });
    } catch (error) {
      if (DEVICE_GONE.has(error.code)) forgetIfUnchanged(entry);
      throw error;
    }
    if (SECRET_SHAPE.test(data.secret || "")) saveRotated(entry, data.secret);
    else console.warn("[face] server sent no new device key");
    const result = await sb.auth.verifyOtp({ type: "email", token_hash: data.hashed_token });
    if (result.error) throw result.error;
    return result.data;
  } finally {
    faceLoginRunning = false;
  }
}

/** Removes this device's saved face for `userId`, here and on the server. */
export async function faceForget(sb, userId) {
  const entry = faceEntryFor(userId);
  forgetLocally(userId);
  if (!entry || entry.legacy) return;
  await invokeFace(sb, { action: "forget", deviceId: entry.deviceId, secret: entry.secret });
}

/** Every face device of the signed-in player (newest use first). `here` marks this browser's. */
export async function faceDevices(sb, userId) {
  const { data, error } = await sb.rpc("face_devices_mine");
  if (error) throw error;
  const local = faceEntryFor(userId);
  return (Array.isArray(data) ? data : []).map((row) => Object.freeze({
    id: row.id,
    name: row.name || "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    here: Boolean(local && !local.legacy && local.deviceId === row.id),
  }));
}

/** Deletes one of the signed-in player's face devices (the server checks it is theirs). */
export async function faceDeviceRemove(sb, userId, deviceId) {
  const { error } = await sb.rpc("face_device_delete", { p_id: deviceId });
  if (error) throw error;
  if (faceEntryFor(userId)?.deviceId === deviceId) forgetLocally(userId);
}

/** "All Gesiichter ofmellen": every face device of the signed-in player, everywhere. */
export async function faceForgetAll(sb, userId) {
  forgetLocally(userId);
  const { error } = await sb.rpc("face_devices_forget_all");
  if (error) throw error;
}
