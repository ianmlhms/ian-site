export const PIN_LENGTHS = Object.freeze([4, 6]);

export const LOGIN_ERROR = Object.freeze({
  error: "invalid_login",
});

export type PinLength = 4 | 6;

export type PinRecord = {
  pin_length: number;
  failed_attempts: number;
  locked_until: string | null;
};

export type LoginPayload = {
  identifier: string;
  pin?: string;
  password?: string;
};

export type PinAction =
  | "login"
  | "set"
  | "status"
  | "admin-reset"
  | "";

export function cleanString(
  value: unknown,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function normalizeIdentifier(
  value: unknown,
): string {
  return cleanString(value, 254).toLowerCase();
}

export function normalizeAction(value: unknown): PinAction {
  if (value === "login") return "login";
  if (value === "set") return "set";
  if (value === "status") return "status";
  if (value === "admin-reset") return "admin-reset";
  return "";
}

export function isPinLength(
  value: unknown,
): value is PinLength {
  return value === 4 || value === 6;
}

export function validPin(
  pin: unknown,
  length: unknown,
): pin is string {
  if (!isPinLength(length)) return false;
  if (typeof pin !== "string") return false;
  if (pin.length !== length) return false;
  return /^\d+$/.test(pin);
}

export function loginPinValid(
  pin: unknown,
): pin is string {
  if (typeof pin !== "string") return false;
  if (pin.length !== 4 && pin.length !== 6) return false;
  return /^\d+$/.test(pin);
}

export function lockoutThreshold(length: number): number {
  return length === 4 ? 3 : 5;
}

export function lockoutSeconds(
  failedAttempts: number,
  length: number,
): number {
  const threshold = lockoutThreshold(length);
  if (failedAttempts < threshold) return 0;
  if (failedAttempts % threshold !== 0) return 0;
  const tier = Math.min(3, failedAttempts / threshold);
  if (tier === 1) return 60;
  if (tier === 2) return 300;
  return 1800;
}

export function isLocked(
  record: PinRecord | null,
  now = Date.now(),
): boolean {
  if (!record?.locked_until) return false;
  const until = Date.parse(record.locked_until);
  return Number.isFinite(until) && until > now;
}

export function uniformLoginError(): {
  readonly error: "invalid_login";
} {
  return LOGIN_ERROR;
}

export function loginPayload(
  value: unknown,
): LoginPayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const identifier = normalizeIdentifier(raw.identifier);
  if (!identifier) return null;
  const pin = typeof raw.pin === "string" ? raw.pin : undefined;
  const password = typeof raw.password === "string"
    ? raw.password.slice(0, 1024)
    : undefined;
  if (!pin && !password) return null;
  return Object.freeze({ identifier, pin, password });
}

export function sameErrorShape(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
