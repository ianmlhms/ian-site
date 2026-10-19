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
const cams = (args.cams || "cab,outside").split(",");
fs.mkdirSync(outDir, { recursive: true });

async function importPlaywright() {
  for (const spec of ["playwright", pathToFileURL("/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs").href]) {
    try { return await import(spec); } catch { /* next */ }
  }
  throw new Error("playwright not found");
}

function wav16(l, r, rate) {
  const n = l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(l[i]), 44 + i * 4); buf.writeInt16LE(q(r[i]), 46 + i * 4); }
  return buf;
}

const { chromium } = await importPlaywright();
let browser;
for (const opts of [{ channel: "chrome" }, {}]) { try { browser = await chromium.launch({ ...opts, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] }); break; } catch { /* try next */ } }
if (!browser) throw new Error("no chromium");
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.goto("about:blank");
await page.addScriptTag({ content: fs.readFileSync(path.join(here, "train_sound_scenarios.js"), "utf8") });
await page.addScriptTag({ content: fs.readFileSync(audioFile, "utf8") });

const names = await page.evaluate(() => window.TS_SCEN.names);
const rows = [];
for (const name of names) {
  if (only && !only.includes(name)) continue;
  for (const cam of cams) {
    const t0 = Date.now();
    const res = await page.evaluate(async ({ name, cam, sr }) => {
      const sc = window.TS_SCEN.build(name, cam);
      const ctx = new OfflineAudioContext(2, Math.ceil(sc.dur * sr), sr);
      // virtual timers: the old audio used setInterval for the repeating tram bell; make it follow audio time
      const realSI = window.setInterval, realCI = window.clearInterval, realST = window.setTimeout;
      const timers = new Map(); let tid = 1;
      window.setInterval = (fn, ms) => { const id = tid++; timers.set(id, { fn, ms, next: ctx.currentTime + ms / 1000 }); return id; };
      window.clearInterval = (id) => { timers.delete(id); };
      window.setTimeout = (fn, ms) => { const id = tid++; timers.set(id, { fn, ms, once: true, next: ctx.currentTime + (ms || 0) / 1000 }); return id; };
      const audio = window.TS.audio.create({ context: ctx });
      const frames = sc.frames, events = sc.events.slice().sort((a, b) => a.t - b.t);
      let fi = 0, ei = 0;
      const step = async (t) => {
        while (fi < frames.length && frames[fi].t <= t + 1e-6) { audio.update(frames[fi].p); fi++; }
        while (ei < events.length && events[ei].t <= t + 1e-6) { const e = events[ei++]; if (typeof audio[e.fn] === 'function') audio[e.fn](...e.args); }
        for (const [id, tm] of Array.from(timers)) { while (timers.has(id) && tm.next <= ctx.currentTime + 1e-6) { tm.fn(); if (tm.once) { timers.delete(id); } else tm.next += tm.ms / 1000; } }
      };
      const quantum = 128 / sr, stepT = 1 / 60;
      const sched = [];
      for (let t = 0; t < sc.dur; t += stepT) sched.push(Math.round(t / quantum) * quantum);
      const uniq = Array.from(new Set(sched));
      uniq.forEach((t) => { if (t > 0 && t < sc.dur - 2 * quantum) ctx.suspend(t).then(async () => { await step(ctx.currentTime); ctx.resume(); }); });
      await step(0);
      const buf = await ctx.startRendering();
      window.setInterval = realSI; window.clearInterval = realCI; window.setTimeout = realST;
      try { audio.dispose(); } catch (e) { /* ok */ }
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      const chunk = (a) => { const u = new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
      return { dur: sc.dur, l: chunk(l), r: chunk(r) };
    }, { name, cam, sr });
    const toF32 = (b64) => { const b = Buffer.from(b64, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
    const l = toF32(res.l), r = toF32(res.r);
    let peak = 0, sum = 0, nan = 0;
    for (let i = 0; i < l.length; i++) { const x = l[i], y = r[i]; if (!Number.isFinite(x) || !Number.isFinite(y)) { nan++; continue; } peak = Math.max(peak, Math.abs(x), Math.abs(y)); sum += (x * x + y * y) / 2; }
    const rms = Math.sqrt(sum / l.length);
    const file = path.join(outDir, `${name}__${cam}__${tag}.wav`);
    fs.writeFileSync(file, wav16(l, r, sr));
    rows.push({ file: path.basename(file), dur: +res.dur.toFixed(1), peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1), rmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1), nan, renderS: +((Date.now() - t0) / 1000).toFixed(1) });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
}
await browser.close();
if (errors.length) console.log("console issues:\n  " + [...new Set(errors)].slice(0, 12).join("\n  "));
fs.writeFileSync(path.join(outDir, `levels__${tag}.json`), JSON.stringify(rows, null, 1));
