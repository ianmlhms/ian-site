/* Kart Lëtzebuerg — shared helpers. Plain scripts, global namespace KL (works in browsers and in node for the track tools). */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const KL = (root.KL = root.KL || {});
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrapAngle = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
  const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
  /* mulberry32: small seeded RNG so tracks and scenery are identical on every device (and between peers) */
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec == null) return '--:--.---';
    const ms = Math.max(0, Math.round(sec * 1000));
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return m + ':' + String(s).padStart(2, '0') + '.' + String(r).padStart(3, '0');
  }
  const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
  Object.assign(KL, { TAU, clamp, lerp, smooth, wrapAngle, damp, rng, hashStr, fmtTime, ordinal });
})();
