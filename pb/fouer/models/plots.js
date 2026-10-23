/* Schueberfouer Tycoon, polish wave 2: the "free plot for rent".
 * An open (unlocked, still empty) pitch used to be bare asphalt: from above the field read as a car park with holes.  Now it looks like what it is on the real
 * Glacis: a showman's plot that is waiting for a tenant: light gravel with a darker track from the gate, a low red-white crowd barrier with an opening at the
 * front, a lit "FRÄI PLAZ" sign on two posts and a parked living trailer with crates, a generator and a skip bin.  One small model per pitch in the normal
 * model contract (origin = pitch centre, +z = front), merged into the fair's pitch batch like every other stall (no extra draw call).
 *   buildPlot({ T, rect, groundY, seed, far }) -> Group | null     rect = { id, u, w, size, face, y }  (null for the wheel pitch, which has its worksite) */
import { Builder, mulberry, shade, C, lerp, drape } from './kit.js';
import { caravan, crateStack, barrel, genset, bin, pallet } from './clutter.js';

const SIZE = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30] };
const YAW = { '+w': 0, '-w': Math.PI, '+u': Math.PI / 2, '-u': -Math.PI / 2 };
const GRAVEL = [0xada17f, 0xa49877, 0xb4a888, 0x9c9170];      // light gravel, a little greyer than sand (it must not glare at night: the fair's light map lights it)
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

  // ---- gravel surface: a draped grid, vertex colour noise, a darker track from the gate to the trailer
  const CELLS = rect.size === 'L' || rect.size === 'XL' ? 2 : CELL; const nx = Math.max(2, Math.round((2 * hx) / CELLS)); const nz = Math.max(2, Math.round((2 * hz) / CELLS));
  const gx = 0;                                       // the gate is in the middle of the front (walk.js plotFence keeps the same opening)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = -hx + (2 * hx) * i / nx; const x1 = -hx + (2 * hx) * (i + 1) / nx; const z0 = -hz + (2 * hz) * j / nz; const z1 = -hz + (2 * hz) * (j + 1) / nz;
    const track = Math.abs((x0 + x1) / 2 - gx) < CELL * 0.6 && j >= nz / 2 - 0.5;
    const hv = hash(i, j, seed); const k = 0.9 + 0.18 * hv; const rub = hash(i * 7, j * 3, seed + 9) > 0.97; const base = track ? TRACK : rub ? 0x8a8a84 : GRAVEL[Math.floor(hash(j, i, seed + 3) * GRAVEL.length)];
    const c = shade(base, k);
    b.quad([x0, ly(x0, z1) + LIFT, z1], [x1, ly(x1, z1) + LIFT, z1], [x1, ly(x1, z0) + LIFT, z0], [x0, ly(x0, z0) + LIFT, z0], c);
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

  // ---- a parked living trailer in a back corner, crates, generator, skip bin
  const left = hash(5, 5, seed) < 0.5 ? -1 : 1; const len = rect.size === 'S' ? 4.4 : 6.2;
  const cx = left * (hx - len / 2 - 0.9); const cz = -hz + 2.3; const cy = fy(cx, cz);
  b.push().translate(0, cy, 0); caravan(b, r, cx, cz, left < 0 ? 0 : Math.PI, len); b.pop();
  const put = (fn, x, z, ...a) => { b.push().translate(x, fy(x, z), z); fn(b, r, 0, 0, ...a); b.pop(); };
  if (rect.size !== 'S') {
    put(crateStack, -left * (hx - 2.2), -hz + 1.4, 0.3); put(genset, -left * (hx - 4.4), -hz + 1.2, 0.2);
    if (rect.size === 'L' || rect.size === 'XL') { put(pallet, left * (hx * 0.35), -hz + 1.4, 0.1, true); put(crateStack, -left * (hx * 0.45), -hz + 1.6, 0.2); const sx2 = -left * hx * 0.2; b.push().translate(sx2, fy(sx2, -hz + 2.6), -hz + 2.6); b.box(0, 0, 0, 2.6, 1.1, 1.3, 0x2f7a52, { cols: { top: 0x24604a } }); b.box(0, 1.1, 0, 2.7, 0.06, 1.4, 0x3a3f46); b.pop(); }
    if (rect.size === 'XL') { for (const k of [-1, 1]) { const x = k * hx * 0.55; b.push().translate(x, fy(x, -hz + 2.3), -hz + 2.3); caravan(b, r, 0, 0, hash(k + 9, 3, seed) < 0.5 ? 0 : Math.PI, 6.2); b.pop(); } }
  } else { put(crateStack, -left * (hx - 1.1), -hz + 1.0, 0.2); b.push().translate(-left * (hx - 1.0), fy(-left * (hx - 1.0), hz - 1.6), hz - 1.6); bin(b, 0, 0); b.pop(); }

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
