/* The projection of the printed piste map (the "Pistekaart"): a bent oblique view like the hand-painted panoramas, the twin of
 * scripts/ski/pano_proj.py (which painted data/<rid>/panorama.webp): same numbers, same table, same bicubic heights (field.js farHeight),
 * so a point of a piste or a lift lands on the very pixel the painter painted. Pure and deterministic: no camera state, no DOM (the Node
 * check scripts/ski/pano-check.mjs runs it).
 *   s = depth (m along the look direction from the front edge of the ski area), r = side offset (m)
 *   u = r * R(s),  v = F(s) + G(s) * (y - y0),  F' = f * R,  G = sqrt(1 - f^2) * E * R
 *   f (sine of the look-down angle): f0 in front ... f1 at the back edge (s = L) ... fi far behind
 *   pixel x = (u - u0) * k,  pixel y = (v1 - v) * k            cam = resort.json panorama.cam */
const S_MIN = -6000, S_MAX = 40000, S_STEP = 25;        // the table of F (keep in step with pano_proj.py)
const NEAR_S = -3500;                                   // the painter's nearest ground
const MARCH = 20, MARCH_FAR = 60;                       // m per step of the way back (screen -> ground)
const HIDE_STEP = 30, HIDE_REACH = 6000, HIDE_EPS = 12;

export function createPano({ panorama, height }) {
  const c = panorama.cam, W = panorama.w, H = panorama.h;
  const a = (c.az * Math.PI) / 180, sa = Math.sin(a), ca = Math.cos(a);
  const f = (s) => (s <= 0 ? c.f0 : s <= c.L ? c.f0 + (c.f1 - c.f0) * (s / c.L) : c.fi + (c.f1 - c.fi) * Math.exp(-(s - c.L) / c.lam));
  const R = (s) => { const b = s > c.L ? (s - c.L) / c.Kb : 0; return 1 / (1 + s / c.K + b * b); };
  const n = Math.round((S_MAX - S_MIN) / S_STEP) + 1;
  const F_TAB = new Float64Array(n);
  for (let i = 1, prev = f(S_MIN) * R(S_MIN); i < n; i++) {
    const q = S_MIN + i * S_STEP, cur = f(q) * R(q);
    F_TAB[i] = F_TAB[i - 1] + (prev + cur) * 0.5 * S_STEP;
    prev = cur;
  }
  const F0 = F_TAB[Math.round(-S_MIN / S_STEP)];
  const F = (s) => {
    const t = Math.min(n - 1, Math.max(0, (s - S_MIN) / S_STEP)), i = Math.min(n - 2, Math.floor(t));
    return F_TAB[i] + (F_TAB[i + 1] - F_TAB[i]) * (t - i) - F0;
  };
  const G = (s) => { const q = f(s); return Math.sqrt(1 - q * q) * c.E * R(s); };

  const depth = (x, z) => (x - c.cx) * sa - (z - c.cz) * ca;
  const side = (x, z) => (x - c.cx) * ca + (z - c.cz) * sa;
  const worldX = (r, s) => c.cx + r * ca + s * sa;
  const worldZ = (r, s) => c.cz + r * sa - s * ca;

  /** World point -> map pixel [px, py] (y: its height, the ground when left out). */
  function project(x, z, y = height(x, z)) {
    const s = depth(x, z);
    return [(side(x, z) * R(s) - c.u0) * c.k, (c.v1 - F(s) - G(s) * (y - c.y0)) * c.k];
  }
  /** The map height v of the ground at depth s on the column u. */
  const vAt = (u, s) => { const r = u / R(s); return F(s) + G(s) * (height(worldX(r, s), worldZ(r, s)) - c.y0); };

  /** Map pixel -> the ground point painted there [x, z]; null in the sky. */
  function unproject(px, py) {
    const u = px / c.k + c.u0, v = c.v1 - py / c.k;
    let prev = NEAR_S;
    for (let s = NEAR_S; s < S_MAX - 100; s += s < c.L + 3000 ? MARCH : MARCH_FAR) {
      if (vAt(u, s) >= v) {
        let lo = prev, hi = s;
        for (let i = 0; i < 12 && hi > lo; i++) { const m = (lo + hi) / 2; if (vAt(u, m) >= v) hi = m; else lo = m; }
        const r = u / R(hi);
        return [worldX(r, hi), worldZ(r, hi)];
      }
      prev = s;
    }
    return null;
  }

  /** Is a ground point behind a nearer ridge? */
  function hidden(x, z, y = height(x, z), eps = HIDE_EPS) {
    const s = depth(x, z), u = side(x, z) * R(s), v = F(s) + G(s) * (y - c.y0) + eps;
    for (let d = HIDE_STEP; d < HIDE_REACH; d += HIDE_STEP) if (vAt(u, s - d) > v) return true;
    return false;
  }

  /** The running skyline per column, coarse: cover(px, s) = the map pixel row of the highest ground in FRONT of depth s on that column
   *  (for thousands of trees: is this one behind a ridge?). Built on the first call (~0.2 M height samples). */
  let cov = null;
  function cover(px, s) {
    if (!cov) {
      const COL = 8, ST = 50, s0 = NEAR_S, ns = Math.ceil((c.L + 4000 - s0) / ST), nc = Math.ceil(W / COL) + 1, d = new Float32Array(nc * ns);
      for (let i = 0; i < nc; i++) {
        const u = (i * COL) / c.k + c.u0;
        let top = -1e9;
        for (let j = 0; j < ns; j++) { top = Math.max(top, vAt(u, s0 + j * ST)); d[i * ns + j] = (c.v1 - top) * c.k; }
      }
      cov = { COL, ST, s0, ns, nc, d };
    }
    const i = Math.min(cov.nc - 1, Math.max(0, Math.round(px / cov.COL))), j = Math.min(cov.ns - 1, Math.max(0, Math.floor((s - cov.s0) / cov.ST) - 1));
    return cov.d[i * cov.ns + j];
  }

  return {
    w: W, h: H, k: c.k, cam: c, project, unproject, hidden, depth, cover,
    inside: (px, py) => px >= 0 && py >= 0 && px <= W && py <= H,
    /** Things get smaller with the distance (1 at the front). */
    sizeAt: (s) => Math.min(1.05, Math.max(0.5, R(s))),
  };
}
