/* node scripts/zuch/tram_hole_scan.mjs [routeId=luxtram] [--step 150] [--from 40] [--to N] [--raystep 40] [--out dir] [--root repo] [--selftest]
 * Runs the Luxtram hole detector (tram_hole_lib.mjs), prints the findings, writes <out>/<route>-holes.json. */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';
import { scanTram } from './tram_hole_lib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const step = Number(flag('step', '150'));
const from = Number(flag('from', '40'));
const to = Number(flag('to', 'Infinity'));
const rayStep = Number(flag('raystep', '40'));
const out = flag('out', '');
const root = flag('root', undefined);
const selftest = args.includes('--selftest');
const routeId = args.find((a) => !a.startsWith('--')) || 'luxtram';
const sim = await openSim({ quality: 'high', root });
let report;
try { report = await scanTram(sim, routeId, { step, from, to, rayStep, selftest, log: console.log }); } finally { await sim.close(); }
if (selftest) { console.log('selftest (one terrain tile hidden): ' + (report.detected ? 'detected ' + JSON.stringify(report.poses) : 'NOT DETECTED')); process.exit(report.detected ? 0 : 1); }
console.log(`${routeId}: ${report.poses} poses, ${report.flagged.length} flagged; ${report.rays} rays, ${report.rayFailures.length} failures`);
report.rayFailures.slice(0, 30).forEach((f) => console.log('   ray', JSON.stringify(f)));
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `${routeId}-holes.json`), JSON.stringify(report, null, 1)); }
const bad = report.flagged.length + report.rayFailures.length;
console.log(bad ? `PROBLEMS: ${bad}` : 'no holes found');
process.exit(bad ? 1 : 0);
