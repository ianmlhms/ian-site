/* Kart Lëtzebuerg — a real street fabric from baked OpenStreetMap footprints (data-<track>.js, © OpenStreetMap contributors, ODbL):
 * extruded buildings with painted facades and slate roofs, kept clear of the track (pushed away from the pavement), parks/streets painted
 * onto a top-down ground map, and the mapped street trees. Rendering side only (uses THREE for triangulation). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE;
  const { clamp, lerp } = KL;
  const FLOOR = 3.3, BAY = 4.4, CELL = 24, CHUNK = 160;

  const decode = (a) => { const o = []; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i] / 10, a[i + 1] / 10]); return o; };
  const signedArea = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; };
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };

  /* spatial index over the track samples: nearest centre-line sample within ~48 m */
  function trackIndex(track) {
    const g = new Map(), key = (gx, gz) => (gx + 2000) * 4096 + (gz + 2000);
    for (let i = 0; i < track.N; i++) { const k = key(Math.floor(track.X[i] / CELL), Math.floor(track.Z[i] / CELL)); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(i); }
    return {
      nearest(x, z) {
        const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL); let best = -1, bd = 1e18;
        for (let ax = -2; ax <= 2; ax++) for (let az = -2; az <= 2; az++) {
          const a = g.get(key(gx + ax, gz + az)); if (!a) continue;
          for (const i of a) { const dx = x - track.X[i], dz = z - track.Z[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
        }
        return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
      },
    };
  }

  /* ring samples (vertices + points every <=3 m along the edges) */
  function ringSamples(p) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
    }
    return out;
  }

  /* minimum-area oriented box: {cx, cz, ux, uz, w (along u), d (along perpendicular), area} */
  function obb(p) {
    let best = null;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue;
      const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const q of p) { const u = q[0] * ux + q[1] * uz, v = -q[0] * uz + q[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const ar = (u1 - u0) * (v1 - v0);
      if (!best || ar < best.area) { const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; best = { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, w: u1 - u0, d: v1 - v0, area: ar }; }
    }
    return best;
  }

  /* convex-ish helper: add a face and flip it so its normal points away from (ox, oy, oz) */
  function faceOut(B, pts, col, ox, oy, oz) {
    const a = pts[0], b = pts[1], c = pts[2];
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let fx = 0, fy = 0, fz = 0; for (const q of pts) { fx += q[0]; fy += q[1]; fz += q[2]; } fx /= pts.length; fy /= pts.length; fz /= pts.length;
    const out = nx * (fx - ox) + ny * (fy - oy) + nz * (fz - oz) >= 0;
    const q = out ? pts : pts.slice().reverse();
    if (q.length === 3) B.tri(q[0], q[1], q[2], col); else B.quad(q[0], q[1], q[2], q[3], col);
  }

  function gableRoof(B, o, y0, h, col, hip) {
    const L = Math.max(o.w, o.d) + 0.7, W = Math.min(o.w, o.d) + 0.7;
    const ax = o.w >= o.d ? [o.ux, o.uz] : [-o.uz, o.ux], bx = [-ax[1], ax[0]];
    const P = (lu, lv, y) => [o.cx + ax[0] * lu + bx[0] * lv, y, o.cz + ax[1] * lu + bx[1] * lv];
    const hl = L / 2, hw = W / 2, cx = o.cx, cz = o.cz, cy = y0 + h * 0.4;
    const sh = (k) => KL.shade(col, k);
    const inset = hip ? Math.min(hw, hl * 0.45) : 0;
    const r1 = P(-hl + inset, 0, y0 + h), r2 = P(hl - inset, 0, y0 + h);
    const A = P(-hl, -hw, y0), Bq = P(hl, -hw, y0), C = P(hl, hw, y0), D = P(-hl, hw, y0);
    faceOut(B, [A, Bq, r2, r1], sh(0.84), cx, cy, cz); faceOut(B, [C, D, r1, r2], sh(1.08), cx, cy, cz);
    faceOut(B, hip ? [D, A, r1] : [D, A, r1], sh(0.95), cx, cy, cz); faceOut(B, [Bq, C, r2], sh(0.9), cx, cy, cz);
  }

  function triangulate(ring) {
    const v = ring.map((q) => new T.Vector2(q[0], q[1]));
    return T.ShapeUtils.triangulateShape(v, []);
  }

  KL.scenery.osmCity = function osmCity(track, theme, data, rnd, terrain, quality) {
    const idx = trackIndex(track), noBuild = track.def.noBuild || [];
    const chunks = new Map(), footprints = [];
    const pal = (theme.palette || ['#f0e5cd', '#e8d6b4', '#dcc7a2', '#efe2c8', '#cdbb9c', '#e9cdbd', '#d9d3c3', '#c9ced2', '#f2dfb0', '#e4c9b0']).map(KL.col);
    const roofPal = (theme.roofs || ['#4a505c', '#434955', '#58606b', '#3c424d', '#4d5562', '#5b4a48', '#7d4a3b']).map(KL.col);
    const stone = KL.col('#bdb29c');
    const getChunk = (x, z) => {
      const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK); let c = chunks.get(k);
      if (!c) { c = { walls: new KL.Batch(), roofs: new KL.Batch(), extra: new KL.Batch(), found: new KL.Batch(), trees: new KL.Batch(), x: Math.floor(x / CHUNK) * CHUNK, z: Math.floor(z / CHUNK) * CHUNK }; chunks.set(k, c); }
      return c;
    };
    const maxDist = theme.cityRadius || 420;        // drop buildings far from the track (fog hides them anyway)
    let count = 0, pushed = 0, dropped = 0;

    for (const [lv, kind, flatPts] of data.b) {
      let p = decode(flatPts);
      let cx = 0, cz = 0; for (const q of p) { cx += q[0]; cz += q[1]; } cx /= p.length; cz /= p.length;
      // far away? (cheap test against the track bounding area using the index is limited to 48 m, so use a coarse bound)
      if (theme.cityBounds && (cx < theme.cityBounds[0] || cx > theme.cityBounds[1] || cz < theme.cityBounds[2] || cz > theme.cityBounds[3])) continue;
      let skip = false;
      for (const nb of noBuild) { if (Math.hypot(cx - nb[0], cz - nb[1]) < nb[2]) { skip = true; break; } for (const q of p) if (Math.hypot(q[0] - nb[0], q[1] - nb[1]) < nb[2] * 0.8) { skip = true; break; } if (skip) break; }
      if (skip) continue;
      // the track runs through the footprint -> drop
      let onRoad = false;
      const n0 = idx.nearest(cx, cz);
      if (n0 && n0.d < 80) {
        let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const q of p) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]); }
        for (let i = 0; i < track.N; i++) { const x = track.X[i], z = track.Z[i]; if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue; if (inPoly(x, z, p)) { onRoad = true; break; } }
      }
      if (onRoad) { dropped++; continue; }
      // keep clear of the pavement edge: push the whole building away from the track
      const samples0 = ringSamples(p);
      let px = 0, pz = 0, ok = true;
      for (let it = 0; it < 5; it++) {
        let worst = -1e9, wdx = 0, wdz = 0;
        for (const s of samples0) {
          const sx = s[0] + px, sz = s[1] + pz, n = idx.nearest(sx, sz); if (!n) continue;
          const i = n.i, lat = (sx - track.X[i]) * -track.TZ[i] + (sz - track.Z[i]) * track.TX[i];
          const need = track.HW[i] + (lat < 0 ? track.WL[i] : track.WR[i]) + (theme.cityGap != null ? theme.cityGap : 1.1);
          const v = need - n.d;
          if (v > worst) { worst = v; wdx = (sx - track.X[i]) / (n.d || 1); wdz = (sz - track.Z[i]) / (n.d || 1); }
        }
        if (worst <= 0) break;
        px += wdx * (worst + 0.05); pz += wdz * (worst + 0.05);
        if (Math.hypot(px, pz) > 11) { ok = false; break; }
      }
      if (!ok) { dropped++; continue; }
      if (px || pz) { p = p.map((q) => [q[0] + px, q[1] + pz]); cx += px; cz += pz; pushed++; }
      const nearT = idx.nearest(cx, cz);
      if (!theme.cityKeepFar && !nearT) { const n2 = trackFarDist(track, cx, cz); if (n2 > maxDist) continue; }

      const area = Math.abs(signedArea(p));
      let floors = lv;
      if (!floors) floors = kind === 2 ? 1 : kind === 3 ? 3 : kind === 1 ? 5 : (area > 500 ? 5 : 4) + (rnd() < 0.35 ? 1 : 0);
      floors = clamp(floors, 1, 9);
      const hgt = floors * FLOOR + (floors > 4 ? 0 : 0.4);
      let ymin = 0; for (const q of p) ymin = Math.min(ymin, terrain(q[0], q[1]));
      const y0 = ymin - 0.3;
      const C = getChunk(cx, cz);
      const base = pal[Math.floor(rnd() * pal.length)], tint = KL.shade(base, 0.93 + rnd() * 0.12);
      const uOff = Math.floor(rnd() * 4) / 4, rowSeed = Math.floor(rnd() * 7);
      // walls: ring is counter-clockwise in (x, z) (positive shoelace), outward normal = (dz, -dx)
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.4) continue;
        const nb = Math.max(1, Math.round(len / BAY)), u0 = uOff, u1 = uOff + nb / 4;
        const dxn = (b[0] - a[0]) / len, dzn = (b[1] - a[1]) / len, sideShade = 0.9 + 0.12 * (dzn * 0.6 - dxn * 0.4);
        const col = KL.shade(tint, sideShade);
        for (let f = 0; f < floors; f++) {
          const yb = f * FLOOR, yt = yb + FLOOR + (f === floors - 1 ? 0.4 : 0);
          const row = f === 0 ? 0 : 1 + ((f * 7 + rowSeed + i) % 3), v0 = row / 4 + 0.004, v1 = (row + 1) / 4 - 0.004;
          C.walls.quadUV([a[0], yb, a[1]], [a[0], yt, a[1]], [b[0], yt, b[1]], [b[0], yb, b[1]], col, [u0, v0], [u0, v1], [u1, v1], [u1, v0]);
        }
        if (y0 < -0.05) C.found.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], 0.02, a[1]], [b[0], 0.02, b[1]], KL.shade(stone, 0.8));
      }
      // roof
      const rc = roofPal[Math.floor(rnd() * roofPal.length)];
      const O = obb(p), rectness = O ? area / O.area : 0, smallSide = O ? Math.min(O.w, O.d) : 0;
      if (O && rectness > 0.8 && area < 1300 && kind !== 2 && smallSide > 5) {
        const h = clamp(smallSide * 0.4, 1.8, 5.6);
        gableRoof(C.roofs, O, hgt - 0.05, h, rc, kind === 3 || rnd() < 0.3);
        if (rnd() < 0.6) { const ox = (rnd() - 0.5) * Math.max(O.w, O.d) * 0.5, ax = O.w >= O.d ? [O.ux, O.uz] : [-O.uz, O.ux]; C.extra.box(O.cx + ax[0] * ox, hgt + h * 0.55, O.cz + ax[1] * ox, 0.9, h * 0.7 + 1.4, 0.9, 0, KL.shade(KL.col('#9c8b7b'), 0.95 + rnd() * 0.1)); }
      } else {
        // mansard-like truncated roof (or a flat slab for sheds)
        let rad = 0; for (const q of p) rad += Math.hypot(q[0] - cx, q[1] - cz); rad /= p.length;
        const k = kind === 2 ? 1 : clamp(1 - 4.5 / Math.max(rad, 1), 0.35, 0.92), rise = kind === 2 ? 0.3 : 2.6;
        const inner = p.map((q) => [cx + (q[0] - cx) * k, cz + (q[1] - cz) * k]);
        if (kind !== 2) for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length], a2 = inner[i], b2 = inner[(i + 1) % p.length];
          C.roofs.quad([b[0], hgt, b[1]], [a[0], hgt, a[1]], [a2[0], hgt + rise, a2[1]], [b2[0], hgt + rise, b2[1]], KL.shade(rc, 0.8 + 0.25 * (((i * 5) % 4) / 4)));
        }
        let tris; try { tris = triangulate(inner); } catch (e) { tris = []; }
        for (const t of tris) {
          const A = [inner[t[0]][0], hgt + rise, inner[t[0]][1]], Bq = [inner[t[1]][0], hgt + rise, inner[t[1]][1]], Cq = [inner[t[2]][0], hgt + rise, inner[t[2]][1]];
          const ny = (Bq[2] - A[2]) * (Cq[0] - A[0]) - (Bq[0] - A[0]) * (Cq[2] - A[2]);
          if (ny >= 0) C.roofs.tri(A, Bq, Cq, KL.shade(rc, 1.12)); else C.roofs.tri(A, Cq, Bq, KL.shade(rc, 1.12));
        }
      }
      footprints.push({ p, cx, cz });
      count++;
    }
    KL.log && KL.log('city buildings', count, 'pushed', pushed, 'dropped', dropped);
    return { chunks, count, footprints };
  };

  /* coarse distance from a point to the whole track (used only for far buildings) */
  function trackFarDist(track, x, z) { let b = 1e18; for (let i = 0; i < track.N; i += 6) { const dx = x - track.X[i], dz = z - track.Z[i], d = dx * dx + dz * dz; if (d < b) b = d; } return Math.sqrt(b); }

  /* ---- mapped street trees (placed into the chunks' tree batches) ---- */
  KL.scenery.osmTrees = function (track, theme, data, city, rnd, terrain, quality, keepClear) {
    const idx = trackIndex(track), plane = KL.scenery.tree('plane', rnd), park = KL.scenery.tree('park', rnd);
    const fp = new Map(), key = (x, z) => Math.floor(x / 40) + ',' + Math.floor(z / 40);
    for (const f of city.footprints) { const k = key(f.cx, f.cz); let a = fp.get(k); if (!a) fp.set(k, (a = [])); a.push(f); }
    const inside = (x, z) => { const gx = Math.floor(x / 40), gz = Math.floor(z / 40); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = fp.get((gx + a) + ',' + (gz + b)); if (!l) continue; for (const f of l) { if (Math.abs(f.cx - x) > 60 || Math.abs(f.cz - z) > 60) continue; if (inPoly(x, z, f.p)) return true; } } return false; };
    let n = 0; const keep = quality.trees;
    for (const t of data.t) {
      if (rnd() > keep) continue;
      const x = t[0] / 10, z = t[1] / 10, h = terrain(x, z);
      const nr = idx.nearest(x, z);
      if (nr) { const i = nr.i, lat = (x - track.X[i]) * -track.TZ[i] + (z - track.Z[i]) * track.TX[i]; if (nr.d < track.HW[i] + (lat < 0 ? track.WL[i] : track.WR[i]) + 1.2) continue; }
      if (keepClear && keepClear(x, z)) continue;
      if (inside(x, z)) continue;
      const C = getChunkFor(city, x, z);
      C.trees.addBatch(h < -6 ? park : (rnd() < 0.7 ? plane : park), x, h - 0.15, z, rnd() * 6.28, (h < -6 ? 1.3 : 0.85) + rnd() * 0.45);
      n++;
    }
    return n;
  };
  function getChunkFor(city, x, z) {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK); let c = city.chunks.get(k);
    if (!c) { c = { walls: new KL.Batch(), roofs: new KL.Batch(), extra: new KL.Batch(), found: new KL.Batch(), trees: new KL.Batch(), x: Math.floor(x / CHUNK) * CHUNK, z: Math.floor(z / CHUNK) * CHUNK }; city.chunks.set(k, c); }
    return c;
  }

  /* ---- painted top-down ground map: streets, squares, parks (canvas, ~0.6 m per pixel) ---- */
  KL.tex.cityMap = function (data, o) {
    const S = o.px || 2048, [c, g] = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = S; return [cv, cv.getContext('2d')]; })();
    const sc = S / o.size, X = (x) => (x - o.x0) * sc, Z = (z) => (z - o.z0) * sc, rnd = KL.rng(31);
    g.fillStyle = o.paving || '#a9a59d'; g.fillRect(0, 0, S, S);
    // paving texture: mottled slabs
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.035})`; const w = 2 + rnd() * 5; g.fillRect(rnd() * S, rnd() * S, w, w * (0.6 + rnd() * 0.8)); }
    const path = (arr, close) => { g.beginPath(); for (let i = 0; i + 1 < arr.length; i += 2) { const x = X(arr[i] / 10), y = Z(arr[i + 1] / 10); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); } if (close) g.closePath(); };
    for (const [kind, pts] of data.g) { path(pts, true); g.fillStyle = kind === 1 ? '#5f9a52' : '#86b866'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(40,80,40,.35)'; g.stroke(); }
    const rw = data.roadW || [11, 7, 4, 6, 1.6], col = ['#686a73', '#72747c', '#7b7d85', '#bfb8aa', '#c9c3b5'];
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const cls of [3, 1, 0, 2, 4]) {
      for (const [k, pts] of data.r) { if (k !== cls) continue; path(pts, false); g.lineWidth = Math.max(1, rw[k] * sc); g.strokeStyle = col[k]; g.stroke(); }
    }
    // faint centre dashes on the wide streets
    g.setLineDash([6, 8]); g.lineWidth = 1; g.strokeStyle = 'rgba(245,240,210,.55)';
    for (const [k, pts] of data.r) if (k === 0) { path(pts, false); g.stroke(); }
    g.setLineDash([]);
    if (o.paint) o.paint(g, X, Z, sc);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = KL.maxAniso || 4; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter;
    return t;
  };
})();
