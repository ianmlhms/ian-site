/* A soup of flat-shaded faces for the hand-made landmarks: the vertex arrays of one mesh (positions, normals, colours,
 * indices) plus the small solids every landmark is made of (box, extruded polygon, cylinder, cone, strip, arch).
 *
 * Pure geometry, no THREE, so the Node harness can build the very same landmarks the browser draws and check them.
 * Every face has its own normal and its own colour; the material of the game (solid-material.js) is double sided and
 * lights the side the viewer sees, so the winding of a face never decides how it is lit.
 * Nothing here mutates its inputs. */

const TAU = Math.PI * 2;

/** A colour with a little deterministic variation per face, so a flat wall reads as painted and not as plastic. */
export function paint(base, key, amount = 0.035) {
  // the key is any number: a cheap integer hash gives a stable -1..1 value
  let h = Math.imul(key | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  const v = ((h >>> 8) & 0xffff) / 0xffff * 2 - 1;
  const k = 1 + v * amount;
  return [Math.min(1, base[0] * k), Math.min(1, base[1] * k), Math.min(1, base[2] * k)];
}

/** The signed area of a polygon [[x, z], ...] (positive when it runs counter-clockwise seen from +y... see use). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Ear clipping for a simple polygon [[x, z], ...] -> triangles as index triples (works for concave outlines too). */
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) throw new Error(`triangulate: a polygon needs 3 points, got ${n}`);
  const order = polygonArea(pts) > 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
  const out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = n * n + 10;
  while (order.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < order.length; i++) {
      const i0 = order[(i + order.length - 1) % order.length], i1 = order[i], i2 = order[(i + 1) % order.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cross(a, b, c) <= 1e-9) continue;                       // a reflex or flat corner is not an ear
      let ear = true;
      for (const j of order) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(pts[j], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      out.push([i0, i1, i2]);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                                          // a degenerate outline: fan the rest rather than loop for ever
  }
  for (let i = 1; i + 1 < order.length; i++) out.push([order[0], order[i], order[i + 1]]);
  return out;
}

export class Soup {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.faces = 0; }
  get vertexCount() { return this.pos.length / 3; }
  get triangleCount() { return this.idx.length / 3; }

  /** One triangle, normal from the winding. Degenerate triangles are dropped. */
  tri(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const base = this.vertexCount;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]); }
    this.idx.push(base, base + 1, base + 2);
    this.faces += 1;
  }

  /** One triangle with the normals and colours of its three corners (smooth shading: the faces of a rock or a shell do not show as facets). */
  triSmooth(p, n, c) {
    const base = this.vertexCount;
    for (let k = 0; k < 3; k++) { this.pos.push(p[k][0], p[k][1], p[k][2]); this.nor.push(n[k][0], n[k][1], n[k][2]); this.col.push(c[k][0], c[k][1], c[k][2]); }
    this.idx.push(base, base + 1, base + 2);
    this.faces += 1;
  }

  /**
   * A smooth skin over a grid of points: rows[r] is a list of [x, y, z] (rows may differ in length; a missing row is null), colours[r][c] the colour of
   * every vertex.  Rows r and r + 1 (and the last with the first when `loop`) are joined by quads.  The normal of a vertex is the mean of the normals of
   * the faces around it, so the light changes smoothly over the skin and only the silhouette stays polygonal.  `flip` (true, false or 'auto') turns the faces over.
   */
  grid(rows, colours, { loop = false, flip = false } = {}) {
    const R = rows.length;
    const next = (r) => (r + 1 < R ? r + 1 : loop ? 0 : -1);
    const acc = rows.map((row) => (row ? row.map(() => [0, 0, 0]) : null));
    const quads = [];
    for (let r = 0; r < R; r++) {
      const q = next(r);
      if (q < 0 || !rows[r] || !rows[q]) continue;
      const n = Math.min(rows[r].length, rows[q].length);
      for (let c = 0; c + 1 < n; c++) quads.push([r, c, q]);
    }
    const nrm = (a, b, d) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    const add = (r, c, v) => { const t = acc[r][c]; t[0] += v[0]; t[1] += v[1]; t[2] += v[2]; };
    for (const [r, c, q] of quads) {
      const a = rows[r][c], b = rows[q][c], d = rows[r][c + 1], e = rows[q][c + 1];
      const f = nrm(a, b, e), g = nrm(a, e, d);          // the two triangles of the quad, area-weighted by their cross products
      for (const [rr, cc] of [[r, c], [q, c], [q, c + 1]]) add(rr, cc, f);
      for (const [rr, cc] of [[r, c], [q, c + 1], [r, c + 1]]) add(rr, cc, g);
    }
    // 'auto': a skin that faces up (a hillside, a rock) is turned over when its faces came out facing down
    let sumY = 0;
    for (const row of acc) if (row) for (const v of row) sumY += v[1];
    const turn = flip === 'auto' ? sumY < 0 : flip;
    const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; const s = turn ? -1 / l : 1 / l; return [v[0] * s, v[1] * s, v[2] * s]; };
    for (const [r, c, q] of quads) {
      const P = [rows[r][c], rows[q][c], rows[q][c + 1], rows[r][c + 1]];
      const N = [[r, c], [q, c], [q, c + 1], [r, c + 1]].map(([rr, cc]) => unit(acc[rr][cc]));
      const Cc = [[r, c], [q, c], [q, c + 1], [r, c + 1]].map(([rr, cc]) => colours[rr][cc]);
      const order = turn ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]];
      for (const [i, j, k] of order) this.triSmooth([P[i], P[j], P[k]], [N[i], N[j], N[k]], [Cc[i], Cc[j], Cc[k]]);
    }
  }

  /** A quad a-b-c-d (counter-clockwise seen from the side the normal points to). */
  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** The faces of another soup, moved by (dx, dy, dz) and turned by `yaw` about y: reuse of a small part (a window, a column). */
  add(other, dx = 0, dy = 0, dz = 0, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const base = this.vertexCount;
    for (let i = 0; i < other.pos.length; i += 3) {
      const x = other.pos[i], y = other.pos[i + 1], z = other.pos[i + 2];
      this.pos.push(x * c + z * s + dx, y + dy, -x * s + z * c + dz);
      const nx = other.nor[i], nz = other.nor[i + 2];
      this.nor.push(nx * c + nz * s, other.nor[i + 1], -nx * s + nz * c);
      this.col.push(other.col[i], other.col[i + 1], other.col[i + 2]);
    }
    for (const i of other.idx) this.idx.push(base + i);
    this.faces += other.faces;
  }

  /**
   * A box. (cx, cz) is the middle of the base, y0 the bottom, sx x sz the plan, h the height, yaw the turn about y.
   * `bottom: false` leaves the underside open (a box that stands on the ground has no use for it).  `against: [x, z]` leaves out the one of the two
   * faces across local z that is nearer that point: the back of a box that stands against a wall (a mullion, a course) is never seen (city12: 2 of 10
   * triangles of every facade slab, which paid for the Gare in the landmark budget).
   */
  box(cx, y0, cz, sx, h, sz, yaw, color, { bottom = false, topColor = null, against = null } = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = sx / 2, hz = sz / 2;
    const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const a0 = P(-hx, y0, -hz), b0 = P(hx, y0, -hz), c0 = P(hx, y0, hz), d0 = P(-hx, y0, hz);
    const a1 = P(-hx, y0 + h, -hz), b1 = P(hx, y0 + h, -hz), c1 = P(hx, y0 + h, hz), d1 = P(-hx, y0 + h, hz);
    // the back face: the z face whose middle is nearer `against` (none without it)
    const backMinus = against ? Math.hypot(cx - hz * s - against[0], cz - hz * c - against[1]) < Math.hypot(cx + hz * s - against[0], cz + hz * c - against[1]) : null;
    if (backMinus !== true) this.quad(a0, a1, b1, b0, color);
    this.quad(b0, b1, c1, c0, color);
    if (backMinus !== false) this.quad(c0, c1, d1, d0, color);
    this.quad(d0, d1, a1, a0, color);
    this.quad(a1, d1, c1, b1, topColor || color);
    if (bottom) this.quad(a0, b0, c0, d0, color);
  }

  /**
   * A prism: the polygon `pts` [[x, z], ...] from y0 to y1. y0 may be an array of per-point bottoms (a wall that stands
   * on a slope reaches the ground at every corner). `top` false leaves the top open.
   */
  prism(pts, y0, y1, color, { topColor = null, top = true } = {}) {
    const n = pts.length;
    const bottoms = Array.isArray(y0) ? y0 : pts.map(() => y0);
    const tops = Array.isArray(y1) ? y1 : pts.map(() => y1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad([pts[i][0], bottoms[i], pts[i][1]], [pts[j][0], bottoms[j], pts[j][1]],
        [pts[j][0], tops[j], pts[j][1]], [pts[i][0], tops[i], pts[i][1]], color);
    }
    if (top) {
      for (const [a, b, c] of triangulate(pts)) {
        this.tri([pts[a][0], tops[a], pts[a][1]], [pts[b][0], tops[b], pts[b][1]], [pts[c][0], tops[c], pts[c][1]], topColor || color);
      }
    }
  }

  /** A frustum (a cylinder when r0 = r1) with `sides` faces, from y0 (radius r0) to y1 (radius r1). `cap` closes the top. */
  frustum(cx, cz, r0, r1, y0, y1, sides, color, { yaw = 0, cap = true, capColor = null } = {}) {
    const ring = (r, y) => Array.from({ length: sides }, (_, i) => {
      const a = yaw + (i / sides) * TAU;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    });
    const lo = ring(r0, y0), hi = ring(r1, y1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(lo[i], lo[j], hi[j], hi[i], color);
    }
    if (cap && r1 > 1e-6) for (let i = 0; i < sides; i++) this.tri([cx, y1, cz], hi[(i + 1) % sides], hi[i], capColor || color);
  }

  /** A pyramid / cone: the polygon `pts` [[x, z], ...] at y0 and the apex (ax, ay, az). */
  pyramid(pts, y0, apex, color) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri([pts[i][0], y0, pts[i][1]], [pts[j][0], y0, pts[j][1]], apex, color);
    }
  }

  /**
   * A strip between two polylines of 3D points (same length): the faces between ring a[i], a[i+1] and b[i], b[i+1].
   * The workhorse of the arches and the girders: a sweep of a profile along a path is a stack of strips.
   */
  strip(a, b, color, colorOf = null) {
    for (let i = 0; i + 1 < a.length; i++) this.quad(a[i], a[i + 1], b[i + 1], b[i], colorOf ? colorOf(i) : color);
  }

  /** A prism swept along the 3D path `path` with the rectangle w (across, in the horizontal plane) x h (down from the path). */
  beam(path, w, h, color) {
    const n = path.length;
    const left = [], right = [], leftB = [], rightB = [];
    for (let i = 0; i < n; i++) {
      const p = path[i];
      const q = path[Math.min(n - 1, i + 1)], o = path[Math.max(0, i - 1)];
      let dx = q[0] - o[0], dz = q[2] - o[2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const sx = -dz * w / 2, sz = dx * w / 2;
      left.push([p[0] + sx, p[1], p[2] + sz]); right.push([p[0] - sx, p[1], p[2] - sz]);
      leftB.push([p[0] + sx, p[1] - h, p[2] + sz]); rightB.push([p[0] - sx, p[1] - h, p[2] - sz]);
    }
    this.strip(left, right, color);          // the top
    this.strip(rightB, leftB, color);        // the bottom
    this.strip(leftB, left, color);          // the left side
    this.strip(right, rightB, color);        // the right side
    for (const [a, b, c, d] of [[left[0], leftB[0], rightB[0], right[0]], [right[n - 1], rightB[n - 1], leftB[n - 1], left[n - 1]]]) this.quad(a, b, c, d, color);
  }

  /** The bounding box [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds() {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], this.pos[i + k]); b[k + 3] = Math.max(b[k + 3], this.pos[i + k]); }
    }
    return b;
  }
}

/** The frame of a straight axis in the plane: P(s, y, u) = origin + along * s + side * u. Used by the bridges. */
export function axisFrame(ax, az, bx, bz) {
  const length = Math.hypot(bx - ax, bz - az);
  if (length < 1e-6) throw new Error('axisFrame: the axis has no length');
  const dx = (bx - ax) / length, dz = (bz - az) / length;
  const sx = -dz, sz = dx;
  return {
    ax, az, length, dx, dz, sx, sz,
    /** The coordinates (s along, u across) of a world point. */
    local: (x, z) => [(x - ax) * dx + (z - az) * dz, (x - ax) * sx + (z - az) * sz],
    at: (s, y, u = 0) => [ax + dx * s + sx * u, y, az + dz * s + sz * u],
    xz: (s, u = 0) => [ax + dx * s + sx * u, az + dz * s + sz * u],
  };
}

/** n + 1 evenly spaced numbers from a to b. */
export const linspace = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
