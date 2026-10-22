/* Schueberfouer Tycoon, polish wave: bloom points for the big rides (own emissive material, big-kit.js).
 * A big ride lights itself with emissive lamp vertices (aEm.w = 1); this clusters those vertices into <= `cap` voxels (1.7 m) and returns a Points object on the shared
 * `bulbs` material (aPh = -1: bloom only, invisible by day) that is added as a CHILD of the mesh, so the halos move with animated parts and obey LOD visibility.
 * Skinned meshes (K.dynamic: gondolas, seats) drop their halo points again (their vertices move individually). */
import { getMaterials } from './materials.js';

const VOXEL = 1.3;
export function makeHalos(T, mesh, o = {}) {
  const cap = o.cap || 240; const g = mesh.geometry && mesh.geometry.attributes;
  if (!g || !g.aEm || mesh.userData.noHalo) return null;
  const M = getMaterials(); const pos = g.position; const em = g.aEm; const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    if (em.getW(i) < 0.5) continue;
    const r = em.getX(i); const gg = em.getY(i); const b = em.getZ(i); if (Math.max(r, gg, b) < 0.3) continue;
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const key = Math.round(x / VOXEL) + '|' + Math.round(y / VOXEL) + '|' + Math.round(z / VOXEL);
    let c = map.get(key); if (!c) { c = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, n: 0 }; map.set(key, c); }
    c.x += x; c.y += y; c.z += z; c.r += r; c.g += gg; c.b += b; c.n++;
  }
  let cells = [...map.values()]; if (!cells.length) return null;
  if (cells.length > cap) { const st = cells.length / cap; cells = Array.from({ length: cap }, (_, i) => cells[Math.floor(i * st)]); }
  const n = cells.length; const P = new Float32Array(n * 3); const C = new Float32Array(n * 3); const S = new Float32Array(n); const PH = new Float32Array(n).fill(-1);
  cells.forEach((c, i) => {
    P[i * 3] = c.x / c.n; P[i * 3 + 1] = c.y / c.n; P[i * 3 + 2] = c.z / c.n;
    const mx = Math.max(c.r, c.g, c.b) / c.n || 1; C[i * 3] = c.r / c.n / mx; C[i * 3 + 1] = c.g / c.n / mx; C[i * 3 + 2] = c.b / c.n / mx;
    S[i] = 0.13 + 0.02 * Math.min(6, Math.sqrt(c.n));
  });
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(P, 3)); geo.setAttribute('aCol', new T.BufferAttribute(C, 3)); geo.setAttribute('aSize', new T.BufferAttribute(S, 1));
  geo.setAttribute('aPh', new T.BufferAttribute(PH, 1)); geo.setAttribute('aGain', new T.BufferAttribute(new Float32Array(n).fill(1), 1)); geo.computeBoundingSphere();
  const pm = new T.Points(geo, M.bulbs); pm.name = 'halo'; pm.frustumCulled = true; pm.onBeforeRender = (r, sc, cam) => M.feed(r, sc, cam);
  mesh.add(pm); mesh.userData.glowHalos = n; mesh.userData.haloPoints = pm; mesh.geometry.userData.haloPoints = pm;
  return pm;
}
