/* The small things of the campus: the bus shelters and stop poles of the boulevard, the bike racks, the stone wall and the hedge in front
 * of the Athénée.  Each is a few boxes, drawn in one mesh with the rest of the props.  Pure (no THREE). */
import { Soup, paint } from './landmark-soup.js';
import { edgeWalls } from './landmark-util.js';

const STEEL = [0.34, 0.36, 0.38];
const GLASS = [0.52, 0.66, 0.72];
const ROOF = [0.28, 0.30, 0.33];
const BENCH = [0.50, 0.38, 0.24];
const SIGN = [0.96, 0.82, 0.10];
const SINK = 0.4;

/** A bus shelter facing `yaw` (the direction of the road): a roof slab on two posts, glass back and sides, a bench. */
function shelter(soup, ground, s) {
  const y = ground(s.x, s.z) - SINK;
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  const at = (u, v) => [s.x + u * c - v * n, s.z + u * n + v * c];   // u along the facing direction, v across it
  const place = (u, v, w, d, h, y0, color, topColor) => { const [px, pz] = at(u, v); soup.box(px, y0, pz, w, h, d, -s.yaw, color, { topColor: topColor || color }); };
  const yaw = s.yaw;
  place(0, 0, 2.2, 3.6, 0.18, y + 2.45, ROOF);                          // the roof
  for (const v of [-1.7, 1.7]) place(-1.0, v, 0.12, 0.12, 2.5, y, STEEL);        // posts at the back
  place(-1.0, 0, 0.06, 3.4, 2.2, y + 0.2, paint(GLASS, 1, 0.05));       // the glass back
  for (const v of [-1.75, 1.75]) place(0, v, 2.0, 0.06, 2.2, y + 0.2, paint(GLASS, 2, 0.05));   // the glass sides
  if (s.bench) place(-0.7, 0, 0.5, 2.6, 0.12, y + 0.5, BENCH);
  place(0.7, 1.6, 0.06, 0.7, 0.9, y + 1.4, SIGN);                       // the sign at the front edge
  return yaw;
}

/** A stop pole: a thin post with a yellow plate. */
function pole(soup, ground, s) {
  const y = ground(s.x, s.z) - SINK;
  soup.frustum(s.x, s.z, 0.07, 0.07, y, y + 3.4, 6, STEEL, { cap: true });
  soup.box(s.x, y + 2.4, s.z, 0.9, 0.95, 0.07, -s.yaw + Math.PI / 2, SIGN);
  soup.box(s.x, y + 2.4, s.z, 0.6, 0.55, 0.09, -s.yaw + Math.PI / 2, [0.12, 0.40, 0.26]);
}

/** A row of bike loops: n hoops of 0.7 m. */
function rack(soup, ground, s) {
  const y = ground(s.x, s.z);
  for (let i = -2; i <= 2; i++) soup.box(s.x + i * 0.7, y, s.z, 0.05, 0.8, 0.05, 0, STEEL);
  soup.box(s.x, y + 0.8, s.z, 3.0, 0.04, 0.05, 0, STEEL);
}

/** A wall (stone) with a hedge on top, along a polyline: { pts, h, w, c, hedge }. */
function wallWithHedge(soup, ground, wall) {
  for (let i = 0; i + 1 < wall.pts.length; i++) {
    const [ax, az] = wall.pts[i], [bx, bz] = wall.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = -Math.atan2(bz - az, bx - ax);
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y0 = Math.min(ground(x - (bx - ax) / steps / 2, z - (bz - az) / steps / 2), ground(x + (bx - ax) / steps / 2, z + (bz - az) / steps / 2)) - 0.5;
      soup.box(x, y0, z, len / steps + 0.1, wall.h + 0.5, wall.w, yaw, paint(wall.c, k, 0.05), { topColor: wall.c });
      soup.box(x, y0 + wall.h + 0.5, z, len / steps + 0.1, 1.0, wall.w * 0.8, yaw, paint(wall.hedge, k, 0.08), { topColor: wall.hedge });
    }
  }
}

export function buildProps(campus, ground) {
  const soup = new Soup();
  const walls = [];
  for (const s of campus.furniture) {
    if (s.k === 'shelter') shelter(soup, ground, s);
    else if (s.k === 'pole') pole(soup, ground, s);
    else if (s.k === 'rack') rack(soup, ground, s);
  }
  for (const w of campus.walls) {
    wallWithHedge(soup, ground, w);
    walls.push(...edgeWalls([...w.pts, ...[...w.pts].reverse().slice(1, -1)], 0.3, 'campus-wall'));
  }
  return { soup, walls, hideBuildings: [], info: { furniture: campus.furniture.length } };
}
