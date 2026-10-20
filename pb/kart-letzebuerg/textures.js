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


  /* fantasy road surfaces: base colour, edge line, centre dash, optional painter */
  const ROAD = {
    asphalt: { base: '#767a84', edge: '#f3f1e8', dash: '#f6efd2' },
    bike: { base: '#b5594c', edge: '#f4ece2', dash: '#f4ece2' },                                   // red cycle-path tarmac: the look of a shortcut
    candy: { base: '#f4a8c6', edge: '#ffffff', dash: '#fff6a8', extra(g, W, H, rnd) {          // icing road: soft swirls + sprinkles
      for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(255,255,255,${0.12 + rnd() * 0.16})`; g.lineWidth = 3 + rnd() * 4; g.beginPath(); const x = rnd() * W, y = rnd() * H; g.moveTo(x, y); g.bezierCurveTo(x + 20, y - 18, x + 46, y + 18, x + 70, y - 4); g.stroke(); }
      const cols = ['#ffffff', '#7fd8ff', '#ffe066', '#9be37a', '#b78cff'];
      for (let i = 0; i < 70; i++) { g.fillStyle = cols[i % cols.length]; g.save(); g.translate(rnd() * W, rnd() * H); g.rotate(rnd() * 3); g.fillRect(-4, -1.5, 8, 3); g.restore(); }
    } },
    ice: { base: '#cfdbe8', edge: '#ffffff', dash: '#9fb8d6', extra(g, W, H, rnd) {                // blue ice: long white scratches and cracks
      for (let i = 0; i < 34; i++) { g.strokeStyle = `rgba(255,255,255,${0.18 + rnd() * 0.3})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); let x = rnd() * W, y = rnd() * H; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.3) * 44; y += (rnd() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
      for (let i = 0; i < 12; i++) { const x = rnd() * W, y = rnd() * H, gr = g.createRadialGradient(x, y, 0, x, y, 26 + rnd() * 30); gr.addColorStop(0, 'rgba(110,170,225,.28)'); gr.addColorStop(1, 'rgba(110,170,225,0)'); g.fillStyle = gr; g.fillRect(x - 60, y - 60, 120, 120); }
    } },
    basalt: { base: '#5b524d', edge: '#ffb347', dash: '#ff8a2a', extra(g, W, H, rnd) {             // cooled lava: dark crust with glowing hairline cracks
      for (let i = 0; i < 24; i++) { g.strokeStyle = `rgba(255,${110 + Math.floor(rnd() * 70)},30,${0.25 + rnd() * 0.4})`; g.lineWidth = 1 + rnd() * 1.6; g.beginPath(); let x = rnd() * W, y = rnd() * H; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 36; g.lineTo(x, y); } g.stroke(); }
    } },
  };

  const cacheT = {};
  KL.tex = {
    /* asphalt road seen across its full width (u) and 8 m along (v); markings optional */
    /* road seen across its full width (u) and 8 m along (v); markings optional. opts.style: asphalt | candy | ice | basalt (fantasy tracks) */
    asphalt(opts) {
      opts = opts || {};
      const st = opts.style || 'asphalt';
      const k = 'asphalt' + st + (opts.centre || 'dash') + (opts.edge === false ? 'n' : 'e');
      if (cacheT[k]) return cacheT[k];
      const W = 512, H = 256, [c, g] = mk(W, H), rnd = KL.rng(11);
      const P = ROAD[st] || ROAD.asphalt;
      g.fillStyle = P.base; g.fillRect(0, 0, W, H);
      // painted patches: small, low contrast (repairs and tyre wear), not big blotches
      for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.015 + rnd() * 0.025})`; g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 4 + rnd() * 18, 3 + rnd() * 9, rnd() * 3, 0, 7); g.fill(); }
      noise(g, W, H, 0.3, rnd, 1.5);
      if (P.extra) P.extra(g, W, H, rnd);
      if (opts.edge !== false) {
        g.fillStyle = P.edge;
        g.fillRect(W * 0.035, 0, 7, H); g.fillRect(W * 0.965 - 7, 0, 7, H);
      }
      if (opts.centre !== 'none') {
        g.fillStyle = P.dash;
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
    /* painted ground: base colour + dark/light blotches. extra: { dots: [colours] confetti, cracks: colour glowing cracks, flakes: colour sparkle } */
    grass(base, dark, light, seed, extra) {
      extra = extra || {};
      const k = 'grass' + base + dark + (extra.dots ? extra.dots.join('') : '') + (extra.cracks || '') + (extra.flakes || '');
      if (cacheT[k]) return cacheT[k];
      const S = 256, [c, g] = mk(S, S), rnd = KL.rng(seed || 5);
      g.fillStyle = base; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) { g.fillStyle = rnd() > 0.5 ? dark : light; g.globalAlpha = 0.18 + rnd() * 0.25; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, 3 + rnd() * 14, 2 + rnd() * 8, rnd() * 3, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      if (extra.dots) for (let i = 0; i < 70; i++) { g.fillStyle = extra.dots[i % extra.dots.length]; g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.6 + rnd() * 2.2, 0, 7); g.fill(); }
      if (extra.flakes) for (let i = 0; i < 90; i++) { g.fillStyle = extra.flakes; g.globalAlpha = 0.5 + rnd() * 0.5; g.fillRect(rnd() * S, rnd() * S, 1.5 + rnd() * 1.5, 1.5 + rnd() * 1.5); } g.globalAlpha = 1;
      if (extra.cracks) { g.lineCap = 'round'; for (let i = 0; i < 9; i++) { let x = rnd() * S, y = rnd() * S; g.strokeStyle = extra.cracks; g.globalAlpha = 0.5 + rnd() * 0.4; g.lineWidth = 1.2 + rnd() * 1.6; g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 5; q++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); } g.globalAlpha = 1; }
      return (cacheT[k] = tex(c));
    },
    kerb(a, b) {
      const k = 'kerb' + (a || '') + (b || '');
      if (cacheT[k]) return cacheT[k];
      const [c, g] = mk(64, 64);
      g.fillStyle = b || '#e8e3da'; g.fillRect(0, 0, 64, 64); g.fillStyle = a || '#d6303a'; g.fillRect(0, 0, 32, 64);
      return (cacheT[k] = tex(c));
    },
    /* wall faces: stone (default) | icing (pastel scallops) | snow (drift bank) | rock (dark basalt blocks) — drawn white-ish, tinted by vertex colours */
    stone(style) {
      const k = 'stone' + (style || '');
      if (cacheT[k]) return cacheT[k];
      const S = 256, [c, g] = mk(S, S), rnd = KL.rng(21);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      if (style === 'icing') {
        for (let i = 0; i < 4; i++) { const x = i * 64 + 32; g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x, 40, 30, 0, Math.PI); g.fill(); g.fillStyle = 'rgba(210,90,150,.12)'; g.beginPath(); g.arc(x, 128, 30, 0, 7); g.fill(); }
        for (let i = 0; i < 60; i++) { g.fillStyle = ['#ff5fa2', '#7fd8ff', '#ffe066', '#9be37a'][i % 4]; g.globalAlpha = 0.55; g.fillRect(rnd() * S, 60 + rnd() * 190, 6, 2.5); } g.globalAlpha = 1;
      } else if (style === 'snow') {
        for (let i = 0; i < 50; i++) { g.fillStyle = `rgba(150,190,235,${0.06 + rnd() * 0.1})`; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, 12 + rnd() * 30, 5 + rnd() * 10, 0, 0, 7); g.fill(); }
        for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(rnd() * S, rnd() * S, 2, 2); }
      } else if (style === 'rock') {
        for (let j = 0; j < 6; j++) { let x = -rnd() * 30; while (x < S) { const w = 30 + rnd() * 40, sh = 0.72 + rnd() * 0.28; g.fillStyle = `rgba(0,0,0,${1 - sh})`; g.fillRect(x + 2, j * 43 + 2, w - 4, 39); x += w; } }
        for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(255,${110 + Math.floor(rnd() * 70)},30,.7)`; g.lineWidth = 1.2; g.beginPath(); const x = rnd() * S, y = rnd() * S; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 28); g.stroke(); }
      } else {
        for (let j = 0; j < 8; j++) { g.fillStyle = 'rgba(80,70,60,.18)'; g.fillRect(0, j * 32, S, 2); for (let i = 0; i < 4; i++) { g.fillRect(((i * 64 + (j % 2) * 32) % S), j * 32, 2, 32); } }
        noise(g, S, S, 0.25, rnd, 3);
      }
      return (cacheT[k] = tex(c));
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
      const [c, g] = mk(S, S), [ce, ge] = mk(S, S), rnd = KL.rng(style === 'modern' ? 77 : style === 'brick' ? 53 : style === 'glass' ? 91 : style === 'lattice' ? 63 : 41);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        const x = col * cell, y = (3 - row) * cell;              // canvas y is flipped: texture v=0 is the bottom
        // wall plaster speckle
        for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`; g.fillRect(x + rnd() * cell, y + rnd() * cell, 3 + rnd() * 9, 3 + rnd() * 6); }
        const lit = rnd() < 0.55;
        if (style === 'brick') {                                    // industrial brick (Belval): courses, tall steel-framed windows, loading doors below
          for (let r = 0; r < cell; r += 8) { g.fillStyle = 'rgba(40,18,10,.16)'; g.fillRect(x, y + r, cell, 1.5); for (let c2 = (r / 8) % 2 ? 0 : 8; c2 < cell; c2 += 16) g.fillRect(x + c2, y + r, 1.5, 8); }
          for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '90,40,20' : '255,235,210'},${0.05 + rnd() * 0.06})`; g.fillRect(x + rnd() * cell, y + rnd() * cell, 4 + rnd() * 12, 3 + rnd() * 5); }
          if (row === 0) {
            if ((col + (rnd() > 0.6 ? 1 : 0)) % 2 === 0) { g.fillStyle = '#2d3138'; g.fillRect(x + 22, y + 46, cell - 44, cell - 46); g.fillStyle = '#4a515c'; for (let q = 0; q < 5; q++) g.fillRect(x + 22, y + 52 + q * 14, cell - 44, 3); }
            else { g.fillStyle = '#242c36'; g.fillRect(x + 20, y + 34, cell - 40, cell - 44); g.fillStyle = '#9aa4ae'; g.fillRect(x + cell / 2 - 1.5, y + 34, 3, cell - 44); g.fillStyle = 'rgba(160,200,235,.25)'; g.fillRect(x + 20, y + 34, 26, cell - 44); if (lit) { ge.fillStyle = '#ffd27a'; ge.fillRect(x + 22, y + 36, cell - 44, cell - 48); } }
            continue;
          }
          const wx = x + 16, wy = y + 14, ww = cell - 32, wh = cell - 30;
          g.fillStyle = '#6d4a3c'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);                    // stone lintel / frame
          g.fillStyle = '#26323f'; g.fillRect(wx, wy, ww, wh);
          const gl = g.createLinearGradient(wx, wy, wx + ww, wy + wh); gl.addColorStop(0, 'rgba(160,205,240,.5)'); gl.addColorStop(0.6, 'rgba(20,40,60,0)'); g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
          g.fillStyle = '#16191f'; for (let q = 1; q < 4; q++) g.fillRect(wx + (ww * q) / 4 - 1, wy, 2.5, wh); for (let q = 1; q < 3; q++) g.fillRect(wx, wy + (wh * q) / 3 - 1, ww, 2.5);
          if (lit) { ge.fillStyle = rnd() > 0.5 ? '#ffc766' : '#ffe0a0'; for (let q = 0; q < 4; q++) if (rnd() < 0.7) ge.fillRect(wx + (ww * q) / 4 + 2, wy + 2, ww / 4 - 4, wh - 4); }
          continue;
        }
        if (style === 'lattice') {                                   // white perforated concrete grid (Maison du Savoir): square deep-set windows
          const n = 4, w = cell / n;
          g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(x, y, cell, cell);
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const wx = x + i * w + 4, wy = y + j * w + 4, ww = w - 8;
            g.fillStyle = '#3d4a58'; g.fillRect(wx, wy, ww, ww); g.fillStyle = 'rgba(170,210,240,.45)'; g.fillRect(wx, wy, ww * 0.55, ww * 0.55);
            g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(wx, wy, ww, 3); g.fillRect(wx, wy, 3, ww);
            if (lit && rnd() < 0.75) { ge.fillStyle = rnd() > 0.5 ? '#ffe2a0' : '#cfe6ff'; ge.fillRect(wx + 2, wy + 3, ww - 4, ww - 5); }
          }
          continue;
        }
        if (style === 'glass') {                                    // office glass (Kirchberg): continuous window ribbons with fine mullions and pale spandrels
          g.fillStyle = 'rgba(30,50,70,.10)'; g.fillRect(x, y, cell, cell);
          if (row === 0) { g.fillStyle = '#1f3447'; g.fillRect(x + 3, y + 18, cell - 6, cell - 18); g.fillStyle = 'rgba(190,225,255,.35)'; g.fillRect(x + 3, y + 18, 30, cell - 18); g.fillStyle = '#c9d3dc'; for (let q = 0; q < 4; q++) g.fillRect(x + 3 + q * ((cell - 6) / 4), y + 18, 2.5, cell - 18); if (lit) { ge.fillStyle = '#ffe3a8'; ge.fillRect(x + 6, y + 22, cell - 12, cell - 26); } continue; }
          g.fillStyle = '#1c3045'; g.fillRect(x, y + 14, cell, cell - 30);
          const g2 = g.createLinearGradient(x, y + 14, x + cell, y + cell - 16); g2.addColorStop(0, 'rgba(170,215,250,.6)'); g2.addColorStop(0.55, 'rgba(60,110,150,.2)'); g2.addColorStop(1, 'rgba(10,20,35,0)'); g.fillStyle = g2; g.fillRect(x, y + 14, cell, cell - 30);
          g.fillStyle = '#d4dae1'; for (let q = 0; q < 8; q++) g.fillRect(x + q * (cell / 8), y + 14, 2, cell - 30);
          g.fillStyle = '#e8ecef'; g.fillRect(x, y + cell - 16, cell, 16); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y + cell - 4, cell, 4);
          if (lit) { ge.fillStyle = rnd() > 0.4 ? '#cfe6ff' : '#ffe9b8'; for (let q = 0; q < 8; q++) if (rnd() < 0.8) ge.fillRect(x + q * (cell / 8) + 3, y + 17, cell / 8 - 5, cell - 36); }
          continue;
        }
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
