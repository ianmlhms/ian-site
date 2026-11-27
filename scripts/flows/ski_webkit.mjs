/* Flow: Ski Alpen in WebKit (Safari / the school iPads) AND Chromium, every resort (round 7 A).
 *
 *   FLOW_BROWSER=webkit python3 ~/Library/Caches/browser-slot.py node scripts/flows/ski_webkit.mjs      (WebKit)
 *   python3 ~/Library/Caches/browser-slot.py node scripts/flows/ski_webkit.mjs                          (the same checks in Chromium)
 *
 * Per resort, straight into the free ride (the resort's first lift) at Mëttel: no page / console error, no shader that failed to compile,
 * no WebGL error, the picture is drawn (many colours, the safety net of main.js did not have to step in), the snow has its detail (the
 * lower part of the picture is not one flat colour), the sky is not one flat colour either, the skier stands on the loaded ground, the
 * free look turns the camera without turning the skier, and a screenshot per resort (ski-webkit-<engine>-<resort>.png) to compare
 * the engines side by side. Frame rate is only printed. */
import { runIfMain } from "./lib.mjs";

const RESORTS = (process.env.SKI_RESORTS || "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos,laax,soelden").split(",");
const MIN_COLOURS = 40;

export const flow = {
  name: "ski-webkit",
  fullChromium: true,
  viewport: { width: 1080, height: 810 },
  async run(h) {
    const { page } = h;
    const engine = process.env.FLOW_BROWSER === "webkit" ? "webkit" : "chromium";
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    for (const rid of RESORTS) {
      h.step(`${engine} · ${rid}: boot into the free ride at Mëttel, the picture is the real look`);
      errors.length = 0;
      await h.goto(`/pb/ski.html?go=1&debug=1&q=medium&weather=sun&time=midday&resort=${rid}`);
      await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" || document.documentElement.dataset.bootError, null, { timeout: 300000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${rid}: no boot error`);
      await page.waitForTimeout(6000);
      const pic = await page.evaluate(() => {
        const S = window.__ski, gl = S.renderer.getContext(), c = document.getElementById("skiCanvas");
        S.post.render(S.scene, S.camera);
        const k = document.createElement("canvas"); k.width = 120; k.height = 90;
        const g = k.getContext("2d"); g.drawImage(c, 0, 0, 120, 90);
        const d = g.getImageData(0, 0, 120, 90).data, set = new Set();
        const lum = (i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        let sb = 0, sb2 = 0, nb = 0, st = 0, st2 = 0, nt = 0;
        for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) {
          const i = (y * 120 + x) * 4; set.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
          const L = lum(i);
          if (y > 60) { sb += L; sb2 += L * L; nb++; } else if (y < 22) { st += L; st2 += L * L; nt++; }
        }
        const sd = (s, s2, n) => Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
        const s = S.state;
        return { colours: set.size, lowSd: sd(sb, sb2, nb), topSd: sd(st, st2, nt), glError: gl.getError(), shaderErrors: S.shaderErrors.length, safe: S.post.safe,
          above: s.y - S.surface.height(s.x, s.z), level: S.level, ua: navigator.userAgent.slice(0, 80) };
      });
      h.expect(true, `${rid}: ${pic.ua}`);
      h.eq(pic.shaderErrors, 0, `${rid}: every shader compiled`);
      h.eq(pic.glError, 0, `${rid}: no WebGL error`);
      h.eq(pic.safe, 0, `${rid}: the full pipeline runs (no safety fallback needed)`);
      h.expect(pic.colours >= MIN_COLOURS, `${rid}: the picture shows ${pic.colours} colours (>= ${MIN_COLOURS})`);
      h.expect(pic.lowSd > 2.5, `${rid}: the lower picture (snow / slope) has detail, luminance sd ${pic.lowSd.toFixed(1)}`);
      h.expect(pic.topSd > 1.0, `${rid}: the upper picture (sky / mountains) is not one flat colour, sd ${pic.topSd.toFixed(1)}`);
      h.expect(Math.abs(pic.above) < 0.3, `${rid}: the skier stands on the loaded ground (${pic.above.toFixed(2)} m)`);
      // the free look: the camera turns, the skier does not
      const look = await page.evaluate(async () => {
        const S = window.__ski, h0 = S.state.heading, c0 = S.camera.position.clone();
        S.look.turn(-260, 0);
        await new Promise((r) => setTimeout(r, 200));
        const moved = S.camera.position.distanceTo(c0), h1 = S.state.heading;
        // R8f: the ease back runs on the game's frame clock (dt is capped per frame): a slow test machine needs more wall time than 3.5 s
        const t0 = performance.now();
        while (performance.now() - t0 < 12000 && Math.abs(S.look.yaw) >= 0.05) await new Promise((r) => setTimeout(r, 250));
        return { moved, turned: Math.abs(h1 - h0), back: Math.abs(S.look.yaw), waited: Math.round(performance.now() - t0 + 200) };
      });
      h.expect(look.moved > 2 && look.turned < 1e-6, `${rid}: the free look moved the camera ${look.moved.toFixed(1)} m, the skier's heading unchanged`);
      h.expect(look.back < 0.05, `${rid}: released, the view eased back behind the skier (yaw ${look.back.toFixed(3)} after ${look.waited} ms)`);
      await h.shot(`ski-webkit-${engine}-${rid}`);
      h.eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], `${rid}: zero console errors`);
      const fps = await page.evaluate(async () => { const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 2000) { await new Promise((r) => requestAnimationFrame(r)); n++; } return n / ((performance.now() - t0) / 1000); });
      console.log(`  (info) ${engine} ${rid}: ${fps.toFixed(0)} frames/s headless, level ${pic.level}`);
    }
  },
};

runIfMain(import.meta.url, flow);
