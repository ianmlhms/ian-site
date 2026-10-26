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
      { kind: 'furnace', name: 'Belval hauts fourneaux B', station: 'Belval-Université', along: 28, lat: 300, yaw: 0.35, scale: 0.85 },
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

  /* ---- blast furnace (Belval, after the Commons photos "Blast furnace A / B Belval" and "Les hauts-fourneaux A et B avec cowpers"): a slim open steel tower round the furnace shell
     (platforms every 11 m, charging gantry on top), the inclined skip hoist, four tall cowper stoves, a fat dust catcher, a brick chimney and a tangle of down-comer / hot-blast pipes,
     all in black-brown rust */
  function furnace(c, sc) {
    const { T, mbBlock, at, C } = c;
    const V = (x, y, z) => new T.Vector3(x * sc, y * sc, z * sc);
    const dark = C('#3b3430'); const rust = C('#6a4333'); const rust2 = C('#7d4d38'); const steel = C('#4a4a4c'); const brick = C('#8a4b37'); const pipeC = [C('#6e4636'), C('#55504c'), C('#8a5a42')];
    const cyl = (r0, r1, h, x, y, z, col, seg) => mbBlock.addGeo(new T.CylinderGeometry(r1 * sc, r0 * sc, h * sc, seg || 14), at(x * sc, y * sc, z * sc), col, true);
    const box = (w, h, d, x, y, z, col, rot) => mbBlock.addGeo(new T.BoxGeometry(w * sc, h * sc, d * sc), at(x * sc, y * sc, z * sc, rot || 0), col, true);
    const pipe = (a, b, r, col) => {            // cylinder between two local points
      const p = V(...a); const q = V(...b); const d = new T.Vector3().subVectors(q, p); const len = d.length();
      const m = new T.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()), new T.Vector3(1, 1, 1));
      mbBlock.addGeo(new T.CylinderGeometry(r * sc, r * sc, len, 8), at(0, 0, 0).multiply(m), col, true);
    };
    // furnace shell: hearth, bosh, stack, throat
    cyl(8, 8, 10, 0, 5, 0, rust);
    cyl(8, 10, 8, 0, 14, 0, rust2);
    cyl(10, 6.2, 34, 0, 35, 0, rust);
    cyl(6.2, 5, 8, 0, 56, 0, dark);
    // steel tower round it: 4 columns, platforms every 11 m, cross bracing, top gantry
    const TH = 84; const TW = 12;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, z]) => box(1.6, TH, 1.6, x * TW, TH / 2, z * TW, steel));
    for (let y = 11; y <= TH - 6; y += 11) { box(TW * 2 + 3, 0.7, TW * 2 + 3, 0, y, 0, dark); box(TW * 2 + 3, 1.1, 0.3, 0, y + 1, TW + 1.4, steel); box(TW * 2 + 3, 1.1, 0.3, 0, y + 1, -TW - 1.4, steel); }
    for (let y = 0; y < TH - 12; y += 22) { pipe([-TW, y, TW], [TW, y + 22, TW], 0.35, steel); pipe([TW, y, -TW], [-TW, y + 22, -TW], 0.35, steel); pipe([TW, y, TW], [TW, y + 22, -TW], 0.35, steel); }
    box(TW * 2 + 6, 7, TW * 2 - 2, 0, TH + 3.5, 0, dark);                  // charging gantry house
    box(8, 12, 8, 0, TH + 13, 0, steel);
    mbBlock.addGeo(new T.ConeGeometry(5 * sc, 7 * sc, 10), at(0, (TH + 22) * sc, 0), dark, true);
    // skip hoist: inclined lattice from a pit in front to the gantry
    pipe([0, 3, -78], [0, TH + 6, -TW + 2], 0.9, steel); pipe([3, 3, -78], [3, TH + 6, -TW + 2], 0.9, steel);
    for (let t = 0.1; t < 1; t += 0.12) { const y = 3 + (TH + 3) * t; const z = -78 + (78 - TW + 2) * t; box(3.4, 0.4, 0.4, 1.5, y, z, steel); }
    box(14, 9, 18, 1.5, 4.5, -86, C('#5d5b59'));                           // skip pit house
    // dust catcher + down-comer
    cyl(9, 9, 34, 26, 17, -6, rust2, 16);
    mbBlock.addGeo(new T.ConeGeometry(9 * sc, 9 * sc, 16), at(26 * sc, 38.5 * sc, -6 * sc), rust2, true);
    mbBlock.addGeo(new T.ConeGeometry(9 * sc, 8 * sc, 16).rotateX(Math.PI), at(26 * sc, -4 * sc, -6 * sc), rust2, true);
    pipe([2, TH - 4, 4], [20, TH + 4, 6], 2.0, pipeC[0]); pipe([20, TH + 4, 6], [26, 44, -6], 2.4, pipeC[0]);
    pipe([-2, 56, 6], [10, 70, 8], 1.6, pipeC[1]);
    // four cowper stoves in a row behind, each with a dome and a tangle of hot-blast pipes
    [0, 1, 2, 3].forEach((k) => {
      const z = -21 + k * 14; const hgt = 56 - (k % 2) * 4;
      cyl(6.4, 6.4, hgt, -34, hgt / 2, z, k % 2 ? rust : dark, 14);
      mbBlock.addGeo(new T.SphereGeometry(6.4 * sc, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), at(-34 * sc, hgt * sc, z * sc), k % 2 ? rust : dark, true);
      pipe([-34, hgt - 6, z], [-14, 36, 0], 1.1 + (k % 2) * 0.4, pipeC[(k + 1) % 3]);
      pipe([-34, 12, z], [-12, 22 + k * 3, 0], 0.9, pipeC[k % 3]);
    });
    pipe([-34, 46, -21], [-34, 46, 21], 1.3, pipeC[1]);                      // cold-blast main
    mbBlock.addGeo(new T.TorusGeometry(10.5 * sc, 1.1 * sc, 6, 24), at(0, 16 * sc, 0).multiply(new T.Matrix4().makeRotationX(Math.PI / 2)), pipeC[0], true);   // bustle pipe
    cyl(2.6, 4.2, 82, -52, 41, 4, brick, 12);                                // brick chimney of the stoves
    cyl(4.6, 4.8, 3, -52, 1.5, 4, C('#6d6560'), 12);
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
