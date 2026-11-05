/* Lux Drive: how bumpy is it to drive straight across a junction?   node scripts/luxdrive/junction_bump.mjs [count=20] [--verbose] [--folder=<pb/lux-drive/ with trailing slash>]
 * A junction is a place where the carved ways meet (a sample of one way within JOIN m of a sample of another way, clustered in a 12 m grid); the biggest ones (most ways, widest roads) are measured.
 * For every way that runs through or ends at the junction a straight line of 2 x REACH m along that way (through the centre of the junction) is driven at 14 m/s (50 km/h) over the very height
 * function the car stands on (the physics surface, decks excluded): the vertical acceleration of a body that follows the profile (h'' over 2 m) and the steepest pitch.  The numbers are for the
 * junction BOX (within BOX m of the centre) and the approaches.  Used by the harness as gate L (the same code: pb/lux-drive/junction-probe.js). */
import { loadWorld } from './world_node.mjs';
import { junctionClusters, driveLine } from '../../pb/lux-drive/junction-probe.js';

const count = Number(process.argv.find((a) => /^\d+$/.test(a)) || 20);
const verbose = process.argv.includes('--verbose');
const { field, surface, data } = await loadWorld();
const net = field.network;
const clusters = junctionClusters(net).slice(0, count);
let worstAll = 0;
for (const c of clusters) {
  const rows = [];
  for (const way of c.ways) {
    const r = driveLine(surface, c, way);
    rows.push(r);
    worstAll = Math.max(worstAll, r.boxBob);
  }
  const worst = rows.reduce((m, r) => (r.boxBob > m.boxBob ? r : m), rows[0]);
  const name = (i) => data.roads[net.chains[i].road]?.name || data.roads[net.chains[i].road]?.kind;
  console.log(`junction (${c.x.toFixed(0)},${c.z.toFixed(0)}) ${c.ways.length} ways, width ${c.width.toFixed(0)}: box bob worst ${worst.boxBob.toFixed(2)} m/s2 (${name(worst.chain)} at ${worst.at.map(Math.round)}), pitch ${(worst.boxPitch * 100).toFixed(1)} %, step ${(Math.max(...rows.map((r) => r.boxStep)) * 100).toFixed(0)} cm / 2 m, approach bob ${worst.apBob.toFixed(2)}`);
  if (verbose) for (const r of rows) console.log(`    ${name(r.chain)}: box ${r.boxBob.toFixed(2)} pitch ${(r.boxPitch * 100).toFixed(1)}% approach ${r.apBob.toFixed(2)}`);
}
console.log(`worst box bob of ${clusters.length} junctions: ${worstAll.toFixed(2)} m/s2`);
