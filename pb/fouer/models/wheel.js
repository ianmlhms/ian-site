/* Schueberfouer Tycoon, W4a: the Riserad (item `wheel`, pitch "W", 50 m big wheel).  DESIGN 3.3.
 *
 *   import { MODELS } from './wheel.js';   MODELS.wheel.build({ look, level, quality, seed }) -> THREE.Group (name 'wheel')
 *
 * Local frame: origin = pitch centre on the ground, +z = front (boarding side).  The wheel disc stands in the x/y plane (axle along z), so on
 * pitch "W" (face "+u", 40 x 24 m) the group is rotated by +PI/2 about y: local x spans the 24 m (w) side, local z the 40 m (u) side.
 * Ground footprint: x +-12, z -10 .. +20 (the rim sweeps further out, only high above the ground).
 *
 * Meshes (one shared lit material, see big-kit.js): near = static (legs, braces, decks, station, queue, dressing), rotor (rims, 2 x 20 lattice spokes,
 * hub, sunburst; rotates about the axle), gondolas (44 cabins, CPU-moved so they stay upright), cables (LineSegments, rotates with the rotor).
 * far (quality low or > 80 m) = the same four with a lean geometry.  Both rotate; `setAnimated(false)` freezes it.
 *
 * userData API: animate(t, dt, nightK), setNight(k), setLOD(0|1), setAnimated(bool), gondolaAnchor(i),
 *   ride = { count, period, speed, angle(), setAngle(a), boardingIndex(), board(), setGondolaVisible(i, on) }
 * gondolaAnchor(i) -> { index, position (cabin floor, world), eye (head height, world), pivot (hanger point), quaternion (always the group's yaw: upright), matrix, up, forward, angle } */
import { makeKit, finishModel, rng, clamp, lerp, smooth, bulb, flag, sheep, glassWin } from './big-kit.js';

export const WHEEL_SPEC = Object.freeze({
  hubY: 26.4, rimR: 23.9, gondolaR: 23.4, faceZ: 1.15, spokes: 20, gondolas: 44, period: 120, footprint: Object.freeze({ x: 12, zMin: -10, zMax: 20 }),
});

const PAL = [
  { // 0 Traditioun: the real Riserad colours (yellow rim, green/white legs, orange-red sunburst) with gilt/red/cream station
    rim: 0xf4c70f, rimLed: [[1, 0.6, 0.03], [1, 0.4, 0.02]], truss: 0xf2f3ee, legA: 0x2c9a55, legB: 0xf5f5ef, legLed: [0.05, 1, 0.6], hubFace: 0xf08a22, hubRing: [0.2, 0.9, 0.42], hubStar: 0xfff1c8,
    blades: [[1, 0.06, 0.02], [1, 0.3, 0.03], [1, 0.62, 0.05]], gBody: 0x2e8d4f, gBand: 0xe3b86a, gRoof: 0xa9c1a0, gPanel: [1, 0.42, 0.05], trim: 0xe7b53b, gTrim: 0xe07a2c, deck: 0x8b9094,
    booth: 0xefe3c2, boothRoof: 0xa2272b, signPanel: [1, 0.55, 0.12], bulb: [1, 0.85, 0.5], cable: 0x9aa4ac, flag: 0x2c9a55, plinth: 0x7a3f33,
  },
  { // 1 Neon: cyan / magenta / violet LED
    rim: 0x5b2bd0, rimLed: [[0.1, 0.9, 1], [1, 0.1, 0.8]], truss: 0xe8e4ff, legA: 0xc7168e, legB: 0xf0eaff, legLed: [0.2, 0.95, 1], hubFace: 0x4a1fb0, hubRing: [0.1, 0.9, 1], hubStar: 0xd8f8ff,
    blades: [[1, 0.1, 0.75], [0.55, 0.2, 1], [0.1, 0.9, 1]], gBody: 0x4a2a9c, gBand: 0xd7c8ff, gRoof: 0xe6e0ff, gPanel: [0.2, 0.9, 1], trim: 0x40e8ff, gTrim: 0x40e8ff, deck: 0x6f6a86,
    booth: 0x2a1a66, boothRoof: 0xc7168e, signPanel: [0.15, 0.9, 1], bulb: [0.4, 0.9, 1], cable: 0x9a90c8, flag: 0x4a2a9c, plinth: 0x2a1a66,
  },
  { // 2 Retro: blue / white Bavarian lozenge, warm bulbs
    rim: 0xf4f2ea, rimLed: [[1, 0.82, 0.5], [0.75, 0.88, 1]], truss: 0xf4f4f0, legA: 0x2f64b8, legB: 0xf6f6f2, legLed: [1, 0.85, 0.5], hubFace: 0x2f64b8, hubRing: [1, 0.86, 0.5], hubStar: 0xffffff,
    blades: [[1, 0.78, 0.4], [0.7, 0.85, 1], [1, 0.95, 0.8]], gBody: 0x2f64b8, gBand: 0xf6f6f2, gRoof: 0xf4f4f0, gPanel: [1, 0.82, 0.45], trim: 0xcfe0f6, gTrim: 0xcfe0f6, deck: 0x8d9296,
    booth: 0xf2f0e6, boothRoof: 0x2f64b8, signPanel: [1, 0.84, 0.5], bulb: [1, 0.85, 0.5], cable: 0xa3acb4, flag: 0x2f64b8, plinth: 0x2f64b8,
  },
];
const GOLD = 0xf0c24a;
const GREY = 0x5c6166;
const STEEL = 0xb9bec2;

function ang(i, n) { return (i / n) * Math.PI * 2; }

function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const S = WHEEL_SPEC; const R = rng(opts.seed || 1);
  const wantNear = quality !== 'low';
  const cfg = { look, level, quality, pal, S, R, high: quality === 'high' };
  const nearGroup = wantNear ? new T.Group() : null;
  const farGroup = new T.Group();
  const parts = {};
  if (wantNear) Object.assign(parts, { near: assemble(T, K, cfg, 'near', nearGroup) });
  parts.far = assemble(T, K, cfg, 'far', farGroup);

  const gondolaCount = S.gondolas;
  const state = { angle: 0, speed: 1, acc: 0 };
  const hidden = new Set();
  const hub = [0, S.hubY, 0];
  const pivotAt = (i, a) => { const x = Math.sin(a + ang(i, gondolaCount)) * S.gondolaR; const y = Math.cos(a + ang(i, gondolaCount)) * S.gondolaR; return [x, hub[1] + y]; };

  const update = (p, t, dt, k, lod) => {
    p.rotor.rotation.z = -state.angle;
    if (p.cables) p.cables.rotation.z = -state.angle;
    const m = new T.Matrix4();
    for (let i = 0; i < gondolaCount; i++) {
      const base = p.gBase[i]; const cur = pivotAt(i, state.angle);
      if (hidden.has(i)) m.makeScale(0, 0, 0); else m.makeTranslation(cur[0] - base[0], cur[1] - base[1], 0);
      p.gDyn.set(i, m);
    }
    p.gDyn.commit();
    if (p.chase && (p.chaseT === undefined || t - p.chaseT > 0.05)) { p.chaseT = t; p.chase(t, k, state.angle); }
  };
  const integrate = (dt) => { state.angle = (state.angle + dt * state.speed * Math.PI * 2 / S.period) % (Math.PI * 2); };
  let lastT = -1;
  const step = (t, dt) => { if (t !== lastT) { integrate(dt); lastT = t; } };

  const group = finishModel(T, K, {
    id: 'wheel', near: nearGroup, far: farGroup, footprint: { x: S.footprint.x, zMin: S.footprint.zMin, zMax: S.footprint.zMax }, height: 50.4, lodDistance: 85,
    animateNear: (t, dt, k) => { step(t, dt); update(parts.near, t, dt, k, 1); },
    animateFar: (t, dt, k) => { step(t, dt); update(parts.far, t, dt, k, 0); },
    onNight: () => {},
  });
  // park the gondolas for the first frame (upright, at angle 0)
  if (parts.near) update(parts.near, 0, 0, 0, 1);
  update(parts.far, 0, 0, 0, 0);

  const ud = group.userData;
  const upQ = new T.Quaternion(); const tmpV = new T.Vector3();
  ud.gondolaAnchor = (i) => {
    const n = ((i % gondolaCount) + gondolaCount) % gondolaCount;
    group.updateMatrixWorld(true);
    const [px, py] = pivotAt(n, state.angle);
    const pivot = new T.Vector3(px, py, 0);
    const floor = pivot.clone().add(tmpV.set(0, -1.8, 0)); const eye = pivot.clone().add(tmpV.set(0, -0.7, 0));
    const matrix = new T.Matrix4();
    group.getWorldQuaternion(upQ);
    const world = (v) => v.clone().applyMatrix4(group.matrixWorld);
    matrix.compose(world(floor), upQ.clone(), new T.Vector3(1, 1, 1));
    return { index: n, position: world(floor), eye: world(eye), pivot: world(pivot), quaternion: upQ.clone(), matrix, up: new T.Vector3(0, 1, 0).applyQuaternion(upQ), forward: new T.Vector3(0, 0, 1).applyQuaternion(upQ), angle: state.angle + ang(n, gondolaCount) };
  };
  ud.ride = {
    /** hide / show one cabin (the first-person camera sits inside it: W6 hides it for the ride, shows it again afterwards) */
    setGondolaVisible: (i, on) => { if (on) hidden.delete(i); else hidden.add(i); if (parts.near) update(parts.near, 0, 0, ud.nightK, 1); update(parts.far, 0, 0, ud.nightK, 0); },
    count: gondolaCount, period: S.period, get speed() { return state.speed; }, set speed(v) { state.speed = v; },
    angle: () => state.angle, setAngle: (a) => { state.angle = a; if (parts.near) update(parts.near, 0, 0, ud.nightK, 1); update(parts.far, 0, 0, ud.nightK, 0); },
    /** gondola currently closest to the boarding platform (lowest point) */
    boardingIndex: () => { let best = 0; let bd = 9; for (let i = 0; i < gondolaCount; i++) { const a = (state.angle + ang(i, gondolaCount)) % (Math.PI * 2); const d = Math.abs(a - Math.PI); if (d < bd) { bd = d; best = i; } } return best; },
    /** where the player boards: the platform centre (world) and its interact radius */
    board: () => { group.updateMatrixWorld(true); return { position: new T.Vector3(0, 0.75, 5.2).applyMatrix4(group.matrixWorld), radius: 6 }; },
  };
  ud.hubWorld = () => { group.updateMatrixWorld(true); return new T.Vector3(0, S.hubY, 0).applyMatrix4(group.matrixWorld); };
  ud.parts = parts;
  ud.tier = { look, level, quality };
  return group;
}

/* ------------------------------------------------------------------------------------------------------------------ assembly */
function assemble(T, K, cfg, detail, root) {
  const near = detail === 'near';
  const out = {};
  // static
  { const b = K.builder(); const handles = buildStatic(b, cfg, near); const m = b.mesh('wheel-static-' + detail); root.add(m); out.static = m; out.staticLed = handles; if (handles.legLed) handles.legLedFx = K.lampDynamic(m.geometry); }
  // rotor + cables
  { const b = K.builder(); const h = buildRotor(b, cfg, near, K); const rotor = new T.Group(); rotor.position.set(0, cfg.S.hubY, 0);
    const m = b.mesh('wheel-rotor-' + detail); rotor.add(m); root.add(rotor); out.rotor = rotor; out.rotorMesh = m;
    if (b.hasLines) { const l = b.lines('wheel-cables-' + detail); const cr = new T.Group(); cr.position.copy(rotor.position); cr.add(l); root.add(cr); out.cables = cr; }
    const fx = K.lampDynamic(m.geometry);
    out.chase = (t, k) => { chaseRotor(K, m.geometry, h, cfg, t, k); fx.commit(); if (out.staticLed.legLed && cfg.level >= 3) { chaseLegs(K, out.static.geometry, out.staticLed, cfg, t, k); out.staticLed.legLedFx.commit(); } };
  }
  // gondolas
  { const b = K.builder(); const g = buildGondolas(b, cfg, near); const m = b.mesh('wheel-gondolas-' + detail); root.add(m);
    out.gondolaMesh = m; out.gBase = g.base; out.gDyn = K.dynamic(m.geometry, g.ranges, cfg.S.rimR + 4); }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ rotor */
function buildRotor(b, cfg, near, K) {
  const { pal, S, level } = cfg; const P = b.P; const L = b.L; const gold = level >= 4;
  const NR = near ? (cfg.high ? 128 : 80) : 48;
  const h = { rimLed: [], blades: [], spokeLed: [] };
  const rIn = S.rimR - 0.3; const rOut = S.rimR + 0.3; const half = 0.25;
  const rimCol = pal.rim; const rimInner = gold ? GOLD : rimCol;
  for (const s of [1, -1]) {
    const zc = s * S.faceZ;
    for (let j = 0; j < NR; j++) {
      const a0 = ang(j, NR); const a1 = ang(j + 1, NR);
      const c0 = Math.sin(a0); const d0 = Math.cos(a0); const c1 = Math.sin(a1); const d1 = Math.cos(a1);
      const pt = (r, a, z) => [Math.sin(a) * r, Math.cos(a) * r, z];
      // outer, inner, front (z+half), back (z-half)
      P.quad(pt(rOut, a0, zc - half), pt(rOut, a1, zc - half), pt(rOut, a1, zc + half), pt(rOut, a0, zc + half), rimCol);
      P.quad(pt(rIn, a0, zc - half), pt(rIn, a1, zc - half), pt(rIn, a1, zc + half), pt(rIn, a0, zc + half), rimInner);
      P.quad(pt(rIn, a0, zc + half), pt(rIn, a1, zc + half), pt(rOut, a1, zc + half), pt(rOut, a0, zc + half), rimCol);
      if (cfg.high) P.quad(pt(rIn, a0, zc - half), pt(rIn, a1, zc - half), pt(rOut, a1, zc - half), pt(rOut, a0, zc - half), rimCol);
      // LED strips: on the outer face and on the outward z face
      const col = pal.rimLed[j % 2];
      const lw = 0.2; const rM = (rIn + rOut) / 2; const eps = 0.03;
      const n0 = b.count;
      L.quad(pt(rOut + eps, a0, zc - lw), pt(rOut + eps, a1, zc - lw), pt(rOut + eps, a1, zc + lw), pt(rOut + eps, a0, zc + lw), col);
      if (near || j % 2 === 0) L.quad(pt(rM - lw, a0, zc + s * (half + eps)), pt(rM - lw, a1, zc + s * (half + eps)), pt(rM + lw, a1, zc + s * (half + eps)), pt(rM + lw, a0, zc + s * (half + eps)), col);
      if (near) { const n1 = b.count; L.quad(pt(rIn - eps, a0, zc - lw), pt(rIn - eps, a1, zc - lw), pt(rIn - eps, a1, zc + lw), pt(rIn - eps, a0, zc + lw), pal.rimLed[(j + 1) % 2]); }
      h.rimLed.push({ s: n0, n: b.count - n0, j });
    }
  }
  // dense warm rim bulbs (the real Riserad's rim is a chain of yellow bulbs): one row on each outer edge, they get their own bloom points
  if (near) { const nb = cfg.high ? 168 : 132; for (const s of [1, -1]) for (let j = 0; j < nb; j++) { const a = ang(j, nb); bulb(b, [Math.sin(a) * (S.rimR + 0.34), Math.cos(a) * (S.rimR + 0.34) - 0.08, s * (S.faceZ + half + 0.1)], 0.16, pal.bulb); } }
  // gondola axles between the two rims
  if (near) {
    for (let i = 0; i < S.gondolas; i++) { const a = ang(i, S.gondolas); const x = Math.sin(a) * S.gondolaR; const y = Math.cos(a) * S.gondolaR; P.beam([x, y, -S.faceZ], [x, y, S.faceZ], 0.16, STEEL); }
  }
  // spokes: 20 lattice trusses per face
  const NS = S.spokes; const r0 = 2.7; const r1 = S.rimR - 0.2; const T2 = b.G([0.7, 0.74, 0.8]);
  for (const s of [1, -1]) {
    const zc = s * S.faceZ;
    for (let i = 0; i < NS; i++) {
      const a = ang(i, NS); const ux = Math.sin(a); const uy = Math.cos(a); const px = uy; const py = -ux; // radial / tangential in plane
      const at = (r, lat, z) => [ux * r + px * lat, uy * r + py * lat, zc + z];
      if (!near) { P.tube(at(r0, 0, s * 0.35), at(r1, 0, 0), 0.22, pal.truss, { sides: 3, flat: true }); continue; }
      const wA = 0.52; const wB = 0.3; // half width at hub / rim
      const NP = cfg.high ? 15 : 12;
      const chord = (lat0, lat1, z0, z1, r) => T2.tube(at(r0, lat0, z0), at(r1, lat1, z1), r, pal.truss, { sides: 3, flat: true });
      chord(wA, wB, 0, 0, 0.12); chord(-wA, -wB, 0, 0, 0.12); chord(0, 0, s * 0.55, s * 0.3, 0.1);
      for (let j = 0; j < NP; j++) {
        const t0 = j / NP; const t1 = (j + 1) / NP; const rr0 = lerp(r0, r1, t0); const rr1 = lerp(r0, r1, t1);
        const w0 = lerp(wA, wB, t0); const w1 = lerp(wA, wB, t1);
        const sgn = j % 2 ? 1 : -1;
        T2.ribbon(at(rr0, sgn * w0, 0), at(rr1, -sgn * w1, 0), 0.13, [0, 0, 1], pal.truss);
      }
      if (level >= 3) {
        const NL = 8;
        for (let j = 0; j < NL; j++) {
          const t0 = j / NL; const t1 = (j + 0.82) / NL; const n0 = b.count;
          const e = s * 0.04;
          L.ribbon(at(lerp(r0, r1, t0), 0, s * lerp(0.55, 0.3, t0) + e), at(lerp(r0, r1, t1), 0, s * lerp(0.55, 0.3, t1) + e), 0.12, [0, 0, 1], pal.legLed);
          h.spokeLed.push({ s: n0, n: b.count - n0, j, i });
        }
      }
    }
  }
  // hub: axle, discs, sunburst
  const zh = 2.75;
  P.tube([0, 0, -zh], [0, 0, zh], 1.15, 0x4d5459, { sides: 14 });
  for (const s of [1, -1]) {
    P.tube([0, 0, s * 1.6], [0, 0, s * 2.4], 2.9, pal.truss, { sides: 20, r1: 2.7, caps: 0 });
    P.disc([0, 0, s * 2.42], [0, 0, s], 2.62, pal.hubFace, 24);
    // face: concentric dot rings (lamp) in two tones, cream star in the centre
    const faceLamps = near ? 4 : 2;
    for (let q = 0; q < faceLamps; q++) {
      const ra = 1.05 + q * (1.3 / faceLamps); const rb = ra + 0.5 / faceLamps * 1.2; const n0 = b.count;
      L.ring([0, 0, s * 2.45], [0, 0, s], ra, Math.min(rb, 2.35), q % 2 ? [1, 0.6, 0.1] : [1, 0.82, 0.2], near ? 28 : 16, q * 0.2);
      h.faceN = (h.faceN || 0) + (b.count - n0);
    }
    const star = (rO, rI, col, z, nPts = 5, B = P) => { for (let k = 0; k < nPts * 2; k++) { const a0 = (k / (nPts * 2)) * Math.PI * 2; const a1 = ((k + 1) / (nPts * 2)) * Math.PI * 2; const r0s = k % 2 ? rI : rO; const r1s = k % 2 ? rO : rI; B.tri([0, 0, z], [Math.sin(a0) * r0s, Math.cos(a0) * r0s, z], [Math.sin(a1) * r1s, Math.cos(a1) * r1s, z], col); } };
    star(1.15, 0.5, pal.hubStar, s * 2.47, 5, L);
    // green LED ring
    const nR = near ? 36 : 20; const n1 = b.count;
    L.ring([0, 0, s * 2.45], [0, 0, s], 2.38, 2.9, pal.hubRing, nR);
    h.hubRing = h.hubRing || []; h.hubRing.push({ s: n1, n: b.count - n1 });
    if (gold) P.ring([0, 0, s * 2.5], [0, 0, s], 2.9, 3.15, GOLD, 24);
    // sunburst: long and short blades in two planes
    const nBlades = near ? (level >= 2 ? 72 : 40) : 40; h.nBlades = nBlades;
    for (let k = 0; k < nBlades; k++) {
      const a = ang(k, nBlades) + (s < 0 ? Math.PI / nBlades : 0); const long = k % 2 === 0;
      const rA = 3.1; const rB = long ? 10.5 : 6.4; const wd = long ? 0.36 : 0.34; const rM = rA + (rB - rA) * 0.35;
      const ux = Math.sin(a); const uy = Math.cos(a); const px = uy; const py = -ux; const z = s * 2.05;
      const p = (r, lat) => [ux * r + px * lat, uy * r + py * lat, z + (long ? 0 : s * 0.05)];
      const n0 = b.count;
      const c = pal.blades[k % 3];
      L.tri(p(rA, -wd * 0.5), p(rA, wd * 0.5), p(rM, wd), c); L.tri(p(rA, -wd * 0.5), p(rM, wd), p(rM, -wd), c); L.tri(p(rM, -wd), p(rM, wd), p(rB, 0), c);
      h.blades.push({ s: n0, n: b.count - n0, k, s2: s });
    }
  }
  // cable web (lines): two wire polygons and long crossing cables per face
  if (near || true) {
    const rings = near ? [0.42, 0.72] : [0.55];
    for (const s of [1, -1]) {
      const zc = s * S.faceZ; const cc = pal.cable;
      for (const f of rings) { const r = lerp(r0, r1, f); for (let i = 0; i < NS; i++) { const a = ang(i, NS); const a2 = ang(i + 1, NS); b.line([Math.sin(a) * r, Math.cos(a) * r, zc], [Math.sin(a2) * r, Math.cos(a2) * r, zc], cc); } }
      for (let i = 0; i < NS; i++) {
        const a = ang(i, NS); const aa = ang(i + 2, NS); const ab = ang(i - 2, NS);
        const ra = lerp(r0, r1, 0.14);
        b.line([Math.sin(a) * ra, Math.cos(a) * ra, zc], [Math.sin(aa) * r1, Math.cos(aa) * r1, zc], cc);
        if (near) b.line([Math.sin(a) * ra, Math.cos(a) * ra, zc], [Math.sin(ab) * r1, Math.cos(ab) * r1, zc], cc);
      }
    }
  }
  return h;
}

/** colour animation of the rotor lamps (rim chase at L3+, hub sunburst chase at every level) */
function chaseRotor(K, geo, h, cfg, t, k) {
  const { pal, level } = cfg; const lerpC = (a, b2, q) => [a[0] + (b2[0] - a[0]) * q, a[1] + (b2[1] - a[1]) * q, a[2] + (b2[2] - a[2]) * q];
  const dark = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  // sunburst: a wave runs around the hub, two blade lengths a third out of phase
  for (const bl of h.blades) {
    const phase = (t * 0.9 + bl.k / h.nBlades * 3) % 1;
    const wave = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), 1.5);
    const base = pal.blades[(bl.k + Math.floor(t * 1.5)) % 3];
    K.setLamp(geo, bl.s, bl.n, dark(base, wave));
  }
  if (h.hubRing) for (const r of h.hubRing) K.setLamp(geo, r.s, r.n, dark(pal.hubRing, 0.65 + 0.35 * Math.sin(t * 3)));
  if (level >= 3) {
    const NRj = h.rimLed.length / 2;
    for (const e of h.rimLed) {
      const wave = (e.j / 6 - t * 1.1) % 1; const w = wave < 0 ? wave + 1 : wave;
      const lit = w < 0.5 ? 1 : 0.35;
      const col = e.j % 12 < 6 ? pal.rimLed[0] : pal.rimLed[1];
      K.setLamp(geo, e.s, e.n, dark(col, lit));
    }
    for (const e of h.spokeLed) {
      const w = ((t * 0.7 - e.j / 8) % 1 + 1) % 1; K.setLamp(geo, e.s, e.n, dark(pal.legLed, 0.25 + 0.75 * Math.pow(1 - w, 3)));
    }
  }
}
function chaseLegs(K, geo, handles, cfg, t, k) {
  const { pal } = cfg;
  for (const e of handles.legLed) { const w = ((t * 0.9 - e.j / 22) % 1 + 1) % 1; const f = 0.3 + 0.7 * Math.pow(1 - w, 2); K.setLamp(geo, e.s, e.n, [pal.legLed[0] * f, pal.legLed[1] * f, pal.legLed[2] * f]); }
}

/* ------------------------------------------------------------------------------------------------------------------ gondolas */
function buildGondolas(b, cfg, near) {
  const { pal, S, level } = cfg; const P = b.P; const L = b.L;
  const base = []; const ranges = []; const gold = level >= 4;
  const glass = b.G([1, 0.5, 0.12]);
  for (let i = 0; i < S.gondolas; i++) {
    const a = ang(i, S.gondolas); const px = Math.sin(a) * S.gondolaR; const py = S.hubY + Math.cos(a) * S.gondolaR;
    base.push([px, py]);
    const v0 = b.count;
    b.place([px, py, 0], 0, 0, 0, 1.25);
    const g = (x, y, z, sx, sy, sz, c, skip) => P.box(x, y, z, sx, sy, sz, c, skip);
    if (near) {
      g(0, -0.28, 0, 1.72, 0.1, 1.34, pal.gRoof, 32);                         // roof slab
      if (cfg.high) g(0, -0.2, 0, 1.3, 0.07, 0.95, pal.gRoof, 32);            // roof ridge
      if (gold) g(0, -0.335, 0, 1.76, 0.05, 1.38, GOLD, 32 | 16);
      L.quad([-0.8, -0.36, 0.67], [0.8, -0.36, 0.67], [0.8, -0.32, 0.67], [-0.8, -0.32, 0.67], [1, 0.8, 0.45]);
      L.quad([-0.8, -0.36, -0.67], [0.8, -0.36, -0.67], [0.8, -0.32, -0.67], [-0.8, -0.32, -0.67], [1, 0.8, 0.45]);
      for (const sz of [-1, 1]) P.ribbon([0, 0, sz * 0.55], [0, -0.28, sz * 0.55], 0.1, [1, 0, 0], GREY);
      g(0, -1.56, 0, 1.5, 0.52, 1.1, pal.gBody, 32 | 16);                      // lower body
      P.quad([-0.73, -1.86, -0.53], [0.73, -1.86, -0.53], [0.73, -1.86, 0.53], [-0.73, -1.86, 0.53], 0x44494d);   // floor pan
      for (const sx of [-0.73, 0.73]) for (const sz of [-0.53, 0.53]) P.ribbon([sx, -1.3, sz], [sx, -0.37, sz], 0.09, [sx, 0, sz], pal.gBody);
      // glass on four sides
      for (const sz of [-1, 1]) glass.quad([-0.68, -1.28, sz * 0.545], [0.68, -1.28, sz * 0.545], [0.68, -0.42, sz * 0.545], [-0.68, -0.42, sz * 0.545], 0x3b6169);
      for (const sx of [-1, 1]) glass.quad([sx * 0.745, -1.28, -0.5], [sx * 0.745, -1.28, 0.5], [sx * 0.745, -0.42, 0.5], [sx * 0.745, -0.42, -0.5], 0x3b6169);
      // cream cartouche + lit panel on both z faces, mullion and top bar
      for (const sz of [-1, 1]) {
        const z = sz * 0.56;
        P.quad([-0.62, -1.78, z], [0.62, -1.78, z], [0.62, -1.34, z], [-0.62, -1.34, z], pal.gBand);
        L.quad([-0.5, -1.7, z + sz * 0.012], [0.5, -1.7, z + sz * 0.012], [0.5, -1.42, z + sz * 0.012], [-0.5, -1.42, z + sz * 0.012], pal.gPanel);
        if (level >= 2) P.tri([-0.1, -1.56, z + sz * 0.02], [0.1, -1.56, z + sz * 0.02], [0, -1.46, z + sz * 0.02], pal.gBand);
        P.ribbon([0, -1.28, z + sz * 0.01], [0, -0.43, z + sz * 0.01], 0.07, [0, 0, sz], pal.gTrim); P.ribbon([-0.75, -0.43, z + sz * 0.01], [0.75, -0.43, z + sz * 0.01], 0.07, [0, 0, sz], pal.gTrim);
        for (const sx of [-0.7, 0.7]) P.ribbon([sx, -1.3, z + sz * 0.01], [sx, -0.43, z + sz * 0.01], 0.07, [0, 0, sz], pal.gTrim);
      }
      if (gold) P.box(0, -1.3, 0, 1.54, 0.04, 1.14, GOLD, 32 | 16);
    } else {
      g(0, -0.28, 0, 1.7, 0.12, 1.3, pal.gRoof, 32);
      g(0, -1.1, 0, 1.5, 1.5, 1.1, pal.gBody, 32 | 16);
      for (const sz of [-1, 1]) L.quad([-0.5, -1.7, sz * 0.56], [0.5, -1.7, sz * 0.56], [0.5, -1.42, sz * 0.56], [-0.5, -1.42, sz * 0.56], pal.gPanel);
    }
    b.pop();
    ranges.push([v0, b.count - v0]);
  }
  return { base, ranges };
}

/* ------------------------------------------------------------------------------------------------------------------ static structure */
function buildStatic(b, cfg, near) {
  const { pal, S, level, look } = cfg; const P = b.P; const L = b.L; const gold = level >= 4;
  const handles = {};
  const HY = S.hubY;
  // forecourt pad (reaches below the terrain to hide slopes) + wheel footing
  P.box(0, -0.25, 4.6, 23.2, 1.1, 29.2, 0x9b958a, 32);
  b.G([0.5, 0.4, 0.24]).quad([-11.1, 0.292, -9.5], [11.1, 0.292, -9.5], [11.1, 0.292, 18.7], [-11.1, 0.292, 18.7], 0xaaa496);   // paving the fair's bulbs light at night
  const feet = [[-8.5, -6.5], [8.5, -6.5], [-8.5, 6.5], [8.5, 6.5]];
  const apexes = [[-0.95, -2.95], [0.95, -2.95], [-0.95, 2.95], [0.95, 2.95]];
  const legPt = (k, t) => { const f = feet[k]; const a = apexes[k]; return [lerp(f[0], a[0], t), lerp(0.55, HY - 1.2, t), lerp(f[1], a[1], t)]; };
  if (level >= 3) {
    // plinth + railing around the wheel base
    P.box(0, 0.45, -0.5, 21, 0.3, 15.4, pal.plinth, 32);
    if (gold) { P.box(0, 0.62, -0.5, 21.2, 0.04, 15.6, GOLD, 32); }
  }
  for (let k = 0; k < 4; k++) {
    const foot = legPt(k, 0);
    P.box(foot[0], 0.55, foot[2], 1.7, 0.8, 1.7, 0x80858a, 32);
    const a = legPt(k, 0.02); const z = legPt(k, 1);
    P.stripedTube(a, z, 0.62, pal.legA, pal.legB, { sides: near && cfg.high ? 8 : 6, rowLen: near ? 0.9 : 2.2, spiral: 1, r1: 0.5 });
    if (gold) for (const t of [0.1, 0.5, 0.92]) { const c = legPt(k, t); P.tube([c[0], c[1] - 0.12, c[2]], [c[0], c[1] + 0.12, c[2]], 0.52, GOLD, { sides: 8 }); }
  }
  // lattice braces: horizontal + X between legs, and between the front and back pairs
  const levels = near ? [0.2, 0.42, 0.62, 0.82] : [0.3, 0.62];
  const tubeW = near ? 0.1 : 0.14;
  for (let q = 0; q < levels.length; q++) {
    const t = levels[q]; const tn = levels[q + 1];
    for (const [i, j] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      P.tube(legPt(i, t), legPt(j, t), tubeW, pal.truss, { sides: 4, flat: true });
      if (tn !== undefined) { P.tube(legPt(i, t), legPt(j, tn), tubeW * 0.8, pal.truss, { sides: 3, flat: true }); P.tube(legPt(j, t), legPt(i, tn), tubeW * 0.8, pal.truss, { sides: 3, flat: true }); }
    }
  }
  // catwalk platforms
  for (const t of near ? [0.42, 0.82] : [0.42]) {
    const c0 = legPt(0, t); const c1 = legPt(3, t); const w = (c1[0] - c0[0]) - 1.0; const d = (c1[2] - c0[2]) - 1.0; const y = c0[1];
    P.box(0, y, 0, w, 0.14, d, pal.deck, 0); P.box(0, y - 0.12, 0, w - 0.2, 0.1, d - 0.2, 0x8a9296, 0);
    if (near) {
      for (const [x1, z1, x2, z2] of [[-w / 2, -d / 2, w / 2, -d / 2], [-w / 2, d / 2, w / 2, d / 2], [-w / 2, -d / 2, -w / 2, d / 2], [w / 2, -d / 2, w / 2, d / 2]]) {
        P.tube([x1, y + 1.05, z1], [x2, y + 1.05, z2], 0.04, 0xe9d34a, { sides: 4, flat: true }); P.tube([x1, y + 0.55, z1], [x2, y + 0.55, z2], 0.03, 0xe9d34a, { sides: 3, flat: true });
        const n = Math.max(2, Math.round(Math.hypot(x2 - x1, z2 - z1) / 1.6));
        for (let q = 0; q <= n; q++) { const f = q / n; P.tube([lerp(x1, x2, f), y, lerp(z1, z2, f)], [lerp(x1, x2, f), y + 1.05, lerp(z1, z2, f)], 0.03, 0xe9d34a, { sides: 3, flat: true }); }
      }
    }
  }
  // hub bearing blocks and the axle ends (static, the rotor spins between them)
  for (const s of [1, -1]) {
    P.box(0, HY - 2.3, s * 2.95, 2.1, 1.1, 0.9, 0x4d5459, 0);
  }
  // legs: LED lines (L2+), chasing at L3+
  if (level >= 2) {
    handles.legLed = [];
    for (let k = 0; k < 4; k++) {
      const NJ = 22; const sgn = feet[k][1] > 0 ? 1 : -1;
      for (let j = 0; j < NJ; j++) {
        const t0 = lerp(0.04, 0.97, j / NJ); const t1 = lerp(0.04, 0.97, (j + 0.78) / NJ);
        const p0 = legPt(k, t0); const p1 = legPt(k, t1); const off = lerp(0.62, 0.5, t0) + 0.03;
        const n0 = b.count;
        L.ribbon([p0[0], p0[1], p0[2] + sgn * off], [p1[0], p1[1], p1[2] + sgn * off], 0.2, [0, 0, sgn], pal.legLed);
        handles.legLed.push({ s: n0, n: b.count - n0, j });
        if (!near) break;
      }
    }
  }
  // boarding platform, stairs, rails, gate
  const deckY = 0.75;
  P.box(0, 0.52, 5.35, 7.2, 0.46, 7.0, 0x7d8286, 32); P.box(0, deckY - 0.02, 5.35, 7.0, 0.05, 6.8, 0xc3b79d, 0);
  P.box(0, 0.42, 9.9, 7.2, 0.28, 1.4, 0x7d8286, 32);
  if (near) {
    for (const x of [-3.5, 3.5]) { P.tube([x, deckY, 1.8], [x, deckY + 1.05, 1.8], 0.04, 0xe9d34a, { sides: 4, flat: true }); P.tube([x, deckY + 1.05, 1.8], [x, deckY + 1.05, 8.8], 0.045, 0xe9d34a, { sides: 4, flat: true }); P.tube([x, deckY + 0.55, 1.8], [x, deckY + 0.55, 8.8], 0.035, 0xe9d34a, { sides: 3, flat: true });
      for (let z = 2.6; z < 9; z += 1.6) P.tube([x, deckY, z], [x, deckY + 1.05, z], 0.03, 0xe9d34a, { sides: 3, flat: true }); }
    P.tube([-3.5, deckY + 1.05, 8.8], [-1.0, deckY + 1.05, 8.8], 0.045, 0xe9d34a, { sides: 4, flat: true }); P.tube([1.0, deckY + 1.05, 8.8], [3.5, deckY + 1.05, 8.8], 0.045, 0xe9d34a, { sides: 4, flat: true });
    // exit gate rail in front of the lowest gondola (x -1.6 .. 1.6, z 1.9)
    P.tube([-1.7, deckY + 1.0, 1.95], [1.7, deckY + 1.0, 1.95], 0.04, pal.trim, { sides: 4, flat: true });
  }
  // ticket booth(s) with a lit sign, bulb frieze
  const booth = (x, z, ry, big) => {
    b.place([x, 0.3, z], ry);
    P.box(0, 1.25, 0, 3.6, 2.5, 2.7, pal.booth, 32 | 16); P.box(0, 2.62, 0, 4.3, 0.22, 3.4, pal.boothRoof, 32);
    P.box(0, 2.88, 0, 3.0, 0.34, 2.2, pal.boothRoof, 32);
    glassWin(b, [-1.1, 1.0, 1.36], [1.1, 1.0, 1.36], 0.9);
    for (let q = 0; q < 8; q++) { const x0 = -1.6 + q * 0.4; const c = q % 2 ? 0xf6f1e4 : pal.boothRoof; P.quad([x0, 2.2, 1.38], [x0 + 0.4, 2.2, 1.38], [x0 + 0.4, 1.7, 2.0], [x0, 1.7, 2.0], c); }
    P.box(0, 1.0, 1.55, 2.5, 0.12, 0.5, pal.trim, 0);
    P.box(-1.6, 1.25, 1.37, 0.18, 2.4, 0.1, pal.trim, 0); P.box(1.6, 1.25, 1.37, 0.18, 2.4, 0.1, pal.trim, 0);
    if (near) for (let q = 0; q < 12; q++) bulb(b, [-2.0 + q * 0.36, 2.53, 1.72], 0.2, pal.bulb);
    // sign above
    P.box(0, 3.55, 1.0, big ? 3.2 : 2.6, big ? 1.1 : 0.9, 0.14, gold ? GOLD : pal.trim, 0);
    L.quad([-(big ? 1.45 : 1.15), 3.2, 1.09], [(big ? 1.45 : 1.15), 3.2, 1.09], [(big ? 1.45 : 1.15), 3.9, 1.09], [-(big ? 1.45 : 1.15), 3.9, 1.09], pal.signPanel);
    if (near) { P.tri([-0.3, 3.4, 1.1], [0.3, 3.4, 1.1], [0, 3.8, 1.1], pal.hubStar); }
    b.pop();
  };
  booth(-7.6, 13.2, Math.PI / 2, false);
  if (level >= 2) booth(7.6, 13.2, -Math.PI / 2, true);
  // queue rails, three switchback rows
  if (near) {
    for (let r = 0; r < 3; r++) {
      const z = 12.0 + r * 1.9; const gapRight = r % 2 === 0;
      const x0 = -4.4; const x1 = gapRight ? 2.4 : 4.4; const xa = gapRight ? -4.4 : -2.4;
      const xs = gapRight ? [x0, x1] : [xa, 4.4];
      for (const y of [0.55, 1.0]) P.tube([xs[0], y + 0.3, z], [xs[1], y + 0.3, z], 0.035, pal.trim, { sides: 4, flat: true });
      for (let x = xs[0]; x <= xs[1] + 0.01; x += 1.6) P.tube([x, 0.3, z], [x, 1.38, z], 0.045, 0x4d5459, { sides: 4, flat: true });
    }
    // entrance gate + lit arch
    for (const x of [-3.2, 3.2]) { P.box(x, 2.0, 18.8, 0.34, 3.4, 0.34, pal.legA, 0); P.sphere([x, 3.8, 18.8], 0.3, gold ? GOLD : pal.trim, 8, 5); }
    P.box(0, 3.55, 18.8, 6.9, 0.2, 0.3, pal.trim, 0);
    if (level >= 2) {
      P.box(0, 4.4, 18.8, 6.0, 1.15, 0.2, pal.boothRoof, 0); P.box(0, 4.4, 18.82, 6.2, 1.3, 0.1, gold ? GOLD : pal.trim, 0);
      L.quad([-2.7, 3.9, 18.93], [2.7, 3.9, 18.93], [2.7, 4.9, 18.93], [-2.7, 4.9, 18.93], pal.signPanel);
      P.tri([-0.45, 4.15, 18.95], [0.45, 4.15, 18.95], [0, 4.85, 18.95], pal.hubStar);
      for (let q = 0; q < 17; q++) bulb(b, [-3.2 + q * 0.4, 5.1, 18.9], 0.2, pal.bulb);
      for (let q = 0; q < 17; q++) bulb(b, [-3.2 + q * 0.4, 3.62, 18.9], 0.16, pal.bulb);
    } else {
      P.box(0, 3.9, 18.8, 6.0, 0.5, 0.15, pal.boothRoof, 0);
    }
  }
  // L2: festoons of bulbs from the platform rail to the legs, flags
  if (level >= 2 && near) {
    const sag = (p, q, n, drop) => { for (let i = 1; i < n; i++) { const f = i / n; bulb(b, [lerp(p[0], q[0], f), lerp(p[1], q[1], f) - Math.sin(f * Math.PI) * drop, lerp(p[2], q[2], f)], 0.17, pal.bulb); } };
    sag([-3.5, 2.6, 8.8], [-8.5, 4.2, 6.5], 7, 0.5); sag([3.5, 2.6, 8.8], [8.5, 4.2, 6.5], 7, 0.5);
    sag([-3.2, 3.6, 18.8], [-7.6, 3.6, 13.2], 8, 0.6); sag([3.2, 3.6, 18.8], [7.6, 3.6, 13.2], 8, 0.6);
    for (const [x, z] of [[-10.6, 18.5], [10.6, 18.5], [-10.6, -8.4], [10.6, -8.4]]) flag(b, x, z, pal);
  }
  // L3: the sheep mascot on a plinth, railing around the plinth
  if (level >= 3 && near) {
    sheep(b, 6.1, 17.4, -0.5, gold);
    for (const sx of [-1, 1]) { P.tube([sx * 10.5, 0.75, -7.9], [sx * 10.5, 0.75, 6.9], 0.04, pal.trim, { sides: 4, flat: true }); for (let z = -7.9; z <= 6.9; z += 1.9) P.tube([sx * 10.5, 0.6, z], [sx * 10.5, 1.6, z], 0.035, 0x4d5459, { sides: 3, flat: true }); P.tube([sx * 10.5, 1.55, -7.9], [sx * 10.5, 1.55, 6.9], 0.04, pal.trim, { sides: 4, flat: true }); }
    P.tube([-10.5, 1.55, -7.9], [10.5, 1.55, -7.9], 0.04, pal.trim, { sides: 4, flat: true });
  }
  return handles;
}

export const MODELS = { wheel: { build } };
export default MODELS;
