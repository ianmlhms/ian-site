/* Ski Alpen online race: the glue between the lobby context, the transport (session.js), the race (race.js), the other skiers
 * (remotes.js), the race screens (hud.js) and the game (main.js, through the small `host` object it hands over).
 * main.js only calls: readMpContext() at boot, mpResort() for the resort, then createMp(...) and mp.begin(), mp.frame(), mp.render(),
 * mp.onFinish(), mp.onAction(), mp.viewState(). Without a lobby context none of this runs: solo stays exactly as it was. */
import { NET } from './config.js';
import { matchSeed, resolveResort, resolveRuns } from './plan.js';
import { createRace } from './race.js';
import { createSession } from './session.js';
import { createRemotes, packState } from './remotes.js';
import { createMpHud, resText } from './hud.js';
import { minRunMs } from '../progress.js';
import { sanitizeCfg } from '../../../mp-games.js?v=6';

const GAME = 'ski';
const CTX_KEY = 'mpl.ctx';
const SAVE_PREFIX = 'pb_ski_mp:';
const ID_RE = /^[a-z0-9]{4,16}$/;
const TICK_MS = 200;
const BOARD_MS = 250;

/** The lobby context of this page (mp-gate.js) plus my own roster id, or null (solo). */
export function readMpContext() {
  const gate = window.MPGate;
  const ctx = gate && gate.ctx;
  if (!ctx || ctx.game !== GAME || !ctx.code || !Array.isArray(ctx.roster) || ctx.roster.length < 1) return null;
  const roster = ctx.roster.filter((r) => ID_RE.test(r.id)).slice(0, NET.MAX_PLAYERS).map((r) => Object.freeze({ id: r.id, name: r.name || '?', uid: r.uid || '' }));
  let me = '';
  try { const raw = JSON.parse(sessionStorage.getItem(CTX_KEY) || 'null'); if (raw && raw.code === ctx.code && typeof raw.me === 'string') me = raw.me; } catch (error) { /* storage blocked */ }
  if (!roster.some((r) => r.id === me)) me = ctx.role === 'host' ? roster[0].id : '';
  if (!me) { console.warn('[ski-mp] my roster id is unknown: solo'); return null; }
  const cfg = sanitizeCfg(GAME, ctx.cfg);
  const seed = matchSeed(ctx.code, roster);
  return Object.freeze({ code: ctx.code, me, role: ctx.role, roster: Object.freeze(roster), cfg, seed });
}
export const mpResort = (ctx, readyIds) => resolveResort(ctx.cfg, ctx.seed, readyIds);

function loadSaved(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (error) { return null; } }
function save(key, v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch (error) { /* storage blocked: a reload starts the match view fresh */ } }

/**
 * host: { game, rid, pistes, streamer, terrain, surface, scene, camera, canvas, env, hud, input, audio, chase, uiRoot, outfit(),
 *         startRun(piste), level() }
 */
export function createMp({ ctx, host }) {
  const { game, pistes, env, hud, input, audio } = host;
  const runs = resolveRuns(ctx.cfg, host.rid, pistes.list, ctx.seed);
  const pisteOf = (r) => pistes.byId.get(runs[r].piste) || pistes.list[0];
  const nameOf = new Map(ctx.roster.map((r) => [r.id, r.name]));
  const saveKey = `${SAVE_PREFIX}${ctx.code}:${ctx.seed}`;
  const mpHud = createMpHud(host.uiRoot);
  mpHud.show(false);
  const remotes = createRemotes({ scene: host.scene, camera: host.camera, surface: host.surface, overlay: host.uiRoot });
  remotes.setShadows(host.level() !== 'low');
  const local = { ready: -1, goAt: null, started: -1, lastSend: 0, spectate: null, resultsCard: null, nextAt: 0, over: false, prepToken: 0 };
  const root = document.documentElement;

  let session = null;
  const race = createRace({
    me: ctx.me, roster: ctx.roster, runs: runs.length, now: () => performance.now(),
    send: (to, msg) => { if (!session) return; if (to) session.send(to, msg, true); else session.broadcast(msg, true); },
    latency: (id) => (session ? session.latency(id) : 0),
    minMs: (r) => minRunMs(pisteOf(r).length),
    onEvent, restore: loadSaved(saveKey),
  });

  session = createSession({
    code: ctx.code, me: ctx.me, roster: ctx.roster, name: nameOf.get(ctx.me),
    racing: () => race.phase === 'go',
    onMessage, onPeer,
  });

  /* ---------- messages ---------- */
  function onMessage(from, m) {
    if (m.k === 's') {
      if (m.r !== race.run || !remotes.get(from)) return;
      const t = session.toLocal(from, Number(m.t));
      remotes.push(from, m.r, t === null ? performance.now() : t, m.a);
      return;
    }
    if (m.k === 'hi') { meet(from, typeof m.o === 'string' ? m.o : ''); return; }
    race.receive(from, m);
  }
  function meet(id, outfit) {
    const r = remotes.get(id);
    if (r && r.outfit === outfit) return;
    if (r) remotes.remove(id);
    remotes.add(id, nameOf.get(id), outfit);
    remotes.setLink(id, session.viaRelay(id));
  }
  function onPeer(id, status) {
    race.setStatus(id, status);
    if (status === 'here') { session.send(id, { k: 'hi', o: host.outfit() }, true); if (!remotes.get(id)) meet(id, ''); }
    if (status === 'gone') remotes.remove(id);
    remotes.setAway(id, status === 'away');
    remotes.setLink(id, session.viaRelay(id));
    refreshBoard();
  }

  /* ---------- race events ---------- */
  function onEvent(e) {
    save(saveKey, race.snapshot());
    root.dataset.skiMp = `${race.phase}:${race.run}`;
    if (e.type === 'prepare') prepare(e.run);
    else if (e.type === 'go') { local.goAt = e.goAt; maybeLate(); }
    else if (e.type === 'end' || e.type === 'over') endRun(e.type === 'over');
    else if (e.type === 'standings' || e.type === 'status') { refreshBoard(); if (local.resultsCard) showResults(local.over); }
  }

  async function prepare(r) {
    const token = ++local.prepToken;
    const p = pisteOf(r), plan = runs[r];
    mpHud.closeCard(); local.resultsCard = null; mpHud.bar('');
    local.goAt = null; local.spectate = null;
    env.setWeather(plan.weather, false); env.setTime(plan.time, false); env.snap();
    remotes.clearRun();
    host.startRun(p);
    mpHud.show(true);
    refreshBoard();
    if (race.started === r && !race.result(r, ctx.me)) {               // reloaded during this run: no second try
      race.localFinish(r, null);
      hud.toast('Du waars fort: dëse Laf zielt net', 2600);
    }
    const top = p.at(2, {});
    try { await host.streamer.ready(top.x, top.z, 1500); } catch (error) { console.warn('[ski-mp] tiles', error); }
    for (let i = 0; i < 40 && host.terrain.stats.pending > 0; i++) await new Promise((res) => setTimeout(res, 200));
    if (token !== local.prepToken) return;
    local.ready = r;
    race.localReady(r);
    maybeLate();
  }
  /* the start was given while this device was still loading: start on my own, a little later (my time is my own) */
  function maybeLate() {
    if (local.goAt === null || local.ready !== race.run || game.phase !== 'hold') return;
    const now = performance.now();
    if (now > local.goAt - 600) { local.goAt = now + 3000; hud.toast('Spéit gestart: deng Zäit zielt vun dengem Start un', 2400); }
  }

  function endRun(final) {
    local.over = final;
    const r = race.run;
    if (!race.result(r, ctx.me)) {
      if (game.phase === 'running' || game.phase === 'countdown' || game.phase === 'hold') { game.phase = 'finished'; input.setEnabled(false); hud.toast('Zäit eriwwer!', 2000); }
      race.localFinish(r, null);
    }
    local.spectate = null;
    mpHud.bar('');
    local.nextAt = performance.now() + 9000;
    showResults(final);
    if (final && window.MPGate && window.MPGate.setOver) window.MPGate.setOver(true);
    root.dataset.skiMpResults = String(r);
  }
  function showResults(final) {
    const r = race.run;
    local.resultsCard = mpHud.results({
      title: final ? `Resultat · Laf ${r + 1} / ${runs.length}` : `Resultat · Laf ${r + 1} / ${runs.length}`,
      piste: pisteOf(r), table: race.runTable(r), stand: runs.length > 1 || final ? race.standings() : [], final, me: ctx.me,
      statusOf: (id) => (id === ctx.me ? 'here' : race.status(id)),
      foot: final ? 'Fäerdeg! «‹ Lobby» fir nach eng Kéier.' : 'Nächste Laf geet gläich un …',
    });
  }

  /* ---------- the live table ---------- */
  function refreshBoard() {
    if (!mpHud) return;
    const r = race.run, ph = race.phase;
    const rows = ctx.roster.map((p) => {
      const me = p.id === ctx.me, res = race.result(r, p.id), st = me ? 'here' : race.status(p.id);
      const rem = me ? null : remotes.get(p.id);
      const prog = me ? (game.run ? game.run.progress : 0) : rem && rem.state ? rem.state.progress : 0;
      let text = '', key = 3, sort = 0;
      if (res) { text = resText(res, st); key = res.dnf || !res.valid ? 2 : 0; sort = res.ms || 0; }
      else if (ph === 'prep') { text = race.isReady(p.id) ? 'prett' : st === 'wait' ? 'kënnt …' : st === 'gone' ? 'fort' : 'lued …'; }
      else { const left = Math.max(0, Math.round(pisteOf(r).length - prog)); text = st === 'gone' ? 'fort' : st === 'away' ? `${left} m ?` : `${left} m`; key = 1; sort = -prog; }
      return { name: p.name, me, text, away: st === 'away', key, sort };
    }).sort((a, b) => a.key - b.key || a.sort - b.sort);
    mpHud.board(`Laf ${r + 1} / ${runs.length}`, rows);
    if (ph === 'prep') {
      const here = ctx.roster.filter((p) => p.id === ctx.me || race.status(p.id) === 'here');
      const ready = here.filter((p) => race.isReady(p.id)).length;
      const waiting = ctx.roster.some((p) => p.id !== ctx.me && race.status(p.id) === 'wait');
      mpHud.banner(local.ready !== r ? 'Pist gëtt gelueden …' : waiting ? `Verbënnt mat de Spiller … (${ready} / ${ctx.roster.length} prett)` : `Waart op d'Spiller … (${ready} / ${here.length} prett)`);
    } else mpHud.banner('');
    root.dataset.skiMpReady = String(ctx.roster.filter((p) => race.isReady(p.id)).length);
  }

  /* ---------- per frame ---------- */
  function frame(now) {
    // the start: hold -> 3-2-1 on the shared clock (wall time, so a slow frame never shifts anybody's start)
    if (local.goAt !== null && (game.phase === 'hold' || game.phase === 'countdown') && local.ready === race.run && !race.result(race.run, ctx.me)) {
      const rem = local.goAt - now;
      if (game.phase === 'hold' && rem <= 3000) game.phase = 'countdown';
      if (game.phase === 'countdown') game.countdown = Math.max(0.0001, rem / 1000);
    }
    if (game.phase === 'running' && local.started !== race.run && race.phase === 'go') { local.started = race.run; race.localStarted(race.run); }
    // my state for the others
    const racing = game.phase === 'running';
    const hz = racing ? NET.SEND_HZ : NET.IDLE_HZ;
    if (game.state && now - local.lastSend >= 1000 / hz) {
      local.lastSend = now;
      session.broadcast({ k: 's', r: race.run, t: Math.round(now), a: packState(game.state, game.run ? game.run.progress : 0, game.phase === 'finished') }, false);
    }
    if (local.spectate) { const rem = remotes.get(local.spectate); if (!rem || !rem.state || rem.state.finished) nextSpectate(); }
  }
  function render(now, time) {
    const c = host.canvas;
    remotes.update(now, time, c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
  }

  /* ---------- my run ---------- */
  function onFinish(result) {
    const r = race.run;
    race.localFinish(r, result);                 // main.js already marks a scripted run invalid (unless a flow opts in)
    const mine = race.result(r, ctx.me);
    if (race.phase === 'go') spectateBar(mine);
    refreshBoard();
  }
  function spectateBar(mine) {
    const text = `${mine && !mine.dnf ? (mine.valid ? `Am Zil: ${resText(mine, 'here')}` : 'Ongëlteg') : 'Opginn'} · waart op déi aner`;
    const target = local.spectate ? nameOf.get(local.spectate) : '';
    mpHud.bar(text, [{ label: target ? `👁 ${target} ▶` : '👁 Zuschauen', on: () => { nextSpectate(); spectateBar(mine); } }, ...(local.spectate ? [{ label: 'Op mech', on: () => { local.spectate = null; host.chase.snap(game.state); spectateBar(mine); } }] : [])]);
  }
  function nextSpectate() {
    const live = remotes.all().filter((r) => r.state && !r.state.finished && race.status(r.id) !== 'gone' && !race.result(race.run, r.id));
    if (!live.length) { local.spectate = null; return; }
    const i = live.findIndex((r) => r.id === local.spectate);
    local.spectate = live[(i + 1) % live.length].id;
    host.chase.snap(live[(i + 1) % live.length].state);
  }
  function viewState() { const r = local.spectate && remotes.get(local.spectate); return r && r.state ? r.state : null; }

  function onAction(action) {
    if (action === 'weather' || action === 'time') { hud.toast('Am Rennen ass d\'Wieder fir jiddereen d\'selwecht'); return true; }
    if (action === 'map' || action === 'confirm') return true;
    if (action === 'menu') { openMenu(); return true; }
    return false;
  }
  function openMenu() {
    if (mpHud.cardOpen) { if (!local.resultsCard) { mpHud.closeCard(); game.paused = false; input.setEnabled(game.phase === 'running'); } return; }
    const racing = game.phase === 'running' || game.phase === 'countdown';
    game.paused = game.phase === 'running';
    input.setEnabled(false);
    const resume = () => { game.paused = false; input.setEnabled(game.phase === 'running'); };
    mpHud.pause({
      buttons: [
        { id: 'resume', label: 'Weider', primary: true, on: resume },
        { id: 'sound', label: audio.isMuted() ? 'Toun un' : 'Toun aus', on: () => { audio.setMuted(!audio.isMuted()); resume(); } },
        ...(racing ? [{ id: 'quit', label: 'Opginn', ghost: true, on: () => { game.paused = false; game.phase = 'finished'; input.setEnabled(false); onFinish(null); } }] : []),
      ],
    });
  }

  async function begin() {
    root.dataset.skiMp = 'connecting';
    mpHud.show(true);
    mpHud.banner('Verbënnt …');
    if (race.phase === 'results' || race.phase === 'over') { /* restored after a reload: show where the match stood */ }
    try { await session.start(); } catch (error) { console.error('[ski-mp] no connection', error); mpHud.banner('Keng Verbindung: d\'Rennen leeft eleng weider'); }
    setInterval(() => race.tick(), TICK_MS);
    setInterval(refreshBoard, BOARD_MS);
    if (race.phase === 'results' || race.phase === 'over') { host.startRun(pisteOf(race.run)); game.phase = 'finished'; endRun(race.phase === 'over'); }
    else prepare(race.run);
    window.__skiMp = { race, session, remotes, runs, ctx, info: () => ({ run: race.run, phase: race.phase, coordinator: race.coordinator(), net: session.info(), standings: race.standings(), table: race.runTable(race.run) }) };
  }

  return { begin, frame, render, onFinish, onAction, viewState, get active() { return true; } };
}
