/* Unit tests for the Mini Control Room health rules.
 *
 * Run: node scripts/check_ops_health.ts   (node >= 22.6 strips the types)
 *
 * These guard the two claims the page is built on:
 *   1. A scheduled service is SUPPOSED to be silent between runs, so it must
 *      not be judged by a daemon's staleness rule. Getting this wrong shows
 *      DailyBriefing as permanently down and makes the whole page noise.
 *   2. A service that has never reported is `unknown` — never green, never red.
 *      Before OpsAgent is deployed that is every service, and inventing a
 *      verdict there would be worse than having no page at all. */

import {
  evaluate, evaluateAll, overallHealth, SERVICES,
  type HeartbeatRow, type ServiceSpec,
} from "../supabase/functions/ops/health.ts";

const NOW = Date.parse("2026-08-10T12:00:00Z");
const HOUR = 3600;

const spec = (key: string): ServiceSpec => {
  const found = SERVICES.find((service) => service.key === key);
  if (!found) throw new Error(`no such service in the catalog: ${key}`);
  return found;
};
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const beat = (service: string, seconds: number, extra: Partial<HeartbeatRow> = {}): HeartbeatRow =>
  ({ service, beat_at: ago(seconds), ...extra });

let failures = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${got}${ok ? "" : `  (wanted ${want})`}`);
}

// --- 1. scheduled services are judged on their last run, not their silence ---
check("DailyBriefing 5h after its run",
  evaluate(spec("dailybriefing"),
    beat("dailybriefing", 5 * HOUR, { last_ok_at: ago(5 * HOUR) }), NOW).health, "ok");
check("DailyBriefing silent 20h",
  evaluate(spec("dailybriefing"),
    beat("dailybriefing", 20 * HOUR, { last_ok_at: ago(20 * HOUR) }), NOW).health, "missed");

// --- 2. daemons are judged on heartbeat freshness, tolerating two misses ---
check("DeckWorker 15s ago", evaluate(spec("deckworker"), beat("deckworker", 15), NOW).health, "ok");
check("DeckWorker 60s ago (2 missed beats)",
  evaluate(spec("deckworker"), beat("deckworker", 60), NOW).health, "ok");
check("DeckWorker 100s ago (past 3 beats)",
  evaluate(spec("deckworker"), beat("deckworker", 100), NOW).health, "down");
check("DeckWorker silent 5h",
  evaluate(spec("deckworker"), beat("deckworker", 5 * HOUR), NOW).health, "down");

// --- 3. never reported is its own state ---
check("no row at all", evaluate(spec("planespotter"), undefined, NOW).health, "unknown");
check("overall before OpsAgent exists", overallHealth(evaluateAll([], NOW)), "unknown");

// --- 4. up-but-useless, which a heartbeat alone cannot express ---
check("PlaneSpotter up, feed dead",
  evaluate(spec("planespotter"),
    beat("planespotter", 20, { status: "error", last_error: "feed empty 3d" }), NOW).health, "down");
check("PlaneSpotter up, warning",
  evaluate(spec("planespotter"),
    beat("planespotter", 20, { status: "warn", last_error: "token expires Tue" }), NOW).health, "warn");

// --- 5. the summary reports the worst thing present ---
check("overall with one dead daemon",
  overallHealth(evaluateAll([beat("deckworker", 9999)], NOW)), "down");

console.log(failures ? `\n${failures} FAILED` : `\nall ${11 - failures} passed`);
process.exit(failures ? 1 : 0);
