/* Tests for the alerting rules. Run:  deno test supabase/functions/ops/
 *
 * These are the rules that failed Ian on 20 Aug 2026, so they are worth
 * pinning down: the failure mode is silence, which no smoke test catches.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { type LastAlert, planAlerts } from "./alerting.ts";
import type { Health, ServiceHealth } from "./health.ts";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function svc(key: string, health: Health): ServiceHealth {
  return {
    key,
    label: key,
    what: "",
    health,
    reason: health === "ok" ? "up" : "no heartbeat for 1d",
    ageSeconds: 1,
    lastBeatISO: null,
    detailText: null,
    lastError: null,
  };
}

function last(health: string, agoMs: number, fromHealth: string | null = "ok"): LastAlert {
  return { health, fromHealth, createdAtMs: NOW - agoMs };
}

Deno.test("one dead machine is one notification, the other stays quiet", () => {
  const planned = planAlerts([svc("brix", "down"), svc("mini", "ok")], new Map(), NOW);
  assertEquals(planned.length, 1);
  assertEquals(planned[0].service, "brix");
  assertEquals(planned[0].notify, true);
  assertEquals(planned[0].message.includes("brix"), true);
});

Deno.test("both machines down (power cut) is two notifications, one each", () => {
  const planned = planAlerts([svc("brix", "down"), svc("mini", "down")], new Map(), NOW);
  assertEquals(planned.map((alert) => alert.service).sort(), ["brix", "mini"]);
});

Deno.test("an unresolved alert repeats after an hour, not before", () => {
  const services = [svc("brix", "down"), svc("mini", "ok")];

  const tooSoon = planAlerts(
    services,
    new Map([["brix", last("down", 30 * 60 * 1000)]]),
    NOW,
  );
  assertEquals(tooSoon.length, 0);

  const due = planAlerts(
    services,
    new Map([["brix", last("down", 2 * HOUR)]]),
    NOW,
  );
  assertEquals(due.length, 1);
  assertEquals(due[0].notify, true);
  /* from === to marks it as a repeat, which is what spaces the next one out. */
  assertEquals(due[0].fromHealth, "down");
  assertEquals(due[0].toHealth, "down");
});

Deno.test("a repeat waits six hours before repeating again", () => {
  const services = [svc("brix", "down")];
  const asRepeat = (agoMs: number) => new Map([["brix", last("down", agoMs, "down")]]);

  assertEquals(planAlerts(services, asRepeat(2 * HOUR), NOW).length, 0);
  assertEquals(planAlerts(services, asRepeat(7 * HOUR), NOW).length, 1);
});

Deno.test("silence is never permanent: a month-stale machine still repeats", () => {
  const planned = planAlerts(
    [svc("mini", "down")],
    new Map([["mini", last("down", 900 * HOUR, "down")]]),
    NOW,
  );
  assertEquals(planned.length, 1);
  assertEquals(planned[0].notify, true);
});

Deno.test("recovery is news only after we said something was wrong", () => {
  const services = [svc("brix", "ok"), svc("mini", "ok")];

  assertEquals(planAlerts(services, new Map(), NOW).length, 0);

  const afterTrouble = planAlerts(services, new Map([["brix", last("down", HOUR)]]), NOW);
  assertEquals(afterTrouble.length, 1);
  assertEquals(afterTrouble[0].toHealth, "ok");
  assertEquals(afterTrouble[0].message.includes("is back"), true);
});

Deno.test("a healthy machine never repeats", () => {
  const planned = planAlerts(
    [svc("brix", "ok")],
    new Map([["brix", last("ok", 500 * HOUR, "ok")]]),
    NOW,
  );
  assertEquals(planned.length, 0);
});

Deno.test("'no report' is never news, even after an old alert under the same key", () => {
  /* The old catalog logged a 'down' row for key "mini" (the whole-machine
   * pseudo-service). Now "mini" is a real machine that has not reported yet:
   * that must not read as a recovery. */
  const planned = planAlerts(
    [svc("brix", "unknown"), svc("mini", "unknown")],
    new Map([["mini", last("down", 3 * HOUR, "down")]]),
    NOW,
  );
  assertEquals(planned.length, 0);
});
