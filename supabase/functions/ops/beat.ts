/* The `beat` action: how a machine says "I'm alive". Pure parts only (secret
 * comparison, payload validation, row shape) so they can be tested without a
 * database; index.ts does the upsert.
 *
 * Contract:  POST /functions/v1/ops
 *   headers  apikey: <anon key>, content-type: application/json,
 *            x-beat-secret: <OPS_BEAT_SECRET>
 *   body     {"action":"beat","service":"brix"|"mini","detail":"<optional, ≤200 chars>"}
 *   reply    {"ok":true}                                                        */
import { SERVICES } from "./health.ts";

export const MAX_DETAIL = 200;
export const BEAT_EXPECT_SECONDS = 300;

const BEAT_KEYS = new Set(SERVICES.map((service) => service.key));
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

export type Beat = { service: string; detail: string | null };

/** Returns the validated beat, or an error message for a 400. */
export function parseBeat(payload: unknown): Beat | { error: string } {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const service = typeof body.service === "string" ? body.service : "";
  if (!BEAT_KEYS.has(service)) return { error: "Unknown service." };
  /* Control characters (incl. newlines) stripped: this text is shown on a page
   * and must stay one line. Non-strings are ignored rather than rejected so a
   * sender bug never costs a heartbeat. */
  const raw = typeof body.detail === "string" ? body.detail : "";
  // deno-lint-ignore no-control-regex
  const detail = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_DETAIL);
  return { service, detail: detail || null };
}

/** The `service_heartbeats` row for a beat. A beat IS the proof of life, so
 * last_ok_at moves with it and any earlier error is cleared. */
export function beatRow(beat: Beat, nowISO: string) {
  return {
    service: beat.service,
    kind: "daemon",
    beat_at: nowISO,
    last_ok_at: nowISO,
    updated_at: nowISO,
    status: "ok",
    detail: beat.detail ? { text: beat.detail } : null,
    last_error: null,
    last_error_at: null,
    expected_every_seconds: BEAT_EXPECT_SECONDS,
  };
}
