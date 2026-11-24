#!/usr/bin/env node
/* R8 integration: a ground-level contact sheet per resort (WebKit by default, the Safari engine Ian plays on), the shots a player sees:
 *   spawn     the free ride's first frame (the lift station's boarding zone, chase camera)
 *   street    a village street next to the spawn, the skier standing on it, looking along it
 *   station   the spawn lift's bottom station from outside (drive housing, roof, name sign, gates)
 *   ride      on that lift, the chase camera, mid-line
 *   carve     a red piste: the skier carving (orbit camera from the front side)
 *   stop      the hockey stop at the end of a fast run
 *   drag      a drag lift from the side (pylon head, the up + return rope)
 *   fp        (R8b) first person carving the red piste;  map  (R8b) the piste map's free ride tab (list row vs card checked)
 *   node scripts/ski/round8-sheet.mjs [--resorts killy,...] [--engine webkit|chromium] [--out DIR] [--only spawn,street,...]
 * PNGs <engine>-<resort>-<shot>.png; stack them with scripts/ski/look_sheet.py. Run through browser-slot.py (one browser). */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos").split(",");
const engine = opt("--engine", "webkit");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round8"));
const only = opt("--only", "") ? opt("--only", "").split(",") : null;
const q = opt("--q", "medium");
const time = opt("--time", "midday");
const liftName = opt("--lift", "");                   // R8d: start at this lift instead of the resort's first lift
const tag = opt("--tag", "") ? "-" + opt("--tag", "") : "";
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true, args: engine === "chromium" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer();
const want = (n) => !only || only.includes(n);
const report = [];
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => { errors.push(String(e).slice(0, 300)); console.log(`[${rid}] pageerror`, String(e).slice(0, 300)); });
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&weather=sun&time=${time}&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    await page.waitForTimeout(5000);
    const shot = async (name) => { await page.screenshot({ path: path.join(out, `${engine}-${rid}${tag}-${name}.png`) }); console.log(`  ${rid}${tag} ${name}`); };
    const ev = (f, a) => page.evaluate(f, a);
    const settle = (ms) => page.waitForTimeout(ms);
    const meshed = () => ev(async () => { const S = window.__ski; for (let i = 0; i < 80 && (S.terrain.stats.pending > 0 || i < 10); i++) await new Promise((r) => setTimeout(r, 100)); });
    if (liftName) {
      // R8d: --lift NAME: the sheet of another area of the resort (Sonnenkopf): fast travel to that lift's boarding zone first
      await ev(async (name) => { const S = window.__ski; const l = S.modes.lifts.list.find((q) => q.name === name); if (l) await S.goFree(l.id); }, liftName);
      await settle(6000);
    }
    if (want("spawn")) await shot("spawn");
    const spawn = await ev((name) => {
      const S = window.__ski, l = name ? S.modes.lifts.list.find((q) => q.name === name) : null;
      const sp = l ? { id: l.id, index: l.index, name: l.name } : S.spawn;
      return { id: sp.id, index: sp.index, name: sp.name, x: S.state.x, z: S.state.z };
    }, liftName);
    await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === '1' && !!window.__ski.lifts, null, { timeout: 300000, polling: 500 }).catch(() => {});
    await page.waitForFunction(() => !!window.__ski.roadRows && !!window.__ski.boxIndex, null, { timeout: 60000 }).catch(() => {});
    await settle(1500);
    if (want("station")) {
      await ev((i) => {
        const S = window.__ski, e = S.lifts.siteOf(i).ends[0];
        const p = e.toWorld(-24, 18, {}), t = e.toWorld(-2, 2, {});
        S.setCamera(p.x, p.z, 6, t.x, t.z, 3, 55);
      }, spawn.index);
      await settle(3500);
      await shot("station");
      await ev(() => window.__ski.setCamera(null));
    }
    if (want("street")) {
      // the street point nearest the spawn that is at least 6 m from every house, looking along the street
      const st = await ev(({ x, z }) => {
        const S = window.__ski;
        let best = null, bd = Infinity;
        for (const r of S.roadRows) for (let i = 0; i + 1 < r.pts.length; i++) {
          const [px, pz] = r.pts[i], [nx, nz] = r.pts[i + 1];
          const d = Math.hypot(px - x, pz - z);
          if (d < 60 || d > bd || Math.hypot(nx - px, nz - pz) < 4) continue;
          if (S.boxIndex && S.boxIndex.hit(px, pz, 6)) continue;
          bd = d; best = { x: px, z: pz, h: Math.atan2(nz - pz, nx - px) };
        }
        if (best) { S.place(best.x, best.z, best.h); S.streamer.focus(best.x, best.z); }
        return best ? { ...best, d: Math.round(bd) } : null;
      }, spawn);
      if (st) {
        await ev(({ x, z }) => window.__ski.streamer.ready(x, z, 400), st);
        await meshed();
        await settle(3000);
        await shot("street");
      }
    }
    if (want("ride")) {
      await ev((id) => window.__ski.goFree(id), spawn.id);
      await page.waitForFunction((i) => window.__ski.game.phase === 'running' && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === i, spawn.id, { timeout: 40000 }).catch(() => {});
      await settle(1500);
      await ev(() => window.__ski.boardLift());
      await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === 'ride', null, { timeout: 40000 }).catch(() => {});
      await page.waitForFunction(() => { const r = window.__ski.ride; return !r || r.s > Math.min(260, r.path.len * 0.4); }, null, { timeout: 90000 }).catch(() => {});
      await settle(800);
      await shot("ride");
      if (await ev(() => !!window.__ski.ride)) {
        await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.canSkip, null, { timeout: 40000 }).catch(() => {});
        await ev(() => window.__ski.skipRide());
        await page.waitForFunction(() => window.__ski.game.phase === 'running' && !window.__ski.ride, null, { timeout: 90000 }).catch(() => {});
      }
    }
    if (want("carve") || want("stop") || want("fp")) {
      const setup = await ev(() => {
        const S = window.__ski;
        const p = S.pistes.list.filter((q) => q.diff === 'red' && q.length > 900).sort((a, b) => b.length - a.length)[0] || S.pistes.list[0];
        const a = p.at(Math.min(300, p.length / 3), {});
        S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
        S.streamer.focus(a.x, a.z);
        return { id: p.id, x: a.x, z: a.z };
      });
      await ev(({ x, z }) => window.__ski.streamer.ready(x, z, 500), setup);
      await meshed();
      await ev(async (id) => {
        const { createBot } = await import('/pb/ski/bot.js');
        const S = window.__ski, bot = createBot(S.pistes.byId.get(id));
        window.__drive = { input: null };
        const tick = () => { const d = window.__drive; if (d.input) { const b = bot(S.state); S.setInput({ ...b, ...d.input, steer: d.input.steer === 'bot' ? b.steer : d.input.steer }); } requestAnimationFrame(tick); };
        tick();
      }, setup.id);
      const drive = (input, ms) => ev(async ({ input, ms }) => { window.__drive.input = input; await new Promise((r) => setTimeout(r, ms)); }, { input, ms });
      if (want("carve")) {
        await drive({ steer: 'bot', tuck: 0, brake: 0, push: 1, jump: false }, 3000);
        await drive({ steer: 1, tuck: 0, brake: 0, push: 0, jump: false }, 600);
        await ev(() => window.__ski.orbit(150, 4.2, 0.9, 45)); await settle(250); await shot("carve");
        await ev(() => window.__ski.orbit(null));
      }
      if (want("stop")) {
        await drive({ steer: 'bot', tuck: 1, brake: 0, push: 1, jump: false }, 3000);
        // R8e: a real hockey stop needs > 25 km/h (SKI.hockeyFrom); slower, the brake is the plough (that was the R8b "stop" shot)
        for (let i = 0; i < 12 && (await ev(() => window.__ski.state.speed)) < 9; i++) await drive({ steer: 'bot', tuck: 1, brake: 0, push: 1, jump: false }, 500);
        const v0 = await ev(() => window.__ski.state.speed * 3.6);
        await drive({ steer: 0.2, tuck: 0, brake: 1, push: 0, jump: false, hard: true }, 2600);
        const v = await ev(() => window.__ski.state.speed * 3.6);
        await ev(() => window.__ski.orbit(200, 4.5, 1.0, 45)); await settle(300); await shot("stop");
        const sk = await ev(() => { const S = window.__ski, e = S.skier.skiEnds(), d = (k) => Math.atan2(k.tip.z - k.tail.z, k.tip.x - k.tail.x); const a = Math.abs(Math.atan2(Math.sin(d(e[0]) - d(e[1])), Math.cos(d(e[0]) - d(e[1])))) * 180 / Math.PI; return { apart: a, st: { hold: S.state.hold, stop: S.state.stop, brake: S.state.brake, edge: S.state.edge, crash: S.state.crash, ride: S.state.ride }, rot: S.skier.debugSkis ? S.skier.debugSkis() : null }; });
        report.push(`${rid}: hockey stop from ${v0.toFixed(0)} km/h, at ${v.toFixed(1)} km/h, skis ${sk.apart.toFixed(0)} deg apart ${JSON.stringify(sk.st)} ${JSON.stringify(sk.rot)}`);
        await ev(() => window.__ski.orbit(null));
      }
      if (want("fp")) {
        // R8b: first person (firstperson.js) carving down the same piste
        await ev(() => { const S = window.__ski; S.game.camPose = null; S.setCamMode('fp'); });
        await drive({ steer: 'bot', tuck: 0, brake: 0, push: 1, jump: false }, 2500);
        await shot("fp");
        await ev(() => window.__ski.setCamMode('chase'));
      }
      await ev(() => { window.__drive.input = null; window.__ski.setInput(null); });
    }
    if (want("drag")) {
      const d = await ev(() => {
        const S = window.__ski, L = S.modes.lifts.list.filter((l) => l.kind === 'drag' && S.lifts.siteOf(l.index).path.sub !== 'rope');
        L.sort((a, b) => Math.abs(a.len - 600) - Math.abs(b.len - 600));
        if (!L[0]) return null;
        const p = S.lifts.siteOf(L[0].index).path;
        const tw = p.supports.filter((t) => t.tower)[Math.floor(p.supports.filter((t) => t.tower).length / 2)];
        if (!tw) return null;
        const qq = p.at(tw.s, {}), sg = p.sign;
        S.place(qq.x - qq.dz * sg * 14, qq.z + qq.dx * sg * 14, 0);
        S.streamer.focus(qq.x, qq.z);
        S.setCamera(qq.x - qq.dz * sg * 18 - qq.dx * 5, qq.z + qq.dx * sg * 18 - qq.dz * 5, 3.0, qq.x, qq.z, 5.5, 50);
        return { name: L[0].name };
      });
      if (d) { await settle(4500); await shot("drag"); await ev(() => window.__ski.setCamera(null)); }
    }
    if (want("map")) {
      // R8b: the piste map over the free ride, the free ride tab (lift list + card, fog, the first-lift button)
      await ev(() => window.__ski.setCamera(null));
      await page.keyboard.press("m");
      await page.waitForSelector("#mapCanvas", { timeout: 20000 }).catch(() => {});
      await page.click('.modetabs [data-mode="freeride"]').catch(() => {});
      await settle(1500);
      const sel = await ev(() => { const r = document.querySelector('.lrow.sel .n'), h = document.querySelector('#modePane h2'); return { row: r ? r.textContent : null, card: h ? h.textContent : null }; });
      report.push(`${rid}: map list ${sel.row} / card ${sel.card}${sel.row && sel.card && sel.card.trim() !== sel.row.trim() ? '  <-- MISMATCH' : ''}`);
      await shot("map");
    }
    report.push(`${rid}: spawn ${spawn.name}, ${errors.length} page errors${errors.length ? ': ' + errors[0] : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(report.join("\n"));
