/* A small flat-shaded mesh builder for the built things (houses, church, castles): every face is a quad or a triangle with its own normal, a base colour and the painted-surface
 * info the town material reads: aInfo = (u metres along the surface, v metres up it, kind, seed), aGeo = (wall length, eave height). Pure geometry (THREE only for the buffers). */
const THREE = window.THREE;

export const KIND = Object.freeze({ wall: 0, roof: 1, stone: 2, flat: 3, ashlar: 4, glass: 5, trim: 6, spire: 7, dormer: 8, door: 9, church: 10 });

export class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.info = []; this.geo = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  /** A planar polygon (3 or 4 points [x, y, z]) with the normal from its winding; uv = per-point [u, v]. */
  face(points, color, kind, seed, uvs, wallLen = 0, eave = 0) {
    const [a, b, c] = points;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = this.count;
    points.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]);
      this.info.push(uvs[i][0], uvs[i][1], kind, seed); this.geo.push(wallLen, eave);
    });
    this.idx.push(base, base + 1, base + 2);
    if (points.length === 4) this.idx.push(base, base + 2, base + 3);
  }

  /** An axis-aligned box in a rotated frame: centre (x, y, z), half sizes, yaw; every face gets the same colour and kind. */
  box(cx, y0, cz, hx, hy, hz, yaw, color, kind, seed = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u, y, v) => [cx + u * c - v * s, y, cz + u * s + v * c];
    const y1 = y0 + 2 * hy;
    const f = (pts, w, h) => this.face(pts, color, kind, seed, [[0, 0], [w, 0], [w, h], [0, h]], w, h);
    f([P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz)], 2 * hx, 2 * hy);
    f([P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz)], 2 * hx, 2 * hy);
    f([P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz)], 2 * hz, 2 * hy);
    f([P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz)], 2 * hz, 2 * hy);
    this.face([P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz)], color, kind, seed, [[0, 0], [2 * hx, 0], [2 * hx, 2 * hz], [0, 2 * hz]]);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aGeo', new THREE.Float32BufferAttribute(this.geo, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
