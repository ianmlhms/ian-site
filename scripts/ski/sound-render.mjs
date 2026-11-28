#!/usr/bin/env node
/* Ski Alpen sound check (28 Nov 2026): nobody can listen here, so the sound is rendered and measured.
 *   node scripts/ski/sound-render.mjs [outDir]       default ~/Library/Caches/ski-work/sound
 * 1. node: every buffer of pb/ski/sound-bank.js and the menu music of pb/ski/music.js -> 16-bit WAV, with RMS / peak /
 *    the jump at the loop seam, and the same for the buffers the OLD audio.js made (white * 0.5, Kellet pink * 0.2).
 * 2. browser: the real audio.js (new and the one from git HEAD~ / the baseline file) driven through an OfflineAudioContext: the same
 *    scenarios (groomed carve, powder, ice scrape, glide, fast wind, lift line, station, village + birds, avalanche, landing, door, music)
 *    rendered at 44.1 kHz stereo through the same master gain + compressor; WAV per scenario, RMS / peak table old vs new.
 * Exit 1 when something clips (peak >= 1.0 after the compressor), is silent where it must not be, or a seam jumps. Nothing is normalised. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, launchBrowser, REPO } from '../flows/lib.mjs';

const OUT = process.argv[2] || path.join(os.homedir(), 'Library/Caches/ski-work/sound');
fs.mkdirSync(OUT, { recursive: true });
const BASE_REF = process.env.SOUND_BASE || 'origin/main';
const db = (x) => (x > 1e-9 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

function wav(file, chans, sr) {
  const n = chans[0].length, c = chans.length, data = Buffer.alloc(44 + n * c * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * c * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(c, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * c * 2, 28); data.writeUInt16LE(c * 2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * c * 2, 40);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[k][i] * 32767))), 44 + (i * c + k) * 2);
  fs.writeFileSync(file, data);
}
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
const peak = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };
let fails = 0;
const fail = (msg) => { fails++; console.log('  FAIL ' + msg); };

/* ---------------- 1. node: the buffers ---------------- */
const bankMod = await import(path.join(REPO, 'pb/ski/sound-bank.js'));
const musicMod = await import(path.join(REPO, 'pb/ski/music.js'));
console.log('\nBank buffers (WAV in ' + OUT + '/bank):');
fs.mkdirSync(path.join(OUT, 'bank'), { recursive: true });
const bank = bankMod.createBank();
const t0 = Date.now();
const SEAMS = new Set(['carve', 'powder', 'scrape', 'glide', 'wind', 'air', 'hum', 'machine', 'crowd', 'rumble']);
for (const name of bankMod.BANK_NAMES) {
  const { sr, data } = bank.get(name);
  const row = { name, sec: (data.length / sr).toFixed(2), rms: db(rms(data)), peak: db(peak(data)) };
  let seam = '';
  if (SEAMS.has(name)) {          // the step across the loop point against the typical step: a click if it is far bigger
    let typ = 0; for (let i = 1; i < 4000; i++) typ += Math.abs(data[i] - data[i - 1]); typ /= 4000;
    const jump = Math.abs(data[0] - data[data.length - 1]);
    seam = ` seam ${jump.toFixed(3)} (typical step ${typ.toFixed(3)})`;
    if (jump > Math.max(8 * typ, 0.15)) fail(`${name}: loop seam clicks`);
  }
  console.log(`  ${name.padEnd(10)} ${row.sec}s  rms ${row.rms} dB  peak ${row.peak} dB${seam}`);
  const reps = SEAMS.has(name) && data.length / sr < 5 ? 2 : 1;
  const out = new Float32Array(data.length * reps); for (let r = 0; r < reps; r++) out.set(data, r * data.length);
  wav(path.join(OUT, 'bank', `${name}.wav`), [out.map((v) => Math.max(-1, Math.min(1, v * 0.5)))], sr);        // written at half level: the buffers are source levels, the game scales them down
}
for (const [k, d] of Object.entries(bank.birds())) { console.log(`  bird:${k.padEnd(5)} ${(d.length / 32000).toFixed(2)}s  peak ${db(peak(d))} dB`); wav(path.join(OUT, 'bank', `bird-${k}.wav`), [d.map((v) => Math.max(-1, Math.min(1, v * 0.5)))], 32000); }
console.log(`  (all buffers made in ${Date.now() - t0} ms here)`);

console.log('\nMenu music:');
const t1 = Date.now();
const mus = musicMod.renderMusic();
const loopX = new Float32Array(mus.length * 2), loopY = new Float32Array(mus.length * 2);
loopX.set(mus.left); loopX.set(mus.left, mus.length); loopY.set(mus.right); loopY.set(mus.right, mus.length);
wav(path.join(OUT, 'menu-music-2-loops.wav'), [loopX, loopY], musicMod.MUSIC_RATE);
{
  const L = mus.left, N = mus.length; let typ = 0; for (let i = 1; i < 8000; i++) typ += Math.abs(L[i] - L[i - 1]); typ /= 8000;
  const jump = Math.abs(L[0] - L[N - 1]);
  console.log(`  ${mus.seconds.toFixed(1)} s loop, ${musicMod.MUSIC_RATE} Hz stereo, ${(N * 8 / 1e6).toFixed(1)} MB as floats, rendered in ${Date.now() - t1} ms here; rms ${db(rms(L))} dB peak ${db(peak(L))} dB, seam ${jump.toFixed(4)} (typical step ${typ.toFixed(4)})`);
  if (jump > 6 * typ) fail('music loop seam clicks');
  if (peak(L) >= 0.95) fail('music clips');
}

/* ---------------- 2. browser: the real audio.js, new vs old, offline ---------------- */
let baseSrc = null;
try { baseSrc = execFileSync('git', ['-C', REPO, 'show', `${BASE_REF}:pb/ski/audio.js`], { encoding: 'utf8' }); } catch (error) { console.log(`\n(no ${BASE_REF}:pb/ski/audio.js to compare with: ${String(error.message).split('\n')[0]})`); }
const overrides = new Map(); if (baseSrc) overrides.set('/pb/ski/audio-old.js', baseSrc);
const { server, origin } = await startServer(REPO, { overrides });
const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(origin + '/robots.txt');

const SC = [
  ['carve-groomed', { speed: 18, edge: 0.8, slip: 0, grounded: true, piste: 1 }],
  ['carve-powder', { speed: 10, edge: 0.4, slip: 0, grounded: true, piste: 0 }],
  ['scrape-ice', { speed: 12, edge: 0.2, slip: 0.7, brake: 0.5, grounded: true, piste: 1 }],
  ['glide', { speed: 14, edge: 0, slip: 0, grounded: true, piste: 1 }],
  ['wind-fast', { speed: 30, edge: 0.1, slip: 0, grounded: false, piste: 1 }],
  ['lift-line', { speed: 0, riding: false, lift: 40 }],
  ['station', { speed: 0, riding: false, lift: 12, station: 12, village: 0.4 }],
  ['village-birds-morning', { speed: 3, grounded: true, piste: 1, village: 1, forest: 0.6, altitude: 1500, weather: 'sun', time: 'morning' }],
  ['birds-evening', { speed: 3, grounded: true, piste: 1, village: 0.5, forest: 1, altitude: 1500, weather: 'sun', time: 'evening' }],
  ['avalanche', { speed: 8, edge: 0.2, grounded: true, piste: 1, avalanche: 0.8 }],
];
const SEG = 5;
const EVENTS = [['land-light', 'land', { impact: 0.3 }], ['land-heavy', 'land', { impact: 1 }], ['door', 'door', {}], ['crash', 'crash', {}], ['clack', 'clack', { vol: 0.5 }], ['avalanche-crack', 'avalanche', { near: 0.9 }]];

async function renderAll(label, file) {
  return page.evaluate(async ({ file, SC, SEG, EVENTS }) => {
    const SR = 44100;
    const mod = await import(file);
    const total = SC.length * SEG + EVENTS.length * 2 + (file.includes('old') ? 0 : 14);
    class Off extends OfflineAudioContext { constructor() { super(2, Math.ceil(total * SR), SR); } resume() { return this.go ? super.resume() : Promise.resolve(); } }
    const store = {};
    const win = { AudioContext: Off, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, addEventListener() {} };
    let ctx0 = null;
    class Off2 extends Off { constructor() { super(); ctx0 = this; } }
    win.AudioContext = Off2;
    const audio = mod.createAudio({ win });
    audio.resume();
    const ctx = ctx0;
    const base = { riding: true, paused: false, speed: 0, edge: 0, slip: 0, brake: 0, grounded: true, piste: 1, lift: Infinity, station: Infinity, village: 0, forest: 0, altitude: 2500, weather: 'sun', time: 'midday', avalanche: 0 };
    // the new engine builds its buffers one per tick: wait for them (the old one has no bank)
    for (let i = 0; i < 400 && audio.debug && !audio.debug().ready && file.indexOf('old') < 0; i++) await new Promise((r) => setTimeout(r, 25));
    let musicPlayed = false;
    if (file.indexOf('old') < 0) { audio.scene(true); for (let i = 0; i < 600 && audio.debug().music.state !== 'ready' && audio.debug().music.state !== 'failed'; i++) { await new Promise((r) => setTimeout(r, 25)); audio.scene(true); } musicPlayed = audio.debug().music.state === 'ready'; audio.scene(false); }
    const segs = [];
    let t = 0;
    const at = (time, fn) => ctx.suspend(time).then(() => { fn(); return OfflineAudioContext.prototype.resume.call(ctx); });
    const origMath = Math.random; let sd = 42; Math.random = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    SC.forEach(([name, f], i) => { const s = i * SEG; segs.push([name, s, s + SEG]); at(Math.max(s, 0.001), () => audio.update({ ...base, ...f })); });
    // updates every 0.25 s inside a scenario so the time-driven parts (gust, clacks, birds) run
    SC.forEach(([name, f], i) => { for (let k = 1; k < SEG * 4; k++) { const tt = i * SEG + k * 0.25; if (tt < total - 0.2) at(tt, () => audio.update({ ...base, ...f })); } });
    let e = SC.length * SEG;
    EVENTS.forEach(([name, ev, o], i) => { const s = e + i * 2; segs.push([name, s, s + 2]); at(Math.max(s, 0.001) + 0.01, () => { audio.update({ ...base, riding: false }); audio.event(ev, o); }); });
    let musicSeg = null;
    if (file.indexOf('old') < 0 && musicPlayed) { const s = e + EVENTS.length * 2; musicSeg = [s, s + 14]; segs.push(['menu-music', s, s + 14]); at(s + 0.01, () => { audio.update({ ...base, riding: false }); audio.scene(true); }); }
    ctx.go = true;
    const buf = await ctx.startRendering();
    Math.random = origMath;
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const out = segs.map(([name, a, b]) => {
      const i0 = Math.floor(a * SR), i1 = Math.min(L.length, Math.floor(b * SR));
      let s = 0, p = 0, n = 0;
      for (let i = i0; i < i1; i++) { s += L[i] * L[i] + R[i] * R[i]; n += 2; p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); }
      return { name, a, b, rms: Math.sqrt(s / Math.max(1, n)), peak: p };
    });
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))); pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))); }
    let bin = ''; const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { out, n: L.length, sr: SR, b64: btoa(bin), musicPlayed, debug: audio.debug ? audio.debug() : null };
  }, { file, SC, SEG, EVENTS });
}

const table = {};
for (const [label, file] of [['old', '/pb/ski/audio-old.js'], ['new', '/pb/ski/audio.js']]) {
  if (label === 'old' && !baseSrc) continue;
  let r;
  try { r = await renderAll(label, file); } catch (error) { fail(`${label} render: ${String(error.message).split('\n')[0]}`); continue; }
  const pcm = Buffer.from(r.b64, 'base64'), i16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const L = new Float32Array(r.n), R = new Float32Array(r.n);
  for (let i = 0; i < r.n; i++) { L[i] = i16[2 * i] / 32767; R[i] = i16[2 * i + 1] / 32767; }
  wav(path.join(OUT, `scenarios-${label}.wav`), [L, R], r.sr);
  for (const s of r.out) {
    table[s.name] = table[s.name] || {}; table[s.name][label] = s;
    const seg = [L.slice(Math.floor(s.a * r.sr), Math.floor(s.b * r.sr)), R.slice(Math.floor(s.a * r.sr), Math.floor(s.b * r.sr))];
    wav(path.join(OUT, `${label}-${s.name}.wav`), seg, r.sr);
  }
  if (label === 'new') { table.__debug = r.debug; if (!r.musicPlayed) fail('the music did not render in the page'); }
}
console.log('\nScenarios through the real audio.js (44.1 kHz, same master gain + compressor), old = ' + BASE_REF + ':');
console.log('  scenario'.padEnd(26) + 'old rms  old peak |  new rms  new peak   (dBFS)');
for (const [name, v] of Object.entries(table)) {
  if (name === '__debug') continue;
  const o = v.old, n = v.new;
  console.log(`  ${name.padEnd(24)}${o ? db(o.rms).padStart(7) : '      -'}  ${o ? db(o.peak).padStart(7) : '      -'} |  ${n ? db(n.rms).padStart(7) : '      -'}  ${n ? db(n.peak).padStart(7) : '      -'}`);
  if (n && n.peak >= 0.999) fail(`${name}: clips (peak ${db(n.peak)} dB)`);
  if (n && n.rms < 1e-4 && name !== 'lift-line') fail(`${name}: silent`);
  if (n && o && o.rms > 1e-3 && name !== 'menu-music') { const d = 20 * Math.log10((n.rms + 1e-9) / (o.rms + 1e-9)); if (Math.abs(d) > 6) console.log(`    note: ${name} is ${d.toFixed(1)} dB ${d > 0 ? 'louder' : 'quieter'} than before`); }
}
if (table.__debug) console.log('  engine after the render:', JSON.stringify(table.__debug));
if (errors.length) { fail('console errors: ' + errors.slice(0, 3).join(' | ')); }
await browser.close(); server.close();
console.log(fails ? `\n${fails} problem(s).` : '\nsound-render: all good. Files in ' + OUT);
process.exit(fails ? 1 : 0);
