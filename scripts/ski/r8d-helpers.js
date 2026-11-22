/* R8d: extra page helpers for scripts/ski/r8c-drv.mjs (send after r8c-helpers.js as an /eval body).
 *   window.__r8d.meshes()  triangles + draw calls per drawn mesh name (one render per visible mesh hidden; names grouped by prefix) */
window.__r8d = {
  meshes(minTris = 3000) {
    const S = window.__ski, R = S.renderer, sc = S.scene, cam = S.camera;
    const draw = () => { R.info.reset(); R.render(sc, cam); return [R.info.render.triangles, R.info.render.calls]; };
    const [all, calls] = draw();
    const list = [];
    sc.traverse((o) => { if ((o.isMesh || o.isInstancedMesh || o.isLine || o.isPoints) && o.visible) list.push(o); });
    const out = {};
    for (const o of list) {
      let vis = true;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (!vis) continue;
      o.visible = false; const [t, c] = draw(); o.visible = true;
      const k = (o.name || o.type).replace(/[-_]?\d+(,\d+)?$/, '').replace(/-\d+,-?\d+$/, '');
      if (!out[k]) out[k] = { tris: 0, calls: 0, n: 0 };
      out[k].tris += all - t; out[k].calls += calls - c; out[k].n++;
    }
    const rows = Object.entries(out).filter(([, v]) => v.tris >= minTris || v.calls >= 3).sort((a, b) => b[1].tris - a[1].tris);
    return { all, calls, rows: rows.map(([k, v]) => `${k}: ${Math.round(v.tris / 1000)}k / ${v.calls} calls (${v.n})`) };
  },
};
return 'ok';
