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

const MODEL = "claude-haiku-4-5-20251001";
const MAX_ITEMS = 80;      // rows accepted per categorise call
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

// The one taxonomy shared with money.html. Keep slugs in sync there.
const CATS = [
  "food", "groceries", "transport", "shopping", "subscription",
  "leisure", "health", "education", "income", "investment",
  "dividend", "fees", "cash", "transfer", "other",
];
const CATSET = new Set(CATS);

const SYS =
  "You categorise bank-account transactions for a teenager in Luxembourg. " +
  "Each transaction has a free-text note (a merchant name or bank label, often " +
  "in French/German/English), an amount, a direction (in=money received, " +
  "out=money spent) and the account it is on. Assign EXACTLY ONE category slug " +
  "to each, chosen ONLY from this list:\n" +
  "food (restaurants, cafes, fast food, snacks), " +
  "groceries (supermarkets: Cactus, Auchan, Delhaize, Aldi, Lidl…), " +
  "transport (bus, train CFL, fuel, parking, Uber/Bolt, flights), " +
  "shopping (clothes, electronics, Amazon, Zalando, general retail), " +
  "subscription (Spotify, Netflix, iCloud, YouTube, app stores, SaaS), " +
  "leisure (cinema, games, hobbies, sports, entertainment), " +
  "health (pharmacy, doctor, dentist), " +
  "education (school, books, courses), " +
  "income (salary, allowance, gifts of money received, refunds), " +
  "investment (buying/selling stocks or ETFs), " +
  "dividend (dividends, interest, investment rewards), " +
  "fees (bank/card fees, charges), " +
  "cash (ATM withdrawals, cash), " +
  "transfer (moving money between the person's OWN accounts), " +
  "other (anything that does not clearly fit).\n" +
  "Bank labels often look like 'PAIEMENT VISA <merchant> <city>', " +
  "'DOMICILIATION <company>' or 'Achat <merchant>' — judge by the merchant or " +
  "company name inside the label, not the payment-method words around it. " +
  "Use 'other' ONLY as a true last resort: an unfamiliar merchant name still " +
  "deserves your best guess from the specific categories above.\n" +
  "Return ONLY minified JSON of the form {\"cats\":[{\"id\":\"<id>\"," +
  "\"cat\":\"<slug>\"}]} with one entry per input id, no prose, no code fences.";

async function userFromRequest(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id };
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

// pull the first {...} JSON object out of a model reply
function extractJson(s: string): any {
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function categorise(items: any[]): Promise<{ id: string; cat: string }[]> {
  // The model sees small positional ids (0,1,2…) instead of the real UUIDs:
  // far fewer output tokens (no truncation) and no chance of a mistyped UUID.
  const source = items.filter((it) => it && it.id != null).slice(0, MAX_ITEMS);
  const realIds = source.map((it) => String(it.id));
  const clean = source.map((it, i) => ({
    id: String(i),
    note: String(it.note ?? "").slice(0, 140),
    amount: Number(it.amount) || 0,
    dir: it.kind === "in" ? "in" : "out",
    account: String(it.account ?? "").slice(0, 40),
  }));
  if (!clean.length) return [];
  const reply = await anthropic(SYS, JSON.stringify({ transactions: clean }));
  const parsed = extractJson(reply);
  const rows = Array.isArray(parsed?.cats) ? parsed.cats : [];
  if (!rows.length) console.error("categorise: unparseable reply", reply.slice(0, 200));
  const out: { id: string; cat: string }[] = [];
  for (const r of rows) {
    const idx = Number(r?.id);
    if (!Number.isInteger(idx) || idx < 0 || idx >= realIds.length) continue;
    const cat = CATSET.has(r?.cat) ? r.cat : "other";
    out.push({ id: realIds[idx], cat });
  }
  return out;
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
