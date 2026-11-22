#!/usr/bin/env node
/* R8c: is every lift and piste of a resort part of its ski network? Components of the graph lift <-> piste (a lift station within LIFT_NEAR
 * m of a piste's line), piste <-> piste (an end within RUN_NEAR m of another's line), lift <-> lift (stations within LIFT_NEAR m). Lists the
 * components, the trains, and the pistes with the same name (fragments / two colours). The same rule as scripts/ski/bake.py tidy_network.
 *   node scripts/ski/r8c-network.mjs [resort ...] [--check]   (--check: exit 1 if anything is outside the main network) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const { unpackResort } = await import(path.join(root, 'linepack.js'));
const LIFT_NEAR = 150, RUN_NEAR = 60, SHORT_TRAIN = 150;
const args = process.argv.slice(2), check = args.includes('--check');
const resorts = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz'];
let bad = 0;
for (const rid of resorts) {
  const r = unpackResort(JSON.parse(fs.readFileSync(path.join(root, 'data', rid, 'resort.json'), 'utf8')));
  const lifts = r.lifts.map((l, i) => ({ i, name: l.name, kind: l.kind, a: [l.bottom.x, l.bottom.z], b: [l.top.x, l.top.z], len: Math.hypot(l.top.x - l.bottom.x, l.top.z - l.bottom.z) }));
  const runs = r.pistes.map((p) => { const pts = []; for (let i = 0; i + 1 < p.line.length; i += 2) pts.push([p.line[i], p.line[i + 1]]); return { id: p.id, name: p.name, diff: p.diff, pts }; });
  const N = lifts.length + runs.length, par = Array.from({ length: N }, (_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  const join = (a, b) => { par[find(a)] = find(b); };
  const near = (q, pts, d) => pts.some((p) => Math.abs(p[0] - q[0]) < d && Math.abs(p[1] - q[1]) < d && Math.hypot(p[0] - q[0], p[1] - q[1]) < d);
  lifts.forEach((l, i) => {
    runs.forEach((u, j) => { if (near(l.a, u.pts, LIFT_NEAR) || near(l.b, u.pts, LIFT_NEAR)) join(i, lifts.length + j); });
    lifts.forEach((m, k) => { if (k > i && [l.a, l.b].some((q) => near(q, [m.a, m.b], LIFT_NEAR))) join(i, k); });
  });
  runs.forEach((u, j) => runs.forEach((v, k) => { if (k !== j && (near(u.pts[0], v.pts, RUN_NEAR) || near(u.pts[u.pts.length - 1], v.pts, RUN_NEAR))) join(lifts.length + j, lifts.length + k); }));
  const comps = new Map();
  for (let i = 0; i < N; i++) { const c = find(i); if (!comps.has(c)) comps.set(c, { lifts: [], runs: [] }); (i < lifts.length ? comps.get(c).lifts : comps.get(c).runs).push(i < lifts.length ? lifts[i] : runs[i - lifts.length]); }
  const list = [...comps.values()].sort((a, b) => b.lifts.length - a.lifts.length);
  console.log(`\n${rid}: ${lifts.length} lifts, ${runs.length} pistes, ${list.length} components; main ${list[0].lifts.length} lifts / ${list[0].runs.length} pistes`);
  const ptsOf = (c) => [...c.lifts.flatMap((l) => [l.a, l.b]), ...c.runs.flatMap((u) => u.pts.filter((_, i) => i % 3 === 0))];
  const mainPts = ptsOf(list[0]);
  for (const c of list.slice(1)) {
    bad++;
    const at = (c.lifts[0] && c.lifts[0].a) || (c.runs[0] && c.runs[0].pts[0]);
    let gap = Infinity;
    for (const q of ptsOf(c)) for (const m of mainPts) { const d = Math.hypot(q[0] - m[0], q[1] - m[1]); if (d < gap) gap = d; }
    c.gap = gap;
    console.log(`  outside (${Math.round(gap)} m from the main network): ${c.lifts.length} lifts [${c.lifts.map((l) => l.name).slice(0, 6).join(', ')}] ${c.runs.length} pistes [${c.runs.map((u) => u.name).slice(0, 4).join(', ')}] at ${at.map(Math.round).join(',')}`);
  }
  for (const l of lifts) if (l.kind === 'train' || l.kind === 'funicular') console.log(`  train: ${l.name || '(no name)'} ${Math.round(l.len)} m${l.len < SHORT_TRAIN ? '  <- short' : ''}`);
  const byName = new Map();
  for (const u of runs) { const k = u.name.toLowerCase().replace(/ \((variante|\d+)[^)]*\)$/, ''); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(u); }
  const same = [...byName].filter(([, v]) => v.length > 1);
  console.log(`  same base name: ${same.length} groups, e.g. ${same.slice(0, 5).map(([k, v]) => `${k} x${v.length} (${v.map((u) => u.diff[0]).join('')})`).join('; ')}`);
}
if (check && bad) process.exit(1);
