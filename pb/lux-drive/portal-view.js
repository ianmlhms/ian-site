/* The tunnel portals of Lux Drive as one mesh: the concrete headwalls and their dark mouths.
 *
 * A tunnel is not drivable (a height field cannot hold one under the city), so the road ends at a wall with the mouth
 * of the tunnel in it.  The wall stands on the ground, it is as wide as the carriageway plus a shoulder, and the mouth
 * is as high as the road is wide: a garage is low, a motorway is high.  The dark plug of the mouth goes back into the
 * wall, so the opening reads as a hole and not as a painted rectangle. */
import { PORTAL } from './config.js';
import { createChunkedFlat } from './chunked-flat.js';

const COLOUR_WALL = [0.70, 0.68, 0.63];      // the concrete of the headwall
const COLOUR_CORNICE = [0.78, 0.76, 0.71];    // the slab on top of it
const COLOUR_LINING = [0.17, 0.17, 0.18];     // the walls of the mouth
const COLOUR_BACK = [0.045, 0.045, 0.055];    // the dark at the end of the tunnel
const COLOUR_FLOOR = [0.09, 0.09, 0.10];      // the floor of the mouth
const LINING_GAP = 0.02;                      // m, the frame of concrete that shows around the dark mouth

/**
 * portals: the portals of the tunnels (portals.js)
 * ground:  the ground of the world (decks.js); the mouth stands on its land (ground.surface) at the level of its road (portals.js p.y)
 * Returns { meshes, count, update(x, z, radius) }: one mesh per 512 m chunk (chunked-flat.js).
 */
export function createPortalView({ scene, portals, ground, material }) {
  const chunks = createChunkedFlat({ scene, material, name: 'luxdrive-portals' });
  // the land, never a deck: ground.height answers with whatever deck the car stood on last (at the start: the highest one), so a mouth under a bridge was
  // drawn ON the bridge, a concrete block in the lane of the deck over it (QA B10, deck 32 over the A1)
  const land = ground.surface || ground;
  for (const p of portals.list) {
    const b = chunks.builderAt(p.x, p.z);
    const y0 = Number.isFinite(p.y) ? p.y : land.height(p.x, p.z);
    const ix = -p.nx, iz = -p.nz;                     // into the tunnel
    const P = (u, v, y) => [p.x + p.sx * u + ix * v, y, p.z + p.sz * u + iz * v];
    const half = p.half, bore = p.bore;
    const depth = p.depth;
    const wallTop = y0 + p.top + (p.lintel ?? PORTAL.lintel);     // (a wall lowered to the land behind it has a thinner lintel, portals.js)
    // the ground under the two ends of the wall: the wall is buried under the lowest of them, so it never floats
    const base = Math.min(y0,
      land.height(p.x + p.sx * half, p.z + p.sz * half),
      land.height(p.x - p.sx * half, p.z - p.sz * half)) - PORTAL.base;
    const floor = y0 - 0.25;

    /** A box in the frame of the portal: u to the side, v into the tunnel, y up. */
    const box = (u0, u1, v0, v1, ya, yc, color) => {
      b.quad(P(u0, v0, ya), P(u1, v0, ya), P(u1, v0, yc), P(u0, v0, yc), color);
      b.quad(P(u1, v1, ya), P(u0, v1, ya), P(u0, v1, yc), P(u1, v1, yc), color);
      b.quad(P(u0, v1, ya), P(u0, v0, ya), P(u0, v0, yc), P(u0, v1, yc), color);
      b.quad(P(u1, v0, ya), P(u1, v1, ya), P(u1, v1, yc), P(u1, v0, yc), color);
      b.quad(P(u0, v0, yc), P(u1, v0, yc), P(u1, v1, yc), P(u0, v1, yc), color);
      b.quad(P(u0, v1, ya), P(u1, v1, ya), P(u1, v0, ya), P(u0, v0, ya), color);
    };

    // the headwall: the two pillars beside the carriageway and the lintel above the mouth
    box(-half, -bore, 0, depth, base, wallTop, COLOUR_WALL);
    box(bore, half, 0, depth, base, wallTop, COLOUR_WALL);
    box(-half, half, 0, depth, y0 + p.top, wallTop, COLOUR_WALL);
    // the dark mouth: a plug that goes back into the wall, a little smaller than the opening so a frame of concrete shows
    const g = LINING_GAP;
    box(-bore + g, bore - g, g, depth - g, floor, y0 + p.top - g, COLOUR_LINING);
    // the end of the tunnel is black
    b.quad(P(-bore + g, depth - g, floor), P(bore - g, depth - g, floor),
      P(bore - g, depth - g, y0 + p.top - g), P(-bore + g, depth - g, y0 + p.top - g), COLOUR_BACK);
    // the cornice on top of the wall
    const cornice = p.cornice ?? PORTAL.cornice;                  // (none on a wall a road runs over, portals.js)
    if (cornice > 0) box(-half - 0.25, half + 0.25, -0.15, depth, wallTop, wallTop + cornice, COLOUR_CORNICE);
  }
  chunks.finish();
  return { meshes: chunks.meshes, count: portals.list.length, update: chunks.update };
}
