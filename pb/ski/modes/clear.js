/* Round 7-C (pure: no THREE, no DOM): what stands on the snow, and where a skier can be put down safely.
 *   obstacles   the village buildings (buildings.json oriented boxes, once loaded), the lift stations (both ends of every rideable lift,
 *               sized like lifts.js draws them), the lift lines (pylons, drag tracks), the trees (scatter.js) and the class raster
 *               (built / rock / water share): blocked(x, z, r) names the first thing in the way, wallAhead() looks 25 m ahead
 *   firstLift   the resort's first lift (config FIRST_LIFT by name, else freeride.js spawnLift) and the spot in front of its boarding
 *               area: a few metres from the bottom station, facing it and up the line, open view (nothing within 25 m ahead), open snow
 *   safeSpot    the nearest safe spot to a map tap: on a piste or at a lift station, inside the discovered cells, never in trees, rock,
 *               buildings or on a steep face
 *   courseGate  the start of a challenge on open snow: moved down the piste until the gate posts are clear
 * All are used by main.js and by the Node checks (scripts/ski/round7c-check.mjs) over every resort. */
import { liftClass, LIFT_SPEC } from '../lift-path.js';
import { spawnLift } from './freeride.js';
import { FIRST_LIFT, COURSE } from '../config.js';

const BUCKET = 100;
const TAN = (deg) => Math.tan(deg * Math.PI / 180);

export function createObstacles({ resort, field, scatter = null, density = 1 }) {
  const attrs = {};
  const buckets = new Map();             // building boxes per 100 m cell
  const stations = [];                   // { x, z, r, lift }
  const lines = [];                      // lift line segments [ax, az, bx, bz, half width]
  for (const [i, l] of resort.lifts.entries()) {
    const cls = liftClass(l.kind);
    if (!cls || l.pts.length < 4) continue;
    const p = l.pts, n = p.length / 2, spec = LIFT_SPEC[cls];
    const [w, , d] = spec.station;
    for (const end of [0, n - 1]) {
      const nb = end === 0 ? 1 : n - 2;
      const ux = p[2 * nb] - p[2 * end], uz = p[2 * nb + 1] - p[2 * end + 1], ul = Math.hypot(ux, uz) || 1;
      // the hall is centred a little behind the wheel (lifts.js: -0.15 d along the line, away from the line's inside)
      stations.push({ x: p[2 * end] - (ux / ul) * d * 0.15, z: p[2 * end + 1] - (uz / ul) * d * 0.15, r: Math.hypot(w, d) / 2 + 0.8, lift: i });
    }
    for (let k = 1; k < n; k++) lines.push([p[2 * k - 2], p[2 * k - 1], p[2 * k], p[2 * k + 1], cls === 'drag' ? 2.2 : 1.4]);
  }
  function setBuildings(rows) {
    buckets.clear();
    for (const r of rows || []) {
      const [cx, cz, L, W, ang] = r;
      const box = { cx, cz, hl: L / 2, hw: W / 2, c: Math.cos(ang), s: Math.sin(ang) };
      const rad = Math.hypot(box.hl, box.hw);
      for (let bz = Math.floor((cz - rad) / BUCKET); bz <= Math.floor((cz + rad) / BUCKET); bz++) {
        for (let bx = Math.floor((cx - rad) / BUCKET); bx <= Math.floor((cx + rad) / BUCKET); bx++) {
          const k = bx * 4096 + bz;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(box);
        }
      }
    }
  }
  function inBuilding(x, z, r) {
    const list = buckets.get(Math.floor(x / BUCKET) * 4096 + Math.floor(z / BUCKET));
    if (!list) return false;
    for (const b of list) {
      const dx = x - b.cx, dz = z - b.cz;
      // the box's local frame (bake.py: angle of the long side from +x)
      const u = dx * b.c + dz * b.s, v = -dx * b.s + dz * b.c;
      if (Math.abs(u) < b.hl + r && Math.abs(v) < b.hw + r) return true;
    }
    return false;
  }
  function nearStation(x, z, r) {
    for (const s of stations) { const dx = x - s.x, dz = z - s.z; if (Math.abs(dx) < 40 && Math.abs(dz) < 40 && Math.hypot(dx, dz) < s.r + r) return s; }
    return null;
  }
  function nearLine(x, z, r) {
    for (const [ax, az, bx, bz, hw] of lines) {
      if (x < Math.min(ax, bx) - 30 || x > Math.max(ax, bx) + 30 || z < Math.min(az, bz) - 30 || z > Math.max(az, bz) + 30) continue;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < hw + r) return true;
    }
    return false;
  }
  /** The first thing within r m of (x, z), or null: 'building' | 'station' | 'lift' | 'tree' | 'rock' | 'water' | 'built'. */
  function blocked(x, z, r = 1, { lift = true, trees = true, built = true } = {}) {
    if (x < 50 || z < 50 || x > resort.width - 50 || z > resort.depth - 50) return 'edge';
    if (inBuilding(x, z, r)) return 'building';
    if (nearStation(x, z, r)) return 'station';
    if (lift && nearLine(x, z, r)) return 'lift';
    if (trees && scatter && scatter.hit(x, z, r + 0.4, -1e9, density)) return 'tree';
    field.attrs(x, z, attrs);
    if (attrs.rock > 0.45) return 'rock';
    if (attrs.water > 0.4) return 'water';
    if (built && attrs.built > 0.55 && attrs.piste < 0.3) return 'built';
    return null;
  }
  /** Something within `dist` m straight ahead at eye height: a building, a station hall, a tree, or the ground rising like a wall. */
  function wallAhead(x, z, heading, height, dist = 25, eye = 1.6) {
    const cx = Math.cos(heading), cz = Math.sin(heading);
    const g0 = height(x, z), slope = TAN(30);
    for (let d = 1.5; d <= dist; d += 1.25) {
      const px = x + cx * d, pz = z + cz * d;
      if (inBuilding(px, pz, 0.3)) return { what: 'building', d };
      if (nearStation(px, pz, 0)) return { what: 'station', d };
      if (scatter && scatter.hit(px, pz, 0.3, -1e9, density)) return { what: 'tree', d };
      if (height(px, pz) > g0 + eye + d * slope) return { what: 'ground', d };
    }
    return null;
  }
  /** Ground slope in degrees over +-span m. */
  function slopeAt(x, z, height, span = 4) {
    const gx = (height(x + span, z) - height(x - span, z)) / (2 * span), gz = (height(x, z + span) - height(x, z - span)) / (2 * span);
    return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
  }
  return { blocked, wallAhead, slopeAt, setBuildings, inBuilding, nearStation, nearLine, stations, hasBuildings: () => buckets.size > 0 };
}

/** The resort's first lift (FIRST_LIFT names in order, else the village lift of round 6). lifts = createLiftNet. */
export function firstLift(rid, lifts, places, near = null) {
  for (const name of FIRST_LIFT[rid] || []) {
    const l = lifts.list.find((q) => q.name === name && !q.tunnel);
    if (l) return l;
  }
  return spawnLift(lifts, places, near);
}

/** Where a skier stands in front of a lift's boarding area: within `maxDist` m of the bottom station (inside the boarding zone,
 *  freeride.js BOTTOM_RADIUS), facing the station and up the line (turned away from it as little as needed for an open view: nothing
 *  within `view` m ahead), on open snow, not steep. Returns { x, z, heading, ok, why, turn } (ok false = the least bad spot). */
export function liftSpot(lift, obs, height, { maxDist = 38, view = 25 } = {}) {
  const b = lift.bottom;
  const d = Math.hypot(lift.top.x - b.x, lift.top.z - b.z) || 1;
  const ux = (lift.top.x - b.x) / d, uz = (lift.top.z - b.z) / d;
  const ax = b.x + ux * 20, az = b.z + uz * 20;                   // the aim: the boarding area and the line going up
  let best = null, bs = Infinity;
  for (let r = 8; r <= maxDist; r += 4) {
    for (let k = 0; k < 16; k++) {
      // start behind the station (down the line) and go round both ways: the boarding side first
      const a = Math.atan2(-uz, -ux) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      const why = obs.blocked(x, z, 1.2, { built: false });        // a village street in front of the station is fine (no house on it)
      const slope = obs.slopeAt(x, z, height);
      const base = r * 0.6 + Math.ceil(k / 2) * 1.5 + Math.max(0, slope - 14) * 20;
      if (why) { if (1000 + base < bs) { bs = 1000 + base; best = { x, z, heading: Math.atan2(az - z, ax - x), ok: false, why, turn: 0 }; } continue; }
      if (base >= bs) continue;
      const h0 = Math.atan2(az - z, ax - x);
      for (const turn of [0, 25, -25, 50, -50, 75, -75]) {
        const heading = h0 + turn * Math.PI / 180;
        const wall = obs.wallAhead(x, z, heading, height, view);
        const score = base + Math.abs(turn) * 0.12 + (wall ? 400 + (view - wall.d) * 10 : 0);
        if (score < bs) { bs = score; best = { x, z, heading, turn, ok: !wall && slope < 22, why: wall ? `${wall.what} ${wall.d.toFixed(0)} m ahead` : slope >= 22 ? `slope ${slope.toFixed(0)}°` : '' }; }
        if (!wall) break;
      }
    }
  }
  return best;
}

/** The nearest safe spot to a map tap (x, z): on a piste line (a few metres off it at most) or in front of a lift station, inside the
 *  discovered cells (isOpen(x, z)), clear of obstacles, not steeper than 32°. Returns { x, z, heading, kind, d } or null. */
export function safeSpot(x, z, { obs, pistes, lifts, height, isOpen = () => true, radius = 450 }) {
  const found = [];
  const tmp = {};
  for (const p of pistes.list) {
    if (x < Math.min(p.top.x, p.bottom.x) - radius - 400 || x > Math.max(p.top.x, p.bottom.x) + radius + 400) continue;
    const r = p.project(x, z, null, 0, {});
    if (r.dist > radius) continue;
    for (const ds of [0, 12, -12, 24, -24, 40, -40, 60, -60]) {
      for (const lat of [0, 0.35, -0.35]) {
        p.at(r.s + ds, tmp);
        const px = tmp.x - tmp.dz * lat * p.halfWidth, pz = tmp.z + tmp.dx * lat * p.halfWidth;
        if (!isOpen(px, pz) || obs.blocked(px, pz, 1.2) || obs.slopeAt(px, pz, height) > 32) continue;
        found.push({ x: px, z: pz, heading: Math.atan2(tmp.dz, tmp.dx), kind: 'piste', piste: p.id, d: Math.hypot(px - x, pz - z) });
        break;
      }
    }
  }
  for (const l of lifts.list) {
    if (Math.hypot(l.bottom.x - x, l.bottom.z - z) > radius + 30) continue;
    const s = liftSpot(l, obs, height);
    if (s && s.ok && isOpen(s.x, s.z)) found.push({ x: s.x, z: s.z, heading: s.heading, kind: 'lift', lift: l.id, d: Math.hypot(s.x - x, s.z - z) + 5 });
  }
  found.sort((a, b) => a.d - b.d);
  return found[0] || null;
}

/** A challenge's start on open snow: the first s from 2 m on (up to COURSE.gateSearch m) where both gate posts and the skier's spot are
 *  clear (no building, station, lift line, tree or rock within COURSE.gateClear m). Returns { s, ok, why }. */
export function courseGate(piste, obs, halfGate = 3.5) {
  const a = {};
  let why = '';
  for (let s = 2; s <= Math.min(COURSE.gateSearch, piste.length * 0.3); s += 4) {
    piste.at(s, a);
    const rx = -a.dz, rz = a.dx;
    why = '';
    for (const [k, r] of [[0, COURSE.gateClear], [halfGate, COURSE.gateClear * 0.6], [-halfGate, COURSE.gateClear * 0.6]]) {
      const w = obs.blocked(a.x + rx * k, a.z + rz * k, r, { trees: true });
      if (w) { why = w; break; }
    }
    if (!why) return { s, ok: true, why: '' };
  }
  return { s: 2, ok: false, why };
}
