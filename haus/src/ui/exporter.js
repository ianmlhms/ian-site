// Export als PNG (Grundriss) und PDF (Druckansicht mit Grundrissen + Kennzahlen).
// Kein PDF-Framework nötig: die Druckansicht nutzt den Browser-Druckdialog ("Als PDF speichern").

import { CELL_SIZE, cellsOf, bbox } from '../core/geometry.js';
import { findRoomType } from '../core/catalog/rooms.js';
import { fullMetrics } from '../core/metrics.js';
import { validateDesign } from '../core/validate.js';
import { mainBuildingOf } from '../core/model.js';

function drawFloorplan(canvas, building, floor, { padding = 40, cell = 26 } = {}) {
  const cols = Math.max(1, Math.round(building.footprint.w / CELL_SIZE));
  const rows = Math.max(1, Math.round(building.footprint.h / CELL_SIZE));
  canvas.width = cols * cell + padding * 2;
  canvas.height = rows * cell + padding * 2 + 40;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#1c2128';
  ctx.fillText(`${building.name} — ${floor.name}`, padding, 26);

  const ox = padding, oy = padding + 40;
  ctx.strokeStyle = '#9aa0aa';
  ctx.strokeRect(ox, oy, cols * cell, rows * cell);

  for (const room of floor.rooms) {
    const rt = findRoomType(room.typeId);
    ctx.fillStyle = rt.color;
    for (const c of cellsOf(room)) ctx.fillRect(ox + c.x * cell, oy + c.y * cell, cell + 0.6, cell + 0.6);
  }
  for (const shaft of building.shafts) {
    ctx.fillStyle = '#8a8f99';
    for (const c of shaft.cells) ctx.fillRect(ox + c.x * cell, oy + c.y * cell, cell + 0.6, cell + 0.6);
  }

  ctx.strokeStyle = '#2c2c2c';
  ctx.lineWidth = 2;
  for (const w of floor.walls) {
    ctx.beginPath();
    ctx.moveTo(ox + w.a.x * cell, oy + w.a.y * cell);
    ctx.lineTo(ox + w.b.x * cell, oy + w.b.y * cell);
    ctx.stroke();
  }
  ctx.strokeStyle = '#a7d0e6';
  ctx.lineWidth = 4;
  for (const o of floor.openings) {
    const wall = floor.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const horizontal = wall.a.y === wall.b.y;
    const x1 = Math.min(wall.a.x, wall.b.x) * cell, y1 = Math.min(wall.a.y, wall.b.y) * cell;
    const offP = (o.offset / CELL_SIZE) * cell, wP = (o.width / CELL_SIZE) * cell;
    ctx.strokeStyle = o.type === 'door' ? '#c9a15a' : '#a7d0e6';
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(ox + x1 + offP, oy + y1); ctx.lineTo(ox + x1 + offP + wP, oy + y1); }
    else { ctx.moveTo(ox + x1, oy + y1 + offP); ctx.lineTo(ox + x1, oy + y1 + offP + wP); }
    ctx.stroke();
  }

  ctx.fillStyle = '#1c2128';
  ctx.font = '11px sans-serif';
  for (const room of floor.rooms) {
    const rt = findRoomType(room.typeId);
    const box = bbox(cellsOf(room));
    const area = (cellsOf(room).length * CELL_SIZE * CELL_SIZE).toFixed(1);
    ctx.fillText(`${room.name || rt.name}`, ox + box.x * cell + 4, oy + box.y * cell + 14);
    ctx.fillText(`${area} m²`, ox + box.x * cell + 4, oy + box.y * cell + 28);
  }
}

export function downloadFloorplanPNG(design, building, floor) {
  const canvas = document.createElement('canvas');
  drawFloorplan(canvas, building, floor);
  const link = document.createElement('a');
  link.download = `${design.name}-${building.name}-${floor.name}.png`.replace(/\s+/g, '_');
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function openPrintableReport(design) {
  const building = mainBuildingOf(design);
  const metrics = fullMetrics(design);
  const warnings = validateDesign(design);

  const win = window.open('', '_blank');
  if (!win) return;

  const canvases = building.floors.map((floor) => {
    const c = document.createElement('canvas');
    drawFloorplan(c, building, floor, { cell: 22 });
    return { name: floor.name, dataUrl: c.toDataURL('image/png') };
  });

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${design.name} — Bericht</title>
  <style>
    body{font-family:-apple-system,Arial,sans-serif;color:#1c2128;padding:32px;max-width:900px;margin:0 auto;}
    h1{margin-bottom:4px;} .sub{color:#666;margin-bottom:24px;}
    table{border-collapse:collapse;width:100%;margin-bottom:24px;}
    td{padding:6px 10px;border-bottom:1px solid #eee;}
    .warn{background:#fff6e5;border:1px solid #f0d78a;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:13px;}
    img{max-width:100%;border:1px solid #ddd;border-radius:6px;margin-bottom:20px;}
    @media print { button{display:none;} }
  </style></head><body>
  <button onclick="window.print()">Als PDF drucken/speichern</button>
  <h1>${design.name}</h1>
  <div class="sub">Stil: ${design.style} · Grundstück ${design.plot.w}×${design.plot.h} m</div>
  <table>
    <tr><td>Wohnfläche</td><td><strong>${metrics.livingAreaM2} m²</strong></td></tr>
    <tr><td>Bebaute Fläche</td><td><strong>${metrics.footprintM2} m²</strong></td></tr>
    <tr><td>Bebauung</td><td><strong>${metrics.coveragePct}%</strong></td></tr>
    <tr><td>Räume</td><td><strong>${metrics.roomCount}</strong></td></tr>
    <tr><td>Geschätzte Kosten</td><td><strong>${metrics.estimatedCostEUR.toLocaleString('de-DE')} €</strong></td></tr>
  </table>
  ${warnings.length ? `<h3>Warnungen</h3>${warnings.map((w) => `<div class="warn">${w.message}</div>`).join('')}` : ''}
  <h3>Grundrisse</h3>
  ${canvases.map((c) => `<div><h4>${c.name}</h4><img src="${c.dataUrl}"/></div>`).join('')}
  </body></html>`);
  win.document.close();
}
