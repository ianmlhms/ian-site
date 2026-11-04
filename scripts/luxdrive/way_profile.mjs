/* Lux Drive: the long profile of the way nearest to a point: the land, the bed, the surface the car drives on, the vertical acceleration at 50 km/h.
 *   node scripts/luxdrive/way_profile.mjs <x> <z> [half length m, default 40] [step m, default 2] */
import { loadWorld } from './world_node.mjs';
const [px, pz, half = 40, step = 2] = process.argv.slice(2).map(Number);
const { field, surface } = await loadWorld();
const net = field.network;
let best = null, bd = Infinity;
const only = process.env.ROAD === undefined ? null : Number(process.env.ROAD);   // ROAD=<road index>: that way instead of the nearest one
for (const c of net.chains) if (only === null || c.road === only) for (let i = 0; i < c.x.length; i++) { const d = Math.hypot(c.x[i] - px, c.z[i] - pz); if (d < bd) { bd = d; best = { c, i }; } }
const { c, i } = best;
const arc = c.arc;
const a0 = arc[i];
console.log(`way ${net.roads[c.road].name || net.roads[c.road].kind} (${c.kind}) road ${c.road}, ${bd.toFixed(1)} m from the point, sample ${i}/${c.x.length}, over=${net.overRoads.has(c.road)} tagged=${c.tagged}`);
console.log('   arc     x      z    land    bed  surface  s-bed   acc50');
const at = (d) => { let k = 0; while (k < arc.length - 2 && arc[k + 1] < d) k++; const t = (d - arc[k]) / Math.max(1e-9, arc[k + 1] - arc[k]); return [c.x[k] + (c.x[k + 1] - c.x[k]) * t, c.z[k] + (c.z[k + 1] - c.z[k]) * t, k, t]; };
const h = (d) => { const [x, z] = at(d); return surface.height(x, z); };
for (let d = Math.max(0, a0 - half); d <= Math.min(arc[arc.length - 1], a0 + half); d += step) {
  const [x, z, k, t] = at(d);
  const bed = c.bed[k] + (c.bed[k + 1] - c.bed[k]) * t, land = c.ground[k] + (c.ground[k + 1] - c.ground[k]) * t;
  const s = surface.height(x, z), acc = 14 * 14 * Math.abs(h(d + 2) + h(d - 2) - 2 * s) / 4;
  console.log(`${d.toFixed(0).padStart(6)} ${x.toFixed(0).padStart(6)} ${z.toFixed(0).padStart(6)} ${land.toFixed(2).padStart(7)} ${bed.toFixed(2).padStart(6)} ${s.toFixed(2).padStart(8)} ${(s - bed).toFixed(2).padStart(6)} ${acc.toFixed(1).padStart(7)}`);
}
