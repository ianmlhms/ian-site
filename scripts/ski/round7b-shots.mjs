/* Round 7-B look shots (for shot.mjs --script): the lift stations, boarding, the carriers on the cable, a drag lift from the side (the
 * pylon beside the track, the return loop), the funicular tunnel, a tree aisle. Start the page with ?go=1 (free ride), Killy has every
 * kind (gondola, chair, T-bar, platter, cable car, Funival in its tunnel).
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/r7b --gpu --dpr 2 --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday" --script scripts/ski/round7b-shots.mjs
 *   (FLOW_BROWSER=webkit for the WebKit set) */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === '1' && !!window.__ski.lifts, null, { timeout: 400000 }).catch(() => {});
  await settle(2500);
  const free = async (id) => {
    await ev((i) => window.__ski.goFree(i), id);
    await page.waitForFunction((i) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === i, id, { timeout: 40000 });
    await settle(1500);
  };
  const off = async () => {
    await ev(() => { window.__ski.setCamera(null); });
    if (await ev(() => !!window.__ski.ride)) {
      await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.canSkip, null, { timeout: 40000 }).catch(() => {});
      await ev(() => window.__ski.skipRide());
      await page.waitForFunction(() => window.__ski.game.phase === 'running' && !window.__ski.ride, null, { timeout: 60000 });
    }
  };
  /** A fixed camera in a station's frame: (a, b) m in its own frame, `up` m over the ground, looking at (ta, tb) `up2` m up. */
  const frameCam = (index, which, a, b, up, ta, tb, up2, fov = 50) => ev(([i, w, a1, b1, u1, a2, b2, u2, f]) => {
    const S = window.__ski, site = S.lifts.siteOf(i), e = site.ends[w];
    const p = e.toWorld(a1, b1, {}), t = e.toWorld(a2, b2, {});
    S.setCamera(p.x, p.z, u1, t.x, t.z, u2, f);
  }, [index, which, a, b, up, ta, tb, up2, fov]);
  const pick = (kind, test = '') => ev(([k, t]) => {
    const S = window.__ski, L = S.modes.lifts.list.filter((l) => l.kind === k && (!t || new RegExp(t).test(S.lifts.siteOf(l.index).path.sub + (S.lifts.siteOf(l.index).path.tunnel ? 'tunnel' : ''))));
    L.sort((a, b) => Math.abs(a.len - 700) - Math.abs(b.len - 700));
    return L[0] ? { id: L[0].id, index: L[0].index, name: L[0].name } : null;
  }, [kind, test]);

  // 1. a gondola hall: the rider walks in with his skis on the shoulder, the cabin comes round the wheel
  const g = await ev(() => ({ id: window.__ski.spawn.id, index: window.__ski.spawn.index, kind: window.__ski.spawn.kind }));
  await free(g.id);
  await frameCam(g.index, 0, -26, 16, 7, -2, 2, 3, 55);
  await settle(2500);
  await shoot('gondola-station');
  await ev(() => window.__ski.setCamera(null));
  await ev(() => window.__ski.boardLift());
  await settle(1700);
  await shoot('gondola-boarding');
  await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === 'ride', null, { timeout: 30000 });
  await settle(3000);
  await shoot('gondola-ride');
  await ev(() => window.__ski.toggleRideView());
  await settle(1200);
  await shoot('gondola-window');
  await ev(() => window.__ski.toggleRideView());
  // 2. the cabins on the cable: from beside the line, looking up at the next cabins
  await ev(() => {
    const S = window.__ski, r = S.ride, p = r.path, s = Math.min(p.len - 60, r.s + 140), q = p.at(s, {});
    S.setCamera(q.x + q.dz * 26, q.z - q.dx * 26, 6, q.x - q.dx * 40, q.z - q.dz * 40, 10, 50);
  });
  await settle(3500);
  await shoot('cabins-on-cable');
  await off();

  // 3. a chairlift's loading platform with its gates, then the chair arriving
  const c = await pick('chair');
  await free(c.id);
  await frameCam(c.index, 0, -16, 12, 4.5, 0, 2, 1.5, 55);
  await settle(2500);
  await shoot('chair-platform');
  await ev(() => window.__ski.setCamera(null));
  await ev(() => window.__ski.boardLift());
  await settle(2200);
  await shoot('chair-boarding');
  await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === 'ride', null, { timeout: 30000 });
  await off();

  // 4. a T-bar from the side: the pylon beside the track (its arm over it), the empty bars coming back down
  const d = (await pick('drag', 'tbar')) || (await pick('drag'));
  await free(d.id);
  await ev(() => window.__ski.boardLift());
  await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === 'ride', null, { timeout: 30000 });
  await settle(2500);
  await ev(() => {
    const S = window.__ski, r = S.ride, p = r.path;
    // the next pylon ahead of the rider
    const tw = p.supports.filter((t) => t.tower && t.s > r.s + 15)[0] || p.supports.filter((t) => t.tower)[0];
    const q = p.at(tw.s, {}), sg = p.sign;
    S.setCamera(q.x - q.dz * sg * 22 - q.dx * 6, q.z + q.dx * sg * 22 - q.dz * 6, 3.5, q.x - q.dz * sg * 0.5, q.z + q.dx * sg * 0.5, 3, 55);
  });
  await settle(4000);
  await shoot('drag-side');
  await off();

  // 5. the Funival: the bottom station + portal, then in the lit tunnel
  const f = await pick('train', 'tunnel');
  if (f) {
    await free(f.id);
    await frameCam(f.index, 0, -45, 22, 9, -20, 0, 2, 55);
    await settle(2500);
    await shoot('funicular-station');
    await ev(() => window.__ski.setCamera(null));
    await ev(() => window.__ski.boardLift());
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === 'ride', null, { timeout: 30000 });
    await page.waitForFunction(() => { const r = window.__ski.ride; return r && r.s > 160; }, null, { timeout: 60000 }).catch(() => {});
    await settle(1200);
    await shoot('funicular-tunnel');
    await off();
  }

  // 6. a tree aisle: high over a chairlift that runs through forest, looking along the line
  const aisle = await ev(() => {
    const S = window.__ski, a = {};
    let best = null, bs = -1;
    for (const l of S.modes.lifts.list) {
      if (l.kind !== 'chair' && l.kind !== 'gondola') continue;
      const p = S.lifts.siteOf(l.index).path;
      let n = 0;
      for (let s = 60; s < p.len - 60; s += 25) { const q = p.at(s, {}); S.field.attrs(q.x - q.dz * 22, q.z + q.dx * 22, a); n += a.forest > 0.5 ? 1 : 0; S.field.attrs(q.x + q.dz * 22, q.z - q.dx * 22, a); n += a.forest > 0.5 ? 1 : 0; }
      if (n > bs) { bs = n; best = l.index; }
    }
    if (best === null) return null;
    const p = S.lifts.siteOf(best).path, s = p.len * 0.35, q = p.at(s, {}), q2 = p.at(Math.min(p.len, s + 260), {});
    S.setCamera(q.x - q.dx * 60, q.z - q.dz * 60, 70, q2.x, q2.z, 0, 55);
    return { index: best, forestPoints: bs };
  });
  if (aisle) { await settle(5000); await shoot('tree-aisle'); }
  await ev(() => window.__ski.setCamera(null));
}
