/* Flow: Lux Drive "the world" (pb/lux-drive.html).
 * The game boots with no console errors, the baked data stays inside the budget of the brief (30 MB), the car starts at Place de l'Europe
 * (Kirchberg), it drives, the camera never goes under the ground and the draw calls / triangles stay inside the budget of the quality levels. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/lux-drive.html?q=medium&time=noon&weather=clear";
const DATA_BUDGET = 30 * 1024 * 1024;
const BUDGET = { low: { calls: 140, tris: 330000 }, medium: { calls: 200, tris: 520000 }, high: { calls: 240, tris: 900000 } };

async function boot(h, url = PAGE) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 180000 });
  await h.pause(1500);
  await h.page.click('[data-act="drive"]');        // close the menu: the shots must show the world, not the panel
  await h.pause(600);
}

export const flow = {
  name: "luxdrive-world",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },          // an iPad in landscape: the game is played in landscape
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    h.step("boot /pb/lux-drive.html: the world loads, no boot error, no console errors");
    await boot(h);
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    h.eq(errors, [], "zero console errors while booting");

    const info = await page.evaluate(() => {
      const m = window.__lux;
      const bytes = performance.getEntriesByType("resource").filter((e) => /\/pb\/lux-drive\/data\//.test(e.name)).reduce((s, e) => s + (e.encodedBodySize || e.decodedBodySize || 0), 0);
      const s = m.state();
      return { bytes, x: s.x, z: s.z, tiles: m.terrain.stats.leaves, calls: m.stats().calls, tris: m.stats().triangles, y: s.y, ground: m.ground.height(s.x, s.z) };
    });
    h.expect(info.bytes > 5e6 && info.bytes <= DATA_BUDGET, `baked data ${(info.bytes / 1048576).toFixed(2)} MB (<= 30 MB)`);
    h.expect(info.tiles > 40, `${info.tiles} terrain tiles`);
    h.expect(Math.abs(info.x - 5905.76) < 30 && Math.abs(info.z - 7999.2) < 30, `the car starts at Place de l'Europe (${info.x.toFixed(0)}, ${info.z.toFixed(0)})`);
    h.expect(info.y >= info.ground - 0.01 && info.y <= info.ground + 1.2, `the car stands on the ground (${info.y.toFixed(2)} vs ${info.ground.toFixed(2)})`);
    await h.shot("boot");

    h.step("the car drives: the throttle moves it forward on the road");
    const drive = await page.evaluate(async () => {
      const m = window.__lux;
      const before = { x: m.state().x, z: m.state().z };
      m.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      await new Promise((r) => setTimeout(r, 3000));
      const s = m.state();
      const after = { x: s.x, z: s.z, speed: s.speed, onRoad: s.onRoad, surface: s.surface };
      m.setInput(null);
      return { before, after, moved: Math.hypot(after.x - before.x, after.z - before.z) };
    });
    h.expect(drive.moved > 8, `the car drove ${drive.moved.toFixed(1)} m`);
    h.expect(drive.after.speed > 3, `the car is rolling at ${(drive.after.speed * 3.6).toFixed(0)} km/h`);
    h.expect(drive.after.onRoad, `the car is on the tarmac (${drive.after.surface})`);

    h.step("the camera never goes under the ground");
    const cam = await page.evaluate(async () => {
      const m = window.__lux;
      let worst = 1e9;
      for (let i = 0; i < 60; i++) {
        m.setInput({ throttle: 1, brake: 0, steer: (i % 30 < 15 ? 0.4 : -0.4), handbrake: false });
        await new Promise((r) => requestAnimationFrame(r));
        const c = m.camera.position;
        worst = Math.min(worst, c.y - m.ground.height(c.x, c.z));
      }
      m.setInput(null);
      return worst;
    });
    h.expect(cam > 0.3, `the camera stayed ${cam.toFixed(2)} m above the ground`);

    h.step("draw calls and triangles stay inside the budget at low / medium / high");
    for (const q of ["low", "medium", "high"]) {
      await boot(h, `/pb/lux-drive.html?q=${q}&time=noon&weather=clear`);
      const s = await page.evaluate(async () => {
        const m = window.__lux;
        await new Promise((r) => setTimeout(r, 1500));
        return { calls: m.stats().calls, tris: m.stats().triangles, q: m.quality().id };
      });
      h.eq(s.q, q, `quality ${q} selected`);
      h.expect(s.calls > 5 && s.calls <= BUDGET[q].calls, `${q}: ${s.calls} draw calls (<= ${BUDGET[q].calls})`);
      h.expect(s.tris > 10000 && s.tris <= BUDGET[q].tris, `${q}: ${s.tris} triangles (<= ${BUDGET[q].tris})`);
      await h.shot("quality-" + q);
    }

    h.eq(errors, [], "zero console errors in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
