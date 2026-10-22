/* Schueberfouer Tycoon, W2: the three hand-modelled Luxtram landmarks around the Glacis (Grand Theatre, Institut national des langues /
 * Fondation Pescatore, Pont Grande-Duchesse Charlotte = the Red Bridge), loaded as the plain geometry baked by scripts/bake_fouer_landmarks.mjs.
 * One shared 128 px-per-cell atlas (day + lit), one draw call per landmark.  night(k) drives the lit windows / the gold glow. */
async function decodeImage(bytes, mime = 'image/webp') {
  const blob = new Blob([bytes], { type: mime });
  const draw = (img, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0); return c; };
  if (typeof createImageBitmap === 'function') {
    try { const bm = await createImageBitmap(blob, { colorSpaceConversion: 'none' }); const c = draw(bm, bm.width, bm.height); if (bm.close) bm.close(); return c; } catch (e) { /* fall back to <img> */ }
  }
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => { res(draw(im, im.naturalWidth, im.naturalHeight)); URL.revokeObjectURL(im.src); }; im.onerror = rej; im.src = URL.createObjectURL(blob); });
}

export async function createLandmarks({ T, bundle, oy }) {
  const H = bundle.header;
  const [dayC, litC] = await Promise.all([decodeImage(bundle.view(H.atlas.day)), decodeImage(bundle.view(H.atlas.lit))]);
  const tex = (c) => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return t; };
  const day = tex(dayC); const lit = tex(litC);
  const mat = new T.MeshLambertMaterial({ vertexColors: true, map: day, emissive: new T.Color('#ffd496'), emissiveMap: lit, emissiveIntensity: 0, side: T.DoubleSide });
  const group = new T.Group(); group.name = 'fouer-landmarks';
  const byKey = {};
  let tris = 0;
  H.landmarks.forEach((lm) => {
    const g = new T.Group(); g.name = 'lm-' + lm.key;
    g.position.set(lm.x, lm.y - oy, lm.z);
    lm.parts.forEach((pt) => {
      const n = pt.n;
      const P = bundle.view(pt.P); const N = bundle.view(pt.N); const UV = bundle.view(pt.UV); const C = bundle.view(pt.C); const I = bundle.view(pt.I);
      const dv = (v) => new DataView(v.buffer, v.byteOffset, v.byteLength);
      const pd = dv(P); const ud = dv(UV);
      const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); const uv = new Float32Array(n * 2); const col = new Float32Array(n * 3);
      const k = pt.half / 32767;
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 3; a++) {
          pos[i * 3 + a] = pd.getInt16((i * 3 + a) * 2, true) * k + pt.ctr[a];
          nor[i * 3 + a] = ((N[i * 3 + a] << 24) >> 24) / 127;
          col[i * 3 + a] = C[i * 3 + a] / 255;
        }
        uv[i * 2] = ud.getUint16(i * 4, true) / 65535; uv[i * 2 + 1] = ud.getUint16(i * 4 + 2, true) / 65535;
      }
      const ni = pt.tris * 3; const idv = dv(I);
      const idx = pt.i32 ? new Uint32Array(ni) : new Uint16Array(ni);
      for (let i = 0; i < ni; i++) idx[i] = pt.i32 ? idv.getUint32(i * 4, true) : idv.getUint16(i * 2, true);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, mat); mesh.name = 'lm-' + lm.key + '-mesh';
      g.add(mesh); tris += pt.tris;
    });
    group.add(g); byKey[lm.key] = g;
  });
  return {
    group, byKey, material: mat, triangles: tris,
    setNight(k) { mat.emissiveIntensity = Math.max(0, Math.min(1, k)) * 1.15; },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); day.dispose(); lit.dispose(); },
  };
}
