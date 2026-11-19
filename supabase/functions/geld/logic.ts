/* Pure business rules of geld: how an event becomes a row, which category it
 * gets by default, what counts as spending, and which budget alerts are due.
 * No I/O here; index.ts does the database and the model calls. */
import { lbDay, lbMonth } from "./time.ts";
import type { DailyRow, Ev, Pos, TxType } from "./validate.ts";

export const TR_ACCOUNT = "Trade Republic";
export const TOTAL_KEY = "_total";
export const ALERT_LEVELS = [80, 100] as const;
/* Not spending: money that stays Ian's own or goes into the depot. */
const NON_SPENDING_CATS = new Set(["investment", "transfer"]);
/* A transfer is "own account" when the counterparty is one of the family
 * members who share this Trade Republic account. */
// "Einzahlung" = a card/Apple Pay top-up from one of our own accounts.
const OWN_COUNTERPARTY = /\b(raoul|ian|einzahlung)\b/i;

const DEFAULT_CAT_BY_TYPE: Partial<Record<TxType, string>> = {
  buy: "investment", sell: "investment", savings_plan: "investment",
  dividend: "dividend", interest: "dividend", saveback: "dividend",
  fee: "fees", tax: "fees", atm: "cash",
};

export type TxRow = {
  id: string; at: string; amount: number; kind: "in" | "out"; account: string;
  source: "tr"; type: string; merchant: string; isin: string | null; shares: number | null;
  cat: string | null; cat_locked: boolean; is_transfer: boolean; status: string;
  event_type: string | null; updated_at: string;
};
export type ExistingTx = { id: string; cat: string | null; cat_locked: boolean; is_transfer: boolean };

export const merchantKey = (merchant: string) => merchant.trim().toLowerCase();

export function isOwnTransfer(type: string, merchant: string): boolean {
  return (type === "transfer_in" || type === "transfer_out") && OWN_COUNTERPARTY.test(merchant);
}

/** Category decided by the type alone (or by who the counterparty is), else null. */
export function defaultCat(type: string, merchant: string): string | null {
  const byType = DEFAULT_CAT_BY_TYPE[type as TxType];
  if (byType) return byType;
  if (type === "transfer_in") return isOwnTransfer(type, merchant) ? "transfer" : "income";
  if (type === "transfer_out") return isOwnTransfer(type, merchant) ? "transfer" : null;
  return null;
}

/** The row an event becomes, before any existing-row merging. */
export function eventToRow(ev: Ev, rules: Map<string, string>, nowISO: string): TxRow {
  const isTransfer = isOwnTransfer(ev.type, ev.merchant);
  const cat = defaultCat(ev.type, ev.merchant) ?? rules.get(merchantKey(ev.merchant)) ?? null;
  return {
    id: ev.id, at: ev.at, amount: Math.abs(ev.amount), kind: ev.amount >= 0 ? "in" : "out",
    account: TR_ACCOUNT, source: "tr", type: ev.type, merchant: ev.merchant, isin: ev.isin,
    shares: ev.shares, cat, cat_locked: false, is_transfer: isTransfer, status: ev.status,
    event_type: ev.event_type, updated_at: nowISO,
  };
}

/** Merge a fresh row onto what is already stored: Ian's hand-set category is
 * never touched, and a known category is never replaced by nothing. */
export function mergeRow(fresh: TxRow, existing: ExistingTx | undefined): TxRow {
  if (!existing) return fresh;
  if (existing.cat_locked) {
    return { ...fresh, cat: existing.cat, cat_locked: true, is_transfer: existing.is_transfer };
  }
  return { ...fresh, cat: fresh.cat ?? existing.cat };
}

/** Last occurrence of an id wins; order of first appearance is kept. */
export function dedupeEvents(events: Ev[]): Ev[] {
  const byId = new Map<string, Ev>();
  for (const ev of events) byId.set(ev.id, ev);
  return [...byId.values()];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---- spending ---------------------------------------------------------

export type SpendRow = {
  at: string; amount: number; kind: string; type: string | null; cat: string | null;
  is_transfer: boolean; merchant: string | null;
};

/** Signed spending of one row: + for spending, - for a card refund, 0 if the
 * row is not spending at all. Uncategorised rows count as "other". */
export function spendOf(row: SpendRow): { cat: string; value: number } | null {
  if (row.is_transfer) return null;
  const cat = row.cat ?? "other";
  if (NON_SPENDING_CATS.has(cat)) return null;
  if (row.kind === "out") return { cat, value: Number(row.amount) };
  if (row.kind === "in" && row.type === "card_refund") return { cat, value: -Number(row.amount) };
  return null;
}

export function spendingByCat(rows: SpendRow[]): { total: number; byCat: Record<string, number> } {
  const byCat: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const s = spendOf(row);
    if (!s) continue;
    byCat[s.cat] = round2((byCat[s.cat] ?? 0) + s.value);
    total = round2(total + s.value);
  }
  return { total, byCat };
}

export function topMerchants(rows: SpendRow[], limit: number) {
  const byMerchant = new Map<string, { merchant: string; amount: number; cat: string }>();
  for (const row of rows) {
    const s = spendOf(row);
    if (!s) continue;
    const name = (row.merchant ?? "").trim() || "—";
    const key = merchantKey(name);
    const prev = byMerchant.get(key);
    byMerchant.set(key, { merchant: prev?.merchant ?? name, cat: prev?.cat ?? s.cat, amount: round2((prev?.amount ?? 0) + s.value) });
  }
  return [...byMerchant.values()].filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- budget alerts ----------------------------------------------------

export type Alert = { cat: string; level: number; spent: number; limit: number };
export type Budget = { cat: string; monthly_limit: number };

/** Alerts due now. Only the highest crossed level not yet sent is reported
 * (a jump straight past 100 % says 100 %, not 80 % and 100 %); every crossed
 * level up to it is marked as sent so the lower one never fires later. */
export function planAlerts(
  total: number, byCat: Record<string, number>, budgets: Budget[], sent: Set<string>,
): { alerts: Alert[]; toMark: { cat: string; level: number }[] } {
  const alerts: Alert[] = [];
  const toMark: { cat: string; level: number }[] = [];
  for (const budget of budgets) {
    const limit = Number(budget.monthly_limit);
    if (!(limit > 0)) continue;
    const spent = round2(budget.cat === TOTAL_KEY ? total : byCat[budget.cat] ?? 0);
    const crossed = ALERT_LEVELS.filter((level) => spent >= (limit * level) / 100);
    const unsent = crossed.filter((level) => !sent.has(`${budget.cat}|${level}`));
    if (!unsent.length) continue;
    const top = Math.max(...unsent);
    alerts.push({ cat: budget.cat, level: top, spent, limit });
    for (const level of unsent) toMark.push({ cat: budget.cat, level });
  }
  return { alerts, toMark };
}

// ---- daily value row --------------------------------------------------

/** Today's geld_daily row from the positions and cash of a sync. */
export function todayDailyRow(positions: Pos[], cash: number | null, nowMs: number): DailyRow {
  const sum = (pick: (p: Pos) => number | null) => round2(positions.reduce((acc, p) => acc + (pick(p) ?? 0), 0));
  return { day: lbDay(nowMs), depot_value: sum((p) => p.value), invested: sum((p) => p.buy_cost), cash };
}

export function changeBetween(latest: number | null, previous: number | null) {
  if (latest === null || previous === null) return null;
  const eur = round2(latest - previous);
  return { eur, pct: previous === 0 ? null : round2((eur / previous) * 100) };
}

export { lbDay, lbMonth };
