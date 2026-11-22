/* R8g shots (for shot.mjs --script): the nets where a course used to be crossed by one (barrier-check.mjs before the fix), one
 * resort per run (?resort=). For each course: start the challenge, put the skier just above the spot, a fixed camera down the line
 * (close: 4 m up, 28 m back; high: 22 m up, 70 m back). Then the lifetime check: leave the course -> "Challenge ofgebrach" ->
 * Weider fräi fueren -> no course object left in the scene. Prints "R8G {json}".
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/arlberg --gpu --dpr 2 --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=arlberg&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/r8g-net-shots.mjs */
const SPOTS = {
  arlberg: [['stallmahder-fang', 1557], ['fasch', 992], ['riffel', 442], ['kandahar', 900]],
  killy: [['myrtilles', 705]],
  zermatt: [['rotenboden', 47]],
  '3vallees': [['retour-sud', 310]],
  kronplatz: [['pedaga', 240]],
};
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  const rid = new URL(page.url()).searchParams.get('resort');
  const out = { rid, spots: [] };
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 150000 });
  await ev(async () => { const k = window.__ski; if (k.explore && k.explore.buildings) await k.explore.buildings(); });
  // the landmarks (the race nets) are built once every tile is in
  out.landmarksAfter = await page.waitForFunction(() => !!window.__ski.landmarks, null, { timeout: 240000, polling: 1000 }).then(() => true, () => false);
  for (const [pid, s0] of SPOTS[rid] || []) {
    const ok = await ev(async ([pid, s0]) => {
      const k = window.__ski, p = k.pistes.byId.get(pid);
      if (!p) return false;
      const a = p.at(s0, {});
      await k.streamer.ready(p.top.x, p.top.z, 600); await k.streamer.ready(a.x, a.z, 700);
      k.start(pid);
      return true;
    }, [pid, s0]);
    if (!ok) { out.spots.push({ pid, missing: true }); continue; }
    await page.waitForFunction(() => window.__ski.game.phase === 'running', null, { timeout: 20000 });
    const info = await ev(([s0]) => {
      const k = window.__ski, p = k.game.piste, r = k.game.run;
      const s = Math.max(r.startS + 5, Math.min(r.finishS - 5, s0 - 10));
      k.teleport(s); k.game.bot = null; k.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false });
      const names = k.scene.children.filter((o) => /^ski-course/.test(o.name)).map((o) => o.name);
      return { s, startS: r.startS, finishS: r.finishS, names };
    }, [s0]);
    const pose = (back, up, ahead) => ev(([s0, back, up, ahead]) => {
      const k = window.__ski, p = k.game.piste, c = p.at(Math.max(0, s0 - back), {}), t = p.at(s0 + ahead, {});
      k.setCamera(c.x, c.z, up, t.x, t.z, 1.2, 55);
    }, [s0, back, up, ahead]);
    await pose(28, 4, 12); await settle(2600);
    await shoot(`${pid}-close`);
    await pose(70, 22, 0); await settle(1800);
    await shoot(`${pid}-high`);
    await ev(() => window.__ski.setCamera(null));
    out.spots.push({ pid, ...info });
  }
  // lifetime: off the course -> abort -> free ride: no course object, no START arch / gates of the run left
  await ev(() => { const k = window.__ski, p = k.game.piste, a = p.at(Math.min(p.length * 0.5, k.game.run.startS + 200), {}); k.place(a.x - a.dz * (p.halfWidth + 45), a.z + a.dx * (p.halfWidth + 45), Math.atan2(a.dz, a.dx)); k.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  await page.waitForSelector('#courseAbort', { timeout: 30000 });
  out.abortText = (await page.textContent('#courseAbort')).replace(/\s+/g, ' ').trim();
  out.duringAbort = await ev(() => window.__ski.scene.children.filter((o) => /^ski-course|^ski-run$/.test(o.name)).map((o) => o.name));
  await page.click('#courseAbort [data-a="free"]');
  await page.waitForFunction(() => window.__ski.game.mode === 'freeride' && window.__ski.game.phase === 'running', null, { timeout: 10000 });
  out.afterFree = await ev(() => window.__ski.scene.children.filter((o) => /^ski-course|^ski-run$/.test(o.name)).map((o) => o.name));
  console.log('R8G', JSON.stringify(out));
}
