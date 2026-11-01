/* Rolling-stock + cab views without loading a route: renders each train model (side, 3/4 front, rear 3/4) and each cab desk
 * (the game's own camera: eye / eyeLookAt of the cab group, fov 66) on a plain painted backdrop with the game's lights, and prints
 * the triangle / draw-call count of every train.
 *
 *   node scripts/zuch/stock_views.mjs <outDir> [--trains id,id,..] [--views side,sidehead,front,rear,cab,saloon,head,noseside] [--stats] [--quality high|medium|low]
 *
 * Writes <outDir>/<train>-<view>.png and, with --stats, prints one JSON line per train:
 *   { id, cars, meshes (draw calls of the train, cab excluded), triangles, cabMeshes, cabTriangles }.
 * It is a QA harness only (the shot is NOT the in-game scenery, see zlib.mjs for that). */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, startServer } from '../flows/lib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const hasFlag = (n) => { const i = args.indexOf('--' + n); if (i < 0) return false; args.splice(i, 1); return true; };
const only = flag('trains', '');
const views = flag('views', 'side,front,rear,cab').split(',');
const quality = flag('quality', 'high');
const wantStats = hasFlag('stats');
const variantsFile = flag('variants', '');   // JSON [{ name, id, patch }]: renders train `id` with `patch` deep-merged into its TS.trains.specs entry, files <name>-<view>.png
const bareCab = hasFlag('bare-cab');   // debug: hide the train body, show only the cab group
const outDir = args[0];
if (!outDir) { console.error('usage: stock_views.mjs <outDir> [--trains a,b] [--views side,sidehead,front,rear,cab,saloon,head,noseside] [--stats]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
const [browser, { server, origin }] = await Promise.all([launchBrowser({ fullChromium: true }), startServer()]);
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /Lokf/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  await page.goto(origin + '/robots.txt').catch(() => {});
  await page.setContent('<!doctype html><body style="margin:0;background:#9fc3dc"><canvas id=c width=1280 height=720></canvas></body>');
  await page.addScriptTag({ url: THREE_URL });
  for (const f of ['config.js', 'trains.js', 'cab.js']) await page.addScriptTag({ url: `${origin}/pb/train-sim/${f}?x=${Date.now()}` });
  await page.evaluate((q) => {
    window.__paintDebug = true;
    const T = THREE, TS = window.TS;
    const renderer = new T.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720, false);
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const scene = new T.Scene();
    scene.background = new T.Color('#9fc3dc'); scene.fog = new T.Fog('#b9d2e2', 120, 600);
    scene.add(new T.HemisphereLight('#dfeaf1', '#8b8065', 1.5));
    const sun = new T.DirectionalLight('#fff0d6', 3.1); sun.position.set(-30, 60, 40); sun.castShadow = true;
    sun.shadow.camera.left = -130; sun.shadow.camera.right = 130; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40; sun.shadow.camera.far = 400; sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    const ground = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshStandardMaterial({ color: '#7f8a6a', roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2; ground.receiveShadow = true; scene.add(ground);
    const ballast = new T.Mesh(new T.PlaneGeometry(900, 4.2), new T.MeshStandardMaterial({ color: '#7a7670', roughness: 1 })); ballast.rotation.x = -Math.PI / 2; ballast.position.y = -0.05; ballast.rotation.z = Math.PI / 2; scene.add(ballast);
    for (const x of [-0.7175, 0.7175]) { const r = new T.Mesh(new T.BoxGeometry(0.07, 0.15, 900), new T.MeshStandardMaterial({ color: '#8c8f94', metalness: 0.6, roughness: 0.4 })); r.position.set(x, 0.02, 0); scene.add(r); }
    const camera = new T.PerspectiveCamera(40, 1280 / 720, 0.05, 2000);
    let cur = null;
    const stats = (root) => { let meshes = 0, tris = 0; root.traverse((o) => { if (!(o.isMesh || o.isSprite || o.isPoints)) return; for (let p = o; p; p = p.parent) if (!p.visible) return; const m = Array.isArray(o.material) ? o.material.length : 1; meshes += o.isInstancedMesh ? m : m; const g = o.geometry; if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); }); return { meshes, tris: Math.round(tris) }; };
    window.__scene = scene; window.__camera = camera;
    window.__h = {
      ids: () => TS.config.trains.map((t) => t.id),
      show(id, view, opts) {
        if (window.__lamp) { scene.remove(window.__lamp); window.__lamp = null; }
        if (cur) { if (cur.cab) cur.cab.dispose(); cur.model.dispose(); }
        const def = TS.config.trains.find((t) => t.id === id);
        const cfg = { ...def, ...(opts && opts.cfg) };
        const spec = TS.trains.specs[def.model];
        const merge = (t, p) => { for (const k of Object.keys(p)) { if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) && t[k] && typeof t[k] === 'object') merge(t[k], p[k]); else t[k] = p[k]; } };
        // a variant patch is deep-merged into a CLONE of the spec for this one build (structuredClone cannot copy the functions, so they are carried over by reference)
        let backup = null;
        if (opts && opts.patch) { backup = Object.assign({}, spec); const clone = JSON.parse(JSON.stringify(spec)); for (const k of Object.keys(spec)) if (typeof spec[k] === 'function') clone[k] = spec[k]; for (const k of Object.keys(spec)) delete spec[k]; Object.assign(spec, clone); merge(spec, opts.patch); }
        window.__restore = backup ? () => { for (const k of Object.keys(spec)) delete spec[k]; Object.assign(spec, backup); } : null;
        const model = TS.trains.create(cfg, { quality: q, livery: cfg.livery, upgrades: {}, headlight: false });
        scene.add(model.group);
        let z = 0; const ctr = [];
        model.cars.forEach((c) => { c.group.position.set(0, 0, z + c.length / 2); ctr.push(z + c.length / 2); z += c.length; });
        const total = z;
        const s = stats(model.group);   // before the cab is attached
        let cab = null;
        if (view === 'cab') {
          cab = TS.cab.create(cfg, { quality: q });
          model.cars[0].group.add(cab.group);
          model.setCabView(true);
        }
        if (window.__restore) { window.__restore(); window.__restore = null; }   // model and cab are built: put the spec back
        cur = { model, cab, total }; window.__cur = cur;
        if (opts && opts.night) { model.setLights({ head: 1, tail: false, cabin: true }); }
        const f0 = model.cars[0].length;
        const nose = -0 + 0;   // front of car 0 sits at z = 0 + gap/2 .. body front ~ -(length)/2 + centre
        const frontZ = ctr[0] - model.cars[0].length / 2;
        if (view === 'side') {
          const span = Math.max(total, 30);
          camera.fov = 28; camera.updateProjectionMatrix();
          const dist = (span / 2) / Math.tan(camera.fov * Math.PI / 360 * 1.0) / (1280 / 720) * 1.05;
          camera.position.set(dist * 0.98, 2.0, frontZ + total / 2); camera.lookAt(0, 2.0, frontZ + total / 2);
        } else if (view === 'saloon') {   // key 5 inside the first passenger car, looking back down the train (the game's own viewpoint rule)
          const pi = model.cars.findIndex((c) => c.saloon); const pc = model.cars[pi];
          camera.fov = 70; camera.updateProjectionMatrix();
          camera.position.set(0, pc.saloon.eyeY, ctr[pi] + pc.saloon.zA + 1.1);
          camera.lookAt(0, pc.saloon.eyeY - 0.05, ctr[ctr.length - 1]);
          const lamp = new T.PointLight(0xfff1dc, 3.5, 11, 1.2); lamp.position.copy(camera.position); scene.add(lamp); window.__lamp = lamp;
          model.setLights({ head: 0, tail: false, cabin: true });
        } else if (view === 'noseside') {   // pure side profile of the first 10 m (silhouette check against a side photo)
          camera.fov = 24; camera.updateProjectionMatrix();
          camera.position.set(26, 2.4, frontZ + 4.5); camera.lookAt(0, 2.4, frontZ + 4.5);
        } else if (view === 'head') {   // head-on, a little to the side and low (the photo angle of the nose close-ups)
          camera.fov = 24; camera.updateProjectionMatrix();
          camera.position.set(4.2, 1.5, frontZ - 11); camera.lookAt(0, 1.9, frontZ + 1.5);
        } else if (view === 'sidehead') {   // the first ~40 m of the train from the side (details: doors, windows, pantograph)
          camera.fov = 26; camera.updateProjectionMatrix();
          camera.position.set(34, 2.4, frontZ + 17); camera.lookAt(0, 2.2, frontZ + 17);
        } else if (view === 'front' || view === 'rear') {
          camera.fov = 34; camera.updateProjectionMatrix();
          const rear = view === 'rear';
          const zE = rear ? ctr[ctr.length - 1] + model.cars[ctr.length - 1].length / 2 : frontZ;
          const sgn = rear ? 1 : -1;
          camera.position.set(5.6, 1.9, zE + sgn * 9.5); camera.lookAt(0.0, 1.9, zE - sgn * 1.0);
        } else if (view === 'cab') {
          model.cars[0].group.updateMatrixWorld(true); cab.group.updateMatrixWorld(true);
          const eye = cab.group.userData.eye.clone(); cab.group.localToWorld(eye);
          camera.fov = 66; camera.updateProjectionMatrix(); camera.position.copy(eye);
          camera.lookAt(eye.x, eye.y, eye.z - 20);
          if (opts && opts.lever != null) cab.update({ lever: opts.lever, speedKmh: opts.speed || 0, limitKmh: 120, targetKmh: 80, clock: '14:32', delaySec: 24, nextStationName: 'Wasserbillig', distanceToStopM: 1480, signalAspect: 'green', brakePct: 0, powerKw: 900, night: opts.night ? 1 : 0 });
          else cab.update({ lever: 3, speedKmh: 92, limitKmh: 120, targetKmh: 80, clock: '14:32', delaySec: 24, nextStationName: 'Wasserbillig', distanceToStopM: 1480, signalAspect: 'green', brakePct: 0, powerKw: 900 });
          cab.snap(); cab.update({ lever: 3, speedKmh: 92, limitKmh: 120, targetKmh: 80, clock: '14:32', delaySec: 24, nextStationName: 'Wasserbillig', distanceToStopM: 1480, signalAspect: 'green', brakePct: 0, powerKw: 900, doorSide: 'right', night: opts && opts.night ? 1 : 0 });
        }
        if (opts && opts.bare && cab) model.cars.forEach((c) => c.group.children.forEach((o) => { if (o !== cab.group) o.visible = false; }));
        renderer.render(scene, camera);
        const cs = cab ? stats(cab.group) : null;
        return { id, cars: model.cars.length, total: Math.round(total * 10) / 10, meshes: s.meshes, tris: s.tris, cab: cs, calls: renderer.info.render.calls };
      },
      render() { renderer.render(scene, camera); },
    };
  }, quality);
  const ids = await page.evaluate(() => window.__h.ids());
  const variants = variantsFile ? JSON.parse(fs.readFileSync(variantsFile, 'utf8')) : null;
  if (variants) {
    for (const v of variants) {
      for (const view of views) {
        // the cab view needs the model + cab built with the patched spec: the restore happens right after create(), the cab reads the spec in the same call
        const r = await page.evaluate(([i, vw, patch]) => { try { return window.__h.show(i, vw, { patch }); } catch (e) { return { id: i, error: String(e && e.stack || e) }; } }, [v.id, view, v.patch || {}]);
        if (r.error) { console.error(v.name, view, r.error); continue; }
        await page.waitForTimeout(100);
        await page.evaluate(() => window.__h.render());
        await page.locator('#c').screenshot({ path: path.join(outDir, `${v.name}-${view}.png`) });
      }
    }
    const bad0 = errors.filter((e) => !/404|favicon/.test(e)); if (bad0.length) console.error('errors:', bad0.slice(0, 8).join('\n'));
    await browser.close(); server.close(); process.exit(0);
  }
  const pick = only ? only.split(',') : ids;
  const rows = [];
  for (const id of pick) {
    for (const view of views) {
      const r = await page.evaluate(([i, v, bare]) => { try { return window.__h.show(i, v, { bare }); } catch (e) { return { id: i, error: String(e && e.stack || e) }; } }, [id, view, bareCab]);
      if (r.error) { console.error(id, view, r.error); continue; }
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__h.render());
      await page.locator('#c').screenshot({ path: path.join(outDir, `${id}-${view}.png`) });
      if (view === views[0]) rows.push(r);
    }
  }
  if (hasFlag('census')) {   // debug: per car, every visible mesh with its material count / triangles / kind (what makes the draw calls)
    const rep = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        window.__h.show(id, 'side');
        const cars = window.__cur.model.cars, res = [];
        [0, 1, cars.length - 1].filter((v, i, a) => a.indexOf(v) === i).forEach((ci) => {
          const rows = {};
          cars[ci].group.traverse((o) => {
            if (!(o.isMesh || o.isSprite || o.isPoints)) return;
            for (let p = o; p; p = p.parent) if (!p.visible) return;
            const m = Array.isArray(o.material) ? o.material.length : 1, g = o.geometry;
            const tris = g ? Math.round((g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1)) : 0;
            const par = o.parent && o.parent !== cars[ci].group ? (o.parent.name || 'grp') : '';
            const key = (o.isInstancedMesh ? 'inst' : o.isSprite ? 'sprite' : 'mesh') + '/' + par + '/' + m;
            rows[key] = rows[key] || { n: 0, draws: 0, tris: 0 }; rows[key].n++; rows[key].draws += m; rows[key].tris += tris;
          });
          res.push({ car: ci, rows });
        });
        out[id] = res;
      }
      return out;
    }, pick);
    console.log(JSON.stringify(rep, null, 1));
  }
  if (hasFlag('paint-probe')) {   // debug: hull vertex colours of the first car near the tip
    const out = await page.evaluate((id) => {
      window.__h.show(id, 'side'); const car = window.__cur.model.cars[0].group, body = car.children[0], g = body.geometry, pa = g.attributes.position, ca = g.attributes.color;
      const zF = Math.min(...Array.from({ length: pa.count }, (_, i) => pa.getZ(i))), res = [];
      for (let i = 0; i < pa.count; i += 3) { const d = pa.getZ(i) - zF; if (d < 3.4 && pa.getY(i) > 0.9 && pa.getX(i) > -0.3 && pa.getX(i) < 1.3 && i % 2 === 0) res.push([+d.toFixed(2), +pa.getY(i).toFixed(2), +ca.getX(i).toFixed(2), +ca.getY(i).toFixed(2), +ca.getZ(i).toFixed(2)]); }
      return { n: pa.count, zF, np: window.TS.trains.specs.hst.nosePaint(0.5, 0, 1.64, [0, 0, 0]), name: body.name, sample: res.slice(0, 80), mat: body.material.type + ' ' + body.material.roughness };
    }, pick[0]);
    console.log(JSON.stringify(out));
  }
  if (hasFlag('ray-out')) {   // debug: first hit of rays from the head view camera towards points of the hull (name, material, vertex colour at the hit, face winding side)
    const out = await page.evaluate((id) => {
      window.__h.show(id, 'head'); const T = THREE, cam = window.__camera, rc = new T.Raycaster(), res = [];
      cam.updateMatrixWorld(true); rc.camera = cam;
      for (const [x, y, zz] of [[0, 2.0, 1.0], [0, 1.9, 0.6], [0, 2.4, 1.6], [0.5, 2.0, 1.0]]) {
        const frontZ = window.__cur.model.cars[0].group.position.z - window.__cur.model.cars[0].length / 2 + 0.25;
        const tgt = new T.Vector3(x, y, frontZ + zz); rc.set(cam.position, tgt.clone().sub(cam.position).normalize());
        for (const h of rc.intersectObjects(window.__scene.children, true).slice(0, 3)) { const m = Array.isArray(h.object.material) ? h.object.material[(h.face && h.face.materialIndex) || 0] : h.object.material; res.push({ tgt: [x, y, zz], dist: +h.distance.toFixed(2), obj: h.object.name || h.object.type, par: h.object.parent && h.object.parent.name, mat: m.type, side: m.side, col: m.color && m.color.getHexString(), emi: m.emissive && m.emissive.getHexString(), vc: m.vertexColors, tr: m.transparent, vis: h.object.visible }); }
      }
      return res;
    }, pick[0]);
    console.log(JSON.stringify(out));
  }
  if (hasFlag('ray-up')) {   // debug: what does the cab camera see straight ahead and 20 degrees up? (first hit: mesh name, material, colour, emissive)
    const out = await page.evaluate(() => {
      const T = THREE, cam = window.__camera, rc = new T.Raycaster(), res = []; rc.camera = cam;
      for (const deg of [10, 20, 30, 40]) {
        const d = new T.Vector3(0, Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180)); rc.set(cam.position, d);
        const hit = rc.intersectObjects(window.__scene.children, true).find((h) => h.object.visible && h.object.material && !(h.object.material.colorWrite === false));
        if (hit) { const m = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex || 0] : hit.object.material; res.push({ deg, pt: hit.point.toArray().map((v) => +v.toFixed(2)), bb: (hit.object.geometry.computeBoundingBox(), hit.object.geometry.boundingBox.min.toArray().concat(hit.object.geometry.boundingBox.max.toArray()).map((v) => +v.toFixed(1))), nmat: Array.isArray(hit.object.material) ? hit.object.material.length : 1, dist: +hit.distance.toFixed(2), obj: hit.object.name || hit.object.type, parent: hit.object.parent && hit.object.parent.name, mat: m.type, color: m.color && m.color.getHexString(), emissive: m.emissive && m.emissive.getHexString(), side: m.side, tr: m.transparent, op: m.opacity }); }
      }
      return res;
    });
    console.log(JSON.stringify(out, null, 1));
  }
  if (wantStats) for (const r of rows) console.log(JSON.stringify(r));
  const bad = errors.filter((e) => !/404|favicon/.test(e));
  if (bad.length) console.error('errors:', bad.slice(0, 8).join('\n'));
} finally { await browser.close(); server.close(); }
