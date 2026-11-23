/* Piste furniture: edge poles in the piste colour along every piste of the network (both sides, every 26 m, rebuilt around the camera),
 * orange safety nets on the edges where the slope falls away steeply beside the piste, signposts with the piste's name in its colour at
 * the top of every piste, and the run objects: start gate, finish arch, slalom gates (flag pairs, red and blue alternating).
 * Plain Lambert materials (scene lights, shadows + fog). */
import { DIFF } from './config.js';

const THREE = window.THREE;
const POLE_GAP = 26;
const NET_GAP = 6, NET_H = 1.6, NET_CAP = 1500, NET_RADIUS = 320;

/** The orange safety net: a painted mesh with diamond holes (alpha), a thicker top rope. */
function netTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = '#f2641c'; g.lineWidth = 5;
  for (let i = -128; i < 256; i += 21) {
    g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke();
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
  }
  g.fillStyle = '#d9480f'; g.fillRect(0, 0, 128, 10);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(NET_GAP / NET_H, 1);
  return t;
}
const REBUILD = 45;
const NET_STRIDE = 6;                 // a net candidate: ax, az, bx, bz, ox, oz (o = the outward unit vector)
/** A growing Float32Array (pairs pushed, done() = an exact copy): the pole / net tables without plain JS number arrays. */
class GrowF32 {
  constructor() { this.a = new Float32Array(4096); this.n = 0; }
  push(x, z) {
    if (this.n + 2 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = z;
  }
  done() { return this.a.slice(0, this.n); }
}
const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };

function bannerTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg; g.font = '800 64px system-ui, -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 512, 6); g.fillRect(0, 90, 512, 6);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 2;
  return t;
}

export function createPoles({ scene, resort, height }) {
  const geo = new THREE.CylinderGeometry(0.045, 0.05, 1.9, 5).translate(0, 0.95, 0);
  const capGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 5).translate(0, 1.75, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const capMat = new THREE.MeshLambertMaterial({ color: 0xf08a1c });
  const CAP = 1800;
  const poles = new THREE.InstancedMesh(geo, mat, CAP);
  const caps = new THREE.InstancedMesh(capGeo, capMat, CAP);
  poles.count = 0; caps.count = 0;
  poles.frustumCulled = false; caps.frustumCulled = false;
  poles.castShadow = true;
  scene.add(poles, caps);
  // safety nets: one instanced panel per edge segment (x 0..1 along the segment, y 0..1.6), a painted orange mesh with holes
  const netGeo = new THREE.PlaneGeometry(1, NET_H).translate(0.5, NET_H / 2 - 0.25, 0);
  const netMat = new THREE.MeshLambertMaterial({ map: netTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  const nets = new THREE.InstancedMesh(netGeo, netMat, NET_CAP);
  nets.count = 0; nets.frustumCulled = false; nets.castShadow = true;
  const netPostGeo = new THREE.CylinderGeometry(0.04, 0.05, NET_H + 0.3, 5).translate(0, (NET_H + 0.3) / 2 - 0.3, 0);
  const netPosts = new THREE.InstancedMesh(netPostGeo, new THREE.MeshLambertMaterial({ color: 0x2d3138 }), NET_CAP);
  netPosts.count = 0; netPosts.frustumCulled = false;
  scene.add(nets, netPosts);
  // every pole position once (both edges of every line). Cleanup round (memory): typed arrays (the plain arrays of numbers and colour
  // names took ~18 MB of JS heap at 3 Vallees): x, z per pole + its colour's index, grown in one pass
  const DIFFS = Object.keys(DIFF);
  const poleXZ = new GrowF32(), poleDiff = [];
  for (const line of resort.network) {
    if (line.a) continue;
    const p = line.p, hw = line.w + 1.2, di = Math.max(0, DIFFS.indexOf(DIFF_OF_LETTER[line.d] || 'blue'));
    let carry = POLE_GAP * 0.5;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const ux = dx / L, uz = dz / L;
      for (let t = carry; t < L; t += POLE_GAP) {
        const x = ax + ux * t, z = az + uz * t;
        poleXZ.push(x - uz * hw, z + ux * hw); poleXZ.push(x + uz * hw, z - ux * hw);
        poleDiff.push(di, di);
      }
      carry = (carry - L) % POLE_GAP; if (carry < 0) carry += POLE_GAP;
    }
  }
  const poleAt = poleXZ.done(), poleCol = Uint8Array.from(poleDiff), poleCount = poleCol.length;
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const colours = DIFFS.map((k) => new THREE.Color(DIFF[k].hex));
  let last = { x: 1e9, z: 1e9 };
  // net candidates: consecutive pole positions on one edge, [ax, az, bx, bz, ox, oz] (o = outward unit vector); whether a segment gets a
  // net is decided from the heights when it first comes near (the height tiles may still be streaming at load)
  // (cleanup round: one Float32Array, NET_STRIDE numbers a segment, + its verdict in a byte: 255 = not judged yet)
  const segBuf = new GrowF32();
  for (const line of resort.network) {
    if (line.a) continue;
    const p = line.p, hw = line.w + 0.6;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L = Math.hypot(dx, dz);
      if (L < 4) continue;
      const ux = dx / L, uz = dz / L;
      const parts = Math.max(1, Math.round(L / NET_GAP));
      for (let i = 0; i < parts; i++) {
        const t0 = i / parts * L, t1 = (i + 1) / parts * L;
        for (const side of [-1, 1]) {
          const ox = -uz * side, oz = ux * side;
          segBuf.push(ax + ux * t0 + ox * hw, az + uz * t0 + oz * hw); segBuf.push(ax + ux * t1 + ox * hw, az + uz * t1 + oz * hw); segBuf.push(ox, oz);
        }
      }
    }
  }
  const segs = segBuf.done(), segCount = segs.length / NET_STRIDE, segNet = new Uint8Array(segCount).fill(255);
  /** A net where, 10 m beyond the edge, the ground has dropped by more than ~0.9 m per 1 m (a steep fall-away: you would not stop). */
  function needsNet(i) {
    if (segNet[i] !== 255) return segNet[i] === 1;
    const o = i * NET_STRIDE, ax = segs[o], az = segs[o + 1], bx = segs[o + 2], bz = segs[o + 3];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const h0 = height(mx, mz), h1 = height(mx + segs[o + 4] * 10, mz + segs[o + 5] * 10);
    const along = Math.abs(height(bx, bz) - height(ax, az)) / Math.max(1, Math.hypot(bx - ax, bz - az));
    segNet[i] = h0 - h1 > 8.5 || (h0 - h1 > 5.5 && along > 0.35) ? 1 : 0;
    return segNet[i] === 1;
  }
  const q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), shear = new THREE.Matrix4();
  function update(px, pz, radius) {
    if (Math.hypot(px - last.x, pz - last.z) < REBUILD) return;
    last = { x: px, z: pz };
    const r2 = radius * radius;
    let nn = 0, np = 0;
    const netR2 = Math.min(r2, NET_RADIUS * NET_RADIUS);
    for (let i = 0; i < segCount; i++) {
      if (nn >= NET_CAP) break;
      const o = i * NET_STRIDE, ax = segs[o], az = segs[o + 1], bx = segs[o + 2], bz = segs[o + 3];
      const dx = ax - px, dz = az - pz;
      if (dx * dx + dz * dz > netR2 || !needsNet(i)) continue;
      const ya = height(ax, az), yb = height(bx, bz);
      const L = Math.hypot(bx - ax, bz - az);
      // a panel from a to b: rotate x onto the segment (yaw) and shear it down the slope by lifting the far end with the matrix
      q4.setFromAxisAngle(yAxis, -Math.atan2(bz - az, bx - ax));
      m.compose(v3.set(ax, ya, az), q4, s3.set(L, 1, 1));
      m.multiply(shear.set(1, 0, 0, 0, (yb - ya), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
      nets.setMatrixAt(nn++, m);
      if (np < NET_CAP) { m.makeTranslation(ax, ya, az); netPosts.setMatrixAt(np++, m); }
    }
    nets.count = nn; netPosts.count = np;
    nets.instanceMatrix.needsUpdate = true; netPosts.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (let i = 0; i < poleCount && n < CAP; i++) {
      const x = poleAt[i * 2], z = poleAt[i * 2 + 1];
      const dx = x - px, dz = z - pz;
      if (dx * dx + dz * dz > r2) continue;
      m.makeTranslation(x, height(x, z) - 0.15, z);
      poles.setMatrixAt(n, m); caps.setMatrixAt(n, m);
      col.copy(colours[poleCol[i]]); poles.setColorAt(n, col);
      n++;
    }
    poles.count = n; caps.count = n;
    poles.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true;
    if (poles.instanceColor) poles.instanceColor.needsUpdate = true;
  }
  return { update, total: poleCount, mesh: poles, reset() { last = { x: 1e9, z: 1e9 }; } };
}

/** Signposts at the top of every piste (where it leaves the lift or the piste above: the junctions): a larch post with a board in the
 *  piste's colour, its name in white, readable from both sides, facing the skiers coming down. All boards share one painted atlas. */
/* R7-D: the sign atlas scales. One 2048 x 384 atlas of 64 board slots (8 x 8, 256 x 48 px each; cleanup round: was 128 slots, 6 MB of
 * canvas + texture: the most boards within SIGN.radius of ANY point of the five resorts is 41, Arlberg) is filled ON DEMAND with the boards
 * within SIGN.radius of the camera (a board is 1.9 m wide: unreadable much farther), nearest first; a board keeps its slot while it stays
 * in range, a freed slot is painted anew. Any number of pistes (Arlberg 356, 3 Vallées 480, ...) costs the same texture and still ONE
 * draw call for the boards (+ one for the posts); the merged board mesh is rebuilt only after the camera moved SIGN.move metres. */
export const SIGN = Object.freeze({ BW: 256, BH: 48, cols: 8, rows: 8, radius: 1100, move: 120 });       // 64 slots: the busiest spot of all five resorts sees 41

/** Pure (Node test): keep the slots of boards still wanted, free the others, give free slots to new boards (nearest first, they come
 * first in `wanted`). prev: Map id -> slot. Returns { slots: Map id -> slot, paint: [id, slot] newly placed }. */
export function assignSlots(prev, wanted, capacity) {
  const keep = new Set(wanted.slice(0, capacity));
  const slots = new Map();
  const used = new Set();
  for (const [id, slot] of prev) if (keep.has(id)) { slots.set(id, slot); used.add(slot); }
  const free = [];
  for (let i = capacity - 1; i >= 0; i--) if (!used.has(i)) free.push(i);
  const paint = [];
  for (const id of wanted.slice(0, capacity)) if (!slots.has(id)) { const slot = free.pop(); slots.set(id, slot); paint.push([id, slot]); }
  return { slots, paint };
}

export function createSigns({ scene, resort, height }) {
  const list = resort.pistes;
  const { BW, BH, cols, rows } = SIGN, capacity = cols * rows;
  const c = document.createElement('canvas');
  c.width = BW * cols; c.height = BH * rows;
  const g = c.getContext('2d');
  function paint(p, slot) {
    const x = (slot % cols) * BW, y = Math.floor(slot / cols) * BH;
    g.clearRect(x, y, BW, BH);
    g.fillStyle = (DIFF[p.diff] || DIFF.blue).css; g.fillRect(x, y, BW, BH);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x + 3, y + 3, BW - 6, 3); g.fillRect(x + 3, y + BH - 6, BW - 6, 3);
    g.fillStyle = '#ffffff'; g.font = '700 26px system-ui, -apple-system, sans-serif'; g.textBaseline = 'middle';
    const name = p.name.length > 15 ? p.name.slice(0, 14) + '…' : p.name;
    g.fillText(name, x + 44, y + BH / 2 + 1, BW - 56);
    g.beginPath(); g.moveTo(x + 32, y + 12); g.lineTo(x + 12, y + BH / 2); g.lineTo(x + 32, y + BH - 12); g.closePath(); g.fill();   // arrow: towards the piste
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  // every board's two quads (12 vertices) once; the merged mesh copies the boards in range with their slot's uv
  const boardsOf = [];
  const post = [];
  list.forEach((p, i) => {
    const l = p.line;
    if (l.length < 4) return;
    const dx = l[2] - l[0], dz = l[3] - l[1], L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    const side = (p.hw || 15) + 3;
    const x = l[0] + -uz * side + ux * 6, z = l[1] + ux * side + uz * 6;
    const y = height(x, z);
    post.push(x, y, z);
    // the board: across the piste (its face looks up the piste), 2.1 .. 2.5 m above the snow
    const w = 1.9, y0 = y + 2.0, y1 = y + 2.42;
    const ax = x - uz * 0.1, az = z + ux * 0.1;
    const ex = ax + uz * w, ez = az - ux * w;           // the board reaches in towards the piste
    const A = [ex, y0, ez], B = [ax, y0, az], C = [ax, y1, az], D = [ex, y1, ez];
    const pos = [], nrm = [], corner = [];
    const quad = (a, b, cc, d, n) => { for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...[a, b, cc, d][k]); nrm.push(...n); corner.push(k); } };
    quad(A, B, C, D, [-ux, 0, -uz]);                    // seen from uphill
    quad(B, A, D, C, [ux, 0, uz]);                      // seen from below
    boardsOf.push({ id: i, p, x, z, pos, nrm, corner });
  });
  const max = Math.min(capacity, boardsOf.length);
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(max * 12 * 3), N = new Float32Array(max * 12 * 3), U = new Float32Array(max * 12 * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  geo.setDrawRange(0, 0);
  const boards = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  boards.name = 'ski-signs';
  boards.castShadow = true;
  const postGeo = new THREE.BoxGeometry(0.14, 2.7, 0.14).translate(0, 1.2, 0);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a30 }), Math.max(1, post.length / 3));
  posts.name = 'ski-sign-posts';
  const m = new THREE.Matrix4();
  for (let i = 0; i < post.length / 3; i++) { m.makeTranslation(post[i * 3], post[i * 3 + 1] - 0.2, post[i * 3 + 2]); posts.setMatrixAt(i, m); }
  posts.castShadow = true;
  scene.add(boards, posts);

  let slots = new Map(), lastX = Infinity, lastZ = Infinity;
  const stats = { shown: 0, painted: 0, rebuilds: 0 };
  /** the boards within SIGN.radius of (cx, cz): slots, paint, one merged mesh (only after the camera moved SIGN.move m) */
  function update(cx, cz, force = false) {
    if (!force && Math.hypot(cx - lastX, cz - lastZ) < SIGN.move) return;
    lastX = cx; lastZ = cz;
    const near = boardsOf.map((b) => ({ b, d: Math.hypot(b.x - cx, b.z - cz) })).filter((o) => o.d < SIGN.radius).sort((a, b) => a.d - b.d).slice(0, max);
    const byId = new Map(near.map((o) => [o.b.id, o.b]));
    const r = assignSlots(slots, near.map((o) => o.b.id), capacity);
    slots = r.slots;
    for (const [id, slot] of r.paint) paint(byId.get(id).p, slot);
    if (r.paint.length) { tex.needsUpdate = true; stats.painted += r.paint.length; }
    let n = 0;
    for (const o of near) {
      const b = o.b, slot = slots.get(b.id);
      const u0 = (slot % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - Math.floor(slot / cols) / rows, v0 = v1 - 1 / rows;
      const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      P.set(b.pos, n * 36); N.set(b.nrm, n * 36);
      for (let k = 0; k < 12; k++) { const q = uvs[b.corner[k]]; U[n * 24 + k * 2] = q[0]; U[n * 24 + k * 2 + 1] = q[1]; }
      n++;
    }
    geo.setDrawRange(0, n * 12);
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.attributes.uv.needsUpdate = true;
    geo.computeBoundingSphere();
    boards.visible = n > 0;
    stats.shown = n; stats.rebuilds++;
  }
  return { boards, posts, count: post.length / 3, update, stats, slotsOf: () => slots, atlas: { width: c.width, height: c.height } };
}

/** The objects of one run: start gate at the top, finish arch at the bottom, slalom gates. dispose() removes them. */
export function createRunProps({ scene, piste, height, gates, start = null, finish = true }) {     // R7-C2: start = the course's gate point, finish false = the course draws its own ZIL arch
  const group = new THREE.Group();
  group.name = 'ski-run';
  const post = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const top = piste.at(0, {}), end = piste.at(piste.length, {});
  const arch = (p, text, bg, fg, width) => {
    const g = new THREE.Group();
    const y = height(p.x, p.z);
    const h = 4.2;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, h, 0.35), post);
      m.position.set(side * width / 2, h / 2 - 0.3, 0);
      g.add(m);
    }
    const tex = bannerTexture(text, bg, fg);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(width, 1.0, 0.12), [post, post, post, post, new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex })]);
    banner.position.set(0, h - 0.6, 0);
    g.add(banner);
    g.position.set(p.x, y, p.z);
    g.rotation.y = -Math.atan2(p.dz, p.dx) + Math.PI / 2;           // the banner faces along the piste
    group.add(g);
    return g;
  };
  arch(start || top, 'START', '#1f7a4d', '#ffffff', 9);
  if (finish) arch(piste.at(Math.max(0, piste.length - 2), {}), 'ZIL', '#d0352c', '#ffffff', Math.min(30, piste.halfWidth * 2 + 4));
  // slalom gates: an inner pole with a flag and an outer pole 4 m further out
  const flagGeo = new THREE.PlaneGeometry(0.75, 0.55).translate(0.4, 1.35, 0);
  const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.8, 5).translate(0, 0.9, 0);
  const red = new THREE.MeshLambertMaterial({ color: 0xd8392f, side: THREE.DoubleSide }), blue = new THREE.MeshLambertMaterial({ color: 0x2f6fd8, side: THREE.DoubleSide });
  const gateMeshes = [];
  gates.forEach((g, i) => {
    const mat = i % 2 ? blue : red;
    const one = new THREE.Group();
    for (const extra of [0, 4]) {
      const off = g.off + Math.sign(g.off) * extra;
      const x = g.x - g.dz * (off - g.off), z = g.z + g.dx * (off - g.off);
      const pole = new THREE.Mesh(poleGeo, mat);
      pole.position.set(x, height(x, z) - 0.1, z);
      const flag = new THREE.Mesh(flagGeo, mat);
      flag.position.copy(pole.position);
      flag.rotation.y = -Math.atan2(g.dz, g.dx);
      one.add(pole, flag);
    }
    group.add(one);
    gateMeshes.push(one);
  });
  scene.add(group);
  return {
    group,
    markGate(i, ok) { const one = gateMeshes[i]; if (!one) return; one.children.forEach((c) => { c.material = ok ? c.material : new THREE.MeshLambertMaterial({ color: 0x777777, side: THREE.DoubleSide }); }); },
    dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}
