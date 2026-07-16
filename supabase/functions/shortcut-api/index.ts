// Supabase Edge Function: shortcut-api
// Read-only data endpoint for iPhone Shortcuts (Action button). Same auth
// model as health-ingest: the per-user "watch" token from get_health_token()
// on health.html maps to exactly one user via user_integrations — no Supabase
// login needed, which Shortcuts can't do.
//
// Deploy (no login required so Shortcuts can call it):
//   supabase functions deploy shortcut-api --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//
// POST JSON: { "token": "…", "action": "steps" }
// or GET:    ?token=…&action=steps
//   (GET exists because the Shortcuts importer silently drops hand-built
//    JSON request bodies — a bare URL always survives.)
// → { ok, date, steps, sleep_h, water_ml, speak }
//   `speak` is a ready Luxembourgish sentence the Shortcut can read aloud.
// Extend with more actions (water, homework, countdowns…) as needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const fmtNum = (n: number) => new Intl.NumberFormat("de-LU").format(n);

const speakSteps = (steps: number | null, sleepH: number | null, waterMl: number | null): string => {
  if (steps === null) return "Haut nach keng Schrëtt opgezeechent.";
  const parts = [`Haut ${fmtNum(steps)} Schrëtt`];
  if (sleepH !== null) parts.push(`${String(sleepH).replace(".", ",")} Stonne geschlof`);
  if (waterMl !== null && waterMl > 0) parts.push(`${fmtNum(waterMl)} Milliliter Waasser`);
  return parts.join(", ") + ".";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "GET or POST only" }, 405);

  const query = new URL(req.url).searchParams;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const token = String(body.token || query.get("token") || "").trim();
  const action = String(body.action || query.get("action") || "steps").trim();
  if (!token) return json({ error: "no token" }, 400);

  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: row } = await admin.from("user_integrations")
    .select("user_id").eq("provider", "watch").eq("access_token", token).maybeSingle();
  const uid = row?.user_id;
  if (!uid) return json({ error: "bad token" }, 401);

  if (action === "steps") {
    const today = new Date().toISOString().slice(0, 10);
    const { data: day, error } = await admin.from("health_days")
      .select("steps, sleep_h, water_ml")
      .eq("user_id", uid).eq("log_date", today).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    const steps = day?.steps ?? null;
    const sleepH = day?.sleep_h ?? null;
    const waterMl = day?.water_ml ?? null;
    return json({
      ok: true, date: today, steps, sleep_h: sleepH, water_ml: waterMl,
      speak: speakSteps(steps, sleepH, waterMl),
    });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});
