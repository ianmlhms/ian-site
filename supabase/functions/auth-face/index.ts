// Supabase Edge Function: auth-face ("Mam Gesiicht aloggen"). verify_jwt ON.
//
// The face scan and the face match run in the player's browser; the face
// template never leaves that device. What this function sees is a random
// device key that the browser only sends after its own face check passed:
//   reauth { credential }            (signed in) -> { ok } when the PIN/password is right
//   enroll { credential, name }      (signed in) -> new device, returns { deviceId, secret } once
//   login  { deviceId, secret }      -> magic-link hash for a normal session
//                                       + a NEW secret (the old one is retired)
//   forget { deviceId, secret }      -> deletes that device
// Only SHA-256 hashes of device keys are stored (public.face_devices); the
// rules (expiry, rotation, replay = revoke, no admins) live in SQL, see
// scripts/security-fix-face-v2.sql.
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  accountFromUser,
  AuthUser,
  magicToken,
  userFromRequest,
} from "../auth-pin/service.ts";
import {
  checkError,
  credentialFrom,
  deviceName,
  deviceProof,
  hashSecret,
  isKartUser,
  newSecret,
  normalizeAction,
  sameDigest,
} from "./logic.ts";
import { reauthenticate } from "./reauth.ts";

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

/** The device row, only when the secret matches its CURRENT stored hash. */
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

async function isAdminUser(userId: string): Promise<boolean | null> {
  const { data, error } = await admin.rpc("face_user_is_admin", {
    p_user: userId,
  });
  if (error) {
    console.error("auth-face admin check", error.message);
    return null;
  }
  return data === true;
}

/** Signed-in caller (not a kart account), or the Response that refuses them. */
async function signedInCaller(
  request: Request,
): Promise<AuthUser | Response> {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (isKartUser(user)) return json({ error: "forbidden" }, 403);
  return user;
}

/** null when the PIN/password is right, else the Response that refuses. */
async function reauthFailure(
  user: AuthUser,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const result = await reauthenticate(user, credentialFrom(body));
  if (result === "ok") return null;
  if (result === "unavailable") return json({ error: "unavailable" }, 500);
  if (result === "locked") return json({ error: "reauth_locked" }, 403);
  return json({ error: "reauth_failed" }, 403);
}

async function reauth(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const caller = await signedInCaller(request);
  if (caller instanceof Response) return caller;
  return await reauthFailure(caller, body) ?? json({ ok: true });
}

async function enroll(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const caller = await signedInCaller(request);
  if (caller instanceof Response) return caller;
  // Admins first, so their PIN attempts are not spent on a refusal.
  const isAdmin = await isAdminUser(caller.id);
  if (isAdmin === null) return json({ error: "enroll_failed" }, 500);
  if (isAdmin) return json({ error: "admin_forbidden" }, 403);
  const refused = await reauthFailure(caller, body);
  if (refused) return refused;
  const secret = newSecret();
  const { data, error } = await admin.rpc("face_device_enroll", {
    p_user: caller.id,
    p_hash: await hashSecret(secret),
    p_name: deviceName(body.name),
  });
  if (error || typeof data !== "string") {
    console.error("auth-face enroll", error?.message);
    return json({ error: "enroll_failed" }, 500);
  }
  return json({ deviceId: data, secret });
}

type CheckRow = { result?: string; account?: string };

async function checkDevice(
  deviceId: string,
  digest: string,
): Promise<CheckRow | null> {
  const { data, error } = await admin.rpc("face_device_check", {
    p_device: deviceId,
    p_hash: digest,
  });
  if (error) {
    console.error("auth-face check", error.message);
    return null;
  }
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

async function rotate(
  deviceId: string,
  oldDigest: string,
  newDigest: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("face_device_rotate", {
    p_device: deviceId,
    p_old_hash: oldDigest,
    p_new_hash: newDigest,
  });
  if (error) console.error("auth-face rotate", error.message);
  return !error && data === true;
}

async function login(body: Record<string, unknown>): Promise<Response> {
  const proof = deviceProof(body);
  if (!proof) return json(LOGIN_ERROR, 401);
  const digest = await hashSecret(proof.secret);
  const check = await checkDevice(proof.deviceId, digest);
  if (!check) return json({ error: "login_failed" }, 500);
  if (check.result !== "ok" || !check.account) {
    if (check.result === "replayed") {
      console.warn("auth-face replayed secret, device revoked", {
        deviceId: proof.deviceId,
        userId: check.account,
      });
    }
    return json({ error: checkError(check.result) }, 401);
  }
  const { data, error } = await admin.auth.admin.getUserById(check.account);
  const user = data?.user;
  if (error || !user || isKartUser(user)) return json(LOGIN_ERROR, 401);
  const account = accountFromUser(user);
  if (!account) return json(LOGIN_ERROR, 401);
  let hashedToken: string;
  try {
    hashedToken = await magicToken(account);
  } catch (cause) {
    console.error("auth-face magic link", cause);
    return json({ error: "login_failed" }, 500);
  }
  // Only now swap the secret: a failed magic link leaves the old one valid.
  const next = newSecret();
  if (!await rotate(proof.deviceId, digest, await hashSecret(next))) {
    return json(LOGIN_ERROR, 401);
  }
  return json({ hashed_token: hashedToken, secret: next });
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
  if (action === "reauth") return reauth(request, body);
  if (action === "enroll") return enroll(request, body);
  if (action === "login") return login(body);
  if (action === "forget") return forget(body);
  return json({ error: "bad_action" }, 400);
}

Deno.serve(route);
