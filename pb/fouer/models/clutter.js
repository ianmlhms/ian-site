/* Schueberfouer Tycoon, polish wave "Glow & density": the small stuff that makes a fair look lived in.
 * Real alleys are packed: standing tables under parasols, crate stacks, barrels, A-frame boards, banner poles, flood masts, cable ramps, generators, caravans
 * and flag lines.  Everything here is cheap merged geometry (solid / sign / lamp channels), no per-frame cost.
 *
 *   buildClutter({ T, fieldPoly, groundY, seed, quality, grid })   -> { group, count, tris }   game-frame Builder group (merged into fair.js "base"):
 *        alley-edge dressing along the Haaptallee / Fressgaass, banner poles + flag lines over the cross alleys, flood masts, free-field filler,
 *        and the SE service lane (caravans, gensets, fence panels, portaloos).  `grid` = the occupancy grid of npc.js (cells already built on stay empty).
 *   dressPitch({ T, size, g, seed, far })                          -> Group (fair materials) to add to a pitch model: crates / tables / bins / signs in the
 *        slack between the model and the edge of its pitch slot.  Skipped for the far LOD and for rides with their own material.
 */
import { Builder, mulberry, col, shade, C, GOLD, lerp, TAU, drape } from './kit.js';
import { ALLEYS as NET, createReservations, rimW } from '../layout.js';

const CRATES = [0xd8433a, 0x2d6fd0, 0xf4c430, 0x2f9a58, 0xe9e5d8, 0xee7a2a];
const CLOTH = [0xd8283a, 0x2d6fd0, 0xf6ead0, 0x2f9a58, 0xf4c430, 0x7a47c8, 0x25a6a6];
const PARASOL = [[0xd8283a, 0xf6ead0], [0x2d6fd0, 0xf6ead0], [0xf4c430, 0xf6ead0], [0x2f9a58, 0xf6ead0], [0xee7a2a, 0xf6ead0], [0x7a47c8, 0xf6ead0]];
const SIZE = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30], W: [40, 24] };
const BOARD_TEXT = ['FRITTEN', 'BIER', 'CRÊPES', 'GLACE', 'WÄIN', 'KAFFI', 'LOS', 'GAUFRES'];
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const WARM = 0xffd890;

/* ------------------------------------------------------------------ pieces (local frame: y = 0 ground, drawn at (x, z) with the current transform) */
function crateStack(b, r, x, z, yaw = 0, n = 0) {
  const k = n || 2 + Math.floor(r() * 4); const c = pick(r, CRATES); const c2 = pick(r, CRATES);
  b.push().translate(x, 0, z).rotY(yaw);
  for (let i = 0; i < k; i++) { const lvl = i < 2 ? 0 : 1; const px = (i % 2 ? 0.34 : -0.34) * (lvl ? 0.5 : 1); b.box(px, lvl * 0.34, 0, 0.62, 0.34, 0.42, i & 1 ? c2 : c, { cols: { top: shade(c, 1.15) } }); }
  b.pop();
}
function barrel(b, r, x, z, h = 0.9) { b.cyl(x, 0, z, 0.3, 0.3, h, 7, pick(r, [0x8a5a34, 0x2d6fd0, 0x2f2f35, 0xd8433a]), { cap: true, capColor: 0x6a6a70 }); }
function standTable(b, r, x, z, cloth, h = 1.08) {
  b.cyl(x, 0, z, 0.05, 0.05, h, 3, C.darkSteel); b.cyl(x, h, z, 0.46, 0.46, 0.05, 6, 0xf2ece0, { cap: true });
  b.cyl(x, h - 0.62, z, 0.56, 0.4, 0.62, 6, cloth, { smooth: false });
}
function parasol(b, r, x, z, h = 2.4, rad = 1.5) { const p = pick(r, PARASOL); b.cyl(x, 0, z, 0.035, 0.035, h, 3, C.darkSteel); b.cone(x, h - 0.1, z, rad, 0.5, 6, p[0], { alt: p, smooth: false }); }
function tableGroup(b, r, x, z, yaw = 0, withParasol = true) {
  b.push().translate(x, 0, z).rotY(yaw);
  const cl = pick(r, CLOTH); const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) standTable(b, r, (i - (n - 1) / 2) * 1.1, (i & 1) * 0.5, cl);
  if (withParasol) parasol(b, r, 0, 0.2);
  b.pop();
}
function bin(b, x, z) { b.cyl(x, 0, z, 0.26, 0.22, 0.85, 7, 0x2f8f4a, { cap: true }); b.cyl(x, 0.85, z, 0.28, 0.28, 0.06, 7, 0x222222, { cap: true }); }
function aFrame(b, r, x, z, yaw, text, look) {
  b.push().translate(x, 0, z).rotY(yaw);
  b.quad([-0.35, 0, 0.28], [0.35, 0, 0.28], [0.3, 1.0, 0.02], [-0.3, 1.0, 0.02], 0x3a2a20, { dbl: true }); b.quad([0.35, 0, -0.28], [-0.35, 0, -0.28], [-0.3, 1.0, -0.02], [0.3, 1.0, -0.02], 0x3a2a20, { dbl: true });
  b.sign(text, 0, 0.55, 0.21, 0.55, 0.62, { look, kind: 'plate', frame: false, back: false });
  b.pop();
}
/** a vertical banner on a pole (a lit sign panel on both faces) + pennant */
function bannerPole(b, r, x, z, yaw, text, look) {
  b.push().translate(x, 0, z).rotY(yaw);
  b.cyl(0, 0, 0, 0.07, 0.05, 6.4, 5, 0xdadada); b.beam([0, 6.3, 0], [0.75, 6.3, 0], 0.05, 0xdadada);
  b.sign(text, 0.4, 4.4, 0.02, 0.78, 3.3, { look, kind: 'banner', frame: 0x3a2a20, frameW: 0.03, lit: true, key: 'bp|' + look + '|' + text });
  b.push().translate(0.4, 0, -0.1).rotY(Math.PI); b.sign(text, 0, 4.4, 0.0, 0.78, 3.3, { look, kind: 'banner', frame: false, back: false, lit: true, key: 'bp|' + look + '|' + text }); b.pop();      // the back of the banner is a lit sign too
  b.pop();
}
function floodMast(b, r, x, z) {
  b.cyl(x, 0, z, 0.13, 0.09, 8.2, 5, 0x6a6e74);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; b.box(x + Math.sin(a) * 0.4, 8.0, z + Math.cos(a) * 0.4, 0.4, 0.3, 0.2, 0x2f2f35, { yaw: a }); b.blob(x + Math.sin(a) * 0.56, 8.12, z + Math.cos(a) * 0.56, 0.17, 0.17, 0.12, 0xfff6e0, { ch: 'lamp' }); b.bulb(x + Math.sin(a) * 0.62, 8.12, z + Math.cos(a) * 0.62, 0xfff2d0, 0.5); }
}
function genset(b, r, x, z, yaw) {
  b.push().translate(x, 0, z).rotY(yaw); b.box(0, 0.15, 0, 1.6, 1.0, 0.8, pick(r, [0xe8c030, 0xd8433a, 0x3a6a8a]), { cols: { top: 0x555a60 } }); b.cyl(0.55, 1.15, 0.2, 0.07, 0.07, 0.5, 5, 0x2a2a2e); b.box(0, 0, 0, 1.7, 0.18, 0.9, 0x2a2a2e); b.pop();
}
function portaloo(b, r, x, z, yaw) { b.push().translate(x, 0, z).rotY(yaw); b.box(0, 0, 0, 1.1, 2.3, 1.1, pick(r, [0x2f9a58, 0x2d6fd0, 0xe9e5d8]), { cols: { top: 0xf2f2ee } }); b.box(0, 0.2, 0.56, 0.7, 1.7, 0.04, 0x1d1b1a); b.pop(); }
function cableRamp(b, x, z, yaw, w = 1.0) { b.push().translate(x, 0, z).rotY(yaw); b.box(0, 0, 0, w, 0.07, 0.85, 0x2a2a2e); b.box(0, 0.07, 0, w * 0.8, 0.05, 0.6, 0xf4c430); b.pop(); }
function fencePanels(b, x, z, yaw, n) {
  b.push().translate(x, 0, z).rotY(yaw);
  for (let i = 0; i < n; i++) { const px = i * 3.4; b.beam([px, 0.05, 0], [px, 2.0, 0], 0.04, 0xb9c0c6); b.beam([px + 3.4, 0.05, 0], [px + 3.4, 2.0, 0], 0.04, 0xb9c0c6); b.beam([px, 1.95, 0], [px + 3.4, 1.95, 0], 0.04, 0xb9c0c6); b.beam([px, 0.15, 0], [px + 3.4, 0.15, 0], 0.04, 0xb9c0c6); b.box(px + 1.7, 0.1, 0, 3.3, 1.8, 0.02, 0xd9dde0); b.box(px + 0.2, 0, 0, 0.5, 0.06, 0.5, 0x555a60); }
  b.pop();
}
function pallet(b, r, x, z, yaw, goods) { b.push().translate(x, 0, z).rotY(yaw); b.box(0, 0, 0, 1.2, 0.14, 0.8, 0xc9a06a); if (goods) { b.box(0, 0.14, 0, 1.0, 0.6, 0.7, pick(r, [0xe9e5d8, 0x2d6fd0, 0xd8433a])); b.box(0, 0.74, 0, 1.0, 0.04, 0.7, 0xf2f2ee); } b.pop(); }
/** a showman's caravan: white box on a plate with awning, window, door, tow bar, two wheels */
function caravan(b, r, x, z, yaw, len = 6.4) {
  b.push().translate(x, 0, z).rotY(yaw);
  const body = pick(r, [0xf6f4ec, 0xefe8d8, 0xe6eef4, 0xf4e8d4]); const stripe = pick(r, [0xd8283a, 0x2d6fd0, 0x2f9a58, 0xf08a2a]);
  b.box(0, 0.35, 0, len, 2.2, 2.4, body, { cols: { top: 0xdde2e6 } }); b.box(0, 1.0, 1.21, len - 0.4, 0.24, 0.03, stripe);
  b.box(-1.0, 1.2, 1.215, 1.5, 0.9, 0.03, 0x39465a); b.box(1.6, 0.4, 1.215, 0.8, 1.8, 0.03, 0x8a5a34);
  b.box(0, 0.0, 0, len - 0.6, 0.35, 2.0, 0x3a3d44);
  [-1.6, 1.6].forEach((wx) => { b.cyl(wx, 0.0, 1.25, 0.34, 0.34, 0.22, 7, 0x1d1b1a); b.cyl(wx, 0.0, -1.25, 0.34, 0.34, 0.22, 7, 0x1d1b1a); });
  b.beam([-len / 2, 0.35, 0], [-len / 2 - 1.8, 0.2, 0], 0.1, 0x555a60);
  b.box(0, 2.55, 0, len * 0.5, 0.18, 0.7, 0xdde2e6);                                                             // roof box
  if (!b.far) { b.valance([-len * 0.3, 2.45, 1.8], [len * 0.1, 2.45, 1.8], 0.28, 8, stripe, 0xf6ead0); b.beam([-len * 0.3, 0, 1.8], [-len * 0.3, 2.45, 1.8], 0.04, 0x9aa0a6); b.beam([len * 0.1, 0, 1.8], [len * 0.1, 2.45, 1.8], 0.04, 0x9aa0a6); b.box(-len * 0.1, 2.45, 1.5, len * 0.4, 0.04, 0.8, stripe); }
  b.pop();
}
function lamp(b, x, y, z) { b.cyl(x, y, z, 0.08, 0.06, 3.2, 4, 0x2f2f35); b.bulb(x, y + 3.25, z, WARM, 0.5); }

/* ------------------------------------------------------------------ the field */
const HAA = NET.find((a) => a.id === 'haaptallee'); const FRE = NET.find((a) => a.id === 'fressgaass'); const SAW = NET.find((a) => a.id === 'sud-west'); const SAE = NET.find((a) => a.id === 'sud-ost');
/** the long alleys that get edge dressing (the dressing stands OUTSIDE the walkway, in the frontage strip the stalls keep free: layout.js FRONTAGE) */
const AL = [
  { name: 'haaptallee', u: [24, 276], w: [HAA.w[0], HAA.w[1]], gap: 4.8, tables: 0.4 },
  { name: 'fressgaass', u: [30, 280], w: [FRE.w[0], FRE.w[1]], gap: 6.5, tables: 0.3 },
  { name: 'sud-west', u: [60, 112], w: [SAW.w[0], SAW.w[1]], gap: 7, tables: 0.3 },
  { name: 'sud-ost', u: [112, 260], w: [SAE.w[0], SAE.w[1]], gap: 7, tables: 0.3 },
];
const CROSS = NET.filter((a) => a.axis === 'w');            // cross alleys + entrance lanes: banner poles on the kerb, flag lines overhead
const LONG_W = [[22.5, 33.5], [48.5, 63.5], [86.5, 101.5]];  // the long alleys' w ranges (flag lines are hung there by props.js instead)

function inPoly(poly, u, w) { let ins = false; for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) { const [ui, wi] = poly[k]; const [uj, wj] = poly[j]; if ((wi > w) !== (wj > w) && u < ((uj - ui) * (w - wi)) / (wj - wi + 1e-12) + ui) ins = !ins; } return ins; }

export function buildClutter({ T, fieldPoly, groundY, seed = 1, quality = 'medium', grid = null, gridDims = null, pitches = [], stalls = [] }) {
  const r = mulberry(seed * 4001 + 9); const b = new Builder({ seed, rnd: r, far: false }); b.jit = 0.06; let count = 0;
  const solids = []; const boxes = [];                      // small solids for the walk collision: circles { u, w, r } and caravan boxes { u0, u1, w0, w1 }
  const at = (u, w, yaw, fn, rad) => { const y = groundY(u, w); b.push().translate(u, y, w).rotY(yaw || 0); b.aoY = y; fn(); b.pop(); b.aoY = 0; count++; if (rad) solids.push({ u: +u.toFixed(2), w: +w.toFixed(2), r: rad }); };
  const dens = quality === 'low' ? 0.55 : quality === 'high' ? 1.1 : 0.85;

  // layout.js: nothing stands on an alley, a forecourt or an entrance lane.  `free(u, w, rad)` = a circle that may stand here (kerb furniture excepted), not on a pitch slot either.
  const pitchList = (pitches || []).map((p) => ({ id: p.id, u: p.u, w: p.w, size: p.size, face: p.face || '+w' }));
  const res = createReservations(pitchList);
  const SZ = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30], W: [40, 24] };
  const slots = pitchList.map((p) => { const [du, dw] = SZ[p.size] || SZ.S; return { u0: p.u - du / 2, u1: p.u + du / 2, w0: p.w - dw / 2, w1: p.w + dw / 2 }; });
  const onSlot = (u, w, rad) => slots.some((q) => u + rad > q.u0 && u - rad < q.u1 && w + rad > q.w0 && w - rad < q.w1);
  const onStall = (u, w, rad) => stalls.some((q) => u + rad > q.u0 - 0.1 && u - rad < q.u1 + 0.1 && w + rad > q.w0 - 0.1 && w - rad < q.w1 + 0.1);
  const free = (u, w, rad) => !res.blocksCircle(u, w, rad) && !onSlot(u, w, rad) && !onStall(u, w, rad) && inPoly(fieldPoly, u, w);

  // 1. alley-edge dressing: on both edges of the two long alleys, OUTSIDE the walkway (the walking lane stays free; the NPC stalls keep the frontage strip clear for this)
  const OFF = { table: 1.1, crates: 1.0, aframe: 0.7, bin: 0.4, banner: 0.3 };
  AL.forEach((al, ai) => {
    [0, 1].forEach((side) => {
      const rr = mulberry(seed * 31 + ai * 7 + side); let u = al.u[0] + 2 + rr() * 4;
      const wAt = (off) => (side ? al.w[1] + off : al.w[0] - off); const yaw = side ? Math.PI : 0;      // front looks at the middle of the alley
      while (u < al.u[1]) {
        const t = rr();
        if (rr() < dens) {
          if (t < al.tables) { const w = wAt(OFF.table); if (free(u, w, 0.9)) at(u, w, yaw + (rr() - 0.5) * 0.6, () => tableGroup(b, rr, 0, 0, 0, rr() < 0.7), 0.9); }
          else if (t < 0.55) { const w = wAt(OFF.crates); if (free(u, w, 0.95)) at(u, w, yaw, () => { crateStack(b, rr, 0, 0, rr() * 0.6); barrel(b, rr, 0.9, 0.1); if (rr() < 0.5) barrel(b, rr, 1.3, -0.3, 0.7); }, 0.95); }
          else if (t < 0.72) { const w = wAt(OFF.aframe); if (free(u, w, 0.4)) at(u, w, yaw, () => aFrame(b, rr, 0, 0, (rr() - 0.5) * 0.5, pick(rr, BOARD_TEXT), rr() < 0.3 ? 2 : 0), 0.4); }
          else if (t < 0.86) { const w = wAt(OFF.bin); if (free(u, w, 0.5)) at(u, w, yaw, () => { bin(b, 0, 0); if (rr() < 0.6) bin(b, 0.6, 0.1); }, 0.5); }
          else { const w = wAt(OFF.banner); if (free(u, w, 0.2)) at(u, w, yaw, () => bannerPole(b, rr, 0, 0, side ? Math.PI : 0, pick(rr, ['FOUER', 'BIER', 'CRÊPES', 'FRITTEN', 'GLACE']), rr() < 0.35 ? 2 : 0), 0.2); }
        }
        u += al.gap * (0.7 + rr() * 0.8);
      }
    });
  });

  // 2. cross alleys + entrance lanes: banner poles on the kerb (outside the lane), flag lines overhead every 11 m, now and then a flood mast
  CROSS.forEach((ca, ci) => {
    const rr = mulberry(seed * 53 + ci);
    const inLong = (w) => LONG_W.some(([a, c]) => w > a && w < c);
    for (let w = ca.w[0] + 4; w < ca.w[1]; w += 11 + rr() * 3) {
      if (inLong(w)) continue;                                                // the long alleys have their own strings
      const ya = groundY(ca.u[0] - 0.3, w); const yb = groundY(ca.u[1] + 0.3, w);
      b.pennants([ca.u[0] - 0.3, ya + 4.8, w], [ca.u[1] + 0.3, yb + 4.8, w], 12, [0xd8283a, 0xf4c430, 0x2d6fd0, 0xf6ead0, 0x2f9a58], 0.42, { sag: 0.4 }); count++;
      if (rr() < 0.55) { const n = 8; for (let k = 0; k <= n; k++) { const t = k / n; b.bulb(lerp(ca.u[0] - 0.3, ca.u[1] + 0.3, t), lerp(ya, yb, t) + 4.6 - Math.sin(Math.PI * t) * 0.45, w, rr() < 0.5 ? WARM : 0xfff4d0, 0.2); } }
    }
    for (let w = ca.w[0] + 10; w < ca.w[1]; w += 31 + rr() * 8) {
      if (inLong(w)) continue;
      const u = rr() < 0.5 ? ca.u[0] - 0.27 : ca.u[1] + 0.27; if (!free(u, w, 0.2)) continue;
      at(u, w, 0, () => bannerPole(b, rr, 0, 0, rr() < 0.5 ? 0 : Math.PI, pick(rr, ['FOUER', 'LOS', 'BONBONS', 'WÄIN']), 0), 0.2);
    }
    if (ci % 2 === 0) { const w = ca.w[0] + 22; const u = ca.u[1] + 0.27; if (!inLong(w) && free(u, w, 0.25)) at(u, w, 0, () => floodMast(b, rr, 0, 0), 0.25); }
  });

  // 3. free-field filler: every free cell block of the npc occupancy grid gets tables / crates / gensets; the SE rim becomes the service lane
  if (grid && gridDims) {
    const [NU, NW, CELL, U0, W0] = gridDims; const rf = mulberry(seed * 77 + 5); const used = new Uint8Array(grid.length);
    const freeBlock = (i, j, n, m) => { for (let jj = j; jj < j + m; jj++) for (let ii = i; ii < i + n; ii++) { if (ii >= NU || jj >= NW || grid[jj * NU + ii] || used[jj * NU + ii]) return false; } return true; };
    const mark = (i, j, n, m) => { for (let jj = j; jj < j + m; jj++) for (let ii = i; ii < i + n; ii++) used[jj * NU + ii] = 1; };
    const order = []; for (let j = 0; j < NW; j += 1) for (let i = 0; i < NU; i += 1) order.push([i, j]);
    for (let q = order.length - 1; q > 0; q--) { const k = Math.floor(rf() * (q + 1)); [order[q], order[k]] = [order[k], order[q]]; }
    let vans = 0;
    for (const [i, j] of order) {
      if (grid[j * NU + i] || used[j * NU + i]) continue;
      const u = U0 + i * CELL; const w = W0 + j * CELL;
      if (!inPoly(fieldPoly, u + 2, w + 2)) continue;
      const rim = w > 106;                                                      // behind the S row: the service lane
      if (rim && freeBlock(i, j, 4, 3) && inPoly(fieldPoly, u + 8, w + 6) && rf() < 0.7 * dens) { mark(i, j, 4, 3); vans++; boxes.push({ u0: +(u + 4 - 3.5).toFixed(2), u1: +(u + 4 + 3.5).toFixed(2), w0: +(w + 3 - 1.4).toFixed(2), w1: +(w + 3 + 1.4).toFixed(2) }); at(u + 4, w + 3, rf() < 0.5 ? 0 : Math.PI, () => { caravan(b, rf, 0, 0, 0); if (rf() < 0.6) crateStack(b, rf, 4.2, 0.6); if (rf() < 0.5) genset(b, rf, -4.4, 0.4, 0.3); }); continue; }
      if (freeBlock(i, j, 3, 3) && rf() < 0.8 * dens) { mark(i, j, 3, 3); at(u + 3, w + 3, rf() * TAU, () => { const t = rf(); if (rim && t < 0.3) { portaloo(b, rf, 0, 0, 0); portaloo(b, rf, 1.2, 0, 0); } else if (t < 0.45) tableGroup(b, rf, 0, 0, 0, true); else if (t < 0.65) { crateStack(b, rf, 0, 0); pallet(b, rf, 1.5, 0.3, 0.2, true); barrel(b, rf, -1, 0.4); } else if (t < 0.8) { genset(b, rf, 0, 0, 0); cableRamp(b, 1.5, 0.2, 0); } else { tableGroup(b, rf, 0, 0, 0, true); crateStack(b, rf, 2.0, 0.8); } }, 1.3); continue; }
      if (freeBlock(i, j, 2, 2) && rf() < 0.7 * dens) { mark(i, j, 2, 2); at(u + 2, w + 2, rf() * TAU, () => { const t = rf(); if (t < 0.4) crateStack(b, rf, 0, 0); else if (t < 0.7) { bin(b, 0, 0); barrel(b, rf, 0.8, 0.2); } else pallet(b, rf, 0, 0, 0, true); }, 0.8); continue; }
    }
    // fence panels along the rim, outside the service lane (they hug the rim barrier; never across an entrance lane)
    for (let u = 38; u < 230; u += 33 + rf() * 20) { const w = rimW(u) - 0.45; const rect = { u0: u - 0.2, u1: u + 7.2, w0: w - 0.3, w1: w + 0.3 }; if (inPoly(fieldPoly, u, w + 0.2) && !res.hits(rect, 0.2) && !onSlot(u + 3.5, w, 3.6) && !onStall(u + 3.5, w, 3.6)) at(u, w, 0.15, () => fencePanels(b, 0, 0, 0, 2), 0.6); }
  }
  // 4. flood masts on the kerb at four crossings of the Haaptallee (outside the walkway)
  [[HAA.u[0] + 41.2, HAA.w[1] + 0.27], [94.5 - 0.27, HAA.w[0] - 0.27], [171 - 0.27, HAA.w[1] + 0.27], [226.5 + 0.27, HAA.w[0] - 0.27]].forEach(([u, w]) => { if (free(u, w, 0.25)) at(u, w, 0, () => floodMast(b, r, 0, 0), 0.25); });

  const g = b.finish({ id: 'clutter', look: 0, level: 1, size: [300, 150], height: 9, kind: 'clutter' }); g.name = 'fouer-clutter';
  return { group: g, count, tris: g.userData.tris, bulbs: g.userData.bulbs, solids, boxes };
}

export { crateStack, barrel, standTable, parasol, tableGroup, bin, genset, portaloo, cableRamp, fencePanels, pallet, caravan };

/** a service lot filling a w x d slot (centred at the origin, front +z): caravans, crates, gensets, portaloos (the back lanes of the field) */
export function backLot(b, r, w, d) {
  const n = Math.max(1, Math.floor(w / 7)); const cw = w / n;
  for (let k = 0; k < n; k++) {
    const cx = -w / 2 + (k + 0.5) * cw; const t = r();
    if (d >= 3.2 && cw >= 6 && t < 0.55 && !b.far) { caravan(b, r, cx, 0, r() < 0.5 ? 0 : Math.PI, Math.min(6.4, cw - 0.5)); if (d > 5 && cw > 7) crateStack(b, r, cx + 2.2, d / 2 - 0.8); }
    else if (t < 0.7) { crateStack(b, r, cx - 0.6, 0); pallet(b, r, cx + 0.8, 0.3, 0.2, true); barrel(b, r, cx - 1.6, 0.4); }
    else if (t < 0.85) { genset(b, r, cx, 0, 0); cableRamp(b, cx + 1.5, 0.2, 0); crateStack(b, r, cx - 1.5, 0.2); }
    else { portaloo(b, r, cx - 0.6, 0, 0); portaloo(b, r, cx + 0.6, 0, 0); }
  }
  if (!b.far && d >= 3 && w >= 6) fencePanels(b, -w / 2 + 0.2, -d / 2 + 0.1, 0, Math.max(1, Math.floor((w - 0.4) / 3.4)));
}

/* ------------------------------------------------------------------ per-pitch dressing: the slack between a model and the edge of its slot */
export function dressPitch({ T, size, g, seed = 1, far = false, groundY = null, rect = null }) {
  const dims = SIZE[size]; if (!dims || far || size === 'W' || size === 'XL') return null;
  const box = new T.Box3().setFromObject(g); if (box.isEmpty()) return null;
  const r = mulberry(seed * 977 + 3); const b = new Builder({ seed, rnd: r, far: false }); b.jit = 0.06;
  // the slot floor: steel plates draped on the terrain under the whole slot (a built stall stands on plates, from above the slot reads as occupied ground)
  if (groundY && rect) { const yw = rect.face === '-w' ? Math.PI : 0; const cs = Math.cos(yw); const sn = Math.sin(yw); drape(b, dims[0] / 2 - 0.4, dims[1] / 2 - 0.4, (x, z) => groundY(rect.u + x * cs + z * sn, rect.w - x * sn + z * cs) - rect.y, (i, j) => shade([0x9aa1a8, 0x8e949a, 0xa2a8ae][(i + j * 2 + (rect.u | 0)) % 3], 0.94 + 0.12 * r()), 4, 0.18); }
  const hx = dims[0] / 2 - 0.35; const hz = dims[1] / 2 - 0.35; const gap = 0.7;
  const zones = [                                                           // [x0, x1, z0, z1, kind]
    [-hx, box.min.x - gap, -hz, hz, 'side'], [box.max.x + gap, hx, -hz, hz, 'side'], [box.min.x - gap, box.max.x + gap, -hz, box.min.z - gap, 'back'], [box.min.x - 1, box.max.x + 1, box.max.z + 1.1, hz, 'front'],
  ].filter((z) => z[1] - z[0] >= 1.3 && z[3] - z[2] >= 1.3);
  if (!zones.length) return null;
  const maxN = size === 'S' ? 4 : size === 'M' ? 9 : 14; let n = 0;
  for (let tries = 0; tries < maxN * 3 && n < maxN; tries++) {
    const z = zones[Math.floor(r() * zones.length)]; const x = lerp(z[0] + 0.6, z[1] - 0.6, r()); const zz = lerp(z[2] + 0.6, z[3] - 0.6, r());
    const t = r(); b.push().translate(x, 0, zz).rotY((r() - 0.5) * 1.2);
    if (z[4] === 'front') { if (t < 0.45) tableGroup(b, r, 0, 0, 0, r() < 0.6); else if (t < 0.7) aFrame(b, r, 0, 0, 0, pick(r, BOARD_TEXT), 0); else bin(b, 0, 0); }
    else if (t < 0.4) crateStack(b, r, 0, 0); else if (t < 0.55) { barrel(b, r, 0, 0); barrel(b, r, 0.7, 0.2); } else if (t < 0.7) pallet(b, r, 0, 0, 0, true); else if (t < 0.82) genset(b, r, 0, 0, 0); else if (t < 0.92) cableRamp(b, 0, 0, 0); else bin(b, 0, 0);
    b.pop(); n++;
  }
  if (!n && !(groundY && rect)) return null;
  return b.finish({ id: 'dress', look: 0, level: 1, size: dims, height: 3, kind: 'dress' });
}
