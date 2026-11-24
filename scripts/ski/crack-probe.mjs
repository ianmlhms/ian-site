/* Probe: jump to a lift by fast travel and list the terrain ray cracks around the arrival spot (tile, drawn vs physics).
 *   node scripts/ski/crack-probe.mjs [resort] [lift name] */
import { startServer, launchBrowser } from "../flows/lib.mjs";
const rid = process.argv[2] || "obertauern", liftName = process.argv[3] || "Kehrkopfbahn";
const { server, origin } = await startServer();
process.env.FLOW_BROWSER = "chromium";
const browser = await launchBrowser({ fullChromium: true });
const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
await page.goto(`${origin}/pb/ski.html?go=1&debug=1&keep=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 240000 });
await page.waitForTimeout(2500);
await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
if (process.argv[4] === 'park') {
  const q = await page.evaluate(async () => {
    const S = window.__ski, T = window.THREE, P = S.surface.field.park;
    const ray = new T.Raycaster(), grp = S.scene.getObjectByName('ski-terrain');
    const mid = P.world(P.len / 2, 0);
    S.place(mid.x, mid.z, P.heading);
    await S.streamer.ready(mid.x, mid.z, 400);
    for (let i = 0; i < 80 && (S.terrain.stats.pending > 0 || i < 8); i++) await new Promise((r) => setTimeout(r, 100));
    const out = { hw: P.hw, len: P.len, bad: [] };
    for (let s = -12; s <= P.len + 12; s += 2) for (let v = -P.hw - 12; v <= P.hw + 12; v += 1.5) {
      const w = P.world(s, v), h = S.surface.height(w.x, w.z);
      ray.set(new T.Vector3(w.x, h + 60, w.z), new T.Vector3(0, -1, 0)); ray.far = 200;
      const hits = ray.intersectObjects([grp, S.scene.getObjectByName('ski-park-snow')].filter(Boolean), true).filter((q) => q.object.visible !== false);
      const hit = hits[0], d = hit ? hit.point.y - h : -99;
      if (Math.abs(d) > 0.3) out.bad.push({ s, v, d: +d.toFixed(2), solid: P.solidAt(w.x, w.z), hits: hits.slice(0, 3).map((q) => q.object.name + ' ' + (q.point.y - h).toFixed(2)), mask: P.mask(w.x, w.z) });
    }
    return out;
  });
  console.log(JSON.stringify(q, null, 1)); await browser.close(); server.close(); process.exit(0);
}
const r = await page.evaluate(async (liftName) => {
  const S = window.__ski, T = window.THREE, ray = new T.Raycaster(), grp = S.scene.getObjectByName('ski-terrain');
  const l = S.modes.lifts.list.find((q) => q.name === liftName);
  await S.goFree(l.id);
  const fade = document.getElementById('skiFade');
  for (let i = 0; i < 200 && fade && fade.classList.contains('on'); i++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 300));
  const st = S.state, out = { at: [st.x, st.z], pending: S.terrain.stats.pending, bad: [] };
  for (let gz = -8; gz <= 8; gz++) for (let gx = -8; gx <= 8; gx++) {
    const x = st.x + gx * 8, z = st.z + gz * 8, h = S.surface.height(x, z);
    ray.set(new T.Vector3(x, h + 80, z), new T.Vector3(0, -1, 0)); ray.far = 300;
    const hit = ray.intersectObject(grp, true)[0];
    const d = hit ? hit.point.y - h : -99;
    if (Math.abs(d) > 0.3) out.bad.push({ x, z, h, d, tile: hit && hit.object.name, face: hit && hit.faceIndex });
  }
  out.tiles = [...S.terrain.tiles.values()].filter((t) => Math.abs(t.leaf.x0 + t.leaf.size / 2 - st.x) < 200 && Math.abs(t.leaf.z0 + t.leaf.size / 2 - st.z) < 200).map((t) => `${t.leaf.key} step${t.leaf.step}`);
  const c = out.bad[0];
  if (c) {
    const t = S.terrain.tiles.get('80:2000:3360') || [...S.terrain.tiles.values()].find((q) => c.tile === 'tile ' + q.leaf.key);
    const pos = t.mesh.geometry.attributes.position, lf = t.leaf;
    const i = Math.floor((c.x - lf.x0) / lf.step), j = Math.floor((c.z - lf.z0) / lf.step), SIDE = 33;
    out.cell = { i, j, leaf: lf.key, step: lf.step, sig: t.signature, corners: [[0,0],[1,0],[0,1],[1,1]].map(([a,b]) => { const v = (j+b)*SIDE + i + a; const x = lf.x0 + (i+a)*lf.step, z = lf.z0 + (j+b)*lf.step; return { mesh: +pos.getY(v).toFixed(2), phys: +S.surface.height(x, z).toFixed(2), fresh: +S.surface.field.height(x, z).toFixed(2), base: +S.surface.field.baseHeight(x, z).toFixed(2), far: +S.surface.field.farHeight(x, z).toFixed(2), blk: +(() => { const b = S.surface.block(Math.floor(x / 80), Math.floor(z / 80)); return b.h[(Math.round((z - b.z0) / 2.5) + 1) * 35 + Math.round((x - b.x0) / 2.5) + 1]; })().toFixed(2) }; }) };
    for (let k = 0; k < 40; k++) { if (S.terrain.stats.pending === 0) break; await new Promise((r) => setTimeout(r, 250)); }
    out.pendingLater = S.terrain.stats.pending;
    ray.set(new T.Vector3(c.x, c.h + 80, c.z), new T.Vector3(0, -1, 0)); ray.far = 300;
    const hit = ray.intersectObject(grp, true)[0];
    const all = ray.intersectObject(S.scene, true).filter((q) => { let o = q.object, v = true; while (o) { if (!o.visible) v = false; o = o.parent; } return v; });
    out.scene = all.slice(0, 6).map((q) => ({ n: q.object.name || q.object.type, par: q.object.parent && q.object.parent.name, y: +(q.point.y - S.surface.height(c.x, c.z)).toFixed(2) }));
    out.later = hit ? hit.point.y - S.surface.height(c.x, c.z) : null;
  }
  return out;
}, liftName);
console.log(JSON.stringify(r, null, 1));
await browser.close(); server.close(); process.exit(0);
