/* Lift ruins (28 Nov 2026): closed / abandoned lifts stand in the resort as they do in reality (pb/ski/data/<resort>/ruins.json, written by
 * scripts/ski/ruins.py from the OSM abandoned: / disused: / was: aerialway ways). Not rideable and not a lift anywhere: no rope, no carriers,
 * no boarding, not in resort.lifts (so not in the lift list, goals, lift index or the map). What stands: the pylons (some leaning, rusty or
 * faded, some without their crossarm, a broken rope stub here and there) and the station huts (boarded up, roof falling in). Solid like the
 * live ones: hit(x, z, r, y) answers like lift-site.js's world.hit ({ nx, nz, pen, kind }).
 * Budget: one merged mesh per 1 km cell, built the first time the camera is within BUILD_R of it (nothing is built far from the player);
 * a resort without ruins costs the 2 byte file. No shadows cast, GPU-only geometry. */
const THREE = window.THREE;

import { mergeLit, shapeGeometry, stationMaterial } from './station-mesh.js';
import { gpuOnly } from './gpu-mem.js';

const CELL = 1000;                         // m: one merged mesh per cell
const BUILD_R = 900;                      // m: a cell is built when the camera comes this close, shown within SHOW_R
const SHOW_R = 1100;
const GRID = 40;                           // m: collision buckets
const HEIGHT = { drag: 5.6, chair: 9, gondola: 11, cable: 14 };           // pylon height above the ground
const COLUMN_R = { drag: 0.21, chair: 0.28, gondola: 0.32, cable: 0.4 };
const SPAN = { drag: 2.6, chair: 5.2, gondola: 6.4, cable: 7 };            // crossarm length
const RUST = [0x8a6650, 0x7d6a5d, 0x80736a, 0x6f7773, 0x93705a];           // rusty, faded paint
const WOOD = [0x6b5a49, 0x5f5043, 0x75634f];
const CONCRETE = [0x8d8a83, 0x7f7c76];
const ROOF = 0x4e4944, BOARD = 0x3b3128, SIGN = 0xb4ad9c, STEEL = 0x4a4f55;

function rng(seed) {                       // mulberry32: the same ruin looks the same every time
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Point + direction at arc length s of a flat [x, z, ...] polyline. */
function makeLine(pts) {
  const n = pts.length / 2, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]));
  return (s, out) => {
    const t = Math.max(0, Math.min(cum[n - 1], s));
    let i = 1;
    while (i < n - 1 && cum[i] < t) i++;
    const seg = cum[i] - cum[i - 1] || 1, u = (t - cum[i - 1]) / seg;
    const dx = pts[2 * i] - pts[2 * i - 2], dz = pts[2 * i + 1] - pts[2 * i - 1], l = Math.hypot(dx, dz) || 1;
    out.x = pts[2 * i - 2] + dx * u; out.z = pts[2 * i - 1] + dz * u; out.dx = dx / l; out.dz = dz / l;
    return out;
  };
}

export async function loadRuins(root) {
  try {
    const res = await fetch(root + 'ruins.json');
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (error) { console.warn('[ski] ruins.json unreadable', error.message); return []; }
}

export function createRuins({ scene, rows, env = null, height }) {
  const group = new THREE.Group();
  group.name = 'ski-ruins';
  scene.add(group);
  const mat = stationMaterial(env);
  const cells = new Map();                  // key -> { x, z, parts: [], mesh, tried }
  const grid = new Map();                   // collision buckets: key -> [collider]
  const stats = { ruins: 0, pylons: 0, huts: 0 };
  const cellOf = (x, z) => { const i = Math.floor(x / CELL), j = Math.floor(z / CELL), k = i + ',' + j; let c = cells.get(k); if (!c) cells.set(k, (c = { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, parts: [], mesh: null })); return c; };
  const rot = (dx, dz) => new THREE.Matrix4().makeRotationY(-Math.atan2(dz, dx));
  const add = (x, z, geo, colour, m) => cellOf(x, z).parts.push([geo, colour, m, 0]);
  /** A box of w (along the line) x h x d (across) standing on y0, centred at (x, z), turned to the direction (dx, dz); extra: tilt about the line axis. */
  function box(w, h, d, x, y0, z, dx, dz, colour, { shape = null, tilt = 0, lift = 0 } = {}) {
    const geo = shape ? shapeGeometry(shape, w, h, d) : new THREE.BoxGeometry(w, h, d);
    const m = rot(dx, dz);
    if (tilt) m.multiply(new THREE.Matrix4().makeRotationX(tilt));
    m.setPosition(x, y0 + h / 2 + lift, z);
    add(x, z, geo, colour, m);
  }
  const bucket = (x, z) => Math.floor(x / GRID) * 100003 + Math.floor(z / GRID);
  function collider(c) {                    // c: { x, z, r (disc) | box: hw, hd, fx, fz, h (above the ground), low }
    const r = c.box ? Math.hypot(c.hw, c.hd) : c.r;
    for (let i = Math.floor((c.x - r) / GRID); i <= Math.floor((c.x + r) / GRID); i++) {
      for (let j = Math.floor((c.z - r) / GRID); j <= Math.floor((c.z + r) / GRID); j++) {
        const k = i * 100003 + j; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(c);
      }
    }
  }
  const tmp = {};
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return h; };

  function pylon(ruin, line, s, index, rand) {
    line(s, tmp);
    const { x, z, dx, dz } = tmp;
    const kind = ruin.type in HEIGHT ? ruin.type : 'drag';
    const g = height(x, z) - 0.4;
    const h = HEIGHT[kind] * (0.93 + rand() * 0.14);
    const r = COLUMN_R[kind];
    // leaning: most stand straight, a third a few degrees off, one in ten properly crooked
    const roll = rand();
    const lean = roll < 0.55 ? (rand() - 0.5) * 0.03 : roll < 0.9 ? (rand() - 0.5) * 0.12 : (rand() < 0.5 ? -1 : 1) * (0.16 + rand() * 0.08);
    const dir = rand() * Math.PI * 2;
    const colour = RUST[Math.floor(rand() * RUST.length)];
    const m = new THREE.Matrix4().makeTranslation(x, g, z)
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), lean))
      .multiply(new THREE.Matrix4().makeTranslation(0, h / 2, 0));
    add(x, z, new THREE.CylinderGeometry(r * 0.8, r * 1.15, h, 6), colour, m);
    // base plinth
    box(r * 5, 0.5, r * 5, x, g - 0.1, z, 1, 0, 0x7c7973);
    const top = new THREE.Vector3(0, h / 2, 0).applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), lean));
    const tx = x + top.x, tz = z + top.z, ty = g + h / 2 + top.y;       // (the top of the tube)
    // the crossarm over the line (across it): missing, hanging crooked, or whole; a rope stub hangs from some
    const arm = rand();
    const span = SPAN[kind];
    if (arm > 0.2) {
      const crooked = arm > 0.82;
      box(0.4, 0.4, span * (arm > 0.7 ? 0.7 : 1), tx, ty - 0.35, tz, dx, dz, colour === RUST[3] ? 0x5b5f64 : 0x4f4a45, { tilt: crooked ? 0.35 : 0, lift: 0 });
      if (rand() < 0.4) box(0.07, 1.6 + rand() * 1.4, 0.07, tx - dz * span * 0.45, ty - 2.2, tz + dx * span * 0.45, dx, dz, 0x2c2a28);
    } else if (rand() < 0.5) {
      box(0.28, 0.28, span * 0.35, tx, ty - 0.35, tz, dx, dz, 0x4f4a45);                 // only a stump of it
    }
    collider({ x, z, r: r * 1.4 + 0.25, h, base: g });
    stats.pylons++;
  }

  /** The station hut at an end (ex = + 1 at the top, - 1 at the bottom): a boarded-up drag hut, a bigger concrete shed for the others. */
  function hut(ruin, up, rand) {
    const line = ruin._line;
    line(up ? ruin.len : 0, tmp);
    const { x, z, dx, dz } = tmp;
    const big = ruin.type !== 'drag';
    const kind = ruin.type;
    const w = big ? (kind === 'chair' ? 6.5 : 9) : 2.8, d = big ? (kind === 'chair' ? 4.2 : 6) : 2.4, h = big ? (kind === 'chair' ? 3.0 : 3.8) : 2.3;
    const g = Math.min(height(x, z), height(x + dx * w / 2, z + dz * w / 2), height(x - dx * w / 2, z - dz * w / 2), height(x - dz * d / 2, z + dx * d / 2), height(x + dz * d / 2, z - dx * d / 2)) - 0.3;
    const wall = big ? CONCRETE[Math.floor(rand() * CONCRETE.length)] : WOOD[Math.floor(rand() * WOOD.length)];
    // drag lifts: the drive hut stands at the bottom, at the top only the broken mast base remains
    if (!big && up) {
      box(1.3, 0.9, 1.3, x, g, z, dx, dz, 0x85827b);
      box(0.3, 3.4, 0.3, x, g + 0.9, z, dx, dz, RUST[Math.floor(rand() * RUST.length)]);
      collider({ x, z, r: 0.9, h: 4.2, base: g });
      stats.huts++;
      return;
    }
    box(w, h, d, x, g, z, dx, dz, wall);                                                // walls
    box(w + 0.5, 0.22, d + 0.5, x, g + h, z, dx, dz, ROOF, { shape: big ? 'monoA' : null });     // the roof, a shed roof for the big ones
    if (big && rand() < 0.6) box(w * 0.5, 0.15, d * 0.7, x - dx * w * 0.2, g + h + 0.7, z - dz * w * 0.2, dx, dz, 0x5d5751, { tilt: 0.3 });   // a roof sheet half off
    // the boarded-up door and window on the downhill face: dark planks, one crooked
    const face = up ? -1 : 1;                                                           // the side towards the line
    const ox = dx * (w / 2 + 0.05) * face, oz = dz * (w / 2 + 0.05) * face;
    box(0.1, h * 0.7, d * 0.4, x + ox, g, z + oz, dx, dz, BOARD);
    box(0.12, h * 0.5, 0.18, x + ox, g + h * 0.15, z + oz, dx, dz, BOARD, { tilt: 0 });
    if (rand() < 0.5) box(0.06, 0.4, 0.8, x + ox * 1.01 + dz * d * 0.28, g + h * 0.55, z + oz * 1.01 - dx * d * 0.28, dx, dz, SIGN);     // a faded sign
    if (big) box(0.5, 0.5, 0.5, x + -dx * w * 0.9 * face, g, z - dz * w * 0.9 * face, dx, dz, STEEL);   // a footing of the old wheel mast (no wheel)
    collider({ x, z, box: true, hw: w / 2, hd: d / 2, fx: dx, fz: dz, h: h + 0.2, base: g });
    stats.huts++;
  }

  for (const ruin of rows) {
    if (!ruin || !ruin.pts || ruin.pts.length < 4) continue;
    try {
      ruin._line = makeLine(ruin.pts);
      const rand = rng(Number(ruin.osm) || ruin.len);
      (ruin.pylons || []).forEach((s, i) => pylon(ruin, ruin._line, s, i, rand));
      hut(ruin, false, rand);
      hut(ruin, true, rand);
      stats.ruins++;
    } catch (error) { console.warn('[ski] ruin failed', ruin.name, error); }
  }

  /** Solid pylons and huts overlapping a disc (x, z, r) up to y (feet; -Infinity: any height), like lift-site.js's world.hit. */
  const out = { nx: 0, nz: 0, pen: 0, kind: 'ruin' };
  function hit(x, z, r, y = -Infinity, ground = null, body = 1.8) {          // (body: kept for the signature of lift-site.js hit)
    const a = grid.get(bucket(x, z));
    if (!a) return null;
    let best = null;
    for (const c of a) {
      if (y !== -Infinity && y > height(c.x, c.z) + c.h) continue;                      // flying over it
      let pen, nx, nz;
      if (c.box) {
        const rx = x - c.x, rz = z - c.z, la = rx * c.fx + rz * c.fz, lb = -rx * c.fz + rz * c.fx;
        const ca = Math.max(-c.hw, Math.min(c.hw, la)), cb = Math.max(-c.hd, Math.min(c.hd, lb));
        const da = la - ca, db = lb - cb, d = Math.hypot(da, db);
        let na, nb;
        if (d > 1e-6) { pen = r - d; na = da / d; nb = db / d; }
        else { const m = [[la + c.hw, -1, 0], [c.hw - la, 1, 0], [lb + c.hd, 0, -1], [c.hd - lb, 0, 1]].sort((u, v) => u[0] - v[0])[0]; pen = r + m[0]; na = m[1]; nb = m[2]; }
        nx = c.fx * na - c.fz * nb; nz = c.fz * na + c.fx * nb;
      } else {
        const ddx = x - c.x, ddz = z - c.z, d = Math.hypot(ddx, ddz);
        pen = r + c.r - d; nx = d > 1e-6 ? ddx / d : 1; nz = d > 1e-6 ? ddz / d : 0;
      }
      if (pen > 0 && (!best || pen > best.pen)) { best = out; out.pen = pen; out.nx = nx; out.nz = nz; }
    }
    return best;
  }

  let built = 0;
  function build(c) {
    c.tried = true;
    if (!c.parts.length) return;
    const geo = gpuOnly(mergeLit(c.parts));
    c.parts = [];
    c.mesh = new THREE.Mesh(geo, mat);
    c.mesh.name = 'ski-ruins-' + built++;
    c.mesh.castShadow = false; c.mesh.receiveShadow = true;
    group.add(c.mesh);
  }
  return {
    group, stats, hit,
    get cells() { return cells.size; },
    get builtCells() { return built; },
    /** The cells near the camera are built (once) and shown; the others hidden. */
    update(px, pz) {
      for (const c of cells.values()) {
        const dx = Math.max(0, Math.abs(c.x - px) - CELL / 2), dz = Math.max(0, Math.abs(c.z - pz) - CELL / 2);       // m to the cell's box
        const near = Math.hypot(dx, dz) < (c.tried ? SHOW_R : BUILD_R);
        if (near && !c.tried) build(c);
        if (c.mesh) c.mesh.visible = near;
      }
    },
    dispose() { scene.remove(group); for (const c of cells.values()) if (c.mesh) c.mesh.geometry.dispose(); mat.dispose(); },
  };
}
