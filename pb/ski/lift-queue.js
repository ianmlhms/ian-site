/* Lift lines (26 Nov 2026; Ian: "make climbing in lifts easier ... rework the climbing in and lift lines before boarding"). Pure (no THREE,
 * no DOM): lift-site.js places the maze of every busy lift's bottom station, queue-view.js draws its posts and ropes, npc.js puts the other
 * skiers in its lanes, modes/freeride.js leads the player through its free lane.
 *   the maze   (createQueueMaze) on the outer side of the boarding zone (+b, where the riders come from): straight lanes between rope
 *              lines on posts, merging over the last MAZE.funnel m to the width of the zone. Busy lifts only (mazeSpec: chairs with 3+
 *              seats, gondolas / funitels, cable cars, trains; none at drag lifts, rope tows, carpets or two-seat chairs). The lane on
 *              the +a side is the free one ("Single"): nobody queues in it, the player is led through it in a few seconds
 *   the line   (createQueueSim) loop lifts: one group per carrier, the same people npc.js seats on that chair / stands in that cabin
 *              (groupOf: the count, the seats, the outfits). A group waits in its lane (each lane its own file, MAZE.spacing m apart),
 *              shuffles forward when the group ahead leaves, walks into the zone when the zone is free, (chairs) through the gate onto
 *              the loading line once the chair before has gone, (cabins) to the door, and is on the carrier when it reaches the line.
 *              Jig-back cabins / trains: while the cabin is docked a few from the head of each lane walk in at the door.
 *              While the player boards (hold), no new group enters the zone: their carriers go up empty (reserved), the groups wait.
 * Coordinates: the bottom station's frame (a along the outward line direction, b across, +b = the up lane's outer side), the maze has
 * its own origin (the middle of the maze, so the frame's ground is the maze's) on the same axes. */
import { BOARD } from './lift-path.js';

export const MAZE = Object.freeze({
  laneW: 1.25,          // m between two rope lines where the lanes run straight
  minHead: 0.98,        // m: the narrowest a lane may get where they merge (a body is 0.9 m)
  spacing: 1.15,        // m between two people in a lane
  head: 0.65,           // m from a lane's end at the head to its first person
  funnel: 2.6,          // m over which the lanes merge to the zone's width
  postEvery: 2.4,       // m at most between two posts
  ropeY: 0.9, postH: 1.0,
  maxRise: 2.4,         // m: the ground under a maze rises at most this much (else a shorter maze, else none)
  occupied: 0.9,        // share of the carriers of a busy lift that take a group (x the day's crowd share)
  shuffle: 0.9,         // s a step forward takes
  ripple: 0.12,         // s later per place in the lane (the file moves like a file)
  holdCap: 6,           // s at most the player waits for a group in the zone ahead of him
});
const COL = Object.freeze({ post: 0x30353d, cap: 0xc9ced6, base: 0x3a3f48, rope: 0xd23a2a, ropeFree: 0x2a66d0 });
export { COL as QUEUE_COLOURS };

/* deterministic numbers (the same mixing as npc.js rand01; kept here so this module stays standalone) */
function mix(h, v) { h = Math.imul(h ^ (v | 0), 0x9e3779b1); return (h ^ (h >>> 15)) | 0; }
export function qrand(a, b = 0, c = 0, d = 0, e = 0) {
  let h = mix(mix(mix(mix(mix(0x811c9dc5, a), b), c), d), e);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0; return h; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const mod = (n, m) => ((n % m) + m) % m;

/** How many queue lanes (the free one not counted) and how long, by the lift (null: no maze). Busier = more lanes. */
export function mazeSpec(path) {
  const k = path.kind, h = qrand(hashStr(String((path.src && path.src.name) || '')), 91);
  if (k === 'chair') {
    const s = path.seats || 4;
    if (s < 3) return null;
    return s >= 6 ? { lanes: 3, len: 11 + h * 2.5, loop: true } : s >= 4 ? { lanes: 2, len: 8.5 + h * 2.5, loop: true } : { lanes: 1, len: 6 + h * 1.5, loop: true };
  }
  if (k === 'gondola') return path.sub === 'funitel' ? { lanes: 3, len: 11 + h * 2, loop: true } : { lanes: 2, len: 9.5 + h * 2.5, loop: true };
  if (k === 'cable') return { lanes: 3, len: 11 + h * 2.5, loop: false };
  if (k === 'train') return { lanes: 2, len: 9 + h * 2, loop: false };
  return null;
}

/** Ground-level parts of a station frame a walker cannot pass (posts, walls, huts, fences; not decks / mats / roofs overhead). */
const isBarrier = (p) => !p.cut && !p.deck && !p.zoneMark && p.y0 < 1.3 && p.y1 > 0.2;
function segClear(boxes, a0, b0, a1, b1, r) {
  const d = Math.hypot(a1 - a0, b1 - b0), n = Math.max(1, Math.ceil(d / 0.2));
  for (let k = 0; k <= n; k++) {
    const a = a0 + (a1 - a0) * k / n, b = b0 + (b1 - b0) * k / n;
    for (const p of boxes) if (a > p.a0 - r && a < p.a1 + r && b > p.b0 - r && b < p.b1 + r) return false;
  }
  return true;
}

/**
 * The queue maze of one lift's bottom station (site = lift-site.js createLiftSite), or null. height(x, z) = the snow (the lift path's own
 * height function): the maze must sit on ground that rises at most MAZE.maxRise. The result is a station-like frame (lift-site.js puts
 * it in its grid: the skier, the others and the trees keep out of it; its posts and ropes are solid) plus the lanes for the others.
 */
export function createQueueMaze(site, height) {
  const spec = mazeSpec(site.path);
  if (!spec || !site.bottom || !site.zone) return null;
  for (const k of [1, 0.72, 0.5]) {
    const m = buildMaze(site, height, spec, spec.len * k);
    if (m) return m;
  }
  return null;
}

/** Why the last mazes were not built (tests: scripts/ski/queue-check.mjs --verbose). */
export const mazeWhy = {};
const no = (why) => { mazeWhy[why] = (mazeWhy[why] || 0) + 1; return null; };
function buildMaze(site, height, spec, len) {
  const f = site.bottom, z = site.zone, path = site.path;
  if (len < 4.5) return null;
  const ac = (z.a0 + z.a1) / 2, zw = z.a1 - z.a0;
  let lanes = spec.lanes, n = lanes + 1, wh = 0;
  for (; lanes >= 1; lanes--) { n = lanes + 1; wh = Math.min(MAZE.laneW, (zw + 0.8) / n); if (wh >= MAZE.minHead) break; }
  if (lanes < 1) return no('narrow zone');
  const W = MAZE.laneW, Wout = n * W, Wh = n * wh;
  const boxes = f.parts.filter(isBarrier);
  // the head line: just beyond the deck / platform in front of the zone (whatever the station is built of there)
  let bHead = z.b1;
  for (const p of f.parts) {
    if (p.cut || p.y0 > 0.6 || p.a1 < ac - Wout / 2 - 0.3 || p.a0 > ac + Wout / 2 + 0.3 || p.b1 <= bHead || p.b0 > z.b1 + 12) continue;
    bHead = p.b1;
  }
  bHead += 0.15;
  const fun = Math.min(MAZE.funnel, len * 0.4), bF = bHead + fun, bEnd = bHead + len;
  // nothing of the station in the maze, every lane's head can walk into the zone
  for (const p of boxes) if (p.a1 > ac - Wout / 2 - 0.3 && p.a0 < ac + Wout / 2 + 0.3 && p.b1 > bHead - 0.05 && p.b0 < bEnd + 0.3) return no('station part in the maze');
  const need = path.kind === 'chair' ? Math.max(1, path.seats || 4) : path.kind === 'gondola' ? (path.sub === 'funitel' ? 7 : 4) : 12;
  const zoneSpots = spotsIn(z, ac, need);
  const headA = (i) => ac + (i + 0.5 - n / 2) * wh;
  for (let i = 0; i < n; i++) for (const s of zoneSpots.slice(0, 3)) if (!segClear(boxes, headA(i), bHead, s.a, s.b, 0.3)) return no('no way into the zone');
  // the ground: no steep maze, and the head not far below / above the deck it leads onto
  const g0 = height(f.x, f.z);
  let lo = Infinity, hi = -Infinity;
  for (let b = bHead; b <= bEnd + 0.01; b += Math.max(1, len / 8)) for (let a = ac - Wout / 2; a <= ac + Wout / 2 + 0.01; a += Wout / 3) {
    const w = f.toWorld(a, b, {}), y = height(w.x, w.z);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  if (hi - lo > MAZE.maxRise) return no('steep');
  const wHead = f.toWorld(ac, bHead, {});
  if (g0 - height(wHead.x, wHead.z) > 1.1) return no('head below the deck');      // (a higher head: the snow covers the deck there)

  // the maze's own frame (origin in its middle, the station's axes)
  const bc = (bHead + bEnd) / 2, O = f.toWorld(ac, bc, {});
  const gm = height(O.x, O.z);
  const yLo = lo - gm - 0.4, yHi = hi - gm + MAZE.postH;          // (the posts / ropes are solid over the whole rise of the ground)
  const L = (a, b) => ({ a: a - ac, b: b - bc });
  const parts = [], posts = [], ropes = [];
  const free = n - 1;
  for (let j = 0; j <= n; j++) {
    const aH = ac + (j - n / 2) * wh, aO = ac + (j - n / 2) * W;
    const line = [[aH, bHead], [aO, bF]];
    const straight = bEnd - bF, k = Math.max(1, Math.ceil(straight / MAZE.postEvery));
    for (let i = 1; i <= k; i++) line.push([aO, bF + straight * i / k]);
    const freeSide = j === free || j === free + 1;
    line.forEach(([a, b], i) => {
      const p = L(a, b);
      posts.push({ a: p.a, b: p.b });
      parts.push({ a0: p.a - 0.05, a1: p.a + 0.05, b0: p.b - 0.05, b1: p.b + 0.05, y0: yLo, y1: yHi, col: COL.post, solid: true, post: true, queue: true });
      if (!i) return;
      const q = L(line[i - 1][0], line[i - 1][1]);
      ropes.push({ a0: q.a, b0: q.b, a1: p.a, b1: p.b, free: freeSide && j === free + 1 ? true : freeSide && j === free });
      // the rope as solid boxes along the frame's axes (a slanted funnel rope: 4 short pieces)
      const pieces = Math.abs(p.a - q.a) > 0.05 ? 12 : 1;
      for (let s = 0; s < pieces; s++) {
        const u0 = s / pieces, u1 = (s + 1) / pieces;
        const A0 = q.a + (p.a - q.a) * u0, A1 = q.a + (p.a - q.a) * u1, B0 = q.b + (p.b - q.b) * u0, B1 = q.b + (p.b - q.b) * u1;
        parts.push({ a0: Math.min(A0, A1) - 0.03, a1: Math.max(A0, A1) + 0.03, b0: Math.min(B0, B1) - 0.03, b1: Math.max(B0, B1) + 0.03, y0: yLo, y1: yHi, col: COL.rope, solid: true, rope: true, queue: true });
      }
    });
  }
  let A0 = Infinity, A1 = -Infinity, B0 = Infinity, B1 = -Infinity;
  for (const p of parts) { A0 = Math.min(A0, p.a0); A1 = Math.max(A1, p.a1); B0 = Math.min(B0, p.b0); B1 = Math.max(B1, p.b1); }
  const fx = f.fx, fz = f.fz, rx = f.rx, rz = f.rz;
  const maze = {
    which: 'queue', type: 'queue', s: 0, x: O.x, z: O.z, fx, fz, rx, rz, parts, rect: { a0: A0, a1: A1, b0: B0, b1: B1 },
    toWorld(a, b, out = {}) { out.x = O.x + fx * a + rx * b; out.z = O.z + fz * a + rz * b; return out; },
    toLocal(x, z, out = {}) { const dx = x - O.x, dz = z - O.z; out.a = dx * fx + dz * fz; out.b = dx * rx + dz * rz; return out; },
    posts, ropes, n, free, npcLanes: lanes, loop: spec.loop, kind: path.kind, len, ground: { lo, hi },
  };
  // the lanes (world points from the head out to the entry), the spots in the zone, the walk to the carrier
  const W2 = (a, b) => f.toWorld(a, b, {});
  maze.lanes = [];
  for (let i = 0; i < n; i++) {
    const aH = headA(i), aO = ac + (i + 0.5 - n / 2) * W;
    const pts = [W2(aH, bHead), W2(aO, bF), W2(aO, bEnd)];
    const cum = [0, Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z)];
    cum.push(cum[1] + Math.hypot(pts[2].x - pts[1].x, pts[2].z - pts[1].z));
    maze.lanes.push({ i, free: i === free, pts, cum, len: cum[2], cap: Math.max(1, Math.floor((cum[2] - 0.5) / MAZE.spacing)), head: W2(aH, bHead - 0.35), entry: W2(aO, bEnd + 1.2) });
  }
  // (the row nearest the lift first, the first in fills it and walks on first: a chair's nearest the gate first, a cabin's in the door row's order)
  const C0 = site.chair;
  const key = C0 ? (s) => Math.abs(s.a - C0.aGate) + (s.b - z.b0) * 10 : (s) => s.a + (s.b - z.b0) * 10;
  maze.zoneSpots = zoneSpots.slice().sort((u, v) => key(u) - key(v)).map((s) => ({ ...W2(s.a, s.b), a: s.a, b: s.b }));
  maze.inward = Math.atan2(-rz, -rx);                             // facing the zone (-b)
  maze.upHeading = Math.atan2(-fz, -fx);                          // facing up the line
  // chairs: the gate and the loading line (seat spots as liftride.js riderAt: station b = side + seat offset x path.sign)
  const C = site.chair;
  if (C) {
    maze.gate = [W2(C.aGate, C.bGate + 0.75), W2(C.aGate, C.bGate - 0.75), W2(C.aEntry, path.side)];
    const S = Math.max(1, path.seats || 4), Wc = Math.max(1.6, Math.min(4.2, S * 0.52)), pitch = (Wc - 0.25) / S;
    const seatB = (seat) => path.side + (seat - (S - 1) / 2) * pitch * path.sign;
    maze.seatSpot = (seat) => W2(C.aLoad - 0.3, seatB(seat));
    maze.seatEntry = (seat) => W2(C.aEntry, seatB(seat));
    /** the seat's distance from the gate (the first through it goes farthest in: nobody crosses the file behind him) */
    maze.seatDepth = (seat) => C.bGate - seatB(seat);
  } else {
    // cabins: the door spots on the platform edge beside the loading point (the cabin passes at b = side)
    const bDoor = path.side + path.carrier.hw + 0.95, aD = -Math.min(BOARD[site.key] || 6, path.len * 0.2);
    maze.doorSpot = (m) => W2(aD + ((m % 4) - 1.5) * 0.66, bDoor + Math.floor(m / 4) * 0.75);
  }
  return maze;
}

/** Standing spots for `need` people in a boarding zone (local a / b): rows across it ~1 m apart, the row nearest the lift's line (-b)
 *  first; a group bigger than the zone stands on in rows beyond its outer edge (on the deck, between the zone and the maze). */
function spotsIn(z, ac, need) {
  const w = z.a1 - z.a0, cols = Math.max(1, Math.floor((w - 0.5) / 1.0 + 1e-6) + 1), da = cols > 1 ? Math.min(1.1, (w - 0.6) / (cols - 1)) : 0;
  const out = [];
  for (let r = 0; out.length < Math.max(need, 1); r++) {
    const b = z.b0 + 0.5 + r * 0.95;
    for (let c = 0; c < cols && out.length < need; c++) out.push({ a: ac + (c - (cols - 1) / 2) * da, b });
  }
  return out;
}

/** A point `d` m along lane `lane` from its head (out = { x, z, heading: facing the head }). */
export function laneAt(lane, d, out = {}) {
  const { pts, cum } = lane;
  const s = clamp(d, 0, cum[2]);
  const i = s <= cum[1] ? 0 : 1, A = pts[i], B = pts[i + 1], k = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
  out.x = A.x + (B.x - A.x) * k; out.z = A.z + (B.z - A.z) * k; out.heading = Math.atan2(A.z - B.z, A.x - B.x);
  return out;
}
/** A polyline's length. */
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return L; }
/** Along a polyline [{x, z}] by the share k (0..1) of its length (out = { x, z, heading }). */
function along(pts, k, out) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  let m = clamp(k, 0, 1) * L;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (m <= d || i === pts.length - 1) {
      const f = d > 1e-6 ? clamp(m / d, 0, 1) : 1;
      out.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f; out.z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * f;
      if (d > 1e-6) out.heading = Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x);
      return out;
    }
    m -= d;
  }
  return out;
}

/** The player's way through the maze to the zone's waiting spot: the free lane from its entry (1.2 m outside) to its head, then
 *  the spot. [{ x, z }, ...] (the entry first). */
export function freeWay(maze, to) {
  const l = maze.lanes[maze.free];
  return [l.entry, l.pts[2], l.pts[1], l.pts[0], l.head, { x: to.x, z: to.z }];
}

/**
 * The line at one lift (site with site.queue = createQueueMaze). seed / index: the crowd's. Loop lifts are driven by the carriers'
 * lattice phi = (uLoad - A) / gap (lifts.js latticeA: carrier n reaches the loading line when phi = n; phi falls as time goes on);
 * jig-back lifts by their shuttle clock { c (cycle), u (s into it; < dwell: the up cabin docked at the bottom), dwell }.
 */
export function createQueueSim(site, seed, index) {
  const maze = site.queue, path = site.path, kind = path.kind;
  const loop = maze.loop, nL = maze.npcLanes;
  const P = loop ? path.spec.gap / path.spec.speed : 0;           // s between two carriers
  const chair = kind === 'chair';
  const S = chair ? Math.max(1, path.seats || 4) : 0;
  const cabinCap = kind === 'gondola' ? (path.sub === 'funitel' ? 7 : 4) : 0;
  // the stages of a loop group by x = s until its carrier reaches the loading line
  const Xgate = chair ? P - 0.25 : Math.min(P - 0.5, 1.7);       // chairs: through the gate when the chair before has passed
  const Xzone = Xgate + Math.min(P, chair ? P : 4.5);             // into the zone when the group before has left it
  const R = [];                    // reserved carriers (descending): nobody boards them (the player's, and the ones passing while he boards)
  let pruned = 0;
  const gone = new Set();          // groups (k) taken out (the player was put down where they stood): their carrier goes up empty
  let committed = null;            // while the player holds: the carriers whose groups were in the zone / at the line already
  let lastC = null, lastPhi = null;
  const countAbove = (n) => { let c = 0; for (const r of R) { if (r > n) c++; else break; } return c; };
  const isReserved = (n) => R.includes(n);
  /** The group index of carrier n (no group: null). */
  const kOf = (n) => (isReserved(n) ? null : -n - countAbove(n) - pruned);
  function reserve(n) {
    if (isReserved(n)) return;
    let i = 0;
    while (i < R.length && R[i] > n) i++;
    R.splice(i, 0, n);
  }
  /** A loop group's size and seats: chairs by the seats, cabins up to npc.js's standing spots; 0 = an empty carrier. */
  function sizeOf(k, share) {
    if (gone.has(k)) return 0;
    const r1 = qrand(seed, index, k, 11), r2 = qrand(seed, index, k, 12);
    if (r1 >= MAZE.occupied * clamp(share, 0.25, 1)) return 0;
    return Math.min(maxG, chair ? clamp(Math.round(S * (0.35 + 0.65 * r2)), 1, S) : clamp(1 + Math.floor(r2 * cabinCap), 1, cabinCap));
  }
  /** The seat (chair) / spot order of a group: a deterministic shuffle of 0..count-1; a chair's first g seats (the group's) then from
   *  the farthest from the gate in (the first through the gate takes it: nobody crosses the file behind him). */
  function orderOf(k, count, g = count) {
    const o = [];
    for (let i = 0; i < count; i++) o.push(i);
    o.sort((a, b) => qrand(seed, index, k, a, 13) - qrand(seed, index, k, b, 13));
    if (chair && maze.seatDepth) { const head = o.slice(0, g).sort((a, b) => maze.seatDepth(b) - maze.seatDepth(a)); return [...head, ...o.slice(g)]; }
    return o;
  }
  const outfitOf = (k, m) => Math.floor(qrand(seed, index, k, m, 14) * 1000);
  const scaleOf = (k, m) => 0.9 + 0.16 * qrand(seed, index, k, m, 15);
  const laneOf = (k) => mod(k, nL);
  const maxG = Math.max(1, Math.min(maze.lanes[0].cap, maze.zoneSpots.length));      // a group fits in its lane (a short maze: smaller groups)

  const tmp = {}, tmp2 = {};
  let gateOpen = 0, clearIn = 0, after = 0;
  /** Fills `out` with this frame's people: { id, x, z, heading, moving (0..1), carry (cabins: skis on the shoulder), outfit, scale,
   *  cut (about to vanish onto the carrier: no shrink-out) }. clock: { phi } (loop) or { c, u, dwell } (jig-back); share = the day's
   *  crowd share; hold: 'zone' (the player stands in the zone: groups there go), 'walk' (he is being led in / boarding), or ''. */
  function people(clock, share, hold, out) {
    out.length = 0;
    gateOpen = 0; clearIn = 0; after = 0;
    if (!loop) { shuttle(clock, share, hold, out); return out; }
    const phi = clock.phi, nNext = Math.floor(phi);
    lastPhi = phi;
    const xOf = (n) => (phi - n) * P;
    // prune: reserved carriers long past the line (round the loop and gone)
    const span = Math.ceil(path.loopLen / Math.max(1, path.spec.gap)) + 2;
    while (R.length && R[0] > nNext + span) { R.shift(); pruned++; }
    // the player: no new group into the zone while he boards; the ones there already go on (or go, if he was put down among them)
    if (hold) {
      if (!committed) {
        committed = new Set();
        for (let n = nNext; xOf(n) <= Xzone + 0.02; n--) {
          const k = kOf(n);
          if (k === null) continue;
          if (hold === 'zone' && xOf(n) > Xgate) gone.add(k); else committed.add(n);
        }
      }
      for (let n = nNext; xOf(n) <= Xzone + 0.05; n--) if (!committed.has(n)) reserve(n);
    } else if (committed) {
      // let go: a group must not appear half way into the zone, so the carriers already in that stage go up empty too
      for (let n = nNext; xOf(n) <= Xzone - 0.05; n--) if (!committed.has(n)) reserve(n);
      committed = null;
    }
    // the groups from the one just boarding back to the last one that fits in the lanes
    const laneAcc = new Array(nL).fill(0), laneLeft = new Array(nL).fill(null);
    const cap = Math.max(1, Math.round(maze.lanes[0].cap * clamp(0.35 + 0.75 * share, 0.3, 1)));
    let prevG = 0;                 // the size of the group ahead (the one before in this loop): the next waits until it has left the zone
    for (let n = nNext, guard = 0; guard < 120; n--, guard++) {
      const x = xOf(n);
      const k = kOf(n);
      if (k === null) continue;
      const g = sizeOf(k, share);
      if (!g) continue;
      const gAhead = prevG;
      prevG = g;
      const L = laneOf(k), lane = maze.lanes[laneIndex(L)];
      if (x > Xzone) {
        // in the lane: behind the groups still in it; the one that left last steps them forward (a file: the front ones first)
        if (laneAcc[L] >= cap) { if (laneAcc.every((a) => a >= cap)) break; continue; }
        const left = laneLeft[L];
        for (let m = 0; m < g; m++) {
          const sig = laneAcc[L] + m;
          let pos = sig, moving = 0;
          if (left) {
            // (after the last of the leavers has set off; the further to go, the longer the step)
            const k2 = ease((Xzone - left.x - left.wait - 0.25 * left.g - 0.15 - MAZE.ripple * sig) / (MAZE.shuffle + 0.35 * left.g));
            pos = sig + left.g * (1 - k2); moving = k2 > 0 && k2 < 1 ? 1 : 0;
          }
          if (pos >= cap) continue;
          laneAt(lane, MAZE.head + pos * MAZE.spacing, tmp);
          out.push(person(k, m, tmp.x, tmp.z, tmp.heading, moving));
        }
        laneAcc[L] += g;
        continue;
      }
      // left the lane (it counts for the file behind: the shuffle forward)
      const wait = (chair ? 0.3 : 0.15) * Math.max(0, gAhead - 1) + 0.45;      // (in once the last of the group ahead has left its spot)
      if (!laneLeft[L] || x > laneLeft[L].x) laneLeft[L] = { x, g, wait };     // (the latest leaver of each lane)
      if (x <= 0) continue;                                       // on the carrier (npc.js riders)
      const order = chair ? orderOf(k, S, g) : orderOf(k, cabinCap, g);
      if (x > Xgate) {
        // into the zone: the file walks on together (a train: the spacing kept), each to his spot
        const t = Xzone - x;
        if (committed && committed.has(n)) clearIn = Math.max(clearIn, chair ? x - Xgate + 0.45 : x + 0.25);
        const ways = [];
        let far = 0;
        for (let m = 0; m < g; m++) {
          laneAt(lane, MAZE.head + m * MAZE.spacing, tmp2);
          const w = [{ x: tmp2.x, z: tmp2.z }, lane.head, maze.zoneSpots[m % maze.zoneSpots.length]];
          ways.push(w); far = Math.max(far, polyLen(w));
        }
        const v = Math.max(1.2, far / Math.max(0.9, Xzone - Xgate - wait - 0.2));
        for (let m = 0; m < g; m++) {
          const len = polyLen(ways[m]), d = clamp(v * (t - wait), 0, len);
          along(ways[m], len > 0 ? d / len : 1, tmp2);
          out.push(person(k, m, tmp2.x, tmp2.z, d >= len - 1e-6 ? (chair ? maze.upHeading : maze.inward) : tmp2.heading, d > 0 && d < len ? 1 : 0));
        }
        if (committed && committed.has(n)) after = Math.max(after, x + 0.3);
        continue;
      }
      // to the carrier: chairs through the gate onto the loading line (single file, the first goes farthest), cabins to the door
      const t = Xgate - x;
      if (committed && committed.has(n)) { after = Math.max(after, x + 0.3); if (!chair) clearIn = Math.max(clearIn, x + 0.25); }
      const gapM = chair ? 0.85 : 0.5, end = chair ? 0.6 : 0.3;      // m between two in the file (each sets off when that far ahead)
      const ways = [];
      let v = 1.2;
      for (let m = 0; m < g; m++) {
        const spot = maze.zoneSpots[m % maze.zoneSpots.length];
        const w = chair ? [spot, maze.gate[0], maze.gate[1], maze.seatEntry(order[m]), maze.seatSpot(order[m])] : [spot, maze.doorSpot(m)];
        ways.push(w);
        v = Math.max(v, (polyLen(w) + gapM * m) / Math.max(0.4, Xgate - end));
      }
      const lag = gapM / v;
      let last = 0;
      for (let m = 0; m < g; m++) {
        const len = polyLen(ways[m]), d = clamp(v * (t - lag * m), 0, len);
        along(ways[m], len > 0 ? d / len : 1, tmp2);
        const p = person(k, m, tmp2.x, tmp2.z, d >= len - 1e-6 ? (chair ? maze.upHeading : maze.inward) : tmp2.heading, d > 0 && d < len ? 1 : 0);
        p.cut = x < (chair ? 0.25 : 0.2);
        out.push(p);
        if (chair) last = Math.max(last, lag * m + polyLen(ways[m].slice(0, 3)) / v);
      }
      // the chair gate: open while the file walks through it
      if (chair) gateOpen = Math.max(gateOpen, Math.min(ease(t / 0.45), 1 - ease((t - last - 0.2) / 0.45)));
    }
    clearIn = Math.min(clearIn, MAZE.holdCap);
    return out;
  }
  const laneIndex = (L) => (L >= maze.free ? L + 1 : L);          // the NPC lanes skip the free one
  function person(k, m, x, z, heading, moving) {
    return { id: 5e6 + index * 4096 + mod(k, 400) * 8 + (m & 7), k, m, x, z, heading, moving, carry: !chair, outfit: outfitOf(k, m), scale: scaleOf(k, m), cut: false };
  }
  /** Jig-back cabins / trains: q from the head of each lane walk in while the cabin is docked (a cycle that starts while the player
   *  holds the station boards nobody: the files wait). */
  let pausedBefore = 0, thisPaused = false;
  function shuttle(clock, share, hold, out) {
    const q = kind === 'cable' ? 3 : 4;
    const dwell = clock.dwell || 8, u = clock.u;
    if (lastC === null) { lastC = clock.c; thisPaused = !!hold; }
    if (clock.c !== lastC) { if (thisPaused) pausedBefore++; lastC = clock.c; thisPaused = !!hold; }
    const B = q * (clock.c - pausedBefore);                       // members of each lane boarded before this cycle
    const leaveAt = (m, L) => 0.4 + 0.6 * (m * nL + L);           // s into the dwell the m-th boarder of lane L sets off (lanes in turn)
    const walk = 2.2;
    const cap = Math.max(1, Math.round(maze.lanes[0].cap * clamp(0.35 + 0.75 * share, 0.3, 1)));
    for (let L = 0; L < nL; L++) {
      const lane = maze.lanes[laneIndex(L)];
      for (let sig = 0; sig < q + cap + 1; sig++) {
        const j = B + sig;
        if (!thisPaused && sig < q && u >= leaveAt(sig, L)) {
          // walking in: from his place in the file, the head, the zone, the door; gone at the door (at once when the player comes)
          const tw = u - leaveAt(sig, L);
          if (tw >= walk || hold) continue;
          laneAt(lane, MAZE.head + Math.max(0, sig - fileLeft(leaveAt(sig, L) - leaveAt(0, L), sig, q)) * MAZE.spacing, tmp2);
          const o = sig * nL + L, spot = maze.zoneSpots[o % maze.zoneSpots.length], door = maze.doorSpot(o);
          along([{ x: tmp2.x, z: tmp2.z }, lane.head, spot, door], ease(tw / walk), tmp2);
          out.push(shPerson(L, j, tmp2.x, tmp2.z, tmp2.heading, 1));
          continue;
        }
        // the file steps forward as each boarder leaves (a file: the front ones first)
        const left = thisPaused ? 0 : fileLeft(u - leaveAt(0, L), sig, q);
        const pos = Math.max(0, sig - left);
        if (pos >= cap) continue;
        laneAt(lane, MAZE.head + pos * MAZE.spacing, tmp);
        out.push(shPerson(L, j, tmp.x, tmp.z, tmp.heading, left > 0.02 && left < q - 0.02 ? 1 : 0));
      }
    }
  }
  /** How far a lane's file has stepped up u s after its first boarder set off (one smooth step over the q leavers; ripple: the ones further back later). */
  function fileLeft(u, sig, q) {
    const dur = 0.6 * nL * (q - 1) + MAZE.shuffle + 0.6;
    return Math.min(sig, q * ease((u - MAZE.ripple * sig) / dur));
  }
  function shPerson(L, j, x, z, heading, moving) {
    return { id: 5e6 + index * 4096 + L * 1000 + mod(j, 1000), k: L * 1e6 + j, m: L, x, z, heading, moving, carry: true, outfit: Math.floor(qrand(seed, index, L, j, 16) * 1000), scale: 0.9 + 0.16 * qrand(seed, index, L, j, 17), cut: false };
  }
  return {
    maze, P, Xgate, Xzone,
    people,
    /** Carrier n's riders as the line put them on: { n (count), k (the group: npc.js keys the seats / outfits by it), order (seats) }. */
    groupOf(n, share) {
      const k = kOf(n);
      if (k === null) return null;
      const g = sizeOf(k, share);
      return g ? { n: g, k, order: orderOf(k, chair ? S : cabinCap, g) } : null;
    },
    outfitOf, scaleOf,
    /** The player is put down in the zone (a second press, or he waited LINE_WAIT): the group in the zone (cabins: on the platform)
     *  goes at once (their carrier goes up empty). */
    clearZone() {
      if (!loop || lastPhi === null) return;
      for (let n = Math.floor(lastPhi); (lastPhi - n) * P <= Xzone + 0.05; n--) {
        const x = (lastPhi - n) * P, k = kOf(n);
        if (k !== null && (chair ? x > Xgate : x > 0)) gone.add(k);
      }
    },
    /** This frame: the chair gate (0..1) for the people walking through it. */
    get gate() { return gateOpen; },
    /** This frame, while the player holds: s until the zone is free of the groups ahead of him (capped), and s until their carrier has
     *  passed the loading line (his own carrier must come after it). */
    get clearIn() { return clearIn; },
    get after() { return after; },
    /** tests */
    get reserved() { return R.slice(); },
  };
}
