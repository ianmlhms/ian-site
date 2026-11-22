/* Round 7-C2 shots + in-page checks (for shot.mjs --script), one resort per run (?resort=): a challenge course at its start, in the
 * middle and just before the ZIL arch (chase camera, the scripted skier riding), then an avalanche on Lawin face 1 watched from
 * avalanche.js faceView. Prints one "R7C2 {json}" line with the checks:
 *   course    every course object (net posts, net ribbons, arrow boards + posts, ZIL pillars + beam, finish strip) measured in the scene
 *             against the drawn snow: nothing floats (> 0.35 m), nothing stands > 6 m above the snow, nothing bigger than meant
 *   hud       the distance text at the start, in the middle and at the arch (must fall, < 30 m at the arch)
 *   camera    the avalanche camera >= 0.6 m above the snow with a clear line to the flow; the chase camera after a teleport too
 *   sound     the rumble level while the slab flows (0..1, > 0 = the layer is driven)
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs OUT/killy --gpu --dpr 2 --size 1180x820 \
 *     --until ready --url "/pb/ski.html?resort=killy&go=1&debug=1&q=high&weather=sun&time=morning&res=fixed" --script scripts/ski/round7c2-shots.mjs */
export default async function shots(page, { shoot }) {
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (ms = 2500) => page.waitForTimeout(ms);
  const out = {};
  await ev(() => { try { localStorage.setItem('pb_ski_cam', 'chase'); } catch (e) { /* ignore */ } });
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === 'ski' && window.__ski.game.phase === 'running', null, { timeout: 150000 });
  await settle(1500);
  // the course: a long red piste (the 4th one over 700 m, like round 7-C's sheet), the buildings in, the tiles of the whole line
  const pid = await ev(async () => {
    const k = window.__ski; const L = k.pistes.list.filter((q) => q.diff === 'red' && q.length > 700); const p = L[3] || L[0] || k.pistes.list[0];
    await k.streamer.ready(p.top.x, p.top.z, 800); if (k.explore && k.explore.buildings) await k.explore.buildings(); k.start(p.id); return p.id;
  });
  await page.waitForFunction(() => window.__ski.game.phase === 'running', null, { timeout: 20000 });
  await settle(1400);
  out.piste = pid;
  out.hudStart = await page.textContent('#cLeft');
  await shoot('course-start');
  const rideTo = async (share) => {
    await ev(async (share) => {
      const k = window.__ski, r = k.game.run, s = r.startS + (r.finishS - r.startS) * share;
      const a = k.game.piste.at(s, {}); await k.streamer.ready(a.x, a.z, 500);
      k.teleport(s);
      const { createBot } = await import('/pb/ski/bot.js'); k.game.bot = createBot(k.game.piste);
    }, share);
  };
  await rideTo(0.5);
  await settle(2600);
  out.hudMid = await page.textContent('#cLeft');
  await shoot('course-mid');
  // just before the arch: from 70 m out, the bot rides in; shoot when the HUD says < 30 m (the course is taken down at the finish)
  await ev(async () => { const k = window.__ski, r = k.game.run, a = k.game.piste.at(r.finishS, {}); await k.streamer.ready(a.x, a.z, 500); k.teleport(r.finishS - 70); const { createBot } = await import('/pb/ski/bot.js'); k.game.bot = createBot(k.game.piste); });      // a new bot: the old one's hint is back at the middle
  // the picture as he comes up to the arch (< 45 m: the arch still in view), the HUD read once it says < 26 m
  let shot = false;
  for (let i = 0; i < 300; i++) {
    const st = await ev(() => { const k = window.__ski, c = k.lastCourse, s = k.state; return { rem: c ? c.remaining : null, phase: k.game.phase, v: s.speed, s: k.game.run ? k.game.run.proj.s : null }; });
    if (i % 25 === 0) console.log('arch wait', JSON.stringify(st));
    if (!shot && st.rem !== null && st.rem < 45 && st.phase === 'running') { await shoot('course-finish'); shot = true; }
    if ((st.rem !== null && st.rem < 26) || st.phase === 'finished') break;
    await settle(200);
  }
  if (!shot) await shoot('course-finish');
  out.hudArch = await page.textContent('#cLeft');
  out.archRemaining = await ev(() => (window.__ski.lastCourse ? window.__ski.lastCourse.remaining : null));
  // freeze him there for the picture: no bot, hard brake
  await ev(() => { const k = window.__ski; k.game.bot = null; k.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  out.course = await ev(() => {
    const k = window.__ski, T = window.THREE, H = (x, z) => k.surface.height(x, z);
    const box = new T.Box3(), m = new T.Matrix4(), c = new T.Vector3();
    const bad = [];
    let n = 0, worstFloat = 0, worstTop = 0;
    const limits = { 'ski-course-barriers': 1.4, 'ski-course-arrows': 1.6, 'ski-course-arrow-posts': 1.8 };
    for (const o of k.scene.children) {
      if (!/^ski-course/.test(o.name)) continue;
      o.updateMatrixWorld(true);
      o.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const geo = mesh.geometry; geo.computeBoundingBox();
        if (mesh.name === 'ski-course-nets' || mesh.name === 'ski-course-line') {       // ribbons: every 7th vertex against the snow
          const P = geo.attributes.position;
          for (let i = 0; i < P.count; i += 7) {
            const x = P.getX(i), y = P.getY(i), z = P.getZ(i), g = H(x, z);
            const lift = mesh.name === 'ski-course-nets' && i % 2 ? y - 1.05 - g : y - g;      // odd net vertices = the top edge
            n++; worstFloat = Math.max(worstFloat, lift);
            if (lift > 0.35 || lift < -0.45) bad.push(`${mesh.name} ${lift.toFixed(2)} m`);
          }
          return;
        }
        const count = mesh.isInstancedMesh ? mesh.count : 1;
        for (let i = 0; i < count; i++) {
          box.copy(geo.boundingBox);
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, m); m.premultiply(mesh.matrixWorld); box.applyMatrix4(m); } else box.applyMatrix4(mesh.matrixWorld);
          box.getCenter(c);
          const g = H(c.x, c.z), size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
          n++;
          const name = mesh.name || o.name;
          const top = box.max.y - g;
          if (name === 'ski-course-beam') { const gp = Math.max(H(box.min.x, box.min.z), H(box.max.x, box.max.z), g); worstTop = Math.max(worstTop, box.max.y - gp); continue; }
          worstTop = Math.max(worstTop, top);
          const float = box.min.y - g;
          if (name !== 'ski-course-arrows') worstFloat = Math.max(worstFloat, float);
          if (top > 6.05 && name !== 'ski-course-pillar') bad.push(`${name}#${i} top ${top.toFixed(1)} m`);
          if (name !== 'ski-course-arrows' && float > 0.35) bad.push(`${name}#${i} floats ${float.toFixed(2)} m`);
          if (limits[name] && size[1] > limits[name]) bad.push(`${name}#${i} ${size.map((v) => v.toFixed(1)).join('x')}`);
        }
      });
    }
    return { n, worstFloat: +worstFloat.toFixed(2), worstTop: +worstTop.toFixed(2), bad: bad.slice(0, 12), nBad: bad.length };
  });
  await ev(() => window.__ski.setInput(null));
  // a teleport (free ride): the chase camera clear of the snow, the skier in view
  await ev(async () => { const k = window.__ski; k.game.bot = null; await k.firstLift(); });
  await page.waitForFunction(() => window.__ski.game.mode === 'freeride' && window.__ski.game.phase === 'running', null, { timeout: 20000 }).catch(() => {});
  await settle(1500);
  out.teleportCam = await ev(async () => {
    const k = window.__ski, c = k.camera.position, s = k.state, m = await import('/pb/ski/avalanche.js');
    return { above: +(c.y - k.surface.height(c.x, c.z)).toFixed(2), clear: m.lineClear((x, z) => k.surface.height(x, z), c.x, c.y, c.z, s.x, s.y + 1, s.z, 0.2, 0.15) };
  });
  // the avalanche on face 1 from the clear spot, the clock x2.5
  out.avalanche = await ev(async () => {
    const k = window.__ski, a = k.avalanches, f = a.faces[0], m = await import('/pb/ski/avalanche.js');
    const v = k.avalancheView(0);
    await k.streamer.ready(v.tx, v.tz, 700);
    const t0 = performance.now(); a.setClock(() => (t0 + (performance.now() - t0) * 2.5) / 1000);
    a.triggerAvalanche(m.cellId(f.top.x, f.top.z), 7001, a.clock());
    return { face: `${Math.round(f.slope)}°/${Math.round(f.len)} m`, above: +v.above.toFixed(1), clear: v.clear };
  });
  await settle(3000);
  // the picture: aim at where the slab is now (the middle of its moving blocks), from the same clear spot
  await ev(() => { const k = window.__ski, b = k.avalanches.blocks().filter((q) => q.moving); if (!b.length || !k.game.camPose) return; const x = b.reduce((m, q) => m + q.x, 0) / b.length, z = b.reduce((m, q) => m + q.z, 0) / b.length; k.game.camPose = { ...k.game.camPose, tx: x, tz: z, ty: k.surface.height(x, z) + 4 }; });
  await settle(1800);
  out.avalanche.rumble = await ev(() => +window.__ski.avalanches.loudness(window.__ski.camera.position.x, window.__ski.camera.position.z).toFixed(2));
  out.avalanche.camAbove = await ev(() => { const k = window.__ski, c = k.camera.position; return +(c.y - k.surface.height(c.x, c.z)).toFixed(1); });
  await shoot('avalanche');
  await ev(() => { window.__ski.setCamera(null); window.__ski.avalanches.clear(); });
  console.log('R7C2 ' + JSON.stringify(out));
}
