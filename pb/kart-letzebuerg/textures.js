/* Kart Lëtzebuerg — painted canvas textures (generated at start, no image files). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  function tex(canvas, o) {
    o = o || {};
    const t = new T.CanvasTexture(canvas);
    t.colorSpace = o.linear ? T.NoColorSpace : T.SRGBColorSpace;
    t.wrapS = o.wrapS || T.RepeatWrapping; t.wrapT = o.wrapT || T.RepeatWrapping;
    t.anisotropy = o.aniso || KL.maxAniso || 4;
    t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter;
    return t;
  }
  function noise(ctx, w, h, amount, rnd, size) {
    for (let i = 0; i < w * h * 0.06; i++) {
      const x = rnd() * w, y = rnd() * h, v = (rnd() - 0.5) * amount;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      ctx.fillRect(x, y, size || 2, size || 2);
    }
  }

  const cacheT = {};
  KL.tex = {
    /* asphalt road seen across its full width (u) and 8 m along (v); markings optional */
    asphalt(opts) {
      opts = opts || {};
      const k = 'asphalt' + (opts.centre || 'dash') + (opts.edge === false ? 'n' : 'e');
      if (cacheT[k]) return cacheT[k];
      const W = 512, H = 256, [c, g] = mk(W, H), rnd = KL.rng(11);
      g.fillStyle = '#767a84'; g.fillRect(0, 0, W, H);
      // painted patches: small, low contrast (repairs and tyre wear), not big blotches
      for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.015 + rnd() * 0.025})`; g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 4 + rnd() * 18, 3 + rnd() * 9, rnd() * 3, 0, 7); g.fill(); }
      noise(g, W, H, 0.3, rnd, 1.5);
      if (opts.edge !== false) {
        g.fillStyle = '#f3f1e8';
        g.fillRect(W * 0.035, 0, 7, H); g.fillRect(W * 0.965 - 7, 0, 7, H);
      }
      if (opts.centre !== 'none') {
        g.fillStyle = '#f6efd2';
        if (opts.centre === 'solid') { g.fillRect(W / 2 - 3, 0, 6, H); }
        else { g.fillRect(W / 2 - 3, 20, 6, 100); g.fillRect(W / 2 - 3, 148, 6, 100); }
      }
      return (cacheT[k] = tex(c));
    },
    cobble() {
      if (cacheT.cobble) return cacheT.cobble;
      const S = 256, [c, g] = mk(S, S), rnd = KL.rng(3);
      g.fillStyle = '#8f8a86'; g.fillRect(0, 0, S, S);
      const rows = 12, rh = S / rows;
      for (let r = 0; r < rows; r++) {
        let x = -(rnd() * 20);
        while (x < S) {
          const w = 16 + rnd() * 10, sh = 150 + rnd() * 80;
          g.fillStyle = `rgb(${sh},${sh - 6},${sh - 14})`;
          g.fillRect(x + 1.2, r * rh + 1.2, w - 2.4, rh - 2.4);
          x += w;
        }
      }
      noise(g, S, S, 0.2, rnd, 2);
      return (cacheT.cobble = tex(c));
    },
    slabs() {
      if (cacheT.slabs) return cacheT.slabs;
      const S = 256, [c, g] = mk(S, S), rnd = KL.rng(8);
      g.fillStyle = '#7c7a7e'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const sh = 190 + rnd() * 30; g.fillStyle = `rgb(${sh},${sh - 2},${sh - 8})`; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      }
      noise(g, S, S, 0.16, rnd, 2);
      return (cacheT.slabs = tex(c));
    },
    grass(base, dark, light, seed) {
      const k = 'grass' + base + dark;
      if (cacheT[k]) return cacheT[k];
      const S = 256, [c, g] = mk(S, S), rnd = KL.rng(seed || 5);
      g.fillStyle = base; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) { g.fillStyle = rnd() > 0.5 ? dark : light; g.globalAlpha = 0.18 + rnd() * 0.25; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, 3 + rnd() * 14, 2 + rnd() * 8, rnd() * 3, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      return (cacheT[k] = tex(c));
    },
    kerb() {
      if (cacheT.kerb) return cacheT.kerb;
      const [c, g] = mk(64, 64);
      g.fillStyle = '#e8e3da'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#d6303a'; g.fillRect(0, 0, 32, 64);
      return (cacheT.kerb = tex(c));
    },
    stone() {
      if (cacheT.stone) return cacheT.stone;
      const S = 256, [c, g] = mk(S, S), rnd = KL.rng(21);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      for (let j = 0; j < 8; j++) { g.fillStyle = 'rgba(80,70,60,.18)'; g.fillRect(0, j * 32, S, 2); for (let i = 0; i < 4; i++) { g.fillRect(((i * 64 + (j % 2) * 32) % S), j * 32, 2, 32); } }
      noise(g, S, S, 0.25, rnd, 3);
      return (cacheT.stone = tex(c));
    },
    checker() {
      if (cacheT.checker) return cacheT.checker;
      const [c, g] = mk(128, 64);
      for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8); }
      const t = tex(c); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return (cacheT.checker = t);
    },
    /* 4 bays x 4 floors: row 0 (bottom) is the ground floor, rows 1-3 upper floors. Returns {map, emissive} */
    facade(style) {
      const k = 'facade' + style;
      if (cacheT[k]) return cacheT[k];
      const S = 512, cell = S / 4;
      const [c, g] = mk(S, S), [ce, ge] = mk(S, S), rnd = KL.rng(style === 'modern' ? 77 : 41);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        const x = col * cell, y = (3 - row) * cell;              // canvas y is flipped: texture v=0 is the bottom
        // wall plaster speckle
        for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`; g.fillRect(x + rnd() * cell, y + rnd() * cell, 3 + rnd() * 9, 3 + rnd() * 6); }
        const lit = rnd() < 0.55;
        if (style === 'modern') {
          if (row === 0) { g.fillStyle = '#3c4d5e'; g.fillRect(x + 4, y + 22, cell - 8, cell - 22); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 4, y + 22, 18, cell - 22); if (lit) { ge.fillStyle = '#ffcf7a'; ge.fillRect(x + 4, y + 22, cell - 8, cell - 22); } continue; }
          g.fillStyle = '#26394d'; g.fillRect(x + 3, y + 10, cell - 6, cell - 20);
          const gg = g.createLinearGradient(x, y + 10, x + cell, y + cell - 10); gg.addColorStop(0, 'rgba(150,200,240,.55)'); gg.addColorStop(1, 'rgba(20,40,60,0)'); g.fillStyle = gg; g.fillRect(x + 3, y + 10, cell - 6, cell - 20);
          g.fillStyle = '#d7dce2'; g.fillRect(x + cell / 2 - 1.5, y + 10, 3, cell - 20);
          if (lit) { ge.fillStyle = rnd() > 0.5 ? '#ffd98a' : '#fff0c8'; ge.fillRect(x + 6, y + 14, cell - 12, cell - 28); }
          continue;
        }
        if (row === 0) {                                          // ground floor: shop window or door
          if ((col + (rnd() > 0.7 ? 1 : 0)) % 3 === 1) {          // door with arch
            g.fillStyle = '#5a3a28'; g.beginPath(); g.moveTo(x + 36, y + cell); g.lineTo(x + 36, y + 50); g.arc(x + cell / 2, y + 50, cell / 2 - 36, Math.PI, 0); g.lineTo(x + cell - 36, y + cell); g.fill();
            g.fillStyle = '#e8d9b0'; g.fillRect(x + 28, y + 40, cell - 56, 4);
          } else {                                                // shop window with awning
            g.fillStyle = '#2d3b4a'; g.fillRect(x + 14, y + 38, cell - 28, cell - 44);
            g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 14, y + 38, 22, cell - 44);
            const aw = ['#c23b3b', '#2e6f9e', '#2f8f5b', '#d99a2b', '#7a3b8c'][Math.floor(rnd() * 5)];
            g.fillStyle = aw; g.fillRect(x + 8, y + 22, cell - 16, 18);
            g.fillStyle = 'rgba(255,255,255,.4)'; for (let s = 0; s < 6; s++) g.fillRect(x + 8 + s * ((cell - 16) / 6), y + 22, (cell - 16) / 12, 18);
            if (lit || rnd() < 0.4) { ge.fillStyle = '#ffd486'; ge.fillRect(x + 14, y + 38, cell - 28, cell - 44); }
          }
          continue;
        }
        // upper floors: shuttered window
        const wx = x + 34, wy = y + 22, ww = cell - 68, wh = cell - 42;
        g.fillStyle = '#efe8da'; g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);                 // frame
        g.fillStyle = '#2b3a4a'; g.fillRect(wx, wy, ww, wh);
        const sky = g.createLinearGradient(wx, wy, wx + ww, wy + wh); sky.addColorStop(0, 'rgba(160,205,240,.6)'); sky.addColorStop(0.6, 'rgba(20,40,60,0)'); g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
        g.fillStyle = '#efe8da'; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.42, ww, 3);
        g.fillStyle = '#d9d0bd'; g.fillRect(wx - 9, wy + wh + 4, ww + 18, 5);                  // sill
        if (rnd() < 0.55) { const sc = ['#3c6e4c', '#7a3d3d', '#3d5a7a', '#6e6a5a'][Math.floor(rnd() * 4)]; g.fillStyle = sc; g.fillRect(wx - 22, wy - 4, 16, wh + 8); g.fillRect(wx + ww + 6, wy - 4, 16, wh + 8); g.fillStyle = 'rgba(0,0,0,.2)'; for (let s = 0; s < 6; s++) { g.fillRect(wx - 22, wy + s * (wh / 6), 16, 2); g.fillRect(wx + ww + 6, wy + s * (wh / 6), 16, 2); } }
        if (rnd() < 0.18) { g.fillStyle = '#3b3b44'; g.fillRect(wx - 12, wy + wh + 7, ww + 24, 6); g.fillStyle = '#4f7a3a'; for (let s = 0; s < 4; s++) g.fillRect(wx - 6 + s * (ww / 3), wy + wh - 4, 8, 10); }  // flower box
        if (lit) { ge.fillStyle = rnd() > 0.5 ? '#ffcf72' : '#ffe6a8'; ge.fillRect(wx, wy, ww, wh); }
      }
      return (cacheT[k] = { map: tex(c, { wrapT: T.ClampToEdgeWrapping, aniso: 4 }), emissive: tex(ce, { wrapT: T.ClampToEdgeWrapping, aniso: 4 }) });
    },
    glow() {
      if (cacheT.glow) return cacheT.glow;
      const [c, g] = mk(128, 128), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const t = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }); return (cacheT.glow = t);
    },
    shadow() {
      if (cacheT.shadow) return cacheT.shadow;
      const [c, g] = mk(128, 128), gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
      gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(0.65, 'rgba(0,0,0,.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return (cacheT.shadow = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }));
    },
    chevrons() {
      if (cacheT.chev) return cacheT.chev;
      const [c, g] = mk(128, 256);
      g.fillStyle = '#ffb703'; g.fillRect(0, 0, 128, 256);
      g.fillStyle = '#1d1d2b'; g.fillRect(6, 6, 116, 244);
      for (let i = 0; i < 3; i++) { const y = 20 + i * 76; g.fillStyle = '#ffe14a'; g.beginPath(); g.moveTo(14, y + 60); g.lineTo(64, y); g.lineTo(114, y + 60); g.lineTo(114, y + 90); g.lineTo(64, y + 32); g.lineTo(14, y + 90); g.closePath(); g.fill(); }
      const t = tex(c); t.wrapS = T.ClampToEdgeWrapping; return (cacheT.chev = t);
    },
    itemBox() {
      if (cacheT.box) return cacheT.box;
      const [c, g] = mk(128, 128);
      const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, '#ff5fa2'); gr.addColorStop(0.35, '#ffd23f'); gr.addColorStop(0.7, '#3ddc97'); gr.addColorStop(1, '#4cc9f0');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
      g.fillStyle = '#fff'; g.font = '900 88px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 8; g.fillText('?', 64, 70);
      return (cacheT.box = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }));
    },
    cloud() {
      if (cacheT.cloud) return cacheT.cloud;
      const [c, g] = mk(256, 128), rnd = KL.rng(9);
      for (let i = 0; i < 16; i++) { const x = 40 + rnd() * 176, y = 50 + rnd() * 34, r = 20 + rnd() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128); }
      return (cacheT.cloud = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }));
    },
    spark() {
      if (cacheT.spark) return cacheT.spark;
      const [c, g] = mk(64, 64), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return (cacheT.spark = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }));
    },
    oil() {
      if (cacheT.oil) return cacheT.oil;
      const [c, g] = mk(128, 128);
      g.clearRect(0, 0, 128, 128);
      const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62); gr.addColorStop(0, '#16161f'); gr.addColorStop(0.8, '#1c1c28'); gr.addColorStop(1, 'rgba(20,20,30,0)');
      g.fillStyle = gr; g.beginPath(); for (let a = 0; a < 24; a++) { const ang = (a / 24) * 7, r = 48 + 12 * Math.sin(a * 2.3) + 4 * Math.cos(a * 5); g.lineTo(64 + Math.cos(ang) * r, 64 + Math.sin(ang) * r); } g.closePath(); g.fill();
      for (let i = 0; i < 3; i++) { const sg = g.createRadialGradient(46 + i * 14, 52 + i * 8, 0, 46 + i * 14, 52 + i * 8, 22); sg.addColorStop(0, ['rgba(255,80,160,.55)', 'rgba(80,220,255,.5)', 'rgba(255,230,80,.45)'][i]); sg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sg; g.fillRect(0, 0, 128, 128); }
      return (cacheT.oil = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }));
    },
    pumpkinFace() {
      if (cacheT.pk) return cacheT.pk;
      const [c, g] = mk(128, 128); g.fillStyle = '#ff8a1f'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#2a1200'; g.beginPath(); g.moveTo(26, 50); g.lineTo(50, 50); g.lineTo(38, 30); g.fill(); g.beginPath(); g.moveTo(78, 50); g.lineTo(102, 50); g.lineTo(90, 30); g.fill();
      g.beginPath(); g.moveTo(24, 78); for (let i = 0; i < 6; i++) { g.lineTo(34 + i * 12, 100 + (i % 2 ? -10 : 8)); } g.lineTo(104, 78); g.lineTo(64, 70); g.fill();
      g.shadowColor = '#ffd23f'; return (cacheT.pk = tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }));
    },
    label(text, opts) {
      opts = opts || {};
      const [c, g] = mk(opts.w || 512, opts.h || 128);
      g.fillStyle = opts.bg || 'rgba(0,0,0,0)'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = opts.fg || '#fff'; let fs = opts.size || 72; g.font = '900 ' + fs + 'px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      { const wmax = c.width * 0.92, wt = g.measureText(text).width; if (wt > wmax) { fs = Math.floor((fs * wmax) / wt); g.font = '900 ' + fs + 'px system-ui,sans-serif'; } }
      if (opts.stroke) { g.lineWidth = 10; g.strokeStyle = opts.stroke; g.strokeText(text, c.width / 2, c.height / 2 + 4); }
      g.fillText(text, c.width / 2, c.height / 2 + 4);
      return tex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping });
    },
  };
})();
