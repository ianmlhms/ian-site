/* Schueberfouer Tycoon: the walkway network as DATA (access wave).  Pure module (no THREE, no DOM): the NPC packer, the props, the clutter, the walk mask,
 * the crowd graph, the ground wear shader, the debug overlay and harness.js all read the same lists, so "where may people walk" has exactly one answer.
 * Frame: u along the tram toward NE, w toward Boulevard de la Foire (SE), metres (DESIGN 4.1).
 *
 *   ALLEYS      axis-aligned walkways { id, name, kind, u: [u0, u1], w: [w0, w1], min } (min = the width the validator insists on)
 *   SERVICE     the SE service lane: a strip along the SE rim, a quad { id, pts: [[u, w] x 4], width }
 *   ENTRANCES   the seven public entrances (E1..E7), each one with the id of the lane that leads in
 *   forecourtOf(pitch)  the clear area in front of a pitch: full pitch width, depth by size, stretched to the alley when the gap is small
 *   zones()     everything that must stay free of stalls / clutter: alleys + service lane + forecourts (+ the entrance paths, which are alleys)
 *   validateLayout(...)  the loud validator (harness.js + the fouer-access flow): widths, faces, forecourts, BFS reachability from every open entrance, footprints
 *
 * Rules (DESIGN 4.2, access wave): NPC stalls, tents, tables, crates, banners, plots dressing and camelots never intersect an alley, a forecourt or an entrance path.
 * The one exception is "kerb furniture": a lamp post / banner pole / bin (radius <= KERB_R) whose centre is at most KERB_OUT outside an alley edge may reach into the
 * forecourt strip of a pitch whose front is flush with that alley (a pole at the kerb line does not narrow the walkway).  Everything is data: moving an alley or a
 * pitch is a data edit here / in pitches.json, nothing else knows the numbers. */

import { SIZES } from "./data.js";

const EPS = 1e-6;

/* ------------------------------------------------------------------------------------------------ the field */
/** the Glacis outline in game metres (baked into the world bundle too; the fouer-access flow asserts that both agree) */
export const FIELD_POLY = Object.freeze([[26.14, 104.39], [26.25, 99.68], [17.26, 99.7], [15.61, 64.83], [13.14, 10.05], [109.17, 5.79], [110.92, 5.74], [112.26, 6.1], [114.92, 7.18], [117.28, 7.83], [119.12, 7.93], [130.14, 7.55], [135.76, 7.13], [137.19, 6.53], [141.65, 4.43], [145.14, 3.62], [210.03, 0.6], [231.01, 2.87], [250.63, 6.36], [258.74, 8.09], [278.95, 11.5], [283.73, 12.97], [287.82, 15.85], [290.82, 19.87], [292.42, 24.6], [292.46, 29.61], [290.95, 34.38], [260.02, 106.11], [260.18, 113.2], [242.33, 114.3], [242.55, 117.93], [240.17, 118.07], [240.56, 124.38], [240.35, 126.86], [240, 136.67], [239.94, 138.21]].map(p => Object.freeze(p)));

/** SE rim: the long straight edge from (26.1, 104.4) to (239.9, 138.2) */
export const rimW = u => 104.39 + (138.21 - 104.39) / (239.94 - 26.14) * (u - 26.14);

/* ------------------------------------------------------------------------------------------------ entrances */
/** the seven public entrances (DESIGN 4.2): kind 'boom' (SW, red-white barriers), 'portal' (NE, painted arch), 'gate' (frame + sign).  u,w game metres, face = outward direction,
 * star = the fair star that opens it, lane = the alley that leads in (the validator walks from the gate into the field along it) */
export const ENTRANCES = Object.freeze([
  { id: "E1", kind: "boom", u: 17, w: 56, face: "-u", star: 1, lane: "lane-e1" },
  { id: "E2", kind: "gate", u: 130, w: 118.5, face: "+w", star: 2, lane: "lane-e2" },
  { id: "E3", kind: "gate", u: 190, w: 127.5, face: "+w", star: 2, lane: "lane-e3" },
  { id: "E4", kind: "gate", u: 250, w: 110, face: "+w", star: 4, lane: "lane-e4" },
  { id: "E5", kind: "gate", u: 98, w: 5, face: "-w", star: 4, lane: "cross-a" },
  { id: "E6", kind: "gate", u: 178, w: 2.5, face: "-w", star: 5, lane: "lane-e6" },
  { id: "E7", kind: "portal", u: 282, w: 56, face: "+u", star: 3, lane: "lane-e7" },
].map(e => Object.freeze(e)));

/* ------------------------------------------------------------------------------------------------ the walkways */
const A = (id, kind, u, w, min, extra = {}) => Object.freeze({ id, name: id, kind, u: Object.freeze(u), w: Object.freeze(w), min, ...extra });

/** Haaptallee 12 m, Fressgaass 8 m, the south alley 7 m, cross alleys and entrance lanes 7 m, the Riserad passage 9 m.
 * `axis` = the direction people walk along (the crowd's centre line). */
export const ALLEYS = Object.freeze([
  A("haaptallee", "main", [16.5, 278], [50, 62], 12, { axis: "u" }),
  A("fressgaass", "main", [16, 289], [24, 32], 8, { axis: "u" }),
  A("sud-west", "main", [58, 114.5], [92, 99], 7, { axis: "u" }),
  A("sud-ost", "main", [110, 261.5], [93, 100], 7, { axis: "u" }),
  A("cross-wheel", "cross", [58, 67], [62, 100], 7, { axis: "w" }),       // the Riserad forecourt and the way from the Haaptallee to the south alley
  A("cross-seam", "cross", [171, 178], [62, 100], 7, { axis: "w" }),      // the gap between the M2 pitches: Haaptallee <-> south alley
  A("cross-west", "cross", [30, 37], [32, 50], 7, { axis: "w" }),         // Fressgaass <-> Haaptallee
  A("cross-a", "cross", [94.5, 101.5], [5.5, 50], 7, { axis: "w", entrance: "E5" }),      // street (E5) -> Fressgaass -> Haaptallee
  A("cross-c", "cross", [219.5, 226.5], [32, 50], 7, { axis: "w" }),
  A("lane-e1", "lane", [14, 20], [50, 62], 12, { axis: "u", entrance: "E1" }),       // the SW barrier booms: the Haaptallee runs out through them
  A("lane-e7", "lane", [276, 292], [50, 62], 12, { axis: "u", entrance: "E7" }),     // the NE portal: the Haaptallee runs out through it to the street
  A("lane-e6", "lane", [174.5, 181.5], [1.5, 24], 7, { axis: "w", entrance: "E6" }),
  A("lane-e2", "lane", [126.5, 133.5], [100, 121], 7, { axis: "w", entrance: "E2" }),
  A("lane-e3", "lane", [186.5, 193.5], [100, 130.5], 7, { axis: "w", entrance: "E3" }),
  A("lane-e4", "lane", [246.5, 253.5], [100, 114], 7, { axis: "w", entrance: "E4" }),
]);

/** the SE service lane: a 5.2 m strip 3 m inside the rim, from u 110 to 214, behind the S row (the entrance lanes E2 / E3 cross it) */
const SERVICE_U0 = 110, SERVICE_U1 = 214, SERVICE_HALF = 2.6, SERVICE_INSET = 3.0;
const svW = u => rimW(u) - SERVICE_INSET;
export const SERVICE = Object.freeze({
  id: "service", name: "service", kind: "service", min: 5, axis: "u",
  pts: Object.freeze([[SERVICE_U0, svW(SERVICE_U0) - SERVICE_HALF], [SERVICE_U1, svW(SERVICE_U1) - SERVICE_HALF], [SERVICE_U1, svW(SERVICE_U1) + SERVICE_HALF], [SERVICE_U0, svW(SERVICE_U0) + SERVICE_HALF]].map(p => Object.freeze(p))),
  line: Object.freeze([[SERVICE_U0, svW(SERVICE_U0)], [SERVICE_U1, svW(SERVICE_U1)]]),
  width: 2 * SERVICE_HALF,
});

/* ------------------------------------------------------------------------------------------------ forecourts */
/** minimum forecourt depth per size (m), and the depth this module builds (a little more than the minimum) */
export const FORECOURT_MIN = Object.freeze({ S: 3, M: 5, L: 7, XL: 9, W: 9 });
export const FORECOURT_DEPTH = Object.freeze({ S: 3.5, M: 5.5, L: 7.5, XL: 9, W: 9 });
/** a gap between a pitch front and its alley up to this is paved over (part of the forecourt); a larger gap is a layout error */
export const APRON_MAX = 6.5;
/** a face may point to an alley this much farther away than the nearest one (pitches between two alleys, ties) */
export const FACE_TOLERANCE = 1.5;
/** kerb furniture: radius <= KERB_R, centre at most KERB_OUT metres outside an alley edge */
export const KERB_R = 0.26, KERB_OUT = 0.6;
/** queue rows (crowd.js queueSlot): slot k stands QUEUE_OUT m in front of the front edge, QUEUE_START + k * QUEUE_STEP m along it, on either side of the middle.  The first
 * QUEUE_RESERVED slots of both sides are reserved like the forecourt (zone `queue-<id>`: nothing of the NPC fair, props or clutter may stand there), so a queue row always fits. */
export const QUEUE_OUT = 3.0, QUEUE_START = 0.6, QUEUE_STEP = 0.85, QUEUE_RESERVED = 8, QUEUE_DEPTH = 3.6;
const QUEUE_HALF = QUEUE_START + QUEUE_STEP * (QUEUE_RESERVED - 1) + 0.4;
/** how far NPC stalls keep back from the long alleys (1.2 m + the 0.25 m row margin: their 0.95 m awnings stay clear of the walkway); the dressing (tables, crates, A-frames, bins) fills the gaps between them */
export const FRONTAGE = Object.freeze({ main: 1.2, cross: 0.8, lane: 0.8, service: 0.8 });

export const FACE_VEC = Object.freeze({ "+w": [0, 1], "-w": [0, -1], "+u": [1, 0], "-u": [-1, 0] });
export const rectOfPitch = p => { const s = SIZES[p.size] ?? SIZES.S; return { u0: p.u - s.u / 2, u1: p.u + s.u / 2, w0: p.w - s.w / 2, w1: p.w + s.w / 2 }; };
const rectOf = a => ({ u0: a.u[0], u1: a.u[1], w0: a.w[0], w1: a.w[1] });
const overlap1 = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
export const rectsOverlap = (a, b, pad = 0) => overlap1(a.u0, a.u1, b.u0 - pad, b.u1 + pad) > EPS && overlap1(a.w0, a.w1, b.w0 - pad, b.w1 + pad) > EPS;

/** the alley an (axis aligned) pitch front looks at: { alley, gap } with gap = metres between the front edge and the alley edge (0 = flush), or null */
export function frontAlley(p, face = p.face, alleys = ALLEYS) {
  const r = rectOfPitch(p); const [fu, fw] = FACE_VEC[face] ?? FACE_VEC["+w"];
  const lat = Math.min(3, (fu ? r.w1 - r.w0 : r.u1 - r.u0) / 2);
  let best = null;
  for (const a of alleys) {
    const q = rectOf(a);
    let gap, shared;
    if (fw > 0) { gap = q.w0 - r.w1; shared = overlap1(r.u0, r.u1, q.u0, q.u1); }
    else if (fw < 0) { gap = r.w0 - q.w1; shared = overlap1(r.u0, r.u1, q.u0, q.u1); }
    else if (fu > 0) { gap = q.u0 - r.u1; shared = overlap1(r.w0, r.w1, q.w0, q.w1); }
    else { gap = r.u0 - q.u1; shared = overlap1(r.w0, r.w1, q.w0, q.w1); }
    if (shared < lat - EPS || gap < -EPS) continue;
    if (!best || gap < best.gap) best = { alley: a, gap: Math.max(0, gap) };
  }
  return best;
}

/** the forecourt of a pitch: { u0, u1, w0, w1, depth, gap, alley, face } (full pitch width, `depth` metres out from the front edge) */
export function forecourtOf(p, alleys = ALLEYS) {
  const face = p.face ?? "+w"; const r = rectOfPitch(p); const [fu, fw] = FACE_VEC[face] ?? FACE_VEC["+w"];
  const hit = frontAlley(p, face, alleys);
  const base = FORECOURT_DEPTH[p.size] ?? 3.5;
  const gap = hit ? hit.gap : null;
  const depth = hit && gap <= APRON_MAX ? Math.max(base, gap) : base;
  const out = fw > 0 ? { u0: r.u0, u1: r.u1, w0: r.w1, w1: r.w1 + depth } : fw < 0 ? { u0: r.u0, u1: r.u1, w0: r.w0 - depth, w1: r.w0 }
    : fu > 0 ? { u0: r.u1, u1: r.u1 + depth, w0: r.w0, w1: r.w1 } : { u0: r.u0 - depth, u1: r.u0, w0: r.w0, w1: r.w1 };
  return { ...out, depth, gap, alley: hit ? hit.alley.id : null, face, id: p.id };
}

/** the reserved queue strip of a pitch: QUEUE_HALF either side of the middle, QUEUE_DEPTH deep, trimmed where another pitch stands in the way */
export function queueRectOf(p, pitches = [], alleys = ALLEYS) {
  void alleys;
  const face = p.face ?? "+w"; const r = rectOfPitch(p); const [fu, fw] = FACE_VEC[face] ?? FACE_VEC["+w"];
  let q = fu ? { u0: fu > 0 ? r.u1 : r.u0 - QUEUE_DEPTH, u1: fu > 0 ? r.u1 + QUEUE_DEPTH : r.u0, w0: p.w - QUEUE_HALF, w1: p.w + QUEUE_HALF }
    : { u0: p.u - QUEUE_HALF, u1: p.u + QUEUE_HALF, w0: fw > 0 ? r.w1 : r.w0 - QUEUE_DEPTH, w1: fw > 0 ? r.w1 + QUEUE_DEPTH : r.w0 };
  for (const o of pitches) {
    if (o.id === p.id) continue; const b = rectOfPitch(o);
    if (!rectsOverlap(q, b, 0.3)) continue;
    if (fu) { if (b.w0 + b.w1 > 2 * p.w) q = { ...q, w1: Math.min(q.w1, b.w0 - 0.3) }; else q = { ...q, w0: Math.max(q.w0, b.w1 + 0.3) }; }
    else if (b.u0 + b.u1 > 2 * p.u) q = { ...q, u1: Math.min(q.u1, b.u0 - 0.3) }; else q = { ...q, u0: Math.max(q.u0, b.u1 + 0.3) };
  }
  return q;
}
/** queue slot k of a pitch on one side (+1 / -1): the same formula as crowd.js queueSlot (frontSpot with out QUEUE_OUT and shift side * (QUEUE_START + QUEUE_STEP * k)) */
export function queueSlotOf(p, k, side = 1) {
  const r = rectOfPitch(p); const [fu, fw] = FACE_VEC[p.face ?? "+w"]; const shift = side * (QUEUE_START + QUEUE_STEP * k); const hd = fu ? (r.u1 - r.u0) / 2 : (r.w1 - r.w0) / 2;
  return { x: p.u + fu * (hd + QUEUE_OUT) - fw * shift, z: p.w + fw * (hd + QUEUE_OUT) + fu * shift };
}

/** every zone that must stay free: alleys, service lane, forecourts, queue strips.  { id, kind, rect?, poly?, pitch? } (rect = { u0, u1, w0, w1 }) */
export function zones(pitches = [], alleys = ALLEYS) {
  const out = alleys.map(a => ({ id: a.id, kind: a.kind, rect: rectOf(a), alley: true }));
  out.push({ id: SERVICE.id, kind: "service", poly: SERVICE.pts, alley: true });
  for (const p of pitches) {
    const f = forecourtOf(p, alleys); out.push({ id: "forecourt-" + p.id, kind: "forecourt", rect: { u0: f.u0, u1: f.u1, w0: f.w0, w1: f.w1 }, pitch: p.id, alley: false });
    out.push({ id: "queue-" + p.id, kind: "queue", rect: queueRectOf(p, pitches, alleys), pitch: p.id, alley: false });
  }
  return out;
}

/** corridors in the shape the older modules use ({ name, u: [a, b], w: [c, d], line? }): the crowd graph, the swept-ground shader, the NPC filler */
export function corridors() {
  const mains = ALLEYS.filter(a => a.axis === "u");
  const list = ALLEYS.map(a => {
    const c = { name: a.id, kind: a.kind, u: [...a.u], w: [...a.w] };
    if (a.axis === "u" && a.kind === "lane" && a.u[1] - a.u[0] >= 10) c.line = [[a.u[0], (a.w[0] + a.w[1]) / 2], [a.u[1] + 8, (a.w[0] + a.w[1]) / 2]];      // the portal path reaches out to the street: the crowd graph links the two
    if (a.axis === "w") {          // the centre line of a cross alley / lane runs to the centre of the long alley it joins (so the crowd graph crosses there)
      const reach = w => { const m = mains.find(q => q.id !== a.id && w >= q.w[0] - 0.6 && w <= q.w[1] + 0.6 && a.u[0] >= q.u[0] - 0.5 && a.u[1] <= q.u[1] + 0.5); return m ? (m.w[0] + m.w[1]) / 2 : w; };
      const cu = (a.u[0] + a.u[1]) / 2;
      c.line = [[cu, reach(a.w[0])], [cu, reach(a.w[1])]];
    }
    return c;
  });
  list.push({ name: SERVICE.id, kind: "service", u: [SERVICE_U0, SERVICE_U1], w: [Math.min(...SERVICE.pts.map(p => p[1])), Math.max(...SERVICE.pts.map(p => p[1]))], line: SERVICE.line.map(p => [...p]) });
  return list;
}

/* ------------------------------------------------------------------------------------------------ geometry helpers */
export function pointInPoly(poly, u, w) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, wi] = poly[i], [uj, wj] = poly[j];
    if ((wi > w) !== (wj > w) && u < (uj - ui) * (w - wi) / (wj - wi + 1e-12) + ui) ins = !ins;
  }
  return ins;
}
/** rectangle vs convex polygon (separating axis test); `pad` grows the rectangle */
export function rectHitsPoly(rect, poly, pad = 0) {
  const R = [[rect.u0 - pad, rect.w0 - pad], [rect.u1 + pad, rect.w0 - pad], [rect.u1 + pad, rect.w1 + pad], [rect.u0 - pad, rect.w1 + pad]];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const dx = b[0] - a[0], dw = b[1] - a[1]; axes.push([-dw, dx]); }
  for (const [ax, az] of axes) {
    let r0 = Infinity, r1 = -Infinity, p0 = Infinity, p1 = -Infinity;
    for (const [u, w] of R) { const d = u * ax + w * az; r0 = Math.min(r0, d); r1 = Math.max(r1, d); }
    for (const [u, w] of poly) { const d = u * ax + w * az; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
    if (r1 <= p0 + EPS || p1 <= r0 + EPS) return false;
  }
  return true;
}
const zoneHitsRect = (z, rect, pad = 0) => (z.rect ? rectsOverlap(rect, z.rect, pad) : rectHitsPoly(rect, z.poly, pad));
const circleRect = (u, w, r) => ({ u0: u - r, u1: u + r, w0: w - r, w1: w + r });
function distToRect(rect, u, w) { return Math.hypot(Math.max(rect.u0 - u, 0, u - rect.u1), Math.max(rect.w0 - w, 0, w - rect.w1)); }
function distToPoly(poly, u, w) {
  if (pointInPoly(poly, u, w)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]; const dx = b[0] - a[0], dw = b[1] - a[1]; const l2 = dx * dx + dw * dw || 1;
    const t = Math.max(0, Math.min(1, ((u - a[0]) * dx + (w - a[1]) * dw) / l2)); best = Math.min(best, Math.hypot(u - (a[0] + dx * t), w - (a[1] + dw * t)));
  }
  return best;
}

/** a reservation index: cheap "does this rectangle / circle touch an alley, the service lane or a forecourt" for the packers (built once per pitch list) */
export function createReservations(pitches = [], { alleys = ALLEYS } = {}) {
  const list = zones(pitches, alleys);
  const alleyZones = list.filter(z => z.alley), courtZones = list.filter(z => !z.alley);
  const api = {
    list, alleyZones, courtZones,
    /** rectangle touches a zone? (`pad` extra metres round the rectangle) */
    hits(rect, pad = 0) { return list.some(z => zoneHitsRect(z, rect, pad)); },
    hitsAlley(rect, pad = 0) { return alleyZones.some(z => zoneHitsRect(z, rect, pad)); },
    /** first zone a rectangle touches (for error messages) */
    firstHit(rect, pad = 0) { return list.find(z => zoneHitsRect(z, rect, pad)) ?? null; },
    /** stalls keep back from the long alleys by the frontage strip (tables, lamps and banners stand there): the rectangle must not touch an alley grown by it */
    hitsFrontage(rect) { return alleyZones.some(z => zoneHitsRect(z, rect, FRONTAGE[z.kind] ?? 0.8)); },
    inZone(u, w) { return list.find(z => (z.rect ? u >= z.rect.u0 && u <= z.rect.u1 && w >= z.rect.w0 && w <= z.rect.w1 : pointInPoly(z.poly, u, w))) ?? null; },
    /** kerb furniture (thin pole right at an alley edge) is allowed to stand in a forecourt strip that overlaps the alley */
    isKerb(u, w, r) {
      if (r > KERB_R + EPS) return false;
      return alleyZones.some(z => { const d = z.rect ? distToRect(z.rect, u, w) : distToPoly(z.poly, u, w); return d > 0 && d <= KERB_OUT; });
    },
    /** a circle (lamp post, bin, table ...) that must not stand on a walkway: alley cores and forecourts, with the kerb exception */
    blocksCircle(u, w, r) {
      const box = circleRect(u, w, r);
      for (const z of alleyZones) if (zoneHitsRect(z, box, -Math.min(0.02, r * 0.2))) return z;
      if (api.isKerb(u, w, r)) return null;
      for (const z of courtZones) if (zoneHitsRect(z, box)) return z;
      return null;
    },
  };
  return api;
}

/** raster of the zones (cell metres): 1 = alley, 2 = forecourt, 4 = service lane.  { data, nu, nw, u0, w0, cell } (the fine occupancy grid of the NPC packer, the wear texture, the overlay) */
export function rasterZones(pitches = [], { cell = 0.5, u0 = -20, w0 = -24, nu = 640, nw = 360, alleys = ALLEYS } = {}) {
  const data = new Uint8Array(nu * nw); const res = createReservations(pitches, { alleys });
  for (const z of res.list) {
    const flag = z.kind === "forecourt" || z.kind === "queue" ? 2 : z.kind === "service" ? 4 : 1;
    const bb = z.rect ?? { u0: Math.min(...z.poly.map(p => p[0])), u1: Math.max(...z.poly.map(p => p[0])), w0: Math.min(...z.poly.map(p => p[1])), w1: Math.max(...z.poly.map(p => p[1])) };
    const i0 = Math.max(0, Math.floor((bb.u0 - u0) / cell)), i1 = Math.min(nu - 1, Math.floor((bb.u1 - u0) / cell - 1e-9));
    const j0 = Math.max(0, Math.floor((bb.w0 - w0) / cell)), j1 = Math.min(nw - 1, Math.floor((bb.w1 - w0) / cell - 1e-9));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cr = { u0: u0 + i * cell, u1: u0 + (i + 1) * cell, w0: w0 + j * cell, w1: w0 + (j + 1) * cell };
      if (zoneHitsRect(z, cr)) data[j * nu + i] |= flag;
    }
  }
  return { data, nu, nw, u0, w0, cell };
}

/* ------------------------------------------------------------------------------------------------ the validator */
const fmt = n => (Math.round(n * 100) / 100).toString();
const rectText = r => `[u ${fmt(r.u0)}..${fmt(r.u1)}, w ${fmt(r.w0)}..${fmt(r.w1)}]`;

/** static checks that need no walk mask: widths, pitch / alley overlap, faces, forecourts, alleys inside the field, the entrance lanes */
export function validateStatic({ pitches, alleys = ALLEYS, fieldPoly = FIELD_POLY, entrances = ENTRANCES } = {}) {
  const errors = []; const stats = { alleys: alleys.length, pitches: pitches.length, forecourts: 0 };
  for (const a of alleys) {
    const wU = a.u[1] - a.u[0], wW = a.w[1] - a.w[0]; const width = a.axis === "u" ? wW : wU;
    if (width + EPS < a.min) errors.push(`alley ${a.id} is ${fmt(width)} m wide, needs ${a.min} m`);
    if (a.axis === "u" ? wU < (a.kind === "lane" ? 6 : 20) : wW < 12) errors.push(`alley ${a.id} is too short`);
    for (const [u, w] of [[a.u[0], a.w[0]], [a.u[1], a.w[0]], [a.u[0], a.w[1]], [a.u[1], a.w[1]]]) {
      const gate = Boolean(a.entrance);                 // an entrance lane runs out through the door: its far end may lie outside the field
      if (!pointInPoly(fieldPoly, u, w) && !gate && distToPoly(fieldPoly, u, w) > 0.6) errors.push(`alley ${a.id} corner (${fmt(u)}, ${fmt(w)}) lies outside the field`);
    }
  }
  if (SERVICE.width + EPS < SERVICE.min) errors.push(`service lane is ${fmt(SERVICE.width)} m wide, needs ${SERVICE.min} m`);
  for (const [u, w] of SERVICE.pts) if (!pointInPoly(fieldPoly, u, w)) errors.push(`service lane corner (${fmt(u)}, ${fmt(w)}) lies outside the field`);
  const rects = pitches.map(p => ({ p, r: rectOfPitch(p) }));
  for (const { p, r } of rects) {
    for (const a of alleys) if (rectsOverlap(r, rectOf(a))) errors.push(`pitch ${p.id} overlaps alley ${a.id}`);
    if (rectHitsPoly(r, SERVICE.pts)) errors.push(`pitch ${p.id} overlaps the service lane`);
    const hit = frontAlley(p, p.face, alleys);
    if (!hit) { errors.push(`pitch ${p.id} (${p.size}, face ${p.face}) faces no alley (nothing within reach in front of it)`); continue; }
    if (hit.gap > APRON_MAX + EPS) errors.push(`pitch ${p.id} faces alley ${hit.alley.id} ${fmt(hit.gap)} m away (more than ${APRON_MAX} m): no forecourt can reach it`);
    // the face must point to (about) the nearest alley of its axis: the two opposite directions are compared
    const opp = { "+w": "-w", "-w": "+w", "+u": "-u", "-u": "+u" }[p.face];
    const back = frontAlley(p, opp, alleys);
    if (back && back.gap + FACE_TOLERANCE < hit.gap) errors.push(`pitch ${p.id} faces ${p.face} (${hit.alley.id}, ${fmt(hit.gap)} m) but alley ${back.alley.id} is only ${fmt(back.gap)} m behind it: wrong face`);
    const f = forecourtOf(p, alleys); stats.forecourts++;
    if (f.depth + EPS < FORECOURT_MIN[p.size]) errors.push(`forecourt of ${p.id} is ${fmt(f.depth)} m deep, ${p.size} needs ${FORECOURT_MIN[p.size]} m`);
    const fr = { u0: f.u0, u1: f.u1, w0: f.w0, w1: f.w1 };
    for (const other of rects) if (other.p.id !== p.id && rectsOverlap(fr, other.r)) errors.push(`forecourt of ${p.id} ${rectText(fr)} is blocked by pitch ${other.p.id}`);
    if (!pointInPoly(fieldPoly, (fr.u0 + fr.u1) / 2, (fr.w0 + fr.w1) / 2)) errors.push(`forecourt of ${p.id} lies outside the field`);
    // room for a queue row: the first QUEUE_RESERVED slots of one side lie inside the field and clear of every other pitch (the crowd flips to the other side at the first blocked slot)
    const run = side => { let k = 0; for (; k < QUEUE_RESERVED; k++) { const sl = queueSlotOf(p, k, side); if (!pointInPoly(fieldPoly, sl.x, sl.z) || rects.some(o => o.p.id !== p.id && sl.x > o.r.u0 - 0.5 && sl.x < o.r.u1 + 0.5 && sl.z > o.r.w0 - 0.5 && sl.z < o.r.w1 + 0.5)) break; } return k; };
    const best = Math.max(run(1), run(-1));
    if (best < QUEUE_RESERVED) errors.push(`pitch ${p.id}: only ${best} of ${QUEUE_RESERVED} queue slots fit in front of it (field edge or a neighbouring pitch)`);
  }
  for (const e of entrances) if (!alleys.some(a => a.id === e.lane)) errors.push(`entrance ${e.id} names the unknown lane ${e.lane}`);
  return { errors, stats };
}

/** footprints against the zones.  stalls / boxes = rectangles { u0, u1, w0, w1, k?, f? }, solids = circles { u, w, r }.  Returns error strings that name the offender. */
export function validateFootprints({ pitches, stalls = [], solids = [], boxes = [], alleys = ALLEYS, label = {} } = {}) {
  const res = createReservations(pitches, { alleys }); const errors = [];
  stalls.forEach((s, i) => { const z = res.firstHit(s, -0.02); if (z) errors.push(`${label.stall ?? "stall"} #${i} (${s.k ?? "?"}) ${rectText(s)} sits on ${z.kind} ${z.id}`); });
  boxes.forEach((s, i) => { const z = res.firstHit(s, -0.02); if (z) errors.push(`${label.box ?? "box"} #${i} ${rectText(s)} sits on ${z.kind} ${z.id}`); });
  solids.forEach((c, i) => { const z = res.blocksCircle(c.u, c.w, c.r); if (z) errors.push(`${label.solid ?? "solid"} #${i} (${fmt(c.u)}, ${fmt(c.w)}, r ${fmt(c.r)}) sits on ${z.kind} ${z.id}`); });
  return errors;
}

/** a stall that stands at a main alley or a cross alley must face one of the alleys it touches (its front is the shop front; backs and sides never point at a walkway) */
export function validateStallFaces({ stalls = [], alleys = ALLEYS } = {}) {
  const errors = [];
  stalls.forEach((s, i) => {
    if (!s.f || s.f === "?" || /^(camelot|lot|worksite)$/.test(s.k ?? "")) return;
    let touching = 0, ok = false;
    for (const a of alleys) {
      const q = rectOf(a); const near = (FRONTAGE[a.kind] ?? 0.8) + 0.6;          // a stall row keeps FRONTAGE + 0.25 m from the alley: "touching" = within 0.35 m more than that
      if (a.axis === "u" && overlap1(s.u0, s.u1, q.u0, q.u1) > 2) {
        if (s.w1 <= q.w0 + EPS && q.w0 - s.w1 < near) { touching++; if (s.f === "+w") ok = true; }
        if (s.w0 >= q.w1 - EPS && s.w0 - q.w1 < near) { touching++; if (s.f === "-w") ok = true; }
      } else if (a.axis === "w" && overlap1(s.w0, s.w1, q.w0, q.w1) > 2) {
        if (s.u1 <= q.u0 + EPS && q.u0 - s.u1 < near) { touching++; if (s.f === "+u") ok = true; }
        if (s.u0 >= q.u1 - EPS && s.u0 - q.u1 < near) { touching++; if (s.f === "-u") ok = true; }
      }
    }
    if (touching && !ok) {          // a corner stall may touch a cross alley with its side and still face the long alley it stands on: its front must then look at an alley within reach
      const f = FACE_VEC[s.f]; if (f) for (const a of alleys) {
        const q = rectOf(a); let gap, shared;
        if (f[1] > 0) { gap = q.w0 - s.w1; shared = overlap1(s.u0, s.u1, q.u0, q.u1); } else if (f[1] < 0) { gap = s.w0 - q.w1; shared = overlap1(s.u0, s.u1, q.u0, q.u1); }
        else if (f[0] > 0) { gap = q.u0 - s.u1; shared = overlap1(s.w0, s.w1, q.w0, q.w1); } else { gap = s.u0 - q.u1; shared = overlap1(s.w0, s.w1, q.w0, q.w1); }
        if (shared > 1 && gap > -EPS && gap <= FRONTAGE.main + 1.5) ok = true;
      }
      if (f && !ok) {                                         // the service lane counts as an alley to face (back lots look at it)
        const reach = FRONTAGE.main + 1.5 + 0.3; const probe = f[1] > 0 ? { u0: s.u0, u1: s.u1, w0: s.w1, w1: s.w1 + reach } : f[1] < 0 ? { u0: s.u0, u1: s.u1, w0: s.w0 - reach, w1: s.w0 } : f[0] > 0 ? { u0: s.u1, u1: s.u1 + reach, w0: s.w0, w1: s.w1 } : { u0: s.u0 - reach, u1: s.u0, w0: s.w0, w1: s.w1 };
        if (rectHitsPoly(probe, SERVICE.pts)) ok = true;
      }
    }
    if (touching && !ok) errors.push(`stall #${i} (${s.k}) ${rectText(s)} stands at an alley but faces ${s.f} (away from every alley it touches)`);
  });
  return errors;
}

/* ------------------------------------------------------------------------------------------------ stall fronts (feedback B) */
/** a stall front must reach a walkway (alley, lane, service lane, forecourt, queue strip) within this many metres, straight out over ground that is free of stalls and pitches */
export const FRONT_REACH = 3.4;
/** skins that are back-of-house or have no shop front: never checked */
const NO_FRONT = /^(lot|worksite|backLot)$/;
/** skins that look the same every time (fixed murals / shapes): never two of them side by side.  Tents and the generic booths vary by name / colour and may stand in a row. */
export const DUP_SKINS = Object.freeze(["funhouse", "bouncy", "kids", "chair", "tiki", "temple", "fisher", "arch", "claw", "popcorn", "icecream", "pizza", "balloon", "souvenir", "sweets", "game", "kiosk", "chalet", "trailer", "camelot"]);
/** the big themed attractions (Spukhaus, bouncy castle, kids' ride, chair swing): at most one per block, i.e. no two within BIG_SPACING metres of each other (centre to centre) */
export const BIG_SKINS = Object.freeze(["funhouse", "bouncy", "kids", "chair"]);
export const BIG_SPACING = 40;
/** two stalls of the same fixed skin closer than this (gap between the footprints) are "adjacent" */
export const DUP_GAP = 2.5;

/** the front of a stall at (u, w) straight out: where does it end up?  { ok, reason?, dist?, zone? } (probes the middle of the front over the middle half of its width) */
export function frontProbe(s, face, { pitches = [], stalls = [], self = -1, res = null, fieldPoly = FIELD_POLY, reach = FRONT_REACH, step = 0.25, shrink = 0.05 } = {}) {
  const f = FACE_VEC[face]; if (!f) return { ok: true };
  const R = res ?? createReservations(pitches);
  const cu = (s.u0 + s.u1) / 2, cw = (s.w0 + s.w1) / 2; const half = Math.max(0.5, (f[0] ? s.w1 - s.w0 : s.u1 - s.u0) / 4);
  const edge = f[0] > 0 ? s.u1 : f[0] < 0 ? s.u0 : f[1] > 0 ? s.w1 : s.w0;
  const prects = pitches.map(rectOfPitch);
  for (let t = step; t <= reach + 1e-9; t += step) {
    for (const k of [0, -half, half]) {
      const u = f[0] ? edge + f[0] * t : cu + k, w = f[1] ? edge + f[1] * t : cw + k;
      if (k === 0) { const z = R.inZone(u, w); if (z) return { ok: true, dist: t, zone: z.id }; }
      if (!pointInPoly(fieldPoly, u, w)) return { ok: false, reason: `looks at the edge of the field after ${fmt(t)} m` };
      const pi = prects.findIndex(r => u > r.u0 && u < r.u1 && w > r.w0 && w < r.w1); if (pi >= 0) return { ok: false, reason: `looks at the plot ${pitches[pi].id} after ${fmt(t)} m` };
      for (let j = 0; j < stalls.length; j++) {
        if (j === self) continue; const o = stalls[j];
        if (u > o.u0 + shrink && u < o.u1 - shrink && w > o.w0 + shrink && w < o.w1 - shrink) {
          const back = o.f && FACE_VEC[o.f] && FACE_VEC[o.f][0] === -f[0] && FACE_VEC[o.f][1] === -f[1] ? "front" : o.f === face ? "back" : "side";
          return { ok: false, reason: `looks at the ${back} of stall #${j} (${o.k ?? "?"}) after ${fmt(t)} m` };
        }
      }
    }
  }
  return { ok: false, reason: `reaches no walkway within ${fmt(reach)} m` };
}

/** feedback B: (1) every stall front opens straight onto a walkway (no stall faces the back or side of another stall, a plot, the field edge), (2) no two stalls of the same fixed skin
 * side by side, (3) the big themed skins (Spukhaus ...) keep BIG_SPACING metres apart.  stalls = footprints { k, f, u0, u1, w0, w1 } of the NPC fair */
export function validateStallFronts({ pitches = [], stalls = [], alleys = ALLEYS, fieldPoly = FIELD_POLY } = {}) {
  const errors = []; const res = createReservations(pitches, { alleys });
  stalls.forEach((s, i) => {
    if (!s.f || s.f === "?" || NO_FRONT.test(s.k ?? "")) return;
    const r = frontProbe(s, s.f, { pitches, stalls, self: i, res, fieldPoly });
    if (!r.ok) errors.push(`stall #${i} (${s.k}) ${rectText(s)} faces ${s.f}: its front ${r.reason}`);
  });
  const gap = (a, b) => Math.hypot(Math.max(a.u0 - b.u1, 0, b.u0 - a.u1), Math.max(a.w0 - b.w1, 0, b.w0 - a.w1));
  for (let i = 0; i < stalls.length; i++) for (let j = i + 1; j < stalls.length; j++) {
    const a = stalls[i], b = stalls[j]; if (!a.k || a.k !== b.k) continue;
    if (DUP_SKINS.includes(a.k) && gap(a, b) < DUP_GAP) errors.push(`stalls #${i} and #${j} are both "${a.k}" side by side (${fmt(gap(a, b))} m apart)`);
    if (BIG_SKINS.includes(a.k) && Math.hypot((a.u0 + a.u1 - b.u0 - b.u1) / 2, (a.w0 + a.w1 - b.w0 - b.w1) / 2) < BIG_SPACING) errors.push(`stalls #${i} and #${j} are both the big "${a.k}" less than ${BIG_SPACING} m apart`);
  }
  return errors;
}

/** The whole check.  `createMask` / `pitchSolids` come from walk.js (passed in: this module stays import-free of the walker).  Options:
 *  stalls, solids, boxes (real footprints when the filler ran, else empty), stars (levels to test), step (BFS cell in metres).  Returns { ok, errors, stats }. */
export function validateLayout({ pitches, stalls = [], solids = [], boxes = [], createMask = null, pitchSolids = null, stars = [1, 3, 5], step = 0.5, entrances = ENTRANCES, alleys = ALLEYS, fieldPoly = FIELD_POLY, checkFaces = true } = {}) {
  const st = validateStatic({ pitches, alleys, fieldPoly, entrances });
  const errors = [...st.errors, ...validateFootprints({ pitches, stalls, solids, boxes, alleys })];
  if (checkFaces) errors.push(...validateStallFaces({ stalls, alleys }), ...validateStallFronts({ pitches, stalls, alleys, fieldPoly }));
  const stats = { ...st.stats, stalls: stalls.length, solids: solids.length, reach: {} };
  if (createMask && pitchSolids) {
    const rects = pitches.map(p => { const s = SIZES[p.size] ?? SIZES.S; return { id: p.id, u: p.u, w: p.w, du: s.u, dw: s.w, size: p.size }; });
    const faces = pitches.map(p => p.face);
    for (const star of stars) {
      const mask = createMask({ fieldPoly: [...fieldPoly], rects, faces, entrances: [...entrances], lane: [], stalls, solids, boxes });
      mask.setGates(star);
      // fresh: only the pitches of the star are open (walkable with a plot fence), the others locked; full: everything built.  Either way a pitch is a solid box.
      const full = star >= 5;
      const solidAt = i => (full ? true : pitches[i].star > star ? true : star >= 3 ? i % 2 === 0 : false);
      mask.setPitches(pitchSolids(rects, solidAt, {}, { fenceAt: () => true, faces }));
      const open = entrances.filter(e => e.star <= star);
      const R = 0.34, cell = step; const U0 = -5, W0 = -20, NU = Math.ceil(310 / cell), NW = Math.ceil(175 / cell);
      const free = new Uint8Array(NU * NW).fill(2);       // 2 = unknown, 1 = free, 0 = blocked (the mask is asked lazily)
      const isFree = (i, j) => { const k = j * NU + i; if (free[k] === 2) free[k] = mask.allowed(U0 + (i + 0.5) * cell, W0 + (j + 0.5) * cell, R) ? 1 : 0; return free[k] === 1; };
      const seed = (u, w) => {                            // the free cell nearest to (u, w) within 2 m
        const ci = Math.floor((u - U0) / cell), cj = Math.floor((w - W0) / cell); let best = null, bd = Infinity; const rad = Math.ceil(2 / cell);
        for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= NU || j >= NW) continue; const d = Math.hypot(di, dj); if (d < bd && isFree(i, j)) { bd = d; best = [i, j]; } }
        return best;
      };
      const fill = start => {
        const seen = new Uint8Array(NU * NW); const q = [start]; seen[start[1] * NU + start[0]] = 1;
        for (let h = 0; h < q.length; h++) {
          const [i, j] = q[h];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NU || b >= NW || seen[b * NU + a]) continue; if (!isFree(a, b)) continue; seen[b * NU + a] = 1; q.push([a, b]); }
        }
        return seen;
      };
      // every single open entrance has to reach every pitch: one flood fill per entrance, from a spot 4 m inside its door
      const per = open.map(e => { const [fu, fw] = FACE_VEC[e.face]; const s = seed(e.u - fu * 4, e.w - fw * 4); if (!s) errors.push(`star ${star}: entrance ${e.id} has no free spot inside the door`); return { e, seen: s ? fill(s) : null }; });
      let bad = 0;
      for (const p of pitches) {
        const spot = pitchEntrance(p); const here = seed(spot.x, spot.z);
        if (!here || Math.hypot(U0 + (here[0] + 0.5) * cell - spot.x, W0 + (here[1] + 0.5) * cell - spot.z) > 1.3) { errors.push(`star ${star}: the entrance point (${fmt(spot.x)}, ${fmt(spot.z)}) of pitch ${p.id} is blocked`); bad++; continue; }
        for (const { e, seen } of per) if (!seen || !seen[here[1] * NU + here[0]]) { errors.push(`star ${star}: pitch ${p.id} (${p.size}, face ${p.face}) is not reachable from entrance ${e.id}`); bad++; }
      }
      stats.reach[star] = { entrances: open.map(e => e.id), pitches: pitches.length, unreachable: bad };
    }
  }
  return { ok: errors.length === 0, errors, stats };
}

/** the point a visitor stands on to use a pitch: 1.2 m in front of the middle of the front edge (inside the forecourt) */
export function pitchEntrance(p, out = 1.2) {
  const r = rectOfPitch(p); const [fu, fw] = FACE_VEC[p.face ?? "+w"];
  return { x: (r.u0 + r.u1) / 2 + fu * ((r.u1 - r.u0) / 2 + out), z: (r.w0 + r.w1) / 2 + fw * ((r.w1 - r.w0) / 2 + out) };
}

/** throw with every offender named (the harness and the flows call this) */
export function assertLayout(opts) {
  const r = validateLayout(opts);
  if (!r.ok) throw new Error(`layout invalid (${r.errors.length}):\n  ` + r.errors.slice(0, 40).join("\n  ") + (r.errors.length > 40 ? `\n  ... ${r.errors.length - 40} more` : ""));
  return r;
}
