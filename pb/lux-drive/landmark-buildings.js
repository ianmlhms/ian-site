/* The famous buildings of Luxembourg as hand-made low-poly models: the Philharmonie, the towers of the Cour de justice, the
 * Cathedral Notre-Dame, the Palais grand-ducal and the Gëlle Fra.
 *
 * Each model REPLACES the generic LOD2 blocks of its footprint (it returns their ids in `hideBuildings`) and stands on the
 * ground: the walls reach down to the ground at every corner (never a floating floor), and the edges of the footprints are
 * collision walls of the car.  Returns { soup, walls, hideBuildings, info }. */
import { Soup, paint } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { requireBlocks, edgeWalls, scalePoly, insidePoly, groundRange } from './landmark-util.js';
import { edgeFrame, windowGrid, lancet, portal, course, slab, fins, turret, panel } from './landmark-facade.js';

const TAU = Math.PI * 2;
const SINK = 1.0;                         // m, the walls go this far under the ground (the ground is a carved lattice: no cracks)

/** The bottoms of a wall that follows the ground: one y per corner of the footprint. */
const bottomsOf = (ground, pts) => pts.map((p) => ground(p[0], p[1]) - SINK);

/** A polygon walled up to the flat level y1 (the walls reach the ground at every corner) with a flat top. */
function block(soup, ground, pts, y1, wall, roof) {
  soup.prism(pts, bottomsOf(ground, pts), y1, wall, { topColor: roof });
}

/** An ellipse as a polygon [[x, z]] (n points), turned by yaw. */
function ellipse(cx, cz, rx, rz, n, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    return [cx + x * c - z * s, cz + x * s + z * c];
  });
}

/** A square tower with a pyramid spire; (cx, cz) its middle, half the side h, the walls up to yWall, the spire up to yTip. */
function spireTower(soup, ground, cx, cz, half, yWall, yTip, wall, roof, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pts = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
  block(soup, ground, pts, yWall, wall, wall);
  soup.pyramid(scalePoly(pts, 1.04), yWall, [cx, yTip, cz], roof);
}

/** A gable roof over the rectangle [x0, x1] x [z0, z1], the ridge along z when `alongZ`. */
function gable(soup, x0, x1, z0, z1, yEave, rise, alongZ, roof) {
  const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
  const A = [x0, yEave, z0], B = [x1, yEave, z0], Cc = [x1, yEave, z1], D = [x0, yEave, z1];
  if (alongZ) {
    const r0 = [xm, yEave + rise, z0], r1 = [xm, yEave + rise, z1];
    soup.quad(A, r0, r1, D, paint(roof, 1)); soup.quad(B, Cc, r1, r0, paint(roof, 2));
    soup.tri(A, B, r0, paint(roof, 3)); soup.tri(D, r1, Cc, paint(roof, 4));
  } else {
    const r0 = [x0, yEave + rise, zm], r1 = [x1, yEave + rise, zm];
    soup.quad(A, B, r1, r0, paint(roof, 1)); soup.quad(D, r0, r1, Cc, paint(roof, 2));
    soup.tri(A, r0, D, paint(roof, 3)); soup.tri(B, Cc, r1, paint(roof, 4));
  }
}

/* ------------------------------------------------------------------------------------------------ Philharmonie */
// The elliptical hall of white columns (the photographs: strong white vertical lines over dark glass, a thin white roof that overhangs them, a low
// white shell that rises out of the plaza on the east side).  The old model drew the glass drum pale grey: the columns then read as a grey haze.
const PHILHARMONIE = Object.freeze({
  at: [5958, 7990], hideRadius: 40, hideMinArea: 1500,   // the block of the bake (the elliptical hall) is found here
  centre: [5960, 7990], rx: 36, rz: 53, yaw: 0.12,       // m, the ellipse of the colonnade (OSM: the hall is ~96 x 117 m with its wings)
  columns: 190, columnTangent: 0.55, columnRadial: 0.95, columnHeight: 22,   // the real hall has ~800 slim fins: every 1.5 m reads as the same dense ring
  drumInset: 2.6, roofThickness: 1.5, roofOverhang: 1.6, podium: 0.8,
  shell: { at: [5999, 8016], radius: 13, tip: [5990, 8009], height: 8.5, sides: 14 },   // the white shell: a low cone leaning on the colonnade
});

export function buildPhilharmonie({ buildings, ground }) {
  const K = PHILHARMONIE;
  const hidden = requireBlocks(buildings, 'Philharmonie', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const [cx, cz] = K.centre;
  const ring = ellipse(cx, cz, K.rx + 2.5, K.rz + 2.5, 56, K.yaw);
  const { high } = groundRange(ground, ring);
  const y0 = high + K.podium;
  // the podium (it reaches the ground all round)
  soup.prism(ring, bottomsOf(ground, ring), y0, C.concrete, { topColor: C.paving });
  // the glass behind the columns is DARK: it is what makes the white columns read as stripes
  const drum = ellipse(cx, cz, K.rx - K.drumInset, K.rz - K.drumInset, 48, K.yaw);
  soup.prism(drum, y0, y0 + K.columnHeight, paint(C.glassDark, 1, 0.04), { top: false });
  // the ring of slim white columns: tangent to the ellipse, so each one faces outwards
  const colonnade = ellipse(cx, cz, K.rx - 0.7, K.rz - 0.7, K.columns, K.yaw);
  for (const [i, p] of colonnade.entries()) {
    const q = colonnade[(i + 1) % colonnade.length], o = colonnade[(i + colonnade.length - 1) % colonnade.length];
    const yaw = Math.atan2(-(q[1] - o[1]), q[0] - o[0]);
    soup.box(p[0], y0, p[1], K.columnTangent, K.columnHeight, K.columnRadial, yaw, paint(C.white, i, 0.015), { topColor: C.white });
  }
  const roofOuter = ellipse(cx, cz, K.rx + K.roofOverhang, K.rz + K.roofOverhang, 56, K.yaw);
  const yRoof = y0 + K.columnHeight;
  soup.prism(roofOuter, yRoof, yRoof + K.roofThickness, C.white, { topColor: paint(C.white, 9, 0.02) });
  const roofInner = ellipse(cx, cz, K.rx - 10, K.rz - 14, 32, K.yaw);
  soup.prism(roofInner, yRoof + K.roofThickness, yRoof + K.roofThickness + 2.2, C.concrete, { topColor: C.paving });
  // the white shell: a low cone from the plaza up against the colonnade
  const S = K.shell, [sx, sz] = S.at, [tx, tz] = S.tip;
  const base = Array.from({ length: S.sides }, (_, i) => [sx + Math.cos((i / S.sides) * TAU) * S.radius, sz + Math.sin((i / S.sides) * TAU) * S.radius]);
  const yShell = Math.max(...base.map(([x, z]) => ground(x, z)));
  soup.pyramid(base, yShell - 1.5, [tx, yShell + S.height, tz], paint(C.white, 77, 0.03));
  return { soup, walls: edgeWalls(ellipse(cx, cz, K.rx + 3.0, K.rz + 3.0, 32, K.yaw), 0.5, 'philharmonie'), hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length, y0, columns: K.columns } };
}

/* ------------------------------------------------------------------------------------------------ Cour de justice */
// The three towers of the Court (Kirchberg): thin slabs (15 x 49 m), side by side, all turned the same way (OSM building ways 133301875,
// 133301876, 659961054: the centres and the direction are taken from them: they were guessed 120 m too far south-west before).  Two are clad in
// gold-bronze anodised aluminium, the third and tallest is black.  The LOD2 bake has the three slabs and the long building that links them
// as ONE block (3959, eave 70 m): the block is replaced by a low base and the three towers on it.  The heights are from memory (108 / 108 / 142 m):
// the bake's 70 / 95 m is a rounded roof line of the whole lump.
const ECJ = Object.freeze({
  at: [6052, 7598], hideRadius: 40, hideMinArea: 4000,           // the block of the bake: the three slabs and their base
  yaw: 47 * Math.PI / 180,                                       // the long axis of the slabs: towards the north-east (x east, z south)
  long: 49, short: 15.2,
  // centre, height, body colour, fin colour (the gold of the two older towers, the black of the third)
  towers: [
    { at: [6015.1, 7637.4], height: 108, body: [0.52, 0.38, 0.19], fin: [0.72, 0.58, 0.34] },
    { at: [6054.2, 7600.4], height: 108, body: [0.52, 0.38, 0.19], fin: [0.72, 0.58, 0.34] },
    { at: [6092.0, 7560.0], height: 142, body: [0.07, 0.07, 0.08], fin: [0.24, 0.24, 0.26] },
  ],
  baseHeight: 14,                                                // m: the low building that links the towers
  finPitch: 2.6, finWidth: 0.9, finDepth: 0.45,
});

/** A slab tower on the footprint `poly`: the body, the vertical fins on the two long faces, the crown. */
function ecjTower(soup, ground, poly, t, key) {
  const { high } = groundRange(ground, poly);
  const yTop = high + t.height;
  soup.prism(poly, bottomsOf(ground, poly), yTop, paint(t.body, key, 0.03), { topColor: C.concreteDark });
  for (let e = 0; e < 4; e++) {
    const f = edgeFrame(poly, e);
    const long = f.len > 20;
    // the glass fins hang in front of the façade: lighter than the body, they make the long faces read as vertical stripes from a distance
    fins(soup, f, { s0: 0.8, s1: f.len - 0.8, pitch: long ? ECJ.finPitch : 3.2, w: ECJ.finWidth, depth: ECJ.finDepth, yBottom: (x, z) => ground(x, z) - 0.5, yTop: yTop - 2.5, color: t.fin, key: key + e * 7 });
    course(soup, f, yTop - 2.5, yTop, 0.35, t.body, key + e);                                      // the crown band
  }
  soup.prism(scalePoly(poly, 0.8), yTop, yTop + 3.5, C.concreteDark, { topColor: C.concreteDark });  // the plant room on the roof
  return Math.round(t.height);
}

/** The rectangle of a tower: centre, `long` along `yaw` (x east, z south), `short` across. */
function slabPoly([cx, cz], long, short, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-long / 2, -short / 2], [long / 2, -short / 2], [long / 2, short / 2], [-long / 2, short / 2]].map(([a, b]) => [cx + a * c - b * s, cz + a * s + b * c]);
}

export function buildEcj({ buildings, ground }) {
  const K = ECJ;
  const hidden = requireBlocks(buildings, 'Cour de justice', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  // the base: the footprint of the bake's block, a low building of pale bronze-grey with a dark band of windows
  for (const [i, b] of hidden.entries()) {
    const { high } = groundRange(ground, b.pts);
    const yTop = high + K.baseHeight;
    soup.prism(b.pts, bottomsOf(ground, b.pts), yTop, paint([0.50, 0.45, 0.38], i, 0.04), { topColor: C.concreteDark });
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 6) continue;
      panel(soup, f, 0.5, f.len - 0.5, high + 3.0, high + 6.2, 0.06, C.blackGlass);
      panel(soup, f, 0.5, f.len - 0.5, high + 8.6, high + 11.8, 0.06, C.blackGlass);
    }
  }
  const info = K.towers.map((t, ti) => ecjTower(soup, ground, slabPoly(t.at, K.long, K.short, K.yaw), t, ti * 100));
  const walls = [...hidden.flatMap((b) => edgeWalls(b.pts, 0.3, 'ecj'))];
  return { soup, walls, hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length, towers: info } };
}

/* ------------------------------------------------------------------------------------------------ Cathédrale Notre-Dame */
// From the photographs: a steep slate roof (a gable over the nave and the transept, a high hipped pyramid over the crossing), on its apex a thin
// GREEN copper needle with a little lantern and balcony; at the front two slate spires on square sandstone belfries: the left one is shorter and
// wears a crown of four gables and four small corner spires, the right one is the taller plain needle.  (The old model had three black spires and
// the crossing was the tallest: the crossing is the lowest of the three.)
const CATHEDRAL = Object.freeze({
  at: [5164, 8965], hideRadius: 30, hideMinArea: 800,
  nave: [5154, 5178, 8929, 8976],          // m: x0, x1, z0, z1 of the narrow nave (north)
  transept: [5142, 5185, 8975, 9008],      // m: the wide part (south)
  eave: 19, naveRise: 13, transeptRise: 12, crossingRise: 17,
  // the front towers: centre, the belfry's stone reaches `wall`, the spire's tip is `tip` above the ground at the foot; `crown` = the shorter one with four gables
  frontTowers: [{ at: [5158.4, 8936.5], crown: true, tip: 58 }, { at: [5173.6, 8936.5], crown: false, tip: 68 }],
  towerHalf: 3.2, towerWall: 31, hipHeight: 5,
  crossing: [5163, 8987], crossingHalf: 12, crossingTip: 52,
  buttressPitch: 6, lancetW: 1.7, lancetH: 7.5,
});

const SLATE_SPIRE = [0.20, 0.22, 0.27];

/** A slim octagonal needle from the radius r at y0 to the tip. */
function needle(soup, x, z, r, y0, yTip, color, yaw = Math.PI / 8) {
  soup.frustum(x, z, r, 0, y0, yTip, 8, paint(color, Math.round(x * 3 + yTip), 0.04), { yaw, cap: false });
}

/** A front tower: square belfry, a hip of slate, then the spire (with the crown of gables on the shorter one). */
function cathedralTower(soup, ground, high, t, K) {
  const [x, z] = t.at, half = K.towerHalf;
  const pts = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([a, c]) => [x + a, z + c]);
  const yWall = high + K.towerWall, yHip = yWall + K.hipHeight;
  soup.prism(pts, bottomsOf(ground, pts), yWall, paint(C.cathedralStone, 3, 0.03), { topColor: C.slateGrey });
  for (let e = 0; e < 4; e++) {
    const f = edgeFrame(pts, e);
    course(soup, f, yWall - 1.0, yWall, 0.35, C.sandstoneLight, e);
    lancet(soup, f, f.len / 2, yWall - 8.5, 1.3, 5, C.sandstoneLight, C.slateBlack);        // the belfry opening
    lancet(soup, f, f.len / 2, yWall - 19, 0.9, 2.8, C.sandstoneLight, C.slateBlack);       // a narrower one lower down
  }
  // the hip: the square of the tower narrows to the octagon of the spire in one slate roof
  soup.frustum(x, z, half * 1.45, K.towerHalf * 0.62, yWall, yHip, 8, paint(C.slateRoof, 11, 0.05), { yaw: Math.PI / 8, cap: false });
  if (t.crown) {
    const yLantern = yHip + 5;
    soup.frustum(x, z, half * 0.62, half * 0.62, yHip, yLantern, 8, paint(SLATE_SPIRE, 5, 0.05), { yaw: Math.PI / 8, cap: false });
    for (let k = 0; k < 4; k++) {                                                          // the four gables of the crown (a dormer on each face)
      const a = (k / 4) * TAU + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      const gx = x + c * half * 0.6, gz = z + s * half * 0.6;
      const P = (u, v, y) => [gx + c * v - s * u, y, gz + s * v + c * u];
      soup.tri(P(-1.25, 0.9, yHip + 2.2), P(1.25, 0.9, yHip + 2.2), P(0, 0.9, yHip + 6.2), paint(SLATE_SPIRE, 20 + k, 0.05));
      soup.quad(P(-1.25, 0.9, yHip + 2.2), P(1.25, 0.9, yHip + 2.2), P(1.25, -0.3, yHip + 4.6), P(-1.25, -0.3, yHip + 4.6), C.slateBlack);
    }
    needle(soup, x, z, half * 0.62, yLantern, high + t.tip, SLATE_SPIRE);
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {                           // the corner spires
      const px = x + a * half * 0.95, pz = z + c * half * 0.95;
      soup.frustum(px, pz, 0.55, 0.0, yWall, yWall + 9, 4, paint(SLATE_SPIRE, a + c * 3, 0.05), { yaw: Math.PI / 4, cap: false });
    }
  } else {
    needle(soup, x, z, half * 0.62, yHip, high + t.tip, paint(SLATE_SPIRE, 9, 0.02));
  }
}

export function buildCathedral({ buildings, ground }) {
  const K = CATHEDRAL;
  const hidden = requireBlocks(buildings, 'Cathédrale', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const walls = [];
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    block(soup, ground, b.pts, high + K.eave, paint(C.cathedralStone, b.id, 0.03), C.slateRoof);
    walls.push(...edgeWalls(b.pts, 0.3, 'cathedral'));
    const [t0, t1, u0, u1] = K.transept;
    gable(soup, K.nave[0], K.nave[1], K.nave[2], K.nave[3], high + K.eave, K.naveRise, true, C.slateRoof);
    gable(soup, t0, t1, u0, u1, high + K.eave, K.transeptRise, false, C.slateRoof);
    // the walls are not blank: a plinth, a cornice, buttresses and tall pointed windows between them on every edge
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 4) continue;
      const groundAt = (s) => { const q = f.at(s, 0, 0); return ground(q[0], q[2]); };
      course(soup, f, high - 0.6, high + 1.2, 0.35, C.sandstoneDark, e);                // the plinth
      course(soup, f, high + K.eave - 0.9, high + K.eave, 0.5, C.sandstoneLight, e + 7);   // the cornice
      const n = Math.max(1, Math.round(f.len / K.buttressPitch));
      for (let i = 0; i <= n; i++) {                                                // buttresses at both ends and between
        const s = (i / n) * f.len;
        const [x, , z] = f.at(s, 0, 0.45);
        const yb = Math.min(groundAt(s), high) - 0.5;
        soup.box(x, yb, z, 1.0, high + K.eave + 1.5 - yb, 0.9, f.yaw, paint(C.sandstoneLight, e * 11 + i), { topColor: C.sandstoneLight });
      }
      for (let i = 0; i < n; i++) {
        const sc = ((i + 0.5) / n) * f.len;
        lancet(soup, f, sc, high + 5.2, K.lancetW, K.lancetH, C.sandstoneLight, C.glassDark);
      }
    }
    // the front (the north end): a pointed portal with a tall window over it, between the two towers
    const front = b.pts.map((_, i) => edgeFrame(b.pts, i)).filter((f) => f.len > 10 && Math.abs(f.nz) > 0.8 && f.nz < 0).sort((p, q) => q.len - p.len)[0];
    if (front) {
      portal(soup, front, front.len / 2, high, 2.6, 5.6, C.sandstoneLight, C.glassDark);
      lancet(soup, front, front.len / 2, high + 9.5, 2.8, 8, C.sandstoneLight, C.glassDark);
    }
    for (const t of K.frontTowers) cathedralTower(soup, ground, high, t, K);
    // the crossing: the high hipped roof with the green copper needle on its apex (lantern, balcony, needle)
    const [cx, cz] = K.crossing, h = K.crossingHalf, yBase = high + K.eave, yApex = yBase + K.crossingRise;
    soup.pyramid([[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]], yBase, [cx, yApex, cz], C.slateRoof);
    soup.frustum(cx, cz, 2.6, 2.1, yApex - 1.2, yApex + 1.2, 8, paint(C.copperGreen, 4, 0.04), { cap: false });         // the balcony ring
    soup.frustum(cx, cz, 1.6, 1.4, yApex + 1.2, yApex + 4.8, 8, paint(C.copperGreen, 5, 0.04), { cap: false });         // the lantern
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 8;
      soup.box(cx + Math.cos(a) * 1.5, yApex + 1.8, cz + Math.sin(a) * 1.5, 0.7, 2.4, 0.25, -a + Math.PI / 2, C.glassDark);   // the lantern's openings
    }
    needle(soup, cx, cz, 1.4, yApex + 4.8, high + K.crossingTip, C.copperGreen, 0);
  }
  return { soup, walls, hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length } };
}

/* ------------------------------------------------------------------------------------------------ Palais grand-ducal */
// Flemish Renaissance: a long facade of pale ochre stone on the Rue du Marché-aux-Herbes (Krautmaart), horizontal bands of darker stone,
// two storeys of windows with stone surrounds, an arcade of low arches at the foot, oriel turrets at the ends and a steep slate roof
// with dormers.
const PALAIS = Object.freeze({
  at: [5265, 8815], hideRadius: 45, hideMinArea: 300,
  streetName: /Krautmaart|Marché-aux-Herbes/i,
  eave: 15.5, roofRise: 8.5, roofScale: 0.66,
  floor: 4.6, windowW: 1.5, windowH: 2.6, windowPitch: 4.0,
  turretR: 2.0, dormerPitch: 6.0,
});

/** The edge of the main block that faces the street: the long edge whose middle is nearest to the named road (else the longest edge). */
function streetEdge(poly, roads, name) {
  const named = roads.filter((r) => r.name && name.test(r.name));
  const candidates = poly.map((_, i) => edgeFrame(poly, i)).filter((f) => f.len > 18);
  if (!candidates.length) throw new Error('Palais: no edge long enough for the facade');
  let best = null, bestScore = Infinity;
  for (const f of candidates) {
    const mx = (f.a[0] + f.b[0]) / 2, mz = (f.a[1] + f.b[1]) / 2;
    let d = Infinity;
    for (const r of named) for (const p of r.pts) d = Math.min(d, Math.hypot(p[0] - mx, p[1] - mz));
    const score = (Number.isFinite(d) ? d : 100) - f.len * 0.3;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

export function buildPalais({ buildings, ground, roads = [] }) {
  const K = PALAIS;
  const hidden = requireBlocks(buildings, 'Palais grand-ducal', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const walls = [];
  const main = hidden.reduce((m, b) => (b.area > m.area ? b : m), hidden[0]);
  const info = { blocks: hidden.length };
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    const yEave = high + K.eave;
    soup.prism(b.pts, bottomsOf(ground, b.pts), yEave, paint(C.palaisStone, b.id, 0.03), { top: false });
    // the steep slate roof: the eave outline drawn smaller, then a flat crown
    const lower = b.pts, upper = scalePoly(b.pts, K.roofScale);
    for (let i = 0; i < lower.length; i++) {
      const j = (i + 1) % lower.length;
      soup.quad([lower[i][0], yEave, lower[i][1]], [lower[j][0], yEave, lower[j][1]], [upper[j][0], yEave + K.roofRise, upper[j][1]], [upper[i][0], yEave + K.roofRise, upper[i][1]], paint(C.slateRoof, i + 5, 0.07));
    }
    soup.prism(upper, yEave + K.roofRise, yEave + K.roofRise + 0.1, C.slateRoof, { top: true });
    walls.push(...edgeWalls(b.pts, 0.3, 'palais'));
    // every edge gets the bands; the street edge of the main block gets the whole facade
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 5) continue;
      course(soup, f, high + 0.0, high + 1.0, 0.25, C.stoneBand, e);
      for (let r = 1; r <= 3; r++) course(soup, f, high + r * K.floor - 0.35, high + r * K.floor + 0.25, 0.3, C.stoneBand, e + r * 5);
      course(soup, f, yEave - 0.7, yEave, 0.6, C.sandstoneLight, e + 40);
    }
    if (b !== main) continue;
    const f = streetEdge(b.pts, roads, K.streetName);
    info.facade = { a: f.a.map((v) => +v.toFixed(1)), b: f.b.map((v) => +v.toFixed(1)), n: [+f.nx.toFixed(2), +f.nz.toFixed(2)], len: +f.len.toFixed(1) };
    // ground floor: low arches (dark openings with a stone frame), above them two storeys of windows with stone surrounds
    windowGrid(soup, f, { s0: 5, s1: f.len - 5, y0: high + 0.9, rows: 1, floorH: K.floor, w: 2.0, h: 2.8, pitch: K.windowPitch, frame: C.sandstoneLight, glass: C.glassDark, key: 100 });
    windowGrid(soup, f, { s0: 5, s1: f.len - 5, y0: high + K.floor + 0.7, rows: 2, floorH: K.floor, w: K.windowW, h: K.windowH, pitch: K.windowPitch, frame: C.sandstoneLight, glass: C.glassDark, key: 200 });
    // the oriel turrets at the two ends of the facade: corbelled round towers with pointed slate caps, and a central pavilion
    for (const s of [0.6, f.len - 0.6]) {
      const [x, , z] = f.at(s, 0, 0.9);
      turret(soup, x, z, K.turretR, high + 5.5, yEave + 1.0, yEave + 12, paint(C.palaisStone, 77, 0.03), C.slateBlack);
      soup.frustum(x, z, K.turretR * 0.55, K.turretR, high + 3.6, high + 5.5, 8, C.sandstoneDark, { cap: false });
    }
    const mid = f.len / 2;
    slab(soup, f, mid - 3.5, mid + 3.5, high, yEave + 3.2, 1.4, paint(C.sandstoneLight, 91, 0.03), { topColor: C.sandstoneLight });
    windowGrid(soup, f, { s0: mid - 3.4, s1: mid + 3.4, y0: high + K.floor + 0.7, rows: 2, floorH: K.floor, w: 1.8, h: 2.8, pitch: 3.4, frame: C.stoneBand, glass: C.glassDark, key: 300 });
    const xz = (sv, out) => { const q = f.at(sv, 0, out); return [q[0], q[2]]; };
    soup.pyramid([xz(mid - 3.6, -0.2), xz(mid + 3.6, -0.2), xz(mid + 3.6, 1.6), xz(mid - 3.6, 1.6)], yEave + 3.2, f.at(mid, yEave + 8.2, 0.7), C.slateRoof);
    // dormers on the roof slope above the facade: a stone box with a dark window and a little gable
    let cx = 0, cz = 0; for (const p of b.pts) { cx += p[0]; cz += p[1]; } cx /= b.pts.length; cz /= b.pts.length;
    const dc = Math.abs((cx - f.a[0]) * f.nx + (cz - f.a[1]) * f.nz);
    const D = (1 - K.roofScale) * dc;
    if (D > 2.5) {
      const inset = 1.2, yBase = yEave + K.roofRise * (inset / D);
      for (let s = K.dormerPitch; s < f.len - K.dormerPitch * 0.6; s += K.dormerPitch) {
        const [x, , z] = f.at(s, 0, -inset);
        soup.box(x, yBase - 0.3, z, 1.9, 2.6, 1.3, f.yaw, paint(C.palaisStone, Math.round(s), 0.04), { topColor: C.palaisStone });
        panel(soup, f, s - 0.6, s + 0.6, yBase + 0.2, yBase + 2.0, -inset + 0.68, C.glassDark);
        soup.tri(f.at(s - 1.0, yBase + 2.3, -inset + 0.67), f.at(s + 1.0, yBase + 2.3, -inset + 0.67), f.at(s, yBase + 3.6, -inset + 0.67), C.sandstoneLight);
      }
    }
  }
  return { soup, walls, hideBuildings: hidden.map((b) => b.id), info };
}

/* ------------------------------------------------------------------------------------------------ Gëlle Fra */
// The memorial of the Place de la Constitution: a tall tapering obelisk of pink-brown granite on a stepped granite plinth with a bronze group at its
// foot, and the golden woman with the wreath on top.
const GELLE_FRA = Object.freeze({
  at: [4970, 8985], baseHalf: 4.0, baseHeight: 3.2, shaftBottomHalf: 1.45, shaftTopHalf: 0.85, shaftHeight: 19, figureHeight: 3.2,
});

export function buildGelleFra({ ground }) {
  const K = GELLE_FRA;
  const [x, z] = K.at;
  const soup = new Soup();
  const foot = [[-K.baseHalf, -K.baseHalf], [K.baseHalf, -K.baseHalf], [K.baseHalf, K.baseHalf], [-K.baseHalf, K.baseHalf]].map(([a, b]) => [x + a, z + b]);
  const { high } = groundRange(ground, foot);
  soup.prism(foot, bottomsOf(ground, foot), high + 0.7, C.concreteDark, { topColor: C.concrete });
  const step = [[-3.4, -3.4], [3.4, -3.4], [3.4, 3.4], [-3.4, 3.4]].map(([a, b]) => [x + a, z + b]);
  soup.prism(step, high + 0.7, high + K.baseHeight, C.granite, { topColor: C.graniteLight });
  const y1 = high + K.baseHeight;
  // the bronze figure group at the foot of the plinth (a seated figure and a recumbent one), the gold inscription band on the front
  soup.box(x + 1.2, high + 0.7, z + 3.7, 2.6, 1.4, 1.0, 0, C.patina);
  soup.box(x - 1.4, high + 0.7, z + 3.7, 2.2, 0.7, 0.9, 0, C.patina);
  soup.quad([x - 2.2, high + 1.2, z - 3.41], [x + 2.2, high + 1.2, z - 3.41], [x + 2.2, high + 2.7, z - 3.41], [x - 2.2, high + 1.2 + 1.5, z - 3.41], C.gold);
  soup.frustum(x, z, K.shaftBottomHalf * 1.414, K.shaftTopHalf * 1.414, y1, y1 + K.shaftHeight, 4, C.granite, { yaw: Math.PI / 4, capColor: C.graniteLight });
  const yTop = y1 + K.shaftHeight;
  // the golden woman: a long robe, a body, a head and the raised wreath
  soup.frustum(x, z, 0.75, 0.45, yTop, yTop + 1.7, 8, C.gold);
  soup.frustum(x, z, 0.5, 0.38, yTop + 1.7, yTop + 2.6, 8, C.gold);
  soup.frustum(x, z, 0.28, 0.0, yTop + 2.6, yTop + 3.2, 8, paint(C.gold, 3, 0.05));
  soup.box(x + 0.9, yTop + 2.3, z, 1.6, 0.18, 0.18, 0.3, C.gold);                 // the arm with the wreath
  return { soup, walls: [{ ax: x - 4, az: z, bx: x + 4, bz: z, r: 1.0, id: 'gelle-fra' }], hideBuildings: [], info: { top: Math.round(yTop + K.figureHeight - high) } };
}

/* ------------------------------------------------------------------------------------------------ Oberanven church */
const OBERANVEN = Object.freeze({ at: [13285, 3652], hideRadius: 8, hideMinArea: 150, eave: 9, rise: 5.5, tower: { half: 2.3, wall: 16, tip: 34 } });   // a slim dark spire (the photograph: tip height ~ 4x the width of the tower)

export function buildOberanven({ buildings, ground }) {
  const K = OBERANVEN;
  const hidden = requireBlocks(buildings, 'Oberanven church', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const b = hidden[0];
  const { high } = groundRange(ground, b.pts);
  block(soup, ground, b.pts, high + K.eave, paint(C.sandstoneLight, b.id, 0.04), C.slate);
  const xs = b.pts.map((p) => p[0]), zs = b.pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  gable(soup, x0 + 1, x1 - 1, z0 + 1, z1 - 1, high + K.eave, K.rise, (z1 - z0) > (x1 - x0), C.slate);
  const tx = (x0 + x1) / 2, tz = z0 - K.tower.half + 1;
  spireTower(soup, ground, tx, tz, K.tower.half, high + K.tower.wall, high + K.tower.tip, C.sandstone, C.slate);
  return { soup, walls: edgeWalls(b.pts, 0.3, 'oberanven'), hideBuildings: [b.id], info: { id: b.id } };
}
