// Supabase Edge Function: ianet-upload
// Receives photos / files / guestbook entries from Ian's IanNet boards (ESP32) when a board
// has an uplink Wi-Fi. Upload-only: nothing is ever returned to the board except where to put
// the next file.
//
// Auth: header `x-ianet-key` must equal the IANET_DEVICE_KEY secret (constant-time compare).
// The boards cannot do a Supabase login; the key only allows adding IanNet items.
//
// Deploy (no JWT so the board can call it):
//   supabase functions deploy ianet-upload --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set IANET_DEVICE_KEY=<key> --project-ref lvksqmgfwkfbblfsozfk
//
// POST JSON:
//   { "action": "begin", "id": "…", "board": "ianet1", "kind": "photo"|"file"|"guestbook",
//     "name": "IMG.jpg", "author": "Ian", "text": "…", "size": 12345, "type": "image/jpeg",
//     "created_ms": 1790000000000 }
//     → guestbook: { "done": true }
//     → photo/file: { "upload_url": "<signed PUT url>", "path": "…" }  (board PUTs the bytes there)
//   { "action": "commit", "id": "…" } → { "done": true }   (after the PUT succeeded)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEVICE_KEY = Deno.env.get("IANET_DEVICE_KEY") ?? "";

const BUCKET = "ianet";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 500;
const MAX_NAME_CHARS = 80;
const MAX_AUTHOR_CHARS = 20;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOARD_RE = /^[a-z0-9_-]{1,32}$/;
const KINDS = new Set(["photo", "file", "guestbook"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function sameKey(given: string): boolean {
  if (!DEVICE_KEY || given.length !== DEVICE_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ DEVICE_KEY.charCodeAt(i);
  return diff === 0;
}

const clean = (value: unknown, max: number): string =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

// Basename only, no path or reserved characters, keep the extension.
function safeName(value: unknown): string {
  const base = clean(value, 200).split(/[\\/]/).pop() ?? "";
  const stripped = base.replace(/[:*?"<>|]/g, "").replace(/^\.+/, "");
  return stripped.slice(-MAX_NAME_CHARS) || "datei";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!sameKey(req.headers.get("x-ianet-key") ?? "")) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, 400);
  const id = String(body.id ?? "");
  if (!ID_RE.test(id)) return json({ error: "invalid id" }, 400);

  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  if (body.action === "commit") {
    const { error } = await admin.from("ianet_items")
      .update({ uploaded_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      console.error("ianet commit", id, error.message);
      return json({ error: "commit failed" }, 500);
    }
    return json({ done: true });
  }
  if (body.action !== "begin") return json({ error: "unknown action" }, 400);

  const board = String(body.board ?? "");
  const kind = String(body.kind ?? "");
  if (!BOARD_RE.test(board)) return json({ error: "invalid board" }, 400);
  if (!KINDS.has(kind)) return json({ error: "invalid kind" }, 400);
  const createdMs = Number.isSafeInteger(body.created_ms) ? body.created_ms : null;
  const author = clean(body.author, MAX_AUTHOR_CHARS) || null;

  if (kind === "guestbook") {
    const text = clean(body.text, MAX_TEXT_CHARS);
    if (!text) return json({ error: "empty text" }, 400);
    const { error } = await admin.from("ianet_items").upsert({
      id, board, kind, author, body: text, created_ms: createdMs, uploaded_at: new Date().toISOString(),
    });
    if (error) {
      console.error("ianet guestbook", id, error.message);
      return json({ error: "save failed" }, 500);
    }
    return json({ done: true });
  }

  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return json({ error: "invalid size" }, 400);
  const name = safeName(body.name);
  const path = `${board}/${kind}/${id}/${name}`;
  const { error: rowError } = await admin.from("ianet_items").upsert({
    id, board, kind, author, name, size_bytes: size, content_type: clean(body.type, 100) || null,
    storage_path: path, created_ms: createdMs,
  });
  if (rowError) {
    console.error("ianet begin row", id, rowError.message);
    return json({ error: "save failed" }, 500);
  }
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error("ianet signed url", id, error?.message);
    return json({ error: "upload url failed" }, 500);
  }
  return json({ upload_url: data.signedUrl, path });
});
