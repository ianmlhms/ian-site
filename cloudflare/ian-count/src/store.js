// The counter's database logic, written against the Durable Object's `sql.exec` so tests can run it on node:sqlite.
// Write budget (free plan: 100k rows/day for the whole account, shared with ianlu-inbox):
//   a view = hits row (1) + session insert (2: row + unique index) or update (1); a ping = 1 session update, no hits row.
//   Only today's rows are ever scanned; finished days are rolled into `daily` once and read from there.
import { aggregateDay } from './agg.js';
import { addDays, luxHour, TEST_SID } from './parse.js';

export const SCHEMA_VERSION = 1;
export const PING_ALLOWANCE = 2;       // rows counted extra per view for the pings that follow it
export const PURGE_BATCH = 4000;
export const TEST_MAX_AGE_MS = 10 * 60_000;
export const TODAY_CACHE_MS = 45_000;
export const LIVE_WINDOW_MS = 5 * 60_000;
export const LIVE_SCAN = 400;
export const RECENT_VISITS = 100;
const NOT_TEST = "sid NOT LIKE 'test-%'";

export class Store {
  constructor(sql, options = {}) {
    this.sql = sql;
    this.now = options.now ?? Date.now;
    this.rawDays = options.rawDays ?? 180;
    this.cap = options.cap ?? 40_000;
    this.writes = 0;                    // rows written by the current call
    this.knownDay = '';
    this.rolledFor = '';
    this.capDay = '';
    this.capCount = 0;
    this.todayCache = null;
  }

  init(schema) {
    this.sql.exec(schema);
  }

  run(query, ...bindings) {
    const cursor = this.sql.exec(query, ...bindings);
    const rows = cursor.toArray();
    this.writes += cursor.rowsWritten ?? 0;
    return rows;
  }

  // ---- daily write cap -------------------------------------------------------------------------------------
  loadCap(day) {
    if (this.capDay === day) return;
    const row = this.run("SELECT v FROM meta WHERE k = 'cap'")[0];
    const [savedDay, savedCount] = row ? String(row.v).split(':') : ['', '0'];
    this.capDay = day;
    this.capCount = savedDay === day ? Number(savedCount) || 0 : 0;
    this.writes = 0;
  }

  isCapped(day) {
    this.loadCap(day);
    return this.capCount >= this.cap;
  }

  /** Adds this call's writes to the day's count. Views, events and bots save the counter (1 extra row, and PING_ALLOWANCE rows stand
   * in for the pings that visit will send); a ping only adds to the in-memory count, which the next saving call writes out.
   * So pings that die with a sleeping object are not counted - the cap is a safety net with a wide margin to the free limit. */
  account(day, isPing = false) {
    this.capCount += this.writes + (isPing ? 0 : PING_ALLOWANCE);
    this.writes = 0;
    if (isPing) return;
    this.run("INSERT INTO meta (k, v) VALUES ('cap', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", `${day}:${this.capCount}`);
    this.capCount += this.writes;
    this.writes = 0;
    if (this.capCount >= this.cap && this.knownDay === day) {
      this.run('UPDATE days SET capped = 1 WHERE day = ? AND capped = 0', day);
      this.writes = 0;
    }
  }

  // ---- days ------------------------------------------------------------------------------------------------
  ensureDay(day) {
    if (this.knownDay === day) return;
    this.run(`INSERT OR IGNORE INTO days (day, hit_from, sess_from)
              SELECT ?, COALESCE((SELECT MAX(id) FROM hits), 0) + 1, COALESCE((SELECT MAX(id) FROM sessions), 0) + 1`, day);
    this.knownDay = day;
  }

  // ---- writes ----------------------------------------------------------------------------------------------
  /** One page view, event or ping. `hit.day` / `hit.hour` are Luxembourg time. Returns 'capped' when the day's budget is spent. */
  record(hit) {
    if (this.isCapped(hit.day)) return 'capped';
    this.rollupPending(hit.day);
    this.ensureDay(hit.day);
    if (hit.kind === 'ping') {
      this.run('UPDATE sessions SET last_ts = MAX(last_ts, ?) WHERE sid = ? AND day = ?', hit.ts, hit.sid, hit.day);
    } else {
      const isView = hit.kind === 'view' ? 1 : 0;
      const path = isView ? hit.path : '';
      this.run(
        `INSERT INTO sessions (sid, day, first_ts, last_ts, hits, views, events, entry, exit, trail, org, org_kind, provider, country, region,
                               browser, bver, os, osver, device, screen, dpr, lang, tz, ref)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (sid, day) DO UPDATE SET
           last_ts = MAX(last_ts, excluded.last_ts), hits = hits + 1, views = views + excluded.views, events = events + excluded.events,
           entry = CASE WHEN entry = '' THEN excluded.entry ELSE entry END,
           exit = CASE WHEN excluded.views > 0 THEN excluded.exit ELSE exit END,
           trail = CASE WHEN excluded.views > 0 AND length(trail) < 1500 THEN trail || char(10) || excluded.exit ELSE trail END,
           org = CASE WHEN org = '' THEN excluded.org ELSE org END, org_kind = CASE WHEN org = '' THEN excluded.org_kind ELSE org_kind END,
           ref = CASE WHEN ref = '' THEN excluded.ref ELSE ref END`,
        hit.sid, hit.day, hit.ts, hit.ts, isView, 1 - isView, path, path, path,
        hit.org ?? '', hit.orgKind ?? '', hit.provider ?? '', hit.country ?? '', hit.region ?? '',
        hit.browser ?? '', hit.bver ?? '', hit.os ?? '', hit.osver ?? '', hit.device ?? '',
        hit.w && hit.h ? `${hit.w}x${hit.h}` : '', hit.dpr ?? 0, hit.lang ?? '', hit.tz ?? '', hit.ref ?? '');
      this.run('INSERT INTO hits (ts, day, hour, sid, path, title, kind, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        hit.ts, hit.day, hit.hour, hit.sid, hit.path, hit.title ?? '', hit.kind, hit.name ?? '');
    }
    this.todayCache = null;
    this.account(hit.day, hit.kind === 'ping');
    return 'ok';
  }

  recordBot(day) {
    if (this.isCapped(day)) return 'capped';
    this.ensureDay(day);
    this.run('UPDATE days SET bots = bots + 1 WHERE day = ?', day);
    this.account(day);
    return 'ok';
  }

  // ---- roll-up and purge -----------------------------------------------------------------------------------
  /** Days before `today` that still have raw rows only: compute their totals once and keep those forever. */
  rollupPending(today) {
    if (this.rolledFor === today) return;
    this.rolledFor = today;
    for (const { day } of this.run('SELECT day FROM days WHERE rolled = 0 AND day < ? ORDER BY day', today)) this.rollupDay(day);
  }

  dayRows(day, includeTest = false) {
    const row = this.run('SELECT * FROM days WHERE day = ?', day)[0];
    if (!row) return null;
    const next = this.run('SELECT hit_from, sess_from FROM days WHERE day > ? ORDER BY day LIMIT 1', day)[0];
    const filter = includeTest ? '' : ` AND ${NOT_TEST}`;
    const sessions = this.run(`SELECT * FROM sessions WHERE id >= ? AND id < ? AND day = ?${filter}`,
      row.sess_from, next?.sess_from ?? Number.MAX_SAFE_INTEGER, day);
    const hits = this.run(`SELECT hour, path, kind, name, sid FROM hits WHERE id >= ? AND id < ? AND day = ?${filter}`,
      row.hit_from, next?.hit_from ?? Number.MAX_SAFE_INTEGER, day);
    return { row, sessions, hits };
  }

  computeDay(day) {
    const rows = this.dayRows(day);
    if (!rows) return null;
    const { visits, views, details } = aggregateDay(rows.sessions, rows.hits, rows.row.bots);
    return { day, visits, views, details, capped: rows.row.capped === 1 };
  }

  rollupDay(day) {
    const value = this.computeDay(day);
    if (!value) return;
    this.run('INSERT OR REPLACE INTO daily (day, data) VALUES (?, ?)', day, JSON.stringify(value));
    this.run('UPDATE days SET rolled = 1 WHERE day = ?', day);
  }

  /** Raw rows older than rawDays and finished test rows go. Returns true when more is waiting (the alarm comes back sooner). */
  purge(today) {
    let more = false;
    const keepFrom = this.run('SELECT hit_from, sess_from FROM days WHERE day >= ? ORDER BY day LIMIT 1', addDays(today, -this.rawDays))[0];
    if (keepFrom) {
      const before = this.writes;
      this.run(`DELETE FROM hits WHERE id IN (SELECT id FROM hits WHERE id < ? LIMIT ${PURGE_BATCH})`, keepFrom.hit_from);
      this.run(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE id < ? LIMIT ${PURGE_BATCH})`, keepFrom.sess_from);
      more = this.writes - before >= PURGE_BATCH;
    }
    const recent = this.run('SELECT hit_from, sess_from FROM days ORDER BY day DESC LIMIT 2').at(-1);
    if (recent) {
      const cutoff = this.now() - TEST_MAX_AGE_MS;
      this.run("DELETE FROM hits WHERE id >= ? AND sid LIKE 'test-%' AND ts < ?", recent.hit_from, cutoff);
      this.run("DELETE FROM sessions WHERE id >= ? AND sid LIKE 'test-%' AND last_ts < ?", recent.sess_from, cutoff);
    }
    this.todayCache = null;
    this.account(today);
    return more;
  }

  // ---- reads -----------------------------------------------------------------------------------------------
  today(day) {
    const now = this.now();
    if (this.todayCache?.day === day && now - this.todayCache.at < TODAY_CACHE_MS) return this.todayCache.value;
    const value = this.computeDay(day);
    this.todayCache = { day, at: now, value };
    return value;
  }

  live() {
    const now = this.now();
    const rows = this.run(`SELECT last_ts, first_ts, exit, country, device, browser FROM sessions WHERE ${NOT_TEST} ORDER BY id DESC LIMIT ${LIVE_SCAN}`);
    const sessions = rows.filter((s) => s.last_ts >= now - LIVE_WINDOW_MS)
      .map((s) => ({ path: s.exit, country: s.country, device: s.device, browser: s.browser, seconds: Math.round((s.last_ts - s.first_ts) / 1000) }));
    return { count: sessions.length, window_seconds: LIVE_WINDOW_MS / 1000, sessions };
  }

  recent() {
    return this.run(`SELECT first_ts, last_ts, country, device, browser, org, org_kind, provider, entry, trail FROM sessions
                     WHERE ${NOT_TEST} ORDER BY id DESC LIMIT ${RECENT_VISITS}`).map((s) => ({
      time: s.first_ts, country: s.country, device: s.device, browser: s.browser,
      who: s.org || s.provider || '', who_kind: s.org ? s.org_kind : (s.provider ? 'provider' : ''),
      entry: s.entry, pages: s.trail.split('\n').filter(Boolean).slice(0, 12), seconds: Math.round((s.last_ts - s.first_ts) / 1000),
    }));
  }

  /** `only` = 'live' answers just the two small lists (the page polls that); otherwise the days too. */
  stats(from, to, today, only = '') {
    const out = { ts: this.now(), today, capped: this.isCapped(today) };
    out.live = this.live();
    out.recent = this.recent();
    if (only === 'live') return out;
    this.rollupPending(today);
    const days = this.run('SELECT data FROM daily WHERE day >= ? AND day <= ? ORDER BY day', from, to).map((r) => JSON.parse(r.data));
    if (from <= today && today <= to) {
      const current = this.today(today);
      if (current) days.push(current);
    }
    out.days = days;
    out.first_day = this.run('SELECT MIN(day) AS d FROM days')[0]?.d ?? null;
    return out;
  }
}

/** Hour helper kept here so counter.js and tests agree on how a timestamp becomes a row. */
export const hourOf = luxHour;
export { TEST_SID };
