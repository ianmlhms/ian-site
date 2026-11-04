/* A small flat-shaded geometry builder for the built things of the city (trams, poles, platforms, street lights).
 * Every face is a quad with its own outward normal, a base colour and a glow (0..1: the share of the colour that a lit window
 * or a lamp keeps at night).  Pure arrays until build() (THREE only wraps the buffers), so the Node probes can use it. */

export class PartBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.glow = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  /** A quad a-b-c-d.  `inside` (optional, a point inside the solid the quad belongs to) orients the normal outwards,
   *  whatever the winding of the four points: the parts are written by hand and a flipped face is easy to write. */
  quad(a, b, c, d, color, glow = 0, inside = null) {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { ux = c[0] - a[0]; uy = c[1] - a[1]; uz = c[2] - a[2]; vx = d[0] - a[0]; vy = d[1] - a[1]; vz = d[2] - a[2]; nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; l = Math.hypot(nx, ny, nz) || 1; }
    nx /= l; ny /= l; nz /= l;
    let pts = [a, b, c, d];
    if (inside && nx * (inside[0] - a[0]) + ny * (inside[1] - a[1]) + nz * (inside[2] - a[2]) > 0) { pts = [a, d, c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const base = this.count;
    for (const p of pts) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]); this.glow.push(glow); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An axis-aligned box [x0, x1] x [y0, y1] x [z0, z1] (the six faces share one colour; `top` overrides the colour of the top face). */
  box(x0, x1, y0, y1, z0, z1, color, glow = 0, top = null) {
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, glow, c);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top || color, glow, c);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color, glow, c);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, glow, c);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, glow, c);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], color, glow, c);
  }

  /** A box in a frame rotated by `yaw` about +y and moved to (cx, cz): the box is given in the local frame (u along the heading, v to its right). */
  boxYaw(cx, cz, yaw, u0, u1, y0, y1, v0, v1, color, glow = 0, top = null) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u, y, v) => [cx + u * c - v * s, y, cz + u * s + v * c];
    const centre = P((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
    const q = (a, b, cc, d, col) => this.quad(a, b, cc, d, col, glow, centre);
    q(P(u0, y0, v0), P(u1, y0, v0), P(u1, y0, v1), P(u0, y0, v1), color);
    q(P(u0, y1, v0), P(u1, y1, v0), P(u1, y1, v1), P(u0, y1, v1), top || color);
    q(P(u0, y0, v0), P(u1, y0, v0), P(u1, y1, v0), P(u0, y1, v0), color);
    q(P(u0, y0, v1), P(u1, y0, v1), P(u1, y1, v1), P(u0, y1, v1), color);
    q(P(u0, y0, v0), P(u0, y0, v1), P(u0, y1, v1), P(u0, y1, v0), color);
    q(P(u1, y0, v0), P(u1, y0, v1), P(u1, y1, v1), P(u1, y1, v0), color);
  }

  /** Copies another builder into this one, rotated by `yaw` about +y (local +z -> (sin yaw, cos yaw), local +x -> (cos yaw, -sin yaw)) and moved to (x, y, z). */
  append(other, { x = 0, y = 0, z = 0, yaw = 0 } = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const base = this.count;
    for (let i = 0; i < other.pos.length; i += 3) {
      const px = other.pos[i], py = other.pos[i + 1], pz = other.pos[i + 2];
      this.pos.push(x + px * c + pz * s, y + py, z - px * s + pz * c);
      const nx = other.nor[i], ny = other.nor[i + 1], nz = other.nor[i + 2];
      this.nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
    }
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]);
    for (let i = 0; i < other.glow.length; i++) this.glow.push(other.glow[i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
  }

  /** The arrays of the geometry, translated by (-ox, -oy, -oz) (chunk-local positions keep float32 precise far from the origin). */
  arrays(ox = 0, oy = 0, oz = 0) {
    const pos = Float32Array.from(this.pos);
    if (ox || oy || oz) for (let i = 0; i < pos.length; i += 3) { pos[i] -= ox; pos[i + 1] -= oy; pos[i + 2] -= oz; }
    return { position: pos, normal: Float32Array.from(this.nor), color: Float32Array.from(this.col), glow: Float32Array.from(this.glow), index: this.count > 65535 ? Uint32Array.from(this.idx) : Uint16Array.from(this.idx) };
  }

  build(THREE, origin = [0, 0, 0]) {
    const a = this.arrays(origin[0], origin[1], origin[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
    g.setAttribute('glow', new THREE.BufferAttribute(a.glow, 1));
    g.setIndex(new THREE.BufferAttribute(a.index, 1));
    g.computeBoundingSphere();
    return g;
  }
}
