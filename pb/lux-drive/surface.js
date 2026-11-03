/* The physics surface: the 1 m lattice of height(x, z), triangulated with a fixed rule, read by the car, the camera,
 * the city and the harness.  The LOD 0 render tiles are built from the very same lattice blocks (32 m blocks, an apron
 * of one node), so for the tiles around the car "what you see" and "what you drive on" are the same numbers.
 * A block is computed once and cached (LRU); the function is defined everywhere.
 *
 * Every node also carries the road it belongs to: the coverage, the signed offset from the centre line, the half width
 * of the carriageway, the outer edge of the pavement and the class of the road.  The car reads them to know whether it
 * is on the tarmac, on the kerb or off the road, and the shader reads them to paint the road. */
import { QUADTREE } from './config.js';

export const BLOCK = QUADTREE.minSize;            // 32 m: one LOD 0 tile
const APRON = 1;
const SIDE = BLOCK + 1 + 2 * APRON;               // nodes per row incl. the apron
const MAX_BLOCKS = 600;

/** Triangulation rule shared by the surface and the render index buffer: the quad (i, j) of the GLOBAL 1 m lattice is
 *  split along 00-11 when (i + j) is even, along 10-01 when odd. Returns true when the diagonal is 00-11. */
export const diagonalIsMain = (gi, gj) => (((gi + gj) % 2) + 2) % 2 === 0;

export function createSurface(field) {
  const blocks = new Map();
  const key = (bx, bz) => bx * 100003 + bz;

  function block(bx, bz) {
    const k = key(bx, bz);
    let b = blocks.get(k);
    if (b) { blocks.delete(k); blocks.set(k, b); return b; }      // refresh LRU order
    const h = new Float32Array(SIDE * SIDE);
    const cover = new Float32Array(SIDE * SIDE);        // how much of the road network shapes this node (0..1)
    const lat = new Float32Array(SIDE * SIDE);           // the signed offset from the centre line of that road
    const hw = new Float32Array(SIDE * SIDE);            // the half width of its carriageway
    const a0 = new Float32Array(SIDE * SIDE);            // the outer edge of its pavement
    const kind = new Uint8Array(SIDE * SIDE);           // the class of that road
    const road = new Int32Array(SIDE * SIDE);            // its index in the road list (-1: no road)
    const lines = new Uint8Array(SIDE * SIDE);           // the style of its lane markings
    const lanes = new Uint8Array(SIDE * SIDE);           // how many lanes it has
    const along = new Float32Array(SIDE * SIDE);         // the distance along its centre line
    const x0 = bx * BLOCK, z0 = bz * BLOCK;
    const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, lines: 0, lanes: 0, s: 0 };
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const o = j * SIDE + i;
        h[o] = field.height(x0 + i - APRON, z0 + j - APRON, info);
        cover[o] = info.coverage; lat[o] = info.lat; hw[o] = info.hw; a0[o] = info.a0;
        kind[o] = info.kind; road[o] = info.road; lines[o] = info.lines;
        lanes[o] = info.lanes; along[o] = info.s;
      }
    }
    b = { bx, bz, x0, z0, h, cover, lat, hw, a0, kind, road, lines, lanes, along, side: SIDE, apron: APRON };
    blocks.set(k, b);
    if (blocks.size > MAX_BLOCKS) blocks.delete(blocks.keys().next().value);
    return b;
  }

  /** Height of the triangulated lattice at (x, z). */
  function height(x, z) {
    const gx = Math.floor(x), gz = Math.floor(z);
    const fx = x - gx, fz = z - gz;
    const bx = Math.floor(gx / BLOCK), bz = Math.floor(gz / BLOCK);
    const b = block(bx, bz);
    const i = gx - bx * BLOCK + APRON, j = gz - bz * BLOCK + APRON;
    const h = b.h;
    const h00 = h[j * SIDE + i], h10 = h[j * SIDE + i + 1], h01 = h[(j + 1) * SIDE + i], h11 = h[(j + 1) * SIDE + i + 1];
    if (diagonalIsMain(gx, gz)) {
      return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    }
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Unit normal of the triangle under (x, z), written into out = {x, y, z}. */
  function normal(x, z, out) {
    const gx = Math.floor(x), gz = Math.floor(z);
    const fx = x - gx, fz = z - gz;
    const bx = Math.floor(gx / BLOCK), bz = Math.floor(gz / BLOCK);
    const b = block(bx, bz);
    const i = gx - bx * BLOCK + APRON, j = gz - bz * BLOCK + APRON;
    const h = b.h;
    const h00 = h[j * SIDE + i], h10 = h[j * SIDE + i + 1], h01 = h[(j + 1) * SIDE + i], h11 = h[(j + 1) * SIDE + i + 1];
    let dx, dz;                       // slope along +x and +z of the triangle
    if (diagonalIsMain(gx, gz)) {
      if (fx >= fz) { dx = h10 - h00; dz = h11 - h10; } else { dx = h11 - h01; dz = h01 - h00; }
    } else if (fx + fz <= 1) { dx = h10 - h00; dz = h01 - h00; } else { dx = h11 - h01; dz = h11 - h10; }
    const len = Math.hypot(dx, 1, dz);
    out.x = -dx / len; out.y = 1 / len; out.z = -dz / len;
    return out;
  }

  /** The road at (x, z), read from the nearest lattice node: { coverage, lat, hw, a0, kind, road, lines, lanes, s }. */
  function roadInfoAt(x, z, out) {
    const gx = Math.floor(x), gz = Math.floor(z);
    const bx = Math.floor(gx / BLOCK), bz = Math.floor(gz / BLOCK);
    const b = block(bx, bz);
    const i = gx - bx * BLOCK + APRON, j = gz - bz * BLOCK + APRON;
    const o = j * SIDE + i;
    out.coverage = b.cover[o]; out.lat = b.lat[o]; out.hw = b.hw[o]; out.a0 = b.a0[o];
    out.kind = b.kind[o]; out.road = b.road[o]; out.lines = b.lines[o];
    out.lanes = b.lanes[o]; out.s = b.along[o];
    return out;
  }

  return { height, normal, roadInfoAt, block, field, blockCount: () => blocks.size };
}
