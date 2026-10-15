#!/usr/bin/env node
/* Mordsfall data check. Re-solves every shipped case and asserts:
 *   - structure: grid, rooms (connected, named in lb/de/en), objects, people (n of them, distinct names and initials),
 *     at most 3 clues each, the victim has the "alone with the murderer" clue and nobody else has it
 *   - exactly ONE solution, found two ways: the propagation solver (pb/mordsfall/solver.js) and an independent
 *     plain backtracking counter written below (shares no code with the solver)
 *   - the stored solution equals that solution, and the victim's room holds exactly one other person (the murderer)
 *   - realism: every object sits in a room whose kind allows it (pb/mordsfall/rooms.js), no room exceeds its per-object maximum,
 *     case-wide caps hold (one water tap …), rooms are compact (a 2x2 block, one tiny corridor at most), every person has a clue
 *   - the line-up is 6 cases per tier with sizes 5..9, and every clue renders in lb/de/en without gaps
 *
 *   node scripts/mordsfall_check.mjs
 * Exit code 0 = all fine. */
import cases from "../pb/mordsfall/cases.js";
import { SCENES } from "../pb/mordsfall/scenes.js";
import { buildModel, solve, validate, murdererOf, BLOCKING, STANDABLE } from "../pb/mordsfall/solver.js";
import { KINDS, CASE_CAPS } from "../pb/mordsfall/rooms.js";
import { clueText, storyText, caseTitle, roomName } from "../pb/mordsfall/text.js";

const LANGS = ["lb", "de", "en"];
const TIER_KEYS = ["ve", "ea", "me", "ha", "ex"];
const OBJ_TYPES = new Set([...BLOCKING, ...STANDABLE]);
let problems = 0;
const bad = (id, msg) => { problems++; console.log(`FAIL ${id}: ${msg}`); };

/* ---- independent counter: no propagation, no shared helpers ---- */
function bruteCount(cs, limit = 2, nodeCap = 4e7) {
  const n = cs.n, P = cs.people.length;
  const roomAt = (r, c) => parseInt(cs.grid[r][c], 36);
  const objAt = {}; for (const [r, c, t] of cs.objects) objAt[r + "," + c] = t;
  const blockedTypes = new Set(["table", "shelf", "tree", "rock", "car", "fountain", "barrel", "plant", "crate", "stove", "heater", "bucket", "fridge",
    "counter", "parasol", "tent", "campfire", "tap", "desk", "copier", "board", "stall", "bin", "carousel", "press", "sink", "grill", "slide"]);
  const isBlockedCell = (r, c) => blockedTypes.has(objAt[r + "," + c]);
  const nearHas = (r, c, t) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if ((dr || dc) && objAt[(r + dr) + "," + (c + dc)] === t) return true; } return false; };
  const unary = (cl, r, c) => {
    switch (cl.t) {
      case "in": return roomAt(r, c) === cl.room;
      case "notin": return roomAt(r, c) !== cl.room;
      case "near": return nearHas(r, c, cl.obj);
      case "notnear": return !nearHas(r, c, cl.obj);
      case "on": return objAt[r + "," + c] === cl.obj;
      case "row": return r === cl.k;
      case "col": return c === cl.k;
      default: return true;
    }
  };
  const cand = cs.people.map((p) => {
    const out = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!isBlockedCell(r, c) && p.clues.every((cl) => unary(cl, r, c))) out.push([r, c]);
    return out;
  });
  const order = [...Array(P).keys()].sort((a, b) => cand[a].length - cand[b].length);
  const at = new Array(P).fill(null);
  const rowUsed = new Array(n).fill(false), colUsed = new Array(n).fill(false);
  let found = 0, nodes = 0;
  const rel = (p, q) => { // clues of p about q and vice versa, once both are placed
    for (const [a, b] of [[p, q], [q, p]]) for (const cl of cs.people[a].clues) {
      if (cl.p !== b) continue;
      const [ra, ca] = at[a], [rb, cb] = at[b];
      if (cl.t === "north" && !(ra < rb)) return false;
      if (cl.t === "south" && !(ra > rb)) return false;
      if (cl.t === "west" && !(ca < cb)) return false;
      if (cl.t === "east" && !(ca > cb)) return false;
      if (cl.t === "same" && roomAt(ra, ca) !== roomAt(rb, cb)) return false;
    }
    return true;
  };
  const finalOk = () => {
    for (let p = 0; p < P; p++) for (const cl of cs.people[p].clues) {
      if (cl.t !== "alone" && cl.t !== "victim") continue;
      const room = roomAt(...at[p]);
      const inRoom = at.filter((x) => roomAt(...x) === room).length;
      if (cl.t === "alone" && inRoom !== 1) return false;
      if (cl.t === "victim" && inRoom !== 2) return false;
    }
    return true;
  };
  const rec = (k) => {
    if (found >= limit) return;
    if (++nodes > nodeCap) throw new Error("node cap");
    if (k === P) { if (finalOk()) found++; return; }
    const p = order[k];
    for (const [r, c] of cand[p]) {
      if (rowUsed[r] || colUsed[c]) continue;
      at[p] = [r, c];
      let ok = true;
      for (let j = 0; j < k && ok; j++) ok = rel(p, order[j]);
      if (ok) { rowUsed[r] = colUsed[c] = true; rec(k + 1); rowUsed[r] = colUsed[c] = false; }
      at[p] = null;
    }
  };
  rec(0);
  return found;
}

const connected = (cells, n) => {
  const set = new Set(cells), seen = new Set([cells[0]]), stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop(), r = Math.floor(i / n), c = i % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc, j = rr * n + cc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && set.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
    }
  }
  return seen.size === set.size;
};

const perTier = {};
const ids = new Set();
const started = Date.now();
for (const cs of cases) {
  const id = cs.id;
  if (ids.has(id)) bad(id, "duplicate id"); ids.add(id);
  perTier[cs.diff] = (perTier[cs.diff] || 0) + 1;
  const n = cs.n;
  if (TIER_KEYS[cs.diff] === undefined || !id.startsWith(TIER_KEYS[cs.diff])) bad(id, "id does not match tier");
  if (n !== 5 + cs.diff) bad(id, `size ${n} does not fit tier ${cs.diff}`);
  if (cs.grid.length !== n || cs.grid.some((row) => row.length !== n)) { bad(id, "grid is not n x n"); continue; }
  if (!SCENES.some((s) => s.id === cs.scene)) bad(id, "unknown scene");
  for (const l of LANGS) {
    if (!cs.title?.[l]) bad(id, `title.${l} missing`);
    if (!cs.story?.[l]) bad(id, `story.${l} missing`);
  }
  // rooms
  const roomIds = [...new Set(cs.grid.join("").split(""))].map((ch) => parseInt(ch, 36)).sort((a, b) => a - b);
  if (roomIds.length !== cs.rooms.length || roomIds.some((x, i) => x !== i)) bad(id, "room ids are not 0..k-1 / names mismatch");
  roomIds.forEach((rid) => {
    const cells = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (parseInt(cs.grid[r][c], 36) === rid) cells.push(r * n + c);
    if (cells.length < 3) bad(id, `room ${rid} has fewer than 3 cells`);
    if (!connected(cells, n)) bad(id, `room ${rid} is not connected`);
    for (const l of LANGS) if (!cs.rooms[rid]?.[l]) bad(id, `room ${rid} name.${l} missing`);
  });
  // objects: each must belong in its room
  {
    const scene = SCENES.find((x) => x.id === cs.scene);
    const roomKind = cs.rooms.map((rm) => scene.rooms.find((x) => x.lb === rm.lb)?.kind);
    const perRoom = {}, perCase = {};
    for (const [r, c, t] of cs.objects) {
      const rid = parseInt(cs.grid[r][c], 36), kind = KINDS[roomKind[rid]];
      if (!kind) { bad(id, `room ${rid} has no known kind`); continue; }
      const max = [...kind.block, ...kind.stand].find(([tt]) => tt === t)?.[1];
      if (max === undefined) bad(id, `${t} does not belong in «${cs.rooms[rid].lb}» (${roomKind[rid]})`);
      perRoom[rid + t] = (perRoom[rid + t] || 0) + 1;
      if (max !== undefined && perRoom[rid + t] > max) bad(id, `too many ${t} in «${cs.rooms[rid].lb}»`);
      perCase[t] = (perCase[t] || 0) + 1;
    }
    for (const [t, cap] of Object.entries(CASE_CAPS)) if ((perCase[t] || 0) > cap) bad(id, `${perCase[t]} x ${t} (case cap ${cap})`);
    const rooms2x2 = roomIds.filter((rid) => {
      const has = (r, c) => r >= 0 && c >= 0 && r < n && c < n && parseInt(cs.grid[r][c], 36) === rid;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (has(r, c) && has(r + 1, c) && has(r, c + 1) && has(r + 1, c + 1)) return true;
      return false;
    });
    const thin = roomIds.filter((rid) => !rooms2x2.includes(rid));
    if (thin.length > 1) bad(id, `${thin.length} thin rooms`);
    for (const rid of thin) if (cs.grid.join("").split("").filter((ch) => parseInt(ch, 36) === rid).length > 3) bad(id, `room ${rid} is a long thin strip`);
  }
  const seenObj = new Set();
  for (const [r, c, t] of cs.objects) {
    if (!OBJ_TYPES.has(t)) bad(id, `unknown object ${t}`);
    if (r < 0 || c < 0 || r >= n || c >= n) bad(id, "object outside the grid");
    if (seenObj.has(r + "," + c)) bad(id, "two objects in one cell"); seenObj.add(r + "," + c);
  }
  // people
  if (cs.people.length !== n) bad(id, `${cs.people.length} people for a ${n}x${n} grid`);
  if (cs.victim !== 0) bad(id, "victim must be person 0");
  const initials = new Set(cs.people.map((p) => p.name[0]));
  if (initials.size !== cs.people.length) bad(id, "initials are not distinct");
  cs.people.forEach((p, i) => {
    if (p.clues.length > 3) bad(id, `${p.name} has more than 3 clues`);
    if (p.clues.length < 1) bad(id, `${p.name} has no clue`);
    const hasVictim = p.clues.some((c) => c.t === "victim");
    if (hasVictim !== (i === cs.victim)) bad(id, `${p.name}: victim clue misplaced`);
    p.clues.forEach((cl) => {
      for (const l of LANGS) { const t = clueText(cs, cl, l); if (!t || /undefined|NaN|\{|\}/.test(t)) bad(id, `clue text ${l} broken for ${JSON.stringify(cl)}: ${t}`); }
      if (cl.p !== undefined && (cl.p === i || cl.p < 0 || cl.p >= cs.people.length)) bad(id, "clue points at a bad person");
    });
  });
  for (const l of LANGS) {
    const story = storyText(cs, l);
    if (/undefined|\{|\}/.test(story)) bad(id, `story ${l} has an unresolved token: ${story}`);
    if (!caseTitle(cs, l) || !roomName(cs, 0, l)) bad(id, `title/room ${l}`);
  }
  // solutions
  const m = buildModel(cs);
  const res = solve(m, { limit: 3 });
  if (res.count !== 1) { bad(id, `solver found ${res.count} solutions (need exactly 1)`); continue; }
  const solved = res.solutions[0];
  const stored = cs.sol.map(([r, c]) => r * n + c);
  if (JSON.stringify(solved) !== JSON.stringify(stored)) bad(id, "stored solution differs from the solved one");
  if (!validate(m, stored)) bad(id, "stored solution fails validation");
  const roomOfVictim = m.room[stored[cs.victim]];
  const inRoom = stored.map((x, i) => (m.room[x] === roomOfVictim ? i : -1)).filter((i) => i >= 0);
  if (inRoom.length !== 2) bad(id, `victim room holds ${inRoom.length} people, expected 2`);
  const murderer = inRoom.find((i) => i !== cs.victim);
  if (murdererOf(m, stored) !== murderer) bad(id, "murderer mismatch");
  let brute;
  try { brute = bruteCount(cs); } catch (e) { bad(id, "independent counter gave up: " + e.message); continue; }
  if (brute !== 1) bad(id, `independent counter found ${brute} solutions`);
  console.log(`ok   ${id.padEnd(4)} ${n}x${n} ${cs.scene.padEnd(8)} level ${cs.grade?.level} murderer ${cs.people[murderer].name}`);
}
TIER_KEYS.forEach((k, i) => { if (perTier[i] !== 6) bad(k, `tier has ${perTier[i] || 0} cases, expected 6`); });
if (cases.length !== 30) bad("all", `${cases.length} cases, expected 30`);
console.log(problems ? `FAILED: ${problems} problem(s)` : `PASS: ${cases.length} cases, each with exactly one solution (solver + independent counter), consistent murderer · ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(problems ? 1 : 0);
