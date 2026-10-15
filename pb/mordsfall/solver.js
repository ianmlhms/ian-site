/* Mordsfall — rules engine shared by the game, the generator and the check script.
 * Pure ES module, no DOM: Node can import it as well as the browser.
 *
 * A case is { n, grid:["0011",...], objects:[[r,c,type],...], people:[{name,clues:[...]}], victim, ... }.
 * Cells are numbered r*n+c. A placement is an array pos[person] = cell (or -1).
 *
 * Solver = propagation on candidate-cell domains (one Uint8Array(n*n) per person) + backtracking.
 * Propagation rules are graded by "level"; the lowest level that solves a case without any guessing is its grade:
 *   1  a person with one cell left takes that row and column away from everybody else
 *   2  hidden singles: if only one person can still use a row (column), it is theirs
 *   3  relational clues (north/south/east/west of, same room) tighten both people's domains
 *   4  room-count clues: "alone in the room" and the victim's "alone with the murderer"
 *   5  "what if" probing: try every cell of one person, drop the cells that lead to a contradiction at level 4
 *   6  needs deeper guessing (search)
 */
export const BLOCKING = ["table", "shelf", "tree", "rock", "car", "fountain", "barrel", "plant", "crate", "stove"];
export const STANDABLE = ["chair", "carpet", "bench", "bed", "hay"];
export const isBlocking = (type) => BLOCKING.includes(type);

const UNARY = new Set(["in", "notin", "near", "notnear", "on", "row", "col"]);
export const isUnaryClue = (clue) => UNARY.has(clue.t);

export function buildModel(cs) {
  const n = cs.n, N = n * n, P = cs.people.length;
  const row = new Int8Array(N), col = new Int8Array(N), room = new Int8Array(N);
  const objAt = new Array(N).fill(null);
  const blocked = new Uint8Array(N);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    row[r * n + c] = r; col[r * n + c] = c; room[r * n + c] = parseInt(cs.grid[r][c], 36);
  }
  for (const [r, c, t] of cs.objects) { objAt[r * n + c] = t; if (isBlocking(t)) blocked[r * n + c] = 1; }
  const near = {};
  for (const t of new Set(cs.objects.map((o) => o[2]))) near[t] = new Uint8Array(N);
  for (let i = 0; i < N; i++) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const r = row[i] + dr, c = col[i] + dc;
    if (r < 0 || c < 0 || r >= n || c >= n) continue;
    const t = objAt[r * n + c];
    if (t) near[t][i] = 1;
  }
  const roomCount = Math.max(...room) + 1;
  const roomCells = Array.from({ length: roomCount }, () => []);
  for (let i = 0; i < N; i++) roomCells[room[i]].push(i);
  const m = { n, N, P, row, col, room, objAt, blocked, near, roomCount, roomCells, cs, victim: cs.victim ?? 0 };
  m.allowed = cs.people.map((p) => {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = blocked[i] ? 0 : 1;
    for (const clue of p.clues) if (isUnaryClue(clue)) for (let i = 0; i < N; i++) if (a[i] && !unaryHolds(m, clue, i)) a[i] = 0;
    return a;
  });
  return m;
}

export function unaryHolds(m, clue, i) {
  switch (clue.t) {
    case "in": return m.room[i] === clue.room;
    case "notin": return m.room[i] !== clue.room;
    case "near": return !!(m.near[clue.obj] && m.near[clue.obj][i]);
    case "notnear": return !(m.near[clue.obj] && m.near[clue.obj][i]);
    case "on": return m.objAt[i] === clue.obj;
    case "row": return m.row[i] === clue.k;
    case "col": return m.col[i] === clue.k;
  }
  return true;
}

/* true / false when decided by the people placed so far, null while it still depends on someone not yet placed. */
export function clueHolds(m, clue, p, pos) {
  const x = pos[p];
  if (x < 0) return null;
  if (isUnaryClue(clue)) return unaryHolds(m, clue, x);
  if (clue.t === "alone" || clue.t === "victim") {
    let inRoom = 0, missing = 0;
    for (let q = 0; q < m.P; q++) { if (pos[q] < 0) missing++; else if (m.room[pos[q]] === m.room[x]) inRoom++; }
    const want = clue.t === "alone" ? 1 : 2;
    if (inRoom > want) return false;
    return missing ? null : inRoom === want;
  }
  const y = pos[clue.p];
  if (y < 0) return null;
  switch (clue.t) {
    case "north": return m.row[x] < m.row[y];
    case "south": return m.row[x] > m.row[y];
    case "west": return m.col[x] < m.col[y];
    case "east": return m.col[x] > m.col[y];
    case "same": return m.room[x] === m.room[y];
  }
  return null;
}

/* Full validity of a complete placement. */
export function validate(m, pos) {
  const rows = new Set(), cols = new Set();
  for (let p = 0; p < m.P; p++) {
    const x = pos[p];
    if (x < 0 || m.blocked[x]) return false;
    rows.add(m.row[x]); cols.add(m.col[x]);
  }
  if (rows.size !== m.P || cols.size !== m.P) return false;
  for (let p = 0; p < m.P; p++) for (const clue of m.cs.people[p].clues) if (clueHolds(m, clue, p, pos) !== true) return false;
  return true;
}

export function murdererOf(m, pos) {
  const v = m.victim, rv = m.room[pos[v]];
  for (let p = 0; p < m.P; p++) if (p !== v && m.room[pos[p]] === rv) return p;
  return -1;
}

/* ---------- propagation ---------- */
export function initialDomains(m, givens) {
  return m.allowed.map((a, p) => {
    const d = Uint8Array.from(a);
    if (givens && givens[p] >= 0) { d.fill(0); if (a[givens[p]]) d[givens[p]] = 1; }
    return d;
  });
}

const count = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s; };
const only = (d) => { for (let i = 0; i < d.length; i++) if (d[i]) return i; return -1; };

/* Returns false on contradiction. `trace(entry)` receives every elimination with its reason (used by hints). */
export function propagate(m, dom, level = 5, trace = null) {
  const { N, P, row, col, room } = m;
  let progress = true;
  const rm = (q, pred, reason) => {
    const d = dom[q];
    let removed = null;
    for (let i = 0; i < N; i++) if (d[i] && pred(i)) { d[i] = 0; (removed || (removed = [])).push(i); }
    if (removed) { progress = true; if (trace) trace({ p: q, cells: removed, ...reason }); }
    return removed !== null;
  };
  const forced = (q) => { // the room all of q's candidates share, or -1
    const d = dom[q]; let r = -2;
    for (let i = 0; i < N; i++) if (d[i]) { if (r === -2) r = room[i]; else if (r !== room[i]) return -1; }
    return r === -2 ? -1 : r;
  };
  const reaches = (q, R) => { const d = dom[q]; for (const i of m.roomCells[R]) if (d[i]) return true; return false; };
  while (progress) {
    progress = false;
    const sz = dom.map(count);
    if (sz.some((s) => s === 0)) return false;
    // 1 — taken rows / columns
    for (let p = 0; p < P; p++) if (sz[p] === 1) {
      const x = only(dom[p]);
      for (let q = 0; q < P; q++) if (q !== p) rm(q, (i) => row[i] === row[x] || col[i] === col[x], { rule: "taken", by: p, cell: x });
    }
    if (level < 2) continue;
    // 2 — hidden singles
    for (const line of ["row", "col"]) {
      const arr = line === "row" ? row : col;
      for (let k = 0; k < m.n; k++) {
        let who = -1, cnt = 0;
        for (let q = 0; q < P; q++) { const d = dom[q]; let has = false; for (let i = 0; i < N; i++) if (d[i] && arr[i] === k) { has = true; break; } if (has) { cnt++; who = q; } }
        if (cnt === 0) return false;
        if (cnt === 1) rm(who, (i) => arr[i] !== k, { rule: "hidden", line, k });
      }
    }
    if (level < 3) continue;
    // 3 — relational clues
    for (let p = 0; p < P; p++) m.cs.people[p].clues.forEach((clue, ci) => {
      const q = clue.p;
      if (clue.t === "north" || clue.t === "south" || clue.t === "west" || clue.t === "east") {
        const arr = clue.t === "north" || clue.t === "south" ? row : col;
        let minP = 99, maxP = -1, minQ = 99, maxQ = -1;
        for (let i = 0; i < N; i++) {
          if (dom[p][i]) { if (arr[i] < minP) minP = arr[i]; if (arr[i] > maxP) maxP = arr[i]; }
          if (dom[q][i]) { if (arr[i] < minQ) minQ = arr[i]; if (arr[i] > maxQ) maxQ = arr[i]; }
        }
        const less = clue.t === "north" || clue.t === "west"; // p is before q
        if (less) {
          rm(p, (i) => arr[i] >= maxQ, { rule: "bin", clue: ci, owner: p, other: q });
          rm(q, (i) => arr[i] <= minP, { rule: "bin", clue: ci, owner: p, other: p });
        } else {
          rm(p, (i) => arr[i] <= minQ, { rule: "bin", clue: ci, owner: p, other: q });
          rm(q, (i) => arr[i] >= maxP, { rule: "bin", clue: ci, owner: p, other: p });
        }
      } else if (clue.t === "same") {
        const rp = new Uint8Array(m.roomCount), rq = new Uint8Array(m.roomCount);
        for (let i = 0; i < N; i++) { if (dom[p][i]) rp[room[i]] = 1; if (dom[q][i]) rq[room[i]] = 1; }
        rm(p, (i) => !rq[room[i]], { rule: "bin", clue: ci, owner: p, other: q });
        rm(q, (i) => !rp[room[i]], { rule: "bin", clue: ci, owner: p, other: p });
      }
    });
    if (level < 4) continue;
    // 4 — room counts
    for (let p = 0; p < P; p++) m.cs.people[p].clues.forEach((clue, ci) => {
      if (clue.t !== "alone" && clue.t !== "victim") return;
      const want = clue.t === "alone" ? 0 : 1; // how many OTHER people share the room
      const fr = new Array(P);
      for (let q = 0; q < P; q++) fr[q] = q === p ? -2 : forced(q);
      rm(p, (i) => {
        const R = room[i];
        let can = 0, must = 0;
        for (let q = 0; q < P; q++) { if (q === p) continue; if (fr[q] === R) must++; if (reaches(q, R)) can++; }
        return must > want || can < want;
      }, { rule: clue.t, clue: ci, owner: p });
      if (count(dom[p]) === 1) {
        const R = room[only(dom[p])];
        const canList = [], mustList = [];
        for (let q = 0; q < P; q++) { if (q === p) continue; if (reaches(q, R)) canList.push(q); if (forced(q) === R) mustList.push(q); }
        if (canList.length === want) for (const q of canList) rm(q, (i) => room[i] !== R, { rule: clue.t, clue: ci, owner: p });
        if (mustList.length === want) for (let q = 0; q < P; q++) if (q !== p && !mustList.includes(q)) rm(q, (i) => room[i] === R, { rule: clue.t, clue: ci, owner: p });
      }
    });
  }
  return true;
}

/* ---------- search ---------- */
export function solve(m, { limit = 2, level = 5, givens = null } = {}) {
  const sols = [];
  let nodes = 0, depthMax = 0;
  const rec = (dom, depth) => {
    nodes++;
    if (depth > depthMax) depthMax = depth;
    if (!propagate(m, dom, level)) return;
    let best = -1, bestSize = 1e9;
    for (let p = 0; p < m.P; p++) { const s = count(dom[p]); if (s > 1 && s < bestSize) { bestSize = s; best = p; } }
    if (best < 0) {
      const pos = dom.map(only);
      if (validate(m, pos)) sols.push(pos);
      return;
    }
    for (let i = 0; i < m.N && sols.length < limit; i++) {
      if (!dom[best][i]) continue;
      const next = dom.map((d) => Uint8Array.from(d));
      next[best].fill(0); next[best][i] = 1;
      rec(next, depth + 1);
    }
  };
  rec(initialDomains(m, givens), 0);
  return { count: sols.length, solutions: sols, nodes, depth: depthMax };
}

/* "What if" step: a candidate cell that makes plain propagation (level 4) fail is wrong. Repeats until stable. */
export function probe(m, dom) {
  let changed = true;
  while (changed) {
    changed = false;
    if (!propagate(m, dom, 4)) return false;
    for (let p = 0; p < m.P; p++) {
      if (count(dom[p]) <= 1) continue;
      for (let i = 0; i < m.N; i++) {
        if (!dom[p][i]) continue;
        const trial = dom.map((d) => Uint8Array.from(d));
        trial[p].fill(0); trial[p][i] = 1;
        if (!propagate(m, trial, 4)) { dom[p][i] = 0; changed = true; }
      }
      if (count(dom[p]) === 0) return false;
    }
  }
  return true;
}

/* Difficulty profile: the lowest rule level that solves the case without deep guessing (6 = needs real search),
 * how many propagation sweeps that took, and the size of the search tree with every rule enabled. */
export function grade(m) {
  let level = 6, sweeps = 0;
  for (let k = 1; k <= 5; k++) {
    const dom = initialDomains(m);
    let n = 0;
    const ok = k < 5 ? propagate(m, dom, k, () => { n++; }) : probe(m, dom);
    if (ok && dom.every((d) => count(d) === 1) && validate(m, dom.map(only))) { level = k; sweeps = n; break; }
  }
  const s = solve(m, { limit: 2 });
  const free = m.allowed.reduce((a, d) => a + count(d), 0);
  return { level, sweeps, nodes: s.nodes, depth: s.depth, free, score: level * 1000 + Math.min(s.nodes, 400) * 2 + sweeps };
}

/* ---------- hints ----------
 * placed: pos array (-1 = not placed). Returns
 *  {kind:"conflict", person}              someone is standing on a wrong cell
 *  {kind:"deduce", person, cell, reasons} one person is forced to one cell by plain logic (level <= 4)
 *  {kind:"reveal", person, cell}          nothing simple is left: the answer for the most constrained person
 *  {kind:"done"}                           everything is placed correctly
 * `solution` is the unique solution (pos array). */
export function hint(m, placed, solution) {
  const wrong = [];
  for (let p = 0; p < m.P; p++) if (placed[p] >= 0 && placed[p] !== solution[p]) wrong.push(p);
  if (wrong.length) return { kind: "conflict", person: wrong[0] };
  const open = [];
  for (let p = 0; p < m.P; p++) if (placed[p] < 0) open.push(p);
  if (!open.length) return { kind: "done" };
  for (let level = 1; level <= 4; level++) {
    const dom = initialDomains(m, placed);
    const log = [];
    if (!propagate(m, dom, level, (e) => log.push(e))) continue;
    const found = open.filter((p) => count(dom[p]) === 1);
    if (!found.length) continue;
    // the person whose explanation is shortest reads best
    let pick = null;
    for (const p of found) {
      const reasons = explain(m, log, p, placed);
      if (!pick || reasons.length < pick.reasons.length) pick = { p, reasons };
    }
    return { kind: "deduce", person: pick.p, cell: solution[pick.p], reasons: pick.reasons, level };
  }
  const dom = initialDomains(m, placed);
  propagate(m, dom, 4);
  let best = open[0], bs = 1e9;
  for (const p of open) { const s = count(dom[p]); if (s < bs) { bs = s; best = p; } }
  return { kind: "reveal", person: best, cell: solution[best] };
}

/* Distinct reasons that removed cells from person p, merged into short records. */
function explain(m, log, p, placed) {
  const out = [], seen = new Set();
  const add = (key, rec) => { if (!seen.has(key)) { seen.add(key); out.push(rec); } };
  const takenBy = [];
  for (const e of log) {
    if (e.p !== p) continue;
    if (e.rule === "taken") { if (!takenBy.some((t) => t.by === e.by)) takenBy.push({ by: e.by, cell: e.cell, given: placed[e.by] >= 0 }); }
    else if (e.rule === "hidden") add("h" + e.line + e.k, { rule: "hidden", line: e.line, k: e.k });
    else if (e.rule === "bin") add("b" + e.owner + "." + e.clue, { rule: "bin", owner: e.owner, clue: e.clue, other: e.other });
    else if (e.rule === "alone" || e.rule === "victim") add("c" + e.owner + "." + e.clue, { rule: e.rule, owner: e.owner, clue: e.clue });
  }
  // the person's own unary clues always narrow the board, even before propagation starts
  m.cs.people[p].clues.forEach((clue, ci) => { if (isUnaryClue(clue)) out.unshift({ rule: "own", owner: p, clue: ci }); });
  if (takenBy.length) out.push({ rule: "taken", list: takenBy });
  return out;
}
