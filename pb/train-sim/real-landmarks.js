/* Zuchsimulator W2c: hand-modelled landmarks of the Luxembourg routes at their REAL positions (OSM / Wikipedia, 26 Oct 2026).
 *   TS.realLandmarks.resolve(track) -> [{ kind, s, lat, name }]  (track frame: s along, lat to the right; a reversed service mirrors both)
 *   TS.realLandmarks.draw(kind, ctx)  draws one landmark into the landscape chunk meshes (ctx = { T, mbHouse, mbRoof, mbBlock, at, C, mixColor, clamp, addCastle })
 * Positions are given relative to a station of the route (metres ahead of the stop / to the right of the track), measured from the OSM coordinates with the station's heading:
 *   Belval blast furnace A 49.50126 N 5.94802 E, B 49.50215 N 5.94821 E (station Belval-Université 49.49971 / 5.94609, heading 304.5 deg);
 *   Clervaux castle 50.05443 / 6.03014, Saint-Maurice abbey 50.05717 / 6.0222 (station Clierf 50.06157 / 6.02473, heading 0.5 deg).
 * Beyond the station block the real route is compressed (build_real_route.py: legs x 0.27), so a landmark more than BLOCK m from its station is pulled in along s by the same factor;
 * the lateral offset is kept (clamped to MAX_LAT, the far limit of drawn objects); `onStrip` landmarks (hills: the ground height is only known inside the terrain strip) are pulled in to the strip edge by landscape.js. */
(function () {
  'use strict';
  const TS = window.TS;
  if (!TS) return;
  const BLOCK = 250;       // metres around a station that keep their real length
  const COMPRESS = 0.27;   // the legs between stations (build_real_route.py)
  const MAX_LAT = 300;

  const DEFS = {
    south: [
      { kind: 'furnace', name: 'Belval hauts fourneaux A', station: 'Belval-Université', along: -17, lat: 222, yaw: 0.35 },
      { kind: 'furnace', name: 'Belval hauts fourneaux B', station: 'Belval-Université', along: 28, lat: 300, yaw: 0.35, scale: 0.9 },
    ],
    north: [
      { kind: 'castle', name: 'Clervaux castle', station: 'Clierf', along: -795, lat: 387, onStrip: true },
      { kind: 'abbey', name: 'Saint-Maurice abbey', station: 'Clierf', along: -490, lat: -180, onStrip: true },
    ],
  };

  const eff = (a) => (Math.abs(a) <= BLOCK ? a : Math.sign(a) * (BLOCK + (Math.abs(a) - BLOCK) * COMPRESS));

  function resolve(track) {
    const defs = DEFS[String(track.id).replace('~r', '')] || [];
    const rev = !!track.reverse;
    const out = [];
    defs.forEach((d) => {
      const st = (track.stations || []).find((x) => x.name === d.station);
      if (!st) return;
      const mid = (st.platformStart + st.platformEnd) / 2;
      const along = eff(d.along);
      const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, d.lat));
      out.push(Object.assign({}, d, { s: rev ? mid - along : mid + along, lat: rev ? -lat : lat }));
    });
    return out;
  }

  /* ---- blast furnace (Belval): furnace stack on its hearth, dust catcher, three Cowper stoves, down-comer + bustle pipe, skip hoist, rusty steel */
  function furnace(c, sc) {
    const { T, mbBlock, at, C } = c;
    const rust = C('#7b4a35'); const dark = C('#3d3a38'); const steel = C('#8d8f90'); const red = C('#a5553a');
    const cyl = (r0, r1, h, x, y, z, col, seg) => mbBlock.addGeo(new T.CylinderGeometry(r1 * sc, r0 * sc, h * sc, seg || 14), at(x * sc, y * sc, z * sc), col, true);
    // furnace: hearth, bosh, stack, throat
    cyl(6.5, 6.5, 9, 0, 4.5, 0, rust);
    cyl(6.5, 8.4, 7, 0, 12.5, 0, rust);
    cyl(8.4, 5.4, 24, 0, 28, 0, rust);
    cyl(5.4, 4.2, 6, 0, 43, 0, dark);
    mbBlock.addGeo(new T.ConeGeometry(3.4 * sc, 5 * sc, 12), at(0, 48.5 * sc, 0), dark, true);
    // bustle pipe ring and tuyere platform
    mbBlock.addGeo(new T.TorusGeometry(8.6 * sc, 0.7 * sc, 6, 24), at(0, 10 * sc, 0, 0).multiply(new T.Matrix4().makeRotationX(Math.PI / 2)), steel, true);
    // down-comer pipes from the top to the dust catcher
    cyl(1.3, 1.3, 46, 7.5, 29, 0, steel, 8);
    cyl(1.3, 1.3, 20, 11, 49, 0, steel, 8);
    // dust catcher
    cyl(5.2, 5.2, 24, 20, 12, 0, rust);
    mbBlock.addGeo(new T.ConeGeometry(5.2 * sc, 8 * sc, 14), at(20 * sc, 28 * sc, 0), rust, true);
    mbBlock.addGeo(new T.ConeGeometry(5.2 * sc, 8 * sc, 14).rotateX(Math.PI), at(20 * sc, -4 * sc, 0), rust, true);
    // three hot-blast stoves in a row behind
    [-16, 0, 16].forEach((dz) => {
      cyl(5.6, 5.6, 40, -22, 20, dz, red);
      mbBlock.addGeo(new T.SphereGeometry(5.6 * sc, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), at(-22 * sc, 40 * sc, dz * sc), red, true);
    });
    // chimney of the stoves
    cyl(2.2, 3.4, 70, -34, 35, 0, C('#6e5a4c'), 12);
    // skip hoist: inclined truss from the ground in front to the top
    const hoist = new T.BoxGeometry(2.2 * sc, 0.8 * sc, 62 * sc);
    mbBlock.addGeo(hoist, at(0, 26 * sc, -28 * sc).multiply(new T.Matrix4().makeRotationX(0.62)), steel, true);
    mbBlock.addGeo(new T.BoxGeometry(10 * sc, 8 * sc, 14 * sc), at(0, 4 * sc, -44 * sc), C('#6a6c6e'), true);
  }

  /* ---- Saint-Maurice abbey (Clervaux): twin-towered church, long conventual wings, cream sandstone, grey slate */
  function abbey(c) {
    const { T, mbHouse, mbRoof, at, C } = c;
    const wall = C('#cfc6b0'); const roof = C('#4d535a');
    mbHouse.addGeo(new T.CylinderGeometry(36, 62, 34, 18), at(-9, -14, 8), (v, n) => c.mixColor(C('#6a7d4a'), C('#8b8a7c'), c.clamp(0.0 + (1 - n.y) * 0.7, 0, 1)), true);   // mound of the hill the abbey stands on
    mbHouse.addGeo(new T.BoxGeometry(16, 15, 38), at(0, 7.5, 0), wall, true);                   // nave
    mbRoof.addGeo(new T.CylinderGeometry(0.1, 9.6, 6, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 2.4), at(0, 18, 0), roof);
    [-5.5, 5.5].forEach((x) => {                                                                // west towers
      mbHouse.addGeo(new T.BoxGeometry(5, 30, 5), at(x, 15, -21), wall, true);
      mbRoof.addGeo(new T.ConeGeometry(4.2, 9, 4, 1).rotateY(Math.PI / 4), at(x, 34.5, -21), roof);
    });
    mbHouse.addGeo(new T.BoxGeometry(14, 11, 46), at(-24, 5.5, 8), wall, true);                 // monastery wings
    mbRoof.addGeo(new T.CylinderGeometry(0.1, 8.6, 5, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 3.4), at(-24, 13.5, 8), roof);
    mbHouse.addGeo(new T.BoxGeometry(40, 11, 13), at(-8, 5.5, 33), wall, true);
    mbRoof.addGeo(new T.CylinderGeometry(0.1, 8, 4.6, 4, 1).rotateY(Math.PI / 4).scale(2.7, 1, 1), at(-8, 13.3, 33), roof);
  }

  function draw(kind, ctx) {
    if (kind === 'furnace') furnace(ctx, ctx.scale || 1);
    else if (kind === 'abbey') abbey(ctx);
    else if (kind === 'castle') {
      ctx.mbHouse.addGeo(new ctx.T.CylinderGeometry(24, 34, 16, 14), ctx.at(0, -4, 0), (v, n) => ctx.mixColor(ctx.C('#6a7d4a'), ctx.C('#8b8a7c'), ctx.clamp(0.2 + (1 - n.y) * 1.6, 0, 1)), true);
      ctx.addCastle(ctx.mbHouse, ctx.mbRoof, ctx.at(0, 4, 0));
    }
  }

  TS.realLandmarks = Object.freeze({ resolve, draw, DEFS });
})();
