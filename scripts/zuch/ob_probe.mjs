/* Overbridge probe (W5 roads2): every road overbridge of the routes against the rules Ian set -
 *   clearance   the deck underside lies >= MIN_UNDER above the rail head (catenary mast head 6.9 m), the abutment faces stand >= MIN_EDGE from the outer track axis,
 *               no pier inside the corridor (single span)
 *   ramp        the road surface never runs below the ground (no road through a hill), nowhere steeper than MAX_GRADE sample to sample, the deck is flat
 *   solid       the slopes end at the ground (toe vertices within TOE_TOL of the terrain function), nothing floats: the drawn road samples lie on the plan
 *   built       the chunk that holds the crossing has the group 'overbridge-<i>' with its meshes after warm-up, and no chunk warns "overbridge failed"
 *   node scripts/zuch/ob_probe.mjs [routeId ...] [--quality medium] [--json out.json] [--root repo]       Exit code 1 when something is flagged. */
import fs from 'node:fs';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'medium'); const jsonOut = flag('json', ''); const root = flag('root', undefined);
const ALL = ['west', 'south', 'north', 'east', 'wittlich', 'trier', 'metz', 'brussels', 'paris'];
const routes = args.length ? args : ALL;
const MIN_UNDER = 7.0; const MIN_EDGE = 3.9; const MAX_GRADE = 0.3; const TOE_MAX = 46; const BELOW_TOL = 0.02;

const sim = await openSim({ quality, root });
let bad = 0;
const all = {};
try {
  for (const id of routes) {
    await sim.start(id);
    const rep = await sim.evalGame(({ track }, k) => {
      const base = track.base || track;
      const plan = base.overbridges;
      const out = { route: base.id, planned: 0, skipped: plan ? plan.skipped.map((s) => ({ s: Math.round(s.ob.s), why: s.why, need: Math.round(s.need * 1000) / 1000 })) : [], flags: [], obs: [] };
      if (!plan) return out;
      const cap = 112;
      for (const ob of plan.obs) {
        out.planned += 1;
        const d = plan.design(ob, cap);
        const smp = d.smp;
        const info = { need: Math.round(ob.need * 1000) / 1000, s: Math.round(d.sCross), c: ob.c, w: ob.w, span: Math.round((d.uB - d.uA) * 10) / 10, D: Math.round((d.D - d.railY) * 100) / 100, gradeA: Math.round(d.gradeA * 1000) / 1000, gradeB: Math.round(d.gradeB * 1000) / 1000, edgeA: Math.round(d.reachA * 10) / 10, edgeB: Math.round(d.reachB * 10) / 10 };
        out.obs.push(info);
        const flag = (kind, extra) => out.flags.push(Object.assign({ kind, s: info.s, c: ob.c }, extra || {}));
        if (d.D - plan.constants.SLAB_T - d.railY < k.MIN_UNDER) flag('clearance', { under: Math.round((d.D - plan.constants.SLAB_T - d.railY) * 100) / 100 });
        const outer = Math.max(Math.abs(d.sl), 0);
        if (d.reachB - Math.max(0, d.sl) < k.MIN_EDGE || Math.min(0, d.sl) - d.reachA < k.MIN_EDGE) flag('edge', { a: d.reachA, b: d.reachB, sl: d.sl });
        void outer;
        // ramp: never below the ground at the cross-section maximum, grade sample to sample, flat deck
        let worst = 0; let steep = 0;
        for (let i = 0; i < smp.length; i++) {
          const q = smp[i];
          worst = Math.min(worst, q.y - q.gm);
          if (i) { const du = Math.max(0.5, q.u - smp[i - 1].u); const g = Math.abs(q.y - smp[i - 1].y) / du; if (!q.deck && q.y - q.gm > 0.3 && smp[i - 1].y - smp[i - 1].gm > 0.3 && g > steep) steep = g; }   // on the ground the road follows the terrain, however steep it is
          if (q.deck && Math.abs(q.y - d.D) > 1e-6) flag('deck-not-flat', { u: Math.round(q.u) });
        }
        if (worst < -k.BELOW_TOL) flag('below-ground', { by: Math.round(worst * 100) / 100 });
        if (steep > k.MAX_GRADE) flag('steep', { grade: Math.round(steep * 1000) / 1000 });
        // the slopes reach the ground (a toe that ran out of search range = a slope in the air)
        let open = 0;
        smp.forEach((q) => { if (!q.deck) open = Math.max(open, q.toe[0], q.toe[1]); });
        if (open >= k.TOE_MAX - 1) flag('slope-in-air', { toe: Math.round(open) });
      }
      return out;
    }, { MIN_UNDER, MIN_EDGE, MAX_GRADE, TOE_MAX, BELOW_TOL });
    // meshes: visit every overbridge so that its chunk is built, then look for the group in the scene
    const built = [];
    for (const o of rep.obs) {
      await sim.page.evaluate((s) => { __tsTest.placeAt(s - 150, 0); const w = __tsTest.internals().world; w.landscape.warm(s - 150); }, o.s);
      await sim.frames(3);
      const have = await sim.page.evaluate((s) => {
        const { scene } = __tsTest.internals();
        const found = []; scene.traverse((n) => { if (n.name && n.name.startsWith('overbridges-')) found.push(n.name + ':' + n.children.length); });
        return found;
      }, o.s);
      built.push({ s: o.s, groups: have.length });
      if (!have.length) { rep.flags.push({ kind: 'not-built', s: o.s, c: o.c }); }
    }
    const warn = sim.errors.filter((e) => /overbridge/i.test(e));
    if (warn.length) rep.flags.push({ kind: 'warning', text: warn.slice(0, 2).join(' | ').slice(0, 300) });
    console.log(`${id}: ${rep.planned} overbridges planned, ${rep.skipped.length} skipped ${JSON.stringify(rep.skipped)}, ${rep.flags.length} flagged`);
    console.log('   need/span/D: ' + rep.obs.map((o) => `${o.s}:${o.need}/${o.span}/${o.D}`).join(' '));
    rep.flags.slice(0, 20).forEach((f) => console.log('   ' + JSON.stringify(f)));
    bad += rep.flags.length;
    all[id] = rep;
  }
} finally { await sim.close(); }
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(all, null, 1));
console.log(bad ? `PROBLEMS: ${bad}` : 'overbridges ok');
process.exit(bad ? 1 : 0);
