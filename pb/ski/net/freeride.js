/* R7-D: the online FREE RIDE (lobby setting mode = "free"): friends ski the whole ski area together, no clock, no race.
 * Same transport as the race (session.js: full mesh, WebRTC + the capped Realtime relay, presence with a nonce per page life) and the
 * same remote skiers (remotes.js: interpolated, in their own chair / cabin while riding a lift, decluttered name tags).
 *   - Everybody starts side by side at the resort's start lift (the same on every device: no saved piste decides it).
 *   - States go out at FREE.SEND_HZ while moving or riding (school Wi-Fi: 60 Mbit up, a state is ~150 bytes), FREE.IDLE_HZ standing.
 *   - Riding a lift = the wire's "riding lift X at s" (lift index of resort.json + metres along its line), never station geometry:
 *     every device draws the friend in his carrier on its own line, whatever lifts.js builds there.
 *   - Teleports (fast travel, a map jump, a lift skip, the restart spot) bump an epoch in the state message: the others snap him there
 *     (remotes.js also snaps any jump > 120 m), nobody sees a skier slide across the mountain.
 *   - Avalanches: a local trigger goes out as an event {id, seed, t}; the others run it with the same seed at the same moment (their
 *     clock), through the game's triggerAvalanche(id, seed, t) when it exists (round 7 C). Max one per player per FREE.AVALANCHE_GAP.
 *   - The host (the first roster player who is here: host handover as in the race) shares weather, time of day and the day clock.
 *   - Join / leave any time: a player who comes later or reloads appears where he is (his own last spot is kept per tab), a player who
 *     leaves goes after GONE; nobody waits for anybody.
 *   - Fair: a state only ever moves the player whose link it came over; nobody can move, stop or knock over somebody else (env and
 *     avalanches are world events, the env only from the current host). */
import { NET, FREE } from './config.js';
import { WEATHERS, TIMES, freePlan, sideOffset, freeHost } from './plan.js';
import { createSession } from './session.js';
import { createRemotes, packState, outfitOf, MEET_GAP_MS } from './remotes.js';
import { sendSlot } from './wire.js';
import { createMpHud } from './hud.js';
import { distText } from './tags.js';
import { OUTFITS } from '../skier-model.js';

export { FREE, freePlan, sideOffset, freeHost };

const SAVE_PREFIX = 'pb_ski_mpfree:';
const loadSaved = (key) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (error) { return null; } };
const save = (key, v) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch (error) { /* storage blocked: a reload starts at the lift */ } };
const finite = (...v) => v.every(Number.isFinite);
const AVALANCHE_ID = /^[A-Za-z0-9_:.-]{1,64}$/;
const AVALANCHE_AHEAD = 2000;        // ms: an avalanche "later than now" in my clock is a forgery (LOW 3)

/**
 * host: { game, env, hud, input, audio, scene, camera, canvas, surface, uiRoot, outfit(), level(), liftPath(i), liftName(i),
 *         startSpot(lateral) -> spot, startFree(spot), liftTop(index) -> spot | null, dayClock() -> clock | null, avalanche: { trigger(id, seed, t) } | null }
 */
export function createFreeMp({ ctx, host }) {
  const { game, env, hud } = host;
  const nameOf = new Map(ctx.roster.map((r) => [r.id, r.name]));
  const plan = freePlan(ctx.cfg, ctx.seed);
  const saveKey = `${SAVE_PREFIX}${ctx.code}:${ctx.seed}`;
  const mpHud = createMpHud(host.uiRoot);
  mpHud.show(false);
  // "to a friend": one small button under the friends list (no bar over the skier)
  const friendBtn = document.createElement('button');
  friendBtn.type = 'button'; friendBtn.className = 'btn mp-friend'; friendBtn.textContent = '👥 Bei e Frënd'; friendBtn.hidden = true;
  friendBtn.addEventListener('click', () => toFriend());
  mpHud.el.appendChild(friendBtn);
  const remotes = createRemotes({ scene: host.scene, camera: host.camera, surface: host.surface, overlay: host.uiRoot, liftPath: (i) => host.liftPath(i), farTags: true });
  remotes.setShadows(host.level() !== 'low');
  const local = { lastSend: 0, lastPos: 0, lastEnv: 0, epoch: 0, sent: null, sentAt: 0, sends: 0, movingSends: 0, movingMs: 0, lastFrame: 0, follow: 0, lastAv: new Map(), envFrom: null, began: false };
  const root = document.documentElement;
  let session = null;

  /* ---------- messages ---------- */
  function onMessage(from, m) {
    if (m.k === 's') {
      if (!remotes.get(from) || !Array.isArray(m.a)) return;
      const t = session.toLocal(from, Number(m.t));
      remotes.push(from, Number(m.e) | 0, t === null ? performance.now() : t, m.a);        // a new epoch = a teleport: the buffer restarts
      const r = remotes.get(from);
      if (r) { r.paused = !!m.p; r.epoch = Number(m.e) | 0; }
      return;
    }
    if (m.k === 'hi') { meet(from, outfitOf(m.o)); return; }
    if (m.k === 'env') { applyEnv(from, m); return; }
    if (m.k === 'av') { remoteAvalanche(from, m); }
  }
  function displayOutfit(id, wanted) {
    const taken = new Set([host.outfit(), ...remotes.all().filter((r) => r.id !== id).map((r) => r.outfit)]);
    if (OUTFITS.some((o) => o.id === wanted) && !taken.has(wanted)) return wanted;
    const free = OUTFITS.find((o) => !taken.has(o.id));
    return free ? free.id : wanted;
  }
  function meet(id, wanted) {
    const r = remotes.get(id);
    if (r && r.wanted === wanted) return;
    if (r && r.wanted && performance.now() - (r.metAt || 0) < MEET_GAP_MS) return;       // LOW 1: no rebuild loop
    if (r) remotes.remove(id);
    Object.assign(remotes.add(id, nameOf.get(id), displayOutfit(id, wanted)), { wanted, metAt: performance.now() });
    remotes.setLink(id, session.viaRelay(id));
  }
  function onPeer(id, status) {
    const r = remotes.get(id);
    if (status === 'here') {
      session.send(id, { k: 'hi', o: host.outfit() }, true);
      if (!r) { meet(id, ''); if (local.began) hud.toast(`${nameOf.get(id) || '?'} ass derbäi`, 1800); }
      if (isHost()) sendEnv(id);                   // a newcomer gets the day at once
    }
    if (status === 'gone' && r) { remotes.remove(id); hud.toast(`${nameOf.get(id) || '?'} ass fort`, 1800); }
    remotes.setAway(id, status === 'away');
    remotes.setLink(id, session.viaRelay(id));
    root.dataset.skiMpHost = hostId();
    refreshBoard();
  }

  /* ---------- the shared day (host only; handover = the next roster player who is here) ---------- */
  const statusOf = (id) => (session ? session.status(id) : 'wait');
  const hostId = () => freeHost(ctx.roster, ctx.me, statusOf);
  const isHost = () => hostId() === ctx.me;
  function envMsg() {
    const clock = host.dayClock();
    return { k: 'env', w: env.state.weatherId, tm: env.state.timeMode === 'random' ? 'random' : env.state.timeId, h: clock ? Math.round(clock.hour * 1000) / 1000 : null };
  }
  function sendEnv(to = null) {
    local.lastEnv = performance.now();
    const m = envMsg();
    if (to) session.send(to, m, true); else session.broadcast(m, true);
  }
  function applyEnv(from, m) {
    if (from !== hostId()) return;                                         // only the current host speaks for the day
    if (WEATHERS.includes(m.w) && m.w !== env.state.weatherId) env.setWeather(m.w, false);
    if (m.tm === 'random') { if (env.state.timeMode !== 'random') env.setTime('random', false); }
    else if (TIMES.includes(m.tm) && (env.state.timeMode !== m.tm)) env.setTime(m.tm, false);
    const clock = host.dayClock(), h = Number(m.h);
    if (clock && Number.isFinite(h) && Math.abs(clock.hour - h) > FREE.CLOCK_SLACK) clock.set(h);
    local.envFrom = from;
    root.dataset.skiMpEnv = `${env.state.weatherId}/${env.state.timeMode}`;
  }

  /* ---------- avalanches: world events with a seed, shown at the same moment everywhere ---------- */
  function shareAvalanche(id, seed, t = performance.now()) {
    if (!session || typeof id !== 'string' || id.length > 64 || !Number.isFinite(Number(seed))) return;
    session.broadcast({ k: 'av', id, s: Number(seed) >>> 0, t: Math.round(t) }, true);
  }
  function remoteAvalanche(from, m) {
    const now = performance.now();
    if (typeof m.id !== 'string' || !AVALANCHE_ID.test(m.id) || typeof m.s !== 'number' || !Number.isFinite(m.s) || typeof m.t !== 'number' || !Number.isFinite(m.t)) return;
    if (host.avalanche && typeof host.avalanche.known === 'function' && !host.avalanche.known(m.id)) return;      // round 7 C: a real zone only
    if (now - (local.lastAv.get(from) || -Infinity) < FREE.AVALANCHE_GAP) return;           // one per player per gap (no spam)
    const t = session.toLocal(from, m.t);
    const at = t === null ? now : t;
    if (!Number.isFinite(at) || now - at > FREE.AVALANCHE_LATE || at - now > AVALANCHE_AHEAD) return;
    local.lastAv.set(from, now);
    root.dataset.skiMpAvalanche = `${m.id}:${m.s >>> 0}`;
    if (host.avalanche && typeof host.avalanche.trigger === 'function') {
      try { host.avalanche.trigger(m.id, Number(m.s) >>> 0, at); } catch (error) { console.warn('[ski-mp] avalanche', error); }
    }
  }

  /* ---------- the friends list (top left) + "to a friend" ---------- */
  function refreshBoard() {
    const me = game.state;
    const rows = ctx.roster.filter((p) => p.id !== ctx.me).map((p) => {
      const r = remotes.get(p.id), st = statusOf(p.id);
      let text = st === 'wait' ? 'kënnt …' : st === 'gone' ? 'fort' : '';
      let sort = 1e9;
      if (r && r.state && me && st !== 'gone') {
        const d = Math.hypot(r.state.x - me.x, r.state.z - me.z);
        sort = d;
        const where = d < 25 ? 'bei dir' : distText(d);
        text = r.state.ride ? `um Lift${host.liftName(r.state.rideLift) ? `: ${host.liftName(r.state.rideLift)}` : ''}` : r.paused ? `${where} · Kaart` : where;
      }
      return { name: p.name + (p.id === hostId() ? ' ★' : ''), me: false, text, away: st === 'away' || st === 'gone', sort };
    }).sort((a, b) => a.sort - b.sort);
    mpHud.board(`Fräi fueren · ${1 + ctx.roster.filter((p) => p.id !== ctx.me && statusOf(p.id) === 'here').length} / ${ctx.roster.length}`, [{ name: 'Du', me: true, text: '' }, ...rows]);
    friendBtn.hidden = !(friendsToJoin().length > 0 && game.phase === 'running' && !game.paused);
    mpHud.el.querySelector('.mp-board').appendChild(friendBtn);          // the list is rebuilt each time: the button goes under it
    root.dataset.skiMpFree = String(remotes.all().filter((x) => x.state).length);
  }
  /** friends I can join (on the snow, or on a lift: then at its top, where he gets off) */
  const friendsToJoin = () => remotes.all().filter((r) => r.state && statusOf(r.id) === 'here');
  /** fast travel next to the next friend in turn (a teleport like any other: the others see me appear there) */
  function toFriend() {
    const list = friendsToJoin();
    if (!list.length || !game.state) return false;
    const r = list[local.follow++ % list.length], s = r.state;
    const top = s.ride ? host.liftTop(s.rideLift) : null;
    if (top) { host.startFree(top); hud.toast(`${r.name} ass um Lift: du waars uewen op hien`, 1800); return true; }
    const h = Math.hypot(s.vx, s.vz) > 1 ? Math.atan2(s.vz, s.vx) : s.heading;
    const spot = { x: s.x - Math.cos(h) * 6 + Math.sin(h) * 3, z: s.z - Math.sin(h) * 6 - Math.cos(h) * 3, heading: h };
    host.startFree(spot);
    hud.toast(`Bei ${r.name}`, 1400);
    return true;
  }

  /* ---------- per frame ---------- */
  function frame(now) {
    const st = game.state;
    if (!st || !session) return;
    const moving = game.phase === 'lift' || (game.phase === 'running' && !game.paused && st.speed > FREE.MOVING);
    const hz = moving ? FREE.SEND_HZ : FREE.IDLE_HZ;
    if (moving && local.lastFrame) local.movingMs += Math.min(250, now - local.lastFrame);      // (the flow's send-rate check)
    local.lastFrame = now;
    const slot = sendSlot(local.lastSend, now, hz);              // cleanup round: on the wall clock (15 / s at any frame rate above it)
    if (slot !== null) {
      // a teleport: farther than any skier gets between two sends (not while riding: the line can be long between skips)
      if (local.sent && !(st.ride && local.sent.ride && st.rideLift === local.sent.rideLift) && Math.hypot(st.x - local.sent.x, st.z - local.sent.z) > FREE.TELEPORT * Math.max(1, (now - local.sentAt) / 1000)) local.epoch++;
      local.lastSend = slot; local.sentAt = now; local.sends++; if (moving) local.movingSends++;
      local.sent = { x: st.x, z: st.z, ride: st.ride, rideLift: st.rideLift };
      session.broadcast({ k: 's', e: local.epoch, t: Math.round(now), p: game.screen === 'map' || game.paused ? 1 : 0, a: packState(st, 0, false) }, false);
      root.dataset.skiMpEpoch = String(local.epoch);
    }
    if (now - local.lastPos >= FREE.POS_EVERY && game.phase === 'running' && finite(st.x, st.z)) {
      local.lastPos = now;
      save(saveKey, { x: Math.round(st.x * 10) / 10, z: Math.round(st.z * 10) / 10, h: Math.round(st.heading * 1000) / 1000 });
    }
    if (isHost() && now - local.lastEnv >= FREE.ENV_EVERY) sendEnv();
  }
  function render(now, time) {
    const c = host.canvas;
    remotes.update(now, time, c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
  }

  function onAction(action) {
    if (action === 'weather' || action === 'time') {
      if (!isHost()) { hud.toast(`D'Wieder an d'Zäit bestëmmt ${nameOf.get(hostId()) || 'den Host'}`); return true; }
      setTimeout(() => sendEnv(), 0);                 // the game changes it first, then everybody gets it
      return false;
    }
    if (action === 'friend') { toFriend(); return true; }
    return false;
  }

  async function begin() {
    root.dataset.skiMp = 'connecting';
    mpHud.show(true);
    env.setWeather(plan.weather, false); env.setTime(plan.time, false);
    if (env.snap) env.snap();
    session = createSession({ code: ctx.code, me: ctx.me, roster: ctx.roster, name: nameOf.get(ctx.me), racing: () => true, relay: NET.FREE_RELAY, onMessage, onPeer });
    // a reload / a rejoin goes on where I was; else side by side at the start lift
    const back = loadSaved(saveKey);
    const spot = back && finite(back.x, back.z, back.h) ? { x: back.x, z: back.z, heading: back.h } : host.startSpot(sideOffset(ctx.roster, ctx.me));
    host.startFree(spot);
    local.began = true;
    try { await session.start(); } catch (error) { console.error('[ski-mp] no connection', error); hud.toast('Keng Verbindung: du fiers eleng weider', 2600); }
    root.dataset.skiMp = 'free';
    root.dataset.skiMpHost = hostId();
    setInterval(refreshBoard, FREE.BOARD_MS);
    window.__skiMp = {
      kind: 'free', session, remotes, ctx, plan, toFriend, shareAvalanche, hostId, get epoch() { return local.epoch; },
      info: () => ({ kind: 'free', host: hostId(), epoch: local.epoch, sends: local.sends, movingSends: local.movingSends, movingMs: local.movingMs, net: session.info(), env: envMsg(), seen: remotes.all().map((r) => ({ id: r.id, has: !!r.state, ride: r.state ? r.state.ride || '' : '', tag: r.tagMode || 'hidden', jumps: r.jumps })) }),
    };
  }

  return {
    kind: 'free', begin, frame, render, onAction, shareAvalanche,
    onFinish() { /* a challenge run in the free ride is a solo run (main.js handles it) */ },
    viewState: () => null,
    get active() { return true; },
  };
}
