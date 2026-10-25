/* Lokféierer: roads at level crossings, mesh stage (TS.crossingRoadsMesh.build).
 * Takes one crossing of the plan made by crossing-roads.js and returns a THREE.Group with the asphalt, the gravel verges and lanes, the white lines,
 * the T-junction corners, the turning places and the road signs (warning triangle "Bahnübergang mit Schranken", three / two / one stripe markers,
 * yield sign at the junction).  Everything lies on the design height of the plan (the terrain was shaped to it), so nothing floats or sinks.
 * The group is built in world coordinates and belongs to the landscape chunk that holds the crossing. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const SHARED = {};

  /* ---- layout constants */
  const EDGE_LINE_OFFSET = 0.28;       // white edge line, distance from the asphalt edge
  const EDGE_LINE_HALF = 0.06;
  const LINE_LIFT = 0.012;
  const DASH_ON = 3;
  const DASH_PERIOD = 9;
  const PAD_RADIUS = 4.2;
  const PAD_SEGMENTS = 14;
  const FILLET_STEPS = 6;
  const SIGN_POST_H = 2.3;
  const SIGN_SIDE_GAP = 0.75;
  const ATLAS_COLS = 4;
  const ATLAS_ROWS = 2;
  const TILE_PX = 128;
  const TILE = { warn: 0, yield: 1, speed: 2, bake1: 3, bake2: 4, bake3: 5, grey: 6, white: 7 };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---- a small mesh builder (positions, normals, colours, uvs) */
  class MB {
    constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; }
    get count() { return this.p.length / 3; }
    get empty() { return this.i.length === 0; }
    vert(x, y, z, nx, ny, nz, col, u, v) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.u.push(u, v);
      return this.count - 1;
    }
    tri(a, b, c) { this.i.push(a, b, c); }
    /* quad a b c d (counter-clockwise seen from the side the normal points to) */
    quad(a, b, c, d, nrm, col, uv) {
      const u = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
      const i0 = this.vert(a[0], a[1], a[2], nrm[0], nrm[1], nrm[2], col, u[0][0], u[0][1]);
      const i1 = this.vert(b[0], b[1], b[2], nrm[0], nrm[1], nrm[2], col, u[1][0], u[1][1]);
      const i2 = this.vert(c[0], c[1], c[2], nrm[0], nrm[1], nrm[2], col, u[2][0], u[2][1]);
      const i3 = this.vert(d[0], d[1], d[2], nrm[0], nrm[1], nrm[2], col, u[3][0], u[3][1]);
      this.i.push(i0, i1, i2, i0, i2, i3);
    }
    /* quad whose winding is chosen so that it faces `hint` */
    quadFacing(a, b, c, d, hint, col, uv) {
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
      const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
        const u = uv ? [uv[0], uv[3], uv[2], uv[1]] : null;
        this.quad(a, d, c, b, [-nx, -ny, -nz], col, u);
      } else this.quad(a, b, c, d, [nx, ny, nz], col, uv);
    }
    box(cx, cy, cz, sx, sy, sz, col) {
      const x0 = cx - sx / 2; const x1 = cx + sx / 2; const y0 = cy - sy / 2; const y1 = cy + sy / 2; const z0 = cz - sz / 2; const z1 = cz + sz / 2;
      const P = (x, y, z) => [x, y, z];
      this.quadFacing(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), [0, 0, -1], col);
      this.quadFacing(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1], col);
      this.quadFacing(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [-1, 0, 0], col);
      this.quadFacing(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), [1, 0, 0], col);
      this.quadFacing(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), [0, 1, 0], col);
    }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    }
  }

  /* ---- painted textures (cached for the session) */
  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  function asphaltTexture() {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#585b60'; g.fillRect(0, 0, w, h);
      const r = mulberry(11);
      for (let i = 0; i < 7; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.03 + r() * 0.04) + ')'; g.fillRect(r() * w, r() * h, 20 + r() * 60, 12 + r() * 40); }
      for (let i = 0; i < 4200; i++) { const v = 80 + r() * 90; g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',' + (0.12 + r() * 0.2) + ')'; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
      g.strokeStyle = 'rgba(28,28,30,0.35)'; g.lineWidth = 1;
      for (let i = 0; i < 3; i++) { g.beginPath(); let x = r() * w; let y = r() * h; g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 22; y += 8 + r() * 16; g.lineTo(x, y); } g.stroke(); }
    }, true);
  }
  function gravelTexture() {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#a49c89'; g.fillRect(0, 0, w, h);
      const r = mulberry(23);
      for (let i = 0; i < 5200; i++) { const v = 120 + r() * 110; g.fillStyle = 'rgba(' + v + ',' + (v - 6) + ',' + (v - 22) + ',' + (0.2 + r() * 0.3) + ')'; g.fillRect(r() * w, r() * h, 1 + r() * 2.4, 1 + r() * 2.2); }
      for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(70,90,50,0.28)'; g.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 4); }
    }, true);
  }
  /* sign atlas: 4 x 2 tiles of 128 px.  Triangles are drawn on a transparent ground (alpha test). */
  function signAtlas() {
    return canvasTex(TILE_PX * ATLAS_COLS, TILE_PX * ATLAS_ROWS, (g) => {
      const tile = (idx) => ({ x: (idx % ATLAS_COLS) * TILE_PX, y: Math.floor(idx / ATLAS_COLS) * TILE_PX });
      const tri = (o, up, fill, border) => {
        g.beginPath();
        if (up) { g.moveTo(o.x + 64, o.y + 6); g.lineTo(o.x + 122, o.y + 112); g.lineTo(o.x + 6, o.y + 112); } else { g.moveTo(o.x + 6, o.y + 16); g.lineTo(o.x + 122, o.y + 16); g.lineTo(o.x + 64, o.y + 122); }
        g.closePath(); g.fillStyle = border; g.fill();
        g.save(); g.translate(o.x + 64, o.y + (up ? 80 : 50)); g.scale(0.68, 0.68); g.translate(-(o.x + 64), -(o.y + (up ? 80 : 50)));
        g.beginPath();
        if (up) { g.moveTo(o.x + 64, o.y + 6); g.lineTo(o.x + 122, o.y + 112); g.lineTo(o.x + 6, o.y + 112); } else { g.moveTo(o.x + 6, o.y + 16); g.lineTo(o.x + 122, o.y + 16); g.lineTo(o.x + 64, o.y + 122); }
        g.closePath(); g.fillStyle = fill; g.fill(); g.restore();
      };
      // 0 warning: level crossing with barriers (white triangle, red border, black gate)
      let o = tile(TILE.warn);
      tri(o, true, '#f4f2ea', '#c4161c');
      g.fillStyle = '#111'; g.fillRect(o.x + 40, o.y + 82, 48, 5);               // barrier arm
      g.fillRect(o.x + 40, o.y + 70, 5, 30); g.fillRect(o.x + 83, o.y + 70, 5, 30);   // posts
      g.fillStyle = '#c4161c';
      for (let k = 0; k < 3; k++) g.fillRect(o.x + 48 + k * 14, o.y + 82, 7, 5);
      g.fillStyle = '#111'; g.fillRect(o.x + 58, o.y + 50, 12, 20); g.fillRect(o.x + 52, o.y + 56, 24, 4);   // the cross of the warning
      // 1 yield (inverted triangle)
      o = tile(TILE.yield);
      tri(o, false, '#f4f2ea', '#c4161c');
      // 2 speed limit 50
      o = tile(TILE.speed);
      g.beginPath(); g.arc(o.x + 64, o.y + 64, 58, 0, 6.2832); g.fillStyle = '#c4161c'; g.fill();
      g.beginPath(); g.arc(o.x + 64, o.y + 64, 42, 0, 6.2832); g.fillStyle = '#f4f2ea'; g.fill();
      g.fillStyle = '#111'; g.font = 'bold 52px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('50', o.x + 64, o.y + 68);
      // 3,4,5 level-crossing markers: white board, red diagonal stripes (1, 2, 3)
      [TILE.bake1, TILE.bake2, TILE.bake3].forEach((idx, n) => {
        const t = tile(idx);
        g.fillStyle = '#f4f2ea'; g.fillRect(t.x + 30, t.y, 68, TILE_PX);
        g.save(); g.beginPath(); g.rect(t.x + 30, t.y, 68, TILE_PX); g.clip();
        g.strokeStyle = '#c4161c'; g.lineWidth = 12;
        const stripes = n + 1;
        for (let k = 0; k < stripes; k++) {
          const base = TILE_PX - 28 - (stripes - 1 - k) * 28 + 4;   // stripes rise from the bottom-right, the first one is the lowest
          g.beginPath(); g.moveTo(t.x + 98 - (stripes === 1 ? 6 : 0), t.y + base - 60); g.lineTo(t.x + 30, t.y + base + 10); g.stroke();
        }
        g.restore();
        g.strokeStyle = '#2a2a2a'; g.lineWidth = 3; g.strokeRect(t.x + 30, t.y + 2, 68, TILE_PX - 4);
      });
      // 6 grey back, 7 white
      o = tile(TILE.grey); g.fillStyle = '#8b9096'; g.fillRect(o.x, o.y, TILE_PX, TILE_PX);
      o = tile(TILE.white); g.fillStyle = '#f2f0e8'; g.fillRect(o.x, o.y, TILE_PX, TILE_PX);
    }, false);
  }
  function tileUV(idx) {
    const col = idx % ATLAS_COLS; const row = Math.floor(idx / ATLAS_COLS);
    const u0 = col / ATLAS_COLS; const u1 = (col + 1) / ATLAS_COLS;
    const v1 = 1 - row / ATLAS_ROWS; const v0 = 1 - (row + 1) / ATLAS_ROWS;
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  }

  function materials() {
    if (SHARED.m) return SHARED.m;
    const asphalt = new T.MeshLambertMaterial({ vertexColors: true, map: asphaltTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const gravel = new T.MeshLambertMaterial({ vertexColors: true, map: gravelTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
    const paint = new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
    const post = new T.MeshLambertMaterial({ vertexColors: true });
    const sign = new T.MeshLambertMaterial({ vertexColors: true, map: signAtlas(), alphaTest: 0.5, side: T.DoubleSide });
    SHARED.m = { asphalt, gravel, paint, post, sign };
    return SHARED.m;
  }

  /* ---- ribbons */
  const WHITE = [1, 1, 1];
  const LINE = [0.93, 0.93, 0.9];
  const POST = [0.82, 0.83, 0.82];
  const rightOf = (p) => [-p.tz, p.tx];

  /* strip between lateral offsets o0 < o1 (positive = to the right of the heading) along pts, `skip(i)` leaves the quad between samples i and i+1 out */
  function ribbon(mb, pts, o0, o1, lift, colorAt, uvScale, skip) {
    const base = mb.count;
    pts.forEach((p, i) => {
      const r = rightOf(p);
      const y = p.yT + TS.crossingRoads.ROAD_LIFT + lift;
      const c = colorAt ? colorAt(p, i) : WHITE;
      const w0 = typeof o0 === 'function' ? o0(p, i) : o0; const w1 = typeof o1 === 'function' ? o1(p, i) : o1;
      mb.vert(p.x + r[0] * w0, y, p.z + r[1] * w0, 0, 1, 0, c, w0 / uvScale, p.u / uvScale);
      mb.vert(p.x + r[0] * w1, y, p.z + r[1] * w1, 0, 1, 0, c, w1 / uvScale, p.u / uvScale);
    });
    for (let i = 0; i < pts.length - 1; i++) {
      if (skip && skip(i)) continue;
      const a = base + i * 2; // left_i = a, right_i = a + 1, left_i+1 = a + 2, right_i+1 = a + 3
      mb.tri(a, a + 1, a + 2); mb.tri(a + 1, a + 3, a + 2);
    }
  }

  function wearColor(p) {
    const k = 0.9 + 0.1 * Math.sin(p.u * 0.21 + p.x * 0.13) * Math.cos(p.u * 0.07 + p.z * 0.11);
    return [k, k, k];
  }

  function disc(mb, cx, cz, y, radius, col) {
    const centre = mb.vert(cx, y, cz, 0, 1, 0, col, 0.5, 0.5);
    const first = mb.count;
    for (let i = 0; i < PAD_SEGMENTS; i++) {
      const t = (i / PAD_SEGMENTS) * Math.PI * 2;
      mb.vert(cx + Math.cos(t) * radius, y, cz + Math.sin(t) * radius, 0, 1, 0, col, 0.5 + Math.cos(t) * 0.5, 0.5 + Math.sin(t) * 0.5);
    }
    for (let i = 0; i < PAD_SEGMENTS; i++) mb.tri(centre, first + ((i + 1) % PAD_SEGMENTS), first + i);
  }

  /* interpolated design height of a polyline at the sample whose `a` (or distance) is closest */
  function nearestSample(road, x, z) {
    let best = Infinity; let hit = road.pts[0];
    road.pts.forEach((p) => { const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < best) { best = d; hit = p; } });
    return hit;
  }

  /* ---- one crossing */
  function build(crossing, plan, opts) {
    const quality = (opts && opts.quality) || 'medium';
    const mats = materials();
    const group = new T.Group();
    group.name = 'crossing-road-' + crossing.index;
    const asphalt = new MB(); const gravel = new MB(); const paint = new MB(); const post = new MB(); const sign = new MB();
    const SH = TS.crossingRoads.SHOULDER;
    const lift = TS.crossingRoads.ROAD_LIFT;
    const junctionOf = (road) => crossing.junctions.find((j) => road.id === 'p' + crossing.index + (j.sd > 0 ? 'r' : 'l'));

    crossing.roads.forEach((road) => {
      const pts = road.pts;
      if (pts.length < 2) return;
      if (road.kind === 'gravel') {
        ribbon(gravel, pts, -road.hw, road.hw, 0, (p) => { const k = 0.9 + 0.1 * Math.sin(p.u * 0.37 + p.x); return [k, k, k]; }, 4);
        // turning places at the dead ends of a gravel lane
        if (road.role === 'tail') disc(gravel, pts[pts.length - 1].x, pts[pts.length - 1].z, pts[pts.length - 1].yT + lift, PAD_RADIUS, [0.95, 0.95, 0.95]);
        else if (road.role === 'parallel') [pts[0], pts[pts.length - 1]].forEach((e) => disc(gravel, e.x, e.z, e.yT + lift, PAD_RADIUS, [0.95, 0.95, 0.95]));
        return;
      }
      const junction = junctionOf(road);
      const mouth = junction ? junction.hwCross + TS.crossingRoads.FILLET + 0.6 : 0;
      const nearSign = junction ? -junction.sd : 0;               // lateral side (+1 right of the track) that faces the track
      const inMouth = (i) => !!junction && Math.abs(pts[i].a) < mouth && Math.abs(pts[i + 1].a) < mouth + 4;
      // asphalt + verges
      ribbon(asphalt, pts, -road.hw, road.hw, 0, wearColor, 4);
      if (junction) {
        ribbon(gravel, pts, -road.hw - SH, -road.hw, -0.004, null, 2, nearSign < 0 ? inMouth : null);
        ribbon(gravel, pts, road.hw, road.hw + SH, -0.004, null, 2, nearSign > 0 ? inMouth : null);
      } else {
        ribbon(gravel, pts, -road.hw - SH, -road.hw, -0.004, null, 2);
        ribbon(gravel, pts, road.hw, road.hw + SH, -0.004, null, 2);
      }
      // white edge lines
      const eo = road.hw - EDGE_LINE_OFFSET;
      const ln = (o, skip) => ribbon(paint, pts, o - EDGE_LINE_HALF, o + EDGE_LINE_HALF, LINE_LIFT, () => LINE, 1, skip);
      ln(-eo, junction && nearSign < 0 ? inMouth : null);
      ln(eo, junction && nearSign > 0 ? inMouth : null);
      // dashed centre line on the road that runs parallel to the line
      if (road.role === 'parallel') {
        const dash = (i) => (pts[i].u % DASH_PERIOD) >= DASH_ON || (pts[i + 1].u % DASH_PERIOD) < 0.01;
        ribbon(paint, pts, -EDGE_LINE_HALF, EDGE_LINE_HALF, LINE_LIFT, () => LINE, 1, dash);
      }
    });

    // T junction corners (a fan between the two road edges, rounded)
    crossing.junctions.forEach((j) => {
      const cross = crossing.roads.find((r) => r.id === 'x' + crossing.index + (j.sd > 0 ? 'r' : 'l'));
      const par = crossing.roads.find((r) => r.id === 'p' + crossing.index + (j.sd > 0 ? 'r' : 'l'));
      if (!cross || !par) return;
      const R = TS.crossingRoads.FILLET;
      const yPar = (a) => {
        let best = par.pts[0]; let bd = Infinity;
        par.pts.forEach((p) => { const d = Math.abs(p.a - a); if (d < bd) { bd = d; best = p; } });
        return best.yT;
      };
      const yCrossEnd = cross.pts[cross.pts.length - 1].yT;
      [-1, 1].forEach((q) => {
        const lEdge = j.l - j.sd * j.hwPar;            // the parallel road's edge facing the track
        const verts = [];
        const O = { a: q * (j.hwCross + R), l: lEdge - j.sd * R };
        const toWorld = (a, l) => plan.world(crossing.s + a, l);
        const yAt = (a, l) => {
          const t = clamp(1 - Math.abs(l - lEdge) / R, 0, 1);
          return lerp(yPar(a), lerp(yPar(a), yCrossEnd, 0.5), t) + lift + 0.002;
        };
        const corner = { a: q * j.hwCross, l: lEdge };
        verts.push(corner);
        // arc from the cross road's edge (a = q*hwCross, l = lEdge - sd*R) round to the parallel road's edge (a = q*(hwCross+R), l = lEdge)
        for (let k = 0; k <= FILLET_STEPS; k++) {
          const t = (k / FILLET_STEPS) * (Math.PI / 2);
          verts.push({ a: O.a - q * R * Math.cos(t), l: O.l + j.sd * R * Math.sin(t) });
        }
        const idx = verts.map((v) => { const w = toWorld(v.a, v.l); return asphalt.vert(w.x, yAt(v.a, v.l), w.z, 0, 1, 0, WHITE, v.a / 4, v.l / 4); });
        for (let k = 1; k < idx.length - 1; k++) {
          // winding: make the triangle face up
          const A = [asphalt.p[idx[0] * 3], asphalt.p[idx[0] * 3 + 2]]; const B = [asphalt.p[idx[k] * 3], asphalt.p[idx[k] * 3 + 2]]; const C = [asphalt.p[idx[k + 1] * 3], asphalt.p[idx[k + 1] * 3 + 2]];
          const cz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
          if (cz > 0) asphalt.tri(idx[0], idx[k + 1], idx[k]); else asphalt.tri(idx[0], idx[k], idx[k + 1]);
        }
      });
    });

    // signs on the cross roads: warning triangle and the three / two / one stripe markers (right of the approaching traffic), yield sign at the junction
    const signMats = [];
    void signMats;
    crossing.roads.filter((r) => r.role === 'cross' && r.kind === 'asphalt').forEach((road) => {
      const pts = road.pts;
      const at = (u) => {
        const uu = clamp(u, 0, road.len);
        let i = 0; while (i < pts.length - 2 && pts[i + 1].u < uu) i++;
        const a = pts[i]; const b = pts[i + 1]; const t = (uu - a.u) / ((b.u - a.u) || 1);
        return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: lerp(a.yT, b.yT, t) + lift, tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t) };
      };
      const uw = clamp(road.len - 6, 9, 27);
      const placeSign = (u, tile, w, h, zc) => {
        const p = at(u); const r = rightOf(p);
        const off = -(road.hw + SH + SIGN_SIDE_GAP);      // the right-hand side of traffic that drives towards the crossing (heading -u)
        const x = p.x + r[0] * off; const z = p.z + r[1] * off;
        post.box(x, p.y + SIGN_POST_H / 2, z, 0.07, SIGN_POST_H, 0.07, POST);
        const cy = p.y + SIGN_POST_H - h / 2 + (zc || 0);
        const face = [p.tx, 0, p.tz];
        const hw = w / 2;
        const sd = rightOf(p);
        const fx = x + p.tx * 0.05; const fz = z + p.tz * 0.05;
        sign.quadFacing([fx - sd[0] * hw, cy - h / 2, fz - sd[1] * hw], [fx + sd[0] * hw, cy - h / 2, fz + sd[1] * hw], [fx + sd[0] * hw, cy + h / 2, fz + sd[1] * hw], [fx - sd[0] * hw, cy + h / 2, fz - sd[1] * hw], face, WHITE, tileUV(tile));
        const bx = x - p.tx * 0.03; const bz = z - p.tz * 0.03;
        sign.quadFacing([bx - sd[0] * hw, cy - h / 2, bz - sd[1] * hw], [bx + sd[0] * hw, cy - h / 2, bz + sd[1] * hw], [bx + sd[0] * hw, cy + h / 2, bz + sd[1] * hw], [bx - sd[0] * hw, cy + h / 2, bz - sd[1] * hw], [-face[0], 0, -face[2]], WHITE, tileUV(TILE.grey));
      };
      placeSign(uw, TILE.warn, 0.95, 0.95, 0);
      placeSign(Math.max(2.5, uw - 6), TILE.bake3, 0.38, 1.1, -0.25);
      placeSign(Math.max(2.0, uw - 12), TILE.bake2, 0.38, 1.1, -0.25);
      placeSign(Math.max(1.5, uw - 18), TILE.bake1, 0.38, 1.1, -0.25);
      // yield sign on the right-hand side where the road meets the parallel road
      const j = crossing.junctions.find((jj) => road.id === 'x' + crossing.index + (jj.sd > 0 ? 'r' : 'l'));
      if (j) placeSign(Math.max(2.5, road.len - 1.2), TILE.yield, 0.9, 0.9, 0);
    });

    const add = (mb, mat, shadow) => {
      if (mb.empty) return;
      const mesh = new T.Mesh(mb.geometry(), mat);
      mesh.receiveShadow = shadow !== false;
      mesh.castShadow = false;
      group.add(mesh);
    };
    add(asphalt, mats.asphalt);
    add(gravel, mats.gravel);
    add(paint, mats.paint);
    add(post, mats.post, false);
    if (!sign.empty) {
      const m = new T.Mesh(sign.geometry(), mats.sign);
      m.castShadow = quality === 'high';
      group.add(m);
    }
    void nearestSample;
    return group;
  }

  TS.crossingRoadsMesh = Object.freeze({ build, MB });
})();
