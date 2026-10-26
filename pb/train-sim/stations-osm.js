/* Zuchsimulator Lëtzebuerg: stations of the real single-line routes (north, south, west) that have no photo model: the platform layout comes from OSM.
 * The generic station of infra.js draws the player's platform, a canopy by size, furniture and the name signs; this module adds what the generic one lacks: the OTHER platforms
 * of the real station (count, side, width and length from the OSM platform polygons, build_real_route.py "plat") and the other tracks (addSiding).  The station building
 * is the real one of the station patch (station-surround.js, LOD2 + painted facade), so no building is drawn here.  Lateral frame as in stations-lu-b.js: l = distance from
 * the track centre towards the platform side (negative = far side), z = along the platform (the train drives towards -z).
 *   layout of a station: TS.realLines[routeId].stations[name] = { side, plat: [{ edge, w, s0, s1 }], trk: [lat], ... } with lat + s in the FORWARD direction of the route
 *   (right of travel positive, s along travel), as written by build_real_route.py.  A reversed route (track.reverse) mirrors both. */
(function () {
  'use strict';
  const TS = window.TS;
  if (!TS || !TS.realStations || !TS.realLines) return;

  const SECOND_TRACK_LAT = 4.5;      // infra.js draws the second main track this far from the player's track, on the side away from the platform
  const MAIN_TRACK_TOL = 1.1;        // OSM tracks within this of the drawn second track / the player's track are those
  const MAX_TRACK_LAT = 40;
  const MIN_PLATFORM_LEN = 25;
  const EDGE_MIN = 1.2;              // a platform edge closer than this to the track axis is the track's own platform
  const END_MARGIN = 14;             // platforms stop this far inside the station block (ramps and signals live beyond)
  const PLATFORM_COLOR = '#b4b1aa';
  const EDGE_COLOR = '#8f8c85';
  const SHELTER_COLOR = '#6f7a82';
  const MIN_SHELTER_PLATFORM_LEN = 60;

  const layoutOf = (name) => {
    const ids = Object.keys(TS.realLines);
    for (let i = 0; i < ids.length; i++) {
      const st = TS.realLines[ids[i]].stations[name];
      if (st) return st;
    }
    return null;
  };

  /* the platforms and tracks of the layout in the frame of the built station (l + = platform side, z along the train's travel) */
  function stationFrame(api, layout) {
    const sgActual = api.sx;                          // +1 when the platform is on the right of the player's travel
    const flip = !!(api.track && api.track.reverse);  // the layout is written for the forward direction
    const sgLat = flip ? -1 : 1;
    const toL = (lat) => sgActual * sgLat * lat;
    const toZ = (s) => (flip ? s : -s);
    return { toL, toZ };
  }

  function buildOsmStation(api) {
    const layout = layoutOf(api.st.name);
    if (!layout) return;
    const { sets, M, col, H, FORM_Y, zA, zB, pf, helpers } = api;
    const { toL, toZ } = stationFrame(api, layout);
    const vc = sets.get('vc', M.vc, true);
    const plat = sets.get('platform');
    const slab = col(PLATFORM_COLOR);
    const lip = col(EDGE_COLOR);
    const zLo = Math.min(zA, zB) + END_MARGIN;
    const zHi = Math.max(zA, zB) - END_MARGIN;

    const platforms = (layout.plat || []).map((p) => {
      const l0 = toL(p.edge);
      const l1 = toL(p.edge + Math.sign(p.edge) * Math.max(2.2, p.w));
      const za = toZ(p.s0);
      const zb = toZ(p.s1);
      return { edge: l0, far: l1, z0: Math.max(zLo, Math.min(za, zb)), z1: Math.min(zHi, Math.max(za, zb)) };
    }).filter((p) => p.z1 - p.z0 >= MIN_PLATFORM_LEN);
    // the player's platform: on the platform side, the one nearest to the track; infra.js draws it
    const own = platforms.filter((p) => p.edge > 0 && p.edge < EDGE_MIN + 3.5).sort((a, b) => a.edge - b.edge)[0];
    let farthest = -9.6;
    platforms.forEach((p) => {
      if (p === own) return;
      const inner = Math.min(p.edge, p.far);
      const outer = Math.max(p.edge, p.far);
      if (outer - inner < 2.0 || (inner < EDGE_MIN && outer > -EDGE_MIN)) return;   // would lie on the track corridor
      const mid = (inner + outer) / 2;
      const len = p.z1 - p.z0;
      const cz = (p.z0 + p.z1) / 2;
      vc.box(pf(mid), (H + FORM_Y) / 2 - 0.005, cz, outer - inner, H - FORM_Y - 0.01, len, slab);
      vc.box(pf(p.edge - Math.sign(p.edge) * 0.06), H - 0.3, cz, 0.12, 0.6, len, lip);
      plat.quad([pf(inner), H + 0.001, p.z0], [pf(outer), H + 0.001, p.z0], [pf(outer), H + 0.001, p.z1], [pf(inner), H + 0.001, p.z1], [0, 1, 0], api.WHITE,
        [[0, p.z0 / 4], [(outer - inner) / 4, p.z0 / 4], [(outer - inner) / 4, p.z1 / 4], [0, p.z1 / 4]]);
      if (len >= MIN_SHELTER_PLATFORM_LEN) addShelter(api, vc, pf(mid), cz, Math.min(14, len * 0.25), p.edge);
      farthest = Math.min(farthest, inner - 0.6);
      if (outer > 0) farthest = Math.min(farthest, -9.6);
    });

    // other tracks of the station (the second main track is drawn by infra.js; the player's own is the axis)
    (layout.trk || []).forEach((lat) => {
      const l = toL(lat);
      if (Math.abs(l) > MAX_TRACK_LAT || Math.abs(l) < EDGE_MIN + 1.5) return;
      if (Math.abs(l + SECOND_TRACK_LAT) < MAIN_TRACK_TOL) return;
      if (platforms.some((p) => l > Math.min(p.edge, p.far) - 0.2 && l < Math.max(p.edge, p.far) + 0.2)) return;   // a platform, not a track, lies there
      helpers.addSiding({ lat: l });
    });
    // the fence on the far side of the station area (the generic station draws it only without a model)
    if (helpers.addFence) helpers.addFence(vc, pf(Math.min(-9.6, farthest - 3)), zB - 5, zA + 5, 1.4, '#6d7378', 3);
  }

  /* a small glass shelter on a far platform: roof, back wall and a bench */
  function addShelter(api, vc, x, z, len, edge) {
    const { H, col } = api;
    const c = col(SHELTER_COLOR);
    const back = Math.sign(edge || 1) * 0.9;     // the back wall is on the side away from the track
    [-1, 1].forEach((d) => vc.box(x, H + 1.25, z + d * (len / 2 - 0.1), 0.1, 2.5, 0.1, c));
    vc.box(x + back * 0.2, H + 2.55, z, 2.0, 0.1, len + 0.4, c);
    vc.box(x + back, H + 1.0, z, 0.06, 1.7, len - 0.3, col('#9fb4bd'));
    vc.box(x + back * 0.4, H + 0.45, z, 0.4, 0.06, len * 0.6, col('#8a5a30'));
  }

  /* every station of the real routes without a photo model */
  const spec = { canopy: true, furniture: true, build: buildOsmStation, osm: true };
  Object.keys(TS.realLines).forEach((id) => {
    Object.keys(TS.realLines[id].stations).forEach((name) => {
      if (!TS.realStations.get(name)) TS.realStations.register(name, spec);
    });
  });
  TS.osmStations = Object.freeze({ layoutOf });
})();
