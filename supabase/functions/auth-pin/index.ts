// Supabase Edge Function: auth-pin.
// PINs are verified only by service-role SQL functions.
import {
  LOGIN_ERROR,
  LoginPayload,
  PinRecord,
  cleanString,
  isLocked,
  loginPayload,
  loginPinValid,
  normalizeAction,
  validPin,
} from "./logic.ts";

import {
  Account,
  accountFromUser,
  allowIp,
  callerIsAdmin,
  failAccount,
  isLegacy,
  isRecoverySession,
  magicToken,
  passwordSession,
  pinRecord,
  resetAccount,
  resetPinForAdmin,
  resolveAccount,
  savePin,
  userFromRequest,
  verifyPin,
} from "./service.ts";

const NIL_USER = "00000000-0000-0000-0000-000000000000";
const DUMMY_PIN = "000000";

const CORS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json",
    },
  });
}

function loginFailure(): Response {
  return json(LOGIN_ERROR, 401);
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
  } catch (error) {
    console.error("auth-pin json", error);
    return null;
  }
}

function timingCredential(payload: LoginPayload): string {
  if (payload.pin !== undefined) {
    return loginPinValid(payload.pin) ? payload.pin : DUMMY_PIN;
  }
  return payload.password || DUMMY_PIN;
}

async function pinLogin(
  account: Account,
  pin: string,
): Promise<Response> {
  if (!loginPinValid(pin)) {
    await verifyPin(NIL_USER, DUMMY_PIN);
    return loginFailure();
  }
  const record = await pinRecord(account.id);
  if (!record || isLocked(record)) {
    await verifyPin(NIL_USER, pin);
    return loginFailure();
  }
  const valid = await verifyPin(account.id, pin);
  if (!valid) {
    await failAccount(account.id);
    return loginFailure();
  }
  await resetAccount(account.id);
  try {
    return json({ hashed_token: await magicToken(account) });
  } catch (error) {
    console.error("auth-pin magic link", error);
    return loginFailure();
  }
}

async function passwordLogin(
  account: Account,
  password: string,
): Promise<Response> {
  if (!await isLegacy(account)) {
    await verifyPin(NIL_USER, password);
    return loginFailure();
  }
  const record = await pinRecord(account.id);
  if (record === undefined || (record && isLocked(record))) {
    await verifyPin(NIL_USER, password);
    return loginFailure();
  }
  const session = await passwordSession(account, password);
  if (!session) {
    if (record) await failAccount(account.id);
    return loginFailure();
  }
  await resetAccount(account.id);
  return json({ session });
}

async function login(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload = loginPayload(body);
  if (!payload) return loginFailure();
  const timing = timingCredential(payload);
  if (!await allowIp(request, payload.identifier)) {
    await verifyPin(NIL_USER, timing);
    return loginFailure();
  }
  if (payload.pin !== undefined &&
      !loginPinValid(payload.pin)) {
    await verifyPin(NIL_USER, DUMMY_PIN);
    return loginFailure();
  }
  const account = await resolveAccount(payload.identifier);
  if (!account) {
    await verifyPin(NIL_USER, timing);
    return loginFailure();
  }
  if (payload.pin !== undefined) {
    return pinLogin(account, payload.pin);
  }
  return passwordLogin(account, payload.password || "");
}

async function pinProof(
  account: Account,
  record: PinRecord,
  credential: string,
): Promise<boolean> {
  if (isLocked(record)) {
    await verifyPin(NIL_USER, DUMMY_PIN);
    return false;
  }
  let valid = false;
  if (loginPinValid(credential)) {
    valid = await verifyPin(account.id, credential);
  }
  if (!valid && await isLegacy(account)) {
    valid = Boolean(await passwordSession(account, credential));
  }
  if (!valid) {
    await failAccount(account.id);
    return false;
  }
  await resetAccount(account.id);
  return true;
}

async function mayReplacePin(
  request: Request,
  body: Record<string, unknown>,
  account: Account,
  record: PinRecord,
): Promise<boolean> {
  const recovery = body.recovery === true &&
    isRecoverySession(request, account);
  if (recovery) return true;
  const credential = cleanString(body.currentCredential, 1024);
  if (!credential) return false;
  return pinProof(account, record, credential);
}

async function setPin(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const account = accountFromUser(user);
  if (!account) return json({ error: "unauthorized" }, 401);
  const length = body.length;
  if (!validPin(body.pin, length)) {
    return json({ error: "invalid_pin" }, 400);
  }
  const record = await pinRecord(user.id);
  if (record === undefined) {
    return json({ error: "set_failed" }, 500);
  }
  if (record &&
      !await mayReplacePin(request, body, account, record)) {
    return json({ error: "current_required" }, 403);
  }
  if (!await savePin(user.id, body.pin, length)) {
    return json({ error: "set_failed" }, 500);
  }
  return json({ ok: true });
}

async function status(request: Request): Promise<Response> {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "unauthorized" }, 401);
  const account = accountFromUser(user);
  if (!account) return json({ error: "unauthorized" }, 401);
  const record = await pinRecord(account.id);
  if (record === undefined) {
    return json({ error: "status_failed" }, 500);
  }
  return json({
    hasPin: Boolean(record),
    isLegacy: await isLegacy(account),
  });
}

async function adminReset(
  request: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const caller = await userFromRequest(request);
  if (!caller) return json({ error: "unauthorized" }, 401);
  if (!await callerIsAdmin(request)) {
    return json({ error: "forbidden" }, 403);
  }
  const username = cleanString(body.username, 24);
  if (!username) return json({ error: "invalid_username" }, 400);
  const result = await resetPinForAdmin(caller.id, username);
  if (!result) {
    return json({ error: "user_not_found" }, 404);
  }
  return json({
    ok: true,
    username: result.username,
    recovery_url: result.recoveryUrl,
  });
}

async function route(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: "method" }, 405);
  }
  const body = await readBody(request);
  if (!body) return json({ error: "bad_json" }, 400);
  const action = normalizeAction(body.action);
  if (action === "login") return login(request, body);
  if (action === "set") return setPin(request, body);
  if (action === "status") return status(request);
  if (action === "admin-reset") {
    return adminReset(request, body);
  }
  return json({ error: "bad_action" }, 400);
}

Deno.serve(route);
