#!/usr/bin/env node
/* Reach check (28 Nov 2026; Ian, Via Lattea Sauze d'Oulx: Rossella / 40 / the links to 36 could only be reached by going UPHILL).
 * Is every piste reachable by skiing DOWNHILL? Sources: every lift top (a lift station is where a run starts), the resort's first lift
 * bottom and the ski-bus lift bottoms (spawn). Edges (the game's own data, Node, no browser; the graph of deadend-check.mjs):
 *   along a piste (the bake orients it downhill), piste -> another piste's point within JOIN m (at most UP m up: flats / joins),
 *   lift top -> piste point within TOP_R m (UP m up), and, unless --strict, skiing off the piste down to any piste point within OFF m
 *   (>= OFF_DROP m lower, <= 40 degrees): that is what a free-ride skier can do.
 * A piste is reachable when its START (first points, START_N * STEP m) is reached. Unreachable ones are listed with the nearest lift top
 * and the height gap, cross-checked with the official lists (~/Library/Caches/ski-work/data-round/official/<rid>.json, outside the repo)
 * and the OSM lifecycle tags (abandoned / disused ...). Also lists COLOUR mismatches against the official lists where the official name
 * matches the piste's name exactly.
 *   node scripts/ski/reach-check.mjs [resort ...] [--strict] [--json]       exit 1 when a CLEAR dead leftover is still in the data
 * "clear" = unreachable AND (confirmed dead by the owner OR tagged abandoned in OSM, not a short walk from a lift top); everything
 * else (also "not in the official list": the lists are partial and have no ski routes) is only listed. A colour mismatch is clear when
 * the official name matches exactly, is unique on both sides and the piste is no link / variant / ski route. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { unpackResort } = await imp('linepack.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { firstLift } = await imp('modes/clear.js');
const { busLifts } = await imp('modes/explore.js');

export const REACH = Object.freeze({ STEP: 25, JOIN: 50, TOP_R: 150, UP: 8, OFF: 250, OFF_DROP: 8, OFF_SLOPE: 0.84, START_N: 2 });
const ISOLATED = 2000;
const { STEP, JOIN, TOP_R, UP, OFF, OFF_DROP, OFF_SLOPE, START_N } = REACH;
const SKI = path.join(os.homedir(), 'Library/Caches/ski-work');
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax', 'soelden'];
/** Pistes the owner confirmed dead (28 Nov 2026, Via Lattea Sauze: the old Moncrons / Chardonet / Scoiattolo / Costapiana drag lifts are closed, the 2025/26
 *  map has no Rossella and no 40; ski routes are not in any official list, so "not listed" alone never removes a route). Their links go with them; Gran Villard is no longer connected by ski (the village stays). */
const CONFIRMED_DEAD = { vialattea: ['rossella', '40', 'verbindung-gran-villard'] };
/** Official lists that cover a resort: file names under data-round/official/ (vialattea = Sestriere side + Montgenèvre). */
const OFFICIAL = { killy: ['killy'], '3vallees': ['3vallees'], zermatt: ['zermatt'], arlberg: ['arlberg', 'warth', 'sonnenkopf'], kronplatz: ['kronplatz'], vialattea: ['vialattea', 'montgenevre'] };
const LIFECYCLE = /^(abandoned|disused|razed|was|proposed|construction|removed)(:|$)|^piste:(abandoned|disused)$/;
const args = process.argv.slice(2), asJson = args.includes('--json');
const resorts = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : ALL;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const COLOUR_WORD = /^(rout|blo|schwaarz|greng|pist)\s+/i;
const colourOf = { blue: 'blue', red: 'red', black: 'black', green: 'green', easy: 'blue', intermediate: 'red', advanced: 'black', expert: 'black', novice: 'green', freeride: 'black', extreme: 'black' };
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

/** OSM ways of a resort by normalised name, with their lifecycle tags (the data-round download first, else the first one). */
function osmByName(rid) {
  const map = new Map();
  for (const dir of [path.join(SKI, 'data-round', rid, 'osm'), path.join(SKI, rid, 'osm')]) {
    const j = readJson(path.join(dir, 'pistes.json'));
    if (!j) continue;
    for (const e of j.elements || []) {
      const t = e.tags || {};
      const n = norm(t.name || t['piste:name'] || t.ref || '');
      if (!n) continue;
      const life = Object.entries(t).filter(([k]) => LIFECYCLE.test(k)).map(([k, v]) => `${k}=${v}`);
      if (!map.has(n)) map.set(n, []);
      map.get(n).push({ osm: e.id, diff: t['piste:difficulty'] || '', life });
    }
    break;
  }
  return map;
}

const report = {};
let bad = 0;
for (const rid of resorts) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const H = (x, z) => field.height(x, z);
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, field.farHeight, pistes);
  const tail = (l) => l.name || `#${l.index} ${l.kind}`;
  /** The graph without the pistes in `skip` (ids): per piste the node ids; seen = reached by skiing down (strict = network only, lenient adds skiing off the piste). */
  const analyse = (skip, offPiste) => {
    const nodes = [];
    const add = (n) => { n.id = nodes.length; nodes.push(n); return n.id; };
    const tops = [], srcs = [];
    for (const l of lifts.list) tops.push(add({ kind: 'top', lift: l, x: l.top.x, z: l.top.z, y: l.top.y }));
    for (const l of [first, ...busLifts(rid, lifts)].filter(Boolean)) srcs.push(add({ kind: 'spawn', lift: l, x: l.bottom.x, z: l.bottom.z, y: l.bottom.y }));
    const runs = resort.pistes.map((p) => {
      if (skip.has(p.id)) return null;
      const L = p.line, pts = [];
      let acc = STEP;
      for (let i = 0; i + 1 < L.length; i += 2) {
        if (i) acc += Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]);
        if (acc >= STEP || i + 2 >= L.length) { acc = 0; pts.push(add({ kind: 'piste', piste: p, x: L[i], z: L[i + 1], y: heights.get(p.id)[pts.length] ?? H(L[i], L[i + 1]) })); }
      }
      return pts;
    });
    const out = nodes.map(() => []);
    const edge = (a, b) => { if (a !== b) out[a].push(b); };
    for (const pts of runs) if (pts) for (let k = 0; k + 1 < pts.length; k++) edge(pts[k], pts[k + 1]);
    const G = 100, grid = new Map(), gk = (i, j) => i * 100003 + j;
    for (const n of nodes) { const k = gk(Math.floor(n.x / G), Math.floor(n.z / G)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
    const near = (n, r) => { const res = []; for (let j = Math.floor((n.z - r) / G); j <= Math.floor((n.z + r) / G); j++) for (let i = Math.floor((n.x - r) / G); i <= Math.floor((n.x + r) / G); i++) for (const m of grid.get(gk(i, j)) || []) if (m !== n && Math.hypot(m.x - n.x, m.z - n.z) <= r) res.push(m); return res; };
    for (const n of nodes) {
      if (n.kind === 'top' || n.kind === 'spawn') { for (const m of near(n, TOP_R)) if (m.kind === 'piste' && m.y - n.y <= UP) edge(n.id, m.id); }
      if (n.kind !== 'piste') continue;
      for (const m of near(n, offPiste ? OFF : JOIN)) {
        if (m.kind !== 'piste' || m.piste === n.piste) continue;
        const d = Math.hypot(m.x - n.x, m.z - n.z), dy = m.y - n.y;
        if (d <= JOIN && dy <= UP) edge(n.id, m.id);
        else if (offPiste && dy <= -OFF_DROP && -dy / Math.max(1, d) <= OFF_SLOPE) edge(n.id, m.id);
      }
    }
    const seen = new Uint8Array(nodes.length), q = [...srcs, ...tops];
    for (const s of q) seen[s] = 1;
    while (q.length) { const a = q.pop(); for (const b of out[a]) if (!seen[b]) { seen[b] = 1; q.push(b); } }
    const startOk = resort.pistes.map((p, i) => !!runs[i] && runs[i].slice(0, START_N + 1).some((id) => seen[id]));
    return { nodes, runs, seen, tops, startOk, near };
  };
  const heights = new Map(resort.pistes.map((p) => { const L = p.line, hs = []; let acc = STEP; for (let i = 0; i + 1 < L.length; i += 2) { if (i) acc += Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]); if (acc >= STEP || i + 2 >= L.length) { acc = 0; hs.push(H(L[i], L[i + 1])); } } return [p.id, hs]; }));
  const first = firstLift(rid, lifts, resort.places, null);
  const g0 = analyse(new Set(), false), gOff = analyse(new Set(), true);
  const { nodes, runs, tops } = g0;
  // ---- cross-checks
  const osm = osmByName(rid);
  const offFiles = (OFFICIAL[rid] || []).map((f) => readJson(path.join(SKI, 'data-round/official', `${f}.json`))).filter(Boolean);
  const official = new Map();
  for (const o of offFiles) for (const p of o.pistes || []) { const k = norm(p.name); if (!official.has(k)) official.set(k, new Set()); if (colourOf[p.colour]) official.get(k).add(colourOf[p.colour]); }
  const bare = (p) => norm(p.name.replace(/ \((\d+|Variante)\)$/, '').replace(/ \((Rout|Blo|Schwaarz|Gréng)[^)]*\)$/i, '').replace(COLOUR_WORD, ''));
  const candidates = (p) => [...new Set([norm(p.name), norm(p.ref), bare(p)])].filter(Boolean);
  const nameCount = new Map();
  for (const p of resort.pistes) nameCount.set(bare(p), (nameCount.get(bare(p)) || 0) + 1);
  const info = resort.pistes.map((p, i) => {
    const s = nodes[runs[i][0]];
    let best = null;
    for (const t of tops) { const n = nodes[t], d = Math.hypot(n.x - s.x, n.z - s.z); if (!best || d < best.d) best = { d, gap: Math.round(s.y - n.y), lift: tail(n.lift) }; }
    const ks = candidates(p);
    const off = ks.map((k) => official.get(k)).find(Boolean) || null;
    const life = [...new Set(ks.flatMap((k) => osm.get(k) || []).flatMap((w) => w.life))];
    // a lift top within 400 m that is not much below the start: a short walk / traverse could reach it (unclear, never removed)
    const walkable = tops.some((t) => { const n = nodes[t]; return Math.hypot(n.x - s.x, n.z - s.z) <= 400 && n.y >= s.y - 25; });
    return { s, best, off, life, walkable, inOfficial: offFiles.length ? !!off : null };
  });
  // dead leftovers: unreachable along the network AND by free skiing, not walkable from a lift top, not in the official list (or
  // tagged abandoned); then the links that only hung on them (their start touches a removed piste and stays unreachable)
  const removed = new Set(), why = new Map();
  resort.pistes.forEach((p, i) => {
    const f = info[i];
    if ((CONFIRMED_DEAD[rid] || []).includes(p.id)) { removed.add(p.id); why.set(p.id, 'dead (confirmed by the owner)'); return; }
    if (g0.startOk[i] || p.slalom) return;
    // isolated: not reachable along the network nor by free skiing, and no lift top within ISOLATED m (old lifts closed: Pragelato)
    if (!gOff.startOk[i] && f.best.d >= ISOLATED && !f.walkable) { removed.add(p.id); why.set(p.id, `dead (no lift top within ${ISOLATED} m)`); return; }
    if (p.link) return;
    if (!gOff.startOk[i] && !f.walkable && f.life.some((x) => /abandon|disus|razed/.test(x)) && /abandon/.test(f.life.join(' '))) { removed.add(p.id); why.set(p.id, 'dead (OSM abandoned)'); }
  });
  for (let changed = removed.size > 0; changed;) {
    changed = false;
    const g = analyse(removed, false);
    resort.pistes.forEach((p, i) => {
      if (removed.has(p.id) || !p.link || g.startOk[i]) return;
      const ends = [runs[i][0], runs[i][runs[i].length - 1]].map((id) => nodes[id]);
      const touches = ends.some((n) => g0.near(n, JOIN).some((m) => m.kind === 'piste' && removed.has(m.piste.id)));
      if (touches) { removed.add(p.id); why.set(p.id, 'link of a removed piste'); changed = true; }
    });
  }
  const rows = [], colourDiff = [];
  resort.pistes.forEach((p, i) => {
    const f = info[i], ks = candidates(p);
    if (f.off && !f.off.has(p.diff) && f.off.size === 1) colourDiff.push({ id: p.id, name: p.name, game: p.diff, official: [...f.off][0], dup: nameCount.get(bare(p)) > 1, link: !!p.link, variant: !!p.variant, slalom: !!p.slalom, clear: nameCount.get(bare(p)) === 1 && !p.link && !p.variant && !p.slalom && !p.route });
    if (!g0.startOk[i]) rows.push({ id: p.id, name: p.name, diff: p.diff, top: p.top, bottom: p.bottom, len: p.len, route: !!p.route, link: !!p.link, offPisteOk: gOff.startOk[i], middle: runs[i].some((id) => g0.seen[id]), nearestTop: { lift: f.best.lift, dist: Math.round(f.best.d), gap: f.best.gap }, walkable: f.walkable, official: f.inOfficial, life: f.life, clear: removed.has(p.id), why: why.get(p.id) || '' });
  });
  report[rid] = { pistes: resort.pistes.length, unreachable: rows, colourDiff, remove: [...removed] };
  const nClear = rows.filter((r) => r.clear).length, nColour = colourDiff.filter((c) => c.clear).length;
  bad += nClear + nColour;
  if (!asJson) {
    console.log(`\n${rid}: ${resort.pistes.length} pistes, ${lifts.list.length} lifts: ${rows.length} unreachable along the network, ${nClear} of them clear leftovers; ${nColour} clear colour mismatches`);
    for (const r of rows) console.log(`  ${r.clear ? 'CLEAR ' : '      '}${r.id} "${r.name}" ${r.diff}${r.route ? ' route' : ''}${r.link ? ' link' : ''} ${r.top}->${r.bottom} m, ${r.len} m${r.middle ? ', middle reached' : ''}${r.offPisteOk ? ', off-piste reachable' : ''}; nearest lift top "${r.nearestTop.lift}" ${r.nearestTop.dist} m away, start ${r.nearestTop.gap >= 0 ? r.nearestTop.gap + ' m above it' : -r.nearestTop.gap + ' m below it'}${r.walkable ? ' (walkable)' : ''}; official: ${r.official === null ? 'no list' : r.official ? 'listed' : 'NOT listed'}${r.life.length ? `; OSM ${r.life.join(' ')}` : ''}${r.why ? `; ${r.why}` : ''}`);
    for (const c of colourDiff) console.log(`  ${c.clear ? 'CLEAR ' : '      '}colour: "${c.name}" (${c.id}) game ${c.game}, official ${c.official}${c.dup ? ' (name not unique in game)' : ''}${c.link ? ' (link)' : ''}${c.variant ? ' (variant)' : ''}`);
  }
}
if (asJson) console.log(JSON.stringify(report, null, 1));
process.exit(bad ? 1 : 0);
