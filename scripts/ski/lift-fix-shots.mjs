/* Station shots for the lift fixes (28 Nov 2026), for shot.mjs --script: each "index:end" in SHOT_ENDS (end 0 = bottom, 1 = top) from
 * 4 skier-eye poses in the end's frame (outer side, return side, along the line from below, high overview), midday. One PNG per end
 * and view: <prefix>-<index>-<end>-<view>.png.
 *   SHOT_ENDS="6:1,63:0" BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/killy --gpu --dpr 1 \
 *     --size 1080x810 --until running --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" \
 *     --script scripts/ski/lift-fix-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__ski.lifts, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const list = (process.env.SHOT_ENDS || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number));
  // [a, b, up, look a, look b, look up] in the end's frame (a < 0 = towards the line, b > 0 = the outer side)
  const POSE = { outer: [-14, 17, 4.5, 0, 0, 3.5], ret: [-14, -17, 4.5, 0, 0, 3.5], line: [-30, 0, 6, 0, 0, 3.5], high: [-6, 20, 14, 0, 0, 3] };
  const views = (process.env.SHOT_VIEWS || 'outer,ret,line,high').split(',');
  await ev(() => { const s = window.__ski; s.game.bot = null; s.env.setTime('midday', false); s.env.snap(); });
  for (const [index, end] of list) {
    await ev((i) => { const S = window.__ski; S.goFree(S.modes.lifts.byIndex.get(i).id); }, index);
    await page.waitForTimeout(4000);
    for (const view of views) {
      const [a, b, up, ta, tb, tup] = POSE[view];
      const ok = await ev(([i, wh, A, B, U, TA, TB, TU]) => {
        const S = window.__ski, site = S.lifts.siteOf(i);
        if (!site) return false;
        const e = site.ends[wh], p = e.toWorld(A, B, {}), t = e.toWorld(TA, TB, {});
        S.setCamera(p.x, p.z, U, t.x, t.z, TU, 60);
        return true;
      }, [index, end, a, b, up, ta, tb, tup]);
      if (!ok) { console.log('no site', index); break; }
      await page.waitForTimeout(view === views[0] ? 8000 : 3500);
      await shoot(`${index}-${end}-${view}`);
    }
    await ev(() => window.__ski.setCamera(null));
    console.log('  shot', index, end);
  }
}
