/* Lux Drive: a cross section of the ground, to see what a carve does at a place.
 *   node scripts/luxdrive/cross_section.mjs <x> <z> <bearing deg, 0 = +x, 90 = +z> [half length m, default 20] [step m, default 0.5]
 * Prints the final height, the land (no road), the bed of the road the point is on and its coverage along a line through (x, z). */
import { loadWorld } from './world_node.mjs';
const [x0, z0, bearing = 0, half = 20, step = 0.5] = process.argv.slice(2).map(Number);
if (![x0, z0].every(Number.isFinite)) { console.error('usage: cross_section.mjs x z [bearing] [half] [step]'); process.exit(1); }
const { field, surface } = await loadWorld();
const dx = Math.cos((bearing * Math.PI) / 180), dz = Math.sin((bearing * Math.PI) / 180);
const info = { sdCar: 0 };
console.log('   s     height   land   delta  slope  road  coverage  sdCar');
let prev = null;
for (let s = -half; s <= half + 1e-9; s += step) {
  const x = x0 + dx * s, z = z0 + dz * s;
  const h = field.height(x, z, info), g = field.groundHeight(x, z);
  const slope = prev === null ? 0 : (h - prev) / step;
  console.log(`${s.toFixed(1).padStart(6)} ${h.toFixed(2).padStart(8)} ${g.toFixed(2).padStart(7)} ${(h - g).toFixed(2).padStart(6)} ${slope.toFixed(2).padStart(6)} ${String(info.road).padStart(5)} ${info.coverage.toFixed(2).padStart(8)} ${info.sdCar.toFixed(1).padStart(6)}`);
  prev = h;
}
