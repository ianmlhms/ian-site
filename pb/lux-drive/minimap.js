/* The Kaart (the minimap) of Lux Drive: the roads around the car, drawn on a canvas.
 *
 * The road network is far too big to draw every frame, so the segments live in a spatial hash and only the ones near the
 * car are drawn. The map is turned with the car (the car always points up). */
import { drivableRoads } from './roads.js';

const CELL = 128;                 // m, the cell of the spatial hash of the segments
const VIEW_M = 900;               // m, the width of the map around the car
const ROAD_COLOUR = '#f3efe4';
const ROAD_EDGE = '#3b3a36';
const ROAD_MAJOR = '#ffd98a';

export function createMinimap({ canvas, roads, area = null }) {
  const ctx = canvas.getContext('2d');
  const segments = [];
  const cells = new Map();
  const key = (cx, cz) => cx * 8192 + cz;
  for (const road of drivableRoads(roads)) {
    const major = road.kind === 'motorway' || road.kind === 'trunk' || road.kind === 'primary' || road.kind === 'secondary';
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], w: road.width, major, name: road.name };
      segments.push(seg);
      const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
      const minZ = Math.min(a[1], b[1]), maxZ = Math.max(a[1], b[1]);
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const k = key(cx, cz);
          const list = cells.get(k);
          if (list) list.push(seg); else cells.set(k, [seg]);
        }
      }
    }
  }

  /** Draws the map around (x, z) with the heading (the car points up). */
  function draw(x, z, heading) {
    const w = canvas.width, h = canvas.height;
    const scale = w / VIEW_M;                        // px per metre
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#2b3a2c';
    ctx.fillRect(0, 0, w, h);
    // the play area (a soft border)
    if (area && area.ring && area.ring.length > 2) {
      ctx.beginPath();
      const first = area.ring[0];
      ctx.moveTo((first[0] - x) * scale, (first[1] - z) * scale);
      for (const p of area.ring) ctx.lineTo((p[0] - x) * scale, (p[1] - z) * scale);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // the roads near the car
    const cx0 = Math.floor((x - VIEW_M) / CELL), cx1 = Math.floor((x + VIEW_M) / CELL);
    const cz0 = Math.floor((z - VIEW_M) / CELL), cz1 = Math.floor((z + VIEW_M) / CELL);
    const cos = Math.cos(-heading), sin = Math.sin(-heading);
    const project = (px, pz) => {
      const dx = (px - x) * scale, dz = (pz - z) * scale;
      return [dx * cos - dz * sin, dx * sin + dz * cos];
    };
    const seen = new Set();
    ctx.lineCap = 'round';
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (const s of list) {
          if (seen.has(s)) continue;
          seen.add(s);
          const [ax, az] = project(s.ax, s.az);
          const [bx, bz] = project(s.bx, s.bz);
          if (Math.max(ax, bx) < -w || Math.min(ax, bx) > w * 2 || Math.max(az, bz) < -h || Math.min(az, bz) > h * 2) continue;
          ctx.strokeStyle = ROAD_EDGE;
          ctx.lineWidth = Math.max(1.6, s.w * scale);
          ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
          ctx.strokeStyle = s.major ? ROAD_MAJOR : ROAD_COLOUR;
          ctx.lineWidth = Math.max(1, s.w * scale * 0.62);
          ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
        }
      }
    }
    // the car: a triangle that points up
    ctx.fillStyle = '#ff6b4a';
    ctx.strokeStyle = '#241f1c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - 9);
    ctx.lineTo(w / 2 + 6.5, h / 2 + 7);
    ctx.lineTo(w / 2, h / 2 + 4);
    ctx.lineTo(w / 2 - 6.5, h / 2 + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  return { draw, segments, cell: CELL };
}
