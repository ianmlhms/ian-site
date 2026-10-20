/* The `beat` action: how a machine says "I'm alive". Pure parts only (secret
 * comparison, payload validation, row shape) so they can be tested without a
 * database; index.ts does the upsert.
 *
 * Contract:  POST /functions/v1/ops
 *   headers  apikey: <anon key>, content-type: application/json,
 *            x-beat-secret: <OPS_BEAT_SECRET>
 *   body     {"action":"beat","service":"brix"|"mini"|"supabase","detail":"<optional, ≤200 chars>",
 *             "status":"ok"|"warn"|"error" (optional, default ok),
 *             "message":"<optional, ≤200 chars: why, shown when status is not ok>"}
 *   reply    {"ok":true}                                                        */
import { SERVICES } from "./health.ts";

export const MAX_DETAIL = 200;

const BEAT_KEYS = new Set(SERVICES.map((service) => service.key));
const EXPECT_SECONDS = new Map(SERVICES.map((service) => [service.key, service.expectSeconds]));
const STATUSES = new Set(["ok", "warn", "error"]);
const encoder = new TextEncoder();

/** Constant-time string equality. Both sides are hashed first so the loop
 * length is fixed and a length mismatch leaks nothing. Fails closed when the
 * expected secret is empty (i.e. the env var is unset). */
export async function secretsMatch(expected: string, given: string | null): Promise<boolean> {
  if (!expected || given === null) return false;
  const [a, b] = await Promise.all([expected, given].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
  ));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export type Beat = {
  service: string;
  detail: string | null;
  status: "ok" | "warn" | "error";
  message: string | null;
};

/** One line, no control characters, clipped. Non-strings become "". */
function oneLine(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  // deno-lint-ignore no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_DETAIL);
}

/** Returns the validated beat, or an error message for a 400. */
export function parseBeat(payload: unknown): Beat | { error: string } {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const service = typeof body.service === "string" ? body.service : "";
  if (!BEAT_KEYS.has(service)) return { error: "Unknown service." };
  /* Control characters (incl. newlines) stripped: this text is shown on a page
   * and must stay one line. Non-strings are ignored rather than rejected so a
   * sender bug never costs a heartbeat. An unknown status is ignored too (ok). */
  const detail = oneLine(body.detail);
  const message = oneLine(body.message);
  const status = typeof body.status === "string" && STATUSES.has(body.status)
    ? body.status as Beat["status"]
    : "ok";
  return { service, detail: detail || null, status, message: message || null };
}

/** The `service_heartbeats` row for a beat. A beat IS the proof of life, so
 * last_ok_at moves with it. The sender's own verdict (status/message) is
 * stored as given; an ok beat clears any earlier error. */
export function beatRow(beat: Beat, nowISO: string) {
  return {
    service: beat.service,
    kind: "daemon",
    beat_at: nowISO,
    last_ok_at: nowISO,
    updated_at: nowISO,
    status: beat.status,
    detail: beat.detail ? { text: beat.detail } : null,
    last_error: beat.status === "ok" ? null : beat.message,
    last_error_at: beat.status === "ok" ? null : nowISO,
    expected_every_seconds: EXPECT_SECONDS.get(beat.service) ?? null,
  };
}
