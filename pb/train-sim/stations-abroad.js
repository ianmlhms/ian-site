/* Zuchsimulator Lëtzebuerg: photo-modelled stations (abroad). Registers into TS.realStations (stations-real.js).
 * Trier Hbf, Schweich, Wittlich, Cochem, Koblenz Hbf, Thionville, Metz-Ville, Pont-à-Mousson, Nancy-Ville, Arlon, Libramont, Namur,
 * Bruxelles-Midi, Champagne-Ardenne TGV, Paris-Est.
 * Local frame: x = right of the driving direction, +y up, the train drives towards -z. Everything is built with a lateral distance `d`
 * from the track centre on the platform side (x = pf(d)), so one builder serves both mirrored directions. */
(function () {
  'use strict';
  const RS = window.TS && window.TS.realStations;
  if (!RS) return;

  /* ------------------------------------------------------------------ small seeded random */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ the kit */
  function kit(api) {
    const { T, sets, M, mat, col, shade, WHITE, FORM_Y, sx, pf, H, W, edge, L, zA, zB, helpers } = api;
    const ctex = helpers.canvasTex;
    let k = null;
    const X = (d) => pf(d);
    const vc = sets.get('vc', M.vc, true);
    const glow = sets.get('glow', M.glow);
    const BACK = edge + W + 0.9; // first free lateral distance behind the platform (the generic fence stands at edge + W + 0.45)

    /* batch with a cached textured material (key must be unique per texture) */
    function texB(key, make, extra, cast) {
      return sets.get('ab:' + key, () => M.tex('ab:' + key, make(), extra), cast !== false);
    }
    function colB(key, props, cast) {
      return sets.get('ab:' + key, () => mat('ab:' + key, () => new T.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.7, metalness: 0.1 }, props))), cast !== false);
    }
    const glassB = () => sets.get('glass', M.glass);
    // canopy decks get a faint emissive so the underside does not turn brown/black under the hemisphere light
    const deckB = (key, props) => colB(key, Object.assign({ emissive: new T.Color(0x6a6a6a) }, props));

    /* axis aligned box by lateral/z/y ranges */
    function box(b, d0, d1, z0, z1, y0, y1, color, ry) {
      b.box(X((d0 + d1) / 2), (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(d1 - d0), y1 - y0, z1 - z0, color, ry);
    }
    // oriented quad: the normal is chosen to point away from `inside`
    function quadO(b, inside, p, color, uvs) {
      const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4 - inside[0];
      const cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4 - inside[1];
      const cz = (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4 - inside[2];
      if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      b.quad(p[0], p[1], p[2], p[3], [nx, ny, nz], color || WHITE, uvs);
    }
    function triO(b, inside, p, color) {
      const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const cx = (p[0][0] + p[1][0] + p[2][0]) / 3 - inside[0];
      const cy = (p[0][1] + p[1][1] + p[2][1]) / 3 - inside[1];
      const cz = (p[0][2] + p[1][2] + p[2][2]) / 3 - inside[2];
      if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      b.tri(p[0], p[1], p[2], [nx, ny, nz], color || WHITE);
    }
    /* wall in the plane d = const: facing -1 looks at the track, +1 away from it; u runs left to right for the viewer */
    function wallD(b, d, z0, z1, y0, y1, facing, ru, rv, color, u0, v0) {
      const x = X(d);
      const rightPos = -sx * facing > 0;
      const zl = rightPos ? z0 : z1;
      const zr = rightPos ? z1 : z0;
      const a = u0 || 0, v = v0 || 0;
      b.quad([x, y0, zl], [x, y0, zr], [x, y1, zr], [x, y1, zl], [sx * facing, 0, 0], color || WHITE, [[a, v], [a + ru, v], [a + ru, v + rv], [a, v + rv]]);
    }
    /* wall in the plane z = const (end walls), facing +1 / -1 along z */
    function wallZ(b, z, d0, d1, y0, y1, facing, ru, rv, color) {
      const rightPos = facing * sx > 0;
      const dl = rightPos ? d0 : d1;
      const dr = rightPos ? d1 : d0;
      b.quad([X(dl), y0, z], [X(dr), y0, z], [X(dr), y1, z], [X(dl), y1, z], [0, 0, facing], color || WHITE, [[0, 0], [ru, 0], [ru, rv], [0, rv]]);
    }
    /* hip / pyramid / frustum roof on a rectangle: top rectangle inset by iD (lateral) and iZ (along the track) */
    function frustum(b, d0, d1, z0, z1, yb, yt, iD, iZ, color, uvScale) {
      const inside = [X((d0 + d1) / 2), (yb + yt) / 2 - 1, (z0 + z1) / 2];
      const t0 = d0 + iD, t1 = d1 - iD, s0 = z0 + iZ, s1 = z1 - iZ;
      const P = (d, y, z) => [X(d), y, z];
      const us = uvScale || 1 / 3;
      quadO(b, inside, [P(d0, yb, z0), P(d1, yb, z0), P(t1, yt, s0), P(t0, yt, s0)], color, [[0, 0], [(d1 - d0) * us, 0], [(t1 - t0) * us, (yt - yb) * us], [0, (yt - yb) * us]]);
      quadO(b, inside, [P(d1, yb, z1), P(d0, yb, z1), P(t0, yt, s1), P(t1, yt, s1)], color, [[0, 0], [(d1 - d0) * us, 0], [(t1 - t0) * us, (yt - yb) * us], [0, (yt - yb) * us]]);
      quadO(b, inside, [P(d0, yb, z1), P(d0, yb, z0), P(t0, yt, s0), P(t0, yt, s1)], color, [[0, 0], [(z1 - z0) * us, 0], [(s1 - s0) * us, (yt - yb) * us], [0, (yt - yb) * us]]);
      quadO(b, inside, [P(d1, yb, z0), P(d1, yb, z1), P(t1, yt, s1), P(t1, yt, s0)], color, [[0, 0], [(z1 - z0) * us, 0], [(s1 - s0) * us, (yt - yb) * us], [0, (yt - yb) * us]]);
      if (t1 - t0 > 0.05 && s1 - s0 > 0.05) quadO(b, inside, [P(t0, yt, s0), P(t1, yt, s0), P(t1, yt, s1), P(t0, yt, s1)], color);
    }
    /* gable roof, ridge along z (parallel to the track); gable triangles are drawn with gableB (plain wall batch) */
    function gableZ(b, gableB, d0, d1, z0, z1, yE, yR, ov, color, gableColor, uvScale) {
      const dm = (d0 + d1) / 2;
      const inside = [X(dm), yE - 1, (z0 + z1) / 2];
      const us = uvScale || 1 / 3;
      const a0 = d0 - ov, a1 = d1 + ov, za = z0 - ov, zb = z1 + ov;
      const yEave = yE - (ov * (yR - yE)) / Math.max(0.01, (d1 - d0) / 2);
      const P = (d, y, z) => [X(d), y, z];
      quadO(b, inside, [P(a0, yEave, za), P(a0, yEave, zb), P(dm, yR, zb), P(dm, yR, za)], color, [[0, 0], [(zb - za) * us, 0], [(zb - za) * us, (yR - yEave) * us * 1.4], [0, (yR - yEave) * us * 1.4]]);
      quadO(b, inside, [P(a1, yEave, zb), P(a1, yEave, za), P(dm, yR, za), P(dm, yR, zb)], color, [[0, 0], [(zb - za) * us, 0], [(zb - za) * us, (yR - yEave) * us * 1.4], [0, (yR - yEave) * us * 1.4]]);
      if (gableB) {
        triO(gableB, inside, [P(d0, yE, z0), P(d1, yE, z0), P(dm, yR, z0)], gableColor);
        triO(gableB, inside, [P(d0, yE, z1), P(d1, yE, z1), P(dm, yR, z1)], gableColor);
      }
    }
    /* gable roof, ridge along d (perpendicular to the track) */
    function gableD(b, gableB, d0, d1, z0, z1, yE, yR, ov, color, gableColor, uvScale) {
      const zm = (z0 + z1) / 2;
      const inside = [X((d0 + d1) / 2), yE - 1, zm];
      const us = uvScale || 1 / 3;
      const za = z0 - ov, zb = z1 + ov;
      const yEave = yE - (ov * (yR - yE)) / Math.max(0.01, (z1 - z0) / 2);
      const P = (d, y, z) => [X(d), y, z];
      quadO(b, inside, [P(d0 - ov, yEave, za), P(d1 + ov, yEave, za), P(d1 + ov, yR, zm), P(d0 - ov, yR, zm)], color, [[0, 0], [(d1 - d0) * us, 0], [(d1 - d0) * us, (yR - yEave) * us * 1.4], [0, (yR - yEave) * us * 1.4]]);
      quadO(b, inside, [P(d1 + ov, yEave, zb), P(d0 - ov, yEave, zb), P(d0 - ov, yR, zm), P(d1 + ov, yR, zm)], color, [[0, 0], [(d1 - d0) * us, 0], [(d1 - d0) * us, (yR - yEave) * us * 1.4], [0, (yR - yEave) * us * 1.4]]);
      if (gableB) {
        triO(gableB, inside, [P(d0, yE, z0), P(d0, yE, z1), P(d0, yR, zm)], gableColor);
        triO(gableB, inside, [P(d1, yE, z0), P(d1, yE, z1), P(d1, yR, zm)], gableColor);
      }
    }
    /* clock face (double faced facing the three open sides is the caller's job): textured quad at a lateral wall */
    function clockD(d, y, z, size, facing) {
      const cb = sets.get('clock', helpers.clockMat);
      const rightPos = -sx * facing > 0;
      helpers.textQuad(cb, [X(d), y, z], size, size, [sx * facing, 0, 0], [0, 0, rightPos ? 1 : -1], [0, 1, 0]);
    }
    function clockZ(d, y, z, size, facing) {
      const cb = sets.get('clock', helpers.clockMat);
      const rightPos = facing * sx > 0;
      helpers.textQuad(cb, [X(d), y, z], size, size, [0, 0, facing], [rightPos ? sx : -sx, 0, 0], [0, 1, 0]);
    }
    /* a textured block: facade (track side + back) with `rows` storeys, plain end walls, optional roof.
       o = { d0, dep, z0, z1, rows, sh (storey height), fac: {key,...facadeTex opts}, bayW, plain: colour, roof: 'hip'|'gable'|'flat'|'none',
             roofH, roofKey, roofBase, roofOv, y0 } returns { top } */
    function bldg(o) {
      const y0 = o.y0 === undefined ? FORM_Y : o.y0;
      const rows = o.rows || 2;
      const sh = o.sh || 3.6;
      const yT = o.top !== undefined ? o.top : (o.y0 === undefined ? 0 : o.y0) + rows * sh;
      const key = o.fac.key;
      const facB = texB('fac-' + key, () => facadeTex(k, key, Object.assign({ rows }, o.fac)));
      const pl = texB('plain-' + (o.plainKey || key), () => plainTex(k, o.plainKey || key, o.plain || o.fac.base, o.fac.speck));
      const len = o.z1 - o.z0;
      const bays = Math.max(1, Math.round(len / (o.bayW || 4)));
      wallD(facB, o.d0, o.z0, o.z1, y0, yT, -1, bays, 1);
      wallD(facB, o.d0 + o.dep, o.z0, o.z1, y0, yT, 1, bays, 1);
      const eb = Math.max(1, Math.round(o.dep / (o.bayW || 4)));
      wallZ(o.plainEnds ? pl : facB, o.z0, o.d0, o.d0 + o.dep, y0, yT, -1, eb, 1);
      wallZ(o.plainEnds ? pl : facB, o.z1, o.d0, o.d0 + o.dep, y0, yT, 1, eb, 1);
      const roofB = o.roofKey ? texB('roof-' + o.roofKey, () => slateTex(k, o.roofKey, o.roofBase)) : null;
      const ov = o.roofOv === undefined ? 0.5 : o.roofOv;
      if (o.roof === 'flat') {
        vcB().box(X(o.d0 + o.dep / 2), yT + 0.15, (o.z0 + o.z1) / 2, o.dep + 0.8, 0.3, len + 0.8, col(o.capCol || '#8b8e90'));
      } else if (o.roof === 'hip') {
        frustum(roofB || vcB(), o.d0 - ov, o.d0 + o.dep + ov, o.z0 - ov, o.z1 + ov, yT, yT + o.roofH, Math.min(o.dep / 2 + ov - 0.01, o.hipIn === undefined ? 1e9 : o.hipIn), Math.min((o.dep / 2 + ov), len / 2 - 0.01), roofB ? WHITE : col(o.roofCol || '#555'));
      } else if (o.roof === 'gable') {
        gableZ(roofB || vcB(), pl, o.d0, o.d0 + o.dep, o.z0, o.z1, yT, yT + o.roofH, ov, roofB ? WHITE : col(o.roofCol || '#555'), WHITE);
      }
      return { top: yT };
    }
    function vcB() { return vc; }
    /* long platform roof: deck from lateral d0 to d1 at height y (rising by `rise` toward the back), fascia, columns each `step` m at lateral colD */
    function canopy(o) {
      const len = o.z1 - o.z0, zc = (o.z0 + o.z1) / 2;
      const dm = (o.d0 + o.d1) / 2, wd = o.d1 - o.d0;
      const rz = Math.atan2(o.rise || 0, wd) * sx;
      o.deck.box(X(dm), o.y + (o.rise || 0) / 2, zc, wd / Math.cos(Math.abs(rz)), o.thick || 0.22, len, o.deckCol, 0, 0, rz);
      if (o.fascia) vc.box(X(o.d0), o.y - 0.12, zc, 0.1, o.fascia[0], len, col(o.fascia[1]));
      const step = o.step || 10;
      const n = Math.max(1, Math.round(len / step));
      for (let i = 0; i <= n; i++) {
        const z = o.z0 + (len * i) / n;
        (o.colDs || [o.colD]).forEach((cd) => {
          if (o.round) o.colB.cyl(X(cd), (H + o.y) / 2, z, o.colW || 0.1, o.y - H, col(o.colCol));
          else o.colB.box(X(cd), (H + o.y) / 2, z, o.colW || 0.22, o.y - H, o.colW || 0.22, col(o.colCol));
        });
        if (o.lights !== false) glow.box(X(dm), o.y - 0.18, z + len / n / 2, 0.7, 0.05, 0.3, col('#fff3d0'));
      }
    }
    function furnish(z0, z1, dBench, dLamp, stepB, stepL) {
      for (let z = z0; z <= z1; z += stepB || 20) helpers.addBench(vc, X(dBench), H, z);
      for (let z = z0 + 8; z <= z1; z += stepL || 28) helpers.addLampPost(sets, X(dLamp), H, z);
    }
    /* platform surface re-paved: textured overlay over the platform slab (from lateral d0 to d1), z0..z1 */
    function paving(key, make, d0, d1, z0, z1, rep) {
      const b = texB('pave-' + key, make, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, false);
      const x0 = X(d0), x1 = X(d1), y = H + 0.006;
      b.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], WHITE, [[0, z0 / rep], [(d1 - d0) / rep, z0 / rep], [(d1 - d0) / rep, z1 / rep], [0, z1 / rep]]);
    }
    /* DB-style platform paving: grey paver pattern + the white guide strip */
    function dbPaving(z0, z1, tone) {
      paving('db-pave' + (tone || ''), () => ctex('ab-db-pave' + (tone || ''), 128, 128, (c, w, h) => {
        const r = rng(12); c.fillStyle = tone || '#9c9a96'; c.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < w + 16; x += 32) { const v = Math.floor(r() * 20 - 10); c.fillStyle = 'rgb(' + (156 + v) + ',' + (152 + v) + ',' + (146 + v) + ')'; c.fillRect(x + 1, y + 1, 30, 14); }
      }), edge + 0.8, edge + W, z0, z1, 3);
      const st = colB('db-strip', { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }, false);
      const xa = X(edge + 1.1), xb = X(edge + 1.6), y = H + 0.012;
      st.quad([xa, y, z0], [xb, y, z0], [xb, y, z1], [xa, y, z1], [0, 1, 0], col('#e9e9e6'));
    }
    /* a plain rail: sleepers + two steel rails, as a flat visual extra track at lateral dT (negative = away from the platform) */
    function track(dT, z0, z1) {
      const bal = colB('ballast', { roughness: 1, metalness: 0 }, false);
      const xx = X(dT);
      bal.box(xx, FORM_Y + 0.12, (z0 + z1) / 2, 4.2, 0.28, z1 - z0, col('#8a8782'));
      const len = z1 - z0, n = Math.floor(len / 0.9);
      for (let i = 0; i < n; i += 1) bal.box(xx, FORM_Y + 0.3, z0 + i * 0.9 + 0.45, 2.4, 0.14, 0.26, col('#5f5a52'));
      [-0.72, 0.72].forEach((o) => bal.box(xx + o, FORM_Y + 0.42, (z0 + z1) / 2, 0.07, 0.15, len, col('#7d7871')));
    }
    k = { dbPaving, deckB, bldg, canopy, furnish, paving, track, X, vc, glow, BACK, texB, colB, glassB, box, quadO, triO, wallD, wallZ, frustum, gableZ, gableD, clockD, clockZ, ctex, col, shade, WHITE, FORM_Y, sx, pf, H, W, edge, L, zA, zB, sets, M, mat, T, helpers };
    return k;
  }

  /* ------------------------------------------------------------------ shared textures */
  const TEX = {};
  function slateTex(k, key, base) {
    // roof tiles in a flat colour; returns a texture, cached by key
    return k.ctex('ab-slate-' + key, 128, 128, (c, w, h) => {
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      const r = rng(11);
      for (let y = 0; y < h; y += 8) {
        c.fillStyle = 'rgba(0,0,0,0.28)';
        c.fillRect(0, y, w, 1.5);
        for (let x = (y / 8) % 2 ? 0 : 8; x < w; x += 16) {
          c.fillStyle = 'rgba(0,0,0,0.18)';
          c.fillRect(x, y, 1, 8);
        }
        for (let x = 0; x < w; x += 16) {
          const v = Math.floor(r() * 30) - 12;
          c.fillStyle = 'rgba(' + (v > 0 ? '255,255,255' : '0,0,0') + ',' + (Math.abs(v) / 120).toFixed(2) + ')';
          c.fillRect(x, y, 16, 8);
        }
      }
    });
  }

  /* wall texture factory: one bay x `rows` storeys, repeated sideways. o = { base, speck, rows, win:[w,h] (fractions of the bay / storey), winCol, frame,
     ground: 'arch' | 'rect' | 'none', band, plinth } */
  function facadeTex(k, key, o) {
    const rows = o.rows || 2;
    const BW = 128, SH = 112;
    return k.ctex('ab-fac-' + key, BW, SH * rows, (c, w, h) => {
      const r = rng(hash(key));
      c.fillStyle = o.base; c.fillRect(0, 0, w, h);
      const sp = o.speck === undefined ? 0.1 : o.speck;
      for (let i = 0; i < 900 * rows; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (sp * (0.3 + r())).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 5, 1 + r() * 4); }
      if (o.course) { c.fillStyle = 'rgba(40,30,20,0.16)'; for (let y = 0; y < h; y += o.course) c.fillRect(0, y, w, 1); }
      if (o.timber) {
        c.strokeStyle = o.timber; c.lineWidth = 5;
        for (let i = 0; i < rows; i++) { const y0 = i * SH; c.strokeRect(2, y0 + 2, BW - 4, SH - 4); c.lineWidth = 3; c.beginPath(); c.moveTo(2, y0 + SH * 0.82); c.lineTo(BW / 2 - 14, y0 + SH * 0.5); c.moveTo(BW - 2, y0 + SH * 0.82); c.lineTo(BW / 2 + 14, y0 + SH * 0.5); c.moveTo(2, y0 + 2); c.lineTo(BW / 2 - 14, y0 + SH * 0.3); c.moveTo(BW - 2, y0 + 2); c.lineTo(BW / 2 + 14, y0 + SH * 0.3); c.stroke(); c.lineWidth = 5; }
      }
      for (let i = 0; i < rows; i++) {
        const y0 = i * SH;
        const ground = i === rows - 1;
        const ww = (o.win ? o.win[0] : 0.4) * BW;
        const wh = (o.win ? o.win[1] : 0.55) * SH;
        const wx = (BW - ww) / 2;
        const wy = y0 + SH * 0.2;
        const frame = o.frame || '#e9e4d6';
        if (ground && o.ground === 'none') continue;
        if (ground && o.ground === 'arch') {
          const gw = ww * 1.15, gx = (BW - gw) / 2, gh = SH * 0.72, gy = y0 + SH - gh - 6;
          c.fillStyle = frame;
          c.beginPath(); c.moveTo(gx - 4, y0 + SH - 6); c.lineTo(gx - 4, gy + gw / 2); c.arc(BW / 2, gy + gw / 2, gw / 2 + 4, Math.PI, 0); c.lineTo(gx + gw + 4, y0 + SH - 6); c.closePath(); c.fill();
          c.fillStyle = o.winCol || '#51697a';
          c.beginPath(); c.moveTo(gx, y0 + SH - 6); c.lineTo(gx, gy + gw / 2); c.arc(BW / 2, gy + gw / 2, gw / 2, Math.PI, 0); c.lineTo(gx + gw, y0 + SH - 6); c.closePath(); c.fill();
          c.fillStyle = frame; c.fillRect(BW / 2 - 1.5, gy + gw / 2, 3, gh); c.fillRect(gx, gy + gw / 2 + gh * 0.35, gw, 2.5);
        } else {
          c.fillStyle = frame; c.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
          const g = c.createLinearGradient(0, wy, 0, wy + wh);
          g.addColorStop(0, o.winCol || '#5b7488'); g.addColorStop(1, o.winCol2 || '#9db4c4');
          c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
          c.fillStyle = frame; c.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); c.fillRect(wx, wy + wh * 0.42, ww, 2.5);
        }
        if (o.band) { c.fillStyle = o.band; c.fillRect(0, y0 + SH - 4, w, 4); }
      }
      if (o.plinth) { c.fillStyle = o.plinth; c.fillRect(0, h - 10, w, 10); }
    });
  }
  function plainTex(k, key, base, speck) {
    return k.ctex('ab-plain-' + key, 64, 64, (c, w, h) => {
      const r = rng(hash(key));
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + ((speck || 0.1) * (0.3 + r())).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 4, 1 + r() * 3); }
    });
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ------------------------------------------------------------------ METZ-VILLE */
  /* Romanesque Revival (1908): rough grey-yellow sandstone, central gable with three tall arched windows, 40 m clock tower with a green
     copper spire, long wings with arcade windows under a dark green slate roof. */
  function buildMetz(api) {
    const k = kit(api);
    const { X, vc, glow, texB, colB, glassB, box, quadO, triO, wallD, wallZ, frustum, gableD, gableZ, clockD, clockZ, ctex, col, shade, WHITE, BACK, FORM_Y, sx, H, W, edge, L, zA, zB, T, M, mat, helpers } = k;
    const STONE = '#b5a47c';
    const STONE_LT = '#cdbf9a';
    const SLATE = '#3c4a43';
    const COPPER = '#68998a';

    // wall textures (cached by key)
    const wingTex = () => ctex('ab-metz-wing', 128, 256, (c, w, h) => {
      const r = rng(5);
      c.fillStyle = STONE; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.04 + r() * 0.1).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 4); }
      c.fillStyle = 'rgba(60,50,30,0.25)';
      for (let y = 0; y < h; y += 16) c.fillRect(0, y, w, 1);
      // upper floor: two small arched windows pair (Romanesque bifora)
      c.fillStyle = '#2f3b44';
      [[38, 28], [78, 28]].forEach(([x, y]) => { c.beginPath(); c.moveTo(x, y + 60); c.lineTo(x, y + 14); c.arc(x + 6, y + 14, 6, Math.PI, 0); c.lineTo(x + 12, y + 60); c.closePath(); c.fill(); });
      c.fillStyle = STONE_LT; c.fillRect(30, 20, 60, 3);
      // ground floor: tall round arch window
      c.fillStyle = STONE_LT;
      c.beginPath(); c.moveTo(24, h - 4); c.lineTo(24, 168); c.arc(64, 168, 40, Math.PI, 0); c.lineTo(104, h - 4); c.closePath(); c.fill();
      c.fillStyle = '#34444f';
      c.beginPath(); c.moveTo(32, h - 4); c.lineTo(32, 168); c.arc(64, 168, 32, Math.PI, 0); c.lineTo(96, h - 4); c.closePath(); c.fill();
      c.fillStyle = 'rgba(220,235,245,0.25)'; c.fillRect(60, 140, 8, h);
      c.fillStyle = 'rgba(40,30,20,0.4)'; c.fillRect(0, h - 3, w, 3);
    });
    const gableTex = () => ctex('ab-metz-gable', 256, 256, (c, w, h) => {
      const r = rng(9);
      c.fillStyle = STONE; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2200; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.04 + r() * 0.1).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 8, 2 + r() * 5); }
      c.fillStyle = 'rgba(60,50,30,0.22)';
      for (let y = 0; y < h; y += 14) c.fillRect(0, y, w, 1);
      // big arch with three tall windows
      c.fillStyle = STONE_LT;
      c.beginPath(); c.moveTo(34, h); c.lineTo(34, 130); c.arc(128, 130, 94, Math.PI, 0); c.lineTo(222, h); c.closePath(); c.fill();
      c.fillStyle = '#2d3a44';
      c.beginPath(); c.moveTo(46, h); c.lineTo(46, 132); c.arc(128, 132, 82, Math.PI, 0); c.lineTo(210, h); c.closePath(); c.fill();
      c.fillStyle = STONE_LT;
      [78, 128, 178].forEach((x) => { c.fillRect(x - 3, 70, 6, h); });
      c.fillStyle = '#ecd9a0';
      [[56, 100], [92, 70], [140, 70], [176, 100]].forEach(([x, y]) => { c.fillStyle = 'rgba(245,225,150,0.55)'; c.fillRect(x, y + 18, 24, 120); });
      c.fillStyle = STONE_LT; c.fillRect(44, 150, 168, 5);
      c.fillStyle = 'rgba(40,30,20,0.4)'; c.fillRect(0, h - 3, w, 3);
    });
    const towerTex = () => ctex('ab-metz-tower', 128, 256, (c, w, h) => {
      const r = rng(13);
      c.fillStyle = STONE; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.04 + r() * 0.1).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 4); }
      c.fillStyle = 'rgba(60,50,30,0.25)';
      for (let y = 0; y < h; y += 16) c.fillRect(0, y, w, 1);
      c.fillStyle = '#2f3b44';
      [h * 0.62, h * 0.42, h * 0.22].forEach((y) => c.fillRect(56, y, 16, 34));
      c.fillStyle = STONE_LT; c.fillRect(0, h * 0.8, w, 4);
    });
    const slate = texB('slate-metz', () => slateTex(k, 'metz', SLATE));

    const wing = texB('metz-wing', wingTex);
    const gable = texB('metz-gable', gableTex);
    const tower = texB('metz-tower', towerTex);
    const plain = texB('metz-plain', () => ctex('ab-metz-plain', 128, 128, (c, w, h) => {
      const r = rng(21); c.fillStyle = STONE; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.04 + r() * 0.1).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 4); }
    }));
    const d0 = BACK, DEP = 10;
    const wallH = 10.5;
    const y0 = FORM_Y;

    // wings
    [[25, 120, 1], [-120, -22, -1]].forEach(([za, zb, dir]) => {
      const len = zb - za;
      const bays = Math.round(len / 5.5);
      wallD(wing, d0, za, zb, y0, wallH, -1, bays, 1);
      wallD(plain, d0 + DEP, za, zb, y0, wallH, 1, 4, 1);
      wallZ(plain, za, d0, d0 + DEP, y0, wallH, -1, 2, 1);
      wallZ(plain, zb, d0, d0 + DEP, y0, wallH, 1, 2, 1);
      vc.box(X(d0 + DEP / 2), wallH + 0.15, (za + zb) / 2, DEP + 0.6, 0.3, len + 0.6, col(STONE_LT));
      gableZ(slate, plain, d0, d0 + DEP, za, zb, wallH + 0.3, wallH + 5.4, 0.6, WHITE, WHITE);
      // dormers: little gabled windows along the roof
      for (let z = za + 4; z < zb - 3; z += 11) {
        box(vc, d0 + 1.2, d0 + 3.2, z - 1, z + 1, wallH + 1.2, wallH + 3.4, col(STONE_LT));
        box(vc, d0 + 1.0, d0 + 1.25, z - 0.6, z + 0.6, wallH + 1.6, wallH + 3.0, col('#27333b'));
      }
    });
    // central block with the big arched gable towards the track
    const cz0 = -22, cz1 = 16;
    const cH = 14.5;
    const cD = 15;
    wallD(gable, d0 - 1.2, cz0 + 8, cz1 - 8, y0, cH, -1, 1, 1); // inner face of the hall gable (plain arch window)
    // gable wall is a triangle atop: full-height face with arch window texture (square part)
    wallD(plain, d0 - 1.2, cz0, cz0 + 8, y0, cH, -1, 3, 1);
    wallD(plain, d0 - 1.2, cz1 - 8, cz1, y0, cH, -1, 3, 1);
    wallZ(plain, cz0, d0 - 1.2, d0 + cD, y0, cH, -1, 4, 1);
    wallZ(plain, cz1, d0 - 1.2, d0 + cD, y0, cH, 1, 4, 1);
    wallD(plain, d0 + cD, cz0, cz1, y0, cH, 1, 6, 1);
    gableD(slate, plain, d0 - 1.2, d0 + cD, cz0, cz1, cH, cH + 8, 0.7, WHITE, WHITE);
    // little turrets on the gable corners
    [[cz0 + 1.5], [cz1 - 1.5]].forEach(([z]) => {
      box(vc, d0 - 1.0, d0 + 1.0, z - 1, z + 1, cH, cH + 4, col(STONE_LT));
      frustum(vc, d0 - 1.0, d0 + 1.0, z - 1, z + 1, cH + 4, cH + 6.5, 0.9, 0.9, col(COPPER));
    });
    // tower
    const tz0 = 16, tz1 = 25, td0 = d0 + 1.5, td1 = d0 + 10.5;
    const tH = 36;
    wallD(tower, td0, tz0, tz1, y0, tH, -1, 1, 1);
    wallD(tower, td1, tz0, tz1, y0, tH, 1, 1, 1);
    wallZ(tower, tz0, td0, td1, y0, tH, -1, 1, 1);
    wallZ(tower, tz1, td0, td1, y0, tH, 1, 1, 1);
    vc.box(X((td0 + td1) / 2), tH + 0.3, (tz0 + tz1) / 2, 10.4, 0.6, 10.4, col(STONE_LT));
    // belfry with small arches (dark openings) and corner pinnacles
    box(vc, td0 + 0.6, td1 - 0.6, tz0 + 0.6, tz1 - 0.6, tH + 0.6, tH + 5.2, col(STONE));
    [-1, 1].forEach((s) => {
      box(vc, (td0 + td1) / 2 - 2.5, (td0 + td1) / 2 + 2.5, (tz0 + tz1) / 2 + s * 4.15, (tz0 + tz1) / 2 + s * 4.35, tH + 1.4, tH + 4.4, col('#27333b'));
      box(vc, (td0 + td1) / 2 - 2.5, (td0 + td1) / 2 + 2.5, (tz0 + tz1) / 2 + s * 4.15 + s * 0.05, (tz0 + tz1) / 2 + s * 4.35, tH + 1.4, tH + 4.4, col('#27333b'));
    });
    box(vc, td0 + 0.4, td0 + 0.7, (tz0 + tz1) / 2 - 2.5, (tz0 + tz1) / 2 + 2.5, tH + 1.4, tH + 4.4, col('#27333b'));
    frustum(vc, td0 + 0.3, td1 - 0.3, tz0 + 0.3, tz1 - 0.3, tH + 5.2, tH + 14, 3.6, 3.6, col(COPPER));
    vc.box(X((td0 + td1) / 2), tH + 15.5, (tz0 + tz1) / 2, 0.14, 3.2, 0.14, col('#8a8f55'));
    // clock faces: toward the track and to both ends
    clockD(td0 - 0.06, tH - 5.5, (tz0 + tz1) / 2, 4.6, -1);
    clockZ((td0 + td1) / 2, tH - 5.5, tz0 - 0.06, 4.6, -1);
    clockZ((td0 + td1) / 2, tH - 5.5, tz1 + 0.06, 4.6, 1);
    clockD(td1 + 0.06, tH - 5.5, (tz0 + tz1) / 2, 4.6, 1);

    // platform roof: a long, plain steel canopy (SNCF grey) on slender columns, over most of the platform
    const canH = 4.4;
    const canLen = L * 0.8;
    const cz = 0;
    k.deckB('metz-deck', { roughness: 0.8 }).box(X(edge + W / 2 + 0.9), canH, cz, W - 1.2, 0.22, canLen, col('#a3abae'), 0, 0, sx * 0.04);
    vc.box(X(edge + 0.3), canH - 0.1, cz, 0.12, 0.4, canLen, col('#4a5a52'));
    for (let z = cz - canLen / 2; z <= cz + canLen / 2 + 0.1; z += 10) {
      vc.box(X(edge + W - 1.2), (H + canH) / 2, z, 0.22, canH - H, 0.22, col('#5d6a66'));
      glow.box(X(edge + W / 2), canH - 0.2, z + 5, 0.7, 0.05, 0.3, col('#fff3d0'));
    }
    // benches and lamps
    for (let z = cz - canLen / 2 + 6; z < cz + canLen / 2 - 6; z += 18) helpers_bench(api, X(edge + W - 0.7), H, z);
  }

  /* generic helper: a big stone arch window texture (Metz/Koblenz/Nancy style) */
  function archWallTex(k, key, o) {
    return k.ctex('ab-arch-' + key, 256, 256, (c, w, h) => {
      const r = rng(hash(key));
      c.fillStyle = o.base; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2000; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.04 + r() * 0.1).toFixed(2) + ')'; c.fillRect(r() * w, r() * h, 2 + r() * 7, 2 + r() * 4); }
      c.fillStyle = 'rgba(60,50,30,0.2)'; for (let y = 0; y < h; y += 14) c.fillRect(0, y, w, 1);
      const cx = w / 2, R = o.R || 88, top = o.top || 120;
      c.fillStyle = o.trim;
      c.beginPath(); c.moveTo(cx - R - 12, h); c.lineTo(cx - R - 12, top); c.arc(cx, top, R + 12, Math.PI, 0); c.lineTo(cx + R + 12, h); c.closePath(); c.fill();
      c.fillStyle = o.glass || '#2d3a44';
      c.beginPath(); c.moveTo(cx - R, h); c.lineTo(cx - R, top); c.arc(cx, top, R, Math.PI, 0); c.lineTo(cx + R, h); c.closePath(); c.fill();
      c.fillStyle = o.trim;
      const n = o.bars || 3;
      for (let i = 1; i < n; i++) c.fillRect(cx - R + (2 * R * i) / n - 3, top - R, 6, h);
      c.fillRect(cx - R, top + 36, 2 * R, 5);
      if (o.lit) { c.fillStyle = 'rgba(245,225,150,0.35)'; c.fillRect(cx - R + 8, top - R * 0.6, 2 * R - 16, h); }
      if (o.clock) { c.fillStyle = '#efe9d6'; c.beginPath(); c.arc(cx, top - R * 0.45, 18, 0, 6.3); c.fill(); c.strokeStyle = '#222'; c.lineWidth = 2; c.stroke(); c.beginPath(); c.moveTo(cx, top - R * 0.45); c.lineTo(cx, top - R * 0.45 - 12); c.moveTo(cx, top - R * 0.45); c.lineTo(cx + 9, top - R * 0.45 + 4); c.stroke(); }
      c.fillStyle = 'rgba(40,30,20,0.4)'; c.fillRect(0, h - 3, w, 3);
    });
  }

  /* ------------------------------------------------------------------ TREIER HBF */
  /* 1950s Hauptbahnhof: long beige block, three storeys of small square windows, taller central entrance block with dark stone piers and a big
     round clock; deep steel/concrete platform halls with glazed strips. */
  function buildTrier(api) {
    const k = kit(api);
    const { X, vc, glow, texB, colB, glassB, box, wallD, wallZ, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L, helpers } = k;
    const d0 = BACK;
    const FAC = { key: 'trier', base: '#e2d8bd', speck: 0.03, win: [0.5, 0.52], winCol: '#4f6677', winCol2: '#8aa2b2', frame: '#f1ecdc', ground: 'rect', band: '#b9ac86' };
    [[18, 78, 3], [-78, -18, 3], [78, 112, 2], [-112, -78, 2]].forEach(([z0, z1, rows]) => k.bldg({ d0, dep: 12, z0, z1, rows, sh: 4, fac: FAC, bayW: 3.4, roof: 'flat', capCol: '#6e7377' }));
    // central entrance block: dark stone piers over glass
    const cz0 = -18, cz1 = 18, cH = 14.8;
    const cen = texB('trier-center', () => ctex('ab-trier-center', 128, 256, (c, w, h) => {
      c.fillStyle = '#cfc2a0'; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#46606f'); g.addColorStop(1, '#8ca4b3');
      c.fillStyle = g; c.fillRect(0, 24, w, h - 40);
      c.fillStyle = '#323a3e'; for (let y = 60; y < h - 20; y += 36) c.fillRect(0, y, w, 3);
      c.fillStyle = '#cfc2a0'; c.fillRect(0, 0, w, 24);
    }));
    const pl = texB('plain-trier', () => ctex('ab-plain-trier', 64, 64, (c, w, h) => { c.fillStyle = '#d3c6a3'; c.fillRect(0, 0, w, h); }));
    wallD(cen, d0 - 0.8, cz0, cz1, FORM_Y, cH, -1, 7, 1);
    wallD(pl, d0 + 11, cz0, cz1, FORM_Y, cH, 1, 4, 1);
    wallZ(pl, cz0, d0 - 0.8, d0 + 11.2, FORM_Y, cH, -1, 2, 1);
    wallZ(pl, cz1, d0 - 0.8, d0 + 11.2, FORM_Y, cH, 1, 2, 1);
    vc.box(X(d0 + 5.2), cH + 0.2, 0, 12.8, 0.5, cz1 - cz0 + 1.6, col('#5b5f62'));
    for (let i = 0; i <= 7; i++) box(vc, d0 - 1.6, d0 - 0.7, cz0 + 1 + i * ((cz1 - cz0 - 2) / 7) - 0.55, cz0 + 1 + i * ((cz1 - cz0 - 2) / 7) + 0.55, FORM_Y, cH, col('#6d6254'));
    // forecourt canopy slab over the entrance
    box(vc, d0 - 3.2, d0 - 0.7, cz0 + 1, cz1 - 1, 4.6, 4.9, col('#5b5f62'));
    k.clockD(d0 - 1.75, 11.6, 0, 3.8, -1);
    k.clockD(d0 + 11.25, 11.6, 0, 3.8, 1);
    // platform halls: deep canopy, dark steel columns, glazed strip
    const deck = k.deckB('trier-deck', { roughness: 0.8, metalness: 0.2 });
    k.canopy({ z0: -L * 0.46, z1: L * 0.46, d0: 2.5, d1: edge + W + 0.2, y: 5.4, rise: 0.4, deck, deckCol: col('#9da2a5'), fascia: [0.55, '#3d4347'], colD: edge + W - 1.6, colB: vc, colCol: '#3e4a45', step: 9, round: false, colW: 0.28 });
    const gl = glassB();
    gl.box(X((2.5 + edge + W) / 2), 5.75, 0, (edge + W - 2.5) * 0.5, 0.12, L * 0.9, WHITE);
    k.furnish(-L * 0.4, L * 0.4, edge + W - 0.8, edge + W * 0.55, 22, 30);
    // the second platform (island) across the other track: a long low canopy only
    k.dbPaving(-L / 2, L / 2);
    k.track(-4.6, -L * 0.6, L * 0.6);
  }

  /* ------------------------------------------------------------------ KOBLENZ HBF */
  function buildKoblenz(api) {
    const k = kit(api);
    const { X, vc, glow, texB, colB, glassB, box, wallD, wallZ, frustum, gableD, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L, helpers } = k;
    const d0 = BACK;
    const OCHRE = '#d4b777', TRIM = '#e7d6a2', SLATE = '#3a3d42';
    const FAC = { key: 'koblenz', base: OCHRE, speck: 0.1, course: 12, win: [0.4, 0.5], winCol: '#40505c', winCol2: '#7d93a2', frame: TRIM, ground: 'arch', band: '#bfa468' };
    [[26, 90], [-90, -26]].forEach(([z0, z1]) => k.bldg({ d0, dep: 11, z0, z1, rows: 2, sh: 4.5, fac: FAC, bayW: 4.6, roof: 'hip', roofH: 4.2, roofKey: 'kob', roofBase: SLATE, roofOv: 0.6 }));
    // central block: big arched window, mansard roof with dormers
    const cz0 = -26, cz1 = 26, cH = 14.5, cDep = 16;
    const gableT = texB('koblenz-arch', () => archWallTex(k, 'koblenz', { base: OCHRE, trim: TRIM, R: 86, top: 118, bars: 4, lit: true, glass: '#3b4a56' }));
    const pl = texB('plain-koblenz', () => ctex('ab-plain-koblenz', 64, 64, (c, w, h) => { c.fillStyle = OCHRE; c.fillRect(0, 0, w, h); }));
    wallD(gableT, d0 - 1.2, cz0 + 10, cz1 - 10, FORM_Y, cH, -1, 1, 1);
    wallD(pl, d0 - 1.2, cz0, cz0 + 10, FORM_Y, cH, -1, 3, 1);
    wallD(pl, d0 - 1.2, cz1 - 10, cz1, FORM_Y, cH, -1, 3, 1);
    wallD(pl, d0 + cDep, cz0, cz1, FORM_Y, cH, 1, 4, 1);
    wallZ(pl, cz0, d0 - 1.2, d0 + cDep, FORM_Y, cH, -1, 4, 1);
    wallZ(pl, cz1, d0 - 1.2, d0 + cDep, FORM_Y, cH, 1, 4, 1);
    vc.box(X(d0 + cDep / 2 - 0.6), cH + 0.15, 0, cDep + 1.6, 0.3, cz1 - cz0 + 1.4, col(TRIM));
    const roof = texB('roof-kob', () => slateTex(k, 'kob', SLATE));
    frustum(roof, d0 - 1.8, d0 + cDep + 0.6, cz0 - 0.7, cz1 + 0.7, cH + 0.3, cH + 6.8, 3.4, 4.6, WHITE);
    frustum(roof, d0 + 1.6, d0 + cDep - 2.8, cz0 + 3.9, cz1 - 3.9, cH + 6.8, cH + 9.2, 2.2, 6.0, WHITE);
    vc.box(X(d0 + cDep / 2 - 0.6), cH + 9.5, 0, 0.5, 1.0, 12, col('#2a2d30'));
    for (let z = cz0 + 5; z < cz1 - 4; z += 6.5) {
      box(vc, d0 - 0.4, d0 + 1.6, z - 1.0, z + 1.0, cH + 2.2, cH + 4.8, col(TRIM));
      box(vc, d0 - 0.45, d0 - 0.3, z - 0.6, z + 0.6, cH + 2.8, cH + 4.2, col('#26323a'));
      frustum(vc, d0 - 0.6, d0 + 1.8, z - 1.2, z + 1.2, cH + 4.8, cH + 5.8, 0.9, 0.0, col(SLATE));
    }
    // clock on the gable centre (above the window)
    k.clockD(d0 - 1.28, cH + 3.2, 0, 3.4, -1);
    // wavy modern platform canopy: flat grey plates on slim round columns
    const deck = k.deckB('koblenz-deck', { roughness: 0.75, metalness: 0.15 });
    k.canopy({ z0: -L * 0.46, z1: L * 0.46, d0: 2.6, d1: edge + W + 0.3, y: 5.0, rise: 0.5, deck, deckCol: col('#c6c9cb'), thick: 0.45, colD: edge + 3.6, colB: vc, colCol: '#9a9fa2', step: 14, round: true, colW: 0.4 });
    k.furnish(-L * 0.4, L * 0.4, edge + W - 0.8, edge + W * 0.5, 22, 30);
    k.dbPaving(-L / 2, L / 2);
    k.track(-4.6, -L * 0.6, L * 0.6);
    // Festung Ehrenbreitstein across the Rhine: a hill with a stone fortress on top
    const hill = colB('koblenz-hill', { roughness: 1, metalness: 0 }, false);
    frustum(hill, -190, -80, -250, -90, FORM_Y - 10, 48, 38, 28, col('#5e7a48'));
    box(hill, -160, -118, -210, -150, 44, 56, col('#a39a87'));
    box(hill, -150, -128, -200, -160, 56, 62, col('#8f877a'));
  }

  /* ------------------------------------------------------------------ THIONVILLE */
  function buildThionville(api) {
    const k = kit(api);
    const { X, vc, glow, texB, colB, box, wallD, wallZ, frustum, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L } = k;
    const d0 = BACK;
    const OCHRE = '#d2b46e';
    const FAC = { key: 'thionville', base: OCHRE, speck: 0.09, course: 10, win: [0.36, 0.55], winCol: '#425664', winCol2: '#82989a', frame: '#e8dcae', ground: 'arch', band: '#b39a5c' };
    // long two-storey block with a taller three-storey end wing (the real one has the square clock-less tower wing at the right)
    k.bldg({ d0, dep: 9, z0: -44, z1: 14, rows: 2, sh: 4.2, fac: FAC, bayW: 4.2, roof: 'hip', roofH: 2.4, roofKey: 'thi', roofBase: '#59616a', roofOv: 0.7 });
    k.bldg({ d0: d0 - 0.6, dep: 10.2, z0: 14, z1: 36, rows: 3, sh: 4.4, fac: Object.assign({}, FAC, { key: 'thionville-w' }), bayW: 4.4, roof: 'hip', roofH: 2.8, roofKey: 'thi', roofBase: '#59616a', roofOv: 0.7, plainKey: 'thionville' });
    k.bldg({ d0: d0 + 3, dep: 4.4, z0: -26, z1: -20, y0: 8.4, rows: 1, sh: 3.0, fac: Object.assign({}, FAC, { key: 'thionville-b', ground: 'rect' }), roof: 'hip', roofH: 1.4, roofKey: 'thi', roofBase: '#59616a', roofOv: 0.4, plainKey: 'thionville' });
    // green cast-iron canopy: umbrella columns in the middle of the platform with curved brackets, straw-coloured wooden roof
    const deck = k.deckB('thi-deck', { roughness: 0.8 });
    const mid = edge + W / 2 + 0.4;
    const dA = 2.7, dB = mid + 3.0;     // the roof keeps clear of the 2.2 m clearance envelope
    deck.box(X((dA + dB) / 2), 4.6, 0, dB - dA, 0.2, L * 0.9, col('#cdbd86'));
    vc.box(X(dA), 4.45, 0, 0.1, 0.5, L * 0.9, col('#2c6a56'));
    vc.box(X(dB), 4.45, 0, 0.1, 0.5, L * 0.9, col('#2c6a56'));
    for (let z = -L * 0.45; z <= L * 0.45 + 0.1; z += 7) {
      vc.cyl(X(mid), (H + 3.8) / 2, z, 0.1, 3.8 - H, col('#2c6a56'));
      vc.cyl(X(mid), 3.9, z, 0.18, 0.4, col('#2c6a56'));
      [[-1, 2.0], [1, 3.0]].forEach(([sgn, reach]) => {
        vc.between([X(mid), 3.8, z], [X(mid + sgn * reach * 0.55), 4.35, z], 0.1, col('#2c6a56'), 0.1);
        vc.between([X(mid + sgn * reach * 0.55), 4.35, z], [X(mid + sgn * reach), 4.5, z], 0.08, col('#2c6a56'), 0.08);
      });
      glow.box(X(mid), 4.45, z + 3.5, 0.7, 0.05, 0.3, col('#fff3d0'));
    }
    k.furnish(-L * 0.4, L * 0.4, edge + W - 0.7, edge + W - 0.7, 24, 30);
    k.dbPaving(-L / 2, L / 2, '#94918c');
    k.track(-4.6, -L * 0.6, L * 0.6);
  }

  /* ------------------------------------------------------------------ COCHEM */
  /* Jugendstil Bahnhof (1900s): dark natural-stone ground floor, yellow half-timbered upper floor, steep slate roofs, round white stair tower. */
  function buildCochem(api) {
    const k = kit(api);
    const { X, vc, texB, colB, box, wallD, wallZ, frustum, gableD, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L } = k;
    const d0 = BACK;
    const STONE = '#6e675b', YEL = '#dfb95f', SLATE = '#3d4247';
    const G = { key: 'cochem-g', base: STONE, speck: 0.16, course: 11, win: [0.4, 0.5], winCol: '#2e3a42', winCol2: '#50626c', frame: '#a89f8b', ground: 'arch' };
    const U = { key: 'cochem-u', base: YEL, speck: 0.06, win: [0.38, 0.52], winCol: '#3e4e5a', winCol2: '#7d93a2', frame: '#f0ead6', ground: 'rect', timber: '#4a2f1e' };
    k.bldg({ d0, dep: 9.5, z0: -22, z1: 14, rows: 1, sh: 4.3, fac: G, bayW: 4, roof: 'none', plainKey: 'cochem-g' });
    k.bldg({ d0, dep: 9.5, z0: -22, z1: 14, y0: 4.3, rows: 1, sh: 3.6, fac: U, bayW: 4, roof: 'hip', roofH: 5.4, roofKey: 'coc', roofBase: SLATE, roofOv: 0.9, plainKey: 'cochem-u' });
    for (let z = -19; z < 2; z += 5.5) {
      box(vc, d0 + 0.6, d0 + 2.6, z - 0.9, z + 0.9, 8.4, 10.4, col('#6b665c'));
      box(vc, d0 + 0.5, d0 + 0.7, z - 0.55, z + 0.55, 8.8, 10.0, col('#28343c'));
      frustum(vc, d0 + 0.4, d0 + 2.8, z - 1.1, z + 1.1, 10.4, 11.4, 0.0, 1.0, col(SLATE));
    }
    // cross gable pavilion toward the platform
    k.bldg({ d0: d0 - 1.8, dep: 3.0, z0: -6, z1: 6, rows: 1, sh: 4.3, fac: G, bayW: 4, roof: 'none', plainKey: 'cochem-g' });
    k.bldg({ d0: d0 - 1.8, dep: 3.0, z0: -6, z1: 6, y0: 4.3, rows: 1, sh: 3.6, fac: U, bayW: 4, roof: 'none', plainKey: 'cochem-u' });
    const roof = texB('roof-coc', () => slateTex(k, 'coc', SLATE));
    const pl = texB('plain-cochem-u', () => ctex('ab-plain-cochem-u', 64, 64, (c, w, h) => { c.fillStyle = YEL; c.fillRect(0, 0, w, h); }));
    k.gableD(roof, pl, d0 - 1.8, d0 + 4, -6, 6, 7.9, 14.4, 0.9, WHITE, WHITE);
    // round white stair tower with a dark pointed cap
    const tz = 10, td = d0 + 1.6;
    vc.cyl(X(td), 9.2, tz, 2.3, 18.6, col('#ece6d6'));
    vc.cyl(X(td), 18.8, tz, 2.6, 0.5, col('#3d4247'));
    frustum(vc, td - 2.7, td + 2.7, tz - 2.7, tz + 2.7, 19, 25.5, 2.55, 2.55, col('#33383d'));
    vc.cyl(X(td), 26.5, tz, 0.12, 2.2, col('#b8a24a'));
    for (let i = 0; i < 4; i++) box(vc, td - 0.3, td + 0.3, tz - 2.34, tz - 2.3, 12 + i * 1.6, 13.2 + i * 1.6, col('#32414b'));
    k.clockD(td - 2.32, 15.5, tz, 2.2, -1);
    // small platform shelter
    const deck = k.deckB('cochem-deck', { roughness: 0.8 });
    k.canopy({ z0: -22, z1: 18, d0: 3.0, d1: edge + W - 0.2, y: 3.8, rise: 0.3, deck, deckCol: col('#868a8d'), fascia: [0.3, '#2e3a42'], colD: edge + W - 1.0, colB: vc, colCol: '#4e5a55', step: 8, round: false });
    k.furnish(-60, 60, edge + W - 0.7, edge + W * 0.5, 30, 38);
  }

  /* ------------------------------------------------------------------ NANCY-VILLE */
  function buildNancy(api) {
    const k = kit(api);
    const { X, vc, texB, colB, box, wallD, wallZ, frustum, gableD, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L } = k;
    const d0 = BACK;
    const OC = '#c9984f', TRIM = '#e3c88b';
    const F = { key: 'nancy', base: OC, speck: 0.1, course: 11, win: [0.36, 0.55], winCol: '#3f5460', winCol2: '#7d949f', frame: TRIM, ground: 'arch', band: '#a97d3c' };
    [[17, 85], [-85, -17]].forEach(([z0, z1]) => k.bldg({ d0, dep: 9, z0, z1, rows: 2, sh: 4.6, fac: F, bayW: 4.6, roof: 'hip', roofH: 2.3, roofKey: 'nan', roofBase: '#6a6e72', roofOv: 0.5 }));
    // central pavilion: big arched clock window, curved gable pediment
    const cz0 = -17, cz1 = 17, cH = 12.4;
    const arch = texB('nancy-arch', () => archWallTex(k, 'nancy', { base: OC, trim: TRIM, R: 74, top: 130, bars: 2, glass: '#46606c', clock: true, lit: false }));
    const pl = texB('plain-nancy', () => ctex('ab-plain-nancy', 64, 64, (c, w, h) => { c.fillStyle = OC; c.fillRect(0, 0, w, h); }));
    wallD(arch, d0 - 0.7, cz0 + 4, cz1 - 4, FORM_Y, cH, -1, 1, 1);
    wallD(pl, d0 - 0.7, cz0, cz0 + 4, FORM_Y, cH, -1, 2, 1);
    wallD(pl, d0 - 0.7, cz1 - 4, cz1, FORM_Y, cH, -1, 2, 1);
    wallD(pl, d0 + 10, cz0, cz1, FORM_Y, cH, 1, 4, 1);
    wallZ(pl, cz0, d0 - 0.7, d0 + 10, FORM_Y, cH, -1, 3, 1);
    wallZ(pl, cz1, d0 - 0.7, d0 + 10, FORM_Y, cH, 1, 3, 1);
    vc.box(X(d0 + 4.6), cH + 0.2, 0, 11.8, 0.4, cz1 - cz0 + 1, col(TRIM));
    const roof = texB('roof-nan', () => slateTex(k, 'nan', '#6a6e72'));
    k.gableD(roof, pl, d0 - 0.7, d0 + 10, cz0, cz1, cH, cH + 5.2, 0.5, WHITE, WHITE);
    [[cz0 + 1], [cz1 - 1]].forEach(([z]) => { box(vc, d0 - 1.0, d0 + 0.4, z - 1, z + 1, cH - 1, cH + 3.2, col(TRIM)); frustum(vc, d0 - 1.1, d0 + 0.5, z - 1.1, z + 1.1, cH + 3.2, cH + 4.4, 0.6, 0.6, col('#6a6e72')); });
    // Tour Thiers: the white high-rise behind the station
    const tower = colB('nancy-tower', { roughness: 0.85, metalness: 0.02 }, false);
    box(tower, 52, 76, 28, 44, FORM_Y, 92, col('#dedad0'));
    for (let i = 0; i < 20; i++) box(tower, 51.9, 52.0, 28.5, 43.5, 4 + i * 4.2, 5.6 + i * 4.2, col('#7f8d96'));
    // red cast-iron canopies: red columns with curved brackets, dark deck
    const deck = k.deckB('nancy-deck', { roughness: 0.8 });
    k.canopy({ z0: -L * 0.46, z1: L * 0.46, d0: 2.8, d1: edge + W + 0.4, y: 4.9, rise: 0.4, deck, deckCol: col('#4b4c4f'), thick: 0.3, fascia: [0.6, '#a82b22'], colDs: [edge + 1.0, edge + W - 1.2], colB: vc, colCol: '#a82b22', step: 9, round: true, colW: 0.17 });
    for (let z = -L * 0.46; z <= L * 0.46; z += 9) {
      vc.between([X(edge + 1.0), 3.9, z], [X(edge + 2.6), 4.9, z], 0.14, col('#a82b22'), 0.14);
      vc.between([X(edge + W - 1.2), 3.9, z], [X(edge + W - 2.8), 4.9, z], 0.14, col('#a82b22'), 0.14);
    }
    k.furnish(-L * 0.4, L * 0.4, edge + W - 0.5, edge + W * 0.5, 24, 30);
    k.track(-4.6, -L * 0.6, L * 0.6);
  }

  /* ------------------------------------------------------------------ NAMUR */
  function buildNamur(api) {
    const k = kit(api);
    const { X, vc, glow, texB, colB, box, wallD, wallZ, frustum, gableD, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L, helpers } = k;
    const d0 = BACK;
    const CR = '#e4d8b0', TRIM = '#f1e8c8';
    const F = { key: 'namur', base: CR, speck: 0.06, course: 12, win: [0.34, 0.56], winCol: '#506a7a', winCol2: '#8fa5b2', frame: TRIM, ground: 'arch', band: '#c2b48a' };
    [[24, 100], [-100, -24]].forEach(([z0, z1]) => k.bldg({ d0, dep: 9, z0, z1, rows: 2, sh: 4.5, fac: F, bayW: 4.8, roof: 'hip', roofH: 3.4, roofKey: 'nam', roofBase: '#5a6470', roofOv: 0.6 }));
    [[10, 24], [-24, -10]].forEach(([z0, z1]) => k.bldg({ d0, dep: 9, z0, z1, rows: 2, sh: 4.5, fac: F, bayW: 4.8, roof: 'hip', roofH: 3.4, roofKey: 'nam', roofBase: '#5a6470', roofOv: 0.6 }));
    // central pavilion with the clock pediment
    const cz0 = -10, cz1 = 10, cH = 13.2;
    const arch = texB('namur-arch', () => archWallTex(k, 'namur', { base: CR, trim: TRIM, R: 78, top: 140, bars: 1, glass: '#4a6a7e', clock: true }));
    const pl = texB('plain-namur', () => ctex('ab-plain-namur', 64, 64, (c, w, h) => { c.fillStyle = CR; c.fillRect(0, 0, w, h); }));
    wallD(arch, d0 - 1.0, cz0, cz1, FORM_Y, cH, -1, 1, 1);
    wallD(pl, d0 + 9, cz0, cz1, FORM_Y, cH, 1, 3, 1);
    wallZ(pl, cz0, d0 - 1.0, d0 + 9, FORM_Y, cH, -1, 3, 1);
    wallZ(pl, cz1, d0 - 1.0, d0 + 9, FORM_Y, cH, 1, 3, 1);
    vc.box(X(d0 + 4), cH + 0.2, 0, 11.4, 0.4, cz1 - cz0 + 1, col(TRIM));
    const roof = texB('roof-nam', () => slateTex(k, 'nam', '#5a6470'));
    k.gableD(roof, pl, d0 - 1.0, d0 + 9, cz0, cz1, cH, cH + 4.2, 0.5, WHITE, WHITE);
    // platform: red-brown brick paving, slim red steel poles with the blue NAMUR plate
    k.paving('namur-brick', () => ctex('ab-namur-brick', 128, 128, (c, w, h) => {
      const r = rng(3); c.fillStyle = '#8c8279'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < w + 16; x += 32) { const v = Math.floor(r() * 22 - 11); c.fillStyle = 'rgb(' + (182 + v) + ',' + (170 + v) + ',' + (156 + v) + ')'; c.fillRect(x + 1, y + 1, 30, 14); }
    }), edge + 0.8, edge + W, -L / 2, L / 2, 5);
    const nameB = sets_signB(api, k);
    for (let z = -L * 0.42; z <= L * 0.42; z += 34) {
      [-0.9, 0.9].forEach((o) => vc.box(X(edge + 1.0), H + 1.5, z + o, 0.1, 3.0, 0.1, col('#c1271c')));
      helpers.textQuad(nameB, [X(edge + 1.0), H + 2.5, z], 1.8, 0.28, [sx, 0, 0], [0, 0, -sx], [0, 1, 0]);
      helpers.textQuad(nameB, [X(edge + 1.0), H + 2.5, z], 1.8, 0.28, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);
    }
    const deck = k.deckB('namur-deck', { roughness: 0.8 });
    k.canopy({ z0: -L * 0.4, z1: L * 0.3, d0: 3.2, d1: edge + W, y: 4.7, rise: 0.2, deck, deckCol: col('#b4b3ae'), thick: 0.35, fascia: [0.35, '#c1271c'], colD: edge + W - 1.2, colB: vc, colCol: '#c1271c', step: 9, round: true, colW: 0.14 });
    k.furnish(-L * 0.4, L * 0.4, edge + W - 0.6, edge + W * 0.5, 26, 30);
    // the glazed NAMUR wall bridging the tracks at the far end of the platforms
    const zB2 = -L / 2 - 26;
    const wall = texB('namur-wall', () => ctex('ab-namur-wall', 1024, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#a9c0cc'); g.addColorStop(1, '#7f9aab');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.35)'; for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 3, h);
      c.fillStyle = 'rgba(30,50,70,0.8)'; c.font = '800 96px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      'NAMUR'.split('').forEach((ch, i) => c.fillText(ch, 160 + i * 175, h / 2 + 4));
    }, { clampU: true, clampV: true }));
    wallZ(wall, zB2, -15, 15, 7.4, 12.2, 1, 1, 1);
    wallZ(wall, zB2 - 2.5, -15, 15, 7.4, 12.2, -1, 1, 1);
    box(vc, -15, 15, zB2 - 2.5, zB2, 12.2, 12.6, col('#8c9aa3'));
    box(vc, -15, 15, zB2 - 2.5, zB2, 7.0, 7.4, col('#8c9aa3'));
    [-15, 15].forEach((d) => box(vc, d - 0.5, d + 0.5, zB2 - 2.5, zB2, FORM_Y, 12.6, col('#c9c8c2')));
    k.track(-4.6, -L * 0.6, L * 0.6);
  }
  function sets_signB(api, k) {
    return api.sets.get('sign:' + api.st.name, () => api.M.sign(api.st.name, api.helpers.signTexture(api.st.name, 'rail')));
  }

  /* ------------------------------------------------------------------ BRUXELLES-MIDI */
  function buildMidi(api) {
    const k = kit(api);
    const { T, X, vc, glow, texB, colB, box, wallD, wallZ, frustum, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L, helpers } = k;
    // platform: grey stone tiles with the yellow safety line
    k.paving('midi-tile', () => ctex('ab-midi-tile', 128, 128, (c, w, h) => {
      const r = rng(8); c.fillStyle = '#7e848a'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const v = Math.floor(r() * 16 - 8); c.fillStyle = 'rgb(' + (128 + v) + ',' + (134 + v) + ',' + (140 + v) + ')'; c.fillRect(x + 1, y + 1, 30, 30); }
    }), edge + 0.8, edge + W, -L / 2, L / 2, 4);
    // wide steel platform canopy with blue columns
    const deck = k.deckB('midi-deck', { roughness: 0.55, metalness: 0.4 });
    k.canopy({ z0: -L * 0.48, z1: L * 0.48, d0: 2.6, d1: edge + W + 1.5, y: 5.8, rise: 0.4, deck, deckCol: col('#8e98a0'), thick: 0.5, fascia: [0.6, '#27559b'], colD: edge + W - 1.0, colB: vc, colCol: '#27559b', step: 12, round: true, colW: 0.22 });
    for (let z = -L * 0.48; z <= L * 0.48; z += 12) {
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => vc.between([X(edge + W - 1.0), 4.7, z], [X(edge + W - 1.0 - a * 2.6), 5.7, z + b * 3.6], 0.14, col('#27559b'), 0.14));
    }
    const gl = k.glassB();
    gl.box(X(edge + W * 0.55), 6.1, 0, 2.2, 0.1, L * 0.8, WHITE);
    k.furnish(-L * 0.42, L * 0.42, edge + W - 0.7, edge + W * 0.55, 24, 30);
    // bilingual blue name plates on the canopy columns, readable from the train
    const plate = texB('midi-plate', () => ctex('ab-midi-plate', 1024, 160, (c, w, h) => {
      c.fillStyle = '#1c3f8c'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f4f2ea'; c.fillRect(8, 8, w - 16, 5); c.fillRect(8, h - 13, w - 16, 5);
      c.font = '700 50px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('BRUXELLES-MIDI', w * 0.26, h / 2 + 2); c.fillText('BRUSSEL-ZUID', w * 0.74, h / 2 + 2);
      c.fillRect(w / 2 - 2, 24, 4, h - 48);
    }, { clampU: true, clampV: true }), { emissive: new T.Color(0x333333) });
    for (let z = -L * 0.36; z <= L * 0.36; z += 40) {
      const dm = edge + 3.4;
      [1, -1].forEach((f) => helpers.textQuad(plate, [X(dm), 4.5, z + f * 0.06], 3.0, 0.47, [0, 0, f], [f * sx * sx, 0, 0], [0, 1, 0]));
      vc.box(X(dm), 4.5, z, 3.1, 0.53, 0.1, col('#14284f'));
      [-1.3, 1.3].forEach((o) => vc.box(X(dm + o), 5.15, z, 0.05, 0.8, 0.05, col('#14284f')));
    }
    // concrete concourse bridging the tracks (the Midi building sits across the platforms)
    const zc = -L * 0.3;
    const cb = colB('midi-conc', { roughness: 0.9, metalness: 0.02 });
    box(cb, -17, edge + W + 6, zc - 5, zc + 5, 7.2, 12.4, col('#9aa0a4'));
    box(cb, -17, edge + W + 6, zc - 5.1, zc + 5.1, 9.2, 10.2, col('#2f3a44'));
    [-16.5, edge + W + 5.5].forEach((d) => box(cb, d - 0.6, d + 0.6, zc - 4, zc + 4, FORM_Y, 7.2, col('#8f959a')));
    // Tour du Midi: the dark glass high-rise
    const towB = texB('midi-tower', () => ctex('ab-midi-tower', 64, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a4a6e'); g.addColorStop(1, '#1b3550');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(210,225,240,0.5)'; for (let y = 0; y < h; y += 16) c.fillRect(0, y, w, 2);
      c.fillStyle = '#d9dee2'; c.fillRect(0, 0, 4, h); c.fillRect(w - 4, 0, 4, h);
    }), {}, false);
    const tx0 = 38, tx1 = 70, tz0 = -L * 0.65 - 16, tz1 = -L * 0.65 + 16;
    wallD(towB, tx0, tz0, tz1, FORM_Y, 118, -1, 4, 12);
    wallD(towB, tx1, tz0, tz1, FORM_Y, 118, 1, 4, 12);
    wallZ(towB, tz0, tx0, tx1, FORM_Y, 118, -1, 4, 12);
    wallZ(towB, tz1, tx0, tx1, FORM_Y, 118, 1, 4, 12);
    box(vc, tx0, tx1, tz0, tz1, 118, 119.2, col('#c9ced2'));
    k.track(-4.6, -L * 0.6, L * 0.6);
  }
  /* ------------------------------------------------------------------ CHAMPAGNE-ARDENNE TGV */
  /* 2007 TGV station in the fields: low stone-finned building with the station name in big letters on the roofline, black asphalt platforms,
     flat steel canopies on slanting white columns, a glazed footbridge across the tracks. */
  function buildChampagne(api) {
    const k = kit(api);
    const { X, vc, glow, texB, colB, box, wallD, wallZ, frustum, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L, helpers } = k;
    k.paving('cat-asphalt', () => ctex('ab-cat-asphalt', 128, 128, (c, w, h) => {
      const r = rng(17); c.fillStyle = '#3c3e41'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) { const v = 40 + Math.floor(r() * 40); c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)'; c.fillRect(r() * w, r() * h, 2, 2); }
    }), edge + 0.75, edge + W, -L / 2, L / 2, 6);
    const d0 = BACK + 5;
    const FIN = { key: 'cat', base: '#cdb68e', speck: 0.05, rows: 1, win: [0.7, 0.7], winCol: '#3a5668', winCol2: '#5f8296', frame: '#d9c9a4', ground: 'rect' };
    // the stone-finned hall: vertical fins in front of dark glass
    const fin = texB('cat-fins', () => ctex('ab-cat-fins', 128, 128, (c, w, h) => {
      c.fillStyle = '#35505f'; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3f6074'); g.addColorStop(1, '#6d92a4'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#cbb48b'; for (let x = 0; x < w; x += 32) c.fillRect(x, 0, 24, h);
      c.fillStyle = 'rgba(90,70,40,0.25)'; for (let x = 0; x < w; x += 32) c.fillRect(x + 22, 0, 2, h);
    }));
    const stone = texB('cat-stone', () => ctex('ab-cat-stone', 64, 64, (c, w, h) => { const r = rng(4); c.fillStyle = '#c4ab82'; c.fillRect(0, 0, w, h); for (let i = 0; i < 200; i++) { c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(r() * w, r() * h, 3, 2); } }));
    const z0 = -46, z1 = 46, hh = 8.2, dep = 9;
    wallD(fin, d0, z0, z1, FORM_Y, hh, -1, 46, 1);
    wallD(stone, d0 + dep, z0, z1, FORM_Y, hh, 1, 6, 1);
    wallZ(stone, z0, d0, d0 + dep, FORM_Y, hh, -1, 2, 1);
    wallZ(stone, z1, d0, d0 + dep, FORM_Y, hh, 1, 2, 1);
    box(vc, d0 - 0.4, d0 + dep + 0.4, z0 - 0.4, z1 + 0.4, hh, hh + 0.5, col('#b7a07a'));
    // lettering on the roofline
    const lett = texB('cat-letters', () => ctex('ab-cat-letters', 1024, 64, (c, w, h) => {
      c.fillStyle = '#c4ab82'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#4a3a22'; c.font = '700 42px Georgia, "Times New Roman", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('GARE DE CHAMPAGNE-ARDENNE TGV', w / 2, h / 2 + 3);
    }, { clampU: true, clampV: true }));
    wallD(lett, d0 - 0.05, z0, z1, hh + 0.5, hh + 2.5, -1, 1, 1);
    wallD(stone, d0 + dep + 0.05, z0, z1, hh + 0.5, hh + 2.5, 1, 1, 1);
    // canopy: flat steel plate on slanting white columns
    const deck = k.deckB('cat-deck', { roughness: 0.55, metalness: 0.35 });
    k.canopy({ z0: -L * 0.3, z1: L * 0.3, d0: 2.8, d1: edge + W + 0.4, y: 4.6, rise: 0.0, deck, deckCol: col('#dcdfe1'), thick: 0.4, colD: edge + W - 0.9, colB: vc, colCol: '#e8ebed', step: 12, round: false, colW: 0.28 });
    for (let z = -L * 0.3; z <= L * 0.3 + 0.1; z += 12) vc.between([X(edge + W - 0.9), H, z], [X(edge + W - 2.1), 4.6, z], 0.26, col('#e8ebed'), 0.26);
    k.furnish(-L * 0.28, L * 0.28, edge + W - 0.6, edge + W * 0.5, 26, 32);
    // glazed footbridge across the tracks with its stair/lift towers
    const zf = -L * 0.2;
    const conc = colB('cat-conc', { roughness: 0.9, metalness: 0.02 });
    box(conc, -11, edge + W + 6, zf - 1.8, zf + 1.8, 7.4, 10.4, col('#bfc2c4'));
    box(conc, -11.2, edge + W + 6.2, zf - 1.82, zf + 1.82, 8.2, 9.6, col('#3a5668'));
    [-10, edge + W + 5].forEach((d) => box(conc, d - 0.45, d + 0.45, zf - 0.6, zf + 0.6, FORM_Y, 7.4, col('#aeb1b3')));
    box(conc, edge + W + 3.6, edge + W + 6.4, zf - 1.5, zf + 1.5, FORM_Y, 10.4, col('#bfc2c4'));
    // grass slope + low fence line is the landscape's; add the second platform and track
    k.track(-4.6, -L * 0.6, L * 0.6);
    k.track(-10.6, -L * 0.6, L * 0.6);
  }

  /* ------------------------------------------------------------------ PARIS-EST */
  /* Terminus under the great hall: closed cream-stone arcade side walls with a frosted clerestory, an opaque dark zinc roof with a glazed band along
     the crown, four parallel tracks with buffer stops; at the head the limestone end wall with the giant glazed fan window. */
  function buildParisEst(api) {
    const k = kit(api);
    const { T, X, vc, glow, texB, colB, glassB, box, wallD, wallZ, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L, helpers } = k;
    const term = api.idx === 0 ? 1 : -1;
    const zBuf = term * (L / 2 + (api.idx === 0 ? 42.5 : 28));      // where the generic buffer stop of our track stands
    const zEnd = zBuf + term * 4;
    const zOpen = zEnd - term * (L + 44);
    const zLo = Math.min(zEnd, zOpen), zHi = Math.max(zEnd, zOpen);
    const a = 14.9, spring = 10.2, rise = 8.2, segs = 18, glazed = [7, 8, 9, 10];
    const arch = [];
    for (let i = 0; i <= segs; i++) { const th = (i / segs) * Math.PI; arch.push([a * Math.cos(th), spring + rise * Math.sin(th)]); }
    // ribs: dark iron under the roof
    const steel = colB('pe-steel', { roughness: 0.5, metalness: 0.5 });
    const ribCol = col('#36444f');
    const n = Math.round((zHi - zLo) / 12);
    for (let r = 0; r <= n; r++) {
      const z = zLo + ((zHi - zLo) * r) / n;
      for (let i = 0; i < segs; i++) steel.between([X(arch[i][0]), arch[i][1] - 0.2, z], [X(arch[i + 1][0]), arch[i + 1][1] - 0.2, z], 0.45, ribCol, 0.8);
      for (let i = 3; i < segs - 2; i += 3) steel.between([X(arch[i][0]), arch[i][1] - 0.4, z], [X(arch[segs - i][0]), arch[segs - i][1] - 0.4, z], 0.07, col('#52606c'));
    }
    // opaque zinc roof (double sided) with a glazed band along the crown
    const roof = colB('pe-roof', { roughness: 0.6, metalness: 0.3, side: T.DoubleSide, emissive: new T.Color(0x3a3d40) });
    const gl = glassB();
    for (let i = 0; i < segs; i++) {
      const p = arch[i], q = arch[i + 1];
      const b = glazed.includes(i) ? gl : roof;
      b.quad([X(p[0]), p[1], zLo], [X(q[0]), q[1], zLo], [X(q[0]), q[1], zHi], [X(p[0]), p[1], zHi], [0, 1, 0], glazed.includes(i) ? WHITE : col('#4a5056'));
    }
    for (let z = zLo + 6; z < zHi; z += 18) glow.box(X(0), spring + rise - 1.0, z, 0.6, 0.12, 2.2, col('#fff2cc'));
    // closed side walls: cream arcades below, frosted clerestory above (opaque: nothing of the city shows through)
    const wallH = spring;
    const side = texB('pe-side', () => ctex('ab-pe-side', 128, 176, (c, w, h) => {
      const r = rng(41);
      c.fillStyle = '#d8cbab'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.05)'; c.fillRect(r() * w, r() * h, 3, 2); }
      c.fillStyle = 'rgba(80,70,50,0.18)'; for (let y = 0; y < h; y += 12) c.fillRect(0, y, w, 1);
      // clerestory (top 62 px): frosted glass panels between dark mullions
      const g = c.createLinearGradient(0, 8, 0, 62); g.addColorStop(0, '#d7e2e8'); g.addColorStop(1, '#aebfc9');
      c.fillStyle = g; c.fillRect(8, 8, w - 16, 54);
      c.fillStyle = '#3b4752'; for (let x = 8; x <= w - 8; x += 28) c.fillRect(x, 8, 3, 54); c.fillRect(8, 30, w - 16, 3);
      c.fillStyle = '#c6b992'; c.fillRect(0, 66, w, 6);
      // ground floor: tall round-arched opening with iron glazing
      c.fillStyle = '#c6b992';
      c.beginPath(); c.moveTo(14, h); c.lineTo(14, 120); c.arc(64, 120, 50, Math.PI, 0); c.lineTo(114, h); c.closePath(); c.fill();
      c.fillStyle = '#35414b';
      c.beginPath(); c.moveTo(22, h); c.lineTo(22, 120); c.arc(64, 120, 42, Math.PI, 0); c.lineTo(106, h); c.closePath(); c.fill();
      c.fillStyle = 'rgba(190,205,215,0.35)'; c.fillRect(22, 100, 84, 20);
      c.fillStyle = '#c6b992'; c.fillRect(62, 78, 4, h); c.fillRect(22, 130, 84, 3);
    }));
    const lenZ = zHi - zLo;
    [[-a - 0.2, 1, 1], [a + 0.2, -1, -1]].forEach(([d, f]) => {
      wallD(side, d, zLo, zHi, FORM_Y, wallH, f, lenZ / 8, 1);
      wallD(side, d + f * -0.5, zLo, zHi, FORM_Y, wallH, -f, lenZ / 8, 1);
    });
    box(vc, -a - 0.7, -a + 0.3, zLo, zHi, wallH - 0.2, wallH + 0.3, col('#c6b992'));
    box(vc, a - 0.3, a + 0.7, zLo, zHi, wallH - 0.2, wallH + 0.3, col('#c6b992'));
    // end wall with the fan window
    const wallT = texB('pe-wall', () => ctex('ab-pe-wall', 512, 416, (c, w, h) => {
      const r = rng(31); c.fillStyle = '#d8cbab'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) { const v = r() > 0.5 ? 255 : 0; c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.05)'; c.fillRect(r() * w, r() * h, 3, 2); }
      c.fillStyle = 'rgba(80,70,50,0.18)'; for (let y = 0; y < h; y += 16) c.fillRect(0, y, w, 1);
      const cx = w / 2, cy = 288, R = 244;
      c.fillStyle = '#c9b98f'; c.beginPath(); c.arc(cx, cy, R + 14, Math.PI, 0); c.fill();
      const g = c.createRadialGradient(cx, cy, 20, cx, cy, R); g.addColorStop(0, '#9fb6c6'); g.addColorStop(1, '#58738a');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, Math.PI, 0); c.closePath(); c.fill();
      c.strokeStyle = '#24313b'; c.lineWidth = 3;
      for (let i = 1; i < 14; i++) { const t = Math.PI + (i * Math.PI) / 14; c.beginPath(); c.moveTo(cx + 26 * Math.cos(t), cy + 26 * Math.sin(t)); c.lineTo(cx + R * Math.cos(t), cy + R * Math.sin(t)); c.stroke(); }
      [0.34, 0.62, 0.86].forEach((f) => { c.beginPath(); c.arc(cx, cy, R * f, Math.PI, 0); c.stroke(); });
      c.fillStyle = '#c9b98f'; c.fillRect(0, cy, w, h - cy);
      c.fillStyle = '#efe9d6'; c.beginPath(); c.arc(cx, cy - 6, 22, 0, 6.3); c.fill(); c.strokeStyle = '#222'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#2d2a26'; [70, 160, 352, 442].forEach((x) => { c.beginPath(); c.moveTo(x - 28, h); c.lineTo(x - 28, cy + 70); c.arc(x, cy + 70, 28, Math.PI, 0); c.lineTo(x + 28, h); c.closePath(); c.fill(); });
    }), { clampU: true, clampV: true });
    wallZ(wallT, zEnd, -a - 0.7, a + 0.7, FORM_Y, 27, -term, 1, 1);
    box(vc, -a - 1.2, a + 1.2, zEnd, zEnd + term * 1.4, 27, 28.4, col('#cfc2a2'));
    // platform number plates ("Voie 21 / 22") hanging from the roof, readable from the approaching train
    const voie = texB('pe-voie', () => ctex('ab-pe-voie', 256, 128, (c, w, h) => {
      c.fillStyle = '#23303a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f1f0ea'; c.font = '700 84px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('21', w * 0.27, h / 2 + 4); c.fillText('22', w * 0.73, h / 2 + 4);
      c.fillRect(w / 2 - 1.5, 10, 3, h - 20);
    }, { clampU: true, clampV: true }), { emissive: new T.Color(0x333333) });
    for (let z = zLo + 30; z < zHi - 20; z += 54) {
      [1, -1].forEach((f) => helpers.textQuad(voie, [X(edge + W * 0.5), 5.0, z + f * 0.06], 2.0, 1.0, [0, 0, f], [f * sx * sx, 0, 0], [0, 1, 0]));
      vc.box(X(edge + W * 0.5), 5.0, z, 2.1, 1.1, 0.1, col('#151c22'));
      vc.box(X(edge + W * 0.5), 6.6, z, 0.06, 2.2, 0.06, col('#151c22'));
    }
    k.furnish(-L * 0.4, L * 0.4, edge + W - 0.7, edge + W * 0.55, 22, 30);
    // four parallel tracks: the neighbours on both sides, each with a buffer stop at the head, plus narrow side platforms along the walls
    const plat = colB('pe-plat', { roughness: 0.9, metalness: 0.02 }, false);
    const buffer = (d) => {
      box(plat, d - 1.4, d + 1.4, zBuf - term * 0.3, zBuf + term * 1.1, FORM_Y, 0.2, col('#8f8b84'));
      box(vc, d - 1.2, d + 1.2, zBuf - term * 0.1, zBuf + term * 0.3, 0.55, 0.95, col('#43484d'));
      [-0.9, 0.9].forEach((o) => box(vc, d + o - 0.2, d + o + 0.2, zBuf - term * 0.3, zBuf - term * 0.1, 0.55, 0.95, col('#d12a20')));
    };
    [-4.6, -10.4, edge + W + 2.3].forEach((d) => { k.track(d, Math.min(zBuf, zOpen), Math.max(zBuf, zOpen)); buffer(d); });
    // station floor between the walls (hides the yard ground; the city road and its cars run just outside the walls)
    box(plat, -a, a, zLo, zEnd, -0.62, -0.46, col('#6f7275'));
  }

  /* ------------------------------------------------------------------ small stations */
  function buildWittlich(api) {
    const k = kit(api);
    const { X, vc, colB, box, ctex, col, WHITE, BACK, H, W, edge, L } = k;
    const d0 = BACK;
    const BR = { key: 'wittlich', base: '#c98a55', speck: 0.07, win: [0.34, 0.5], winCol: '#42586a', winCol2: '#7e96a6', frame: '#efe9d8', ground: 'rect', band: '#d3c7a8' };
    k.bldg({ d0, dep: 9.2, z0: -18, z1: 20, rows: 2, sh: 3.9, fac: BR, bayW: 4.2, roof: 'hip', roofH: 3.8, roofKey: 'wit', roofBase: '#55504c', roofOv: 0.6 });
    k.bldg({ d0, dep: 7, z0: 20, z1: 34, rows: 1, sh: 3.9, fac: Object.assign({}, BR, { key: 'wittlich1' }), bayW: 4.2, roof: 'gable', roofH: 2.4, roofKey: 'wit', roofBase: '#55504c', roofOv: 0.5, plainKey: 'wittlich' });
    const deck = k.deckB('wit-deck', { roughness: 0.8 });
    k.canopy({ z0: -30, z1: 30, d0: 3.0, d1: edge + W - 0.4, y: 3.9, rise: 0.25, deck, deckCol: col('#c3c6c8'), fascia: [0.3, '#3b4a56'], colD: edge + W - 1.0, colB: vc, colCol: '#55616a', step: 7.5, round: false });
    k.furnish(-70, 70, edge + W - 0.7, edge + W * 0.5, 28, 40);
    k.track(-4.6, -L * 0.5, L * 0.5);
  }

  function buildSchweich(api) {
    const k = kit(api);
    const { X, vc, colB, box, ctex, glassB, col, WHITE, BACK, H, W, edge, L } = k;
    const d0 = BACK;
    const WH = { key: 'schweich', base: '#ebe7dc', speck: 0.05, win: [0.3, 0.5], winCol: '#506574', winCol2: '#8aa0ae', frame: '#43484c', ground: 'rect' };
    k.bldg({ d0, dep: 6, z0: 6, z1: 22, rows: 1, sh: 3.6, fac: WH, bayW: 4, roof: 'gable', roofH: 2.8, roofKey: 'sch', roofBase: '#3c4044', roofOv: 0.5 });
    const deck = k.deckB('sch-deck', { roughness: 0.7 });
    k.canopy({ z0: -22, z1: -4, d0: 3.2, d1: edge + W - 0.6, y: 3.2, rise: 0.15, deck, deckCol: col('#e4e6e8'), fascia: [0.2, '#2f3f55'], colD: edge + W - 1.2, colB: vc, colCol: '#3f4a55', step: 6, round: false, colW: 0.14 });
    glassB().box(X(edge + W - 0.4), H + 1.1, -13, 0.04, 2.1, 17, WHITE);
    k.furnish(-24, 24, edge + W - 0.7, edge + W * 0.5, 14, 24);
    k.furnish(-24, 24, edge + 1.2, edge + 1.2, 99, 99); // a couple of lamps along the edge
  }

  function buildPontAMousson(api) {
    const k = kit(api);
    const { X, vc, colB, col, BACK, H, W, edge, L } = k;
    const d0 = BACK;
    const CRM = { key: 'pam', base: '#d9d1b9', speck: 0.06, win: [0.34, 0.58], winCol: '#4d6676', winCol2: '#8aa0ae', frame: '#f2ecd8', ground: 'arch', band: '#bdb394' };
    k.bldg({ d0, dep: 8.2, z0: -13, z1: 17, rows: 2, sh: 4.2, fac: CRM, bayW: 4, roof: 'hip', roofH: 3.2, roofKey: 'pam', roofBase: '#4a5058', roofOv: 0.6 });
    k.bldg({ d0, dep: 6.5, z0: 17, z1: 30, rows: 1, sh: 4.2, fac: Object.assign({}, CRM, { key: 'pam1' }), bayW: 4, roof: 'gable', roofH: 2.2, roofKey: 'pam', roofBase: '#4a5058', roofOv: 0.5, plainKey: 'pam' });
    const deck = k.deckB('pam-deck', { roughness: 0.8 });
    k.canopy({ z0: -16, z1: 24, d0: 3.0, d1: edge + W - 0.4, y: 3.7, rise: 0.2, deck, deckCol: col('#a9adb0'), fascia: [0.3, '#4a5760'], colD: edge + W - 1.0, colB: vc, colCol: '#59656d', step: 8, round: false });
    k.furnish(-50, 60, edge + W - 0.7, edge + W * 0.5, 28, 40);
  }

  function buildArlon(api) {
    const k = kit(api);
    const { X, vc, texB, colB, glassB, box, wallD, wallZ, frustum, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L } = k;
    const d0 = BACK;
    const OC = '#d5b97d', TRIM = '#ecdcae';
    const F = { key: 'arlon', base: OC, speck: 0.09, course: 11, win: [0.36, 0.56], winCol: '#445a68', winCol2: '#82989f', frame: TRIM, ground: 'arch', band: '#b19a63' };
    [[14, 52], [-52, -14]].forEach(([z0, z1]) => k.bldg({ d0, dep: 9, z0, z1, rows: 2, sh: 4.6, fac: F, bayW: 4.6, roof: 'hip', roofH: 3.6, roofKey: 'arl', roofBase: '#616b77', roofOv: 0.6 }));
    const cz0 = -14, cz1 = 14, cH = 13.6;
    const arch = texB('arlon-arch', () => archWallTex(k, 'arlon', { base: OC, trim: TRIM, R: 80, top: 128, bars: 3, glass: '#42596a', clock: true, lit: true }));
    const pl = texB('plain-arlon', () => ctex('ab-plain-arlon', 64, 64, (c, w, h) => { c.fillStyle = OC; c.fillRect(0, 0, w, h); }));
    wallD(arch, d0 - 0.8, cz0 + 3, cz1 - 3, FORM_Y, cH, -1, 1, 1);
    wallD(pl, d0 - 0.8, cz0, cz0 + 3, FORM_Y, cH, -1, 2, 1);
    wallD(pl, d0 - 0.8, cz1 - 3, cz1, FORM_Y, cH, -1, 2, 1);
    wallD(pl, d0 + 10, cz0, cz1, FORM_Y, cH, 1, 4, 1);
    wallZ(pl, cz0, d0 - 0.8, d0 + 10, FORM_Y, cH, -1, 3, 1);
    wallZ(pl, cz1, d0 - 0.8, d0 + 10, FORM_Y, cH, 1, 3, 1);
    vc.box(X(d0 + 4.6), cH + 0.2, 0, 11.8, 0.4, cz1 - cz0 + 1, col(TRIM));
    const roof = texB('roof-arl', () => slateTex(k, 'arl', '#616b77'));
    k.gableD(roof, pl, d0 - 0.8, d0 + 10, cz0, cz1, cH, cH + 4.8, 0.5, WHITE, WHITE);
    // the twin domes beside the gable and the little spire above the clock
    [[cz0 + 3.2], [cz1 - 3.2]].forEach(([z]) => {
      frustum(roof, d0 - 1.4, d0 + 3.6, z - 2.5, z + 2.5, cH - 0.6, cH + 3.2, 0.5, 0.5, WHITE);
      frustum(roof, d0 - 0.9, d0 + 3.1, z - 2.0, z + 2.0, cH + 3.2, cH + 5.0, 1.6, 1.6, WHITE);
    });
    frustum(roof, d0 - 0.4, d0 + 1.0, -0.7, 0.7, cH + 4.6, cH + 8.4, 0.65, 0.65, WHITE);
    // brick platform + glass-and-iron canopy on blue columns
    k.paving('arlon-brick', () => ctex('ab-arlon-brick', 128, 128, (c, w, h) => {
      const r = rng(5); c.fillStyle = '#9d6b60'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < w + 16; x += 32) { const v = Math.floor(r() * 22 - 11); c.fillStyle = 'rgb(' + (170 + v) + ',' + (118 + v) + ',' + (108 + v) + ')'; c.fillRect(x + 1, y + 1, 30, 14); }
    }), edge + 0.8, edge + W, -L / 2, L / 2, 5);
    const blue = '#1b3f8a';
    const deck = k.deckB('arlon-deck', { roughness: 0.6, metalness: 0.2 });
    const len = L * 0.5;
    k.canopy({ z0: -len / 2, z1: len / 2, d0: 3.0, d1: edge + W - 0.2, y: 4.6, rise: 0.5, deck, deckCol: col('#e2e4e6'), thick: 0.14, fascia: [0.5, blue], colD: edge + W - 1.0, colB: vc, colCol: blue, step: 6, round: true, colW: 0.1 });
    glassB().box(X((3.0 + edge + W - 0.2) / 2), 4.95, 0, edge + W - 3.2, 0.06, len, WHITE, 0, 0, sx * 0.07);
    for (let z = -len / 2; z <= len / 2 + 0.1; z += 6) vc.between([X(edge + W - 1.0), 3.8, z], [X(edge + W - 2.4), 4.6, z], 0.1, col(blue), 0.1);
    k.furnish(-len / 2, len / 2, edge + W - 0.7, edge + W * 0.5, 22, 28);
    k.track(-4.6, -L * 0.5, L * 0.5);
  }

  function buildLibramont(api) {
    const k = kit(api);
    const { X, vc, colB, glassB, box, ctex, col, WHITE, BACK, FORM_Y, sx, H, W, edge, L } = k;
    const d0 = BACK;
    const CRM = { key: 'libramont', base: '#e9e2cc', speck: 0.05, win: [0.3, 0.6], winCol: '#4e6574', winCol2: '#8aa0ae', frame: '#f7f2e2', ground: 'arch', band: '#c9bf9d' };
    k.bldg({ d0, dep: 7.2, z0: -38, z1: 30, rows: 1, sh: 6.4, fac: CRM, bayW: 4.4, roof: 'flat', capCol: '#a9aeb2' });
    k.bldg({ d0: d0 + 0.5, dep: 6.2, z0: -10, z1: 8, y0: 6.4, rows: 1, sh: 3.0, fac: Object.assign({}, CRM, { key: 'libramont-u', ground: 'rect' }), bayW: 4.4, roof: 'gable', roofH: 2.4, roofKey: 'lib', roofBase: '#59616a', roofOv: 0.5, plainKey: 'libramont' });
    k.paving('lib-brick', () => ctex('ab-lib-brick', 128, 128, (c, w, h) => {
      const r = rng(6); c.fillStyle = '#b87a62'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < w + 16; x += 32) { const v = Math.floor(r() * 24 - 12); c.fillStyle = 'rgb(' + (184 + v) + ',' + (118 + v) + ',' + (98 + v) + ')'; c.fillRect(x, y, 30, 14); }
    }), edge + 0.8, edge + W, -L / 2, L / 2, 5);
    // timber-and-glass canopy
    const wood = '#c4813f';
    const deck = k.deckB('lib-deck', { roughness: 0.7, metalness: 0.05 });
    k.canopy({ z0: -45, z1: 36, d0: 3.0, d1: edge + W - 0.2, y: 4.5, rise: 0.8, deck, deckCol: col('#f0efe9'), thick: 0.06, fascia: [0.45, wood], colD: edge + W - 1.0, colB: vc, colCol: wood, step: 4.5, round: false, colW: 0.24, lights: false });
    glassB().box(X((3.0 + edge + W - 0.2) / 2), 4.9, -4.5, edge + W - 3.2, 0.06, 81, WHITE, 0, 0, sx * 0.11);
    for (let z = -45; z <= 36.1; z += 4.5) vc.between([X(edge + W - 1.0), 4.0, z], [X(3.0), 4.9, z], 0.12, col(wood), 0.18);
    k.furnish(-40, 34, edge + W - 0.7, edge + W * 0.5, 22, 28);
    k.track(-4.6, -L * 0.5, L * 0.5);
  }

  function helpers_bench(api, x, y, z) {
    api.helpers.addBench(api.sets.get('vc', api.M.vc, true), x, y, z);
  }

  const NO = { canopy: false, furniture: false };
  /* build wrapper: optional debug numbers (window.__abDebug) for the report: triangles / batches of the whole station group, build time */
  function reg(name, fn) {
    RS.register(name, {
      canopy: false,
      furniture: false,
      build(api) {
        const t0 = performance.now();
        fn(api);
        if (window.__abDebug) {
          let tri = 0, nb = 0;
          api.sets.map.forEach((e) => { tri += e.batch.idx.length / 3; nb++; });
          console.log('[ab] ' + name + ' tris=' + Math.round(tri) + ' batches=' + nb + ' ms=' + (performance.now() - t0).toFixed(1));
        }
      },
    });
  }
  reg('Metz-Ville', buildMetz);
  reg('Tréier Hbf', buildTrier);
  reg('Koblenz Hbf', buildKoblenz);
  reg('Thionville', buildThionville);
  reg('Cochem', buildCochem);
  reg('Nancy-Ville', buildNancy);
  reg('Namur', buildNamur);
  reg('Bruxelles-Midi', buildMidi);
  reg('Champagne-Ardenne TGV', buildChampagne);
  reg('Paris-Est', buildParisEst);
  reg('Wittlich', buildWittlich);
  reg('Schweich', buildSchweich);
  reg('Pont-à-Mousson', buildPontAMousson);
  reg('Arlon', buildArlon);
  reg('Libramont', buildLibramont);
})();
