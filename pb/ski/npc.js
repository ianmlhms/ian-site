/* The other skiers (computer-controlled, "Aner Skifuerer"): so the ski area is never empty. Pure (no THREE, no DOM): the Node check
 * (scripts/ski/npc-check.mjs) runs exactly this code; npc-view.js draws what update() lists.
 *   on the pistes   a population per piste (density by colour, time of day), each skier deterministic from (seed, piste id, i): a skill
 *                   (beginner in the plough on the greens, skidded turns, fast carvers, a few tucking), a lane, turn width / length,
 *                   sometimes a stop at the side of the piste, a rest after the bottom. Where he is at time t is ANALYTIC (a speed
 *                   profile per piste: slower on the flats, faster on the steeps), so the far ones cost nothing; the ones listed near
 *                   the camera get a little state (avoidance of the player and of each other, the side they pass a house on)
 *   at the lifts    a few standing at each bottom station (beside / behind the boarding zone, never in it, on the belt or in the gate);
 *                   at a busy lift (lift-queue.js: a queue maze) the line: groups in the lanes, shuffling forward, into the zone, through
 *                   the gate onto the loading line / to the door, onto the carrier (the riders it shows are that group)
 *   on the lifts    seats of the real carriers (lifts.js asks riders(lift, carrier id)): deterministic per carrier, so a chair keeps its
 *                   riders from the bottom to the top
 *   in the villages walking along the streets with the skis on the shoulder
 * Never: inside a building, a station, a pylon, a tree or a net (a clear band across every piste sample, built on demand), in the
 * corridor of a running challenge, on top of each other or of the player (soft: both just give way). */
import { NPC } from './config.js';
import { createLineIndex } from './pistes.js';
import { worldcupNets } from './landmarks.js';
import { createQueueSim } from './lift-queue.js';
import { BELT_TOP } from './lift-path.js';

/* ---------- deterministic numbers ---------- */
function mix(h, v) { h = Math.imul(h ^ (v | 0), 0x9e3779b1); return (h ^ (h >>> 15)) | 0; }
/** A number in [0, 1) from integer keys (the same keys always give the same number). */
export function rand01(a, b = 0, c = 0, d = 0, e = 0) {
  let h = mix(mix(mix(mix(mix(0x811c9dc5, a), b), c), d), e);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function strHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0; return h; }
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The poses npc-view.js bakes (one row of its pose texture each); a drawn skier blends two of them. */
export const POSE = Object.freeze({ ski: 0, carveL: 1, carveR: 2, tuck: 3, plough: 4, stand: 5, sit: 6, cabin: 7, walkA: 8, walkB: 9, drag: 10 });
/** 28 Nov 2026: every pose again on a snowboard (pose + BOARD_POSE: riding / heel side / toe side / crouch / skid / standing on it,
 *  the board off the front foot on a chair, in the hand in a cabin and walking, on a drag lift). */
export const BOARD_POSE = 11;
export const POSE_COUNT = 22;
/** Is this person a snowboarder? u = his own random number 0..1 (NPC.boardShare of them are). */
export const isBoarder = (u) => u < NPC.boardShare;
/** a person's raw outfit number (lift-queue.js outfitOf: 0..999) as his board coin: the same person in the line and on the chair */
const boardCoin = (raw) => ((raw * 7919 + 13) % 1000) / 1000;
const boardOf = (o, on) => { if (on) { o.poseA += BOARD_POSE; o.poseB += BOARD_POSE; } o.board = !!on; return o; };
export const OUTFIT_COUNT = 10;                     // skier-model.js OUTFITS (all of them, the star ones too)

/** The identity of a loop carrier (lifts.js): its lattice slot, constant while it travels once round the loop. */
export const carrierId = (u, A, gap) => Math.round((u - A) / gap);

/* ---------- skills ---------- */
const SKILLS = ['beginner', 'skid', 'carve', 'tuck'];
const SKILL_MIX = { green: [0.58, 0.36, 0.06, 0], blue: [0.22, 0.56, 0.19, 0.03], red: [0.03, 0.5, 0.37, 0.1], black: [0, 0.36, 0.5, 0.14] };
const SKILL = {
  beginner: { v: [3.6, 6.2], amp: [3.5, 6], len: [20, 30], k: 0.45 },
  skid: { v: [6.5, 10], amp: [4, 7.5], len: [26, 40], k: 0.7 },
  carve: { v: [10, 15], amp: [5, 9], len: [36, 56], k: 0.85 },
  tuck: { v: [15, 20], amp: [0.6, 1.6], len: [80, 110], k: 1 },
};
const BAND_STEP = 3;                 // m between the clear bands across a piste (each tested with the body + half a step: nothing
                                     // as small as a pylon slips through between two)
const PROF_STEP = 20;                // m between the speed profile's samples
const lerp = (a, b, k) => a + (b - a) * k;

/** The day's crowd share by the hour (fewer early, most at midday, few at the end of the day). */
export function dayShare(hour) {
  if (!Number.isFinite(hour)) return 1;
  if (hour < 9.5) return 0.65;
  if (hour < 10.5) return lerp(0.65, 1, hour - 9.5);
  if (hour < 14) return 1;
  if (hour < 15) return lerp(1, 0.75, hour - 14);
  if (hour < 16) return lerp(0.75, 0.45, hour - 15);
  return 0.3;
}

/* Which pistes pass near a point (cleanup round, memory): a grid of PISTE_CELL m cells holding the pistes whose line crosses the cell
 * (each once), not every segment (the segment index took ~4.5 MB of JS heap at 3 Vallees / Arlberg and only ever answered this). A
 * piste is listed for the cells its line touches (vertices padded by its half width, long segments sampled every half cell); the
 * query reads the cells of the box round the disc + half a cell, so every piste with a line point within R is found (a few beyond
 * it too: their skiers are dropped by distance anyway). Pure. */
const PISTE_CELL = 120;
export function pisteGrid(list, cell) {
  const grid = new Map();
  for (const p of list) {
    const pad = p.halfWidth;
    for (let i = 0; i < p.n; i++) {
      const i0 = Math.floor((p.x[i] - pad) / cell), i1 = Math.floor((p.x[i] + pad) / cell);
      const j0 = Math.floor((p.z[i] - pad) / cell), j1 = Math.floor((p.z[i] + pad) / cell);
      for (let gi = i0; gi <= i1; gi++) for (let gj = j0; gj <= j1; gj++) {
        const k = gi * 65536 + gj;
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        if (a[a.length - 1] !== p) a.push(p);
      }
      // a long segment: the cells between its two ends too
      if (i + 1 < p.n) {
        const L = Math.hypot(p.x[i + 1] - p.x[i], p.z[i + 1] - p.z[i]), steps = Math.floor(L / (cell * 0.5));
        for (let k2 = 1; k2 <= steps; k2++) {
          const t = k2 / (steps + 1), x = p.x[i] + (p.x[i + 1] - p.x[i]) * t, z = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
          const k = Math.floor(x / cell) * 65536 + Math.floor(z / cell);
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          if (a[a.length - 1] !== p) a.push(p);
        }
      }
    }
  }
  for (const [k, a] of grid) grid.set(k, [...new Set(a)]);
  return grid;
}
/** The pistes listed in the cells of the box round (x, z) +- r (a Set). */
export function pistesNear(grid, cell, x, z, r) {
  const out = new Set();
  for (let gi = Math.floor((x - r) / cell); gi <= Math.floor((x + r) / cell); gi++) {
    for (let gj = Math.floor((z - r) / cell); gj <= Math.floor((z + r) / cell); gj++) {
      const a = grid.get(gi * 65536 + gj);
      if (a) for (const p of a) out.add(p);
    }
  }
  return out;
}

/**
 * resort = resort.json (unpacked), pistes = createPisteSet, liftNet = modes/freeride.js createLiftNet (its world: stations, zones),
 * height(x, z) = the snow, standY(x, z) = where feet stand (decks), seed = an integer.
 */
export function createCrowd({ resort, pistes, liftNet, height, standY = height, seed = 1 }) {
  const pisteCells = pisteGrid(pistes.list, PISTE_CELL);
  const pIndex = new Map(pistes.list.map((p, i) => [p, i]));
  const pSeed = pistes.list.map((p) => strHash(p.id));
  const pops = new Map();                  // piste -> { skiers, T (time per unit speed), n }
  const bands = new Map();                 // piste -> Map(sample -> intervals [lo, hi, lo, hi ...])
  let blocked = () => false;               // (x, z, r) -> a building / station / pylon / tree there
  let roads = [];
  let walkers = null;
  const queues = new Map();                // lift index -> spots
  const carpets = new Map();               // lift index -> the beginners of a magic carpet (or null: no clear lane beside it)
  let nets = null;                         // the race nets as segments (grid)
  const state = new Map();                 // id -> per-skier state while listed near the camera
  const list = [];                         // the skiers drawn this frame (reused objects)
  const pool = [];
  let selT = -1e9, selX = NaN, selZ = NaN, selected = [];
  const stats = { pistes: 0, candidates: 0, listed: 0, bands: 0, ms: 0 };
  let bandBudget = 0;

  /* ---------- the race nets (landmarks.js worldcupNets, the same nets the game draws) ---------- */
  function netIndex() {
    if (nets) return nets;
    const segs = [];
    for (const lm of resort.landmarks || []) {
      if (lm.kind !== 'worldcup') continue;
      const p = pistes.byId.get(lm.piste);
      if (!p) continue;
      try {
        for (const run of worldcupNets(p, height, pistes).runs) for (let k = 0; k + 5 < run.length; k += 3) segs.push([run[k], run[k + 2], run[k + 3], run[k + 5]]);
      } catch (error) { console.warn('[ski] npc: race nets', error); }
    }
    const grid = new Map(), C = 40;
    for (const s of segs) {
      for (let i = Math.floor(Math.min(s[0], s[2]) / C); i <= Math.floor(Math.max(s[0], s[2]) / C); i++) for (let j = Math.floor(Math.min(s[1], s[3]) / C); j <= Math.floor(Math.max(s[1], s[3]) / C); j++) {
        const k = i * 100003 + j; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(s);
      }
    }
    nets = {
      segs,
      near(x, z, r) {
        const a = grid.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
        if (!a) return false;
        for (const s of a) {
          const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9, t = clamp(((x - s[0]) * dx + (z - s[1]) * dz) / L2, 0, 1);
          if (Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t) < r) return true;
        }
        return false;
      },
    };
    return nets;
  }
  /** Anything a skier must not stand in at (x, z) with radius r: the caller's obstacles, the race nets, every station footprint (decks,
   *  gates, belts, boarding zones: only the queue stands near them, at its own spots). */
  function solid(x, z, r) {
    if (blocked(x, z, r)) return true;
    if (netIndex().near(x, z, r + 0.6)) return true;
    const w = liftNet.world;
    return !!(w && w.inStation(x, z, r));
  }

  /* ---------- one piste's population ---------- */
  function popOf(p) {
    let pop = pops.get(p);
    if (pop) return pop;
    const ps = pSeed[pIndex.get(p)];
    // the speed profile: steeper = faster (f), the time to reach each sample at unit speed (T)
    const n = Math.max(2, Math.ceil(p.length / PROF_STEP) + 1);
    const f = new Float32Array(n), T = new Float64Array(n);
    const q = {}, q2 = {};
    for (let j = 0; j < n; j++) {
      const s = Math.min(p.length, j * PROF_STEP);
      p.at(Math.max(0, s - 10), q); p.at(Math.min(p.length, s + 10), q2);
      const run = Math.max(1, Math.hypot(q2.x - q.x, q2.z - q.z));
      const drop = (height(q.x, q.z) - height(q2.x, q2.z)) / run;
      f[j] = clamp(0.5 + drop * 2.4, 0.5, 1.35);
    }
    for (let j = 1; j < n; j++) T[j] = T[j - 1] + PROF_STEP * 2 / (f[j - 1] + f[j]);
    const per = NPC.perMetre[p.diff] || NPC.perMetre.blue;
    const count = Math.min(NPC.maxPerPiste, Math.max(1, Math.round(p.length * per)));
    const mixW = SKILL_MIX[p.diff] || SKILL_MIX.blue;
    const skiers = [];
    for (let i = 0; i < count; i++) {
      const r = (k) => rand01(seed, ps, i, k);
      let u = r(1), si = 0;
      while (si < 3 && u >= mixW[si]) { u -= mixW[si]; si++; }
      const skill = SKILLS[si], S = SKILL[skill];
      const hw = p.halfWidth;
      const v = lerp(S.v[0], S.v[1], r(2));
      const amp = Math.min(lerp(S.amp[0], S.amp[1], r(3)), Math.max(0.5, hw * 0.6));
      const lane = (r(4) * 2 - 1) * Math.max(0, hw - amp - 2.5);
      const stops = r(5) < NPC.stopShare;
      const stopS = p.length * lerp(0.18, 0.85, r(6));
      const stopSide = r(7) < 0.5 ? -1 : 1;
      const stopFor = stops ? lerp(NPC.stopSeconds[0], NPC.stopSeconds[1], r(8)) : 0;
      const rest = lerp(NPC.restSeconds[0], NPC.restSeconds[1], r(9));
      const lineT = T[n - 1] / v;                                      // s down the whole piste at its own speed
      const period = lineT + stopFor + rest;
      skiers.push({
        id: (pIndex.get(p) + 1) * 4096 + i, i, skill, v, k: S.k, amp, len: lerp(S.len[0], S.len[1], r(10)), phase: r(11) * Math.PI * 2, lane,
        stopS, stopSide, stopFor, stopLane: stopSide * Math.max(0, hw - 3.5), rest, lineT, period, t0: r(12) * period,
        outfit: Math.floor(r(13) * OUTFIT_COUNT) % OUTFIT_COUNT, active: r(14), scale: lerp(0.9, 1.06, r(15)), board: isBoarder(r(16)),
      });
    }
    pop = { p, skiers, T, f, n };
    pops.set(p, pop);
    return pop;
  }
  /** s along the piste after `tau` s of skiing at base speed v (the profile's inverse). */
  function sAt(pop, v, tau) {
    const want = tau * v, T = pop.T, n = pop.n;
    if (want >= T[n - 1]) return pop.p.length;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= want) lo = m; else hi = m; }
    return Math.min(pop.p.length, (lo + (want - T[lo]) / ((T[hi] - T[lo]) || 1)) * PROF_STEP);
  }
  /** The time (at unit base speed) to reach s. */
  const tOf = (pop, s) => { const j = clamp(s / PROF_STEP, 0, pop.n - 1), i = Math.floor(j); return lerp(pop.T[i], pop.T[Math.min(pop.n - 1, i + 1)], j - i); };
  const fAt = (pop, s) => { const j = clamp(s / PROF_STEP, 0, pop.n - 1), i = Math.floor(j), k = j - i; return lerp(pop.f[i], pop.f[Math.min(pop.n - 1, i + 1)], k); };

  /* ---------- clear bands across the piste (built on demand, a few per frame) ---------- */
  const bq = {}, fa = {}, fb = {};
  /** The line point at s with its direction smoothed over +-4 m (the polyline's corners would turn the cross-section in steps). */
  function frameAt(p, s, out) {
    p.at(Math.max(0, s - 4), fa); p.at(Math.min(p.length, s + 4), fb); p.at(s, out);
    const lx = fb.x - fa.x, lz = fb.z - fa.z, ll = Math.hypot(lx, lz);
    if (ll > 1e-3) { out.dx = lx / ll; out.dz = lz / ll; }
    return out;
  }
  /** The clear stretches of the cross-section at sample j: [lo, hi, lo, hi, ...] (m right of the line), [] = nothing clear, null = not
   *  built yet (over this frame's budget). */
  function bandAt(p, j) {
    let m = bands.get(p);
    if (!m) bands.set(p, (m = new Map()));
    const have = m.get(j);
    if (have) return have;
    if (bandBudget <= 0) return null;
    bandBudget--;
    stats.bands++;
    frameAt(p, Math.min(p.length, j * BAND_STEP), bq);
    const hw = Math.max(1.5, p.halfWidth - NPC.edgeMargin), out = [];
    let run = null;
    const STEP = 1;
    for (let o = -hw; o <= hw + 1e-6; o += STEP) {
      const x = bq.x - bq.dz * o, z = bq.z + bq.dx * o;
      const ok = !solid(x, z, NPC.bodyR + BAND_STEP / 2 + 0.1);
      if (ok) { if (run === null) run = o; }
      else if (run !== null) { if (o - STEP - run >= 0.5) out.push(run, o - STEP); run = null; }
    }
    if (run !== null) out.push(run, hw);
    out.full = out.length === 2 && out[0] <= -hw + 1e-6 && out[1] >= hw - 1e-6;      // nothing anywhere across: no spot test needed
    m.set(j, out);
    return out;
  }
  /** Is the cross-section round s clear all the way across (both samples it is drawn between)? */
  function bandFull(p, s) {
    const m = bands.get(p), j = Math.round(s / BAND_STEP);
    if (!m) return false;
    const a = m.get(j), b = m.get(j - 1), c = m.get(j + 1);
    return !!(a && a.full && b && b.full && c && c.full);
  }
  /** The clear offset nearest `want` at s (prefer the stretch that holds `keep`, the side a near skier is already on); NaN = none. */
  function clearOffset(p, s, want, keep = NaN) {
    const j = Math.round(s / BAND_STEP);
    const b = bandAt(p, j), b2 = bandAt(p, Math.min(Math.ceil(p.length / BAND_STEP), j + 1));
    if (!b || !b2) return NaN;
    if (!b.length) return NaN;
    let best = NaN, bd = Infinity;
    const ref = Number.isFinite(keep) ? keep : want;
    for (let k = 0; k < b.length; k += 2) {
      const lo = b[k] + 0.3, hi = b[k + 1] - 0.3;
      if (hi < lo) continue;
      const c = clamp(want, lo, hi), d = Math.abs(clamp(ref, lo, hi) - ref) * 3 + Math.abs(c - want);
      if (d < bd) { bd = d; best = c; }
    }
    // the next sample must hold it too (no gliding into a house between two samples)
    if (Number.isFinite(best) && b2.length) {
      let inside = false;
      for (let k = 0; k < b2.length; k += 2) if (best >= b2[k] - 0.2 && best <= b2[k + 1] + 0.2) { inside = true; break; }
      if (!inside) {
        let nb = NaN, nd = Infinity;
        for (let k = 0; k < b2.length; k += 2) { const c = clamp(best, b2[k], b2[k + 1]); for (let m = 0; m < b.length; m += 2) if (c >= b[m] && c <= b[m + 1] && Math.abs(c - best) < nd) { nd = Math.abs(c - best); nb = c; } }
        best = nb;
      }
    } else if (!b2.length) best = NaN;
    return best;
  }

  /* ---------- one piste skier at time t (analytic; st = his near state or null) ---------- */
  const qc = {};
  /** Fills o: { visible, x, z, heading, speed, edge, stop, s, off } for skier k of pop at t. */
  function skierAt(pop, k, t, o, st = null, raw = false) {
    const p = pop.p;
    const lag = st ? st.lag : 0;
    let tau = (((t - lag + k.t0) % k.period) + k.period) % k.period;
    o.visible = false;
    if (tau >= k.lineT + k.stopFor) return o;                          // resting (at the bottom, on a lift): not on this piste
    // the stop at the side: reached at stopS (the line time to it at his speed), held stopFor s
    const tStop = k.stopFor ? tOf(pop, k.stopS) / k.v : Infinity;
    let stopK = 0, s;
    if (tau < tStop) s = sAt(pop, k.v, tau);
    else if (tau < tStop + k.stopFor) { s = k.stopS; stopK = 1; }
    else s = sAt(pop, k.v, tau - k.stopFor);
    if (s >= p.length - 0.5) return o;
    const v = stopK ? 0 : k.v * Math.pow(fAt(pop, s), k.k);
    // lateral: the lane + the turns; to the side of the piste before a stop and back after it
    const w = 2 * Math.PI / k.len;
    const turnK = 1 - 0.85 * smooth(1 - Math.abs(s - k.stopS) / 30) * (k.stopFor ? 1 : 0);
    let off = k.lane + k.amp * turnK * Math.sin(s * w + k.phase);
    const side = k.stopFor ? smooth(1 - Math.max(0, Math.abs(s - k.stopS) - 4) / 28) : 0;
    off = lerp(off, k.stopLane, side);
    let dOff = k.amp * turnK * w * Math.cos(s * w + k.phase) * (1 - side);
    const d2 = -k.amp * turnK * w * w * Math.sin(s * w + k.phase) * (1 - side);
    if (st) off += st.av;                                              // near: giving way
    const want = off;
    if (!raw) off = clearOffset(p, s, want, st ? st.off : NaN);
    if (!Number.isFinite(off)) { if (st) st.off = NaN; return o; }
    if (Math.abs(off - want) > 0.05) dOff *= 0.3;
    if (raw) p.at(s, qc); else frameAt(p, s, qc);                     // (the selection only needs roughly where)
    const dx = qc.dx, dz = qc.dz;
    o.x = qc.x - dz * off; o.z = qc.z + dx * off;
    // the bands are 3 m apart: where the line bends sharply the cross-section turns between two, so a near skier's own spot is tested
    // too (towards the line until clear, else not drawn this frame)
    // (a spot that was clear last frame is tested every other frame: he moves 0.3 m a frame, the next test catches a hit at once)
    let inside = false;
    if (!raw && st && !bandFull(p, s) && !(st.clear && (st.alt = !st.alt))) { inside = solid(o.x, o.z, NPC.bodyR); st.clear = !inside; }
    if (inside) {
      let ok = false;
      for (let k = 1; k <= 8 && !ok; k++) {
        const o2 = off - Math.sign(off) * k;
        if (Math.sign(o2) !== Math.sign(off) && k > 1) break;
        const x = qc.x - dz * o2, z = qc.z + dx * o2;
        if (!solid(x, z, NPC.bodyR)) { o.x = x; o.z = z; off = o2; ok = true; }
      }
      if (!ok) { st.off = NaN; return o; }
    }
    if (st) st.off = off;
    const hLine = Math.atan2(dz, dx);
    let heading = hLine + Math.atan(dOff);
    let edge = clamp(Math.atan(v * v * d2 / 9.81) / 0.56, -1, 1);
    if (stopK) {
      // standing across the fall line, turned towards his side of the piste (eased in and out of the stop)
      const into = tau - tStop, outT = tStop + k.stopFor - tau, e = smooth(Math.min(into, outT) / 0.9);
      heading = hLine + k.stopSide * 1.25 * e;
      edge = 0;
    }
    o.visible = true; o.heading = heading; o.speed = v; o.edge = edge; o.stop = stopK; o.s = s; o.off = off;
    o.vx = Math.cos(heading) * v; o.vz = Math.sin(heading) * v;
    return o;
  }

  /* ---------- the queues at the bottom stations ---------- */
  function queueOf(index) {
    if (queues.has(index)) return queues.get(index);
    const site = liftNet.world && liftNet.world.sites.get(index);
    const out = [];
    queues.set(index, out);
    const key = site ? site.key : '';
    if (!site || !NPC.queue[key] || site.queue) return out;              // (a lift with a maze: its line, lineOf)
    const path = site.path, f = site.bottom;
    const bOut = path.side + path.carrier.hw + 0.6;
    const z = site.zone;
    // spots: behind the boarding zone (away from the line) and beside it, never in the zone, the gate, the belt or the carriers' lane
    const regions = key === 'drag' || key === 'rope'
      ? [[z.a1 + 2.2, z.a1 + 9, z.b1 + 1.3, z.b1 + 2.6]]
      : [[z.a1 + 1.6, z.a1 + 8, z.b0 - 0.2, z.b1 + 2.2], [z.a0 - 0.5, z.a1 + 1.4, z.b1 + 1.6, z.b1 + 4.6]];
    const cand = [];
    regions.forEach(([a0, a1, b0, b1], ri) => {
      for (let a = a0; a <= a1; a += 1.15) for (let b = b0; b <= b1; b += 1.1) cand.push([a, b, ri]);
    });
    const ls = strHash(`lift${index}`);
    cand.forEach((c, i) => { c[3] = rand01(seed, ls, i, 77); });
    cand.sort((u, v) => u[3] - v[3]);
    const want = NPC.queue[key];
    const lq = {};
    for (const [a0, b0] of cand) {
      if (out.length >= want) break;
      const a = a0 + (rand01(seed, ls, out.length, 3) - 0.5) * 0.4, b = b0 + (rand01(seed, ls, out.length, 4) - 0.5) * 0.4;
      const w = f.toWorld(a, b, {});
      if (site.inZone(w.x, w.z)) continue;
      const l = f.toLocal(w.x, w.z, lq);
      if (l.b < bOut + 0.8) continue;                                     // the lane, the gate, the belt
      if (site.chair && l.b < site.chair.bGate + 1.4 && l.a > site.chair.aGate - 1.6 && l.a < site.chair.aGate + 1.6) continue;
      if (blocked(w.x, w.z, NPC.bodyR + 0.25) || (liftNet.world.hit(w.x, w.z, NPC.bodyR + 0.25) !== null)) continue;
      if (out.some((q) => Math.hypot(q.x - w.x, q.z - w.z) < 1.05)) continue;
      const i = out.length;
      out.push({ id: 2e6 + index * 64 + i, index, x: w.x, z: w.z, heading: site.wait.heading + (rand01(seed, ls, i, 5) - 0.5) * 0.7, outfit: Math.floor(rand01(seed, ls, i, 6) * OUTFIT_COUNT) % OUTFIT_COUNT, share: rand01(seed, ls, i, 7), phase: rand01(seed, ls, i, 8) * 6.28, scale: lerp(0.9, 1.06, rand01(seed, ls, i, 9)), board: isBoarder(rand01(seed, ls, i, 10)) });
    }
    return out;
  }

  /* ---------- the magic carpets (28 Nov 2026): a few beginners wait at the foot, ride the belt up (standing, at the player's belt speed),
   * step off at the top and plough down a lane beside the belt, back to the foot. Analytic like the pistes (a cycle per person from the
   * game clock), no state, no draw calls of its own. A carpet without a clear lane on either side has nobody. ---------- */
  function carpetFolk(l) {
    if (carpets.has(l.index)) return carpets.get(l.index);
    carpets.set(l.index, null);
    const site = liftNet.world && liftNet.world.sites.get(l.index), C = NPC.carpet;
    if (!site || !site.path) return null;
    const path = site.path, L = path.len;
    const q = {};
    const lane = (sgn, s, out) => {                                           // the lane side `sgn` at s (m along the belt; before 0 / after L: straight on)
      path.at(Math.max(0, Math.min(L, s)), q);
      const over = s < 0 ? s : s > L ? s - L : 0;
      out.x = q.x + q.dx * over - q.dz * C.lane * sgn; out.z = q.z + q.dz * over + q.dx * C.lane * sgn; out.dx = q.dx; out.dz = q.dz;
      return out;
    };
    const clear = (sgn) => {
      const o = {};
      for (let s = -3; s <= L + 3; s += 2) { lane(sgn, s, o); if (solid(o.x, o.z, NPC.bodyR + 0.15)) return false; }
      return true;
    };
    const sgn = clear(1) ? 1 : clear(-1) ? -1 : 0;
    if (!sgn) return null;
    const ls = strHash(`carpet${l.index}`), n = clamp(Math.round(L * C.perM), C.min, C.max), folk = [];
    for (let i = 0; i < n; i++) {
      const r = (k) => rand01(seed, ls, i, k);
      const wait = lerp(C.wait[0], C.wait[1], r(1)), vd = lerp(C.down[0], C.down[1], r(2));
      const T = { wait, up: L / C.speed, off: 1.4, down: (L + 6) / vd, back: 1.6, in: 1.1 };
      const P = T.wait + T.in + T.up + T.off + T.down + T.back;
      folk.push({ id: 4e6 + l.index * 16 + i, index: l.index, path, sgn, L, vd, T, P, t0: r(3) * P, outfit: Math.floor(r(4) * OUTFIT_COUNT) % OUTFIT_COUNT, scale: lerp(0.86, 0.98, r(5)), share: r(6), board: isBoarder(r(7)), phase: r(8) * 6.28, lane });
    }
    carpets.set(l.index, folk);
    return folk;
  }
  /** One carpet beginner at game time t: fills o (x, z, heading, poses, belt = standing on the belt). */
  function carpetAt(c, t, o) {
    const T = c.T, u = (((t + c.t0) % c.P) + c.P) % c.P, q = {};
    const C = NPC.carpet;
    const hold = (sgn, s, out) => c.lane(sgn, s, out);
    const up = (s, out) => { c.path.at(Math.max(0, Math.min(c.L, s)), q); out.x = q.x; out.z = q.z; out.dx = q.dx; out.dz = q.dz; return out; };
    o.belt = 0; o.speed = 0;
    let k;
    const foot = { x: 0, z: 0, dx: 0, dz: 0 }, a = {}, b = {};
    hold(c.sgn, -2.2, foot);
    if (u < T.wait) {                                                          // waiting at the foot, beside the belt's start
      o.x = foot.x; o.z = foot.z; o.heading = Math.atan2(foot.dz, foot.dx) + Math.sin(t * 0.21 + c.phase) * 0.25;
      o.poseA = POSE.stand; o.poseB = POSE.plough; o.blend = 0.12 + 0.1 * Math.sin(t * 0.13 + c.phase);
      return o;
    }
    const heading = (d) => Math.atan2(d.dz, d.dx);
    if (u < T.wait + T.in) {                                                   // stepping onto the belt's start
      k = smooth((u - T.wait) / T.in);
      up(0, a);
      o.x = lerp(foot.x, a.x, k); o.z = lerp(foot.z, a.z, k); o.heading = heading(a); o.belt = k;
      o.poseA = POSE.stand; o.poseB = POSE.plough; o.blend = 0.2 * (1 - k); o.speed = 1;
      return o;
    }
    if (u < T.wait + T.in + T.up) {                                            // up the belt
      const s = (u - T.wait - T.in) * C.speed;
      up(s, a);
      o.x = a.x; o.z = a.z; o.heading = heading(a); o.belt = 1; o.speed = C.speed;
      o.poseA = POSE.stand; o.poseB = POSE.plough; o.blend = 0.05;
      return o;
    }
    if (u < T.wait + T.in + T.up + T.off) {                                    // off at the top, over to the lane
      k = smooth((u - T.wait - T.in - T.up) / T.off);
      up(c.L, a); hold(c.sgn, c.L + 3, b);
      o.x = lerp(a.x, b.x, k); o.z = lerp(a.z, b.z, k);
      o.heading = heading(a) + Math.PI * smooth(Math.max(0, (k - 0.35) / 0.65));           // turns round to go down
      o.belt = 1 - k;
      o.poseA = POSE.stand; o.poseB = POSE.plough; o.blend = 0.1 + 0.3 * k; o.speed = 1;
      return o;
    }
    if (u < T.wait + T.in + T.up + T.off + T.down) {                           // down the lane in the plough, wide slow turns
      const d = u - T.wait - T.in - T.up - T.off, s = c.L + 3 - d * c.vd;
      hold(c.sgn, s, a);
      const w = Math.sin(d * 0.9 + c.phase);
      o.x = a.x; o.z = a.z; o.heading = heading(a) + Math.PI + w * 0.12; o.speed = c.vd;
      o.poseA = POSE.plough; o.poseB = w > 0 ? POSE.carveR : POSE.carveL; o.blend = Math.min(0.35, Math.abs(w) * 0.4);
      return o;
    }
    k = smooth((u - T.wait - T.in - T.up - T.off - T.down) / T.back);          // the last steps back to the waiting spot
    hold(c.sgn, c.L + 3 - (T.down) * c.vd, a);
    o.x = lerp(a.x, foot.x, k); o.z = lerp(a.z, foot.z, k); o.heading = heading(a) + Math.PI; o.speed = 1;
    o.poseA = POSE.plough; o.poseB = POSE.stand; o.blend = k;
    return o;
  }

  /* ---------- the lines at the busy lifts (lift-queue.js) ---------- */
  const sims = new Map();                  // lift index -> createQueueSim (for the site of the current world)
  const lineClock = new Map();             // lift index -> the last clock (a jig-back the player rides: the line waits)
  const gates = new Map();                 // lift index -> this frame's chair gate (0..1) for the line walking through it
  let selMazes = [];
  /** The line of lift `index` (null: no maze there). */
  function lineOf(index) {
    const site = liftNet.world && liftNet.world.sites.get(index);
    if (!site || !site.queue) return null;
    let sim = sims.get(index);
    if (!sim || sim.maze !== site.queue) { sim = createQueueSim(site, seed, index); sims.set(index, sim); }
    return sim;
  }
  /** The clock of a line: the carriers' lattice (lifts.js latticeA) or the jig-back cycle; in Node (no lifts.js) the lifts' start. */
  function clockOf(sim, index, t, lifts) {
    const site = liftNet.world.sites.get(index), p = site.path, off = (index * 7.31) % 50;
    if (sim.maze.loop) {
      const A = lifts && lifts.latticeA ? lifts.latticeA(index) : null;
      const a = A === null || A === undefined ? t * p.spec.speed + off : A;
      return { phi: (p.upU(site.boardS) - a) / p.spec.gap };
    }
    let c = lifts && lifts.shuttleClock ? lifts.shuttleClock(index) : undefined;
    if (c === undefined) { const T = (p.docks[1] - p.docks[0]) / (p.spec.speed * 4), cyc = 2 * (T + 8), v = t + off; c = { c: Math.floor(v / cyc), u: ((v % cyc) + cyc) % cyc, dwell: 8 }; }
    if (c === null) c = lineClock.get(index) || null;
    if (c) lineClock.set(index, c);
    return c;
  }

  /* ---------- walkers in the villages (along the streets, skis on the shoulder) ---------- */
  function walkerList() {
    if (walkers) return walkers;
    walkers = [];
    const places = (resort.places || []).filter((p) => p.kind === 'village' || p.kind === 'town' || p.kind === 'hamlet');
    roads.forEach((r, ri) => {
      if (!r.pts || r.pts.length < 2) return;
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      const L = cum[cum.length - 1];
      if (L < 30) return;
      const mid = r.pts[Math.floor(r.pts.length / 2)];
      if (!places.some((p) => Math.hypot(p.x - mid[0], p.z - mid[1]) < NPC.walkNear)) return;
      const n = Math.min(NPC.walkPerRoad, Math.floor(L / 55));
      for (let i = 0; i < n; i++) {
        const rr = (k) => rand01(seed, 9001, ri, i, k);
        const side = (rr(1) < 0.5 ? -1 : 1) * Math.max(0.8, Math.min(r.hw * 0.55, r.hw - 0.9));
        const wk = { id: 3e6 + ri * 8 + i, road: r, cum, L, side, v: lerp(1.05, 1.45, rr(2)), t0: rr(3) * 1000, outfit: Math.floor(rr(4) * OUTFIT_COUNT) % OUTFIT_COUNT, share: rr(5), scale: lerp(0.9, 1.06, rr(6)), board: isBoarder(rr(7)), x: mid[0], z: mid[1] };
        // the whole lane must be clear (a house at a street corner: that walker stays home)
        let clear = true;
        const o = {};
        for (let s = 0; s <= L && clear; s += 1) { walkAt(wk, s, o); if (solid(o.x, o.z, NPC.bodyR + 0.2)) clear = false; }
        if (clear) walkers.push(wk);
      }
    });
    return walkers;
  }
  function walkAt(wk, s, o) {
    const { road: r, cum } = wk;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = r.pts[i - 1], b = r.pts[i], L = cum[i] - cum[i - 1] || 1, k = clamp((s - cum[i - 1]) / L, 0, 1);
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    o.x = a[0] + (b[0] - a[0]) * k - dz * wk.side; o.z = a[1] + (b[1] - a[1]) * k + dx * wk.side;
    o.dx = dx; o.dz = dz;
    return o;
  }

  /* ---------- riders on the lifts (asked by lifts.js per carrier) ---------- */
  const SEAT_Y = { chair: -2.0, gondola: -4.05, funitel: -4.75, cable: -6.05, train: 0.5 };
  const riderBuf = [];
  for (let i = 0; i < 12; i++) riderBuf.push({ a: 0, b: 0, y: 0, yaw: 0, pose: 0, outfit: 0, scale: 1 });
  /** The riders of carrier `id` of lift `index` (kind, seats, sub): count n in riderBuf[0..n) with { a (forward), b (right), y (below
   *  the grip / above the rail), yaw, pose, outfit } in the carrier's own frame; share = the day's crowd share. Deterministic. */
  function riders(index, id, kind, seats, sub, share = 1) {
    // a busy lift's line put them on: that group, in those seats / spots, in those outfits (the ride-down ids are the old kind)
    const line = id < 5e5 ? lineOf(index) : null;
    if (line && line.maze.loop) return lineRiders(line, id, kind, seats, sub, share);
    // the others are deterministic per carrier and asked every frame: computed once, copied from a packed record after that
    const key = index * 4e6 + id;
    const hit = riderMemo.get(key);
    if (hit && hit.share === share) {
      const n = hit.length / 7;
      for (let k = 0; k < n; k++) { const o = riderBuf[k], j = k * 7; o.a = hit[j]; o.b = hit[j + 1]; o.y = hit[j + 2]; o.yaw = hit[j + 3]; o.pose = hit[j + 4]; o.outfit = hit[j + 5]; o.scale = hit[j + 6]; }
      return n;
    }
    const n = ridersPlain(index, id, kind, seats, sub, share);
    const rec = new Float64Array(n * 7);
    rec.share = share;
    for (let k = 0; k < n; k++) { const o = riderBuf[k], j = k * 7; rec[j] = o.a; rec[j + 1] = o.b; rec[j + 2] = o.y; rec[j + 3] = o.yaw; rec[j + 4] = o.pose; rec[j + 5] = o.outfit; rec[j + 6] = o.scale; }
    if (riderMemo.size > 3000) riderMemo.clear();
    riderMemo.set(key, rec);
    return n;
  }
  const riderMemo = new Map();
  function ridersPlain(index, id, kind, seats, sub, share) {
    const occ = NPC.occupancy[kind] || 0;
    const r = (k) => rand01(seed, index, id, k, 4242);
    if (r(1) >= occ * share) return 0;
    let n = 0;
    if (kind === 'chair') {
      const S = Math.max(1, seats || 4), W = Math.max(1.6, Math.min(4.2, S * 0.52)), pitch = (W - 0.25) / S;
      const want = 1 + Math.floor(Math.pow(r(2), 1.6) * S);
      // which seats: a deterministic shuffle of the seat numbers
      const keys = []; for (let x = 0; x < S; x++) keys.push(rand01(seed, index, id, x, 5));        // (one random per seat, not two per comparison)
      const order = [...Array(S).keys()].sort((x, y) => keys[x] - keys[y]);
      for (let k = 0; k < Math.min(want, S, riderBuf.length); k++) {
        const o = riderBuf[n++];
        o.a = -0.05; o.b = (order[k] - (S - 1) / 2) * pitch; o.y = SEAT_Y.chair; o.yaw = 0; o.pose = POSE.sit + (isBoarder(r(80 + k)) ? BOARD_POSE : 0); o.outfit = Math.floor(r(10 + k) * OUTFIT_COUNT) % OUTFIT_COUNT; o.scale = lerp(0.92, 1.04, r(30 + k));
      }
    } else if (kind === 'gondola' || kind === 'cable' || kind === 'train') {
      const spots = kind === 'gondola' ? (sub === 'funitel' ? [[0.7, 0.9], [-0.7, 0.9], [0.7, -0.9], [-0.7, -0.9], [0, 0.2], [0.75, 0], [-0.75, 0]] : [[0.5, 0.45], [-0.5, 0.45], [0.5, -0.45], [-0.5, -0.45]])
        : kind === 'cable' ? [[2.6, 1.3], [1.2, 1.4], [-0.2, 1.3], [-1.6, 1.4], [-2.8, 1.2], [2.4, -1.3], [1.0, -1.4], [-0.4, -1.3], [-1.8, -1.4], [0.4, 0], [-1.2, 0.1], [1.8, 0]]
          : [[4.4, 0.62], [3.0, -0.62], [1.5, 0.62], [0, -0.62], [-1.5, 0.62], [-3.0, -0.62], [-4.4, 0.62], [2.2, 0], [-2.2, 0]];
      const lo = kind === 'gondola' ? 1 : kind === 'cable' ? 4 : 3;
      const want = Math.min(spots.length, riderBuf.length, lo + Math.floor(r(2) * (spots.length - lo + 1)));
      const keys = []; for (let x = 0; x < spots.length; x++) keys.push(rand01(seed, index, id, x, 6));
      const order = [...spots.keys()].sort((x, y) => keys[x] - keys[y]);
      const y = kind === 'gondola' ? (sub === 'funitel' ? SEAT_Y.funitel : SEAT_Y.gondola) : kind === 'cable' ? SEAT_Y.cable : SEAT_Y.train;
      for (let k = 0; k < want; k++) {
        const o = riderBuf[n++], sp = spots[order[k]];
        o.a = sp[0] + (r(40 + k) - 0.5) * 0.12; o.b = sp[1] + (r(50 + k) - 0.5) * 0.1; o.y = y; o.yaw = (r(60 + k) < 0.5 ? 0 : Math.PI) + (r(70 + k) - 0.5) * 0.8; o.pose = POSE.cabin + (isBoarder(r(80 + k)) ? BOARD_POSE : 0);
        o.outfit = Math.floor(r(10 + k) * OUTFIT_COUNT) % OUTFIT_COUNT; o.scale = lerp(0.92, 1.04, r(30 + k));
      }
    } else if (kind === 'drag' && sub !== 'rope') {
      const o = riderBuf[n++];
      o.a = 0; o.b = 0; o.y = 0; o.yaw = 0; o.pose = POSE.drag + (isBoarder(r(80)) ? BOARD_POSE : 0); o.outfit = Math.floor(r(10) * OUTFIT_COUNT) % OUTFIT_COUNT; o.scale = lerp(0.92, 1.04, r(30));
    }
    return n;
  }

  function lineRiders(line, id, kind, seats, sub, share) {
    const gr = line.groupOf(id, share);
    if (!gr) return 0;
    let n = 0;
    if (kind === 'chair') {
      const S = Math.max(1, seats || 4), W = Math.max(1.6, Math.min(4.2, S * 0.52)), pitch = (W - 0.25) / S;
      for (let m = 0; m < Math.min(gr.n, riderBuf.length); m++) {
        const o = riderBuf[n++];
        o.a = -0.05; o.b = (gr.order[m] - (S - 1) / 2) * pitch; o.y = SEAT_Y.chair; o.yaw = 0; o.pose = POSE.sit + (isBoarder(boardCoin(line.outfitOf(gr.k, m))) ? BOARD_POSE : 0);
        o.outfit = line.outfitOf(gr.k, m) % OUTFIT_COUNT; o.scale = line.scaleOf(gr.k, m);
      }
    } else {
      const spots = sub === 'funitel' ? [[0.7, 0.9], [-0.7, 0.9], [0.7, -0.9], [-0.7, -0.9], [0, 0.2], [0.75, 0], [-0.75, 0]] : [[0.5, 0.45], [-0.5, 0.45], [0.5, -0.45], [-0.5, -0.45]];
      const y = sub === 'funitel' ? SEAT_Y.funitel : SEAT_Y.gondola;
      for (let m = 0; m < Math.min(gr.n, spots.length, riderBuf.length); m++) {
        const o = riderBuf[n++], sp = spots[gr.order[m] % spots.length];
        o.a = sp[0]; o.b = sp[1]; o.y = y; o.yaw = (m % 2 ? Math.PI : 0) + (rand01(seed, gr.k, m, 61) - 0.5) * 0.8; o.pose = POSE.cabin + (isBoarder(boardCoin(line.outfitOf(gr.k, m))) ? BOARD_POSE : 0);
        o.outfit = line.outfitOf(gr.k, m) % OUTFIT_COUNT; o.scale = line.scaleOf(gr.k, m);
      }
    }
    return n;
  }

  /* ---------- the list near the camera ---------- */
  function take() { const o = pool.pop() || {}; o.fade = 1; o.stop = 0; o.piste = null; o.hide = false; o.cut = false; o.belt = 0; return o; }
  /** Re-chooses who is listed (a few times a second): every candidate in the radius, nearest first, the ones listed already keep their
   *  place a little longer (no flicker at the edge). */
  function select(t, view, cfg) {
    const { x: fx, z: fz } = view;
    const R = cfg.radius, share = view.share;
    // the cap goes to the ones in front of the camera first (behind it they count 2.5 x as far)
    const cfx = view.fx || 0, cfz = view.fz || 0;
    const rank = (x, z, d) => (cfx || cfz) && (x - fx) * cfx + (z - fz) * cfz < -8 ? d * 2.5 : d;
    const nearP = pistesNear(pisteCells, PISTE_CELL, fx, fz, R + PISTE_CELL / 2);       // (+ half a cell: a line between two samples)
    stats.pistes = nearP.size;
    const had = new Set(selected.map((c) => c.key));
    const cand = [];
    const o = {};
    for (const p of nearP) {
      if (view.skipPiste && view.skipPiste === p) continue;
      const pop = popOf(p);
      for (const k of pop.skiers) {
        if (k.active >= share) continue;
        skierAt(pop, k, t, o, null, true);                             // (no clear band yet: only where he is, roughly)
        if (!o.visible) continue;
        const d = Math.hypot(o.x - fx, o.z - fz);
        if (d > R) continue;
        const dr = rank(o.x, o.z, d);
        cand.push({ key: k.id, kind: 'ski', pop, k, d: had.has(k.id) ? dr * 0.8 : dr });
      }
    }
    const skiers = cand.sort((a, b) => a.d - b.d).slice(0, cfg.skiers);
    const qs = [];
    for (const l of liftNet.list) {
      const d0 = Math.hypot(l.bottom.x - fx, l.bottom.z - fz);
      if (d0 > Math.min(R, cfg.queueRadius)) continue;
      for (const q of queueOf(l.index)) if (q.share < share) qs.push({ key: q.id, kind: 'queue', q, d: rank(q.x, q.z, Math.hypot(q.x - fx, q.z - fz)) });
    }
    qs.sort((a, b) => a.d - b.d);
    // the lines: whole mazes, nearest first, while they fit the level's cap (the nearest always)
    const ms = [];
    for (const l of liftNet.list) {
      const d0 = Math.hypot(l.bottom.x - fx, l.bottom.z - fz);
      if (d0 > Math.min(R, cfg.queueRadius) || !lineOf(l.index)) continue;
      ms.push({ index: l.index, d: rank(l.bottom.x, l.bottom.z, d0) });
    }
    ms.sort((a, b) => a.d - b.d);
    selMazes = [];
    let room = cfg.lines;
    for (const m of ms) {
      const sim = lineOf(m.index), est = sim.maze.npcLanes * sim.maze.lanes[0].cap + 8;
      if (selMazes.length && est > room) break;
      selMazes.push(m.index); room -= est;
    }
    const ws = [];
    for (const w of walkerList()) {
      if (w.share >= share) continue;
      const d = Math.hypot(w.x - fx, w.z - fz);
      if (d < Math.min(R, cfg.walkRadius) + w.L) ws.push({ key: w.id, kind: 'walk', w, d: rank(w.x, w.z, d) });
    }
    ws.sort((a, b) => a.d - b.d);
    // the magic carpets: their beginners, the carpets nearest first (the walkers' radius: they are slow and small)
    const cs = [];
    for (const l of liftNet.list) {
      if (l.kind !== 'carpet') continue;
      const d0 = Math.hypot(l.bottom.x - fx, l.bottom.z - fz);
      if (d0 > Math.min(R, cfg.queueRadius)) continue;
      const folk = carpetFolk(l);
      if (folk) for (const c of folk) if (c.share < share) cs.push({ key: c.id, kind: 'carpet', c, d: rank(l.bottom.x, l.bottom.z, d0) });
    }
    cs.sort((a, b) => a.d - b.d);
    selected = [...skiers, ...qs.slice(0, cfg.queue), ...ws.slice(0, cfg.walkers), ...cs.slice(0, cfg.carpets ?? 6)];
    stats.candidates = cand.length;
    const keep = new Set(selected.map((c) => c.key));
    for (const id of [...state.keys()]) if (!keep.has(id)) state.delete(id);
  }

  const tmp = {};
  const linePeople = [];
  /**
   * Every frame. t = the game clock (s, the lifts' clock too), dt (s), view = { x, z (camera / focus), player: { x, z, vx, vz } | null,
   * level: 'low' | 'medium' | 'high', share (the day's crowd share), hidden(x, z) (a running challenge's corridor), skipPiste }.
   * Returns the list of skiers to draw: { id, kind, x, y, z, heading, poseA, poseB, blend, outfit, scale, speed, fade }.
   */
  function update(t, dt, view) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const cfg = NPC.levels[view.level] || NPC.levels.medium;
    bandBudget = view.bandBudget ?? NPC.bandBudget;
    for (const o of list) pool.push(o);
    list.length = 0;
    if (t - selT > NPC.selectEvery || !(Math.hypot(view.x - selX, view.z - selZ) < 40)) { selT = t; selX = view.x; selZ = view.z; select(t, view, cfg); }
    const pl = view.player;
    for (const c of selected) {
      let st = state.get(c.key);
      if (!st) { st = { av: 0, avT: 0, lag: 0, off: NaN, sx: 0, sz: 0, seen: false }; state.set(c.key, st); }
      const o = take();
      o.id = c.key; o.kind = c.kind; o.scale = 1; o.speed = 0;
      if (c.kind === 'ski') {
        skierAt(c.pop, c.k, t, tmp, st);
        if (!tmp.visible) { pool.push(o); continue; }
        o.x = tmp.x; o.z = tmp.z; o.heading = tmp.heading; o.speed = tmp.speed; o.vx = tmp.vx; o.vz = tmp.vz; o.outfit = c.k.outfit; o.scale = c.k.scale;
        o.stop = tmp.stop; o.s = tmp.s; o.piste = c.pop.p; o.off = tmp.off;
        const e = tmp.edge;
        if (tmp.stop) { o.poseA = POSE.stand; o.poseB = POSE.stand; o.blend = 0; }
        else if (c.k.skill === 'beginner') { o.poseA = POSE.plough; o.poseB = e > 0 ? POSE.carveR : POSE.carveL; o.blend = Math.min(0.35, Math.abs(e) * 0.5); }
        else if (c.k.skill === 'tuck') { o.poseA = POSE.tuck; o.poseB = e > 0 ? POSE.carveR : POSE.carveL; o.blend = Math.min(0.4, Math.abs(e)); }
        else { o.poseA = POSE.ski; o.poseB = e > 0 ? POSE.carveR : POSE.carveL; o.blend = Math.abs(e); }
        boardOf(o, c.k.board);
      } else if (c.kind === 'queue') {
        const q = c.q;
        o.x = q.x + st.sx; o.z = q.z + st.sz; o.heading = q.heading + Math.sin(t * 0.21 + q.phase) * 0.18; o.outfit = q.outfit; o.scale = q.scale;
        o.vx = 0; o.vz = 0; o.poseA = POSE.stand; o.poseB = POSE.plough; o.blend = 0.12 + 0.1 * Math.sin(t * 0.13 + q.phase);
        boardOf(o, q.board);
      } else if (c.kind === 'carpet') {
        carpetAt(c.c, t, tmp);
        o.x = tmp.x; o.z = tmp.z; o.heading = tmp.heading; o.outfit = c.c.outfit; o.scale = c.c.scale; o.speed = tmp.speed;
        o.vx = Math.cos(o.heading) * tmp.speed; o.vz = Math.sin(o.heading) * tmp.speed; o.poseA = tmp.poseA; o.poseB = tmp.poseB; o.blend = tmp.blend; o.belt = tmp.belt;
        boardOf(o, c.c.board);
        if ((pl && Math.hypot(pl.x - o.x, pl.z - o.z) < 1.1) || (view.hidden && view.hidden(o.x, o.z))) { pool.push(o); continue; }       // never inside the player on the same belt
        o.st = null;
        list.push(o);
        continue;
      } else {
        const w = c.w, P = 2 * w.L / w.v, u = (((t + w.t0) % P) + P) % P;
        const fwd = u < P / 2, s = fwd ? u * w.v : w.L - (u - P / 2) * w.v;
        walkAt(w, s, tmp);
        o.x = tmp.x + st.sx; o.z = tmp.z + st.sz; o.heading = Math.atan2(tmp.dz, tmp.dx) + (fwd ? 0 : Math.PI); o.outfit = w.outfit; o.scale = w.scale;
        o.speed = w.v; o.vx = Math.cos(o.heading) * w.v; o.vz = Math.sin(o.heading) * w.v;
        w.x = o.x; w.z = o.z;
        // the turn at each end of his stretch: a short stand
        const endK = Math.min(s, w.L - s);
        o.poseA = POSE.walkA; o.poseB = POSE.walkB; o.blend = endK < 0.6 ? 0.5 : 0.5 - 0.5 * Math.sin(s * 2.6);
        boardOf(o, w.board);
      }
      if (view.hidden && view.hidden(o.x, o.z)) { pool.push(o); continue; }
      o.st = st;
      list.push(o);
    }
    // the lines (their own walk: never pushed about, never stepping aside: ropes all round)
    gates.clear();
    for (const index of selMazes) {
      const sim = lineOf(index);
      if (!sim) continue;
      const clock = clockOf(sim, index, t, view.lifts);
      if (!clock) continue;
      const hold = view.hold && view.hold.index === index ? view.hold.kind : '';
      for (const p of sim.people(clock, view.share ?? 1, hold, linePeople)) {
        if (view.hidden && view.hidden(p.x, p.z)) continue;
        const o = take();
        o.id = p.id; o.kind = 'line'; o.x = p.x; o.z = p.z; o.vx = 0; o.vz = 0; o.speed = 0; o.outfit = p.outfit % OUTFIT_COUNT; o.scale = p.scale; o.cut = p.cut;
        const ph = (p.id % 97) * 0.37;
        if (p.carry) {                                  // skis on the shoulder (a cabin's line): walking, or standing (between the steps)
          o.poseA = POSE.walkA; o.poseB = POSE.walkB; o.blend = p.moving ? 0.5 - 0.5 * Math.sin(t * 7 + ph) : 0.5;
          o.heading = p.heading + (p.moving ? 0 : Math.sin(t * 0.21 + ph) * 0.12);
        } else if (p.moving) { o.poseA = POSE.ski; o.poseB = POSE.plough; o.blend = 0.35 + 0.25 * Math.sin(t * 6 + ph); o.heading = p.heading; }
        else { o.poseA = POSE.stand; o.poseB = POSE.plough; o.blend = 0.12 + 0.1 * Math.sin(t * 0.13 + ph); o.heading = p.heading + Math.sin(t * 0.21 + ph) * 0.15; }
        boardOf(o, isBoarder(boardCoin(p.outfit)));
        o.st = null;
        list.push(o);
      }
      if (sim.gate > 0) gates.set(index, sim.gate);
      else if (sim.maze.kind === 'chair') gates.set(index, 0);
    }
    giveWay(dt, pl);
    // a running challenge's corridor: checked last (giving way may move somebody)
    if (view.hidden) for (let i = list.length - 1; i >= 0; i--) if (view.hidden(list[i].x, list[i].z)) { pool.push(list[i]); list.splice(i, 1); }
    for (const o of list) o.y = o.kind === 'carpet' ? height(o.x, o.z) + BELT_TOP * (o.belt || 0) : o.kind === 'ski' ? height(o.x, o.z) : standY(o.x, o.z);
    stats.listed = list.length;
    stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return list;
  }

  /** The near ones give way: a skier (in his lane: the avoidance offset `av`, eased) steers round the player ahead of / beside him and
   *  round the others; if he cannot, he slows (lag). Standing ones (queue, walkers) step aside. Then a last push apart (never overlap). */
  const pairs = [];
  /** me moves aside for other (dx, dz = other - me) if other is ahead of him, or stands / waits. */
  function yieldTo(me, other, dx, dz, need) {
    if (me.kind !== 'ski' || me.stop) return;
    const hx = Math.cos(me.heading), hz = Math.sin(me.heading), side = -hz * dx + hx * dz;      // other's side of me
    if (dx * hx + dz * hz <= 0 && other.kind === 'ski' && !other.stop) return;                 // other is behind: he gives way
    me.st.avT += side > 0 ? -need : need;
  }
  function giveWay(dt, pl) {
    const R2 = NPC.personal * 2;
    for (const o of list) {
      const st = o.st;
      if (!st) continue;                                                   // (the lines: their own walk)
      let want = 0, slow = 0;
      if (pl && o.kind === 'ski' && !o.stop) {
        // the closest approach to the player over the next 2 s (both straight on)
        const rx = pl.x - o.x, rz = pl.z - o.z, vx = (pl.vx || 0) - o.vx, vz = (pl.vz || 0) - o.vz, v2 = vx * vx + vz * vz;
        const tc = v2 > 1e-4 ? clamp(-(rx * vx + rz * vz) / v2, 0, 2) : 0;
        const cx = rx + vx * tc, cz = rz + vz * tc, dmin = Math.hypot(cx, cz);
        if (dmin < NPC.clearPlayer && Math.hypot(rx, rz) < 40) {
          // the player's side of the skier's line of travel: go the other way
          const hx = Math.cos(o.heading), hz = Math.sin(o.heading), side = -hz * cx + hx * cz;
          const need = (NPC.clearPlayer - dmin) * 1.2;
          want = side > 0 ? -need : need;
          if (tc < 0.8 && Math.hypot(rx, rz) < 6 && rx * hx + rz * hz > 0) slow = 1;
        }
      }
      st.avT = want;
      if (slow) st.lag += dt * NPC.yieldSlow;                              // he cannot get by: he slows (falls behind his schedule)
    }
    // the others: the pairs closer than 2 x personal space (n <= ~80: a plain scan with a box test is cheaper than a grid)
    pairs.length = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.kind === 'line' || o.kind === 'carpet') continue;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j], dx = q.x - o.x, dz = q.z - o.z;
        if (q.kind === 'line' || q.kind === 'carpet') continue;
        if (dx > R2 || dx < -R2 || dz > R2 || dz < -R2) continue;
        pairs.push(i, j);
        const d = Math.hypot(dx, dz);
        if (d >= R2) continue;
        // the one behind (uphill / later) gives way: moves aside in his lane
        const need = R2 - d;
        yieldTo(o, q, dx, dz, need);
        yieldTo(q, o, -dx, -dz, need);
      }
    }
    const ease = 1 - Math.exp(-dt * NPC.avoidRate);
    for (const o of list) {
      const st = o.st;
      if (o.kind === 'ski') {
        const before = st.av;
        st.av += (clamp(st.avT, -NPC.avoidMax, NPC.avoidMax) - st.av) * ease;
        const dAv = st.av - before, nx = o.x - Math.sin(o.heading) * dAv, nz = o.z + Math.cos(o.heading) * dAv;
        if (dAv > -1e-6 && dAv < 1e-6) continue;                           // (settled: he is where the analytic part put him, already checked)
        if (!solid(nx, nz, NPC.bodyR)) { o.x = nx; o.z = nz; } else st.av = before;     // this frame's share now (the analytic part next frame)
      }
    }
    // standing ones step out of the player's way (back slowly when he is gone)
    if (pl) {
      for (const o of list) {
        if (o.kind === 'ski' || o.kind === 'line' || o.kind === 'carpet') continue;
        const st = o.st, dx = o.x - pl.x, dz = o.z - pl.z, d = Math.hypot(dx, dz);
        const tx = d < NPC.stepAside && d > 1e-3 ? st.sx + dx / d * (NPC.stepAside - d) : 0, tz = d < NPC.stepAside && d > 1e-3 ? st.sz + dz / d * (NPC.stepAside - d) : 0;
        const k = 1 - Math.exp(-dt * (d < NPC.stepAside ? 6 : 0.4));
        const nx = st.sx + (clamp(tx, -2.2, 2.2) - st.sx) * k, nz = st.sz + (clamp(tz, -2.2, 2.2) - st.sz) * k;
        if (Math.abs(nx - st.sx) < 1e-5 && Math.abs(nz - st.sz) < 1e-5) continue;      // (not moving: nothing to test)
        const bx = o.x - st.sx + nx, bz = o.z - st.sz + nz;
        if (!solid(bx, bz, NPC.bodyR) || o.kind === 'queue') { o.x = bx; o.z = bz; st.sx = nx; st.sz = nz; }
      }
    }
    // last: nobody inside anybody (pushed apart along the line between them; skiers only sideways within their clear band)
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < pairs.length; k += 2) {
        const o = list[pairs[k]], q = list[pairs[k + 1]];
        const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz), min = NPC.bodyR * 2 + 0.25;
        if (d >= min) continue;
        const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0, push = (min - d) / 2 + 0.01;
        const mo = movable(o, -ux * push, -uz * push), mq = movable(q, ux * push, uz * push);
        if (mo && mq) { shift(o, -ux * push, -uz * push); shift(q, ux * push, uz * push); }
        else if (mo) shift(o, -ux * push * 2, -uz * push * 2);
        else if (mq) shift(q, ux * push * 2, uz * push * 2);
        else if (o.kind !== 'queue' && q.kind !== 'queue') { o.hide = true; }                     // nowhere to go (never seen: a safety net)
      }
    }
    // and never inside the player (he is pushed by collide(); here they step out of him)
    if (pl) {
      const min = NPC.bodyR + NPC.playerR + 0.05;
      for (const o of list) {
        if (o.kind === 'line' || o.kind === 'carpet') continue;            // (the player is bumped out of them: collide; carpet folk: never listed within 1.1 m)
        const dx = o.x - pl.x, dz = o.z - pl.z, d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const ux = d > 1e-4 ? dx / d : -Math.sin(o.heading), uz = d > 1e-4 ? dz / d : Math.cos(o.heading), push = min - d + 0.01;
        if (movable(o, ux * push, uz * push)) shift(o, ux * push, uz * push);
      }
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].hide) { list[i].hide = false; pool.push(list[i]); list.splice(i, 1); }
  }
  /** May o move by (dx, dz)? A queue stands at its station (in its footprint): only the solid parts, the zone and the lane count. */
  function movable(o, dx, dz) {
    const x = o.x + dx, z = o.z + dz;
    if (o.kind !== 'queue') return !solid(x, z, NPC.bodyR);
    const w = liftNet.world;
    return !blocked(x, z, NPC.bodyR) && !(w && (w.hit(x, z, NPC.bodyR) || w.boardingAt(x, z) !== null));
  }
  function shift(o, dx, dz) {
    o.x += dx; o.z += dz;
    if (o.kind === 'ski') { const hx = Math.cos(o.heading), hz = Math.sin(o.heading); o.st.av += -hz * dx + hx * dz; }
    else { o.st.sx += dx; o.st.sz += dz; }
  }

  /** The player's step against the listed skiers (soft, never a crash): pushed out of a skier he runs into, the speed towards him
   *  mostly taken out (a bump), a little speed lost; the skier is nudged aside too. prev / st = skier.js states. Returns st or a copy. */
  function collide(prev, st) {
    if (!st || st.ride || st.crash > 0 || !list.length) return st;
    let out = st;
    for (const o of list) {
      const dx = out.x - o.x, dz = out.z - o.z;
      if (Math.abs(dx) > 2 || Math.abs(dz) > 2) continue;
      if (out.y - (o.y ?? out.y) > 1.6) continue;                    // flying over him
      const d = Math.hypot(dx, dz), min = NPC.bodyR + NPC.playerR;
      if (d >= min) continue;
      const nx = d > 1e-4 ? dx / d : Math.cos(st.heading + Math.PI / 2), nz = d > 1e-4 ? dz / d : Math.sin(st.heading + Math.PI / 2);
      const rvx = out.vx - (o.vx || 0), rvz = out.vz - (o.vz || 0), into = -(rvx * nx + rvz * nz);
      let vx = out.vx, vz = out.vz;
      if (into > 0) { vx += nx * into * 0.85; vz += nz * into * 0.85; }
      const keep = into > 0 ? Math.max(0.75, 1 - into * 0.03) : 1;
      vx *= keep; vz *= keep;
      const pen = min - d;
      out = { ...out, x: out.x + nx * pen, z: out.z + nz * pen, vx, vz, speed: Math.hypot(vx, vz) };
      if (o.st && o.kind !== 'line') { if (o.kind === 'ski') o.st.av -= (-Math.sin(o.heading) * nx + Math.cos(o.heading) * nz) * 0.6; else { o.st.sx -= nx * 0.3; o.st.sz -= nz * 0.3; } o.st.lag += 0.3; }
      stats.bumps = (stats.bumps || 0) + 1;
    }
    return out;
  }

  return {
    update, collide, riders, riderBuf, list, stats, popOf, skierAt, queueOf, walkerList, solid, lineOf,
    /** This frame's chair gates opened by the lines: Map(lift index -> 0..1) (main.js lifts.setGate; 0 = shut it again). */
    gates,
    /** The player at lift `index` (view.hold): { clearIn (s until the zone ahead of him is free), after (s until their carrier has passed
     *  the loading line: his must come after it) }. */
    /** Lift lines: the player is put down in lift `index`'s zone: the group there goes. */
    clearZone(index) { const sim = sims.get(index); if (sim) sim.clearZone(); },
    lineInfo(index) { const sim = sims.get(index); return sim ? { clearIn: sim.clearIn, after: sim.after } : { clearIn: 0, after: 0 }; },
    get selected() { return selected; },
    /** obstacles(x, z, r) -> true where a skier must not stand (main.js: trees, stations, pylons, houses); the bands are built again. */
    setBlocked(fn) { blocked = fn || (() => false); bands.clear(); queues.clear(); carpets.clear(); sims.clear(); walkers = null; state.clear(); },
    setRoads(rows) { roads = rows || []; walkers = null; },
    reset() { state.clear(); selected = []; selT = -1e9; for (const o of list) pool.push(o); list.length = 0; },
    netIndex,
  };
}

/** A running challenge's corridor (the course line + its half width + margin): hidden(x, z) for update(). */
export function corridorOf(piste, s0, s1, margin = NPC.corridorMargin) {
  const idx = createLineIndex([{ piste, s0: Math.max(0, s0 - 40), s1: Math.min(piste.length, s1 + 20) }], 40);
  const r = piste.halfWidth + margin;
  return (x, z) => idx.distance(x, z, r + 1) < r;
}
export { wrap as wrapAngle };
