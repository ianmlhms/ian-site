/* Round 7: the inside of an underground funicular's tunnel (Funival, Perce-Neige, Sunnegga), built only while the player rides it.
 * One merged mesh, one draw call: a horseshoe tube along the line's underground spans (lift-path.js `tunnels`, the rail grade from
 * `cableY`) with a darker floor and the two tracks' bed, and a lamp every LAMP_GAP m on both walls. The lamps are painted into the vertex
 * colours as well (a warm pool of light round each), so no light source is needed: MeshBasicMaterial, unlit, cheap on Niddreg.
 * The tube's open ends are the portals (lifts.js draws their concrete frames on the slope), so the ride enters it from daylight. */
import { TUNNEL } from '../lift-path.js';

const THREE = window.THREE;
const RING_STEP = 4;             // m between two rings
const SEGMENTS = 14;             // around the horseshoe
const LAMP_GAP = 14;             // m between two lamps (each wall, staggered)
const WALL = [0.2, 0.19, 0.18], FLOOR = [0.11, 0.1, 0.095], LAMP = [1.0, 0.86, 0.58];

/** path = lift-path.js createLiftPath of a tunnel lift. Returns { mesh, dispose } (null without underground spans). */
export function createTunnel({ scene, path }) {
  if (!path.tunnels || !path.tunnels.length) return null;
  const pos = [], col = [], idx = [];
  const q = {};
  const hw = TUNNEL.width / 2, hh = TUNNEL.height;
  // the horseshoe in the cross-section: (u across, v up from the rail top - 0.4); the floor is flat, the vault is half an ellipse
  const ring = [];
  for (let k = 0; k <= SEGMENTS; k++) {
    const a = Math.PI * (k / SEGMENTS);
    ring.push([Math.cos(a) * hw, 2.2 + Math.sin(a) * (hh - 2.2)]);
  }
  ring.unshift([hw, 0]); ring.push([-hw, 0]);          // straight walls down to the floor
  const nRing = ring.length;                            // + the floor closes the loop (last -> first)
  const lampLight = (s, u, v) => {
    // a warm pool round the nearest lamp of this wall (lamps at v = 3.6 on both walls, staggered by half a gap)
    const side = u >= 0 ? 0 : LAMP_GAP / 2;
    const ds = ((s - side) % LAMP_GAP + LAMP_GAP) % LAMP_GAP;
    const d = Math.min(ds, LAMP_GAP - ds);
    const du = hw - Math.abs(u), dv = v - 3.6;
    const r2 = d * d + du * du * 1.5 + dv * dv;
    return Math.exp(-r2 / 10) * 1.35 + Math.exp(-r2 / 70) * 0.25;
  };
  for (const [a, b] of path.tunnels) {
    const s0 = Math.max(0, a - 6), s1 = Math.min(path.len, b + 6);        // a few metres past each portal (the mouth in the slope)
    const first = pos.length / 3;
    let rings = 0;
    for (let s = s0; ; s = Math.min(s1, s + RING_STEP)) {
      path.at(s, q);
      const y = path.cableY(s) - 0.4;
      const rx = -q.dz, rz = q.dx;                      // across the line
      for (const [u, v] of ring) {
        pos.push(q.x + rx * u, y + v, q.z + rz * u);
        const base = v < 0.05 ? FLOOR : WALL;
        const shade = 0.75 + 0.25 * Math.min(1, v / hh) + (((s / RING_STEP) | 0) % 2 ? 0.03 : 0);   // a darker foot, the ring joints
        const l = lampLight(s, u, v);
        col.push(base[0] * shade + LAMP[0] * l * 0.55, base[1] * shade + LAMP[1] * l * 0.55, base[2] * shade + LAMP[2] * l * 0.55);
      }
      rings++;
      if (s >= s1) break;
    }
    for (let r = 0; r + 1 < rings; r++) {
      for (let k = 0; k < nRing; k++) {
        const k2 = (k + 1) % nRing;                     // k = nRing - 1 -> 0 is the floor
        const i0 = first + r * nRing + k, i1 = first + r * nRing + k2, j0 = i0 + nRing, j1 = i1 + nRing;
        idx.push(i0, j0, i1, i1, j0, j1);
      }
    }
    // the lamps themselves: small bright boxes on both walls
    for (let s = s0 + 2; s < s1; s += LAMP_GAP / 2) {
      path.at(s, q);
      const rx = -q.dz, rz = q.dx, side = (Math.round((s - s0 - 2) / (LAMP_GAP / 2)) % 2) ? -1 : 1;
      const y = path.cableY(s) - 0.4 + 3.6, u = side * (hw - 0.12);
      const cx = q.x + rx * u, cz = q.z + rz * u, fx = q.dx * 0.45, fz = q.dz * 0.45;
      const b0 = pos.length / 3;
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(cx + fx * du, y + dv * 0.09, cz + fz * du);
        col.push(LAMP[0] * 1.6, LAMP[1] * 1.6, LAMP[2] * 1.6);
      }
      idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col.map((c) => Math.min(1, c)), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ski-tunnel';
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); } };
}
