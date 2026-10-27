import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'high' });
try {
  await sim.start('luxtram-stad', 'tram');
  const info = await sim.evalGame(({ track, world }) => ({ kind: track.kind, length: track.length, base: !!track.base, lsKeys: Object.keys(world.landscape), tunnels: (track.tunnels||[]).length, bridges: (track.bridges||[]).length }));
  console.log(JSON.stringify(info));
  const w = await sim.evalGame(({ world }) => { const lw = world.landscape.luxtramWorld; return { keys: Object.keys(lw), stats: lw.stats() }; });
  console.log(JSON.stringify(w));
  await sim.view({ s: 500, lat: 0, up: 4, yaw: 0, pitch: -0.1 });
  await sim.shot('/private/tmp/claude-502/-Users-Ian/abcb6fad-0a58-415e-9a86-e860154b9872/scratchpad/tram1.png');
  console.log(sim.errors.slice(0,5));
} finally { await sim.close(); }
