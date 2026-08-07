import { createClient } from
  "npm:@supabase/supabase-js@2";

import {
  PinRecord,
  cleanString,
  normalizeIdentifier,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY",
) ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RECOVERY_REDIRECT = "https://ian.lu/";

const authOptions = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: authOptions,
});

export type Account = {
  id: string;
  email: string;
  createdAt: string;
};

export type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
};

type JwtAmr = {
  method?: string;
  timestamp?: number;
};

type JwtClaims = {
  sub?: string;
  amr?: JwtAmr[];
};

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function userFromRequest(
  request: Request,
): Promise<AuthUser | null> {
  const token = bearer(request);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export function accountFromUser(
  user: AuthUser,
): Account | null {
  const email = cleanString(user.email, 254).toLowerCase();
  const createdAt = cleanString(user.created_at, 80);
  if (!user.id || !email || !createdAt) return null;
  return Object.freeze({ id: user.id, email, createdAt });
}

export async function resolveAccount(
  identifier: string,
): Promise<Account | null> {
  const { data, error } = await admin.rpc(
    "lookup_pin_account",
    { p_identifier: identifier },
  );
  const row = data?.[0];
  if (error) {
    console.error("auth-pin account", error.message);
    return null;
  }
  if (!row?.account_id || !row?.account_email) return null;
  return Object.freeze({
    id: row.account_id,
    email: row.account_email,
    createdAt: row.account_created_at,
  });
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") || "unknown";
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function targetDigest(
  identifier: string,
): Promise<string> {
  return digest(`${SERVICE_KEY}:target:${identifier}`);
}

export async function allowIp(
  request: Request,
  identifier: string,
): Promise<boolean> {
  const ipKey = await digest(
    `${SERVICE_KEY}:ip:${requestIp(request)}`,
  );
  const targetKey = await targetDigest(identifier);
  const { data, error } = await admin.rpc("use_pin_ip", {
    p_key: ipKey,
    p_target: targetKey,
  });
  if (error) console.error("auth-pin throttle", error.message);
  return !error && data === true;
}

export async function pinRecord(
  userId: string,
): Promise<PinRecord | null | undefined> {
  const { data, error } = await admin.from("user_pins")
    .select("pin_length,failed_attempts,locked_until")
    .eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("auth-pin record", error.message);
    return undefined;
  }
  return data;
}

export async function verifyPin(
  userId: string,
  pin: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("verify_pin", {
    p_user: userId,
    p_pin: pin,
  });
  if (error) console.error("auth-pin verify", error.message);
  return !error && data === true;
}

export async function failAccount(
  userId: string,
): Promise<void> {
  const { error } = await admin.rpc("fail_pin", {
    p_user: userId,
  });
  if (error) console.error("auth-pin failure", error.message);
}

export async function resetAccount(
  userId: string,
): Promise<void> {
  const { error } = await admin.rpc("reset_pin_failures", {
    p_user: userId,
  });
  if (error) console.error("auth-pin reset", error.message);
}

export async function isLegacy(
  account: Account,
): Promise<boolean> {
  const { data, error } = await admin.from("pin_auth_meta")
    .select("launched_at").eq("id", 1).single();
  if (error || !data?.launched_at) {
    console.error("auth-pin meta", error?.message);
    return false;
  }
  return Date.parse(account.createdAt) <=
    Date.parse(data.launched_at);
}

export async function magicToken(
  account: Account,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: account.email,
  });
  const token = data?.properties?.hashed_token ?? "";
  if (error || !token) throw error || new Error("token");
  return token;
}

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: authOptions,
  });
}

export async function passwordSession(
  account: Account,
  password: string,
): Promise<{
  access_token: string;
  refresh_token: string;
} | null> {
  const result = await anonClient().auth.signInWithPassword({
    email: account.email,
    password,
  });
  const session = result.data.session;
  if (result.error || !session) return null;
  return Object.freeze({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}

function jwtClaims(request: Request): JwtClaims | null {
  const encoded = bearer(request).split(".")[1];
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      Math.ceil(base64.length / 4) * 4,
      "=",
    );
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isRecoverySession(
  request: Request,
  user: AuthUser,
): boolean {
  const claims = jwtClaims(request);
  if (claims?.sub !== user.id || !Array.isArray(claims.amr)) {
    return false;
  }
  return claims.amr.some((entry) => entry.method === "recovery");
}

function callerClient(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: authOptions,
    global: { headers: { Authorization: authorization } },
  });
}

export async function callerIsAdmin(
  request: Request,
): Promise<boolean> {
  const { data, error } = await callerClient(request)
    .rpc("is_admin");
  if (error) console.error("auth-pin is-admin", error.message);
  return !error && data === true;
}

export type AdminReset = {
  username: string;
  recoveryUrl: string;
};

async function recoveryLink(
  account: Account,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: account.email,
    options: { redirectTo: RECOVERY_REDIRECT },
  });
  const link = data?.properties?.action_link ?? "";
  if (error || !link) throw error || new Error("link");
  return link;
}

async function clearTargetThrottle(
  account: Account,
  username: string,
): Promise<boolean> {
  const targets = await Promise.all([
    targetDigest(username),
    targetDigest(account.email),
  ]);
  const { error } = await admin.from("pin_ip_throttle")
    .delete().overlaps("target_keys", targets);
  if (error) console.error("auth-pin throttle reset", error);
  return !error;
}

export async function resetPinForAdmin(
  adminId: string,
  username: unknown,
): Promise<AdminReset | null> {
  const normalized = normalizeIdentifier(username);
  if (!normalized || normalized.includes("@")) return null;
  const target = await resolveAccount(normalized);
  if (!target) return null;
  let recoveryUrl = "";
  try {
    recoveryUrl = await recoveryLink(target);
  } catch (error) {
    console.error("auth-pin recovery link", error);
    return null;
  }
  if (!await clearTargetThrottle(target, normalized)) {
    return null;
  }
  const { error } = await admin.rpc("admin_reset_pin", {
    p_admin: adminId,
    p_user: target.id,
    p_username: normalized,
  });
  if (error) {
    console.error("auth-pin admin reset", error.message);
    return null;
  }
  console.info("auth-pin admin reset", {
    adminId,
    targetId: target.id,
    username: normalized,
  });
  return Object.freeze({
    username: normalized,
    recoveryUrl,
  });
}

export async function savePin(
  userId: string,
  pin: string,
  length: number,
): Promise<boolean> {
  const { error } = await admin.rpc("set_pin", {
    p_user: userId,
    p_pin: pin,
    p_length: length,
  });
  if (error) console.error("auth-pin set", error.message);
  return !error;
}
