/* Painted tree models, built from code (vertex colours carry the paint): a beech with a broad crown of lumpy blobs and a smooth grey trunk, a spruce
 * with stacked cones. Two detail levels each: A (near, a few hundred triangles) and B (far, about 40). Unit size: the tree is 1 m tall at scale 1;
 * the instance scale carries the real height. */
import { createRng, valueNoise } from './noise.js';

const THREE = window.THREE;

function tint(base, rng, amount) { return [base[0] * (1 + (rng() - 0.5) * amount), base[1] * (1 + (rng() - 0.5) * amount), base[2] * (1 + (rng() - 0.5) * amount)]; }

class Builder {
  constructor() { this.pos = []; this.col = []; this.nor = []; this.idx = []; }
  add(geometry, matrix, colorFn) {
    const g = geometry.index ? geometry : geometry;
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.pos.length / 3;
    const v = new THREE.Vector3(), nv = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      const c = colorFn(v, nv);
      this.pos.push(v.x, v.y, v.z); this.nor.push(nv.x, nv.y, nv.z); this.col.push(c[0], c[1], c[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.array[i]);
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

function blob(radius, detail, rng, lump) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + lump * (valueNoise(x * 3.1 + 5, z * 3.1 + y * 2.3, 3) - 0.5);
    p.setXYZ(i, x * k, y * k * 0.86, z * k);
  }
  // smooth, painted shading: the normal of a blob vertex points away from its centre (the faceted look of flat triangles is not wanted)
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { const nx = p.getX(i), ny = p.getY(i) / 0.86, nz = p.getZ(i); const l = Math.hypot(nx, ny, nz) || 1; n.setXYZ(i, nx / l, ny / l, nz / l); }
  return g;
}

function trunk(h, r0, r1, segs, color) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 1, true);
  g.translate(0, h / 2, 0);
  return { g: g.toNonIndexed(), color };
}

const M = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

export function buildBeech(detail) {
  const rng = createRng(101 + detail);
  const b = new Builder();
  const barkBase = [0.34, 0.3, 0.26];
  const t = trunk(0.62, 0.0115, 0.0075, detail === 0 ? 5 : 8, barkBase);
  b.add(t.g, M(0, 0, 0), (v) => { const k = 0.8 + 0.4 * valueNoise(v.y * 9, (v.x + v.z) * 160, 1); const moss = Math.max(0, valueNoise(v.y * 5 + 3, (v.x - v.z) * 90, 4) - 0.55) * 1.4; return [barkBase[0] * k * (1 - moss * 0.35), barkBase[1] * k * (1 + moss * 0.18), barkBase[2] * k * (1 - moss * 0.3)]; });
  const crowns = detail === 0 ? [[0, 0.74, 0, 0.32]] : [[0, 0.76, 0, 0.27], [0.15, 0.62, 0.05, 0.2], [-0.13, 0.66, -0.08, 0.22], [0.04, 0.9, -0.1, 0.18], [-0.05, 0.84, 0.14, 0.17]];
  for (const [x, y, z, r] of crowns) {
    const green = tint([0.28, 0.46, 0.17], rng, 0.5);
    const geo = blob(r, detail === 0 ? 0 : 1, rng, 0.6);
    b.add(geo, M(x, y, z, 1, 1, 1, rng() * 6), (v, n) => {
      const top = Math.min(1, Math.max(0, (v.y - (y - r)) / (2 * r)));
      const shade = 0.5 + 0.7 * top + 0.16 * n.y;
      const gold = Math.max(0, valueNoise(v.x * 9, v.z * 9 + v.y * 4, 5) - 0.62) * 1.3;        // a few yellowing leaf clusters
      return [(green[0] + gold * 0.5) * shade * (0.9 + 0.2 * top), (green[1] + gold * 0.22) * shade, (green[2]) * shade * (1 - gold * 0.4) * (1.15 - 0.3 * top)];
    });
  }
  return b.build();
}

export function buildSpruce(detail) {
  const rng = createRng(202 + detail);
  const b = new Builder();
  const bark = [0.3, 0.22, 0.17];
  const t = trunk(0.3, 0.009, 0.006, 5, bark);
  b.add(t.g, M(0, 0, 0), () => bark);
  const tiers = detail === 0 ? 2 : 5;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1 || 1);
    const radius = (0.22 - 0.15 * f) * (detail === 0 ? 1.2 : 1), height = 0.34 - 0.1 * f, y = 0.2 + f * 0.62;
    const g = new THREE.ConeGeometry(radius, height, detail === 0 ? 6 : 9, 1, true).toNonIndexed();
    const green = tint([0.16, 0.34, 0.2], rng, 0.3);
    b.add(g, M(0, y + height / 2 - 0.06, 0, 1, 1, 1, rng() * 6), (v, n) => {
      const low = Math.min(1, Math.max(0, (v.y - y) / height));
      const shade = 0.5 + 0.55 * low + 0.12 * n.y;
      return [green[0] * shade, green[1] * shade, green[2] * shade];
    });
  }
  return b.build();
}
