/* Launch fix diagnostic (Ian, Tignes Champagny: "no real station, can't ride"): per lift what lifts.js draws of its stations (the 5 m
 * heights, the pruning decided on the far grid like the game): parts cut per end, floating parts, unheld bull-wheels, wheel mounts,
 * ends missing their type's main part (canopy / hut / roof / machine house / wheel mast), drawn vs rideable lifts.
 *   node scripts/ski/station-diag.mjs <resort> [name regex]     ('^' = every lift, a regex matching nothing = the summary only) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createLiftPath } = await imp('lift-path.js');
const { createLiftWorld, frames, standingParts, wheelHeld } = await imp('lift-site.js');
const { createParkLayout } = await imp('modes/park.js');
const { unpackResort } = await imp('linepack.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const rid = process.argv[2] || 'killy';
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
const dir = path.join(root, 'data', rid);
const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
const paths = new Map();
resort.lifts.forEach((src, i) => { const q = createLiftPath(src, (x, z) => field.height(x, z)); if (q) paths.set(i, q); });
const pistes = createPisteSet(resort);
const net = createLiftNet(resort, field.farHeight, pistes);
const world = createLiftWorld(paths);
let floating = 0, unheld = 0, mounts = 0, highWheel = 0;
for (const [i, site] of world.sites) for (const f of [...site.ends, ...(site.portals||[]), ...(site.stops||[])]) {
  const ok = standingParts(f); const live = f.parts.filter((p) => !p.cut);
  const fl = live.filter((p) => !ok.has(p)); floating += fl.length;
  if (fl.length) console.log('  floating', i, resort.lifts[i].name, f.which, f.type, fl.map((p) => JSON.stringify({a0:p.a0.toFixed(2),a1:p.a1.toFixed(2),b0:p.b0.toFixed(2),b1:p.b1.toFixed(2),y0:p.y0.toFixed(2),y1:p.y1.toFixed(2)})).join(' '));
  if (f.which !== undefined && site.ends.includes(f)) { if (!wheelHeld(site, f)) unheld++; mounts += f.parts.filter((p) => p.mount).length;
    const pth = site.path; if (!pth.shuttle && pth.kind !== 'train' && pth.kind !== 'carpet') { const c = f.toWorld(0, pth.wheelC || 0, {}); const hh = pth.cableY(f.which ? pth.len : 0) - field.height(c.x, c.z); if (hh > 8) { highWheel++; console.log('  high wheel', i, resort.lifts[i].name, f.which, hh.toFixed(1)); } } }
}
let missing = 0;
const ESS = { platform: ['roof', 'hut'], hall: ['roof'], terminal: ['roof', 'building'], hut: ['hutOrMast'], belt: [], rail: ['roof'] };
for (const [i, site] of world.sites) for (const f of site.ends) {
  const live = f.parts.filter((p) => !p.cut);
  for (const e of ESS[f.type] || []) {
    const has = e === 'hutOrMast' ? (f.which === 0 && site.path.sub !== 'rope' ? live.some((p) => p.hut) : true) && live.some((p) => p.post || p.mount) : live.some((p) => p[e]);
    if (!has) { missing++; console.log('  missing', e, '#' + i, resort.lifts[i].name, f.which ? 'top' : 'bottom', f.type); }
  }
}
console.log(`ends missing an essential part: ${missing}`);
console.log(`floating ${floating}, wheels unheld ${unheld}, mounts ${mounts}, wheels > 8 m over the ground ${highWheel}`);
let lost = 0, framesHit = 0;
resort.lifts.forEach((src, i) => {
  const site = world.sites.get(i);
  if (!site) { console.log(`#${i} ${src.name} ${src.kind}/${src.type}: NO PATH (not drawn)`); return; }
  const ride = net.byIndex.get(i) ? 'ride' : 'NOT RIDEABLE';
  const info = site.ends.map((e, k) => {
    const cut = e.parts.filter((p) => p.cut);
    if (cut.length) { lost += cut.length; framesHit++; }
    const tags = cut.map((p) => Object.keys(p).filter((k2) => ['roof', 'post', 'hut', 'wall', 'cap', 'detail', 'deck', 'sign', 'building'].includes(k2) && p[k2]).join('+') || 'plain');
    return `${k ? 'top' : 'bottom'} ${e.type} ${e.parts.length - cut.length}/${e.parts.length}${cut.length ? ' cut[' + tags.join(',') + ']' : ''}`;
  }).join(' | ');
  if (!filter || filter.test(src.name || '') || site.ends.some((e) => e.parts.some((p) => p.cut))) {
    if (!filter || filter.test(src.name || '')) console.log(`#${i} ${src.name} (${site.kind}${site.path.sub ? '/' + site.path.sub : ''}, ${src.len} m) ${ride}: ${info}`);
  }
});
console.log(`${rid}: ${framesHit} station ends with cut parts, ${lost} parts cut, ${world.sites.size} lifts drawn, ${net.list.length} rideable`);
// Station look (26 Nov 2026): no drawn part (solid or not; decks, gates, belts and marks aside) in the lift's OWN carriers' path round its
// stations: the carrier box (grip to the bottom of the chair / cabin, with its swing) every 0.5 m of the loop within 40 m of an end
let ownHits = 0;
const hitList = [];
for (const [i, site] of world.sites) {
  const p = site.path;
  if (p.kind === 'carpet' || (p.kind === 'drag' && p.sub === 'rope')) continue;
  const cb = p.carrier, w = {}, l = {};
  for (const f of site.ends) {
    const g0 = p.ground(f.s);
    const live = f.parts.filter((q) => !q.cut && !q.deck && !q.gateLeaf && !q.belt && !q.zoneMark);
    const seen = new Set();
    for (let u = 0; u < p.loopLen; u += 0.5) {
      p.loopAt(u, w);
      if ((f.which ? p.len - w.s : w.s) > 40) continue;
      if (p.tunnel && p.ground(w.s) - w.y > 6) continue;
      f.toLocal(w.x, w.z, l);
      const c = Math.cos(w.heading), s = Math.sin(w.heading);
      const ca = Math.abs(c * f.fx + s * f.fz), cr = Math.abs(c * f.rx + s * f.rz);
      const hw = cb.hw + cb.drop * 0.035, ea = ca * cb.hl + cr * hw, eb = cr * cb.hl + ca * hw;
      const yLo = p.kind === 'train' ? w.y : w.y - cb.drop, yHi = w.y + (p.kind === 'train' ? cb.top : cb.top);
      for (const q of live) {
        if (seen.has(q)) continue;
        if (l.a + ea <= q.a0 || l.a - ea >= q.a1 || l.b + eb <= q.b0 || l.b - eb >= q.b1) continue;
        if (yHi <= g0 + q.y0 || yLo >= g0 + q.y1) continue;
        seen.add(q); ownHits++;
        const tags = Object.keys(q).filter((k) => ['roof', 'post', 'hut', 'wall', 'cap', 'detail', 'sign', 'shape', 'near', 'building'].includes(k) && q[k]).join('+') || 'plain';
        hitList.push(`#${i} ${resort.lifts[i].name} ${f.which ? 'top' : 'bottom'} ${tags} [${[q.a0, q.a1, q.b0, q.b1, q.y0, q.y1].map((v) => v.toFixed(2)).join(' ')}] at s ${w.s.toFixed(1)} y ${(yLo - g0).toFixed(2)}..${(yHi - g0).toFixed(2)}`);
      }
    }
  }
}
for (const h of hitList.slice(0, 30)) console.log('  in own carriers\' path:', h);
console.log(`drawn parts in the lift's own carriers' path: ${ownHits}`);
// Station look: the part list of every frame must not depend on the heights (lift-site.js applyCuts repeats the first world's cuts by
// part index): the type models + dressing laid out on the far grid and on the 5 m tiles have the same number of parts, the same kinds
let countDiff = 0;
{
  const farPaths = new Map();
  resort.lifts.forEach((src, i) => { const q = createLiftPath({ ...src }, (x, z) => field.farHeight(x, z)); if (q) farPaths.set(i, q); });
  const farWorld = createLiftWorld(farPaths);
  for (const [i, site] of world.sites) {
    const other = farWorld.sites.get(i);
    if (!other) continue;
    const fa = [...site.ends, ...(site.portals || []), ...(site.stops || [])], fb = [...other.ends, ...(other.portals || []), ...(other.stops || [])];
    fa.forEach((f, k) => {
      const g = fb[k], na = f.parts.filter((p) => !p.added).length, nb = g ? g.parts.filter((p) => !p.added).length : -1;
      if (na !== nb) { countDiff++; if (countDiff < 10) console.log(`  part count depends on the heights: #${i} ${resort.lifts[i].name} frame ${k}: ${na} vs ${nb}`); }
    });
  }
}
console.log(`frames whose part list depends on the heights: ${countDiff}`);
