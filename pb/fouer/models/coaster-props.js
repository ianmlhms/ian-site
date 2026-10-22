/* Schueberfouer Tycoon, W4b: small props shared by the coaster / flume / hall models (booths, queue rails, lit lettered signs, columns, Hämmi).
 * All of them draw into a big-kit builder (merged, one draw call); `near` switches the detail.  No real ride, brand or showman names: the lettering is the
 * generic Luxembourgish ride name (lang lb | de | en). */
import { lerp, bulb, glassWin, pixelText, pixelTextWidth, sheep } from './big-kit.js';

export const GOLD = 0xf0c24a;
export const STEEL = 0xb9bec2;
export const DARK = 0x3a3f44;
export const WOOD = 0xb89463;
export const TAU = Math.PI * 2;

/** the generic names on the signs (DESIGN 3.1: lb / de / en) */
export const NAMES = {
  maus: { lb: 'WËLL MAUS', de: 'WILDE MAUS', en: 'WILD MOUSE' },
  looping: { lb: 'LOOPING-BUNN', de: 'LOOPING-BAHN', en: 'LOOPING' },
  alpina: { lb: 'ALPEBUNN', de: 'ALPENBAHN', en: 'ALPINE' },
  splash: { lb: 'WAASSERBUNN', de: 'WILDWASSER', en: 'LOG FLUME' },
  geister: { lb: 'GEESCHTERBUNN', de: 'GEISTERBAHN', en: 'GHOST TRAIN' },
  scooter: { lb: 'AUTOSCOOTER', de: 'AUTOSCOOTER', en: 'BUMPER CARS' },
  tent: { lb: 'BIERZELT', de: 'BIERZELT', en: 'BEER TENT' },
};
export const nameOf = (id, lang) => (NAMES[id] && (NAMES[id][lang] || NAMES[id].lb)) || id.toUpperCase();

/** a lit lettered sign: dark board, bulb frame, dot-matrix text.  Centre (x, y), width w; faces +z (turn with b.place).  pal: { board, trim, sign (lamp rgb), bulb (lamp rgb) } */
export function litSign(b, x, y, z, w, h, text, pal, o = {}) {
  const P = b.P; const L = b.L; const near = o.near !== false; const gold = o.gold;
  P.box(x, y, z, w, h, 0.22, pal.board === undefined ? 0x2a2236 : pal.board, 0);
  P.box(x, y + h / 2 + 0.07, z + 0.02, w + 0.3, 0.14, 0.3, gold ? GOLD : pal.trim, 0); P.box(x, y - h / 2 - 0.07, z + 0.02, w + 0.3, 0.14, 0.3, gold ? GOLD : pal.trim, 0);
  P.box(x - w / 2 - 0.07, y, z + 0.02, 0.14, h + 0.28, 0.3, gold ? GOLD : pal.trim, 0); P.box(x + w / 2 + 0.07, y, z + 0.02, 0.14, h + 0.28, 0.3, gold ? GOLD : pal.trim, 0);
  const tw = pixelTextWidth(text, 1); const dot = Math.min((h * 0.62) / 7, (w - 0.9) / tw);
  pixelText(b, L, text, x, y - dot * 3.5, z + 0.13, dot, pal.sign, { merge: !near || o.merge, fill: near ? 0.8 : 0.9 });
  if (near && o.bulbs !== false) {
    const n = Math.max(4, Math.round(w / 0.45));
    for (let q = 0; q <= n; q++) { const bx = x - w / 2 + (w * q) / n; bulb(b, [bx, y + h / 2 - 0.22, z + 0.14], 0.14, pal.bulb); bulb(b, [bx, y - h / 2 + 0.08, z + 0.14], 0.14, pal.bulb); }
  }
}

/** ticket booth, window toward +z of its own frame (b.place) */
export function ticketBooth(b, x, z, ry, pal, level, near, big) {
  const P = b.P; const L = b.L; const gold = level >= 4;
  b.place([x, 0.3, z], ry);
  P.box(0, 1.25, 0, 2.6, 2.5, 2.2, pal.booth, 32 | 16); P.box(0, 2.6, 0, 3.1, 0.2, 2.7, pal.boothRoof, 32); P.box(0, 2.95, 0, 2.1, 0.5, 1.7, pal.boothRoof, 32);
  glassWin(b, [-0.8, 1.25, 1.11], [0.8, 1.25, 1.11], 0.8);
  P.box(0, 0.86, 1.3, 1.9, 0.1, 0.4, gold ? GOLD : pal.trim, 0);
  for (let q = 0; q < 7; q++) { const x0 = -1.05 + q * 0.3; P.quad([x0, 2.35, 1.12], [x0 + 0.3, 2.35, 1.12], [x0 + 0.3, 1.95, 1.62], [x0, 1.95, 1.62], q % 2 ? 0xf6f1e4 : pal.boothRoof); }
  if (near) for (let q = 0; q < 8; q++) bulb(b, [-1.2 + q * 0.34, 2.72, 1.42], 0.18, pal.bulb);
  if (big) { P.box(0, 3.6, 0.6, 2.4, 0.8, 0.12, gold ? GOLD : pal.trim, 0); L.quad([-1.0, 3.3, 0.67], [1.0, 3.3, 0.67], [1.0, 3.9, 0.67], [-1.0, 3.9, 0.67], pal.sign); }
  b.pop();
}

/** switchback queue rails: rows at z = zs, from x0 to x1 */
export function queueRails(b, x0, x1, zs, trim) {
  const P = b.P;
  zs.forEach((z, r) => {
    const a = r % 2 === 0 ? x0 : x0 + 2.0; const c = r % 2 === 0 ? x1 - 2.0 : x1;
    for (const y of [0.55, 1.0]) P.tube([a, y + 0.3, z], [c, y + 0.3, z], 0.035, trim, { sides: 4, flat: true });
    for (let x = a; x <= c + 0.01; x += 1.6) P.tube([x, 0.3, z], [x, 1.38, z], 0.04, DARK, { sides: 4, flat: true });
  });
}

/** a column from (x, y0, z) to (x, y1, z): a lime / white tube or, for tall ones in `lattice` mode, a 3-chord lattice */
export function column(b, x, y0, z, y1, r, col, sides = 6) { b.P.tube([x, y0, z], [x, y1, z], r, col, { sides, flat: sides <= 6 }); }

/** a gold collar on a vertical tube (L4) */
export function collar(b, x, y, z, r, h = 0.22) { b.P.tube([x, y - h / 2, z], [x, y + h / 2, z], r * 1.22, GOLD, { sides: 8 }); }

/** Hämmi on a plinth (re-export of big-kit's sheep so the models import one place) */
export const hammi = sheep;

/** a short sag of lit bulbs hung between two points (placed on a quad of bulbs) */
export function bulbLine(b, p, q, n, col, size = 0.18) { for (let i = 0; i <= n; i++) { const f = i / n; bulb(b, [lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f)], size, col); } }

/** the standard colour of a lamp chase: base colour scaled by a travelling wave */
export const waveFx = (c, w) => [c[0] * w, c[1] * w, c[2] * w];

/** a flat coloured patch on the pad (lawn, flower bed, path): corners (x0, z0) .. (x1, z1) at height y */
export function patch(b, x0, z0, x1, z1, col, y = 0.312) { b.P.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], col); }
