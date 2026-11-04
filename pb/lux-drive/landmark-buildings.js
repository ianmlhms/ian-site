/* The famous buildings of Luxembourg as hand-made low-poly models: the Philharmonie, the towers of the Cour de justice, the
 * Cathedral Notre-Dame, the Palais grand-ducal and the Gëlle Fra.
 *
 * Each model REPLACES the generic LOD2 blocks of its footprint (it returns their ids in `hideBuildings`) and stands on the
 * ground: the walls reach down to the ground at every corner (never a floating floor), and the edges of the footprints are
 * collision walls of the car.  Returns { soup, walls, hideBuildings, info }. */
import { Soup, paint } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { requireBlocks, edgeWalls, scalePoly, insidePoly, groundRange } from './landmark-util.js';

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
  soup.pyramid(scalePoly(pts, 1.12), yWall, [cx, yTip, cz], roof);
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
const PHILHARMONIE = Object.freeze({
  at: [5958, 7990], hideRadius: 40, hideMinArea: 1500,   // the block of the bake (the elliptical hall) is found here
  centre: [5962, 7992], rx: 33, rz: 51, yaw: 0.12,       // m, the ellipse of the colonnade
  columns: 60, columnSize: 0.55, columnHeight: 25,
  drumInset: 3.2, roofThickness: 1.4, podium: 1.0,
});

export function buildPhilharmonie({ buildings, ground }) {
  const K = PHILHARMONIE;
  const hidden = requireBlocks(buildings, 'Philharmonie', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const [cx, cz] = K.centre;
  const ring = ellipse(cx, cz, K.rx, K.rz, 48, K.yaw);
  const { high } = groundRange(ground, ring);
  const y0 = high + K.podium;
  // the podium (it reaches the ground all round), the glass drum, the columns, the roof
  soup.prism(ring, bottomsOf(ground, ring), y0, C.concrete, { topColor: C.paving });
  const drum = ellipse(cx, cz, K.rx - K.drumInset, K.rz - K.drumInset, 40, K.yaw);
  soup.prism(drum, y0, y0 + K.columnHeight - 1, C.glassBlue, { top: false });
  const colonnade = ellipse(cx, cz, K.rx - 0.8, K.rz - 0.8, K.columns, K.yaw);
  for (const [i, p] of colonnade.entries()) {
    soup.box(p[0], y0, p[1], K.columnSize, K.columnHeight, K.columnSize, K.yaw, paint(C.white, i, 0.02), { topColor: C.white });
  }
  const roofOuter = ellipse(cx, cz, K.rx + 1.2, K.rz + 1.2, 48, K.yaw);
  soup.prism(roofOuter, y0 + K.columnHeight, y0 + K.columnHeight + K.roofThickness, C.white, { topColor: paint(C.white, 9, 0.02) });
  const roofInner = ellipse(cx, cz, K.rx - 10, K.rz - 14, 32, K.yaw);
  soup.prism(roofInner, y0 + K.columnHeight + K.roofThickness, y0 + K.columnHeight + K.roofThickness + 2.2, C.concrete, { topColor: C.paving });
  return { soup, walls: edgeWalls(ellipse(cx, cz, K.rx + 1.0, K.rz + 1.0, 32, K.yaw), 0.5, 'philharmonie'), hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length, y0 } };
}

/* ------------------------------------------------------------------------------------------------ Cour de justice */
const ECJ = Object.freeze({
  at: [5850, 7740], hideRadius: 160, hideMinArea: 1500,
  towers: [{ at: [5840, 7672], side: 30, floors: 29 }, { at: [5870, 7650], side: 30, floors: 29 }, { at: [5900, 7690], side: 34, floors: 36 }],
  floor: 3.5,
  podiumHeight: 16,
});

export function buildEcj({ buildings, ground }) {
  const K = ECJ;
  const hidden = requireBlocks(buildings, 'Cour de justice', K.at[0], K.at[1], K.hideRadius, K.hideMinArea, 2);
  const soup = new Soup();
  // the podium: the footprints of the bake, lower and bronze coloured (the real complex is a gold-bronze ring of halls)
  for (const [i, b] of hidden.entries()) {
    const { high } = groundRange(ground, b.pts);
    block(soup, ground, b.pts, high + Math.min(K.podiumHeight, 6 + (i % 3) * 4), paint(C.bronzeDark, i, 0.05), C.concreteDark);
  }
  // the towers: floors of glass between bronze slabs, a plant room on top
  const info = [];
  for (const [ti, t] of K.towers.entries()) {
    const host = hidden.find((b) => insidePoly(b.pts, t.at[0], t.at[1]));
    if (!host) throw new Error(`Cour de justice: tower ${ti} at (${t.at}) stands on none of the replaced blocks`);
    const h = t.side / 2;
    const yaw = 0.77;                          // along the long edge of the complex (the diamond of the bake)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const poly = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => [t.at[0] + x * c - z * s, t.at[1] + x * s + z * c]);
    const { high } = groundRange(ground, poly);
    const y0 = high + Math.min(K.podiumHeight, 6);
    for (let f = 0; f < t.floors; f++) {
      const ya = y0 + f * K.floor;
      soup.prism(poly, ya, ya + K.floor * 0.28, paint(C.bronze, f * 7 + ti, 0.04), { top: false });
      soup.prism(poly, ya + K.floor * 0.28, ya + K.floor, paint(C.glassDark, f * 5 + ti, 0.06), { top: false });
    }
    const yTop = y0 + t.floors * K.floor;
    soup.prism(scalePoly(poly, 0.7), yTop, yTop + 4, C.bronzeDark, { topColor: C.concreteDark });
    soup.prism(poly, yTop - 0.2, yTop + 0.2, C.bronze, { topColor: C.concreteDark });
    info.push({ tower: ti, top: Math.round(yTop - high) });
  }
  const walls = hidden.flatMap((b) => edgeWalls(b.pts, 0.3, 'ecj'));
  return { soup, walls, hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length, towers: info } };
}

/* ------------------------------------------------------------------------------------------------ Cathédrale Notre-Dame */
const CATHEDRAL = Object.freeze({
  at: [5164, 8965], hideRadius: 30, hideMinArea: 800,
  nave: [5154, 5178, 8929, 8976],          // m: x0, x1, z0, z1 of the narrow nave (north)
  transept: [5142, 5185, 8975, 9008],      // m: the wide part (south)
  eave: 19, naveRise: 9, transeptRise: 8,
  frontTowers: [[5158, 8936], [5174, 8936]], towerHalf: 3.2, towerWall: 34, towerTip: 54,
  crossing: [5163, 8987], crossingWall: 30, crossingTip: 66,
});

export function buildCathedral({ buildings, ground }) {
  const K = CATHEDRAL;
  const hidden = requireBlocks(buildings, 'Cathédrale', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const walls = [];
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    block(soup, ground, b.pts, high + K.eave, paint(C.limestone, b.id, 0.04), C.slate);
    walls.push(...edgeWalls(b.pts, 0.3, 'cathedral'));
    const [t0, t1, u0, u1] = K.transept;
    gable(soup, K.nave[0], K.nave[1], K.nave[2], K.nave[3], high + K.eave, K.naveRise, true, C.slate);
    gable(soup, t0, t1, u0, u1, high + K.eave, K.transeptRise, false, C.slate);
    // the wall is not blank: buttresses and tall pointed windows along the nave, a portal in the front
    const [a0, a1, b0, b1] = K.nave;
    for (const side of [a0, a1]) {
      const out = side === a0 ? -0.9 : 0.9;
      for (let z = b0 + 5; z < b1 - 3; z += 6) {
        soup.box(side + out / 2, high - 0.5, z, 0.9, K.eave + 0.5, 1.1, 0, paint(C.sandstoneLight, Math.round(z)));
        soup.box(side + out * 0.45 + (side === a0 ? -0.05 : 0.05), high + 5, z + 3, 0.2, 9, 1.8, 0, C.glassDark);
      }
    }
    soup.box((a0 + a1) / 2, high - 0.5, b0 - 0.6, 6, 8, 1.2, 0, C.sandstoneLight);
    soup.box((a0 + a1) / 2, high + 0.2, b0 - 1.25, 2.4, 5, 0.2, 0, C.glassDark);
    for (const [x, z] of K.frontTowers) spireTower(soup, ground, x, z, K.towerHalf, high + K.towerWall, high + K.towerTip, C.limestone, C.copperGreen);
    // the spire over the crossing: an octagon with a very tall needle
    const [cx, cz] = K.crossing;
    soup.frustum(cx, cz, 3.6, 3.0, high + K.eave, high + K.crossingWall, 8, C.limestone, { cap: false });
    soup.frustum(cx, cz, 3.4, 0.0, high + K.crossingWall, high + K.crossingTip, 8, C.copperGreen, { yaw: TAU / 16 });
  }
  return { soup, walls, hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length } };
}

/* ------------------------------------------------------------------------------------------------ Palais grand-ducal */
const PALAIS = Object.freeze({
  at: [5265, 8815], hideRadius: 45, hideMinArea: 300,
  eave: 14, roofRise: 5.5, tower: { half: 3.0, wall: 26, tip: 38 },
});

export function buildPalais({ buildings, ground }) {
  const K = PALAIS;
  const hidden = requireBlocks(buildings, 'Palais grand-ducal', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  const walls = [];
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    const yEave = high + K.eave;
    soup.prism(b.pts, bottomsOf(ground, b.pts), yEave, paint(C.sandstoneLight, b.id, 0.04), { top: false });
    // a mansard roof of slate: the eave outline drawn smaller, then a flat crown
    const lower = scalePoly(b.pts, 1.0), upper = scalePoly(b.pts, 0.78);
    for (let i = 0; i < lower.length; i++) {
      const j = (i + 1) % lower.length;
      soup.quad([lower[i][0], yEave, lower[i][1]], [lower[j][0], yEave, lower[j][1]], [upper[j][0], yEave + K.roofRise, upper[j][1]], [upper[i][0], yEave + K.roofRise, upper[i][1]], paint(C.slate, i + 5, 0.06));
    }
    soup.prism(upper, yEave + K.roofRise, yEave + K.roofRise + 0.1, C.slate, { top: true });
    walls.push(...edgeWalls(b.pts, 0.3, 'palais'));
    if (b === hidden[0]) {
      const p = b.pts[0];
      spireTower(soup, ground, p[0] - 4, p[1] - 3, K.tower.half, high + K.tower.wall, high + K.tower.tip, C.sandstone, C.slate);
    }
  }
  return { soup, walls, hideBuildings: hidden.map((b) => b.id), info: { blocks: hidden.length } };
}

/* ------------------------------------------------------------------------------------------------ Gëlle Fra */
const GELLE_FRA = Object.freeze({
  at: [4970, 8985], baseHalf: 4.0, baseHeight: 3.2, shaftBottomHalf: 1.9, shaftTopHalf: 1.0, shaftHeight: 17.5, figureHeight: 3.2,
});

export function buildGelleFra({ ground }) {
  const K = GELLE_FRA;
  const [x, z] = K.at;
  const soup = new Soup();
  const foot = [[-K.baseHalf, -K.baseHalf], [K.baseHalf, -K.baseHalf], [K.baseHalf, K.baseHalf], [-K.baseHalf, K.baseHalf]].map(([a, b]) => [x + a, z + b]);
  const { high } = groundRange(ground, foot);
  soup.prism(foot, bottomsOf(ground, foot), high + 0.8, C.sandstoneLight, { topColor: C.sandstone });
  const step = [[-3.2, -3.2], [3.2, -3.2], [3.2, 3.2], [-3.2, 3.2]].map(([a, b]) => [x + a, z + b]);
  soup.prism(step, high + 0.8, high + K.baseHeight, C.sandstone, { topColor: C.sandstoneLight });
  const y1 = high + K.baseHeight;
  soup.frustum(x, z, K.shaftBottomHalf * 1.414, K.shaftTopHalf * 1.414, y1, y1 + K.shaftHeight, 4, C.sandstoneLight, { yaw: Math.PI / 4, capColor: C.sandstone });
  const yTop = y1 + K.shaftHeight;
  // the golden woman: a long robe, a body, a head and the raised wreath
  soup.frustum(x, z, 0.75, 0.45, yTop, yTop + 1.7, 8, C.gold);
  soup.frustum(x, z, 0.5, 0.38, yTop + 1.7, yTop + 2.6, 8, C.gold);
  soup.frustum(x, z, 0.28, 0.0, yTop + 2.6, yTop + 3.2, 8, paint(C.gold, 3, 0.05));
  soup.box(x + 0.9, yTop + 2.3, z, 1.6, 0.18, 0.18, 0.3, C.gold);                 // the arm with the wreath
  return { soup, walls: [{ ax: x - 4, az: z, bx: x + 4, bz: z, r: 1.0, id: 'gelle-fra' }], hideBuildings: [], info: { top: Math.round(yTop + K.figureHeight - high) } };
}

/* ------------------------------------------------------------------------------------------------ Oberanven church */
const OBERANVEN = Object.freeze({ at: [13285, 3652], hideRadius: 8, hideMinArea: 150, eave: 9, rise: 5.5, tower: { half: 2.6, wall: 17, tip: 29 } });

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
