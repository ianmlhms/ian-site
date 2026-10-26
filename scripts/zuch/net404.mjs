/* lists the 404 responses while a route starts.  node scripts/zuch/net404.mjs <routeId> */
import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'medium' });
const bad = [];
sim.page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
try { await sim.start(process.argv[2] || 'west'); console.log(bad.join('\n') || 'no failed requests'); } finally { await sim.close(); }
