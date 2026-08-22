/* Tests for the alerting rules. Run:  deno test supabase/functions/ops/
 *
 * These are the rules that failed Ian on 20 Aug 2026, so they are worth
 * pinning down: the failure mode is silence, which no smoke test catches.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { isMachineOutage, type LastAlert, MACHINE_KEY, planAlerts } from "./alerting.ts";
import type { Health, ServiceHealth } from "./health.ts";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function svc(key: string, health: Health): ServiceHealth {
  return {
    key,
    label: key,
    kind: "daemon",
    what: "",
    health,
    reason: health === "ok" ? "up" : "no heartbeat for 1d",
    ageSeconds: 1,
    lastBeatISO: null,
    lastOkISO: null,
    detail: null,
    lastError: null,
    lastErrorISO: null,
  };
}

function last(health: string, agoMs: number, fromHealth: string | null = "ok"): LastAlert {
  return { health, fromHealth, createdAtMs: NOW - agoMs };
}

/** The mini rebooted and nobody logged in: everything silent at once. */
const WHOLE_BOX_DOWN = [
  svc("opsagent", "down"),
  svc("planespotter", "down"),
  svc("upstracker", "down"),
  svc("deckworker", "down"),
  svc("dailybriefing", "missed"),
  svc("shortsfactory", "missed"),
];

Deno.test("whole-box outage is one notification, not six", () => {
  assertEquals(isMachineOutage(WHOLE_BOX_DOWN), true);
  const planned = planAlerts(WHOLE_BOX_DOWN, new Map(), NOW);

  const notified = planned.filter((alert) => alert.notify);
  assertEquals(notified.length, 1);
  assertEquals(notified[0].service, MACHINE_KEY);
  assertEquals(notified[0].message.includes("wake it and log in"), true);

  /* The per-service rows are still recorded — they are the ops page history. */
  assertEquals(planned.length > 1, true);
  assertEquals(planned.filter((a) => a.service !== MACHINE_KEY).every((a) => !a.notify), true);
});

Deno.test("one dead daemon is not a machine outage", () => {
  const services = [
    svc("opsagent", "ok"),
    svc("planespotter", "down"),
    svc("upstracker", "ok"),
    svc("deckworker", "ok"),
  ];
  assertEquals(isMachineOutage(services), false);

  const notified = planAlerts(services, new Map(), NOW).filter((a) => a.notify);
  assertEquals(notified.length, 1);
  assertEquals(notified[0].service, "planespotter");
});

Deno.test("the watcher alone being down is not a machine outage", () => {
  const services = [
    svc("opsagent", "down"),
    svc("planespotter", "ok"),
    svc("upstracker", "ok"),
  ];
  assertEquals(isMachineOutage(services), false);
});

Deno.test("an unresolved alert repeats after an hour, not before", () => {
  const services = [svc("opsagent", "ok"), svc("planespotter", "down")];

  const tooSoon = planAlerts(
    services,
    new Map([["planespotter", last("down", 30 * 60 * 1000)]]),
    NOW,
  );
  assertEquals(tooSoon.length, 0);

  const due = planAlerts(
    services,
    new Map([["planespotter", last("down", 2 * HOUR)]]),
    NOW,
  );
  assertEquals(due.length, 1);
  assertEquals(due[0].notify, true);
  /* from === to marks it as a repeat, which is what spaces the next one out. */
  assertEquals(due[0].fromHealth, "down");
  assertEquals(due[0].toHealth, "down");
});

Deno.test("a repeat waits six hours before repeating again", () => {
  const services = [svc("opsagent", "ok"), svc("planespotter", "down")];
  const asRepeat = (agoMs: number) =>
    new Map([["planespotter", last("down", agoMs, "down")]]);

  assertEquals(planAlerts(services, asRepeat(2 * HOUR), NOW).length, 0);
  assertEquals(planAlerts(services, asRepeat(7 * HOUR), NOW).length, 1);
});

Deno.test("silence is never permanent: a month-stale service still repeats", () => {
  /* DailyBriefing sat 'missed' since 14 July and never alerted again, because
   * only transitions were reported. That is the bug this rule closes. */
  const services = [svc("opsagent", "ok"), svc("dailybriefing", "missed")];
  const planned = planAlerts(
    services,
    new Map([["dailybriefing", last("missed", 900 * HOUR, "missed")]]),
    NOW,
  );
  assertEquals(planned.length, 1);
  assertEquals(planned[0].notify, true);
});

Deno.test("recovery is news only after we said something was wrong", () => {
  const services = [svc("opsagent", "ok"), svc("planespotter", "ok")];

  assertEquals(planAlerts(services, new Map(), NOW).length, 0);

  const afterTrouble = planAlerts(
    services,
    new Map([["planespotter", last("down", HOUR)]]),
    NOW,
  );
  assertEquals(afterTrouble.length, 1);
  assertEquals(afterTrouble[0].toHealth, "ok");
  assertEquals(afterTrouble[0].message.includes("is back"), true);
});

Deno.test("a healthy service never repeats", () => {
  const services = [svc("opsagent", "ok"), svc("planespotter", "ok")];
  const planned = planAlerts(
    services,
    new Map([["planespotter", last("ok", 500 * HOUR, "ok")]]),
    NOW,
  );
  assertEquals(planned.length, 0);
});

Deno.test("coming back is one notification too", () => {
  const services = [
    svc("opsagent", "ok"),
    svc("planespotter", "ok"),
    svc("upstracker", "ok"),
    svc("deckworker", "ok"),
  ];
  const lastAlerts = new Map<string, LastAlert>([
    [MACHINE_KEY, last("down", 8 * HOUR)],
    ["planespotter", last("down", 8 * HOUR)],
    ["upstracker", last("down", 8 * HOUR)],
    ["deckworker", last("down", 8 * HOUR)],
  ]);
  const planned = planAlerts(services, lastAlerts, NOW);

  const notified = planned.filter((alert) => alert.notify);
  assertEquals(notified.length, 1);
  assertEquals(notified[0].service, MACHINE_KEY);
  assertEquals(notified[0].toHealth, "ok");
  /* The individual recoveries are still logged. */
  assertEquals(planned.length, 4);
});
