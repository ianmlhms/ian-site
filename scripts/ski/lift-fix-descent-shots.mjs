/* Ride-down boarding shots (lift fixes, 28 Nov 2026), for shot.mjs --script: Via Lattea, the Cesana gondola ("Cesana-Ski Lodge 1"): fast
 * travel onto the top's descent mat, L, then one PNG every DESCENT_STEP ms (default 700) while boarding: the doors open as the cabin docks
 * and shut before it pulls away. Names: <prefix>-<n>.png.
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/ridedown --gpu --size 1080x810 --until running \
 *     --url "/pb/ski.html?resort=vialattea&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/lift-fix-descent-shots.mjs */
export default async function shots(page, { shoot }) {
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__ski.lifts && window.__ski.modes.lifts.list.length > 0, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const id = await page.evaluate(() => { const l = window.__ski.modes.lifts.list.find((q) => q.baseName === 'Cesana-Ski Lodge 1'); return l && l.id; });
  await page.evaluate((i) => window.__ski.goDown(i), id);
  await page.waitForFunction((i) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === i && window.__ski.modes.liftDown, id, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('l');
  const step = Number(process.env.DESCENT_STEP || 700);
  for (let n = 0; n < 9; n += 1) {
    await page.waitForTimeout(step);
    const info = await page.evaluate(() => { const r = window.__ski.ride; return r ? { phase: r.phase, doorK: +(r.where().doorK || 0).toFixed(2) } : null; });
    await shoot(`${n}`);
    console.log('  shot', n, JSON.stringify(info));
    if (!info || info.phase !== 'board') break;
  }
}
