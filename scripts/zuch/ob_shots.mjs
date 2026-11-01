/* Overbridge QA (W5 roads2): for every road overbridge of the routes, in ONE browser session
 *   list     s, class, width, design numbers (deck level, abutments, grades, span) -> <outDir>/<route>-obs.json
 *   shots    cab (approach, 3 m), under (cab at the bridge, looking up), side (beside the track, 4 m up, along the road), aerial (oblique, 60 m up), ramp (along the road, 8 m above the deck)
 *   node scripts/zuch/ob_shots.mjs <outDir> [--quality medium] [--only 1,3] [--views cab,under,side,aerial,ramp] [--root <repo>] <route ...>
 * Run through python3 ~/Library/Caches/browser-slot.py. */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'medium'); const root = flag('root', undefined);
const only = flag('only', '').split(',').filter(Boolean).map(Number);
const views = flag('views', 'cab,under,side,aerial,ramp').split(',');
const [outDir, ...routes] = args;

const sim = await openSim({ quality, root });
try {
  for (const route of routes) {
    const dir = path.join(outDir, route.replace('~', '_'));
    fs.mkdirSync(dir, { recursive: true });
    await sim.start(route);
    const list = await sim.evalGame(({ track }) => {
      const base = track.base || track;
      const plan = base.overbridges;
      if (!plan) return { obs: [], skipped: [] };
      return {
        obs: plan.obs.map((o, i) => { const d = plan.design(o, 112); return { i, index: o.index, s: o.s, c: o.c, w: o.w, n: o.n, D: d.D, railY: d.railY, span: d.uB - d.uA, uA: d.uA, uB: d.uB, gradeA: d.gradeA, gradeB: d.gradeB, sl: d.sl, samples: d.smp.length, sCross: d.sCross }; }),
        skipped: plan.skipped.map((k) => ({ s: k.ob.s, c: k.ob.c, why: k.why })),
      };
    });
    fs.writeFileSync(path.join(dir, 'obs.json'), JSON.stringify(list, null, 1));
    console.log(route, 'overbridges', list.obs.length, 'skipped', list.skipped.length);
    for (const ob of list.obs) {
      if (only.length && !only.includes(ob.i)) continue;
      const tag = String(Math.round(ob.sCross)).padStart(6, '0') + '-' + ob.c;
      const sc = ob.sCross;
      const shot = async (name, view) => { await sim.view(view); await sim.shot(path.join(dir, `${tag}-${name}.png`)); };
      // load the chunks around
      await sim.page.evaluate((s) => { const w = __tsTest.internals().world; w.landscape.warm(s); }, sc);
      if (views.includes('cab')) await shot('cab', { trainS: sc - 170, s: sc - 150, lat: 0, up: 3, yaw: 0, pitch: 0.02, fov: 65, settle: 30 });
      if (views.includes('under')) await shot('under', { trainS: sc - 40, s: sc - 14, lat: 0, up: 3, yaw: 0, pitch: 0.16, fov: 70, settle: 20 });
      if (views.includes('side')) await shot('side', { trainS: sc - 150, s: sc - 55, lat: 24, up: 5, yaw: 1.05, pitch: -0.03, fov: 65, settle: 20 });
      if (views.includes('aerial')) await shot('aerial', { trainS: sc - 150, s: sc - 80, lat: 60, up: 60, target: { s: sc, lat: 0, up: 4 }, fov: 70, settle: 30 });
      if (views.includes('ramp')) await shot('ramp', { trainS: sc - 150, s: sc, lat: -150, up: 22, target: { s: sc, lat: 0, up: 6 }, fov: 60, settle: 30 });
    }
    console.log(route, 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
  }
} finally { await sim.close(); }
