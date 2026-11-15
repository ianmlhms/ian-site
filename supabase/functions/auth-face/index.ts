// Supabase Edge Function: auth-face ("Mam Gesiicht aloggen").
//
// The face scan and the face match run in the player's browser; the face
// template never leaves that device. What this function sees is a random
// device key that the browser only sends after its own face check passed:
//   enroll (signed in)        -> new device row, returns { deviceId, secret } once
//   login  { deviceId, secret } -> magic-link hash for a normal Supabase session
//   forget { deviceId, secret } -> deletes that device row
// Only SHA-256 hashes of device keys are stored (public.face_devices).
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  accountFromUser,
  magicToken,
  userFromRequest,
} from "../auth-pin/service.ts";
import {
  deviceProof,
  devicesToDrop,
  hashSecret,
  isKartUser,
  newSecret,
  normalizeAction,
  sameDigest,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOGIN_ERROR = Object.freeze({ error: "invalid_login" });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const CORS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
  } catch (error) {
    console.error("auth-face json", error);
    return null;
  }
}

type DeviceRow = { id: string; user_id: string; secret_hash: string };

/** The device row, only when the secret matches its stored hash. */
async function provenDevice(
  body: Record<string, unknown>,
): Promise<DeviceRow | null> {
  const proof = deviceProof(body);
  if (!proof) return null;
  const digest = await hashSecret(proof.secret);
  const { data, error } = await admin.from("face_devices")
    .select("id,user_id,secret_hash").eq("id", proof.deviceId)
    .maybeSingle();
  if (error) {
    console.error("auth-face device", error.message);
    return null;
  }
  if (!data || !sameDigest(data.secret_hash, digest)) return null;
  return data;
}

async function enroll(request: Request): Promise<Response> {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (isKartUser(user)) return json({ error: "forbidden" }, 403);
  const { data: rows, error: listError } = await admin.from("face_devices")
    .select("id,created_at").eq("user_id", user.id);
  if (listError) {
    console.error("auth-face list", listError.message);
    return json({ error: "enroll_failed" }, 500);
  }
  const drop = devicesToDrop(rows ?? []);
  if (drop.length) {
    const { error } = await admin.from("face_devices").delete().in("id", drop);
    if (error) console.error("auth-face trim", error.message);
  }
  const secret = newSecret();
  const { data, error } = await admin.from("face_devices")
    .insert({ user_id: user.id, secret_hash: await hashSecret(secret) })
    .select("id").single();
  if (error || !data) {
    console.error("auth-face insert", error?.message);
    return json({ error: "enroll_failed" }, 500);
  }
  return json({ deviceId: data.id, secret });
}

async function login(body: Record<string, unknown>): Promise<Response> {
  const device = await provenDevice(body);
  if (!device) return json(LOGIN_ERROR, 401);
  const { data, error } = await admin.auth.admin.getUserById(device.user_id);
  const user = data?.user;
  if (error || !user || isKartUser(user)) return json(LOGIN_ERROR, 401);
  const account = accountFromUser(user);
  if (!account) return json(LOGIN_ERROR, 401);
  try {
    const hashedToken = await magicToken(account);
    const { error: touchError } = await admin.from("face_devices")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", device.id);
    if (touchError) console.error("auth-face touch", touchError.message);
    return json({ hashed_token: hashedToken });
  } catch (cause) {
    console.error("auth-face magic link", cause);
    return json({ error: "login_failed" }, 500);
  }
}

async function forget(body: Record<string, unknown>): Promise<Response> {
  const device = await provenDevice(body);
  // Already gone (or never valid) is the outcome the caller wants anyway.
  if (!device) return json({ ok: true });
  const { error } = await admin.from("face_devices").delete()
    .eq("id", device.id);
  if (error) {
    console.error("auth-face forget", error.message);
    return json({ error: "forget_failed" }, 500);
  }
  return json({ ok: true });
}

async function route(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const body = await readBody(request);
  if (!body) return json({ error: "bad_json" }, 400);
  const action = normalizeAction(body.action);
  if (action === "enroll") return enroll(request);
  if (action === "login") return login(body);
  if (action === "forget") return forget(body);
  return json({ error: "bad_action" }, 400);
}

Deno.serve(route);
