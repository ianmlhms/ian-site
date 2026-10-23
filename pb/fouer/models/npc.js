/* Schueberfouer Tycoon, W3: the background fair.  ~200 static stalls, white gabled hall tents, trailers and camelot stalls fill every part of the Glacis that is
 * not a player pitch, an alley or the tram lane, so the field looks as dense as the real photos from minute one.
 *   buildNpcFair({ T, pitches, fieldPoly, groundY, seed, quality, lane })  -> { group, count, stats }     one Builder group in the GAME frame (merged by fair.js)
 *   buildPitchNpc({ T, rect, seed, far, bigFor, noLock })                  -> Group in the model contract (origin = pitch centre, +z front): the NPC stall that
 *                                                                              stands on a LOCKED pitch, with a padlock plate "ab * N"; also the stand-in for items
 *                                                                              without a model yet (bigFor = 'L' | 'XL' | 'W')
 * 15 skins (hall tent x3, chalet, kiosk, trailer, camelot x2, temple gable, fisher hut, arch stall, game stall, sweets booth, kids ride, chair-ride canopy, worksite).
 * Fully procedural, no real names: the lettering is generic (Fritten, Bratwurst, Crêpes, Bar, Café ...). */
import { Builder, mulberry, col, shade, C, PAL, GOLD, lerp, TAU, drape } from './kit.js';
import { ENTRANCES, ALLEYS, SERVICE, FRONTAGE, FACE_VEC, FRONT_REACH, DUP_SKINS, BIG_SKINS, BIG_SPACING, DUP_GAP, corridors as layoutCorridors, createReservations, rasterZones, pointInPoly as layoutInPoly } from '../layout.js';
import { backLot } from './clutter.js';
import { hallTent } from './tents.js';
import { buildStall, awning } from './stallkit.js';

/** half-length (m, along the rails) of the gap the camelots leave in front of a NW gate */
export const GATE_GAP = 6.5;

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
const GLASS = 0xffb458;          // lit shop window (lamp channel: dim amber by day, glowing by night)

/* ------------------------------------------------------------------ skins: draw at the origin, front = +z, within w x d (centred) */
function sign(b, text, x, y, z, w, h, look, kind = 'plate') { b.sign(text, x, y, z, w, h, { look, kind, frameW: 0.05, frame: 0x3a2a20, lit: true }); }

/** canvas whites are HDR (> 1): a real hall tent is the brightest thing on the field by day, and glows from inside by night (the `fabric` channel) */
const CANVAS = { roof: [1.75, 1.74, 1.68], wall: [1.45, 1.45, 1.4], end: [1.55, 1.55, 1.5], back: [1.3, 1.3, 1.27] };
function camelot(b, r, w, d, o = {}) {
  const aw = pick(r, AWN); const H = 2.2;
  b.box(0, 0, 0.1, w, 0.85, d * 0.5, pick(r, WOODS)); b.box(0, 0.85, 0.1, w + 0.1, 0.05, d * 0.5 + 0.1, 0xf4f0e2);
  [-1, 1].forEach((s) => b.cyl(s * (w / 2 - 0.05), 0, -d * 0.2, 0.04, 0.04, H, 4, 0x333333));
  if (o.umbrella) { b.cyl(0, 0, -d * 0.1, 0.04, 0.04, 2.9, 4, 0x333333); b.cone(0, 2.2, -d * 0.1, Math.max(w, d) * 0.62, 0.7, 8, aw[0], { alt: aw, smooth: false }); }
  else { b.gable(0, H, -d * 0.15, w + 0.3, d * 0.9, 0.5, aw[0], { over: 0.1, ridge: 'x' }); }
  if (!b.far) for (let i = 0; i < 6; i++) b.blob(-w * 0.35 + i * w * 0.14, 1.05, 0.15, 0.1, 0.12, 0.1, pick(r, GOODS));
  b.bulb(-w / 2 + 0.2, H - 0.1, d * 0.3, warm, 0.13); b.bulb(w / 2 - 0.2, H - 0.1, d * 0.3, warm, 0.13);
  if (!b.far && r() < 0.5) {         // a little board standing on the counter's front edge on two posts (it used to hang in the air in front of the counter)
    const sw = Math.min(w * 0.85, 2.2); const sz = 0.1 + d * 0.25 - 0.08;
    [-1, 1].forEach((s) => b.cyl(s * (sw / 2 - 0.1), 0.88, sz, 0.02, 0.02, 0.5, 4, 0x333333));
    sign(b, pick(r, ['NOUGAT', 'SOUVENIRS', 'BONBONS', 'MANDELEN', 'LUFTBALLONGEN']), 0, 1.58, sz, sw, 0.4, 0);
  }
}
const TARP = [0xc8283a, 0xf4f0e6, 0x8a9096, 0x2f7a52, 0xe8e2d0, 0xc8283a, 0x2d5fa8, 0xf2d070];
/** a camelot stall of the Allée Scheffer lane: canvas-draped booth, pitched white roof, red / white / grey tarp front (photo food-camelots-allee-scheffer-2018-120) */
function camelotTarp(b, r, w, d) {
  const tarp = pick(r, TARP); const H = 2.3; const side = pick(r, [0xf4f0e6, 0xe8e2d0, 0x8a9096]); const kind = r();
  b.box(0, 0, 0, w, H, d, side, { cols: { front: shade(side, 0.95) } });
  const zf = d / 2 + 0.03; const n = Math.max(3, Math.round(w * 1.8)); const alt = kind < 0.4 ? shade(tarp, 1.28) : kind < 0.7 ? 0xf4f0e6 : shade(tarp, 0.82);   // striped / printed canvas
  for (let i = 0; i < n; i++) { const x0 = -w / 2 - 0.02 + (w + 0.04) * i / n; const x1 = -w / 2 - 0.02 + (w + 0.04) * (i + 1) / n; const sag = (i & 1) ? 0.12 : 0; b.quad([x0, 0.0, zf], [x1, 0.0, zf], [x1, H - 0.1 - sag, zf], [x0, H - 0.1 - sag, zf], i & 1 ? alt : tarp); }
  if (!b.far) {
    b.quad([-w * 0.08, 0.0, zf + 0.01], [w * 0.08, 0.0, zf + 0.01], [w * 0.08, H - 0.1, zf + 0.01], [-w * 0.08, H - 0.1, zf + 0.01], shade(tarp, 0.7));                // the roll-up opening
    if (kind > 0.45) b.mural([6, 2, 4, 5, 0, 1][Math.floor(r() * 6)], Math.floor(r() * 4), 0, H * 0.62, zf + 0.02, Math.min(w * 0.8, 2.6), 0.62, { frame: false, back: false, lit: true });   // the printed banner
    for (let i = 0; i < 3; i++) b.quad([-w / 2 + (i + 0.5) * w / 3, H - 0.12, zf + 0.012], [-w / 2 + (i + 0.5) * w / 3 + 0.05, H - 0.12, zf + 0.012], [-w / 2 + (i + 0.5) * w / 3 + 0.02, 0.3, zf + 0.012], [-w / 2 + (i + 0.5) * w / 3 - 0.03, 0.3, zf + 0.012], shade(tarp, 0.6));   // folds
  }
  b.gable(0, H, 0, w + 0.2, d + 0.3, 0.55, [1.6, 1.6, 1.55], { over: 0.1, ridge: 'x', back: [1.3, 1.3, 1.27], ch: 'fabric' });
  if (r() < 0.55) b.valance([-w / 2, H, d / 2 + 0.2], [w / 2, H, d / 2 + 0.2], 0.22, Math.round(w * 2), tarp, 0xf4f0e6);
  b.bulb(-w / 2 + 0.2, H - 0.05, d / 2 + 0.15, warm, 0.13); b.bulb(w / 2 - 0.2, H - 0.05, d / 2 + 0.15, warm, 0.13); b.bulb(0, H - 0.05, d / 2 + 0.2, warm, 0.13);
  if (!b.far && r() < 0.4) sign(b, pick(r, ['NOUGAT', 'MANDELEN', 'KÄSE', 'SOUVENIRS', 'BONBONS', 'WÄRSCHT']), 0, H + 0.5, d / 2 + 0.1, Math.min(w * 0.85, 2.2), 0.42, 0);
}
function temple(b, r, w, d) {
  buildStall(b, r, w, d, { body: pick(r, [0xf3efe2, 0xe8e0c8]), accent: [0x2d6fd0, 0xf6ead0], counter: 0xd8d2c0, word: 'DÖNER', roof: 'flat', roofCol: [0xe6dfcb], goods: [0x8a4a2a, 0xd8433a, 0xf2e4b0], mural: null, pylon: false });
  const H = 2.4 + 0.06;
  [-1, 1].forEach((s) => b.cyl(s * (w / 2 - 0.12), 0.06, d / 2 + 1.0, 0.13, 0.12, H, 7, 0xf8f6ee));
  b.box(0, H + 0.1, d / 2 + 0.9, w + 0.3, 0.22, 0.5, 0xf0eadb); b.tri([-w / 2 - 0.1, H + 0.32, d / 2 + 1.1], [w / 2 + 0.1, H + 0.32, d / 2 + 1.1], [0, H + 1.2, d / 2 + 1.1], 0xe6dfcb);
}
function fisherHut(b, r, w, d) {
  const wood = 0x6a4a30; const H = 2.4;
  buildStall(b, r, w, d, { body: wood, side: wood, roof: 'gable', roofCol: [0x3a5a6a, 0x30485a], accent: [0xb9672f, 0xf6ead0], counter: 0x7a5a3a, word: 'FËSCH', goods: [0x8aa0a8, 0xd8d8c8], mural: null, pylon: false });
  if (!b.far) { for (let k = 0; k < 3; k++) { const x = -w / 2 + 0.6 + k * (w - 1.2) / 2; b.tri([x - 0.5, H + 0.06, -d / 2 + 0.2], [x + 0.5, H + 0.06, -d / 2 + 0.2], [x, H - 1.1, -d / 2 + 0.2], 0x8aa0a8, { dbl: true }); }
    [-1, 1].forEach((s) => { b.push().translate(s * (w / 2 - 0.4), 1.25, d / 2 + 0.02).rotX(Math.PI / 2); b.disc(0, 0, 0, 0.42, 0.3, 8, 0x8a5a34); b.pop(); }); }
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
function kidsRide(b, r, w, d) {
  const R = Math.min(w, d) / 2 - 0.3; const aw = pick(r, AWN);
  b.cyl(0, -0.2, 0, R + 0.2, R + 0.2, 0.5, 14, 0x3a3a40, { cap: true, capColor: 0x6a5648 }); b.cyl(0, 0.3, 0, 0.35, 0.35, 2.4, 8, aw[0]);
  b.cyl(0, 2.7, 0, R, R, 0.6, 14, aw[1], { bottom: true }); b.cyl(0, 3.3, 0, R + 0.2, 0.15, 1.7, 14, aw[0], { alt: aw, smooth: false }); b.sphere(0, 5.15, 0, 0.14, GOLD, { seg: 5 });
  b.bulbRing(0, 2.7, 0, R + 0.05, Math.round(R * 6), warm, 0.14); if (!b.far) for (let i = 0; i < 6; i++) { const a = TAU * i / 6; b.blob(Math.sin(a) * R * 0.62, 0.9, Math.cos(a) * R * 0.62, 0.3, 0.35, 0.2, pick(r, [0xf6ead0, 0xe0a860, 0xd8433a])); }
}
function chairRide(b, r, w, d) {
  const R = Math.min(w, d) / 2 - 0.6; const aw = pick(r, AWN);
  b.cyl(0, -0.2, 0, R + 0.3, R + 0.3, 0.45, 14, 0x3a3a40, { cap: true, capColor: 0x6a6256 }); b.cyl(0, 0.2, 0, 0.9, 0.7, 3.4, 8, aw[0]);
  b.cyl(0, 3.6, 0, R, 0.3, 2.0, 18, aw[0], { alt: aw, smooth: false }); b.cyl(0, 3.0, 0, R + 0.02, R + 0.02, 0.6, 18, aw[1], { bottom: true });
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


/** a closed storage / staff tent (back-of-house): white canvas, no door, no lettered panel, no shop front.  Stands where no stall front can open onto a walkway. */
function storeTent(b, r, w, d) { hallTent(b, r, Math.min(w - 0.4, 14), Math.min(d - 0.4, 18), { closed: true, open: [false, false], porch: false, stripes: false }); }

/* ------------------------------------------------------------------ polish wave: nine more skins (24 in total) with airbrush murals, lit signs, glowing windows */
const NEON = 0xfff2d0;
function postSign(b, text, x, y, z, w, h, look, kind = 'main') {
  [-1, 1].forEach((k) => b.cyl(x + k * (w / 2 - 0.15), y - 0.2, z - 0.05, 0.04, 0.04, 1.4, 4, 0x333333));
  b.sign(text, x, y + 0.7, z, w, h, { look, kind, lit: true, frameW: 0.06, frame: 0x3a2a20 });
}
function popcornCart(b, r, w, d) {
  buildStall(b, r, w, d, { trailer: true, body: 0xd8283a, side: 0xd8283a, accent: [0xd8283a, 0xf6ead0], counter: 0xf6ead0, word: 'POPCORN', roof: 'barrel', roofCol: [0xd8283a, 0xf6ead0], goods: [0xfff0c0], goodsKind: 'blob', mural: null, pylon: false, menu: null, display: false, H: 2.2 });
  if (!b.far) { b.box(w * 0.28, 0.72 + 1.12, d / 2 - 0.3, w * 0.34, 0.9, 0.46, NEON, { ch: 'lamp' }); for (let i = 0; i < 4; i++) b.blob(w * 0.2 + (i % 2) * w * 0.12, 0.72 + 1.3 + Math.floor(i / 2) * 0.22, d / 2 - 0.3, 0.1, 0.1, 0.1, 0xfff0c0); }
}
function balloonDarts(b, r, w, d) {
  const H = 2.6; b.box(0, 0, -d / 2 + 0.15, w, H, 0.2, pick(r, [0xf6ead0, 0xffe27a, 0xcfe8ff])); [-1, 1].forEach((s) => b.box(s * (w / 2 - 0.08), 0, 0, 0.16, H, d - 0.2, pick(r, BODY)));
  b.box(0, 0, d / 2 - 0.35, w, 1.0, 0.5, pick(r, WOODS)); b.box(0, 1.0, d / 2 - 0.35, w + 0.1, 0.06, 0.7, C.steel);
  b.gable(0, H, 0, w + 0.3, d + 0.3, 0.55, pick(r, AWN)[0], { over: 0.1, ridge: 'x' });
  const cols = [0xd8283a, 0xf4c430, 0x2d79c8, 0x2fc35a, 0xee6fa8, 0xf08a2a]; const cn = Math.max(5, Math.round(w * 1.5)); const rows = b.far ? 2 : 4;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cn; i++) b.sphere(-w / 2 + 0.45 + i * ((w - 0.9) / (cn - 1)) + (j & 1 ? 0.2 : 0), 1.35 + j * 0.28, -d / 2 + 0.36, 0.2, cols[(i + j * 2) % cols.length], { seg: 5, sy: 1.15 });
  b.bulbRow([-w / 2, H + 0.1, d / 2 + 0.1], [w / 2, H + 0.1, d / 2 + 0.1], 0.4, warm, 0.14);
  postSign(b, 'BALLONGEN', 0, H + 0.7, d / 2 - 0.2, Math.min(w * 0.8, 3.6), 0.7, 0);
}
function tikiBar(b, r, w, d) {
  const roof = [0xc9a25a, 0xb8903f];
  b.box(0, 0, d * 0.1, w * 0.8, 1.0, d * 0.4, pick(r, WOODS), { cols: { top: 0x9a6a3c } });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => b.cyl(sx * (w / 2 - 0.2), 0, sz * (d / 2 - 0.25), 0.1, 0.1, 2.5, 5, 0x6a4a30));
  b.cone(0, 2.4, 0, Math.max(w, d) * 0.62, 1.5, 10, roof[0], { alt: roof, smooth: false }); b.sphere(0, 3.95, 0, 0.14, 0x6a4a30, { seg: 5 });
  b.bulbRing(0, 2.45, 0, Math.max(w, d) * 0.6, 14, warm, 0.14);
  if (!b.far) { for (let i = 0; i < 4; i++) { const x = -w * 0.3 + i * w * 0.2; b.cyl(x, 0, d * 0.42, 0.12, 0.12, 0.65, 5, pick(r, CRATE_COLS)); b.cyl(x, 0.65, d * 0.42, 0.2, 0.2, 0.06, 6, 0x333333, { cap: true }); }
    b.cyl(w * 0.55, 0, d * 0.4, 0.04, 0.04, 1.8, 4, 0x4a3020); b.blob(w * 0.55, 1.95, d * 0.4, 0.1, 0.17, 0.1, 0xff9a2a, { ch: 'lamp' }); b.bulb(w * 0.55, 1.95, d * 0.4, 0xffa040, 0.45); }
  b.mural(5, Math.floor(r() * 4), 0, 0.5, d * 0.1 + d * 0.2 + 0.02, w * 0.78, 0.9, { frame: false, back: false, lit: true });
  b.beam([-w / 2 + 0.2, 2.3, d / 2 - 0.25], [w / 2 - 0.2, 2.3, d / 2 - 0.25], 0.1, 0x6a4a30);                  // the lintel between the front posts the board hangs from
  sign(b, 'TIKI BAR', 0, 2.08, d / 2 - 0.17, Math.min(w * 0.6, 2.6), 0.46, 0, 'banner');
}
const CRATE_COLS = [0xd8433a, 0x2d6fd0, 0xf4c430, 0x2f9a58];
function clawMachine(b, r, w, d) {
  const body = pick(r, [0x2d3a8a, 0x7a2a8a, 0x1f6a8a, 0xb0284a]); const neon = pick(r, [[0xff9ad8, 0x9af0ff], [0x9af0ff, 0xffe27a], [0xffe27a, 0xff9ad8]]);
  buildStall(b, r, w, d, { body, side: body, accent: neon, counter: shade(body, 0.7), word: 'GREIFER', signLook: 1, roof: 'flat', roofCol: [shade(body, 0.8)], goods: [0xff9ad8, 0x9af0ff, 0xffe27a, 0xf08a2a], mural: null, pylon: true, pylonWord: 'GREIFER', menu: null });
  if (!b.far) for (let k = 0; k < 2; k++) { const x = -w * 0.22 + k * w * 0.44; b.box(x, 1.12, d / 2 - 0.28, w * 0.34, 0.9, 0.42, pick(r, [0xff9ad8, 0x9af0ff, 0xffe27a]), { ch: 'lamp' }); for (let i = 0; i < 3; i++) b.blob(x - w * 0.09 + i * w * 0.09, 1.2, d / 2 - 0.1, 0.1, 0.1, 0.08, pick(r, GOODS)); }
}
function bouncyCastle(b, r, w, d) {
  const c1 = pick(r, [0xd8283a, 0xf08a2a, 0xee6fa8]); const c2 = pick(r, [0x2d79c8, 0x2fc35a, 0x8a5bc8]); const c3 = pick(r, [0xf4c430, 0x41c4d8, 0xffffff]);
  b.box(0, 0.0, 0, w, 1.1, d, c2, { cols: { top: c3 } });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => { const x = sx * (w / 2 - 0.9); const z = sz * (d / 2 - 0.9); b.cyl(x, 0, z, 0.95, 0.9, 3.2 + (i & 1) * 0.4, 7, i & 1 ? c1 : c3, { smooth: true }); b.cone(x, 3.2 + (i & 1) * 0.4, z, 1.05, 1.0, 7, i & 1 ? c3 : c1, { smooth: true }); b.sphere(x, 4.35 + (i & 1) * 0.4, z, 0.18, 0xffffff, { seg: 5 }); });
  b.box(0, 0.8, d / 2 - 0.9, w - 2.4, 1.6, 0.9, c1, { cols: { top: c3 } });
  if (!b.far) b.mural(4, Math.floor(r() * 4), 0, 1.2, d / 2 - 0.44, w - 3.0, 0.9, { frame: false, back: false, lit: true });
  if (!b.far) for (let i = 0; i < 3; i++) b.figure(-w * 0.2 + i * w * 0.2, -d * 0.1, r() * 6, { y: 1.1, scale: 0.8 });
  b.bulbRow([-w / 2, 1.15, d / 2 + 0.05], [w / 2, 1.15, d / 2 + 0.05], 0.5, 0xfff4d0, 0.14);
  b.push().translate(-w / 2 + 1.5, 0, d / 2 - 0.8); buildStall(b, r, 2.4, 1.6, { trailer: false, body: c2, accent: [c1, 0xf6ead0], counter: c1, word: 'KASSE', roof: 'flat', roofCol: [c1], mural: null, pylon: false, menu: null, goods: [c3, c1] }); b.pop();
}
function funHouse(b, r, w, d) {
  const kind = [1, 5, 4, 2][Math.floor(r() * 4)]; const body = pick(r, [0x241048, 0x10304a, 0x4a1030, 0x1a2a5a]); const H = 6.6;
  b.box(0, 0, -d / 2 + 0.5, w, H, 1.0, body); b.box(0, 0, -d * 0.1, w * 0.84, 3.0, d * 0.5, shade(body, 0.8));
  b.mural(kind, Math.floor(r() * 4), 0, 2.2 + 1.6, -d / 2 + 1.03, w - 2.8, 3.6, { frame: 0xe6b13a, frameW: 0.14, back: false, lit: true });
  [-1, 1].forEach((s, i) => { const x = s * (w / 2 - 0.6); b.cyl(x, 0, -d / 2 + 0.7, 0.9, 0.8, H, 8, i ? 0x3a2a6a : 0x2a3a7a, { smooth: true }); b.cone(x, H, -d / 2 + 0.7, 1.15, 1.6, 8, i ? 0xff3fc8 : 0x41e8ff, { smooth: true }); b.bulbRing(x, H - 0.3, -d / 2 + 0.7, 0.95, 10, i ? 0xff9ae0 : 0x9af0ff, 0.16); });
  b.box(0, 0, -d / 2 + 1.0, w * 0.3, 2.2, 0.1, 0x000000, { noBack: true }); b.box(0, 0.05, -d / 2 + 1.06, w * 0.28, 2.0, 0.05, GLASS, { ch: 'lamp' });
  if (!b.far) b.ledRect(-w / 2 + 1.6, 1.6, w / 2 - 1.6, 6.4, -d / 2 + 1.07, 0.09, [0xff3fc8, 0x41e8ff, 0xffd23c, 0x8a5bff], { seg: 1.3 });
  b.bulbRow([-w / 2 + 1.6, 6.5, -d / 2 + 1.1], [w / 2 - 1.6, 6.5, -d / 2 + 1.1], 0.45, warm, 0.16);
  postSign(b, 'SPUKHAUS', 0, H + 0.1, -d / 2 + 1.0, Math.min(w * 0.6, 5.0), 0.95, 1);
  b.push().translate(0, 0, d / 2 - 1.9); buildStall(b, r, 3.0, 1.9, { trailer: false, body: 0x2a2a46, accent: [0xff3fc8, 0x41e8ff], counter: 0x2a2a46, word: 'KASSE', signLook: 1, roof: 'flat', roofCol: [0x2a2a46], mural: null, pylon: false, menu: null, goods: [0x41e8ff, 0xff3fc8] }); b.pop();
}

/* ------------------------------------------------------------------ looks wave: the stall skins built with the shared composer (models/stallkit.js) */
const COUNTERS = [0x6a4a30, 0x8a5a34, 0x3f4a58, 0x5a3a28, 0x7a2a2a, 0x2f5a46];
const spec = (r, extra) => Object.assign({ body: pick(r, BODY), accent: pick(r, AWN), counter: pick(r, COUNTERS), word: pick(r, WORDS), signLook: r() < 0.35 ? 2 : 0, goods: [pick(r, GOODS), pick(r, GOODS), pick(r, GOODS), pick(r, GOODS)], pylon: r() < 0.3, mural: r() < 0.4 ? [[0, 3, 5, 1, 4, 2][Math.floor(r() * 6)], Math.floor(r() * 4)] : null }, extra);
function trailer(b, r, w, d) { buildStall(b, r, w, d, spec(r, { trailer: true, roof: r() < 0.5 ? 'barrel' : 'gable', roofWhite: true, goodsKind: pick(r, ['blob', 'bag', 'cone']) })); }
function kiosk(b, r, w, d) { buildStall(b, r, w, d, spec(r, { roof: 'hip', pylon: false, goodsKind: 'blob', mural: null })); }
function chalet(b, r, w, d) {
  const wood = pick(r, WOODS); const acc = pick(r, AWN);
  buildStall(b, r, w, d, spec(r, { body: wood, side: wood, roof: 'gable', roofCol: [pick(r, [0x4a3228, 0x6b3a2a, 0x3a4048]), 0x3a2a20], accent: [acc[0], 0xf6ead0], counter: shade(wood, 0.8), mural: null, pylon: false }));
  if (!b.far) for (const s of [-1, 1]) { b.box(s * (w / 2 - 0.55), 1.2, d / 2 + 0.3, 0.9, 0.2, 0.22, 0x5a3a28); for (let i = 0; i < 4; i++) b.blob(s * (w / 2 - 0.55) - 0.3 + i * 0.2, 1.46, d / 2 + 0.3, 0.1, 0.1, 0.1, [0xe3242b, 0xf2c80c, 0xe86aa8, 0x7ad06a][i]); }
}
function sweets(b, r, w, d) { buildStall(b, r, w, d, spec(r, { accent: pick(r, [[0xee6fa8, 0xf6ead0], [0xf08a2a, 0xf6ead0], [0x41c4d8, 0xf6ead0], [0xf4c430, 0xf6ead0]]), roof: 'barrel', goodsKind: pick(r, ['bag', 'cone']), body: pick(r, [0xf08aa8, 0xf4a03a, 0xf4c430, 0x7fd0f0]), counter: 0xf6ead0 })); }
function gameStall(b, r, w, d) {
  buildStall(b, r, w, d, spec(r, { trailer: true, roof: 'flat', accent: pick(r, [[0xc8283a, 0xf6ead0], [0x2d6fd0, 0xf4c430], [0x7a47c8, 0xf4c430]]), word: pick(r, ['SCHÉISSBUD', 'WÄRFELBUD', 'DOSEWUERF', 'LOS', 'DART']), signLook: 2, goods: [0xee6fa8, 0xf4c430, 0x41c4d8, 0x8a5bc8] }));
  if (!b.far) for (let k = 0; k < 2; k++) for (let i = 0; i < Math.round(w * 1.4); i++) b.blob(-w / 2 + 0.5 + i * 0.5, 0.72 + 1.55 + k * 0.4, -d / 2 + 0.3, 0.17, 0.18, 0.14, pick(r, GOODS));
}
function pizzaTrailer(b, r, w, d) {
  buildStall(b, r, w, d, spec(r, { trailer: true, roof: 'flat', word: 'PIZZA', accent: [0xd8283a, 0xf6ead0], body: pick(r, [0xf4e8d0, 0xf0d8b0, 0xe8f0e0]), pylon: true, pylonWord: 'PIZZA', goods: [0xf2d070, 0xd8433a] }));
  b.sphere(-w * 0.26, 0.72 + 2.4 + 0.3, -d * 0.2, 0.85, 0xb04a2a, { seg: 7, sy: 0.75 }); b.cyl(-w * 0.26, 0.72 + 2.4 + 0.75, -d * 0.2, 0.16, 0.12, 1.1, 5, 0x555a60);
  if (!b.far) b.fx(-w * 0.26, 0.72 + 2.4 + 1.9, -d * 0.2, 2, 0);
}
function iceCreamVan(b, r, w, d) {
  const body = pick(r, [0xf6b8d0, 0xa8e8d0, 0xf6e8a0, 0xa8d0f6]);
  buildStall(b, r, w, d, spec(r, { trailer: true, roof: 'flat', word: 'GLACE', body, accent: [0xd8283a, 0xf6ead0], goodsKind: 'cone', pylon: false, mural: null }));
  b.cyl(w * 0.1, 0.72 + 2.4 + 0.1, 0, 0.01, 0.5, 1.2, 8, 0xe0a860, { cap: true, capColor: 0xe0a860 }); b.sphere(w * 0.1, 0.72 + 2.4 + 1.35, 0, 0.5, 0xf6a0c8, { seg: 6 }); b.sphere(w * 0.1, 0.72 + 2.4 + 1.95, 0, 0.42, 0xfff0d0, { seg: 6 }); b.sphere(w * 0.1, 0.72 + 2.4 + 2.4, 0, 0.12, 0xd8283a, { seg: 5 });
  b.bulbRing(w * 0.1, 0.72 + 2.4 + 0.7, 0, 0.5, 8, 0xffe9b0, 0.12);
}
function souvenirContainer(b, r, w, d) {
  const c = pick(r, [0x2d6fd0, 0xd8433a, 0x2f9a58, 0xf08a2a, 0x7a47c8]);
  buildStall(b, r, w, d, spec(r, { body: c, side: c, roof: 'flat', accent: [0xf6ead0, c], word: 'SOUVENIRS', counter: shade(c, 0.8), pylon: false, mural: null }));
  b.mural([0, 3, 5, 1][Math.floor(r() * 4)], Math.floor(r() * 4), 0, 2.46 + 1.1, d / 2 - 0.05, w * 0.92, 0.9, { frame: false, back: false, lit: true });
}

export const SKINS = {
  hall: { w: [8, 14], d: [10, 18], fn: hallTent }, hallWide: { w: [14, 24], d: [10, 16], fn: hallTent }, hallL: { w: [28, 29], d: [16, 17], fn: hallTent }, hallSmall: { w: [6, 9], d: [8, 12], fn: hallTent },
  chalet: { w: [4, 6], d: [3.5, 5], fn: chalet }, kiosk: { w: [3.5, 5], d: [3, 4], fn: kiosk }, trailer: { w: [5, 8], d: [2.6, 3.2], fn: trailer },
  camelot: { w: [2.4, 3.6], d: [2, 2.6], fn: (b, r, w, d) => camelot(b, r, w, d, { umbrella: r() < 0.4 }) }, temple: { w: [5, 6.5], d: [4, 5], fn: temple }, fisher: { w: [5, 6.5], d: [3.5, 4.5], fn: fisherHut },
  arch: { w: [4.5, 6], d: [3.2, 4], fn: archStall }, game: { w: [5, 8], d: [2.8, 3.4], fn: gameStall }, sweets: { w: [4, 6], d: [3, 3.8], fn: sweets }, kids: { w: [6, 7.6], d: [6, 7.6], fn: kidsRide }, chair: { w: [11, 14], d: [11, 14], fn: chairRide },
  pizza: { w: [4.5, 6], d: [2.8, 3.4], fn: pizzaTrailer }, popcorn: { w: [2.4, 3.2], d: [2.2, 2.8], fn: popcornCart }, icecream: { w: [4.5, 5.6], d: [2.2, 2.6], fn: iceCreamVan }, balloon: { w: [4.5, 6.5], d: [2.8, 3.4], fn: balloonDarts },
  tiki: { w: [4, 5.2], d: [3.4, 4.4], fn: tikiBar }, claw: { w: [3, 4.2], d: [2.2, 2.8], fn: clawMachine }, bouncy: { w: [6.5, 8], d: [6, 7.5], fn: bouncyCastle }, funhouse: { w: [9, 11], d: [4.5, 5.5], fn: funHouse }, souvenir: { w: [3.4, 5], d: [2.4, 3], fn: souvenirContainer },
  tentS: { w: [4.5, 6.8], d: [5.5, 9], fn: hallTent },
  worksite: { w: [22, 22], d: [38, 38], fn: worksite }, bigTent: { w: [52, 55], d: [27, 29], fn: bigTentRow },
};
const rangeVal = (r, [a, b]) => a + (b - a) * r();

/** the cheap form of a stall (about 20 triangles): a box with a canvas gable (a hall tent when it is big) - what every skin becomes in the `far` form (stalls away from the alleys, the
 * iPad-low fair, the far LOD of a locked pitch): from above they are roofs, nobody sees their detail */
const ALWAYS_NEAR = new Set(['hall', 'hallWide', 'hallL', 'hallSmall', 'tentS', 'bigTent', 'worksite', 'kids', 'chair', 'bouncy', 'funhouse']);
const SIMPLE_NOT = new Set(['hall', 'hallWide', 'hallL', 'hallSmall', 'tentS', 'bigTent', 'worksite', 'kids', 'chair', 'bouncy', 'funhouse']);
function simpleStall(b, r, w, d) {
  if (w >= 5.5 && d >= 6.5) {
    const H = 2.4; const rise = Math.min(2.6, w * 0.26);
    b.box(0, 0, 0, w, H, d, CANVAS.wall, { ch: 'fabric', noBottom: true, noTop: true }); b.gable(0, H, 0, w + 0.1, d + 0.1, rise, CANVAS.roof, { ridge: 'z', over: 0.05, ends: CANVAS.end, back: CANVAS.back, ch: 'fabric' });
  } else {
    const aw = pick(r, AWN); b.box(0, 0, 0, w, 2.3, d, pick(r, BODY));
    // the front, even in the cheap form: a lit window, a counter ledge, a striped awning with a bulb edge (a wall of lit fronts at night)
    b.quad([-w * 0.38, 0.95, d / 2 + 0.02], [w * 0.38, 0.95, d / 2 + 0.02], [w * 0.38, 1.95, d / 2 + 0.02], [-w * 0.38, 1.95, d / 2 + 0.02], 0xd89a48, { ch: 'lamp' });
    if (w >= 3.2) { b.quad([-w / 2, 2.3, d / 2 + 0.02], [w / 2, 2.3, d / 2 + 0.02], [w / 2, 2.85, d / 2 + 0.02], [-w / 2, 2.85, d / 2 + 0.02], aw[0]); b.sign(pick(r, WORDS), 0, 2.58, d / 2 + 0.03, Math.min(w * 0.82, 3.2), 0.4, { look: r() < 0.35 ? 2 : 0, kind: 'main', lit: true, frame: false, back: false }); b.bulbRow([-w / 2, 2.88, d / 2 + 0.06], [w / 2, 2.88, d / 2 + 0.06], 0.7, warm, 0.12); }
    b.box(0, 0.9, d / 2 + 0.12, w * 0.84, 0.06, 0.3, C.steel);
    awning(b, w, d / 2 + 0.02, 2.25, d / 2 + 0.95, 1.85, [aw[0], aw[1]], Math.max(3, Math.round(w / 1.3)), false);
    if (r() < 0.65) b.gable(0, 2.3, 0, w + 0.2, d + 0.2, 0.6, CANVAS.roof, { ridge: 'x', over: 0.08, back: CANVAS.back, ch: 'fabric' }); else b.gable(0, 2.3, 0, w + 0.2, d + 0.2, 0.6, aw[0], { ridge: 'x', over: 0.08 });      // most roofs are white canvas, like the photos
  }
}
const runSkin = (b, name, r, w, d) => { if (b.far && !SIMPLE_NOT.has(name)) simpleStall(b, r, w, d); else SKINS[name].fn(b, r, w, d); };

/** a skin fitted into a w x d footprint (shrinks the random size to fit) */
function drawSkin(b, name, r, maxW, maxD) {
  const s = SKINS[name]; const w = Math.min(rangeVal(r, s.w), maxW); const d = Math.min(rangeVal(r, s.d), maxD);
  runSkin(b, name, r, w, d); return { w, d };
}

/* ------------------------------------------------------------------ one NPC stall on a (locked) pitch, in the model contract */
/** a locked S / M pitch: a packed cluster of stalls that fills the whole slot (polish 2; one lonely kiosk in a 16 m slot read as bare asphalt from above) */
function pitchCluster({ rect, seed, far, groundY }) {
  const size = rect.size; const dims = SIZE[size]; const r = mulberry(seed * 1013 + 7);
  const b = new Builder({ seed, rnd: r, far }); b.jit = 0.06;
  const CL = 0.5; const nu = Math.floor((dims[0] - 0.8) / CL); const nw = Math.floor((dims[1] - 0.8) / CL); const used = new Uint8Array(nu * nw); const GAP = 0.4;
  const x0 = -nu * CL / 2; const z0 = -nw * CL / 2;
  const free = (i, j) => i >= 0 && j >= 0 && i < nu && j < nw && !used[j * nu + i];
  // the slot floor: steel plates draped on the terrain (the stalls stand on them)
  if (groundY) { const yw = (YAW[rect.face] || 0); const cs = Math.cos(yw); const sn = Math.sin(yw); const ly = (x, z) => groundY(rect.u + x * cs + z * sn, rect.w - x * sn + z * cs) - rect.y; drape(b, dims[0] / 2 - 0.4, dims[1] / 2 - 0.4, ly, (i, j) => shade(PAD[(i * 3 + j * 5 + (rect.u | 0)) % 3], 0.92 + 0.16 * r()), 4, 0.18); }
  let n = 0; let first = null;
  // feedback B: the cluster is packed from the FRONT edge of the slot backwards (rows j = 0 at the front).  A stall may only stand where the strip between its front and the slot's front edge is
  // free (that strip is reserved: it is the way out onto the forecourt); everything behind the front row is back-of-house (caravans, crates, a closed tent).  Never two identical skins side by side.
  const zFront = nw * CL / 2; const placed = [];
  packFree({
    nu, nw, free, rf: r, margin: GAP, cell: CL, weights: () => (size === 'S' ? FILL_PITCH_S : FILL_PITCH_M), maxRun: nu * CL, maxDepth: nw * CL,
    put: (i, j, sw, sd, skin, rot = false) => {
      if (rot) return false;
      const cu = x0 + i * CL + (sw + GAP) / 2; const cw = zFront - j * CL - (sd + GAP) / 2;
      const ni = Math.ceil((sw + GAP) / CL - 1e-6); const nj = Math.ceil((sd + GAP) / CL - 1e-6);
      if (skin) {
        for (let jj = 0; jj < j; jj++) for (let ii = i; ii < Math.min(nu, i + ni); ii++) if (used[jj * nu + ii]) return false;          // something stands in front of it
        const fp = { u0: cu - sw / 2, u1: cu + sw / 2, w0: cw - sd / 2, w1: cw + sd / 2 };
        if (DUP_SKINS.includes(skin) && placed.some((o) => o.k === skin && Math.hypot(Math.max(fp.u0 - o.u1, 0, o.u0 - fp.u1), Math.max(fp.w0 - o.w1, 0, o.w0 - fp.w1)) < DUP_GAP + 0.1)) return false;
        for (let jj = 0; jj < j; jj++) for (let ii = i; ii < Math.min(nu, i + ni); ii++) used[jj * nu + ii] = 1;                          // reserve the way out
        placed.push({ k: skin, ...fp });
      }
      b.push().translate(cu, 0, cw);
      if (!skin) { if (sw >= 6.5 && sd >= 8 && r() < 0.5) storeTent(b, r, sw, sd); else backLot(b, r, sw, sd); } else runSkin(b, skin, r, sw, sd);
      b.pop();
      for (let jj = j; jj < Math.min(nw, j + nj); jj++) for (let ii = i; ii < Math.min(nu, i + ni); ii++) used[jj * nu + ii] = 1;
      n++; if (!first && skin) first = skin; return true;
    },
  });
  if (!n) { const name = size === 'S' ? 'chalet' : 'hallSmall'; SKINS[name].fn(b, r, dims[0] - 2, dims[1] - 3); first = name; }
  // the padlock plate hangs between two posts at the front edge of the slot
  const zf = nw * CL / 2 + 0.2; [-0.95, 0.95].forEach((x) => b.cyl(x, 0, zf, 0.04, 0.04, 2.95, 4, 0x3a3a40));
  b.lockSign(rect.star || 1, 0, 2.7, zf + 0.04, 1.8, 0.6, { frame: 0x3a2a20, frameW: 0.05 });
  const g = b.finish({ id: 'npc-' + rect.id, look: 0, level: 1, size: dims, height: 6, kind: 'npc' });
  g.userData.skin = 'cluster:' + (first || 'none') + 'x' + n; g.userData.locked = true;
  return g;
}

export function buildPitchNpc({ T, rect, seed = 1, far = false, bigFor, noLock = false, groundY = null }) {
  if (!bigFor && !noLock && (rect.size === 'S' || rect.size === 'M')) return pitchCluster({ rect, seed, far, groundY });
  const size = bigFor || rect.size; const dims = size === 'W' ? [SIZE.W[1], SIZE.W[0]] : (SIZE[size] || SIZE.S); const r = mulberry(seed * 1013 + 7);   // the wheel pitch faces +u: its local x is world w (24 m), local z is world u (40 m)
  const b = new Builder({ seed, rnd: r, far }); b.jit = 0.06;
  const [pw, pd] = dims.map((v) => v - 0.8);
  if (size === 'W' && groundY) { const yw = YAW[rect.face] || 0; const cs = Math.cos(yw); const sn = Math.sin(yw); drape(b, dims[0] / 2 - 0.3, dims[1] / 2 - 0.3, (x, z) => groundY(rect.u + x * cs + z * sn, rect.w - x * sn + z * cs) - rect.y, (i, j) => shade([0xb3a68a, 0xa89a7c, 0xbcae8c][(i + j * 2) % 3], 0.92 + 0.14 * r()), 4, 0.2); }
  const choices = { S: ['kiosk', 'chalet', 'trailer', 'arch', 'sweets', 'game', 'temple', 'fisher', 'pizza', 'popcorn', 'icecream', 'balloon', 'tiki', 'claw', 'souvenir'], M: ['hall', 'hallSmall', 'kids', 'chair', 'bouncy', 'funhouse', 'hallSmall'], L: ['hallL'], XL: ['bigTent'], W: ['worksite'] }[size] || ['kiosk'];
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
function makeGrid() {
  const cells = (u0, u1, w0, w1) => [Math.max(0, Math.floor((u0 - U0) / CELL)), Math.min(NU - 1, Math.floor((u1 - U0) / CELL)), Math.max(0, Math.floor((w0 - W0) / CELL)), Math.min(NW - 1, Math.floor((w1 - W0) / CELL))];
  // bit 1 = a stall / pitch, bit 2 = a walkway zone of layout.js (alley, forecourt, service lane; rounded OUT to whole cells): everybody else treats any non-zero cell as taken
  return {
    g: new Uint8Array(NU * NW),
    mark(u0, u1, w0, w1, bit = 1) { const [i0, i1, j0, j1] = cells(u0, u1, w0, w1); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.g[j * NU + i] |= bit; },
    free(u0, u1, w0, w1, bits = 1) { const [i0, i1, j0, j1] = cells(u0, u1, w0, w1); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.g[j * NU + i] & bits) return false; return true; },
  };
}

/** alley corridors that must stay clear: the walkway network of layout.js (Haaptallee, Fressgaass, south alley, cross alleys, entrance lanes, SE service lane).  Same shape as before
 * ({ name, u: [a, b], w: [c, d], line? }) so the crowd graph, the swept-ground shader and the filler keep working; the numbers live in pb/fouer/layout.js only. */
export const CORRIDORS = layoutCorridors();
/** the entrance lanes are alleys of the layout now (the old GATE_LANES hack is gone) */
export const GATE_LANES = [];
/** distance a row of stalls keeps from the alley edge on top of the frontage strip (m): the stall rect itself is grown by 0.2 m when it is tested */
const ROW_SET = 0.25;
const ALLEY_BY_ID = Object.fromEntries(ALLEYS.map((a) => [a.id, a]));
const HA = ALLEY_BY_ID.haaptallee; const FG = ALLEY_BY_ID.fressgaass; const SAW = ALLEY_BY_ID['sud-west']; const SAE = ALLEY_BY_ID['sud-ost'];
const ROWS = [
  { name: 'N', front: FG.w[0] - FRONTAGE.main - ROW_SET, face: '+w', depth: 17, skins: { hallWide: 5, hall: 7, hallSmall: 2, chalet: 3, kiosk: 2, trailer: 3, arch: 2, game: 2, sweets: 2, temple: 1, fisher: 1, pizza: 2, popcorn: 2, icecream: 1, balloon: 2, tiki: 1, claw: 1, funhouse: 1, souvenir: 2, bouncy: 1 } },
  { name: 'F', front: FG.w[1] + FRONTAGE.main + ROW_SET, face: '-w', depth: 8, skins: { chalet: 3, kiosk: 3, trailer: 4, game: 3, sweets: 3, pizza: 2, popcorn: 2, icecream: 2, arch: 2, claw: 2, balloon: 1, tiki: 1, temple: 1, fisher: 1, souvenir: 2 } },
  { name: 'M1', front: HA.w[0] - FRONTAGE.main - ROW_SET, face: '+w', depth: 17, skins: { hallWide: 4, hall: 6, hallSmall: 2, chalet: 3, kiosk: 2, trailer: 4, arch: 2, game: 3, sweets: 3, temple: 1, fisher: 1, kids: 1, pizza: 2, popcorn: 2, icecream: 2, balloon: 2, tiki: 1, claw: 2, funhouse: 1, souvenir: 2, bouncy: 1 } },
  { name: 'M2', front: HA.w[1] + FRONTAGE.main + ROW_SET, face: '-w', depth: 20, skins: { hallWide: 5, hall: 6, trailer: 3, kiosk: 2, game: 2, chalet: 2, kids: 1, chair: 1, sweets: 1, pizza: 1, balloon: 1, claw: 1, funhouse: 1, bouncy: 1, souvenir: 1 } },
  // south alley: the north side (behind the M2 pitches) faces +w, the south side (next to the S pitches) faces -w
  { name: 'SNw', front: SAW.w[0] - FRONTAGE.main - ROW_SET, face: '+w', depth: 9, u: [58, 114], skins: { hall: 4, hallSmall: 3, tentS: 4, chalet: 3, kiosk: 3, trailer: 3, game: 2, sweets: 2, pizza: 2, popcorn: 1, icecream: 1, souvenir: 1 } },
  { name: 'SNe', front: SAE.w[0] - FRONTAGE.main - ROW_SET, face: '+w', depth: 12, u: [114, 262], skins: { hall: 4, hallSmall: 3, tentS: 4, chalet: 3, kiosk: 3, trailer: 3, game: 2, sweets: 2, pizza: 2, popcorn: 1, icecream: 1, souvenir: 1 } },
  { name: 'S', front: SAE.w[1] + FRONTAGE.main + ROW_SET, face: '-w', depth: 17, skins: { hallWide: 3, hall: 4, hallSmall: 3, kiosk: 3, trailer: 3, chalet: 2, sweets: 2, game: 2, arch: 1, pizza: 2, popcorn: 2, icecream: 2, tiki: 1, claw: 1, souvenir: 2, balloon: 1 } },
];

/** the strip the filler keeps free round a pitch (m): sides / back, and in front (polish 2: 0.7 / 0.8 -> 0.45 / 0.5, the aisles between pitches and stalls were wide bare asphalt) */
export const PIT_M = 0.3, PIT_F = 0.5;
const FINE = 0.5;                    // the filler's own occupancy grid (0.5 m) next to the coarse 2 m one that the other modules know
/** corridor distance helper: how far is (u, w) from the nearest alley corridor (rectangles)? */
function corridorDist(u, w) {
  let best = 1e9;
  for (const c of CORRIDORS) { const du = Math.max(c.u[0] - u, 0, u - c.u[1]); const dw = Math.max(c.w[0] - w, 0, w - c.w[1]); best = Math.min(best, Math.hypot(du, dw)); }
  return best;
}

/** which skins fill a free rectangle (weights per zone): the NW restaurant section (w < 26) is mostly halls, the middle mixed, the SE rim a service lot */
const FILL_NW = { hall: 30, hallWide: 12, hallSmall: 12, tentS: 14, chalet: 8, sweets: 4, arch: 4, game: 4, trailer: 7, pizza: 3, kiosk: 5, tiki: 2, fisher: 2, temple: 2, souvenir: 2, camelot: 1 };
const FILL_MID = { hall: 18, hallWide: 6, hallSmall: 12, tentS: 16, bouncy: 3, kids: 2, funhouse: 3, chalet: 8, sweets: 6, arch: 6, game: 7, trailer: 9, pizza: 4, kiosk: 6, tiki: 3, fisher: 3, temple: 3, balloon: 3, souvenir: 4, icecream: 3, claw: 1, popcorn: 0.5, camelot: 1.5 };
const FILL_SMALL = { trailer: 8, pizza: 4, kiosk: 6, game: 7, chalet: 4, claw: 1, camelot: 2, popcorn: 0.5, icecream: 3, souvenir: 3, balloon: 2, sweets: 3, arch: 3 };
const FILL_PITCH_S = { tentS: 8, chalet: 8, sweets: 6, arch: 6, game: 8, trailer: 9, pizza: 6, kiosk: 5, tiki: 3, fisher: 3, temple: 3, balloon: 4, souvenir: 5, icecream: 3, claw: 3 };
const FILL_PITCH_M = { hall: 14, hallSmall: 10, tentS: 10, bouncy: 3, kids: 3, funhouse: 3, chalet: 8, sweets: 6, arch: 6, game: 7, trailer: 8, pizza: 5, kiosk: 5, tiki: 3, souvenir: 4, balloon: 4, icecream: 3 };
/** a ground pad (steel plates, rubber mat, decking, turf ...) under a stall: stalls on the real Glacis stand on plates, and from above the whole footprint reads as covered.
 * Drawn in the world-aligned frame at the stall centre; corner heights follow the terrain (a pad on a slope must not sink or float). */
const PAD = [0x9aa1a8, 0x8e949a, 0x8a6a4a, 0x6a8f56, 0xb3a68a, 0x7c828a, 0xa88a5c, 0x5b7fa6];
function groundPad(b, groundY, cu, cw, y, w, d, r) {
  if (globalThis.__fouerNoFloors) return;
  const k = PAD[Math.floor(r() * PAD.length) % PAD.length]; const ao = b.ao; b.ao = false;
  const x = w / 2; const z = d / 2; const h = (sx, sz) => groundY(cu + sx * x, cw + sz * z) - y + 0.17;
  b.quad([-x, h(-1, 1), z], [x, h(1, 1), z], [x, h(1, -1), -z], [-x, h(-1, -1), -z], shade(k, 0.9 + r() * 0.2));
  b.ao = ao;
}
const pickW = (m, rr) => { let t = Object.values(m).reduce((a, v) => a + v, 0) * rr(); for (const [k, v] of Object.entries(m)) { t -= v; if (t <= 0) return k; } return Object.keys(m)[0]; };

/** Pack a grid of 1 m cells with stalls of natural size.  The scan runs from the lower-left; at every free corner each candidate skin draws a random natural size, the ones
 * that fit the free run are weighted by weight x sqrt(area) and one is picked (a thin leftover is absorbed by the stall); nothing fits: a service strip (crates, gensets) when
 * there is a little room, else skip.  `free(i, j)` = cell free and inside; `put(i, j, sw, sd, skin | null)` draws + marks (null = a service strip); `weights(i, j)` -> table. */
export function packFree({ nu, nw, free, weights, rf, put, margin = 0.3, maxRun = 30, maxDepth = 20, cell = 1 }) {
  let n = 0; const maxRunC = Math.round(maxRun / cell); const maxDepthC = Math.round(maxDepth / cell);
  for (let j = 0; j < nw; j++) for (let i = 0; i < nu; i++) {
    if (!free(i, j)) continue;
    let run = 1; while (run < maxRunC && free(i + run, j)) run++;
    if (run * cell < 2.4) continue;
    const col = new Array(run);
    for (let k = 0; k < run; k++) { let d = 0; while (d < maxDepthC && free(i + k, j + d)) d++; col[k] = d; }
    const depthFor = (sw) => { let m = 1e9; const kk = Math.min(run, Math.ceil((sw + margin) / cell - 1e-6)); for (let k = 0; k < kk; k++) m = Math.min(m, col[k]); return m * cell; };
    const runM = run * cell;
    if (depthFor(2.2) < 1.8) continue;
    const wt = weights(i, j); const cands = [];
    for (const name of Object.keys(wt)) {
      const sk = SKINS[name]; if (!sk) continue;
      // a skin may stand either way round: along u as drawn (front +w / -w), or turned (its depth along u, front +u / -u)
      for (const rot of [false, true]) {
        if (rot && (name === 'kids' || name === 'chair' || name === 'bouncy')) continue;       // round / square skins have no "turned" form
        const ww0 = rangeVal(rf, rot ? sk.d : sk.w) * (1 + 0.2 * rf()); const dd0 = rangeVal(rf, rot ? sk.w : sk.d) * (1 + 0.15 * rf());
        if (ww0 + margin > runM) continue; const dav = depthFor(ww0); if (dd0 + margin > dav) continue;
        cands.push({ name, rot, sw: ww0, sd: dd0, dav, score: wt[name] * Math.sqrt(ww0 * dd0) * (0.4 + rf()) * (rot ? 0.6 : 1) });
      }
    }
    cands.sort((x, y) => y.score - x.score);
    let done = false;
    for (let ci = 0; ci < Math.min(cands.length, 8) && !done; ci++) {
      const c = cands[ci]; let { sw, sd } = c; const sk = SKINS[c.name];
      const wMax = c.rot ? sk.d[1] : sk.w[1]; const dMax = c.rot ? sk.w[1] : sk.d[1];
      if (runM - (sw + margin) < 2.6 && runM - margin <= wMax * 1.5) sw = runM - margin;
      const dav2 = depthFor(sw); if (dav2 - (sd + margin) < 2.6 && dav2 - margin <= dMax * 1.5) sd = dav2 - margin; if (sd + margin > dav2) sd = dav2 - margin;
      if (put(i, j, sw, sd, c.name, c.rot)) { n++; done = true; }
    }
    if (!done) {
      // no skin can open its front onto a walkway here (or none fits): back-of-house.  The biggest candidate's size when there is one (a caravan yard / closed tent), else a thin strip.
      const big = cands[0];
      if (big && put(i, j, Math.min(big.sw, runM - margin), Math.min(big.sd, depthFor(Math.min(big.sw, runM - margin)) - margin), null)) n++;
      else {
        const swS = Math.min(runM - margin, 8); const dav = depthFor(swS);        // the depth over the WHOLE width of the strip (a free column that is shorter must shorten it: it used to poke into a neighbouring zone)
        if (dav >= 1.8 && runM >= 2.4 && put(i, j, swS, Math.min(dav - margin, 3.2), null)) n++;
      }
    }
  }
  return n;
}

export function buildNpcFair({ T, pitches, fieldPoly, groundY, seed = 1, quality = 'medium', lane }) {
  const LOW = quality === 'low';                       // low: every stall in the cheap `far` form (iPad low budget)
  const r = mulberry(seed * 7919 + 13); const b = new Builder({ seed, rnd: r, far: LOW }); b.jit = 0.06;
  const grid = makeGrid();
  const FNU = Math.round(NU * CELL / FINE); const FNW = Math.round(NW * CELL / FINE); const fine = new Uint8Array(FNU * FNW);
  const fineMark = (u0, u1, w0, w1) => {
    const i0 = Math.max(0, Math.floor((u0 - U0) / FINE)); const i1 = Math.min(FNU - 1, Math.ceil((u1 - U0) / FINE) - 1); const j0 = Math.max(0, Math.floor((w0 - W0) / FINE)); const j1 = Math.min(FNW - 1, Math.ceil((w1 - W0) / FINE) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fine[j * FNU + i] = 1;
  };
  for (let j = 0; j < FNW; j++) for (let i = 0; i < FNU; i++) if (!inPoly(fieldPoly, U0 + (i + 0.5) * FINE, W0 + (j + 0.5) * FINE)) fine[j * FNU + i] = 2;     // outside the field: never free
  const markAll = (u0, u1, w0, w1) => { grid.mark(u0, u1, w0, w1); fineMark(u0, u1, w0, w1); };
  const stalls = [];                                    // exact footprints { u0, u1, w0, w1 } (walk collision, coverage)
  const addStall = (cu, cw, w, d, over = 0.15, k = '', f = '') => { stalls.push({ k, f, u0: +(cu - w / 2 - over).toFixed(2), u1: +(cu + w / 2 + over).toFixed(2), w0: +(cw - d / 2 - over).toFixed(2), w1: +(cw + d / 2 + over).toFixed(2) }); };
  // the walkway network of layout.js: alleys, entrance lanes, service lane and one forecourt in front of every pitch.  The coarse grid takes the zones as bit 2 (rounded out to 2 m
  // cells: clutter's free-field filler treats any non-zero cell as taken), the fine grid exactly (0.5 m) plus the frontage strip (where tables, lamps and banners stand).
  const pitchList = pitches.map((p) => ({ id: p.id, u: p.u, w: p.w, size: p.size, face: p.face || '+w' }));
  const res = createReservations(pitchList);
  const zr = rasterZones(pitchList, { cell: CELL, u0: U0, w0: W0, nu: NU, nw: NW });
  for (let k = 0; k < zr.data.length; k++) if (zr.data[k]) grid.g[k] |= 2;
  const zf = rasterZones(pitchList, { cell: FINE, u0: U0, w0: W0, nu: FNU, nw: FNW });
  for (let k = 0; k < zf.data.length; k++) if (zf.data[k] && fine[k] !== 2) fine[k] = 1;
  for (let j = 0; j < FNW; j++) for (let i = 0; i < FNU; i++) {                    // the frontage strip along the long alleys: no stalls (the fine packer keeps out of it too)
    if (fine[j * FNU + i]) continue;
    const cr = { u0: U0 + i * FINE, u1: U0 + (i + 1) * FINE, w0: W0 + j * FINE, w1: W0 + (j + 1) * FINE };
    if (res.hitsFrontage(cr)) fine[j * FNU + i] = 1;
  }
  const pitchRects = pitchList.map((p) => { const [du, dw] = SIZE[p.size] || SIZE.S; return { u0: p.u - du / 2 - PIT_M, u1: p.u + du / 2 + PIT_M, w0: p.w - dw / 2 - PIT_M, w1: p.w + dw / 2 + PIT_M }; });
  pitchRects.forEach((q) => markAll(q.u0, q.u1, q.w0, q.w1));
  const rectOk = (rect) => !res.hits(rect) && !res.hitsFrontage(rect);
  /** the way a stall at (u, w) faces: towards the nearest alley (a long alley wins a tie by a metre), along w for the long alleys, along u for a cross alley next to it */
  const faceToward = (u, w) => {
    let best = null;
    for (const a of ALLEYS) {
      const du = Math.max(a.u[0] - u, 0, u - a.u[1]); const dw = Math.max(a.w[0] - w, 0, w - a.w[1]); const d = Math.hypot(du, dw) - (a.kind === 'main' ? 1 : 0);
      if (!best || d < best.d) best = { d, a, du, dw };
    }
    const svc = SERVICE.pts; let sd = 1e9; for (let k = 0; k < svc.length; k++) { const p0 = svc[k], p1 = svc[(k + 1) % svc.length]; const ex = p1[0] - p0[0], ez = p1[1] - p0[1]; const t = Math.max(0, Math.min(1, ((u - p0[0]) * ex + (w - p0[1]) * ez) / (ex * ex + ez * ez || 1))); sd = Math.min(sd, Math.hypot(u - p0[0] - ex * t, w - p0[1] - ez * t)); }
    if (sd < best.d - 2) return '+w';       // a back lot beside the service lane (SE of everything that faces an alley)
    const a = best.a; const cu = (a.u[0] + a.u[1]) / 2; const cw = (a.w[0] + a.w[1]) / 2;
    if (a.axis === 'w' && best.du >= best.dw) return u < cu ? '+u' : '-u';
    return w < cw ? '+w' : '-w';
  };
  let count = 0; const byKind = {}; const triKind = {};      // triKind: triangles per skin (diagnostics for the budget)
  const trisNow = () => { let t = 0; for (const k of Object.keys(b.ch)) t += b.ch[k].tris; return t; };
  // ---- feedback B: every stall front opens straight onto a walkway; no stall stands in front of / behind another; no identical skin side by side
  // `occ` = footprints of stalls and plots (0.5 m cells, +0.2 m margin) and the outside of the field; the zone raster `zf` says where the walkways are.  The probe walks straight out
  // of the front (centre line, and the two quarter lines) and succeeds when the centre line reaches a walkway cell before anything else is in the way (layout.js frontProbe does the exact
  // version for the validator; the grid is a little stricter: the reach is shorter, the margins wider).
  const occ = new Uint8Array(FNU * FNW);
  for (let k = 0; k < occ.length; k++) if (fine[k] === 2) occ[k] = 2;
  const occMark = (u0, u1, w0, w1) => {
    const i0 = Math.max(0, Math.floor((u0 - U0) / FINE)); const i1 = Math.min(FNU - 1, Math.ceil((u1 - U0) / FINE) - 1); const j0 = Math.max(0, Math.floor((w0 - W0) / FINE)); const j1 = Math.min(FNW - 1, Math.ceil((w1 - W0) / FINE) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * FNU + i] |= 1;
  };
  pitchRects.forEach((q) => occMark(q.u0, q.u1, q.w0, q.w1));
  const GRID_REACH = FRONT_REACH - 0.6;
  /** straight out of the `face` of the footprint `fp`: the distance (m) at which a walkway starts, or null (something is in the way / no walkway within reach) */
  const probeFront = (fp, face) => {
    const f = FACE_VEC[face]; if (!f) return null;
    const cu = (fp.u0 + fp.u1) / 2; const cw = (fp.w0 + fp.w1) / 2; const half = Math.max(0.5, (f[0] ? fp.w1 - fp.w0 : fp.u1 - fp.u0) / 4);
    const edge = f[0] > 0 ? fp.u1 : f[0] < 0 ? fp.u0 : f[1] > 0 ? fp.w1 : fp.w0;
    for (let t = 0.25; t <= GRID_REACH + 1e-9; t += 0.25) {
      for (const k of [0, -half, half]) {
        const u = f[0] ? edge + f[0] * t : cu + k; const w = f[1] ? edge + f[1] * t : cw + k;
        const i = Math.floor((u - U0) / FINE); const j = Math.floor((w - W0) / FINE); if (i < 0 || j < 0 || i >= FNU || j >= FNW) return null;
        const c = j * FNU + i;
        if (k === 0 && zf.data[c] && res.inZone(u, w)) return t;          // the raster says "maybe" (cells overlapping a zone), the zone list decides
        if (occ[c]) return null;
      }
    }
    return null;
  };
  /** keep the strip in front of a stall clear for good: nothing else may be packed into it */
  const reserveFront = (fp, face, t) => {
    const f = FACE_VEC[face]; const e = t + 0.3;
    const strip = f[0] > 0 ? { u0: fp.u1, u1: fp.u1 + e, w0: fp.w0, w1: fp.w1 } : f[0] < 0 ? { u0: fp.u0 - e, u1: fp.u0, w0: fp.w0, w1: fp.w1 } : f[1] > 0 ? { u0: fp.u0, u1: fp.u1, w0: fp.w1, w1: fp.w1 + e } : { u0: fp.u0, u1: fp.u1, w0: fp.w0 - e, w1: fp.w0 };
    fineMark(strip.u0, strip.u1, strip.w0, strip.w1); grid.mark(strip.u0, strip.u1, strip.w0, strip.w1);
  };
  const gapOf = (a, c) => Math.hypot(Math.max(a.u0 - c.u1, 0, c.u0 - a.u1), Math.max(a.w0 - c.w1, 0, c.w0 - a.w1));
  /** may a stall of this skin stand at this footprint?  Not beside the same fixed skin; the big themed skins (Spukhaus ...) keep BIG_SPACING apart */
  const skinOk = (skin, fp) => {
    const dup = DUP_SKINS.includes(skin); const big = BIG_SKINS.includes(skin); if (!dup && !big) return true;
    for (const o of stalls) {
      if (o.k !== skin) continue;
      if (dup && gapOf(fp, o) < DUP_GAP + 0.1) return false;
      if (big && Math.hypot((fp.u0 + fp.u1 - o.u0 - o.u1) / 2, (fp.w0 + fp.w1 - o.w0 - o.w1) / 2) < BIG_SPACING + 1) return false;
    }
    return true;
  };
  const worldDims = (face, lw, ld) => (face === '+u' || face === '-u') ? [ld, lw] : [lw, ld];      // [extent along u, extent along w] of a stall drawn lw wide, ld deep
  const footprintAt = (cu, cw, face, lw, ld, over = 0.15) => { const [eu, ew] = worldDims(face, lw, ld); return { u0: cu - eu / 2 - over, u1: cu + eu / 2 + over, w0: cw - ew / 2 - over, w1: cw + ew / 2 + over }; };
  /** the first of `faces` whose front opens onto a walkway for a stall drawn lw x ld at (cu, cw): { face, t, fp } or null */
  const openFace = (cu, cw, lw, ld, faces) => {
    for (const face of faces) {
      const fp = footprintAt(cu, cw, face, lw, ld); if (touchesAlleyAway(fp, face)) continue;
      const t = probeFront(fp, face); if (t !== null) return { face, t, fp };
    }
    return null;
  };
  /** a stall standing right at an alley (within the frontage strip + 0.6 m) must face it, never turn its back or side to it (same rule as layout.js validateStallFaces) */
  const touchesAlleyAway = (fp, face) => {
    let touching = 0; let ok = false;
    for (const a of ALLEYS) {
      const near = (FRONTAGE[a.kind] ?? 0.8) + 0.6; const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
      if (a.axis === 'u' && ov(fp.u0, fp.u1, a.u[0], a.u[1]) > 2) {
        if (fp.w1 <= a.w[0] + 1e-6 && a.w[0] - fp.w1 < near) { touching++; if (face === '+w') ok = true; }
        if (fp.w0 >= a.w[1] - 1e-6 && fp.w0 - a.w[1] < near) { touching++; if (face === '-w') ok = true; }
      } else if (a.axis === 'w' && ov(fp.w0, fp.w1, a.w[0], a.w[1]) > 2) {
        if (fp.u1 <= a.u[0] + 1e-6 && a.u[0] - fp.u1 < near) { touching++; if (face === '+u') ok = true; }
        if (fp.u0 >= a.u[1] - 1e-6 && fp.u0 - a.u[1] < near) { touching++; if (face === '-u') ok = true; }
      }
    }
    return touching > 0 && !ok;
  };
  const AXIS_FACES = { w: ['+w', '-w'], u: ['+u', '-u'] };
  const facesFor = (pref, axis) => { const list = AXIS_FACES[axis]; return list.includes(pref) ? [pref, list.find((f) => f !== pref)] : list; };
  const place = (skin, u, w, face, rr, lw, ld) => {
    const y = groundY(u, w); const [eu, ew] = worldDims(face, lw, ld);
    b.push().translate(u, y, w).rotY(YAW[face]); b.aoY = y; b.far = LOW || (!ALWAYS_NEAR.has(skin) && corridorDist(u, w) > 7);        // stalls deep in the field are roofs from above: cheap form
    const t0 = trisNow(); runSkin(b, skin, rr, lw, ld); b.far = LOW; triKind[skin] = (triKind[skin] || 0) + trisNow() - t0;
    b.pop(); b.aoY = 0; count++;
    b.push().translate(u, y, w); groundPad(b, groundY, u, w, y, eu + 0.35, ew + 0.35, rr); b.pop(); byKind[skin] = (byKind[skin] || 0) + 1;
    addStall(u, w, eu, ew, 0.15, skin, face); fineMark(u - eu / 2 - 0.2, u + eu / 2 + 0.2, w - ew / 2 - 0.2, w + ew / 2 + 0.2); occMark(u - eu / 2 - 0.2, u + eu / 2 + 0.2, w - ew / 2 - 0.2, w + ew / 2 + 0.2);
  };
  const wsum = (m) => Object.values(m).reduce((a, v) => a + v, 0);
  const pickSkin = (m, rr) => { let t = rr() * wsum(m); for (const [k, v] of Object.entries(m)) { t -= v; if (t <= 0) return k; } return Object.keys(m)[0]; };
  const fits = (u0, u1, w0, w1) => grid.free(u0, u1, w0, w1) && rectOk({ u0, u1, w0, w1 }) && [[u0, w0], [u1, w0], [u0, w1], [u1, w1], [(u0 + u1) / 2, (w0 + w1) / 2]].every(([u, w]) => inPoly(fieldPoly, u, w));
  // rows of stalls along the alleys: the stall is drawn at exactly the size that was fitted (it used to be re-rolled smaller, which left gaps between its front and the alley)
  ROWS.forEach((row, ri) => {
    const rr = mulberry(seed * 31 + ri * 977); let u = row.u ? row.u[0] : 14; const uEnd = row.u ? row.u[1] : 292;
    while (u < uEnd) {
      let done = false; let blocked = false;
      for (let attempt = 0; attempt < 5 && !done && !blocked; attempt++) {
        const skin = pickSkin(row.skins, rr); const s = SKINS[skin];
        let w = rangeVal(rr, s.w); let d = Math.min(rangeVal(rr, s.d), row.depth);
        // try the chosen skin, then shrink to the smallest ones when the gap is tight
        let ok = false; let tries = 0; const front = row.front; let wA = 0; let wB = 0;
        while (!ok && tries < 5) {
          wA = row.face === '+w' ? front - d : front; wB = row.face === '+w' ? front : front + d;
          if (fits(u - 0.2, u + w + 0.2, wA - 0.2, wB + 0.2)) { ok = true; break; }
          w *= 0.82; d *= 0.88; tries++;
          if (w < 3 || d < 2.6) break;
        }
        if (!ok) { blocked = true; break; }
        const cu = u + w / 2; const cw = (wA + wB) / 2; const fp = footprintAt(cu, cw, row.face, w, d);
        const t = touchesAlleyAway(fp, row.face) ? null : probeFront(fp, row.face);
        if (t === null) { blocked = true; break; }                     // the alley is not in front of this part of the row (the row skips it)
        if (!skinOk(skin, fp)) continue;                               // the same skin stands right beside it: draw another one
        reserveFront(fp, row.face, t); place(skin, cu, cw, row.face, rr, w, d); grid.mark(u - 0.2, u + w + 0.2, wA - 0.2, wB + 0.2);
        u += w + 0.35 + rr() * 0.5; done = true;
      }
      if (!done) u += 1.5;
    }
  });
  // gap filling: several greedy passes (big to small) over the whole field in a shuffled scan order; the front looks at the nearest walkway it can open onto (nothing in front, no plot, no back of another stall)
  const rp = mulberry(seed * 53 + 5);
  const nearestFace = (u, w, d) => faceToward(u, w + d / 2);
  const cells = []; for (let w = 4; w < 126; w += 2) for (let u = 14; u < 292; u += 2) cells.push([u, w]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rp() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  [['hall', 0.85], ['hallSmall', 0.85], ['funhouse', 0.3, 5], ['bouncy', 0.3, 3], ['trailer', 0.7], ['pizza', 0.5, 12], ['icecream', 0.5, 8], ['chalet', 0.7], ['kiosk', 0.7], ['balloon', 0.5, 8], ['tiki', 0.4, 4], ['sweets', 0.6], ['game', 0.6], ['claw', 0.5, 8], ['souvenir', 0.6, 10], ['arch', 0.5], ['popcorn', 0.8, 12], ['camelot', 0.9], ['popcorn', 0.6, 4], ['camelot', 0.9]].forEach(([skin, prob, cap]) => {
    const s = SKINS[skin]; let placed = 0;
    for (const [u, w] of cells) {
      if (cap && placed >= cap) break;
      if (rp() > prob) continue;
      const lw = rangeVal(rp, s.w); const ld = rangeVal(rp, s.d); const pref = faceToward(u + lw / 2, w + ld / 2);
      const axis = pref === '+u' || pref === '-u' ? 'u' : 'w'; const [eu, ew] = worldDims(pref, lw, ld);
      if (!fits(u - 0.3, u + eu + 0.3, w - 0.3, w + ew + 0.3)) continue;
      const cu = u + eu / 2; const cw = w + ew / 2;
      const open = openFace(cu, cw, lw, ld, facesFor(pref, axis)); if (!open || !skinOk(skin, open.fp)) continue;
      placed++; reserveFront(open.fp, open.face, open.t); place(skin, cu, cw, open.face, rp, lw, ld); grid.mark(u - 0.3, u + eu + 0.3, w - 0.3, w + ew + 0.3);
    }
  });
  // polish 2: pack every free rectangle that is left (0.5 m grid, packFree).  Halls dominate the NW section, the SE rim becomes a service lot, stalls away from the alleys are
  // built in the cheap `far` form (nobody sees their detail from the alley, they are roofs from above).  Feedback B: a stall whose front cannot open onto a walkway is never built;
  // the space becomes back-of-house (caravans, crates, generators, fenced storage, a closed storage tent) instead.
  const rf = mulberry(seed * 977 + 41); let packed = 0;
  const cellFree = (i, j) => i >= 0 && j >= 0 && i < FNU && j < FNW && !fine[j * FNU + i];
  packed = packFree({
    nu: FNU, nw: FNW, free: cellFree, rf, cell: FINE,
    weights: (i, j) => { const w = W0 + j * FINE; return w > 100 ? FILL_SMALL : w < 26 ? FILL_NW : FILL_MID; },
    put: (i, j, sw, sd, skin, rot = false) => {
      const u = U0 + i * FINE; const w = W0 + j * FINE; const gap = 0.3;
      const cu = u + (sw + gap) / 2; const cw = w + (sd + gap) / 2;
      if (![[u, w], [u + sw + gap, w], [u, w + sd + gap], [u + sw + gap, w + sd + gap]].every(([x, z]) => inPoly(fieldPoly, x, z))) { fineMark(u, u + 1, w, w + 1); return false; }
      const interior = corridorDist(cu, cw) > 2.5 && w > 4; const y = groundY(cu, cw);
      const lot = !skin || (w > 100 && skin !== 'camelot' && sw >= 5 && sd >= 3 && rf() < 0.5);
      let face = '?';
      if (!lot) {
        // a rotated candidate (world u extent = the skin's depth) faces +u / -u, an ordinary one +w / -w; the nearest alley decides between the two
        const pref = nearestFace(cu, cw, 0); const lw = rot ? sd : sw; const ld = rot ? sw : sd;
        const open = openFace(cu, cw, lw, ld, facesFor(pref, rot ? 'u' : 'w'));
        if (!open || !skinOk(skin, footprintAt(cu, cw, open.face, lw, ld))) return false;
        face = open.face; reserveFront(open.fp, face, open.t);
        b.push().translate(cu, y, cw); b.aoY = y; b.far = interior || LOW; b.rotY(YAW[face]);
        const t0 = trisNow(); runSkin(b, skin, rf, lw, ld); byKind[skin] = (byKind[skin] || 0) + 1; triKind[skin] = (triKind[skin] || 0) + trisNow() - t0;
      } else {
        b.push().translate(cu, y, cw); b.aoY = y; b.far = interior || LOW; b.rotY(rf() < 0.5 ? 0 : Math.PI);
        const t0 = trisNow();
        if (sw >= 6.5 && sd >= 8 && rf() < 0.55) storeTent(b, rf, sw, sd); else backLot(b, rf, sw, sd);
        byKind.backLot = (byKind.backLot || 0) + 1; triKind.backLot = (triKind.backLot || 0) + trisNow() - t0;
      }
      b.pop(); b.aoY = 0; b.far = LOW; count++;
      b.push().translate(cu, y, cw); groundPad(b, groundY, cu, cw, y, sw + gap - 0.05, sd + gap - 0.05, rf); b.pop();
      addStall(cu, cw, sw, sd, 0.15, lot ? 'lot' : skin, lot ? '?' : face); markAll(u - 0.05, u + sw + gap + 0.05, w - 0.05, w + sd + gap + 0.05); occMark(u - 0.05, u + sw + gap + 0.05, w - 0.05, w + sd + gap + 0.05);
      return true;
    },
  });
  // camelots standing right beside the tram rails on both sides, shoulder to shoulder (free lane ~6 m); lane = [{u, w, tu, tw}] centre line samples in the game frame.
  // They leave a gap in front of the NW gates (E5, E6): those lead to the street, not into a wall of stalls.
  const gateGaps = ENTRANCES.filter((e) => e.kind === 'gate' && e.face === '-w').map((e) => e.u);
  let camelots = 0;
  if (lane && lane.length > 3) {
    const rc = mulberry(seed * 17 + 3); const L = [0]; for (let i = 1; i < lane.length; i++) L.push(L[i - 1] + Math.hypot(lane[i].u - lane[i - 1].u, lane[i].w - lane[i - 1].w));
    const at = (s) => { let i = 1; while (i < L.length - 1 && L[i] < s) i++; const t = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1); const p = lane[i - 1]; const q = lane[i]; const tu = p.tu + (q.tu - p.tu) * t; const tw = p.tw + (q.tw - p.tw) * t; const l = Math.hypot(tu, tw) || 1; return { u: p.u + (q.u - p.u) * t, w: p.w + (q.w - p.w) * t, tu: tu / l, tw: tw / l }; };
    for (const side of [-1, 1]) {
      let s = 2;
      while (s < L[L.length - 1] - 4) {
        const w = 2.7 + rc() * 1.0; const q = at(s + w / 2); s += w + 0.12;
        if (q.u < 22 || q.u > 272) continue;
        if (gateGaps.some((g) => Math.abs(q.u - g) < GATE_GAP)) continue;      // the gap in front of a NW gate
        if (rc() < 0.07) { s += 2.5; continue; }                       // an occasional gap (a pitch not let)
        const lat = side * (3.55 + 1.1); const u = q.u - q.tw * lat; const wv = q.w + q.tu * lat; const y = groundY(u, wv);
        const yaw = Math.atan2(side * q.tw, -side * q.tu);                // front (+z) towards the rails
        b.push().translate(u, y, wv).rotY(yaw); b.aoY = y; camelotTarp(b, rc, w, 2.3); b.pop(); b.aoY = 0; count++; camelots++;
      }
    }
  }
  const g = b.finish({ id: 'npc-fair', look: 0, level: 1, size: [300, 150], height: 8, kind: 'npc-fair' });
  g.name = 'fouer-npc-fair';
  return { group: g, count, camelots, packed, byKind, triKind, stalls, tris: g.userData.tris, bulbs: g.userData.bulbs, grid: grid.g, gridDims: [NU, NW, CELL, U0, W0], fine, gateGap: GATE_GAP };
}
