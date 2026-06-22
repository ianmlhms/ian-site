// Supabase Edge Function: webuntis-sync
// Logs into WebUntis with the admin's "Untis Mobile" SECRET (TOTP) — more reliable
// than user/password and 2FA-proof — fetches upcoming homework, and upserts it
// into public.homework. Invoked by the admin from homework.html ("Sync now").
//
// Secrets (set with `supabase secrets set ...`, see scripts/WEBUNTIS-SETUP.md):
//   WEBUNTIS_SERVER  https://laml.webuntis.com         (no trailing /WebUntis)
//   WEBUNTIS_SCHOOL  laml                               (API id, NOT the display name)
//   WEBUNTIS_USER    Mulla383                           (from the QR/secret screen)
//   WEBUNTIS_SECRET  the base32 key from "Zugriff über Untis Mobile"   (secret)
//   ADMIN_EMAIL      konto@ian.lu                        (who may trigger it)
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVER = (Deno.env.get("WEBUNTIS_SERVER") || "https://laml.webuntis.com").replace(/\/+$/, "");
const SCHOOL = Deno.env.get("WEBUNTIS_SCHOOL") || "laml";
const USER = Deno.env.get("WEBUNTIS_USER") || "";
const SECRET = (Deno.env.get("WEBUNTIS_SECRET") || "").replace(/\s+/g, "").toUpperCase();
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "konto@ian.lu";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = (n: number) => { const s = String(n); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };

// ---- TOTP from the Untis Mobile secret (RFC 6238, base32, SHA-1, 30s, 6 digits)
function base32Decode(b32: string): Uint8Array {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of b32.replace(/=+$/, "")) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, "0"); }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(out);
}
async function totp(secret: string, t = Date.now()): Promise<string> {
  const counter = Math.floor(t / 1000 / 30);
  const buf = new ArrayBuffer(8); const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 1) Only the admin may trigger a sync.
  try {
    const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user || user.email !== ADMIN_EMAIL) return json({ error: "forbidden" }, 403);
  } catch { return json({ error: "forbidden" }, 403); }

  if (!USER || !SECRET) return json({ error: "WebUntis not configured (WEBUNTIS_USER / WEBUNTIS_SECRET)" }, 500);

  // 2) Authenticate with the mobile secret (getUserData2017) → session cookie.
  const otp = await totp(SECRET);
  const internUrl = `${SERVER}/WebUntis/jsonrpc_intern.do?m=getUserData2017&school=${encodeURIComponent(SCHOOL)}&v=i3.5`;
  const authRes = await fetch(internUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "ianlu", method: "getUserData2017", params: [{ auth: { clientTime: Date.now(), user: USER, otp: Number(otp) } }], jsonrpc: "2.0" }),
  });
  const setCookies = (authRes.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  const authJson = await authRes.json().catch(() => ({}));
  if (authJson?.error) return json({ error: "WebUntis login failed", detail: authJson.error }, 502);

  let cookie = setCookies.join("; ");
  if (!/schoolname=/.test(cookie)) cookie += (cookie ? "; " : "") + `schoolname="_${btoa(SCHOOL)}"`;

  // 3) Bearer token for the REST API (best effort).
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

  // 5) Upsert (service role).
  const admin = createClient(SB_URL, SERVICE);
  if (rows.length) {
    const { error } = await admin.from("homework").upsert(rows, { onConflict: "id" });
    if (error) return json({ error: "db upsert failed", detail: error.message }, 500);
  }
  return json({ ok: true, count: rows.length });
});
