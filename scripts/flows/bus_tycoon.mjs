/* Real touch interactions, parent save messages and mocked cloud / event RPCs. */
import { runIfMain } from './lib.mjs';

const EVENT = 'halloween-2026';
let cloudSave = null, pumpkins = 0;
const eventStatus = () => ({ event: EVENT, active: true, count: pumpkins, goal: 50, badge: pumpkins >= 50 });
const seed = (overrides = {}) => ({ v: 1, p: 15, tb: 15, rb: 15, st: 0, rbc: 0, gd: '',
  owned: {}, upgrades: [], drivers: 0, savedAt: Date.now(), ...overrides });
async function frame(h) {
  await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.document.querySelector('#wave'));
  return h.page.frames().find(candidate => candidate.parentFrame());
}
async function saved(h) {
  await h.page.waitForFunction(() => localStorage.getItem('pb_save_bus-tycoon'));
  return h.page.evaluate(() => JSON.parse(localStorage.getItem('pb_save_bus-tycoon')));
}
async function noOverflow(h, game, label) {
  h.expect(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': hub fits');
  h.expect(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': game fits');
  h.expect(await game.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetWidth).every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)), label + ': touch targets at least 44px');
}
export const flow = {
  name: 'bus-tycoon', touch: true,
  backend: {
    tables: { game_saves: ({ method }) => method === 'GET' && cloudSave ? [{ data: cloudSave }] : [] },
    rpc: {
      touch_streak: () => ({ streak: 5, best: 5, is_new_day: false }),
      event_status: eventStatus,
      add_event_progress: ({ p_count }) => { pumpkins += p_count; return eventStatus(); },
    },
  },
  async run(h) {
    cloudSave = null; pumpkins = 0;
    const { page } = h;
    await h.signIn();
    // Only shorten the shared pumpkin spawn timer in this test, not game ticks.
    await h.context.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = function (fn, delay, ...args) {
        const spawn = typeof fn === 'function' && fn.toString().includes('spawnPumpkin');
        return original.call(this, fn, spawn ? 500 : delay, ...args);
      };
      window.__busMessages = [];
      window.addEventListener('message', event => {
        if (event.source === document.getElementById('gf')?.contentWindow && event.data?.__pbSave === 1) window.__busMessages.push(event.data);
      });
    });
    await h.goto('/pixelbreak.html');
    await page.locator('[data-genre="idle"]').tap();
    h.expect(await page.locator('.game-card img[src="pb/thumbs/bus-tycoon.webp"]').count() === 1, 'Bus Tycoon appears in idle category');
    await page.evaluate(save => localStorage.setItem('pb_save_bus-tycoon', JSON.stringify(save)), seed());
    await h.goto('/pixelbreak.html?g=bus-tycoon');
    let game = await frame(h);
    await game.locator('.idle-stars').waitFor();
    h.step('tap, business purchase and parent save');
    const before = await saved(h);
    await game.locator('#wave').tap(); await h.pause(100);
    h.expect((await saved(h)).tb > before.tb, 'tap earns lifetime passengers');
    await game.locator('[data-id="school"] button').tap(); await h.pause(300);
    const bought = await saved(h);
    h.eq(bought.owned.school, 1, 'buying first business persists ownership');
    h.expect((await game.locator('#income').innerText()) !== '0', 'business increases passive income');
    h.expect(await page.evaluate(() => window.__busMessages.some(message => typeof message.data.tb === 'number')), '__pbSave posts tb');
    await h.shot('first-route');

    h.step('higher cloud total and rebirth dialog');
    cloudSave = seed({ p: 5000, tb: 2e12, rb: 1e12, owned: { school: 1 }, drivers: 2, savedAt: Date.now() + 60000 });
    await h.goto('/pixelbreak.html?g=bus-tycoon&halloween=1'); game = await frame(h);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('pb_save_bus-tycoon') || '{}').tb >= 2e12);
    h.expect((await saved(h)).tb >= cloudSave.tb, 'higher tb cloud save is adopted through game_saves');
    await game.locator('.idle-rebirth').tap({ force: true });
    h.expect(await game.locator('.idle-dialog').isVisible(), 'rebirth dialog opens');
    h.expect((await game.locator('.idle-reset').innerText()).includes('drivers'), 'dialog describes resets');
    await game.locator('.idle-cancel').tap();
    h.expect(!(await game.locator('.idle-dialog').isVisible()), 'rebirth can be cancelled');
    await game.locator('.idle-rebirth').tap({ force: true });
    const lifetime = (await saved(h)).tb;
    await game.locator('.idle-confirm').tap(); await h.pause(100);
    const reborn = await saved(h);
    h.expect(reborn.tb >= lifetime, 'rebirth preserves lifetime');
    h.eq(reborn.st, 1, 'one trillion round earns one star');
    h.eq(reborn.rbc, 1, 'rebirth count increments');
    h.expect(Object.values(reborn.owned).every(n => n === 0) && reborn.drivers === 0 && reborn.upgrades.length === 0, 'lines, drivers and upgrades reset');
    // Old-round cloud with greater tb must not undo the stars / reset.
    await page.evaluate(save => document.getElementById('gf').contentWindow.postMessage({ __pbLoadSave: 1, data: save }, '*'), seed({ tb: 3e12, rb: 3e12, owned: { hyperloop: 1 } }));
    await h.pause(100);
    h.eq((await saved(h)).rbc, 1, 'stale cloud round cannot undo rebirth');
    h.eq((await saved(h)).owned.hyperloop, 0, 'stale cloud cannot restore old businesses');

    h.step('shared offline earnings, daily gift and Halloween pumpkin');
    cloudSave = null;
    await page.evaluate(save => localStorage.setItem('pb_save_bus-tycoon', JSON.stringify(save)), seed({ tb: 100, rb: 100, p: 100, owned: { school: 1 }, savedAt: Date.now() - 86400000 }));
    await h.goto('/pixelbreak.html?g=bus-tycoon&halloween=1'); game = await frame(h);
    await game.locator('.idle-away:not([hidden])').waitFor();
    const offline = await saved(h);
    h.expect(offline.tb >= 7300 && offline.tb < 7310, 'offline credits eight hours at 50%');
    await game.locator('.idle-gift:not([hidden])').waitFor();
    await game.locator('.idle-gift').tap(); await h.pause(100);
    const gifted = await saved(h);
    h.expect(gifted.tb >= offline.tb + 420, 'daily gift uses ten minutes × 1.4 streak');
    h.expect(!(await game.locator('.idle-gift').isVisible()), 'gift claimed only once');
    await game.locator('.idle-pumpkin').first().waitFor();
    const pumpkinBefore = (await saved(h)).tb;
    await game.locator('.idle-pumpkin').first().tap({ force: true }); await h.pause(100);
    h.expect((await saved(h)).tb >= pumpkinBefore + 15, 'pumpkin grants 30 seconds of production');
    await page.waitForFunction(() => document.getElementById('pbEventChip')?.textContent === '🎃 1 / 50');
    h.eq(h.backend.callsTo('add_event_progress')[0]?.body, { p_event: EVENT, p_count: 1 }, 'Bus Tycoon accepted by Halloween parent handler');

    for (const mode of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('site_theme', JSON.stringify({ mode: theme })), mode);
      await page.setViewportSize({ width: 820, height: 1180 });
      await h.goto('/pixelbreak.html?g=bus-tycoon'); game = await frame(h);
      h.eq(await game.evaluate(() => document.body.classList.contains('bus-light')), mode === 'light', mode + ' theme applied');
      await noOverflow(h, game, mode + ' iPad'); await h.shot(mode + '-ipad');
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(h, game, mode + ' phone'); await h.shot(mode + '-phone');
    }
    await game.evaluate(() => document.getElementById('game').scrollTop = 100000);
    h.expect(await game.locator('[data-id="hyperloop"] button').isVisible(), 'endgame and upgrades remain reachable');
    await h.shot('phone-upgrades');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    h.eq(await game.evaluate(() => getComputedStyle(document.querySelector('.bus')).animationName), 'none', 'reduced motion stops buses');

    h.step('Geometry Dash level count and existing progress');
    await page.evaluate(() => localStorage.setItem('gd-progress-v1', JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i === 0 ? 'geometrydash' : 'geometrydash-' + (i + 1), { best: 100, done: true, attempts: 2, bestRun: 1 }])))));
    await h.goto('/geometrydash.html');
    h.eq(await page.locator('#cards .card').count(), 15, 'GD select has fifteen levels');
    h.expect(!(await page.locator('.card[data-index="10"] .card__lock').count()), 'existing level 10 completion unlocks level 11');
    h.expect(!!(await page.locator('.card[data-index="11"] .card__lock').count()), 'level 12 waits for level 11 completion');
    h.expect((await page.locator('.card[data-index="0"]').innerText()).includes('Complete'), 'existing level 1 progress stays');
  },
};
runIfMain(import.meta.url, flow);
