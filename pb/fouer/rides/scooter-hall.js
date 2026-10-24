/* The Autoscooter ride's own interior ("bigger inside"): a 40 x 22 m driving floor in a festive hall that exists only while somebody rides.  The hall on the map keeps its L pitch
 * (30 x 18 m); rides/drive.js builds this room next to it (same frame as the model, but on its own camera layer, the real map is not drawn), the way the ghost train brings its
 * interior.  Everything is unlit (MeshBasicMaterial / additive points): a dark-steel plate floor with UV pools and the sheen of the light bars, a see-through contact grid under
 * a tent roof with rows of bulbs, mirrored and airbrushed walls on the closed long side and the ends, a padded barrier with a gate, the porch with spectators along the open side,
 * a cash booth at one end and the DJ desk at the other, and, beyond the porch, a painted fair (tents, Ferris wheel, lit stalls) so that looking out shows the Fouer.
 * About 20 draw calls, ~25k triangles.  Textures are canvas paintings (disposed in dispose()). */
import { makeBuilder, makeTexBuilder, glowTexture, airbrushTexture, canvas, rnd, tex } from "./mesh.js";

/** the room: `floor` is the driving floor (40 x 22 m; the barrier stands on its edge), the walls and the porch lie around it */
export const HALL = Object.freeze({
  floor: Object.freeze({ x0: -20, x1: 20, z0: -11, z1: 11 }),
  wallX: 23.6, wallZ0: -11.8, porch: 3.4,
  bars: Object.freeze([-8.8, -4.4, 0, 4.4, 8.8]),                 // the five UV light bars across the hall (z)
  roofEdge: 5.3, roofRidge: 7.6, canopyY: 4.25,
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = a => (Math.round(a[0] * 255) << 16) | (Math.round(a[1] * 255) << 8) | Math.round(a[2] * 255);
const css = a => a.map(v => Math.round(clamp(v, 0, 1) * 255)).join(",");
const scale = (a, k) => a.map(v => clamp(v * k, 0, 1));

/* ------------------------------------------------------------------------------------------------------------------ textures */
/** the whole floor in one canvas: 1.6 m steel plates with seams and rivets, scuffs, rubber arcs and skid marks, coloured UV pools, the sheen of the five light bars (long streaks) and dots of the bulb rows */
export function hallFloorTexture(T, glow, bars, F = HALL.floor) {
  const W = 2048, H = 1152, [c, g] = canvas(W, H), R = rnd(7);
  const mx = W / (F.x1 - F.x0 + 0.6), my = H / (F.z1 - F.z0 + 0.6), plate = Math.round(1.6 * mx);
  g.fillStyle = "#262d38"; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += plate) for (let x = 0; x < W; x += plate) {
    const k = 0.88 + R() * 0.22; g.fillStyle = `rgb(${Math.round(46 * k)},${Math.round(54 * k)},${Math.round(66 * k)})`; g.fillRect(x + 2, y + 2, plate - 4, plate - 4);
    g.strokeStyle = "rgba(10,12,18,.9)"; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, plate - 3, plate - 3);
    g.strokeStyle = "rgba(150,170,200,.22)"; g.lineWidth = 1; g.strokeRect(x + 5.5, y + 5.5, plate - 11, plate - 11);
    g.fillStyle = "rgba(170,185,210,.5)"; for (const [dx, dy] of [[11, 11], [plate - 11, 11], [11, plate - 11], [plate - 11, plate - 11]]) { g.beginPath(); g.arc(x + dx, y + dy, 2.4, 0, 6.3); g.fill(); }
  }
  for (let i = 0; i < 520; i++) { const x = R() * W, y = R() * H, l = 20 + R() * 110, a = R() * 6.28; g.strokeStyle = `rgba(200,210,230,${0.05 + R() * 0.12})`; g.lineWidth = 0.6 + R() * 1.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 150; i++) { const x = R() * W, y = R() * H, r = 30 + R() * 90, a = R() * 6.28; g.strokeStyle = `rgba(6,7,10,${0.16 + R() * 0.3})`; g.lineWidth = 3 + R() * 7; g.beginPath(); g.arc(x, y, r, a, a + 0.5 + R() * 1.3); g.stroke(); }
  for (let i = 0; i < 26; i++) { const x = R() * W, y = R() * H, r = 140 + R() * 260, a = R() * 6.28; g.strokeStyle = "rgba(4,5,8,.22)"; g.lineWidth = 7; g.beginPath(); g.arc(x, y, r, a, a + 0.25 + R() * 0.5); g.stroke(); }     // long skid arcs
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 34; i++) { const x = R() * W, y = R() * H, r = 130 + R() * 230, col = glow[i % glow.length]; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},.30)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  bars.forEach((z, i) => {                                        // the light bars' sheen: a soft streak with a hot core, broken into uneven stretches
    const y = (z - (F.z0 - 0.3)) * my, col = glow[i % glow.length];
    const gr = g.createLinearGradient(0, y - 34, 0, y + 34); gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.5, `rgba(${col},.5)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(0, y - 34, W, 68);
    for (let x = 0; x < W; x += 40) { g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.4})`; g.fillRect(x, y - 2, 34 + R() * 6, 4); }
    g.fillStyle = "rgba(255,230,170,.42)"; for (const dz of [-0.55, 0.55]) for (let x = 0; x < W; x += 0.55 * mx) { g.beginPath(); g.arc(x + 6, y + dz * my, 3.4, 0, 6.3); g.fill(); }
  });
  g.globalCompositeOperation = "source-over";
  const t = tex(T, c); t.anisotropy = 8; return t;
}

/** a synthwave airbrush: a striped sun over mountains and a neon grid (the classic Autoscooter wall) */
export function synthTexture(T) {
  const W = 512, H = 256, [c, g] = canvas(W, H), R = rnd(21), hor = 150;
  const sky = g.createLinearGradient(0, 0, 0, hor); sky.addColorStop(0, "#12053a"); sky.addColorStop(0.55, "#a0188c"); sky.addColorStop(1, "#ff7a3a"); g.fillStyle = sky; g.fillRect(0, 0, W, hor);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + R() * 0.7})`; g.fillRect(R() * W, R() * hor * 0.7, 2, 2); }
  const sun = g.createLinearGradient(0, 36, 0, 150); sun.addColorStop(0, "#fff06a"); sun.addColorStop(1, "#ff2a9a");
  const halo = g.createRadialGradient(256, 98, 20, 256, 98, 130); halo.addColorStop(0, "rgba(255,120,200,.55)"); halo.addColorStop(1, "rgba(255,120,200,0)"); g.fillStyle = halo; g.fillRect(100, 0, 312, hor);
  g.fillStyle = sun; g.beginPath(); g.arc(256, 98, 62, 0, 6.3); g.fill();
  g.fillStyle = sky; for (let k = 0; k < 7; k++) g.fillRect(180, 98 + k * 9 + 4, 152, 1.2 + k * 0.9);
  g.fillStyle = "#1a0846"; g.beginPath(); g.moveTo(0, hor); for (let x = 0; x <= W; x += 24) g.lineTo(x, hor - 8 - R() * 34 * (Math.abs(x - 256) / 256 + 0.2)); g.lineTo(W, hor); g.fill();
  const floor = g.createLinearGradient(0, hor, 0, H); floor.addColorStop(0, "#2a0a52"); floor.addColorStop(1, "#0c0322"); g.fillStyle = floor; g.fillRect(0, hor, W, H - hor);
  g.shadowColor = "#ff3fc8"; g.shadowBlur = 6; g.strokeStyle = "#ff3fc8"; g.lineWidth = 1.4;
  for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(256 + i * 12, hor); g.lineTo(256 + i * 62, H); g.stroke(); }
  g.strokeStyle = "#35e6ff"; for (let k = 1; k < 9; k++) { const y = hor + (k / 9) ** 1.9 * (H - hor); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.shadowBlur = 0;
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.5)"); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return tex(T, c);
}

/** the painted fair beyond the porch: dusk sky, tents with bulb strings, a Ferris wheel, a drop tower, lit stall fronts, a crowd of heads at the bottom (2048 x 320 for 140 x 22 m) */
export function fairBackdropTexture(T) {
  const W = 2048, H = 320, [c, g] = canvas(W, H), R = rnd(33), hor = 262;
  const sky = g.createLinearGradient(0, 0, 0, hor); sky.addColorStop(0, "#080628"); sky.addColorStop(0.45, "#2c1458"); sky.addColorStop(0.8, "#b8387a"); sky.addColorStop(1, "#ff9a5a");
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.7})`; g.fillRect(R() * W, R() * hor * 0.5, 2, 2); }
  const dots = (x0, y0, x1, y1, n, col, r = 2.2) => { g.fillStyle = col; for (let i = 0; i <= n; i++) { const u = i / n, sag = Math.sin(u * Math.PI) * 7; g.beginPath(); g.arc(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + sag * 0.0, r, 0, 6.3); g.fill(); } };
  // far skyline: dark tents and flag poles
  g.fillStyle = "#1a0e30";
  for (let x = 0; x < W; x += 70 + R() * 90) { const w = 90 + R() * 120, h = 40 + R() * 60; g.beginPath(); g.moveTo(x, hor); g.lineTo(x + w * 0.5, hor - h); g.lineTo(x + w, hor); g.fill(); g.fillRect(x + w * 0.5 - 1, hor - h - 22, 2, 22); }
  // the Ferris wheel (big, lit), a drop tower, a swing carousel
  const wheel = (cx, cy, r) => {
    g.strokeStyle = "rgba(230,230,255,.65)"; g.lineWidth = 2.4; g.beginPath(); g.arc(cx, cy, r, 0, 6.3); g.stroke(); g.beginPath(); g.arc(cx, cy, r * 0.62, 0, 6.3); g.stroke();
    g.lineWidth = 1.4; for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke(); }
    for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; g.fillStyle = ["#ff5a7a", "#ffd060", "#5ae0ff", "#9aff7a"][k % 4]; g.fillRect(cx + Math.cos(a) * r - 4, cy + Math.sin(a) * r - 3, 8, 9); }
    g.strokeStyle = "#1a0e30"; g.lineWidth = 6; g.beginPath(); g.moveTo(cx - r * 0.55, hor); g.lineTo(cx, cy); g.lineTo(cx + r * 0.55, hor); g.stroke();
    const gl = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.25); gl.addColorStop(0, "rgba(255,200,120,.22)"); gl.addColorStop(1, "rgba(255,200,120,0)"); g.fillStyle = gl; g.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);
  };
  wheel(560, 118, 98); wheel(1520, 138, 76);
  g.fillStyle = "#1a0e30"; g.fillRect(1062, 40, 12, hor - 40); g.fillStyle = "#ff3fc8"; for (let y = 52; y < 200; y += 14) g.fillRect(1058, y, 20, 4); g.fillStyle = "#35e6ff"; g.fillRect(1052, 36, 32, 10);
  // tents in front: bulb outlines
  for (const [x, w, h, col] of [[120, 260, 110, "#24123e"], [820, 300, 124, "#2a1546"], [1260, 230, 100, "#1f1038"], [1760, 280, 118, "#2a1546"]]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(x - w / 2, hor); g.lineTo(x, hor - h); g.lineTo(x + w / 2, hor); g.fill(); g.fillRect(x - w / 2, hor - 28, w, 28);
    dots(x - w / 2, hor - 28, x, hor - h, 16, "#ffe9a0"); dots(x, hor - h, x + w / 2, hor - 28, 16, "#ffe9a0"); dots(x - w / 2, hor - 28, x + w / 2, hor - 28, 26, "#ff9ad0");
  }
  // stall fronts along the ground: lit bands and signs
  for (let x = 0; x < W; x += 110 + R() * 60) { const w = 90 + R() * 50; g.fillStyle = "#150a26"; g.fillRect(x, hor - 34, w, 34); g.fillStyle = ["#ffb347", "#5ae0ff", "#ff5a9a", "#9aff7a"][Math.floor(R() * 4)]; g.fillRect(x + 6, hor - 30, w - 12, 8); dots(x, hor - 36, x + w, hor - 36, Math.round(w / 9), "#fff2c0", 1.8); }
  // ground and the crowd (heads and shoulders)
  const ground = g.createLinearGradient(0, hor, 0, H); ground.addColorStop(0, "#3a1c40"); ground.addColorStop(1, "#120a1c"); g.fillStyle = ground; g.fillRect(0, hor, W, H - hor);
  g.fillStyle = "#0b0614"; for (let x = 0; x < W; x += 9 + R() * 12) { const s = 0.7 + R() * 0.7; g.beginPath(); g.arc(x, hor + 16 + R() * 28, 5 * s, 0, 6.3); g.fill(); g.fillRect(x - 7 * s, hor + 20 + R() * 28, 14 * s, 30); }
  for (let i = 0; i < 90; i++) { const x = R() * W, y = hor - 80 + R() * 110, r = 6 + R() * 14, col = ["255,200,120", "255,90,170", "90,220,255"][i % 3]; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},.45)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  return tex(T, c);
}

/** a lit neon sign: dark panel, glowing frame, glowing text scaled to fit */
export function signTexture(T, text, c1 = "255,63,200", c2 = "53,230,255", w = 1024, h = 192) {
  const [c, g] = canvas(w, h);
  g.fillStyle = "#12071e"; g.fillRect(0, 0, w, h);
  g.shadowColor = `rgb(${c2})`; g.shadowBlur = 14; g.strokeStyle = `rgb(${c2})`; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20); g.shadowBlur = 0;
  let size = 128; g.font = `bold ${size}px "Arial Black", Impact, sans-serif`; const m = g.measureText(text).width; if (m > w - 90) { size = Math.floor(size * (w - 90) / m); g.font = `bold ${size}px "Arial Black", Impact, sans-serif`; }
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = `rgb(${c1})`; g.shadowBlur = 26; g.fillStyle = `rgb(${c1})`; g.fillText(text, w / 2, h / 2 + 4); g.fillText(text, w / 2, h / 2 + 4);
  g.shadowBlur = 0; g.fillStyle = "#fff4fb"; g.fillText(text, w / 2, h / 2 + 4);
  return tex(T, c);
}

/* ------------------------------------------------------------------------------------------------------------------ people (spectators, the cashier, the DJ) */
const SKIN = [0xf1c8a8, 0xe3b08a, 0xc98e64, 0x9a6440, 0x6a4430];
const HAIR = [0x2a1c14, 0x4a2e1c, 0x8a5a2c, 0xc89a4a, 0xa83a22, 0x1a1a1e, 0xd8d2c6, 0x6a6a72];
const SHIRT = [0xd8433a, 0x2d79c8, 0x3aa05a, 0xf0b52f, 0x8a5bc8, 0xee7a9a, 0xf4f0e6, 0xe06a2a, 0x3ab5b0, 0x2f2f3a, 0xa02a3a, 0x1f5fb8];
const TROU = [0x2a3350, 0x3a3a3a, 0x4a5a78, 0x6a5a44, 0x2a2a30, 0x5a3a2a];
const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];

/** a standing person on the ground y0 at (x, z) looking towards -z; h = height; pose: "stand", "rail" (hands on the rail at railZ), "phone" (one arm up with a lit phone), "seated" (cashier) */
function person(b, R, x, y0, z, h, pose, railY = 0, railZ = 0) {
  const s = h / 1.7, shirt = pick(R, SHIRT), trou = pick(R, TROU), skin = pick(R, SKIN), hair = pick(R, HAIR), kind = Math.floor(R() * 4);
  const seated = pose === "seated", Y = v => y0 + v * s;
  if (seated) { b.box(x, Y(0.5), z + 0.05, 0.4 * s, 0.14 * s, 0.5 * s, trou); }
  else for (const sx of [-1, 1]) b.box(x + sx * 0.1 * s, Y(0.42), z, 0.16 * s, 0.84 * s, 0.18 * s, trou);
  const ty = seated ? 0.86 : 1.14;
  b.box(x, Y(ty), z, 0.42 * s, 0.6 * s, 0.24 * s, shirt);
  b.ball(x, Y(ty + 0.46), z, 0.12 * s, skin, 6);
  if (kind === 0) b.ball(x, Y(ty + 0.5), z + 0.02 * s, 0.125 * s, hair, 5);
  else if (kind === 1) { b.ball(x, Y(ty + 0.5), z + 0.02 * s, 0.13 * s, hair, 5); b.box(x, Y(ty + 0.3), z + 0.1 * s, 0.2 * s, 0.3 * s, 0.06, hair); }
  else if (kind === 2) b.box(x, Y(ty + 0.6), z, 0.26 * s, 0.07 * s, 0.26 * s, pick(R, SHIRT));
  else b.ball(x, Y(ty + 0.52), z + 0.03 * s, 0.13 * s, pick(R, SHIRT), 5);
  for (const sx of [-1, 1]) {
    const sh = [x + sx * 0.25 * s, Y(ty + 0.22), z];
    if (pose === "rail") b.beam(sh, [x + sx * 0.2 * s, railY + 0.03, railZ], 0.09 * s, 0.09 * s, shirt);
    else if (pose === "phone" && sx > 0) { b.beam(sh, [x + 0.3 * s, Y(1.78), z - 0.22 * s], 0.09 * s, 0.09 * s, shirt); b.box(x + 0.3 * s, Y(1.86), z - 0.25 * s, 0.07, 0.13, 0.02, 0xcfeaff); }
    else if (seated) b.beam(sh, [x + sx * 0.2 * s, Y(0.98), z - 0.42 * s], 0.08 * s, 0.08 * s, shirt);
    else b.beam(sh, [x + sx * 0.28 * s, Y(ty - 0.34), z - 0.02], 0.085 * s, 0.085 * s, shirt);
  }
}

/* ------------------------------------------------------------------------------------------------------------------ the hall */
/** builds the interior into a THREE.Group.  pal = the hall model's palette (models/hall-scooter.js PAL[look]).  Returns { group, update(t), dispose(), stats } */
export function buildScooterHall(T, { pal, floorY: fy = 0.45, ceilY: gy = 3.9, title = "AUTOSCOOTER", cash = "KASSA", calm = () => false }) {
  const F = HALL.floor, WX = HALL.wallX, WZ0 = HALL.wallZ0, PZ = F.z1 + HALL.porch, RE = HALL.roofEdge, RR = HALL.roofRidge, CY = HALL.canopyY, FZ1 = F.z1 + 0.3;
  const zmid = (WZ0 + FZ1) / 2, bars = HALL.bars;
  const group = new T.Group(); group.name = "scooter-hall";
  const mats = [], texs = [];
  const basic = o => { const m = new T.MeshBasicMaterial({ fog: false, ...o }); mats.push(m); return m; };
  const keep = t => { texs.push(t); return t; };
  const R = rnd(5);
  const roofAt = z => (z <= zmid ? RE + (RR - RE) * (z - WZ0) / (zmid - WZ0) : RE + (RR - RE) * (FZ1 - z) / (FZ1 - zmid));
  const glow = [css(scale(pal.floorGlow[0], 1)), css(scale(pal.floorGlow[1], 1)), css(pal.uv)];
  const uvCol = hex(scale(pal.uv, 1.35)), uvPale = 0xd8d0ff;
  const bulbCols = [pal.bulbs[0], pal.bulbs[1], [1, 0.4, 0.85], [0.4, 0.9, 1]];

  /* ---- the floor (one textured plane) */
  const floorTex = keep(hallFloorTexture(T, glow, bars, F));
  const floorMesh = new T.Mesh(new T.PlaneGeometry(F.x1 - F.x0 + 0.6, F.z1 - F.z0 + 0.6), basic({ map: floorTex }));
  floorMesh.rotation.x = -Math.PI / 2; floorMesh.position.set(0, fy + 0.012, 0); floorMesh.name = "ride-floor"; group.add(floorMesh);

  /* ---- the sky dome behind everything (dark dusk, so nothing of the day outside the room shows) */
  {
    const geo = new T.SphereGeometry(170, 24, 12), pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new T.Color(), horizon = new T.Color(0x3a1c58), zenith = new T.Color(0x05031a), below = new T.Color(0x0a0716);
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 170; if (y > 0) c.lerpColors(horizon, zenith, clamp(y * 2.2, 0, 1)); else c.copy(below); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute("color", new T.BufferAttribute(col, 3));
    const dome = new T.Mesh(geo, basic({ vertexColors: true, side: T.BackSide, depthWrite: false })); dome.renderOrder = -10; dome.frustumCulled = false; dome.name = "ride-dome"; group.add(dome);
  }

  /* ---- solid parts: one vertex-colour mesh */
  const b = makeBuilder(T);
  const steel = 0x8a929a, dark = 0x14122e, beam = pal.beam;
  const gq = (a, bb, c, d, c1, c2) => { b.triC(a, bb, c, c1, c1, c2); b.triC(a, c, d, c1, c2, c2); };              // a quad whose first edge (a, b) has colour c1 and the second (c, d) colour c2
  // walls to the roof, gables, the roof itself (edge dark, ridge lighter), ribs
  b.quad([-WX, fy, WZ0], [WX, fy, WZ0], [WX, RE, WZ0], [-WX, RE, WZ0], dark);
  for (const sx of [-1, 1]) {
    const x = sx * WX;
    b.quad([x, fy, WZ0], [x, fy, FZ1], [x, RE, FZ1], [x, RE, WZ0], dark); b.tri([x, RE, WZ0], [x, RE, FZ1], [x, RR, zmid], dark);
    b.quad([x, fy, FZ1], [x, fy, PZ], [x, CY, PZ], [x, CY, FZ1], dark);
  }
  gq([-WX, RE, WZ0], [WX, RE, WZ0], [WX, RR, zmid], [-WX, RR, zmid], 0x16102e, 0x2c2060);
  gq([-WX, RE, FZ1], [WX, RE, FZ1], [WX, RR, zmid], [-WX, RR, zmid], 0x16102e, 0x2c2060);
  b.quad([-WX, CY, FZ1], [WX, CY, FZ1], [WX, RE, FZ1], [-WX, RE, FZ1], 0x1c1638);                                    // the fascia wall over the porch canopy (its bright face looks outside)
  for (let x = -WX + 2.4; x < WX; x += 4.5) { b.beam([x, RE - 0.05, WZ0 + 0.05], [x, RR - 0.05, zmid], 0.16, 0.16, 0x3a3f55); b.beam([x, RR - 0.05, zmid], [x, RE - 0.05, FZ1 - 0.05], 0.16, 0.16, 0x3a3f55); }
  // skirting and chrome strips on the back wall, columns that divide the murals
  b.quad([-WX, fy, WZ0 + 0.02], [WX, fy, WZ0 + 0.02], [WX, fy + 1.0, WZ0 + 0.02], [-WX, fy + 1.0, WZ0 + 0.02], 0x262a38); b.box(0, fy + 1.0, WZ0 + 0.05, 2 * WX, 0.06, 0.06, 0xc4cad4);
  for (let k = 1; k < 6; k++) { const x = -WX + k * 2 * WX / 6; b.box(x, (fy + RE) / 2, WZ0 + 0.2, 0.34, RE - fy, 0.34, beam); }
  for (const x of [-WX + 0.2, WX - 0.2]) for (const z of [WZ0 + 0.2, FZ1 - 0.2]) b.box(x, (fy + RE) / 2, z, 0.4, RE - fy, 0.4, beam);
  for (const x of [-21.9, -14.2, -7.1, 7.1, 14.2, 21.9]) b.box(x, (fy + CY) / 2, PZ - 0.15, 0.22, CY - fy, 0.22, beam);       // porch columns (none in front of the gate)
  // neon lines on the murals
  const neonTop = hex(pal.bulbs[1]), neonLow = uvCol;
  b.box(0, 4.86, WZ0 + 0.06, 2 * WX - 0.6, 0.08, 0.05, neonTop); b.box(0, 1.34, WZ0 + 0.06, 2 * WX - 0.6, 0.07, 0.05, neonLow);
  for (const sx of [-1, 1]) { b.box(sx * (WX - 0.06), 4.86, (WZ0 + FZ1) / 2, 0.05, 0.08, FZ1 - WZ0 - 0.6, neonTop); b.box(sx * (WX - 0.06), 1.34, (WZ0 + FZ1) / 2, 0.05, 0.07, FZ1 - WZ0 - 0.6, neonLow); }
  // the contact grid: a see-through lattice of thin bars, girders, the UV bars' casings
  for (let z = F.z0 - 0.3; z <= F.z1 + 0.31; z += 2.2) b.box(0, gy, z, 41.2, 0.06, 0.06, steel);
  for (let x = -20.5; x <= 20.51; x += 2.5) b.box(x, gy, 0, 0.06, 0.06, 22.8, steel);
  for (const x of [-20.4, -12.2, -4, 4, 12.2, 20.4]) b.box(x, gy + 0.12, 0, 0.2, 0.2, 22.8, beam);
  for (const z of [F.z0 - 0.3, F.z1 + 0.3]) b.box(0, gy + 0.12, z, 41.2, 0.2, 0.2, beam);
  for (const z of bars) b.box(0, gy - 0.1, z, 38.4, 0.12, 0.34, 0x30343a);
  // padded barrier on the floor's edge: red / white panels, a bright rail, a striped gate on the open side
  const bx0 = F.x0 - 0.1, bx1 = F.x1 + 0.1, bz0 = F.z0 - 0.1, bz1 = F.z1 + 0.1;
  const seg = (x0, z0, x1, z1, k) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2)), horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i < n; i++) { const a = (i + 0.5) / n, ln = len / n; b.box(x0 + (x1 - x0) * a, fy + 0.55, z0 + (z1 - z0) * a, horiz ? ln - 0.04 : 0.34, 1.1, horiz ? 0.34 : ln - 0.04, pal.barrier[(i + k) % 2]); }
    b.beam([x0, fy + 1.14, z0], [x1, fy + 1.14, z1], 0.09, 0.09, pal.rail);
  };
  seg(bx0, bz0, bx1, bz0, 0); seg(bx0, bz0, bx0, bz1, 1); seg(bx1, bz0, bx1, bz1, 0); seg(bx0, bz1, -2.4, bz1, 1); seg(2.4, bz1, bx1, bz1, 1);
  for (const sx of [-1, 1]) b.box(sx * 2.4, fy + 0.62, bz1, 0.16, 1.24, 0.16, 0xe7b53b);
  for (let i = 0; i < 12; i++) b.box(-2.2 + i * 0.4, fy + 0.8, bz1, 0.38, 0.32, 0.06, i % 2 ? 0xf2c80c : 0x22222a);
  b.box(0, fy + 0.4, bz1, 4.6, 0.06, 0.05, 0xc4cad4);
  // the porch: floor, canopy, fascia over the front edge; behind it the dark alley ground
  b.quad([-WX, fy + 0.004, F.z1 + 0.35], [WX, fy + 0.004, F.z1 + 0.35], [WX, fy + 0.004, PZ], [-WX, fy + 0.004, PZ], 0x3a3946);
  b.quad([-WX, CY, FZ1], [WX, CY, FZ1], [WX, CY, PZ], [-WX, CY, PZ], 0x3a2a4a);
  b.box(0, CY - 0.38, PZ, 2 * WX, 0.8, 0.12, pal.fascia);
  gq([-90, fy, PZ], [90, fy, PZ], [90, fy, PZ + 60], [-90, fy, PZ + 60], 0x2a2433, 0x181226);
  // spectators along the open side: leaners at the rail, then rows behind them; a few hold a phone up
  for (let i = 0; i < 58; i++) {
    let x = (R() - 0.5) * 2 * 21; const rail = i < 24; if (Math.abs(x) < 2.6) x += x < 0 ? -2.6 : 2.6;
    const z = rail ? bz1 + 0.5 + R() * 0.15 : bz1 + 1.3 + R() * 1.6, kid = R() < 0.14, h = kid ? 1.15 + R() * 0.2 : 1.6 + R() * 0.28;
    person(b, R, x, fy, z, h, rail && !kid ? "rail" : R() < 0.25 ? "phone" : "stand", fy + 1.14, bz1);
  }
  // the cash booth at the right end (raised, warm window, the cashier behind the counter) and the DJ desk with speaker stacks at the left end
  const px = WX - 1.5;
  b.box(px, fy + 0.25, 0, 2.8, 0.5, 9.6, 0x222634);
  b.box(px - 1.0, fy + 1.05, 0, 0.7, 1.1, 8.4, pal.booth); b.box(px - 1.36, fy + 1.0, 0, 0.04, 0.5, 8.4, pal.boothRoof); b.box(px - 1.0, fy + 1.63, 0, 0.8, 0.06, 8.6, 0xd8d8e0);
  b.quad([WX - 0.1, fy + 0.5, -4.2], [WX - 0.1, fy + 0.5, 4.2], [WX - 0.1, fy + 3.1, 4.2], [WX - 0.1, fy + 3.1, -4.2], 0x3a2c48);
  b.quad([WX - 0.14, fy + 1.5, -3.6], [WX - 0.14, fy + 1.5, 3.6], [WX - 0.14, fy + 2.9, 3.6], [WX - 0.14, fy + 2.9, -3.6], 0xffc878);                  // the warm window behind the cashier
  for (const z of [-3.6, -1.8, 0, 1.8, 3.6]) b.box(WX - 0.18, fy + 2.2, z, 0.05, 1.4, 0.07, 0x2a2030);
  b.box(px - 0.2, fy + 3.55, 0, 2.6, 0.16, 9.6, pal.boothRoof); b.box(px - 1.5, fy + 3.3, 0, 0.12, 0.6, 9.6, pal.boothRoof);
  for (const z of [-2.6, 2.6]) b.box(px - 0.9, fy + 1.72, z, 0.3, 0.1, 0.4, 0xf2c80c);                                                                  // the token trays
  person(b, R, px + 0.5, fy + 0.5, -1.1, 1.62, "seated"); person(b, R, px + 0.5, fy + 0.5, 2.6, 1.58, "seated");
  const lx = -WX + 1.0;
  b.box(lx + 0.6, fy + 0.25, 0, 2.4, 0.5, 9.6, 0x222634);
  for (const z of [-4.1, 4.1]) { for (const k of [0, 1]) { const y = fy + 0.5 + 0.7 + k * 1.4; b.box(lx, y, z, 1.1, 1.3, 1.0, 0x15161c); for (const dz of [-0.28, 0.28]) { const cy = y + (k ? 0.1 : 0.2); for (let a = 0; a < 8; a++) { const t0 = a / 8 * 6.283, t1 = (a + 1) / 8 * 6.283; b.tri([lx + 0.56, cy, z + dz], [lx + 0.56, cy + Math.cos(t0) * 0.22, z + dz + Math.sin(t0) * 0.22], [lx + 0.56, cy + Math.cos(t1) * 0.22, z + dz + Math.sin(t1) * 0.22], a % 2 ? 0x3a3d4a : 0x4a4e5c); } b.ball(lx + 0.57, cy, z + dz, 0.06, 0x8a8fa0, 4); } } }
  b.box(lx + 0.3, fy + 1.1, 0, 0.8, 1.2, 4.2, 0x1c1e28); b.box(lx + 0.3, fy + 1.72, 0, 0.82, 0.05, 4.2, hex(pal.bulbs[2 % pal.bulbs.length]));
  person(b, R, lx + 1.2, fy + 0.5, 0.4, 1.7, "stand");
  // the alley beyond the porch: dark stall boxes with lit fronts, two tents (cheap depth in front of the painted backdrop)
  for (const [x, z, w, h] of [[-62, 8, 9, 3.4], [-36, 14, 8, 3.1], [-14, 9, 10, 3.6], [18, 11, 8, 3.2], [40, 8, 10, 3.5], [66, 13, 9, 3.3]]) {
    b.box(x, fy + h / 2, PZ + z, w, h, 3, 0x120a22); b.quad([x - w / 2, fy + h - 1.1, PZ + z - 1.52], [x + w / 2, fy + h - 1.1, PZ + z - 1.52], [x + w / 2, fy + h - 0.5, PZ + z - 1.52], [x - w / 2, fy + h - 0.5, PZ + z - 1.52], hex(bulbCols[Math.floor(Math.abs(x)) % 4]));
    b.quad([x - w / 2 + 0.4, fy + 0.9, PZ + z - 1.52], [x + w / 2 - 0.4, fy + 0.9, PZ + z - 1.52], [x + w / 2 - 0.4, fy + h - 1.3, PZ + z - 1.52], [x - w / 2 + 0.4, fy + h - 1.3, PZ + z - 1.52], 0x3a2a14);
  }
  for (const [x, z, s] of [[-26, 20, 10], [30, 22, 12]]) { const a = [x - s / 2, fy, PZ + z - s / 2], bb = [x + s / 2, fy, PZ + z - s / 2], c = [x + s / 2, fy, PZ + z + s / 2], d = [x - s / 2, fy, PZ + z + s / 2], top = [x, fy + 7.5, PZ + z]; b.tri(a, bb, top, 0x1d1233); b.tri(bb, c, top, 0x241640); b.tri(c, d, top, 0x1d1233); b.tri(d, a, top, 0x241640); }
  const solid = b.mesh(basic({ vertexColors: true, side: T.DoubleSide })); solid.name = "ride-hall"; solid.frustumCulled = false; group.add(solid);

  /* ---- murals (airbrush, mirror), signs, backdrop: textured quads, one mesh per texture */
  const wallTex = { synth: keep(synthTexture(T)), fun: keep(airbrushTexture(T, "fun", 3)), mirror: keep(airbrushTexture(T, "mirror", 5)) };
  const tb = { synth: makeTexBuilder(T), fun: makeTexBuilder(T), mirror: makeTexBuilder(T) };
  const y0 = 1.45, y1 = 4.78;
  ["synth", "mirror", "fun", "mirror", "synth", "mirror"].forEach((k, i) => { const pw = 2 * WX / 6, x0 = -WX + 0.2 + i * pw, x1 = x0 + pw - 0.2; tb[k].quad([x0, y0, WZ0 + 0.04], [x1, y0, WZ0 + 0.04], [x1, y1, WZ0 + 0.04], [x0, y1, WZ0 + 0.04]); });
  [["fun", "mirror", "synth"], ["synth", "mirror", "fun"]].forEach((kinds, side) => {
    const x = side ? WX - 0.04 : -WX + 0.04;
    kinds.forEach((k, i) => { const pw = (FZ1 - WZ0 - 0.4) / 3, za = WZ0 + 0.3 + i * pw, zb = za + pw - 0.2; if (side) tb[k].quad([x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za]); else tb[k].quad([x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb]); });
  });
  for (const k of Object.keys(tb)) { const m = tb[k].mesh(basic({ map: wallTex[k], side: T.DoubleSide })); m.name = "ride-wall-" + k; m.frustumCulled = false; group.add(m); }
  // signs: the name over the DJ desk, the cash sign on the booth's roof edge
  const signs = [[title, "255,63,200", "53,230,255", -WX + 0.07, 6.4, 1.5, fy + 2.9, 1], [cash, "255,200,60", "255,90,40", px - 1.58, 4.6, 0.86, fy + 3.3, -1]];
  for (const [text, c1, c2, x, w, h, ym, face] of signs) {
    const t = keep(signTexture(T, text, c1, c2, 1024, Math.round(1024 * h / w))), q = makeTexBuilder(T);
    q.quad([x, ym - h / 2, face > 0 ? w / 2 : -w / 2], [x, ym - h / 2, face > 0 ? -w / 2 : w / 2], [x, ym + h / 2, face > 0 ? -w / 2 : w / 2], [x, ym + h / 2, face > 0 ? w / 2 : -w / 2]);
    const m = q.mesh(basic({ map: t, side: T.DoubleSide })); m.name = "ride-sign"; m.frustumCulled = false; group.add(m);
  }
  {
    const t = keep(fairBackdropTexture(T)), q = makeTexBuilder(T), z = PZ + 34, hh = 22, w = 140;
    q.quad([w / 2, fy, z], [-w / 2, fy, z], [-w / 2, fy + hh, z], [w / 2, fy + hh, z]);
    const m = q.mesh(basic({ map: t })); m.name = "ride-backdrop"; m.frustumCulled = false; group.add(m);
  }

  /* ---- light: UV bars (additive, pulsing in two groups), bulb rows and the haze under the roof (additive points) */
  const uvMeshes = [0, 1].map(par => {
    const ub = makeBuilder(T); bars.forEach((z, i) => { if (i % 2 === par) ub.quad([-19.2, gy - 0.17, z - 0.3], [19.2, gy - 0.17, z - 0.3], [19.2, gy - 0.17, z + 0.3], [-19.2, gy - 0.17, z + 0.3], uvCol); });
    const m = ub.mesh(basic({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide })); m.name = "ride-uv"; m.frustumCulled = false; m.renderOrder = 3; group.add(m); return m;
  });
  const glowTex = keep(glowTexture(T));
  const pts = (list, size, opacity, name) => {
    const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
    list.forEach((p, i) => { pos.set([p[0], p[1], p[2]], i * 3); col.set(p[3], i * 3); });
    const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setAttribute("color", new T.BufferAttribute(col, 3));
    const mat = new T.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, fog: false }); mats.push(mat);
    const m = new T.Points(geo, mat); m.frustumCulled = false; m.name = name; m.renderOrder = 4; group.add(m); return m;
  };
  const bulbs = [[], []]; let nb = 0;
  const bulb = (x, y, z) => { bulbs[nb & 1].push([x, y, z, bulbCols[nb % bulbCols.length]]); nb++; };
  for (const z of bars) for (const dz of [-0.55, 0.55]) for (let x = -19.6; x <= 19.61; x += 0.55) bulb(x, gy - 0.12, z + dz);               // under the UV bars
  for (let z = -9.6; z <= 8.7; z += 2.75) for (let x = -21.4; x <= 21.41; x += 0.7) bulb(x, roofAt(z) - 0.28, z);                          // rows under the roof
  for (let x = bx0; x <= bx1; x += 0.5) { bulb(x, fy + 1.32, bz0 - 0.05); if (Math.abs(x) > 2.5) bulb(x, fy + 1.32, bz1 + 0.05); }         // along the rail
  for (let z = bz0; z <= bz1; z += 0.5) { bulb(bx0 - 0.05, fy + 1.32, z); bulb(bx1 + 0.05, fy + 1.32, z); }
  for (let x = -WX + 0.4; x <= WX - 0.4; x += 0.45) { bulb(x, CY - 0.82, PZ + 0.1); bulb(x, CY - 0.5, PZ + 0.1); }                          // the porch's curtain of bulbs
  for (let z = -4.4; z <= 4.4; z += 0.5) { bulb(px - 1.5, fy + 3.05, z); bulb(px - 1.5, fy + 2.4, z); }
  const bulbA = pts(bulbs[0], 0.27, 1, "ride-bulbs-a"), bulbB = pts(bulbs[1], 0.27, 1, "ride-bulbs-b");
  const haze = []; for (let i = 0; i < 28; i++) { const x = -18 + (i % 7) * 6, z = -7.5 + Math.floor(i / 7) * 5.5; haze.push([x + (R() - 0.5) * 2, roofAt(z) - 0.9, z, scale(bulbCols[i % 4], 0.7)]); }
  pts(haze, 5, 0.12, "ride-haze");
  const alley = []; let na = 0;
  for (const [z, y0a, sag] of [[PZ + 5.5, 4.6, 0.8], [PZ + 12, 5.4, 1.0], [PZ + 19, 6.2, 1.2]]) for (let seg2 = -90; seg2 < 90; seg2 += 12) for (let k = 0; k <= 15; k++) { const u = k / 15, x = seg2 + u * 12; alley.push([x, y0a - Math.sin(u * Math.PI) * sag, z + (R() - 0.5) * 0.3, bulbCols[na++ % 4]]); }
  const alleyP = pts(alley, 0.5, 0.95, "ride-alley");

  const parts = { solid, uvMeshes, bulbA, bulbB, alleyP };
  return {
    group, parts, floorTex,
    update(t) {
      if (calm()) { uvMeshes[0].material.opacity = uvMeshes[1].material.opacity = 0.75; bulbA.material.opacity = bulbB.material.opacity = 0.9; return; }
      uvMeshes[0].material.opacity = 0.62 + 0.28 * Math.sin(t * 2.3); uvMeshes[1].material.opacity = 0.62 + 0.28 * Math.sin(t * 2.3 + Math.PI);
      bulbA.material.opacity = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 5.2)); bulbB.material.opacity = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 5.2 + Math.PI));
      alleyP.material.opacity = 0.85 + 0.12 * Math.sin(t * 1.7);
    },
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      mats.forEach(m => m.dispose()); texs.forEach(t => t.dispose());
    },
  };
}
