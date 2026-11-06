/* The paint of the ground as the shader decides it (ground-shader.js, the road part), in Node: the harness checks the very arrays the GPU interpolates (tile-mesh.js buildTileMesh)
 * with the very rules the fragment shader applies to them.  Keep the two in step: every rule here has its line in GROUND_FRAGMENT.
 * Pure: reads a built tile mesh, returns plain numbers. */
import { QUADTREE, ROAD } from './config.js';
import { diagonalIsMain } from './surface.js';
import { PAINT_CODE } from './road-network.js';

const MEDIAN_WIDTH = 3.0;        // m: ground-shader.js MEDIAN_WIDTH
const PAVE_MAX = 5.0;            // m: ground-shader.js PAVE_MAX
const AA = 0.04;                 // m: the narrowest edge blend of the shader (max(fwidth, 0.04)): the edges seen from close by
const FAR = 30;                  // m: "no street near" (ground-shader.js dS)

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A value of a per-vertex attribute of a built tile mesh at a world point, interpolated over the triangle exactly as the GPU does (the diagonal rule of the lattice). */
export function meshAttrAt(mesh, arr, stride, c, x, z) {
  const cells = QUADTREE.cells, side = cells + 1;
  const lx = (x - mesh.x0) / mesh.step, lz = (z - mesh.z0) / mesh.step;
  const i = Math.min(cells - 1, Math.max(0, Math.floor(lx))), j = Math.min(cells - 1, Math.max(0, Math.floor(lz)));
  const fx = lx - i, fz = lz - j;
  const a = j * side + i, b = a + 1, cc = a + side, d = cc + 1;
  const va = arr[a * stride + c], vb = arr[b * stride + c], vc = arr[cc * stride + c], vd = arr[d * stride + c];
  const gi = Math.round(mesh.x0 / mesh.step) + i, gj = Math.round(mesh.z0 / mesh.step) + j;
  if (diagonalIsMain(gi, gj)) return fx >= fz ? va + (vb - va) * fx + (vd - vb) * fz : va + (vd - vc) * fx + (vc - va) * fz;
  return fx + fz <= 1 ? va + (vb - va) * fx + (vc - va) * fz : vd + (vc - vd) * (1 - fx) + (vb - vd) * (1 - fz);
}

/** The varyings of the paint at a world point: { road (codes), road2, road3, road4, road5, ny } (arrays of 4, as the fragment shader receives them). */
export function varyingsAt(mesh, x, z) {
  const v = (arr) => [0, 1, 2, 3].map((c) => meshAttrAt(mesh, arr, 4, c, x, z));
  return { road: v(mesh.road), road2: v(mesh.road2), road3: v(mesh.road3), road4: v(mesh.road4), road5: v(mesh.road5), ny: meshAttrAt(mesh, mesh.normals, 3, 1, x, z) };
}

const pickMin = (d, m) => { let k = 0; for (let c = 1; c < 4; c++) if (d[c] < d[k]) k = c; return m[k]; };
const gapOf = (a, b) => (a > 0 && b > 0 ? a + b : 99);

/**
 * The road paint of the shader from its varyings (ground-shader.js, "the road"): the signed distances of the edges (sdC carriageway, sdP pavement, chS the nearest street), the
 * materials (matNear, matStreet, the one painted: mat), the shares of carriageway / kerb / pavement (on*), the pale tar of the minor ways (minorW) and the weight of the channels.
 * `aa`: the width of the edge blend (the shader's fwidth, at least 4 cm).
 */
export function paintOf(v, aa = AA) {
  const dC = v.road4;
  const isCar = v.road.map((c) => (c >= PAINT_CODE.car - 0.5 ? 1 : 0));
  const isStreet = v.road.map((c, k) => (c - PAINT_CODE.car * isCar[k] >= PAINT_CODE.street - 0.5 ? 1 : 0));
  const mat = v.road.map((c, k) => c - PAINT_CODE.car * isCar[k] - PAINT_CODE.street * isStreet[k]);
  const chC = Math.min(...dC);
  const restC = v.road3[0], restMat = v.road2[2];
  const sdC = Math.min(chC, restC);
  const medianP = Math.min(gapOf(dC[0], dC[1]), gapOf(dC[0], dC[2]), gapOf(dC[0], dC[3]), gapOf(dC[1], dC[2]), gapOf(dC[1], dC[3]), gapOf(dC[2], dC[3])) - MEDIAN_WIDTH;
  const sdP = Math.min(...v.road5, medianP, v.road3[1]);
  const roadW = smoothstep(0, 0.5, v.road3[2]);
  const dS = dC.map((d, k) => (isStreet[k] ? d : FAR)), dR = dC.map((d, k) => (isCar[k] ? d : FAR));
  const chS = Math.min(...dS), chR = Math.min(...dR);
  const matStreet = pickMin(dS, mat), matRoad = pickMin(dR, mat), matNear = pickMin(dC, mat);
  const inStreet = 1 - smoothstep(-aa, aa, chS), inRoad = 1 - smoothstep(-aa, aa, chR);
  const inRest = 1 - smoothstep(-aa, aa, restC - chC);
  const inRestStreet = (1 - smoothstep(-aa, aa, v.road3[3])) * (1 - inStreet);
  const matOwn = inRest >= 0.5 ? restMat : inRoad >= 0.5 ? matRoad : matNear;
  const matK = inRest >= 0.5 ? restMat : matNear;
  const kerbW = matK < 2.5 ? ROAD.kerbWidth : 0;
  const onCarriage = 1 - smoothstep(-aa, aa, sdC);
  const minorW = (1 - inStreet) * (1 - inRestStreet) * (matOwn <= 0.5 ? 1 : 0) * (roadW >= 0.5 ? 1 : 0);
  let onKerb = (1 - onCarriage) * (1 - smoothstep(kerbW - aa, kerbW + aa, sdC));
  const kerbR = matRoad < 2.5 && matOwn > 0.5 ? ROAD.kerbWidth : 0;
  onKerb = Math.max(onKerb, onCarriage * (1 - inRoad) * (1 - smoothstep(kerbR - aa, kerbR + aa, chR)));
  let onPave = smoothstep(kerbW - aa, kerbW + aa, sdC) * (1 - smoothstep(-aa, aa, sdP));
  const levelK = smoothstep(0.86, 0.95, v.ny);
  onKerb *= levelK; onPave *= levelK;
  onPave *= 1 - smoothstep(PAVE_MAX, PAVE_MAX + 0.6, sdC - kerbW);
  // the material painted (the larger share; the shader blends the colours over the edge pixel)
  const mat0 = inStreet >= 0.5 ? matStreet : inRestStreet >= 0.5 ? restMat : matOwn;
  // the tone: 1 the dark tar of a street, 0 the pale tar of a minor way (on tarmac only)
  return { sdC, sdP, chS, chR, restC, matNear, matStreet, matRoad, restMat, mat: mat0, inStreet, inRoad, inRest, inRestStreet, minorW, onCarriage, onKerb, onPave, levelK, kerbW, roadW };
}

/** The signed distance to the carriageways as the shader paints it: the minimum of the channels and of the rest. */
export function paintedSd(mesh, x, z) {
  let m = meshAttrAt(mesh, mesh.road3, 4, 0, x, z);
  for (let c = 0; c < 4; c++) m = Math.min(m, meshAttrAt(mesh, mesh.road4, 4, c, x, z));
  return m;
}

/** The paint at a world point of a built tile mesh. */
export function paintAt(mesh, x, z, aa = AA) { return paintOf(varyingsAt(mesh, x, z), aa); }
