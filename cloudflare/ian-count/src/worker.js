// ian-count Worker. POST /hit (public, always 204) and GET /stats (Ian only). Everything is validated, bot-filtered and flood-limited HERE,
// before the Durable Object is touched: the free plan's request budget is shared with ianlu-inbox (the live Messenger).
// Never stored or logged: the address, the full user agent, query strings (except the arcade's g), the Supabase token.
import { parseHit, parseUserAgent, isBot, luxDay, luxHour, allowedOrigins, isDay, addDays, MAX_BODY } from './parse.js';
import { isPublicIp, maskIp, orgFromRdap } from './org.js';
import { bearer, isAdmin } from './auth.js';

const RDAP = 'https://rdap.db.ripe.net/ip/';
const LOOKUP_TIMEOUT_MS = 4000;
const MAX_RANGE_DAYS = 400;
const LIMITS = { perSidPerMinute: 24, perIsolatePerMinute: 900, rdapPerMinute: 20, objectCallsPerMinute: 600, statsPerMinute: 30 };
const CAPPED_PAUSE_MS = 5 * 60_000;
const STATS_CACHE_MS = 20_000;

// ---- in-isolate state (flood limits and the capped flag; nothing here is personal) -------------------------------------
const windows = new Map();                  // name -> { start, count }
const sidWindows = new Map();               // sid -> { start, count }
let cappedUntil = 0;
const statsCache = new Map();               // "from|to|only" -> { at, body }

function over(name, limit, now) {
  const w = windows.get(name);
  if (!w || now - w.start > 60_000) { windows.set(name, { start: now, count: 1 }); return false; }
  w.count += 1;
  return w.count > limit;
}
function sidOver(sid, now) {
  if (sidWindows.size > 2000) sidWindows.clear();
  const w = sidWindows.get(sid);
  if (!w || now - w.start > 60_000) { sidWindows.set(sid, { start: now, count: 1 }); return false; }
  w.count += 1;
  return w.count > LIMITS.perSidPerMinute;
}
export const resetState = () => { windows.clear(); sidWindows.clear(); statsCache.clear(); cappedUntil = 0; };

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') ?? '';
  const ok = allowedOrigins(env).has(origin);
  return {
    ...(ok ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function lookUpOrg(ip) {
  if (!isPublicIp(ip)) return null;
  const response = await fetch(RDAP + encodeURIComponent(maskIp(ip)), {
    headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) { await response.body?.cancel(); return null; }
  return orgFromRdap(await response.json());
}

const cut = (value, max) => String(value ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);

/** Everything the Durable Object gets: clean facts only. */
async function buildRow(hit, request, now) {
  const cf = request.cf ?? {};
  const ua = request.headers.get('user-agent') ?? '';
  const row = {
    ...hit, ts: now, day: luxDay(now), hour: luxHour(now),
    country: /^[A-Z]{2}$/.test(cf.country ?? '') ? cf.country : '',
    region: cut(cf.region, 40),                         // region only: never the city
    provider: cut(cf.asOrganization, 60),
    ...parseUserAgent(ua, hit.tp),
  };
  if (hit.kind === 'view' && hit.first && isPublicIp(request.headers.get('cf-connecting-ip') ?? '') && !over('rdap', LIMITS.rdapPerMinute, now)) {
    try {
      const found = await lookUpOrg(request.headers.get('cf-connecting-ip'));
      if (found) { row.org = found.org; row.orgKind = found.kind; }
    } catch { /* the register is down or slow: the visit is counted without a company */ }
  }
  return row;
}

async function handleHit(request, env, ctx) {
  const now = Date.now();
  const empty = new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (!allowedOrigins(env).has(request.headers.get('origin') ?? '')) return empty;
  if (now < cappedUntil || over('isolate', LIMITS.perIsolatePerMinute, now)) return empty;
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return empty;
  const hit = parseHit(text);
  if (!hit || sidOver(hit.sid, now)) return empty;
  const stub = env.COUNT.get(env.COUNT.idFromName('main'), { locationHint: 'weur' });
  if (over('object', LIMITS.objectCallsPerMinute, now)) return empty;
  const ua = request.headers.get('user-agent') ?? '';
  ctx.waitUntil((async () => {
    try {
      if (isBot(ua)) {
        if (hit.kind === 'view') await stub.bot(now);
        return;
      }
      const result = await stub.hit(await buildRow(hit, request, now));
      if (result === 'capped') cappedUntil = Date.now() + CAPPED_PAUSE_MS;
    } catch (error) { console.error('ian-count: hit failed', error instanceof Error ? error.message : 'error'); }
  })());
  return empty;
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function handleStats(request, env) {
  const headers = corsHeaders(request, env);
  const now = Date.now();
  if (over('stats', LIMITS.statsPerMinute, now)) return json({ error: 'slow down' }, 429, headers);
  if (!(await isAdmin(bearer(request), env))) return json({ error: 'unauthorized' }, 401, headers);
  const url = new URL(request.url);
  const today = luxDay(now);
  const to = url.searchParams.get('to') ?? today;
  const from = url.searchParams.get('from') ?? addDays(to, -29);
  const only = url.searchParams.get('only') === 'live' ? 'live' : '';
  if (!isDay(from) || !isDay(to) || from > to || Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000) return json({ error: 'bad range' }, 400, headers);
  const key = `${from}|${to}|${only}`;
  const cached = statsCache.get(key);
  if (cached && now - cached.at < STATS_CACHE_MS) return json(cached.body, 200, headers);
  try {
    const body = await env.COUNT.get(env.COUNT.idFromName('main'), { locationHint: 'weur' }).stats(from, to, only);
    if (statsCache.size > 20) statsCache.clear();
    statsCache.set(key, { at: now, body });
    return json(body, 200, headers);
  } catch (error) {
    console.error('ian-count: stats failed', error instanceof Error ? error.message : 'error');
    return json({ error: 'unavailable' }, 503, headers);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (pathname === '/hit' && request.method === 'POST') return handleHit(request, env, ctx);
    if (pathname === '/stats' && request.method === 'GET') return handleStats(request, env);
    return new Response(null, { status: 404, headers: corsHeaders(request, env) });
  },
};
