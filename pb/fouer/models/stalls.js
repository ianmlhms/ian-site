/* Schueberfouer Tycoon, W3: food and game stalls (S and M items), the old-park kiosk and the Hämmi statue.  Contract: see index.js.
 * Every model: platform + body + canopy + signage, Look palettes (Traditioun / Neon / Retro), 4 visible levels:
 *   L1 plain, white bulbs   L2 lit sign + string lights + flags + a second counter / booth   L3 chasing LED outline, figures, forecourt with railings, steam
 *   L4 Gold trim (gilt frame, finials, gold LED, gold counter top).  Names are the generic i18n names (lb); no real brand or showman name appears anywhere.
 * Footprint: S items stay inside 8 x 8 m (x in +-4, z in +-4), M items inside 16 x 16; the front (+z) faces the alley. */
import { Builder, makeCtx, col, mix, shade, C, GOLD, FIG_COLS, dressEdge, dressForecourt, lerp, TAU } from './kit.js';
import { STRINGS } from '../i18n.js';

export const MODELS = {};
const nameOf = (id, lang) => (STRINGS[lang] || STRINGS.lb)['item.' + id] || id;

/* ------------------------------------------------------------------ shared pieces */
export function begin(id, opts) {
  const ctx = makeCtx(opts, id);
  const b = new Builder({ seed: ctx.seed * 31 + id.length, rnd: ctx.rnd, far: ctx.far });
  ctx.name = nameOf(id, opts.lang || 'lb');
  ctx.metal = ctx.L4 ? GOLD : C.steel;
  return { b, ctx };
}
export function end(b, ctx, size, height, extra = {}) { return b.finish(Object.assign({ id: ctx.id, look: ctx.look, level: ctx.level, size, height }, extra)); }

/** the main painted fascia sign (lit from L2, gilt frame at L4) centred at x,y,z */
export function fascia(b, ctx, text, x, y, z, w, h, o = {}) {
  b.sign(text, x, y, z, w, h, { look: ctx.look, lit: ctx.L2, frame: ctx.L4 ? GOLD : (o.frame === undefined ? ctx.pal.dark : o.frame), kind: o.kind || 'main', frameW: ctx.L4 ? 0.12 : 0.08, style: o.styles ? o.styles[ctx.look] : undefined });
}
/** a low deck with a skirt that reaches below the sloping asphalt */
export function deck(b, ctx, x, z, w, d, top, o = {}) {
  b.box(x, -0.5, z, w, 0.64, d, o.skirt || 0x2f2f35, { cols: { top } });
  if (o.plate !== false) b.box(x, 0.14, z, w - 0.1, 0.03, d - 0.1, o.plateColor || C.plate, { noFront: true, noBack: true });
}
/** counter: body, metal top, X-braced trestle front */
export function counter(b, ctx, x, z, w, d, h, body, top, o = {}) {
  b.box(x, 0.14, z, w, h - 0.14, d, body);
  b.box(x, h, z, w + 0.12, 0.07, d + 0.14, top);
  if (o.braces !== false && !b.far) {
    const n = Math.max(2, Math.round(w / 1.5)); const zf = z + d / 2 + 0.02;
    for (let i = 0; i < n; i++) { const cx = x - w / 2 + (i + 0.5) * w / n; b.beam([cx - 0.5, 0.2, zf], [cx + 0.5, h - 0.1, zf], 0.07, o.brace || C.black); b.beam([cx + 0.5, 0.2, zf], [cx - 0.5, h - 0.1, zf], 0.07, o.brace || C.black); }
  }
}
export function staff(b, ctx, xs, z, o = {}) { xs.forEach((x) => b.figure(x, z, 0, { body: o.vest !== undefined ? o.vest : (ctx.look === 1 ? 0x2a2a46 : 0xf06a1e), hat: o.hat === undefined ? 0xf4f0e6 : o.hat, legs: 0x2a2a30, y: o.y || 0.14 })); }
export function posts(b, xs, z, h, color, r = 0.07, y0 = 0.1) { xs.forEach((x) => b.cyl(x, y0, z, r, r, h, 5, color)); }
/** a hanging wooden plate on two chains */
export function hanging(b, ctx, text, x, yTop, z, w, h, chain = 0.35, o = {}) {
  b.wire([x - w * 0.35, yTop, z], [x - w * 0.35, yTop - chain, z], 0.03, 0x222222); b.wire([x + w * 0.35, yTop, z], [x + w * 0.35, yTop - chain, z], 0.03, 0x222222);
  b.sign(text, x, yTop - chain - h / 2, z, w, h, { look: o.look === undefined ? ctx.look : o.look, kind: 'plate', lit: ctx.L2, frame: ctx.L4 ? GOLD : C.darkWood, frameW: 0.06 });
}
/** string lights across the forecourt (L2+): two poles + a drooping bulb line */
export function forecourtStrings(b, ctx, x0, x1, z, h = 2.6) {
  if (!ctx.L2) return;
  [x0, x1].forEach((x) => b.cyl(x, 0, z, 0.05, 0.05, h, 4, C.darkSteel));
  const n = 9; let prev = null;
  for (let i = 0; i <= n; i++) { const t = i / n; const y = h - Math.sin(Math.PI * t) * 0.32; const p = [lerp(x0, x1, t), y, z]; b.bulb(p[0], p[1], p[2], ctx.bulb, 0.15); if (prev) b.wire(prev, p, 0.02, 0x222222); prev = p; }
}
/** the L2 "second booth": a little payment / ticket booth with its own roof and bulbs */
export function booth(b, ctx, x, z, o = {}) {
  const c1 = o.body || ctx.pal.main; const c2 = o.roof || ctx.pal.second;
  b.box(x, 0.14, z, 1.0, 2.0, 0.9, c1); b.box(x, 1.1, z + 0.46, 0.7, 0.55, 0.04, 0x30424e);
  b.hip(x, 2.14, z, 1.0, 0.9, 0.45, c2, { over: 0.15 });
  b.bulbRow([x - 0.5, 2.1, z + 0.62], [x + 0.5, 2.1, z + 0.62], 0.25, ctx.bulb, 0.12);
  b.box(x, 1.0, z + 0.55, 0.9, 0.06, 0.25, ctx.metal);
}
export function bin(b, x, z, c = 0x2f8f4a) { b.box(x, 0, z, 0.45, 0.8, 0.45, c); b.box(x, 0.8, z, 0.5, 0.06, 0.5, 0x222222); }
/** a sloped striped awning (fabric) from the high back edge to the low front edge, with a scalloped valance */
export function awning(b, ctx, x0, x1, yHigh, yLow, z0, z1, c1, c2, o = {}) {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / (o.stripe || 0.5)));
  for (let i = 0; i < n; i++) {
    const a = lerp(x0, x1, i / n); const bb = lerp(x0, x1, (i + 1) / n);
    b.quad([a, yLow, z1], [bb, yLow, z1], [bb, yHigh, z0], [a, yHigh, z0], i & 1 ? c2 : c1, { dbl: true });
  }
  if (o.valance !== false) b.valance([x0, yLow, z1], [x1, yLow, z1], o.vh || 0.28, Math.max(2, Math.round(n / 1)), c1, c2);
}
/** a tall teardrop "feather" banner on a pole */
export function feather(b, x, z, h, color) {
  b.cyl(x, 0.1, z, 0.04, 0.03, h, 4, 0xdddddd);
  b.poly([[x, h, z], [x + 0.2, h - 0.5, z], [x + 0.55, h - 1.5, z], [x + 0.35, h - 2.6, z], [x, h - 2.9, z]], color, { dbl: true });
}
/** the Hämmi sheep (own mascot): fluffy white wool, dark face + legs, red-white-light-blue ribbon.  Faces +z.  o.waffle puts a waffle in the hoof */
export function hammi(b, x, y, z, s = 1, o = {}) {
  const wool = 0xf8f4ec; const dark = 0x4a4242;
  b.push().translate(x, y, z).scale(s);
  [[-0.3, 0.24], [0.3, 0.24], [-0.3, -0.24], [0.3, -0.24]].forEach(([lx, lz]) => b.cyl(lx, 0, lz, 0.075, 0.06, 0.46, 5, dark));
  b.sphere(0, 0.82, 0, 0.5, wool, { sy: 0.85, seg: 7 }); b.sphere(-0.26, 0.9, 0.12, 0.34, wool, { seg: 6 }); b.sphere(0.26, 0.9, 0.12, 0.34, wool, { seg: 6 });
  b.sphere(0, 1.02, -0.2, 0.36, wool, { seg: 6 }); b.sphere(0, 1.0, 0.3, 0.3, wool, { seg: 6 });
  b.sphere(0, 1.08, 0.62, 0.2, 0xf1e3d2, { sy: 1.1, seg: 6 }); b.sphere(0, 1.25, 0.58, 0.19, wool, { seg: 5 });
  b.blob(-0.2, 1.12, 0.6, 0.12, 0.05, 0.07, dark); b.blob(0.2, 1.12, 0.6, 0.12, 0.05, 0.07, dark);
  b.sphere(-0.075, 1.12, 0.78, 0.035, 0x111111, { seg: 4 }); b.sphere(0.075, 1.12, 0.78, 0.035, 0x111111, { seg: 4 }); b.sphere(0, 1.04, 0.82, 0.04, 0xe8758a, { seg: 4 });
  b.cyl(0, 0.86, 0.42, 0.28, 0.24, 0.07, 8, 0xc8283a, { cap: true }); b.cyl(0, 0.93, 0.42, 0.24, 0.22, 0.07, 8, 0xf8f8f8); b.cyl(0, 1.0, 0.42, 0.22, 0.2, 0.07, 8, 0x7fc4ec);
  if (o.crown) { b.cyl(0, 1.42, 0.58, 0.17, 0.2, 0.1, 6, 0xe6b13a); for (let i = 0; i < 5; i++) { const a = TAU * i / 5; b.cone(Math.sin(a) * 0.17, 1.5, 0.58 + Math.cos(a) * 0.17, 0.05, 0.13, 4, 0xe6b13a); } }
  if (o.waffle) { b.push().translate(0.36, 0.7, 0.62).rotX(-0.9); b.cyl(0, 0, 0, 0.3, 0.3, 0.07, 8, 0xd49a4a, { alt: [0xd49a4a, 0xbd7f33], cap: true, capColor: 0xe6b564 }); b.pop(); b.cyl(0.3, 0.55, 0.5, 0.05, 0.05, 0.28, 4, wool); }
  b.pop();
}
/** a plush toy: coloured blob with ears */
export function plush(b, x, y, z, color, s = 0.2) { b.blob(x, y, z, s, s * 1.1, s * 0.85, color); b.blob(x - s * 0.5, y + s * 1.0, z, s * 0.28, s * 0.35, s * 0.2, color); b.blob(x + s * 0.5, y + s * 1.0, z, s * 0.28, s * 0.35, s * 0.2, color); }
const PLUSH = [0xee6fa8, 0xf4c430, 0x41c4d8, 0x8a5bc8, 0xf08a2a, 0x7ad06a, 0xd8433a, 0xffffff];
/** barrel-vault fascia: a quarter round from (yLow, zFront) up and back to (yHigh, zBack) along x0 -> x1 */
export function vault(b, x0, x1, yLow, zFront, r, color, o = {}) {
  const n = b.far ? 3 : 6; const yc = yLow; const zc = zFront - r;
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI / 2; const t1 = ((i + 1) / n) * Math.PI / 2;
    const p = (x, t) => [x, yc + Math.sin(t) * r * (o.ry || 1), zc + Math.cos(t) * r];
    b.quad(p(x0, t0), p(x1, t0), p(x1, t1), p(x0, t1), i & 1 && o.alt ? o.alt : color, { dbl: !!o.dbl });
  }
}

const SANS = '"Arial Black","Helvetica Neue",Arial,sans-serif'; const SERIF = 'Georgia,"Times New Roman",serif';
const KACHEL_STYLE = [{ bg: '#fff9ee', bg2: '#fdeed0', fg: '#e8501e', stroke: '#ffffff', strokeW: 5, font: SANS, italic: true, border: '#e8501e' }];
const CIRCUS_STYLE = [{ bg: '#fffdf2', bg2: '#fff0c4', fg: '#ffd21f', stroke: '#1d3fa8', strokeW: 7, shadow: '#d8283a', font: SANS, border: '#d8283a' }, { bg: '#1a0a3a', bg2: '#2a1060', fg: '#ff5ad0', stroke: '#41e8ff', strokeW: 4, font: SANS, glow: '#ff3fc8' }, { bg: '#ffffff', bg2: '#dbe9fb', fg: '#ffd21f', stroke: '#1d58b4', strokeW: 7, shadow: '#c8283a', font: SANS, border: '#1d58b4' }];
const ZOCKER_STYLE = [{ bg: '#e7a0ea', bg2: '#c070d8', fg: '#ff4f9e', stroke: '#fff0fa', strokeW: 4, font: SANS, glow: '#ff2f8a', border: '#f4c430' }];
const MANDEL_STYLE = [{ bg: '#17583f', bg2: '#0d3a2a', fg: '#e5202e', stroke: '#ffe9c8', strokeW: 4, font: SERIF, italic: true, border: '#d6a436' }, { bg: '#1a0a3a', bg2: '#22103f', fg: '#ff6a6a', stroke: '#ffffff', strokeW: 3, font: SERIF, italic: true, glow: '#ff3a3a' }, { bg: '#1f5fb8', bg2: '#163f80', fg: '#e5202e', stroke: '#ffffff', strokeW: 5, font: SERIF, italic: true }];
const SIGN_STAR = (ctx) => (ctx.look === 1 ? 0xff3fc8 : ctx.look === 2 ? 0x2d6fd0 : 0xd6a436);

/* ------------------------------------------------------------------ kachel: Gromperekichelcher (S) */
MODELS.kachel = { build(opts) {
  const { b, ctx } = begin('kachel', opts); const P = ctx.pal; const W = ctx.L2 ? 5.5 : 5.2; const D = 3.4; const zc = -1.9; const yc = 2.45;
  deck(b, ctx, 0, -0.9, W + 0.5, 6.2, ctx.look === 1 ? 0x1a1430 : 0x5a4636);
  b.box(0, 0.14, zc - D / 2 + 0.1, W, 2.4, 0.18, P.dark, { cols: { front: shade(P.dark, 1.3) } });
  [-1, 1].forEach((s) => b.box(s * (W / 2 - 0.08), 0.14, zc, 0.16, 2.3, D - 0.2, P.dark));
  for (let i = 0; i < 4; i++) { b.box(-1.8 + i * 1.2, 1.45, zc - D / 2 + 0.35, 0.8, 0.05, 0.3, C.lightWood); b.box(-1.8 + i * 1.2, 1.5, zc - D / 2 + 0.35, 0.35, 0.28, 0.25, i & 1 ? C.red : 0xf2e4b0); }
  // timber ceiling + low roof; the fascia board stands in FRONT of the eave
  const zf = zc + D / 2 + 0.5;
  b.box(0, yc, zc + 0.3, W + 0.4, 0.1, D + 0.9, P.dark);
  b.gable(0, yc + 0.1, zc + 0.3, W + 0.4, D + 0.9, 0.5, ctx.look === 0 ? 0x5a3a28 : P.main, { under: P.dark, over: 0.15, back: ctx.look === 0 ? 0x4a2f1e : undefined });
  [-1, 0, 1].forEach((k) => b.box(k * W * 0.38, yc - 0.1, zc + 0.3, 0.14, 0.12, D + 0.8, 0x2f1d12));
  posts(b, [-W / 2 - 0.05, W / 2 + 0.05], zf, 2.45, 0x2f1d12, 0.09);
  fascia(b, ctx, ctx.name, 0, yc + 0.72, zf + 0.05, W * 0.9, 0.84, { styles: KACHEL_STYLE });
  [zf - 0.2, zf - 0.7, zf - 1.2, zf - 1.7, zf - 2.2].forEach((z) => b.bulbRow([-W / 2 + 0.2, yc - 0.1, z], [W / 2 - 0.2, yc - 0.1, z], 0.22, ctx.bulb, 0.11));
  dressEdge(b, ctx, -W / 2, W / 2, yc + 0.05, zf + 0.2, { step: 0.3, noFlags: false });
  b.valance([-W / 2 - 0.1, yc, zf + 0.25], [W / 2 + 0.1, yc, zf + 0.25], 0.32, Math.round(W / 0.45), P.awn[0], P.awn[1]);
  counter(b, ctx, 0, zf - 0.45, W - 0.3, 0.7, 0.98, ctx.look === 1 ? 0x241440 : 0x3a2a20, ctx.metal);
  [-1.5, 0.1].forEach((x) => { b.box(x, 0.98, zc + 0.5, 1.25, 0.34, 0.8, C.steel); b.box(x, 1.32, zc + 0.5, 1.1, 0.04, 0.65, 0xd99a2a); b.fx(x, 1.4, zc + 0.5, ctx.L3 ? 4 : 2, 0, { spread: 0.5 }); });
  b.box(1.8, 0.98, zc + 0.4, 0.9, 0.5, 0.7, C.darkSteel); b.box(1.8, 1.48, zc + 0.4, 0.6, 0.15, 0.5, 0xe9e0c8);
  b.sign('APFELMUS', 1.9, 1.55, zf - 0.2, 0.9, 0.24, { look: ctx.look, kind: 'banner', frameW: 0.04, frame: C.darkWood });
  hanging(b, ctx, 'Gromperekichelcher', -W / 2 + 0.7, yc - 0.02, zf + 0.35, 1.0, 0.4, 0.4);
  if (W > 5.4) hanging(b, ctx, 'Gromperekichelcher', W / 2 - 0.7, yc - 0.02, zf + 0.35, 1.0, 0.4, 0.4);
  const sun = ctx.look === 1 ? 0xff3fc8 : 0xf4c430;
  [-W / 2 - 0.05, W / 2 + 0.05].forEach((x) => { for (let i = 0; i < 7; i++) b.blob(x + (i & 1 ? 0.1 : -0.1), 0.6 + i * 0.28, zf + 0.12, 0.13, 0.13, 0.06, sun); });
  staff(b, ctx, [-1.5, 0.1, 1.7], zc + 0.55);
  b.table(-3.0, 2.2, 0.4, ctx.look === 2 ? 0x1f5fb8 : 0xb3262d, { parasol: ctx.L2 ? P.awn[0] : 0 }); b.table(2.8, 2.6, 0.4, 0xf6ead0, {});
  bin(b, 3.3, 0.9);
  if (ctx.L2) { forecourtStrings(b, ctx, -W / 2 - 0.2, W / 2 + 0.2, zf + 1.3); booth(b, ctx, -3.2, -0.3, { body: P.dark }); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.6, 3.6, 3.7); b.fx(0, 2.6, zc, 3, 0, { spread: 1.2, size: 0.4 }); b.figure(-0.8, 2.9, Math.PI); b.figure(0.4, 3.1, Math.PI); b.figure(1.3, 2.9, Math.PI); b.ledRect(-W / 2 + 0.2, yc + 0.2, W / 2 - 0.2, yc + 1.2, zf + 0.12, 0.06, ctx.led); }
  if (ctx.L4) { b.cyl(0, yc + 0.6, zc + 0.3, 0.06, 0.06, 0.9, 5, GOLD); b.sphere(0, yc + 1.6, zc + 0.3, 0.2, GOLD, { seg: 6 }); }
  return end(b, ctx, [8, 8], 4.2);
} };

/* ------------------------------------------------------------------ fritten: chips kiosk (S) */
MODELS.fritten = { build(opts) {
  const { b, ctx } = begin('fritten', opts); const P = ctx.pal; const W = 4.2; const D = 3.0; const zc = -1.2; const H = 2.4;
  deck(b, ctx, 0, -0.5, 6.4, 6.6, ctx.look === 1 ? 0x1a1430 : 0x707880);
  const wall = ctx.look === 0 ? 0xf3ecd8 : ctx.look === 1 ? 0x2a1850 : 0xfdfdf6;
  b.box(0, 0.14, zc, W, H, D, wall);
  b.box(0, 0.14, zc + D / 2 - 0.02, W + 0.1, 0.3, 0.06, P.main); b.box(0, H - 0.1, zc + D / 2 - 0.02, W + 0.1, 0.35, 0.06, P.main);
  // serving window with a lift-up awning, counter shelf
  b.box(0, 0.9, zc + D / 2 + 0.01, 3.4, 1.4, 0.04, 0x7fa6c4); b.box(0, 1.0, zc + D / 2 + 0.2, 3.7, 0.07, 0.45, ctx.metal);
  awning(b, ctx, -1.8, 1.8, 2.45, 2.05, zc + D / 2 + 0.05, zc + D / 2 + 0.95, 0xffffff, ctx.look === 1 ? 0x8a5bff : 0xc9def4, { stripe: 0.6 });
  // pyramidal roof with a wave-stripe edge
  b.hip(0, H + 0.14, zc, W, D, 1.3, ctx.look === 1 ? 0x5a2ad0 : 0x2d7fd8, { over: 0.35, alt: ctx.look === 1 ? [0x5a2ad0, 0x41e8ff] : [0x2d7fd8, 0x1f6fc8] });
  b.valance([-W / 2 - 0.35, H + 0.2, zc + D / 2 + 0.35], [W / 2 + 0.35, H + 0.2, zc + D / 2 + 0.35], 0.26, 9, 0xffffff, ctx.look === 1 ? 0x41e8ff : 0xf4a020);
  b.sphere(0, H + 1.55, zc, 0.15, ctx.L4 ? GOLD : 0xffffff, { seg: 5 });
  dressEdge(b, ctx, -W / 2 - 0.3, W / 2 + 0.3, H + 0.2, zc + D / 2 + 0.38, { step: 0.32 });
  fascia(b, ctx, ctx.name, 0, H + 0.62, zc + D / 2 + 0.42, 3.3, 0.78);
  // paper cones, sauce pumps, fryer steam
  for (let i = 0; i < 5; i++) { b.cone(-1.2 + i * 0.3, 1.1, zc + D / 2 + 0.3, 0.1, 0.24, 6, i & 1 ? 0xf6ead0 : P.main); b.sphere(-1.2 + i * 0.3, 1.38, zc + D / 2 + 0.3, 0.09, 0xf4c430, { seg: 4 }); }
  [0xc8283a, 0xf4c430, 0xf6f6f6].forEach((c, i) => b.cyl(1.0 + i * 0.22, 1.07, zc + D / 2 + 0.3, 0.07, 0.07, 0.36, 5, c));
  b.fx(-0.3, H + 0.2, zc - 0.2, ctx.L3 ? 3 : 2, 0, { spread: 0.4 });
  feather(b, -3.0, 0.3, 4.6, ctx.look === 1 ? 0x41e8ff : 0x37b36a); feather(b, 3.1, -2.4, 3.9, ctx.look === 1 ? 0xff3fc8 : 0xf04a6a);
  b.cone(-2.7, 1.4, 1.2, 0.2, 0.6, 7, 0xe8c070); b.sphere(-2.7, 2.0, 1.2, 0.26, 0xf58ac0, { seg: 5 }); b.sphere(-2.7, 2.25, 1.2, 0.2, 0xfff0c8, { seg: 5 }); b.box(-2.7, 0.14, 1.2, 0.5, 1.2, 0.5, 0xfdfdf6);
  staff(b, ctx, [-0.6, 0.7], zc + 0.9, { vest: ctx.look === 2 ? 0x1f5fb8 : 0x2d6fd0 });
  b.table(-2.4, 2.4, 0.38, 0xffffff, { parasol: ctx.L2 ? P.awn[0] : 0 }); b.table(2.4, 2.5, 0.38, P.second, {});
  bin(b, 3.2, 0.7, 0x2a6fc8);
  if (ctx.L2) { forecourtStrings(b, ctx, -3.3, 3.3, 3.4); booth(b, ctx, 3.0, -1.6, { body: P.main, roof: P.second }); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.6, 3.6, 3.7); b.figure(-0.4, 2.7, Math.PI); b.figure(0.5, 2.9, Math.PI); b.ledRect(-1.8, H + 0.05, 1.8, H + 1.0, zc + D / 2 + 0.48, 0.06, ctx.led); }
  return end(b, ctx, [8, 8], 4.0);
} };

/* ------------------------------------------------------------------ lous: lottery stall (S) */
MODELS.lous = { build(opts) {
  const { b, ctx } = begin('lous', opts); const P = ctx.pal; const W = 6.2; const D = 2.8; const zc = -1.8; const H = 2.5;
  // trailer on a raised diamond-plate platform with steps
  b.box(0, -0.5, zc, W + 0.5, 1.12, D + 0.4, 0x2f2f35, { cols: { top: C.plate } }); b.box(0, 0.62, zc, W + 0.5, 0.03, D + 0.4, C.plate, { noFront: true, noBack: true });
  for (let i = 0; i < 3; i++) b.box(-1.4 + i * 0, 0.0 + i * 0.2, zc + D / 2 + 0.55 - i * 0.28, 1.8, 0.2, 0.34, C.plate);
  const y0 = 0.66;
  const wallC = ctx.look === 1 ? 0x241440 : 0xf1ead8;
  b.box(0, y0, zc - D / 2 + 0.3, W, H, 0.2, wallC); [-1, 1].forEach((sx) => b.box(sx * (W / 2 - 0.08), y0, zc - 0.2, 0.16, H, D - 0.4, wallC));
  b.box(0, y0, zc + D / 2 - 0.1, W + 0.2, 1.0, 0.7, P.dark); b.box(0, y0 + 1.0, zc + D / 2 - 0.1, W + 0.3, 0.07, 0.9, ctx.metal);
  // header: double bulb rows on a red board, hanging plush ceiling inside
  b.box(0, y0 + H - 0.2, zc + D / 2 + 0.2, W + 0.2, 0.5, 0.2, P.main);
  [y0 + H + 0.1, y0 + H - 0.2].forEach((y) => b.bulbRow([-W / 2 + 0.1, y, zc + D / 2 + 0.36], [W / 2 - 0.1, y, zc + D / 2 + 0.36], 0.28, ctx.bulb, 0.15));
  b.box(0, y0 + H + 0.2, zc - 0.2, W + 0.2, 0.18, D + 0.2, P.dark);
  b.gable(0, y0 + H + 0.38, zc - 0.2, W + 0.2, D + 0.2, 0.35, ctx.look === 2 ? P.main : 0xd9d2c0, { over: 0.1 });
  fascia(b, ctx, ctx.name, 0, y0 + H + 0.9, zc + D / 2 + 0.3, 3.6, 0.9);
  b.sign('JIDDEREEN GEWËNNT', 0, y0 + 1.35, zc + D / 2 + 0.5, 1.9, 0.36, { look: ctx.look, kind: 'banner', frameW: 0.04, frame: C.darkWood });
  for (let r = 0; r < 4; r++) for (let i = 0; i < 12; i++) plush(b, -2.8 + i * 0.5 + (r & 1) * 0.25, y0 + 1.15 + r * 0.38, zc - D / 2 + 0.55, PLUSH[(i * 3 + r * 5) % 8], 0.21);
  for (let i = 0; i < 10; i++) { b.wire([-2.7 + i * 0.6, y0 + H, zc + D / 2 - 0.5], [-2.7 + i * 0.6, y0 + H - 0.3 - (i % 3) * 0.25, zc + D / 2 - 0.5], 0.02, 0x555555); plush(b, -2.7 + i * 0.6, y0 + H - 0.5 - (i % 3) * 0.25, zc + D / 2 - 0.5, PLUSH[(i * 7 + 2) % 8], 0.2); }
  b.cyl(2.2, y0 + 1.1, zc + D / 2 - 0.1, 0.32, 0.32, 0.5, 8, C.red, { cap: true }); b.cyl(2.2, y0 + 1.6, zc + D / 2 - 0.1, 0.05, 0.05, 0.2, 4, C.steel);
  staff(b, ctx, [-1.2, 0.4], zc + 0.4, { y: y0, vest: P.main, hat: undefined });
  dressEdge(b, ctx, -W / 2, W / 2, y0 + H + 0.2, zc + D / 2 + 0.3, { noFlags: false });
  if (ctx.L2) { forecourtStrings(b, ctx, -3.4, 3.4, 3.3); b.table(2.7, 2.6, 0.4, P.second, { parasol: P.awn[0] }); }
  if (ctx.L3) { b.ledRect(-W / 2 + 0.1, y0 + H - 0.6, W / 2 - 0.1, y0 + H + 1.4, zc + D / 2 + 0.4, 0.06, ctx.led); dressForecourt(b, ctx, -3.4, 3.4, 3.7); b.figure(-0.6, 3.0, Math.PI); b.figure(0.5, 3.2, Math.PI); b.figure(1.4, 3.0, Math.PI); }
  if (ctx.L4) { b.sphere(-W / 2, y0 + H + 0.9, zc + D / 2 + 0.3, 0.18, GOLD, { seg: 6 }); b.sphere(W / 2, y0 + H + 0.9, zc + D / 2 + 0.3, 0.18, GOLD, { seg: 6 }); }
  return end(b, ctx, [8, 8], 4.8);
} };

/* ------------------------------------------------------------------ wurscht: grilled sausage kiosk (S) */
MODELS.wurscht = { build(opts) {
  const { b, ctx } = begin('wurscht', opts); const P = ctx.pal; const W = 4.4; const D = 3.0; const zc = -1.5; const H = 2.3;
  deck(b, ctx, 0, -0.5, 6.6, 6.8, ctx.look === 1 ? 0x1a1430 : 0x6a5a4c);
  b.box(0, 0.14, zc, W, H, D, ctx.look === 0 ? 0x8a5a34 : ctx.look === 1 ? 0x2a1850 : 0xf3ecd8, { cols: { front: ctx.look === 0 ? 0xa06a3c : undefined } });
  b.box(0, 1.15, zc + D / 2 + 0.01, 3.2, 0.95, 0.04, 0x1f2c36); b.box(0, 1.05, zc + D / 2 + 0.22, 3.6, 0.07, 0.5, ctx.metal);
  const tile = ctx.look === 0 ? C.tile : P.main;
  b.hip(0, H + 0.14, zc, W, D, 1.2, tile, { over: 0.3, ridge: 2.6, alt: [tile, shade(tile, 0.85)] });
  b.beam([-1.3, H + 1.38, zc], [1.3, H + 1.38, zc], 0.1, ctx.L4 ? GOLD : 0x2a1a12);
  b.bulbRow([-1.3, H + 1.45, zc], [1.3, H + 1.45, zc], 0.3, ctx.bulb, 0.15);
  // white arch sign
  b.box(0, H + 0.5, zc + D / 2 + 0.28, 2.4, 0.5, 0.1, 0xffffff);
  fascia(b, ctx, ctx.name, 0, H + 0.9, zc + D / 2 + 0.34, 2.9, 0.78);
  b.valance([-W / 2 - 0.3, H + 0.1, zc + D / 2 + 0.32], [W / 2 + 0.3, H + 0.1, zc + D / 2 + 0.32], 0.3, 9, P.awn[0], P.awn[1]);
  // grill with sausages + smoke
  b.box(0, 1.1, zc + D / 2 + 0.25, 2.6, 0.18, 0.7, 0x2a2a2e); for (let i = 0; i < 12; i++) b.cyl(-1.15 + i * 0.21, 1.3, zc + D / 2 + 0.12 + (i & 1) * 0.28, 0.045, 0.045, 0.5, 5, i % 3 ? 0xb5552a : 0xd2793c, { arc: undefined });
  b.fx(0, 1.6, zc + D / 2 + 0.3, ctx.L3 ? 4 : 2, 0, { spread: 1.2 });
  staff(b, ctx, [-0.8, 0.8], zc + 0.7, { vest: 0xc8283a });
  // red-clothed standing tables
  [[-2.8, 1.8], [2.7, 1.9], [-1.0, 3.0]].forEach(([x, z], i) => { if (i < 2 || ctx.L2) b.table(x, z, 0.42, i === 2 ? 0xf6ead0 : 0xc8283a, { parasol: ctx.L2 && i === 0 ? P.awn[0] : 0 }); });
  bin(b, 3.4, 0.6, 0x555555);
  dressEdge(b, ctx, -W / 2 - 0.3, W / 2 + 0.3, H + 0.1, zc + D / 2 + 0.38, { step: 0.34 });
  if (ctx.L2) { forecourtStrings(b, ctx, -3.5, 3.5, 3.4); }
  if (ctx.L2) booth(b, ctx, 3.3, -2.0, { body: P.dark });
  if (ctx.L3) { dressForecourt(b, ctx, -3.5, 3.5, 3.75); b.figure(0.1, 3.0, Math.PI); b.figure(1.2, 3.3, Math.PI); b.ledRect(-1.45, H + 0.2, 1.45, H + 1.3, zc + D / 2 + 0.4, 0.06, ctx.led); }
  return end(b, ctx, [8, 8], 4.0);
} };

/* ------------------------------------------------------------------ zocker: candy floss booth (S) */
MODELS.zocker = { build(opts) {
  const { b, ctx } = begin('zocker', opts); const P = ctx.pal; const W = 5.4; const D = 2.8; const zc = -1.7; const H = 2.5;
  deck(b, ctx, 0, -0.7, 7.2, 6.6, ctx.look === 1 ? 0x1a1430 : 0x7a6a5c);
  const body = ctx.look === 0 ? 0xf08aa8 : ctx.look === 1 ? 0x2a1850 : 0xfdfdf6; const trim = ctx.look === 0 ? 0xf4c430 : P.accent;
  b.box(0, 0.14, zc - D / 2 + 0.1, W, H, 0.18, body);
  // angled corner wings
  [-1, 1].forEach((s) => { b.push().translate(s * (W / 2 + 0.55), 0, zc + 0.5).rotY(-s * 0.55); b.box(0, 0.14, 0, 1.6, H - 0.1, 0.16, ctx.look === 0 ? 0xf4a03a : P.main); b.box(0, 1.0, 0.1, 1.5, 0.06, 0.4, ctx.metal); b.pop(); });
  b.box(-W / 2 + 0.05, 0.14, zc, 0.14, H, D - 0.2, body); b.box(W / 2 - 0.05, 0.14, zc, 0.14, H, D - 0.2, body);
  b.box(0, 0.14, zc + D / 2 - 0.35, W, 0.9, 0.7, ctx.look === 0 ? 0xf4a03a : P.dark); b.box(0, 1.04, zc + D / 2 - 0.35, W + 0.14, 0.07, 0.9, ctx.metal);
  fascia(b, ctx, 'ZOCKERWATT', 0, 0.62, zc + D / 2 + 0.02, W - 0.5, 0.62, { styles: ZOCKER_STYLE, frame: ctx.L4 ? GOLD : 0xf4c430 });
  [-1, 1].forEach((sx) => b.cyl(sx * (W / 2 - 0.05), 0.14, zc + D / 2 + 0.1, 0.17, 0.17, H, 8, 0xf4c430, { alt: [0xf4c430, 0xb070d8], smooth: false }));
  // roof with stripes and chaser rows
  b.box(0, H, zc, W + 0.5, 0.12, D + 0.5, trim); b.gable(0, H + 0.12, zc, W + 0.5, D + 0.5, 0.45, ctx.look === 0 ? 0xf08aa8 : P.main, { over: 0.1, back: ctx.look === 0 ? 0xf4c430 : undefined });
  b.valance([-W / 2 - 0.3, H, zc + D / 2 + 0.28], [W / 2 + 0.3, H, zc + D / 2 + 0.28], 0.34, 11, ctx.look === 0 ? 0xf08aa8 : P.awn[0], ctx.look === 0 ? 0xffffff : P.awn[1]);
  [H - 0.05, H - 0.02].forEach((y, k) => b.bulbRow([-W / 2 - 0.2, y + k * 0.3 - 0.1, zc + D / 2 + 0.3], [W / 2 + 0.2, y + k * 0.3 - 0.1, zc + D / 2 + 0.3], 0.26, ctx.look === 1 ? 0xff3fc8 : 0xff4a3a, 0.15, { chase: true }));
  fascia(b, ctx, 'Lecker mat zwou Faarwen', 0, H + 0.95, zc + D / 2 + 0.2, 3.8, 0.86, { styles: ZOCKER_STYLE });
  // candy floss machine + bags hanging in rows
  b.cyl(-1.0, 1.1, zc + D / 2 - 0.35, 0.5, 0.42, 0.28, 8, C.steel); b.sphere(-1.0, 1.55, zc + D / 2 - 0.35, 0.46, 0xf58ac0, { seg: 6 }); b.sphere(0.4, 1.5, zc + D / 2 - 0.35, 0.42, 0x7fd0f0, { seg: 6 }); b.cyl(0.4, 1.1, zc + D / 2 - 0.35, 0.42, 0.36, 0.28, 8, C.steel);
  const bagC = [0xf58ac0, 0x7fd0f0, 0xffe27a, 0xb89af0];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 9; i++) { const x = -2.4 + i * 0.6; b.wire([x, H - 0.1, zc + 0.1 + r * 0.5], [x, H - 0.45 - r * 0.2, zc + 0.1 + r * 0.5], 0.02, 0x555555); b.cyl(x, H - 1.0 - r * 0.2, zc + 0.1 + r * 0.5, 0.06, 0.2, 0.55, 6, bagC[(i + r) % 4]); b.sphere(x, H - 0.45 - r * 0.2, zc + 0.1 + r * 0.5, 0.22, bagC[(i + r + 1) % 4], { seg: 5 }); }
  staff(b, ctx, [-0.2, 1.8], zc + 0.2, { vest: 0xf08aa8, hat: 0xffffff });
  dressEdge(b, ctx, -W / 2 - 0.2, W / 2 + 0.2, H + 0.4, zc + D / 2 + 0.28, { step: 0.34 });
  if (ctx.L2) { forecourtStrings(b, ctx, -3.5, 3.5, 3.4); b.table(2.7, 2.7, 0.38, 0xf58ac0, { parasol: 0xf58ac0 }); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.5, 3.5, 3.75); b.figure(-0.5, 3.0, Math.PI, { body: 0xf08aa8 }); b.figure(0.6, 3.2, Math.PI); b.ledRect(-W / 2 + 0.2, H + 0.15, W / 2 - 0.2, H + 1.4, zc + D / 2 + 0.34, 0.06, ctx.led); }
  return end(b, ctx, [8, 8], 4.4);
} };

/* ------------------------------------------------------------------ lukas: strength tester (S) */
MODELS.lukas = { build(opts) {
  const { b, ctx } = begin('lukas', opts); const P = ctx.pal;
  deck(b, ctx, 0, 0, 7.4, 7.0, ctx.look === 1 ? 0x1a1430 : 0x6a5a4c);
  // the tall cut-out knight (flat painted plates, ~11 m with the plume) behind the tower: a long tabard with gold bands, shoulders, face with moustache, helmet + plume
  const metal = 0xc9ced4; const plume = 0xc8283a; const zk = -2.6; const tab = ctx.look === 1 ? 0x41e8ff : 0x2d6fd0;
  b.box(0, 0.14, zk, 2.2, 6.0, 0.22, tab);                                                      // tabard
  [1.4, 3.6, 5.6].forEach((y) => b.box(0, y, zk + 0.02, 2.24, 0.26, 0.24, GOLD));                // gold bands
  b.box(0, 2.2, zk + 0.13, 0.3, 3.4, 0.05, 0xf2e8d0); b.box(0, 3.0, zk + 0.13, 1.4, 0.26, 0.05, 0xf2e8d0);   // a painted cross on the tabard
  b.box(0, 6.1, zk, 1.9, 1.0, 0.24, metal); b.box(-1.15, 5.9, zk, 0.7, 0.7, 0.24, metal); b.box(1.15, 5.9, zk, 0.7, 0.7, 0.24, metal);   // gorget + pauldrons
  b.sphere(0, 7.55, zk + 0.06, 0.78, 0xf0c4a0, { seg: 7 });                                     // face
  b.cyl(0, 7.95, zk, 0.9, 0.78, 0.95, 8, metal, { cap: true });                                 // helmet
  b.box(0, 8.9, zk, 0.16, 1.1, 0.16, metal); [-0.4, 0, 0.4].forEach((x) => b.blob(x, 10.2 - Math.abs(x) * 0.6, zk, 0.34, 0.65, 0.2, plume));
  b.box(0, 7.25, zk + 0.2, 1.2, 0.2, 0.1, 0xffffff); b.blob(-0.62, 7.15, zk + 0.24, 0.4, 0.12, 0.08, 0xffffff); b.blob(0.62, 7.15, zk + 0.24, 0.4, 0.12, 0.08, 0xffffff);   // moustache
  b.sphere(-0.26, 7.72, zk + 0.62, 0.09, 0x222222, { seg: 4 }); b.sphere(0.26, 7.72, zk + 0.62, 0.09, 0x222222, { seg: 4 });
  b.box(-1.55, 2.2, zk + 0.02, 0.9, 2.2, 0.16, metal); b.box(1.55, 2.2, zk + 0.02, 0.9, 2.2, 0.16, 0xf4c430);       // shield + banner plates
  b.bulbRow([-1.1, 0.4, zk + 0.16], [-1.1, 6.0, zk + 0.16], 0.45, ctx.bulb, 0.13); b.bulbRow([1.1, 0.4, zk + 0.16], [1.1, 6.0, zk + 0.16], 0.45, ctx.bulb, 0.13);
  // the tower: ladder track with rank plates, bell and puck
  const tx = 1.6; const tz = -0.9; const TOP = 9.2;
  b.box(tx, 0.14, tz, 1.5, 0.5, 1.3, P.dark); b.box(tx, 0.64, tz, 1.1, 0.16, 0.9, 0x884433);
  b.box(tx, 0.8, tz - 0.4, 0.5, TOP - 0.7, 0.22, ctx.look === 1 ? 0x22103f : 0xf2e8d0);
  const ranks = [0xc8283a, 0xf08a2a, 0xf4c430, 0x7ad06a, 0x41c4d8, 0x8a5bc8];
  const nr = b.far ? 7 : 11; for (let i = 0; i < nr; i++) { b.box(tx, 1.4 + i * 0.74, tz - 0.28, 0.9, 0.34, 0.1, ranks[i % ranks.length]); if (!b.far) b.box(tx + 0.62, 1.44 + i * 0.74, tz - 0.28, 0.34, 0.26, 0.08, 0xffffff); }   // plates + small white rank cards
  b.box(tx - 0.3, 0.9, tz - 0.3, 0.05, TOP - 1.0, 0.1, 0x333333); b.box(tx + 0.3, 0.9, tz - 0.3, 0.05, TOP - 1.0, 0.1, 0x333333);
  b.sphere(tx, TOP + 0.5, tz - 0.3, 0.46, ctx.L4 ? GOLD : 0xe6b13a, { seg: 6 }); b.cyl(tx, TOP + 0.2, tz - 0.3, 0.12, 0.12, 0.3, 5, 0x333333);
  b.sphere(tx, 3.2, tz - 0.3, 0.16, 0xc8283a, { seg: 5 });
  b.bulbRow([tx - 0.5, 1.2, tz - 0.2], [tx - 0.5, TOP, tz - 0.2], 0.4, ctx.bulb, 0.13); b.bulbRow([tx + 0.5, 1.2, tz - 0.2], [tx + 0.5, TOP, tz - 0.2], 0.4, ctx.bulb, 0.13);
  // mallet and plush stall to the left
  b.box(tx - 0.2, 0.9, tz + 0.55, 0.5, 0.1, 0.9, 0x6a4a30); b.cyl(tx - 0.9, 0.9, tz + 0.9, 0.09, 0.09, 1.3, 5, C.wood, { }); b.cyl(tx - 0.9, 2.1, tz + 0.9, 0.18, 0.18, 0.45, 6, 0x884433);
  b.box(-1.9, 0.14, -0.4, 2.8, 1.0, 1.1, P.main); b.box(-1.9, 1.14, -0.4, 3.0, 0.07, 1.2, ctx.metal);
  b.gable(-1.9, 2.4, -0.4, 3.0, 1.4, 0.5, ctx.look === 0 ? 0xc8283a : P.main, { over: 0.1 });
  posts(b, [-3.2, -0.6], 0.2, 2.3, C.darkWood, 0.06); posts(b, [-3.2, -0.6], -1.0, 2.3, C.darkWood, 0.06);
  for (let i = 0; i < 6; i++) plush(b, -3.0 + i * 0.45, 1.4 + (i % 2) * 0.34, -0.9, PLUSH[(i * 3 + 2) % 8], 0.18);
  b.valance([-3.4, 2.4, 0.4], [-0.4, 2.4, 0.4], 0.28, 7, P.awn[0], P.awn[1]);
  fascia(b, ctx, ctx.name, -1.9, 3.35, 0.2, 2.9, 0.7);
  b.bulbRow([-3.4, 2.4, 0.42], [-0.4, 2.4, 0.42], 0.3, ctx.bulb, 0.14);
  staff(b, ctx, [-2.3], -0.4, { vest: P.main });
  dressEdge(b, ctx, -3.3, -0.5, 2.5, 0.45, { step: 0.34, noFlags: false });
  if (ctx.L2) { forecourtStrings(b, ctx, -3.6, 3.6, 3.2); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.5, 3.5, 3.7); b.figure(1.0, 1.8, Math.PI); b.figure(2.0, 2.0, Math.PI); b.figure(0.2, 2.6, Math.PI); b.ledRect(tx - 0.62, 1.3, tx + 0.62, TOP - 0.1, tz - 0.34, 0.07, ctx.led); }
  if (ctx.L4) { b.sphere(0, 10.9, zk, 0.2, GOLD, { seg: 6 }); b.box(tx, 0.64, tz + 0.46, 1.2, 0.08, 0.1, GOLD); }
  return end(b, ctx, [8, 8], 11.2);
} };

/* ------------------------------------------------------------------ mandel: roasted almonds + Magenbrot (S) */
MODELS.mandel = { build(opts) {
  const { b, ctx } = begin('mandel', opts); const P = ctx.pal; const W = 5.4; const D = 3.4; const zc = -1.7; const H = 2.3;
  deck(b, ctx, 0, -0.6, 7.2, 6.8, ctx.look === 1 ? 0x1a1430 : 0x5a4a3c);
  const green = ctx.look === 0 ? 0x1f5e46 : ctx.look === 1 ? 0x22103f : 0x1f5fb8; const wood = ctx.look === 0 ? 0x8a5a34 : P.dark;
  b.box(0, 0.14, zc - D / 2 + 0.12, W, H, 0.2, wood);
  [-1, 1].forEach((s) => { b.box(s * (W / 2 - 0.07), 0.14, zc, 0.14, H, D - 0.2, wood); b.box(s * (W / 2 + 0.08), 0.14, zc + D / 2 - 0.3, 0.3, H + 0.4, 0.3, 0xf4ead0); });
  // glass-fronted display with nuts + magenbrot, copper kettle
  counter(b, ctx, 0, zc + D / 2 - 0.4, W - 0.2, 0.8, 1.0, ctx.look === 1 ? 0x241440 : 0xf4ead0, ctx.metal, { braces: false });
  b.box(0, 1.07, zc + D / 2 - 0.4, W - 0.5, 0.4, 0.6, 0xa9d0e0, { cols: { top: 0xdff0f6 } });
  for (let i = 0; i < 12; i++) b.blob(-2.0 + i * 0.36, 1.12, zc + D / 2 - 0.4 + ((i * 7) % 3 - 1) * 0.12, 0.1, 0.07, 0.08, i % 3 ? 0x5a3a26 : 0xc89a5a);
  b.cyl(-1.6, 1.0, zc + 0.3, 0.45, 0.32, 0.5, 8, C.copper); b.sphere(-1.6, 1.55, zc + 0.3, 0.46, C.copper, { seg: 7, sy: 0.7 }); b.cyl(-1.6, 1.5, zc + 0.3, 0.06, 0.06, 0.6, 4, 0x333333);
  b.cyl(0.3, 1.0, zc + 0.3, 0.4, 0.3, 0.45, 8, C.copper); b.sphere(0.3, 1.5, zc + 0.3, 0.42, C.copper, { seg: 7, sy: 0.7 });
  b.fx(-1.6, 2.2, zc + 0.3, ctx.L3 ? 3 : 2, 0, { spread: 0.3 });
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) b.box(-2.3 + i * 0.9, 1.4 + r * 0.38, zc - D / 2 + 0.3, 0.7, 0.22, 0.2, [0xf2e4b0, 0x5a3a26, 0xc89a5a][(i + r) % 3]);
  // the arched fascia with red letters + double bulb rows
  vault(b, -W / 2 - 0.15, W / 2 + 0.15, H - 0.2, zc + D / 2 + 0.55, 1.0, green, { ry: 1.0, dbl: true });
  b.quad([-W / 2 - 0.15, H + 0.8, zc + D / 2 - 0.45], [W / 2 + 0.15, H + 0.8, zc + D / 2 - 0.45], [W / 2 + 0.15, H - 0.2, zc + D / 2 - 0.45], [-W / 2 - 0.15, H - 0.2, zc + D / 2 - 0.45], green, { dbl: true });
  [-W / 2 - 0.15, W / 2 + 0.15].forEach((x) => { b.beam([x, H - 0.2, zc + D / 2 + 0.55], [x, H + 0.8, zc + D / 2 - 0.45], 0.07, ctx.L4 ? GOLD : 0xdad2b8); });
  for (let k = 0; k < 8; k++) { const t = (k / 7) * Math.PI / 2; [0, 0.25].forEach((dz, j) => b.bulb(-W / 2 - 0.12, H - 0.2 + Math.sin(t) * 1.0 + j * 0.0, zc + D / 2 - 0.45 + Math.cos(t) * 1.0 + 0.1, ctx.bulb, 0.14)); }
  b.bulbRow([-W / 2 - 0.15, H - 0.2, zc + D / 2 + 0.58], [W / 2 + 0.15, H - 0.2, zc + D / 2 + 0.58], 0.28, ctx.bulb, 0.15);
  b.bulbRow([-W / 2 - 0.15, H + 0.4, zc + D / 2 + 0.3], [W / 2 + 0.15, H + 0.4, zc + D / 2 + 0.3], 0.28, ctx.bulb, 0.14);
  b.bulbRow([-W / 2 - 0.15, H + 0.8, zc + D / 2 - 0.42], [W / 2 + 0.15, H + 0.8, zc + D / 2 - 0.42], 0.28, ctx.bulb, 0.14);
  b.push().translate(0, H + 0.45, zc + D / 2 + 0.3).rotX(-0.62); fascia(b, ctx, 'Mandelbrennerei', 0, 0, 0.05, 4.4, 0.8, { frame: ctx.L4 ? GOLD : false, styles: MANDEL_STYLE }); b.pop();
  b.sign(ctx.name, 0, 1.95, zc + D / 2 + 0.2, 3.6, 0.42, { look: ctx.look, kind: 'banner', lit: ctx.L2, frameW: 0.05, frame: ctx.L4 ? GOLD : C.darkWood, style: { bg: '#3a4a40', bg2: '#2a3a30', fg: '#f4ead0', stroke: '#1a2a20', strokeW: 3, font: SERIF, italic: true, border: '#d6a436' } });
  [-1.6, -0.2, 1.4].forEach((x) => { b.wire([x, H - 0.2, zc + D / 2 - 0.1], [x, H - 0.75, zc + D / 2 - 0.1], 0.02, 0x333333); b.sphere(x, H - 0.95, zc + D / 2 - 0.1, 0.22, 0xfff4d8, { seg: 5, sy: 0.7, ch: 'lamp' }); });
  staff(b, ctx, [-0.6, 1.6], zc + 0.1, { vest: 0xf4ead0, hat: 0xc8283a });
  [[-3.0, 2.8], [2.9, 2.5]].forEach(([x, z]) => b.table(x, z, 0.38, P.second, {}));
  bin(b, 3.3, 0.7, 0x555555);
  if (ctx.L2) { forecourtStrings(b, ctx, -3.5, 3.5, 3.4); b.table(0, 3.0, 0.4, 0xc8283a, { parasol: green }); booth(b, ctx, 3.3, -1.6, { body: wood }); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.5, 3.5, 3.8); b.figure(-0.9, 3.0, Math.PI); b.figure(0.3, 3.3, Math.PI); b.ledRect(-W / 2 + 0.1, H + 0.1, W / 2 - 0.1, H + 0.7, zc + D / 2 + 0.34, 0.06, ctx.led); }
  if (ctx.L4) { b.sphere(0, H + 1.0, zc + D / 2 - 0.4, 0.2, GOLD, { seg: 6 }); }
  return end(b, ctx, [8, 8], 3.9);
} };

/* ------------------------------------------------------------------ waffle trailer with Hämmi mascot (S) */
MODELS.waffel = { build(opts) {
  const { b, ctx } = begin('waffel', opts); const P = ctx.pal; const W = 6.2; const D = 3.0; const zc = -1.6; const H = 2.5;
  b.box(0, -0.5, zc, W + 0.5, 1.12, D + 0.4, 0x2f2f35, { cols: { top: C.plate } }); b.box(0, 0.62, zc, W + 0.5, 0.03, D + 0.4, C.plate, { noFront: true, noBack: true });
  for (let i = 0; i < 3; i++) b.box(-2.4, i * 0.2, zc + D / 2 + 0.55 - i * 0.28, 1.4, 0.2, 0.34, 0x2d6fd0);
  const y0 = 0.66; const white = ctx.look === 1 ? 0x241440 : 0xfdfdf6;
  b.box(0, y0, zc, W, H, D, white);
  // star / heart print on the cladding (a painted mural panel), red-white awning
  b.mural(6, 7, 0, y0 + 0.95, zc + D / 2 + 0.012, W - 0.2, 1.6, { look: ctx.look, frame: false, back: false });
  b.mural(6, 9, -0.7, y0 + H + 0.8, zc - 0.34, 4.8, 1.2, { look: ctx.look, frame: false, back: false });
  awning(b, ctx, -W / 2, W / 2, y0 + 2.5, y0 + 1.8, zc + D / 2, zc + D / 2 + 0.85, P.awn[0] === 0xb3262d ? 0xc8283a : P.awn[0], 0xffffff, { stripe: 0.4 });
  b.box(0, y0 + 0.9, zc + D / 2 + 0.1, W - 0.4, 0.07, 0.5, ctx.metal);
  // two sign levels
  b.box(0, y0 + H, zc, W + 0.2, 0.15, D + 0.2, white);
  b.box(0, y0 + H + 0.15, zc - 0.5, W - 0.4, 1.3, 0.3, white);
  fascia(b, ctx, ctx.name, -0.7, y0 + H + 0.8, zc - 0.3, 3.6, 0.85, { styles: CIRCUS_STYLE });
  b.sign('EISEKUCH', -0.4, y0 + 1.85, zc + D / 2 + 0.55, 2.6, 0.5, { look: ctx.look, kind: 'banner', lit: ctx.L2, frameW: 0.05, frame: ctx.L4 ? GOLD : C.darkWood, style: CIRCUS_STYLE[ctx.look] });
  // waffle counter items
  for (let i = 0; i < 4; i++) b.cyl(-1.8 + i * 0.55, y0 + 0.98, zc + D / 2 + 0.1, 0.22, 0.22, 0.06, 8, 0xd49a4a, { alt: [0xd49a4a, 0xbd7f33], cap: true, capColor: 0xe6b564 });
  b.box(1.6, y0 + 0.98, zc + D / 2 + 0.1, 0.8, 0.5, 0.35, C.darkSteel);
  b.fx(1.6, y0 + 1.5, zc + D / 2 + 0.1, ctx.L3 ? 3 : 2, 0, { spread: 0.3 });
  hammi(b, 2.1, y0 + H + 0.15, zc - 0.5, 1.5, { waffle: true, crown: true });
  b.sphere(2.1, y0 + H + 2.2, zc - 0.5, 0.2, 0xf4c430, { seg: 5, sy: 0.6 });
  staff(b, ctx, [-0.9, 0.5], zc + 0.4, { y: y0, vest: P.accent === 0x2f6a4c ? 0xc8283a : P.accent, hat: 0xffffff });
  dressEdge(b, ctx, -W / 2, W / 2, y0 + 2.5, zc + D / 2 + 0.88, { noFlags: false, step: 0.34 });
  if (ctx.L2) { forecourtStrings(b, ctx, -3.4, 3.4, 3.4); b.table(2.5, 2.8, 0.38, P.second, { parasol: 0xc8283a }); }
  if (ctx.L3) { b.ledRect(-W / 2 + 0.1, y0 + H + 0.2, W / 2 - 0.1, y0 + H + 1.3, zc - 0.32, 0.07, ctx.led); dressForecourt(b, ctx, -3.5, 3.5, 3.8); b.figure(-1.2, 3.1, Math.PI); b.figure(0.0, 3.3, Math.PI); }
  if (ctx.L4) b.cone(2.1, y0 + H + 2.3, zc - 0.5, 0.25, 0.3, 5, GOLD);
  return end(b, ctx, [8, 8], 6.0);
} };

/* ------------------------------------------------------------------ fesch: fried fish hut with terrace (M) */
MODELS.fesch = { build(opts) {
  const { b, ctx } = begin('fesch', opts); const P = ctx.pal; const W = 8.0; const D = 4.6; const zc = -4.8; const H = 2.8;
  deck(b, ctx, 0, -1.0, 14.6, 13.8, ctx.look === 1 ? 0x1a1430 : 0x6a5a4c);
  const timber = ctx.look === 0 ? 0x8a5a34 : ctx.look === 1 ? 0x22103f : 0x1f5fb8; const light = ctx.look === 2 ? 0xfdfdf6 : 0xf1e6c8;
  b.box(0, 0.14, zc, W, H, D, timber, { cols: { front: shade(timber, 1.15) } });
  for (let i = 0; i < 9; i++) b.box(-W / 2 + 0.45 + i * 0.9, 0.14, zc + D / 2 + 0.02, 0.1, H, 0.04, light);
  b.box(0, 1.1, zc + D / 2 + 0.03, 5.8, 1.0, 0.05, 0x1f2c36); b.box(0, 1.0, zc + D / 2 + 0.35, 6.2, 0.08, 0.7, ctx.metal);
  // roof with a chimney, blue-white striped awning
  b.gable(0, H + 0.14, zc, W + 0.6, D + 0.6, 1.5, ctx.look === 0 ? 0x6b4a3a : P.main, { over: 0.3, ridge: 'x', under: shade(timber, 0.8) });
  b.box(2.6, H + 0.8, zc - 0.6, 0.7, 1.5, 0.7, 0x8a8f94); b.fx(2.6, H + 2.35, zc - 0.6, ctx.L3 ? 4 : 3, 0, { spread: 0.3, size: 0.4 });
  awning(b, ctx, -W / 2 - 0.3, W / 2 + 0.3, H + 0.1, H - 0.7, zc + D / 2 + 0.05, zc + D / 2 + 1.3, 0x2d6fd0, 0xffffff, { stripe: 0.5 });
  fascia(b, ctx, ctx.name, 0, H + 1.3, zc + D / 2 + 0.38, 4.6, 1.0);
  // fish sign on a post: three blobs + tail + eye
  b.cyl(-W / 2 + 0.2, 0.14, zc + D / 2 + 1.1, 0.06, 0.06, 4.0, 5, C.darkWood);
  b.push().translate(-W / 2 + 0.2, 4.2, zc + D / 2 + 1.1); b.blob(0, 0, 0, 0.8, 0.38, 0.1, 0xf0c04a); b.tri([0.7, 0, 0], [1.2, 0.4, 0], [1.2, -0.4, 0], 0xe6a02a, { dbl: true }); b.sphere(-0.5, 0.08, 0.1, 0.07, 0x111111, { seg: 4 }); b.pop();
  b.box(2.9, 1.4, zc + D / 2 + 0.07, 1.4, 1.1, 0.06, 0x234535); b.sign('Fouerfësch + Béier', 2.9, 1.45, zc + D / 2 + 0.12, 1.3, 0.55, { look: ctx.look, kind: 'plate', frameW: 0.04, frame: C.darkWood });
  b.bulbRow([-W / 2 - 0.3, H - 0.7, zc + D / 2 + 1.34], [W / 2 + 0.3, H - 0.7, zc + D / 2 + 1.34], 0.34, ctx.bulb, 0.16);
  dressEdge(b, ctx, -W / 2 - 0.3, W / 2 + 0.3, H + 0.1, zc + D / 2 + 1.3, { step: 0.36, noFlags: false });
  staff(b, ctx, [-2.0, -0.4, 1.4], zc + 0.9, { vest: 0xf4f0e6, hat: 0xf4f0e6 });
  // terrace: picnic tables with parasols, beer glasses
  const tx = [-5.0, -1.6, 1.8, 5.0]; tx.forEach((x, i) => {
    const z = 0.9 + (i & 1) * 2.6; b.box(x, 0.8, z, 1.8, 0.08, 0.8, C.lightWood); b.box(x, 0.45, z - 0.7, 1.8, 0.06, 0.3, C.lightWood); b.box(x, 0.45, z + 0.7, 1.8, 0.06, 0.3, C.lightWood);
    [-0.7, 0.7].forEach((dx) => { b.box(x + dx, 0.14, z, 0.08, 0.66, 0.9, C.darkWood); });
    if (ctx.L2 || i < 2) { b.cyl(x, 0.14, z, 0.04, 0.04, 2.4, 4, C.darkSteel); b.cone(x, 2.1, z, 1.35, 0.5, 8, i & 1 ? 0xffffff : P.awn[0], { alt: i & 1 ? [0xffffff, P.awn[0]] : [P.awn[0], 0xffffff], smooth: false }); }
    b.cyl(x - 0.4, 0.88, z, 0.07, 0.06, 0.18, 6, 0xe8c040); b.cyl(x + 0.3, 0.88, z + 0.1, 0.07, 0.06, 0.18, 6, 0xf0e8a0);
    if (ctx.L3 && i < 3) { b.figure(x - 0.5, z + 0.9, Math.PI, {}); b.figure(x + 0.4, z - 0.9, 0, {}); }
  });
  bin(b, 6.6, -1.0, 0x555555); bin(b, -6.6, -1.0, 0x555555);
  b.box(0, 0.0, 6.7, 13.5, 0.04, 0.1, 0x777777);
  if (ctx.L2) { forecourtStrings(b, ctx, -6.6, 6.6, 6.0, 3.0); forecourtStrings(b, ctx, -6.6, 6.6, 3.2, 3.0); booth(b, ctx, 6.6, -3.4, { body: timber }); }
  if (ctx.L3) { dressForecourt(b, ctx, -6.5, 6.5, 7.3); b.ledRect(-W / 2 - 0.2, H + 0.3, W / 2 + 0.2, H + 1.9, zc + D / 2 + 0.44, 0.07, ctx.led); }
  if (ctx.L4) { b.sphere(-W / 2 + 0.2, 6.35, zc + D / 2 + 1.1, 0.25, GOLD, { seg: 6 }); }
  return end(b, ctx, [16, 16], 6.4);
} };

/* ------------------------------------------------------------------ crepes: chalet booth (S) */
MODELS.crepes = { build(opts) {
  const { b, ctx } = begin('crepes', opts); const P = ctx.pal; const W = 4.8; const D = 3.4; const zc = -1.4; const H = 2.3;
  deck(b, ctx, 0, -0.6, 7.0, 6.8, ctx.look === 1 ? 0x1a1430 : 0x6a5a4c);
  const timber = ctx.look === 0 ? 0x8a5a34 : ctx.look === 1 ? 0x22103f : 0xdad4c4;
  b.box(0, 0.14, zc, W, H, D, timber, { cols: { front: shade(timber, 1.12) } });
  for (let i = 0; i < 6; i++) b.box(-W / 2 + 0.4 + i * 0.8, 0.14, zc + D / 2 + 0.02, 0.1, H, 0.04, shade(timber, 0.7));
  b.box(0, 1.05, zc + D / 2 + 0.03, 3.6, 0.95, 0.05, 0x1f2c36); b.box(0, 1.0, zc + D / 2 + 0.3, 4.0, 0.08, 0.6, ctx.metal);
  // steep shingle roof, flower boxes, shutters
  b.gable(0, H + 0.14, zc, W + 0.5, D + 0.6, 1.7, ctx.look === 0 ? 0x4a3228 : P.main, { over: 0.35, ridge: 'x', under: shade(timber, 0.7) });
  b.tri([-W / 2 - 0.1, H + 0.14, zc + D / 2 + 0.4], [W / 2 + 0.1, H + 0.14, zc + D / 2 + 0.4], [0, H + 1.84, zc + D / 2 + 0.4], shade(timber, 1.1));
  [-1, 1].forEach((s) => { b.box(s * 2.1, 1.1, zc + D / 2 + 0.06, 0.4, 1.1, 0.06, P.accent); b.box(s * 1.7, 0.7, zc + D / 2 + 0.25, 0.8, 0.22, 0.28, 0x6a4a30); for (let i = 0; i < 4; i++) b.sphere(s * 1.7 - 0.28 + i * 0.19, 0.95, zc + D / 2 + 0.25, 0.1, [0xee6fa8, 0xd8433a, 0xf4c430, 0xffffff][i], { seg: 4 }); });
  fascia(b, ctx, ctx.name, 0, H + 0.62, zc + D / 2 + 0.46, 3.0, 0.8);
  b.sign('Crêpes · Gaufres', 0, 1.9, zc + D / 2 + 0.16, 2.3, 0.4, { look: ctx.look, kind: 'banner', frameW: 0.04, frame: C.darkWood });
  // round griddles with rakes + jars
  [-1.1, 0.5].forEach((x) => { b.cyl(x, 1.08, zc + D / 2 + 0.1, 0.45, 0.45, 0.07, 10, 0x2a2a2e, { cap: true }); b.cyl(x, 1.15, zc + D / 2 + 0.1, 0.4, 0.4, 0.02, 10, 0xe0b870); b.beam([x + 0.05, 1.2, zc + D / 2 + 0.5], [x + 0.55, 1.2, zc + D / 2 - 0.2], 0.04, C.lightWood); });
  [1.4, 1.65, 1.9].forEach((x, i) => b.cyl(x, 1.08, zc + D / 2 + 0.2, 0.09, 0.09, 0.3, 6, [0x7a2a1a, 0xd8a030, 0xee6fa8][i]));
  b.fx(-0.3, 1.3, zc + D / 2 + 0.1, ctx.L3 ? 3 : 2, 0, { spread: 0.9, size: 0.2 });
  staff(b, ctx, [-0.4, 1.0], zc + 0.9, { vest: P.accent === 0x2f6a4c ? 0x2f6a4c : P.accent, hat: 0xf4f0e6 });
  b.bulbRow([-W / 2 - 0.3, H + 0.15, zc + D / 2 + 0.42], [W / 2 + 0.3, H + 0.15, zc + D / 2 + 0.42], 0.3, ctx.bulb, 0.14);
  dressEdge(b, ctx, -W / 2 - 0.3, W / 2 + 0.3, H + 0.5, zc + D / 2 + 0.42, { step: 0.34 });
  b.table(-2.9, 2.4, 0.38, P.second, { parasol: ctx.L2 ? P.accent : 0 }); b.table(2.9, 2.5, 0.38, 0xf6ead0, {});
  bin(b, 3.5, 0.4, 0x555555);
  if (ctx.L2) { forecourtStrings(b, ctx, -3.4, 3.4, 3.4); booth(b, ctx, 3.0, -2.4, { body: timber, roof: ctx.look === 0 ? 0x4a3228 : P.main }); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.4, 3.4, 3.7); b.figure(-0.6, 3.0, Math.PI); b.figure(0.6, 3.1, Math.PI); b.ledRect(-1.5, H + 0.2, 1.5, H + 1.2, zc + D / 2 + 0.5, 0.06, ctx.led); }
  if (ctx.L4) b.sphere(0, H + 1.95, zc, 0.2, GOLD, { seg: 6 });
  return end(b, ctx, [8, 8], 4.3);
} };

/* ------------------------------------------------------------------ schiess: shooting gallery (S) */
MODELS.schiess = { build(opts) {
  const { b, ctx } = begin('schiess', opts); const P = ctx.pal; const W = 7.0; const D = 2.8; const zc = -2.0; const H = 2.6;
  b.box(0, -0.5, zc, W + 0.4, 1.12, D + 0.4, 0x2f2f35, { cols: { top: C.plate } }); b.box(0, 0.62, zc, W + 0.4, 0.03, D + 0.4, C.plate, { noFront: true, noBack: true });
  const y0 = 0.66;
  const wallS = ctx.look === 1 ? 0x241440 : 0xd9cdb4;
  b.box(0, y0, zc - D / 2 + 0.3, W, H, 0.2, wallS); [-1, 1].forEach((sx) => b.box(sx * (W / 2 - 0.08), y0, zc - 0.2, 0.16, H, D - 0.4, wallS));
  b.box(0, y0, zc + D / 2 - 0.2, W + 0.1, 1.0, 0.6, P.main); b.box(0, y0 + 1.0, zc + D / 2 - 0.2, W + 0.2, 0.07, 0.8, ctx.metal);
  // plush wall (rows), tin-can pyramids, targets
  for (let r = 0; r < 4; r++) for (let i = 0; i < 13; i++) plush(b, -3.1 + i * 0.52 + (r & 1) * 0.26, y0 + 1.45 + r * 0.34, zc - D / 2 + 0.55, PLUSH[(i * 3 + r * 2) % 8], 0.19);
  for (let p = 0; p < 2; p++) { const x0 = p ? 1.9 : -2.2; for (let r = 0; r < 3; r++) for (let k = 0; k <= 2 - r; k++) b.cyl(x0 + (k - (2 - r) / 2) * 0.26, y0 + 1.1 + r * 0.2, zc + 0.2, 0.1, 0.1, 0.2, 6, [0xc8283a, 0x2d6fd0, 0xf4c430][(r + k) % 3]); }
  [-0.4, 0.5].forEach((x, i) => { b.cyl(x, y0 + 1.6, zc + 0.35, 0.3, 0.3, 0.05, 10, i ? 0xc8283a : 0xf4c430); b.cyl(x, y0 + 1.6, zc + 0.37, 0.15, 0.15, 0.05, 10, 0xffffff); });
  [-2.8, -1.0, 1.0, 2.8].forEach((x) => { b.beam([x, y0 + 1.1, zc + D / 2 - 0.2], [x + 0.12, y0 + 1.5, zc + D / 2 - 0.6], 0.04, 0x222222); b.box(x + 0.12, y0 + 1.1, zc + D / 2 - 0.6, 0.06, 0.06, 0.5, 0x333333); });
  // red chase fascia with double bulb header
  b.box(0, y0 + H - 0.1, zc + D / 2 - 0.1, W + 0.3, 0.7, 0.3, ctx.look === 1 ? 0x22103f : 0xc8283a);
  b.box(0, y0 + H + 0.6, zc - 0.1, W + 0.3, 0.2, D, P.dark); b.gable(0, y0 + H + 0.8, zc - 0.1, W + 0.3, D, 0.4, ctx.look === 0 ? 0xc8283a : P.main, { over: 0.1 });
  [y0 + H + 0.35, y0 + H - 0.05].forEach((y, k) => b.bulbRow([-W / 2 - 0.1, y, zc + D / 2 + 0.08], [W / 2 + 0.1, y, zc + D / 2 + 0.08], 0.26, ctx.look === 1 ? [0xff3fc8, 0x41e8ff] : 0xffd890, 0.15, { chase: k === 0 }));
  fascia(b, ctx, ctx.name, 0, y0 + H + 1.35, zc + D / 2 - 0.1, 4.2, 0.92);
  staff(b, ctx, [-0.8, 1.2], zc + 0.2, { y: y0, vest: P.main });
  dressEdge(b, ctx, -W / 2, W / 2, y0 + H + 0.7, zc + D / 2 + 0.05, { noFlags: false, step: 0.34 });
  if (ctx.L2) { forecourtStrings(b, ctx, -3.6, 3.6, 3.3); }
  if (ctx.L3) { b.ledRect(-W / 2, y0 + H - 0.4, W / 2, y0 + H + 1.7, zc + D / 2 + 0.2, 0.07, ctx.led); dressForecourt(b, ctx, -3.5, 3.5, 3.7); b.figure(-0.8, 3.0, Math.PI); b.figure(0.5, 3.2, Math.PI); }
  if (ctx.L4) { b.sphere(-W / 2, y0 + H + 1.0, zc + D / 2 - 0.1, 0.2, GOLD, { seg: 6 }); b.sphere(W / 2, y0 + H + 1.0, zc + D / 2 - 0.1, 0.2, GOLD, { seg: 6 }); }
  return end(b, ctx, [8, 8], 5.0);
} };

/* ------------------------------------------------------------------ museum: the old-park kiosk shell (S) */
MODELS.museum = { build(opts) {
  const { b, ctx } = begin('museum', opts); const P = ctx.pal; const W = 4.6; const D = 3.4; const zc = -1.0; const H = 2.5;
  deck(b, ctx, 0, -0.3, 6.4, 6.4, ctx.look === 1 ? 0x1a1430 : 0x6a6258);
  const body = ctx.look === 1 ? 0x22103f : 0xefe7d2;
  b.box(0, 0.14, zc, W, H, D, body); b.box(0, 0.14, zc + D / 2 + 0.01, W + 0.1, 0.35, 0.05, P.main);
  b.box(0, 0.9, zc + D / 2 + 0.02, 2.8, 1.3, 0.05, 0xa9d0e0); b.box(0, 0.85, zc + D / 2 + 0.3, 3.2, 0.08, 0.55, ctx.metal);
  // zinc roof (like the small kiosk at the SW corner of the real field)
  b.gable(0, H + 0.14, zc, W + 0.4, D + 0.4, 1.1, 0xa9b0b6, { over: 0.25, ridge: 'x', under: shade(body, 0.8) });
  [-1.2, 0, 1.2].forEach((x) => b.beam([x, H + 0.2, zc + D / 2 + 0.3], [x, H + 1.24, zc], 0.04, 0x8a9096));
  fascia(b, ctx, ctx.name, 0, H + 0.5, zc + D / 2 + 0.34, 3.4, 0.8);
  // the diorama on the counter: a tiny old park (wheel, carousel, stall) under a glass dome
  b.box(0, 0.85, zc + D / 2 + 0.0, 2.4, 0.18, 1.0, C.lightWood);
  b.push().translate(-0.6, 1.25, zc + D / 2 - 0.1).rotX(Math.PI / 2); b.disc(0, 0, 0, 0.32, 0.27, 12, 0xc8283a); b.pop();
  b.box(-0.6, 1.03, zc + D / 2 - 0.1, 0.04, 0.3, 0.04, 0xc8d0d4);
  b.cone(0.4, 1.1, zc + D / 2 - 0.1, 0.3, 0.3, 8, 0xc8283a, { alt: [0xc8283a, 0xffffff], smooth: false }); b.box(0.95, 1.03, zc + D / 2 - 0.1, 0.35, 0.3, 0.3, 0x2d6fd0); b.blob(-1.0, 1.1, zc + D / 2 + 0.2, 0.1, 0.08, 0.08, 0x3b9a4c);
  b.sphere(0, 1.18, zc + D / 2 + 0.0, 1.2, 0xdff0f6, { seg: 8, sy: 0.35 });
  // nostalgia details: bunting, lamp, a bench and a small pioneer plaque
  b.pennants([-W / 2, H + 0.2, zc + D / 2 + 0.4], [W / 2, H + 0.2, zc + D / 2 + 0.4], 8, [0xc8283a, 0xffffff, 0x7fc4ec], 0.3);
  b.bulbRow([-W / 2, H + 0.12, zc + D / 2 + 0.38], [W / 2, H + 0.12, zc + D / 2 + 0.38], 0.36, ctx.bulb, 0.14);
  b.box(-2.4, 0.14, 2.2, 1.6, 0.4, 0.5, C.lightWood); b.box(-2.4, 0.54, 1.98, 1.6, 0.5, 0.08, C.lightWood);
  b.sign('PIONÉIER', 2.4, 0.9, 2.3, 0.9, 0.4, { look: ctx.look, kind: 'plate', frameW: 0.05, frame: GOLD, lit: ctx.L2 }); b.cyl(2.4, 0.14, 2.3, 0.04, 0.04, 0.5, 4, C.darkSteel);
  if (ctx.L2) { forecourtStrings(b, ctx, -3.1, 3.1, 3.3); }
  if (ctx.L3) { dressForecourt(b, ctx, -3.2, 3.2, 3.7); b.figure(0.3, 3.0, Math.PI); b.ledRect(-W / 2, H, W / 2, H + 1.0, zc + D / 2 + 0.42, 0.06, ctx.led); }
  if (ctx.L4) b.sphere(0, H + 1.4, zc, 0.22, GOLD, { seg: 6 });
  return end(b, ctx, [8, 8], 4.0);
} };

/* ------------------------------------------------------------------ lammy: the Hämmi statue (S, stamp reward) */
MODELS.lammy = { build(opts) {
  const { b, ctx } = begin('lammy', opts); const P = ctx.pal;
  deck(b, ctx, 0, 0, 7.0, 7.0, ctx.look === 1 ? 0x1a1430 : 0x77706a, { plateColor: 0x9a948a });
  const stone = ctx.L4 ? GOLD : 0xd8d0c0;
  b.cyl(0, 0.14, 0, 2.6, 2.5, 0.3, 12, 0xb8b0a0, { cap: true }); b.cyl(0, 0.44, 0, 1.9, 1.8, 0.3, 12, 0xc8c0b0, { cap: true });
  b.cyl(0, 0.74, 0, 1.15, 1.05, 1.2, 10, stone, { cap: true }); b.cyl(0, 1.94, 0, 1.35, 1.2, 0.18, 10, ctx.L4 ? 0xfff0b0 : 0xe4dccb, { cap: true });
  b.sign('Hämmi', 0, 1.35, 1.2, 1.2, 0.4, { look: ctx.look, kind: 'plate', lit: ctx.L2, frameW: 0.05, frame: ctx.L4 ? 0xb8862a : C.darkWood });
  hammi(b, 0, 2.12, 0, 1.9);
  if (ctx.L4) b.cone(0, 4.1, 0, 0.22, 0.4, 5, GOLD);
  // flowerbed ring and lamps
  for (let i = 0; i < 10; i++) { const a = TAU * i / 10; b.sphere(Math.sin(a) * 3.1, 0.2, Math.cos(a) * 3.1, 0.28, [0xee6fa8, 0xf4c430, 0xd8433a, 0xffffff][i % 4], { seg: 5 }); }
  [[-3.3, 3.0], [3.3, 3.0], [-3.3, -3.0], [3.3, -3.0]].forEach(([x, z]) => { b.cyl(x, 0.1, z, 0.06, 0.06, 2.4, 5, C.black); b.sphere(x, 2.6, z, 0.2, 0xffffff, { seg: 5, ch: 'lamp' }); b.bulb(x, 2.6, z, ctx.bulb, 0.22); });
  if (ctx.L2) { b.bulbRing(0, 0.9, 0, 2.2, 22, ctx.bulb, 0.14); forecourtStrings(b, ctx, -3.5, 3.5, 3.5, 2.8); }
  if (ctx.L3) { b.ledRect(-1.15, 0.9, 1.15, 1.9, 1.2, 0.06, ctx.led); b.railing([-3.6, 0, 3.7], [3.6, 0, 3.7], 0.95, ctx.L4 ? GOLD : C.steel); b.figure(-1.6, 3.2, Math.PI); b.figure(1.8, 3.3, Math.PI); }
  return end(b, ctx, [8, 8], 5.0);
} };
