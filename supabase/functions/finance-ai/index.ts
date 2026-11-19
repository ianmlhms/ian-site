// Supabase Edge Function: finance-ai
// The background categoriser for money.html. A signed-in user sends a batch of
// bank transactions ({id, note, amount, kind, account}) and gets back one
// category slug per row from a fixed taxonomy. Also offers a short natural-
// language spending summary ("insight") for a month.
//
// MODEL: Claude Haiku 4.5 — categorising short merchant strings is simple, high
// volume, one-time-per-row classification. Haiku is fast + cheap and easily good
// enough; Sonnet would be ~5x the cost for no real quality gain here.
// Key needed as secret: ANTHROPIC_API_KEY (already set for study-buddy).
//
// Deploy:
//   supabase functions deploy finance-ai --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseCats, prepareBatch, SYS } from "../_shared/finance_cats.ts";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_ITEMS = 80;      // rows accepted per categorise call
// Shares the ai_usage daily counter with ask and study-buddy. Without this an
// ordinary account could spend Ian's model budget without limit: authentication
// alone caps the size of one request, never how many are sent.
const IAN_EMAILS = new Set(["konto@ian.lu"]);  // ian@ian.lu is the TEST account
const DAILY_LIMIT = 40;
// Generous output budget: a full batch's JSON answer must NEVER be truncated —
// a cut-off reply fails to parse and silently drops the whole batch to "other".
const MAX_TOKENS = 8000;

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

async function userFromRequest(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email ?? "").toLowerCase() };
}

async function anthropic(sys: string, user: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    console.error("anthropic", r.status, (await r.text()).slice(0, 300));
    throw new Error("provider " + r.status);
  }
  const data = await r.json();
  if (data?.stop_reason === "max_tokens") {
    console.error("anthropic reply truncated at max_tokens — raise MAX_TOKENS");
  }
  return (data?.content ?? [])
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
}

async function categorise(items: any[]): Promise<{ id: string; cat: string }[]> {
  const { realIds, payload } = prepareBatch(items, MAX_ITEMS);
  if (!payload.length) return [];
  const reply = await anthropic(SYS, JSON.stringify({ transactions: payload }));
  return parseCats(reply, realIds);
}

async function insight(summary: any): Promise<string> {
  const sys =
    "You are a friendly money coach for a teenager in Luxembourg. Given a JSON " +
    "summary of one period's spending by category (amounts in EUR, transfers and " +
    "investments already excluded from spending), write 2-3 short sentences in " +
    "LËTZEBUERGESCH. Mention the biggest spending area, one useful observation, " +
    "and keep an encouraging tone. Plain text, no markdown, no lists.";
  return await anthropic(sys, JSON.stringify(summary).slice(0, 4000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "server not configured" }, 500);

  const user = await userFromRequest(req);
  if (!user) return json({ error: "sign in first" }, 401);

  const { data: used, error: capErr } = await admin.rpc("ai_usage_bump", {
    p_user: user.id, p_limit: DAILY_LIMIT,
  });
  if (capErr) { console.error("ai_usage_bump", capErr.message); return json({ error: "usage check failed" }, 500); }
  if (!IAN_EMAILS.has(user.email) && (used ?? 0) > DAILY_LIMIT) {
    return json({ error: "daily limit reached" }, 429);
  }

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  try {
    if (payload?.action === "insight") {
      const text = await insight(payload?.summary ?? {});
      return json({ insight: text || "" });
    }
    const cats = await categorise(Array.isArray(payload?.items) ? payload.items : []);
    return json({ cats });
  } catch (e: any) {
    console.error("finance-ai", e?.message);
    return json({ error: "ai error" }, 502);
  }
});
