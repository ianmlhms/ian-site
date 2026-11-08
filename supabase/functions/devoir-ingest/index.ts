// Supabase Edge Function: devoir-ingest
// HomeworkBot (on brix) posts each homework result here: the row plus the solution / à-rendre PDFs
// (base64). The PDFs go to the private `devoirs` bucket, the row into public.homework_solutions.
// Only the admin can read them afterwards (RLS + storage policy, scripts/devoirs-v1.sql).
//
// Auth: header `x-devoir-secret` must equal env DEVOIR_INGEST_SECRET (fails closed when unset).
// Deploy: supabase functions deploy devoir-ingest --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//
// POST JSON: { homework_id: int, subject?, due_date? (YYYY-MM-DD), task_text?, status, summary?, ask?,
//              solution_pdf_b64?, handin_pdf_b64? }
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("DEVOIR_INGEST_SECRET") ?? "";

const BUCKET = "devoirs";
const STATUSES = new Set(["solved", "needs_scan", "nothing_to_do", "failed"]);
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_BODY_CHARS = 2 * Math.ceil((MAX_PDF_BYTES * 4) / 3) + 200_000;
const LIMITS = { subject: 200, task_text: 8000, summary: 4000, ask: 4000 } as const;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function optText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

function decodePdf(b64: unknown): Uint8Array | null | "bad" {
  if (b64 === undefined || b64 === null || b64 === "") return null;
  if (typeof b64 !== "string") return "bad";
  try {
    const bin = atob(b64);
    if (bin.length > MAX_PDF_BYTES || !bin.startsWith("%PDF")) return "bad";
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return "bad";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!SECRET || !SB_URL || !SB_SERVICE) return json({ error: "not configured" }, 503);
  if (!safeEqual(req.headers.get("x-devoir-secret") ?? "", SECRET)) return json({ error: "forbidden" }, 403);

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: "too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "bad body" }, 400);

  const id = body.homework_id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return json({ error: "homework_id" }, 400);
  const status = body.status;
  if (typeof status !== "string" || !STATUSES.has(status)) return json({ error: "status" }, 400);
  const due = body.due_date;
  if (due !== undefined && due !== null && (typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due))) {
    return json({ error: "due_date" }, 400);
  }
  const text: Record<string, string | null> = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = optText(body[k], max);
    if (v === undefined) return json({ error: k }, 400);
    text[k] = v;
  }
  const solution = decodePdf(body.solution_pdf_b64);
  const handin = decodePdf(body.handin_pdf_b64);
  if (solution === "bad" || handin === "bad") return json({ error: "pdf" }, 400);

  const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const row: Record<string, unknown> = {
    homework_id: id,
    subject: text.subject,
    due_date: due ?? null,
    task_text: text.task_text,
    status,
    summary: text.summary,
    ask: text.ask,
    updated_at: new Date().toISOString(),
  };
  for (const [field, bytes, name] of [["solution_path", solution, "solution.pdf"], ["handin_path", handin, "handin.pdf"]] as const) {
    if (!bytes) continue;
    const path = `${id}/${name}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) {
      console.error("upload failed", path, error.message);
      return json({ error: "upload" }, 502);
    }
    row[field] = path;
  }
  // `done` is not in `row`, so an upsert never resets it; an older path stays when no new PDF is sent.
  const { error } = await sb.from("homework_solutions").upsert(row, { onConflict: "homework_id" });
  if (error) {
    console.error("upsert failed", error.message);
    return json({ error: "db" }, 502);
  }
  return json({ ok: true });
});
