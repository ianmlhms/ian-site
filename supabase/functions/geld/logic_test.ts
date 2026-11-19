import { assertEquals } from "jsr:@std/assert@1";
import {
  changeBetween, dedupeEvents, defaultCat, eventToRow, mergeRow, planAlerts, spendingByCat, spendOf,
  todayDailyRow, topMerchants, type SpendRow,
} from "./logic.ts";
import type { Ev } from "./validate.ts";

const ev = (over: Partial<Ev> = {}): Ev => ({
  id: "e1", at: "2026-10-12T08:21:04.248Z", amount: -4.5, currency: "EUR", type: "card",
  merchant: "Test Cafe", isin: null, shares: null, status: "EXECUTED", event_type: "CARD_TRANSACTION", ...over,
});
const NOW = "2026-11-19T10:00:00.000Z";

Deno.test("default categories follow the type", () => {
  assertEquals(defaultCat("buy", "ETF"), "investment");
  assertEquals(defaultCat("savings_plan", "ETF"), "investment");
  assertEquals(defaultCat("interest", ""), "dividend");
  assertEquals(defaultCat("tax", ""), "fees");
  assertEquals(defaultCat("atm", "Bank"), "cash");
  assertEquals(defaultCat("card", "Test Cafe"), null);
  assertEquals(defaultCat("transfer_in", "Max Muster"), "income");
  assertEquals(defaultCat("transfer_in", "Raoul Example"), "transfer");
  assertEquals(defaultCat("transfer_in", "Einzahlung"), "transfer");
  assertEquals(defaultCat("transfer_out", "Max Muster"), null);
});

Deno.test("event becomes a positive row with direction and own-transfer flag", () => {
  const out = eventToRow(ev(), new Map(), NOW);
  assertEquals([out.amount, out.kind, out.account, out.is_transfer, out.cat], [4.5, "out", "Trade Republic", false, null]);
  const refund = eventToRow(ev({ type: "card_refund", amount: 4.5 }), new Map(), NOW);
  assertEquals(refund.kind, "in");
  const own = eventToRow(ev({ type: "transfer_in", amount: 50, merchant: "Raoul Example" }), new Map(), NOW);
  assertEquals([own.is_transfer, own.cat], [true, "transfer"]);
});

Deno.test("merchant rules apply to card rows, case and space insensitive", () => {
  const rules = new Map([["test cafe", "food"]]);
  assertEquals(eventToRow(ev({ merchant: "  Test CAFE " }), rules, NOW).cat, "food");
});

Deno.test("merge never overwrites a locked or known category", () => {
  const fresh = eventToRow(ev(), new Map(), NOW);
  const locked = mergeRow({ ...fresh, cat: "food" }, { id: "e1", cat: "leisure", cat_locked: true, is_transfer: false });
  assertEquals([locked.cat, locked.cat_locked], ["leisure", true]);
  assertEquals(mergeRow(fresh, { id: "e1", cat: "groceries", cat_locked: false, is_transfer: false }).cat, "groceries");
  assertEquals(mergeRow({ ...fresh, cat: "food" }, { id: "e1", cat: "groceries", cat_locked: false, is_transfer: false }).cat, "food");
  assertEquals(mergeRow(fresh, undefined), fresh);
});

Deno.test("duplicate ids in one payload collapse to the last", () => {
  assertEquals(dedupeEvents([ev({ amount: -1 }), ev({ amount: -2 }), ev({ id: "e2" })]).map((e) => e.amount), [-2, -4.5]);
});

const row = (over: Partial<SpendRow>): SpendRow => ({
  at: "2026-11-02T10:00:00Z", amount: 10, kind: "out", type: "card", cat: "food", is_transfer: false, merchant: "A", ...over,
});

Deno.test("spending excludes investment/transfer, nets card refunds, null cat is other", () => {
  const rows = [
    row({ amount: 10 }), row({ amount: 5, cat: null }), row({ amount: 100, cat: "investment", type: "buy" }),
    row({ amount: 40, is_transfer: true }), row({ amount: 3, kind: "in", type: "card_refund" }),
    row({ amount: 200, kind: "in", type: "transfer_in", cat: "income" }),
  ];
  assertEquals(spendingByCat(rows), { total: 12, byCat: { food: 7, other: 5 } });
});

Deno.test("top merchants group by merchant and skip net-negative", () => {
  const top = topMerchants([row({ amount: 4, merchant: "Cafe" }), row({ amount: 6, merchant: "cafe" }), row({ amount: 9, merchant: "Shop" }),
    row({ amount: 5, merchant: "Gone" }), row({ amount: 5, kind: "in", type: "card_refund", merchant: "Gone" })], 2);
  assertEquals(top.map((t) => [t.merchant, t.amount]), [["Cafe", 10], ["Shop", 9]]);
});

Deno.test("alerts: highest unsent level only, lower levels marked, nothing repeats", () => {
  const budgets = [{ cat: "_total", monthly_limit: 200 }, { cat: "food", monthly_limit: 50 }];
  const first = planAlerts(165, { food: 20 }, budgets, new Set());
  assertEquals(first.alerts, [{ cat: "_total", level: 80, spent: 165, limit: 200 }]);
  const jump = planAlerts(210, { food: 60 }, budgets, new Set());
  assertEquals(jump.alerts.map((a) => [a.cat, a.level]), [["_total", 100], ["food", 100]]);
  assertEquals(jump.toMark.length, 4);
  const sent = new Set(["_total|80", "_total|100", "food|80", "food|100"]);
  assertEquals(planAlerts(210, { food: 60 }, budgets, sent).alerts, []);
  assertEquals(planAlerts(500, {}, [{ cat: "_total", monthly_limit: 0 }], new Set()).alerts, []);
});

Deno.test("today's daily row sums positions in Luxembourg time", () => {
  const r = todayDailyRow([
    { isin: "A", name: "", qty: 1, avg_cost: 1, buy_cost: 10, value: 12.5, price: 1 },
    { isin: "B", name: "", qty: 1, avg_cost: 1, buy_cost: 5, value: null, price: 1 },
  ], 7, Date.parse("2026-11-19T23:30:00Z"));
  assertEquals(r, { day: "2026-11-20", depot_value: 12.5, invested: 15, cash: 7 });
});

Deno.test("change between two values", () => {
  assertEquals(changeBetween(110, 100), { eur: 10, pct: 10 });
  assertEquals(changeBetween(5, 0), { eur: 5, pct: null });
  assertEquals(changeBetween(null, 1), null);
});

Deno.test("money back for a purchase lowers that category; pocket money does not", () => {
  const base = { at: "2026-04-20T12:00:00Z", type: "other", is_transfer: false, merchant: "x" };
  assertEquals(spendOf({ ...base, amount: 322, kind: "out", cat: "health" }), { cat: "health", value: 322 });
  assertEquals(spendOf({ ...base, amount: 322, kind: "in", cat: "health" }), { cat: "health", value: -322 });
  assertEquals(spendOf({ ...base, amount: 125, kind: "in", cat: "income" }), null);
  assertEquals(spendOf({ ...base, amount: 5, kind: "in", cat: null }), null);
});

Deno.test("canteen paid by the parents is neither spending nor a refund", () => {
  const base = { at: "2026-10-26T12:00:00Z", type: "other", is_transfer: false, merchant: "Restopolis" };
  assertEquals(spendOf({ ...base, amount: 100, kind: "out", cat: "parents" }), null);
  assertEquals(spendOf({ ...base, amount: 100, kind: "in", cat: "parents" }), null);
});

Deno.test("Osteria and canteen card payments are paid by the parents", () => {
  const ev = (merchant: string) => ({ id: "e", at: "2026-06-24T18:00:00Z", amount: -84.8, currency: "EUR", type: "card", merchant, isin: null, shares: null, status: "EXECUTED", event_type: "CARD_TRANSACTION" }) as Ev;
  assertEquals(eventToRow(ev("L'Osteria"), new Map(), "2026-06-24T18:00:00Z").cat, "parents");
  assertEquals(eventToRow(ev("Restopolis"), new Map(), "2026-06-24T18:00:00Z").cat, "parents");
});
