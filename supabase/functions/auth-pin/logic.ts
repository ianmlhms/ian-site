export const PIN_LENGTHS = Object.freeze([4, 6]);

export const LOGIN_ERROR = Object.freeze({
  error: "invalid_login",
});

// Published four-digit frequency order from SecLists'
// DataGenetics-derived list. Keep exactly the top 100.
const COMMON_4 = new Set([
  "1234", "1111", "0000", "1212", "7777",
  "1004", "2000", "4444", "2222", "6969",
  "9999", "3333", "5555", "6666", "1122",
  "1313", "8888", "2001", "4321", "1010",
  "0909", "2580", "0007", "1818", "1230",
  "1984", "1986", "0070", "1985", "0987",
  "1000", "1231", "1987", "1999", "2468",
  "2002", "2323", "0123", "1123", "1233",
  "1357", "1221", "1324", "1988", "2112",
  "2121", "5150", "1024", "1112", "1224",
  "1969", "1225", "1235", "1982", "1983",
  "1001", "1978", "1979", "7410", "1020",
  "1223", "1974", "1975", "1977", "1980",
  "1981", "1029", "1121", "1213", "1973",
  "1976", "2020", "2345", "2424", "2525",
  "1515", "1970", "1972", "1989", "0001",
  "1023", "1414", "9876", "0101", "0907",
  "1245", "1966", "1967", "1971", "8520",
  "1964", "1968", "4545", "1318", "5678",
  "1011", "1124", "1211", "1963", "4200",
]);

// First 50 six-digit numeric entries in SecLists'
// frequency-ranked 10k common-password publication.
const COMMON_6 = new Set([
  "123456", "696969", "111111", "654321",
  "123123", "666666", "121212", "131313",
  "000000", "112233", "222222", "777777",
  "987654", "232323", "555555", "123321",
  "999999", "333333", "888888", "444444",
  "101010", "420420", "147147", "212121",
  "242424", "007007", "123654", "789456",
  "252525", "159753", "141414", "202020",
  "151515", "323232", "314159", "246810",
  "111222", "181818", "171717", "147258",
  "102030", "363636", "343434", "454545",
  "424242", "272727", "098765", "159357",
  "147852", "191919",
]);

export const BLOCKLIST_SIZES = Object.freeze({
  four: COMMON_4.size,
  six: COMMON_6.size,
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

export function isAllSame(pin: string): boolean {
  if (!pin) return false;
  return pin.split("").every((digit) => digit === pin[0]);
}

export function isRun(pin: string): boolean {
  const ascending = "01234567890";
  const descending = "09876543210";
  return ascending.includes(pin) || descending.includes(pin);
}

export function isRepeatedChunk(pin: string): boolean {
  for (let size = 1; size <= pin.length / 2; size += 1) {
    if (pin.length % size !== 0) continue;
    const chunk = pin.slice(0, size);
    if (chunk.repeat(pin.length / size) === pin) return true;
  }
  return false;
}

export function hasRepeatedGroups(pin: string): boolean {
  return [2, 3].some((size) => {
    if (pin.length % size !== 0) return false;
    const groups = pin.match(new RegExp(`.{${size}}`, "g")) || [];
    return groups.length > 1 && groups.every(isAllSame);
  });
}

export function isRecentYear(pin: string): boolean {
  return pin.length === 4 && /^(19|20)\d{2}$/.test(pin);
}

function leapYear(year: number): boolean {
  return year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);
}

function validDateParts(
  day: number,
  month: number,
  year: number,
): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [
    31, leapYear(year) ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31,
  ];
  return day <= days[month - 1];
}

export function isDatePin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  const first = Number(pin.slice(0, 2));
  const second = Number(pin.slice(2, 4));
  const year = 2000 + Number(pin.slice(4));
  return validDateParts(first, second, year) ||
    validDateParts(second, first, year);
}

export function isWeakPin(pin: string): boolean {
  if (COMMON_4.has(pin) || COMMON_6.has(pin)) return true;
  if (isRun(pin) || isRepeatedChunk(pin)) return true;
  if (hasRepeatedGroups(pin)) return true;
  return isRecentYear(pin) || isDatePin(pin);
}

export function validPin(
  pin: unknown,
  length: unknown,
): pin is string {
  if (!isPinLength(length)) return false;
  if (typeof pin !== "string") return false;
  if (pin.length !== length) return false;
  if (!/^\d+$/.test(pin)) return false;
  return !isWeakPin(pin);
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
