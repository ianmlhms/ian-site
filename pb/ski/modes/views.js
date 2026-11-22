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

/* ---------------- R7-D: the park's snow bodies as real meshes ----------------
 * Kickers (run-up curve, sharp lip, flat table, rounded knuckle, landing, straight side walls), the rail ramps, the halfpipe (flat,
 * curved walls, a crisp lip, a deck either side). Every vertex is the analytic shape of modes/park.js (`layout.featureHeight` over the
 * profile), which the physics reads too (surface.js -> layout.solidAt): drawn == skied. Each surface is its own patch (shared vertices
 * inside a patch: smooth light; none across a lip or a wall edge: crisp edges). The outer rim sinks a little into the terrain (no seam,
 * no z-fight). One merged geometry, drawn with the terrain's painted snow material (aInfo = groomed piste, aExtra = the park's line). */
const SINK = 0.06, LIFT = 0.008, DECK_LIFT = 0.012;      // m; the pipe deck a little more (flat over a terrain lowered by 8 cm)
export function parkSnowGeometry(layout) {
  const pos = [], nrm = [], info = [], extra = [], idx = [], rim = [];          // rim: 1 = a vertex under the snow (the hidden edge)
  const { ux, uz } = layout;
  /** a patch: rows along s (sList), columns across (cols(s) -> [[v, y, sink?, occ], ...]); smooth normals inside the patch */
  function patch(sList, cols) {
    const base = pos.length / 3;
    let n = 0;
    for (const s of sList) {
      const row = cols(s);
      n = row.length;
      for (const [v, y, sink, occ = 0, under = false] of row) {
        const p = layout.world(s, v);
        pos.push(p.x, y + (sink ? -SINK : LIFT), p.z);
        rim.push(sink || under ? 1 : 0);
        info.push(1, 0, 0, 0); extra.push(ux, uz, occ, 0); nrm.push(0, 0, 0);
      }
    }
    for (let i = 0; i < sList.length - 1; i++) for (let j = 0; j < n - 1; j++) {
      const a = base + i * n + j, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);                 // counter-clockwise seen from above (v runs to the left of s)
    }
  }
  const ground = (s) => layout.profileAt(s);
  /** a side wall's two columns: its top edge, and its foot carried on along the wall's own plane SINK m under the snow (so the wall
   *  above the snow is exactly the physics' wall, and its foot never shows) */
  const wallCols = (cv, half, width, side, g, top, end) => {
    const rise = Math.max(top - g, 0.02), dv = Math.min(width + 0.6, width * (1 + (SINK + LIFT) / rise));
    const foot = [cv + side * (half + dv), g - SINK - LIFT, false, 0, true], edge = [cv + side * half, top, end];
    const mid = [cv + side * (half + width / 2), (top + g) / 2, end], toe = [cv + side * (half + width), g, end];     // on the physics' wall
    return side < 0 ? [foot, toe, mid, edge] : [edge, mid, toe, foot];
  };
  const range = (a, b, step) => { const out = []; const n = Math.max(1, Math.ceil((b - a) / step)); for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n); return out; };
  // kickers: top (run-up | table + knuckle + landing), two side walls (same split), so the lip and the wall edges stay crisp
  for (const k of layout.kickers) {
    const hw = k.w / 2;
    const runS = range(0, 1, 1 / 18).map((q) => k.s0 + k.run * (1 - Math.pow(1 - q, 1.6)));         // denser towards the lip
    const restS = [...range(k.lip, k.lip + k.table, 1.5), ...range(k.lip + k.table, k.end, 0.9).slice(1)];
    const top = (s) => ground(s) + k.h * layout.kickerAlong(k, s - k.s0);
    const atEnd = (s) => s <= k.s0 + 1e-6 || s >= k.end - 1e-6;
    for (const sList of [runS, restS]) {
      patch(sList, (s) => [-hw, -hw / 2, 0, hw / 2, hw].map((dv) => [k.v + dv, top(s), atEnd(s)]));
      for (const side of [-1, 1]) patch(sList, (s) => wallCols(k.v, hw, k.side, side, ground(s), top(s), atEnd(s)));
    }
  }
  // the ramps in front of the rails / boxes: one top (it rises, then drops just before the rail) and two side walls
  for (const r of layout.ramps) {
    const hw = r.w / 2;
    const sList = [...range(r.s0 - 0.5, r.s1 - 0.6, 0.8), ...range(r.s1 - 0.6, r.s1 + 0.6, 0.08).slice(1)];
    const top = (s) => ground(s) + r.h * layout.rampAlong(r, s);
    const atEnd = (s) => s <= r.s0 - 0.5 + 1e-6 || s >= r.s1 + 0.6 - 1e-6;
    patch(sList, (s) => [-hw, 0, hw].map((dv) => [r.v + dv, top(s), atEnd(s)]));
    for (const side of [-1, 1]) patch(sList, (s) => wallCols(r.v, hw, layout.rampSide, side, ground(s), top(s), atEnd(s)));
  }
  // the halfpipe: inside (wall - flat - wall) and the two decks, along the whole trough under it
  const P = layout.pipe;
  if (P) {
    const deck = layout.deck, edge = deck + layout.pipeDeck;
    const [a, b] = layout.pipeSpan;
    const sList = [...range(a, P.s0, 1), ...range(P.s0, P.s1, 2).slice(1), ...range(P.s1, b, 1).slice(1)];
    const atEnd = (s) => s <= a + 1e-6 || s >= b - 1e-6;
    const wall = [];
    for (let i = 0; i <= 14; i++) { const t = 1 - i / 14; wall.push(P.flat / 2 + P.wall * (1 - Math.pow(1 - t, 1.35))); }   // denser towards the lip (steepest)
    const across = [...wall.map((v) => -v), -P.flat / 4, 0, P.flat / 4, ...wall.slice().reverse()];
    patch(sList, (s) => across.map((v) => {
      const tt = Math.max(0, Math.abs(v) - P.flat / 2) / P.wall, h = layout.featureHeight(s, v);
      return [v, ground(s) + h, atEnd(s), 0.5 * (1 - tt * tt) * Math.min(1, -h)];         // less sky light down in the pipe
    }));
    for (const side of [-1, 1]) patch(sList, (s) => [side * deck, side * (deck + 1.2), side * (edge - 0.8), side * edge].sort((p, q) => p - q).map((v) => [v, ground(s) + DECK_LIFT, Math.abs(v) >= edge - 1e-6 || atEnd(s)]));
  }
  // normals: area-weighted, per patch (vertices are not shared across patches)
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const o of [a, b, c]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let o = 0; o < nrm.length; o += 3) {
    let [x, y, z] = [nrm[o], nrm[o + 1], nrm[o + 2]];
    if (y < 0) { x = -x; y = -y; z = -z; }
    const l = Math.hypot(x, y, z) || 1;
    nrm[o] = x / l; nrm[o + 1] = y / l || 1; nrm[o + 2] = z / l;
  }
  return { pos, nrm, info, extra, idx, rim };
}

/** layout = park.js createParkLayout; height(x, z) = the snow (surface.height); snowMaterial() = the terrain's painted snow (R7-D).
 *  Returns { mesh, rebuild(), dispose() }. */
export function createParkView({ scene, layout, height, snowMaterial = null }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2622 });      // a little self-light: the nets and rails read in the shade
  let mesh = null, boards = null, snow = null;
  const fallbackSnow = new THREE.MeshLambertMaterial({ color: 0xf2f5fa });
  const snowMat = () => (snowMaterial && snowMaterial()) || fallbackSnow;
  function buildSnow() {
    const g = parkSnowGeometry(layout);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(g.info, 4));
    geo.setAttribute('aExtra', new THREE.Float32BufferAttribute(g.extra, 4));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    if (snow) { scene.remove(snow); snow.geometry.dispose(); }
    snow = new THREE.Mesh(geo, snowMat());
    snow.name = 'ski-park-snow';
    snow.castShadow = true;
    snow.frustumCulled = true;
    scene.add(snow);
  }
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
    // kickers (R7-D: the snow body is parkSnowGeometry): a coloured strip on the lip, coloured edges along the run-up and the table,
    // a landing line at the knuckle, flags beside the lip, a size sign
    const quads = [];
    for (const k of layout.kickers) {
      const col = SIZE_COL[k.size] || PARK_COL.paint;
      const hw = k.w / 2;
      const yOn = (s, v) => { const p = at(s, v); return height(p.x, p.z); };
      const slopeAt = (s) => Math.atan2(layout.profileAt(s + 1) - layout.profileAt(s - 1), 2);
      const p = at(k.lip - 0.15, k.v);
      parts.push([new THREE.BoxGeometry(0.34, 0.07, k.w + 0.02), col, place(p.x, yOn(k.lip + 0.02, k.v) - 0.015, p.z, yaw, slopeAt(k.lip))]);
      const kn = at(k.s0 + k.run + k.table, k.v);
      parts.push([new THREE.BoxGeometry(0.35, 0.05, k.w - 0.4), col, place(kn.x, yOn(k.s0 + k.run + k.table, k.v) + 0.005, kn.z, yaw, slopeAt(k.s0 + k.run + k.table))]);
      for (const side of [-1, 1]) {
        const vE = k.v + side * (hw - 0.06);
        const n = 7, sFrom = k.s0 + k.run * 0.35;
        const edgeS = [];
        for (let i = 0; i <= n; i++) edgeS.push(sFrom + (k.lip - sFrom) * Math.pow(i / n, 0.8));
        edgeS.push(k.lip + k.table);
        for (let i = 0; i < edgeS.length - 1; i++) {
          const sA = edgeS[i], sB = edgeS[i + 1], ya = yOn(sA, vE), yb = yOn(Math.min(sB, k.lip + k.table) - (i === n - 1 ? 0.01 : 0), vE);
          const len = Math.hypot(sB - sA, yb - ya), m = at((sA + sB) / 2, vE);
          parts.push([new THREE.BoxGeometry(len + 0.04, 0.05, 0.14), col, place(m.x, (ya + yb) / 2 + 0.005, m.z, yaw, Math.atan2(yb - ya, sB - sA))]);
        }
        const f = at(k.lip, k.v + side * (hw + k.side + 0.35));
        const fg = height(f.x, f.z);
        parts.push([new THREE.CylinderGeometry(0.035, 0.035, 2.6 + k.h * 0.6, 6), PARK_COL.leg, place(f.x, fg + 1.1 + k.h * 0.3, f.z)]);
        parts.push([new THREE.BoxGeometry(0.7, 0.42, 0.03), col, place(f.x, fg + 2.15 + k.h * 0.6, f.z, yaw).multiply(m4().makeTranslation(-0.36, 0, 0))]);
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
      for (let s = layout.pipe.s0 - 2; s < layout.pipe.s1 + 2; s += 4) for (const side of [-1, 1]) {     // R7-D: right on the lip line
        const v = side * layout.deck, sB = Math.min(layout.pipe.s1 + 2, s + 4);
        const ya = layout.profileAt(s), yb = layout.profileAt(sB), m = at((s + sB) / 2, v);
        parts.push([new THREE.BoxGeometry(sB - s + 0.05, 0.1, 0.24), PARK_COL.coping, place(m.x, (ya + yb) / 2 + 0.02, m.z, yaw, Math.atan2(yb - ya, sB - s))]);
      }
      // R7-D: a blue dye line where each wall leaves the flat (it draws the pipe's shape in flat light)
      for (let s = layout.pipe.s0; s < layout.pipe.s1; s += 4) for (const side of [-1, 1]) {
        const v = side * (layout.pipe.flat / 2 + 0.15), sB = Math.min(layout.pipe.s1, s + 4);
        const ya = layout.profileAt(s) + layout.featureHeight(s, v), yb = layout.profileAt(sB) + layout.featureHeight(sB, v), m = at((s + sB) / 2, v);
        parts.push([new THREE.BoxGeometry(sB - s + 0.02, 0.03, 0.16), PARK_COL.paint, place(m.x, (ya + yb) / 2 + 0.005, m.z, yaw, Math.atan2(yb - ya, sB - s))]);
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
    buildSnow();
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
    get snow() { return snow; },
    rebuild: build,
    setVisible(v) { if (mesh) mesh.visible = v; if (boards) boards.visible = v; if (snow) snow.visible = v; },
    update(cx, cz, radius) {
      if (mesh) { mesh.visible = Math.hypot(cx - layout.x0, cz - layout.z0) < radius + layout.len; if (boards) boards.visible = mesh.visible; }
      if (snow) { snow.visible = !mesh || mesh.visible; const m = snowMat(); if (snow.material !== m) snow.material = m; }      // R7-D: follows the terrain's material (quality switch)
    },
    dispose() { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); } if (boards) { scene.remove(boards); boards.geometry.dispose(); } if (snow) { scene.remove(snow); snow.geometry.dispose(); } mat.dispose(); fallbackSnow.dispose(); boardMat.map.dispose(); boardMat.dispose(); },
  };
}
