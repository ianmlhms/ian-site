#!/usr/bin/env node
/* Renders Zuchsimulator audio scenarios to WAV with an OfflineAudioContext (headless Chrome), for A/B listening and level checks.
 *
 *   node scripts/train_sound_render.mjs --audio pb/train-sim/audio.js --out DIR [--tag new] [--scen tram_city,emu] [--cams cab,outside] [--sr 44100]
 *
 * Writes DIR/<scenario>__<camera>__<tag>.wav (16-bit stereo) and prints peak / RMS per file. Never plays sound. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const audioFile = path.resolve(args.audio || path.join(here, "../pb/train-sim/audio.js"));
const outDir = path.resolve(args.out || ".");
const tag = args.tag || "new";
const sr = Number(args.sr || 44100);
const only = args.scen ? args.scen.split(",") : null;
const mute = args.mute ? args.mute.split(",") : [];
const cams = (args.cams || "cab,outside").split(",");
fs.mkdirSync(outDir, { recursive: true });

async function importPlaywright() {
  for (const spec of ["playwright", pathToFileURL("/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs").href]) {
    try { return await import(spec); } catch { /* next */ }
  }
  throw new Error("playwright not found");
}

function wav16(l, r, rate) {
  if (args.mono) {   // mono mix, half the size
    const n = l.length, buf = Buffer.alloc(44 + n * 2);
    buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((l[i] + r[i]) * 0.5 * 32767))), 44 + i * 2);
    return buf;
  }
  const n = l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(l[i]), 44 + i * 4); buf.writeInt16LE(q(r[i]), 46 + i * 4); }
  return buf;
}

const { chromium } = await importPlaywright();
let browser;
if (args.browser === "webkit") { const { webkit } = await importPlaywright(); browser = await webkit.launch(); }
else for (const opts of [{ channel: "chrome" }, {}]) { try { browser = await chromium.launch({ ...opts, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] }); break; } catch { /* try next */ } }
if (!browser) throw new Error("no chromium");
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.goto("about:blank");
await page.addScriptTag({ content: fs.readFileSync(path.join(here, "train_sound_scenarios.js"), "utf8") });
await page.addScriptTag({ content: fs.readFileSync(audioFile, "utf8") });

const names = await page.evaluate(() => window.TS_SCEN.names);
const toF32 = (b64) => { const b = Buffer.from(b64, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

async function renderOne(name, cam, muteList) {
  const res = await page.evaluate(async ({ name, cam, sr, mute }) => {
    const sc = window.TS_SCEN.build(name, cam);
    const ctx = new OfflineAudioContext(2, Math.ceil(sc.dur * sr), sr);
    // virtual timers: follow audio time (the old audio used setInterval for the repeating tram bell)
    const realSI = window.setInterval, realCI = window.clearInterval, realST = window.setTimeout;
    const timers = new Map(); let tid = 1;
    window.setInterval = (fn, ms) => { const id = tid++; timers.set(id, { fn, ms, next: ctx.currentTime + ms / 1000 }); return id; };
    window.clearInterval = (id) => { timers.delete(id); };
    window.setTimeout = (fn, ms) => { const id = tid++; timers.set(id, { fn, ms, once: true, next: ctx.currentTime + (ms || 0) / 1000 }); return id; };
    const audio = window.TS.audio.create({ context: ctx });
    if (mute.length && audio.debugMute) audio.debugMute(mute);
    const frames = sc.frames, events = sc.events.slice().sort((a, b) => a.t - b.t);
    let fi = 0, ei = 0;
    const step = async (t) => {
      while (fi < frames.length && frames[fi].t <= t + 1e-6) { audio.update(frames[fi].p); fi++; }
      while (ei < events.length && events[ei].t <= t + 1e-6) { const e = events[ei++]; if (typeof audio[e.fn] === 'function') audio[e.fn](...e.args); }
      for (const [id, tm] of Array.from(timers)) { while (timers.has(id) && tm.next <= ctx.currentTime + 1e-6) { tm.fn(); if (tm.once) { timers.delete(id); } else tm.next += tm.ms / 1000; } }
    };
    const quantum = 128 / sr, stepT = 1 / 60, uniq = new Set();
    for (let t = 0; t < sc.dur; t += stepT) uniq.add(Math.round(t / quantum) * quantum);
    uniq.forEach((t) => { if (t > 0 && t < sc.dur - 2 * quantum) ctx.suspend(t).then(async () => { await step(ctx.currentTime); ctx.resume(); }); });
    await step(0);
    const buf = await ctx.startRendering();
    window.setInterval = realSI; window.clearInterval = realCI; window.setTimeout = realST;
    const stats = audio.stats ? audio.stats() : null;
    try { audio.dispose(); } catch (e) { /* ok */ }
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    const chunk = (a) => { const u = new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
    return { dur: sc.dur, l: chunk(l), r: chunk(r), speed: sc.frames.filter((f, i) => i % 15 === 0).map((f) => [f.t, f.p.speedMs]), stats };
  }, { name, cam, sr, mute: muteList });
  return { ...res, l: toF32(res.l), r: toF32(res.r) };
}
const timelineOf = (l, r) => {
  const win = Math.floor(sr * 0.5), tl = [];
  for (let i = 0; i + win <= l.length; i += win) { let e = 0; for (let j = i; j < i + win; j++) e += (l[j] * l[j] + r[j] * r[j]) / 2; tl.push(10 * Math.log10(e / win + 1e-12)); }
  return tl;
};

const GROUPS = ["tract", "mech", "roll", "aero", "aux", "eng", "brk", "amb", "doors", "shots"];
if (args.groups) {   // per-group solo loudness by phase of the drive (standstill / low speed / mid / fast)
  for (const name of names.filter((n) => !only || only.includes(n))) {
    for (const cam of cams) {
      const rows = [];
      for (const g of GROUPS) {
        const res = await renderOne(name, cam, GROUPS.filter((x) => x !== g));
        const tl = timelineOf(res.l, res.r), vmax = Math.max(...res.speed.map((x) => x[1]));
        const speedAt = (i) => { let best = res.speed[0]; for (const x of res.speed) if (x[0] <= i * 0.5) best = x; return best[1]; };
        const ph = { stand: [], low: [], mid: [], fast: [] };
        tl.forEach((_, i) => { const v = speedAt(i); ph[v < 0.3 ? "stand" : v < vmax * 0.35 ? "low" : v < vmax * 0.8 ? "mid" : "fast"].push(i); });
        const mean = (idx) => (idx.length ? +(10 * Math.log10(idx.reduce((a, i) => a + Math.pow(10, tl[i] / 10), 0) / idx.length)).toFixed(1) : null);
        rows.push([g.padEnd(6), ...Object.keys(ph).map((k) => String(mean(ph[k])).padStart(8))].join(" "));
      }
      console.log(`== ${name} / ${cam}\n` + "group  " + ["stand", "low", "mid", "fast"].map((x) => x.padStart(8)).join(" ") + "\n" + rows.join("\n"));
    }
  }
  await browser.close();
  process.exit(0);
}

const rows = [];
for (const name of names) {
  if (only && !only.includes(name)) continue;
  for (const cam of cams) {
    const t0 = Date.now();
    const res = await renderOne(name, cam, mute);
    const { l, r } = res;
    let peak = 0, sum = 0, nan = 0;
    for (let i = 0; i < l.length; i++) { const x = l[i], y = r[i]; if (!Number.isFinite(x) || !Number.isFinite(y)) { nan++; continue; } peak = Math.max(peak, Math.abs(x), Math.abs(y)); sum += (x * x + y * y) / 2; }
    const rms = Math.sqrt(sum / l.length);
    if (args.timeline) fs.writeFileSync(path.join(outDir, `${name}__${cam}__${tag}.tl.json`), JSON.stringify({ tl: timelineOf(l, r), speed: res.speed }));
    const file = path.join(outDir, `${name}__${cam}__${tag}.wav`);
    if (!args.nowav) fs.writeFileSync(file, wav16(l, r, sr));
    rows.push({ file: path.basename(file), dur: +res.dur.toFixed(1), peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1), rmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1), nan, renderS: +((Date.now() - t0) / 1000).toFixed(1), stats: res.stats });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
}
await browser.close();
if (errors.length) console.log("console issues:\n  " + [...new Set(errors)].slice(0, 12).join("\n  "));
fs.writeFileSync(path.join(outDir, `levels__${tag}.json`), JSON.stringify(rows, null, 1));
