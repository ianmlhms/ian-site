/* Zuchsimulator Lëtzebuerg: platform slab, kerb and paving of Munsbach (photo-modelled, Commons: Schuttrange gare CFL Munsbach (102)/(105), Munsbach railway
 * station, Mënsbechgare12/14).  Real: a low platform of grey-brown concrete kerb units (about 2.2 m long, each with a rectangular recess), a light concrete
 * edge cap, brown-grey pavers laid in running bond and a thin worn yellow safety line a metre from the edge.
 *   TS.munsbachPlatform.build(api, kit, { lEdge, w, dir, z0, z1 })
 * api = the real-station api of infra.js, kit = makeKit(api) of stations-lu-b.js.  Local frame as there (l lateral, dir = +1 towards the platform side). */
(function () {
  'use strict';
  window.TS = window.TS || {};

  const KERB_UNIT = 2.2;             // m of platform edge per kerb unit
  const KERB_TEX_H = 0.9;            // m of kerb face covered by one texture (a unit is a bit lower than that; the rest is the ballast side)
  const CAP_W = 0.3;                 // light concrete edge cap
  const PAVE_TILE = 3.2;             // m covered by the paver texture (both directions)
  const YELLOW_AT = 0.85;            // yellow safety line: distance of its centre from the edge cap
  const BACK_STEP = 0.06;            // the paving lies this far above the cap's lower edge

  const mulb = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const rgb = (r, g, b, a) => 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + (a === undefined ? 1 : a) + ')';

  /* kerb unit seen from the track: 2.2 m x 0.9 m at 128 px per metre.  v = 1 is the top of the unit. */
  function kerbSpec() {
    const w = Math.round(KERB_UNIT * 128), h = Math.round(KERB_TEX_H * 128);
    return { w, h, draw: (c) => {
      const r = mulb(7);
      c.fillStyle = '#b3aea3'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1500; i++) { const v = 150 + r() * 70; c.fillStyle = rgb(v, v - 3, v - 8, 0.12 + r() * 0.12); c.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
      // the unit: a raised frame (lighter) around a recessed panel (darker, shadow on its upper / left edge, light on its lower / right edge)
      const fx = 12, fyTop = 9, fyBot = 14;
      const px = fx, py = fyTop + 6, pw = w - fx * 2, ph = h - fyTop - fyBot - 20;
      c.fillStyle = 'rgba(210,205,192,0.22)'; c.fillRect(0, 0, w, fyTop); c.fillRect(0, 0, 5, h); c.fillRect(w - 5, 0, 5, h);
      c.fillStyle = '#8f8b82'; c.fillRect(px, py, pw, ph);
      c.fillStyle = 'rgba(30,28,24,0.55)'; c.fillRect(px, py, pw, 7); c.fillRect(px, py, 6, ph);
      c.fillStyle = 'rgba(235,230,215,0.35)'; c.fillRect(px, py + ph - 3, pw, 3); c.fillRect(px + pw - 3, py, 3, ph);
      for (let i = 0; i < 500; i++) { const v = 100 + r() * 40; c.fillStyle = rgb(v, v - 2, v - 6, 0.18); c.fillRect(px + r() * pw, py + r() * ph, 1 + r() * 3, 1 + r() * 2); }
      // joint between units, ballast stains at the bottom, a few dark streaks
      c.fillStyle = 'rgba(25,24,22,0.6)'; c.fillRect(0, 0, 2, h);
      const g = c.createLinearGradient(0, h * 0.7, 0, h); g.addColorStop(0, 'rgba(40,36,30,0)'); g.addColorStop(1, 'rgba(40,36,30,0.5)'); c.fillStyle = g; c.fillRect(0, h * 0.7, w, h * 0.3);
      for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(40,36,30,' + (0.06 + r() * 0.08) + ')'; c.fillRect(r() * w, 0, 2 + r() * 5, h * (0.3 + r() * 0.6)); }
    } };
  }
  /* top of the platform: pavers 0.2 x 0.1 m in running bond, brown-grey, with a thin worn yellow line.  u across (0 = inner edge of the cap), v along the platform */
  function paveSpec() {
    const px = 80, size = Math.round(PAVE_TILE * px);       // 80 px per metre
    return { w: size, h: size, draw: (c) => {
      const r = mulb(11);
      c.fillStyle = '#6a655e'; c.fillRect(0, 0, size, size);                    // joints
      const bw = Math.round(0.2 * px), bh = Math.round(0.1 * px);
      for (let y = 0, row = 0; y < size; y += bh, row++) {
        for (let x = -((row % 2) * bw) / 2; x < size; x += bw) {
          const t = r(); const v = 128 + t * 40;
          c.fillStyle = rgb(v - 2 + (r() < 0.2 ? 14 : 0), v - 3, v - 7, 1);
          c.fillRect(x + 1, y + 1, bw - 2, bh - 2);
        }
      }
      // large slab patches (repairs): lighter grey concrete rectangles
      for (let i = 0; i < 5; i++) { const sx2 = r() * size, sy2 = r() * size; c.fillStyle = 'rgba(150,148,142,0.55)'; c.fillRect(sx2, sy2, 0.8 * px + r() * px, 0.6 * px + r() * px); c.strokeStyle = 'rgba(60,58,54,0.5)'; c.strokeRect(sx2, sy2, 0.8 * px, 0.6 * px); }
      // worn yellow safety line
      const yx = YELLOW_AT * px, yw = 0.07 * px;
      for (let y = 0; y < size; y += 3) { c.fillStyle = 'rgba(216,184,46,' + (0.55 + r() * 0.4) + ')'; c.fillRect(yx - yw / 2, y, yw, 3); }
      // dirt
      for (let i = 0; i < 1400; i++) { const v = r() < 0.5 ? 30 : 200; c.fillStyle = rgb(v, v, v - 6, 0.05 + r() * 0.07); c.fillRect(r() * size, r() * size, 1 + r() * 3, 1 + r() * 3); }
    } };
  }
  /* edge cap: light concrete, a faint joint every unit */
  function capSpec() {
    const w = 64, h = Math.round(KERB_UNIT * 32);
    return { w, h, draw: (c) => {
      const r = mulb(3);
      c.fillStyle = '#bdbab1'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { const v = 150 + r() * 60; c.fillStyle = rgb(v, v, v - 4, 0.15); c.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
      c.fillStyle = 'rgba(70,66,60,0.45)'; c.fillRect(0, 0, w, 1.5);
      c.fillStyle = 'rgba(245,243,235,0.35)'; c.fillRect(0, 0, 6, h);
    } };
  }

  /* o = { lEdge, w, dir, z0, z1, withBack } */
  function build(api, kit, o) {
    const { sets, col, WHITE, FORM_Y, H } = api;
    const { X, vc, tex, quadO } = kit;
    const z0 = o.z0, z1 = o.z1, len = z1 - z0, zm = (z0 + z1) / 2, dir = o.dir;
    const lA = o.lEdge, lB = o.lEdge + dir * o.w;
    const lm = (lA + lB) / 2;
    // slab body (hidden under the top, closes the back)
    vc.box(X(lm), (H + FORM_Y) / 2 - 0.01, zm, o.w, H - FORM_Y - 0.02, len, col('#8a867e'));
    const kerb = tex('munkerb', kerbSpec(), true);
    const cap = tex('muncap', capSpec(), true);
    const pave = tex('munpave', paveSpec(), false);
    const inside = [X(lm), (H + FORM_Y) / 2, zm];   // inside the slab: quadO turns every face away from it (the kerb towards the track, the top upwards)
    const yK0 = H - KERB_TEX_H + 0.06, yK1 = H - 0.015;
    // kerb face towards the track: u runs along z (one unit per KERB_UNIT), v 0 (bottom) .. 1 (top)
    const lK = lA - dir * 0.015;     // a hair in front of the slab body (no z-fight)
    quadO(kerb, [X(lK), yK0, z0], [X(lK), yK0, z1], [X(lK), yK1, z1], [X(lK), yK1, z0], inside, WHITE, [[0, 0], [len / KERB_UNIT, 0], [len / KERB_UNIT, (yK1 - yK0) / KERB_TEX_H], [0, (yK1 - yK0) / KERB_TEX_H]]);
    // below the unit: ballast-side concrete down to the formation
    vc.box(X(lA + dir * 0.02), (yK0 + FORM_Y) / 2, zm, 0.04, yK0 - FORM_Y, len, col('#76726a'));
    // cap (the light edge strip) and the paving
    quadO(cap, [X(lA), H + 0.004, z0], [X(lA + dir * CAP_W), H + 0.004, z0], [X(lA + dir * CAP_W), H + 0.004, z1], [X(lA), H + 0.004, z1], inside, WHITE,
      [[0, 0], [1, 0], [1, len / KERB_UNIT], [0, len / KERB_UNIT]]);
    const wv = o.w - CAP_W;
    quadO(pave, [X(lA + dir * CAP_W), H + 0.002, z0], [X(lB), H + 0.002, z0], [X(lB), H + 0.002, z1], [X(lA + dir * CAP_W), H + 0.002, z1], inside, WHITE,
      [[0, z0 / PAVE_TILE], [wv / PAVE_TILE, z0 / PAVE_TILE], [wv / PAVE_TILE, z1 / PAVE_TILE], [0, z1 / PAVE_TILE]]);
    void BACK_STEP;
  }

  window.TS.munsbachPlatform = Object.freeze({ build, KERB_UNIT });
})();
