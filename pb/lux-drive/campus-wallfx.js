/* Features that stand on a wall of a campus building: signs with lettering, entrance porches, canopies, logos.  They are listed per part
 * in the bake spec (campus_spec.py, part.ft) with a world position; a feature belongs to the wall run it stands on (matchOnRun).
 * The 'recess' kind also opens a gap in the wall (campus-facades.js planRun); everything is drawn here.  Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { drawText, textWidth } from './campus-text.js';
import { quad, ledge, shade, recessBox, wallBase, matchOnRun } from './campus-kit.js';

const BOARD_DEPTH = 0.12;
const DOOR_H = 2.4;                    // m: the height of a door
const TRANSOM_PITCH = 1.7;             // m: the mullions of an entrance glass wall

/** The direction along a text read from the front of a wall whose outward normal is f.(nx, nz). */
const readingDir = (f) => [f.nz, -f.nx];

/** The frame of a free-standing plane (a sign on its own post): s along the text, y up, `out` in front; the same shape as an edge frame. */
export function freeFrame(x, z, nx, nz) {
  const l = Math.hypot(nx, nz) || 1;
  const n = [nx / l, nz / l];
  const d = [n[1], -n[0]];
  return { nx: n[0], nz: n[1], dx: d[0], dz: d[1], yaw: Math.atan2(-d[1], d[0]), at: (s, y, out = 0) => [x + d[0] * s + n[0] * out, y, z + d[1] * s + n[1] * out] };
}

/** A sign: an optional board with lettering, its middle at `s` along the frame, its baseline `ft.y` over the absolute height `base`. */
export function drawSign(ctx, ft, s, base) {
  const f = ctx.f;
  const cap = ft.cap;
  const width = textWidth(ft.text) * cap;
  const y0 = base + (ft.y ?? 3);
  const out = ft.out ?? 0.06;
  if (ft.board) {
    const pad = ft.board.pad ?? cap * 0.35;
    const h = cap + pad * 2 + (ft.board.extra ?? 0);
    ledge(ctx, s - width / 2 - pad, s + width / 2 + pad, y0 - pad, y0 - pad + h, BOARD_DEPTH, ft.board.color, shade(ft.board.color, 1.06), out - 0.02);
  }
  const [x, , z] = f.at(s, y0, 0);
  drawText(ctx.soup, ft.text, { x, z, dir: readingDir(f), normal: [f.nx, f.nz], y: y0, cap, out: out + (ft.board ? BOARD_DEPTH : 0.02), color: ft.color, align: 'center', weight: ft.weight });
}

/** An entrance porch: the glass wall at the back of the gap, its mullions and transoms, a pair of doors, the sign board over it. */
function drawRecess(ctx, run, g, ground) {
  const ft = g.ft;
  const { f } = ctx;
  const lowest = Math.min(wallBase(run, ground, g.s0), wallBase(run, ground, g.s1));
  const yFloor = g.yb - g.base > 0.5 ? g.yb - 0.05 : Math.min(g.yb, lowest) - 0.3;
  recessBox(ctx, g, { depth: ft.depth, back: paint(ft.glass, run.i, 0.06), cheek: ft.cheek || shade(run.wallColor, 0.9), soffit: ft.soffit || shade(run.wallColor, 0.8), yFloor });
  const back = -ft.depth + 0.05;
  const n = Math.max(1, Math.round((g.s1 - g.s0) / TRANSOM_PITCH));
  for (let k = 0; k <= n; k++) {
    const s = g.s0 + ((g.s1 - g.s0) * k) / n;
    quad(ctx, s - 0.04, s + 0.04, g.yb - 0.1, g.yt, back + 0.03, ft.frame);
  }
  for (const h of ft.transoms || [DOOR_H, 4.4]) if (g.yb + h < g.yt - 0.3) quad(ctx, g.s0, g.s1, g.yb + h - 0.05, g.yb + h + 0.05, back + 0.03, ft.frame);
  if (ft.doors) {
    const sm = (g.s0 + g.s1) / 2, dw = ft.doors / 2;
    quad(ctx, sm - dw, sm + dw, g.yb, g.yb + DOOR_H, back + 0.02, shade(ft.glass, 0.55));
    for (const s of [sm - dw, sm, sm + dw]) quad(ctx, s - 0.06, s + 0.06, g.yb, g.yb + DOOR_H, back + 0.05, ft.frame);
  }
  if (ft.sign) drawSign(ctx, { ...ft.sign, out: back + 0.1 }, (g.s0 + g.s1) / 2, g.yb);
  if (ft.fascia) ledge(ctx, g.s0 - 0.2, g.s1 + 0.2, g.yt - 0.3, g.yt + 0.1, 0.3, ft.fascia);
  void f;
}

/** A flat canopy on slim posts over an entrance. */
function drawCanopy(ctx, run, ft, s, ground) {
  const base = wallBase(run, ground, s);
  const y = base + ft.y;
  const w = ft.w, d = ft.depth;
  ledge(ctx, s - w / 2, s + w / 2, y, y + ft.t, d, ft.color, shade(ft.color, 1.08));
  for (const side of [-1, 1]) {
    const sp = s + side * (w / 2 - 0.25);
    ledge(ctx, sp - 0.07, sp + 0.07, base - 0.3, y, 0.14, ft.post || [0.3, 0.3, 0.32], null, d - 0.3);
  }
  if (ft.sign) drawSign(ctx, { ...ft.sign, out: d + 0.04, y: 0.15 }, s, y);
}

/** The ecg logo: a white board, the lettering "ecg" in dark grey, three coloured dots. */
function drawLogo(ctx, run, ft, s, ground) {
  const f = ctx.f;
  const base = wallBase(run, ground, s);
  const y0 = base + ft.y;
  ledge(ctx, s - ft.w / 2, s + ft.w / 2, y0, y0 + ft.h, BOARD_DEPTH, [0.95, 0.95, 0.94], null, 0.04);
  const cap = ft.h * 0.2;
  drawSign(ctx, { text: 'ecg', cap: cap * 1.6, y: ft.h * 0.46, color: [0.18, 0.2, 0.22], out: 0.04 + BOARD_DEPTH + 0.02, weight: 0.2 }, s - ft.w * 0.08, y0);
  for (const [k, c] of [[0, [0.92, 0.55, 0.12]], [1, [0.82, 0.12, 0.16]], [2, [0.2, 0.42, 0.78]]]) {
    const sc = s + ft.w * (0.29 + k * 0.06), yc = y0 + ft.h * (0.7 - k * 0.1);
    const ring = Array.from({ length: 6 }, (_, i) => f.at(sc + Math.cos((i / 6) * Math.PI * 2) * 0.28, yc + Math.sin((i / 6) * Math.PI * 2) * 0.28, 0.04 + BOARD_DEPTH + 0.03));
    for (let i = 0; i < 6; i++) ctx.soup.tri(f.at(sc, yc, 0.04 + BOARD_DEPTH + 0.03), ring[i], ring[(i + 1) % 6], c);
  }
}

/** A coloured panel standing out of the wall (the orange strip of the Lycée Aline Mayrisch): `y0..y1` over the ground at the feature. */
function drawPanel(ctx, run, ft, s, ground) {
  const base = wallBase(run, ground, s);
  ledge(ctx, s - ft.w / 2, s + ft.w / 2, base + ft.y0, base + ft.y1, 0.2, ft.color, shade(ft.color, 1.1), 0.02);
}

/** Draws the features of a part that stand on this run. */
export function drawWallFeatures(ctx, run, part, ground) {
  for (const g of run.gaps || []) if (g.kind === 'recess') drawRecess(ctx, run, g, ground);
  for (const ft of part.ft || []) {
    if (ft.k === 'recess') continue;
    const m = matchOnRun(run, ft);
    if (!m) continue;
    if (ft.k === 'sign') drawSign(ctx, ft, m.s, wallBase(run, ground, m.s));
    else if (ft.k === 'canopy') drawCanopy(ctx, run, ft, m.s, ground);
    else if (ft.k === 'logo') drawLogo(ctx, run, ft, m.s, ground);
    else if (ft.k === 'panel') drawPanel(ctx, run, ft, m.s, ground);
    else throw new Error(`campus: unknown wall feature '${ft.k}' on part ${part.key}`);
  }
}
