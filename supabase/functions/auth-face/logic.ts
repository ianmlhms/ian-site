// Pure helpers for auth-face (no I/O), tested in logic_test.ts.

export const SECRET_BYTES = 32;
export const DEVICE_NAME_MAX = 40;
const DEFAULT_DEVICE_NAME = "Apparat";
const CREDENTIAL_MAX = 1024;
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;
// deno-lint-ignore no-control-regex
const NAME_CONTROL = /[\u0000-\u001f\u007f]/g;
const NAME_JUNK = /[<>"'`]/g;

export type FaceAction = "enroll" | "reauth" | "login" | "forget" | "";

/** What face_device_check() answers (see scripts/security-fix-face-v2.sql). */
export type CheckResult =
  | "ok"
  | "unknown"
  | "replayed"
  | "expired"
  | "reenroll"
  | "admin";

/* The error code the browser gets for a refused check. */
const CHECK_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  unknown: "invalid_login",
  replayed: "device_revoked",
  expired: "expired",
  reenroll: "reenroll",
  admin: "admin_forbidden",
});

export type DeviceProof = {
  deviceId: string;
  secret: string;
};

export function normalizeAction(value: unknown): FaceAction {
  if (
    value === "enroll" || value === "reauth" || value === "login" ||
    value === "forget"
  ) {
    return value;
  }
  return "";
}

/** Error code for a refused face_device_check() result; anything odd is invalid_login. */
export function checkError(result: unknown): string {
  if (typeof result === "string" && Object.hasOwn(CHECK_ERRORS, result)) {
    return CHECK_ERRORS[result];
  }
  return CHECK_ERRORS.unknown;
}

/** deviceId + secret from a request body, or null when either is malformed. */
export function deviceProof(
  body: Record<string, unknown>,
): DeviceProof | null {
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (!UUID_SHAPE.test(deviceId) || !SECRET_SHAPE.test(secret)) return null;
  return Object.freeze({ deviceId: deviceId.toLowerCase(), secret });
}

/** The PIN or password typed again before enrolling; "" when missing. */
export function credentialFrom(body: Record<string, unknown>): string {
  const value = body.credential;
  if (typeof value !== "string") return "";
  return value.trim().slice(0, CREDENTIAL_MAX);
}

/** A short, harmless label for the profile's device list ("iPad · Safari"). */
export function deviceName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DEVICE_NAME;
  const clean = value.replace(NAME_CONTROL, " ").replace(NAME_JUNK, "").replace(
    /\s+/g,
    " ",
  ).trim()
    .slice(0, DEVICE_NAME_MAX).trim();
  return clean || DEFAULT_DEVICE_NAME;
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function newSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function hashSecret(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(`face-device:${secret}`);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compares two hex digests without stopping at the first difference. */
export function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isKartUser(user: unknown): boolean {
  const meta = (user as { user_metadata?: Record<string, unknown> } | null)
    ?.user_metadata;
  return meta?.account_kind === "kart";
}
