/* Lokféierer: Luxtram road traffic (TS.luxTraffic).
 *   - cars, vans, a lorry, taxis and city / regional buses (one merged, instanced mesh: a single draw call) drive along the real OSM roads of the
 *     loaded chunks, follow the road graph through junctions, stop in front of a tram crossing while a tram is near (red lights), queue behind each
 *     other and never stand on the tracks.
 *   - every vehicle is grounded on four wheel contact points taken from the height query of the ground (ctx.roadHeightAt = the rendered road /
 *     terrain surface, bridge decks included), so it follows slopes and cambers, never sinks and never floats.  No height yet (tile not built) = hidden.
 *   - sometimes a Luxtram comes the other way on the opposite track, dwells at its stops and passes (visual only; spawns and despawns out of sight).
 * Created by luxtram-world.js:  const tr = TS.luxTraffic.create(ctx);  tr.markDirty() when roads change;  tr.update(dt, tramS, camera);  tr.dispose();
 * tr.posts() (test hook).  Debug / test handle: TS.luxTraffic.last = { spawnOncoming(), state(), cars() }.
 *
 * Oncoming-tram dwell interface (optional, implemented by passengers.js; everything works without it):
 *   TS.tramDwell.arrive(info)  called when an oncoming tram has stopped at a stop and opens its doors on the platform side.
 *       info = { id, stopName, platformSide: 'left' | 'right' (relative to THAT tram's direction of travel),
 *                doors: [{ x, y, z }] (world position of every door centre on the platform side, at floor level),
 *                dwellMs (30000: the dwell in ms of sim time), getDoors: () => [{ x, y, z }] (the same list, recomputed) }
 *       A returned number > dwellMs asks for a longer dwell; the dwell is extended to that value, at most 45 s.
 *   TS.tramDwell.depart({ id })  called when the doors are closed again, right before the tram pulls away (also when the tram is
 *       removed while it dwells).
 * The oncoming tram dwells 30 s (or the extension), closes its doors during the last 3 s and then accelerates away; it never
 * waits for the player's tram. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] luxtram traffic: ';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---- switches / constants */
  const CARS_ON_BRIDGES = true;      // drive over the bridge decks (flag & 1 roads; needs the world to keep those roads in roadsByChunk with bridge: true)
  let LANE_K = 0.34;                 // lane centre = this * road half width
  const SUS_MAX = 0.4;               // largest wheel offset the body warp follows (m)
  const WHEEL_SPREAD_MAX = 1.0;      // wheels on ground that differs by more than this: the body warp (3/4 of the spread at worst, SUS_MAX) cannot follow, no car there (m)
  const ROAD_LIFT = 0.015;           // wheels rest this far above the height query (it already is the drawn surface; the white lines are 3.5 cm above it)
  const TRAM_LEN_FALLBACK = 46;
  const RED_AHEAD = 90;              // a crossing turns red while a tram is this close before it
  const RED_AFTER = 14;              // ... and until its tail is this far past it

  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================ vehicle models
   * One merged geometry holds every type; each vertex carries its type id, the instance picks its type (the other types collapse outside the clip volume).
   * Local frame: forward = -Z, right = +X, y = 0 on the road, z = 0 mid-wheelbase.
   * Vertex data: colour (fixed), aMark = (paint, glow): paint 1 = multiplied by the instance's body colour, glow 1 = lamp that lights up at night. */
  const TYPES = ['hatch', 'sedan', 'estate', 'suv', 'van', 'truck', 'taxi', 'avl', 'rgtr'];
  const TID = {}; TYPES.forEach((n, i) => { TID[n] = i; });
  const GLASS = [0.1, 0.14, 0.18];
  const GLASS_FRONT = [0.16, 0.21, 0.26];
  const DARK = [0.06, 0.06, 0.07];
  const UNDER = [0.05, 0.05, 0.055];
  const WHITE = [1, 1, 1];
  const LAMP_HEAD = [1, 0.96, 0.82];
  const LAMP_TAIL = [0.85, 0.05, 0.04];
  const CHROME = [0.62, 0.64, 0.66];

  class Mesher {
    constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.t = []; this.i = []; this.type = 0; }
    quadOut(a, b, c, d, col, paint, glow, hint) {
      // flat quad, normal from the points, flipped to face `hint` (a vector pointing out of the solid)
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
      const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
      nx /= l; ny /= l; nz /= l;
      let pts = [a, b, c, d];
      if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; pts = [a, d, c, b]; }
      const base = this.p.length / 3;
      for (let k = 0; k < 4; k++) {
        this.p.push(pts[k][0], pts[k][1], pts[k][2]); this.n.push(nx, ny, nz);
        this.c.push(col[0], col[1], col[2]); this.m.push(paint, glow); this.t.push(this.type);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    tri(a, b, c, col, paint, glow, hint) {
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
      const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
      nx /= l; ny /= l; nz /= l;
      let pts = [a, b, c];
      if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; pts = [a, c, b]; }
      const base = this.p.length / 3;
      for (let k = 0; k < 3; k++) {
        this.p.push(pts[k][0], pts[k][1], pts[k][2]); this.n.push(nx, ny, nz);
        this.c.push(col[0], col[1], col[2]); this.m.push(paint, glow); this.t.push(this.type);
      }
      this.i.push(base, base + 1, base + 2);
    }
  }

  /* axis-aligned box */
  function box(m, cx, cy, cz, sx, sy, sz, col, paint, glow) {
    const x0 = cx - sx / 2; const x1 = cx + sx / 2; const y0 = cy - sy / 2; const y1 = cy + sy / 2; const z0 = cz - sz / 2; const z1 = cz + sz / 2;
    const P = (x, y, z) => [x, y, z];
    const g = glow || 0; const pa = paint || 0;
    m.quadOut(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), col, pa, g, [0, 0, -1]);
    m.quadOut(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col, pa, g, [0, 0, 1]);
    m.quadOut(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), col, pa, g, [-1, 0, 0]);
    m.quadOut(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), col, pa, g, [1, 0, 0]);
    m.quadOut(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), col, pa, g, [0, 1, 0]);
    m.quadOut(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), col, pa, g, [0, -1, 0]);
  }

  /* lofted hull through cross sections (front to back, z ascending): { z, y0, y1, w0, w1 } = bottom / top height and half width at the bottom / top.
   * style(face, seg) -> [col, paint]: face = 'l' | 'r' | 't' | 'b' | 'f' | 'k' (front cap / back cap). */
  function hull(m, secs, style) {
    let cx = 0; let cy = 0; let cz = 0;
    secs.forEach((s) => { cx += 0; cy += (s.y0 + s.y1) / 2; cz += s.z; });
    cy /= secs.length; cz /= secs.length;
    const C = [cx, cy, cz];
    const out = (p) => [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
    const bl = (s) => [-s.w0, s.y0, s.z]; const br = (s) => [s.w0, s.y0, s.z];
    const tl = (s) => [-s.w1, s.y1, s.z]; const tr = (s) => [s.w1, s.y1, s.z];
    const draw = (face, seg, a, b, c, d) => {
      const st = style(face, seg); if (!st) return;
      const mid = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
      m.quadOut(a, b, c, d, st[0], st[1] || 0, st[2] || 0, out(mid));
    };
    for (let i = 0; i + 1 < secs.length; i++) {
      const a = secs[i]; const b = secs[i + 1];
      draw('l', i, bl(a), bl(b), tl(b), tl(a));
      draw('r', i, br(a), br(b), tr(b), tr(a));
      draw('t', i, tl(a), tr(a), tr(b), tl(b));
      draw('b', i, bl(a), br(a), br(b), bl(b));
    }
    const f = secs[0]; const k = secs[secs.length - 1];
    draw('f', 0, bl(f), br(f), tr(f), tl(f));
    draw('k', secs.length - 2, bl(k), br(k), tr(k), tl(k));
  }

  /* wheel (axis along X): tyre ring, a lighter hub disc on the outer side */
  function wheel(m, cx, cy, cz, r, w, sideSign) {
    const N = 10;
    const TYRE = [0.045, 0.045, 0.05]; const HUB = [0.55, 0.57, 0.6];
    const x0 = cx - w / 2; const x1 = cx + w / 2;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2; const a1 = ((i + 1) / N) * Math.PI * 2;
      const y0 = cy + Math.sin(a0) * r; const z0 = cz + Math.cos(a0) * r;
      const y1 = cy + Math.sin(a1) * r; const z1 = cz + Math.cos(a1) * r;
      m.quadOut([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], TYRE, 0, 0, [0, (y0 + y1) / 2 - cy, (z0 + z1) / 2 - cz]);
      const xo = sideSign > 0 ? x1 : x0; const xh = xo + sideSign * 0.006; const hr = r * 0.62;
      const hy0 = cy + Math.sin(a0) * hr; const hz0 = cz + Math.cos(a0) * hr; const hy1 = cy + Math.sin(a1) * hr; const hz1 = cz + Math.cos(a1) * hr;
      m.tri([xh, cy, cz], [xh, hy0, hz0], [xh, hy1, hz1], HUB, 0, 0, [sideSign, 0, 0]);
      const xi = sideSign > 0 ? x0 : x1;
      m.tri([xi, cy, cz], [xi, y0, z0], [xi, y1, z1], TYRE, 0, 0, [-sideSign, 0, 0]);
      m.tri([xo, cy, cz], [xo, y0, z0], [xo, y1, z1], TYRE, 0, 0, [sideSign, 0, 0]);   // outer sidewall under the hub
    }
  }
  /* dark wheel-arch disc on the body side behind each wheel (the tyre pokes 2 cm out of it) */
  function arch(m, x, cy, cz, r, sd) {
    const N = 10; const ARCH = [0.03, 0.03, 0.035];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2; const a1 = ((i + 1) / N) * Math.PI * 2;
      m.tri([x, cy, cz], [x, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r], [x, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r], ARCH, 0, 0, [sd, 0, 0]);
    }
  }
  function wheels(m, spec) {
    const hz = spec.wb / 2; const hx = spec.tw / 2; const w = spec.ww || 0.22;
    [[-hz, -1], [-hz, 1], [hz, -1], [hz, 1]].forEach((q) => {
      wheel(m, q[1] * hx, spec.wr, q[0], spec.wr, w, q[1]);
      arch(m, q[1] * (spec.W / 2 + 0.004), spec.wr + 0.05, q[0], spec.wr * 1.06, q[1]);
    });
    if (spec.dual) [-1, 1].forEach((sd) => wheel(m, sd * (hx - w * 1.0), spec.wr, hz, spec.wr, w, sd));
  }
  function lamps(m, zf, zr, hw, yh, yt, sz) {
    // head lamps + grille at the front (z = zf, forward = -Z), tail lamps at the rear
    [-1, 1].forEach((sd) => {
      box(m, sd * hw * 0.74, yh, zf - 0.012, hw * 0.46, sz, 0.05, LAMP_HEAD, 0, 1);
      box(m, sd * hw * 0.78, yt, zr + 0.012, hw * 0.4, sz * 0.8, 0.05, LAMP_TAIL, 0, 1);
    });
  }

  /* passenger car family: hatch, sedan, estate, suv (+ taxi = sedan with a roof sign).  p = proportions */
  function passenger(m, p) {
    const L = p.L; const W = p.W; const hw = W / 2; const zf = -L / 2; const zr = L / 2;
    const belt = p.belt; const roof = p.roof;
    const hood = belt - 0.1;
    const body = [
      { z: zf, y0: p.sill + 0.08, y1: belt - 0.28, w0: hw * 0.9, w1: hw * 0.88 },
      { z: zf + 0.16, y0: p.sill, y1: hood - 0.08, w0: hw * 0.97, w1: hw * 0.94 },
      { z: zf + p.hoodLen, y0: p.sill, y1: hood, w0: hw, w1: hw * 0.95 },
      { z: zr - p.tail, y0: p.sill, y1: p.deck, w0: hw, w1: hw * 0.95 },
      { z: zr - 0.1, y0: p.sill + 0.04, y1: p.deck - 0.04, w0: hw * 0.97, w1: hw * 0.92 },
      { z: zr, y0: p.sill + 0.1, y1: p.deck - 0.2, w0: hw * 0.9, w1: hw * 0.86 },
    ];
    hull(m, body, (face) => (face === 'b' ? [UNDER, 0] : face === 'f' ? [DARK, 0] : [WHITE, 1]));
    // greenhouse
    const g0 = zf + p.hoodLen; const g1 = g0 + p.wsLen; const g2 = zr - p.tail - p.rwLen + (p.cabinShift || 0) - 0.0; const g3 = zr - p.tail;
    const gz = [g0, g1, Math.max(g1 + 0.4, g2 - 0.0), Math.max(g1 + 0.8, g3 + (p.rearBase || 0))];
    const gy = belt - 0.04;
    const gh = [
      { z: gz[0], y0: gy, y1: belt + 0.02, w0: hw * 0.93, w1: hw * 0.86 },
      { z: gz[1], y0: gy, y1: roof, w0: hw * 0.92, w1: hw * 0.8 },
      { z: gz[2], y0: gy, y1: roof, w0: hw * 0.92, w1: hw * 0.8 },
      { z: gz[3], y0: gy, y1: p.deck + 0.02, w0: hw * 0.93, w1: hw * 0.86 },
    ];
    hull(m, gh, (face, seg) => {
      if (face === 'b' || face === 'f' || face === 'k') return null;
      if (face === 't') return seg === 1 ? [WHITE, 1] : [GLASS_FRONT, 0];
      return [GLASS, 0];
    });
    // pillars (body colour) between the side windows
    [-1, 1].forEach((sd) => {
      const px = (w) => sd * (w + 0.004);
      box(m, px(hw * 0.92 - 0.02), (belt + roof) / 2 - 0.02, (gz[1] + gz[2]) / 2, 0.05, roof - belt, 0.09, WHITE, 1, 0);
      box(m, px(hw * 0.915 - 0.02), (belt + roof) / 2 - 0.04, gz[2] + 0.05, 0.05, roof - belt - 0.05, 0.14, WHITE, 1, 0);
      // door lines + mirror
      box(m, sd * (hw + 0.005), (p.sill + belt) / 2, (gz[0] + gz[2]) / 2, 0.012, belt - p.sill - 0.18, 0.012, DARK, 0, 0);
      box(m, sd * (hw + 0.07), belt + 0.02, g0 + 0.08, 0.14, 0.1, 0.1, WHITE, 1, 0);
    });
    // bumpers, grille, plates, lamps
    box(m, 0, p.sill + 0.12, zf - 0.015, W * 0.9, 0.17, 0.05, DARK, 0, 0);
    box(m, 0, p.sill + 0.12, zr + 0.015, W * 0.9, 0.17, 0.05, DARK, 0, 0);
    box(m, 0, p.sill + 0.3, zf - 0.012, W * 0.32, 0.12, 0.05, CHROME, 0, 0);
    box(m, 0, p.sill + 0.12, zf - 0.045, 0.5, 0.11, 0.02, [0.92, 0.92, 0.9], 0, 0);
    box(m, 0, p.sill + 0.26, zr + 0.045, 0.5, 0.11, 0.02, [0.92, 0.92, 0.9], 0, 0);
    lamps(m, zf, zr, hw, hood - 0.12, p.deck - 0.16, 0.11);
    if (p.sign) box(m, 0, roof + 0.07, (gz[1] + gz[2]) / 2, 0.55, 0.14, 0.18, [1, 0.88, 0.45], 0, 1);
    wheels(m, p);
  }

  function van(m, p) {
    const L = p.L; const W = p.W; const hw = W / 2; const zf = -L / 2; const zr = L / 2;
    const body = [
      { z: zf, y0: 0.42, y1: 0.95, w0: hw * 0.9, w1: hw * 0.88 },
      { z: zf + 0.25, y0: 0.32, y1: 1.08, w0: hw * 0.97, w1: hw * 0.95 },
      { z: zf + 1.15, y0: 0.32, y1: 1.22, w0: hw, w1: hw * 0.97 },
      { z: zf + 1.75, y0: 0.32, y1: 2.0, w0: hw, w1: hw * 0.96 },
      { z: zf + 2.35, y0: 0.32, y1: p.H, w0: hw, w1: hw * 0.94 },
      { z: zr - 0.05, y0: 0.32, y1: p.H - 0.04, w0: hw, w1: hw * 0.94 },
      { z: zr, y0: 0.36, y1: p.H - 0.1, w0: hw * 0.97, w1: hw * 0.92 },
    ];
    hull(m, body, (face, seg) => {
      if (face === 'b') return [UNDER, 0];
      if (face === 'f') return [DARK, 0];
      if (face === 't' && seg === 2) return [GLASS_FRONT, 0];     // windscreen
      return [WHITE, 1];
    });
    [-1, 1].forEach((sd) => {
      box(m, sd * (hw + 0.006), 1.55, zf + 1.35, 0.012, 0.5, 1.15, GLASS, 0, 0);          // cab window
      box(m, sd * (hw + 0.006), 1.0, zf + 1.4, 0.012, 0.9, 0.012, DARK, 0, 0);            // door line
      box(m, sd * (hw + 0.1), 1.45, zf + 1.1, 0.16, 0.26, 0.1, DARK, 0, 0);              // mirror
    });
    box(m, 0, 0.5, zf - 0.02, W * 0.92, 0.2, 0.06, DARK, 0, 0);
    box(m, 0, 0.5, zr + 0.02, W * 0.92, 0.2, 0.06, DARK, 0, 0);
    box(m, 0, 0.62, zf - 0.04, 0.5, 0.11, 0.02, [0.92, 0.92, 0.9], 0, 0);
    box(m, 0, 0.62, zr + 0.04, 0.5, 0.11, 0.02, [0.92, 0.92, 0.9], 0, 0);
    lamps(m, zf, zr, hw, 0.82, 0.78, 0.12);
    wheels(m, p);
  }

  function lorry(m, p) {
    const L = p.L; const W = p.W; const hw = W / 2; const zf = -L / 2; const zr = L / 2;
    // chassis, cab, box body
    box(m, 0, 0.62, 0, W * 0.8, 0.22, L * 0.96, UNDER, 0, 0);
    const cab = [
      { z: zf, y0: 0.45, y1: 1.5, w0: hw * 0.95, w1: hw * 0.93 },
      { z: zf + 0.4, y0: 0.45, y1: 1.62, w0: hw, w1: hw * 0.97 },
      { z: zf + 0.95, y0: 0.45, y1: 2.5, w0: hw, w1: hw * 0.95 },
      { z: zf + 2.0, y0: 0.45, y1: 2.55, w0: hw, w1: hw * 0.95 },
    ];
    hull(m, cab, (face, seg) => (face === 'b' ? [UNDER, 0] : face === 'f' ? [DARK, 0] : face === 't' && seg === 1 ? [GLASS_FRONT, 0] : [WHITE, 1]));
    const bx = [
      { z: zf + 2.1, y0: 0.82, y1: 3.05, w0: hw * 0.97, w1: hw * 0.97 },
      { z: zr, y0: 0.82, y1: 3.05, w0: hw * 0.97, w1: hw * 0.97 },
    ];
    hull(m, bx, (face) => (face === 'b' ? [UNDER, 0] : [[0.9, 0.9, 0.9], 0]));
    [-1, 1].forEach((sd) => {
      box(m, sd * (hw + 0.006), 1.95, zf + 0.95, 0.012, 0.55, 0.9, GLASS, 0, 0);
      box(m, sd * (hw * 0.97 + 0.005), 1.6, (zf + 2.1 + zr) / 2, 0.01, 0.9, (zr - zf - 2.1) * 0.6, [0.18, 0.4, 0.62], 0, 0);   // side panel stripe
      box(m, sd * (hw + 0.12), 2.2, zf + 0.55, 0.18, 0.4, 0.1, DARK, 0, 0);
    });
    box(m, 0, 0.6, zf - 0.04, W * 0.95, 0.24, 0.1, DARK, 0, 0);
    box(m, 0, 0.62, zr + 0.03, W * 0.9, 0.2, 0.06, DARK, 0, 0);
    lamps(m, zf, zr, hw, 0.95, 0.85, 0.14);
    wheels(m, p);
  }

  /* city bus (Mercedes Citaro class), 12 m.  avl = baked multi-colour stripes ("multiplicity" livery), rgtr = white with a body-coloured lower band and front */
  const AVL_STRIPES = [[1, 0.46, 0.04], [1, 0.06, 0.46], [0.95, 0.04, 0.1], [0.06, 0.42, 1], [0.12, 0.85, 0.16], [1, 0.8, 0.02], [1, 1, 1]];   // saturated: lit by the hemisphere light they read ~30 % duller than the livery
  function bus(m, p, avl) {
    const L = p.L; const W = p.W; const hw = W / 2; const zf = -L / 2; const zr = L / 2;
    const stripe = (seg) => AVL_STRIPES[seg % AVL_STRIPES.length];
    const N = 12; const secs = [];
    for (let i = 0; i <= N; i++) secs.push({ z: zf + (L * i) / N, y0: 0.32, y1: 1.18, w0: hw * (i === 0 || i === N ? 0.96 : 1), w1: hw * (i === 0 || i === N ? 0.95 : 1) });
    hull(m, secs, (face, seg) => {
      if (face === 'b') return [UNDER, 0];
      if (face === 'f') return avl ? [[0.97, 0.6, 0.12], 0] : [WHITE, 1];
      if (face === 'k') return avl ? [[0.9, 0.9, 0.9], 0] : [WHITE, 1];
      if (face === 't') return [[0.85, 0.85, 0.85], 0];
      return avl ? ((seg + (face === 'r' ? 1 : 0)) % 2 === 1 ? [stripe(seg + (face === 'r' ? 3 : 0)), 0] : [[1, 1, 1], 0]) : [WHITE, 1];
    });
    const winY0 = 1.18; const winY1 = 2.42;
    const win = [
      { z: zf + 0.02, y0: winY0, y1: winY1, w0: hw * 0.985, w1: hw * 0.96 },
      { z: zf + 0.5, y0: winY0, y1: winY1, w0: hw * 1.0, w1: hw * 0.97 },
      { z: zr - 0.3, y0: winY0, y1: winY1, w0: hw * 1.0, w1: hw * 0.97 },
      { z: zr - 0.02, y0: winY0, y1: winY1, w0: hw * 0.985, w1: hw * 0.96 },
    ];
    const BUS_GLASS = [0.08, 0.12, 0.19];
    hull(m, win, (face) => (face === 'b' || face === 't' ? null : face === 'f' ? [[0.24, 0.31, 0.38], 0] : [BUS_GLASS, 0]));
    const roofSecs = [
      { z: zf + 0.02, y0: winY1, y1: 2.88, w0: hw * 0.96, w1: hw * 0.86 },
      { z: zf + 0.7, y0: winY1, y1: 3.0, w0: hw * 0.97, w1: hw * 0.88 },
      { z: zr - 0.3, y0: winY1, y1: 3.0, w0: hw * 0.97, w1: hw * 0.88 },
      { z: zr - 0.02, y0: winY1, y1: 2.9, w0: hw * 0.96, w1: hw * 0.86 },
    ];
    const ROOFW = [0.93, 0.93, 0.93];
    hull(m, roofSecs, (face) => (face === 'b' ? null : face === 't' ? [[0.8, 0.82, 0.84], 0] : face === 'f' ? (avl ? [[0.97, 0.6, 0.12], 0] : [ROOFW, 0]) : [ROOFW, 0]));
    // window pillars + doors on the right side
    [-1, 1].forEach((sd) => {
      if (avl) {
        // full-height colour bands: the lower stripe continues over the window zone (same cells as the lower hull segments)
        for (let k = 1; k < N; k += 2) {
          const kk = sd > 0 ? k + 1 : k;
          if (kk >= N) continue;
          box(m, sd * (hw * 1.0 + 0.006), (winY0 + winY1) / 2, zf + (L * (kk + 0.5)) / N, 0.02, winY1 - winY0 - 0.05, L / N * 0.8, stripe(kk + (sd > 0 ? 3 : 0)), 0, 0);
        }
      } else {
        for (let i = 1; i < 8; i++) box(m, sd * (hw * 1.0 + 0.004), (winY0 + winY1) / 2, zf + 1.6 + i * 1.28, 0.03, winY1 - winY0, 0.09, [0.93, 0.93, 0.93], 0, 0);
      }
    });
    [[zf + 1.35, 1.1], [zf + 5.05, 1.2], [zf + 8.7, 1.2]].forEach((d) => box(m, hw + 0.012, 1.3, d[0] + 0.55, 0.02, 1.85, d[1], [0.07, 0.09, 0.11], 0, 0));
    [-1, 1].forEach((sd) => box(m, sd * (hw + 0.2), 2.05, zf + 0.45, 0.14, 0.4, 0.1, DARK, 0, 0));   // mirrors
    // destination sign, bumpers, lamps, plates
    box(m, 0, 2.62, zf - 0.005, W * 0.62, 0.22, 0.05, [1, 0.62, 0.12], 0, 1);
    box(m, 0, 0.42, zf - 0.03, W * 0.96, 0.2, 0.08, DARK, 0, 0);
    box(m, 0, 0.42, zr + 0.03, W * 0.96, 0.2, 0.08, DARK, 0, 0);
    box(m, 0, 0.66, zf - 0.07, 0.5, 0.11, 0.02, [0.92, 0.92, 0.9], 0, 0);
    [-1, 1].forEach((sd) => {
      box(m, sd * hw * 0.82, 0.78, zf - 0.02, 0.32, 0.2, 0.05, LAMP_HEAD, 0, 1);
      box(m, sd * hw * 0.86, 0.9, zr + 0.015, 0.22, 0.34, 0.05, LAMP_TAIL, 0, 1);
    });
    wheels(m, p);
  }

  /* per-type physical size: L, W, wb (wheelbase), tw (track between wheel centres), wr (wheel radius), vmax range (m/s) */
  const SPEC = {
    hatch: { L: 4.25, W: 1.8, wb: 2.6, wr: 0.31, sill: 0.2, belt: 0.93, roof: 1.47, deck: 0.97, hoodLen: 1.05, wsLen: 0.95, rwLen: 0.5, tail: 0.22, rearBase: 0.0, dual: false },
    sedan: { L: 4.7, W: 1.82, wb: 2.75, wr: 0.32, sill: 0.2, belt: 0.95, roof: 1.45, deck: 0.98, hoodLen: 1.25, wsLen: 1.0, rwLen: 0.85, tail: 1.0, rearBase: 0.15, dual: false },
    estate: { L: 4.72, W: 1.83, wb: 2.8, wr: 0.32, sill: 0.2, belt: 0.95, roof: 1.5, deck: 1.0, hoodLen: 1.2, wsLen: 1.0, rwLen: 0.28, tail: 0.1, rearBase: 0.0, dual: false },
    suv: { L: 4.55, W: 1.92, wb: 2.75, wr: 0.38, sill: 0.3, belt: 1.15, roof: 1.72, deck: 1.18, hoodLen: 1.15, wsLen: 0.9, rwLen: 0.3, tail: 0.12, rearBase: 0.0, dual: false },
    taxi: { L: 4.7, W: 1.82, wb: 2.75, wr: 0.32, sill: 0.2, belt: 0.95, roof: 1.45, deck: 0.98, hoodLen: 1.25, wsLen: 1.0, rwLen: 0.85, tail: 1.0, rearBase: 0.15, dual: false, sign: true },
    van: { L: 5.4, W: 2.0, wb: 3.4, wr: 0.36, H: 2.4, ww: 0.24, dual: true },
    truck: { L: 7.0, W: 2.4, wb: 4.1, wr: 0.46, ww: 0.3, dual: true },
    avl: { L: 12.0, W: 2.55, wb: 5.9, wr: 0.5, ww: 0.3, dual: true },
    rgtr: { L: 12.0, W: 2.55, wb: 5.9, wr: 0.5, ww: 0.3, dual: true },
  };
  SPEC.van.dual = false;   // single rear wheels: keeps the geometry small (twin tyres only matter on the lorry / bus)
  Object.keys(SPEC).forEach((k) => { const q = SPEC[k]; q.ww = q.ww || 0.22; q.tw = q.W + 0.04 - q.ww; });   // wheel centres: the tyre pokes 2 cm out of the body side

  function buildVehicleGeometry(name) {
    const m = new Mesher();
    m.type = TID[name];
    const p = SPEC[name];
    if (name === 'van') van(m, p);
    else if (name === 'truck') lorry(m, p);
    else if (name === 'avl') bus(m, p, true);
    else if (name === 'rgtr') bus(m, p, false);
    else passenger(m, p);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(m.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(m.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(m.c, 3));
    g.setAttribute('aMark', new T.Float32BufferAttribute(m.m, 2));
    g.setIndex(new T.Uint16BufferAttribute(m.i, 1));
    g.computeBoundingSphere();
    return g;
  }

  /* colour pools (body paint, multiplied by lighting) */
  const PAINT = [
    { w: 22, c: [0.9, 0.9, 0.9] }, { w: 22, c: [0.06, 0.06, 0.07] }, { w: 17, c: [0.62, 0.64, 0.66] }, { w: 17, c: [0.33, 0.35, 0.38] },
    { w: 6, c: [0.12, 0.22, 0.46] }, { w: 5, c: [0.55, 0.08, 0.08] }, { w: 3, c: [0.42, 0.36, 0.28] }, { w: 2, c: [0.1, 0.3, 0.18] },
    { w: 3, c: [0.45, 0.58, 0.7] }, { w: 2, c: [0.85, 0.6, 0.12] }, { w: 1, c: [0.5, 0.52, 0.45] },
  ];
  const PAINT_VAN = [{ w: 60, c: [0.92, 0.92, 0.92] }, { w: 14, c: [0.65, 0.67, 0.7] }, { w: 10, c: [0.3, 0.32, 0.35] }, { w: 8, c: [0.15, 0.25, 0.5] }, { w: 5, c: [0.6, 0.1, 0.1] }, { w: 3, c: [0.95, 0.75, 0.1] }];
  const PAINT_TAXI = [{ w: 55, c: [0.92, 0.92, 0.9] }, { w: 25, c: [0.07, 0.07, 0.08] }, { w: 20, c: [0.95, 0.45, 0.1] }];
  const PAINT_RGTR = [{ w: 5, c: [0.72, 0.1, 0.1] }, { w: 3, c: [0.1, 0.12, 0.14] }, { w: 2, c: [0.1, 0.5, 0.25] }];
  const PAINT_WHITE = [{ w: 1, c: [0.93, 0.93, 0.93] }];
  const pick = (rng, pool) => {
    let tot = 0; pool.forEach((e) => { tot += e.w; });
    let r = rng() * tot;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return pool[i].c; }
    return pool[0].c;
  };
  /* type weights by road class */
  const MIX_MAJOR = { hatch: 20, sedan: 14, estate: 12, suv: 18, van: 10, truck: 4, taxi: 5, avl: 9, rgtr: 8 };
  const MIX_MID = { hatch: 22, sedan: 14, estate: 12, suv: 18, van: 9, truck: 3, taxi: 4, avl: 3, rgtr: 3 };
  const MIX_MINOR = { hatch: 30, sedan: 16, estate: 14, suv: 20, van: 7, truck: 1, taxi: 2, avl: 0, rgtr: 0 };
  const pickType = (rng, cls) => {
    const mix = cls <= 2 ? MIX_MAJOR : cls === 3 ? MIX_MID : MIX_MINOR;
    let tot = 0; TYPES.forEach((n) => { tot += mix[n]; });
    let r = rng() * tot;
    for (let i = 0; i < TYPES.length; i++) { r -= mix[TYPES[i]]; if (r <= 0) return TYPES[i]; }
    return 'hatch';
  };
  const paintPool = (type) => (type === 'van' || type === 'truck' ? PAINT_VAN : type === 'taxi' ? PAINT_TAXI : type === 'rgtr' ? PAINT_RGTR : type === 'avl' ? PAINT_WHITE : PAINT);

  function makeMaterial(nightU) {
    const mat = new T.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = nightU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aMark;\nattribute vec3 iBody;\nattribute vec4 iSus;\nattribute vec2 iDim;\nvarying float vGlow;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = color.rgb * mix(vec3(1.0), iBody, aMark.x);\nvGlow = aMark.y;')
        /* suspension: the body is warped by the vertical offsets of its four wheels (front left / right, rear left / right) so every wheel rests on the road even where the surface is not one plane (a rigid body cannot) */
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float su = clamp(position.x / iDim.x * 0.5 + 0.5, 0.0, 1.0); float sv = clamp(position.z / iDim.y * 0.5 + 0.5, 0.0, 1.0); transformed.y += mix(mix(iSus.x, iSus.y, su), mix(iSus.z, iSus.w, su), sv); }')
        ;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uNight * 1.5;');
    };
    mat.customProgramCacheKey = () => 'luxtraffic-v2';
    return mat;
  }


  /* ================================================================ draw-call diet for the oncoming tram
   * The tram model (trains.js) is ~215 draw calls.  The oncoming tram is baked into at most 8 meshes for the WHOLE train (one per material class:
   * body paint, semi-gloss trim, glossy trim, matt, interior, glass, tail lamps, unlit lamps, the amber destination screen).  Every vertex carries its car index; the vertex
   * shader applies that car's matrix (uniform mat4 uCars[n], set from the track frames each frame), so the cars still articulate through curves.
   * Right-hand door leaves keep a per-vertex "open" displacement (aDoorD) driven by one uniform (uDoor).  Decals (name, numbers, screens), seats and
   * other tiny meshes are dropped; their materials are not drawn. */
  const BAKE_CLASSES = ['paint', 'semi', 'trim', 'matt', 'inside', 'glass', 'tail', 'basic', 'dest'];
  const isDestMat = (mat) => !!(mat && mat.isMeshBasicMaterial && mat.map && mat.map.image && mat.map.image.width === 512 && mat.map.image.height === 64);   // the amber LED destination screen (trains.js destTexture)
  function bakeClass(mat) {
    if (isDestMat(mat)) return 'dest';
    if (!mat || mat.map) return null;
    if (mat.transparent) return 'glass';
    if (mat.isMeshBasicMaterial) return 'basic';
    if (!mat.isMeshStandardMaterial) return null;
    if (mat.emissive && mat.emissive.r > 0.6 && mat.emissive.g < 0.3) return 'tail';
    if (!mat.vertexColors) return 'inside';
    if (mat.emissive && mat.emissive.getHex() === 0x4a4a50) return null;           // seats
    if (mat.metalness > 0.6) return 'paint';
    if (mat.roughness >= 0.9) return 'matt';
    if (mat.roughness < 0.5) return 'trim';
    return 'semi';
  }
  function createBake(model, opts) {
    const animDoors = !opts || opts.doors !== false;
    const nCars = model.cars.length;
    const uCars = { value: new Float32Array(nCars * 16) };
    const uDoor = { value: 0 };
    const buckets = new Map();       // class -> { rep, pos[], nor[], col[], car[], door[], idx[] }
    const inv = new T.Matrix4(); const relC = new T.Matrix4(); const relO = new T.Matrix4(); const nm = new T.Matrix3();
    const v = new T.Vector3(); const v2 = new T.Vector3();
    const meshes = []; const mats = []; const srcOf = [];
    let done = false;
    for (let i = 0; i < nCars; i++) uCars.value.set(new T.Matrix4().elements, i * 16);

    function addCar(car, carIndex) {
      const g = car.group;
      const objs = []; g.traverse((o) => { if (o !== g) objs.push(o); });
      // 1. which objects move when the right doors open?
      model.setDoors(0, 'right'); const p0 = objs.map((o) => [o.position.x, o.position.y, o.position.z]);
      model.setDoors(1, 'right'); const p1 = objs.map((o) => [o.position.x, o.position.y, o.position.z]);
      const moving = new Set();
      if (animDoors) objs.forEach((o, i) => { if (Math.abs(p0[i][0] - p1[i][0]) + Math.abs(p0[i][1] - p1[i][1]) + Math.abs(p0[i][2] - p1[i][2]) > 1e-5) moving.add(o); });
      const isMoving = (o) => { for (let q = o; q && q !== g; q = q.parent) if (moving.has(q)) return true; return false; };
      // 2. matrices with the doors open (moving meshes only), then closed
      const openM = new Map();
      if (moving.size) {
        g.updateMatrixWorld(true); inv.copy(g.matrixWorld).invert();
        g.traverse((o) => { if (o.isMesh && isMoving(o)) openM.set(o, new T.Matrix4().multiplyMatrices(inv, o.matrixWorld)); });
      }
      model.setDoors(0, 'right');
      g.updateMatrixWorld(true); inv.copy(g.matrixWorld).invert();
      g.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry) return;
        const geo = o.geometry; const posA = geo.attributes.position; if (!posA) return;
        relC.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(relC);
        const mo = openM.get(o); if (mo) relO.copy(mo);
        const mats0 = Array.isArray(o.material) ? o.material : [o.material];
        const groups = Array.isArray(o.material) ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : posA.count, materialIndex: 0 }];
        const nA = geo.attributes.normal; const cA = geo.attributes.color;
        groups.forEach((gr) => {
          const mat = mats0[gr.materialIndex]; if (!mat || !mat.color) return;   // shader effects (lamp beams, windscreen drops) are not baked
          const cls = bakeClass(mat); if (!cls) return;
          let b = buckets.get(cls); if (!b) { b = { rep: mat, pos: [], nor: [], col: [], car: [], door: [], idx: [], uv: [] }; buckets.set(cls, b); }
          const remap = new Map();
          const mc = mat.color; const bake = cls === 'glass' || !mat.vertexColors || (mc.r !== 1 || mc.g !== 1 || mc.b !== 1);
          for (let k = gr.start; k < gr.start + gr.count; k++) {
            const sv = geo.index ? geo.index.getX(k) : k;
            let nv = remap.get(sv);
            if (nv === undefined) {
              nv = b.pos.length / 3; remap.set(sv, nv);
              v.fromBufferAttribute(posA, sv).applyMatrix4(relC); b.pos.push(v.x, v.y, v.z);
              if (mo) { v2.fromBufferAttribute(posA, sv).applyMatrix4(relO); b.door.push(v2.x - v.x, v2.y - v.y, v2.z - v.z); } else b.door.push(0, 0, 0);
              if (nA) { v.fromBufferAttribute(nA, sv).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z); } else b.nor.push(0, 1, 0);
              let r = 1; let gg = 1; let bb = 1;
              if (cA && mat.vertexColors) { r = cA.getX(sv); gg = cA.getY(sv); bb = cA.getZ(sv); }
              if (bake) { r *= mc.r; gg *= mc.g; bb *= mc.b; }
              b.col.push(r, gg, bb); b.car.push(carIndex);
              if (cls === 'dest') { const uvA = geo.attributes.uv; b.uv.push(uvA ? uvA.getX(sv) : 0, uvA ? uvA.getY(sv) : 0); }
            }
            b.idx.push(nv);
          }
        });
        o.visible = false;
      });
      // the car's own meshes are replaced: hide everything else of it too (decals, seats, wipers, ...)
      g.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints) o.visible = false; });
    }

    function finish(rootGroup) {
      const patch = (m) => {
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uCars = uCars; sh.uniforms.uDoor = uDoor;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aCar;\nattribute vec3 aDoorD;\nuniform mat4 uCars[' + nCars + '];\nuniform float uDoor;')
            .replace('void main() {', 'void main() {\nmat4 lxCar = uCars[int(aCar + 0.5)];')
            .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(lxCar) * objectNormal;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aDoorD * uDoor;\ntransformed = (lxCar * vec4(transformed, 1.0)).xyz;');
        };
        m.customProgramCacheKey = () => 'luxtraffic-tram-' + nCars;
      };
      buckets.forEach((b, cls) => {
        if (!b.idx.length) return;
        const src = b.rep; const mat = src.clone();
        if (cls !== 'dest') { mat.vertexColors = true; mat.color.setRGB(1, 1, 1); mat.map = null; }
        if (cls === 'glass') { mat.opacity = 0.74; mat.transparent = true; }
        patch(mat);
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
        bg.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3));
        bg.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
        bg.setAttribute('aCar', new T.Float32BufferAttribute(b.car, 1));
        bg.setAttribute('aDoorD', new T.Float32BufferAttribute(b.door, 3));
        if (cls === 'dest') bg.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
        bg.setIndex(b.pos.length / 3 > 65535 ? new T.Uint32BufferAttribute(b.idx, 1) : new T.Uint16BufferAttribute(b.idx, 1));
        const mesh = new T.Mesh(bg, mat);
        mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false; mesh.name = 'luxtram-oncoming-' + cls;
        mesh.renderOrder = cls === 'glass' ? 2 : 0;
        rootGroup.add(mesh);
        meshes.push(mesh); mats.push(mat); srcOf.push(src);
      });
      buckets.clear();
      done = true;
    }
    return {
      addCar, finish, uCars, uDoor,
      get done() { return done; },
      setVisible: (vis) => { for (let i = 0; i < meshes.length; i++) meshes[i].visible = vis; },
      meshesVisible: () => meshes.length > 0 && meshes.some((m) => m.visible),
      drawCalls: () => meshes.length,
      /* copy the live light state of the source materials (setLights changes emissive / emissiveIntensity) onto the baked clones */
      syncLights: () => { for (let i = 0; i < mats.length; i++) { const s = srcOf[i]; if (s.emissive) mats[i].emissive.copy(s.emissive); if (s.emissiveIntensity !== undefined) mats[i].emissiveIntensity = s.emissiveIntensity; } },
      dispose: (rootGroup) => { meshes.forEach((m) => { rootGroup.remove(m); m.geometry.dispose(); }); mats.forEach((m) => m.dispose()); },
    };
  }

  /* ================================================================ module */
  function create(ctx) {
    const { root, Q, roadsByChunk, gy, nearest, hasOpp, oppLatAt, roadMarginExcept, track } = ctx;
    const rawG = ctx.rawG || gy;
    /* ROUTE identity (never the momentary driving direction): on the return routes (<id>~r) the player runs on the left-hand track (track.opposite) and the oncoming
       trams on the forward track; on the forward routes the other way round.  The reverser (R) only flips player.dir, it must never move a tram onto the player's track. */
    const routeReverse = !!ctx.routeReverse;
    const quality = ctx.quality || 'medium';
    const nightFn = ctx.night || (() => 0);
    const mats = [];
    const rng = mulberry(77);
    let disposed = false;

    /* height under a wheel: the ground's road-surface query when the world provides it, else the plain terrain height.  NaN = not known yet */
    const surfaceAt = ctx.roadHeightAt
      ? (x, z, onBridge, refY, hx, hz) => ctx.roadHeightAt(x, z, !!onBridge, false, refY, hx, hz)
      : (x, z) => gy(x, z);
    const roadAt = ctx.roadHeightAt ? (x, z) => ctx.roadHeightAt(x, z, false, true) : null;   // carriageway only (NaN beside it)

    /* ---- vehicle meshes: one InstancedMesh per type (a draw call only for the types that are on screen) */
    const cap = Math.max(1, Q.cars);
    const nightU = { value: 0 };
    const matVeh = makeMaterial(nightU);
    mats.push(matVeh);
    const veh = TYPES.map((name) => {
      const geo = buildVehicleGeometry(name);
      const body = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      body.setUsage(T.DynamicDrawUsage); geo.setAttribute('iBody', body);
      const sus = new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4); sus.setUsage(T.DynamicDrawUsage); geo.setAttribute('iSus', sus);
      const dim = new T.InstancedBufferAttribute(new Float32Array(cap * 2), 2); dim.setUsage(T.DynamicDrawUsage); geo.setAttribute('iDim', dim);
      const mesh = new T.InstancedMesh(geo, matVeh, cap);
      mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.name = 'luxtram-traffic-' + name;
      root.add(mesh);
      return { name, geo, body, sus, dim, mesh, n: 0 };
    });

    /* ---- signal posts at the tram crossings */
    const lampGeo = new T.BoxGeometry(0.34, 0.34, 0.34);
    const lampMat = new T.MeshBasicMaterial({ color: 0xffffff });
    mats.push(lampMat);
    const lampMesh = new T.InstancedMesh(lampGeo, lampMat, 160);
    lampMesh.frustumCulled = false; lampMesh.count = 0;
    lampMesh.setColorAt(0, new T.Color('#33e06c'));
    root.add(lampMesh);
    const lampPostGeo = new T.CylinderGeometry(0.07, 0.07, 3.4, 5);
    const lampPostMat = new T.MeshLambertMaterial({ color: 0x3a3f44 });
    mats.push(lampPostMat);
    const lampPosts = new T.InstancedMesh(lampPostGeo, lampPostMat, 160);
    lampPosts.frustumCulled = false; lampPosts.count = 0;
    root.add(lampPosts);
    const RED = new T.Color('#ff2a18'); const GREEN = new T.Color('#33e06c');
    const crossings = [];            // { rd, c (cross record), red, lamps: [lamp] }
    let lampList = [];               // { i, x, z, y (NaN until the height is known), rec }
    let crossPosts = [];             // post positions (test hook)
    let carDirty = true;

    /* ---- scratch objects (no per-frame allocation) */
    const cm = new T.Matrix4(); const cq = new T.Quaternion(); const cX = new T.Vector3(); const cY = new T.Vector3(); const cZ = new T.Vector3();
    const tmpV = new T.Vector3(); const cs1 = new T.Vector3(1, 1, 1);
    const sp = { x: 0, z: 0, dx: 0, dz: 0 }; const spF = { x: 0, z: 0, dx: 0, dz: 0 }; const spR = { x: 0, z: 0, dx: 0, dz: 0 };
    const frustum = new T.Frustum(); const pvm = new T.Matrix4(); const sph = new T.Sphere();
    const tmpFrame = { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0), grade: 0, curvature: 0 };
    let haveFrustum = false;
    /* ---- safety net: does a drawn surface really sit under the car?  (down-ray against the meshes of its tile: terrain, ground decor incl. bridge decks, caps) */
    const rc = new T.Raycaster(); const rayDown = new T.Vector3(0, -1, 0); const rayO = new T.Vector3(); const rayHits = []; const surfList = [];
    const SURF_TOL = 0.3;
    let guardBudget = 0;
    function surfaceMeshesAt(x, z) {
      surfList.length = 0;
      const t = ctx.tileOf ? ctx.tileOf(x, z) : null;
      if (!t || !t.group) return surfList;
      const ch = t.group.children;
      for (let i = 0; i < ch.length; i++) if (ch[i] !== t.bgroup && ch[i] !== t.tgroup) surfList.push(ch[i]);
      return surfList;
    }
    /* true = a surface within +-SURF_TOL of y, false = none (floating / buried), null = cannot tell (no tile data) */
    function surfaceCheck(x, y, z) {
      const list = surfaceMeshesAt(x, z);
      if (!list.length) return null;
      rayO.set(x, y + 1.3, z); rc.set(rayO, rayDown); rc.near = 0; rc.far = 1.3 + SURF_TOL + 0.8;
      rayHits.length = 0;
      rc.intersectObjects(list, true, rayHits);
      for (let i = 0; i < rayHits.length; i++) if (Math.abs(rayHits[i].point.y - y) <= SURF_TOL && rayHits[i].object.visible) return true;      // (a hidden mesh is no surface)
      return false;
    }
    /* ---- structure guard: a road vehicle never stands on / inside the tram infrastructure that is no road (platform pads, station furniture, tram bridge deck, rails outside a level crossing).
       Down-rays from just above every wheel against the infrastructure group; a hit from 0.8 m above to 0.5 m below the wheel is a conflict. */
    const infraRc = new T.Raycaster(); const infraHits = []; const wMat = new T.Matrix4(); const wV = new T.Vector3();
    const STRUCT_UP = 0.8; const STRUCT_DOWN = 0.5;
    let infraList = []; let infraLook = -1e9;
    function infraRoot(now) {
      if (infraList.length && now - infraLook < 3000 && infraList.every((o) => o.parent)) return infraList;      // (tiles / chunks stream in and out: re-read every 3 s)
      if (now - infraLook < 1000) return infraList;
      infraLook = now; infraList = []; let top = root; while (top.parent) top = top.parent;
      top.children.forEach((o) => {
        if (o.name === 'train-sim-infra') infraList.push(o);
        else if (o.name === 'luxtram-world') o.children.forEach((q) => { if (/^lt-chunk/.test(q.name || '')) infraList.push(q); });      // (the world chunks: viaduct walls, track bed, parapets)
      });
      return infraList;
    }
    function structureClear(c, now) {
      const gl = infraRoot(now); if (!gl.length) return true;
      const rd = c.rd; const m = c.spec.L / 2 + 3;
      if ((rd.cross || []).some((q) => c.t > q.t0 - m && c.t < q.t1 + m) || (rd.along || []).some((a) => c.t > a[0] - m && c.t < a[1] + m)) return true;     // (the rails of a level crossing are meant to be driven over)
      wMat.fromArray(c.mat); const sp0 = c.spec;
      for (let k = 0; k < 5; k++) {
        if (k < 4) wV.set((k & 1 ? 1 : -1) * sp0.tw / 2, 0, (k & 2 ? 1 : -1) * sp0.wb / 2); else wV.set(0, 0, 0);
        wV.applyMatrix4(wMat);
        const wy = wV.y + (k < 4 && c.sus ? c.sus[k] : 0);
        rayO.set(wV.x, wy + STRUCT_UP, wV.z); infraRc.set(rayO, rayDown); infraRc.near = 0; infraRc.far = STRUCT_UP + STRUCT_DOWN;
        infraHits.length = 0; infraRc.intersectObjects(gl, true, infraHits);
        for (let i = 0; i < infraHits.length; i++) {
          const o = infraHits[i].object;
          if (!o.visible || o.isInstancedMesh || o.isSprite || o.isLine || o.isPoints || (o.material && o.material.transparent && o.material.opacity < 0.5)) continue;
          return false;
        }
      }
      return true;
    }
    const inView = (x, y, z, r) => { if (!haveFrustum) return true; sph.center.set(x, y, z); sph.radius = r; return frustum.intersectsSphere(sph); };

    /* ---- roads */
    function sample(rd, tt, out) {
      const c = clamp(tt, 0, rd.len);
      const cum = rd.cum;
      let lo = 1; let hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < c) lo = mid + 1; else hi = mid; }
      const a = rd.pts[lo - 1]; const b = rd.pts[lo];
      const seg = cum[lo] - cum[lo - 1] || 1; const u = (c - cum[lo - 1]) / seg;
      const dx = b.x - a.x; const dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1;
      out.x = lerp(a.x, b.x, u); out.z = lerp(a.z, b.z, u); out.dx = dx / dl; out.dz = dz / dl;
      return out;
    }
    const roadPoint = (rd, tt) => sample(rd, tt, { x: 0, z: 0, dx: 0, dz: 0 });   // (rebuild only)

    /* road graph: vertices by 1.5 m cell, to continue through junctions */
    const CELL = 1.5;
    let vertCells = new Map();
    let roadSet = new Set();
    let roadList = [];
    let roadWeightTotal = 0;
    function rebuildGraph() {
      vertCells = new Map(); roadSet = new Set(); roadList = []; roadWeightTotal = 0;
      roadsByChunk.forEach((roads) => roads.forEach((rd) => {
        if (rd.bridge && !CARS_ON_BRIDGES) return;
        roadSet.add(rd); roadList.push(rd);
        rd.w = rd.len * (rd.cls === 0 ? 0.5 : rd.cls <= 2 ? 1.6 : rd.cls === 3 ? 1.2 : 1);
        roadWeightTotal += rd.w;
        rd.pts.forEach((p, j) => {
          const key = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL);
          const l = vertCells.get(key); const e = { rd, j };
          if (l) l.push(e); else vertCells.set(key, [e]);
        });
      }));
    }
    const nextOpts = [];
    function nextRoad(car, exRd, exJ, ex, ez, hx, hz) {
      // candidate continuations at the end point (ex, ez), heading (hx, hz)
      nextOpts.length = 0;
      const cx = Math.floor(ex / CELL); const cz = Math.floor(ez / CELL);
      let tot = 0;
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const l = vertCells.get(ix + ',' + iz);
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const e = l[k]; const rd = e.rd; const p = rd.pts[e.j];
          if (Math.hypot(p.x - ex, p.z - ez) > 1.3) continue;
          if (rd === exRd && e.j === exJ) continue;          // the vertex we are leaving
          const last = rd.pts.length - 1;
          for (let d = 1; d >= -1; d -= 2) {
            if (d === 1 && e.j >= last) continue;
            if (d === -1 && (e.j <= 0 || rd.oneway)) continue;
            const q = rd.pts[e.j + d]; const dl = Math.hypot(q.x - p.x, q.z - p.z) || 1;
            const nx = ((q.x - p.x) / dl); const nz = ((q.z - p.z) / dl);
            const cos = nx * hx + nz * hz;
            if (cos < -0.6) continue;
            const w = 0.25 + Math.max(0, cos) * 1.5 + (rd.cls <= car.rd.cls ? 0.3 : 0);
            nextOpts.push({ rd, t: rd.cum[e.j], dir: d, w }); tot += w;
          }
        }
      }
      if (!nextOpts.length) return null;
      let r = Math.random() * tot;
      for (let i = 0; i < nextOpts.length; i++) { r -= nextOpts[i].w; if (r <= 0) return nextOpts[i]; }
      return nextOpts[0];
    }

    /* ---- trams (player + oncoming) as red-light triggers: { s (front), dir (+1 = towards larger s), len } */
    const trams = [];
    const player = { s: -1e9, dir: 1, len: TRAM_LEN_FALLBACK, active: true };
    trams.push(player);
    const redFor = (cs) => {
      for (let i = 0; i < trams.length; i++) {
        const tr = trams[i];
        if (!tr.active) continue;
        const ahead = (cs - tr.s) * tr.dir;                   // metres from the front to the crossing (> 0 approaching)
        const tail = tr.s - tr.dir * tr.len;
        const passed = (cs - tail) * tr.dir;                  // > 0 while the tail has not reached the crossing yet
        if (ahead < RED_AHEAD && passed > -RED_AFTER) return true;
      }
      return false;
    };

    /* ---- cars */
    let cars = [];
    let lastRebuildMs = 0;
    let fillUntil = 0;
    let tramX = 0; let tramZ = 0; let tramY = 0;
    const R_ACT = clamp(Q.ahead ? Q.ahead * 0.6 : 400, 240, 560);
    function newCar() {
      return { rd: null, t: 0, dir: 1, vmax: 10, cur: 0, type: 'hatch', tid: 0, body: [1, 1, 1], spec: SPEC.hatch, active: false, shown: false, x: 0, z: 0, i: 0, wait: 0, since: 1e9, chkRd: null, laneRd: null, laneK: 1, mway: false, laneIdx: 0, latCur: NaN, mat: new Float32Array(16) };
    }
    function assignType(c, cls) {
      c.type = pickType(rng, cls); c.tid = TID[c.type]; c.spec = SPEC[c.type]; c.body = pick(rng, paintPool(c.type));
      assignSpeed(c, { cls, oneway: false, hw: 99 });
    }
    /* speed and lane rank of a car on road `rd`.  City streets: 27-49 km/h.  Motorway carriageways (class 0, one way): right lane 76-90 km/h (lorries and buses never
       faster than 78), middle ~94, left ~103 km/h.  `laneIdx` (0 = the rightmost lane) picks the lane among however many lanes the DRAWN carriageway has at the car's
       position (laneCentres): cars drive in the middle of a lane, never on a divider line. */
    function assignSpeed(c, rd) {
      const cls = rd.cls;
      const heavy = c.type === 'avl' || c.type === 'rgtr' || c.type === 'truck';
      if (cls === 0 && rd.oneway) {
        const lanes = rd.hw >= 4.8 ? 3 : 2;
        const idx = heavy ? 0 : Math.floor(rng() * lanes);
        c.laneIdx = idx;
        c.mway = true;
        c.vmax = heavy ? 20.5 + rng() * 1.2 : (lanes === 3 ? [23.5, 26.2, 28.8][idx] : [24.5, 28.5][idx]) * (0.97 + rng() * 0.06);
        return;
      }
      c.mway = false;
      c.laneIdx = heavy || rng() < 0.7 ? 0 : 1;   // (counted from the rightmost lane; a one-lane street only has lane 0)
      c.vmax = heavy && c.type !== 'truck' ? 7 + rng() * 3 : c.type === 'truck' ? 7 + rng() * 3 : 7.5 + rng() * 6 + (cls <= 2 ? 1.5 : 0);
    }
    function pickRoad() {
      if (!roadList.length) return null;
      let r = rng() * roadWeightTotal;
      for (let i = 0; i < roadList.length; i++) { r -= roadList[i].w; if (r <= 0) return roadList[i]; }
      return roadList[roadList.length - 1];
    }
    const isBad = (rd, t, now) => {
      const b = rd.bad; if (!b) return false;
      for (let i = b.length - 1; i >= 0; i--) { if (b[i][2] < now) { b.splice(i, 1); continue; } if (t > b[i][0] && t < b[i][1]) return true; }
      return false;
    };
    function onRailsAt(rd, t) {
      return (rd.along || []).some((a) => t > a[0] - 2 && t < a[1] + 2) || (rd.cross || []).some((q) => t > q.t0 - 3 && t < q.t1 + 3);
    }
    /* place a car on a random road, out of the camera's sight (and within the active radius of the tram) */
    const fails = { rails: 0, dist: 0, height: 0, view: 0, clash: 0 };
    function spawnCar(c, now) {
      const filling = now < fillUntil;
      for (let attempt = 0; attempt < 10; attempt++) {
        const rd = pickRoad();
        if (!rd) return false;
        if (rd.cls === 0) { let mw = 0; for (let k = 0; k < cars.length; k++) if (cars[k].active && cars[k].rd && cars[k].rd.cls === 0) mw++; if (mw >= Math.ceil(cars.length * 0.55)) { fails.mway = (fails.mway || 0) + 1; continue; } }   // the motorway never takes more than ~55 % of the cars: the streets stay busy
        const t = rng() * rd.len;
        if (onRailsAt(rd, t) || isBad(rd, t, now)) { fails.rails++; continue; }
        sample(rd, t, sp);
        const d = Math.hypot(sp.x - tramX, sp.z - tramZ);
        if (filling ? (d > R_ACT) : (d < R_ACT * 0.45 || d > R_ACT * 0.97)) { fails.dist++; continue; }
        const gh = surfaceAt(sp.x, sp.z, rd.bridge, undefined, sp.dx, sp.dz);
        if (gh !== gh) { fails.height++; continue; }
        if (!filling && d < R_ACT * 0.8 && inView(sp.x, gh + 1, sp.z, 9)) { fails.view++; continue; }   // far out (a few pixels) nobody sees a car appear
        let clash = false;
        for (let k = 0; k < cars.length; k++) { const o = cars[k]; if (o !== c && o.active && o.rd === rd && Math.abs(o.t - t) < 16) { clash = true; break; } }
        if (clash) continue;
        c.rd = rd; c.t = t; c.dir = rd.oneway ? 1 : (rng() < 0.5 ? 1 : -1);
        assignType(c, rd.cls);
        if (!rd.oneway && rd.hw < c.spec.W + 0.22) { c.type = 'hatch'; c.tid = TID.hatch; c.spec = SPEC.hatch; c.body = pick(rng, paintPool('hatch')); }   // a lorry / bus does not fit two lanes of a narrow street: no oncoming overlap
        assignSpeed(c, rd);
        c.latCur = NaN; c.cur = c.vmax * 0.7; c.active = true; c.shown = false; c.since = 1e9; c.chkRd = null; c.x = sp.x; c.z = sp.z; c.y = NaN;
        return true;
      }
      return false;
    }

    function rebuild() {
      carDirty = false;
      edgeCache.clear();
      rebuildGraph();
      // crossings + signal posts
      crossings.length = 0; lampList = []; crossPosts = [];
      let lampN = 0;
      roadList.forEach((rd) => {
        if (!rd.cross || !rd.cross.length) return;
        rd.cross.forEach((c) => {
          const rec = { rd, c, red: false, lamps: [], dirty: true };
          crossings.push(rec);
          [c.t0 - 3.2, c.t1 + 3.2].forEach((tt0, side) => {
            if (lampN >= 160) return;
            const sgn = side === 0 ? 1 : -1;
            // the post stands at the kerb of its own road; at a junction that spot can be another road's lane (or the other track): slide it away until it is clear
            let lx = 0; let lz = 0; let clear = false;
            for (let k = 0; k < 7 && !clear; k++) {
              const tt = tt0 + (side === 0 ? -1 : 1) * k * 2.5;
              if (tt < 0 || tt > rd.len) break;
              const p = roadPoint(rd, tt);
              lx = p.x + -p.dz * sgn * (rd.hw + 0.7); lz = p.z + p.dx * sgn * (rd.hw + 0.7);
              const nq = nearest(lx, lz);
              clear = roadMarginExcept(lx, lz, rd) > 0.35 && nq.d > 4.4 && (!hasOpp || Math.abs(nq.lat - oppLatAt(nq.s)) > 2.6);
            }
            if (!clear) return;
            const lamp = { i: lampN, x: lx, z: lz, y: NaN, rec };
            lampList.push(lamp); rec.lamps.push(lamp);
            crossPosts.push({ x: lx, z: lz });
            cm.makeScale(0, 0, 0); lampPosts.setMatrixAt(lampN, cm); lampMesh.setMatrixAt(lampN, cm);
            lampN++;
          });
        });
      });
      lampPosts.count = lampN; lampMesh.count = lampN;
      lampPosts.instanceMatrix.needsUpdate = true; lampMesh.instanceMatrix.needsUpdate = true;
      // cars: keep the ones whose road still exists, add the missing ones
      cars.forEach((c) => { if (c.active && !roadSet.has(c.rd)) { c.active = false; c.shown = false; } });
      while (cars.length < Q.cars) cars.push(newCar());
      if (fillUntil === 0 && roadList.length) fillUntil = performance.now() + 2500;
    }
    function resolveLamps() {
      let changed = false;
      for (let i = 0; i < lampList.length; i++) {
        const l = lampList[i];
        if (l.y === l.y) continue;
        const h = surfaceAt(l.x, l.z);
        if (h !== h) continue;
        l.y = h;
        cm.makeTranslation(l.x, h + 1.7, l.z); lampPosts.setMatrixAt(l.i, cm);
        l.rec.dirty = true; changed = true;
      }
      if (changed) lampPosts.instanceMatrix.needsUpdate = true;
    }

    function updateCrossings() {
      for (let k = 0; k < crossings.length; k++) {
        const cr = crossings[k];
        const red = redFor(cr.c.s);
        if (red === cr.red && !cr.dirty) continue;
        cr.red = red; cr.dirty = false;
        for (let i = 0; i < cr.lamps.length; i++) {
          const l = cr.lamps[i];
          if (l.y !== l.y) continue;
          cm.makeTranslation(l.x, l.y + 3.2, l.z); lampMesh.setMatrixAt(l.i, cm); lampMesh.setColorAt(l.i, red ? RED : GREEN);
        }
        lampMesh.instanceMatrix.needsUpdate = true; if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
      }
    }

    /* ---- lanes from the DRAWN carriageway (the OSM width / lane count do not match what luxtram-ground paints): from the road axis the road-only height query is scanned
       sideways until the asphalt ends; the width splits into lanes of ~3.4 m and a car drives on the centre line of its lane */
    const edgeCache = new Map(); let rdUid = 0;
    const paintAt = ctx.paintAt || null;
    const LANE_MIN = 2.5;                // narrowest interval between two lines that is a lane
    function edgesAt(rd, t) {
      if (!roadAt || rd.bridge === true) return null;       // (a deck: the ground road query there would measure the street UNDER the bridge; decks use the nominal lanes, which match the lane markings drawn on them)
      if (rd.uid === undefined) rd.uid = ++rdUid;
      const bk = Math.floor(clamp(t, 0, rd.len) / 12);
      const key = rd.uid * 8192 + bk;
      const hit = edgeCache.get(key);
      if (hit) return hit;
      const tc = clamp(bk * 12 + 6, 0, rd.len);
      sample(rd, tc, spE);
      const nx = -spE.dz; const nz = spE.dx; const ox = spE.x; const oz = spE.z; const dx0 = spE.dx; const dz0 = spE.dz;
      const h0 = roadAt(ox, oz);
      if (h0 !== h0) return null;                       // tile not decorated / the axis is not on the drawn asphalt: use the nominal lanes (not cached)
      const cap = Math.max(6, rd.hw * 1.5 + 2);
      const scan = (sg) => { let last = 0; for (let d = 0.5; d <= cap; d += 0.5) { const h = roadAt(ox + nx * sg * d, oz + nz * sg * d); if (h !== h || Math.abs(h - h0) > 0.6) break; last = d; } return last + 0.25; };
      const e = { er: scan(1), el: scan(-1), lines: [] };
      if (paintAt) {
        // painted lines across the road: sampled at 4 places along 10 m (dashed dividers have gaps), 0.2 m apart sideways
        const hits = [];
        for (let u = -e.el + 0.4; u <= e.er - 0.4; u += 0.2) {
          let on = 0;
          for (let k = -4; k <= 5; k += 3) { if (paintAt(ox + dx0 * k + nx * u, oz + dz0 * k + nz * u)) { on = 1; break; } }
          if (on) hits.push(u);
        }
        let i = 0;
        while (i < hits.length) { let j = i; while (j + 1 < hits.length && hits[j + 1] - hits[j] < 0.5) j++; e.lines.push((hits[i] + hits[j]) / 2); i = j + 1; }
      }
      edgeCache.set(key, e);
      return e;
    }
    const spE = { x: 0, z: 0, dx: 0, dz: 0 };
    /* lane centre lines as metres to the RIGHT of the travel direction, rightmost lane first; null = no drawn edges known.  Boundaries = the drawn asphalt edges + the painted lines
       between them; an interval narrower than LANE_MIN is not a lane, one wider than 1.8 lanes is split evenly (no divider painted). */
    function laneCentres(rd, t, dir) {
      const e = edgesAt(rd, t);
      if (!e) return null;
      const b = [-e.el]; e.lines.forEach((u) => { if (u > -e.el + 0.8 && u < e.er - 0.8) b.push(u); }); b.push(e.er);   // (a line close to the edge is the edge line)
      const lanes = [];                                  // lane centres as right-of-tangent coordinates, left to right
      for (let i = 0; i + 1 < b.length; i++) {
        const w = b[i + 1] - b[i];
        if (w < LANE_MIN) continue;
        const n = w > 5.9 ? Math.round(w / 3.4) : 1;
        for (let k = 0; k < n; k++) lanes.push(b[i] + (k + 0.5) * w / n);
      }
      if (!lanes.length) return null;
      if (rd.oneway) return lanes.slice().reverse();     // one way = along the tangent: right of travel = right of the tangent; rightmost first
      if (dir > 0) { const r = lanes.filter((u) => u > 0.4).reverse(); return r.length ? r : null; }
      const l = lanes.filter((u) => u < -0.4).map((u) => -u);   // against the tangent: right of travel = left of the tangent; rightmost (most negative u) first
      return l.length ? l : null;
    }
    let curDt = 0.016;
    /* nominal lane (no drawn edges yet): a third of the half width, wide enough that cars passing in opposite directions do not overlap, inside the carriageway */
    const nominalOffset = (rd, spec, c) => {
      const half = spec.W / 2;
      const limit = Math.max(0.3, rd.hw - half - 0.08);
      if (c && c.mway && rd.cls === 0 && rd.oneway) { const lanes = rd.hw >= 4.8 ? 3 : 2; const idx = Math.min(lanes - 1, c.laneIdx); return clamp((lanes === 3 ? [0.62, 0, -0.62][idx] : [0.5, -0.5][idx]) * rd.hw, -limit, limit); }
      const want = Math.max(rd.hw * LANE_K, half + 0.14);
      return Math.min(want, limit);
    };
    /* ground the car on its four wheel contact points; false = height unknown (hide) */
    function groundCar(c, dir, now) {
      const rd = c.rd; const sp0 = c.spec;
      if (c.laneRd !== rd) { c.laneRd = rd; c.laneK = 1; }       // lane factor (nominal lanes only): shrinks towards the road axis while a wheel stands on the kerb / pavement beside the asphalt
      const lc = laneCentres(rd, c.t, dir);
      let lane;
      if (lc) {
        const tgt = lc[Math.min(lc.length - 1, c.laneIdx)];
        c.latCur = c.latCur === c.latCur ? c.latCur + clamp(tgt - c.latCur, -2.5 * curDt, 2.5 * curDt) : tgt;   // lane changes (a lane appears / ends) are eased
        lane = c.latCur * dir;
      } else {
        c.latCur = nominalOffset(rd, sp0, c) * c.laneK;
        lane = c.latCur * dir;
      }
      const tf = c.t + dir * sp0.wb / 2; const tr = c.t - dir * sp0.wb / 2;
      sample(rd, tf, spF); sample(rd, tr, spR);
      // front and rear axle centres on the lane (the lane offset follows each point's own tangent: smooth through bends)
      const fX = spF.x + -spF.dz * lane; const fZ = spF.z + spF.dx * lane;
      const rX = spR.x + -spR.dz * lane; const rZ = spR.z + spR.dx * lane;
      // (spF / spR are already "front / rear" in the travelling sense: tf = t + dir * wb / 2)
      let hx = fX - rX; let hz = fZ - rZ;
      const hl = Math.hypot(hx, hz);
      if (hl < 0.05) { hx = spF.dx * dir; hz = spF.dz * dir; } else { hx /= hl; hz /= hl; }
      const rx = -hz; const rz = hx;                           // right of travel (scene coordinates, see the model frame)
      const fCx = fX; const fCz = fZ; const bCx = rX; const bCz = rZ;
      const hwT = sp0.tw / 2;
      const ob = rd.bridge === true;
      const refY = c.y === c.y ? c.y - ROAD_LIFT : undefined;       // a car stays on the deck / ramp / plug nearest to its own height (stacked ramps of an interchange)
      // wheel contact positions (x, z): FL, FR, RL, RR; the second pass moves them to where the tilted body really puts its wheels (on a bank the wheels sit closer together than the lane sample points)
      const wxz = [fCx - rx * hwT, fCz - rz * hwT, fCx + rx * hwT, fCz + rz * hwT, bCx - rx * hwT, bCz - rz * hwT, bCx + rx * hwT, bCz + rz * hwT];
      const wbL = Math.hypot(fCx - bCx, fCz - bCz) || sp0.wb;
      const hzW = wbL / 2;
      const su = c.sus || (c.sus = [0, 0, 0, 0]);
      for (let pass = 0; pass < 2; pass++) {
        const hFL = surfaceAt(wxz[0], wxz[1], ob, refY, hx, hz); const hFR = surfaceAt(wxz[2], wxz[3], ob, refY, hx, hz);
        const hRL = surfaceAt(wxz[4], wxz[5], ob, refY, hx, hz); const hRR = surfaceAt(wxz[6], wxz[7], ob, refY, hx, hz);
        if (hFL !== hFL || hFR !== hFR || hRL !== hRL || hRR !== hRR) { if (pass === 0) return false; break; }
        if (pass === 0 && Math.max(hFL, hFR, hRL, hRR) - Math.min(hFL, hFR, hRL, hRR) > WHEEL_SPREAD_MAX) {
          // the four wheels stand on ground that differs by more than WHEEL_SPREAD_MAX (a cliff / a portal cutting the road crosses / a deck end with a step, no drivable surface): nobody drives here
          if (!rd.bad) rd.bad = [];
          rd.bad.push([c.t - 14, c.t + 14, now + 90000]); c.active = false; c.shown = false;
          return false;
        }
        if (pass === 0 && !ob && roadAt) {
          // a wheel off the asphalt (kerb, pavement, bank) although the road axis is asphalt: steer the lane towards the axis, 2 % of the half width per frame
          const off = roadAt(wxz[0], wxz[1]) !== roadAt(wxz[0], wxz[1]) || roadAt(wxz[2], wxz[3]) !== roadAt(wxz[2], wxz[3]) || roadAt(wxz[4], wxz[5]) !== roadAt(wxz[4], wxz[5]) || roadAt(wxz[6], wxz[7]) !== roadAt(wxz[6], wxz[7]);
          if (off && c.laneK > 0.3 && roadAt(spF.x, spF.z) === roadAt(spF.x, spF.z)) c.laneK = Math.max(0.3, c.laneK - 0.02);
        }
        // (every wheel stands on its own drawn surface - road, sidewalk, bare terrain: the suspension warp of the body takes the difference)
        const yFL = hFL + ROAD_LIFT; const yFR = hFR + ROAD_LIFT; const yRL = hRL + ROAD_LIFT; const yRR = hRR + ROAD_LIFT;
        // orientation: forward from the rear to the front axle, right from the lateral slope
        cZ.set(-(fCx - bCx), -((yFL + yFR) / 2 - (yRL + yRR) / 2), -(fCz - bCz)).normalize();    // local +Z = backwards
        tmpV.set(rx, ((yFR + yRR) / 2 - (yFL + yRL) / 2) / sp0.tw, rz).normalize();
        cY.crossVectors(cZ, tmpV).normalize();
        cX.crossVectors(cY, cZ);
        cm.makeBasis(cX, cY, cZ);
        const need = (hy, wx, wz) => hy - (cX.y * wx + cZ.y * wz);
        const n0 = need(yFL, -hwT, -hzW); const n1 = need(yFR, hwT, -hzW); const n2 = need(yRL, -hwT, hzW); const n3 = need(yRR, hwT, hzW);
        const nMax = Math.max(n0, n1, n2, n3);
        c.hdbg = [yFL, yFR, yRL, yRR];
        c.twist = Math.abs(n0 - n1 - n2 + n3);                       // (test read-out) how far the four wheel points are from one plane
        const cy = (n0 + n1 + n2 + n3) / 4 + Math.min(0.02, 0.1 * (nMax - (n0 + n1 + n2 + n3) / 4));      // a rigid body on a twisted surface rests on the mean of the four wheel heights: no wheel floats or sinks by more than a quarter of the twist
        // residual of every wheel against the plane the body rests on (the suspension offsets, see makeMaterial)
        su[0] = clamp(yFL - (cy + cX.y * -hwT + cZ.y * -hzW), -SUS_MAX, SUS_MAX); su[1] = clamp(yFR - (cy + cX.y * hwT + cZ.y * -hzW), -SUS_MAX, SUS_MAX);
        su[2] = clamp(yRL - (cy + cX.y * -hwT + cZ.y * hzW), -SUS_MAX, SUS_MAX); su[3] = clamp(yRR - (cy + cX.y * hwT + cZ.y * hzW), -SUS_MAX, SUS_MAX);
        cq.setFromRotationMatrix(cm);
        const mx = (fCx + bCx) / 2; const mz = (fCz + bCz) / 2;
        tmpV.set(mx, cy, mz);
        cm.compose(tmpV, cq, cs1);
        c.x = mx; c.z = mz; c.y = cy; c.mat.set(cm.elements);
        if (pass === 0 && (Math.abs(cX.y) > 0.15 || Math.abs(cZ.y) > 0.15)) {
          // steep: where the wheels really are, horizontally (the body is tilted: its wheel base / track project shorter)
          const k = [[-hwT, -hzW], [hwT, -hzW], [-hwT, hzW], [hwT, hzW]];
          for (let w = 0; w < 4; w++) { wxz[w * 2] = mx + cX.x * k[w][0] + cZ.x * k[w][1]; wxz[w * 2 + 1] = mz + cX.z * k[w][0] + cZ.z * k[w][1]; }
        } else break;
      }
      void now;
      return true;
    }

    let conflicts = 0;
    const nq = { s: 0, d: 0, lat: 0, y: 0, i: 0 };
    /* inside the plan footprint of a tram bridge (both tracks + 3.5 m each side) at about the deck's height, or on the player's / opposite track outside a crossing */
    function structureConflict(c) {
      if (!track || !track.bridgeAt || !nearest) return false;
      const q = nearest(c.x, c.z, nq);
      if (!q || q.d > 12) return false;
      const dy = Math.abs(c.y - q.y);
      if (track.bridgeAt(q.s)) {
        const oppLat = hasOpp ? oppLatAt(q.s) : -3.5;
        const lo = Math.min(0, oppLat) - 3.5; const hi = Math.max(0, oppLat) + 3.5;
        if (q.lat > lo && q.lat < hi && dy < 3.4) return true;
      }
      return false;
    }
    let writeN = 0; let guards = 0;
    function updateCars(dt, now) {
      curDt = dt;
      for (let i = 0; i < cars.length; i++) cars[i].i = i;
      let spawned = 0;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c.active) { if (spawned < 3 && roadList.length && spawnCar(c, now)) spawned++; continue; }
        const rd = c.rd;
        // recycle cars that left the active area (out of sight), or whose road is gone
        const dTram = Math.hypot(c.x - tramX, c.z - tramZ);
        const cyv = c.y === c.y ? c.y : tramY;
        if (dTram > R_ACT * 1.35) { c.active = false; c.shown = false; continue; }
        if (dTram > R_ACT * 1.1 && !inView(c.x, cyv, c.z, 8)) { c.active = false; c.shown = false; continue; }
        // target speed: stop at the line in front of a red crossing, keep a gap to the car ahead
        let target = c.vmax;
        for (let k = 0; k < crossings.length; k++) {
          const cr = crossings[k];
          if (cr.rd !== rd || !cr.red) continue;
          const line = c.dir > 0 ? cr.c.t0 - 3.6 - c.spec.L / 2 + 2 : cr.c.t1 + 3.6 + c.spec.L / 2 - 2;
          const ahead = (line - c.t) * c.dir;
          const inside = c.t > cr.c.t0 - 2.4 && c.t < cr.c.t1 + 2.4;
          if (!inside && ahead > -0.5 && ahead < 28) target = Math.min(target, Math.max(0, ahead - 0.8) * 0.9);
        }
        for (let m2 = 0; m2 < cars.length; m2++) {
          if (m2 === i) continue;
          const o = cars[m2];
          if (!o.active || o.rd !== rd || o.dir !== c.dir) continue;
          if (o.latCur === o.latCur && c.latCur === c.latCur && Math.abs(o.latCur - c.latCur) > 1.8) continue;   // another lane
          const gap = (o.t - c.t) * c.dir;
          const need = c.spec.L / 2 + o.spec.L / 2 + 2.2 + (c.mway ? c.cur * 0.9 : 0);
          if (gap > 0 && gap < need + 14 + (c.mway ? c.cur * 1.5 : 0)) target = Math.min(target, Math.max(0, gap - need) * 0.9);
        }
        // never come to rest on the rails
        const onRails = (rd.cross || []).some((q) => c.t > q.t0 && c.t < q.t1);
        if (onRails && target < 3) target = 3;
        c.cur += clamp(target - c.cur, -7 * dt, 2.5 * dt);
        if (c.cur < 0.02) c.cur = 0;
        c.t += c.dir * c.cur * dt;
        // end of the road: continue on a connected road, else leave the world
        if (c.t > rd.len || c.t < 0) {
          const atEnd = c.t > rd.len;
          const endIdx = atEnd ? rd.pts.length - 1 : 0;
          const ep = rd.pts[endIdx];
          const px = rd.pts[atEnd ? endIdx - 1 : 1];
          const hdl = Math.hypot(ep.x - px.x, ep.z - px.z) || 1;
          const nx = nextRoad(c, rd, endIdx, ep.x, ep.z, (ep.x - px.x) / hdl, (ep.z - px.z) / hdl);
          const over = atEnd ? c.t - rd.len : -c.t;
          if (nx && (!nx.rd.bridge || CARS_ON_BRIDGES)) {
            // wait at the junction while the entry of the next road is occupied
            let blocked = false;
            for (let m2 = 0; m2 < cars.length && !blocked; m2++) {
              const o = cars[m2];
              if (o === c || !o.active || o.rd !== nx.rd || o.dir !== nx.dir) continue;
              if (Math.abs(o.t - nx.t) < (o.spec.L + c.spec.L) / 2 + 3) blocked = true;
            }
            if (blocked && c.wait < 14) { c.wait += dt; c.t = atEnd ? rd.len : 0; c.cur = 0; sample(rd, c.t, sp); c.x = sp.x; c.z = sp.z; continue; }
            if (blocked) { c.active = false; c.shown = false; continue; }
            c.wait = 0;
            c.rd = nx.rd; c.dir = nx.dir; c.t = clamp(nx.t + nx.dir * over, 0, nx.rd.len);
            c.latCur = NaN;   // onto the lane of the new road at once (the junction already moves the car sideways)
            if ((nx.rd.cls === 0 && nx.rd.oneway) !== c.mway) assignSpeed(c, nx.rd);   // motorway <-> street: other speed / lane
          } else { c.active = false; c.shown = false; continue; }
        }
        // roads along the rails: jump over the stretch
        const al = (c.rd.along || []).find((a) => c.t > a[0] && c.t < a[1]);
        if (al) c.t = c.dir > 0 ? al[1] + 0.5 : al[0] - 0.5;
        sample(c.rd, c.t, sp); c.x = sp.x; c.z = sp.z;
        if (isBad(c.rd, c.t, now)) { c.active = false; c.shown = false; continue; }
        c.since += c.cur * dt;
      }
      // pass 2: ground every car, write instances
      writeN = 0; guardBudget = 3;
      for (let k = 0; k < veh.length; k++) veh[k].n = 0;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c.active) continue;
        if (!groundCar(c, c.dir, now)) { c.shown = false; continue; }
        // a road vehicle never stands inside the tram bridge (deck, parapets) or the track envelope: a road that is not a bridge itself but whose height query lands at the tram's deck level there is cut
        if (!c.rd.bridge && structureConflict(c)) {
          if (!c.rd.bad) c.rd.bad = [];
          c.rd.bad.push([c.t - 25, c.t + 25, now + 600000]);
          c.active = false; c.shown = false; conflicts++;
          continue;
        }
        // safety net: a few cheap rays per frame at most, when a car has just spawned / entered another road / driven 12 m since its last check
        if (guardBudget > 0 && (c.rd !== c.chkRd || c.since > 12)) {
          guardBudget--; c.chkRd = c.rd; c.since = 0;
          if (surfaceCheck(c.x, c.y, c.z) === false) {
            if (!c.rd.bad) c.rd.bad = [];
            c.rd.bad.push([c.t - 18, c.t + 18, now + 20000]);
            c.active = false; c.shown = false; guards++;
            continue;
          }
          if (!structureClear(c, now)) {
            if (!c.rd.bad) c.rd.bad = [];
            c.rd.bad.push([c.t - 25, c.t + 25, now + 600000]);
            c.active = false; c.shown = false; conflicts++;
            continue;
          }
        }
        c.shown = true;
        const vt = veh[c.tid];
        vt.mesh.setMatrixAt(vt.n, cm);
        const ba = vt.body.array; ba[vt.n * 3] = c.body[0]; ba[vt.n * 3 + 1] = c.body[1]; ba[vt.n * 3 + 2] = c.body[2];
        const sa = vt.sus.array; const q4 = vt.n * 4; sa[q4] = c.sus[0]; sa[q4 + 1] = c.sus[1]; sa[q4 + 2] = c.sus[2]; sa[q4 + 3] = c.sus[3];
        const da = vt.dim.array; da[vt.n * 2] = c.spec.tw / 2; da[vt.n * 2 + 1] = c.spec.wb / 2;
        vt.n++; writeN++;
      }
      for (let k = 0; k < veh.length; k++) {
        const vt = veh[k];
        vt.mesh.count = vt.n; vt.mesh.visible = vt.n > 0;
        if (vt.n > 0) { vt.mesh.instanceMatrix.needsUpdate = true; vt.body.needsUpdate = true; vt.sus.needsUpdate = true; vt.dim.needsUpdate = true; }
      }
    }

    /* ================================================================ oncoming Luxtrams */
    const onc = { model: null, active: false, s: 0, dir: -1, v: 0, phase: 'run', dwell: 0, doors: 0, visited: null, stop: null, len: TRAM_LEN_FALLBACK, cd: 0, clock: 0, spawnTick: 0, night: -1, destName: '', vmax: 13, still: 0, age: 0, forced: 0 };
    const stations = (track && track.stations) || [];
    const oppRange = () => (track && track.opposite && track.opposite.from !== undefined ? [track.opposite.from, track.opposite.to] : null);
    onc.trig = { s: 0, dir: -1, len: TRAM_LEN_FALLBACK, active: false };
    trams.push(onc.trig);
    let moveSecs = 0;
    let nextSpawnAt = 70 + rng() * 70;        // seconds of driving until the first oncoming tram (never right at the start)
    const animDoors = quality !== 'low';
    const nameOf = (n) => (typeof n === 'string' ? n : n ? (n.lb || n.de || n.en || '') : '');
    function ensureModel() {
      if (onc.model || !TS.trains || !TS.trains.create || !TS.config) return !!onc.model;
      try {
        const cfg = TS.config.trains.find((t) => t.id === 'tram');
        if (!cfg) return false;
        const lv = cfg.liveries[Math.floor(rng() * cfg.liveries.length)] || cfg.livery;
        const m = TS.trains.create(cfg, { quality, livery: lv, upgrades: {} });
        if (!m) return false;
        m.group.visible = false;
        m.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
        root.add(m.group);
        onc.mergeQueue = m.cars.map((c, i) => [c, i]);          // baked one car per frame (see updateOncoming)
        onc.bake = createBake(m, { doors: animDoors });
        onc.model = m;
        onc.len = m.totalLength || TRAM_LEN_FALLBACK;
        onc.cars = m.cars;
        return true;
      } catch (e) { console.warn(TAG + 'oncoming tram model failed', e); onc.model = null; return false; }
    }
    /* frame sources: the oncoming tram's track is always the one the player is NOT on (by route identity); oncoming trams travel -s on the opposite track, +s on the forward track */
    const ONC_DIR = routeReverse ? 1 : -1;
    const frameOn = (s, out) => (routeReverse ? track.frameAt(s, out) : track.opposite.frameAt(s, out));
    const framePlayer = (s, out) => (routeReverse ? track.opposite.frameAt(s, out) : track.frameAt(s, out));
    const MIN_TRACK_SEP = 2.5;          // m: guard, an oncoming car closer than this to the player's track centre (at its own s) is hidden at once
    const fA = { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    const fB = { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    const bx = new T.Vector3(); const by = new T.Vector3(); const bz = new T.Vector3(); const bm = new T.Matrix4(); const bp = new T.Vector3();
    function placeOncoming() {
      const m = onc.model; const d = onc.dir;
      let off = 0;
      for (let i = 0; i < m.cars.length; i++) {
        const car = m.cars[i];
        const centre = onc.s - d * (off + car.length / 2);
        off += car.length;
        const bo = car.bogieOffset !== undefined ? car.bogieOffset : car.length * 0.36;
        frameOn(centre + d * bo, fA); frameOn(centre - d * bo, fB);
        bp.addVectors(fA.pos, fB.pos).multiplyScalar(0.5);
        bz.subVectors(fB.pos, fA.pos);                       // local +Z = backwards = away from the travelling direction
        if (bz.lengthSq() < 1e-6) bz.copy(fA.tangent).multiplyScalar(-d);
        bz.normalize();
        by.set(0, 1, 0);
        bx.crossVectors(by, bz).normalize();
        by.crossVectors(bz, bx).normalize();
        bm.makeBasis(bx, by, bz);
        bm.setPosition(bp);
        if (onc.bake) bm.toArray(onc.bake.uCars.value, i * 16);
        (onc.mats || (onc.mats = []))[i] = (onc.mats[i] || new Float32Array(16)); bm.toArray(onc.mats[i]);
        if (!onc.baked) {
          car.group.position.copy(bp);
          car.group.quaternion.setFromRotationMatrix(bm);
          car.group.updateMatrixWorld(true);
        }
        if (!onc.baked && car.bogies && car.bogies.length === 2) {
          const tfx = fA.tangent.x * d; const tfz = fA.tangent.z * d; const tbx = fB.tangent.x * d; const tbz = fB.tangent.z * d;
          const fx = -bz.x; const fz = -bz.z;
          car.bogies[0].rotation.y = Math.atan2(tfx * fz - tfz * fx, tfx * fx + tfz * fz);
          car.bogies[1].rotation.y = Math.atan2(tbx * fz - tbz * fx, tbx * fx + tbz * fz);
        }
      }
      onc.x = bp.x; onc.z = bp.z; onc.y = bp.y;
      onc.sepOk = true;
    }
    /* guard: lateral distance of the tram (nose, middle, tail) to the centre of the PLAYER's track at the same s; closer than MIN_TRACK_SEP = the models would overlap */
    const fP = { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    function oncomingSeparated() {
      for (let k = 0; k <= 2; k++) {
        const s = onc.s - onc.dir * (onc.len * k * 0.5);
        if (!track.opposite.has(s)) continue;
        frameOn(s, fA); framePlayer(s, fP);
        const dx = fA.pos.x - fP.pos.x, dz = fA.pos.z - fP.pos.z;
        const lat = Math.abs(dx * fP.right.x + dz * fP.right.z);
        if (lat < MIN_TRACK_SEP) return false;
      }
      return true;
    }
    function spawnOncoming(distOverride) {
      const rg = oppRange();
      if (!rg || onc.active || !track || !track.opposite || !hasOpp) { onc.why = 'no opposite track'; return false; }
      if (!ensureModel()) { onc.why = 'no model'; return false; }
      const d = ONC_DIR;                          // fixed by the route: the opposite track's direction of travel
      // it must approach the player: start on the side it comes from (player.s - d * dist).  The world streams [s - behind, s + ahead] in base-track s,
      // whichever way the player drives: the loaded range on that side depends on the player's current direction (the reverser flips it)
      const sideSign = -d;
      const dist = distOverride || Math.min((sideSign === player.dir ? (Q.ahead || 600) : (Q.behind || 200)) * 0.93, 780);
      const sSpawn = player.s + sideSign * dist;
      const margin = onc.len + 5;
      if (sSpawn - margin * d < rg[0] + 5 || sSpawn - margin * d > rg[1] - 5 || sSpawn < rg[0] + 20 || sSpawn > rg[1] - 20) { onc.why = 'spawn outside the opposite track'; return false; }
      // the opposite track must also exist where the player is (so the tram can run past)
      if (player.s < rg[0] + 10 || player.s > rg[1] - 10) { onc.why = 'player outside the opposite track'; return false; }
      // ground must be built under the spawn point
      frameOn(sSpawn, fA);
      const h = surfaceAt(fA.pos.x, fA.pos.z);
      if (h !== h) { onc.why = 'ground not built at the spawn point'; return false; }
      onc.s = sSpawn; onc.dir = d; onc.v = 6 + rng() * 5; onc.phase = 'run'; onc.dwell = 0; onc.doors = 0; onc.stop = null; onc.still = 0; onc.age = 0;
      onc.vmax = 11.5 + rng() * 3;
      onc.visited = new Set();
      // stations behind the spawn point (in the travelling sense) are done
      stations.forEach((st, k) => { const ps = d < 0 ? st.platformStart : st.platformEnd; if ((onc.s - ps) * -d < 6) onc.visited.add(k); });
      // destination: the terminus it runs to
      const last = d < 0 ? stations[0] : stations[stations.length - 1];
      if (last && onc.model.setDestination) onc.model.setDestination(nameOf(last.name));
      onc.active = true; setTramVisible(true);
      onc.trig.active = true;
      onc.night = -1;
      placeOncoming();
      onc.why = ''; return true;
    }
    function setTramVisible(vis) { if (onc.baked) onc.bake.setVisible(vis); else onc.model.group.visible = vis; }
    function despawnOncoming() {
      if (onc.phase === 'dwell') oncDepart();
      onc.active = false;
      if (onc.model) { setTramVisible(false); onc.model.setDoors(0); if (onc.bake) onc.bake.uDoor.value = 0; }
      if (onc.trig) onc.trig.active = false;
      moveSecs = 0; nextSpawnAt = 180 + rng() * 180;       // the next one in 3 to 6 minutes of driving
    }
    /* dwell interface (see the header): platform side of the tram's stop, door world positions, arrive / depart hooks */
    const ONC_DWELL_MS = 30000; const ONC_DWELL_MAX_MS = 45000;
    let oncSerial = 0;
    function oncPlatformSide(k) {
      // forward route: the oncoming tram runs on the left-hand track in the opposite direction: every platform (side platform or island) lies on its right.
      // return route: it runs on the forward track in the forward direction: the platform is on the stop's own side (island stops: left)
      if (!routeReverse || !track.base || !track.base.stations) return 'right';
      const bs = track.base.stations[track.base.stations.length - 1 - k];
      return bs && bs.side === 'left' ? 'left' : 'right';
    }
    function oncDoors() {
      const out = []; const m = onc.model; if (!m || !onc.mats) return out;
      const sgn = onc.platformSide === 'left' ? -1 : 1; const v = new T.Vector3(); const mm = new T.Matrix4();
      m.cars.forEach((car, i) => {
        if (!onc.mats[i]) return; mm.fromArray(onc.mats[i]);
        (car.doors || []).forEach((dr) => { if ((dr.side || 'right') !== onc.platformSide) return; v.set(sgn * 1.2, 0.35, dr.zLocal).applyMatrix4(mm); out.push({ x: v.x, y: v.y, z: v.z }); });
      });
      return out;
    }
    function oncArrive(k) {
      onc.platformSide = oncPlatformSide(k);
      onc.dwellId = 'onc-' + (++oncSerial);
      const hook = TS.tramDwell;
      if (!hook || typeof hook.arrive !== 'function') return;
      try {
        const st = stations[k];
        const ret = hook.arrive({ id: onc.dwellId, stopName: st ? nameOf(st.name) : '', platformSide: onc.platformSide, doors: oncDoors(), dwellMs: ONC_DWELL_MS, getDoors: oncDoors });
        if (typeof ret === 'number' && ret > ONC_DWELL_MS) onc.dwell = Math.min(ONC_DWELL_MAX_MS, ret) / 1000;
      } catch (e) { console.warn(TAG + 'tramDwell.arrive failed', e); }
    }
    function oncDepart() {
      const id = onc.dwellId; onc.dwellId = null;
      const hook = TS.tramDwell;
      if (id && hook && typeof hook.depart === 'function') { try { hook.depart({ id }); } catch (e) { console.warn(TAG + 'tramDwell.depart failed', e); } }
    }
    function updateOncoming(dt) {
      // schedule
      if (onc.mergeQueue && onc.mergeQueue.length) {
        const ci = onc.mergeQueue.shift();
        try {
          onc.bake.addCar(ci[0], ci[1]);
          if (!onc.mergeQueue.length) {
            onc.bake.finish(root); onc.baked = true; onc.model.group.visible = false;
            onc.bake.syncLights(); onc.night = -1;
            if (onc.active) onc.bake.setVisible(true);
          }
        } catch (e) { console.warn(TAG + 'bake failed (full model kept)', e); onc.mergeQueue.length = 0; onc.baked = false; onc.bake = null; if (onc.model) { onc.model.group.traverse((o) => { o.visible = true; }); onc.model.group.visible = onc.active; } }
        if (!onc.active) return;
      }
      if (!onc.active) {
        if (onc.cd > 0) { onc.cd -= dt; }
        if (moveSecs >= nextSpawnAt - 25) ensureModel();        // build the model ahead of time (no hitch at the spawn)
        if (moveSecs >= nextSpawnAt && onc.cd <= 0 && !(onc.mergeQueue && onc.mergeQueue.length)) { if (!spawnOncoming()) onc.cd = 15; }
        return;
      }
      const m = onc.model; const d = onc.dir;
      const rg = oppRange();
      /* watchdog: an oncoming tram never stays put for no reason.  Standing still longer than the longest dwell (+ margin) in a dwell, or 20 s in the 'run' phase, means something kept it
         (a skipped stop, a stale phase after a long frame, a missing hook answer): it is released at once; one that has been around for 7 minutes is removed. */
      onc.age += dt; onc.still = onc.v < 0.05 ? onc.still + dt : 0;
      if (onc.still > (onc.phase === 'dwell' ? ONC_DWELL_MAX_MS / 1000 + 6 : 20)) {
        onc.forced++; onc.still = 0;
        if (onc.phase === 'dwell') { onc.dwell = 0; onc.doors = 0; onc.phase = 'run'; if (onc.baked) onc.bake.uDoor.value = 0; else m.setDoors(0); oncDepart(); }
        else { if (onc.stop) { onc.visited.add(onc.stop.k); onc.stop = null; } onc.v = 2; }
      }
      if (onc.age > 420) { despawnOncoming(); return; }
      // despawn: passed the player and out of the detailed world, or lost the opposite track
      const rel = onc.s - player.s, passed = rel * d > 0;   // passed = it has gone by the player and runs away from it
      const behind = passed ? Math.abs(rel) : 0;
      const behindMax = (Math.sign(rel) === player.dir ? (Q.ahead || 600) : (Q.behind || 200)) * 0.85;
      if (!rg || behind > behindMax || (onc.s - rg[0] < 3 && d < 0) || (rg[1] - onc.s < 3 && d > 0)) {
        // at the end of the opposite track: only vanish while out of sight
        if (!rg || behind > behindMax || !inView(onc.x, onc.y, onc.z, 30)) { despawnOncoming(); return; }
      }
      // pick the next stop
      if (!onc.stop && onc.phase === 'run') {
        let best = null; let bd = 1e9;
        stations.forEach((st, k) => {
          if (onc.visited.has(k)) return;
          const stopS = d < 0 ? st.platformStart + 1.5 : st.platformEnd - 1.5;
          const dd = (onc.s - stopS) * -d;       // metres still to go
          if (dd > 1 && dd < bd) { bd = dd; best = { k, stopS }; }
        });
        onc.stop = best;
      }
      // speed
      let target = onc.vmax;
      let toStop = 1e9;
      if (onc.phase === 'run' && onc.stop) {
        toStop = (onc.s - onc.stop.stopS) * -d;
        target = Math.min(target, Math.sqrt(Math.max(0, 2 * 0.9 * Math.max(0, toStop - 0.4))) * 0.95 + 0.8);
      }
      if (onc.phase === 'dwell') target = 0;
      // nothing to slow for while the front is in the world but the tile ahead is missing: keep going
      onc.v = clamp(onc.v + clamp(target - onc.v, -1.2 * dt, 1.0 * dt), 0, 16);
      if (onc.phase === 'run') {
        onc.s += d * onc.v * dt;
        if (onc.stop) {
          const rem = (onc.s - onc.stop.stopS) * -d;
          if (rem <= 0.35 && onc.v < 1.2) {
            onc.s = onc.stop.stopS; onc.v = 0; onc.phase = 'dwell'; onc.still = 0; onc.dwell = ONC_DWELL_MS / 1000; onc.visited.add(onc.stop.k);
            oncArrive(onc.stop.k); onc.stop = null;
          } else if (rem < 0) { onc.s = onc.stop.stopS; onc.v = Math.min(onc.v, 0.5); }
        }
      } else {
        onc.dwell -= dt;
        // doors: open after ~2 s standing, close 3 s before leaving
        const want = onc.dwell > 3.2 ? 1 : 0;
        onc.doors = clamp(onc.doors + (want ? dt / 1.6 : -dt / 1.6), 0, 1);
        if (animDoors) { if (onc.baked) onc.bake.uDoor.value = onc.doors; else m.setDoors(onc.doors, onc.platformSide || 'right'); }
        if (onc.dwell <= 0 && onc.doors <= 0) { onc.phase = 'run'; onc.still = 0; if (onc.baked) onc.bake.uDoor.value = 0; else m.setDoors(0); oncDepart(); }
      }
      // red-light trigger
      onc.trig.s = onc.s; onc.trig.dir = d; onc.trig.len = onc.len;
      placeOncoming();
      m.setWheelDistance && m.setWheelDistance(Math.abs(onc.s) * 1.0);
      // head / tail lamps at night
      const night = nightFn() > 0.35 ? 1 : 0;
      if (night !== onc.night) { onc.night = night; m.setLights({ head: !!night, tail: !!night, cabin: !!night }); if (onc.baked) onc.bake.syncLights(); }
      // hide while the ground below is not built (never float over a hole)
      const h = surfaceAt(onc.x, onc.z);
      onc.sepOk = oncomingSeparated();
      setTramVisible(onc.sepOk && h === h && (!onc.baked || inView(onc.x, onc.y + 2, onc.z, onc.len * 0.62)));
    }

    /* ================================================================ update */
    let lastS = null;
    let lastNow = 0;
    function update(dt, s, camera) {
      if (disposed) return;
      const now = performance.now();
      dt = clamp(dt || 0.016, 0.001, 0.1);
      // player direction and driving time (the base track is fed in both directions: the return runs towards smaller s)
      if (lastS !== null) {
        const ds = s - lastS;
        if (Math.abs(ds) > 150) { if (onc.active) despawnOncoming(); moveSecs = Math.max(0, moveSecs - 30); fillUntil = now + 2500; }   // a jump (test hook / restart)
        else if (Math.abs(ds) > 0.01) { player.dir = ds > 0 ? 1 : -1; if (Math.abs(ds) / dt > 0.5) moveSecs += dt; }
      }
      lastS = s;
      player.s = s;
      if (camera) {
        pvm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pvm); haveFrustum = true;
      }
      if (track && track.frameAt) {
        track.frameAt(clamp(s, 0, track.length), tmpFrame);
        tramX = tmpFrame.pos.x; tramZ = tmpFrame.pos.z; tramY = tmpFrame.pos.y;
      }
      if (carDirty) rebuild();
      nightU.value = nightFn();
      resolveLamps();
      updateCrossings();
      updateCars(dt, now);
      if (hasOpp && track && track.opposite) updateOncoming(dt);
      lastNow = now; void lastNow; void lastRebuildMs;
    }
    function dispose() {
      disposed = true;
      veh.forEach((vt) => { root.remove(vt.mesh); vt.geo.dispose(); vt.mesh.dispose(); });
      root.remove(lampMesh); root.remove(lampPosts);
      lampGeo.dispose(); lampMesh.dispose(); lampPostGeo.dispose(); lampPosts.dispose();
      mats.forEach((m) => m.dispose());
      if (onc.bake) { try { onc.bake.dispose(root); } catch (e) { /* ignore */ } onc.bake = null; }
      if (onc.model) { try { onc.model.dispose(); } catch (e) { /* ignore */ } onc.model = null; }
      if (TS.luxTraffic && TS.luxTraffic.last === api) TS.luxTraffic.last = null;
    }
    const api = {
      update, dispose,
      markDirty: () => { carDirty = true; },
      posts: () => crossPosts.slice(),
      spawnOncoming: (d) => spawnOncoming(d),
      /* test hook: where the oncoming tram is, and how far its centre is (laterally, at the same s) from the player's track */
      oncomingProbe: () => {
        if (!onc.active || !track || !track.opposite) return null;
        const out = { s: onc.s, dir: onc.dir, routeReverse, sepOk: onc.sepOk !== false, visible: onc.baked ? !!(onc.bake.meshesVisible && onc.bake.meshesVisible()) : !!(onc.model && onc.model.group.visible), minLat: 1e9 };
        for (let k = 0; k <= 4; k++) {
          const s = onc.s - onc.dir * (onc.len * k * 0.25);
          if (!track.opposite.has(s)) continue;
          frameOn(s, fA); framePlayer(s, fP);
          out.minLat = Math.min(out.minLat, Math.abs((fA.pos.x - fP.pos.x) * fP.right.x + (fA.pos.z - fP.pos.z) * fP.right.z));
        }
        return out;
      },
      prepareOncoming: () => ensureModel(),
      state: () => ({
        fails, guarded: guards, conflicts, roads: roadList.length, total: cars.length, crossings: crossings.length, cars: cars.filter((c) => c.active).length, shown: writeN, types: cars.filter((c) => c.shown).reduce((o, c) => { o[c.type] = (o[c.type] || 0) + 1; return o; }, {}),
        oncoming: onc.active ? { s: onc.s, dir: onc.dir, v: onc.v, phase: onc.phase, doors: onc.doors, x: onc.x, y: onc.y, z: onc.z, still: onc.still, age: onc.age, forced: onc.forced } : null, moveSecs, nextSpawnAt, why: onc.why, baked: !!onc.baked, queue: onc.mergeQueue ? onc.mergeQueue.length : -1, tramDraws: onc.bake ? onc.bake.drawCalls() : 0, cd: onc.cd, playerDir: player.dir, rActive: R_ACT,
      }),
      cars: () => cars.filter((c) => c.shown).map((c) => ({ id: c.i, type: c.type, x: c.x, y: c.y, z: c.z, v: c.cur, dir: c.dir, t: c.t, rd: roadList.indexOf(c.rd), cls: c.rd.cls, oneway: !!c.rd.oneway, bridge: c.rd.bridge === true, twist: c.twist, hdbg: c.hdbg, sus: c.sus, hw: c.rd.hw, L: c.spec.L, w: c.spec.tw, lat: c.latCur, mway: c.mway, lanes: laneCentres(c.rd, c.t, c.dir), onCross: (c.rd.cross || []).some((q) => c.t > q.t0 - 1.5 - c.spec.L / 2 && c.t < q.t1 + 1.5 + c.spec.L / 2) })),   // (test hook; onCross = some part of the body is on / at a level crossing)
      /* test hook: the 4 wheel contact points (world) of every shown car: the road surface must be at or just below each one */
      wheelPoints: () => {
        const out = []; const v = new T.Vector3(); const mm = new T.Matrix4();
        cars.forEach((c) => {
          if (!c.shown) return;
          mm.fromArray(c.mat); const sp0 = c.spec; const pts = [];
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((q, k) => { v.set(q[0] * sp0.tw / 2, 0, q[1] * sp0.wb / 2).applyMatrix4(mm); pts.push([v.x, v.y + (c.sus ? c.sus[k] : 0), v.z]); });   // (the body warp lowers / lifts each wheel by its suspension offset)
          out.push({ type: c.type, bridge: c.rd.bridge === true, pts });
        });
        return out;
      },
      crossingsInfo: () => crossings.map((cr) => ({ s: Math.round(cr.c.s), red: cr.red, lamps: cr.lamps.length, cars: cars.filter((c) => c.active && c.rd === cr.rd && c.t > cr.c.t0 - 30 && c.t < cr.c.t1 + 30).map((c) => ({ t: Math.round(c.t - cr.c.t0), v: +c.cur.toFixed(1), dir: c.dir })) })),
      forceNextIn: (sec) => { nextSpawnAt = moveSecs + sec; },
    };
    TS.luxTraffic.last = api;
    return api;
  }

  TS.luxTraffic = { setLane: (k) => { LANE_K = k; }, create, last: null, CARS_ON_BRIDGES, TYPES, SPEC, buildVehicleGeometry, makeMaterial, _bake: createBake };
})();
