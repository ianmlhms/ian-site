/* Schueberfouer Tycoon, polish wave 2: the "free plot for rent".
 * An open (unlocked, still empty) pitch used to be bare asphalt: from above the field read as a car park with holes.  Now it looks like what it is on the real
 * Glacis: a showman's plot that is waiting for a tenant: light gravel with a darker track from the gate, a low red-white crowd barrier with an opening at the
 * front, a lit "FRÄI PLAZ" sign on two posts and a parked living trailer with crates, a generator and a skip bin.  One small model per pitch in the normal
 * model contract (origin = pitch centre, +z = front), merged into the fair's pitch batch like every other stall (no extra draw call).
 *   buildPlot({ T, rect, groundY, seed, far }) -> Group | null     rect = { id, u, w, size, face, y }  (null for the wheel pitch, which has its worksite) */
import { Builder, mulberry, shade, C, lerp, drape } from './kit.js';
import { caravan, crateStack, barrel, genset, bin, pallet, portaloo, fencePanels, cableRamp } from './clutter.js';

const SIZE = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30] };
const YAW = { '+w': 0, '-w': Math.PI, '+u': Math.PI / 2, '-u': -Math.PI / 2 };
const GRAVEL = [0xa9a493, 0x9f9a8a, 0xaea999, 0x97937f];      // light gravel, a little greyer than sand (it must not glare at night: the fair's light map lights it)
const TRACK = 0x8e8266;
const CELL = 3;
const LIFT = 0.2;                      // the drawn asphalt of the car park lies 5 cm + its bumps above the terrain mesh (ROAD_LIFT): the gravel must clear it or the asphalt shows through
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function buildPlot({ T, rect, groundY, seed = 1, far = false }) {
  const dims = SIZE[rect.size]; if (!dims) return null;
  const [du, dw] = dims; const yaw = YAW[rect.face] || 0; const cs = Math.cos(yaw); const sn = Math.sin(yaw);
  const r = mulberry(seed * 4099 + 17); const b = new Builder({ seed, rnd: r, far }); b.jit = 0.03; b.ao = false;
  /** local height of the terrain at the local point (x, z) of this pitch */
  const ly = (x, z) => groundY(rect.u + x * cs + z * sn, rect.w - x * sn + z * cs) - rect.y;
  const hx = du / 2 - 0.35; const hz = dw / 2 - 0.35;

  // ---- gravel surface: a draped grid in the `ground` channel (the grit comes from the material), big soft tone patches, a darker track with two tyre ruts from the gate to the trailer, a few puddle stains
  const CELLS = rect.size === 'L' || rect.size === 'XL' ? 4 : CELL; const nx = Math.max(2, Math.round((2 * hx) / CELLS)); const nz = Math.max(2, Math.round((2 * hz) / CELLS));
  const gx = 0;                                       // the gate is in the middle of the front (walk.js plotFence keeps the same opening)
  const GQ = { ch: 'ground' };
  const vn = (x, z, sc, sd) => { const fx = x * sc, fz = z * sc; const i = Math.floor(fx), j = Math.floor(fz); const u = fx - i, v = fz - j; const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v); return lerp(lerp(hash(i, j, sd), hash(i + 1, j, sd), su), lerp(hash(i, j + 1, sd), hash(i + 1, j + 1, sd), su), sv); };
  const gcol = (x, z) => shade(GRAVEL[(Math.floor(vn(x, z, 0.04, seed + 3) * 4)) & 3], 0.9 + 0.16 * vn(x, z, 0.09, seed + 7) + 0.05 * vn(x, z, 0.35, seed + 13));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = -hx + (2 * hx) * i / nx; const x1 = -hx + (2 * hx) * (i + 1) / nx; const z0 = -hz + (2 * hz) * j / nz; const z1 = -hz + (2 * hz) * (j + 1) / nz;
    const ya = (x, z) => ly(x, z) + LIFT;
    const A = [x0, ya(x0, z1), z1], B = [x1, ya(x1, z1), z1], Cc = [x1, ya(x1, z0), z0], D = [x0, ya(x0, z0), z0];
    b.tri(A, B, Cc, [gcol(x0, z1), gcol(x1, z1), gcol(x1, z0)], GQ); b.tri(A, Cc, D, [gcol(x0, z1), gcol(x1, z0), gcol(x0, z0)], GQ);
  }
  {   // the track from the gate: two ruts + a darker packed strip, up to the middle of the plot
    const zEnd = -hz * 0.25; const ya = (x, z) => ly(x, z) + LIFT + 0.012;
    for (const [xc, wd, k] of [[gx, 2.6, 0.84], [gx - 0.85, 0.42, 0.66], [gx + 0.85, 0.42, 0.66]]) {
      const x0 = xc - wd / 2, x1 = xc + wd / 2; const segs = 4;
      for (let q = 0; q < segs; q++) { const za = zEnd + (hz - zEnd) * q / segs; const zb = zEnd + (hz - zEnd) * (q + 1) / segs; b.quad([x0, ya(x0, zb), zb], [x1, ya(x1, zb), zb], [x1, ya(x1, za), za], [x0, ya(x0, za), za], shade(TRACK, k * (0.95 + 0.1 * hash(q, 3, seed))), GQ); }
    }
    for (let q = 0; q < 2 + (rect.size === 'XL' ? 3 : 0); q++) {   // damp patches
      const px = (hash(q, 1, seed + 11) - 0.5) * 2 * hx * 0.7; const pz = (hash(q, 2, seed + 11) - 0.5) * 2 * hz * 0.6; const rx = 1.2 + hash(q, 4, seed) * 1.6; const rz = rx * 0.6;
      const a = (x, z) => ly(x, z) + LIFT + 0.016;
      b.poly([[px - rx, a(px - rx, pz), pz], [px - rx * 0.4, a(px - rx * 0.4, pz + rz), pz + rz], [px + rx * 0.5, a(px + rx * 0.5, pz + rz * 0.9), pz + rz * 0.9], [px + rx, a(px + rx, pz), pz], [px + rx * 0.5, a(px + rx * 0.5, pz - rz), pz - rz], [px - rx * 0.4, a(px - rx * 0.4, pz - rz * 0.8), pz - rz * 0.8]].reverse(), shade(GRAVEL[0], 0.7), GQ);
    }
  }

  // ---- low red-white crowd barrier on three sides + both sides of the gate (the front has an opening)
  const fy = (x, z) => ly(x, z) + LIFT;
  const panel = (x0, z0, x1, z1, k) => {
    const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(L / 3)); const ang = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
    for (let q = 0; q < n; q++) {
      const t = (q + 0.5) / n; const x = lerp(x0, x1, t); const z = lerp(z0, z1, t);
      b.push().translate(x, fy(x, z), z).rotY(ang);
      b.box(0, 0.12, 0, L / n - 0.08, 0.86, 0.05, (q + k) & 1 ? 0xf2f2ee : 0xd8283a); b.box(0, 1.0, 0, L / n - 0.08, 0.05, 0.07, 0x9aa0a6);
      if (!far) { b.box(-(L / n) / 2 + 0.4, 0, 0, 0.05, 0.12, 0.42, 0x555a60); }
      b.pop();
    }
  };
  const gate = Math.min(4.2, du * 0.4); const gl = gx - gate / 2; const gr = gx + gate / 2;
  panel(-hx, -hz, hx, -hz, 0);                       // back
  panel(-hx, hz, -hx, -hz, 1); panel(hx, -hz, hx, hz, 0);     // sides
  panel(-hx, hz, gl, hz, 1); panel(gr, hz, hx, hz, 0);       // front, with the opening

  // ---- the sign on two posts at the left edge of the opening, lit at night
  if (!far) {
    const sx = gl - 0.2; const sz = hz - 0.15; const y0 = fy(sx, sz);
    [-1.0, 1.0].forEach((k) => b.cyl(sx + k, y0, sz, 0.04, 0.04, 1.9, 4, 0x3a3a40));
    b.sign('FRÄI PLAZ', sx, y0 + 1.55, sz + 0.06, 2.3, 0.62, { look: 0, kind: 'main', lit: true, frameW: 0.05, frame: 0x3a2a20 });
  } else {
    const sx = gl - 0.2; b.box(sx, fy(sx, hz), hz - 0.15, 2.3, 1.4, 0.1, 0xf6ead0);
  }

  // ---- the building site: a parked living trailer in a back corner, and for the bigger plots what a showman's crew has delivered (scaled like the real thing: a 6 m container,
  // 6-12 m track segments on timber bearers, steel columns in bundles, a truck crane with a 14 m boom, cable drums, a light tower)
  const left = hash(5, 5, seed) < 0.5 ? -1 : 1; const len = rect.size === 'S' ? 4.4 : 6.2;
  const cx = left * (hx - len / 2 - 0.9); const cz = -hz + 2.3; const cy = fy(cx, cz);
  b.push().translate(0, cy, 0); caravan(b, r, cx, cz, left < 0 ? 0 : Math.PI, len); b.pop();
  const put = (fn, x, z, ...a) => { b.push().translate(x, fy(x, z), z); fn(b, r, 0, 0, ...a); b.pop(); };
  const at = (x, z, yaw, fn) => { b.push().translate(x, fy(x, z), z).rotY(yaw); fn(); b.pop(); };
  if (rect.size === 'S') { put(crateStack, -left * (hx - 1.1), -hz + 1.0, 0.2); b.push().translate(-left * (hx - 1.0), fy(-left * (hx - 1.0), hz - 1.6), hz - 1.6); bin(b, 0, 0); b.pop(); }
  else {
    put(crateStack, -left * (hx - 2.2), -hz + 1.4, 0.3); put(genset, -left * (hx - 4.4), -hz + 1.2, 0.2);
    if (rect.size === 'M') { at(-left * hx * 0.3, -hz + 3.6, 0, () => trackStack(b, r, 2, 5.5)); at(left * hx * 0.2, hz * 0.2, 0.4, () => cableDrum(b, r)); }
    if (rect.size === 'L') {
      at(-left * hx * 0.45, -hz + 1.9, 0, () => container(b, r, 0x2d5a8a)); at(-left * hx * 0.1, -hz + 2.0, Math.PI / 2, () => trackStack(b, r, 3, 7.5)); at(left * hx * 0.32, -hz + 2.6, 0, () => columnBundle(b, r, 6.5));
      put(pallet, left * (hx * 0.35), -hz + 1.4, 0.1, true); put(portaloo, left * (hx - 1.0), 0.5, 0); at(-left * hx * 0.2, hz * 0.35, 0.3, () => cableDrum(b, r)); at(left * hx * 0.75, hz * 0.4, 0, () => lightTower(b));
    }
    if (rect.size === 'XL') {
      for (const k of [-1, 1]) { const x = k * hx * 0.55; b.push().translate(x, fy(x, -hz + 2.3), -hz + 2.3); caravan(b, r, 0, 0, hash(k + 9, 3, seed) < 0.5 ? 0 : Math.PI, 6.2); b.pop(); }
      at(-hx * 0.18, -hz + 2.0, 0, () => container(b, r, 0x2d5a8a)); at(hx * 0.12, -hz + 2.0, 0, () => container(b, r, 0xb8532a));
      at(-hx * 0.62, -hz * 0.1, 0, () => trackStack(b, r, 4, 11)); at(-hx * 0.62, hz * 0.18, 0, () => trackStack(b, r, 3, 11)); at(hx * 0.64, -hz * 0.05, 0.1, () => trackStack(b, r, 4, 9));
      at(hx * 0.1, hz * 0.05, Math.PI / 2, () => columnBundle(b, r, 12)); at(-hx * 0.05, hz * 0.3, Math.PI / 2, () => columnBundle(b, r, 10));
      at(hx * 0.3, -hz * 0.45, Math.PI / 2, () => truckCrane(b, r)); at(-hx * 0.3, hz * 0.62, 0.4, () => cableDrum(b, r)); at(-hx * 0.36, hz * 0.62, 0, () => cableDrum(b, r));
      at(-hx * 0.9, hz * 0.5, 0, () => lightTower(b)); at(hx * 0.9, hz * 0.5, 0, () => lightTower(b));
      put(portaloo, hx * 0.8, -hz + 1.0, 0); put(portaloo, hx * 0.8 - 1.3, -hz + 1.0, 0); at(0, hz * 0.62, 0, () => { b.box(-1.5, 0, 0, 2.8, 0.4, 1.4, 0xc9a06a); b.box(1.8, 0, 0, 2.4, 0.4, 1.2, 0xc9a06a); b.box(-1.5, 0.4, 0, 2.5, 0.9, 1.2, 0x2f7a52); });
    }
  }

  const g = b.finish({ id: 'plot-' + rect.id, look: 0, level: 1, size: dims, height: 3, kind: 'plot' });
  g.userData.plot = true;
  return g;
}

/** the slot floor of a built ride with its own materials (W4 models cannot be merged): steel plates draped on the terrain under the whole slot, as a w3 model that joins the pitch batch
 *   buildFloor({ T, rect, groundY, seed }) -> Group | null  (null for the wheel pitch) */
export function buildFloor({ T, rect, groundY, seed = 1 }) {
  const dims = SIZE[rect.size]; if (!dims) return null;
  const yaw = YAW[rect.face] || 0; const cs = Math.cos(yaw); const sn = Math.sin(yaw);
  const r = mulberry(seed * 4099 + 29); const b = new Builder({ seed, rnd: r, far: true }); b.jit = 0.03; b.ao = false;
  const ly = (x, z) => groundY(rect.u + x * cs + z * sn, rect.w - x * sn + z * cs) - rect.y;
  drape(b, dims[0] / 2 - 0.4, dims[1] / 2 - 0.4, ly, (i, j) => shade([0x9aa1a8, 0x8e949a, 0xa2a8ae, 0x858b92][(i * 3 + j * 5 + (rect.u | 0)) % 4], 0.94 + 0.12 * r()), rect.size === 'XL' ? 5 : 4, 0.18);
  const g = b.finish({ id: 'floor-' + rect.id, look: 0, level: 1, size: dims, height: 0.2, kind: 'floor' });
  return g;
}

/* ------------------------------------------------------------------ site equipment (real sizes), local frame: origin on the ground at the object's centre */
const STEEL = 0x8e949a; const TIMBER = 0xb89463;
/** a 20 ft shipping container used as a site office: ribbed sides, doors on the +z end with locking bars, a window + step */
function container(b, r, colr) {
  const w = 6.06; const h = 2.59; const d = 2.44;
  b.box(0, 0.12, 0, w, h - 0.12, d, colr, { cols: { top: shade(colr, 1.12) } }); b.box(0, 0, 0, w - 0.4, 0.14, d - 0.2, 0x2a2c30);
  for (let i = 0; i < 12; i++) { const x = -w / 2 + 0.25 + i * (w - 0.5) / 11; b.box(x, 0.18, d / 2 + 0.01, 0.1, h - 0.3, 0.04, shade(colr, 0.78)); b.box(x, 0.18, -d / 2 - 0.01, 0.1, h - 0.3, 0.04, shade(colr, 0.78)); }
  b.box(w / 2 + 0.01, 0.3, 0, 0.04, h - 0.5, d - 0.2, shade(colr, 0.9));
  for (const dz of [-0.45, 0.45]) b.box(w / 2 + 0.05, 0.4, dz, 0.05, 2.0, 0.07, 0xc9ced4);
  b.box(-w * 0.18, 1.1, d / 2 + 0.03, 1.2, 0.8, 0.05, 0x39465a); b.box(-w * 0.18, 1.1, d / 2 + 0.01, 1.3, 0.9, 0.04, 0xe9e5d8);
  b.box(-w / 2 + 0.75, 0.0, d / 2 + 0.4, 1.0, 0.18, 0.7, 0x6a6e74); b.box(-w / 2 + 0.75, 0.18, d / 2 + 0.45, 1.0, 0.18, 0.5, 0x6a6e74);
  b.box(w * 0.15, h, 0, 0.5, 0.18, 0.5, 0xc9ced4);
}
/** layers of curved coaster-track segments on timber bearers: each segment two box rails with ties, stacked n high */
function trackStack(b, r, n, segLen) {
  const wd = 1.1; const th = 0.28;
  for (const z of [-segLen * 0.4, 0, segLen * 0.4]) b.box(0, 0, z, wd + 0.5, 0.14, 0.18, TIMBER);
  for (let k = 0; k < n; k++) {
    const y = 0.14 + k * (th + 0.1); const col = [0xb8284a, 0x2d6fd0, 0x2f9a58, 0xc9a13a][Math.floor(r() * 4)]; const sc = 0.97 + k * 0.01;
    for (const x of [-wd / 2, wd / 2]) b.box(x, y, 0, 0.09, th, segLen * sc, col);
    for (let q = 0; q < 6; q++) b.box(0, y + th - 0.05, -segLen / 2 + 0.3 + q * (segLen - 0.6) / 5, wd, 0.05, 0.12, STEEL);
    b.box(0, y, 0, 0.06, 0.1, segLen * 0.96, 0x4a4f56);
    b.box(0, y + th, 0, wd * 0.12, 0.1, 0.18, TIMBER);     // the spacer timbers between the layers
  }
}
/** a bundle of steel support columns lying on bearers (2 layers of tubes) */
function columnBundle(b, r, len) {
  for (const z of [-len * 0.38, len * 0.38]) b.box(0, 0, z, 1.0, 0.12, 0.14, TIMBER);
  const cols = [0xc9ced4, 0xe6b13a, 0x2f9a58][Math.floor(r() * 3)];
  for (let k = 0; k < 6; k++) { const row = k < 3 ? 0 : 1; const x = (k % 3 - 1 + row * 0.5) * 0.3; const y = 0.2 + row * 0.26; b.beam([x, y, -len / 2], [x, y, len / 2], 0.24, cols); }
  b.box(0, 0.62, 0, 0.9, 0.04, 0.05, 0x333333);
}
/** a cable drum on its side */
function cableDrum(b, r) {
  b.push().translate(0, 0.55, 0).rotZ(Math.PI / 2); b.cyl(0, -0.4, 0, 0.55, 0.55, 0.08, 8, 0xc9a06a, { cap: true }); b.cyl(0, 0.32, 0, 0.55, 0.55, 0.08, 8, 0xc9a06a, { cap: true }); b.cyl(0, -0.32, 0, 0.3, 0.3, 0.64, 7, 0x1f1f23); b.pop();
}
/** a light tower: a 9 m mast on a trailer base with a bank of floodlights */
function lightTower(b) {
  b.box(0, 0.35, 0, 1.4, 0.3, 2.2, 0x2a2c30); b.cyl(0, 0.65, 0, 0.1, 0.07, 8.6, 5, 0xe6b13a);
  b.box(0, 9.1, 0, 1.7, 0.7, 0.2, 0x2a2c30); b.box(0, 9.15, 0.12, 1.5, 0.5, 0.05, 0xfff2d0, { ch: 'lamp' }); b.bulb(0, 9.4, 0.3, 0xfff2d0, 0.6);
  for (const [x, z] of [[-0.6, -0.9], [0.6, -0.9], [-0.6, 0.9], [0.6, 0.9]]) b.box(x, 0, z, 0.12, 0.4, 0.12, 0x555a60);
}
/** a truck crane: 3-axle chassis, cab, outriggers, a telescopic boom raised 55 degrees with a hook block */
function truckCrane(b, r) {
  b.box(0, 0.5, 0, 2.55, 0.5, 11.0, 0xe6b13a); b.box(0, 1.0, 1.2, 2.5, 1.1, 4.4, 0xd29a22); b.box(0.0, 1.0, -4.3, 2.4, 2.0, 1.9, 0xe6b13a);
  b.box(0, 1.9, -4.9, 2.3, 0.7, 0.05, 0x39465a); b.box(0, 1.0, -5.5, 2.5, 0.6, 0.12, 0xb9c0c6);
  for (const z of [-3.7, 1.5, 3.2]) for (const s of [-1, 1]) { b.push().translate(s * 1.35, 0.55, z).rotZ(Math.PI / 2); b.cyl(0, -0.15, 0, 0.55, 0.55, 0.3, 8, 0x1d1b1a, { cap: true, capColor: 0xb9c0c6 }); b.pop(); }
  for (const [x, z] of [[-1.9, -1.0], [1.9, -1.0], [-1.9, 4.4], [1.9, 4.4]]) { b.box(x, 0.3, z, 0.12, 0.3, 0.12, 0x555a60); b.box(x, 0, z, 0.7, 0.1, 0.7, 0x3a3d44); b.beam([x * 0.55, 0.7, z], [x, 0.2, z], 0.12, 0x555a60); }
  b.box(0, 2.1, 1.4, 1.9, 1.0, 2.4, 0xd29a22);
  // the boom lies low in transport position (a raised boom is a stray diagonal pole from the alley)
  const ang = 0.18; const L = 13; const bx = 0; const by = 2.6; const bz = 0.4;
  const dy = Math.sin(ang), dz = Math.cos(ang);
  [[0, 5, 0.95, 0xe6b13a], [4.4, 9, 0.72, 0xd29a22], [8.4, 13, 0.52, 0xe6b13a]].forEach(([a0, a1, t, c]) => b.beam([bx, by + dy * a0, bz + dz * a0], [bx, by + dy * a1, bz + dz * a1], t, c));
  b.beam([bx, by - 0.2, bz - 0.2], [bx, by + dy * 5 - 0.2, bz + dz * 5 - 0.2], 0.2, 0x555a60);
  const ex = by + Math.sin(ang) * L; const ez = bz + Math.cos(ang) * L;
  b.wire([bx, ex, ez], [bx, ex - 3.0, ez + 0.1], 0.04, 0x222222); b.box(bx, ex - 3.6, ez + 0.1, 0.4, 0.7, 0.3, 0x555a60); b.bulb(bx, ex + 0.5, ez, 0xff4a3a, 0.3);
}
