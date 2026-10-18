/* Kart Lëtzebuerg — tiny geometry batcher: collects triangles (positions, flat or smooth normals, linear vertex colours, UVs) and
 * turns them into ONE BufferGeometry, so a whole street of buildings is a single draw call. (three@0.160 UMD has no BufferGeometryUtils.) */
(function () {
  'use strict';
  const KL = window.KL;
  const T = window.THREE;
  const cache = new Map();
  /* '#rrggbb' -> linear [r,g,b] */
  KL.col = (hex) => { let c = cache.get(hex); if (!c) { const k = new T.Color(hex); c = [k.r, k.g, k.b]; cache.set(hex, c); } return c; };
  KL.mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  KL.shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  class Batch {
    constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.count = 0; }
    vert(x, y, z, nx, ny, nz, col, u, v) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.u.push(u, v);
      return this.count++;
    }
    /* flat triangle */
    tri(a, b, c, col, uva, uvb, uvc) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, col, uva ? uva[0] : 0, uva ? uva[1] : 0);
      const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, col, uvb ? uvb[0] : 0, uvb ? uvb[1] : 0);
      const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, col, uvc ? uvc[0] : 0, uvc ? uvc[1] : 0);
      this.i.push(i0, i1, i2);
    }
    /* quad a,b,c,d counter-clockwise seen from the front; uv rect [u0,v0,u1,v1] maps a->(u0,v0) b->(u1,v0) c->(u1,v1) d->(u0,v1) */
    quad(a, b, c, d, col, uv, col2) {
      const u = uv || [0, 0, 1, 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const cc = col2 || col;
      const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, col, u[0], u[1]);
      const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, col, u[2], u[1]);
      const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, cc, u[2], u[3]);
      const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, cc, u[0], u[3]);
      this.i.push(i0, i1, i2, i0, i2, i3);
    }
    quadUV(a, b, c, d, col, ua, ub, uc, ud) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, col, ua[0], ua[1]);
      const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, col, ub[0], ub[1]);
      const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, col, uc[0], uc[1]);
      const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, col, ud[0], ud[1]);
      this.i.push(i0, i1, i2, i0, i2, i3);
    }
    /* yaw-rotated box centred at (cx,cy-base,cz); y is the bottom. opts: sides (bitmask of +x,-x,+z,-z,top), facade rows etc. */
    box(cx, y0, cz, sx, sy, sz, yaw, col, o) {
      o = o || {};
      const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0), hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
      const P = (lx, lz, y) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
      const A = P(-hx, -hz, y0), B = P(hx, -hz, y0), Cc = P(hx, hz, y0), D = P(-hx, hz, y0);
      const E = P(-hx, -hz, y1), F = P(hx, -hz, y1), G = P(hx, hz, y1), H = P(-hx, hz, y1);
      const top = o.topCol || KL.shade(col, 1.12), sideA = o.sideCol || KL.shade(col, 0.9);
      const wall = (p0, p1, p2, p3, len, cl) => { if (o.wall) o.wall(this, p0, p1, p2, p3, len, cl); else this.quad(p0, p1, p2, p3, cl, o.uv); };
      if (o.noTop !== true) this.quad(E, H, G, F, top);
      if (!(o.skip & 1)) wall(B, F, G, Cc, sz, col);              // +x face (normal +x rotated)
      if (!(o.skip & 2)) wall(D, H, E, A, sz, sideA);             // -x
      if (!(o.skip & 4)) wall(Cc, G, H, D, sx, col);              // +z
      if (!(o.skip & 8)) wall(A, E, F, B, sx, sideA);             // -z
      if (o.bottom) this.quad(A, B, Cc, D, KL.shade(col, 0.5));
    }
    /* frustum / cylinder / cone around the y axis: radius r0 at y0, r1 at y1 */
    cyl(cx, y0, cz, r0, r1, h, seg, col, o) {
      o = o || {};
      const y1 = y0 + h;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const p0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
        const q0 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], q1 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
        const sh = o.flat ? 1 : 0.88 + 0.22 * Math.cos((a0 + a1) / 2 - 0.8);
        const cl = KL.shade(col, sh);
        if (r1 < 0.001) this.tri(p1, p0, q0, cl); else this.quad(p1, p0, q0, q1, cl);
        if (o.capTop && r1 > 0.001) this.tri([cx, y1, cz], q1, q0, KL.shade(col, 1.15));
        if (o.capBottom) this.tri([cx, y0, cz], p0, p1, KL.shade(col, 0.5));
      }
    }
    /* low-poly sphere (ico-ish: lat/long) */
    sphere(cx, cy, cz, r, seg, col, o) {
      o = o || {};
      const rings = Math.max(3, Math.round(seg / 2)), sy = o.sy || 1;
      for (let j = 0; j < rings; j++) {
        const v0 = (j / rings) * Math.PI, v1 = ((j + 1) / rings) * Math.PI;
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
          const pt = (a, v) => [cx + Math.cos(a) * Math.sin(v) * r, cy + Math.cos(v) * r * sy, cz + Math.sin(a) * Math.sin(v) * r];
          const p00 = pt(a0, v0), p10 = pt(a1, v0), p01 = pt(a0, v1), p11 = pt(a1, v1);
          const shade = 0.78 + 0.34 * ((Math.cos(v0) + 1) / 2) * 0.7 + 0.1 * Math.cos((a0 + a1) / 2 - 0.9);
          const cl = o.noise ? KL.shade(col, shade * (0.94 + 0.12 * ((k * 7 + j * 13) % 5) / 4)) : KL.shade(col, shade);
          if (j === 0) this.tri(p00, p01, p11, cl); else if (j === rings - 1) this.tri(p00, p01, p10, cl); else this.quad(p10, p00, p01, p11, cl);
        }
      }
    }
    /* append another batch translated/rotated (for reusing small models such as trees and lamps) */
    addBatch(b, x, y, z, yaw, scale) {
      const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0), k = scale || 1, base = this.count;
      for (let i = 0; i < b.count; i++) {
        const px = b.p[i * 3] * k, py = b.p[i * 3 + 1] * k, pz = b.p[i * 3 + 2] * k;
        const nx = b.n[i * 3], ny = b.n[i * 3 + 1], nz = b.n[i * 3 + 2];
        this.p.push(x + px * c + pz * s, y + py, z - px * s + pz * c); this.n.push(nx * c + nz * s, ny, -nx * s + nz * c);
        this.c.push(b.c[i * 3], b.c[i * 3 + 1], b.c[i * 3 + 2]); this.u.push(b.u[i * 2], b.u[i * 2 + 1]);
      }
      for (const idx of b.i) this.i.push(base + idx);
      this.count += b.count;
    }
    toGeometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
    toMesh(material, opts) {
      const m = new T.Mesh(this.toGeometry(), material);
      if (opts && opts.frustumCulled === false) m.frustumCulled = false;
      return m;
    }
  }
  KL.Batch = Batch;
})();
