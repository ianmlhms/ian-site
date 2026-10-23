/* Schueberfouer Tycoon, "Glow & density": painted plane trees (Platanus x hispanica) for the Glacis.
 *
 *   const geos = makePlaneTreeGeometries(T, quality)  -> { near, far, tris: { near, far } }        (unit tree: height 1, crown radius 1)
 *   const lod  = createTreeLod({ T, root, near, far, material, quality })
 *   lod.add(chunkKey, items, groundY) -> THREE.Group   items: [x, z, height, crownRadius, r, g, b, seed]  (root-local metres)
 *   lod.update()                                       call every frame (glacis.update): re-sorts the per-chunk near/far split when the camera moved
 *
 * Look: mottled grey / cream / olive trunk that forks into three limbs, a broad irregular crown of overlapping lobes (lit yellow-green tops,
 * dark teal-green undersides, a few yellow leaves).  Vertex colours only, smooth vertex normals (a blend of the lobe normal and the whole-crown
 * normal so the crown reads as one dome made of round bumps).  No textures.
 *
 * LOD: every chunk owns TWO InstancedMesh objects that share the same material, a near one (about 410 triangles per tree) and a far one (34).
 * Each instance lives in exactly one of them: the trees within NEAR_R of the camera (at most MAX_NEAR in the whole scene, hysteresis NEAR_R..FAR_R)
 * go to the near mesh, the rest to the far mesh.  The camera comes from the far mesh' onBeforeRender (last frame), the split is applied in update(),
 * so no extra draw call is spent on a sentinel, and a near mesh with no trees is not drawn at all. */

const NEAR_R = 52;            // m: a tree becomes "near" inside this distance ...
const FAR_R = 66;             // ... and goes back to the cheap template outside this one
const MAX_NEAR = 40;          // at most this many near trees in the whole scene
const MOVE_EPS = 6;           // m the camera has to move before the split is re-evaluated

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash3 = (x, y, z) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* palette (linear values, the material is Lambert + vertex colours) */
const LEAF_TOP = [0.32, 0.47, 0.07];       // sun-lit yellow-green
const LEAF_MID = [0.15, 0.28, 0.06];       // mid green
const LEAF_UNDER = [0.07, 0.14, 0.06];    // dark teal-green underside
const LEAF_YELLOW = [0.34, 0.34, 0.055];    // the odd yellow leaf cluster
const BARK_GREY = [0.34, 0.33, 0.30];
const BARK_CREAM = [0.60, 0.55, 0.42];
const BARK_OLIVE = [0.26, 0.25, 0.12];
const BARK_DARK = [0.13, 0.11, 0.09];

/* crown layout in unit space: [x, y, z, horizontal radius, (major = also in the far template)] */
const LOBES = [
  [0.00, 0.74, 0.00, 0.58, 1],
  [0.50, 0.66, 0.18, 0.52, 1],
  [-0.42, 0.64, -0.30, 0.52, 1],
  [0.12, 0.62, -0.62, 0.42, 0],
  [-0.55, 0.60, 0.30, 0.40, 0],
  [0.62, 0.58, -0.35, 0.36, 0],
  [0.05, 0.89, 0.10, 0.34, 0],
  [-0.10, 0.55, 0.62, 0.38, 0],
  [-0.62, 0.74, -0.52, 0.30, 0],
];
const FAR_LOBES = [[0.1, 0.72, 0.0, 0.84, 1], [-0.62, 0.6, -0.3, 0.5, 1]];       // the cheap template: one broad flattened icosa lobe (20 triangles), one small octahedron lobe (8), a 3-sided trunk (6)
const LOBE_FLAT = 0.4;                     // vertical / horizontal radius of a lobe (unit space; crowns are wider than tall)
const CROWN_C = [0, 0.64, 0];

export function makePlaneTreeGeometries(T, quality = 'medium') {
  const rich = quality === 'high';
  const build = (cfg) => {
    const P = []; const N = []; const C = []; const I = [];
    const add = (p, n, c) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); C.push(c[0], c[1], c[2]); return P.length / 3 - 1; };
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

    /* --- trunk: ring sections with mottled colour patches, then limbs */
    const ringSections = (y0, y1, r0, r1, seg, nSec, tag, tilt) => {
      const rings = [];
      for (let s = 0; s <= nSec; s++) {
        const f = s / nSec; const y = y0 + (y1 - y0) * f; const rr = r0 + (r1 - r0) * f;
        const ring = [];
        for (let k = 0; k < seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          const hh = hash3(k + tag * 17, s * 3 + tag, 5);
          // mottled bark: grey, cream, olive-brown patches, darker toward the ground
          let c = hh < 0.38 ? BARK_GREY : hh < 0.66 ? BARK_CREAM : BARK_OLIVE;
          const hh2 = hash3(k * 7 + tag, s * 5, 9);
          c = mix3(c, hh2 < 0.5 ? BARK_GREY : BARK_CREAM, 0.35 * hh2);
          c = mix3(c, BARK_DARK, clamp(0.55 - y * 1.3, 0, 0.55));
          const jr = rr * (0.92 + 0.16 * hash3(k, s, tag + 3));
          const cx = tilt ? tilt[0] * f : 0; const cz = tilt ? tilt[1] * f : 0;
          ring.push(add([cx + Math.cos(a) * jr, y, cz + Math.sin(a) * jr], [Math.cos(a), 0.15, Math.sin(a)], c));
        }
        rings.push(ring);
      }
      for (let s = 0; s < nSec; s++) for (let k = 0; k < seg; k++) {
        const a = rings[s][k]; const b = rings[s][(k + 1) % seg]; const c = rings[s + 1][(k + 1) % seg]; const d = rings[s + 1][k];
        I.push(a, b, c, a, c, d);
      }
    };
    if (cfgTrunk(cfg) === 0) ringSections(0, 0.46, 0.06, 0.036, 3, 1, 1, null);
    else {
      ringSections(0, 0.40, 0.075, 0.04, 8, rich ? 3 : 2, 2, null);      // trunk with a slight flare
      // three limbs forking from the top of the trunk
      for (let l = 0; l < 3; l++) {
        const a = l * 2.094 + 0.5 + hash3(l, 3, 3) * 0.5; const out = 0.30 + 0.1 * hash3(l, 5, 1);
        ringSections(0.40, 0.58 + 0.04 * l, 0.034, 0.016, 4, 1, 10 + l, [Math.cos(a) * out, Math.sin(a) * out]);
      }
    }

    /* --- crown lobes */
    const lobes = cfg.far ? FAR_LOBES : LOBES;
    lobes.forEach((lb, li) => {
      const major = lb[4] === 1;
      const detail = cfg.far ? 0 : (major || (rich && li < 6) ? 1 : 0);
      const ico = cfg.far && li > 0 ? new T.OctahedronGeometry(1, 0) : new T.IcosahedronGeometry(1, detail);
      const pos = ico.attributes.position;
      const rx = lb[3]; const ry = rx * (cfg.far ? 0.34 : LOBE_FLAT);
      const base = P.length / 3;
      const ang = hash3(li, 7, 2) * 6.283; const ca = Math.cos(ang); const sa = Math.sin(ang); const tl2 = hash3(li, 11, 4) * 1.2; const cb = Math.cos(tl2); const sb = Math.sin(tl2);
      for (let q = 0; q < pos.count; q++) {
        const ox = pos.getX(q); const oy = pos.getY(q); const oz = pos.getZ(q);
        // a different turn per lobe so the 20-triangle blobs do not all show the same hexagon
        const rx1 = ox * ca - oz * sa; const rz1 = ox * sa + oz * ca; const dx = rx1; const dy = oy * cb - rz1 * sb; const dz = oy * sb + rz1 * cb;
        const qk = [Math.round(dx * 24), Math.round(dy * 24), Math.round(dz * 24)];
        const jit = 1 + (cfg.far ? 0.16 : 0.22) * (hash3(qk[0] + li * 31, qk[1], qk[2]) - 0.5) * 2;
        const p = [lb[0] + dx * rx * jit, lb[1] + dy * ry * jit, lb[2] + dz * rx * jit];
        const nLobe = norm([dx / rx, dy / ry, dz / rx]);
        const nCrown = norm([p[0] - CROWN_C[0], (p[1] - CROWN_C[1]) / 0.42, p[2] - CROWN_C[2]]);
        const n = norm([nLobe[0] * 0.55 + nCrown[0] * 0.45, nLobe[1] * 0.55 + nCrown[1] * 0.45, nLobe[2] * 0.55 + nCrown[2] * 0.45]);
        // colour: lit top, dark underside, crown interior shaded, clumps and the odd yellow leaf
        const tl = clamp(dy * 0.5 + 0.5, 0, 1);                       // 0 under the lobe .. 1 on top
        const yc = clamp((p[1] - 0.40) / 0.52, 0, 1);                 // position in the crown
        const lit = clamp(tl * 0.65 + yc * 0.45 + (n[1] * 0.5 + 0.5) * 0.15 - 0.15, 0, 1);
        const cl = hash3(Math.round(p[0] * 7), Math.round(p[1] * 9), Math.round(p[2] * 7));
        let c = lit < 0.5 ? mix3(LEAF_UNDER, LEAF_MID, lit * 2) : mix3(LEAF_MID, LEAF_TOP, (lit - 0.5) * 2);
        c = mix3(c, LEAF_YELLOW, cl > 0.86 ? 0.55 * (cl - 0.86) / 0.14 + 0.2 : 0);
        const sp = 0.86 + 0.28 * hash3(qk[0] * 3, qk[1] * 5 + li, qk[2] * 7);
        add(p, n, [c[0] * sp, c[1] * sp, c[2] * sp]);
      }
      for (let q = 0; q < pos.count; q += 3) I.push(base + q, base + q + 1, base + q + 2);
      ico.dispose();
    });

    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    g.setIndex(new T.Uint16BufferAttribute(I, 1));
    g.computeBoundingSphere();
    return g;
  };
  const cfgTrunk = (cfg) => (cfg.far ? 0 : 1);
  const near = build({ far: false });
  const far = build({ far: true });
  return { near, far, tris: { near: near.index.count / 3, far: far.index.count / 3 } };
}

export function createTreeLod({ T, root, near, far, material, quality = 'medium' }) {
  const chunks = [];                          // { key, n, pos, mats, cols, state, near, far, group }
  const camLocal = new T.Vector3(); const camWorld = new T.Vector3(); let haveCam = false; let lastX = 1e9; let lastY = 1e9; let lastZ = 1e9;
  const grab = (r, s, cam) => { camWorld.setFromMatrixPosition(cam.matrixWorld); haveCam = true; };
  const maxNear = quality === 'low' ? Math.round(MAX_NEAR * 0.5) : quality === 'medium' ? Math.round(MAX_NEAR * 0.8) : MAX_NEAR;      // polish 2: medium 40 -> 32 near trees (416 triangles each)

  function add(key, items, groundYOf, { yawOf, compose, colorOf }) {
    const n = items.length;
    const mats = new Float32Array(n * 16); const cols = new Float32Array(n * 3); const pos = new Float32Array(n * 3);
    const m4 = new T.Matrix4(); const c = new T.Color();
    items.forEach((it, q) => {
      compose(m4, it, q); m4.toArray(mats, q * 16);
      colorOf(c, it, q); cols[q * 3] = c.r; cols[q * 3 + 1] = c.g; cols[q * 3 + 2] = c.b;
      pos[q * 3] = m4.elements[12]; pos[q * 3 + 1] = m4.elements[13]; pos[q * 3 + 2] = m4.elements[14];
    });
    const group = new T.Group(); group.name = 'fouer-trees-group-' + key;
    const mk = (geo, cap, name) => {
      const im = new T.InstancedMesh(geo, material, cap);
      im.userData.sharedGeo = true; im.name = name; im.count = 0;
      im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      return im;
    };
    const farM = mk(far, n, 'fouer-trees-' + key);
    const nearM = mk(near, Math.min(n, maxNear), 'fouer-trees-near-' + key); nearM.visible = false;
    farM.onBeforeRender = grab; nearM.onBeforeRender = grab;
    group.add(farM, nearM);
    const rec = { key, n, pos, mats, cols, state: new Uint8Array(n), near: nearM, far: farM, group, sig: '' };
    // initial: everything far
    applySplit(rec, new Uint8Array(n));
    farM.computeBoundingSphere();
    const bs = farM.boundingSphere.clone(); farM.userData.bs = bs;
    chunks.push(rec);
    return group;
  }

  function applySplit(rec, st) {
    const fa = rec.far; const ne = rec.near; let nf = 0; let nn = 0;
    const fm = fa.instanceMatrix.array; const fc = fa.instanceColor.array; const nm = ne.instanceMatrix.array; const nc = ne.instanceColor.array;
    const cap = ne.instanceMatrix.count;
    for (let q = 0; q < rec.n; q++) {
      if (st[q] && nn < cap) { nm.set(rec.mats.subarray(q * 16, q * 16 + 16), nn * 16); nc.set(rec.cols.subarray(q * 3, q * 3 + 3), nn * 3); nn++; }
      else { fm.set(rec.mats.subarray(q * 16, q * 16 + 16), nf * 16); fc.set(rec.cols.subarray(q * 3, q * 3 + 3), nf * 3); nf++; }
    }
    fa.count = nf; ne.count = nn;
    fa.visible = nf > 0; ne.visible = nn > 0;
    fa.instanceMatrix.needsUpdate = true; fa.instanceColor.needsUpdate = true; ne.instanceMatrix.needsUpdate = true; ne.instanceColor.needsUpdate = true;
    if (nn) { ne.boundingSphere = null; ne.computeBoundingSphere(); }
    if (fa.userData.bs) fa.boundingSphere = fa.userData.bs;
    rec.state = st;
  }

  const cand = [];
  function update() {
    if (!haveCam || !chunks.length) return;
    root.updateMatrixWorld();
    camLocal.copy(camWorld); root.worldToLocal(camLocal);
    if (Math.abs(camLocal.x - lastX) + Math.abs(camLocal.y - lastY) + Math.abs(camLocal.z - lastZ) < MOVE_EPS) return;
    lastX = camLocal.x; lastY = camLocal.y; lastZ = camLocal.z;
    cand.length = 0;
    const R2 = NEAR_R * NEAR_R; const F2 = FAR_R * FAR_R;
    chunks.forEach((rec, ci) => {
      for (let q = 0; q < rec.n; q++) {
        const dx = rec.pos[q * 3] - camLocal.x; const dy = rec.pos[q * 3 + 1] - camLocal.y; const dz = rec.pos[q * 3 + 2] - camLocal.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < (rec.state[q] ? F2 : R2)) cand.push(d2, ci, q);
      }
    });
    // the nearest maxNear win
    let keep = null;
    const cnt = cand.length / 3;
    if (cnt > maxNear) { const ds = []; for (let i = 0; i < cnt; i++) ds.push(cand[i * 3]); ds.sort((a, b) => a - b); keep = ds[maxNear - 1]; }
    const next = chunks.map((rec) => new Uint8Array(rec.n)); let changed = chunks.map(() => false);
    for (let i = 0; i < cnt; i++) { if (keep !== null && cand[i * 3] > keep) continue; next[cand[i * 3 + 1]][cand[i * 3 + 2]] = 1; }
    chunks.forEach((rec, ci) => {
      const a = rec.state; const b = next[ci]; for (let q = 0; q < rec.n; q++) if (a[q] !== b[q]) { changed[ci] = true; break; }
      if (changed[ci]) applySplit(rec, b);
    });
  }

  return { add, update, chunks, stats() { let nn = 0; let nf = 0; chunks.forEach((r) => { nn += r.near.count; nf += r.far.count; }); return { near: nn, far: nf }; } };
}
