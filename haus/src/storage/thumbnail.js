// Erzeugt ein kleines JPEG-Vorschaubild (Grundriss des Erdgeschosses) für Projekt-
// und Versionslisten. Läuft nur im Browser (nutzt <canvas>), gehört aber zur Speicherschicht.

import { CELL_SIZE, cellsOf } from '../core/geometry.js';
import { findRoomType } from '../core/catalog/rooms.js';
import { mainBuildingOf } from '../core/model.js';

export function renderThumbnail(design, width = 240, height = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef0f3';
  ctx.fillRect(0, 0, width, height);

  const building = mainBuildingOf(design);
  if (!building) return canvas.toDataURL('image/jpeg', 0.72);
  const floor = building.floors.find((f) => f.level === 0) || building.floors[0];
  const cols = Math.max(1, Math.round(building.footprint.w / CELL_SIZE));
  const rows = Math.max(1, Math.round(building.footprint.h / CELL_SIZE));
  const pad = 12;
  const scale = Math.min((width - 2 * pad) / cols, (height - 2 * pad) / rows);
  const offX = (width - cols * scale) / 2;
  const offY = (height - rows * scale) / 2;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(offX, offY, cols * scale, rows * scale);
  ctx.strokeStyle = '#9aa0aa';
  ctx.lineWidth = 1;
  ctx.strokeRect(offX, offY, cols * scale, rows * scale);

  for (const r of floor.rooms) {
    const rt = findRoomType(r.typeId);
    ctx.fillStyle = rt.color;
    for (const c of cellsOf(r)) {
      ctx.fillRect(offX + c.x * scale, offY + c.y * scale, scale + 0.6, scale + 0.6);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.72);
}
