/* Lux Drive: bakes a deck for every drivable bridge way the deck bake has none for (QA2 / decks10: 43 drivable ways tagged bridge or layer >= 1, 1.5 km, most of the Pont
 * Jean-Pierre Buchler, the Clausener Bierg viaduct, the Schlassbréck: the car drove on the valley floor under them or fell off the end of the next deck).
 *   node scripts/luxdrive/bake_orphan_decks.mjs [--check] [--out=<file>]
 * The rules are bake_decks.py's, read on the same 2 m DSM (scripts/luxdrive/dsm_points.py, the 2024 COG of data.public.lu): the deck every 4 m on the way's line, the median DSM on
 * the axis, a median filter (9) and a moving mean (5), the ends pinned to the ground the game draws, never under it; a way whose deck stands less than 1.2 m over the ground runs on
 * the ground (the road network carves such a way: road-network.js deckless), a deck higher than 0.7 x its length or a canopy is not a deck.  The new decks are appended (their ids
 * follow the old ones; every id a landmark knows stays valid).  Deterministic for a given DSM; re-run after the roads or the decks change, then bake_deck_fixes.mjs and bake_walls.mjs.
 * `--check` only reports. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './world_node.mjs';
import { encodeDecks, decodeDecks } from '../../pb/lux-drive/decks.js';
import { orphanBridgeWays } from '../../pb/lux-drive/road-network.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = path.resolve(HERE, '../../pb/lux-drive/data/decks.bin');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice(6) : OUT_DEFAULT;
const CHECK_ONLY = process.argv.includes('--check');
const PYTHON = process.env.LUXDRIVE_PYTHON || path.join(os.homedir(), 'Library/Caches/luxtram-work/.venv/bin/python');

// bake_decks.py's numbers (the same rules for the same kind of data)
const SAMPLE_M = 4.0, MAX_CLEARANCE = 150.0, STAND_ALONE = 4.0, DIP = 1.0, SPAN_DIP = 3.0, SURFACE_ROUGH = 1.0, SIDE_OFFSET = 10.0, LIFT = 0.05;
const MIN_CLEAR = 1.2, MAX_HEIGHT_PER_LENGTH = 0.7, WIDTH_EXTRA = 1.2;
const MAX_END_GRADE = 0.25;  // m/m between the two ends of a new deck
const MIN_UNCOVERED = 0.8;   // a new deck only for a way no deck carries over at least this share of its length
const PARAPET_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary']);

/** bake_decks.py resample: points every `step` m along the polyline plus the last point. */
function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], seg = Math.hypot(bx - ax, bz - az);
    if (seg < 1e-9) continue;
    const last = out[out.length - 1];
    let d = step - Math.hypot(ax - last[0], az - last[1]);
    while (d <= seg) { const t = d / seg; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); d += step; }
  }
  const e = pts[pts.length - 1], l = out[out.length - 1];
  if (l[0] !== e[0] || l[1] !== e[1]) out.push(e);
  return out;
}
const median = (a) => { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** bake_decks.py median_filter / smooth (the ends pinned). */
function medianFilter(v, w) { const n = v.length; if (n < 3) return v.slice(); const h = w >> 1, out = v.slice(); for (let i = 0; i < n; i++) out[i] = median(v.slice(Math.max(0, i - h), Math.min(n, i + h + 1))); out[0] = v[0]; out[n - 1] = v[n - 1]; return out; }
function smooth(v, w) { const n = v.length; if (n < 3) return v.slice(); const h = w >> 1, out = v.slice(); for (let i = 1; i < n - 1; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); let s = 0; for (let k = a; k < b; k++) s += v[k]; out[i] = s / (b - a); } return out; }

const w = await loadWorld();
const roads = w.data.roads;
const orphans = orphanBridgeWays(roads, w.data.decks, w.field.network);
console.log(`orphan bridge ways: ${orphans.length}`);
// the points to read: the line every 4 m and the land beside it on both sides (bake_decks.py)
const prepared = orphans.map((road) => {
  const line = resample(road.pts, SAMPLE_M);
  const half = (road.width + WIDTH_EXTRA) / 2 + SIDE_OFFSET;
  const left = [], right = [];
  line.forEach(([x, z], k) => {
    const [ax, az] = line[Math.max(0, k - 1)], [bx, bz] = line[Math.min(line.length - 1, k + 1)], ll = Math.hypot(bx - ax, bz - az) || 1;
    const ox = -(bz - az) / ll, oz = (bx - ax) / ll;
    left.push([x + ox * half, z + oz * half]); right.push([x - ox * half, z - oz * half]);
  });
  return { road, line, left, right, g: line.map(([x, z]) => w.field.baseHeight(x, z)), uncovered: road.uncovered };
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'luxdrive-orphans-'));
const inFile = path.join(tmp, 'in.json'), outFile = path.join(tmp, 'out.json');
fs.writeFileSync(inFile, JSON.stringify(prepared.map((p) => [...p.line, ...p.left, ...p.right])));
const py = spawnSync(PYTHON, [path.join(HERE, 'dsm_points.py'), inFile, outFile], { stdio: ['ignore', 'inherit', 'inherit'] });
if (py.status !== 0) throw new Error(`bake_orphan_decks: dsm_points.py failed (exit ${py.status}); the DSM is read from the network (data.public.lu)`);
const dsm = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.rmSync(tmp, { recursive: true, force: true });

const made = [], rejected = [];
prepared.forEach((p, pi) => {
  const { road, line, g } = p, n = line.length, vals = dsm[pi];
  const raw = vals.slice(0, n), lv = vals.slice(n, 2 * n), rv = vals.slice(2 * n, 3 * n);
  let tops = raw.map((v, k) => { const u = v === null || v - g[k] > MAX_CLEARANCE || v - g[k] < -2 ? g[k] : v; return Math.max(u, g[k]); });
  tops = smooth(medianFilter(tops, 9), 5);
  tops[0] = g[0] + LIFT; tops[n - 1] = g[n - 1] + LIFT;
  tops = tops.map((t, k) => Math.max(t, g[k] + LIFT));
  const clear = Math.max(...tops.map((t, k) => t - g[k]));
  let length = 0;
  for (let i = 1; i < n; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let alone = 0;
  for (let k = 1; k < n - 1; k++) {
    if (tops[k] - g[k] < 1.2) continue;
    const near = [lv[k], rv[k]].filter((v) => v !== null);
    if (near.length) alone = Math.max(alone, tops[k] - Math.min(...near));
  }
  const dip = n > 2 ? Math.max(g[0], g[n - 1]) - Math.min(...g.slice(1, n - 1)) : 0;
  const diffs = [];
  for (let k = 1; k < n - 1; k++) if (raw[k] !== null && raw[k - 1] !== null && raw[k + 1] !== null) diffs.push(Math.abs(raw[k + 1] - 2 * raw[k] + raw[k - 1]));
  const rough = diffs.length >= 3 ? median(diffs) : 0;
  const rec = { id: road.id, name: road.name, kind: road.kind, length: +length.toFixed(0), clear: +clear.toFixed(2), alone: +alone.toFixed(1), dip: +dip.toFixed(1), rough: +rough.toFixed(2) };
  if (clear < MIN_CLEAR) { rejected.push({ ...rec, why: 'runs on the ground (carved)' }); return; }
  // (a smooth deck that stands alone over a real dip is a bridge however short: the Schlassbréck spans the Pétrusse 21 m up on a 23 m way)
  const standsAlone = alone >= STAND_ALONE && rough <= SURFACE_ROUGH;
  if (clear > MAX_HEIGHT_PER_LENGTH * Math.max(length, 1) && !(standsAlone && dip >= SPAN_DIP)) { rejected.push({ ...rec, why: 'too high for its length' }); return; }
  // Stricter than bake_decks.py for these leftovers: a deck must stand alone or span a dip.  A DSM 1.5 - 2 m over a way whose sides are as high (alone < 4) and whose land does not
  // dip is what stands on the way (the trees and the kiosks of the Plëss d'Arem, the lamps and the railings of the Buchler): the way runs on the ground and is carved.
  if (!standsAlone && dip < SPAN_DIP) { rejected.push({ ...rec, why: 'nothing stands alone over a dip (carved)' }); return; }
  // (a deck whose ends lie further apart in level than any road climbs is a stair or a lift, not a bridge: Rue Laurent Menager in Pfaffenthal falls 6 m over 9 m to a dead end)
  if (Math.abs(g[n - 1] - g[0]) > MAX_END_GRADE * Math.max(length, 1)) { rejected.push({ ...rec, why: 'its ends are too steep for a road' }); return; }
  // (a way that other decks already carry for the most part - a long track whose bridges are baked - keeps them: a deck along the whole way would lie on them)
  if (p.uncovered < MIN_UNCOVERED * length) { rejected.push({ ...rec, why: 'mostly on its decks already' }); return; }
  made.push({ rec, deck: { parapet: PARAPET_KINDS.has(road.kind), spans: dip >= SPAN_DIP, width: road.width + WIDTH_EXTRA, pts: line.map((q) => [...q]), tops: Float32Array.from(tops) } });
});
for (const m of made) console.log('  deck   ', JSON.stringify(m.rec));
for (const r of rejected) console.log('  no deck', JSON.stringify(r));

// the file: every old slot (a removed one keeps its slot), then the new decks
const raw = decodeDecks(new Uint8Array(fs.readFileSync(OUT_DEFAULT)));
const total = Math.max(...raw.map((d) => d.id)) + 1;
const slots = new Array(total);
for (const d of raw) slots[d.id] = { ...d };
for (let i = 0; i < total; i++) if (!slots[i]) slots[i] = { id: i, parapet: false, spans: false, width: 0, pts: [[0, 0], [0, 0]], tops: Float32Array.from([0, 0]), removed: true };
const out = [...slots, ...made.map((m) => m.deck)];
console.log(`decks: ${raw.length} + ${made.length} new (${rejected.length} ways run on the ground or are no deck)`);
if (!CHECK_ONLY) {
  fs.writeFileSync(OUT, Buffer.from(encodeDecks(out)));
  console.log('wrote', OUT, out.length, 'slots');
}
