// Supabase Edge Function: webuntis-sync
// Logs into WebUntis with the admin's credentials (function secrets), fetches
// upcoming homework, and upserts it into public.homework. Invoked by the admin
// from homework.html ("Sync now"), and optionally by a daily cron.
//
// Secrets (set with `supabase secrets set ...`, see scripts/WEBUNTIS-SETUP.md):
//   WEBUNTIS_SERVER  e.g. https://laml.webuntis.com   (no trailing /WebUntis)
//   WEBUNTIS_SCHOOL  e.g. "Aline Mayrisch"
//   WEBUNTIS_USER    your WebUntis login
//   WEBUNTIS_PASS    your WebUntis password            (secret)
//   ADMIN_EMAIL      konto@ian.lu                       (who may trigger it)
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVER = (Deno.env.get("WEBUNTIS_SERVER") || "https://laml.webuntis.com").replace(/\/+$/, "");
const SCHOOL = Deno.env.get("WEBUNTIS_SCHOOL") || "Aline Mayrisch";
const USER = Deno.env.get("WEBUNTIS_USER") || "";
const PASS = Deno.env.get("WEBUNTIS_PASS") || "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "konto@ian.lu";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = (n: number) => { const s = String(n); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 1) Only the admin may trigger a sync.
  try {
    const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || user.email !== ADMIN_EMAIL) return json({ error: "forbidden" }, 403);
  } catch { return json({ error: "forbidden" }, 403); }

  if (!USER || !PASS) return json({ error: "WebUntis credentials not set (WEBUNTIS_USER / WEBUNTIS_PASS)" }, 500);

  // 2) Authenticate (JSON-RPC) → sessionId + cookies.
  const rpcUrl = `${SERVER}/WebUntis/jsonrpc.do?school=${encodeURIComponent(SCHOOL)}`;
  const authRes = await fetch(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "1", method: "authenticate", params: { user: USER, password: PASS, client: "ianlu-sync" }, jsonrpc: "2.0" }),
  });
  const setCookies = (authRes.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  const authJson = await authRes.json().catch(() => ({}));
  const sessionId = authJson?.result?.sessionId;
  if (!sessionId) return json({ error: "WebUntis login failed", detail: authJson?.error ?? null }, 502);

  let cookie = setCookies.join("; ");
  if (!/JSESSIONID=/.test(cookie)) cookie += (cookie ? "; " : "") + `JSESSIONID=${sessionId}`;
  if (!/schoolname=/.test(cookie)) cookie += `; schoolname="_${btoa(SCHOOL)}"`;

  // 3) Bearer token for the REST API (best effort — some tenants don't need it).
  let bearer = "";
  try { const t = await fetch(`${SERVER}/WebUntis/api/token/new`, { headers: { Cookie: cookie } }); if (t.ok) bearer = (await t.text()).trim(); } catch { /* ignore */ }

  // 4) Homework for the next 5 weeks.
  const start = new Date(), end = new Date(); end.setDate(end.getDate() + 35);
  const hwUrl = `${SERVER}/WebUntis/api/homeworks/lessons?startDate=${ymd(start)}&endDate=${ymd(end)}`;
  const headers: Record<string, string> = { Cookie: cookie };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  const hwRes = await fetch(hwUrl, { headers });
  if (!hwRes.ok) { const body = await hwRes.text().catch(() => ""); return json({ error: "homework fetch failed", status: hwRes.status, body: body.slice(0, 300) }, 502); }
  const hwJson = await hwRes.json().catch(() => ({}));
  const data = hwJson?.data ?? hwJson;
  const homeworks = data?.homeworks ?? data?.records ?? [];
  const lessons = data?.lessons ?? [];
  const subjById: Record<string, string> = {};
  for (const l of lessons) subjById[l.id] = l.subject ?? l?.subjects?.[0]?.element?.name ?? l?.subjects?.[0]?.name ?? "";

  const rows = homeworks.map((h: any) => ({
    id: h.id,
    subject: subjById[h.lessonId] || h.subject || "",
    assigned_date: h.date ? fromYmd(h.date) : null,
    due_date: h.dueDate ? fromYmd(h.dueDate) : null,
    text: h.text || "",
    remark: h.remark || "",
    completed: !!h.completed,
    synced_at: new Date().toISOString(),
  })).filter((r: any) => r.id != null);

  // 5) Upsert into the homework table (service role).
  const admin = createClient(SB_URL, SERVICE);
  if (rows.length) {
    const { error } = await admin.from("homework").upsert(rows, { onConflict: "id" });
    if (error) return json({ error: "db upsert failed", detail: error.message }, 500);
  }

  // 6) Logout (best effort).
  try { await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ id: "2", method: "logout", params: {}, jsonrpc: "2.0" }) }); } catch { /* ignore */ }

  return json({ ok: true, count: rows.length });
});
