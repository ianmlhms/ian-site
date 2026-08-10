// Supabase Edge Function: ops
// Mini Control Room — health of the services on Ian's Mac mini, the restart
// queue, and the cron check that pushes when one of them changes state.
//
// Deployed with --no-verify-jwt because the cron path authenticates with a
// shared secret; every other action is gated by ownerFromRequest below.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS, cleanString, json, ownerFromRequest } from "../_shared/studio.ts";
import { evaluateAll, overallHealth, SERVICES, type Health } from "./health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const OPS_CRON_SECRET = Deno.env.get("OPS_CRON_SECRET") ?? "";
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";
const SERVICE_KEYS = new Set(SERVICES.map((service) => service.key));
const ACTIONS = new Set(["restart", "start", "stop"]);
const MAX_ALERTS = 20;

const admin = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/* Which health states are worth waking a phone for. `unknown` is excluded on
 * purpose: before OpsAgent is deployed every service reads unknown, and that is
 * a deployment fact, not an incident. */
const ALERTABLE = new Set<Health>(["down", "missed", "warn"]);

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

/** The health each service was last alerted at, so we only report transitions. */
async function lastAlertedHealth(): Promise<Map<string, string>> {
  const { data } = await admin
    .from("service_alerts")
    .select("service, to_health, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const latest = new Map<string, string>();
  for (const row of data ?? []) {
    if (!latest.has(row.service)) latest.set(row.service, row.to_health);
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

/* Cron path. Recomputes health and records a row only where the verdict has
 * CHANGED since the last recorded one — otherwise a dead service would push
 * every time the cron fires. */
async function handleCheck() {
  const services = evaluateAll(await readHeartbeats(), Date.now());
  const previous = await lastAlertedHealth();
  const transitions: unknown[] = [];

  for (const service of services) {
    const before = previous.get(service.key);
    if (before === service.health) continue;
    /* First sighting of a healthy service is not news. */
    if (before === undefined && !ALERTABLE.has(service.health)) continue;
    /* Recovery IS news, but only if we previously said something was wrong. */
    if (!ALERTABLE.has(service.health) && before && !ALERTABLE.has(before as Health)) continue;

    const message = service.health === "ok"
      ? `${service.label} is back — ${service.reason}`
      : `${service.label}: ${service.reason}`;
    const { data, error } = await admin
      .from("service_alerts")
      .insert({
        service: service.key,
        from_health: before ?? null,
        to_health: service.health,
        message,
      })
      .select("id, service, from_health, to_health, message, created_at")
      .single();
    if (error) {
      console.error("ops: alert insert failed", error.message);
      continue;
    }
    transitions.push(data);
    await pushAlert(data);
  }

  return json({ checked: services.length, transitions: transitions.length });
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
