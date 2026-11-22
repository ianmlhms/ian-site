/* Challenges and stars (round 4A, pure: no THREE, no DOM; the Node checks use the same code).
 * Every timed run on a piste is also its challenge, three stars per piste:
 *   ★1  finish (a valid run: every checkpoint, not impossibly fast)
 *   ★2  under the target time: a 1D ride down the piste's own height profile (far grid, the same everywhere and at any time) with the
 *       friction, drag, a speed cap per colour and a bend limit; so a flat green with a long skate and a steep black are both fair
 *   ★3  the piste's special, drawn once per piste from its id (stable across devices):
 *         gates    every slalom gate clean (only on the slalom pistes)
 *         nocrash  finish without a fall
 *         flags    pick up all flags (placed along the line, a little off it, alternating sides)
 *         speed    reach the top speed target (from the profile: about 85 % of what a tuck can reach there)
 * Stars are a bit mask per piste (1 finish, 2 time, 4 special) OR-ed into the save: a star once won is never lost.
 * Unlocks (round 6): none any more for pistes and outfits (all open); the stars unlock the ski types (modes/skis.js). UNLOCK below is
 * only kept for old callers. */
import { DIFF, SKI } from '../config.js';

export const STAR = Object.freeze({ finish: 1, time: 2, special: 4 });
export const SPECIALS = Object.freeze(['nocrash', 'flags', 'speed']);          // drawn for the pistes without slalom gates
export const SPECIAL_LABEL = Object.freeze({ gates: 'All Slalompaarte propper', nocrash: 'Ouni ze falen', flags: 'All Fändelen sammelen', speed: 'Topspeed' });

/* Star thresholds per resort (stars won in that resort). Every resort has at least 22 green / blue pistes (66 stars), so a red needs a
 * few good runs and a black a short evening of them. */
export const UNLOCK_DEFAULT = Object.freeze({ red: 6, black: 18 });
export const UNLOCK = Object.freeze({
  killy: { red: 6, black: 18 },
  '3vallees': { red: 8, black: 24 },
  zermatt: { red: 5, black: 15 },      // only 22 blues, no greens
  arlberg: { red: 6, black: 18 },
  kronplatz: { red: 4, black: 12 },    // 50 pistes in all
});

/* The 1D target ride (see targetFor) */
const G = 9.81;
const TARGET = Object.freeze({
  step: 10,                 // m between profile samples
  mu: 0.045,                // a little more than groomed snow: a human does not hold a perfect line
  cda: 0.5, mass: 80, air: 1.0,
  cap: { green: 15.5, blue: 18.5, red: 21.5, black: 23.5 },       // m/s a good run holds on this colour
  lateralG: 0.9,            // bend limit: v <= sqrt(lateralG * g * radius)
  skate: 3.2,               // m/s a skier keeps on flats and rises (skating)
  slalomCap: 12,            // m/s between the first and the last slalom gate (round the poles)
  slack: 1.1,               // the target = the ideal ride + 10 % (the careful scripted skier makes it on nearly every piste)
  roundTo: 500,             // ms
});
const SPEED_SHARE = 0.85;
const FLAG_RADIUS = 4.5;     // m: closer than this to a flag picks it up

/** FNV-1a 32-bit of a string (stable choices per piste). */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const specialFor = (piste) => (piste.src && piste.src.slalom ? 'gates' : SPECIALS[hashString(piste.id) % SPECIALS.length]);

/** The ideal 1D ride down the line: { ms, peak (m/s, uncapped tuck), capped } from the far-grid heights (heightAt(x, z)). */
export function profileRide(piste, heightAt) {
  const n = Math.max(2, Math.ceil(piste.length / TARGET.step) + 1);
  const ds = piste.length / (n - 1);
  const p = {}, q = {}, r = {};
  const ys = new Float64Array(n), radius = new Float64Array(n).fill(1e9);
  for (let i = 0; i < n; i++) { piste.at(i * ds, p); ys[i] = heightAt(p.x, p.z); }
  for (let i = 1; i < n - 1; i++) {
    piste.at((i - 1) * ds, p); piste.at(i * ds, q); piste.at((i + 1) * ds, r);
    const a1 = Math.atan2(q.z - p.z, q.x - p.x), a2 = Math.atan2(r.z - q.z, r.x - q.x);
    let da = Math.abs(a2 - a1); if (da > Math.PI) da = 2 * Math.PI - da;
    radius[i] = da > 1e-4 ? ds / da : 1e9;
  }
  const gated = piste.src && piste.src.slalom ? [70, piste.length - 60] : null;
  const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const riseFull = G * Math.sin(6 * Math.PI / 180), riseNone = G * Math.sin(12 * Math.PI / 180);
  // launch follow-up: a good run holds forward, so the arcade assist below SKI.assistTo helps on flats and rises like in the game
  // (skier.js groundStep)
  const assist = (v, gAlong) => (SKI.assistAccel + SKI.assistFlat * (1 - smooth(0, riseFull, gAlong))) * (1 - smooth(riseFull, riseNone, -gAlong)) * (1 - smooth(SKI.assistFull, SKI.assistTo, v));
  const ride = (cap) => {
    let v = 2, t = 0, peak = 0;
    for (let i = 1; i < n; i++) {
      const s = i * ds;
      const c = cap && gated && s > gated[0] && s < gated[1] ? Math.min(cap, TARGET.slalomCap) : cap;
      const dy = ys[i - 1] - ys[i];                          // > 0 downhill
      const len = Math.hypot(ds, dy);
      const sin = dy / len, cos = ds / len;
      const drag = 0.5 * TARGET.air * TARGET.cda * v * v / TARGET.mass;
      const a = G * sin - TARGET.mu * G * cos - drag + assist(v, G * sin);
      let v2 = Math.max(TARGET.skate * TARGET.skate, v * v + 2 * a * len);
      let nv = Math.sqrt(v2);
      if (c) nv = Math.min(nv, c, Math.sqrt(TARGET.lateralG * G * radius[i]));
      else nv = Math.min(nv, 33);
      t += len / Math.max(0.5, (v + nv) / 2);
      v = nv; peak = Math.max(peak, v);
    }
    return { t, peak };
  };
  const capped = ride(TARGET.cap[piste.diff] || TARGET.cap.blue);
  const free = ride(0);
  return { ms: capped.t * 1000, peak: free.peak, capped: capped.peak };
}

/** Everything the three stars of one piste need, computed once per piste (cache it per resort). */
export function challengeFor(piste, heightAt) {
  const ride = profileRide(piste, heightAt);
  const special = specialFor(piste);
  const targetMs = Math.ceil(ride.ms * TARGET.slack / TARGET.roundTo) * TARGET.roundTo;
  const speedKmh = Math.max(40, Math.min(105, Math.floor(ride.peak * 3.6 * SPEED_SHARE / 5) * 5));
  return { id: piste.id, special, targetMs, speedKmh, flags: special === 'flags' ? flagsFor(piste) : [] };
}

/** Flags along the line: one per ~250 m (4..10), from 12 % to 90 % of the length, alternating sides at 30-55 % of the half width. */
export function flagsFor(piste) {
  const count = Math.max(4, Math.min(10, Math.round(piste.length / 250)));
  const h = hashString(piste.id + '/flags');
  const out = [];
  const p = {};
  for (let i = 0; i < count; i++) {
    const s = piste.length * (0.12 + 0.78 * (i / Math.max(1, count - 1)));
    piste.at(s, p);
    const side = (i + h) % 2 ? 1 : -1;
    const share = 0.3 + 0.25 * (((h >>> (i % 24)) & 7) / 7);
    const off = side * Math.min(10, Math.max(2, piste.halfWidth * share));
    out.push({ s, off, x: p.x - p.dz * off, z: p.z + p.dx * off });
  }
  return out;
}

/** The text of the third star (plain Luxembourgish). */
export function specialText(c) {
  if (c.special === 'gates') return 'All Slalompaarte propper';
  if (c.special === 'nocrash') return 'Ouni ze falen';
  if (c.special === 'flags') return `All ${c.flags.length} Fändelen sammelen`;
  return `Op ${c.speedKmh} km/h kommen`;
}

/** One run's tracker: falls, top speed, flags picked up. update() after every physics step; returns the index of a flag just taken. */
export function createTracker(challenge) {
  const got = new Array(challenge.flags.length).fill(false);
  let crashes = 0, top = 0, wasCrash = false;
  return {
    get crashes() { return crashes; }, get top() { return top; }, get flagsGot() { return got.filter(Boolean).length; }, got,
    update(state) {
      if (state.crash > 0 && !wasCrash) crashes++;
      wasCrash = state.crash > 0;
      if (state.crash === 0 && state.speed > top) top = state.speed;
      for (let i = 0; i < got.length; i++) {
        if (got[i]) continue;
        const f = challenge.flags[i];
        if (Math.abs(state.x - f.x) < FLAG_RADIUS && Math.abs(state.z - f.z) < FLAG_RADIUS && Math.hypot(state.x - f.x, state.z - f.z) < FLAG_RADIUS) { got[i] = true; return i; }
      }
      return -1;
    },
    /** Star mask of a finished run (finished = game.js finish event). */
    evaluate(finished) {
      if (!finished || !finished.valid) return 0;
      let mask = STAR.finish;
      if (finished.ms <= challenge.targetMs) mask |= STAR.time;
      const special = challenge.special === 'gates' ? finished.gates > 0 && finished.missedGates === 0
        : challenge.special === 'nocrash' ? crashes === 0
          : challenge.special === 'flags' ? got.length > 0 && got.every(Boolean)
            : top * 3.6 >= challenge.speedKmh;
      if (special) mask |= STAR.special;
      return mask;
    },
  };
}

/* ---------------- stars in the save ----------------
 * progress.stars = { "<resort>/<hash5 of the piste id>": mask }: a short fixed-width key (5 base-36 characters, 60 M values: no clash
 * among a resort's few hundred pistes), so the cloud record (modes/cloud.js) holds every star of all five resorts in a few KB. */
export const hash5 = (id) => hashString(id).toString(36).padStart(7, '0').slice(-5);
export const starKey = (rid, pisteId) => `${rid}/${hash5(pisteId)}`;
export const starCount = (mask) => ((mask & 1) ? 1 : 0) + ((mask & 2) ? 1 : 0) + ((mask & 4) ? 1 : 0);
export const cleanMask = (v) => (Number.isInteger(v) && v > 0 ? v & 7 : 0);

/** A NEW progress with the run's stars OR-ed in: { progress, gained (new star bits) }. */
export function addStars(progress, key, mask) {
  const before = cleanMask(progress.stars[key]);
  const after = before | cleanMask(mask);
  if (after === before) return { progress, gained: 0 };
  return { progress: { ...progress, stars: { ...progress.stars, [key]: after } }, gained: after & ~before };
}

export function resortStars(progress, rid) {
  let n = 0;
  const prefix = `${rid}/`;
  for (const [k, v] of Object.entries(progress.stars || {})) if (k.startsWith(prefix)) n += starCount(cleanMask(v));
  return n;
}
export function totalStars(progress) {
  let n = 0;
  for (const v of Object.values(progress.stars || {})) n += starCount(cleanMask(v));
  return n;
}

/** Old saves: a piste finished before the stars existed (a best time) already earned its first star. Returns a NEW progress. */
export function migrateStars(progress) {
  let stars = null;
  for (const k of Object.keys(progress.best || {})) {
    const cut = k.indexOf('/');
    if (cut < 1) continue;
    const sk = starKey(k.slice(0, cut), k.slice(cut + 1));
    if (cleanMask(progress.stars[sk]) & STAR.finish) continue;
    stars = stars || { ...progress.stars };
    stars[sk] = cleanMask(stars[sk]) | STAR.finish;
  }
  return stars ? { ...progress, stars } : progress;
}

export const thresholds = (rid) => UNLOCK[rid] || UNLOCK_DEFAULT;

export const pisteStars = (progress, rid, pisteId) => cleanMask(progress.stars[starKey(rid, pisteId)]);

/** Is this piste open? Round 6 (Ian): everything is open from the start: every resort, every piste, every outfit. Stars stay the
 *  measure of progress and unlock the ski types (modes/skis.js). { open, need, have } kept for the callers. */
export function lockState(progress, rid, piste) {
  void piste;
  return { open: true, need: 0, have: resortStars(progress, rid) };
}

/** Outfits: all open since round 6 (the `stars` field of skier-model.js OUTFITS is no longer a lock). */
export const outfitOpen = () => true;

export const diffName = (d) => (DIFF[d] ? DIFF[d].name : d);
