/* The Kaart (the minimap) of Lux Drive: the roads around the car, drawn on a canvas.
 *
 * The map is turned with the car (the car always points up).  The painted base (woods, fields, town, water) comes from the
 * shared basemap canvas; the roads come from the shared road index, so only the segments near the car are walked. */
const VIEW_M = 700;               // m, the width of the map around the car
const ROAD_FILL = '#fffaf0';
const ROAD_CASING = '#6d6657';
const MAJOR_FILL = '#ffd27a';
const MOTORWAY_FILL = '#f2a14a';
const BORDER = 'rgba(255,255,255,0.5)';

export function createMinimap({ canvas, index, basemap, area = null }) {
  const ctx = canvas.getContext('2d');

  /** Draws the map around (x, z) with the heading (the car points up). */
  function draw(x, z, heading) {
    const w = canvas.width, h = canvas.height;
    const scale = w / VIEW_M;                        // px per metre
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#9fb184';
    ctx.fillRect(0, 0, w, h);
    // the world frame -> the canvas: the car in the middle, its heading pointing up
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-heading - Math.PI / 2);
    ctx.scale(scale, scale);
    ctx.translate(-x, -z);
    if (basemap) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(basemap.canvas, 0, 0, basemap.canvas.width * basemap.cell, basemap.canvas.height * basemap.cell);
    }
    if (area && area.ring && area.ring.length > 2) {
      ctx.beginPath();
      area.ring.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 3 / scale;
      ctx.setLineDash([10 / scale, 8 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const half = VIEW_M * 0.75;                      // the rotated square needs a margin
    const groups = { minor: [], major: [], motorway: [] };
    index.forEach(x - half, z - half, x + half, z + half, (s) => {
      groups[s.road.kind === 'motorway' || s.road.kind === 'trunk' ? 'motorway' : s.major ? 'major' : 'minor'].push(s);
    });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (list, colour, widthOf) => {
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (const s of list) { ctx.moveTo(s.ax, s.az); ctx.lineTo(s.bx, s.bz); }
      ctx.lineWidth = widthOf;
      ctx.stroke();
    };
    const px = 1 / scale;                            // one canvas pixel in metres
    for (const [list, fill, base] of [[groups.minor, ROAD_FILL, 4.5], [groups.major, MAJOR_FILL, 8], [groups.motorway, MOTORWAY_FILL, 11]]) {
      const width = Math.max(base, 2.6 * px);
      stroke(list, ROAD_CASING, width + 2.4 * px);
      stroke(list, fill, width);
    }
    // the car: a triangle that points up (the transform is undone first)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ff6b4a';
    ctx.strokeStyle = '#241f1c';
    ctx.lineWidth = Math.max(1.5, w / 120);
    const u = w / 120;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - 8 * u);
    ctx.lineTo(w / 2 + 5.5 * u, h / 2 + 6 * u);
    ctx.lineTo(w / 2, h / 2 + 3.2 * u);
    ctx.lineTo(w / 2 - 5.5 * u, h / 2 + 6 * u);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  return { draw };
}
