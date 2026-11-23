/* Round 7-C: the challenge course (a temporary race set-up while a timed run is on), from Ian's play of "Bout Blanc" in 3 Vallées.
 *   layout    barriers (net panels) along BOTH piste edges from the start gate to the finish, direction arrows at every junction with
 *             another piste (and every 250 m), the finish arch "ZIL" over a checkered line at the line's real end (pure: courseLayout)
 *   tracker   where the skier is on the course: the distance to the finish (HUD bar), the next waypoint (HUD arrow), off the course ->
 *             warn ("Zréck op d'Pist" + an arrow back) -> after COURSE.abortAfter s: abort (main.js: "Challenge ofgebrach" with
 *             Nach eng Kéier / Weider fräi fueren). NEVER a silent teleport (pure: createCourse)
 *   view      instanced barriers + arrows, the arch (4 draw calls; built on start, disposed at the end), the HUD bits (DOM) */
import { COURSE } from '../config.js';
import { createLineIndex } from '../pistes.js';
import { createNetMaterial } from '../netmesh.js';

const THREE = typeof window !== 'undefined' ? window.THREE : null;
const ARROW_EVERY = 250;
const NET_STEP = 0.5;               // m between the net ribbon's vertices
const NET_H = 1.05;                 // m: the net's height over the snow
const INTRUDE_PAD = 12;             // R8g: m the net stays open beyond a house / station hall reaching into the course (before it)
// 23 Nov 2026 (round7c --rides, Killy joseray: since the acceleration assist he goes round the 33 m hotel at 40-50 km/h and came back
// in 7 m below the gap, through the net): BELOW the house, where he swings back in, the gap reaches further
const INTRUDE_PAD_AFTER = 24;
const LINE_CLEAR = 0.2;             // R8g: m a net point stays beyond the half width from EVERY part of the course line
const JUNCTION_GAP = 60;

/** Spatial hash of every piste's 10 m samples (junction search), built once per piste set. */
const hashes = new WeakMap();
function pisteHash(pistes) {
  if (hashes.has(pistes)) return hashes.get(pistes);
  const h = new Map();
  for (const p of pistes.list) {
    for (let i = 0; i + 1 < p.n; i++) {
      const k = Math.floor(p.x[i] / 50) * 8192 + Math.floor(p.z[i] / 50);
      if (!h.has(k)) h.set(k, []);
      const dx = p.x[i + 1] - p.x[i], dz = p.z[i + 1] - p.z[i], L = Math.hypot(dx, dz) || 1;
      h.get(k).push([p, p.x[i], p.z[i], dx / L, dz / L]);
    }
  }
  hashes.set(pistes, h);
  return h;
}

/** The course of a piste from startS: { startS, finishS, finish {x, z, dx, dz}, barriers [{x, z, h, side}], arrows [{x, z, h, side, s}] }. */
export function courseLayout(piste, startS = 2, pistes = null, obs = null, finishIn = null) {      // R7-C2: obs (clear.js): no net through a house or a station
  const finishS = Math.max(startS + 30, finishIn !== null ? finishIn : piste.length - COURSE.finishBack);      // R8b: clear.js courseFinish
  const a = {};
  const barriers = [], arrows = [];
  const hw = piste.halfWidth;
  // the inside of a bend tighter than the barrier offset folds the offset line back over the course: those points are left out.
  // R8g: measured against the WHOLE course (gate -> ZIL), not +-40 m round s: where the line loops back near itself or a hairpin's
  // other leg runs alongside, the net of one leg stood across the other (27 of 1324 courses: Killy myrtilles, Arlberg riffel ...)
  const line = createLineIndex([{ piste, s0: startS, s1: finishS }]);
  const inside = (x, z) => line.distance(x, z, hw + 1) < hw + LINE_CLEAR || (obs && (obs.inBuilding(x, z, 0.4) || obs.nearStation(x, z, 0.4)));
  // R8e (Killy joseray: the line runs through a 33 x 31 m hotel, the net beside it closed the only way round): a house / station hall
  // reaching into the course within 3 m of the net opens the net there too, so he can ski round it; openAt(s, side) tells course.js
  const intrudes = (x, z, s) => { piste.at(s, a2); const dx = a2.x - x, dz = a2.z - z, d = Math.hypot(dx, dz) || 1; const ix = x + dx / d * 3, iz = z + dz / d * 3; return !!obs && (obs.inBuilding(ix, iz, 2.5) || !!obs.nearStation(ix, iz, 2.5)); };
  const a2 = {}, openS = { [-1]: [], [1]: [] };
  for (let s = startS + 4; s < finishS; s += COURSE.barrierEvery) {
    piste.at(s + COURSE.barrierEvery / 2, a);
    const h = Math.atan2(a.dz, a.dx);
    for (const side of [-1, 1]) {
      const x = a.x - a.dz * side * (hw + 0.5), z = a.z + a.dx * side * (hw + 0.5);
      if (!inside(x, z, a.s) && !intrudes(x, z, a.s)) barriers.push({ x, z, h, side });
    }
  }
  // R7-C2: the net itself = a ribbon per side whose bottom lies on the snow every NET_STEP m (no rigid panel floating over a dip or
  // sunk into a bump); runs [x, z, ...] broken where a point was left out
  const rails = [];
  let openLen = 0;                                        // m of edge left open (tight bends, houses, station halls)
  const nS = Math.floor((finishS + 1e-6 - startS - 4) / NET_STEP) + 1;
  for (const side of [-1, 1]) {
    // R8g: where a house / station hall opens the net, the gap reaches INTRUDE_PAD m further both ways: the skier (and the scripted
    // one, 2.5 m round it) goes round the house outside the net line and must find the gap open on his way back in too
    const open = new Uint8Array(nS), pad = Math.round(INTRUDE_PAD / NET_STEP), padAfter = Math.round(INTRUDE_PAD_AFTER / NET_STEP);
    for (let i = 0; i < nS; i++) {
      const s = startS + 4 + i * NET_STEP;
      piste.at(s, a);
      const x = a.x - a.dz * side * (hw + 0.5), z = a.z + a.dx * side * (hw + 0.5);
      if (intrudes(x, z, s)) for (let j = Math.max(0, i - pad); j <= Math.min(nS - 1, i + padAfter); j++) open[j] = 1;
    }
    let run = [];
    const cut = () => { if (run.length >= 4) rails.push(run); run = []; };
    for (let i = 0; i < nS; i++) {
      const s = startS + 4 + i * NET_STEP;
      piste.at(s, a);
      const x = a.x - a.dz * side * (hw + 0.5), z = a.z + a.dx * side * (hw + 0.5);
      if (open[i] || inside(x, z, s)) { cut(); openLen += NET_STEP; openS[side].push(s); continue; }
      // the outside of a kink in the 10 m line jumps by metres: fill the corner so no vertex is more than NET_STEP from the next
      const k = run.length;
      if (k) {
        const px = run[k - 2], pz = run[k - 1], d = Math.hypot(x - px, z - pz), m = Math.ceil(d / NET_STEP);
        const fill = [];
        let blocked = false;
        for (let j = 1; j < m && !blocked; j++) { const fx = px + (x - px) * j / m, fz = pz + (z - pz) * j / m; if (inside(fx, fz)) blocked = true; else fill.push(fx, fz); }
        if (blocked) { cut(); openS[side].push(s); } else run.push(...fill);
      }
      run.push(x, z);
    }
    cut();
  }
  const b2 = {};
  const arrowAt = (s) => {
    piste.at(s, a); piste.at(Math.min(finishS, s + 60), b2);
    const h = Math.atan2(a.dz, a.dx), turn = a.dx * b2.dz - a.dz * b2.dx;        // > 0: the course bends right (seen going down)
    for (const side of [-1, 1]) arrows.push({ x: a.x - a.dz * side * (hw - 1.5), z: a.z + a.dx * side * (hw - 1.5), h, side, s, turn });
  };
  const junctions = [];
  if (pistes) {
    const hash = pisteHash(pistes);
    for (let s = startS + 20; s < finishS - 20; s += 20) {
      piste.at(s, a);
      const k0 = Math.floor(a.x / 50), k1 = Math.floor(a.z / 50);
      let hit = false;
      for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) {
        for (const [q, x, z, dx, dz] of hash.get((k0 + i) * 8192 + (k1 + j)) || []) {
          if (q === piste) continue;
          if (Math.hypot(x - a.x, z - a.z) > hw * 1.3) continue;
          if (dx * a.dx + dz * a.dz < 0.87) { hit = true; break; }        // another piste meets or leaves at more than 30°
        }
      }
      if (hit && !junctions.some((t) => Math.abs(t - s) < JUNCTION_GAP)) junctions.push(s);
    }
  }
  for (const s of junctions) arrowAt(Math.max(startS + 8, s - 15));
  for (let s = startS + ARROW_EVERY; s < finishS - 60; s += ARROW_EVERY) if (!junctions.some((t) => Math.abs(t - s) < 80)) arrowAt(s);
  piste.at(finishS, a);
  /** R8e: is the net on `side` (+1 = right of the line) left open at s (no soft collision there either: course.js createCourse open)? */
  const openAt = (s, side) => { const L = openS[side > 0 ? 1 : -1]; let lo = 0, hi = L.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (Math.abs(L[m] - s) <= NET_STEP * 0.75) return true; if (L[m] < s) lo = m + 1; else hi = m - 1; } return false; };
  return { startS, finishS, finish: { x: a.x, z: a.z, dx: a.dx, dz: a.dz }, barriers, rails, openLen, arrows, junctions, halfWidth: hw, openAt };
}

/** Where the skier is on the course (pure). update(state, dt) -> { s, remaining, share, dist, warn, abort, back {x, z}, next {x, z} }.
 *  R7-C2: collide(prev, state) -> the state deflected by the barriers (soft: pushed back inside along the barrier, slowed a little). */
export function createCourse({ piste, startS = 2, finishS: finishIn = null, open = null }) {      // R8e: open(s, side) = courseLayout().openAt
  const finishS = Math.max(startS + 30, finishIn !== null ? finishIn : piste.length - COURSE.finishBack);
  const proj = {}, nxt = {}, back = {}, full = {}, cp = {}, ca = {}, wp = {};
  let hint = startS, offFor = 0, aborted = false, cHint = startS, lastOff = 0, hits = 0, low = Infinity, stuckFor = 0, bestS = startS;
  const out = { s: startS, remaining: finishS - startS, share: 0, dist: 0, warn: false, abort: false, why: '', back: { x: 0, z: 0 }, next: { x: 0, z: 0 }, offFor: 0, stuckFor: 0 };
  /** The projection that follows the skier: near the last spot, the whole line when he is far from it (a teleport, a respawn). */
  function follow(x, z, h, o) {
    piste.project(x, z, h, 160, o);
    if (o.dist > piste.halfWidth + 40) {
      piste.project(x, z, null, 0, full);
      if (full.dist < o.dist - 20) { o.s = full.s; o.off = full.off; o.dist = full.dist; }
    }
    return o;
  }
  function update(st, dt) {
    follow(st.x, st.z, hint, proj);
    hint = proj.s;
    out.s = proj.s; out.dist = proj.dist;
    // the HUD distance only falls (a hairpin or a line crossing itself must not make it jump back up); rebase() after a respawn
    low = Math.min(low, Math.max(0, finishS - proj.s));
    out.remaining = low;
    out.share = Math.min(1, Math.max(0, (proj.s - startS) / (finishS - startS)));
    piste.at(Math.min(finishS, proj.s + 45), nxt); out.next.x = nxt.x; out.next.z = nxt.z;
    piste.at(proj.s, back); out.back.x = back.x; out.back.z = back.z;
    const off = proj.dist > piste.halfWidth + COURSE.warnAfter && st.crash === 0;
    offFor = off ? offFor + dt : Math.max(0, offFor - dt * 2);
    out.warn = off;
    out.offFor = offFor;
    // R8b (3V QA: a blocked start trapped him for 3 min) -> R8g: the stuck timer lives here (main.js and the Node rides share it) and
    // never runs while he gets anywhere: COURSE.stuckAfter s standing (< 1 m/s, no crash) WITHOUT 1 m of progress down the course
    const moving = st.speed >= 1 || st.crash > 0;
    if (proj.s > bestS + 1 && proj.dist <= piste.halfWidth + COURSE.warnAfter) { bestS = proj.s; stuckFor = 0; }
    stuckFor = moving ? 0 : stuckFor + dt;
    out.stuckFor = stuckFor;
    out.abort = false;
    if (!aborted && (offFor > COURSE.abortAfter || stuckFor > COURSE.stuckAfter)) { aborted = true; out.abort = true; out.why = offFor > COURSE.abortAfter ? 'off' : 'stuck'; }
    return out;
  }
  /** The barriers stand at halfWidth + 0.5 m on both sides from the start gate to the finish. A skier crossing one from the inside
   *  (on the ground or in a low hop) is put back inside it, his speed into the net turned into a small bounce, his speed cut by
   *  COURSE.barrierSlow: he slides along the net, never through it, never to a standstill. Already outside (he came round the end,
   *  a respawn or a teleport put him there): no wall, he may ski back in. */
  let lastX = NaN, lastZ = NaN;
  function collide(prev, st) {
    const moved = Number.isFinite(lastX) && Math.hypot(prev.x - lastX, prev.z - lastZ) > 2;
    const out = collideStep(prev, st, moved);
    lastX = out.x; lastZ = out.z;
    return out;
  }
  function collideStep(prev, st, moved) {
    follow(st.x, st.z, cHint, cp);
    cHint = cp.s;
    const wall = piste.halfWidth + 0.5 - COURSE.barrierBody;
    const was = lastOff;
    lastOff = cp.off;
    if (cp.s < startS + 4 || cp.s > finishS || st.ride) return st;          // R8g: a crash slides into the net too (it catches him)
    if (Math.abs(cp.off) <= wall || Math.abs(was) > wall + 1.5) return st;
    // put down elsewhere since the last step (place / teleport / respawn): not a crossing, he may ski back in from there
    if (moved || Math.hypot(st.x - prev.x, st.z - prev.z) > 2) return st;
    // R8g: no jump clears the net any more (it used to after 0.25 s of air: a hop off a bump at the edge flew him out of the course
    // and he skied back in through the net further down, Killy couloir-de-la-table-d-orient, Arlberg schweinstroge): in the air too
    // the net turns him back along the course
    piste.at(cp.s, ca);
    const side = Math.sign(cp.off), rx = -ca.dz * side, rz = ca.dx * side;     // the outward normal of this barrier
    if (open && open(cp.s, side)) return st;                               // R8e: the net is open here (a house reaches into the course)
    // no net here: the inside of a bend tighter than the net's offset is left open (courseLayout), so is the wall
    piste.project(ca.x + rx * (piste.halfWidth + 0.5), ca.z + rz * (piste.halfWidth + 0.5), cp.s, 40, wp);
    if (wp.dist < piste.halfWidth + 0.2) return st;
    const vo = st.vx * rx + st.vz * rz;                                    // m/s towards the net
    const v = Math.hypot(st.vx, st.vz) || 1e-6, vt = st.vx * ca.dx + st.vz * ca.dz;
    // deflected along the net (down the course when he hit it square on): most of the speed kept, a little more lost the more
    // squarely he hit it, a small bounce back in; never a stop
    const dirT = Math.abs(vt) > 0.3 ? Math.sign(vt) : 1;
    const along = v * (COURSE.barrierSlow - 0.2 * Math.max(0, vo) / v);
    const bounce = Math.min(1.5, Math.max(0, vo) * COURSE.barrierBounce);
    const vx = vo > 0 ? ca.dx * dirT * along - rx * bounce : st.vx, vz = vo > 0 ? ca.dz * dirT * along - rz * bounce : st.vz;
    // pushed straight back in by how far he went past the wall (his progress along the course is kept: no snapping to a corner)
    const pen = Math.abs(cp.off) - wall + 0.05;
    const x = st.x - rx * pen, z = st.z - rz * pen;
    // the skis turn along the barrier (no heading into the net)
    const hx = Math.cos(st.heading), hz = Math.sin(st.heading), ho = hx * rx + hz * rz;
    const heading = ho > 0 ? Math.atan2(ca.dz * dirT, ca.dx * dirT) : st.heading;
    hits++;
    lastOff = side * (wall - 0.05);
    return { ...st, x, z, vx, vz, speed: Math.hypot(vx, vz), heading };
  }
  /** A respawn put him back a few metres: the distance may rise once to where he stands now. */
  function rebase() { low = Infinity; }
  return { update, collide, rebase, finishS, startS, get hits() { return hits; }, get aborted() { return aborted; }, reset() { aborted = false; offFor = 0; stuckFor = 0; } };
}

/** Where every course object stands (pure: the view and the Node check share it): barrier panels following the slope, arrow boards
 *  on posts, the ZIL arch (two pillars standing on their own ground, a level beam on top: upright on a cross slope too) and the
 *  checkered finish line, a strip whose vertices lie on the snow across the piste (it never sinks into a cross slope).
 *  Each object: { kind, x, z, y (bottom), top, size [w, h, d], ground [lowest, highest] under it }. */
export function courseSeats(layout, height) {
  const out = { barriers: [], arrows: [], posts: [], pillars: [], beam: null, line: null };
  for (const b of layout.barriers) {
    const g = height(b.x, b.z);
    out.barriers.push({ kind: 'barrier', x: b.x, z: b.z, h: b.h, y: g - 0.1, top: g + NET_H + 0.1, size: [0.07, NET_H + 0.2, 0.07], ground: [g, g] });
  }
  // the net ribbons: bottom 3 cm in the snow at every vertex; gap / sunk = the snow half way between two vertices vs the edge
  out.nets = [];
  out.netGap = 0; out.netSunk = 0;
  for (const r of layout.rails || []) {
    const ys = new Float32Array(r.length / 2);
    for (let i = 0; i < ys.length; i++) ys[i] = height(r[2 * i], r[2 * i + 1]) - 0.03;
    for (let i = 0; i + 1 < ys.length; i++) {
      const gm = height((r[2 * i] + r[2 * i + 2]) / 2, (r[2 * i + 1] + r[2 * i + 3]) / 2), em = (ys[i] + ys[i + 1]) / 2;
      out.netGap = Math.max(out.netGap, em - gm); out.netSunk = Math.max(out.netSunk, gm - em);
    }
    out.nets.push({ kind: 'net', xz: r, ys });
  }
  for (const a of layout.arrows) {
    const g = height(a.x, a.z);
    out.arrows.push({ kind: 'arrow', x: a.x, z: a.z, h: a.h, side: a.side, turn: a.turn, y: g + 1.6, top: g + 2.7, size: [1.1, 1.1, 0.02], ground: [g, g] });
    out.posts.push({ kind: 'post', x: a.x, z: a.z, y: g - 0.1, top: g + 1.65, size: [0.08, 1.75, 0.08], ground: [g, g] });
  }
  const f = layout.finish, hw = layout.halfWidth + 1.5;
  const ends = [-1, 1].map((side) => { const x = f.x - f.dz * side * hw, z = f.z + f.dx * side * hw; return { side, x, z, g: height(x, z) }; });
  const gHi = Math.max(ends[0].g, ends[1].g), gLo = Math.min(ends[0].g, ends[1].g);
  const top = gHi + COURSE.archHeight, beamH = 1.4;
  for (const e of ends) out.pillars.push({ kind: 'pillar', side: e.side, x: e.x, z: e.z, y: e.g - 0.4, top, size: [0.9, top - e.g + 0.4, 0.9], ground: [e.g, gHi] });
  out.beam = { kind: 'beam', x: f.x, z: f.z, y: top - beamH, top, size: [0.4, beamH, hw * 2 + 0.9], ground: [gLo, gHi] };
  // the finish line: a strip 1.6 m deep across the piste, a vertex every ~1.5 m on both edges, 6 cm above the snow
  const n = Math.max(4, Math.ceil(hw * 2 / 1.5));
  const verts = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= n; i++) {
    const u = -hw + (2 * hw * i) / n;
    for (const along of [-0.8, 0.8]) {
      const x = f.x + f.dx * along - f.dz * u, z = f.z + f.dz * along + f.dx * u, g = height(x, z);
      lo = Math.min(lo, g); hi = Math.max(hi, g);
      verts.push(x, g + 0.06, z, along > 0 ? 1 : 0, i / n);
    }
  }
  out.line = { kind: 'line', n, verts, y: lo + 0.06, top: hi + 0.06, size: [1.6, 0, hw * 2], ground: [lo, hi] };
  return out;
}

/* ---------------- the view ---------------- */
function textTexture(text, w = 512, h = 128, bg = '#d0352c', fg = '#ffffff') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.72)}px Geist, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h * 0.54);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function checkerTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const g = c.getContext('2d');
  for (let j = 0; j < 16; j++) for (let i = 0; i < 2; i++) { g.fillStyle = (i + j) % 2 ? '#16171a' : '#ffffff'; g.fillRect(i * 8, j * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.wrapT = THREE.RepeatWrapping; return t;
}

export function createCourseView({ scene, layout, height }) {
  const objs = [];
  const dummy = new THREE.Object3D();
  // barriers: the orange net = one ribbon mesh (both sides) whose bottom follows the snow, on thin posts every COURSE.barrierEvery m
  const postG = new THREE.CylinderGeometry(0.03, 0.035, 1, 5); postG.translate(0, 0.5, 0);
  const net = new THREE.InstancedMesh(postG, new THREE.MeshLambertMaterial({ color: 0x3a3f47 }), Math.max(1, layout.barriers.length));
  net.count = layout.barriers.length; net.name = 'ski-course-barriers'; net.frustumCulled = false;
  // R8g: a see-through orange mesh (4 x 4 diamonds per metre) with a white top edge, not a solid orange wall
  const ribbon = new THREE.Mesh(new THREE.BufferGeometry(), createNetMaterial({ color: '#ff6a13', cells: 4, rows: 4, band: '#ffffff' }));
  ribbon.name = 'ski-course-nets'; ribbon.frustumCulled = false;
  objs.push(net, ribbon);
  // arrows: a yellow board with a black chevron on a post, facing the skier coming down; the chevron points the way the course goes
  // from there (up = straight on, right / left = the course bends that way within 60 m)
  const ac = document.createElement('canvas'); ac.width = 64; ac.height = 64;
  const ag = ac.getContext('2d'); ag.fillStyle = '#f2c200'; ag.fillRect(0, 0, 64, 64); ag.fillStyle = '#16171a';
  ag.beginPath(); ag.moveTo(20, 10); ag.lineTo(46, 32); ag.lineTo(20, 54); ag.lineTo(12, 46); ag.lineTo(30, 32); ag.lineTo(12, 18); ag.closePath(); ag.fill();
  const board = new THREE.PlaneGeometry(1.1, 1.1);
  const arrowMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(ac), side: THREE.DoubleSide });
  const arrows = new THREE.InstancedMesh(board, arrowMat, Math.max(1, layout.arrows.length));
  const postGeo = new THREE.CylinderGeometry(0.035, 0.04, 1.75, 5); postGeo.translate(0, 0.875, 0);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x2b2f36 }), Math.max(1, layout.arrows.length));
  arrows.count = posts.count = layout.arrows.length; arrows.name = 'ski-course-arrows'; posts.name = 'ski-course-arrow-posts'; arrows.frustumCulled = posts.frustumCulled = false;
  objs.push(arrows, posts);
  // finish: two red pillars on their own ground, a level beam with "ZIL" both ways on top, a checkered strip on the snow
  const f = layout.finish, hw = layout.halfWidth + 1.5, fh = Math.atan2(f.dz, f.dx);
  const red = new THREE.MeshLambertMaterial({ color: 0xd0352c });
  const zil = textTexture('ZIL', Math.min(2048, Math.round(128 * (hw * 2 + 0.9) / 1.4)), 128);       // the canvas has the beam's shape
  const zilMat = new THREE.MeshLambertMaterial({ map: zil });
  const lineMat = new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const arch = new THREE.Group();
  arch.name = 'ski-course-finish';
  objs.push(arch);
  let seats = null;
  function seat() {
    seats = courseSeats(layout, height);
    seats.barriers.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, b.size[1], 1);
      dummy.updateMatrix(); net.setMatrixAt(i, dummy.matrix);
    });
    dummy.scale.set(1, 1, 1);
    const P = [], U = [], I = [];
    for (const n of seats.nets) {
      let d = 0;
      for (let i = 0; i < n.ys.length; i++) {
        if (i) d += Math.hypot(n.xz[2 * i] - n.xz[2 * i - 2], n.xz[2 * i + 1] - n.xz[2 * i - 1]);
        const v = P.length / 3;
        P.push(n.xz[2 * i], n.ys[i], n.xz[2 * i + 1], n.xz[2 * i], n.ys[i] + NET_H, n.xz[2 * i + 1]);
        U.push(d / 1.05, 0, d / 1.05, 1);
        if (i) I.push(v - 2, v, v - 1, v - 1, v, v + 1);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    rg.setIndex(I); rg.computeVertexNormals(); rg.computeBoundingSphere();
    ribbon.geometry.dispose(); ribbon.geometry = rg;
    seats.arrows.forEach((a, i) => {
      const th = Math.atan2(-Math.cos(a.h), -Math.sin(a.h));           // the board's face looks back up the piste
      const roll = Math.PI / 2 * (1 - Math.max(-1, Math.min(1, (a.turn || 0) * 3)));
      dummy.position.set(a.x, a.y + 0.55, a.z); dummy.rotation.set(0, th, roll, 'YXZ'); dummy.updateMatrix(); arrows.setMatrixAt(i, dummy.matrix);
      const p = seats.posts[i];
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
    });
    net.instanceMatrix.needsUpdate = arrows.instanceMatrix.needsUpdate = posts.instanceMatrix.needsUpdate = true;
    // the arch, rebuilt from its seats (world coordinates; pillars and beam turned to face along the piste)
    for (const c of [...arch.children]) { arch.remove(c); c.geometry.dispose(); }
    for (const p of seats.pillars) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]), red);
      m.position.set(p.x, p.y + p.size[1] / 2, p.z); m.rotation.y = -fh; m.name = 'ski-course-pillar';
      arch.add(m);
    }
    const bm = seats.beam;
    // the beam across the piste (local z); its two faces towards and away from the skier (+x, -x) carry "ZIL"
    const beam = new THREE.Mesh(new THREE.BoxGeometry(bm.size[0], bm.size[1], bm.size[2]), [zilMat, zilMat, red, red, red, red]);
    beam.position.set(bm.x, bm.y + bm.size[1] / 2, bm.z); beam.rotation.y = -fh; beam.name = 'ski-course-beam';
    arch.add(beam);
    const L = seats.line, pos = [], uv = [], idx = [], rep = Math.max(2, Math.round(hw / 3));
    for (let k = 0; k < L.verts.length; k += 5) { pos.push(L.verts[k], L.verts[k + 1], L.verts[k + 2]); uv.push(L.verts[k + 3], L.verts[k + 4] * rep); }
    for (let i = 0; i < L.n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    lg.setIndex(idx); lg.computeVertexNormals(); lg.computeBoundingSphere();
    const line = new THREE.Mesh(lg, lineMat); line.name = 'ski-course-line';
    arch.add(line);
  }
  seat();
  for (const o of objs) scene.add(o);
  return {
    objs,
    get seats() { return seats; },
    /** Streamed height tiles arrived under the course: every piece onto the final snow. */
    reseat: seat,
    dispose() {
      for (const o of objs) {
        scene.remove(o);
        o.traverse((m) => { if (m.geometry) m.geometry.dispose(); const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; for (const x of ms) { if (x.map) x.map.dispose(); x.dispose(); } });
      }
    },
  };
}

/** The HUD text of the distance to the finish (pure, the Node check reads it too). */
export const distanceText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km bis ZIL` : `${Math.round(m)} m bis ZIL`);

/** The course HUD:the distance bar to the finish, an arrow to the next waypoint, the off-course warning. */
export function createCourseHud(hudEl) {
  const box = document.createElement('div');
  box.id = 'courseHud'; box.hidden = true;
  box.innerHTML = '<span class="arrow" id="cArrow">↑</span><div class="bar"><i id="cBar"></i></div><span id="cLeft"></span>';
  const warn = document.createElement('div');
  warn.id = 'courseWarn'; warn.hidden = true;
  warn.innerHTML = '<span class="arrow" id="cBack">↑</span><span>Zréck op d\'Pist</span>';
  hudEl.appendChild(box); hudEl.appendChild(warn);
  const arrowEl = box.querySelector('#cArrow'), bar = box.querySelector('#cBar'), left = box.querySelector('#cLeft'), backEl = warn.querySelector('#cBack');
  const rel = (st, camYaw, p) => {
    const a = Math.atan2(p.z - st.z, p.x - st.x) - camYaw;       // world angle relative to the view direction (screen up = ahead)
    return a * 180 / Math.PI;
  };
  return {
    show(v) { box.hidden = !v; if (!v) warn.hidden = true; },
    set(c, st, camYaw) {
      bar.style.width = `${(c.share * 100).toFixed(1)}%`;
      left.textContent = distanceText(c.remaining);
      arrowEl.style.transform = `rotate(${rel(st, camYaw, c.next).toFixed(0)}deg)`;
      warn.hidden = !c.warn;
      if (c.warn) backEl.style.transform = `rotate(${rel(st, camYaw, c.back).toFixed(0)}deg)`;
      document.documentElement.dataset.skiCourseWarn = c.warn ? '1' : '';
    },
  };
}

/** "Challenge ofgebrach": the skier left the course too long. A choice, never an automatic teleport. */
export function showCourseAbort(root, { name, why = 'off', onAgain, onFree }) {
  const c = document.createElement('div');
  c.className = 'coursecard'; c.id = 'courseAbort';
  c.innerHTML = `<b>Challenge ofgebrach</b><span></span>
    <div class="acts"><button type="button" class="btn primary" data-a="again">Nach eng Kéier</button><button type="button" class="btn" data-a="free">Weider fräi fueren</button></div>`;
  // R8g: say what ran out (Ian read a stop in front of a net as "the challenge timed out")
  c.querySelector('span').textContent = why === 'stuck' ? `Du bass ze laang${name ? ` op der ${name}` : ''} stoe bliwwen.` : `Du bass ze laang nieft der Pist${name ? ` ${name}` : ''} gefuer.`;
  c.dataset.why = why;
  root.appendChild(c);
  c.querySelector('[data-a="again"]').addEventListener('click', () => { c.remove(); onAgain(); });
  c.querySelector('[data-a="free"]').addEventListener('click', () => { c.remove(); onFree(); });
  document.documentElement.dataset.skiCourse = 'aborted';
  return { close() { c.remove(); } };
}
