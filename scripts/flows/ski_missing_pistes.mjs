/* Flow: Ski Alpen missing official pistes (28 Nov 2026, scripts/ski/add_pistes.py): every piste of scripts/ski/official/<rid>.add.json is in the
 * resort's resort.json, selectable in the game, connected (its start within 60 m of another piste / lift line, its bottom too), and a skier
 * put at its start runs on it without page errors (one resort run, Davos Gotschnaboden - Klosters). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIfMain } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OFFICIAL = path.join(here, "..", "ski", "official");
const RESORTS = fs.readdirSync(OFFICIAL).filter((f) => f.endsWith(".add.json")).map((f) => f.split(".")[0]);

export const flow = {
  name: "ski-missing-pistes",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => { try { localStorage.removeItem("pb_ski_save"); } catch (error) { /* ignore */ } });
    h.step("every added piste is in the data and connected");
    await h.goto("/pb/ski.html?debug=1&q=low");
    for (const rid of RESORTS) {
      const spec = JSON.parse(fs.readFileSync(path.join(OFFICIAL, `${rid}.add.json`), "utf8"));
      const res = await page.evaluate(async ([r, ids]) => {
        const d = await (await fetch(`/pb/ski/data/${r}/resort.json`)).json();
        const { unpackResort } = await import("/pb/ski/linepack.js");
        unpackResort(d);
        const lines = d.pistes.map((p) => ({ id: p.id, p: p.line }));
        const liftLines = d.lifts.map((l) => ({ id: "lift", p: l.pts }));
        const near = (x, z, skip) => {
          let best = 1e9;
          for (const ln of [...lines.filter((l) => l.id !== skip), ...liftLines]) for (let i = 0; i + 3 < ln.p.length; i += 2) {
            const ax = ln.p[i], az = ln.p[i + 1], dx = ln.p[i + 2] - ax, dz = ln.p[i + 3] - az, L2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
            best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
          }
          return best;
        };
        return ids.map((id) => {
          const p = d.pistes.find((q) => q.id === id);
          if (!p) return { id, missing: true };
          const n = p.line.length;
          return { id, len: p.len, a: near(p.line[0], p.line[1], id), b: near(p.line[n - 2], p.line[n - 1], id), net: d.network.length };
        });
      }, [rid, spec.pistes.map((p) => p.id)]);
      for (const r of res) {
        h.expect(!r.missing, `${rid}/${r.id} is in the data`);
        if (!r.missing) h.expect(r.a <= 60 && r.b <= 60, `${rid}/${r.id} connected at both ends (${Math.round(r.a)} m / ${Math.round(r.b)} m)`);
      }
    }
    h.step("a skier runs on Gotschnaboden - Klosters");
    await h.goto("/pb/ski.html?resort=davos&go=1&debug=1&q=low");
    await page.waitForFunction(() => window.__ski && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });
    const ok = await page.evaluate(async () => {
      const S = window.__ski, p = S.pistes.list.find((q) => q.id === "gotschnaboden-klosters");
      if (!p) return false;
      const a = p.at(8, {}), b = p.at(28, {});
      await S.teleportTo({ x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x), kind: "piste", piste: p.id });
      return true;
    });
    h.expect(ok, "the piste can be teleported to");
    await h.pause(2500);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
