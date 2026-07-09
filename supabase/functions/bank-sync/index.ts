// Supabase Edge Function: bank-sync
// Read-only bank transaction sync via GoCardless Bank Account Data (ex-Nordigen).
// FREE, covers Luxembourg banks (Spuerkeess/BCEE, BGL BNP Paribas, ING LU, …).
//
// SECURITY: the user consents on THEIR OWN BANK's page (OAuth-like). This function
// never sees a bank password; it holds only GoCardless API secrets + the resulting
// account id, stored in `user_integrations` (no client RLS). Read-only: it pulls
// transactions, it can never move money.
//
// Setup:
//   1. Free account at https://bankaccountdata.gocardless.com → Secrets → get
//      SECRET_ID + SECRET_KEY.
//   2. Find your bank's institution id (GET /institutions/?country=lu with a token),
//      e.g. Spuerkeess. Set it as BANK_INSTITUTION_ID.
//   3. supabase secrets set GC_SECRET_ID=... GC_SECRET_KEY=... BANK_INSTITUTION_ID=... \
//        --project-ref lvksqmgfwkfbblfsozfk
//   4. supabase functions deploy bank-sync --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//
// Ops (POST JSON):
//   {op:"connect", redirect}  → create requisition, return {link} to the bank consent page
//   {op:"finalize", ref}      → after consent: resolve account id, pull transactions
//   {op:"sync"}               → pull transactions for the stored account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GC_ID = Deno.env.get("GC_SECRET_ID") ?? "";
const GC_KEY = Deno.env.get("GC_SECRET_KEY") ?? "";
const INSTITUTION = Deno.env.get("BANK_INSTITUTION_ID") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GC = "https://bankaccountdata.gocardless.com/api/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

async function gcToken(): Promise<string> {
  const r = await fetch(`${GC}/token/new/`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret_id: GC_ID, secret_key: GC_KEY }),
  });
  const j = await r.json();
  return j.access;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!GC_ID || !GC_KEY || !INSTITUTION) return json({ configured: false }, 200);

  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const op = body.op;
  const token = await gcToken();
  const H = { Authorization: `Bearer ${token}`, "content-type": "application/json" };

  if (op === "connect") {
    // one requisition = one consent session; store its id so finalize can resolve it
    const r = await fetch(`${GC}/requisitions/`, {
      method: "POST", headers: H,
      body: JSON.stringify({ redirect: body.redirect, institution_id: INSTITUTION, user_language: "EN" }),
    });
    const j = await r.json();
    if (!j.link) return json({ error: "requisition failed", detail: j }, 400);
    await admin.from("user_integrations").upsert({
      user_id: uid, provider: "bank", access_token: null,
      meta: { requisition_id: j.id }, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });
    return json({ link: j.link });
  }

  async function storedAccount(): Promise<string | null> {
    const { data } = await admin.from("user_integrations").select("meta").eq("user_id", uid).eq("provider", "bank").maybeSingle();
    return data?.meta?.account_id ?? null;
  }

  async function pull(accountId: string) {
    const r = await fetch(`${GC}/accounts/${accountId}/transactions/`, { headers: H });
    const j = await r.json();
    const booked = j?.transactions?.booked ?? [];
    const rows = booked.map((t: Record<string, unknown>) => {
      const amt = Number(t.transactionAmount?.amount ?? 0);
      return {
        user_id: uid, source: "bank", ext_id: String(t.transactionId ?? t.internalTransactionId ?? crypto.randomUUID()),
        amount: Math.abs(amt), kind: amt < 0 ? "out" : "in",
        currency: (t.transactionAmount?.currency ?? "EUR").slice(0, 3),
        category: null,
        note: (t.remittanceInformationUnstructured || t.creditorName || t.debtorName || "") + "".slice(0, 200) || null,
        at: (t.bookingDate ? `${t.bookingDate}T12:00:00Z` : new Date().toISOString()),
      };
    });
    if (rows.length) await admin.from("finance_tx").upsert(rows, { onConflict: "user_id,ext_id" });
    return rows.length;
  }

  if (op === "finalize") {
    // resolve the requisition → first account id, mark connected, initial pull
    const { data } = await admin.from("user_integrations").select("meta").eq("user_id", uid).eq("provider", "bank").maybeSingle();
    const reqId = data?.meta?.requisition_id;
    if (!reqId) return json({ error: "no requisition" }, 400);
    const r = await fetch(`${GC}/requisitions/${reqId}/`, { headers: H });
    const j = await r.json();
    const accountId = (j.accounts || [])[0];
    if (!accountId) return json({ error: "no account (consent not completed?)" }, 400);
    await admin.from("user_integrations").update({
      access_token: "linked", meta: { ...data.meta, account_id: accountId }, updated_at: new Date().toISOString(),
    }).eq("user_id", uid).eq("provider", "bank");
    const n = await pull(accountId);
    return json({ ok: true, synced: n });
  }

  if (op === "sync") {
    const acc = await storedAccount();
    if (!acc) return json({ error: "not connected" }, 400);
    const n = await pull(acc);
    return json({ ok: true, synced: n });
  }

  return json({ error: "bad op" }, 400);
});
