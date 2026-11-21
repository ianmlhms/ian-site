/* Round 6 look shots (for shot.mjs --script): the free ride, the lift rides (chair + gondola, third person and window view), a drag
 * lift, a challenge gate in the world, the ski types (tab, lift card, the skis on the skier). Start the page with ?go=1 (free ride).
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/r6 --gpu --dpr 2 --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/round6-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 90000 });
  await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === '1', null, { timeout: 180000 }).catch(() => {});
  await settle(3000);
  await shoot('free-spawn');
  // a free-ride view: the scripted skier down a piste below a lift top, chase camera
  await ev(async () => {
    const S = window.__ski, { createBot } = await import('/pb/ski/bot.js');
    const p = S.pistes.byId.get('verte-mont-blanc') || S.pistes.byId.get('semanmille') || S.pistes.list[10];
    const a = p.at(260, {});
    S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
    S.game.bot = createBot(p);
  });
  await settle(5000);
  await shoot('free-ride');
  await ev(() => { window.__ski.game.bot = null; });
  // the gondola at the village: third person, then the window
  await ev(() => window.__ski.goFree(window.__ski.spawn.id));
  await page.waitForFunction(() => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt, null, { timeout: 30000 });
  await ev(() => window.__ski.boardLift());
  await settle(9000);
  await shoot('gondola-chase');
  await ev(() => window.__ski.toggleRideView());
  await settle(1200);
  await shoot('gondola-window');
  await ev(() => window.__ski.toggleRideView());
  await ev(() => window.__ski.skipRide());
  await page.waitForFunction(() => window.__ski.game.phase === 'running' && !window.__ski.ride, null, { timeout: 30000 });
  // a chair: third person + window
  const chair = await ev(() => { const L = window.__ski.modes.lifts.list.filter((l) => l.kind === 'chair' && l.len > 700 && l.len < 1600); return (L.find((l) => /Fresse|Borsat|Grattalu/.test(l.name)) || L[0]).id; });
  await ev((id) => window.__ski.goFree(id), chair);
  await page.waitForFunction((id) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, chair, { timeout: 30000 });
  await ev(() => window.__ski.boardLift());
  await settle(12000);
  await shoot('chair-chase');
  await ev(() => window.__ski.toggleRideView());
  await settle(1200);
  await shoot('chair-window');
  await ev(() => window.__ski.toggleRideView());
  await ev(() => window.__ski.skipRide());
  await page.waitForFunction(() => window.__ski.game.phase === 'running' && !window.__ski.ride, null, { timeout: 30000 });
  // a drag lift
  const drag = await ev(() => window.__ski.modes.lifts.list.filter((l) => l.kind === 'drag' && l.len > 300)[0].id);
  await ev((id) => window.__ski.goFree(id), drag);
  await page.waitForFunction((id) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, drag, { timeout: 30000 });
  await ev(() => window.__ski.boardLift());
  await settle(5000);
  await shoot('drag');
  await ev(() => window.__ski.skipRide());
  await page.waitForFunction(() => window.__ski.game.phase === 'running' && !window.__ski.ride, null, { timeout: 30000 });
  // a challenge gate: seen from above on the piste (label), then skied into (the prompt)
  await ev(() => {
    const S = window.__ski, m = S.markers.byId('face') || S.markers.list[5];
    S.place(m.x - Math.cos(m.heading) * 30 + Math.sin(m.heading) * 6, m.z - Math.sin(m.heading) * 30 - Math.cos(m.heading) * 6, m.heading);
    S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false });
  });
  await settle(3500);
  await shoot('gate-ahead');
  await ev(() => { const S = window.__ski, m = S.markers.byId('face') || S.markers.list[5]; S.place(m.x - Math.cos(m.heading) * 4, m.z - Math.sin(m.heading) * 4, m.heading); });
  await settle(2500);
  await shoot('gate-prompt');
  await ev(() => window.__ski.setInput(null));
  // the skis: every type on the skier (orbit camera), the lift card, the Skier tab
  await ev(() => { const S = window.__ski; const st = S.progress(); localStorage.setItem('pb_ski_save', JSON.stringify({ ...st, stars: { ...st.stars, 'killy/zz1': 7, 'killy/zz2': 7, 'killy/zz3': 7, 'killy/zz4': 7, 'killy/zz5': 7, 'killy/zz6': 7, 'killy/zz7': 7, 'killy/zz8': 7, 'killy/zz9': 7, 'killy/zz10': 7, 'killy/zz11': 7 }, stats: { off: 10500, top: 27 }, park: { killy: 6000 } })); });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 90000 });
  await settle(2500);
  await ev(() => { const S = window.__ski, p = S.pistes.byId.get('face') || S.pistes.list[0], q = p.at(p.length * 0.6, {}); S.place(q.x, q.z, Math.atan2(q.dz, q.dx)); S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  await settle(2500);
  for (const id of ['allmountain', 'carving', 'race', 'powder', 'park']) {
    await ev((sid) => { const S = window.__ski; S.setSki(sid); S.orbit(150, 3.3, 1.9, 40); }, id);
    await settle(700);
    await shoot(`ski-${id}`);
  }
  await ev(() => { window.__ski.orbit(null); window.__ski.setInput(null); window.__ski.goFree(window.__ski.spawn.id); });
  await settle(3000);
  await page.waitForFunction(() => !document.getElementById('skiSwap').hidden, null, { timeout: 10000 }).catch(() => {});
  await ev(() => window.__ski.openSkiCard());
  await settle(600);
  await shoot('ski-card');
  await page.click('#skiCard [data-a="close"]');
  await ev(() => window.__ski.showMap());
  await page.click('.modetabs [data-mode="skis"]');
  await settle(600);
  await shoot('ski-tab');
  await page.click('.modetabs [data-mode="freeride"]');
  await settle(800);
  await shoot('map-free');
}
