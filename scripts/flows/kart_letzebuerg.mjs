/* Kart Lëtzebuerg (solo; online play has its own flow, kart_letzebuerg_mp.mjs): menu, language, both tracks, touch HUD, a full race with results, restart, test hook gating.
 * Phase 3 (Grand Prix, time trial, boards, request budget, arcade tile) lives in kart_letzebuerg_arcade.mjs.
 * The standalone page is loaded directly. */
import { runIfMain } from './lib.mjs';

const URL_BASE = '/pb/kart-letzebuerg.html';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

async function waitState(h, fn, arg, timeout = 15000) { await h.page.waitForFunction(fn, arg, { timeout }); }
const state = (h) => h.page.evaluate(() => window.__klTest.state());

export const flow = {
  name: 'kart-letzebuerg', touch: true, fullChromium: true,
  async run(h) {
    const errors = [], foreign = [];
    h.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    h.page.on('request', (r) => { const host = hostOf(r.url()); if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== 'cdn.jsdelivr.net') foreign.push(host); });

    h.step('menu: tracks, weather, difficulty, drivers, modes');
    await h.goto(URL_BASE + '?test=1');
    await h.page.waitForSelector('#menu:not([hidden])', { timeout: 20000 });
    h.expect((await h.page.locator('#trackCards > *').count()) >= 2, 'track cards in race mode');
    h.expect((await h.page.locator('#weatherChips > *').count()) >= 5, 'weather chips (random + presets)');
    h.eq(await h.page.locator('#diffChips > *').count(), 3, 'three difficulties');
    h.eq(await h.page.locator('#driverChips > *').count(), 8, 'eight drivers');
    h.expect(!(await h.page.locator('#modeGp').isDisabled()) && !(await h.page.locator('#modeTt').isDisabled()) && !(await h.page.locator('#modeOnline').isDisabled()), 'race, Grand Prix, time trial and online are all enabled');
    await h.page.locator('#modeOnline').tap();
    h.expect(await h.page.locator('#onlineScreen').isVisible() && await h.page.locator('#olCreate').isVisible() && await h.page.locator('#olQuick').isVisible() && await h.page.locator('#olJoin').isVisible(), 'online entry screen offers create / quick match / join by code');
    await h.shot('online-entry');
    await h.page.locator('#olBack').tap();
    await h.page.waitForSelector('#menu:not([hidden])');
    await h.shot('menu');

    h.step('language switch lb -> de -> en');
    const titles = {};
    for (const lang of ['de', 'en', 'lb']) {
      await h.page.locator(`.langs [data-lang="${lang}"], .langs button:has-text("${lang.toUpperCase()}")`).first().tap();
      titles[lang] = await h.page.locator('#btnStart').innerText();
    }
    h.expect(new Set(Object.values(titles)).size === 3, 'start button text differs per language: ' + JSON.stringify(titles));

    h.step('start a race from the menu (track 2, night)');
    await h.page.locator('#trackCards > *').nth(1).tap();
    await h.page.locator('#weatherChips > *').filter({ hasText: /Nuecht|Nacht|Night|🌙/ }).first().tap();
    await h.page.locator('#btnStart').tap();
    await waitState(h, () => window.__klTest && window.__klTest.state().phase === 'countdown');
    let s = await state(h);
    h.eq(s.weather, 'night', 'night weather applied');
    for (const id of ['hud', 'touch', 'steerPad', 'bGas', 'bDrift', 'bItem', 'bBrake', 'minimap', 'hudPos', 'hudLap', 'hudTime']) h.expect(await h.page.locator('#' + id).isVisible(), id + ' visible');
    await waitState(h, () => window.__klTest.state().phase === 'race', null, 20000);
    h.expect(true, 'countdown ends and the race starts');
    await h.page.waitForTimeout(2500);
    s = await state(h);
    h.expect(s.kart.speed > 8, 'touch auto-gas moves the kart (' + s.kart.speed.toFixed(1) + ' m/s)');
    h.eq((await h.page.evaluate(() => window.__klTest.G.race.karts.length)), 8, '8 karts on the grid');
    await h.shot('race-night');

    h.step('finish a race with the autopilot and read the results');
    await h.page.evaluate(() => window.__klTest.sim(200, true));
    await h.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 20000 });
    const rows = await h.page.locator('#endList li').count();
    h.eq(rows, 8, 'results list has 8 rows');
    h.eq(await h.page.locator('#endList li.me').count(), 1, 'exactly one row is the player');
    const places = await h.page.locator('#endList li b').allInnerTexts();
    h.eq(places.join(''), '1.2.3.4.5.6.7.8.', 'places 1..8 in order');
    h.expect(/\d:\d\d\.\d\d\d/.test(await h.page.locator('#endSub').innerText()), 'results header shows race time and best lap');
    await h.shot('results');

    h.step('"again" restarts, "menu" returns');
    await h.page.locator('#eAgain').tap();
    await waitState(h, () => window.__klTest.state().phase === 'countdown' && !window.__klTest.state().results);
    h.expect(true, 'a new race starts');
    await h.page.evaluate(() => window.__klTest.menu());
    await h.page.waitForSelector('#menu:not([hidden])');
    h.expect(true, 'menu reachable again');

    h.step('both tracks: one-lap races finish, every weather preset applies');
    for (const track of ['villehaute', 'geeschterschlass']) {
      await h.goto(`${URL_BASE}?test=1&autostart=1&track=${track}&laps=1&bots=7&seed=3`);
      await waitState(h, () => window.__klTest && window.__klTest.state().phase === 'race', null, 25000);
      const info = await h.page.evaluate(() => ({ calls: __klTest.state().calls, tris: __klTest.state().tris }));
      h.expect(info.calls < 400, track + ': draw calls under 400 (' + info.calls + ')');
      for (const w of ['day', 'sunset', 'night', 'rain', 'fog']) { await h.page.evaluate((w) => window.__klTest.weather(w), w); }
      await h.page.evaluate(() => { __klTest.weather('night'); __klTest.sim(90, true); });
      await h.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 20000 });
      const res = await h.page.evaluate(() => __klTest.G.lastResult.rows.map((r) => ({ f: r.finished, p: r.place })));
      h.expect(res.length === 8 && res.every((r) => r.f), track + ': all 8 karts finish the lap');
    }

    h.step('test hook is absent in normal play; no network beyond the CDN; no off-site requests');
    await h.goto(URL_BASE);
    await h.page.waitForSelector('#menu:not([hidden])', { timeout: 20000 });
    h.expect(await h.page.evaluate(() => typeof window.__klTest === 'undefined'), 'no __klTest without ?test=1');
    h.eq([...new Set(foreign)], [], 'no off-site requests except cdn.jsdelivr.net');
    h.expect(errors.filter((e) => !/three\.js|three\.min\.js/.test(e)).length === 0, 'no console errors: ' + errors.join('; '));
  },
};
runIfMain(import.meta.url, flow);
