/* Schueberfouer Tycoon W6 "Crowd": the cosmetic crowd (DESIGN section 5) and Hämmi the sheep.
 *
 * Pure part (no THREE, harness-tested): crowdTarget (how many guests for a quality and the economy's guest rate), buildGraph (the alley graph from
 * the walkable mask: pieces of the alley centre lines with the free width left and right of them), lane helpers, queue slots, the seeded looks.
 * THREE part (createCrowd): one InstancedBufferGeometry figure (~80 triangles: legs, torso, arms, head, skirt, a held item; colours per instance,
 * walk cycle in the vertex shader, no skinning) = 1 draw call, beyond `nearRadius` guests turn into coloured dots = 1 draw call, Hämmi = 1 draw call.
 * Behaviour: guests walk the alley graph on two lanes (right-hand traffic, so they never meet head on), some leave the lane for a stall or ride (by
 * the economy's demand), stand there for a few seconds and carry a snack afterwards; overloaded attractions get a real row of queueing guests.
 * Guests are smoothed followers of an "ideal" point that runs along the lane, so a turn or a lane change never teleports them. */
import { frontSpot } from "./walk.js";
import { ITEM_BY_ID } from "./data.js";

export const CROWD_CAP = Object.freeze({ low: 70, medium: 150, high: 320 });
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const NEAR_WALK = 40, NEAR_RIDE = 110, NEAR_BUILDER = 175;
const BUILDER_SHARE = 0.6;                  // the builder view shows a thinner crowd
const QUEUE_SHARE = 0.3;                    // queue rows may use at most this share of the guests
const LANE_BASE = { haaptallee: 2.1, fressgaass: 1.0 };
const SPEED_RANGE = [1.0, 1.55];

/** how many guests are shown: the quality cap times a factor from the economy's guest rate (lambda per minute) */
export function crowdTarget(quality, lambda, mode = "walk") {
  const cap = CROWD_CAP[quality] ?? CROWD_CAP.medium;
  const factor = 0.4 + 0.6 * clamp(Math.sqrt(Math.max(0, lambda) / 150), 0, 1);
  return Math.round(cap * factor * (mode === "builder" ? BUILDER_SHARE : 1));
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------------------------------------------ the alley graph */
/** Alley centre lines (the corridors of models/npc.js, plus polylines such as the tram lane) cut into free pieces by the walkable mask and split at the
 * crossings. Every piece is a straight edge: { a, b (node ids), x0, z0, x1, z1, dx, dz (unit), len, fl[], fr[] (free metres left / right of a->b every metre), name, lane }.
 * Dead ends of different lines that are closer than `link` metres (and free in between) are connected (the portal -> the street). */
export function buildGraph(mask, corridors, { minPiece = 8, margin = 0.5, polylines = [], link = 24 } = {}) {
  const segs = [];
  for (const c of corridors) {
    if (/^gate/.test(c.name)) continue;
    const du = c.u[1] - c.u[0], dw = c.w[1] - c.w[0];
    if (du >= dw) { const z = (c.w[0] + c.w[1]) / 2; segs.push({ name: c.name, x0: c.u[0] + 4, z0: z, x1: c.u[1] - 4, z1: z, lane: LANE_BASE[c.name] ?? 1.0 }); }
    else { const x = (c.u[0] + c.u[1]) / 2; segs.push({ name: c.name, x0: x, z0: c.w[0], x1: x, z1: c.w[1], lane: LANE_BASE[c.name] ?? 1.0 }); }
  }
  for (const line of polylines) {
    const step = line.chunk ?? 4;
    for (let i = 0; i + 1 < line.pts.length; i += step) {
      const a = line.pts[i], b = line.pts[Math.min(line.pts.length - 1, i + step)];
      if (Math.hypot(b.x - a.x, b.z - a.z) > 3) segs.push({ name: line.name, x0: a.x, z0: a.z, x1: b.x, z1: b.z, lane: line.lane ?? 2.2 });
    }
  }
  segs.forEach(sg => { sg.len = Math.hypot(sg.x1 - sg.x0, sg.z1 - sg.z0); sg.dx = (sg.x1 - sg.x0) / sg.len; sg.dz = (sg.z1 - sg.z0) / sg.len; });
  // free pieces of every segment (sampled every metre)
  const pieces = [];
  for (const sg of segs) {
    let run = null;
    const ts = []; for (let t = 0; t < sg.len; t += 1) ts.push(t); ts.push(sg.len);
    ts.forEach((tt, k) => {
      const free = mask.allowed(sg.x0 + sg.dx * tt, sg.z0 + sg.dz * tt, margin);
      if (free) { if (!run) run = { t0: tt, t1: tt }; run.t1 = tt; }
      if ((!free || k === ts.length - 1) && run) { if (run.t1 - run.t0 >= minPiece || (sg.len < minPiece * 1.5 && run.t1 - run.t0 >= sg.len - 1.5)) pieces.push({ ...sg, t0: run.t0, t1: run.t1 }); run = null; }
    });
  }
  const cross = (p, q) => {          // distance along p where it crosses q (interior of both), or null
    const d = p.dx * q.dz - p.dz * q.dx;
    if (Math.abs(d) < 1e-3) return null;
    const rx = q.x0 + q.dx * q.t0 - (p.x0 + p.dx * p.t0), rz = q.z0 + q.dz * q.t0 - (p.z0 + p.dz * p.t0);
    const tp = (rx * q.dz - rz * q.dx) / d, tq = (rx * p.dz - rz * p.dx) / d;
    return tp > 2 && tp < p.t1 - p.t0 - 2 && tq > -0.01 && tq < q.t1 - q.t0 + 0.01 ? tp : null;
  };
  const key = (x, z) => `${Math.round(x / 1.5)}:${Math.round(z / 1.5)}`;
  const nodes = [], nodeId = new Map();
  const node = (x, z) => { const k = key(x, z); if (!nodeId.has(k)) { nodeId.set(k, nodes.length); nodes.push({ x, z, edges: [] }); } return nodeId.get(k); };
  const edges = [];
  const addEdge = (x0, z0, x1, z1, name, lane) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 2) return;
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    const fl = [], fr = [];
    for (let k = 0; k <= Math.floor(len); k++) { const x = x0 + dx * k, z = z0 + dz * k; fr.push(mask.freeSide(x, z, dx, dz, 1, 6)); fl.push(mask.freeSide(x, z, dx, dz, -1, 6)); }
    const a = node(x0, z0), b = node(x1, z1);
    const id = edges.length;
    edges.push({ id, a, b, x0, z0, x1, z1, len, dx, dz, fl, fr, name, lane });
    nodes[a].edges.push(id); nodes[b].edges.push(id);
  };
  for (const p of pieces) {
    const cuts = [0, p.t1 - p.t0];
    for (const q of pieces) { if (q === p || q.name === p.name) continue; const c = cross(p, q); if (c !== null) cuts.push(c); }
    cuts.sort((m, n) => m - n);
    const ox = p.x0 + p.dx * p.t0, oz = p.z0 + p.dz * p.t0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] - cuts[i] < 2) continue;
      addEdge(ox + p.dx * cuts[i], oz + p.dz * cuts[i], ox + p.dx * cuts[i + 1], oz + p.dz * cuts[i + 1], p.name, p.lane);
    }
  }
  // links between dead ends of different lines
  const dead = nodes.map((n, i) => ({ i, n })).filter(({ n }) => n.edges.length === 1);
  for (const A of dead) {
    let best = null;
    for (const B of dead) {
      if (B.i === A.i || edges[B.n.edges[0]].name === edges[A.n.edges[0]].name) continue;
      const d = Math.hypot(A.n.x - B.n.x, A.n.z - B.n.z);
      if (d <= link && (!best || d < best.d)) best = { B, d };
    }
    if (best && A.i < best.B.i) {
      let ok = true;
      for (let t = 0; t <= best.d; t += 1) { const k = t / best.d; if (!mask.allowed(A.n.x + (best.B.n.x - A.n.x) * k, A.n.z + (best.B.n.z - A.n.z) * k, 0.4)) { ok = false; break; } }
      if (ok) addEdge(A.n.x, A.n.z, best.B.n.x, best.B.n.z, "link", 1.2);
    }
  }
  return { nodes, edges, totalLength: edges.reduce((sum, e) => sum + e.len, 0) };
}

/** point on an edge: `s` metres along in the travel direction (dir +1 = a->b), `lat` metres to the right of travel, clamped to the free width */
export function edgePoint(edge, dir, s, lat) {
  const along = dir > 0 ? s : edge.len - s;
  const k = clamp(Math.round(along), 0, edge.fr.length - 1);
  const rightFree = dir > 0 ? edge.fr[k] : edge.fl[k], leftFree = dir > 0 ? edge.fl[k] : edge.fr[k];
  const l = clamp(lat, -(Math.max(0, leftFree - 0.4)), Math.max(0, rightFree - 0.4));
  const hx = edge.dx * dir, hz = edge.dz * dir;
  const bx = edge.x0 + edge.dx * along, bz = edge.z0 + edge.dz * along;
  return { x: bx - hz * l, z: bz + hx * l, hx, hz, lat: l };
}

/** queue slot k of a pitch: a row along the front of the pitch, 3 m out, 0.85 m apart; `side` = +1 / -1 picks the direction along the front */
export function queueSlot(rect, face, k, side = 1) {
  return frontSpot(rect, face, 3.0, side * (0.6 + 0.85 * k));
}

/* ------------------------------------------------------------------------------------------------ looks */
const SHIRTS = [0xd8283a, 0x2d6fd0, 0xf2c230, 0xf4f4ef, 0x2f9a58, 0xe8702a, 0x7a47c8, 0x1c8fa0, 0xe86aa6, 0x35405c, 0x9aa0a6, 0xc84a2a, 0x8bc34a, 0xb8284a];
const PANTS = [0x2f4a7a, 0x3a4660, 0x2a2a30, 0x6a5a45, 0x4a4f5a, 0x7a6a50, 0x1f3550, 0x5a3a2a];
const HAIR = [0x1c1612, 0x3a2616, 0x6a4423, 0xc9a45c, 0xe6d9b0, 0x8a8a8a, 0xa8421c, 0x111111];
const SKIN = [0xf2c9a4, 0xe8b48a, 0xd39c6c, 0xa86f46, 0x7a4a2c, 0xf6d6bd];
const FOOD_COLORS = { kachel: 0xe0a24a, fritten: 0xf2d04a, wurscht: 0xc86a3a, zocker: 0xff8ac8, mandel: 0xa8703a, waffel: 0xf0d8a0, fesch: 0xd8d8c8, crepes: 0xe8c07a, tent: 0xe8c040 };

export function makeLook(rnd, kind) {
  const pick = list => list[Math.floor(rnd() * list.length)];
  const adult = kind === "adult", teen = kind === "teen";
  return { kind, shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), skin: pick(SKIN),
    scale: kind === "kid" ? 0.5 + rnd() * 0.16 : teen ? 0.86 + rnd() * 0.1 : adult ? 0.92 + rnd() * 0.13 : 1,
    skirt: kind !== "kid" && rnd() < 0.3 ? 1 : 0, speed: lerp(SPEED_RANGE[0], SPEED_RANGE[1], rnd()) * (kind === "kid" ? 0.9 : 1) };
}

/** group recipes: [kind, offsetRight, offsetBack] of the followers relative to the leader */
const GROUPS = [
  { w: 46, members: [] },
  { w: 12, members: [["adult", 0.78, 0]] },
  { w: 12, members: [["kid", 0.7, 0.15]] },
  { w: 10, members: [["adult", 0.8, 0], ["kid", -0.65, 0.25]] },
  { w: 8, members: [["teen", 0.8, 0.1], ["teen", -0.8, 0.2]] },
  { w: 6, members: [["kid", 0.6, 0.1], ["kid", -0.6, 0.3]] },
];
function pickGroup(rnd) {
  const total = GROUPS.reduce((s, g) => s + g.w, 0);
  let t = rnd() * total;
  for (const g of GROUPS) { t -= g.w; if (t <= 0) return g; }
  return GROUPS[0];
}

/* ------------------------------------------------------------------------------------------------ the THREE part */
const FIGURE_VERT = `
attribute vec2 aInfo;            // x: part (0 skin 1 shirt 2 pants 3 hair 4 item), y: anim group (0 body 1 legL 2 legR 3 armL 4 armR 5 item)
attribute vec4 iPos;             // x, y, z, heading
attribute vec4 iParam;           // phase, walk amount, scale, item (0 none, 1 snack, 2 big)
attribute vec3 iShirt; attribute vec3 iPants; attribute vec3 iHair; attribute vec3 iSkin; attribute vec3 iItem;
uniform vec3 uAmb; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uNight; uniform float uTime;
varying vec3 vColor; varying float vFog;
#include <fog_pars_vertex>
void main() {
  vec3 p = position; vec3 n = normal;
  float part = aInfo.x; float grp = aInfo.y;
  float amt = iParam.y; float swing = sin(iParam.x) * 0.62 * amt;
  float pivotY = grp > 2.5 ? 1.43 : 0.88;
  float ang = 0.0;
  if (grp > 0.5 && grp < 1.5) ang = swing; else if (grp > 1.5 && grp < 2.5) ang = -swing;
  else if (grp > 2.5 && grp < 3.5) ang = -swing * 0.9; else if (grp > 3.5 && grp < 4.5) ang = swing * 0.9;
  else if (grp > 4.5) ang = swing * 0.9 - 0.25;
  float c = cos(ang), s = sin(ang);
  float dy = p.y - pivotY;
  if (grp > 0.5) { float z2 = p.z * c - dy * s; float y2 = pivotY + dy * c + p.z * s; p.z = z2; p.y = y2; float nz = n.z * c - n.y * s; float ny = n.y * c + n.z * s; n.z = nz; n.y = ny; }
  // body bob and the item (collapsed when the guest holds nothing)
  p.y += abs(sin(iParam.x)) * 0.03 * amt;
  if (part > 3.5) { if (iParam.w < 0.5) p = vec3(0.0); else if (iParam.w > 1.5) { p.z += 0.28; p.y -= 0.34; p *= 1.9; } }
  p *= iParam.z;
  float ch = cos(iPos.w), sh = sin(iPos.w);
  vec3 world = vec3(iPos.x + ch * p.z - sh * p.x, iPos.y + p.y, iPos.z + sh * p.z + ch * p.x);
  vec3 wn = vec3(ch * n.z - sh * n.x, n.y, sh * n.z + ch * n.x);
  vec3 base = part < 0.5 ? iSkin : part < 1.5 ? iShirt : part < 2.5 ? iPants : part < 3.5 ? iHair : iItem;
  // part ids interpolate along the arms / head, so a sleeve or hairline appears where they cross 0.5 / 3.5 (no extra triangles)
  float dir = clamp(dot(wn, uSunDir), 0.0, 1.0);
  vec3 light = (uAmb * (0.62 + 0.38 * wn.y) + uSunCol * dir) * 0.38;
  light = mix(light, max(light, vec3(0.42, 0.36, 0.3)), uNight * 0.85);
  float ground = mix(0.55, 1.0, smoothstep(0.0, 0.16, p.y / max(iParam.z, 0.1)));
  vColor = base * light * ground;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FIGURE_FRAG = `
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const DOT_VERT = `
attribute vec3 iColor; uniform float uScale; uniform float uSize; uniform vec3 uAmb; uniform float uNight;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = max(2.0, uSize * uScale / max(0.1, -mvPosition.z));
  vec3 light = uAmb * 0.38 * 0.85; light = mix(light, max(light, vec3(0.42, 0.36, 0.3)), uNight * 0.85);
  vColor = iColor * light;
  #include <fog_vertex>
}`;
const DOT_FRAG = `
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** figure geometry as plain arrays: [x, y, z] positions, normals, per vertex part + anim group. Open boxes (no top / bottom where hidden). */
export function figureArrays() {
  const pos = [], nor = [], info = [];
  const tri = (a, b, c, part, grp, normal) => {
    for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); info.push(part[v === a ? 0 : v === b ? 1 : 2] ?? part[0], grp); }
    const n = normal ?? (() => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const x = u[1] * w[2] - u[2] * w[1], y = u[2] * w[0] - u[0] * w[2], z = u[0] * w[1] - u[1] * w[0]; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; })();
    for (let i = 0; i < 3; i++) nor.push(n[0], n[1], n[2]);
  };
  // box from (x0,y0,z0) to (x1,y1,z1); partTop / partBottom = part id at the top / bottom vertices of the side faces; caps: [top, bottom]
  const box = (x0, y0, z0, x1, y1, z1, partTop, partBottom, grp, top = false, bottom = false) => {
    const q = (a, b, c, d, n, pa, pb) => { tri(a, b, c, [pa, pb, pb], grp, n); tri(a, c, d, [pa, pb, pa], grp, n); };
    // side quads: vertices ordered a(top) b(bottom) ... we pass the corner lists top-first
    const T0 = partTop, B0 = partBottom;
    const side = (p0t, p0b, p1b, p1t, n) => { tri(p0t, p0b, p1b, [T0, B0, B0], grp, n); tri(p0t, p1b, p1t, [T0, B0, T0], grp, n); };
    side([x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [0, 0, 1]);            // front
    side([x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [0, 0, -1]);          // back
    side([x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [1, 0, 0]);           // right (+x)
    side([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);          // left
    if (top) q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], T0, T0);
    if (bottom) q([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], B0, B0);
  };
  // legs (pants), hip at y 0.88; skirt (collapses nowhere: drawn only for guests with the skirt flag through the anim group 6 = scaled in the shader? no: kept small)
  box(0.03, 0.0, -0.09, 0.19, 0.88, 0.09, 2, 2, 1);          // left leg (+x is the guest's right, so the "left leg" label is only a phase label)
  box(-0.19, 0.0, -0.09, -0.03, 0.88, 0.09, 2, 2, 2);
  box(-0.175, 0.86, -0.1, 0.175, 1.48, 0.1, 1, 1, 0, true, false);     // torso
  box(0.175, 0.92, -0.055, 0.255, 1.46, 0.055, 1, 0, 3);      // arms: shirt on top, skin below (the part id interpolates)
  box(-0.255, 0.92, -0.055, -0.175, 1.46, 0.055, 1, 0, 4);
  // head: a low icosahedron, hair above the middle
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const R = 0.118 / Math.hypot(1, t);
  const hv = raw.map(v => [v[0] * R * 0.92, 1.6 + v[1] * R * 1.08, v[2] * R]);
  for (const f of faces) {
    const a = hv[f[0]], b = hv[f[1]], c = hv[f[2]];
    const hair = (a[1] + b[1] + c[1]) / 3 > 1.612 ? 3 : 0;          // faces above the middle carry hair (whole faces: the part id must not interpolate across 0..3)
    tri(a, b, c, [hair, hair, hair], 0);
  }
  // skirt: a short flared box over the legs, only the 'skirt' guests see it through the colour (it is pants coloured for everybody, cheap)
  // held item: a small box at the right hand (collapsed in the shader when the guest holds nothing)
  box(0.2, 1.0, 0.1, 0.32, 1.12, 0.22, 4, 4, 5, true, true);
  return { position: new Float32Array(pos), normal: new Float32Array(nor), info: new Float32Array(info), triangles: pos.length / 9 };
}

export function createCrowd({ T, r, world, game, mask, corridors, polylines = [], rects, faces, quality = "medium", env, seed = 11, getFocus, onBleat = () => {} }) {
  const camera = r.camera;
  const canvas = r.renderer.domElement;
  const rnd = mulberry(seed);
  const graph = buildGraph(mask, corridors, { polylines });
  let cap = CROWD_CAP[quality] ?? CROWD_CAP.medium;
  let mode = "builder";
  let night = 0;
  let density = 0.6;

  /* ---- render objects */
  const fig = figureArrays();
  const geo = new T.InstancedBufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(fig.position, 3));
  geo.setAttribute("normal", new T.BufferAttribute(fig.normal, 3));
  geo.setAttribute("aInfo", new T.BufferAttribute(fig.info, 2));
  const maxCap = CROWD_CAP.high;
  const A = {
    pos: new Float32Array(maxCap * 4), param: new Float32Array(maxCap * 4), shirt: new Float32Array(maxCap * 3), pants: new Float32Array(maxCap * 3),
    hair: new Float32Array(maxCap * 3), skin: new Float32Array(maxCap * 3), item: new Float32Array(maxCap * 3),
  };
  const inst = (name, array, size) => { const a = new T.InstancedBufferAttribute(array, size); a.setUsage(T.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
  const attrs = { pos: inst("iPos", A.pos, 4), param: inst("iParam", A.param, 4), shirt: inst("iShirt", A.shirt, 3), pants: inst("iPants", A.pants, 3), hair: inst("iHair", A.hair, 3), skin: inst("iSkin", A.skin, 3), item: inst("iItem", A.item, 3) };
  geo.instanceCount = 0;
  const uniforms = T.UniformsUtils.merge([T.UniformsLib.fog, { uAmb: { value: new T.Vector3(1, 1, 1) }, uSunCol: { value: new T.Vector3(1, 1, 1) }, uSunDir: { value: new T.Vector3(0, 1, 0) }, uNight: { value: 0 }, uTime: { value: 0 } }]);
  const figMat = new T.ShaderMaterial({ vertexShader: FIGURE_VERT, fragmentShader: FIGURE_FRAG, uniforms, fog: true });
  const figMesh = new T.Mesh(geo, figMat); figMesh.frustumCulled = false; figMesh.name = "fouer-crowd"; figMesh.renderOrder = 2;

  const dotGeo = new T.BufferGeometry();
  const dotPos = new Float32Array(maxCap * 3), dotCol = new Float32Array(maxCap * 3);
  const dotPosAttr = new T.BufferAttribute(dotPos, 3); dotPosAttr.setUsage(T.DynamicDrawUsage);
  const dotColAttr = new T.BufferAttribute(dotCol, 3); dotColAttr.setUsage(T.DynamicDrawUsage);
  dotGeo.setAttribute("position", dotPosAttr); dotGeo.setAttribute("iColor", dotColAttr); dotGeo.setDrawRange(0, 0);
  const dotMat = new T.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uScale: { value: 500 }, uSize: { value: 0.8 }, uAmb: uniforms.uAmb, uNight: uniforms.uNight }]), fog: true });
  const dots = new T.Points(dotGeo, dotMat); dots.frustumCulled = false; dots.name = "fouer-crowd-dots"; dots.renderOrder = 2;

  const group = new T.Group(); group.name = "fouer-crowd-group"; group.add(figMesh, dots);
  r.gameRoot.add(group);

  /* ---- Hämmi: white fluffy sheep with a red-white-light-blue ribbon, one merged vertex-coloured mesh */
  const sheep = (() => {
    const parts = [];
    const add = (geometry, color, matrix) => { const g = geometry.index ? geometry.toNonIndexed() : geometry.clone(); g.applyMatrix4(matrix); const c = new T.Color(color); const n = g.attributes.position.count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; } g.setAttribute("color", new T.BufferAttribute(arr, 3)); g.deleteAttribute("uv"); parts.push(g); };
    const M = (x, y, z, sx = 1, sy = 1, sz = 1) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion(), new T.Vector3(sx, sy, sz));
    add(new T.IcosahedronGeometry(0.5, 1), 0xf6f3ea, M(0, 0.68, 0, 0.9, 0.78, 1.25));
    add(new T.IcosahedronGeometry(0.3, 0), 0xfaf8f0, M(0, 0.95, -0.28, 1, 0.8, 1));
    // wool tufts: a fluffy outline instead of a smooth egg
    for (const [x, y, z, k] of [[-0.34, 0.8, 0.3, 0.2], [0.34, 0.8, 0.3, 0.2], [-0.36, 0.78, -0.25, 0.22], [0.36, 0.78, -0.25, 0.22], [0, 1.08, 0.2, 0.22], [0, 1.02, -0.52, 0.2]]) add(new T.IcosahedronGeometry(k, 0), 0xfbf9f2, M(x, y, z));
    // the head: a warm cream face with a woolly fringe, dark eyes and nose, pink ears
    add(new T.IcosahedronGeometry(0.2, 1), 0xf0dcc8, M(0, 0.9, 0.66, 0.9, 1, 1.05));
    add(new T.IcosahedronGeometry(0.15, 0), 0xfbf9f2, M(0, 1.07, 0.6));
    add(new T.BoxGeometry(0.05, 0.06, 0.04), 0x2a2228, M(-0.085, 0.95, 0.82)); add(new T.BoxGeometry(0.05, 0.06, 0.04), 0x2a2228, M(0.085, 0.95, 0.82));
    add(new T.BoxGeometry(0.08, 0.05, 0.05), 0x4a3238, M(0, 0.86, 0.86));
    add(new T.BoxGeometry(0.14, 0.04, 0.09), 0xe9a9a4, new T.Matrix4().compose(new T.Vector3(-0.22, 0.97, 0.62), new T.Quaternion().setFromEuler(new T.Euler(0, 0, 0.5)), new T.Vector3(1, 1, 1)));
    add(new T.BoxGeometry(0.14, 0.04, 0.09), 0xe9a9a4, new T.Matrix4().compose(new T.Vector3(0.22, 0.97, 0.62), new T.Quaternion().setFromEuler(new T.Euler(0, 0, -0.5)), new T.Vector3(1, 1, 1)));
    for (const [x, z] of [[-0.2, 0.38], [0.2, 0.38], [-0.2, -0.4], [0.2, -0.4]]) add(new T.BoxGeometry(0.1, 0.38, 0.1), 0x4a4046, M(x, 0.19, z));
    // Hämmi's ribbon: red, white, light blue (the Luxembourg colours) as a collar of three thin rings under the head
    [[0xe5483c, 0.63, 0.22], [0xffffff, 0.585, 0.265], [0x7fc4ef, 0.54, 0.31]].forEach(([c, z, rad]) => add(new T.CylinderGeometry(rad, rad, 0.045, 12), c, new T.Matrix4().compose(new T.Vector3(0, 0.78 + (0.63 - z) * 0.2, z), new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2 - 0.15, 0, 0)), new T.Vector3(1, 1, 1))));
    let n = 0; parts.forEach(g => { n += g.attributes.position.count; });
    const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), color = new Float32Array(n * 3);
    let o = 0; parts.forEach(g => { position.set(g.attributes.position.array, o * 3); normal.set(g.attributes.normal.array, o * 3); color.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); });
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(position, 3)); g.setAttribute("normal", new T.BufferAttribute(normal, 3)); g.setAttribute("color", new T.BufferAttribute(color, 3));
    g.computeBoundingSphere();
    const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true })); mesh.name = "fouer-haemmi"; mesh.scale.setScalar(1.15);
    mesh.userData.tris = n / 3;
    return mesh;
  })();
  r.gameRoot.add(sheep);

  /* ---- agents */
  const agents = [];
  const col = (hex, out, o) => { const c = new T.Color(hex); out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; };
  for (let i = 0; i < maxCap; i++) agents.push({ id: i, active: false, group: null, members: [], leader: null, ox: 0, oz: 0, x: 0, z: 0, ix: 0, iz: 0, yaw: 0, phase: rnd() * TAU, walk: 0, state: "walk", edge: null, dir: 1, s: 0, lat: 0,
    timer: 0, item: 0, itemColor: 0, itemUntil: 0, cooldown: rnd() * 10, look: null, dest: null, slot: null, queuePitch: -1, speed: 1, visible: true, dist: 0 });
  let active = 0;
  const sheepState = { x: 0, z: 0, yaw: 0, edge: null, dir: 1, s: 0, timer: 3, anim: 0, hop: 0, ready: false, speed: 0.5 };
  let destinations = [];            // built pitches guests may visit: { i, spot:{x,z}, weight, kind }
  let queues = new Map();           // pitch -> { want, agents: [], side }
  let totalWeight = 1;
  let queueClock = 0, recount = 0, repop = false, colorsDirty = true;
  const stats = { near: 0, far: 0, active: 0, queued: 0, groups: 0 };

  const edgeLenSum = graph.edges.reduce((s, e) => s + e.len, 0);
  function randomEdge() {
    let t = rnd() * edgeLenSum;
    for (const e of graph.edges) { t -= e.len; if (t <= 0) return e; }
    return graph.edges[0];
  }

  function inView(x, z, f, maxDist) {
    if (!f || !f.walk) return false;
    const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
    if (d > maxDist) return false;
    if (d < 4) return true;
    return Math.abs(angleDeltaShort(f.yaw, Math.atan2(dz, dx))) < 1.15;
  }
  /** nearest point of the alley graph to (px, pz): { edge, t (metres from the edge start), d } */
  function nearestOnGraph(px, pz) {
    let best = null;
    for (const e of graph.edges) {
      const t = clamp((px - e.x0) * e.dx + (pz - e.z0) * e.dz, 0, e.len);
      const d = Math.hypot(px - (e.x0 + e.dx * t), pz - (e.z0 + e.dz * t));
      if (!best || d < best.d) best = { edge: e, t, d };
    }
    return best;
  }
  /** put a guest somewhere on the graph. Walk mode: around the walker, log-uniform in distance (8-115 m) and mostly in front of them, so the alley they
   * look down is busy; never in their face and, unless `initial`, never inside the view cone within 70 m (no popping). The builder spreads them over the fair. */
  function place(a, f, initial = false) {
    const walkMode = Boolean(f && f.walk);
    for (let tries = 0; tries < 40; tries++) {
      let e, s;
      if (walkMode) {
        const d = 8 * Math.pow(115 / 8, rnd());
        const bearing = f.yaw + (rnd() < 0.62 ? (rnd() - 0.5) * 2.2 : rnd() * TAU);
        const hit = nearestOnGraph(f.x + Math.cos(bearing) * d, f.z + Math.sin(bearing) * d);
        if (!hit || hit.d > 15) continue;
        e = hit.edge; s = hit.t;
      } else { e = randomEdge(); s = rnd() * e.len; }
      a.edge = e; a.dir = rnd() < 0.5 ? 1 : -1; a.s = a.dir > 0 ? s : e.len - s;
      a.latJitter = (rnd() - 0.5) * (e.lane > 1.5 ? 2.2 : 0.9);
      a.lat = e.lane + a.latJitter;
      const p = edgePoint(e, a.dir, a.s, a.lat);
      if (walkMode) {
        const dd = Math.hypot(p.x - f.x, p.z - f.z);
        if (dd < (initial ? 5 : 9) || dd > 125) continue;
        if (!initial && inView(p.x, p.z, f, 70)) continue;
      }
      a.x = a.ix = p.x; a.z = a.iz = p.z; a.yaw = Math.atan2(p.hz, p.hx);
      return true;
    }
    return false;
  }
  /** the mode changed (builder <-> walk): move every free guest into the new distribution */
  function repopulate(f) {
    for (const a of agents) {
      if (!a.active || a.leader || a.queuePitch >= 0 || a.state === "queue" || a.state === "toSlot") continue;
      if (place(a, f, true)) { a.state = "walk"; a.dest = null; a.cooldown = 3 + rnd() * 8; for (const m of a.members) { m.x = m.ix = a.x; m.z = m.iz = a.z; } }
    }
  }

  function dress(a, kind, leader = null) {
    a.look = makeLook(rnd, kind);
    a.speed = leader ? leader.speed : a.look.speed;
    a.item = 0; a.itemUntil = 0; a.state = "walk"; a.dest = null; a.slot = null; a.queuePitch = -1; a.timer = 0; a.cooldown = 4 + rnd() * 10; a.walk = 0;
    const i = a.id;
    col(a.look.shirt, A.shirt, i * 3); col(a.look.pants, A.pants, i * 3); col(a.look.hair, A.hair, i * 3); col(a.look.skin, A.skin, i * 3);
    A.param[i * 4 + 2] = a.look.scale;
    colorsDirty = true;
  }

  function spawnGroup(f, room = 4) {
    // find the first free slots
    const free = [];
    for (const a of agents) { if (!a.active) { free.push(a); if (free.length >= 4) break; } }
    if (!free.length) return false;
    let recipe = pickGroup(rnd);
    if (1 + recipe.members.length > room) recipe = GROUPS[0];               // never overshoot the crowd target with a family
    const size = 1 + recipe.members.length;
    if (free.length < size) return false;
    const leader = free[0];
    if (!place(leader, f)) return false;
    dress(leader, rnd() < 0.12 ? "teen" : "adult");
    leader.active = true; leader.leader = null; leader.members = [];
    active++;
    recipe.members.forEach(([kind, ox, oz], k) => {
      const m = free[k + 1];
      dress(m, kind, leader);
      m.active = true; m.leader = leader; m.ox = ox; m.oz = oz; m.x = m.ix = leader.x - Math.cos(leader.yaw) * oz - Math.sin(leader.yaw) * ox; m.z = m.iz = leader.z - Math.sin(leader.yaw) * oz + Math.cos(leader.yaw) * ox;
      m.yaw = leader.yaw; leader.members.push(m); active++;
    });
    return true;
  }
  function release(a) {
    if (!a.active) return;
    a.active = false; active--;
    if (a.queuePitch >= 0) { const q = queues.get(a.queuePitch); if (q) q.agents = q.agents.filter(x => x !== a); a.queuePitch = -1; }
    for (const m of a.members) { if (m.active) { m.active = false; active--; } m.leader = null; }
    a.members = [];
  }

  /* ---- destinations (rebuilt when the economy or the pitches change) */
  function refreshDestinations() {
    const info = game.info();
    const next = [];
    let sum = 0;
    for (const row of info.perPitch) {
      const i = row.pitch;
      const entry = game.state.pitches[i];
      if (!entry) continue;
      const rect = rects[i], face = faces[i];
      let spot = frontSpot(rect, face, 2.6, (rnd() - 0.5) * Math.min(rect.du, rect.dw) * 0.5);
      if (!mask.allowed(spot.x, spot.z, 0.35)) { const free = mask.nearestFree(spot.x, spot.z, 4, 0.5, 0.35); if (!free) continue; spot = free; }
      const w = Math.max(0.2, row.demand);
      next.push({ i, spot, weight: w, kind: ITEM_BY_ID[entry.k].cat, item: entry.k, face });
      sum += w;
    }
    destinations = next; totalWeight = sum || 1;
    // queues: the economy's `problem` rows get a real row of guests (at most QUEUE_SHARE of the crowd)
    const wanted = new Map();
    let total = 0;
    for (const row of info.perPitch) if (row.problem && row.queueFigures > 0) { wanted.set(row.pitch, row.queueFigures); total += row.queueFigures; }
    const budget = Math.max(0, Math.floor(targetCount() * QUEUE_SHARE));
    const scale = total > budget && total > 0 ? budget / total : 1;
    for (const [pitch, n] of wanted) {
      const want = Math.floor(n * scale);
      let q = queues.get(pitch);
      if (!q) { q = { want: 0, agents: [], side: 1 }; queues.set(pitch, q); }
      q.want = want;
    }
    for (const [pitch, q] of queues) if (!wanted.has(pitch)) q.want = 0;
  }
  function targetCount() { return crowdTarget(quality, game.info().lambda, mode); }

  function reconcileQueues(f) {
    for (const [pitch, q] of queues) {
      q.agents = q.agents.filter(a => a.active);
      // release surplus from the back
      while (q.agents.length > q.want) { const a = q.agents.pop(); a.state = "return"; a.queuePitch = -1; a.slot = null; a.dest = null; a.timer = 0; a.cooldown = 8; }
      // recruit: take an inactive agent, put it at the nearest alley point and let it walk to its slot
      let guard = 0;
      while (q.agents.length < q.want && guard++ < 2) {
        const a = agents.find(x => !x.active);
        if (!a) break;
        const k = q.agents.length;
        let slot = queueSlot(rects[pitch], faces[pitch], k, q.side);
        if (!mask.allowed(slot.x, slot.z, 0.3)) { q.side = -q.side; slot = queueSlot(rects[pitch], faces[pitch], k, q.side); if (!mask.allowed(slot.x, slot.z, 0.3)) { q.want = k; break; } }
        dress(a, rnd() < 0.2 ? "kid" : "adult");
        a.active = true; a.leader = null; a.members = []; active++;
        // appear at the alley point nearest to the slot
        let best = null, bd = Infinity;
        for (const e of graph.edges) { for (let t = 0; t <= e.len; t += 4) { const p = edgePoint(e, 1, t, 0); const d = Math.hypot(p.x - slot.x, p.z - slot.z); if (d < bd) { bd = d; best = { e, t, p }; } } }
        if (best) { a.edge = best.e; a.dir = 1; a.s = best.t; a.x = a.ix = best.p.x; a.z = a.iz = best.p.z; }
        a.state = "toSlot"; a.slot = slot; a.queuePitch = pitch; a.item = 0;
        q.agents.push(a);
      }
    }
  }

  /* ---- movement */
  function chooseNext(a, f) {
    const node = a.dir > 0 ? a.edge.b : a.edge.a;
    const here = graph.nodes[node];
    const options = here.edges.filter(id => id !== a.edge.id).map(id => graph.edges[id]);
    if (!options.length) { a.dir = -a.dir; a.s = 0; a.lat = -a.lat; return; }       // dead end: turn around (the lane flips with the direction)
    // prefer going straight on: the same alley name
    let pick = options.find(e => e.name === a.edge.name && rnd() < 0.62) ?? options[Math.floor(rnd() * options.length)];
    a.dir = pick.a === node ? 1 : -1; a.s = 0; a.edge = pick;
    a.latJitter = (rnd() - 0.5) * (pick.lane > 1.5 ? 2.2 : 0.9); a.lat = pick.lane + a.latJitter;
  }

  function stepAgent(a, dt, f) {
    const speed = a.speed;
    let tx = a.ix, tz = a.iz, moving = false, face = null;
    switch (a.state) {
      case "walk": case "back": {
        const crowded = f && f.walk && Math.hypot(a.x - f.x, a.z - f.z) < 1.2;
        const step = crowded ? speed * dt * 0.25 : speed * dt;
        a.s += step; moving = true;
        if (a.s >= a.edge.len) { a.s -= a.edge.len; chooseNext(a, f); if (a.state === "back") a.state = "walk"; }
        const p = edgePoint(a.edge, a.dir, Math.min(a.edge.len, a.s + 0.6), a.lat);
        tx = p.x; tz = p.z;
        a.cooldown -= dt;
        if (a.state === "walk" && a.cooldown <= 0 && !a.leader) considerVisit(a);
        break;
      }
      case "visit": {
        const dx = a.dest.spot.x - a.ix, dz = a.dest.spot.z - a.iz, d = Math.hypot(dx, dz);
        if (d > 0.25) { const k = Math.min(1, speed * dt / d); a.ix += dx * k; a.iz += dz * k; moving = true; tx = a.ix; tz = a.iz; }
        else { a.state = "wait"; a.timer = a.dest.kind === "ride" ? 6 + rnd() * 8 : 3.5 + rnd() * 4.5; }
        tx = a.ix; tz = a.iz;
        break;
      }
      case "wait": {
        a.timer -= dt; tx = a.ix; tz = a.iz; face = { spot: { x: rects[a.dest.i].u, z: rects[a.dest.i].w } };
        if (a.timer <= 0) {
          if (a.dest.kind === "food") { a.item = 1; a.itemColor = FOOD_COLORS[a.dest.item] ?? 0xe0a24a; a.itemUntil = 18 + rnd() * 20; }
          a.state = "return";
        }
        break;
      }
      case "return": {
        // walk back to the nearest point of the lane (the closest sample of the current edge) and join it
        const p = edgePoint(a.edge, a.dir, clamp(a.s, 0, a.edge.len), a.lat);
        const dx = p.x - a.ix, dz = p.z - a.iz, d = Math.hypot(dx, dz);
        if (d > 0.4) { const k = Math.min(1, speed * dt / d); a.ix += dx * k; a.iz += dz * k; moving = true; } else { a.state = "walk"; a.dest = null; a.cooldown = 8 + rnd() * 14; }
        tx = a.ix; tz = a.iz;
        break;
      }
      case "toSlot": {
        const dx = a.slot.x - a.ix, dz = a.slot.z - a.iz, d = Math.hypot(dx, dz);
        if (d > 0.3) { const k = Math.min(1, speed * dt / d); a.ix += dx * k; a.iz += dz * k; moving = true; } else { a.state = "queue"; }
        tx = a.ix; tz = a.iz;
        break;
      }
      case "queue": { tx = a.ix; tz = a.iz; face = { spot: { x: rects[a.queuePitch].u, z: rects[a.queuePitch].w } }; break; }
      default: break;
    }
    if (a.state === "walk" || a.state === "back") { a.ix = tx; a.iz = tz; }
    return { moving, face };
  }

  function considerVisit(a) {
    a.cooldown = 1.2 + rnd() * 1.6;
    if (!destinations.length) return;
    let best = null, bestScore = 0;
    for (const d of destinations) {
      const dist = Math.hypot(d.spot.x - a.ix, d.spot.z - a.iz);
      if (dist > 15) continue;
      const q = queues.get(d.i);
      const score = (d.weight / (totalWeight / destinations.length)) * (1 - dist / 18) * (q && q.want > 0 ? 0.5 : 1);
      if (score > bestScore && rnd() < Math.min(0.55, 0.16 * score)) { best = d; bestScore = score; }
    }
    if (best) { a.dest = best; a.state = "visit"; a.cooldown = 99; }
  }

  /* ---- update */
  const tmpDir = new T.Vector3();
  function updateLights() {
    if (!env) return;
    const hemi = env.hemi, sun = env.sunLight;
    if (hemi) { const c = hemi.color; uniforms.uAmb.value.set(c.r * hemi.intensity, c.g * hemi.intensity, c.b * hemi.intensity); }
    if (sun) { const c = sun.color; uniforms.uSunCol.value.set(c.r * sun.intensity, c.g * sun.intensity, c.b * sun.intensity); tmpDir.copy(sun.position).normalize(); uniforms.uSunDir.value.copy(tmpDir); }
  }
  const angleDeltaShort = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  function updateSheep(dt) {
    const s = sheepState;
    if (!s.ready) {
      const main = graph.edges.filter(e => e.name === "haaptallee");
      if (!main.length) return;
      s.edge = main[Math.floor(main.length / 3)]; s.dir = 1; s.s = Math.min(s.edge.len * 0.4, 20); s.ready = true;
      const p = edgePoint(s.edge, s.dir, s.s, 0); s.x = p.x; s.z = p.z; s.yaw = Math.atan2(p.hz, p.hx);
    }
    s.timer -= dt;
    let moving = false;
    if (s.timer <= 0 && s.walkLeft === undefined) s.walkLeft = 6 + rnd() * 14;
    if (s.walkLeft !== undefined) {
      moving = true; s.walkLeft -= dt; s.s += s.speed * dt;
      if (s.s >= s.edge.len) {
        const node = s.dir > 0 ? s.edge.b : s.edge.a;
        const options = graph.nodes[node].edges.map(id => graph.edges[id]).filter(e => e.name === "haaptallee" && e.id !== s.edge.id);
        if (options.length) { const pick = options[Math.floor(rnd() * options.length)]; s.dir = pick.a === node ? 1 : -1; s.edge = pick; s.s = 0; } else { s.dir = -s.dir; s.s = 0; }
      }
      if (s.walkLeft <= 0) { s.walkLeft = undefined; s.timer = 3 + rnd() * 6; }
    }
    const p = edgePoint(s.edge, s.dir, clamp(s.s, 0, s.edge.len), 0.4 * Math.sin(s.s * 0.17));
    const dx = p.x - s.x, dz = p.z - s.z;
    s.x += dx * Math.min(1, dt * 3); s.z += dz * Math.min(1, dt * 3);
    if (moving && Math.hypot(dx, dz) > 0.002) s.yaw += angleDeltaShort(s.yaw, Math.atan2(dz, dx)) * Math.min(1, dt * 4);
    s.anim += dt * (moving ? 7 : 0);
    s.hop = Math.max(0, s.hop - dt * 2.4);
    const y = world.groundY(s.x, s.z);
    sheep.position.set(s.x, y + Math.abs(Math.sin(s.anim)) * 0.04 + Math.sin(Math.PI * Math.min(1, s.hop)) * 0.35, s.z);
    sheep.rotation.y = Math.PI / 2 - s.yaw;
  }

  let fr = 0;
  function update(dt) {
    if (dt <= 0) return;
    const f = getFocus();
    uniforms.uTime.value += dt;
    updateLights();
    dotMat.uniforms.uScale.value = r.state.size.h * r.state.size.dpr * 0.5 / Math.tan((camera.fov * Math.PI / 180) / 2);
    // population: follow the target slowly
    recount -= dt;
    if (recount <= 0) { recount = 1; refreshDestinations(); }
    queueClock -= dt;
    if (queueClock <= 0) { queueClock = 0.8; reconcileQueues(f); }
    let queued = 0; for (const q of queues.values()) queued += q.agents.length;
    const wantMore = targetCount() - queued;
    const plain = active - queued;
    if (plain < wantMore) { for (let k = 0; k < 2 && active < cap && plain + k < wantMore; k++) if (!spawnGroup(f, wantMore - plain - k)) break; }
    else if (plain > wantMore) {
      // drop the guest furthest from the focus (one that is out of view first); a lone guest before a family, a family only when it is clearly too many
      let worst = null, wd = -1e9;
      for (const a of agents) {
        if (!a.active || a.leader || a.queuePitch >= 0 || a.state === "queue" || a.state === "toSlot") continue;
        if (a.members.length + 1 > plain - wantMore + 1) continue;
        const d = f ? Math.hypot(a.x - f.x, a.z - f.z) + (inView(a.x, a.z, f, 80) ? -200 : 0) : 0;
        if (d > wd) { wd = d; worst = a; }
      }
      if (worst) release(worst);
    }
    if (repop) { repop = false; repopulate(f); }
    // recycle guests the walker left behind (or that wandered far off) into the zone around them: three checks per frame
    if (f && f.walk) {
      for (let n = 0; n < 3; n++) {
        fr = (fr + 1) % maxCap; const a = agents[fr];
        if (!a.active || a.leader || a.queuePitch >= 0 || a.state === "queue" || a.state === "toSlot" || a.state === "wait" || a.state === "visit") continue;
        const d = Math.hypot(a.x - f.x, a.z - f.z);
        const away = d > 100 || (d > 38 && Math.abs(angleDeltaShort(f.yaw, Math.atan2(a.z - f.z, a.x - f.x))) > 1.8);
        if (away && !inView(a.x, a.z, f, 140)) {
          if (place(a, f)) { a.state = "walk"; a.dest = null; for (const m of a.members) { m.x = m.ix = a.x; m.z = m.iz = a.z; } }
        }
      }
    }
    // step everybody, write the instance data (indexed by agent id: far guests get scale 0 here and a dot below)
    let near = 0, nDots = 0, last = -1;
    const nearR = mode === "walk" ? NEAR_WALK : mode === "ride" ? NEAR_RIDE : NEAR_BUILDER;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (const a of agents) {
      const o = a.id * 4;
      if (!a.active) { A.param[o + 2] = 0; continue; }
      last = a.id;
      let moving = false, face = null;
      if (a.leader) {
        const L = a.leader; const ch = Math.cos(L.yaw), sh = Math.sin(L.yaw);
        a.ix = L.ix - ch * a.oz - sh * a.ox; a.iz = L.iz - sh * a.oz + ch * a.ox;
        moving = L.walk > 0.5; a.state = L.state;
        if (L.state === "wait" || L.state === "queue") face = L.dest ? { spot: { x: rects[L.dest.i].u, z: rects[L.dest.i].w } } : null;
      } else { const res = stepAgent(a, dt, f); moving = res.moving; face = res.face; }
      // follow the ideal point (smoothed): no teleports on turns and lane changes
      const k = Math.min(1, dt * 4.2);
      let nx = a.x + (a.ix - a.x) * k, nz = a.z + (a.iz - a.z) * k;
      if (f && f.walk) { const dx = nx - f.x, dz = nz - f.z, d = Math.hypot(dx, dz); if (d < 1.25 && d > 1e-3) { const push = (1.25 - d) * 0.55; nx += dx / d * push; nz += dz / d * push; } }
      const vx = nx - a.x, vz = nz - a.z, sp = Math.hypot(vx, vz) / dt;
      a.x = nx; a.z = nz;
      const want = moving || sp > 0.25;
      a.walk += ((want ? 1 : 0) - a.walk) * Math.min(1, dt * 6);
      if (sp > 0.15) a.yaw += angleDeltaShort(a.yaw, Math.atan2(vz, vx)) * Math.min(1, dt * 7);
      else if (face && face.spot) a.yaw += angleDeltaShort(a.yaw, Math.atan2(face.spot.z - a.z, face.spot.x - a.x)) * Math.min(1, dt * 3);
      else if (a.leader) a.yaw += angleDeltaShort(a.yaw, a.leader.yaw) * Math.min(1, dt * 3);
      a.phase += dt * (sp > 0.2 ? Math.min(7.5, 2.6 + sp * 2.2) : 0);
      if (a.item && a.state !== "wait" && a.state !== "visit") { a.itemUntil -= dt; if (a.itemUntil <= 0) a.item = 0; }
      const y = world.groundY(a.x, a.z);
      a.dist = Math.hypot(a.x - cx, a.z - cz, (y - cy) * 0.5);
      if (a.dist <= nearR) {
        A.pos[o] = a.x; A.pos[o + 1] = y; A.pos[o + 2] = a.z; A.pos[o + 3] = a.yaw;
        A.param[o] = a.phase; A.param[o + 1] = a.walk; A.param[o + 2] = a.look.scale; A.param[o + 3] = a.item ? 1 : 0;
        if (a.item) col(a.itemColor, A.item, a.id * 3);
        near++;
      } else {
        A.param[o + 2] = 0;
        const d3 = nDots * 3;
        dotPos[d3] = a.x; dotPos[d3 + 1] = y + 1.0 * a.look.scale; dotPos[d3 + 2] = a.z;
        const s3 = a.id * 3; dotCol[d3] = A.shirt[s3]; dotCol[d3 + 1] = A.shirt[s3 + 1]; dotCol[d3 + 2] = A.shirt[s3 + 2];
        nDots++;
      }
    }
    geo.instanceCount = last + 1;
    for (const k of ["pos", "param", "item"]) attrs[k].needsUpdate = true;
    if (colorsDirty) { colorsDirty = false; for (const k of ["shirt", "pants", "hair", "skin"]) attrs[k].needsUpdate = true; }
    dotGeo.setDrawRange(0, nDots); dotPosAttr.needsUpdate = true; dotColAttr.needsUpdate = true;
    stats.near = near; stats.far = nDots; stats.active = active; stats.queued = queued;
    updateSheep(dt);
  }

  /* ---- sheep tap + bleat */
  const tmpV = new T.Vector3();
  function sheepScreen() {
    tmpV.set(sheepState.x, sheep.position.y + 0.7, sheepState.z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (tmpV.x + 1) / 2 * rect.width, y: rect.top + (1 - tmpV.y) / 2 * rect.height, z: tmpV.z, dist: Math.hypot(sheepState.x - camera.position.x, sheepState.z - camera.position.z) };
  }

  const api = {
    update, graph, group, sheep, stats, agents,
    get active() { return active; },
    get mode() { return mode; },
    /** 'walk' (dense around the walker), 'builder' (thinner, spread out) or 'ride' (full crowd spread over the fair: the view from the wheel) */
    setMode(m) { if (m !== mode) repop = true; mode = m; recount = 0; },
    setQuality(q) { if (CROWD_CAP[q]) { quality = q; cap = CROWD_CAP[q]; recount = 0; } },
    setNight(k) { night = k; uniforms.uNight.value = k; },
    target: () => targetCount(),
    cap: () => cap,
    sheepPosition: () => (sheepState.ready ? { x: sheepState.x, z: sheepState.z } : null),
    /** screen-space tap test (walk and builder) */
    tapSheep(x, y) {
      if (!sheepState.ready) return false;
      const p = sheepScreen();
      if (p.z >= 1 || p.z <= -1) return false;
      const reach = clamp(2200 / Math.max(6, p.dist), 34, 90);
      return Math.hypot(p.x - x, p.y - y) < reach && p.dist < 160;
    },
    bleat() { sheepState.hop = 1; onBleat(); },
    /** debug / tests: put the guest nearest to a point into a state, snapshot of what is drawn */
    queueCounts() { const o = {}; for (const [k, q] of queues) o[k] = { want: q.want, have: q.agents.filter(a => a.state === "queue").length }; return o; },
    refresh() { recount = 0; queueClock = 0; },
    /** spread the free guests around the focus again (after a teleport, a mode change) */
    repopulate() { repop = true; },
    dispose() { r.gameRoot.remove(group, sheep); geo.dispose(); dotGeo.dispose(); figMat.dispose(); dotMat.dispose(); sheep.geometry.dispose(); sheep.material.dispose(); },
  };
  game.on("change", () => { recount = 0; });
  return api;
}
