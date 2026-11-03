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

/** The tarmac: a dark grey with a fine grain, a few lighter patches and the odd crack. */
function asphalt(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(62,63,66)'; ctx.fillRect(0, 0, size, size);
  const palette = [[74, 75, 78], [58, 59, 62], [82, 83, 86], [66, 66, 70], [54, 55, 58]];
  for (let i = 0; i < size * 3.4; i++) {                       // the grain of the tar
    const x = rng() * size, y = rng() * size, r = 1 + rng() * 4.5;
    const col = rgb(palette[(rng() * palette.length) | 0], 7, rng);
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => stroke(g, px, py, r, r * (0.5 + rng() * 0.5), rng() * TAU, col, 0.22 + rng() * 0.25));
  }
  for (let i = 0; i < size * 0.35; i++) {                      // the patches where the tar is older
    const x = rng() * size, y = rng() * size, r = 6 + rng() * 22;
    const col = rgb([86, 86, 88], 10, rng);
    wrapped(ctx, size, x, y, r + 2, (g, px, py) => stroke(g, px, py, r, r * (0.5 + rng() * 0.4), rng() * TAU, col, 0.12 + rng() * 0.12));
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < size * 0.25; i++) {                      // the cracks
    const x = rng() * size, y = rng() * size, l = 5 + rng() * 18, a = rng() * TAU;
    ctx.strokeStyle = 'rgb(44,44,47)'; ctx.globalAlpha = 0.35 + rng() * 0.3; ctx.lineWidth = 0.6 + rng() * 0.7;
    wrapped(ctx, size, x, y, l, (g, px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
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

/** The cobbles of the old town: rounded stones in rows, each with a lit edge. */
function cobble(size, seed) {
  const rng = createRng(seed), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(96,93,88)'; ctx.fillRect(0, 0, size, size);
  const rows = 12, h = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 12 + (r % 2), w = size / cols;
    for (let k = 0; k < cols; k++) {
      const x = k * w + (r % 2) * w * 0.5 + (rng() - 0.5) * 1.6, y = r * h + (rng() - 0.5) * 1.6;
      const rx = w * 0.46, ry = h * 0.46;
      const tone = 118 + rng() * 40;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = rgb([tone, tone - 4, tone - 10], 10, rng);
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, (rng() - 0.5) * 0.3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.4;                                    // the lit top edge of the stone
      ctx.fillStyle = rgb([tone + 34, tone + 30, tone + 24], 8, rng);
      ctx.beginPath(); ctx.ellipse(x - rx * 0.22, y - ry * 0.22, rx * 0.62, ry * 0.5, 0, 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
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
    gravel: make(gravel(size, 24)), ground: make(ground(size, 25)), litter: make(litter(size, 26)), noise, size,
  };
  textures.ready = Promise.resolve(textures);
  return textures;
}

export { asphalt as drawAsphalt, pavement as drawPavement, cobble as drawCobble, gravel as drawGravel, ground as drawGround, litter as drawLitter };
