/* The piste map: the painted base (map.webp from the bake: snow light and shade, rock, forests, lakes, villages) with the pistes drawn
 * live in their colours, the lifts as black lines with station dots, peak and village names. Drag to pan, pinch / wheel / buttons to zoom,
 * tap a piste to pick it. Canvas 2D, redrawn only when something changes.
 * Map clarity (22 Nov 2026, Ian on the iPad: "when the map opens you're a bit lost"):
 *   - over a free ride it opens CENTRED on the skier (~2.6 km across), with a big "you are here" arrow, his view cone and a pulse
 *   - what you can ride stays vivid: the fog of the undiscovered cells only veils the terrain under the pistes and lifts
 *   - lifts = thin black lines with a white casing, white bottom / black top station dots, their names in black pills; pistes = thick
 *     colour lines with coloured names; labels placed by priority without overlaps (villages, lifts / pistes nearest first, peaks)
 *   - buttons: + / − (smooth), ◎ back to me, ⤢ the whole area; pinch zooms round the fingers, the wheel round the pointer
 *   - an overview inset (the whole resort, the view's frame, me; tap / drag it to jump), a scale bar, an edge arrow when I am off screen
 * 2D on purpose (no 3D relief view): see HANDOFF "Map clarity". */
import { DIFF } from './config.js';

const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };
const HIT_PX = 22;
const OPEN_SPAN_M = 3000;          // the map over a free ride opens this many metres across round the skier
const MIN_SPAN_M = 320;            // the closest zoom shows this many metres across
const ANIM_MS = 260;
const YOU = '#ff6a00';             // the skier's marker: no piste colour, no lift black
const LIFT_INK = '#16171a';
const LIFT_PICK = '#ffc400';       // the picked lift's glow (free ride tab)
const FONT = 'Geist, system-ui, sans-serif';
const LABEL_MIN_S = { piste: 0.05, lift: 0.06, long: 0.13, minor: 0.42, hamlet: 0.3 };      // px per metre from which a kind of label shows
const OV_MAX = 172;                // overview inset: its longer side (CSS px)
const OV_MIN_BOX = 560;            // map box narrower than this: no inset
const CONE_PX = 64, CONE_HALF = 0.55;
const MINOR_NAME = /^Verbindung|\(Variante|^Raccordo|^Liaison|^Verbindungs/i;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - (1 - t) ** 3;

export function createPisteMap({ canvas, resort, imageUrl, pistes, onPick, onPickLift = null, onTapWorld = null }) {
  const g = canvas.getContext('2d');
  const box = canvas.parentElement;
  const img = new Image();
  let ready = false;
  img.onload = () => { ready = true; ovBase = null; draw(); };
  img.onerror = () => { console.warn('[ski] map image failed'); ready = false; draw(); };
  img.src = imageUrl;
  const W = resort.width, D = resort.depth;
  let view = { s: 1, x: 0, z: 0 };          // world point at the canvas centre, pixels per metre
  let selected = null, hover = null, best = new Map();
  // round 4A (modes): stars per piste id (mask), locked piste ids, the snow park line, the lifts of the free ride and the picked one
  let marks = { stars: new Map(), locked: new Set() }, mode = 'piste', park = null, lifts = [], liftSel = null, player = null;
  let fitScale = 1;
  // round 7-C: the fog over the cells not discovered yet (a grid-sized canvas, drawn scaled and smoothed: soft edges), the teleport pin
  let fog = null, fogCanvas = null, fogVersion = -1, pin = null, tapWorld = onTapWorld;
  // map clarity: no recentring while the map opens on the skier (showMap's piste / lift picks run in the same task), animation
  let hold = false, anim = 0, quietFocus = false, disposed = false;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  // per piste: its screen-culling box and whether its name is a minor one (connectors, variants)
  const pisteBox = new Map();
  for (const p of pistes.list) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.n; i++) { x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]); z0 = Math.min(z0, p.z[i]); z1 = Math.max(z1, p.z[i]); }
    pisteBox.set(p, { x0, z0, x1, z1, minor: MINOR_NAME.test(p.name) });
  }
  const drawnLifts = resort.lifts.filter((l) => l.kind !== 'carpet');

  // ---- DOM extras inside the map box: the overview inset, the pulse under the skier ----
  const ov = document.createElement('canvas');
  ov.className = 'mapov';
  ov.setAttribute('aria-label', 'Iwwersiicht: tipp fir dohin ze sprangen');
  const ovAspect = D / W;
  const ovW = Math.round(ovAspect > 1 ? OV_MAX / ovAspect : OV_MAX), ovH = Math.round(ovAspect > 1 ? OV_MAX : OV_MAX * ovAspect);
  ov.style.width = `${ovW}px`; ov.style.height = `${ovH}px`;
  const pulse = document.createElement('div');
  pulse.className = 'mappulse';
  pulse.hidden = true;
  box.appendChild(ov);
  box.appendChild(pulse);
  let ovBase = null;                 // the inset's static picture (image + pistes + lifts), built once the image is in

  function size() {
    const r = canvas.getBoundingClientRect();
    const k = dpr();
    if (canvas.width !== Math.round(r.width * k) || canvas.height !== Math.round(r.height * k)) { canvas.width = Math.round(r.width * k); canvas.height = Math.round(r.height * k); }
    return { w: r.width, h: r.height };
  }
  function fit() {
    const { w, h } = size();
    if (!w || !h) return;
    fitScale = Math.min(w / W, h / D) * 0.98;
    view = { s: fitScale, x: W / 2, z: D / 2 };
  }
  const toScreen = (x, z, { w, h }) => [(x - view.x) * view.s + w / 2, (z - view.z) * view.s + h / 2];
  const toWorld = (px, py, { w, h }) => [(px - w / 2) / view.s + view.x, (py - h / 2) / view.s + view.z];
  const maxScale = () => Math.max(fitScale * 9, (size().w || 800) / MIN_SPAN_M);
  function clampView(v = view) {
    v.s = clamp(v.s, fitScale * 0.9, maxScale());
    v.x = clamp(v.x, 0, W); v.z = clamp(v.z, 0, D);
    return v;
  }

  /** Smoothly to the view `to` ({x, z, s}, clamped); instant when ms = 0. */
  function animateTo(to, ms = ANIM_MS) {
    cancelAnimationFrame(anim);
    const target = clampView({ ...view, ...to });
    if (!ms) { view = target; draw(); return; }
    const from = { ...view }, t0 = performance.now();
    const step = (now) => {
      if (disposed || !canvas.isConnected) return;
      const t = ease(Math.min(1, (now - t0) / ms));
      // zoom in log space, the centre linearly: no swing past the target
      view = { s: Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * t), x: from.x + (target.x - from.x) * t, z: from.z + (target.z - from.z) * t };
      draw();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function line(pts, sz) {
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const [x, y] = toScreen(pts[i], pts[i + 1], sz); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  }
  function onScreen(bx, sz, m = 40) {
    const [ax, ay] = toScreen(bx.x0, bx.z0, sz), [cx, cy] = toScreen(bx.x1, bx.z1, sz);
    return cx >= -m && ax <= sz.w + m && cy >= -m && ay <= sz.h + m;
  }

  // ---- labels: candidates with a tier, placed greedily without overlaps ----
  const widthCache = new Map();
  function textWidth(text, font) {
    const key = font + '|' + text;
    let wv = widthCache.get(key);
    if (wv === undefined) { g.font = font; wv = g.measureText(text).width; if (widthCache.size < 4000) widthCache.set(key, wv); }
    return wv;
  }
  function placeLabels(cands, taken, sz) {
    cands.sort((a, b) => a.tier - b.tier || a.d - b.d);
    const seen = [];
    for (const c of cands) {
      const tw = textWidth(c.text, c.font), th = c.h;
      const pad = c.pill ? 5 : 2;
      const r = [c.x - tw / 2 - pad, c.y - th / 2 - 2, c.x + tw / 2 + pad, c.y + th / 2 + 2];
      if (r[0] < 2 || r[1] < 2 || r[2] > sz.w - 2 || r[3] > sz.h - 2) continue;
      if (taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1])) continue;
      // the same name twice close together (a piste in two parts, twin lifts): once is enough
      if (seen.some((s) => s.text === c.text && Math.abs(s.x - c.x) < 260 && Math.abs(s.y - c.y) < 160)) continue;
      taken.push(r); seen.push(c);
      c.draw(c, tw);
    }
  }
  const haloText = (c) => { g.font = c.font; g.lineWidth = 3.5; g.strokeStyle = '#ffffffeb'; g.lineJoin = 'round'; g.strokeText(c.text, c.x, c.y); g.fillStyle = c.fill; g.fillText(c.text, c.x, c.y); };
  const pillText = (c, tw) => {
    g.fillStyle = c.bg; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
    const x0 = c.x - tw / 2 - 5, y0 = c.y - c.h / 2 - 2, w = tw + 10, h = c.h + 4;
    g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, w, h, 4); else g.rect(x0, y0, w, h); g.fill(); g.stroke();
    g.font = c.font; g.fillStyle = c.fill; g.fillText(c.text, c.x, c.y + 0.5);
  };
  /** A point of the polyline (xs, zs, n) on screen, as near its middle as possible (null when none is). */
  function labelPoint(xs, zs, n, sz, margin = 30) {
    const mid = (n - 1) / 2;
    const steps = Math.min(n, 24);
    let bestP = null, bd = Infinity;
    for (let k = 0; k < steps; k++) {
      const i = Math.round((k / Math.max(1, steps - 1)) * (n - 1));
      const [x, y] = toScreen(xs[i], zs[i], sz);
      if (x < margin || y < margin || x > sz.w - margin || y > sz.h - margin) continue;
      const d = Math.abs(i - mid);
      if (d < bd) { bd = d; bestP = [x, y]; }
    }
    return bestP;
  }

  function draw() {
    if (disposed) return;
    const sz = size();
    if (!sz.w) return;
    const k = dpr();
    const s = view.s;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#e9edf3'; g.fillRect(0, 0, sz.w, sz.h);
    if (ready) {
      const [x0, y0] = toScreen(0, 0, sz), [x1, y1] = toScreen(W, D, sz);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    const zoom = s / fitScale;
    const lw = clamp(2 + s * 4.5, 2.2, 6.5);
    // round 7-C: fog of the undiscovered cells (free ride tab: where a tap can teleport to). Map clarity: drawn UNDER the pistes and lifts,
    // so everything you can ride stays vivid; only the terrain greys out
    if (fog && mode === 'freeride') {
      if (fogVersion !== fog.version || !fogCanvas) {
        fogCanvas = fogCanvas || document.createElement('canvas');
        fogCanvas.width = fog.nx; fogCanvas.height = fog.nz;
        const fg = fogCanvas.getContext('2d'), im = fg.createImageData(fog.nx, fog.nz);
        for (let q = 0; q < fog.bits.length; q++) { const o = q * 4; im.data[o] = 196; im.data[o + 1] = 203; im.data[o + 2] = 214; im.data[o + 3] = fog.bits[q] ? 0 : 150; }
        fg.putImageData(im, 0, 0);
        fogVersion = fog.version;
      }
      const [x0, y0] = toScreen(0, 0, sz), [x1, y1] = toScreen(fog.nx * fog.cell, fog.nz * fog.cell, sz);
      g.imageSmoothingEnabled = true;
      g.drawImage(fogCanvas, x0, y0, x1 - x0, y1 - y0);
    }
    // piste areas (faint) and lines
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const n of resort.network) {
      const col = DIFF[DIFF_OF_LETTER[n.d] || 'blue'].css;
      if (n.a) { line(n.p, sz); g.closePath(); g.fillStyle = col + '2e'; g.fill(); continue; }
      line(n.p, sz); g.strokeStyle = '#ffffffd9'; g.lineWidth = lw + 2.4; g.stroke();
      g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    }
    // lifts: thin black over a white casing (they cross the pistes), white bottom station, black top station
    const liftW = clamp(1.2 + s * 1.6, 1.3, 2.6);
    const picked = mode === 'freeride' && liftSel ? resort.lifts[liftSel.index] : null;
    if (picked) { line(picked.pts, sz); g.strokeStyle = LIFT_PICK; g.lineWidth = liftW + 9; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1; }
    for (const l of drawnLifts) { line(l.pts, sz); g.strokeStyle = '#ffffffe6'; g.lineWidth = liftW + 2.6; g.stroke(); }
    for (const l of drawnLifts) { line(l.pts, sz); g.strokeStyle = LIFT_INK; g.lineWidth = liftW; g.stroke(); }
    const rB = s < 0.08 ? 2.4 : s < 0.2 ? 3.6 : 5, rT = rB * 0.7;
    for (const l of drawnLifts) {
      const p = l.pts;
      const [ax, ay] = toScreen(p[0], p[1], sz), [bx, by] = toScreen(p[p.length - 2], p[p.length - 1], sz);
      if (Math.max(ax, bx) < -10 || Math.min(ax, bx) > sz.w + 10 || Math.max(ay, by) < -10 || Math.min(ay, by) > sz.h + 10) continue;
      g.fillStyle = LIFT_INK; g.beginPath(); g.arc(bx, by, rT, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.strokeStyle = LIFT_INK; g.lineWidth = 1.6; g.beginPath(); g.arc(ax, ay, rB, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (picked) {
      const l = liftSel, [x, y] = toScreen(l.bottom.x, l.bottom.z, sz);
      g.fillStyle = LIFT_PICK; g.strokeStyle = LIFT_INK; g.lineWidth = 2; g.beginPath(); g.arc(x, y, rB + 3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // locked pistes: a pale dashed veil over their line (round 4A)
    if (marks.locked.size && mode === 'piste') {
      g.setLineDash([5, 5]); g.strokeStyle = '#f6f6f3dd'; g.lineWidth = lw + 1;
      for (const p of pistes.list) if (marks.locked.has(p.id)) { line(Array.from(p.src.line), sz); g.stroke(); }
      g.setLineDash([]);
    }
    // the snow park: a violet band down its line
    if (park) {
      const [ax, ay] = toScreen(park.line[0], park.line[1], sz), [bx, by] = toScreen(park.line[2], park.line[3], sz);
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(6, lw * 2.4) + 3; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = '#6b3fa0'; g.lineWidth = Math.max(6, lw * 2.4); g.stroke();
    }
    // hovered / selected piste on top, thick, with start and finish
    for (const p of mode === 'piste' ? [hover, selected] : []) {
      if (!p) continue;
      line(Array.from(p.src.line), sz);
      g.strokeStyle = '#ffffff'; g.lineWidth = lw * 2.4 + 4; g.stroke();
      g.strokeStyle = DIFF[p.diff].css; g.lineWidth = lw * 2.4; g.stroke();
      if (p === selected) {
        const [sx, sy] = toScreen(p.top.x, p.top.z, sz), [ex, ey] = toScreen(p.bottom.x, p.bottom.z, sz);
        g.fillStyle = '#1f7a4d'; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#16171a'; g.fillRect(ex - 6, ey - 6, 12, 12); g.strokeRect(ex - 6, ey - 6, 12, 12);
      }
    }
    // landmarks: a small violet diamond (its name is a label below)
    for (const lm of resort.landmarks || []) {
      if (lm.house === false) continue;
      const [x, y] = toScreen(lm.x, lm.z, sz);
      if (x < -10 || y < -10 || x > sz.w + 10 || y > sz.h + 10) continue;
      g.fillStyle = '#6b3fa0'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill();
    }
    // peaks: a small triangle (names below, by height)
    const peaks = [...resort.peaks].filter((p) => p.ele).sort((a, b) => b.ele - a.ele).slice(0, zoom > 2.5 ? 60 : zoom > 1.4 ? 24 : 10);
    for (const p of peaks) {
      const [x, y] = toScreen(p.x, p.z, sz);
      if (x < -10 || y < -10 || x > sz.w + 10 || y > sz.h + 10) continue;
      g.fillStyle = '#3b3f47'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y + 2); g.lineTo(x - 4, y + 2); g.closePath(); g.fill();
    }

    // ---- labels ----
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const taken = [];
    const me = player ? toScreen(player.x, player.z, sz) : null;
    if (me) taken.push([me[0] - 24, me[1] - 44, me[0] + 24, me[1] + 18]);
    // no label under the scale bar, the buttons, the legend, the inset or the card lying over the map
    const scaleY = sz.h - 14 - (sz.w >= OV_MIN_BOX && sz.h >= 2.2 * ovH ? ovH + 10 : 0);
    taken.push([sz.w - 175, scaleY - 40, sz.w, scaleY + 6]);
    const cr = canvas.getBoundingClientRect();
    for (const el of box.querySelectorAll('.tpfirst, .zoom, .legend, .mapov, .mapcard')) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width) taken.push([r.left - cr.left - 4, r.top - cr.top - 4, r.right - cr.left + 4, r.bottom - cr.top + 4]);
    }
    const [cx, cz] = player ? [player.x, player.z] : [view.x, view.z];
    const cands = [];
    for (const pl of resort.places) {
      const big = pl.kind === 'village' || pl.kind === 'town';
      if (!big && s < LABEL_MIN_S.hamlet) continue;
      const [x, y] = toScreen(pl.x, pl.z, sz);
      cands.push({ tier: big ? 0 : 6, d: 0, text: pl.name, x, y, h: big ? 15 : 12, font: `800 ${big ? 14 : 11.5}px ${FONT}`, fill: '#5a3a1e', draw: haloText });
    }
    if (park) { const [x, y] = toScreen(park.line[0], park.line[1], sz); cands.push({ tier: 1, d: 0, text: park.name || 'Snowpark', x, y: y - 13, h: 13, font: `800 12px ${FONT}`, fill: '#6b3fa0', draw: haloText }); }
    if (s >= LABEL_MIN_S.lift) {
      for (const l of lifts) {
        const src = resort.lifts[l.index];
        if (!src || src.kind === 'carpet') continue;
        const [ax, ay] = toScreen(l.bottom.x, l.bottom.z, sz), [bx, by] = toScreen(l.top.x, l.top.z, sz);
        if (Math.hypot(bx - ax, by - ay) < 70) continue;
        const n = src.pts.length / 2, xs = [], zs = [];
        for (let i = 0; i < n; i++) { xs.push(src.pts[2 * i]); zs.push(src.pts[2 * i + 1]); }
        const at = labelPoint(xs, zs, n, sz);
        if (!at) continue;
        const text = /^\d[\d\s.]*$/.test(l.name) ? `Lift ${l.name}` : l.name;
        const d = Math.hypot((l.bottom.x + l.top.x) / 2 - cx, (l.bottom.z + l.top.z) / 2 - cz);
        cands.push({ tier: l === liftSel ? 1 : 3, d, text, x: at[0], y: at[1], h: 12, font: `700 11px ${FONT}`, fill: '#ffffff', bg: LIFT_INK, pill: true, draw: pillText });
      }
    }
    if (s >= LABEL_MIN_S.piste) {
      for (const p of pistes.list) {
        const bx = pisteBox.get(p);
        if (bx.minor && s < LABEL_MIN_S.minor && p !== selected) continue;
        if (s < LABEL_MIN_S.long && p.length < 1500) continue;                 // zoomed out: only the long pistes are named
        if (!onScreen(bx, sz, 0)) continue;
        const at = labelPoint(p.x, p.z, p.n, sz);
        if (!at) continue;
        const d = Math.hypot((bx.x0 + bx.x1) / 2 - cx, (bx.z0 + bx.z1) / 2 - cz) + (bx.minor ? 1500 : 0);
        cands.push({ tier: p === selected && mode === 'piste' ? 1 : 3, d, text: p.name, x: at[0], y: at[1] - 10, h: 13, font: `800 12px ${FONT}`, fill: DIFF[p.diff].css, draw: haloText });
      }
    }
    for (const lm of resort.landmarks || []) {
      if (lm.house === false) continue;
      const [x, y] = toScreen(lm.x, lm.z, sz);
      cands.push({ tier: 4, d: 0, text: lm.kind === 'worldcup' ? `${lm.name} (Weltcup)` : lm.name, x, y: y - 14, h: 12, font: `700 11px ${FONT}`, fill: '#6b3fa0', draw: haloText });
    }
    peaks.forEach((p, i) => {
      const [x, y] = toScreen(p.x, p.z, sz);
      cands.push({ tier: 5, d: i, text: `${p.name} ${Math.round(p.ele)}`, x, y: y + 12, h: 11, font: `600 10.5px ${FONT}`, fill: '#2c2f36', draw: haloText });
    });
    placeLabels(cands, taken, sz);

    // stars won per piste (gold) once zoomed in a little, and always on the picked piste (round 4A)
    if (mode === 'piste' && marks.stars.size) {
      for (const p of pistes.list) {
        const mask = marks.stars.get(p.id) || 0;
        if (!mask || (zoom < 1.5 && p !== selected)) continue;
        const m = p.at(p.length * 0.45, {});
        const [x, y] = toScreen(m.x, m.z, sz);
        if (x < 0 || y < 0 || x > sz.w || y > sz.h) continue;
        const text = [1, 2, 4].map((b) => (mask & b ? '★' : '☆')).join('');
        haloText({ text, x, y: y + 8, font: `700 12px ${FONT}`, fill: '#c48a00' });
      }
    }
    // round 7-C: the teleport pin (where the finger went down) and the safe spot it snaps to
    if (pin) {
      const [x, y] = toScreen(pin.x, pin.z, sz);
      if (pin.spot) {
        const [sx, sy] = toScreen(pin.spot.x, pin.spot.z, sz);
        g.setLineDash([4, 4]); g.strokeStyle = '#16171a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(sx, sy); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#1f7a4d'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.strokeStyle = pin.ok ? '#16171a' : '#a32121'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
    }
    drawPlayer(sz, me);
    drawScale(sz);
    drawOverview(sz);
  }

  /** The skier: view cone, a big orange arrow with a white ring, "Du" in a pill; off screen an arrow at the edge pointing to him. */
  function drawPlayer(sz, me) {
    if (!player || !me) { pulse.hidden = true; return; }
    const [x, y] = me;
    const h = Number.isFinite(player.heading) ? player.heading : null;
    const inside = x >= 0 && y >= 0 && x <= sz.w && y <= sz.h;
    pulse.hidden = !inside;
    if (inside) pulse.style.transform = `translate(${x}px, ${y}px)`;
    if (!inside) {
      const m = 30, ex = clamp(x, m, sz.w - m), ey = clamp(y, m, sz.h - m), a = Math.atan2(y - ey, x - ex);
      g.save(); g.translate(ex, ey);
      g.fillStyle = YOU; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, 0, 17, 0, Math.PI * 2); g.fill(); g.stroke();
      g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(11, 0); g.lineTo(-3, 7); g.lineTo(-3, -7); g.closePath(); g.fill();
      g.restore();
      g.font = `800 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      haloText({ text: 'Du', x: ex, y: ey + (ey > sz.h / 2 ? -27 : 27), font: `800 12px ${FONT}`, fill: '#b34400' });
      return;
    }
    if (h !== null) {
      const grad = g.createRadialGradient(x, y, 4, x, y, CONE_PX);
      grad.addColorStop(0, 'rgba(255,106,0,0.55)'); grad.addColorStop(1, 'rgba(255,106,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, CONE_PX, h - CONE_HALF, h + CONE_HALF); g.closePath(); g.fill();
    }
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6;
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
    g.restore();
    g.fillStyle = YOU; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(x, y); g.rotate(h ?? -Math.PI / 2);
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 6); g.lineTo(-2, 0); g.lineTo(-5, -6); g.closePath(); g.fill();
    g.restore();
    // "Du" pill above
    g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = textWidth('Du', g.font);
    g.fillStyle = YOU; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); if (g.roundRect) g.roundRect(x - tw / 2 - 7, y - 37, tw + 14, 18, 9); else g.rect(x - tw / 2 - 7, y - 37, tw + 14, 18); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.fillText('Du', x, y - 27.5);
  }

  /** A scale bar (100-ish px, a round number of metres) and a north arrow, bottom right above the inset. */
  function drawScale(sz) {
    const want = 110 / view.s, p10 = 10 ** Math.floor(Math.log10(want));
    const metres = [1, 2, 5, 10].map((m) => m * p10).filter((m) => m <= want).pop() || p10;
    const px = metres * view.s;
    const right = sz.w - 12, y = sz.h - 14 - (sz.w >= OV_MIN_BOX && sz.h >= 2.2 * ovH ? ovH + 10 : 0);
    g.lineCap = 'butt';
    g.strokeStyle = '#ffffffe6'; g.lineWidth = 6; g.beginPath(); g.moveTo(right - px, y); g.lineTo(right, y); g.stroke();
    g.strokeStyle = '#16171a'; g.lineWidth = 2; g.beginPath(); g.moveTo(right - px, y - 4); g.lineTo(right - px, y); g.lineTo(right, y); g.lineTo(right, y - 4); g.stroke();
    g.lineCap = 'round';
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    haloText({ text: metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x: right, y: y - 5, font: `700 11px ${FONT}`, fill: '#16171a' });
    // north
    const nx = right - px - 20, ny = y - 6;
    g.fillStyle = '#16171a'; g.beginPath(); g.moveTo(nx, ny - 12); g.lineTo(nx + 5, ny + 1); g.lineTo(nx, ny - 2); g.lineTo(nx - 5, ny + 1); g.closePath(); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    haloText({ text: 'N', x: nx, y: ny - 19, font: `800 10px ${FONT}`, fill: '#16171a' });
  }

  /** The overview inset: the whole resort (built once), the frame of the view, me. Hidden in a narrow map box. */
  function drawOverview(sz) {
    const show = sz.w >= OV_MIN_BOX && sz.h >= 2.2 * ovH;
    ov.hidden = !show;
    if (!show) return;
    const k = dpr();
    if (ov.width !== Math.round(ovW * k)) { ov.width = Math.round(ovW * k); ov.height = Math.round(ovH * k); ovBase = null; }
    const o = ov.getContext('2d');
    const sx = ovW / W, sz2 = ovH / D;
    if (!ovBase) {
      ovBase = document.createElement('canvas');
      ovBase.width = ov.width; ovBase.height = ov.height;
      const b = ovBase.getContext('2d');
      b.setTransform(k, 0, 0, k, 0, 0);
      b.fillStyle = '#e9edf3'; b.fillRect(0, 0, ovW, ovH);
      if (ready) b.drawImage(img, 0, 0, ovW, ovH);
      b.lineWidth = 1; b.lineJoin = 'round';
      for (const n of resort.network) {
        if (n.a) continue;
        b.strokeStyle = DIFF[DIFF_OF_LETTER[n.d] || 'blue'].css;
        b.beginPath(); for (let i = 0; i < n.p.length; i += 2) { const X = n.p[i] * sx, Y = n.p[i + 1] * sz2; if (i) b.lineTo(X, Y); else b.moveTo(X, Y); } b.stroke();
      }
      b.strokeStyle = LIFT_INK; b.lineWidth = 0.8;
      for (const l of drawnLifts) { b.beginPath(); for (let i = 0; i < l.pts.length; i += 2) { const X = l.pts[i] * sx, Y = l.pts[i + 1] * sz2; if (i) b.lineTo(X, Y); else b.moveTo(X, Y); } b.stroke(); }
    }
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.drawImage(ovBase, 0, 0);
    o.setTransform(k, 0, 0, k, 0, 0);
    const [wx0, wz0] = toWorld(0, 0, sz), [wx1, wz1] = toWorld(sz.w, sz.h, sz);
    const rx = clamp(wx0 * sx, -2, ovW), ry = clamp(wz0 * sz2, -2, ovH), rw = clamp(wx1 * sx, 0, ovW + 2) - rx, rh = clamp(wz1 * sz2, 0, ovH + 2) - ry;
    o.fillStyle = 'rgba(22,23,26,0.10)'; o.fillRect(rx, ry, rw, rh);
    o.strokeStyle = '#16171a'; o.lineWidth = 1.5; o.strokeRect(rx, ry, rw, rh);
    if (player) {
      const px = player.x * sx, py = player.z * sz2;
      o.fillStyle = YOU; o.strokeStyle = '#fff'; o.lineWidth = 1.5;
      o.beginPath(); o.arc(px, py, 4.5, 0, Math.PI * 2); o.fill(); o.stroke();
    }
  }

  function pickAt(px, py, radius = HIT_PX) {
    const sz = size();
    let bestD = radius, found = null;
    for (const p of pistes.list) {
      if (!onScreen(pisteBox.get(p), sz, radius)) continue;
      for (let i = 0; i + 1 < p.n; i++) {
        const [ax, ay] = toScreen(p.x[i], p.z[i], sz), [bx, by] = toScreen(p.x[i + 1], p.z[i + 1], sz);
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
        const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
        if (d < bestD) { bestD = d; found = p; }
      }
    }
    return found;
  }

  // pointer: drag pans, two fingers pinch (round their middle, and pan with it), a short tap picks
  const ptrs = new Map();
  let downAt = null, pinch0 = null, moved = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    canvas.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { downAt = { x: e.clientX, y: e.clientY, view: { ...view } }; moved = 0; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], r = canvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s, world: toWorld(mx, my, size()) };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { const [px, py] = local(e); const h = mode === 'piste' ? pickAt(px, py) : null; if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; draw(); } }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()], r = canvas.getBoundingClientRect(), sz = size();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      view.s = clamp(pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0.d), fitScale * 0.9, maxScale());
      // the world point that was under the fingers' middle stays under it
      view.x = pinch0.world[0] - (mx - sz.w / 2) / view.s; view.z = pinch0.world[1] - (my - sz.h / 2) / view.s;
      clampView(); draw(); moved = 99; return;
    }
    if (downAt) {
      const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > 6) { view.x = downAt.view.x - dx / view.s; view.z = downAt.view.z - dy / view.s; clampView(); draw(); }
    }
  });
  const up = (e) => {
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    if (ptrs.size === 1) { const [q] = [...ptrs.values()]; downAt = { x: q.x, y: q.y, view: { ...view } }; }      // pinch -> one finger pans on
    if (had && ptrs.size === 0 && downAt && moved <= 6 && e.type === 'pointerup') {
      const [px, py] = local(e);
      if (mode === 'freeride' && (onPickLift || tapWorld)) {
        // round 7-C: a tap right on a lift's bottom dot picks the lift (round 6); anywhere else it asks to teleport to that exact spot
        const l = liftAt(px, py, 12);
        // map clarity: a lift picked on the map stays where it is (no jump) and also gets the card (info + teleport) like any tap
        if (l && onPickLift) { liftSel = l; quietFocus = true; try { onPickLift(l); } finally { quietFocus = false; } draw(); }
        if (tapWorld) { const [wx, wz] = toWorld(px, py, size()); tapWorld(wx, wz, l || null); }
      } else if (mode === 'piste') {
        const p = pickAt(px, py);
        if (p) { select(p); onPick(p); }
        // R8e (3V QA: tapping the empty map in the piste tab did nothing): off every piste the same teleport ask as the free ride tab
        // (discovered -> "Hei hin teleportéieren?" to the nearest safe spot, else "Nach net entdeckt")
        else if (tapWorld) { const [wx, wz] = toWorld(px, py, size()); tapWorld(wx, wz); }
      }
    }
    if (ptrs.size === 0) downAt = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e), sz = size(), [wx, wz] = toWorld(px, py, sz);
    const s = clamp(view.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), fitScale * 0.9, maxScale());
    cancelAnimationFrame(anim);
    view = clampView({ s, x: wx - (px - sz.w / 2) / s, z: wz - (py - sz.h / 2) / s });
    draw();
  }, { passive: false });

  // the overview inset: tap or drag = look there
  let ovDrag = false;
  const ovJump = (e, ms) => {
    const r = ov.getBoundingClientRect();
    animateTo({ x: clamp((e.clientX - r.left) / r.width, 0, 1) * W, z: clamp((e.clientY - r.top) / r.height, 0, 1) * D, s: Math.max(view.s, fitScale * 1.6) }, ms);
  };
  ov.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ovDrag = true; ov.setPointerCapture?.(e.pointerId); ovJump(e, ANIM_MS); });
  ov.addEventListener('pointermove', (e) => { if (ovDrag) ovJump(e, 0); });
  const ovUp = () => { ovDrag = false; };
  ov.addEventListener('pointerup', ovUp);
  ov.addEventListener('pointercancel', ovUp);

  function zoomBy(k) { animateTo({ s: view.s * k }); }
  /** The lift whose top is nearest the tap (within 28 px), or its line (round 4A free ride). */
  function liftAt(px, py, radius = 28) {
    const sz = size();
    let bd = radius, found = null;
    for (const l of lifts) {
      const [x0, y0] = toScreen(l.top.x, l.top.z, sz), [x, y] = toScreen(l.bottom.x, l.bottom.z, sz);
      const dx = x - x0, dy = y - y0, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
      const d = Math.min(Math.hypot(px - x, py - y) * 0.8, Math.hypot(px - x0 - dx * t, py - y0 - dy * t) + 6);
      if (d < bd) { bd = d; found = l; }
    }
    return found;
  }
  /** Centre on a world box [x0, z0, x1, z1] with a margin (m). Not while the map opens on the skier, nor for a pick made on the map. */
  function focusBox(x0, z0, x1, z1, margin = 900) {
    const sz = size();
    if (!sz.w || hold || quietFocus) { draw(); return; }
    animateTo({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, s: Math.max(view.s, Math.min(sz.w / (Math.abs(x1 - x0) + margin), sz.h / (Math.abs(z1 - z0) + margin))) });
  }
  function select(p, center = false) {
    selected = p;
    if (center && p && !hold) {
      const sz = size();
      if (!sz.w) return;
      const bx = pisteBox.get(p);
      view.x = (bx.x0 + bx.x1) / 2; view.z = (bx.z0 + bx.z1) / 2;
      view.s = Math.max(view.s, Math.min(sz.w / (bx.x1 - bx.x0 + 1200), sz.h / (bx.z1 - bx.z0 + 1200)));
      clampView();
    }
    draw();
  }
  function centerOnPlayer(ms = ANIM_MS) {
    if (!player) return;
    const sz = size();
    animateTo({ x: player.x, z: player.z, s: Math.max(fitScale * 1.2, (sz.w || 800) / OPEN_SPAN_M) }, ms);
    pulse.classList.remove('go'); void pulse.offsetWidth; pulse.classList.add('go');      // restart the pulse
  }
  function fitAll() { animateTo({ x: W / 2, z: D / 2, s: fitScale }); }

  // the extra buttons in the zoom column (ui.js): ◎ back to me, ⤢ the whole area
  const meBtn = box.querySelector('[data-mz="me"]'), fitBtn = box.querySelector('[data-mz="fit"]');
  if (meBtn) { meBtn.hidden = true; meBtn.addEventListener('click', () => centerOnPlayer()); }
  if (fitBtn) fitBtn.addEventListener('click', fitAll);

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) { dispose(); return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { const keep = { ...view }; fit(); if (keep.s > fitScale) view = keep; clampView(); draw(); }, 60);
  });
  ro.observe(canvas);
  canvas.addEventListener('ski-map-close', () => dispose());
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(anim); clearTimeout(resizeTimer); ro.disconnect();
    img.onload = img.onerror = null;
    ov.remove(); pulse.remove();
    fogCanvas = null; ovBase = null; widthCache.clear();
  }
  fit();
  return {
    draw, select, zoomBy, fit: () => { fit(); draw(); }, setBest(m) { best = m; draw(); }, get selected() { return selected; }, screenOf: (p) => toScreen(p.x, p.z, size()),
    /** Round 4A: stars / locks per piste, the park, the mode ('piste' | 'park' | 'freeride') with its lifts. */
    setMarks(next) { marks = { stars: next.stars || new Map(), locked: next.locked || new Set() }; draw(); },
    setPark(p) { park = p; draw(); },
    setMode(m, liftList = lifts) { mode = m; lifts = liftList; draw(); },
    /** Round 6: the skier's spot (null = none). Map clarity: + his heading (rad, screen x = east, y = south); the map opens centred on
     * him and nothing the opening picks recentres it (hold until the task ends). */
    setPlayer(x, z, heading = null) {
      player = Number.isFinite(x) ? { x, z, heading: Number.isFinite(heading) ? heading : null } : null;
      if (meBtn) meBtn.hidden = !player;
      box.dataset.you = player ? '1' : '';
      if (player) {
        hold = true; setTimeout(() => { hold = false; }, 0);
        const sz = size();
        view = clampView({ x, z, s: Math.max(fitScale * 1.2, (sz.w || 800) / OPEN_SPAN_M) });
        pulse.classList.remove('go'); void pulse.offsetWidth; pulse.classList.add('go');
      }
      draw();
    },
    centerOnPlayer, fitAll,
    selectLift(l, center = false) { liftSel = l; if (center && l) focusBox(Math.min(l.top.x, l.bottom.x), Math.min(l.top.z, l.bottom.z), Math.max(l.top.x, l.bottom.x), Math.max(l.top.z, l.bottom.z), 1400); else draw(); },
    focusBox, liftAt,
    /** Map clarity: the piste drawn under a world point (within HIT_PX on screen), for the tap card. */
    pisteAt(x, z, radius = 14) { const [px, py] = toScreen(x, z, size()); return pickAt(px, py, radius); },
    /** Round 7-C: the discovery fog (modes/discovery.js), the tap-to-teleport handler, the pin; CSS pixels <-> world metres. */
    setFog(d) { fog = d; fogVersion = -1; draw(); },
    setTapWorld(fn) { tapWorld = fn; },
    setPin(p) { pin = p; draw(); },
    screenXY: (x, z) => toScreen(x, z, size()),
    worldXY: (px, py) => toWorld(px, py, size()),
    get zoom() { return view.s / fitScale; },
    /** Metres -> CSS px now. */
    get scale() { return view.s; },
    center(x, z, zoom = 3) { cancelAnimationFrame(anim); view.x = x; view.z = z; view.s = Math.max(view.s, fitScale * zoom); clampView(); draw(); },
    dispose,
  };
}
