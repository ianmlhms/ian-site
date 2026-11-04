/* The painted look of Lux Drive: every surface texture is drawn here, with canvas strokes, at start-up (no downloaded
 * pictures, no satellite imagery, no photographs).
 * All textures tile seamlessly (every stroke is drawn wrapped around the edges). Colours are display (sRGB) values: the
 * whole game shades in display space, which is what gives the soft gouache look. */
import { createRng } from './noise.js';

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

/** The tarmac: a calm dark grey of fine grain.  From the driver's seat a tile is only 3 m wide, so any blob larger than a few centimetres reads as a
 *  bump in the road: the grain is per pixel (the size of a stone chip), the variation is a few very soft, very low-contrast clouds, and the cracks are rare hairlines. */
const ASPHALT_BASE = [63, 64, 67];
const ASPHALT_GRAIN = 9;                     // +- levels of the per-pixel grain
const ASPHALT_CLOUDS = 7;                    // soft low-contrast clouds that break the repetition without making blobs
function asphalt(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // two uniform numbers make a triangular distribution: most chips are close to the base, a few are lighter or darker
    const g = ((rng() + rng()) - 1) * ASPHALT_GRAIN;
    const chip = rng() < 0.02 ? 12 + rng() * 10 : 0;                        // the odd light stone chip
    img.data[i * 4] = ASPHALT_BASE[0] + g + chip; img.data[i * 4 + 1] = ASPHALT_BASE[1] + g + chip; img.data[i * 4 + 2] = ASPHALT_BASE[2] + g + chip; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < ASPHALT_CLOUDS; i++) {                               // old and new tar: a difference of 2-3 levels, no edge
    const x = rng() * size, y = rng() * size, r = size * (0.18 + rng() * 0.22), light = rng() < 0.5;
    wrapped(ctx, size, x, y, r, (g, px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      const rgbv = light ? '255,255,255' : '0,0,0';
      grad.addColorStop(0, `rgba(${rgbv},0.045)`); grad.addColorStop(1, `rgba(${rgbv},0)`);
      g.fillStyle = grad; g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < size * 0.04; i++) {                                  // hairline cracks, rare and faint
    const x = rng() * size, y = rng() * size, l = 12 + rng() * 30, a = rng() * TAU;
    ctx.strokeStyle = 'rgb(48,48,51)'; ctx.globalAlpha = 0.18 + rng() * 0.15; ctx.lineWidth = 0.7;
    wrapped(ctx, size, x, y, l, (g, px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  ctx.globalAlpha = 1;
  return c;
}

/** The pavement: concrete slabs in rows, the joints a shade darker, the slabs a shade apart. */
function pavement(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(150,148,142)'; ctx.fillRect(0, 0, size, size);
  const rows = 8, h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 4 + (r % 2);
    const w = size / cols;
    for (let k = 0; k < cols; k++) {
      const x = k * w + (r % 2) * w * 0.5, y = r * h;
      const shade = 140 + rng() * 26;
      ctx.fillStyle = `rgb(${shade|0},${(shade - 2)|0},${(shade - 8)|0})`;
      ctx.fillRect(x + 0.8, y + 0.8, w - 1.6, h - 1.6);
      ctx.globalAlpha = 0.25 + rng() * 0.25;                     // the speckle of the concrete
      for (let i = 0; i < 14; i++) {
        const px = x + rng() * w, py = y + rng() * h;
        ctx.fillStyle = rgb([shade, shade - 4, shade - 10], 16, rng);
        ctx.fillRect(px, py, 1 + rng() * 1.6, 1 + rng() * 1.6);
      }
      ctx.globalAlpha = 1;
    }
  }
  return c;
}

/** The cobbles of the old town: rounded stones in rows, each with a soft lit edge.  The stones stay close in tone:
 *  a cobble street that glitters with coloured dots reads as a toy, not as a street. */
function cobble(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(88,85,80)'; ctx.fillRect(0, 0, size, size);
  const rows = 12, h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 12 + (r % 2), w = size / cols;
    for (let k = 0; k < cols; k++) {
      const x = k * w + (r % 2) * w * 0.5 + (rng() - 0.5) * 1.6, y = r * h + (rng() - 0.5) * 1.6;
      const rx = w * 0.46, ry = h * 0.46;
      const tone = 104 + rng() * 10;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = rgb([tone, tone - 4, tone - 10], 5, rng);
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, (rng() - 0.5) * 0.3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.10;                                   // the lit top edge of the stone
      ctx.fillStyle = rgb([tone + 16, tone + 14, tone + 10], 5, rng);
      ctx.beginPath(); ctx.ellipse(x - rx * 0.18, y - ry * 0.18, rx * 0.66, ry * 0.56, 0, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

/** The paved stone of a square: big calm slabs, a soft joint between them, a fine grain.  The slabs are almost
 *  the same tone - a square is a calm surface, not a pattern of coloured dots. */
function stone(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(150,145,136)'; ctx.fillRect(0, 0, size, size);
  const rows = 6, h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 6 + (r % 2), w = size / cols;
    for (let k = 0; k < cols; k++) {
      const x = k * w + (r % 2) * w * 0.5, y = r * h;
      const shade = 146 + rng() * 12;
      ctx.fillStyle = `rgb(${shade | 0},${(shade - 4) | 0},${(shade - 11) | 0})`;
      ctx.fillRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4);         // the joint is the ground between the slabs
      ctx.globalAlpha = 0.16 + rng() * 0.12;                     // the grain of the stone
      for (let i = 0; i < 10; i++) {
        const px = x + rng() * w, py = y + rng() * h;
        ctx.fillStyle = rgb([shade - 6, shade - 10, shade - 16], 8, rng);
        ctx.fillRect(px, py, 1 + rng() * 2.2, 1 + rng() * 2.2);
      }
      ctx.globalAlpha = 1;
    }
  }
  return c;
}

/** A gravel track: loose stones in sandy earth. */
function gravel(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(142,130,108)'; ctx.fillRect(0, 0, size, size);
  const palette = [[156, 144, 120], [130, 120, 100], [168, 156, 130], [118, 108, 92]];
  for (let i = 0; i < size * 2.6; i++) {
    const x = rng() * size, y = rng() * size, r = 1.2 + rng() * 3.6;
    const col = rgb(palette[(rng() * palette.length) | 0], 12, rng);
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => stroke(g, px, py, r, r * (0.6 + rng() * 0.35), rng() * TAU, col, 0.4 + rng() * 0.35));
  }
  for (let i = 0; i < size * 0.8; i++) {                         // the bigger stones with a lit edge
    const x = rng() * size, y = rng() * size, r = 1.4 + rng() * 2.6;
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => {
      stroke(g, px, py, r, r * 0.85, rng() * TAU, rgb([116, 106, 88], 18, rng), 0.9);
      stroke(g, px - r * 0.3, py - r * 0.3, r * 0.5, r * 0.4, 0.6, 'rgb(214,202,176)', 0.5);
    });
  }
  return c;
}

/** The ground: a soft painted mix of grass and earth, tinted per land class in the shader. */
function ground(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(150,158,120)'; ctx.fillRect(0, 0, size, size);
  const palette = [[162, 170, 128], [138, 148, 108], [172, 176, 138], [126, 138, 100], [154, 150, 116]];
  for (let i = 0; i < size * 2.8; i++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 7;
    const col = rgb(palette[(rng() * palette.length) | 0], 12, rng);
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => stroke(g, px, py, r, r * (0.45 + rng() * 0.45), rng() * TAU, col, 0.3 + rng() * 0.3));
  }
  for (let i = 0; i < size * 1.2; i++) {                         // the blades and the little flowers
    const x = rng() * size, y = rng() * size, l = 2 + rng() * 5, a = rng() * TAU;
    ctx.strokeStyle = rgb([118, 132, 88], 14, rng); ctx.globalAlpha = 0.4 + rng() * 0.3; ctx.lineWidth = 0.8;
    wrapped(ctx, size, x, y, l, (g, px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  ctx.globalAlpha = 1;
  return c;
}

/** The forest floor: beech leaf litter and twigs, the brown ground under the trees. */
function litter(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(112,92,66)'; ctx.fillRect(0, 0, size, size);
  const palette = [[146, 112, 74], [126, 96, 60], [158, 124, 82], [104, 82, 56], [168, 138, 96]];
  for (let i = 0; i < size * 2.6; i++) {
    const x = rng() * size, y = rng() * size, len = 3 + rng() * 8, wid = len * (0.35 + rng() * 0.3), a = rng() * TAU;
    const col = rgb(palette[(rng() * palette.length) | 0], 12, rng);
    wrapped(ctx, size, x, y, len + 2, (g, px, py) => stroke(g, px, py, len, wid, a, col, 0.4 + rng() * 0.35));
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < size * 0.3; i++) {                           // the twigs
    const x = rng() * size, y = rng() * size, l = 6 + rng() * 13, a = rng() * TAU;
    ctx.strokeStyle = rgb([88, 66, 44], 10, rng); ctx.globalAlpha = 0.65; ctx.lineWidth = 0.8 + rng() * 0.8;
    wrapped(ctx, size, x, y, l, (g, px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  ctx.globalAlpha = 1;
  return c;
}

/** The clouds of the sky: soft white cumulus on the blue of the sky. The painted tile (data/tex/sky.webp, the same
 *  file the MTB engine uses) replaces this canvas before the first frame; this is the fallback when it is missing. */
function sky(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(112,166,214)'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = rng() * size, y = rng() * size, r = size * (0.04 + rng() * 0.10);
    wrapped(ctx, size, x, y, r, (g, px, py) => {
      const grad = g.createRadialGradient(px, py - r * 0.22, r * 0.08, px, py, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.55, 'rgba(238,240,246,0.62)');
      grad.addColorStop(1, 'rgba(214,220,232,0)');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(px, py, r, r * 0.72, 0, 0, TAU); g.fill();
    });
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

/* The painted sky tile (data/tex/sky.webp): a hand-painted sky with white cumulus clouds, the same file the MTB engine
 * uses (pb/mtb/data/tex/sky.webp - it is a copy of it, the file is committed with the repo). The sky shader reads it as
 * uSkyPaint; with the RGB noise texture instead the clouds were the coloured specks (purple, red, blue) the reviewer saw:
 * the channels of the noise are independent, so every cloud got a colour of its own. */
const TEX_URL = new URL('./data/tex/', import.meta.url);

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`texture ${name} failed to load`));
    img.src = new URL(`${name}.webp?v=1`, TEX_URL).href;
  });
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
  const textures = {
    asphalt: make(asphalt(size, 21)), pavement: make(pavement(size, 22)), cobble: make(cobble(size, 23)),
    gravel: make(gravel(size, 24)), ground: make(ground(size, 25)), litter: make(litter(size, 26)),
    stone: make(stone(size, 27)), sky: make(sky(size, 28)), noise, size,
  };
  // the painted cloud tile replaces the canvas before the first frame; a missing file never breaks the game
  textures.ready = loadImage('sky')
    .then((img) => { textures.sky.image = img; textures.sky.needsUpdate = true; return textures; })
    .catch((error) => { console.warn('[luxdrive] painted sky missing, using the canvas fallback:', error); return textures; });
  return textures;
}

export { asphalt as drawAsphalt, pavement as drawPavement, cobble as drawCobble, gravel as drawGravel, ground as drawGround, litter as drawLitter, stone as drawStone, sky as drawSky };
