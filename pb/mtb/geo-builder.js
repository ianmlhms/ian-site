/* Mesh building helpers shared by the tree, rock, rider, bridge and bike-light models: a vertex-colour geometry builder that merges many small
 * parts into ONE BufferGeometry (one draw call), tapered tubes along a curve, and small matrix helpers. Pure geometry, built once at start-up. */
const THREE = window.THREE;

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Compose a matrix: translation, non-uniform scale, rotation about y (ry) then x (rx) then z (rz), in that order of application (z first). */
export function M(x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(V3(x, y, z), q, V3(sx, sy, sz));
}

/** Accumulates triangles with a vertex colour and an optional atlas tile (`leaf` >= 0: the fragment shader samples the leaf atlas there). */
export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.leaf = []; this.idx = []; }
  get vertexCount() { return this.pos.length / 3; }

  /** Adds raw arrays. colorFn(position Vector3, normal Vector3, index) -> [r, g, b]. uvs / leaf optional. */
  addArrays(pos, nor, idx, colorFn, uvs = null, leaf = -1) {
    const base = this.vertexCount;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.length / 3; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); n.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
      const c = colorFn ? colorFn(v, n, i) : [1, 1, 1];
      this.pos.push(v.x, v.y, v.z); this.nor.push(n.x, n.y, n.z); this.col.push(c[0], c[1], c[2]);
      this.uv.push(uvs ? uvs[i * 2] : 0, uvs ? uvs[i * 2 + 1] : 0); this.leaf.push(leaf);
    }
    for (let i = 0; i < idx.length; i++) this.idx.push(base + idx[i]);
  }

  /** Adds a THREE geometry transformed by `matrix`. */
  add(geometry, matrix, colorFn, leaf = -1) {
    const p = geometry.attributes.position, n = geometry.attributes.normal, u = geometry.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const pos = [], nor = [], uvs = u ? Array.from(u.array) : null;
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      pos.push(v.x, v.y, v.z); nor.push(nv.x, nv.y, nv.z);
    }
    const idx = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: p.count }, (_, i) => i);
    this.addArrays(pos, nor, idx, colorFn, uvs, leaf);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.leaf, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** A tapered tube along a polyline `points` (array of Vector3) with a radius per point. Parallel-transport frames, `radial` sides, open ends (cap = true closes the
 *  last ring with a fan). Returns { pos, nor, idx, ring } where ring[i] is the index of the first vertex of ring i. */
export function tube(points, radii, radial = 6, cap = false) {
  const n = points.length;
  const pos = [], nor = [], idx = [], ring = [];
  const tangent = (i) => points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
  let t = tangent(0);
  let a = Math.abs(t.y) < 0.9 ? V3(0, 1, 0).cross(t).normalize() : V3(1, 0, 0).cross(t).normalize();
  for (let i = 0; i < n; i++) {
    const ti = tangent(i);
    const axis = t.clone().cross(ti);                       // rotate the frame from the previous tangent to this one
    if (axis.lengthSq() > 1e-10) { axis.normalize(); a = a.applyAxisAngle(axis, Math.acos(Math.max(-1, Math.min(1, t.dot(ti))))); }
    t = ti;
    const b = t.clone().cross(a).normalize();
    ring.push(pos.length / 3);
    for (let k = 0; k < radial; k++) {
      const ang = (k / radial) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      const nx = a.x * c + b.x * s, ny = a.y * c + b.y * s, nz = a.z * c + b.z * s;
      pos.push(points[i].x + nx * radii[i], points[i].y + ny * radii[i], points[i].z + nz * radii[i]);
      nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const p0 = ring[i] + k, p1 = ring[i] + k2, q0 = ring[i + 1] + k, q1 = ring[i + 1] + k2;
      idx.push(p0, q0, p1, p1, q0, q1);
    }
  }
  if (cap) {
    const last = n - 1, c = pos.length / 3;
    pos.push(points[last].x, points[last].y, points[last].z); nor.push(t.x, t.y, t.z);
    for (let k = 0; k < radial; k++) idx.push(ring[last] + k, c, ring[last] + ((k + 1) % radial));
  }
  return { pos, nor, idx, ring };
}

/** Cubic Bezier through p0..p3 sampled at `steps` + 1 points. */
export function bezier(p0, p1, p2, p3, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push(V3(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y, u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z));
  }
  return out;
}

/** A card (quad) with centre c, half-extents (hw, hh) in the plane spanned by the orthonormal vectors `right` and `up`; uv rectangle u0..u1 x v0..v1 of an atlas tile.
 *  `lightNormal` is the normal used for shading (the cluster's ball normal, which makes foliage read as a volume). */
export function card(c, right, up, hw, hh, lightNormal, uvRect) {
  const [u0, v0, u1, v1] = uvRect;
  const p = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.push(c.x + right.x * hw * sx + up.x * hh * sy, c.y + right.y * hw * sx + up.y * hh * sy, c.z + right.z * hw * sx + up.z * hh * sy);
  const nor = [];
  for (let i = 0; i < 4; i++) nor.push(lightNormal.x, lightNormal.y, lightNormal.z);
  return { pos: p, nor, idx: [0, 1, 2, 0, 2, 3], uvs: [u0, v0, u1, v0, u1, v1, u0, v1] };
}

/** Unit vector helpers on plain numbers. */
export function randomUnit(rng) {
  const z = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return V3(r * Math.cos(a), z, r * Math.sin(a));
}
