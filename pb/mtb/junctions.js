/* Where a trail could be mistaken: every point on a trail's carved line that sits on top of a real graph junction (an OSM node also touched by another
 * path, track or road that is NOT part of any trail). bake_ways.py already cuts every trail's own edges out of the plain way network, so a `path` /
 * `track` / `road` way's endpoint landing on a trail sample IS a real fork: the rider could physically ride that way instead of the trail.
 * Pure, no THREE: shared by the renderer (barrier tape + an arrow sign before the fork) and the harness (every fork found here must be marked). */

const cellKey = (gx, gz) => gx * 262144 + gz;                // integer grid cell -> map key (exact for any coordinate inside a 130 km box)
const RIDDEN_OTHER = Object.freeze(['path', 'track', 'road']);     // kinds that are a real alternative for a bike (not a river/stream/ditch)

/** Junctions of one trail: [{ x, z, approach: { x, z, yaw }, branches: [{ wayId, postA: {x,z}, postB: {x,z}, yaw }] }].
 *  `yaw` of a branch points AWAY from the trail, into the wrong way (the barrier faces the rider who turns off). */
export function findTrailJunctions(network, trailWay, opt = {}) {
  const tolerance = opt.tolerance ?? 3.0;          // m: how close another way's endpoint must land on the trail line to count as the same fork
  const clusterGap = opt.clusterGap ?? 10;          // trail samples: detections this close together are the same physical fork
  const approachDist = opt.approachDist ?? 7;       // m before the fork where the arrow sign stands
  const minClear = opt.minClear ?? 2.4;             // m: the barrier must stand at least this far from every trail sample (checked against the WHOLE trail: it may loop back nearby)
  const tapeSpan = opt.tapeSpan ?? 2.6;             // m: how wide the barrier is (it must reach past the branch's edges)
  const S = network.samples;
  const others = network.ways.filter((w) => RIDDEN_OTHER.includes(w.kind));
  // the endpoints of every other way in a grid (cell = tolerance): a trail sample only looks at its 3x3 cells instead of every way (this ran on the boot path: seconds on a school iPad)
  const endGrid = new Map();
  others.forEach((ow, oi) => {
    for (const endIsFirst of [true, false]) {
      const end = endIsFirst ? ow.first : ow.first + ow.count - 1;
      const key = cellKey(Math.floor(S.px[end] / tolerance), Math.floor(S.pz[end] / tolerance));
      const list = endGrid.get(key);
      if (list) list.push({ ow, oi, endIsFirst, end }); else endGrid.set(key, [{ ow, oi, endIsFirst, end }]);
    }
  });
  const hits = [];
  for (let i = trailWay.first; i < trailWay.first + trailWay.count; i++) {
    const tx = S.px[i], tz = S.pz[i], cx = Math.floor(tx / tolerance), cz = Math.floor(tz / tolerance);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = endGrid.get(cellKey(gx, gz));
        if (!list) continue;
        for (const e of list) {
          const dx = S.px[e.end] - tx, dz = S.pz[e.end] - tz;
          if (dx * dx + dz * dz > tolerance * tolerance) continue;
          hits.push({ i, way: e.ow, endIsFirst: e.endIsFirst, oi: e.oi });
        }
      }
    }
  }
  if (!hits.length) return [];
  hits.sort((a, b) => a.i - b.i || a.oi - b.oi || (b.endIsFirst ? 1 : 0) - (a.endIsFirst ? 1 : 0));     // trail order, then the original way / end order (the first hit of a way wins)
  const clusters = [[hits[0]]];
  for (let k = 1; k < hits.length; k++) {
    const last = clusters[clusters.length - 1];
    if (hits[k].i - last[last.length - 1].i <= clusterGap) last.push(hits[k]); else clusters.push([hits[k]]);
  }
  const CLEAR_CELL = Math.max(minClear, 1);
  const trailGrid = new Map();                      // the trail's own samples by cell: "is anything of the whole trail closer than minClear" without a scan of all of it
  for (let k = trailWay.first; k < trailWay.first + trailWay.count; k++) {
    const key = cellKey(Math.floor(S.px[k] / CLEAR_CELL), Math.floor(S.pz[k] / CLEAR_CELL));
    const list = trailGrid.get(key);
    if (list) list.push(k); else trailGrid.set(key, [k]);
  }
  const out = [];
  for (const cl of clusters) {
    const byWay = new Map();
    for (const h of cl) if (!byWay.has(h.way.id)) byWay.set(h.way.id, h);           // one barrier per distinct wrong way at this fork
    const atI = cl[Math.floor(cl.length / 2)].i;
    const jx = S.px[atI], jz = S.pz[atI];
    const i0 = Math.max(trailWay.first, atI - 3), i1 = Math.min(trailWay.first + trailWay.count - 1, atI + 3);
    let hx = S.px[i1] - S.px[i0], hz = S.pz[i1] - S.pz[i0];
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    let ai = atI, acc = 0;
    while (ai > trailWay.first && acc < approachDist) { acc += Math.hypot(S.px[ai] - S.px[ai - 1], S.pz[ai] - S.pz[ai - 1]); ai--; }
    // the whole trail, not just the samples near this fork: a trail can loop back close to itself elsewhere (hairpins, the marathon's long route)
    const isClear = (x, z) => {
      const cx = Math.floor(x / CLEAR_CELL), cz = Math.floor(z / CLEAR_CELL), r2 = minClear * minClear;
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = trailGrid.get(cellKey(gx, gz));
        if (list) for (const k of list) { const dx = S.px[k] - x, dz = S.pz[k] - z; if (dx * dx + dz * dz < r2) return false; }
      }
      return true;
    };
    const branches = [];
    const half = tapeSpan / 2;
    for (const h of byWay.values()) {
      const ow = h.way, dir = h.endIsFirst ? 1 : -1;
      const start = h.endIsFirst ? ow.first : ow.first + ow.count - 1;
      // walk the wrong way's own samples (not a straight projection: a path curves) until BOTH posts (straddling it) clear the trail corridor
      let at = start, prev = start, postA = null, postB = null;
      for (let step = 1; step < ow.count; step++) {
        const cand = start + dir * step;
        if (cand < ow.first || cand >= ow.first + ow.count) break;
        prev = at; at = cand;
        let tx = S.px[at] - S.px[prev], tz = S.pz[at] - S.pz[prev];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const px = -tz, pz = tx;
        const a = { x: S.px[at] + px * half, z: S.pz[at] + pz * half }, b = { x: S.px[at] - px * half, z: S.pz[at] - pz * half };
        if (isClear(a.x, a.z) && isClear(b.x, b.z)) { postA = a; postB = b; break; }
      }
      let cleared = !!postA;
      if (!postA) {                                                   // the branch never clears within its own samples (very short spur): push straight out from the fork instead, as far as it takes
        const tx0 = S.px[at] - jx, tz0 = S.pz[at] - jz; const tl0 = Math.hypot(tx0, tz0) || 1;
        const tx = tx0 / tl0, tz = tz0 / tl0, px = -tz, pz = tx;
        for (let d = minClear + half + 0.5; d < minClear + half + 60; d += 0.5) {
          const ex = jx + tx * d, ez = jz + tz * d;
          postA = { x: ex + px * half, z: ez + pz * half }; postB = { x: ex - px * half, z: ez - pz * half };
          if (isClear(postA.x, postA.z) && isClear(postB.x, postB.z)) { cleared = true; break; }
        }
      }
      // a branch that runs the whole trail's length within minClear (a short connector spur right next to the trail itself) gets no barrier: there is
      // nowhere to stand one that is not on the trail. The rider has nothing to turn onto there that reads as a separate path anyway.
      if (cleared) branches.push({ wayId: ow.id, postA, postB, yaw: Math.atan2(postA.z - postB.z, postA.x - postB.x) + Math.PI / 2 });
    }
    out.push({ x: jx, z: jz, approach: { x: S.px[ai], z: S.pz[ai], yaw: Math.atan2(hz, hx) }, branches });
  }
  return out;
}

/** Every trail's junctions in one list: [{ trailId, x, z, approach, branches }]. */
export function findAllJunctions(network, opt = {}) {
  const out = [];
  for (const way of network.ways) {
    if (way.kind !== 'trail') continue;
    const trailId = way.id.slice(6);
    for (const j of findTrailJunctions(network, way, opt)) out.push({ trailId, ...j });
  }
  return out;
}
