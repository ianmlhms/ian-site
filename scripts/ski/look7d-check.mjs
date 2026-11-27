#!/usr/bin/env node
/* R7-D look checks, the Node part (no browser), over every resort:
 *   node scripts/ski/look7d-check.mjs [rid ...]
 *   trees   one geometry per kind, triangles within twice the round 5 trees (spruce 154, larch 190, far 10 / 18)
 *   park    the snow meshes (modes/views.js parkSnowGeometry) == the physics (surface.height -> park.solidAt): every mesh vertex, points
 *           sampled inside the triangles, a scripted rider over every kicker, ramp and through the pipe (grounded: skier y == the mesh
 *           within 5 cm; in the air never inside it); the terrain lattice never shows through a mesh (the pipe's trough on LOD 0 / 5 / 10)
 * The browser part (draw calls, gate colours, shader errors, Chromium + WebKit) is the flow scripts/flows/ski_look7d.mjs. Exit 1 on a fail. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackResort } from '../../pb/ski/linepack.js';      // R7-D: packed piste lines

globalThis.window = { THREE: { InstancedBufferGeometry: class { setAttribute(k, v) { this[k] = v; } }, Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.count = a.length / n; } } } };
const here = path.dirname(fileURLToPath(import.meta.url));
const SKI_DIR = path.join(here, '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(SKI_DIR, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createParkLayout, stepPark } = await imp('modes/park.js');
const { parkRider } = await imp('modes/park-check.js');
const { createSkierState } = await imp('skier.js');
const { SKI } = await imp('config.js');
const { parkSnowGeometry } = await imp('modes/views.js');
const { TREE_GEOMETRY } = await imp('scatter-view.js');

const RIDS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ALL = RIDS.length ? RIDS : ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax', 'soelden'];
const OLD_TRIS = { spruceNear: 154, larchNear: 190, spruceFar: 10, larchFar: 18 };
const TOL = 0.05;                     // m: drawn vs skied
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };

console.log('trees');
for (const [k, f] of Object.entries(TREE_GEOMETRY)) {
  const g = f(), tris = g.position.count / 3;
  const finite = Array.from(g.position.array).every(Number.isFinite) && Array.from(g.normal.array).every(Number.isFinite);
  check(finite && tris <= OLD_TRIS[k] * 2, `${k}: ${tris} triangles (round 5: ${OLD_TRIS[k]}, budget ${OLD_TRIS[k] * 2}), finite`);
}

/** 2D triangle lookup of a mesh: highest surface y at (x, z) over the triangles whose 3 vertices are not sunk (NaN = no mesh there). */
function meshLookup(g, sinkY) {
  const tris = [];
  const P = g.pos;
  for (let i = 0; i < g.idx.length; i += 3) {
    const v = [g.idx[i], g.idx[i + 1], g.idx[i + 2]].map((j) => [P[j * 3], P[j * 3 + 1], P[j * 3 + 2], sinkY[j]]);
    tris.push({ v, sunk: v.some((p) => p[3]) });
  }
  const cell = 2, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  tris.forEach((t, n) => {
    const xs = t.v.map((p) => p[0]), zs = t.v.map((p) => p[2]);
    for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++) for (let j = Math.floor(Math.min(...zs) / cell); j <= Math.floor(Math.max(...zs) / cell); j++) {
      const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n);
    }
  });
  return function at(x, z, { all = false } = {}) {
    const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) || [];
    let best = NaN;
    for (const n of list) {
      const t = tris[n];
      if (t.sunk && !all) continue;
      const [a, b, c] = t.v;
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const w1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, w2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const y = w1 * a[1] + w2 * b[1] + w3 * c[1];
      if (!(y <= best)) best = y;
    }
    return best;
  };
}

for (const rid of ALL) {
  console.log(`park ${rid}`);
  const dir = path.join(SKI_DIR, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));      // R7-D: packed piste lines
  const layout = createParkLayout(resort.park);
  if (!check(!!layout, `${rid}: a park in resort.json (${resort.park ? resort.park.name : 'none'})`)) continue;
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: layout });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);                                   // the physics (analytic on the park meshes)
  const lattice = createSurface({ ...field, park: null });                // the terrain the LOD 0 tiles draw (no override)
  const g = parkSnowGeometry(layout);
  const n = g.pos.length / 3;
  // which vertices are sunk (the rim): their y is the profile - SINK; the others the analytic shape + LIFT
  const sunk = new Array(n);
  let worstV = 0, outside = 0;
  for (let i = 0; i < n; i++) {
    const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
    const h = surface.height(x, z);
    sunk[i] = g.rim[i] === 1;
    const lq = layout.local(x, z, {});
    if (!sunk[i] && Math.abs(y - h) > worstV) { worstV = Math.abs(y - h); if (process.env.DEBUG) console.log('   worst vertex', lq.s.toFixed(2), lq.v.toFixed(2), y.toFixed(3), h.toFixed(3)); }
    if (!(layout.solidAt(x, z) === layout.solidAt(x, z))) { outside++; if (process.env.DEBUG && outside < 5) console.log('   outside', lq.s.toFixed(2), lq.v.toFixed(2)); }
  }
  const tris = g.idx.length / 3;
  check(tris > 800 && worstV < 0.025 && outside === 0, `${layout.name}: ${layout.kickers.length} kickers, ${layout.ramps.length} ramps, pipe ${layout.pipe ? 'yes' : 'no'}; snow mesh ${n} vertices, ${tris} triangles; worst vertex vs physics ${(worstV * 100).toFixed(1)} cm; ${outside} outside the physics boxes`);
  const meshAt = meshLookup(g, sunk);
  // points sampled over every feature box (inside the triangles: the mesh is flat between its vertices, the physics curved)
  let worstP = 0, worstT = -1, worstFlat = -1, samples = 0, worstAt = '';
  const rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  for (const [s0, s1, v0, v1] of layout.boxes) {
    for (let i = 0; i < 1500; i++) {
      const s = s0 + (s1 - s0) * rnd(), v = v0 + (v1 - v0) * rnd();
      const p = layout.world(s, v);
      // what the eye sees there: the mesh or, along its hidden rim, the terrain over it
      const all = meshAt(p.x, p.z, { all: true });
      if (all !== all) continue;
      samples++;
      const seen = Math.max(all, lattice.height(p.x, p.z));
      const d = Math.abs(seen - surface.height(p.x, p.z));
      if (d > worstP) { worstP = d; worstAt = `s ${s.toFixed(1)} v ${v.toFixed(1)}`; }
      const m = meshAt(p.x, p.z);
      if (m !== m) continue;
      const above = lattice.height(p.x, p.z) - m;
      if (Math.abs(layout.featureHeight(s, v)) < 0.05) {          // flat snow: the pipe deck must stay on top; a wall's toe meets the snow
        if (layout.pipe && Math.abs(v) >= layout.deck && s > layout.pipeSpan[0] && s < layout.pipeSpan[1]) worstFlat = Math.max(worstFlat, above);
        continue;
      }
      if (above > worstT) { worstT = above; if (process.env.DEBUG) console.log('   terrain above', s.toFixed(2), v.toFixed(2), worstT.toFixed(3)); }
    }
  }
  check(samples > 3000 && worstP <= TOL, `${samples} points on the meshes (walls and rims included): seen vs skied worst ${(worstP * 100).toFixed(1)} cm (${worstAt})`);
  check(worstT < 0.005 && worstFlat < 0.005, `LOD 0 terrain under the meshes: at most ${(worstT * 100).toFixed(1)} cm above the kickers / ramps / pipe walls (never shows through), ${worstFlat === -1 ? "no pipe deck" : (worstFlat * 100).toFixed(1) + " cm on the pipe deck"}`);
  // the pipe's trough on the coarse levels (their nodes; their chords are shorter than the trough is wide)
  if (layout.pipe) {
    let worstL = -1;
    for (const lod of [5, 10]) {
      const [s0, s1, v0, v1] = layout.boxes[layout.boxes.length - 1];
      for (let s = s0; s <= s1; s += 1.3) for (let v = v0; v <= v1; v += 0.9) {
        const p = layout.world(s, v), m = meshAt(p.x, p.z);
        if (m === m && field.heightForStep(p.x, p.z, lod) - m > worstL) { worstL = field.heightForStep(p.x, p.z, lod) - m; if (process.env.DEBUG) console.log('   lod', lod, s.toFixed(1), v.toFixed(1), worstL.toFixed(3)); }
      }
    }
    check(worstL < 0.03, `pipe trough on LOD 5 / 10 nodes: at most ${(worstL * 100).toFixed(1)} cm above the pipe mesh`);
  }
  // a scripted rider: every kicker straight, every ramp, carving the pipe; grounded skier y vs the mesh, airborne never inside it
  const world = { height: (x, z) => surface.height(x, z), normal: (x, z, out) => surface.normal(x, z, out), snow: () => 1, hit: () => null, tricks: true };
  const plans = [
    ...layout.kickers.map((k) => [`kicker ${k.size} at ${k.s0} m`, [{ v: k.v, until: k.end + 3, speed: k.size === 'L' ? 12.5 : 11 }, { v: k.v, until: k.end + 8 }]]),
    ...layout.rails.map((r) => [`${r.kind} at ${Math.round(r.s0)} m`, [{ v: r.v, until: r.s1 + 3, speed: 8 }]]),
  ];
  if (layout.pipe) {
    const P = layout.pipe, plan = [{ v: 0, until: P.s0, speed: 10 }];
    for (let s = P.s0, side = 1; s < P.s1; s += 20, side = -side) plan.push({ v: side * (layout.deck + 1), until: s + 20, speed: 14 });
    plans.push(['halfpipe', plan]);
  }
  for (const [name, plan] of plans) {
    const top = layout.world(Math.max(-4, (plan[0].until || 0) - 70), plan[0].v);
    let st = createSkierState(top.x, top.z, layout.heading, world.height(top.x, top.z));
    const drive = parkRider(layout, plan);
    let worstG = 0, worstA = 0, groundedOn = 0, t = 0, crashes = 0;
    const q = {};
    while (t < 60) {
      const prev = st;
      st = stepPark(layout, prev, drive(st), world, SKI.dt);
      t += SKI.dt;
      if (prev.crash === 0 && st.crash > 0) crashes++;
      layout.local(st.x, st.z, q);
      if (q.s > plan[plan.length - 1].until || q.s > layout.len - 2) break;
      if (st.rail >= 0 || st.crash > 0) continue;
      const m = meshAt(st.x, st.z);
      if (m !== m) continue;
      if (st.grounded) { groundedOn++; worstG = Math.max(worstG, Math.abs(st.y - m)); } else worstA = Math.max(worstA, m - st.y);
    }
    check(groundedOn > 20 && worstG <= TOL && worstA <= TOL, `${name}: ${groundedOn} grounded steps on the mesh, skier vs mesh worst ${(worstG * 100).toFixed(1)} cm, deepest in the air ${(Math.max(0, worstA) * 100).toFixed(1)} cm, ${crashes} falls`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
