/* One lift's line in the world (pure: no THREE, no DOM; lifts.js draws it, modes/liftride.js rides it, lift-site.js builds its stations).
 * Works for whatever lifts the resort data has: the kind string of the data (bake.py LIFT_KIND: chair, gondola, cable, drag, carpet,
 * and the rail kinds funicular / railway / rack / train of the bigger data) is mapped onto six classes:
 *   chair    open chairs hanging under the haul rope (sit)
 *   gondola  small cabins (stand inside, skis carried)
 *   cable    a big cabin per track, jig-back (stand inside, skis carried)
 *   drag     T-bars / platters / J-bars / rope tows (sub = the OSM kind): pulled up on the snow in a track beside the pylons
 *   carpet   a magic carpet: a moving belt on the snow (stand on it)
 *   train    funiculars and rack railways: a carriage on rails on the ground, or in a tunnel (src.tunnel: Funival, Sunnegga, Perce-Neige)
 * The haul rope rests on the station bull-wheels and the pylon tops, sags between them, and is lifted wherever a span would bring the
 * carriers too close to the slope. Round 7-B: the station wheels sit at boarding height (a chair's seat at knee height, a cabin's floor
 * level with the platform), the carriers run as a real loop (up lane, round the top wheel, down lane, round the bottom wheel: loopAt),
 * jig-back cabins and trains shuttle on their own track (shuttleAt), drag lifts have the pylons BESIDE the track (the track is the up
 * lane, `side` metres from the pylon line, the return rope `back` metres on the other side). */

export const LIFT_CLASS = Object.freeze({
  chair: 'chair', chair_lift: 'chair', gondola: 'gondola', mixed_lift: 'gondola', cable: 'cable', cable_car: 'cable',
  drag: 'drag', 't-bar': 'drag', 'j-bar': 'drag', platter: 'drag', rope_tow: 'drag', drag_lift: 'drag',
  carpet: 'carpet', magic_carpet: 'carpet',
  train: 'train', funicular: 'train', railway: 'train', rack: 'train', rack_railway: 'train', narrow_gauge: 'train',
});
/** The lift class of a data kind (null = not ridden / not drawn). */
export const liftClass = (kind) => LIFT_CLASS[kind] || null;
/** Drag lifts by the OSM kind: 'tbar' (two riders), 'platter' (a disc; also the generic drag_lift), 'jbar' (one rider), 'rope' (rope tow). */
export function dragType(src) {
  const t = (src && (src.type || src.kind)) || '';
  return t === 't-bar' ? 'tbar' : t === 'j-bar' ? 'jbar' : t === 'rope_tow' ? 'rope' : 'platter';
}

/* Per class: pylon height above the ground (m), carrier gap (m, 0 = one per track), REAL line speed (m/s), carrier hang below the rope
 * (m), rope offset to the up side of the line (m) and to the return side (`back`, default = side), the rope height at the station
 * wheels (`wheel`), the rope sag per metre of span (`sag`), station hall [width, height, depth] (m, the old box; lift-site.js builds the
 * real stations) */
export const LIFT_SPEC = Object.freeze({
  chair: { tower: 10.5, gap: 22, speed: 5, hang: 2.9, side: 2.4, wheel: 2.68, sag: 0.012, station: [10, 5, 6] },
  gondola: { tower: 15, gap: 55, speed: 6, hang: 4.6, side: 3.0, wheel: 4.48, sag: 0.012, station: [18, 8, 10] },
  cable: { tower: 34, gap: 0, speed: 10, hang: 6.6, side: 5, wheel: 6.62, sag: 0.025, station: [22, 12, 14] },
  drag: { tower: 6.5, gap: 14, speed: 3, hang: 2.5, side: 2.4, back: 1.8, wheel: 3.8, sag: 0.004, station: [5, 3.5, 4] },
  rope: { tower: 1.35, gap: 0, speed: 2.5, hang: 0, side: 1.35, back: 0.9, wheel: 1.05, sag: 0.0015, station: [3, 2.4, 3] },
  carpet: { tower: 0, gap: 0, speed: 1.4, hang: 0, side: 0, wheel: 0, sag: 0, station: [2, 1, 2] },
  train: { tower: 0, gap: 0, speed: 5, hang: 0, side: 2.1, wheel: 0, sag: 0, station: [24, 6, 9] },
});
/** Carrier half sizes (m): lateral, along the travel, the drop from the rope to its lowest point, the rise above the rope (the grip). */
export function carrierBox(kind, seats = 4, sub = '') {
  if (kind === 'chair') { const W = chairWidth(seats); return { hw: W / 2 + 0.05, hl: 0.62, drop: 2.68, top: 0.12 }; }
  if (kind === 'gondola') return { hw: 1.0, hl: 1.05, drop: 4.25, top: 0.12 };
  if (kind === 'cable') return { hw: 2.25, hl: 3.55, drop: 6.25, top: 0.2 };
  if (kind === 'drag') return sub === 'rope' ? { hw: 0.1, hl: 0.15, drop: 0.25, top: 0.1 } : { hw: sub === 'tbar' ? 0.55 : 0.3, hl: 0.2, drop: 1.5, top: 0.1 };
  if (kind === 'train') return { hw: 1.32, hl: 6.3, drop: 0, top: 3.3 };
  return { hw: 0.5, hl: 0.5, drop: 0, top: 0.2 };
}
/** A chair's width by its seat count (carriers.js builds the same width). */
export const chairWidth = (seats) => Math.max(1.6, Math.min(4.2, (seats || 4) * 0.52));
const SHUTTLE = new Set(['cable', 'train', 'carpet']);
/** m along the up lane from the bottom end where the rider is picked up, and before the top end where he gets off (per station key:
 *  the class, rope tows their own); a jig-back cabin / train docks with its middle there. */
export const BOARD = Object.freeze({ chair: 3.2, gondola: 6, cable: 7, drag: 3, rope: 2, carpet: 0.8, train: 9 });
export const UNLOAD = Object.freeze({ chair: 4, gondola: 6, cable: 7, drag: 5, rope: 3, carpet: 0.8, train: 9 });
/** m of line inside a station hall where the rope runs level at the wheel's height (the carriers pass at boarding height). */
const STATION_LEN = Object.freeze({ chair: 5.5, gondola: 14.8, cable: 14, drag: 0, rope: 0, carpet: 0, train: 0 });
const TUNNEL_DEPTH = 9;              // m of rock over the tunnel roof in the middle of an underground funicular
const TUNNEL_RAMP = 70;              // m over which the line dives from the station into the hill

/** The line of one data lift (resort.json lifts[i]: { kind, type, pts, pylons, seats?, tunnel? }) over the height function height(x, z).
 *  Returns null for a kind that is not ridden. at(s) = { x, z, dx, dz } along the ground line, cableY(s) = the rope (train: the rail
 *  top; carpet: the belt). */
export function createLiftPath(src, height) {
  const kind = liftClass(src.kind) || liftClass(src.type);
  if (!kind || !src.pts || src.pts.length < 4) return null;
  const sub = kind === 'drag' ? dragType(src) : '';
  const base = LIFT_SPEC[sub === 'rope' ? 'rope' : kind];
  const seats = Number(src.seats) || (kind === 'chair' ? 4 : kind === 'gondola' ? 8 : 0);
  const cb = carrierBox(kind, seats, sub);
  // a wide chair needs its rope farther out, or its inner seat would brush the pylon column
  const side = kind === 'chair' ? Math.max(base.side, cb.hw + 0.95) : base.side;
  const back = base.back !== undefined ? base.back : side;
  const spec = { ...base, side, back };
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
  const ground = (s) => { at(s, q); return height(q.x, q.z); };
  const tunnel = kind === 'train' && !!src.tunnel && len > 2 * TUNNEL_RAMP + 40;
  const key = sub === 'rope' ? 'rope' : kind;
  // drag lifts: the track on the side the data says (bake.py `track`: away from a neighbouring lift), +1 = the right of the line
  const sign = kind === 'drag' && src.track === -1 ? -1 : 1;
  let supports;
  if (kind === 'train' || kind === 'carpet') {
    // the track lies on the ground (a support every 10 m keeps the rail on the snow); an underground funicular dives into the hill
    // from its stations and runs TUNNEL_DEPTH m under the lowest ground above it (the profile smoothed, so the carriage rides calmly)
    const lift = kind === 'carpet' ? 0.18 : 0.35;
    supports = [];
    const step = kind === 'carpet' ? 2 : 10;
    for (let s = 0; s < len; s += step) supports.push({ s, y: ground(s) + lift });
    supports.push({ s: len, y: ground(len) + lift });
    if (tunnel) {
      const y0 = supports[0].y, y1 = supports[supports.length - 1].y;
      const raw = supports.map((u) => {
        const dive = Math.min(1, Math.max(0, (Math.min(u.s, len - u.s) - 10) / TUNNEL_RAMP));
        const chord = y0 + (y1 - y0) * u.s / len;
        return dive <= 0 ? u.y : Math.min(chord, u.y - (TUNNEL_DEPTH + 6) * dive);
      });
      // smooth (a running mean over ~60 m), then never above the raw profile
      const out = raw.map((v, i) => { let sum = 0, c = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < raw.length) { sum += raw[j]; c++; } } return Math.min(v, sum / c); });
      // (the first and last metres stay at the platforms)
      out[0] = y0; out[out.length - 1] = y1;
      supports = supports.map((u, i) => ({ s: u.s, y: out[i] }));
    }
  } else {
    // the rope runs level through the station (at the wheel's height over the highest ground under it), then climbs to the pylons
    const Ls = Math.min(STATION_LEN[key], len * 0.3);
    let yb = -Infinity, yt = -Infinity;
    for (let s = 0; s <= Ls + 1e-6; s += 1) { yb = Math.max(yb, ground(s) + spec.wheel); yt = Math.max(yt, ground(len - s) + spec.wheel); }
    supports = [{ s: 0, y: yb, station: true }];
    if (Ls > 1) supports.push({ s: Ls, y: yb, station: true });
    const towers = kind === 'cable' && !(src.pylons && src.pylons.length) ? [len / 2] : (src.pylons || []);
    for (const s of towers) { if (s <= Ls + 6 || s >= len - Ls - 6) continue; supports.push({ s, y: ground(s) + spec.tower, tower: true }); }
    if (Ls > 1) supports.push({ s: len - Ls, y: yt, station: true });
    supports.push({ s: len, y: yt, station: true });
    supports.sort((a, b) => a.s - b.s);
    // a rope must clear the ground between supports: lift a pylon where the straight line would bring the carriers too low (near a
    // station the carriers come down to boarding height, so the need there grows with the distance from it)
    const need = (s) => ground(s) + Math.min(spec.hang + 2, spec.wheel + 0.3 * Math.max(0, Math.min(s, len - s) - Ls));
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k + 1 < supports.length; k++) {
        const a = supports[k], b = supports[k + 1];
        for (let s = a.s + 5; s < b.s; s += 5) {
          const y = a.y + (b.y - a.y) * (s - a.s) / (b.s - a.s);
          const up = need(s) - y;
          if (up > 0) { if (b.tower) b.y += up; if (a.tower) a.y += up; }
        }
      }
    }
    // the sag of each span: as much as the span length allows (spec.sag per metre), never below the clearance need
    for (let k = 0; k + 1 < supports.length; k++) {
      const a = supports[k], b = supports[k + 1], span = b.s - a.s;
      let sag = spec.sag * span;
      for (let s = a.s + 5; s < b.s; s += 5) {
        const t = (s - a.s) / span, lin = a.y + (b.y - a.y) * t, room = lin - need(s);
        sag = Math.min(sag, Math.max(0, room) / Math.max(0.05, 4 * t * (1 - t)));
      }
      a.sag = Math.max(0, sag);
    }
  }
  function cableY(s) {
    let k = 0;
    while (k < supports.length - 2 && supports[k + 1].s < s) k++;
    const a = supports[k], b = supports[k + 1];
    const t = Math.min(1, Math.max(0, (s - a.s) / ((b.s - a.s) || 1)));
    return a.y + (b.y - a.y) * t - 4 * (a.sag || 0) * t * (1 - t);
  }
  /** The rope's climb at s (dy / ds): carriages tilt with it (trains), the window view looks along it. */
  const slope = (s) => (cableY(Math.min(len, s + 4)) - cableY(Math.max(0, s - 4))) / Math.max(1, Math.min(len, s + 4) - Math.max(0, s - 4));
  const cx = (sx[0] + sx[n - 1]) / 2, cz = (sz[0] + sz[n - 1]) / 2;

  // ---- the carrier loop (chairs, cabins, bars): up lane (+side), round the top wheel, down lane (-back), round the bottom wheel
  const R = (side + back) / 2, C = (side - back) / 2;          // the wheels' radius and their centre's offset from the line
  const shuttle = SHUTTLE.has(kind);
  // a jig-back cabin / train travels between its two docks (its middle BOARD m from the bottom end, UNLOAD m from the top)
  const d0 = Math.min(BOARD[key], len * 0.2), d1 = Math.max(d0 + 1, len - Math.min(UNLOAD[key], len * 0.2));
  const travel = d1 - d0;
  const loopLen = shuttle ? 2 * travel : 2 * len + 2 * Math.PI * R;
  const qa = {};
  /** A point of the loop: u in [0, loopLen) -> { x, y (rope), z, heading (of travel), s (nearest line arc), up (up lane), turn } */
  function loopAt(u, out = {}) {
    u = ((u % loopLen) + loopLen) % loopLen;
    if (shuttle) return u < travel ? shuttleAt(d0 + u, 1, true, out) : shuttleAt(d1 - (u - travel), -1, false, out);
    const half = Math.PI * R;
    let s, lat, dir, turn = 0;
    if (u <= len) { s = u; lat = side; dir = 1; }
    else if (u < len + half) {
      const a = (u - len) / R;
      at(len, qa);
      const fx = qa.dx, fz = qa.dz, rx = -fz * sign, rz = fx * sign;
      out.x = qa.x + fx * R * Math.sin(a) + rx * (C + R * Math.cos(a)); out.z = qa.z + fz * R * Math.sin(a) + rz * (C + R * Math.cos(a));
      out.y = cableY(len); out.heading = Math.atan2(fz * Math.cos(a) - rz * Math.sin(a), fx * Math.cos(a) - rx * Math.sin(a));
      out.s = len; out.up = false; out.turn = 1;
      return out;
    } else if (u <= 2 * len + half) { s = 2 * len + half - u; lat = -back; dir = -1; }
    else {
      const a = (u - 2 * len - half) / R;
      at(0, qa);
      const fx = qa.dx, fz = qa.dz, rx = -fz * sign, rz = fx * sign;
      out.x = qa.x - fx * R * Math.sin(a) + rx * (C - R * Math.cos(a)); out.z = qa.z - fz * R * Math.sin(a) + rz * (C - R * Math.cos(a));
      out.y = cableY(0); out.heading = Math.atan2(-fz * Math.cos(a) + rz * Math.sin(a), -fx * Math.cos(a) + rx * Math.sin(a));
      out.s = 0; out.up = true; out.turn = -1;
      return out;
    }
    at(s, qa);
    out.x = qa.x - qa.dz * lat * sign; out.z = qa.z + qa.dx * lat * sign; out.y = cableY(s);
    out.heading = Math.atan2(qa.dz * dir, qa.dx * dir); out.s = s; out.up = dir > 0; out.turn = turn;
    return out;
  }
  /** A jig-back cabin / train / belt slat on its own track (track +1 = the up side, -1 = the other one) at s, moving up or down. */
  function shuttleAt(s, track, goingUp, out = {}) {
    at(s, qa);
    const lat = track > 0 ? side : -back;
    out.x = qa.x - qa.dz * lat; out.z = qa.z + qa.dx * lat; out.y = cableY(s);
    out.heading = Math.atan2(qa.dz * (goingUp ? 1 : -1), qa.dx * (goingUp ? 1 : -1)); out.s = s; out.up = goingUp; out.turn = 0;
    return out;
  }
  /** The loop parameter of a point on the up lane at s (s < 0: still on the bottom wheel, behind the station end). */
  const upU = (s) => (shuttle ? Math.max(0, s - d0) : s >= 0 ? s : loopLen + s);
  return {
    src, kind, sub, spec, side, back, len, at, cableY, slope, supports, cx, cz, radius: len / 2, seats, carrier: cb, tunnel,
    loopLen, loopAt, shuttleAt, shuttle, upU, wheelR: R, wheelC: C, sign, key, docks: [d0, d1],
    /** The ground under the line at s (the far grid before the 5 m tiles arrive). */
    ground,
  };
}
