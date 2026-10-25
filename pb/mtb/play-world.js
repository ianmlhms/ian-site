/* The pure play world: the zero-holes world (world-build.js) plus everything the game needs on top of it, shared by the browser (main.js), the Node harness and the flows:
 * bridge decks and the composed ground, the ground resolver (surfaces), and for every trail its runtime description (centre line, arc length, checkpoints, gates, signposts, features). */
import { buildPureWorld } from './world-build.js';
import { buildDecks, createGround } from './decks.js';
import { groundResolver, createBikeState } from './bike.js';
import { sampleWorldMap } from './world-map.js';
import { BIKES, PLAY } from './config.js';

const GATE_AT = 8;                // m from the start: the start gate
const FINISH_BEFORE = 8;          // m before the end: the finish arch
const ROCK_PATH_CLEARANCE = 0.45;   // carve coverage above which a rock cannot stop the bike
const CHECKPOINT_RADIUS = 9;      // m: riding this close to a checkpoint counts

export function buildPlayWorld(data) {
  const world = buildPureWorld(data);
  const { field, surface, maps } = world;
  const decks = buildDecks(field.network.features, surface);
  const ground = createGround(surface, decks);
  const probe = {};
  const classify = (x, z) => { sampleWorldMap(maps, x, z, probe); return probe.rock > 0.5 ? 'rock' : probe.grass > 0.5 ? 'grass' : 'forest'; };
  const groundAt = groundResolver(field, { onDeck: ground.onDeck, classify });
  const trails = data.trails.trails.map((t) => trailRuntime(t, field.network, surface, data.medals && data.medals[t.id]));
  // Trunks and rocks as the bike meets them. A rock never blocks the carved path itself (a few art rocks stand on the Marathon's path: the rider rides through them
  // instead of being stopped by an invisible-to-the-data obstacle; the reviewer / art agent should move those rocks, see W3-PLAY-NOTES).
  const hitA = { nx: 0, nz: 0, pen: 0 }, hitB = { nx: 0, nz: 0, pen: 0 };
  const collide = (x, z, r, y, out) => {
    const a = world.trees.collide(x, z, r, out);
    if (world.clearance(x, z) > ROCK_PATH_CLEARANCE) return a;
    const b = world.rocks.collide(x, z, r, y, hitB);
    if (b && (!a || b.pen > a.pen)) { out.nx = b.nx; out.nz = b.nz; out.pen = b.pen; return out; }
    return a;
  };
  void hitA;
  return { ...world, decks, ground, groundAt, classify, collide, trails, trailById: new Map(trails.map((t) => [t.id, t])) };
}

/** A trail as the game plays it. `centre` = the carved (smoothed) samples [[x, z], ...] every 1 m, `s` their arc length (m). */
export function trailRuntime(t, network, surface, medals) {
  const info = network.ways.find((w) => w.id === `trail-${t.id}`);
  if (!info) throw new Error(`trail ${t.id} is missing from the carved network`);
  const S = network.samples;
  const n = info.count;
  const centre = new Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    centre[i] = [S.px[info.first + i], S.pz[info.first + i]];
    if (i > 0) s[i] = s[i - 1] + Math.hypot(centre[i][0] - centre[i - 1][0], centre[i][1] - centre[i - 1][1]);
  }
  const nearest = (x, z, from = 0) => { let best = from, bd = 1e18; for (let i = from; i < n; i++) { const d = (centre[i][0] - x) ** 2 + (centre[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
  const headingAt = (i) => { const a = centre[Math.max(0, i - 2)], b = centre[Math.min(n - 1, i + 3)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const cps = [];
  let from = 0;
  for (const [x, z] of t.cps || []) { const i = nearest(x, z, from); cps.push({ index: i, s: s[i], x: centre[i][0], z: centre[i][1], n: cps.length + 1 }); from = i; }
  const indexAtS = (m) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] < m) lo = mid + 1; else hi = mid; } return lo; };
  const length = s[n - 1];
  const gate = { index: indexAtS(GATE_AT) }, arch = { index: indexAtS(Math.max(GATE_AT + 5, length - FINISH_BEFORE)) };
  const features = network.features.filter((f) => f.way === `trail-${t.id}`);
  return Object.freeze({
    id: t.id, grade: t.grade, name: t.name, blurb: t.blurb, length, rawLength: t.length, climb: t.climb, descent: t.descent, centre, s, count: n, cps, features, posts: t.posts || [],
    gate, arch, nearest, headingAt, indexAtS, medals: medals || null,
    start: { x: centre[0][0], z: centre[0][1], heading: headingAt(0) },
    checkpointRadius: CHECKPOINT_RADIUS,
  });
}

/** A rider standing on the trail at centre index i (a respawn at a checkpoint, or the start), rolling gently forward. */
export function stateAt(trail, i, ground, roll = 0) {
  const k = Math.max(0, Math.min(trail.count - 1, i));
  const h = trail.headingAt(k);
  const base = createBikeState(trail.centre[k][0], trail.centre[k][1], h, ground);
  return Object.freeze({ ...base, vx: Math.cos(h) * roll, vz: Math.sin(h) * roll, shield: PLAY.respawnShield });
}

export const bikeSpec = (id) => BIKES[id] || BIKES.trail;
