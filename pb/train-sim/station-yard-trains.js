/* Zuchsimulator W3: trains standing at the platforms of a big station (TS.stationYardTrains.build), called by station-yard.js for a style whose `yard.trains` is set.
 *
 * The cars are the game's own train models (trains.js: TS.trains.create, CFL-white / SNCB-blue liveries), baked with the Luxtram draw-call diet (luxtram-traffic.js createBake:
 * <= 9 meshes for the whole train, one per material class) and parked on a real track beside a real platform of the patch.
 * style.yard.trains = [{ plat: index of the platform polygon in x order (0 = the player's), model, cars, kind: 'cfl' | 'cfl2' | 'sncb' }]; the train stands on the track next to the
 * platform's right-hand edge (left edge when there is none), centred on the platform. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] yard trains: ';
  const EDGE_GAP = 1.95;          // m from the platform edge to the track axis
  const MAX_DX = 0.9;             // tolerance of the track position
  const LIVERIES = Object.freeze({
    cfl: { body: '#e7e8ea', accent: '#c8312b', stripe: '#1b3a6b' },
    cfl2: { body: '#dfe3e6', accent: '#b02a28', stripe: '#1b3a6b' },
    sncb: { body: '#cfd6de', accent: '#1d4f93', stripe: '#f2c230' },
  });
  const CAR_GAP = 0.35;

  /* the point of a real track (patch coordinates) at x = target near z = zc, with its direction; null if no track is there */
  function trackAt(rails, resample, x, zc) {
    let best = null;
    rails.forEach((r) => {
      if (r.kind === 'tram' || !r.pts || r.pts.length < 2) return;
      resample(r.pts, 2).forEach((q) => {
        const d = Math.abs(q[0] - x);
        if (d > MAX_DX || Math.abs(q[1] - zc) > 12) return;
        if (!best || d + Math.abs(q[1] - zc) * 0.02 < best.score) best = { x: q[0], z: q[1], score: d + Math.abs(q[1] - zc) * 0.02, r };
      });
    });
    return best;
  }

  function build(o) {
    const { data, world, group, disposables, stats, style, resample, inRing, RAIL_HEAD } = o;
    const Y = style.yard || {};
    if (!TS.trains || !TS.trains.create || !TS.luxTraffic || !TS.luxTraffic._bake) return;
    const rings = (data.platforms || []).filter((p) => p.ring && p.ring.length > 2 && p.ring.every((q) => q[0] > (Y.platformFrom === undefined ? -25 : Y.platformFrom)))
      .map((p) => p.ring).sort((a, b) => Math.min(...a.map((q) => q[0])) - Math.min(...b.map((q) => q[0])));
    let placed = 0;
    (Y.trains || []).forEach((spec) => {
      try {
        const ring = rings[spec.plat];
        if (!ring) return;
        const xs = ring.map((q) => q[0]); const zs = ring.map((q) => q[1]);
        const x0 = Math.min(...xs); const x1 = Math.max(...xs); const z0 = Math.min(...zs); const z1 = Math.max(...zs);
        const model = TS.trains.create({ model: spec.model || 'emu', cars: spec.cars || 2 }, { quality: 'low', livery: LIVERIES[spec.kind] || LIVERIES.cfl });
        const total = model.totalLength + CAR_GAP * (model.cars.length - 1);
        // the platform is wider than a train: stand it in its middle, then look for the track beside it (right edge first), moving along the platform until one is found
        let hit = null; let side = 1;
        for (const sd of [1, -1]) {
          for (let dz = 0; dz <= (z1 - z0 - total) / 2 && !hit; dz += 6) {
            for (const sgn of [1, -1]) {
              const zc = (z0 + z1) / 2 + dz * sgn;
              hit = trackAt(data.rails || [], resample, sd > 0 ? x1 + EDGE_GAP : x0 - EDGE_GAP, zc);
              if (hit && !inRing(ring, sd > 0 ? x1 - 0.8 : x0 + 0.8, hit.z)) hit = null;
              if (hit) { side = sd; break; }
            }
          }
          if (hit) break;
        }
        if (!hit) { model.dispose(); return; }
        // direction along that track at the hit (patch coordinates), then world frame
        const pts = resample(hit.r.pts, 2);
        const idx = pts.reduce((bi, q, i) => (Math.hypot(q[0] - hit.x, q[1] - hit.z) < Math.hypot(pts[bi][0] - hit.x, pts[bi][1] - hit.z) ? i : bi), 0);
        const a = pts[Math.max(0, idx - 8)]; const b = pts[Math.min(pts.length - 1, idx + 8)];
        let dx = b[0] - a[0]; let dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        if (dz > 0) { dx = -dx; dz = -dz; }                                   // the train faces -z (towards the buffer stops / the Luxembourg end)
        const frontP = [hit.x + dx * total / 2, hit.z + dz * total / 2];
        const bake = TS.luxTraffic._bake(model, { doors: false });
        model.cars.forEach((c, i) => bake.addCar(c, i));
        const before = group.children.length;
        bake.finish(group);
        for (let k = before; k < group.children.length; k++) { const m = group.children[k]; if (m.geometry) disposables.push(m.geometry); if (m.material) disposables.push(m.material); }
        let off = 0;
        model.cars.forEach((c, i) => {
          const d = off + c.length / 2; off += c.length + CAR_GAP;
          const cx = frontP[0] - dx * d; const cz = frontP[1] - dz * d;
          const w = world(cx, cz); const wf = world(cx + dx, cz + dz);
          const f = new T.Vector3(wf.x - w.x, 0, wf.z - w.z).normalize();
          const bz = f.clone().multiplyScalar(-1); const by = new T.Vector3(0, 1, 0); const bx = new T.Vector3().crossVectors(by, bz).normalize();
          const m = new T.Matrix4().makeBasis(bx, by, bz).setPosition(w.x, w.form + RAIL_HEAD, w.z);
          bake.uCars.value.set(m.elements, i * 16);
        });
        bake.setVisible(true);
        model.setPantograph(1);
        placed += 1;
        void side;
      } catch (e) { console.warn(TAG + 'a standing train failed', e); }
    });
    stats.yardTrains = placed;
  }

  TS.stationYardTrains = Object.freeze({ build });
})();
