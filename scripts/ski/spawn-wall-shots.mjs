/* Spawn wall check (lift fixes, 28 Nov 2026): at the free ride's spawn, steer left / right / tuck for a while, report where the skier
 * ends up relative to the lift world's solid parts and whether the 3rd-person camera is inside one; one PNG per try.
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/spawn --gpu --size 1080x810 --until running \
 *     --url "/pb/ski.html?resort=laax&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/spawn-wall-shots.mjs */
export default async function shots(page, { shoot }) {
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const probe = () => page.evaluate(() => {
    const S = window.__ski, s = S.state, w = S.modes.lifts.world, h = (x, z) => S.surface ? S.surface.height(x, z) : s.y;
    const cam = S.camera || null;
    return { x: +s.x.toFixed(2), z: +s.z.toFixed(2), y: +s.y.toFixed(2), heading: +s.heading.toFixed(2), speed: +s.speed.toFixed(2), hit: !!w.hit(s.x, s.z, 0.3, s.y, h, 1.8), inStation: !!w.inStation(s.x, s.z, 0.2) };
  });
  console.log('spawn', JSON.stringify(await probe()));
  await shoot('0-start');
  for (const [name, inp] of [['left', { steer: -1 }], ['right', { steer: 1 }], ['tuck', { tuck: 1 }], ['push', { push: 1, steer: -1 }], ['pushR', { push: 1, steer: 1 }]]) {
    await page.evaluate((i) => { const S = window.__ski; S.game.bot = null; S.setInput({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false, ...i }); }, inp);
    await page.waitForTimeout(2500);
    console.log(name, JSON.stringify(await probe()));
    await shoot(name);
    await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }));
    await page.waitForTimeout(1200);
  }
}
