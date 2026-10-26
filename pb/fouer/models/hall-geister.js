/* Schueberfouer Tycoon, W4b: the haunted-castle ghost train (item `geister`, pitch L 30 x 18, DESIGN 3.3).
 * A hall behind a castle facade: grey ashlar blocks, a clock tower with a hanging jester, a smaller turret with a giant hand, a balcony with a stone balustrade,
 * a green dragon head, skulls, a gargoyle, airbrushed horror panels, an entry ramp and a lit roof sign.  Four carts follow a closed track that leaves the building
 * through the upper doors (they cross the balcony and vanish again) and through the wide ground gate, and hides inside for the rest of the lap. */
import { makeKit, rng, clamp, lerp, bulb, festoon, railing, padSlab, pennant } from './big-kit.js';
import { makeSpline, makeRun, rails, girder, buildTrackRide } from './coaster-kit.js';
import { litSign, ticketBooth, nameOf, GOLD, DARK } from './coaster-props.js';
import { pixelText } from './big-kit.js';

const PAL = [
  { stone: [0x8d8c8a, 0x7a797c, 0x9a9896], mortar: 0x2c2b30, roof: 0x3c4048, roofB: 0x2c3036, trim: 0xe7b53b, dragon: 0x4aa03a, dragonB: 0x2f7a2a, dragonUnder: 0xd8c860, sign: [1, 0.12, 0.1], bulb: [1, 0.55, 0.2], glow: [1, 0.82, 0.45], hand: 0xe8c8a0, sleeve: 0x6a3a8a,
    mural: [[0xff7a1a, 0xc8142a, 0x4a1a5a], [0x2a1a4a, 0x8a2a8a, 0xff5a1a], [0x1a2a4a, 0x3a8a6a, 0xf2c24a]], led: [[1, 0.2, 0.1], [1, 0.7, 0.1]], wood: 0x4a3222, ivy: 0x3f8a3a, cart: 0x1d1d22, cartB: 0xb8142a, board: 0x1a1018 },
  { stone: [0x6e5f8c, 0x5c4d7c, 0x7a6c9a], mortar: 0x1c1430, roof: 0x2a1a50, roofB: 0x1c1238, trim: 0x40e8ff, dragon: 0x35ff9a, dragonB: 0x1f9a66, dragonUnder: 0xf0f0a0, sign: [0.2, 0.95, 1], bulb: [0.4, 0.9, 1], glow: [0.5, 0.9, 1], hand: 0xd8c0e8, sleeve: 0xc7168e,
    mural: [[0x35e6ff, 0xc7168e, 0x2a1a70], [0x1a1050, 0xff5ac0, 0x35e6ff], [0x120a30, 0x6a3ad0, 0xc7ff3a]], led: [[0.1, 0.9, 1], [1, 0.1, 0.8]], wood: 0x2a1a48, ivy: 0x35ff9a, cart: 0x120a30, cartB: 0x35e6ff, board: 0x0c0820 },
  { stone: [0x8fa3bf, 0x7d92b0, 0x9fb2cc], mortar: 0x2a3550, roof: 0x2f64b8, roofB: 0x244b88, trim: 0xcfe0f6, dragon: 0x3ab8c8, dragonB: 0x2a8898, dragonUnder: 0xf4f4f0, sign: [1, 0.84, 0.5], bulb: [1, 0.85, 0.5], glow: [1, 0.9, 0.6], hand: 0xf0dcc0, sleeve: 0x2f64b8,
    mural: [[0xb8d4f0, 0x2f64b8, 0x244b88], [0x244b88, 0x7aa6e0, 0xf4f4f0], [0x1d3a70, 0x7aa6e0, 0xf2c24a]], led: [[1, 0.85, 0.5], [0.75, 0.88, 1]], wood: 0x3a4a6a, ivy: 0x4a8a6a, cart: 0x1d2a44, cartB: 0xf4f4f0, board: 0x14243e },
];

const ZF = 2.6; const ZB = -8.0; const BAL_Y = 4.8; const TOP_Y = 10.0;
const TW = { x0: -13.8, x1: -8.4, z1: 4.6, h: 14.8 };         // clock tower
const RT = { x0: 10.4, x1: 13.8, z1: 3.9, h: 12.0 };          // right turret
const U1X = -3.2; const U2X = 6.6; const G_OUT = 10.2; const G_IN = 8.2; const CART_Y = 4.9; const CART_G = 1.0;

export function geisterControls() {
  return [
    [U1X, CART_Y, 0.2], [U1X, CART_Y, 1.8], [U1X, CART_Y, 3.0], [U1X + 0.6, CART_Y, 3.5], [U1X + 1.6, CART_Y, 3.55], [1.5, CART_Y, 3.55], [4.2, CART_Y, 3.55], [U2X - 0.7, CART_Y, 3.5], [U2X, CART_Y, 3.0], [U2X, CART_Y, 1.6],
    [U2X, CART_Y, -0.6], [7.4, 4.2, -2.6], [8.9, 2.4, -3.2], [10.2, 1.2, -1.6], [G_OUT, CART_G, 0.4], [G_OUT, CART_G, 1.8], [G_OUT, CART_G, 3.3], [G_OUT - 0.6, CART_G, 4.5], [(G_OUT + G_IN) / 2, CART_G, 5.0], [G_IN + 0.6, CART_G, 4.5], [G_IN, CART_G, 3.3], [G_IN, CART_G, 1.8],
    [G_IN, CART_G, 0.2], [6.6, CART_G, -2.6], [2.0, CART_G, -5.0], [-3.0, 1.6, -5.4], [-5.6, 3.2, -3.4], [-4.4, 4.5, -1.4],
  ];
}

/* ------------------------------------------------------------------------------------------------------------------ small pieces */
const jit = (R, k) => 1 + (R() - 0.5) * k;
function shade(c, f) { const r = ((c >> 16) & 255) * f; const g = ((c >> 8) & 255) * f; const b = (c & 255) * f; return (clamp(r, 0, 255) << 16) | (clamp(g, 0, 255) << 8) | clamp(b, 0, 255); }
/** ashlar blocks on a rectangle: map(u, v) -> point; rows of random-width blocks with a mortar gap left to the dark wall behind */
function ashlar(b, map, u0, u1, v0, v1, rowH, colW, stones, R, near) {
  const P = b.P;
  if (!near) { const rows = Math.max(1, Math.round((v1 - v0) / (rowH * 2.2))); for (let r = 0; r < rows; r++) { const a = lerp(v0, v1, r / rows); const c = lerp(v0, v1, (r + 1) / rows); P.quad(map(u0, a), map(u1, a), map(u1, c), map(u0, c), stones[r % 3]); } return; }
  const rows = Math.max(1, Math.round((v1 - v0) / rowH));
  for (let r = 0; r < rows; r++) {
    const a = lerp(v0, v1, r / rows); const c = lerp(v0, v1, (r + 1) / rows); let u = u0 + (r % 2 ? colW * 0.4 : 0) * R();
    let first = true;
    while (u < u1 - 0.02) {
      const w = colW * (0.7 + 0.7 * R()); const ue = Math.min(u1, u + w); const g = 0.035;
      if (ue - u > 2 * g + 0.05) P.quad(map(u + g, a + g), map(ue - g, a + g), map(ue - g, c - g), map(u + g, c - g), shade(stones[Math.floor(R() * 3)], jit(R, 0.18)));
      u = ue; first = false;
    }
  }
}
function skull(b, x, y, z, s, near) {
  const P = b.P; if (!near) { P.sphere([x, y, z], 0.34 * s, 0xf0eee0, 6, 4); return; }
  P.sphere([x, y, z], 0.36 * s, 0xf0eee0, 8, 6); P.box(x, y - 0.34 * s, z + 0.08 * s, 0.34 * s, 0.2 * s, 0.26 * s, 0xe6e4d4, 0);
  for (const sx of [-1, 1]) P.sphere([x + sx * 0.14 * s, y + 0.03 * s, z + 0.3 * s], 0.09 * s, 0x15151a, 6, 4);
  P.tri([x - 0.04 * s, y - 0.08 * s, z + 0.35 * s], [x + 0.04 * s, y - 0.08 * s, z + 0.35 * s], [x, y - 0.2 * s, z + 0.34 * s], 0x15151a);
}
function dragon(b, x, y, z, pal, near, gold) {
  const P = b.P; const L = b.L;
  const neck = [[x, y, z], [x - 0.5, y + 1.0, z + 0.2], [x - 1.3, y + 1.9, z + 0.8], [x - 2.2, y + 2.2, z + 1.6], [x - 3.0, y + 1.9, z + 2.3]];
  for (let i = 0; i + 1 < neck.length; i++) {
    if (near) P.stripedTube(neck[i], neck[i + 1], 0.5 - i * 0.04, pal.dragon, pal.dragonB, { sides: 7, rowLen: 0.35, spiral: 1, r1: 0.46 - i * 0.04 });
    else P.tube(neck[i], neck[i + 1], 0.5 - i * 0.04, pal.dragon, { sides: 5 });
    P.tri([neck[i][0], neck[i][1] + 0.4, neck[i][2]], [neck[i + 1][0], neck[i + 1][1] + 0.4, neck[i + 1][2]], [(neck[i][0] + neck[i + 1][0]) / 2, neck[i][1] + 1.0, (neck[i][2] + neck[i + 1][2]) / 2], pal.dragonB);
  }
  const h = neck[4];
  b.place([h[0], h[1], h[2]], -0.7, 0, 0, 1);
  P.box(0, 0.1, 0.45, 0.85, 0.7, 1.5, pal.dragon, 0);                       // skull + snout
  P.tri([-0.4, 0.45, 1.2], [0.4, 0.45, 1.2], [0, 0.35, 1.7], pal.dragonB);
  b.place([0, -0.25, 0.1], 0, 0.42);                                          // lower jaw, open
  P.box(0, -0.12, 0.7, 0.7, 0.22, 1.35, pal.dragonUnder, 0);
  if (near) for (let q = 0; q < 6; q++) { const zz = 0.2 + q * 0.2; for (const sx of [-1, 1]) P.tri([sx * 0.3, 0.0, zz], [sx * 0.3, 0.0, zz + 0.1], [sx * 0.3, 0.2, zz + 0.05], 0xf4f0e0); }
  b.pop();
  if (near) for (let q = 0; q < 6; q++) { const zz = 0.3 + q * 0.19; for (const sx of [-1, 1]) P.tri([sx * 0.32, -0.12, zz], [sx * 0.32, -0.12, zz + 0.1], [sx * 0.32, -0.32, zz + 0.05], 0xf4f0e0); }
  for (const sx of [-1, 1]) { P.sphere([sx * 0.3, 0.42, 0.85], 0.13, 0xfff1c8, 6, 4); L.sphere([sx * 0.3, 0.42, 0.95], 0.09, [1, 0.8, 0.1], 6, 4); P.tube([sx * 0.25, 0.5, 0.2], [sx * 0.5, 1.2, -0.3], 0.1, gold ? GOLD : 0xe8d8a8, { sides: 4, r1: 0.02 }); }
  b.pop();
}
function hand(b, x, y, z, ry, pal, near, gold) {
  const P = b.P; b.place([x, y, z], ry, -0.3, 0, 1.7);
  P.box(0, 0, -1.0, 1.0, 0.8, 1.6, pal.sleeve, 0); P.box(0, 0, -0.2, 1.12, 0.92, 0.2, gold ? GOLD : 0xe7d7a0, 0);      // sleeve + cuff
  P.box(0, 0, 0.45, 0.95, 0.3, 0.95, pal.hand, 0);                                                                       // palm
  const fingers = [[-0.36, 1.05, -0.25], [-0.12, 1.3, -0.08], [0.12, 1.25, 0.08], [0.36, 1.0, 0.25]];
  for (const [fx, fl, sp] of fingers) { const a1 = [fx, 0, 0.92]; const a2 = [fx + sp * 0.5, 0.06, 0.92 + fl * 0.55]; const a3 = [fx + sp, 0.2, 0.92 + fl]; P.tube(a1, a2, 0.12, pal.hand, { sides: 5 }); P.tube(a2, a3, 0.1, pal.hand, { sides: 5, r1: 0.07 }); }
  P.tube([-0.5, 0.0, 0.4], [-1.05, 0.12, 1.0], 0.13, pal.hand, { sides: 5, r1: 0.08 });                                  // thumb
  b.pop();
}
function jester(b, x, y, z, pal) {
  const P = b.P;
  P.tube([x, y + 1.9, z], [x, y + 2.4, z], 0.02, 0x2a2a2a, { sides: 3 });
  P.tube([x - 0.12, y, z], [x - 0.15, y + 0.8, z], 0.1, 0x2a52a8, { sides: 5 }); P.tube([x + 0.12, y, z], [x + 0.18, y + 0.8, z], 0.1, 0xc8142a, { sides: 5 });
  P.tube([x, y + 0.8, z], [x, y + 1.5, z], 0.24, 0xc8142a, { sides: 6, r1: 0.18 });
  P.tube([x - 0.2, y + 1.4, z], [x - 0.6, y + 1.9, z], 0.07, 0x2a52a8, { sides: 4 }); P.tube([x + 0.2, y + 1.4, z], [x + 0.6, y + 1.9, z], 0.07, 0xc8142a, { sides: 4 });
  P.sphere([x, y + 1.7, z], 0.22, 0xf0d8c0, 7, 5); P.tri([x - 0.22, y + 1.8, z], [x, y + 2.3, z], [x + 0.22, y + 1.8, z], 0xc8142a); P.tri([x - 0.22, y + 1.8, z], [x - 0.5, y + 2.1, z], [x - 0.05, y + 1.95, z], 0x2a52a8);
}
function mural(b, x0, x1, y0, y1, z, kind, pal, near) {
  const P = b.P; const m = pal.mural[kind % 3]; const cx = (x0 + x1) / 2; const w = x1 - x0; const h = y1 - y0;
  P.box(cx, (y0 + y1) / 2, z - 0.03, w + 0.3, h + 0.3, 0.06, 0x2a1a22, 0);
  P.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], m[2], m[2], m[1], m[1]);
  if (kind === 0) { for (let q = 0; q < 7; q++) { const fx = x0 + ((q + 0.5) * w) / 7; const fh = h * (0.45 + 0.4 * (((q * 5) % 7) / 7)); P.tri([fx - w / 14 * 1.2, y0, z + 0.01], [fx + w / 14 * 1.2, y0, z + 0.01], [fx, y0 + fh, z + 0.01], m[0]); P.tri([fx - w / 14 * 0.6, y0, z + 0.02], [fx + w / 14 * 0.6, y0, z + 0.02], [fx, y0 + fh * 0.6, z + 0.02], 0xffd050); } skull(b, cx, y0 + h * 0.6, z + 0.2, 2.2, near); }
  else if (kind === 1) { P.fan([cx, y0 + h * 0.45, z + 0.01], [w * 0.28, 0, 0], [0, h * 0.4, 0], 0xe8d0c0, 16); P.tri([cx - w * 0.3, y0 + h * 0.7, z + 0.02], [cx + w * 0.3, y0 + h * 0.7, z + 0.02], [cx, y1 - 0.1, z + 0.02], 0x15151a); for (const sx of [-1, 1]) P.fan([cx + sx * w * 0.11, y0 + h * 0.52, z + 0.03], [w * 0.07, 0, 0], [0, h * 0.06, 0], 0x15151a, 8); P.quad([cx - w * 0.1, y0 + h * 0.25, z + 0.03], [cx + w * 0.1, y0 + h * 0.25, z + 0.03], [cx + w * 0.06, y0 + h * 0.3, z + 0.03], [cx - w * 0.06, y0 + h * 0.3, z + 0.03], 0x8a1a2a); }
  else { for (let q = 0; q < 5; q++) { const fx = x0 + ((q + 0.5) * w) / 5; P.tri([fx - 0.3, y0 + 0.2, z + 0.01], [fx + 0.3, y0 + 0.2, z + 0.01], [fx, y0 + h * (0.5 + 0.1 * (q % 2)), z + 0.01], 0x15151a); } P.fan([cx, y0 + h * 0.62, z + 0.02], [w * 0.2, 0, 0], [0, h * 0.2, 0], m[0], 12); }
}

/* ------------------------------------------------------------------------------------------------------------------ cart */
function buildCart(b, near, pal) {
  const P = b.P; const L = b.L;
  if (!near) { P.box(0, 0.55, 0, 1.2, 0.7, 2.2, pal.cart, 32); P.box(0, 0.7, 1.15, 1.0, 0.5, 0.2, pal.cartB, 0); return; }
  P.box(0, 0.35, 0, 1.2, 0.3, 2.3, 0x24262a, 32); P.box(0, 0.62, -0.1, 1.2, 0.5, 1.9, pal.cart, 0);
  P.quad([-0.6, 0.55, 1.05], [0.6, 0.55, 1.05], [0.5, 0.95, 0.7], [-0.5, 0.95, 0.7], pal.cartB);
  P.box(0, 0.95, -0.25, 1.0, 0.1, 0.9, pal.cartB, 0); for (const z of [0.0, -0.6]) { P.box(0, 0.96, z, 0.9, 0.1, 0.5, 0x2a2a30, 0); P.box(0, 1.2, z - 0.28, 0.9, 0.5, 0.08, 0x2a2a30, 0); }
  P.sphere([0, 0.95, 1.14], 0.24, 0xf0eee0, 7, 5); for (const sx of [-1, 1]) L.sphere([sx * 0.09, 0.99, 1.33], 0.05, [0.3, 1, 0.4], 4, 3);
}

/* ------------------------------------------------------------------------------------------------------------------ static structure */
function buildStatic(b, cfg, near, sp, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [], led: pal.led };
  const R = rng(1234); const G = b.G(pal.glow); const trim = gold ? GOLD : pal.trim;
  padSlab(b, 29.0, 17.4, 0, 0);
  // the building: a dark core (the mortar), the facade plane at ZF
  const cx = 0;
  P.box(cx, 5.2, (ZF + ZB) / 2, 27.6, 10.4, ZF - ZB, pal.mortar, 32 | 16);
  P.box(cx, TOP_Y + 0.05, (ZF + ZB) / 2, 27.8, 0.3, ZF - ZB + 0.3, pal.stone[2], 32);
  // towers (mortar cores)
  P.box((TW.x0 + TW.x1) / 2, TW.h / 2, (TW.z1 - 2) / 2, TW.x1 - TW.x0, TW.h, TW.z1 + 2, pal.mortar, 32 | 16);
  P.box((RT.x0 + RT.x1) / 2, RT.h / 2, (RT.z1 - 2) / 2, RT.x1 - RT.x0, RT.h, RT.z1 + 2, pal.mortar, 32 | 16);
  // ashlar: facade lower floor / upper floor strips, tower faces, side walls
  const mz = (z) => (u, v) => [u, v, z]; const mx = (x) => (u, v) => [x, v, u];
  ashlar(b, mz(ZF + 0.02), -8.4, 10.4, 0.3, BAL_Y - 0.1, 0.68, 1.5, pal.stone, R, near);
  ashlar(b, mz(ZF + 0.02), -8.4, 10.4, BAL_Y, 5.35, 0.55, 1.5, pal.stone, R, near);
  ashlar(b, mz(ZF + 0.02), -8.4, 10.4, 9.3, TOP_Y, 0.7, 1.5, pal.stone, R, near);
  ashlar(b, mz(TW.z1 + 0.02), TW.x0, TW.x1, 0.3, TW.h, 0.75, 1.3, pal.stone, R, near);
  ashlar(b, mx(TW.x0 - 0.02), -2, TW.z1, 0.3, TW.h, 0.75, 1.3, pal.stone, R, near);
  ashlar(b, mx(TW.x1 + 0.02), ZF, TW.z1, 0.3, TW.h, 0.75, 1.3, pal.stone, R, near);
  ashlar(b, mz(RT.z1 + 0.02), RT.x0, RT.x1, 0.3, RT.h, 0.75, 1.3, pal.stone, R, near);
  ashlar(b, mx(RT.x1 + 0.02), -2, RT.z1, 0.3, RT.h, 0.75, 1.3, pal.stone, R, near);
  ashlar(b, mx(RT.x0 - 0.02), ZF, RT.z1, 0.3, RT.h, 0.75, 1.3, pal.stone, R, near);
  ashlar(b, mx(13.82), ZB, ZF, 0.3, TOP_Y, 0.9, 2.0, pal.stone, R, false);
  ashlar(b, mx(-13.82), ZB, ZF, 0.3, TOP_Y, 0.9, 2.0, pal.stone, R, false);
  ashlar(b, (u, v) => [u, v, ZB - 0.02], -13.8, 13.8, 0.3, TOP_Y, 1.0, 2.0, pal.stone, R, false);
  // crenellations along the roofline (front + towers)
  const merlon = (x0, x1, z, y) => { for (let x = x0 + 0.5; x < x1 - 0.5; x += 1.9) P.box(x, y + 0.45, z, 1.1, 0.9, 0.5, pal.stone[1], 32); };
  merlon(-8.4, 10.4, ZF - 0.1, TOP_Y + 0.2); merlon(TW.x0, TW.x1, TW.z1, TW.h); merlon(RT.x0, RT.x1, RT.z1, RT.h);
  if (near) { for (let z = ZB + 1; z < ZF - 0.5; z += 2.4) for (const x of [-13.5, 13.5]) P.box(x, TOP_Y + 0.65, z, 0.5, 0.9, 1.1, pal.stone[1], 32); }
  // clock tower: pointed slate roof, gothic windows, clock, jester
  const tcx = (TW.x0 + TW.x1) / 2; const tz = (TW.z1 - 2) / 2;
  const roofH = 4.0; const apex = [tcx, TW.h + roofH, tz];
  for (const [a, c] of [[[TW.x0 - 0.3, TW.h, TW.z1 + 0.3], [TW.x1 + 0.3, TW.h, TW.z1 + 0.3]], [[TW.x1 + 0.3, TW.h, TW.z1 + 0.3], [TW.x1 + 0.3, TW.h, -2.3]], [[TW.x1 + 0.3, TW.h, -2.3], [TW.x0 - 0.3, TW.h, -2.3]], [[TW.x0 - 0.3, TW.h, -2.3], [TW.x0 - 0.3, TW.h, TW.z1 + 0.3]]]) P.tri(a, c, apex, pal.roof);
  P.tube([tcx, TW.h + roofH, tz], [tcx, TW.h + roofH + 1.4, tz], 0.06, 0xcfd3d6, { sides: 3, flat: true }); P.tri([tcx, TW.h + roofH + 1.4, tz], [tcx + 1.1, TW.h + roofH + 1.2, tz], [tcx, TW.h + roofH + 0.9, tz], 0x15151a);
  P.box(tcx, TW.h + 0.1, tz, TW.x1 - TW.x0 + 0.7, 0.3, TW.z1 + 2.7, pal.stone[2], 32);
  const win = (x, y, z, w, h, side) => { // gothic window on a z face (side = 0) or an x face
    const q = (u, v) => (side === 0 ? [x + u, y + v, z] : [x, y + v, z + u]);
    P.quad(q(-w / 2 - 0.12, -0.12), q(w / 2 + 0.12, -0.12), q(w / 2 + 0.12, h), q(-w / 2 - 0.12, h), 0xcfc8b8);
    G.quad(q(-w / 2, 0), q(w / 2, 0), q(w / 2, h), q(-w / 2, h), 0x3a4a58); G.tri(q(-w / 2, h), q(w / 2, h), q(0, h + w * 0.8), 0x3a4a58);
    P.tri(q(-w / 2 - 0.12, h), q(w / 2 + 0.12, h), q(0, h + w * 0.8 + 0.14), 0xcfc8b8); G.tri(q(-w / 2, h), q(w / 2, h), q(0, h + w * 0.8), 0x3a4a58);
    P.box(...(side === 0 ? [x, y + h * 0.5, z + 0.01, 0.06, h, 0.04] : [x + 0.01, y + h * 0.5, z, 0.04, h, 0.06]), 0xcfc8b8, 0);
  };
  win(tcx, 5.4, TW.z1 + 0.04, 1.4, 2.6, 0); win(tcx, 9.4, TW.z1 + 0.04, 1.2, 1.6, 0); if (near) { win(TW.x1 + 0.04, 6.0, 3.0, 1.2, 2.2, 1); win(TW.x1 + 0.04, 10.4, 3.0, 1.0, 1.4, 1); }
  const clk = [tcx, 12.6, TW.z1 + 0.08];
  P.fan(clk, [1.5, 0, 0], [0, 1.5, 0], 0x15151a, 20); P.fan([clk[0], clk[1], clk[2] + 0.02], [1.32, 0, 0], [0, 1.32, 0], 0xf4f0e0, 20);
  for (let q = 0; q < 12; q++) { const a = (q / 12) * Math.PI * 2; P.box(clk[0] + Math.sin(a) * 1.12, clk[1] + Math.cos(a) * 1.12, clk[2] + 0.05, 0.1, 0.1, 0.03, 0x15151a, 0); }
  P.quad([clk[0] - 0.05, clk[1], clk[2] + 0.05], [clk[0] + 0.05, clk[1], clk[2] + 0.05], [clk[0] + 0.05, clk[1] + 0.95, clk[2] + 0.05], [clk[0] - 0.05, clk[1] + 0.95, clk[2] + 0.05], 0x15151a);
  P.quad([clk[0], clk[1] - 0.05, clk[2] + 0.06], [clk[0] + 0.7, clk[1] - 0.05, clk[2] + 0.06], [clk[0] + 0.7, clk[1] + 0.05, clk[2] + 0.06], [clk[0], clk[1] + 0.05, clk[2] + 0.06], 0x15151a);
  if (near) jester(b, tcx + 1.6, 7.4, TW.z1 + 0.35, pal);
  // right turret: crenellated, with the giant hand reaching out over the roof
  const rcx = (RT.x0 + RT.x1) / 2;
  P.box(rcx, RT.h + 0.1, (RT.z1 - 2) / 2, RT.x1 - RT.x0 + 0.6, 0.3, RT.z1 + 2.6, pal.stone[2], 32);
  win(rcx, 5.6, RT.z1 + 0.04, 1.2, 2.2, 0);
  hand(b, 11.6, 13.0, 1.2, -1.15, pal, near, gold);
  // ground floor: arched entry with doors, the ramp, the wide cart gate, ticket booth
  const ax = -1.25; const aw = 3.4;
  P.box(ax, 1.9, ZF + 0.05, aw + 0.9, 3.6, 0.1, pal.stone[2], 0);
  P.quad([ax - aw / 2, 0.3, ZF + 0.12], [ax + aw / 2, 0.3, ZF + 0.12], [ax + aw / 2, 3.2, ZF + 0.12], [ax - aw / 2, 3.2, ZF + 0.12], 0x1a1210);
  P.fan([ax, 3.2, ZF + 0.12], [aw / 2, 0, 0], [0, 0.9, 0], 0x1a1210, 14);
  for (const sx of [-1, 1]) { P.quad([ax + sx * 0.02, 0.35, ZF + 0.16], [ax + sx * (aw / 2 - 0.1), 0.35, ZF + 0.16], [ax + sx * (aw / 2 - 0.1), 3.1, ZF + 0.16], [ax + sx * 0.02, 3.1, ZF + 0.16], pal.wood); if (near) for (let q = 0; q < 5; q++) P.box(ax + sx * (0.2 + q * 0.3), 1.7, ZF + 0.18, 0.04, 2.7, 0.03, 0x2a1a12, 0); }
  P.box(ax, 3.55, ZF + 0.14, aw + 0.8, 0.28, 0.26, trim, 0);
  for (const sx of [-1, 1]) { P.box(ax + sx * (aw / 2 + 0.3), 1.9, ZF + 0.14, 0.3, 3.4, 0.3, pal.stone[1], 0); skull(b, ax + sx * (aw / 2 + 0.3), 3.9, ZF + 0.3, 1.0, near); }
  // the wide ground gate for the carts
  const gx = (G_OUT + G_IN) / 2; const gw = 4.2;
  P.quad([gx - gw / 2, 0.3, ZF + 0.1], [gx + gw / 2, 0.3, ZF + 0.1], [gx + gw / 2, 2.6, ZF + 0.1], [gx - gw / 2, 2.6, ZF + 0.1], 0x120c0c);
  P.fan([gx, 2.6, ZF + 0.1], [gw / 2, 0, 0], [0, 0.7, 0], 0x120c0c, 12);
  P.box(gx, 3.45, ZF + 0.14, gw + 0.6, 0.26, 0.26, trim, 0);
  // the ramp up to the entry door
  const rw = 3.6; const r0 = ax - rw / 2; const r1 = ax + rw / 2;
  P.quad([r0, 0.3, 8.2], [r1, 0.3, 8.2], [r1, 1.12, 4.7], [r0, 1.12, 4.7], 0x9a958a);
  P.box(ax, 0.7, 3.65, rw + 0.6, 0.84, 2.1, pal.stone[1], 32);
  for (const sx of [-1, 1]) { const xs = ax + sx * (rw / 2 + 0.05); P.quad([xs, 0.3, 8.2], [xs, 0.3, 4.7], [xs, 1.12, 4.7], [xs, 0.3, 4.7], pal.stone[1]); }
  if (near) { for (const sx of [-1, 1]) { const xs = ax + sx * (rw / 2 + 0.2); P.tube([xs, 0.3 + 1.0, 8.2], [xs, 1.12 + 1.0, 4.7], 0.04, 0x8a9096, { sides: 4, flat: true }); P.tube([xs, 0.3 + 0.5, 8.2], [xs, 1.12 + 0.5, 4.7], 0.03, 0x8a9096, { sides: 3, flat: true }); for (let q = 0; q < 6; q++) { const f = q / 5; const z = lerp(8.2, 4.7, f); P.tube([xs, lerp(0.3, 1.12, f), z], [xs, lerp(0.3, 1.12, f) + 1.0, z], 0.03, 0x8a9096, { sides: 3, flat: true }); } } }
  P.box(ax, 0.56, 8.35, rw + 0.6, 0.55, 0.3, pal.stone[1], 0);
  ticketBooth(b, 4.3, 5.4, 0, { booth: pal.stone[0], boothRoof: pal.roof, trim, sign: pal.sign, bulb: pal.bulb }, level, near, level >= 2);
  // balcony: slab on corbels, stone balustrade, skulls, gargoyle
  const bz0 = ZF; const bz1 = 4.45;
  P.box(1.0, BAL_Y - 0.12, (bz0 + bz1) / 2, 19.6, 0.24, bz1 - bz0, pal.stone[2], 0);
  if (near) for (let x = -7.8; x <= 10.0; x += 1.8) P.box(x, BAL_Y - 0.55, bz0 + 0.45, 0.4, 0.6, 0.8, pal.stone[1], 0);
  P.box(1.0, BAL_Y + 0.95, bz1 - 0.1, 19.4, 0.16, 0.34, pal.stone[2], 0); P.box(1.0, BAL_Y + 0.1, bz1 - 0.1, 19.4, 0.16, 0.3, pal.stone[2], 0);
  for (let x = -8.2; x <= 10.4; x += (near ? 0.6 : 1.8)) P.box(x, BAL_Y + 0.52, bz1 - 0.1, 0.2, 0.84, 0.2, pal.stone[0], 0);
  for (const x of [-8.3, -3.9, 1.6, 5.3, 10.2]) { P.box(x, BAL_Y + 0.65, bz1 - 0.1, 0.45, 1.2, 0.45, pal.stone[1], 0); skull(b, x, BAL_Y + 1.5, bz1 - 0.05, 1.0, near); }
  // gargoyle
  b.place([-6.0, BAL_Y + 0.1, 3.4], 0.2);
  P.box(0, 0.45, 0, 0.9, 0.9, 0.7, 0xe08a22, 0); P.sphere([0, 1.1, 0.1], 0.35, 0xe08a22, 8, 6); for (const sx of [-1, 1]) { P.tri([sx * 0.3, 0.9, -0.1], [sx * 1.5, 1.7, -0.3], [sx * 0.9, 0.3, -0.2], 0xc86a14); P.tri([sx * 0.2, 1.4, 0.1], [sx * 0.35, 1.9, 0.1], [sx * 0.1, 1.45, 0.1], 0xe08a22); }
  P.sphere([0, 1.12, 0.4], 0.14, 0xe0c060, 6, 4);
  b.pop();
  // airbrushed panels between the doors, door frames for the carts
  mural(b, -8.0, -4.5, 5.55, 9.0, ZF + 0.04, 0, pal, near); mural(b, -1.5, 4.8, 5.55, 9.0, ZF + 0.04, 1, pal, near); mural(b, 8.0, 10.1, 5.55, 9.0, ZF + 0.04, 2, pal, near);
  for (const x of [U1X, U2X]) { P.quad([x - 0.85, BAL_Y, ZF + 0.07], [x + 0.85, BAL_Y, ZF + 0.07], [x + 0.85, BAL_Y + 2.1, ZF + 0.07], [x - 0.85, BAL_Y + 2.1, ZF + 0.07], 0x0a0606); P.fan([x, BAL_Y + 2.1, ZF + 0.07], [0.85, 0, 0], [0, 0.45, 0], 0x0a0606, 10); P.box(x - 0.95, BAL_Y + 1.1, ZF + 0.08, 0.16, 2.2, 0.12, trim, 0); P.box(x + 0.95, BAL_Y + 1.1, ZF + 0.08, 0.16, 2.2, 0.12, trim, 0); P.box(x, BAL_Y + 2.62, ZF + 0.08, 2.1, 0.14, 0.12, trim, 0); }
  dragon(b, 9.3, BAL_Y + 0.7, 3.4, pal, near, gold);
  // the cart track where it is outside (balcony + apron)
  const outs = []; const list = sp.resample({ maxStep: near ? 0.8 : 1.6, maxAngle: 0.25, minStep: 0.3 });
  const frames = sp.frames(list); let seg = [];
  for (const f of frames) { if (f.p[2] > 2.3) seg.push(f); else { if (seg.length > 1) outs.push(seg); seg = []; } }
  if (seg.length > 1) outs.push(seg);
  for (const s of outs) { rails(P, s, { gauge: 0.8, w: 0.1, h: 0.1, y: -0.12, col: 0x8a9096, side: 0x6a7076 }); girder(P, s, { w: 1.1, h: 0.06, y: -0.12, top: 0x2a2a2e, side: 0x2a2a2e }); }
  // L2: lit roof sign on a frame, bulbs, flags; L3: LED outlines, smoke handled by the dynamic parts, ivy; L4: gold trim
  if (level >= 2) {
    for (const x of [-5.5, 7.5]) P.tube([x, TOP_Y, ZF - 0.5], [x, TOP_Y + 3.4, ZF - 0.5], 0.12, 0x2a2a2e, { sides: 4, flat: true });
    const sy = TOP_Y + 2.2; P.box(1.0, sy, ZF - 0.5, 15.8, 1.9, 0.18, pal.board, 0);
    pixelText(b, L, name, 1.0, sy - 0.7, ZF - 0.38, 0.2, pal.sign, { merge: !near });
    for (const x of [-6.9, 8.9]) { P.box(x, sy, ZF - 0.5, 0.2, 2.1, 0.24, trim, 0); }
    P.box(1.0, sy + 1.05, ZF - 0.5, 16.0, 0.16, 0.24, trim, 0); P.box(1.0, sy - 1.05, ZF - 0.5, 16.0, 0.16, 0.24, trim, 0);
    if (near) for (let q = 0; q < 34; q++) { bulb(b, [-6.8 + q * 0.47, sy + 1.2, ZF - 0.36], 0.15, pal.bulb); bulb(b, [-6.8 + q * 0.47, sy - 1.18, ZF - 0.36], 0.15, pal.bulb); }
    for (const [x, z] of [[-13.6, 4.4], [-8.5, 4.4], [13.6, 3.8], [10.5, 3.8]]) pennant(b, x, TW.h > 12 && x < -8 ? TW.h + 0.9 : RT.h + 0.9, z, 2.2, 0xb8142a, x > 0 ? -1 : 1);
    if (near) { festoon(b, [-8.4, BAL_Y + 1.2, bz1], [10.4, BAL_Y + 1.2, bz1], 20, 0.5, pal.bulb); for (const x of [-12.6, -9.6]) bulb(b, [x, 3.0, TW.z1 + 0.2], 0.25, pal.bulb); }
  }
  if (level >= 3) {
    const lw = (x0, y0, x1, y1, z, k) => { const n0 = b.count; L.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], pal.led[k % 2]); handles.lamps.push({ s: n0, n: b.count - n0, k, kind: 'edge' }); };
    const NS = near ? 12 : 6; for (let q = 0; q < NS; q++) { const x = -8.4 + q * (18.8 / NS); lw(x, TOP_Y - 0.12, x + 18.8 / NS - 0.1, TOP_Y + 0.04, ZF + 0.08, q); lw(x, BAL_Y + 1.05, x + 18.8 / NS - 0.1, BAL_Y + 1.18, bz1 + 0.12, q + 1); }
    for (let q = 0; q < 8; q++) { lw(TW.x0 + 0.05, 1 + q * 1.6, TW.x0 + 0.17, 1 + q * 1.6 + 1.2, TW.z1 + 0.1, q); }
    if (near) for (const [x, y, z, r] of [[-13.4, 2.0, 4.0, 0.6], [-8.8, 5.0, 4.3, 0.5], [13.4, 6.0, 3.6, 0.55], [10.6, 8.0, 3.8, 0.45], [-6.9, 9.5, 2.9, 0.5], [9.0, 9.7, 2.9, 0.4]]) P.sphere([x, y, z], r, pal.ivy, 6, 4);
  }
  if (gold) { for (const x of [-8.4, 10.4]) P.sphere([x, TOP_Y + 1.35, ZF - 0.1], 0.35, GOLD, 8, 5); P.box(1.0, BAL_Y + 1.1, bz1 + 0.05, 19.6, 0.06, 0.36, GOLD, 0); }
  return handles;
}
/** a small pale wraith silhouette (a handful of flat triangles, vertex-coloured): the walk-mode figure waving from the clock-tower window */
function wraithGeo(T) {
  const p = []; const c = [];
  const push = (v, col) => { p.push(v[0], v[1], v[2]); c.push(((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255); };
  const tri = (a, b, d, col) => { push(a, col); push(b, col); push(d, col); };
  const sheet = 0xf0eefc; const dark = 0x14101c;
  tri([0, 1.1, 0], [-0.35, 0, 0.05], [0.35, 0, 0.05], sheet);
  tri([0, 1.1, 0], [0.35, 0, 0.05], [0, 0.3, -0.15], sheet);
  tri([0, 1.1, 0], [0, 0.3, -0.15], [-0.35, 0, 0.05], sheet);
  tri([-0.1, 0.95, 0.12], [0.1, 0.95, 0.12], [0, 0.8, 0.14], dark);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(p), 3)); g.setAttribute('color', new T.BufferAttribute(new Float32Array(c), 3));
  g.computeBoundingSphere();
  return g;
}
/** W8 "Ghost wave": one animated figure waving from the clock-tower window, and the ground-gate doors banging open and shut on a loop, in walk mode
 *  (the player's own ride brings a much richer interior of its own; this is only what the facade shows from the outside while nobody is riding). */
function buildExtras(near, root, T, period) {
  if (!near) return null;
  const waver = new T.Mesh(wraithGeo(T), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false }));
  const tcx = (TW.x0 + TW.x1) / 2; waver.position.set(tcx, 9.65, TW.z1 + 0.28); waver.name = 'geister-waver'; root.add(waver);
  const gx = (G_OUT + G_IN) / 2; const gw = 4.2; const leaves = [];
  for (const sd of [-1, 1]) {
    const piv = new T.Group(); piv.position.set(gx + sd * gw / 2, 1.45, ZF + 0.16);
    const mesh = new T.Mesh(new T.BoxGeometry(gw / 2, 2.3, 0.08), new T.MeshBasicMaterial({ color: 0x1a1210, fog: false }));
    mesh.position.set(-sd * gw / 4, 0, 0); piv.add(mesh); root.add(piv); leaves.push({ piv, sd });
  }
  const bangEvery = Math.max(2.2, (period || 10) / 4);
  return {
    update(t, dt, k) {
      waver.rotation.z = Math.sin(t * 1.4) * 0.22; waver.position.y = 9.65 + Math.sin(t * 0.9) * 0.12;
      waver.material.color.setScalar(0.5 + 0.5 * k);
      const ph = ((t % bangEvery) / bangEvery); const ang = Math.max(0, Math.sin(ph * Math.PI * 2)) * 1.3;
      leaves.forEach(l => { l.piv.rotation.y = (l.sd > 0 ? 1 : -1) * ang; });
    },
  };
}
function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) { const w = (((t * 1.2 - h.k / 10) % 1) + 1) % 1; const f = 0.3 + 0.7 * Math.pow(1 - w, 2); const c = handles.led[h.k % 2]; K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]); }
}

/* ------------------------------------------------------------------------------------------------------------------ model */
function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const sp = makeSpline(geisterControls(), { step: 0.12 });
  const run = makeRun(sp, { vConst: 2.1, dwell: 0 });
  const name = nameOf('geister', opts.lang);
  const NC = 4; const SMOKE = level >= 3 ? 6 : 0;
  const smoke = { cars: SMOKE, spacing: 0, shift: 0, custom: (j, t, m) => {
    const age = (((t / 5 + j / SMOKE) % 1) + 1) % 1; const sc = 0.3 + age * 1.5; const x = 9.2 + Math.sin(j * 2.1 + age * 2) * 1.2; const z = 4.2 + age * 2.2 + Math.cos(j * 1.7) * 0.5; const y = 1.2 + age * 3.2;
    if (age > 0.96) return false; m.makeScale(sc, sc * 0.8, sc); m.setPosition(x, y, z); return true; } };
  const g = buildTrackRide({
    id: 'geister', T, K, sp, run, quality, look, level, footprint: { x: 14.0, zMin: -8.1, zMax: 8.5 }, height: 19.6, carRadius: 30, eyeOffset: [0, 1.3, 0.4], lodDistance: 80,
    trains: [...Array.from({ length: NC }, (_, i) => ({ cars: 1, spacing: 0, shift: (i * run.period) / NC, lift: 0.18, hide: (s, k, j, f) => f.p[2] < 1.2 })), ...(SMOKE ? [smoke] : [])],
    buildStatic: (b, near) => buildStatic(b, cfg, near, sp, name),
    buildCar: (b, near, ti, j) => { if (ti < NC) buildCart(b, near, pal); else b.P.sphere([0, 0, 0], 0.5, 0xb8b4b0, 7, 5); },
    extras: (near, root) => buildExtras(near, root, T, run.period),
    chase,
  });
  // carts inside the building are hidden: a cart is visible while any part of it is in front of the facade plane
  const trains = g.userData; trains.visibleAt = (t, i) => { const f = sp.at(run.sAt(t, (i * run.period) / NC)); return f.p[2] > 1.8; };
  return g;
}

export const MODELS = { geister: { build } };
export default MODELS;
