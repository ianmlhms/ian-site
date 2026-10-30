/* Zuch & Tram Sim: a running service follows the account across devices (Weiderfueren from the cloud).
 * The game posts every write/removal of its resume snapshot to the arcade (parent), which mirrors it into game_resume (throttled, deletes at once)
 * and hands the account's rows back when the game opens. Device A = the first page load, device B = the same browser after the local
 * pb_resume_* / pb_save_* keys were wiped. Supabase is mocked; game_resume behaves like the table (the older snap_at never wins) and the
 * cloud career save arrives AFTER the resume row, so the offer must show up once the save merges. Test mode must never touch the table. */
import { runIfMain, fakeJwt, ME, ME_NAME } from './lib.mjs';

const SESSION_KEY = 'sb-lvksqmgfwkfbblfsozfk-auth-token';
const OWNER_EMAIL = 'konto@ian.lu';
const SLOT = 'train-sim_rail';                  // the Zuch tile ("train-sim", career lock rail)
const CLOUD_SAVE = { v: 2, tb: 9000, savedAt: 1700000000000, career: 'rail', hints: false, hintsSet: true, rail: { lifetime: 6000, wallet: 100, services: 3 }, tram: { lifetime: 0, wallet: 0 } };
let saveGate = null;                            // while set, the cloud career save is held back: it comes later than the resume row
const HOUR_MS = 3600 * 1000;

const rows = new Map();                         // slot -> row, like the table
const colon = (value) => (value || '').replace(/^[a-z]+\./, '');
const table = ({ url, method, body }) => {
  if (method === 'GET') return [...rows.values()];
  if (method === 'POST') {   // upsert; the table's trigger refuses an update with an older snap_at
    for (const row of [].concat(body)) {
      const old = rows.get(row.slot);
      if (!old || Date.parse(row.snap_at) >= Date.parse(old.snap_at)) rows.set(row.slot, row);
    }
    return [];
  }
  if (method === 'DELETE') {
    const slot = colon(url.searchParams.get('slot')), upTo = url.searchParams.get('snap_at');
    const old = rows.get(slot);
    if (old && (!upTo || Date.parse(old.snap_at) <= Date.parse(colon(upTo)))) rows.delete(slot);
    return [];
  }
  return [];
};

const calls = (h, method) => h.backend.calls.filter((c) => c.name === 'game_resume' && (!method || c.method === method));
const sessionFor = (email) => {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: fakeJwt(), refresh_token: 'refresh-mock', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email, user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
};
const S = (frame) => frame.evaluate(() => window.__tsTest.state());

async function openTrain(h) {
  await h.goto('/pixelbreak.html?g=train-sim&test=1');
  await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__tsTest, null, { timeout: 30000 });
  const frame = h.page.frames().find((f) => f.parentFrame());
  await frame.waitForFunction(() => window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 60000 });
  return frame;
}
/* a new device: leave the arcade first (its pagehide writes the save back), then empty the keys on a plain same-origin page */
const wipeDevice = async (h) => {
  await h.goto('/pb/train-sim/resume.js');
  await h.page.evaluate(() => { for (const key of Object.keys(localStorage)) if (/^pb_(resume|save)_/.test(key)) localStorage.removeItem(key); });
};
const waitCareerSave = (frame) => frame.waitForFunction(() => window.__tsTest.state().careers.rail.services === 3, null, { timeout: 30000 });

export const flow = {
  name: 'train-sim-resume-cloud', fullChromium: true,
  backend: {
    tables: {
      game_resume: table,
      game_saves: async ({ method }) => { if (method !== 'GET') return []; if (saveGate) await saveGate.promise; return [{ data: CLOUD_SAVE }]; },
      scores: () => [],
    },
  },
  async run(h) {
    const errors = [];
    h.page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    await h.signIn();

    h.step('device A: a service is running; its first snapshot is uploaded at once to the rail slot');
    let frame = await openTrain(h);
    await waitCareerSave(frame);
    await frame.evaluate(() => window.__tsTest.startService('west', 'railcar', 'career'));
    await frame.waitForFunction(() => window.__tsTest.state().phase === 'running' && window.__tsTest.state().simT > 0.3, null, { timeout: 60000 });
    await frame.evaluate(() => window.__tsTest.teleport(1));
    await frame.waitForFunction(() => window.__tsTest.state().atStationIndex === 1 || window.__tsTest.state().s > 100, null, { timeout: 30000 });
    h.expect(await frame.evaluate(() => window.__tsTest.saveSnapshot()), 'the snapshot was written');
    await h.pause(800);
    const first = calls(h, 'POST');
    h.eq(first.length, 1, 'one upsert to game_resume');
    const sent = first[0] && first[0].body;
    h.eq(sent && [sent.user_id, sent.slot], [ME, SLOT], 'user_id and slot (train-sim_rail)');
    // (the running game also saves every few seconds on its own: compare the upload with itself, not with whatever the key holds by now)
    const upload = sent && JSON.parse(sent.data);
    h.expect(upload && upload.v === 1 && upload.route === 'west' && upload.train === 'railcar' && upload.mode === 'career', 'data is the snapshot text of the running service');
    h.eq(sent && sent.snap_at, upload && new Date(upload.at).toISOString(), 'snap_at is the snapshot time');
    h.expect(first[0] && /on_conflict=user_id(%2C|,)slot/.test(first[0].query), 'upsert on (user_id,slot)');
    h.expect(rows.has(SLOT) && rows.size === 1, 'the table holds exactly that row');

    h.step('throttle: a second save within a minute waits, __pbFlushSave sends it');
    await frame.evaluate(() => window.__tsTest.forceSimStep(0.5, 4));
    h.expect(await frame.evaluate(() => window.__tsTest.saveSnapshot()), 'a second snapshot was written');
    await h.pause(500);
    h.eq(calls(h, 'POST').length, 1, 'no second upload inside the minute');
    await h.page.evaluate(() => window.__pbFlushSave());
    await h.pause(500);
    h.eq(calls(h, 'POST').length, 2, 'the pending one went up on flush');
    h.expect(JSON.parse(rows.get(SLOT).data).at > upload.at, 'the cloud row is the newer snapshot');

    h.step('device B (empty storage, same account): the menu offers Weiderfueren once the career save has merged');
    await wipeDevice(h);
    saveGate = {};
    saveGate.promise = new Promise((resolve) => { saveGate.open = resolve; });
    frame = await openTrain(h);
    await h.page.waitForFunction(() => localStorage.getItem('pb_resume_train-sim_rail') !== null, null, { timeout: 15000 });
    const early = await S(frame);
    h.eq([early.careers.rail.services, early.resumeOffer], [0, false], 'resume row first, career save still on its way: no card yet (save older than the snapshot) ...');
    h.expect(await h.page.evaluate(() => localStorage.getItem('pb_resume_train-sim_rail') !== null), '... but the snapshot is kept in the storage');
    saveGate.open(); saveGate = null;
    await frame.waitForSelector('[data-test="resume-card"]', { timeout: 30000 });
    h.eq((await S(frame)).careers.rail.services, 3, 'the career save arrived');
    h.expect(/west|Westen|Ouest/i.test(await frame.locator('[data-test="resume-card"]').innerText()) || (await S(frame)).resumeOffer, 'the card shows the service from device A');
    const stored = await h.page.evaluate(() => localStorage.getItem('pb_resume_train-sim_rail'));
    h.eq(stored, rows.get(SLOT).data, 'the cloud snapshot is now in this device\'s storage');
    await frame.locator('[data-test="resume-go"]').click();
    await frame.waitForFunction(() => window.__tsTest.state().phase === 'running', null, { timeout: 60000 });
    const resumed = await S(frame);
    h.eq([resumed.routeId, resumed.trainId, resumed.mode], ['west', 'railcar', 'career'], 'resumed the same route and train');

    h.step('discarding the service ("Neies Service") deletes the cloud row');
    await frame.evaluate(() => window.__tsTest.toMenu());
    await frame.waitForSelector('[data-test="resume-card"]', { timeout: 30000 });
    await frame.locator('[data-test="resume-new"]').click();
    await h.pause(700);
    const del = calls(h, 'DELETE').pop();
    h.expect(!!del && !rows.has(SLOT), 'DELETE sent, the table row is gone');
    h.expect(del && del.query.includes(`user_id=eq.${ME}`) && del.query.includes(`slot=eq.${SLOT}`), 'delete is scoped to user and slot: ' + (del && del.query));
    h.eq(await h.page.evaluate(() => localStorage.getItem('pb_resume_train-sim_rail')), null, 'and the local key is gone');

    h.step('a cloud row that fails the check (expired) is thrown away: locally and in the cloud');
    const expired = { v: 1, at: Date.now() - 30 * HOUR_MS, mode: 'endless', fresh: 1, route: 'west', train: 'railcar', svc: 3, life: 3000, en: { order: ['west'], i: 0, loops: 0, cash: 0, pts: 0 } };
    rows.set(SLOT, { user_id: ME, slot: SLOT, data: JSON.stringify(expired), snap_at: new Date(expired.at).toISOString(), updated_at: new Date().toISOString() });
    const deletesBefore = calls(h, 'DELETE').length;
    await wipeDevice(h);
    frame = await openTrain(h);
    await waitCareerSave(frame);
    await h.pause(800);
    h.eq(await frame.locator('[data-test="resume-card"]').count(), 0, 'no card for an expired snapshot');
    h.eq(await h.page.evaluate(() => localStorage.getItem('pb_resume_train-sim_rail')), null, 'it is not kept locally');
    h.expect(calls(h, 'DELETE').length > deletesBefore && !rows.has(SLOT), 'the game asked for the row to be deleted and the table no longer has it');

    h.step('a local ride the cloud does not have goes up when the train sim opens (older device)');
    const ride = { v: 1, at: Date.now() - 60000, mode: 'endless', fresh: 1, route: 'west', train: 'railcar', svc: 3, life: 3000, en: { order: await frame.evaluate(() => TS.career.endlessOrder('railcar')), i: 0, loops: 0, cash: 0, pts: 0 } };
    await h.page.evaluate((text) => localStorage.setItem('pb_resume_train-sim_rail', text), JSON.stringify(ride));
    const postsBefore = calls(h, 'POST').length;
    frame = await openTrain(h);
    await h.pause(1000);
    h.expect(calls(h, 'POST').length > postsBefore && rows.has(SLOT) && JSON.parse(rows.get(SLOT).data).at === ride.at, 'the local snapshot was uploaded');
    await frame.evaluate(() => window.__tsTest.pokeSnapshot(null));
    await h.pause(500);
    h.expect(!rows.has(SLOT), 'discarding it removes the row again');

    h.step('arcade test mode (owner) never touches game_resume');
    await h.page.context().addInitScript(([key, session]) => { localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem('playerName', 'ian'); }, [SESSION_KEY, sessionFor(OWNER_EMAIL)]);
    rows.set(SLOT, { user_id: ME, slot: SLOT, data: JSON.stringify(ride), snap_at: new Date(ride.at).toISOString(), updated_at: new Date().toISOString() });
    await wipeDevice(h);
    const totalBefore = calls(h).length;
    await h.goto('/pixelbreak.html?g=train-sim&test=1');
    await h.page.locator('.pb-mode__box [data-mode="test"]').click();
    await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__tsTest, null, { timeout: 30000 });
    frame = h.page.frames().find((f) => f.parentFrame());
    await frame.waitForFunction(() => window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 60000 });
    h.expect(await frame.evaluate(() => window.__pbTestMode === true && window.__tsTest.state().arcadeTest), 'the game is in arcade test mode');
    await frame.evaluate(() => window.__tsTest.pokeSnapshot(JSON.stringify({ v: 1, at: Date.now(), mode: 'endless', fresh: 1, route: 'west', train: 'railcar', svc: 0, life: 0, en: { order: ['west'], i: 0, loops: 0, cash: 0, pts: 0 } })));
    await frame.evaluate(() => window.__tsTest.startService('west', 'railcar', 'career'));
    await frame.waitForFunction(() => window.__tsTest.state().phase === 'running', null, { timeout: 60000 });
    await frame.evaluate(() => window.__tsTest.teleport(1));
    await frame.evaluate(() => window.__tsTest.saveSnapshot());
    await frame.evaluate(() => window.__tsTest.pokeSnapshot(null));
    await h.pause(900);
    await h.page.evaluate(() => window.__pbFlushSave());
    await h.page.evaluate(() => window.closeGame());
    await h.pause(500);
    h.eq(calls(h).length, totalBefore, 'not one request to game_resume (no read, no upload, no delete) in test mode');
    h.expect(rows.has(SLOT), 'the cloud row is untouched');
    h.eq(await h.page.evaluate(() => localStorage.getItem('pb_resume_train-sim_rail')), null, 'test mode left the real resume key alone');

    h.expect(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' | '));
  },
};

runIfMain(import.meta.url, flow);
