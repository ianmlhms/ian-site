// Supabase Edge Function: strava-sync
// Custom Strava integration so no Strava *premium* is needed — the free Strava
// API returns all your activities (incl. ones your Apple Watch records into Strava).
//
// The client SECRET stays server-side. Tokens are stored in `user_integrations`
// (which has NO client RLS policy) and the browser never sees them.
//
// Setup:
//   1. Create an API app at https://www.strava.com/settings/api
//      (Authorization Callback Domain = ian.lu). Note the Client ID + Client Secret.
//   2. Put the Client ID in pixelbreak-config.js (stravaClientId) — it's public.
//   3. supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... \
//        --project-ref lvksqmgfwkfbblfsozfk
//   4. supabase functions deploy strava-sync --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//
// Ops (POST JSON):
//   {op:"connect", code, redirect_uri}  → exchange code for tokens, store, sync
//   {op:"sync"}                          → refresh if needed, pull recent activities

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// Map a Strava activity type to our short workout type.
function mapType(t: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("run")) return "run";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "ride";
  if (s.includes("swim")) return "swim";
  if (s.includes("walk") || s.includes("hike")) return "walk";
  if (s.includes("weight") || s.includes("workout") || s.includes("gym")) return "gym";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!CID || !SECRET) return json({ configured: false }, 200);

  // Identify the caller from their Supabase JWT.
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const op = body.op;

  async function saveTokens(t: { access_token: string; refresh_token: string; expires_at: number; athlete?: { id: number } }) {
    await admin.from("user_integrations").upsert({
      user_id: uid, provider: "strava",
      access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at: new Date(t.expires_at * 1000).toISOString(),
      meta: { athlete_id: t.athlete?.id ?? null }, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });
  }

  // Return a valid access token, refreshing if it's expired.
  async function freshToken(): Promise<string | null> {
    const { data: row } = await admin.from("user_integrations")
      .select("access_token,refresh_token,expires_at").eq("user_id", uid).eq("provider", "strava").maybeSingle();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() > Date.now() + 60000) return row.access_token;
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: CID, client_secret: SECRET, grant_type: "refresh_token", refresh_token: row.refresh_token }),
    });
    if (!r.ok) return null;
    const t = await r.json();
    await saveTokens(t);
    return t.access_token;
  }

  async function pullActivities(token: string) {
    const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return 0;
    const acts = await r.json();
    if (!Array.isArray(acts)) return 0;
    const rows = acts.map((a) => ({
      user_id: uid, source: "strava", ext_id: String(a.id),
      type: mapType(a.type), at: a.start_date,
      duration_min: a.moving_time ? Math.round(a.moving_time / 60) : null,
      distance_km: a.distance ? +(a.distance / 1000).toFixed(2) : null,
      calories: a.calories ? Math.round(a.calories) : null,
      note: a.name || null,
    }));
    if (rows.length) await admin.from("workouts").upsert(rows, { onConflict: "user_id,source,ext_id" });
    return rows.length;
  }

  if (op === "connect") {
    if (!body.code) return json({ error: "no code" }, 400);
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: CID, client_secret: SECRET, code: body.code, grant_type: "authorization_code" }),
    });
    if (!r.ok) return json({ error: "token exchange failed" }, 400);
    const t = await r.json();
    await saveTokens(t);
    const n = await pullActivities(t.access_token);
    return json({ ok: true, synced: n });
  }

  if (op === "sync") {
    const token = await freshToken();
    if (!token) return json({ error: "not connected" }, 400);
    const n = await pullActivities(token);
    return json({ ok: true, synced: n });
  }

  return json({ error: "bad op" }, 400);
});
