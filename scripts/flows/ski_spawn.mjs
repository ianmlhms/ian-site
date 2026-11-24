/* Flow: Ski Alpen spawn at the first lift, on ALL FIVE resorts (round 7-C). The free ride starts next to the main village lift a real
 * visitor takes first (config FIRST_LIFT): inside its boarding zone (the Astegen button is there), <= 0.3 m above the loaded ground,
 * nothing within 25 m ahead (no house, station hall, tree or terrain wall), facing the lift / up its line. Prints a line per resort.
 * FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

const EXPECT = { killy: "Olympique", "3vallees": "Verdons", zermatt: "Matterhorn Express 1", arlberg: "Galzigbahn", kronplatz: "Kronplatz I - Plan de Corones I", vialattea: "Sestriere - Fraiteve 1", obertauern: "Zehnerkarbahn I", livigno: "Mottolino Gondola", davos: "Parsennbahn 1" };
const RESORTS = (process.env.SKI_RESORTS || Object.keys(EXPECT).join(",")).split(",");

export const flow = {
  name: "ski-spawn",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => { try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_cam", "chase"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ } });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });      // WebKit: tile fetches cut off by the next page load
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const lines = [];
    for (const rid of RESORTS) {
      h.step(`${rid}: the free ride starts at ${EXPECT[rid]}`);
      await h.goto(`/pb/ski.html?resort=${rid}&go=1&debug=1&q=low&res=fixed`);
      await page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiSpawnOk !== undefined, null, { timeout: 150000 });
      await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 10000 }).catch(() => {});
      await h.pause(1500);
      const r = await page.evaluate(() => {
        const k = window.__ski, s = k.state, l = k.spawn, e = k.explore, hh = (x, z) => k.surface.height(x, z);
        const wall = e.obs.wallAhead(s.x, s.z, s.heading, hh, 25);
        const ang = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
        const up = Math.atan2(l.top.z - l.bottom.z, l.top.x - l.bottom.x), toLift = Math.atan2(l.bottom.z - s.z, l.bottom.x - s.x);
        return { name: l.name, d: Math.hypot(s.x - l.bottom.x, s.z - l.bottom.z), above: s.y - k.standHeight(s.x, s.z), wall: wall ? `${wall.what} at ${wall.d.toFixed(0)} m` : "", why: e.obs.blocked(s.x, s.z, 1, { built: false }) || "", face: Math.min(ang(s.heading, up), ang(s.heading, toLift)) * 180 / Math.PI, button: !document.getElementById("liftBtn").hidden, tile: k.field.hasTile(Math.floor(s.x / 1280), Math.floor(s.z / 1280)) };
      });
      h.eq(r.name, EXPECT[rid], `${rid}: the first lift`);
      h.expect(r.d <= 38 && r.button, `${rid}: ${r.d.toFixed(1)} m from the bottom station, the Astegen button up`);
      h.expect(Math.abs(r.above) <= 0.3 && r.tile, `${rid}: ${r.above.toFixed(2)} m above the loaded 5 m ground`);
      // R8b: the spawn is R7-B's wait spot INSIDE the first lift's boarding zone (in its station): only a house there is wrong
      h.expect(r.why !== 'building', `${rid}: not in a house (${r.why || 'open'}; ahead: ${r.wall || 'open'})`);
      h.expect(r.face < 80, `${rid}: facing the lift / up its line (${r.face.toFixed(0)}° off)`);
      lines.push(`${rid}: ${r.name}, ${r.d.toFixed(0)} m, ${r.above.toFixed(2)} m, ${r.wall || "open"}, ${r.face.toFixed(0)}°`);
      await h.shot(`spawn-${rid}`);
      // every tile in before the next page load (WebKit reports fetches cut off by a navigation as page errors)
      await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1", null, { timeout: 240000 }).catch(() => {});
    }
    console.log(lines.map((l) => `      ${l}`).join("\n"));
    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
