/* Shared procedural art. All texture canvases are generated once per session. */
window.PX = window.PX || {};
(function (P) {
  'use strict';
  const T = THREE, textures = new Map(), materials = new Map();
  let seed = 71283;
  P.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  P.texture = function (kind) {
    if (textures.has(kind)) return textures.get(kind);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const colors = { plaster: '#eeeeea', brick: '#b48e78', slate: '#65707a', asphalt: '#515758', paving: '#c0bdb2', grass: '#7a9368' };
    g.fillStyle = colors[kind]; g.fillRect(0, 0, 256, 256);
    if (kind === 'office') {
      const reflection = g.createLinearGradient(0,0,0,256); reflection.addColorStop(0,'#c9e2eb'); reflection.addColorStop(.42,'#92b9cb'); reflection.addColorStop(1,'#476f86'); g.fillStyle = reflection; g.fillRect(0,0,256,256);
      g.fillStyle = '#effaff27'; g.beginPath(); g.moveTo(0,15); g.lineTo(256,90); g.lineTo(256,139); g.lineTo(0,64); g.fill();
      g.strokeStyle = '#c1d0d0'; g.lineWidth = 2;
      for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,256); g.stroke(); }
      g.strokeRect(0,0,256,256);
    } else if (kind === 'brick') {
      g.fillStyle = '#cebaa4'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 16) for (let x = -32; x < 256; x += 64) {
        const a = x + (y % 32 ? 32 : 0);
        g.fillStyle = `hsl(19,${22 + P.random() * 15}%,${43 + P.random() * 16}%)`;
        g.fillRect(a + 1, y + 1, 61, 13);
        g.fillStyle = '#ffffff12'; g.fillRect(a + 2, y + 2, 59, 1);
      }
    } else if (kind === 'slate') {
      for (let y = 0; y < 256; y += 32) for (let x = -32; x < 256; x += 64) {
        g.fillStyle = `hsl(211,9%,${28 + P.random() * 13}%)`;
        g.fillRect(x + (y % 64 ? 32 : 0) + 1, y + 1, 62, 30);
        g.fillStyle = '#c2cbd522'; g.fillRect(x + (y % 64 ? 32 : 0) + 1, y + 1, 62, 2);
      }
    } else if (kind === 'paving') {
      g.strokeStyle = '#8c8b811'; g.lineWidth = 2;
      g.strokeStyle = '#8c8b81';
      for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      for (let y = 0; y < 256; y += 64) for (let x = y % 128 ? 64 : 0; x <= 256; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); }
    }
    const count = kind === 'office' ? 0 : kind === 'asphalt' || kind === 'grass' ? 23000 : 9500;
    for (let n = 0; n < count; n++) {
      g.fillStyle = P.random() > .5 ? '#ffffff0b' : '#0000000b';
      g.fillRect(P.random() * 256, P.random() * 256, kind === 'grass' ? 1 : 2, kind === 'grass' ? 4 : 1);
    }
    const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 4;
    textures.set(kind, texture); return texture;
  };
  P.material = function (key, options = {}) {
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ roughness: .82, ...options }));
    return materials.get(key);
  };
  P.merge = function (geometries) {
    const result = new T.BufferGeometry(), attrs = ['position', 'normal', 'uv', 'color'];
    const gs = geometries.map(g => g.index ? g.toNonIndexed() : g);
    for (const name of attrs) {
      const size = name === 'uv' ? 2 : 3;
      const total = gs.reduce((n, g) => n + g.attributes.position.count * size, 0);
      const array = new Float32Array(total); let at = 0;
      gs.forEach(g => {
        const attr = g.getAttribute(name);
        if (attr) array.set(attr.array, at);
        else if (name === 'color') array.fill(1, at, at + g.attributes.position.count * size);
        at += g.attributes.position.count * size;
      });
      result.setAttribute(name, new T.BufferAttribute(array, size));
    }
    result.computeBoundingSphere(); gs.forEach(g => g.dispose());
    geometries.forEach(g => { if (g.index) g.dispose(); }); return result;
  };
  P.tint = function (g, color) {
    const c = new T.Color(color), a = new Float32Array(g.attributes.position.count * 3);
    for (let n = 0; n < a.length; n += 3) { a[n] = c.r; a[n + 1] = c.g; a[n + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3)); return g;
  };
  // UVs are measured in metres before merging. A 20 m wall never stretches one brick over its width.
  P.boxGeometry = function (w, h, d, textureScale = 1) {
    const g = new T.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(n.getY(i)) > .5) uv.setXY(i, p.getX(i) / textureScale, p.getZ(i) / textureScale);
      else if (Math.abs(n.getX(i)) > .5) uv.setXY(i, p.getZ(i) / textureScale, p.getY(i) / textureScale);
      else uv.setXY(i, p.getX(i) / textureScale, p.getY(i) / textureScale);
    }
    return g;
  };
  P.bevelBox = function (w, h, d, radius = .16) {
    // Bevels expand the shape outline. Inset the profile so w/h/d remain its true outer dimensions.
    const r = Math.min(radius,w / 3,h / 3,d / 3), iw = w - 2 * r, ih = h - 2 * r;
    const s = new T.Shape(), x = -iw / 2, y = -ih / 2, corner = Math.min(r,iw / 2,ih / 2);
    s.moveTo(x + corner,y); s.lineTo(x + iw - corner,y); s.quadraticCurveTo(x + iw,y,x + iw,y + corner);
    s.lineTo(x + iw,y + ih - corner); s.quadraticCurveTo(x + iw,y + ih,x + iw - corner,y + ih);
    s.lineTo(x + corner,y + ih); s.quadraticCurveTo(x,y + ih,x,y + ih - corner);
    s.lineTo(x,y + corner); s.quadraticCurveTo(x,y,x + corner,y);
    const g = new T.ExtrudeGeometry(s, { depth: Math.max(.001, d - 2 * r), bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: r, bevelThickness: r, curveSegments: 4 });
    g.translate(0, 0, -d / 2 + r); return g;
  };
})(window.PX);
