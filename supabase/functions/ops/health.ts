/* The service catalog and the health rules, kept apart from transport so the
 * arithmetic can be read (and reasoned about) on its own.
 *
 * The catalog lives here rather than in a database table on purpose: a seeded
 * row would need a `beat_at`, and `beat_at` defaults to now(), so seeding would
 * paint five services green before anything had ever reported. A service with
 * no row is a real state — "no report yet" — and the page must say exactly
 * that. See the honesty rule in the Mini Control Room note. */

export type ServiceKind = "daemon" | "scheduled";

export type ServiceSpec = {
  key: string;
  label: string;
  kind: ServiceKind;
  /** daemons: expected heartbeat period. scheduled: longest acceptable gap. */
  expectSeconds: number;
  what: string;
};

/* Health, worst last. `unknown` is deliberately NOT an error: nothing has
 * reported, which usually means OpsAgent is not deployed yet. */
export type Health = "unknown" | "ok" | "warn" | "missed" | "down";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/* A daemon is late once it has missed three reports in a row — one missed beat
 * is a slow poll or a blocked network call, not a dead process. */
const DAEMON_MISS_FACTOR = 3;

export const SERVICES: readonly ServiceSpec[] = Object.freeze([
  {
    key: "dailybriefing",
    label: "DailyBriefing",
    kind: "scheduled",
    /* Runs 07:00 and 18:00 Europe/Luxembourg, so the longest legitimate gap is
     * the overnight one (13 h). Allow an hour of slack on top. */
    expectSeconds: 14 * HOUR,
    what: "Twice-daily briefing → Telegram + iMessage",
  },
  {
    key: "planespotter",
    label: "PlaneSpotter",
    kind: "daemon",
    expectSeconds: 60,
    what: "ADS-B watch over Niederanven",
  },
  {
    key: "upstracker",
    label: "UPSTracker",
    kind: "daemon",
    expectSeconds: 60,
    what: "Parcel status → Telegram",
  },
  {
    key: "deckworker",
    label: "DeckWorker",
    kind: "daemon",
    /* Self-reports every 30 s. Matches HEARTBEAT_MAX_AGE_MS in _shared/studio.ts,
     * which is what decides free-vs-paid deck generation. */
    expectSeconds: 30,
    what: "€0 deck generation for the PPT builder",
  },
  {
    key: "shortsfactory",
    label: "ShortsFactory",
    kind: "scheduled",
    expectSeconds: 26 * HOUR,
    what: "Short-video render + upload",
  },
  {
    key: "opsagent",
    label: "OpsAgent",
    kind: "daemon",
    expectSeconds: 30,
    what: "Reports on everything above — the watcher",
  },
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
  kind: ServiceKind;
  what: string;
  health: Health;
  /** Human-readable reason, already resolved server-side. */
  reason: string;
  ageSeconds: number | null;
  lastBeatISO: string | null;
  lastOkISO: string | null;
  detail: unknown;
  lastError: string | null;
  lastErrorISO: string | null;
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

/** Pure: one service spec plus its row (or none) → a resolved health verdict. */
export function evaluate(
  spec: ServiceSpec, row: HeartbeatRow | undefined, nowMs: number,
): ServiceHealth {
  const beatAge = ageSeconds(row?.beat_at, nowMs);
  const okAge = ageSeconds(row?.last_ok_at, nowMs);
  const base = {
    key: spec.key,
    label: spec.label,
    kind: spec.kind,
    what: spec.what,
    ageSeconds: beatAge,
    lastBeatISO: row?.beat_at ?? null,
    lastOkISO: row?.last_ok_at ?? null,
    detail: row?.detail ?? null,
    lastError: row?.last_error ?? null,
    lastErrorISO: row?.last_error_at ?? null,
  };

  if (!row || beatAge === null) {
    return { ...base, health: "unknown", reason: "no report yet" };
  }

  if (spec.kind === "daemon") {
    const limit = spec.expectSeconds * DAEMON_MISS_FACTOR;
    if (beatAge > limit) {
      return { ...base, health: "down", reason: `no heartbeat for ${describeAge(beatAge)}` };
    }
  } else {
    /* A scheduled service is *supposed* to be absent between runs, so it is
     * judged on its last successful run, not on when it last checked in. */
    const sinceWork = okAge ?? beatAge;
    if (sinceWork > spec.expectSeconds) {
      return { ...base, health: "missed", reason: `last ran ${describeAge(sinceWork)} ago` };
    }
  }

  /* The agent itself can flag a live-but-broken service — a daemon whose feed
   * has gone empty is up and useless, which a heartbeat alone cannot show. */
  if (row.status === "error") {
    return { ...base, health: "down", reason: row.last_error || "reported an error" };
  }
  if (row.status === "warn") {
    return { ...base, health: "warn", reason: row.last_error || "reported a warning" };
  }

  const freshness = spec.kind === "daemon"
    ? `up, last beat ${describeAge(beatAge)} ago`
    : `last ran ${describeAge(okAge ?? beatAge)} ago`;
  return { ...base, health: "ok", reason: freshness };
}

export function evaluateAll(rows: HeartbeatRow[], nowMs: number): ServiceHealth[] {
  const byService = new Map(rows.map((row) => [row.service, row]));
  return SERVICES.map((spec) => evaluate(spec, byService.get(spec.key), nowMs));
}

/** Worst health present, for the one-glance summary at the top of the page. */
export function overallHealth(all: ServiceHealth[]): Health {
  const order: Health[] = ["down", "missed", "warn", "unknown", "ok"];
  for (const health of order) {
    if (all.some((service) => service.health === health)) return health;
  }
  return "ok";
}
