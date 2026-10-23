/* Schueberfouer Tycoon, "Looks" wave: the white festival hall tent (NPC halls, restaurant stand-ins, the XL tent rows).
 * What the photos show (site-fair-from-ferris-wheel-2025-*, generic-beer-tent): an aluminium portal frame every ~4.5 m (posts at the eaves, a truss in the gable end), PVC roof panels
 * that sag a little between the frames and are sewn along them, a ridge cap and gutters, a scalloped valance along the eaves, a raised lettered panel over the gable-end door,
 * sides that are either closed (white panels with clear window strips) or open (benches, long tables, string lights, a bar), a few with coloured stripe panels or a porch.
 * The whites are HDR on the `fabric` channel (brightest thing on the field by day, a warm glow by night).  A hall tent draws itself centred at the origin, gable end = +z, ridge along z. */

const AWN = [0xc8283a, 0x2d6fd0, 0x2f9a58, 0xf08a2a, 0x1f5fb8, 0x7a47c8, 0x25a6a6, 0xb8284a];
const HALL_WORDS = ['Restaurant', 'Brasserie', 'Bierhaus', 'Crêperie', 'Café', 'Fëschstuff', 'Weinstuff', 'Grill', 'Bierstuff', 'Friture', 'Fouerfësch', 'Eisekuch', 'Zelt', 'Kachelstuff'];
const CANVAS = { roof: [1.75, 1.74, 1.68], roofB: [1.62, 1.62, 1.6], wall: [1.45, 1.45, 1.4], end: [1.55, 1.55, 1.5], back: [1.3, 1.3, 1.27] };
const ALU = 0xc9ced4, ALU_D = 0x8f979e, WOOD = 0x8a6a46, WOOD_D = 0x5a4228, GLASS = 0xffd890, DOORWAY = 0x8a5a30, WARM = 0xffd890;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

/** a triangle whose normal is made to face `hint` (local coordinates) */
function facet(b, p, q, s, color, hint, ch = 'fabric') {
  const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]; const v = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) b.tri(p, s, q, color, { ch }); else b.tri(p, q, s, color, { ch });
}
const quadF = (b, a, c, d, e, color, hint, ch) => { facet(b, a, c, d, color, hint, ch); facet(b, a, d, e, color, hint, ch); };

/** one sagging roof panel: eave edge (x0, y0) .. ridge edge (x1, y1), between z0 and z1; four triangles round a centre that hangs `sag` below the flat panel */
function roofPanel(b, x0, y0, x1, y1, z0, z1, sag, color, hint) {
  const E0 = [x0, y0, z0], E1 = [x0, y0, z1], R0 = [x1, y1, z0], R1 = [x1, y1, z1];
  const M = [(x0 + x1) / 2, (y0 + y1) / 2 - sag, (z0 + z1) / 2];
  facet(b, E0, E1, M, color, hint); facet(b, E1, R1, M, color, hint); facet(b, R1, R0, M, color, hint); facet(b, R0, E0, M, color, hint);
}

/** scalloped fringe hanging from the line (x, y, z0..z1): each scallop is a flat pentagon facing +side; 3 triangles */
function fringe(b, x, y, z0, z1, n, h, c1, c2, side) {
  const dz = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const a = z0 + i * dz; const m = a + dz / 2; const e = a + dz; const cc = i & 1 ? c2 : c1;
    const P = [[x, y, a], [x, y, e], [x, y - h * 0.62, e - dz * 0.06], [x, y - h, m], [x, y - h * 0.62, a + dz * 0.06]];
    const hint = [side, 0, 0];
    facet(b, P[0], P[1], P[2], cc, hint); facet(b, P[0], P[2], P[4], cc, hint); facet(b, P[4], P[2], P[3], cc, hint);
  }
}

/**
 * b: Builder, r: rng, w x d footprint (w across, d along the ridge).  o: { names, stripes, open: [left, right] (override), porch }
 * Triangles (near): ~250 for a small tent, ~500 for 12 x 14 m, ~800 for a 29 x 17 m hall.  `b.far` drops the interior, fringe and lattice (~90).
 */
export function hallTent(b, r, w, d, o = {}) {
  const far = b.far; const hw = w / 2; const hd = d / 2;
  const accent = o.accent !== undefined ? o.accent : pick(r, AWN);
  const H = w > 12 ? 3.2 : 2.7; const rise = Math.min(3.6, Math.max(1.6, w * 0.26)); const ov = 0.32;
  const bays = Math.max(1, Math.round(d / 4.6)); const bz = d / bays;
  const stripes = o.stripes !== undefined ? o.stripes : r() < 0.08; const stripeCol = pick(r, [0xd9c0c0, 0xbccbdb, 0xcfdabd, 0xe2d5ae]);
  const open = o.open || (far || w < 6.5 ? [false, false] : [r() < 0.5, r() < 0.5]);
  const porch = o.porch !== undefined ? o.porch : !far && w >= 8 && r() < 0.35;
  const wallC = CANVAS.wall; const roofC = CANVAS.roof;
  const zf = hd;                              // the gable end plane
  const zs = []; for (let i = 0; i <= bays; i++) zs.push(-hd + i * bz);

  // ---- floor: boards under the open halves
  if (!far && (open[0] || open[1])) b.quad([-hw + 0.1, 0.09, zf - 0.1], [hw - 0.1, 0.09, zf - 0.1], [hw - 0.1, 0.09, -hd + 0.1], [-hw + 0.1, 0.09, -hd + 0.1], WOOD);

  // ---- side walls: posts + closed panels (white, clear window strip) or open (knee wall, benches inside)
  for (const [si, s] of [[0, -1], [1, 1]]) {
    const x = s * hw; const out = [s, 0, 0];
    for (let i = 0; i <= bays; i++) b.box(x, 0, zs[i], 0.16, H, 0.16, ALU, { noTop: true, noBottom: true });
    for (let i = 0; i < bays; i++) {
      const za = zs[i] + 0.08; const zb = zs[i + 1] - 0.08;
      if (!open[si]) {
        // closed bay: white panel above and below a clear window strip that glows at night
        const wa = [x, 0.1, za]; const wb = [x, 0.1, zb];
        quadF(b, [x, 0.1, za], [x, 0.1, zb], [x, 1.0, zb], [x, 1.0, za], wallC, out);
        quadF(b, [x, 1.0, za], [x, 1.0, zb], [x, 2.0, zb], [x, 2.0, za], wallC, out);
        if (!far) { b.quad(...(s > 0 ? [[x + 0.01, 1.05, zb - 0.1], [x + 0.01, 1.05, za + 0.1], [x + 0.01, 1.95, za + 0.1], [x + 0.01, 1.95, zb - 0.1]] : [[x - 0.01, 1.05, za + 0.1], [x - 0.01, 1.05, zb - 0.1], [x - 0.01, 1.95, zb - 0.1], [x - 0.01, 1.95, za + 0.1]]), GLASS, { ch: 'lamp' }); }
        quadF(b, [x, 2.0, za], [x, 2.0, zb], [x, H, zb], [x, H, za], wallC, out);
        void wa; void wb;
      } else {
        // open bay: a knee-high panel (coloured stripe on some), the rest is open to the benches inside
        quadF(b, [x, 0.1, za], [x, 0.1, zb], [x, 0.9, zb], [x, 0.9, za], stripes ? stripeCol : wallC, out);
        if (!far) { b.box(x, 0.9, (za + zb) / 2, 0.1, 0.05, zb - za, ALU_D); }
      }
    }
    // eave beam + valance
    b.box(s * (hw + ov), H - 0.2, 0, 0.14, 0.14, d + ov * 2, ALU_D);
    if (!far) fringe(b, s * (hw + ov + 0.02), H - 0.18, -hd - ov, hd + ov, Math.max(4, Math.round(d / 0.75)), 0.55, accent, 0xf4f1e8, s);
    else b.box(s * (hw + ov), H - 0.55, 0, 0.04, 0.5, d + ov * 2, accent);
  }

  // ---- roof: sagging PVC panels per bay, sewn along the frames; ridge cap
  for (const s of [-1, 1]) {
    for (let i = 0; i < bays; i++) {
      const c = stripes && (i & 1) ? stripeCol : (i & 1) ? CANVAS.roofB : roofC;
      const za = i === 0 ? -hd - ov : zs[i]; const zb = i === bays - 1 ? hd + ov : zs[i + 1];
      roofPanel(b, s * (hw + ov), H - 0.12, 0, H + rise, za, zb, Math.min(0.16, bz * 0.03), c, [s * rise, hw, 0]);
    }
    for (let i = 0; i <= bays; i++) {                                    // the seams over the frames
      const z = Math.max(-hd - ov + 0.1, Math.min(hd + ov - 0.1, zs[i]));
      b.quad(...(s > 0
        ? [[hw + ov, H - 0.08, z + 0.09], [hw + ov, H - 0.08, z - 0.09], [0, H + rise + 0.05, z - 0.09], [0, H + rise + 0.05, z + 0.09]]
        : [[-hw - ov, H - 0.08, z - 0.09], [-hw - ov, H - 0.08, z + 0.09], [0, H + rise + 0.05, z + 0.09], [0, H + rise + 0.05, z - 0.09]]), 0xdfe3e6);
    }
  }
  b.box(0, H + rise - 0.06, 0, 0.34, 0.16, d + ov * 2 + 0.1, ALU_D, { noBottom: true });
  // the gable ends of the roof (under the overhang): white triangles
  for (const z of [-hd, hd]) b.tri(...(z > 0 ? [[-hw, H, z], [hw, H, z], [0, H + rise, z]] : [[hw, H, z], [-hw, H, z], [0, H + rise, z]]), CANVAS.end, { ch: 'fabric' });

  // ---- gable end (front, +z): white wall, door with a glimpse of the lit inside, truss, raised lettered panel, string lights
  const dw = Math.min(3.6, w * 0.42); const dh = 2.4;
  quadF(b, [-hw, 0.1, zf], [-dw / 2, 0.1, zf], [-dw / 2, H, zf], [-hw, H, zf], CANVAS.end, [0, 0, 1]);
  quadF(b, [dw / 2, 0.1, zf], [hw, 0.1, zf], [hw, H, zf], [dw / 2, H, zf], CANVAS.end, [0, 0, 1]);
  quadF(b, [-dw / 2, dh, zf], [dw / 2, dh, zf], [dw / 2, H, zf], [-dw / 2, H, zf], CANVAS.end, [0, 0, 1]);
  b.quad([-dw / 2, 0.1, zf - 0.6], [dw / 2, 0.1, zf - 0.6], [dw / 2, dh, zf - 0.6], [-dw / 2, dh, zf - 0.6], DOORWAY, { ch: 'lamp' });       // the lit inside
  b.box(-dw / 2 - 0.08, 0.1, zf + 0.02, 0.16, dh, 0.16, ALU, { noBottom: true }); b.box(dw / 2 + 0.08, 0.1, zf + 0.02, 0.16, dh, 0.16, ALU, { noBottom: true }); b.box(0, dh, zf + 0.02, dw + 0.3, 0.16, 0.16, ALU);
  if (!far) {
    // truss of the gable end: chords on the rafters, tie beam, king post, struts
    const t = 0.15;
    b.beam([-hw, H, zf + 0.06], [0, H + rise, zf + 0.06], t, ALU); b.beam([hw, H, zf + 0.06], [0, H + rise, zf + 0.06], t, ALU);
    b.beam([-hw, H - 0.02, zf + 0.06], [hw, H - 0.02, zf + 0.06], t, ALU); b.beam([0, H, zf + 0.06], [0, H + rise, zf + 0.06], t * 0.8, ALU);
    b.beam([-hw * 0.5, H, zf + 0.06], [0, H + rise * 0.55, zf + 0.06], t * 0.7, ALU); b.beam([hw * 0.5, H, zf + 0.06], [0, H + rise * 0.55, zf + 0.06], t * 0.7, ALU);
    // raised, lettered gable panel on a frame
    const sw = Math.min(w * 0.72, 8.2); const sh = Math.min(1.5, rise * 0.5); const sy = H + Math.min(rise * 0.42, sh / 2 + 0.55);
    b.box(0, sy - sh / 2 - 0.12, zf + 0.12, sw + 0.4, sh + 0.24, 0.12, accent);
    b.sign(pick(r, o.names || HALL_WORDS), 0, sy, zf + 0.2, sw, sh, { look: r() < 0.3 ? 2 : 0, kind: 'main', lit: true, frame: false, back: false });
    b.bulbRow([-sw / 2 - 0.15, sy - sh / 2 - 0.16, zf + 0.22], [sw / 2 + 0.15, sy - sh / 2 - 0.16, zf + 0.22], 0.45, WARM, 0.13);
    b.bulbRow([-sw / 2 - 0.15, sy + sh / 2 + 0.16, zf + 0.22], [sw / 2 + 0.15, sy + sh / 2 + 0.16, zf + 0.22], 0.45, WARM, 0.13);
    b.bulbRow([-hw, H + 0.12, zf + 0.2], [0, H + rise + 0.1, zf + 0.2], 0.8, WARM, 0.13); b.bulbRow([hw, H + 0.12, zf + 0.2], [0, H + rise + 0.1, zf + 0.2], 0.8, WARM, 0.13);
    // two banners beside the door
    for (const s of [-1, 1]) { const bx = s * (dw / 2 + (hw - dw / 2) * 0.5); if (hw - dw / 2 > 1.4) b.box(bx, 0.8, zf + 0.05, 0.9, 1.7, 0.04, s < 0 ? accent : 0xf4f1e8); }
    // side windows' string lights: a garland under each eave
    for (const s of [-1, 1]) b.bulbRow([s * (hw - 0.1), H - 0.45, -hd + 0.4], [s * (hw - 0.1), H - 0.45, hd - 0.4], 0.9, WARM, 0.12);
    // the inside seen through the open sides and the door: long tables and benches, a bar at the back, a garland under the ridge
    if (open[0] || open[1] || w > 8) {
      const rows = Math.max(1, Math.floor((w - 2.4) / 3.0)); const len = d - 3.4;
      for (let k = 0; k < rows; k++) {
        const tx = rows === 1 ? 0 : (k - (rows - 1) / 2) * 3.0;
        b.box(tx, 0.74, 0, 0.8, 0.07, len, WOOD, { noBottom: true }); b.box(tx, 0.1, 0, 0.1, 0.64, len - 0.2, WOOD_D, { noTop: true });
        b.box(tx - 0.62, 0.42, 0, 0.28, 0.05, len, WOOD_D, { noBottom: true }); b.box(tx + 0.62, 0.42, 0, 0.28, 0.05, len, WOOD_D, { noBottom: true });
        if (k % 2 === 0) for (let q = 0; q < 3; q++) b.box(tx, 0.81, -len / 2 + (q + 0.5) * len / 3, 0.5, 0.05, 0.5, k & 2 ? accent : 0xf4f1e8);
      }
      b.box(0, 0.1, -hd + 1.0, Math.min(w - 2, 6), 1.05, 0.7, WOOD_D); b.box(0, 1.15, -hd + 1.0, Math.min(w - 1.8, 6.2), 0.06, 0.9, 0xd8d2c4);
      b.bulbRow([0, H + rise - 0.5, -hd + 0.4], [0, H + rise - 0.5, hd - 0.4], 0.8, WARM, 0.14);
    }
    // a porch over the door on some tents
    if (porch) {
      const pw = dw + 2.4; const pd = 1.9;
      for (const s of [-1, 1]) b.box(s * pw / 2, 0, zf + pd, 0.14, 2.6, 0.14, ALU, { noTop: true, noBottom: true });
      quadF(b, [-pw / 2 - 0.2, 2.9, zf + pd + 0.2], [pw / 2 + 0.2, 2.9, zf + pd + 0.2], [pw / 2 + 0.2, 3.3, zf], [-pw / 2 - 0.2, 3.3, zf], CANVAS.roof, [0, 1, 0.4]);
      fringe(b, 0, 2.9, -pw / 2 - 0.2, pw / 2 + 0.2, Math.max(4, Math.round(pw / 0.7)), 0.4, accent, 0xf4f1e8, 0);
      b.bulbRow([-pw / 2, 2.55, zf + pd], [pw / 2, 2.55, zf + pd], 0.5, WARM, 0.12);
    }
    // a pennant string along the front eave
    b.pennants([-hw, H + 0.35, zf + 0.35], [hw, H + 0.35, zf + 0.35], Math.max(5, Math.round(w)), [accent, 0xf4f1e8, pick(r, AWN)], 0.3, { noWire: true });
  } else {
    const sw = Math.min(w * 0.7, 6); b.box(0, H + 0.25, zf + 0.06, sw, 0.9, 0.08, accent);
    b.bulbRow([-hw, H + 0.1, zf + 0.2], [hw, H + 0.1, zf + 0.2], 1.4, WARM, 0.14);
  }
  if (!far) {
    // a coloured skirt along the foot of the front, vertical battens on the white wall
    for (const sgn of [-1, 1]) { const x0 = sgn * (dw / 2 + 0.1); const x1 = sgn * (hw - 0.02); if (Math.abs(x1 - x0) > 0.5) b.quad([Math.min(x0, x1), 0.1, zf + 0.012], [Math.max(x0, x1), 0.1, zf + 0.012], [Math.max(x0, x1), 0.55, zf + 0.012], [Math.min(x0, x1), 0.55, zf + 0.012], accent); }
    const nb = Math.max(0, Math.floor((hw - dw / 2) / 1.6));
    for (let k = 1; k <= nb; k++) for (const sgn of [-1, 1]) { const x = sgn * (dw / 2 + k * (hw - dw / 2) / (nb + 1)); b.quad([x - 0.05, 0.55, zf + 0.014], [x + 0.05, 0.55, zf + 0.014], [x + 0.05, H - 0.05, zf + 0.014], [x - 0.05, H - 0.05, zf + 0.014], 0xdfe3e6); }
  }
  // back wall
  quadF(b, [hw, 0.1, -hd], [-hw, 0.1, -hd], [-hw, H, -hd], [hw, H, -hd], CANVAS.back, [0, 0, -1]);
}

