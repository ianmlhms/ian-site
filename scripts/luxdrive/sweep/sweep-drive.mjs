/* Lux Drive sweep 1: every lane of every car road driven in both directions at two speeds, headless, with the game's own car physics and collider.
 *   node scripts/luxdrive/sweep/sweep-drive.mjs [--out DIR] [--workers N] [--limit N] [--area x0,z0,x1,z1[;...]] [--speeds 13,25] [--resume]
 * Output (DIR, default <repo>/../luxdrive-sweep-out/drive): sweep-drive.json (events, totals), sweep-drive.md (worst-list, top 100 places within 25 m), progress.json (resume).
 * One worker per thread (each loads the world: ~0.6 GB, ~1 min); the main thread hands out batches of roads and writes the progress file. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const BATCH = 12;                       // roads per task
const CLUSTER_M = 25;                   // m: events within this are one place
const TOP = 100;
const KM_PER_SPEED_CAP = { motorway: 25, motorway_link: 25, trunk: 25, trunk_link: 25, primary: 25, primary_link: 25, secondary: 25, secondary_link: 25, tertiary: 20, tertiary_link: 20, unclassified: 20, residential: 18 };
const DEFAULT_CAP = 13;                 // service, living_street, road
// car20: SWEEP_FAST=1 drives at the new top speed (57 m/s) where a road lets a player reach it: the big roads at 57, tertiary 40, streets 30, service as before
const FAST_CAP = { motorway: 57, motorway_link: 57, trunk: 57, trunk_link: 57, primary: 57, primary_link: 57, secondary: 57, secondary_link: 57, tertiary: 40, tertiary_link: 40, unclassified: 30, residential: 30 };
const SCORE_UNIT = { jolt: 8, roll: 0.15, air: 0.1, fall: 1, hit: 0.2, offroad: 3 };
const SCORE_BASE = { jolt: 0, roll: 0, air: 0, fall: 2, hit: 2, offroad: 0 };
const score = (e) => SCORE_BASE[e.type] + (e.type === 'hit' ? (e.value + 0.05) / SCORE_UNIT.hit : e.type === 'air' ? Math.min(6, e.value / SCORE_UNIT.air) : e.value / SCORE_UNIT[e.type]);

function arg(name, def) { const i = process.argv.indexOf(name); return i < 0 ? def : (process.argv[i + 1] ?? true); }

/** The speeds a road is driven at: the requested ones, each capped by the road class (and not twice). */
export function speedsOf(kind, requested) {
  const cap = (process.env.SWEEP_FAST ? FAST_CAP : KM_PER_SPEED_CAP)[kind] ?? DEFAULT_CAP;
  return [...new Set(requested.map((v) => Math.min(v, cap)))];
}

if (!isMainThread) await work();
else if (process.argv[1] && path.resolve(process.argv[1]) === SELF) await main();

async function work() {
  const { loadWorld } = await import('./world.mjs');
  const { driveLane, offsetLine, newCar } = await import('./drive-core.mjs');
  const world = await loadWorld();
  const car = newCar(world);
  const byId = new Map(world.roads.map((r) => [r.id, r]));
  // worker 0 also tells the main thread which roads there are (only the ones that touch the play area: the rest of the baked world is backdrop) (the main thread never loads the world: 0.6 GB less)
  parentPort.postMessage({ ready: true, roads: workerData.index === 0 ? world.roads.filter((r) => r.pts.some((p) => world.playArea.inside(p[0], p[1]))).map((r) => ({ id: r.id, length: r.length, kind: r.kind, bbox: r.pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [1e9, 1e9, -1e9, -1e9]) })) : null });
  const DRAWN = !!workerData.drawn;
  const drawnLine = (road) => {
    const ri = world.net.roads.findIndex((q) => q.id === road.id), S = world.net.samples;
    if (ri < 0 || !(S.segs[ri] >= 1)) return road.pts;
    const pts = [];
    for (let k = S.first[ri]; k <= S.first[ri] + S.segs[ri]; k++) pts.push([S.x[k], S.z[k]]);
    return pts;
  };
  const CAR_HALF = 0.95;                      // m: the car's half width (car.js) + a hair
  const carveOut = {};
  /** (city21) Moves the points of a lane that lie further from the drawn centre line than the drawn half width there (less the car's half width) in to it. */
  const clampToDrawn = (lane, centre, road) => {
    const ri = world.net.roads.findIndex((q) => q.id === road.id);
    if (ri < 0) return lane;
    let at = 0;                                   // (the lane runs along the centre line in its order: search near the last foot)
    return lane.map((p) => {
      let best = null, bd = Infinity, bi = at;
      for (let i = Math.max(0, at - 8); i + 1 < centre.length && i <= at + 40; i++) {
        const a = centre[i], b = centre[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / ll)), q = [a[0] + ex * t, a[1] + ez * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < bd) { bd = d; best = q; bi = i; }
      }
      at = bi;
      world.net.carve(best[0], best[1], carveOut);
      if (carveOut.road !== ri || !(carveOut.hw > CAR_HALF)) return p;
      const lim = carveOut.hw - CAR_HALF;
      return bd <= lim ? p : [best[0] + (p[0] - best[0]) * lim / bd, best[1] + (p[1] - best[1]) * lim / bd];
    });
  };
  parentPort.on('message', (msg) => {
    if (msg.stop) { process.exit(0); }
    const out = { batch: msg.batch, ids: msg.ids, events: [], km: 0, runs: 0, lanes: 0, roads: 0, ms: 0 };
    const t0 = Date.now();
    for (const id of msg.ids) {
      const road = byId.get(id);
      if (!road) continue;
      out.roads++;
      // (city21) --drawn: the lanes lie inside the carriageway the game DRAWS: where it is narrower than the OSM width (a way beside an underpass trough, a slip road whose
      // OSM width counts its shoulders) the OSM lanes ran 0.4 - 2.9 m off the asphalt, on the verge, into trough parapets and onto the next road (Bd Schuman 1684 lane -7.12,
      // Rocade link 5876, trunk link 9423 lane -7.48: the drawn half width is 6.2 m, the OSM one 9.35) - no player drives there.  Clamped to the drawn half width less the
      // car's half width, point by point (the drawn width tapers along a way: road-network.js taperDhw).
      const offs = world.laneOffsets(road);
      const dirs = road.oneway ? [1] : [1, -1];
      for (const off of offs) {
        out.lanes++;
        // --drawn: the lanes run beside the centre line the game DRAWS and carves (road-network.js rounds the corners of the OSM polyline with a 3 m Gaussian); the lanes of the
        // raw polyline leave the carriageway by up to 0.6 m at the corner of a tight service loop and every such corner read as a kerb jolt of 40 - 120 m/s2 (fix19)
        const centre = DRAWN ? drawnLine(road) : road.pts;
        const base = DRAWN ? clampToDrawn(offsetLine(centre, off), centre, road) : offsetLine(centre, off);
        for (const dir of dirs) {
          const line = dir > 0 ? base : base.slice().reverse();
          for (const speed of speedsOf(road.kind, msg.speeds)) {
            let res;
            try { res = driveLane({ world, car, road, line, speed }); } catch (err) { out.events.push({ type: 'error', value: 0, x: line[0][0], z: line[0][1], road: id, message: String(err && err.message || err) }); continue; }
            out.runs++; out.km += res.length / 1000;
            for (const e of res.events) out.events.push({ ...e, road: id, name: road.name || '', kind: road.kind, lane: off, dir, speed, bridge: !!(road.bridge || road.over), tunnel: !!road.tunnel });
          }
        }
      }
    }
    out.ms = Date.now() - t0;
    parentPort.postMessage(out);
  });
}

async function main() {
  const only = arg('--report-only', '');
  if (only) {   // rebuilds the markdown from a finished sweep-drive.json (the events are in it)
    const j = JSON.parse(fs.readFileSync(only, 'utf8'));
    const r = buildReport({ events: j.events, totals: j.totals, wall: j.wallSeconds, workers: j.workers, meta: null, speeds: j.speeds });
    fs.writeFileSync(only, JSON.stringify({ ...r.json, wallSeconds: j.wallSeconds, workers: j.workers }));
    fs.writeFileSync(only.replace(/\.json$/, '.md'), r.md);
    console.log(`[sweep-drive] report rebuilt: ${only.replace(/\.json$/, '.md')}`);
    return;
  }
  const outDir = path.resolve(arg('--out', path.join(HERE, '../../../..', 'luxdrive-sweep-out', 'drive')));
  fs.mkdirSync(outDir, { recursive: true });
  const limit = Number(arg('--limit', 0)) || 0;
  // (--area x0,z0,x1,z1[;x0,z0,x1,z1...]: one or more boxes, a road touching any of them is driven)
  const boxes = (arg('--area', '') || '').toString().split(';').filter(Boolean).map((b) => b.split(',').map(Number)).filter((b) => b.length === 4 && b.every(Number.isFinite));
  const speeds = (arg('--speeds', '13,25')).toString().split(',').map(Number);
  const resume = process.argv.includes('--resume');
  const freeGb = os.freemem() / 1e9;
  const workers = Math.max(1, Number(arg('--workers', 0)) || Math.min(os.cpus().length, Math.max(1, Math.floor(freeGb / 0.9))));
  console.log(`[sweep-drive] starting ${workers} workers (free ${freeGb.toFixed(1)} GB)`);
  const progressFile = path.join(outDir, 'progress.json');
  let done = new Set(), events = [], totals = { km: 0, runs: 0, lanes: 0, roads: 0, ms: 0 };
  if (resume && fs.existsSync(progressFile)) {
    const p = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    done = new Set(p.done); events = p.events; totals = p.totals;
    console.log(`[sweep-drive] resumed: ${done.size} roads done`);
  }
  const meta = new Map();
  const queue = [];
  const idle = [];
  const t0 = Date.now();
  let finished = 0, lastSave = Date.now(), started = false;
  const save = () => fs.writeFileSync(progressFile, JSON.stringify({ done: [...done], events, totals }));
  await new Promise((resolve) => {
    let alive = workers;
    const pump = (w) => {
      const ids = queue.shift();
      if (!ids) { w.postMessage({ stop: true }); if (--alive === 0) resolve(); return; }
      w.postMessage({ batch: finished, ids, speeds });
    };
    const begin = (list) => {
      let roads = list;
      for (const r of roads) meta.set(r.id, r);
      if (boxes.length) roads = roads.filter((r) => boxes.some((a) => r.bbox[2] >= a[0] && r.bbox[3] >= a[1] && r.bbox[0] <= a[2] && r.bbox[1] <= a[3]));
      if (limit) roads = roads.filter((_, i) => i % Math.max(1, Math.floor(roads.length / limit)) === 0).slice(0, limit);
      const todo = roads.filter((r) => !done.has(r.id)).sort((a, b) => b.length - a.length);   // the long ways first: the short ones even out the end
      for (let i = 0; i < todo.length; i += BATCH) queue.push(todo.slice(i, i + BATCH).map((r) => r.id));
      console.log(`[sweep-drive] ${todo.length} roads to drive, ${queue.length} batches, speeds ${speeds.join('/')}`);
      started = true;
      while (idle.length) pump(idle.shift());
    };
    for (let k = 0; k < workers; k++) {
      const w = new Worker(SELF, { workerData: { index: k, drawn: process.argv.includes("--drawn") }, resourceLimits: { maxOldGenerationSizeMb: 1800 } });
      w.on('message', (m) => {
        if (m.ready) { if (m.roads) begin(m.roads); if (started) pump(w); else idle.push(w); return; }
        events.push(...m.events);
        totals.km += m.km; totals.runs += m.runs; totals.lanes += m.lanes; totals.roads += m.roads; totals.ms += m.ms;
        finished++;
        m.ids.forEach((id) => done.add(id));
        if (finished % 10 === 0) console.log(`[sweep-drive] ${totals.roads} roads, ${totals.km.toFixed(0)} km, ${events.length} events, ${queue.length} batches left, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
        if (Date.now() - lastSave > 60000) { save(); lastSave = Date.now(); }
        pump(w);
      });
      w.on('error', (err) => { console.error('[sweep-drive] worker error', err); if (--alive === 0) resolve(); });
    }
  });
  save();
  const wall = (Date.now() - t0) / 1000;
  const report = buildReport({ events, totals, wall, workers, meta, speeds });
  fs.writeFileSync(path.join(outDir, 'sweep-drive.json'), JSON.stringify(report.json));
  fs.writeFileSync(path.join(outDir, 'sweep-drive.md'), report.md);
  console.log(`[sweep-drive] done in ${(wall / 60).toFixed(1)} min: ${totals.roads} roads, ${totals.lanes} lanes, ${totals.runs} runs, ${totals.km.toFixed(0)} km, ${events.length} events -> ${outDir}`);
}

/** Groups the events into places (greedy by score, CLUSTER_M) and writes the worst-list. */
export function buildReport({ events, totals, wall, workers, meta, speeds }) {
  // (offroad is judged on the ground road network under the car: on a deck or in a tube that network is not under the wheels, so those are no findings)
  const scored = events.filter((e) => e.type !== 'error' && !(e.type === 'offroad' && (e.bridge || e.tunnel))).map((e) => ({ ...e, score: score(e) })).sort((a, b) => b.score - a.score);
  const grid = new Map(), places = [];
  const key = (x, z) => `${Math.floor(x / CLUSTER_M)},${Math.floor(z / CLUSTER_M)}`;
  for (const e of scored) {
    let host = null;
    for (let a = -1; a <= 1 && !host; a++) for (let b = -1; b <= 1 && !host; b++) {
      for (const p of grid.get(`${Math.floor(e.x / CLUSTER_M) + a},${Math.floor(e.z / CLUSTER_M) + b}`) || []) if (Math.hypot(p.x - e.x, p.z - e.z) <= CLUSTER_M) { host = p; break; }
    }
    if (!host) { host = { x: e.x, z: e.z, name: e.name || e.kind, road: e.road, kind: e.kind, best: e, types: {}, n: 0, score: 0 }; places.push(host); const k = key(e.x, e.z); (grid.get(k) || grid.set(k, []).get(k)).push(host); }
    host.n++;
    const t = host.types[e.type];
    if (!t || e.score > t.score) host.types[e.type] = { score: e.score, value: e.value, lane: e.lane, speed: e.speed, dir: e.dir, part: e.part, id: e.id, x: e.x, z: e.z };
  }
  for (const p of places) p.score = Object.values(p.types).reduce((s, t) => s + t.score, 0);
  places.sort((a, b) => b.score - a.score);
  const typeCount = {};
  for (const e of scored) typeCount[e.type] = (typeCount[e.type] || 0) + 1;
  const errors = events.filter((e) => e.type === 'error');
  const json = { generated: new Date().toISOString(), speeds, workers, wallSeconds: wall, totals, typeCount, errors: errors.slice(0, 50), places: places.slice(0, 2000), events: scored.slice(0, 20000) };
  const fmt = (t, k) => (k === 'roll' ? `${t.value.toFixed(2)} rad` : k === 'jolt' ? `${t.value.toFixed(1)} m/s2` : k === 'air' ? `${t.value.toFixed(2)} s` : k === 'fall' ? `${t.value.toFixed(1)} m` : k === 'offroad' ? `${t.value.toFixed(0)} m` : `${t.part || 'solid'} #${t.id ?? '-'} ${t.value.toFixed(2)} m`);
  const md = [
    '# Lux Drive sweep 1: drive worst-list', '',
    `${totals.roads} roads, ${totals.lanes} lanes, ${totals.runs} runs at ${speeds.join('/')} m/s (class-capped), ${totals.km.toFixed(0)} km driven, ${(wall / 60).toFixed(1)} min on ${workers} workers.`,
    `Events: ${Object.entries(typeCount).map(([k, v]) => `${k} ${v}`).join(', ')}; ${places.length} places (within ${CLUSTER_M} m); ${errors.length} run errors.`, '',
    '| # | score | street | x, z | worst events (lane offset m, speed m/s, value) |', '|---|---|---|---|---|',
    ...places.slice(0, TOP).map((p, i) => `| ${i + 1} | ${p.score.toFixed(1)} | ${p.name === p.kind ? `(unnamed ${p.kind})` : `${p.name} (${p.kind})`}, way ${p.road} | ${Math.round(p.x)}, ${Math.round(p.z)} | ${Object.entries(p.types).sort((a, b) => b[1].score - a[1].score).map(([k, t]) => `${k} ${fmt(t, k)} (lane ${t.lane}, ${t.speed})`).join('; ')} |`), '',
  ].join('\n');
  return { json, md };
}
