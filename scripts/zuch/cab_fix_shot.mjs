/* node scripts/zuch/cab_fix_shot.mjs <out.png> <route> <train> <kmh> [lever]: the game's own cab view at 2000x1251 with the train at a speed.
 * env HIDE=<child name regex> hides matching cab group children (QA of floating parts); LEVER sets the held lever notch. */
import { openSim } from './zlib.mjs';
const [out, route, train, kmh, lever] = process.argv.slice(2);
const sim = await openSim({ quality: 'high', width: 2000, height: 1251 });
try {
  await sim.start(route, train);
  await sim.page.evaluate(([k]) => { __tsTest.placeAt(400, Number(k)); }, [kmh]);
  await sim.frames(40);
  { const n = Number(lever || 0); for (let i = 0; i < Math.abs(n); i++) await sim.page.evaluate((k) => { __tsTest.press(k); __tsTest.release(k); }, n > 0 ? 'w' : 's'); }
  await sim.frames(40);
  if (process.env.HIDE) await sim.page.evaluate((re) => { const w = __tsTest.internals().world; const rx = new RegExp(re); w.cab.group.traverse((o) => { if (o !== w.cab.group && rx.test(o.name)) o.visible = false; }); }, process.env.HIDE);
  if (process.env.HIDEALL) await sim.page.evaluate(() => { const w = __tsTest.internals().world; w.cab.group.visible = false; });
  await sim.frames(10);
  await sim.shot(out);
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
