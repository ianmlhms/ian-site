/* Geeschterbunn ride (ghost wave, 26 Oct 2026): a proper dark-ride sequence through the castle. The model's castle is a solid hall (carts vanish at the
 * painted doors), so the ride brings its own interior while it runs: a dark room shell, a winding track with UV tubes, floor fog and dust in the light
 * beams, and ten distinct scenes, each with a build-up (light + sound), a pop and a release: a coffin whose lid creaks open for a waving vampire, a
 * portrait gallery whose eyes follow, a mirror room with a ghost looming behind you, a mad-scientist lab with sparks and a bubbling flask, a library
 * of flying books, a stretching column, spider webs with a puff of air, a ghost that rushes the cart and vanishes into sparkles, a skeleton band at
 * the organ, and a finale: a fake-out door that slams shut, then the real gate opens onto daylight. The cart itself turns towards each scene (gently,
 * levelled, no roll) and the ride speeds up between scenes and slows to a near-stop at each one. Four pairs of heavy doors bang open and shut at the
 * doorways; thunder flashes through the windows and the bed carries a wind-tunnel rush throughout.
 * Everything is added to the model group while riding and removed afterwards. While the cart is sealed inside the castle (between an "in" and the next
 * "out" crossing) the main camera layer is swapped to the ride's own dedicated layer, so none of the fair/world/sky is submitted to the GPU at all for
 * that span (nothing of it would be visible through solid walls anyway): the ride's own geometry is the entire cost there. Outside the castle (the
 * approach, the balcony, the gate) the camera reverts to the normal layer and the real fair is the backdrop, as any other ride. */
import { makeSpline } from "../models/coaster-kit.js";
import { createSmoother } from "./rigs.js";
import { makeBuilder, makeTexBuilder, glowTexture, airbrushTexture, webTexture, stripeTexture } from "./mesh.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;
/** a symmetric bell curve of half-width w, 1 at d = 0, 0 beyond +-w (smootherstep shoulders) */
const bell = (d, w) => smooth(1 - Math.abs(d) / w);
/** a level frame (no roll: a dark-ride cart stays upright): up = world up made orthogonal to the track, r = horizontal right */
export function levelFrame(f) {
  const t = f.t; const d = t[1];
  let u = [-t[0] * d, 1 - t[1] * d, -t[2] * d]; const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const r = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  return { p: f.p, t, u, r };
}
const ZF = 2.6, U1X = -3.2, U2X = 6.6, G_OUT = 10.2, BAL_Y = 4.9;
export const GHOST = Object.freeze({ speed: 2.1, ramp: 2.4, brake: 6, eye: 1.3, ahead: 0.4, inside: { x0: -13.3, x1: 13.3, z0: -7.6, z1: 2.2, y0: 0.2, y1: 9.8 } });
/** camera layer reserved for the ride's own geometry (same idea as the Autoscooter's interior layer, one higher): while the cart is sealed inside the
 *  castle the main camera draws ONLY this layer, so the rest of the scene costs nothing. The hood is on both layers (visible sealed or not). */
export const GHOST_LAYER = 7;
/** how far from a scene's arc length the car eases towards it / dashes away: shared by the speed and the yaw-towards-the-scene */
const SCENE_SPAN = 3.8;
const YAW_MAX = 0.46;

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
/** control-point indices (into ghostControls) where the scenes sit, the lateral offset of the set piece and which side the cart turns towards (0 = dead ahead, no turn) */
export const GHOST_SCARES = Object.freeze([
  { id: "coffin", at: 7, lat: 1.6, side: 1 },      // the coffin lid creaks open; the vampire sits up and waves
  { id: "gallery", at: 9, lat: 2.3, side: 1 },     // a row of portraits whose eyes follow the cart
  { id: "mirror", at: 10, lat: -2.3, side: -1 },   // your own cart, reflected, and a ghost looming behind it
  { id: "lab", at: 12, lat: 2.0, side: 1 },        // a mad-scientist lab: sparks and a bubbling flask
  { id: "library", at: 13, lat: -2.0, side: -1 },  // a library where the books fly off the shelf
  { id: "stretch", at: 14, lat: 1.4, side: 1 },    // a column that stretches tall as the cart passes
  { id: "webs", at: 15, lat: 0, side: 0 },         // cobwebs brush past overhead, a puff of air on the lens
  { id: "rush", at: 16, lat: 0, side: 0 },         // a ghost rushes straight at the cart, then vanishes into sparkles
  { id: "band", at: 17, lat: 0, side: 0 },         // the skeleton band plays the pipe organ
  { id: "finale", at: 32, lat: 0, side: 0 },       // a fake-out door slams shut, then the real gate opens onto daylight
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

/* ------------------------------------------------------------------------------------------------------------------ the rig */
export function createGhostRig(env) {
  const { T, ud, def, id, fx, snd, audio, calm, group, crowd, r } = env;
  const path = ud.ghostPath || (ud.ghostPath = ghostPath());
  const { sStart, sEnd, crossings, scares } = path;
  const sp = { at: s => levelFrame(path.sp.at(s)) };
  const mats = [];
  const basic = o => { const m = new T.MeshBasicMaterial({ fog: false, ...o }); mats.push(m); return m; };
  const root = new T.Group(); root.name = "ghost-interior";
  const out = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const smoother = createSmoother(T);
  const st = { rt: 0, s: sStart, v: 0, over: false, black: 0, sealed: false, crossIdx: 0, yaw: 0, rtF: [0, 0, 1], lightning: 3 + Math.random() * 3 };
  const tmp = new T.Vector3(), tmpF = new T.Vector3(), tmpU = new T.Vector3();
  const props = {}; const doors = [];
  const I = GHOST.inside;

  const texs = [];
  const keep = o => { texs.push(o); return o; };
  const grp = (name, build, visible = false) => {
    const g = new T.Group(); g.name = name; const b = makeBuilder(T); build(b);
    const m = basic({ vertexColors: true, side: T.DoubleSide }); g.userData.mat = m; g.add(b.mesh(m)); g.visible = visible; g.layers.set(GHOST_LAYER); root.add(g); props[name] = g; return g;
  };
  const glowPts = [];           // refs to the additive Points meshes so ambient flicker can scale their opacity live
  const trackGlow = m => { glowPts.push(m); return m; };

  /* ---- the interior decor: one merged mesh (track, UV tubes, eyes, chains, red emergency lamps) */
  function buildDecor() {
    const b = makeBuilder(T);
    const at = (f, lat, along, y) => [f.p[0] + f.r[0] * lat + f.t[0] * along, f.p[1] + f.r[1] * lat + f.t[1] * along + y, f.p[2] + f.r[2] * lat + f.t[2] * along];
    for (let s = sStart; s < sEnd; s += 0.4) {
      const f0 = sp.at(s), f1 = sp.at(s + 0.4); if (f0.p[2] > ZF - 0.4 && f1.p[2] > ZF - 0.4) continue;
      for (const lat of [-0.45, 0.45]) b.quad([f0.p[0] + f0.r[0] * (lat - 0.045), f0.p[1] - 0.04, f0.p[2] + f0.r[2] * (lat - 0.045)], [f0.p[0] + f0.r[0] * (lat + 0.045), f0.p[1] - 0.04, f0.p[2] + f0.r[2] * (lat + 0.045)], [f1.p[0] + f1.r[0] * (lat + 0.045), f1.p[1] - 0.04, f1.p[2] + f1.r[2] * (lat + 0.045)], [f1.p[0] + f1.r[0] * (lat - 0.045), f1.p[1] - 0.04, f1.p[2] + f1.r[2] * (lat - 0.045)], 0x9aa4bc);
    }
    for (let s = sStart; s < sEnd; s += 0.75) { const f = sp.at(s); if (f.p[2] > ZF - 0.4) continue; b.quad(at(f, -0.75, -0.09, -0.09), at(f, 0.75, -0.09, -0.09), at(f, 0.75, 0.09, -0.09), at(f, -0.75, 0.09, -0.09), 0x4a4a62); }
    // black-light UV tubes and glowing eyes
    const uv = [0x9a5aff, 0x35e6ff, 0xff3fc8, 0x39ff7a];
    for (let i = 0; i < 26; i++) { const x = I.x0 + 0.4 + (i / 25) * (I.x1 - I.x0 - 0.8); b.box(x, 0.65, I.z0 + 0.15, 0.1, 0.1, 0.1, uv[i % 4]); b.box(x, 7.4, I.z0 + 0.2, 0.9, 0.12, 0.12, uv[(i + 1) % 4]); }
    for (let i = 0; i < 14; i++) b.box(I.x0 + 0.2, 1.0 + (i % 5) * 1.5, I.z0 + 1.0 + (i / 13) * (I.z1 - I.z0 - 2), 0.1, 0.9 + (i % 3) * 0.4, 0.1, uv[i % 4]);
    const eyes = [[-12.4, 3.1, -4.0], [12.4, 2.6, -1.0], [-4.0, 5.2, -7.3], [5.0, 1.6, -7.3], [12.4, 4.4, -5.6], [-12.4, 1.4, -0.4], [0.5, 3.4, -7.3], [9.8, 5.6, -7.3]];
    for (const [x, y, z] of eyes) { const dz = Math.abs(x) > 12 ? 0 : 1; for (const k of [-0.18, 0.18]) b.box(x + (dz ? k : 0), y, z + (dz ? 0 : k), 0.1, 0.05, 0.1, 0xffe14a); }
    // hanging chains, and red emergency lamps (a red box on a bracket) on the walls
    for (let i = 0; i < 12; i++) b.box(-11 + i * 2, 8.6, -6.2 + (i % 3) * 1.5, 0.06, 2.0 + (i % 4) * 0.6, 0.06, 0x5a5a70);
    for (const [x, z] of [[-12.9, -2], [-12.9, 0.8], [12.9, -3], [12.9, 0.6], [-9, -7.3], [-3, -7.3], [3, -7.3], [9, -7.3]]) { b.box(x, 2.9, z, 0.2, 0.28, 0.2, 0xff2a1a); b.box(x, 3.1, z, 0.28, 0.06, 0.28, 0x3a3a48); }
    const mesh = b.mesh(basic({ vertexColors: true, side: T.DoubleSide })); mesh.name = "ghost-decor"; mesh.frustumCulled = false; mesh.layers.set(GHOST_LAYER);
    return mesh;
  }
  function buildShell() {
    const w = I.x1 - I.x0, d = I.z1 - I.z0, h = I.y1 - I.y0;
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), basic({ color: 0x120a1e, side: T.BackSide }));
    m.position.set((I.x0 + I.x1) / 2, (I.y0 + I.y1) / 2, (I.z0 + I.z1) / 2); m.name = "ghost-shell"; m.layers.set(GHOST_LAYER); return m;
  }
  function buildFloor() {
    const m = new T.Mesh(new T.PlaneGeometry(I.x1 - I.x0, I.z1 - I.z0), basic({ color: 0x2a2236, side: T.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set((I.x0 + I.x1) / 2, 0.55, (I.z0 + I.z1) / 2); m.name = "ghost-floor"; m.layers.set(GHOST_LAYER); return m;
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
    kinds.forEach((k, i) => { const t = keep(airbrushTexture(T, k, i + 1)); const m = tb[i].mesh(basic({ map: t, color: 0xb0b0b0, side: T.DoubleSide })); m.name = "ghost-mural-" + k; m.frustumCulled = false; m.layers.set(GHOST_LAYER); root.add(m); });
  }
  /** coloured spotlight cones (additive, bright at the lamp, black at the floor), a floor haze with dust caught in the beams and pale fog near the ground, and cobwebs */
  function buildLights() {
    const b = makeBuilder(T), cols = [0xff2a2a, 0x39ff7a, 0x9a5aff, 0x35c8ff, 0xff7a1a], haze = [], hcol = [], beams = [];
    let k = 0;
    for (let s = sStart + 6; s < sEnd - 3; s += 7.5, k++) {
      const f = sp.at(s); if (f.p[2] > ZF - 1.2 || f.p[1] > 2) continue;
      const side = k % 2 ? 1 : -1, apex = [f.p[0] + f.r[0] * side * 3 - f.t[0] * 2, 9.4, f.p[2] + f.r[2] * side * 3 - f.t[2] * 2], base = [f.p[0] + f.r[0] * side * 0.6 + f.t[0] * 2, 0.62, f.p[2] + f.r[2] * side * 0.6 + f.t[2] * 2];
      b.cone(apex, base, 1.7, 12, cols[k % cols.length]); beams.push({ apex, base });
    }
    const cm = new T.Mesh(b.mesh(basic()).geometry, basic({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide })); cm.name = "ghost-cones"; cm.frustumCulled = false; cm.renderOrder = 2; cm.layers.set(GHOST_LAYER); root.add(cm);
    for (let i = 0; i < 46; i++) { const f = sp.at(sStart + 4 + (i / 46) * (path.length - 8)); if (f.p[2] > ZF - 0.5) continue; haze.push(f.p[0] + (Math.random() - 0.5) * 6, 0.9 + Math.random() * 0.8, f.p[2] + (Math.random() - 0.5) * 6); const c = new T.Color([0x4a2a8a, 0x1a4a6a, 0x6a1a3a][i % 3]); hcol.push(c.r, c.g, c.b); }
    // dust motes caught inside the light beams (a few extra points along each beam, bright and nearly white: no extra draw, same merged mesh)
    for (const be of beams) for (let i = 0; i < 7; i++) { const f = Math.random(); haze.push(lerp(be.apex[0], be.base[0], f) + (Math.random() - 0.5) * 0.6, lerp(be.apex[1], be.base[1], f), lerp(be.apex[2], be.base[2], f) + (Math.random() - 0.5) * 0.6); const c = new T.Color(0xeee6ff); hcol.push(c.r, c.g, c.b); }
    // pale fog pooling at floor level along the whole circuit (same merged mesh, low and dense near y ~ 0.3)
    for (let i = 0; i < 70; i++) { const f = sp.at(sStart + 2 + (i / 70) * (path.length - 4)); if (f.p[2] > ZF - 0.3) continue; haze.push(f.p[0] + f.r[0] * (Math.random() - 0.5) * 4.4, 0.25 + Math.random() * 0.35, f.p[2] + f.r[2] * (Math.random() - 0.5) * 4.4); const c = new T.Color(0x8a94aa); hcol.push(c.r, c.g, c.b); }
    const hg = new T.BufferGeometry(); hg.setAttribute("position", new T.BufferAttribute(new Float32Array(haze), 3)); hg.setAttribute("color", new T.BufferAttribute(new Float32Array(hcol), 3));
    const hm = new T.Points(hg, new T.PointsMaterial({ size: 3.0, map: keep(glowTexture(T)), vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false, blending: T.AdditiveBlending, fog: false })); mats.push(hm.material); hm.frustumCulled = false; hm.name = "ghost-haze"; hm.renderOrder = 3; hm.layers.set(GHOST_LAYER); root.add(hm); trackGlow(hm);
    // red glow around the emergency lamps (flickers with the ambient lightning/power-flicker)
    const rp = []; for (const [x, z] of [[-12.9, -2], [-12.9, 0.8], [12.9, -3], [12.9, 0.6], [-9, -7.3], [-3, -7.3], [3, -7.3], [9, -7.3]]) rp.push(x, 3.0, z);
    const rg = new T.BufferGeometry(); rg.setAttribute("position", new T.BufferAttribute(new Float32Array(rp), 3));
    const rm = new T.Points(rg, new T.PointsMaterial({ size: 1.8, map: keep(glowTexture(T, "255,40,30")), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); mats.push(rm.material); rm.frustumCulled = false; rm.name = "ghost-redglow"; rm.renderOrder = 3; rm.layers.set(GHOST_LAYER); root.add(rm); trackGlow(rm);
    // cobwebs: the corners of the room and a few across the ceiling over the track (the "webs" scene brushes through these)
    const tb = makeTexBuilder(T), wq = (x, y, z, ax, ay, sz) => tb.quad([x, y, z], [x + ax[0] * sz, y + ax[1] * sz, z + ax[2] * sz], [x + (ax[0] + ay[0]) * sz, y + (ax[1] + ay[1]) * sz, z + (ax[2] + ay[2]) * sz], [x + ay[0] * sz, y + ay[1] * sz, z + ay[2] * sz]);
    wq(I.x0 + 0.05, 9.7, I.z0 + 0.05, [1, 0, 0], [0, -1, 0], 2.6); wq(I.x1 - 0.05, 9.7, I.z0 + 0.05, [-1, 0, 0], [0, -1, 0], 2.6); wq(I.x0 + 0.05, 9.7, I.z1 - 0.05, [1, 0, 0], [0, -1, 0], 2.2); wq(I.x1 - 0.05, 9.7, I.z1 - 0.05, [-1, 0, 0], [0, -1, 0], 2.2);
    for (const sc of scares) { const f = sp.at(sc.s - 1.2); if (f.p[2] > ZF - 1 || f.p[1] > 2) continue; const sd = sc.at % 2 ? 1 : -1; wq(f.p[0] + f.r[0] * 2.6 * sd, 4.2, f.p[2] + f.r[2] * 2.6 * sd, [-f.r[0] * sd, 0, -f.r[2] * sd], [0, -1, 0], 1.7); }
    const wm = tb.mesh(basic({ map: keep(webTexture(T)), transparent: true, depthWrite: false, side: T.DoubleSide })); wm.name = "ghost-webs"; wm.frustumCulled = false; wm.layers.set(GHOST_LAYER); root.add(wm);
  }

  /* ---- reusable small figures (vertex-colour builder functions, shared by more than one scene) */
  function skeletonFigure(b) {
    const bone = 0xf0ecd8, shade = 0xc8c2a8, dark = 0x100a16;
    b.ball(0, 1.8, 0, 0.2, bone, 8); b.box(0, 1.64, 0.1, 0.22, 0.1, 0.16, bone); b.box(0, 1.58, 0.09, 0.2, 0.05, 0.14, shade);             // skull, jaw
    for (const sx of [-1, 1]) { b.ball(sx * 0.075, 1.82, 0.16, 0.055, dark, 5); b.box(sx * 0.07, 1.9, 0.12, 0.02, 0.02, 0.02, 0xff2a1a); }
    b.tri([-0.03, 1.74, 0.2], [0.03, 1.74, 0.2], [0, 1.68, 0.21], dark);
    for (let k = -3; k <= 3; k++) b.box(k * 0.025, 1.595, 0.17, 0.015, 0.03, 0.02, bone);                                                    // teeth
    b.beam([0, 1.0, 0], [0, 1.58, 0], 0.07, 0.07, shade);                                                                                   // spine
    for (let k = 0; k < 5; k++) { const y = 1.5 - k * 0.095, rr = 0.2 - Math.abs(k - 1) * 0.018; b.ring([0, y, 0.01], [1, 0, 0], [0, 0, 1], rr, 10, 0.03, 0.035, bone); }   // ribs
    b.box(0, 0.96, 0, 0.34, 0.12, 0.16, bone); b.box(0, 1.52, 0, 0.5, 0.04, 0.1, bone);                                                       // pelvis, collar bone
    for (const sx of [-1, 1]) {
      b.beam([sx * 0.1, 0.92, 0], [sx * 0.14, 0.5, 0.03], 0.06, 0.06, bone); b.beam([sx * 0.14, 0.5, 0.03], [sx * 0.13, 0.06, 0], 0.05, 0.05, bone); b.box(sx * 0.13, 0.03, 0.08, 0.1, 0.05, 0.22, bone);
      b.ball(sx * 0.14, 0.5, 0.03, 0.045, shade, 5);
    }
    b.beam([-0.25, 1.52, 0], [-0.42, 1.25, 0.05], 0.05, 0.05, bone); b.beam([-0.42, 1.25, 0.05], [-0.36, 0.98, 0.12], 0.045, 0.045, bone);
    b.beam([0.25, 1.52, 0], [0.44, 1.8, 0.1], 0.05, 0.05, bone); b.beam([0.44, 1.8, 0.1], [0.38, 2.1, 0.22], 0.045, 0.045, bone);              // one arm raised (waving / playing)
    for (let k = -1; k <= 1; k++) b.box(0.38 + k * 0.025, 2.2, 0.24, 0.02, 0.12, 0.02, bone);
  }
  /** a pale gliding sheet: used by the mirror room (looming behind you) and the rush (coming straight at you) */
  function ghostSheet(b) {
    const sheet = 0xf6f4ff;
    b.ball(0, 1.7, 0, 0.42, sheet, 8); b.box(0, 1.0, 0, 0.8, 1.4, 0.55, sheet); b.box(-0.55, 1.2, 0.1, 0.3, 0.12, 0.2, sheet); b.box(0.55, 1.2, 0.1, 0.3, 0.12, 0.2, sheet);
    b.box(-0.15, 1.75, 0.38, 0.12, 0.2, 0.05, 0x14101c); b.box(0.15, 1.75, 0.38, 0.12, 0.2, 0.05, 0x14101c); b.ball(0, 1.5, 0.4, 0.1, 0x14101c, 5);
    for (let k = -2; k <= 2; k++) b.tri([k * 0.17 - 0.08, 0.35, 0.28], [k * 0.17 + 0.08, 0.35, 0.28], [k * 0.17, 0.05, 0.28], sheet);
  }
  /** a glowing green face, used for the finale's one-frame scare behind the fake door */
  function scaryFace(b) {
    const glow = 0xc8ffa8, dark = 0x0a0612;
    b.ball(0, 0, 0, 0.8, glow, 10); b.ball(-0.26, 0.14, 0.62, 0.17, dark, 6); b.ball(0.26, 0.14, 0.62, 0.17, dark, 6); b.box(0, -0.3, 0.7, 0.55, 0.12, 0.12, dark);
    for (let k = -2; k <= 2; k++) b.box(k * 0.11, -0.22, 0.72, 0.06, 0.14, 0.06, 0xf4f0d0); b.tri([-0.1, 0.04, 0.78], [0.1, 0.04, 0.78], [0, -0.14, 0.78], dark);
    b.tri([-0.45, 0.45, 0.55], [-0.1, 0.35, 0.7], [-0.3, 0.3, 0.7], dark); b.tri([0.45, 0.45, 0.55], [0.1, 0.35, 0.7], [0.3, 0.3, 0.7], dark);
  }

  /* ---- scene 1: coffin + vampire */
  function coffin(b) {
    const wood = 0x4a2a1a, trim = 0xd8a830, dark = 0x0a0610;
    const pts = [[-0.3, 0.9], [0.3, 0.9], [0.45, 0.4], [0.3, -0.9], [-0.3, -0.9], [-0.45, 0.4]];
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
  /** a pale vampire figure, lying flat (hidden inside the coffin) until it sits up: group rotation.x carries the recline, "armR" waves once up */
  function vampire(b) {
    const skin = 0xe6d8d0, cape = 0x3a0a12, capeIn = 0x8a142a, hair = 0x14101c, fang = 0xf4f0e0;
    b.box(0, 0.78, 0, 0.5, 0.32, 0.9, cape); b.box(0, 0.86, 0.05, 0.4, 0.2, 0.7, 0x1a1a22);                                    // cape body + shirt
    b.ball(0, 1.18, 0.32, 0.22, skin, 8); b.box(-0.1, 1.3, 0.5, 0.08, 0.1, 0.03, hair); b.box(0.1, 1.3, 0.5, 0.08, 0.1, 0.03, hair);
    for (const sx of [-0.07, 0.07]) b.box(sx, 1.1, 0.5, 0.025, 0.05, 0.02, fang);
    for (const sx of [-1, 1]) b.ball(sx * 0.1, 1.2, 0.45, 0.04, 0xd81818, 5);
    b.tri([-0.4, 1.0, -0.3], [-0.9, 1.5, -0.1], [-0.55, 0.8, -0.3], capeIn); b.tri([0.4, 1.0, -0.3], [0.9, 1.5, -0.1], [0.55, 0.8, -0.3], capeIn); // cape collar fans
  }

  /* ---- scene 2: portrait gallery (eyes follow) */
  function portraitFrame(b, tone0, tone1) {
    b.box(0, 0, 0, 1.1, 1.5, 0.08, 0x2a1a14); b.box(0, 0, 0.05, 0.9, 1.3, 0.04, tone0);
    b.ball(0, 0.18, 0.1, 0.42, tone1, 8); b.box(0, -0.55, 0.1, 0.7, 0.55, 0.06, tone1);
  }

  /* ---- scene 4: mad-scientist lab */
  function flask(b) {
    b.ball(0, 0.3, 0, 0.32, 0x294a3a, 8); b.beam([0, 0.55, 0], [0, 0.9, 0], 0.09, 0.09, 0x2a3a3a); b.box(0, 0.95, 0, 0.22, 0.06, 0.22, 0x4a5a5a);
    b.ball(0, 0.28, 0, 0.27, 0x3af0a0, 7);                                                                                        // the glowing liquid
  }
  function sparkRod(b) { b.beam([0, 0, 0], [0, 1.6, 0], 0.06, 0.06, 0x3a3a44); b.ball(0, 1.6, 0, 0.12, 0xd8d8f0, 6); }

  /* ---- scene 5: library (books fly) */
  function shelfUnit(b) {
    b.box(0, 0, 0, 1.6, 0.08, 0.42, 0x3a2416); b.box(0, 0.6, 0, 1.6, 0.08, 0.42, 0x3a2416); b.box(-0.76, 0.3, 0, 0.06, 0.6, 0.42, 0x3a2416); b.box(0.76, 0.3, 0, 0.06, 0.6, 0.42, 0x3a2416);
    const cols = [0x8a2a2a, 0x2a5a4a, 0x4a3a8a, 0xb8862a]; for (let i = 0; i < 9; i++) { const x = -0.68 + i * 0.16; b.box(x, 0.3, 0, 0.12, 0.5, 0.3, cols[i % 4]); }
  }
  function book(b) { b.box(0, 0, 0, 0.3, 0.06, 0.22, 0x8a2a2a); b.box(0, 0.04, 0, 0.26, 0.02, 0.2, 0xe8dcc0); }

  /* ---- scene 6: stretch room */
  function stretchColumn(b) { b.box(0, 1.3, 0, 0.5, 2.6, 0.08, 0x241a2a); b.box(0, 2.5, 0, 0.42, 0.9, 0.05, 0xd8c8e0); b.ball(0, 2.7, 0.03, 0.18, 0xe8d8e8, 6); }

  /* ---- scene 7: webs */
  function spider(b) {
    b.ball(0, 0, 0, 0.28, 0x1a1020, 7); b.ball(0, 0.04, 0.26, 0.17, 0x1a1020, 6); b.box(-0.07, 0.1, 0.38, 0.06, 0.06, 0.04, 0xff2a2a); b.box(0.07, 0.1, 0.38, 0.06, 0.06, 0.04, 0xff2a2a);
    b.box(0, 0.16, -0.05, 0.1, 0.05, 0.3, 0xff7a1a);
    for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) { const zz = -0.15 + k * 0.14; b.beam([sd * 0.2, 0.05, zz], [sd * 0.55, 0.22, zz], 0.045, 0.045, 0x1a1020); b.beam([sd * 0.55, 0.22, zz], [sd * 0.78, -0.25, zz + 0.05], 0.04, 0.04, 0x1a1020); }
  }

  /* ---- scene 9: skeleton band + organ */
  function organFacade(b) {
    b.box(0, 1.4, 0, 2.4, 2.8, 0.3, 0x3a2a1a);
    for (let i = 0; i < 9; i++) { const x = -1.0 + i * 0.25, h = 1.6 + Math.sin(i * 0.9) * 0.7; b.beam([x, 0.1, 0.2], [x, 0.1 + h, 0.2], 0.08, 0.08, 0xc8b878); }
    b.box(0, 0.25, 0.5, 1.6, 0.5, 0.4, 0x241a12);
  }

  /* ---- scene 10: finale, the fake-out door */
  function fakeDoor(b) {
    b.box(0, 1.3, 0, 1.9, 2.6, 0.12, 0x2a1a12); b.box(0, 1.3, 0.08, 1.6, 2.2, 0.03, 0xffe8b0); b.box(0.75, 1.3, 0.1, 0.1, 2.5, 0.1, 0x5a3a22); b.box(-0.75, 1.3, 0.1, 0.1, 2.5, 0.1, 0x5a3a22);
  }

  function buildProps() {
    grp("coffin", coffin, true);
    { const lid = new T.Group(); lid.name = "lid"; const lb = makeBuilder(T); coffinLid(lb); lid.add(lb.mesh(props.coffin.userData.mat)); lid.layers.set(GHOST_LAYER); lid.position.set(0, 0.55, -0.9); props.coffin.add(lid); props.coffin.userData.lid = lid; }
    { const v = grp("vampire", vampire); const arm = new T.Group(); arm.name = "armR"; const ab = makeBuilder(T); ab.beam([0, 0, 0], [0, 0.55, 0.05], 0.06, 0.06, 0xe6d8d0); ab.ball(0, 0.58, 0.07, 0.05, 0xe6d8d0, 5); arm.position.set(0.3, 1.0, 0.0); arm.layers.set(GHOST_LAYER); arm.add(ab.mesh(v.userData.mat)); v.add(arm); v.userData.arm = arm; v.rotation.x = -1.5; }

    grp("gallery0", b => portraitFrame(b, 0x7a6048, 0xd8c0a8), false);
    grp("gallery1", b => portraitFrame(b, 0x5a4a6a, 0xcac0d8), false);
    { const eg = new T.BufferGeometry(); const n = 6; eg.setAttribute("position", new T.BufferAttribute(new Float32Array(n * 3), 3));
      const em = new T.Points(eg, new T.PointsMaterial({ size: 0.09, color: 0x14100c, sizeAttenuation: true, fog: false })); em.visible = false; em.frustumCulled = false; em.name = "gallery-eyes"; em.layers.set(GHOST_LAYER);
      root.add(em); props.galleryEyes = em; mats.push(em.material); }

    grp("mirrorGhost", ghostSheet);
    { const tb = makeTexBuilder(T); tb.quad([-0.75, 0.3, 0], [0.75, 0.3, 0], [0.75, 2.4, 0], [-0.75, 2.4, 0]);
      const m = tb.mesh(basic({ map: keep(airbrushTexture(T, "mirror", 4)), transparent: true, opacity: 0.88, side: T.DoubleSide })); m.name = "mirror-panel"; m.visible = false; m.layers.set(GHOST_LAYER); root.add(m); props.mirrorPanel = m; }

    grp("flask", flask); grp("sparkA", sparkRod); grp("sparkB", sparkRod);
    { const bg = new T.BufferGeometry(); const n = 5; bg.setAttribute("position", new T.BufferAttribute(new Float32Array(n * 3), 3));
      const bm = new T.Points(bg, new T.PointsMaterial({ size: 0.1, map: keep(glowTexture(T, "80,255,170")), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); bm.visible = false; bm.frustumCulled = false; bm.name = "flask-bubbles"; bm.layers.set(GHOST_LAYER);
      root.add(bm); props.bubbles = bm; mats.push(bm.material); }

    grp("shelf", shelfUnit);
    for (let i = 0; i < 4; i++) grp("book" + i, book);

    grp("stretch", stretchColumn);
    grp("spider", spider); grp("thread", b => b.box(0, 0, 0, 0.02, 1, 0.02, 0xe8e8f8));
    grp("rushGhost", ghostSheet);
    { const sg = new T.BufferGeometry(); const n = 24; sg.setAttribute("position", new T.BufferAttribute(new Float32Array(n * 3), 3));
      const sm = new T.Points(sg, new T.PointsMaterial({ size: 0.16, map: keep(glowTexture(T, "255,232,170")), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); sm.visible = false; sm.frustumCulled = false; sm.name = "ghost-sparkle"; sm.layers.set(GHOST_LAYER);
      root.add(sm); props.sparkle = sm; mats.push(sm.material); }

    grp("organ", organFacade); grp("band0", skeletonFigure); grp("band1", skeletonFigure); grp("band2", skeletonFigure);

    grp("fakeDoor", fakeDoor); grp("scaryFace", scaryFace);
  }

  /* ---- doors: two leaves per doorway, hinged at the outer edges just in front of the facade */
  function buildDoors() {
    const matD = basic({ vertexColors: true, side: T.DoubleSide });
    crossings.forEach((cr, i) => {
      const cfg = GHOST_DOORS[Math.min(i, GHOST_DOORS.length - 1)];
      const leaves = [];
      for (const sd of [-1, 1]) {
        const pivot = new T.Group(); pivot.position.set(cr.x + sd * cfg.w / 2, cfg.y0, ZF + 0.34); pivot.layers.enable(GHOST_LAYER);     // visible sealed or not: the swing into view as you approach is worth keeping
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
      d.vel += (d.target - d.open) * 90 * dt; d.vel *= Math.exp(-7 * dt); d.open += d.vel * dt;
      d.open = clamp(d.open, -0.05, 2.15);
      setDoor(d, d.open);
      if (d.target > 1 && !d.banged && d.open > 1.1) { d.banged = true; snd.bang(1); fx.shake(0.35); if (d.cfg.dir === "out") fx.strobe(0.6); }
      if (d.target === 0 && d.banged && !d.shut && d.open < 0.35) { d.shut = true; snd.bang(0.8); fx.shake(0.25); }
    }
  }

  /* ---- scenes: build-up, pop, release. `d` = arc-length distance from the scene's s; `k` = 0..1 how dim->lit the set piece is (the flash fade) */
  const state = { fired: new Set(), flash: {}, puffed: new Set() };
  const worldAt = (s, lat = 0, y = 0) => { const f = sp.at(s); return [f.p[0] + f.r[0] * lat, f.p[1] + y, f.p[2] + f.r[2] * lat, f]; };
  function placeFacing(g, x, y, z, fx_, fz_) { g.position.set(x, y, z); g.rotation.y = Math.atan2(fx_, fz_); }
  function updateScares(dt, s, rt) {
    for (const sc of scares) {
      const d = s - sc.s; const f = sp.at(sc.s); const g = props[sc.id] ?? null; const before = state.fired.size;
      switch (sc.id) {
        case "coffin": {                               // the lid creaks open, the vampire sits up and waves
          const pos = worldAt(sc.s + 1.2, sc.lat, -0.12); const open = smooth((d + 2.6) / 1.6);
          placeFacing(props.coffin, pos[0], pos[1], pos[2], -f.r[0], -f.r[2]); props.coffin.rotation.y += Math.PI / 2;
          props.coffin.userData.lid.rotation.x = -open * 1.85;
          const v = props.vampire; v.visible = open > 0.15;
          v.position.set(pos[0], pos[1] + 0.02, pos[2]); v.rotation.y = props.coffin.rotation.y;
          v.rotation.x = lerp(-1.5, 0, smooth((d + 1.6) / 1.2));
          if (v.userData.arm) v.userData.arm.rotation.z = d > -0.4 ? Math.sin(rt * 7) * 0.5 - 0.3 : -1.1;
          if (!state.fired.has("coffin") && d > -2.2) { state.fired.add("coffin"); snd.creak(1.1); fx.shake(0.15); }
          if (!state.fired.has("coffinPop") && d > -0.3) { state.fired.add("coffinPop"); snd.bang(0.35); snd.cackle(1); fx.strobe(0.55); }
          break; }
        case "gallery": {                               // the eyes follow the cart past three portraits
          const near = clamp(1 - Math.abs(d) / 5.5, 0, 1); const on = near > 0.02;
          props.gallery0.visible = props.gallery1.visible = props.galleryEyes.visible = on;
          const p0 = worldAt(sc.s - 1.1, sc.lat, 2.6), p1 = worldAt(sc.s + 1.4, sc.lat, 2.6);
          placeFacing(props.gallery0, p0[0], p0[1], p0[2], -f.r[0], -f.r[2]); placeFacing(props.gallery1, p1[0], p1[1], p1[2], -f.r[0], -f.r[2]);
          if (on) {
            const look = clamp(d / 3.2, -1, 1) * 0.1;             // the pupils slide with the cart's position, as if tracking it
            const arr = props.galleryEyes.geometry.attributes.position.array;
            [[p0, -0.14], [p0, 0.14], [p1, -0.14], [p1, 0.14]].forEach(([p, ex], i) => { arr[i * 3] = p[0] - f.r[0] * look + f.r[0] * ex; arr[i * 3 + 1] = p[1] + 0.06; arr[i * 3 + 2] = p[2] - f.r[2] * look + f.r[2] * ex; });
            arr[12] = p0[0]; arr[13] = p0[1] - 100; arr[14] = p0[2]; arr[15] = p1[0]; arr[16] = p1[1] - 100; arr[17] = p1[2];        // two spare points, parked far below
            props.galleryEyes.geometry.attributes.position.needsUpdate = true;
          }
          if (!state.fired.has("gallery") && d > -3.5) { state.fired.add("gallery"); snd.creak(0.4); }
          if (!state.fired.has("galleryPop") && d > 0.4) { state.fired.add("galleryPop"); snd.sting(0.45); }
          break; }
        case "mirror": {                                 // your cart passes a mirror; a ghost looms up behind the glass, then a "boo"
          const pos = worldAt(sc.s, sc.lat, 1.5); const near = clamp(1 - Math.abs(d) / 4.2, 0, 1);
          props.mirrorPanel.visible = near > 0.02;
          placeFacing(props.mirrorPanel, pos[0], pos[1], pos[2], -f.r[0], -f.r[2]);
          const rise = smooth((d + 2.6) / 2.2); const gh = props.mirrorGhost; gh.visible = rise > 0.04 && d < 1.4;
          placeFacing(gh, pos[0], pos[1] - 1.0 + rise * 1.05, pos[2] - 0.08, -f.r[0], -f.r[2]); gh.scale.setScalar(0.7 + rise * 0.35);
          if (!state.fired.has("mirror") && d > -3.0) { state.fired.add("mirror"); snd.whoosh(1.0, 0.4); }
          if (!state.fired.has("mirrorPop") && d > -0.2) { state.fired.add("mirrorPop"); snd.scream(1.0, 0.1, 900); fx.strobe(0.5); }
          break; }
        case "lab": {                                    // sparks crackle between two rods, the flask bubbles
          const near = clamp(1 - Math.abs(d) / 4.6, 0, 1); const on = near > 0.02;
          props.flask.visible = props.sparkA.visible = props.sparkB.visible = props.bubbles.visible = on;
          const pf = worldAt(sc.s, sc.lat, 0.6), pa = worldAt(sc.s - 0.7, sc.lat + 1.1, 0), pb = worldAt(sc.s + 0.7, sc.lat + 1.1, 0);
          placeFacing(props.flask, pf[0], pf[1], pf[2], -f.r[0], -f.r[2]); props.flask.scale.setScalar(1 + Math.sin(rt * 3) * 0.05);
          placeFacing(props.sparkA, pa[0], pa[1], pa[2], -f.r[0], -f.r[2]); placeFacing(props.sparkB, pb[0], pb[1], pb[2], -f.r[0], -f.r[2]);
          if (on) {
            const arr = props.bubbles.geometry.attributes.position.array;
            for (let i = 0; i < 5; i++) { const ph = ((rt * 0.6 + i / 5) % 1); arr[i * 3] = pf[0] + Math.sin(i * 2) * 0.1; arr[i * 3 + 1] = pf[1] - 0.15 + ph * 0.45; arr[i * 3 + 2] = pf[2]; }
            props.bubbles.geometry.attributes.position.needsUpdate = true;
            const spark = (Math.sin(rt * 37) > 0.3) || (Math.sin(rt * 53 + 1) > 0.6);
            if (spark && Math.random() < 0.5) { fx.strobe(0.3); if (!state.puffed.has("labzap" + Math.floor(rt * 6))) { state.puffed.add("labzap" + Math.floor(rt * 6)); snd.zap(0.7); } }
          }
          if (!state.fired.has("lab") && d > -3.2) { state.fired.add("lab"); snd.zap(0.5); }
          if (!state.fired.has("labPop") && d > -0.2) { state.fired.add("labPop"); snd.bang(0.3); fx.strobe(0.45); }
          break; }
        case "library": {                                // books fly off the shelf as the cart passes
          const near = clamp(1 - Math.abs(d) / 4.4, 0, 1); const on = near > 0.02;
          props.shelf.visible = on;
          const pshelf = worldAt(sc.s, sc.lat, 1.0); placeFacing(props.shelf, pshelf[0], pshelf[1], pshelf[2], -f.r[0], -f.r[2]);
          for (let i = 0; i < 4; i++) {
            const bk = props["book" + i]; const ph = clamp((d + 1.0 - i * 0.5) / 2.6, 0, 1); bk.visible = on && ph > 0.001 && ph < 1;
            if (bk.visible) {
              const arc = Math.sin(ph * Math.PI); const along = lerp(0, 2.6, ph), lat = sc.lat + lerp(0, -2.0 - i * 0.3, ph);
              const p = worldAt(sc.s + along * 0.35, lat, 0.4 + arc * 1.5);
              bk.position.set(p[0], p[1], p[2]); bk.rotation.set(ph * 5, ph * 7, ph * 4);
            }
          }
          if (!state.fired.has("library") && d > -2.8) { state.fired.add("library"); snd.whoosh(0.8, 0.5); }
          if (!state.fired.has("libraryPop") && d > -0.8) { state.fired.add("libraryPop"); snd.thud(0.4); fx.shake(0.15); }
          break; }
        case "stretch": {                                // a column stretches tall as the cart passes
          const near = clamp(1 - Math.abs(d) / 4.0, 0, 1); const g2 = props.stretch; g2.visible = near > 0.02;
          const pos = worldAt(sc.s, sc.lat, 1.3); placeFacing(g2, pos[0], pos[1], pos[2], -f.r[0], -f.r[2]);
          const stretchK = smooth((d + 2.2) / 3.0); g2.scale.set(1, lerp(1, 1.85, stretchK), 1);
          if (!state.fired.has("stretch") && d > -2.6) { state.fired.add("stretch"); snd.creak(1.8); }
          if (!state.fired.has("stretchPop") && d > 0.6) { state.fired.add("stretchPop"); snd.whoosh(1.1, 0.25); }
          break; }
        case "webs": {                                   // cobwebs brush past overhead with a puff of air on the lens
          const drop = smooth((d + 5) / 2.5); const sp2 = props.spider; sp2.visible = props.thread.visible = d > -5.5 && d < 3;
          const pos2 = worldAt(sc.s + 2.2, 0, 0); const yTop = 9.0, yEye = pos2[1] + 1.5; const y = lerp(yTop, yEye, drop) + (d > 0 ? smooth(d / 1.5) * 4 : 0);
          sp2.position.set(pos2[0], y, pos2[2]); sp2.rotation.y = Math.atan2(-f.t[0], -f.t[2]);
          props.thread.position.set(pos2[0], (y + yTop) / 2, pos2[2]); props.thread.scale.set(1, yTop - y, 1);
          if (!state.fired.has("webs") && d > -3) { state.fired.add("webs"); snd.sting(0.45); }
          if (!state.fired.has("websPop") && d > -0.4) { state.fired.add("websPop"); fx.spray(42, 0.55); snd.whoosh(0.45, 0.6); }
          break; }
        case "rush": {                                    // a ghost rushes straight at the cart, then vanishes into sparkles
          const g3 = props.rushGhost; const approach = clamp((d + 7) / 7, 0, 1);
          g3.visible = d > -7 && d < 0.3;
          if (g3.visible) { const pos3 = worldAt(s + 1.0 + (1 - approach) * 5, 0, 1.2); placeFacing(g3, pos3[0], pos3[1], pos3[2], f.t[0], f.t[2]); g3.scale.setScalar(lerp(0.55, 2.4, approach)); }
          if (!state.fired.has("rush") && d > -6) { state.fired.add("rush"); snd.cackle(0.8); snd.whoosh(1.4, 0.5); }
          if (!state.fired.has("rushPop") && d > -0.1) {
            state.fired.add("rushPop"); g3.visible = false; snd.scream(1.3, 0.1, 700); fx.strobe(0.9); fx.shake(0.3);
            const arr = props.sparkle.geometry.attributes.position.array; const centre = worldAt(sc.s + 1.0, 0, 1.2);
            for (let i = 0; i < 24; i++) { arr[i * 3] = centre[0]; arr[i * 3 + 1] = centre[1]; arr[i * 3 + 2] = centre[2]; }
            props.sparkle.geometry.attributes.position.needsUpdate = true; props.sparkle.userData.t0 = rt; props.sparkle.userData.centre = centre; props.sparkle.visible = true;
          }
          if (props.sparkle.visible) {
            const age = rt - (props.sparkle.userData.t0 ?? rt); const k2 = clamp(age / 0.8, 0, 1);
            if (k2 >= 1) props.sparkle.visible = false; else {
              const arr = props.sparkle.geometry.attributes.position.array; const centre = props.sparkle.userData.centre || [0, 0, 0];
              for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283, rr = k2 * 2.1; arr[i * 3] = centre[0] + Math.cos(a) * rr; arr[i * 3 + 1] = centre[1] + Math.sin(a * 1.7) * rr * 0.6; arr[i * 3 + 2] = centre[2] + Math.sin(a) * rr; }
              props.sparkle.geometry.attributes.position.needsUpdate = true; props.sparkle.material.opacity = 1 - k2;
            }
          }
          break; }
        case "band": {                                    // the skeleton band plays the pipe organ
          const near = clamp(1 - Math.abs(d) / 5.0, 0, 1); const on = near > 0.02;
          props.organ.visible = props.band0.visible = props.band1.visible = props.band2.visible = on;
          const po = worldAt(sc.s, 0, 1.4); placeFacing(props.organ, po[0], po[1], po[2], -f.r[0], -f.r[2]);
          [[props.band0, -0.9, 0], [props.band1, 0, 0.3], [props.band2, 0.9, 0]].forEach(([bd, lat2, ph]) => {
            const pb2 = worldAt(sc.s + 0.2, lat2, 0.3); bd.position.set(pb2[0], pb2[1], pb2[2]); bd.rotation.y = props.organ.rotation.y;
            bd.rotation.z = on ? Math.sin(rt * 5 + ph * 6) * 0.25 : 0;
          });
          if (!state.fired.has("band") && d > -4) { state.fired.add("band"); snd.organ(98, 2.0); }
          if (!state.fired.has("bandPop") && d > -0.6) { state.fired.add("bandPop"); snd.organ(130, 1.4); snd.clank(0.35); }
          break; }
        case "finale": {                                   // the fake-out door slams shut just before the real gate opens on daylight
          const near = clamp(1 - Math.abs(d) / 3.2, 0, 1); const on = near > 0.02;
          props.fakeDoor.visible = on;
          const pdf = worldAt(sc.s, 0, 1.3); placeFacing(props.fakeDoor, pdf[0], pdf[1], pdf[2], -f.r[0], -f.r[2]);
          props.fakeDoor.rotation.y += lerp(0, 0.55, smooth((d + 1.4) / 0.6));
          const facePop = d > -0.35 && d < 0.55; props.scaryFace.visible = facePop;
          if (facePop) { const pf2 = worldAt(sc.s + 0.1, 0, 1.4); props.scaryFace.position.set(pf2[0], pf2[1], pf2[2]); props.scaryFace.rotation.y = props.fakeDoor.rotation.y; props.scaryFace.scale.setScalar(1.1); }
          if (!state.fired.has("finale") && d > -1.6) { state.fired.add("finale"); snd.creak(0.5); }
          if (!state.fired.has("finalePop") && d > -0.3) { state.fired.add("finalePop"); snd.bang(1.1); fx.strobe(0.55); fx.shake(0.3); }
          break; }
        default: break;
      }
      if (state.fired.size > before) state.flash[sc.id] = 1.3;
    }
    // every prop is dim until its scene's build-up fires: the flash lights it, then releases (fades) over about a second
    for (const [name, g] of Object.entries(props)) {
      if (!g.userData || !g.userData.mat) continue;
      const key = name === "vampire" ? "coffin" : name.startsWith("gallery") ? "gallery" : name === "mirrorGhost" || name === "mirrorPanel" ? "mirror"
        : name === "flask" || name === "sparkA" || name === "sparkB" ? "lab" : name.startsWith("band") || name === "organ" ? "band"
        : name === "shelf" || name.startsWith("book") ? "library" : name === "spider" || name === "thread" ? "webs" : name === "rushGhost" ? "rush"
        : name === "scaryFace" ? "finalePop" : name === "fakeDoor" ? "finale" : name;
      const k3 = state.flash[key] ?? 0; g.userData.mat.color.setScalar(0.42 + 0.58 * clamp(k3, 0, 1));
    }
    for (const k4 of Object.keys(state.flash)) state.flash[k4] = Math.max(0, state.flash[k4] - dt * 0.9);
  }

  /* ---- ambient atmosphere: lightning through the windows, a wind-tunnel hum, flickering lamps */
  function updateAmbient(dt, inside) {
    const flicker = 0.78 + 0.22 * Math.sin(st.rt * 11) * Math.sin(st.rt * 3.3 + 1) + (Math.random() < 0.02 ? -0.3 : 0);
    glowPts.forEach(m => { m.material.opacity = (m.name === "ghost-redglow" ? 1 : 0.32) * clamp(flicker, 0.35, 1.1); });
    if (!inside) return;
    st.lightning -= dt;
    if (st.lightning <= 0) { st.lightning = 5 + Math.random() * 6; fx.strobe(0.32); snd.thunder(0.6); }
  }

  /* ---- the cart's front (what you see of your own cart): visible whether sealed inside or not */
  let hood = null;
  function buildHood() {
    const b = makeBuilder(T);
    b.box(0, 0, 0, 1.0, 0.22, 0.7, 0x22222a); b.box(0, 0.13, 0.0, 1.0, 0.05, 0.7, 0xb8142a); b.ball(0, 0.25, 0.28, 0.07, 0xd8d4c4, 6);
    b.box(0, 0.14, -0.36, 0.9, 0.04, 0.06, 0xc0c4cc);                                                       // the lap bar
    hood = new T.Group(); hood.add(b.mesh(basic({ vertexColors: true }))); root.add(hood); hood.name = "ghost-hood";
    hood.layers.enable(GHOST_LAYER);                                                                        // stays on the default layer too: visible sealed or not
  }
  function placeHood() {
    const rt = st.rtF;
    const f = sp.at(st.s);
    hood.position.set(f.p[0] + f.u[0] * 0.5 + f.t[0] * 1.25, f.p[1] + f.u[1] * 0.5 + f.t[1] * 1.25, f.p[2] + f.u[2] * 0.5 + f.t[2] * 1.25);
    hood.rotation.order = "YXZ"; hood.rotation.set(-Math.asin(clamp(rt[1], -1, 1)), Math.atan2(rt[0], rt[2]), 0);
  }
  /** the gentle turn towards the nearest scene (bell curves around every scare's arc length, summed and clamped) and the speed profile (a dash
   *  between scenes, a near-stop at each one): both pure functions of arc length s, smoothed over time so neither ever snaps */
  function yawTargetAt(s) { let total = 0; for (const sc of scares) if (sc.side) total += sc.side * bell(s - sc.s, SCENE_SPAN + 0.4); return clamp(total, -1, 1) * YAW_MAX; }
  function paceAt(s) { let slow = 0; for (const sc of scares) slow = Math.max(slow, bell(s - sc.s, SCENE_SPAN)); return 1.32 - 0.94 * slow; }
  function compute(dt) {
    const f = sp.at(st.s);
    const target = yawTargetAt(st.s); st.yaw += (target - st.yaw) * (1 - Math.exp(-dt / (calm() ? 0.75 : 0.45)));
    const ca = Math.cos(st.yaw), sa = Math.sin(st.yaw);
    const rtx = f.t[0] * ca + f.r[0] * sa, rty = f.t[1] * ca + f.r[1] * sa, rtz = f.t[2] * ca + f.r[2] * sa;
    st.rtF = [rtx, rty, rtz];
    tmp.set(f.p[0] + f.u[0] * GHOST.eye + f.t[0] * GHOST.ahead, f.p[1] + f.u[1] * GHOST.eye + f.t[1] * GHOST.ahead, f.p[2] + f.u[2] * GHOST.eye + f.t[2] * GHOST.ahead);
    tmpF.set(rtx, rty, rtz); tmpU.set(f.u[0], f.u[1], f.u[2]);
    group.updateWorldMatrix(true, false);
    out.position.copy(tmp).applyMatrix4(group.matrixWorld); out.forward.copy(tmpF).transformDirection(group.matrixWorld); out.up.copy(tmpU).transformDirection(group.matrixWorld);
    smoother.apply(out, dt, calm() ? 0.2 : 0.06);
  }
  /** swap the main camera to the ride's own layer while the cart is sealed inside the castle (nothing outside is visible anyway), back to the
   *  normal layer when it is out in the open (approach / balcony / gate): always flipped while the screen is mostly black, so the swap is never seen */
  function setSealed(on) { if (r && r.camera) r.camera.layers.mask = on ? (1 << GHOST_LAYER) : 1; st.sealed = on; }

  return {
    kind: "ghost", id,
    start() {
      if (ud.setAnimated) ud.setAnimated(true); if (ud.setLOD) ud.setLOD(1);
      root.add(buildShell(), buildFloor(), buildDecor()); buildMurals(); buildLights(); buildProps(); buildDoors(); buildHood();
      group.add(root);
      snd.startBed("ghost");
      st.s = sStart; st.v = 0; st.crossIdx = 0; setSealed(false); compute(0); placeHood();
      fx.hint(env.hint, 5);
      if (crowd) { st.crowdWas = crowd.group.visible; crowd.group.visible = false; if (crowd.sheep) { st.sheepWas = crowd.sheep.visible; crowd.sheep.visible = false; } }
    },
    update(dt) {
      if (st.over) return true;
      st.rt += dt;
      const v = GHOST.speed * clamp(Math.min(st.rt / GHOST.ramp, (sEnd - st.s) / GHOST.brake), 0.12, 1) * paceAt(st.s);
      st.v = v; st.s = Math.min(sEnd, st.s + v * dt);
      updateDoors(dt, st.s); updateScares(dt, st.s, st.rt);
      // darkness: black pulses at the doorways you pass through, a dark vignette while inside
      const f = sp.at(st.s); const inside = f.p[2] < ZF - 0.2 ? 1 : 0;
      let black = 0; for (const cr of crossings) { const dd = st.s - cr.s; black = Math.max(black, cr.dir === "in" ? smooth(1 - Math.abs(dd + 0.15) / 0.75) : smooth(1 - Math.abs(dd - 0.1) / 0.5) * 0.7); }
      fx.setDark(inside * 0.28); fx.setBlack(black);
      st.inside = inside;
      // swap the camera layer exactly as the cart crosses each doorway (the black overlay is already at its darkest there, so the pop is never seen)
      while (st.crossIdx < crossings.length && st.s >= crossings[st.crossIdx].s) { setSealed(crossings[st.crossIdx].dir === "in"); st.crossIdx++; }
      updateAmbient(dt, inside > 0.5);
      snd.setBed(clamp(v / GHOST.speed, 0, 1) * 0.6, 0.12 + (props.rushGhost && props.rushGhost.visible ? 0.14 : 0));
      compute(dt); placeHood();
      if (st.s >= sEnd - 0.01 && st.rt > 3) { st.over = true; return true; }
      return false;
    },
    get frame() { return out; },
    get progress() { return clamp((st.s - sStart) / path.length, 0, 1); },
    get left() { return Math.max(0, (sEnd - st.s) / GHOST.speed + 1); },
    get speed() { return st.v; },
    debug() { return { s: st.s - sStart, length: path.length, inside: st.inside, sealed: st.sealed, yaw: +st.yaw.toFixed(3), scaresFired: [...state.fired], doorsOpen: doors.map(d => +d.open.toFixed(2)), crossings: crossings.map(c => +(c.s - sStart).toFixed(1)) }; },
    stop() {
      setSealed(false);
      if (crowd) { crowd.group.visible = st.crowdWas !== false; if (crowd.sheep) crowd.sheep.visible = st.sheepWas !== false; }
      group.remove(root);
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); mats.forEach(m => m.dispose()); texs.forEach(t => t.dispose());
      fx.setDark(0); fx.setBlack(0); fx.setVignette(0); snd.stopBed();
    },
  };
}
