#!/usr/bin/env node
/* Search exact fixed-step rules from the browser's CORE block, then replay the
 * winning input from a fresh run without quantization. A found replay is a
 * constructive proof; exhausting this bounded search is NOT an impossibility proof.
 * node scripts/gd_level_check.mjs [level numbers...] [--write]
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const page = fs.readFileSync(new URL('../geometrydash.html', import.meta.url), 'utf8');
const core = page.match(/\/\* ==== CORE:BEGIN[\s\S]*?\/\* ==== CORE:END ==== \*\//)?.[0];
if (!core) throw new Error('Geometry Dash CORE markers missing');
const rules = vm.runInNewContext(core + '\n({LEVELS,newRun,step,findOrb,STEP})');
const MAX_STATES = 12000;
const MAX_FRAMES = 30000;
const REPLAY_FILE = new URL('./gd_replays.json', import.meta.url);
const cached = fs.existsSync(REPLAY_FILE) ? JSON.parse(fs.readFileSync(REPLAY_FILE, 'utf8')) : {};

function key(s) {
  // Dedup only chooses representatives; proof always replays the exact states.
  const ship = s.mode === 'ship';
  return [Math.round(s.u / (ship ? 5 : 1)), Math.round(s.vu / (ship ? 25 : 8)),
    s.g, s.mode, +s.onGround, +s.held, Math.ceil(s.buffer / rules.STEP),
    s.used.filter(i => rules.LEVELS[currentLevel].objects[i].x > s.x - 96).join(',')].join('|');
}
let currentLevel = 0;
function replay(level, changes, frames) {
  let s = rules.newRun(), held = false, at = 0;
  for (let f = 0; f < frames; f++) {
    if (changes[at]?.[0] === f) held = changes[at++][1];
    s = rules.step(level, s, held);
    if (s.dead) return false;
  }
  return s.won;
}
function search(level) {
  let states = [{ s: rules.newRun(), path: null }];
  for (let f = 0; f < MAX_FRAMES; f++) {
    const previousX = states[0].s.x;
    const next = new Map();
    for (const node of states) {
      const s = node.s;
      const actions = s.mode === 'ship' || s.onGround || rules.findOrb(level, s) >= 0 ? [false, true] : [false];
      for (const held of actions) {
        const n = rules.step(level, s, held);
        if (n.dead) continue;
        const path = held !== s.held ? { f, held, prev: node.path } : node.path;
        if (n.won) {
          const changes = [];
          for (let p = path; p; p = p.prev) changes.push([p.f, p.held]);
          changes.reverse();
          return { frames: f + 1, changes };
        }
        const id = key(n);
        if (!next.has(id)) next.set(id, { s: n, path });
      }
    }
    states = [...next.values()];
    if (!states.length) throw new Error(`Search exhausted at frame ${f}, x=${previousX.toFixed(0)}`);
    if (states.length > MAX_STATES) {
      // Keep evenly spaced representatives, deterministically, across the beam.
      const stride = states.length / MAX_STATES;
      states = Array.from({ length: MAX_STATES }, (_, i) => states[Math.floor(i * stride)]);
    }
  }
  throw new Error('Frame budget exhausted');
}
const requested = process.argv.slice(2).filter(x => /^\d+$/.test(x)).map(Number);
let failures = 0;
for (let i = 0; i < rules.LEVELS.length; i++) {
  if (requested.length && !requested.includes(i + 1)) continue;
  currentLevel = i;
  const level = rules.LEVELS[i], start = Date.now();
  try {
    const old = cached[level.id];
    const result = old && replay(level, old.changes, old.frames) ? old : search(level);
    if (!replay(level, result.changes, result.frames)) throw new Error('Exact replay failed');
    cached[level.id] = result;
    console.log(`PASS ${i + 1} ${level.name}: ${result.frames} frames, ${result.changes.filter(c => c[1]).length} presses, ${((Date.now() - start) / 1000).toFixed(1)}s check`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${i + 1} ${level.name}: ${error.message}`);
  }
}
if (process.argv.includes('--write')) fs.writeFileSync(fileURLToPath(REPLAY_FILE), JSON.stringify(cached) + '\n');
process.exitCode = failures ? 1 : 0;
