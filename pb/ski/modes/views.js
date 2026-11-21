/* The 3D parts of the game modes (round 4A), all cheap: every set is ONE merged, vertex-coloured mesh (one draw call; the park casts a
 * shadow on Mëttel / Héich like the other props).
 *   flags     the challenge flags along a piste (pole + pennant), a taken flag drops out
 *   park      rails and boxes (with their coping and legs), blue paint on the kicker lips and the halfpipe coping, orange fences
 *             along the corridor, a sign board at the drop-in */
const THREE = window.THREE;

/** Merge [geometry, colour hex, matrix] parts into one non-indexed geometry with a colour attribute. */
function mergeParts(parts) {
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
const PARK_COL = Object.freeze({ rail: 0xc9ced6, railDark: 0x3a3f48, box: 0x2f6fd8, boxTop: 0xe9edf2, leg: 0x2b2f36, paint: 0x2a66d0, fence: 0xff7a14, sign: 0x16171a, signFace: 0xf2b21c });

/** layout = park.js createParkLayout; height(x, z) = the snow (surface.height). Returns { mesh, rebuild(), dispose() }. */
export function createParkView({ scene, layout, height }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2622 });      // a little self-light: the nets and rails read in the shade
  let mesh = null;
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
        const tube = new THREE.CylinderGeometry(0.05, 0.05, len, 8).rotateZ(Math.PI / 2);
        parts.push([tube, PARK_COL.rail, place(mid.x, ym - 0.05, mid.z, yaw, pitch)]);
      } else {
        parts.push([new THREE.BoxGeometry(len, 0.06, r.half * 2), PARK_COL.boxTop, place(mid.x, ym - 0.03, mid.z, yaw, pitch)]);
        parts.push([new THREE.BoxGeometry(len, r.h - 0.06, r.half * 2 - 0.04), PARK_COL.box, place(mid.x, ym - 0.06 - (r.h - 0.06) / 2, mid.z, yaw, pitch)]);
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
    // paint on the kicker lips (a blue line across the lip) and on the halfpipe coping (dashes)
    for (const k of layout.kickers) {
      const p = at(k.lip, k.v);
      parts.push([new THREE.BoxGeometry(0.3, 0.12, k.w - 1.2), PARK_COL.paint, place(p.x, height(p.x, p.z) + 0.04, p.z, yaw)]);
    }
    if (layout.pipe) {
      for (let s = layout.pipe.s0; s < layout.pipe.s1; s += 6) for (const side of [-1, 1]) {
        const p = at(s, side * (layout.deck - 0.6));
        parts.push([new THREE.BoxGeometry(3, 0.04, 0.3), PARK_COL.paint, place(p.x, height(p.x, p.z) + 0.03, p.z, yaw)]);
      }
    }
    // fences along both sides: 6 m net panels that follow the slope, a post at each joint
    for (let s = -4; s < layout.len + 4; s += 6) for (const side of [-1, 1]) {
      const v = side * (layout.hw + 1.5);
      const a = at(s, v), b = at(s + 6, v), m = at(s + 3, v);
      const ya = height(a.x, a.z), yb = height(b.x, b.z);
      parts.push([new THREE.BoxGeometry(6, 0.55, 0.03), PARK_COL.fence, place(m.x, (ya + yb) / 2 + 0.62, m.z, yaw, Math.atan2(yb - ya, 6))]);
      parts.push([new THREE.CylinderGeometry(0.035, 0.035, 1.2, 5), PARK_COL.leg, place(a.x, ya + 0.45, a.z)]);
    }
    // the sign at the drop-in: a board on two posts beside the line
    const sp = at(-8, layout.hw - 3);
    const sg = height(sp.x, sp.z);
    parts.push([new THREE.BoxGeometry(0.12, 3.2, 0.12), PARK_COL.sign, place(sp.x, sg + 1.4, sp.z, yaw, 0, 0).multiply(m4().makeTranslation(0, 0, -1.4))]);
    parts.push([new THREE.BoxGeometry(0.12, 3.2, 0.12), PARK_COL.sign, place(sp.x, sg + 1.4, sp.z, yaw).multiply(m4().makeTranslation(0, 0, 1.4))]);
    parts.push([new THREE.BoxGeometry(0.1, 1.2, 3.4), PARK_COL.signFace, place(sp.x, sg + 2.5, sp.z, yaw)]);
    const geo = mergeParts(parts);
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ski-park';
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }
  build();
  return {
    get mesh() { return mesh; },
    rebuild: build,
    setVisible(v) { if (mesh) mesh.visible = v; },
    update(cx, cz, radius) { if (mesh) mesh.visible = Math.hypot(cx - layout.x0, cz - layout.z0) < radius + layout.len; },
    dispose() { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); } mat.dispose(); },
  };
}
