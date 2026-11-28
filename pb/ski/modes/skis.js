/* Ski types (round 6, pure: no THREE, no DOM). Five skis with clearly different handling and their own look; the handling is a set of
 * factors on the physics numbers of config.js SKI (skier.js reads world.ski, a full SKI copy). 28 Nov 2026: and the snowboard (board:
 * true; skier-model.js setBoard draws it): carves hard on its edges, floats in powder, no poles: on a flat it only shuffles slowly
 * (pushAccel / pushMaxSpeed / assistWant), walks up rises slower. Its timed / scored runs follow the same FAIRNESS rule as the skis.
 *
 *   allmountain  the start ski: balanced (the reference: every factor 1)
 *   carving      grips and turns sharp on hard snow, sinks and slows in powder
 *   race         GS race ski: faster (less drag and friction), steady at speed, but wide turns
 *   powder       wide, floats off piste (less sink and drag in deep snow), slow and loose on the hard piste
 *   park         twin tip: spins and flips easier, forgiving landings, a little slower
 *
 * FAIRNESS (decided round 6): every run that is timed or scored against other players (the star challenges = the piste boards, the snow
 * park board, online races) uses the reference physics of the All-Mountain ski, whatever ski the player has on (the look stays). The
 * boards stay one fair list per piste, and the star targets (challenges.js: a 1D ride of the reference skier) stay right. The ski types
 * shape free riding, which is the main game: on and off the piste, natural jumps and the park features while free riding.
 *
 * Unlocks: total stars over all resorts and achievements kept in the progress (stats.off = metres skied off the piste, stats.top = the
 * top speed in m/s, park = best park points per resort). */
import { SKI } from '../config.js';

export const SKI_TYPES = Object.freeze([
  {
    id: 'allmountain', name: 'All-Mountain', short: 'Ausgeglach', text: 'Fir iwwerall: gutt um Pist an och nach am Pulver.',
    look: { base: 0x2a5bd7, art: 0xf4f1ea, tip: 0xf2b21c, length: 1, width: 1, twin: false, pattern: 'stripe' },
    mods: {}, bars: { grip: 3, speed: 3, powder: 3, park: 2 }, unlock: null,
  },
  {
    id: 'carving', name: 'Carving', short: 'Grip a kuerz Kéieren', text: 'Hält op der haarder Pist wéi op Schinnen, séier Kéieren. Am Pulver sénkt en an.',
    look: { base: 0xd0352c, art: 0x16171a, tip: 0xffffff, length: 0.94, width: 1.05, twin: false, pattern: 'chevron' },
    mods: { gripGroomed: 1.3, carveGain: 1.25, edgeLock: 1.35, skidLoss: 0.8, gripPowder: 0.78, muPowder: 1.25, powderDrag: 1.45 },
    bars: { grip: 5, speed: 3, powder: 1, park: 2 }, unlock: { stars: 10 },
  },
  {
    id: 'race', name: 'Race GS', short: 'Topspeed', text: 'Laang a steif: dee Schnellsten, roueg bei héijem Tempo, mee breet Kéieren.',
    look: { base: 0xf4f1ea, art: 0xd0352c, tip: 0x16171a, length: 1.12, width: 0.9, twin: false, pattern: 'race' },
    mods: { cdaTuck: 0.86, cdaUpright: 0.95, muGroomed: 0.88, carveGain: 0.74, pivotRate: 0.8, hardLanding: 1.12, gripGroomed: 1.05, powderDrag: 1.2, gripPowder: 0.9 },
    bars: { grip: 4, speed: 5, powder: 2, park: 1 }, unlock: { stars: 30, topKmh: 90 },
  },
  {
    id: 'powder', name: 'Powder', short: 'Schwëmmt am Pulver', text: 'Breet: schwëmmt am déiwe Schnéi nieft de Pisten. Op Äis a haarder Pist lues a schwammeg.',
    look: { base: 0x2f8f5b, art: 0xf2b21c, tip: 0xf2b21c, length: 1.04, width: 1.55, twin: false, pattern: 'dots' },
    mods: { powderDrag: 0.42, muPowder: 0.62, gripPowder: 1.35, muGroomed: 1.35, gripGroomed: 0.82, carveGain: 0.9 },
    bars: { grip: 2, speed: 2, powder: 5, park: 3 }, unlock: { offKm: 10 },
  },
  {
    id: 'snowboard', name: 'Snowboard', board: true, short: 'Kanten a Pulver', text: 'Säitlech um Board: hält gutt op de Kanten a schwëmmt am Pulver. Keng Stécker: op der Flaach geet et nëmme lues.',
    look: { base: 0x2a3f5f, art: 0xf2b21c, tip: 0xf4f1ea, length: 1, width: 1, twin: false, pattern: 'stripe', board: true },
    mods: { carveGain: 1.3, edgeLock: 1.4, gripGroomed: 1.0, pivotRate: 0.85, skidLoss: 1.1, powderDrag: 0.6, muPowder: 0.75, gripPowder: 1.25, pushAccel: 0.4, pushMaxSpeed: 0.4, climbMax: 0.55, climbSpeed: 0.8, assistWant: 0.1, assistFlat: 0, maxSpeed: 0.95, cdaTuck: 1.05, spinClean: 1.2, spinCrash: 1.15 },
    bars: { grip: 4, speed: 3, powder: 4, park: 4 }, unlock: null,
  },
  {
    id: 'park', name: 'Park Twin-Tip', short: 'Tricks', text: 'Béid Enner opgebéit: dréit a flippt méi liicht, verzeit méi bei der Landung, mee e bësse méi lues.',
    look: { base: 0x6b3fa0, art: 0x31c4c9, tip: 0xff2e88, length: 0.9, width: 1.08, twin: true, pattern: 'zigzag' },
    mods: { spinRate: 1.22, flipRate: 1.18, spinClean: 1.6, spinCrash: 1.3, flipClean: 1.45, flipCrash: 1.25, spinSettle: 1.4, flipSettle: 1.3, parkHardLanding: 1.18, hardLanding: 1.15, cdaTuck: 1.08, muGroomed: 1.08, maxSpeed: 0.92 },
    bars: { grip: 3, speed: 2, powder: 3, park: 5 }, unlock: { parkPoints: 5000 },
  },
]);
export const SKI_BY_ID = new Map(SKI_TYPES.map((t) => [t.id, t]));
export const DEFAULT_SKI = 'allmountain';
export const BAR_LABEL = Object.freeze({ grip: 'Grip', speed: 'Tempo', powder: 'Pulver', park: 'Park' });

/** The full physics numbers of a ski type (a NEW object; config.js SKI is never touched). fair = the reference (All-Mountain) set. */
export function skiParams(id, fair = false) {
  const t = SKI_BY_ID.get(id);
  if (fair || !t) return SKI;
  const out = { ...SKI };
  for (const [k, f] of Object.entries(t.mods)) if (Number.isFinite(out[k])) out[k] = SKI[k] * f;
  return Object.freeze(out);
}

/** What a player has done towards the unlocks: { stars, offKm, topKmh, parkPoints } from a progress (and the total stars). */
export function skiStatsOf(progress, totalStars) {
  const st = progress.stats || {};
  const park = Math.max(0, ...Object.values(progress.park || {}).filter(Number.isFinite));
  return { stars: totalStars, offKm: (st.off || 0) / 1000, topKmh: (st.top || 0) * 3.6, parkPoints: park };
}

/** Is this ski open? { open, parts: [{ label, have, need, done }] } (every part of the rule must be met). */
export function skiUnlock(type, stats) {
  if (!type.unlock) return { open: true, parts: [] };
  const parts = [];
  const u = type.unlock;
  if (u.stars) parts.push({ label: 'Stären', have: stats.stars, need: u.stars, unit: '★' });
  if (u.topKmh) parts.push({ label: 'Topspeed', have: Math.floor(stats.topKmh), need: u.topKmh, unit: 'km/h' });
  if (u.offKm) parts.push({ label: 'Nieft de Pisten', have: Math.floor(stats.offKm * 10) / 10, need: u.offKm, unit: 'km' });
  if (u.parkPoints) parts.push({ label: 'Snowpark (ee Laf)', have: Math.floor(stats.parkPoints), need: u.parkPoints, unit: 'Punkten' });
  for (const p of parts) p.done = p.have >= p.need;
  return { open: parts.every((p) => p.done), parts };
}
export const skiOpen = (id, stats) => { const t = SKI_BY_ID.get(id); return !!t && skiUnlock(t, stats).open; };
/** The plain text of what a locked ski needs. */
export const unlockText = (type) => {
  const u = type.unlock;
  if (!u) return 'Vun Ufank un';
  const out = [];
  if (u.stars) out.push(`${u.stars} ★`);
  if (u.topKmh) out.push(`${u.topKmh} km/h Topspeed`);
  if (u.offKm) out.push(`${u.offKm} km nieft de Pisten`);
  if (u.parkPoints) out.push(`${u.parkPoints.toLocaleString('de-LU')} Punkten an engem Snowpark-Laf`);
  return out.join(' + ');
};

/** The stats in a progress after a stretch of free riding (NEW object): off-piste metres added, the top speed kept. */
export function addSkiStats(progress, { off = 0, top = 0 }) {
  const st = progress.stats || {};
  const next = { off: Math.round((st.off || 0) + Math.max(0, off)), top: Math.max(st.top || 0, Math.min(60, top)) };
  if (next.off === (st.off || 0) && next.top === (st.top || 0)) return progress;
  return { ...progress, stats: next };
}
