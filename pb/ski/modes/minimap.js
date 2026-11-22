/* The free ride minimap (round 4A): a small north-up canvas in the HUD, ~1.4 km across around the skier: the painted map base
 * (map.webp), the piste lines in their colours, the lifts, the park, the skier as an arrow, and an N for the compass. Redrawn a few
 * times a second (main.js calls draw at the HUD rate), never per frame. */
import { DIFF } from '../config.js';

const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };
const SIZE = 132;               // CSS px
const SPAN = 1400;              // m across
const MAP_DELAY_MS = 4000;      // R7-D

export function createMinimap({ parent, resort, imageUrl, park = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.innerHTML = `<canvas width="${SIZE}" height="${SIZE}" aria-label="Kaart ronderëm"></canvas><b class="north">N</b>`;
  parent.appendChild(wrap);
  const canvas = wrap.querySelector('canvas');
  const k = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = SIZE * k; canvas.height = SIZE * k;
  canvas.style.width = canvas.style.height = `${SIZE}px`;
  const g = canvas.getContext('2d');
  const img = new Image();
  let ready = false;
  img.onload = () => { ready = true; };
  img.onerror = () => console.warn('[ski] minimap: map image failed');
  // R7-D: first play: the painted base (0.3-0.7 MB) waits until the tiles round the start had the bandwidth; the lines draw at once
  setTimeout(() => { img.src = imageUrl; }, MAP_DELAY_MS);
  // bounding boxes of the network lines and lifts (skip what is far away)
  const lines = resort.network.filter((n) => !n.a).map((n) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n.p.length; i += 2) { x0 = Math.min(x0, n.p[i]); x1 = Math.max(x1, n.p[i]); z0 = Math.min(z0, n.p[i + 1]); z1 = Math.max(z1, n.p[i + 1]); }
    return { p: n.p, col: DIFF[DIFF_OF_LETTER[n.d] || 'blue'].css, box: [x0, z0, x1, z1] };
  });
  const lifts = resort.lifts.filter((l) => l.kind !== 'carpet');

  function draw(x, z, heading) {
    const s = SIZE / SPAN;
    const sx = (wx) => (wx - x) * s + SIZE / 2, sz = (wz) => (wz - z) * s + SIZE / 2;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#e9edf3'; g.fillRect(0, 0, SIZE, SIZE);
    if (ready) g.drawImage(img, sx(0), sz(0), resort.width * s, resort.depth * s);
    const half = SPAN / 2 + 50;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const l of lines) {
      if (l.box[2] < x - half || l.box[0] > x + half || l.box[3] < z - half || l.box[1] > z + half) continue;
      g.beginPath();
      for (let i = 0; i < l.p.length; i += 2) { const X = sx(l.p[i]), Y = sz(l.p[i + 1]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
      g.strokeStyle = '#ffffffcc'; g.lineWidth = 3.4; g.stroke();
      g.strokeStyle = l.col; g.lineWidth = 2; g.stroke();
    }
    g.strokeStyle = '#16171a'; g.lineWidth = 1;
    for (const l of lifts) {
      const p = l.pts;
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) { const X = sx(p[i]), Y = sz(p[i + 1]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
      g.stroke();
    }
    if (park) {
      g.strokeStyle = '#6b3fa0'; g.lineWidth = 4; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(sx(park.line[0]), sz(park.line[1])); g.lineTo(sx(park.line[2]), sz(park.line[3])); g.stroke();
      g.globalAlpha = 1;
    }
    // the skier: an arrow pointing along the heading
    g.save();
    g.translate(SIZE / 2, SIZE / 2); g.rotate(heading);
    g.fillStyle = '#d0352c'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, 5); g.lineTo(-3, 0); g.lineTo(-6, -5); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  return { el: wrap, draw, show(v) { wrap.hidden = !v; }, dispose() { wrap.remove(); } };
}
