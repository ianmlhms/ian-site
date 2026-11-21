/* A scripted skier (pure): follows the piste line with a look-ahead point, tucks on straights, brakes above a speed limit per colour,
 * and threads the slalom gates. Used by the Node harness and the browser flows (?bot=1), never by players. */
const LIMIT = { green: 14, blue: 17, red: 19, black: 20 };     // m/s

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createBot(piste, { speedScale = 1 } = {}) {
  const p = {};
  const proj = {};
  const gates = piste.slalomGates();
  let hint = 0;
  return function drive(state) {
    piste.project(state.x, state.z, hint, 120, proj);
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
    const want = Math.atan2(tz - state.z, tx - state.x);
    const err = wrap(want - state.heading);
    const steer = Math.max(-1, Math.min(1, err * 2.4));
    const limit = (LIMIT[piste.diff] || 16) * speedScale;
    return { steer, tuck: Math.abs(err) < 0.12 && state.speed < limit * 0.9 ? 1 : 0, brake: state.speed > limit ? 1 : 0, push: state.speed < 4 ? 1 : 0, jump: false };
  };
}
