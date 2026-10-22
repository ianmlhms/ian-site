/* Schueberfouer Tycoon, W3: small and medium rides (S / M pitches): kids' carousel (+ the pioneer gold version), chair swings, Bayern curve, boat carousel,
 * Break Dance, Music Express, tilt ride ("take off") and the pendulum arm.  Contract: see index.js.  Animated pieces are `part:*` groups
 * (rotor, ring, arm, ...); the static base, gate, booth and signs are merged geometry.  Levels / Looks follow stalls.js:
 *   L2 lit sign + string lights + flags + ticket booth, L3 chasing LED outline + riders + queue railings + fog / sparks, L4 gold trim. */
import { makeCtx, C, GOLD, dressEdge, dressForecourt, lerp, TAU, shade, col } from './kit.js';
import { begin, end, fascia, booth, forecourtStrings, posts, bin, hammi } from './stalls.js';
import { getMaterials } from './materials.js';

export const MODELS = {};
const FLAGS = [[0xc8283a, 0xffffff, 0x7fc4ec], [0x1d1b1a, 0xc8283a, 0xf4c430], [0x2d6fd0, 0xffffff, 0xc8283a], [0x2f9a58, 0xffffff, 0xc8283a], [0xf08a2a, 0xffffff, 0x2f9a58], [0x1d1b1a, 0xf4c430, 0xc8283a]];
const SEAT = [0xc8283a, 0xf4c430, 0x2d6fd0, 0x2f9a58, 0xee6fa8, 0xf08a2a, 0x8a5bc8, 0x25c6d8];

/* ------------------------------------------------------------------ shared ride pieces */
/** low round plinth with a skirt below the sloping asphalt; deck top at y = 0.25 */
function roundDeck(b, ctx, R, topColor, o = {}) {
  b.cyl(0, -0.55, 0, R + 0.25, R + 0.25, 0.6, 20, 0x2f2f35, { cap: false });
  b.cyl(0, 0.05, 0, R + 0.1, R + 0.1, 0.2, 20, o.rim || ctx.pal.dark, { cap: true, capColor: topColor });
}
/** the entrance gate: two posts + a lit sign across, a few steps.  x centre, z of the gate line */
function gate(b, ctx, text, z, w = 3.0, o = {}) {
  const P = ctx.pal; const h = o.h || 3.0;
  b.box(-w / 2, 0.1, z, 0.22, h, 0.22, P.dark); b.box(w / 2, 0.1, z, 0.22, h, 0.22, P.dark);
  b.beam([-w / 2 - 0.1, h + 0.1, z], [w / 2 + 0.1, h + 0.1, z], 0.2, P.dark);
  fascia(b, ctx, text, 0, h + 0.62, z + 0.12, w + 0.5, o.sh || 0.78);
  b.bulbRow([-w / 2, h - 0.12, z + 0.16], [w / 2, h - 0.12, z + 0.16], 0.28, ctx.bulb, 0.13);
  if (ctx.L4) { b.sphere(-w / 2, h + 0.35, z, 0.17, GOLD, { seg: 6 }); b.sphere(w / 2, h + 0.35, z, 0.17, GOLD, { seg: 6 }); }
}
/** flags on poles at given points (with a stripe), L2+ */
function flagPoles(b, ctx, pts, h = 4.0) {
  if (!ctx.L2) return;
  const cols = ctx.look === 1 ? [0x41e8ff, 0xff3fc8, 0x8a5bff] : ctx.look === 2 ? [0x1f5fb8, 0xffffff, 0x1f5fb8] : [0xc8283a, 0xf6ead0, 0x2f6a4c];
  pts.forEach(([x, z], i) => b.flag(x, z, h, cols[i % cols.length], { w: 1.0, h: 0.6 }));
}
/** a ring of LED segments (lamp channel) with a travelling pulse */
function ledRing(p, cy, r, n, t, colors, o = {}) {
  const nn = p.far ? Math.max(8, n / 2) : n;
  for (let i = 0; i < nn; i++) {
    const a0 = TAU * i / nn; const a1 = TAU * (i + 0.9) / nn; const c = colors[i % colors.length];
    p.led([Math.sin(a0) * r, cy, Math.cos(a0) * r], [Math.sin(a1) * r, cy, Math.cos(a1) * r], t, c, { chase: ((i % 12) + 1) / 13 });
  }
}
/** a queue of guests at the gate + a queue railing (L3+) */
function queue(b, ctx, z0, n = 3) { if (!ctx.L3) return; for (let i = 0; i < n; i++) b.figure(-0.7 + i * 0.7, z0 - (i % 2) * 0.5, Math.PI); }
/** painted lozenge texture panel for the Bayern look */
function lozengePanel(b, x, y, z, w, h, ctx) { b.sign('', x, y, z, w, h, { look: 2, kind: 'banner', key: 'lozenge|' + w.toFixed(1), frame: false, back: false, painter: (cx, ww, hh) => { cx.fillStyle = '#fff'; cx.fillRect(0, 0, ww, hh); cx.fillStyle = '#2d6fd0'; for (let j = -1; j < 8; j++) for (let i = -1; i < 16; i++) { const px = i * ww / 8 + (j & 1 ? ww / 16 : 0); const py = j * hh / 5; cx.beginPath(); cx.moveTo(px, py - hh / 8); cx.lineTo(px + ww / 16, py); cx.lineTo(px, py + hh / 8); cx.lineTo(px - ww / 16, py); cx.fill(); } } }); }

/** animals on poles (facing +x): kind 0 horse, 1 giraffe, 2 camel, 3 sheep-ish pony */
function animal(p, kind, c1, c2, s = 1) {
  p.push().scale(s);
  if (kind === 1) {                                                   // giraffe: tall neck, spots
    p.box(0, 0.35, 0, 0.9, 0.4, 0.36, c1); [[-0.3, 0.12], [0.3, 0.12], [-0.3, -0.12], [0.3, -0.12]].forEach(([x, z]) => p.box(x, 0, z, 0.1, 0.38, 0.1, c1));
    p.beam([0.38, 0.6, 0], [0.62, 1.4, 0], 0.18, c1); p.box(0.7, 1.35, 0, 0.34, 0.2, 0.2, c1); p.blob(0.66, 1.5, 0, 0.05, 0.1, 0.06, c2); for (let i = 0; i < 4; i++) p.blob(-0.2 + i * 0.22, 0.58, 0.19, 0.07, 0.07, 0.02, c2);
  } else if (kind === 2) {                                            // camel: two humps
    p.box(0, 0.38, 0, 1.0, 0.36, 0.38, c1); p.blob(-0.18, 0.78, 0, 0.18, 0.2, 0.17, c1); p.blob(0.2, 0.78, 0, 0.18, 0.2, 0.17, c1);
    [[-0.34, 0.13], [0.34, 0.13], [-0.34, -0.13], [0.34, -0.13]].forEach(([x, z]) => p.box(x, 0, z, 0.1, 0.4, 0.1, c1)); p.beam([0.42, 0.6, 0], [0.62, 1.05, 0], 0.16, c1); p.box(0.72, 1.0, 0, 0.3, 0.18, 0.17, c1); p.box(0, 0.74, 0, 0.5, 0.05, 0.4, c2);
  } else {                                                            // horse
    p.box(0, 0.36, 0, 1.0, 0.4, 0.34, c1); [[-0.32, 0.11], [0.32, 0.11], [-0.32, -0.11], [0.32, -0.11]].forEach(([x, z]) => p.box(x, 0, z, 0.1, 0.38, 0.1, c1));
    p.beam([0.42, 0.55, 0], [0.62, 1.0, 0], 0.2, c1); p.box(0.72, 0.9, 0, 0.34, 0.2, 0.18, c1); p.blob(0.5, 1.05, 0, 0.1, 0.16, 0.05, c2); p.blob(-0.55, 0.42, 0, 0.14, 0.2, 0.05, c2); p.box(0, 0.58, 0, 0.45, 0.06, 0.38, c2);
  }
  p.pop();
}

/* ------------------------------------------------------------------ the classic carousel: kanner (S) and the pioneer gold version (M) */
function carousel(opts, id, R, nAnimals, gold) {
  const { b, ctx } = begin(id, opts); const P = ctx.pal;
  const main = gold ? 0xd9a52a : P.main; const second = gold ? 0xfff0c0 : P.second; const trim = ctx.L4 ? GOLD : (gold ? 0xfff0a0 : P.trim);
  const awn = gold ? [0xe6b13a, 0xfff0c0] : P.awn; const k = R / 3.2;
  roundDeck(b, ctx, R, gold ? 0x6a5a3a : (ctx.look === 1 ? 0x1a1430 : 0x6b5648));
  const H1 = 2.9 * k; const rot = b.part('rotor', [0, 0, 0]); const bobA = rot.part('bobA', [0, 0, 0]); const bobB = rot.part('bobB', [0, 0, 0]);
  const floorC = gold ? 0x8a6a28 : (ctx.look === 1 ? 0x2a1850 : 0x8a4a3a);
  rot.cyl(0, 0.25, 0, R - 0.15, R - 0.15, 0.12, 20, floorC, { cap: true, alt: [floorC, shade(floorC, 0.8)] });
  const rc = 0.5 * k;
  rot.cyl(0, 0.37, 0, rc * 1.3, rc * 1.2, 0.5, 12, main); rot.cyl(0, 0.87, 0, rc, rc, H1 - 0.9, 12, main);
  rot.band(0, 1.1, 0, rc + 0.02, 0.1, 12, trim); rot.band(0, H1 - 0.5, 0, rc + 0.02, 0.1, 12, trim);
  for (let i = 0; i < 6; i++) { const a = TAU * i / 6; rot.sphere(Math.sin(a) * (rc + 0.03), 1.9 * k, Math.cos(a) * (rc + 0.03), 0.16, 0xdff3ff, { seg: 5 }); }
  const rp = R * 0.64; const nn = b.far && nAnimals > 8 ? Math.round(nAnimals / 2) : nAnimals;
  for (let i = 0; i < nn; i++) {
    const a = TAU * i / nn; const px = Math.sin(a) * rp; const pz = Math.cos(a) * rp;
    rot.cyl(px, 0.37, pz, 0.035, 0.035, H1 - 0.37, 5, ctx.L4 ? GOLD : C.brass);
    const tgt = i & 1 ? bobB : bobA; const cols1 = gold ? [0xfff0c0, 0xe6b13a, 0xf6d878] : (ctx.look === 1 ? [0xff9af0, 0x9af0ff, 0xd6b0ff] : ctx.look === 2 ? [0xfdfdf6, 0x9fc4f0, 0xf3e3b8] : [0xf6ead0, 0xe0a860, 0xcfd9c0, 0xe8b0a0]);
    tgt.push().translate(px, 0.37 + 0.5, pz).rotY(a);                                          // local +z radial, +x tangent
    animal(tgt, i % 3, cols1[i % cols1.length], trim, k * 0.9);
    if (ctx.L3 && i % 2 === 0) tgt.figure(0, 0, 0, { scale: 0.55 * k + 0.1, body: SEAT[i % 8], y: 0.62 * k });
    tgt.pop();
  }
  [0.9, 3.9].forEach((ca) => { rot.push().rotY(ca); const cr = ctx.look === 1 ? 0xff3fc8 : 0xc8102e; rot.quad([-0.75, 0.4, R - 0.2], [0.1, 0.4, R - 0.2], [0.35, H1, R - 0.2], [-0.9, H1, R - 0.2], cr, { dbl: true }); rot.quad([0.1, 0.4, R - 0.2], [0.55, 0.4, R - 0.12], [0.5, H1, R - 0.1], [0.35, H1, R - 0.2], shade(cr, 0.8), { dbl: true }); rot.pop(); });
  rot.cyl(0, H1, 0, R - 0.1, R - 0.1, 0.22, 20, main, { alt: [main, shade(main, 0.9)] });
  rot.disc(0, H1 - 0.01, 0, R - 0.12, 0, 20, second, { down: true, alt: [second, awn[0]] });
  const corY = H1 + 0.22; const corH = 0.85 * k + 0.2;
  rot.band(0, corY, 0, R + 0.02, corH, 20, second, { alt: [second, shade(second, 0.9)] });
  rot.band(0, corY - 0.04, 0, R + 0.06, 0.12, 20, trim); rot.band(0, corY + corH - 0.06, 0, R + 0.06, 0.14, 20, trim);
  const nm = Math.max(6, Math.round(R * 2.4));
  rot.radial(nm, (i) => rot.mural([0, 1, 0, 5, 3, 0][i % 6], i + 3, 0, corY + corH / 2, R + 0.06, TAU * R / nm * 0.78, corH * 0.72, { look: ctx.look, frame: trim, frameW: 0.05, back: false, frameZ: -0.03 }));
  rot.scallopRing(0, corY, 0, R + 0.08, 0.42, Math.round(R * 4), awn[0], awn[1], { flare: 0.06 });
  const rise = 2.1 * k + 0.6;
  rot.cyl(0, corY + corH, 0, R + 0.25, 0.25, rise, 16, awn[0], { alt: awn, smooth: false });
  const apex = corY + corH + rise;
  rot.cyl(0, apex - 0.1, 0, 0.1, 0.04, 0.9, 5, trim); rot.sphere(0, apex + 0.9, 0, 0.17, ctx.L4 ? GOLD : trim, { seg: 6 });
  if (ctx.L2) rot.cone(0, apex + 0.9, 0, 0.14, 0.5, 5, trim);
  rot.bulbRing(0, corY - 0.18, 0, R + 0.12, Math.round(R * 8), ctx.bulb, 0.14);
  rot.bulbRing(0, corY + corH + 0.02, 0, R + 0.3, Math.round(R * 7), ctx.bulb, 0.14);
  if (ctx.L2) rot.radial(8, () => rot.bulbRow([0, corY + corH + 0.3, R + 0.1], [0, apex - 0.2, 0.2], 0.55, ctx.bulb, 0.13));
  if (ctx.L3) { ledRing(rot, corY + 0.06, R + 0.1, Math.round(R * 6), 0.07, ctx.led); ledRing(rot, corY + corH - 0.12, R + 0.1, Math.round(R * 6), 0.07, ctx.led.slice().reverse()); }
  if (gold) rot.sign('PIONÉIER', 0, 1.5 * k, 0.55, 1.4, 0.4, { look: 0, kind: 'plate', frame: GOLD, frameW: 0.05, lit: true });
  const zg = R + 0.35; gate(b, ctx, ctx.name, zg, gold ? 3.8 : 2.6, { h: gold ? 3.6 : 2.8 });
  for (let i = 0; i < 3; i++) b.box(0, i * 0.1, R + 0.05 + i * 0.12, 1.8, 0.1, 0.4, C.plate);
  if (ctx.L2) { booth(b, ctx, gold ? 6.6 : 3.1, gold ? R + 0.7 : zg - 0.4, { body: ctx.pal.dark, roof: second }); forecourtStrings(b, ctx, -R, R, gold ? R + 1.8 : 3.75, 3.0); }
  const fp = R * 0.78; flagPoles(b, ctx, [[-fp, -fp], [fp, -fp], [-fp, fp], [fp, fp]], 5.4 * k);
  if (ctx.L3) { b.railing([-R * 0.9, 0, R + 0.45], [-1.6, 0, R + 0.45], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.6, 0, R + 0.45], [R * 0.9, 0, R + 0.45], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, R + 0.7, 3); b.fx(0, 0.4, 0, 4, 0, { spread: R * 1.2, size: 0.5, color: ctx.look === 1 ? 0xb9a0ff : 0xf2f2f2 }); }
  return end(b, ctx, gold ? [16, 16] : [8, 8], apex + 1.6, {
    animate: (t, dt, parts) => { parts.rotor.rotation.y = t * 0.9; parts.bobA.position.y = Math.sin(t * 2.0) * 0.14; parts.bobB.position.y = Math.sin(t * 2.0 + Math.PI) * 0.14; },
  });
}
MODELS.kanner = { build: (opts) => carousel(opts, 'kanner', 3.0, 8, false) };
MODELS.gold = { build: (opts) => carousel(opts, 'gold', 5.6, 14, true) };

/* ------------------------------------------------------------------ kette: chair swings (M) */
MODELS.kette = { build(opts) {
  const { b, ctx } = begin('kette', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim; const U = getMaterials().U;
  roundDeck(b, ctx, 6.2, ctx.look === 1 ? 0x1a1430 : 0x6b6256);
  b.cyl(0, 0.25, 0, 1.9, 1.7, 0.4, 14, P.dark); b.cyl(0, 0.65, 0, 1.2, 1.0, 2.6, 12, P.main, { alt: [P.main, shade(P.main, 0.85)] });
  b.band(0, 1.2, 0, 1.22, 0.14, 12, trim); b.band(0, 3.1, 0, 1.0, 0.14, 12, trim);
  for (let i = 0; i < 6; i++) { const a = TAU * i / 6; b.sphere(Math.sin(a) * 1.22, 2.0, Math.cos(a) * 1.22, 0.18, 0xdff3ff, { seg: 5 }); }
  const rot = b.part('rotor', [0, 3.2, 0]);
  const R = 5.0; const rimY = 5.0; const apexY = 7.0; const swingTop = 4.15; const roofCols = ctx.look === 1 ? [0x22103f, 0x5a2ad0] : (ctx.look === 2 ? [0x1f5fb8, 0xfdfdf6] : [0xc8283a, 0xf6ead0]);
  rot.cyl(0, 3.2, 0, 0.9, 0.8, 3.7, 10, P.second); rot.band(0, 4.5, 0, 0.92, 0.16, 10, trim);
  rot.cyl(0, rimY, 0, R, 0.3, apexY - rimY, 24, roofCols[0], { alt: roofCols, smooth: false });
  rot.band(0, rimY - 0.9, 0, R + 0.02, 0.9, 24, P.second, { alt: [P.second, shade(P.second, 0.9)] });
  rot.band(0, rimY - 0.95, 0, R + 0.06, 0.12, 24, trim); rot.band(0, rimY - 0.06, 0, R + 0.06, 0.12, 24, trim);
  rot.radial(12, (i) => rot.mural([0, 1, 5, 3][i % 4], i + 11, 0, rimY - 0.45, R + 0.06, TAU * R / 12 * 0.8, 0.62, { look: ctx.look, frame: trim, frameW: 0.05, back: false, frameZ: -0.03 }));
  rot.scallopRing(0, rimY - 0.9, 0, R + 0.1, 0.42, 24, P.awn[0], P.awn[1], { flare: 0.05 });
  rot.cyl(0, apexY - 0.05, 0, 0.5, 0.3, 0.7, 8, trim, { cap: true });
  const crownC = ctx.L4 ? GOLD : (ctx.look === 1 ? 0xff9af0 : 0xf4d070);
  rot.cyl(0, apexY + 0.6, 0, 0.55, 0.5, 0.35, 10, crownC);
  for (let i = 0; i < 8; i++) { const a = TAU * i / 8; rot.tri([Math.sin(a) * 0.55 - 0.1, apexY + 0.95, Math.cos(a) * 0.55], [Math.sin(a) * 0.55 + 0.1, apexY + 0.95, Math.cos(a) * 0.55], [Math.sin(a) * 0.45, apexY + 1.55, Math.cos(a) * 0.45], crownC, { dbl: true }); rot.bulb(Math.sin(a) * 0.5, apexY + 1.55, Math.cos(a) * 0.5, 0xfff0b0, 0.18); }
  rot.sphere(0, apexY + 1.75, 0, 0.16, crownC, { seg: 5 });
  if (ctx.L3) { const rb = [0xff3a5a, 0xffb02a, 0x41e870, 0x2ac8ff, 0xb05aff, 0xff5ad0]; for (let i = 0; i < 24; i++) { const a0 = TAU * i / 24; const a1 = TAU * (i + 1) / 24; rot.tri([0, rimY - 0.2, 0], [Math.sin(a0) * (R - 0.1), rimY - 0.88, Math.cos(a0) * (R - 0.1)], [Math.sin(a1) * (R - 0.1), rimY - 0.88, Math.cos(a1) * (R - 0.1)], rb[i % 6], { ch: 'lamp', ph: ((i % 12) + 1) / 13 }); } }
  rot.bulbRing(0, rimY - 0.98, 0, R + 0.12, 40, ctx.bulb, 0.15); rot.bulbRing(0, rimY + 0.02, 0, R + 0.1, 40, ctx.bulb, 0.15);
  if (ctx.L2) rot.radial(12, () => rot.bulbRow([0, rimY + 0.1, R - 0.1], [0, apexY - 0.1, 0.4], 0.55, ctx.bulb, 0.13));
  if (ctx.L3) { ledRing(rot, rimY + 0.06, R + 0.1, 36, 0.08, ctx.led); ledRing(rot, rimY - 0.82, R + 0.1, 36, 0.07, ctx.led.slice().reverse()); }
  rot.swingTop = swingTop; const nSeat = ctx.L3 ? 28 : 24; const sw = { ch: 'swing' };
  rot.radial(nSeat, (i) => {
    const c = ctx.look === 1 ? [0x41e8ff, 0xff3fc8, 0x8a5bff][i % 3] : ctx.look === 2 ? [0x1f5fb8, 0xfdfdf6][i & 1] : [0xc8283a, 0xf4c430, 0x2f9a58, 0x2d6fd0][i % 4];
    rot.wire([0, swingTop, R - 0.25], [0, 0.95, R - 0.25], 0.04, 0x333333, sw); rot.wire([0, swingTop, R + 0.15], [0, 0.95, R + 0.15], 0.04, 0x333333, sw);
    rot.box(0, 0.62, R - 0.05, 0.46, 0.08, 0.5, c, sw); rot.box(-0.2, 0.7, R - 0.05, 0.06, 0.5, 0.5, c, sw); rot.box(0.15, 0.82, R - 0.05, 0.05, 0.04, 0.52, 0x333333, sw);
  });
  gate(b, ctx, ctx.name, 6.4, 3.2, { h: 3.0 }); for (let i = 0; i < 3; i++) b.box(0, i * 0.1, 6.0 + i * 0.12, 2.0, 0.1, 0.4, C.plate);
  if (ctx.L2) { booth(b, ctx, 5.3, 6.4, { body: P.dark, roof: P.second }); forecourtStrings(b, ctx, -5, 5, 7.3, 3.0); }
  flagPoles(b, ctx, [[-6.8, 5.8], [-6.8, -6], [6.2, -6], [6.2, 2]], 5.0);
  if (ctx.L3) { b.railing([-6.6, 0, 7.2], [-1.8, 0, 7.2], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 7.2], [6.6, 0, 7.2], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.45, 4); b.fx(0, 0.4, 0, 5, 0, { spread: 9, size: 0.6, color: 0xdfe8ff }); }
  return end(b, ctx, [16, 16], apexY + 2.4, {
    animate: (t, dt, parts) => { const ramp = Math.min(1, 0.25 + t * 0.4); parts.rotor.rotation.y = t * 1.0; U.uSwing.value = 0.2 + 0.34 * ramp + 0.03 * Math.sin(t * 0.6); },
  });
} };

/* ------------------------------------------------------------------ bayern: the Bayern curve (M) */
MODELS.bayern = { build(opts) {
  const { b, ctx } = begin('bayern', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim;
  const blue = ctx.look === 1 ? 0x22103f : 0x2d6fd0; const white = ctx.look === 1 ? 0x41e8ff : 0xfdfdf6;
  roundDeck(b, ctx, 7.2, 0x4a5a78);
  b.disc(0, 0.31, 0, 6.6, 3.9, 24, white, { alt: [white, blue] });
  b.band(0, 0.3, 0, 6.7, 0.5, 24, 0x333a44); b.band(0, 0.3, 0, 3.85, 0.5, 24, 0x333a44);
  // pavilion: octagonal, lozenge panels, scalloped roof with bulbs
  b.cyl(0, 0.3, 0, 3.0, 3.0, 3.6, 8, ctx.look === 1 ? 0x241440 : 0xf3efe2, { smooth: false });
  b.radial(8, () => lozengePanel(b, 0, 1.9, 2.8, 2.1, 2.0, ctx), Math.PI / 8);
  b.band(0, 3.7, 0, 3.05, 0.22, 8, trim); b.band(0, 0.3, 0, 3.05, 0.2, 8, blue);
  b.cyl(0, 3.92, 0, 3.7, 0.25, 2.1, 16, blue, { alt: [blue, white], smooth: false });
  b.scallopRing(0, 3.92, 0, 3.72, 0.4, 16, white, blue, { flare: 0.08 });
  b.bulbRing(0, 3.7, 0, 3.78, 36, ctx.bulb, 0.15); b.bulbRing(0, 4.0, 0, 3.7, 32, ctx.bulb, 0.14);
  if (ctx.L2) b.radial(16, () => b.bulbRow([0, 4.1, 3.55], [0, 5.9, 0.3], 0.5, ctx.bulb, 0.13));
  b.cyl(0, 5.9, 0, 0.12, 0.05, 1.1, 5, trim); b.sphere(0, 7.1, 0, 0.2, trim, { seg: 6 });
  if (ctx.L3) ledRing(b, 3.95, 3.74, 32, 0.09, ctx.led);
  // rotating ring of 12 cars with flag-coloured shells
  const ring = b.part('ring', [0, 0, 0]); const nCars = 12;
  ring.radial(nCars, (i) => {
    const f = FLAGS[i % FLAGS.length]; const rr = 5.25;
    for (let k = 0; k < 3; k++) ring.box(-0.52 + k * 0.52, 0.34, rr, 0.52, 0.42, 0.98, f[k], { cols: { top: f[k] } });
    ring.box(0.0, 0.34, rr + 0.5, 1.6, 0.14, 0.04, 0xc9ced4); ring.box(0.0, 0.34, rr - 0.5, 1.6, 0.14, 0.04, 0xc9ced4);
    ring.box(-0.7, 0.76, rr, 0.12, 0.4, 0.8, 0x333a44);
    ring.beam([-0.6, 0.76, rr - 0.38], [0.15, 1.12, rr - 0.38], 0.05, 0xdfe5ea); ring.beam([-0.6, 0.76, rr + 0.38], [0.15, 1.12, rr + 0.38], 0.05, 0xdfe5ea); ring.beam([0.15, 1.12, rr - 0.38], [0.15, 1.12, rr + 0.38], 0.05, 0xdfe5ea);
    if (ctx.L3 && i % 3 === 0) ring.figure(-0.25, rr, Math.PI / 2, { y: 0.55, scale: 0.7, body: SEAT[i % 8] });
  });
  gate(b, ctx, ctx.name, 6.8, 3.2, { h: 3.0 }); for (let i = 0; i < 3; i++) b.box(0, i * 0.1, 6.35 + i * 0.12, 2.0, 0.1, 0.4, C.plate);
  if (ctx.L2) { booth(b, ctx, 5.2, 6.5, { body: blue, roof: white }); forecourtStrings(b, ctx, -5, 5, 7.4, 3.0); }
  flagPoles(b, ctx, [[-6.8, 6.0], [-6.8, -6.2], [6.2, -6.2], [6.2, 2.0]], 5.5);
  if (ctx.L3) { b.railing([-6.8, 0, 7.25], [-1.8, 0, 7.25], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 7.25], [6.8, 0, 7.25], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.4, 4); }
  return end(b, ctx, [16, 16], 8.3, { animate: (t, dt, parts) => { parts.ring.rotation.y = -t * 1.25; } });
} };

/* ------------------------------------------------------------------ happy: boat carousel (M) */
MODELS.happy = { build(opts) {
  const { b, ctx } = begin('happy', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim;
  const sea = ctx.look === 1 ? 0x2a1a6a : 0x2d8fd8; const foam = ctx.look === 1 ? 0x41e8ff : 0xe9f8ff;
  roundDeck(b, ctx, 6.6, 0x4a5a78);
  // step plinth + static canopy on posts: wave-shaped blue roof with foam bulbs, gilded Neptune
  b.cyl(0, 0.05, 0, 6.3, 6.3, 0.35, 20, trim, { cap: true, capColor: 0x6f8aa8 });
  for (let i = 0; i < 8; i++) { const a = TAU * (i + 0.5) / 8; b.cyl(Math.sin(a) * 5.9, 0.3, Math.cos(a) * 5.9, 0.12, 0.12, 4.6, 6, trim); }
  b.band(0, 4.8, 0, 6.1, 0.5, 24, P.main); b.band(0, 4.76, 0, 6.15, 0.1, 24, trim); b.band(0, 5.24, 0, 6.15, 0.1, 24, trim);
  b.cyl(0, 5.3, 0, 6.3, 0.3, 2.3, 24, sea, { alt: [sea, shade(sea, 0.82)], smooth: false });
  for (let k = 0; k < 24; k++) { const a = TAU * k / 24; b.blob(Math.sin(a) * 6.4, 5.4, Math.cos(a) * 6.4, 0.4, 0.22, 0.4, foam); }
  b.scallopRing(0, 4.8, 0, 6.15, 0.5, 24, foam, sea, { flare: 0.1 });
  b.bulbRing(0, 4.74, 0, 6.2, 44, foam, 0.16); b.bulbRing(0, 5.3, 0, 6.4, 40, ctx.bulb, 0.15);
  if (ctx.L2) b.radial(12, () => b.bulbRow([0, 5.5, 5.7], [0, 7.2, 0.6], 0.5, ctx.bulb, 0.13));
  // Neptune: gilded figure with a trident
  b.cyl(0, 7.4, 0, 0.5, 0.35, 0.6, 8, trim, { cap: true }); b.cyl(0, 8.0, 0, 0.3, 0.2, 1.0, 7, GOLD); b.sphere(0, 9.2, 0, 0.26, GOLD, { seg: 6 }); b.cyl(0.45, 7.9, 0, 0.04, 0.04, 2.2, 4, GOLD);
  [-0.18, 0, 0.18].forEach((x) => b.cone(0.45 + x, 10.1, 0, 0.04, 0.35, 4, GOLD));
  b.sphere(-0.2, 8.8, 0.0, 0.18, GOLD, { seg: 5 });
  if (ctx.L3) ledRing(b, 4.82, 6.2, 40, 0.09, ctx.led);
  // rotating deck with a blue wavy floor and 8 small boats in two bobbing groups
  const rot = b.part('rotor', [0, 0, 0]); const bobA = rot.part('boatsA', [0, 0, 0]); const bobB = rot.part('boatsB', [0, 0, 0]);
  rot.cyl(0, 0.38, 0, 5.4, 5.4, 0.12, 20, sea, { cap: true, alt: [sea, shade(sea, 1.2)] });
  for (let r = 0; r < 3; r++) rot.disc(0, 0.52 + r * 0.01, 0, 5.2 - r * 1.4, 4.9 - r * 1.4, 20, foam, { alt: [foam, sea] });
  rot.cyl(0, 0.5, 0, 1.1, 0.9, 3.2, 10, P.main, { alt: [P.main, trim] }); rot.cyl(0, 3.7, 0, 0.9, 0.3, 1.0, 8, trim);
  const nb = 8; const hullC = ctx.look === 1 ? [0xff3fc8, 0x41e8ff, 0x8a5bff] : ctx.look === 2 ? [0x1f5fb8, 0xfdfdf6, 0xc8283a] : [0xc8283a, 0xf4c430, 0x2d6fd0, 0x2f9a58];
  for (let i = 0; i < nb; i++) {
    const a = TAU * i / nb; const tgt = i & 1 ? bobB : bobA; const hc = hullC[i % hullC.length];
    tgt.push().rotY(a).translate(0, 0.55, 3.4);
    tgt.box(0, 0.0, 0, 1.9, 0.5, 0.95, hc); tgt.box(0, 0.5, 0.45, 1.9, 0.08, 0.08, 0xfdfdf6); tgt.box(0, 0.5, -0.45, 1.9, 0.08, 0.08, 0xfdfdf6);
    tgt.beam([0.95, 0.25, 0], [1.4, 0.62, 0], 0.4, hc); tgt.box(-0.2, 0.5, 0, 0.5, 0.1, 0.8, 0x6a4a30);
    tgt.cyl(0.05, 0.5, 0, 0.04, 0.04, 2.0, 4, 0xdddddd); tgt.tri([0.05, 2.4, 0], [0.05, 0.9, 0], [1.0, 0.9, 0], i & 1 ? 0xfdfdf6 : 0xc8283a, { dbl: true }); tgt.tri([0.05, 2.4, 0], [-0.8, 0.9, 0], [0.05, 0.9, 0], i & 1 ? 0xc8283a : 0xfdfdf6, { dbl: true });
    if (ctx.L3 && i % 2 === 0) tgt.figure(-0.2, 0, 0, { scale: 0.7, body: SEAT[i % 8], y: 0.5 });
    tgt.pop();
  }
  gate(b, ctx, ctx.name, 7.0, 3.2, { h: 3.0 }); for (let i = 0; i < 3; i++) b.box(0, i * 0.1, 6.55 + i * 0.12, 2.0, 0.1, 0.4, C.plate);
  if (ctx.L2) { booth(b, ctx, 5.5, 6.6, { body: P.main, roof: foam }); forecourtStrings(b, ctx, -5, 5, 7.4, 3.0); }
  flagPoles(b, ctx, [[-7.0, 6.5], [-7.0, -6.5], [6.4, -6.5], [6.4, 2.0]], 5.5);
  if (ctx.L3) { b.railing([-7.0, 0, 7.3], [-1.8, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 7.3], [7.0, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.45, 4); b.fx(0, 0.5, 0, 5, 0, { spread: 10, size: 0.6, color: 0xdff4ff }); }
  return end(b, ctx, [16, 16], 10.6, { animate: (t, dt, parts) => { parts.rotor.rotation.y = t * 0.55; parts.boatsA.position.y = Math.sin(t * 1.7) * 0.16; parts.boatsB.position.y = Math.sin(t * 1.7 + Math.PI) * 0.16; } });
} };

/* ------------------------------------------------------------------ break: Break Dance (M) */
MODELS.break = { build(opts) {
  const { b, ctx } = begin('break', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim;
  roundDeck(b, ctx, 6.4, 0x44485a);
  // stepped red / yellow / orange plinth, chequerboard floor
  const steps = ctx.look === 1 ? [0xff3fc8, 0x41e8ff, 0x8a5bff] : ctx.look === 2 ? [0x1f5fb8, 0xfdfdf6, 0x7fb0ee] : [0xc8283a, 0xf4c430, 0xf08a2a];
  b.cyl(0, 0.05, 0, 6.2, 6.1, 0.3, 24, steps[0], { cap: true, capColor: steps[0] }); b.cyl(0, 0.35, 0, 5.7, 5.6, 0.2, 24, steps[1]); b.cyl(0, 0.55, 0, 5.2, 5.1, 0.2, 24, steps[2], { cap: true, capColor: 0x2a2a30, alt: [steps[2], steps[2]] });
  b.disc(0, 0.76, 0, 5.1, 0, 24, 0xf1ead8, { alt: [0xf1ead8, 0x2a2a30] });
  b.bulbRing(0, 0.4, 0, 6.15, 44, ctx.bulb, 0.15); b.bulbRing(0, 0.66, 0, 5.65, 40, ctx.bulb, 0.14);
  b.cyl(0, 0.76, 0, 1.3, 1.1, 1.6, 10, P.main, { alt: [P.main, trim] }); b.band(0, 2.2, 0, 1.12, 0.14, 10, trim);
  // painted skyline backdrop wall behind the ride
  b.box(0, -0.4, -7.5, 14.4, 7.4, 0.4, P.dark); b.mural(1, 5, 0, 3.5, -7.28, 13.8, 6.0, { look: ctx.look, frame: trim, frameW: 0.12, back: false, frameZ: -0.1 });
  b.bulbRow([-7.0, 6.9, -7.2], [7.0, 6.9, -7.2], 0.4, ctx.bulb, 0.15); b.bulbRow([-7.0, 0.2, -7.2], [7.0, 0.2, -7.2], 0.4, ctx.bulb, 0.14);
  fascia(b, ctx, ctx.name, 0, 7.5, -7.3, 6.0, 1.2);
  if (ctx.L3) b.ledRect(-6.9, 0.3, 6.9, 6.8, -7.1, 0.12, ctx.led, { seg: 2 });
  // rotor: hub + 5 arms, each ending in a ring of open gondolas
  const rot = b.part('rotor', [0, 2.6, 0]); const hubY = 2.6;
  rot.cyl(0, hubY - 0.2, 0, 0.9, 0.7, 1.0, 9, trim); rot.sphere(0, hubY + 1.0, 0, 0.55, ctx.look === 1 ? 0x41e8ff : 0x2d6fd0, { seg: 7 });
  for (let k = 0; k < 7; k++) { const a = TAU * k / 7; rot.sphere(Math.sin(a) * 0.62, hubY + 1.0 + (k % 2) * 0.1, Math.cos(a) * 0.62, 0.12, 0xfff0a0, { seg: 4 }); }
  rot.radial(5, (i) => {
    rot.beam([0, hubY, 0.4], [0, hubY - 0.5, 4.4], 0.32, P.main); rot.beam([0, hubY - 0.15, 0.4], [0, hubY - 0.75, 4.4], 0.08, trim);
    rot.cyl(0, hubY - 1.05, 4.5, 1.35, 1.2, 0.18, 10, P.dark, { cap: true });
    rot.push().translate(0, 0, 4.5);
    rot.radial(5, (j) => { rot.box(0, hubY - 0.9, 0.95, 0.7, 0.45, 0.55, SEAT[(i + j) % 8]); rot.box(0, hubY - 0.5, 1.2, 0.7, 0.5, 0.1, shade(SEAT[(i + j) % 8], 0.8)); });
    rot.bulbRing(0, hubY - 0.95, 0, 1.3, 12, ctx.look === 1 ? 0xff3fc8 : 0xffd890, 0.13);
    rot.pop();
  });
  gate(b, ctx, ctx.name, 6.9, 3.2, { h: 3.0 }); for (let i = 0; i < 3; i++) b.box(0, i * 0.1, 6.45 + i * 0.12, 2.0, 0.1, 0.4, C.plate);
  if (ctx.L2) { booth(b, ctx, 5.4, 6.6, { body: P.main, roof: P.second }); forecourtStrings(b, ctx, -5, 5, 7.4, 3.0); }
  flagPoles(b, ctx, [[-6.9, 6.0], [6.2, 6.0], [-6.9, -2], [6.2, -2]], 5.5);
  if (ctx.L3) { b.railing([-7.0, 0, 7.3], [-1.8, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 7.3], [7.0, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.45, 4); b.fx(0, 0.5, 0, 5, 1, { spread: 8, size: 0.14 }); }
  return end(b, ctx, [16, 16], 8.4, { animate: (t, dt, parts) => { parts.rotor.rotation.y = t * 0.95; parts.rotor.rotation.x = Math.sin(t * 1.9) * 0.06; parts.rotor.rotation.z = Math.cos(t * 1.9) * 0.05; } });
} };

/* ------------------------------------------------------------------ musik: Music Express (M) */
MODELS.musik = { build(opts) {
  const { b, ctx } = begin('musik', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim;
  roundDeck(b, ctx, 7.2, 0x44485a);
  // undulating round track split in two interleaved rings (A / B) that rise and fall in anti-phase around the central cone
  const ringA = b.part('ringA', [0, 0, 0]); const ringB = b.part('ringB', [0, 0, 0]); const nCars = 16;
  const trackC = ctx.look === 1 ? 0x2a1850 : 0x5a5f6c;
  for (let i = 0; i < 24; i++) {
    const tgt = i & 1 ? ringB : ringA; const a0 = TAU * i / 24; const a1 = TAU * (i + 1) / 24; const rI = 3.7; const rO = 6.5; const y = 0.35 + 0.12 * Math.sin(a0 * 3);
    const p = (a, r) => [Math.sin(a) * r, y, Math.cos(a) * r];
    tgt.quad(p(a0, rO), p(a1, rO), p(a1, rI), p(a0, rI), i % 4 < 2 ? trackC : shade(trackC, 1.25), {});
  }
  for (let i = 0; i < nCars; i++) {
    const tgt = i & 1 ? ringB : ringA; const a = TAU * i / nCars; const c = ctx.look === 1 ? [0xff3fc8, 0x41e8ff, 0x8a5bff][i % 3] : ctx.look === 2 ? [0x1f5fb8, 0xfdfdf6][i & 1] : [0xc8283a, 0xf4c430, 0x2d6fd0, 0x2f9a58][i % 4];
    tgt.push().rotY(a).translate(0, 0.55, 5.1);
    tgt.box(0, 0, 0, 1.6, 0.42, 1.0, c); tgt.box(0.75, 0.0, 0, 0.3, 0.3, 0.9, shade(c, 0.85)); tgt.box(-0.5, 0.42, 0, 0.5, 0.5, 0.8, 0x2a2a30); tgt.box(0.1, 0.42, 0, 0.1, 0.25, 0.9, C.steel);
    if (ctx.L3 && i % 2 === 0) tgt.figure(-0.05, 0, Math.PI / 2, { scale: 0.65, body: SEAT[i % 8], y: 0.4 });
    tgt.pop();
  }
  // the central cone hub with a deep bulb fascia, radial bulb ribs and portrait medallions
  b.cyl(0, 0.3, 0, 2.4, 2.4, 2.4, 12, P.main, { alt: [P.main, shade(P.main, 0.85)] });
  b.band(0, 2.7, 0, 2.55, 1.7, 12, P.second, { alt: [P.second, shade(P.second, 0.9)] }); b.band(0, 2.62, 0, 2.6, 0.12, 12, trim); b.band(0, 4.3, 0, 2.6, 0.12, 12, trim);
  b.radial(12, (i) => b.mural([4, 0, 4, 5][i % 4], i + 21, 0, 3.5, 2.56, 1.5, 1.2, { look: ctx.look, frame: trim, frameW: 0.06, back: false, frameZ: -0.03 }), Math.PI / 12);
  b.cyl(0, 4.4, 0, 3.7, 0.3, 2.3, 12, P.awn[0], { alt: ctx.look === 1 ? [0x22103f, 0x5a2ad0] : P.awn, smooth: false });
  b.scallopRing(0, 4.4, 0, 3.72, 0.4, 12, P.awn[0], P.awn[1], { flare: 0.08 });
  b.bulbRing(0, 4.3, 0, 3.78, 36, ctx.bulb, 0.15); b.bulbRing(0, 2.64, 0, 2.66, 24, ctx.bulb, 0.14); b.bulbRing(0, 4.28, 0, 2.66, 24, ctx.bulb, 0.14); b.bulbRing(0, 3.45, 0, 2.66, 24, ctx.bulb, 0.1);
  b.radial(12, () => b.bulbRow([0, 4.6, 3.5], [0, 6.6, 0.3], 0.45, ctx.bulb, 0.13));
  b.cyl(0, 6.6, 0, 0.14, 0.06, 1.0, 5, trim); b.sphere(0, 7.7, 0, 0.22, trim, { seg: 6 });
  if (ctx.L3) { ledRing(b, 4.36, 2.66, 24, 0.08, ctx.led); ledRing(b, 4.46, 3.72, 28, 0.08, ctx.led.slice().reverse()); }
  gate(b, ctx, ctx.name, 7.0, 3.2, { h: 3.0 }); for (let i = 0; i < 3; i++) b.box(0, i * 0.1, 6.6 + i * 0.12, 2.0, 0.1, 0.4, C.plate);
  if (ctx.L2) { booth(b, ctx, 5.5, 6.6, { body: P.main, roof: P.second }); forecourtStrings(b, ctx, -5, 5, 7.4, 3.0); }
  flagPoles(b, ctx, [[-7.0, 6.2], [-7.0, -6.5], [6.3, -6.5], [6.3, 2.0]], 5.5);
  if (ctx.L3) { b.railing([-7.0, 0, 7.3], [-1.8, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 7.3], [7.0, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.45, 3); }
  return end(b, ctx, [16, 16], 8.0, { animate: (t, dt, parts) => { parts.ringA.rotation.y = -t * 1.1; parts.ringB.rotation.y = -t * 1.1; parts.ringA.position.y = Math.sin(t * 3.0) * 0.18; parts.ringB.position.y = Math.sin(t * 3.0 + Math.PI) * 0.18; } });
} };

/* ------------------------------------------------------------------ takeoff: tilt ride (M) */
MODELS.takeoff = { build(opts) {
  const { b, ctx } = begin('takeoff', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim;
  // raised grey checker-plate platform with blue stairs, painted rear wall, ellipse bulb sign
  b.box(0, -0.5, 0.4, 13.6, 1.85, 10.4, 0x2f2f35, { cols: { top: C.plate } }); b.box(0, 1.36, 0.4, 13.4, 0.03, 10.2, C.plate, { noFront: true, noBack: true });
  b.bulbRow([-6.8, 1.0, 5.65], [6.8, 1.0, 5.65], 0.4, ctx.bulb, 0.15);
  for (let i = 0; i < 4; i++) b.box(-4.8 + 0, i * 0.34, 6.4 + 0.6 - i * 0.42 + 0.0, 2.2, 0.34, 0.42, ctx.look === 1 ? 0xff3fc8 : 0x2d6fd0);
  b.railing([-6.6, 1.36, 5.4], [-2.6, 1.36, 5.4], 0.95, ctx.look === 2 ? 0x1f5fb8 : C.steel); b.railing([-6.6, 1.36, 5.4], [-6.6, 1.36, -3], 0.95, ctx.look === 2 ? 0x1f5fb8 : C.steel);
  b.box(0, 1.36, -5.4, 13.6, 6.4, 0.4, P.dark); b.mural(1, 9, 0, 4.6, -5.18, 13.0, 4.6, { look: ctx.look, frame: trim, frameW: 0.1, back: false, frameZ: -0.1 });
  b.bulbRow([-6.6, 7.6, -5.0], [6.6, 7.6, -5.0], 0.4, ctx.bulb, 0.15);
  fascia(b, ctx, ctx.name, 0, 8.5, -5.2, 5.4, 1.1);
  [-1, 1].forEach((sx) => { b.cyl(sx * 5.4, 1.4, -3.2, 0.06, 0.06, 5.2, 4, 0xdddddd); b.bulbRing(sx * 5.4, 6.9, -3.2, 1.5, 24, ctx.look === 1 ? 0xff3fc8 : 0x9be040, 0.17, { vertical: true }); b.bulbRing(sx * 5.4, 6.9, -3.2, 0.9, 14, 0xffe27a, 0.15, { vertical: true }); });
  // gold bulb ellipse
  for (let i = 0; i < 40; i++) { const a = TAU * i / 40; b.bulb(Math.cos(a) * 3.6, 8.5 + Math.sin(a) * 1.0, -5.0, ctx.look === 1 ? 0x41e8ff : 0xffcf5a, 0.14); }
  // static mast, tilted hub, spinning arm with two rows of seats at each end
  b.cyl(0, 1.38, 0, 0.9, 0.6, 4.6, 9, P.main, { alt: [P.main, shade(P.main, 0.85)] }); b.band(0, 2.1, 0, 0.92, 0.14, 9, trim);
  const tilt = b.part('tilt', [0, 6.0, 0]); const spin = tilt.part('spin', [0, 6.0, 0]);
  tilt.cyl(0, 5.7, 0, 0.8, 0.8, 0.6, 9, trim);
  spin.cyl(0, 5.8, 0, 0.5, 0.5, 0.4, 9, P.main); spin.beam([-5.9, 6.0, 0], [5.9, 6.0, 0], 0.46, P.main); spin.beam([-5.9, 5.74, 0], [5.9, 5.74, 0], 0.1, trim);
  spin.sphere(0, 6.45, 0, 0.5, ctx.look === 1 ? 0x41e8ff : 0xf4c430, { seg: 6 });
  [-1, 1].forEach((s) => {
    for (let r = 0; r < 5; r++) { const x = s * (2.4 + r * 0.72);
      [-0.55, 0.55].forEach((z, q) => { const c = SEAT[(r * 2 + q + (s > 0 ? 3 : 0)) % 8]; spin.box(x, 5.02, z, 0.62, 0.34, 0.52, c); spin.box(x - s * 0.22, 5.36, z, 0.1, 0.5, 0.52, shade(c, 0.8)); spin.beam([x, 5.7, z], [x, 5.3, z], 0.05, 0xc9ced4, {}); if (ctx.L3 && (r + q) % 2 === 0) spin.figure(x, z, s > 0 ? -Math.PI / 2 : Math.PI / 2, { scale: 0.6, body: SEAT[(r + q) % 8], y: 5.1 }); });
      spin.beam([x, 6.0, 0], [x, 5.7, 0.55], 0.06, 0xc9ced4); spin.beam([x, 6.0, 0], [x, 5.7, -0.55], 0.06, 0xc9ced4);
    }
    spin.sphere(s * 6.0, 6.0, 0, 0.3, trim, { seg: 5 }); spin.bulb(s * 6.0, 6.0, 0, 0xffd890, 0.2);
    for (let r = 0; r < 6; r++) spin.bulb(s * (1.4 + r * 0.8), 6.25, 0, ctx.bulb, 0.14);
  });
  if (ctx.L3) { for (let i = 0; i < 7; i++) spin.led([-5.8 + i * 1.65, 6.0, 0.25], [-4.3 + i * 1.65, 6.0, 0.25], 0.08, ctx.led[i % 3], { chase: (i + 1) / 8 }); }
  gate(b, ctx, ctx.name, 6.9, 3.2, { h: 3.0 }); if (ctx.L2) booth(b, ctx, 5.8, 6.5, { body: P.main, roof: P.second }); if (ctx.L2) forecourtStrings(b, ctx, -5, 5, 7.4, 3.0);
  flagPoles(b, ctx, [[-7.0, 7.0], [6.2, 7.0], [-7.0, -4], [6.2, -4]], 6.0);
  if (ctx.L3) { b.railing([-7.0, 0, 7.3], [-1.8, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 7.3], [7.0, 0, 7.3], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.45, 3); b.fx(-4, 1.4, 3, 3, 0, { spread: 3, size: 0.4 }); }
  return end(b, ctx, [16, 16], 9.6, { animate: (t, dt, parts) => { parts.tilt.rotation.x = 0.34; parts.spin.rotation.y = t * 1.3; } });
} };

/* ------------------------------------------------------------------ infinity: pendulum arm (M) */
MODELS.infinity = { build(opts) {
  const { b, ctx } = begin('infinity', opts); const P = ctx.pal; const trim = ctx.L4 ? GOLD : P.trim;
  const mag = ctx.look === 1 ? 0x8a5bff : ctx.look === 2 ? 0x1f5fb8 : 0xc8208a; const yel = ctx.look === 1 ? 0x41e8ff : 0xf4d03a;
  roundDeck(b, ctx, 5.8, 0x4a4d56);
  const axle = 15.0; const armL = 9.4;
  // two A-leg towers with a yellow zig-zag LED line, an axle housing and a pale tripod pylon
  [-3.4, 3.4].forEach((x) => {
    [-1, 1].forEach((s) => { b.beam([x, 0.2, s * 3.6], [x, axle, 0], 0.5, mag); b.beam([x + 0.0, 0.2, s * 3.6], [x, axle, 0], 0.1, 0xffffff); });
    b.beam([x, 4.0, -2.4], [x, 4.0, 2.4], 0.3, mag); b.beam([x, 8.4, -1.4], [x, 8.4, 1.4], 0.3, mag);
    for (let k = 0; k < 6; k++) { const y0 = 0.6 + k * 2.2; const y1 = y0 + 2.2; const z0 = (3.6 - (y0 / axle) * 3.6) * (k & 1 ? 1 : -1); const z1 = (3.6 - (y1 / axle) * 3.6) * (k & 1 ? -1 : 1); b.led([x + 0.28, y0, z0], [x + 0.28, y1, z1], 0.1, yel, { chase: ctx.L3 ? ((k % 6) + 1) / 7 : 0 }); b.led([x - 0.28, y0, z0], [x - 0.28, y1, z1], 0.1, yel); }
    b.cyl(x, axle - 0.5, 0, 0.7, 0.7, 1.0, 8, trim);
  });
  b.beam([-3.4, axle, 0], [3.4, axle, 0], 0.4, 0xdfe5ea);
  b.cyl(5.4, 0.2, 0.0, 0.5, 0.3, 12, 5, 0xbfe2ee); b.beam([5.4, 0.2, 0], [5.4, 7, 0], 0.2, 0xbfe2ee);
  // the pendulum arm and its spinning seat disc
  const arm = b.part('arm', [0, axle, 0]); const disc = arm.part('disc', [0, axle - armL, 0]);
  arm.beam([0, axle, 0], [0, axle - armL + 0.5, 0], 0.5, 0xf1e8d4); arm.beam([0.28, axle, 0], [0.28, axle - armL + 0.5, 0], 0.12, trim); arm.beam([-0.28, axle, 0], [-0.28, axle - armL + 0.5, 0], 0.12, trim);
  arm.cyl(0, axle - 0.35, 0, 0.9, 0.9, 0.7, 8, trim);
  disc.cyl(0, axle - armL - 0.1, 0, 2.0, 1.8, 0.35, 12, mag, { cap: true }); disc.cyl(0, axle - armL - 0.1, 0, 0.5, 0.5, 0.7, 8, 0xf1e8d4);
  disc.radial(14, (i) => { disc.box(0, axle - armL - 0.5, 1.55, 0.5, 0.35, 0.45, SEAT[i % 8]); disc.box(0, axle - armL - 0.2, 1.8, 0.5, 0.5, 0.08, shade(SEAT[i % 8], 0.8)); disc.bulb(0, axle - armL + 0.35, 2.05, ctx.bulb, 0.13); });
  if (ctx.L3) ledRing(disc, axle - armL + 0.28, 2.0, 24, 0.08, ctx.led);
  b.bulbRow([-3.4, axle + 0.3, 0], [3.4, axle + 0.3, 0], 0.5, ctx.bulb, 0.18);
  // a winged gold sign at the foot
  gate(b, ctx, ctx.name, 5.4, 3.2, { h: 3.0 });
  b.tri([-2.9, 3.4, 5.5], [-1.9, 3.6, 5.5], [-1.9, 3.0, 5.5], GOLD, { dbl: true }); b.tri([2.9, 3.4, 5.5], [1.9, 3.6, 5.5], [1.9, 3.0, 5.5], GOLD, { dbl: true });
  if (ctx.L2) { booth(b, ctx, 5.0, 4.6, { body: P.main, roof: P.second }); forecourtStrings(b, ctx, -4.5, 4.5, 6.2, 3.0); }
  flagPoles(b, ctx, [[-5.4, 5.0], [5.4, 3.0], [-5.8, -4.5], [5.8, -4.5]], 6.0);
  if (ctx.L3) { b.railing([-5.8, 0, 6.5], [-1.8, 0, 6.5], 0.95, ctx.L4 ? GOLD : C.steel); b.railing([1.8, 0, 6.5], [5.8, 0, 6.5], 0.95, ctx.L4 ? GOLD : C.steel); queue(b, ctx, 7.0, 3); b.fx(0, 0.5, 0, 4, 1, { spread: 5, size: 0.14 }); }
  return end(b, ctx, [16, 16], axle + 2.0, { animate: (t, dt, parts) => { parts.arm.rotation.x = Math.sin(t * 0.8) * 0.7; parts.disc.rotation.y = t * 1.4; } });
} };
