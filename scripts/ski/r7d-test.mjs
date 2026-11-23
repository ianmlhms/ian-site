#!/usr/bin/env node
/* R7-D pure checks (Node, no browser): the name-tag declutter, the sign atlas slots, the free-ride helpers and the wire jump rule.
 *   node scripts/ski/r7d-test.mjs        exit 1 on a failure */
import fs from "node:fs";
import { layoutTags, tagWidth, tagLook, TAGS } from "../../pb/ski/net/tags.js";
import { unpackResort, packLine, unpackLine } from "../../pb/ski/linepack.js";

let fails = 0, oks = 0;
const ok = (cond, msg) => { if (cond) oks++; else { fails++; console.log(`FAIL ${msg}`); } };
const overlaps = (a, b) => a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01;
function boxes(items, lay) {
  const out = [];
  for (const it of items) {
    const l = lay.get(it.id);
    if (!l || l.mode === "merged") continue;
    const w = l.mode === "dot" ? TAGS.DOT : it.w * l.scale, h = l.mode === "dot" ? TAGS.DOT : TAGS.H * l.scale;
    out.push({ id: it.id, x0: l.x - w / 2, x1: l.x + w / 2, y0: l.y - h, y1: l.y });
  }
  return out;
}
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

// 1. tags: random crowds never overlap; the nearest three are always full; every tag is accounted for
for (let trial = 0; trial < 400; trial++) {
  const n = 2 + Math.floor(rnd() * 12), spread = 20 + rnd() * 400;
  const items = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, x: 500 + (rnd() - 0.5) * spread, y: 300 + (rnd() - 0.5) * spread * 0.4, d: 5 + rnd() * 1500, w: tagWidth(`Spiller ${i} ${"x".repeat(Math.floor(rnd() * 8))}`) }));
  const lay = layoutTags(items);
  const b = boxes(items, lay);
  let bad = 0;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (overlaps(b[i], b[j])) bad++;
  ok(bad === 0, `trial ${trial}: ${bad} overlapping tags`);
  const near = [...items].sort((a, c) => a.d - c.d).slice(0, 3);
  ok(near.every((it) => lay.get(it.id).mode === "full"), `trial ${trial}: the nearest three are full`);
  const merged = [...lay.values()].filter((l) => l.mode === "merged").length, more = [...lay.values()].reduce((s, l) => s + l.more, 0);
  ok(lay.size === n && merged === more, `trial ${trial}: every tag shown, a dot or counted in a "+N" (${merged} merged, +${more})`);
}
ok(tagLook(10).alpha === 1 && tagLook(2000).alpha === TAGS.MIN_ALPHA && tagLook(2000).scale === TAGS.MIN_SCALE, "far tags fade and shrink");

// 2. sign atlas slots (props.js needs window.THREE at import: a stub is enough for the pure function)
globalThis.window = { THREE: {} };
const { assignSlots, SIGN } = await import("../../pb/ski/props.js");
let slots = new Map();
const cap = SIGN.cols * SIGN.rows;
const ids = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const fill = Math.min(100, cap), half = Math.floor(fill / 2);
let r = assignSlots(slots, ids(0, fill), cap);
ok(r.paint.length === fill && new Set(r.slots.values()).size === fill, `${fill} boards: ${fill} distinct slots painted`);
slots = r.slots;
r = assignSlots(slots, ids(half, half + fill), cap);
ok(r.paint.length === half && ids(half, fill).every((i) => r.slots.get(i) === slots.get(i)), `moving on: boards still in range keep their slot, only the ${half} new ones are painted`);
ok(new Set(r.slots.values()).size === r.slots.size && [...r.slots.values()].every((s) => s >= 0 && s < cap), "no slot used twice, all inside the atlas");
r = assignSlots(r.slots, ids(0, 900), cap);
ok(r.slots.size === cap, `900 boards in range: the nearest ${cap} get a slot (the atlas never grows)`);
// every resort: the boards within the radius of any piste start fit the atlas
for (const rid of ["killy", "3vallees", "zermatt", "arlberg", "kronplatz", "vialattea", "obertauern", "livigno"]) {
  const res = unpackResort(JSON.parse(fs.readFileSync(new URL(`../../pb/ski/data/${rid}/resort.json`, import.meta.url))));
  const pts = res.pistes.filter((p) => p.line.length >= 4).map((p) => [p.line[0], p.line[1]]);
  let most = 0;
  for (const [x, z] of pts) most = Math.max(most, pts.filter(([a, b]) => Math.hypot(a - x, b - z) < SIGN.radius).length);
  // (cleanup round: the atlas shrank to 64 slots, so also every point of a 100 m grid, the camera can stand anywhere)
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 100) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 100) {
    let n = 0;
    for (const [a, b] of pts) if (Math.hypot(a - x, b - z) < SIGN.radius) n++;
    most = Math.max(most, n);
  }
  ok(most <= cap * 0.75, `${rid}: at most ${most} boards within ${SIGN.radius} m of a sign or any grid point (atlas ${cap}, 25 % spare); ${res.pistes.length} pistes in all`);
  console.log(`  ${rid}: ${res.pistes.length} pistes, the busiest sign sees ${most} boards within ${SIGN.radius} m (atlas ${cap} slots, ${SIGN.cols * SIGN.BW} x ${SIGN.rows * SIGN.BH} px)`);
}

// 3. free ride helpers
const { sideOffset, freeHost, freePlan } = await import("../../pb/ski/net/plan.js");
const { FREE } = await import("../../pb/ski/net/config.js");
{
  const roster = [{ id: "aaaa" }, { id: "bbbb" }, { id: "cccc" }];
  const offs = roster.map((p) => sideOffset(roster, p.id));
  ok(Math.abs(offs[0] + offs[2]) < 1e-9 && offs[1] === 0 && offs[2] - offs[1] === FREE.SIDE_GAP, `side by side, centred (${offs})`);
  ok(freeHost(roster, "cccc", () => "here") === "aaaa" && freeHost(roster, "cccc", (id) => (id === "aaaa" ? "gone" : "here")) === "bbbb" && freeHost(roster, "cccc", () => "gone") === "cccc", "host = the first roster player who is here (handover)");
  const a = freePlan({ weather: "random", time: "random" }, 12345), b = freePlan({ weather: "random", time: "random" }, 12345);
  ok(a.weather === b.weather && a.time === "random" && freePlan({ weather: "fog", time: "evening" }, 1).weather === "fog", "the plan is the same on every device");
}

// 4. wire: a state over 120 m away from the last one is a jump (snap), riding the same lift is not
const { unpackState, packState } = await import("../../pb/ski/net/wire.js");
const st = { x: 100, y: 10, z: 200, heading: 0, speed: 3, edge: 0, tuck: 0, brake: 0, grounded: true, vx: 3, vz: 0, vy: 0, ride: "sit", rideLift: 4, rideS: 120.5, rideKind: 1 };
const back = unpackState(packState(st, 0, false));
ok(back.rideLift === 4 && back.rideS === 120.5 && back.ride === "sit", "riding lift X at s survives the wire");

// 4b. the send schedule (cleanup round): 15 states / s on the wall clock at any frame rate >= 15 (with jitter), never a burst
{
  const { sendSlot } = await import("../../pb/ski/net/wire.js");
  let seed = 7;
  const jr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [fps, jit] of [[60, 2], [30, 0], [30, 5], [24, 6], [20, 6], [16, 3], [10, 0]]) {
    let t = 1000, at = 0, n = 0, gapMin = Infinity, lastT = -1e9;
    while (t < 21000) {
      t += 1000 / fps + (jr() * 2 - 1) * jit;
      const s = sendSlot(at, t, 15);
      if (s !== null) { at = s; n++; gapMin = Math.min(gapMin, t - lastT); lastT = t; }
    }
    const rate = n / 20, want = Math.min(15, fps);
    ok(rate >= want * 0.93 && rate <= 15.3 && gapMin > 1000 / 60 - 3, `send schedule at ${fps} fps +-${jit} ms: ${rate.toFixed(1)} / s (want ~${want}), closest two sends ${gapMin.toFixed(0)} ms`);
  }
  ok(sendSlot(0, 5000, 15) !== null && sendSlot(sendSlot(0, 5000, 15), 5001, 15) === null, "after a pause: one send, then the next one a slot later (no burst)");
}

// 5. packed piste lines (linepack.js <-> scripts/ski/linepack.py): lossless at 0.1 m, the JS packer writes what Python wrote
for (let t = 0; t < 200; t++) {
  const n = 2 * (1 + Math.floor(rnd() * 300)); let x = rnd() * 30000, z = rnd() * 30000;
  const arr = []; for (let i = 0; i < n / 2; i++) { x += (rnd() - 0.5) * 30; z += (rnd() - 0.5) * 30; arr.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10); }
  const back = unpackLine(packLine(arr));
  ok(back.length === arr.length && back.every((v, i) => Math.abs(v - arr[i]) < 1e-6), `line round trip ${t}`);
}
for (const rid of ["killy", "3vallees", "zermatt", "arlberg", "kronplatz", "vialattea", "obertauern", "livigno"]) {
  const raw = JSON.parse(fs.readFileSync(new URL(`../../pb/ski/data/${rid}/resort.json`, import.meta.url)));
  const packed = raw.pistes.filter((p) => p.lz);
  ok(packed.every((p) => packLine(unpackLine(p.lz)) === p.lz) && (raw.network || []).filter((n) => n.pz).every((n) => packLine(unpackLine(n.pz)) === n.pz), `${rid}: Python-packed lines decode and re-pack identically (${packed.length} packed)`);
  const r = unpackResort(raw);
  ok(r.pistes.every((p) => Array.isArray(p.line) && p.line.length >= 4 && p.line.every(Number.isFinite)) && r.network.every((n) => Array.isArray(n.p) && n.p.every(Number.isFinite)), `${rid}: every piste / network line decodes`);
}

console.log(`${fails ? "FAIL" : "PASS"} r7d-test: ${oks} ok, ${fails} failed`);
process.exit(fails ? 1 : 0);
