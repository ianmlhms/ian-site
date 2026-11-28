// Everything that turns a request into clean, bounded facts. Pure functions (tested in test/parse.test.mjs).
// Nothing here keeps an address, a full user agent or a query string (except the arcade's `g` and Ski Alpen's `r`).

export const MAX_BODY = 900;
export const MAX_PATH = 160;
export const TEST_SID = /^test-/;
const SID = /^[A-Za-z0-9_-]{8,40}$/;
const KINDS = new Set(['view', 'event', 'ping']);
const EVENT_NAME = /^[\w .:/-]{1,60}$/;
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const TZ = /^[A-Za-z0-9_+/-]{1,40}$/;
const ARCADE = '/pixelbreak.html';
const SKI = '/pb/ski.html';
const SKI_RESORT = /^[a-z0-9_-]{1,20}$/;
const GAME_ID = /^[A-Za-z0-9_-]{1,40}$/;

const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (value, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : 0;
};

/** '/a/b?x=1#y' -> '/a/b'; only the arcade keeps `?g=<id>` and Ski Alpen `?r=<resort>`. null when it is not a usable path. */
export function cleanPath(value) {
  if (typeof value !== 'string' || value[0] !== '/' || value[1] === '/') return null;
  const [beforeHash] = value.split('#');
  const [pathname, query = ''] = beforeHash.split('?');
  let path = clean(pathname, MAX_PATH).replace(/ /g, '%20');
  if (path === '/index.html') path = '/';
  if (!path || path[0] !== '/' || /[\\"']/.test(path)) return null;
  if (path === ARCADE) {
    const game = /(?:^|&)g=([^&]*)/.exec(query)?.[1];
    if (game && GAME_ID.test(game)) path += `?g=${game}`;
  } else if (path === SKI) {                       // Ski Alpen reports which resort is open as a virtual page: ?r=<resortId>
    const resort = /(?:^|&)r=([^&]*)/.exec(query)?.[1];
    if (resort && SKI_RESORT.test(resort)) path += `?r=${resort}`;
  }
  return path.slice(0, MAX_PATH);
}

/** A referrer URL reduced to its host; the site's own host and junk give ''. */
export function refHost(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 300) : '';
  if (!text) return '';
  try {
    const host = new URL(text).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,80}$/.test(host) && host !== 'ian.lu' ? host : '';
  } catch { return ''; }
}

/** The page's request body -> a clean hit, or null. Unknown fields are ignored on purpose. */
export function parseHit(text) {
  if (typeof text !== 'string' || text.length > MAX_BODY) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const kind = typeof body.kind === 'string' ? body.kind : 'view';
  if (!KINDS.has(kind) || typeof body.sid !== 'string' || !SID.test(body.sid)) return null;
  if (kind === 'ping') return { kind, sid: body.sid };
  const path = cleanPath(body.path);
  if (!path) return null;
  const name = kind === 'event' ? (typeof body.name === 'string' && EVENT_NAME.test(body.name) ? body.name : null) : '';
  if (name === null) return null;
  const dpr = Math.round(Number(body.dpr) * 10) / 10;
  return {
    kind, sid: body.sid, path, name,
    title: clean(body.title, 100),
    ref: refHost(body.ref),
    w: int(body.w, 20000), h: int(body.h, 20000),
    dpr: Number.isFinite(dpr) && dpr > 0 && dpr <= 10 ? dpr : 0,
    lang: typeof body.lang === 'string' && LANG.test(body.lang.slice(0, 20)) ? body.lang.slice(0, 20).toLowerCase() : '',
    tz: typeof body.tz === 'string' && TZ.test(body.tz) ? body.tz : '',
    tp: int(body.tp, 50),
    first: body.f === 1 || body.f === true,
  };
}

const BOT = /bot\b|bot[/ ;)]|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|facebookexternalhit|embedly|preview|monitor|curl\/|wget|python|node-fetch|undici|axios|go-http|java\/|okhttp|httpclient|libwww|scrapy|phantom|playwright|puppeteer|selenium|webdriver|http-client|apache-http|postman|insomnia|rss|feed|archive|fetch|bytespider|gptbot|claude|amazonbot|petalbot|semrush|ahrefs|mj12/i;

/** Crawlers, link previewers, scripts. An empty user agent counts as a bot. */
export function isBot(userAgent) {
  const ua = String(userAgent ?? '');
  return ua.length < 12 || BOT.test(ua);
}

const major = (value) => (value ? String(value).split('.')[0] : '');
const browserOf = (ua) => {
  const rules = [
    [/EdgiOS\/([\d.]+)|EdgA\/([\d.]+)|Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)|OPiOS\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'], [/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/, 'Firefox'],
    [/DuckDuckGo\/([\d.]+)/, 'DuckDuckGo'], [/Vivaldi\/([\d.]+)/, 'Vivaldi'], [/Brave\/([\d.]+)/, 'Brave'],
    [/CriOS\/([\d.]+)|Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari\//, 'Safari'],
  ];
  for (const [pattern, name] of rules) {
    const match = pattern.exec(ua);
    if (match) return { browser: name, bver: major(match.slice(1).find(Boolean)) };
  }
  return { browser: /Safari\//.test(ua) ? 'Safari' : 'Other', bver: '' };
};

/** Browser, OS and device class from the user agent; `touchPoints` tells an iPad (it calls itself a Mac) from a Mac. */
export function parseUserAgent(userAgent, touchPoints = 0) {
  const ua = String(userAgent ?? '').slice(0, 400);
  const { browser, bver } = browserOf(ua);
  let os = 'Other', osver = '', device = 'desktop';
  let match;
  if ((match = /\b(iPhone|iPod)\b.*?OS (\d+)[_.](\d+)/.exec(ua))) { os = 'iOS'; osver = `${match[2]}.${match[3]}`; device = 'phone'; }
  else if ((match = /iPad.*?OS (\d+)[_.](\d+)/.exec(ua))) { os = 'iPadOS'; osver = `${match[1]}.${match[2]}`; device = 'tablet'; }
  else if (/Macintosh/.test(ua) && touchPoints > 1) {
    os = 'iPadOS'; device = 'tablet';
    osver = /Version\/(\d+)\.(\d+)/.exec(ua)?.slice(1, 3).join('.') ?? '';
  } else if ((match = /Android (\d+(?:\.\d+)?)/.exec(ua))) { os = 'Android'; osver = match[1]; device = /Mobile/.test(ua) ? 'phone' : 'tablet'; }
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  return { browser, bver, os, osver, device };
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Luxembourg', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Luxembourg', hour: '2-digit', hourCycle: 'h23' });

/** The Luxembourg calendar day ('2026-11-25') and hour (0-23) of a timestamp in ms. */
export const luxDay = (ms) => dayFormat.format(new Date(ms));
export const luxHour = (ms) => Number(hourFormat.format(new Date(ms))) % 24;
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** Origin allowlist: the site, plus localhost only when the test variable names it. */
export function allowedOrigins(env) {
  return new Set([...(env.ALLOWED_ORIGINS ?? '').split(','), ...(env.TEST_ORIGINS ?? '').split(',')].map((o) => o.trim()).filter(Boolean));
}

/** Size class of a screen width: no odd size can single anybody out. */
export function screenClass(width) {
  if (!width) return '?';
  return width < 600 ? 'phone' : width < 1400 ? 'tablet / small laptop' : 'desktop';
}
