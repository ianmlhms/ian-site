/* Schueberfouer Tycoon, W2: the 34 pitch outlines as painted ground markers (one draw call).
 *
 *   const pitches = await createPitches({ T, world, list });   // list = pitches.json entries { id, u, w, size, star, ... } (pitches.proposal.json until W1 ships it)
 *   pitches.setMode('outline' | 'glow' | 'off');                // subtle gold outlines (default) | every pitch glows (buildable placeholder state) | hidden
 *   pitches.setState('P01', 'locked' | 'open' | 'built');       // open = glowing gold, locked = faint outline, built = hidden (the attraction stands there)
 *   pitches.rect(id) -> { id, u, w, du, dw, y } ; pitches.pick(u, w) -> id | null ; pitches.group is added to the scene's game root by the caller
 * Sizes (DESIGN 2.2): S 8x8, M 16x16, L 30x18, XL 56x30, W 40x24 metres (du x dw), centred on (u, w).  Everything is draped on the terrain
 * through world.groundY and drawn in the game frame (no rotation needed). */
export const PITCH_SIZE = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30], W: [40, 24] };

const FALLBACK_URLS = ['/pb/fouer/pitches.json', '/pb/fouer/pitches.proposal.json'];
export async function loadPitchList() {
  for (const url of FALLBACK_URLS) {
    try { const r = await fetch(url); if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) return j; } } catch (e) { /* try the next */ }
  }
  return [];
}

const VERT = `
attribute float aState; attribute float aKind; attribute float aPhase;
varying float vState; varying float vKind; varying float vPhase;
void main() { vState = aState; vKind = aKind; vPhase = aPhase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
varying float vState; varying float vKind; varying float vPhase; uniform float uTime; uniform float uMode;
void main() {
  // vState: 0 locked (faint), 1 open (glowing), 2 built (hidden); uMode: 0 off, 1 outline, 2 glow-all
  float st = uMode > 1.5 ? 1.0 : vState;
  if (uMode < 0.5 || st > 1.5) discard;
  float pulse = 0.62 + 0.38 * sin(uTime * 2.2 + vPhase);
  vec3 gold = vec3(1.0, 0.8, 0.28);
  float a;
  if (st > 0.5) a = vKind < 0.5 ? 1.0 : 0.3 * pulse;           // open: bright gold outline + pulsing soft fill
  else a = vKind < 0.5 ? 0.55 : 0.0;                              // locked: faint outline only
  if (a <= 0.003) discard;
  gl_FragColor = vec4(gold * (st > 0.5 ? 1.0 : 0.85), a);
  #include <colorspace_fragment>
}`;

export async function createPitches({ T, world, list }) {
  const items = (list && list.length ? list : await loadPitchList());
  const rects = new Map();
  const P = []; const ST = []; const KD = []; const PH = []; const I = [];
  const ranges = new Map();           // id -> [first vertex, vertex count] (state is rewritten in place)
  const LIFT = 0.26; const EDGE = 0.34; const STEP = 3;      // polish 2: 0.16 -> 0.26 (free plots / plates lie 0.2 m above the terrain)
  items.forEach((it, n) => {
    const [du, dw] = PITCH_SIZE[it.size] || PITCH_SIZE.S;
    const r = { id: it.id, u: it.u, w: it.w, du, dw, size: it.size, star: it.star, zone: it.zone, y: world.groundY(it.u, it.w) };
    rects.set(it.id, r);
    const v0 = P.length / 3;
    const u0 = it.u - du / 2; const u1 = it.u + du / 2; const w0 = it.w - dw / 2; const w1 = it.w + dw / 2;
    const vert = (u, w, kind) => { P.push(u, world.groundY(u, w) + LIFT, w); ST.push(0); KD.push(kind); PH.push(n * 0.7); return P.length / 3 - 1; };
    // outline: a ribbon of width EDGE along the rectangle, inset so it stays inside the pitch
    const ring = [];
    const nu = Math.max(1, Math.round(du / STEP)); const nw = Math.max(1, Math.round(dw / STEP));
    for (let k = 0; k < nu; k++) ring.push([u0 + du * k / nu, w0]);
    for (let k = 0; k < nw; k++) ring.push([u1, w0 + dw * k / nw]);
    for (let k = 0; k < nu; k++) ring.push([u1 - du * k / nu, w1]);
    for (let k = 0; k < nw; k++) ring.push([u0, w1 - dw * k / nw]);
    const cu = it.u; const cw = it.w;
    const outer = ring.map(([u, w]) => { const d = Math.hypot(u - cu, w - cw) || 1; return vert(u, w, 0); });
    const inner = ring.map(([u, w]) => { const sx = Math.sign(cu - u) * (Math.abs(u - cu) > du / 2 - 0.01 ? EDGE : 0); const sz = Math.sign(cw - w) * (Math.abs(w - cw) > dw / 2 - 0.01 ? EDGE : 0); return vert(u + sx, w + sz, 0); });
    const n2 = ring.length;
    for (let k = 0; k < n2; k++) { const a = outer[k]; const b = outer[(k + 1) % n2]; const c = inner[(k + 1) % n2]; const d = inner[k]; I.push(a, b, c, a, c, d); }
    // soft fill: a coarse grid
    const gu = Math.max(1, Math.round(du / 8)); const gw = Math.max(1, Math.round(dw / 8));
    const fv = [];
    for (let j = 0; j <= gw; j++) for (let i = 0; i <= gu; i++) fv.push(vert(u0 + EDGE + (du - 2 * EDGE) * i / gu, w0 + EDGE + (dw - 2 * EDGE) * j / gw, 1));
    for (let j = 0; j < gw; j++) for (let i = 0; i < gu; i++) { const a = fv[j * (gu + 1) + i]; const b = a + 1; const c = a + gu + 1; const d = c + 1; I.push(a, c, b, b, c, d); }
    ranges.set(it.id, [v0, P.length / 3 - v0]);
  });
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  const stAttr = new T.Float32BufferAttribute(ST, 1); stAttr.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('aState', stAttr); geo.setAttribute('aKind', new T.Float32BufferAttribute(KD, 1)); geo.setAttribute('aPhase', new T.Float32BufferAttribute(PH, 1));
  geo.setIndex(P.length / 3 > 65535 ? new T.Uint32BufferAttribute(I, 1) : new T.Uint16BufferAttribute(I, 1));
  geo.computeBoundingSphere();
  const mat = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, fog: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, uniforms: { uTime: { value: 0 }, uMode: { value: 1 } } });
  const mesh = new T.Mesh(geo, mat); mesh.name = 'fouer-pitch-markers'; mesh.renderOrder = 5; mesh.frustumCulled = false;
  const group = new T.Group(); group.name = 'fouer-pitches'; group.add(mesh);
  const state = new Map(items.map((it) => [it.id, 'locked']));
  let t = 0;
  const api = {
    group, mesh, items, count: items.length,
    rect: (id) => rects.get(id) || null,
    all: () => [...rects.values()],
    mode: 'outline',
    setMode(m) { api.mode = m; mat.uniforms.uMode.value = m === 'off' ? 0 : m === 'glow' ? 2 : 1; },
    setState(id, s) {
      const r = ranges.get(id); if (!r) return;
      state.set(id, s);
      const v = s === 'built' ? 2 : s === 'open' ? 1 : 0;
      for (let k = r[0]; k < r[0] + r[1]; k++) stAttr.setX(k, v);
      stAttr.needsUpdate = true;
    },
    getState: (id) => state.get(id),
    setGlowIds(ids) { const on = new Set(ids); state.forEach((s, id) => { if (s !== 'built') api.setState(id, on.has(id) ? 'open' : 'locked'); }); },
    /** the pitch whose rectangle contains (u, w), or the nearest centre within `slack` metres */
    pick(u, w, slack = 0) {
      let best = null; let bd = 1e9;
      rects.forEach((r) => { const dx = Math.max(Math.abs(u - r.u) - r.du / 2, 0); const dz = Math.max(Math.abs(w - r.w) - r.dw / 2, 0); const d = Math.hypot(dx, dz); if (d <= slack && d < bd) { bd = d; best = r.id; } });
      return best;
    },
    update(dt) { t += dt; mat.uniforms.uTime.value = t; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
  return api;
}
