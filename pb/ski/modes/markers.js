/* Challenges placed on the mountain (round 6). Every piste's star challenge (modes/challenges.js) and the snow park get a start gate in
 * the world, right where the timed run starts: two posts and a banner across the piste in its colour (gold once all three stars are
 * won), and a floating label (the name and the stars) on the nearest few. Skiing into a gate asks "Challenge: <piste> ★★☆ → Start?".
 *   gates   ONE instanced mesh for all of a resort's gates (one draw call, colour per instance)
 *   labels  plain DOM over the canvas (no draw call), only the nearest LABEL_MAX within LABEL_DIST that are in view
 * The pure part (list, the gate the skier is in) is exported for the Node checks. */
const THREE = typeof window !== "undefined" ? window.THREE : null;      // Node checks import the pure part

export const MARKER = Object.freeze({ width: 7, height: 3.4, trigger: 9, rearm: 30, labelDist: 260, labelMax: 4 });
const DIFF_HEX = { green: 0x2f9a4c, blue: 0x2a66d0, red: 0xd0352c, black: 0x1d1f24 };
const GOLD = 0xd9a520, PARK = 0x6b3fa0;

/** The start gates: [{ id, piste | null, park, name, diff, x, z, heading }]. pistes = createPisteSet, layout = the park layout. */
export function markerList(pistes, layout) {
  const out = [];
  for (const p of pistes.list) {
    const a = p.at(2, {});
    out.push({ id: p.id, piste: p, park: false, name: p.name, diff: p.diff, x: a.x, z: a.z, heading: Math.atan2(a.dz, a.dx) });
  }
  if (layout) out.push({ id: 'park', piste: null, park: true, name: layout.name || 'Snowpark', diff: 'park', x: layout.top.x, z: layout.top.z, heading: Math.atan2(layout.uz, layout.ux) });
  return out;
}

/** The gate the skier stands in (within MARKER.trigger m of its middle), or null. */
export function markerAt(list, x, z, radius = MARKER.trigger) {
  let best = null, bd = radius;
  for (const m of list) {
    const dx = m.x - x, dz = m.z - z;
    if (Math.abs(dx) > bd || Math.abs(dz) > bd) continue;
    const d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

export function createMarkers({ scene, list, height, overlay, starsOf }) {
  // one gate: two posts with a white base, the banner across, a small flag on the left post
  // round 7: only the banner and the flag take the gate's colour (aTint 1); the posts, their white bases and the top edge keep their own
  const parts = [];
  const add = (geo, color, x, y, z, tint = 0) => { const g = geo.toNonIndexed(); g.translate(x, y, z); parts.push([g, color, tint]); };
  const W = MARKER.width, H = MARKER.height;
  for (const z of [-W / 2, W / 2]) {
    add(new THREE.CylinderGeometry(0.09, 0.11, H, 6), 0x2b2f36, 0, H / 2, z);
    add(new THREE.CylinderGeometry(0.2, 0.24, 0.35, 8), 0xffffff, 0, 0.17, z);
  }
  add(new THREE.BoxGeometry(0.08, 0.85, W), 0xffffff, 0, H - 0.5, 0, 1);              // banner (tinted per gate)
  add(new THREE.BoxGeometry(0.1, 0.16, W + 0.1), 0xf4f6f9, 0, H - 0.02, 0);             // white top edge
  add(new THREE.BoxGeometry(0.03, 0.4, 0.62), 0xffffff, 0, H + 0.25, -W / 2 + 0.33, 1); // the little flag (tinted too)
  let count = 0;
  for (const [g] of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3), tints = new Float32Array(count);
  let o = 0;
  const c = new THREE.Color();
  for (const [g, hex, tint] of parts) {
    c.setHex(hex);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++, o++) {
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], o * 3); nrm.set([N.getX(i), N.getY(i), N.getZ(i)], o * 3); col.set([c.r, c.g, c.b], o * 3); tints[o] = tint;
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aTint;\n' + shader.vertexShader.replace('#include <color_vertex>',
      THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aTint);'));
  };
  mat.customProgramCacheKey = () => 'ski-gate-tint';
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.name = 'ski-challenge-gates';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  function seat() {
    list.forEach((m, i) => {
      dummy.position.set(m.x, height(m.x, m.z) - 0.15, m.z);
      dummy.rotation.set(0, -m.heading, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  function paint() {
    list.forEach((m, i) => {
      const full = !m.park && starsOf(m) === 7;
      mesh.setColorAt(i, c.setHex(m.park ? PARK : full ? GOLD : DIFF_HEX[m.diff] || 0x2a66d0));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  seat(); paint();
  mesh.count = list.length;
  scene.add(mesh);

  // labels
  const box = document.createElement('div');
  box.className = 'ch-tags';
  overlay.appendChild(box);
  const tags = [];
  for (let i = 0; i < MARKER.labelMax; i++) {
    const t = document.createElement('div');
    t.className = 'ch-tag';
    t.hidden = true;
    box.appendChild(t);
    tags.push({ el: t, id: null });
  }
  const v3 = new THREE.Vector3();
  const starText = (mask) => [1, 2, 4].map((b) => (mask & b ? '★' : '☆')).join('');
  const near = [];
  let visible = true;
  function update(camera, width, height2, labels = true) {
    near.length = 0;
    if (!visible || !labels) { for (const t of tags) { t.el.hidden = true; t.id = null; } return; }
    const cx = camera.position.x, cz = camera.position.z;
    for (const m of list) {
      const dx = m.x - cx, dz = m.z - cz;
      if (Math.abs(dx) > MARKER.labelDist || Math.abs(dz) > MARKER.labelDist) continue;
      const d = Math.hypot(dx, dz);
      if (d < MARKER.labelDist) near.push([d, m]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let k = 0;
    for (const [d, m] of near) {
      if (k >= tags.length) break;
      v3.set(m.x, height(m.x, m.z) + MARKER.height + 1.1, m.z).project(camera);
      if (v3.z >= 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) continue;
      const t = tags[k++];
      if (t.id !== m.id) {
        t.id = m.id;
        t.el.className = `ch-tag ${m.park ? 'park' : m.diff}`;
        t.el.innerHTML = `<i></i><span></span><b></b>`;
        t.el.querySelector('span').textContent = m.park ? `${m.name}` : m.name;
      }
      t.el.querySelector('b').textContent = m.park ? 'Snowpark' : starText(starsOf(m));
      const sx = (v3.x * 0.5 + 0.5) * width, sy = (-v3.y * 0.5 + 0.5) * height2;
      t.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%) scale(${Math.max(0.72, Math.min(1, 80 / Math.max(d, 1))).toFixed(2)})`;
      t.el.hidden = false;
    }
    for (; k < tags.length; k++) { tags[k].el.hidden = true; tags[k].id = null; }
  }
  return {
    mesh, list,
    update, paint, reseat: seat,
    at: (x, z) => markerAt(list, x, z),
    byId: (id) => list.find((m) => m.id === id) || null,
    setVisible(v) { visible = v; mesh.visible = v; if (!v) for (const t of tags) t.el.hidden = true; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); box.remove(); },
  };
}
