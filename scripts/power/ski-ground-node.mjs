#!/usr/bin/env node
/* Proof of concept (power test, 22 Nov 2026): two of scripts/ski/ground-check.mjs's checks in plain Node — three.js builds the
 * meshes, nothing is rendered, no browser starts. ground-check boots the full game in Chromium AND WebKit per resort, waits for every
 * tile to be meshed (rendering all along) and then only reads geometry on the CPU (vertices, Raycaster), so these checks need no GPU.
 *
 *   node scripts/power/ski-ground-node.mjs [--root <checkout with pb/ski>] [--resorts killy,...] [--three <three.min.js r160>]
 *
 *   streets   EVERY vertex of the village streets of the whole resort (ground-check: those within 80 m of 5 village spots):
 *             |drawn - physics| = |y - surface.height - LIFT| <= 6 cm
 *   coplanar  the near-detail village meshes of the whole resort: no two overlapping triangles in the same plane (z-fighting); the
 *             same plane-key + 2D separating-axis test as ground-check, run per merge cell instead of within 120 m of 5 spots.
 *             The houses are the ones the game draws: modes/freeride.js's lift world drops those in stations / low lift lanes.
 * three.js r160 is the page's own build (cdn.jsdelivr.net three@0.160.0, the same SRI hash as pb/ski.html), cached locally.
 * Exit 1 on a failure. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const ROOT = path.resolve(opt("--root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")));
const THREE_FILE = opt("--three", path.join(os.homedir(), "Library/Caches/ski-work/power-test/three/three-0.160.0.min.js"));
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz").split(",");
const STREET_TOL = 0.06, LIFT = 0.006;
const SAMPLES = [];                       // the first overlapping pairs (where, so a failure can be looked at)

if (!fs.existsSync(THREE_FILE)) {
  console.error(`three.js r160 missing: curl -sSfL -o ${THREE_FILE} https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js`);
  process.exit(2);
}
globalThis.window = globalThis;
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(THREE_FILE, "utf8"), { filename: THREE_FILE });
if (!globalThis.THREE || !globalThis.THREE.REVISION) { console.error("three.js did not load"); process.exit(2); }

const ski = (file) => import(pathToFileURL(path.join(ROOT, "pb/ski", file)).href);
const { unpackResort } = await ski("linepack.js");
const { decodeGrid, decodeRle } = await ski("codec.js");
const { createField, createPisteNet } = await ski("field.js");
const { createSurface } = await ski("surface.js");
const { createParkLayout } = await ski("modes/park.js");
const { createRoads, decodeRoads } = await ski("roads.js");
const { createVillage } = await ski("village.js");
const { createLiftPath } = await ski("lift-path.js");
const { createLiftWorld } = await ski("lift-site.js");

/* env.u: the shared uniforms the materials point at (only their objects are needed, no shader is compiled) */
const env = { u: new Proxy({}, { get: (target, key) => (target[key] ||= { value: null }) }), state: {} };

function loadResort(rid) {
  const dir = path.join(ROOT, "pb/ski/data", rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, "resort.json"), "utf8")));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, "far.bin"))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, "classes.bin"))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, "t", `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const read = (name) => (fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) : null);
  return { resort, field, surface, buildings: read("buildings.json") || [], streets: read("roads.json") };
}

function streetCheck({ surface, streets }) {
  const scene = new THREE.Scene();
  const rows = decodeRoads(streets);
  if (!rows.length) return { verts: 0, worst: 0 };
  createRoads({ scene, roads: rows, env, height: (x, z) => surface.height(x, z) });
  let worst = 0, verts = 0;
  scene.getObjectByName("ski-roads").traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const d = p.getY(k) - surface.height(p.getX(k), p.getZ(k)) - LIFT;
      verts++;
      if (Math.abs(d) > Math.abs(worst)) worst = d;
    }
  });
  return { verts, worst };
}

/* ground-check's coplanar test (same keys, same 1 cm shrink, same SAT), per mesh */
function coplanarPairs(mesh) {
  const P = mesh.geometry.attributes.position;
  if (!P) return { pairs: 0, tris: 0 };
  const groups = new Map();
  let tris = 0;
  const ox = P.getX(0), oy = P.getY(0), oz = P.getZ(0);       // a local origin: small numbers, a stable key
  for (let t = 0; t + 2 < P.count; t += 3) {
    const a = [P.getX(t), P.getY(t), P.getZ(t)], b = [P.getX(t + 1), P.getY(t + 1), P.getZ(t + 1)], c = [P.getX(t + 2), P.getY(t + 2), P.getZ(t + 2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const area = Math.hypot(nx, ny, nz) / 2;
    if (area < 0.01) continue;
    nx /= area * 2; ny /= area * 2; nz /= area * 2;
    if (nx < -1e-6 || (Math.abs(nx) < 1e-6 && (ny < -1e-6 || (Math.abs(ny) < 1e-6 && nz < 0)))) { nx = -nx; ny = -ny; nz = -nz; }
    const d = nx * (a[0] - ox) + nz * (a[2] - oz) + ny * (a[1] - oy);
    const key = `${Math.round(nx * 300)},${Math.round(ny * 300)},${Math.round(nz * 300)},${Math.round(d * 100)}`;
    let g = groups.get(key); if (!g) groups.set(key, (g = [])); g.push([a, b, c, nx, ny, nz]);
    tris++;
  }
  const proj = (tri, ax, ay) => { const m = [0, 1, 2].map((i) => (tri[0][i] + tri[1][i] + tri[2][i]) / 3); return [0, 1, 2].map((k) => { const p = tri[k]; const dx = p[ax] - m[ax], dy = p[ay] - m[ay]; const l = Math.hypot(dx, dy) || 1; const sh = Math.max(0, l - 0.01) / l; return [m[ax] + dx * sh, m[ay] + dy * sh]; }); };
  const sep = (A, B) => { for (const T of [A, B]) for (let i = 0; i < 3; i++) { const p = T[i], q = T[(i + 1) % 3]; const nx2 = q[1] - p[1], ny2 = p[0] - q[0]; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (const r of A) { const d2 = r[0] * nx2 + r[1] * ny2; a0 = Math.min(a0, d2); a1 = Math.max(a1, d2); } for (const r of B) { const d2 = r[0] * nx2 + r[1] * ny2; b0 = Math.min(b0, d2); b1 = Math.max(b1, d2); } if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return true; } return false; };
  const onPlane = (A, B) => B.slice(0, 3).every((q) => Math.abs(A[3] * (q[0] - A[0][0]) + A[4] * (q[1] - A[0][1]) + A[5] * (q[2] - A[0][2])) < 0.003);
  let pairs = 0;
  for (const g of groups.values()) {
    if (g.length < 2 || g.length > 600) continue;
    const [, , , nx, ny, nz] = g[0];
    const dom = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 0 : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
    const ax = dom === 0 ? 1 : 0, ay = dom === 2 ? 1 : 2;
    const pr = g.map((t) => proj(t, ax, ay));
    for (let i = 0; i < pr.length; i++) for (let j = i + 1; j < pr.length; j++) if (onPlane(g[i], g[j]) && !sep(pr[i], pr[j])) { pairs++; if (SAMPLES.length < 6) SAMPLES.push({ at: g[i][0].map((v) => Math.round(v)), n: [nx, ny, nz].map((v) => +v.toFixed(2)), a: g[i].slice(0, 3).map((q) => q.map((v) => +v.toFixed(2))), b: g[j].slice(0, 3).map((q) => q.map((v) => +v.toFixed(2))) }); }
  }
  return { pairs, tris };
}

/* the houses main.js draws: modes/freeride.js builds the lift world over every lift path, setBuildings() drops the ones in a station */
function drawnBuildings({ resort, field, buildings }) {
  const paths = new Map();
  for (const [i, l] of resort.lifts.entries()) { const p = createLiftPath(l, (x, z) => field.height(x, z)); if (p) paths.set(i, p); }
  const world = createLiftWorld(paths, { buildings, cutsFrom: createLiftWorld(paths) });
  return buildings.filter((_, i) => world.keepBuilding(i));
}

function villageCheck(data) {
  const scene = new THREE.Scene();
  const { field } = data, buildings = drawnBuildings(data);
  const village = createVillage({ scene, rows: buildings, env, height: (x, z) => field.baseHeight(x, z), level: "low" });
  let pairs = 0, tris = 0, meshes = 0;
  // near meshes = the detail level ground-check sees around its spots (every other mesh in the group is a far one)
  village.group.children.forEach((mesh, i) => { if (i % 2 === 0) { const r = coplanarPairs(mesh); pairs += r.pairs; tris += r.tris; meshes++; } });
  return { buildings: buildings.length, meshes, tris, pairs };
}

let fails = 0;
for (const rid of resorts) {
  const t0 = performance.now();
  const data = loadResort(rid);
  const t1 = performance.now();
  const st = streetCheck(data);
  const vg = villageCheck(data);
  const ok = Math.abs(st.worst) <= STREET_TOL && vg.pairs === 0;
  if (!ok) fails++;
  if (!ok && SAMPLES.length) console.log(JSON.stringify(SAMPLES.splice(0)));
  console.log(JSON.stringify({ rid, ok, streetVerts: st.verts, worstStreet: +st.worst.toFixed(3), ...vg, loadMs: Math.round(t1 - t0), checkMs: Math.round(performance.now() - t1), rssMb: Math.round(process.memoryUsage().rss / 1048576) }));
}
console.log(`\n${resorts.length - fails} / ${resorts.length} resorts green`);
process.exit(fails ? 1 : 0);
