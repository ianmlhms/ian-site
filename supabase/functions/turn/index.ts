// Supabase Edge Function: turn
// Mints short-lived TURN credentials for the FaceTime feature (call.html) from
// the Metered API, keeping the Metered *secret* key server-side (never shipped
// to the browser or committed to the repo).
//
// Deploy + secrets:
//   supabase functions deploy turn --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set METERED_DOMAIN=ian.metered.live METERED_SECRET=<secret> --project-ref lvksqmgfwkfbblfsozfk
//
// Returns { iceServers: [...] } (Google STUN is always included as a baseline).
// If the secret is unset or Metered errors, it returns just STUN so calls still
// work between directly-reachable peers.

const SECRET = Deno.env.get("METERED_SECRET") ?? "";
const DOMAIN = Deno.env.get("METERED_DOMAIN") ?? "";

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

// Metered's recipe is two steps, both server-side (secret stays here):
//   1) POST /api/v1/turn/credential?secretKey=…  → short-lived {username,password,apiKey}
//   2) GET  /api/v1/turn/credentials?apiKey=…    → ready iceServers array
const EXPIRY_SECONDS = 14400;   // 4h — plenty for a call; auto-expires so creds don't pile up

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SECRET || !DOMAIN) return json({ iceServers: STUN, turn: false });

  try {
    // 1) mint an expiring credential with the secret
    const cr = await fetch(`https://${DOMAIN}/api/v1/turn/credential?secretKey=${encodeURIComponent(SECRET)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiryInSeconds: EXPIRY_SECONDS, label: "ian.lu-call" }),
    });
    if (!cr.ok) throw new Error("credential " + cr.status + " " + (await cr.text()).slice(0, 120));
    const cred = await cr.json();
    if (!cred?.apiKey) throw new Error("no apiKey in credential response");

    // 2) turn that into a ready iceServers array
    const ic = await fetch(`https://${DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(cred.apiKey)}`);
    if (!ic.ok) throw new Error("credentials " + ic.status);
    const arr = await ic.json();
    const turn = Array.isArray(arr) ? arr.filter((s: any) => s && typeof s.urls === "string") : [];
    return json({ iceServers: [...STUN, ...turn], turn: turn.length > 0 });
  } catch (e: any) {
    console.error("turn", e?.message);
    return json({ iceServers: STUN, turn: false });
  }
});
