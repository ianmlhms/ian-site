// Zell-Abstraktion für den Grundriss-Editor. Keine DOM-Abhängigkeiten.
// 1 Grundriss-Zelle = CELL_SIZE Meter. Möbel nutzen ein feineres Raster (FURN_GRID).

export const CELL_SIZE = 0.5; // Meter pro Grundriss-Zelle
export const FURN_GRID = 0.125; // Meter pro Möbel-Rasterschritt (Viertelzelle)

export function cellsToMeters(cells) {
  return cells * CELL_SIZE;
}

export function metersToCells(m) {
  return m / CELL_SIZE;
}

// Liefert die Liste der Zellen, die ein rechteckiger Raum {x,y,w,h} belegt.
export function rectCells(r) {
  const cells = [];
  for (let dy = 0; dy < r.h; dy++) {
    for (let dx = 0; dx < r.w; dx++) {
      cells.push({ x: r.x + dx, y: r.y + dy });
    }
  }
  return cells;
}

// Liefert immer die belegten Zellen, egal ob Rechteck- oder Freiform-Raum.
export function cellsOf(room) {
  if (Array.isArray(room.cells)) return room.cells;
  return rectCells(room);
}

// Bounding-Box einer Zellenliste.
export function bbox(cells) {
  if (!cells.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function cellKey(c) {
  return c.x + ',' + c.y;
}

// Vereinigt die Zellen mehrerer Räume dedupliziert zu einer Liste (fürs Zusammenfügen).
export function mergeCells(rooms) {
  const seen = new Map();
  for (const room of rooms) {
    for (const c of cellsOf(room)) {
      seen.set(cellKey(c), c);
    }
  }
  return Array.from(seen.values());
}

export function cellsOverlap(a, b) {
  const setB = new Set(b.map(cellKey));
  return a.some((c) => setB.has(cellKey(c)));
}

export function cellSetOf(cells) {
  return new Set(cells.map(cellKey));
}

// Belegte Zellen eines Geschosses (Räume + Schächte des Gebäudes), zum Ausschluss
// eines bestimmten Raums/Schachts beim Verschieben/Skalieren desselben Objekts.
export function occupiedCells(floor, building, exclude = {}) {
  const set = new Set();
  for (const r of floor.rooms) {
    if (exclude.kind === 'room' && r.id === exclude.id) continue;
    for (const c of cellsOf(r)) set.add(cellKey(c));
  }
  for (const s of building.shafts || []) {
    if (exclude.kind === 'shaft' && s.id === exclude.id) continue;
    for (const c of s.cells) set.add(cellKey(c));
  }
  return set;
}

export function anyOccupied(cells, occupiedSet) {
  return cells.some((c) => occupiedSet.has(cellKey(c)));
}

// Sucht die erste freie rechteckige Position (zeilenweise), falls die Wunschposition belegt ist.
export function findFreeRect(w, h, cols, rows, occupiedSet) {
  for (let y = 0; y <= rows - h; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const cells = rectCells({ x, y, w, h });
      if (!anyOccupied(cells, occupiedSet)) return { x, y, w, h };
    }
  }
  return null;
}

export function roomAreaM2(room) {
  return cellsOf(room).length * CELL_SIZE * CELL_SIZE;
}

// Klemmt ein Rechteck auf ein Raster von cols x rows.
export function clampRect(r, cols, rows) {
  const w = Math.max(1, Math.min(r.w, cols));
  const h = Math.max(1, Math.min(r.h, rows));
  const x = Math.max(0, Math.min(r.x, cols - w));
  const y = Math.max(0, Math.min(r.y, rows - h));
  return { x, y, w, h };
}

// Rastert einen Pixelwert auf ein Vielfaches von step (für Lageplan/Möbel-Snapping).
export function snap(value, step) {
  return Math.round(value / step) * step;
}
