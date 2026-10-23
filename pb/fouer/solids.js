/* Schueberfouer Tycoon, feedback A: collision that equals the visible geometry (pure, no THREE, no DOM; harness.js tests it with plain objects).
 *
 * Why: the walk used to collide with whole pitch rectangles (every built / locked pitch was a solid box 16 x 16 m or 30 x 18 m), so a tent, a seating
 * terrace or a stall forecourt was an invisible wall.  The solids are now read from what is drawn: every mesh of a pitch model (and of the merged base
 * layer: NPC stalls, props, clutter) is rasterised on the ground plane (0.1 m cells), counting only the part of a surface that a body would hit,
 *
 *     BODY.low (0.8 m, hip) .. BODY.high (1.75 m, head):  a counter, a wall, a ride body, a rail post, a table top, a lamp post block;
 *     below 0.8 m (platforms, kerbs, benches, floor plates, hoses) is stepped over, above 1.75 m (awnings, signs, roofs, bunting, coaster track) is walked under.
 *
 * and the cells are merged into axis-aligned boxes (0.2 m cells, so a box is at most 0.1 m larger than the geometry, the rule is +-0.3 m).  Because the boxes
 * come from the meshes, a free gap in the picture is a free gap in the mask (no invisible walls), tents with an open front are walk-in, seating areas are
 * open between their tables, the walkable platform of a ride (below 0.8 m) is open, and a locked / NPC stall is solid exactly where its box is.
 * Nothing is tabulated, so a model that changes (new stalls, a rebuilt ride) changes its solids with it; the harness and flow `fouer-walk` check the other
 * direction too (`maskVsVisible`: a blocked cell with no visible solid within 0.3 m fails).
 *
 * Frame: x = u, z = w, y up (model local: origin on the pitch centre, +z = the front of the pitch). */

export const BODY = Object.freeze({ low: 0.8, high: 1.75, cell: 0.1, coarse: 2, tolerance: 0.3 });
export const FACE_YAW = Object.freeze({ "+w": 0, "-w": Math.PI, "+u": Math.PI / 2, "-u": -Math.PI / 2 });
const MAX_SAMPLE_CELLS = 1.2e7;

/* ------------------------------------------------------------------------------------------------ raster */
/** a ground raster: `data[j * nu + i]` = 1 when the cell [u0 + i * cell, ...) x [w0 + j * cell, ...) holds a solid */
export function createRaster({ u0, u1, w0, w1 }, cell = BODY.cell) {
  const nu = Math.max(1, Math.ceil((u1 - u0) / cell)), nw = Math.max(1, Math.ceil((w1 - w0) / cell));
  if (nu * nw > MAX_SAMPLE_CELLS) throw new RangeError(`raster too large: ${nu} x ${nw}`);
  return { u0, w0, cell, nu, nw, data: new Uint8Array(nu * nw) };
}
const cellOf = (r, x, z) => ((z - r.w0) / r.cell | 0) * r.nu + ((x - r.u0) / r.cell | 0);

function mark(r, x, z) {
  const i = Math.floor((x - r.u0) / r.cell), j = Math.floor((z - r.w0) / r.cell);
  if (i >= 0 && i < r.nu && j >= 0 && j < r.nw) r.data[j * r.nu + i] = 1;
}
function markSegment(r, ax, az, bx, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (r.cell * 0.5)));
  for (let k = 0; k <= n; k++) { const t = k / n; mark(r, ax + (bx - ax) * t, az + (bz - az) * t); }
}
const poly = new Float64Array(24);        // clip buffers: up to 5 vertices x (x, y, z), two of them
const polyB = new Float64Array(24);

/** clip the polygon in `src` (n vertices, x y z) against y >= lo (keep = +1) or y <= hi (keep = -1): returns the new vertex count (written to `dst`) */
function clipY(src, n, dst, level, keep) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 3, b = ((i + 1) % n) * 3;
    const da = keep * (src[a + 1] - level), db = keep * (src[b + 1] - level);
    if (da >= 0) { dst[m * 3] = src[a]; dst[m * 3 + 1] = src[a + 1]; dst[m * 3 + 2] = src[a + 2]; m++; }
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      dst[m * 3] = src[a] + (src[b] - src[a]) * t; dst[m * 3 + 1] = level; dst[m * 3 + 2] = src[a + 2] + (src[b + 2] - src[a + 2]) * t; m++;
    }
  }
  return m;
}

/** rasterise one triangle (world / game coordinates, x = u, y up, z = w): the part between `lo` and `hi` metres is projected on the ground */
export function rasterTriangle(r, ax, ay, az, bx, by, bz, cx, cy, cz, lo = BODY.low, hi = BODY.high) {
  const ymin = Math.min(ay, by, cy), ymax = Math.max(ay, by, cy);
  if (ymax < lo || ymin > hi) return;
  poly[0] = ax; poly[1] = ay; poly[2] = az; poly[3] = bx; poly[4] = by; poly[5] = bz; poly[6] = cx; poly[7] = cy; poly[8] = cz;
  let n = 3, src = poly;
  if (ymin < lo) { n = clipY(src, n, polyB, lo, 1); src = polyB; }
  if (ymax > hi && n >= 3) { const dst = src === poly ? polyB : poly; n = clipY(src, n, dst, hi, -1); src = dst; }
  if (n < 2) return;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) { const x = src[i * 3], z = src[i * 3 + 2]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  if (maxX < r.u0 || minX > r.u0 + r.nu * r.cell || maxZ < r.w0 || minZ > r.w0 + r.nw * r.cell) return;
  for (let i = 0; i < n; i++) { const a = i * 3, b = ((i + 1) % n) * 3; markSegment(r, src[a], src[a + 2], src[b], src[b + 2]); }       // outline (walls are lines in plan)
  if (n < 3 || (maxX - minX) < r.cell * 0.5 || (maxZ - minZ) < r.cell * 0.5) return;
  // interior: cell centres inside the (convex) polygon
  const i0 = Math.max(0, Math.floor((minX - r.u0) / r.cell)), i1 = Math.min(r.nu - 1, Math.floor((maxX - r.u0) / r.cell));
  const j0 = Math.max(0, Math.floor((minZ - r.w0) / r.cell)), j1 = Math.min(r.nw - 1, Math.floor((maxZ - r.w0) / r.cell));
  let sign = 0;
  for (let i = 0; i < n && !sign; i++) {            // winding sign from the first non-degenerate corner
    const a = i * 3, b = ((i + 1) % n) * 3, c = ((i + 2) % n) * 3;
    const cr = (src[b] - src[a]) * (src[c + 2] - src[b + 2]) - (src[b + 2] - src[a + 2]) * (src[c] - src[b]);
    if (Math.abs(cr) > 1e-9) sign = cr > 0 ? 1 : -1;
  }
  if (!sign) return;
  for (let j = j0; j <= j1; j++) {
    const z = r.w0 + (j + 0.5) * r.cell;
    for (let i = i0; i <= i1; i++) {
      const x = r.u0 + (i + 0.5) * r.cell;
      let inside = true;
      for (let k = 0; k < n; k++) {
        const a = k * 3, b = ((k + 1) % n) * 3;
        if (((src[b] - src[a]) * (z - src[a + 2]) - (src[b + 2] - src[a + 2]) * (x - src[a])) * sign < 0) { inside = false; break; }
      }
      if (inside) r.data[j * r.nu + i] = 1;
    }
  }
}

/* ------------------------------------------------------------------------------------------------ meshes */
const IDENT = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** a * b for column-major 4x4 arrays (THREE's Matrix4.elements layout) */
export function mulMat(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let rI = 0; rI < 4; rI++) {
    o[c * 4 + rI] = a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
  }
  return o;
}
/** the matrix that takes model-local coordinates of a pitch to game coordinates (u, y, w): rotation about y for the face, then the pitch centre */
export function pitchMatrix(rect, face) {
  const yaw = FACE_YAW[face] ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, rect.u, 0, rect.w, 1];
}
/** local -> game coordinates of one point (a box corner, a spot in front of the stall ...) */
export function placePoint(rect, face, x, z) {
  const yaw = FACE_YAW[face] ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return { u: rect.u + x * c + z * s, w: rect.w - x * s + z * c };
}

/** does a mesh take part in collision?  Not: points / lines / sprites, glass and glow (transparent), additive halos, explicit `userData.noCollide`.
 * `obj.visible` is NOT read: the fair layer hides the static children of a live ride (they are drawn by the merged batch instead) and flips that with the camera, so a hidden mesh
 * can be the very thing that is on screen.  (A mesh whose material is invisible or that writes no colour is skipped.) */
export function collides(obj) {
  if (!obj.isMesh || !obj.geometry || (obj.userData && obj.userData.noCollide)) return false;
  const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (m) {
    if (m.colorWrite === false || m.visible === false) return false;
    if (m.blending === 2) return false;                                  // THREE.AdditiveBlending: light cones, halos, sparkles
    if (m.transparent && typeof m.opacity === "number" && m.opacity < 0.7) return false;
  }
  return true;
}

/** the triangles of every colliding mesh below `root`, calling `emit(ax, ay, az, bx, by, bz, cx, cy, cz)` in the frame `base` * (child chain) (the root's own matrix is included).
 * Uses each object's local `matrix` (call root.updateMatrixWorld(true) first when it is in a scene graph), so a model that is detached from its holder (far LOD) works too. */
/** names of moving things in the model kits: `part:*` (small rides: rotor, boats, seats), `<id>-cars|rotor|gondolas|crown|seats|arm|ring|pod|cables|stays|boats-near|far` (big rides: their meshes carry a rest
 * pose that is not what the vertex animation draws), and the `far` LOD group (a coarser copy of `near`) */
const MOVING = /^part:|-(cars?|rotor|gondolas?|crown|seats?|arm|ring|pod|cables|stays|boats)(-|$)|^far$/;
export const isMovingName = name => Boolean(name) && MOVING.test(name);
export function eachTriangle(root, base, emit, skipParts = true) {
  const stack = [[root, base ?? IDENT]];
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  while (stack.length) {
    const [obj, parentM] = stack.pop();
    if (skipParts && isMovingName(obj.name)) continue;       // the moving parts of a ride (cars, arms, gondolas): not solid, a frozen pose would be an invisible wall where a car once was
    const m = obj.matrix && obj.matrix.elements ? mulMat(parentM, obj.matrix.elements) : parentM;
    if (collides(obj)) {
      const pos = obj.geometry.attributes && obj.geometry.attributes.position;
      if (pos) {
        const index = obj.geometry.index ? obj.geometry.index.array : null;
        const count = index ? index.length : pos.count;
        const arr = pos.isInterleavedBufferAttribute ? null : pos.array, size = pos.itemSize || 3;
        const get = (k, o) => { const a = arr ? arr[k * size + o] : (o === 0 ? pos.getX(k) : o === 1 ? pos.getY(k) : pos.getZ(k)); return a; };
        for (let t = 0; t + 2 < count; t += 3) {
          for (let c = 0; c < 3; c++) {
            const k = index ? index[t + c] : t + c, x = get(k, 0), y = get(k, 1), z = get(k, 2);
            v[c * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]; v[c * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; v[c * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          }
          emit(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
        }
      }
    }
    const kids = obj.children;
    if (kids) for (let i = 0; i < kids.length; i++) stack.push([kids[i], m]);
  }
}

/** rasterise a model into `r` (default heights) */
export function rasterObject(r, root, base, lo = BODY.low, hi = BODY.high, skipParts = true) {
  eachTriangle(root, base, (ax, ay, az, bx, by, bz, cx, cy, cz) => rasterTriangle(r, ax, ay, az, bx, by, bz, cx, cy, cz, lo, hi), skipParts);
  return r;
}

/* ------------------------------------------------------------------------------------------------ raster -> boxes */
/** merge the solid cells into boxes { u0, u1, w0, w1 }: `coarse` cells are one (a cell is solid when any sub-cell is), then equal runs of consecutive rows join */
export function rasterToBoxes(r, coarse = BODY.coarse) {
  const cs = r.cell * coarse, cu = Math.ceil(r.nu / coarse), cw = Math.ceil(r.nw / coarse);
  const out = [];
  let active = new Map();                    // "i0,i1" -> box being extended
  for (let j = 0; j <= cw; j++) {
    const next = new Map();
    if (j < cw) {
      let run = -1;
      const flush = end => {
        if (run < 0) return;
        const key = run + "," + end, prev = active.get(key);
        if (prev) { prev.w1 = r.w0 + (j + 1) * cs; next.set(key, prev); active.delete(key); }
        else { const b = { u0: r.u0 + run * cs, u1: r.u0 + end * cs, w0: r.w0 + j * cs, w1: r.w0 + (j + 1) * cs }; out.push(b); next.set(key, b); }
        run = -1;
      };
      for (let i = 0; i < cu; i++) {
        let solid = false;
        for (let dj = 0; dj < coarse && !solid; dj++) {
          const jj = j * coarse + dj; if (jj >= r.nw) break;
          for (let di = 0; di < coarse; di++) { const ii = i * coarse + di; if (ii >= r.nu) break; if (r.data[jj * r.nu + ii]) { solid = true; break; } }
        }
        if (solid) { if (run < 0) run = i; } else flush(i);
      }
      flush(cu);
    }
    active = next;
  }
  return out;
}

/** boxes of one pitch model in game coordinates.  `near` = the model group (THREE.Group), `rect` = { u, w, du, dw }, `face` = "+w" ...
 * The model's own matrix chain is used, the raster covers the pitch plus `pad` metres (models may overhang a little).
 * A model that animates (`userData.animate(t, dt, night)`) is rasterised in three poses and only what is solid in ALL of them counts: the static body of a ride (frame, fence, station) stays,
 * the moving cars / arms / gondolas do not (a frozen pose would be an invisible wall where a bumper car once was).  The pose is put back to t = 0 afterwards. */
export function derivePitchBoxes(near, rect, face, { pad = 6, lo = BODY.low, hi = BODY.high, poses = 3 } = {}) {
  if (!near) return [];
  if (near.updateMatrixWorld) near.updateMatrixWorld(true);
  const m = pitchMatrix(rect, face);
  const half = Math.max(rect.du, rect.dw) / 2 + pad;
  const bounds = { u0: rect.u - half, u1: rect.u + half, w0: rect.w - half, w1: rect.w + half };
  const r = createRaster(bounds);
  rasterObject(r, near, m, lo, hi);
  const ud = near.userData, animate = ud && typeof ud.animate === "function" ? ud.animate : null;
  if (animate && poses > 1) {
    const cycle = Math.max(4, Number(ud.cycle) || 24);
    const wasAnimated = ud.animated;
    try {
      if (typeof ud.setAnimated === "function" && wasAnimated === false) ud.setAnimated(true);       // a model that is not animated right now ignores animate()
      for (let k = 1; k < poses; k++) {
        animate.call(ud, cycle * (0.41 + 0.32 * (k - 1)), 0, 0);
        near.updateMatrixWorld(true);
        const other = createRaster(bounds);
        rasterObject(other, near, m, lo, hi);
        for (let i = 0; i < r.data.length; i++) r.data[i] &= other.data[i];
      }
    } catch (error) { /* a model whose animate cannot be called out of turn keeps its rest pose */ }
    finally { try { animate.call(ud, 0, 0, 0); near.updateMatrixWorld(true); if (typeof ud.setAnimated === "function" && wasAnimated === false) ud.setAnimated(false); } catch (error) { /* ignore */ } }
  }
  return rasterToBoxes(r);
}

/** boxes of a world-space layer (the merged base batch: NPC stalls, props, clutter) inside `bounds`; `roots` = one object or a list */
export function deriveLayerBoxes(roots, bounds, { lo = BODY.low, hi = BODY.high } = {}) {
  const r = createRaster(bounds);
  for (const root of Array.isArray(roots) ? roots : [roots]) { if (root.updateMatrixWorld) root.updateMatrixWorld(true); rasterObject(r, root, IDENT, lo, hi); }
  return rasterToBoxes(r);
}

/* ------------------------------------------------------------------------------------------------ checks */
/** the other direction: compare a mask with the visible solids (both as raster / box lists in game metres).  `isBlocked(x, z)` answers "is a point inside a solid of the mask"
 * (walk.js mask.solidAt).  Returns blocked cells without a visible solid within `tol` (invisible walls) and visible-solid cells the mask lets through (walk-through). */
export function maskVsVisible({ visible, isBlocked, region = null, step = 0.25, tol = BODY.tolerance }) {
  const invisible = [], through = [];
  const nearSolid = (x, z) => {
    const n = Math.ceil(tol / visible.cell);
    const i0 = Math.floor((x - visible.u0) / visible.cell), j0 = Math.floor((z - visible.w0) / visible.cell);
    for (let dj = -n; dj <= n; dj++) {
      const j = j0 + dj; if (j < 0 || j >= visible.nw) continue;
      for (let di = -n; di <= n; di++) { const i = i0 + di; if (i >= 0 && i < visible.nu && visible.data[j * visible.nu + i]) return true; }
    }
    return false;
  };
  const anySolid = (x, z) => {        // any visible sub-cell inside the sampling cell around (x, z)
    const i0 = Math.max(0, Math.floor((x - step / 2 - visible.u0) / visible.cell)), i1 = Math.min(visible.nu - 1, Math.floor((x + step / 2 - visible.u0) / visible.cell));
    const j0 = Math.max(0, Math.floor((z - step / 2 - visible.w0) / visible.cell)), j1 = Math.min(visible.nw - 1, Math.floor((z + step / 2 - visible.w0) / visible.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (visible.data[j * visible.nu + i]) return true;
    return false;
  };
  let blockedCells = 0, solidCells = 0;
  const x1 = visible.u0 + visible.nu * visible.cell, z1 = visible.w0 + visible.nw * visible.cell;
  for (let z = visible.w0 + step / 2; z < z1; z += step) {
    for (let x = visible.u0 + step / 2; x < x1; x += step) {
      if (region && !region(x, z)) continue;
      const blocked = isBlocked(x, z);
      if (blocked) { blockedCells++; if (!nearSolid(x, z)) invisible.push({ x, z }); }
      if (anySolid(x, z)) {
        solidCells++;
        if (!blocked && !isBlockedNear(isBlocked, x, z, tol, step)) through.push({ x, z });
      }
    }
  }
  return { invisible, through, blockedCells, solidCells };
}
function isBlockedNear(isBlocked, x, z, tol, step) {
  for (let dz = -tol; dz <= tol + 1e-9; dz += step) for (let dx = -tol; dx <= tol + 1e-9; dx += step) if (isBlocked(x + dx, z + dz)) return true;
  return false;
}

/** the raster grown by `radius` metres in every direction (a square, so it is a little generous: a cell that is still empty has at least `radius` clearance) */
export function dilate(r, radius) {
  const n = Math.ceil(radius / r.cell), out = { ...r, data: new Uint8Array(r.data.length) }, tmp = new Uint8Array(r.data.length);
  for (let j = 0; j < r.nw; j++) {                       // along u
    let last = -1e9;
    const row = j * r.nu;
    for (let i = 0; i < r.nu; i++) { if (r.data[row + i]) last = i; if (i - last <= n) tmp[row + i] = 1; }
    last = 1e9;
    for (let i = r.nu - 1; i >= 0; i--) { if (r.data[row + i]) last = i; if (last - i <= n) tmp[row + i] = 1; }
  }
  for (let i = 0; i < r.nu; i++) {                       // along w
    let last = -1e9;
    for (let j = 0; j < r.nw; j++) { if (tmp[j * r.nu + i]) last = j; if (j - last <= n) out.data[j * r.nu + i] = 1; }
    last = 1e9;
    for (let j = r.nw - 1; j >= 0; j--) { if (tmp[j * r.nu + i]) last = j; if (last - j <= n) out.data[j * r.nu + i] = 1; }
  }
  return out;
}

/** "no blocked gap that looks open": every point with at least `clearance` metres to the nearest visible solid (so a gap of 2 x clearance = 1.2 m between two solids) must be walkable.
 * Returns the points that are not: [{ x, z }].  `isAllowed(x, z)` = mask.allowed, `region(x, z)` limits it to the fair ground. */
export function blockedOpenGaps({ visible, isAllowed, region = null, clearance = 0.6, step = 0.25 }) {
  const grown = dilate(visible, clearance), out = [];
  const x1 = visible.u0 + visible.nu * visible.cell, z1 = visible.w0 + visible.nw * visible.cell;
  for (let z = visible.w0 + clearance; z < z1 - clearance; z += step) {
    for (let x = visible.u0 + clearance; x < x1 - clearance; x += step) {
      if (grown.data[cellOf(grown, x, z)]) continue;
      if (region && !region(x, z)) continue;
      if (!isAllowed(x, z)) out.push({ x, z });
    }
  }
  return out;
}

/** group nearby points into clusters (4-neighbourhood on the sampling grid) so a report names an area, not 4000 cells: [{ cells, u0, u1, w0, w1 }] biggest first */
export function clusterPoints(points, step = 0.25) {
  const key = (x, z) => Math.round(x / step) + "," + Math.round(z / step);
  const seen = new Map(points.map(p => [key(p.x, p.z), p]));
  const clusters = [];
  for (const [k, p] of seen) {
    if (p === null) continue;
    const stack = [p]; seen.set(k, null);
    const c = { cells: 0, u0: p.x, u1: p.x, w0: p.z, w1: p.z };
    while (stack.length) {
      const q = stack.pop(); c.cells++; c.u0 = Math.min(c.u0, q.x); c.u1 = Math.max(c.u1, q.x); c.w0 = Math.min(c.w0, q.z); c.w1 = Math.max(c.w1, q.z);
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, step], [step, -step], [-step, -step]]) {
        const kk = key(q.x + dx, q.z + dz), n = seen.get(kk);
        if (n) { seen.set(kk, null); stack.push(n); }
      }
    }
    clusters.push(c);
  }
  return clusters.sort((a, b) => b.cells - a.cells);
}

/** A passable gap check on a plain box list: is a walker of `radius` able to get from a to b along the straight line (stepped every 0.1 m)?  Used by the harness. */
export function boxesBlock(boxes, x, z, r) {
  for (const b of boxes) {
    const px = Math.max(b.u0, Math.min(b.u1, x)), pz = Math.max(b.w0, Math.min(b.w1, z));
    if ((x - px) ** 2 + (z - pz) ** 2 < r * r) return true;
  }
  return false;
}
