/* Flow: Lux Drive "the world" (pb/lux-drive.html).
 * The game boots with no console errors, the baked data stays inside the budget of the brief (30 MB), the car starts at Place de l'Europe
 * (Kirchberg), it drives, the camera never goes under the ground and the draw calls / triangles stay inside the budget of the quality levels. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/lux-drive.html?q=medium&time=noon&weather=clear";
const DATA_BUDGET = 30 * 1024 * 1024;
const BUDGET = { low: { calls: 140, tris: 330000 }, medium: { calls: 200, tris: 520000 }, high: { calls: 240, tris: 900000 } };

async function boot(h, url = PAGE) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 180000 });
  await h.pause(1500);
  await h.page.click('[data-act="drive"]');        // close the menu: the shots must show the world, not the panel
  await h.pause(600);
}

export const flow = {
  name: "luxdrive-world",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },          // an iPad in landscape: the game is played in landscape
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    h.step("boot /pb/lux-drive.html: the world loads, no boot error, no console errors");
    await boot(h);
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    h.eq(errors, [], "zero console errors while booting");

    const info = await page.evaluate(() => {
      const m = window.__lux;
      const bytes = performance.getEntriesByType("resource").filter((e) => /\/pb\/lux-drive\/data\//.test(e.name)).reduce((s, e) => s + (e.encodedBodySize || e.decodedBodySize || 0), 0);
      const s = m.state();
      return { bytes, x: s.x, z: s.z, heading: s.heading, tiles: m.terrain.stats.leaves, calls: m.stats().calls, tris: m.stats().triangles, y: s.y, ground: m.ground.height(s.x, s.z) };
    });
    h.expect(info.bytes > 5e6 && info.bytes <= DATA_BUDGET, `baked data ${(info.bytes / 1048576).toFixed(2)} MB (<= 30 MB)`);
    h.expect(info.tiles > 40, `${info.tiles} terrain tiles`);
    h.expect(Math.abs(info.x - 5905.76) < 30 && Math.abs(info.z - 7999.2) < 30, `the car starts at Place de l'Europe (${info.x.toFixed(0)}, ${info.z.toFixed(0)})`);
    h.expect(info.y >= info.ground - 0.01 && info.y <= info.ground + 1.2, `the car stands on the ground (${info.y.toFixed(2)} vs ${info.ground.toFixed(2)})`);
    await h.shot("boot");

    h.step("the sky: the clouds are the painted white tile, not the coloured noise");
    const sky = await page.evaluate(() => {
      const paint = window.__lux.env.uniforms.uSkyPaint.value;
      const img = paint.image;
      return { kind: img && img.tagName ? img.tagName : "data", w: (img && img.width) || 0 };
    });
    h.eq(sky.kind, "IMG", "the cloud tile is the painted picture (data/tex/sky.webp)");
    h.expect(sky.w >= 256, `the cloud tile is ${sky.w} px wide`);

    h.step("the car drives: the throttle moves it forward on the road");
    const drive = await page.evaluate(async () => {
      const m = window.__lux;
      const before = { x: m.state().x, z: m.state().z };
      m.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      await new Promise((r) => setTimeout(r, 3000));
      const s = m.state();
      const after = { x: s.x, z: s.z, speed: s.speed, onRoad: s.onRoad, surface: s.surface };
      m.setInput(null);
      return { before, after, moved: Math.hypot(after.x - before.x, after.z - before.z) };
    });
    h.expect(drive.moved > 8, `the car drove ${drive.moved.toFixed(1)} m`);
    h.expect(drive.after.speed > 3, `the car is rolling at ${(drive.after.speed * 3.6).toFixed(0)} km/h`);
    h.expect(drive.after.onRoad, `the car is on the tarmac (${drive.after.surface})`);

    h.step("the camera never goes under the ground");
    const cam = await page.evaluate(async () => {
      const m = window.__lux;
      let worst = 1e9;
      for (let i = 0; i < 60; i++) {
        m.setInput({ throttle: 1, brake: 0, steer: (i % 30 < 15 ? 0.4 : -0.4), handbrake: false });
        await new Promise((r) => requestAnimationFrame(r));
        const c = m.camera.position;
        worst = Math.min(worst, c.y - m.ground.height(c.x, c.z));
      }
      m.setInput(null);
      return worst;
    });
    h.expect(cam > 0.3, `the camera stayed ${cam.toFixed(2)} m above the ground`);

    h.step("the ride height: the body sits on the ground, it never sinks and it never floats");
    const ride = await page.evaluate(async (start) => {
      const m = window.__lux;
      m.car.reset(start.x, start.z, start.heading);
      m.setInput({ throttle: 0.7, brake: 0, steer: 0, handbrake: false });
      let minGap = 1e9, maxGap = -1e9, air = 0;
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const st = m.state();
        const gap = st.y - m.ground.height(st.x, st.z);
        if (gap < minGap) minGap = gap;
        if (gap > maxGap) maxGap = gap;
        if (!st.grounded) air++;
      }
      m.setInput(null);
      return { minGap, maxGap, air };
    }, { x: info.x, z: info.z, heading: info.heading });
    h.expect(ride.minGap > 0.35, `the body never sank into the ground (${ride.minGap.toFixed(2)} m above it)`);
    h.expect(ride.maxGap < 0.7, `the body never floated above the ground (${ride.maxGap.toFixed(2)} m)`);
    h.eq(ride.air, 0, "the car stayed on its wheels for the whole drive");

    h.step("the painted asphalt follows the real width of the road");
    const paint = await page.evaluate(async () => {
      const m = window.__lux;
      const net = m.field.network;
      const s = net.samples;
      const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, lines: 0, lanes: 0, s: 0 };
      const st = m.state();
      const rows = [];
      for (let ri = 0; ri < net.roads.length && rows.length < 14; ri++) {
        const r = net.roads[ri];
        if (!r.info.drivable || r.tunnel || r.bridge) continue;
        if (r.width < 3 || r.width > 20) continue;
        const first = s.first[ri], count = s.segs[ri];
        if (count < 3) continue;
        // a point on the road where no other road comes near: at a junction the band of the two roads merges
        let pick = -1;
        for (let i = first; i < first + count; i++) {
          const x = s.x[i], z = s.z[i];
          if (Math.hypot(x - st.x, z - st.z) > 700) continue;
          let near = false;
          for (let j = 0; j < s.x.length && !near; j++) {
            if (s.road[j] === ri) continue;
            if (Math.abs(s.x[j] - x) > 30 || Math.abs(s.z[j] - z) > 30) continue;
            if (Math.hypot(s.x[j] - x, s.z[j] - z) < 25) near = true;
          }
          if (!near) { pick = i; break; }
        }
        if (pick < 0) continue;
        // across the road: the painted tarmac is the set of points where this road is the road the point is
        // on and the point lies within its carriageway - that is exactly what the shader paints as asphalt
        const ax = s.x[Math.max(first, pick - 1)], az = s.z[Math.max(first, pick - 1)];
        const bx = s.x[Math.min(first + count - 1, pick + 1)], bz = s.z[Math.min(first + count - 1, pick + 1)];
        const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez) || 1;
        const nx = -ez / len, nz = ex / len;
        const x = s.x[pick], z = s.z[pick];
        let run = 0, painted = 0;
        for (let d = -25; d <= 25; d += 0.25) {
          m.surface.roadInfoAt(x + nx * d, z + nz * d, info);
          const mine = info.road === ri && Math.abs(info.lat) <= info.hw;
          if (mine) run += 0.25;
          else { if (run > painted) painted = run; run = 0; }
        }
        painted = Math.max(painted, run);
        rows.push({ name: r.name || "", kind: r.kind, osm: r.width, painted });
      }
      return rows;
    });
    h.expect(paint.length >= 5, `${paint.length} roads measured`);
    for (const p of paint) {
      const over = p.painted - p.osm;
      h.expect(p.painted > 0 && over < 1.5 && over > -1.5,
        `${p.kind} ${p.name}: the painted asphalt is ${p.painted.toFixed(2)} m, the real road is ${p.osm.toFixed(2)} m`);
    }

    h.step("the kerb: the car rides over the edge of the carriageway");    const kerb = await page.evaluate(async () => {
      const m = window.__lux;
      const net = m.field.network, S = net.segments;
      const st = m.state();
      // a street near the start whose kerb is on and whose pavement is free of buildings
      let seg = -1, nx = 0, nz = 0, hw = 0, mx = 0, mz = 0;
      for (let i = 0; i < net.count && seg < 0; i++) {
        if (S.KERBH[i] <= 0 || !S.KERBON[i]) continue;
        const ax = S.X0[i], az = S.Z0[i], bx = S.X1[i], bz = S.Z1[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 2) continue;
        const cx = (ax + bx) / 2, cz = (az + bz) / 2;
        if (Math.hypot(cx - st.x, cz - st.z) > 500) continue;
        const px = -(bz - az) / len, pz = (bx - ax) / len;        // across the road
        const hwx = S.HW[i];
        if (hwx < 1.5 || hwx > 6) continue;
        if (m.buildings.collide(cx + px * (hwx + 1.5), cz + pz * (hwx + 1.5), 1.4)) continue;
        if (m.buildings.collide(cx - px * (hwx + 1.5), cz - pz * (hwx + 1.5), 1.4)) continue;
        // the kerb must really be in the ground: the pavement stands higher than the carriageway
        const inside = m.ground.height(cx - px * (hwx - 1.2), cz - pz * (hwx - 1.2));
        const outside = m.ground.height(cx + px * (hwx + 1.2), cz + pz * (hwx + 1.2));
        if (outside - inside < 0.06) continue;
        seg = i; nx = px; nz = pz; hw = hwx; mx = cx; mz = cz;
      }
      if (seg < 0) return { found: false };
      // the car starts on the carriageway, 2 m inside the kerb, and drives across it
      m.car.reset(mx - nx * (hw - 2), mz - nz * (hw - 2), Math.atan2(nz, nx));
      m.setInput({ throttle: 0.45, brake: 0, steer: 0, handbrake: false });
      let minGap = 1e9, maxGap = -1e9, air = 0, crossed = 0;
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const s = m.state();
        const gap = s.y - m.ground.height(s.x, s.z);
        if (gap < minGap) minGap = gap;
        if (gap > maxGap) maxGap = gap;
        if (!s.grounded) air++;
        const d = (s.x - mx) * nx + (s.z - mz) * nz;               // how far across the kerb the car is
        if (d > crossed) crossed = d;
      }
      m.setInput(null);
      return { found: true, hw, minGap, maxGap, air, crossed };
    });
    h.expect(kerb.found, "a street with a kerb was found near the start");
    h.expect(kerb.crossed > kerb.hw + 0.3, `the car crossed the kerb (${kerb.crossed.toFixed(1)} m from the centre line, the kerb is at ${kerb.hw.toFixed(1)} m)`);
    h.expect(kerb.minGap > 0.35, `the body never sank into the kerb (${kerb.minGap.toFixed(2)} m above the ground)`);
    h.expect(kerb.maxGap < 1.2, `the car did not fly over the kerb (${kerb.maxGap.toFixed(2)} m above the ground)`);

    h.step("the bridges of the brief are solid decks the car can drive on");
    const bridges = await page.evaluate(async () => {
      const m = window.__lux;
      // the Luxembourgish names of the bake: Nei Bréck = Pont Adolphe, Roud Bréck = Pont Rouge,
      // Autoroute du Nord = the A1 bridge over the Alzette at Grünewald
      const wanted = ["nei bréck", "roud bréck", "autoroute du nord"];
      const out = [];
      for (const name of wanted) {
        let best = null;
        for (const r of m.field.network.roads) {
          if (!r.bridge || !r.name || r.name.toLowerCase() !== name) continue;
          let len = 0;
          for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
          if (!best || len > best.len) best = { r, len };
        }
        if (!best) { out.push({ name, found: false }); continue; }
        const pts = best.r.pts;
        const mid = pts[Math.floor(pts.length / 2)];
        // the hint tells the ground function how high the car is: with the car high up the deck is the ground
        m.ground.hint(1e9);
        const deck = m.ground.onDeck(mid[0], mid[1]);
        const top = m.ground.height(mid[0], mid[1]);
        const terrain = m.surface.height(mid[0], mid[1]);
        // the car stands on the deck
        m.ground.hint(1e9);
        m.car.reset(mid[0], mid[1], 0);
        for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
        const st = m.state();
        out.push({
          name, found: true, len: best.len, deck, clearance: top - terrain,
          gap: st.y - m.ground.height(st.x, st.z), onDeck: m.ground.onDeck(st.x, st.z),
        });
      }
      return out;
    });
    for (const b of bridges) {
      h.expect(b.found, `${b.name}: the bridge is in the road data`);
      h.expect(b.deck, `${b.name}: a solid deck covers the road`);
      h.expect(b.clearance > 1, `${b.name}: the deck stands ${b.clearance.toFixed(1)} m above the ground below`);
      h.expect(b.onDeck, `${b.name}: the car stands on the deck`);
      h.expect(b.gap > 0.3 && b.gap < 0.6, `${b.name}: the body rides ${b.gap.toFixed(2)} m above the deck`);
    }

    h.step("the edge of the area: the car cannot drive out of the play area");
    const edge = await page.evaluate(async () => {
      const m = window.__lux;
      const ring = m.playArea.rings[0].pts;
      // a point on the border and the direction that leads inside
      let start = null;
      for (let i = 0; i < ring.length && !start; i++) {
        const [x, z] = ring[i];
        const prev = ring[(i - 1 + ring.length) % ring.length];
        const next = ring[(i + 1) % ring.length];
        const dx = next[0] - prev[0], dz = next[1] - prev[1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        for (const s of [1, -1]) {
          if (m.playArea.inside(x + nx * s * 5, z + nz * s * 5)) { start = { x, z, nx: nx * s, nz: nz * s }; break; }
        }
      }
      if (!start) return { found: false };
      // the car sits 5 m inside the border and drives straight out of the area
      const sx = start.x + start.nx * 5, sz = start.z + start.nz * 5;
      m.car.reset(sx, sz, Math.atan2(-start.nz, -start.nx));
      m.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      let outside = 0, reached = 0;
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const s = m.state();
        if (!m.playArea.inside(s.x, s.z)) outside++;
        const d = (s.x - sx) * -start.nx + (s.z - sz) * -start.nz;    // how far it got towards the border
        if (d > reached) reached = d;
      }
      m.setInput(null);
      const s = m.state();
      return { found: true, outside, reached, inside: m.playArea.inside(s.x, s.z) };
    });
    h.expect(edge.found, "a point on the border of the area was found");
    h.expect(edge.reached > 0.5, `the car drove up to the border (${edge.reached.toFixed(1)} m)`);
    h.eq(edge.outside, 0, "the car never left the play area");
    h.expect(edge.inside, "the car is inside the play area at the end");

    h.step("draw calls and triangles stay inside the budget at low / medium / high");
    for (const q of ["low", "medium", "high"]) {
      await boot(h, `/pb/lux-drive.html?q=${q}&time=noon&weather=clear`);
      const s = await page.evaluate(async () => {
        const m = window.__lux;
        await new Promise((r) => setTimeout(r, 1500));
        return { calls: m.stats().calls, tris: m.stats().triangles, q: m.quality().id };
      });
      h.eq(s.q, q, `quality ${q} selected`);
      h.expect(s.calls > 5 && s.calls <= BUDGET[q].calls, `${q}: ${s.calls} draw calls (<= ${BUDGET[q].calls})`);
      h.expect(s.tris > 10000 && s.tris <= BUDGET[q].tris, `${q}: ${s.tris} triangles (<= ${BUDGET[q].tris})`);
      await h.shot("quality-" + q);
    }

    h.eq(errors, [], "zero console errors in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
