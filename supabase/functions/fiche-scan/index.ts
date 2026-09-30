// Supabase Edge Function: fiche-scan
// Receives one PDF from the scanner page (ian.lu/scan/, opened from a button in Ian's
// Slack channel #fiches) and posts it into #fiches as the "Ian Bots" app. SlackGate on brix
// recognises the "📷 Scan" marker on that upload and hands the pages to FicheBot, which
// files them like any photo Ian sends himself.
//
// Auth: header `x-scan-key` must equal the FICHE_SCAN_KEY secret (constant-time compare).
// The key reaches the page only through the Slack button (URL fragment, never sent to a server
// log) and is kept in the phone's localStorage.
//
// Deploy (no JWT: the page has no Supabase login):
//   supabase functions deploy fiche-scan --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set FICHE_SCAN_KEY=<key> SLACK_FICHES_BOT_TOKEN=<xoxb> \
//     SLACK_FICHES_CHANNEL=C0C5F4VKP6E --project-ref lvksqmgfwkfbblfsozfk
//
// POST multipart/form-data: file (application/pdf), pages (int), hint (optional text)
//   → { ok: true, file_id } | { ok: false, error }

const SCAN_KEY = Deno.env.get("FICHE_SCAN_KEY") ?? "";
const SLACK_TOKEN = Deno.env.get("SLACK_FICHES_BOT_TOKEN") ?? "";
const CHANNEL = Deno.env.get("SLACK_FICHES_CHANNEL") ?? "";
const SLACK_API = "https://slack.com/api";
const ALLOWED_ORIGINS = new Set(["https://ian.lu", "https://www.ian.lu"]);
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_PAGES = 200;
const MAX_HINT_CHARS = 120;
// SlackGate turns a bot upload whose comment starts with this into Ian's own message.
const SCAN_MARKER = "📷 Scan";
const PDF_MAGIC = "%PDF-";

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://ian.lu";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-scan-key",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
}

function reply(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function sameKey(given: string): boolean {
  if (!SCAN_KEY || given.length !== SCAN_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ SCAN_KEY.charCodeAt(i);
  return diff === 0;
}

const clean = (value: unknown, max: number): string =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function slackForm(method: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SLACK_TOKEN}` },
    body: new URLSearchParams(fields),
  });
  const body = await response.json() as Record<string, unknown>;
  if (body.ok !== true) throw new Error(`Slack ${method}: ${String(body.error ?? response.status)}`);
  return body;
}

async function postToSlack(pdf: Uint8Array, fileName: string, comment: string): Promise<string> {
  const ticket = await slackForm("files.getUploadURLExternal", {
    filename: fileName,
    length: String(pdf.byteLength),
  });
  const uploadUrl = String(ticket.upload_url ?? "");
  const fileId = String(ticket.file_id ?? "");
  if (!uploadUrl || !fileId) throw new Error("Slack gave no upload URL");
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: pdf,
  });
  if (!uploaded.ok) throw new Error(`Slack upload failed (HTTP ${uploaded.status})`);
  await slackForm("files.completeUploadExternal", {
    files: JSON.stringify([{ id: fileId, title: fileName }]),
    channel_id: CHANNEL,
    initial_comment: comment,
  });
  return fileId;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return reply({ ok: false, error: "POST only" }, 405, origin);
  if (!SCAN_KEY || !SLACK_TOKEN || !CHANNEL) {
    console.error("fiche-scan: missing secrets");
    return reply({ ok: false, error: "Scanner net configuréiert" }, 500, origin);
  }
  if (!sameKey(request.headers.get("x-scan-key") ?? "")) {
    // Read the body before answering: replying mid-upload leaves the phone's request hanging.
    await request.arrayBuffer().catch(() => undefined);
    return reply({ ok: false, error: "Schlëssel ongëlteg" }, 401, origin);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.error("fiche-scan: bad form", error);
    return reply({ ok: false, error: "Ongëlteg Upload" }, 400, origin);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return reply({ ok: false, error: "Keen PDF am Upload" }, 400, origin);
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return reply({ ok: false, error: "PDF ze grouss (max 30 MB)" }, 413, origin);
  }
  const pdf = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(pdf.slice(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
    return reply({ ok: false, error: "Dat ass keen PDF" }, 400, origin);
  }
  const pages = Math.min(Math.max(parseInt(String(form.get("pages") ?? "0"), 10) || 0, 0), MAX_PAGES);
  const hint = clean(form.get("hint"), MAX_HINT_CHARS);
  const fileName = clean(file.name, 80).replace(/[\\/:*?"<>|]/g, "") || "Scan.pdf";
  const pagesText = pages ? ` · ${pages} ${pages === 1 ? "page" : "pages"}` : "";
  const comment = `${SCAN_MARKER}${pagesText}${hint ? `\n${hint}` : ""}`;

  try {
    const fileId = await postToSlack(pdf, fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`, comment);
    console.log(`fiche-scan: posted ${fileId} (${pdf.byteLength} bytes, ${pages} pages)`);
    return reply({ ok: true, file_id: fileId }, 200, origin);
  } catch (error) {
    console.error("fiche-scan: slack failed", error);
    return reply({ ok: false, error: "Slack huet net geäntwert, probéier nach eng Kéier" }, 502, origin);
  }
});
