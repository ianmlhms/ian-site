/* Lokféierer: level crossings that live inside a station patch (TS.patchCrossings).
 * A station patch (station-surround.js) carries the real OSM roads around the station.  When one of them crosses the track (Munsbach: Rue de Beyren,
 * about 108 m ahead of the platform middle), that road IS the crossing road: the crossing exists whatever the authored route says (the `X` flags of the
 * route layout), it sits where the real road crosses the line, and the road on both sides is the real road of the patch (station-roads.js draws it,
 * crossing-traffic.js lets the vehicles drive on it).  track.js calls merge() right after the route is compiled:
 *     comp.crossings = TS.patchCrossings.merge(comp.stations, comp.crossings);
 * An authored crossing within ADOPT_DIST of a patch crossing is the same crossing and is replaced by the patch one.
 * Crossing record: { s, hw, patch: { name, w, road: [{ x, z }] } } where `road` is the straightened centre line in the PATCH frame (x lateral, + = right of the
 * direction of travel; z along, ahead = negative), straight and perpendicular to the track over the crossing so that the deck of infra.js meets it. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const ROAD_CLASSES = ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service'];
  const ADOPT_DIST = 90;           // m: an authored crossing this close to a patch crossing is the same one
  const MAX_Z = 300;               // a crossing must lie within this distance of the platform middle
  const LEVEL_TOL = 1.2;           // m: the road must be at track level where it crosses (otherwise it is a bridge / underpass)
  const MIN_REACH_X = 8;           // the way through the tracks must reach at least this far (m) from the main track
  const MIN_X_SPAN = 5.5;          // the road must pass at least this far to the right of the main track (the second track lies at about +4)
  const STRAIGHT_X0 = -14.5;       // the road is perpendicular and straight between these lateral positions (the deck of infra.js is 13 m beyond the outer rails)
  const STRAIGHT_X1 = 18.5;
  const BLEND = 18;                // m over which the real course is blended back in
  const STEP = 4;                  // m between the samples of the straightened road
  const MAX_GRADE = 0.13;          // W2c: a road that climbs more than this over any 20 - 40 m (real hill roads: Kautebaach, Nidderkuer ...) is no crossing road for the game: vehicles cannot drive it
  const MIN_REACH = 60;            // ... and neither is a stub that ends within this distance of the track on one side (yard accesses)
  const GRADE_SPAN = [20, 40];
  const MAX_ROAD_X = 112;          // beyond this the real relief of the patch fades into the generic ground (station-surround.js FADE_X): the road ends here
  const MAX_STEP_GRADE = 0.11;     // the steepest 4 m step of the straightened road on the DEM (the planned profile is a little steeper; the world flow allows 18 %)
  const MAX_ROAD_Z = 235;          // ... and along the track (the fade is 240 - 320 m)
  const MAX_ABS_Y = 12;
  const EDGE_X = 14;               // lateral distance at which the road must be back at about track level (the strip is blended to the real relief between 5 and 9 m)
  const EDGE_MAX_Y = 1.5;

  const smooth01 = (t) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

  /* every road of the patch that crosses the main track at track level: [{ road index, zc, name, w, cls }] */
  function detect(data) {
    const out = [];
    (data.roads || []).forEach((rd, ri) => {
      if (!ROAD_CLASSES.includes(rd.cls) || rd.bridge) return;
      const pts = rd.pts || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]; const b = pts[i + 1];
        const lo = Math.min(a[0], b[0]); const hi = Math.max(a[0], b[0]);
        if (!(lo < -1 && hi > 0)) continue;                                        // the segment passes the main track (x = 0)
        const t = (0 - a[0]) / (b[0] - a[0]);
        const zc = a[1] + (b[1] - a[1]) * t;
        if (Math.abs(zc) > MAX_Z) continue;
        const yc = a[2] + (b[2] - a[2]) * t;
        if (Math.abs(yc) > LEVEL_TOL) continue;
        // it must also reach the far side of the second track
        const reach = pts.reduce((m, p) => Math.max(m, Math.abs(p[0] - 0)), 0);
        if (reach < MIN_REACH_X) continue;               // OSM splits a road at the crossing: the piece through the tracks can be short (the chain joins the rest)
        out.push({ roadIndex: ri, zc, name: rd.name || '', w: rd.w || 6, cls: rd.cls });
        break;
      }
    });
    return out;
  }

  /* OSM splits a road at every junction: follow the road on from both ends of the crossing way through the ways that join it (best continuation of the
     direction, at most JOIN_DIST between the ends), not into bridges.  Returns { pts: [{x, z}], used: [road indices] } */
  const JOIN_DIST = 4;
  const MIN_DOT = 0.25;
  const MAX_LEN = 700;
  function chain(data, ri) {
    const roads = data.roads;
    const ok = (r) => ROAD_CLASSES.includes(r.cls) && !r.bridge && (r.pts || []).length >= 2;
    const used = [ri];
    const walk = (list) => {
      let guard = 0;
      for (;;) {
        if (guard++ > 12) break;
        const e = list[list.length - 1]; const q = list[list.length - 2];
        const tx = e.x - q.x; const tz = e.z - q.z; const tl = Math.hypot(tx, tz) || 1;
        let best = null;
        roads.forEach((r, i) => {
          if (used.includes(i) || !ok(r)) return;
          [false, true].forEach((rev) => {
            const pts = rev ? r.pts.slice().reverse() : r.pts;
            if (Math.hypot(pts[0][0] - e.x, pts[0][1] - e.z) > JOIN_DIST) return;
            const dx = pts[1][0] - pts[0][0]; const dz = pts[1][1] - pts[0][1]; const dl = Math.hypot(dx, dz) || 1;
            const dot = (dx * tx + dz * tz) / (dl * tl);
            if (dot > MIN_DOT && (!best || dot > best.dot)) best = { i, pts, dot };
          });
        });
        if (!best) break;
        used.push(best.i);
        best.pts.slice(1).forEach((p) => list.push({ x: p[0], z: p[1] }));
        if (Math.abs(list[list.length - 1].x) > 160 || list.length > 400) break;
      }
      return list;
    };
    const first = roads[ri].pts.map((p) => ({ x: p[0], z: p[1] }));
    const forward = walk(first.slice());
    const backward = walk(forward.slice().reverse()).reverse();     // extend at the start by walking the reversed chain
    void MAX_LEN;
    return { pts: backward, used };
  }

  /* the chain straightened over the crossing, as a dense polyline in the patch frame */
  function straighten(pts0, zc) {
    const dense = [];
    const pts = pts0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
      for (let k = 0; k < n; k++) dense.push({ x: a.x + (b.x - a.x) * (k / n), z: a.z + (b.z - a.z) * (k / n) });
    }
    const last = pts[pts.length - 1];
    dense.push({ x: last.x, z: last.z });
    return dense.map((p) => {
      const d = p.x < STRAIGHT_X0 ? STRAIGHT_X0 - p.x : p.x > STRAIGHT_X1 ? p.x - STRAIGHT_X1 : 0;
      const w = smooth01(d / BLEND);                                               // 0 inside the straight part, 1 beyond the blend
      return { x: p.x, z: zc + (p.z - zc) * w };
    });
  }

  /* the real road must be usable by the traffic: gentle (relief from the patch DEM, outside the flattened track corridor) and long enough on both sides */
  function usable(data, pts) {
    const sd = TS.stationSurround;
    if (!sd || !sd.demAt || !data.demGrid) return true;
    const side = (sgn) => pts.reduce((m, p) => (Math.sign(p.x) === sgn ? Math.max(m, Math.abs(p.x)) : m), 0);
    if (Math.min(side(1), side(-1)) < MIN_REACH * 0.8) return false;
    // the road leaves the flattened track corridor (|x| <= 5 m) at track level: a cut or embankment right beside the line would make the first metres of the road a ramp
    const edge = (sgn) => pts.reduce((best, p) => (Math.sign(p.x) === sgn && (!best || Math.abs(Math.abs(p.x) - EDGE_X) < Math.abs(Math.abs(best.x) - EDGE_X)) ? p : best), null);
    const bad = [1, -1].some((sgn) => { const e = edge(sgn); return e && Math.abs(sd.demAt(data.demGrid, e.x, e.z)) > EDGE_MAX_Y; });
    if (bad) return false;
    const ys = pts.map((p) => (Math.abs(p.x) <= 8 ? null : sd.demAt(data.demGrid, p.x, p.z)));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    for (let i = 0; i < pts.length; i++) {
      if (ys[i] === null) continue;
      for (let j = i + 1; j < pts.length; j++) {
        const d = cum[j] - cum[i];
        if (d > GRADE_SPAN[1]) break;
        if (d >= GRADE_SPAN[0] && ys[j] !== null && Math.abs(ys[j] - ys[i]) / d > MAX_GRADE) return false;
      }
    }
    return true;
  }

  function gentleSteps(data, road) {
    const sd = TS.stationSurround;
    if (!sd || !sd.demAt || !data.demGrid) return true;
    if (road.some((p) => Math.abs(p.x) >= 6 && Math.abs(sd.demAt(data.demGrid, p.x, p.z)) > MAX_ABS_Y)) return false;   // a road far above / below the track is on the valley wall, not at grade
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1]; const b = road[i];
      if (Math.abs(a.x) < 6 && Math.abs(b.x) < 6) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 1) continue;
      if (Math.abs(sd.demAt(data.demGrid, b.x, b.z) - sd.demAt(data.demGrid, a.x, a.z)) / d > MAX_STEP_GRADE) return false;
    }
    return true;
  }

  /* stations: the compiled stations of the route; crossings: the authored ones.  Returns a new array (sorted by s). */
  function merge(stations, crossings, def) {
    const sd = TS.stationSurround;
    if (!sd || !sd.dataFor || !stations || !stations.length) return crossings;
    const found = [];
    stations.forEach((st) => {
      let data = null;
      try { data = sd.dataFor(st.name, def); } catch (e) { data = null; }
      if (!data || !data.roads) return;
      const sMid = (st.platformStart + st.platformEnd) / 2;
      detect(data).forEach((c) => {
        const ch = chain(data, c.roadIndex);
        const road = straighten(ch.pts, c.zc).filter((p) => Math.abs(p.x) <= MAX_ROAD_X && Math.abs(p.z) <= MAX_ROAD_Z);
        if (!usable(data, ch.pts) || !gentleSteps(data, road)) return;
        found.push({ s: sMid - c.zc, hw: Math.max(2.9, c.w / 2), patch: { name: st.name, sMid, roadIndex: c.roadIndex, roadName: c.name, w: c.w, cls: c.cls, zc: c.zc, used: ch.used, road } });
      });
    });
    if (!found.length) return crossings;
    const kept = (crossings || []).filter((cr) => !found.some((f) => Math.abs(cr.s - f.s) < ADOPT_DIST));
    return kept.concat(found).sort((a, b) => a.s - b.s);
  }

  TS.patchCrossings = Object.freeze({ merge, detect, chain, straighten, STRAIGHT_X0, STRAIGHT_X1 });
})();
