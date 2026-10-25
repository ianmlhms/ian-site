/* The painted valley map for the trail menu: a soft hand-painted look (land cover colours, hillshade, paper noise), the trails on top in their grade colours, the villages
 * and the viewpoints. Pure canvas 2D, built from the same baked data as the world (no photos). */
import { WORLD } from './config.js';

const LAND = Object.freeze({
  0: [104, 134, 92], 1: [66, 112, 74], 2: [168, 202, 118], 3: [226, 208, 132], 4: [204, 116, 96], 5: [96, 146, 212], 6: [176, 164, 142], 7: [124, 154, 96],
});
const GRADE = { green: '#3fbf5a', blue: '#3d8bff', red: '#e5483f', black: '#222222' };
const SHADE_STRENGTH = 0.55;
const hash = (x, y) => { let h = Math.imul(x * 374761393 + y * 668265263, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Builds the backdrop once: { canvas, w, h }. data = { classes: { nx, nz, data }, near: { nx, nz, data } } (the decoded world files). */
export function createMapBackdrop(data, w = 420, h = 460) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const { classes, near } = data;
  const nearAt = (x, z) => near.data[Math.min(near.nz - 1, Math.max(0, Math.round(z / WORLD.nearStep))) * near.nx + Math.min(near.nx - 1, Math.max(0, Math.round(x / WORLD.nearStep)))];
  const cell = 4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * WORLD.width / w, z = (j + 0.5) * WORLD.depth / h;
      const ci = Math.min(classes.nx - 1, Math.floor(x / cell)), cj = Math.min(classes.nz - 1, Math.floor(z / cell));
      const c = LAND[classes.data[cj * classes.nx + ci]] || LAND[0];
      const e = 24;
      const dx = (nearAt(x + e, z) - nearAt(x - e, z)) / (2 * e), dz = (nearAt(x, z + e) - nearAt(x, z - e)) / (2 * e);
      const shade = 1 + SHADE_STRENGTH * Math.max(-0.5, Math.min(0.5, -(dx * 0.7 + dz * 0.7) * 3));
      const grain = 0.94 + 0.12 * hash(i, j);
      const o = (j * w + i) * 4;
      img.data[o] = Math.min(255, c[0] * shade * grain); img.data[o + 1] = Math.min(255, c[1] * shade * grain); img.data[o + 2] = Math.min(255, c[2] * shade * grain); img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, w, h };
}

const toMap = (map, x, z) => [x * map.backdrop.w / WORLD.width, z * map.backdrop.h / WORLD.depth];

/** Draws the map into `canvas`. map = { backdrop, villages [{name, x, z}], viewpoints [{x, z}], found Set, rider {x, z, heading} }. */
export function paintValleyMap(canvas, map, opts) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(map.backdrop.canvas, 0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const tr of opts.trails) {
    const pts = tr.line.map(([x, z]) => toMap(map, x, z));
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W / map.backdrop.w, y * H / map.backdrop.h) : ctx.moveTo(x * W / map.backdrop.w, y * H / map.backdrop.h))); };
    ctx.setLineDash([]);
    path(); ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = tr.current ? 7 : 5.5; ctx.stroke();
    path(); ctx.strokeStyle = tr.locked ? '#8a8a8a' : GRADE[tr.grade]; ctx.lineWidth = tr.current ? 4.2 : 3; if (tr.locked) ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    const [sx, sy] = pts[0];
    ctx.beginPath(); ctx.arc(sx * W / map.backdrop.w, sy * H / map.backdrop.h, tr.current ? 6.5 : 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = tr.locked ? '#8a8a8a' : GRADE[tr.grade]; ctx.stroke();
  }
  ctx.font = '600 11px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const v of map.villages || []) {
    const [x, y] = toMap(map, v.x, v.z);
    const px = x * W / map.backdrop.w, py = y * H / map.backdrop.h;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(v.name, px, py); ctx.fillStyle = '#3a2a1a'; ctx.fillText(v.name, px, py);
  }
  (map.viewpoints || []).forEach((v, i) => {
    const [x, y] = toMap(map, v.x, v.z);
    const px = x * W / map.backdrop.w, py = y * H / map.backdrop.h;
    const got = map.found && map.found.has(i);
    ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + 3.5, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 3.5, py); ctx.closePath();
    ctx.fillStyle = got ? '#ff9a2e' : 'rgba(255,255,255,0.75)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = got ? '#8a4a00' : 'rgba(60,40,20,0.6)'; ctx.stroke();
  });
  if (map.rider) {
    const [x, y] = toMap(map, map.rider.x, map.rider.z);
    const px = x * W / map.backdrop.w, py = y * H / map.backdrop.h;
    ctx.save(); ctx.translate(px, py); ctx.rotate(map.rider.heading || 0);
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 5); ctx.lineTo(-3, 0); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#222'; ctx.stroke(); ctx.restore();
  }
}

/** Which trail is at canvas point (px, py)? Nearest start point within 14 px, or any trail line within 9 px. */
export function hitTestTrail(canvas, map, trails, px, py) {
  const k = canvas.width / map.backdrop.w;
  let best = null, bd = 1e9;
  for (const tr of trails) {
    const pts = tr.line;
    const [sx, sy] = toMap(map, pts[0][0], pts[0][1]);
    const ds = Math.hypot(sx * k - px, sy * k - py);
    if (ds < 14 && ds < bd) { bd = ds; best = tr.id; }
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = toMap(map, pts[i][0], pts[i][1]);
      const d = Math.hypot(x * k - px, y * k - py);
      if (d < 9 && d + 2 < bd) { bd = d + 2; best = tr.id; }
    }
  }
  return best;
}
