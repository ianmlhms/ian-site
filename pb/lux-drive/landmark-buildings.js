/* The famous buildings of Luxembourg as hand-made low-poly models: the Philharmonie, the towers of the Cour de justice, the
 * Cathedral Notre-Dame, the Palais grand-ducal and the Gëlle Fra.
 *
 * Each model REPLACES the generic LOD2 blocks of its footprint (it returns their ids in `hideBuildings`) and stands on the
 * ground: the walls reach down to the ground at every corner (never a floating floor), and the edges of the footprints are
 * collision walls of the car.  Returns { soup, walls, hideBuildings, info }. */
import { Soup, paint } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { requireBlocks, edgeWalls, scalePoly, insidePoly, groundRange } from './landmark-util.js';
import { edgeFrame, lineFrame, slateFace, windowGrid, lancet, portal, course, slab, fins, turret, panel, joints, roundArch } from './landmark-facade.js';
import { renaissanceFront, sentryBox, bollard } from './landmark-renaissance.js';

const TAU = Math.PI * 2;
const SENTRY_OUT = 0.75, STRIP_WIDTH = 1.7;    // m in front of the wall: the sentry boxes stand against the façade, the strip of pavement is 1.7 m wide (the street runs right along the wall)
const FRONT_FILL = 0.35, PINNACLE_PITCH = 13, TURRET_SET_BACK = 0.1;   // m: the plane of the facade stands this far in front of the most protruding corner of the outline
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

/** The point of an ellipse (rx, rz, turned by yaw) at the parameter a. */
function ellipse1(cx, cz, rx, rz, a, yaw = 0) {
  const x = Math.cos(a) * rx, z = Math.sin(a) * rz, c = Math.cos(yaw), s = Math.sin(yaw);
  return [cx + x * c - z * s, cz + x * s + z * c];
}

/** A square tower with a pyramid spire; (cx, cz) its middle, half the side h, the walls up to yWall, the spire up to yTip. */
function spireTower(soup, ground, cx, cz, half, yWall, yTip, wall, roof, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pts = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
  block(soup, ground, pts, yWall, wall, wall);
  soup.pyramid(scalePoly(pts, 1.04), yWall, [cx, yTip, cz], roof);
}

/** A gable roof over the rectangle [x0, x1] x [z0, z1], the ridge along z when `alongZ`. */
function gable(soup, x0, x1, z0, z1, yEave, rise, alongZ, roof, slate = null) {
  const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
  const A = [x0, yEave, z0], B = [x1, yEave, z0], Cc = [x1, yEave, z1], D = [x0, yEave, z1];
  if (alongZ) {
    const r0 = [xm, yEave + rise, z0], r1 = [xm, yEave + rise, z1];
    soup.quad(A, r0, r1, D, paint(roof, 1)); soup.quad(B, Cc, r1, r0, paint(roof, 2));
    soup.tri(A, B, r0, paint(roof, 3)); soup.tri(D, r1, Cc, paint(roof, 4));
    if (slate) { slateFace(soup, A, D, r0, r1, { ...slate, key: 1 }); slateFace(soup, B, Cc, r0, r1, { ...slate, key: 2 }); }
  } else {
    const r0 = [x0, yEave + rise, zm], r1 = [x1, yEave + rise, zm];
    soup.quad(A, B, r1, r0, paint(roof, 1)); soup.quad(D, r0, r1, Cc, paint(roof, 2));
    soup.tri(A, r0, D, paint(roof, 3)); soup.tri(B, Cc, r1, paint(roof, 4));
    if (slate) { slateFace(soup, A, B, r0, r1, { ...slate, key: 1 }); slateFace(soup, D, Cc, r0, r1, { ...slate, key: 2 }); }
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
  // the white shell (photographs: a smooth wave of white panels that rises from the plaza and leans against the colonnade): `toward` = where it lies seen from the middle
  // of the hall, `halfArc` its half width as an angle of the ellipse, `reach` how far it runs out onto the plaza, `height` where it meets the columns
  shell: { toward: [5999, 8016], halfArc: 0.85, reach: 25, height: 13, rows: 26, cols: 11 },
  white: [3.0, 3.0, 2.85],                    // brighter than white: the columns in the shade of the other side are still lit by the sky only, and read grey at 0.93
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
    soup.box(p[0], y0, p[1], K.columnTangent, K.columnHeight, K.columnRadial, yaw, paint(K.white, i, 0.015), { topColor: K.white });
  }
  const roofOuter = ellipse(cx, cz, K.rx + K.roofOverhang, K.rz + K.roofOverhang, 56, K.yaw);
  const yRoof = y0 + K.columnHeight;
  soup.prism(roofOuter, yRoof, yRoof + K.roofThickness, K.white, { topColor: paint(K.white, 9, 0.02) });
  const roofInner = ellipse(cx, cz, K.rx - 10, K.rz - 14, 32, K.yaw);
  soup.prism(roofInner, yRoof + K.roofThickness, yRoof + K.roofThickness + 2.2, paint(K.white, 11, 0.02), { topColor: paint(K.white, 12, 0.02) });   // the roof is white all over in the photographs (a grey pad read as a lid)
  // the white shell: one smooth skin, from the podium (outer rim, flat) up to the colonnade; its height follows a bell along the arc (the wave of the photographs)
  const S = K.shell;
  const rim = (a, k) => ellipse1(cx, cz, K.rx * k, K.rz * k, a, K.yaw);
  const [dx0, dz0] = [S.toward[0] - cx, S.toward[1] - cz];
  let aC = 0, best = Infinity;
  for (let a = 0; a < TAU; a += 0.01) {
    const [px, pz] = rim(a, 1);
    const d = Math.abs(Math.atan2((pz - cz) * dx0 - (px - cx) * dz0, (px - cx) * dx0 + (pz - cz) * dz0));
    if (d < best) { best = d; aC = a; }
  }
  const rows = [], cols = [];
  for (let i = 0; i <= S.rows; i++) {
    const t = i / S.rows, a = aC - S.halfArc + 2 * S.halfArc * t;
    const bell = Math.pow(Math.sin(Math.PI * t), 0.9);                    // 0 at the two ends of the arc, 1 in the middle
    const row = [], crow = [];
    for (let j = 0; j <= S.cols; j++) {
      const u = j / S.cols;                                               // 0 on the plaza ... 1 against the columns
      const k = 1 + (S.reach / K.rx) * (1 - u) * (0.35 + 0.65 * bell) + 0.012;
      const [px, pz] = rim(a, k * 1.0);
      const wGround = Math.min(1, u * 3), yBase = ground(px, pz) * (1 - wGround) + y0 * wGround;          // the outer rim lies on the plaza, not on the podium
      const y = yBase + S.height * bell * (Math.pow(u, 1.5) * (0.55 + 0.45 * u));
      row.push([px, y + 0.02, pz]);
      crow.push(paint(K.white, i * 13 + j, 0.015));
    }
    rows.push(row); cols.push(crow);
  }
  soup.grid(rows, cols, { flip: 'auto' });
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
  eave: 19, naveRise: 15, transeptRise: 13, crossingRise: 20,    // steep: the slate roofs of the photographs rise at ~55 degrees
  aisleEave: 11, aisleRise: 5, aisleWidth: 6,                      // the aisles: lower walls, lean-to roofs that rise to the clerestory
  // the front towers: centre, the belfry's stone reaches `wall`, the spire's tip is `tip` above the ground at the foot; `crown` = the shorter one with four gables
  frontTowers: [{ at: [5158.4, 8936.5], crown: true, tip: 64 }, { at: [5173.6, 8936.5], crown: false, tip: 72 }],
  towerHalf: 3.2, towerWall: 31, hipHeight: 5,
  crossing: [5163, 8987], crossingHalf: 12, crossingTip: 60,
  buttressPitch: 6, lancetW: 1.7, lancetH: 7.5,
  // the chevet behind the transept (south): a half octagon, lower than the nave, with three small chapels on its faces (the photographs: hipped slate roofs, tall lancets); it stays west of the street behind the church
  apse: { at: [5156, 9002], r: 8.5, faces: 5, eaveAbove: 3.5, roofRise: 9.5, chapel: { depth: 3.4, width: 4.2, eaveAbove: -2.5, rise: 3.2 } },
});

const SLATE_SPIRE = [0.20, 0.22, 0.27];
const SPIRE_BASE = 0.38;       // the radius of the spire's foot per half width of the tower (the photographs: the needles are a third of the belfry wide; the old model's were two thirds)
const CATHEDRAL_SLATE = Object.freeze({ rowH: 1.1, colW: 1.8, color: [0.40, 0.43, 0.50] });   // the slates of the great roofs: blue-grey, lighter than the dark roof under them (the gaps); city13: 1.1 x 1.8 m (was 0.95 x 1.5) pays for the LOD2 landmarks

/** A slim octagonal needle from the radius r at y0 to the tip. */
function needle(soup, x, z, r, y0, yTip, color, yaw = Math.PI / 8) {
  soup.frustum(x, z, r, 0, y0, yTip, 8, paint(color, Math.round(x * 3 + yTip), 0.04), { yaw, cap: false });
}

/** A round rose window on the wall plane of frame f: a stone ring and a dark glass disc with eight spokes. */
function rose(soup, f, sc, yc, r, frame, glass) {
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
    const at = (rr, a, out) => f.at(sc + Math.cos(a) * rr, yc + Math.sin(a) * rr, out);
    soup.tri(at(0, 0, 0.07), at(r, a0, 0.07), at(r, a1, 0.07), paint(glass, i, 0.05));
    soup.quad(at(r, a0, 0.05), at(r + 0.5, a0, 0.05), at(r + 0.5, a1, 0.05), at(r, a1, 0.05), paint(frame, i, 0.03));
    if (i % 2 === 0) soup.quad(at(0.1, a0, 0.1), at(r, a0 - 0.05, 0.1), at(r, a0 + 0.05, 0.1), at(0.1, a0 + 0.03, 0.1), frame);   // a spoke
  }
}

/** A front tower: square belfry with corner buttresses and pinnacles, string courses, paired louvred openings, a hip of slate, then the spire (with the crown of gables on the shorter one). */
function cathedralTower(soup, ground, high, t, K) {
  const [x, z] = t.at, half = K.towerHalf;
  const pts = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([a, c]) => [x + a, z + c]);
  const yWall = high + K.towerWall, yHip = yWall + K.hipHeight;
  soup.prism(pts, bottomsOf(ground, pts), yWall, paint(C.cathedralStone, 3, 0.03), { topColor: C.slateGrey });
  for (let e = 0; e < 4; e++) {
    const f = edgeFrame(pts, e);
    course(soup, f, yWall - 1.0, yWall, 0.35, C.sandstoneLight, e);                          // the cornice
    course(soup, f, yWall - 12.5, yWall - 12.0, 0.3, C.sandstoneLight, e + 20);             // a string course under the belfry
    course(soup, f, yWall - 23.5, yWall - 23.0, 0.3, C.sandstoneLight, e + 30);             // and another lower down
    for (const dx of [-0.95, 0.95]) {                                                       // the belfry: two tall paired openings, dark louvres
      lancet(soup, f, f.len / 2 + dx, yWall - 10.8, 1.1, 5.4, C.sandstoneLight, C.slateBlack);
      for (let k = 0; k < 5; k++) panel(soup, f, f.len / 2 + dx - 0.5, f.len / 2 + dx + 0.5, yWall - 10.4 + k * 1.1, yWall - 10.2 + k * 1.1, 0.12, [0.32, 0.31, 0.30]);   // the slats
    }
    lancet(soup, f, f.len / 2, yWall - 22.5, 0.9, 3.2, C.sandstoneLight, C.slateBlack);       // narrower ones lower down
    lancet(soup, f, f.len / 2, yWall - 31.0, 0.8, 2.4, C.sandstoneLight, C.slateBlack);
    joints(soup, f, { y0: high + 1, y1: yWall - 1.2, rowH: 1.3, colW: 2.2, color: C.sandstoneDark, key: e * 59 + 7, vertical: false });
  }
  for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {                               // the corner buttresses with a pinnacle cap
    const px = x + a * half, pz = z + c * half;
    soup.box(px, Math.min(ground(px, pz), high) - 0.5, pz, 1.3, yWall - 2.5 - (Math.min(ground(px, pz), high) - 0.5), 1.3, 0, paint(C.sandstoneLight, a * 3 + c, 0.03), { topColor: C.sandstoneLight });
    soup.pyramid([[px - 0.65, pz - 0.65], [px + 0.65, pz - 0.65], [px + 0.65, pz + 0.65], [px - 0.65, pz + 0.65]], yWall - 2.5, [px, yWall + 0.6, pz], C.slateBlack);
  }
  // the hip: the square of the tower narrows to the octagon of the spire in one slate roof
  soup.frustum(x, z, half * 1.45, SPIRE_BASE * half, yWall, yHip, 8, paint(C.slateRoof, 11, 0.05), { yaw: Math.PI / 8, cap: false });
  if (t.crown) {
    const yLantern = yHip + 5;
    soup.frustum(x, z, SPIRE_BASE * half, SPIRE_BASE * half, yHip, yLantern, 8, paint(SLATE_SPIRE, 5, 0.05), { yaw: Math.PI / 8, cap: false });
    for (let k = 0; k < 4; k++) {                                                          // the four gables of the crown (a dormer on each face)
      const a = (k / 4) * TAU + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      const gx = x + c * half * 0.6, gz = z + s * half * 0.6;
      const P = (u, v, y) => [gx + c * v - s * u, y, gz + s * v + c * u];
      soup.tri(P(-1.25, 0.9, yHip + 2.2), P(1.25, 0.9, yHip + 2.2), P(0, 0.9, yHip + 6.2), paint(SLATE_SPIRE, 20 + k, 0.05));
      soup.quad(P(-1.25, 0.9, yHip + 2.2), P(1.25, 0.9, yHip + 2.2), P(1.25, -0.3, yHip + 4.6), P(-1.25, -0.3, yHip + 4.6), C.slateBlack);
    }
    needle(soup, x, z, SPIRE_BASE * half, yLantern, high + t.tip, SLATE_SPIRE);
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {                           // the corner spires
      const px = x + a * half * 0.95, pz = z + c * half * 0.95;
      soup.frustum(px, pz, 0.5, 0.0, yWall, yWall + 12, 4, paint(SLATE_SPIRE, a + c * 3, 0.05), { yaw: Math.PI / 4, cap: false });
    }
  } else {
    needle(soup, x, z, SPIRE_BASE * half, yHip, high + t.tip, paint(SLATE_SPIRE, 9, 0.02));
  }
}

/** The stone gable end of a gabled roof, on the wall plane of frame f (s0..s1 along, y0 the eave, `rise` to the ridge). */
function stoneGable(soup, f, s0, s1, y0, rise, color) {
  soup.tri(f.at(s0, y0, 0.02), f.at(s1, y0, 0.02), f.at((s0 + s1) / 2, y0 + rise, 0.02), paint(color, 5, 0.02));
  const mid = (s0 + s1) / 2;
  soup.quad(f.at(s0, y0, 0.15), f.at(mid, y0 + rise, 0.15), f.at(mid, y0 + rise + 0.5, 0.15), f.at(s0, y0 + 0.5, 0.15), C.slateBlack);          // the coping along both slopes
  soup.quad(f.at(mid, y0 + rise, 0.15), f.at(s1, y0, 0.15), f.at(s1, y0 + 0.5, 0.15), f.at(mid, y0 + rise + 0.5, 0.15), C.slateBlack);
}

export function buildCathedral({ buildings, ground }) {
  const K = CATHEDRAL;
  const hidden = requireBlocks(buildings, 'Cathédrale', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const walls = [];
  const AISLE = K.aisleEave, NAVE = K.eave;
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    // the whole footprint is walled up to the eave of the aisles; over it the lower roofs, the nave and the transept rise as separate volumes
    block(soup, ground, b.pts, high + AISLE, paint(C.cathedralStone, b.id, 0.03), C.slateGrey);
    walls.push(...edgeWalls(b.pts, 0.3, 'cathedral'));
    const [n0, n1, nz0, nz1] = K.nave, [t0, t1, u0, u1] = K.transept;
    const cx0 = n0 + K.aisleWidth, cx1 = n1 - K.aisleWidth, yA = high + AISLE, yN = high + NAVE;
    // ---- the nave: a clerestory (a stone box with its own lancets) under a steep slate roof; the aisles are lower, their lean-to roofs rise to the clerestory
    const clere = [[cx0, nz0 + 3.5], [cx1, nz0 + 3.5], [cx1, nz1], [cx0, nz1]];
    soup.prism(clere, yA - 0.2, yN, paint(C.cathedralStone, 61, 0.03), { top: false });
    for (let e = 1; e <= 3; e += 2) {                                                       // the long sides of the clerestory: paired windows, a cornice
      const f = edgeFrame(clere, e);
      course(soup, f, yN - 0.8, yN, 0.45, C.sandstoneLight, 70 + e);
      for (let sc = 3; sc < f.len - 2; sc += 4.6) lancet(soup, f, sc, yA + 1.6, 1.5, 3.4, C.sandstoneLight, C.glassDark);
    }
    gable(soup, cx0 - 0.5, cx1 + 0.5, nz0 + 3.0, nz1 + 0.5, yN, K.naveRise, true, C.slateRoof, CATHEDRAL_SLATE);
    soup.box((cx0 + cx1) / 2, yN + K.naveRise - 0.1, (nz0 + nz1 + 3.5) / 2, 0.5, 0.5, nz1 - nz0 - 2.5, 0, C.copperGreen, { topColor: C.copperGreen });              // the ridge cap
    for (const side of [-1, 1]) {                                                           // the lean-to roofs of the aisles
      const xo = side < 0 ? n0 - 0.4 : n1 + 0.4, xi = side < 0 ? cx0 : cx1;
      const A = [xo, yA + 0.2, nz0 + 2.0], B = [xo, yA + 0.2, nz1], Cc = [xi, yA + K.aisleRise, nz1], D = [xi, yA + K.aisleRise, nz0 + 2.0];
      soup.quad(A, B, Cc, D, paint(C.slateGrey, 80 + side, 0.05));
      soup.quad(D, Cc, B, A, paint(C.slateGrey, 82 + side, 0.05));
      slateFace(soup, A, B, D, Cc, { ...CATHEDRAL_SLATE, key: 90 + side });   // city13: the default slate (was 0.8 x 1.3 m)
      for (let z = nz0 + 6; z < nz1 - 3; z += 8) soup.box((xo + xi) / 2, yA + K.aisleRise * 0.5 + 0.2, z, 1.1, 0.9, 1.1, 0, paint(C.sandstoneLight, z, 0.03));   // a roof dormer on every aisle roof
    }
    // ---- the transept: a stone box with a roof of its own, a rose window at each end
    soup.prism([[t0, u0], [t1, u0], [t1, u1], [t0, u1]], yA - 0.2, yN, paint(C.cathedralStone, 62, 0.03), { top: false });
    gable(soup, t0 - 0.4, t1 + 0.4, u0 - 0.4, u1 + 0.4, yN, K.transeptRise, false, C.slateRoof, CATHEDRAL_SLATE);
    soup.box((t0 + t1) / 2, yN + K.transeptRise - 0.1, (u0 + u1) / 2, t1 - t0, 0.5, 0.5, 0, C.copperGreen, { topColor: C.copperGreen });
    for (const [px, nx] of [[t0, -1], [t1, 1]]) {
      const pts = nx < 0 ? [[t0, u1], [t0, u0], [t0 + 1, u0], [t0 + 1, u1]] : [[t1, u0], [t1, u1], [t1 - 1, u1], [t1 - 1, u0]];    // a strip INSIDE the wall: its outer side is the outside of the building
      const f = edgeFrame(pts, 0);
      rose(soup, f, f.len / 2, yA + 7.5, 3.0, C.sandstoneLight, C.glassDark);
      lancet(soup, f, f.len / 2 - 4.5, yA + 2.0, 1.3, 4.2, C.sandstoneLight, C.glassDark);
      lancet(soup, f, f.len / 2 + 4.5, yA + 2.0, 1.3, 4.2, C.sandstoneLight, C.glassDark);
      void px;
    }
    // ---- the chevet: a half-octagon apse with a slate hip roof and three chapels on its faces (collision walls included)
    {
      const A = K.apse, [ax, az] = A.at, yE = yA + A.eaveAbove;
      const arc = Array.from({ length: A.faces + 1 }, (_, i) => { const a = (Math.PI * i) / A.faces; return [ax + Math.cos(a) * A.r, az + Math.sin(a) * A.r]; });
      const poly = [...arc, [ax - A.r, az - 1.0], [ax + A.r, az - 1.0]];
      soup.prism(poly, bottomsOf(ground, poly), yE, paint(C.cathedralStone, 63, 0.03), { top: false });
      walls.push(...edgeWalls(arc, 0.3, 'cathedral-apse'));
      const apex = [ax, yE + A.roofRise, az - 0.5];
      const rim = poly.map((p) => [p[0], yE, p[1]]);
      rim.forEach((p, i) => { const q = rim[(i + 1) % rim.length]; if (i >= A.faces) { soup.tri(p, q, apex, paint(C.slateRoof, 120 + i, 0.05)); return; } soup.tri(p, q, apex, paint(C.slateRoof, 120 + i, 0.05)); slateFace(soup, p, q, apex, apex, { ...CATHEDRAL_SLATE, key: 140 + i }); });
      for (let i = 0; i < A.faces; i++) {
        const f = edgeFrame([arc[i], arc[i + 1], [arc[i + 1][0], arc[i + 1][1] - 4], [arc[i][0], arc[i][1] - 4]], 0);
        course(soup, f, high - 0.4, high + 1.2, 0.35, C.sandstoneDark, 150 + i);                       // the plinth
        course(soup, f, yE - 0.8, yE, 0.45, C.sandstoneLight, 160 + i);                                // the cornice
        const mid = f.len / 2;
        if (i % 2 === 1) { const [x, , z] = f.at(mid, 0, A.chapel.depth / 2 + 0.2); const yc = yA + A.chapel.eaveAbove; soup.box(x, Math.min(ground(x, z), high) - 0.5, z, A.chapel.width, yc - (Math.min(ground(x, z), high) - 0.5), A.chapel.depth + 0.4, f.yaw, paint(C.cathedralStone, 170 + i, 0.03), { topColor: C.slateRoof });
          const q = (u, v) => { const p = f.at(mid + u, yc, v); return [p[0], p[2]]; };
          soup.pyramid([q(-A.chapel.width / 2 - 0.3, -0.1), q(A.chapel.width / 2 + 0.3, -0.1), q(A.chapel.width / 2 + 0.3, A.chapel.depth + 0.5), q(-A.chapel.width / 2 - 0.3, A.chapel.depth + 0.5)], yc, f.at(mid, yc + A.chapel.rise, A.chapel.depth / 2), paint(C.slateRoof, 180 + i, 0.05));
          walls.push(...edgeWalls([[x - f.dx * A.chapel.width / 2 + f.nx * A.chapel.depth / 2, z - f.dz * A.chapel.width / 2 + f.nz * A.chapel.depth / 2], [x + f.dx * A.chapel.width / 2 + f.nx * A.chapel.depth / 2, z + f.dz * A.chapel.width / 2 + f.nz * A.chapel.depth / 2]], 0.3, 'cathedral-chapel'));
          lancet(soup, { ...f, at: (s, y, out = 0) => f.at(s, y, out + A.chapel.depth + 0.4) }, mid, yA - 6.0, 1.1, 2.4, C.sandstoneLight, C.glassDark);
        } else lancet(soup, f, mid, high + 3.2, 1.6, yE - high - 8.5, C.sandstoneLight, C.glassDark);
      }
    }
    // ---- the walls of the aisles: a plinth, a cornice, buttresses with flying arches up to the clerestory, tall pointed windows between them
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 4) continue;
      const groundAt = (s) => { const q = f.at(s, 0, 0); return ground(q[0], q[2]); };
      course(soup, f, high - 0.6, high + 1.2, 0.35, C.sandstoneDark, e);                // the plinth
      course(soup, f, yA - 0.8, yA, 0.5, C.sandstoneLight, e + 7);                      // the cornice of the aisle
      joints(soup, f, { y0: high + 1.2, y1: yA - 0.8, rowH: 1.4, colW: 2.6, color: C.sandstoneDark, key: e * 37, vertical: false });
      const n = Math.max(1, Math.round(f.len / K.buttressPitch));
      for (let i = 0; i <= n; i++) {                                                // buttresses at both ends and between
        const s = (i / n) * f.len;
        const [x, , z] = f.at(s, 0, 0.45);
        const yb = Math.min(groundAt(s), high) - 0.5;
        soup.box(x, yb, z, 1.0, yA + 1.2 - yb, 0.9, f.yaw, paint(C.sandstoneLight, e * 11 + i), { topColor: C.sandstoneLight });
      }
      for (let i = 0; i < n; i++) {
        const sc = ((i + 0.5) / n) * f.len;
        lancet(soup, f, sc, high + 3.4, K.lancetW, K.lancetH - 2.5, C.sandstoneLight, C.glassDark);
      }
    }
    // ---- the west front (the north end): three stepped portals under a gallery of lancets and a big window, in a stone gable between the towers
    const front = b.pts.map((_, i) => edgeFrame(b.pts, i)).filter((f) => f.len > 10 && Math.abs(f.nz) > 0.8 && f.nz < 0).sort((p, q) => q.len - p.len)[0];
    if (front) {
      const mid = front.len / 2;
      portal(soup, front, mid, high, 3.4, 6.4, C.sandstoneLight, C.glassDark);
      portal(soup, front, mid - 3.9, high, 1.5, 3.8, C.sandstoneLight, C.glassDark);
      portal(soup, front, mid + 3.9, high, 1.5, 3.8, C.sandstoneLight, C.glassDark);
      course(soup, front, high + 11.6, high + 12.2, 0.4, C.sandstoneLight, 90);
      for (let k = -2; k <= 2; k++) lancet(soup, front, mid + k * 1.5, high + 13.0, 0.8, 3.6, C.sandstoneLight, C.glassDark);   // the gallery
      lancet(soup, front, mid, high + 19.6, 3.2, 7.2, C.sandstoneLight, C.glassDark);                                         // the big window
      rose(soup, front, mid, high + 31.2, 1.7, C.sandstoneLight, C.glassDark);
      stoneGable(soup, front, mid - 6.6, mid + 6.6, yN, K.naveRise, C.cathedralStone);
    }
    for (const t of K.frontTowers) cathedralTower(soup, ground, high, t, K);
    // ---- the crossing: the high hipped roof with the green copper needle on its apex (lantern, balcony, needle)
    const [cx, cz] = K.crossing, h = K.crossingHalf, yBase = yN + K.transeptRise * 0.35, yApex = yN + K.crossingRise + K.transeptRise * 0.35;
    soup.pyramid([[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]], yBase, [cx, yApex, cz], C.slateRoof);
    { const cs = [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]], apex = [cx, yApex, cz];
      cs.forEach((p, i) => { const q = cs[(i + 1) % 4]; slateFace(soup, [p[0], yBase, p[1]], [q[0], yBase, q[1]], apex, apex, { ...CATHEDRAL_SLATE, key: 100 + i }); }); }
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
  frontMinLength: 8, frontDistance: 3,           // an edge of the outline is part of the front when it is longer than this and its middle lies within this of the street
});

/** The nearest point of a road named `name` to (x, z): { d, dx, dz } (the vector to it); d is Infinity when there is no such road. */
function nearestStreet(roads, name, x, z) {
  let d = Infinity, dx = 0, dz = 0;
  for (const r of roads) {
    if (!r.name || !name.test(r.name)) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
      const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / ll)) : 0;
      const h = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      if (h < d) { d = h; dx = ax + ex * t - x; dz = az + ez * t - z; }
    }
  }
  return { d, dx, dz };
}

export function buildPalais({ buildings, ground, roads = [] }) {
  const K = PALAIS;
  const hidden = requireBlocks(buildings, 'Palais grand-ducal', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const walls = [];
  const info = { blocks: hidden.length, fronts: [] };
  // The front is not one edge: the OSM / LOD2 outline of the palace turns twice along the Rue du Marché-aux-Herbes (a 31 m, a 16 m and, in the neighbouring block, a 19 m run:
  // about 65 m in all).  Every long edge whose middle is within FRONT_DISTANCE of the street gets the Renaissance front.
  const fronts = [];
  for (const b of hidden) {
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      const mx = (f.a[0] + f.b[0]) / 2, mz = (f.a[1] + f.b[1]) / 2;
      if (f.len <= K.frontMinLength) continue;
      const st = nearestStreet(roads, K.streetName, mx, mz);
      if (st.d < K.frontDistance) fronts.push({ f, b, mx, mz });                   // the street runs right along the wall (the middle of the edge is within 1 m of its centre line)
    }
  }
  if (!fronts.length) throw new Error('Palais: no edge of the outline lies on the Marché-aux-Herbes: the footprint or the street moved');
  // The whole front is ONE straight facade: the three runs of the outline lie within a metre of the line through the two farthest corners (measured: 0.3 and 0.6 m),
  // so the facade stands on that line (`FRONT_FILL` in front of it) with a block of stone behind it that closes the gaps to the three walls.
  const corners = fronts.flatMap((p) => [p.f.a, p.f.b]);
  let cornerA = corners[0], cornerB = corners[0], far = -1;
  for (const p of corners) for (const q of corners) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > far) { far = d; cornerA = p; cornerB = q; } }
  const all = hidden.flatMap((b) => b.pts);
  const centre = [all.reduce((t, p) => t + p[0], 0) / all.length, all.reduce((t, p) => t + p[1], 0) / all.length];
  const line = lineFrame(cornerA, cornerB, centre);
  let bulge = 0, hollow = 0;                                                      // how far the outline stands out of the straight line / lies behind it
  for (const p of corners) { const o = (p[0] - line.a[0]) * line.nx + (p[1] - line.a[1]) * line.nz; bulge = Math.max(bulge, o); hollow = Math.min(hollow, o); }
  const straight = lineFrame(cornerA, cornerB, centre, bulge + FRONT_FILL);
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
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 5) continue;
      const isFront = fronts.some((p) => p.f.a === f.a || (p.f.a[0] === f.a[0] && p.f.a[1] === f.a[1] && p.f.b[0] === f.b[0]));
      if (isFront) continue;                                                          // the front gets its own straight facade below
      course(soup, f, high + 0.0, high + 0.9, 0.25, C.stoneBand, e);                    // the plinth
      course(soup, f, yEave - 0.7, yEave, 0.6, C.sandstoneLight, e + 40);              // the cornice
      for (let r = 1; r <= 2; r++) course(soup, f, high + r * K.floor - 0.2, high + r * K.floor + 0.2, 0.2, C.stoneBand, e + r * 5);
      if (f.len > 9) windowGrid(soup, f, { s0: 2.5, s1: f.len - 2.5, y0: high + 1.0, rows: 3, floorH: K.floor, w: K.windowW, h: K.windowH, pitch: K.windowPitch, frame: C.sandstoneLight, glass: C.glassDark, key: 100 + e * 7 });
    }
  }
  // the straight facade over all three runs: a stone block behind it (from the deepest hollow to the plane), the Renaissance front, the cornice, the plinth
  {
    const mid = straight.at(straight.len / 2, 0, 0);
    const high = Math.max(...fronts.map((p) => groundRange(ground, p.b.pts).high));
    const yEave = high + K.eave;
    const along = (s) => { const q = straight.at(s, 0, 0); return ground(q[0], q[2]); };
    const lowFoot = Math.min(along(0), along(straight.len / 2), along(straight.len));
    const base = { ...straight, at: (s, y, out = 0) => straight.at(s, y, out - (bulge + FRONT_FILL)) };      // the frame of the line itself
    slab(soup, base, 0, straight.len, lowFoot - 1.0, yEave, bulge + FRONT_FILL - hollow + 0.05, paint(C.palaisStone, 3, 0.03), { out0: hollow - 0.05, topColor: C.palaisStone });
    course(soup, straight, lowFoot - 1.0, high + 0.9, 0.25, C.stoneBand, 1);                                  // the plinth
    course(soup, straight, yEave - 0.7, yEave, 0.7, C.sandstoneLight, 41);                                    // the cornice
    const front = renaissanceFront(soup, straight, { high, yEave, floor: K.floor, ground: along, key: Math.round(straight.a[0] * 3 + straight.a[1]), sentries: false });
    info.fronts.push({ len: +straight.len.toFixed(1), columns: front.columns.length, oriels: front.columns.filter((c) => c.kind === 'oriel').length, bulge: +bulge.toFixed(2), hollow: +hollow.toFixed(2), mid: mid.map(Math.round) });
    // the dormers above the front: a stone box with a dark window and a little pointed gable (same rhythm as the windows)
    const dc = Math.abs((centre[0] - straight.a[0]) * straight.nx + (centre[1] - straight.a[1]) * straight.nz) - bulge - FRONT_FILL;
    const D = (1 - K.roofScale) * dc;
    const inset = 1.2, yBase = D > 2.5 ? yEave + K.roofRise * (inset / D) : yEave + 1.0;
    for (const c of front.columns) {
      if (c.kind === 'oriel') continue;
      const s = c.sc;
      const [x, , z] = straight.at(s, 0, -inset);
      soup.box(x, yBase - 0.3, z, 1.9, 2.6, 1.3, straight.yaw, paint(C.palaisStone, Math.round(s), 0.04), { topColor: C.palaisStone });
      panel(soup, straight, s - 0.6, s + 0.6, yBase + 0.2, yBase + 2.0, -inset + 0.68, C.glassDark);
      soup.tri(straight.at(s - 1.1, yBase + 2.3, -inset + 0.67), straight.at(s + 1.1, yBase + 2.3, -inset + 0.67), straight.at(s, yBase + 4.3, -inset + 0.67), paint(C.slateBlack, Math.round(s), 0.05));
      soup.frustum(straight.at(s, 0, -inset + 0.4)[0], straight.at(s, 0, -inset + 0.4)[2], 0.12, 0.0, yBase + 4.0, yBase + 5.6, 4, C.slateBlack, { cap: false });       // the finial
    }
    // slender spires on the ridge line (the photographs: a pencil spire every ~13 m between the dormers, taller at the corners): a stone base, a needle of slate and a gold tip
    for (let s = PINNACLE_PITCH / 2; s < straight.len; s += PINNACLE_PITCH) {
      const [x, , z] = straight.at(s, 0, -inset - 0.5);
      soup.frustum(x, z, 0.5, 0.42, yBase + 0.2, yBase + 2.6, 8, paint(C.palaisStone, Math.round(s * 3), 0.03), { cap: false });
      soup.frustum(x, z, 0.62, 0.05, yBase + 2.6, yBase + 9.0, 8, C.slateBlack, { cap: false });
      soup.frustum(x, z, 0.07, 0.0, yBase + 9.0, yBase + 10.0, 4, C.gold, { cap: false });
    }
    // the turrets: round corbelled towers with tall slate spires at the two ends of the whole front (the photographs: the spired corners)
    for (const sc of [0.8, straight.len - 0.8]) {
      const [x, , z] = straight.at(sc, 0, -TURRET_SET_BACK);
      turret(soup, x, z, K.turretR, high + 5.5, yEave + 1.0, yEave + 16, paint(C.palaisStone, 77, 0.03), C.slateBlack);
      soup.frustum(x, z, K.turretR * 0.55, K.turretR, high + 3.6, high + 5.5, 8, C.sandstoneDark, { cap: false });
      for (let y = high + 6.5; y < yEave; y += 3.2) soup.box(x + straight.nx * K.turretR * 0.98, y, z + straight.nz * K.turretR * 0.98, 0.5, 1.4, 0.15, straight.yaw, C.glassDark);                // a window on every floor
      soup.frustum(x, z, 0.1, 0.0, yEave + 16, yEave + 18.2, 4, C.gold, { cap: false });
    }
    // the sentry boxes and the bollards stand on a raised granite strip along the foot of the wall.  The street of the data runs right along the wall (its centre line is within a metre of
    // the façade: no pavement is left in front of it), so the strip is a kerbed pavement of 1.7 m laid over the edge of the carriageway; no collision (the street stays open).
    const stripTop = 0.16, stripWidth = STRIP_WIDTH;
    for (let s = 0; s < straight.len; s += 4) {
      const s1 = Math.min(straight.len, s + 4), q = straight.at(s, 0, stripWidth / 2), q1 = straight.at(s1, 0, stripWidth / 2);
      const y0 = Math.min(ground(q[0], q[2]), ground(q1[0], q1[2])) - 0.15;
      slab(soup, straight, s, s1, y0, Math.max(y0 + 0.2, ground(q[0], q[2]) + stripTop), stripWidth, paint(C.paving, Math.round(s) + 9, 0.05), { topColor: C.paving });
    }
    const yStrip = (s) => { const q = straight.at(s, 0, stripWidth / 2); return ground(q[0], q[2]) + stripTop; };
    for (const sc of [3.6, straight.len - 3.6]) sentryBox(soup, straight, sc, yStrip(sc), SENTRY_OUT);
    for (let s = 6.5; s < straight.len - 5; s += 3.1) bollard(soup, straight, s, yStrip(s), STRIP_WIDTH - 0.5, Math.round(s * 5));
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
