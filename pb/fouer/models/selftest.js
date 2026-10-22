/* Schueberfouer Tycoon, W3: in-page model checks used by scripts/flows/fouer_models.mjs and the preview page (window.__fouerModels.check()).
 *   runModelChecks({ T, ids, looks, levels, qualities, fars }) -> { rows, errors, summary }
 * For every model x look x level x quality (x far LOD) it builds the group, measures the ground footprint over a few animation poses (Box3 of the visible
 * meshes + points, rotating / swinging parts included) and compares it with the pitch size of data.js (S 8 x 8, M 16 x 16, L 30 x 18; an item may use its own size). */
import { MY_MODELS, REGISTRY, normaliseOpts } from './index.js';
import { ITEM_BY_ID, SIZES } from '../data.js';

const TOL = 0.15;
export function runModelChecks({ T, ids = Object.keys(MY_MODELS), looks = [0, 1, 2], levels = [1, 2, 3, 4], qualities = ['low', 'medium', 'high'], fars = [false, true], poses = [0, 1.3, 2.9, 4.4] }) {
  const rows = []; const errors = []; const sizeOf = (id) => SIZES[(ITEM_BY_ID[id] || { size: 'M' }).size];
  const box = new T.Box3(); const tmp = new T.Box3();
  for (const id of ids) for (const look of looks) for (const level of levels) for (const quality of qualities) for (const far of fars) {
    if (!far && quality !== 'medium' && !(look === 0 && level === 4)) continue;         // every quality is covered at one look, the full look x level grid at medium
    let g; const t0 = performance.now();
    try { g = MY_MODELS[id].build(normaliseOpts({ look, level, quality, seed: 3, far })); g.name = id; } catch (e) { errors.push(`${id} L${level} look${look} ${quality}${far ? ' far' : ''}: ${e.message}`); continue; }
    const ms = performance.now() - t0; box.makeEmpty();
    const anim = g.userData.animate;
    for (const t of poses) { if (anim) anim(t, 0.016, 0); g.updateMatrixWorld(true); g.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible) { const a = o.geometry.attributes.position; const e = o.matrixWorld.elements; for (let i = 0; i < a.count; i++) { const x = a.getX(i); const y = a.getY(i); const z = a.getZ(i); const X = e[0] * x + e[4] * y + e[8] * z + e[12]; const Y = e[1] * x + e[5] * y + e[9] * z + e[13]; const Z = e[2] * x + e[6] * y + e[10] * z + e[14]; if (X < box.min.x) box.min.x = X; if (X > box.max.x) box.max.x = X; if (Y < box.min.y) box.min.y = Y; if (Y > box.max.y) box.max.y = Y; if (Z < box.min.z) box.min.z = Z; if (Z > box.max.z) box.max.z = Z; } } }); }
    if (anim) anim(0, 0, 0);
    const sz = sizeOf(id); const hx = sz.u / 2; const hz = sz.w / 2;
    const over = Math.max(box.max.x - hx, -box.min.x - hx, box.max.z - hz, -box.min.z - hz);
    const row = { id, look, level, quality, far, tris: g.userData.tris, bulbs: g.userData.bulbs, ms: Math.round(ms * 10) / 10, box: [box.min.x, box.max.x, box.min.z, box.max.z, box.max.y].map((v) => +v.toFixed(2)), over: +over.toFixed(2), fits: over <= TOL, name: g.name, anim: !!g.userData.animated };
    if (g.name !== id) errors.push(`${id}: group name is ${g.name}`);
    if (!g.userData.setNight) errors.push(`${id}: no setNight`);
    if (!(g.userData.tris > 0)) errors.push(`${id}: no triangles`);
    rows.push(row);
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  const bad = rows.filter((r) => !r.fits);
  const byId = {}; rows.forEach((r) => { const k = r.id; (byId[k] = byId[k] || []).push(r); });
  const summary = Object.entries(byId).map(([id, rs]) => { const full = rs.filter((r) => !r.far && r.level === 4 && r.quality === 'medium'); const far = rs.filter((r) => r.far && r.level === 4 && r.quality === 'medium'); const mx = (a, f) => (a.length ? Math.max(...a.map(f)) : 0); return { id, builds: rs.length, maxOver: mx(rs, (r) => r.over), trisL4: mx(full, (r) => r.tris), trisL4far: mx(far, (r) => r.tris), bulbsL4: mx(full, (r) => r.bulbs), maxMs: mx(rs, (r) => r.ms) }; });
  return { rows, errors, bad, summary, count: rows.length };
}
export function registrySummary() { return Object.keys(REGISTRY); }
