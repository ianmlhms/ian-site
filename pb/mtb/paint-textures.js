/* The painted look: every ground texture is drawn here, with canvas strokes, at start-up (no downloaded pictures, no satellite imagery).
 * All textures tile seamlessly (every stroke is drawn wrapped around the edges). Colours are display (sRGB) values: the whole game shades in
 * display space, which is what gives the soft gouache look. */
import { createRng } from './noise.js';
import { paintLeafAtlas, ATLAS } from './leaf-textures.js';

const T = () => window.THREE;
const TAU = Math.PI * 2;

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Draws `draw(ctx, x, y)` at (x, y) and at the wrapped positions when it is near an edge, so the texture tiles. */
function wrapped(ctx, size, x, y, margin, draw) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx, py = y + dy;
      if (px < -margin || py < -margin || px > size + margin || py > size + margin) continue;
      draw(ctx, px, py);
    }
  }
}

function rgb(c, jitter, rng) {
  const j = () => (rng() - 0.5) * 2 * jitter;
  return `rgb(${Math.max(0, Math.min(255, c[0] + j()))|0},${Math.max(0, Math.min(255, c[1] + j()))|0},${Math.max(0, Math.min(255, c[2] + j()))|0})`;
}

function stroke(ctx, x, y, len, wid, angle, color, alpha) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, len, wid, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Forest floor: beech leaf litter, twigs and a few pale flecks. */
function litter(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(104,80,54)'; ctx.fillRect(0, 0, size, size);
  const palette = [[150, 100, 58], [126, 84, 50], [164, 116, 66], [96, 68, 44], [176, 136, 84], [112, 88, 56], [136, 80, 48], [104, 84, 52]];
  for (let i = 0; i < size * 2.6; i++) {
    const x = rng() * size, y = rng() * size, len = 3 + rng() * 9, wid = len * (0.35 + rng() * 0.3), a = rng() * TAU;
    const col = rgb(palette[(rng() * palette.length) | 0], 14, rng);
    wrapped(ctx, size, x, y, len + 2, (g, px, py) => stroke(g, px, py, len, wid, a, col, 0.5 + rng() * 0.4));
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < size * 0.35; i++) {                              // twigs
    const x = rng() * size, y = rng() * size, l = 6 + rng() * 14, a = rng() * TAU;
    ctx.strokeStyle = rgb([84, 60, 38], 10, rng); ctx.globalAlpha = 0.7; ctx.lineWidth = 0.8 + rng() * 0.8;
    wrapped(ctx, size, x, y, l, (g, px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  for (let i = 0; i < size * 0.5; i++) {                               // dry pale flecks
    const x = rng() * size, y = rng() * size;
    wrapped(ctx, size, x, y, 3, (g, px, py) => stroke(g, px, py, 1.2 + rng() * 1.6, 0.8, rng() * TAU, 'rgb(214,188,130)', 0.35));
  }
  return c;
}

/** Moss and ferny undergrowth: soft green blobs with brighter tips. */
function moss(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(58,98,46)'; ctx.fillRect(0, 0, size, size);
  const palette = [[78, 128, 52], [52, 92, 44], [104, 150, 60], [64, 112, 56], [126, 160, 70]];
  for (let i = 0; i < size * 3.2; i++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 6;
    const col = rgb(palette[(rng() * palette.length) | 0], 12, rng);
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => stroke(g, px, py, r, r * (0.5 + rng() * 0.5), rng() * TAU, col, 0.45 + rng() * 0.4));
  }
  for (let i = 0; i < size * 1.4; i++) {                               // fern fronds: thin bright strokes
    const x = rng() * size, y = rng() * size, a = rng() * TAU, l = 5 + rng() * 10;
    ctx.strokeStyle = rgb([140, 178, 78], 14, rng); ctx.globalAlpha = 0.55; ctx.lineWidth = 0.9;
    wrapped(ctx, size, x, y, l, (g, px, py) => { g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(a) * l * 0.5, py + Math.sin(a) * l * 0.5 - 2, px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  return c;
}

/** Trail dirt: packed sand and gravel, small pebbles, faint tyre-fine streaks. */
function dirt(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(168,134,92)'; ctx.fillRect(0, 0, size, size);
  const palette = [[180, 146, 100], [156, 122, 82], [192, 160, 114], [138, 106, 72], [172, 140, 104]];
  for (let i = 0; i < size * 2.4; i++) {
    const x = rng() * size, y = rng() * size, r = 1.5 + rng() * 5;
    const col = rgb(palette[(rng() * palette.length) | 0], 10, rng);
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => stroke(g, px, py, r, r * (0.55 + rng() * 0.4), rng() * TAU, col, 0.4 + rng() * 0.4));
  }
  for (let i = 0; i < size * 0.9; i++) {                               // pebbles with a lit edge
    const x = rng() * size, y = rng() * size, r = 0.9 + rng() * 2.4;
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => {
      stroke(g, px, py, r, r * 0.8, rng() * TAU, rgb([120, 100, 80], 24, rng), 0.85);
      stroke(g, px - r * 0.3, py - r * 0.3, r * 0.5, r * 0.4, 0.6, 'rgb(226,208,170)', 0.5);
    });
  }
  return c;
}

/** Sandstone: warm ochre grain; the strata and weathering are computed in the shader from world height. */
function sandstone(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(196,160,118)'; ctx.fillRect(0, 0, size, size);
  const palette = [[210, 176, 132], [184, 144, 104], [222, 190, 146], [170, 132, 98], [200, 150, 112]];
  for (let i = 0; i < size * 2.2; i++) {
    const x = rng() * size, y = rng() * size, l = 3 + rng() * 14, w = 1 + rng() * 3.2;
    const col = rgb(palette[(rng() * palette.length) | 0], 10, rng);
    wrapped(ctx, size, x, y, l + 2, (g, px, py) => stroke(g, px, py, l, w, (rng() - 0.5) * 0.35, col, 0.35 + rng() * 0.4));   // mostly horizontal strokes
  }
  for (let i = 0; i < size * 0.6; i++) {                               // cracks and dark pits
    const x = rng() * size, y = rng() * size;
    wrapped(ctx, size, x, y, 4, (g, px, py) => stroke(g, px, py, 1 + rng() * 3, 0.7 + rng() * 0.8, rng() * TAU, 'rgb(104,78,58)', 0.35));
  }
  return c;
}

/** Tileable noise: R fbm(low) G fbm(mid) B fbm(high) A ridged. Periodic value noise. */
function noiseData(size, seed) {
  const rng = createRng(seed);
  const lattice = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rng(); return a; };
  const layers = [lattice(8), lattice(16), lattice(32), lattice(64)];
  const sizes = [8, 16, 32, 64];
  const sample = (k, u, v) => {
    const n = sizes[k], L = layers[k];
    const x = u * n, y = v * n, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (a, b) => L[((b % n + n) % n) * n + ((a % n + n) % n)];
    return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, o = (y * size + x) * 4;
      const a = sample(0, u, v) * 0.6 + sample(1, u, v) * 0.4;
      const b = sample(1, u, v) * 0.55 + sample(2, u, v) * 0.45;
      const c2 = sample(2, u, v) * 0.55 + sample(3, u, v) * 0.45;
      const r = 1 - Math.abs(sample(1, u, v) * 2 - 1);
      data[o] = a * 255; data[o + 1] = b * 255; data[o + 2] = c2 * 255; data[o + 3] = r * r * 255;
    }
  }
  return data;
}

/* The painted set (scripts/mtb/gen_textures.py, gpt-image-2, kept in data/tex/): hand-painted tileable materials. They replace the canvas-drawn fallbacks above
 * before the first frame (`textures.ready`); when a file is missing the canvas version stays, the game still runs. */
const TEX_URL = new URL('./data/tex/', import.meta.url);
const TEX_FILES = Object.freeze({
  litter: 'litter_summer', litterAutumn: 'litter_autumn', moss: 'moss', dirt: 'dirt_roots', sandstone: 'sandstone', rockMoss: 'sandstone_moss', rockWet: 'wet_rock',
  barkBeech: 'bark_beech', barkOak: 'bark_oak', grass: 'grass', foam: 'foam',
});

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`texture ${name} failed to load`));
    img.src = new URL(`${name}.webp`, TEX_URL).href;
  });
}

const PAINTED_TILES = Object.freeze([0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15]);   // the canvas tiles 4..7 (grass, bramble, spruce, herbs) stay

/** Copies the painted tiles (RGBA, picture rows top-down) over the canvas atlas in place (its rows run bottom-up). */
function overlayLeafAtlas(atlas, img) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const painted = ctx.getImageData(0, 0, cv.width, cv.height).data;
  if (cv.width !== atlas.width || cv.height !== atlas.height) throw new Error('painted leaf atlas has the wrong size');
  const tile = ATLAS.tile;
  for (const id of PAINTED_TILES) {
    const col = id % ATLAS.cols, row = Math.floor(id / ATLAS.cols);
    for (let ty = 0; ty < tile; ty++) {
      for (let tx = 0; tx < tile; tx++) {
        const i = ((row * tile + ty) * cv.width + col * tile + tx) * 4;
        const o = ((cv.height - 1 - (row * tile + ty)) * cv.width + col * tile + tx) * 4;
        atlas.data[o] = painted[i]; atlas.data[o + 1] = painted[i + 1]; atlas.data[o + 2] = painted[i + 2]; atlas.data[o + 3] = painted[i + 3];
      }
    }
  }
}

/** Builds all textures. `renderer` supplies the anisotropy limit. */
export function createPaintTextures(renderer, quality) {
  const THREE = T();
  const size = quality === 'low' ? 256 : 512;
  const aniso = Math.min(quality === 'low' ? 2 : 8, renderer.capabilities.getMaxAnisotropy());
  const make = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const noiseSize = 256;
  const noise = new THREE.DataTexture(noiseData(noiseSize, 4242), noiseSize, noiseSize, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter; noise.minFilter = THREE.LinearMipmapLinearFilter; noise.generateMipmaps = true;
  noise.colorSpace = THREE.NoColorSpace; noise.needsUpdate = true;
  const atlas = paintLeafAtlas();
  const leafAtlas = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
  leafAtlas.wrapS = leafAtlas.wrapT = THREE.ClampToEdgeWrapping;
  leafAtlas.magFilter = THREE.LinearFilter; leafAtlas.minFilter = THREE.LinearMipmapLinearFilter; leafAtlas.generateMipmaps = true;
  leafAtlas.anisotropy = aniso; leafAtlas.colorSpace = THREE.NoColorSpace; leafAtlas.flipY = false; leafAtlas.needsUpdate = true;
  const textures = { litter: make(litter(size, 11)), moss: make(moss(size, 12)), dirt: make(dirt(size, 13)), sandstone: make(sandstone(size, 14)), noise, leafAtlas, size, painted: false };
  // painted extras start as separate textures (canvas fallbacks); the files replace their images before the first frame, a missing file never breaks the game
  for (const key of ['litterAutumn', 'rockMoss', 'rockWet', 'barkBeech', 'barkOak', 'grass', 'foam']) textures[key] = make(key === 'litterAutumn' ? litter(size, 15) : key === 'grass' ? moss(size, 16) : key.startsWith('bark') ? dirt(size, 17) : key === 'foam' ? canvas(8) : sandstone(size, 18));
  const loads = Object.entries(TEX_FILES).map(async ([key, file]) => {
    try {
      const img = await loadImage(file);
      textures[key].image = img; textures[key].needsUpdate = true;
      return true;
    } catch (error) { console.warn('[mtb] painted texture missing, using the canvas fallback:', file, error); return false; }
  });
  loads.push((async () => {
    try {
      overlayLeafAtlas(atlas, await loadImage('leaf-atlas'));
      leafAtlas.needsUpdate = true;
      return true;
    } catch (error) { console.warn('[mtb] painted leaf atlas missing, using the canvas atlas', error); return false; }
  })());
  textures.ready = Promise.all(loads).then((results) => { textures.painted = results.every(Boolean); return textures; });
  return textures;
}

export { litter as drawLitter, moss as drawMoss, dirt as drawDirt, sandstone as drawSandstone };
