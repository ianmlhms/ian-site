/* The free ride minimap (round 4A): a small north-up canvas in the HUD, ~1.4 km across around the skier: the painted map base
 * (map.webp), the piste lines in their colours, the lifts, the park, the skier as an arrow, and an N for the compass. Redrawn a few
 * times a second (main.js calls draw at the HUD rate), never per frame.
 * Map clarity (22 Nov 2026): an orange arrow with a view cone, the piste you are on drawn thicker, the nearest lift's name. */
import { DIFF } from '../config.js';

const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };
const SIZE = 132;               // CSS px
const SPAN = 1400;              // m across
const MAP_DELAY_MS = 4000;      // R7-D
const LIFT_NAME_M = 450;        // map clarity: the nearest lift's bottom within this many metres gets its name on the minimap

export function createMinimap({ parent, resort, imageUrl, park = null, onOpen = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.innerHTML = `<canvas width="${SIZE}" height="${SIZE}" aria-hidden="true"></canvas><b class="north">N</b>`;
  parent.appendChild(wrap);
  // launch (Ian: the map easier to reach): a tap / click on the minimap opens the full map, like the M key / the menu's map
  if (onOpen) {
    wrap.classList.add('open');
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'Kaart opmaachen');
    wrap.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); wrap.blur(); onOpen(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen(); } });
  }
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

  function draw(x, z, heading, current = null) {
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
    // map clarity: the piste you are on, thicker, on top of the others
    if (current && current.x) {
      g.beginPath();
      for (let i = 0; i < current.n; i++) { const X = sx(current.x[i]), Y = sz(current.z[i]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
      g.strokeStyle = '#ffffff'; g.lineWidth = 6.5; g.stroke();
      g.strokeStyle = DIFF[current.diff] ? DIFF[current.diff].css : '#2a66d0'; g.lineWidth = 4; g.stroke();
    }
    // lifts: black over a white casing, white bottom station dots; the nearest one (bottom within LIFT_NAME_M) gets its name
    let near = null, nd = LIFT_NAME_M;
    for (const l of lifts) {
      const p = l.pts;
      if (Math.max(p[0], p[p.length - 2]) < x - half || Math.min(p[0], p[p.length - 2]) > x + half || Math.max(p[1], p[p.length - 1]) < z - half || Math.min(p[1], p[p.length - 1]) > z + half) continue;
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) { const X = sx(p[i]), Y = sz(p[i + 1]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
      g.strokeStyle = '#ffffffd0'; g.lineWidth = 2.6; g.stroke();
      g.strokeStyle = '#16171a'; g.lineWidth = 1.2; g.stroke();
      const X = sx(p[0]), Y = sz(p[1]);
      g.fillStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(X, Y, 2.4, 0, Math.PI * 2); g.fill(); g.stroke();
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (l.name && d < nd) { nd = d; near = l; }
    }
    if (park) {
      g.strokeStyle = '#6b3fa0'; g.lineWidth = 4; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(sx(park.line[0]), sz(park.line[1])); g.lineTo(sx(park.line[2]), sz(park.line[3])); g.stroke();
      g.globalAlpha = 1;
    }
    // the nearest lift's name in a small pill (kept inside the frame)
    if (near) {
      g.font = '700 9.5px Geist, system-ui, sans-serif';
      const text = near.name.length > 20 ? near.name.slice(0, 19) + '…' : near.name, tw = g.measureText(text).width;
      const X = Math.max(tw / 2 + 4, Math.min(SIZE - tw / 2 - 4, sx(near.pts[0])));
      let Y = Math.max(22, Math.min(SIZE - 8, sz(near.pts[1]) + 11));
      if (Math.abs(Y - SIZE / 2) < 16 && Math.abs(X - SIZE / 2) < tw / 2 + 12) Y = SIZE / 2 + (Y < SIZE / 2 ? -20 : 20);      // never over the arrow
      g.fillStyle = '#16171ae0'; g.fillRect(X - tw / 2 - 3, Y - 7, tw + 6, 13);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, X, Y);
    }
    // the view cone, then the skier: an orange arrow (as on the big map; red vanished on the red pistes) pointing along the heading
    const cone = g.createRadialGradient(SIZE / 2, SIZE / 2, 3, SIZE / 2, SIZE / 2, 40);
    cone.addColorStop(0, 'rgba(255,106,0,0.5)'); cone.addColorStop(1, 'rgba(255,106,0,0)');
    g.fillStyle = cone;
    g.beginPath(); g.moveTo(SIZE / 2, SIZE / 2); g.arc(SIZE / 2, SIZE / 2, 40, heading - 0.5, heading + 0.5); g.closePath(); g.fill();
    g.save();
    g.translate(SIZE / 2, SIZE / 2); g.rotate(heading);
    g.fillStyle = '#ff6a00'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-7, 6); g.lineTo(-3.5, 0); g.lineTo(-7, -6); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }
  return { el: wrap, draw, show(v) { wrap.hidden = !v; }, dispose() { wrap.remove(); } };
}
