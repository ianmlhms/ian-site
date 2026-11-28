/* Ski Alpen online race, SPECTATOR side (28 Nov 2026): a friend who joins a race that is already running watches it live instead of waiting.
 *   - He is a peer of the session (the racers add him through session.js `dynamic`) but NOT of the race: not in the roster, never in the
 *     standings, never a finisher or a DNF, no figure on the course (the racers only see «👀 N»). He sends nothing but the transport's pings
 *     and his presence; the racers ignore every message from him anyway (net/index.js).
 *   - He runs the race's own state machine as a listener (createRace `spectator: true`): the coordinator's 'sync' tells him where the match
 *     stands, 'go' / 'end' / 'next' move him along, every racer's own 'fin' / 'dnf' gives the results. The plan (resort, pistes, weather,
 *     time) is the one every device derives from the lobby code + roster (the roster rides in the racers' presence).
 *   - View: a follow camera on one racer (arrows / tap / buttons switch), a free overview camera, the live table with split gaps, the
 *     finish. At the end the rematch lobby takes him in as a normal player (the lobby's waitForRematch, like before).
 * main.js hooks (all `mp.`): hideLocal (his own figure is not drawn), viewState (the followed racer), focusPoint (what the tiles follow),
 * host.setView (the overview pose). */
import { NET, SPEC } from './config.js';
import { resolveRuns } from './plan.js';
import { createRace } from './race.js';
import { createSession } from './session.js';
import { createRemotes, outfitOf, MEET_GAP_MS } from './remotes.js';
import { createMpHud, resText } from './hud.js';
import { createSplits, gapText } from './splits.js';
import { formatTime, minRunMs } from '../progress.js';
import { OUTFITS } from '../skier-model.js';

const BOARD_MS = 250;
const TAP_MOVE = 10;                 // px: a tap, not a look drag
const TAP_MS = 350;
const GONE_ALL_MS = 9000;            // every racer gone: back to the lobby after this long
const OVERVIEW_FOV = 58;

export function createSpectateMp({ ctx, host }) {
  const { game, env, hud, input, audio } = host;
  const runs = resolveRuns(ctx.cfg, host.rid, host.pistes.list, ctx.seed);
  const pisteOf = (r) => host.pistes.byId.get(runs[r].piste) || host.pistes.list[0];
  const roster = ctx.roster;
  const nameOf = new Map(roster.map((r) => [r.id, r.name]));
  const mpHud = createMpHud(host.uiRoot);
  mpHud.show(false);
  const remotes = createRemotes({ scene: host.scene, camera: host.camera, surface: host.surface, overlay: host.uiRoot, liftPath: () => null });
  remotes.setShadows(host.level() !== 'low');
  const root = document.documentElement;
  const local = { target: '', mode: 'follow', goneSince: 0, resultsCard: null, over: false, prepToken: 0, ready: false, barKey: '', pose: null, overAt: 0, left: false };
  let splits = createSplits({ length: pisteOf(0).length });
  let session = null;

  const race = createRace({
    me: ctx.me, roster, runs: runs.length, now: () => performance.now(), spectator: true,
    send: () => {}, latency: (id) => (session ? session.latency(id) : 0), minMs: (r) => minRunMs(pisteOf(r).length),
    onEvent,
  });
  session = createSession({
    code: ctx.code, me: ctx.me, roster, name: 'Zuschauer', racing: () => race.phase === 'go',
    extra: { sp: 1 }, order: 1e9 + Math.floor(Date.now() / 1000),
    onMessage, onPeer,
  });

  /* ---------- messages (only the racers speak; he never answers) ---------- */
  function onMessage(from, m) {
    if (m.k === 's') {
      if (m.r !== race.run || !remotes.get(from) || !Array.isArray(m.a)) return;
      const t = session.toLocal(from, Number(m.t));
      const at = t === null ? performance.now() : t;
      remotes.push(from, m.r, at, m.a);
      if (race.phase === 'go' && race.goAt !== null) splits.note(from, at - race.goAt, Number(m.a[12]));
      return;
    }
    if (m.k === 'hi') { meet(from, outfitOf(m.o)); return; }
    race.receive(from, m);
  }
  function displayOutfit(id, wanted) {
    const taken = new Set(remotes.all().filter((r) => r.id !== id).map((r) => r.outfit));
    if (OUTFITS.some((o) => o.id === wanted) && !taken.has(wanted)) return wanted;
    const free = OUTFITS.find((o) => !taken.has(o.id));
    return free ? free.id : wanted;
  }
  function meet(id, wanted) {
    if (!nameOf.has(id)) return;
    const r = remotes.get(id);
    if (r && r.wanted === wanted) return;
    if (r && r.wanted && performance.now() - (r.metAt || 0) < MEET_GAP_MS) return;
    if (r) remotes.remove(id);
    Object.assign(remotes.add(id, nameOf.get(id), displayOutfit(id, wanted)), { wanted, metAt: performance.now() });
    remotes.setLink(id, session.viaRelay(id));
  }
  function onPeer(id, status) {
    if (!nameOf.has(id)) return;
    race.setStatus(id, status);
    if (status === 'here' && !remotes.get(id)) meet(id, '');
    if (status === 'gone') remotes.remove(id);
    remotes.setAway(id, status === 'away');
    remotes.setLink(id, session.viaRelay(id));
    if (local.target === id && status === 'gone') pickTarget(1);
    refreshBoard();
  }

  /* ---------- race events ---------- */
  function onEvent(e) {
    root.dataset.skiMp = `spectate:${race.phase}:${race.run}`;
    if (!local.ready) return;                           // before the first sync he only collects (begin() starts the right piste)
    if (e.type === 'prepare') prepare(e.run);
    else if (e.type === 'go') { splits.reset(); refreshBar(true); }
    else if (e.type === 'end' || e.type === 'over') endRun(e.type === 'over');
    else if (e.type === 'standings' || e.type === 'status') { refreshBoard(); if (local.resultsCard) showResults(local.over); }
  }
  async function prepare(r) {
    const token = ++local.prepToken;
    const p = pisteOf(r), plan = runs[r];
    mpHud.closeCard(); local.resultsCard = null; local.over = false;
    env.setWeather(plan.weather, false); env.setTime(plan.time, false); env.snap();
    remotes.clearRun();
    splits = createSplits({ length: p.length });
    host.startRun(p, 0);
    seat();
    mpHud.show(true);
    refreshBoard(); refreshBar(true);
    const top = p.at(2, {});
    try { await host.streamer.ready(top.x, top.z, 1500); } catch (error) { console.warn('[ski-spectate] tiles', error); }
    if (token !== local.prepToken) return;
    refreshBoard();
  }
  /** his own skier stays at the gate, hidden, without controls: he only looks */
  function seat() {
    game.phase = 'finished'; game.paused = false;
    input.setEnabled(false);
    if (input.showTouch) input.showTouch(false);
    hud.show(false);
    root.dataset.skiSpec = '1';
  }
  function endRun(final) {
    local.over = final;
    showResults(final);
    if (final) { local.overAt = performance.now(); if (window.MPGate && window.MPGate.setOver) window.MPGate.setOver(true); }
    root.dataset.skiMpResults = String(race.run);
    refreshBar(true);
  }
  function showResults(final) {
    const r = race.run;
    local.resultsCard = mpHud.results({
      title: `Resultat · Laf ${r + 1} / ${runs.length}`,
      piste: pisteOf(r), table: race.runTable(r), stand: runs.length > 1 || final ? race.standings() : [], final, me: '',
      statusOf: (id) => race.status(id),
      foot: final ? 'Fäerdeg! Du kënns an déi nei Lobby, soubal den Host se opmécht.' : 'Nächste Laf geet gläich un …',
    });
  }

  /* ---------- who is watched: a racer (follow camera) or the whole pack (overview) ---------- */
  const candidates = () => roster.filter((p) => { const r = remotes.get(p.id); return r && r.state && race.status(p.id) !== 'gone'; }).map((p) => p.id);
  function pickTarget(step) {
    const list = candidates();
    if (!list.length) { local.target = ''; return; }
    const i = list.indexOf(local.target);
    local.target = list[i < 0 ? 0 : (i + step + list.length) % list.length];
    local.mode = 'follow'; local.pose = null; host.setView(null);
    const r = remotes.get(local.target);
    if (r && r.state) host.chase.snap(r.state);
    refreshBoard(); refreshBar(true);
  }
  function toggleOverview() {
    if (local.mode === 'over') { local.mode = 'follow'; local.pose = null; host.setView(null); if (!local.target) pickTarget(1); else { const r = remotes.get(local.target); if (r && r.state) host.chase.snap(r.state); } }
    else { local.mode = 'over'; local.pose = null; }
    refreshBoard(); refreshBar(true);
  }
  /** the leader in the live order, else the first racer who has a figure */
  function leaderId() {
    const live = roster.filter((p) => { const r = remotes.get(p.id); return r && r.state && !race.result(race.run, p.id); });
    live.sort((a, b) => remotes.get(b.id).state.progress - remotes.get(a.id).state.progress);
    return live.length ? live[0].id : (candidates()[0] || '');
  }
  /* the overview: behind and above the pack, looking at its middle (smoothed, never under the snow) */
  function overviewPose(dt) {
    const list = remotes.all().filter((r) => r.state && race.status(r.id) !== 'gone');
    if (!list.length) return null;
    let cx = 0, cz = 0, cy = 0;
    for (const r of list) { cx += r.state.x; cz += r.state.z; cy += r.state.y; }
    cx /= list.length; cz /= list.length; cy /= list.length;
    let spread = 0;
    for (const r of list) spread = Math.max(spread, Math.hypot(r.state.x - cx, r.state.z - cz));
    const lead = remotes.get(leaderId()) || list[0];
    const hd = lead.state.heading;
    const want = { x: cx, z: cz, y: cy, hx: Math.cos(hd), hz: Math.sin(hd), spread };
    const k = 1 - Math.exp(-Math.max(0.001, dt) * 3);
    const p = local.pose || (local.pose = { ...want });
    for (const key of ['x', 'z', 'y', 'hx', 'hz', 'spread']) p[key] += (want[key] - p[key]) * k;
    const hl = Math.hypot(p.hx, p.hz) || 1, dx = p.hx / hl, dz = p.hz / hl;
    const back = Math.min(90, 20 + p.spread * 0.55), up = Math.min(45, 9 + p.spread * 0.25);
    const x = p.x - dx * back, z = p.z - dz * back;
    const y = Math.max(p.y + up, host.surface.height(x, z) + 3);
    return { x, y, z, tx: p.x, ty: p.y + 1, tz: p.z, fov: OVERVIEW_FOV };
  }

  /* ---------- the live table + the bar ---------- */
  function refreshBoard() {
    const r = race.run, ph = race.phase;
    const lead = leaderId();
    const rows = roster.map((p) => {
      const res = race.result(r, p.id), st = race.status(p.id), rem = remotes.get(p.id);
      const prog = rem && rem.state ? rem.state.progress : 0;
      const left = Math.max(0, Math.round(pisteOf(r).length - prog));
      let text = '', key = 3, sort = 0;
      if (res) { text = resText(res, st); key = res.dnf || !res.valid ? 2 : 0; sort = res.ms || 0; }
      else if (ph === 'prep') text = st === 'wait' ? 'kënnt …' : st === 'gone' ? 'fort' : 'am Start';
      else if (st === 'gone') text = 'fort';
      else {
        key = 1; sort = -prog;
        const n = splits.passed(p.id), gap = splits.gap(p.id, lead);
        if (p.id === lead) text = n ? `S${n} ${formatTime(splits.time(p.id, n - 1))}` : `${left} m`;
        else text = gap !== null ? `${gapText(gap)} s` : `${left} m`;
        if (st === 'away') text += ' ?';
      }
      const watched = local.mode === 'follow' && p.id === local.target;
      return { name: `${watched ? '👁 ' : ''}${p.name}`, me: watched, text, away: st === 'away', key, sort };
    }).sort((a, b) => a.key - b.key || a.sort - b.sort);
    mpHud.board(`Zuschauer · Laf ${r + 1} / ${runs.length}`, rows);
    const gone = roster.every((p) => race.status(p.id) === 'gone');
    if (ph === 'prep') mpHud.banner(gone ? '' : 'Start gëtt virbereet …');
    else if (ph === 'go' && race.goAt !== null && performance.now() < race.goAt) mpHud.banner(String(Math.max(1, Math.ceil((race.goAt - performance.now()) / 1000))));
    else mpHud.banner('');
    if (gone && ph !== 'over') {
      mpHud.banner('D\'Rennen ass net méi do …');
      if (!local.goneSince) local.goneSince = performance.now();
      else if (performance.now() - local.goneSince > GONE_ALL_MS) leaveToLobby();
    } else local.goneSince = 0;
    root.dataset.skiMpWatching = String(roster.filter((p) => remotes.get(p.id) && remotes.get(p.id).state).length);
  }
  function refreshBar(force) {
    const name = local.mode === 'over' ? 'Iwwersiicht' : (nameOf.get(local.target) || '…');
    const key = `${local.mode}|${name}|${local.over ? 1 : 0}`;
    if (!force && key === local.barKey) return;
    local.barKey = key;
    mpHud.bar(`👀 ${name}`, [
      { label: '‹', on: () => pickTarget(-1) },
      { label: '›', on: () => pickTarget(1) },
      { label: local.mode === 'over' ? 'Fuerer' : 'Iwwersiicht', on: () => toggleOverview() },
      ...(local.over ? [{ label: 'Op d\'Lobby waarden', on: () => leaveToLobby() }] : []),
    ]);
  }
  function leaveToLobby() {
    if (local.left) return;
    local.left = true;
    try { session.close(); } catch (error) { /* closing */ }
    if (window.MPGate && window.MPGate.openLobby) window.MPGate.openLobby(ctx.code);
  }

  /* ---------- keys / taps ---------- */
  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') pickTarget(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') pickTarget(1);
    else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyV' || e.code === 'Space') toggleOverview();
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);
  let down = null;
  host.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, at: performance.now() }; });
  host.canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_MOVE && performance.now() - down.at < TAP_MS) pickTarget(1);
    down = null;
  });

  /* ---------- per frame ---------- */
  let lastFrame = 0;
  function frame(now) {
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    if (local.mode === 'follow') {
      const t = local.target && remotes.get(local.target);
      if (!t || !t.state || race.status(local.target) === 'gone') pickTarget(1);
      else if (t.state.finished && race.phase === 'go') {                  // he is across the line: on to the next one still skiing
        const live = candidates().filter((id) => { const r = remotes.get(id); return r.state && !r.state.finished && !race.result(race.run, id); });
        if (live.length) { local.target = live[0]; host.chase.snap(remotes.get(live[0]).state); refreshBoard(); refreshBar(true); }
      }
    }
    if (local.mode === 'over') host.setView(overviewPose(dt));
    if (local.over && performance.now() - local.overAt > SPEC.AUTO_LEAVE_MS) leaveToLobby();
  }
  function render(now, time) {
    const c = host.canvas;
    remotes.update(now, time, c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
  }

  function viewState() {
    if (local.mode !== 'follow') return null;
    const r = local.target && remotes.get(local.target);
    return r && r.state ? r.state : null;
  }
  function focusPoint() {
    const s = local.mode === 'over' && local.pose ? local.pose : viewState();
    return s ? { x: s.x, z: s.z } : null;
  }
  function onAction(action) {
    if (action === 'menu') { openMenu(); return true; }
    return true;                                    // weather / time / map / confirm: nothing of this is his to change
  }
  function openMenu() {
    if (mpHud.cardOpen) { if (!local.resultsCard) mpHud.closeCard(); return; }
    mpHud.pause({
      buttons: [
        { id: 'resume', label: 'Weider kucken', primary: true, on: () => {} },
        { id: 'sound', label: audio.isMuted() ? 'Toun un' : 'Toun aus', on: () => audio.setMuted(!audio.isMuted()) },
        { id: 'quit', label: 'Net méi kucken', ghost: true, on: () => leaveToLobby() },
      ],
    });
  }

  async function begin() {
    root.dataset.skiMp = 'connecting';
    root.dataset.skiSpec = '1';
    mpHud.show(true);
    mpHud.banner('Verbënnt …');
    try { await session.start(); } catch (error) { console.error('[ski-spectate] no connection', error); mpHud.banner('Keng Verbindung'); }
    // the first racer's link + his sync say which run / phase this is: build THAT piste once (not run 1 first)
    for (let i = 0; i < 30 && !roster.some((p) => race.status(p.id) === 'here'); i++) await new Promise((res) => setTimeout(res, 200));
    await new Promise((res) => setTimeout(res, 700));
    local.ready = true;
    prepare(race.run);
    if (race.phase === 'results' || race.phase === 'over') endRun(race.phase === 'over');
    setInterval(refreshBoard, BOARD_MS);
    setInterval(() => refreshBar(false), BOARD_MS);
    window.__skiMp = {
      kind: 'spectate', race, session, remotes, runs, ctx, splits: () => splits, pickTarget, toggleOverview, get target() { return local.target; }, get mode() { return local.mode; },
      info: () => ({ run: race.run, phase: race.phase, target: local.target, mode: local.mode, net: session.info(), standings: race.standings(), table: race.runTable(race.run), splits: roster.map((p) => ({ id: p.id, passed: splits.passed(p.id) })) }),
    };
  }

  return { kind: 'spectate', begin, frame, render, onAction, viewState, focusPoint, hideLocal: true, onFinish() { /* a spectator never finishes */ }, get active() { return true; } };
}
