/* The painted car of Lux Drive: low-poly cars built from flat-shaded faces with vertex colours (the painted look of the engine:
 * no photographs, no photo textures, the light is the shared gouache shading).  car20: three designs (car-designs.js), the same
 * builder for all of them.
 *
 * The local frame: +x is the front of the car, +y is up, +z is the right hand side. The car is turned with
 * rotation.y = -heading, because the heading runs from +x towards +z in the world frame (x east, z south).
 *
 * The parts (the draw calls): the body (one mesh: hull with the wheel arches cut into it, glass, bumpers, sills, plates, mirrors,
 * the bezels of the lamps), four wheels (each a pivot that steers with a tyre that spins), three lamp meshes with their own unlit
 * materials (the headlamps with the day lights and the taxi sign, the tail lamps = brake lights, the reversing lamps) and a soft
 * contact shadow.  That is 9 meshes, 4 of them with the geometry shared by the wheels. */
import { CAR_COLOURS } from './config.js';
import { CAR_DESIGNS, DEFAULT_CAR_DESIGN, TRIM } from './car-designs.js';
import { WHEEL_TRAVEL, wheelOffsets } from './car-wheels.js';

const THREE = window.THREE;

const WHEEL_SEGMENTS = 20;        // a multiple of 5 and 10: the spokes of the rims
const ARCH_COLUMNS = 14;          // slices of the loft across one wheel arch (the round of the arch)
const LIFT_FROM_PHYSICS = 0.42;   // m: car.state.y is the ride height above the ground; the model stands on the ground itself
const ROLL_LIMIT = 0.3;           // rad
const RAIL = 0.07;                // m: the roof rail between the side glass and the roof, and the A pillar beside the windscreen
const SUBDIVIDE = 2;              // a lamp / decal polygon is split 4^2 times so that it follows the curve of the body
const SURFACE_LIFT = 0.008;       // m: a lamp or decal lies this far in front of the body surface (no z fighting)
const SHADOW_OPACITY = 0.62;
const SHADOW_LIFT = 0.07;         // m over the model's ground (the mean of the four wheels): the shadow is never under a crowned road
const PAINT_LOW = 0.72;           // the paint at the sill is this share of the paint at the shoulder
const BODY_CENTRE_Y = 0.6;
const SKIRT_RISE = 0.1;           // m: the sill (the black cladding or the chamfer under the doors) is this tall ...
const SKIRT_OUT = 0.85;           // ... and its top reaches this share of the way out to the shoulder
const RING = 16;                  // points round a ring (9 on the right, 7 back down the left)        // m: the middle of the body seen from the side (the faces of the loft point away from it)

/** A mesh under construction: flat-shaded triangles with a colour each (or one per vertex: a function of the point). */
class FaceBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  /** A planar polygon (its points in order, counter-clockwise seen from the side the normal points to). */
  poly(points, color) {
    const [a, b, c] = points;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return this;                                   // a degenerate face (a clamped ring in a wheel arch)
    nx /= l; ny /= l; nz /= l;
    const base = this.count;
    for (const p of points) {
      const c3 = typeof color === 'function' ? color(p) : color;
      this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(c3[0], c3[1], c3[2]);
    }
    for (let i = 1; i + 1 < points.length; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }

  /** A triangle whose normal points AWAY from the axis of the car at height cy (the car is convex enough that this is outward). */
  outwardTri(points, color, cy) {
    const [a, b, c] = points;
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const my = (a[1] + b[1] + c[1]) / 3 - cy, mz = (a[2] + b[2] + c[2]) / 3;
    return this.poly(ny * my + nz * mz >= 0 ? [a, b, c] : [a, c, b], color);
  }

  /** A convex polygon (an end cap of the loft) facing away from the car along x. */
  outwardFan(points, color, x) {
    for (let i = 1; i + 1 < points.length; i++) {
      const [a, b, c] = [points[0], points[i], points[i + 1]];
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      this.poly(nx * Math.sign(x) >= 0 ? [a, b, c] : [a, c, b], color);
    }
  }

  /** An axis-aligned box: centre, half sizes, a colour. */
  box(cx, cy, cz, hx, hy, hz, color) {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color);     // +z
    this.poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], color);     // -z
    this.poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], color);     // +x
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color);     // -x
    this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], color);     // top
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], color);     // bottom
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const inRange = (x, [hi, lo]) => x <= hi && x >= lo;

/* ---- the shape of a design: the loft, the wheel arches, the surface behind a point ---- */

/** The geometry helpers of one design (pure: the numbers of car-designs.js). */
function shapeOf(design) {
  const st = design.stations;
  const frontX = st[0][0], backX = st[st.length - 1][0];
  const { r: wheelR, archGap, x: axles } = design.wheel;
  const archR = wheelR + archGap;

  /** The ring of points [y, z] of the body at x: 9 on the right half (floor middle, sill, skirt, shoulder, belt, roof edge, rail, crown,
   *  roof middle), 7 back down the left. */
  function ringAt(x) {
    let i = 0;
    while (i + 2 < st.length && x < st[i + 1][0]) i++;
    const a = st[i], b = st[i + 1];
    const t = clamp01((a[0] - x) / (a[0] - b[0]));
    const [yb, ym, ys, yr, wb, ww, ws, wr, crown] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => lerp(a[k], b[k], t));
    const half = [[yb, 0], [yb, wb], [yb + SKIRT_RISE, lerp(wb, ww, SKIRT_OUT)], [ym, ww], [ys, ws], [yr, wr],
      [yr + crown * 0.35, Math.max(0, wr - RAIL)], [yr + crown * 0.85, wr * 0.5], [yr + crown, 0]];
    const left = half.slice(1, 8).reverse().map(([y, z]) => [y, -z]);
    return half.concat(left);
  }
  /** The z of the side of the body at (x, y) (between the sill and the roof edge). */
  function sideZ(x, y) {
    const r = ringAt(x);
    for (let k = 1; k <= 4; k++) {
      const [y0, z0] = r[k], [y1, z1] = r[k + 1];
      if (y >= y0 && y <= y1) return lerp(z0, z1, (y - y0) / Math.max(1e-6, y1 - y0));
    }
    return y < r[1][0] ? r[1][1] : r[5][1];
  }
  /** The top of the wheel arch over x (-Infinity outside the arches). */
  function archTop(x) {
    for (const ax of axles) {
      const dx = x - ax;
      if (Math.abs(dx) <= archR) return wheelR + Math.sqrt(Math.max(0, archR * archR - dx * dx));
    }
    return -Infinity;
  }
  /** The ring with the wheel arch cut out: the lower points of the side are lifted onto the arch (the floor becomes the liner). */
  function cutRing(x, ring) {
    const ya = archTop(x);
    if (!(ya > -Infinity)) return ring;
    const n = ring.length;
    return ring.map(([y, z], j) => {
      const side = j >= 1 && j <= 4 ? 1 : j >= n - 4 ? -1 : 0;
      return side && y < ya ? [ya, side * sideZ(x, ya)] : [y, z];
    });
  }
  /** Is the point (y, z) inside the ring (the cross section) at x? */
  function contains(x, y, z) {
    const r = ringAt(x);
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [yi, zi] = r[i], [yj, zj] = r[j];
      if ((yi > y) !== (yj > y) && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi) inside = !inside;
    }
    return inside;
  }
  /** The x of the body surface behind the point (y, z) seen from the front ('front') or the rear ('back'). */
  function surfaceX(end, y, z) {
    const outer = end === 'front' ? frontX : backX;
    const inner = end === 'front' ? st[2][0] : st[st.length - 3][0];
    if (contains(outer, y, z)) return outer;
    let lo = outer, hi = inner;                     // lo outside, hi (hopefully) inside
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (contains(mid, y, z)) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }
  return { frontX, backX, wheelR, archR, axles, ringAt, sideZ, archTop, cutRing, surfaceX };
}

/** The slices of the loft along the car (front to back): the stations, the edges of the glass and the columns of the arches. */
function sliceList(design, shape) {
  const slices = [];
  const xs = new Set(design.stations.map((s) => s[0]));
  for (const r of [...design.sideGlass, design.windscreen, design.rearWindow]) { xs.add(r[0]); xs.add(r[1]); }
  for (const x of xs) slices.push({ x, cut: shape.archTop(x) > -Infinity, order: 0 });
  for (const ax of shape.axles) {
    for (let i = 0; i <= ARCH_COLUMNS; i++) {
      const x = ax + Math.cos((Math.PI * i) / ARCH_COLUMNS) * shape.archR;
      // the two edges of an arch get two rings each: the whole body, then the cut one (a short wall from the sill to the axle)
      if (i === 0) slices.push({ x, cut: false, order: 0 }, { x, cut: true, order: 1 });
      else if (i === ARCH_COLUMNS) slices.push({ x, cut: true, order: 0 }, { x, cut: false, order: 1 });
      else slices.push({ x, cut: true, order: 0 });
    }
  }
  return slices.sort((p, q) => q.x - p.x || p.order - q.order);
}

/* ---- the body ---- */

function paletteOf(design, paint) {
  const body = rgb(paint);
  const pick = (k) => (k === 'body' ? body : TRIM[k] || TRIM.black);
  // the glass: dark at the belt, the sky reflected towards its top
  const ys = design.stations.map((s) => s[3]), yr = design.stations.map((s) => s[4] + s[9]);
  const gLo = Math.min(...ys), gHi = Math.max(...yr);
  const glass = (p) => mix3(TRIM.glassLow, TRIM.glassHigh, clamp01((p[1] - gLo) / (gHi - gLo)) ** 1.3);
  // the paint darkens towards the sill (the light the body itself keeps off its lower half): a painted occlusion, no texture
  const shaded = (p) => shade(body, PAINT_LOW + (1 - PAINT_LOW) * clamp01((p[1] - 0.15) / 0.7));
  return {
    body, glass, pick, shaded,
    sill: design.sill === 'black' ? TRIM.plastic : shade(body, 0.82),
    pillar: design.pillars === 'black' ? TRIM.black : body,
    roof: design.roof === 'black' ? TRIM.black : body,
    lower: (p) => shade(shaded(p), 0.95),
    dark: shade(body, 0.5),
  };
}

/** The colour of segment k (of RING round the ring) of the loft between two slices at xm. */
function segmentColour(design, k, xm, cut, pal) {
  const mirrored = k >= RING / 2 ? RING - 1 - k : k;
  const glassFirst = design.sideGlass[0][0], glassLast = design.sideGlass[design.sideGlass.length - 1][1];
  const inScreens = inRange(xm, design.windscreen) || inRange(xm, design.rearWindow);
  const inRoof = xm < design.windscreen[1] && xm > design.rearWindow[0];
  switch (mirrored) {
    case 0: return cut ? TRIM.liner : TRIM.plastic;                                    // the floor; in an arch, the liner of the wheel well
    case 1: return pal.sill;                                                           // the sill (the cladding)
    case 2: return pal.lower;                                                          // the lower door, under the shoulder
    case 3: return pal.shaded;                                                         // the flank
    case 4:                                                                            // the greenhouse: side glass, pillars
      if (design.sideGlass.some((r) => inRange(xm, r))) return pal.glass;
      return xm < glassFirst && xm > glassLast ? pal.pillar : pal.body;
    case 5: return inScreens ? pal.pillar : inRoof ? pal.roof : pal.body;              // the roof rail, the A pillar beside the windscreen
    default: return inScreens ? pal.glass : inRoof ? pal.roof : pal.body;              // the roof: windscreen, roof, rear window; the bonnet, the boot
  }
}

/** A polygon of [y, z] points laid on the front or rear of the body, split so that it follows the curve; adds to `b`. */
function layOnBody(b, shape, end, pts, colour, lift = SURFACE_LIFT, side = 1) {
  const sign = end === 'front' ? 1 : -1;
  // the point on the surface, lifted along the surface's normal (x = f(y, z): n ~ (sign, -f_y, -f_z) - a lamp on a slanted corner stays out of it)
  const H = 0.01;
  const to3 = ([y, z0]) => {
    const z = z0 * side, x = shape.surfaceX(end, y, z);
    const fy = (shape.surfaceX(end, y + H, z) - shape.surfaceX(end, y - H, z)) / (2 * H);
    const fz = (shape.surfaceX(end, y, z + H) - shape.surfaceX(end, y, z - H)) / (2 * H);
    const nx = sign, ny = -fy * sign, nz = -fz * sign, l = Math.hypot(nx, ny, nz);
    return [x + (nx / l) * lift, y + (ny / l) * lift, z + (nz / l) * lift];
  };
  const tris = [];
  for (let i = 1; i + 1 < pts.length; i++) tris.push([pts[0], pts[i], pts[i + 1]]);
  let level = tris;
  for (let s = 0; s < SUBDIVIDE; s++) {
    const next = [];
    for (const [p, q, r] of level) {
      const pq = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], qr = [(q[0] + r[0]) / 2, (q[1] + r[1]) / 2], rp = [(r[0] + p[0]) / 2, (r[1] + p[1]) / 2];
      next.push([p, pq, rp], [pq, q, qr], [rp, qr, r], [pq, qr, rp]);
    }
    level = next;
  }
  for (const t of level) {
    const [a, c, d] = t.map(to3);
    // facing away from the car along x
    const nx = (c[1] - a[1]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[1] - a[1]);
    b.poly(nx * sign >= 0 ? [a, c, d] : [a, d, c], colour);
  }
}

/** The same polygon grown by `pad` (m) round its middle: the dark bezel behind a lamp. */
function grow(pts, pad) {
  const cy = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([y, z]) => { const dy = y - cy, dz = z - cz, l = Math.hypot(dy, dz) || 1; return [y + (dy / l) * pad, z + (dz / l) * pad]; });
}

/* The stroke letters of the taxi sign, in a unit box (x across 0..1, y up 0..1). */
const LETTERS = Object.freeze({
  T: [[[0, 0.8], [1, 0.8], [1, 1], [0, 1]], [[0.38, 0], [0.62, 0], [0.62, 0.8], [0.38, 0.8]]],
  A: [[[0, 0], [0.22, 0], [0.6, 1], [0.4, 1]], [[0.78, 0], [1, 0], [0.6, 1], [0.4, 1]], [[0.22, 0.28], [0.78, 0.28], [0.72, 0.44], [0.28, 0.44]]],
  X: [[[0, 0], [0.24, 0], [1, 1], [0.76, 1]], [[0.76, 0], [1, 0], [0.24, 1], [0, 1]]],
  I: [[[0.38, 0], [0.62, 0], [0.62, 1], [0.38, 1]]],
});

/** The body of a design in a paint: the loft, the end caps, then the small parts. */
function buildBody(design, paint) {
  const shape = shapeOf(design);
  const pal = paletteOf(design, paint);
  const b = new FaceBuilder();
  const slices = sliceList(design, shape);
  const rings = slices.map((s) => { const r = shape.ringAt(s.x); return (s.cut ? shape.cutRing(s.x, r) : r).map(([y, z]) => [s.x, y, z]); });
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i], B = rings[i + 1];
    const xm = (slices[i].x + slices[i + 1].x) / 2;
    const cut = slices[i].cut && slices[i + 1].cut;
    const n = A.length;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const colour = segmentColour(design, k, xm, cut || (slices[i].x === slices[i + 1].x), pal);
      b.outwardTri([A[k], A[k1], B[k1]], colour, BODY_CENTRE_Y);
      b.outwardTri([A[k], B[k1], B[k]], colour, BODY_CENTRE_Y);
    }
  }
  // the end caps: the front face and the rear face (the lower part black: the bumper's intake / the diffuser)
  for (const [x, ring] of [[shape.frontX, rings[0]], [shape.backX, rings[rings.length - 1]]]) {
    const n = ring.length;
    b.outwardFan(ring.slice(2, n - 1), pal.shaded, x);
    b.outwardFan([ring[0], ring[1], ring[2], ring[n - 2], ring[n - 1]], pal.sill, x);
  }

  for (const side of [1, -1]) {
    // the shut lines of the doors: thin dark strips on the side of the body
    for (const x of design.doorLines) {
      const r = shape.ringAt(x);
      const y0 = Math.max(r[2][0] + 0.02, shape.archTop(x) + 0.02), y1 = r[4][0] - 0.01;
      const z = (y) => side * (shape.sideZ(x, y) + 0.004);
      b.poly([[x, y0, z(y0)], [x - 0.012, y0, z(y0)], [x - 0.012, y1, z(y1)], [x, y1, z(y1)]], TRIM.black);
    }
    // the door handles
    for (const x of design.handles) { const y = shape.ringAt(x)[4][0] - 0.08; b.box(x, y, side * (shape.sideZ(x, y) + 0.012), 0.1, 0.014, 0.012, pal.dark); }
    // the mirror: a black foot on the belt line at the base of the A pillar, a housing in the paint, the dark glass facing back
    const mr = shape.ringAt(design.mirror.x), my = mr[4][0] + 0.05, mz = mr[4][1];
    b.box(design.mirror.x, my - 0.015, side * (mz + 0.03), 0.05, 0.02, 0.04, TRIM.black);
    b.box(design.mirror.x - 0.02, my + 0.03, side * (mz + 0.12), 0.07, 0.045, 0.075, pal.body);
    b.box(design.mirror.x - 0.092, my + 0.03, side * (mz + 0.12), 0.004, 0.036, 0.064, TRIM.black);
    // the stripes along the flank (the flag of the taxi), stopped by the wheel arches
    for (const s of design.stripes) {
      const steps = Math.max(2, Math.ceil((s.x0 - s.x1) / 0.08));
      for (let i = 0; i < steps; i++) {
        const xa = lerp(s.x0, s.x1, i / steps), xb = lerp(s.x0, s.x1, (i + 1) / steps);
        const ya0 = Math.max(s.y0, shape.archTop(xa) + 0.015), yb0 = Math.max(s.y0, shape.archTop(xb) + 0.015);
        if (ya0 >= s.y1 || yb0 >= s.y1) continue;
        const z = (x, y) => side * (shape.sideZ(x, y) + 0.005);
        const quad = [[xa, ya0, z(xa, ya0)], [xb, yb0, z(xb, yb0)], [xb, s.y1, z(xb, s.y1)], [xa, s.y1, z(xa, s.y1)]];
        b.poly(side > 0 ? quad : quad.slice().reverse(), TRIM[s.colour]);
      }
    }
  }
  // the decals on the front and the rear (grilles, intakes, plates, the diffuser) and the bezels of the lamps
  for (const d of design.decals) {
    for (const side of d.mirror === false ? [1] : [1, -1]) layOnBody(b, shape, d.end, d.pts, pal.pick(d.colour), d.lift || SURFACE_LIFT, side);
  }
  for (const list of [design.lamps.head, design.lamps.tail]) {
    for (const l of list) for (const side of l.mirror === false ? [1] : [1, -1]) layOnBody(b, shape, l.end, grow(l.pts, 0.025), TRIM.bezel, SURFACE_LIFT * 0.5, side);
  }
  for (const box of design.boxes) {
    for (const side of box.mirror ? [1, -1] : [1]) b.box(box.c[0], box.c[1], box.c[2] * side, box.h[0], box.h[1], box.h[2], pal.pick(box.colour));
  }
  // the roof rails (the estate)
  if (design.roofRails) {
    const [x0, x1] = [design.windscreen[1] - 0.15, design.rearWindow[0] + 0.1];
    const r = shape.ringAt((x0 + x1) / 2), y = r[6][0] + 0.03, z = r[6][1] - 0.02;
    for (const side of [1, -1]) {
      b.box((x0 + x1) / 2, y + 0.025, side * z, (x0 - x1) / 2, 0.012, 0.018, TRIM.silver);
      for (const x of [x0 - 0.04, x1 + 0.04]) b.box(x, y + 0.008, side * z, 0.04, 0.02, 0.022, TRIM.black);
    }
  }
  // the taxi sign: a black foot, the TAXI letters on its front and back (the lit box itself is in the headlamp mesh)
  if (design.sign) {
    const s = design.sign, top = shape.ringAt(s.x)[8][0];
    b.box(s.x, top + 0.015, 0, s.d / 2 + 0.01, 0.02, s.w / 2 + 0.01, TRIM.black);
    const h = s.h * 0.55, w = h * 0.85, gap = h * 0.28, y0 = top + 0.035 + (s.h - h) / 2;
    const total = s.text.length * w + (s.text.length - 1) * gap;
    for (const end of [1, -1]) {
      const x = s.x + end * (s.d / 2 + 0.004);
      [...s.text].forEach((ch, i) => {
        // seen from the front the text runs from +z to -z, seen from the back from -z to +z
        const z0 = end * (total / 2 - i * (w + gap));
        for (const stroke of LETTERS[ch] || []) {
          const quad = stroke.map(([u, v]) => [x, y0 + v * h, z0 - end * u * w]);
          b.poly(end > 0 ? quad.slice().reverse() : quad, TRIM.signText);
        }
      });
    }
  }
  return b.build();
}

/** A wheel: the tyre, the sidewall and a spoked rim, with the axle along z; both faces (the wheel is shared by both sides). */
function buildWheel(design) {
  const { r: R, halfWidth: W, spokes, rim } = design.wheel;
  const tyre = [0.08, 0.08, 0.09], wall = [0.13, 0.13, 0.14];
  const metal = rim === 'dark' ? [0.2, 0.21, 0.23] : [0.66, 0.68, 0.72];
  const lip = rim === 'dark' ? [0.5, 0.52, 0.56] : [0.78, 0.8, 0.83];
  const gapC = [0.04, 0.04, 0.05], hub = rim === 'dark' ? [0.12, 0.12, 0.13] : [0.5, 0.52, 0.55];
  const b = new FaceBuilder();
  const Rr = R * 0.72, Rl = R * 0.66, Rh = R * 0.2;
  const every = WHEEL_SEGMENTS / spokes;
  const at = (k, r, z) => [Math.cos(2 * Math.PI * k / WHEEL_SEGMENTS) * r, Math.sin(2 * Math.PI * k / WHEEL_SEGMENTS) * r, z];
  for (let k = 0; k < WHEEL_SEGMENTS; k++) {
    const k1 = k + 1;
    b.poly([at(k, R, -W), at(k1, R, -W), at(k1, R, W), at(k, R, W)], tyre);                    // the tread
    const isSpoke = k % every === 0;
    for (const [z, up] of [[W, 1], [-W, -1]]) {
      const order = (pts) => (up > 0 ? pts : pts.slice().reverse());
      const inset = isSpoke ? z : z * 0.4;                                                    // between the spokes the rim is deep (dark)
      b.poly(order([at(k, R, z), at(k1, R, z), at(k1, Rr, z), at(k, Rr, z)]), wall);         // the sidewall
      b.poly(order([at(k, Rr, z), at(k1, Rr, z), at(k1, Rl, z), at(k, Rl, z)]), lip);        // the rim's lip
      b.poly(order([at(k, Rl, inset), at(k1, Rl, inset), at(k1, Rh, inset), at(k, Rh, inset)]), isSpoke ? metal : gapC);   // a spoke or the gap
      b.poly(order([at(k, Rh, z), at(k1, Rh, z), [0, 0, z * 1.05]]), hub);                    // the hub
    }
  }
  return b.build();
}

/** The lamps of one kind (lists of polygons laid on the body) in one mesh for an unlit material; the taxi sign joins the headlamps. */
function buildLamps(design, lists, withSign = false) {
  const shape = shapeOf(design);
  const b = new FaceBuilder();
  for (const list of lists) for (const l of list || []) for (const side of l.mirror === false ? [1] : [1, -1]) layOnBody(b, shape, l.end, l.pts, [1, 1, 1], SURFACE_LIFT * 2.2, side);
  if (withSign && design.sign) {
    const s = design.sign, top = shape.ringAt(s.x)[8][0];
    b.box(s.x, top + 0.035 + s.h / 2, 0, s.d / 2, s.h / 2, s.w / 2, [1, 1, 1]);
  }
  if (b.count === 0) b.box(0, 0.5, 0, 0.001, 0.001, 0.001, [1, 1, 1]);      // (a mesh needs a geometry)
  return b.build();
}

/** The soft contact shadow under the car (a canvas texture: the rounded box drawn many times, each smaller and darker). */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const STEPS = 14;
  for (let i = 0; i < STEPS; i++) {
    const inset = i * 1.9, r = Math.max(4, 22 - i);
    const x0 = inset, y0 = inset, x1 = 128 - inset, y1 = 64 - inset;
    g.fillStyle = `rgba(0,0,0,${0.075})`;
    g.beginPath();
    g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arcTo(x1, y0, x1, y0 + r, r); g.lineTo(x1, y1 - r); g.arcTo(x1, y1, x1 - r, y1, r);
    g.lineTo(x0 + r, y1); g.arcTo(x0, y1, x0, y1 - r, r); g.lineTo(x0, y0 + r); g.arcTo(x0, y0, x0 + r, y0, r); g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const HEAD_OFF = [0.76, 0.79, 0.82], HEAD_ON = [1, 0.97, 0.8];
const TAIL_OFF = [0.6, 0.07, 0.07], TAIL_NIGHT = [0.8, 0.08, 0.07], TAIL_BRAKE = [1, 0.14, 0.1];
const REVERSE_OFF = [0.6, 0.6, 0.6], REVERSE_ON = [1, 1, 0.94];

const lampMaterial = () => new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, side: THREE.DoubleSide });
const setColor = (material, c) => material.color.setRGB(c[0], c[1], c[2]);
const designOf = (id) => CAR_DESIGNS[id] || CAR_DESIGNS[DEFAULT_CAR_DESIGN];
const wheelSpots = (d) => [[d.wheel.x[0], d.wheel.z], [d.wheel.x[0], -d.wheel.z], [d.wheel.x[1], d.wheel.z], [d.wheel.x[1], -d.wheel.z]];

/**
 * The car model. `designId` is a key of CAR_DESIGNS, `colourId` a key of CAR_COLOURS (null: the design's own colour).
 * Returns { group, body, wheels, setColour, setDesign, apply, headlight }.
 */
export function createCarModel({ colourId = null, designId = DEFAULT_CAR_DESIGN, material, groundAt = null }) {
  let design = designOf(designId);
  let colour = CAR_COLOURS[colourId] ? colourId : design.defaultColour;
  const group = new THREE.Group();
  group.name = 'car';
  const body = new THREE.Mesh(buildBody(design, CAR_COLOURS[colour]), material);
  body.name = 'car-body';
  // the body tilts as a whole (the attitude of the physics); the wheels stay on the ground
  const tilt = new THREE.Group();
  tilt.add(body);
  group.add(tilt);

  const headMat = lampMaterial(), tailMat = lampMaterial(), reverseMat = lampMaterial();
  const lampParts = (d) => [['car-headlamps', [d.lamps.head, d.lamps.drl], headMat, true], ['car-taillamps', [d.lamps.tail], tailMat, false], ['car-reverselamps', [d.lamps.reverse], reverseMat, false]];
  const lampMeshes = lampParts(design).map(([name, lists, mat, sign]) => {
    const mesh = new THREE.Mesh(buildLamps(design, lists, sign), mat);
    mesh.name = name;
    tilt.add(mesh);
    return mesh;
  });

  // the contact shadow: on the ground under the car (not tilted with the body), drawn after the world, never written to depth
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: shadowTexture(), color: 0x000000, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, fog: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  shadow.name = 'car-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  group.add(shadow);
  const placeShadow = (d) => {
    const s = shapeOf(d), widest = Math.max(...d.stations.map((q) => q[6]));
    shadow.position.set((s.frontX + s.backX) / 2, SHADOW_LIFT, 0);
    shadow.scale.set(s.frontX - s.backX + 0.5, 2 * widest + 0.45, 1);    // (the plane's x is the car's length, its y the width after the turn)
  };
  placeShadow(design);

  let wheelGeometry = buildWheel(design);
  const wheels = [];                                    // { pivot, tyre, front }
  for (const [x, z] of wheelSpots(design)) {
    const pivot = new THREE.Group();
    pivot.position.set(x, design.wheel.r, z);
    const tyre = new THREE.Mesh(wheelGeometry, material);
    tyre.name = 'car-wheel';
    pivot.add(tyre);
    group.add(pivot);
    wheels.push({ pivot, tyre, front: x > 0, travel: 0 });
  }
  let spots = wheelSpots(design);
  let spin = 0;
  let smoothHead = 0;
  setColor(headMat, HEAD_OFF); setColor(tailMat, TAIL_OFF); setColor(reverseMat, REVERSE_OFF);

  const model = {
    group, body, wheels,
    get designId() { return design.id; },
    get colourId() { return colour; },
    wheelbase: design.wheel.x[0] - design.wheel.x[1],
    wheelRadius: design.wheel.r,
    /** Paints the car in another colour (the body geometry is rebuilt; the old one is released). */
    setColour(id) {
      if (!CAR_COLOURS[id]) throw new Error(`car-model: unknown colour "${id}"`);
      colour = id;
      body.geometry.dispose();
      body.geometry = buildBody(design, CAR_COLOURS[id]);
    },
    /** Builds another design (car-designs.js); keepColour = false takes the design's own colour. */
    setDesign(id, keepColour = true) {
      if (!CAR_DESIGNS[id]) throw new Error(`car-model: unknown design "${id}"`);
      design = CAR_DESIGNS[id];
      if (!keepColour) colour = design.defaultColour;
      body.geometry.dispose();
      body.geometry = buildBody(design, CAR_COLOURS[colour]);
      lampParts(design).forEach(([, lists, , sign], i) => { lampMeshes[i].geometry.dispose(); lampMeshes[i].geometry = buildLamps(design, lists, sign); });
      wheelGeometry.dispose();
      wheelGeometry = buildWheel(design);
      spots = wheelSpots(design);
      wheels.forEach((w, i) => { w.tyre.geometry = wheelGeometry; w.pivot.position.set(spots[i][0], design.wheel.r, spots[i][1]); });
      placeShadow(design);
      model.wheelbase = design.wheel.x[0] - design.wheel.x[1];
      model.wheelRadius = design.wheel.r;
    },
    /**
     * Puts the car on the ground and animates it: the wheels roll and the front ones steer, the body pitches and rolls,
     * the lamps follow the lights.  `lights` = { head: 0..1 (the headlamps), night: 0..1 } from the environment.
     */
    apply(state, dt, lights = { head: 0, night: 0 }) {
      const R = design.wheel.r;
      group.position.set(state.x, state.y - LIFT_FROM_PHYSICS, state.z);
      // the whole car lies on the slope: the yaw first, then the pitch (rotation.z lifts the nose), then the roll (rotation.x
      // leans the right side down); the body moves on top of that on its suspension
      group.rotation.order = 'YZX';
      group.rotation.set(Math.max(-ROLL_LIMIT, Math.min(ROLL_LIMIT, state.roll)), -state.heading, state.pitch);
      tilt.rotation.set(state.lean, 0, state.squat);
      // a wheel rolling forward (+x) turns by -v/R about its axle (+z)
      spin -= (state.speed * dt) / R;
      if (spin < -1e4 || spin > 1e4) spin %= 2 * Math.PI;
      // each drawn wheel on its own spring down to the ground under it (car-wheels.js; the body keeps the attitude of the physics)
      const roll = Math.max(-ROLL_LIMIT, Math.min(ROLL_LIMIT, state.roll));
      const offs = groundAt ? wheelOffsets(state.x, state.y - LIFT_FROM_PHYSICS, state.z, state.heading, state.pitch, roll, spots, groundAt) : null;
      const k = Math.min(1, dt * WHEEL_TRAVEL.rate);
      wheels.forEach((w, i) => {
        w.pivot.rotation.set(0, w.front ? -state.steer : 0, 0);
        w.tyre.rotation.set(0, 0, spin);
        w.travel += ((offs ? offs[i] : 0) - w.travel) * (dt > 0 ? k : 1);
        w.pivot.position.y = R + w.travel;
      });
      // the lamps: the headlamps follow the headlights, the tail lamps glow at night and flare when braking
      smoothHead += (lights.head - smoothHead) * Math.min(1, dt * 8);
      setColor(headMat, mix3(HEAD_OFF, HEAD_ON, smoothHead));
      setColor(tailMat, state.braking ? TAIL_BRAKE : mix3(TAIL_OFF, TAIL_NIGHT, smoothHead));
      setColor(reverseMat, state.reversing ? REVERSE_ON : REVERSE_OFF);
    },
    /** The headlight: the world position and the direction of the beam (for the lamp of the light shader). */
    headlight(state, outPos, outDir) {
      const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
      outPos.set(state.x + cy * 2.0, state.y + 0.35, state.z + sy * 2.0);
      outDir.set(cy, -0.12, sy);
    },
  };
  return model;
}
