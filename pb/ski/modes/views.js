/* The 3D parts of the game modes (round 4A), all cheap: every set is ONE merged, vertex-coloured mesh (one draw call; the park casts a
 * shadow on Mëttel / Héich like the other props).
 *   flags     the challenge flags along a piste (pole + pennant), a taken flag drops out
 *   park      rails and boxes (with their coping and legs), blue paint on the kicker lips and the halfpipe coping, orange fences
 *             along the corridor, a sign board at the drop-in */
const THREE = window.THREE;

/** Merge [geometry, colour hex, matrix] parts into one non-indexed geometry with a colour attribute. */
export function mergeParts(parts) {
  let count = 0;
  const flat = parts.map(([geo, color, matrix]) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    count += g.attributes.position.count;
    return [g, new THREE.Color(color)];
  });
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const [g, c] of flat) {
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++, o++) {
      pos[o * 3] = P.getX(i); pos[o * 3 + 1] = P.getY(i); pos[o * 3 + 2] = P.getZ(i);
      nrm[o * 3] = N.getX(i); nrm[o * 3 + 1] = N.getY(i); nrm[o * 3 + 2] = N.getZ(i);
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const m4 = () => new THREE.Matrix4();
/** A matrix: translate to (x, y, z), turn by yaw (rad, around y: +x forward = heading), then pitch / roll in the part's own frame. */
function place(x, y, z, yaw = 0, pitch = 0, roll = 0) {
  const m = m4().makeTranslation(x, y, z);
  m.multiply(m4().makeRotationY(-yaw));
  if (roll) m.multiply(m4().makeRotationX(roll));
  if (pitch) m.multiply(m4().makeRotationZ(pitch));
  return m;
}

/* ---------------- challenge flags ---------------- */
const FLAG = Object.freeze({ pole: 0x2b2f36, cloth: 0xf2a21c, taken: 0x9aa3ad });

/** flags = [{ x, z }] (challenges.js flagsFor); height(x, z) = the snow. One InstancedMesh of a merged pole + pennant. */
export function createFlagsView({ scene, flags, height, heading = 0 }) {
  const geo = mergeParts([
    [new THREE.CylinderGeometry(0.035, 0.035, 2.2, 5), FLAG.pole, m4().makeTranslation(0, 1.1, 0)],
    [new THREE.BoxGeometry(0.85, 0.55, 0.03), FLAG.cloth, m4().makeTranslation(0.45, 1.85, 0)],
    [new THREE.BoxGeometry(0.5, 0.3, 0.032), 0xffffff, m4().makeTranslation(0.3, 1.86, 0)],
  ]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, flags.length));
  mesh.name = 'ski-challenge-flags';
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  flags.forEach((f, i) => {
    dummy.position.set(f.x, height(f.x, f.z) - 0.1, f.z);
    dummy.rotation.set(0, -heading + Math.PI / 2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.count = flags.length;
  mesh.castShadow = true;
  scene.add(mesh);
  return {
    mesh,
    take(i) {
      const f = flags[i]; if (!f) return;
      dummy.position.set(f.x, -1e4, f.z); dummy.scale.set(0.001, 0.001, 0.001); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.instanceMatrix.needsUpdate = true;
    },
    /** Heights changed (a tile streamed in): put the flags back on the snow. */
    reseat(taken = []) {
      flags.forEach((f, i) => {
        if (taken[i]) return;
        dummy.position.set(f.x, height(f.x, f.z) - 0.1, f.z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, -heading + Math.PI / 2, 0); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}

/* ---------------- the snow park ---------------- */
const PARK_COL = Object.freeze({ rail: 0xc9ced6, railDark: 0x3a3f48, box: 0x2f6fd8, boxTop: 0xe9edf2, leg: 0x2b2f36, paint: 0x2a66d0, fence: 0xff7a14, sign: 0x16171a, signFace: 0xf2b21c, cut: 0xc9d6ea, coping: 0xff7a14, steel: 0x8e96a3 });
/* round 5: every kicker wears its size's colour (the piste colours the players know): lip board, landing line, cheek edges, flags, sign */
const SIZE_COL = Object.freeze({ S: 0x2fa84f, M: 0x2a66d0, L: 0xd0352c });

/** The park's painted boards: the gate banner (top half) and the S / M / L / PIPE tiles (bottom half), one canvas, our own lettering. */
function parkAtlas(name) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#16171a'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#f2b21c'; g.fillRect(0, 0, 1024, 18); g.fillRect(0, 238, 1024, 18);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 104px "Helvetica Neue", Arial, sans-serif';
  g.fillText('SNOWPARK', 512, 104);
  g.fillStyle = '#f2b21c'; g.font = '700 54px "Helvetica Neue", Arial, sans-serif';
  g.fillText(String(name || '').replace(/^Snowpark\s+/i, '').toUpperCase().slice(0, 26), 512, 190);
  [['S', '#2fa84f'], ['M', '#2a66d0'], ['L', '#d0352c'], ['PIPE', '#16171a']].forEach(([t, col], i) => {
    const x = i * 256;
    g.fillStyle = '#f4f6f9'; g.fillRect(x, 256, 256, 256);
    g.fillStyle = col; g.fillRect(x + 14, 270, 228, 228);
    g.fillStyle = '#ffffff'; g.font = `900 ${t.length > 1 ? 84 : 170}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(t, x + 128, 392);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
/** Quads [width, height, matrix, u0, v0, u1, v1] (facing -x of their own frame: towards a skier coming down) as one textured geometry. */
function boardGeometry(quads) {
  const pos = [], nrm = [], uv = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const [w, h, matrix, u0, v0, u1, v1] of quads) {
    const corners = [[0, -h / 2, -w / 2, u0, v0], [0, -h / 2, w / 2, u1, v0], [0, h / 2, w / 2, u1, v1], [0, -h / 2, -w / 2, u0, v0], [0, h / 2, w / 2, u1, v1], [0, h / 2, -w / 2, u0, v1]];
    n.set(-1, 0, 0).transformDirection(matrix);
    for (const [x, y, z, uu, vv] of corners) { v.set(x, y, z).applyMatrix4(matrix); pos.push(v.x, v.y, v.z); nrm.push(n.x, n.y, n.z); uv.push(uu, vv); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** layout = park.js createParkLayout; height(x, z) = the snow (surface.height). Returns { mesh, rebuild(), dispose() }. */
/* Round 7: the snow bodies of the park features as REAL geometry: the kickers (run-up, sharp lip, table, landing, cut side walls) and
 * the halfpipe walls on a fine grid of the exact park function (layout.profileAt + featureHeight), drawn with the painted snow material
 * (groomed, corduroy along the line). The terrain is cut away under them (snow-shader.js uParkRect: the 2.5 m lattice rounded the lips
 * off and showed the pipe walls as saw teeth). Physics untouched (it already uses the exact lip slope). One draw call. */
const BODY = Object.freeze({ kickStep: 0.6, pipeAlong: 1.0, pipeAcross: 0.5, margin: 1.6, lift: 0.02, maxRects: 8 });
export function parkBodyRects(layout) {
  const rects = [];
  for (const k of layout.kickers) rects.push([k.s0 - 0.4, k.end + 0.4, k.v - k.w / 2 - BODY.margin, k.v + k.w / 2 + BODY.margin]);
  if (layout.pipe) rects.push([layout.pipe.s0 - layout.pipe.inRamp, layout.pipe.s1 + layout.pipe.outRamp, -layout.deck - 0.8, layout.deck + 0.8]);
  return rects.slice(0, BODY.maxRects);
}
export function parkBodyGeometry(layout) {
  const pos = [], idx = [], info = [], extra = [];
  const q = {};
  for (const [s0, s1, v0, v1] of parkBodyRects(layout)) {
    const pipe = layout.pipe && Math.abs(s0 - (layout.pipe.s0 - layout.pipe.inRamp)) < 1e-6;
    const ds = pipe ? BODY.pipeAlong : BODY.kickStep, dv = pipe ? BODY.pipeAcross : BODY.kickStep;
    const ns = Math.max(2, Math.ceil((s1 - s0) / ds) + 1), nv = Math.max(2, Math.ceil((v1 - v0) / dv) + 1);
    const base = pos.length / 3;
    for (let i = 0; i < ns; i++) {
      const s = s0 + (s1 - s0) * i / (ns - 1);
      for (let j = 0; j < nv; j++) {
        const v = v0 + (v1 - v0) * j / (nv - 1);
        layout.world(s, v, q);
        pos.push(q.x, layout.profileAt(s) + layout.featureHeight(s, v) + BODY.lift, q.z);
        info.push(1, 0, 0, 0); extra.push(layout.ux, layout.uz, 0, 0);
      }
    }
    for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < nv; j++) {
      const a = base + i * nv + j, b = a + 1, c = a + nv, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aExtra', new THREE.Float32BufferAttribute(extra, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the grid winds the other way round in this frame: make the normals point up
  const n = g.attributes.normal;
  let up = 0;
  for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) { for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; } }
  g.computeBoundingSphere();
  return g;
}
/** The park bodies mesh; env.u.uParkO / uParkRect / uParkN cut the terrain under them while they are shown. */
export function createParkBodies({ scene, layout, material, env }) {
  const geo = parkBodyGeometry(layout);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ski-park-bodies';
  mesh.receiveShadow = true; mesh.castShadow = true;
  scene.add(mesh);
  const rects = parkBodyRects(layout);
  env.u.uParkO.value.set(layout.x0, layout.z0, layout.ux, layout.uz);
  rects.forEach((r, i) => env.u.uParkRect.value[i].set(r[0], r[1], r[2], r[3]));
  const setOn = (on) => { mesh.visible = on; env.u.uParkN.value = on ? rects.length : 0; };
  setOn(true);
  return {
    mesh, rects,
    setMaterial(m) { mesh.material = m; },
    update(cx, cz, radius) { setOn(Math.hypot(cx - layout.x0, cz - layout.z0) < radius + layout.len); },
    dispose() { scene.remove(mesh); geo.dispose(); env.u.uParkN.value = 0; },
  };
}

export function createParkView({ scene, layout, height }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2622 });      // a little self-light: the nets and rails read in the shade
  let mesh = null, boards = null;
  const boardMat = new THREE.MeshLambertMaterial({ map: parkAtlas(layout.name), side: THREE.DoubleSide, emissive: 0x3a3a3a });
  const yaw = layout.heading;
  function build() {
    const parts = [];
    const at = (s, v) => layout.world(s, v);
    // rails and boxes: the top follows the slope (railTop), two or three legs
    for (const r of layout.rails) {
      const len = r.s1 - r.s0;
      const a = at(r.s0, r.v), b = at(r.s1, r.v);
      const ya = layout.railTop(r, r.s0), yb = layout.railTop(r, r.s1);
      const mid = at((r.s0 + r.s1) / 2, r.v);
      const pitch = Math.atan2(yb - ya, len);
      const ym = (ya + yb) / 2;
      if (r.kind === 'rail') {
        // a round steel rail with coloured end caps, on a square under-tube
        const tube = new THREE.CylinderGeometry(0.06, 0.06, len, 10).rotateZ(Math.PI / 2);
        parts.push([tube, PARK_COL.rail, place(mid.x, ym - 0.06, mid.z, yaw, pitch)]);
        parts.push([new THREE.BoxGeometry(len - 0.3, 0.07, 0.05), PARK_COL.railDark, place(mid.x, ym - 0.17, mid.z, yaw, pitch)]);
        for (const [sx, yy] of [[r.s0, ya], [r.s1, yb]]) { const e = at(sx, r.v); parts.push([new THREE.SphereGeometry(0.1, 8, 6), PARK_COL.coping, place(e.x, yy - 0.06, e.z)]); }
      } else {
        // a box: white sliding top between two steel edges, coloured sides with a pale stripe, dark end plates
        const w = r.half * 2;
        parts.push([new THREE.BoxGeometry(len, 0.06, w), PARK_COL.boxTop, place(mid.x, ym - 0.03, mid.z, yaw, pitch)]);
        for (const side of [-1, 1]) parts.push([new THREE.BoxGeometry(len + 0.04, 0.09, 0.05), PARK_COL.steel, place(mid.x, ym - 0.035, mid.z, yaw, pitch).multiply(m4().makeTranslation(0, 0, side * (r.half - 0.01)))]);
        parts.push([new THREE.BoxGeometry(len, r.h - 0.06, w - 0.04), PARK_COL.box, place(mid.x, ym - 0.06 - (r.h - 0.06) / 2, mid.z, yaw, pitch)]);
        for (const side of [-1, 1]) parts.push([new THREE.BoxGeometry(len - 0.5, 0.1, 0.02), PARK_COL.boxTop, place(mid.x, ym - 0.24, mid.z, yaw, pitch).multiply(m4().makeTranslation(0, 0, side * (r.half - 0.01)))]);
        for (const [sx, yy] of [[r.s0, ya], [r.s1, yb]]) { const e = at(sx, r.v); parts.push([new THREE.BoxGeometry(0.06, r.h, w + 0.04), PARK_COL.leg, place(e.x, yy - r.h / 2, e.z, yaw, pitch)]); }
      }
      const legs = r.kind === 'rail' ? 3 : 2;
      for (let i = 0; i < legs; i++) {
        const s = r.s0 + 0.6 + (len - 1.2) * (i / (legs - 1));
        const p = at(s, r.v);
        const top = layout.railTop(r, s), ground = height(p.x, p.z);
        const h = Math.max(0.2, top - ground + 0.3);
        parts.push([new THREE.BoxGeometry(0.08, h, r.kind === 'rail' ? 0.08 : r.half * 1.6), PARK_COL.leg, place(p.x, ground - 0.3 + h / 2, p.z, yaw)]);
      }
    }
    // kickers: the snow shape is terrain (physics); here it gets what makes it read as a built kicker: a coloured lip board, cut side
    // cheeks along the run-up (packed-snow walls with a coloured top edge), a landing line at the knuckle, flags at the lip, a size sign
    const quads = [];
    for (const k of layout.kickers) {
      const col = SIZE_COL[k.size] || PARK_COL.paint;
      const p = at(k.lip, k.v);
      parts.push([new THREE.BoxGeometry(0.5, 0.18, k.w - 1.8), col, place(p.x, height(p.x, p.z) + 0.05, p.z, yaw)]);
      const kn = at(k.s0 + k.run + k.table, k.v);
      parts.push([new THREE.BoxGeometry(0.35, 0.08, k.w - 1.8), col, place(kn.x, height(kn.x, kn.z) + 0.03, kn.z, yaw)]);
      for (const side of [-1, 1]) {
        const vIn = k.v + side * (k.w / 2 - 1.0), vOut = k.v + side * (k.w / 2 + 2.4);
        const n = 6, sFrom = k.s0 + k.run * 0.3, sTo = k.lip + 0.5;
        for (let i = 0; i < n; i++) {
          const sA = sFrom + (sTo - sFrom) * i / n, sB = sFrom + (sTo - sFrom) * (i + 1) / n, len = sB - sA;
          const a = at(sA, vIn), b = at(sB, vIn), m = at((sA + sB) / 2, vIn), o = at((sA + sB) / 2, vOut);
          const ya = height(a.x, a.z), yb = height(b.x, b.z), top = (ya + yb) / 2, rise = top - height(o.x, o.z);
          if (rise < 0.2) continue;
          const pitch = Math.atan2(yb - ya, len);
          parts.push([new THREE.BoxGeometry(len + 0.05, rise + 1.2, 0.16), PARK_COL.cut, place(m.x, top - (rise + 1.2) / 2, m.z, yaw, pitch)]);
          parts.push([new THREE.BoxGeometry(len + 0.05, 0.08, 0.24), col, place(m.x, top + 0.03, m.z, yaw, pitch)]);
        }
        const f = at(k.lip, k.v + side * (k.w / 2 + 0.2));
        const fg = height(f.x, f.z);
        parts.push([new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6), PARK_COL.leg, place(f.x, fg + 1.1, f.z)]);
        parts.push([new THREE.BoxGeometry(0.7, 0.42, 0.03), col, place(f.x, fg + 2.15, f.z, yaw).multiply(m4().makeTranslation(-0.36, 0, 0))]);
      }
      // the size sign, a few metres before the run-up on the outer side
      const out = k.v >= 0 ? 1 : -1;
      const sp2 = at(k.s0 - 1.5, k.v + out * (k.w / 2 + 1.6));
      const sg2 = height(sp2.x, sp2.z);
      parts.push([new THREE.BoxGeometry(0.08, 2.0, 0.08), PARK_COL.sign, place(sp2.x, sg2 + 0.8, sp2.z, yaw)]);
      const ti = { S: 0, M: 1, L: 2 }[k.size] || 0;
      quads.push([0.95, 0.95, place(sp2.x, sg2 + 1.75, sp2.z, yaw).multiply(m4().makeTranslation(-0.06, 0, 0)), ti * 0.25, 0, ti * 0.25 + 0.25, 0.5]);
    }
    // the halfpipe: an orange coping along both lips, a sign at its entry
    if (layout.pipe) {
      for (let s = layout.pipe.s0; s < layout.pipe.s1; s += 4) for (const side of [-1, 1]) {
        const a = at(s, side * (layout.deck - 0.3)), b = at(Math.min(layout.pipe.s1, s + 4), side * (layout.deck - 0.3)), m = at(Math.min(layout.pipe.s1, s + 2), side * (layout.deck - 0.3));
        const ya = height(a.x, a.z), yb = height(b.x, b.z);
        parts.push([new THREE.BoxGeometry(4.05, 0.14, 0.22), PARK_COL.coping, place(m.x, (ya + yb) / 2 + 0.05, m.z, yaw, Math.atan2(yb - ya, 4))]);
      }
      const pp = at(layout.pipe.s0 - 6, layout.deck + 1.2);
      const pg = height(pp.x, pp.z);
      parts.push([new THREE.BoxGeometry(0.08, 2.0, 0.08), PARK_COL.sign, place(pp.x, pg + 0.8, pp.z, yaw)]);
      quads.push([0.95, 0.95, place(pp.x, pg + 1.75, pp.z, yaw).multiply(m4().makeTranslation(-0.06, 0, 0)), 0.75, 0, 1, 0.5]);
    }
    // fences along both sides: 6 m net panels that follow the slope, a post at each joint
    for (let s = -4; s < layout.len + 4; s += 6) for (const side of [-1, 1]) {
      const v = side * (layout.hw + 1.5);
      const a = at(s, v), b = at(s + 6, v), m = at(s + 3, v);
      const ya = height(a.x, a.z), yb = height(b.x, b.z);
      parts.push([new THREE.BoxGeometry(6, 0.55, 0.03), PARK_COL.fence, place(m.x, (ya + yb) / 2 + 0.62, m.z, yaw, Math.atan2(yb - ya, 6))]);
      parts.push([new THREE.CylinderGeometry(0.035, 0.035, 1.2, 5), PARK_COL.leg, place(a.x, ya + 0.45, a.z)]);
    }
    // the gate at the drop-in: two posts and the park's banner across the line
    // (behind and above the START arch of the run props: 12 m wide, the banner 6.6 m up)
    const GATE_S = -13, GATE_HALF = 6;
    const gp = at(GATE_S, 0);
    const gl = at(GATE_S, -GATE_HALF), gr = at(GATE_S, GATE_HALF);
    const gy = Math.max(height(gl.x, gl.z), height(gr.x, gr.z), height(gp.x, gp.z));
    for (const q of [gl, gr]) { const g0 = height(q.x, q.z); parts.push([new THREE.BoxGeometry(0.22, gy + 8.1 - g0 + 0.6, 0.22), PARK_COL.sign, place(q.x, (gy + 8.1 + g0 - 0.6) / 2, q.z, yaw)]); }
    const bw = GATE_HALF * 2;
    parts.push([new THREE.BoxGeometry(0.14, bw / 4 + 0.16, bw + 0.3), PARK_COL.sign, place(gp.x, gy + 8.1 - bw / 8, gp.z, yaw)]);
    quads.push([bw, bw / 4, place(gp.x, gy + 8.1 - bw / 8, gp.z, yaw).multiply(m4().makeTranslation(-0.08, 0, 0)), 0, 0.5, 1, 1]);
    quads.push([bw, bw / 4, place(gp.x, gy + 8.1 - bw / 8, gp.z, yaw + Math.PI).multiply(m4().makeTranslation(-0.08, 0, 0)), 0, 0.5, 1, 1]);
    const geo = mergeParts(parts);
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    if (boards) { scene.remove(boards); boards.geometry.dispose(); }
    boards = new THREE.Mesh(boardGeometry(quads), boardMat);
    boards.name = 'ski-park-boards';
    scene.add(boards);
    mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ski-park';
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }
  build();
  return {
    get mesh() { return mesh; },
    rebuild: build,
    setVisible(v) { if (mesh) mesh.visible = v; if (boards) boards.visible = v; },
    update(cx, cz, radius) { if (mesh) { mesh.visible = Math.hypot(cx - layout.x0, cz - layout.z0) < radius + layout.len; if (boards) boards.visible = mesh.visible; } },
    dispose() { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); } if (boards) { scene.remove(boards); boards.geometry.dispose(); } mat.dispose(); boardMat.map.dispose(); boardMat.dispose(); },
  };
}
