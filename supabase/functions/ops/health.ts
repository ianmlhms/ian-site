/* The two machines and the health rules, kept apart from transport so the
 * arithmetic can be read (and reasoned about) on its own.
 *
 * The catalog lives here rather than in a database table on purpose: a seeded
 * row would need a `beat_at`, and `beat_at` defaults to now(), so seeding would
 * paint a machine green before anything had ever reported. A machine with no
 * row is a real state — "no report yet" — and the page must say exactly that.
 *
 * Only machines are tracked, not the services on them: if brix answers, the
 * bots in its containers are running too. Each machine posts its own beat
 * (see beat.ts); the Mini additionally reports on brix's bots in its detail. */

export type ServiceSpec = {
  key: string;
  label: string;
  /** One line under the name on the tile. */
  what: string;
  /** Expected heartbeat period. */
  expectSeconds: number;
};

/* Health, worst last. `unknown` is deliberately NOT an error: nothing has
 * reported, which usually means the sender is not deployed yet. */
export type Health = "unknown" | "ok" | "warn" | "down";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/* A machine is down once it has missed three reports in a row — one missed beat
 * is a slow poll or a blocked network call, not a dead box. */
const MISS_FACTOR = 3;
const BEAT_EVERY_SECONDS = 5 * MINUTE;

export const SERVICES: readonly ServiceSpec[] = Object.freeze([
  { key: "brix", label: "brix", what: "Home server", expectSeconds: BEAT_EVERY_SECONDS },
  { key: "mini", label: "Mac Mini", what: "Always-on Mac", expectSeconds: BEAT_EVERY_SECONDS },
]);

export type HeartbeatRow = {
  service: string;
  beat_at?: string | null;
  last_ok_at?: string | null;
  status?: string | null;
  detail?: unknown;
  last_error?: string | null;
  last_error_at?: string | null;
  note?: string | null;
};

export type ServiceHealth = {
  key: string;
  label: string;
  what: string;
  health: Health;
  /** Human-readable reason, already resolved server-side. */
  reason: string;
  ageSeconds: number | null;
  lastBeatISO: string | null;
  /** The short free text the sender attached to its last beat, if any. */
  detailText: string | null;
  lastError: string | null;
};

function ageSeconds(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((nowMs - then) / 1000));
}

export function describeAge(seconds: number): string {
  if (seconds < MINUTE) return `${seconds}s`;
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < 24 * HOUR) {
    const hours = Math.floor(seconds / HOUR);
    const minutes = Math.floor((seconds % HOUR) / MINUTE);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.floor(seconds / (24 * HOUR))}d`;
}

/** `detail` is `{ text }` as written by `beat`; anything else is ignored. */
export function detailTextOf(detail: unknown): string | null {
  if (typeof detail === "string") return detail || null;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const text = (detail as Record<string, unknown>).text;
    if (typeof text === "string" && text) return text;
  }
  return null;
}

/** Pure: one machine spec plus its row (or none) → a resolved health verdict. */
export function evaluate(
  spec: ServiceSpec, row: HeartbeatRow | undefined, nowMs: number,
): ServiceHealth {
  const beatAge = ageSeconds(row?.beat_at, nowMs);
  const base = {
    key: spec.key,
    label: spec.label,
    what: spec.what,
    ageSeconds: beatAge,
    lastBeatISO: row?.beat_at ?? null,
    detailText: detailTextOf(row?.detail),
    lastError: row?.last_error ?? null,
  };

  if (!row || beatAge === null) {
    return { ...base, health: "unknown", reason: "no report yet" };
  }

  if (beatAge > spec.expectSeconds * MISS_FACTOR) {
    return { ...base, health: "down", reason: `no heartbeat for ${describeAge(beatAge)}` };
  }

  if (row.status === "error") {
    return { ...base, health: "down", reason: row.last_error || "reported an error" };
  }
  if (row.status === "warn") {
    return { ...base, health: "warn", reason: row.last_error || "reported a warning" };
  }

  return { ...base, health: "ok", reason: `up, last beat ${describeAge(beatAge)} ago` };
}

export function evaluateAll(rows: HeartbeatRow[], nowMs: number): ServiceHealth[] {
  const byService = new Map(rows.map((row) => [row.service, row]));
  return SERVICES.map((spec) => evaluate(spec, byService.get(spec.key), nowMs));
}

/** Worst health present, for the one-glance summary. */
export function overallHealth(all: ServiceHealth[]): Health {
  const order: Health[] = ["down", "warn", "unknown", "ok"];
  for (const health of order) {
    if (all.some((service) => service.health === health)) return health;
  }
  return "ok";
}
