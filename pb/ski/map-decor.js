/* Crisp trees and houses over the painted panorama when the piste map is zoomed in (the painting has ~6 m per pixel: its little trees and
 * roofs would blur). The same conifers and houses as the painter's (scripts/ski/panorama.py), from the same data: one tree per TREE_M
 * square of forest in the class raster (piste aisles free), the houses of buildings.json; nothing behind a ridge. Built in slices after
 * the first zoom-in, kept only while the map is open. */
const TREE_PX = 4.6;                    // map pixels between two trees (at least MIN_TREE_M metres)
const MIN_TREE_M = 20;
const CELL = 96;                        // map pixels per bucket
const NEAR = 1400, NEAR_CELL = 200;     // trees within this distance of a piste / lift only
const SLICE_MS = 7;
const SPRITE = 64;                      // px
const ROW = 5;                          // numbers per tree / house while building

const hash = (i, j, k) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const css = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

function treeSprite(lit) {
  const c = document.createElement('canvas'); c.width = SPRITE; c.height = SPRITE;
  const g = c.getContext('2d');
  const cx = SPRITE / 2, base = SPRITE - 4, hw = SPRITE * 0.30;
  g.fillStyle = 'rgba(60,84,130,.22)'; g.beginPath(); g.ellipse(cx + 5, base, hw * 0.95, 4.5, 0, 0, 7); g.fill();
  const dark = css(46, 80, 80), light = css(82 + 26 * lit, 122 + 26 * lit, 98 + 18 * lit);
  for (let k = 0; k < 3; k++) {                      // three skirts, the lit side left
    const y1 = base - k * 15, y0 = y1 - 25 + k * 1.5, w = hw * (1 - k * 0.24);
    g.fillStyle = dark; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx + w, y1); g.lineTo(cx - w * 0.15, y1 + 1.5); g.closePath(); g.fill();
    g.fillStyle = light; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx + w * 0.1, y1 + 1.5); g.lineTo(cx - w, y1); g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(250,252,255,.85)';             // a little snow on the lit side
  g.beginPath(); g.moveTo(cx, base - 54); g.lineTo(cx - 2, base - 41); g.lineTo(cx - 7, base - 37); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(cx - 6, base - 22); g.lineTo(cx - 8, base - 15); g.lineTo(cx - 14, base - 14); g.closePath(); g.fill();
  return c;
}
function houseSprite(wall, roof) {
  const c = document.createElement('canvas'); c.width = SPRITE; c.height = SPRITE;
  const g = c.getContext('2d'), X = SPRITE / 2, Y = SPRITE * 0.72, w = SPRITE * 0.40, h = SPRITE * 0.44;
  const poly = (fill, ...p) => { g.fillStyle = fill; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); };
  g.fillStyle = 'rgba(60,84,130,.25)'; g.beginPath(); g.ellipse(X + 4, Y + 2, w * 1.15, 5, 0, 0, 7); g.fill();
  poly(css(...wall), X - w, Y, X - w, Y - h * 0.7, X + w * 0.25, Y - h * 0.5, X + w * 0.25, Y + h * 0.14);
  poly(css(...wall.map((v) => v * 0.74)), X + w * 0.25, Y + h * 0.14, X + w * 0.25, Y - h * 0.5, X + w, Y - h * 0.7, X + w, Y);
  g.fillStyle = 'rgba(70,56,48,.75)';                // windows
  for (let i = 0; i < 3; i++) g.fillRect(X - w * 0.82 + i * w * 0.36, Y - h * 0.36 + i * h * 0.06, w * 0.16, h * 0.2);
  poly('#fdfdfb', X - w * 1.12, Y - h * 0.62, X - w * 0.45, Y - h * 1.32, X + w * 0.62, Y - h * 1.32, X + w * 0.25, Y - h * 0.42);
  poly(css(...roof), X + w * 0.62, Y - h * 1.32, X + w * 1.12, Y - h * 0.62, X + w * 0.25, Y - h * 0.42);
  return c;
}

/** createDecor(...) -> { build(done), ready, draw(g, x0, y0, x1, y1, s), dispose } in map pixels (s = CSS px per map pixel). */
export function createDecor({ pano, resort, classes, height, buildingsUrl }) {
  const W = pano.w, H = pano.h, nbx = Math.ceil(W / CELL), nby = Math.ceil(H / CELL);
  let buckets = null, sprites = null, state = 'idle', stopped = false, timer = 0;

  function nearGrid() {
    const nx = Math.ceil(resort.width / NEAR_CELL), nz = Math.ceil(resort.depth / NEAR_CELL), r = Math.ceil(NEAR / NEAR_CELL), raw = new Uint8Array(nx * nz), out = new Uint8Array(nx * nz);
    const mark = (x, z) => { const i = Math.floor(x / NEAR_CELL), j = Math.floor(z / NEAR_CELL); if (i >= 0 && j >= 0 && i < nx && j < nz) raw[j * nx + i] = 1; };
    for (const n of resort.network) for (let i = 0; i < n.p.length; i += 2) mark(n.p[i], n.p[i + 1]);
    for (const l of resort.lifts) for (let i = 0; i < l.pts.length; i += 2) mark(l.pts[i], l.pts[i + 1]);
    for (const p of resort.places) if (p.kind !== 'hamlet') mark(p.x, p.z);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!raw[j * nx + i]) continue;
      for (let b = Math.max(0, j - r); b <= Math.min(nz - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) out[b * nx + a] = 1;
    }
    return (x, z) => { const i = Math.floor(x / NEAR_CELL), j = Math.floor(z / NEAR_CELL); return i >= 0 && j >= 0 && i < nx && j < nz && out[j * nx + i] === 1; };
  }

  function build(done) {
    if (state !== 'idle') return;
    state = 'building';
    const near = nearGrid(), b = resort.classes.bits, cs = resort.classes.step, cnx = classes.nx, cnz = classes.nz, data = classes.data;
    const cls = (x, z) => data[Math.min(cnz - 1, Math.max(0, Math.floor(z / cs))) * cnx + Math.min(cnx - 1, Math.max(0, Math.floor(x / cs)))];
    const m = Math.max(MIN_TREE_M, TREE_PX / pano.k), nx = Math.floor(resort.width / m), nz = Math.floor(resort.depth / m);
    const unit = pano.k / 0.16, size0 = 6.6 * Math.max(unit, 0.56);
    let flat = new Float32Array(ROW * 8192), count = 0;                      // rows of s, px, py, size, sprite (no array per tree: garbage)
    const add = (x, z, size, sprite, slack) => {
      const y = height(x, z), [px, py] = pano.project(x, z, y);
      if (px < -20 || py < -20 || px > W + 20 || py > H + 20) return;
      const s = pano.depth(x, z);
      if (py - size * 0.5 - slack > pano.cover(px, s)) return;             // behind a ridge
      if ((count + 1) * ROW > flat.length) { const bigger = new Float32Array(flat.length * 2); bigger.set(flat); flat = bigger; }
      const o = count++ * ROW;
      flat[o] = s; flat[o + 1] = px; flat[o + 2] = py; flat[o + 3] = size * pano.sizeAt(s); flat[o + 4] = sprite;
    };
    let row = 0;
    const finish = () => {
      const order = new Uint32Array(count).map((_, i) => i).sort((p, q) => flat[q * ROW] - flat[p * ROW]);       // back to front
      const keyOf = (o) => Math.min(nby - 1, Math.max(0, Math.floor(flat[o + 2] / CELL))) * nbx + Math.min(nbx - 1, Math.max(0, Math.floor(flat[o + 1] / CELL)));
      const sizes = new Map(), fill = new Map();
      for (let i = 0; i < count; i++) { const key = keyOf(i * ROW); sizes.set(key, (sizes.get(key) || 0) + 4); }
      buckets = new Map();
      for (const [key, n] of sizes) buckets.set(key, new Float32Array(n));
      for (let i = 0; i < count; i++) {
        const o = order[i] * ROW, key = keyOf(o), at = fill.get(key) || 0;
        buckets.get(key).set(flat.subarray(o + 1, o + ROW), at);
        fill.set(key, at + 4);
      }
      flat = null;
      sprites = [treeSprite(0), treeSprite(0.5), treeSprite(1), houseSprite([224, 196, 160], [176, 124, 96]), houseSprite([206, 168, 128], [204, 212, 226]), houseSprite([238, 224, 200], [204, 212, 226]), houseSprite([186, 142, 104], [176, 124, 96])];
      state = 'ready';
      done();
    };
    const houses = async () => {
      try {
        const rows = await (await fetch(buildingsUrl)).json();
        if (stopped) return;
        const lo = 3.6 * Math.max(unit, 0.52), hi = 15 * Math.max(unit, 0.52);
        rows.forEach((r, i) => { if (near(r[0], r[1])) add(r[0], r[1], Math.min(hi, Math.max(lo, Math.max(r[2], r[3]) * pano.k * 1.45)), 3 + (Math.floor(((i * 0.6180339) % 1) * 4) % 4), 3); });
      } catch (error) { console.warn('[ski] map houses', error.message); }
      if (!stopped) finish();
    };
    const step = () => {
      if (stopped) return;
      const t0 = performance.now();
      while (row < nz && performance.now() - t0 < SLICE_MS) {
        for (let i = 0; i < nx; i++) {
          const x = (i + hash(i, row, 1)) * m, z = (row + hash(i, row, 2)) * m, c = cls(x, z);
          if (!(c & (b.forest | b.scrub)) || c & (b.water | b.built | b.piste)) continue;
          const h3 = hash(i, row, 3);
          if (c & b.forest ? h3 > 0.96 : h3 > 0.16) continue;
          if (!near(x, z)) continue;
          if ((cls(x + 22, z) | cls(x - 22, z) | cls(x, z + 22) | cls(x, z - 22)) & b.piste) continue;
          const gr = (height(x + 40, z) - height(x - 40, z)) * Math.cos((pano.cam.az * Math.PI) / 180) + (height(x, z + 40) - height(x, z - 40)) * Math.sin((pano.cam.az * Math.PI) / 180);
          add(x, z, size0 * (0.8 + 0.45 * hash(i, row, 4)), gr / 80 > 0.1 ? 2 : gr / 80 < -0.2 ? 0 : 1, 2);
        }
        row++;
      }
      if (row < nz) timer = setTimeout(step, 0); else houses();
    };
    timer = setTimeout(step, 0);
  }

  /** Draws everything in the map rectangle; g already in map pixels. */
  function draw(g, x0, y0, x1, y1) {
    if (state !== 'ready') return;
    const i0 = Math.max(0, Math.floor((x0 - 16) / CELL)), i1 = Math.min(nbx - 1, Math.floor((x1 + 16) / CELL));
    const j0 = Math.max(0, Math.floor(y0 / CELL)), j1 = Math.min(nby - 1, Math.floor((y1 + 24) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = buckets.get(j * nbx + i);
      if (!a) continue;
      for (let q = 0; q < a.length; q += 4) {
        const sp = a[q + 3], tree = sp < 3, d = a[q + 2] * (tree ? 1.36 : 1.5);
        g.drawImage(sprites[sp], a[q] - d / 2, a[q + 1] - d * (tree ? 0.94 : 0.72), d, d);
      }
    }
  }
  return {
    build, draw, get ready() { return state === 'ready'; }, get idle() { return state === 'idle'; },
    dispose() { stopped = true; clearTimeout(timer); buckets = null; sprites = null; state = 'gone'; },
  };
}
