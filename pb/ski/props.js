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
  // every pole position once (both edges of every line)
  const all = [];
  for (const line of resort.network) {
    if (line.a) continue;
    const p = line.p, hw = line.w + 1.2, diff = DIFF_OF_LETTER[line.d] || 'blue';
    let carry = POLE_GAP * 0.5;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const ux = dx / L, uz = dz / L;
      for (let t = carry; t < L; t += POLE_GAP) {
        const x = ax + ux * t, z = az + uz * t;
        all.push(x - uz * hw, z + ux * hw, diff, x + uz * hw, z - ux * hw, diff);
      }
      carry = (carry - L) % POLE_GAP; if (carry < 0) carry += POLE_GAP;
    }
  }
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const colours = Object.fromEntries(Object.entries(DIFF).map(([k, v]) => [k, new THREE.Color(v.hex)]));
  let last = { x: 1e9, z: 1e9 };
  // net candidates: consecutive pole positions on one edge, [ax, az, bx, bz, ox, oz] (o = outward unit vector); whether a segment gets a
  // net is decided from the heights when it first comes near (the height tiles may still be streaming at load)
  const netSegs = [];
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
          netSegs.push([ax + ux * t0 + ox * hw, az + uz * t0 + oz * hw, ax + ux * t1 + ox * hw, az + uz * t1 + oz * hw, ox, oz, -1]);
        }
      }
    }
  }
  /** A net where, 10 m beyond the edge, the ground has dropped by more than ~0.9 m per 1 m (a steep fall-away: you would not stop). */
  function needsNet(sg) {
    if (sg[6] >= 0) return sg[6] === 1;
    const mx = (sg[0] + sg[2]) / 2, mz = (sg[1] + sg[3]) / 2;
    const h0 = height(mx, mz), h1 = height(mx + sg[4] * 10, mz + sg[5] * 10);
    const along = Math.abs(height(sg[2], sg[3]) - height(sg[0], sg[1])) / Math.max(1, Math.hypot(sg[2] - sg[0], sg[3] - sg[1]));
    sg[6] = h0 - h1 > 8.5 || (h0 - h1 > 5.5 && along > 0.35) ? 1 : 0;
    return sg[6] === 1;
  }
  const q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  function update(px, pz, radius) {
    if (Math.hypot(px - last.x, pz - last.z) < REBUILD) return;
    last = { x: px, z: pz };
    const r2 = radius * radius;
    let nn = 0, np = 0;
    const netR2 = Math.min(r2, NET_RADIUS * NET_RADIUS);
    for (const sg of netSegs) {
      if (nn >= NET_CAP) break;
      const dx = sg[0] - px, dz = sg[1] - pz;
      if (dx * dx + dz * dz > netR2 || !needsNet(sg)) continue;
      const ya = height(sg[0], sg[1]), yb = height(sg[2], sg[3]);
      const L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
      // a panel from a to b: rotate x onto the segment (yaw) and shear it down the slope by lifting the far end with the matrix
      q4.setFromAxisAngle(yAxis, -Math.atan2(sg[3] - sg[1], sg[2] - sg[0]));
      m.compose(v3.set(sg[0], ya, sg[1]), q4, s3.set(L, 1, 1));
      const shear = new THREE.Matrix4().set(1, 0, 0, 0, (yb - ya), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      m.multiply(shear);
      nets.setMatrixAt(nn++, m);
      if (np < NET_CAP) { m.makeTranslation(sg[0], ya, sg[1]); netPosts.setMatrixAt(np++, m); }
    }
    nets.count = nn; netPosts.count = np;
    nets.instanceMatrix.needsUpdate = true; netPosts.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (let i = 0; i < all.length && n < CAP; i += 3) {
      const x = all[i], z = all[i + 1];
      const dx = x - px, dz = z - pz;
      if (dx * dx + dz * dz > r2) continue;
      m.makeTranslation(x, height(x, z) - 0.15, z);
      poles.setMatrixAt(n, m); caps.setMatrixAt(n, m);
      col.copy(colours[all[i + 2]]); poles.setColorAt(n, col);
      n++;
    }
    poles.count = n; caps.count = n;
    poles.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true;
    if (poles.instanceColor) poles.instanceColor.needsUpdate = true;
  }
  return { update, total: all.length / 3, mesh: poles, reset() { last = { x: 1e9, z: 1e9 }; } };
}

/** Signposts at the top of every piste (where it leaves the lift or the piste above: the junctions): a larch post with a board in the
 *  piste's colour, its name in white, readable from both sides, facing the skiers coming down. All boards share one painted atlas. */
/* Round 7: the boards are drawn into several atlases of at most ATLAS_ROWS x 8 boards (2048 x 2016 px), one mesh each, so any resort
 * size works (one 4096 px atlas ran out at ~680 pistes; 3 Vallées has 480, Arlberg 356: two atlases = two draw calls). */
const SIGN_W = 256, SIGN_H = 48, SIGN_COLS = 8, ATLAS_ROWS = 42;
export const SIGNS_PER_ATLAS = SIGN_COLS * ATLAS_ROWS;
function signAtlas(list) {
  const rows = Math.max(1, Math.ceil(list.length / SIGN_COLS));
  const c = document.createElement('canvas');
  c.width = SIGN_W * SIGN_COLS; c.height = SIGN_H * rows;
  const g = c.getContext('2d');
  list.forEach((p, i) => {
    const x = (i % SIGN_COLS) * SIGN_W, y = Math.floor(i / SIGN_COLS) * SIGN_H;
    g.fillStyle = (DIFF[p.diff] || DIFF.blue).css; g.fillRect(x, y, SIGN_W, SIGN_H);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x + 3, y + 3, SIGN_W - 6, 3); g.fillRect(x + 3, y + SIGN_H - 6, SIGN_W - 6, 3);
    g.fillStyle = '#ffffff'; g.font = '700 26px system-ui, -apple-system, sans-serif'; g.textBaseline = 'middle';
    const name = p.name.length > 15 ? p.name.slice(0, 14) + '…' : p.name;
    g.fillText(name, x + 44, y + SIGN_H / 2 + 1, SIGN_W - 56);
    g.beginPath(); g.moveTo(x + 32, y + 12); g.lineTo(x + 12, y + SIGN_H / 2); g.lineTo(x + 32, y + SIGN_H - 12); g.closePath(); g.fill();   // arrow: towards the piste
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, rows };
}
export function createSigns({ scene, resort, height }) {
  const all = resort.pistes;
  const post = [];
  const boards = [];
  for (let first = 0; first < Math.max(1, all.length); first += SIGNS_PER_ATLAS) {
    const list = all.slice(first, first + SIGNS_PER_ATLAS);
    const { tex, rows } = signAtlas(list);
    const pos = [], nrm = [], uv = [];
    const quad = (a, b, cc, d, n, uvs) => { for (const k of [0, 1, 2, 0, 2, 3]) { const q = [a, b, cc, d][k]; pos.push(...q); nrm.push(...n); uv.push(...uvs[k]); } };
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
      const u0 = (i % SIGN_COLS) / SIGN_COLS, u1 = u0 + 1 / SIGN_COLS, v1 = 1 - Math.floor(i / SIGN_COLS) / rows, v0 = v1 - 1 / rows;
      quad([ex, y0, ez], [ax, y0, az], [ax, y1, az], [ex, y1, ez], [-ux, 0, -uz], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);   // seen from uphill
      quad([ax, y0, az], [ex, y0, ez], [ex, y1, ez], [ax, y1, az], [ux, 0, uz], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);     // seen from below
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.name = 'ski-signs';
    mesh.castShadow = true;
    boards.push(mesh);
  }
  const postGeo = new THREE.BoxGeometry(0.14, 2.7, 0.14).translate(0, 1.2, 0);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a30 }), Math.max(1, post.length / 3));
  const m = new THREE.Matrix4();
  for (let i = 0; i < post.length / 3; i++) { m.makeTranslation(post[i * 3], post[i * 3 + 1] - 0.2, post[i * 3 + 2]); posts.setMatrixAt(i, m); }
  posts.castShadow = true;
  scene.add(...boards, posts);
  return { boards, posts, count: post.length / 3, atlases: boards.length };
}

/** The objects of one run: start gate at the top, finish arch at the bottom, slalom gates. dispose() removes them.
 *  Round 7: few draw calls whatever the slalom (a slalom with 30 gates was ~110 calls): the posts and banner frames of both arches are
 *  one merged mesh, each banner face one textured quad pair, every slalom pole one instanced mesh and every flag another (the colour per
 *  instance: red / blue, grey once missed). */
export function createRunProps({ scene, piste, height, gates }) {
  const group = new THREE.Group();
  group.name = 'ski-run';
  const disposables = [];
  const top = piste.at(0, {}), end = piste.at(piste.length, {});
  const frame = [];                                   // [geometry, matrix] of the dark posts / banner boxes (merged)
  const arch = (p, text, bg, fg, width) => {
    const y = height(p.x, p.z);
    const h = 4.2;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(p.dz, p.dx) + Math.PI / 2), new THREE.Vector3(1, 1, 1));
    for (const side of [-1, 1]) frame.push(new THREE.BoxGeometry(0.35, h, 0.35).translate(side * width / 2, h / 2 - 0.3, 0).applyMatrix4(m));
    frame.push(new THREE.BoxGeometry(width, 1.0, 0.1).translate(0, h - 0.6, 0).applyMatrix4(m));
    // the banner: the same text on both faces (a plane each, a hair in front of the box)
    const tex = bannerTexture(text, bg, fg);
    const bm = new THREE.MeshLambertMaterial({ map: tex });
    const g = new THREE.BufferGeometry();
    const front = new THREE.PlaneGeometry(width, 1.0).translate(0, h - 0.6, 0.07).applyMatrix4(m);
    const back = new THREE.PlaneGeometry(width, 1.0).rotateY(Math.PI).translate(0, h - 0.6, -0.07).applyMatrix4(m);
    const P = [], N = [], U = [];
    for (const q of [front, back]) { const n = q.toNonIndexed(); P.push(...n.attributes.position.array); N.push(...n.attributes.normal.array); U.push(...n.attributes.uv.array); n.dispose(); q.dispose(); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const banner = new THREE.Mesh(g, bm);
    group.add(banner);
    disposables.push(g, bm, tex);
  };
  arch(top, 'START', '#1f7a4d', '#ffffff', 9);
  const finishPoint = piste.at(Math.max(0, piste.length - 2), {});
  arch(finishPoint, 'ZIL', '#d0352c', '#ffffff', Math.min(30, piste.halfWidth * 2 + 4));
  void end;
  {
    const P = [], N = [];
    for (const f of frame) { const n = f.toNonIndexed(); P.push(...n.attributes.position.array); N.push(...n.attributes.normal.array); n.dispose(); f.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
    group.add(new THREE.Mesh(g, mat));
    disposables.push(g, mat);
  }
  // slalom gates: an inner pole with a flag and an outer pole 4 m further out (instanced: 2 draw calls for all of them)
  const RED = new THREE.Color(0xd8392f), BLUE = new THREE.Color(0x2f6fd8), GREY = new THREE.Color(0x777777);
  let poles = null, flags = null;
  if (gates.length) {
    const flagGeo = new THREE.PlaneGeometry(0.75, 0.55).translate(0.4, 1.35, 0);
    const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.8, 5).translate(0, 0.9, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    poles = new THREE.InstancedMesh(poleGeo, mat, gates.length * 2);
    flags = new THREE.InstancedMesh(flagGeo, mat, gates.length * 2);
    const d = new THREE.Object3D();
    gates.forEach((g, i) => {
      [0, 4].forEach((extra, k) => {
        const off = g.off + Math.sign(g.off) * extra;
        const x = g.x - g.dz * (off - g.off), z = g.z + g.dx * (off - g.off);
        d.position.set(x, height(x, z) - 0.1, z); d.rotation.set(0, 0, 0); d.updateMatrix(); poles.setMatrixAt(i * 2 + k, d.matrix);
        d.rotation.set(0, -Math.atan2(g.dz, g.dx), 0); d.updateMatrix(); flags.setMatrixAt(i * 2 + k, d.matrix);
        poles.setColorAt(i * 2 + k, i % 2 ? BLUE : RED); flags.setColorAt(i * 2 + k, i % 2 ? BLUE : RED);
      });
    });
    poles.instanceMatrix.needsUpdate = true; flags.instanceMatrix.needsUpdate = true;
    poles.computeBoundingSphere(); flags.computeBoundingSphere();
    group.add(poles, flags);
    disposables.push(flagGeo, poleGeo, mat);
  }
  scene.add(group);
  return {
    group,
    get drawCalls() { return group.children.length; },
    markGate(i, ok) {
      if (!poles || ok || i < 0 || i >= gates.length) return;
      for (const k of [0, 1]) { poles.setColorAt(i * 2 + k, GREY); flags.setColorAt(i * 2 + k, GREY); }
      poles.instanceColor.needsUpdate = true; flags.instanceColor.needsUpdate = true;
    },
    dispose() { scene.remove(group); for (const x of disposables) x.dispose(); if (poles) poles.dispose(); if (flags) flags.dispose(); },
  };
}
