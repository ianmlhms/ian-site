// Supabase Edge Function: haerz-sync
// Lets Ian's Häerz iPhone app (WHOOP strap reader) drop an encrypted snapshot of its data into the private
// `haerz` bucket, so Claude on the Mac Mini can read it without a cable. The app encrypts every snapshot to a
// public key whose private half lives only on Ian's Macs: this function and the bucket only ever see ciphertext.
//
// Auth: header `x-haerz-key` must equal HAERZ_DEVICE_KEY (the app; can only add snapshots), or
// `x-haerz-admin-key` must equal HAERZ_ADMIN_KEY (the pull script on the Mac; can only read).
//
// Deploy (no JWT so the app can call it):
//   supabase functions deploy haerz-sync --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set HAERZ_DEVICE_KEY=<key> HAERZ_ADMIN_KEY=<key> --project-ref lvksqmgfwkfbblfsozfk
//
// POST JSON:
//   device: { "action": "begin", "size": 4812345 }
//           → { "upload_url": "<signed PUT url, 2 h>", "path": "snapshots/20261102T140501Z-ab12cd.hzs" }
//             (older snapshots beyond the newest KEEP are deleted first)
//   admin:  { "action": "latest" } → { "path", "size", "created_at", "download_url" (10 min) } or { "path": null }
//           { "action": "list" }   → { "snapshots": [{ "path", "size", "created_at" }] }

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEVICE_KEY = Deno.env.get("HAERZ_DEVICE_KEY") ?? "";
const ADMIN_KEY = Deno.env.get("HAERZ_ADMIN_KEY") ?? "";

const BUCKET = "haerz";
const FOLDER = "snapshots";
const KEEP = 8;
const MAX_BYTES = 45 * 1024 * 1024;
const DOWNLOAD_SECONDS = 600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function matches(given: string, expected: string): boolean {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Newest first: the names start with a UTC timestamp.
async function snapshots(admin: SupabaseClient) {
  const { data, error } = await admin.storage.from(BUCKET)
    .list(FOLDER, { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) throw new Error(`list: ${error.message}`);
  return (data ?? []).filter((o) => o.name.endsWith(".hzs")).map((o) => ({
    path: `${FOLDER}/${o.name}`,
    size: Number(o.metadata?.size ?? 0),
    created_at: o.created_at,
  }));
}

function snapshotPath(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const random = crypto.getRandomValues(new Uint8Array(3));
  return `${FOLDER}/${stamp}-${Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("")}.hzs`;
}

async function begin(admin: SupabaseClient, body: Record<string, unknown>) {
  const size = Number(body.size);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) return json({ error: "invalid size" }, 400);
  const old = (await snapshots(admin)).slice(KEEP - 1).map((s) => s.path);
  if (old.length) {
    const { error } = await admin.storage.from(BUCKET).remove(old);
    if (error) console.error("haerz prune", error.message);
  }
  const path = snapshotPath();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("haerz begin", error?.message);
    return json({ error: "could not prepare the upload" }, 500);
  }
  return json({ upload_url: data.signedUrl, path });
}

async function adminAction(admin: SupabaseClient, body: Record<string, unknown>) {
  const list = await snapshots(admin);
  if (body.action === "list") return json({ snapshots: list });
  if (body.action !== "latest") return json({ error: "unknown action" }, 400);
  const newest = list[0];
  if (!newest) return json({ path: null });
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(newest.path, DOWNLOAD_SECONDS);
  if (error || !data) return json({ error: "could not sign the download" }, 500);
  return json({ ...newest, download_url: data.signedUrl });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid json" }, 400);
  const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  try {
    const adminKey = req.headers.get("x-haerz-admin-key");
    if (adminKey !== null) {
      if (!matches(adminKey, ADMIN_KEY)) return json({ error: "forbidden" }, 403);
      return await adminAction(admin, body);
    }
    if (!matches(req.headers.get("x-haerz-key") ?? "", DEVICE_KEY)) return json({ error: "forbidden" }, 403);
    if (body.action !== "begin") return json({ error: "unknown action" }, 400);
    return await begin(admin, body);
  } catch (error) {
    console.error("haerz-sync", error instanceof Error ? error.message : error);
    return json({ error: "storage error" }, 500);
  }
});
