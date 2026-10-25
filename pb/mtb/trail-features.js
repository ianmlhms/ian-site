/* Trail features (kickers, drops, rollers, berms, slabs, roots, mud, leaves, boardwalks, bridges): the PURE part.
 * scripts/mtb/trail_features.py places them along the real path; here each one becomes
 *   - a bed offset (metres, added to the carved bed height) as a function of the distance u along the feature,
 *   - a surface code the bike physics reads (grip, rolling resistance, sound),
 *   - for bridges a deck rectangle (physics + drawing, see decks.js).
 * Everything is a smooth, finite function of u, so the carved ground stays continuous (the harness checks it along every trail). */
const smooth = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const hash = (n) => { let h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

export const SURF = Object.freeze({ dirt: 0, rock: 1, roots: 2, mud: 3, leaves: 4, wood: 5 });
export const SURF_NAMES = Object.freeze(['dirt', 'rock', 'roots', 'mud', 'leaves', 'wood']);
export const FEATURE_KINDS = Object.freeze(['roller', 'kicker', 'drop', 'berm', 'slab', 'roots', 'mud', 'leaves', 'boardwalk', 'bridge']);

/* geometry of the jump features (m) */
export const KICKER = Object.freeze({ ramp: 8, lipFall: 1.0, lipFallPerM: 1.1, landingBack: 1.2, landingShape: 0.75, landingShare: 0.55 });
export const DROP = Object.freeze({ approach: 6, platform: 2, fall: 1.2, fallPerM: 1.15 });      // the face of a lip is never steeper than about 40 degrees: fall length >= 1.1 x height
export const lipFallLength = (h) => Math.max(KICKER.lipFall, KICKER.lipFallPerM * h);
export const dropFallLength = (h) => Math.max(DROP.fall, DROP.fallPerM * h);
const EDGE_FADE = 3;                  // m over which slab / roots / mud blend into the plain path
const ROOT_PERIOD = 2.7;
const ROOT_WIDTH = 0.36;
const SLAB_STEP = 2.3;

export const surfaceOf = (feature) => {
  switch (feature.k) {
    case 'slab': return SURF.rock;
    case 'roots': return SURF.roots;
    case 'mud': return SURF.mud;
    case 'leaves': return SURF.leaves;
    case 'boardwalk': return SURF.wood;
    default: return SURF.dirt;
  }
};

/** Bed offset (m) of a feature at distance u (m) from its first point. 0 outside [0, len]. */
export function featureOffset(feature, u) {
  const len = feature.len;
  if (!(u >= 0 && u <= len)) return 0;
  const h = feature.h || 0;
  switch (feature.k) {
    case 'roller': {
      const lead = 3, n = feature.n || 3, p = feature.p || 7.5;
      const v = u - lead;
      return v < 0 || v > n * p ? 0 : h * (1 - Math.cos(2 * Math.PI * v / p)) / 2;
    }
    case 'kicker': {
      const gap = feature.gap || 4;
      const fall = lipFallLength(h);
      const lipEnd = KICKER.ramp + fall;
      if (u <= KICKER.ramp) return h * smooth(u / KICKER.ramp) ** 1.2;
      if (u <= lipEnd) return h * (1 - smooth((u - KICKER.ramp) / fall));
      const landStart = lipEnd + gap - KICKER.landingBack;
      const span = len - landStart;
      if (u < landStart || span <= 1) return 0;
      const t = (u - landStart) / span;
      return h * KICKER.landingShare * Math.sin(Math.PI * t ** KICKER.landingShape) ** 1.5;
    }
    case 'drop': {
      if (u <= DROP.approach) return h * smooth(u / DROP.approach);
      if (u <= DROP.approach + DROP.platform) return h;
      const t = (u - DROP.approach - DROP.platform) / dropFallLength(h);
      return t >= 1 ? 0 : h * (1 - smooth(t));
    }
    case 'slab': {
      const fade = smooth(u / EDGE_FADE) * smooth((len - u) / EDGE_FADE);
      const k = Math.floor(u / SLAB_STEP), f = u / SLAB_STEP - k;
      const a = hash(k * 31 + Math.round(len * 10)) * h, b = hash((k + 1) * 31 + Math.round(len * 10)) * h;
      return fade * (a + (b - a) * smooth((f - 0.7) / 0.3));          // flat steps with a short riser
    }
    case 'roots': {
      const fade = smooth(u / EDGE_FADE) * smooth((len - u) / EDGE_FADE);
      let sum = 0;
      const k0 = Math.floor(u / ROOT_PERIOD);
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        const c = (k + 0.5 + (hash(k * 17 + 3) - 0.5) * 0.6) * ROOT_PERIOD;
        const amp = h * (0.55 + 0.9 * hash(k * 13 + 7));
        sum = Math.max(sum, amp * Math.exp(-(((u - c) / ROOT_WIDTH) ** 2)));
      }
      return fade * sum;
    }
    case 'mud': return -0.05 * smooth(u / EDGE_FADE) * smooth((len - u) / EDGE_FADE);
    default: return 0;
  }
}

/** Positions (m from the feature start) of the root arcs drawn by props.js (the same function the offset uses). */
export function rootCentres(feature) {
  const out = [];
  for (let k = 0; (k + 0.5) * ROOT_PERIOD < feature.len; k++) {
    const c = (k + 0.5 + (hash(k * 17 + 3) - 0.5) * 0.6) * ROOT_PERIOD;
    if (c > EDGE_FADE * 0.6 && c < feature.len - EDGE_FADE * 0.6) out.push({ u: c, size: 0.55 + 0.9 * hash(k * 13 + 7), turn: hash(k * 5 + 1) });
  }
  return out;
}

/**
 * Resolves a trail's feature list onto the resampled way samples.
 * rs = { x[], z[] } samples, s[] cumulative arc length. Returns { offset: Float64Array, surf: Uint8Array, bermBoost: Uint8Array, mute: Uint8Array, resolved: [...] }
 * `mute` marks samples that must not carve at all (under a bridge deck: the creek stays a creek).
 */
export function resolveFeatures(features, rs, s, spacing, onWarn = () => {}) {
  const n = rs.x.length;
  const offset = new Float64Array(n), surf = new Uint8Array(n), bermBoost = new Uint8Array(n), mute = new Uint8Array(n);
  const resolved = [];
  for (const f of features || []) {
    if (!FEATURE_KINDS.includes(f.k) || !(f.len > 0)) { onWarn(`unknown or empty feature ${f && f.k}`); continue; }
    let i0 = -1, best = 25;                                           // the nearest sample within 5 m of the feature's first point
    for (let i = 0; i < n; i++) { const d = (rs.x[i] - f.x) ** 2 + (rs.z[i] - f.z) ** 2; if (d < best) { best = d; i0 = i; } }
    if (i0 < 0) { onWarn(`feature ${f.k} at ${f.x},${f.z} is not on its trail`); continue; }
    let i1 = i0;
    while (i1 < n - 1 && s[i1] - s[i0] < f.len) i1++;
    const code = surfaceOf(f);
    for (let i = i0; i <= i1; i++) {
      const u = s[i] - s[i0];
      offset[i] += featureOffset(f, u);
      if (code !== SURF.dirt) surf[i] = code;
      if (f.k === 'berm') bermBoost[i] = 1;
      if (f.k === 'bridge') mute[i] = 1;
    }
    resolved.push({ ...f, i0, i1, s0: s[i0], s1: s[i1] });
  }
  return { offset, surf, bermBoost, mute, resolved };
}
