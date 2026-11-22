/* The game modes inside main.js (round 4A): one object that main.js calls at a handful of points (run start / physics step / HUD tick /
 * finish / leaving a run / the piste map), so the modes stay in pb/ski/modes/ and main.js only gains small, marked hooks.
 *   run (every timed run)  the star challenge: tracker (falls, top speed, flags), the flags in the world, the stars and unlocks at the finish
 *   park                   the snow park run: stepPark physics, the trick judge, the score HUD, the park board (ski-<resort>-park)
 *   freeride               the whole area all day: the free run (counters, lifts), the day clock (light), the minimap, the lift button
 * Saves: stars / park points into the local progress (progress.js store) and the compact cloud record (cloud.js). */
import { MODES, SKI } from '../config.js';
import { stepSkier } from '../skier.js';
import { starKey, challengeFor, createTracker, addStars, resortStars, totalStars, lockState, pisteStars, migrateStars, outfitOpen, thresholds } from './challenges.js';
import { createParkLayout, stepPark, createTrickJudge, parkBoardId, parkBoardName, parkScoreOf, validParkPoints } from './park.js';
import { createLiftNet, createFreeRun, createDayClock, startHourFor, DAY } from './freeride.js';
import { createFlagsView, createParkView } from './views.js';
import { createMinimap } from './minimap.js';
import { createCloudSave, mergeCloud, cloudGain } from './cloud.js';
import { finishStarsHtml, showParkFinish, createFreeHud, parkHudText, trickToast } from './panel.js';
import { SKI_TYPES, skiStatsOf, skiUnlock } from './skis.js';

/** The park layout for field.js (call before createField). */
export const parkLayoutOf = (resort) => createParkLayout(resort.park);

const PARK_HINT_S = 14;                       // R8c: s of riding the park hint stays up

export function createModeHost(ctx) {
  const { scene, resort, rid, pistes, field, surface, store, hud, uiRoot, input, env, audio, world, layout, root, outfits } = ctx;
  const challenges = new Map();
  const challengeOf = (p) => { if (!p || p.id === 'park') return null; let c = challenges.get(p.id); if (!c) { c = challengeFor(p, field.farHeight); challenges.set(p.id, c); } return c; };
  const lifts = createLiftNet(resort, field.farHeight, pistes);
  let tracker = null, flags = null, judge = null, parkView = null, freeRun = null, clock = null, minimap = null, liftAt = null, parkBest0 = 0, clock0 = null;
  let parkHintT = 0;
  const freeHud = createFreeHud(hud.el, { onLift: () => ctx.onRideUp(), onSkis: () => ctx.onSkis && ctx.onSkis() });
  // round 6: the session's free ride counters live across challenges, fast travel and lift rides (one page life)
  const sessionStats = { distance: 0, vertical: 0, lifts: 0, top: 0, time: 0, off: 0 };
  const arcade = () => (window.Arcade && typeof window.Arcade.setBoard === 'function' && typeof window.Arcade.score === 'function' ? window.Arcade : null);

  // old saves: a piste with a best time has its first star; then the cloud copy (the arcade's injected save, then the cloud)
  store.set(migrateStars(store.get()));
  const cloud = createCloudSave({
    onIncoming(decoded) {
      const before = store.get();
      const after = mergeCloud(before, decoded);
      if (!cloudGain(before, after)) return;
      store.set(after);
      if (ctx.onProgressChanged) ctx.onProgressChanged();
    },
  });
  const saveCloud = () => cloud.push(store.get());

  const host = {
    lifts, layout, challengeOf, cloud,
    get judge() { return judge; }, get tracker() { return tracker; }, get freeRun() { return freeRun; }, get clock() { return clock; }, sessionStats,
    /** Round 6: what the player has done towards the ski unlocks, and the open ski ids. */
    skiStats: () => skiStatsOf(store.get(), totalStars(store.get())),
    openSkis() { const st = host.skiStats(); return SKI_TYPES.filter((t) => skiUnlock(t, st).open).map((t) => t.id); },
    start() { cloud.start(); },

    /* ---------------- stars, locks, outfits ---------------- */
    pisteInfo(p) {
      const prog = store.get();
      return { challenge: challengeOf(p), mask: pisteStars(prog, rid, p.id), lock: lockState(prog, rid, p), resortStars: resortStars(prog, rid) };
    },
    isOpen(p) { return !p || p.id === 'park' || lockState(store.get(), rid, p).open; },
    marks() {
      const prog = store.get();
      const stars = new Map(), locked = new Set();
      for (const p of pistes.list) {
        const m = pisteStars(prog, rid, p.id);
        if (m) stars.set(p.id, m);
        if (!lockState(prog, rid, p).open) locked.add(p.id);
      }
      return { stars, locked };
    },
    totalStars: () => totalStars(store.get()),
    outfitOpen: (o) => outfitOpen(o, totalStars(store.get())),
    parkBest: () => store.get().park[rid] || 0,

    /* ---------------- run start ---------------- */
    /** A run is starting (main.js startRun): set up the mode's parts. */
    begin(game) {
      host.end();
      if (game.mode === MODES.run) {
        const c = challengeOf(game.piste);
        tracker = c ? createTracker(c) : null;
        if (c && c.flags.length) flags = createFlagsView({ scene, flags: c.flags, height: (x, z) => surface.height(x, z), heading: Math.atan2(game.piste.at(0, {}).dz, game.piste.at(0, {}).dx) });
      } else if (game.mode === MODES.park && layout) {
        judge = createTrickJudge(layout);
        parkHintT = PARK_HINT_S;                     // R8c (QA: a straight run scored 0, nobody knew E jumps): the controls, bottom middle
        hud.hint(input.isTouch() ? 'Sprong mat ⤒ · Trick mat ✦' : 'Sprong mat E · Trick mat F (A / D dréinen) · W: ufueren');
        parkBest0 = store.get().park[rid] || 0;
        world.tricks = true;
        input.setTrick(true);
        host.ensureParkView();
        const a = arcade();
        if (a) { try { a.setBoard({ id: parkBoardId(rid), name: parkBoardName(resort.short), format: 'skipark' }); } catch (error) { console.warn('[ski] park board select failed', error.message); } }
      } else if (game.mode === MODES.freeride) {
        input.setTrick(true);
        world.tricks = 'hold';                       // round 6: in the air, the trick button turns a jump into a trick (skier.js)
        host.ensureParkView();                       // R7-D: the park's kickers / pipe are meshes the physics already reads: draw them from the start
        clock = clock0 || createDayClock(startHourFor(env.state.timeMode === 'random' ? 'morning' : env.state.timeId));      // a random time: the day from 9:00
        clock0 = clock;
        if (!minimap) minimap = createMinimap({ parent: hud.el.querySelector('.tr'), resort, imageUrl: root + resort.map.file, park: resort.park, onOpen: ctx.onMap || null });
        minimap.show(true);
        freeHud.show(true);
        hud.setClock(null, 0);
      }
    },
    /** The run object for a mode that is not a piste (main.js createRun stays the timed / guided one). */
    createRun(game, start) {
      if (game.mode !== MODES.freeride) return null;
      freeRun = createFreeRun({ resort, pistes, lifts, start, stats: sessionStats });
      return freeRun;
    },
    /** Round 6: a real lift ride starts (main.js): the lift counter, the day clock moves on by the ride's real time. */
    rideStart(lift) {
      if (!freeRun) return;
      if (clock) clock.addMinutes(lift.seconds / 60);
      freeRun.stats.lifts += 1;
      liftAt = null; freeHud.lift(null);
    },
    /** Round 6: the newly opened ski types between two progress states (for the toasts and the finish card). */
    newSkis(before, after) {
      const a = skiStatsOf(before, totalStars(before)), b = skiStatsOf(after, totalStars(after));
      return SKI_TYPES.filter((t) => !skiUnlock(t, a).open && skiUnlock(t, b).open);
    },
    freeHud,
    /** Leaving a run (map, another run): tear down the mode parts. */
    end() {
      if (flags) { flags.dispose(); flags = null; }
      tracker = null; judge = null; freeRun = null; liftAt = null;
      if (parkHintT > 0) { parkHintT = 0; hud.hint(''); }
      world.tricks = false;
      input.setTrick(false);
      freeHud.show(false); freeHud.lift(null);
      if (minimap) minimap.show(false);
      env.setDayHour(null);
      clock = null;
    },

    /* ---------------- physics ---------------- */
    /** One fixed step (main.js loop): rails everywhere a park exists, the park tricks in park mode. */
    step(prev, input2, mode) {
      if (layout && (mode === MODES.park || mode === MODES.freeride)) return stepPark(layout, prev, input2, world, SKI.dt);
      return stepSkier(prev, input2, world);
    },
    /** After a step: the challenge tracker, the trick judge, the free ride counters. Returns { respawn } when the mode wants one. */
    after(prev, cur, dt, game) {
      if (tracker && game.phase === 'running') {
        const taken = tracker.update(cur);
        if (taken >= 0) {
          if (flags) flags.take(taken);
          audio.event('gate');
          hud.toast(`Fändel ${tracker.flagsGot} / ${tracker.got.length}`, 1000);
        }
      }
      if (judge && game.phase === 'running') {
        if (parkHintT > 0) { parkHintT -= dt; if (parkHintT <= 0) hud.hint(''); }
        for (const ev of judge.update(prev, cur, dt)) {
          if (ev.type === 'trick') { hud.toast(trickToast(ev), 1700); audio.event(ev.quality === 'clean' ? 'gate' : 'miss'); }
          else if (ev.type === 'fall') hud.toast('Gefall: Kombo fort', 1300);
        }
      }
      if (clock && game.phase === 'running') clock.advance(dt);
    },
    /** A free run event (main.js run.update loop). */
    freeEvent(ev) {
      if (ev.type === 'lift' && ev.near) { if (!liftAt) hud.toast(`${ev.near.name}: op déi giel Plaz fueren fir anzesteigen`, 2600); return; }
      if (ev.type === 'lift') { liftAt = ev.lift; freeHud.lift(ev.lift); if (ev.lift) hud.toast(`Lift: ${ev.lift.name}`, 1200); }
    },
    /** HUD tick (10 Hz): the park score / the free ride block and minimap and light. */
    hudTick(game) {
      if (judge && game.mode === MODES.park) hud.setSplit(parkHudText(judge));
      if (freeRun && game.mode === MODES.freeride && game.state) {
        const fixed = env.state.timeMode !== 'random';
        env.setDayHour(fixed ? null : clock.hour);
        freeHud.set({ hour: clock.hour, stats: freeRun.stats, fixedTime: fixed });
        minimap.draw(game.state.x, game.state.z, Math.atan2(game.state.vz, game.state.vx) || game.state.heading, game.run && game.run.piste);      // map clarity: + the piste you are on
      }
    },

    /* ---------------- lifts ---------------- */
    get liftAt() { return liftAt; },
    /** Ride the lift at hand: the day clock moves on by its ride time; returns the start spot at its top (or null). */
    rideUp() {
      if (!freeRun || !liftAt) return null;                     // round 6: the lifts never close (free ride is the main game)
      const lift = liftAt;
      if (clock) clock.addMinutes(lift.seconds / 60);
      const spot = freeRun.rideUp(lift, (x, z) => surface.height(x, z));
      freeHud.lift(null);
      return { spot, lift };
    },

    /* ---------------- finish ---------------- */
    /** A timed run ended (finish event `ev`, valid or not): stars and unlocks. Returns the extra HTML for the finish card. */
    finishRun(ev, piste, assisted) {
      const c = challengeOf(piste);
      if (!c || !tracker) return '';
      const runMask = ev && !assisted ? tracker.evaluate(ev) : 0;
      const before = store.get();
      const key = starKey(rid, piste.id);
      const r = addStars(before, key, runMask);
      const unlocked = [];
      if (r.gained) {
        store.set(r.progress);
        const t = thresholds(rid), had = resortStars(before, rid), has = resortStars(r.progress, rid);
        void t; void had; void has; void outfits;
        for (const sk of host.newSkis(before, r.progress)) unlocked.push(`Ski ${sk.name}`);           // round 6: the stars open ski types
      }
      if (ev && ev.valid && !assisted && ev.ms > 0) {
        const bh = store.get().bestHash || {};
        if (!(bh[key] > 0) || ev.ms < bh[key]) store.set({ ...store.get(), bestHash: { ...bh, [key]: ev.ms } });
      }
      saveCloud();
      document.documentElement.dataset.skiStars = String(pisteStars(store.get(), rid, piste.id));
      return finishStarsHtml({ challenge: c, runMask, totalMask: pisteStars(store.get(), rid, piste.id), gained: r.gained, unlocked });
    },
    /** The park run reached the bottom: points, the record, the board. Shows the park card. */
    finishPark({ assisted, onAgain, onMap }) {
      if (!judge) return null;
      const points = judge.finish();
      const best0 = store.get().park[rid] || 0;
      const improved = !assisted && points > best0;
      if (improved) { store.set({ ...store.get(), park: { ...store.get().park, [rid]: points } }); saveCloud(); }
      const a = arcade();
      if (a && !assisted && validParkPoints(points)) {
        try { a.setBoard({ id: parkBoardId(rid), name: parkBoardName(resort.short), format: 'skipark' }); a.score(parkScoreOf(points)); } catch (error) { console.warn('[ski] park board submit failed', error.message); }
      }
      document.documentElement.dataset.skiPark = String(points);
      return showParkFinish(uiRoot, { name: layout.name, points, best: store.get().park[rid] || 0, improved, tricks: judge.tricks, assisted, onAgain, onMap });
    },

    /* ---------------- world upkeep ---------------- */
    ensureParkView() {
      if (!layout || parkView) return;
      // R7-D: the snow bodies are drawn in the terrain's material
      try { parkView = createParkView({ scene, layout, height: (x, z) => surface.height(x, z), snowMaterial: ctx.snowMaterial }); } catch (error) { console.warn('[ski] park view failed', error); }
    },
    /** A height tile arrived: the flags and the park sit on the new snow. */
    onTiles(rect) {
      if (flags && tracker) flags.reseat(tracker.got);
      if (parkView && layout) {
        const [x0, z0, x1, z1] = rect;
        const px = [layout.x0, layout.bottom.x], pz = [layout.z0, layout.bottom.z];
        if (Math.max(...px) + 60 > x0 && Math.min(...px) - 60 < x1 && Math.max(...pz) + 60 > z0 && Math.min(...pz) - 60 < z1) parkView.rebuild();
      }
    },
    update(cx, cz, radius) { if (parkView) parkView.update(cx, cz, radius); },
    DAY,
  };
  return host;
}
