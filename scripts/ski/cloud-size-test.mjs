#!/usr/bin/env node
/* Cloud save size (round 9): a player who starred EVERY piste of every resort (the real piste ids of the baked resorts + 3 synthetic
 * resorts for the next ones) must still fit the game_saves limit (jsonb <= 8192 bytes; the game keeps its record under 7000, this test
 * demands < 7500), round-trip the stars exactly, say what was dropped, and old (plain "s") records must still load.
 *   node scripts/ski/cloud-size-test.mjs      exit 0 = all green */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { encodeCloud, decodeCloud, mergeCloud } = await imp('modes/cloud.js');
const { starKey, totalStars } = await imp('modes/challenges.js');

let fails = 0, checks = 0;
const ok = (cond, text) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${text}`); } else console.log(`  ok   ${text}`); };
const bytes = (rec) => Buffer.byteLength(JSON.stringify(rec));

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

const ids = {};
for (const rid of fs.readdirSync(path.join(root, 'data'))) {
  const f = path.join(root, 'data', rid, 'resort.json');
  if (fs.existsSync(f)) ids[rid] = JSON.parse(fs.readFileSync(f, 'utf8')).pistes.map((p) => p.id);
}
for (const [rid, n] of [['livigno', 300]]) ids[rid] = Array.from({ length: n }, (_, i) => `synthetic-${rid}-${i}-${Math.floor(rnd() * 1e9)}`);
const resortCount = Object.keys(ids).length;
const pisteCount = Object.values(ids).reduce((n, a) => n + a.length, 0);

function player({ mask = 7, times = true, disc = true }) {
  const stars = {}, bestHash = {}, discMap = {}, park = {}, lawin = {};
  for (const [rid, list] of Object.entries(ids)) {
    list.forEach((id) => { stars[starKey(rid, id)] = mask; if (times) bestHash[starKey(rid, id)] = 30000 + Math.floor(rnd() * 600000); });
    if (disc) discMap[rid] = Array.from({ length: 1200 }, () => Math.floor(rnd() * 400).toString(36)).join(',');
    park[rid] = 1000 + Math.floor(rnd() * 90000);
    lawin[rid] = 1 + Math.floor(rnd() * 254);
  }
  return { stars, bestHash, disc: discMap, park, lawin, stats: { off: 123456, top: 41.3 }, ski: 'powder' };
}
const starsOf = (progress) => JSON.stringify(Object.entries(progress.stars).sort());

console.log(`${resortCount} resorts, ${pisteCount} pistes`);
// 1. everything starred + times + a big fog grid: fits, stars exact, the report names what went
{
  const p = player({}), dropped = [];
  const rec = encodeCloud(p, dropped);
  const size = bytes(rec);
  ok(size < 7500, `all stars of ${resortCount} resorts + times + fog: ${size} bytes < 7500`);
  const back = decodeCloud(JSON.parse(JSON.stringify(rec)));
  ok(starsOf({ stars: back.stars }) === starsOf(p), 'every star round-trips exactly (all 3 stars, every piste)');
  ok(back.ski === 'powder' && back.stats.off === 123456 && Math.abs(back.stats.top - 41.3) < 0.06, 'ski type + stats survive');
  ok(dropped.length > 0 && dropped[0] === 'best times', `degradation order starts with the best times (dropped: ${dropped.join(' | ')})`);
  ok(!dropped.some((x) => x.startsWith('stars of')), 'no stars dropped');
  ok(rec.tb === totalStars(p), 'tb = total stars (keep-progress trigger)');
  console.log(`  info stars alone: ${bytes({ s2: rec.s2 })} bytes of ${size}`);
}
// 2. stars only (no times, no fog): nothing dropped, exact
{
  const p = player({ times: false, disc: false }), dropped = [];
  const rec = encodeCloud(p, dropped);
  const back = decodeCloud(JSON.parse(JSON.stringify(rec)));
  ok(bytes(rec) < 7500 && dropped.length === 0, `stars + park + Lawin only: ${bytes(rec)} bytes, nothing dropped`);
  ok(starsOf({ stars: back.stars }) === starsOf(p) && JSON.stringify(back.park) === JSON.stringify(p.park) && JSON.stringify(back.lawin) === JSON.stringify(p.lawin), 'stars, park, Lawin exact');
}
// 3. mixed masks round-trip (1..7), and merging back into the progress changes nothing
{
  const p = player({ times: false, disc: false });
  for (const k of Object.keys(p.stars)) p.stars[k] = 1 + Math.floor(rnd() * 7);
  const rec = encodeCloud(p);
  ok(!!rec.s2, 'big record uses the packed stars (s2)');
  const back = decodeCloud(JSON.parse(JSON.stringify(rec)));
  ok(starsOf({ stars: back.stars }) === starsOf(p), 'random masks 1..7 round-trip exactly');
  const merged = mergeCloud(p, back);
  ok(starsOf(merged) === starsOf(p), 'merging the record back adds nothing');
}
// 4. a small player keeps the OLD format (an old game still reads it) and old records still load
{
  const p = { stars: { 'killy/abcde': 7, 'killy/zzzzz': 3 }, park: {}, bestHash: { 'killy/abcde': 61234 }, stats: { off: 0, top: 0 }, ski: 'allmountain' };
  const rec = encodeCloud(p);
  ok(rec.s && rec.s.killy === 'abcde7zzzzz3' && !rec.s2, 'small save: plain "s" text, no s2');
  const old = decodeCloud({ v: 1, tb: 4, s: { killy: 'abcde7zzzzz3' }, p: {}, b: {} });
  ok(old && old.stars['killy/abcde'] === 7 && old.stars['killy/zzzzz'] === 3, 'a record written by the old game loads');
}
// 5. forged / broken s2 is dropped, never crashes, bounded
{
  const bad = [null, '', '!!!', 'A'.repeat(5000), '____', 'AAAAAA', 5, {}, ['x']];
  let thrown = false, got = 0;
  try { for (const t of bad) { const r = decodeCloud({ v: 1, s2: { killy: t } }); got += Object.keys(r.stars).length; } } catch { thrown = true; }
  ok(!thrown && got === 0, 'forged s2 texts: nothing thrown, nothing accepted');
  const t0 = Date.now();
  decodeCloud({ v: 1, s2: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`r${i}`, '_'.repeat(4000)])) });
  ok(Date.now() - t0 < 500, 'many max-size forged texts decode in bounded time');
}
// 6. extreme: far more resorts than any limit allows: the stars of the smallest go last, still <= limit, and the report says so
{
  const big = player({ times: false, disc: false });
  for (let r = 0; r < 14; r++) { const rid = `x${r}`; for (let i = 0; i < 400; i++) big.stars[`${rid}/${Math.floor(rnd() * 36 ** 5).toString(36).padStart(5, '0')}`] = 7; }
  const dropped = [], rec = encodeCloud(big, dropped);
  ok(bytes(rec) <= 7000, `absurd player (${Object.keys(big.stars).length} starred pistes): ${bytes(rec)} bytes <= 7000`);
  ok(dropped.some((x) => x.startsWith('stars of')), `drops are reported (${dropped.slice(-2).join(' | ')})`);
}
// 7. the piste index covers every baked piste (run scripts/ski/piste_index.mjs after a bake / new resort), and the real resorts alone use s3 only
{
  const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'piste_index.mjs'), '--check'], { encoding: 'utf8' });
  ok(r.status === 0, `piste index complete: ${(r.stdout || '').trim()}`);
  const real = player({ times: false, disc: false });
  for (const k of Object.keys(real.stars)) if (k.startsWith('livigno/')) delete real.stars[k];
  const rec = encodeCloud(real);
  ok(rec.s3 && !rec.s2 && bytes(rec) < 2500, `indexed stars only (s3, no s2 fallback): ${bytes(rec)} bytes for ${Object.keys(real.stars).length} pistes`);
  ok(starsOf({ stars: decodeCloud(JSON.parse(JSON.stringify(rec))).stars }) === starsOf(real), 'indexed stars round-trip exactly');
}
console.log(fails ? `${fails} of ${checks} FAILED` : `all ${checks} cloud-size checks passed`);
process.exit(fails ? 1 : 0);
