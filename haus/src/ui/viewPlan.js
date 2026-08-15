import { el, mount, toast } from './dom.js';
import { store } from '../core/state.js';
import { attachDrag, attachResizeHandle, attachPaletteDrag, attachDropZone } from './dragdrop.js';
import { ROOM_CATEGORIES, findRoomType, THROUGH_ROOM_TYPES } from '../core/catalog/rooms.js';
import { CELL_SIZE, rectCells, cellsOf, bbox, mergeCells, clampRect, roomAreaM2, occupiedCells, anyOccupied, findFreeRect } from '../core/geometry.js';
import { createRoom, createFloor, uid, FLOOR_PRESETS } from '../core/model.js';
import { regenerateWalls } from '../core/walls.js';

const CELL_PX = 30;
const PXPM_WALL = CELL_PX / CELL_SIZE;

let paletteFilter = '';
let mergeSelection = new Set();

export function renderPlan(container, leftPanel) {
  const building = store.currentBuilding();
  const floor = store.currentFloor();
  if (!building || !floor) { mount(container, [el('p', { class: 'muted', style: { padding: '20px' } }, 'Kein Gebäude ausgewählt.')]); return null; }
  mergeSelection = new Set([...mergeSelection].filter((id) => floor.rooms.some((r) => r.id === id)));
  renderPalette(leftPanel);
  renderCanvas(container, building, floor);
  return null;
}

function renderPalette(leftPanel) {
  const normalCats = ROOM_CATEGORIES.map((cat) => {
    const items = cat.items.filter((it) => !it.through && (!paletteFilter || it.name.toLowerCase().includes(paletteFilter.toLowerCase())));
    if (!items.length) return null;
    return categoryBlock(cat.cat, items);
  }).filter(Boolean);

  const throughItems = ROOM_CATEGORIES.flatMap((c) => c.items).filter((it) => it.through && (!paletteFilter || it.name.toLowerCase().includes(paletteFilter.toLowerCase())));

  mount(leftPanel, [
    el('input', { class: 'palette-search', type: 'text', placeholder: 'Räume durchsuchen…', value: paletteFilter,
      onInput: (e) => { paletteFilter = e.target.value; renderPalette(leftPanel); } }),
    throughItems.length ? el('div', { class: 'palette-cat' }, [
      el('div', { class: 'cat-title' }, 'Durchgehend (alle Etagen)'),
      ...throughItems.map((it) => paletteItemNode(it, true)),
    ]) : null,
    ...normalCats,
  ]);
}

function categoryBlock(name, items) {
  return el('div', { class: 'palette-cat' }, [
    el('div', { class: 'cat-title' }, name),
    ...items.map((it) => paletteItemNode(it, false)),
  ]);
}

function paletteItemNode(it, through) {
  const node = el('div', { class: 'palette-item' }, [
    el('div', { class: 'swatch', style: { background: it.color } }),
    el('span', {}, it.name),
    el('span', { class: 'dim' }, `${it.w * CELL_SIZE}×${it.h * CELL_SIZE}m`),
  ]);
  attachPaletteDrag(node, () => ({ kind: 'room', typeId: it.id, through }));
  return node;
}

function renderCanvas(container, building, floor) {
  const cols = Math.round(building.footprint.w / CELL_SIZE);
  const rows = Math.round(building.footprint.h / CELL_SIZE);

  const surface = el('div', {
    class: 'grid-surface', id: 'planSurface',
    style: { position: 'relative', width: cols * CELL_PX + 'px', height: rows * CELL_PX + 'px', margin: '20px', backgroundSize: `${CELL_PX}px ${CELL_PX}px` },
  });

  for (const w of floor.walls) surface.appendChild(wallNode(w));
  for (const o of floor.openings) surface.appendChild(openingNode(o, floor));
  for (const r of floor.rooms) surface.appendChild(roomNode(r, building, floor, cols, rows));
  for (const s of building.shafts) surface.appendChild(shaftNode(s, building, floor, cols, rows));

  attachDropZone(surface, (data, xPx, yPx) => {
    if (data.kind !== 'room') return;
    const type = findRoomType(data.typeId);
    const cellX = Math.floor(xPx / CELL_PX - type.w / 2);
    const cellY = Math.floor(yPx / CELL_PX - type.h / 2);
    let rect = clampRect({ x: cellX, y: cellY, w: type.w, h: type.h }, cols, rows);
    const occupied = occupiedCells(floor, building, {});
    if (anyOccupied(rectCells(rect), occupied)) {
      const free = findFreeRect(rect.w, rect.h, cols, rows, occupied);
      if (!free) { toast('Kein Platz mehr auf diesem Geschoss.'); return; }
      rect = free;
    }
    store.mutate((d) => {
      if (THROUGH_ROOM_TYPES.has(type.id)) {
        building.shafts.push({ id: uid('shaft'), typeId: type.id, cells: rectCells(rect) });
        for (const f of building.floors) regenerateWalls(building, f);
      } else {
        floor.rooms.push(createRoom(type.id, rect.x, rect.y, rect.w, rect.h));
        regenerateWalls(building, floor);
      }
    });
  });

  surface.addEventListener('mousedown', (e) => {
    if (e.target === surface) { store.clearSelection(); mergeSelection.clear(); refresh(); }
  });

  const mergeBtn = mergeSelection.size >= 2 ? el('button', { class: 'primary', onClick: () => mergeRooms(building, floor) }, `Zusammenfügen (${mergeSelection.size})`) : null;

  const toolbar = el('div', { class: 'row', style: { padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexWrap: 'wrap' } }, [
    ...floorTabs(building, floor),
    el('button', { onClick: () => addFloor(building) }, '+ Geschoss'),
    el('div', { class: 'spacer' }),
    mergeBtn,
    el('span', { class: 'muted' }, `${building.footprint.w}×${building.footprint.h} m`),
  ]);

  mount(container, [toolbar, surface]);
}

function refresh() {
  const c = document.getElementById('canvasWrap');
  const l = document.getElementById('leftPanel');
  if (c) renderPlan(c, l);
}

function floorTabs(building, activeFloor) {
  const sorted = [...building.floors].sort((a, b) => b.level - a.level);
  return sorted.map((f) => el('button', {
    class: f.id === activeFloor.id ? 'active' : '',
    style: f.id === activeFloor.id ? { background: 'var(--accent)', color: 'var(--accent-text)' } : {},
    onDblClick: () => { const n = window.prompt('Name des Geschosses:', f.name); if (n) { store.mutate(() => { f.name = n; }); } },
    onClick: () => {
      store.ui = { ...store.ui, floorId: f.id, selection: null };
      store.emit('view');
      flashSurface();
    },
  }, f.name));
}

function flashSurface() {
  setTimeout(() => {
    const s = document.getElementById('planSurface');
    if (s) { s.classList.add('flash'); setTimeout(() => s.classList.remove('flash'), 350); }
  }, 30);
}

function addFloor(building) {
  const usedLevels = building.floors.map((f) => f.level);
  const preset = FLOOR_PRESETS.find((p) => !usedLevels.includes(p.level));
  const level = preset ? preset.level : Math.max(...usedLevels) + 1;
  store.mutate((d) => {
    const f = createFloor(level);
    building.floors.push(f);
    regenerateWalls(building, f);
    store.ui = { ...store.ui, floorId: f.id };
  });
}

function mergeRooms(building, floor) {
  store.mutate((d) => {
    const rooms = floor.rooms.filter((r) => mergeSelection.has(r.id));
    if (rooms.length < 2) return;
    const cells = mergeCells(rooms);
    const merged = { id: uid('room'), typeId: rooms[0].typeId, cells };
    floor.rooms = floor.rooms.filter((r) => !mergeSelection.has(r.id));
    floor.rooms.push(merged);
    regenerateWalls(building, floor);
  });
  mergeSelection.clear();
  store.select(null);
}

function wallNode(w) {
  const thicknessPx = Math.max(2, w.thickness * PXPM_WALL);
  const horizontal = w.a.y === w.b.y;
  const x1 = Math.min(w.a.x, w.b.x) * CELL_PX, y1 = Math.min(w.a.y, w.b.y) * CELL_PX;
  const lenPx = horizontal ? Math.abs(w.b.x - w.a.x) * CELL_PX : Math.abs(w.b.y - w.a.y) * CELL_PX;
  const style = horizontal
    ? { left: x1 + 'px', top: (y1 - thicknessPx / 2) + 'px', width: lenPx + 'px', height: thicknessPx + 'px' }
    : { left: (x1 - thicknessPx / 2) + 'px', top: y1 + 'px', width: thicknessPx + 'px', height: lenPx + 'px' };
  return el('div', { class: 'wall-line', style: { position: 'absolute', opacity: w.exterior ? '0.9' : '0.55', ...style } });
}

function openingNode(o, floor) {
  const wall = floor.walls.find((w) => w.id === o.wallId);
  if (!wall) return el('div', { class: 'hidden' });
  const thicknessPx = Math.max(2, wall.thickness * PXPM_WALL);
  const horizontal = wall.a.y === wall.b.y;
  const x1 = Math.min(wall.a.x, wall.b.x) * CELL_PX, y1 = Math.min(wall.a.y, wall.b.y) * CELL_PX;
  const offsetPx = (o.offset / CELL_SIZE) * CELL_PX;
  const widthPx = (o.width / CELL_SIZE) * CELL_PX;
  const style = horizontal
    ? { left: (x1 + offsetPx) + 'px', top: (y1 - thicknessPx / 2) + 'px', width: widthPx + 'px', height: thicknessPx + 'px' }
    : { left: (x1 - thicknessPx / 2) + 'px', top: (y1 + offsetPx) + 'px', width: thicknessPx + 'px', height: widthPx + 'px' };
  return el('div', { class: 'opening ' + o.type, style: { position: 'absolute', ...style }, title: o.type === 'door' ? 'Tür' : 'Fenster' });
}

function roomNode(room, building, floor, cols, rows) {
  const rt = findRoomType(room.typeId);
  const isMerged = Array.isArray(room.cells);
  const isSelected = mergeSelection.has(room.id) || (store.ui.selection?.kind === 'room' && store.ui.selection.id === room.id);
  const area = roomAreaM2(room);

  const onClick = () => {
    if (mergeSelection.has(room.id)) mergeSelection.delete(room.id);
    else mergeSelection.add(room.id);
    store.select({ kind: 'room', id: room.id });
    refresh();
  };

  if (!isMerged) {
    const node = el('div', {
      class: 'block' + (isSelected ? ' selected' : ''),
      style: { left: room.x * CELL_PX + 'px', top: room.y * CELL_PX + 'px', width: room.w * CELL_PX + 'px', height: room.h * CELL_PX + 'px', background: rt.color },
    }, [el('span', {}, `${room.name || rt.name}`), el('span', { style: { position: 'absolute', bottom: '2px', right: '4px', fontSize: '9px' } }, `${area.toFixed(1)} m²`)]);

    attachDrag(node, {
      onClick,
      onMove: (dx, dy) => { node.style.left = (room.x * CELL_PX + dx) + 'px'; node.style.top = (room.y * CELL_PX + dy) + 'px'; },
      onEnd: (dx, dy) => {
        const rect = clampRect({ x: Math.round(room.x + dx / CELL_PX), y: Math.round(room.y + dy / CELL_PX), w: room.w, h: room.h }, cols, rows);
        const occupied = occupiedCells(floor, building, { kind: 'room', id: room.id });
        if (anyOccupied(rectCells(rect), occupied)) { toast('Raum würde einen anderen Raum überlappen.'); refresh(); return; }
        store.mutate((d) => {
          room.x = rect.x; room.y = rect.y;
          regenerateWalls(building, floor);
        });
      },
    });
    const resize = el('div', { class: 'resize-handle' });
    attachResizeHandle(resize, {
      onMove: (dx, dy) => { node.style.width = Math.max(CELL_PX, room.w * CELL_PX + dx) + 'px'; node.style.height = Math.max(CELL_PX, room.h * CELL_PX + dy) + 'px'; },
      onEnd: (dx, dy) => {
        const rect = clampRect({ x: room.x, y: room.y, w: Math.max(1, Math.round(room.w + dx / CELL_PX)), h: Math.max(1, Math.round(room.h + dy / CELL_PX)) }, cols, rows);
        const occupied = occupiedCells(floor, building, { kind: 'room', id: room.id });
        if (anyOccupied(rectCells(rect), occupied)) { toast('Raum würde einen anderen Raum überlappen.'); refresh(); return; }
        store.mutate((d) => {
          room.w = rect.w; room.h = rect.h;
          regenerateWalls(building, floor);
        });
      },
    });
    node.appendChild(resize);
    return node;
  }

  // Zusammengefügter (freiform) Raum: Container ohne Klicks, nur die Kachel-Elemente reagieren.
  // Verhindert, dass leere Ecken einer L-Form Klicks abfangen (Hotel-App-Fix).
  const box = bbox(room.cells);
  const container = el('div', { class: 'room-container', style: { left: box.x * CELL_PX + 'px', top: box.y * CELL_PX + 'px', width: box.w * CELL_PX + 'px', height: box.h * CELL_PX + 'px' } });
  for (const c of room.cells) {
    const tile = el('div', {
      class: 'r-tile' + (isSelected ? ' selected' : ''),
      style: { left: (c.x - box.x) * CELL_PX + 'px', top: (c.y - box.y) * CELL_PX + 'px', width: CELL_PX + 'px', height: CELL_PX + 'px', background: rt.color },
    });
    attachDrag(tile, {
      onClick,
      onMove: (dx, dy) => { container.style.transform = `translate(${dx}px, ${dy}px)`; },
      onEnd: (dx, dy) => {
        container.style.transform = '';
        const cdx = Math.round(dx / CELL_PX), cdy = Math.round(dy / CELL_PX);
        if (!cdx && !cdy) return;
        const moved = room.cells.map((c) => ({ x: c.x + cdx, y: c.y + cdy }));
        const inBounds = moved.every((c) => c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows);
        const occupied = occupiedCells(floor, building, { kind: 'room', id: room.id });
        if (!inBounds || anyOccupied(moved, occupied)) { toast('Raum würde einen anderen Raum überlappen.'); refresh(); return; }
        store.mutate((d) => {
          room.cells = moved;
          regenerateWalls(building, floor);
        });
      },
    });
    container.appendChild(tile);
  }
  const label = el('div', { style: { position: 'absolute', left: '4px', top: '2px', fontSize: '11px', fontWeight: '600', pointerEvents: 'none' } }, `${room.name || rt.name} · ${area.toFixed(1)} m²`);
  container.appendChild(label);
  return container;
}

function shaftNode(shaft, building, floor, cols, rows) {
  const rt = findRoomType(shaft.typeId);
  const box = bbox(shaft.cells);
  const container = el('div', { class: 'room-container', style: { left: box.x * CELL_PX + 'px', top: box.y * CELL_PX + 'px', width: box.w * CELL_PX + 'px', height: box.h * CELL_PX + 'px' } });
  for (const c of shaft.cells) {
    const tile = el('div', {
      class: 'r-tile', style: {
        left: (c.x - box.x) * CELL_PX + 'px', top: (c.y - box.y) * CELL_PX + 'px', width: CELL_PX + 'px', height: CELL_PX + 'px',
        background: rt.color, backgroundImage: 'repeating-linear-gradient(45deg, rgba(0,0,0,.08) 0 4px, transparent 4px 8px)',
      },
    });
    attachDrag(tile, {
      onClick: () => store.select({ kind: 'shaft', id: shaft.id }),
      onMove: (dx, dy) => { container.style.transform = `translate(${dx}px, ${dy}px)`; },
      onEnd: (dx, dy) => {
        container.style.transform = '';
        const cdx = Math.round(dx / CELL_PX), cdy = Math.round(dy / CELL_PX);
        if (!cdx && !cdy) return;
        const moved = shaft.cells.map((c) => ({ x: c.x + cdx, y: c.y + cdy }));
        const inBounds = moved.every((c) => c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows);
        const occupied = occupiedCells(floor, building, { kind: 'shaft', id: shaft.id });
        if (!inBounds || anyOccupied(moved, occupied)) { toast('Schacht würde einen anderen Raum überlappen.'); refresh(); return; }
        store.mutate((d) => {
          shaft.cells = moved;
          for (const f of building.floors) regenerateWalls(building, f);
        });
      },
    });
    container.appendChild(tile);
  }
  container.appendChild(el('div', { class: 'through-badge' }, `↕ ${rt.name}`));
  return container;
}
