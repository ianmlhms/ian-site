/* R8c: page helpers for scripts/ski/r8c-drv.mjs (sent as the body of /eval): window.__r8.spot(x, z, heading, cam?) places the skier,
 * waits for the tiles, optionally fixes the camera [x, z, above, tx, tz, above2, fov]; stats() = draw calls, triangles, village triangles. */
window.__r8 = {
  async spot(x, z, h, cam) {
    const S = window.__ski;
    S.setCamera(null); S.orbit(null); if (S.look && S.look.reset) S.look.reset();
    await window.__r8.offLift();
    S.streamer.focus(x, z);
    await Promise.race([S.streamer.ready(x, z, 500), new Promise((r) => setTimeout(r, 9000))]);
    S.place(x, z, h);
    for (let i = 0; i < 80 && (S.terrain.stats.pending > 0 || i < 15); i++) await new Promise((r) => setTimeout(r, 100));
    S.place(x, z, h);
    S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false });
    await new Promise((r) => setTimeout(r, 1200));
    S.setInput(null);
    if (cam) S.setCamera(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5] || 0, cam[6] || 55);
    await new Promise((r) => setTimeout(r, cam ? 2500 : 600));
    return window.__r8.stats();
  },
  /** ride lift `id` to arc length s (m) in view 'window' | 'chase'; returns the ride state */
  async ride(id, s, view) {
    const S = window.__ski;
    S.setCamera(null);
    await window.__r8.offLift();
    await S.goFree(id);
    for (let i = 0; i < 200 && !(S.game.phase === 'running' && S.modes.liftAt && S.modes.liftAt.id === id); i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 1000));
    S.boardLift();
    for (let i = 0; i < 300 && !(S.ride && S.ride.phase === 'ride'); i++) await new Promise((r) => setTimeout(r, 200));
    if (!S.ride) return 'no ride';
    if (S.rideView !== view) S.toggleRideView();
    for (let i = 0; i < 2400 && S.ride && S.ride.s < s; i++) {
      // fast forward: the ride's own clock (debug) if there is one, else wait
      for (let k = 0; k < 40 && S.ride.s < s; k++) S.ride.step(0.1);      // fast forward on the ride's own clock
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 1500));
    return { s: S.ride && Math.round(S.ride.s), len: S.ride && Math.round(S.ride.path.len), view: S.rideView };
  },
  async offLift() {
    const S = window.__ski;
    for (let i = 0; i < 300 && S.ride; i++) {
      if (S.ride.phase === 'ride') { for (let k = 0; k < 200 && S.ride && S.ride.phase === 'ride'; k++) S.ride.step(0.25); }
      else S.ride.step(0.1);
      await new Promise((r) => setTimeout(r, 30));
    }
    return !S.ride;
  },
  /** every village / town centre of the resort (inside the field): stand there, chase camera, 4 headings: the scene + village triangles */
  async sweep(rid) {
    const S = window.__ski, r = await (await fetch(`/pb/ski/data/${rid}/resort.json`)).json();
    const out = [];
    for (const p of r.places || []) {
      if (!/village|town/.test(p.kind) || p.x < 0 || p.z < 0 || p.x > S.field.width || p.z > S.field.depth) continue;
      let worst = { tris: 0 };
      for (let k = 0; k < 4; k++) {
        let st;
        if (k === 0) st = await window.__r8.spot(p.x, p.z, 0);
        else { S.place(p.x, p.z, k * Math.PI / 2); await new Promise((res) => setTimeout(res, 900)); st = window.__r8.stats(); }
        if (st.tris > worst.tris) worst = st;
      }
      out.push({ name: p.name, x: Math.round(p.x), z: Math.round(p.z), tris: worst.tris, village: worst.village, calls: worst.calls });
    }
    out.sort((a, b) => b.tris - a.tris);
    return out;
  },
  /** triangles drawn per top-level scene object (one plain render with that object hidden, the difference) */
  breakdown() {
    const S = window.__ski, R = S.renderer, sc = S.scene, cam = S.camera;
    const draw = () => { R.info.reset(); R.render(sc, cam); return R.info.render.triangles; };
    const all = draw(), out = { all };
    for (const o of sc.children) {
      if (!o.visible) continue;
      o.visible = false; const t = draw(); o.visible = true;
      const k = o.name || o.type;
      if (all - t > 2000) out[k] = (out[k] || 0) + (all - t);
    }
    return out;
  },
  /** the HUD text boxes (CSS px) for scripts/ski/r8c-hud.py */
  hudRects() {
    const out = {};
    for (const [k, sel] of [['name', '#hName'], ['clock', '.hud .freehud .day'], ['stats', '.hud .freehud .fstats'], ['speed', '#hSpeed']]) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const rg = document.createRange(); rg.selectNodeContents(e);          // the glyphs' own box, not the block's width
      const r = rg.getBoundingClientRect();
      if (r.width > 2) out[k] = [r.left, r.top, r.right, r.bottom].map(Math.round);
    }
    return out;
  },
  /** the floating labels on screen: boxes, overlaps, outside the viewport margin */
  labelBoxes() {
    const host = document.querySelector('.ch-tags'), hr = host.getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.ch-tags .ch-tag')].filter((e) => !e.hidden && e.getBoundingClientRect().left > -1000).map((e) => { const r = e.getBoundingClientRect(); return [r.left - hr.left, r.top - hr.top, r.right - hr.left, r.bottom - hr.top]; });
    let overlaps = 0, outside = 0;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (a[0] < 8 || a[1] < 8 || a[2] > hr.width - 8 || a[3] > hr.height - 8) outside++;
      for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j]; if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) overlaps++; }
    }
    return { n: boxes.length, overlaps, outside, boxes: boxes.map((b) => b.map(Math.round)) };
  },
  stats() {
    const S = window.__ski, v = S.scene.getObjectByName('ski-village');
    let vt = 0;
    if (v) for (const m of v.children) if (m.visible) vt += m.geometry.attributes.position.count / 3;
    const i = S.info();
    return { calls: i.calls, tris: i.triangles, village: Math.round(vt), fr: S.frames() };
  },
};
return 'ok';
