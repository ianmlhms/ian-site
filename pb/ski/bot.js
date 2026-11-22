/* A scripted skier (pure): follows the piste line with a look-ahead point, tucks on straights, brakes above a speed limit per colour,
 * and threads the slalom gates. Used by the Node harness and the browser flows (?bot=1), never by players. */
const LIMIT = { green: 14, blue: 17, red: 19, black: 20 };     // m/s

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/* R8e (ski-course flow: Kronplatz sylvester / rara stopped dead against a lift station standing on the OSM line): with blocked(x, z)
 * (a station / pylon / house there; main.js window.__ski.blocked) the bot looks along its aim line and, when something is in the way,
 * aims beside the line instead (the smallest clear side offset), like a player skiing round the station. */
const AVOID = [3, -3, 6, -6, 9, -9, 12, -12, 16, -16, 20, -20, 25, -25];
function pathClear(blocked, x0, z0, x1, z1, from = 0) {        // from: m near him not tested (pressed against a wall: its margin)
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 2));
  for (let i = 1; i <= n; i++) if (d * i / n >= from && blocked(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n)) return false;
  return true;
}

export function createBot(piste, { speedScale = 1, blocked = null } = {}) {
  const p = {}, q = {};
  const proj = {};
  const gates = piste.slalomGates();
  let hint = 0, stuckT = 0, lastT = null;
  return function drive(state) {
    const dt = lastT === null ? 0 : Math.max(0, Math.min(0.1, (state.t || 0) - lastT));
    lastT = state.t || 0;
    stuckT = state.speed < 0.6 && state.crash === 0 ? stuckT + dt : 0;
    piste.project(state.x, state.z, hint, 120, proj);
    if (proj.dist > 60) piste.project(state.x, state.z, null, 0, proj);     // R7-C2: put down somewhere else (a teleport): find the line again
    hint = proj.s;
    const v = Math.max(state.speed, 3);
    const look = 10 + v * 0.9;
    piste.at(proj.s + look, p);
    let tx = p.x, tz = p.z;
    // aim a little outside the next slalom gate's inner pole
    const g = gates.find((q) => q.s > proj.s + 2);
    if (g && g.s - proj.s < look + 8) {
      const out = g.off + Math.sign(g.off) * 2.2;
      tx = g.x - g.dz * (out - g.off); tz = g.z + g.dx * (out - g.off);
    }
    let side = 0;
    if (blocked && !pathClear(blocked, state.x, state.z, tx, tz)) {
      for (const o of AVOID) {
        const ox = tx - p.dz * o, oz = tz + p.dx * o;
        if (!blocked(ox, oz) && pathClear(blocked, state.x, state.z, ox, oz)) { tx = ox; tz = oz; side = o; break; }
      }
      // pinned in a pocket (a house and a station hall either side of the line) for > 1.5 s: back to a clear point of the line, behind
      // him if need be, then on from there
      if (!side && stuckT > 1.5 && blocked) {
        for (const ds of [8, 14, 22, -6, -12, -20]) {
          piste.at(Math.max(0, proj.s + ds), q);
          for (const o of [0, 3, -3, 6, -6]) {
            const ox = q.x - q.dz * o, oz = q.z + q.dx * o;
            if (!blocked(ox, oz) && pathClear(blocked, state.x, state.z, ox, oz, 3.5)) { tx = ox; tz = oz; side = 99; break; }
          }
          if (side) break;
        }
      }
      // pressed against a wide house: nothing clear ahead, so first sideways along it (a few metres down the line), round its corner
      if (!side) {
        piste.at(proj.s, q);
        for (const o of [...AVOID, 30, -30, 36, -36]) {
          const ox = state.x - q.dz * o + q.dx * 4, oz = state.z + q.dx * o + q.dz * 4;
          if (!blocked(ox, oz) && pathClear(blocked, state.x, state.z, ox, oz)) { tx = ox; tz = oz; side = o; break; }
        }
      }
    }
    const want = Math.atan2(tz - state.z, tx - state.x);
    const err = wrap(want - state.heading);
    const steer = Math.max(-1, Math.min(1, err * 2.4));
    // slow down before a sharp bend of the line (a hairpin overshot at full speed ends in the deep snow below it)
    piste.at(proj.s + look + 30, q);
    const bend = Math.abs(wrap(Math.atan2(q.dz, q.dx) - Math.atan2(p.dz, p.dx)));
    const limit = (LIMIT[piste.diff] || 16) * speedScale * (bend > 0.5 ? Math.max(0.45, 1 - (bend - 0.5) * 0.7) : 1);
    return { steer, tuck: Math.abs(err) < 0.12 && !side && state.speed < limit * 0.9 ? 1 : 0, brake: state.speed > limit ? 1 : 0, push: state.speed < 4 ? 1 : 0, jump: false };
  };
}
