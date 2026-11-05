/* Lux Drive: takes the decks that lie ON a carriageway out of pb/lux-drive/data/decks.bin (the grey slabs across Escher Strooss).
 *   node scripts/luxdrive/bake_deck_fixes.mjs [--check] [--out=<file>]
 * A deck is a bridge: it stands clear of whatever lies under it.  OSM has bridge=yes ways that sit at road level (a viaduct's ramp that touches down, a walkway that crosses a street at grade, a
 * road bridge over a ditch): the deck then lies on the carriageway of the carved ground, as a slab with parapets on the tarmac.  Audit: sample every deck every 1.5 m (the first and last 8 m belong to
 * its own approach); a sample is ON A ROAD when the carved ground has a carriageway under it (sdCar < -0.5) and the deck is less than ON_ROAD_CLEAR over it.
 *   - a deck that never rises above REMOVE_CLEAR over the ground and is on a road: not a bridge, removed (its slot in the file stays, with the removed flag, so every deck id a landmark knows stays valid);
 *   - any other deck with samples on a road: split there, the on-road stretch is left out (a walkway that reaches the street at grade; the street is the carved road), pieces shorter than MIN_PIECE are dropped.
 * Decks that a landmark replaces (Pont Rouge, Pont Adolphe, ...) are left alone: the landmark hides them.  Deterministic; run it again after the carve or the decks change (the harness, gate D, fails when a deck is on a road).
 * `--check` only reports.  The pieces of a split deck are appended to the file (ids >= the old count). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './world_node.mjs';
import { createLandmarks } from '../../pb/lux-drive/landmarks.js';
import { encodeDecks, DECK } from '../../pb/lux-drive/decks.js';
import { DECK_ON_ROAD } from '../../pb/lux-drive/deck-shape.js';

const OUT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pb/lux-drive/data/decks.bin');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice(6) : OUT_DEFAULT;
const CHECK_ONLY = process.argv.includes('--check');
const { STEP, END_MARGIN, ON_ROAD_CLEAR, REMOVE_CLEAR, MIN_PIECE, ROAD_SD } = DECK_ON_ROAD;

const w = await loadWorld();
const net = w.field.network;
const landmarks = createLandmarks({ buildings: w.data.buildings, decks: w.deckNetwork.decks, ground: (x, z) => w.surface.height(x, z), roads: w.data.roads });
const li = { sdCar: 9, sdPave: 9 };

/** The arc stations of a deck where it lies on a road: { onRoad: [bool per segment], maxClear, length, cum }. */
function audit(deck) {
  const n = deck.pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(deck.pts[i][0] - deck.pts[i - 1][0], deck.pts[i][1] - deck.pts[i - 1][1]));
  const length = cum[n - 1];
  const onRoad = new Array(n - 1).fill(false);
  let maxClear = -Infinity, hits = 0;
  for (let i = 0; i < n - 1; i++) {
    const L = cum[i + 1] - cum[i];
    const m = Math.max(1, Math.ceil(L / STEP));
    for (let k = 0; k < m; k++) {
      const f = k / m, s = cum[i] + L * f;
      const x = deck.pts[i][0] + (deck.pts[i + 1][0] - deck.pts[i][0]) * f, z = deck.pts[i][1] + (deck.pts[i + 1][1] - deck.pts[i][1]) * f;
      const top = deck.tops[i] + (deck.tops[i + 1] - deck.tops[i]) * f;
      const clear = top - w.surface.height(x, z);
      maxClear = Math.max(maxClear, clear);
      if (s < END_MARGIN || s > length - END_MARGIN) continue;
      net.carve(x, z, li);
      if (li.sdCar < ROAD_SD && clear < ON_ROAD_CLEAR) { onRoad[i] = true; hits++; }
    }
  }
  return { onRoad, maxClear, length, cum, hits };
}

/** A piece of a split deck as the harness wants it: the flag `spans` follows the dip of the land under it (gate D), and a piece that never stands 0.5 m clear of the land is no bridge (null). */
function pieceOf(deck, p, q) {
  const pts = deck.pts.slice(p, q + 1).map((pt) => [...pt]);
  const tops = Float32Array.from(deck.tops.slice(p, q + 1));
  const n = pts.length;
  const base = pts.map((pt) => w.field.baseHeight(pt[0], pt[1]));
  if (Math.max(...tops.map((t, i) => t - base[i])) < 0.5) return null;
  const lowest = Math.min(...base.slice(1, n - 1));
  const dip = n > 2 ? Math.max(base[0], base[n - 1]) - lowest : 0;
  return { parapet: deck.parapet, spans: dip >= DECK.spanDip, width: deck.width, pts, tops };
}

const raw = w.data.decks;                       // as decoded from the file (no removed decks), ids = file index
const piped = new Map(w.deckNetwork.decks.map((d) => [d.id, d]));   // the same decks with the ends pinned to the ground (what the game audits)
const total = Math.max(...raw.map((d) => d.id)) + 1;
const outDecks = new Array(total);
for (const d of raw) outDecks[d.id] = { ...d, pts: d.pts.map((p) => [...p]), tops: Float32Array.from(d.tops) };
for (let i = 0; i < total; i++) if (!outDecks[i]) outDecks[i] = { id: i, parapet: false, spans: false, width: 0, pts: [[0, 0], [0, 0]], tops: Float32Array.from([0, 0]), removed: true };   // a slot of an earlier removal: keep it

const report = { removed: [], split: [], landmark: 0, clean: 0 };
const appended = [];
for (const d of raw) {
  if (landmarks.hiddenDecks.has(d.id)) { report.landmark++; continue; }
  const a = audit(piped.get(d.id));
  if (a.hits === 0) { report.clean++; continue; }
  if (a.maxClear < REMOVE_CLEAR) { outDecks[d.id].removed = true; report.removed.push({ id: d.id, at: d.pts[d.pts.length >> 1].map(Math.round), width: d.width, maxClear: +a.maxClear.toFixed(1), hits: a.hits }); continue; }
  // split: maximal runs of segments that are not on a road
  const n = d.pts.length;
  const pieces = [];
  let i = 0;
  while (i < n - 1) {
    if (a.onRoad[i]) { i++; continue; }
    let j = i;
    while (j < n - 1 && !a.onRoad[j]) j++;
    pieces.push([i, j]);                         // points i .. j
    i = j;
  }
  const kept = pieces.filter(([p, q]) => a.cum[q] - a.cum[p] >= MIN_PIECE).map(([p, q]) => pieceOf(d, p, q)).filter(Boolean);
  report.split.push({ id: d.id, at: d.pts[n >> 1].map(Math.round), width: d.width, pieces: kept.length, dropped: pieces.length - kept.length, hits: a.hits });
  if (kept.length === 0) { outDecks[d.id].removed = true; continue; }
  Object.assign(outDecks[d.id], kept[0]);
  appended.push(...kept.slice(1));
}
for (const [k, d] of appended.entries()) outDecks.push({ id: total + k, ...d });

console.log(`decks ${raw.length}: clean ${report.clean}, landmark ${report.landmark}, removed ${report.removed.length}, split ${report.split.length} (+${appended.length} pieces)`);
for (const r of report.removed) console.log('  removed', JSON.stringify(r));
for (const r of report.split) console.log('  split  ', JSON.stringify(r));
if (!CHECK_ONLY) {
  fs.writeFileSync(OUT, Buffer.from(encodeDecks(outDecks)));
  console.log('wrote', OUT, outDecks.length, 'slots');
}
