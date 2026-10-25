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
  const MIN_X_SPAN = 5.5;          // the road must pass at least this far to the right of the main track (the second track lies at about +4)
  const STRAIGHT_X0 = -14.5;       // the road is perpendicular and straight between these lateral positions (the deck of infra.js is 13 m beyond the outer rails)
  const STRAIGHT_X1 = 18.5;
  const BLEND = 18;                // m over which the real course is blended back in
  const STEP = 4;                  // m between the samples of the straightened road

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
        if (reach < MIN_X_SPAN * 2) continue;
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

  /* stations: the compiled stations of the route; crossings: the authored ones.  Returns a new array (sorted by s). */
  function merge(stations, crossings) {
    const sd = TS.stationSurround;
    if (!sd || !sd.dataFor || !stations || !stations.length) return crossings;
    const found = [];
    stations.forEach((st) => {
      let data = null;
      try { data = sd.dataFor(st.name); } catch (e) { data = null; }
      if (!data || !data.roads) return;
      const sMid = (st.platformStart + st.platformEnd) / 2;
      detect(data).forEach((c) => {
        const ch = chain(data, c.roadIndex);
        found.push({ s: sMid - c.zc, hw: Math.max(2.9, c.w / 2), patch: { name: st.name, sMid, roadIndex: c.roadIndex, roadName: c.name, w: c.w, cls: c.cls, zc: c.zc, used: ch.used, road: straighten(ch.pts, c.zc) } });
      });
    });
    if (!found.length) return crossings;
    const kept = (crossings || []).filter((cr) => !found.some((f) => Math.abs(cr.s - f.s) < ADOPT_DIST));
    return kept.concat(found).sort((a, b) => a.s - b.s);
  }

  TS.patchCrossings = Object.freeze({ merge, detect, chain, straighten, STRAIGHT_X0, STRAIGHT_X1 });
})();
