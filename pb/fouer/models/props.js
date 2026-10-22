/* Schueberfouer Tycoon, W3: alley props.  Alley lamps, strings of bulbs over the main alley, bins, benches, crowd barriers along the SE rim, the painted entrance
 * portal at the NE end (own artwork, DESIGN 3.3 "Hauptportal"), the red-white barrier booms at the SW end and gate frames at the other five entrances.
 *   buildProps({ T, pitches, fieldPoly, groundY, seed, quality }) -> { group, count, tris }   (one Builder group in the GAME frame, merged by fair.js)
 * Everything is data-driven: ENTRANCES and the alley lists below are the only places that know where things stand (pitches.json corrections = data edits). */
import { Builder, mulberry, col, shade, C, GOLD, lerp, TAU } from './kit.js';
import { getMaterials } from './materials.js';
import { fitText, star } from './atlas.js';

const WARM = 0xffd890; const MULTI = [0xff5a4a, 0x5ad07a, 0x5aa8ff, 0xffd23c, 0xff8ad0];

/** the seven public entrances (DESIGN 4.2): kind 'boom' (SW, red-white barriers), 'portal' (NE, painted arch), 'gate' (frame + sign).  u,w game metres, face = outward direction */
export const ENTRANCES = [
  { id: 'E1', kind: 'boom', u: 17, w: 56, face: '-u', star: 1 },
  { id: 'E2', kind: 'gate', u: 130, w: 118.5, face: '+w', star: 2 },
  { id: 'E3', kind: 'gate', u: 190, w: 127.5, face: '+w', star: 2 },
  { id: 'E4', kind: 'gate', u: 250, w: 110, face: '+w', star: 4 },
  { id: 'E5', kind: 'gate', u: 112, w: 5, face: '-w', star: 4 },
  { id: 'E6', kind: 'gate', u: 196, w: 2.5, face: '-w', star: 5 },
  { id: 'E7', kind: 'portal', u: 282, w: 56, face: '+u', star: 3 },
];
const YAW = { '+w': 0, '-w': Math.PI, '+u': Math.PI / 2, '-u': -Math.PI / 2 };
const ALLEYS = [
  { name: 'haaptallee', w: [50.4, 62.6], u: [24, 276], step: 20, strings: true },
  { name: 'fressgaass', w: [24.2, 31.4], u: [30, 280], step: 24, strings: false },
];

/* ------------------------------------------------------------------ pieces */
function lampPost(b, x, z, y, side) {
  b.aoY = y;
  b.cyl(x, y, z, 0.16, 0.1, 0.3, 5, 0x2a2a2e); b.cyl(x, y + 0.3, z, 0.07, 0.06, 5.0, 4, 0x2f2f35);
  const dz = side * 0.7;
  b.beam([x, y + 5.2, z], [x, y + 5.45, z + dz], 0.07, 0x2f2f35);
  b.cyl(x, y + 5.2, z + dz, 0.26, 0.16, 0.12, 5, 0x2f2f35, { cap: true }); b.blob(x, y + 5.1, z + dz, 0.2, 0.2, 0.2, 0xfff0c8, { ch: 'lamp' });
  b.bulb(x, y + 5.1, z + dz, WARM, 0.62);
  b.aoY = 0;
}
function bin(b, x, y, z, yaw) { b.push().translate(x, y, z).rotY(yaw); b.aoY = y; b.cyl(0, 0, 0, 0.26, 0.22, 0.85, 7, 0x2f8f4a, { cap: true }); b.cyl(0, 0.85, 0, 0.28, 0.28, 0.06, 7, 0x222222, { cap: true }); b.pop(); b.aoY = 0; }
function bench(b, x, y, z, yaw) { b.push().translate(x, y, z).rotY(yaw); b.aoY = y; b.box(0, 0.42, 0, 1.6, 0.07, 0.42, 0x9a6a3c); b.box(0, 0.75, -0.2, 1.6, 0.3, 0.06, 0x9a6a3c); b.box(-0.7, 0, 0, 0.08, 0.42, 0.4, 0x2a2a2e); b.box(0.7, 0, 0, 0.08, 0.42, 0.4, 0x2a2a2e); b.pop(); b.aoY = 0; }
/** a string of bulbs between two points with a catenary sag */
function stringLights(b, a, c, sag, n, colors) {
  let prev = null;
  for (let i = 0; i <= n; i++) { const t = i / n; const p = [lerp(a[0], c[0], t), lerp(a[1], c[1], t) - Math.sin(Math.PI * t) * sag, lerp(a[2], c[2], t)]; b.bulb(p[0], p[1], p[2], colors[i % colors.length], 0.2); if (prev && !b.far) b.wire(prev, p, 0.02, 0x222222); prev = p; }
}
/** crowd barrier run: red-white panels with feet along a polyline of [u, w] */
function barrier(b, pts, groundY, offset = 0) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, w0] = pts[i]; const [u1, w1] = pts[i + 1]; const L = Math.hypot(u1 - u0, w1 - w0); const n = Math.max(1, Math.round(L / 3));
    const yaw = Math.atan2(u1 - u0, w1 - w0) - Math.PI / 2; const nu = -(w1 - w0) / L; const nw = (u1 - u0) / L;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n; const u = lerp(u0, u1, t) + nu * offset; const w = lerp(w0, w1, t) + nw * offset; const y = groundY(u, w);
      b.push().translate(u, y, w).rotY(yaw); b.aoY = y; b.box(0, 0.1, 0, L / n - 0.1, 1.0, 0.05, (k & 1) ? 0xf2f2ee : 0xd8283a); b.box(0, 1.1, 0, L / n - 0.1, 0.06, 0.07, 0x9aa0a6); b.box(-(L / n) / 2 + 0.4, 0, 0, 0.06, 0.1, 0.45, 0x555a60); b.pop(); b.aoY = 0;
    }
  }
}

/* ------------------------------------------------------------------ the painted entrance portal (own artwork) */
function portalPainter(ctx, w, h) {
  let s = 4242; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a0f5a'); g.addColorStop(0.45, '#8a2a9a'); g.addColorStop(1, '#f0602a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { ctx.fillStyle = ['#ffe27a', '#ff9ad0', '#7ae8ff'][i % 3]; ctx.globalAlpha = 0.5 + r() * 0.5; ctx.beginPath(); ctx.arc(r() * w, r() * h * 0.75, 1 + r() * 2.5, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  // swirling ribbons
  [['#ffd23c', 0.55], ['#ff4a8a', 0.68], ['#33d6c8', 0.78]].forEach(([c, y], k) => { ctx.strokeStyle = c; ctx.lineWidth = h * 0.035; ctx.beginPath(); for (let x = 0; x <= w; x += 6) { const yy = h * y + Math.sin(x * 0.02 + k * 2) * h * 0.06; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); });
  // the jester: round face, two-pointed hat with bells, ruff
  const cx = w * 0.5; const cy = h * 0.58; const R = h * 0.2;
  ctx.fillStyle = '#2d79c8'; ctx.beginPath(); ctx.moveTo(cx - R * 0.95, cy - R * 0.5); ctx.quadraticCurveTo(cx - R * 2.0, cy - R * 2.1, cx - R * 1.55, cy - R * 2.35); ctx.quadraticCurveTo(cx - R * 0.5, cy - R * 1.2, cx, cy - R * 1.05); ctx.quadraticCurveTo(cx + R * 0.5, cy - R * 1.2, cx + R * 1.55, cy - R * 2.35); ctx.quadraticCurveTo(cx + R * 2.0, cy - R * 2.1, cx + R * 0.95, cy - R * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd23c'; ctx.beginPath(); ctx.moveTo(cx - R * 0.95, cy - R * 0.5); ctx.quadraticCurveTo(cx - R * 0.5, cy - R * 1.2, cx, cy - R * 1.05); ctx.lineTo(cx, cy - R * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd23c'; [[-1.55, -2.35], [1.55, -2.35]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(cx + dx * R, cy + dy * R, R * 0.17, 0, 7); ctx.fill(); });
  ctx.fillStyle = '#fff0dc'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8506a'; ctx.beginPath(); ctx.arc(cx - R * 0.5, cy + R * 0.15, R * 0.17, 0, 7); ctx.arc(cx + R * 0.5, cy + R * 0.15, R * 0.17, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(cx - R * 0.36, cy - R * 0.2, R * 0.12, R * 0.17, 0, 0, 7); ctx.ellipse(cx + R * 0.36, cy - R * 0.2, R * 0.12, R * 0.17, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#c8283a'; ctx.lineWidth = R * 0.12; ctx.beginPath(); ctx.arc(cx, cy + R * 0.15, R * 0.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.fillStyle = '#e8506a'; ctx.beginPath(); ctx.arc(cx, cy + R * 0.0, R * 0.12, 0, 7); ctx.fill();
  for (let i = 0; i < 9; i++) { ctx.fillStyle = i & 1 ? '#ffffff' : '#c8283a'; ctx.beginPath(); const a = Math.PI * (0.1 + i * 0.1); ctx.arc(cx + Math.cos(a) * R * 1.1, cy + R * 1.0 + Math.sin(a) * R * 0.35, R * 0.22, 0, 7); ctx.fill(); }
  // butterflies and masks left and right
  [[0.16, 0.5, '#ff9ad0', '#7a47c8'], [0.84, 0.5, '#7ae8ff', '#ff8a2a'], [0.28, 0.77, '#ffd23c', '#2f9a58'], [0.72, 0.77, '#ff9ad0', '#2d79c8']].forEach(([fx, fy, c1, c2]) => {
    const x = w * fx; const y = h * fy; const sz = h * 0.1;
    [-1, 1].forEach((sd) => { ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(x + sd * sz * 0.8, y - sz * 0.4, sz * 0.9, sz * 0.6, sd * 0.5, 0, 7); ctx.fill(); ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(x + sd * sz * 0.6, y + sz * 0.5, sz * 0.6, sz * 0.45, -sd * 0.4, 0, 7); ctx.fill(); });
    ctx.fillStyle = '#2a1a3a'; ctx.fillRect(x - sz * 0.07, y - sz * 0.7, sz * 0.14, sz * 1.5);
  });
  for (let i = 0; i < 40; i++) { ctx.fillStyle = ['#ffd23c', '#ff4a8a', '#33d6c8', '#ffffff'][i % 4]; ctx.fillRect(r() * w, h * 0.3 + r() * h * 0.6, 4, 4); }
  // lettering (own wording, green with a white outline)
  fitText(ctx, 'SCHUEBERFOUER', w * 0.5, h * 0.11, w * 0.9, h * 0.15, '"Arial Black","Helvetica Neue",Arial,sans-serif', '#2fc05a', { stroke: '#ffffff', strokeW: h * 0.02, glow: '#0c4a22', glowBlur: h * 0.02 });
}
function portal(b, M, x, y, z, yaw) {
  b.push().translate(x, y, z).rotY(yaw); b.aoY = y;
  const W = 12; const H = 8.2; const legW = 1.7; const lintelY = 3.6; const n = b.far ? 12 : 24;
  const rect = M.atlas.slot('portal', 448, 300, '#2a0f5a', portalPainter);
  const uOf = (xx) => (xx + W / 2) / W; const vOf = (yy) => rect.v0 + (rect.v1 - rect.v0) * (yy / H); const uu = (xx) => rect.u0 + (rect.u1 - rect.u0) * uOf(xx);
  const topY = (xx) => 7.1 + 0.9 * Math.abs(Math.sin(xx * 0.95 + 0.4));
  const quadUV = (p, uvs, flip, zz) => { const nrm = [0, 0, flip ? -1 : 1]; const pts = flip ? [p[1], p[0], p[3], p[2]] : p; const uv = flip ? [uvs[1], uvs[0], uvs[3], uvs[2]].map((q) => [rect.u0 + rect.u1 - q[0], q[1]]) : uvs; b._quad('sign', ...pts.map((q) => b.P(q[0], q[1], zz)), [1, 1, 1], [b.D(0, 0, nrm[2]), b.D(0, 0, nrm[2]), b.D(0, 0, nrm[2]), b.D(0, 0, nrm[2])], uv, 0, false); };
  const strip = (x0, x1, y0, y1a, y1b, zz, flip) => quadUV([[x0, y0], [x1, y0], [x1, y1b], [x0, y1a]], [[uu(x0), vOf(y0)], [uu(x1), vOf(y0)], [uu(x1), vOf(y1b)], [uu(x0), vOf(y1a)]], flip, zz);
  for (let i = 0; i < n; i++) { const x0 = -W / 2 + W * i / n; const x1 = -W / 2 + W * (i + 1) / n; [0.13, -0.13].forEach((zz, k) => strip(x0, x1, lintelY, topY(x0), topY(x1), zz, k === 1)); }
  [[-W / 2, -W / 2 + legW], [W / 2 - legW, W / 2]].forEach(([x0, x1]) => [0.13, -0.13].forEach((zz, k) => strip(x0, x1, 0, lintelY, lintelY, zz, k === 1)));
  // thin solid core so it has thickness, pylons with lamp balls, bulbs around the opening and along the wavy top
  b.box(0, lintelY, 0, W, topY(0) - lintelY - 0.3, 0.2, 0x2a1a3a, { noFront: true, noBack: true }); [-1, 1].forEach((s) => { b.box(s * (W / 2 - legW / 2), 0, 0, legW, lintelY, 0.2, 0x2a1a3a, { noFront: true, noBack: true }); b.box(s * (W / 2 + 0.25), 0, 0, 0.5, 9.2, 0.5, 0xe8dcc0); b.sphere(s * (W / 2 + 0.25), 9.5, 0, 0.45, 0xfff0c8, { seg: 6, ch: 'lamp' }); b.bulb(s * (W / 2 + 0.25), 9.5, 0, WARM, 1.0); });
  b.bulbRow([-W / 2 + legW, lintelY, 0.2], [W / 2 - legW, lintelY, 0.2], 0.45, WARM, 0.18); b.bulbRow([-W / 2 + legW, lintelY, -0.2], [W / 2 - legW, lintelY, -0.2], 0.45, WARM, 0.18);
  for (let i = 0; i <= n * 2; i++) { const xx = -W / 2 + W * i / (n * 2); [0.2, -0.2].forEach((zz) => b.bulb(xx, topY(xx) + 0.05, zz, i % 2 ? WARM : 0xffe9b0, 0.17)); }
  b.pennants([-W / 2 - 0.25, 9.0, 0.3], [-1, 8.2, 0.3], 6, MULTI, 0.5); b.pennants([1, 8.2, 0.3], [W / 2 + 0.25, 9.0, 0.3], 6, MULTI, 0.5);
  b.pop(); b.aoY = 0;
}
/** the red-white barrier booms at the SW end: 3 lanes, two raised, booths between them, a lit lintel across the whole entrance */
function booms(b, M, x, y0, z, yaw, groundY) {
  b.push().translate(x, y0, z).rotY(yaw); b.aoY = y0;
  const lanes = [-6, 0, 6];
  lanes.forEach((lz, k) => {
    b.box(lz - 1.9, 0, 0, 0.5, 1.1, 0.5, 0x3a3f46); b.cyl(lz - 1.9, 1.1, 0, 0.12, 0.12, 0.3, 6, 0xd8283a);
    const raised = k !== 1; const ang = raised ? 0.9 : 0.0; const L = 3.9;
    for (let s = 0; s < 6; s++) { const t0 = s / 6; const t1 = (s + 1) / 6; const p = (t) => [lz - 1.9 + Math.cos(ang) * L * t, 1.1 + Math.sin(ang) * L * t, 0.0]; b.beam(p(t0), p(t1), 0.14, s & 1 ? 0xf6f6f2 : 0xd8283a); }
    b.cyl(lz - 1.9 + 3.9 * Math.cos(ang) + 0.1, 1.1 + 3.9 * Math.sin(ang), 0, 0.1, 0.1, 0.1, 5, 0xffffff);
  });
  [-3, 3].forEach((bz) => { b.box(-1.0, 0, bz, 2.0, 2.3, 1.8, 0xefe6d0); b.hip(-1.0, 2.3, bz, 2.0, 1.8, 0.8, 0x8a8f94, { over: 0.25 }); b.box(0.02, 1.0, bz, 0.05, 0.8, 1.2, 0x1f2c36); b.bulbRow([-2.0, 2.2, bz + 0.9], [0, 2.2, bz + 0.9], 0.4, WARM, 0.13); });
  [-9.2, 9.2].forEach((pz) => { b.box(-1.9, 0, pz, 0.6, 6.0, 0.6, 0xe8dcc0); b.sphere(-1.9, 6.3, pz, 0.35, 0xfff0c8, { seg: 5, ch: 'lamp' }); b.bulb(-1.9, 6.3, pz, WARM, 0.8); });
  b.box(-1.9, 5.0, 0, 0.5, 0.9, 18.6, 0xd8283a, { cols: { top: 0xe8dcc0 } });
  b.push().rotY(-Math.PI / 2); b.sign('SCHUEBERFOUER', 0, 5.45, 1.9 - 0.0, 8.0, 1.0, { look: 0, kind: 'main', lit: true, frameW: 0.08, frame: 0x3a2a20 }); b.pop();
  b.push().rotY(Math.PI / 2); b.sign('SCHUEBERFOUER', 0, 5.45, -1.9, 8.0, 1.0, { look: 0, kind: 'main', lit: true, frameW: 0.08, frame: 0x3a2a20 }); b.pop();
  b.bulbRow([-1.7, 4.9, -9.0], [-1.7, 4.9, 9.0], 0.45, WARM, 0.15);
  b.pop(); b.aoY = 0;
}
function gateFrame(b, x, y, z, yaw, idx) {
  b.push().translate(x, y, z).rotY(yaw); b.aoY = y;
  [-3.0, 3.0].forEach((px) => { b.box(px, 0, 0, 0.55, 4.0, 0.55, 0xefe6d0); b.box(px, 3.0, 0, 0.62, 0.18, 0.62, 0xd8283a); b.sphere(px, 4.35, 0, 0.3, 0xfff0c8, { seg: 5, ch: 'lamp' }); b.bulb(px, 4.35, 0, WARM, 0.7); });
  b.box(0, 3.6, 0, 6.6, 0.5, 0.3, 0x3a2a20); b.sign('ENTRÉE', 0, 3.85, 0.17, 4.2, 0.62, { look: idx & 1 ? 2 : 0, kind: 'main', lit: true, frameW: 0.05, frame: 0x3a2a20 });
  b.bulbRow([-3, 3.4, 0.2], [3, 3.4, 0.2], 0.4, WARM, 0.13);
  [-4.6, 4.6].forEach((px) => b.box(px, 0, 0, 1.6, 1.1, 0.06, (Math.abs(px) > 4 && idx & 1) ? 0xd8283a : 0xf2f2ee));
  b.pop(); b.aoY = 0;
}

export function buildProps({ T, pitches, fieldPoly, groundY, seed = 1, quality = 'medium' }) {
  const M = getMaterials(); const r = mulberry(seed * 23 + 1);
  const b = new Builder({ seed, rnd: r, far: false }); let count = 0;
  // alley lamps + bulb strings + bins + benches
  ALLEYS.forEach((al, ai) => {
    const poles = [];
    for (let u = al.u[0]; u <= al.u[1]; u += al.step) { al.w.forEach((w, k) => { const y = groundY(u, w); lampPost(b, u, w, y, k ? -1 : 1); poles.push([u, w, y, k]); count++; }); }
    if (al.strings) {
      const byU = new Map(); poles.forEach((p) => { if (!byU.has(p[0])) byU.set(p[0], []); byU.get(p[0]).push(p); });
      const us = [...byU.keys()].sort((a, c) => a - c);
      us.forEach((u, i) => { const [p0, p1] = byU.get(u).sort((a, c) => a[3] - c[3]); stringLights(b, [u, p0[2] + 5.0, p0[1]], [u, p1[2] + 5.0, p1[1]], 0.8, 14, i & 1 ? MULTI : [WARM, 0xfff4d0]); if (i > 0) { const q = byU.get(us[i - 1]).sort((a, c) => a[3] - c[3]); [[q[0], p0], [q[1], p1]].forEach(([qa, pa]) => stringLights(b, [qa[0], qa[2] + 5.1, qa[1]], [pa[0], pa[2] + 5.1, pa[1]], 0.55, 14, [WARM, 0xfff4d0, WARM, 0xffc870])); } });
      us.forEach((u, i) => { if (i % 2) { const [p0, p1] = byU.get(u).sort((a, c) => a[3] - c[3]); b.pennants([u + 1.2, p0[2] + 4.5, p0[1]], [u + 1.2, p1[2] + 4.5, p1[1]], 16, MULTI, 0.45, { sag: 0.6 }); } });
    }
    for (let u = al.u[0] + 9; u <= al.u[1]; u += 31) { const w = al.w[ai & 1 ? 0 : 1] + (ai ? 0.6 : (r() < 0.5 ? 0.6 : -0.6)); bin(b, u, groundY(u, w), w, 0); count++; }
    for (let u = al.u[0] + 22; u <= al.u[1]; u += 58) { const w = al.w[0] - 0.4; bench(b, u, groundY(u, w), w, Math.PI); count++; }
  });
  // crowd barriers along the SE rim (the long edge from (240,138) to (26,104)); gaps at the entrance gates
  const rim = []; for (let t = 0; t <= 1.0001; t += 1 / 36) rim.push([lerp(30, 236, t), lerp(105.5, 136.5, t)]);
  const gaps = ENTRANCES.filter((e) => e.kind === 'gate' && e.face === '+w').map((e) => e.u);
  for (let i = 0; i < rim.length - 1; i++) { const mu = (rim[i][0] + rim[i + 1][0]) / 2; if (gaps.some((g) => Math.abs(g - mu) < 4.5)) continue; barrier(b, [rim[i], rim[i + 1]], groundY, -1.2); count++; }
  // entrances
  ENTRANCES.forEach((e, i) => {
    const y = groundY(e.u, e.w);
    if (e.kind === 'portal') portal(b, M, e.u, y, e.w, YAW[e.face]);
    else if (e.kind === 'boom') booms(b, M, e.u, y, e.w, YAW[e.face], groundY);
    else gateFrame(b, e.u, y, e.w, YAW[e.face], i);
    count++;
  });
  const g = b.finish({ id: 'props', look: 0, level: 1, size: [300, 150], height: 10, kind: 'props' }); g.name = 'fouer-props';
  return { group: g, count, tris: g.userData.tris, bulbs: g.userData.bulbs };
}
