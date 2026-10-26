/* The Schiessentümpel cascade as the real place has it: ONE sandstone ledge under the arched footbridge, several falls SIDE BY SIDE pouring over it between big dark mossy
 * boulders, into a churned white pool. Pure data and small pure functions (no THREE), shared by the game (cascade-model.js draws it, water-view.js pours the water),
 * the physics (collide) and the harness.
 *
 * The carved heightfield cannot make a vertical face (trails.js channelBed lowers the river bed in one step; the carve smooths that step into a ramp of ~3 m).
 * The ledge is a closed solid that stands over that ramp: its flat top is the water level at the lip, its front face is vertical and reaches below the pool, its bottom ring is
 * the skirt that always goes below the terrain. Local frame of the model: x = across the river (v), y = up from the lip water level, z = along the flow (u). */
import { SCHIESSENTUEMPEL } from './landmarks.js';
import { createRng } from './noise.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const LEDGE = Object.freeze({
  backU: 4.2,              // m of ledge upstream of the lip (the flat top the water slides over; its back end tapers into the river bed under the bridge)
  halfWidth: 4.6,          // m: the ledge ends in the banks on both sides
  topBelow: 0.09,          // m: the ledge top lies this far below the water level at the lip (a thin sheet of water runs over it)
  sheetHalfLip: 3.55,      // m: half width of the water sheet at the lip
  sheetHalfBack: 2.3,      // m: and where it leaves the river channel upstream
  poolRadiusU: 6.4, poolRadiusV: 4.9,  // m: the plunge pool (an ellipse in front of the face)
  poolCentreU: 3.4,        // m downstream of the face
  faceScanStep: 0.2, faceMin: 1.6, faceMax: 4.6,
  baseBelow: 1.4,          // m: the solid reaches this far below the pool level (and the skirt goes lower still)
});

/** The parallel falls, from the left (-v) to the right bank: centre v (m across), width w (m), lip offset (m: the lip of this chute is lower than the sheet by this much) and
 *  the boulders between them: centre v, half width, how high the top stands above the lip level, depth along the flow, and the seed of the shape. */
export const CHUTES = Object.freeze([
  { v: -2.45, w: 1.0, dip: 0.34 },
  { v: -0.45, w: 1.35, dip: 0.14 },
  { v: 1.4, w: 0.95, dip: 0.24 },
  { v: 2.85, w: 0.6, dip: 0.46 },
]);
export const BOULDERS = Object.freeze([
  { v: -4.0, rv: 1.55, rz: 1.5, up: 1.05, seed: 0.13 },        // the big dark flank on the left
  { v: -1.42, rv: 0.78, rz: 1.2, up: 1.3, seed: 0.31 },
  { v: 0.62, rv: 0.68, rz: 1.15, up: 0.85, seed: 0.52 },
  { v: 2.2, rv: 0.55, rz: 1.0, up: 0.95, seed: 0.68 },
  { v: 4.15, rv: 1.35, rz: 1.5, up: 1.15, seed: 0.87 },        // and on the right
]);
/** Loose stones in the pool in front of the face: centre (v, u past the face), radius. */
export const POOL_STONES = Object.freeze([
  { v: -3.1, u: 2.5, r: 0.62, seed: 0.21 }, { v: 3.4, u: 2.9, r: 0.5, seed: 0.44 }, { v: 0.9, u: 6.3, r: 0.45, seed: 0.77 }, { v: -1.9, u: 5.4, r: 0.38, seed: 0.9 },
]);

/** Finds the cascade on the carved network: the river sample at the lip, the local frame, the water levels, the position of the face. Returns null when the river is not found.
 *  { x, z, yaw, f: [fx, fz], a: [ax, az], lipY, poolY, drop, faceU, first, last (sample indices of the ledge stretch), ... } */
export function placeCascade(network, surface) {
  const S = network.samples;
  const spec = SCHIESSENTUEMPEL.cascade;
  let way = null, best = 1e18, at = -1;
  for (const info of network.ways) {
    if (info.kind !== 'river') continue;
    for (let i = info.first; i < info.first + info.count; i++) {
      const d = (S.px[i] - SCHIESSENTUEMPEL.x) ** 2 + (S.pz[i] - SCHIESSENTUEMPEL.z) ** 2;
      if (d < best) { best = d; way = info; at = i; }
    }
  }
  if (!way || best > 25 * 25) return null;
  const dir = S.water[at] >= S.water[Math.min(way.first + way.count - 1, at + spec.span)] ? 1 : -1;        // +1: the flow runs along the way
  const foot = at + dir * spec.span;
  if (foot < way.first || foot >= way.first + way.count) return null;
  const tx = -S.nz[at] * dir, tz = S.nx[at] * dir;                   // flow direction
  const ax = S.nx[at] * dir, az = S.nz[at] * dir;                    // across (the model's +x)
  const lipY = S.water[at], poolY = S.water[foot];
  const x = S.px[at], z = S.pz[at];
  // the face: where the carved ramp has dropped to the pool level (+ a hand), seen along the river axis
  let faceU = LEDGE.faceMax;
  for (let u = LEDGE.faceMin; u < LEDGE.faceMax; u += LEDGE.faceScanStep) { if (surface.height(x + tx * u, z + tz * u) <= poolY - 0.02) { faceU = u; break; } }
  const first = Math.min(at - dir * 2, at), last = Math.max(foot + dir * 1, foot);
  return Object.freeze({
    x, z, yaw: Math.atan2(-az, ax), f: [tx, tz], a: [ax, az], lipY, poolY, drop: lipY - poolY, faceU, dir,
    sampleLo: Math.min(at - dir, at + dir * 2), sampleHi: Math.max(at - dir, at + dir * 2),       // the ribbon segments between these samples (the drop: inside the ledge) are replaced by the sheet, the falls and the pool of the landmark
    at, foot, spec, first, last,
  });
}

/** (u, v) of a world point in the cascade frame (u along the flow from the lip, v across). */
export function toLocal(c, x, z, out = { u: 0, v: 0 }) {
  const dx = x - c.x, dz = z - c.z;
  out.u = dx * c.f[0] + dz * c.f[1]; out.v = dx * c.a[0] + dz * c.a[1];
  return out;
}
/** World position of a local (u, v). */
export function toWorld(c, u, v, out = { x: 0, z: 0 }) {
  out.x = c.x + c.f[0] * u + c.a[0] * v; out.z = c.z + c.f[1] * u + c.a[1] * v;
  return out;
}

/** The falls as water-view.js wants them (the shape findFalls returns): where each chute pours over the face. */
export function cascadeFalls(c) {
  const out = [];
  const faceU = c.faceU - 0.2;                                  // the water leaves the lip in the recess between the boulders
  for (const ch of CHUTES) {
    const p = toWorld(c, faceU, ch.v);
    out.push({ x: p.x, z: p.z, nx: c.a[0], nz: c.a[1], fx: c.f[0], fz: c.f[1], top: c.lipY - ch.dip + 0.02, bottom: c.poolY + 0.05, width: ch.w, landmark: true });
  }
  return out;
}

/** Collision of the ledge for a bike in free ride (nobody rides up or down a waterfall): the rectangle of the ledge, from 1.2 m before the lip to the foot of the face.
 *  Returns out { nx, nz, pen } (push direction in the world) or null. `y` is the bike height. */
const local = { u: 0, v: 0 };
export function cascadeCollide(c, x, z, r, y, out) {
  if (!c) return null;
  toLocal(c, x, z, local);
  const u0 = -1.2, u1 = c.faceU + 0.5, vMax = LEDGE.halfWidth - 0.4;
  if (Math.abs(local.v) > vMax + r || local.u < u0 - r || local.u > u1 + r) return null;
  if (y > c.lipY + 1.2) return null;                           // far above (a jump over the pool): not a wall
  const toBack = local.u - (u0 - r), toFront = (u1 + r) - local.u;
  const front = toFront < toBack;
  out.pen = Math.min(toBack, toFront);
  out.nx = c.f[0] * (front ? 1 : -1); out.nz = c.f[1] * (front ? 1 : -1);
  return out;
}

/** Heights of the ledge top (relative to the lip water level) at local (u, v): flat, dipping in every chute towards the lip. Shared by the model and the harness. */
export function ledgeTop(u, v) {
  let dip = 0;
  for (const ch of CHUTES) {
    const across = Math.exp(-((v - ch.v) * (v - ch.v)) / (2 * (ch.w * 0.42) ** 2));
    const along = Math.min(1, Math.max(0, (u + 1.8) / 1.8));
    dip = Math.max(dip, across * along * ch.dip);
  }
  return -LEDGE.topBelow - dip - 0.55 * (1 - smoothstep(-LEDGE.backU, -LEDGE.backU + 2.2, u));
}

/** The water of the landmark, as ribbon-shader geometry (aux = lateral -1..1, metres along the flow, slope 0..1, end fade 0..1): the sheet that slides over the ledge (it widens from the
 *  river channel to the lip) and the plunge pool in front of the face (a disc with a soft rim). World coordinates. Returns [{ positions, normals, aux, indices }]. */
export function buildCascadeWater(c) {
  const out = [];
  const w = { x: 0, z: 0 };
  // the sheet
  {
    const pos = [], nor = [], aux = [], idx = [];
    const U0 = -LEDGE.backU - 1.6, U1 = c.faceU - 0.12, NU = 16, NV = 40;
    for (let i = 0; i <= NU; i++) {
      const u = U0 + ((U1 - U0) * i) / NU;
      const half = LEDGE.sheetHalfBack + (LEDGE.sheetHalfLip - LEDGE.sheetHalfBack) * smoothstep(U0, 0, u);
      const slope = 0.12 + 0.5 * smoothstep(-1.5, 0, u);
      const fade0 = smoothstep(U0, U0 + 1.4, u);
      const funnel = 1 - smoothstep(-2.6, c.faceU - 0.6, u);            // upstream the whole width is water; towards the lip it gathers into the chutes (the boulders stand in between)
      for (let j = 0; j <= NV; j++) {
        const lat = -1 + (2 * j) / NV, v = lat * half;
        let inChute = 0;
        for (const ch of CHUTES) inChute = Math.max(inChute, 1 - smoothstep(ch.w * 0.5, ch.w * 0.5 + 0.35, Math.abs(v - ch.v)));
        const fade = fade0 * (funnel + (1 - funnel) * inChute);
        toWorld(c, u, v, w);
        pos.push(w.x, c.lipY + 0.015, w.z); nor.push(0, 1, 0); aux.push(lat, u + 40, slope, fade);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + 1, d = a + NV + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    out.push({ positions: Float32Array.from(pos), normals: Float32Array.from(nor), aux: Float32Array.from(aux), indices: Uint32Array.from(idx) });
  }
  // the pool
  {
    const pos = [], nor = [], aux = [], idx = [];
    const RINGS = 7, SPOKES = 24, cu = c.faceU + LEDGE.poolCentreU;
    toWorld(c, cu, 0, w);
    pos.push(w.x, c.poolY + 0.02, w.z); nor.push(0, 1, 0); aux.push(0, cu + 40, 0, 1);
    for (let r = 1; r <= RINGS; r++) {
      const k = r / RINGS;
      for (let s = 0; s < SPOKES; s++) {
        const th = (s / SPOKES) * 2 * Math.PI;
        const u = cu + Math.cos(th) * LEDGE.poolRadiusU * k, v = Math.sin(th) * LEDGE.poolRadiusV * k;
        toWorld(c, u, v, w);
        pos.push(w.x, c.poolY + 0.02, w.z); nor.push(0, 1, 0); aux.push(k * 0.5, u + 40, 0, 1 - smoothstep(0.68, 1, k));
      }
    }
    for (let s = 0; s < SPOKES; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SPOKES));
    for (let r = 1; r < RINGS; r++) {
      for (let s = 0; s < SPOKES; s++) {
        const a = 1 + (r - 1) * SPOKES + s, b = 1 + (r - 1) * SPOKES + ((s + 1) % SPOKES), d = 1 + r * SPOKES + s, e = 1 + r * SPOKES + ((s + 1) % SPOKES);
        idx.push(a, d, b, b, d, e);
      }
    }
    out.push({ positions: Float32Array.from(pos), normals: Float32Array.from(nor), aux: Float32Array.from(aux), indices: Uint32Array.from(idx) });
  }
  return out;
}

const BANK_SEED = 2711;
const RIDDEN = ['trail', 'path', 'track'];
const KEEP_CLEAR = 2.4;          // m from a way to the edge of a boulder
const BRIDGE_ZONE_U = -0.6, BRIDGE_ZONE_V = 7.6;       // m: upstream of this (u) and within this across (v) the stone bridge stands
/** Big mossy boulders along both banks of the ledge and the pool (the real place is a chaos of dark boulders): [{ u, v, rx, ry, rz, seed }] in the cascade frame, placed at the water line
 *  (found by scanning the terrain outwards from the river axis) and a little up the slope. Pure and deterministic (surface = the physics surface). */
export function bankBoulders(c, surface, network = null) {
  const S = network ? network.samples : null;
  const ridden = network ? network.ways.filter((info) => RIDDEN.includes(info.kind)) : [];
  const onWay = (x, z, reach) => { for (const info of ridden) for (let i = info.first; i < info.first + info.count; i++) if (Math.abs(S.px[i] - x) < reach && Math.abs(S.pz[i] - z) < reach && Math.hypot(S.px[i] - x, S.pz[i] - z) < reach) return true; return false; };
  const rng = createRng(BANK_SEED);
  const out = [], w = { x: 0, z: 0 };
  const uEnd = c.faceU + LEDGE.poolCentreU + LEDGE.poolRadiusU + 3;
  for (let u = -0.8; u < uEnd; u += 1.25 + rng() * 0.9) {
    for (const side of [-1, 1]) {
      const level = u < c.faceU ? c.lipY - 0.5 : c.poolY + 0.45;
      let edge = 1.2;
      while (edge < 9.5) { toWorld(c, u, side * edge, w); if (surface.height(w.x, w.z) >= level) break; edge += 0.4; }
      if (edge >= 9.5) continue;
      const size = 0.55 + rng() * rng() * 1.5 + (rng() < 0.18 ? 0.8 : 0);
      const v = side * (edge + (rng() - 0.3) * 2.4 + size * 0.3);
      if (u < BRIDGE_ZONE_U && Math.abs(v) < BRIDGE_ZONE_V) continue;
      if (u < c.faceU + 0.6 && Math.abs(v) < 5.3) continue;                        // (the big boulders of the ledge stand there)
      const b = { u: u + (rng() - 0.5) * 0.8, v, rx: size * (1 + 0.3 * rng()), ry: size * (0.65 + 0.3 * rng()), rz: size, seed: rng() };
      toWorld(c, b.u, b.v, w);
      if (!onWay(w.x, w.z, b.rz + KEEP_CLEAR)) out.push(b);                         // nobody rides or walks through a boulder: they keep clear of every way
    }
  }
  return out;
}
