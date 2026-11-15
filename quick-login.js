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
 *    auth-face edge function. The face template never leaves the device. */

const FACE_FUNCTION = "auth-face";
const FACE_STORE_KEY = "ianlu-face-v1";
const FACE_TEMPLATE_SIZE = 128;
const UUID_SHAPE = /^[0-9a-f-]{36}$/i;

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

function readFaceStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FACE_STORE_KEY) || "null");
    const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    return accounts.filter(validEntry);
  } catch (error) {
    console.warn("[face] saved faces unreadable", error);
    return [];
  }
}

function writeFaceStore(accounts) {
  try {
    localStorage.setItem(FACE_STORE_KEY, JSON.stringify({ v: 1, accounts }));
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

/* ---------- face scan: server side ---------- */

async function invokeFace(sb, body) {
  const { data, error } = await sb.functions.invoke(FACE_FUNCTION, { body });
  if (error || !data || data.error) {
    const status = error?.context?.status;
    throw Object.assign(new Error("face request failed"), {
      code: data?.error || (status === 401 ? "invalid_login" : "unavailable"),
      status,
      cause: error,
    });
  }
  return data;
}

/** Saves `face` for the signed-in user on this device. Replaces an older one. */
export async function faceEnroll(sb, { userId, username, face }) {
  const previous = faceEntryFor(userId);
  const device = await invokeFace(sb, { action: "enroll" });
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
    throw Object.assign(new Error("face not saved"), { code: "storage" });
  }
  if (previous) {
    void invokeFace(sb, { action: "forget", deviceId: previous.deviceId, secret: previous.secret })
      .catch((error) => console.warn("[face] old device key not removed", error));
  }
  return entry;
}

/** Signs in as `entry` (already matched by face). Drops it when the server no longer knows the key. */
export async function faceLogin(sb, entry) {
  let data;
  try {
    data = await invokeFace(sb, {
      action: "login",
      deviceId: entry.deviceId,
      secret: entry.secret,
    });
  } catch (error) {
    if (error.code === "invalid_login") forgetLocally(entry.userId);
    throw error;
  }
  const result = await sb.auth.verifyOtp({ type: "email", token_hash: data.hashed_token });
  if (result.error) throw result.error;
  return result.data;
}

/** Removes this device's saved face for `userId`, here and on the server. */
export async function faceForget(sb, userId) {
  const entry = faceEntryFor(userId);
  forgetLocally(userId);
  if (!entry) return;
  await invokeFace(sb, { action: "forget", deviceId: entry.deviceId, secret: entry.secret });
}
