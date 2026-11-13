/* node scripts/zuch/cab_gate_diag.mjs <route> <train> ...: prints cab.group.userData.gate (lever plate vs ramp) and the instruments that stick out of the desk width */
import { openSim } from './zlib.mjs';
const [route, ...trains] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  for (const t of trains) {
    await sim.start(route, t);
    console.log(t, JSON.stringify(await sim.page.evaluate(() => {
      const w = __tsTest.internals().world, g = w.cab.group.userData.gate, st = window.TS.cab.STYLES[w.cab.group.userData.frame.type] || null;
      const out = [];
      if (st) { for (const d of st.dials) if (d.x - d.r < -g.hw + 0.005 || d.x + d.r > g.hw - 0.005) out.push(['dial', d.kind, d.x, d.r]); for (const m of st.mfds) if (m.x - m.w / 2 < -g.hw || m.x + m.w / 2 > g.hw) out.push(['mfd', m.x, m.w]); }
      return { gate: g, type: w.cab.group.userData.frame.type, outside: out };
    })));
  }
} finally { await sim.close(); }
