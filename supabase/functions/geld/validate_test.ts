import { assertEquals } from "jsr:@std/assert@1";
import { MAX_EVENTS, parseReportDate, parseStatus, parseSync } from "./validate.ts";

const good = { id: "abc", at: "2026-10-12T08:21:04.248+0000", amount: -3.2, currency: "EUR", type: "card",
  merchant: "Cafe\nX", isin: null, shares: null, status: "EXECUTED", event_type: "CARD_TRANSACTION" };

Deno.test("a well-formed sync is accepted and cleaned", () => {
  const r = parseSync({ events: [good], positions: null, cash: 12.5, daily: null });
  if ("error" in r) throw new Error(r.error);
  assertEquals(r.value.events[0].merchant, "Cafe X");
  assertEquals(r.value.events[0].at, "2026-10-12T08:21:04.248Z");
  assertEquals([r.value.cash, r.value.positions, r.value.daily], [12.5, null, null]);
});

Deno.test("bad events are rejected with a field path", () => {
  const bad = (over: Record<string, unknown>) => "error" in parseSync({ events: [{ ...good, ...over }] });
  assertEquals(bad({ id: "" }), true);
  assertEquals(bad({ id: "legacy:1" }), true);
  assertEquals(bad({ at: "nope" }), true);
  assertEquals(bad({ amount: "3" }), true);
  assertEquals(bad({ amount: NaN }), true);
  assertEquals(bad({ type: "bogus" }), true);
  assertEquals(bad({ isin: "short" }), true);
  assertEquals(bad({ shares: "x" }), true);
  assertEquals(bad({}), false);
});

Deno.test("limits and shapes", () => {
  assertEquals("error" in parseSync({ events: new Array(MAX_EVENTS + 1).fill(good) }), true);
  assertEquals("error" in parseSync({ events: "x" }), true);
  assertEquals("error" in parseSync({ events: [], positions: [{ isin: "bad" }] }), true);
  assertEquals("error" in parseSync({ events: [], daily: [{ day: "2026-13-01" }] }), true);
  assertEquals("error" in parseSync({ events: [], cash: "1" }), true);
  assertEquals("error" in parseSync({ events: [], positions: [{ isin: "IE00B4L5Y983", name: "ETF", value: 5 }] }), false);
});

Deno.test("status and report inputs", () => {
  assertEquals("error" in parseStatus({ ok: "no" }), true);
  assertEquals(parseStatus({ ok: false, error: "x\ny", needs_login: true }), { value: { ok: false, error: "x y", needsLogin: true } });
  assertEquals("error" in parseReportDate({ date: "2026-02-31" }), true);
  assertEquals(parseReportDate({ date: "2026-11-18" }), { value: "2026-11-18" });
});
