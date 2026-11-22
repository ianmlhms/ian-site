/* Launch fix shots (for shot.mjs --script): lift stations at both ends, seen from in front / beside, for the lifts in SHOT_LIFTS
 * ("index:which[:view],..." which 0 = bottom, 1 = top; view 'b' = from the return side, 'up' = from high above). Tignes Champagny / Vanoise (Ian's report)
 * and the stations that lost parts before the fix. One PNG per entry: <prefix>-<index>-<bottom|top>[-b].png.
 *   SHOT_LIFTS="80:0,80:1,30:1" BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/k --gpu \
 *     --size 1180x820 --until ready --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday" \
 *     --script scripts/ski/launch-station-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms) => page.waitForTimeout(ms);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__ski.lifts, null, { timeout: 120000 });
  await settle(2000);
  const list = (process.env.SHOT_LIFTS || '').split(',').filter(Boolean).map((t) => t.split(':'));
  for (const [idx, which, view] of list) {
    const index = Number(idx), w = Number(which);
    const info = await ev(([i]) => { const S = window.__ski, l = S.modes.lifts.byIndex.get(i); return l ? { id: l.id, name: l.name, kind: l.kind } : null; }, [index]);
    if (!info) { console.log('no rideable lift', index); continue; }
    await ev((id) => window.__ski.goFree(id), info.id);
    await page.waitForFunction((id) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, info.id, { timeout: 40000 }).catch(() => console.log('  not in the zone after goFree', info.name));
    const inZone = await ev(() => !!window.__ski.modes.liftAt);
    // the camera in the end's own frame: in front of the station on the outer (boarding) side, or the return side
    const d = view === 'up' ? [-30, 22, 28] : info.kind === 'drag' ? [-13, 9, 4.5] : info.kind === 'chair' ? [-18, 13, 6] : [-26, 18, 8];
    const side = view === 'b' ? -1 : 1;
    await ev(([i, wh, a, b, up]) => {
      const S = window.__ski, e = S.lifts.siteOf(i).ends[wh];
      const p = e.toWorld(a, b, {}), t = e.toWorld(0, 0, {});
      S.setCamera(p.x, p.z, up, t.x, t.z, 2, 55);
    }, [index, w, d[0], d[1] * side, d[2]]);
    await settle(w ? 9000 : 4500);            // the top: its tiles stream in round the camera first
    const name = `${index}-${w ? 'top' : 'bottom'}${view ? '-' + view : ''}`;
    await shoot(name);
    console.log(`  ${name}: ${info.name} (${info.kind}), boarding zone ${inZone ? 'reached' : 'NOT reached'}`);
    await ev(() => window.__ski.setCamera(null));
  }
}
