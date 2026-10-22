/* Schueberfouer Tycoon, W3: the shared sign / mural atlas.  One 2048 x 1536 CanvasTexture holds every painted sign panel, banner and mural of every
 * model (all lettering is generated here, nothing is a photo).  Slots are painted lazily the first time a model asks for them and cached by key.
 *   const atlas = createAtlas(T);  atlas.slot(key, w, h, bg, draw) -> { u0, v0, u1, v1 };  atlas.texture;  atlas.stats()
 * Painters for the three Looks (0 Traditioun gilt baroque red/cream, 1 Neon cyan/magenta, 2 Retro Bavarian blue/white lozenge) are at the bottom. */

export const ATLAS_W = 2048;
export const ATLAS_H = 1536;
const PAD = 3;
export const FONT_SANS = '"Arial Black","Helvetica Neue",Arial,sans-serif';
export const FONT_SERIF = 'Georgia,"Palatino Linotype","Times New Roman",serif';
export const FONT_ROUND = '"Trebuchet MS","Avenir Next",Verdana,sans-serif';

export function createAtlas(T) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W; canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.minFilter = T.LinearMipmapLinearFilter; texture.magFilter = T.LinearFilter;
  texture.anisotropy = 4;
  const slots = new Map();
  const shelves = [];           // { y, h, x }
  let usedY = 0; let dirty = false; let overflow = 0;

  function alloc(w, h) {
    const pw = w + PAD * 2; const ph = h + PAD * 2;
    for (const s of shelves) if (s.h >= ph && ph >= s.h * 0.6 && s.x + pw <= ATLAS_W) { const r = { x: s.x, y: s.y }; s.x += pw; return r; }
    if (usedY + ph > ATLAS_H) return null;
    const s = { y: usedY, h: ph, x: pw }; shelves.push(s); usedY += ph;
    return { x: 0, y: s.y };
  }
  function slot(key, w, h, bg, draw) {
    const hit = slots.get(key); if (hit) return hit;
    const pos = alloc(w, h);
    if (!pos) { overflow++; return slots.get('blank') || (slots.set('blank', { u0: 0.001, v0: 0.999, u1: 0.002, v1: 0.9995, x: 0, y: 0, w: 1, h: 1 }), slots.get('blank')); }
    ctx.save();
    ctx.fillStyle = bg || '#ffffff'; ctx.fillRect(pos.x, pos.y, w + PAD * 2, h + PAD * 2);     // padding repeats the background (mip bleeding)
    ctx.translate(pos.x + PAD, pos.y + PAD);
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    try { draw(ctx, w, h); } catch (e) { console.error('[fouer] sign painter failed', key, e); }
    ctx.restore();
    const x0 = pos.x + PAD; const y0 = pos.y + PAD;
    const r = { u0: (x0 + 0.5) / ATLAS_W, u1: (x0 + w - 0.5) / ATLAS_W, v1: 1 - (y0 + 0.5) / ATLAS_H, v0: 1 - (y0 + h - 0.5) / ATLAS_H, x: x0, y: y0, w, h };
    slots.set(key, r); dirty = true; texture.needsUpdate = true;
    return r;
  }
  return {
    canvas, texture, slot,
    stats: () => ({ slots: slots.size, usedRows: usedY, height: ATLAS_H, overflow, fill: usedY / ATLAS_H }),
    flush() { if (dirty) { texture.needsUpdate = true; dirty = false; } },
  };
}

/* ------------------------------------------------------------------ painting helpers */
export function fitText(ctx, text, x, y, maxW, px, font, fill, o = {}) {
  let size = px;
  ctx.font = `${o.weight || 'bold'} ${size}px ${font}`;
  let m = ctx.measureText(text).width;
  if (m > maxW) { size = Math.max(6, size * maxW / m); ctx.font = `${o.weight || 'bold'} ${size}px ${font}`; m = ctx.measureText(text).width; }
  ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.glowBlur || size * 0.35; }
  if (o.stroke) { ctx.lineWidth = o.strokeW || size * 0.14; ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); }
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  return size;
}
export function star(ctx, cx, cy, r, fill, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5; const rr = i % 2 ? r * 0.42 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function lozenge(ctx, w, h, c1, c2, size) {
  ctx.fillStyle = c2; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c1;
  const sx = size; const sy = size * 0.62;
  for (let j = -1; j * sy < h + sy; j++) for (let i = -1; i * sx < w + sx; i++) {
    const cx = i * sx + (j & 1 ? sx / 2 : 0); const cy = j * sy;
    ctx.beginPath(); ctx.moveTo(cx, cy - sy / 2); ctx.lineTo(cx + sx / 2, cy); ctx.lineTo(cx, cy + sy / 2); ctx.lineTo(cx - sx / 2, cy); ctx.closePath(); ctx.fill();
  }
}
function border(ctx, w, h, col, t, inset = 0) { ctx.strokeStyle = col; ctx.lineWidth = t; ctx.strokeRect(inset + t / 2, inset + t / 2, w - 2 * inset - t, h - 2 * inset - t); }

/** Look palettes of the sign painters: [bg, text, trim, accent] */
export const SIGN_LOOKS = [
  { bg: '#f6ead0', fg: '#b3202a', trim: '#d6a436', alt: '#8c1620', font: FONT_SERIF },
  { bg: '#140a2e', fg: '#41f0ff', trim: '#ff3fc8', alt: '#8a5bff', font: FONT_SANS },
  { bg: '#fdfdf6', fg: '#1d58b4', trim: '#2d6fd0', alt: '#7fb0ee', font: FONT_ROUND },
];

/** a painter for the main fascia sign of a Look; kind 'main' (big fascia) | 'banner' (secondary strip) | 'plate' (small hanging plate) */
export function signPainter(look, text, kind = 'main', o = {}) {
  const S = SIGN_LOOKS[look] || SIGN_LOOKS[0];
  return (ctx, w, h) => {
    const bg = o.bg || (kind === 'banner' ? S.fg : S.bg); const fg = o.fg || (kind === 'banner' ? S.bg : S.fg); const trim = o.trim || S.trim;
    if (look === 2) {
      lozenge(ctx, w, h, kind === 'banner' ? '#ffffff' : '#2d6fd0', kind === 'banner' ? '#2d6fd0' : '#ffffff', h * 0.34);
      const m = h * 0.14; ctx.fillStyle = kind === 'banner' ? '#1d58b4' : '#ffffff'; ctx.fillRect(m * 2.2, m, w - m * 4.4, h - m * 2);
      border(ctx, w - m * 4.4, h - m * 2, '#1d58b4', Math.max(2, h * 0.05)); // inner rule
      ctx.save(); ctx.translate(m * 2.2, m); border(ctx, w - m * 4.4, h - m * 2, '#1d58b4', Math.max(2, h * 0.05)); ctx.restore();
      fitText(ctx, text, w / 2, h * 0.54, w - m * 7.5, h * 0.58, S.font, kind === 'banner' ? '#ffffff' : '#1d58b4', { stroke: kind === 'banner' ? '#0d2f66' : undefined });
    } else if (look === 1) {
      ctx.fillStyle = kind === 'banner' ? '#2a0a4a' : bg; ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(120,60,255,0.28)'); g.addColorStop(1, 'rgba(255,60,200,0.18)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = trim; ctx.shadowBlur = h * 0.18; border(ctx, w, h, trim, Math.max(3, h * 0.08), h * 0.06); ctx.shadowBlur = 0;
      fitText(ctx, text, w / 2, h * 0.53, w - h * 0.7, h * 0.56, S.font, kind === 'banner' ? '#ff9af0' : fg, { glow: kind === 'banner' ? '#ff3fc8' : '#17d8ff', glowBlur: h * 0.28, stroke: '#ffffff', strokeW: h * 0.035 });
    } else {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0.12)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      border(ctx, w, h, trim, Math.max(3, h * 0.11), 0);
      border(ctx, w, h, kind === 'banner' ? S.bg : S.alt, Math.max(1.5, h * 0.035), h * 0.13);
      star(ctx, h * 0.5, h * 0.5, h * 0.17, trim); star(ctx, w - h * 0.5, h * 0.5, h * 0.17, trim);
      fitText(ctx, text, w / 2, h * 0.53, w - h * 1.35, h * 0.56, S.font, fg, { stroke: kind === 'banner' ? '#00000044' : '#ffffffaa', strokeW: h * 0.04 });
    }
  };
}

/** painted murals for cornice panels / backdrops: kinds 0 landscape, 1 skyline, 2 circus stars, 3 sea, 4 portrait-ish rosette, 5 alpine */
export function muralPainter(kind, seed = 1, look = 0) {
  return (ctx, w, h) => {
    let s = seed * 9301 + 49297; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    const warm = look === 1 ? ['#2a0a5a', '#ff4fb8'] : look === 2 ? ['#4a8be0', '#cfe6ff'] : ['#ff9a5a', '#ffe2a8'];
    sky.addColorStop(0, warm[0]); sky.addColorStop(1, warm[1]); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (kind === 0 || kind === 5) {
      ctx.fillStyle = look === 1 ? '#17d8ff' : '#fff1b0'; ctx.beginPath(); ctx.arc(w * (0.2 + r() * 0.6), h * 0.3, h * 0.16, 0, 7); ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ['#2e7d4f', '#1f5e46', '#154a3a'][i]; if (look === 1) ctx.fillStyle = ['#5a1aa8', '#3a0f80', '#240a58'][i];
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += w / 8) ctx.lineTo(x, h * (0.55 + i * 0.13) - (kind === 5 ? (r() * h * 0.35) : Math.sin(x * 0.03 + i + seed) * h * 0.08));
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      }
    } else if (kind === 1) {
      ctx.fillStyle = look === 1 ? '#0a0420' : '#2a3a5a';
      for (let x = 0; x < w; x += w / 11) { const bh = h * (0.3 + r() * 0.5); ctx.fillRect(x, h - bh, w / 11 - 1, bh); }
      ctx.fillStyle = look === 1 ? '#ff3fc8' : '#ffd86a'; for (let i = 0; i < 40; i++) ctx.fillRect(r() * w, h * (0.4 + r() * 0.6), 2, 2);
    } else if (kind === 2) {
      for (let i = 0; i < w; i += w / 8) { ctx.fillStyle = (i / (w / 8)) & 1 ? '#d8283a' : '#fff7e2'; ctx.fillRect(i, 0, w / 8, h); }
      for (let i = 0; i < 7; i++) star(ctx, r() * w, r() * h, h * 0.12, ['#ffd23c', '#2d6fd0', '#2fa35a'][i % 3]);
    } else if (kind === 3) {
      ctx.fillStyle = '#2d8fd8'; ctx.fillRect(0, h * 0.45, w, h * 0.55);
      ctx.strokeStyle = '#e9f8ff'; ctx.lineWidth = Math.max(2, h * 0.05);
      for (let j = 0; j < 3; j++) { ctx.beginPath(); for (let x = 0; x <= w; x += 4) { const y = h * (0.58 + j * 0.15) + Math.sin(x * 0.12 + j * 2) * h * 0.05; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    } else if (kind === 6) {
      ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 24; i++) { const x = (i % 8 + 0.5 + (r() - 0.5) * 0.4) * w / 8; const y = (Math.floor(i / 8) + 0.5 + (r() - 0.5) * 0.4) * h / 3; const c = ['#e8283a', '#ffd21f', '#2d5fd8'][i % 3]; if (i % 3 === 0) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y + h * 0.1); ctx.bezierCurveTo(x - h * 0.2, y - h * 0.06, x - h * 0.08, y - h * 0.22, x, y - h * 0.08); ctx.bezierCurveTo(x + h * 0.08, y - h * 0.22, x + h * 0.2, y - h * 0.06, x, y + h * 0.1); ctx.fill(); } else star(ctx, x, y, h * 0.1, c); }
    } else {
      ctx.fillStyle = '#7a1a3a'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, h * (0.48 - i * 0.07), 0, 7); ctx.fillStyle = ['#ffd23c', '#c8283a', '#fff1d0', '#2a6fc8', '#ffd23c', '#c8283a'][i]; ctx.fill(); }
    }
    ctx.strokeStyle = '#c99a2e'; ctx.lineWidth = Math.max(2, h * 0.07); ctx.strokeRect(0, 0, w, h);
  };
}

/** the small padlock plate of a locked pitch: dark plate, brass padlock, "ab" + star + level */
export function lockPainter(starNo, label = 'ab') {
  return (ctx, w, h) => {
    ctx.fillStyle = '#2b2118'; ctx.fillRect(0, 0, w, h); border(ctx, w, h, '#e0b04a', Math.max(2, h * 0.07), 0);
    const cx = h * 0.55; const cy = h * 0.58; const r = h * 0.2;
    ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = h * 0.09; ctx.beginPath(); ctx.arc(cx, cy - r * 0.9, r * 0.75, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#e0b04a'; ctx.fillRect(cx - r, cy - r * 0.55, r * 2, r * 1.5);
    ctx.fillStyle = '#2b2118'; ctx.beginPath(); ctx.arc(cx, cy + r * 0.05, r * 0.2, 0, 7); ctx.fill(); ctx.fillRect(cx - r * 0.07, cy + r * 0.05, r * 0.14, r * 0.45);
    fitText(ctx, label, h * 1.5, h * 0.52, h * 0.9, h * 0.5, FONT_ROUND, '#fff1cc');
    star(ctx, h * 2.25, h * 0.52, h * 0.27, '#ffcf3c');
    fitText(ctx, String(starNo), h * 2.85, h * 0.54, h * 0.6, h * 0.62, FONT_ROUND, '#ffcf3c');
  };
}

/** a free sign painter: s = { bg, bg2, fg, stroke, strokeW, font, border, glow, italic, shadow } */
export function stylePainter(text, s) {
  return (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, s.bg || '#fff'); g.addColorStop(1, s.bg2 || s.bg || '#fff'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (s.border) border(ctx, w, h, s.border, Math.max(2, h * 0.09), 0);
    const px = h * (s.size || 0.62); const font = s.font || FONT_SANS;
    ctx.save(); if (s.italic) { ctx.translate(w / 2, h / 2); ctx.transform(1, 0, -0.18, 1, 0, 0); ctx.translate(-w / 2, -h / 2); }
    if (s.shadow) fitText(ctx, text, w / 2 + h * 0.04, h * 0.58, w - h * 0.5, px, font, s.shadow);
    fitText(ctx, text, w / 2, h * 0.54, w - h * 0.5, px, font, s.fg || '#000', { stroke: s.stroke, strokeW: s.strokeW || h * 0.06, glow: s.glow, glowBlur: h * 0.25 });
    ctx.restore();
  };
}
