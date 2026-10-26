/* Lokféierer: props of a big station yard (TS.stationYardProps.build, called by station-yard.js): the blue "Voie" signs hanging from the canopy columns, benches and clocks on the
 * platforms, and the forecourt: a Luxtram standing at its stop and the buses at the bus stops of the patch.  Everything is a handful of vertex-coloured boxes and textured quads. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;

  const SIGN_W = 1.7;
  const SIGN_H = 0.64;
  const BENCH_STEP = 34;
  const TRAM_X = -62.2;                  // the Luxtram track of the stop (OSM), west of the building
  const TRAM_LEN = 33;
  const TRAM_Z0 = 2;
  const BUS_LEN = 12;

  function build(o) {
    const { patch, data, world, track, MB, signs, railPlatforms, platTop, add, mat, canvasTexture, signTexture, inRing, style } = o;
    const Y = style.yard || {};
    const voie = Y.voie || {};

    /* ---- "Voie" signs: two faces (towards and away from the driver) hanging from the column, under the canopy */
    {
      const groups = new Map();
      signs.forEach((s) => {
        const label = voie[s.pi] || '';
        if (!label) return;
        const ang = (() => { const a = world(0, s.z); const b = world(0, s.z - 1); return Math.atan2(-(b.x - a.x), -(b.z - a.z)); })();
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push({ s, ang });
      });
      groups.forEach((list, label) => {
        const mb = new MB();
        list.forEach(({ s, ang }) => {
          const dx = Math.sin(ang); const dz = Math.cos(ang);     // forward direction in world xz (towards -z of the patch)
          const px = -dz; const pz = dx;                          // perpendicular
          [1, -1].forEach((side) => {
            const cx = s.w.x + dx * 0.22 * side; const cz = s.w.z + dz * 0.22 * side; const y = s.y;
            const hx = px * SIGN_W / 2; const hz = pz * SIGN_W / 2;
            const nx = dx * side; const nz = dz * side;
            const a = mb.vert(cx - hx, y - SIGN_H / 2, cz - hz, nx, 0, nz, [1, 1, 1], side > 0 ? 0 : 1, 0);
            const b = mb.vert(cx + hx, y - SIGN_H / 2, cz + hz, nx, 0, nz, [1, 1, 1], side > 0 ? 1 : 0, 0);
            const c = mb.vert(cx + hx, y + SIGN_H / 2, cz + hz, nx, 0, nz, [1, 1, 1], side > 0 ? 1 : 0, 1);
            const d = mb.vert(cx - hx, y + SIGN_H / 2, cz - hz, nx, 0, nz, [1, 1, 1], side > 0 ? 0 : 1, 1);
            mb.i.push(a, b, c, a, c, d);
          });
        });
        if (!mb.empty) {
          const tex = signTexture(label);
          const m = mat(new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide, emissive: 0x16305c }));
          tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
          add(new T.Mesh(mb.geometry(), m));
        }
      });
    }

    /* ---- benches (steel, perforated) on the platforms, facing the tracks on both sides of the platform centre line */
    {
      const mb = new MB();
      const STEEL = [0.25, 0.27, 0.3]; const LEG = [0.1, 0.11, 0.12];
      railPlatforms.forEach((p) => {
        const xs = p.ring.map((q) => q[0]); const zs = p.ring.map((q) => q[1]);
        const xc = (Math.min(...xs) + Math.max(...xs)) / 2 + 1.3;
        for (let z = Math.min(...zs) + 20; z < Math.max(...zs) - 14; z += BENCH_STEP) {
          if (!inRing(p.ring, xc, z)) continue;
          const w = world(xc, z); const w2 = world(xc, z - 1);
          const yaw = Math.atan2(-(w2.x - w.x), -(w2.z - w.z));
          const y = w.form + platTop;
          const c = Math.cos(yaw); const s = Math.sin(yaw);
          const at = (dx, dy, sx, sy, sz, col) => mb.box(w.x + dx * c, y + dy, w.z - dx * s, sx, sy, sz, col, yaw);
          at(0, 0.45, 0.5, 0.06, 1.8, STEEL); at(0.25, 0.8, 0.06, 0.42, 1.8, STEEL); at(0, 0.22, 0.4, 0.44, 0.12, LEG); at(0, 0.22, 0.4, 0.44, 0.12, LEG);
        }
      });
      if (!mb.empty) add(new T.Mesh(mb.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true }))), true);
    }

    /* ---- the Luxtram at its stop and buses at the bus stops */
    {
      const mb = new MB();
      const SILVER = [0.42, 0.44, 0.47]; const DARK = [0.02, 0.03, 0.04]; const GREY = [0.16, 0.17, 0.19]; const RED = [0.45, 0.04, 0.04]; const WHITE = [0.7, 0.7, 0.69]; const GREEN = [0.25, 0.5, 0.04];
      const yawAt = (x, z) => { const a = world(x, z); const b = world(x, z - 1); return Math.atan2(-(b.x - a.x), -(b.z - a.z)); };
      /* a vehicle along the track direction: parts = [dz offset, length, width, y0, y1, colour] */
      const vehicle = (x, z, yaw, parts, gy) => parts.forEach(([dz, len, wd, y0, y1, col, dx]) => {
        const c = Math.cos(yaw); const s = Math.sin(yaw);
        // yaw rotates the local +z (patch back) axis; local offset (dx, dz) -> world
        const w = world(x, z);
        const ox = (dx || 0) * c + dz * s; const oz = -(dx || 0) * s + dz * c;
        mb.box(w.x + ox, gy + (y0 + y1) / 2, w.z + oz, wd, y1 - y0, len, col, yaw);
      });
      const tw = world(TRAM_X, TRAM_Z0 + TRAM_LEN / 2);
      const tgy = track.terrainHeightAt(tw.x, tw.z) + 0.2;
      const tyaw = yawAt(TRAM_X, TRAM_Z0 + TRAM_LEN / 2);
      // five articulated sections, silver body, dark window band, grey roof, a green stripe (Luxtram livery)
      for (let k = 0; k < 5; k++) {
        const dz = -TRAM_LEN / 2 + 3.3 + k * 6.6;
        vehicle(TRAM_X, TRAM_Z0 + TRAM_LEN / 2, tyaw, [
          [dz, 6.4, 2.4, 0.35, 3.3, SILVER], [dz, 6.42, 2.44, 1.0, 2.2, DARK], [dz, 6.0, 2.0, 3.3, 3.55, GREY], [dz, 6.43, 2.46, 0.55, 0.8, GREEN],
        ], tgy);
      }
      vehicle(TRAM_X, TRAM_Z0 + TRAM_LEN / 2, tyaw, [[-TRAM_LEN / 2 - 0.1, 0.6, 2.2, 0.5, 2.9, DARK], [TRAM_LEN / 2 + 0.1, 0.6, 2.2, 0.5, 2.9, DARK]], tgy);
      (data.poi || []).forEach((p) => {
        if (p.t !== 'bus_stop' || p.x > -40 || p.x < -110 || Math.abs(p.z) > 200) return;
        const yaw = yawAt(p.x, p.z);
        // the bus stands 2.5 m in front of the stop post, on the carriageway side
        const bw = world(p.x + 3.0, p.z); const gy = track.terrainHeightAt(bw.x, bw.z) + 0.2;
        vehicle(p.x + 3.0, p.z, yaw, [[0, BUS_LEN, 2.55, 0.35, 3.0, RED], [0, BUS_LEN + 0.02, 2.57, 1.0, 2.2, DARK], [0, BUS_LEN - 0.4, 2.2, 3.0, 3.2, WHITE]], gy);
      });
      if (!mb.empty) add(new T.Mesh(mb.geometry(), mat(new T.MeshLambertMaterial({ vertexColors: true }))), true);
    }
    void canvasTexture;
  }

  TS.stationYardProps = Object.freeze({ build });
})();
