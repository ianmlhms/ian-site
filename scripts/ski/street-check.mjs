#!/usr/bin/env node
/* Streets round: the street network (pb/ski/street-net.js), in node, flat ground. Per resort:
 *   joins    no street is lost: the length of the joined ways == the length of the input
 *   ends     every end is joined to another street or fades to strength 0; strengths / ruts in 0..1; no loose stub
 *   picks    random points near the streets: the distance to the edge from the cell's 4 segments vs from all of them (the shader only sees
 *            the 4); the share of points off by > 0.15 m must stay under 0.5 % (the shards at the old junctions were exactly that)
 *   node scripts/ski/street-check.mjs [--resorts killy,...] */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const N = await import(path.join(ROOT, "pb/ski/street-net.js"));
const i = process.argv.indexOf("--resorts");
const DATA = path.join(ROOT, "pb/ski/data");
const rids = i > 0 ? process.argv[i + 1].split(",") : fs.readdirSync(DATA).filter((r) => fs.existsSync(path.join(DATA, r, "roads.json")));
const len = (P) => P.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - P[k - 1][0], p[1] - P[k - 1][1]) : 0), 0);
let seed = 5;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
for (const rid of rids) {
  const t0 = Date.now();
  const raw = N.decodeRoads(JSON.parse(fs.readFileSync(path.join(DATA, rid, "roads.json"), "utf8")));
  const joined = N.joinRoads(raw);
  const la = raw.reduce((s, r) => s + len(r.pts), 0), lb = joined.reduce((s, r) => s + len(r.pts), 0);
  ok(Math.abs(la - lb) < 1, `${rid}: joined length ${lb.toFixed(0)} != ${la.toFixed(0)}`);
  const streets = N.buildStreets(raw, () => 0);
  let dead = 0, join = 0;
  for (const s of streets) {
    ok(s.f.length === s.pts.length && s.r.length === s.pts.length, `${rid}: strengths per point`);
    ok([...s.f, ...s.r].every((v) => v >= 0 && v <= 1), `${rid}: strengths in 0..1`);
    s.ends.forEach((e, k) => { const f = k ? s.f[s.f.length - 1] : s.f[0]; if (e === "dead") { dead++; ok(f < 0.01, `${rid}: a dead end keeps strength ${f}`); } else join++; });
  }
  const net = N.packSegments(streets), D = net.data, ST = N.STRIDE;
  const segE = (x, z, s) => { const o = s * ST, h = N.pointSeg(x, z, D[o], D[o + 1], D[o + 2], D[o + 3]); const f = (Math.floor(D[o + 4] + 1e-3) * (1 - h.t) + Math.floor(D[o + 5] + 1e-3) * h.t) / 100; return h.d - D[o + 6] + N.fadeGap(f, D[o + 6]); };
  const bins = new Map(), B = 40;
  for (let s = 0; s < net.count; s++) {
    const o = s * ST, r = 14;
    for (let a = Math.floor((Math.min(D[o], D[o + 2]) - r) / B); a <= Math.floor((Math.max(D[o], D[o + 2]) + r) / B); a++) for (let b = Math.floor((Math.min(D[o + 1], D[o + 3]) - r) / B); b <= Math.floor((Math.max(D[o + 1], D[o + 3]) + r) / B); b++) { const k = a + "," + b; if (!bins.has(k)) bins.set(k, []); bins.get(k).push(s); }
  }
  for (const lat of [2.5, 10]) {
    let bad = 0, n = 0, worst = 0, at = null;
    for (let q = 0; q < 20000; q++) {
      const s = lat < 4 ? Math.floor(rnd() * net.far) : net.far + Math.floor(rnd() * (net.count - net.far)), o = s * ST, t = rnd(), R = D[o + 6] + 2;
      const x = D[o] + (D[o + 2] - D[o]) * t + (rnd() * 2 - 1) * R, z = D[o + 1] + (D[o + 3] - D[o + 1]) * t + (rnd() * 2 - 1) * R;
      const ci = Math.floor(x / lat), cj = Math.floor(z / lat);
      const all = bins.get(Math.floor(x / B) + "," + Math.floor(z / B)) || [];
      const near = all.filter((k) => k < net.far === lat < 4).filter((k) => { const c = k * ST; return N.pointSeg((ci + 0.5) * lat, (cj + 0.5) * lat, D[c], D[c + 1], D[c + 2], D[c + 3]).d <= D[c + 6] + N.BANK + lat * 0.71; });
      if (!near.length) continue;
      const truth = Math.min(...near.map((k) => segE(x, z, k)));
      if (truth > 0.6) continue;
      const four = N.pickSegments(net, near, ci * lat, cj * lat, lat);
      n++;
      const seen = four ? Math.min(...four.map((k) => segE(x, z, k))) : 9;
      const err = seen - truth;
      if (err > worst) { worst = err; at = [Math.round(x), Math.round(z)]; }
      if (err > 0.15) bad++;
    }
    ok(bad / n < (lat > 4 ? 0.04 : 0.005), `${rid}: lattice ${lat}: ${bad} of ${n} points off by > 0.15 m`);
    console.log(`${rid} lattice ${lat}: ${bad} / ${n} points off by > 0.15 m (worst ${worst.toFixed(2)} m at ${at})`);
  }
  console.log(`${rid}: ${raw.length} ways -> ${streets.length} streets, ${net.far} + ${net.count - net.far} segments, ${dead} dead ends, ${join} joined; ${Date.now() - t0} ms`);
}
console.log(fails ? `${fails} FAILS` : "all ok");
process.exit(fails ? 1 : 0);
