/* Station look (26 Nov 2026; Ian: "more beautiful the stations"): the painted dressing of every lift station on top of the type models of
 * lift-site.js (pure: no THREE, no DOM). lift-site.js calls dressEnd() for each end once its own parts are laid out; everything added
 * here is drawn only (never solid: the colliders, boarding zones, gates, belts, exits and carrier lanes stay exactly as lift-site.js
 * lays them out), stays inside the end's footprint and touches a standing part (nothing floats). The part LIST never depends on the
 * heights (lift-site.js repeats a resort's cuts on later worlds by part index): heights only move parts. Small things are flagged
 * `near` (lifts.js draws them only within ~250 m); panes and lamps glow warm in the evening (`glow`, lifts.js / station-mesh.js).
 *   chair    fascia boards round the canopy, lamps under it, a lamp over the name sign, snow on the drive house, the operator's hut
 *            with a stone plinth, framed windows, a door and its lamp
 *   gondola  a glazed gable front (mullions), a lit window in the back gable, the sign lamp
 *   cable    the machine building: plinth, window bands, a door; the dock: a glazed clerestory on the return side, glass over the front
 *   train    a glazed clerestory on the return side, a fascia with the lift's name, lamps over the platform, the platform's white edge
 *   drag     the hut: plinth, framed window, a door and its lamp, a window towards the line */

const NEAR = Object.freeze({ near: true });
const FRAME = 0.07;                            // m: window frames / mullions
const DOOR = 0x4a2f1e, TRIM = 0xe9e6df, STONE = 0x8a8178;

/** A box standing out of one face of `box` ('+a' | '-a' | '+b' | '-b'): d0..d1 m out of the face, u0..u1 along it, y0..y1. */
function onFace(c, box, face, d0, d1, u0, u1, y0, y1, col, extra = {}) {
  if (face === '+b') c.det(u0, u1, box.b1 + d0, box.b1 + d1, y0, y1, col, extra);
  else if (face === '-b') c.det(u0, u1, box.b0 - d1, box.b0 - d0, y0, y1, col, extra);
  else if (face === '+a') c.det(box.a1 + d0, box.a1 + d1, u0, u1, y0, y1, col, extra);
  else c.det(box.a0 - d1, box.a0 - d0, u0, u1, y0, y1, col, extra);
}

/** A window on a face: the pane (lit in the evening; pane = false: the type model has its own), the frame, a sill and mullions. */
function windowOn(c, box, face, u0, u1, y0, y1, { pane = true, glow = 0.9, mullions = 1, col = TRIM } = {}) {
  if (pane) onFace(c, box, face, 0, 0.035, u0, u1, y0, y1, c.COL.glass, { glow });
  onFace(c, box, face, 0, 0.07, u0 - FRAME, u1 + FRAME, y1, y1 + FRAME, col, NEAR);
  onFace(c, box, face, 0, 0.13, u0 - FRAME - 0.04, u1 + FRAME + 0.04, y0 - FRAME, y0, col, NEAR);
  onFace(c, box, face, 0, 0.07, u0 - FRAME, u0, y0, y1, col, NEAR);
  onFace(c, box, face, 0, 0.07, u1, u1 + FRAME, y0, y1, col, NEAR);
  for (let k = 1; k <= mullions; k++) { const u = u0 + (u1 - u0) * k / (mullions + 1); onFace(c, box, face, 0, 0.06, u - FRAME / 2, u + FRAME / 2, y0, y1, col, NEAR); }
}

/** A door on a face (u0..u1, 2 m high) with a lamp over it. */
function doorOn(c, box, face, u0, u1, h = 2.0) {
  onFace(c, box, face, 0, 0.06, u0, u1, 0, h, DOOR, NEAR);
  onFace(c, box, face, 0, 0.08, u0 - FRAME, u1 + FRAME, h, h + FRAME, TRIM, NEAR);
  const u = (u0 + u1) / 2;
  onFace(c, box, face, 0, 0.22, u - 0.13, u + 0.13, h + 0.2, h + 0.32, c.COL.light, { near: true, glow: 1.4 });
}

/** A hut's stone plinth (to the ground: lifts.js reaches it down to the lowest snow under it). */
const plinth = (c, box, h = 0.45) => c.det(box.a0 - 0.05, box.a1 + 0.05, box.b0 - 0.05, box.b1 + 0.05, 0, h, STONE);

/** A thin lit bar over a name sign (the sign reads in the evening). */
function signLamp(c) {
  const s = c.parts.find((p) => p.sign);
  if (!s) return;
  const out = s.sign.face > 0 ? [s.b1, s.b1 + 0.2] : [s.b0 - 0.2, s.b0];
  c.det(s.a0 + 0.25, s.a1 - 0.25, out[0], out[1], s.y1, s.y1 + 0.07, c.COL.light, { near: true, glow: 1.6 });
}

/** A glazed gable end in front of a gable roof part G (end = -1: its a0 end, +1: its a1 end), with mullions. */
function gableGlass(c, G, end, { glow = 0.75, step = 1.7 } = {}) {
  const hw = (G.b1 - G.b0) / 2, bm = (G.b0 + G.b1) / 2, slope = (G.y1 - G.y0) / hw, k = 0.9, base = G.y0 + 0.14;
  if (hw - k < 1) return;
  const [d0, d1] = end < 0 ? [G.a0 - 0.06, G.a0 - 0.01] : [G.a1 + 0.01, G.a1 + 0.06];
  c.det(d0, d1, G.b0 + k, G.b1 - k, base, base + (hw - k) * slope, c.COL.glass, { shape: 'gableA', glow });
  const [m0, m1] = end < 0 ? [G.a0 - 0.1, G.a0 - 0.01] : [G.a1 + 0.01, G.a1 + 0.1];
  c.det(m0, m1, G.b0 + k, G.b1 - k, base - 0.06, base + 0.06, c.COL.fascia, NEAR);
  for (let b = bm - Math.floor((hw - k - 0.4) / step) * step; b < G.b1 - k - 0.3; b += step) {
    const top = base + (hw - k - Math.abs(b - bm)) * slope;
    if (top - base > 0.4) c.det(m0, m1, b - 0.05, b + 0.05, base, top, c.COL.fascia, NEAR);
  }
}

/** A glazed band hung from a roof's return-side edge (b0), from CLEAR m over the deck to the roof: lit in the evening, mullions near. */
const CLEAR = 2.7;
function clerestory(c, roof, a0, a1) {
  const y = roof.y0, b0 = roof.b0, lo = Math.min(CLEAR, y - 0.6);      // (heights only move parts: the part list never depends on them)
  if (a1 - a0 < 2) return;
  c.det(a0, a1, b0 + 0.05, b0 + 0.2, lo, y, c.COL.glass, { glow: 0.55 });
  c.det(a0, a1, b0 - 0.02, b0 + 0.27, lo - 0.16, lo, c.COL.fascia, NEAR);
  const n = Math.max(1, Math.round((a1 - a0) / 2.2));
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; c.det(a - 0.06, a + 0.06, b0 - 0.02, b0 + 0.27, lo, y, c.COL.fascia, NEAR); }
}

/** The gable roof part of an end (the timber one under the snow). */
const gableOf = (c) => c.parts.find((p) => p.shape && p.shape.startsWith('gable') && p.col === c.COL.roofWood) || null;

function dressChair(c) {
  const { COL } = c;
  const roof = c.parts.find((p) => p.roof);
  if (roof) {
    // fascia boards round the canopy (the outer side has the red one); over the lanes only 0.2 m deep (the chairs pass under it)
    c.det(roof.a0, roof.a1, roof.b0 - 0.1, roof.b0, roof.y0 - 0.35, roof.y1, COL.fascia);
    c.det(roof.a0 - 0.1, roof.a0, roof.b0 - 0.1, roof.b1 + 0.1, roof.y0 - 0.2, roof.y1, COL.fascia);
    c.det(roof.a1, roof.a1 + 0.1, roof.b0 - 0.1, roof.b1 + 0.1, roof.y0 - 0.2, roof.y1, COL.fascia);
    c.det(roof.a0 - 0.12, roof.a0 - 0.1, roof.b0 - 0.1, roof.b1 + 0.1, roof.y1 - 0.12, roof.y1 - 0.04, TRIM, NEAR);      // a light trim line
    // lamps under the canopy over the outer platform (out of the chairs' lane)
    for (let a = roof.a0 + 0.9; a < roof.a1 - 0.5; a += 2.8) c.det(a - 0.3, a + 0.3, c.bOut + 0.2, c.bOut + 0.5, roof.y0 - 0.1, roof.y0, COL.light, NEAR);
  }
  signLamp(c);
  // snow on the drive house
  const hd = c.parts.filter((p) => p.col === COL.housingDark).sort((p, q) => q.y1 - p.y1)[0];
  if (hd) c.det(hd.a0 - 0.12, hd.a1 + 0.12, hd.b0 - 0.12, hd.b1 + 0.12, hd.y1, hd.y1 + 0.5, COL.snow, { shape: 'gableA' });
  // the operator's hut: plinth, the window towards the lane framed (its pane is the type model's), one towards the line, a door
  const hut = c.parts.find((p) => p.hut);
  if (hut) {
    plinth(c, hut);
    windowOn(c, hut, '+b', hut.a0 + 0.1, hut.a1 - 0.1, 1.2, 2.1, { pane: false, mullions: 2 });
    const bm = (hut.b0 + hut.b1) / 2;
    windowOn(c, hut, '-a', bm - 0.55, bm + 0.55, 1.2, 2.0);
    doorOn(c, hut, '-b', hut.a1 - 1.25, hut.a1 - 0.35);
  }
}

function dressGondola(c) {
  const G = gableOf(c);
  if (G) {
    gableGlass(c, G, -1);
    const bm = (G.b0 + G.b1) / 2, hw = (G.b1 - G.b0) / 2, slope = (G.y1 - G.y0) / hw;
    if (hw * slope > 1.6) c.det(G.a1 + 0.01, G.a1 + 0.05, bm - 0.6, bm + 0.6, G.y0 + 0.35, G.y0 + 1.15, c.COL.glass, { glow: 0.9 });      // the back gable's window
  }
  signLamp(c);
}

function dressCable(c) {
  const { COL } = c;
  const bld = c.parts.find((p) => p.building);
  if (bld) {
    c.det(bld.a0 - 0.06, bld.a1 + 0.06, bld.b0 - 0.06, bld.b1 + 0.06, 0, 1.6, STONE);                  // plinth
    const top = bld.y1;
    const band = (face, u0, u1, y0, y1) => {
      onFace(c, bld, face, 0, 0.035, u0, u1, y0, y1, COL.glass, { glow: 0.85 });
      onFace(c, bld, face, 0, 0.08, u0 - FRAME, u1 + FRAME, y1, y1 + 0.1, COL.fascia, NEAR);
      onFace(c, bld, face, 0, 0.12, u0 - FRAME, u1 + FRAME, y0 - 0.1, y0, COL.fascia, NEAR);
      const n = Math.max(1, Math.round((u1 - u0) / 1.5));
      for (let k = 0; k <= n; k++) { const u = u0 + (u1 - u0) * k / n; onFace(c, bld, face, 0, 0.07, u - 0.05, u + 0.05, y0, y1, COL.fascia, NEAR); }
    };
    band('+a', bld.b0 + 0.9, bld.b1 - 0.9, top - 2.5, top - 1.1);
    band('-b', bld.a0 + 1.0, bld.a1 - 0.8, top - 2.5, top - 1.1);
    band('+b', bld.a0 + 3.2, bld.a1 - 0.8, top - 4.4, top - 3.2);
    doorOn(c, bld, '+b', bld.a0 + 1.0, bld.a0 + 2.3, 2.3);
  }
  signLamp(c);
  // the dock: a glazed clerestory on the return side (hung from the roof, above heads: the ride-down walk passes under it), a glass band
  // over the front (above the cabin), a soft snow cap (lift-site.js)
  const roof = c.parts.find((p) => p.roof);
  if (roof) {
    clerestory(c, roof, roof.a0 + 0.6, roof.a1);
    const y = roof.y0;
    const lo = Math.min(y - 0.12, Math.max(c.wheel + 0.8, c.ropeTop(roof.a0 - 0.12, roof.a0) + 0.35));      // (no room: a thin trim)
    c.det(roof.a0 - 0.08, roof.a0, roof.b0, roof.b1, lo, y, COL.glass, { glow: 0.45 });
    c.det(roof.a0 - 0.12, roof.a0, roof.b0, roof.b1, lo - 0.08, lo, COL.fascia, NEAR);
  }
}

function dressTrain(c) {
  const { COL } = c;
  const roof = c.parts.find((p) => p.roof);
  const G = gableOf(c);
  if (G) gableGlass(c, G, -1, { glow: 0.6 });
  if (!roof) return;
  const y = roof.y0;
  // the return side: a glazed clerestory under the roof (the ride-down walk passes under it)
  clerestory(c, roof, roof.a0 + 1.0, roof.a1 - 0.6);
  // the platform side: a fascia with the lift's name, lamps under the roof, the platform's white edge
  c.det(roof.a0, roof.a1 - 0.6, roof.b1 - 0.12, roof.b1, y - 0.5, y, COL.fascia);
  c.nameSign((roof.a0 + roof.a1) / 2 - 1, roof.b1 + 0.06, y - 0.25, Math.min(8, (roof.a1 - roof.a0) * 0.5), 0.44, 1);
  for (let a = roof.a0 + 2; a < -2; a += 4) c.det(a - 0.35, a + 0.35, c.bOut + 1.0, c.bOut + 1.3, y - 0.1, y, COL.light, NEAR);
  c.det(roof.a0 + 2, -2, c.bOut + 0.12, c.bOut + 0.27, 0.14, 0.152, TRIM, NEAR);
}

function dressDrag(c) {
  const hut = c.parts.find((p) => p.hut);
  if (!hut) return;
  plinth(c, hut, 0.35);
  windowOn(c, hut, '-b', hut.a0 + 0.3, hut.a1 - 0.3, 1.1, c.key === 'rope' ? 1.7 : 1.9, { pane: false });
  const bm = (hut.b0 + hut.b1) / 2;
  doorOn(c, hut, '+a', bm - 0.45, bm + 0.45, c.key === 'rope' ? 1.75 : 1.95);
  if (c.key !== 'rope') windowOn(c, hut, '-a', bm - 0.45, bm + 0.45, 1.15, 1.8, { mullions: 0 });
}

const DRESS = { chair: dressChair, gondola: dressGondola, cable: dressCable, train: dressTrain, drag: dressDrag, rope: dressDrag };

/**
 * Dress one station end. c = { key (lift-site siteKey), which (0 bottom, 1 top), parts (the type model's parts, read only), det(a0, a1,
 * b0, b1, y0, y1, col, extra) (adds a drawn-only part inside the footprint), nameSign(a, b, y, w, h, face), side, back, bIn, bOut,
 * aBack, C, R, wheel, sub, len, COL (lift-site.js colours), fresh() (the end's parts now, with the dressing), ropeTop(a0, a1) (the
 * highest carrier top over the end's ground passing between a0 and a1) }.
 */
export function dressEnd(c) {
  const f = DRESS[c.key];
  if (!f) return;
  f(c);
  if (c.key === 'train' && c.fresh) signLamp({ ...c, parts: c.fresh() });         // the sign dressTrain just hung up
}
