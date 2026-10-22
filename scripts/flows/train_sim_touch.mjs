/* Lokféierer (train-sim) on an iPad WITHOUT a keyboard: everything by touch, through the arcade iframe.
 * Real touch events (CDP Input.dispatchTouchEvent -> pointer events with pointerType "touch"), no key is pressed anywhere:
 * the menu, the on-screen lever + buttons (doors, horn, lights, parking brake, timetable, announcement, emergency brake),
 * the HUD buttons (camera, pause, help, weather, reverse, 2x), two fingers at once, a Luxtram leg from stop to stop
 * (departure, speed control, braking to the marker, doors) and a CFL (railcar) stop. Layout: the controls are thumb-sized,
 * inside the screen and never cover the route strip, the clocks, the speed box or the other HUD buttons (portrait and landscape).
 * Supabase is mocked; no real account. */
import { runIfMain } from './lib.mjs';
import { gameFrame, openBothCareers, S, waitState } from './train_sim.mjs';

const LEVER_MAX = 5, SLOTS = 13;

/* Owner-only page gate + normal (not test) mode, like the keyboard flow. */
async function openArcade(h) {
  await h.signIn();
  await openBothCareers(h);
  await h.context.addInitScript(() => {
    try {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      const sess = JSON.parse(localStorage.getItem(k) || 'null');
      if (sess && sess.user) { sess.user.email = 'konto@ian.lu'; localStorage.setItem(k, JSON.stringify(sess)); }
    } catch (_) { /* ignore */ }
  });
  await h.goto('/pixelbreak.html?g=train-sim&test=1');
  const choice = h.page.locator('.pb-mode__box [data-mode="normal"]');
  await choice.waitFor({ state: 'visible', timeout: 15000 }).then(() => choice.click()).catch(() => {});
  return gameFrame(h);
}

/* Real touches. Coordinates are page (main frame) coordinates; locator.boundingBox() already is in that space, also inside the iframe. */
async function touchKit(h) {
  const cdp = await h.context.newCDPSession(h.page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
  const centre = async (loc) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box for ' + loc);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const kit = {
    centre,
    down: (pts) => send('touchStart', pts),
    move: (pts) => send('touchMove', pts),
    up: () => send('touchEnd', []),
    async tap(loc) { const c = await centre(loc); await send('touchStart', [c]); await h.pause(40); await send('touchEnd', []); },
    async hold(loc, ms) { const c = await centre(loc); await send('touchStart', [c]); await h.pause(ms); await send('touchEnd', []); },
  };
  return kit;
}

const railY = async (frame, n) => {
  const b = await frame.locator('#tlRail').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + ((LEVER_MAX - n + 0.5) / SLOTS) * b.height };
};
/* the lever by finger: start on the thumb (or the rail), drag to the notch */
async function dragLever(h, frame, kit, notch) {
  const cur = Math.max(-7, (await S(frame)).leverTarget);
  const a = await railY(frame, cur), z = await railY(frame, notch);
  await kit.down([a]);
  for (let i = 1; i <= 4; i++) await kit.move([{ x: a.x, y: a.y + ((z.y - a.y) * i) / 4 }]);
  await kit.up();
}

/* Layout: inside the screen, thumb-sized, not on top of the HUD. */
async function layoutProblems(frame, avoidSel) {
  return frame.evaluate((avoid) => {
    const R = (el) => el.getBoundingClientRect();
    const vis = (el) => { const r = R(el), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const mine = [...document.querySelectorAll('#tlRail,#tbEb,#touchBtns .tbtn')].filter(vis);
    const others = [...document.querySelectorAll(avoid)].filter(vis);
    const name = (el) => el.id || el.className.toString().slice(0, 24) || el.tagName;
    const out = { count: mine.length, outside: [], small: [], overlap: [] };
    for (const a of mine) {
      const ra = R(a);
      if (ra.left < 0 || ra.top < 0 || ra.right > innerWidth + 0.5 || ra.bottom > innerHeight + 0.5) out.outside.push(name(a));
      if (Math.min(ra.width, ra.height) < 44) out.small.push(name(a) + ' ' + Math.round(ra.width) + 'x' + Math.round(ra.height));
      for (const b of others) {
        const rb = R(b);
        if (ra.left < rb.right - 1 && ra.right > rb.left + 1 && ra.top < rb.bottom - 1 && ra.bottom > rb.top + 1) out.overlap.push(name(a) + ' x ' + name(b));
      }
    }
    return out;
  }, avoidSel);
}
const AVOID = '#strip,.statsbox,.nextbox,#btnMenu,.hud-util > *,.speedbox,.signalbox,#centerBox:not(.empty)';

/* Touch autopilot for one leg: speed up, coast, brake and creep to the marker with finger drags on the lever only. */
async function driveLegByTouch(h, frame, kit, stopIndex, seconds = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const s = await frame.evaluate(() => { const x = __tsTest.state(); return { v: x.v, d: x.distanceToHeading, lim: x.limitKmh, at: x.atStationIndex, tgt: x.leverTarget }; });
    if (s.v < 0.05 && s.at === stopIndex) return true;
    const brakeDist = (s.v * s.v) / (2 * 0.9);
    let want;
    if (s.d > brakeDist * 1.35 + 40 && s.v * 3.6 < s.lim - 6) want = 3;
    else if (s.d > brakeDist * 1.35 + 25) want = 0;
    else if (s.v > 2.2 || s.d > 6) want = s.d < 12 && s.v < 3 ? 0 : -4;
    else want = -5;
    if (s.v < 1.2 && s.d > 3 && s.d < 40) want = 1;
    if (want !== s.tgt) await dragLever(h, frame, kit, want);
    await h.pause(200);
  }
  return false;
}

/* Doors by touch: open, wait for the exchange, close. */
async function serveByTouch(h, frame, kit) {
  await kit.tap(frame.locator('#tbDoors'));
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'open', null, 20000);
  h.expect(await frame.locator('#tbDoors').evaluate((b) => b.classList.contains('on')), 'the doors button lights up while the doors are open');
  await waitState(frame, () => { const e = window.__tsTest.state().exchange; return e && e.done; }, null, 90000);
  await kit.tap(frame.locator('#tbDoors'));
  await waitState(frame, () => window.__tsTest.state().doorPhase === 'closed', null, 30000);
}

export const flow = {
  name: 'train-sim-touch', touch: true, fullChromium: true,
  backend: { tables: { game_saves: () => [], scores: () => [] } },
  async run(h) {
    const errors = [];
    h.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text() + ' @ ' + (m.location().url || '').slice(-60)); });
    const frame = await openArcade(h);
    const kit = await touchKit(h);
    await h.page.evaluate(() => { window.__keysSeen = 0; window.addEventListener('keydown', () => { window.__keysSeen++; }, true); });
    await frame.evaluate(() => { window.__keysSeen = 0; window.addEventListener('keydown', () => { window.__keysSeen++; }, true); });

    h.step('menu on the iPad: no keyboard-only notice, the Hiweiser toggle is free to tap, start the Luxtram career by touch');
    h.eq(await frame.locator('#kbNotice').count(), 0, 'no keyboard-only notice');
    h.expect((await S(frame)).touchUi, 'touch controls are on');
    const toggle = frame.locator('[data-test="hints-toggle"]');
    h.expect(await toggle.isVisible(), 'the Hiweiser toggle is visible');
    const covered = await toggle.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(top === el || el.contains(top)); });
    h.expect(!covered, 'nothing covers the Hiweiser toggle');
    await h.shot('menu-portrait');
    await kit.tap(frame.locator('[data-test="career-tram"]'));
    await h.pause(300);
    await kit.tap(frame.locator('[data-test="mode-career"]'));
    await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 120000);
    await frame.evaluate(() => { __tsTest.setSeed(20261013); __tsTest.setCalm(true); });
    await waitState(frame, () => window.__tsTest.cabSettled(), null, 30000);
    let s = await S(frame);
    h.eq([s.routeId.startsWith('luxtram'), s.camMode], [true, 'cab'], 'the Luxtram runs in the cab view (' + s.routeId + ')');

    h.step('portrait: the lever and the buttons sit on the screen, thumb-sized, clear of the HUD');
    let lay = await layoutProblems(frame, AVOID);
    h.eq(lay.count, 8, 'lever rail, EB and six buttons are shown');
    h.eq([lay.outside, lay.small, lay.overlap], [[], [], []], 'portrait cab: inside the screen, >= 44 px, no overlap with the HUD: ' + JSON.stringify(lay));
    h.expect(await frame.locator('#camName').isVisible() && await frame.locator('#btnPause').isVisible() && await frame.locator('#btnHelp').isVisible() && await frame.locator('#btnRev').isVisible(), 'camera, pause, help and reverse buttons stay reachable in the portrait cab view');
    await h.shot('cab-portrait');
    await h.pause(4500);
    const hintTxt = await frame.locator('#hint').innerText();
    h.expect(!/\b[DW]\b/.test(hintTxt.replace(/\bDieren\b/g, '')) && (await frame.locator('#hint kbd').count()) === 0, 'the coaching hint names no keys on a touch screen: "' + hintTxt + '"');
    const toastTxt = await frame.locator('#toasts').innerText();
    h.expect(/Hiewel/.test(toastTxt), 'a short touch hint toast is shown once: "' + toastTxt.replace(/\s+/g, ' ') + '"');

    h.step('HUD buttons by touch: 2x, camera cycle, weather, timetable, help, pause');
    await kit.tap(frame.locator('#btnFast'));
    h.expect((await S(frame)).fast, '2x fast-forward on');
    const cams = [];
    for (let i = 0; i < 5; i++) { await kit.tap(frame.locator('#camName')); await h.pause(150); cams.push((await S(frame)).camMode); }
    h.eq(cams, ['chase', 'platform', 'orbit', 'inside', 'cab'], 'tapping the camera name cycles the five cameras and comes back to the cab');
    await kit.tap(frame.locator('#camName')); await h.pause(150); await kit.tap(frame.locator('#camName')); await h.pause(300);
    h.expect(await frame.locator('#walkPad').isVisible(), 'camera 3 shows the walk pad');
    lay = await layoutProblems(frame, AVOID + ',#walkPad');
    h.eq([lay.outside, lay.small, lay.overlap], [[], [], []], 'camera 3: the walk pad does not sit on the lever or the buttons: ' + JSON.stringify(lay));
    await h.shot('platform-portrait');
    await kit.tap(frame.locator('#camName')); await kit.tap(frame.locator('#camName')); await kit.tap(frame.locator('#camName'));
    h.eq((await S(frame)).camMode, 'cab', 'back in the cab');
    await kit.tap(frame.locator('#btnWx'));
    await kit.tap(frame.locator('[data-test="wxpop-wx-rain"]'));
    await waitState(frame, () => window.__tsTest.state().weather === 'rain', null, 5000);
    h.eq((await S(frame)).weather, 'rain', 'weather changed to rain from the popover');
    await kit.tap(frame.locator('#btnWx'));
    await h.pause(200);
    await kit.tap(frame.locator('#tbTimetable'));
    h.expect(await frame.locator('#ttScreen').isVisible() && (await frame.locator('#ttBody tr').count()) > 3, 'the timetable opens by touch with its rows');
    await h.shot('timetable-portrait');
    await kit.tap(frame.locator('#ttClose'));
    h.expect(!(await frame.locator('#ttScreen').isVisible()), 'and closes by touch');
    await kit.tap(frame.locator('#btnHelp'));
    h.expect((await frame.locator('#helpBody').innerText()).includes('Touch'), 'help opens and explains the touch controls');
    await kit.tap(frame.locator('#helpClose'));
    await kit.tap(frame.locator('#btnPause'));
    h.eq((await S(frame)).paused, true, 'pause by touch');
    await kit.tap(frame.locator('#resume'));
    h.eq((await S(frame)).paused, false, 'resume by touch');
    await kit.tap(frame.locator('#btnRev'));
    await waitState(frame, () => window.__tsTest.state().reverse === true, null, 5000).catch(() => {});
    h.eq((await S(frame)).reverse, true, 'reverse on by touch');
    await kit.tap(frame.locator('#btnRev'));
    await waitState(frame, () => window.__tsTest.state().reverse === false, null, 5000).catch(() => {});
    h.eq((await S(frame)).reverse, false, 'reverse off by touch');

    h.step('buttons: lights, announcement, parking brake, horn (held), emergency brake');
    const lightBefore = (await S(frame)).lightLevel;
    await kit.tap(frame.locator('#tbLights'));
    await waitState(frame, (b) => window.__tsTest.state().lightLevel !== b, lightBefore, 5000);
    h.expect((await S(frame)).lightLevel !== lightBefore, 'lights change');
    await kit.tap(frame.locator('#tbAnnounce'));
    h.expect(/🔔/.test(await frame.locator('#toasts').innerText()), 'the announcement toast appears');
    await kit.tap(frame.locator('#tbPark'));
    await waitState(frame, () => window.__tsTest.state().parkingBrake === true, null, 5000);
    await frame.waitForFunction(() => document.getElementById('tbPark').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    h.expect(await frame.locator('#tbPark').evaluate((b) => b.classList.contains('on')), 'parking brake on, the button lights up');
    await kit.tap(frame.locator('#tbPark'));
    await waitState(frame, () => window.__tsTest.state().parkingBrake === false, null, 5000);
    await frame.waitForFunction(() => !document.getElementById('tbPark').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    const hornPos = await kit.centre(frame.locator('#tbHorn'));
    await kit.down([hornPos]);
    await h.pause(150);
    h.eq((await S(frame)).hornHeld, true, 'the horn sounds while the finger is down');
    await kit.up();
    await h.pause(150);
    h.eq((await S(frame)).hornHeld, false, 'and stops when the finger lifts');

    h.step('lever by finger: drag up = power, down = brake, EB button, two fingers at once (parking brake on, so the tram stays at the platform)');
    await kit.tap(frame.locator('#tbPark'));
    await waitState(frame, () => window.__tsTest.state().parkingBrake === true, null, 5000);
    await dragLever(h, frame, kit, 3);
    h.eq((await S(frame)).leverTarget, 3, 'drag to P3');
    await dragLever(h, frame, kit, -4);
    h.eq((await S(frame)).leverTarget, -4, 'drag to B4');
    h.eq(await frame.locator('#tlLabel').innerText(), 'B4', 'the thumb shows B4');
    await kit.tap(frame.locator('#tbEb'));
    h.eq((await S(frame)).leverTarget, -8, 'EB button = emergency brake');
    await dragLever(h, frame, kit, 0);
    h.eq((await S(frame)).leverTarget, 0, 'dragging the lever up releases the emergency brake and goes to 0');
    // left thumb on the lever, right thumb on the horn
    const thumb = await railY(frame, 0), up = await railY(frame, 2);
    await kit.down([{ ...thumb, id: 1 }, { ...hornPos, id: 2 }]);
    await kit.move([{ ...up, id: 1 }, { ...hornPos, id: 2 }]);
    await h.pause(100);
    s = await S(frame);
    h.eq([s.leverTarget, s.hornHeld], [2, true], 'two fingers: lever to P2 and the horn at the same time');
    await kit.up();
    await dragLever(h, frame, kit, 0);
    await kit.tap(frame.locator('#tbPark'));
    await waitState(frame, () => window.__tsTest.state().parkingBrake === false && window.__tsTest.state().atStationIndex === 0, null, 5000);

    h.step('landscape: the same controls, route strip and clocks stay free');
    await h.page.setViewportSize({ width: 1180, height: 820 });
    await h.pause(800);
    for (const cam of ['cab', 'chase']) {
      if (cam === 'chase') { await kit.tap(frame.locator('#camName')); await h.pause(500); }
      lay = await layoutProblems(frame, AVOID);
      h.eq([lay.count, lay.outside, lay.small, lay.overlap], [8, [], [], []], 'landscape ' + cam + ': inside the screen, >= 44 px, no overlap with the HUD: ' + JSON.stringify(lay));
      h.expect(await frame.locator('#strip').isVisible(), 'the route strip is visible in landscape ' + cam);
      await h.shot('landscape-' + cam);
    }
    await kit.tap(frame.locator('#camName')); await kit.tap(frame.locator('#camName')); await kit.tap(frame.locator('#camName')); await kit.tap(frame.locator('#camName'));
    h.eq((await S(frame)).camMode, 'cab', 'landscape: back in the cab');

    h.step('a Luxtram leg stop to stop by touch: doors, depart, speed, brake to the marker, doors');
    const stops = (await S(frame)).stations;
    h.expect(stops.length >= 3, 'the route has stops: ' + stops.length);
    await waitState(frame, () => window.__tsTest.state().atStationIndex === 0, null, 20000);
    await serveByTouch(h, frame, kit);
    await waitState(frame, () => { const x = window.__tsTest.state(); return x.readyToDepart && x.departureWaitSec <= 0; }, null, 120000);
    await dragLever(h, frame, kit, 3);
    await waitState(frame, () => window.__tsTest.state().kmh > 8, null, 30000);
    h.expect((await S(frame)).s > stops[0].s, 'the tram pulls away under touch power');
    h.expect(await driveLegByTouch(h, frame, kit, 1), 'the tram stops at the next stop (marker error ' + ((await S(frame)).stoppedAtMarkerError || 0).toFixed(1) + ' m)');
    s = await S(frame);
    h.expect(Math.abs(s.stoppedAtMarkerError) < 6 && s.atStationIndex === 1, 'stopped at stop 2 within the platform: ' + JSON.stringify([s.atStationIndex, s.stoppedAtMarkerError]));
    await serveByTouch(h, frame, kit);
    h.expect((await S(frame)).events.some((e) => /exchange|board|stop/i.test(JSON.stringify(e))) || (await S(frame)).visited.includes(1), 'stop 2 was served (counted as visited)');
    await h.shot('luxtram-stop2');

    h.step('a CFL (railcar) stop by touch');
    await frame.evaluate(() => __tsTest.toMenu());
    await waitState(frame, () => window.__tsTest.state().phase === 'menu', null, 30000);
    await kit.tap(frame.locator('[data-test="career-rail"]'));
    await h.pause(300);
    await kit.tap(frame.locator('[data-test="mode-career"]'));
    await waitState(frame, () => window.__tsTest.state().phase === 'running', null, 120000);
    await frame.evaluate(() => { __tsTest.setSeed(20261014); __tsTest.setCalm(true); });
    await waitState(frame, () => window.__tsTest.cabSettled(), null, 30000);
    s = await S(frame);
    h.eq([s.routeId, s.trainId], ['west', 'railcar'], 'the west line with the railcar');
    await kit.tap(frame.locator('#btnFast'));
    if (!(await S(frame)).fast) await kit.tap(frame.locator('#btnFast'));
    await serveByTouch(h, frame, kit);
    await waitState(frame, () => { const x = window.__tsTest.state(); return x.readyToDepart && x.departureWaitSec <= 0; }, null, 120000);
    await dragLever(h, frame, kit, 4);
    await waitState(frame, () => window.__tsTest.state().kmh > 15, null, 40000);
    h.expect(true, 'the railcar pulls away under touch power (' + Math.round((await S(frame)).kmh) + ' km/h)');
    await frame.evaluate(() => { __tsTest.teleport(1); });
    await waitState(frame, () => window.__tsTest.state().nextStationIndex === 1 && window.__tsTest.state().distanceToHeading < 80, null, 10000);
    h.expect(await driveLegByTouch(h, frame, kit, 1, 90), 'the railcar stops at the platform by touch braking');
    await serveByTouch(h, frame, kit);
    h.expect((await S(frame)).visited.includes(1), 'CFL stop 2 served by touch');
    await h.shot('cfl-stop2');

    h.eq(await frame.evaluate(() => window.__keysSeen) + await h.page.evaluate(() => window.__keysSeen), 0, 'not a single key was pressed');
    h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
    h.expect((await S(frame)).errors === 0, 'no frame errors');
  },
};

runIfMain(import.meta.url, flow);
