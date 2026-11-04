/* The Luxtram of Lux Drive on screen: the track (a slab or a grass bed with two rails, embedded in the street where the tram
 * shares it), the catenary (poles and the contact wire), the platforms with their shelters, and the vehicles.
 *
 * The rails are built from the SAME centre lines the vehicles run on (tram-network.js), so a tram is on its rails exactly.
 * The track is built in chunks when the car comes near and only drawn close by (a rail is 7 cm wide: a mile away it is not
 * there); building a chunk reads the ground, which is not free, so the work is spread over frames with a time budget.
 * The vehicles are three instanced meshes (the end sections, the sections with a pantograph, the plain ones): all the
 * trams of the line are three draw calls. */
import { TRAM } from './config.js';
import { DECK } from './decks.js';
import { sampleWorldMap } from './world-map.js';
import { PartBuilder } from './part-builder.js';
import { createPartMaterial } from './part-material.js';
import { buildMiddleSection, buildEndSection, buildPole, buildShelter } from './tram-parts.js';

const THREE = window.THREE;
const BUILD_RADIUS = 760;           // m: a chunk is built when the camera is this close
const SHOW_RADIUS = 700;            // m: and drawn while it is this close
const BUDGET_MS = 3.0;              // ms of building per frame
const SECTION_STEP = 2;             // m between the cross sections of the track mesh
const WIRE_STEP = 4;                // m between the points of the contact wire
const HALF_BED = 1.45;              // m: half the width of the slab / grass bed
const GROOVE = 0.16;                // m: the dark groove around a rail
const BED_LIFT = 0.03;              // m: the bed over the ground (the ground is a 1 m lattice, the bed a 2 m ribbon)
const COL = {
  slab: [0.60, 0.61, 0.60], slabDark: [0.50, 0.51, 0.51], grass: [0.35, 0.50, 0.24], groove: [0.24, 0.25, 0.26], rail: [0.40, 0.41, 0.43],
  railTop: [0.66, 0.67, 0.69], wire: [0.10, 0.10, 0.11], platform: [0.74, 0.73, 0.70], platformEdge: [0.88, 0.80, 0.30], platformSide: [0.58, 0.57, 0.55],
};

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The ground the tram runs on: the terrain, or the deck of a bridge that CARRIES the track.  A deck carries the track when it runs
 *  along it (the Pont Rouge, the viaducts); a deck that crosses over the track at an angle is a bridge the tram runs UNDER, and the
 *  ground stays the ground there.  (Telling them apart by the direction needs no memory of the height before: a chunk of track
 *  can be built on its own.)  (tx, tz) is the direction of the track at the point. */
const ALIGNED = 0.42;                   // sine of the largest angle (25 degrees) between a deck and the track it carries
function createRailGround(surface, deckNetwork) {
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  return (x, z, tx, tz) => {
    const g = surface.height(x, z);
    if (!deckNetwork || deckNetwork.count === 0) return g;
    let y = 1e9;
    for (let k = 0; k < 3; k++) {                  // the highest deck first, then the ones below it
      const hit = deckNetwork.deckAt(x, z, y, scratch);
      if (!hit) break;
      if (Math.abs(hit.ux * tz - hit.uz * tx) < ALIGNED) return hit.top > g ? hit.top : g;
      y = hit.top - DECK.stickBelow - 0.01;
    }
    return g;
  };
}

export function createTramView({ scene, network, sim, surface, deckNetwork, env, camera, maps }) {
  const material = createPartMaterial(env);
  const bedMaterial = createPartMaterial(env, { offset: -2 });
  const railGround = createRailGround(surface, deckNetwork);
  const road = { sdCar: 9, sdPave: 9 };
  const land = { urban: 0 };
  const group = new THREE.Group();
  scene.add(group);

  // ---- the polylines of the track: the two tracks of the line, and the rails of the network that are not on them
  const lines = network.tracks.map((t) => ({ pts: t.pts, track: t, wire: true }));
  const near = new Map();                                                // a 4 m grid of the points of the two tracks
  const cellKey = (x, z) => Math.floor(x / 4) * 100003 + Math.floor(z / 4);
  for (const t of network.tracks) for (let i = 0; i < t.pts.length; i += 2) near.set(cellKey(t.pts[i], t.pts[i + 1]), true);
  const onLine = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (near.has(cellKey(x + dx * 4, z + dz * 4))) return true; return false; };
  for (const way of network.ways) {            // crossovers, branches and sidings: the pieces that no track of the line covers
    let run = [];
    const flush = () => { if (run.length >= 4) lines.push({ pts: Float32Array.from(run), track: null, wire: false }); run = []; };
    for (let i = 0; i < way.length; i += 2) {
      if (onLine(way[i], way[i + 1])) flush(); else run.push(way[i], way[i + 1]);
    }
    flush();
  }

  // ---- the chunks: pieces of a polyline of about TRAM.chunk metres
  const chunks = [];
  for (const line of lines) {
    const n = line.pts.length / 2;
    const per = Math.max(2, Math.round(TRAM.chunk / 3 / 1));             // points (1 m apart on a track) per chunk
    for (let a = 0; a < n - 1; a += per) {
      const b = Math.min(n - 1, a + per);
      let cx = 0, cz = 0;
      for (let i = a; i <= b; i++) { cx += line.pts[i * 2]; cz += line.pts[i * 2 + 1]; }
      chunks.push({ line, a, b, cx: cx / (b - a + 1), cz: cz / (b - a + 1), mesh: null, state: 'idle', job: null, radius: (b - a) / 2 + 30 });
    }
  }

  function* buildChunk(chunk) {
    const { line, a, b } = chunk;
    const bed = new PartBuilder();
    const wire = new PartBuilder();
    const pts = line.pts;
    // the sample points: every SECTION_STEP metres (the points are about 1 m apart on a track, more on a raw way)
    const idx = [];
    let acc = 0;
    idx.push(a);
    for (let i = a + 1; i <= b; i++) {
      acc += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      if (acc >= SECTION_STEP || i === b) { idx.push(i); acc = 0; }
    }
    const prevI = (k) => idx[Math.max(0, k - 1)], nextI = (k) => idx[Math.min(idx.length - 1, k + 1)];
    const sections = [];
    let last = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const px = pts[prevI(k) * 2], pz = pts[prevI(k) * 2 + 1], qx = pts[nextI(k) * 2], qz = pts[nextI(k) * 2 + 1];
      let tx = qx - px, tz = qz - pz;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const rx = -tz, rz = tx;                                                   // to the right of the travel direction
      const yc = railGround(x, z, tx, tz);
      const yl = railGround(x - rx * HALF_BED, z - rz * HALF_BED, tx, tz), yr = railGround(x + rx * HALF_BED, z + rz * HALF_BED, tx, tz);
      surface.roadInfoAt(x, z, road);
      sampleWorldMap(maps, x, z, land);
      // the tram shares the street (a slab, the rails are embedded) or runs on paving in the city; only in the open it has a grass bed
      const onDeck = yc - surface.height(x, z) > 0.4;                             // on a bridge: a slab, never a lawn in the air
      const onRoad = onDeck || road.sdCar < 0.6 || road.sdPave < 0.3 || land.urban > 0.5;
      sections.push({ x, z, tx, tz, rx, rz, yc, yl, yr, onRoad, along: last });
      if (k > 0) last += Math.hypot(x - sections[k - 1].x, z - sections[k - 1].z);
      if (k % 8 === 7) yield;
    }
    // the bed, the grooves, the rails
    const yAt = (s, lat) => (lat < 0 ? s.yc + (s.yl - s.yc) * (-lat / HALF_BED) : s.yc + (s.yr - s.yc) * (lat / HALF_BED));
    const P = (s, lat, lift) => [s.x + s.rx * lat, yAt(s, lat) + lift, s.z + s.rz * lat];
    const half = TRAM.gauge / 2 + TRAM.railWidth / 2;
    const strip = (s0, s1, l0, l1, lift, c0, c1) => {
      b2(bed, P(s0, l0, lift), P(s1, l0, lift), P(s1, l1, lift), P(s0, l1, lift), c0, c1);
    };
    for (let k = 0; k + 1 < sections.length; k++) {
      const s0 = sections[k], s1 = sections[k + 1];
      const slab = s0.onRoad || s1.onRoad ? (k % 4 < 2 ? COL.slab : COL.slabDark) : COL.grass;
      const g = s0.onRoad || s1.onRoad ? COL.slab : COL.grass;
      strip(s0, s1, -HALF_BED, -half - GROOVE, BED_LIFT, g, g);
      strip(s0, s1, -half - GROOVE, -half + GROOVE, BED_LIFT, COL.groove, COL.groove);
      strip(s0, s1, -half + GROOVE, half - GROOVE, BED_LIFT, slab, slab);
      strip(s0, s1, half - GROOVE, half + GROOVE, BED_LIFT, COL.groove, COL.groove);
      strip(s0, s1, half + GROOVE, HALF_BED, BED_LIFT, g, g);
      for (const side of [-1, 1]) {                                              // a rail: the top and the two sides
        const c = side * TRAM.gauge / 2;
        const lo = TRAM.lift, hi = TRAM.lift + TRAM.railHeight, w = TRAM.railWidth / 2;
        const Pr = (s, lat, y) => [s.x + s.rx * lat, yAt(s, lat) + y, s.z + s.rz * lat];
        const inside = [(s0.x + s1.x) / 2 + s0.rx * c, yAt(s0, c) + (lo + hi) / 2, (s0.z + s1.z) / 2 + s0.rz * c];
        bed.quad(Pr(s0, c - w, hi), Pr(s1, c - w, hi), Pr(s1, c + w, hi), Pr(s0, c + w, hi), COL.railTop, 0, inside);
        bed.quad(Pr(s0, c - w, lo), Pr(s1, c - w, lo), Pr(s1, c - w, hi), Pr(s0, c - w, hi), COL.rail, 0, inside);
        bed.quad(Pr(s0, c + w, lo), Pr(s1, c + w, lo), Pr(s1, c + w, hi), Pr(s0, c + w, hi), COL.rail, 0, inside);
      }
      if (k % 8 === 7) yield;
    }
    // the catenary: the contact wire along the line, and a pole every TRAM.catenary.spacing metres on the outer side
    if (line.wire) {
      const H = TRAM.catenary.height + TRAM.lift + TRAM.railHeight;
      const poleGeom = new PartBuilder(); buildPole(poleGeom);
      const absStart = a * 1.0;                                                   // the points of a track are 1 m apart: the index is the distance along it
      let nextPole = Math.ceil(absStart / TRAM.catenary.spacing) * TRAM.catenary.spacing;
      for (let k = 0; k + 1 < sections.length; k++) {
        const s0 = sections[k], s1 = sections[k + 1];
        {                                                                         // the wire: a flat ribbon, seen from the side and from above
          const w0 = [s0.x, s0.yc + H, s0.z], w1 = [s1.x, s1.yc + H, s1.z];
          const wl = 0.035;
          wire.quad([w0[0], w0[1] - wl, w0[2]], [w1[0], w1[1] - wl, w1[2]], [w1[0], w1[1] + wl, w1[2]], [w0[0], w0[1] + wl, w0[2]], COL.wire);
          wire.quad([w0[0] + s0.rx * wl, w0[1], w0[2] + s0.rz * wl], [w1[0] + s1.rx * wl, w1[1], w1[2] + s1.rz * wl], [w1[0] - s1.rx * wl, w1[1], w1[2] - s1.rz * wl], [w0[0] - s0.rx * wl, w0[1], w0[2] - s0.rz * wl], COL.wire);
        }
        if (line.track && (absStart + s0.along) >= nextPole) {
          nextPole += TRAM.catenary.spacing;
          const lat = TRAM.catenary.arm + 0.4;                                    // the pole stands this far to the right of the track, its arm reaches left over it
          const px = s0.x + s0.rx * lat, pz = s0.z + s0.rz * lat;
          if (!(surface.roadInfoAt(px, pz, road), road.sdCar < 0.3)) {            // never in a carriageway
            const py = s0.yc;                                                         // the level of the track (a pole on a bridge stands on the deck)
            wire.append(poleGeom, { x: px, y: py + TRAM.lift + TRAM.railHeight, z: pz, yaw: Math.atan2(-s0.rx, -s0.rz) });
          }
        }
      }
    }
    const origin = [chunk.cx, sections[0].yc, chunk.cz];
    const geometries = [bed.count ? bed.build(THREE, origin) : null, wire.count ? wire.build(THREE, origin) : null];
    return { geometries, origin };
  }
  // a two-colour quad (the second colour is for the far edge: the gradient of the road / grass change reads as one calm surface)
  function b2(builder, a, b, c, d, c0, c1) { builder.quad(a, b, c, d, c0 === c1 ? c0 : lerp3(c0, c1, 0.5), 0, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - 1, (a[2] + c[2]) / 2]); }

  // ---- the platforms and their shelters (one mesh: 44 stops)
  function buildPlatforms() {
    const pb = new PartBuilder();
    const shelter = new PartBuilder(); buildShelter(shelter);
    const spec = TRAM.platform;
    const cfgInner = TRAM.width / 2 + spec.setback;
    const pos = { x: 0, z: 0, dx: 0, dz: 0 };
    network.tracks.forEach((track, ti) => {
      for (const stop of network.stops[ti]) {
        const steps = Math.round(spec.length / 4);
        const samples = [];
        let blocked = 0;
        for (let i = 0; i <= steps; i++) {
          const s = stop.s - spec.length / 2 + (spec.length * i) / steps;
          if (s < 1 || s > track.length - 1) continue;
          track.at(s, pos);
          const rx = -pos.dz, rz = pos.dx;
          const xi = pos.x + rx * cfgInner, zi = pos.z + rz * cfgInner, xo = pos.x + rx * (cfgInner + spec.width), zo = pos.z + rz * (cfgInner + spec.width);
          surface.roadInfoAt((xi + xo) / 2, (zi + zo) / 2, road);
          if (road.sdCar < -0.2) blocked++;
          const y = railGround(pos.x, pos.z, pos.dx, pos.dz);
          samples.push({ xi, zi, xo, zo, y, rx, rz });
        }
        if (samples.length < 4 || blocked > samples.length * 0.35) continue;
        const top = spec.height;
        for (let i = 0; i + 1 < samples.length; i++) {
          const a = samples[i], b = samples[i + 1];
          const Pt = (s, o, y) => [s.xi + (s.xo - s.xi) * o, y, s.zi + (s.zo - s.zi) * o];
          const ya = a.y - 0.05 + top, yb = b.y - 0.05 + top;
          const inside = [(a.xi + b.xo) / 2, (a.y + b.y) / 2 - 0.2, (a.zi + b.zo) / 2];
          pb.quad(Pt(a, 0, ya), Pt(b, 0, yb), Pt(b, 1, yb), Pt(a, 1, ya), COL.platform, 0, inside);
          pb.quad(Pt(a, 0, ya), Pt(b, 0, yb), Pt(b, 0.14, yb), Pt(a, 0.14, ya), COL.platformEdge, 0, inside);     // the tactile strip at the edge
          pb.quad(Pt(a, 0, ya - top - 0.5), Pt(b, 0, yb - top - 0.5), Pt(b, 0, yb), Pt(a, 0, ya), COL.platformSide, 0, inside);
          pb.quad(Pt(a, 1, ya - top - 0.5), Pt(b, 1, yb - top - 0.5), Pt(b, 1, yb), Pt(a, 1, ya), COL.platformSide, 0, inside);
        }
        const f = samples[0], l = samples[samples.length - 1];
        for (const e of [f, l]) pb.quad([e.xi, e.y - 0.55, e.zi], [e.xo, e.y - 0.55, e.zo], [e.xo, e.y + top - 0.05, e.zo], [e.xi, e.y + top - 0.05, e.zi], COL.platformSide, 0, [(f.xi + l.xo) / 2, f.y, (f.zi + l.zo) / 2]);
        const m = samples[Math.floor(samples.length / 2)];
        const sx = m.xi + (m.xo - m.xi) * 0.35, sz = m.zi + (m.zo - m.zi) * 0.35;
        // the shelter: its back is turned away from the track (local +z = away from the track = to the right of the travel direction)
        pb.append(shelter, { x: sx, y: m.y - 0.05 + top, z: sz, yaw: Math.atan2(m.rx, m.rz) });
      }
    });
    if (!pb.count) return null;
    const mesh = new THREE.Mesh(pb.build(THREE), material);
    mesh.frustumCulled = true;
    group.add(mesh);
    return mesh;
  }

  // ---- the vehicles: three instanced meshes (the geometry is in the frame of a section: +x forward, y = 0 at the rail head)
  const geo = {};
  { const b1 = new PartBuilder(); buildEndSection(b1); geo.end = b1.build(THREE);
    const b2_ = new PartBuilder(); buildMiddleSection(b2_, { pantograph: true }); geo.pan = b2_.build(THREE);
    const b3 = new PartBuilder(); buildMiddleSection(b3); geo.mid = b3.build(THREE); }
  const perTram = { end: 2, pan: 2, mid: TRAM.sections - 4 };
  const inst = {};
  for (const key of ['end', 'pan', 'mid']) {
    inst[key] = new THREE.InstancedMesh(geo[key], material, Math.max(1, perTram[key] * sim.trams.length));
    inst[key].frustumCulled = false;                    // a tram is 45 m long and the instances move: three draw calls are cheaper than the maths
    inst[key].count = perTram[key] * sim.trams.length;
    group.add(inst[key]);
  }
  /** Which instanced mesh draws section k of a vehicle, and which of its instances: [kind, local index]. */
  const last = TRAM.sections - 1;
  const slotFor = (k) => (k === 0 ? ['end', 0] : k === last ? ['end', 1] : k % 2 === 1 ? ['pan', (k - 1) / 2] : ['mid', k / 2 - 1]);
  const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), T = new THREE.Vector3();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  function updateVehicles() {
    sim.trams.forEach((tram, ti) => {
      for (let k = 0; k < TRAM.sections; k++) {
        const [kind, local] = slotFor(k);
        const slot = ti * perTram[kind] + local;
        if (tram.hidden) { inst[kind].setMatrixAt(slot, ZERO); continue; }
        const sec = tram.sections[k];
        const dx = sec.fx - sec.rx, dz = sec.fz - sec.rz, dl = Math.hypot(dx, dz) || 1;
        const yf = railGround(sec.fx, sec.fz, dx / dl, dz / dl), yr = railGround(sec.rx, sec.rz, dx / dl, dz / dl);
        X.set(sec.fx - sec.rx, yf - yr, sec.fz - sec.rz);
        if (k === last) X.negate();                              // the rear end section faces backwards: its nose is the rear of the vehicle
        X.normalize();
        Y.set(0, 1, 0);
        Z.crossVectors(X, Y).normalize();
        Y.crossVectors(Z, X).normalize();
        T.set((sec.fx + sec.rx) / 2, (yf + yr) / 2 + TRAM.lift + TRAM.railHeight, (sec.fz + sec.rz) / 2);
        m4.makeBasis(X, Y, Z).setPosition(T);
        inst[kind].setMatrixAt(slot, m4);
      }
    });
    for (const key of ['end', 'pan', 'mid']) inst[key].instanceMatrix.needsUpdate = true;
  }

  let platformMesh = null;
  let platformsBuilt = false;
  let frame = 0;

  function update(dt, camX, camZ) {
    sim.update(dt);
    updateVehicles();
    if (!platformsBuilt) { platformsBuilt = true; platformMesh = buildPlatforms(); }
    frame++;
    // the chunks: show the near ones, build the nearest unbuilt one(s) within the time budget
    let wanted = null, wantedD = Infinity;
    for (const c of chunks) {
      const d = Math.hypot(c.cx - camX, c.cz - camZ) - c.radius;
      if (c.mesh) { const vis = d < SHOW_RADIUS; for (const m of c.mesh) m.visible = vis; }
      else if (c.state === 'idle' && d < BUILD_RADIUS && d < wantedD) { wanted = c; wantedD = d; }
    }
    const t0 = performance.now();
    if (wanted && !chunks.some((c) => c.state === 'building')) { wanted.state = 'building'; wanted.job = buildChunk(wanted); }
    for (const c of chunks) {
      if (c.state !== 'building') continue;
      while (performance.now() - t0 < BUDGET_MS) {
        const step = c.job.next();
        if (step.done) {
          c.state = 'built'; c.job = null; c.mesh = [];
          for (let i = 0; i < 2; i++) {
            const g = step.value.geometries[i];
            if (!g) continue;
            const mesh = new THREE.Mesh(g, i === 0 ? bedMaterial : material);
            mesh.position.set(step.value.origin[0], step.value.origin[1], step.value.origin[2]);
            group.add(mesh); c.mesh.push(mesh);
          }
          break;
        }
      }
    }
  }

  const stats = () => ({ chunks: chunks.length, built: chunks.filter((c) => c.mesh).length, building: chunks.filter((c) => c.state === 'building').length });
  return { update, group, stats, chunks, trams: sim.trams, instanced: inst, platformMesh: () => platformMesh };
}
