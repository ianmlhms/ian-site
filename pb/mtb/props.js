/* Things built on and beside the trails (all vertex-colour, merged into a handful of meshes, painted with the shared lighting):
 *   static for every trail   signposts (generic, no logos: a post, a rounded board in the grade colour and a symbol), wooden bridges (planks, beams, rails, buried abutments),
 *                            roots across the path, boardwalk planks, mud / rock-slab patches (ribbons on the surface with a polygon offset)
 *   for the active trail     the start gate, the finish arch with its chequered banner, the checkpoint flags (the next one is bright, passed ones are dim)
 *   free ride                the viewpoint markers (a small fox, "Roudi", on a flag pole; found ones disappear)
 * Heights come from the physics surface (so nothing floats or sinks), decks from decks.js. */
import { Builder, V3, M, tube } from './geo-builder.js';
import { createSolidMaterial } from './solid-material.js';
import { rootCentres } from './trail-features.js';
import { DECK, deckAt } from './decks.js';

const THREE = window.THREE;
const GRADE = { green: [0.25, 0.75, 0.35], blue: [0.24, 0.55, 1.0], red: [0.9, 0.28, 0.25], black: [0.12, 0.12, 0.14] };
const WOOD = [0.5, 0.36, 0.22], WOOD_DARK = [0.34, 0.24, 0.15], WOOD_LIGHT = [0.62, 0.47, 0.3], PAINT_WHITE = [0.94, 0.92, 0.84], STONE = [0.5, 0.48, 0.44];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const RIBBON_LIFT = 0.03, RIBBON_STEP = 0.8;
const TAPE_RED = [0.78, 0.1, 0.08], TAPE_WHITE = [0.92, 0.9, 0.84], TAPE_H = 0.72, TAPE_SEGMENTS = 8, TAPE_SAG = 0.07;

/** The barrier across a wrong branch: two posts and a sagging red-white striped tape between them (never on the trail: `a`/`b` already stand a little way
 *  into the wrong branch, see junctions.js). */
function barrierTape(b, a, bb, groundY) {
  const ya = groundY(a.x, a.z), yb = groundY(bb.x, bb.z);
  beam(b, V3(a.x, ya - 0.15, a.z), V3(a.x, ya + 1.0, a.z), 0.07, 0.07, WOOD_DARK);
  beam(b, V3(bb.x, yb - 0.15, bb.z), V3(bb.x, yb + 1.0, bb.z), 0.07, 0.07, WOOD_DARK);
  const pts = [];
  for (let k = 0; k <= TAPE_SEGMENTS; k++) {
    const t = k / TAPE_SEGMENTS, sag = Math.sin(Math.PI * t) * TAPE_SAG;
    pts.push(V3(a.x + (bb.x - a.x) * t, (ya + TAPE_H) * (1 - t) + (yb + TAPE_H) * t - sag, a.z + (bb.z - a.z) * t));
  }
  for (let k = 0; k < TAPE_SEGMENTS; k++) beam(b, pts[k], pts[k + 1], 0.15, 0.025, k % 2 === 0 ? TAPE_RED : TAPE_WHITE, V3(0, 1, 0));
}

/** An oriented box from point a to point b (centre line of its top face), `w` wide, `h` thick below the line. Flat-shaded. */
function beam(b, a, c, w, h, color, up = V3(0, 1, 0)) {
  const along = V3(c.x - a.x, c.y - a.y, c.z - a.z), len = along.length();
  if (len < 1e-5) return;
  along.divideScalar(len);
  let side = up.clone().cross(along);
  if (side.lengthSq() < 1e-8) side = V3(1, 0, 0).cross(along);
  side.normalize();
  const u = along.clone().cross(side).normalize();
  const hw = w / 2;
  const corner = (p, sx, sy) => V3(p.x + side.x * hw * sx + u.x * (sy > 0 ? 0 : -h), p.y + side.y * hw * sx + u.y * (sy > 0 ? 0 : -h), p.z + side.z * hw * sx + u.z * (sy > 0 ? 0 : -h));
  const P = [corner(a, -1, 1), corner(a, 1, 1), corner(a, 1, -1), corner(a, -1, -1), corner(c, -1, 1), corner(c, 1, 1), corner(c, 1, -1), corner(c, -1, -1)];
  const faces = [[0, 1, 5, 4, u], [3, 7, 6, 2, u.clone().negate()], [1, 2, 6, 5, side], [0, 4, 7, 3, side.clone().negate()], [0, 3, 2, 1, along.clone().negate()], [4, 5, 6, 7, along]];
  for (const [i0, i1, i2, i3, n] of faces) {
    const shade = n === u ? 1.0 : 0.82;
    b.addArrays([P[i0].x, P[i0].y, P[i0].z, P[i1].x, P[i1].y, P[i1].z, P[i2].x, P[i2].y, P[i2].z, P[i3].x, P[i3].y, P[i3].z], [n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], [0, 1, 2, 0, 2, 3], () => mul(color, shade));
  }
}
const box = (b, cx, cy, cz, sx, sy, sz, yaw, color) => b.add(new THREE.BoxGeometry(1, 1, 1), M(cx, cy, cz, sx, sy, sz, -yaw), () => color);

function strip(b, left, right, color) {              // a ribbon from two polylines of equal length (V3), flat shaded up
  const pos = [], nor = [], idx = [];
  for (let i = 0; i < left.length; i++) { pos.push(left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z); nor.push(0, 1, 0, 0, 1, 0); }
  for (let i = 0; i < left.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  b.addArrays(pos, nor, idx, (v, n, k) => mul(color, 0.93 + 0.07 * ((k >> 1) % 2)));
}

export function createProps({ scene, env, surface, trails, decks, junctions = [] }) {
  const mat = createSolidMaterial(env);
  const decalMat = createSolidMaterial(env);
  decalMat.polygonOffset = true; decalMat.polygonOffsetFactor = -3; decalMat.polygonOffsetUnits = -3;
  const meshes = [];
  const addMesh = (builder, material = mat, name = '') => { const m = new THREE.Mesh(builder.build(), material); m.frustumCulled = false; m.name = name; scene.add(m); meshes.push(m); return m; };
  const groundY = (x, z) => surface.height(x, z);
  const deckScratch = { deck: null, along: 0, top: 0, slope: 0 };
  /** Ground for the gate and arch: the terrain, or the top of a stone bridge deck (a finish ON the Schiessentuempel footbridge stands on the deck, narrower than the deck). */
  const gateY = (x, z) => { const g = surface.height(x, z); const hit = deckAt(decks, x, z, 1e9, deckScratch); return hit && hit.deck.kind === 'stone' && hit.top > g ? hit.top : g; };

  // ------------------------------------------------------------ signposts
  function sign(b, p, grade) {
    const y0 = groundY(p.x, p.z) - 0.25;
    const yaw = p.yaw;                                                  // the board faces against the riding direction (the rider sees its face)
    const gc = GRADE[grade] || GRADE.green;
    box(b, p.x, y0 + 0.9, p.z, 0.11, 1.9, 0.11, yaw, WOOD_DARK);
    const bx = Math.cos(yaw), bz = Math.sin(yaw);
    if (p.k === 'dir') {                                                 // arrow board pointing along the trail
      box(b, p.x - bx * 0.07, y0 + 1.5, p.z - bz * 0.07, 0.04, 0.26, 0.62, yaw, PAINT_WHITE);
      box(b, p.x - bx * 0.1, y0 + 1.5, p.z - bz * 0.1, 0.03, 0.17, 0.5, yaw, gc);
      box(b, p.x - bx * 0.08 - bz * 0.36, y0 + 1.5, p.z - bz * 0.08 + bx * 0.36, 0.04, 0.2, 0.2, yaw + Math.PI / 4, PAINT_WHITE);          // the arrow's tip: a diamond at the board's end
    } else if (p.k === 'start' || p.k === 'finish') {
      box(b, p.x - bx * 0.07, y0 + 1.5, p.z - bz * 0.07, 0.05, 0.5, 0.7, yaw, PAINT_WHITE);
      box(b, p.x - bx * 0.11, y0 + 1.5, p.z - bz * 0.11, 0.03, 0.36, 0.56, yaw, p.k === 'start' ? gc : [0.1, 0.1, 0.1]);
    } else {                                                             // checkpoint: round plate with n dots
      box(b, p.x - bx * 0.07, y0 + 1.5, p.z - bz * 0.07, 0.05, 0.42, 0.42, yaw, PAINT_WHITE);
      for (let k = 0; k < Math.min(5, p.n); k++) box(b, p.x - bx * 0.11, y0 + 1.42 + 0.08 * k, p.z - bz * 0.11, 0.03, 0.05, 0.05, yaw, gc);
    }
    box(b, p.x, y0 + 1.95, p.z, 0.2, 0.06, 0.2, yaw, WOOD_LIGHT);        // a little roof cap
  }
  const posts = new Builder();
  for (const t of trails) for (const p of t.posts) sign(posts, p, t.grade);
  addMesh(posts, mat, 'signposts');

  // ------------------------------------------------------------ junctions: an arrow sign before every fork, red-white barrier tape across every wrong branch
  const gradeOf = new Map(trails.map((t) => [t.id, t.grade]));
  const barriers = new Builder();
  let junctionBranches = 0;
  for (const j of junctions) {
    const grade = gradeOf.get(j.trailId) || 'green';
    const { yaw } = j.approach;
    const rx = -Math.sin(yaw), rz = Math.cos(yaw);                         // the arrow board stands to the right of the trail, like every other signpost
    sign(posts, { k: 'dir', x: j.approach.x + rx * 2.1, z: j.approach.z + rz * 2.1, yaw, n: 0 }, grade);
    for (const br of j.branches) { barrierTape(barriers, br.postA, br.postB, groundY); junctionBranches++; }
  }
  addMesh(barriers, mat, 'junction barriers');

  // ------------------------------------------------------------ bridges
  const bridges = new Builder();
  for (const d of decks) {
    if (d.kind === 'stone') continue;                                    // the arch footbridge is drawn by bridge-model.js
    const ax = d.ux, az = d.uz, rx = -az, rz = ax;                       // along and right (x east, z south)
    const hw = d.w / 2;
    const at = (u, side, lift = 0) => { const t = u / d.len; return V3(d.x0 + ax * u + rx * side, d.topA + (d.topB - d.topA) * t + lift, d.z0 + az * u + rz * side); };
    const planks = Math.round(d.len / 0.22);
    for (let k = 0; k < planks; k++) {
      const u0 = (k / planks) * d.len + 0.01, u1 = ((k + 1) / planks) * d.len - 0.01;
      beam(bridges, at(u0, 0), at(u1, 0), d.w, 0.06, mul(WOOD, 0.88 + 0.16 * ((k * 7) % 5) / 5), V3(0, 1, 0));
    }
    for (const s of [-hw + 0.12, 0, hw - 0.12]) beam(bridges, at(0, s, -0.06), at(d.len, s, -0.06), 0.16, 0.22, WOOD_DARK);   // the beams under the planks
    for (const s of [-1, 1]) {                                          // rails and posts
      const side = s * (hw - 0.05);
      beam(bridges, at(0, side, 0.95), at(d.len, side, 0.95), 0.07, 0.07, WOOD_LIGHT);
      beam(bridges, at(0, side, 0.5), at(d.len, side, 0.5), 0.05, 0.05, WOOD);
      const nPost = Math.max(2, Math.round(d.len / 1.6) + 1);
      for (let k = 0; k < nPost; k++) { const u = (k / (nPost - 1)) * d.len; beam(bridges, at(u, side, 1.0), at(u, side, -0.2), 0.1, 0.1, WOOD_DARK); }
    }
    for (const u of [0.15, d.len - 0.15]) {                              // the abutments are buried: no gap, nothing floats
      const c = at(u, 0);
      const y = groundY(c.x, c.z);
      box(bridges, c.x, (c.y - 0.1 + y - DECK.sink) / 2, c.z, 0.55, c.y - 0.1 - (y - DECK.sink), d.w + 0.5, Math.atan2(az, ax), STONE);
    }
  }
  addMesh(bridges, mat, 'bridges');

  // ------------------------------------------------------------ roots, boardwalks, mud, slabs
  const roots = new Builder(), walks = new Builder(), decals = new Builder();
  for (const t of trails) {
    for (const f of t.features) {
      const i0 = f.i0, i1 = f.i1;
      const frame = (i) => { const a = t.centre[Math.max(0, i - 1)], c = t.centre[Math.min(t.count - 1, i + 1)]; const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1; return { x: t.centre[i][0], z: t.centre[i][1], tx: dx / l, tz: dz / l, rx: -dz / l, rz: dx / l }; };
      if (f.k === 'roots') {
        for (const r of rootCentres(f)) {
          const i = Math.min(t.count - 1, Math.max(0, Math.round(i0 + r.u)));
          const fr = frame(i);
          const turn = (r.turn - 0.5) * 0.9;
          const pts = [], radii = [];
          const half = 1.45;
          for (let k = 0; k <= 7; k++) {
            const s = -half + (2 * half * k) / 7;
            const x = fr.x + fr.rx * s + fr.tx * s * turn, z = fr.z + fr.rz * s + fr.tz * s * turn;
            const arch = Math.sin(Math.PI * k / 7) ** 0.6;
            pts.push(V3(x, groundY(x, z) + 0.012 + 0.07 * r.size * arch, z)); radii.push(0.035 * r.size * (0.5 + arch));
          }
          const tb = tube(pts, radii, 5, true);
          roots.addArrays(tb.pos, tb.nor, tb.idx, (v, n) => mul([0.36, 0.26, 0.17], 0.85 + 0.3 * (n.y * 0.5 + 0.5)));
        }
      } else if (f.k === 'boardwalk') {
        for (let i = i0; i < i1 - 1; i += 1) {
          if (i % 1 !== 0) continue;
          const a = frame(i), c = frame(i + 1);
          const ya = groundY(a.x, a.z) + 0.06, yc = groundY(c.x, c.z) + 0.06;
          beam(walks, V3(a.x, ya, a.z), V3(c.x, yc, c.z), 2.0, 0.07, mul(WOOD, 0.85 + 0.2 * ((i * 13) % 7) / 7), V3(0, 1, 0));
        }
        for (const s of [-1, 1]) for (let i = i0; i < i1 - 2; i += 4) { const a = frame(i), c = frame(Math.min(i1, i + 4)); const sa = s * 1.05; beam(walks, V3(a.x + a.rx * sa, groundY(a.x + a.rx * sa, a.z + a.rz * sa) + 0.02, a.z + a.rz * sa), V3(c.x + c.rx * sa, groundY(c.x + c.rx * sa, c.z + c.rz * sa) + 0.02, c.z + c.rz * sa), 0.1, 0.1, WOOD_DARK); }
      } else if (f.k === 'mud' || f.k === 'slab') {
        const left = [], right = [];
        const col = f.k === 'mud' ? [0.27, 0.19, 0.12] : [0.62, 0.56, 0.47];
        const width = f.k === 'mud' ? 1.05 : 1.15;
        for (let i = i0; i <= i1; i += Math.max(1, Math.round(RIBBON_STEP))) {
          const fr = frame(i);
          const wob = 0.85 + 0.3 * Math.sin(i * 0.9 + f.x);
          const lx = fr.x - fr.rx * width * wob, lz = fr.z - fr.rz * width * wob, rx2 = fr.x + fr.rx * width * (2 - wob), rz2 = fr.z + fr.rz * width * (2 - wob);
          left.push(V3(lx, groundY(lx, lz) + RIBBON_LIFT, lz)); right.push(V3(rx2, groundY(rx2, rz2) + RIBBON_LIFT, rz2));
        }
        if (left.length > 1) strip(decals, left, right, col);
      }
    }
  }
  addMesh(roots, mat, 'roots'); addMesh(walks, mat, 'boardwalks'); addMesh(decals, decalMat, 'trail patches');

  // ------------------------------------------------------------ the active trail: gate, arch, flags
  let gateMesh = null, flagMesh = null;
  const dispose = (m) => { if (!m) return; scene.remove(m); m.geometry.dispose(); const i = meshes.indexOf(m); if (i >= 0) meshes.splice(i, 1); };
  function frameAt(t, i) { const a = t.centre[Math.max(0, i - 1)], c = t.centre[Math.min(t.count - 1, i + 1)]; const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1; return { x: t.centre[i][0], z: t.centre[i][1], yaw: Math.atan2(dz, dx), rx: -dz / l, rz: dx / l, tx: dx / l, tz: dz / l }; }
  function gate(b, t, i, finish) {
    const f = frameAt(t, i);
    const onDeck = deckAt(decks, f.x, f.z, 1e9, deckScratch);
    const onStone = onDeck && onDeck.deck.kind === 'stone';
    const half = onStone ? Math.max(0.6, onDeck.deck.w / 2 - 0.3) : finish ? 2.6 : 2.1, h = finish ? 3.7 : 3.3;
    const gc = GRADE[t.grade];
    for (const s of [-1, 1]) {
      const x = f.x + f.rx * half * s, z = f.z + f.rz * half * s, y = gateY(x, z);
      beam(b, V3(x, y - 0.4, z), V3(x, y + h, z), 0.28, 0.28, WOOD_DARK);
      box(b, x, y + h + 0.05, z, 0.5, 0.1, 0.5, f.yaw, WOOD_LIGHT);
    }
    const ya = gateY(f.x + f.rx * half, f.z + f.rz * half) + h - 0.15, yb = gateY(f.x - f.rx * half, f.z - f.rz * half) + h - 0.15;
    const left = V3(f.x - f.rx * half, yb, f.z - f.rz * half), right = V3(f.x + f.rx * half, ya, f.z + f.rz * half);
    beam(b, left, right, 0.16, 0.16, WOOD);
    const cols = finish ? 14 : 8;                                         // the banner: chequered for the finish, stripes in the grade colour for the start
    for (let k = 0; k < cols; k++) {
      const p0 = left.clone().lerp(right, k / cols), p1 = left.clone().lerp(right, (k + 1) / cols);
      for (let row = 0; row < (finish ? 2 : 1); row++) {
        const dark = finish ? (k + row) % 2 === 0 : k % 2 === 0;
        const c = finish ? (dark ? [0.08, 0.08, 0.08] : [0.96, 0.96, 0.94]) : (dark ? gc : mul(gc, 0.6));
        const off = -(row * 0.34) - 0.08;
        const back = f.yaw;
        beam(b, V3(p0.x, p0.y + off, p0.z), V3(p1.x, p1.y + off, p1.z), 0.03, 0.34, c, V3(Math.cos(back), 0, Math.sin(back)));
      }
    }
  }
  function setActiveTrail(t) {
    dispose(gateMesh); gateMesh = null;
    if (!t) return;
    const b = new Builder();
    gate(b, t, t.gate.index, false);
    gate(b, t, t.arch.index, true);
    gateMesh = addMesh(b, mat, 'gate and arch');
  }
  function setFlags(t, nextIndex) {
    dispose(flagMesh); flagMesh = null;
    if (!t || !t.cps.length) return;
    const b = new Builder();
    t.cps.forEach((cp, k) => {
      const f = frameAt(t, cp.index);
      const x = f.x - f.rx * 2.2, z = f.z - f.rz * 2.2, y = groundY(x, z);
      const state = k < nextIndex ? 0 : k === nextIndex ? 2 : 1;
      const col = state === 0 ? [0.5, 0.5, 0.5] : state === 2 ? [1.0, 0.82, 0.2] : [0.3, 0.8, 0.45];
      const h = state === 2 ? 3.2 : 2.4;
      beam(b, V3(x, y - 0.3, z), V3(x, y + h, z), 0.07, 0.07, WOOD_LIGHT);
      beam(b, V3(x, y + h - 0.12, z), V3(x + f.tx * 0.9 + f.rx * 0.3, y + h - 0.32, z + f.tz * 0.9 + f.rz * 0.3), 0.03, 0.6, col, V3(f.rx, 0, f.rz));
    });
    flagMesh = addMesh(b, mat, 'checkpoint flags');
  }

  // ------------------------------------------------------------ viewpoint markers (Roudi the fox on a flag pole)
  let vpMesh = null;
  function setViewpoints(list, found) {
    dispose(vpMesh); vpMesh = null;
    const b = new Builder();
    const fox = [0.95, 0.5, 0.15], white = [0.98, 0.96, 0.92];
    list.forEach((v, i) => {
      if (found && found.has(i)) return;
      const y = groundY(v.x, v.z);
      beam(b, V3(v.x, y - 0.2, v.z), V3(v.x, y + 2.6, v.z), 0.06, 0.06, WOOD_LIGHT);
      beam(b, V3(v.x, y + 2.55, v.z), V3(v.x + 0.9, y + 2.4, v.z + 0.2), 0.03, 0.5, [1.0, 0.62, 0.15], V3(0, 0, 1));
      b.add(new THREE.SphereGeometry(0.2, 8, 6), M(v.x + 0.5, y + 0.22, v.z, 1.2, 1, 0.9), () => fox);
      b.add(new THREE.SphereGeometry(0.13, 8, 6), M(v.x + 0.68, y + 0.45, v.z), () => fox);
      b.add(new THREE.ConeGeometry(0.05, 0.12, 4), M(v.x + 0.68, y + 0.6, v.z + 0.06), () => fox);
      b.add(new THREE.ConeGeometry(0.05, 0.12, 4), M(v.x + 0.68, y + 0.6, v.z - 0.06), () => fox);
      b.add(new THREE.SphereGeometry(0.09, 6, 5), M(v.x + 0.27, y + 0.2, v.z, 1.6, 0.8, 0.8), () => white);
      b.add(new THREE.TorusGeometry(0.9, 0.04, 6, 20), M(v.x, y + 1.6, v.z, 1, 1, 1, 0, Math.PI / 2, 0), () => [1.0, 0.9, 0.35]);
    });
    if (b.vertexCount === 0) return;
    vpMesh = addMesh(b, mat, 'viewpoints');
  }

  return { setActiveTrail, setFlags, setViewpoints, meshes, material: mat, junctionBranches, dispose() { for (const m of [...meshes]) dispose(m); mat.dispose(); decalMat.dispose(); } };
}
