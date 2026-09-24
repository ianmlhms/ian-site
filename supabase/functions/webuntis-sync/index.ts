// Supabase Edge Function: webuntis-sync
// Logs into WebUntis with the admin's "Untis Mobile" SECRET (TOTP) — more reliable
// than user/password and 2FA-proof — fetches upcoming homework, and upserts it
// into public.homework. Invoked by the admin from homework.html ("Sync now").
//
// Uses the mobile JSON-RPC API (jsonrpc_intern.do, auth embedded in every call)
// — the browser REST API (/api/homeworks/lessons) is blocked for LAML
// (publicAppAccessAllowed:false), but the mobile API works: proven by the
// DailyBriefing bot, which fetches the timetable the same way.
//
// Secrets (set with `supabase secrets set ...`, see scripts/WEBUNTIS-SETUP.md):
//   WEBUNTIS_SERVER       https://laml.webuntis.com     (no trailing /WebUntis)
//   WEBUNTIS_SCHOOL       laml                          (API id, NOT the display name)
//   WEBUNTIS_USER         MulIa383                      (capital I — from the QR/secret screen)
//   WEBUNTIS_SECRET       the base32 key from "Zugriff über Untis Mobile"   (secret)
//   ADMIN_EMAIL           konto@ian.lu                  (who may trigger it)
//   WEBUNTIS_CRON_SECRET  random hex — lets the daily pg_cron job call this
//                         function via `x-cron-secret` (scripts/webuntis-cron-v1.sql).
//                         Cron path is disabled while unset (fails closed).
//
// Deploy with --no-verify-jwt (like notify/briefing): pg_net sends no JWT, and
// the function enforces admin-JWT-or-cron-secret itself.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVER = (Deno.env.get("WEBUNTIS_SERVER") || "https://laml.webuntis.com").replace(/\/+$/, "");
const SCHOOL = Deno.env.get("WEBUNTIS_SCHOOL") || "laml";
const USER = Deno.env.get("WEBUNTIS_USER") || "";
const SECRET = (Deno.env.get("WEBUNTIS_SECRET") || "").replace(/\s+/g, "").toUpperCase();
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "konto@ian.lu";
const CRON_SECRET = Deno.env.get("WEBUNTIS_CRON_SECRET") || "";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYNC_WINDOW_DAYS = 35;
// Teachers enter tests for the whole term, so look much further ahead than homework.
const EXAM_WINDOW_DAYS = 200;
const HOMEWORK_LOOKBACK_DAYS = 14;
const LUX_TZ = "Europe/Luxembourg";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
// Homework dates arrive as ISO strings on the mobile API, but some tenants use yyyymmdd ints.
const toDate = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
};

// Untis sends "2026-10-13T08:05Z", but that is Luxembourg wall-clock time with a
// misleading Z (measured by UntisWatch), so convert via the zone's real offset.
function luxWallClockToIso(value: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: LUX_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]));
  const luxAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(asUtc - (luxAsUtc - asUtc)).toISOString();
}

const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase("fr") + s.slice(1) : s);

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

// One mobile-API call: fresh TOTP auth is embedded in the params of every request.
async function callUntis(method: string, extra: Record<string, unknown>): Promise<any> {
  const now = Date.now();
  const res = await fetch(`${SERVER}/WebUntis/jsonrpc_intern.do?school=${encodeURIComponent(SCHOOL)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ianlu-webuntis-sync" },
    body: JSON.stringify({
      id: "ianlu", jsonrpc: "2.0", method,
      params: [{ ...extra, auth: { user: USER, otp: Number(await totp(SECRET, now)), clientTime: now } }],
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    const err = (payload as any)?.error ?? {};
    throw new Error(`${method} failed: ${err.code ?? `HTTP ${res.status}`} ${err.message ?? "invalid response"}`);
  }
  return (payload as any).result;
}

// Upserts the tests Untis knows about (keyed by untis_id) with the class taken
// from the exam's own klasseIds, and removes future synced tests that Untis no
// longer lists (cancelled). Manually added tests (untis_id null) are never touched.
async function syncExams(
  admin: ReturnType<typeof createClient>, elemId: number, elemType: string,
  subjectLong: Record<number, string>, classNames: Record<number, string>,
): Promise<{ count: number; removed: number }> {
  const start = new Date(), end = new Date();
  end.setDate(end.getDate() + EXAM_WINDOW_DAYS);
  const result = await callUntis("getExams2017", {
    id: elemId, type: elemType, startDate: isoDate(start), endDate: isoDate(end),
  });
  const rows = (result?.exams ?? []).map((e: any) => ({
    untis_id: e.id,
    subject: subjectLong[e.subjectId] || String(e.name || "").trim(),
    note: [e.text, e.examType].map((v) => String(v || "").trim()).filter(Boolean).join(" · ") || null,
    at: luxWallClockToIso(e.startDateTime),
    class: classNames[(e.klasseIds ?? [])[0]] ?? null,
    created_by: null,
  })).filter((r: any) => typeof r.untis_id === "number" && r.at && r.class && r.subject);

  if (rows.length) {
    const { error } = await admin.from("exams").upsert(rows, { onConflict: "untis_id" });
    if (error) throw new Error("exams upsert failed — " + error.message);
  }
  // Only prune when Untis answered with something: an empty reply is more
  // likely a glitch than every test being cancelled, and pruning would also
  // delete the class's notes attached to those tests.
  let removed = 0;
  if (rows.length) {
    const keep = rows.map((r: any) => r.untis_id);
    const { data, error } = await admin.from("exams").delete()
      .not("untis_id", "is", null).gte("at", new Date().toISOString()).lte("at", end.toISOString())
      .not("untis_id", "in", `(${keep.join(",")})`).select("id");
    if (error) throw new Error("exams prune failed — " + error.message);
    removed = data?.length ?? 0;
  }
  return { count: rows.length, removed };
}

// Copies Untis homework into the class-shared board, class taken from the
// lesson's klassenIds. Prunes future synced items Untis no longer lists (never
// after an empty reply); manually added items (untis_id null) are never touched.
async function syncClassHomework(
  admin: ReturnType<typeof createClient>, homeworks: any[], lessons: Record<string, any>,
  subjectLong: Record<number, string>, classNames: Record<number, string>, end: Date,
): Promise<{ count: number; removed: number }> {
  const rows = homeworks.map((h: any) => {
    const lesson = lessons?.[String(h.lessonId)] ?? {};
    const text = [h.text, h.remark].map((v) => String(v || "").trim()).filter(Boolean).join(" — ");
    return {
      untis_id: h.id,
      class: classNames[(lesson.klassenIds ?? [])[0]] ?? null,
      subject: subjectLong[lesson.subjectId] || null,
      title: text.slice(0, 500),
      due: toDate(h.endDate ?? h.dueDate),
      created_by: null,
    };
  }).filter((r: any) => typeof r.untis_id === "number" && r.class && r.title);

  if (rows.length) {
    const { error } = await admin.from("class_homework").upsert(rows, { onConflict: "untis_id" });
    if (error) throw new Error("class_homework upsert failed — " + error.message);
  }
  let removed = 0;
  if (rows.length) {
    const keep = rows.map((r: any) => r.untis_id);
    const { data, error } = await admin.from("class_homework").delete()
      .not("untis_id", "is", null).gte("due", isoDate(new Date())).lte("due", isoDate(end))
      .not("untis_id", "in", `(${keep.join(",")})`).select("id");
    if (error) throw new Error("class_homework prune failed — " + error.message);
    removed = data?.length ?? 0;
  }
  return { count: rows.length, removed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 1) Two allowed callers: the admin (JWT from homework.html) or the daily
  //    pg_cron job (x-cron-secret header). Cron path fails closed while unset.
  const isCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (!isCron) {
    try {
      const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user || user.email !== ADMIN_EMAIL) return json({ error: "forbidden" }, 403);
    } catch { return json({ error: "forbidden" }, 403); }
  }

  if (!USER || !SECRET) return json({ error: "WebUntis not configured (WEBUNTIS_USER / WEBUNTIS_SECRET)" });

  // Upstream errors return 200 + {error} so homework.html can show the failing
  // step directly (supabase-js invoke() hides non-2xx response bodies).
  try {
    // 2) Who am I + subject-name catalogue.
    const userData = await callUntis("getUserData2017", {});
    const elem = userData?.userData ?? {};
    const elemId = elem.elemId, elemType = elem.elemType;
    if (typeof elemId !== "number" || typeof elemType !== "string") {
      return json({ error: "WebUntis user data has no element id", detail: JSON.stringify(elem).slice(0, 300) });
    }
    const subjects: Record<number, string> = {};
    const subjectLong: Record<number, string> = {};
    for (const s of userData?.masterData?.subjects ?? []) {
      if (s && typeof s.id === "number") {
        subjects[s.id] = String(s.name || s.longName || "").trim();
        subjectLong[s.id] = capitalize(String(s.longName || s.name || "").trim());
      }
    }
    const classNames: Record<number, string> = {};
    for (const k of userData?.masterData?.klassen ?? []) {
      if (k && typeof k.id === "number" && k.name) classNames[k.id] = String(k.name).trim();
    }

    // 3) Homework for the next SYNC_WINDOW_DAYS days.
    // Start a little in the past: homework set last week can still be due.
    const start = new Date(), end = new Date();
    start.setDate(start.getDate() - HOMEWORK_LOOKBACK_DAYS);
    end.setDate(end.getDate() + SYNC_WINDOW_DAYS);
    const hw = await callUntis("getHomeWork2017", {
      id: elemId, type: elemType, startDate: isoDate(start), endDate: isoDate(end),
    });
    const homeworks: any[] = hw?.homeWorks ?? hw?.homeworks ?? hw?.records ?? [];
    const lessons = hw?.lessonsById ?? {};
    const subjectOf = (h: any): string => {
      const l = lessons?.[String(h.lessonId)] ?? {};
      const sid = l.subjectId ?? l?.subject?.id;
      if (typeof sid === "number" && subjects[sid]) return subjects[sid];
      if (typeof l.subject === "string" && l.subject) return l.subject;
      return h.subject || "";
    };

    const rows = homeworks.map((h: any) => ({
      id: h.id,
      subject: subjectOf(h),
      assigned_date: toDate(h.startDate ?? h.date),
      due_date: toDate(h.endDate ?? h.dueDate),
      text: h.text || "",
      remark: h.remark || "",
      completed: !!h.completed,
      synced_at: new Date().toISOString(),
    })).filter((r: any) => r.id != null);

    // 4) Upsert (service role).
    const admin = createClient(SB_URL, SERVICE);
    if (rows.length) {
      const { error } = await admin.from("homework").upsert(rows, { onConflict: "id" });
      if (error) return json({ error: "db upsert failed — " + error.message });
    }

    // 5) Class board copy of the same homework. Its own failure is reported, not fatal.
    let classHomework: { count: number; removed: number } | { error: string };
    try { classHomework = await syncClassHomework(admin, homeworks, lessons, subjectLong, classNames, end); }
    catch (e) { console.error("[webuntis-sync] class homework", e); classHomework = { error: String((e as Error)?.message || e) }; }

    // 6) Tests. A failure here must not hide the homework result above.
    let exams: { count: number; removed: number } | { error: string };
    try { exams = await syncExams(admin, elemId, elemType, subjectLong, classNames); }
    catch (e) { console.error("[webuntis-sync] exams", e); exams = { error: String((e as Error)?.message || e) }; }
    return json({ ok: true, count: rows.length, classHomework, exams });
  } catch (e) {
    console.error("[webuntis-sync]", e);
    return json({ error: String((e as Error)?.message || e) });
  }
});
