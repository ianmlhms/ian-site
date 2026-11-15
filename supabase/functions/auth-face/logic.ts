// Pure helpers for auth-face (no I/O), tested in logic_test.ts.

export const MAX_DEVICES_PER_USER = 8;
export const SECRET_BYTES = 32;
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type FaceAction = "enroll" | "login" | "forget" | "";

export type DeviceProof = {
  deviceId: string;
  secret: string;
};

export function normalizeAction(value: unknown): FaceAction {
  if (value === "enroll" || value === "login" || value === "forget") {
    return value;
  }
  return "";
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

/** Ids of the oldest devices to drop so a new one fits under the cap. */
export function devicesToDrop(
  rows: ReadonlyArray<{ id: string; created_at: string }>,
  max = MAX_DEVICES_PER_USER,
): string[] {
  const overflow = rows.length - (max - 1);
  if (overflow <= 0) return [];
  return [...rows]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, overflow)
    .map((row) => row.id);
}

export function isKartUser(user: unknown): boolean {
  const meta = (user as { user_metadata?: Record<string, unknown> } | null)
    ?.user_metadata;
  return meta?.account_kind === "kart";
}
