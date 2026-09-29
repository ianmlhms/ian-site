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
//   kind "chat" works like "guestbook" (text only).
//
// Remote management (v2) — the board always initiates; nothing can connect into it:
//   { "action": "status", "board", "version", "uptime_s", "online", "rssi", "sd_free_mb",
//     "pending", "last_error" } → { "done": true }
//   { "action": "poll", "board" } → { "commands": [ { "id", "kind", "payload", "url"? } ] }
//     (commands are created only by the admin on ian.lu/ianet.html; firmware commands carry a
//      short-lived signed download URL; the board must verify payload.sha256 before installing)
//   { "action": "done", "board", "command_id", "result" } → { "done": true }
//
// Admin actions for tools/push.py on Ian's Mac (v3) — header `x-ianet-admin-key` must equal
// IANET_ADMIN_KEY; the boards' device key can NOT use these:
//   { "action": "stage", "what": "sd"|"firmware", "sha256", "size" }
//       → { "object", "upload_url"? }   (no upload_url when the object already exists)
//   { "action": "enqueue", "board", "kind", "payload" } → { "id" }  (the SQL check validates payload)
//   { "action": "state", "board" } → { "status", "commands": [last 30] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEVICE_KEY = Deno.env.get("IANET_DEVICE_KEY") ?? "";
const ADMIN_KEY = Deno.env.get("IANET_ADMIN_KEY") ?? "";
const SHA_RE = /^[0-9a-f]{64}$/;
const MAX_SD_BYTES = 20 * 1024 * 1024;
const MAX_FIRMWARE_BYTES = 6 * 1024 * 1024;
const STATE_COMMANDS = 30;

const BUCKET = "ianet";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 500;
const MAX_NAME_CHARS = 80;
const MAX_AUTHOR_CHARS = 20;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOARD_RE = /^[a-z0-9_-]{1,32}$/;
const KINDS = new Set(["photo", "file", "guestbook", "chat"]);
const TEXT_KINDS = new Set(["guestbook", "chat"]);
const MAX_COMMANDS_PER_POLL = 10;
const FIRMWARE_URL_SECONDS = 600;
const MAX_RESULT_CHARS = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function matches(given: string, expected: string): boolean {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
const sameKey = (given: string) => matches(given, DEVICE_KEY);

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
  const adminKey = req.headers.get("x-ianet-admin-key");
  if (adminKey !== null) {
    if (!matches(adminKey, ADMIN_KEY)) return json({ error: "forbidden" }, 403);
    const adminBody = await req.json().catch(() => null);
    if (!adminBody || typeof adminBody !== "object") return json({ error: "invalid json" }, 400);
    return adminAction(createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } }), adminBody);
  }
  if (!sameKey(req.headers.get("x-ianet-key") ?? "")) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, 400);
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  if (body.action === "status" || body.action === "poll" || body.action === "done") {
    const board = String(body.board ?? "");
    if (!BOARD_RE.test(board)) return json({ error: "invalid board" }, 400);
    return manage(admin, board, body);
  }

  const id = String(body.id ?? "");
  if (!ID_RE.test(id)) return json({ error: "invalid id" }, 400);

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

  if (TEXT_KINDS.has(kind)) {
    const text = clean(body.text, MAX_TEXT_CHARS);
    if (!text) return json({ error: "empty text" }, 400);
    const { error } = await admin.from("ianet_items").upsert({
      id, board, kind, author, body: text, created_ms: createdMs, uploaded_at: new Date().toISOString(),
    });
    if (error) {
      console.error("ianet text item", kind, id, error.message);
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

const int = (value: unknown): number | null => (Number.isSafeInteger(value) ? value as number : null);

// deno-lint-ignore no-explicit-any
async function manage(admin: any, board: string, body: Record<string, unknown>): Promise<Response> {
  if (body.action === "status") {
    const { error } = await admin.from("ianet_status").upsert({
      board,
      version: clean(body.version, 40) || null,
      uptime_s: int(body.uptime_s),
      online: int(body.online),
      rssi: int(body.rssi),
      sd_free_mb: int(body.sd_free_mb),
      pending: int(body.pending),
      last_error: clean(body.last_error, MAX_RESULT_CHARS) || null,
      seen_at: new Date().toISOString(),
    });
    if (error) {
      console.error("ianet status", board, error.message);
      return json({ error: "status failed" }, 500);
    }
    return json({ done: true });
  }

  if (body.action === "poll") {
    const { data, error } = await admin.from("ianet_commands")
      .select("id, kind, payload").eq("board", board).is("done_at", null)
      .order("id", { ascending: true }).limit(MAX_COMMANDS_PER_POLL);
    if (error) {
      console.error("ianet poll", board, error.message);
      return json({ error: "poll failed" }, 500);
    }
    const commands = [];
    for (const command of data ?? []) {
      if (command.kind === "firmware" || command.kind === "sdfile") {
        const objectPath = command.kind === "firmware" ? command.payload.path : command.payload.object;
        const signed = await admin.storage.from(BUCKET).createSignedUrl(objectPath, FIRMWARE_URL_SECONDS);
        if (signed.error || !signed.data) {
          console.error("ianet firmware url", command.id, signed.error?.message);
          continue;
        }
        commands.push({ ...command, url: signed.data.signedUrl });
      } else {
        commands.push(command);
      }
    }
    if (commands.length) {
      const ids = commands.map((command) => command.id);
      const { error: markError } = await admin.from("ianet_commands")
        .update({ delivered_at: new Date().toISOString() }).in("id", ids).is("delivered_at", null);
      if (markError) console.error("ianet delivered", board, markError.message);
    }
    return json({ commands });
  }

  const commandId = int(body.command_id);
  if (commandId === null) return json({ error: "invalid command_id" }, 400);
  const { data, error } = await admin.from("ianet_commands")
    .update({ done_at: new Date().toISOString(), result: clean(body.result, MAX_RESULT_CHARS) || "ok" })
    .eq("id", commandId).eq("board", board).select("id");
  if (error) {
    console.error("ianet done", board, commandId, error.message);
    return json({ error: "done failed" }, 500);
  }
  if (!data?.length) return json({ error: "unknown command" }, 404);
  return json({ done: true });
}

// deno-lint-ignore no-explicit-any
async function adminAction(admin: any, body: Record<string, unknown>): Promise<Response> {
  if (body.action === "stage") {
    const sha256 = String(body.sha256 ?? "");
    const size = Number(body.size);
    const what = String(body.what ?? "");
    const limit = what === "firmware" ? MAX_FIRMWARE_BYTES : MAX_SD_BYTES;
    if (!SHA_RE.test(sha256) || !Number.isSafeInteger(size) || size < 0 || size > limit || !["sd", "firmware"].includes(what)) {
      return json({ error: "invalid stage" }, 400);
    }
    const object = what === "sd" ? `sd/${sha256}` : `firmware/${Date.now()}-${sha256.slice(0, 12)}.bin`;
    if (what === "sd") {
      const { data: existing } = await admin.storage.from(BUCKET).list("sd", { search: sha256, limit: 1 });
      if (existing?.some((item: { name: string }) => item.name === sha256)) return json({ object });
    }
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(object, { upsert: true });
    if (error || !data) {
      console.error("ianet stage", object, error?.message);
      return json({ error: "stage failed" }, 500);
    }
    return json({ object, upload_url: data.signedUrl });
  }

  const board = String(body.board ?? "");
  if (!BOARD_RE.test(board)) return json({ error: "invalid board" }, 400);

  if (body.action === "enqueue") {
    const kind = String(body.kind ?? "");
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const { data, error } = await admin.from("ianet_commands").insert({ board, kind, payload }).select("id").single();
    if (error) {
      console.error("ianet enqueue", board, kind, error.message);
      return json({ error: "rejected" }, 400);
    }
    return json({ id: data.id });
  }

  if (body.action === "state") {
    const [{ data: status }, { data: commands }] = await Promise.all([
      admin.from("ianet_status").select("*").eq("board", board).maybeSingle(),
      admin.from("ianet_commands").select("id, kind, payload, delivered_at, done_at, result")
        .eq("board", board).order("id", { ascending: false }).limit(STATE_COMMANDS),
    ]);
    return json({ status, commands });
  }
  return json({ error: "unknown action" }, 400);
}
