/* traffic.html: everything the traffic log knows beyond the daily totals (site_traffic.details, game_players_daily,
 * game_activity(), org_visits) and, since the own counter exists, the Worker's /stats (cloudflare/ian-count): live visitors, the last
 * visits and every day from the first full day it has data. Older days stay GoatCounter's (site_traffic). All of it is admin-read on
 * the server; every value is written as text, never as HTML. If the Worker is down the page shows the old data. */
const OWN_STATS_URL = 'https://ian-count.ianlu.workers.dev/stats';
const OWN_TIMEOUT_MS = 8000;
const OWN_CACHE_MS = 20_000;
const LIVE_POLL_MS = 30_000;
const DAY_MS = 86_400_000;
const PERIODS = [{ id: '1', label: 'Haut', days: 1 }, { id: '7', label: '7 Deeg', days: 7 }, { id: '30', label: '30 Deeg', days: 30 }];
const SHORT_LIST = 10;
const LISTS = [
  { key: 'pages', title: 'All Säiten', label: 'path' },
  { key: 'entries', title: 'Éischt Säit vun enger Visitt', countsVisits: true },
  { key: 'exits', title: 'Lescht Säit vun enger Visitt', countsVisits: true },
  { key: 'steps', title: 'Weeër vu Säit zu Säit' },
  { key: 'refs', title: 'Vu wou si kommen' },
  { key: 'countries', title: 'Länner' },
  { key: 'regions', title: 'Regiounen' },
  { key: 'systems', title: 'Systemer' },
  { key: 'system_versions', title: 'System-Versiounen' },
  { key: 'browsers', title: 'Browser' },
  { key: 'browser_versions', title: 'Browser-Versiounen' },
  { key: 'screens', title: 'Apparater' },
  { key: 'screen_sizes', title: 'Ecransgréissten' },
  { key: 'devices', title: 'Typ vun Apparat', own: true },
  { key: 'languages', title: 'Sproochen', own: true },
  { key: 'timezones', title: 'Zäitzonen', own: true },
  { key: 'event_names', title: 'Aktiounen (z. B. Spill gewonnen)', own: true },
  { key: 'companies', title: 'Firmen (eegen Zielung)', own: true },
  { key: 'providers', title: 'Internet-Provider (eegen Zielung)', own: true },
];
const DURATION_ORDER = ['<10 s', '10-60 s', '1-5 min', '5-15 min', '15-60 min', '> 1 h'];
const DEPTH_ORDER = ['1', '2', '3', '4', '5+'];
const number = new Intl.NumberFormat('de-LU', { maximumFractionDigits: 1 });
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function luxDay(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Luxembourg' }).format(new Date(Date.now() - offset * DAY_MS));
}

function shortDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat('de-LU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

/** Adds the days' lists up: label -> { views, visits } sorted by visits. Pure. */
export function mergeLists(rows, key, labelKey = 'name') {
  const totals = new Map();
  rows.forEach((row) => {
    const list = isRecord(row.details) && Array.isArray(row.details[key]) ? row.details[key] : [];
    list.forEach((item) => {
      if (!isRecord(item) || typeof item[labelKey] !== 'string') return;
      const old = totals.get(item[labelKey]) ?? { views: 0, visits: 0 };
      totals.set(item[labelKey], { views: old.views + count(item.views), visits: old.visits + count(item.visits) });
    });
  });
  return Array.from(totals, ([label, sums]) => ({ label, ...sums }))
    .sort((a, b) => b.visits - a.visits || b.views - a.views || a.label.localeCompare(b.label));
}

/** Adds the days' { label: number } records up. Pure. */
export function mergeCounts(rows, key) {
  return rows.reduce((sum, row) => {
    const part = isRecord(row.details) && isRecord(row.details[key]) ? row.details[key] : {};
    return Object.entries(part).reduce((acc, [label, n]) => ({ ...acc, [label]: (acc[label] ?? 0) + count(n) }), sum);
  }, {});
}

/** [[views, visits] x 24]. Pure. */
export function mergeHours(rows) {
  return Array.from({ length: 24 }, (_, hour) => rows.reduce(([views, visits], row) => {
    const part = isRecord(row.details) && Array.isArray(row.details.hours) ? row.details.hours[hour] : null;
    return Array.isArray(part) ? [views + count(part[0]), visits + count(part[1])] : [views, visits];
  }, [0, 0]));
}

/** The day after the own counter's first day (that day was only partly counted), or '' while there is none. Pure. */
export function ownFromDay(own, today) {
  const first = isRecord(own) && typeof own.first_day === 'string' ? own.first_day : '';
  if (!first || first >= today) return '';
  return new Date(Date.parse(`${first}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

const isOwnDay = (row) => isRecord(row) && typeof row.day === 'string' && Number.isFinite(row.visits) && Number.isFinite(row.views) && isRecord(row.details);

/** site_traffic rows (raw table shape) with every day from ownFrom replaced by the own counter's numbers. Pure. */
export function applyOwn(rows, own, today) {
  const ownFrom = ownFromDay(own, today);
  if (!ownFrom || !Array.isArray(own.days)) return { rows, ownFrom: '' };
  const mine = own.days.filter((day) => isOwnDay(day) && day.day >= ownFrom);
  const stamp = Number.isFinite(own.ts) ? new Date(own.ts).toISOString() : null;
  const converted = mine.map((day) => ({
    day: day.day, unique_visitors: day.visits, pageviews: day.views, updated_at: stamp, source: 'own',
    top_pages: (Array.isArray(day.details.pages) ? day.details.pages : []).filter((p) => isRecord(p) && typeof p.path === 'string')
      .sort((a, b) => count(b.views) - count(a.views)).slice(0, 10).map((p) => ({ path: p.path, views: count(p.views) })),
    details: day.details,
  }));
  const taken = new Set(converted.map((row) => row.day));
  // days from ownFrom on that the own counter has no row for had no visitors: GoatCounter's number for them is not mixed in
  const older = rows.filter((row) => row.day < ownFrom).map((row) => ({ ...row, source: 'goatcounter' }));
  return { rows: [...older, ...converted].sort((a, b) => a.day.localeCompare(b.day)), ownFrom, taken };
}

const ownCache = new Map();

/** The Worker's answer, or null (down, slow, not signed in, odd answer). `only` = 'live' asks for just the live + recent lists. Never throws. */
export async function fetchOwnStats(supabase, only = '') {
  const cached = ownCache.get(only);
  if (cached && Date.now() - cached.at < OWN_CACHE_MS) return cached.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OWN_TIMEOUT_MS);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const query = new URLSearchParams({ from: luxDay(29), to: luxDay(0), ...(only ? { only } : {}) });
    const response = await fetch(`${OWN_STATS_URL}?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) throw new Error(`own stats answered ${response.status}`);
    const value = await response.json();
    if (!isRecord(value) || !isRecord(value.live)) throw new Error('own stats answer has no live part');
    ownCache.set(only, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn('own counter unavailable, showing GoatCounter data', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function livePanel() {
  const box = panel('Elo online', 'Op der Säit an de leschte 5 Minutten');
  box.id = 'liveBox';
  box.classList.add('panel-wide');
  return box;
}

function recentPanel() {
  const box = panel('Lescht Visitten', 'Déi lescht 100, ouni Numm an ouni IP');
  box.classList.add('panel-wide');
  box.id = 'recentBox';
  return box;
}

const clock = (value) => new Intl.DateTimeFormat('de-LU', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Luxembourg' }).format(new Date(value));
const stripPanelBody = (box) => { Array.from(box.children).slice(1).forEach((child) => child.remove()); };

/** Fills the two live panels from /stats (values as text only). `own` null = the Worker did not answer. */
export function fillLive(root, own) {
  const live = root.querySelector('#liveBox');
  const recent = root.querySelector('#recentBox');
  if (live) {
    stripPanelBody(live);
    if (!own) live.append(el('p', 'empty-inline', 'D\'eegen Zielung äntwert net, déi al Zuele stinn drënner.'));
    else {
      const sessions = Array.isArray(own.live?.sessions) ? own.live.sessions : [];
      live.append(el('p', 'td-facts', `${number.format(count(own.live?.count))} ${count(own.live?.count) === 1 ? 'Persoun' : 'Leit'} elo op der Säit`));
      if (own.capped) live.append(el('p', 'empty-inline', 'Haut ass d\'Zielungs-Limit erreecht: et gëtt näischt méi gezielt bis Mëtternuecht.'));
      if (sessions.length) {
        barList(live, Array.from(sessions.reduce((map, s) => map.set(String(s.path), (map.get(String(s.path)) ?? 0) + 1), new Map()),
          ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), (item) => number.format(item.value));
      }
    }
  }
  if (recent) {
    stripPanelBody(recent);
    const visits = Array.isArray(own?.recent) ? own.recent : [];
    if (!visits.length) recent.append(el('p', 'empty-inline', own ? 'Nach keng Visitten.' : 'D\'eegen Zielung äntwert net.'));
    else {
      recent.append(table(['Wéini', 'Land', 'Apparat', 'Browser', 'Firma / Provider', 'Éischt Säit', 'Säiten', 'Sek.'],
        visits.slice(0, 100).map((v) => [clock(v.time), v.country || '·', v.device || '·', v.browser || '·', v.who || '·', v.entry || '·',
          Array.isArray(v.pages) ? v.pages.join(' › ') : '', count(v.seconds)])));
    }
  }
}

function sourceNote(ownFrom) {
  return el('p', 'td-note', ownFrom
    ? `Ab ${shortDay(ownFrom)} kommen d'Zuele vun der eegener Zielung (ian-count: eng zoufälleg ID nëmmen am Tab, keng Cookien, keng IP). Virdru ware se vu GoatCounter, wou iPaden am selwechte Netz zesummegezielt goufen.`
    : 'Nach keng ganz Dag vun der eegener Zielung: all Zuele kommen elo nach vu GoatCounter.');
}

function panel(title, sub) {
  const box = el('section', 'panel');
  const head = el('div', 'panel-heading');
  const wrap = el('div');
  if (sub) wrap.append(el('span', 'eyebrow', sub));
  wrap.append(el('h3', '', title));
  head.append(wrap);
  box.append(head);
  return box;
}

function barList(box, items, format) {
  if (!items.length) { box.append(el('p', 'empty-inline', 'Keng Donnéeën an dësem Zäitraum.')); return; }
  const max = Math.max(1, ...items.map((item) => item.value));
  const list = el('ol', 'td-list');
  items.forEach((item, index) => {
    const li = el('li', 'td-row');
    if (index >= SHORT_LIST) li.hidden = true;
    const bar = el('i', 'td-bar');
    bar.style.width = `${((100 * item.value) / max).toFixed(1)}%`;
    const name = el('span', 'td-name', item.label);
    name.title = item.label;
    li.append(bar, name, el('span', 'td-num', format(item)));
    list.append(li);
  });
  box.append(list);
  if (items.length > SHORT_LIST) {
    const more = el('button', 'td-more', `All ${items.length} weisen`);
    more.type = 'button';
    more.addEventListener('click', () => { list.querySelectorAll('li').forEach((li) => { li.hidden = false; }); more.remove(); });
    box.append(more);
  }
}

function hoursPanel(rows) {
  const box = panel('Stonnen vum Dag', 'Visitte pro Stonn');
  const hours = mergeHours(rows);
  const max = Math.max(1, ...hours.map(([, visits]) => visits));
  const chart = el('div', 'td-hours');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', hours.map(([, v], h) => `${h} Auer: ${v}`).join(', '));
  hours.forEach(([views, visits], hour) => {
    const col = el('div', 'td-hour');
    col.title = `${hour}:00 – ${visits} Visitten, ${views} Säitenopruffer`;
    const bar = el('i');
    bar.style.height = `${((100 * visits) / max).toFixed(1)}%`;
    col.append(bar, el('span', '', hour % 3 === 0 ? String(hour) : ''));
    chart.append(col);
  });
  box.append(chart);
  return box;
}

function shapePanel(rows) {
  const box = panel('Wéi laang a wéi vill Säiten', 'Form vun de Visitten');
  const visits = rows.reduce((sum, row) => sum + row.visits, 0);
  const views = rows.reduce((sum, row) => sum + row.views, 0);
  const onePage = rows.reduce((sum, row) => sum + count(row.details?.one_page_visits), 0);
  const seconds = rows.reduce((sum, row) => sum + count(row.details?.average_seconds) * row.visits, 0);
  const bots = rows.reduce((sum, row) => sum + count(row.details?.bots), 0);
  const facts = el('p', 'td-facts', visits
    ? `${number.format(views / visits)} Säite pro Visitt · ${number.format(seconds / visits / 60)} min am Duerchschnëtt · ${Math.round((100 * onePage) / visits)} % kucken nëmmen eng Säit · ${bots} Botten net matgezielt`
    : 'Keng Visitten an dësem Zäitraum.');
  box.append(facts);
  const durations = mergeCounts(rows, 'durations'), depth = mergeCounts(rows, 'depth');
  barList(box, [
    ...DEPTH_ORDER.filter((k) => depth[k]).map((k) => ({ label: k === '1' ? '1 Säit' : `${k} Säiten`, value: depth[k] })),
    ...DURATION_ORDER.filter((k) => durations[k]).map((k) => ({ label: k, value: durations[k] })),
  ], (item) => number.format(item.value));
  return box;
}

function table(headers, rows) {
  const wrap = el('div', 'td-table');
  const node = el('table');
  const head = el('tr');
  headers.forEach((h) => head.append(el('th', '', h)));
  node.append(head);
  rows.forEach((cells) => {
    const tr = el('tr');
    cells.forEach((cell) => tr.append(el('td', '', String(cell))));
    node.append(tr);
  });
  wrap.append(node);
  return wrap;
}

function playersPanel(players, days) {
  const box = panel('Spiller pro Spill', 'Ageloggte Konten pro Dag');
  box.classList.add('panel-wide');
  const shown = days.slice(0, 7);
  const games = new Map();
  players.forEach((row) => { if (shown.includes(row.day)) games.set(row.game_id, (games.get(row.game_id) ?? 0) + row.players); });
  const order = [...games.keys()].sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : games.get(b) - games.get(a) || a.localeCompare(b)));
  const value = (day, game) => players.find((row) => row.day === day && row.game_id === game)?.players ?? 0;
  if (!order.length) box.append(el('p', 'empty-inline', 'Keng Donnéeën an dësem Zäitraum.'));
  else box.append(table(['Spill', ...shown.map(shortDay)], order.slice(0, 40).map((game) => [game === '*' ? 'Alleguer (verschidde Konten)' : game, ...shown.map((day) => value(day, game) || '·')])));
  return box;
}

function activityPanel(activity) {
  const box = panel('Wien huet wat gespillt', 'Ageloggte Konten, 180 Deeg gespäichert');
  box.classList.add('panel-wide');
  if (!activity.length) box.append(el('p', 'empty-inline', 'Keng Donnéeën an dësem Zäitraum.'));
  else box.append(table(['Dag', 'Konto', 'Spiller'], activity.slice(0, 300).map((row) => [shortDay(row.day), row.username, (row.games ?? []).join(', ')])));
  return box;
}

function orgPanel(orgs, kind, title, sub) {
  const box = panel(title, sub);
  box.classList.add('panel-wide');
  const rows = orgs.filter((row) => row.kind === kind);
  if (!rows.length) { box.append(el('p', 'empty-inline', 'Nach keng an dësem Zäitraum.')); return box; }
  const time = (value) => new Intl.DateTimeFormat('de-LU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Luxembourg' }).format(new Date(value));
  const keys = (value) => (isRecord(value) ? Object.keys(value).join(', ') : '');
  box.append(table(['Numm', 'Land', 'Visitten', 'Säiten', 'Vu wou', 'Fir d\'lescht'],
    rows.slice(0, 100).map((row) => [row.org, row.country || '·', row.visits, keys(row.pages), keys(row.refs) || '·', time(row.last_at)])));
  return box;
}

async function load(supabase) {
  const since = luxDay(29);
  const [traffic, players, activity, orgs] = await Promise.all([
    supabase.from('site_traffic').select('day,unique_visitors,pageviews,details').gte('day', since).order('day', { ascending: false }),
    supabase.from('game_players_daily').select('day,game_id,players').gte('day', since).order('day', { ascending: false }).limit(1000),
    supabase.rpc('game_activity', { p_days: 14 }),
    supabase.from('org_visits').select('day,org,kind,country,visits,pages,refs,last_at').gte('day', since).order('last_at', { ascending: false }).limit(500),
  ]);
  [['site_traffic', traffic], ['game_players_daily', players], ['game_activity', activity], ['org_visits', orgs]].forEach(([name, answer]) => {
    if (answer.error) console.error(`traffic details: ${name}`, answer.error);
  });
  if (traffic.error) throw traffic.error;
  return {
    traffic: (traffic.data ?? []).map((row) => ({ day: row.day, unique_visitors: row.unique_visitors, pageviews: row.pageviews, details: isRecord(row.details) ? row.details : {} })),
    players: players.data ?? [], activity: activity.data ?? [], orgs: orgs.data ?? [],
  };
}

function render(root, data, period) {
  const since = luxDay(period.days - 1);
  const inPeriod = (row) => row.day >= since;
  const rows = data.traffic.filter(inPeriod);
  const goatOrgs = data.orgs.filter((row) => !data.ownFrom || row.day < data.ownFrom);       // the company log of the old Supabase function
  const ownRows = rows.filter((row) => row.source === 'own');
  const days = Array.from({ length: Math.max(7, period.days) }, (_, i) => luxDay(i));
  const bar = el('div', 'td-periods');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Zäitraum');
  PERIODS.forEach((p) => {
    const button = el('button', p.id === period.id ? 'on' : '', p.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(p.id === period.id));
    button.addEventListener('click', () => render(root, data, p));
    bar.append(button);
  });
  const grid = el('div', 'dashboard-grid');
  grid.append(
    livePanel(), recentPanel(),
    orgPanel(goatOrgs.filter(inPeriod), 'company', 'Firmen op der Homepage (bis ' + (data.ownFrom ? shortDay(data.ownFrom) : 'elo') + ')', 'Nëmmen d\'Firma, ni eng Persoun oder IP'),
    playersPanel(data.players, days),
    activityPanel(data.activity.filter(inPeriod)),
    hoursPanel(rows), shapePanel(rows),
    ...LISTS.filter(({ own, key }) => !own || ownRows.some((row) => Array.isArray(row.details[key]) && row.details[key].length)).map(({ key, title, label, countsVisits }) => {
      const box = panel(title);
      barList(box, mergeLists(rows, key, label).map((item) => ({ ...item, value: item.visits || item.views })),
        (item) => (countsVisits ? number.format(item.visits) : `${number.format(item.visits)} / ${number.format(item.views)}`));
      return box;
    }),
    orgPanel(goatOrgs.filter(inPeriod), 'provider', 'Internet-Provider op der Homepage (bis ' + (data.ownFrom ? shortDay(data.ownFrom) : 'elo') + ')', 'Doheem, Handy a Schoul'),
  );
  root.replaceChildren(bar, el('p', 'td-note', 'Zuelen an de Lëschten: Visitten / Säitenopruffer. Eng Visitt gëtt an all Dag eemol gezielt.'), sourceNote(data.ownFrom), grid);
  fillLive(root, lastOwn ?? data.own);
}

let loaded = false;                                 // once per page view: the hourly refresh would fetch ~0.5 MB from Supabase each time
let pollTimer = 0;
let lastOwn = null;                                 // newest /stats answer, so a period switch does not redraw old live numbers

/** Live panels refresh by themselves every 30 s while the tab is visible (a small answer from the Worker, never Supabase). */
function startLivePolling(root, supabase) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible' || !root.isConnected) return;
    lastOwn = (await fetchOwnStats(supabase, 'live')) ?? lastOwn;
    fillLive(root, lastOwn);
  }, LIVE_POLL_MS);
}

export async function showTrafficDetails(root, supabase) {
  if (loaded) return;
  loaded = true;
  try {
    const [data, own] = await Promise.all([load(supabase), fetchOwnStats(supabase)]);
    const merged = applyOwn(data.traffic, own, luxDay(0));
    data.traffic = merged.rows.map((row) => ({
      day: row.day, visits: count(row.unique_visitors), views: count(row.pageviews),
      details: isRecord(row.details) ? row.details : {}, source: row.source ?? 'goatcounter',
    }));
    data.ownFrom = merged.ownFrom;
    data.own = own;
    lastOwn = own;
    render(root, data, PERIODS[1]);
    startLivePolling(root, supabase);
  } catch (error) {
    loaded = false;                                 // the next refresh tries again
    console.error('traffic details failed', error);
    root.replaceChildren(el('p', 'empty-inline', 'D\'Detailer konnten net gelueden ginn.'));
  }
}
