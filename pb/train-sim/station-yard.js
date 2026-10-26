/* Lokféierer: the yard of a big station from its patch (TS.stationYard.build), called by station-surround-mesh.js for a patch whose style has `yard`.
 *
 * The photo-modelled stations draw their own few extra tracks; a terminal like Lëtzebuerg Gare Centrale has 12 tracks, 6 platforms and a kilometre of canopies, so
 * they come from the real data of the patch (OSM tracks and platforms, LOD2 roofs), in the patch frame and through world(x, z) like everything else of the patch:
 *   - every real track as a ballast bed with painted sleepers, two rails and a contact wire (curved with the real layout, converging at both ends),
 *   - the platforms as raised paved slabs (pavers, tactile band) with their edge walls,
 *   - the platform canopies from their LOD2 roof faces (glass / steel), with slender steel columns standing on the platforms under them (nothing floats),
 *   - the Luxtram tracks of the forecourt (kind 'tram': flush rails in a paved bed),
 *   - platform furniture: "Voie" signs, benches, lamps; props of the forecourt (station-yard-props.js).
 * style.yard = { canopies: [LOD2 building ids], platformTop: 0.77, platformFrom: -25 (x of the first rail platform), voie: { <platform index>: 'Voie 1' } }.  Everything is painted. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;

  const GAUGE_HALF = 0.7175;
  const RAIL_HEAD = 0.55;               // rail head above the formation (the game's track)
  const BED_TOP = 0.36;                 // ballast / sleeper top above the formation
  const BED_HALF_TOP = 1.75;
  const BED_HALF_BASE = 2.55;
  const SAMPLE = 3;                     // polyline resampling (m)
  const SKIP_MAIN_X = 2.2;              // a real track this close to the player's track everywhere is the player's own
  const WIRE_H = 5.3;                   // contact wire above the rail head
  const COLUMN_STEP = 12;
  const GRID_STEP = 14;                 // columns under a roof that has no platform or track below
  const MIN_COLUMN_H = 2.4;
  const MAX_COLUMN_H = 16;
  const TRAM_BED_HALF = 1.55;
  const sleeperRepeat = 2.6;            // metres of track per texture repeat (4 sleepers)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const texCache = new Map();
  function canvasTexture(key, w, h, draw) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = T.RepeatWrapping;
    texCache.set(key, t);
    return t;
  }
  const ballastTexture = () => canvasTexture('yard:ballast', 128, 128, (c, w, h) => {
    const r = mulberry(11);
    c.fillStyle = '#7c7a76'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 90 + r() * 80; c.fillStyle = 'rgba(' + v + ',' + v + ',' + (v - 4) + ',0.55)'; c.fillRect(r() * w, r() * h, 2, 2); }
    // four concrete sleepers across the 2.6 m repeat, 2.6 m long (the strip is 3.5 m wide)
    for (let k = 0; k < 4; k++) {
      const y = (k + 0.5) * (h / 4) - 5;
      c.fillStyle = '#9a9892'; c.fillRect(w * 0.13, y, w * 0.74, 10);
      c.fillStyle = 'rgba(40,40,40,0.35)'; c.fillRect(w * 0.13, y + 8, w * 0.74, 2);
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(w * 0.13, y, w * 0.74, 2);
    }
  });
  const paverTexture = () => canvasTexture('yard:pavers', 128, 128, (c, w, h) => {
    const r = mulberry(23);
    c.fillStyle = '#868a90'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 32) {
      const v = 128 + Math.floor(r() * 30);
      c.fillStyle = 'rgb(' + v + ',' + (v + 2) + ',' + (v + 6) + ')'; c.fillRect(x + ((y / 16) % 2) * 16 + 1, y + 1, 30, 14);
    }
  });
  const glassTexture = () => canvasTexture('yard:glass', 128, 128, (c, w, h) => {
    const r = mulberry(5);
    c.fillStyle = '#b9c6d2'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,80,100,0.10)'; c.fillRect(r() * w, r() * h, 12, 5); }
    c.fillStyle = '#5b6168';                               // steel frame: a grid of glazing bars
    for (let i = 0; i < 4; i++) { c.fillRect(i * (w / 4), 0, 3, h); c.fillRect(0, i * (h / 4), w, 3); }
  });
  function signTexture(text) {
    return canvasTexture('yard:sign:' + text, 256, 96, (c, w, h) => {
      c.fillStyle = '#0b3f8c'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff'; c.fillRect(6, 6, w - 12, 3); c.fillRect(6, h - 9, w - 12, 3);
      c.fillStyle = '#ffffff'; c.font = 'bold 54px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 2);
    });
  }

  /* point in polygon (2D) */
  function inRing(ring, x, z) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > z) !== (ring[j][1] > z) && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
    }
    return c;
  }
  /* resample a polyline [[x, z, y?], ...] at ~step metres (keeps the end points) */
  function resample(pts, step) {
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]; const b = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let d = step - carry;
      while (d < len) { const t = d / len; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t]); d += step; }
      carry = len - (d - step);
    }
    const last = pts[pts.length - 1];
    if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > 0.5) out.push([last[0], last[1], last[2] || 0]);
    return out;
  }

  /* ribbon along a world polyline: for each point a left / right offset; `rows` = [{ w: {x, z}, dx, dz (unit tangent), y }] */
  function ribbon(mb, rows, offA, offB, yA, yB, colA, colB, uvA, uvB, normalUp) {
    const ids = rows.map((r, i) => {
      const nx = -r.dz; const nz = r.dx;     // left normal in world xz
      const a = mb.vert(r.x + nx * offA, r.y + yA, r.z + nz * offA, 0, normalUp, 0, colA, uvA, r.v);
      const b = mb.vert(r.x + nx * offB, r.y + yB, r.z + nz * offB, 0, normalUp, 0, colB, uvB, r.v);
      return [a, b, i];
    });
    for (let i = 0; i + 1 < ids.length; i++) mb.i.push(ids[i][0], ids[i][1], ids[i + 1][0], ids[i + 1][0], ids[i][1], ids[i + 1][1]);
  }

  function build(o) {
    const { patch, data, world, track, group, disposables, MB, triangulate2, triangulate3, stats, style } = o;
    const Y = style.yard || {};
    const platTop = Y.platformTop === undefined ? 0.77 : Y.platformTop;
    const platFrom = Y.platformFrom === undefined ? -25 : Y.platformFrom;
    const add = (mesh, castShadow) => { mesh.castShadow = !!castShadow; mesh.receiveShadow = true; group.add(mesh); disposables.push(mesh.geometry); stats.tris += mesh.geometry.index.count / 3; return mesh; };
    const mat = (m) => { disposables.push(m); return m; };
    const wired = [];

    /* ---- world polyline rows of a patch polyline: positions, unit tangents, formation height, running length */
    const rowsOf = (pts, lift) => {
      const rs = resample(pts, SAMPLE).map((p) => { const w = world(p[0], p[1]); return { x: w.x, z: w.z, y: w.form + (p[2] || 0) + (lift || 0), px: p[0], pz: p[1] }; });
      let run = 0;
      rs.forEach((r, i) => {
        const a = rs[Math.max(0, i - 1)]; const b = rs[Math.min(rs.length - 1, i + 1)];
        const dx = b.x - a.x; const dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
        r.dx = dx / l; r.dz = dz / l;
        if (i > 0) run += Math.hypot(r.x - rs[i - 1].x, r.z - rs[i - 1].z);
        r.v = run / sleeperRepeat;
      });
      return rs;
    };

    /* ---- tracks */
    {
      const bed = new MB(); const rails = new MB(); const wireLines = [];
      const BED_COL = [1, 1, 1]; const SHOULDER = [0.7, 0.68, 0.64]; const RAIL_COL = [0.5, 0.46, 0.42]; const RAIL_TOP = [0.62, 0.6, 0.58];
      let n = 0;
      (data.rails || []).forEach((r, ri) => {
        if (r.kind === 'tram' || !r.pts || r.pts.length < 2) return;
        if (r.pts.every((p) => Math.abs(p[0]) < SKIP_MAIN_X)) return;
        const rows = rowsOf(r.pts, 0);
        if (rows.length < 2) return;
        n += 1;
        const lift = 0.002 * (ri % 8);
        // ballast: flat top with sleepers, shoulders sloping to the ground
        ribbon(bed, rows, BED_HALF_TOP, -BED_HALF_TOP, BED_TOP + lift, BED_TOP + lift, BED_COL, BED_COL, 0, 1, 1);
        ribbon(bed, rows.map((q) => Object.assign({}, q, { v: 0.5 })), BED_HALF_BASE, BED_HALF_TOP, 0.02, BED_TOP + lift - 0.01, SHOULDER, SHOULDER, 0.5, 0.5, 1);
        ribbon(bed, rows.map((q) => Object.assign({}, q, { v: 0.5 })), -BED_HALF_TOP, -BED_HALF_BASE, BED_TOP + lift - 0.01, 0.02, SHOULDER, SHOULDER, 0.5, 0.5, 1);
        // rails: a head ribbon (top) and the two flanks
        [-GAUGE_HALF, GAUGE_HALF].forEach((side) => {
          const y0 = BED_TOP + lift; const y1 = RAIL_HEAD + lift;
          ribbon(rails, rows, side + 0.045, side - 0.045, y1, y1, RAIL_TOP, RAIL_TOP, 0, 0, 1);
          ribbon(rails, rows, side + 0.045, side + 0.045, y0, y1, RAIL_COL, RAIL_COL, 0, 0, 1);
          ribbon(rails, rows, side - 0.045, side - 0.045, y1, y0, RAIL_COL, RAIL_COL, 0, 0, 1);
        });
        for (let i = 0; i + 1 < rows.length; i++) {
          const a = rows[i]; const b = rows[i + 1];
          wireLines.push(a.x, a.y + RAIL_HEAD + WIRE_H, a.z, b.x, b.y + RAIL_HEAD + WIRE_H, b.z);
        }
      });
      if (!bed.empty) {
        const m = mat(new T.MeshLambertMaterial({ map: ballastTexture(), vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        add(new T.Mesh(bed.geometry(), m));
      }
      if (!rails.empty) add(new T.Mesh(rails.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))));
      if (wireLines.length) {
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(wireLines, 3));
        const l = new T.LineSegments(g, mat(new T.LineBasicMaterial({ color: 0x2c2f33 })));
        group.add(l); disposables.push(g);
      }
      stats.yardTracks = n;
    }

    /* ---- platforms: raised paved slabs with a tactile band along the track edges */
    const railPlatforms = (data.platforms || []).filter((p) => p.ring && p.ring.length > 2 && p.ring.every((q) => q[0] > platFrom));
    {
      const top = new MB(); const side = new MB(); const band = new MB();
      railPlatforms.forEach((p) => {
        const ring = p.ring;
        const ws = ring.map((q) => world(q[0], q[1]));
        const tris = triangulate2(ring);
        const ids = ring.map((q, i) => top.vert(ws[i].x, ws[i].form + platTop, ws[i].z, 0, 1, 0, [1, 1, 1], q[0] / 3, q[1] / 3));
        for (let t = 0; t < tris.length; t += 3) top.i.push(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
        let area = 0;
        ring.forEach((q, i) => { const b = ring[(i + 1) % ring.length]; area += q[0] * b[1] - b[0] * q[1]; });
        const sgn = area >= 0 ? 1 : -1;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]; const b = ring[(i + 1) % ring.length];
          const wa = ws[i]; const wb = ws[(i + 1) % ring.length];
          const dx = b[0] - a[0]; const dz = b[1] - a[1]; const len = Math.hypot(dx, dz);
          if (len < 0.3) continue;
          // edge wall (down to below the ground)
          const ex = dz / len * sgn; const ez = -dx / len * sgn;      // outward in patch (x, z) for the polygon winding
          const nW = world(a[0] + ex, a[1] + ez); const nx = nW.x - wa.x; const nz = nW.z - wa.z; const nl = Math.hypot(nx, nz) || 1;
          const v0 = side.vert(wa.x, wa.form + platTop, wa.z, nx / nl, 0, nz / nl, [0.62, 0.62, 0.6], 0, 0);
          const v1 = side.vert(wb.x, wb.form + platTop, wb.z, nx / nl, 0, nz / nl, [0.62, 0.62, 0.6], 1, 0);
          const v2 = side.vert(wb.x, wb.form - 0.4, wb.z, nx / nl, 0, nz / nl, [0.4, 0.4, 0.4], 1, 1);
          const v3 = side.vert(wa.x, wa.form - 0.4, wa.z, nx / nl, 0, nz / nl, [0.4, 0.4, 0.4], 0, 1);
          side.i.push(v0, v1, v2, v0, v2, v3);
          // tactile band along the long edges that run with the track
          if (Math.abs(dx) < Math.abs(dz) * 0.25 && len > 6) {
            const BAND = 0.9;
            const ia = [a[0] - ex * BAND, a[1] - ez * BAND]; const ib = [b[0] - ex * BAND, b[1] - ez * BAND];
            const wia = world(ia[0], ia[1]); const wib = world(ib[0], ib[1]);
            const yy = platTop + 0.012;
            const c = [0.78, 0.74, 0.62];
            const q0 = band.vert(wa.x, wa.form + yy, wa.z, 0, 1, 0, c, 0, 0); const q1 = band.vert(wb.x, wb.form + yy, wb.z, 0, 1, 0, c, 1, 0);
            const q2 = band.vert(wib.x, wib.form + yy, wib.z, 0, 1, 0, c, 1, 1); const q3 = band.vert(wia.x, wia.form + yy, wia.z, 0, 1, 0, c, 0, 1);
            band.i.push(q0, q1, q2, q0, q2, q3);
            const w0 = world(a[0] - ex * 0.12, a[1] - ez * 0.12); const w1 = world(b[0] - ex * 0.12, b[1] - ez * 0.12);
            const wh = [0.95, 0.95, 0.93]; const yw = yy + 0.004;
            const p0 = band.vert(wa.x, wa.form + yw, wa.z, 0, 1, 0, wh, 0, 0); const p1 = band.vert(wb.x, wb.form + yw, wb.z, 0, 1, 0, wh, 1, 0);
            const p2 = band.vert(w1.x, w1.form + yw, w1.z, 0, 1, 0, wh, 1, 1); const p3 = band.vert(w0.x, w0.form + yw, w0.z, 0, 1, 0, wh, 0, 1);
            band.i.push(p0, p1, p2, p0, p2, p3);
          }
        }
      });
      if (!top.empty) add(new T.Mesh(top.geometry(), mat(new T.MeshLambertMaterial({ map: paverTexture(), vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }))));
      if (!side.empty) add(new T.Mesh(side.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }))));
      if (!band.empty) add(new T.Mesh(band.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }))));
    }

    /* ---- canopies: the LOD2 roofs of the platform roofs, columns under them */
    {
      const ids = new Set(Y.canopies || []);
      const roof = new MB(); const faces = [];
      (data.buildings || []).forEach((b) => {
        if (!ids.has(b.id)) return;
        (b.roofs || []).forEach((ring) => {
          if (ring.length < 3) return;
          const { tris, normal } = triangulate3(ring);
          if (!tris.length) return;
          const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
          if (nl < 1e-6) return;
          let nx = normal[0] / nl; let ny = normal[1] / nl; let nz = normal[2] / nl;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const vids = ring.map((p) => { const w = world(p[0], p[2]); return roof.vert(w.x, w.form + p[1], w.z, 0, 1, 0, [1, 1, 1], p[0] / 3, p[2] / 3); });
          for (let t = 0; t < tris.length; t += 3) roof.i.push(vids[tris[t]], vids[tris[t + 1]], vids[tris[t + 2]]);
          if (ny > 0.2) {
            const xs = ring.map((p) => p[0]); const zs = ring.map((p) => p[2]);
            faces.push({ ring2: ring.map((p) => [p[0], p[2]]), x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), a: nx, b: ny, c: nz, d: -(nx * ring[0][0] + ny * ring[0][1] + nz * ring[0][2]) });
          }
        });
      });
      if (!roof.empty) add(new T.Mesh(roof.geometry(), mat(new T.MeshLambertMaterial({ map: glassTexture(), side: T.DoubleSide, color: 0xdfe6ec, emissive: 0x626b75 }))), false);
      const roofAt = (x, z) => {
        let best = null;
        faces.forEach((f) => {
          if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1 || !inRing(f.ring2, x, z)) return;
          const y = -(f.a * x + f.c * z + f.d) / f.b;
          if (best === null || y < best) best = y;
        });
        return best;
      };
      const cols = new MB(); const signs = []; const dark = [0.34, 0.37, 0.41];
      railPlatforms.forEach((p, pi) => {
        const xs = p.ring.map((q) => q[0]); const zs = p.ring.map((q) => q[1]);
        const x0 = Math.min(...xs); const x1 = Math.max(...xs); const z0 = Math.min(...zs); const z1 = Math.max(...zs);
        const xc = (x0 + x1) / 2;
        for (let z = Math.ceil((z0 + 6) / COLUMN_STEP) * COLUMN_STEP; z < z1 - 4; z += COLUMN_STEP) {
          if (!inRing(p.ring, xc, z)) continue;
          const y = roofAt(xc, z);
          if (y === null) continue;
          const h = y - platTop;
          if (h < MIN_COLUMN_H || h > MAX_COLUMN_H) continue;
          const w = world(xc, z);
          cols.box(w.x, w.form + platTop + h / 2, w.z, 0.34, h, 0.34, dark);
          cols.box(w.x, w.form + y - 0.18, w.z, 0.7, 0.3, 0.7, dark);
          if (Math.round(z / COLUMN_STEP) % 3 === 0) signs.push({ w, y: w.form + platTop + Math.min(h - 0.6, 4.4), pi, z });
        }
      });
      /* roof areas that are neither over a platform nor over a track (a bus station canopy, a roofed forecourt): a grid of columns standing on the ground */
      {
        const near = new Set();
        const key = (x, z) => Math.round(x / 4) + ',' + Math.round(z / 4);
        (data.rails || []).forEach((r) => { if (r.kind === 'tram' || !r.pts) return; resample(r.pts, 2).forEach((q) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) near.add(key(q[0] + dx * 4, q[1] + dz * 4)); }); });
        railPlatforms.forEach((p) => { const xs = p.ring.map((q) => q[0]); const zs = p.ring.map((q) => q[1]); for (let x = Math.min(...xs); x <= Math.max(...xs); x += 3) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 3) if (inRing(p.ring, x, z)) near.add(key(x, z)); });
        for (let x = -150; x <= 160; x += GRID_STEP) for (let z = -320; z <= 320; z += GRID_STEP) {
          const y = roofAt(x, z);
          if (y === null || near.has(key(x, z))) continue;
          const w = world(x, z);
          const gy = track.terrainHeightAt(w.x, w.z);
          const h = w.form + y - gy;
          if (h < MIN_COLUMN_H || h > MAX_COLUMN_H) continue;
          cols.box(w.x, gy + h / 2, w.z, 0.3, h, 0.3, dark);
        }
      }
      if (!cols.empty) add(new T.Mesh(cols.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true }))), true);
      stats.yardColumns = cols.i.length / 36;
      if (TS.stationYardProps) TS.stationYardProps.build(Object.assign({}, o, { signs, railPlatforms, platTop, add, mat, canvasTexture, signTexture, inRing, rowsOf, resample }));
    }

    /* ---- the Luxtram tracks of the forecourt: rails flush in a paved bed */
    {
      const bed = new MB(); const rails = new MB();
      (data.rails || []).forEach((r) => {
        if (r.kind !== 'tram' || !r.pts || r.pts.length < 2) return;
        const rows = rowsOf(r.pts, 0).map((q) => Object.assign({}, q, { y: track.terrainHeightAt(q.x, q.z) + 0.17 }));
        const BED = [0.07, 0.075, 0.085];
        ribbon(bed, rows, TRAM_BED_HALF, -TRAM_BED_HALF, 0.0, 0.0, BED, BED, 0, 1, 1);
        [-GAUGE_HALF, GAUGE_HALF].forEach((sd) => {
          ribbon(rails, rows, sd + 0.05, sd - 0.05, 0.03, 0.03, [0.3, 0.3, 0.3], [0.3, 0.3, 0.3], 0, 0, 1);
        });
      });
      if (!bed.empty) add(new T.Mesh(bed.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }))));
      if (!rails.empty) add(new T.Mesh(rails.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }))));
    }
    void wired; void clamp;
  }

  TS.stationYard = Object.freeze({ build, inRing, resample });
})();
