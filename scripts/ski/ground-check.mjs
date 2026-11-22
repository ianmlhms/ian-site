#!/usr/bin/env node
/* Round 7 (A): the drawn ground == the physics ground, in every village of every resort, in Chromium AND WebKit.
 *   node scripts/ski/ground-check.mjs [--resorts killy,...] [--engines chromium,webkit] [--villages 5] [--out DIR] [--shots]
 * Per resort: the free ride spawn (the skier on the loaded ground, within 0.3 m), then up to N village spots (street points spread over the
 * resort, farthest-point sampling): the skier is put there, the terrain settles, and
 *   streets   every street vertex within 80 m: |drawn - physics| (the street ribbon vs surface.height) <= 6 cm (no spikes, no banks in the air)
 *   ground    40 random rays straight down within 50 m: the first visible surface (terrain tiles + streets) vs surface.height <= 6 cm
 *   skis      the skier standing on the street: the lowest ski point is not under the snow (>= -2 cm)
 *   decks     (R8b) waiting in the boarding zone of 14 lifts: the drawn surface under the boots (terrain + station decks) is <= 3 cm over
 *             where he stands (no skis inside a platform), the lowest ski point >= -2 cm
 *   carve     a scripted carve on the spawn slope: the skis never more than 2 cm under the snow
 *   coplanar  the village meshes near every village spot: no two overlapping triangles in the same plane (z-fighting: the flickering
 *             balcony rails); the count of overlapping pairs must be 0
 *   terrain   (round 7 A) at the spawn and on six pistes (the longest red at 300 m among them): once the tiles there are meshed, a
 *             21 x 21 grid of rays straight down over +-100 m (the full-detail ring) onto the drawn terrain vs the physics: a crack
 *             (no hit, or the ray falls through to a skirt / a lower tile: drawn > 0.5 m under the physics) or a wall (drawn > 0.5 m
 *             over it) must not exist; a skirt seen as a tall smeared wall is exactly such a crack
 * plus a ground-level screenshot of each village spot (--shots). Exit 1 on any failure; a per-resort table at the end. */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz").split(",");
const engines = opt("--engines", "chromium,webkit").split(",");
const villages = Number(opt("--villages", "5"));
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round7/ground"));
const shots = args.includes("--shots");
fs.mkdirSync(out, { recursive: true });

const { server, origin } = await startServer();
const table = [];
let fails = 0;
try {
  for (const engine of engines) {
    process.env.FLOW_BROWSER = engine;
    const browser = await launchBrowser({ fullChromium: true });
    for (const rid of resorts) {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
      await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
      await page.waitForTimeout(2500);
      const spawn = await page.evaluate(() => { const S = window.__ski, s = S.state; return { above: s.y - S.standHeight(s.x, s.z), clear: S.skierClear }; });      // R8b: snow or station deck
      await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
      await page.waitForFunction(() => !!window.__ski.roadRows, null, { timeout: 60000 });
      await page.waitForTimeout(2500);
      const spawnLate = await page.evaluate(() => { const S = window.__ski, s = S.state; return s.y - S.standHeight(s.x, s.z); });
      // village spots: street points spread over the resort (farthest-point sampling), inside the shipped tiles
      const spots = await page.evaluate((n) => {
        const S = window.__ski, pts = [];
        for (const r of S.roadRows) for (const p of r.pts) pts.push(p);
        if (!pts.length) return [];
        const out = [pts[Math.floor(pts.length / 2)]];
        while (out.length < n) {
          let best = null, bd = -1;
          for (let i = 0; i < pts.length; i += 7) { const p = pts[i]; let d = Infinity; for (const q of out) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])); if (d > bd) { bd = d; best = p; } }
          if (!best || bd < 300) break;
          out.push(best);
        }
        return out;
      }, villages);
      const rows = [];
      for (const [i, [x, z]] of spots.entries()) {
        const r = await page.evaluate(async ({ x, z }) => {
          const S = window.__ski, T = window.THREE;
          S.place(x, z, 0);
          S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false });
          await new Promise((res) => setTimeout(res, 1800));
          // streets: every vertex near by vs the physics surface
          let worstStreet = 0, n = 0;
          const roads = S.scene.getObjectByName('ski-roads');
          if (roads) roads.traverse((o) => {
            if (!o.isMesh) return;
            const p = o.geometry.attributes.position;
            for (let k = 0; k < p.count; k++) {
              const vx = p.getX(k), vz = p.getZ(k);
              if (Math.abs(vx - x) > 80 || Math.abs(vz - z) > 80) continue;
              const d = p.getY(k) - S.surface.height(vx, vz) - 0.006;      // R8: roads.js LIFT
              n++; if (Math.abs(d) > Math.abs(worstStreet)) worstStreet = d;
            }
          });
          // rays straight down: the first visible ground surface (terrain + streets) vs the physics
          const ray = new T.Raycaster();
          const targets = [S.scene.getObjectByName('ski-terrain'), roads].filter(Boolean);
          let worstRay = 0, rays = 0, worstWhat = '';
          for (let k = 0; k < 40; k++) {
            const a = k * 2.39996, rr = 6 + (k % 10) * 4.4, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
            const h = S.surface.height(px, pz);
            ray.set(new T.Vector3(px, h + 30, pz), new T.Vector3(0, -1, 0));
            ray.far = 60;
            const hit = ray.intersectObjects(targets, true)[0];
            if (!hit) continue;
            rays++;
            const d = hit.point.y - h;
            if (Math.abs(d) > Math.abs(worstRay)) { worstRay = d; worstWhat = `${hit.object.parent ? hit.object.parent.name : ''}/${hit.object.name} r${rr.toFixed(0)}`; }
          }
          // coplanar overlaps in the village meshes within 120 m (the near detail level is built there)
          let coplanar = 0, tris = 0; const copKinds = {}, copSamples = [];
          const vg = S.scene.getObjectByName('ski-village');
          if (vg) vg.traverse((o) => {
            if (!o.isMesh || !o.visible) return;
            const P = o.geometry.attributes.position;
            if (!P) return;
            const groups = new Map();
            for (let t = 0; t + 2 < P.count; t += 3) {
              const a = [P.getX(t), P.getY(t), P.getZ(t)], b = [P.getX(t + 1), P.getY(t + 1), P.getZ(t + 1)], c = [P.getX(t + 2), P.getY(t + 2), P.getZ(t + 2)];
              if (Math.abs(a[0] - x) > 120 || Math.abs(a[2] - z) > 120) continue;
              const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
              let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
              const area = Math.hypot(nx, ny, nz) / 2;
              if (area < 0.01) continue;
              nx /= area * 2; ny /= area * 2; nz /= area * 2;
              if (nx < -1e-6 || (Math.abs(nx) < 1e-6 && (ny < -1e-6 || (Math.abs(ny) < 1e-6 && nz < 0)))) { nx = -nx; ny = -ny; nz = -nz; }
              const d = nx * (a[0] - x) + ny * a[1] * 0 + nz * (a[2] - z) + ny * (a[1] - S.state.y);      // local origin: small numbers, a stable key
              const key = `${Math.round(nx * 300)},${Math.round(ny * 300)},${Math.round(nz * 300)},${Math.round(d * 100)}`;
              let g = groups.get(key); if (!g) groups.set(key, (g = [])); const I = o.geometry.attributes.aInfo; g.push([a, b, c, nx, ny, nz, I ? I.getW(t) : -1, I ? I.getX(t) : -1]);
              tris++;
            }
            // 2D separating-axis test on the plane's two dominant axes, each triangle shrunk 1 cm towards its middle (shared edges do not count)
            const proj = (tri, ax, ay) => { const m = [0, 1, 2].map((i) => (tri[0][i] + tri[1][i] + tri[2][i]) / 3); return [0, 1, 2].map((k) => { const p = tri[k]; const dx = p[ax] - m[ax], dy = p[ay] - m[ay]; const l = Math.hypot(dx, dy) || 1; const sh = Math.max(0, l - 0.01) / l; return [m[ax] + dx * sh, m[ay] + dy * sh]; }); };
            const sep = (A, B) => { for (const T of [A, B]) for (let i = 0; i < 3; i++) { const p = T[i], q = T[(i + 1) % 3]; const nx2 = q[1] - p[1], ny2 = p[0] - q[0]; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (const r of A) { const d2 = r[0] * nx2 + r[1] * ny2; a0 = Math.min(a0, d2); a1 = Math.max(a1, d2); } for (const r of B) { const d2 = r[0] * nx2 + r[1] * ny2; b0 = Math.min(b0, d2); b1 = Math.max(b1, d2); } if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return true; } return false; };
            for (const g of groups.values()) {
              if (g.length < 2 || g.length > 600) continue;
              const [, , , nx, ny, nz] = g[0];
              const dom = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 0 : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
              const ax = dom === 0 ? 1 : 0, ay = dom === 2 ? 1 : 2;
              const pr = g.map((t) => proj(t, ax, ay));
              const onPlane = (A, B) => B.slice(0, 3).every((q) => Math.abs(A[3] * (q[0] - A[0][0]) + A[4] * (q[1] - A[0][1]) + A[5] * (q[2] - A[0][2])) < 0.003);
              for (let i = 0; i < pr.length; i++) for (let j = i + 1; j < pr.length; j++) if (onPlane(g[i], g[j]) && !sep(pr[i], pr[j])) { coplanar++; const k2 = `p${g[i][6]}/${g[j][6]} s${g[i][7]} n${ny.toFixed(2)}`; copKinds[k2] = (copKinds[k2] || 0) + 1; if (copSamples.length < 4) copSamples.push([g[i].slice(0, 3).map((q) => q.map((v) => +v.toFixed(2))), g[j].slice(0, 3).map((q) => q.map((v) => +v.toFixed(2)))]); }
            }
          });
          return { coplanar, copKinds, copSamples, villageTris: tris, worstStreet, streetVerts: n, worstRay, worstWhat, rays, clear: S.skierClear, above: S.state.y - S.surface.height(S.state.x, S.state.z) };
        }, { x, z });
        if (shots) {
          await page.evaluate(({ x, z }) => { window.__ski.setCamera(x - 14, z - 9, 2.2, x + 10, z + 6, 1.0, 62); }, { x, z });
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(out, `${engine}-${rid}-v${i + 1}.png`) });
          await page.evaluate(() => window.__ski.setCamera(null));
        }
        rows.push(r);
      }
      // terrain cracks / walls at the spawn and on six pistes
      const terrain = await page.evaluate(async () => {
        const S = window.__ski, T = window.THREE, out = [];
        const reds = S.pistes.list.filter((q) => q.diff === 'red' && q.length > 900).sort((a, b) => b.length - a.length);
        const pick = [reds[0] ? [reds[0], 300] : null, ...S.pistes.list.filter((q, i) => i % Math.max(1, Math.floor(S.pistes.list.length / 5)) === 0).slice(0, 5).map((q) => [q, q.length / 2])].filter(Boolean);
        const spots = [{ name: 'spawn', x: S.state.x, z: S.state.z, h: S.state.heading }, ...pick.map(([p, at]) => { const a = p.at(Math.min(at, p.length - 5), {}); return { name: p.name, x: a.x, z: a.z, h: Math.atan2(a.dz, a.dx) }; })];
        const ray = new T.Raycaster();
        const grp = S.scene.getObjectByName('ski-terrain');
        for (const sp of spots) {
          S.place(sp.x, sp.z, sp.h);
          await S.streamer.ready(sp.x, sp.z, 300);
          for (let i = 0; i < 80 && (S.terrain.stats.pending > 0 || i < 8); i++) await new Promise((r) => setTimeout(r, 100));
          let cracks = 0, walls = 0, worst = 0, where = null, n = 0;
          for (let gz = -10; gz <= 10; gz++) for (let gx = -10; gx <= 10; gx++) {
            const x = sp.x + gx * 10, z = sp.z + gz * 10, h = S.surface.height(x, z);
            ray.set(new T.Vector3(x, h + 60, z), new T.Vector3(0, -1, 0)); ray.far = 200;
            const hit = ray.intersectObject(grp, true)[0];
            n++;
            const d = hit ? hit.point.y - h : -99;
            if (d < -0.5) cracks++; else if (d > 0.5) walls++;
            if (Math.abs(d) > Math.abs(worst)) { worst = d; where = [Math.round(x), Math.round(z)]; }
          }
          out.push({ name: sp.name, cracks, walls, worst: +worst.toFixed(2), where, n });
        }
        return out;
      });
      // fast travel: the moment the fade lifts after a jump to a far lift, the full-detail ground there is already meshed (no coarse
      // tiles, no skirt walls)
      const jumps = await page.evaluate(async () => {
        const S = window.__ski, T = window.THREE, ray = new T.Raycaster(), grp = S.scene.getObjectByName('ski-terrain');
        const here = S.state, lifts = [...S.modes.lifts.list].sort((a, b) => Math.hypot(b.bottom.x - here.x, b.bottom.z - here.z) - Math.hypot(a.bottom.x - here.x, a.bottom.z - here.z));
        const out = [];
        for (const l of [lifts[0], lifts[Math.floor(lifts.length / 2)]]) {
          await S.goFree(l.id);
          const fade = document.getElementById('skiFade');
          for (let i = 0; i < 200 && fade && fade.classList.contains('on'); i++) await new Promise((r) => setTimeout(r, 25));
          await new Promise((r) => setTimeout(r, 300));                   // the fade's own transition: now the picture is seen
          const st = S.state;
          const tiles = S.terrain.tiles.size, pending = S.terrain.stats.pending;
          let bad = 0, worst = 0;
          for (let gz = -8; gz <= 8; gz++) for (let gx = -8; gx <= 8; gx++) {
            const x = st.x + gx * 8, z = st.z + gz * 8, h = S.surface.height(x, z);
            ray.set(new T.Vector3(x, h + 80, z), new T.Vector3(0, -1, 0)); ray.far = 300;
            const hit = ray.intersectObject(grp, true)[0];
            const d = hit ? hit.point.y - h : -99;
            if (Math.abs(d) > 0.5) bad++;
            if (Math.abs(d) > Math.abs(worst)) worst = d;
          }
          out.push({ lift: l.name, bad, worst: +worst.toFixed(2), tiles, pending, at: [Math.round(st.x), Math.round(st.z)], dist: Math.round(Math.hypot(st.x - l.bottom.x, st.z - l.bottom.z)) });
        }
        return out;
      });
      for (const j of jumps) terrain.push({ name: `jump ${j.lift}`, cracks: j.bad, walls: 0, worst: j.worst, tiles: j.tiles, pending: j.pending, dist: j.dist });
      const cracks = terrain.reduce((m, t) => m + t.cracks + t.walls, 0);
      if (process.env.COP_DEBUG || cracks) console.log(JSON.stringify(terrain));
      // R8b (3V QA: skis sank into every boarding platform): the skier waiting in the boarding zone of up to 14 lifts (the nearest to
      // the spawn first): the drawn surface under his boots (terrain + station decks, a ray straight down) vs where he stands, and his
      // lowest ski point: never under the drawn deck
      const decks = await page.evaluate(async () => {
        const S = window.__ski, T = window.THREE, ray = new T.Raycaster();
        const targets = [S.scene.getObjectByName('ski-terrain'), S.scene.getObjectByName('ski-lifts')].filter(Boolean);
        const here = { x: S.state.x, z: S.state.z };
        const lifts = [...S.modes.lifts.list].filter((l) => !l.tunnel).sort((a, b) => Math.hypot(a.bottom.x - here.x, a.bottom.z - here.z) - Math.hypot(b.bottom.x - here.x, b.bottom.z - here.z)).slice(0, 14);
        const out = [];
        for (const l of lifts) {
          const w = S.modes.lifts.boardAt(l);
          S.placeHold(w.x, w.z, w.heading);
          await S.streamer.ready(w.x, w.z, 200);
          await new Promise((r) => setTimeout(r, 700));
          const st = S.state;
          let worst = 0, what = '';
          for (const [dx, dz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
            ray.set(new T.Vector3(st.x + dx, st.y + 3, st.z + dz), new T.Vector3(0, -1, 0)); ray.far = 8;
            // (a decal that writes no depth, the drag track, can never hide the skis: not counted)
            const hit = ray.intersectObjects(targets, true).find((h) => h.object.visible !== false && h.face && h.face.normal && Math.abs(h.face.normal.y) > 0.5 && !(h.object.material && h.object.material.depthWrite === false));
            if (hit && hit.point.y - S.standHeight(st.x + dx, st.z + dz) > worst) { worst = hit.point.y - S.standHeight(st.x + dx, st.z + dz); what = hit.object.name || (hit.object.parent && hit.object.parent.name) || hit.object.type; }
          }
          out.push({ lift: l.name, deck: S.deckAt(st.x, st.z) > S.surface.height(st.x, st.z), over: +worst.toFixed(3), what, clear: +S.skierClear.toFixed(3) });
        }
        return out;
      });
      const deckWorst = decks.reduce((m, d) => Math.max(m, d.over), 0), deckClear = decks.reduce((m, d) => Math.min(m, d.clear), 0.5);
      if (process.env.COP_DEBUG || deckWorst > 0.03 || deckClear < -0.02) console.log(JSON.stringify(decks));
      // a scripted carve on the spawn slope: the skis stay on the snow
      const carve = await page.evaluate(async () => {
        const S = window.__ski;
        const p = S.pistes.list.find((q) => q.diff === 'red' && q.length > 800) || S.pistes.list[0];
        const a = p.at(Math.min(200, p.length / 3), {});
        S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
        let worst = 0, camLow = 99;
        const t0 = performance.now();
        while (performance.now() - t0 < 6000) {
          const t = (performance.now() - t0) / 1000;
          S.setInput({ steer: Math.sin(t * 1.6) > 0 ? 1 : -1, tuck: 0, brake: 0, push: 0, jump: false });
          await new Promise((res) => requestAnimationFrame(res));
          if (S.state.grounded && S.state.crash === 0) worst = Math.min(worst, S.skierClear);
          camLow = Math.min(camLow, S.camera.position.y - S.surface.height(S.camera.position.x, S.camera.position.z));
        }
        S.setInput(null);
        return { worst, camLow, kmh: S.state.speed * 3.6 };
      });
      const worstStreet = rows.reduce((m, r) => (Math.abs(r.worstStreet) > Math.abs(m) ? r.worstStreet : m), 0);
      const worstRay = rows.reduce((m, r) => (Math.abs(r.worstRay) > Math.abs(m) ? r.worstRay : m), 0);
      const worstWhat = (rows.find((r) => r.worstRay === worstRay) || {}).worstWhat || '';
      const minClear = Math.min(...rows.map((r) => r.clear), 0.5);
      const copKinds = {}; for (const r of rows) for (const [k, v] of Object.entries(r.copKinds || {})) copKinds[k] = (copKinds[k] || 0) + v;
      const coplanar = rows.reduce((m, r) => m + r.coplanar, 0), villageTris = rows.reduce((m, r) => m + r.villageTris, 0);
      const ok = Math.abs(spawn.above) < 0.3 && Math.abs(spawnLate) < 0.3 && Math.abs(worstStreet) <= 0.06 && Math.abs(worstRay) <= 0.06 && minClear >= -0.02 && carve.worst >= -0.02 && deckWorst <= 0.03 && deckClear >= -0.02 && coplanar === 0 && cracks === 0 && carve.camLow >= 0.3 && !errors.length;
      if (!ok) fails++;
      const line = { engine, rid, ok, spawnAbove: +spawn.above.toFixed(3), spawnLate: +spawnLate.toFixed(3), villages: rows.length, worstStreet: +worstStreet.toFixed(3), worstRay: +worstRay.toFixed(3), worstWhat, minSkiClear: +minClear.toFixed(3), coplanar, copKinds, villageTris, terrainSpots: terrain.length, terrainCracks: cracks, terrainWorst: Math.max(...terrain.map((t) => Math.abs(t.worst))), carveSki: +carve.worst.toFixed(3), decks: decks.length, onDeck: decks.filter((d) => d.deck).length, deckWorst, deckClear, camOverSnow: +carve.camLow.toFixed(2), errors: errors.slice(0, 3) };
      if (process.env.COP_DEBUG) console.log(JSON.stringify(rows.map((r) => r.copSamples)));
      table.push(line);
      console.log(JSON.stringify(line));
      await ctx.close();
    }
    await browser.close();
  }
} finally {
  server.close();
}
fs.writeFileSync(path.join(out, "ground.json"), JSON.stringify(table, null, 1));
console.log(`\n${table.length - fails} / ${table.length} resort runs green`);
process.exit(fails ? 1 : 0);
