/* Sandstone models, built from displaced boxes and spheres (no photographs). Slab space: x along the contour (-0.5 .. 0.5), y up the slope (0 .. 1), z out of the slope:
 * the face is at z = 0, the body reaches back to z = -1 into the hill. Strata are recesses by height (hard layers stand, soft layers are eaten back), block joints are
 * vertical grooves, the top and the edges are rounded, the lower part may be undercut (overhang). The bottom ring of every model is marked aSkirt = 1: the vertex
 * shader lowers it by the instance's `sink`, so the solid always reaches below the terrain.
 * Two levels of detail: near (about 300 triangles) and far (about 70). */
import { createRng, valueNoise } from './noise.js';

const THREE = window.THREE;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Recess of the strata at height y (0 .. 1): a stack of layers, soft ones eaten back. Returns metres-in-unit (0 .. 0.13). */
function strata(y, seed) {
  let acc = 0, edge = 0;
  const layers = [0.17, 0.12, 0.22, 0.14, 0.19, 0.16];
  for (let i = 0; i < layers.length; i++) {
    const w = layers[i] * (0.85 + 0.3 * valueNoise(i * 3.7 + seed, 1.3, 2));
    const lo = edge, hi = edge + w;
    if (y >= lo && y < hi) { const soft = (i + Math.floor(seed * 10)) % 2 === 0; const t = (y - lo) / w; return (soft ? 0.12 : 0.02) * (0.85 + 0.15 * Math.sin(t * Math.PI)) + acc; }
    edge = hi;
  }
  return 0.04;
}

function displaceSlab(geo, variant, seed) {
  const p = geo.attributes.position;
  const skirt = new Float32Array(p.count);
  const overhang = variant === 'overhang';
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // the Box is centred: map to slab space (x -0.5..0.5, y 0..1, z -1..0)
    y += 0.5; z -= 0.5;
    const front = smooth(-0.3, 0, z), side = smooth(0.32, 0.5, Math.abs(x));
    const rec = strata(clamp01(y), seed);
    z -= rec * front;
    x -= Math.sign(x) * strata(clamp01(y + 0.2), seed + 3) * 0.7 * side;
    // block joints: vertical grooves in the face
    const joint = Math.max(0, 1 - Math.abs(x - (valueNoise(seed * 5.1, 4.4, 1) - 0.5) * 0.6) * 38) * 0.05;
    z -= joint * front;
    // large irregularity of the outline, rounded top and edges
    const n1 = valueNoise(x * 2.6 + seed * 9, y * 2.2 + z * 1.9, 5) - 0.5, n2 = valueNoise(x * 6.1 + 4, y * 5.3 + z * 4.1 + seed * 5, 6) - 0.5;
    z += (n1 * 0.2 + n2 * 0.06) * front;
    x += (n1 * 0.14 + n2 * 0.04) * side * Math.sign(x);
    const top = smooth(0.62, 1.0, y);
    y -= top * (0.16 * Math.pow(Math.abs(x) * 2, 3) + 0.12 * Math.pow(clamp01((z + 0.35) / 0.35), 2.2) + (n1 + 0.3) * 0.12);
    if (overhang) {                                                    // undercut: the lower third is cut back, a cap rests on it
      const cut = 1 - smooth(0.2, 0.42, y);
      z -= cut * 0.42 * front * (0.7 + 0.5 * valueNoise(x * 3 + 1, 8, 3));
    }
    const bottom = y <= 0.001 ? 1 : 0;
    skirt[i] = bottom;
    p.setXYZ(i, x, y, z);
  }
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  return geo;
}

function slabGeometry(variant, seed, near) {
  const geo = new THREE.BoxGeometry(1, 1, 1, near ? 9 : 3, near ? 8 : 3, near ? 5 : 2);
  displaceSlab(geo, variant, seed);
  return finish(geo, near ? 'slab' : 'slab-far', seed);
}

function boulderGeometry(seed, near) {
  const geo = new THREE.IcosahedronGeometry(0.5, near ? 2 : 1);
  const p = geo.attributes.position;
  const skirt = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.34 * (valueNoise(x * 2.3 + seed * 11, z * 2.3 + y * 1.7, 7) - 0.5) + 0.07 * (valueNoise(x * 7, z * 7 + y * 6, 8) - 0.5);
    x *= k; z *= k; y *= k;
    const ledge = 0.05 * Math.sin((y + 0.5) * 17 + seed * 5);
    x *= 1 + ledge; z *= 1 + ledge;
    y = Math.max(0, y * 0.9 + 0.12);
    if (y <= 0.02) { skirt[i] = 1; y = 0; }
    p.setXYZ(i, x * 1.02, y, z * 0.96);
  }
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  return finish(geo, 'boulder', seed);
}

/** Smooth normals (merged by position), vertex colour AO, a position-keyed uv. */
function finish(geo, label, seed) {
  geo.deleteAttribute('uv');
  const g = geo.index ? geo.toNonIndexed() : geo;
  const skirtSrc = geo.attributes.aSkirt;
  const p = g.attributes.position;
  // aSkirt must follow the non-indexed expansion: rebuild by matching
  let skirt = skirtSrc;
  if (geo.index) {
    const sk = new Float32Array(p.count);
    for (let i = 0; i < geo.index.count; i++) sk[i] = skirtSrc.getX(geo.index.getX(i));
    skirt = new THREE.BufferAttribute(sk, 1);
  }
  g.setAttribute('aSkirt', skirt);
  // smooth normals: average the face normals of the vertices that share a quantised position
  g.computeVertexNormals();
  const key = (i) => `${Math.round(p.getX(i) * 400)},${Math.round(p.getY(i) * 400)},${Math.round(p.getZ(i) * 400)}`;
  const sum = new Map(), n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const k = key(i); const s = sum.get(k) || [0, 0, 0]; s[0] += n.getX(i); s[1] += n.getY(i); s[2] += n.getZ(i); sum.set(k, s); }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = sum.get(key(i)), l = Math.hypot(s[0], s[1], s[2]) || 1;
    n.setXYZ(i, s[0] / l, s[1] / l, s[2] / l);
    const ao = label.startsWith('boulder') ? 0.72 + 0.4 * clamp01(p.getY(i) * 1.6) : 0.7 + 0.4 * clamp01(p.getY(i) * 1.2 + p.getZ(i) * 0.2 + 0.3);
    const tone = 0.9 + 0.2 * valueNoise(p.getX(i) * 4 + seed * 3, p.getY(i) * 4 + p.getZ(i) * 4, 9);
    col[i * 3] = ao * tone; col[i * 3 + 1] = ao * tone * 0.97; col[i * 3 + 2] = ao * tone * 0.92;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function buildRockModels() {
  return {
    slabA: { near: slabGeometry('slab', 0.17, true), far: slabGeometry('slab', 0.17, false) },
    slabB: { near: slabGeometry('slab', 0.61, true), far: slabGeometry('slab', 0.61, false) },
    overhang: { near: slabGeometry('overhang', 0.38, true), far: slabGeometry('overhang', 0.38, false) },
    boulderA: { near: boulderGeometry(0.3, true), far: boulderGeometry(0.3, false) },
    boulderB: { near: boulderGeometry(0.7, true), far: boulderGeometry(0.7, false) },
    stone: { near: boulderGeometry(0.5, false), far: boulderGeometry(0.5, false) },
  };
}
