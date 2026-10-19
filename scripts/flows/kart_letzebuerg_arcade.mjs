/* Kart Lëtzebuerg inside the arcade (phase 3): the tile, the game frame, time trial with ghost, Grand Prix, personal records,
 * leaderboard writes through the arcade's own API (signed in as the test user), the Supabase request budget, the 🎃 hint.
 * Supabase is mocked (lib.mjs); nothing reaches the real project. */
import { runIfMain } from './lib.mjs';

const GAME_ID = 'kart-letzebuerg';
const SCORE_BASE = 1000000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOARD_ROWS = [{ user_id: 'u-1', username: 'Anna', score: 953000 }, { user_id: 'u-2', username: 'Ben', score: 940000 }];

async function gameFrame(h) {
  await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow?.__klTest);
  const frame = h.page.frames().find((f) => f.parentFrame());
  await frame.waitForSelector('#menu:not([hidden])', { timeout: 30000 });
  return frame;
}

export const flow = {
  name: 'kart-letzebuerg-arcade', fullChromium: true,
  backend: {
    tables: {
      // the user's own best (maybeSingle) is empty; the public board lists two other players
      scores: ({ method, url }) => (method === 'GET' ? (/user_id=eq/.test(url.search) ? [] : BOARD_ROWS) : []),
      game_saves: () => [],
    },
  },
  async run(h) {
    const errors = [];
    h.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const posts = (from) => h.backend.calls.slice(from).filter((c) => c.name === 'scores' && c.method === 'POST');
    const supa = (from) => h.backend.calls.slice(from).filter((c) => c.kind === 'table' || c.kind === 'rpc' || c.kind === 'function');
    const desc = (calls) => calls.map((c) => c.method + ' ' + c.name).join(', ');
    await h.signIn();

    /* ---------------- the tile ---------------- */
    h.step('arcade tile: Kart Lëtzebuerg is listed with thumbnail, description and multiplayer tag; 🎃 hint only in the Halloween window');
    await h.goto('/pixelbreak.html');
    const card = h.page.locator('.game-card', { hasText: 'Kart Lëtzebuerg' }).first();
    await card.waitFor({ timeout: 20000 });
    h.expect(await card.isVisible(), 'the tile is visible');
    await card.scrollIntoViewIfNeeded();
    h.expect(await card.locator('.game-desc').innerText().then((t) => /kart|Kart/.test(t) && t.length > 40), 'the big tile carries a description');
    h.expect(/Multiplayer/i.test(await card.locator('.game-tags').innerText()), 'tile has the multiplayer tag');
    h.eq(await card.locator('.tag', { hasText: '🎃' }).count(), 0, 'no 🎃 outside the event window');
    const thumbOk = await card.locator('img').evaluate((img) => new Promise((res) => { if (img.complete) res(img.naturalWidth); else img.onload = () => res(img.naturalWidth); setTimeout(() => res(0), 5000); }));
    h.expect(thumbOk >= 600, 'thumbnail loads (' + thumbOk + ' px wide)');
    const group = await h.page.evaluate(() => { const c = [...document.querySelectorAll('.game-card')].find((x) => /Kart Lëtzebuerg/.test(x.textContent)); const sec = c && c.closest('section, .big-group, div[class*="group"]'); return sec ? sec.textContent.slice(0, 80) : ''; });
    h.expect(group.length > 0, 'tile sits inside a section');
    await h.goto('/pixelbreak.html?halloween=1');
    h.expect(await h.page.locator('.game-card', { hasText: 'Kart Lëtzebuerg' }).first().locator('.tag', { hasText: '🎃' }).count() === 1, '🎃 tag on the tile during the Halloween event');
    await h.shot('arcade-tile');

    /* ---------------- open the game in the arcade frame ---------------- */
    h.step('open the game from the tile: menu, no injected score reporter, invite link origin');
    await h.goto('/pixelbreak.html?g=' + GAME_ID + '&test=1');
    let F = await gameFrame(h);
    h.expect(await F.evaluate(() => !document.documentElement.innerHTML.includes('function rep()')), 'the 0.8 s score reporter is not injected into this game');
    h.expect(await F.locator('#modeGp').isEnabled() && await F.locator('#modeTt').isEnabled(), 'Grand Prix and time trial are enabled');
    const origin = await F.evaluate(() => ({ loc: location.origin, win: window.origin }));
    h.expect(origin.win === new URL(h.origin).origin, 'window.origin inside the frame is the site origin (' + JSON.stringify(origin) + ')');
    h.eq(await F.evaluate(() => { __klTest.KL.Lobby.code = 'ABCD'; const u = __klTest.KL.inviteUrl(); __klTest.KL.Lobby.code = ''; return u; }), new URL(h.origin).origin + '/pb/kart-letzebuerg.html?room=abcd&role=guest', 'the invite link built inside the arcade frame points at the site (not "null")');
    await h.shot('arcade-menu');
    const callsAtOpen = h.backend.calls.length;

    /* ---------------- time trial ---------------- */
    h.step('time trial: no bots, no item boxes, ghost of the best lap, records and boards written once, budget');
    await F.locator('#modeTt').click();
    h.expect(await F.locator('#diffBox').isHidden(), 'time trial has no difficulty (no bots)');
    await F.locator('#trackCards > *').first().click();
    const ttFrom = h.backend.calls.length;
    await F.locator('#btnStart').click();
    await F.waitForFunction(() => window.__klTest.state().phase === 'countdown');
    h.eq(await F.evaluate(() => [__klTest.G.race.karts.length, __klTest.G.race.mode, __klTest.G.race.boxes.every((b) => !b.active)]), [1, 'tt', true], 'one kart, mode tt, item boxes off');
    h.expect(await F.evaluate(() => !__klTest.G.ghost), 'no ghost yet on a fresh profile');
    await F.evaluate(() => { __klTest.sim(3.5, true); __klTest.sim(150, true); });
    await F.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 20000 });
    h.eq(await F.locator('#endList li').count(), 3, 'results list the 3 lap times');
    const sv = await F.evaluate(() => __klTest.save());
    h.expect(sv.ghosts.villehaute && sv.ghosts.villehaute.g.startsWith('g1:') && sv.ghosts.villehaute.g.length < 12000, 'best-lap ghost saved compactly (' + (sv.ghosts.villehaute && sv.ghosts.villehaute.g.length) + ' chars)');
    h.expect(sv.bests.villehaute && sv.bests.villehaute.lap && sv.bests.villehaute.race, 'personal records saved');
    await sleep(1500);
    const tp = posts(ttFrom).map((c) => ({ id: c.body.game_id, score: c.body.score }));
    h.eq(tp.map((x) => x.id).sort(), ['kart-letzebuerg-lap-villehaute', 'kart-letzebuerg-race-villehaute'], 'the finished time trial writes exactly its two boards');
    h.expect(tp.every((x) => x.score > 0 && x.score < SCORE_BASE), 'scores are 1000000 - milliseconds: ' + JSON.stringify(tp));
    h.expect(posts(ttFrom).every((c) => c.body.game_name && /Kart/.test(c.body.game_name)), 'rows carry the game name');
    const ttCalls = supa(ttFrom);
    h.expect(ttCalls.length <= 8, 'time trial: Supabase requests stay low (' + ttCalls.length + ': ' + desc(ttCalls) + ')');
    // cloud save: one compact ghost per track, sent to the arcade's save once (improved only)
    const saves = await h.page.evaluate(() => JSON.parse(localStorage.getItem('pb_save_kart-letzebuerg') || 'null'));
    h.expect(saves && saves.ghosts && saves.ghosts.villehaute && Object.keys(saves.ghosts).length === 1, 'the arcade save holds exactly one ghost (this track)');
    const sent0 = await F.evaluate(() => __klTest.boards().length);
    const worse = await F.evaluate(() => __klTest.KL.Progress.onRaceDone({ track: 'villehaute', laps: 3, lapTimes: [99, 99, 99], finished: true, time: 297 }));
    h.eq([worse.lap, worse.race, await F.evaluate(() => __klTest.boards().length)], [false, false, sent0], 'a slower run beats nothing and writes nothing');
    await h.shot('tt-results');
    // the arcade 🏆 shows this track's board with a formatted time
    await F.evaluate(() => __klTest.KL.Boards.open('lap', 'villehaute'));
    await h.page.waitForSelector('.pb-modal.open .pb-row', { timeout: 8000 });
    const modal = await h.page.locator('.pb-modal.open').innerText();
    h.expect(/Kart Lëtzebuerg · Uewerstad · Beschte Ronn/.test(modal), 'the board is titled with game, track and kind: ' + modal.split('\n')[1]);
    h.expect(/0:47\.000|0:47\.\d{3}/.test(modal) && /Anna/.test(modal), 'scores show as m:ss.mmm (953000 -> 0:47.000)');
    await h.page.locator('.pb-modal.open .pb-x').click();
    await F.locator('#eAgain').click();
    await F.waitForFunction(() => window.__klTest.state().phase === 'countdown' && !window.__klTest.state().results);
    h.expect(await F.evaluate(() => !!__klTest.G.ghost && __klTest.G.renderer.ghost !== null), 'the next run starts with the ghost of the best lap');
    await F.evaluate(() => { __klTest.sim(3.5, true); __klTest.sim(12, true); });
    await h.shot('tt-ghost');
    await F.evaluate(() => __klTest.menu());

    /* ---------------- Grand Prix ---------------- */
    h.step('Grand Prix (Fantasy cup): 4 races, points, table, final result, request budget');
    await F.locator('#modeGp').click();
    h.expect((await F.locator('#trackCards > *').count()) >= 2, 'cups are listed');
    await F.locator('#trackCards > *').nth(1).click();
    const gpFrom = h.backend.calls.length;
    await F.locator('#btnStart').click();
    const tables = [];
    for (let r = 0; r < 4; r++) {
      await F.waitForFunction(() => window.__klTest.state().phase === 'countdown' && !window.__klTest.state().results);
      h.eq(await F.evaluate(() => __klTest.session().idx), r, 'GP race ' + (r + 1) + ' of 4 starts');
      await F.evaluate(() => { __klTest.sim(4, true); __klTest.sim(200, true); });
      await F.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 20000 });
      await F.waitForFunction(() => !/…/.test(document.getElementById('endSub').textContent), null, { timeout: 10000 });
      tables.push(await F.evaluate(() => Object.fromEntries(Object.entries(__klTest.session().table).map(([k, v]) => [k, v.pts]))));
      if (r < 3) { h.expect(await F.locator('#eNext').isVisible() && await F.locator('#eAgain').isHidden(), 'between races: "next race" is offered, "again" is not'); await F.locator('#eNext').click(); }
    }
    h.eq(await F.locator('#endList li').count(), 8, 'final table has 8 drivers');
    h.eq(Object.values(tables[3]).reduce((a, b) => a + b, 0), 4 * 39, '4 races x 39 points handed out in total (10+8+6+5+4+3+2+1)');
    h.expect(/Grand Prix Resultat|Grand Prix result|Grand-Prix-Ergebnis/.test(await F.locator('#endTitle').innerText()), 'final screen shows the Grand Prix result');
    await h.shot('gp-final');
    await sleep(1500);
    const gp = posts(gpFrom).map((c) => c.body.game_id);
    h.expect(gp.length <= 5 && gp.every((id) => /^kart-letzebuerg-(lap|race)-geeschterschlass$|^kart-letzebuerg-gp$/.test(id)), 'Grand Prix writes only improved boards (' + gp.join(', ') + ')');
    const gpCalls = supa(gpFrom);
    h.expect(gpCalls.length <= 16, 'Grand Prix: Supabase requests stay low (' + gpCalls.length + ': ' + desc(gpCalls) + ')');
    h.expect(await F.locator('#eAgain').isVisible(), 'a finished Grand Prix offers another round');
    // no polling: nothing else happens on the wire while the result screen idles
    await sleep(4000);                                   // the arcade's 3 s debounced cloud save of the finished Grand Prix lands first (not polling)
    const idleFrom = h.backend.calls.length;
    await sleep(6000);
    h.eq(h.backend.calls.slice(idleFrom).map((c) => c.method + ' ' + c.name), [], 'no Supabase traffic while the menu/result screen idles (6 s)');
    h.expect(h.backend.calls.slice(callsAtOpen).length <= 30, 'whole session (time trial + Grand Prix) stays within 30 requests (' + h.backend.calls.slice(callsAtOpen).length + ')');
    /* ---------------- stage 2a: the three real tracks ---------------- */
    h.step('Kirchberg, Grund, Belval: menu cards with thumbnails, per-track boards (lap + race) and the boards dialog, Lëtzebuerg cup order');
    await F.evaluate(() => __klTest.menu());
    await F.locator('#modeRace').click();
    const ids = await F.evaluate(() => Object.keys(__klTest.KL.tracks));
    h.eq(ids, ['villehaute', 'kirchberg', 'grund', 'belval', 'geeschterschlass'], 'five tracks in menu order');
    h.eq(await F.locator('#trackCards > *').count(), 5, 'five track cards');
    await F.waitForFunction(() => [...document.querySelectorAll('#trackCards .tpv img')].length === 5 && [...document.querySelectorAll('#trackCards .tpv img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    h.expect(true, 'every card shows its thumbnail');
    h.eq(await F.evaluate(() => __klTest.KL.gpRaces(__klTest.KL.CUPS[0], __klTest.KL.tracks).map((r) => r.track)), ['villehaute', 'kirchberg', 'grund', 'belval'], 'Lëtzebuerg cup = Uewerstad, Kirchberg, Grund, Belval');
    const sentFrom = h.backend.calls.length;
    for (const [i, id] of ['kirchberg', 'grund', 'belval'].entries()) {
      const r = await F.evaluate(([id, i]) => __klTest.KL.Progress.onRaceDone({ track: id, laps: 3, lapTimes: [52 + i, 51 + i, 50 + i], finished: true, time: 160 + i }), [id, i]);
      h.eq([r.lap, r.race], [true, true], id + ': first run sets both personal records');
    }
    await sleep(2500);
    const np = posts(sentFrom).map((c) => c.body.game_id).sort();
    h.eq(np, ['kart-letzebuerg-lap-belval', 'kart-letzebuerg-lap-grund', 'kart-letzebuerg-lap-kirchberg', 'kart-letzebuerg-race-belval', 'kart-letzebuerg-race-grund', 'kart-letzebuerg-race-kirchberg'], 'each new track writes its own lap and race board');
    h.expect(posts(sentFrom).every((c) => c.body.score > 0 && c.body.score < SCORE_BASE), 'scores are 1000000 - milliseconds');
    await F.evaluate(() => document.getElementById('btnBoards') && document.getElementById('btnBoards').click());
    await F.waitForSelector('#bdScreen:not([hidden]) #bdTracks button', { timeout: 8000 });
    h.eq(await F.locator('#bdTracks button').count(), 5, 'the boards dialog lists all five tracks');
    await F.locator('#bdTracks button', { hasText: /Kierchbierg|Kirchberg/ }).first().click();
    await F.evaluate(() => __klTest.KL.Boards.open('lap', 'kirchberg'));
    await h.page.waitForSelector('.pb-modal.open .pb-row', { timeout: 8000 });
    h.expect(/Kart Lëtzebuerg · Kierchbierg · Beschte Ronn/.test(await h.page.locator('.pb-modal.open').innerText()), 'the arcade board for Kirchberg is titled with game, track and kind');
    await h.page.locator('.pb-modal.open .pb-x').click();
    await h.shot('new-tracks-menu');
    h.expect(errors.filter((e) => !/three\.js|three\.min\.js/.test(e)).length === 0, 'no console errors: ' + errors.join('; '));
  },
};
runIfMain(import.meta.url, flow);
