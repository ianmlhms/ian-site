/* R7-D look shots (a --script for shot.mjs): near trees (spruce + larch), the snow park (a kicker from the side, inside the halfpipe),
 * evening shade on snow (+ the same pose at midday), a challenge gate. Fixed cameras (setCamera), the free ride behind them.
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/killy --gpu --dpr 2 --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/look7d-shots.mjs
 * WebKit: FLOW_BROWSER=webkit in front (no --gpu). */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 120000 });
  await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === '1', null, { timeout: 240000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await ev(() => { const s = window.__ski; s.game.bot = null; s.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  const pose = async (name, p, time = 'midday', wait = 3500) => {
    if (!p) { console.log('skip', name); return; }
    await ev(([q, t]) => { const S = window.__ski; S.env.setTime(t, false); S.env.snap(); S.orbit(null); S.setCamera(...q); }, [p, time]);
    await page.waitForTimeout(wait);
    await shoot(name);
  };
  // near trees: a spruce and a larch close to a piste, seen from 13 m at eye height (the block generator is pure: a copy finds them)
  const trees = await ev(async () => {
    const S = window.__ski, { createScatter, BLOCK } = await import('/pb/ski/scatter.js');
    const sc = createScatter(S.field);
    const out = {};
    const cands = [];
    for (const p of S.pistes.list.slice(0, 160)) for (let s = 60; s < p.length - 60; s += 70) cands.push(p.at(s, {}));
    for (const a of cands) {
      if (out.spruce && out.larch) break;
      const bx = Math.floor(a.x / BLOCK), bz = Math.floor(a.z / BLOCK);
      const parts = [];
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) parts.push(...sc.treeBlock(bx + i, bz + j));
      const t = parts;
      for (let i = 0; i < t.length; i += 6) {
        const kind = t[i + 4] > 0.5 ? 'larch' : 'spruce';
        if (out[kind] || t[i + 3] < 0.9) continue;
        // a tree standing a little apart (nothing within 5 m in front of it towards the piste)
        const dx = a.x - t[i], dz = a.z - t[i + 2], d = Math.hypot(dx, dz);
        if (d < 14 || d > 45) continue;
        const ux = dx / d, uz = dz / d;
        let clear = true;
        for (let j = 0; j < t.length; j += 6) { if (j === i) continue; const ex = t[j] - t[i], ez = t[j + 2] - t[i + 2]; const along = ex * ux + ez * uz, side = Math.abs(-ex * uz + ez * ux); if (along > 1 && along < 14 && side < 4) { clear = false; break; } }
        if (!clear) continue;
        out[kind] = [t[i] + ux * 13, t[i + 2] + uz * 13, 1.8, t[i], t[i + 2], 4.5 * t[i + 3], 50];
      }
    }
    return out;
  });
  await pose('fir', trees.spruce);
  await pose('larch', trees.larch);
  // the snow park: the biggest kicker from the side, inside the halfpipe looking down it
  const park = await ev(() => {
    const L = window.__ski.parkLayout;
    if (!L) return null;
    window.__ski.modes.ensureParkView();
    const big = L.kickers.reduce((a, b) => (b.h > a.h ? b : a), L.kickers[0]);
    const w = (s, v) => L.world(s, v);
    const out = {};
    if (big) { const c = w(big.lip - 1, big.v + 15), t = w(big.lip + 1, big.v); out.kicker = [c.x, c.z, 2.2, t.x, t.z, 1.4, 50]; const c2 = w(big.s0 - 9, big.v + 6), t2 = w(big.lip + 4, big.v); out.kicker2 = [c2.x, c2.z, 2.0, t2.x, t2.z, 1.6, 55]; }
    if (L.pipe) { const c = w(L.pipe.s0 + 8, 1), t = w(L.pipe.s0 + 36, -3); out.pipe = [c.x, c.z, 1.6, t.x, t.z, 0.5, 62]; }
    return out;
  });
  await pose('park-kicker', park && park.kicker);
  await pose('park-runup', park && park.kicker2);
  await pose('park-pipe', park && park.pipe);
  // evening: a run view down the start piste and a view towards the evening sun (the slopes facing away from it are in the shade)
  const ev1 = await ev(() => {
    const S = window.__ski, p = S.pistes.byId.get(S.game.piste && S.game.piste.id) || S.pistes.list[0];
    const a = p.at(Math.min(200, p.length * 0.3), {}), b = p.at(Math.min(320, p.length * 0.5), {});
    const az = 236 * Math.PI / 180;
    return { run: [a.x - a.dx * 10, a.z - a.dz * 10, 6, b.x, b.z, 0, 58], sun: [a.x, a.z, 4, a.x + Math.sin(az) * 500, a.z - Math.cos(az) * 500, 0, 58], away: [a.x, a.z, 4, a.x - Math.sin(az) * 500, a.z + Math.cos(az) * 500, 0, 58] };
  });
  await pose('evening-run', ev1.run, 'evening');
  await pose('evening-shade', ev1.sun, 'evening');
  await pose('evening-away', ev1.away, 'evening');
  await pose('midday-shade', ev1.sun, 'midday');
  // a challenge gate seen from 16 m down the piste
  const gate = await ev(() => {
    const S = window.__ski, list = S.markers.list.filter((m) => !m.park);
    const m = list.find((g) => g.diff === 'red') || list[0];
    const hx = Math.cos(m.heading), hz = Math.sin(m.heading);
    return [m.x + hx * 16 + hz * 4, m.z + hz * 16 - hx * 4, 1.8, m.x, m.z, 1.8, 50];
  });
  await pose('gate', gate);
  console.log('info', JSON.stringify(await ev(() => window.__ski.info())));
}
