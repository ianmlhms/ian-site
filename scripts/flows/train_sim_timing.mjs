/* Zuchsimulator W5 timing: Offart / Ukommen. A driver at a normal pace must not stand at a stop for half a minute after the passengers are done (Ian: "sometimes even if you
 * don't drive too fast, you have to wait like 30 seconds after all passengers are finished, for tram and train").  Standalone game page; about two minutes.
 *   - the dwell model: exchangeSeconds follows what passengers.js measured, dwell = expected exchange (not a fixed 30 - 45 s), a crowd station gets more, the origin is not 75 s
 *   - the wait budget, driven by the scripted driver of scripts/zuch/drive_bot.mjs on a sample of routes (rail with three train types, three tram sections):
 *       90 % of the limits: median wait after the doors closed <= 5 s, no wait above 12 s (the origin's introduction included), nobody late
 *       97 % of the limits: nobody is late (> 30 s); 85 %: nobody is more than a minute late
 *   - early departure: pulling the lever up to 10 s before the scheduled time is free, earlier costs the fine
 *   - the HUD says why it waits (a driver that is far ahead of time sees "clear to depart in ..." and the reason)
 *   - a snapshot saved with the old timetable (30 - 45 s dwell, 75 s origin) still resumes with exactly those times */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';
import { driveService, summarize } from '../zuch/bot_lib.mjs';

const SAMPLE = [['west', 'railcar'], ['south', 'emu'], ['metz', 'kiss'], ['luxtram-stad', 'tram'], ['luxtram-sud', 'tram']];
const MEDIAN_WAIT_MAX = 5, WAIT_MAX = 12, LATE_MAX_90 = 30, LATE_MAX_85 = 60, EARLY_FREE_S = 10;
/* measured with scripts/zuch/exchange_probe.mjs (medium quality, means of 8 runs): [train, alighting, boarding, seconds]; the model must stay within 30 % */
const MEASURED = [['railcar', 25, 25, 31.9], ['railcar', 10, 12, 14.6], ['emu', 25, 25, 15.2], ['emu', 60, 50, 27.1], ['kiss', 40, 40, 18.2], ['ic', 100, 60, 29.5], ['hst', 150, 80, 54.4], ['tram', 25, 25, 24], ['tram', 100, 60, 46.8]];

export const flow = {
  name: 'train-sim-timing', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'medium' });

    h.step('dwell model: the exchange time of the real passenger module, dwell = expected exchange');
    await sim.start('west', 'emu', { lazy: true });
    const model = await sim.page.evaluate((measured) => {
      const T = window.TS.sim, trains = window.TS.config.trains;
      const trainOf = (id) => trains.find((x) => x.id === id);
      const fit = measured.map(([id, a, b, sec]) => ({ id, a, b, sec, model: T.exchangeSeconds(trainOf(id), a, b) }));
      const emu = trainOf('emu');
      const crowd = (plan) => { const w = __tsTest.internals().world; return T.buildTimetable(__tsTest.trackInfo(), emu, { rng: () => 0.5, plan, pass: [] }); };
      const plain = crowd({ incidents: [] }), crowded = crowd({ incidents: [{ kind: 'crowd', station: 2, factor: 1.8 }] });
      const dwellOf = (tt, i) => tt.stops[i].dep - tt.stops[i].arr;
      return {
        fit, monotone: T.exchangeSeconds(emu, 10, 10) < T.exchangeSeconds(emu, 30, 30) && T.exchangeSeconds(emu, 30, 30) < T.exchangeSeconds(emu, 80, 60),
        dwellPlain: [1, 2, 3, 4].map((i) => dwellOf(plain, i)), dwellCrowd2: dwellOf(crowded, 2), dwellPlain2: dwellOf(plain, 2), first: plain.stops[0].dep,
        tramFirst: null,
      };
    }, MEASURED);
    for (const f of model.fit) h.expect(Math.abs(f.model - f.sec) <= 0.3 * f.sec + 2, `${f.id} ${f.a}/${f.b}: model ${f.model.toFixed(1)} s vs measured ${f.sec} s`);
    h.expect(model.monotone, 'more passengers take longer');
    h.expect(model.dwellPlain.every((d) => d >= 18 && d <= 70), `dwells follow the exchange (${model.dwellPlain.join(', ')} s), no fixed 30 - 45 s block`);
    h.expect(model.dwellCrowd2 >= model.dwellPlain2 + 3, `a crowd station gets a longer dwell (${model.dwellPlain2} -> ${model.dwellCrowd2} s)`);
    h.expect(model.first >= 40 && model.first <= 60, `the origin departs after ${model.first} s, not after 75`);

    h.step('wait budget: scripted driver at 85 / 90 / 97 % of the limits');
    for (const [route, train] of SAMPLE) {
      await sim.start(route, train, { lazy: true });
      const tag = `${route} (${train})`;
      const r90 = summarize(await driveService(sim.page, { share: 0.9, leave: 'free' }));
      h.expect(r90.finished && r90.medWait <= MEDIAN_WAIT_MAX && r90.maxWait <= WAIT_MAX, `${tag} at 90 %: median wait ${r90.medWait} s (<= ${MEDIAN_WAIT_MAX}), max ${r90.maxWait} s (<= ${WAIT_MAX}), ${r90.stops} stops`);
      h.expect(r90.worstLate <= LATE_MAX_90, `${tag} at 90 %: worst lateness ${r90.worstLate} s`);
      await sim.start(route, train, { lazy: true });
      const r97 = summarize(await driveService(sim.page, { share: 0.97, leave: 'free' }));
      h.expect(r97.finished && r97.lateOver30 === 0, `${tag} at 97 %: nobody late (worst ${r97.worstLate} s, median wait ${r97.medWait} s, max ${r97.maxWait} s)`);
      await sim.start(route, train, { lazy: true });
      const r85 = summarize(await driveService(sim.page, { share: 0.85, leave: 'free' }));
      h.expect(r85.finished && r85.worstLate <= LATE_MAX_85, `${tag} at 85 %: worst lateness ${r85.worstLate} s (<= ${LATE_MAX_85})`);
    }

    h.step('early departure: the lever may go to power 10 s before the scheduled time; earlier than that is an early departure');
    await sim.start('west', 'railcar', { lazy: true });
    const early = await sim.page.evaluate(() => {
      const w = __tsTest.internals().world, sm = w.sim, P = 20;
      const doorCycle = (idx) => {
        __tsTest.teleport(idx); __tsTest.stopAtMarker(-0.8);
        let s = sm.step(0.1, { lever: -3, passengers: P, doorPress: true });          // open
        for (let k = 0; k < 60; k++) s = sm.step(0.1, { lever: -3, passengers: P });
        s = sm.step(0.1, { lever: -3, passengers: P, doorPress: true });              // close (2.2 s warning + 2 s closing)
        for (let k = 0; k < 50; k++) s = sm.step(0.1, { lever: -3, passengers: P });
        return s;
      };
      const driveOff = (s, firstLever) => {
        let lever = firstLever, ev = [];
        for (let k = 0; k < 300 && !ev.some((e) => e.type === 'departed'); k++) { s = sm.step(0.1, { lever, passengers: P }); ev = ev.concat(s.events); lever = 3; }
        return { early: ev.some((e) => e.type === 'earlyDeparture'), departed: ev.some((e) => e.type === 'departed'), totalsEarly: s.totals.early };
      };
      let s = doorCycle(1);
      const rushed = { waitAtClose: s.departureWaitSec, free: s.departFreeSec, ...driveOff(s, 3) };            // rushes off right away
      s = doorCycle(2);
      let guard = 0; while (s.departFreeSec > 0 && guard++ < 2000) s = sm.step(0.1, { lever: -3, passengers: P });
      const patient = { waitAtGo: s.departureWaitSec, ...driveOff(s, 3) };                                      // waits for "clear to depart", then goes
      return { rushed, patient };
    });
    h.expect(early.rushed.free > 0 && early.rushed.waitAtClose > 10, `the rushed driver stood ${early.rushed.waitAtClose.toFixed(1)} s before the scheduled time with the doors closed`);
    h.expect(early.rushed.early && early.rushed.departed, 'leaving at once is an early departure (fine)');
    h.expect(!early.patient.early && early.patient.departed && early.patient.waitAtGo <= EARLY_FREE_S + 0.2, `going when "clear to depart" shows (${early.patient.waitAtGo.toFixed(1)} s before the scheduled time) is free`);

    h.step('HUD: a driver that is ahead of time sees when the way is free, and why he waits');
    await sim.start('west', 'railcar', { lazy: true });
    const hud = await sim.page.evaluate(() => {
      const w = __tsTest.internals().world, sm = w.sim;
      __tsTest.teleport(1); __tsTest.stopAtMarker(-0.8);
      let s = sm.step(0.1, { lever: -3, passengers: 20, doorPress: true });          // open
      for (let k = 0; k < 60; k++) s = sm.step(0.1, { lever: -3, passengers: 20 });
      s = sm.step(0.1, { lever: -3, passengers: 20, doorPress: true });             // close
      for (let k = 0; k < 60; k++) s = sm.step(0.1, { lever: -3, passengers: 20 });
      return { phase: s.doorPhase, ready: s.readyToDepart, free: s.departFreeSec, wait: s.departureWaitSec, t: s.t, dep: s.scheduledDep };
    });
    h.expect(hud.phase === 'closed' && hud.ready, 'doors closed, ready to depart');
    h.expect(hud.free > 0 && Math.abs(hud.wait - hud.free - EARLY_FREE_S) < 0.2, `departFreeSec ${hud.free.toFixed(1)} s = the wait to the scheduled time (${hud.wait.toFixed(1)} s) minus ${EARLY_FREE_S} s`);
    await sim.frames(6);
    const text = await sim.page.evaluate(() => ({ hint: document.getElementById('hint').textContent, badge: document.querySelector('.depbadge') ? document.querySelector('.depbadge').textContent : '' }));
    h.expect(/fräi an|frei in|Clear to depart in/.test(text.badge), `the badge counts down to "clear to depart": ${text.badge}`);

    h.step('resume: a snapshot with the old timetable (30 - 45 s dwell, 75 s origin) still resumes with exactly those times');
    await sim.start('west', 'railcar', { lazy: true });
    const legacy = await sim.page.evaluate(() => {
      __tsTest.teleport(2); __tsTest.stopAtMarker(-0.8);
      if (!__tsTest.saveSnapshot()) return { saved: false };
      const o = JSON.parse(__tsTest.peekSnapshot()), n = o.tt.length;
      const oldRows = o.tt.map((r, i) => (i === 0 ? [0, 75] : i === n - 1 ? [r[0] + 40, r[0] + 40] : [r[0] + 40, r[0] + 40 + 30 + (i % 4) * 5]));
      o.tt = oldRows; o.ttt = oldRows[n - 1][0];
      __tsTest.pokeSnapshot(JSON.stringify(o)); __tsTest.toMenu();
      return { saved: true, rows: oldRows };
    });
    h.expect(legacy.saved, 'a snapshot could be saved at a stop');
    if (legacy.saved) {
      await sim.page.waitForFunction(() => window.__tsTest.state().resumeOffer, null, { timeout: 30000 });
      await sim.page.evaluate(() => __tsTest.resumeNow());
      await sim.page.waitForFunction(() => window.__tsTest.state().phase === 'running', null, { timeout: 60000 });
      const back = await sim.page.evaluate(() => __tsTest.state().timetable.map((x) => [x.arr, x.dep]));
      h.eq(back, legacy.rows, 'the resumed service keeps the old timetable rows exactly');
    }
    h.eq(sim.errors.filter((e) => !/404/.test(e)).slice(0, 5), [], 'no console errors or warnings from the game');
  },
};
runIfMain(import.meta.url, flow);
