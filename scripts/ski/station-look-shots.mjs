/* Station look shots (for shot.mjs --script): each lift in SHOT_LIFTS ("index,index,...") seen like a player sees it, at midday and in the
 * evening: `zone` = the real chase camera in the boarding zone after a fast travel (looking up the line), `near` = a skier's eye coming
 * in from the outer side (25 m out, 4 m up), `top` = the top station from where he gets off / skis away. One PNG per lift, view and time:
 * <prefix>-<index>-<view>-<time>.png.
 *   SHOT_LIFTS="6,37,16,81,23" BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/killy --gpu \
 *     --dpr 2 --size 1080x810 --until running --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" \
 *     --script scripts/ski/station-look-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms) => page.waitForTimeout(ms);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__ski.lifts, null, { timeout: 120000 });
  await settle(2500);
  const times = (process.env.SHOT_TIMES || 'midday,evening').split(',');
  const views = (process.env.SHOT_VIEWS || 'zone,near,top').split(',');
  const list = (process.env.SHOT_LIFTS || '').split(',').filter(Boolean).map(Number);
  const sky = (t) => ev((tt) => { const s = window.__ski; s.env.setTime(tt, false); s.env.snap(); }, t);
  for (const index of list) {
    const info = await ev((i) => { const S = window.__ski, l = S.modes.lifts.byIndex.get(i); return l ? { id: l.id, name: l.name, kind: l.kind } : null; }, index);
    if (!info) { console.log('no rideable lift', index); continue; }
    await ev((id) => window.__ski.goFree(id), info.id);
    await page.waitForFunction((id) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, info.id, { timeout: 40000 }).catch(() => console.log('  not in the zone after goFree', info.name));
    await settle(4000);
    for (const view of views) {
      if (view === 'zone') {
        await ev(() => window.__ski.setCamera(null));
      } else {
        // a skier's eye: (a, b) in the end's frame (a < 0 = towards the line, b > 0 = the outer side), up m over the snow
        const [w, a, b, up, ta, tb, tup] = view === 'top' ? [1, -30, 22, 5, -2, 0, 3] : [0, -26, 24, 4.5, -3, 2, 3];
        await ev(([i, wh, A, B, U, TA, TB, TU]) => {
          const S = window.__ski, e = S.lifts.siteOf(i).ends[wh];
          const p = e.toWorld(A, B, {}), t = e.toWorld(TA, TB, {});
          S.setCamera(p.x, p.z, U, t.x, t.z, TU, 55);
        }, [index, w, a, b, up, ta, tb, tup]);
        await settle(view === 'top' ? 8000 : 3500);
      }
      for (const t of times) {
        await sky(t);
        await settle(1200);
        const name = `${index}-${view}-${t}`;
        await shoot(name);
      }
    }
    await ev(() => window.__ski.setCamera(null));
    console.log(`  ${index}: ${info.name} (${info.kind})`);
  }
}
