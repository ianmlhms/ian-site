// Supabase Edge Function: ops
// Mini Control Room — health of the services on Ian's Mac mini, the restart
// queue, and the cron check that pushes when one of them changes state.
//
// Deployed with --no-verify-jwt because the cron path authenticates with a
// shared secret; every other action is gated by ownerFromRequest below.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, cleanString, json, ownerFromRequest } from "../_shared/studio.ts";
import { evaluateAll, overallHealth, SERVICES } from "./health.ts";
import { type LastAlert, MACHINE_KEY, type PendingAlert, planAlerts } from "./alerting.ts";
import { sendTelegram, telegramConfigured } from "./telegram.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const OPS_CRON_SECRET = Deno.env.get("OPS_CRON_SECRET") ?? "";
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";
const SERVICE_KEYS = new Set(SERVICES.map((service) => service.key));
const ACTIONS = new Set(["restart", "start", "stop"]);
const MAX_ALERTS = 20;
/* How far back to look for "what did we last say about this key". Repeats add
 * rows, so this must comfortably outlast a long outage: if a key's latest row
 * fell outside the window it would read as never-alerted and re-notify. */
const ALERT_LOOKBACK_ROWS = 500;

const admin = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function readHeartbeats() {
  const { data, error } = await admin
    .from("service_heartbeats")
    .select("service, beat_at, last_ok_at, status, detail, last_error, last_error_at, note");
  if (error) throw new Error(`heartbeat read failed: ${error.message}`);
  return data ?? [];
}

async function handleStatus() {
  const services = evaluateAll(await readHeartbeats(), Date.now());
  const { data: alerts } = await admin
    .from("service_alerts")
    .select("service, from_health, to_health, message, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_ALERTS);
  const { data: commands } = await admin
    .from("service_commands")
    .select("id, service, action, status, result, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return json({
    services,
    overall: overallHealth(services),
    alerts: alerts ?? [],
    commands: commands ?? [],
    checkedAt: new Date().toISOString(),
  });
}

async function handleCommand(payload: any, userId: string) {
  const service = cleanString(payload?.service, 40);
  /* `verb`, not `action` — `action` already names the RPC being dispatched
   * ("command"), so reading the launchd verb from the same key would always
   * read back "command" and reject every restart. */
  const action = cleanString(payload?.verb, 20);
  /* Allow-listed both sides. OpsAgent maps the key to a launchd label from its
   * own table, so nothing from this request ever reaches a shell. */
  if (!SERVICE_KEYS.has(service)) return json({ error: "Unknown service." }, 400);
  if (!ACTIONS.has(action)) return json({ error: "Unknown action." }, 400);

  const { data, error } = await admin
    .from("service_commands")
    .insert({ service, action, requested_by: userId })
    .select("id, service, action, status, created_at")
    .single();
  if (error) return json({ error: `Could not queue: ${error.message}` }, 500);
  return json({ command: data });
}

async function handleCommandStatus(payload: any) {
  const id = cleanString(payload?.id, 64);
  if (!id) return json({ error: "Missing command id." }, 400);
  const { data, error } = await admin
    .from("service_commands")
    .select("id, service, action, status, result, error, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "No such command." }, 404);
  return json({ command: data });
}

/** The most recent thing we said about each key: what state, and when.
 * `from_health` comes along because a row whose health did not change is a
 * repeat, and repeats are spaced further apart than first reports. */
async function lastAlertPerService(): Promise<Map<string, LastAlert>> {
  const { data } = await admin
    .from("service_alerts")
    .select("service, from_health, to_health, created_at")
    .order("created_at", { ascending: false })
    .limit(ALERT_LOOKBACK_ROWS);
  const latest = new Map<string, LastAlert>();
  for (const row of data ?? []) {
    if (latest.has(row.service)) continue;
    latest.set(row.service, {
      health: row.to_health,
      fromHealth: row.from_health,
      createdAtMs: Date.parse(row.created_at),
    });
  }
  return latest;
}

async function pushAlert(record: unknown) {
  if (!NOTIFY_SECRET) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-notify-secret": NOTIFY_SECRET },
      body: JSON.stringify({ table: "service_alerts", record }),
    });
    return response.ok;
  } catch (error) {
    console.error("ops: notify call failed", error);
    return false;
  }
}

/* Two independent channels on purpose. Web push depends on a browser that is
 * awake and subscribed; Telegram reaches a phone anywhere. The 20 Aug outage
 * was detected correctly and pushed correctly — and still went unseen for 41
 * hours, because push was the only way it could arrive. */
async function deliver(alert: PendingAlert, record: unknown) {
  const prefix = alert.service === MACHINE_KEY ? "🖥️" : "⚠️";
  const icon = alert.toHealth === "ok" ? "✅" : prefix;
  await Promise.allSettled([
    pushAlert(record),
    sendTelegram(`${icon} ${alert.message}\n\nhttps://ian.lu/ops.html`),
  ]);
}

/* Cron path. Recomputes health, records what changed (or has gone unfixed for
 * long enough to be worth saying again), and delivers only what a phone should
 * buzz for. See alerting.ts for the three rules that decide all of that. */
async function handleCheck() {
  const nowMs = Date.now();
  const services = evaluateAll(await readHeartbeats(), nowMs);
  const planned = planAlerts(services, await lastAlertPerService(), nowMs);
  let notified = 0;

  for (const alert of planned) {
    const { data, error } = await admin
      .from("service_alerts")
      .insert({
        service: alert.service,
        from_health: alert.fromHealth,
        to_health: alert.toHealth,
        message: alert.message,
      })
      .select("id, service, from_health, to_health, message, created_at")
      .single();
    if (error) {
      console.error("ops: alert insert failed", error.message);
      continue;
    }
    if (!alert.notify) continue;
    await deliver(alert, data);
    notified += 1;
  }

  return json({
    checked: services.length,
    recorded: planned.length,
    notified,
    telegram: telegramConfigured(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "bad json" }, 400); }

  /* Cron path first, and it fails closed: with OPS_CRON_SECRET unset nobody can
   * reach it, exactly like the webuntis-sync and notify webhooks. */
  if (payload?.action === "check") {
    if (!OPS_CRON_SECRET || req.headers.get("x-cron-secret") !== OPS_CRON_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }
    return await handleCheck();
  }

  const owner = await ownerFromRequest(req);
  if (owner.response) return owner.response;

  if (payload?.action === "status") return await handleStatus();
  if (payload?.action === "command") return await handleCommand(payload, owner.user!.id);
  if (payload?.action === "commandStatus") return await handleCommandStatus(payload);
  return json({ error: "Unknown action." }, 400);
});
