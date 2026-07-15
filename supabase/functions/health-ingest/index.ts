// Supabase Edge Function: health-ingest
// Receives Apple Health data pushed from an Apple Shortcuts automation and writes
// it into the caller's own health_days + workouts rows. No Strava/premium needed.
//
// Auth: the Shortcut sends a per-user token (from get_health_token() on health.html).
// This function looks the user up by that token with the service role — so it does
// NOT need a Supabase login, which Shortcuts can't do. The token is the only secret
// the phone holds; it maps to exactly one user and can only write that user's data.
//
// Deploy (no login required so Shortcuts can call it):
//   supabase functions deploy health-ingest --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//
// POST JSON (any subset):
//   { "token": "…",
//     "log_date": "2026-07-09",        // optional; defaults to today (UTC)
//     "steps": 8421, "sleep_h": 7.5, "weight_kg": 62.3, "water_ml": 1500,
//     "workouts": [ { "type":"run", "at":"2026-07-09T17:00:00Z",
//                     "duration_min":32, "distance_km":5.1, "calories":310,
//                     "ext_id":"watch-123", "note":"Evening run" } ] }

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

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const TYPES = new Set(["run", "ride", "swim", "gym", "walk", "kart", "other"]);
const mapType = (t: string) => {
  const s = (t || "").toLowerCase();
  if (TYPES.has(s)) return s;
  if (s.includes("run")) return "run";
  if (s.includes("cycl") || s.includes("ride") || s.includes("bike")) return "ride";
  if (s.includes("swim")) return "swim";
  if (s.includes("walk") || s.includes("hik")) return "walk";
  if (s.includes("strength") || s.includes("gym") || s.includes("weight")) return "gym";
  return "other";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!token) return json({ error: "no token" }, 400);

  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: row } = await admin.from("user_integrations")
    .select("user_id").eq("provider", "watch").eq("access_token", token).maybeSingle();
  const uid = row?.user_id;
  if (!uid) return json({ error: "bad token" }, 401);

  // ---- daily metrics → upsert one health_days row ----
  const log_date = /^\d{4}-\d{2}-\d{2}$/.test(body.log_date || "")
    ? body.log_date : new Date().toISOString().slice(0, 10);
  const day: Record<string, unknown> = { user_id: uid, log_date, updated_at: new Date().toISOString() };
  let touchedDay = false;
  for (const [k, col] of [["steps", "steps"], ["sleep_h", "sleep_h"], ["weight_kg", "weight_kg"], ["water_ml", "water_ml"]] as const) {
    const v = num(body[k]);
    if (v !== null) { day[col] = v; touchedDay = true; }
  }
  if (touchedDay) await admin.from("health_days").upsert(day, { onConflict: "user_id,log_date" });

  // ---- workouts → upsert (deduped by ext_id) ----
  let nWork = 0;
  let workError: string | null = null;
  if (Array.isArray(body.workouts) && body.workouts.length) {
    const rows = body.workouts.slice(0, 50).map((w: Record<string, unknown>) => ({
      user_id: uid, source: "watch",
      ext_id: String(w.ext_id ?? w.id ?? `${w.type}-${w.at}`),
      type: mapType(String(w.type ?? "other")),
      at: (typeof w.at === "string" ? w.at : new Date().toISOString()),
      duration_min: num(w.duration_min),
      distance_km: num(w.distance_km),
      calories: num(w.calories),
      note: w.note ? String(w.note).slice(0, 200) : null,
    }));
    const { error } = await admin.from("workouts").upsert(rows, { onConflict: "user_id,source,ext_id" });
    if (error) { workError = error.message; console.error("[health-ingest] workouts upsert:", error.message); }
    else nWork = rows.length;
  }

  return json({ ok: !workError, day: touchedDay, workouts: nWork, ...(workError ? { error: workError } : {}) });
});
