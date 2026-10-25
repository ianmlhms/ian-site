/* Lokféierer: pooled, distance-LOD'ed, frustum-culled tree instances for every chunk / station patch.
 *   const field = TS.treeField.create({ parent, kit, quality, shadows });
 *   field.add(key, { oak: [{ x, y, z, rot, sc, sy?, tint }], spruce: [...], ... })    // per-chunk lists exactly as landscape.js builds them; sy = extra height factor
 *   field.remove(key);  field.update(camera, dt);  field.stats();  field.dispose();
 *
 * All trees of all chunks live in ONE instanced pool per (species, level of detail) = at most 6 x 3 draw calls for the whole forest (the old code made one
 * InstancedMesh per chunk and species, drawn again in the shadow pass).  Every few frames (camera moved / turned, chunk set changed) the instances are
 * re-sorted: the distance picks the LOD (near = rich crown with leaf cards, mid = smooth blobs, far = 12-30 triangles), instances outside the (widened) view
 * frustum are dropped (trees within the shadow range are kept so they still cast shadows into the view), and beyond THIN_FROM the forest is thinned out with
 * the surviving crowns scaled up (same canopy cover, fewer triangles).  Only lod0 / lod1 pools cast shadows (far trees never do). */
window.TS = window.TS || {};
(function (TS) {
  'use strict';
  const T = THREE;
  const STRIDE = 12;      // x y z rot sx sy sz r g b rnd radius
  const LEVELS = {
    //            lod0 (rich) , lod1 (smooth)  , thin from , thinned away to (share kept at the far end), shadow-keep
    high:   { l0: 48, l1: 175, thinFrom: 380, thinTo: 1000, keepFar: 0.42, shadowKeep: 100 },
    medium: { l0: 34, l1: 135, thinFrom: 300, thinTo: 800, keepFar: 0.36, shadowKeep: 78 },
    low:    { l0: 0, l1: 90, thinFrom: 220, thinTo: 600, keepFar: 0.3, shadowKeep: 0 },
  };
  const MOVE_EPS = 2.5, TURN_EPS = 0.02, MIN_DT = 0.08, FRUSTUM_WIDEN = 0.8;

  function create(opts) {
    const o = opts || {};
    const kit = o.kit, parent = o.parent;
    const lv = LEVELS[o.quality] || LEVELS.medium;
    const shadows = o.shadows !== false && o.quality !== 'low';
    const species = kit.species, index = {};
    species.forEach((sp, i) => { index[sp] = i; });
    const group = new T.Group(); group.name = 'tree-field';
    parent.add(group);
    const regs = new Map();                        // key -> [Float32Array per species]
    const totals = species.map(() => 0);
    const pools = species.map(() => [null, null, null]);   // [species][lod] -> { mesh, cap }
    const counts = species.map(() => [0, 0, 0]);
    const cam = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, t: 0, ok: false };
    let dirty = true, disposed = false, since = 1;
    const proj = new T.Matrix4(), view = new T.Matrix4(), pv = new T.Matrix4(), frustum = new T.Frustum(), sphere = new T.Sphere();
    const lastCamPos = new T.Vector3(1e9, 0, 0), camPos = new T.Vector3(), camDir = new T.Vector3(), lastDir = new T.Vector3();

    function ensurePool(si, lod, need) {
      const cur = pools[si][lod];
      if (cur && cur.cap >= need) return cur;
      if (cur) { group.remove(cur.mesh); cur.mesh.dispose(); }
      const cap = Math.max(64, Math.ceil(need * 1.25));
      const mesh = new T.InstancedMesh(kit.geos[species[si]][lod], kit.material, cap);
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.setColorAt(0, new T.Color(1, 1, 1));
      mesh.instanceColor.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;                   // culled per instance below
      mesh.castShadow = shadows && lod < 2 && !(kit.meta[species[si]] || {}).noShadow; mesh.receiveShadow = false;
      mesh.count = 0; mesh.visible = false;
      mesh.name = 'trees-' + species[si] + '-lod' + lod;
      group.add(mesh);
      const rec = { mesh, cap };
      pools[si][lod] = rec;
      return rec;
    }

    function add(key, lists) {
      if (disposed) return;
      remove(key);
      const per = species.map(() => null);
      let any = false;
      Object.keys(lists || {}).forEach((name) => {
        const si = index[name], list = lists[name];
        if (si === undefined || !list || !list.length) return;
        const a = new Float32Array(list.length * STRIDE);
        const metaR = kit.meta[name].r;
        list.forEach((t, i) => {
          const b = i * STRIDE, sc = t.sc === undefined ? 1 : t.sc, sy = t.sy === undefined ? sc : sc * t.sy;
          const rnd = kit.hash(t.x * 3.7 + i, t.z * 2.3 - t.y), h1 = kit.hash(t.z * 1.7, t.x * 0.9 + i), h2 = kit.hash(i * 5.1 + t.x, t.z * 4.4);
          const tint = t.tint || { r: 1, g: 1, b: 1 };
          // per-instance colour: lightness plus a small warm / cool shift, on top of the landscape's own tint
          const k = 0.88 + 0.24 * h1;
          a[b] = t.x; a[b + 1] = t.y; a[b + 2] = t.z; a[b + 3] = t.rot || 0;
          a[b + 4] = sc; a[b + 5] = sy; a[b + 6] = sc;
          a[b + 7] = tint.r * k * (0.95 + 0.1 * h2); a[b + 8] = tint.g * k; a[b + 9] = tint.b * k * (1.05 - 0.1 * h2);
          a[b + 10] = rnd; a[b + 11] = metaR * Math.max(sc, 0.2) * 1.15;
        });
        per[si] = a; totals[si] += list.length; any = true;
      });
      if (any) { regs.set(key, per); dirty = true; }
    }
    function remove(key) {
      const per = regs.get(key); if (!per) return;
      per.forEach((a, si) => { if (a) totals[si] -= a.length / STRIDE; });
      regs.delete(key); dirty = true;
    }

    function partition(camera) {
      // frustum, widened so a quick turn between two partitions does not show gaps
      let haveFrustum = false;
      if (camera && camera.projectionMatrix && camera.matrixWorld) {
        proj.copy(camera.projectionMatrix); proj.elements[0] *= FRUSTUM_WIDEN; proj.elements[5] *= FRUSTUM_WIDEN;
        view.copy(camera.matrixWorld).invert(); pv.multiplyMatrices(proj, view); frustum.setFromProjectionMatrix(pv); haveFrustum = true;
      }
      const planes = frustum.planes, cx = camPos.x, cy = camPos.y, cz = camPos.z;
      const skeep = lv.shadowKeep, skeeps = skeep * skeep, rscale = lv.l1 / LEVELS.high.l1;
      const thinSpan = lv.thinTo - lv.thinFrom;
      const n = species.length;
      const out = new Array(n);
      for (let si = 0; si < n; si++) {
        const pool3 = [ensurePool(si, 0, totals[si]), ensurePool(si, 1, totals[si]), ensurePool(si, 2, totals[si])];
        out[si] = pool3.map((p) => ({ m: p.mesh.instanceMatrix.array, c: p.mesh.instanceColor.array, n: 0 }));
      }
      const meta = kit.meta, names = species;
      regs.forEach((per) => {
        for (let si = 0; si < n; si++) {
          const a = per[si]; if (!a) continue;
          const cnt = a.length / STRIDE, o3 = out[si], mt = meta[names[si]], hMid = mt.h * 0.5;
          const l0s = mt.range ? Math.pow(mt.range[0] * rscale, 2) : lv.l0 * lv.l0, l1v = mt.range ? mt.range[1] * rscale : lv.l1, l1s = l1v * l1v, cutFar = !!mt.range;
          for (let i = 0; i < cnt; i++) {
            const b = i * STRIDE, dx = a[b] - cx, dy = a[b + 1] - cy, dz = a[b + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
            let lod = d2 < l0s ? 0 : d2 < l1s ? 1 : 2, mul = 1;
            if (lod === 2 && cutFar) continue;
            if (lod === 2) {
              const d = Math.sqrt(d2);
              if (d > lv.thinFrom) {
                const t = Math.min(1, (d - lv.thinFrom) / thinSpan), keep = 1 - (1 - lv.keepFar) * t * t * (3 - 2 * t);
                if (a[b + 10] > keep) continue;
                mul = 1 / Math.sqrt(keep);
              }
            }
            // frustum (trees that can still shadow the view are kept)
            if (haveFrustum && !(shadows && d2 < skeeps)) {
              const r = a[b + 11] * mul, py = a[b + 1] + hMid * a[b + 5];
              let out1 = false;
              for (let p = 0; p < 6; p++) { const pl = planes[p].normal; if (pl.x * a[b] + pl.y * py + pl.z * a[b + 2] + planes[p].constant < -r) { out1 = true; break; } }
              if (out1) continue;
            }
            const o1 = o3[lod], k = o1.n++, m = o1.m, o16 = k * 16, c = Math.cos(a[b + 3]), s = Math.sin(a[b + 3]);
            const sx = a[b + 4] * mul, sy = a[b + 5] * mul, sz = a[b + 6] * mul;
            m[o16] = c * sx; m[o16 + 1] = 0; m[o16 + 2] = -s * sx; m[o16 + 3] = 0;
            m[o16 + 4] = 0; m[o16 + 5] = sy; m[o16 + 6] = 0; m[o16 + 7] = 0;
            m[o16 + 8] = s * sz; m[o16 + 9] = 0; m[o16 + 10] = c * sz; m[o16 + 11] = 0;
            m[o16 + 12] = a[b]; m[o16 + 13] = a[b + 1]; m[o16 + 14] = a[b + 2]; m[o16 + 15] = 1;
            const o3c = k * 3; o1.c[o3c] = a[b + 7]; o1.c[o3c + 1] = a[b + 8]; o1.c[o3c + 2] = a[b + 9];
          }
        }
      });
      for (let si = 0; si < n; si++) for (let lod = 0; lod < 3; lod++) {
        const p = pools[si][lod], cnt = out[si][lod].n; counts[si][lod] = cnt;
        p.mesh.count = cnt; p.mesh.visible = cnt > 0;
        const im = p.mesh.instanceMatrix, ic = p.mesh.instanceColor;
        if (im.clearUpdateRanges) { im.clearUpdateRanges(); im.addUpdateRange(0, Math.max(1, cnt * 16)); ic.clearUpdateRanges(); ic.addUpdateRange(0, Math.max(1, cnt * 3)); }
        im.needsUpdate = true; ic.needsUpdate = true;
      }
    }

    function update(camera, dt) {
      if (disposed) return;
      since += dt === undefined ? 0.016 : dt;
      if (camera && camera.getWorldPosition) { camera.getWorldPosition(camPos); camera.getWorldDirection(camDir); }
      else if (!cam.ok) return;
      const moved = camPos.distanceToSquared(lastCamPos) > MOVE_EPS * MOVE_EPS, turned = lastDir.distanceToSquared(camDir) > TURN_EPS * TURN_EPS;
      if (!dirty && !(moved || turned)) return;
      if (!dirty && since < MIN_DT) return;
      partition(camera);
      lastCamPos.copy(camPos); lastDir.copy(camDir); cam.ok = true; dirty = false; since = 0;
    }
    /* repartition now (tests, screenshots after a camera jump) */
    function refresh(camera) { dirty = true; since = 1; update(camera, 0); }
    function stats() {
      let tris = 0, inst = 0, draws = 0; const lods = [0, 0, 0];
      species.forEach((sp, si) => [0, 1, 2].forEach((lod) => { const n = counts[si][lod]; if (!n) return; draws++; inst += n; lods[lod] += n; tris += n * kit.geos[sp][lod].index.count / 3; }));
      return { instances: inst, triangles: Math.round(tris), draws, lods, registered: totals.reduce((a, b) => a + b, 0) };
    }
    function dispose() {
      if (disposed) return; disposed = true;
      pools.forEach((row) => row.forEach((p) => { if (p) { group.remove(p.mesh); p.mesh.dispose(); } }));
      parent.remove(group); regs.clear();
    }
    return { add, remove, update, refresh, stats, dispose, has: (name) => index[name] !== undefined, group, levels: lv, meta: kit.meta };
  }

  TS.treeField = Object.freeze({ create, LEVELS });
})(window.TS);
