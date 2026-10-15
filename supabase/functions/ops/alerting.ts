/* What is worth telling Ian about, kept apart from transport and from the
 * health arithmetic so each can be read on its own.
 *
 * Two rules live here, both learned from the 20 Aug 2026 outage, when the
 * mini rebooted, nobody logged in, and everything died at once:
 *
 *   1. An unresolved alert must repeat. Alerting only on transitions means a
 *      single missed notification equals permanent silence — which is exactly
 *      what happened, and why the stack stayed dead for 41 hours.
 *   2. Recording and notifying are different things. Everything is logged;
 *      only what a phone should buzz for is notified.
 *
 * (The old "whole box is down" collapsing rule is gone: a machine is now the
 * unit being watched, so one dead machine is already one alert.)
 */
import type { Health, ServiceHealth } from "./health.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Health states worth waking a phone for. `unknown` means "never reported",
 * which is a deployment fact, not an incident. */
export const ALERTABLE = new Set<Health>(["down", "warn"]);

/* An unresolved problem repeats: soon once, then slowly, so a missed
 * notification cannot turn into permanent silence without becoming a nag. */
const FIRST_REPEAT_MS = 1 * HOUR_MS;
const LATER_REPEAT_MS = 6 * HOUR_MS;

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

/** Decide, for one key, whether its current state is worth a row right now. */
function considerState(
  key: string,
  health: Health,
  message: string,
  recoveredMessage: string,
  last: LastAlert | undefined,
  nowMs: number,
): PendingAlert | null {
  /* "No report" is a deployment fact, never news in either direction — in
   * particular it must not read as a recovery from whatever was logged before
   * this machine had a heartbeat row. */
  if (health === "unknown") return null;

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
 */
export function planAlerts(
  services: ServiceHealth[],
  lastAlerts: Map<string, LastAlert>,
  nowMs: number,
): PendingAlert[] {
  const planned: PendingAlert[] = [];
  for (const service of services) {
    const item = considerState(
      service.key,
      service.health,
      `${service.label}: ${service.reason}`,
      `${service.label} is back — ${service.reason}`,
      lastAlerts.get(service.key),
      nowMs,
    );
    if (item) planned.push(item);
  }
  return planned;
}
