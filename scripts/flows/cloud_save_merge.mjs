/* Regression test for the hub's cloud-save hand-over (pixelbreak-records.js: __pbWantSave / __pbLoadSave / game_saves upsert).
 * Progress must never go down: the local save, the page, the cloud row and every write to game_saves.
 * Scenarios, for each idle game: cloud newer than local, local newer than cloud, local empty, cloud empty,
 * two devices alternating, signed out. Test mode (owner) is covered by the test-mode flow.
 * The mocked game_saves table behaves like the real one: a write with lower progress is refused. */
import { runIfMain } from "./lib.mjs";

const GAMES = {
  "cookie-clicker": { read: (s) => s.tb, make: (p) => ({ v: 1, c: 0, tb: p, tc: 0, rb: p, st: 0, rbc: 0, gd: "", rs: 0, savedAt: Date.now(), u: [], cu: [], giftIds: [] }) },
  "idle-empire": { read: (s) => s.lifetime, make: (p) => ({ v: 1, cash: 10, lifetime: p, rb: p, st: 0, rbc: 0, gd: "", sc: 0, rs: 0, owned: {}, managers: {}, investors: 0, giftIds: [], ts: Date.now(), savedAt: Date.now() }) },
  "bus-tycoon": { read: (s) => s.tb, make: (p) => ({ v: 1, p: 0, tb: p, rb: p, st: 0, rbc: 0, gd: "", rs: 0, savedAt: Date.now(), owned: {}, upgrades: [], drivers: 0, giftIds: [] }) },
};
let cloud = null, writes = [], currentGame = "";
const progressOf = (save) => (save ? GAMES[currentGame].read(save) : 0);

export const flow = {
  name: "cloud-save-merge",
  touch: false,
  backend: {
    rpc: { touch_streak: () => ({ streak: 1, best: 1, is_new_day: false }) },
    tables: {
      game_saves: ({ method, body }) => {
        if (method === "GET") return cloud ? [{ data: cloud }] : [];
        const row = Array.isArray(body) ? body[0] : body;
        if (row && row.data) {
          writes.push(progressOf(row.data));
          if (progressOf(row.data) >= progressOf(cloud)) cloud = row.data;   // the keep-progress trigger refuses lower saves
        }
        return [];
      },
    },
  },
  async run(h) {
    const { page } = h;
    const localOf = () => page.evaluate((id) => JSON.parse(localStorage.getItem("pb_save_" + id) || "null"), currentGame);
    async function play(label, { local, cloudP, signedIn = true, repeat = 1 }) {
      for (let i = 0; i < repeat; i++) {
        cloud = cloudP == null ? null : GAMES[currentGame].make(cloudP);
        writes = [];
        const before = Math.max(local ?? 0, cloudP ?? 0);
        await h.goto("/pixelbreak.html");
        await page.evaluate(([id, save]) => { if (save) localStorage.setItem("pb_save_" + id, JSON.stringify(save)); else localStorage.removeItem("pb_save_" + id); }, [currentGame, local == null ? null : GAMES[currentGame].make(local)]);
        await h.goto("/pixelbreak.html?g=" + currentGame);
        await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document.body?.innerText.length > 50);
        await h.pause(5200);                       // game boots, asks for the cloud save, saves; the hub flushes after 3 s
        const after = progressOf(await localOf());
        const tag = `${currentGame} ${label}${repeat > 1 ? " #" + (i + 1) : ""}`;
        h.expect(after >= before, `${tag}: local progress ${after} >= ${before}`);
        h.expect(writes.every((w) => w >= progressOf(cloud) || w >= before || signedIn === false), `${tag}: no write lowers the cloud`);
        h.expect(progressOf(cloud) >= (signedIn ? before : (cloudP ?? 0)), `${tag}: cloud row ${progressOf(cloud)} did not go down`);
        if (!signedIn) h.expect(h.backend.callsTo("game_saves").length === 0, `${tag}: signed out makes no game_saves call`);
      }
    }
    for (const id of Object.keys(GAMES)) {
      currentGame = id;
      h.step(id);
      await h.signIn();
      await play("cloud newer than local", { local: 1e3, cloudP: 1e6, repeat: 3 });
      await play("local newer than cloud", { local: 1e6, cloudP: 1e3, repeat: 2 });
      await play("local empty", { local: null, cloudP: 5e5, repeat: 2 });
      await play("cloud empty", { local: 5e5, cloudP: null, repeat: 2 });
      // two devices: A and B alternate; each reopen starts from what the other device left in the cloud
      await play("device A (1e3/1e3)", { local: 1e3, cloudP: 1e3 });
      await play("device B pushed 4e6", { local: 1e3, cloudP: 4e6 });
      await play("device A played offline to 9e6", { local: 9e6, cloudP: 4e6 });
      await play("device B reopens, cloud 9e6, local 4e6", { local: 4e6, cloudP: 9e6 });
    }
    // signed out: a fresh context without a session
    h.step("signed out");
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k); });
    await h.goto("/about.html");   // the signed-in game page must not keep saving
    h.backend.calls.length = 0;
    currentGame = "cookie-clicker";
    const ctx = await page.context().newPage();
    await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k); } catch { /* about:blank */ } });
    await ctx.goto(h.origin + "/pixelbreak.html");
    await ctx.evaluate((s) => localStorage.setItem("pb_save_cookie-clicker", JSON.stringify(s)), GAMES["cookie-clicker"].make(7e5));
    await ctx.goto(h.origin + "/pixelbreak.html?g=cookie-clicker");
    await ctx.waitForTimeout(5000);
    const out = await ctx.evaluate(() => JSON.parse(localStorage.getItem("pb_save_cookie-clicker") || "null"));
    h.expect(out && out.tb >= 7e5, "signed out: local save kept (" + (out && out.tb) + ")");
    h.expect(h.backend.callsTo("game_saves").length === 0, "signed out: no game_saves request");
    await ctx.close();
  },
};
runIfMain(import.meta.url, flow);
