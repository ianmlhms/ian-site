/* Flow: MTB Mëllerdall W3 "Trails". The reference rider finishes ALL SIX trails inside the real game loop; every finish earns a medal, saves the best time and the ghost and unlocks
 * the next trail (and the bikes at 3 / 8 / 14 medal points); a locked trail does not start; the save survives a reload and a merge with a cloud copy. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear";
const ORDER = ["ernz-waldwee", "hallerbach-flow", "schiessentuempel", "binzelt-rocks", "waschbrunnen-black", "maratoun"];
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });

export const flow = {
  name: "mtb-trails",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await h.goto(PAGE);
    await ready(page);
    await page.evaluate(() => { window.__mtb.stop(); });

    h.step("a locked trail does not start; the first one is open");
    const locked = await page.evaluate(() => { const m = window.__mtb; m.enterCard("maratoun"); m.startRun(); return { mode: m.game.mode, locked: m.menuData().trails.map((t) => t.locked) }; });
    h.eq(locked, { mode: "card", locked: [false, true, true, true, true, true] }, "the Marathon is locked and only the first trail is open");

    h.step("the reference rider finishes every trail in the real game loop; each finish unlocks the next trail");
    const results = [];
    for (const id of ORDER) {
      const r = await page.evaluate(async (trailId) => {
        const { createBot } = await import("/pb/mtb/bot.js");
        const m = window.__mtb;
        m.enterCard(trailId);
        const t = m.trail;
        m.startRun();
        const bot = createBot(t.centre.slice(0, t.arch.index + 4), t.grade);
        let frames = 0;
        const events = [];
        while (m.game.mode !== "finished" && frames < 60 * 3600) {
          const inp = m.game.mode === "run" ? bot.input(m.bike) : { throttle: 0, brake: 0, steer: 0, jump: false };
          m.tick(1 / 60, inp);
          frames++;
        }
        const md = m.menuData();
        return { id: trailId, mode: m.game.mode, ms: m.game.result && m.game.result.ms, medal: m.game.result && m.game.result.medal, crashes: m.game.crashes, rescues: m.game.rescues, cps: m.game.splits.length, cpTotal: t.cps.length,
          locked: md.trails.map((x) => x.locked), points: md.points, bikes: md.bikes.map((b) => !b.locked), ghostChars: (m.progress.g[trailId] || "").length, best: md.trails.find((x) => x.trail.id === trailId).bestMs, medalSaved: md.trails.find((x) => x.trail.id === trailId).medal };
      }, id);
      results.push(r);
      h.expect(r.mode === "finished" && r.ms > 100000, `${id}: finished in ${(r.ms / 1000).toFixed(0)} s, medal ${r.medal}, ${r.crashes} crashes, ${r.rescues} rescues`);
      h.expect(r.cps === r.cpTotal && r.medal >= 1 && r.medalSaved === r.medal && r.best === r.ms, `${id}: ${r.cps}/${r.cpTotal} checkpoints, medal and best time stored`);
      const i = ORDER.indexOf(id);
      if (i < ORDER.length - 1) h.expect(r.locked[i + 1] === false, `${id}: the next trail is unlocked now`);
    }
    const last = results[results.length - 1];
    h.expect(last.points >= 6 && last.points <= 18, `${last.points} medal points after six trails`);
    h.expect(last.bikes[0] && last.bikes[1] === last.points >= 3 && last.bikes[2] === last.points >= 8 && last.bikes[3] === last.points >= 14, `bikes unlock at 3 / 8 / 14 points (${last.bikes.join(",")} at ${last.points})`);
    const ghosts = await page.evaluate(() => Object.fromEntries(Object.entries(window.__mtb.progress.g).map(([k, v]) => [k, v.length])));
    h.expect(Object.keys(ghosts).length <= 3 && Object.values(ghosts).every((n) => n > 100 && n < 1800), `at most three ghosts are kept, each stored in under 1800 characters (${JSON.stringify(ghosts)})`);

    h.step("the save is small, survives a reload and merges with a cloud copy without losing progress");
    const saved = await page.evaluate(() => { window.__mtb.persistence.pushSave(); const raw = localStorage.getItem("pb_mtb_save") || ""; return { bytes: new TextEncoder().encode(raw).length, medals: JSON.parse(raw).m }; });
    h.expect(saved.bytes > 100 && saved.bytes < 7000, `save is ${saved.bytes} bytes (limit 7000 JSON, 8192 jsonb)`);
    await h.goto(PAGE);
    await ready(page);
    const after = await page.evaluate(() => { const m = window.__mtb; return { medals: m.progress.m, best: m.progress.b, locked: m.menuData().trails.map((t) => t.locked), trail: m.trail.id }; });
    h.eq(after.medals, saved.medals, "medals survive a reload");
    h.expect(after.locked.every((l) => !l), "all trails stay unlocked after the reload");
    // a cloud copy with fewer medals and a faster first time: the merge keeps the best of both
    const merged = await page.evaluate(async () => {
      const m = window.__mtb;
      const before = m.progress;
      const cloud = { ...before, m: "100000", b: "1,,,,,", tb: 1000 };
      m.persistence.applyIncoming(cloud);
      await new Promise((r) => setTimeout(r, 400));
      return { medals: m.progress.m, firstBest: m.progress.b.split(",")[0], was: before.b.split(",")[0] };
    });
    h.eq(merged.medals, saved.medals, "a cloud save with fewer medals never lowers the medals");
    h.expect(merged.firstBest !== "" && parseInt(merged.firstBest, 36) <= parseInt(merged.was, 36), "the faster best time wins in the merge");

    h.step("the ghost of the best run rides along on the next attempt");
    const ghost = await page.evaluate(async () => {
      const { createBot } = await import("/pb/mtb/bot.js");
      const m = window.__mtb;
      m.enterCard("ernz-waldwee"); m.startRun();
      const t = m.trail; const bot = createBot(t.centre.slice(0, t.arch.index + 4), t.grade);
      let frames = 0; let visibleAt = -1;
      while (m.game.mode !== "finished" && frames < 60 * 900) {
        const inp = m.game.mode === "run" ? bot.input(m.bike) : { throttle: 0, brake: 0, steer: 0, jump: false };
        m.tick(1 / 60, inp);
        frames++;
      }
      return { done: m.game.mode === "finished", beat: m.game.result && m.game.result.beatGhost, ms: m.game.result && m.game.result.ms };
    });
    h.expect(ghost.done, `the second ride of the first trail finishes (${(ghost.ms / 1000).toFixed(1)} s, ghost ${ghost.beat ? "beaten" : "not beaten"})`);
    h.eq(errors, [], "zero console errors");
  },
};

runIfMain(import.meta.url, flow);
