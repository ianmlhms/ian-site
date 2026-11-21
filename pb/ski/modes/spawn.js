/* Round 7: where a skier stands at a lift's bottom station (the free ride's start, fast travel, the online group's start).
 * Ian (21 Nov, Safari, 3 Vallées): he spawned facing a building wall and saw nothing. Now the spot is chosen among candidates in front of
 * the station (inside the boarding zone, so "Astegen" is right there), FACING the station, and a candidate only counts when the line from
 * the chase camera behind the skier to 25 m ahead of him is free of buildings (the real footprints of buildings.json, with a margin; the
 * station's own hall at the end of the line does not count) and nothing built is under the skier or the camera (the class raster, known
 * before the buildings arrive). Pure module: the Node checks run it for every lift bottom of every resort.
 * FIRST_LIFT: the lift a real visitor takes first in each resort (the free ride starts there; "Bei den éischte Lift" goes back to it). */
export const FIRST_LIFT = Object.freeze({
  killy: 'Solaise',                          // Val d'Isère centre
  '3vallees': 'Verdons',                     // Courchevel 1850, la Croisette
  zermatt: 'Matterhorn Express 1',           // Zermatt village, towards Furi / the glacier
  arlberg: 'Galzigbahn',                     // St. Anton
  kronplatz: 'Kronplatz 2000',               // Reischach
});
export const SPAWN = Object.freeze({ rings: [10, 12, 14, 17, 20, 24, 28], angles: [0, 25, -25, 50, -50, 75, -75, 100, -100, 125, -125, 150, -150], look: 45, camBack: 7, ahead: 25, margin: 1.6, board: 26, hall: 14, want: 12 });
/* the top exit: past the top station, facing down the slope, nothing built in front for EXIT.clear m */
export const EXIT = Object.freeze({ dists: [10, 14, 18, 24, 30, 38, 48, 60], lats: [0, 6, -6, 12, -12, 20, -20, 30, -30], clear: 15, back: 6 });

/** The configured first lift of the resort (by name), else null. lifts = createLiftNet. */
export function firstLift(lifts, rid) {
  const name = FIRST_LIFT[rid];
  if (!name) return null;
  return lifts.list.find((l) => l.name === name) || lifts.list.find((l) => l.name && l.name.startsWith(name)) || null;
}

/** Building footprints as oriented boxes [cx, cz, cos, sin, halfL, halfW] (buildings.json rows: [cx, cz, L, W, angle, ...]). */
export function buildingBoxes(rows) {
  // [6] = the roof top (absolute m: ground + ridge height), for the camera guard (look.js)
  return (rows || []).map((r) => [r[0], r[1], Math.cos(r[4]), Math.sin(r[4]), r[2] / 2, r[3] / 2, (r[7] || 0) + Math.max(r[5] || 0, r[6] || 0) + 0.6]);
}
/** Is (x, z) inside a building (grown by m metres)? Boxes are bucketed on a 50 m grid for speed (index = createBoxIndex). */
export function createBoxIndex(boxes) {
  const grid = new Map(), C = 50;
  for (const b of boxes) {
    const r = Math.hypot(b[4], b[5]) + 3;
    for (let i = Math.floor((b[0] - r) / C); i <= Math.floor((b[0] + r) / C); i++) for (let j = Math.floor((b[1] - r) / C); j <= Math.floor((b[1] + r) / C); j++) {
      const k = i * 100003 + j; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(b);
    }
  }
  return {
    /** The first building at (x, z) grown by m (skipping the boxes in `ignore`), or null. */
    hit(x, z, m = 0, ignore = null) {
      const a = grid.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
      if (!a) return null;
      for (const b of a) {
        if (ignore && ignore.has(b)) continue;
        const dx = x - b[0], dz = z - b[1];
        const u = dx * b[2] + dz * b[3], v = -dx * b[3] + dz * b[2];
        if (Math.abs(u) < b[4] + m && Math.abs(v) < b[5] + m) return b;
      }
      return null;
    },
  };
}

/**
 * The best spot in front of a lift's bottom station: { x, z, heading, blocked (metres of the view that cross a building), score }.
 * lift = createLiftNet entry; builtAt(x, z) = 0..1 built share (class raster); index = createBoxIndex or null; slope(x, z) = rise per m.
 */
export function liftSpot(lift, { builtAt = () => 0, index = null, slope = () => 0 } = {}) {
  // round 7 (second try, after the WebKit shots): facing the station from 10 m meant facing its hall (OSM draws the real station
  // building): a wall. Now he stands beside / in front of the station and looks UP THE LINE (a point 45 m up the rope), so the picture is
  // the station at the side and the cabins / chairs climbing away; the whole view (camera behind him to 25 m ahead) must be free of
  // every building, the station's own hall included.
  const d = Math.hypot(lift.top.x - lift.bottom.x, lift.top.z - lift.bottom.z) || 1;
  const ux = (lift.top.x - lift.bottom.x) / d, uz = (lift.top.z - lift.bottom.z) / d;
  const tx = lift.bottom.x + ux * SPAWN.look, tz = lift.bottom.z + uz * SPAWN.look;
  let best = null;
  for (const r of SPAWN.rings) {
    for (const ang of SPAWN.angles) {
      const a = Math.atan2(-uz, -ux) + ang * Math.PI / 180;               // 0 = straight down the line from the station
      const x = lift.bottom.x + Math.cos(a) * r, z = lift.bottom.z + Math.sin(a) * r;
      const heading = Math.atan2(tz - z, tx - x);
      const fx = Math.cos(heading), fz = Math.sin(heading);
      let blocked = 0;
      for (let t = -SPAWN.camBack; t <= SPAWN.ahead; t += 1.5) if (index && index.hit(x + fx * t, z + fz * t, t < 0 ? 0.4 : SPAWN.margin)) blocked += 1.5;
      const inside = index && index.hit(x, z, 1.2) ? 1 : 0;
      const under = builtAt(x, z) * 30 + builtAt(x - fx * SPAWN.camBack, z - fz * SPAWN.camBack) * 20;
      const score = inside * 1e5 + blocked * 40 + under + Math.abs(r - SPAWN.want) * 0.9 + Math.abs(ang) * 0.02 + Math.max(0, slope(x, z) - 0.18) * 60;
      if (!best || score < best.score) best = { x, z, heading, blocked, score };
    }
  }
  return best;
}

/**
 * Round 7: where a rider gets off at the top: past the top station on open snow, outside every building (the station's own included),
 * facing down the slope with nothing built in front for EXIT.clear m. prefer = a preferred spot (the start of a piste near the top) used
 * when it is clear. farHeight(x, z) for the fall line. Returns { x, z, heading, blocked }.
 */
export function exitSpot(lift, { index = null, builtAt = () => 0, farHeight, prefer = null } = {}) {
  const d = Math.hypot(lift.top.x - lift.bottom.x, lift.top.z - lift.bottom.z) || 1;
  const ux = (lift.top.x - lift.bottom.x) / d, uz = (lift.top.z - lift.bottom.z) / d;
  const fall = (x, z) => {
    const gx = farHeight(x + 20, z) - farHeight(x - 20, z), gz = farHeight(x, z + 20) - farHeight(x, z - 20);
    return Math.hypot(gx, gz) > 0.4 ? Math.atan2(-gz, -gx) : Math.atan2(uz, ux);
  };
  const judge = (x, z, heading) => {
    const fx = Math.cos(heading), fz = Math.sin(heading);
    let blocked = 0;
    for (let t = -EXIT.back; t <= EXIT.clear; t += 1.5) if (index && index.hit(x + fx * t, z + fz * t, t < 0 ? 0.3 : SPAWN.margin)) blocked += 1.5;
    const inside = index && index.hit(x, z, 1.2) ? 1 : 0;
    return { blocked, inside, under: builtAt(x, z) };
  };
  if (prefer) {
    const j = judge(prefer.x, prefer.z, prefer.heading);
    if (!j.inside && j.blocked === 0 && j.under < 0.3) return { ...prefer, blocked: 0 };
  }
  let best = null;
  for (const m of EXIT.dists) for (const lat of EXIT.lats) {
    const x = lift.top.x + ux * m - uz * lat, z = lift.top.z + uz * m + ux * lat;
    const heading = fall(x, z);
    const j = judge(x, z, heading);
    const score = j.inside * 1e5 + (j.under > 0.3 ? 5000 : 0) + j.blocked * 40 + j.under * 50 + m * 0.2 + Math.abs(lat) * 0.3;
    if (!best || score < best.score) best = { x, z, heading, blocked: j.blocked, inside: j.inside, score };
  }
  return best;
}
