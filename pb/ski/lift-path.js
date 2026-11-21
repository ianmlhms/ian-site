/* One lift's line in the world (pure: no THREE, no DOM; lifts.js draws it, modes/liftride.js rides it).
 * Works for whatever lifts the resort data has: the kind string of the data (bake.py LIFT_KIND: chair, gondola, cable, drag, carpet,
 * and the rail kinds funicular / railway / rack / train of the bigger data) is mapped onto five classes:
 *   chair    open chairs hanging under the haul rope (sit)
 *   gondola  small cabins (stand inside)
 *   cable    a big cabin per direction, jig-back (stand inside)
 *   drag     T-bars / platters / rope tows: pulled up on the snow
 *   train    funiculars and rack railways: a carriage on rails on the ground
 * The haul rope rests on the station tops and the pylon tops, and is lifted wherever a straight span would cut the slope. */

export const LIFT_CLASS = Object.freeze({
  chair: 'chair', chair_lift: 'chair', gondola: 'gondola', mixed_lift: 'gondola', cable: 'cable', cable_car: 'cable',
  drag: 'drag', 't-bar': 'drag', 'j-bar': 'drag', platter: 'drag', rope_tow: 'drag',
  train: 'train', funicular: 'train', railway: 'train', rack: 'train', rack_railway: 'train', narrow_gauge: 'train',
});
/** The lift class of a data kind (null = not ridden / not drawn, e.g. magic carpets). */
export const liftClass = (kind) => LIFT_CLASS[kind] || null;

/* Per class: pylon height above the ground (m), carrier gap (m, 0 = one per direction), REAL line speed (m/s), carrier hang below the
 * rope (m), rope offset to each side of the line (m), station hall [width, height, depth] (m) */
export const LIFT_SPEC = Object.freeze({
  chair: { tower: 10.5, gap: 22, speed: 5, hang: 2.9, side: 2.4, station: [10, 5, 6] },
  gondola: { tower: 15, gap: 55, speed: 6, hang: 4.6, side: 3.0, station: [18, 8, 10] },
  cable: { tower: 34, gap: 0, speed: 10, hang: 6.6, side: 5, station: [22, 12, 14] },
  drag: { tower: 6.5, gap: 14, speed: 3, hang: 2.5, side: 0, station: [5, 3.5, 4] },
  train: { tower: 0, gap: 0, speed: 5, hang: 0, side: 2.1, station: [24, 6, 9] },
});

/** The line of one data lift (resort.json lifts[i]: { kind, pts, pylons, seats? }) over the height function height(x, z).
 *  Returns null for a kind that is not ridden. at(s) = { x, z, dx, dz } along the ground line, cableY(s) = the rope (train: the rail top). */
export function createLiftPath(src, height) {
  const kind = liftClass(src.kind);
  if (!kind || !src.pts || src.pts.length < 4) return null;
  const spec = LIFT_SPEC[kind];
  const p = src.pts;
  const n = p.length / 2;
  const sx = new Float64Array(n), sz = new Float64Array(n), ss = new Float64Array(n);
  for (let i = 0; i < n; i++) { sx[i] = p[2 * i]; sz[i] = p[2 * i + 1]; if (i) ss[i] = ss[i - 1] + Math.hypot(sx[i] - sx[i - 1], sz[i] - sz[i - 1]); }
  const len = ss[n - 1];
  function at(s, out = {}) {
    let i = 0;
    while (i < n - 2 && ss[i + 1] < s) i++;
    const seg = (ss[i + 1] - ss[i]) || 1;
    const k = Math.min(1, Math.max(0, (s - ss[i]) / seg));
    out.x = sx[i] + (sx[i + 1] - sx[i]) * k; out.z = sz[i] + (sz[i + 1] - sz[i]) * k;
    out.dx = (sx[i + 1] - sx[i]) / seg; out.dz = (sz[i + 1] - sz[i]) / seg;
    return out;
  }
  const q = {};
  let supports;
  let tunnels = [];
  if (kind === 'train') {
    // the track lies on the ground: a support every 10 m keeps the rail on the snow (bridges over dips are left to the data).
    // Round 7: an underground funicular (data `tunnel`: Funival, Perce-Neige, Sunnegga) runs on a straight grade from its bottom to its top
    // station and never above the ground; where the rock over it is deeper than TUNNEL.cover it is in the tunnel (lifts.js: portals,
    // modes/tunnel.js: the tube while riding).
    supports = [];
    const groundAt = (s) => { at(s, q); return height(q.x, q.z); };
    for (let s = 0; s < len; s += 10) supports.push({ s, y: groundAt(s) + 0.35 });
    supports.push({ s: len, y: groundAt(len) + 0.35 });
    if (src.tunnel) {
      // the grade: TUNNEL.depth under the ground (smoothed, a ramp down from each station), never above the straight line between them
      const y0 = supports[0].y, y1 = supports[supports.length - 1].y;
      const deep = supports.map((p) => p.y - TUNNEL.depth * Math.min(1, p.s / TUNNEL.ramp, (len - p.s) / TUNNEL.ramp));
      const R = 4;
      supports.forEach((p, i) => {
        let sum = 0, c = 0;
        for (let k = Math.max(0, i - R); k <= Math.min(deep.length - 1, i + R); k++) { sum += deep[k]; c++; }
        const ramp = Math.min(1, p.s / TUNNEL.ramp, (len - p.s) / TUNNEL.ramp);
        const smooth = deep[i] + (sum / c - deep[i]) * ramp;              // the stations themselves stay on the ground
        p.y = Math.min(p.y, smooth, y0 + (y1 - y0) * (p.s / (len || 1)));
      });
      tunnels = tunnelSpans(supports, groundAt);
    }
  } else {
    supports = [{ s: 0, y: height(sx[0], sz[0]) + spec.station[1] * 1.25 }];          // the bull-wheel stands above the hall
    const towers = kind === 'cable' && !(src.pylons && src.pylons.length) ? [len / 2] : (src.pylons || []);
    for (const s of towers) { if (s <= 0 || s >= len) continue; at(s, q); supports.push({ s, y: height(q.x, q.z) + spec.tower, tower: true }); }
    supports.push({ s: len, y: height(sx[n - 1], sz[n - 1]) + spec.station[1] * 1.25 });
    supports.sort((a, b) => a.s - b.s);
    // a rope must clear the ground between supports: lift a support where the straight line would cut the slope
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k + 1 < supports.length; k++) {
        const a = supports[k], b = supports[k + 1];
        for (let s = a.s + 10; s < b.s; s += 10) {
          at(s, q);
          const y = a.y + (b.y - a.y) * (s - a.s) / (b.s - a.s);
          const need = height(q.x, q.z) + spec.hang + 2;
          if (y < need) { const up = need - y; if (b.tower) b.y += up; if (a.tower) a.y += up; }
        }
      }
    }
  }
  function cableY(s) {
    let k = 0;
    while (k < supports.length - 2 && supports[k + 1].s < s) k++;
    const a = supports[k], b = supports[k + 1];
    return a.y + (b.y - a.y) * Math.min(1, Math.max(0, (s - a.s) / ((b.s - a.s) || 1)));
  }
  /** The rope's climb at s (dy / ds): carriages tilt with it (trains), the window view looks along it. */
  const slope = (s) => (cableY(Math.min(len, s + 4)) - cableY(Math.max(0, s - 4))) / Math.max(1, Math.min(len, s + 4) - Math.max(0, s - 4));
  const cx = (sx[0] + sx[n - 1]) / 2, cz = (sz[0] + sz[n - 1]) / 2;
  /** Round 7: is s (m along the line) inside a tunnel (with `margin` m of the portal mouth counted in)? */
  const underground = (s, margin = 0) => tunnels.some(([a, b]) => s >= a - margin && s <= b + margin);
  return { src, kind, spec, len, at, cableY, slope, supports, cx, cz, radius: len / 2, seats: Number(src.seats) || (kind === 'chair' ? 4 : kind === 'gondola' ? 8 : 0), tunnels, underground };
}

/* Round 7: the underground stretches of a tunnel funicular. */
export const TUNNEL = Object.freeze({
  depth: 16,                // m: the rail runs this deep under the ground between the portals
  ramp: 70,                 // m: from each station down to that depth (the portal comes after ~15 m)
  cover: 1.2,               // m of ground over the rail top: from here on the line is in the tunnel (the portal stands there, ~10 m past the station)
  minSpan: 30,              // m: a shorter dip under a bump stays a cutting (no portal pair for 20 m)
  width: 9.2, height: 6.6,  // m: the tube's inside (two tracks), its floor is the rail top - 0.4
});
/** [[s0, s1], ...] where the ground stands more than TUNNEL.cover over the rail (supports = [{ s, y }] every 10 m, ground(s)). */
export function tunnelSpans(supports, ground) {
  const out = [];
  let open = null;
  for (const p of supports) {
    const deep = ground(p.s) - p.y > TUNNEL.cover;
    if (deep && open === null) open = p.s;
    if (!deep && open !== null) { if (p.s - open >= TUNNEL.minSpan) out.push([open, p.s]); open = null; }
  }
  if (open !== null) { const end = supports[supports.length - 1].s; if (end - open >= TUNNEL.minSpan) out.push([open, end]); }
  return out;
}
