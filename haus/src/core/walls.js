// Leitet Wände aus den Raumzellen eines Geschosses ab und setzt Türen/Fenster automatisch.
// Manuell bearbeitete Öffnungen (auto:false) bleiben über Neuberechnungen hinweg erhalten,
// weil Wand-IDs deterministisch aus ihrer Geometrie gebildet werden (nicht zufällig).

import { CELL_SIZE, cellsOf, cellKey } from './geometry.js';
import { findRoomType } from './catalog/rooms.js';

function wallId(x1, y1, x2, y2) {
  if (x1 > x2 || (x1 === x2 && y1 > y2)) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
  }
  return `w_${x1}_${y1}_${x2}_${y2}`;
}

function buildOccupancyGrid(floor, building) {
  const grid = new Map();
  for (const r of floor.rooms) {
    for (const c of cellsOf(r)) grid.set(cellKey(c), { roomId: r.id, typeId: r.typeId });
  }
  for (const s of building.shafts || []) {
    for (const c of s.cells) grid.set(cellKey(c), { roomId: 'shaft:' + s.id, typeId: s.typeId });
  }
  return grid;
}

function neighborKey(a, b) {
  const ka = a ? a.roomId : '';
  const kb = b ? b.roomId : '';
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// Sammelt Einheits-Kanten (1 Zelle lang) und fasst kollineare Kanten mit derselben
// Nachbarschafts-Identität zu längeren Wandläufen zusammen.
function collectEdges(grid, cols, rows) {
  const raw = []; // {x1,y1,x2,y2, horizontal, exterior, a, b}

  // horizontale Kanten (zwischen Zeile y-1 und y), verlaufen entlang x
  for (let y = 0; y <= rows; y++) {
    let runStart = null;
    let runKey = null;
    let runA = null, runB = null;
    for (let x = 0; x <= cols; x++) {
      const above = x < cols ? grid.get(cellKey({ x, y: y - 1 })) : null;
      const below = x < cols ? grid.get(cellKey({ x, y })) : null;
      const hasWall = x < cols && (above || below) && neighborIdentity(above, below);
      const key = hasWall ? neighborKey(above, below) : null;
      if (hasWall && key === runKey) {
        // Lauf fortsetzen
      } else {
        if (runStart !== null) {
          raw.push(makeSeg(runStart, y, x, y, true, runA, runB, cols, rows));
        }
        runStart = hasWall ? x : null;
        runKey = key;
        runA = above; runB = below;
      }
    }
    if (runStart !== null) raw.push(makeSeg(runStart, y, cols, y, true, runA, runB, cols, rows));
  }

  // vertikale Kanten (zwischen Spalte x-1 und x), verlaufen entlang y
  for (let x = 0; x <= cols; x++) {
    let runStart = null;
    let runKey = null;
    let runA = null, runB = null;
    for (let y = 0; y <= rows; y++) {
      const left = y < rows ? grid.get(cellKey({ x: x - 1, y })) : null;
      const right = y < rows ? grid.get(cellKey({ x, y })) : null;
      const hasWall = y < rows && (left || right) && neighborIdentity(left, right);
      const key = hasWall ? neighborKey(left, right) : null;
      if (hasWall && key === runKey) {
        // weiter
      } else {
        if (runStart !== null) {
          raw.push(makeSeg(x, runStart, x, y, false, runA, runB, cols, rows));
        }
        runStart = hasWall ? y : null;
        runKey = key;
        runA = left; runB = right;
      }
    }
    if (runStart !== null) raw.push(makeSeg(x, runStart, x, rows, false, runA, runB, cols, rows));
  }

  return raw;
}

function neighborIdentity(a, b) {
  const ka = a ? a.roomId : null;
  const kb = b ? b.roomId : null;
  return ka !== kb; // Wand nur, wenn beide Seiten unterschiedlich sind (mind. eine Seite belegt)
}

function makeSeg(x1, y1, x2, y2, horizontal, a, b, cols, rows) {
  const exterior = horizontal ? (y1 === 0 || y1 === rows) : (x1 === 0 || x1 === cols);
  return { x1, y1, x2, y2, horizontal, exterior, a, b };
}

function segLengthM(seg) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  return Math.sqrt(dx * dx + dy * dy) * CELL_SIZE;
}

// Baut die Wandliste + automatische Öffnungen; erhält bestehende manuelle Öffnungen.
export function regenerateWalls(building, floor) {
  const cols = Math.round(building.footprint.w / CELL_SIZE);
  const rows = Math.round(building.footprint.h / CELL_SIZE);
  const grid = buildOccupancyGrid(floor, building);
  const segs = collectEdges(grid, cols, rows);

  const newWalls = segs.map((seg) => ({
    id: wallId(seg.x1, seg.y1, seg.x2, seg.y2),
    a: { x: seg.x1, y: seg.y1 },
    b: { x: seg.x2, y: seg.y2 },
    thickness: seg.exterior ? 0.3 : 0.12,
    exterior: seg.exterior,
    lengthM: segLengthM(seg),
    roomA: seg.a ? seg.a.roomId : null,
    roomB: seg.b ? seg.b.roomId : null,
    typeA: seg.a ? seg.a.typeId : null,
    typeB: seg.b ? seg.b.typeId : null,
  }));
  const newWallIds = new Set(newWalls.map((w) => w.id));

  // bestehende Öffnungen behalten, wenn ihre Wand noch existiert
  const keptOpenings = (floor.openings || []).filter((o) => newWallIds.has(o.wallId));
  const wallsWithOpening = new Set(keptOpenings.map((o) => o.wallId));

  const autoOpenings = [];
  // Türen zwischen zwei unterschiedlichen echten Räumen
  for (const w of newWalls) {
    if (wallsWithOpening.has(w.id)) continue;
    if (w.exterior) continue;
    if (!w.roomA || !w.roomB) continue; // Wand zu unbelegter Fläche: keine automatische Tür
    if (w.lengthM < 0.9) continue;
    const isShaft = w.roomA.startsWith('shaft:') || w.roomB.startsWith('shaft:');
    autoOpenings.push(makeOpening(w, 'door', isShaft ? 'entrance' : 'plain'));
    wallsWithOpening.add(w.id);
  }
  // Fenster an Außenwänden echter Räume
  for (const w of newWalls) {
    if (wallsWithOpening.has(w.id)) continue;
    if (!w.exterior) continue;
    const roomId = w.roomA || w.roomB;
    if (!roomId || roomId.startsWith('shaft:')) continue;
    if (w.lengthM < 1.0) continue;
    autoOpenings.push(makeOpening(w, 'window', 'plain'));
    wallsWithOpening.add(w.id);
  }
  // Haustür: einmal pro Geschoss (Erdgeschoss), an der längsten Außenwand ohne bisherige Öffnung-Vorrang
  if (floor.level === 0) {
    const hasEntrance = [...keptOpenings, ...autoOpenings].some((o) => o.style === 'houseEntrance');
    if (!hasEntrance) {
      const candidates = newWalls.filter((w) => w.exterior && w.lengthM >= 1.0 && w.y1 === w.y2 && w.y1 === rows);
      const front = candidates.sort((a, b) => b.lengthM - a.lengthM)[0];
      if (front) {
        // vorhandenes Auto-Fenster an dieser Wand durch Haustür ersetzen
        const idx = autoOpenings.findIndex((o) => o.wallId === front.id);
        if (idx >= 0) autoOpenings.splice(idx, 1);
        autoOpenings.push(makeOpening(front, 'door', 'houseEntrance'));
      }
    }
  }

  floor.walls = newWalls;
  floor.openings = [...keptOpenings, ...autoOpenings];
  return floor;
}

let openingCounter = 0;
function makeOpening(wall, type, style) {
  openingCounter += 1;
  const width = type === 'door' ? 0.9 : Math.min(1.4, Math.max(0.8, wall.lengthM * 0.4));
  const offset = Math.max(0.15, (wall.lengthM - width) / 2);
  return {
    id: `op_${Date.now().toString(36)}_${openingCounter}`,
    wallId: wall.id,
    type,
    offset,
    width,
    height: type === 'door' ? 2.05 : 1.3,
    sill: type === 'door' ? 0 : 0.9,
    style,
    auto: true,
  };
}

export function regenerateAllWalls(design) {
  for (const b of design.buildings) {
    for (const f of b.floors) regenerateWalls(b, f);
  }
}

export function roomLabel(typeId) {
  return findRoomType(typeId).name;
}
