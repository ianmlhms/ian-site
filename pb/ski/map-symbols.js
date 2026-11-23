/* The printed piste map's signs (Canvas 2D, own drawing): lift pictograms, piste number discs, flags, park / landmark signs, the compass,
 * the title and the print credits. All sizes are CSS px. Pure drawing, no state. */
export const INK = '#1a1d24';
export const LIFT_PICK = '#ffc400';
export const YOU = '#ff6a00';              // the skier's marker: no piste colour, no lift black
export const VIOLET = '#6b3fa0';
export const FONT = 'Geist, system-ui, sans-serif';

/** Undiscovered pistes are printed in a softer ink of the same colour. */
export const SOFT = Object.freeze({ green: '#58b471', blue: '#588ae4', red: '#e1635a', black: '#5d6168' });

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

/** The kind a lift is drawn as: 'chair' | 'gondola' | 'cable' | 'drag' | 'train' | 'funicular'. */
export function liftSign(src) {
  const k = src.kind, t = src.type || '';
  if (k === 'funicular' || t === 'funicular') return 'funicular';
  if (k === 'train' || /railway|rail/.test(t)) return 'train';
  if (k === 'cable' || t === 'cable_car') return 'cable';
  if (k === 'gondola') return 'gondola';
  if (k === 'drag' || k === 'carpet') return 'drag';
  return 'chair';
}

/** A lift pictogram in a round ink badge (radius r) at (x, y). */
export function liftBadge(g, x, y, r, sign, { bg = INK, fg = '#ffffff', ring = '#ffffff' } = {}) {
  g.save();
  g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.strokeStyle = ring; g.lineWidth = 1.5; g.stroke();
  const u = r / 10;                                  // the pictograms are drawn on a 20-unit disc
  g.scale(u, u);
  g.strokeStyle = fg; g.fillStyle = fg; g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = 1.6;
  const L = (...p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
  if (sign === 'chair') {
    L(-6.4, -3.6, 6.4, -6.2); L(0.3, -4.9, 0.3, -1.2);
    g.lineWidth = 1.9; L(-3.4, -1.2, -3.4, 3.4, 3.6, 3.4); L(-1.6, 3.4, -1.6, 5.8);
    g.lineWidth = 1.3; L(0.3, -1.2, 0.3, 3.2); L(-3.4, -1.2, 0.3, -1.2);
  } else if (sign === 'gondola') {
    L(-6.6, -4.6, 6.6, -6.6); L(0, -5.4, 0, -3);
    roundRect(g, -4.2, -3, 8.4, 8.6, 2); g.fill();
    g.fillStyle = bg; roundRect(g, -2.9, -1.5, 5.8, 3.2, 0.8); g.fill();
  } else if (sign === 'cable') {
    L(-7, -5.2, 7, -7); L(-7, -3.4, 7, -5.2); L(0, -4.2, 0, -2.2);
    roundRect(g, -6, -2.2, 12, 7.6, 1.4); g.fill();
    g.fillStyle = bg; g.fillRect(-4.7, -0.8, 2.6, 3); g.fillRect(-1.3, -0.8, 2.6, 3); g.fillRect(2.1, -0.8, 2.6, 3);
  } else if (sign === 'drag') {
    L(-6, -4.4, 6, -6.6); L(0.4, -5.5, -0.6, 3.6);
    g.lineWidth = 2.2; L(-4.4, 4.6, 3.4, 3);
  } else {                                           // train / funicular: a carriage (on an inclined track)
    if (sign === 'funicular') g.rotate(-0.42);
    roundRect(g, -5.8, -4.4, 11.6, 7, 1.6); g.fill();
    g.fillStyle = bg; g.fillRect(-4.4, -3, 2.4, 2.6); g.fillRect(-1.2, -3, 2.4, 2.6); g.fillRect(2, -3, 2.4, 2.6);
    g.fillStyle = fg; g.lineWidth = 1.5; L(-7, 5.2, 7, 5.2);
    g.beginPath(); g.arc(-3, 3.6, 1.2, 0, 7); g.arc(3, 3.6, 1.2, 0, 7); g.fill();
  }
  g.restore();
}

/** A piste number: a disc (pill for long numbers) in the piste's colour; undiscovered = white with the colour as ring and figure. */
export function pisteDisc(g, x, y, text, css, done, r, tw) {
  const w = Math.max(r * 2, tw + r * 0.9);
  roundRect(g, x - w / 2, y - r, w, r * 2, r);
  g.fillStyle = done ? css : '#ffffff'; g.fill();
  g.lineWidth = done ? 1.6 : 2; g.strokeStyle = done ? '#ffffff' : css; g.stroke();
  g.fillStyle = done ? '#ffffff' : css;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y + 0.5);
}

/** A start flag (challenge start; gold = stars won). */
export function flag(g, x, y, fill, scale = 1) {
  g.save(); g.translate(x, y); g.scale(scale, scale);
  g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -13); g.lineTo(9, -10); g.lineTo(0, -7); g.stroke();
  g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -13); g.stroke();
  g.fillStyle = fill; g.beginPath(); g.moveTo(0, -13.5); g.lineTo(9, -10); g.lineTo(0, -6.5); g.closePath(); g.fill();
  g.restore();
}

/** A race sign: a chequered disc. */
export function raceSign(g, x, y, r) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.save(); g.clip();
  g.fillStyle = INK;
  const c = r / 2;
  for (let i = -2; i < 2; i++) for (let j = -2; j < 2; j++) if ((i + j) & 1) g.fillRect(i * c, j * c, c, c);
  g.restore();
  g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();
  g.restore();
}

/** The snow park: a violet rounded sign with a kicker and a rail. */
export function parkSign(g, x, y, r) {
  g.save(); g.translate(x, y);
  roundRect(g, -r, -r, r * 2, r * 2, r * 0.4); g.fillStyle = VIOLET; g.fill();
  g.lineWidth = 1.6; g.strokeStyle = '#ffffff'; g.stroke();
  const u = r / 10; g.scale(u, u);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(-7, 5); g.quadraticCurveTo(0, 5, 2.6, -3.6); g.lineTo(2.6, 5); g.closePath(); g.fill();
  g.fillRect(4.2, 5, 3.2, -3); g.beginPath(); g.arc(4.6, -5.2, 1.9, 0, 7); g.fill();
  g.restore();
}

/** A landmark / viewpoint: a violet four-point star in white. */
export function landmarkSign(g, x, y, r = 7) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, q = i & 1 ? r * 0.42 : r; g[i ? 'lineTo' : 'moveTo'](x + Math.sin(a) * q, y - Math.cos(a) * q); }
  g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 3.4; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = VIOLET; g.fill();
}

export function peakSign(g, x, y) {
  g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 5.5, y + 2); g.lineTo(x - 5.5, y + 2); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#3d4350'; g.fill();
}

export function haloText(g, text, x, y, fill, halo = '#ffffffee', w = 3.4) {
  g.lineWidth = w; g.strokeStyle = halo; g.lineJoin = 'round'; g.miterLimit = 2;
  g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
}

/** A compass: the arrow points where north is on the map (angle: screen radians). */
export function compass(g, x, y, ang, r = 19) {
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = 'rgba(252,252,250,.94)'; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(22,23,26,.45)'; g.stroke();
  g.save(); g.rotate(ang);
  g.beginPath(); g.moveTo(r * 0.62, 0); g.lineTo(-r * 0.2, r * 0.32); g.lineTo(-r * 0.04, 0); g.lineTo(-r * 0.2, -r * 0.32); g.closePath();
  g.fillStyle = '#c62f26'; g.fill();
  g.restore();
  g.font = `800 10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  haloText(g, 'N', Math.cos(ang) * r * 0.98, Math.sin(ang) * r * 0.98, INK, '#fff', 3);
  g.restore();
}

/** The skier: view cone, a big orange arrow in a white ring, "Du" in a pill. h = screen heading (null: no cone). */
export function drawYou(g, x, y, h, tw, cone = 64, half = 0.55) {
  if (h !== null) {
    const grad = g.createRadialGradient(x, y, 4, x, y, cone);
    grad.addColorStop(0, 'rgba(255,106,0,0.6)'); grad.addColorStop(1, 'rgba(255,106,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(x, y); g.arc(x, y, cone, h - half, h + half); g.closePath(); g.fill();
  }
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 7;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill();
  g.restore();
  g.fillStyle = YOU; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(x, y); g.rotate(h ?? -Math.PI / 2);
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(8.5, 0); g.lineTo(-5.5, 6.4); g.lineTo(-2.2, 0); g.lineTo(-5.5, -6.4); g.closePath(); g.fill();
  g.restore();
  g.font = `800 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = YOU; g.strokeStyle = '#fff'; g.lineWidth = 2;
  roundRect(g, x - tw / 2 - 8, y - 40, tw + 16, 20, 10); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.fillText('Du', x, y - 29.5);
}

/** Off screen: an arrow at the edge pointing to him. */
export function drawYouEdge(g, x, y, w, h) {
  const m = 30, ex = Math.max(m, Math.min(w - m, x)), ey = Math.max(m, Math.min(h - m, y)), a = Math.atan2(y - ey, x - ex);
  g.save(); g.translate(ex, ey);
  g.fillStyle = YOU; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, 17, 0, Math.PI * 2); g.fill(); g.stroke();
  g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(11, 0); g.lineTo(-3, 7); g.lineTo(-3, -7); g.closePath(); g.fill();
  g.restore();
  g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  haloText(g, 'Du', ex, ey + (ey > h / 2 ? -27 : 27), '#b34400');
}
