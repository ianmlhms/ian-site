/* Lux Drive: the terrain and road numbers of a checkout, before and after a fix.
 *   node scripts/luxdrive/terrain_report.mjs <path to a pb/lux-drive/ folder, with the trailing slash> [--verbose]
 * Runs on any checkout (the folder decides which road code is measured).  Reported:
 *   humps   every stretch of a carved way where the car (50 km/h, 2 m base, the 1 m physics lattice) is lifted by more than 1.5 m/s2, junction aprons excepted;
 *           with the deepest cutting / highest embankment of the bed against the land
 *   beds    how far the beds leave the land (cuttings over 2.5 m, embankments over 1 m)
 *   sides   the ground beside the roads, measured exactly like the world flow (luxdrive_world.mjs): p90 / p99 slope, the share of sides steeper than the land, walls
 *   steps   a step on the carriageway: the height field jumps by more than 2 cm within 4 cm (a lattice-free probe of the nearest-arm switch of overlapping ways) */
import fs from 'node:fs'; import path from 'node:path';
const R = process.argv[2];
const VERBOSE = process.argv.includes('--verbose');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);   // humps, sides, steps (default: all)
const wants = (name) => !ONLY.length || ONLY.includes(name);
const STRIDE = Number((process.argv.find((a) => a.startsWith('--stride=')) || '--stride=1').slice(9));   // every Nth way only (a quick look)
const { loadWorldData } = await import(R + 'world-data.js');
const { createHeightField } = await import(R + 'heightfield.js');
const { createSurface } = await import(R + 'surface.js');
const data = await loadWorldData(async (name) => new Uint8Array(fs.readFileSync(path.join(R, 'data', name))));
const field = createHeightField({ near: data.near, far: data.far, roads: data.roads });
const surface = createSurface(field);
const net = field.network;
const nameOf = (c) => data.roads[c.road].name || data.roads[c.road].kind;

const TIGHT_BEND_R = 12;                                   // m: a tight bend fans its cross sections out; gate I does not measure it either
let designSpeed = () => 14;                                // m/s; the checkouts that predate the class radii drive every way at 50 km/h
try { designSpeed = (await import(R + 'road-bed.js')).designSpeed ?? designSpeed; } catch { /* old checkout */ }
const MAX_BOB = 1.5, STRETCH_GAP = 30;
const withArc = (c) => { if (c.arc) return c; const arc = new Float64Array(c.x.length); for (let i = 1; i < c.x.length; i++) arc[i] = arc[i - 1] + Math.hypot(c.x[i] - c.x[i - 1], c.z[i] - c.z[i - 1]); return { ...c, arc }; };   // (old checkouts have no arc)
const chains = net.chains.map(withArc).filter((c) => !c.tagged && !net.overRoads.has(c.road) && c.arc[c.arc.length - 1] >= 30).filter((c, i) => i % STRIDE === 0);

// ---- junction aprons (as the harness gate I)
const GC = 32, gk = (a, b) => a * 4096 + b, segGrid = new Map();
for (const ch of net.chains) for (let i = 1; i < ch.x.length; i++) {
  const x0 = Math.floor(Math.min(ch.x[i - 1], ch.x[i]) / GC), x1 = Math.floor(Math.max(ch.x[i - 1], ch.x[i]) / GC);
  const z0 = Math.floor(Math.min(ch.z[i - 1], ch.z[i]) / GC), z1 = Math.floor(Math.max(ch.z[i - 1], ch.z[i]) / GC);
  for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = gk(a, b); const l = segGrid.get(k); if (l) l.push(ch, i); else segGrid.set(k, [ch, i]); }
}
function inJunction(road, x, z) {
  if (net.protection(x, z) > 0) return true;
  const cx = Math.floor(x / GC), cz = Math.floor(z / GC);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = segGrid.get(gk(cx + a, cz + b)); if (!l) continue;
    for (let q = 0; q < l.length; q += 2) {
      const o = l[q], j = l[q + 1]; if (o.road === road) continue;
      const ax = o.x[j - 1], az = o.z[j - 1], ex = o.x[j] - ax, ez = o.z[j] - az, ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < net.info[o.road].a0 + 3) return true;
    }
  }
  return false;
}
const lineAt = (ch, d, o) => {
  let k = 0; while (k < ch.arc.length - 2 && ch.arc[k + 1] < d) k++;
  const t = (d - ch.arc[k]) / Math.max(1e-9, ch.arc[k + 1] - ch.arc[k]);
  o.x = ch.x[k] + (ch.x[k + 1] - ch.x[k]) * t; o.z = ch.z[k] + (ch.z[k + 1] - ch.z[k]) * t; o.k = k; return o;
};
const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : 0; };

console.log(R);
const pt = { x: 0, z: 0, k: 0 };
// ---- humps and beds
if (wants('humps')) {
const stretches = [];
let points = 0, over = 0, deepCut = 0, deepCutAt = '', cutOver25 = 0, fillOver1 = 0, samples = 0;
const accAll = [];
for (const ch of chains) {
  const L = ch.arc[ch.arc.length - 1], m = Math.floor(L);
  const h = new Float64Array(m + 1), ok = new Uint8Array(m + 1);
  const SPEED = designSpeed(ch.kind ?? data.roads[ch.road].kind);
  for (let q = 0; q <= m; q++) { lineAt(ch, q, pt); h[q] = surface.height(pt.x, pt.z); ok[q] = inJunction(ch.road, pt.x, pt.z) ? 0 : 1; }
  for (let i = 1; i < ch.x.length - 1; i++) {
    const ax = ch.x[i - 1], az = ch.z[i - 1], bx = ch.x[i], bz = ch.z[i], cx = ch.x[i + 1], cz = ch.z[i + 1];
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    const Rb = area2 < 1e-9 ? Infinity : (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * area2);
    if (Rb < TIGHT_BEND_R) for (let q = Math.max(0, Math.floor(ch.arc[i] - 8)); q <= Math.min(m, Math.ceil(ch.arc[i] + 8)); q++) ok[q] = 0;
  }
  for (let i = 0; i < ch.x.length; i++) {
    const cut = ch.ground[i] - ch.bed[i]; samples++;
    if (cut > deepCut) { deepCut = cut; deepCutAt = `${nameOf(ch)} ${Math.round(ch.x[i])},${Math.round(ch.z[i])}`; }
    if (cut > 2.5) cutOver25++;
    if (-cut > 1.0) fillOver1++;
  }
  let cur = null;
  for (let q = 2; q <= m - 2; q++) {
    if (!ok[q - 2] || !ok[q] || !ok[q + 2]) continue;
    const acc = SPEED * SPEED * Math.abs(h[q + 2] + h[q - 2] - 2 * h[q]) / 4;
    points++; accAll.push(acc);
    if (acc > MAX_BOB) {
      over++;
      if (cur && q - cur.last <= STRETCH_GAP) { cur.last = q; if (acc > cur.peak) { cur.peak = acc; cur.at = q; } }
      else { cur = { ch, first: q, last: q, peak: acc, at: q }; stretches.push(cur); }
    }
  }
}
console.log(`humps: ${stretches.length} stretches (acc > ${MAX_BOB} m/s2 at 50 km/h), ${over} of ${points} points (${(100 * over / points).toFixed(2)} %); p50 ${pct(accAll, .5).toFixed(3)} p99 ${pct(accAll, .99).toFixed(2)} max ${accAll.reduce((m, a) => Math.max(m, a), 0).toFixed(1)}`);
stretches.sort((a, b) => b.peak - a.peak);
const humpRows = stretches.map((s) => {
  lineAt(s.ch, s.at, pt);
  let cut = 0; for (let q = Math.max(0, Math.floor(s.first - 25)); q <= Math.min(Math.floor(s.ch.arc[s.ch.arc.length - 1]), s.last + 25); q += 2) { lineAt(s.ch, q, pt); let k = pt.k; cut = Math.max(cut, Math.abs(s.ch.ground[k] - s.ch.bed[k])); }
  lineAt(s.ch, s.at, pt);
  return `${nameOf(s.ch)} (${data.roads[s.ch.road].kind}) at ${pt.x.toFixed(0)},${pt.z.toFixed(0)} peak ${s.peak.toFixed(1)} m/s2, ${s.last - s.first + 1} m long, bed-land up to ${cut.toFixed(2)} m`;
});
for (const r of humpRows.slice(0, VERBOSE ? 200 : 12)) console.log('   ' + r);
console.log(`beds: deepest cutting ${deepCut.toFixed(2)} m (${deepCutAt}); samples cut > 2.5 m: ${cutOver25}; embankment > 1 m: ${fillOver1}; of ${samples}`);
}

// ---- the ground beside the roads, exactly as the world flow measures it
if (wants('sides')) {
  const S = net.segments, rows = [], STRIDE = 41;
  for (let i = 0; i < net.count; i += STRIDE) {
    const ax = S.X0[i], az = S.Z0[i], bx = S.X1[i], bz = S.Z1[i];
    const len = Math.hypot(bx - ax, bz - az); if (len < 1) continue;
    const px = (ax + bx) / 2, pz = (az + bz) / 2, nx = -(bz - az) / len, nz = (bx - ax) / len;
    const a0 = S.A0[i], reach = S.REACH[i];
    for (const s of [1, -1]) {
      let carved = 0, natural = 0, atX = 0, atZ = 0;
      for (let d = a0 + 0.5; d <= reach; d += 0.5) {
        const x = px + nx * s * d, z = pz + nz * s * d;
        const h0 = field.height(x, z), h1 = field.height(x + nx * s * 0.5, z + nz * s * 0.5);
        const g0 = field.groundHeight(x, z), g1 = field.groundHeight(x + nx * s * 0.5, z + nz * s * 0.5);
        const c = Math.abs(h1 - h0) / 0.5; if (c > carved) { carved = c; atX = x; atZ = z; }
        natural = Math.max(natural, Math.abs(g1 - g0) / 0.5);
      }
      rows.push({ carved, natural, x: atX, z: atZ, road: S.ROADOF[i] });
    }
  }
  const sorted = rows.slice().sort((a, b) => a.carved - b.carved);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].carved;
  const bad = rows.filter((r) => r.carved > Math.max(0.84, r.natural + 0.25));
  const walls = rows.filter((r) => r.carved > 3 && r.natural <= 3);
  console.log(`sides: ${rows.length} measured; p50 ${q(.5).toFixed(2)} p90 ${q(.9).toFixed(2)} p99 ${q(.99).toFixed(2)}; steeper than the land ${bad.length} (${(100 * bad.length / rows.length).toFixed(2)} %); walls the carve made ${walls.length}, deepest ${walls.reduce((m, r) => Math.max(m, r.carved), 0).toFixed(2)}; land cliffs ${rows.filter((r) => r.natural > 3).length}`);
  if (VERBOSE) for (const r of walls.sort((a, b) => b.carved - a.carved).slice(0, 25)) console.log(`   wall ${r.carved.toFixed(2)} (land ${r.natural.toFixed(2)}) at ${r.x.toFixed(0)},${r.z.toFixed(0)} ${data.roads[r.road].name || data.roads[r.road].kind}`);
  if (VERBOSE) for (const r of bad.sort((a, b) => b.carved - a.carved).slice(0, 25)) console.log(`   steep ${r.carved.toFixed(2)} (land ${r.natural.toFixed(2)}) at ${r.x.toFixed(0)},${r.z.toFixed(0)} ${data.roads[r.road].name || data.roads[r.road].kind}`);
}

// ---- steps on the carriageway
if (wants('steps')) {
  const D = 0.02, LIMIT = 0.02, FLAT_SIDE = 0.35, info = { sdCar: 9, sdPave: 9 };
  const hits = [];
  let measured = 0;
  const seen = new Set();
  for (const ch of chains) {
    const hw = net.info[ch.road].hw, L = ch.arc[ch.arc.length - 1];
    for (let s = 0; s <= L; s += 1) {
      lineAt(ch, s, pt);
      const i0 = Math.min(ch.x.length - 2, pt.k);
      const dx = ch.x[i0 + 1] - ch.x[i0], dz = ch.z[i0 + 1] - ch.z[i0], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      for (let lat = -hw + 0.5; lat <= hw - 0.5 + 1e-9; lat += 1) {
        const x = pt.x + nx * lat, z = pt.z + nz * lat;
        field.height(x, z, info);
        if (info.sdCar > -0.5 || net.protection(x, z) > 0) continue;      // (ground under a way that rides over it is the DTM itself, steps of the DTM included)
        measured++;
        const f = (a, b) => field.height(a, b);
        const jx = f(x + D, z) - f(x - D, z) - D * (f(x + 1, z) - f(x - 1, z)) / 1, jz = f(x, z + D) - f(x, z - D) - D * (f(x, z + 1) - f(x, z - 1)) / 1;
        const jump = Math.max(Math.abs(jx), Math.abs(jz));
        // a step on LEVEL ground: the surface on both sides of it is nearly flat (a wall between two levels of a ramp is the business of the side-slope gate)
        if (jump > LIMIT) {
          const horizontal = Math.abs(jx) >= Math.abs(jz);
          const [ux, uz] = horizontal ? [1, 0] : [0, 1];
          const flat = (sign) => Math.abs(f(x + ux * sign * (D + 0.3), z + uz * sign * (D + 0.3)) - f(x + ux * sign * (D + 0.5), z + uz * sign * (D + 0.5))) / 0.2 < FLAT_SIDE;
          if (!flat(1) || !flat(-1)) continue;
        }
        if (jump > LIMIT) { const key = `${Math.round(x / 6)},${Math.round(z / 6)}`; if (!seen.has(key)) { seen.add(key); hits.push({ x, z, jump, name: nameOf(ch) }); } }
      }
    }
  }
  // the levels of the ways that reach a step: ways whose beds differ by more than LEVEL_APART are two levels (a retaining wall between two carriageways, not a step on level ground)
  const LEVEL_APART = 0.6;
  let bedAtArc = null;
  try { bedAtArc = (await import(R + 'road-bed.js')).bedAtArc; } catch { /* old checkout */ }
  if (bedAtArc) for (const h of hits) {
    const levels = [];
    for (const c of chains) {
      const bench = net.info[c.road].hw + net.info[c.road].kerbW;
      let best = Infinity, bs = 0, bt = 0;
      for (let k = 0; k + 1 < c.x.length; k++) {
        if (Math.abs(c.x[k] - h.x) > 40 || Math.abs(c.z[k] - h.z) > 40) continue;
        const ex = c.x[k + 1] - c.x[k], ez = c.z[k + 1] - c.z[k], ll = ex * ex + ez * ez;
        let t = ll > 1e-9 ? ((h.x - c.x[k]) * ex + (h.z - c.z[k]) * ez) / ll : 0; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(h.x - c.x[k] - ex * t, h.z - c.z[k] - ez * t);
        if (d < best) { best = d; bs = k; bt = t; }
      }
      if (best < bench + 4) levels.push(bedAtArc(c, c.arc[bs] + bt * (c.arc[bs + 1] - c.arc[bs])));
    }
    h.apart = levels.length > 1 ? Math.max(...levels) - Math.min(...levels) : 0;
    h.ways = levels.length;
  }
  const level = hits.filter((h) => h.apart === undefined || h.apart <= LEVEL_APART);
  hits.sort((a, b) => b.jump - a.jump);
  if (bedAtArc) { const big = hits.filter((h) => h.jump > 0.05); console.log(`steps > 5 cm by the ways that reach them: one way ${big.filter((h) => h.ways <= 1).length}, several ways at one level ${big.filter((h) => h.ways > 1 && h.apart <= LEVEL_APART).length}, at two levels (> ${LEVEL_APART} m apart) ${big.filter((h) => h.apart > LEVEL_APART).length}`); }
  if (bedAtArc) console.log(`steps by the ways that reach them: one way ${hits.filter((h) => h.ways <= 1).length}, several ways at one level (<= ${LEVEL_APART} m apart) ${hits.filter((h) => h.ways > 1 && h.apart <= LEVEL_APART).length}, at two levels ${hits.filter((h) => h.apart > LEVEL_APART).length}`);
  console.log(`steps by size: > 2 cm ${hits.length}, > 5 cm ${hits.filter((h) => h.jump > 0.05).length}, > 10 cm ${hits.filter((h) => h.jump > 0.1).length}, > 20 cm ${hits.filter((h) => h.jump > 0.2).length}`);
  console.log(`steps: ${hits.length} places with a jump > ${LIMIT * 100} cm within ${D * 200} cm on the carriageway (${measured} probes); worst ${hits[0] ? (hits[0].jump * 100).toFixed(1) + ' cm' : '-'}`);
  if (process.argv.includes('--small')) for (const h of hits.filter((q) => q.jump < 0.05).filter((q, i) => i % 40 === 0).slice(0, 25)) console.log(`   small ${(h.jump * 100).toFixed(1)} cm at ${h.x.toFixed(1)},${h.z.toFixed(1)} ${h.name} [${h.ways} way(s), ${h.apart.toFixed(2)} m apart]`);
  for (const h of hits.slice(0, VERBOSE ? 40 : 8)) console.log(`   step ${(h.jump * 100).toFixed(1)} cm at ${h.x.toFixed(1)},${h.z.toFixed(1)} ${h.name}${h.ways !== undefined ? ` [${h.ways} way${h.ways === 1 ? '' : 's'}, ${h.apart.toFixed(2)} m apart]` : ''}`);
}
