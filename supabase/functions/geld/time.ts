/* Europe/Luxembourg calendar helpers. Months and days in geld are always
 * Luxembourg-local, never UTC. */
export const TZ = "Europe/Luxembourg";
const MINUTE_MS = 60_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function parts(ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset of Luxembourg from UTC (minutes) at an instant. */
function offsetMinutes(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE_MS);
}

/** "YYYY-MM-DD" of an instant, Luxembourg time. */
export function lbDay(ms: number): string {
  const p = parts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function lbMonth(ms: number): string {
  return lbDay(ms).slice(0, 7);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isValidDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The instant (ms) of 00:00 Luxembourg time on a valid YYYY-MM-DD. */
export function lbMidnight(day: string): number {
  const m = DAY_RE.exec(day)!;
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const first = utcMidnight - offsetMinutes(utcMidnight) * MINUTE_MS;
  const second = utcMidnight - offsetMinutes(first) * MINUTE_MS;
  return second;
}

/** [start, end) instants of a Luxembourg day. */
export function dayRange(day: string): [number, number] {
  return [lbMidnight(day), lbMidnight(addDays(day, 1))];
}

export function addDays(day: string, n: number): string {
  const m = DAY_RE.exec(day)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.toISOString().slice(0, 10);
}

/** [start, end) instants of a Luxembourg month "YYYY-MM". */
export function monthRange(month: string): [number, number] {
  const m = MONTH_RE.exec(month)!;
  const y = Number(m[1]), mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return [lbMidnight(`${month}-01`), lbMidnight(`${next}-01`)];
}
