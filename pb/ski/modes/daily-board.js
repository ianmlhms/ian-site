/* The Dagesfuerderung board (28 Nov 2026): who did today's challenge. Server side: scripts/ski-daily-v1.sql (table ski_daily_scores, the
 * functions ski_daily_submit / ski_daily_board). The game cannot reach Supabase itself: like the cloud save and the MTB board it goes
 * through the arcade page (pixelbreak-records.js RPC bridge: parent.postMessage({__pbRpc}) -> {__pbRpcRes}), only for signed-in players.
 * Guests, a standalone page and test mode keep the challenge local (no request, a short hint in the board). Tiny: one row per player and day.
 *   time            value = the run (ms), shown m:ss.hh, lower is better; the better run of the day replaces the row
 *   stars / combo   value = the second of the (Luxembourg) day the challenge was completed (server clock): shown "um 14:32", the first is first */
const RPC_TIMEOUT_MS = 8000;
const CACHE_MS = 45000;

export const fmtBoardValue = (kind, value) => {
  if (!Number.isFinite(value)) return '';
  if (kind === 'time') {
    const cs = Math.floor(value / 10), s = Math.floor(cs / 100), m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  }
  const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60);
  return `um ${h}:${String(m).padStart(2, '0')}`;
};

/** A board answer (rows of ski_daily_board) as { rows: [{ rank, name, value, me }], total, me: row | null }; null when it is not one. */
export function readBoard(data, kind) {
  if (!Array.isArray(data)) return null;
  const rows = [];
  let total = 0;
  for (const r of data.slice(0, 12)) {
    if (!r || typeof r !== 'object' || !Number.isInteger(r.rank) || r.rank < 1 || !Number.isFinite(r.value)) continue;
    rows.push({ rank: r.rank, name: String(r.username || '?').slice(0, 18), value: r.value, me: r.is_self === true });
    if (Number.isInteger(r.total) && r.total > total) total = r.total;
  }
  return { kind, rows, total, me: rows.find((r) => r.me) || null };
}

/** The client over the arcade's RPC bridge. env is injectable for tests. */
export function createDailyBoard(env = {}) {
  const win = env.win || (typeof window !== 'undefined' ? window : null);
  const parent = env.parent !== undefined ? env.parent : win && win.parent;
  const standalone = !win || !parent || parent === win;
  const origin = (win && win.location && win.location.origin) || '';
  const target = origin && origin !== 'null' ? origin : '*';
  const setT = env.setTimeout || ((f, ms) => setTimeout(f, ms)), clearT = env.clearTimeout || ((t) => clearTimeout(t));
  const now = env.now || (() => Date.now());
  const pending = new Map();
  const cache = new Map();
  let nextId = 0;
  const onMessage = (event) => {
    if (standalone || event.source !== parent || (target !== '*' && event.origin !== origin)) return;
    const res = event.data && typeof event.data === 'object' ? event.data.__pbRpcRes : null;
    const req = res && typeof res === 'object' ? pending.get(res.id) : null;
    if (!req) return;
    clearT(req.timer); pending.delete(res.id);
    if (res.error) req.reject(new Error(String(res.error))); else req.resolve(res.data);
  };
  if (win && !standalone) win.addEventListener('message', onMessage);
  const testMode = () => !!(win && win.__pbTestMode === true);
  function rpc(fn, args) {
    return new Promise((resolve, reject) => {
      if (standalone) { reject(new Error('signed-out')); return; }
      const id = `skid-${++nextId}`;
      const timer = setT(() => { pending.delete(id); reject(new Error('timeout')); }, RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try { parent.postMessage({ __pbRpc: { id, fn, args } }, target); } catch (error) { clearT(timer); pending.delete(id); reject(error); }
    });
  }
  return {
    get available() { return !standalone; },
    /** The board of a day and kind: { rows, total, me } or { error: 'guest' | 'offline' } (cached for a short while). */
    async board(day, kind) {
      if (standalone) return { error: 'guest' };
      const key = `${day}/${kind}`, hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_MS) return hit.value;
      try {
        const out = readBoard(await rpc('ski_daily_board', { p_day: day, p_kind: kind }), kind) || { error: 'offline' };
        if (!out.error) cache.set(key, { at: now(), value: out });
        return out;
      } catch (error) {
        return { error: /not signed in|signed-out|forbidden/i.test(error.message) ? 'guest' : 'offline' };
      }
    },
    /** A finished challenge: ('time': ms + board id of the piste; the others: nothing, the server clock decides). true when a row was written. */
    async submit({ day, kind, ms = null, board = null }) {
      if (standalone || testMode() || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !['time', 'stars', 'combo'].includes(kind)) return false;
      const args = { p_day: day, p_kind: kind };
      if (kind === 'time') {
        if (!Number.isInteger(ms) || ms <= 0 || typeof board !== 'string' || !/^ski-[a-z0-9]+-/.test(board)) return false;
        args.p_value = ms; args.p_board = board;
      }
      try {
        const done = await rpc('ski_daily_submit', args);
        cache.clear();
        return done === true;
      } catch (error) {
        if (!/not signed in|signed-out|forbidden|test-mode/i.test(error.message)) console.warn('[ski] daily board: not sent', error.message);
        return false;
      }
    },
    destroy() { if (win && !standalone) win.removeEventListener('message', onMessage); for (const r of pending.values()) clearT(r.timer); pending.clear(); },
  };
}

let shared = null;
/** The page's one client. */
export const dailyBoard = () => shared || (shared = createDailyBoard());

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** The board as HTML: the top 10 and your place (a gap row when you are outside them). */
export function boardHtml(b, kind) {
  if (!b) return '<p class="m">Klassement gëtt gelueden …</p>';
  if (b.error === 'guest') return '<p class="m">Mell dech am Arcade un, dann stees du am Klassement. Ouni Kont bleift d\'Dagesfuerderung nëmme bei dir.</p>';
  if (b.error) return '<p class="m">D\'Klassement ass grad net erreechbar.</p>';
  if (!b.rows.length) return '<p class="m">Nach keen fäerdeg haut. Sief deen éischten!</p>';
  const rows = [];
  let prev = 0;
  for (const r of b.rows) {
    if (prev && r.rank > prev + 1) rows.push('<li class="gap">…</li>');
    rows.push(`<li class="${r.me ? 'me' : ''}" data-rank="${r.rank}"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}${r.me ? ' (du)' : ''}</span><span class="vl">${esc(fmtBoardValue(kind, r.value))}</span></li>`);
    prev = r.rank;
  }
  return `<ol class="dbrows">${rows.join('')}</ol><p class="m dbfoot">${b.total} ${b.total === 1 ? 'huet' : 'hunn'} haut gemaach${b.me ? ` · Du bass ${b.me.rank}.` : ''}</p>`;
}

/** Fills `box` with the board of today's challenge `ch` ({ day, type }); a failed request leaves the hint text. */
export async function mountDailyBoard(box, ch, client = dailyBoard()) {
  if (!box || !ch) return;
  box.innerHTML = boardHtml(null, ch.type);
  const b = await client.board(ch.day, ch.type);
  if (!box.isConnected) return;
  box.innerHTML = boardHtml(b, ch.type);
  box.dataset.state = b.error ? b.error : 'ready';
}
