/* Schueberfouer Tycoon, W3: the background fair.  ~200 static stalls, white gabled hall tents, trailers and camelot stalls fill every part of the Glacis that is
 * not a player pitch, an alley or the tram lane, so the field looks as dense as the real photos from minute one.
 *   buildNpcFair({ T, pitches, fieldPoly, groundY, seed, quality, lane })  -> { group, count, stats }     one Builder group in the GAME frame (merged by fair.js)
 *   buildPitchNpc({ T, rect, seed, far, bigFor, noLock })                  -> Group in the model contract (origin = pitch centre, +z front): the NPC stall that
 *                                                                              stands on a LOCKED pitch, with a padlock plate "ab * N"; also the stand-in for items
 *                                                                              without a model yet (bigFor = 'L' | 'XL' | 'W')
 * 15 skins (hall tent x3, chalet, kiosk, trailer, camelot x2, temple gable, fisher hut, arch stall, game stall, sweets booth, kids ride, chair-ride canopy, worksite).
 * Fully procedural, no real names: the lettering is generic (Fritten, Bratwurst, Crêpes, Bar, Café ...). */
import { Builder, mulberry, col, shade, C, PAL, GOLD, lerp, TAU } from './kit.js';

export const YAW = { '+w': 0, '-w': Math.PI, '+u': Math.PI / 2, '-u': -Math.PI / 2 };
const SIZE = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30], W: [40, 24] };
const WORDS = ['FRITTEN', 'BRATWURST', 'GAUFRES', 'CRÊPES', 'POMMES', 'BÉIER', 'KAFFI', 'PIZZA', 'LOS', 'GLACE', 'CHURROS', 'KÄSE', 'BONBONS', 'SCHOKO', 'NOUGAT', 'MANDELEN', 'KUCHEN', 'ÄPPEL', 'DÖNER', 'FLAMMKUCHEN', 'FRÜCHT', 'SOUVENIRS', 'SCHÉISSBUD', 'WÄISSWINN', 'LÉIFKUCHEN', 'LUFTBALLONGEN'];
const HALL_WORDS = ['Restaurant', 'Brasserie', 'Bierhaus', 'Crêperie', 'Café', 'Fëschstuff', 'Weinstuff', 'Grill'];
const AWN = [[0xc8283a, 0xf6ead0], [0x2d6fd0, 0xf6ead0], [0x2f9a58, 0xf6ead0], [0xf08a2a, 0xf6ead0], [0xc8283a, 0xffffff], [0x1f5fb8, 0xffffff], [0x7a47c8, 0xf6ead0], [0x25a6a6, 0xf6ead0]];
const BODY = [0xf3efe2, 0xf8f6ee, 0xe9e3d0, 0xdfe8f0, 0xf1dcc8, 0xd9e6d2, 0xf2e2b8, 0xe8d6d6];
const WOODS = [0x8a5a34, 0x6a4a30, 0x5a3a28, 0x9a6a3c];
const GOODS = [0xee6fa8, 0xf4c430, 0x41c4d8, 0x8a5bc8, 0xf08a2a, 0x7ad06a, 0xd8433a, 0xffffff];

const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const warm = 0xffd890;

/* ------------------------------------------------------------------ skins: draw at the origin, front = +z, within w x d (centred) */
function sign(b, text, x, y, z, w, h, look, kind = 'plate') { b.sign(text, x, y, z, w, h, { look, kind, frameW: 0.05, frame: 0x3a2a20 }); }

function hallTent(b, r, w, d, o = {}) {
  const body = o.body || pick(r, [0xf3f1ea, 0xf8f8f2, 0xeeeee6]); const band = pick(r, AWN)[0]; const H = 2.5; const rise = Math.min(2.8, w * 0.28);
  b.box(0, 0, 0, w, H, d, body, { cols: { front: 0xf7f5ee } });
  b.gable(0, H, 0, w, d, rise, 0xf1efe8, { ridge: 'z', over: 0.15, ends: 0xf8f6ef, back: 0xe6e4dc });
  b.box(0, H - 0.05, d / 2 + 0.02, w + 0.2, 0.3, 0.06, band);                                    // coloured eave band on the gable end
  b.box(0, H, 0, w + 0.3, 0.12, d + 0.3, band, { noTop: false });
  b.box(0, 0, 0, w + 0.06, 0.55, d + 0.06, band, { cols: { top: band } });
  b.box(0, H + rise - 0.05, 0, 0.16, 0.14, d + 0.2, band);
  // large lettered end wall + dark entrance + bulbs on the eave and gable edge
  const look = r() < 0.3 ? 2 : 0; sign(b, pick(r, HALL_WORDS), 0, H + rise * 0.42, d / 2 + 0.06, Math.min(w * 0.7, 6.5), Math.min(1.3, rise * 0.6), look, 'main');
  b.box(0, 0.05, d / 2 + 0.03, Math.min(3.2, w * 0.4), 2.1, 0.04, 0x3a2f2a);
  b.bulbRow([-w / 2, H + 0.1, d / 2 + 0.22], [w / 2, H + 0.1, d / 2 + 0.22], 0.7, warm, 0.14);
  b.bulbRow([-w / 2, H + 0.1, d / 2 + 0.2], [0, H + rise, d / 2 + 0.2], 0.7, warm, 0.14); b.bulbRow([w / 2, H + 0.1, d / 2 + 0.2], [0, H + rise, d / 2 + 0.2], 0.7, warm, 0.14);
  // side windows (dark glass strips) + a row of flags along the eave
  if (!b.far) { for (let k = 0; k < 2; k++) { const z = -d / 2 + (k + 0.5) * d / 2; b.quad([w / 2 + 0.02, 0.5, z + 1.0], [w / 2 + 0.02, 0.5, z - 1.0], [w / 2 + 0.02, 1.7, z - 1.0], [w / 2 + 0.02, 1.7, z + 1.0], 0x39465a); b.quad([-w / 2 - 0.02, 0.5, z - 1.0], [-w / 2 - 0.02, 0.5, z + 1.0], [-w / 2 - 0.02, 1.7, z + 1.0], [-w / 2 - 0.02, 1.7, z - 1.0], 0x39465a); } }
  if (o.flags !== false && !b.far) { b.pennants([-w / 2, H + 0.5, d / 2 + 0.3], [w / 2, H + 0.5, d / 2 + 0.3], Math.max(5, Math.round(w)), pick(r, AWN), 0.3, { noWire: true }); }
}
function chalet(b, r, w, d) {
  const wood = pick(r, WOODS); const H = 2.3;
  b.box(0, 0, 0, w, H, d, wood, { cols: { front: shade(wood, 1.15) } }); b.box(0, 0.8, d / 2 + 0.02, w * 0.7, 1.0, 0.05, 0x1f2c36); b.box(0, 0.75, d / 2 + 0.25, w * 0.78, 0.07, 0.5, C.steel);
  b.gable(0, H, 0, w + 0.4, d + 0.5, 1.4, pick(r, [0x4a3228, 0x6b3a2a, 0x3a4048]), { over: 0.2, ridge: 'x' }); b.tri([-w / 2 - 0.1, H, d / 2 + 0.25], [w / 2 + 0.1, H, d / 2 + 0.25], [0, H + 1.4, d / 2 + 0.25], shade(wood, 1.1));
  sign(b, pick(r, WORDS), 0, H + 0.45, d / 2 + 0.3, Math.min(w * 0.8, 3.0), 0.55, r() < 0.4 ? 2 : 0);
  b.bulbRow([-w / 2 - 0.1, H + 0.1, d / 2 + 0.3], [w / 2 + 0.1, H + 0.1, d / 2 + 0.3], 0.5, warm, 0.13);
  if (!b.far) { const aw = pick(r, AWN); b.valance([-w / 2, H - 0.1, d / 2 + 0.28], [w / 2, H - 0.1, d / 2 + 0.28], 0.3, Math.round(w * 2), aw[0], aw[1]); }
}
function kiosk(b, r, w, d) {
  const wall = pick(r, BODY); const H = 2.3; const aw = pick(r, AWN);
  b.box(0, 0, 0, w, H, d, wall); b.box(0, 0.9, d / 2 + 0.02, w * 0.7, 0.95, 0.05, 0x1f2c36); b.box(0, 0.85, d / 2 + 0.2, w * 0.8, 0.07, 0.42, C.steel);
  b.hip(0, H, 0, w, d, 1.1, aw[0], { over: 0.3, alt: aw });
  sign(b, pick(r, WORDS), 0, H + 0.55, d / 2 + 0.34, Math.min(w * 0.85, 3.0), 0.55, r() < 0.4 ? 2 : 0);
  b.bulbRow([-w / 2, H + 0.1, d / 2 + 0.34], [w / 2, H + 0.1, d / 2 + 0.34], 0.5, warm, 0.13);
  if (!b.far) b.valance([-w / 2 - 0.2, H + 0.05, d / 2 + 0.32], [w / 2 + 0.2, H + 0.05, d / 2 + 0.32], 0.26, Math.round(w * 2), aw[0], aw[1]);
}
function trailer(b, r, w, d) {
  const body = pick(r, BODY); const aw = pick(r, AWN); const H = 2.5;
  b.box(0, -0.2, 0, w + 0.3, 0.9, d + 0.2, 0x2f2f35, { cols: { top: C.plate } });
  b.box(0, 0.7, -0.2, w, H, d - 0.4, body); b.box(0, 0.7, d / 2 - 0.35, w, 1.0, 0.4, pick(r, WOODS)); b.box(0, 1.7, d / 2 - 0.35, w + 0.1, 0.06, 0.5, C.steel);
  b.box(0, 0.7 + H - 0.2, d / 2 - 0.1, w + 0.1, 0.55, 0.2, aw[0]); b.bulbRow([-w / 2, 0.7 + H + 0.1, d / 2 + 0.05], [w / 2, 0.7 + H + 0.1, d / 2 + 0.05], 0.45, warm, 0.13);
  sign(b, pick(r, WORDS), 0, 0.7 + H + 0.65, d / 2 - 0.1, Math.min(w * 0.7, 3.6), 0.62, r() < 0.4 ? 2 : 0, 'main');
  if (!b.far) for (let i = 0; i < 6; i++) b.blob(-w * 0.35 + i * w * 0.14, 2.0, d / 2 - 0.6, 0.18, 0.2, 0.15, pick(r, GOODS));
}
function camelot(b, r, w, d, o = {}) {
  const aw = pick(r, AWN); const H = 2.2;
  b.box(0, 0, 0.1, w, 0.85, d * 0.5, pick(r, WOODS)); b.box(0, 0.85, 0.1, w + 0.1, 0.05, d * 0.5 + 0.1, 0xf4f0e2);
  [-1, 1].forEach((s) => b.cyl(s * (w / 2 - 0.05), 0, -d * 0.2, 0.04, 0.04, H, 4, 0x333333));
  if (o.umbrella) { b.cyl(0, 0, -d * 0.1, 0.04, 0.04, 2.6, 4, 0x333333); b.cone(0, 2.2, -d * 0.1, Math.max(w, d) * 0.62, 0.7, 8, aw[0], { alt: aw, smooth: false }); }
  else { b.gable(0, H, -d * 0.15, w + 0.3, d * 0.9, 0.5, aw[0], { over: 0.1, ridge: 'x' }); }
  if (!b.far) for (let i = 0; i < 6; i++) b.blob(-w * 0.35 + i * w * 0.14, 1.05, 0.15, 0.1, 0.12, 0.1, pick(r, GOODS));
  b.bulb(-w / 2 + 0.2, H - 0.1, d * 0.3, warm, 0.13); b.bulb(w / 2 - 0.2, H - 0.1, d * 0.3, warm, 0.13);
  if (!b.far && r() < 0.5) sign(b, pick(r, ['NOUGAT', 'SOUVENIRS', 'BONBONS', 'MANDELEN', 'LUFTBALLONGEN']), 0, 1.45, d * 0.38, Math.min(w * 0.85, 2.2), 0.4, 0);
}
const TARP = [0xc8283a, 0xf4f0e6, 0x8a9096, 0x2f7a52, 0xe8e2d0, 0xc8283a, 0x2d5fa8, 0xf2d070];
/** a camelot stall of the Allée Scheffer lane: canvas-draped booth, pitched white roof, red / white / grey tarp front (photo food-camelots-allee-scheffer-2018-120) */
function camelotTarp(b, r, w, d) {
  const tarp = pick(r, TARP); const H = 2.3; const side = pick(r, [0xf4f0e6, 0xe8e2d0, 0x8a9096]);
  b.box(0, 0, 0, w, H, d, side, { cols: { front: shade(side, 0.95) } });
  b.quad([-w / 2 - 0.02, 0.0, d / 2 + 0.03], [w / 2 + 0.02, 0.0, d / 2 + 0.03], [w / 2 + 0.02, H - 0.1, d / 2 + 0.03], [-w / 2 - 0.02, H - 0.1, d / 2 + 0.03], tarp);
  if (!b.far) b.quad([-w * 0.08, 0.0, d / 2 + 0.04], [w * 0.08, 0.0, d / 2 + 0.04], [w * 0.08, H - 0.1, d / 2 + 0.04], [-w * 0.08, H - 0.1, d / 2 + 0.04], shade(tarp, 0.8));
  b.gable(0, H, 0, w + 0.2, d + 0.3, 0.55, 0xf2efe6, { over: 0.1, ridge: 'x', back: 0xe0ddd2 });
  if (r() < 0.5) b.valance([-w / 2, H, d / 2 + 0.2], [w / 2, H, d / 2 + 0.2], 0.22, Math.round(w * 2), tarp, 0xf4f0e6);
  b.bulb(-w / 2 + 0.2, H - 0.05, d / 2 + 0.15, warm, 0.13); b.bulb(w / 2 - 0.2, H - 0.05, d / 2 + 0.15, warm, 0.13);
  if (!b.far && r() < 0.4) sign(b, pick(r, ['NOUGAT', 'MANDELEN', 'KÄSE', 'SOUVENIRS', 'BONBONS', 'WÄRSCHT']), 0, H + 0.5, d / 2 + 0.1, Math.min(w * 0.85, 2.2), 0.42, 0);
}
function temple(b, r, w, d) {
  const H = 2.6; const wall = pick(r, [0xf3efe2, 0xe8e0c8]);
  b.box(0, 0, -0.3, w, H, d - 0.6, wall); b.box(0, 0.85, d / 2 - 0.6, w * 0.8, 1.0, 0.05, 0x1f2c36);
  [-1, -0.33, 0.33, 1].forEach((k) => b.cyl(k * (w / 2 - 0.4), 0, d / 2 - 0.2, 0.16, 0.14, H + 0.1, 6, 0xf8f6ee));
  b.box(0, H + 0.1, d / 2 - 0.2, w + 0.3, 0.3, 0.9, 0xf0eadb); b.tri([-w / 2 - 0.1, H + 0.4, d / 2 + 0.2], [w / 2 + 0.1, H + 0.4, d / 2 + 0.2], [0, H + 1.5, d / 2 + 0.2], 0xe6dfcb);
  b.box(0, 0, -0.3, w, 0.0, d - 0.6, wall); b.gable(0, H + 0.4, -0.3, w + 0.2, d - 0.4, 1.1, 0xb8b0a0, { ridge: 'x', over: 0.1 });
  sign(b, 'DÖNER', 0, H + 0.45, d / 2 + 0.28, 2.4, 0.5, 0); b.bulbRow([-w / 2, H + 0.12, d / 2 + 0.3], [w / 2, H + 0.12, d / 2 + 0.3], 0.5, warm, 0.13);
}
function fisherHut(b, r, w, d) {
  const H = 2.4; const wood = 0x6a4a30;
  b.box(0, 0, 0, w, H, d, wood, { cols: { front: 0x7a5a3a } }); b.gable(0, H, 0, w + 0.5, d + 0.5, 1.5, 0x3a5a6a, { over: 0.25, ridge: 'x', back: 0x30485a });
  b.box(0, 0.9, d / 2 + 0.02, w * 0.6, 0.9, 0.05, 0x1f2c36); b.box(0, 0.85, d / 2 + 0.25, w * 0.7, 0.07, 0.45, 0xb9672f);
  if (!b.far) { for (let k = 0; k < 3; k++) { const x = -w / 2 + 0.6 + k * (w - 1.2) / 2; b.tri([x - 0.5, H, d / 2 + 0.06], [x + 0.5, H, d / 2 + 0.06], [x, H - 1.2, d / 2 + 0.06], 0x8aa0a8, { dbl: true }); }
    [-1, 1].forEach((s) => { b.push().translate(s * (w / 2 - 0.5), 1.0, d / 2 + 0.1).rotX(Math.PI / 2); b.disc(0, 0, 0, 0.45, 0.32, 8, 0x8a5a34); b.pop(); }); }
  sign(b, 'FËSCH', 0, H + 0.5, d / 2 + 0.3, 2.0, 0.5, 0); b.bulbRow([-w / 2, H + 0.12, d / 2 + 0.3], [w / 2, H + 0.12, d / 2 + 0.3], 0.5, warm, 0.13);
}
function archStall(b, r, w, d) {
  const green = pick(r, [0x1f5e46, 0x22103f, 0x1f5fb8, 0x7a1a3a]); const H = 2.2;
  b.box(0, 0, -d / 2 + 0.15, w, H, 0.2, pick(r, WOODS)); [-1, 1].forEach((s) => b.box(s * (w / 2 - 0.07), 0, 0, 0.14, H, d - 0.2, pick(r, WOODS)));
  b.box(0, 0, d / 2 - 0.4, w - 0.2, 1.0, 0.7, pick(r, BODY)); b.box(0, 1.0, d / 2 - 0.4, w, 0.06, 0.9, C.steel);
  const n = b.far ? 3 : 6; for (let i = 0; i < n; i++) { const t0 = (i / n) * Math.PI / 2; const t1 = ((i + 1) / n) * Math.PI / 2; const p = (x, t) => [x, H - 0.2 + Math.sin(t), d / 2 - 0.45 + Math.cos(t)]; b.quad(p(-w / 2, t0), p(w / 2, t0), p(w / 2, t1), p(-w / 2, t1), green, { dbl: true }); }
  b.quad([-w / 2, H + 0.8, d / 2 - 0.45], [w / 2, H + 0.8, d / 2 - 0.45], [w / 2, H - 0.2, d / 2 - 0.45], [-w / 2, H - 0.2, d / 2 - 0.45], green, { dbl: true });
  b.bulbRow([-w / 2, H - 0.2, d / 2 + 0.58], [w / 2, H - 0.2, d / 2 + 0.58], 0.4, warm, 0.14); b.bulbRow([-w / 2, H + 0.45, d / 2 + 0.2], [w / 2, H + 0.45, d / 2 + 0.2], 0.4, warm, 0.13);
  sign(b, pick(r, WORDS), 0, H + 0.45, d / 2 + 0.05, Math.min(w * 0.8, 3.4), 0.5, 0, 'banner');
  if (!b.far) for (let i = 0; i < 5; i++) b.blob(-w * 0.35 + i * w * 0.17, 1.15, d / 2 - 0.4, 0.1, 0.08, 0.1, pick(r, [0x5a3a26, 0xc89a5a, 0xf2e4b0]));
}
function gameStall(b, r, w, d) {
  const H = 2.5; const aw = pick(r, AWN);
  b.box(0, -0.2, 0, w + 0.3, 0.9, d + 0.2, 0x2f2f35, { cols: { top: C.plate } }); b.box(0, 0.7, -d / 2 + 0.2, w, H, 0.2, pick(r, BODY)); [-1, 1].forEach((s) => b.box(s * (w / 2 - 0.07), 0.7, 0, 0.14, H, d - 0.3, pick(r, BODY)));
  b.box(0, 0.7, d / 2 - 0.3, w + 0.1, 1.0, 0.5, aw[0]); b.box(0, 1.7, d / 2 - 0.3, w + 0.2, 0.06, 0.7, C.steel);
  if (!b.far) for (let k = 0; k < 2; k++) for (let i = 0; i < Math.round(w * 1.4); i++) b.blob(-w / 2 + 0.5 + i * 0.5, 2.2 + k * 0.4, -d / 2 + 0.4, 0.17, 0.18, 0.14, pick(r, GOODS));
  b.box(0, 0.7 + H - 0.1, d / 2 - 0.1, w + 0.3, 0.6, 0.3, aw[0]); b.bulbRow([-w / 2, 0.7 + H + 0.25, d / 2 + 0.08], [w / 2, 0.7 + H + 0.25, d / 2 + 0.08], 0.4, warm, 0.14); b.bulbRow([-w / 2, 0.7 + H - 0.1, d / 2 + 0.08], [w / 2, 0.7 + H - 0.1, d / 2 + 0.08], 0.4, warm, 0.14);
  sign(b, pick(r, ['SCHÉISSBUD', 'WÄRFELBUD', 'DOSEWUERF', 'LOS', 'DART']), 0, 0.7 + H + 0.95, d / 2 - 0.05, Math.min(w * 0.6, 3.4), 0.7, r() < 0.4 ? 2 : 0, 'main');
}
function sweets(b, r, w, d) {
  const aw = pick(r, AWN); const H = 2.4; const colr = pick(r, [0xf08aa8, 0xf4a03a, 0xf4c430, 0x7fd0f0]);
  b.box(0, 0, -d / 2 + 0.12, w, H, 0.16, colr); b.box(0, 0, d / 2 - 0.4, w, 1.0, 0.7, pick(r, WOODS)); b.box(0, 1.0, d / 2 - 0.4, w + 0.1, 0.06, 0.85, C.steel);
  b.gable(0, H, 0, w + 0.4, d + 0.4, 0.5, aw[0], { over: 0.1, ridge: 'x' }); if (!b.far) b.valance([-w / 2 - 0.2, H, d / 2 + 0.22], [w / 2 + 0.2, H, d / 2 + 0.22], 0.3, Math.round(w * 2), aw[0], aw[1]);
  if (!b.far) for (let i = 0; i < Math.round(w * 2); i++) b.blob(-w / 2 + 0.3 + i * 0.5, 1.25, d / 2 - 0.4, 0.14, 0.16, 0.12, pick(r, GOODS));
  b.bulbRow([-w / 2, H + 0.05, d / 2 + 0.24], [w / 2, H + 0.05, d / 2 + 0.24], 0.4, warm, 0.14); sign(b, pick(r, WORDS), 0, H + 0.62, d / 2 + 0.1, Math.min(w * 0.8, 3.2), 0.55, 0);
}
function kidsRide(b, r, w, d) {
  const R = Math.min(w, d) / 2 - 0.3; const aw = pick(r, AWN);
  b.cyl(0, -0.2, 0, R + 0.2, R + 0.2, 0.5, 14, 0x3a3a40, { cap: true, capColor: 0x6a5648 }); b.cyl(0, 0.3, 0, 0.35, 0.35, 2.4, 8, aw[0]);
  b.cyl(0, 2.7, 0, R, R, 0.6, 14, aw[1]); b.cyl(0, 3.3, 0, R + 0.2, 0.15, 1.7, 14, aw[0], { alt: aw, smooth: false }); b.sphere(0, 5.15, 0, 0.14, GOLD, { seg: 5 });
  b.bulbRing(0, 2.7, 0, R + 0.05, Math.round(R * 6), warm, 0.14); if (!b.far) for (let i = 0; i < 6; i++) { const a = TAU * i / 6; b.blob(Math.sin(a) * R * 0.62, 0.9, Math.cos(a) * R * 0.62, 0.3, 0.35, 0.2, pick(r, [0xf6ead0, 0xe0a860, 0xd8433a])); }
}
function chairRide(b, r, w, d) {
  const R = Math.min(w, d) / 2 - 0.6; const aw = pick(r, AWN);
  b.cyl(0, -0.2, 0, R + 0.3, R + 0.3, 0.45, 14, 0x3a3a40, { cap: true, capColor: 0x6a6256 }); b.cyl(0, 0.2, 0, 0.9, 0.7, 3.4, 8, aw[0]);
  b.cyl(0, 3.6, 0, R, 0.3, 2.0, 18, aw[0], { alt: aw, smooth: false }); b.cyl(0, 3.0, 0, R + 0.02, R + 0.02, 0.6, 18, aw[1]);
  b.bulbRing(0, 3.0, 0, R + 0.1, Math.round(R * 5), warm, 0.14); b.sphere(0, 5.9, 0, 0.25, GOLD, { seg: 5 });
  const n = b.far ? 8 : 16; for (let i = 0; i < n; i++) { const a = TAU * i / n; const x = Math.sin(a) * (R + 0.5); const z = Math.cos(a) * (R + 0.5); b.wire([Math.sin(a) * R, 3.0, Math.cos(a) * R], [x, 0.8, z], 0.04, 0x333333); b.box(x, 0.6, z, 0.45, 0.1, 0.45, pick(r, GOODS)); }
}
function worksite(b, r, w, d) {
  // the wheel pitch before anything stands there: hoarding fences, a container, a small crane (DESIGN section 1: "under scaffolding with a crane")
  const fence = 0xc9ced4;
  for (let i = 0; i < Math.round(w / 3); i++) { const x = -w / 2 + 1.5 + i * 3; b.box(x, 0, d / 2 - 0.4, 2.8, 1.8, 0.1, i & 1 ? 0xf4c430 : 0xe9e5d8); b.box(x, 0, -d / 2 + 0.4, 2.8, 1.8, 0.1, i & 1 ? 0xe9e5d8 : 0xf4c430); }
  [-1, 1].forEach((s) => { for (let i = 0; i < Math.round(d / 3); i++) b.box(s * (w / 2 - 0.4), 0, -d / 2 + 1.5 + i * 3, 0.1, 1.8, 2.8, i & 1 ? 0xf4c430 : 0xe9e5d8); });
  b.box(-w * 0.28, 0, 0, 6.0, 2.6, 2.4, 0x3a6a8a, { cols: { top: 0x2f5a78 } }); b.box(-w * 0.28 + 6.2, 0, 1.0, 2.4, 2.6, 2.4, 0xc8603a);
  b.box(w * 0.22, 0, -2, 1.2, 14, 1.2, 0xf4c430); b.beam([w * 0.22, 14, -2], [w * 0.22 - 12, 14.4, -2], 0.5, 0xf4c430); b.beam([w * 0.22, 14, -2], [w * 0.22 + 4, 14.2, -2], 0.5, 0xf4c430);
  b.beam([w * 0.22 - 11, 14.2, -2], [w * 0.22 - 11, 8, -2], 0.05, 0x222222); b.box(w * 0.22 - 11, 7.4, -2.3, 1.2, 0.8, 0.6, 0x6a6a70);
  b.beam([w * 0.22 + 3.6, 14.2, -2], [w * 0.22 + 3.6, 12.4, -2], 0.05, 0x222222); b.box(w * 0.22 + 3.1, 11.2, -2.4, 1.0, 1.2, 0.8, 0x777777);
  for (let k = 0; k < 4; k++) { b.beam([w * 0.22 - 0.6, k * 3.4, -2.6], [w * 0.22 + 0.6, (k + 1) * 3.4, -2.6], 0.12, 0xdadada); }
  if (!b.far) b.sign('RISERAD · BAUSTELL', 0, 2.2, d / 2 + 0.1, 5.0, 0.9, { look: 0, kind: 'banner', frameW: 0.06, frame: 0x3a2a20 });
  b.bulb(w * 0.22, 14.3, -2, 0xff4a3a, 0.3);
}
function bigTentRow(b, r, w, d) {
  const n = Math.max(1, Math.round(w / 18)); const rows = d > 20 ? 2 : 1; const tw = w / n - 0.9; const td = d / rows - 1.0;
  for (let k = 0; k < rows; k++) for (let i = 0; i < n; i++) { b.push().translate(-w / 2 + (i + 0.5) * w / n, 0, -d / 2 + (k + 0.5) * d / rows); hallTent(b, r, tw, td); b.pop(); }
}

export const SKINS = {
  hall: { w: [8, 14], d: [10, 18], fn: hallTent }, hallWide: { w: [14, 24], d: [10, 16], fn: hallTent }, hallL: { w: [28, 29], d: [16, 17], fn: hallTent }, hallSmall: { w: [6, 9], d: [8, 12], fn: hallTent },
  chalet: { w: [4, 6], d: [3.5, 5], fn: chalet }, kiosk: { w: [3.5, 5], d: [3, 4], fn: kiosk }, trailer: { w: [5, 8], d: [2.6, 3.2], fn: trailer },
  camelot: { w: [2.4, 3.6], d: [2, 2.6], fn: (b, r, w, d) => camelot(b, r, w, d, { umbrella: r() < 0.4 }) }, temple: { w: [5, 6.5], d: [4, 5], fn: temple }, fisher: { w: [5, 6.5], d: [3.5, 4.5], fn: fisherHut },
  arch: { w: [4.5, 6], d: [3.2, 4], fn: archStall }, game: { w: [5, 8], d: [2.8, 3.4], fn: gameStall }, sweets: { w: [4, 6], d: [3, 3.8], fn: sweets }, kids: { w: [6, 7.6], d: [6, 7.6], fn: kidsRide }, chair: { w: [11, 14], d: [11, 14], fn: chairRide },
  worksite: { w: [38, 38], d: [22, 22], fn: worksite }, bigTent: { w: [52, 55], d: [27, 29], fn: bigTentRow },
};
const rangeVal = (r, [a, b]) => a + (b - a) * r();

/** a skin fitted into a w x d footprint (shrinks the random size to fit) */
function drawSkin(b, name, r, maxW, maxD) {
  const s = SKINS[name]; const w = Math.min(rangeVal(r, s.w), maxW); const d = Math.min(rangeVal(r, s.d), maxD);
  s.fn(b, r, w, d); return { w, d };
}

/* ------------------------------------------------------------------ one NPC stall on a (locked) pitch, in the model contract */
export function buildPitchNpc({ T, rect, seed = 1, far = false, bigFor, noLock = false }) {
  const size = bigFor || rect.size; const dims = SIZE[size] || SIZE.S; const r = mulberry(seed * 1013 + 7);
  const b = new Builder({ seed, rnd: r, far }); b.jit = 0.06;
  const [pw, pd] = dims.map((v) => v - 0.8);
  const choices = { S: ['kiosk', 'chalet', 'trailer', 'arch', 'sweets', 'game', 'temple', 'fisher'], M: ['hall', 'hallSmall', 'kids', 'chair'], L: ['hallL'], XL: ['bigTent'], W: ['worksite'] }[size] || ['kiosk'];
  const name = choices[Math.floor(r() * choices.length)];
  const used = drawSkin(b, name, r, pw, pd);
  // everything is drawn around the centre of its footprint: shift the skin so it sits in the pitch (the front stays towards the alley)
  if (!noLock && size !== 'W') b.lockSign(rect.star || 1, 0, 2.7, Math.min(pd / 2 + 0.1, used.d / 2 + 1.4), 1.8, 0.6, { frame: 0x3a2a20, frameW: 0.05 });
  if (!noLock && size === 'W') b.lockSign(rect.star || 1, 0, 2.7, pd / 2 + 0.3, 2.4, 0.8, { frame: 0x3a2a20, frameW: 0.05 });
  const g = b.finish({ id: 'npc-' + rect.id, look: 0, level: 1, size: dims, height: 6, kind: 'npc' });
  g.userData.skin = name; g.userData.locked = !noLock;
  return g;
}

/* ------------------------------------------------------------------ the background fair */
function inPoly(poly, u, w) { let ins = false; for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) { const [ui, wi] = poly[k]; const [uj, wj] = poly[j]; if ((wi > w) !== (wj > w) && u < ((uj - ui) * (w - wi)) / (wj - wi + 1e-12) + ui) ins = !ins; } return ins; }
const CELL = 2; const U0 = -20; const W0 = -24; const NU = 160; const NW = 90;
function makeGrid() { return { g: new Uint8Array(NU * NW), mark(u0, u1, w0, w1) { const i0 = Math.max(0, Math.floor((u0 - U0) / CELL)); const i1 = Math.min(NU - 1, Math.floor((u1 - U0) / CELL)); const j0 = Math.max(0, Math.floor((w0 - W0) / CELL)); const j1 = Math.min(NW - 1, Math.floor((w1 - W0) / CELL)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.g[j * NU + i] = 1; }, free(u0, u1, w0, w1) { const i0 = Math.max(0, Math.floor((u0 - U0) / CELL)); const i1 = Math.min(NU - 1, Math.floor((u1 - U0) / CELL)); const j0 = Math.max(0, Math.floor((w0 - W0) / CELL)); const j1 = Math.min(NW - 1, Math.floor((w1 - W0) / CELL)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.g[j * NU + i]) return false; return true; } }; }

/** alley corridors and gate zones that must stay clear (data-driven, same numbers as DESIGN 4.2 and props.js) */
export const CORRIDORS = [
  { name: 'haaptallee', u: [10, 292], w: [50.2, 62.4] }, { name: 'fressgaass', u: [10, 292], w: [24.6, 31.2] },
  { name: 'cross66', u: [63, 69], w: [20, 112] }, { name: 'cross130', u: [127, 133], w: [20, 118] }, { name: 'cross190', u: [187, 193], w: [14, 122] }, { name: 'cross250', u: [247, 253], w: [8, 112] },
  { name: 'gate-sw', u: [8, 32], w: [38, 72] }, { name: 'gate-ne', u: [262, 296], w: [44, 70] },
];
const ROWS = [
  { name: 'N', front: 22.5, face: '+w', depth: 17, skins: { hallWide: 5, hall: 7, hallSmall: 2, chalet: 3, kiosk: 2, trailer: 3, arch: 2, game: 2, sweets: 2, temple: 1, fisher: 1 } },
  { name: 'M1', front: 49, face: '+w', depth: 17, skins: { hallWide: 4, hall: 6, hallSmall: 2, chalet: 3, kiosk: 2, trailer: 4, arch: 2, game: 3, sweets: 3, temple: 1, fisher: 1, kids: 1 } },
  { name: 'M2', front: 64, face: '-w', depth: 20, skins: { hallWide: 5, hall: 6, trailer: 3, kiosk: 2, game: 2, chalet: 2, kids: 1, chair: 1, sweets: 1 } },
  { name: 'S', front: 95, face: '-w', depth: 17, skins: { hallWide: 3, hall: 4, hallSmall: 3, kiosk: 3, trailer: 3, chalet: 2, sweets: 2, game: 2, arch: 1 } },
];

export function buildNpcFair({ T, pitches, fieldPoly, groundY, seed = 1, quality = 'medium', lane }) {
  const r = mulberry(seed * 7919 + 13); const b = new Builder({ seed, rnd: r, far: false }); b.jit = 0.06;
  const grid = makeGrid();
  pitches.forEach((p) => {
    const [du, dw] = SIZE[p.size] || SIZE.S; const f = p.face || '+w';
    let u0 = p.u - du / 2 - 0.7; let u1 = p.u + du / 2 + 0.7; let w0 = p.w - dw / 2 - 0.7; let w1 = p.w + dw / 2 + 0.7;
    if (f === '+w') w1 += 0.8; else if (f === '-w') w0 -= 0.8; else if (f === '+u') u1 += 4; else u0 -= 4;
    grid.mark(u0, u1, w0, w1);
  });
  CORRIDORS.forEach((c) => grid.mark(c.u[0], c.u[1], c.w[0], c.w[1]));
  let count = 0; let tris0 = 0; const byKind = {};
  const place = (skin, u, w, face, rr, maxW, maxD) => {
    const y = groundY(u, w);
    b.push().translate(u, y, w).rotY(YAW[face]); b.aoY = y;
    const used = drawSkin(b, skin, rr, maxW, maxD);
    b.pop(); b.aoY = 0; count++; byKind[skin] = (byKind[skin] || 0) + 1; return used;
  };
  const wsum = (m) => Object.values(m).reduce((a, v) => a + v, 0);
  const pickSkin = (m, rr) => { let t = rr() * wsum(m); for (const [k, v] of Object.entries(m)) { t -= v; if (t <= 0) return k; } return Object.keys(m)[0]; };
  const fits = (u0, u1, w0, w1) => grid.free(u0, u1, w0, w1) && [[u0, w0], [u1, w0], [u0, w1], [u1, w1], [(u0 + u1) / 2, (w0 + w1) / 2]].every(([u, w]) => inPoly(fieldPoly, u, w));
  // rows of stalls along the alleys
  ROWS.forEach((row, ri) => {
    const rr = mulberry(seed * 31 + ri * 977); let u = 14;
    while (u < 292) {
      const skin = pickSkin(row.skins, rr); const s = SKINS[skin];
      let w = rangeVal(rr, s.w); let d = Math.min(rangeVal(rr, s.d), row.depth);
      // try the chosen skin, then shrink to the smallest ones when the gap is tight
      let ok = false; let tries = 0;
      while (!ok && tries < 5) {
        const front = row.front; const wA = row.face === '+w' ? front - d : front; const wB = row.face === '+w' ? front : front + d;
        if (fits(u - 0.2, u + w + 0.2, wA - 0.2, wB + 0.2)) { ok = true; break; }
        w *= 0.82; d *= 0.88; tries++;
        if (w < 3 || d < 2.6) break;
      }
      if (!ok) { u += 1.5; continue; }
      const front = row.front; const wA = row.face === '+w' ? front - d : front; const wB = row.face === '+w' ? front : front + d;
      const cu = u + w / 2; const cw = row.face === '+w' ? front - d / 2 : front + d / 2;
      place(skin, cu, cw, row.face, rr, w, d); grid.mark(u - 0.2, u + w + 0.2, wA - 0.2, wB + 0.2);
      u += w + 0.35 + rr() * 0.5;
    }
  });
  // gap filling: several greedy passes (big to small) over the whole field in a shuffled scan order; the front looks at the nearest alley
  const rp = mulberry(seed * 53 + 5);
  const alleyW = [27.7, 56]; const nearestFace = (u, w, d) => { const c = w + d / 2; const t = alleyW.reduce((a, v) => (Math.abs(v - c) < Math.abs(a - c) ? v : a), alleyW[0]); return c < t ? '+w' : '-w'; };
  const cells = []; for (let w = 4; w < 126; w += 2) for (let u = 14; u < 292; u += 2) cells.push([u, w]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rp() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  [['hall', 0.85], ['hallSmall', 0.85], ['trailer', 0.7], ['chalet', 0.7], ['kiosk', 0.7], ['sweets', 0.6], ['game', 0.6], ['arch', 0.5], ['camelot', 0.9]].forEach(([skin, prob]) => {
    const s = SKINS[skin];
    for (const [u, w] of cells) {
      if (rp() > prob) continue;
      const sw = rangeVal(rp, s.w); const sd = rangeVal(rp, s.d); const face = nearestFace(u, w, sd);
      if (fits(u - 0.3, u + sw + 0.3, w - 0.3, w + sd + 0.3)) { place(skin, u + sw / 2, w + sd / 2, face, rp, sw, sd); grid.mark(u - 0.3, u + sw + 0.3, w - 0.3, w + sd + 0.3); }
    }
  });
  // camelots standing right beside the tram rails on both sides, shoulder to shoulder (free lane ~6 m); lane = [{u, w, tu, tw}] centre line samples in the game frame
  let camelots = 0;
  if (lane && lane.length > 3) {
    const rc = mulberry(seed * 17 + 3); const L = [0]; for (let i = 1; i < lane.length; i++) L.push(L[i - 1] + Math.hypot(lane[i].u - lane[i - 1].u, lane[i].w - lane[i - 1].w));
    const at = (s) => { let i = 1; while (i < L.length - 1 && L[i] < s) i++; const t = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1); const p = lane[i - 1]; const q = lane[i]; const tu = p.tu + (q.tu - p.tu) * t; const tw = p.tw + (q.tw - p.tw) * t; const l = Math.hypot(tu, tw) || 1; return { u: p.u + (q.u - p.u) * t, w: p.w + (q.w - p.w) * t, tu: tu / l, tw: tw / l }; };
    for (const side of [-1, 1]) {
      let s = 2;
      while (s < L[L.length - 1] - 4) {
        const w = 2.7 + rc() * 1.0; const q = at(s + w / 2); s += w + 0.12;
        if (q.u < 22 || q.u > 272) continue;
        if (rc() < 0.07) { s += 2.5; continue; }                       // an occasional gap (a pitch not let)
        const lat = side * (3.55 + 1.1); const u = q.u - q.tw * lat; const wv = q.w + q.tu * lat; const y = groundY(u, wv);
        const yaw = Math.atan2(side * q.tw, -side * q.tu);                // front (+z) towards the rails
        b.push().translate(u, y, wv).rotY(yaw); b.aoY = y; camelotTarp(b, rc, w, 2.3); b.pop(); b.aoY = 0; count++; camelots++;
      }
    }
  }
  const g = b.finish({ id: 'npc-fair', look: 0, level: 1, size: [300, 150], height: 8, kind: 'npc-fair' });
  g.name = 'fouer-npc-fair';
  return { group: g, count, camelots, byKind, tris: g.userData.tris, bulbs: g.userData.bulbs };
}
