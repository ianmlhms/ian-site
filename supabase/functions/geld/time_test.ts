import { assertEquals } from "jsr:@std/assert@1";
import { dayRange, isValidDay, lbDay, lbMidnight, lbMonth, monthRange } from "./time.ts";

const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("Luxembourg day and month, winter and summer", () => {
  assertEquals(lbDay(Date.parse("2026-11-19T23:30:00Z")), "2026-11-20");
  assertEquals(lbDay(Date.parse("2026-07-19T21:59:00Z")), "2026-07-19");
  assertEquals(lbDay(Date.parse("2026-07-19T22:00:00Z")), "2026-07-20");
  assertEquals(lbMonth(Date.parse("2026-10-31T23:30:00Z")), "2026-11");
});

Deno.test("midnight is CET in winter, CEST in summer, across both DST changes", () => {
  assertEquals(iso(lbMidnight("2026-01-15")), "2026-01-14T23:00:00.000Z");
  assertEquals(iso(lbMidnight("2026-07-15")), "2026-07-14T22:00:00.000Z");
  assertEquals(iso(lbMidnight("2026-03-29")), "2026-03-28T23:00:00.000Z");
  assertEquals(iso(lbMidnight("2026-03-30")), "2026-03-29T22:00:00.000Z");
  assertEquals(iso(lbMidnight("2026-10-25")), "2026-10-24T22:00:00.000Z");
  assertEquals(iso(lbMidnight("2026-10-26")), "2026-10-25T23:00:00.000Z");
});

Deno.test("day and month ranges are half open and DST-aware", () => {
  const [s, e] = dayRange("2026-10-25");
  assertEquals((e - s) / 3_600_000, 25);
  const [ms, me] = monthRange("2026-12");
  assertEquals([iso(ms), iso(me)], ["2026-11-30T23:00:00.000Z", "2026-12-31T23:00:00.000Z"]);
});

Deno.test("calendar validation", () => {
  assertEquals([isValidDay("2026-02-28"), isValidDay("2026-02-30"), isValidDay("26-1-1"), isValidDay(5)], [true, false, false, false]);
});
