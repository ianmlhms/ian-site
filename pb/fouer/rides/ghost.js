/* Geeschterbunn ride (rides wave): a dark ride through the castle. The model's castle is a solid hall (carts vanish at the painted doors), so the ride brings its own
 * interior while it runs: a dark room shell, a winding track with UV tubes and glowing eyes, scares (a skeleton that pops up, a bat, a lit face, a strobe room,
 * a spider on a thread, a ghost sheet, grabbing hands) and four pairs of heavy doors that bang open and shut at the doorways. The camera rides a longer path
 * than the model's own cart lap: ramp -> arch -> interior circuit -> climb -> balcony in daylight -> back in through the second upper door -> down to the gate.
 * Everything is added to the model group while riding and removed afterwards (one merged mesh for the decor, one per prop: about 14 draws). */
import { makeSpline } from "../models/coaster-kit.js";
import { createSmoother } from "./rigs.js";
import { makeBuilder, makeTexBuilder, glowTexture, airbrushTexture, webTexture, stripeTexture } from "./mesh.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
/** a level frame (no roll: a dark-ride cart stays upright): up = world up made orthogonal to the track, r = horizontal right */
export function levelFrame(f) {
  const t = f.t; const d = t[1];
  let u = [-t[0] * d, 1 - t[1] * d, -t[2] * d]; const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const r = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  return { p: f.p, t, u, r };
}
const ZF = 2.6, U1X = -3.2, U2X = 6.6, G_OUT = 10.2, BAL_Y = 4.9;
export const GHOST = Object.freeze({ speed: 2.1, ramp: 2.4, brake: 6, eye: 1.3, ahead: 0.4, inside: { x0: -13.3, x1: 13.3, z0: -7.6, z1: 2.2, y0: 0.2, y1: 9.8 } });

/** track control points in the model frame (x right, y up, z towards the alley): ramp, arch, circuit, climb, balcony, descent, gate. First and last points are only guides. */
export function ghostControls() {
  return [
    [-1.25, 0.4, 12.5],
    [-1.25, 0.45, 9.4], [-1.25, 0.8, 6.6], [-1.25, 1.12, 4.8], [-1.25, 1.12, 3.2], [-1.25, 1.0, 1.6],
    [-1.25, 0.8, -0.8], [1.6, 0.7, -2.8], [5.4, 0.7, -3.8], [8.8, 0.7, -4.8], [10.8, 0.7, -6.2], [8.0, 0.7, -6.6], [3.4, 0.7, -5.6], [-1.0, 0.7, -6.4], [-5.8, 0.7, -6.5], [-10.2, 0.7, -5.6], [-11.2, 0.7, -2.6], [-8.6, 0.7, -0.8],
    [-6.2, 2.3, -1.2], [-4.4, 4.5, -1.2], [U1X, BAL_Y, 0.2], [U1X, BAL_Y, 1.8], [U1X, BAL_Y, 3.0], [U1X + 0.6, BAL_Y, 3.5], [U1X + 1.6, BAL_Y, 3.55], [1.5, BAL_Y, 3.55], [4.2, BAL_Y, 3.55], [U2X - 0.7, BAL_Y, 3.5], [U2X, BAL_Y, 3.0], [U2X, BAL_Y, 1.6],
    [U2X, BAL_Y, -0.6], [7.4, 4.2, -2.6], [8.9, 2.4, -3.2], [G_OUT, 1.3, -1.6], [G_OUT, 1.0, 0.4], [G_OUT, 1.0, 1.8], [G_OUT, 1.0, 3.3], [G_OUT - 0.4, 1.0, 5.0], [G_OUT - 1.2, 1.0, 7.5],
  ];
}
/** the four doorways the track crosses (z = ZF): where the doors are, derived from the path */
export const GHOST_DOORS = Object.freeze([
  { x: -1.25, w: 3.2, h: 3.0, y0: 0.3, dir: "in", lead: 5.5 },
  { x: U1X, w: 1.7, h: 2.3, y0: 4.8, dir: "out", lead: 0.9 },
  { x: U2X, w: 1.7, h: 2.3, y0: 4.8, dir: "in", lead: 4.5 },
  { x: G_OUT, w: 4.2, h: 2.5, y0: 0.3, dir: "out", lead: 0.9 },
]);
/** control-point indices (into ghostControls) where the scares sit */
export const GHOST_SCARES = Object.freeze([
  { id: "skeleton", at: 7, lat: 1.5 }, { id: "bat", at: 9, lat: 0 }, { id: "face", at: 10, lat: 0 }, { id: "strobe", at: 12, lat: 0 }, { id: "coffin", at: 13, lat: 0 },
  { id: "tunnel", at: 14, lat: 0 }, { id: "spider", at: 15, lat: 0 }, { id: "ghost", at: 16, lat: 0 }, { id: "hands", at: 17, lat: 0 }, { id: "grab", at: 32, lat: 0 },
]);

/** the path as a spline + the arc lengths that matter (pure; harness-tested) */
export function ghostPath(ctrl = ghostControls()) {
  const sp = makeSpline(ctrl, { step: 0.12 });
  const sOf = k => sp.nearestS(ctrl[k]);
  const sStart = sOf(1), sEnd = sOf(ctrl.length - 2);
  // the crossings of the facade plane z = ZF (in = entering, out = leaving), in driving order
  const crossings = []; let prev = sp.at(sStart).p[2];
  for (let s = sStart + 0.25; s <= sEnd; s += 0.25) { const z = sp.at(s).p[2]; if ((prev - ZF) * (z - ZF) < 0) { const f = sp.at(s); crossings.push({ s, x: f.p[0], y: f.p[1], dir: z < ZF ? "in" : "out" }); } prev = z; }
  const scares = GHOST_SCARES.map(sc => ({ ...sc, s: sOf(sc.at) }));
  let inside = 0; for (let s = sStart; s < sEnd; s += 0.5) if (sp.at(s).p[2] < ZF - 0.3) inside += 0.5;
  return { sp, sStart, sEnd, length: sEnd - sStart, crossings, scares, insideLength: inside };
}

/* ------------------------------------------------------------------------------------------------------------------ small mesh helpers (vertex colours, MeshBasicMaterial) */
/* ------------------------------------------------------------------------------------------------------------------ the rig */
export function createGhostRig(env) {
  const { T, ud, def, id, fx, snd, audio, calm, group } = env;
  const path = ud.ghostPath || (ud.ghostPath = ghostPath());
  const { sStart, sEnd, crossings, scares } = path;
  const sp = { at: s => levelFrame(path.sp.at(s)) };
  const mats = [];
  const basic = o => { const m = new T.MeshBasicMaterial({ fog: false, ...o }); mats.push(m); return m; };
  const root = new T.Group(); root.name = "ghost-interior";
  const out = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const smoother = createSmoother(T);
  const st = { rt: 0, s: sStart, v: 0, over: false, black: 0, lastDark: 0 };
  const tmp = new T.Vector3(), tmpF = new T.Vector3(), tmpU = new T.Vector3();
  const props = {}; const doors = [];
  const I = GHOST.inside;

  const texs = [];
  const keep = o => { texs.push(o); return o; };
  const grp = (name, build, visible = false) => {
    const g = new T.Group(); g.name = name; const b = makeBuilder(T); build(b);
    const m = basic({ vertexColors: true, side: T.DoubleSide }); g.userData.mat = m; g.add(b.mesh(m)); g.visible = visible; root.add(g); props[name] = g; return g;
  };

  /* ---- the interior decor: one merged mesh (track, UV tubes, eyes, chains, red emergency lamps) */
  function buildDecor() {
    const b = makeBuilder(T);
    const at = (f, lat, along, y) => [f.p[0] + f.r[0] * lat + f.t[0] * along, f.p[1] + f.r[1] * lat + f.t[1] * along + y, f.p[2] + f.r[2] * lat + f.t[2] * along];
    for (let s = sStart; s < sEnd; s += 0.4) {
      const f0 = sp.at(s), f1 = sp.at(s + 0.4); if (f0.p[2] > ZF - 0.4 && f1.p[2] > ZF - 0.4) continue;
      for (const lat of [-0.45, 0.45]) b.quad([f0.p[0] + f0.r[0] * (lat - 0.045), f0.p[1] - 0.04, f0.p[2] + f0.r[2] * (lat - 0.045)], [f0.p[0] + f0.r[0] * (lat + 0.045), f0.p[1] - 0.04, f0.p[2] + f0.r[2] * (lat + 0.045)], [f1.p[0] + f1.r[0] * (lat + 0.045), f1.p[1] - 0.04, f1.p[2] + f1.r[2] * (lat + 0.045)], [f1.p[0] + f1.r[0] * (lat - 0.045), f1.p[1] - 0.04, f1.p[2] + f1.r[2] * (lat - 0.045)], 0x9aa4bc);
    }
    for (let s = sStart; s < sEnd; s += 0.75) { const f = sp.at(s); if (f.p[2] > ZF - 0.4) continue; b.quad(at(f, -0.75, -0.09, -0.09), at(f, 0.75, -0.09, -0.09), at(f, 0.75, 0.09, -0.09), at(f, -0.75, 0.09, -0.09), 0x4a4a62); }
    // UV tubes and glowing eyes
    const uv = [0x9a5aff, 0x35e6ff, 0xff3fc8, 0x39ff7a];
    for (let i = 0; i < 26; i++) { const x = I.x0 + 0.4 + (i / 25) * (I.x1 - I.x0 - 0.8); b.box(x, 0.65, I.z0 + 0.15, 0.1, 0.1, 0.1, uv[i % 4]); b.box(x, 7.4, I.z0 + 0.2, 0.9, 0.12, 0.12, uv[(i + 1) % 4]); }
    for (let i = 0; i < 14; i++) b.box(I.x0 + 0.2, 1.0 + (i % 5) * 1.5, I.z0 + 1.0 + (i / 13) * (I.z1 - I.z0 - 2), 0.1, 0.9 + (i % 3) * 0.4, 0.1, uv[i % 4]);
    const eyes = [[-12.4, 3.1, -4.0], [12.4, 2.6, -1.0], [-4.0, 5.2, -7.3], [5.0, 1.6, -7.3], [12.4, 4.4, -5.6], [-12.4, 1.4, -0.4], [0.5, 3.4, -7.3], [9.8, 5.6, -7.3]];
    for (const [x, y, z] of eyes) { const dz = Math.abs(x) > 12 ? 0 : 1; for (const k of [-0.18, 0.18]) b.box(x + (dz ? k : 0), y, z + (dz ? 0 : k), 0.1, 0.05, 0.1, 0xffe14a); }
    // hanging chains, and red emergency lamps (a red box on a bracket) on the walls
    for (let i = 0; i < 12; i++) b.box(-11 + i * 2, 8.6, -6.2 + (i % 3) * 1.5, 0.06, 2.0 + (i % 4) * 0.6, 0.06, 0x5a5a70);
    for (const [x, z] of [[-12.9, -2], [-12.9, 0.8], [12.9, -3], [12.9, 0.6], [-9, -7.3], [-3, -7.3], [3, -7.3], [9, -7.3]]) { b.box(x, 2.9, z, 0.2, 0.28, 0.2, 0xff2a1a); b.box(x, 3.1, z, 0.28, 0.06, 0.28, 0x3a3a48); }
    const mesh = b.mesh(basic({ vertexColors: true, side: T.DoubleSide })); mesh.name = "ghost-decor"; mesh.frustumCulled = false;
    return mesh;
  }
  function buildShell() {
    const w = I.x1 - I.x0, d = I.z1 - I.z0, h = I.y1 - I.y0;
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), basic({ color: 0x120a1e, side: T.BackSide }));
    m.position.set((I.x0 + I.x1) / 2, (I.y0 + I.y1) / 2, (I.z0 + I.z1) / 2); m.name = "ghost-shell"; return m;
  }
  function buildFloor() {
    const m = new T.Mesh(new T.PlaneGeometry(I.x1 - I.x0, I.z1 - I.z0), basic({ color: 0x2a2236, side: T.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set((I.x0 + I.x1) / 2, 0.55, (I.z0 + I.z1) / 2); m.name = "ghost-floor"; return m;
  }
  /** airbrushed horror murals: four paintings (graveyard, vampire, flames, moon castle), each one mesh, on the back wall and the two side walls */
  function buildMurals() {
    const kinds = ["graveyard", "vampire", "flames", "moon"], tb = kinds.map(() => makeTexBuilder(T)), pw = (I.x1 - I.x0) / 4;
    kinds.forEach((k, i) => { const x0 = I.x0 + i * pw + 0.15, x1 = I.x0 + (i + 1) * pw - 0.15, z = I.z0 + 0.04; tb[i].quad([x0, 1.2, z], [x1, 1.2, z], [x1, 4.6, z], [x0, 4.6, z]); });
    const sideZ = [[I.z0 + 0.7, I.z0 + 5.0], [I.z0 + 5.2, I.z1 - 0.4]];
    sideZ.forEach(([z0, z1], i) => {
      const h = (z1 - z0) / 1.9, y0 = 1.4;
      tb[i === 0 ? 0 : 2].quad([I.x0 + 0.04, y0, z0], [I.x0 + 0.04, y0, z1], [I.x0 + 0.04, y0 + h, z1], [I.x0 + 0.04, y0 + h, z0]);
      tb[i === 0 ? 1 : 3].quad([I.x1 - 0.04, y0, z1], [I.x1 - 0.04, y0, z0], [I.x1 - 0.04, y0 + h, z0], [I.x1 - 0.04, y0 + h, z1]);
    });
    kinds.forEach((k, i) => { const t = keep(airbrushTexture(T, k, i + 1)); const m = tb[i].mesh(basic({ map: t, color: 0xb0b0b0, side: T.DoubleSide })); m.name = "ghost-mural-" + k; m.frustumCulled = false; root.add(m); });
  }
  /** coloured spotlight cones (additive, bright at the lamp, black at the floor), a floor haze (big soft additive points) and cobwebs */
  function buildLights() {
    const b = makeBuilder(T), cols = [0xff2a2a, 0x39ff7a, 0x9a5aff, 0x35c8ff, 0xff7a1a], haze = [], hcol = [];
    let k = 0;
    for (let s = sStart + 6; s < sEnd - 3; s += 7.5, k++) {
      const f = sp.at(s); if (f.p[2] > ZF - 1.2 || f.p[1] > 2) continue;
      const side = k % 2 ? 1 : -1, apex = [f.p[0] + f.r[0] * side * 3 - f.t[0] * 2, 9.4, f.p[2] + f.r[2] * side * 3 - f.t[2] * 2], base = [f.p[0] + f.r[0] * side * 0.6 + f.t[0] * 2, 0.62, f.p[2] + f.r[2] * side * 0.6 + f.t[2] * 2];
      b.cone(apex, base, 1.7, 12, cols[k % cols.length]);
    }
    const cm = new T.Mesh(b.mesh(basic()).geometry, basic({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide })); cm.name = "ghost-cones"; cm.frustumCulled = false; cm.renderOrder = 2; root.add(cm);
    for (let i = 0; i < 46; i++) { const f = sp.at(sStart + 4 + (i / 46) * (path.length - 8)); if (f.p[2] > ZF - 0.5) continue; haze.push(f.p[0] + (Math.random() - 0.5) * 6, 0.9 + Math.random() * 0.8, f.p[2] + (Math.random() - 0.5) * 6); const c = new T.Color([0x4a2a8a, 0x1a4a6a, 0x6a1a3a][i % 3]); hcol.push(c.r, c.g, c.b); }
    const hg = new T.BufferGeometry(); hg.setAttribute("position", new T.BufferAttribute(new Float32Array(haze), 3)); hg.setAttribute("color", new T.BufferAttribute(new Float32Array(hcol), 3));
    const hm = new T.Points(hg, new T.PointsMaterial({ size: 3.2, map: keep(glowTexture(T)), vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, blending: T.AdditiveBlending, fog: false })); mats.push(hm.material); hm.frustumCulled = false; hm.name = "ghost-haze"; hm.renderOrder = 3; root.add(hm);
    // red glow around the emergency lamps
    const rp = []; for (const [x, z] of [[-12.9, -2], [-12.9, 0.8], [12.9, -3], [12.9, 0.6], [-9, -7.3], [-3, -7.3], [3, -7.3], [9, -7.3]]) rp.push(x, 3.0, z);
    const rg = new T.BufferGeometry(); rg.setAttribute("position", new T.BufferAttribute(new Float32Array(rp), 3));
    const rm = new T.Points(rg, new T.PointsMaterial({ size: 1.8, map: keep(glowTexture(T, "255,40,30")), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); mats.push(rm.material); rm.frustumCulled = false; rm.renderOrder = 3; root.add(rm);
    // cobwebs: the corners of the room and a few across the ceiling over the track
    const tb = makeTexBuilder(T), wq = (x, y, z, ax, ay, sz) => tb.quad([x, y, z], [x + ax[0] * sz, y + ax[1] * sz, z + ax[2] * sz], [x + (ax[0] + ay[0]) * sz, y + (ax[1] + ay[1]) * sz, z + (ax[2] + ay[2]) * sz], [x + ay[0] * sz, y + ay[1] * sz, z + ay[2] * sz]);
    wq(I.x0 + 0.05, 9.7, I.z0 + 0.05, [1, 0, 0], [0, -1, 0], 2.6); wq(I.x1 - 0.05, 9.7, I.z0 + 0.05, [-1, 0, 0], [0, -1, 0], 2.6); wq(I.x0 + 0.05, 9.7, I.z1 - 0.05, [1, 0, 0], [0, -1, 0], 2.2); wq(I.x1 - 0.05, 9.7, I.z1 - 0.05, [-1, 0, 0], [0, -1, 0], 2.2);
    for (const sc of scares) { const f = sp.at(sc.s - 1.2); if (f.p[2] > ZF - 1 || f.p[1] > 2) continue; const sd = sc.at % 2 ? 1 : -1; wq(f.p[0] + f.r[0] * 2.6 * sd, 4.2, f.p[2] + f.r[2] * 2.6 * sd, [-f.r[0] * sd, 0, -f.r[2] * sd], [0, -1, 0], 1.7); }
    const wm = tb.mesh(basic({ map: keep(webTexture(T)), transparent: true, depthWrite: false, side: T.DoubleSide })); wm.name = "ghost-webs"; wm.frustumCulled = false; root.add(wm);
  }
  /* ---- props: one merged mesh each, dimmed until their scare fires (then lit by the flash) */
  function skeleton(b) {
    const bone = 0xf0ecd8, shade = 0xc8c2a8, dark = 0x100a16;
    b.ball(0, 1.8, 0, 0.2, bone, 8); b.box(0, 1.64, 0.1, 0.22, 0.1, 0.16, bone); b.box(0, 1.58, 0.09, 0.2, 0.05, 0.14, shade);             // skull, jaw
    for (const sx of [-1, 1]) { b.ball(sx * 0.075, 1.82, 0.16, 0.055, dark, 5); b.box(sx * 0.07, 1.9, 0.12, 0.02, 0.02, 0.02, 0xff2a1a); }
    b.tri([-0.03, 1.74, 0.2], [0.03, 1.74, 0.2], [0, 1.68, 0.21], dark);
    for (let k = -3; k <= 3; k++) b.box(k * 0.025, 1.595, 0.17, 0.015, 0.03, 0.02, bone);                                                    // teeth
    b.beam([0, 1.0, 0], [0, 1.58, 0], 0.07, 0.07, shade);                                                                                   // spine
    for (let k = 0; k < 5; k++) { const y = 1.5 - k * 0.095, r = 0.2 - Math.abs(k - 1) * 0.018; b.ring([0, y, 0.01], [1, 0, 0], [0, 0, 1], r, 10, 0.03, 0.035, bone); }   // ribs
    b.box(0, 0.96, 0, 0.34, 0.12, 0.16, bone); b.box(0, 1.52, 0, 0.5, 0.04, 0.1, bone);                                                       // pelvis, collar bone
    for (const sx of [-1, 1]) {
      b.beam([sx * 0.1, 0.92, 0], [sx * 0.14, 0.5, 0.03], 0.06, 0.06, bone); b.beam([sx * 0.14, 0.5, 0.03], [sx * 0.13, 0.06, 0], 0.05, 0.05, bone); b.box(sx * 0.13, 0.03, 0.08, 0.1, 0.05, 0.22, bone);
      b.ball(sx * 0.14, 0.5, 0.03, 0.045, shade, 5);
    }
    b.beam([-0.25, 1.52, 0], [-0.42, 1.25, 0.05], 0.05, 0.05, bone); b.beam([-0.42, 1.25, 0.05], [-0.36, 0.98, 0.12], 0.045, 0.045, bone);
    b.beam([0.25, 1.52, 0], [0.44, 1.8, 0.1], 0.05, 0.05, bone); b.beam([0.44, 1.8, 0.1], [0.38, 2.1, 0.22], 0.045, 0.045, bone);              // one arm waving
    for (let k = -1; k <= 1; k++) b.box(0.38 + k * 0.025, 2.2, 0.24, 0.02, 0.12, 0.02, bone);
  }
  function bat(b) {
    const fur = 0x2a2236, wing = 0x3a2a4a, vein = 0x6a4a7a;
    b.ball(0, 0, 0, 0.17, fur, 6); b.ball(0, 0.18, 0.06, 0.1, fur, 6); b.tri([-0.06, 0.26, 0.04], [-0.1, 0.4, 0.04], [-0.01, 0.28, 0.04], fur); b.tri([0.06, 0.26, 0.04], [0.1, 0.4, 0.04], [0.01, 0.28, 0.04], fur);
    for (const sx of [-0.045, 0.045]) { b.box(sx, 0.2, 0.15, 0.04, 0.035, 0.03, 0xff3030); }
    b.tri([-0.03, 0.15, 0.14], [0.03, 0.15, 0.14], [0, 0.09, 0.16], 0xf4f0e0);
  }
  function wingMesh(b, sd) {
    const tip = [sd * 1.15, 0.25, -0.12], a = [sd * 0.55, 0.45, -0.05], b2 = [sd * 0.95, -0.3, -0.05], c = [sd * 0.35, -0.38, 0], r = [0, 0.05, 0];
    b.tri(r, a, tip, 0x4a3a5c); b.tri(r, tip, b2, 0x3a2a4a); b.tri(r, b2, c, 0x4a3a5c); b.tri(r, c, [0, -0.3, 0], 0x3a2a4a);
    b.beam(r, tip, 0.035, 0.035, 0x7a5a8a); b.beam(r, b2, 0.03, 0.03, 0x7a5a8a); b.beam(r, a, 0.03, 0.03, 0x7a5a8a); b.beam(r, c, 0.025, 0.025, 0x7a5a8a);
  }
  function coffin(b) {
    const wood = 0x4a2a1a, trim = 0xd8a830, dark = 0x0a0610;
    const pts = [[-0.3, 0.9], [0.3, 0.9], [0.45, 0.4], [0.3, -0.9], [-0.3, -0.9], [-0.45, 0.4]];                                        // top view, x / z
    const ring = (y, k) => pts.map(p => [p[0] * k, y, p[1] * k]);
    const lo = ring(0, 0.85), hi = ring(0.55, 1);
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; b.quad(lo[i], lo[j], hi[j], hi[i], wood); }
    b.tri(lo[0], lo[2], lo[1], dark); b.quad(lo[0], lo[1], lo[2], lo[5], dark); b.quad(lo[5], lo[2], lo[3], lo[4], dark);
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; b.beam(hi[i], hi[j], 0.05, 0.05, trim); }
    b.quad([-0.28, 0.54, 0.8], [0.28, 0.54, 0.8], [0.4, 0.54, 0.4], [-0.4, 0.54, 0.4], 0x1f3a22);                                         // the green inside, glowing
    b.quad([-0.4, 0.54, 0.4], [0.4, 0.54, 0.4], [0.27, 0.54, -0.8], [-0.27, 0.54, -0.8], 0x2a5a30);
  }
  function coffinLid(b) {
    const wood = 0x5a321e, trim = 0xd8a830;
    const pts = [[-0.3, 0.9], [0.3, 0.9], [0.45, 0.4], [0.3, -0.9], [-0.3, -0.9], [-0.45, 0.4]];                                         // a hinge at z = -0.9 (the lid opens backwards)
    const P = (p, y) => [p[0], y, p[1] + 0.9];
    b.quad(P(pts[0], 0.06), P(pts[1], 0.06), P(pts[2], 0.06), P(pts[5], 0.06), wood); b.quad(P(pts[5], 0.06), P(pts[2], 0.06), P(pts[3], 0.06), P(pts[4], 0.06), wood);
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; b.beam(P(pts[i], 0.06), P(pts[j], 0.06), 0.05, 0.05, trim); }
    b.box(0, 0.1, 0.9, 0.06, 0.02, 0.8, trim); b.box(0, 0.1, 0.55, 0.4, 0.02, 0.06, trim);
  }
  function buildProps() {
    grp("skeleton", skeleton);
    for (const n of ["bat0", "bat1"]) { const g = grp(n, bat); for (const sd of [-1, 1]) { const w = new T.Group(); w.name = sd < 0 ? "wingL" : "wingR"; const wb = makeBuilder(T); wingMesh(wb, sd); w.add(wb.mesh(g.userData.mat)); g.add(w); } }
    grp("face", b => {
      const glow = 0xc8ffa8, dark = 0x0a0612;
      b.ball(0, 0, 0, 0.8, glow, 10); b.ball(-0.26, 0.14, 0.62, 0.17, dark, 6); b.ball(0.26, 0.14, 0.62, 0.17, dark, 6); b.box(0, -0.3, 0.7, 0.55, 0.12, 0.12, dark);
      for (let k = -2; k <= 2; k++) b.box(k * 0.11, -0.22, 0.72, 0.06, 0.14, 0.06, 0xf4f0d0); b.tri([-0.1, 0.04, 0.78], [0.1, 0.04, 0.78], [0, -0.14, 0.78], dark);
      b.tri([-0.45, 0.45, 0.55], [-0.1, 0.35, 0.7], [-0.3, 0.3, 0.7], dark); b.tri([0.45, 0.45, 0.55], [0.1, 0.35, 0.7], [0.3, 0.3, 0.7], dark);   // brows
    });
    grp("spider", b => {
      b.ball(0, 0, 0, 0.28, 0x1a1020, 7); b.ball(0, 0.04, 0.26, 0.17, 0x1a1020, 6); b.box(-0.07, 0.1, 0.38, 0.06, 0.06, 0.04, 0xff2a2a); b.box(0.07, 0.1, 0.38, 0.06, 0.06, 0.04, 0xff2a2a);
      b.box(0, 0.16, -0.05, 0.1, 0.05, 0.3, 0xff7a1a);
      for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) { const zz = -0.15 + k * 0.14; b.beam([sd * 0.2, 0.05, zz], [sd * 0.55, 0.22, zz], 0.045, 0.045, 0x1a1020); b.beam([sd * 0.55, 0.22, zz], [sd * 0.78, -0.25, zz + 0.05], 0.04, 0.04, 0x1a1020); }
    });
    grp("thread", b => { b.box(0, 0, 0, 0.02, 1, 0.02, 0xe8e8f8); });
    grp("ghost", b => {
      const sheet = 0xf6f4ff;
      b.ball(0, 1.7, 0, 0.42, sheet, 8); b.box(0, 1.0, 0, 0.8, 1.4, 0.55, sheet); b.box(-0.55, 1.2, 0.1, 0.3, 0.12, 0.2, sheet); b.box(0.55, 1.2, 0.1, 0.3, 0.12, 0.2, sheet);
      b.box(-0.15, 1.75, 0.38, 0.12, 0.2, 0.05, 0x14101c); b.box(0.15, 1.75, 0.38, 0.12, 0.2, 0.05, 0x14101c); b.ball(0, 1.5, 0.4, 0.1, 0x14101c, 5);
      for (let k = -2; k <= 2; k++) b.tri([k * 0.17 - 0.08, 0.35, 0.28], [k * 0.17 + 0.08, 0.35, 0.28], [k * 0.17, 0.05, 0.28], sheet);
    });
    grp("hands", b => {
      for (const sd of [-1, 1]) { b.box(sd * 0.7, 1.6, 0, 1.2, 0.18, 0.18, 0x7c9a6a); b.box(sd * 0.05, 1.6, 0.1, 0.34, 0.1, 0.3, 0x8caa7a); for (let k = 0; k < 4; k++) b.box(sd * 0.05, 1.6 + (k - 1.5) * 0.09, 0.32 + k * 0.02, 0.06, 0.06, 0.3, 0x8caa7a); b.box(sd * 0.05, 1.5, 0.35, 0.05, 0.05, 0.2, 0x8caa7a); }
    });
    grp("grab", b => { b.box(0, 1.2, 0, 0.14, 2.4, 0.14, 0x6a8a5a); for (let k = 0; k < 5; k++) b.box((k - 2) * 0.09, 2.5, 0.05, 0.06, 0.4, 0.06, 0x7c9a6a); b.box(0, 2.35, 0.1, 0.4, 0.3, 0.2, 0x7c9a6a); });
    grp("dancer", skeleton);
    grp("coffin", coffin, true); const lid = new T.Group(); lid.name = "lid"; const lb = makeBuilder(T); coffinLid(lb); lid.add(lb.mesh(props.coffin.userData.mat)); lid.position.set(0, 0.55, -0.9); props.coffin.add(lid); props.coffin.userData.lid = lid;
    const hand = grp("coffinhand", skeleton); void hand;
    // the tunnel: a short rotating vortex tube around the track
    const tt = keep(stripeTexture(T)); const tube = new T.Mesh(new T.CylinderGeometry(1.55, 1.55, 4.6, 20, 1, true), basic({ map: tt, color: 0x808090, side: T.DoubleSide })); tube.name = "ghost-tunnel"; props.tunnel = tube; tube.userData.tex = tt; tube.visible = false; root.add(tube);
  }
  /* ---- doors: two leaves per doorway, hinged at the outer edges just in front of the facade */
  function buildDoors() {
    const matD = basic({ vertexColors: true, side: T.DoubleSide });
    crossings.forEach((cr, i) => {
      const cfg = GHOST_DOORS[Math.min(i, GHOST_DOORS.length - 1)];
      const leaves = [];
      for (const sd of [-1, 1]) {
        const pivot = new T.Group(); pivot.position.set(cr.x + sd * cfg.w / 2, cfg.y0, ZF + 0.34);
        const lw = cfg.w / 2, lh = cfg.h, b = makeBuilder(T);
        b.box(-sd * lw / 2, lh / 2, 0, lw, lh, 0.1, 0x4a2e1c); b.box(-sd * lw / 2, lh * 0.25, 0, lw, 0.12, 0.13, 0x222228); b.box(-sd * lw / 2, lh * 0.75, 0, lw, 0.12, 0.13, 0x222228);
        pivot.add(b.mesh(matD)); root.add(pivot); leaves.push({ pivot, sd });
      }
      doors.push({ cfg, cr, leaves, open: 0, target: 0, vel: 0, banged: false, shut: false });
    });
  }
  const setDoor = (d, a) => { d.leaves.forEach(l => { l.pivot.rotation.y = (l.sd > 0 ? 1 : -1) * a; }); };
  function updateDoors(dt, s) {
    for (const d of doors) {
      const openAt = d.cr.s - d.cfg.lead, shutAt = d.cr.s + 2.6;
      if (s >= openAt && s < shutAt) d.target = 1.95; else if (s >= shutAt) d.target = 0; else d.target = 0;
      // spring towards the target (a little bounce): bang on first open, bang on slam
      d.vel += (d.target - d.open) * 90 * dt; d.vel *= Math.exp(-7 * dt); d.open += d.vel * dt;
      d.open = clamp(d.open, -0.05, 2.15);
      setDoor(d, d.open);
      if (d.target > 1 && !d.banged && d.open > 1.1) { d.banged = true; snd.bang(1); fx.shake(0.35); if (d.cfg.dir === "out") fx.strobe(0.6); }
      if (d.target === 0 && d.banged && !d.shut && d.open < 0.35) { d.shut = true; snd.bang(0.8); fx.shake(0.25); }
    }
  }
  /* ---- scares */
  const lerp = (a, b, k) => a + (b - a) * k;
  const state = { fired: new Set(), strobeT: 0, strobeN: 0, flash: {}, lastFired: 0 };
  const worldAt = (s, lat = 0, y = 0) => { const f = sp.at(s); return [f.p[0] + f.r[0] * lat, f.p[1] + y, f.p[2] + f.r[2] * lat, f]; };
  function placeFacing(g, x, y, z, fx_, fz_) { g.position.set(x, y, z); g.rotation.y = Math.atan2(fx_, fz_); }
  const flapBat = (g, rt, ph) => { const fl = Math.sin(rt * 24 + ph) * 0.8; g.children.forEach(c => { if (c.name === "wingL") c.rotation.z = fl; if (c.name === "wingR") c.rotation.z = -fl; }); };
  function updateScares(dt, s, rt) {
    for (const sc of scares) {
      const d = s - sc.s; const f = sp.at(sc.s); const g = props[sc.id] ?? props.bat0; const before = state.fired.size;
      switch (sc.id) {
        case "skeleton": {                      // pops up beside the track as the cart arrives
          const k = smooth((d + 3.2) / 0.9) * (d < 3.5 ? 1 : 0); g.visible = d > -3.4 && d < 3.6;
          const [x, y, z] = worldAt(sc.s + 1.2, 1.6, -1.9 + 1.9 * k);
          placeFacing(g, x, y, z, -f.r[0], -f.r[2]);
          if (!state.fired.has("sk") && d > -2.6) { state.fired.add("sk"); snd.sting(1); snd.creak(0.5); fx.strobe(0.5); fx.shake(0.3); }
          break; }
        case "bat": {                           // a pair of bats swoops across the track ahead
          const ph = clamp((d + 7) / 7, 0, 1); const on = d > -7 && d < 1.5; props.bat0.visible = props.bat1.visible = on;
          flapBat(props.bat0, rt, 0); flapBat(props.bat1, rt, 1.7);
          const a0 = worldAt(s + 4, lerp(-3.2, 3.2, ph), 2.1 + Math.sin(ph * 6.28) * 0.4), a1 = worldAt(s + 5.5, lerp(3.0, -3.0, ph), 2.5 + Math.sin(ph * 5 + 1) * 0.4);
          placeFacing(props.bat0, a0[0], a0[1], a0[2], f.r[0], f.r[2]); placeFacing(props.bat1, a1[0], a1[1], a1[2], -f.r[0], -f.r[2]);
          if (!state.fired.has("bat") && d > -5) { state.fired.add("bat"); snd.creak(0.35); snd.whoosh(0.7, 0.5); }
          break; }
        case "face": {                          // a lit face appears on the wall
          const near = clamp(1 - Math.abs(d + 1.5) / 5, 0, 1); g.visible = near > 0.01;
          const wx = worldAt(sc.s + 2, 3.9, 2.4);
          placeFacing(g, wx[0], wx[1], wx[2], -f.r[0], -f.r[2]); g.scale.setScalar(smooth(near * 2) * 1.25 * (0.85 + 0.15 * Math.sin(rt * 40)));
          if (!state.fired.has("face") && d > -4) { state.fired.add("face"); snd.sting(0.7); fx.strobe(0.35); snd.scream(1.1, 0.07, 400); }
          break; }
        case "strobe": {                        // a corridor with a dancing skeleton in strobe light
          const inZone = d > -4 && d < 6; props.dancer.visible = inZone;
          if (inZone) { state.strobeT -= dt; if (state.strobeT <= 0) { state.strobeT = 0.16; fx.strobe(0.8); } state.flash.strobe = 1; }
          const pos = worldAt(sc.s + 2, -1.6, 0); placeFacing(props.dancer, pos[0], pos[1], pos[2], f.r[0], f.r[2]);
          props.dancer.rotation.z = Math.sin(rt * 12) * 0.2; props.dancer.position.y += Math.abs(Math.sin(rt * 9)) * 0.25;
          break; }
        case "coffin": {                        // a coffin beside the track: the lid swings open, a bony hand rises, green light spills out
          const pos = worldAt(sc.s + 1.2, 2.0, -0.12); const open = smooth((d + 2.4) / 1.4);
          placeFacing(g, pos[0], pos[1], pos[2], -f.r[0], -f.r[2]); g.rotation.y += Math.PI / 2;                       // the coffin lies along the track
          g.userData.lid.rotation.x = -open * 1.9; const h = props.coffinhand; h.visible = open > 0.3;
          const hk = smooth((d + 1.4) / 1.0); h.position.set(pos[0], pos[1] + 0.4 + 0.3 * hk, pos[2]); h.scale.setScalar(0.5); h.rotation.y = g.rotation.y;
          h.position.y = pos[1] + 0.2 + hk * 0.7;
          if (!state.fired.has("co") && d > -2.4) { state.fired.add("co"); snd.creak(1.1); snd.bang(0.5); snd.sting(0.6); fx.shake(0.2); }
          break; }
        case "tunnel": {                        // the vortex tube: black / white / violet stripes spin around you
          const mid = worldAt(sc.s + 2.4, 0, 1.2); const tube = props.tunnel; tube.visible = d > -6 && d < 6;
          tube.position.set(mid[0], mid[1], mid[2]);
          tube.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(f.t[0], 0, f.t[2]).normalize());
          tube.userData.tex.offset.x += dt * 0.9;
          fx.setVignette(d > -2 && d < 4 ? 0.55 : 0);
          if (d > -2 && d < 4) { if (!state.fired.has("tu")) { state.fired.add("tu"); snd.whoosh(1.2, 0.6); snd.sting(0.4); } }
          break; }
        case "spider": {                        // drops from the ceiling on a thread
          const drop = smooth((d + 5) / 2.5); g.visible = props.thread.visible = d > -5.5 && d < 3;
          const pos = worldAt(sc.s + 2.2, 0, 0); const yTop = 9.0, yEye = pos[1] + 1.5; const y = lerp(yTop, yEye, drop) + (d > 0 ? smooth(d / 1.5) * 4 : 0);
          g.position.set(pos[0], y, pos[2]); g.rotation.y = Math.atan2(-f.t[0], -f.t[2]);
          props.thread.position.set(pos[0], (y + yTop) / 2, pos[2]); props.thread.scale.set(1, yTop - y, 1);
          if (!state.fired.has("sp") && d > -3) { state.fired.add("sp"); snd.sting(0.6); snd.scream(0.9, 0.06, 1300); }
          break; }
        case "ghost": {                         // a sheet glides across
          const ph = clamp((d + 6) / 8, 0, 1); g.visible = d > -6 && d < 2.2;
          const pos = worldAt(s + 3.4, lerp(3.4, -3.4, ph), 0.3 + Math.sin(ph * 12) * 0.2);
          placeFacing(g, pos[0], pos[1], pos[2], f.r[0], f.r[2]);
          if (!state.fired.has("gh") && d > -4.5) { state.fired.add("gh"); snd.creak(0.9); snd.scream(1.5, 0.05, 520); }
          break; }
        case "hands": {                         // hands reach out of the walls from both sides
          const k = smooth((d + 3) / 1.2) * (1 - smooth((d - 0.5) / 2)); g.visible = d > -3.2 && d < 3;
          const pos = worldAt(sc.s + 1.0, 0, -0.2); placeFacing(g, pos[0], pos[1], pos[2], f.t[0], f.t[2]);
          g.scale.set(1.0 + 1.3 * (1 - k), 1, 1); if (!state.fired.has("ha") && d > -2.2) { state.fired.add("ha"); snd.sting(0.8); fx.shake(0.3); }
          break; }
        case "grab": {                          // on the way down a green arm snatches at the cart
          const k = smooth((d + 3) / 1.0) * (1 - smooth((d - 0.3) / 1.4)); g.visible = d > -3.2 && d < 2.2;
          const pos = worldAt(sc.s + 1.4, 0.9, -0.1); placeFacing(g, pos[0], pos[1], pos[2], -f.r[0], -f.r[2]); g.rotation.z = lerp(-0.9, 0.2, k);
          if (!state.fired.has("gr") && d > -2) { state.fired.add("gr"); snd.sting(0.7); snd.whoosh(0.6, 0.5); fx.shake(0.4); }
          break; }
        default: break;
      }
      if (state.fired.size > before) { state.flash[sc.id] = 1.3; if (sc.id !== "skeleton" && sc.id !== "face" && sc.id !== "bat") fx.strobe(0.3); }
    }
    // every prop is dim until its scare fires: the flash lights it up and fades over a second (the strobe corridor stays lit)
    for (const [name, g] of Object.entries(props)) {
      if (!g.userData.mat) continue;
      const key = name === "dancer" ? "strobe" : name.startsWith("bat") ? "bat" : name === "coffinhand" ? "coffin" : name === "thread" ? "spider" : name;
      const k = state.flash[key] ?? 0; g.userData.mat.color.setScalar(0.42 + 0.58 * clamp(k, 0, 1));
    }
    for (const k of Object.keys(state.flash)) state.flash[k] = Math.max(0, state.flash[k] - dt * 0.9);
  }
  /* ---- the cart's front (what you see of your own cart) */
  let hood = null;
  function buildHood() {
    const b = makeBuilder(T);
    b.box(0, 0, 0, 1.0, 0.22, 0.7, 0x22222a); b.box(0, 0.13, 0.0, 1.0, 0.05, 0.7, 0xb8142a); b.ball(0, 0.25, 0.28, 0.07, 0xd8d4c4, 6);
    b.box(0, 0.14, -0.36, 0.9, 0.04, 0.06, 0xc0c4cc);                                                       // the lap bar
    hood = new T.Group(); hood.add(b.mesh(basic({ vertexColors: true }))); root.add(hood); hood.name = "ghost-hood";
  }
  function placeHood() {
    // in the model frame: just below / ahead of the eye
    const f = sp.at(st.s);
    hood.position.set(f.p[0] + f.u[0] * 0.5 + f.t[0] * 1.25, f.p[1] + f.u[1] * 0.5 + f.t[1] * 1.25, f.p[2] + f.u[2] * 0.5 + f.t[2] * 1.25);
    hood.rotation.order = "YXZ"; hood.rotation.set(-Math.asin(clamp(f.t[1], -1, 1)), Math.atan2(f.t[0], f.t[2]), 0);
  }
  function compute(dt) {
    const f = sp.at(st.s);
    tmp.set(f.p[0] + f.u[0] * GHOST.eye + f.t[0] * GHOST.ahead, f.p[1] + f.u[1] * GHOST.eye + f.t[1] * GHOST.ahead, f.p[2] + f.u[2] * GHOST.eye + f.t[2] * GHOST.ahead);
    tmpF.set(f.t[0], f.t[1], f.t[2]); tmpU.set(f.u[0], f.u[1], f.u[2]);
    group.updateWorldMatrix(true, false);
    out.position.copy(tmp).applyMatrix4(group.matrixWorld); out.forward.copy(tmpF).transformDirection(group.matrixWorld); out.up.copy(tmpU).transformDirection(group.matrixWorld);
    smoother.apply(out, dt, calm() ? 0.2 : 0.06);
  }

  return {
    kind: "ghost", id,
    start() {
      if (ud.setAnimated) ud.setAnimated(true); if (ud.setLOD) ud.setLOD(1);
      root.add(buildShell(), buildFloor(), buildDecor()); buildMurals(); buildLights(); buildProps(); buildDoors(); buildHood();
      group.add(root);
      snd.startBed("ghost");
      st.s = sStart; st.v = 0; compute(0); placeHood();
      fx.hint(env.hint, 5);
    },
    update(dt) {
      if (st.over) return true;
      st.rt += dt;
      const v = GHOST.speed * clamp(Math.min(st.rt / GHOST.ramp, (sEnd - st.s) / GHOST.brake), 0.12, 1);
      st.v = v; st.s = Math.min(sEnd, st.s + v * dt);
      updateDoors(dt, st.s); updateScares(dt, st.s, st.rt);
      // darkness: black pulses at the doorways you pass through, a dark vignette while inside
      const f = sp.at(st.s); const inside = f.p[2] < ZF - 0.2 ? 1 : 0;
      let black = 0; for (const cr of crossings) { const dd = st.s - cr.s; black = Math.max(black, cr.dir === "in" ? smooth(1 - Math.abs(dd + 0.15) / 0.75) : smooth(1 - Math.abs(dd - 0.1) / 0.5) * 0.7); }
      fx.setDark(inside * 0.28); fx.setBlack(black);
      st.inside = inside;
      snd.setBed(clamp(v / GHOST.speed, 0, 1) * 0.6, 0.1);
      compute(dt); placeHood();
      if (st.s >= sEnd - 0.01 && st.rt > 3) { st.over = true; return true; }
      return false;
    },
    get frame() { return out; },
    get progress() { return clamp((st.s - sStart) / path.length, 0, 1); },
    get left() { return Math.max(0, (sEnd - st.s) / GHOST.speed + 1); },
    get speed() { return st.v; },
    debug() { return { s: st.s - sStart, length: path.length, inside: st.inside, scaresFired: [...state.fired], doorsOpen: doors.map(d => +d.open.toFixed(2)), crossings: crossings.map(c => +(c.s - sStart).toFixed(1)) }; },
    stop() {
      group.remove(root);
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); mats.forEach(m => m.dispose()); texs.forEach(t => t.dispose());
      fx.setDark(0); fx.setBlack(0); fx.setVignette(0); snd.stopBed();
    },
  };
}
