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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SECRET || !DOMAIN) return json({ iceServers: STUN, turn: false });

  try {
    const r = await fetch(`https://${DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(SECRET)}`);
    if (!r.ok) throw new Error("metered " + r.status);
    const data = await r.json();
    const relays = Array.isArray(data) ? data : [];
    // keep only well-formed entries, then prepend STUN
    const turn = relays.filter((s: any) => s && typeof s.urls === "string");
    return json({ iceServers: [...STUN, ...turn], turn: turn.length > 0 });
  } catch (e: any) {
    console.error("turn", e?.message);
    return json({ iceServers: STUN, turn: false });
  }
});
