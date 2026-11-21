/* Round 7: the online FREE RIDE (lobby setting "Modus: Fräi fueren"): friends ski the whole mountain together, no clock.
 * Same transport as the race (session.js: full mesh of WebRTC links, the capped Realtime relay as a fallback, lobby code + roster from
 * mp-gate.js), same remote skiers (remotes.js: interpolated figures, name tags, a friend on a lift in his own chair / cabin on the real
 * line). What is shared: where everybody is (my state ~15 times a second while moving: Ian, 22 Nov: the school Wi-Fi has plenty of
 * upload, smoothness first), the resort, weather and time (drawn from the lobby seed: everybody sees the same mountain), and avalanches
 * (the release event goes to everybody reliably, each device runs the same deterministic flow: modes/avalanche.js).
 * Nobody waits for anybody: each player is in his own free ride (lifts, challenges, the park, the map) and simply sees the others.
 * The live list (top left) shows the friends and how far away they are; «👥 Bei …» jumps next to one (a short fade). */
import { NET } from './config.js';
import { resolveFree } from './plan.js';
import { createSession } from './session.js';
import { createRemotes, packState } from './remotes.js';
import { createMpHud } from './hud.js';
import { OUTFITS } from '../skier-model.js';

export const FREE_NET = Object.freeze({
  SEND_HZ: 15,              // states per second while moving or riding (the race sends 12)
  IDLE_HZ: 4,               // ... standing still, on the map, in a menu
  BOARD_MS: 500,            // the live list
  JUMP_BEHIND: 9,           // m behind a friend where «Bei …» puts me (on his line, facing his way)
});

const distText = (d) => (d < 950 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);

/**
 * host: { game, rid, scene, camera, canvas, surface, env, hud, input, audio, uiRoot, outfit(), level(), liftPath(i),
 *         startFree(lateral), jumpTo(x, z, heading), liftBottom(index) -> { x, z, heading } | null, avalanche(ev, ageMs) }
 */
export function createMpFree({ ctx, host }) {
  const { game, env, hud } = host;
  const plan = resolveFree(ctx.cfg, ctx.seed);
  const nameOf = new Map(ctx.roster.map((r) => [r.id, r.name]));
  const mpHud = createMpHud(host.uiRoot);
  const remotes = createRemotes({ scene: host.scene, camera: host.camera, surface: host.surface, overlay: host.uiRoot, liftPath: (i) => host.liftPath(i) });
  remotes.setShadows(host.level() !== 'low');
  const root = document.documentElement;
  const status = new Map();
  let lastSend = 0, jumpIndex = -1, boardTimer = 0;

  const session = createSession({
    code: ctx.code, me: ctx.me, roster: ctx.roster, name: nameOf.get(ctx.me),
    racing: () => true,
    onMessage, onPeer,
  });

  function onMessage(from, m) {
    if (m.k === 's') {
      if (!remotes.get(from)) meet(from, '');
      const t = session.toLocal(from, Number(m.t));
      remotes.push(from, 0, t === null ? performance.now() : t, m.a);
      return;
    }
    if (m.k === 'hi') { meet(from, typeof m.o === 'string' ? m.o : ''); return; }
    if (m.k === 'av') {
      // an avalanche somebody released: the same slab and flow here, as old as it is there
      const x = Number(m.x), z = Number(m.z), seed = Number(m.seed) >>> 0;
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e5 || Math.abs(z) > 1e5) return;
      const t = session.toLocal(from, Number(m.t));
      const age = t === null ? session.latency(from) : Math.max(0, performance.now() - t);
      host.avalanche({ x, z, seed, id: String(m.id || '').slice(0, 24), by: nameOf.get(from) || '?' }, Math.min(8000, age));
    }
  }
  function displayOutfit(id, wanted) {
    const taken = new Set([host.outfit(), ...remotes.all().filter((r) => r.id !== id).map((r) => r.outfit)]);
    if (OUTFITS.some((o) => o.id === wanted) && !taken.has(wanted)) return wanted;
    const free = OUTFITS.find((o) => !taken.has(o.id));
    return free ? free.id : wanted;
  }
  function meet(id, wanted) {
    if (!nameOf.has(id)) return;
    const r = remotes.get(id);
    if (r && (r.wanted === wanted || !wanted)) return;
    if (r) remotes.remove(id);
    remotes.add(id, nameOf.get(id), displayOutfit(id, wanted)).wanted = wanted;
    remotes.setLink(id, session.viaRelay(id));
  }
  function onPeer(id, st) {
    status.set(id, st);
    if (st === 'here') { session.send(id, { k: 'hi', o: host.outfit() }, true); meet(id, ''); }
    if (st === 'gone') remotes.remove(id);
    remotes.setAway(id, st === 'away');
    remotes.setLink(id, session.viaRelay(id));
    refreshBoard();
  }

  /** The live list: me first, then the friends by distance. */
  function refreshBoard() {
    const me = game.state;
    const rows = ctx.roster.filter((p) => p.id !== ctx.me).map((p) => {
      const r = remotes.get(p.id), st = status.get(p.id) || 'wait';
      const s = r && r.state;
      const d = s && me ? Math.hypot(s.x - me.x, s.z - me.z) : Infinity;
      const text = st === 'gone' ? 'fort' : !s ? (st === 'wait' ? 'kënnt …' : '…') : s.ride ? `um Lift · ${distText(d)}` : distText(d);
      return { name: p.name, me: false, text, away: st === 'away', d };
    }).sort((a, b) => a.d - b.d);
    mpHud.board(`Fräi fueren · ${ctx.roster.length} Spiller`, [{ name: nameOf.get(ctx.me) || 'Du', me: true, text: 'du', away: false }, ...rows]);
    const live = friends();
    mpHud.bar(live.length && game.screen === 'ski' && game.phase === 'running' ? 'Zesumme fueren' : '', live.length ? [{ label: `👥 Bei ${nextFriend(live).name}`, on: () => jump() }] : []);
    root.dataset.skiMpFree = String(live.length);
  }
  /** Friends I can jump to (seen, not gone). */
  const friends = () => remotes.all().filter((r) => r.state && status.get(r.id) !== 'gone');
  const nextFriend = (live) => live[(jumpIndex + 1) % live.length];
  /** «Bei …»: next to the next friend (behind him on his line; on a lift: at that lift's bottom station). */
  function jump() {
    const live = friends();
    if (!live.length || game.screen !== 'ski') return;
    jumpIndex = (jumpIndex + 1) % live.length;
    const r = live[jumpIndex], s = r.state;
    if (s.ride) {
      const b = host.liftBottom(s.rideLift);
      if (b) { host.jumpTo(b.x, b.z, b.heading); hud.toast(`${r.name} ass um Lift: du waars ënnen`, 1800); }
      return;
    }
    const sp = Math.hypot(s.vx, s.vz), h = sp > 1 ? Math.atan2(s.vz, s.vx) : s.heading;
    host.jumpTo(s.x - Math.cos(h) * FREE_NET.JUMP_BEHIND, s.z - Math.sin(h) * FREE_NET.JUMP_BEHIND, h);
    hud.toast(`Bei ${r.name}`, 1400);
    refreshBoard();
  }

  function frame(now) {
    const st = game.state;
    if (!st) return;
    const moving = game.screen === 'ski' && !game.paused && (st.speed > 0.4 || !!st.ride);
    const hz = moving ? FREE_NET.SEND_HZ : FREE_NET.IDLE_HZ;
    if (now - lastSend >= 1000 / hz) {
      lastSend = now;
      session.broadcast({ k: 's', r: 0, t: Math.round(now), a: packState(st, 0, false) }, false);
    }
  }
  function render(now, time) {
    const c = host.canvas;
    remotes.update(now, time, c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
  }
  /** My device released an avalanche: everybody gets it (reliable). */
  function shareAvalanche(ev) {
    session.broadcast({ k: 'av', id: ev.id, x: Math.round(ev.x * 10) / 10, z: Math.round(ev.z * 10) / 10, seed: ev.seed >>> 0, t: Math.round(performance.now()) }, true);
  }
  function onAction(action) {
    if (action === 'weather' || action === 'time') { hud.toast('Zesummen ass d\'Wieder fir jiddereen d\'selwecht'); return true; }
    return false;
  }

  async function begin() {
    root.dataset.skiMp = 'free:connecting';
    env.setWeather(plan.weather, false); env.setTime(plan.time, false); env.snap();
    mpHud.show(true);
    host.startFree(ctx.roster.findIndex((x) => x.id === ctx.me));
    refreshBoard();
    try { await session.start(); root.dataset.skiMp = 'free'; } catch (error) { console.error('[ski-mp] no connection', error); hud.toast('Keng Verbindung: du fiers eleng', 2600); root.dataset.skiMp = 'free:solo'; }
    boardTimer = setInterval(refreshBoard, FREE_NET.BOARD_MS);
    window.__skiMp = { session, remotes, ctx, plan, free: true, jump, info: () => ({ net: session.info(), seen: friends().map((r) => ({ id: r.id, x: r.state.x, z: r.state.z, ride: r.state.ride || '' })) }) };
  }
  function close() { clearInterval(boardTimer); try { session.close(); } catch (error) { /* closing */ } }

  return { begin, frame, render, onAction, shareAvalanche, close, viewState: () => null, remotes, get active() { return true; }, free: true };
}
export { NET };
