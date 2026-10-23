/* Schueberfouer Tycoon, feedback B: the "nothing floats in the air" audit.  Pure module (no THREE, no DOM): it works on the raw triangles and bulbs of the model Builders
 * (kit.js pushes every finished Builder into `globalThis.__fouerRawSink` when a test sets it), in game-frame coordinates (x = u, y up, z = w).
 *
 * Every triangle is sampled onto a VOXEL grid (VOX metres); voxels that touch (26-neighbourhood) are one piece.  So a bunting wire whose ends meet the tops of two poles, a sign
 * panel on its posts, goods on a counter, a pole through an awning are all one piece with the thing that stands on the ground, and a string between two poles that are not there is not.
 * A piece is grounded when one of its voxels lies within GROUND_TOL of the terrain.  Floating = a piece that is not grounded.  A bulb (halo sprite) must have a voxel of a grounded
 * piece within BULB_REACH metres (a bulb with no fixture is a floating halo).
 *
 *   auditFloating(sources, { groundY, label }) -> { floating: [{ id, kind, voxels, bbox, why }], bulbs: [{ id, at, why }], stats }
 *     sources = [{ id, tris: ArrayLike (9 numbers per triangle, game / model frame), bulbs: ArrayLike (3 numbers per bulb) }]
 *   sourcesFromBuilders(entries)  the Builders that kit.js hands to `globalThis.__fouerRawSink` (Node harness: the NPC fair, props, clutter)
 *   sourcesFromGroup(group, id)   a built THREE group (browser flows: every model, the real world): meshes by their world matrix, `bulbs` Points
 */
export const VOX = 0.2, STEP = 0.15, GROUND_TOL = 0.25, BULB_REACH = 0.6;
const CHANNELS = ["solid", "ground", "fabric", "lamp", "sign", "signLit", "swing"];
const K = 4096;
const vkey = (i, j, k) => ((i + K) * 8192 + (j + K)) * 8192 + (k + K);

class DSU {
  constructor() { this.p = []; }
  add() { this.p.push(this.p.length); return this.p.length - 1; }
  find(i) { let r = i; while (this.p[r] !== r) r = this.p[r]; while (this.p[i] !== r) { const n = this.p[i]; this.p[i] = r; i = n; } return r; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[Math.max(a, b)] = Math.min(a, b); }
}

/** Builder entries ({ id, builder }) -> sources (the animated child builders of a model are part of it) */
export function sourcesFromBuilders(entries) {
  const out = [];
  const take = (id, b) => {
    const tris = []; for (const name of CHANNELS) { const p = b.ch?.[name]?.p; if (p) for (let i = 0; i < p.length; i++) tris.push(p[i]); }
    const bulbs = []; const arr = b.bulbs ?? []; for (let i = 0; i + 7 < arr.length; i += 8) bulbs.push(arr[i], arr[i + 1], arr[i + 2]);
    out.push({ id, tris: Float32Array.from(tris), bulbs: Float32Array.from(bulbs) }); for (const part of b.parts ?? []) if (!part.localFrame) take(id, part);          // single precision like the geometry on the GPU: a contact that holds only by rounding noise does not count
  };
  for (const e of entries) take(e.id ?? "builder", e.builder ?? e);
  return out;
}
/** a THREE group -> one source (call group.updateMatrixWorld(true) first): every Mesh's triangles through its world matrix, every `bulbs` Points as bulbs */
export function sourcesFromGroup(group, id = group.name || "group") {
  const tris = []; const bulbs = [];
  const apply = (e, x, y, z) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
  group.traverse((o) => {
    if (!o.geometry || o.visible === false) return; const pos = o.geometry.attributes?.position; if (!pos) return; const e = o.matrixWorld.elements; const idx = o.geometry.index;
    const get = (i) => apply(e, pos.getX(i), pos.getY(i), pos.getZ(i));
    if (o.isMesh) { const n = idx ? idx.count : pos.count; for (let i = 0; i + 2 < n; i += 3) for (let k = 0; k < 3; k++) tris.push(...get(idx ? idx.getX(i + k) : i + k)); }
    else if (o.isPoints && o.name === "bulbs") for (let i = 0; i < pos.count; i++) bulbs.push(...get(i));
  });
  return { id, tris, bulbs };
}

export function auditFloating(sources, { groundY = () => 0, label = e => e.id ?? "builder", step = STEP } = {}) {
  const builders = sources;
  const dsu = new DSU(); const vox = new Map();         // key -> { id, x, y, z (voxel centre), owner }
  const nbr = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) nbr.push([a, b, c]);
  let tris = 0; const own = [];
  const put = (x, y, z, owner) => {
    const i = Math.floor(x / VOX), j = Math.floor(y / VOX), k = Math.floor(z / VOX); const key = vkey(i, j, k);
    if (vox.has(key)) return;
    const id = dsu.add(); vox.set(key, { id, i, j, k, owner, y: y });
    for (const [a, b, c] of nbr) { const o = vox.get(vkey(i + a, j + b, k + c)); if (o) dsu.union(id, o.id); }
  };
  builders.forEach((entry, bi) => {
    own.push(entry); const p = entry.tris;
    for (let t = 0; t + 8 < p.length; t += 9) {
      tris++;
      const ax = p[t], ay = p[t + 1], az = p[t + 2], bx = p[t + 3], by = p[t + 4], bz = p[t + 5], cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
      const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
      const n = Math.max(1, Math.ceil(e / step));
      for (let u = 0; u <= n; u++) for (let v = 0; v + u <= n; v++) { const s = u / n, r = v / n, q = 1 - s - r; put(ax * q + bx * s + cx * r, ay * q + by * s + cy * r, az * q + bz * s + cz * r, bi); }
    }
  });
  // pieces: grounded? bbox
  const comp = new Map();
  for (const o of vox.values()) {
    const r = dsu.find(o.id); let c = comp.get(r);
    if (!c) { c = { grounded: false, n: 0, x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity, owner: o.owner }; comp.set(r, c); }
    const x = (o.i + 0.5) * VOX, y = (o.j + 0.5) * VOX, z = (o.k + 0.5) * VOX;
    c.n++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y); c.z0 = Math.min(c.z0, z); c.z1 = Math.max(c.z1, z);
    if (!c.grounded && o.y <= groundY(x, z) + GROUND_TOL) c.grounded = true;
  }
  const floating = [];
  for (const c of comp.values()) {
    if (c.grounded) continue;
    const sx = c.x1 - c.x0 + VOX, sy = c.y1 - c.y0 + VOX, sz = c.z1 - c.z0 + VOX; const lowest = c.y0 - VOX / 2 - groundY((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
    const kind = Math.max(sx, sz) > 3 && sy < 2 ? "a string / line" : c.n < 40 ? "a small object" : "an object";
    floating.push({ id: label(own[c.owner]), kind, voxels: c.n, bbox: { u: [+c.x0.toFixed(1), +c.x1.toFixed(1)], y: [+c.y0.toFixed(1), +c.y1.toFixed(1)], w: [+c.z0.toFixed(1), +c.z1.toFixed(1)] }, why: `${kind} (${sx.toFixed(1)} x ${sy.toFixed(1)} x ${sz.toFixed(1)} m) hangs in the air: its lowest point is ${lowest.toFixed(1)} m above the ground and nothing touches it that stands on the ground, at u ${((c.x0 + c.x1) / 2).toFixed(1)}, y ${((c.y0 + c.y1) / 2).toFixed(1)}, w ${((c.z0 + c.z1) / 2).toFixed(1)}` });
  }
  // bulbs
  const groundedVox = new Set(); for (const [key, o] of vox) if (comp.get(dsu.find(o.id)).grounded) groundedVox.add(key);
  const R = Math.ceil(BULB_REACH / VOX); const bulbs = []; let nb = 0;
  builders.forEach((entry) => {
    const arr = entry.bulbs ?? [];
    for (let t = 0; t + 2 < arr.length; t += 3) {
      nb++; const x = arr[t], y = arr[t + 1], z = arr[t + 2]; const ci = Math.floor(x / VOX), cj = Math.floor(y / VOX), ck = Math.floor(z / VOX); let ok = false;
      search: for (let a = -R; a <= R; a++) for (let b2 = -R; b2 <= R; b2++) for (let c = -R; c <= R; c++) if (groundedVox.has(vkey(ci + a, cj + b2, ck + c)) && Math.hypot(a, b2, c) * VOX <= BULB_REACH + VOX) { ok = true; break search; }
      if (!ok) bulbs.push({ id: label(entry), at: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], why: `a bulb at u ${x.toFixed(1)}, y ${y.toFixed(1)}, w ${z.toFixed(1)} has nothing standing on the ground within ${BULB_REACH} m (a halo without a fixture)` });
    }
  });
  return { floating, bulbs, stats: { builders: builders.length, triangles: tris, voxels: vox.size, pieces: comp.size, bulbs: nb } };
}
