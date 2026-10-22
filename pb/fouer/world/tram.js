/* Schueberfouer Tycoon, W2: the Luxtram line past the Glacis: track bed, the two stops (Theater, Faiencerie) and the passing tram (DESIGN 4.6).
 *
 * Track: the Luxtram T1 centre line (bundle header tram.pts, s 8250-9060) smoothed by a centripetal Catmull-Rom and resampled every metre, draped on the LiDAR
 * ground.  Bed = paved lane with four embedded rails (the second track is the real one beside it; the fair runs ONE track).  Built with the Luxtram ground
 * module's own accumulator + painted surface material, so it is one more mesh in the shared "painted ground" look.
 * Stops: pale granite platform 0.30 m, flat canopy shelter on slim posts, glass wall, dark benches, charcoal name plate, ticket machine, LED mast, lamp poles;
 * Theater has the ivy hedge behind, Faiencerie the low sandstone plinth with the ornate black iron railing (photos: Wikimedia Commons, internal notes only).
 * Tram: CAF Urbos look (black glazed sides, silver cab shell and roof fairing, coloured doors, C-shaped white LEDs, amber destination display), NO overhead
 * wire.  Five rigid modules baked into 3 meshes (paint, glass, lamps); every vertex carries its car index and the vertex shader applies that car's matrix
 * (the idea of luxtram-traffic.js), doors slide per side, a dithered fade makes it appear / vanish without a pop.
 * Schedule: one tram every 5-8 minutes at <= 20 km/h on the outer track, alternating direction, stops at Theater (20 s, doors open) and Faiencerie (10 s).
 * Debug / tests: tram.debug.{state(), callTram(dir), fastForward(seconds), skipTo('theater')}.  Draw calls: bed 1, stops 4, tram 3. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const SRGB = (h) => { const c = hexRGB(h).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return c; };

const LAT_OPP = -3.5;                  // the second track, to the left of the forward (outer) track
const STOPS = {
  Theater: { edge: 1.67, width: 3.23, dwell: 20, back: 'hedge' },
  'Faïencerie': { edge: 1.86, width: 3.62, dwell: 10, back: 'fence' },
};
const SPEED = 5.4;                      // m/s = 19.4 km/h  (the line is limited to 20 km/h on the fair)
const ACCEL = 0.55;
const MODULES = [8.8, 8.2, 8.2, 8.2, 8.8];
const GAP = 0.65;
const TRAM_LEN = MODULES.reduce((a, b) => a + b, 0) + GAP * (MODULES.length - 1);

class Mesh3 {
  /** defaults: extra per-vertex attributes -> default value (number or array); every vertex gets every key so the buffers stay aligned */
  constructor(defaults = {}) { this.p = []; this.n = []; this.c = []; this.i = []; this.defaults = defaults; this.extra = {}; Object.keys(defaults).forEach((k) => { this.extra[k] = []; }); }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, col, ex) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]);
    for (const k in this.defaults) { const v = ex && ex[k] !== undefined ? ex[k] : this.defaults[k]; if (Array.isArray(v)) this.extra[k].push(...v); else this.extra[k].push(v); }
    return this.p.length / 3 - 1;
  }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  /** oriented box: centre, frame (ex, ey, ez unit vectors), full sizes, one colour or per-face [+x,-x,+y,-y,+z,-z] */
  box(cx, cy, cz, ex, ey, ez, sx, sy, sz, col, ex2) {
    const faces = [[ex, 1], [ex, -1], [ey, 1], [ey, -1], [ez, 1], [ez, -1]];
    const axes = [ex, ey, ez]; const sizes = [sx / 2, sy / 2, sz / 2];
    faces.forEach(([nrm, sg], fi) => {
      const ai = axes.indexOf(nrm); const u = axes[(ai + 1) % 3]; const v = axes[(ai + 2) % 3]; const hu = sizes[(ai + 1) % 3]; const hv = sizes[(ai + 2) % 3]; const hn = sizes[ai];
      const colr = Array.isArray(col[0]) ? col[fi] : col;
      const cc = (a, b) => [cx + nrm[0] * sg * hn + u[0] * a * hu + v[0] * b * hv, cy + nrm[1] * sg * hn + u[1] * a * hu + v[1] * b * hv, cz + nrm[2] * sg * hn + u[2] * a * hu + v[2] * b * hv];
      const n = [nrm[0] * sg, nrm[1] * sg, nrm[2] * sg];
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const q = cc(a, b); return this.vert(q[0], q[1], q[2], n[0], n[1], n[2], colr, ex2); });
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) this.quad(ids[0], ids[1], ids[2], ids[3]); else this.quad(ids[0], ids[3], ids[2], ids[1]);
    });
  }
  geometry(T) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    for (const k in this.defaults) { const d = this.defaults[k]; g.setAttribute(k, new T.Float32BufferAttribute(this.extra[k], Array.isArray(d) ? d.length : 1)); }
    g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function signAtlas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#2d3135'; g.fillRect(0, 0, 512, 512);
  const plate = (y, txt) => { g.fillStyle = '#2f3438'; g.fillRect(0, y, 512, 64); g.fillStyle = '#f4f4f0'; g.font = '600 38px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 256, y + 34); };
  plate(0, 'Theater'); plate(64, 'Faïencerie');
  // TICKETS label
  g.fillStyle = '#f0f1ee'; g.fillRect(0, 128, 256, 48); g.fillStyle = '#26292c'; g.font = '700 28px Arial, sans-serif'; g.textAlign = 'left'; g.fillText('TICKETS', 14, 153);
  // LED board: amber lines on black
  g.fillStyle = '#16120c'; g.fillRect(256, 128, 256, 96); g.fillStyle = '#ff9d2e'; g.font = '600 17px "Courier New", monospace'; g.textAlign = 'left';
  ['T1  Luxexpo          3 min', 'T1  Stäreplaz        12 min', 'T1  Luxexpo         21 min'].forEach((l, k) => g.fillText(l, 262, 148 + k * 24));
  // two backlit vitrine posters (generic fairground art, no advertising): gold / red bunting, a big wheel, text
  const poster = (x, y, w, h, bg1, bg2) => {
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, bg1); gr.addColorStop(1, bg2); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.strokeStyle = '#fff3c4'; g.lineWidth = 3; g.beginPath(); g.arc(x + w / 2, y + h * 0.5, w * 0.3, 0, 7); g.stroke();
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.moveTo(x + w / 2, y + h * 0.5); g.lineTo(x + w / 2 + Math.cos(a) * w * 0.3, y + h * 0.5 + Math.sin(a) * w * 0.3); g.stroke(); }
    g.fillStyle = '#fff3c4'; g.font = '800 26px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('SCHUEBERFOUER', x + w / 2, y + h * 0.9);
    for (let k = 0; k < 9; k++) { g.fillStyle = k % 2 ? '#ffd24a' : '#e8473a'; g.beginPath(); g.moveTo(x + k * w / 9, y); g.lineTo(x + (k + 1) * w / 9, y); g.lineTo(x + (k + 0.5) * w / 9, y + 26); g.fill(); }
  };
  poster(0, 240, 250, 270, '#1d3a8a', '#7a1f6a'); poster(262, 240, 250, 270, '#0b6b5a', '#1a2c5b');
  return c;
}
const UVR = { thea: [0, 0, 1, 0.125], faen: [0, 0.125, 1, 0.25], tick: [0, 0.25, 0.5, 0.344], led: [0.5, 0.25, 1, 0.4375], poA: [0, 0.469, 0.488, 1], poB: [0.512, 0.469, 1, 1] };

export async function createTram({ T, world, bundle }) {
  const H = bundle.header; const oy = H.oy;
  const gy = world.glacis.gy; const ground = world.glacis.ground;
  const raw = H.tram.pts;

  /* ---------------------------------------------------------------- the centre line */
  const curve = new T.CatmullRomCurve3(raw.map((p) => new T.Vector3(p[0], 0, p[1])), false, 'centripetal');
  curve.arcLengthDivisions = 3000; curve.updateArcLengths();
  const lenEst = curve.getLength(); const N = Math.round(lenEst);
  const sp = curve.getSpacedPoints(N);
  const ds = lenEst / N; const s0 = raw[0][2];
  const X = new Float32Array(N + 1); const Z = new Float32Array(N + 1); const Y = new Float32Array(N + 1);
  sp.forEach((p, i) => { X[i] = p.x; Z[i] = p.z; Y[i] = gy(p.x, p.z); });
  // the rail is laid at a constant grade: smooth the LiDAR ground along s (+-7 m)
  const Ys = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) { let a = 0; let n = 0; for (let k = -7; k <= 7; k++) { const j = i + k; if (j >= 0 && j <= N) { a += Y[j]; n++; } } Ys[i] = a / n; }
  const TX = new Float32Array(N + 1); const TZ = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) { const a = Math.max(0, i - 1); const b = Math.min(N, i + 1); const dx = X[b] - X[a]; const dz = Z[b] - Z[a]; const l = Math.hypot(dx, dz) || 1; TX[i] = dx / l; TZ[i] = dz / l; }
  const track = {
    s0, ds, n: N, len: lenEst, sEnd: s0 + lenEst,
    at(s) {   // position + tangent at an s (clamped), linear interpolation
      const f = clamp((s - s0) / ds, 0, N - 1e-6); const i = Math.floor(f); const t = f - i;
      const tx = lerp(TX[i], TX[i + 1], t); const tz = lerp(TZ[i], TZ[i + 1], t); const l = Math.hypot(tx, tz) || 1;
      return { x: lerp(X[i], X[i + 1], t), z: lerp(Z[i], Z[i + 1], t), y: lerp(Ys[i], Ys[i + 1], t), tx: tx / l, tz: tz / l };
    },
    /** world position at s with a lateral offset (+ = right of travel in the +s direction) and a height above the bed */
    place(s, lat, h = 0) { const q = track.at(s); return [q.x - q.tz * lat, q.y + h, q.z + q.tx * lat]; },
  };
  // the stop s values are arc lengths of the ORIGINAL polyline: re-locate them on the smoothed one by position
  const origAt = (s) => { for (let i = 1; i < raw.length; i++) if (raw[i][2] >= s) { const a = raw[i - 1]; const b = raw[i]; const t = (s - a[2]) / (b[2] - a[2] || 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; } return [raw[raw.length - 1][0], raw[raw.length - 1][1]]; };
  const stops = H.tram.stops.map((st) => {
    const [px, pz] = origAt(st.s); let best = 0; let bd = 1e9;
    for (let i = 0; i <= N; i++) { const d = Math.hypot(X[i] - px, Z[i] - pz); if (d < bd) { bd = d; best = i; } }
    return Object.assign({ sx: s0 + best * ds }, STOPS[st.name] || { edge: 1.7, width: 3.2, dwell: 10 }, st);
  });

  const group = new T.Group(); group.name = 'fouer-tram-line';
  const surf = new ground.Acc();
  const STEEL = [0.5, 0.5, 0.53]; const FLAT = ground.MAT.FLAT; const GRAVEL = ground.MAT.GRAVEL;
  const bedLift = 0.1;

  /* ---------------------------------------------------------------- bed: paved lane + four embedded rails */
  function ribbon(sa, sb, latA, latB, lift, mat, col, step = 2) {
    const base = surf.count; const n = Math.max(1, Math.ceil((sb - sa) / step));
    for (let k = 0; k <= n; k++) {
      const s = sa + (sb - sa) * k / n; const q = track.at(s);
      const rx = -q.tz; const rz = q.tx;
      surf.vert(q.x + rx * latA, q.y + lift, q.z + rz * latA, 0, 1, 0, mat, col[0], col[1], col[2]);
      surf.vert(q.x + rx * latB, q.y + lift, q.z + rz * latB, 0, 1, 0, mat, col[0], col[1], col[2]);
    }
    for (let k = 0; k < n; k++) { const a = base + k * 2; surf.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const sA = s0 + 12; const sB = s0 + lenEst - 12;
  // the lane: pale aggregate / pea-gravel (the Allee Scheffer photos of the fair) between two narrow concrete edge strips; paving setts only on the platforms' side strips
  ribbon(sA, sB, LAT_OPP - 1.5, 1.4, bedLift, GRAVEL, [0.95, 0.93, 0.92], 3);
  ribbon(sA, sB, LAT_OPP - 1.85, LAT_OPP - 1.5, bedLift + 0.01, FLAT, [0.6, 0.59, 0.56], 3);
  ribbon(sA, sB, 1.4, 1.75, bedLift + 0.01, FLAT, [0.6, 0.59, 0.56], 3);
  [-0.7175, 0.7175].forEach((o) => [0, LAT_OPP].forEach((c) => ribbon(sA, sB, c + o - 0.035, c + o + 0.035, bedLift + 0.035, FLAT, STEEL, 2)));
  const bedMesh = surf.mesh(T, ground.matSurface, 2); bedMesh.name = 'fouer-tram-bed'; group.add(bedMesh);

  /* ---------------------------------------------------------------- stops + lamp poles
   * OSM platform ways (643119116-9, 643119117-8): at both stops there are TWO platforms, one beside each track, 46-54 m long, running from the stop position
   * (where the nose of the tram stops, = the s of the track file) back along the line: s in [s_stop - 46, s_stop]. */
  const opaque = new Mesh3(); const glass = new Mesh3(); const lamp = new Mesh3(); const signs = new Mesh3({ uv: [0, 0] });
  const col = (h) => SRGB(h);
  const C = { granite: col(0xb9b7b0), blue: col(0x8d96a3), kerb: col(0xa9a7a0), cream: col(0xeee6c9), black: col(0x1a1c1e), canopy: col(0x41484e), under: col(0xe8ecee), post: col(0xb7bec3), bench: col(0x2b2f33), white: col(0xeef0ee), pole: col(0x1d2023), hedge: [col(0x5f9a45), col(0x6aa84c), col(0x4f8a3b), col(0x78b055)], plinth: col(0xcdb98e), iron: col(0x17191b), bin: col(0x8d9296), rail: col(0x2a2d31) };
  const frameAt = (s) => { const q = track.at(s); return { q, ex: [q.tx, 0, q.tz], ey: [0, 1, 0], ez: [-q.tz, 0, q.tx] }; };
  /** a platform side: lane = the track it serves (lat offset of its centre line), dir = +1 platform on the right of the +s direction, -1 on the left */
  const SIDES = { R: { base: 0, dir: 1 }, L: { base: LAT_OPP, dir: -1 } };
  function boxAt(s, along, lat, h0, sx, sy, sz, color, mesh = opaque, ex2) {
    const f = frameAt(s + along); const p = track.place(s + along, lat, h0 + sy / 2);
    mesh.box(p[0], p[1], p[2], f.ex, f.ey, f.ez, sx, sy, sz, color, ex2);
  }
  function quadAt(mesh, s, along, lat, h0, w, h, color, uvr, facing = -1) {
    // a vertical quad (w along the track, h up) facing +lat (facing = 1) or -lat (facing = -1); uv rect [u0, v0, u1, v1] in canvas space, u reads left to right for the viewer
    const f = frameAt(s + along); const p = track.place(s + along, lat, h0);
    const nx = f.ez[0] * facing; const nz = f.ez[2] * facing;
    const a = [p[0] - f.ex[0] * w / 2 * facing, p[1], p[2] - f.ex[2] * w / 2 * facing];
    const b = [p[0] + f.ex[0] * w / 2 * facing, p[1], p[2] + f.ex[2] * w / 2 * facing];
    const [u0, v0, u1, v1] = uvr;
    const ia = mesh.vert(a[0], a[1], a[2], nx, 0, nz, color, { uv: [u0, 1 - v1] }); const ib = mesh.vert(b[0], b[1], b[2], nx, 0, nz, color, { uv: [u1, 1 - v1] });
    const ic = mesh.vert(b[0], b[1] + h, b[2], nx, 0, nz, color, { uv: [u1, 1 - v0] }); const id = mesh.vert(a[0], a[1] + h, a[2], nx, 0, nz, color, { uv: [u0, 1 - v0] });
    mesh.quad(ia, ib, ic, id);
  }
  const platformTop = 0.3; const PLAT_LEN = 46;
  function platform(st, sd, tone) {
    const S = SIDES[sd]; const sEnd = st.sPos; const sBeg = sEnd - PLAT_LEN; const e = st.edge; const w = st.width;
    const n = Math.ceil(PLAT_LEN / 1.5);
    const rows = []; for (let k = 0; k <= n; k++) rows.push(sBeg + PLAT_LEN * k / n);
    const L = (x) => S.base + S.dir * x;                      // lat from the platform-local lateral x (0 at the track centre)
    const addStrip = (xa, xb, y, color) => {
      const ids = rows.map((ss) => { const a = track.place(ss, L(xa), y); const b = track.place(ss, L(xb), y); return [opaque.vert(a[0], a[1], a[2], 0, 1, 0, color), opaque.vert(b[0], b[1], b[2], 0, 1, 0, color)]; });
      for (let k = 0; k < rows.length - 1; k++) { if (S.dir > 0) opaque.quad(ids[k][0], ids[k][1], ids[k + 1][1], ids[k + 1][0]); else opaque.quad(ids[k][0], ids[k + 1][0], ids[k + 1][1], ids[k][1]); }
    };
    const wall = (x, y0, y1, color, faceOut) => {      // faceOut: +1 faces away from the track, -1 toward it
      const nl = faceOut * S.dir;                         // normal sign in lat terms
      const ids = rows.map((ss) => { const a = track.place(ss, L(x), y0); const b = track.place(ss, L(x), y1); const f = frameAt(ss); return [opaque.vert(a[0], a[1], a[2], f.ez[0] * nl, 0, f.ez[2] * nl, color), opaque.vert(b[0], b[1], b[2], f.ez[0] * nl, 0, f.ez[2] * nl, color)]; });
      for (let k = 0; k < rows.length - 1; k++) { if (nl > 0) opaque.quad(ids[k][0], ids[k + 1][0], ids[k + 1][1], ids[k][1]); else opaque.quad(ids[k][0], ids[k][1], ids[k + 1][1], ids[k + 1][0]); }
    };
    const slab = tone === 'blue' ? C.blue : C.granite;
    addStrip(e, e + 0.36, platformTop, C.kerb);
    addStrip(e + 0.36, e + 0.42, platformTop, C.black);
    addStrip(e + 0.42, e + 0.9, platformTop, C.cream);
    addStrip(e + 0.9, e + 0.96, platformTop, C.black);
    addStrip(e + 0.96, e + w, platformTop, slab);
    wall(e, bedLift - 0.05, platformTop, C.kerb, -1);
    wall(e + w, bedLift - 0.05, platformTop, C.kerb, 1);
    [sBeg, sEnd].forEach((ss, k) => { const f = frameAt(ss); const a = track.place(ss, L(e), bedLift - 0.05); const b = track.place(ss, L(e + w), bedLift - 0.05); const a2 = track.place(ss, L(e), platformTop); const b2 = track.place(ss, L(e + w), platformTop); const sg = k ? 1 : -1; const nn = [f.ex[0] * sg, 0, f.ex[2] * sg]; const i0 = opaque.vert(a[0], a[1], a[2], nn[0], 0, nn[2], C.kerb); const i1 = opaque.vert(b[0], b[1], b[2], nn[0], 0, nn[2], C.kerb); const i2 = opaque.vert(b2[0], b2[1], b2[2], nn[0], 0, nn[2], C.kerb); const i3 = opaque.vert(a2[0], a2[1], a2[2], nn[0], 0, nn[2], C.kerb); opaque.quad(i0, i1, i2, i3); });
    return { L, sc: sBeg + PLAT_LEN / 2 };
  }
  function shelter(st, P, along, len) {
    const s = P.sc + along; const e = st.edge; const w = st.width; const top = platformTop;
    const xBack = e + w - 0.4; const xFront = e + 0.7; const h = 2.55;
    const mid = (xBack + xFront) / 2 + 0.1;
    boxAt(s, 0, P.L(mid), top + h, len, 0.14, xBack - xFront + 0.7, [C.canopy, C.canopy, C.canopy, C.under, C.canopy, C.canopy]);
    const np = Math.max(2, Math.round(len / 2.3) + 1);
    for (let k = 0; k < np; k++) { const a = -len / 2 + 0.15 + (len - 0.3) * k / (np - 1); boxAt(s, a, P.L(xBack), top, 0.07, h, 0.07, C.post); if (k === 0 || k === np - 1) boxAt(s, a, P.L(xFront), top, 0.07, h, 0.07, C.post); }
    boxAt(s, 0, P.L(xBack + 0.02), top + 0.22, len - 0.2, 2.1, 0.02, [0.18, 0.3, 0.3], glass);
    [-1, 1].forEach((sg) => boxAt(s, sg * (len / 2 - 0.05), P.L((xBack + xFront) / 2), top + 0.22, 0.02, 2.1, xBack - xFront, [0.18, 0.3, 0.3], glass));
    [-0.28, 0.28].forEach((f) => { const a = f * len; boxAt(s, a, P.L(xBack - 0.35), top + 0.5, 1.7, 0.07, 0.4, C.bench); boxAt(s, a - 0.7, P.L(xBack - 0.35), top, 0.05, 0.5, 0.35, C.post); boxAt(s, a + 0.7, P.L(xBack - 0.35), top, 0.05, 0.5, 0.35, C.post); });
    return { s, xBack, xFront };
  }
  function lampPole(s, lat, base = 0, h = 6.2, dirToward = -1) {
    boxAt(s, 0, lat, base, 0.14, h, 0.14, C.pole);
    boxAt(s, 0, lat + dirToward * 0.5, base + h - 0.1, 0.9, 0.12, 0.35, C.pole);
    boxAt(s, 0, lat + dirToward * 0.9, base + h - 0.16, 0.5, 0.06, 0.28, [1.0, 0.86, 0.55], lamp);
  }
  function furniture(st, P, sd, nameKey) {
    const e = st.edge; const w = st.width; const top = platformTop; const S = SIDES[sd]; const sc = P.sc;
    const face = -S.dir;                                         // quads face the rails
    // name plate on the shelter back
    quadAt(signs, sc, -2.0, P.L(e + w - 0.45), top + 1.95, 3.2, 0.4, [0.9, 0.9, 0.9], UVR[nameKey], face);
    // ticket machine (white box, TICKETS label, dark screen)
    boxAt(sc, 4.2, P.L(e + 1.5), top, 0.55, 1.75, 0.45, C.white);
    quadAt(signs, sc, 4.2, P.L(e + 1.5 - 0.23), top + 1.5, 0.5, 0.2, [1, 1, 1], UVR.tick, face);
    boxAt(sc, 4.2, P.L(e + 1.5 - 0.235), top + 1.05, 0.28, 0.2, 0.02, [0.05, 0.1, 0.16]);
    // backlit vitrine (mupi) at the platform end
    boxAt(sc, -12.5, P.L(e + 0.8), top, 1.25, 2.1, 0.18, [0.1, 0.11, 0.12]);
    quadAt(signs, sc, -12.5, P.L(e + 0.8 - 0.095), top + 0.2, 1.05, 1.75, [1, 1, 1], sd === 'R' ? UVR.poA : UVR.poB, face);
    // LED departure mast
    boxAt(sc, 10.5, P.L(e + 0.45), top, 0.12, 4.2, 0.12, C.pole);
    boxAt(sc, 10.5, P.L(e + 0.5), top + 3.0, 0.9, 0.55, 0.16, [0.12, 0.12, 0.13]);
    quadAt(signs, sc, 10.5, P.L(e + 0.5 - 0.085), top + 3.03, 0.8, 0.45, [1, 1, 1], UVR.led, face);
    boxAt(sc, 7.0, P.L(e + w - 0.5), top, 0.45, 0.95, 0.45, C.bin);
    [-19, 17].forEach((a) => lampPole(sc + a, P.L(e + 0.25), top, 6.2, -S.dir * 1));
  }
  function backing(st, P, kind) {
    const e = st.edge; const w = st.width; const sc = P.sc; const top = platformTop;
    if (kind === 'hedge') {
      for (let a = -23; a < 23; a += 1.1) { const hh = 2.05 + 0.12 * Math.sin(a * 2.3) + 0.08 * Math.sin(a * 5.1); boxAt(sc, a + 0.55, P.L(e + w + 0.55), top - 0.1, 1.12, hh, 0.85 + 0.1 * Math.sin(a * 3.7), C.hedge[(Math.floor((a + 23) / 1.1) * 7) % 4]); boxAt(sc, a + 0.55, P.L(e + w + 0.55), top - 0.1 + hh - 0.05, 0.9, 0.22, 0.65, C.hedge[(Math.floor((a + 23) / 1.1) * 3 + 1) % 4]); }
    } else if (kind === 'fence') {
      // low sandstone plinth + black iron railing with finials (the Notre-Dame cemetery wall, Allee Scheffer side)
      boxAt(sc, 0, P.L(e + w + 0.45), top - 0.1, PLAT_LEN, 0.75, 0.5, C.plinth);
      for (let a = -23; a <= 23; a += 0.4) boxAt(sc, a, P.L(e + w + 0.45), top + 0.62, 0.04, 1.15, 0.04, C.iron);
      boxAt(sc, 0, P.L(e + w + 0.45), top + 1.7, PLAT_LEN, 0.04, 0.04, C.iron); boxAt(sc, 0, P.L(e + w + 0.45), top + 0.7, PLAT_LEN, 0.04, 0.04, C.iron);
      for (let a = -23; a <= 23; a += 4.4) boxAt(sc, a, P.L(e + w + 0.45), top + 0.4, 0.16, 1.45, 0.16, C.plinth);
    } else if (kind === 'bars') {
      // black bar railing along the back of the platform (a cycle lane runs behind it)
      boxAt(sc, 0, P.L(e + w + 0.1), top + 1.0, PLAT_LEN, 0.05, 0.05, C.rail); boxAt(sc, 0, P.L(e + w + 0.1), top + 0.55, PLAT_LEN, 0.04, 0.04, C.rail);
      for (let a = -23; a <= 23; a += 1.6) boxAt(sc, a, P.L(e + w + 0.1), top, 0.06, 1.05, 0.06, C.rail);
    } else {
      boxAt(sc, 0, P.L(e + w + 0.1), top, PLAT_LEN, 1.15, 0.06, C.iron);   // fair fence panel
    }
  }
  const BACK = { Theater: { R: 'hedge', L: 'fence' }, 'Faïencerie': { R: 'fence', L: 'bars' } };
  stops.forEach((st) => {
    st.sPos = st.sx;
    ['R', 'L'].forEach((sd) => {
      const P = platform(st, sd, st.name === 'Faïencerie' && sd === 'L' ? 'blue' : 'granite');
      st.platform = st.platform || {}; st.platform[sd] = P;
      shelter(st, P, -3.6, 7.0); shelter(st, P, 8.6, 4.8);
      furniture(st, P, sd, st.name === 'Theater' ? 'thea' : 'faen');
      backing(st, P, (BACK[st.name] || {})[sd] || 'hedge');
    });
    st.center = st.sPos - PLAT_LEN / 2;        // where the middle of a stopped tram stands
  });
  // street lighting along the lane (outer side), generic positions every 30 m (the real ones are not in the data); not at the stops
  for (let s = s0 + 20; s < s0 + lenEst - 10; s += 30) { if (stops.some((q) => s > q.sPos - PLAT_LEN - 6 && s < q.sPos + 6)) continue; lampPole(s, 5.4, 0.0, 7); }

  const atlasTex = new T.CanvasTexture(signAtlas()); atlasTex.colorSpace = T.SRGBColorSpace; atlasTex.anisotropy = 4;
  const mOpaque = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  const mGlass = new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide });
  const mLamp = new T.MeshBasicMaterial({ vertexColors: true, fog: true });
  const mSign = new T.MeshBasicMaterial({ map: atlasTex, vertexColors: true, side: T.DoubleSide, fog: true });
  const stopMeshes = [[opaque, mOpaque, 'fouer-stops'], [glass, mGlass, 'fouer-stops-glass'], [lamp, mLamp, 'fouer-stops-lamps'], [signs, mSign, 'fouer-stops-signs']];
  stopMeshes.forEach(([m, mat, name]) => { if (!m.count) return; const mesh = new T.Mesh(m.geometry(T), mat); mesh.name = name; if (name.endsWith('glass')) mesh.renderOrder = 3; group.add(mesh); });

  /* ---------------------------------------------------------------- the tram */
  const ccol = (h) => SRGB(h);
  const CAR_DEF = { aCar: 0, aSide: 0, aDoorD: [0, 0, 0], aEnd: 0, aDest: 0, aLit: 0 };
  const paintM = new Mesh3(CAR_DEF); const glassM = new Mesh3(CAR_DEF); const lampM = new Mesh3(CAR_DEF);
  const B = { black: ccol(0x16191c), silver: ccol(0xc9cdd1), grey: ccol(0x6b7076), skirt: ccol(0x0f1113), door: ccol(0x1b3b3d), mark: ccol(0x3aa5a8), floor: ccol(0x2b2e31) };
  const HW = 1.2;                                // half width
  const carMatrixCount = MODULES.length;
  let carOff = 0; const carCentre = [];
  MODULES.forEach((l) => { carCentre.push(carOff + l / 2); carOff += l + GAP; });
  const ID = [1, 0, 0]; const IY = [0, 1, 0]; const IZ = [0, 0, 1];
  function carBox(ci, cx, cy, cz, sx, sy, sz, color, mesh, ex) { mesh.box(cx, cy, cz, ID, IY, IZ, sx, sy, sz, color, Object.assign({ aCar: ci }, ex || {})); }
  MODULES.forEach((L, ci) => {
    const x0 = -L / 2; const x1 = L / 2; const endFront = ci === 0 ? -1 : ci === MODULES.length - 1 ? 1 : 0;
    // body shell: black lower body, black glazed band, silver roof fairing, black skirt
    carBox(ci, 0, 0.62, 0, L, 0.5, 2.36, [B.skirt, B.skirt, B.black, B.skirt, B.black, B.black], paintM);          // skirt band 0.37..0.87
    carBox(ci, 0, 2.95, 0, L, 0.28, 2.3, [B.silver, B.silver, B.silver, B.grey, B.silver, B.silver], paintM);      // roof fairing
    carBox(ci, 0, 3.22, 0, L - 0.6, 0.26, 1.8, [B.silver, B.silver, ccol(0xdfe2e5), B.grey, B.silver, B.silver], paintM);
    // side glazing: continuous dark band with slim silver mullions (glass mesh in front of a dark interior wall)
    carBox(ci, 0, 1.9, 0, L - 0.1, 2.0, 2.28, [B.floor, B.floor, B.floor, B.floor, B.floor, B.floor], paintM);       // interior mass (dark, no see-through)
    [-1, 1].forEach((sd) => { carBox(ci, 0, 1.9, sd * (HW + 0.005), L - 0.1, 1.55, 0.015, [0.03, 0.045, 0.06], glassM); });
    const nm = Math.floor(L / 1.45);
    for (let k = 0; k <= nm; k++) { const x = x0 + 0.3 + (L - 0.6) * k / nm; [-1, 1].forEach((sd) => carBox(ci, x, 1.9, sd * (HW + 0.012), 0.06, 1.7, 0.03, B.silver, paintM)); }
    // doors: two double doors per module (coloured glass leaves), they slide apart per side
    const doorX = ci === 0 || ci === MODULES.length - 1 ? [L * 0.2] : [-L * 0.27, L * 0.27];
    doorX.forEach((dx) => [-1, 1].forEach((sd) => {
      [-1, 1].forEach((lf) => carBox(ci, dx + lf * 0.45, 1.5, sd * (HW + 0.03), 0.9, 2.05, 0.03, B.door, paintM, { aSide: sd, aDoorD: [lf * 0.86, 0, 0] }));
      [-1, 1].forEach((lf) => carBox(ci, dx + lf * 0.45, 2.55, sd * (HW + 0.05), 0.7, 0.18, 0.03, B.mark, paintM, { aSide: sd, aDoorD: [lf * 0.86, 0, 0] }));
      carBox(ci, dx, 1.4, sd * (HW - 0.12), 1.8, 1.9, 0.02, [1.0, 0.9, 0.68], lampM, { aLit: 1 });     // lit doorway interior, seen when the leaves slide apart
    }));
    // interior ceiling light strip seen through the windows (warm at night)
    carBox(ci, 0, 2.75, 0, L - 0.8, 0.05, 0.5, [1.0, 0.92, 0.72], lampM, { aLit: 1 });
    // LUXTRAM mark: four coloured dots + wordmark band on the black lower side
    [-1, 1].forEach((sd) => { if (ci === 2) { carBox(ci, 0, 0.62, sd * (HW + 0.01), 3.6, 0.2, 0.01, [0.8, 0.82, 0.84], paintM); } });
    // articulation: black bellows between modules
    if (ci < MODULES.length - 1) carBox(ci, L / 2 + GAP / 2, 1.9, 0, GAP + 0.3, 2.4, 2.2, B.black, paintM);
    // cab ends: sloped nose (silver shell, big dark windscreen, black lower panel, C-shaped white LEDs, amber destination display)
    if (endFront) {
      const sg = endFront; const xf = sg * (L / 2);
      // nose wedge: three stacked blocks stepping in
      carBox(ci, xf + sg * 0.22, 1.35, 0, 0.44, 2.15, 2.22, B.black, paintM);
      carBox(ci, xf + sg * 0.5, 1.95, 0, 0.45, 1.5, 2.0, B.silver, paintM);
      carBox(ci, xf + sg * 0.75, 2.45, 0, 0.35, 1.1, 1.7, B.silver, paintM);
      carBox(ci, xf + sg * 0.5, 2.0, 0, 0.1, 1.15, 1.7, [0.02, 0.035, 0.05], glassM);          // windscreen
      carBox(ci, xf + sg * 0.99, 1.6, 0, 0.04, 0.9, 1.45, [0.03, 0.045, 0.06], glassM);
      // destination display above the windscreen, C-shaped lights below
      carBox(ci, xf + sg * 1.0, 2.68, 0, 0.03, 0.2, 1.1, [1.0, 0.62, 0.15], lampM, { aEnd: sg, aDest: 1 });
      [-1, 1].forEach((sd) => { carBox(ci, xf + sg * 0.46, 1.0, sd * 0.78, 0.04, 0.34, 0.07, [1, 0.97, 0.88], lampM, { aEnd: sg }); carBox(ci, xf + sg * 0.46, 1.2, sd * 0.84, 0.04, 0.07, 0.17, [1, 0.97, 0.88], lampM, { aEnd: sg }); carBox(ci, xf + sg * 0.46, 0.8, sd * 0.84, 0.04, 0.07, 0.17, [1, 0.97, 0.88], lampM, { aEnd: sg }); });
    }
  });
  // bogies / wheels: dark boxes under the skirt
  MODULES.forEach((L, ci) => { [-1, 1].forEach((sg) => carBox(ci, sg * L * 0.3, 0.3, 0, 1.9, 0.5, 2.0, B.skirt, paintM)); });

  const uniforms = { uCars: { value: new Float32Array(carMatrixCount * 16) }, uDoorP: { value: 0 }, uDoorM: { value: 0 }, uDir: { value: 1 }, uFade: { value: 1 }, uLit: { value: 0.55 } };
  for (let i = 0; i < carMatrixCount; i++) uniforms.uCars.value.set(new T.Matrix4().elements, i * 16);
  const patch = (mat, kind) => {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCar; attribute float aSide; attribute vec3 aDoorD; attribute float aEnd; attribute float aDest; attribute float aLit;\nuniform mat4 uCars[' + carMatrixCount + ']; uniform float uDoorP; uniform float uDoorM; uniform float uDir; uniform float uLit;\nvarying float vFade;')
        .replace('void main() {', 'void main() {\nmat4 trCar = uCars[int(aCar + 0.5)];')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(trCar) * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aDoorD * (aSide > 0.0 ? uDoorP : (aSide < 0.0 ? uDoorM : 0.0));\ntransformed = (trCar * vec4(transformed, 1.0)).xyz;')
        .replace('#include <color_vertex>', '#include <color_vertex>\n' + (kind === 'lamp' ? 'if (aDest > 0.5) vColor.rgb = (aEnd * uDir > 0.0) ? vec3(1.0, 0.6, 0.12) : vec3(0.07, 0.045, 0.02);\nelse if (aEnd * uDir > 0.5) vColor.rgb = vec3(1.0, 0.97, 0.9);\nelse if (aEnd * uDir < -0.5) vColor.rgb = vec3(0.9, 0.04, 0.04);\nvColor.rgb *= mix(1.0, uLit, aLit);\n' : ''));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFade;')
        .replace('void main() {', 'void main() {\nif (uFade < 0.999 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > uFade) discard;');
    };
    mat.customProgramCacheKey = () => 'fouer-tram-' + kind;
  };
  const tPaint = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  const tGlass = new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false });
  const tLamp = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide });
  patch(tPaint, 'paint'); patch(tGlass, 'glass'); patch(tLamp, 'lamp');
  const tramGroup = new T.Group(); tramGroup.name = 'fouer-tram'; tramGroup.visible = false;
  [[paintM, tPaint, 'paint'], [glassM, tGlass, 'glass'], [lampM, tLamp, 'lamps']].forEach(([m, mat, nm]) => {
    const mesh = new T.Mesh(m.geometry(T), mat);
    mesh.frustumCulled = false; mesh.name = 'fouer-tram-' + nm; if (nm === 'glass') mesh.renderOrder = 4; tramGroup.add(mesh);
  });
  group.add(tramGroup);

  /* ---- schedule + motion */
  const S0 = s0 + 24; const S1 = s0 + lenEst - 24;           // the tram appears at / vanishes into these ends (dithered fade over 10 m)
  const st = { served: new Set(), mode: 'idle', dir: 1, pos: S0, v: 0, dwell: 0, nextAt: 40, clock: 0, runs: 0, doorP: 0, doorM: 0, stopIdx: -1, stopped: false, log: [] };
  const rng = Math.random;
  const m4 = new T.Matrix4(); const v3a = new T.Vector3(); const v3b = new T.Vector3(); const fwd = new T.Vector3(); const up = new T.Vector3(0, 1, 0); const rgt = new T.Vector3();
  const routeStops = () => stops.slice().sort((a, b) => (st.dir > 0 ? a.center - b.center : b.center - a.center));
  function start(dir) {
    st.mode = 'run'; st.served = new Set(); st.dir = dir; st.pos = dir > 0 ? S0 : S1; st.v = 0; st.stopIdx = -1; st.stopped = false; st.doorP = st.doorM = 0; st.runs++; tramGroup.visible = true; uniforms.uDir.value = dir; st.log.push({ t: st.clock, ev: 'start', dir });
  }
  function nextStop() { for (const s of routeStops()) { if (!st.served.has(s.name) && (s.center - st.pos) * st.dir > -0.5) return s; } return null; }
  function stepTram(dt) {
    if (st.mode === 'dwell') {
      st.dwell -= dt;
      const open = st.dwell > 1.5 && st.dwell < st.dwellTotal - 1.2;
      const platformIsP = st.dir > 0;                         // platform side = right of the +s direction = model +z side when moving +s
      const tgt = open ? 1 : 0;
      const k = 1 - Math.exp(-dt * 2.4);
      if (platformIsP) st.doorP += (tgt - st.doorP) * k; else st.doorM += (tgt - st.doorM) * k;
      if (st.dwell <= 0) { st.mode = 'run'; st.served.add(st.stopName); st.log.push({ t: st.clock, ev: 'depart', stop: st.stopName }); }
      return;
    }
    if (st.mode !== 'run') return;
    const ns = nextStop();
    const distStop = ns ? (ns.center - st.pos) * st.dir : 1e9;
    let vt = SPEED;
    if (ns) vt = Math.min(vt, Math.sqrt(2 * ACCEL * Math.max(0, distStop - 0.05)) + 0.15);
    const dv = clamp(vt - st.v, -ACCEL * 1.2 * dt, ACCEL * dt);
    st.v = Math.max(0, st.v + dv);
    st.pos += st.dir * st.v * dt;
    if (ns && ((ns.center - st.pos) * st.dir <= 0.12 || (distStop < 1.0 && st.v < 0.12))) {
      st.pos = ns.center; st.v = 0; st.mode = 'dwell'; st.dwellTotal = ns.dwell; st.dwell = ns.dwell; st.stopIdx = ns.sPos; st.stopName = ns.name; st.log.push({ t: st.clock, ev: 'arrive', stop: ns.name });
    }
    if (st.dir > 0 && st.pos >= S1) endRun(); else if (st.dir < 0 && st.pos <= S0) endRun();
  }
  function endRun() { st.mode = 'idle'; tramGroup.visible = false; st.v = 0; st.nextAt = st.clock + 300 + rng() * 180; st.log.push({ t: st.clock, ev: 'end' }); }
  function pose() {
    // car i: centre at pos - dir * (offset from the front of the train); the train's centre is st.pos
    for (let i = 0; i < carMatrixCount; i++) {
      const cs = st.pos + st.dir * (carCentre[i] - TRAM_LEN / 2);
      const a = track.at(cs - 3.2 * st.dir); const b = track.at(cs + 3.2 * st.dir);
      fwd.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      rgt.crossVectors(fwd, up).normalize(); const u2 = v3a.crossVectors(rgt, fwd).normalize();
      const c = track.at(cs);
      m4.makeBasis(fwd, u2, rgt); m4.setPosition(c.x, c.y + bedLift + 0.04, c.z);
      uniforms.uCars.value.set(m4.elements, i * 16);
    }
    uniforms.uDoorP.value = st.doorP; uniforms.uDoorM.value = st.doorM;
    { const dEnd = st.dir > 0 ? S1 - st.pos : st.pos - S0; const dStart = st.dir > 0 ? st.pos - S0 : S1 - st.pos; uniforms.uFade.value = clamp(Math.min(dEnd, dStart) / 10, 0, 1); }
  }
  function update(dt) {
    st.clock += dt;
    if (st.mode === 'idle' && st.clock >= st.nextAt) start(st.runs % 2 === 0 ? 1 : -1);
    stepTram(Math.min(dt, 0.1));
    if (tramGroup.visible) pose();
  }
  const api = {
    group, track, stops, tram: tramGroup, uniforms,
    update,
    setNight(k) {
      uniforms.uLit.value = 0.5 + 0.5 * k;
      mLamp.color.setScalar(0.45 + 0.55 * k); mSign.color.setScalar(0.8 + 0.2 * k); tLamp.color.setScalar(0.8 + 0.2 * k);
    },
    /** positions of the poles etc. are inside the stop meshes; trees must stay off the lane (the world asks for the exclusion polygon) */
    exclusion() {
      const L = []; const R = [];
      for (let s = s0; s <= s0 + lenEst; s += 4) { L.push(track.place(s, LAT_OPP - 2.2).filter((_, k) => k !== 1)); R.push(track.place(s, 2.2).filter((_, k) => k !== 1)); }
      return L.concat(R.reverse());
    },
    debug: {
      state: () => ({ mode: st.mode, dir: st.dir, pos: st.pos, v: st.v, speedKmh: st.v * 3.6, dwell: st.dwell, stop: st.stopName, visible: tramGroup.visible, doors: [st.doorP, st.doorM], runs: st.runs, nextIn: Math.max(0, st.nextAt - st.clock), log: st.log.slice(-12), length: TRAM_LEN, maxSpeedKmh: SPEED * 3.6, stops: stops.map((s) => ({ name: s.name, s: s.sPos, center: s.center })) }),
      callTram(dir = 1) { if (st.mode === 'idle') start(dir > 0 ? 1 : -1); },
      fastForward(seconds, step = 0.1) { for (let t = 0; t < seconds; t += step) update(step); },
      skipTo(name) {
        const norm = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); const s = stops.find((q) => norm(q.name).startsWith(norm(name).slice(0, 4))); if (!s) return null;
        if (st.mode === 'idle') start(1);
        const guard = 4000; let n = 0; while (!(st.mode === 'dwell' && st.stopName === s.name) && n++ < guard) update(0.1);
        return api.debug.state();
      },
    },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); [mOpaque, mGlass, mLamp, mSign, tPaint, tGlass, tLamp].forEach((m) => m.dispose()); atlasTex.dispose(); },
  };
  api.setNight(0);
  return api;
}
