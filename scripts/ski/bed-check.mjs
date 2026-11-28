#!/usr/bin/env node
/* Road beds (28 Nov 2026): how much do the village streets lean sideways? In node, no browser.
 *   node scripts/ski/bed-check.mjs [--resorts killy,...] [--data DIR]      (DIR = a folder with <rid>/ baked data, default pb/ski/data)
 * Per resort: every street of roads.json (kept the way the game keeps it: joined, gentle, ends finished) is sampled every 8 m; across it
 * (at +-hw, along the normal) the baseHeight difference / (2 hw) = the cross slope in degrees. Prints mean / median / p90 / max of |slope|
 * and the share of samples leaning more than 3 degrees. After the beds p90 should be a few degrees, before up to 15-20.
 * Also checks the height ALONG the street between neighbouring samples (no steps). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis.window || {};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const NEAR = opt("--near", "") ? opt("--near", "").split(",").map(Number) : null;      // x,z,radius: only streets there
const DATA = opt("--data", path.join(ROOT, "pb/ski/data"));
const { unpackResort } = await import(path.join(ROOT, "pb/ski/linepack.js"));
const { decodeGrid, decodeRle } = await import(path.join(ROOT, "pb/ski/codec.js"));
const { createField, createPisteNet } = await import(path.join(ROOT, "pb/ski/field.js"));
const N = await import(path.join(ROOT, "pb/ski/street-net.js"));
const rids = opt("--resorts", fs.readdirSync(DATA).filter((r) => fs.existsSync(path.join(DATA, r, "roads.json"))).join(",")).split(",");
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
for (const rid of rids) {
  const dir = path.join(DATA, rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, "resort.json"), "utf8")));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, "far.bin"))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, "classes.bin"))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, "t", `${tx}_${tz}.bin`)))));
  const h = (x, z) => field.baseHeight(x, z);
  const raw = N.decodeRoads(JSON.parse(fs.readFileSync(path.join(dir, "roads.json"), "utf8")));
  const streets = N.buildStreets(raw, h).filter((s) => s.hw >= 2);
  const slopes = [], worst = [];
  for (const s of streets) {
    for (let k = 0; k + 1 < s.pts.length; k++) {
      const [ax, az] = s.pts[k], [bx, bz] = s.pts[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L, n = Math.max(1, Math.floor(L / 8));
      for (let i = 0; i < n; i++) {
        const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n);
        if (NEAR && Math.hypot(x - NEAR[0], z - NEAR[1]) > NEAR[2]) continue;
        const sl = (Math.abs(Math.atan((h(x + nx * s.hw, z + nz * s.hw) - h(x - nx * s.hw, z - nz * s.hw)) / (2 * s.hw))) * 180 / Math.PI); slopes.push(sl); if (sl > 3.5) worst.push([sl, x, z, s.hw]);
      }
    }
  }
  if (args.includes("--worst")) console.log(worst.sort((a, b) => b[0] - a[0]).slice(0, 25).map((w) => w.map((v) => Math.round(v * 10) / 10).join(" ")).join("\n"));
  slopes.sort((a, b) => a - b);
  const mean = slopes.reduce((a, b) => a + b, 0) / (slopes.length || 1);
  console.log(`${rid.padEnd(11)} n ${String(slopes.length).padStart(6)}  mean ${mean.toFixed(2)}  median ${q(slopes, 0.5).toFixed(2)}  p90 ${q(slopes, 0.9).toFixed(2)}  p99 ${q(slopes, 0.99).toFixed(2)}  max ${(slopes[slopes.length - 1] || 0).toFixed(1)}  >3deg ${(100 * slopes.filter((v) => v > 3).length / (slopes.length || 1)).toFixed(1)} %`);
}
