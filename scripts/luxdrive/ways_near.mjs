/* Lux Drive: the ways near a point with their class, their bed and the land under them, the pins of the junctions.
 *   node scripts/luxdrive/ways_near.mjs <x> <z> [radius m, default 30] */
import { loadWorld } from './world_node.mjs';
const [px, pz, rad = 30] = process.argv.slice(2).map(Number);
const { field, data } = await loadWorld();
const net = field.network;
for (const c of net.chains) {
  let near = false;
  for (let i = 0; i < c.x.length && !near; i++) near = Math.hypot(c.x[i] - px, c.z[i] - pz) <= rad;
  const r = data.roads[c.road];
  if (!near) { if (r.pts) for (const p of r.pts) if (Math.hypot(p[0] - px, p[1] - pz) <= rad) near = true; }
  if (!near) continue;
  const rows = [];
  for (let i = 0; i < c.x.length; i++) if (Math.hypot(c.x[i] - px, c.z[i] - pz) <= rad + 6) rows.push(`${i}:(${c.x[i].toFixed(0)},${c.z[i].toFixed(0)}) land ${c.ground[i].toFixed(1)} bed ${c.bed[i].toFixed(1)}${c.pins && c.pins.has(i) ? ' PIN' : ''}`);
  console.log(`road ${c.road} ${r.name || ''} [${c.kind}] hw ${c.hw} tagged=${c.tagged} over=${net.overRoads.has(c.road)} closed=${c.closed} ends=${JSON.stringify(c.ends)} n=${c.x.length}`);
  console.log('   ' + rows.join('\n   '));
}
for (const r of data.roads) if (r.pts && (r.over || r.tunnel || (r.layer || 0) >= 1) && r.pts.some((p) => Math.hypot(p[0] - px, p[1] - pz) <= rad)) console.log('tagged way', r.name, r.kind, 'over', r.over, 'tunnel', r.tunnel, 'layer', r.layer);
