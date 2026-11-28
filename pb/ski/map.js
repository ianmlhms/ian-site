/* The piste map, like the one from the ticket office (23 Nov 2026, Ian: "make it look like a printed ski map"): a hand-painted panorama of
 * the ski area (data/<rid>/panorama.webp, painted by scripts/ski/panorama.py from the game's own terrain) with the pistes printed on it in
 * their colours (white edge, number discs, names along the line, little arrows downhill), the lifts with their pictograms, villages,
 * summits, the snow park, race and viewpoint signs, a compass. "2D" switches to the plan from above (map.webp), which is also what a
 * resort without a panorama shows.
 *   - one projection object ("sheet") per view: world -> sheet pixel and back (pano.js for the panorama, the identity for the plan); all
 *     drawing, taps, the skier and the overview go through it. Everything is projected once per view, then only panned / zoomed
 *   - over a free ride it opens centred on the skier, with a big "you are here" arrow, his view cone and a pulse
 *   - free ride tab: what is not discovered yet is printed in a softer ink (map-symbols.js SOFT), discovered pistes in full colour
 *   - zoomed in, crisp trees and houses lie over the painting (map-decor.js, its own layer, redrawn when the view has settled)
 *   - buttons: + / − (smooth), ◎ back to me, ⤢ the whole area, 2D / 3D; pinch zooms round the fingers, the wheel round the pointer
 * Canvas 2D, redrawn only when something changes (at most once per frame). The panorama loads when the map opens, never before. */
import { DIFF, DIFF_IDS } from './config.js';
import { createPano } from './pano.js';
import { createDecor } from './map-decor.js';
import { INK, LIFT_PICK, YOU, VIOLET, FONT, SOFT, roundRect, liftSign, liftBadge, pisteDisc, flag, raceSign, parkSign, landmarkSign, peakSign, haloText, compass, drawYou, drawYouEdge } from './map-symbols.js';

const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };
const HIT_PX = 18;
const OPEN_SPAN_M = { relief: 4600, flat: 3000 };      // the map over a free ride opens this many metres across round the skier
const MIN_SPAN_M = { relief: 700, flat: 320 };         // the closest zoom shows this many metres across
const ANIM_MS = 260;
const STEP_M = 40;                 // the lines are projected point by point at this spacing (they follow the ground)
const OV_MAX = 168;                // overview inset: its longer side (CSS px)
const OV_MIN_BOX = 560;            // map box narrower than this: no inset
const DECOR_M = [0.085, 0.13];     // px per metre: the crisp trees fade in
const LAYER_PAD = 0.16, SETTLE_MS = 130;      // the painted layer reaches this much beyond the view; ms without movement = settled
const NEAR_VILLAGE_M = 1500;        // villages this near a piste are printed at every zoom
const HIDDEN_M = 90;               // a tap whose ground lies farther than this from the piste printed there: the piste is behind a ridge
const EDGE_PX = 30;                // opened on the skier: at most this much beside the sheet
const MARGIN_PX = 24;              // dragged to the edge: at most this much beside the sheet
const FOOT_PX = 46;                // the whole map keeps this much free at the bottom (the legend's line)
const VIEW_KEY = 'pb_ski_mapview';
const MINOR_NAME = /^Verbindung|\(Variante|^Raccordo|^Liaison|^Verbindungs/i;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - (1 - t) ** 3;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const readView = () => { try { return localStorage.getItem(VIEW_KEY); } catch (error) { return null; } };
const writeView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch (error) { /* private mode: not kept */ } };

/** "Al Plan de Mareo - St. Vigil in Enneberg - San Vigilio di Marebbe" -> "St. Vigil in Enneberg"; "Bruneck - Brunico" -> "Bruneck". */
const placeName = (name) => { const p = name.split(' - '); return p.length === 3 ? p[1] : p[0]; };
/** "S 01" -> "S1", "D 87B" -> "D87B": what fits a disc ('' = no number). */
const discText = (ref) => { const t = String(ref || '').replace(/\s+/g, '').replace(/^([A-Za-z]?)0+(?=\d)/, '$1'); return t.length > 5 ? '' : t; };

/** A polyline (flat x, z) as a smooth curve through its points, sampled every STEP_M: [[x, z], ...] (Hermite, tangents by chord length). */
function smoothLine(p, step = STEP_M) {
  const n = p.length / 2, out = [];
  if (n < 2) return out;
  const t = new Float64Array(n);
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + Math.max(0.01, Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
  const tan = (i) => { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), h = t[b] - t[a]; return [(p[2 * b] - p[2 * a]) / h, (p[2 * b + 1] - p[2 * a + 1]) / h]; };
  for (let i = 0; i + 1 < n; i++) {
    const h = t[i + 1] - t[i], k = Math.max(1, Math.ceil(h / step)), [ax, az] = tan(i), [bx, bz] = tan(i + 1);
    for (let j = 0; j < k; j++) {
      const u = j / k, u2 = u * u, u3 = u2 * u, h0 = 2 * u3 - 3 * u2 + 1, h1 = u3 - 2 * u2 + u, h2 = -2 * u3 + 3 * u2, h3 = u3 - u2;
      out.push([h0 * p[2 * i] + h1 * h * ax + h2 * p[2 * i + 2] + h3 * h * bx, h0 * p[2 * i + 1] + h1 * h * az + h2 * p[2 * i + 3] + h3 * h * bz]);
    }
  }
  out.push([p[2 * n - 2], p[2 * n - 1]]);
  return out;
}

export function createPisteMap({ canvas, resort, imageUrl, pistes, onPick, onPickLift = null, onTapWorld = null, root = '', height = null, classes = null }) {
  const g = canvas.getContext('2d');
  const box = canvas.parentElement;
  const W = resort.width, D = resort.depth;
  const drawnLifts = resort.lifts.filter((l) => l.kind !== 'carpet');
  const hasPano = !!(resort.panorama && height);
  let view = { s: 1, x: 0, z: 0 };          // sheet point at the canvas centre, CSS pixels per sheet pixel
  let selected = null, hover = null;
  // round 4A (modes): stars per piste id (mask), locked piste ids, the snow park line, the lifts of the free ride and the picked one
  let marks = { stars: new Map(), locked: new Set() }, mode = 'piste', park = null, lifts = [], liftSel = null, player = null;
  let fitScale = 1;
  let ride = null;                  // 28 Nov: the map opened on a lift ride: { lift, starts: pistes that begin at the top, label }
  // round 7-C: the discovery (softer ink on the undiscovered cells), the teleport pin
  let fog = null, pin = null, tapWorld = onTapWorld;
  // map clarity: no recentring while the map opens on the skier (showMap's piste / lift picks run in the same task), animation
  let hold = false, anim = 0, frame = 0, quietFocus = false, disposed = false, lastMove = 0, settleTimer = 0;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  // ---------------------------------------------------------------- the sheets (views)
  let sheet = null, decor = null, layer = null;
  function makeSheet(id) {
    const relief = id === 'relief' && hasPano;
    const pano = relief ? createPano({ panorama: resort.panorama, height }) : null;
    const url = relief ? `${root}${resort.panorama.file}` : imageUrl;
    const sh = {
      id: relief ? 'relief' : 'flat', pano,
      w: relief ? pano.w : W, h: relief ? pano.h : D, k: relief ? pano.k : 1,
      to: relief ? (x, z) => pano.project(x, z) : (x, z) => [x, z],
      from: relief ? (X, Y) => pano.unproject(X, Y) : (X, Y) => [X, Y],
      img: new Image(), ready: false,
    };
    sh.img.onload = () => { sh.ready = true; ovBase = null; requestDraw(); };
    sh.img.onerror = () => { console.warn('[ski] map image failed'); requestDraw(); };
    sh.img.decoding = 'async';
    sh.img.src = url;
    sh.geo = buildGeo(sh);
    return sh;
  }
  function dropSheet() {
    if (decor) { decor.dispose(); decor = null; }
    if (layer) { layer.canvas.width = layer.canvas.height = 0; layer = null; }
    if (sheet) { sheet.img.onload = sheet.img.onerror = null; sheet.img.src = ''; sheet = null; }
    ovBase = null;
  }
  /** Everything of the resort projected once onto the sheet. */
  function buildGeo(sh) {
    const proj = (pts) => {
      const n = pts.length, xs = new Float32Array(n), ys = new Float32Array(n), cs = new Float32Array(n);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const [X, Y] = sh.to(pts[i][0], pts[i][1]);
        xs[i] = X; ys[i] = Y; if (i) cs[i] = cs[i - 1] + Math.hypot(X - xs[i - 1], Y - ys[i - 1]);
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      return { n, xs, ys, cs, len: n ? cs[n - 1] : 0, x0, y0, x1, y1 };
    };
    const net = [], areas = [];
    for (const q of resort.network) {
      const diff = DIFF_OF_LETTER[q.d] || 'blue';
      if (q.a) {
        const pts = [], path = new Path2D();
        for (let i = 0; i < q.p.length; i += 2) pts.push([q.p[i], q.p[i + 1]]);
        const pa = proj(pts);
        for (let i = 0; i < pa.n; i++) { if (i) path.lineTo(pa.xs[i], pa.ys[i]); else path.moveTo(pa.xs[i], pa.ys[i]); }
        path.closePath();
        areas.push({ diff, path, x0: pa.x0, y0: pa.y0, x1: pa.x1, y1: pa.y1 });
        continue;
      }
      const pts = smoothLine(q.p);
      net.push({ diff, pts, ...proj(pts) });
    }
    const piste = new Map();
    for (const p of pistes.list) {
      const pts = [], every = Math.max(1, Math.round(p.n / Math.max(2, p.length / 25)));
      for (let i = 0; i < p.n; i += every) pts.push([p.x[i], p.z[i]]);
      if ((p.n - 1) % every) pts.push([p.x[p.n - 1], p.z[p.n - 1]]);
      const gp = proj(pts), path = new Path2D();
      for (let i = 0; i < gp.n; i++) { if (i) path.lineTo(gp.xs[i], gp.ys[i]); else path.moveTo(gp.xs[i], gp.ys[i]); }
      piste.set(p, { ...gp, pts, path, minor: MINOR_NAME.test(p.name), disc: discText(p.src.ref) });
    }
    const lift = new Map();
    for (const src of drawnLifts) {
      const sign = liftSign(src), p = src.pts, n = p.length / 2, pts = [];
      if (sign === 'funicular' || sign === 'train') pts.push(...smoothLine(p));            // rails lie on the ground
      else for (let i = 0; i < n; i++) {                                                   // a rope runs straight from bend to bend
        if (i && i < n - 1) {
          const a1 = Math.atan2(p[2 * i + 1] - p[2 * i - 1], p[2 * i] - p[2 * i - 2]), a2 = Math.atan2(p[2 * i + 3] - p[2 * i + 1], p[2 * i + 2] - p[2 * i]);
          let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d;
          if (d < 0.1) continue;
        }
        pts.push([p[2 * i], p[2 * i + 1]]);
      }
      const gl = proj(pts), path = new Path2D();
      for (let i = 0; i < gl.n; i++) { if (i) path.lineTo(gl.xs[i], gl.ys[i]); else path.moveTo(gl.xs[i], gl.ys[i]); }
      lift.set(src, { ...gl, path, sign, tunnel: !!src.tunnel });
    }
    const spot = (x, z) => { const [X, Y] = sh.to(x, z); return { X, Y, off: X < 0 || Y < 0 || X > sh.w || Y > sh.h || (sh.pano ? sh.pano.hidden(x, z) : false) }; };
    const netPts = [];
    for (const q of net) for (let i = 0; i < q.pts.length; i += 5) netPts.push(q.pts[i]);
    const atSki = (x, z) => netPts.some((q) => Math.abs(q[0] - x) < NEAR_VILLAGE_M && Math.abs(q[1] - z) < NEAR_VILLAGE_M);
    const places = resort.places.map((q) => ({ ...q, big: q.kind === 'town' || (q.kind === 'village' && atSki(q.x, q.z)), text: placeName(q.name), ...spot(q.x, q.z) })).filter((q) => !q.off);
    const peaks = resort.peaks.filter((q) => q.ele).sort((a, b) => b.ele - a.ele).map((q) => ({ ...q, ...spot(q.x, q.z) })).filter((q) => !q.off).slice(0, 70);
    const landmarks = (resort.landmarks || []).filter((q) => q.house !== false).map((q) => ({ ...q, ...spot(q.x, q.z) })).filter((q) => !q.off);
    return { net, areas, piste, lift, places, peaks, landmarks, vivid: null, inked: null };
  }
  /** The network's lines as paths, each { q, casing, full, soft }: with the discovery the undiscovered parts go into `soft`. */
  function inkPaths() {
    const gd = sheet.geo, useFog = fog && mode === 'freeride';
    const key = useFog ? `f${fog.version}` : 'v';
    const slot = useFog ? 'inked' : 'vivid';
    if (gd[slot] && gd[slot].key === key) return gd[slot];
    const out = { key, lines: [] };
    for (const q of gd.net) {
      const it = { q, casing: new Path2D(), full: null, soft: null };
      let cur = null;
      for (let i = 0; i < q.n; i++) {
        if (i) it.casing.lineTo(q.xs[i], q.ys[i]); else it.casing.moveTo(q.xs[i], q.ys[i]);
        if (!i) continue;
        const kind = !useFog || fog.has((q.pts[i][0] + q.pts[i - 1][0]) / 2, (q.pts[i][1] + q.pts[i - 1][1]) / 2) ? 'full' : 'soft';
        if (!it[kind]) it[kind] = new Path2D();
        if (kind !== cur) { it[kind].moveTo(q.xs[i - 1], q.ys[i - 1]); cur = kind; }
        it[kind].lineTo(q.xs[i], q.ys[i]);
      }
      out.lines.push(it);
    }
    gd[slot] = out;
    return out;
  }
  const isDone = (x, z) => !(fog && mode === 'freeride') || fog.has(x, z);

  // ---------------------------------------------------------------- DOM extras inside the map box: the overview inset, the pulse
  const ov = document.createElement('canvas');
  ov.className = 'mapov';
  ov.setAttribute('aria-label', 'Iwwersiicht: tipp fir dohin ze sprangen');
  let ovW = 0, ovH = 0;
  const pulse = document.createElement('div');
  pulse.className = 'mappulse';
  pulse.hidden = true;
  box.appendChild(ov);
  box.appendChild(pulse);
  let ovBase = null;                 // the inset's static picture (image + pistes), built once the image is in
  for (const c of box.querySelectorAll('canvas[data-sign]')) {            // the legend's pictograms, the same drawing as on the map
    c.width = c.height = 36;
    const cg = c.getContext('2d'); cg.scale(2, 2);
    const s = c.dataset.sign;
    if (s === 'park') parkSign(cg, 9, 9, 7.5); else if (s === 'race') raceSign(cg, 9, 9, 7.5); else if (s === 'view') landmarkSign(cg, 9, 9, 7); else if (s === 'flag') flag(cg, 5.5, 16, '#c8372d', 0.95); else if (s === 'peak') peakSign(cg, 9, 12); else liftBadge(cg, 9, 9, 8, s);
  }

  function size() {
    const r = canvas.getBoundingClientRect(), k = dpr();
    if (canvas.width !== Math.round(r.width * k) || canvas.height !== Math.round(r.height * k)) { canvas.width = Math.round(r.width * k); canvas.height = Math.round(r.height * k); }
    return { w: r.width, h: r.height };
  }
  const border = () => sheet.w * 0.014;
  function fit() {
    const { w, h } = size();
    if (!w || !h) return;
    const b = sheet.id === 'relief' ? border() * 2.4 : 0;
    fitScale = Math.min(w / (sheet.w + b), (h - FOOT_PX) / (sheet.h + b)) * 0.98;
    view = wholeView(startScale());
  }
  /** The whole sheet in the middle of the box (above the legend's line). */
  const wholeView = (s) => ({ s, x: sheet.w / 2, z: sheet.h / 2 + FOOT_PX / 2 / s });
  /** Without a skier the map opens whole; on a tall screen a little closer (the panorama is wide). */
  const startScale = () => { const { w, h } = size(); return sheet.id === 'relief' ? clamp(Math.max(w / sheet.w, h / sheet.h), fitScale, fitScale * 1.7) : fitScale; };
  const toScreen = (X, Y, { w, h }) => [(X - view.x) * view.s + w / 2, (Y - view.z) * view.s + h / 2];
  const toSheet = (px, py, { w, h }) => [(px - w / 2) / view.s + view.x, (py - h / 2) / view.s + view.z];
  const worldToScreen = (x, z, sz) => { const [X, Y] = sheet.to(x, z); return toScreen(X, Y, sz); };
  /** The ground at a screen point [x, z]; null in the sky or beside the sheet. */
  const screenToWorld = (px, py, sz) => { const [X, Y] = toSheet(px, py, sz); return sheet.pano && !sheet.pano.inside(X, Y) ? null : sheet.from(X, Y); };
  const maxScale = () => Math.max(fitScale * 6, (size().w || 800) / (MIN_SPAN_M[sheet.id] * sheet.k));
  // (Ian, 23 Nov: opened on the skier at the sheet's edge, grey showed under the panorama -> the sheet covers the box from top to bottom)
  const openScale = () => { const { w, h } = size(); return Math.max(fitScale * 1.2, (w || 800) / (OPEN_SPAN_M[sheet.id] * sheet.k), sheet.id === 'relief' ? Math.max(0, (h || 0) - FOOT_PX) / sheet.h : 0); };
  /** The view stays on the sheet: it may show at most MARGIN_PX beside it (the bottom FOOT_PX more, for the legend's line). */
  function clampView(v = view) {
    v.s = clamp(v.s, fitScale * 0.9, maxScale());
    const { w, h } = size(), hx = (w || 800) / 2 / v.s, hy = (h || 600) / 2 / v.s, mx = MARGIN_PX / v.s, my = (MARGIN_PX + FOOT_PX) / v.s;
    v.x = sheet.w > 2 * (hx - mx) ? clamp(v.x, hx - mx, sheet.w - hx + mx) : sheet.w / 2;
    v.z = sheet.h > 2 * hy - mx - my ? clamp(v.z, hy - mx, sheet.h - hy + my) : sheet.h / 2 + FOOT_PX / 2 / v.s;
    return v;
  }

  /** Smoothly to the view `to` ({x, z, s} in sheet pixels, clamped); instant when ms = 0. */
  function animateTo(to, ms = ANIM_MS) {
    cancelAnimationFrame(anim); anim = 0;
    const target = clampView({ ...view, ...to });
    if (!ms) { view = target; draw(); return; }
    const from = { ...view }, t0 = performance.now();
    const step = (now) => {
      if (disposed || !canvas.isConnected) { anim = 0; return; }
      const q = Math.min(1, (now - t0) / ms), t = ease(Math.max(0, q));
      // zoom in log space, the centre linearly: no swing past the target
      view = { s: Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * t), x: from.x + (target.x - from.x) * t, z: from.z + (target.z - from.z) * t };
      anim = q < 1 ? requestAnimationFrame(step) : 0;
      lastMove = now;
      draw();
    };
    anim = requestAnimationFrame(step);
  }
  /** At most one redraw per frame while a finger moves. */
  function requestDraw() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }

  // ---------------------------------------------------------------- labels: candidates with a tier, placed greedily without overlaps
  const widthCache = new Map();
  function textWidth(text, font) {
    const key = font + '|' + text;
    let wv = widthCache.get(key);
    if (wv === undefined) { g.font = font; wv = g.measureText(text).width; if (widthCache.size < 4000) widthCache.set(key, wv); }
    return wv;
  }
  /** The taken boxes in a coarse grid (hundreds of labels, each a handful of boxes). */
  function createTaken() {
    const CELL = 64, cells = new Map();
    const each = (r, fn) => { for (let j = Math.floor(r[1] / CELL); j <= Math.floor(r[3] / CELL); j++) for (let i = Math.floor(r[0] / CELL); i <= Math.floor(r[2] / CELL); i++) if (fn(j * 512 + i)) return true; return false; };
    return {
      add(r) { each(r, (k) => { let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(r); return false; }); },
      hit: (r) => each(r, (k) => { const a = cells.get(k); return !!a && a.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]); }),
    };
  }
  function placeLabels(cands, taken, sz) {
    cands.sort((a, b) => a.tier - b.tier || a.d - b.d);
    const seen = new Map();
    // on screen, and on the printed picture (not over the paper's edge)
    const [sx0, sy0] = toScreen(0, 0, sz), [sx1, sy1] = toScreen(sheet.w, sheet.h, sz);
    const vx0 = Math.max(2, sx0 + 2), vy0 = Math.max(2, sy0 + 2), vx1 = Math.min(sz.w - 2, sx1 - 2), vy1 = Math.min(sz.h - 2, sy1 - 2);
    const inView = (r) => r[0] >= vx0 && r[1] >= vy0 && r[2] <= vx1 && r[3] <= vy1;
    for (const c of cands) {
      if (c.needs && !c.needs.placed) continue;
      // the same name twice close together (a piste in two parts, twin lifts): once is enough
      const twins = seen.get(c.key || c.text);
      if (twins && twins.some((s) => Math.abs(s[0] - c.x) < (c.gap || 260) && Math.abs(s[1] - c.y) < (c.gap || 160))) continue;
      for (const alt of c.alts) {
        if (!alt.boxes.every((r) => inView(r) && !taken.hit(r))) continue;
        alt.boxes.forEach((r) => taken.add(r));
        if (twins) twins.push([c.x, c.y]); else seen.set(c.key || c.text, [[c.x, c.y]]);
        c.placed = true;
        alt.draw();
        break;
      }
    }
  }
  const boxAt = (x, y, w, h, pad = 2) => [x - w / 2 - pad, y - h / 2 - 1, x + w / 2 + pad, y + h / 2 + 1];
  /** A straight label centred at (x, y). */
  const textAlt = (text, x, y, font, fill, h, halo) => ({ boxes: [boxAt(x, y, textWidth(text, font), h)], draw: () => { g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; haloText(g, text, x, y, fill, halo); } });
  /** A point of a projected line at sheet arc length c: [X, Y]. */
  function lineAt(q, c) {
    let lo = 0, hi = q.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (q.cs[m] <= c) lo = m; else hi = m; }
    const t = clamp((c - q.cs[lo]) / (q.cs[hi] - q.cs[lo] || 1), 0, 1);
    return [q.xs[lo] + (q.xs[hi] - q.xs[lo]) * t, q.ys[lo] + (q.ys[hi] - q.ys[lo]) * t];
  }
  /** A name written along its line (turned, beside it): alternatives at a few places where the line runs straight enough and on screen. */
  function alongAlts(q, text, font, fill, h, gap, sz) {
    const tw = textWidth(text, font), L = q.len * view.s, alts = [];
    if (L < tw * 0.75) return alts;
    for (const t of [0.5, 0.36, 0.64, 0.24, 0.76, 0.12, 0.88]) {
      const c = t * L, a = c - tw / 2, b = c + tw / 2;
      if (a < 0 || b > L) continue;
      const [ax, ay] = toScreen(...lineAt(q, a / view.s), sz), [bx, by] = toScreen(...lineAt(q, b / view.s), sz);
      if (Math.min(ax, bx) < 4 || Math.max(ax, bx) > sz.w - 4 || Math.min(ay, by) < 4 || Math.max(ay, by) > sz.h - 4) continue;
      const chord = Math.hypot(bx - ax, by - ay);
      if (chord < tw * 0.86) continue;
      let ang = Math.atan2(by - ay, bx - ax);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      if (Math.abs(ang) > 1.2) continue;
      const nx = Math.sin(ang), ny = -Math.cos(ang);                        // the side above the text
      const [mx, my] = toScreen(...lineAt(q, c / view.s), sz);
      for (const side of [1, -1]) {
        const x = (ax + bx + mx) / 3 + nx * gap * side, y = (ay + by + my) / 3 + ny * gap * side;
        const boxes = [], n = Math.max(1, Math.ceil(tw / 13)), dx = Math.cos(ang), dy = Math.sin(ang);
        for (let i = 0; i < n; i++) { const o = ((i + 0.5) / n - 0.5) * tw, hw = tw / n / 2 + 1; boxes.push([x + dx * o - hw, y + dy * o - h / 2, x + dx * o + hw, y + dy * o + h / 2]); }
        alts.push({ boxes, draw: () => { g.save(); g.translate(x, y); g.rotate(ang); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; haloText(g, text, 0, 0, fill); g.restore(); } });
      }
      if (alts.length >= 6) break;
    }
    return alts;
  }

  // ---------------------------------------------------------------- drawing
  function sheetTransform(sz, k) { const s = view.s * k; g.setTransform(s, 0, 0, s, k * (sz.w / 2 - view.x * view.s), k * (sz.h / 2 - view.z * view.s)); }
  function onScreen(q, sz, m = 20) {
    const [ax, ay] = toScreen(q.x0, q.y0, sz), [bx, by] = toScreen(q.x1, q.y1, sz);
    return bx >= -m && ax <= sz.w + m && by >= -m && ay <= sz.h + m;
  }

  function draw() {
    if (disposed || !sheet) return;
    const sz = size();
    if (!sz.w) return;
    const k = dpr(), s = view.s, gd = sheet.geo, relief = sheet.id === 'relief';
    const m = s * sheet.k;                                                  // CSS px per metre (in the foreground)
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = relief ? '#dfe3e6' : '#e9edf3'; g.fillRect(0, 0, sz.w, sz.h);
    const [x0, y0] = toScreen(0, 0, sz), iw = sheet.w * s, ih = sheet.h * s;
    if (relief) {                                                           // the printed sheet: white paper round the painting
      const b = border() * s;
      g.fillStyle = 'rgba(20,24,34,.10)'; g.fillRect(x0 - b - 1, y0 - b, iw + 2 * b + 2, ih + 2.4 * b + 3);
      g.fillStyle = '#fdfdfa'; g.fillRect(x0 - b, y0 - b, iw + 2 * b, ih + 2.4 * b);
      g.fillStyle = '#e6eef7'; g.fillRect(x0, y0, iw, ih);
    }
    drawBase(sz, k, m);

    // ---- pistes: white edge, softer ink first, full colour on top; areas faintly
    const lw = clamp(1.8 + m * 11, 2.3, 7.5), ink = inkPaths();
    g.lineCap = 'round'; g.lineJoin = 'round';
    sheetTransform(sz, k);
    if (m > 0.07) for (const ar of gd.areas) if (onScreen(ar, sz)) { g.fillStyle = DIFF[ar.diff].css + '26'; g.fill(ar.path); }
    const lines = ink.lines.filter((it) => onScreen(it.q, sz));
    g.strokeStyle = '#ffffff'; g.lineWidth = (lw + 1.6 + lw * 0.32) / s;
    for (const it of lines) g.stroke(it.casing);
    g.lineWidth = lw * 0.9 / s;
    for (const it of lines) if (it.soft) { g.strokeStyle = SOFT[it.q.diff]; g.stroke(it.soft); }
    g.lineWidth = lw / s;
    for (const it of lines) if (it.full) { g.strokeStyle = DIFF[it.q.diff].css; g.stroke(it.full); }
    // locked pistes: a pale dashed veil over their line (round 4A)
    if (marks.locked.size && mode === 'piste') {
      g.setLineDash([5 / s, 5 / s]); g.strokeStyle = '#f6f6f3dd'; g.lineWidth = (lw + 1) / s;
      for (const p of pistes.list) if (marks.locked.has(p.id)) g.stroke(gd.piste.get(p).path);
      g.setLineDash([]);
    }
    // ---- the pistes that start at the top of the lift being ridden: a warm halo under a thicker line
    if (ride && ride.starts.length) {
      sheetTransform(sz, k);
      for (const p of ride.starts) {
        const q = gd.piste.get(p);
        if (!q) continue;
        g.strokeStyle = '#ffffff'; g.lineWidth = (lw * 2.7 + 7) / s; g.stroke(q.path);
        g.strokeStyle = '#ffc400'; g.globalAlpha = 0.85; g.lineWidth = (lw * 2.7 + 3) / s; g.stroke(q.path); g.globalAlpha = 1;
        g.strokeStyle = DIFF[p.diff].css; g.lineWidth = lw * 1.5 / s; g.stroke(q.path);
      }
    }
    // ---- lifts
    const liftW = clamp(0.85 + m * 3.6, 0.95, 2.4);          // the pistes lead, the lifts stay thin on the whole map
    const picked = (mode === 'freeride' || ride) && liftSel ? gd.lift.get(resort.lifts[liftSel.index]) : null;
    if (picked) { g.strokeStyle = LIFT_PICK; g.lineWidth = (liftW + 9) / s; g.globalAlpha = 0.9; g.stroke(picked.path); g.globalAlpha = 1; }
    for (const q of gd.lift.values()) if (onScreen(q, sz)) { g.strokeStyle = '#ffffffd9'; g.lineWidth = (liftW + 1.7) / s; g.stroke(q.path); }
    for (const q of gd.lift.values()) {
      if (!onScreen(q, sz)) continue;
      g.strokeStyle = INK;
      if (q.sign === 'train' || q.sign === 'funicular') {                   // a railway: black with white sleepers; dashed in the tunnel
        g.lineWidth = (liftW + 1.6) / s; if (q.tunnel) g.setLineDash([6 / s, 5 / s]); g.stroke(q.path); g.setLineDash([]);
        if (!q.tunnel) { g.lineCap = 'butt'; g.setLineDash([5 / s, 5 / s]); g.strokeStyle = '#ffffff'; g.lineWidth = liftW * 0.75 / s; g.stroke(q.path); g.setLineDash([]); g.lineCap = 'round'; }
      } else {
        g.lineWidth = liftW * (q.sign === 'cable' ? 1.45 : q.sign === 'gondola' ? 1.15 : 1) / s;
        if (q.sign === 'drag') g.setLineDash([4.5 / s, 3.6 / s]);
        g.stroke(q.path); g.setLineDash([]);
      }
    }
    g.setTransform(k, 0, 0, k, 0, 0);
    const rB = m < 0.06 ? 1.7 : m < 0.16 ? 3.2 : 4.6, rT = rB * 0.72;
    for (const q of gd.lift.values()) {
      if (!onScreen(q, sz)) continue;
      const [ax, ay] = toScreen(q.xs[0], q.ys[0], sz), [bx, by] = toScreen(q.xs[q.n - 1], q.ys[q.n - 1], sz);
      g.fillStyle = INK; g.beginPath(); g.arc(bx, by, rT, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(ax, ay, rB, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (picked) {
      const [x, y] = worldToScreen(liftSel.bottom.x, liftSel.bottom.z, sz);
      g.fillStyle = LIFT_PICK; g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.arc(x, y, rB + 3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    drawDownhill(sz, lw);
    // hovered / selected piste on top, thick, with start and finish
    for (const p of mode === 'piste' ? [hover, selected] : []) {
      if (!p) continue;
      const q = gd.piste.get(p);
      sheetTransform(sz, k);
      g.strokeStyle = '#ffffff'; g.lineWidth = (lw * 2 + 5) / s; g.stroke(q.path);
      g.strokeStyle = DIFF[p.diff].css; g.lineWidth = lw * 2 / s; g.stroke(q.path);
      g.setTransform(k, 0, 0, k, 0, 0);
      if (p === selected) {
        const [sx, sy] = toScreen(q.xs[0], q.ys[0], sz), [ex, ey] = toScreen(q.xs[q.n - 1], q.ys[q.n - 1], sz);
        g.fillStyle = '#1f7a4d'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
        raceSign(g, ex, ey, 7.5);
      }
    }
    drawParkBand(sz, k, lw);
    if (relief) drawSheetText(x0, y0, iw, ih);
    drawLabels(sz, m, lw);
    drawStars(sz, m);
    drawPin(sz);
    drawRide(sz);
    drawPlayer(sz);
    if (relief) drawCompass(sz); else drawScale(sz);
    drawOverview(sz);
  }

  /** The snow park: a violet band down its line. */
  function drawParkBand(sz, k, lw) {
    if (!park) return;
    const w = Math.max(5, lw * 2.1);
    const [ax, ay] = worldToScreen(park.line[0], park.line[1], sz), [bx, by] = worldToScreen(park.line[2], park.line[3], sz);
    g.strokeStyle = '#ffffff'; g.lineWidth = w + 3; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    g.strokeStyle = VIOLET; g.lineWidth = w; g.stroke();
  }

  /** Small white arrows down the pistes once the lines are wide enough. */
  function drawDownhill(sz, lw) {
    if (lw < 3.3) return;
    const a = lw * 0.34, every = 64;
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1.1, lw * 0.24); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    for (const q of sheet.geo.piste.values()) {
      if (!onScreen(q, sz, 0)) continue;
      const L = q.len * view.s, n = Math.floor(L / every);
      for (let i = 0; i < n; i++) {
        const c = (L * (i + 0.5)) / n / view.s, [x, y] = toScreen(...lineAt(q, c), sz);
        if (x < 0 || y < 0 || x > sz.w || y > sz.h) continue;
        const [x2, y2] = toScreen(...lineAt(q, c + 3 / view.s), sz);
        const d = Math.hypot(x2 - x, y2 - y) || 1, ux = (x2 - x) / d, uy = (y2 - y) / d;
        g.moveTo(x - ux * a - uy * a, y - uy * a + ux * a); g.lineTo(x + ux * a, y + uy * a); g.lineTo(x - ux * a + uy * a, y - uy * a - ux * a);
      }
    }
    g.stroke();
  }

  /** The painting (and, zoomed in, the crisp trees and houses) on a layer a little larger than the view: panning only moves the layer,
   *  it is painted again when the view has settled or left it (a 2600 px picture scaled every frame is slow on a tablet). */
  function drawBase(sz, k, m) {
    const alpha = sheet.pano && classes ? smooth(DECOR_M[0], DECOR_M[1], m) : 0;
    if (alpha > 0) {
      if (!decor) decor = createDecor({ pano: sheet.pano, resort, classes, height, buildingsUrl: `${root}buildings.json` });
      if (decor.idle) decor.build(() => { if (layer) layer.key = ''; requestDraw(); });
    }
    if (!sheet.ready) return;
    const trees = alpha > 0 && decor.ready, key = `${sz.w}x${sz.h}x${k}${trees ? 't' : ''}`;
    const [x0, y0] = toSheet(0, 0, sz), [x1, y1] = toSheet(sz.w, sz.h, sz);
    // the part of the view that shows the sheet at all lies on the layer?
    const covers = !!layer && Math.max(0, x0) >= layer.x0 && Math.max(0, y0) >= layer.y0 && Math.min(sheet.w, x1) <= layer.x1 && Math.min(sheet.h, y1) <= layer.y1;
    const sharp = covers && layer.s === view.s && layer.key === key;
    const moving = anim || performance.now() - lastMove < SETTLE_MS;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (!sharp && layer && layer.key && moving) {                           // still moving: the old layer, scaled; a sharp one when it stops
      clearTimeout(settleTimer); settleTimer = setTimeout(requestDraw, SETTLE_MS + 20);
      if (!covers) { const [ax, ay] = toScreen(0, 0, sz); g.drawImage(sheet.img, ax, ay, sheet.w * view.s, sheet.h * view.s); }
    } else if (!sharp) {
      const padX = (LAYER_PAD * sz.w) / view.s, padY = (LAYER_PAD * sz.h) / view.s;
      const bx0 = Math.max(0, x0 - padX), by0 = Math.max(0, y0 - padY), bx1 = Math.min(sheet.w, x1 + padX), by1 = Math.min(sheet.h, y1 + padY), q = view.s * k;
      const cw = Math.max(1, Math.ceil((bx1 - bx0) * q)), ch = Math.max(1, Math.ceil((by1 - by0) * q));
      if (!layer) layer = { canvas: document.createElement('canvas') };
      if (layer.canvas.width !== cw || layer.canvas.height !== ch) { layer.canvas.width = cw; layer.canvas.height = ch; }
      Object.assign(layer, { key, s: view.s, x0: bx0, y0: by0, x1: bx1, y1: by1 });
      const lg = layer.canvas.getContext('2d');
      lg.setTransform(q, 0, 0, q, -bx0 * q, -by0 * q);
      lg.imageSmoothingEnabled = true; lg.imageSmoothingQuality = 'high';
      lg.drawImage(sheet.img, 0, 0, sheet.w, sheet.h);
      if (trees) { lg.globalAlpha = alpha; decor.draw(lg, bx0, by0, bx1, by1); lg.globalAlpha = 1; }
    }
    const [ax, ay] = toScreen(layer.x0, layer.y0, sz), [bx, by] = toScreen(layer.x1, layer.y1, sz);
    g.drawImage(layer.canvas, ax, ay, bx - ax, by - ay);
  }

  /** Title in the sky, frame and print credits on the paper's edge (part of the sheet: they zoom and pan with it). */
  function drawSheetText(x0, y0, iw, ih) {
    g.strokeStyle = 'rgba(26,29,36,.55)'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, iw - 1, ih - 1);
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = clamp(iw * 0.03, 12, 78), long = resort.name.length > 24 ? 0.8 : 1;
    const title = resort.name.toUpperCase();
    if ('letterSpacing' in g) g.letterSpacing = `${(fs * 0.09).toFixed(1)}px`;
    g.font = `800 ${(fs * long).toFixed(1)}px ${FONT}`;
    haloText(g, title, x0 + iw / 2, y0 + fs * 0.92, '#ffffff', 'rgba(16,52,110,.78)', Math.max(2, fs * 0.13));
    if (fs > 18) {
      const n = resort.lifts.filter((l) => l.kind !== 'carpet').length;
      if ('letterSpacing' in g) g.letterSpacing = `${(fs * 0.03).toFixed(1)}px`;
      g.font = `700 ${(fs * 0.36).toFixed(1)}px ${FONT}`;
      haloText(g, `${pistes.list.length} Pisten · ${n} Liften`, x0 + iw / 2, y0 + fs * 1.72, '#ffffff', 'rgba(16,52,110,.78)', Math.max(1.5, fs * 0.06));
    }
    g.restore();
    const cs = border() * view.s * 0.62;
    if (cs >= 4.5) {
      g.font = `500 ${Math.min(cs, 13).toFixed(1)}px ${FONT}`; g.textBaseline = 'middle';
      g.fillStyle = '#5c6067';
      const ty = y0 + ih + border() * view.s * 0.72;
      g.textAlign = 'left'; g.fillText(credits(), x0, ty, iw * 0.82);
      g.textAlign = 'right'; g.fillText('Ski Alpen · Pistekaart', x0 + iw, ty);
    }
  }
  let creditText = '';
  function credits() {
    if (!creditText) {
      const dem = resort.credits.filter((t) => !/OpenStreetMap/.test(t)).map((t) => t.replace(/^[^:]*:\s*/, '').split(/[(,]/)[0].trim());
      creditText = `Eegen Zeechnung aus dem Spill. Pisten, Liften, Haiser: © OpenStreetMap-Mataarbechter (ODbL). Gelänn: ${[...new Set(dem)].join(', ')}`;
    }
    return creditText;
  }

  function drawLabels(sz, m, lw) {
    const gd = sheet.geo, s = view.s, relief = sheet.id === 'relief';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const taken = createTaken();
    const me = player ? worldToScreen(player.x, player.z, sz) : null;
    if (me) taken.add([me[0] - 26, me[1] - 46, me[0] + 26, me[1] + 20]);
    if (ride) { const [tx, ty] = worldToScreen(ride.lift.top.x, ride.lift.top.z, sz); taken.add([tx - 80, ty - 66, tx + 80, ty + 44]); }
    // no label under the buttons, the legend, the inset, the compass or the card lying over the map
    taken.add([sz.w - 60, sz.h - 62 - ovSpace(sz), sz.w, sz.h - 4 - ovSpace(sz)]);
    if (relief) { const [tx, ty] = toScreen(sheet.w / 2, 0, sz), fs = clamp(sheet.w * s * 0.03, 12, 78); taken.add([tx - sheet.w * s * 0.21, ty, tx + sheet.w * s * 0.21, ty + fs * 2.1]); }
    const cr = canvas.getBoundingClientRect();
    for (const el of box.querySelectorAll('.tpfirst, .zoom, .legend, .mapov, .mapcard')) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width) taken.add([r.left - cr.left - 4, r.top - cr.top - 4, r.right - cr.left + 4, r.bottom - cr.top + 4]);
    }
    const fx = me ? me[0] : sz.w / 2, fy = me ? me[1] : sz.h / 2;
    const near = (x, y) => Math.hypot(x - fx, y - fy);
    const cands = [];
    const signAlt = (x, y, r, fn) => ({ boxes: [boxAt(x, y, r * 2, r * 2, 1)], draw: fn });
    const inBox = (x, y, pad = 0) => x > pad && y > pad && x < sz.w - pad && y < sz.h - pad;

    for (const q of gd.places) {
      if (!q.big && m < 0.16) continue;
      const [x, y] = toScreen(q.X, q.Y, sz);
      if (!inBox(x, y)) continue;
      const font = q.big ? `800 ${m < 0.06 ? 12.5 : 15}px ${FONT}` : `700 12px ${FONT}`, text = q.big ? q.text.toUpperCase() : q.text;
      cands.push({ tier: q.big ? 0 : 6, d: q.kind === 'town' ? -1 : 0, text, x, y, alts: [[0, 14], [0, -2], [0, 30], [-46, 22], [46, 22], [0, -20], [0, 46], [-70, 8], [70, 8]].slice(0, q.big ? 9 : 4).map(([dx, dy]) => textAlt(text, x + dx, y + dy, font, '#5a2f12', q.big ? 16 : 12)) });
    }
    if (park) {
      const [x, y] = worldToScreen(park.line[0], park.line[1], sz);
      const sign = { tier: 1, d: 0, text: 'park', x, y, alts: [signAlt(x, y - 12, 10, () => parkSign(g, x, y - 12, 9.5))] };
      cands.push(sign);
      const name = park.name || 'Snowpark', font = `800 12px ${FONT}`, tw = textWidth(name, font);
      if (m > 0.04) cands.push({ tier: 1, d: 1, needs: sign, text: name, x, y, alts: [textAlt(name, x + 14 + tw / 2, y - 12, font, VIOLET, 12), textAlt(name, x - 14 - tw / 2, y - 12, font, VIOLET, 12)] });
    }
    // lifts: the pictogram on the line, the name beside it
    const badgeR = m < 0.055 ? 5.6 : m < 0.12 ? 7.4 : 9.2;
    const liftOf = new Map(lifts.map((l) => [resort.lifts[l.index], l]));
    for (const [src, q] of gd.lift) {
      if (!onScreen(q, sz, 0)) continue;
      const L = q.len * s, l = liftOf.get(src), sel = !!l && l === liftSel && mode === 'freeride';
      if (L < (m < 0.045 ? 56 : m < 0.12 ? 38 : 24) && !sel) continue;
      const alts = [];
      for (const t of [0.5, 0.4, 0.62, 0.28, 0.75]) {
        const [x, y] = toScreen(...lineAt(q, q.len * t), sz);
        if (inBox(x, y, badgeR + 2)) alts.push({ x, y, ...signAlt(x, y, badgeR, () => {}) });
      }
      if (!alts.length) continue;
      const c = { tier: sel ? 1 : 2.5, d: near(alts[0].x, alts[0].y) - L * 0.8, text: '', key: `l${src.osm || ''}${q.xs[0]}`, x: alts[0].x, y: alts[0].y, alts, at: null };
      for (const a of alts) a.draw = () => { c.at = a; liftBadge(g, a.x, a.y, badgeR, q.sign, sel ? { bg: LIFT_PICK, fg: INK, ring: INK } : undefined); };
      cands.push(c);
      if (!l || !(sel || L >= (m < 0.1 ? 120 : 64))) continue;
      const text = /^\d[\d\s.]*$/.test(l.name) ? `Lift ${l.name}` : l.name, font = `700 11.5px ${FONT}`, tw = textWidth(text, font), o = badgeR + 5 + tw / 2;
      cands.push({
        tier: sel ? 1 : 3.5, d: c.d, needs: c, text, x: c.x, y: c.y,
        get alts() { const a = c.at || c; return [[o, 0], [-o, 0], [o * 0.9, -13], [-o * 0.9, 13], [0, badgeR + 9]].map(([dx, dy]) => textAlt(text, a.x + dx, a.y + dy, font, INK, 12)); },
      });
    }
    // pistes: number discs on the line, names along it
    const discR = m < 0.055 ? 6.4 : m < 0.14 ? 8 : 9.5, discFont = `800 ${m < 0.055 ? 8.5 : m < 0.14 ? 10 : 11.5}px ${FONT}`;
    for (const p of pistes.list) {
      const q = gd.piste.get(p), L = q.len * s;
      if (!onScreen(q, sz, 0) || L < 30) continue;
      const sel = p === selected && mode === 'piste';
      const [cx, cy] = toScreen((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, sz), d = near(cx, cy) - L * 0.7 + (q.minor ? 900 : 0);
      if (q.disc) {
        const tw = textWidth(q.disc, discFont);
        const reps = L > 620 ? [0.5, 0.18, 0.82] : L > 300 ? [0.35, 0.8] : [0.5];
        for (const t0 of reps) {
          const alts = [];
          for (const dt of [0, 0.07, -0.07, 0.14, -0.14]) {
            const t = clamp(t0 + dt, 0.04, 0.96), [X, Y] = lineAt(q, q.len * t), [x, y] = toScreen(X, Y, sz);
            if (!inBox(x, y, discR)) continue;
            const w = Math.max(discR * 2, tw + discR * 0.9), i = Math.min(p.n - 1, Math.round(t * (p.n - 1)));
            alts.push({ boxes: [boxAt(x, y, w, discR * 2, 1)], draw: () => { g.font = discFont; pisteDisc(g, x, y, q.disc, DIFF[p.diff].css, isDone(p.x[i], p.z[i]), discR, tw); } });
          }
          if (alts.length) { const b = alts[0].boxes[0]; cands.push({ tier: sel ? 1 : 2.6, d: d + (t0 === reps[0] ? 0 : 400), key: `n${q.disc}${p.diff}`, gap: 110, text: q.disc, x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, alts }); }
        }
      }
      if (q.minor && m < 0.36 && !sel) continue;
      if (!sel && L < (m < 0.06 ? 96 : m < 0.12 ? 70 : 48)) continue;
      const font = `${sel ? 800 : 700} ${m < 0.055 ? 11 : 12.5}px ${FONT}`;
      const fill = DIFF[p.diff].css;
      // "Kandahar" next to its number; a name that only repeats the number ("Rout 12") is not printed twice
      const name = q.disc && new RegExp(`(^|\\s)${q.disc}$`).test(p.name) && p.name.split(/\s+/).length <= 2 ? '' : p.name.replace(/ \((Gréng|Blo|Rout|Schwaarz)( \d+)?\)$/, '');
      if (!name) continue;
      const alts = alongAlts(q, name, font, fill, 12.5, lw / 2 + 8.5, sz);
      if (!alts.length && (sel || L > 60)) {
        const [x, y] = toScreen(...lineAt(q, q.len * 0.5), sz);
        if (inBox(x, y)) alts.push(textAlt(name, x, y - lw / 2 - 9, font, fill, 12.5), textAlt(name, x, y + lw / 2 + 9, font, fill, 12.5));
      }
      if (alts.length) cands.push({ tier: sel ? 1 : 4, d, text: `${name}${p.diff}`, x: cx, y: cy, alts });
    }
    for (const q of gd.landmarks) {
      const [x, y] = toScreen(q.X, q.Y, sz);
      if (!inBox(x, y)) continue;
      const race = q.kind === 'worldcup', text = race ? `${q.name} (Weltcup)` : q.name, font = `700 11.5px ${FONT}`;
      const sign = { tier: 2, d: 0, text: `s${q.name}`, x, y, alts: [signAlt(x, y, 7.5, () => (race ? raceSign(g, x, y, 7.5) : landmarkSign(g, x, y)))] };
      cands.push(sign);
      if (m > 0.05) cands.push({ tier: 3, d: 0, needs: sign, text, x, y, alts: [textAlt(text, x, y - 16, font, VIOLET, 12), textAlt(text, x, y + 16, font, VIOLET, 12)] });
    }
    // summits: the highest ones early (they give the direction), the others when there is room
    const many = m > 0.16 ? 70 : m > 0.07 ? 30 : 12;
    gd.peaks.slice(0, many).forEach((q, i) => {
      const [x, y] = toScreen(q.X, q.Y, sz);
      if (!inBox(x, y)) return;
      const text = `${q.name} ${Math.round(q.ele)} m`, font = `italic 600 ${i < 6 ? 12.5 : 11}px ${FONT}`;
      const t = textAlt(text, x, y - 15, font, '#33405a', 12), b = textAlt(text, x, y + 11, font, '#33405a', 12);
      const withSign = (a) => ({ boxes: [...a.boxes, [x - 6, y - 8, x + 6, y + 3]], draw: () => { peakSign(g, x, y); a.draw(); } });
      cands.push({ tier: i < 6 ? 2.2 : 5, d: i, key: 'peak', gap: i < 6 ? 120 : 60, text, x, y, alts: [withSign(t), withSign(b)] });
    });
    // challenge starts (every piste has one): small flags when zoomed in, gold with stars won
    if (m > 0.15) {
      for (const p of pistes.list) {
        const q = gd.piste.get(p);
        if (q.minor) continue;
        const [x, y] = toScreen(q.xs[0], q.ys[0], sz);
        if (!inBox(x, y, 14)) continue;
        cands.push({ tier: 5.5, d: near(x, y), key: 'flag', gap: 26, text: '', x, y, alts: [{ boxes: [[x - 3, y - 15, x + 11, y + 2]], draw: () => flag(g, x, y, (marks.stars.get(p.id) || 0) ? '#e0a100' : '#c8372d') }] });
      }
    }
    placeLabels(cands, taken, sz);
    if (relief && !sheet.ready) { g.font = `700 13px ${FONT}`; g.textAlign = 'center'; haloText(g, 'D\'Kaart gëtt gelueden …', sz.w / 2, sz.h - 26, INK); }
  }

  /** Stars won per piste (gold) once zoomed in a little, and always on the picked piste (round 4A). */
  function drawStars(sz, m) {
    if (mode !== 'piste' || !marks.stars.size) return;
    for (const p of pistes.list) {
      const mask = marks.stars.get(p.id) || 0;
      if (!mask || (m < 0.08 && p !== selected)) continue;
      const q = sheet.geo.piste.get(p), [x, y] = toScreen(...lineAt(q, q.len * 0.45), sz);
      if (x < 0 || y < 0 || x > sz.w || y > sz.h) continue;
      g.font = `700 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      haloText(g, [1, 2, 4].map((b) => (mask & b ? '★' : '☆')).join(''), x, y + 10, '#c48a00');
    }
  }

  /** Round 7-C: the teleport pin (where the finger went down) and the safe spot it snaps to. */
  function drawPin(sz) {
    if (!pin) return;
    const [x, y] = worldToScreen(pin.x, pin.z, sz);
    if (pin.spot) {
      const [sx, sy] = worldToScreen(pin.spot.x, pin.spot.z, sz);
      g.setLineDash([4, 4]); g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(sx, sy); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#1f7a4d'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    for (const [c, w] of [['#ffffff', 4.5], [pin.ok ? INK : '#a32121', 2]]) {
      g.strokeStyle = c; g.lineWidth = w;
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
    }
  }

  /** 28 Nov 2026 (the map on a lift ride): the top station of the lift he rides, a ring and the pill "Hei kënns du un", and the way he
   *  has still to go (dashed orange along the line, from him up to the top). */
  function drawRide(sz) {
    if (!ride) return;
    const l = ride.lift;
    const [tx, ty] = worldToScreen(l.top.x, l.top.z, sz);
    if (player) {
      const [px, py] = worldToScreen(player.x, player.z, sz);
      g.setLineDash([7, 6]); g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.beginPath(); g.moveTo(px, py); g.lineTo(tx, ty); g.stroke();
      g.strokeStyle = YOU; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
    }
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6;
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(tx, ty, 13, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = YOU; g.beginPath(); g.arc(tx, ty, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(tx, ty, 3.4, 0, Math.PI * 2); g.fill();
    g.restore();
    g.font = `800 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const t1 = ride.label, w = Math.max(textWidth(t1, `800 13px ${FONT}`), textWidth(ride.sub || '', `600 11px ${FONT}`)) + 20, h = ride.sub ? 36 : 24;
    let bx = clamp(tx - w / 2, 6, sz.w - w - 6), by = ty - 22 - h;
    if (by < 6) by = ty + 20;
    g.fillStyle = 'rgba(255,255,255,.96)'; g.strokeStyle = YOU; g.lineWidth = 2; roundRect(g, bx, by, w, h, 8); g.fill(); g.stroke();
    g.fillStyle = '#b34400'; g.font = `800 13px ${FONT}`; g.fillText(t1, bx + w / 2, by + (ride.sub ? 12 : h / 2));
    if (ride.sub) { g.fillStyle = INK; g.font = `600 11px ${FONT}`; g.fillText(ride.sub, bx + w / 2, by + 26); }
  }

  /** A world heading (rad, x east, z south) as a screen direction at a place: the direction a step that way goes on the map. */
  function screenHeading(x, z, h) {
    const [ax, ay] = sheet.to(x, z), [bx, by] = sheet.to(x + Math.cos(h) * 60, z + Math.sin(h) * 60);
    return Math.atan2(by - ay, bx - ax);
  }
  function drawPlayer(sz) {
    if (!player) { pulse.hidden = true; return; }
    const [x, y] = worldToScreen(player.x, player.z, sz);
    const inside = x >= 0 && y >= 0 && x <= sz.w && y <= sz.h;
    pulse.hidden = !inside;
    if (!inside) { drawYouEdge(g, x, y, sz.w, sz.h); return; }
    pulse.style.transform = `translate(${x}px, ${y}px)`;
    drawYou(g, x, y, Number.isFinite(player.heading) ? screenHeading(player.x, player.z, player.heading) : null, textWidth('Du', `800 13px ${FONT}`));
  }

  const ovShown = (sz) => sz.w >= OV_MIN_BOX && sz.h >= 2.6 * ovH && view.s > fitScale * 1.3;
  const ovSpace = (sz) => (ovShown(sz) ? ovH + 10 : 0);
  function drawCompass(sz) {
    const c = [clamp(view.x, 0, sheet.w), clamp(view.z, sheet.h * 0.3, sheet.h)], w = sheet.from(c[0], c[1]) || [W / 2, D / 2];
    compass(g, sz.w - 33, sz.h - 33 - ovSpace(sz), screenHeading(clamp(w[0], 0, W), clamp(w[1], 0, D), -Math.PI / 2));
  }
  /** The plan view: a scale bar (100-ish px, a round number of metres) and a north arrow, bottom right above the inset. */
  function drawScale(sz) {
    const want = 110 / view.s, p10 = 10 ** Math.floor(Math.log10(want));
    const metres = [1, 2, 5, 10].map((q) => q * p10).filter((q) => q <= want).pop() || p10;
    const px = metres * view.s, right = sz.w - 12, y = sz.h - 14 - ovSpace(sz);
    g.lineCap = 'butt';
    g.strokeStyle = '#ffffffe6'; g.lineWidth = 6; g.beginPath(); g.moveTo(right - px, y); g.lineTo(right, y); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(right - px, y - 4); g.lineTo(right - px, y); g.lineTo(right, y); g.lineTo(right, y - 4); g.stroke();
    g.lineCap = 'round';
    g.textAlign = 'right'; g.textBaseline = 'bottom'; g.font = `700 11px ${FONT}`;
    haloText(g, metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, right, y - 5, INK);
    compass(g, right - 18, y - 40, -Math.PI / 2, 16);
  }

  /** The overview inset: the whole map (built once), the frame of the view, me. Hidden in a narrow map box and when the whole map shows. */
  function drawOverview(sz) {
    const show = ovShown(sz);
    ov.hidden = !show;
    if (!show) return;
    const k = dpr();
    if (ov.width !== Math.round(ovW * k)) { ov.width = Math.round(ovW * k); ov.height = Math.round(ovH * k); ov.style.width = `${ovW}px`; ov.style.height = `${ovH}px`; ovBase = null; }
    const o = ov.getContext('2d'), q = ovW / sheet.w;
    if (!ovBase) {
      ovBase = document.createElement('canvas');
      ovBase.width = ov.width; ovBase.height = ov.height;
      const b = ovBase.getContext('2d');
      b.setTransform(k, 0, 0, k, 0, 0);
      b.fillStyle = '#e9edf3'; b.fillRect(0, 0, ovW, ovH);
      b.imageSmoothingQuality = 'high';
      if (sheet.ready) b.drawImage(sheet.img, 0, 0, ovW, ovH);
      b.setTransform(k * q, 0, 0, k * q, 0, 0); b.lineWidth = 1.1 / q; b.lineJoin = 'round';
      for (const it of inkPaths().lines) { b.strokeStyle = DIFF[it.q.diff].css; b.stroke(it.casing); }
    }
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.drawImage(ovBase, 0, 0);
    o.setTransform(k, 0, 0, k, 0, 0);
    const [wx0, wz0] = toSheet(0, 0, sz), [wx1, wz1] = toSheet(sz.w, sz.h, sz);
    const rx = clamp(wx0 * q, -2, ovW), ry = clamp(wz0 * q, -2, ovH), rw = clamp(wx1 * q, 0, ovW + 2) - rx, rh = clamp(wz1 * q, 0, ovH + 2) - ry;
    o.fillStyle = 'rgba(22,23,26,0.12)'; o.fillRect(rx, ry, rw, rh);
    o.strokeStyle = '#ffffff'; o.lineWidth = 3.5; o.strokeRect(rx, ry, rw, rh);
    o.strokeStyle = INK; o.lineWidth = 1.5; o.strokeRect(rx, ry, rw, rh);
    if (player) {
      const [X, Y] = sheet.to(player.x, player.z);
      o.fillStyle = YOU; o.strokeStyle = '#fff'; o.lineWidth = 1.5;
      o.beginPath(); o.arc(X * q, Y * q, 4.5, 0, Math.PI * 2); o.fill(); o.stroke();
    }
  }

  // ---------------------------------------------------------------- hit tests (screen space)
  /** Distance (px) from a screen point to a projected line. */
  function lineDist(q, px, py, sz) {
    const [X, Y] = toSheet(px, py, sz);
    let best = Infinity;
    for (let i = 0; i + 1 < q.n; i++) {
      const ax = q.xs[i], ay = q.ys[i], dx = q.xs[i + 1] - ax, dy = q.ys[i + 1] - ay, t = clamp(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const d = Math.hypot(X - ax - dx * t, Y - ay - dy * t);
      if (d < best) best = d;
    }
    return best * view.s;
  }
  function pickAt(px, py, radius = HIT_PX) {
    const sz = size();
    let bestD = radius, found = null;
    for (const p of pistes.list) {
      const q = sheet.geo.piste.get(p);
      if (!onScreen(q, sz, radius)) continue;
      const d = lineDist(q, px, py, sz);
      if (d < bestD) { bestD = d; found = p; }
    }
    return found;
  }
  /** The lift whose bottom is nearest the tap, or its line (round 4A free ride). */
  function liftAt(px, py, radius = 28) {
    const sz = size();
    let bd = radius, found = null;
    for (const l of lifts) {
      const q = sheet.geo.lift.get(resort.lifts[l.index]);
      if (!q) continue;
      const [x, y] = worldToScreen(l.bottom.x, l.bottom.z, sz);
      const d = Math.min(Math.hypot(px - x, py - y) * 0.8, lineDist(q, px, py, sz) + 6);
      if (d < bd) { bd = d; found = l; }
    }
    return found;
  }

  /** The lift whose drawn line runs nearest the finger: { lift, d } (px). */
  function liftLineAt(px, py, radius) {
    const sz = size();
    let best = null;
    for (const l of lifts) {
      const q = sheet.geo.lift.get(resort.lifts[l.index]);
      if (!q || !onScreen(q, sz, radius)) continue;
      const d = lineDist(q, px, py, sz);
      if (d < radius && (!best || d < best.d)) best = { lift: l, d };
    }
    return best;
  }

  // ---------------------------------------------------------------- pointer: drag pans, two fingers pinch, a short tap picks
  const ptrs = new Map();
  let downAt = null, pinch0 = null, moved = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim); anim = 0;
    canvas.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { downAt = { x: e.clientX, y: e.clientY, view: { ...view } }; moved = 0; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], r = canvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s, at: toSheet(mx, my, size()) };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { const [px, py] = local(e); const h = mode === 'piste' ? pickAt(px, py) : null; if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; requestDraw(); } }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()], r = canvas.getBoundingClientRect(), sz = size();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      view.s = clamp(pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0.d), fitScale * 0.9, maxScale());
      // the sheet point that was under the fingers' middle stays under it
      view.x = pinch0.at[0] - (mx - sz.w / 2) / view.s; view.z = pinch0.at[1] - (my - sz.h / 2) / view.s;
      clampView(); lastMove = performance.now(); requestDraw(); moved = 99; return;
    }
    if (downAt) {
      const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > 6) { view.x = downAt.view.x - dx / view.s; view.z = downAt.view.z - dy / view.s; clampView(); lastMove = performance.now(); requestDraw(); }
    }
  });
  const up = (e) => {
    const had = ptrs.has(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    if (ptrs.size === 1) { const [q] = [...ptrs.values()]; downAt = { x: q.x, y: q.y, view: { ...view } }; }      // pinch -> one finger pans on
    if (had && ptrs.size === 0 && downAt && moved <= 6 && e.type === 'pointerup') tap(...local(e));
    if (ptrs.size === 0) downAt = null;
  };
  /** The ground under a tap. A piste printed there that runs behind a nearer ridge wins over the ridge (the finger is on its line). */
  function groundAt(px, py) {
    const sz = size(), world = screenToWorld(px, py, sz);                    // (null: the sky)
    if (sheet.id !== 'relief') return world;
    const p = pickAt(px, py, 8);
    if (!p) return world;
    const q = sheet.geo.piste.get(p), [X, Y] = toSheet(px, py, sz);
    let best = null, bd = Infinity;
    for (let i = 0; i + 1 < q.n; i++) {
      const dx = q.xs[i + 1] - q.xs[i], dy = q.ys[i + 1] - q.ys[i], t = clamp(((X - q.xs[i]) * dx + (Y - q.ys[i]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const d = Math.hypot(X - q.xs[i] - dx * t, Y - q.ys[i] - dy * t);
      if (d < bd) { bd = d; best = [q.pts[i][0] + (q.pts[i + 1][0] - q.pts[i][0]) * t, q.pts[i][1] + (q.pts[i + 1][1] - q.pts[i][1]) * t]; }
    }
    return world && Math.hypot(world[0] - best[0], world[1] - best[1]) < HIDDEN_M ? world : best;
  }
  function tap(px, py) {
    const world = groundAt(px, py);
    if (mode === 'freeride' && (onPickLift || tapWorld)) {
      // round 7-C: a tap right on a lift's bottom dot picks the lift (round 6); anywhere else it asks to teleport to that exact spot
      const l = liftAt(px, py, 12);
      // map clarity: a lift picked on the map stays where it is (no jump) and also gets the card (info + teleport) like any tap
      if (l && onPickLift) { liftSel = l; quietFocus = true; try { onPickLift(l); } finally { quietFocus = false; } draw(); }
      const at = world || (l ? [l.bottom.x, l.bottom.z] : null);
      if (tapWorld && at) tapWorld(at[0], at[1], l || null);
    } else if (mode === 'ride') {
      const p = pickAt(px, py);                                    // on a lift ride: a tap only says what the piste is (no teleport)
      if (p && onPick) onPick(p); else if (!p && tapWorld) tapWorld(0, 0);
    } else if (mode === 'piste') {
      const p = pickAt(px, py), l = liftLineAt(px, py, 10);
      // the finger right on a lift's line, nearer than any piste: the lift (its card), else the piste
      if (l && tapWorld && (!p || l.d + 2 < lineDist(sheet.geo.piste.get(p), px, py, size()))) tapWorld(l.lift.bottom.x, l.lift.bottom.z, l.lift);
      else if (p) { select(p); onPick(p); }
      // R8e (3V QA: tapping the empty map in the piste tab did nothing): off every piste the same teleport ask as the free ride tab
      // (discovered -> "Hei hin teleportéieren?" to the nearest safe spot, else "Nach net entdeckt")
      else if (tapWorld && world) tapWorld(world[0], world[1]);
    }
  }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e), sz = size(), [X, Y] = toSheet(px, py, sz);
    const s = clamp(view.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), fitScale * 0.9, maxScale());
    cancelAnimationFrame(anim); anim = 0;
    view = clampView({ s, x: X - (px - sz.w / 2) / s, z: Y - (py - sz.h / 2) / s });
    lastMove = performance.now();
    requestDraw();
  }, { passive: false });

  // the overview inset: tap or drag = look there
  let ovDrag = false;
  const ovJump = (e, ms) => {
    const r = ov.getBoundingClientRect();
    animateTo({ x: clamp((e.clientX - r.left) / r.width, 0, 1) * sheet.w, z: clamp((e.clientY - r.top) / r.height, 0, 1) * sheet.h, s: Math.max(view.s, fitScale * 1.6) }, ms);
  };
  ov.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ovDrag = true; ov.setPointerCapture?.(e.pointerId); ovJump(e, ANIM_MS); });
  ov.addEventListener('pointermove', (e) => { if (ovDrag) { lastMove = performance.now(); ovJump(e, 0); } });
  const ovUp = () => { ovDrag = false; };
  ov.addEventListener('pointerup', ovUp);
  ov.addEventListener('pointercancel', ovUp);

  // ---------------------------------------------------------------- moving the view
  function zoomBy(f) { animateTo({ s: view.s * f }); }
  /** Centre on a world box [x0, z0, x1, z1] with a margin (m). Not while the map opens on the skier, nor for a pick made on the map. */
  function focusBox(x0, z0, x1, z1, margin = 900) {
    const sz = size();
    if (!sz.w || hold || quietFocus) { draw(); return; }
    const c = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => sheet.to(x, z)), xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
    const bw = Math.max(...xs) - Math.min(...xs) + margin * sheet.k, bh = Math.max(...ys) - Math.min(...ys) + margin * sheet.k;
    animateTo({ x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...ys) + Math.max(...ys)) / 2, s: Math.max(view.s, Math.min(sz.w / bw, sz.h / bh)) });
  }
  function select(p, center = false) {
    selected = p;
    if (center && p && !hold) {
      const sz = size();
      if (!sz.w) return;
      const q = sheet.geo.piste.get(p);
      view.x = (q.x0 + q.x1) / 2; view.z = (q.y0 + q.y1) / 2;
      view.s = Math.max(view.s, Math.min(sz.w / (q.x1 - q.x0 + 1800 * sheet.k), sz.h / (q.y1 - q.y0 + 1800 * sheet.k)));
      clampView();
    }
    draw();
  }
  /** The view on the skier: centred, but the sheet fills the box when he stands near its edge. */
  function playerView() {
    const sz = size(), s = openScale(), [X, Y] = sheet.to(player.x, player.z), hx = (sz.w / 2 - EDGE_PX) / s, hy = (sz.h / 2 - EDGE_PX) / s;
    const keep = (v, half, full) => (full > 2 * half ? clamp(v, half, full - half) : full / 2);
    return { s, x: keep(X, hx, sheet.w), z: keep(Y, hy, sheet.h) };
  }
  function centerOnPlayer(ms = ANIM_MS) {
    if (!player) return;
    animateTo(playerView(), ms);
    pulse.classList.remove('go'); void pulse.offsetWidth; pulse.classList.add('go');      // restart the pulse
  }
  function fitAll() { animateTo(wholeView(fitScale)); }
  /** The other view (panorama <-> plan), centred on the same place at the same width. */
  function setView(id, keep = true) {
    if (sheet && sheet.id === id) return;
    const sz = size(), at = keep && sheet ? screenToWorld(sz.w / 2, sz.h / 2, sz) : null, m = sheet ? view.s * sheet.k : 0;
    dropSheet();
    sheet = makeSheet(id);
    const a = sheet.h / sheet.w;
    ovW = Math.round(a > 1 ? OV_MAX / a : OV_MAX); ovH = Math.round(a > 1 ? OV_MAX : OV_MAX * a);
    fit();
    if (at) { const [x, z] = sheet.to(clamp(at[0], 0, W), clamp(at[1], 0, D)); view = clampView({ x, z, s: m / sheet.k }); }
    box.dataset.mapview = sheet.id;
    if (viewBtn) { viewBtn.textContent = sheet.id === 'relief' ? '2D' : '3D'; viewBtn.title = sheet.id === 'relief' ? 'Vun uewen' : 'Pistekaart'; viewBtn.setAttribute('aria-label', viewBtn.title); }
    draw();
  }

  // the extra buttons in the zoom column (ui.js): ◎ back to me, ⤢ the whole area, 2D / 3D
  const meBtn = box.querySelector('[data-mz="me"]'), fitBtn = box.querySelector('[data-mz="fit"]'), viewBtn = box.querySelector('[data-mz="view"]');
  if (meBtn) { meBtn.hidden = true; meBtn.addEventListener('click', () => centerOnPlayer()); }
  if (fitBtn) fitBtn.addEventListener('click', fitAll);
  if (viewBtn) { viewBtn.hidden = !hasPano; viewBtn.addEventListener('click', () => { const next = sheet.id === 'relief' ? 'flat' : 'relief'; writeView(next); setView(next); }); }
  const legend = box.querySelector('.legend');
  if (legend) legend.addEventListener('toggle', requestDraw);

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) { dispose(); return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (disposed) return; const keep = { ...view }; fit(); if (keep.s > fitScale) view = keep; clampView(); draw(); }, 60);
  });
  ro.observe(canvas);
  canvas.addEventListener('ski-map-close', () => dispose());
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(anim); cancelAnimationFrame(frame); clearTimeout(resizeTimer); clearTimeout(settleTimer); ro.disconnect();
    dropSheet();
    ov.remove(); pulse.remove();
    ov.width = ov.height = 0; canvas.width = canvas.height = 0;
    widthCache.clear();
  }
  setView(hasPano && readView() !== 'flat' ? 'relief' : 'flat', false);
  return {
    draw, select, zoomBy, fit: () => { fit(); draw(); }, setBest() { draw(); }, get selected() { return selected; }, screenOf: (p) => worldToScreen(p.x, p.z, size()),
    /** Round 4A: stars / locks per piste, the park, the mode ('piste' | 'park' | 'freeride') with its lifts. */
    setMarks(next) { marks = { stars: next.stars || new Map(), locked: next.locked || new Set() }; draw(); },
    setPark(p) { park = p; draw(); },
    setMode(m, liftList = lifts) { mode = m; lifts = liftList; draw(); },
    /** Round 6: the skier's spot (null = none). Map clarity: + his heading (rad, x = east, z = south); the map opens centred on him and
     * nothing the opening picks recentres it (hold until the task ends). */
    setPlayer(x, z, heading = null) {
      player = Number.isFinite(x) ? { x, z, heading: Number.isFinite(heading) ? heading : null } : null;
      if (meBtn) meBtn.hidden = !player;
      box.dataset.you = player ? '1' : '';
      if (player) {
        hold = true; setTimeout(() => { hold = false; }, 0);
        view = clampView(playerView());
        pulse.classList.remove('go'); void pulse.offsetWidth; pulse.classList.add('go');
      }
      draw();
    },
    centerOnPlayer, fitAll,
    /** (tests) the marker's place and what the ride overlay shows. */
    get you() { return player ? { x: player.x, z: player.z, heading: player.heading } : null; },
    get rideState() { return ride ? { lift: ride.lift.index, starts: ride.starts.map((p) => p.id), label: ride.label, sub: ride.sub } : null; },
    /** 28 Nov 2026: the map over a lift ride (null = none). lift = the net's entry (top, bottom, index), starts = the pistes that begin at its
     *  top (drawn with a halo), label / sub = the pill at the top station. Opens on the whole line. */
    setRide(info) {
      ride = info ? { lift: info.lift, starts: info.starts || [], label: info.label || '', sub: info.sub || '' } : null;
      if (info) { liftSel = info.lift; mode = 'ride'; }
      else if (mode === 'ride') mode = 'piste';
      const sz = size();
      if (info && info.fit && sz.w) {                      // the whole line (and where he is) in view, at once
        const l = info.lift, pts = [[l.top.x, l.top.z], [l.bottom.x, l.bottom.z]];
        if (player) pts.push([player.x, player.z]);
        const c = pts.map(([x, z]) => sheet.to(x, z)), xs = c.map((q) => q[0]), ys = c.map((q) => q[1]), k = sheet.k;
        const bw = Math.max(...xs) - Math.min(...xs) + 900 * k, bh = Math.max(...ys) - Math.min(...ys) + 900 * k;
        view = clampView({ x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...ys) + Math.max(...ys)) / 2, s: Math.max(fitScale, Math.min(sz.w / bw, sz.h / bh)) });
      }
      draw();
    },
    /** The skier on the lift: moves his marker, nothing recentres (he can look round the map while the carrier goes). */
    movePlayer(x, z, heading) {
      if (!player) return;
      player.x = x; player.z = z; if (Number.isFinite(heading)) player.heading = heading;
      requestDraw();
    },
    /** 'relief' (the panorama) | 'flat' (the plan). */
    setView, get view() { return sheet ? sheet.id : null; },
    selectLift(l, center = false) { liftSel = l; if (center && l) focusBox(Math.min(l.top.x, l.bottom.x), Math.min(l.top.z, l.bottom.z), Math.max(l.top.x, l.bottom.x), Math.max(l.top.z, l.bottom.z), 1400); else draw(); },
    focusBox, liftAt,
    /** Map clarity: the piste drawn under a world point (within HIT_PX on screen), for the tap card. */
    pisteAt(x, z, radius = 14) { const [px, py] = worldToScreen(x, z, size()); return pickAt(px, py, radius); },
    /** Round 7-C: the discovery (modes/discovery.js), the tap-to-teleport handler, the pin; CSS pixels <-> world metres. */
    setFog(d) { fog = d; draw(); },
    setTapWorld(fn) { tapWorld = fn; },
    setPin(p) { pin = p; draw(); },
    screenXY: (x, z) => worldToScreen(x, z, size()),
    /** The ground under a CSS pixel [x, z] (null: the sky of the panorama). */
    worldXY: (px, py) => screenToWorld(px, py, size()),
    get zoom() { return view.s / fitScale; },
    /** CSS px per metre now (the panorama: in the foreground). */
    get scale() { return view.s * sheet.k; },
    center(x, z, zoom = 3) { cancelAnimationFrame(anim); anim = 0; const [X, Y] = sheet.to(x, z); view.x = X; view.z = Y; view.s = Math.max(view.s, fitScale * zoom); clampView(); draw(); },
    dispose,
  };
}
