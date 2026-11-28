/* Lifts (scenery): the real OSM lift lines with their pylons, the ropes, the stations of lift-site.js, and the chairs / cabins / bars /
 * trains moving round the loop. Lifts farther than quality.liftRadius do not move their carriers (instanced, near and far detail of
 * one model: modes/carriers.js). The line of every lift comes from lift-path.js (also what modes/liftride.js rides).
 * Round 6: setRide(index, u) holds one carrier of that lift at the loop parameter u (the player's own, drawn by the ride, so the pool
 * skips it; the lift's other carriers keep their spacing around it and carry on smoothly when the ride ends).
 * Round 7-B: every lift has its two stations by type (lift-site.js: chair platform with gates, gondola hall, cable-car terminal, drag
 * hut + wheel mast, belt ends, rail platforms, tunnel portals, a train's stops); every chair / cabin hangs from the rope by its grip,
 * follows the sag, swings a little and goes round the bull-wheels; drag lifts: pylons beside the track with an arm over it, the bars
 * on a real loop (the empty ones come back down on the return rope), a worn track in the snow; magic carpets: a moving belt;
 * underground funiculars run in a lit tunnel tube. */
const THREE = window.THREE;

import { createLiftPath, chairWidth } from './lift-path.js';
import { createLiftWorld, frames, stationCrawl, HALL_SLOW, SITE_COLOURS } from './lift-site.js';
import { carrierGeometry, bubbleGeometry, BUBBLE, GLASS } from './modes/carriers.js';
import { mergeParts } from './modes/views.js';
import { gpuOnly } from './gpu-mem.js';
import { carrierId } from './npc.js';
import { shapeGeometry, mergeLit, stationMaterial } from './station-mesh.js';
const DOWN_RIDERS = 1e6, DOWN_SHARE = 0.3;       // ride down: rider ids of the down lane, and how full it is against the up lane
/* Station look: gondola cabins slow down in the halls (detached from the rope, as real ones) and catch up on the line: the pool draws
 * the cabin of loop parameter u at hallWarp(u) (a monotone map of the loop onto itself: `speed` x line speed inside a hall (+ the bull-
 * wheel turn), a `ramp` m smooth change, a little faster on the line; at most `stretch` x the line's own speed), anchored at the bottom
 * loading point (a cabin is where the loop puts it when it picks a rider up). A lift the player rides eases back to the plain loop in
 * `blend` s (his own cabin is drawn by the ride at its plain place: its neighbours keep their spacing to it, never closer than in a hall). */
// (HALL_SLOW / CHAIR_SLOW now live in lift-site.js: the player's own ride uses the same curve)
// chairs round (26 Nov 2026): a detachable chair lets go of the rope under the terminal's shell and rolls slowly along the station rail
// round the bull-wheel (the loading / unloading line included), then speeds up again: the same map with the shell's length

const FINE = Object.freeze({ size: 2.1, cell: 1250, share: 0.25, max: 700 });     // R8d: small station parts within share x liftRadius (<= max m)
// Station look (26 Nov 2026): the stations' near detail (window frames, doors, lamps, mullions, trims: parts flagged `near`) per NEAR_DETAIL.cell
// m cell, drawn while the camera is within NEAR_DETAIL.radius m of the cell (the main volumes, roofs and snow stay in the chunks)
const NEAR_DETAIL = Object.freeze({ cell: 640, radius: 250 });
/** How a station part glows in the evening (station-mesh.js aGlow): its own `glow`, else lamps and windows by colour; snow = -1. */
const glowOf = (p) => (p.glow !== undefined ? p.glow : p.col === SITE_COLOURS.light ? 1.1 : p.col === SITE_COLOURS.glass ? 0.45 : p.col === SITE_COLOURS.snow ? -1 : 0);
const TRACK_R = 900;                   // R8d: m to a drag track cell's box within which its worn tracks are drawn (a 1.25 m strip)
const NEAR_R = 130;                    // m: carriers closer than this get the full model, the rest the far one
const FAR_R = { chair: 750, drag: 320, gondola: 1300, cable: 3000, train: 3000 };      // m: beyond this a carrier is ~2 px (R8c: chairs 1100 -> 750, gondolas 1600 -> 1300: Courchevel drew 159k triangles of carriers; R8d: drag bars 450 -> 320, 14k at Courchevel)
const DWELL = 8;                       // s a jig-back cabin / train waits at a station
// R8e (3V QA: no cable car waiting at the bottom station): the jig-back pairs run at the ride's speed (liftride.js RIDE.factor), so the
// one you ride and the ones you watch keep one schedule, and a wait for the next cabin stays short
const SHUTTLE_FACTOR = 4;
/* R8: the lift-name signs on the stations (lift-site.js `sign` parts): the nearest SIGN.slots signs within SIGN.radius get their name in
 * one shared canvas atlas, one merged mesh = one draw call; re-chosen every SIGN.every s as the skier moves. */
const SIGN = Object.freeze({ slots: 12, radius: 320, every: 1.2, slotW: 512, slotH: 64, cols: 2 });      // (a small atlas: WebKit uploads it whole)

export function createLifts({ scene, resort, height, env = null }) {
  const lifts = [];
  const byIndex = new Map();
  const paths = new Map();
  resort.lifts.forEach((src, index) => { const path = createLiftPath(src, height); if (path) paths.set(index, path); });
  const world = createLiftWorld(paths);              // the stations (with the parts that stand in a neighbour's lane left out)
  for (const [index, path] of paths) {
    const l = { ...path, path, site: world.sites.get(index), index, offset: (index * 7.31) % 50, rideU: null };
    lifts.push(l); byIndex.set(index, l);
  }

  const group = new THREE.Group();
  group.name = 'ski-lifts';
  scene.add(group);
  const disposables = [];
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const smat = stationMaterial(env);                    // station look: the stations' chunks (lit windows / lamps, evening snow)
  disposables.push(vmat, smat);

  // ---------------- static parts: pylons, ropes, stations, tracks, belts, tunnels ----------------
  const parts = [];                                     // [geometry, colour, matrix] merged into one mesh
  const rot = (fx, fz) => new THREE.Matrix4().makeRotationY(-Math.atan2(fz, fx));
  // R8d (Niddreg budget: Courchevel drew ~68k triangles of stations / pylons): the small parts (rails, gates, lamps, sheave frames,
  // hubs: every side < FINE.size m) go into `fine` cells drawn only near the camera; the big ones stay in the 2.5 km chunks
  const fine = [];
  const nearParts = [];                 // station look: the near detail (NEAR_DETAIL)
  const bin = (w, h, d, near = false) => (near ? nearParts : Math.max(w, h, d) < FINE.size ? fine : parts);
  const boxAt = (w, h, d, x, y, z, fx, fz, colour, glow = 0, near = false, shape = null, inset = 0.4, form = null) => bin(w, h, d, near).push([shape ? shapeGeometry(shape, w, h, d, inset, form) : new THREE.BoxGeometry(w, h, d), colour, rot(fx, fz).setPosition(x, y, z), glow]);
  const cylAt = (r0, r1, h, x, y, z, colour, n = 8, glow = 0, near = false) => bin(2 * Math.max(r0, r1), h, 2 * Math.max(r0, r1), near).push([new THREE.CylinderGeometry(r0, r1, h, n), colour, new THREE.Matrix4().makeTranslation(x, y, z), glow]);
  const tmpW = {};
  const signSpots = [];                 // R8: { x, y, z, nx, nz, w, h, text } of every uncut name sign
  /** One station frame's parts in the world, seated on the ground (a part that touches the ground reaches down to its lowest point). */
  function addFrame(f, l = null) {
    const g0 = height(f.x, f.z);
    for (const p of f.parts) {
      if (p.cut || p.hide) continue;                                              // (chairs round: hide = a collider drawn by other parts)
      if (p.gateLeaf) { leaves.push({ l, f, p, g0 }); continue; }                // after launch: the chair gates (instanced, they swing)
      if (p.belt) { beltQuad(f, p, g0); continue; }                                  // after launch: a chair's loading belt (it runs)
      if (p.sign && l) {
        const name = String((l.src && l.src.name) || '').trim();
        if (name) {
          const face = p.sign.face, b = face > 0 ? p.b1 + 0.03 : p.b0 - 0.03;
          const c = f.toWorld((p.a0 + p.a1) / 2, b, {});
          signSpots.push({ x: c.x, y: g0 + (p.y0 + p.y1) / 2, z: c.z, nx: f.rx * face, nz: f.rz * face, w: p.a1 - p.a0, h: p.y1 - p.y0, text: name });
        }
      }
      const ca = (p.a0 + p.a1) / 2, cb = (p.b0 + p.b1) / 2;
      f.toWorld(ca, cb, tmpW);
      let y0 = g0 + p.y0;
      if (p.y0 <= 0.05) {
        let low = Infinity;
        for (const [a, b] of [[p.a0, p.b0], [p.a1, p.b0], [p.a0, p.b1], [p.a1, p.b1], [ca, cb]]) { const w = f.toWorld(a, b, {}); low = Math.min(low, height(w.x, w.z)); }
        if (low - 0.3 < y0) {
          if (p.deck && g0 + p.y0 - low > 0.2) foundation(p, g0, low, f);
          else if (!p.deck) y0 = low - 0.3;
        }
      }
      const h = g0 + p.y1 - y0;
      if (h <= 0.005) continue;
      const glow = glowOf(p);
      if (p.post && Math.abs(p.a1 - p.a0 - (p.b1 - p.b0)) < 1e-3) cylAt((p.a1 - p.a0) / 2, (p.a1 - p.a0) / 2, h, tmpW.x, y0 + h / 2, tmpW.z, p.col, 8, glow, !!p.near);
      else boxAt(p.a1 - p.a0, h, p.b1 - p.b0, tmpW.x, y0 + h / 2, tmpW.z, f.fx, f.fz, p.col, glow, !!p.near, p.shape || null, p.inset, p.form || null);
    }
  }
  /** Station look: a deck standing above the snow (a summit on a slope) sits on a dressed stone foundation down to the lowest ground under
   *  it: rough stone, a darker footing course, a concrete edge band under the deck (each reaching the ground: nothing floats). */
  function foundation(p, g0, low, f) {
    const top = g0 + p.y0, w = p.a1 - p.a0, d = p.b1 - p.b0;
    const c = f.toWorld((p.a0 + p.a1) / 2, (p.b0 + p.b1) / 2, {});
    const foot = Math.min(0.7, (top - low) * 0.3);
    boxAt(w, top - low + 0.3, d, c.x, (top + low - 0.3) / 2, c.z, f.fx, f.fz, 0x7d746b);
    boxAt(w + 0.16, foot + 0.3, d + 0.16, c.x, low - 0.3 + (foot + 0.3) / 2, c.z, f.fx, f.fz, 0x5f5953);
    boxAt(w + 0.1, 0.32, d + 0.1, c.x, top - 0.16 + 0.02, c.z, f.fx, f.fz, 0xa9a59d);
  }
  const leaves = [];                    // after launch: the chair stations' gate leaves { l, f, p, g0 }
  /** A chair's loading belt: a flat quad on the deck in the frame (a0..a1 x b0..b1) at its top, the cleats running towards -a. */
  function beltQuad(f, p, g0) {
    const y = g0 + p.y1 + 0.003, pos = [], uv = [];
    for (const [a, b, u] of [[p.a0, p.b0, 0], [p.a0, p.b1, 1], [p.a1, p.b0, 0], [p.a1, p.b1, 1]]) { const w = f.toWorld(a, b, {}); pos.push(w.x, y, w.z); uv.push(u, -a / 2); }
    beltParts.push({ pos, uv, idx: [0, 1, 2, 1, 3, 2, 0, 2, 1, 1, 2, 3] });
  }
  const cablePts = [];
  const trackParts = [];                // drag-lift tracks (one ribbon mesh)
  const beltParts = [];                 // magic carpets (the moving belt)
  const tunnelParts = [];               // tunnel tubes (self-lit)
  const tunnelLamps = [];               // and their lamps
  const q = {}, q2 = {};
  for (const l of lifts) {
    const { spec, kind } = l;
    // pylons: a column on the line, the crossbar over both lanes (drag lifts: the arm over the track and the return rope), the
    // sheave trains above the ropes (the grips pass under them)
    for (const s of l.supports) {
      if (!s.tower) continue;
      l.at(s.s, q);
      const g = height(q.x, q.z) - 0.5;
      const thin = l.sub === 'rope';
      const top = s.y + (kind === 'drag' && !thin ? 0.9 : 0.55) - g;          // R8: a drag column reaches its boom and cap
      cylAt(thin ? 0.08 : kind === 'drag' ? 0.17 : 0.28, thin ? 0.1 : kind === 'drag' ? 0.25 : 0.42, top, q.x, g + top / 2, q.z, 0x8a9099, 6);      // R8: a drag column is a slim steel tube
      const span = l.side + l.back + (thin ? 0.4 : 1.4), mid = l.sign * (l.side - l.back) / 2;
      if (kind === 'drag' && !thin) {
        // R8 (review: crude drag pylon heads): a slim boom over both ropes, a red cap on the column, and at each rope a sheave train
        // (a frame with its rubber-lined wheels) the rope runs under: one up + one return rope per lift, both visibly held
        boxAt(0.22, 0.24, span - 0.6, q.x - q.dz * mid, s.y + 0.78, q.z + q.dx * mid, q.dx, q.dz, 0x4a515c);
        boxAt(0.5, 0.26, 0.5, q.x, s.y + 1.0, q.z, q.dx, q.dz, 0xc8332a);
        for (const lat of [l.side * l.sign, -l.back * l.sign]) {
          boxAt(1.25, 0.12, 0.16, q.x - q.dz * lat, s.y + 0.58, q.z + q.dx * lat, q.dx, q.dz, 0x2b2f36);
          boxAt(0.95, 0.3, 0.09, q.x - q.dz * lat, s.y + 0.37, q.z + q.dx * lat, q.dx, q.dz, 0x1d2025);
        }
      } else {
        boxAt(0.5, thin ? 0.12 : 0.35, span, q.x - q.dz * mid, s.y + (thin ? 0.3 : 0.72), q.z + q.dx * mid, q.dx, q.dz, 0x343a44);
        if (!thin) for (const lat of [l.side * l.sign, -l.back * l.sign]) boxAt(1.8, 0.22, 0.26, q.x - q.dz * lat, s.y + 0.38, q.z + q.dx * lat, q.dx, q.dz, 0x2b2f36);
      }
    }
    // ropes (with the sag) round the loop; trains: two tracks of two rails each
    if (kind === 'train') {
      for (const off of [-l.side - 0.5, -l.side + 0.5, l.side - 0.5, l.side + 0.5]) {
        for (let k = 0; k + 1 < l.supports.length; k++) {
          const a = l.supports[k], b = l.supports[k + 1];
          const qa = l.at(a.s, {}), qb = l.at(b.s, {});
          cablePts.push(qa.x - qa.dz * off, a.y, qa.z + qa.dx * off, qb.x - qb.dz * off, b.y, qb.z + qb.dx * off);
        }
      }
    } else if (kind !== 'carpet') {
      const steps = Math.max(8, Math.ceil(l.loopLen / 8));
      // R8e: a funitel runs on two haul ropes 3.2 m apart (the cabin's two grips, carriers.js)
      for (const off of l.sub === 'funitel' ? [-1.6, 1.6] : [0]) {
        let prev = null;
        for (let k = 0; k <= steps; k++) {
          const w = l.loopAt((k / steps) * l.loopLen, {});
          if (off) { const ox = -Math.sin(w.heading) * off, oz = Math.cos(w.heading) * off; w.x += ox; w.z += oz; }
          if (prev && !(l.shuttle && Math.abs(w.s - prev.s) > l.len * 0.5)) cablePts.push(prev.x, prev.y, prev.z, w.x, w.y, w.z);
          prev = w;
        }
      }
    }
    // the stations (and portals, stops)
    for (const f of frames(l.site)) addFrame(f, l);
    // the bull-wheels of the loop lifts: a ring at rope height round the turn
    if (!l.shuttle) {
      for (const which of [0, 1]) {
        const f = l.site.ends[which];
        const c = f.toWorld(0, l.wheelC, {});
        const y = l.cableY(which ? l.len : 0);
        // chairs round: an open rim (the rope runs in it) with spokes to the hub, the wheel visible from below
        const rw = l.wheelR + 0.12;
        boxAt(2 * rw, 0.26, 2 * rw, c.x, y + 0.08, c.z, 1, 0, 0x3e4249, 0, false, 'rim', 0.4, { t: Math.min(0.32, rw * 0.3), segs: 12 });
        cylAt(0.35, 0.35, 0.5, c.x, y + 0.35, c.z, 0xc8332a, 10);
        for (let k = 0; k < 3; k++) { const t = k * Math.PI / 3; boxAt(2 * rw - 0.3, 0.1, 0.16, c.x, y + 0.08, c.z, Math.cos(t), Math.sin(t), 0x737b86, 0, true); }
      }
    }
    // a drag lift's worn track: a packed, darker strip under the up rope
    if (kind === 'drag') {
      const w = l.sub === 'rope' ? 0.9 : 1.25, lat = l.sign * (l.sub === 'rope' ? l.side - 0.45 : l.side);
      ribbon(trackParts, l, lat, w, 0.012, 0, l.len, 3);          // R8b: 1.2 cm (polygon offset keeps it on top): skis no longer sink into it
    }
    if (kind === 'carpet') ribbon(beltParts, l, 0, 0.9, 0.18, 0, l.len, 1.5);
    if (l.tunnel) tunnelTube(tunnelParts, l);
  }
  function ribbon(out, l, lat, w, lift, s0, s1, step) {
    const n = Math.max(2, Math.ceil((s1 - s0) / step));
    const pos = [], uv = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n;
      l.at(s, q2);
      const rx = -q2.dz, rz = q2.dx;
      for (const side of [-1, 1]) {
        const x = q2.x + rx * (lat + side * w / 2), z = q2.z + rz * (lat + side * w / 2);
        pos.push(x, height(x, z) + lift, z); uv.push(side < 0 ? 0 : 1, s / 2);
      }
    }
    const idx = [];
    for (let k = 0; k < n; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    out.push({ pos, uv, idx });
  }
  function tunnelTube(out, l) {
    // rings every 5 m between where the rail is 1 m under the ground at both ends; the vault lit by lamps every 25 m (vertex colours)
    let s0 = null, s1 = null;
    for (let s = 0; s <= l.len; s += 2) { if (l.ground(s) - l.cableY(s) > 1) { if (s0 === null) s0 = s; s1 = s; } }
    if (s0 === null) return;
    // R8: the tube starts at the portals (lift-site.js) and its vault never rises out of the hill (it showed as a black wedge on the snow)
    if (l.site && l.site.portals.length === 2) { s0 = Math.max(s0, l.site.portals[0].s); s1 = Math.min(s1, l.site.portals[1].s); }
    if (s1 <= s0) return;
    const bL = -l.back - 1.32 - 1.0, bR = l.side + 1.32 + 1.0;
    const prof = [[bL, -0.5], [bL, 3.4], [bL * 0.7, 5.0], [0, 5.7], [bR * 0.7, 5.0], [bR, 3.4], [bR, -0.5], [bL, -0.5]];
    const n = Math.ceil((s1 - s0) / 5);
    const pos = [], col = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n;
      l.at(s, q2);
      const y = l.cableY(s), rx = -q2.dz, rz = q2.dx;
      const lamp = Math.exp(-Math.pow(((s % 25) + 25) % 25 > 12.5 ? 25 - (((s % 25) + 25) % 25) : ((s % 25) + 25) % 25, 2) / 40);
      for (let i = 0; i < prof.length; i++) {
        const [b, h] = prof[i];
        const px = q2.x + rx * b, pz = q2.z + rz * b;
        pos.push(px, h > 0 ? Math.max(y + Math.min(h, 2.6), Math.min(y + h, height(px, pz) - 0.25)) : y + h, pz);
        const shade = (i === 0 || i === prof.length - 1 || i === prof.length - 2 ? 0.28 : 0.5) * (0.35 + 0.65 * lamp);
        col.push(0.52 * shade + 0.04, 0.5 * shade + 0.04, 0.47 * shade + 0.04);
      }
    }
    const m = prof.length;
    for (let k = 0; k < n; k++) for (let i = 0; i + 1 < m; i++) { const a = k * m + i; idx.push(a, a + m, a + 1, a + 1, a + m, a + m + 1); }
    out.push({ pos, col, idx });
    // the lamps: small bright boxes under the vault
    for (let s = s0 + 12.5; s < s1; s += 25) {
      l.at(s, q2);
      const y = l.cableY(s);
      tunnelLamps.push([new THREE.BoxGeometry(1.4, 0.12, 0.5), 0xfff2c6, rot(q2.dx, q2.dz).setPosition(q2.x, y + 5.55, q2.z)]);
    }
  }
  const meshFromRibbons = (list, mat) => {
    if (!list.length) return null;
    const pos = [], uv = [], col = [], idx = [];
    let base = 0;
    for (const r of list) {
      pos.push(...r.pos); if (r.uv) uv.push(...r.uv); if (r.col) col.push(...r.col);
      for (const i of r.idx) idx.push(i + base);
      base += r.pos.length / 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    disposables.push(g);
    group.add(m);
    return m;
  };
  // the stations and pylons in 2.5 km chunks (one mesh each), shown within the lift radius
  const CHUNK = 2500;
  const chunks = [];
  if (parts.length) {
    const byCell = new Map();
    for (const part of parts) {
      const e = part[2].elements, k = Math.floor(e[12] / CHUNK) + ',' + Math.floor(e[14] / CHUNK);
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(part);
    }
    for (const [k, list] of byCell) {
      const [i, j] = k.split(',').map(Number);
      const geo = gpuOnly(mergeLit(list));                           // R8f: drawn only (ground-check: keep=1)
      const st = new THREE.Mesh(geo, smat);
      st.castShadow = true; st.receiveShadow = true; st.name = chunks.length ? 'ski-lift-stations-' + k : 'ski-lift-stations';
      group.add(st);
      disposables.push(geo);
      chunks.push({ mesh: st, cx: (i + 0.5) * CHUNK, cz: (j + 0.5) * CHUNK });
    }
  }
  // R8d: the fine parts per FINE.cell m cell, shown within FINE.share x the lift radius
  const fineCells = [];
  if (fine.length) {
    const byCell = new Map();
    for (const part of fine) {
      const e = part[2].elements, k = Math.floor(e[12] / FINE.cell) + ',' + Math.floor(e[14] / FINE.cell);
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(part);
    }
    for (const [k, list] of byCell) {
      const [i, j] = k.split(',').map(Number);
      const geo = gpuOnly(mergeLit(list));                           // R8f: drawn only (ground-check: keep=1)
      const m = new THREE.Mesh(geo, smat);
      m.castShadow = true; m.receiveShadow = true; m.name = 'ski-lift-fine-' + k; m.visible = false;
      group.add(m);
      disposables.push(geo);
      fineCells.push({ mesh: m, x0: i * FINE.cell, z0: j * FINE.cell });
    }
  }
  // station look: the near detail per NEAR_DETAIL.cell m cell (no shadows: frames, lamps and trims too small to matter)
  const nearCells = [];
  if (nearParts.length) {
    const byCell = new Map();
    for (const part of nearParts) {
      const e = part[2].elements, k = Math.floor(e[12] / NEAR_DETAIL.cell) + ',' + Math.floor(e[14] / NEAR_DETAIL.cell);
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(part);
    }
    for (const [k, list] of byCell) {
      const [i, j] = k.split(',').map(Number);
      const geo = gpuOnly(mergeLit(list));
      const m = new THREE.Mesh(geo, smat);
      m.castShadow = false; m.receiveShadow = true; m.name = 'ski-lift-near-' + k; m.visible = false;
      group.add(m);
      disposables.push(geo);
      nearCells.push({ mesh: m, x0: i * NEAR_DETAIL.cell, z0: j * NEAR_DETAIL.cell });
    }
  }
  const trackMat = new THREE.MeshLambertMaterial({ color: 0xd3d9e2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(trackMat);
  // R8d (Niddreg budget: all of 3 Vallées' drag tracks were one 17k mesh drawn everywhere): one track mesh per CHUNK cell (by the
  // ribbon's middle), shown when the camera is within TRACK_R m of its box
  const trackCells = [];
  {
    const byCell = new Map();
    for (const r of trackParts) {
      const n = r.pos.length / 3, mx = r.pos[3 * (n >> 1)], mz = r.pos[3 * (n >> 1) + 2];
      const k = Math.floor(mx / CHUNK) + ',' + Math.floor(mz / CHUNK);
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(r);
    }
    for (const [k, list] of byCell) {
      const m = meshFromRibbons(list, trackMat);
      m.name = trackCells.length ? 'ski-lift-tracks-' + k : 'ski-lift-tracks'; m.renderOrder = 1;
      m.geometry.computeBoundingBox();
      trackCells.push({ mesh: m, box: m.geometry.boundingBox });
    }
  }
  // R8b: the worn track is a decal on the snow: drawn after the ground, never writing depth, so skis standing in it are never hidden
  // (the lift-path ground it follows differs from the drawn snow by a few cm)
  trackMat.depthWrite = false;
  // the belt: a dark rubber strip with cleats; its texture runs up the belt
  const beltTex = (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#2a2d33'; x.fillRect(0, 0, 8, 32); x.fillStyle = '#4a4f58'; for (let i = 0; i < 32; i += 8) x.fillRect(0, i, 8, 2);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter;
    return t;
  })();
  const beltMat = new THREE.MeshLambertMaterial({ map: beltTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(beltTex, beltMat);
  const beltMesh = meshFromRibbons(beltParts, beltMat);
  if (beltMesh) beltMesh.name = 'ski-lift-belts';
  // after launch: the chair gates, one instanced mesh; closed unless a ride opens one (setGate)
  const leafMesh = leaves.length ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xf2b21c }), leaves.length) : null;
  const leafOf = new Map();             // lift index -> instance indices
  const leafM = new THREE.Matrix4(), leafS = new THREE.Vector3(), leafQ = new THREE.Quaternion(), leafP = new THREE.Vector3(), leafY = new THREE.Vector3(0, 1, 0);
  function placeLeaf(i, open) {
    const { f, p, g0 } = leaves[i], G = p.gateLeaf, len = p.a1 - p.a0, th = Math.max(0, Math.min(1, open)) * Math.PI / 2;
    const da = -G.side * Math.cos(th), db = -Math.sin(th);                         // swings in, towards the lane (-b)
    const c = f.toWorld(G.hinge + da * len / 2, (p.b0 + p.b1) / 2 + db * len / 2, {});
    const vx = f.fx * da + f.rx * db, vz = f.fz * da + f.rz * db;
    leafQ.setFromAxisAngle(leafY, -Math.atan2(vz, vx));
    leafP.set(c.x, g0 + (p.y0 + p.y1) / 2, c.z); leafS.set(len, p.y1 - p.y0, p.b1 - p.b0);
    leafMesh.setMatrixAt(i, leafM.compose(leafP, leafQ, leafS));
  }
  if (leafMesh) {
    leaves.forEach((lf, i) => { placeLeaf(i, 0); if (!leafOf.has(lf.l.index)) leafOf.set(lf.l.index, []); leafOf.get(lf.l.index).push(i); });
    leafMesh.instanceMatrix.needsUpdate = true;
    leafMesh.name = 'ski-lift-gates'; leafMesh.frustumCulled = false; leafMesh.castShadow = false;
    group.add(leafMesh); disposables.push(leafMesh.geometry, leafMesh.material);
  }
  const gateOpen = new Map();
  /** After launch: open (0..1) the boarding gate of chair lift `index` (the ride's timeline; 0 = closed). */
  function setGate(index, open) {
    const ids = leafOf.get(index);
    if (!ids || (gateOpen.get(index) || 0) === open) return;
    gateOpen.set(index, open);
    for (const i of ids) placeLeaf(i, open);
    leafMesh.instanceMatrix.needsUpdate = true;
  }
  const tunnelMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  disposables.push(tunnelMat);
  const tunnelMesh = meshFromRibbons(tunnelParts, tunnelMat);
  if (tunnelMesh) { tunnelMesh.name = 'ski-lift-tunnels'; tunnelMesh.receiveShadow = false; }
  if (tunnelLamps.length) {
    const lg = mergeParts(tunnelLamps), lm = new THREE.MeshBasicMaterial({ vertexColors: true });
    const lamps = new THREE.Mesh(lg, lm); lamps.name = 'ski-lift-tunnel-lamps';
    group.add(lamps); disposables.push(lg, lm);
  }
  const cableMat = new THREE.LineBasicMaterial({ color: 0x23262c });
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cg, cableMat);
  cables.frustumCulled = false;
  group.add(cables);
  disposables.push(cg, cableMat);
  // R8f (memory): the source parts (thousands of BoxGeometry / CylinderGeometry, ribbons, rope points) are merged now; the closures
  // below keep this function's context alive for the page's life, so the lists are emptied (else every part stays in memory)
  parts.length = 0; fine.length = 0; nearParts.length = 0; trackParts.length = 0; for (const lf of leaves) { lf.l = { index: lf.l.index }; } beltParts.length = 0; tunnelParts.length = 0; tunnelLamps.length = 0; cablePts.length = 0;

  // ---------------- carriers: instanced pools per model (near + far detail) ----------------
  const pools = new Map();               // key -> { near, far, glass, count }
  const glassMat = new THREE.MeshLambertMaterial({ color: GLASS.color, transparent: true, opacity: GLASS.opacity, depthWrite: false, side: THREE.DoubleSide });   // R8c
  disposables.push(glassMat);
  const lookOf = (l) => (l.kind === 'chair' && l.site && l.site.chair ? l.site.chair.look : null);
  // (chairs round: a detachable and a fixed-grip chair of the same size are two models: carriage + pads vs clamp + slats)
  const variantOf = (l) => (l.kind === 'chair' ? `chair:${l.seats}:${lookOf(l) && !lookOf(l).detach ? 'f' : 'd'}` : l.kind === 'drag' || l.sub === 'funitel' ? `${l.kind}:${l.sub}` : l.kind);      // R8e: funitel cabins
  const need = new Map();
  for (const l of lifts) {
    if (l.kind === 'carpet' || (l.kind === 'drag' && l.sub === 'rope')) continue;
    const n = l.shuttle ? 2 : Math.ceil(l.loopLen / l.spec.gap) + 1;
    need.set(variantOf(l), (need.get(variantOf(l)) || 0) + n);
  }
  for (const [key, n] of need) {
    const [kind, v, grip] = key.split(':');
    const opts = { seats: kind === 'chair' ? Number(v) : 4, sub: kind === 'drag' || v === 'funitel' ? v : '', barUp: true, fixed: grip === 'f' };
    const cap = Math.min(n, 2400);
    const mk = (geo, mat, shadow) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.visible = false; group.add(m); disposables.push(geo); return m; };
    const near = carrierGeometry(kind, { ...opts, lod: 'near' });
    const pool = { near: mk(near.frame, vmat, true), glass: near.glass ? mk(near.glass, glassMat, false) : null, far: null, n: 0, nf: 0, cap };
    if (pool.glass) pool.glass.renderOrder = 4;
    if (kind !== 'drag') pool.far = mk(carrierGeometry(kind, { ...opts, lod: 'far' }).frame, vmat, true);
    pools.set(key, pool);
  }
  // chairs round: the bubbles of the bubble chairs, ONE instanced tinted hood for every bubble lift (scaled to the chair's width, the
  // lift's tint as instance colour), within BUBBLE.radius m; down over the riders on the line, raised in the stations
  let bubbles = null;
  {
    let n = 0;
    for (const l of lifts) if (lookOf(l) && lookOf(l).bubble) n += Math.ceil(l.loopLen / l.spec.gap) + 1;
    if (n) {
      const geo = bubbleGeometry(), mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: BUBBLE.opacity, depthWrite: false, side: THREE.DoubleSide });
      const cap = Math.min(n, BUBBLE.max);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.visible = false; mesh.renderOrder = 4; mesh.name = 'ski-lift-bubbles';
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      group.add(mesh); disposables.push(geo, mat);
      bubbles = { mesh, cap, n: 0, tint: new Map() };
      const white = new THREE.Color(1, 1, 1);
      for (const l of lifts) if (lookOf(l) && lookOf(l).bubble) bubbles.tint.set(l.index, new THREE.Color(BUBBLE.tints[lookOf(l).band % BUBBLE.tints.length]).lerp(white, 0.25));
    }
  }
  const bm4 = new THREE.Matrix4(), bPiv = new THREE.Matrix4(), bRot = new THREE.Matrix4(), bBack = new THREE.Matrix4(), bScale = new THREE.Matrix4();
  function putBubble(l, w, m) {
    const B = bubbles;
    if (B.n >= B.cap) return;
    const ds = w.turn ? 0 : Math.min(w.s, l.len - w.s);
    const k = 1 - Math.max(0, Math.min(1, (ds - BUBBLE.open[0]) / (BUBBLE.open[1] - BUBBLE.open[0])));      // 1 raised .. 0 down
    const kk = k * k * (3 - 2 * k);
    bPiv.makeTranslation(BUBBLE.pivot[0], BUBBLE.pivot[1], 0); bRot.makeRotationZ(BUBBLE.lift * kk); bBack.makeTranslation(-BUBBLE.pivot[0], -BUBBLE.pivot[1], 0);
    bScale.makeScale(1, 1, chairWidth(l.seats) / 2 + 0.16);
    bm4.copy(m).multiply(bPiv).multiply(bRot).multiply(bBack).multiply(bScale);
    B.mesh.setMatrixAt(B.n, bm4); B.mesh.setColorAt(B.n, B.tint.get(l.index)); B.n++;
  }
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);
  const eul = new THREE.Euler(0, 0, 0, 'YZX');
  const w0 = {};
  let lastT = 0;
  const SWING = { chair: 0.03, gondola: 0.022, cable: 0.006, drag: 0.05, train: 0 };
  // the other skiers (npc-view.js): every carrier on its way up is reported with its id (npc.js carrierId: the same chair keeps its
  // riders from the bottom to the top) and its matrix; the player's own carrier never (he rides it alone)
  let riderSink = null;
  function put(pool, l, w, k, t, camX, camZ, id = null) {
    const dc = Math.hypot(w.x - camX, w.z - camZ);
    if (dc > FAR_R[l.kind]) return;
    const far = pool.far && dc > NEAR_R;
    const roll = w.turn ? 0 : SWING[l.kind] * Math.sin(t * 1.3 + k * 0.77 + l.index);
    const pitch = l.kind === 'train' ? Math.atan(l.slope(w.s)) * (w.up ? 1 : -1) : 0;
    eul.set(roll, -w.heading, pitch); q4.setFromEuler(eul);
    m4.compose(v3.set(w.x, w.y, w.z), q4, s3);
    if (far) { if (pool.nf < pool.cap) pool.far.setMatrixAt(pool.nf++, m4); }
    else if (pool.n < pool.cap) { pool.near.setMatrixAt(pool.n, m4); if (pool.glass) pool.glass.setMatrixAt(pool.n, m4); pool.n++; }
    if (bubbles && dc < BUBBLE.radius && bubbles.tint.has(l.index)) putBubble(l, w, m4);
    // (ride down: a lift that goes down carries a few others down too: their own ids, so nobody rides the loop round and round)
    if (riderSink && id !== null && !w.turn && (w.up || l.shuttle)) riderSink(l, m4, id, dc, w);
    else if (riderSink && id !== null && !w.turn && l.site && l.site.down) riderSink(l, m4, DOWN_RIDERS + id, dc, w, DOWN_SHARE);
  }
  /** Where a jig-back pair is at time t (s along the line of the cabin on the up track; the other is at len - s). */
  function shuttleS(l, t) {
    const [d0, d1] = l.docks;
    const T = (d1 - d0) / (l.spec.speed * SHUTTLE_FACTOR), cycle = 2 * (T + DWELL);
    const u = (((t + l.offset) % cycle) + cycle) % cycle;
    if (u < DWELL) return { s: d0, up: true };
    if (u < DWELL + T) return { s: d0 + (u - DWELL) * l.spec.speed * SHUTTLE_FACTOR, up: true };
    if (u < 2 * DWELL + T) return { s: d1, up: false };
    return { s: d1 - (u - 2 * DWELL - T) * l.spec.speed * SHUTTLE_FACTOR, up: false };
  }

  // ---------------- R8: the name signs ----------------
  const signs = (() => {
    if (!signSpots.length || typeof document === 'undefined') return null;
    const rows = Math.ceil(SIGN.slots / SIGN.cols);
    const canvas = document.createElement('canvas');
    canvas.width = SIGN.slotW * SIGN.cols; canvas.height = SIGN.slotH * rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;      // no mip chain to rebuild per upload
    const pos = new Float32Array(SIGN.slots * 4 * 3), uv = new Float32Array(SIGN.slots * 4 * 2), idx = [];
    for (let i = 0; i < SIGN.slots; i++) { const a = i * 4; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }      // front faces the reader
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xd8dade, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ski-lift-signs';
    mesh.frustumCulled = false;
    group.add(mesh);
    disposables.push(geo, mat, tex);
    let shown = [], wait = 0;
    /** Paints one slot: the lift's name, white on the dark board, a thin red line under it. */
    function paint(slot, text, aspect) {
      const x0 = (slot % SIGN.cols) * SIGN.slotW, y0 = Math.floor(slot / SIGN.cols) * SIGN.slotH;
      const w = Math.min(SIGN.slotW, Math.round(SIGN.slotH * aspect));
      ctx.clearRect(x0, y0, SIGN.slotW, SIGN.slotH);
      ctx.fillStyle = '#23272e'; ctx.fillRect(x0, y0, w, SIGN.slotH);
      ctx.fillStyle = '#c8332a'; ctx.fillRect(x0 + 6, y0 + SIGN.slotH - 9, w - 12, 3);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let size = 38;
      ctx.font = `700 ${size}px system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
      while (size > 16 && ctx.measureText(text).width > w - 24) { size -= 2; ctx.font = `700 ${size}px system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`; }
      ctx.fillText(text, x0 + w / 2, y0 + SIGN.slotH / 2 - 3);
      return w / SIGN.slotW;
    }
    function place(slot, sp, uMax) {
      const ox = sp.nx * 0.02, oz = sp.nz * 0.02;
      const tx = sp.nz, tz = -sp.nx;                                     // along the board, left to right seen from the front
      const hw = sp.w / 2, hh = sp.h / 2;
      const P = [[-hw, hh], [hw, hh], [-hw, -hh], [hw, -hh]];
      for (let k = 0; k < 4; k++) {
        const [a, b] = P[k];
        pos.set([sp.x + ox + tx * a, sp.y + b, sp.z + oz + tz * a], (slot * 4 + k) * 3);
      }
      const u0 = (slot % SIGN.cols) / SIGN.cols, u1 = u0 + uMax / SIGN.cols;
      const v1 = 1 - Math.floor(slot / SIGN.cols) / rows, v0 = v1 - 1 / rows;
      uv.set([u0, v1, u1, v1, u0, v0, u1, v0], slot * 8);
    }
    return {
      mesh,
      update(dt, camX, camZ) {
        wait -= dt;
        if (wait > 0) return;
        wait = SIGN.every;
        const near = [];
        for (const sp of signSpots) { const d = Math.hypot(sp.x - camX, sp.z - camZ); if (d < SIGN.radius) near.push([d, sp]); }
        near.sort((a, b) => a[0] - b[0]);
        const want = near.slice(0, SIGN.slots).map((n) => n[1]);
        if (want.length === shown.length && want.every((sp, i) => sp === shown[i])) return;
        // keep the slots of signs that stay, paint the new ones into the freed slots
        const slotOf = new Map(shown.map((sp) => [sp, sp.slot]));
        const next = new Array(want.length).fill(null), free = [];
        for (let i = 0; i < SIGN.slots; i++) free.push(i);
        const used = new Set();
        for (const sp of want) if (slotOf.has(sp) && slotOf.get(sp) < SIGN.slots) used.add(slotOf.get(sp));
        const freeSlots = free.filter((i) => !used.has(i));
        let painted = false;
        want.forEach((sp, i) => {
          let slot = slotOf.get(sp);
          if (slot === undefined) { slot = freeSlots.shift(); sp.uMax = paint(slot, sp.text, sp.w / sp.h); painted = true; }
          next[i] = sp; sp.slot = slot;
        });
        // the quads in slot order (slot k of the atlas = quad k)
        pos.fill(0);
        let maxSlot = -1;
        for (const sp of next) { place(sp.slot, sp, sp.uMax); maxSlot = Math.max(maxSlot, sp.slot); }
        shown = next.map((sp) => sp);
        const ordered = new Array(SIGN.slots).fill(null);
        for (const sp of shown) ordered[sp.slot] = sp;
        shown = ordered.filter(Boolean);
        geo.setDrawRange(0, (maxSlot + 1) * 6);
        geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true;
        geo.computeBoundingSphere();
        if (painted) tex.needsUpdate = true;
        mesh.visible = maxSlot >= 0;
      },
      get count() { return shown.length; },
      spots: signSpots,
    };
  })();

  /** Station look: the hall slow-down map of a gondola loop (HALL_SLOW), built the first time it is drawn; null = none. */
  function hallWarp(l) {
    if (l.warp !== undefined) return l.warp;
    l.warp = null;
    const C = stationCrawl(l.site);               // (lift-site.js: the same curve the player's own ride follows)
    if (!C) return null;
    const { L, n, dist } = C;
    // time (in line metres) to each sample
    const tau = new Float64Array(n + 1);
    for (let k = 1; k <= n; k++) tau[k] = tau[k - 1] + (L / n) * 0.5 * (1 / C.k(dist[k - 1]) + 1 / C.k(dist[k]));
    // the inverse: X at equal steps of time (u / L of the loop = the same share of the time round it)
    const inv = new Float32Array(n + 1), T = tau[n];
    for (let j = 0, k = 0; j <= n; j++) {
      const target = (j / n) * T;
      while (k < n && tau[k + 1] < target) k++;
      const f = k < n ? (target - tau[k]) / Math.max(1e-9, tau[k + 1] - tau[k]) : 0;
      inv[j] = ((k + Math.min(1, f)) / n) * L;
    }
    const uLoad = Math.min(l.site.boardS, l.len * 0.2), kl = (uLoad / L) * n, k0 = Math.floor(kl);
    l.warp = { inv, n, L, T, uLoad, tauLoad: tau[k0] + (tau[Math.min(n, k0 + 1)] - tau[k0]) * (kl - k0), w: 1 };
    return l.warp;
  }
  /** The drawn loop position of the pool's carrier of parameter u (the hall slow-down eased by its weight). */
  function warpU(l, u) {
    const W = l.warp;
    if (!W || W.w <= 0) return u;
    const uu = ((u % W.L) + W.L) % W.L;
    const tq = (((W.tauLoad + (uu - W.uLoad) * W.T / W.L) % W.T) + W.T) % W.T;
    const x = (tq / W.T) * W.n, k = Math.min(W.n - 1, Math.floor(x)), f = x - k;
    let X = W.inv[k] + (W.inv[k + 1] - W.inv[k]) * f;
    if (X - uu > W.L / 2) X -= W.L; else if (uu - X > W.L / 2) X += W.L;
    return uu + (X - uu) * W.w;
  }

  function update(t, camX, camZ, radius) {
    if (signs) signs.update(lastT === null ? 0.6 : Math.max(0, t - lastT), camX, camZ);
    const dtW = Math.min(0.1, Math.max(0, t - (lastT || t)));
    // R8e: a jig-back pair waits at its stations while the skier stands in the boarding zone and the up-track cabin is docked below
    const dtU = Math.max(0, t - (lastT || t));
    for (const l of lifts) if (l.shuttle && l.rideU === null && l.holdUntil > t && shuttlePhase(l, t) < DWELL) l.offset -= dtU;
    lastT = t;
    for (const c of chunks) c.mesh.visible = Math.hypot(c.cx - camX, c.cz - camZ) - CHUNK * 0.71 < radius;
    for (const c of trackCells) {
      const b = c.box, dx = Math.max(b.min.x - camX, 0, camX - b.max.x), dz = Math.max(b.min.z - camZ, 0, camZ - b.max.z);
      c.mesh.visible = Math.hypot(dx, dz) < Math.min(TRACK_R, radius);
    }
    const fineR = Math.min(FINE.max, radius * FINE.share);
    for (const c of fineCells) {
      const dx = Math.max(c.x0 - camX, 0, camX - c.x0 - FINE.cell), dz = Math.max(c.z0 - camZ, 0, camZ - c.z0 - FINE.cell);
      c.mesh.visible = Math.hypot(dx, dz) < fineR;
    }
    for (const c of nearCells) {
      const dx = Math.max(c.x0 - camX, 0, camX - c.x0 - NEAR_DETAIL.cell), dz = Math.max(c.z0 - camZ, 0, camZ - c.z0 - NEAR_DETAIL.cell);
      c.mesh.visible = Math.hypot(dx, dz) < Math.min(NEAR_DETAIL.radius, radius);
    }
    for (const p of pools.values()) { p.n = 0; p.nf = 0; }
    if (bubbles) bubbles.n = 0;
    beltTex.offset.y = -(t * 1.4) / 2;
    for (const l of lifts) {
      if (l.kind === 'carpet' || (l.kind === 'drag' && l.sub === 'rope')) continue;
      const d = Math.hypot(l.cx - camX, l.cz - camZ) - l.radius;
      if (d > radius) continue;
      const pool = pools.get(variantOf(l));
      if (!pool) continue;
      if (l.shuttle) {
        const [d0, d1] = l.docks;
        if (l.rideU !== null && l.rideDown) put(pool, l, l.shuttleAt(d0 + Math.min(d1 - d0, l.rideU), 1, true, w0), 0, t, camX, camZ, 0);      // ride down: the counter cabin goes up
        else if (l.rideU !== null) put(pool, l, l.shuttleAt(d1 - Math.min(d1 - d0, l.rideU), -1, false, w0), 1, t, camX, camZ, 1);
        else {
          const a = shuttleS(l, t);
          put(pool, l, l.shuttleAt(a.s, 1, a.up, w0), 0, t, camX, camZ, 0);
          put(pool, l, l.shuttleAt(d0 + d1 - a.s, -1, !a.up, w0), 1, t, camX, camZ, 1);
        }
        continue;
      }
      const gap = l.spec.gap;
      const W = hallWarp(l);
      if (W) W.w = Math.max(0, Math.min(1, W.w + (l.rideU === null ? 1 : -1) * dtW / HALL_SLOW.blend));
      const phase = l.rideU !== null ? ((l.rideU % gap) + gap) % gap : (((t * l.spec.speed + l.offset) % gap) + gap) % gap;
      const A = l.rideU !== null ? l.rideU + (l.heldShift || 0) : t * l.spec.speed + l.offset;          // (npc.js carrierId)
      let k = 0;
      for (let u = phase; u < l.loopLen - 1e-6; u += gap, k++) {
        if (l.rideU !== null && Math.abs(u - (((l.rideU % l.loopLen) + l.loopLen) % l.loopLen)) < 1e-3) continue;        // the player's own
        put(pool, l, l.loopAt(W ? warpU(l, u) : u, w0), k, t, camX, camZ, carrierId(u, A, gap));
      }
    }
    for (const p of pools.values()) {
      p.near.count = p.n; p.near.visible = p.n > 0; p.near.instanceMatrix.needsUpdate = true;
      if (p.glass) { p.glass.count = p.n; p.glass.visible = p.n > 0; p.glass.instanceMatrix.needsUpdate = true; }
      if (p.far) { p.far.count = p.nf; p.far.visible = p.nf > 0; p.far.instanceMatrix.needsUpdate = true; }
    }
    if (bubbles) {
      const b = bubbles.mesh;
      b.count = bubbles.n; b.visible = bubbles.n > 0;
      if (bubbles.n) { b.instanceMatrix.needsUpdate = true; b.instanceColor.needsUpdate = true; }
    }
  }
  /** Hold one carrier of lift `index` at the loop parameter u (the player's own), or let it go again (null). */
  function setRide(index, u, down = false) {
    const l = byIndex.get(index);
    if (!l) return;
    l.rideDown = !!down && u !== null && u !== undefined;           // ride down (liftride.js createDescent): a jig-back pair mirrored
    if (u === null || u === undefined) {
      if (l.rideU !== null) {
        if (l.shuttle) {             // the pair goes on from where it stands (at a station: the dwell there)
          const T = (l.docks[1] - l.docks[0]) / (l.spec.speed * SHUTTLE_FACTOR);
          const top = l.rideU > (l.docks[1] - l.docks[0]) / 2;
          l.offset = (top ? DWELL + T + 0.5 : 0.5) - lastT;
        } else { l.offset = l.rideU + (l.heldShift || 0) - lastT * l.spec.speed; }        // (the same as before modulo the gap; keeps the
      }                                                                                    // carriers' ids for the riders, npc.js)
      l.rideU = null;
    } else {
      // the first held step: the lattice shift that keeps every carrier's id (npc.js carrierId) while the player's carrier leads
      if (l.rideU === null && !l.shuttle && l.spec.gap > 0) { const gap = l.spec.gap; l.heldShift = gap * Math.round((lastT * l.spec.speed + l.offset - u) / gap); }
      l.rideU = u;
    }
  }
  /** R8e: the time into a jig-back pair's cycle (0 .. DWELL: the up-track cabin docked at the bottom) and the cycle length. */
  function shuttlePhase(l, t) {
    const T = (l.docks[1] - l.docks[0]) / (l.spec.speed * SHUTTLE_FACTOR), cycle = 2 * (T + DWELL);
    return (((t + l.offset) % cycle) + cycle) % cycle;
  }
  /** R8e: boarding a jig-back cabin: { wait (s until the up-track cabin is docked at the bottom, 0 = it is), at(dt) = { s, up } of that
   *  cabin dt s from now (docked once there) }. The schedule is the scenery's, so the cabin you wait for is the one coming down. */
  function shuttleBoard(index) {
    const l = byIndex.get(index);
    if (!l || !l.shuttle) return null;
    const t0 = lastT || 0, T = (l.docks[1] - l.docks[0]) / (l.spec.speed * SHUTTLE_FACTOR), cycle = 2 * (T + DWELL);
    const u = shuttlePhase(l, t0), wait = u < DWELL ? 0 : cycle - u;
    return { wait, at: (dt) => (dt >= wait ? { s: l.docks[0], up: true } : shuttleS(l, t0 + dt)) };
  }
  /** R8e: the skier waits in lift `index`'s boarding zone (called every frame): a docked up-track cabin stays docked. */
  function holdShuttle(index) { const l = byIndex.get(index); if (l && l.shuttle) l.holdUntil = (lastT || 0) + 0.5; }
  /** R8e: a fast travel / the spawn put him at lift `index` (behind the fade): its up-track cabin is docked at the bottom, just arrived. */
  function dockShuttle(index) { const l = byIndex.get(index); if (l && l.shuttle && l.rideU === null) l.offset = 0.5 - (lastT || 0); }
  /** The loop parameter of the next carrier that will reach uTarget (the loading point) at least `minAhead` m away. */
  function nextCarrier(index, uTarget, minAhead = 0) {
    const l = byIndex.get(index);
    if (!l || l.shuttle || !(l.spec.gap > 0)) return { u: uTarget - minAhead, d: minAhead };       // (a rope tow has no carriers)
    const gap = l.spec.gap;
    const phase = l.rideU !== null ? l.rideU : lastT * l.spec.speed + l.offset;
    let d = (((uTarget - phase) % gap) + gap) % gap;
    while (d < minAhead) d += gap;
    return { u: uTarget - d, d };
  }
  /** Metres from (x, z) to the nearest lift line (stations included): the lift hum fades with it. */
  function nearest(x, z) {
    let best = Infinity;
    for (const l of lifts) {
      if (Math.hypot(l.cx - x, l.cz - z) - l.radius > best) continue;
      const p = l.src.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z) + (t <= 0 || t >= 1 ? 0 : 25);      // the stations hum more than the line
        if (d < best) best = d;
      }
    }
    return best;
  }
  /** Metres from (x, z) to the nearest lift station (either end of a lift line): the station machinery, crowd and clacks fade with it. */
  function nearestStation(x, z) {
    let best = Infinity;
    for (const l of lifts) {
      const p = l.src.pts, n = p.length;
      if (n < 4 || Math.hypot(l.cx - x, l.cz - z) - l.radius > best) continue;
      best = Math.min(best, Math.hypot(p[0] - x, p[1] - z), Math.hypot(p[n - 2] - x, p[n - 1] - z));
    }
    return best;
  }
  function dispose() {
    scene.remove(group);
    for (const d of disposables) { try { d.dispose(); } catch (error) { /* already gone */ } }
  }
  return {
    group, update, nearest, nearestStation, setRide, setGate, nextCarrier, shuttleBoard, holdShuttle, dockShuttle, dispose, count: lifts.length,
    /** The other skiers: sink(l, matrix, carrier id, distance to the camera, loop point) for each carrier on its way up (null = off). */
    setRiderSink(fn) { riderSink = fn || null; },
    pathOf: (index) => (byIndex.get(index) ? byIndex.get(index).path : null),
    siteOf: (index) => (byIndex.get(index) ? byIndex.get(index).site : null),
    /** The loop parameter of the carrier held for the player on lift `index` (null: none). */
    heldOf: (index) => (byIndex.get(index) ? byIndex.get(index).rideU : null),
    /** Lift lines (lift-queue.js createQueueSim): the loop's lattice origin A now (carrier n is at u = A + n x gap; npc.js carrierId),
     *  with the player's held carrier leading; null for a jig-back lift. */
    latticeA(index) { const l = byIndex.get(index); if (!l || l.shuttle || !(l.spec.gap > 0)) return null; return l.rideU !== null ? l.rideU + (l.heldShift || 0) : lastT * l.spec.speed + l.offset; },
    /** Lift lines: a jig-back pair's clock { c (cycle), u (s into it: < dwell = the up cabin docked at the bottom), dwell }, or null
     *  (no jig-back, or the player rides it). */
    shuttleClock(index) {
      const l = byIndex.get(index);
      if (!l || !l.shuttle || l.rideU !== null) return null;            // (the player rides it: the line waits)
      const T = (l.docks[1] - l.docks[0]) / (l.spec.speed * SHUTTLE_FACTOR), cycle = 2 * (T + DWELL), v = (lastT || 0) + l.offset;
      return { c: Math.floor(v / cycle), u: ((v % cycle) + cycle) % cycle, dwell: DWELL };
    },
    world,
    /** R8 (tests / shots): the name signs shown now and every sign spot. */
    get signs() { return signs ? { shown: signs.count, spots: signs.spots.length } : { shown: 0, spots: signSpots.length }; },
    /** Round 7-B (tests): the instanced carriers drawn now, per pool key. */
    poolCounts: () => Object.fromEntries([...pools].map(([k, p]) => [k, p.n + p.nf])),
  };
}
