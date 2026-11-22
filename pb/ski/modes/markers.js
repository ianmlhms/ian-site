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
/** R8c: only the gates within GATE_DRAW m of the camera are instances (all ~750 of a resort were drawn everywhere: ~53k triangles);
 *  the set is re-collected after the camera moved GATE_MOVE m. A 7 m gate 1.5 km away is a few pixels. */
export const GATE_DRAW = 1500, GATE_MOVE = 120;
/** R8c (pure, for the checks): the indices of the gates within `radius` m of (x, z). */
export function gatesNear(list, x, z, radius = GATE_DRAW) {
  const out = [];
  list.forEach((m, i) => { if (Math.abs(m.x - x) < radius && Math.abs(m.z - z) < radius && Math.hypot(m.x - x, m.z - z) < radius) out.push(i); });
  return out;
}

/** R7-C2: startOf(piste) = s, or { s, lat } (the gate lat m right of the line). */
function gatePoint(p, startOf) {
  const g = startOf(p), s = typeof g === 'number' ? g : g.s, lat = typeof g === 'number' ? 0 : g.lat || 0;
  const a = p.at(s, {});
  return { x: a.x - a.dz * lat, z: a.z + a.dx * lat, heading: Math.atan2(a.dz, a.dx) };
}

/** The start gates: [{ id, piste | null, park, name, diff, x, z, heading }]. pistes = createPisteSet, layout = the park layout. */
export function markerList(pistes, layout, startOf = () => 2) {      // R7-C: startOf(piste) = the start gate on open snow (clear.js)
  const out = [];
  for (const p of pistes.list) {
    const g = gatePoint(p, startOf);
    out.push({ id: p.id, piste: p, park: false, name: p.name, diff: p.diff, x: g.x, z: g.z, heading: g.heading });
  }
  if (layout) out.push({ id: 'park', piste: null, park: true, name: layout.name || 'Snowpark', diff: 'park', x: layout.top.x, z: layout.top.z, heading: Math.atan2(layout.uz, layout.ux) });
  return out;
}

/** R8c (QA: floating labels overlap each other and are cut at the screen edge): the label boxes in priority order (nearest first),
 *  cands = [{ x, y (anchor: the box's bottom middle, px), w, h (px, scaled) }]; a box is pushed inside the margins (never further than
 *  half its width from its anchor), lifted once by its own height when it hits a placed box or a HUD rect, else dropped.
 *  Returns [{ x0, y0 } | null] (top-left corners). Pure (the checks). */
export const LABEL_MARGIN = 10;
export function placeLabels(cands, { width, height, margin = LABEL_MARGIN, avoid = [] }) {
  const placed = [], out = [];
  const hits = (r) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) || avoid.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  for (const c of cands) {
    let res = null;
    if (c.x >= margin && c.x <= width - margin && c.w <= width - 2 * margin) {
      const x0 = Math.min(Math.max(c.x - c.w / 2, margin), width - margin - c.w);
      for (const lift of [0, c.h + 4]) {
        const y0 = c.y - c.h - lift;
        if (y0 < margin || y0 + c.h > height - margin) continue;
        const r = [x0, y0, x0 + c.w, y0 + c.h];
        if (hits(r)) continue;
        placed.push(r); res = { x0, y0 }; break;
      }
    }
    out.push(res);
  }
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
  const parts = [];
  // R7-D: tint = 1 only on the banner and the little flag (they take the piste colour); posts, base and top edge keep their own colour
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
  // R7-D: the instance colour only reaches the vertices with aTint = 1 (three multiplies every vertex by it otherwise)
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float aTint;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = color.xyz * mix(vec3(1.0), instanceColor.xyz, aTint);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'ski-gate-tint';
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.name = 'ski-challenge-gates';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  let order = list.map((_, i) => i), lastX = Infinity, lastZ = Infinity;     // R8c: the gates drawn (instance k = list[order[k]])
  function seat() {
    order.forEach((idx, k) => {
      const m = list[idx];
      dummy.position.set(m.x, height(m.x, m.z) - 0.15, m.z);
      dummy.rotation.set(0, -m.heading, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  function paint() {
    order.forEach((idx, k) => {
      const m = list[idx];
      const full = !m.park && starsOf(m) === 7;
      mesh.setColorAt(k, c.setHex(m.park ? PARK : full ? GOLD : DIFF_HEX[m.diff] || 0x2a66d0));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  function cull(px, pz) {
    if (Math.hypot(px - lastX, pz - lastZ) < GATE_MOVE) return;
    lastX = px; lastZ = pz;
    order = gatesNear(list, px, pz);
    seat(); paint();
    mesh.count = order.length;
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
  // R8c: the HUD blocks the labels must not cover (re-read twice a second), in the overlay's own pixels
  let avoid = [], avoidAt = -1e9;
  function hudRects() {
    const now = performance.now();
    if (now - avoidAt < 500) return avoid;
    avoidAt = now;
    const host = box.getBoundingClientRect();
    avoid = [];
    for (const e of document.querySelectorAll('.hud .tl, .hud .tr, .hud .hbtns, .hud .hint, .lifthud, .ridehud')) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) avoid.push([r.left - host.left - 6, r.top - host.top - 6, r.right - host.left + 6, r.bottom - host.top + 6]);
    }
    return avoid;
  }
  const cands = [], picks = [];
  function update(camera, width, height2, labels = true) {
    cull(camera.position.x, camera.position.z);
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
    // R8c: the nearest few in view are the candidates (in priority order); placeLabels keeps them inside the screen and apart
    cands.length = 0; picks.length = 0;
    for (const [d, m] of near) {
      if (picks.length >= tags.length * 2) break;
      v3.set(m.x, height(m.x, m.z) + MARKER.height + 1.1, m.z).project(camera);
      if (v3.z >= 1 || Math.abs(v3.x) > 1 || Math.abs(v3.y) > 1) continue;
      picks.push([d, m, (v3.x * 0.5 + 0.5) * width, (-v3.y * 0.5 + 0.5) * height2]);
    }
    for (const [d, m, sx, sy] of picks) {
      const z = sizeOf(m), s = Math.max(0.72, Math.min(1, 80 / Math.max(d, 1)));
      cands.push({ x: sx, y: sy, w: z[0] * s, h: z[1] * s, s, m });
    }
    const spots = placeLabels(cands, { width, height: height2, avoid: hudRects() });
    const used = new Set();
    let k = 0;
    cands.forEach((c, i) => {
      const at = spots[i];
      if (!at || k >= tags.length) return;
      const t = tags.find((q) => q.id === c.m.id && !used.has(q)) || tags.find((q) => !used.has(q) && !cands.some((cc, j) => spots[j] && cc.m.id === q.id));
      if (!t) return;
      if (t.id !== c.m.id) fill(t, c.m);
      used.add(t); k++;
      t.el.querySelector('b').textContent = c.m.park ? 'Snowpark' : starText(starsOf(c.m));
      // the box's top-left at (x0, y0) after scaling round the bottom middle (ui.css transform-origin 50% 100%)
      const [w, h] = sizeOf(c.m);
      const tx = at.x0 - w / 2 + (w * c.s) / 2, ty = at.y0 + h * c.s - h;
      t.el.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${c.s.toFixed(2)})`;
      t.el.hidden = false;
    });
    for (const t of tags) if (!used.has(t)) { t.el.hidden = true; t.id = null; }
  }
  /** a tag shows marker m */
  function fill(t, m) {
    t.id = m.id;
    t.el.className = `ch-tag ${m.park ? 'park' : m.diff}`;
    t.el.innerHTML = `<i></i><span></span><b></b>`;
    t.el.querySelector('span').textContent = m.name;
  }
  // the unscaled size of a marker's label: measured once on a spare off-screen tag, cached by id
  const measure = document.createElement('div');
  measure.className = 'ch-tag';
  measure.style.transform = 'translate(-9999px, -9999px)';
  box.appendChild(measure);
  const sizes = new Map();
  function sizeOf(m) {
    let z = sizes.get(m.id);
    if (!z) {
      fill({ el: measure }, m);
      measure.querySelector('b').textContent = m.park ? 'Snowpark' : starText(0);
      z = [measure.offsetWidth || 120, measure.offsetHeight || 24];
      sizes.set(m.id, z);
    }
    return z;
  }
  return {
    mesh, list,
    /** R8d: the list indices of the drawn gates (instance k = list[order[k]]; R8c draws only the gates near the camera) */
    get order() { return order; },
    update, paint, reseat: seat,
    /** R7-C: move the piste gates to their start on open snow (clear.js courseGate, once the buildings are known). */
    regate(startOf) { for (const m of list) { if (!m.piste) continue; const g = gatePoint(m.piste, startOf); m.x = g.x; m.z = g.z; m.heading = g.heading; } seat(); },
    at: (x, z) => markerAt(list, x, z),
    byId: (id) => list.find((m) => m.id === id) || null,
    setVisible(v) { visible = v; mesh.visible = v; if (!v) for (const t of tags) t.el.hidden = true; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); box.remove(); },
  };
}
