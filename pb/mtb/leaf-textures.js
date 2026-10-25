/* The foliage atlas, painted with canvas strokes at start-up (no photographs): 8 tiles of 256 px in a 4 x 2 grid, alpha-tested by the forest shader.
 *   0 beech sprig  1 oak sprig  2 fern frond  3 holly / shrub leaves  4 grass tuft  5 bramble  6 spruce twig  7 meadow herbs
 * The colour canvas is opaque (the background carries the average leaf colour, so mip-mapping never pulls dark fringes into the leaves) and the alpha
 * comes from a second canvas. Every tile is drawn from a seed: same picture every run. */
import { createRng } from './noise.js';

const TILE = 256;
const COLS = 4, ROWS = 2;
const TAU = Math.PI * 2;
export const ATLAS = Object.freeze({ cols: COLS, rows: ROWS, tile: TILE });
export const TILE_ID = Object.freeze({ beech: 0, oak: 1, fern: 2, shrub: 3, grass: 4, bramble: 5, spruce: 6, herbs: 7 });

/** uv rectangle [u0, v0, u1, v1] of a tile (a one-pixel inset keeps neighbouring tiles out of the filter footprint). */
export function tileRect(id) {
  const c = id % COLS, r = Math.floor(id / COLS), inset = 1.5 / (TILE * COLS), insetV = 1.5 / (TILE * ROWS);
  return [c / COLS + inset, 1 - (r + 1) / ROWS + insetV, (c + 1) / COLS - inset, 1 - r / ROWS - insetV];
}

const rgb = (c, j, rng) => { const k = () => (rng() - 0.5) * 2 * j; return `rgb(${Math.max(0, Math.min(255, c[0] + k())) | 0},${Math.max(0, Math.min(255, c[1] + k())) | 0},${Math.max(0, Math.min(255, c[2] + k())) | 0})`; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Draws `fn(ctx, mask)` twice: colour pass on the colour context and shape pass (white) on the mask context. */
function dual(color, mask, fn) {
  fn(color, false);
  fn(mask, true);
}

function leafShape(ctx, len, wid, lobes) {
  ctx.beginPath();
  if (!lobes) {
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.22, -wid * 1.05, len * 0.72, -wid * 0.85, len, 0);
    ctx.bezierCurveTo(len * 0.72, wid * 0.85, len * 0.22, wid * 1.05, 0, 0);
  } else {                                           // oak: wavy lobed outline
    const steps = 7;
    ctx.moveTo(0, 0);
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, x = len * t, w = wid * Math.sin(Math.PI * Math.pow(t, 0.8)) * (i % 2 === 0 ? 0.55 : 1.0);
        ctx.lineTo(x * (side > 0 ? 1 : 1), side * w);
        if (side < 0 && i === steps) ctx.lineTo(len, 0);
      }
      if (side < 0) ctx.moveTo(0, 0);
    }
    ctx.closePath();
  }
}

function drawLeaf(ctx, isMask, x, y, ang, len, wid, base, tip, rng, lobes, veins = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  leafShape(ctx, len, wid, lobes);
  if (isMask) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore(); return; }
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, rgb(base, 8, rng)); g.addColorStop(1, rgb(tip, 8, rng));
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(30,50,12,0.28)'; ctx.stroke();      // a dark edge: painted, readable at distance
  if (veins) {
    ctx.strokeStyle = 'rgba(214,226,120,0.55)'; ctx.lineWidth = Math.max(0.7, wid * 0.07);
    ctx.beginPath(); ctx.moveTo(len * 0.04, 0); ctx.lineTo(len * 0.92, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(214,226,120,0.28)'; ctx.lineWidth = 0.7;
    for (let k = 1; k <= 5; k++) { const t = k / 6; ctx.beginPath(); ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.18), -wid * 0.7 * (1 - t * 0.5)); ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.18), wid * 0.7 * (1 - t * 0.5)); ctx.stroke(); }
  }
  ctx.restore();
}

/** A sprig: a curved twig growing up from the bottom of the tile with leaves along it. */
function sprig(color, mask, ox, oy, rng, opts) {
  const { leaves, leafLen, leafWid, base, tip, lobes, twig } = opts;
  const pts = [];
  const bend = (rng() - 0.5) * 0.9;
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([ox + Math.sin(t * 2.2 + bend) * 26 * t, oy - t * 214]); }
  dual(color, mask, (ctx, isMask) => {
    ctx.strokeStyle = isMask ? '#fff' : twig; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
  });
  const drawn = [];
  for (let i = 0; i < leaves; i++) {
    const t = 0.1 + 0.9 * (i / (leaves - 1));
    const p = pts[Math.min(12, Math.round(t * 12))];
    const side = i % 2 === 0 ? -1 : 1;
    const scale = 1.05 - 0.45 * t;
    const ang = -Math.PI / 2 + side * (0.75 + rng() * 0.55) * (1 - 0.25 * t) + (rng() - 0.5) * 0.25;
    drawn.push({ x: p[0], y: p[1], ang, len: leafLen * scale * (0.85 + rng() * 0.3), wid: leafWid * scale * (0.85 + rng() * 0.3), k: rng() });
  }
  drawn.push({ x: pts[12][0], y: pts[12][1], ang: -Math.PI / 2 + (rng() - 0.5) * 0.3, len: leafLen * 0.62, wid: leafWid * 0.62, k: 0.5 });     // terminal leaf
  for (const d of drawn) {
    dual(color, mask, (ctx, isMask) => drawLeaf(ctx, isMask, d.x, d.y, d.ang, d.len, d.wid, mix(base, tip, 0.12 * d.k), mix(base, tip, 0.55 + 0.4 * d.k), rng, lobes));
  }
}

function fernFrond(color, mask, rng) {
  const cx = 128, bottom = 250;
  const spine = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; spine.push([cx + Math.sin(t * 1.6 - 0.5) * 30 * t * t, bottom - t * 238]); }
  dual(color, mask, (ctx, isMask) => { ctx.strokeStyle = isMask ? '#fff' : 'rgb(70,108,40)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(spine[0][0], spine[0][1]); for (const p of spine) ctx.lineTo(p[0], p[1]); ctx.stroke(); });
  for (let i = 3; i < 16; i++) {
    const t = i / 16, p = spine[i], q = spine[i - 1];
    const dir = Math.atan2(p[1] - q[1], p[0] - q[0]);
    const len = 62 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - 0.35 * t) + 6;
    for (const side of [-1, 1]) {
      const ang = dir + side * (1.15 - 0.45 * t) + (rng() - 0.5) * 0.12;
      const base = mix([46, 92, 30], [78, 128, 40], rng()), tip = mix([96, 148, 50], [138, 172, 66], rng());
      dual(color, mask, (ctx, isMask) => drawLeaf(ctx, isMask, p[0], p[1], ang, len, len * 0.2, base, tip, rng, false, false));
    }
  }
  dual(color, mask, (ctx, isMask) => drawLeaf(ctx, isMask, spine[16][0], spine[16][1], -Math.PI / 2 + 0.1, 24, 5, [70, 120, 40], [130, 168, 60], rng, false, false));
}

function shrubLeaves(color, mask, rng, spiky) {
  for (let i = 0; i < 26; i++) {
    const x = 28 + rng() * 200, y = 28 + rng() * 200, ang = rng() * TAU, len = 54 + rng() * 22, wid = len * 0.34;
    const base = spiky ? mix([18, 52, 24], [30, 76, 34], rng()) : mix([44, 84, 28], [64, 106, 36], rng());
    const tip = spiky ? mix([40, 98, 44], [86, 132, 62], rng()) : mix([84, 130, 44], [126, 160, 60], rng());
    dual(color, mask, (ctx, isMask) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, 0);
      const spikes = spiky ? 5 : 0;
      if (spiky) {
        for (let s = 1; s <= spikes; s++) { const t = s / spikes; ctx.lineTo(len * (t - 0.08), -wid * Math.sin(Math.PI * t) * 0.85); ctx.lineTo(len * t, -wid * Math.sin(Math.PI * t) * 1.15); }
        ctx.lineTo(len * 1.06, 0);
        for (let s = spikes; s >= 1; s--) { const t = s / spikes; ctx.lineTo(len * t, wid * Math.sin(Math.PI * t) * 1.15); ctx.lineTo(len * (t - 0.08), wid * Math.sin(Math.PI * t) * 0.85); }
        ctx.closePath();
      } else {
        ctx.bezierCurveTo(len * 0.2, -wid, len * 0.75, -wid * 0.9, len, 0); ctx.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.2, wid, 0, 0);
      }
      if (isMask) { ctx.fillStyle = '#fff'; ctx.fill(); } else {
        const g = ctx.createLinearGradient(0, -wid, 0, wid); g.addColorStop(0, rgb(tip, 6, rng)); g.addColorStop(1, rgb(base, 6, rng));
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(10,30,10,0.4)'; ctx.lineWidth = 0.9; ctx.stroke();
        ctx.strokeStyle = 'rgba(190,220,140,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke();
      }
      ctx.restore();
    });
  }
}

function grassTuft(color, mask, rng) {
  const blades = 22;
  for (let i = 0; i < blades; i++) {
    const x0 = 56 + rng() * 144, h = 120 + rng() * 120, lean = (rng() - 0.5) * 90, w = 5 + rng() * 5;
    const base = mix([40, 64, 20], [62, 92, 26], rng()), tip = mix([120, 140, 52], [190, 184, 84], rng());
    dual(color, mask, (ctx, isMask) => {
      ctx.beginPath(); ctx.moveTo(x0 - w, 254);
      ctx.quadraticCurveTo(x0 - w * 0.5 + lean * 0.3, 254 - h * 0.55, x0 + lean, 254 - h);
      ctx.quadraticCurveTo(x0 + w * 0.5 + lean * 0.3, 254 - h * 0.5, x0 + w, 254); ctx.closePath();
      if (isMask) { ctx.fillStyle = '#fff'; ctx.fill(); return; }
      const g = ctx.createLinearGradient(0, 254, 0, 254 - h); g.addColorStop(0, rgb(base, 6, rng)); g.addColorStop(1, rgb(tip, 8, rng));
      ctx.fillStyle = g; ctx.fill();
    });
  }
}

function bramble(color, mask, rng) {
  for (let c = 0; c < 4; c++) {                                    // arching canes with small leaflets
    const x0 = 30 + rng() * 196, y0 = 250, x1 = x0 + (rng() - 0.5) * 140, y1 = 30 + rng() * 90;
    const cx = (x0 + x1) / 2 + (rng() - 0.5) * 60, cy = Math.min(y0, y1) - 30;
    dual(color, mask, (ctx, isMask) => { ctx.strokeStyle = isMask ? '#fff' : 'rgb(96,60,50)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke(); });
    for (let k = 1; k <= 7; k++) {
      const t = k / 7, u = 1 - t, px = u * u * x0 + 2 * u * t * cx + t * t * x1, py = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const ang = (rng() - 0.5) * TAU, len = 40 + rng() * 18;
      dual(color, mask, (ctx, isMask) => drawLeaf(ctx, isMask, px, py, ang, len, len * 0.36, mix([40, 78, 26], [62, 104, 34], rng()), mix([94, 140, 50], [130, 168, 66], rng()), rng, false));
    }
  }
}

function spruceTwig(color, mask, rng) {
  const cx = 128;
  dual(color, mask, (ctx, isMask) => { ctx.strokeStyle = isMask ? '#fff' : 'rgb(80,56,38)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, 252); ctx.lineTo(cx + 8, 8); ctx.stroke(); });
  for (let i = 0; i < 60; i++) {
    const t = i / 60, y = 244 - t * 232, x = cx + 8 * t, side = i % 2 ? 1 : -1, len = 70 * (1 - 0.6 * t) + 10, ang = -Math.PI / 2 + side * (1.05 - 0.2 * t) + (rng() - 0.5) * 0.3;
    const dark = mix([20, 56, 38], [34, 82, 52], rng()), light = mix([52, 108, 62], [88, 140, 76], rng());
    dual(color, mask, (ctx, isMask) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.lineCap = 'round';
      ctx.strokeStyle = isMask ? '#fff' : rgb(rng() < 0.5 ? dark : light, 6, rng); ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, (rng() - 0.5) * 6); ctx.stroke(); ctx.restore();
    });
  }
}

function herbs(color, mask, rng) {
  grassTuft(color, mask, rng);
  for (let i = 0; i < 9; i++) {
    const x = 40 + rng() * 176, y = 40 + rng() * 120, r = 5 + rng() * 5, white = rng() < 0.55;
    dual(color, mask, (ctx, isMask) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = isMask ? '#fff' : white ? 'rgb(246,242,226)' : 'rgb(240,200,70)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 8, 252); ctx.strokeStyle = isMask ? '#fff' : 'rgb(70,100,36)'; ctx.lineWidth = 2; ctx.stroke();
    });
  }
}

const PAINTERS = [
  (c, m, rng, ox, oy) => sprig(c, m, ox, oy, rng, { leaves: 13, leafLen: 74, leafWid: 31, base: [52, 98, 26], tip: [118, 158, 52], lobes: false, twig: 'rgb(92,70,50)' }),
  (c, m, rng, ox, oy) => sprig(c, m, ox, oy, rng, { leaves: 10, leafLen: 84, leafWid: 34, base: [58, 92, 28], tip: [112, 144, 52], lobes: true, twig: 'rgb(80,62,46)' }),
  (c, m, rng) => fernFrond(c, m, rng),
  (c, m, rng) => shrubLeaves(c, m, rng, true),
  (c, m, rng) => grassTuft(c, m, rng),
  (c, m, rng) => bramble(c, m, rng),
  (c, m, rng) => spruceTwig(c, m, rng),
  (c, m, rng) => herbs(c, m, rng),
];
const BACKGROUND = [[70, 112, 36], [72, 106, 38], [78, 120, 44], [38, 84, 40], [96, 112, 44], [70, 108, 40], [40, 88, 56], [96, 112, 48]];

/** Paints the atlas. Returns { data: Uint8Array RGBA (width x height), width, height }; the caller wraps it in a texture. */
export function paintLeafAtlas() {
  const w = TILE * COLS, h = TILE * ROWS;
  const color = document.createElement('canvas'); color.width = w; color.height = h;
  const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
  const cc = color.getContext('2d'), mc = mask.getContext('2d');
  mc.fillStyle = '#000'; mc.fillRect(0, 0, w, h);
  for (let id = 0; id < PAINTERS.length; id++) {
    const col = id % COLS, row = Math.floor(id / COLS);
    cc.save(); mc.save();
    cc.beginPath(); cc.rect(col * TILE, row * TILE, TILE, TILE); cc.clip(); mc.beginPath(); mc.rect(col * TILE, row * TILE, TILE, TILE); mc.clip();
    cc.translate(col * TILE, row * TILE); mc.translate(col * TILE, row * TILE);
    cc.fillStyle = `rgb(${BACKGROUND[id].join(',')})`; cc.fillRect(0, 0, TILE, TILE);
    const rng = createRng(900 + id * 17);
    PAINTERS[id](cc, mc, rng, 118, 250);
    cc.restore(); mc.restore();
  }
  const cd = cc.getImageData(0, 0, w, h).data, md = mc.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {                                      // flipped: data row 0 is the BOTTOM of the picture (v = 0), like every GL texture
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4; out[o] = cd[i]; out[o + 1] = cd[i + 1]; out[o + 2] = cd[i + 2]; out[o + 3] = md[i]; }
  }
  return { data: out, width: w, height: h };
}
