/* Zuchsimulator W5 (roads2): road overbridges over the line.  The real roads that cross the line on a bridge are carried across it: deck over the catenary, abutments clear of
 * the tracks and the masts, an embankment ramp that never runs below the ground, the asphalt continuing on both sides.  Standalone game page; about two minutes.
 *   - the routes have overbridges in their data (pipeline stage real_line_overbridges.py) and the plan builds most of them
 *   - every planned structure: deck underside >= 7 m over the rail head (mast head 6.9 m), abutment faces >= 3.9 m from the outer track axis, a flat deck,
 *     the road profile never under the ground, slopes that reach the ground
 *   - the chunk of an overbridge builds its group (deck / asphalt / embankment meshes) and the game logs no warning
 *   - hole detector in a window around the first overbridge of every route: no hole under the ramp, no missing terrain
 * The full probe with the numbers per structure: node scripts/zuch/ob_probe.mjs. */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';
import { scanRoute } from '../zuch/hole_lib.mjs';

const ROUTES = { west: 2, south: 3, east: 2 };       // route -> minimum number of planned overbridges
const MIN_UNDER = 7.0;
const MIN_EDGE = 3.9;
const WINDOW = 160;

export const flow = {
  name: 'train-sim-overbridges', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'medium' });
    for (const [id, min] of Object.entries(ROUTES)) {
      h.step(`${id}: road overbridges (plan, clearance, ramp, meshes)`);
      await sim.start(id);
      const rep = await sim.evalGame(({ track }, k) => {
        const base = track.base || track;
        const plan = base.overbridges;
        const out = { planned: plan ? plan.obs.length : 0, skipped: plan ? plan.skipped.length : 0, bad: [], first: null };
        if (!plan) return out;
        plan.obs.forEach((ob) => {
          const d = plan.design(ob, 112);
          const why = [];
          if (d.D - plan.constants.SLAB_T - d.railY < k.MIN_UNDER) why.push('clearance ' + (d.D - plan.constants.SLAB_T - d.railY).toFixed(2));
          if (d.reachB - Math.max(0, d.sl) < k.MIN_EDGE || Math.min(0, d.sl) - d.reachA < k.MIN_EDGE) why.push('abutment too close to the track');
          if (d.smp.some((q) => q.deck && Math.abs(q.y - d.D) > 1e-6)) why.push('deck not flat');
          const worst = d.smp.reduce((m, q) => Math.min(m, q.y - q.gm), 0);
          if (worst < -0.02) why.push('road under the ground by ' + (-worst).toFixed(2));
          if (d.smp.some((q) => !q.deck && Math.max(q.toe[0], q.toe[1]) >= 45)) why.push('slope never reaches the ground');
          if (why.length) out.bad.push({ s: Math.round(d.sCross), why });
        });
        if (plan.obs.length) out.first = Math.round(plan.design(plan.obs[0], 112).sCross);
        return out;
      }, { MIN_UNDER, MIN_EDGE });
      h.expect(rep.planned >= min, `${id}: ${rep.planned} road overbridges planned (${rep.skipped} handed back to the ordinary ribbons), >= ${min}`);
      h.eq(rep.bad, [], `${id}: every overbridge clears the catenary and the tracks, ramps on the ground, no slope in the air`);
      if (rep.first === null) continue;
      await sim.page.evaluate((s) => { __tsTest.placeAt(s - 150, 0); const w = __tsTest.internals().world; w.landscape.warm(s - 150); }, rep.first);
      await sim.frames(6);
      const groups = await sim.page.evaluate(() => { const { scene } = __tsTest.internals(); const g = []; scene.traverse((n) => { if (n.name && n.name.startsWith('overbridges-')) g.push(n.children.map((c) => c.name).join('+')); }); return g; });
      h.expect(groups.length >= 1 && groups.every((g) => /ob-asphalt/.test(g) && /ob-concrete/.test(g)), `${id}: the chunk of the first overbridge builds deck, asphalt and embankment (${groups[0] || 'none'})`);
      const rays = await scanRoute(sim, id, { step: 80, from: Math.max(60, rep.first - WINDOW), to: rep.first + WINDOW, rayStep: 30 });
      h.eq([rays.flaggedPoses.slice(0, 2), rays.rayFailures.filter((f) => f.kind !== 'step').slice(0, 2)], [[], []], `${id}: no hole around the first overbridge (${rays.poses} poses, ${rays.rays} rays)`);
    }
    h.eq(sim.errors.filter((e) => !/404/.test(e) && /overbridge/i.test(e)).slice(0, 3), [], 'no overbridge warning from the game');
  },
};
runIfMain(import.meta.url, flow);
