import { el, mount, toast } from './dom.js';
import { store } from '../core/state.js';
import { attachDrag, attachPaletteDrag, attachDropZone } from './dragdrop.js';
import { FURNITURE_GROUPS, findFurnitureType, templatesForRoom } from '../core/catalog/furniture.js';
import { findRoomType } from '../core/catalog/rooms.js';
import { CELL_SIZE, cellsOf, bbox, snap } from '../core/geometry.js';
import { createFurnitureItem, uid } from '../core/model.js';

const PXPM = 60; // Pixel pro Meter (gleicher Maßstab wie der Grundriss)
const FURN_GRID = 0.125; // Meter pro Raster-Schritt (Viertelzelle)
const WALL_SNAP_M = 0.28;

let paletteFilter = '';

export function renderFurnish(container, leftPanel) {
  const building = store.currentBuilding();
  const floor = store.currentFloor();
  if (!building || !floor) return null;

  renderPalette(leftPanel, building, floor);
  renderCanvas(container, building, floor);

  function onKeydown(e) {
    if (e.key.toLowerCase() !== 'r') return;
    const sel = store.ui.selection;
    if (!sel || sel.kind !== 'furniture') return;
    const item = floor.furniture.find((f) => f.id === sel.id);
    if (!item) return;
    store.mutate(() => { item.rot = (item.rot + 90) % 360; }, { pushHistory: false });
  }
  document.addEventListener('keydown', onKeydown);
  return () => document.removeEventListener('keydown', onKeydown);
}

function selectedRoom(floor) {
  const sel = store.ui.selection;
  if (!sel || sel.kind !== 'room') return null;
  return floor.rooms.find((r) => r.id === sel.id) || null;
}

function renderPalette(leftPanel, building, floor) {
  const room = selectedRoom(floor);
  const parts = [];

  parts.push(el('input', {
    class: 'palette-search', type: 'text', placeholder: 'Möbel durchsuchen…', value: paletteFilter,
    onInput: (e) => { paletteFilter = e.target.value; renderPalette(leftPanel, building, floor); },
  }));

  if (room) {
    const rt = findRoomType(room.typeId);
    const templates = templatesForRoom(room.typeId);
    parts.push(el('div', { class: 'chip' }, `Ausgewählt: ${rt.name}`));
    if (templates.length) {
      parts.push(el('div', { class: 'palette-cat' }, [
        el('div', { class: 'cat-title' }, 'Komplett-Vorlagen'),
        ...templates.map((t) => el('button', { style: { width: '100%', marginBottom: '6px', textAlign: 'left' }, onClick: () => applyTemplate(building, floor, room, t) }, t.name)),
      ]));
    }
  }

  const groupsSorted = room ? orderGroupsFor(findRoomType(room.typeId).furnitureGroup) : FURNITURE_GROUPS;
  for (const g of groupsSorted) {
    const items = g.items.filter((it) => !paletteFilter || it.name.toLowerCase().includes(paletteFilter.toLowerCase()));
    if (!items.length) continue;
    parts.push(el('div', { class: 'palette-cat' }, [
      el('div', { class: 'cat-title' }, room && g.key === findRoomType(room.typeId).furnitureGroup ? `${g.label} · Empfehlung` : g.label),
      ...items.map((it) => paletteItemNode(it)),
    ]));
  }

  mount(leftPanel, parts);
}

function orderGroupsFor(groupKey) {
  const primary = FURNITURE_GROUPS.filter((g) => g.key === groupKey);
  const rest = FURNITURE_GROUPS.filter((g) => g.key !== groupKey);
  return [...primary, ...rest];
}

function paletteItemNode(it) {
  const node = el('div', { class: 'palette-item' }, [
    el('div', { class: 'swatch', style: { background: it.color } }),
    el('span', {}, it.name),
    el('span', { class: 'dim' }, `${it.w}×${it.h}m`),
  ]);
  attachPaletteDrag(node, () => ({ kind: 'furniture', typeId: it.id }));
  return node;
}

function applyTemplate(building, floor, room, template) {
  const originX = room.x * CELL_SIZE, originY = room.y * CELL_SIZE;
  store.mutate((d) => {
    for (const it of template.items) {
      const type = findFurnitureType(it.typeId);
      floor.furniture.push(createFurnitureItem(it.typeId, originX + it.x, originY + it.y, type.w, type.h, it.rot || 0));
    }
  });
  toast(`${template.name} eingerichtet.`);
}

function renderCanvas(container, building, floor) {
  const wM = building.footprint.w, hM = building.footprint.h;
  const surface = el('div', {
    class: 'grid-surface', id: 'furnishSurface',
    style: { position: 'relative', width: (wM * PXPM) + 'px', height: (hM * PXPM) + 'px', margin: '20px', backgroundSize: `${CELL_SIZE * PXPM}px ${CELL_SIZE * PXPM}px` },
  });

  for (const w of floor.walls) surface.appendChild(wallNode(w));
  for (const o of floor.openings) surface.appendChild(openingNode(o, floor));
  for (const r of floor.rooms) surface.appendChild(roomOutline(r));
  for (const item of floor.furniture) surface.appendChild(furnitureNode(item, building, floor));

  attachDropZone(surface, (data, xPx, yPx) => {
    if (data.kind !== 'furniture') return;
    const type = findFurnitureType(data.typeId);
    const x = Math.max(0, snap(xPx / PXPM - type.w / 2, FURN_GRID));
    const y = Math.max(0, snap(yPx / PXPM - type.h / 2, FURN_GRID));
    store.mutate((d) => {
      floor.furniture.push(createFurnitureItem(data.typeId, x, y, type.w, type.h, 0));
    });
  });

  surface.addEventListener('mousedown', (e) => { if (e.target === surface) store.clearSelection(); });

  const toolbar = el('div', { class: 'row', style: { padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' } }, [
    el('span', { class: 'chip' }, `${floor.name}`),
    el('span', { class: 'muted' }, 'Klicke einen Raum im Grundriss vorher an, um passende Möbel vorzuschlagen. „R“ dreht das ausgewählte Möbel.'),
  ]);

  mount(container, [toolbar, surface]);
}

function refresh() {
  const c = document.getElementById('canvasWrap');
  const l = document.getElementById('leftPanel');
  if (c) renderCanvas(c, store.currentBuilding(), store.currentFloor());
  if (l) renderPalette(l, store.currentBuilding(), store.currentFloor());
}

function wallNode(w) {
  const cellPx = CELL_SIZE * PXPM;
  const thicknessPx = Math.max(2, w.thickness * PXPM);
  const horizontal = w.a.y === w.b.y;
  const x1 = Math.min(w.a.x, w.b.x) * cellPx, y1 = Math.min(w.a.y, w.b.y) * cellPx;
  const lenPx = horizontal ? Math.abs(w.b.x - w.a.x) * cellPx : Math.abs(w.b.y - w.a.y) * cellPx;
  const style = horizontal
    ? { left: x1 + 'px', top: (y1 - thicknessPx / 2) + 'px', width: lenPx + 'px', height: thicknessPx + 'px' }
    : { left: (x1 - thicknessPx / 2) + 'px', top: y1 + 'px', width: thicknessPx + 'px', height: lenPx + 'px' };
  return el('div', { class: 'wall-line', style: { position: 'absolute', opacity: w.exterior ? '0.9' : '0.4', ...style } });
}

function openingNode(o, floor) {
  const wall = floor.walls.find((w) => w.id === o.wallId);
  if (!wall) return el('div', { class: 'hidden' });
  const cellPx = CELL_SIZE * PXPM;
  const thicknessPx = Math.max(2, wall.thickness * PXPM);
  const horizontal = wall.a.y === wall.b.y;
  const x1 = Math.min(wall.a.x, wall.b.x) * cellPx, y1 = Math.min(wall.a.y, wall.b.y) * cellPx;
  const offsetPx = (o.offset / CELL_SIZE) * cellPx;
  const widthPx = (o.width / CELL_SIZE) * cellPx;
  const style = horizontal
    ? { left: (x1 + offsetPx) + 'px', top: (y1 - thicknessPx / 2) + 'px', width: widthPx + 'px', height: thicknessPx + 'px' }
    : { left: (x1 - thicknessPx / 2) + 'px', top: (y1 + offsetPx) + 'px', width: thicknessPx + 'px', height: widthPx + 'px' };
  return el('div', { class: 'opening ' + o.type, style: { position: 'absolute', opacity: '0.7', ...style } });
}

function roomOutline(room) {
  const rt = findRoomType(room.typeId);
  const box = bbox(cellsOf(room));
  const cellPx = CELL_SIZE * PXPM;
  const selected = store.ui.selection?.kind === 'room' && store.ui.selection.id === room.id;
  const node = el('div', {
    style: {
      position: 'absolute', left: box.x * cellPx + 'px', top: box.y * cellPx + 'px', width: box.w * cellPx + 'px', height: box.h * cellPx + 'px',
      background: rt.color + '33', border: selected ? '2px solid var(--accent)' : '1px dashed rgba(0,0,0,.2)', cursor: 'pointer',
      fontSize: '10px', color: 'rgba(0,0,0,.5)', padding: '2px 4px',
    },
  }, rt.name);
  node.addEventListener('mousedown', (e) => { e.stopPropagation(); store.select({ kind: 'room', id: room.id }); });
  return node;
}

function furnitureNode(item, building, floor) {
  const type = findFurnitureType(item.typeId);
  const selected = store.ui.selection?.kind === 'furniture' && store.ui.selection.id === item.id;
  const node = el('div', {
    class: 'furn-tile' + (selected ? ' selected' : ''),
    style: {
      left: item.x * PXPM + 'px', top: item.y * PXPM + 'px', width: item.w * PXPM + 'px', height: item.h * PXPM + 'px',
      background: type.color, transform: `rotate(${item.rot}deg)`,
    },
  }, type.name);

  attachDrag(node, {
    onClick: () => store.select({ kind: 'furniture', id: item.id }),
    onMove: (dx, dy) => { node.style.left = (item.x * PXPM + dx) + 'px'; node.style.top = (item.y * PXPM + dy) + 'px'; },
    onEnd: (dx, dy) => {
      let x = Math.max(0, snap(item.x + dx / PXPM, FURN_GRID));
      let y = Math.max(0, snap(item.y + dy / PXPM, FURN_GRID));
      const snapped = snapToWall(x, y, item.w, item.h, floor);
      x = snapped.x; y = snapped.y;
      store.mutate((d) => { item.x = x; item.y = y; }, { pushHistory: false });
    },
  });

  if (selected) {
    const rot = el('div', { class: 'rot-handle', title: 'Drehen (R)' });
    rot.addEventListener('click', (e) => { e.stopPropagation(); store.mutate(() => { item.rot = (item.rot + 90) % 360; }, { pushHistory: false }); });
    const del = el('div', { class: 'del-btn' }, '×');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      store.mutate((d) => { floor.furniture = floor.furniture.filter((f) => f.id !== item.id); });
      store.clearSelection();
    });
    node.append(rot, del);
  }
  return node;
}

// Schnappt ein Möbelstück an die nächste Wand des Raums, in dem es sich befindet (einfache Näherung).
function snapToWall(x, y, w, h, floor) {
  const cx = x + w / 2, cy = y + h / 2;
  const cellM = CELL_SIZE;
  const cellX = Math.floor(cx / cellM), cellY = Math.floor(cy / cellM);
  const room = floor.rooms.find((r) => cellsOf(r).some((c) => c.x === cellX && c.y === cellY));
  if (!room) return { x, y };
  const box = bbox(cellsOf(room));
  const roomLeft = box.x * cellM, roomTop = box.y * cellM, roomRight = (box.x + box.w) * cellM, roomBottom = (box.y + box.h) * cellM;
  let nx = x, ny = y;
  if (Math.abs(x - roomLeft) < WALL_SNAP_M) nx = roomLeft;
  else if (Math.abs((x + w) - roomRight) < WALL_SNAP_M) nx = roomRight - w;
  if (Math.abs(y - roomTop) < WALL_SNAP_M) ny = roomTop;
  else if (Math.abs((y + h) - roomBottom) < WALL_SNAP_M) ny = roomBottom - h;
  return { x: nx, y: ny };
}
