/* Round 7-C look shots (for shot.mjs --script), one resort per run (?resort=): the spawn at the first lift, the map fog + the teleport
 * question, first person at speed, the spray (carve arc + powder cloud and tracks), an avalanche flowing, the challenge course + ZIL arch.
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/killy --gpu --dpr 2 --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=morning&res=fixed" --script scripts/ski/round7c-shots.mjs
 *   (FLOW_BROWSER=webkit for Safari's engine) */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  await page.evaluate(() => { try { localStorage.setItem('pb_ski_cam', 'chase'); } catch (e) { /* ignore */ } });
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running' && document.documentElement.dataset.skiSpawnOk !== undefined, null, { timeout: 150000 });
  await settle(3500);
  await shoot('spawn');
  // the map: fog + a tap on a discovered spot near the first lift -> the question
  await page.keyboard.press('m');
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'map', null, { timeout: 15000 });
  await ev(() => { const k = window.__ski, b = k.spawn.top; k.explore.disc.reveal(b.x, b.z, 400); k.pisteMap.setFog(k.explore.disc); k.pisteMap.center(k.spawn.bottom.x, k.spawn.bottom.z, 1.6); });
  const [px, py] = await ev(() => { const t = window.__ski.spawn.top; return window.__ski.pisteMap.screenXY(t.x + 60, t.z + 40); });
  const box = await page.locator('#mapCanvas').boundingBox();
  await page.mouse.click(box.x + px, box.y + py);
  await settle(800);
  await shoot('map-teleport');
  await page.click('#tpNo').catch(() => {});
  await page.click('#mapResume');
  await page.waitForFunction(() => window.__ski.game.phase === 'running' && document.documentElement.dataset.skiScreen === 'ski', null, { timeout: 15000 });
  // a red / blue piste: first person at speed, then the carve spray from behind
  await ev(async () => { const k = window.__ski; const L = k.pistes.list.filter((p) => (p.diff === 'red' || p.diff === 'blue') && p.length > 900); const p = L[Math.floor(L.length / 2)]; const a = p.at(p.length * 0.4, {}); k.place(a.x, a.z, Math.atan2(a.dz, a.dx)); await k.streamer.ready(a.x, a.z, 500); k.setCamMode('fp'); k.setInput({ steer: 0, tuck: 1, brake: 0, push: 1, jump: false }); });
  await settle(3200);
  await shoot('firstperson');
  await ev(() => { window.__ski.setCamMode('chase'); window.__ski.setInput({ steer: 0.9, tuck: 0, brake: 0, push: 0, jump: false }); });
  await settle(900);
  await shoot('spray-carve');
  // off piste: powder cloud + tracks
  await ev(async () => {
    const k = window.__ski, L = k.pistes;
    for (let i = 0; i < 3000; i++) {
      const p = L.list[i % L.list.length], a = p.at((i * 37) % p.length, {});
      const x = a.x - a.dz * 90, z = a.z + a.dx * 90;
      if (L.nearest(x, z, 70)) continue;
      const at = k.field.attrs(x, z, {});
      const g = (k.surface.height(x - 8, z) - k.surface.height(x + 8, z)) / 16, gz = (k.surface.height(x, z - 8) - k.surface.height(x, z + 8)) / 16;
      const sl = Math.atan(Math.hypot(g, gz)) * 180 / Math.PI;
      if (at.forest < 0.1 && at.rock < 0.2 && at.built === 0 && sl > 20 && sl < 32) { k.place(x, z, Math.atan2(gz, g)); await k.streamer.ready(x, z, 400); break; }
    }
    k.setInput({ steer: 0.5, tuck: 0, brake: 0, push: 1, jump: false });
  });
  await settle(2200);
  await ev(() => window.__ski.setInput({ steer: -0.8, tuck: 0, brake: 0, push: 0, jump: false }));
  await settle(1400);
  await shoot('spray-powder');
  await ev(() => window.__ski.setInput(null));
  // an avalanche on the first Lawin face, seen from beside it
  await ev(async () => {
    const k = window.__ski, a = k.avalanches, f = a.faces[0], p = f.path, m = await import('/pb/ski/avalanche.js');
    const side = { x: f.top.x - (p[3] - p[1]) / 15 * 200, z: f.top.z + (p[2] - p[0]) / 15 * 200 };
    k.place(side.x, side.z, 0);
    await k.streamer.ready(f.top.x, f.top.z, 700);
    const t0 = performance.now(); a.setClock(() => (t0 + (performance.now() - t0) * 2.5) / 1000);
    a.triggerAvalanche(m.cellId(f.top.x, f.top.z), 4242, a.clock());
    const kk = Math.min(p.length - 2, 16);
    k.setCamera(p[kk] - (p[3] - p[1]) / 15 * 170, p[kk + 1] + (p[2] - p[0]) / 15 * 170, 40, p[kk], p[kk + 1], 0, 55);
  });
  await settle(4500);
  await shoot('avalanche');
  await ev(() => { window.__ski.setCamera(null); window.__ski.avalanches.clear(); });
  // the challenge course on a red piste: the start, then the ZIL arch
  await ev(async () => { const k = window.__ski; const p = k.pistes.list.filter((q) => q.diff === 'red' && q.length > 700)[3] || k.pistes.list[0]; await k.streamer.ready(p.top.x, p.top.z, 800); k.start(p.id); });
  await page.waitForFunction(() => window.__ski.game.phase === 'running', null, { timeout: 20000 });
  await settle(1800);
  await shoot('course-start');
  await ev(async () => { const k = window.__ski, p = k.game.piste, f = p.at(k.game.run.finishS, {}), b = p.at(k.game.run.finishS - 55, {}); await k.streamer.ready(f.x, f.z, 400); k.setCamera(b.x - b.dz * 6, b.z + b.dx * 6, 3.5, f.x, f.z, 3.5, 55); });
  await settle(2500);
  await shoot('course-finish');
}
