// Supabase Edge Function: turn
// Mints short-lived TURN credentials, keeping the provider secrets server-side (never shipped to the
// browser or committed to the repo). Used by call.html (FaceTime, signed-in users only) and by
// Kart Lëtzebuerg online play (guests allowed, rate-limited, shorter TTL).
//
// Providers, in order of preference:
//   1) Cloudflare Realtime TURN   (secrets CF_TURN_KEY_ID + CF_TURN_API_TOKEN; 1000 GB/month free)
//   2) Metered                    (secrets METERED_DOMAIN + METERED_SECRET; 500 MB/month free)
//   3) Google STUN only           (no secrets / provider error: peers that can reach each other still connect)
//
// Deploy + secrets:
//   supabase functions deploy turn --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set CF_TURN_KEY_ID=<key id> CF_TURN_API_TOKEN=<api token> --project-ref lvksqmgfwkfbblfsozfk
//   (optional fallback) supabase secrets set METERED_DOMAIN=ian.metered.live METERED_SECRET=<secret> --project-ref ...
//
// Request:  GET/POST .../functions/v1/turn            -> call.html: needs a signed-in user (401 otherwise), TTL 4 h
//           GET/POST .../functions/v1/turn?for=kart   -> the game: the anon key is accepted too (per-IP limit), TTL 2 h
// Response: { iceServers: [...], turn: boolean, provider: "cloudflare"|"metered"|"stun", ttl: seconds }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CF_KEY_ID = Deno.env.get("CF_TURN_KEY_ID") ?? "";
const CF_TOKEN = Deno.env.get("CF_TURN_API_TOKEN") ?? "";
const SECRET = Deno.env.get("METERED_SECRET") ?? "";
const DOMAIN = Deno.env.get("METERED_DOMAIN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// The browser calls this with a bearer token (no cookies), so a wildcard origin gives nothing away; abuse is stopped by the limits below.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const TTL_USER = 14400;          // 4 h: signed-in users (a long call)
const TTL_GUEST = 7200;          // 2 h: guests of the game (a lobby session)
const LIMIT_USER = 30;           // credential requests per hour and user
const LIMIT_GUEST = 20;          // credential requests per hour and IP (guests)
const WINDOW_MS = 3600_000;

// Per-instance sliding window. Edge instances are short-lived and not shared, so this is a cheap brake against a script hammering one
// instance, not an exact quota; the providers' own free-tier caps are the hard stop.
const hits = new Map<string, number[]>();
function limited(key: string, max: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= max) { hits.set(key, list); return true; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) {                       // never grow without bound
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    if (hits.size > 5000) hits.clear();
  }
  return false;
}
function clientIp(req: Request): string {
  const f = req.headers.get("x-forwarded-for");
  return (f ? f.split(",")[0].trim() : req.headers.get("cf-connecting-ip")) || "unknown";
}

async function cloudflare(ttl: number) {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(CF_KEY_ID)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl }),
  });
  if (!r.ok) throw new Error("cloudflare " + r.status + " " + (await r.text()).slice(0, 120));
  const data = await r.json();
  const list = Array.isArray(data?.iceServers) ? data.iceServers : [];
  // Cloudflare also lists port 53, which Firefox refuses (and logs warnings for): keep the other transports.
  const servers = list
    .map((s: any) => {
      const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls]).filter((u: unknown) => typeof u === "string" && !/:53(\?|$)/.test(u as string));
      return urls.length ? { ...s, urls } : null;
    })
    .filter(Boolean);
  if (!servers.some((s: any) => s.credential)) throw new Error("cloudflare returned no TURN credential");
  return servers;
}

// Metered's recipe is two steps, both server-side (secret stays here):
//   1) POST /api/v1/turn/credential?secretKey=…  → short-lived {username,password,apiKey}
//   2) GET  /api/v1/turn/credentials?apiKey=…    → ready iceServers array
async function metered(ttl: number) {
  const cr = await fetch(`https://${DOMAIN}/api/v1/turn/credential?secretKey=${encodeURIComponent(SECRET)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiryInSeconds: ttl, label: "ian.lu" }),
  });
  if (!cr.ok) throw new Error("credential " + cr.status + " " + (await cr.text()).slice(0, 120));
  const cred = await cr.json();
  if (!cred?.apiKey) throw new Error("no apiKey in credential response");
  const ic = await fetch(`https://${DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(cred.apiKey)}`);
  if (!ic.ok) throw new Error("credentials " + ic.status);
  const arr = await ic.json();
  return Array.isArray(arr) ? arr.filter((s: any) => s && typeof s.urls === "string") : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const forKart = new URL(req.url).searchParams.get("for") === "kart";
  const auth = req.headers.get("Authorization") ?? "";
  let userId = "";
  if (auth.startsWith("Bearer ") && SB_URL && SB_ANON) {
    const client = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user }, error } = await client.auth.getUser();
    if (!error && user) userId = user.id;
  }
  if (!userId && !forKart) return json({ error: "sign in first" }, 401);       // calls stay account-only

  const guest = !userId;
  const key = guest ? "ip:" + clientIp(req) : "u:" + userId;
  if (limited(key, guest ? LIMIT_GUEST : LIMIT_USER)) return json({ error: "too many requests" }, 429);
  const ttl = guest ? TTL_GUEST : TTL_USER;

  if (CF_KEY_ID && CF_TOKEN) {
    try {
      const turn = await cloudflare(ttl);
      return json({ iceServers: turn, turn: true, provider: "cloudflare", ttl });
    } catch (e: any) { console.error("turn cloudflare", e?.message); }
  }
  if (SECRET && DOMAIN) {
    try {
      const turn = await metered(ttl);
      if (turn.length) return json({ iceServers: [...STUN, ...turn], turn: true, provider: "metered", ttl });
    } catch (e: any) { console.error("turn metered", e?.message); }
  }
  return json({ iceServers: STUN, turn: false, provider: "stun", ttl: 0 });
});
