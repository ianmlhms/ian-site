/* What is worth telling Ian about, kept apart from transport and from the
 * health arithmetic so each can be read on its own.
 *
 * Three rules live here, all learned from the 20 Aug 2026 outage, when the
 * mini rebooted, nobody logged in, and every service died at once:
 *
 *   1. A whole-machine outage is ONE event, not six. Six pushes that each name
 *      a different daemon bury the only sentence that matters ("log in").
 *   2. An unresolved alert must repeat. Alerting only on transitions means a
 *      single missed notification equals permanent silence — which is exactly
 *      what happened, and why the stack stayed dead for 41 hours.
 *   3. Recording and notifying are different things. Everything is logged;
 *      only what a phone should buzz for is notified.
 */
import type { Health, ServiceHealth } from "./health.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Health states worth waking a phone for. `unknown` means "never reported",
 * which is a deployment fact, not an incident. */
export const ALERTABLE = new Set<Health>(["down", "missed", "warn"]);

/* An unresolved problem repeats: soon once, then slowly, so a missed
 * notification cannot turn into permanent silence without becoming a nag. */
const FIRST_REPEAT_MS = 1 * HOUR_MS;
const LATER_REPEAT_MS = 6 * HOUR_MS;

/* The machine-level pseudo-service. Not in SERVICES: it is not something
 * OpsAgent reports on, it is the conclusion drawn when OpsAgent itself is
 * silent. `service_alerts.service` is free text and ops.js renders only the
 * message, so this key needs no schema change. */
export const MACHINE_KEY = "mini";
const MACHINE_LABEL = "Mac mini";

/* OpsAgent is the watcher. If the watcher is silent AND most of what it
 * watches is silent too, the machine is down — not three daemons at once. */
const MACHINE_WATCHER = "opsagent";
const MACHINE_MIN_SILENT = 3;

export type LastAlert = {
  health: string;
  fromHealth: string | null;
  createdAtMs: number;
};

export type PendingAlert = {
  service: string;
  fromHealth: string | null;
  toHealth: Health;
  message: string;
  /** false = log it, but do not buzz a phone for it. */
  notify: boolean;
};

/** A repeat is a row whose health did not change; a transition is one that did. */
function wasRepeat(last: LastAlert): boolean {
  return last.fromHealth === last.health;
}

/** How long an unresolved state may sit before it is worth saying again. */
function repeatDueAfterMs(last: LastAlert): number {
  return wasRepeat(last) ? LATER_REPEAT_MS : FIRST_REPEAT_MS;
}

function isSilent(service: ServiceHealth): boolean {
  return service.health === "down" || service.health === "missed";
}

/** The whole box is gone, rather than some of its services. */
export function isMachineOutage(services: ServiceHealth[]): boolean {
  const watcher = services.find((service) => service.key === MACHINE_WATCHER);
  if (!watcher || watcher.health !== "down") return false;
  return services.filter(isSilent).length >= MACHINE_MIN_SILENT;
}

function machineMessage(services: ServiceHealth[]): string {
  const silent = services.filter(isSilent).length;
  /* The actionable half. Every service on the mini is a LaunchAgent in
   * gui/$UID, so a reboot nobody logs in after kills all of them while
   * tailscaled — a system LaunchDaemon — keeps the mini looking "Online". */
  return `${MACHINE_LABEL} is down — ${silent} services silent. ` +
    "It most likely rebooted and nobody logged in: wake it and log in.";
}

/** Decide, for one key, whether its current state is worth a row right now. */
function considerState(
  key: string,
  health: Health,
  message: string,
  recoveredMessage: string,
  last: LastAlert | undefined,
  nowMs: number,
): PendingAlert | null {
  const alertable = ALERTABLE.has(health);
  const before = last?.health;

  if (before === health) {
    /* Unchanged. Worth repeating only while it is still a problem. */
    if (!alertable || !last) return null;
    if (nowMs - last.createdAtMs < repeatDueAfterMs(last)) return null;
    return { service: key, fromHealth: health, toHealth: health, message, notify: true };
  }

  /* First sighting of something healthy is not news. */
  if (before === undefined && !alertable) return null;
  /* Recovery is news only if we had said something was wrong. */
  if (!alertable && before && !ALERTABLE.has(before as Health)) return null;

  return {
    service: key,
    fromHealth: before ?? null,
    toHealth: health,
    message: alertable ? message : recoveredMessage,
    notify: true,
  };
}

/**
 * Pure: current health + what we last said → what to record and what to send.
 *
 * During a machine outage the per-service rows are still written (they are the
 * history the ops page shows) but they are not notified, so the phone gets the
 * one sentence that can be acted on.
 */
export function planAlerts(
  services: ServiceHealth[],
  lastAlerts: Map<string, LastAlert>,
  nowMs: number,
): PendingAlert[] {
  const planned: PendingAlert[] = [];
  const outage = isMachineOutage(services);
  const lastMachine = lastAlerts.get(MACHINE_KEY);
  const machineWasDown = lastMachine !== undefined &&
    ALERTABLE.has(lastMachine.health as Health);

  const machine = considerState(
    MACHINE_KEY,
    outage ? "down" : "ok",
    machineMessage(services),
    `${MACHINE_LABEL} is back — services are reporting again`,
    lastMachine,
    nowMs,
  );
  if (machine) planned.push(machine);

  /* Silence the per-service chorus both while the box is down and on the tick
   * it comes back, so one event never costs seven notifications. */
  const notifyPerService = !outage && !machineWasDown;

  for (const service of services) {
    const item = considerState(
      service.key,
      service.health,
      `${service.label}: ${service.reason}`,
      `${service.label} is back — ${service.reason}`,
      lastAlerts.get(service.key),
      nowMs,
    );
    if (item) planned.push({ ...item, notify: item.notify && notifyPerService });
  }

  return planned;
}
