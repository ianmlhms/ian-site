import { assertEquals } from "jsr:@std/assert@1";
import { describeAge, evaluate, evaluateAll, overallHealth, SERVICES } from "./health.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const [brix] = SERVICES;

Deno.test("catalog is exactly brix and mini, 5-minute daemons", () => {
  assertEquals(SERVICES.map((s) => s.key), ["brix", "mini"]);
  assertEquals(SERVICES.map((s) => s.expectSeconds), [300, 300]);
});

Deno.test("no row is 'unknown', never 'down'", () => {
  assertEquals(evaluate(brix, undefined, NOW).health, "unknown");
});

Deno.test("up until three beats are missed, then down", () => {
  const row = (age: number) => ({ service: "brix", beat_at: ago(age) });
  assertEquals(evaluate(brix, row(60), NOW).health, "ok");
  assertEquals(evaluate(brix, row(900), NOW).health, "ok");
  const down = evaluate(brix, row(901), NOW);
  assertEquals(down.health, "down");
  assertEquals(down.reason, "no heartbeat for 15m");
});

Deno.test("detail text is surfaced from { text }", () => {
  const result = evaluate(
    brix,
    { service: "brix", beat_at: ago(10), detail: { text: "brix bots 12/12 running" } },
    NOW,
  );
  assertEquals(result.detailText, "brix bots 12/12 running");
});

Deno.test("evaluateAll ignores rows of retired services", () => {
  const all = evaluateAll(
    [{ service: "opsagent", beat_at: ago(5) }, { service: "mini", beat_at: ago(5) }],
    NOW,
  );
  assertEquals(all.map((s) => s.health), ["unknown", "ok"]);
  assertEquals(overallHealth(all), "unknown");
});

Deno.test("describeAge", () => {
  assertEquals(describeAge(59), "59s");
  assertEquals(describeAge(3660), "1h 1m");
});
