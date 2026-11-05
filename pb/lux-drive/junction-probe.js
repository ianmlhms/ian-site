/* Driving straight across a junction, in numbers.  Pure (no THREE): scripts/luxdrive/junction_bump.mjs and the harness (gate L) read the same code.
 * A junction = a place where carved ways meet; the car drives a straight line along each of its ways through the centre and the bumpiness of that line is measured. */

export const JUNCTION = Object.freeze({
  join: 7,            // m: a sample of one way this close to a sample of another way is a junction
  cell: 12,           // m: junction samples are clustered in a grid of this size
  reach: 55,          // m: the line runs this far to both sides of the centre
  box: 22,            // m: within this of the centre is the junction box (the roads of the junction, their aprons)
  step: 0.5,          // m: the sampling step along the line
  speed: 14,          // m/s: 50 km/h
  maxBob: 1.5,        // m/s2: the limit of the comfort of a driver on a straight line through a junction (the same as the roads)
});

/** The junctions of a road network: [{ x, z, width, ways: [{ chain, k }] }] sorted by importance (number of ways, then total width). */
export function junctionClusters(net, minWays = 3) {
  const chains = net.chains.filter((c) => !c.tagged && !net.overRoads.has(c.road));
  const grid = new Map();
  const key = (cx, cz) => cx * 8192 + cz;
  chains.forEach((c, ci) => { for (let k = 0; k < c.x.length; k++) { const kk = key(Math.floor(c.x[k] / JUNCTION.cell), Math.floor(c.z[k] / JUNCTION.cell)); const l = grid.get(kk); if (l) l.push(ci, k); else grid.set(kk, [ci, k]); } });
  const cells = new Map();                                   // grid cell -> the ways with a sample within `join` of another way's sample
  chains.forEach((c, ci) => {
    for (let k = 0; k < c.x.length; k++) {
      const cx = Math.floor(c.x[k] / JUNCTION.cell), cz = Math.floor(c.z[k] / JUNCTION.cell);
      let other = false;
      for (let dz = -1; dz <= 1 && !other; dz++) for (let dx = -1; dx <= 1 && !other; dx++) {
        const l = grid.get(key(cx + dx, cz + dz)) || [];
        for (let q = 0; q < l.length; q += 2) if (l[q] !== ci && Math.hypot(chains[l[q]].x[l[q + 1]] - c.x[k], chains[l[q]].z[l[q + 1]] - c.z[k]) < JUNCTION.join) { other = true; break; }
      }
      if (!other) continue;
      const ck = key(cx, cz);
      let cell = cells.get(ck);
      if (!cell) { cell = { x: 0, z: 0, n: 0, ways: new Map() }; cells.set(ck, cell); }
      cell.x += c.x[k]; cell.z += c.z[k]; cell.n++;
      const cur = cell.ways.get(ci);
      if (!cur) cell.ways.set(ci, { chain: ci, k, d: 0 });
    }
  });
  const out = [];
  for (const cell of cells.values()) {
    const x = cell.x / cell.n, z = cell.z / cell.n;
    const ways = [];
    let width = 0;
    for (const w of cell.ways.values()) {
      const c = chains[w.chain];
      let best = 0, bd = Infinity;
      for (let k = 0; k < c.x.length; k++) { const d = Math.hypot(c.x[k] - x, c.z[k] - z); if (d < bd) { bd = d; best = k; } }
      if (bd > JUNCTION.cell * 1.5) continue;
      ways.push({ chain: chains.indexOf(c), k: best });
      width += net.info[c.road].hw * 2;
    }
    if (ways.length >= minWays) out.push({ x, z, width, ways: ways.map((w) => ({ chain: net.chains.indexOf(chains[w.chain]), k: w.k })), net });
  }
  return out.sort((a, b) => b.ways.length - a.ways.length || b.width - a.width);
}

/** One straight line along a way through the junction c: { chain, boxBob, boxPitch, apBob, at } (accelerations in m/s2, pitch as a slope, boxStep = the largest height change within 2 m). */
export function driveLine(surface, c, way) {
  const ch = c.net.chains[way.chain];
  const a = Math.max(0, way.k - 1), b = Math.min(ch.x.length - 1, way.k + 1);
  let dx = ch.x[b] - ch.x[a], dz = ch.z[b] - ch.z[a];
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  const n = Math.round((2 * JUNCTION.reach) / JUNCTION.step);
  const h = new Float64Array(n + 1), onRoad = new Uint8Array(n + 1);
  const info = { sdCar: 9 };
  for (let i = 0; i <= n; i++) { const s = -JUNCTION.reach + i * JUNCTION.step; h[i] = surface.height(c.x + dx * s, c.z + dz * s); onRoad[i] = surface.roadInfoAt(c.x + dx * s, c.z + dz * s, info).sdCar < 0 ? 1 : 0; }
  const span = Math.round(2 / JUNCTION.step);                                  // h'' over a base of 4 m (+-2 m): the base of the road smoothness gate
  let boxBob = 0, apBob = 0, boxPitch = 0, boxStep = 0, stepAt = [c.x, c.z], at = [c.x, c.z];
  for (let i = span * 2; i <= n - span * 2; i++) {
    const s = -JUNCTION.reach + i * JUNCTION.step;
    let driven = true;                                                          // the car drives where there is tarmac under the whole base: a line that leaves the road is no drive
    for (let q = i - span; q <= i + span; q++) if (!onRoad[q]) { driven = false; break; }
    if (!driven) continue;
    const acc = (JUNCTION.speed * JUNCTION.speed * Math.abs(h[i + span] + h[i - span] - 2 * h[i])) / (span * JUNCTION.step * span * JUNCTION.step);
    const pitch = Math.abs(h[i + 1] - h[i - 1]) / (2 * JUNCTION.step);
    if (Math.abs(s) <= JUNCTION.box) { const jump = Math.abs(h[i + 2] - h[i - 2]); if (jump > boxStep) { boxStep = jump; stepAt = [c.x + dx * s, c.z + dz * s]; } if (acc > boxBob) { boxBob = acc; at = [c.x + dx * s, c.z + dz * s]; } boxPitch = Math.max(boxPitch, pitch); }
    else apBob = Math.max(apBob, acc);
  }
  return { chain: way.chain, boxBob, boxPitch, boxStep, stepAt, apBob, at };
}
