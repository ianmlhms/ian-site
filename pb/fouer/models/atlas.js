/* Schueberfouer Tycoon, W3: the shared sign / mural atlas.  One 2048 x 2048 CanvasTexture holds every painted sign panel, banner and mural of every
 * model (all lettering is generated here, nothing is a photo).  Slots are painted lazily the first time a model asks for them and cached by key.
 *   const atlas = createAtlas(T);  atlas.slot(key, w, h, bg, draw) -> { u0, v0, u1, v1 };  atlas.texture;  atlas.stats()
 * Painters for the three Looks (0 Traditioun gilt baroque red/cream, 1 Neon cyan/magenta, 2 Retro Bavarian blue/white lozenge) are at the bottom. */

export const ATLAS_W = 2048;
export const ATLAS_H = 2048;
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

/* ------------------------------------------------------------------ airbrush murals (polish wave): six themes painted with gradients, soft glows and thick outlines.
 * kinds (used by Builder.mural / airbrush): 0 alpine, 1 space, 2 circus, 3 sea, 4 comic, 5 jungle, 6 hearts-and-stars print (the waffle trailer), 7 rosette */
export const MURAL_THEMES = ['alpine', 'space', 'circus', 'sea', 'comic', 'jungle'];
function rng(seed) { let s = (seed * 9301 + 49297) | 0; return () => { s = (s * 9301 + 49297) % 233280; return Math.abs(s) / 233280; }; }
function vgrad(ctx, w, h, stops) { const g = ctx.createLinearGradient(0, 0, 0, h); stops.forEach(([t, c]) => g.addColorStop(t, c)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
function glowBlob(ctx, x, y, r, c0, c1 = 'rgba(0,0,0,0)') { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
function ball(ctx, x, y, r, light, mid, dark) { const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, light); g.addColorStop(0.55, mid); g.addColorStop(1, dark); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function sparkle(ctx, x, y, r, c = '#fff') { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill(); }
function leaf(ctx, x, y, len, ang, c0, c1, wid = 0.28) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, 0, len, 0); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * wid, len, 0); ctx.quadraticCurveTo(len * 0.5, len * wid, 0, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,200,0.45)'; ctx.lineWidth = Math.max(1, len * 0.03); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke(); ctx.restore();
}
function fish(ctx, x, y, len, c0, c1, flip = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(flip, 1);
  const g = ctx.createLinearGradient(0, -len * 0.3, 0, len * 0.3); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(len * 0.5, 0); ctx.quadraticCurveTo(0, -len * 0.42, -len * 0.38, 0); ctx.quadraticCurveTo(0, len * 0.42, len * 0.5, 0); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-len * 0.32, 0); ctx.lineTo(-len * 0.62, -len * 0.26); ctx.lineTo(-len * 0.62, len * 0.26); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(len * 0.33, -len * 0.06, len * 0.07, 0, 7); ctx.fill(); ctx.fillStyle = '#102030'; ctx.beginPath(); ctx.arc(len * 0.35, -len * 0.06, len * 0.035, 0, 7); ctx.fill();
  ctx.restore();
}
function pine(ctx, x, y, hgt, c0, c1) { for (let k = 0; k < 3; k++) { const yy = y - hgt * (0.1 + k * 0.28); const ww = hgt * (0.46 - k * 0.1); const g = ctx.createLinearGradient(x - ww, 0, x + ww, 0); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, yy - hgt * 0.4); ctx.lineTo(x + ww, yy); ctx.lineTo(x - ww, yy); ctx.closePath(); ctx.fill(); } ctx.fillStyle = '#4a2f1e'; ctx.fillRect(x - hgt * 0.04, y, hgt * 0.08, hgt * 0.1); }

const AIR = {
  alpine(ctx, w, h, r) {
    vgrad(ctx, w, h, [[0, '#2a7fe0'], [0.55, '#9bd0ff'], [1, '#ffd9a0']]);
    glowBlob(ctx, w * (0.2 + r() * 0.5), h * 0.34, h * 0.5, 'rgba(255,240,180,0.95)'); ball(ctx, w * 0.5, h * 0.34, h * 0.1, '#fffbe0', '#ffe27a', '#ffb030');
    const peaks = (base, amp, n, c0, c1, snow) => {
      const g = ctx.createLinearGradient(0, h * (base - amp), 0, h); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, h);
      const pts = []; for (let i = 0; i <= n; i++) { const x = w * i / n; const y = h * (base - amp * (i % 2 ? 0.25 + r() * 0.3 : 0.7 + r() * 0.3)); pts.push([x, y]); ctx.lineTo(x, y); }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      if (snow) { ctx.fillStyle = 'rgba(255,255,255,0.96)'; pts.forEach(([x, y], i) => { if (i % 2) return; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.05, y + h * 0.15); ctx.lineTo(x + w * 0.02, y + h * 0.11); ctx.lineTo(x, y + h * 0.17); ctx.lineTo(x - w * 0.03, y + h * 0.1); ctx.lineTo(x - w * 0.05, y + h * 0.15); ctx.closePath(); ctx.fill(); }); }
    };
    peaks(0.78, 0.55, 6, '#8aa0c8', '#c8d8f0', true); peaks(0.9, 0.38, 8, '#3d8a5a', '#1f6a3a', false);
    ctx.fillStyle = '#2f9a4a'; ctx.fillRect(0, h * 0.9, w, h * 0.1);
    for (let i = 0; i < 7; i++) pine(ctx, w * (0.06 + i * 0.15 + r() * 0.05), h * 0.97, h * (0.34 + r() * 0.16), '#1f6a3a', '#34a05a');
    // chalet
    const cx = w * 0.7; ctx.fillStyle = '#8a4a28'; ctx.fillRect(cx - h * 0.13, h * 0.72, h * 0.26, h * 0.2); ctx.fillStyle = '#c8283a'; ctx.beginPath(); ctx.moveTo(cx - h * 0.18, h * 0.72); ctx.lineTo(cx, h * 0.56); ctx.lineTo(cx + h * 0.18, h * 0.72); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe9a0'; ctx.fillRect(cx - h * 0.04, h * 0.78, h * 0.08, h * 0.08);
    for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#ffe27a'; ctx.beginPath(); ctx.arc(w * r(), h * (0.9 + r() * 0.08), h * 0.02, 0, 7); ctx.fill(); }
  },
  space(ctx, w, h, r) {
    vgrad(ctx, w, h, [[0, '#07031f'], [0.5, '#2a0f6a'], [1, '#c8307a']]);
    for (let i = 0; i < 6; i++) glowBlob(ctx, w * r(), h * r(), h * (0.5 + r() * 0.6), ['rgba(255,60,200,0.5)', 'rgba(60,220,255,0.4)', 'rgba(140,80,255,0.5)'][i % 3]);
    for (let i = 0; i < 70; i++) { const x = w * r(); const y = h * r(); ctx.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; ctx.beginPath(); ctx.arc(x, y, 0.5 + r() * 1.2, 0, 7); ctx.fill(); }
    for (let i = 0; i < 5; i++) sparkle(ctx, w * r(), h * r() * 0.8, h * (0.04 + r() * 0.05), '#fff');
    const px = w * 0.72; const py = h * 0.5; const pr = h * 0.34;
    ctx.save(); ctx.translate(px, py); ctx.rotate(-0.35); ctx.strokeStyle = 'rgba(255,220,150,0.6)'; ctx.lineWidth = pr * 0.28; ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.7, pr * 0.45, 0, Math.PI, 2 * Math.PI); ctx.stroke(); ctx.restore();
    ball(ctx, px, py, pr, '#ffe9b0', '#ff9a3a', '#7a1a5a');
    ctx.save(); ctx.translate(px, py); ctx.rotate(-0.35); ctx.strokeStyle = 'rgba(255,230,170,0.95)'; ctx.lineWidth = pr * 0.2; ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.7, pr * 0.45, 0, 0, Math.PI); ctx.stroke(); ctx.restore();
    ball(ctx, w * 0.2, h * 0.22, h * 0.13, '#c8f8ff', '#33b8e8', '#0a3a7a');
    ball(ctx, w * 0.42, h * 0.78, h * 0.07, '#ffd0f0', '#ff4fb8', '#6a1a6a');
    // rocket
    ctx.save(); ctx.translate(w * 0.42, h * 0.46); ctx.rotate(0.9); const L = h * 0.5;
    glowBlob(ctx, 0, L * 0.7, L * 0.7, 'rgba(255,200,60,0.9)'); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.moveTo(-L * 0.12, L * 0.38); ctx.quadraticCurveTo(0, L * 1.1, L * 0.12, L * 0.38); ctx.fill();
    ctx.fillStyle = '#f4f4ff'; ctx.beginPath(); ctx.moveTo(0, -L * 0.5); ctx.quadraticCurveTo(L * 0.26, -L * 0.1, L * 0.18, L * 0.4); ctx.lineTo(-L * 0.18, L * 0.4); ctx.quadraticCurveTo(-L * 0.26, -L * 0.1, 0, -L * 0.5); ctx.fill();
    ctx.fillStyle = '#e8283a'; ctx.beginPath(); ctx.moveTo(0, -L * 0.5); ctx.quadraticCurveTo(L * 0.14, -L * 0.34, L * 0.15, -L * 0.2); ctx.lineTo(-L * 0.15, -L * 0.2); ctx.quadraticCurveTo(-L * 0.14, -L * 0.34, 0, -L * 0.5); ctx.fill();
    ctx.beginPath(); ctx.moveTo(L * 0.18, L * 0.1); ctx.lineTo(L * 0.34, L * 0.5); ctx.lineTo(L * 0.18, L * 0.4); ctx.fill(); ctx.beginPath(); ctx.moveTo(-L * 0.18, L * 0.1); ctx.lineTo(-L * 0.34, L * 0.5); ctx.lineTo(-L * 0.18, L * 0.4); ctx.fill();
    ball(ctx, 0, 0, L * 0.1, '#e8fbff', '#3ab8e8', '#124a7a'); ctx.restore();
  },
  circus(ctx, w, h, r) {
    vgrad(ctx, w, h, [[0, '#6a0a2a'], [1, '#e8283a']]);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,244,214,0.95)' : 'rgba(255,200,60,0.0)'; ctx.beginPath(); ctx.moveTo(w / 2, -h * 0.2); ctx.lineTo(w * (i / 14 * 1.6 - 0.3), h); ctx.lineTo(w * ((i + 1) / 14 * 1.6 - 0.3), h); ctx.closePath(); ctx.fill(); }
    glowBlob(ctx, w * 0.5, h * 0.9, h * 1.1, 'rgba(255,230,140,0.85)'); glowBlob(ctx, w * 0.2, h * 0.2, h * 0.6, 'rgba(255,255,255,0.35)'); glowBlob(ctx, w * 0.8, h * 0.2, h * 0.6, 'rgba(255,255,255,0.35)');
    for (let i = 0; i < 9; i++) sparkle(ctx, w * r(), h * r() * 0.8, h * (0.05 + r() * 0.07), ['#ffd23c', '#ffffff', '#ffb030'][i % 3]);
    // balloons
    [[0.14, 0.45, '#2d6fe0'], [0.22, 0.3, '#ffd23c'], [0.82, 0.4, '#2fc35a'], [0.9, 0.55, '#ff4fb8'], [0.74, 0.25, '#2d6fe0']].forEach(([x, y, c]) => { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * x, h * (y + 0.2)); ctx.quadraticCurveTo(w * (x + 0.03), h * 0.8, w * (x - 0.02), h); ctx.stroke(); ball(ctx, w * x, h * y, h * 0.16, '#ffffff', c, '#10203a'); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(w * x - h * 0.05, h * y - h * 0.06, h * 0.035, h * 0.05, -0.6, 0, 7); ctx.fill(); });
    // a top hat and star
    ctx.fillStyle = '#17121a'; ctx.fillRect(w * 0.42, h * 0.3, w * 0.16, h * 0.3); ctx.fillRect(w * 0.37, h * 0.58, w * 0.26, h * 0.08); ctx.fillStyle = '#e8283a'; ctx.fillRect(w * 0.42, h * 0.52, w * 0.16, h * 0.06);
    star(ctx, w * 0.5, h * 0.2, h * 0.12, '#ffd23c');
  },
  sea(ctx, w, h, r) {
    vgrad(ctx, w, h, [[0, '#18c8e8'], [0.5, '#0a78c8'], [1, '#062a6a']]);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; const x = w * (0.1 + i * 0.2 + r() * 0.1); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * 0.12, 0); ctx.lineTo(x + w * 0.02 + w * 0.2, h); ctx.lineTo(x - w * 0.1, h); ctx.closePath(); ctx.fill(); }
    glowBlob(ctx, w * 0.5, -h * 0.1, h * 0.9, 'rgba(255,255,255,0.55)');
    for (let i = 0; i < 6; i++) { fish(ctx, w * r(), h * (0.2 + r() * 0.5), h * (0.18 + r() * 0.14), ['#ffe84a', '#ff7a3a', '#ff4fb8', '#7affb0', '#ffffff'][i % 5], ['#ff8a1a', '#e82a5a', '#6a2ad8', '#10a870', '#7ab8ff'][i % 5], r() < 0.5 ? 1 : -1); }
    // jellyfish
    const jx = w * 0.8; const jy = h * 0.35; ctx.fillStyle = 'rgba(255,140,220,0.85)'; ctx.beginPath(); ctx.ellipse(jx, jy, h * 0.17, h * 0.13, 0, Math.PI, 0); ctx.fill(); ctx.strokeStyle = 'rgba(255,170,230,0.8)'; ctx.lineWidth = 2; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(jx + k * h * 0.06, jy); ctx.quadraticCurveTo(jx + k * h * 0.1 + h * 0.04, jy + h * 0.2, jx + k * h * 0.05, jy + h * 0.4); ctx.stroke(); }
    for (let j = 0; j < 3; j++) { ctx.strokeStyle = ['rgba(255,255,255,0.9)', 'rgba(140,230,255,0.8)', 'rgba(40,120,200,0.9)'][j]; ctx.lineWidth = Math.max(2, h * 0.07); ctx.beginPath(); for (let x = 0; x <= w; x += 3) { const y = h * (0.82 + j * 0.07) + Math.sin(x * 0.08 + j * 2) * h * 0.04; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    for (let i = 0; i < 16; i++) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w * r(), h * (0.1 + r() * 0.7), 1 + r() * 3, 0, 7); ctx.stroke(); }
  },
  comic(ctx, w, h, r) {
    ctx.fillStyle = '#ffd81f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,60,120,0.55)'; const st = Math.max(5, h * 0.11); for (let y = 0; y < h + st; y += st) for (let x = (y / st) % 2 ? st / 2 : 0; x < w + st; x += st) { ctx.beginPath(); ctx.arc(x, y, st * 0.3 * (1 - y / h * 0.5), 0, 7); ctx.fill(); }
    const cx = w * 0.5; const cy = h * 0.52; ctx.beginPath(); for (let i = 0; i < 24; i++) { const a = Math.PI * 2 * i / 24; const rr = i % 2 ? h * 0.52 : h * 0.86; ctx.lineTo(cx + Math.cos(a) * rr * 1.5, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = '#ff3a2a'; ctx.fill(); ctx.lineWidth = Math.max(2, h * 0.05); ctx.strokeStyle = '#17121a'; ctx.stroke();
    ctx.save(); ctx.beginPath(); for (let i = 0; i < 24; i++) { const a = Math.PI * 2 * i / 24; const rr = i % 2 ? h * 0.36 : h * 0.62; ctx.lineTo(cx + Math.cos(a) * rr * 1.5, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = '#ffe84a'; ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.08); fitText(ctx, ['POW!', 'WOW!', 'ZAP!', 'BOOM!'][Math.floor(r() * 4)], 0, 0, w * 0.5, h * 0.5, FONT_SANS, '#2a6fe8', { stroke: '#17121a', strokeW: h * 0.09 }); ctx.restore();
    ctx.fillStyle = '#17121a'; ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.05); ctx.lineTo(w * 0.2, h * 0.4); ctx.lineTo(w * 0.15, h * 0.4); ctx.lineTo(w * 0.22, h * 0.8); ctx.lineTo(w * 0.1, h * 0.46); ctx.lineTo(w * 0.15, h * 0.46); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#4fe8ff'; ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.1); ctx.lineTo(w * 0.17, h * 0.38); ctx.lineTo(w * 0.13, h * 0.38); ctx.lineTo(w * 0.19, h * 0.7); ctx.lineTo(w * 0.11, h * 0.46); ctx.lineTo(w * 0.15, h * 0.44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#17121a'; ctx.lineWidth = Math.max(2, h * 0.04); ctx.beginPath(); ctx.ellipse(w * 0.86, h * 0.26, h * 0.2, h * 0.14, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w * 0.82, h * 0.36); ctx.lineTo(w * 0.78, h * 0.5); ctx.lineTo(w * 0.88, h * 0.38); ctx.fill(); ctx.stroke();
  },
  jungle(ctx, w, h, r) {
    vgrad(ctx, w, h, [[0, '#08a888'], [0.5, '#7ad86a'], [1, '#f0e870']]);
    glowBlob(ctx, w * 0.78, h * 0.25, h * 0.75, 'rgba(255,250,170,0.95)'); ball(ctx, w * 0.78, h * 0.25, h * 0.1, '#fffbd0', '#ffe060', '#ffa020');
    for (let i = 0; i < 9; i++) leaf(ctx, w * (i % 2 ? 0.02 : 0.98) + w * 0.02 * r(), h * (0.15 + r() * 0.8), h * (0.7 + r() * 0.5), (i % 2 ? 0 : Math.PI) + (r() - 0.5) * 1.4, ['#0a7a3a', '#169a48', '#0e6a38'][i % 3], ['#5ad868', '#2ab05a', '#8af070'][i % 3]);
    for (let i = 0; i < 6; i++) leaf(ctx, w * (0.25 + r() * 0.5), h * 1.02, h * (0.5 + r() * 0.4), -Math.PI / 2 + (r() - 0.5) * 1.5, '#0a6a34', '#46c860');
    // toucan on a branch
    ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = h * 0.06; ctx.beginPath(); ctx.moveTo(w * 0.28, h * 0.78); ctx.quadraticCurveTo(w * 0.5, h * 0.7, w * 0.7, h * 0.8); ctx.stroke();
    const tx = w * 0.46; const ty = h * 0.55; ctx.fillStyle = '#15121a'; ctx.beginPath(); ctx.ellipse(tx, ty, h * 0.17, h * 0.23, -0.3, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(tx + h * 0.06, ty - h * 0.07, h * 0.1, h * 0.12, -0.3, 0, 7); ctx.fill();
    const bg = ctx.createLinearGradient(tx, ty, tx + h * 0.4, ty); bg.addColorStop(0, '#ffd23c'); bg.addColorStop(0.6, '#ff8a1a'); bg.addColorStop(1, '#e8283a'); ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(tx + h * 0.1, ty - h * 0.24); ctx.quadraticCurveTo(tx + h * 0.5, ty - h * 0.28, tx + h * 0.55, ty - h * 0.06); ctx.quadraticCurveTo(tx + h * 0.3, ty - h * 0.1, tx + h * 0.1, ty - h * 0.08); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tx + h * 0.12, ty - h * 0.2, h * 0.04, 0, 7); ctx.fill(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(tx + h * 0.13, ty - h * 0.2, h * 0.02, 0, 7); ctx.fill();
    for (let i = 0; i < 4; i++) { const hx = w * (0.62 + r() * 0.3); const hy = h * (0.5 + r() * 0.35); for (let k = 0; k < 5; k++) { const a = Math.PI * 2 * k / 5; ctx.fillStyle = ['#ff3a7a', '#ff8a1a'][i % 2]; ctx.beginPath(); ctx.ellipse(hx + Math.cos(a) * h * 0.06, hy + Math.sin(a) * h * 0.06, h * 0.06, h * 0.035, a, 0, 7); ctx.fill(); } ctx.fillStyle = '#ffe84a'; ctx.beginPath(); ctx.arc(hx, hy, h * 0.025, 0, 7); ctx.fill(); }
  },
};
/** one of the six airbrush themes (by name or kind index) painted into a w x h slot; look 1 (neon) adds a violet overlay, look 2 a cooler cast */
export function airbrushPainter(theme, seed = 1, look = 0) {
  const name = typeof theme === 'number' ? MURAL_THEMES[theme % MURAL_THEMES.length] : theme;
  return (ctx, w, h) => {
    const r = rng(seed + 11);
    (AIR[name] || AIR.alpine)(ctx, w, h, r);
    if (look === 1) { ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = 'rgba(140,50,230,0.35)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
    else if (look === 2) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(40,110,230,0.3)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; }
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d6a436'; ctx.lineWidth = Math.max(2, h * 0.06); ctx.strokeRect(0, 0, w, h);
  };
}

/** painted murals for cornice panels / backdrops: kind 0..5 = the six airbrush themes (alpine, space, circus, sea, comic, jungle), 6 hearts-and-stars print, 7 rosette */
export function muralPainter(kind, seed = 1, look = 0) {
  if (kind <= 5) return airbrushPainter(kind, seed, look);
  return (ctx, w, h) => {
    let s = seed * 9301 + 49297; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    if (kind === 6) {
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
