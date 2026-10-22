/* Zuch- and Tramsimulator Lëtzebuerg: two arcade tiles, one game page, one save.
 * The arcade lists both tiles; each opens pb/train-sim.html locked to one career (the tile injects window.__tsCareerLock):
 * no career tabs, only that career's routes and vehicles (menu and endless order), its own title. Both tiles use the single
 * save pb_save_train-sim / game_saves "train-sim" (rail and tram wallets side by side; a tile only sets save.career), a
 * running service waits for its own tile, and the standalone page takes the lock from ?career=. Supabase is mocked. */
import { runIfMain } from './lib.mjs';

const SAVE_KEY = 'pb_save_train-sim';
const TILES = [
  { id: 'train-sim', name: 'Zuchsimulator Lëtzebuerg', career: 'rail', other: 'tram', foreign: /tram/i },
  { id: 'tram-sim', name: 'Tramsimulator Lëtzebuerg', career: 'tram', other: 'rail', foreign: /lux rail|lokféierer|zuchsimulator/i },
];
/* A cloud save that was last left on the rail career, with money in both wallets. */
const CLOUD_SAVE = { v: 2, tb: 21000, savedAt: 1700000000000, career: 'rail', hints: false, hintsSet: true, rail: { lifetime: 6000, wallet: 4000 }, tram: { lifetime: 15000, wallet: 12000 } };
const TRAM_GRANT = 1000;

const S = (frame) => frame.evaluate(() => window.__tsTest.state());
const localSave = (h) => h.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SAVE_KEY);

/* What the menu shows, read from the DOM and the career module. */
const menuFacts = (where) => where.evaluate(() => {
  const ids = (selector, strip) => [...document.querySelectorAll(selector)].map((n) => n.getAttribute('data-test').replace(strip, ''));
  const careersOf = (list, fn) => [...new Set(list.map(fn))];
  const routes = ids('[data-test^="route-"]', /^route-/);
  const trains = ids('[data-test^="select-"],[data-test^="buy-train-"]', /^(select|buy-train)-/);
  const s = window.__tsTest.state();
  const K = TS.career;
  return {
    lock: s.careerLock, career: s.career, tabs: document.querySelectorAll('[data-test^="career-"]').length, note: document.querySelectorAll('.ts-menu__careerNote').length,
    routes: routes.length, trains: trains.length,
    routeCareers: careersOf(routes, (r) => K.careerOfRoute(r)), trainCareers: careersOf(trains, (t) => K.careerOfTrain(t)),
    endlessCareers: careersOf(K.endlessOrder(s.saveTrain), (r) => K.careerOfRoute(r)),
    text: document.querySelector('.ts-menu').innerText, titleLabel: document.querySelector('.ts-menu__title').getAttribute('aria-label'), stamp: document.querySelector('.ts-menu__stamp').textContent,
    wallet: document.querySelector('[data-test="wallet"]').textContent,
  };
});

async function menuReady(frame) {
  await frame.waitForFunction(() => window.__tsTest && window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 60000 });
}
async function openTile(h, id) {
  await h.goto(`/pixelbreak.html?g=${id}&test=1`);
  await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__tsTest, null, { timeout: 30000 });
  const frame = h.page.frames().find((f) => f.parentFrame());
  await menuReady(frame);
  return frame;
}

export const flow = {
  name: 'train-sim-career-lock', fullChromium: true,
  backend: { tables: { game_saves: ({ method }) => (method === 'GET' ? [{ data: CLOUD_SAVE }] : []), scores: () => [] } },
  async run(h) {
    const errors = [];
    h.page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    await h.signIn();

    h.step('the arcade lists both tiles, train first, then tram');
    await h.goto('/pixelbreak.html');
    await h.page.waitForSelector('.game-card');
    const names = await h.page.$$eval('.game-card .game-name', (nodes) => nodes.map((n) => n.textContent));
    const [trainAt, tramAt] = TILES.map((tile) => names.indexOf(tile.name));
    h.expect(trainAt >= 0 && tramAt === trainAt + 1, `tiles "${TILES[0].name}" and "${TILES[1].name}" sit next to each other (${trainAt}, ${tramAt})`);
    const tramThumb = await h.page.$$eval('.game-card', (cards) => cards.filter((c) => c.querySelector('.game-name').textContent.startsWith('Tramsim')).map((c) => c.querySelector('img').getAttribute('src')));
    h.eq(tramThumb, ['pb/thumbs/tram-sim.webp'], 'the tram tile has its own thumbnail');

    h.step('the tram tile (clicked in the arcade) opens the tram career: no tabs, only Luxtram routes and vehicle');
    await h.page.locator('.game-card', { hasText: TILES[1].name }).first().click();
    // opening a tile drops ?test=1 from the URL, so there is no __tsTest here: read the DOM
    await h.page.waitForFunction(() => !!document.getElementById('gf')?.contentDocument?.querySelector('.ts-menu__title'), null, { timeout: 60000 });
    let frame = h.page.frames().find((f) => f.parentFrame());
    h.eq(await frame.locator('[data-test^="career-"]').count(), 0, 'no career tabs');
    h.eq(await frame.locator('.ts-menu__title').getAttribute('aria-label'), TILES[1].name, 'menu title');
    h.expect(await frame.locator('[data-test^="route-"]').evaluateAll((nodes) => nodes.length > 0 && nodes.every((n) => /^route-luxtram/.test(n.getAttribute('data-test')))), 'only Luxtram route cards');
    h.eq(new URL(h.page.url()).searchParams.get('g'), 'tram-sim', 'the URL is ?g=tram-sim');
    h.expect((await h.page.title()).startsWith(TILES[1].name), 'the arcade title is the tram tile name');

    for (const tile of [TILES[1], TILES[0]]) {
      h.step(`?g=${tile.id}: locked to ${tile.career}, cloud save adopted but pinned to ${tile.career}`);
      frame = await openTile(h, tile.id);
      const f = await menuFacts(frame);
      const s = await S(frame);
      h.eq([f.lock, f.career], [tile.career, tile.career], 'lock and career');
      h.eq([f.tabs, f.note], [0, 0], 'no career tabs, no wallet note');
      h.expect(f.routes > 0 && f.trains > 0, `route cards (${f.routes}) and vehicle cards (${f.trains}) shown`);
      h.eq([f.routeCareers, f.trainCareers, f.endlessCareers], [[tile.career], [tile.career], [tile.career]], 'routes, vehicles and the endless order are all of this career');
      h.eq(f.titleLabel, tile.name, 'menu title');
      h.expect(!tile.foreign.test(f.text), `the menu text says nothing about the ${tile.other} career (${tile.foreign}): ${(f.text.match(new RegExp('.{0,30}' + tile.foreign.source + '.{0,30}', 'i')) || [''])[0].replace(/\s+/g, ' ')}`);
      h.eq([s.careers.rail.wallet, s.careers.tram.wallet, s.tb], [4000, 12000, 21000], 'the shared cloud save arrived with both wallets');
      h.eq(await frame.evaluate(() => document.getElementById('sumStamp').textContent.replace(/^\S+\s/, '')), tile.name.toUpperCase(), 'summary stamp');
    }

    h.step('both tiles read and write the one cloud row "train-sim"');
    const cloudCalls = h.backend.callsTo('game_saves').filter((c) => c.method === 'GET');
    h.expect(cloudCalls.length >= 2 && cloudCalls.every((c) => /game_id=eq\.train-sim\b/.test(c.query)), `every cloud load asked for game_id train-sim (${cloudCalls.length} loads)`);
    h.expect(!JSON.stringify(h.backend.callsTo('game_saves')).includes('tram-sim'), 'no call mentions a tram-sim save');

    h.step('earning on the tram tile lands in the one save, the rail wallet stays untouched');
    frame = await openTile(h, 'tram-sim');
    await frame.evaluate((cash) => window.__tsTest.grant(cash, 'tram'), TRAM_GRANT);
    await h.page.waitForFunction((key) => !!localStorage.getItem(key), SAVE_KEY);
    const keys = await h.page.evaluate(() => Object.keys(localStorage).filter((k) => /^pb_save_/.test(k)));
    h.eq(keys, [SAVE_KEY], 'a single local save key: pb_save_train-sim');
    let saved = await localSave(h);
    h.eq([saved.career, saved.rail.wallet, saved.tram.wallet], ['tram', 4000, 12000 + TRAM_GRANT], 'saved: career tram, rail wallet untouched, tram wallet +1000');
    h.eq([saved.rail.lifetime, saved.tram.lifetime], [6000, 15000 + TRAM_GRANT], 'both lifetimes kept');

    h.step('the train tile sees the same save: tram progress is there, but it shows the rail career');
    frame = await openTile(h, 'train-sim');
    let s = await S(frame);
    h.eq([s.career, s.careers.tram.wallet, s.careers.rail.wallet], ['rail', 12000 + TRAM_GRANT, 4000], 'rail career on top, tram wallet carried over');
    h.expect((await menuFacts(frame)).wallet.replace(/\D/g, '') === '4000', 'the wallet shown is the rail wallet');
    await frame.evaluate(() => window.__tsTest.grant(500, 'rail'));
    await h.pause(300);
    saved = await localSave(h);
    h.eq([saved.career, saved.rail.wallet, saved.tram.wallet], ['rail', 4500, 12000 + TRAM_GRANT], 'saved: career rail, tram wallet untouched');

    h.step('a running service waits for its own tile (one resume slot per tile)');
    frame = await openTile(h, 'train-sim');
    const snapshot = await frame.evaluate(() => {
      const train = 'railcar';
      const order = TS.career.endlessOrder(train);
      const text = JSON.stringify({ v: 1, at: Date.now(), mode: 'endless', fresh: 1, route: order[0], train, svc: 0, life: 0, en: { order, i: 0, loops: 0, cash: 0, pts: 0 } });
      return { text, check: { rail: TS.resume.check(text, { save: TS.career.normalize(JSON.parse(localStorage.getItem('pb_save_train-sim'))), lock: 'rail' }), tram: TS.resume.check(text, { save: TS.career.normalize(JSON.parse(localStorage.getItem('pb_save_train-sim'))), lock: 'tram' }) } };
    });
    h.expect(!!snapshot.check.rail.snap, 'rail snapshot is valid on the rail tile');
    h.eq([snapshot.check.tram.reject, snapshot.check.tram.keep], ['other career', true], 'and rejected on the tram tile, but kept');
    await frame.evaluate((text) => window.__tsTest.pokeSnapshot(text), snapshot.text);
    frame = await openTile(h, 'train-sim');
    h.expect(await frame.locator('[data-test="resume-card"]').count() === 1, 'the train tile offers the saved service');
    frame = await openTile(h, 'tram-sim');
    h.eq(await frame.locator('[data-test="resume-card"]').count(), 0, 'the tram tile does not');
    h.expect(await h.page.evaluate(() => localStorage.getItem('pb_resume_train-sim_rail') !== null), 'the rail snapshot is still stored');
    frame = await openTile(h, 'train-sim');
    h.expect(await frame.locator('[data-test="resume-card"]').count() === 1, 'and the train tile still offers it afterwards');

    h.step('standalone page: ?career=tram / ?career=rail lock, no param keeps both careers, a bad value is ignored');
    for (const [query, lock] of [['?career=tram&test=1', 'tram'], ['?career=rail&test=1', 'rail'], ['?test=1', null], ['?career=bus&test=1', null]]) {
      await h.goto('/pb/train-sim.html' + query);
      await menuReady(h.page);
      const f = await menuFacts(h.page);
      h.eq([f.lock, f.tabs > 0], [lock, lock === null], `${query}: lock ${lock}, career tabs ${lock === null ? 'shown' : 'hidden'}`);
      if (lock) {
        h.eq([f.career, f.routeCareers, f.trainCareers], [lock, [lock], [lock]], `${query}: only the ${lock} career`);
        h.expect((await h.page.title()).startsWith(lock === 'tram' ? 'Tramsimulator' : 'Zuchsimulator'), `${query}: page title`);
      }
    }

    h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
  },
};

runIfMain(import.meta.url, flow);
