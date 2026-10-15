#!/usr/bin/env node
/* Mordsfall case generator (offline). Builds layouts, objects, a hidden solution and clues, shrinks the clue set
 * while the solution stays unique, grades each case with the solver and writes pb/mordsfall/cases.js.
 *
 *   node scripts/mordsfall_gen.mjs                      # write the shipped set (30 cases) to pb/mordsfall/cases.js
 *   node scripts/mordsfall_gen.mjs --seed 7 --out /tmp/cases.js
 *   node scripts/mordsfall_gen.mjs --stats 5x5:200     # grade statistics for 200 random 5x5 cases (tuning aid)
 *
 * Pipeline per case: BSP room layout -> objects -> random solution (victim shares a room with exactly one other
 * person) -> every true clue is a candidate -> add the most informative clues until the solver finds exactly one
 * solution -> try to drop each clue again (kept only if still unique) -> grade (see grade() in solver.js).
 * The generator is deterministic for a given seed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, solve, grade, initialDomains, propagate, STANDABLE, BLOCKING, isBlocking } from "../pb/mordsfall/solver.js";
import { SCENES, NAMES } from "../pb/mordsfall/scenes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SEED = Number(argVal("--seed", 20261015));
const OUT = argVal("--out", path.join(ROOT, "pb/mordsfall/cases.js"));

/* ---------- seeded random ---------- */
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mix = (...xs) => xs.reduce((h, x) => Math.imul(h ^ (x + 0x9e3779b9), 0x85ebca6b) >>> 0, 0x12345);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (rng, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function weighted(rng, items, weightOf) {
  const w = items.map(weightOf), total = w.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}

/* ---------- difficulty tiers ---------- */
export const TIERS = [
  { key: "ve", n: 5, rooms: [4, 5], keep: 0.8, fill: 2, accept: (g) => g.level <= 2, weights: { in: 5, on: 4, near: 3, row: 3, col: 3, notin: 1, notnear: 1, north: 1, south: 1, east: 1, west: 1, same: 1, alone: 2 } },
  { key: "ea", n: 6, rooms: [5, 6], keep: 0.6, fill: 2, accept: (g) => g.level <= 3, weights: { in: 4, on: 3, near: 3, row: 2, col: 2, notin: 2, notnear: 2, north: 2, south: 2, east: 2, west: 2, same: 2, alone: 2 } },
  { key: "me", n: 7, rooms: [5, 7], keep: 0.35, fill: 1, accept: (g) => g.level >= 3 && g.level <= 4, weights: { in: 3, on: 2, near: 3, row: 1, col: 1, notin: 3, notnear: 3, north: 3, south: 3, east: 3, west: 3, same: 3, alone: 2 } },
  { key: "ha", n: 8, rooms: [6, 7], keep: 0.12, fill: 1, accept: (g) => g.level >= 4 && g.level <= 5, weights: { in: 2, on: 2, near: 3, row: 1, col: 1, notin: 4, notnear: 4, north: 4, south: 4, east: 4, west: 4, same: 3, alone: 2 } },
  { key: "ex", n: 9, rooms: [7, 8], keep: 0, fill: 0, accept: (g) => g.level >= 5, weights: { in: 2, on: 2, near: 3, row: 1, col: 1, notin: 4, notnear: 4, north: 4, south: 4, east: 4, west: 4, same: 3, alone: 2 } },
];

/* ---------- layout: BSP split, then merge neighbours into L shapes ---------- */
function genGrid(n, k, rng) {
  let rects = [{ r0: 0, c0: 0, r1: n, c1: n }];
  const extra = k >= 6 ? 2 : 1;
  while (rects.length < k + extra) {
    const splittable = rects.filter((q) => q.r1 - q.r0 >= 2 || q.c1 - q.c0 >= 2);
    if (!splittable.length) return null;
    const area = (q) => (q.r1 - q.r0) * (q.c1 - q.c0);
    const q = weighted(rng, splittable, (x) => area(x) ** 2);
    const h = q.r1 - q.r0, w = q.c1 - q.c0;
    const horizontal = h > w ? rng() < 0.75 : h < w ? rng() < 0.25 : rng() < 0.5;
    const axisOk = (horizontal ? h : w) >= 2;
    const useH = axisOk ? horizontal : !horizontal;
    const len = useH ? h : w, cut = 1 + Math.floor(rng() * (len - 1));
    rects = rects.filter((x) => x !== q);
    if (useH) rects.push({ ...q, r1: q.r0 + cut }, { ...q, r0: q.r0 + cut });
    else rects.push({ ...q, c1: q.c0 + cut }, { ...q, c0: q.c0 + cut });
  }
  let regions = rects.map((q) => { const s = new Set(); for (let r = q.r0; r < q.r1; r++) for (let c = q.c0; c < q.c1; c++) s.add(r * n + c); return s; });
  const touching = (a, b) => { for (const i of a) { const r = Math.floor(i / n), c = i % n; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < n && cc < n && b.has(rr * n + cc)) return true; } } return false; };
  while (regions.length > k) {
    const pairs = [];
    for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) if (touching(regions[a], regions[b])) pairs.push([a, b]);
    if (!pairs.length) return null;
    const [a, b] = weighted(rng, pairs, ([x, y]) => 1 / (regions[x].size + regions[y].size) ** 2);
    const merged = new Set([...regions[a], ...regions[b]]);
    regions = regions.filter((_, i) => i !== a && i !== b).concat([merged]);
  }
  const maxSize = Math.floor(n * n * 0.42) + 1;
  if (regions.some((s) => s.size < 3 || s.size > maxSize)) return null;
  regions.sort((x, y) => Math.min(...x) - Math.min(...y));
  const cell = new Array(n * n);
  regions.forEach((s, id) => { for (const i of s) cell[i] = id; });
  const rows = [];
  for (let r = 0; r < n; r++) rows.push(cell.slice(r * n, r * n + n).map((x) => x.toString(36)).join(""));
  return rows;
}

/* ---------- objects ---------- */
function genObjects(n, scene, rng) {
  const N = n * n;
  const total = Math.round(N * (0.22 + rng() * 0.1));
  const palette = shuffle(rng, scene.objects);
  const blocking = palette.filter(isBlocking).slice(0, n >= 8 ? 4 : 3);
  const standable = palette.filter((t) => !isBlocking(t)).slice(0, 3);
  if (blocking.length < 2 || standable.length < 1) return null;
  const kinds = [...blocking, ...standable];
  const blockedRow = new Array(n).fill(0), blockedCol = new Array(n).fill(0);
  const used = new Set(), objects = [];
  let guard = 0;
  while (objects.length < total && guard++ < 400) {
    const i = Math.floor(rng() * N), r = Math.floor(i / n), c = i % n;
    if (used.has(i)) continue;
    // the first objects cycle through the kinds so that every kind shows up
    const type = objects.length < kinds.length ? kinds[objects.length] : weighted(rng, kinds, (t) => (isBlocking(t) ? 1.3 : 1));
    if (isBlocking(type)) {
      if (blockedRow[r] >= n - 3 || blockedCol[c] >= n - 3) continue;
      blockedRow[r]++; blockedCol[c]++;
    }
    used.add(i); objects.push([r, c, type]);
  }
  if (objects.length < total - 2) return null;
  objects.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return objects;
}

/* ---------- solution ---------- */
function genSolution(n, grid, blocked, rng) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const cols = shuffle(rng, [...Array(n).keys()]);
    if (cols.some((c, r) => blocked.has(r * n + c))) continue;
    const roomOf = (r, c) => parseInt(grid[r][c], 36);
    const counts = {};
    cols.forEach((c, r) => { const k = roomOf(r, c); counts[k] = (counts[k] || 0) + 1; });
    const twos = Object.keys(counts).filter((k) => counts[k] === 2);
    if (!twos.length) continue;
    const vroom = Number(pick(rng, twos));
    const inRoom = cols.map((c, r) => [r, c]).filter(([r, c]) => roomOf(r, c) === vroom);
    const [vr, vc] = pick(rng, inRoom);
    return { cells: cols.map((c, r) => [r, c]), victimCell: [vr, vc] };
  }
  return null;
}

/* ---------- clue pool ---------- */
function cluePool(cs, m, sol, p) {
  const out = [];
  const x = sol[p], v = cs.victim;
  const rooms = m.roomCount;
  out.push({ t: "in", room: m.room[x] });
  for (let r = 0; r < rooms; r++) if (r !== m.room[x]) out.push({ t: "notin", room: r });
  const types = new Set(cs.objects.map((o) => o[2]));
  for (const t of types) {
    if (m.near[t][x]) out.push({ t: "near", obj: t }); else out.push({ t: "notnear", obj: t });
  }
  if (m.objAt[x] && !isBlocking(m.objAt[x])) out.push({ t: "on", obj: m.objAt[x] });
  out.push({ t: "row", k: m.row[x] }, { t: "col", k: m.col[x] });
  for (let q = 0; q < m.P; q++) {
    if (q === p) continue;
    const y = sol[q];
    if (m.row[x] < m.row[y]) out.push({ t: "north", p: q });
    if (m.row[x] > m.row[y]) out.push({ t: "south", p: q });
    if (m.col[x] < m.col[y]) out.push({ t: "west", p: q });
    if (m.col[x] > m.col[y]) out.push({ t: "east", p: q });
    if (m.room[x] === m.room[y]) out.push({ t: "same", p: q });
  }
  if (p !== v) {
    let alone = true;
    for (let q = 0; q < m.P; q++) if (q !== p && m.room[sol[q]] === m.room[x]) alone = false;
    if (alone) out.push({ t: "alone" });
  }
  return out;
}

const clueKey = (c) => JSON.stringify(c);
const clueCount = (cs) => cs.people.reduce((a, p) => a + p.clues.length, 0);

const SAMPLE = Number(argVal("--sample", 30));
export const FAIL = {};
const fail = (why) => { FAIL[why] = (FAIL[why] || 0) + 1; return null; };

function makeCase(tier, scene, caseText, rng) {
  const n = tier.n;
  const k = tier.rooms[0] + Math.floor(rng() * (tier.rooms[1] - tier.rooms[0] + 1));
  const grid = genGrid(n, k, rng);
  if (!grid) return fail('layout');
  const objects = genObjects(n, scene, rng);
  if (!objects) return fail('objects');
  const blocked = new Set(objects.filter((o) => isBlocking(o[2])).map((o) => o[0] * n + o[1]));
  const sol = genSolution(n, grid, blocked, rng);
  if (!sol) return fail('solution');
  // people: victim first
  const names = [];
  const initials = new Set();
  for (const nm of shuffle(rng, NAMES)) { if (!initials.has(nm.i)) { initials.add(nm.i); names.push(nm); } if (names.length === n) break; }
  const order = shuffle(rng, sol.cells.map((_, i) => i));
  const vi = order.findIndex((ri) => sol.cells[ri][0] === sol.victimCell[0]);
  order.unshift(order.splice(vi, 1)[0]); // victim to index 0
  const roomNames = shuffle(rng, scene.rooms).slice(0, k);
  const cs = {
    id: "", scene: scene.id, diff: 0, n, title: caseText.title, story: caseText.story,
    rooms: roomNames, grid, objects, victim: 0,
    people: order.map((ri, idx) => ({ name: names[idx].n, g: names[idx].g, clues: idx === 0 ? [{ t: "victim" }] : [] })),
    sol: order.map((ri) => sol.cells[ri]),
  };
  const solCells = cs.sol.map(([r, c]) => r * n + c);
  let m = buildModel(cs);
  const pools = cs.people.map((_, p) => cluePool(cs, m, solCells, p));
  const weight = (c) => tier.weights[c.t] ?? 1;
  const have = (p, c) => cs.people[p].clues.some((x) => clueKey(x) === clueKey(c));

  // phase 1: add clues until unique
  const measure = () => { const dom = initialDomains(buildModel(cs)); if (!propagate(buildModel(cs), dom, 5)) return 1e9; return dom.reduce((a, d) => a + d.reduce((s, x) => s + x, 0), 0); };
  for (let guard = 0; guard < 60; guard++) {
    m = buildModel(cs);
    const res = solve(m, { limit: 2 });
    if (res.count === 1) break;
    const open = cs.people.map((p, i) => i).filter((p) => cs.people[p].clues.length < 3);
    if (!open.length) return fail('too-many-clues');
    // sample candidates, keep the one that narrows the board most
    let best = null;
    for (let s = 0; s < SAMPLE; s++) {
      const p = weighted(rng, open, (q) => 4 - cs.people[q].clues.length);
      const cand = weighted(rng, pools[p].filter((c) => !have(p, c)), weight);
      if (!cand) continue;
      cs.people[p].clues.push(cand);
      const score = measure() + rng() * 3;
      cs.people[p].clues.pop();
      if (!best || score < best.score) best = { p, cand, score };
    }
    if (!best) return fail('no-candidate');
    cs.people[best.p].clues.push(best.cand);
  }
  if (solve(buildModel(cs), { limit: 2 }).count !== 1) return fail('not-unique');

  // phase 2: drop redundant clues (some are kept on purpose on easy tiers)
  const all = [];
  cs.people.forEach((p, pi) => p.clues.forEach((c) => { if (c.t !== "victim") all.push([pi, clueKey(c)]); }));
  for (const [pi, key] of shuffle(rng, all)) {
    if (rng() < tier.keep) continue;
    const arr = cs.people[pi].clues, idx = arr.findIndex((c) => clueKey(c) === key);
    const removed = arr.splice(idx, 1)[0];
    if (solve(buildModel(cs), { limit: 2 }).count !== 1) arr.splice(idx, 0, removed);
  }
  // easier tiers: top every person up to `fill` clues with extra true (hence harmless) clues
  for (let p = 0; p < cs.people.length; p++) {
    let guard = 0;
    while (cs.people[p].clues.length < Math.min(tier.fill, 3) && guard++ < 20) {
      const cand = weighted(rng, pools[p].filter((c) => !have(p, c)), weight);
      if (cand) cs.people[p].clues.push(cand);
    }
  }
  m = buildModel(cs);
  const g = grade(m);
  return { cs, g };
}

/* ---------- driver ---------- */
function describe(g, cs) { return `level ${g.level} nodes ${g.nodes} sweeps ${g.sweeps} clues ${clueCount(cs)}`; }

if (argVal("--stats", null)) {
  const [size, countStr] = argVal("--stats").split(":");
  const tier = TIERS.find((t) => t.n === Number(size.split("x")[0]));
  const hist = {};
  let made = 0;
  for (let i = 0; i < Number(countStr); i++) {
    const rng = mulberry32(mix(SEED, tier.n, i));
    const scene = SCENES[i % SCENES.length];
    const out = makeCase(tier, scene, scene.cases[0], rng);
    if (!out) continue;
    made++;
    const key = `L${out.g.level} nodes${out.g.nodes > 3 ? ">3" : out.g.nodes} clues${clueCount(out.cs)}`;
    hist[key] = (hist[key] || 0) + 1;
  }
  console.log(`${made}/${countStr} generated`, hist, FAIL);
  process.exit(0);
}

const PER_TIER = 6;
const DEADLINE = Date.now() + Number(argVal("--budget", 20 * 60)) * 1000;
const results = [];
const only = argVal("--tier", null);
TIERS.forEach((tier, ti) => {
  if (only && tier.key !== only) return;
  const got = [];
  for (let j = 0; j < PER_TIER; j++) {
    const sceneIdx = (ti * PER_TIER + j) % SCENES.length;
    const scene = SCENES[sceneIdx];
    const caseText = scene.cases[(ti * PER_TIER + j) >= SCENES.length ? 1 : 0];
    let found = null;
    for (let attempt = 0; attempt < 4000 && !found; attempt++) {
      if (Date.now() > DEADLINE) throw new Error("budget exhausted");
      const rng = mulberry32(mix(SEED, ti, j, attempt));
      const out = makeCase(tier, scene, caseText, rng);
      if (out && tier.accept(out.g)) found = out;
    }
    if (!found) throw new Error(`no case for tier ${tier.key} slot ${j}`);
    console.log(`${tier.key}${j}: ${scene.id} ${describe(found.g, found.cs)}`);
    got.push(found);
  }
  got.sort((a, b) => a.g.score - b.g.score || clueCount(b.cs) - clueCount(a.cs));
  got.forEach((f, j) => { f.cs.id = `${tier.key}${j + 1}`; f.cs.diff = ti; f.cs.grade = { level: f.g.level, nodes: f.g.nodes, sweeps: f.g.sweeps }; results.push(f.cs); });
});

if (!only) {
  const body = results.map((c) => "  " + JSON.stringify(c)).join(",\n");
  fs.writeFileSync(OUT, `/* Generated by scripts/mordsfall_gen.mjs (seed ${SEED}) — do not edit by hand. Every case has exactly one solution (scripts/mordsfall_check.mjs). */\nexport default [\n${body}\n];\n`);
  console.log(`wrote ${results.length} cases to ${path.relative(ROOT, OUT)}`);
}
