/* Picks the snow park of one resort (round 4A) and writes it into pb/ski/data/<rid>/resort.json as "park":
 *   node scripts/ski/park_site.mjs <rid> [--dry]
 * Candidates: $SKI_WORK/<rid>/park-candidates.json from park_osm.py (OSM piste:type=snow_park). Each candidate becomes a straight run line
 * down its fall line (an area: through its centre; a mapped line: top to bottom), 260..420 m long; it is scored on a steady, skiable
 * gradient (8-18 degrees), smoothness, open snow (no forest / rock / water / houses in the 40 m corridor) and a lift nearby. Without a
 * usable mapped park one is placed on the best gentle open slope next to a chairlift / drag lift / gondola (lines down the fall line from
 * points around the lift's upper half).
 * The written profile (heights every 10 m along the line, from the 5 m tiles, smoothed, always falling) is what pb/ski/modes/park.js
 * flattens the corridor to, so the park's ground is the same on every device and does not depend on tile streaming. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const { decodeGrid, decodeRle } = await import(path.join(repo, 'pb/ski/codec.js'));
const { createField, createPisteNet } = await import(path.join(repo, 'pb/ski/field.js'));

const rid = process.argv[2];
const dry = process.argv.includes('--dry');
if (!rid) { console.error('usage: node scripts/ski/park_site.mjs <rid> [--dry]'); process.exit(2); }
const dir = path.join(repo, 'pb/ski/data', rid);
const resortPath = path.join(dir, 'resort.json');
const resort = JSON.parse(fs.readFileSync(resortPath, 'utf8'));
const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
const field = createField({ resort, far, classes, net: createPisteNet(resort.network) });
for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));

const STEP = 10, HW = 18, MIN_LEN = 260, MAX_LEN = 420, IDEAL_DEG = 12;
const work = process.env.SKI_WORK || path.join(os.homedir(), 'Library/Caches/ski-work');
const candPath = path.join(work, rid, 'park-candidates.json');
const candidates = fs.existsSync(candPath) ? JSON.parse(fs.readFileSync(candPath, 'utf8')) : [];
const h = (x, z) => field.baseHeight(x, z);
const attr = {};
const inBox = (x, z) => x > 200 && z > 200 && x < resort.width - 200 && z < resort.depth - 200;

function fallDir(x, z, span = 30) {
  const gx = (h(x + span, z) - h(x - span, z)) / (2 * span), gz = (h(x, z + span) - h(x, z - span)) / (2 * span);
  const l = Math.hypot(gx, gz) || 1;
  return [-gx / l, -gz / l];
}

/** Lift lines as [ax, az, bx, bz, name] segments (no magic carpets, no big cable cars: a park sits by a chair or a drag). */
const liftSegs = [];
for (const l of resort.lifts) {
  if (l.kind === 'carpet') continue;
  for (let i = 0; i + 3 < l.pts.length; i += 2) liftSegs.push([l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3], l.name || '', l.kind]);
}
function nearestLift(x, z) {
  let best = 1e9, name = '';
  for (const s of liftSegs) {
    const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2));
    const d = Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t);
    if (d < best) { best = d; name = s[4]; }
  }
  return { d: best, name };
}

/** Score of a straight line from (x0, z0) along unit (ux, uz) over len m (lower is better), or null when unusable. */
function evaluate(x0, z0, ux, uz, len) {
  const n = Math.floor(len / STEP) + 1;
  const raw = [];
  let bad = 0, samples = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + ux * i * STEP, z = z0 + uz * i * STEP;
    if (!inBox(x, z)) return null;
    raw.push(h(x, z));
    for (const off of [-HW, -HW / 2, 0, HW / 2, HW]) {
      field.attrs(x - uz * off, z + ux * off, attr);
      bad += Math.max(attr.forest, attr.rock, attr.water, attr.built);
      samples++;
    }
  }
  // smoothed profile (30 m window), forced to fall at least 0.25 m per step
  const prof = raw.map((_, i) => { let s = 0, c = 0; for (let k = -1; k <= 1; k++) { const j = i + k; if (j >= 0 && j < n) { s += raw[j]; c++; } } return s / c; });
  for (let i = 1; i < n; i++) prof[i] = Math.min(prof[i], prof[i - 1] - 0.25);
  const drop = prof[0] - prof[n - 1];
  const meanDeg = Math.atan(drop / ((n - 1) * STEP)) * 180 / Math.PI;
  let rough = 0, maxDeg = 0;
  for (let i = 1; i < n; i++) {
    rough += Math.abs(raw[i] - prof[i]);
    maxDeg = Math.max(maxDeg, Math.atan((prof[i - 1] - prof[i]) / STEP) * 180 / Math.PI);
  }
  rough /= n;
  if (meanDeg < 6 || meanDeg > 22 || maxDeg > 28) return null;
  const share = bad / samples;
  if (share > 0.35) return null;
  const lift = nearestLift(x0 + ux * len / 2, z0 + uz * len / 2);
  const score = Math.abs(meanDeg - IDEAL_DEG) * 0.6 + Math.max(0, maxDeg - 18) * 0.8 + rough * 1.5 + share * 30 + Math.max(0, MIN_LEN + 60 - len) / 25 + Math.max(0, lift.d - 250) / 60;
  return { score, profile: prof.map((v) => Math.round(v * 20) / 20), meanDeg, maxDeg, rough, share, lift };
}

const results = [];
for (const c of candidates) {
  const xs = [], zs = [];
  for (let i = 0; i < c.pts.length; i += 2) { xs.push(c.pts[i]); zs.push(c.pts[i + 1]); }
  let top, bottom;
  if (c.kind === 'line') {
    const hs = xs.map((x, i) => h(x, zs[i]));
    const it = hs.indexOf(Math.max(...hs)), ib = hs.indexOf(Math.min(...hs));
    top = [xs[it], zs[it]]; bottom = [xs[ib], zs[ib]];
  } else {
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
    const [ux, uz] = fallDir(cx, cz, 40);
    const us = xs.map((x, i) => (x - cx) * ux + (zs[i] - cz) * uz);
    const u0 = Math.min(...us), u1 = Math.max(...us);
    top = [cx + ux * u0, cz + uz * u0]; bottom = [cx + ux * u1, cz + uz * u1];
  }
  let len = Math.hypot(bottom[0] - top[0], bottom[1] - top[1]);
  if (len < 30) continue;
  const ux = (bottom[0] - top[0]) / len, uz = (bottom[1] - top[1]) / len;
  len = Math.max(MIN_LEN, Math.min(MAX_LEN, len));
  const ev = evaluate(top[0], top[1], ux, uz, len);
  const named = /snow ?park|park/i.test(c.name) ? -2 : 0;
  if (ev) results.push({ ...ev, score: ev.score + named, name: c.name, src: `osm:${c.osm}`, top, ux, uz, len });
  console.log(`  candidate ${c.osm} ${c.name.padEnd(28)} ${ev ? `score ${(ev.score + named).toFixed(2)}  ${ev.meanDeg.toFixed(1)} deg (max ${ev.maxDeg.toFixed(1)})  rough ${ev.rough.toFixed(2)}  blocked ${(ev.share * 100).toFixed(0)} %  lift ${Math.round(ev.lift.d)} m` : 'unusable'}`);
}

if (!results.length) {
  console.log('  no usable mapped park: placing one by a lift');
  for (const l of resort.lifts) {
    if (!['chair', 'drag', 'gondola'].includes(l.kind)) continue;
    const p = l.pts, n = p.length / 2;
    const ha = h(p[0], p[1]), hb = h(p[2 * n - 2], p[2 * n - 1]);
    const [ax, az, bx, bz] = ha < hb ? [p[0], p[1], p[2 * n - 2], p[2 * n - 1]] : [p[2 * n - 2], p[2 * n - 1], p[0], p[1]];    // bottom -> top
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 300) continue;
    const vx = (bx - ax) / L, vz = (bz - az) / L;
    for (const f of [0.5, 0.65, 0.8, 0.95]) for (const side of [-140, -80, 80, 140]) {
      const x = ax + vx * L * f - vz * side, z = az + vz * L * f + vx * side;
      const [ux, uz] = fallDir(x, z, 40);
      for (const len of [MAX_LEN, 340, MIN_LEN + 40]) {
        const ev = evaluate(x, z, ux, uz, len);
        if (ev) results.push({ ...ev, name: 'Snowpark', src: 'placed', top: [x, z], ux, uz, len });
      }
    }
  }
}
results.sort((a, b) => a.score - b.score);
const best = results[0];
if (!best) { console.error(`${rid}: no park site found`); process.exit(1); }
// "TSD6 Grattalu" -> "Grattalu": the lift type codes in front of OSM lift names (FR TSD / TSF / TK / TC / TPH, DE / AT / CH codes)
const liftName = (best.lift.name || '').replace(/^((TSD|TSF|TS|TK|TC|TPH|DMC|SL|EUB|KSB|SB|GB|PB)\d*|\d+(SB|KSB|EUB|CLD)|Telesiège|Téléski|Skilift|Sessellift)\s+/i, '').trim();
const name = /^snow ?park$/i.test(best.name) || !best.name ? `Snowpark ${liftName || resort.short || ''}`.trim() : best.name;
const park = {
  name, src: best.src, hw: HW, step: STEP,
  line: [best.top[0], best.top[1], best.top[0] + best.ux * best.len, best.top[1] + best.uz * best.len].map((v) => Math.round(v * 10) / 10),
  len: Math.round(best.len), profile: best.profile, lift: best.lift.name,
};
console.log(`${rid}: ${park.name} (${park.src}) ${park.len} m, ${best.meanDeg.toFixed(1)} deg, lift ${best.lift.name} ${Math.round(best.lift.d)} m away`);
if (!dry) {
  // keep the file's own text (bake.py's number format): "park" is always the last key, cut an old one off and append the new one
  let text = fs.readFileSync(resortPath, 'utf8').trimEnd();
  const at = text.lastIndexOf(',"park":');
  text = at > 0 ? text.slice(0, at) : text.slice(0, -1);
  text += `,"park":${JSON.stringify(park)}}`;
  JSON.parse(text);
  fs.writeFileSync(resortPath, text);
  console.log('  wrote', path.relative(repo, resortPath));
}
