/* The piste map: the painted base (map.webp from the bake: snow light and shade, rock, forests, lakes, villages) with the pistes drawn
 * live in their colours, the lifts as black lines with station dots, peak and village names. Drag to pan, pinch / wheel / buttons to zoom,
 * tap a piste to pick it. Canvas 2D, redrawn only when something changes. */
import { DIFF } from './config.js';

const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };
const HIT_PX = 22;

export function createPisteMap({ canvas, resort, imageUrl, pistes, onPick }) {
  const g = canvas.getContext('2d');
  const img = new Image();
  let ready = false;
  img.onload = () => { ready = true; draw(); };
  img.onerror = () => { console.warn('[ski] map image failed'); ready = false; draw(); };
  img.src = imageUrl;
  const W = resort.width, D = resort.depth;
  let view = { s: 1, x: 0, z: 0 };          // world point at the canvas centre, pixels per metre
  let selected = null, hover = null, best = new Map();
  let fitScale = 1;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

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
  function clampView() {
    view.s = Math.max(fitScale * 0.9, Math.min(fitScale * 9, view.s));
    view.x = Math.max(0, Math.min(W, view.x)); view.z = Math.max(0, Math.min(D, view.z));
  }

  function line(pts, sz) {
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const [x, y] = toScreen(pts[i], pts[i + 1], sz); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  }
  function draw() {
    const sz = size();
    const k = dpr();
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#e9edf3'; g.fillRect(0, 0, sz.w, sz.h);
    if (ready) {
      const [x0, y0] = toScreen(0, 0, sz), [x1, y1] = toScreen(W, D, sz);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    }
    const zoom = view.s / fitScale;
    const lw = Math.max(1.6, Math.min(5, 1.5 * zoom));
    // piste areas (faint) and lines
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const n of resort.network) {
      const col = DIFF[DIFF_OF_LETTER[n.d] || 'blue'].css;
      if (n.a) { line(n.p, sz); g.closePath(); g.fillStyle = col + '33'; g.fill(); continue; }
      line(n.p, sz); g.strokeStyle = '#ffffffcc'; g.lineWidth = lw + 2; g.stroke();
      g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    }
    // lifts
    g.lineWidth = Math.max(1, lw * 0.45); g.strokeStyle = '#16171a';
    for (const l of resort.lifts) {
      if (l.kind === 'carpet') continue;
      line(l.pts, sz); g.stroke();
      const [ax, ay] = toScreen(l.pts[0], l.pts[1], sz), [bx, by] = toScreen(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1], sz);
      g.fillStyle = '#16171a'; g.fillRect(ax - 2, ay - 2, 4, 4); g.fillRect(bx - 2.5, by - 2.5, 5, 5);
    }
    // hovered / selected piste on top, thick, with start and finish
    for (const p of [hover, selected]) {
      if (!p) continue;
      line(Array.from(p.src.line), sz);
      g.strokeStyle = '#ffffff'; g.lineWidth = lw * 2.6 + 4; g.stroke();
      g.strokeStyle = DIFF[p.diff].css; g.lineWidth = lw * 2.6; g.stroke();
      if (p === selected) {
        const [sx, sy] = toScreen(p.top.x, p.top.z, sz), [ex, ey] = toScreen(p.bottom.x, p.bottom.z, sz);
        g.fillStyle = '#1f7a4d'; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#16171a'; g.fillRect(ex - 6, ey - 6, 12, 12); g.strokeRect(ex - 6, ey - 6, 12, 12);
      }
    }
    // labels: peaks (zoomed in), villages, piste names when zoomed in
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = (text, x, y, font, fill) => { g.font = font; g.lineWidth = 3; g.strokeStyle = '#ffffffd9'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); };
    for (const pl of resort.places) {
      if (pl.kind !== 'village' && pl.kind !== 'town' && zoom < 1.8) continue;
      const [x, y] = toScreen(pl.x, pl.z, sz);
      label(pl.name, x, y, `700 ${pl.kind === 'hamlet' ? 11 : 13}px Geist, system-ui, sans-serif`, '#5a3a1e');
    }
    const peaks = [...resort.peaks].filter((p) => p.ele).sort((a, b) => b.ele - a.ele).slice(0, zoom > 2.5 ? 60 : zoom > 1.4 ? 24 : 10);
    for (const p of peaks) {
      const [x, y] = toScreen(p.x, p.z, sz);
      if (x < -40 || y < -20 || x > sz.w + 40 || y > sz.h + 20) continue;
      g.fillStyle = '#16171a'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y + 2); g.lineTo(x - 4, y + 2); g.closePath(); g.fill();
      label(`${p.name} ${Math.round(p.ele)}`, x, y + 12, '600 10px Geist, system-ui, sans-serif', '#16171a');
    }
    // landmarks (resort.json "landmarks"): a small violet diamond and the name; a race piste is named on its start
    for (const lm of resort.landmarks || []) {
      const [x, y] = toScreen(lm.x, lm.z, sz);
      if (x < -60 || y < -20 || x > sz.w + 60 || y > sz.h + 20) continue;
      g.fillStyle = '#6b3fa0'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill();
      label(lm.kind === 'worldcup' ? `${lm.name} (Weltcup)` : lm.name, x, y - 13, '700 11px Geist, system-ui, sans-serif', '#6b3fa0');
    }
    if (zoom > 2.2) {
      for (const p of pistes.list) {
        const m = p.at(p.length * 0.45, {});
        const [x, y] = toScreen(m.x, m.z, sz);
        if (x < 0 || y < 0 || x > sz.w || y > sz.h) continue;
        label(p.name, x, y - 9, '700 11px Geist, system-ui, sans-serif', DIFF[p.diff].css);
      }
    }
  }

  function pickAt(px, py) {
    const sz = size();
    let bestD = HIT_PX, found = null;
    for (const p of pistes.list) {
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

  // pointer: drag pans, two fingers pinch, a short tap picks
  const ptrs = new Map();
  let downAt = null, pinch0 = null, moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { downAt = { x: e.clientX, y: e.clientY, view: { ...view } }; moved = 0; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { const r = canvas.getBoundingClientRect(); const h = pickAt(e.clientX - r.left, e.clientY - r.top); if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; draw(); } }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()];
      view.s = pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0.d);
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
    if (had && ptrs.size === 0 && downAt && moved <= 6) {
      const r = canvas.getBoundingClientRect();
      const p = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (p) { select(p); onPick(p); }
    }
    if (ptrs.size === 0) downAt = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });

  function zoomBy(k) { view.s *= k; clampView(); draw(); }
  function select(p, center = false) {
    selected = p;
    if (center && p) {
      const sz = size();
      if (!sz.w) return;
      const xs = Array.from(p.x), zs = Array.from(p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      view.x = (minX + maxX) / 2; view.z = (minZ + maxZ) / 2;
      view.s = Math.max(view.s, Math.min(sz.w / (maxX - minX + 1200), sz.h / (maxZ - minZ + 1200)));
      clampView();
    }
    draw();
  }
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const keep = { ...view }; fit(); if (keep.s > fitScale) view = keep; clampView(); draw(); }, 60); });
  ro.observe(canvas);
  fit();
  return { draw, select, zoomBy, fit: () => { fit(); draw(); }, setBest(m) { best = m; draw(); }, get selected() { return selected; }, screenOf: (p) => toScreen(p.x, p.z, size()) };
}
