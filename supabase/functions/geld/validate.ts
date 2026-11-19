/* Request validation for the geld edge function. Everything that crosses the
 * boundary is checked here; each parser returns a fresh typed value or
 * {error}. Pure, so it is covered by validate_test.ts. */
import { isValidDay } from "./time.ts";

export const MAX_EVENTS = 2000;
export const MAX_POSITIONS = 500;
export const MAX_DAILY = 5000;
export const MAX_BODY_BYTES = 4_000_000;
const MAX_ID = 100;
const MAX_TEXT = 200;
const MAX_ERROR = 500;
const MAX_ABS_AMOUNT = 1e9;
const ISIN_RE = /^[A-Z0-9]{12}$/;

export const TX_TYPES = [
  "card", "card_refund", "atm", "buy", "sell", "savings_plan", "dividend",
  "interest", "saveback", "transfer_in", "transfer_out", "fee", "tax", "other",
] as const;
export type TxType = typeof TX_TYPES[number];
const TYPE_SET = new Set<string>(TX_TYPES);

export type Ev = {
  id: string; at: string; amount: number; currency: string; type: TxType;
  merchant: string; isin: string | null; shares: number | null;
  status: string; event_type: string | null;
};
export type Pos = {
  isin: string; name: string; qty: number | null; avg_cost: number | null;
  buy_cost: number | null; value: number | null; price: number | null;
};
export type DailyRow = {
  day: string; depot_value: number | null; invested: number | null; cash: number | null;
};
export type SyncInput = {
  events: Ev[]; positions: Pos[] | null; cash: number | null; daily: DailyRow[] | null;
};
export type StatusInput = { ok: boolean; error: string | null; needsLogin: boolean };
type Result<T> = { value: T } | { error: string };
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One line, no control characters, clipped. */
export function clean(value: unknown, max = MAX_TEXT): string {
  const raw = typeof value === "string" ? value : "";
  // deno-lint-ignore no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

function optNum(v: unknown, field: string): Result<number | null> {
  if (v === null || v === undefined) return { value: null };
  if (!isNum(v) || Math.abs(v) > MAX_ABS_AMOUNT) return { error: `${field} must be a number` };
  return { value: v };
}

export function parseEvent(raw: unknown, index: number): Result<Ev> {
  const at = `events[${index}]`;
  if (!isObj(raw)) return { error: `${at} must be an object` };
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > MAX_ID || id.startsWith("legacy:")) return { error: `${at}.id invalid` };
  if (typeof raw.at !== "string" || Number.isNaN(Date.parse(raw.at))) return { error: `${at}.at must be an ISO date` };
  if (!isNum(raw.amount) || Math.abs(raw.amount) > MAX_ABS_AMOUNT) return { error: `${at}.amount must be a number` };
  if (typeof raw.type !== "string" || !TYPE_SET.has(raw.type)) return { error: `${at}.type unknown` };
  const shares = optNum(raw.shares, `${at}.shares`);
  if ("error" in shares) return shares;
  let isin: string | null = null;
  if (raw.isin !== null && raw.isin !== undefined) {
    if (typeof raw.isin !== "string" || !ISIN_RE.test(raw.isin)) return { error: `${at}.isin invalid` };
    isin = raw.isin;
  }
  return {
    value: {
      id,
      at: new Date(raw.at).toISOString(),
      amount: raw.amount,
      currency: clean(raw.currency, 8) || "EUR",
      type: raw.type as TxType,
      merchant: clean(raw.merchant),
      isin,
      shares: shares.value,
      status: clean(raw.status, 40),
      event_type: clean(raw.event_type, 80) || null,
    },
  };
}

function parsePosition(raw: unknown, index: number): Result<Pos> {
  const at = `positions[${index}]`;
  if (!isObj(raw)) return { error: `${at} must be an object` };
  if (typeof raw.isin !== "string" || !/^[A-Z0-9]{6,20}$/.test(raw.isin)) return { error: `${at}.isin invalid` };
  const nums: Record<string, number | null> = {};
  for (const key of ["qty", "avg_cost", "buy_cost", "value", "price"]) {
    const n = optNum(raw[key], `${at}.${key}`);
    if ("error" in n) return n;
    nums[key] = n.value;
  }
  return {
    value: {
      isin: raw.isin, name: clean(raw.name), qty: nums.qty, avg_cost: nums.avg_cost,
      buy_cost: nums.buy_cost, value: nums.value, price: nums.price,
    },
  };
}

function parseDaily(raw: unknown, index: number): Result<DailyRow> {
  const at = `daily[${index}]`;
  if (!isObj(raw)) return { error: `${at} must be an object` };
  if (!isValidDay(raw.day)) return { error: `${at}.day must be YYYY-MM-DD` };
  const nums: Record<string, number | null> = {};
  for (const key of ["depot_value", "invested", "cash"]) {
    const n = optNum(raw[key], `${at}.${key}`);
    if ("error" in n) return n;
    nums[key] = n.value;
  }
  return { value: { day: raw.day, depot_value: nums.depot_value, invested: nums.invested, cash: nums.cash } };
}

function parseList<T>(
  raw: unknown, max: number, name: string, one: (item: unknown, i: number) => Result<T>,
): Result<T[]> {
  if (!Array.isArray(raw)) return { error: `${name} must be an array` };
  if (raw.length > max) return { error: `${name}: at most ${max} entries per call` };
  const out: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = one(raw[i], i);
    if ("error" in parsed) return parsed;
    out.push(parsed.value);
  }
  return { value: out };
}

export function parseSync(body: Obj): Result<SyncInput> {
  const events = parseList(body.events ?? [], MAX_EVENTS, "events", parseEvent);
  if ("error" in events) return events;
  let positions: Pos[] | null = null;
  if (body.positions !== null && body.positions !== undefined) {
    const p = parseList(body.positions, MAX_POSITIONS, "positions", parsePosition);
    if ("error" in p) return p;
    positions = p.value;
  }
  let daily: DailyRow[] | null = null;
  if (body.daily !== null && body.daily !== undefined) {
    const d = parseList(body.daily, MAX_DAILY, "daily", parseDaily);
    if ("error" in d) return d;
    daily = d.value;
  }
  const cash = optNum(body.cash, "cash");
  if ("error" in cash) return cash;
  return { value: { events: events.value, positions, cash: cash.value, daily } };
}

export function parseStatus(body: Obj): Result<StatusInput> {
  if (typeof body.ok !== "boolean") return { error: "ok must be a boolean" };
  if (body.needs_login !== undefined && typeof body.needs_login !== "boolean") {
    return { error: "needs_login must be a boolean" };
  }
  return {
    value: {
      ok: body.ok,
      error: clean(body.error, MAX_ERROR) || null,
      needsLogin: body.needs_login === true,
    },
  };
}

export function parseReportDate(body: Obj): Result<string> {
  return isValidDay(body.date) ? { value: body.date } : { error: "date must be YYYY-MM-DD" };
}
