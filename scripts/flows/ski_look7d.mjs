/* Flow: Ski Alpen R7-D look, on EVERY resort (Ian: "make sure it doesn't repeat in the other ski areas"), in Chromium and in WebKit:
 *
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/flows/ski_look7d.mjs [rid ...]
 *   FLOW_BROWSER=webkit BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/flows/ski_look7d.mjs
 *
 * Per resort (free ride, Héich, then a Niddreg page for the cheap shaders): no page / shader error, every compiled program runnable;
 * the trees are ONE instanced draw call per kind (spruce / larch, near / far) with their triangle budget, near trees drawn by a forest;
 * the snow park's meshes exist (one merged snow mesh in the terrain's material) and a ray down onto them hits what the physics reads
 * (surface.height) within 5 cm; a challenge gate's base and posts stay white / dark while its banner wears the piste colour (rendered
 * pixels, not only the data). The Node half (mesh == physics over a scripted rider, the terrain never through a mesh) is
 * scripts/ski/look7d-check.mjs. */
import { runIfMain } from "./lib.mjs";

const RESORTS = ["killy", "3vallees", "zermatt", "arlberg", "kronplatz"];
const BUDGET = { spruceNear: 308, larchNear: 380, spruceFar: 20, larchFar: 36 };

export const flow = {
  name: "ski-look7d",
  fullChromium: true,
  viewport: { width: 1024, height: 700 },
  async run(h) {
    let page = h.page;
    const errors = [];
    const watch = (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    };
    watch(page);
    const engine = await page.evaluate(() => navigator.userAgent).catch(() => "");
    let first = true;
    const only = process.argv.slice(2).filter((a) => RESORTS.includes(a));
    for (const rid of only.length ? only : RESORTS) {
      for (const q of ["high", "low"]) {
        if (q === "low" && rid !== "killy") continue;                         // the cheap shader variant: once is enough (resort-generic code)
        errors.length = 0;
        h.step(`${rid} (${q}): boot into the free ride`);
        // every resort in a page of its own: the previous page's cancelled tile fetches (WebKit reports them as page errors) stay there
        if (!first) {
          const next = await h.context.newPage(); watch(next);
          if (page === h.page) await page.goto("about:blank"); else await page.close();          // the harness keeps using h.page
          page = next;
        }
        first = false;
        await page.goto(h.origin + `/pb/ski.html?resort=${rid}&go=1&debug=1&q=${q}&weather=sun&time=evening&res=fixed`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 240000 });
        h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${rid} ${q}: no boot error (${engine.replace(/^Mozilla\/5.0 /, "").slice(0, 60)})`);
        await page.evaluate(() => { const s = window.__ski; s.game.bot = null; s.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });

        // ---- trees: next to a forest, the near kinds are drawn, one instanced call each, within budget
        const trees = await page.evaluate(async (budget) => {
          const S = window.__ski, { createScatter, BLOCK } = await import("/pb/ski/scatter.js"), { TREE_GEOMETRY } = await import("/pb/ski/scatter-view.js");
          const sc = createScatter(S.field);
          let spot = null;
          for (const p of S.pistes.list.slice(0, 200)) {
            for (let s = 40; s < p.length - 40 && !spot; s += 60) {
              const a = p.at(s, {});
              const t = sc.treeBlock(Math.floor(a.x / BLOCK), Math.floor(a.z / BLOCK));
              let sp = 0, la = 0;
              for (let i = 0; i < t.length; i += 6) { if (t[i + 4] > 0.5) la++; else sp++; }
              if (sp > 3 && la > 1) spot = a;
            }
            if (spot) break;
          }
          if (!spot) { const p = S.pistes.list[0], a = p.at(60, {}); spot = a; }
          S.setCamera(spot.x + 25, spot.z + 25, 6, spot.x, spot.z, 2, 60);
          S.scatterView.update(spot.x + 25, spot.z + 25, true, Infinity);
          await new Promise((r) => setTimeout(r, 1500));
          S.scatterView.update(spot.x + 25, spot.z + 25, true, Infinity);
          const meshes = S.scatterView.group.children.filter((m) => m.isMesh);
          const kinds = {};
          for (const m of meshes) {
            const k = m.name.replace(/^ski-/, ""), tris = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
            const same = TREE_GEOMETRY[k] ? TREE_GEOMETRY[k]().attributes.position.count / 3 === tris : true;
            kinds[k] = (kinds[k] || []).concat([{ tris, same, n: m.geometry.instanceCount, cast: m.castShadow, depth: !!m.customDepthMaterial }]);
          }
          // draw calls of the scatter set alone (moved into a scene of its own for one render)
          const g = S.scatterView.group, parent = g.parent, scene = new window.THREE.Scene();
          scene.add(g);
          const info = S.renderer.info, keep = info.autoReset;
          info.autoReset = false; info.reset();
          const rt = new window.THREE.WebGLRenderTarget(64, 64);
          S.renderer.setRenderTarget(rt); S.renderer.render(scene, S.camera); S.renderer.setRenderTarget(null);
          const calls = info.render.calls, drawn = meshes.filter((m) => m.visible && m.geometry.instanceCount > 0).length;
          info.reset(); info.autoReset = keep; rt.dispose();
          parent.add(g);
          return { kinds, calls, drawn, near: S.scatterView.stats.near, budget };
        }, BUDGET);
        const kindOk = ["spruceNear", "larchNear", "spruceFar", "larchFar"].every((k) => trees.kinds[k] && trees.kinds[k].length === 1 && trees.kinds[k][0].tris <= BUDGET[k] && trees.kinds[k][0].same && trees.kinds[k][0].cast && trees.kinds[k][0].depth);
        h.expect(kindOk, `${rid} ${q}: one instanced mesh per tree kind within budget, casting shadows (${Object.entries(trees.kinds).map(([k, v]) => `${k} ${v.map((x) => `${x.tris} tris x ${x.n}`).join("+")}`).join(", ")})`);
        h.expect(trees.near > 0 && trees.calls <= trees.drawn && trees.calls >= 2, `${rid} ${q}: ${trees.near} near trees drawn; the scatter set alone = ${trees.calls} draw calls for ${trees.drawn} non-empty meshes`);

        // ---- the snow park: the merged snow mesh, a ray down onto it == the physics
        const park = await page.evaluate(() => {
          const S = window.__ski, L = S.parkLayout;
          if (!L) return null;
          S.modes.ensureParkView();
          const snow = S.scene.getObjectByName("ski-park-snow");
          if (!snow) return { missing: true };
          S.setCamera(L.top.x, L.top.z, 8, L.bottom.x, L.bottom.z, 0, 60);
          snow.visible = true; snow.updateMatrixWorld();
          const ray = new window.THREE.Raycaster(), v = new window.THREE.Vector3(), down = new window.THREE.Vector3(0, -1, 0);
          let worst = 0, n = 0, seed = 7;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
          for (const [s0, s1, v0, v1] of L.boxes) for (let i = 0; i < 120; i++) {
            const s = s0 + 0.5 + (s1 - s0 - 1) * rnd(), vv = v0 + 0.5 + (v1 - v0 - 1) * rnd();
            if (Math.abs(L.featureHeight(s, vv)) < 0.1) continue;                // on the feature bodies (the rim and the wall toes meet the terrain)
            const p = L.world(s, vv);
            ray.set(v.set(p.x, S.surface.height(p.x, p.z) + 30, p.z), down);
            const hit = ray.intersectObject(snow, false)[0];
            if (!hit) continue;
            n++; worst = Math.max(worst, Math.abs(hit.point.y - S.surface.height(p.x, p.z)));
          }
          const m = snow.material;
          const meshes = ["ski-park", "ski-park-boards", "ski-park-snow"].filter((name) => S.scene.getObjectByName(name)).length;
          return { tris: snow.geometry.index.count / 3, snowMaterial: !!(m.uniforms && m.uniforms.uSunDir && m.uniforms.uDetail), cast: snow.castShadow, n, worst, kickers: L.kickers.length, pipe: !!L.pipe, meshes };
        });
        if (park && !park.missing) {
          h.expect(park.snowMaterial && park.cast && park.meshes === 3 && park.tris > 800, `${rid} ${q}: park meshes (${park.meshes} draw calls), snow ${park.tris} triangles in the terrain's snow material, casting shadows; ${park.kickers} kickers, pipe ${park.pipe ? "yes" : "no"}`);
          h.expect(park.n > 100 && park.worst <= 0.05, `${rid} ${q}: ${park.n} rays onto the kickers / ramps / pipe: drawn vs physics worst ${(park.worst * 100).toFixed(1)} cm`);
        } else h.expect(false, `${rid} ${q}: the park view exists (${park ? "no snow mesh" : "no park layout"})`);

        // ---- a challenge gate: base white, banner in the piste colour (rendered pixels)
        const gate = await page.evaluate(async () => {
          const S = window.__ski, M = S.markers, list = M.list;
          const alone = (m) => list.every((o) => o === m || Math.hypot(o.x - m.x, o.z - m.z) > 35);      // no other gate in the picture
          let i = list.findIndex((m) => !m.park && (m.diff === "red" || m.diff === "blue") && alone(m));
          if (i < 0) i = list.findIndex((m) => !m.park && (m.diff === "red" || m.diff === "blue"));
          const m = list[i];
          const T = window.THREE;
          const mat4 = new T.Matrix4(); M.mesh.getMatrixAt(i, mat4);
          const base = new T.Vector3(0, 0.28, 3.5).applyMatrix4(mat4), banner = new T.Vector3(0, 2.9, 0).applyMatrix4(mat4);
          const hx = Math.cos(m.heading), hz = Math.sin(m.heading);
          // the gates' own mesh and material, alone in a plain white light (no terrain or streaming in the way): what the shader does
          // with the instance colour, seen 7 m down the piste, looking at the right post between its base and the banner
          const cam = new T.PerspectiveCamera(50, 1, 0.3, 3000);
          cam.position.set(m.x + hx * 7 + hz * 1.5, (base.y + banner.y) / 2 + 0.3, m.z + hz * 7 - hx * 1.5);
          cam.lookAt((base.x + banner.x) / 2, (base.y + banner.y) / 2, (base.z + banner.z) / 2);
          cam.updateMatrixWorld(); cam.updateProjectionMatrix();
          const scene = new T.Scene(), parent = M.mesh.parent;
          scene.background = new T.Color(0x000000);
          const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(cam.position.x - m.x, 20, cam.position.z - m.z);
          scene.add(new T.AmbientLight(0xffffff, 1.6), sun, sun.target); sun.target.position.set(0, 0, 0);
          sun.position.add(new T.Vector3(m.x, 0, m.z)); sun.target.position.set(m.x, base.y, m.z);
          scene.add(M.mesh);
          const W = 512, rt = new T.WebGLRenderTarget(W, W);
          S.renderer.setRenderTarget(rt); S.renderer.render(scene, cam); S.renderer.setRenderTarget(null);
          parent.add(M.mesh);
          const px = (p) => {
            const q = p.clone().project(cam), x = Math.round((q.x * 0.5 + 0.5) * W), y = Math.round((q.y * 0.5 + 0.5) * W);
            const out = new Uint8Array(4 * 9); S.renderer.readRenderTargetPixels(rt, x - 1, y - 1, 3, 3, out);
            const c = [0, 0, 0]; for (let k = 0; k < 9; k++) for (let j = 0; j < 3; j++) c[j] += out[k * 4 + j] / 9;
            return { at: [x, y], rgb: c.map(Math.round) };
          };
          const res = { diff: m.diff, base: px(base), banner: px(banner), tint: !!M.mesh.geometry.getAttribute("aTint") };
          rt.dispose();
          return res;
        });
        const sat = (c) => Math.max(...c) - Math.min(...c);
        const want = gate.diff === "red" ? gate.banner.rgb[0] > gate.banner.rgb[2] + 30 && gate.banner.rgb[0] > gate.banner.rgb[1] + 20 : gate.banner.rgb[2] > gate.banner.rgb[0] + 30;
        h.expect(gate.tint && sat(gate.base.rgb) < 30 && Math.min(...gate.base.rgb) > 120, `${rid} ${q}: gate base stays white / neutral: rgb ${gate.base.rgb.join(",")} at ${gate.base.at}`);
        h.expect(want, `${rid} ${q}: gate banner wears the ${gate.diff} piste colour: rgb ${gate.banner.rgb.join(",")}`);

        // ---- shaders: nothing logged, every program runnable
        const progs = await page.evaluate(() => { const P = window.__ski.renderer.info.programs || []; return { n: P.length, bad: P.filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name || p.cacheKey.slice(0, 40)) }; });
        h.expect(progs.n > 10 && progs.bad.length === 0, `${rid} ${q}: ${progs.n} shader programs compiled, ${progs.bad.length} not runnable ${progs.bad.join(" ")}`);
        // WebKit reports the previous page's tile fetches that the navigation cancelled ("... due to access control checks"): not this page
        const own = errors.filter((e) => !(/access control checks/.test(e) && /\/pb\/ski\/data\//.test(e) && !e.includes(`/pb/ski/data/${rid}/`)));
        h.expect(own.length === 0, `${rid} ${q}: no console / page error${own.length ? ": " + own.slice(0, 3).join(" | ") : ""}${errors.length > own.length ? ` (${errors.length - own.length} cancelled fetches of the previous resort ignored)` : ""}`);
        if (process.env.FLOW_SHOTS_DIR) await page.screenshot({ path: `${process.env.FLOW_SHOTS_DIR}/ski-look7d.${rid}-${q}.png` }).catch(() => {});
      }
    }
    if (h.failures.length) console.log(`    failures: ${h.failures.join(" | ").slice(0, 600)}`);
  },
};

runIfMain(import.meta.url, flow);
