/* After launch (Ian, 3V Tovets: "through the barrier, scooped abruptly"): a chair's boarding as a sequence of shots (for shot.mjs
 * --script): approach (waiting behind the gate), gate open, through the gate / on the belt, the chair arriving behind him, seated,
 * lift-off. SHOT_LIFT = lift index (default 71 = Tovets in 3 Vallées); SHOT_CAM = 'side' (fixed, beside the belt) or 'ride' (the
 * game's own ride camera).
 *   SHOT_LIFT=71 BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/tovets --gpu --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=3vallees&go=1&debug=1&q=high&weather=sun&time=midday" --script scripts/ski/chair-board-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const index = Number(process.env.SHOT_LIFT || 71), cam = process.env.SHOT_CAM || 'side';
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running' && !!window.__ski.lifts, null, { timeout: 120000 });
  const id = `l${index}`;
  await ev((i) => window.__ski.goFree(i), id);
  await page.waitForFunction((i) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === i, id, { timeout: 40000 });
  await page.waitForTimeout(3000);
  if (cam === 'side') {
    await ev((i) => {
      const S = window.__ski, site = S.lifts.siteOf(i), F = site.bottom, side = site.path.side, hw = site.path.carrier.hw;
      const C = site.chair || { aLoad: -site.boardS, aEntry: -site.boardS + 2, bGate: side + hw + 1.2, bRider: side };
      // square to the lane from the outer side (the wheel, where the chairs come from, on the right)
      const am = (C.aLoad + C.aEntry) / 2, p = F.toWorld(am - 1, C.bGate + 9, {}), t = F.toWorld(am - 1, C.bRider, {});
      S.setCamera(p.x, p.z, 3.4, t.x, t.z, 1.0, 55);
    }, index);
    await page.waitForTimeout(2500);
  }
  await shoot('0-waiting');
  await ev(() => window.__ski.boardLift());
  // (the build before the chair plan has none: fixed times then, for a before / after sheet)
  const plan = await ev(() => { const P = window.__ski.ride.chairPlan; return P ? { tGo: P.tGo, tWalk0: P.tWalk0, tBelt0: P.tBelt0, tStand0: P.tStand0, tSit0: P.tSit0, T: P.tArrive, detach: P.detach } : { tGo: 0.1, tWalk0: 0.3, tBelt0: 1.6, tStand0: 2.2, tSit0: 2.6, T: 3.2, old: true }; });
  console.log('  plan', JSON.stringify(plan));
  const at = async (tt, name) => {
    await page.waitForFunction((x) => !window.__ski.ride || window.__ski.ride.phase !== 'board' || window.__ski.ride.t >= x, tt, { timeout: 30000 });
    await shoot(name);
    console.log(`  ${name} at ride t ${await ev(() => (window.__ski.ride ? window.__ski.ride.t.toFixed(2) + ' ' + window.__ski.ride.phase + ' gate ' + (window.__ski.ride.gate || 0).toFixed(2) : '-'))}`);
  };
  await at(plan.tGo + 0.4, '1-gate-open');
  await at(plan.tWalk0 + (plan.tBelt0 - plan.tWalk0) * 0.55, '2-through-gate');
  await at(plan.tBelt0 + (plan.tStand0 - plan.tBelt0) * 0.5, '3-on-belt');
  await at(plan.tSit0 - 0.15, '4-chair-arrives');
  await at(plan.T - 0.02, '5-seated');
  await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === 'ride' && window.__ski.ride.s > window.__ski.ride.path.len * 0 + 9, null, { timeout: 30000 }).catch(() => {});
  await shoot('6-lift-off');
}
