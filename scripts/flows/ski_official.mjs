/* Flow: Ski Alpen official-map alignment (28 Nov 2026; owner: only the lifts and pistes of the real 2026/27 or 2025/26 piste map).
 * Livigno, Davos, Laax and Sölden: what the data of each resort says after scripts/ski/official_apply.py (read from the page's own
 * resort.json): the pistes that are not on the official map are gone (their ids stay reserved in the cloud index), the colours /
 * numbers of the official map are set, Sölden's rebuilt Mutkogl T-bar is the short one (859 m), Livigno's Planon drag is lift 2.
 * Then Sölden runs with that data: the Mutkogl bottom station stands up the glacier where the new T-bar starts (shot), zero page errors.
 * Shots into $OFFICIAL_SHOTS (default ~/Library/Caches/ski-work/official-maps/shots). FLOW_BROWSER=webkit for Safari's engine. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const SHOTS = process.env.OFFICIAL_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/official-maps/shots");

const GONE = {
  soelden: ["35", "7b", "mini", "abfahrt-zur-pension-waldesru", "22-black", "gaislachalm", "gaislachalm-2", "gaislachalm-3", "gaislachalm-variante"],
  laax: ["laax-46", "laax-80", "laax-62-inoffiziell"],
  davos: ["5a-rennpiste"],
  livigno: ["stambecco", "freeride-cross", "ski-cross", "genziana", "cervo", "gipeto", "bambi", "crocifisso", "lepre", "volpe", "nera-red"],
  killy: ["grand-stade", "stade-de-lognan-competitions"],
  "3vallees": ["bleue", "bleue-2", "chemin-facile", "sainte-agathe"],
};
const COLOUR = {
  livigno: { canalino: "black", kl: "red" },
  killy: { "mangard-blue": "red", "melezes-blue": "red", "traversee-du-rogoney-red": "blue" },
  "3vallees": { "roches-grises": "black", "freeride-lab": "red", "pralong-green": "blue", "variante-blue": "red" },
  laax: { "nagens-alp-nagens": "red", "siala-west-blue": "black", "sogn-martin-plaun-black": "blue", "nagens-sogn-martin-plaun": "red" },
  davos: { verbindungsweg: "red", "brama-rot-blue": "red", "rinerhorn-11": "red", "rinerhorn-11-variante": "red" },
};

export const flow = {
  name: "ski-official",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    h.step("the data of the four resorts follows the official maps");
    await h.goto("/pb/ski.html?debug=1&q=low");
    const rows = await page.evaluate(async (rids) => {
      const out = {};
      for (const rid of rids) {
        const r = await (await fetch(`/pb/ski/data/${rid}/resort.json`)).json();
        out[rid] = { pistes: r.pistes.map((p) => [p.id, p.diff, p.ref, p.name]), lifts: r.lifts.map((l) => [l.name, l.ref, l.len, l.seats, l.pts.length]) };
      }
      return out;
    }, Object.keys(GONE));
    for (const [rid, ids] of Object.entries(GONE)) {
      const have = new Set(rows[rid].pistes.map((p) => p[0]));
      for (const id of ids) h.expect(!have.has(id), `${rid}: ${id} is not on the official map and is gone`);
      for (const [id, col] of Object.entries(COLOUR[rid] || {})) {
        const p = rows[rid].pistes.find((q) => q[0] === id);
        h.eq(p && p[1], col, `${rid}: ${id} has the colour of the official map`);
      }
    }
    const nm = (rid, id) => (rows[rid].pistes.find((q) => q[0] === id) || [])[3];
    h.eq(nm("killy", "savonnette"), "Savonette", "Killy: Savonette carries the name of the map");
    h.eq(nm("3vallees", "goitschel"), "Marielle Goitschel", "3 Vallées: Marielle Goitschel carries the official name");
    h.eq(nm("3vallees", "arolles-black"), "Arolle", "3 Vallées: the black Arolle is no longer called Arolles");
    const mut = rows.soelden.lifts.find((l) => l[0] === "Mutkogl");
    h.expect(mut && mut[2] === 859, `Sölden: the rebuilt Mutkogl T-bar is 859 m (${mut && mut[2]})`);
    const planon = rows.livigno.lifts.find((l) => l[0] === "Planon Skilift");
    h.eq(planon && planon[1], "2", "Livigno: the Planon drag is lift 2 of the official map");
    const dav = Object.fromEntries(rows.davos.pistes.map((p) => [p[0], p]));
    h.eq(dav["usser-isch"][2], "7", "Davos: Usser Isch (black) carries its official number 7");
    h.eq(dav.bobbahnstrasse[3], "Blo 5", "Davos: Schatzalp - Davos Dorf is piste 5 of the Schatzalp map");

    h.step("Sölden runs with the new data: the Mutkogl T-bar starts up the glacier");
    await h.goto("/pb/ski.html?resort=soelden&go=1&debug=1&q=low");
    await page.waitForFunction(() => window.__ski && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });
    const m = await page.evaluate(async () => {
      const r = await (await fetch("/pb/ski/data/soelden/resort.json")).json();
      const l = r.lifts.find((q) => q.name === "Mutkogl");
      const k = window.__ski, b = l.bottom, t = l.top;
      const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
      k.streamer.focus(b.x, b.z);
      k.placeHold(b.x - (dx / d) * 14, b.z - (dz / d) * 14, Math.atan2(dz, dx));
      k.setCamera(b.x - (dx / d) * 40 - (dz / d) * 18, b.z - (dz / d) * 40 + (dx / d) * 18, b.y + 12, b.x + (dx / d) * 30, b.z + (dz / d) * 30, b.y + 4, 60);
      return { x: b.x, z: b.z, y: b.y };
    });
    await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1", null, { timeout: 150000 }).catch(() => {});
    await h.pause(3000);
    await page.screenshot({ path: path.join(SHOTS, `soelden-mutkogl-bottom.${process.env.FLOW_BROWSER || "chromium"}.png`) });
    h.expect(Number.isFinite(m.y), `Mutkogl bottom station at ${Math.round(m.x)}, ${Math.round(m.z)}, ${m.y} m`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
