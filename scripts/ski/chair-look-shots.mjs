/* Chair station shots (for shot.mjs --script; the chairs round, 26 Nov 2026): each chairlift in SHOT_LIFTS ("index,index,...") like a
 * player sees it, midday and evening: `zone` = the real chase camera in the boarding zone after a fast travel, `approach` = a skier
 * coming in 16 m out on the outer side at eye height (looking at the terminal), `side` = the whole bottom terminal from 30 m, `top` = the
 * top station from where he gets off / skis away. One PNG per lift, view and time: <prefix>-<index>-<view>-<time>.png.
 *   SHOT_LIFTS="6,15,40" BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/killy --gpu --dpr 2 \
 *     --size 1080x810 --until running --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" \
 *     --script scripts/ski/chair-look-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms) => page.waitForTimeout(ms);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__ski.lifts, null, { timeout: 120000 });
  await settle(2500);
  const times = (process.env.SHOT_TIMES || 'midday,evening').split(',');
  const views = (process.env.SHOT_VIEWS || 'zone,approach,side,top').split(',');
  const list = (process.env.SHOT_LIFTS || '').split(',').filter(Boolean).map(Number);
  const sky = (t) => ev((tt) => { const s = window.__ski; s.env.setTime(tt, false); s.env.snap(); }, t);
  // a skier's eye: [end, a, b, up, look a, look b, look up] in the end's frame (a < 0 = towards the line, b > 0 = the outer side)
  const POSE = { approach: [0, -17, 9, 1.9, -1, 0, 3.2], side: [0, -12, 27, 4.5, -2, 0, 3], top: [1, -21, 15, 6.5, 0, 1, 1.5], under: [0, -9, 4.5, 1.7, 1, 0, 3.2] };
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
        const [w, a, b, up, ta, tb, tup] = POSE[view];
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
        await shoot(`${index}-${view}-${t}`);
      }
    }
    await ev(() => window.__ski.setCamera(null));
    console.log(`  ${index}: ${info.name} (${info.kind})`);
  }
}
