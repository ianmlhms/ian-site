#!/usr/bin/env node
/* R8g (Ian, iPad, Arlberg "Stallmähder-Fang": a red net stood ACROSS the course): every barrier a challenge course meets against the
 * line the skier follows (the piste line from the start gate to the ZIL: the scripted skier, the HUD distance and the off-course timer
 * all follow it), over EVERY course of every resort (Sonnenkopf is part of arlberg):
 *   node scripts/ski/barrier-check.mjs [resort ...] [--only id,id] [--list]
 *   barriers   the course's own net ribbons (course.js courseLayout rails) AND the permanent race nets of a resort landmark
 *              (landmarks.js worldcupNets: the Kandahar's A-nets in Arlberg)
 *   line       no barrier segment crosses the course line or comes within MIN_GAP m of it (start gate -> ZIL): the line itself is a
 *              way to the finish that never passes a net
 *   corridor   across the line (every 2 m), the nearest barrier left + the nearest right >= MIN_CORRIDOR m apart (or left open)
 * Exit code 1 on a failed check. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createScatter } = await imp('scatter.js');
const { createPisteSet, createLineIndex } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { createObstacles, courseGate, courseFinish } = await imp('modes/clear.js');
const { courseLayout } = await imp('modes/course.js');
const { worldcupNets, worldcupHouseClear } = await imp('landmarks.js');
const { unpackResort } = await imp('linepack.js');
const { housesOnStreets, decodeRoads } = await imp('roads.js');

const MIN_GAP = 2, MIN_CORRIDOR = 6, RAY = 60, CELL = 20;
const args = process.argv.slice(2);
const LIST = args.includes('--list');
const onlyArg = args.indexOf('--only');
const ONLY = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',')) : null;
const rids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno'];
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };

/** A grid of 2D barrier segments [ax, az, bx, bz, kind]. */
function segGrid(segs) {
  const g = new Map();
  const key = (i, j) => i * 65536 + j;
  for (const q of segs) {
    for (let i = Math.floor(Math.min(q[0], q[2]) / CELL); i <= Math.floor(Math.max(q[0], q[2]) / CELL); i++) {
      for (let j = Math.floor(Math.min(q[1], q[3]) / CELL); j <= Math.floor(Math.max(q[1], q[3]) / CELL); j++) {
        const k = key(i, j); if (!g.has(k)) g.set(k, []); g.get(k).push(q);
      }
    }
  }
  /** The nearest hit of the ray (x, z) + t (dx, dz), 0 < t <= len, or Infinity. */
  function ray(x, z, dx, dz, len) {
    let best = Infinity;
    const seen = new Set();
    for (let t = 0; t <= len + CELL; t += CELL / 2) {
      const cx = x + dx * Math.min(t, len), cz = z + dz * Math.min(t, len);
      for (let i = Math.floor(cx / CELL) - 1; i <= Math.floor(cx / CELL) + 1; i++) for (let j = Math.floor(cz / CELL) - 1; j <= Math.floor(cz / CELL) + 1; j++) {
        for (const q of g.get(key(i, j)) || []) {
          if (seen.has(q)) continue; seen.add(q);
          const ex = q[2] - q[0], ez = q[3] - q[1], den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const wx = q[0] - x, wz = q[1] - z;
          const tt = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den;
          if (tt > 0 && tt <= len && u >= 0 && u <= 1) best = Math.min(best, tt);
        }
      }
      if (best < t - CELL) break;
    }
    return best;
  }
  return { ray };
}

const report = [];
for (const rid of rids.length ? rids : ALL) {
  const t0 = Date.now();
  console.log(`\n== ${rid}`);
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const height = (x, z) => surface.height(x, z);
  const scatter = createScatter(field);
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, (x, z) => field.farHeight(x, z), pistes);
  const obs = createObstacles({ resort, field, scatter, density: 0.8, liftWorld: () => lifts.world });
  obs.setPistes(pistes.list);
  const buildingRows = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const liftWorld = lifts.setBuildings(buildingRows);
  const onStreet = housesOnStreets(buildingRows, decodeRoads(JSON.parse(fs.readFileSync(path.join(dir, 'roads.json'), 'utf8'))));
  obs.setBuildings(buildingRows.filter((_, i) => liftWorld.keepBuilding(i) && !onStreet.has(i)));

  // the permanent race nets (resort landmarks), like landmarks.js builds them
  const raceSegs = [];
  for (const lm of resort.landmarks || []) {
    if (lm.kind !== 'worldcup' || !pistes.byId.get(lm.piste)) continue;
    const { runs } = worldcupNets(pistes.byId.get(lm.piste), height, pistes);
    for (const r of runs) for (let i = 3; i < r.length; i += 3) raceSegs.push([r[i - 3], r[i - 1], r[i], r[i + 2], `race:${lm.piste}`]);
    // the start hut + banner (no collision, but a skier must not ski through a house): only drawn where no other piste runs
    const rp = pistes.byId.get(lm.piste), top = rp.at(0, {});
    const through = pistes.list.filter((q) => q !== rp && q.project(top.x, top.z, null, 0, {}).dist < q.halfWidth + 1.5).map((q) => q.id);
    const drawn = lm.house !== false && worldcupHouseClear(rp, pistes);
    check(!drawn || !through.length, `race piste ${lm.piste}: start hut ${drawn ? 'drawn' : 'left out'}${through.length ? ` (other pistes through its spot: ${through.join(', ')})` : ''}`);
  }

  let total = 0, bad = 0, badOwn = 0, badRace = 0, narrow = 0, worstGap = Infinity, worstCorr = Infinity;
  const badList = [], narrowList = [];
  for (const p of pistes.list) {
    if (ONLY && !ONLY.has(p.id)) continue;
    total++;
    const g = courseGate(p, obs);
    const f = courseFinish(p, obs, g.s);
    const lay = courseLayout(p, g.s, pistes, obs, f.s);
    const segs = [];
    for (const r of lay.rails) for (let i = 2; i < r.length; i += 2) segs.push([r[i - 2], r[i - 1], r[i], r[i + 1], 'course']);
    const line = createLineIndex([{ piste: p, s0: g.s, s1: lay.finishS }]);
    // line: every barrier segment, sampled every 0.5 m, >= MIN_GAP m from the course line
    let gap = Infinity, gapKind = '', gapAt = null, gapOwn = Infinity, gapRace = Infinity;
    for (const q of [...segs, ...raceSegs]) {
      const L = Math.hypot(q[2] - q[0], q[3] - q[1]), m = Math.max(1, Math.ceil(L / 0.5));
      for (let k = 0; k <= m; k++) {
        const x = q[0] + (q[2] - q[0]) * k / m, z = q[1] + (q[3] - q[1]) * k / m;
        const d = line.distance(x, z, 10);
        if (d < gap) { gap = d; gapKind = q[4]; gapAt = [x, z]; }
        if (q[4] === 'course') gapOwn = Math.min(gapOwn, d); else gapRace = Math.min(gapRace, d);
      }
    }
    worstGap = Math.min(worstGap, gap);
    if (gap < MIN_GAP) {
      bad++;
      if (gapOwn < MIN_GAP) badOwn++;
      if (gapRace < MIN_GAP) badRace++;
      const pr = p.project(gapAt[0], gapAt[1], null, 0, {});
      badList.push(`${p.id} (${gapKind} net ${gap.toFixed(1)} m from the line at s ${Math.round(pr.s)})`);
    }
    // corridor: across the line every 2 m
    const grid = segGrid([...segs, ...raceSegs]);
    const a = {};
    let corr = Infinity, corrAt = 0;
    for (let s = g.s + 4; s < lay.finishS; s += 2) {
      p.at(s, a);
      const rx = -a.dz, rz = a.dx;
      const w = grid.ray(a.x, a.z, rx, rz, RAY) + grid.ray(a.x, a.z, -rx, -rz, RAY);
      if (w < corr) { corr = w; corrAt = s; }
    }
    worstCorr = Math.min(worstCorr, corr);
    if (corr < MIN_CORRIDOR) { narrow++; narrowList.push(`${p.id} (${corr.toFixed(1)} m at s ${Math.round(corrAt)})`); }
  }
  check(bad === 0, `line: ${total - bad}/${total} courses with no barrier crossing or within ${MIN_GAP} m of the line start -> ZIL (${badOwn} by their own nets, ${badRace} by a race piste's nets; nearest ${Number.isFinite(worstGap) ? worstGap.toFixed(1) : "> 10"} m)${badList.length ? `; bad: ${badList.slice(0, LIST ? 1e9 : 8).join(', ')}` : ''}`);
  check(narrow === 0, `corridor: ${total - narrow}/${total} courses >= ${MIN_CORRIDOR} m between the barriers everywhere (narrowest ${worstCorr.toFixed(1)} m)${narrowList.length ? `; narrow: ${narrowList.slice(0, LIST ? 1e9 : 8).join(', ')}` : ''}`);
  report.push({ rid, total, bad, badOwn, badRace, narrow, race: raceSegs.length });
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log('\nper resort:');
for (const r of report) console.log(`  ${r.rid.padEnd(10)} ${r.total} courses | crossing / < ${MIN_GAP} m: ${r.bad} (own nets ${r.badOwn}, race nets ${r.badRace}) | corridor < ${MIN_CORRIDOR} m: ${r.narrow} | race net segments ${r.race}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
