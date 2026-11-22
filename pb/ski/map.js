/* The piste map: the painted base (map.webp from the bake: snow light and shade, rock, forests, lakes, villages) with the pistes drawn
 * live in their colours, the lifts as black lines with station dots, peak and village names. Drag to pan, pinch / wheel / buttons to zoom,
 * tap a piste to pick it. Canvas 2D, redrawn only when something changes. */
import { DIFF } from './config.js';

const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };
const HIT_PX = 22;

export function createPisteMap({ canvas, resort, imageUrl, pistes, onPick, onPickLift = null, onTapWorld = null }) {
  const g = canvas.getContext('2d');
  const img = new Image();
  let ready = false;
  img.onload = () => { ready = true; draw(); };
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
    // round 7-C: fog of the undiscovered cells (free ride tab: where a tap can teleport to)
    if (fog && mode === 'freeride') {
      if (fogVersion !== fog.version || !fogCanvas) {
        fogCanvas = fogCanvas || document.createElement('canvas');
        fogCanvas.width = fog.nx; fogCanvas.height = fog.nz;
        const fg = fogCanvas.getContext('2d'), im = fg.createImageData(fog.nx, fog.nz);
        for (let k = 0; k < fog.bits.length; k++) { const o = k * 4; im.data[o] = 214; im.data[o + 1] = 221; im.data[o + 2] = 231; im.data[o + 3] = fog.bits[k] ? 0 : 215; }
        fg.putImageData(im, 0, 0);
        fogVersion = fog.version;
      }
      const [x0, y0] = toScreen(0, 0, sz), [x1, y1] = toScreen(fog.nx * fog.cell, fog.nz * fog.cell, sz);
      g.imageSmoothingEnabled = true;
      g.drawImage(fogCanvas, x0, y0, x1 - x0, y1 - y0);
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
    // free ride: every lift's bottom station a dot (round 6: fast travel goes there), the picked lift red
    if (mode === 'freeride') {
      for (const l of lifts) {
        const [x, y] = toScreen(l.bottom.x, l.bottom.z, sz);
        const on = l === liftSel;
        if (on) { const [x1, y1] = toScreen(l.top.x, l.top.z, sz); g.strokeStyle = '#d0352c'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke(); }
        g.fillStyle = on ? '#d0352c' : '#ffffff'; g.strokeStyle = '#16171a'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, on ? 8 : 5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    // round 6: where the skier is (the map over a free ride)
    if (player) {
      const [x, y] = toScreen(player.x, player.z, sz);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1f7a4d'; g.beginPath(); g.arc(x, y, 7.5, 0, Math.PI * 2); g.fill();
      g.font = '800 12px Geist, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = '#ffffffd9';
      g.strokeText('Du', x, y - 18); g.fillStyle = '#1f7a4d'; g.fillText('Du', x, y - 18);
    }
    // hovered / selected piste on top, thick, with start and finish
    for (const p of mode === 'piste' ? [hover, selected] : []) {
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
      if (lm.house === false) continue;                       // the second part of a race course: one label is enough
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
    // stars won per piste (gold) once zoomed in a little, and always on the picked piste (round 4A)
    if (mode === 'piste' && marks.stars.size) {
      for (const p of pistes.list) {
        const mask = marks.stars.get(p.id) || 0;
        if (!mask || (zoom < 1.5 && p !== selected)) continue;
        const m = p.at(p.length * 0.45, {});
        const [x, y] = toScreen(m.x, m.z, sz);
        if (x < 0 || y < 0 || x > sz.w || y > sz.h) continue;
        const text = [1, 2, 4].map((b) => (mask & b ? '★' : '☆')).join('');
        label(text, x, y + 8, '700 12px Geist, system-ui, sans-serif', '#c48a00');
      }
    }
    if (park) { const [x, y] = toScreen(park.line[0], park.line[1], sz); label(park.name || 'Snowpark', x, y - 12, '800 12px Geist, system-ui, sans-serif', '#6b3fa0'); }
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
      if (mode === 'freeride' && (onPickLift || tapWorld)) {
        // round 7-C: a tap right on a lift's bottom dot picks the lift (round 6); anywhere else it asks to teleport to that exact spot
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const l = liftAt(px, py, 12);
        if (l && onPickLift) { liftSel = l; draw(); onPickLift(l); }
        else if (tapWorld) { const [wx, wz] = toWorld(px, py, size()); tapWorld(wx, wz); }
      } else if (mode === 'piste') {
        const p = pickAt(e.clientX - r.left, e.clientY - r.top);
        if (p) { select(p); onPick(p); }
        // R8e (3V QA: tapping the empty map in the piste tab did nothing): off every piste the same teleport ask as the free ride tab
        // (discovered -> "Hei hin teleportéieren?" to the nearest safe spot, else "Nach net entdeckt")
        else if (tapWorld) { const [wx, wz] = toWorld(e.clientX - r.left, e.clientY - r.top, size()); tapWorld(wx, wz); }
      }
    }
    if (ptrs.size === 0) downAt = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });

  function zoomBy(k) { view.s *= k; clampView(); draw(); }
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
  /** Centre on a world box [x0, z0, x1, z1] with a margin (m). */
  function focusBox(x0, z0, x1, z1, margin = 900) {
    const sz = size();
    if (!sz.w) return;
    view.x = (x0 + x1) / 2; view.z = (z0 + z1) / 2;
    view.s = Math.max(view.s, Math.min(sz.w / (Math.abs(x1 - x0) + margin), sz.h / (Math.abs(z1 - z0) + margin)));
    clampView(); draw();
  }
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
  return {
    draw, select, zoomBy, fit: () => { fit(); draw(); }, setBest(m) { best = m; draw(); }, get selected() { return selected; }, screenOf: (p) => toScreen(p.x, p.z, size()),
    /** Round 4A: stars / locks per piste, the park, the mode ('piste' | 'park' | 'freeride') with its lifts. */
    setMarks(next) { marks = { stars: next.stars || new Map(), locked: next.locked || new Set() }; draw(); },
    setPark(p) { park = p; draw(); },
    setMode(m, liftList = lifts) { mode = m; lifts = liftList; draw(); },
    /** Round 6: the skier's spot (null = none). */
    setPlayer(x, z) { player = Number.isFinite(x) ? { x, z } : null; if (player) { view.x = x; view.z = z; view.s = Math.max(view.s, fitScale * 2.2); clampView(); } draw(); },
    selectLift(l, center = false) { liftSel = l; if (center && l) focusBox(Math.min(l.top.x, l.bottom.x), Math.min(l.top.z, l.bottom.z), Math.max(l.top.x, l.bottom.x), Math.max(l.top.z, l.bottom.z), 1400); else draw(); },
    focusBox, liftAt,
    /** Round 7-C: the discovery fog (modes/discovery.js), the tap-to-teleport handler, the pin; CSS pixels <-> world metres. */
    setFog(d) { fog = d; fogVersion = -1; draw(); },
    setTapWorld(fn) { tapWorld = fn; },
    setPin(p) { pin = p; draw(); },
    screenXY: (x, z) => toScreen(x, z, size()),
    worldXY: (px, py) => toWorld(px, py, size()),
    get zoom() { return view.s / fitScale; },
    center(x, z, zoom = 3) { view.x = x; view.z = z; view.s = Math.max(view.s, fitScale * zoom); clampView(); draw(); },
  };
}
