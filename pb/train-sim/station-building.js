/* Lokféierer: the real station building from the LOD2 model (TS.stationBuilding), painted from a per-station style (TS.stationStyles).
 *
 * The station patch (station-surround.js) carries the national LOD2 model of every building near the station.  The building flagged `station: 1` is not drawn by
 * the generic surroundings renderer when a style exists for the station: it is drawn here, with
 *   - the REAL volumes (every LOD2 wall and roof face, so wings, hips, gables and eave heights are the real ones),
 *   - one painted texture per wall face: plaster colour, plinth, floor band, windows by bay (rectangular / arched / round gable window), doors where the
 *     photos show them (style.doors, positions along the track as patch z), shutters, sills, eave cornice,
 *   - roofs in the style's material (slate / tile / flat) with white fascia boards,
 *   - extras: boxes, chimneys, signs, clocks from style.extras(api) in the PATCH frame (x lateral, + = right of the travel direction, z along, ahead = negative,
 *     y metres above the formation level; rail head = +0.55).
 * Everything is painted; no photograph is shipped.  Registering a style:
 *     TS.stationStyles.register('Roodt-Syr', { wall: '#e9e3cf', ... })
 * style = { wall, trim, plinth: { h, col }, groundY: patch height of the visible ground (default: lowest LOD2 point), band: col | null, roof: 'slate' | 'tile' | 'flat' | 'zinc', fascia: col, floorH, bayM,
 *           win: { w, h, kind: 'rect' | 'arch', frame, shutter, sill, ground: bool }, gableWin: 'round' | null, doors: [{ z (front/back faces) | x (end faces), w, h, col, glass, face: 'front' | 'back' | 'end' }],
 *           skipFaces: (face) => bool, extras: (api) => void, wallFor: (face) => colour | null (own plaster colour of one face, e.g. a white wing of a stone building), hidden: bool (draw nothing: the station model replaces it) } */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const styles = new Map();
  const PXM = 28;                    // texture pixels per metre of a wall face
  const MAX_TEX = 1024;
  const MIN_FACE = 0.8;              // faces smaller than this get no texture
  const FLOOR_H = 3.3;
  const ROOF_TINT_BOOST = 1.5;       // linear multiplier of a style's roof tint
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  TS.stationStyles = Object.freeze({
    register(name, style) { styles.set(name, Object.freeze(style)); },
    get(name) { return styles.get(name) || null; },
    has(name) { return styles.has(name); },
  });

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* point in polygon (2D) */
  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]; const b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  /* ---- one wall face -> { ring3, t(x,z), pmin, width, ymin, ymax, eave, kind, nx, nz, xc, zc } */
  function describeFace(ring, cx, cz) {
    let nxs = 0; let nzs = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      nxs += (a[1] - b[1]) * (a[2] + b[2]);
      nzs += (a[2] - b[2]) * (a[0] + b[0]);
    }
    // the horizontal outward normal of a vertical face: perpendicular to the dominant horizontal direction of its bottom edge
    const lo = ring.reduce((m, p) => Math.min(m, p[1]), Infinity);
    const bottom = ring.filter((p) => p[1] < lo + 0.3);
    let dx; let dz;
    if (bottom.length >= 2) { dx = bottom[bottom.length - 1][0] - bottom[0][0]; dz = bottom[bottom.length - 1][2] - bottom[0][2]; } else { dx = nzs; dz = -nxs; }
    if (Math.hypot(dx, dz) < 1e-6) { dx = nzs; dz = -nxs; }
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    let nx = dz; let nz = -dx;
    const mx = ring.reduce((s, p) => s + p[0], 0) / ring.length; const mz = ring.reduce((s, p) => s + p[2], 0) / ring.length;
    if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
    // u axis: seen from outside, left to right
    const hx = -nz; const hz = nx;
    let pmin = Infinity; let pmax = -Infinity; let ymin = Infinity; let ymax = -Infinity;
    ring.forEach((p) => { const t = p[0] * hx + p[2] * hz; pmin = Math.min(pmin, t); pmax = Math.max(pmax, t); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); });
    const tops = ring.filter((p) => p[1] > ymin + 0.6).map((p) => p[1]);
    const eave = tops.length ? Math.min(...tops) : ymax;
    const kind = Math.abs(nx) >= Math.abs(nz) ? (Math.sign(nx) * Math.sign(mx) < 0 ? 'front' : 'back') : 'end';
    return { ring, hx, hz, pmin, width: Math.max(0.1, pmax - pmin), ymin, ymax, eave: Math.min(eave, ymax), nx, nz, kind, xc: mx, zc: mz };
  }

  /* ---- paint one face */
  function paintFace(face, st, seed, doors) {
    const w = face.width; const h = Math.max(0.5, face.ymax - face.ymin);
    const px = Math.max(8, Math.min(MAX_TEX, Math.round(w * PXM))); const py = Math.max(8, Math.min(MAX_TEX, Math.round(h * PXM)));
    const sx = px / w; const sy = py / h;
    const c = document.createElement('canvas'); c.width = px; c.height = py;
    const g = c.getContext('2d');
    const r = mulberry(seed);
    const copper = st.copperAbove !== undefined && face.ymin > st.copperAbove - 3;
    g.fillStyle = copper ? (st.copperTint || '#5f9d8a') : ((st.wallFor && st.wallFor(face)) || st.wall); g.fillRect(0, 0, px, py);
    if (copper) { for (let i = 0; i < px * py / 90; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(20,50,40,0.12)'; g.fillRect(r() * px, r() * py, 1 + r() * 2, 2 + r() * 6); } return c; }
    for (let i = 0; i < (px * py) / 220; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,60,40,0.06)'; g.fillRect(r() * px, r() * py, 1 + r() * 3, 1 + r() * 3); }
    if (st.boards) { for (let x = 0; x < px; x += 0.24 * sx) { g.fillStyle = 'rgba(70,58,40,' + (0.1 + r() * 0.14) + ')'; g.fillRect(x, 0, 1.5, py); } for (let i = 0; i < px * py / 900; i++) { g.fillStyle = 'rgba(60,60,60,' + (0.1 + r() * 0.2) + ')'; g.fillRect(r() * px, r() * py, 2 + r() * 3, 8 + r() * 30); } }
    if (st.stone && !(st.wallFor && st.wallFor(face))) { const ch = 0.32 * sx; for (let y = 0, row = 0; y < py; y += ch, row++) { for (let x = -(row % 2) * ch; x < px; x += ch * (1.4 + r())) { const f = 0.85 + r() * 0.3; g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,235,190' : '60,40,20') + ',' + (0.05 + r() * 0.1) * f + ')'; g.fillRect(x + 1, y + 1, ch * 1.3, ch - 2); } g.fillStyle = 'rgba(60,45,30,0.25)'; g.fillRect(0, y, px, 1); } }
    if (st.stain !== false && !st.boards && !(st.stone && !(st.wallFor && st.wallFor(face)))) for (let i = 0; i < Math.max(2, Math.round(w / 3)); i++) { g.fillStyle = 'rgba(80,70,50,' + (0.03 + r() * 0.05) + ')'; g.fillRect(r() * px, 0, 6 + r() * 26, (0.25 + r() * 0.5) * py); }
    const Y = (y) => (face.ymax - y) * sy;                      // patch y -> canvas y
    const poly = face.ring.map((p) => [(p[0] * face.hx + p[2] * face.hz - face.pmin) * sx, Y(p[1])]);
    const plinthH = st.plinth ? st.plinth.h : 0.6;
    // style.groundY: patch height of the visible ground at the facade; the LOD2 part below it (a building sunk into a slope) is painted as plinth stone
    const base = st.groundY !== undefined ? clamp(st.groundY, face.ymin, face.ymax - 1) : face.ymin;
    const plinthTop = base + plinthH;
    if (plinthTop > face.ymin) { g.fillStyle = st.plinth ? st.plinth.col : '#8e887a'; g.fillRect(0, Y(plinthTop), px, (plinthTop - face.ymin) * sy + 2); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, Y(plinthTop), px, 2); }
    const eave = face.eave;
    const floorH = st.floorH || FLOOR_H;
    const avail = eave - base - plinthH;
    const floors = Math.max(1, Math.round(avail / floorH));
    const fh = avail / floors;
    if (!st.noWindows && (face.kind !== 'end' || st.endWindows !== false)) {
      // floor bands
      if (st.band) for (let f = 1; f < floors; f++) { g.fillStyle = st.band; g.fillRect(0, Y(base + plinthH + f * fh) - 2, px, 4); }
      // eave cornice
      g.fillStyle = st.trim || st.wall; g.fillRect(0, Y(eave), px, 0.22 * sy); g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, Y(eave) + 0.22 * sy, px, 2);
    }
    const win = st.win || {};
    const wwid = win.w || 1.05; const whgt = win.h || 1.55;
    const bayM = st.bayM || 3.2;
    const nb = Math.max(1, Math.round(w / bayM));
    const doorList = (doors || []).filter((d) => (d.face || 'front') === face.kind && (d.nz === undefined || Math.sign(face.nz) === d.nz));       // d.nz: only the face looking towards -z (ahead) / +z
    const doorT = (d) => {
      // door centre along the face: the patch z maps to t = z * hz + x * hx (x is constant on a face parallel to the track)
      const t = d.x !== undefined ? d.x * face.hx + face.zc * face.hz : d.z * face.hz + face.xc * face.hx;       // d.x: door of an 'end' face (a wall across the track), positioned by patch x
      return (t - face.pmin) * sx;
    };
    const drawWindow = (cxp, cy0, kind, ww, wh, glassOnly) => {
      const x = cxp - (ww * sx) / 2; const y = Y(cy0 + wh); const wpx = ww * sx; const hpx = wh * sy;
      if (win.shutter && kind !== 'round') { g.fillStyle = win.shutter; g.fillRect(x - 0.4 * sx, y, 0.36 * sx, hpx); g.fillRect(x + wpx + 0.04 * sx, y, 0.36 * sx, hpx); }
      g.fillStyle = win.reveal || '#dcd4bc'; g.fillRect(x - 0.12 * sx, y - 0.1 * sx, wpx + 0.24 * sx, hpx + 0.2 * sx);
      g.fillStyle = win.frame || '#f4f1ea'; g.fillRect(x, y, wpx, hpx);
      const gl = g.createLinearGradient(0, y, 0, y + hpx); gl.addColorStop(0, '#a9c3d6'); gl.addColorStop(1, '#5d7388');
      g.fillStyle = gl;
      if (kind === 'arch') {
        g.beginPath(); g.moveTo(x + 0.07 * sx, y + hpx - 0.07 * sx); g.lineTo(x + 0.07 * sx, y + wpx / 2); g.arc(x + wpx / 2, y + wpx / 2, wpx / 2 - 0.07 * sx, Math.PI, 0); g.lineTo(x + wpx - 0.07 * sx, y + hpx - 0.07 * sx); g.closePath(); g.fill();
      } else if (kind === 'round') {
        g.beginPath(); g.arc(cxp, y + hpx / 2, Math.min(wpx, hpx) / 2 - 0.06 * sx, 0, Math.PI * 2); g.fill();
        return;
      } else {
        g.fillRect(x + 0.07 * sx, y + 0.07 * sx, wpx - 0.14 * sx, hpx * 0.5 - 0.1 * sx); g.fillRect(x + 0.07 * sx, y + hpx * 0.53, wpx - 0.14 * sx, hpx * 0.47 - 0.1 * sx);
      }
      if (!glassOnly) { g.fillStyle = win.frame || '#f4f1ea'; g.fillRect(x + wpx / 2 - 0.03 * sx, y + 0.07 * sx, 0.06 * sx, hpx - 0.14 * sx); }
      if (win.sill !== false) { g.fillStyle = '#cfc7aa'; g.fillRect(x - 0.18 * sx, y + hpx + 0.1 * sx, wpx + 0.36 * sx, 0.12 * sx); }
    };
    const insidePoly = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every((p) => inside(poly, p[0], p[1]));
    if (!st.noWindows && (w >= 1.8 && face.kind !== 'end' || (face.kind === 'end' && w >= 3.0 && st.endWindows !== false))) {
      for (let f = 0; f < floors; f++) {
        const yb = base + plinthH + f * fh + (fh - whgt) * 0.45;
        for (let b = 0; b < nb; b++) {
          const cxp = ((b + 0.5) / nb) * px;
          if (f === 0 && win.ground === false) continue;
          if (doorList.some((d) => f === 0 && Math.abs(doorT(d) - cxp) < (d.w * sx) / 2 + 1.0 * sx)) continue;
          if (cxp < 0.9 * sx || cxp > px - 0.9 * sx) continue;
          const kind = f === 0 && win.groundKind ? win.groundKind : win.kind || 'rect';
          const x0 = cxp - (wwid * sx) / 2 - 2; const x1 = cxp + (wwid * sx) / 2 + 2;
          if (!insidePoly(x0, Y(yb + whgt) - 2, x1, Y(yb) + 2)) continue;
          drawWindow(cxp, yb, kind, wwid, kind === 'arch' ? whgt + 0.3 : whgt, false);
        }
      }
    }
    // round window high in a gable end
    if (!st.noWindows && st.gableWin === 'round' && face.ymax - eave > 1.2 && w > 3) drawWindow(px / 2, eave + (face.ymax - eave) * 0.42 - 0.35, 'round', 0.8, 0.8, true);
    // doors
    doorList.forEach((d) => {
      const x = doorT(d) - (d.w * sx) / 2; const dh = d.h || 2.2; const y = Y(base + plinthH * 0.3 + dh); const wpx = d.w * sx; const hpx = dh * sy;
      const archPath = (ax, ay, aw, ah) => { g.beginPath(); g.moveTo(ax, ay + ah); g.lineTo(ax, ay + aw / 2); g.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); g.lineTo(ax + aw, ay + ah); g.closePath(); };
      g.fillStyle = st.trim || '#d8cfae';
      if (d.arch) { archPath(x - 0.26 * sx, y - 0.26 * sx, wpx + 0.52 * sx, hpx + 0.26 * sx); g.fill(); g.fillStyle = d.col || '#7d1c2d'; archPath(x, y, wpx, hpx); g.fill(); }       // d.arch: round-headed door in a stone surround
      else { g.fillRect(x - 0.18 * sx, y - 0.14 * sx, wpx + 0.36 * sx, hpx + 0.14 * sx); g.fillStyle = d.col || '#7d1c2d'; g.fillRect(x, y, wpx, hpx); }
      if (d.glass !== false) { const gl = g.createLinearGradient(0, y, 0, y + hpx); gl.addColorStop(0, '#9fb8c8'); gl.addColorStop(1, '#5a7184'); g.fillStyle = gl; g.fillRect(x + 0.12 * sx, y + 0.14 * sx, wpx - 0.24 * sx, hpx * 0.5); }
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + wpx / 2 - 1, y, 2, hpx);
      g.fillStyle = '#d8d2c0'; g.fillRect(x - 0.3 * sx, Y(base + plinthH * 0.3) , wpx + 0.6 * sx, 0.1 * sx);    // step
    });
    return c;
  }


  /* ---- draw-call batching (W2e).  A LOD2 station building has hundreds of wall faces; one mesh per face cost 657 draw calls at the Gare Centrale (budget ~260 for the whole view).
   * A batch collects every face / roof / skirt / extra of all the buildings of one patch and flush() emits them as a few meshes: the painted face canvases are packed into texture
   * atlases (ATLAS_W wide, a gutter of edge-extruded pixels around each face so that mip levels do not bleed), everything else is merged per material. */
  const ATLAS_W = 2048;
  const ATLAS_MAX_H = 2048;
  const GUTTER = 4;
  const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

  function newBatch(api) {
    const { T, group, disposables, stats, MB } = api;
    const faces = [];                // { canvas, pw, ph, verts: [[x, y, z, nx, nz, u, v]], idx }
    const plain = new Map();         // key -> { mb, mat, cast }
    const plainMB = (key, makeMat, cast) => {
      let g = plain.get(key);
      if (!g) { g = { mb: new MB(), makeMat, cast: !!cast }; plain.set(key, g); }
      return g.mb;
    };
    const emit = (mb, mat, cast) => {
      if (mb.empty) return;
      const mesh = new T.Mesh(mb.geometry(), mat); mesh.castShadow = !!cast; mesh.receiveShadow = true;
      group.add(mesh); disposables.push(mesh.geometry); stats.tris += mb.i.length / 3;
    };
    const flush = () => {
      // textured faces -> atlas pages (shelf packing, tallest first)
      const items = faces.filter((f) => f.canvas && f.idx.length).sort((a, b) => b.ph - a.ph);
      const pages = [];
      const place = (f) => {
        const w = f.pw + 2 * GUTTER; const h = f.ph + 2 * GUTTER;
        for (const pg of pages) {
          for (const sh of pg.shelves) if (h <= sh.h && sh.x + w <= ATLAS_W) { f.x = sh.x; f.y = sh.y; f.page = pg; sh.x += w; return; }
          const top = pg.shelves.length ? pg.shelves[pg.shelves.length - 1] : null;
          const y = top ? top.y + top.h : 0;
          if (y + h <= ATLAS_MAX_H) { const sh = { x: w, y, h }; pg.shelves.push(sh); f.x = 0; f.y = y; f.page = pg; pg.used = y + h; return; }
        }
        const pg = { shelves: [{ x: w, y: 0, h }], used: h, faces: [] }; pages.push(pg); f.x = 0; f.y = 0; f.page = pg;
      };
      items.forEach(place);
      items.forEach((f) => f.page.faces.push(f));
      pages.forEach((pg) => {
        const H = pow2(pg.used);
        const c = document.createElement('canvas'); c.width = ATLAS_W; c.height = H;
        const g = c.getContext('2d');
        const mb = new MB();
        pg.faces.forEach((f) => {
          const x = f.x + GUTTER; const y = f.y + GUTTER; const cv = f.canvas; const w = f.pw; const h = f.ph;
          g.drawImage(cv, x, y);
          // edge extrusion: the gutter repeats the border pixels (no bleeding from the neighbours into mip levels / linear filtering)
          g.drawImage(cv, 0, 0, 1, h, x - GUTTER, y, GUTTER, h); g.drawImage(cv, w - 1, 0, 1, h, x + w, y, GUTTER, h);
          g.drawImage(cv, 0, 0, w, 1, x, y - GUTTER, w, GUTTER); g.drawImage(cv, 0, h - 1, w, 1, x, y + h, w, GUTTER);
          g.drawImage(cv, 0, 0, 1, 1, x - GUTTER, y - GUTTER, GUTTER, GUTTER); g.drawImage(cv, w - 1, 0, 1, 1, x + w, y - GUTTER, GUTTER, GUTTER);
          g.drawImage(cv, 0, h - 1, 1, 1, x - GUTTER, y + h, GUTTER, GUTTER); g.drawImage(cv, w - 1, h - 1, 1, 1, x + w, y + h, GUTTER, GUTTER);
          const ids = f.verts.map((v) => mb.vert(v[0], v[1], v[2], v[3], 0, v[4], [1, 1, 1], (x + v[5] * w) / ATLAS_W, 1 - (y + (1 - v[6]) * h) / H));
          f.idx.forEach((i) => mb.i.push(ids[i]));
          cv.width = 0; cv.height = 0;                 // release the face canvas
        });
        const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
        const mat = new T.MeshLambertMaterial({ map: tex, color: 0xffffff, side: T.DoubleSide });
        disposables.push(mat, tex);
        emit(mb, mat, true);
      });
      faces.length = 0;
      plain.forEach((g) => { const mat = g.makeMat(); disposables.push(mat); emit(g.mb, mat, g.cast); });
      plain.clear();
    };
    return { faces, plainMB, flush, atlasFace(f) { faces.push(f); } };
  }

  /* ---- build.  api: { T, b, style, world(x, z) -> { x, z, form }, group, disposables, triangulate3, MB, roofTexture(kind), stats, batch? }
   * `batch` (newBatch) is shared by all the buildings of a patch and flushed by the caller; without one the building flushes its own. */
  function build(api) {
    const { T, b, style: st, world, group, disposables, triangulate3, MB } = api;
    if (st.hidden) return;                // style { hidden: true }: the station model draws a replacement (e.g. a pavilion the LOD2 only has as a flat box)
    const ownBatch = !api.batch;
    const batch = api.batch || newBatch(api);
    const cx = b.ground.reduce((s, p) => s + p[0], 0) / b.ground.length;
    const cz = b.ground.reduce((s, p) => s + p[1], 0) / b.ground.length;
    const baseY = b.base !== undefined ? b.base : 0;
    const doors = st.doors || [];
    let seed = 1;
    (st.noWalls ? [] : b.walls || []).forEach((ring, wi) => {
      if (ring.length < 3) return;
      const face = describeFace(ring, cx, cz);
      if (st.skipFaces && st.skipFaces(face)) return;
      const { tris } = triangulate3(ring);
      if (!tris.length) return;
      const big = face.width >= MIN_FACE && face.ymax - face.ymin >= MIN_FACE;
      const canvas = big ? paintFace(face, st, (seed += 7) * 31 + wi, doors) : null;
      const verts = ring.map((p) => {
        const w = world(p[0], p[2]);
        const u = (p[0] * face.hx + p[2] * face.hz - face.pmin) / face.width;
        const v = (p[1] - face.ymin) / Math.max(0.5, face.ymax - face.ymin);
        const rn = api.rotN ? api.rotN(p[2], face.nx, face.nz) : [face.nx, face.nz];
        return [w.x, w.form + p[1], w.z, rn[0], rn[1], u, v];
      });
      if (canvas) { batch.atlasFace({ canvas, pw: canvas.width, ph: canvas.height, verts, idx: tris }); return; }
      // a face too small for a texture: plain plaster colour, merged with the others of its colour
      const wallHex = new T.Color(st.wall).getHexString();
      const mb = batch.plainMB('wall|' + wallHex, () => new T.MeshLambertMaterial({ color: new T.Color(st.wall), side: T.DoubleSide }), true);
      const ids = verts.map((v) => mb.vert(v[0], v[1], v[2], v[3], 0, v[4], [1, 1, 1], v[5], v[6]));
      tris.forEach((i) => mb.i.push(ids[i]));
    });
    // foundation skirt (plain plinth colour) below the LOD2 ground line
    if (!st.noWalls) {
      const skCol = st.plinth ? st.plinth.col : '#8e887a';
      const sk = batch.plainMB('skirt|' + new T.Color(skCol).getHexString(), () => new T.MeshLambertMaterial({ color: new T.Color(skCol), side: T.DoubleSide }), false);
      const gr = b.ground;
      for (let i = 0; i < gr.length; i++) {
        const a = gr[i]; const c2 = gr[(i + 1) % gr.length];
        const wa = world(a[0], a[1]); const wc = world(c2[0], c2[1]);
        const y0 = wa.form + baseY - 1.6; const y1 = wa.form + baseY + 0.05; const y1c = wc.form + baseY + 0.05; const y0c = wc.form + baseY - 1.6;
        const ids = [sk.vert(wa.x, y0, wa.z, 0, 0, 1, [1, 1, 1], 0, 0), sk.vert(wc.x, y0c, wc.z, 0, 0, 1, [1, 1, 1], 1, 0), sk.vert(wc.x, y1c, wc.z, 0, 0, 1, [1, 1, 1], 1, 1), sk.vert(wa.x, y1, wa.z, 0, 0, 1, [1, 1, 1], 0, 1)];
        sk.i.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      }
    }
    // roofs: gentle slopes in the style's material, steep ones (mansards, spires) darker, the tower above `copperAbove` in green copper
    const roofSpec = (key) => {
      const [kind, tint] = key === 'main' ? [st.roof || 'slate', st.roofTint] : key === 'steep' ? [(st.steepRoof && st.steepRoof.kind) || 'slate', st.steepRoof && st.steepRoof.tint] : ['zinc', st.copperTint || '#5f9d8a'];
      const rcol = tint ? new T.Color(tint).multiplyScalar(ROOF_TINT_BOOST) : new T.Color(0xffffff);   // the tints were picked for a brighter sky than the sim has: LOD2 roofs rendered darker than in the photos
      rcol.r = Math.min(1, rcol.r); rcol.g = Math.min(1, rcol.g); rcol.b = Math.min(1, rcol.b);
      return { kind, rcol };
    };
    const roofMB = {};
    const roofFor = (key) => {
      if (!roofMB[key]) { const { kind, rcol } = roofSpec(key); roofMB[key] = batch.plainMB('roof|' + kind + '|' + rcol.getHexString(), () => new T.MeshLambertMaterial({ map: api.roofTexture(kind), color: rcol, side: T.DoubleSide }), true); }
      return roofMB[key];
    };
    (b.roofs || []).forEach((ring) => {
      if (ring.length < 3) return;
      const { tris, normal } = triangulate3(ring);
      if (!tris.length) return;
      const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1; let nx = normal[0] / nl; let ny = normal[1] / nl; let nz = normal[2] / nl;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const ymean = ring.reduce((m, p) => m + p[1], 0) / ring.length;
      const rf = roofFor(st.copperAbove !== undefined && ymean > st.copperAbove ? 'copper' : st.steepRoof && ny < 0.8 ? 'steep' : 'main');
      const ids = ring.map((p) => { const w = world(p[0], p[2]); const rn = api.rotN ? api.rotN(p[2], nx, nz) : [nx, nz]; return rf.vert(w.x, w.form + p[1], w.z, rn[0], ny, rn[1], [1, 1, 1], p[0] / 2.4, p[2] / 2.4); });
      for (let t = 0; t < tris.length; t += 3) rf.i.push(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
    });
    // extras: boxes etc. in the patch frame
    if (st.extras) {
      const eb = batch.plainMB('extras', () => new T.MeshLambertMaterial({ vertexColors: true }), true);
      const frameBox = (px, py, pz, sx, sy, sz, colHex, yaw) => {
        // a box in the patch frame (lateral x, along z, up y above the formation); aligned with the track at that z
        const w = world(px, pz); const w2 = world(px, pz - 1);
        const ang = Math.atan2(-(w2.x - w.x), -(w2.z - w.z)) + (yaw || 0);      // heading of "ahead" (towards -z)
        const col = new T.Color(colHex);
        eb.box(w.x, w.form + py, w.z, sx, sy, sz, [col.r, col.g, col.b], ang);
      };
      st.extras({ box: frameBox, world, T, b, group, disposables, MB });
    }
    if (ownBatch) batch.flush();
  }

  TS.stationBuilding = Object.freeze({ build, describeFace, newBatch });
})();
