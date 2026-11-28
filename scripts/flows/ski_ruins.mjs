/* Flow: Ski Alpen lift ruins (28 Nov 2026). Via Lattea, the Moncrons sector above Sauze d'Oulx: the closed lifts (Sciovia Moncrons,
 * Chardonet, Scoiattolo, Costapiana: OSM abandoned) stand as ruins: pylons and huts drawn (pb/ski/ruins.js), solid (the skier is pushed
 * out), no boarding button, not in the lift list, one more merged mesh at most (draw calls +1..2). Another resort (Davos) has ruins too.
 * Shots into $RUINS_SHOTS (default ~/Library/Caches/ski-work/ruins). Zero page errors. FLOW_BROWSER=webkit for Safari's engine. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const SHOTS = process.env.RUINS_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/ruins");

export const flow = {
  name: "ski-ruins",
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
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.${process.env.FLOW_BROWSER || "chromium"}.png`) });
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });
    /** The point at arc length s of the ruin whose name matches (data from ruins.json), its direction, its pylons. */
    async function at(pattern, s) {
      return page.evaluate(async ([pat, s]) => {
        const k = window.__ski, root = `/pb/ski/data/${new URLSearchParams(location.search).get("resort")}/`;
        const rows = await (await fetch(root + "ruins.json")).json();
        const r = rows.find((q) => new RegExp(pat, "i").test(q.name)) || rows[0];
        const pts = r.pts; let acc = 0, i = 2;
        for (; i < pts.length; i += 2) { const d = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); if (acc + d >= s) break; acc += d; }
        i = Math.min(i, pts.length - 2);
        const dx = pts[i] - pts[i - 2], dz = pts[i + 1] - pts[i - 1], l = Math.hypot(dx, dz) || 1, u = Math.min(1, (s - acc) / l);
        const x = pts[i - 2] + dx * u, z = pts[i - 1] + dz * u;
        k.streamer.focus(x, z);
        return { x, z, dx: dx / l, dz: dz / l, name: r.name, pts: r.pts, pylons: r.pylons, len: r.len, bottom: r.bottom, top: r.top };
      }, [pattern, s]);
    }
    const settle = async () => {
      await page.waitForFunction(() => window.__ski.ruins && window.__ski.ruins.builtCells >= 1, null, { timeout: 60000 }).catch(() => {});
      await h.pause(2500);
    };
    const view = async (pat, s, back, side, up, name, ahead = 40) => {
      const q = await at(pat, s);
      await page.evaluate(([q, back, side, up, ahead]) => {
        const k = window.__ski;
        k.placeHold(q.x - q.dx * back, q.z - q.dz * back, Math.atan2(q.dz, q.dx));
        k.setCamera(q.x - q.dx * back - q.dz * side, q.z - q.dz * back + q.dx * side, up, q.x + q.dx * ahead, q.z + q.dz * ahead, 4, 60);
      }, [q, back, side, up, ahead]);
      await settle();
      await shot(name);
    };

    h.step("Via Lattea: the Moncrons ruins are there, solid, not a lift");
    await h.goto("/pb/ski.html?resort=vialattea&go=1&debug=1&q=low");
    await running();
    await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1", null, { timeout: 150000 }).catch(() => {});
    await page.waitForFunction(() => window.__ski.ruins, null, { timeout: 60000 }).catch(() => {});
    const info = await page.evaluate(() => { const k = window.__ski; return { ruins: k.ruins ? k.ruins.stats : null, lifts: k.modes.lifts.list.length, names: k.modes.lifts.list.map((l) => l.name) }; });
    h.expect(info.ruins && info.ruins.ruins >= 5 && info.ruins.pylons > 20 && info.ruins.huts > 4, `ruins built: ${JSON.stringify(info.ruins)}`);
    h.expect(!info.names.some((n) => /Moncrons|Chardonet|Scoiattolo|Costapiana/i.test(n)), `none of the 4 closed Moncrons lifts is a rideable lift (${info.lifts} lifts)`);
    const p0 = await at("Moncrons", 420);
    h.eq(p0.name, "Sciovia Moncrons (abbandono)", "found the Moncrons ruin");
    await page.evaluate((p) => { window.__ski.placeHold(p.x + 14, p.z + 6, Math.atan2(-6, -14)); }, p0);
    await settle();
    const st1 = await page.evaluate(() => { const k = window.__ski; return { cells: k.ruins.builtCells, liftBtn: !document.getElementById("liftBtn").hidden, boarding: !!k.modes.liftAt }; });
    h.expect(st1.cells >= 1, `${st1.cells} ruin cell(s) built near the player`);
    h.expect(!st1.liftBtn && !st1.boarding, "no boarding button / zone at the ruins");
    const calls = await page.evaluate(async () => {
      const k = window.__ski, wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await wait();
      const on = k.info().calls; k.ruins.group.visible = false; await wait(); await wait(); const off = k.info().calls; k.ruins.group.visible = true; await wait();
      return { on, off };
    });
    h.expect(calls.on - calls.off >= 0 && calls.on - calls.off <= 2, `draw calls ${calls.off} -> ${calls.on} with the ruins (budget +2)`);
    // a pylon (the first of the line's pylons) is solid and pushes out; the bottom hut too, also through the skier's world.hit
    const col = await page.evaluate((p) => {
      const k = window.__ski, s = p.pylons[3];
      let acc = 0, i = 2;
      for (; i < p.pts.length; i += 2) { const d = Math.hypot(p.pts[i] - p.pts[i - 2], p.pts[i + 1] - p.pts[i - 1]); if (acc + d >= s) break; acc += d; }
      const dx = p.pts[i] - p.pts[i - 2], dz = p.pts[i + 1] - p.pts[i - 1], l = Math.hypot(dx, dz), u = (s - acc) / l;
      const x = p.pts[i - 2] + dx * u, z = p.pts[i - 1] + dz * u, g = k.surface.height(x, z);
      const hit = k.ruins.hit(x + 0.3, z, 0.5, g), far = k.ruins.hit(x + 6, z + 6, 0.5, g), over = k.ruins.hit(x, z, 0.5, g + 30);
      const hut = k.world.hit(p.bottom.x, p.bottom.z, 0.5, k.surface.height(p.bottom.x, p.bottom.z));
      return { pylon: hit ? { pen: hit.pen } : null, far: !!far, over: !!over, hut: !!hut };
    }, p0);
    h.expect(col.pylon && col.pylon.pen > 0 && !col.far && !col.over, `a pylon is solid (${JSON.stringify(col.pylon)}), free 6 m away, free 30 m above it`);
    h.expect(col.hut, "the bottom hut is solid through the skier's world.hit");
    await view("Moncrons", 420, 30, 12, 4, "moncrons-line");
    await view("Moncrons", 0, -14, 8, 2.5, "moncrons-hut", 0);
    await view("Moncrons", 300, 130, 45, 28, "moncrons-far", 220);
    await view("Chardonet", 600, 45, 18, 7, "chardonet-line", 60);
    await page.evaluate(() => window.__ski.setCamera(null));

    h.step("Davos has ruins too");
    await h.goto("/pb/ski.html?resort=davos&go=1&debug=1&q=low");
    await running();
    await page.waitForFunction(() => window.__ski.ruins, null, { timeout: 150000 }).catch(() => {});
    const dv = await page.evaluate(() => (window.__ski.ruins ? window.__ski.ruins.stats : null));
    h.expect(dv && dv.ruins >= 1, `Davos ruins ${JSON.stringify(dv)}`);
    await view("Strelagrat", 400, 35, 14, 5, "davos-strelagrat", 50);
    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
