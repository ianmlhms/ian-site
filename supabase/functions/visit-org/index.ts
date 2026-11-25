// Supabase Edge Function: visit-org
// The home page reports one visit per browser session; the network it came from is
// looked up in the public internet register (RDAP) and only the ORGANISATION is
// counted (public.org_visits, admin-read). The address is never stored or logged and
// is cut to its network before the lookup. Deployed with --no-verify-jwt (visitors
// are not signed in); the answer is always an empty 204, so it tells a caller nothing.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isPublicIp, maskIp, orgFromRdap } from "./org.ts";

const ORIGINS = new Set(["https://ian.lu", "https://www.ian.lu"]);
const RDAP = "https://rdap.db.ripe.net/ip/";
const LOOKUP_TIMEOUT_MS = 4000;
const MAX_BODY = 400;
const MAX_PER_MINUTE = 40;
const PAGE = /^\/[a-z0-9/_.-]{0,60}$/i;
const HOST = /^[a-z0-9.-]{1,80}$/i;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let windowStart = 0;
let windowCount = 0;
function isFlood(now: number) {
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  windowCount += 1;
  return windowCount > MAX_PER_MINUTE;
}

async function lookUp(ip: string) {
  const response = await fetch(RDAP + encodeURIComponent(maskIp(ip)), {
    headers: { accept: "application/rdap+json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`register answered ${response.status}`); }
  return orgFromRdap(await response.json());
}

async function record(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return;
  const body = JSON.parse(text);
  const page = typeof body?.page === "string" && PAGE.test(body.page) ? body.page : "/";
  const ref = typeof body?.ref === "string" && HOST.test(body.ref) ? body.ref.toLowerCase() : "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (!isPublicIp(ip)) return;
  const found = await lookUp(ip);
  if (!found) return;
  const { error } = await admin.rpc("log_org_visit", {
    p_org: found.org, p_kind: found.kind, p_country: found.country, p_page: page, p_ref: ref,
  });
  if (error) throw new Error(`log_org_visit: ${error.message}`);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const headers = {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://ian.lu",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
  if (req.method === "POST" && ORIGINS.has(origin) && !isFlood(Date.now())) {
    // never the address in a log line: only what went wrong
    try { await record(req); } catch (error) { console.error("visit-org:", error instanceof Error ? error.message : "failed"); }
  }
  return new Response(null, { status: 204, headers });
});
