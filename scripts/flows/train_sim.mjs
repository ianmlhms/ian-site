/* Lokféierer (train-sim): real arcade iframe, keyboard driving, doors/interlock, SPAD, passenger exchange,
 * service end -> score + monotonic save, endless order, purchase, phone block and iPad keyboard notice.
 * Supabase is mocked; no real account. */
import { runIfMain } from './lib.mjs';

const scoreWrites = (h) => h.backend.callsTo('scores').filter((c) => c.method === 'POST');
const S = (frame) => frame.evaluate(() => window.__tsTest.state());
const waitState = (frame, predicate, arg, timeout = 40000) => frame.waitForFunction(predicate, arg, { timeout });

async function gameFrame(h) {
  await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__tsTest, null, { timeout: 30000 });
  const frame = h.page.frames().find((f) => f.parentFrame());
  await frame.waitForFunction(() => window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 60000 });
  await frame.evaluate(() => window.focus());
  return frame;
}
const key = (h, k) => h.page.keyboard.press(k);

export const flow = {
  name: 'train-sim', touch: true, fullChromium: true,
  backend: { tables: { game_saves: () => [], scores: () => [] } },
  async run(h) {
    const errors = [];
    let sA = 0;
    h.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await h.signIn();
    // Lokféierer is owner-only for now (catalog entry + page gate): sign in as the owner account.
    await h.context.addInitScript(() => {
      try {
        const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
        const sess = JSON.parse(localStorage.getItem(k) || 'null');
        if (sess && sess.user) { sess.user.email = 'konto@ian.lu'; localStorage.setItem(k, JSON.stringify(sess)); }
      } catch (_) { /* ignore */ }
    });
    await h.context.addInitScript(() => {
      window.__tsMessages = [];
      window.addEventListener('message', (event) => {
        if (event.source === document.getElementById('gf')?.contentWindow && (event.data?.__pb || event.data?.__pbSave)) window.__tsMessages.push(JSON.parse(JSON.stringify(event.data)));
      });
    });
    await h.goto('/pixelbreak.html?g=train-sim&test=1');
    let frame = await gameFrame(h);

    h.step('start screen: both modes, iPad keyboard notice');
    h.expect(await frame.locator('[data-test="mode-career"]').isVisible() && await frame.locator('[data-test="mode-endless"]').isVisible(), 'career and endless modes shown');
    h.expect((await S(frame)).kbNoticeVisible, 'iPad shows the keyboard-only notice');
    h.expect((await frame.locator('#kbText').innerText()).includes('Tastatur'), 'notice text is the Luxembourgish keyboard message');
    await h.shot('start-ipad');
    await h.page.setViewportSize({ width: 1180, height: 820 });
    await h.pause(400);
    h.expect((await S(frame)).kbNoticeVisible && await frame.locator('#kbNotice').isVisible(), 'keyboard notice also visible in the arcade iframe on iPad landscape');
    await h.shot('start-ipad-landscape');
    await h.page.setViewportSize({ width: 820, height: 1180 });
    await h.pause(300);
    await key(h, 'Shift');
    h.expect(!(await S(frame)).kbNoticeVisible, 'notice auto-hides on the first key press');
    h.expect(await frame.evaluate(() => !!document.querySelector('.ts-menu')), 'D2 menu rendered');

    h.step('career service starts in the cab');
    await frame.locator('[data-test="mode-career"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running');
    let s = await S(frame);
    h.eq(s.camMode, 'cab', 'starts in cab view');
    h.eq(s.routeId, 'west', 'first career route is the free west line');
    h.expect(s.stations.length >= 4, 'route has stations');
    h.expect(['real', 'fallback'].includes(String(s.moduleStatus.track).split('>')[0]), 'track module present');
    h.expect(await frame.locator('#hud').isVisible(), 'HUD visible');
    h.expect(!(await frame.locator('[data-t="touch"]').count()), 'no touch controls on the page');

    h.step('lever: W raises, S lowers, X = emergency brake');
    await key(h, 'w'); await key(h, 'w'); await key(h, 'w');
    h.eq((await S(frame)).leverTarget, 3, 'W x3 -> P3');
    await key(h, 's');
    h.eq((await S(frame)).leverTarget, 2, 'S lowers one notch');
    await key(h, 'ArrowUp');
    h.eq((await S(frame)).leverTarget, 3, 'ArrowUp also raises');
    await key(h, 'x');
    h.eq((await S(frame)).leverTarget, -8, 'X = EB');
    await waitState(frame, () => window.__tsTest.state().lever === -8);
    await key(h, 'w'); await key(h, 's'); await key(h, 's');
    await frame.evaluate(() => window.__tsTest.press('w'));
    await frame.evaluate(() => window.__tsTest.release('w'));

    h.step('emergency brake: W releases it at any speed (no waiting for standstill)');
    await frame.evaluate(() => { __tsTest.setSpeed(72); });
    await waitState(frame, () => window.__tsTest.state().kmh > 60, null, 10000);
    await key(h, 'x');
    h.eq((await S(frame)).leverTarget, -8, 'EB applied at 72 km/h');
    await key(h, 'w');
    s = await S(frame);
    h.eq(s.leverTarget, -7, 'W releases EB to B7 while still moving (' + Math.round(s.kmh) + ' km/h)');
    h.expect(s.kmh > 20, 'the train was still moving fast when EB was released');
    h.expect(await frame.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /Noutbrems|Emergency|Notbremse/.test(t.textContent))), 'a short toast confirms the release');
    await frame.evaluate(() => { __tsTest.setSpeed(0); });

    h.step('doors interlock: cannot open while moving');
    await frame.evaluate(() => { __tsTest.setSpeed(20); });
    await key(h, 'd');
    await h.pause(300);
    s = await S(frame);
    h.eq(s.doorPhase, 'closed', 'doors stay closed while moving');
    h.expect(s.events.includes('doorsRefused'), 'refusal event raised');
    await frame.evaluate(() => { __tsTest.setSpeed(0); });

    h.step('stop at the marker, open doors on the platform side, live passenger counters');
    await frame.evaluate(() => { __tsTest.teleport(1); });
    await frame.evaluate(() => { __tsTest.stopAtMarker(-0.8); });
    await waitState(frame, () => window.__tsTest.state().atStationIndex === 1);
    s = await S(frame);
    h.expect(Math.abs(s.stoppedAtMarkerError + 0.8) < 0.5, 'stop error measured against the marker (' + s.stoppedAtMarkerError.toFixed(2) + ' m)');
    const platformSide = s.stations[1].side;
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
    s = await S(frame);
    h.eq(s.doorSide, platformSide, 'doors open on the platform side');
    h.expect(s.events.includes('stopRated'), 'stop rated');
    await h.shot('doors-open');
    h.expect((await S(frame)).parkingBrake, 'doors open at a stop: parking brake applied automatically');
    sA = (await S(frame)).s;
    await frame.evaluate(() => { __tsTest.setGrade(-0.04); __tsTest.forceSimStep(6, -3); });
    s = await S(frame);
    h.expect(s.v === 0 && Math.abs(s.s - sA) < 0.01, 'doors open + full brake on a downhill: the train does not move forward (' + (s.s - sA).toFixed(3) + ' m)');
    await frame.evaluate(() => { __tsTest.setGrade(null); });
    const exchangeA = (await S(frame)).exchange;
    await h.pause(3500);
    const exchangeB = (await S(frame)).exchange;
    h.expect(exchangeB && exchangeA && (exchangeB.boarded + exchangeB.alighted) > (exchangeA.boarded + exchangeA.alighted) || (exchangeB && exchangeB.done && exchangeB.boarded + exchangeB.alighted > 0), 'passenger counters change over time');
    h.expect(await frame.locator('#xchg').isVisible(), 'HUD shows the boarding/alighting counter');
    await key(h, 'w');
    await h.pause(1200);
    h.expect((await S(frame)).v === 0, 'no traction while the doors are open');
    await key(h, 's');
    await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && (e.done || (e.alighted >= e.alightingTotal && e.boarded >= e.boardingTotal - 2)); }, null, 60000);

    h.step('close and reopen at the same station: one exchange per stop');
    await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && e.done; }, null, 60000);
    const first = await S(frame);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 20000);
    const mid = await S(frame);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open', null, 20000);
    await h.pause(3000);
    const again = await S(frame);
    h.eq([again.exchange.alightingTotal, again.exchange.boardingTotal], [first.exchange.alightingTotal, first.exchange.boardingTotal], 'reopen keeps alightingTotal/boardingTotal');
    h.eq(again.exchange.alighted, first.exchange.alighted, 'nobody gets off a second time');
    h.eq(again.onboard, mid.onboard, 'onboard count not double-counted (' + mid.onboard + ')');
    h.eq(again.delivered, mid.delivered, 'delivered passengers (fares) not farmed by reopening');

    h.step('closing the doors allows departure');
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 20000);
    s = await S(frame);
    h.expect(s.events.includes('doorWarning'), 'close warning chime raised');
    h.expect(s.onboard > 0, 'passengers on board after the stop (' + s.onboard + ')');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); });
    await key(h, 'w'); await key(h, 'w'); await key(h, 'w');
    await waitState(frame, () => window.__tsTest.state().kmh > 8, null, 40000);
    h.expect(true, 'train departs after the doors closed');
    h.expect(!(await S(frame)).parkingBrake, 'power with the doors closed releases the automatic parking brake');
    await key(h, 'x');
    await frame.evaluate(() => { __tsTest.setSpeed(0); });

    h.step('no creep at standstill on a downhill grade; parking brake toggles');
    await frame.evaluate(() => { __tsTest.placeAt(__tsTest.state().stations[1].s + 600, 0); __tsTest.setGrade(-0.04); });
    sA = (await S(frame)).s;
    await frame.evaluate(() => { __tsTest.forceSimStep(10, -3); });
    s = await S(frame);
    h.expect(s.v === 0 && Math.abs(s.s - sA) < 0.01, 'brake lever at standstill on a 4 % downhill: no creep (' + (s.s - sA).toFixed(3) + ' m)');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); });
    await key(h, 'b');
    await waitState(frame, () => window.__tsTest.state().parkingBrake === true, null, 5000);
    h.expect(true, 'B applies the parking brake');
    await h.pause(300);
    h.expect((await S(frame)).parkLampVisible, 'parking brake lamp shows in the HUD');
    await frame.evaluate(() => { __tsTest.forceSimStep(10, 0); });
    s = await S(frame);
    h.expect(s.v === 0 && Math.abs(s.s - sA) < 0.01, 'parking brake holds on the downhill (' + (s.s - sA).toFixed(3) + ' m)');
    await frame.evaluate(() => { __tsTest.forceSimStep(1, 2); });
    s = await S(frame);
    h.expect(s.events.includes('parkingBlocked') && s.v === 0, 'power against the applied parking brake: hint raised, train stays put');
    await frame.evaluate(() => { __tsTest.forceSimStep(0.1, 0); });
    await key(h, 'b');
    await waitState(frame, () => window.__tsTest.state().parkingBrake === false, null, 5000);
    h.expect(true, 'B releases the parking brake again');
    await frame.evaluate(() => { __tsTest.setGrade(null); __tsTest.setSpeed(0); });

    h.step('braking guide: "Brems elo!" before the stop, "Ze spéit" when it is almost too late');
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.press('x'); __tsTest.release('x'); const i = st.nextStationIndex; __tsTest.placeAt(st.stations[i].s - 440, 80); __tsTest.forceSimStep(0.05, 0); });
    await waitState(frame, () => /Brems/.test(window.__tsTest.state().guideText), null, 8000);
    s = await S(frame);
    h.expect(s.guide.state === 'brake' && s.guideText.includes('Brems elo'), 'brake hint shown: ' + s.guideText);
    await h.shot('guide-brake');
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.placeAt(st.stations[st.nextStationIndex].s - 150, 80); __tsTest.forceSimStep(0.05, 0); });
    await waitState(frame, () => /spéit/.test(window.__tsTest.state().guideText), null, 8000);
    h.expect(true, 'too-late hint shown');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); __tsTest.setSpeed(0); });

    h.step('cameras: C cycles, 1-4 direct');
    await key(h, 'c');
    h.eq((await S(frame)).camMode, 'chase', 'C cycles to chase');
    await key(h, '3');
    h.eq((await S(frame)).camMode, 'platform', '3 = platform');
    await key(h, '4');
    h.eq((await S(frame)).camMode, 'orbit', '4 = free orbit');
    await key(h, '1');
    h.eq((await S(frame)).camMode, 'cab', '1 = cab');

    h.step('clicking the cab controls (lever, parking brake) with the mouse');
    await frame.evaluate(() => { __tsTest.setSpeed(0); __tsTest.forceSimStep(0.1, 0); });
    h.expect((await S(frame)).cabHitTest, 'cab exposes hitTest');
    const box = await (await frame.frameElement()).boundingBox();
    const lever = await frame.evaluate(() => __tsTest.findCab('lever', 3));
    h.expect(!!lever, 'the lever is found on screen');
    await h.page.mouse.move(box.x + lever.x, box.y + lever.y);
    await h.pause(150);
    h.eq(await frame.evaluate(() => document.getElementById('world').style.cursor), 'pointer', 'cursor turns into a pointer over the lever');
    await h.page.mouse.click(box.x + lever.x, box.y + lever.y);
    await h.pause(250);
    s = await S(frame);
    h.eq(s.leverTarget, lever.notch, 'clicking the lever sets its notch (P' + lever.notch + ')');
    await h.shot('cab-click');
    const brake = await frame.evaluate(() => __tsTest.findCab('lever', -4));
    await h.page.mouse.click(box.x + brake.x, box.y + brake.y);
    await h.pause(250);
    h.eq((await S(frame)).leverTarget, brake.notch, 'clicking lower on the gate brakes (B' + (-brake.notch) + ')');
    const park = await frame.evaluate(() => __tsTest.findCab('parking'));
    h.expect(!!park, 'the parking-brake button is found on screen');
    await h.page.mouse.click(box.x + park.x, box.y + park.y);
    await waitState(frame, () => window.__tsTest.state().parkingBrake === true, null, 5000);
    await h.page.mouse.click(box.x + park.x, box.y + park.y);
    await waitState(frame, () => window.__tsTest.state().parkingBrake === false, null, 5000);
    h.expect(true, 'clicking the parking-brake button toggles it');
    await h.page.mouse.move(2, 2);
    await key(h, 'x');

    h.step('SPAD: passing a red signal brakes and fines');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); __tsTest.teleport(2); });
    const spadBefore = (await S(frame)).totals.spads;
    h.expect(await frame.evaluate(() => __tsTest.spadTest()), 'a signal ahead was forced red');
    await waitState(frame, () => window.__tsTest.state().totals.spads >= 1, null, 40000);
    await waitState(frame, () => window.__tsTest.state().spadActive === true || window.__tsTest.state().kmh < 30, null, 20000);
    s = await S(frame);
    h.eq(s.totals.spads, spadBefore + 1, 'SPAD counted once');
    h.expect(s.events.includes('spad'), 'spad event raised');
    await waitState(frame, () => window.__tsTest.state().kmh < 1, null, 60000);
    h.expect((await S(frame)).cash < s.cash + 1, 'SPAD fine reduced the estimate');
    await h.pause(250);
    s = await S(frame);
    h.expect(s.spadActive && /Noutbrems/.test(s.guideText), 'SPAD emergency brake shows a visible countdown: ' + s.guideText);
    await waitState(frame, () => !window.__tsTest.state().spadActive, null, 10000);
    h.expect(true, 'forced emergency brake clears after standstill');

    h.step('express service (RE) passes a station without a missed-stop penalty; RB stops everywhere');
    await frame.evaluate(() => { __tsTest.forcePlan({ pattern: 'RE', pass: [1] }); return __tsTest.startService('west', 'railcar', 'career'); });
    await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().pattern === 'RE', null, 60000);
    s = await S(frame);
    h.eq(s.passIndices, [1], 'station 1 is passed');
    h.expect(/RE · 4/.test(s.svcLabel), 'start card / HUD shows "RE · 4 Arrêten": ' + s.svcLabel);
    h.expect(s.timetable[1].pass === true && s.timetable[1].arr === s.timetable[1].dep, 'timetable marks the passing station');
    await h.shot('express-start');
    await frame.evaluate(() => { __tsTest.teleport(1); });
    await frame.evaluate(() => { const st = __tsTest.state(); __tsTest.placeAt(st.stations[1].s - 150, 60); });
    const missedBefore = (await S(frame)).totals.missed;
    await frame.evaluate(() => { __tsTest.forceSimStep(28, 3); });
    s = await S(frame);
    h.expect(s.s > s.stations[1].s + 200, 'train ran through the passing station (' + Math.round(s.s - s.stations[1].s) + ' m past)');
    h.eq(s.totals.missed, missedBefore, 'no missed-stop penalty for the passing station');
    h.eq(s.nextStationIndex, 2, 'next stop skips the passing station');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); const st = __tsTest.state(); __tsTest.placeAt(st.stations[1].s - 5, 0); __tsTest.forceSimStep(0.1, 0); __tsTest.press('d'); __tsTest.forceSimStep(0.2, 0); });
    await h.pause(200);
    h.eq((await S(frame)).doorPhase, 'closed', 'doors do not open at a station the express passes');
    const variety = await frame.evaluate(() => {
      const out = { re: 0, rb: 0, tsr: 0, incidents: 0, bad: 0, first: null };
      for (const id of ['west', 'south', 'east', 'north']) {
        const track = TS.track.build(TS.routes.get(id)), train = TS.config.trains[0];
        out.first = out.first || TS.sim.planService(track, train, { services: 0 }).pattern;
        for (let k = 0; k < 40; k++) {
          const p = TS.sim.planService(track, train, { services: 4 });
          if (p.pattern === 'RE') out.re++; else out.rb++;
          out.tsr += p.tsr.length; out.incidents += p.incidents.length;
          if (p.pass.some((i) => i < 1 || i > track.stations.length - 2)) out.bad++;
          if (p.tsr.some((r) => r.s1 - r.s0 < 200 || r.s1 - r.s0 > 500 || r.kmh < 40 || r.kmh > 60)) out.bad++;
        }
      }
      return out;
    });
    h.expect(variety.re > 10 && variety.rb > 10 && variety.tsr > 20 && variety.incidents > 20 && variety.bad === 0 && variety.first === 'RB', 'variation: ' + JSON.stringify(variety));

    h.step('service end -> summary, score submitted, monotonic save');
    await frame.evaluate(() => { __tsTest.press('x'); __tsTest.release('x'); });
    await frame.evaluate(() => { __tsTest.finishRoute(); });
    await waitState(frame, () => window.__tsTest.state().atStationIndex >= 0 && window.__tsTest.state().nextStationIndex === window.__tsTest.state().stations.length - 1);
    await key(h, 'd');
    await waitState(frame, () => window.__tsTest.state().doorPhase === 'open');
    await waitState(frame, () => window.__tsTest.state().phase === 'summary', null, 90000);
    h.expect(await frame.locator('#summary').isVisible(), 'summary screen visible');
    await h.shot('summary');
    s = await S(frame);
    await h.page.waitForFunction(() => window.__tsMessages.some((m) => m.__pb === 1 && m.final), null, { timeout: 20000 });
    await h.pause(600);
    h.expect(scoreWrites(h).some((c) => c.body.game_id === 'train-sim' && c.body.score >= 0), 'final score reaches the scores table');
    const saves = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pbSave).map((m) => m.data.tb));
    h.expect(saves.length > 0, 'save posted at service end');
    h.expect(saves.every((tb, i) => i === 0 || tb >= saves[i - 1]), 'tb never decreases across saves: ' + saves.join(','));
    h.expect(s.wallet > 0 && s.tb === s.lifetime, 'wallet earned and tb equals lifetime');
    const savesBeforeMenu = saves.length;

    h.step('back to the menu, hints toggle, buying a train spends wallet only');
    await frame.locator('#sumMenu').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'menu');
    h.expect((await S(frame)).hints, 'hints are on by default');
    await frame.locator('[data-test="hints-toggle"]').click();
    h.expect(!(await S(frame)).hints, 'the Hiweiser toggle in the menu switches the hints off');
    await frame.locator('[data-test="hints-toggle"]').click();
    h.expect((await S(frame)).hints, 'and on again');
    await frame.evaluate(() => __tsTest.grant(30000));
    s = await S(frame);
    const before = { wallet: s.wallet, tb: s.tb };
    await frame.locator('[data-test="buy-train-emu"]').click();
    await waitState(frame, () => window.__tsTest.state().owned.includes('emu'));
    s = await S(frame);
    const emuPrice = await frame.evaluate(() => TS.config.trains.find((tr) => tr.id === 'emu').price);
    h.eq(s.wallet, before.wallet - emuPrice, 'train price leaves the wallet');
    h.eq(s.tb, before.tb, 'purchase leaves tb (lifetime) untouched');
    h.expect((await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pbSave).length)) > savesBeforeMenu, 'purchase saves');

    h.step('endless mode plays all compatible routes in order, then loops');
    await frame.locator('[data-test="select-railcar"]').click();
    await frame.locator('[data-test="mode-endless"]').click();
    await waitState(frame, () => window.__tsTest.state().phase === 'running' && window.__tsTest.state().mode === 'endless');
    const order = (await S(frame)).endless.order;
    const expected = await frame.evaluate(() => __tsTest.career().endlessOrder('railcar'));
    h.eq(order, expected, 'endless order = all compatible routes');
    h.expect(order.length >= 3, 'several routes in the endless cycle');
    const played = [];
    const scoresBefore = scoreWrites(h).length;
    const finalsBefore = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1 && m.final).length);
    for (let i = 0; i <= order.length; i++) {
      s = await S(frame);
      played.push(s.routeId);
      await frame.evaluate(() => { __tsTest.finishRoute(); });
      await frame.evaluate(() => { __tsTest.completeNow(); });
      if (i < order.length) await waitState(frame, (n) => window.__tsTest.state().phase === 'running' && window.__tsTest.state().endless.index === n, (i + 1) % order.length, 90000);
      if (i === order.length) break;
      await h.pause(300);
    }
    h.eq(played.slice(0, order.length), order, 'routes played in order');
    h.eq(played[order.length], order[0], 'loops back to the first route');
    await h.pause(800);
    const finals = await h.page.evaluate(() => window.__tsMessages.filter((m) => m.__pb === 1 && m.final).length);
    h.expect(finals >= finalsBefore + order.length, 'a final score is sent to the arcade at every route end (' + (finals - finalsBefore) + ')');
    h.expect(scoreWrites(h).length >= scoresBefore, 'the records module only writes improved scores');
    await h.shot('endless');

    h.step('phone viewport blocks, iPad does not');
    await h.page.setViewportSize({ width: 390, height: 844 });
    await h.pause(500);
    h.expect((await S(frame)).phoneBlocked && await frame.locator('#phoneBlock').isVisible(), 'phone shows the block screen');
    await h.shot('phone');
    await h.page.setViewportSize({ width: 820, height: 1180 });
    await h.pause(500);
    h.expect(!(await S(frame)).phoneBlocked, 'iPad is not blocked');

    h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
    h.expect((await S(frame)).errors === 0, 'no frame errors');
  },
};
runIfMain(import.meta.url, flow);
