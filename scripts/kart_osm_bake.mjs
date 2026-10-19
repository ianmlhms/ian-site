// Bakes OpenStreetMap extracts (Overpass JSON, `out geom`) into a compact JS data file for a Kart Lëtzebuerg street track.
//   node scripts/kart_osm_bake.mjs <osmBuildingsRoads.json> <osmTreesGreens.json> <lat0> <lon0> <trackId> <out.js> [x0 x1 z0 z1]
// Coordinates become metres from (lat0, lon0): x east, z south, stored as integer decimetres.
// Data: OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
import fs from 'node:fs';

const [, , fileA, fileB, lat0s, lon0s, id, out, ...box] = process.argv;
const lat0 = +lat0s, lon0 = +lon0s, M_LAT = 111194.93, M_LON = M_LAT * Math.cos((lat0 * Math.PI) / 180);
const [X0, X1, Z0, Z1] = box.length === 4 ? box.map(Number) : [-620, 560, -460, 560];
const proj = (p) => [(p.lon - lon0) * M_LON, -(p.lat - lat0) * M_LAT];
const inBox = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
const dm = (v) => Math.round(v * 10);

function area(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
function simplifyRing(p, tol) {
  p = p.slice(); let changed = true;
  while (changed && p.length > 4) {
    changed = false;
    for (let i = 0; i < p.length && p.length > 4; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1e-6;
      const d = Math.abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / l;
      if (d < tol) { p.splice(i, 1); changed = true; }
    }
  }
  return p;
}
function simplifyLine(p, tol) {
  if (p.length < 3) return p;
  const keep = new Array(p.length).fill(false); keep[0] = keep[p.length - 1] = true;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let md = 0, mi = -1;
    const dx = p[e][0] - p[s][0], dz = p[e][1] - p[s][1], l = Math.hypot(dx, dz) || 1e-6;
    for (let i = s + 1; i < e; i++) { const d = Math.abs((p[i][0] - p[s][0]) * dz - (p[i][1] - p[s][1]) * dx) / l; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = true; stack.push([s, mi], [mi, e]); }
  }
  return p.filter((_, i) => keep[i]);
}
const flat = (pts) => pts.flatMap((q) => [dm(q[0]), dm(q[1])]);

const A = JSON.parse(fs.readFileSync(fileA)), B = JSON.parse(fs.readFileSync(fileB));
const buildings = [], roads = [], greens = [], trees = [], water = [], rails = [];
const roadClass = { motorway: 0, trunk: 0, primary: 0, secondary: 0, tertiary: 0, residential: 1, unclassified: 1, living_street: 1, service: 2, pedestrian: 3, footway: 4, path: 4, cycleway: 4, steps: 4, track: 4 };
const roadWidth = [11, 7, 4, 6, 1.6];
for (const e of A.elements) {
  const t = e.tags || {};
  if (!e.geometry) continue;
  const pts = e.geometry.map(proj);
  if (t.building) {
    let ring = pts.slice(); if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    if (ring.length < 3) continue;
    const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length, cz = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    if (!inBox(cx, cz)) continue;
    ring = simplifyRing(ring, 0.35); if (ring.length < 3) continue;
    const a = area(ring); if (Math.abs(a) < 14) continue;
    if (a < 0) ring.reverse();                              // normalise: positive signed area in (x, z)
    const kindTag = t.building;
    const kind = /^(church|chapel|cathedral)$/.test(kindTag) ? 1 : /^(garage|garages|roof|shed|kiosk|carport|service|hut)$/.test(kindTag) ? 2 : kindTag === 'house' ? 3
      : /^(university|college|office|commercial|retail|public|civic|government|hospital|hotel|kindergarten|school|train_station|transportation)$/.test(kindTag) ? 4 : /^(industrial|warehouse|factory|manufacture|storage_tank|silo)$/.test(kindTag) ? 5 : 0;
    const lv = Math.max(0, Math.min(14, parseInt(t['building:levels']) || (t.height ? Math.round(parseFloat(t.height) / 3.2) : 0)));
    buildings.push([lv, kind, flat(ring)]);
  } else if (t.highway && roadClass[t.highway] != null) {
    if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') continue;
    if (!pts.some((q) => inBox(q[0], q[1]))) continue;
    roads.push([roadClass[t.highway], flat(simplifyLine(pts, 0.4))]);
  } else if (t.leisure === 'park' || t.leisure === 'garden') {
    greens.push([0, flat(simplifyLine(pts, 0.6))]);
  } else if (t.waterway && /^(river|stream|canal|ditch|drain)$/.test(t.waterway)) {
    if (t.tunnel && t.tunnel !== 'no') continue;
    if (pts.some((q) => inBox(q[0], q[1]))) water.push([t.waterway === 'river' ? 0 : t.waterway === 'canal' ? 1 : 3, flat(simplifyLine(pts, 0.5))]);
  } else if (t.natural === 'water') {
    if (pts.some((q) => inBox(q[0], q[1]))) water.push([2, flat(simplifyLine(pts, 0.6))]);
  }
}
for (const e of B.elements) {
  const t = e.tags || {};
  if (e.type === 'node' && t.natural === 'tree') { const q = proj(e); if (inBox(q[0], q[1])) trees.push([dm(q[0]), dm(q[1])]); continue; }
  if (!e.geometry) continue;
  const pts = e.geometry.map(proj);
  if (t.natural === 'tree_row') {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 7));
      for (let k = 0; k < n; k++) { const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n; if (inBox(x, z)) trees.push([dm(x), dm(z)]); }
    }
  } else if (t.railway && /^(tram|light_rail|rail)$/.test(t.railway)) {
    if (t.tunnel && t.tunnel !== 'no') continue;
    if (pts.some((q) => inBox(q[0], q[1]))) rails.push([t.railway === 'tram' ? 0 : 1, flat(simplifyLine(pts, 0.5))]);
  } else if (t.landuse === 'industrial' || t.landuse === 'railway' || t.natural === 'bare_rock') {
    if (pts.some((q) => inBox(q[0], q[1]))) greens.push([3, flat(simplifyLine(pts, 1.0))]);
  } else if (t.landuse || t.natural) {
    const forest = t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub';
    if (pts.some((q) => inBox(q[0], q[1]))) greens.push([forest ? 1 : 0, flat(simplifyLine(pts, 0.8))]);
  }
}
const json = (v) => JSON.stringify(v);
const src = `/* Kart Lëtzebuerg — baked OpenStreetMap data for '${id}' (buildings, streets, parks, trees). Generated by scripts/kart_osm_bake.mjs.
 * © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright. Metres from ${lat0} N / ${lon0} E (x east, z south), stored as integer decimetres. */
(function () { const KL = window.KL; KL.osm = KL.osm || {}; KL.osm[${json(id)}] = {
roadW: ${json(roadWidth)},
b: ${json(buildings)},
r: ${json(roads)},
g: ${json(greens)},
t: ${json(trees)},
w: ${json(water)},
rl: ${json(rails)} }; })();
`;
fs.writeFileSync(out, src);
console.error(`buildings ${buildings.length}, roads ${roads.length}, greens ${greens.length}, trees ${trees.length}, water ${water.length}, rails ${rails.length}, ${(src.length / 1024).toFixed(0)} KB`);
