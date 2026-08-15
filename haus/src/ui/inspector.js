// Rechtes Panel: Eigenschaften des ausgewählten Objekts + Auswertung (Fläche/Kosten/Warnungen).
import { el, mount, fmtM2, fmtEUR } from './dom.js';
import { store } from '../core/state.js';
import { findRoomType, ROOM_CATEGORIES } from '../core/catalog/rooms.js';
import { findFurnitureType } from '../core/catalog/furniture.js';
import { findOutdoorType } from '../core/catalog/outdoor.js';
import { roomAreaM2 } from '../core/geometry.js';
import { fullMetrics } from '../core/metrics.js';
import { validateDesign } from '../core/validate.js';
import { regenerateWalls } from '../core/walls.js';

export function renderInspector(container) {
  const design = store.design;
  const sel = store.ui.selection;
  const parts = [];

  parts.push(
    el('div', { class: 'row', style: { marginBottom: '10px' } }, [
      el('button', { class: sel ? '' : 'primary', style: { flex: 1 }, onClick: () => store.select(null) }, 'Auswertung'),
      el('button', { class: !sel ? '' : 'primary', style: { flex: 1 }, disabled: !sel }, sel ? 'Eigenschaften' : ''),
    ])
  );

  if (sel) {
    parts.push(renderSelectionPanel(design, sel));
  } else {
    parts.push(renderMetricsPanel(design));
  }

  mount(container, parts);
}

function field(label, inputNode) {
  return el('div', { class: 'field' }, [el('label', {}, label), inputNode]);
}

function findRoom(design, id) {
  for (const b of design.buildings) for (const f of b.floors) {
    const r = f.rooms.find((x) => x.id === id);
    if (r) return { room: r, building: b, floor: f };
  }
  return null;
}
function findFurniture(design, id) {
  for (const b of design.buildings) for (const f of b.floors) {
    const it = f.furniture.find((x) => x.id === id);
    if (it) return { item: it, building: b, floor: f };
  }
  return null;
}
function findOutdoor(design, id) {
  const item = design.outdoor.find((x) => x.id === id);
  return item ? { item } : null;
}
function findBuilding(design, id) {
  const b = design.buildings.find((x) => x.id === id);
  return b ? { building: b } : null;
}

function renderSelectionPanel(design, sel) {
  if (sel.kind === 'room') {
    const found = findRoom(design, sel.id);
    if (!found) return el('div', { class: 'muted' }, 'Nicht gefunden.');
    const { room, building, floor } = found;
    const rt = findRoomType(room.typeId);
    const area = roomAreaM2(room);
    return el('div', {}, [
      el('h3', {}, rt.name),
      el('div', { class: 'chip' }, `${fmtM2(area)}`),
      field('Name (optional)', el('input', {
        type: 'text', value: room.name || '', placeholder: rt.name,
        onInput: (e) => { store.mutate((d) => { room.name = e.target.value; }, { pushHistory: false }); },
      })),
      el('button', {
        class: 'danger', style: { width: '100%', marginTop: '10px' },
        onClick: () => {
          store.mutate((d) => {
            floor.rooms = floor.rooms.filter((r) => r.id !== room.id);
            regenerateWalls(building, floor);
          });
          store.clearSelection();
        },
      }, 'Raum löschen'),
    ]);
  }

  if (sel.kind === 'furniture') {
    const found = findFurniture(design, sel.id);
    if (!found) return el('div', { class: 'muted' }, 'Nicht gefunden.');
    const { item } = found;
    const ft = findFurnitureType(item.typeId);
    return el('div', {}, [
      el('h3', {}, ft.name),
      el('div', { class: 'chip' }, `${item.w.toFixed(2)} × ${item.h.toFixed(2)} m`),
      field('Drehung', el('div', { class: 'row' }, [
        el('button', { onClick: () => rotateFurniture(item, -90) }, '⟲ 90°'),
        el('div', { class: 'chip' }, `${item.rot}°`),
        el('button', { onClick: () => rotateFurniture(item, 90) }, '⟳ 90°'),
      ])),
      el('button', {
        class: 'danger', style: { width: '100%', marginTop: '10px' },
        onClick: () => {
          store.mutate((d) => { found.floor.furniture = found.floor.furniture.filter((f) => f.id !== item.id); });
          store.clearSelection();
        },
      }, 'Möbel löschen'),
    ]);
  }

  if (sel.kind === 'outdoor') {
    const found = findOutdoor(design, sel.id);
    if (!found) return el('div', { class: 'muted' }, 'Nicht gefunden.');
    const { item } = found;
    const ot = findOutdoorType(item.typeId);
    return el('div', {}, [
      el('h3', {}, ot.name),
      el('div', { class: 'chip' }, `${item.w.toFixed(1)} × ${item.h.toFixed(1)} m`),
      field('Drehung', el('div', { class: 'row' }, [
        el('button', { onClick: () => rotateOutdoor(item, -90) }, '⟲ 90°'),
        el('div', { class: 'chip' }, `${item.rot}°`),
        el('button', { onClick: () => rotateOutdoor(item, 90) }, '⟳ 90°'),
      ])),
      el('button', {
        class: 'danger', style: { width: '100%', marginTop: '10px' },
        onClick: () => {
          store.mutate((d) => { d.outdoor = d.outdoor.filter((o) => o.id !== item.id); });
          store.clearSelection();
        },
      }, 'Objekt löschen'),
    ]);
  }

  if (sel.kind === 'shaft') {
    let found = null;
    for (const b of design.buildings) {
      const s = b.shafts.find((x) => x.id === sel.id);
      if (s) { found = { shaft: s, building: b }; break; }
    }
    if (!found) return el('div', { class: 'muted' }, 'Nicht gefunden.');
    const { shaft, building } = found;
    const rt = findRoomType(shaft.typeId);
    return el('div', {}, [
      el('h3', {}, rt.name),
      el('div', { class: 'chip' }, 'Erscheint auf allen Etagen'),
      el('button', {
        class: 'danger', style: { width: '100%', marginTop: '10px' },
        onClick: () => {
          store.mutate((d) => {
            building.shafts = building.shafts.filter((s) => s.id !== shaft.id);
            for (const f of building.floors) regenerateWalls(building, f);
          });
          store.clearSelection();
        },
      }, 'Schacht löschen'),
    ]);
  }

  if (sel.kind === 'building') {
    const found = findBuilding(design, sel.id);
    if (!found) return el('div', { class: 'muted' }, 'Nicht gefunden.');
    const { building } = found;
    return el('div', {}, [
      el('h3', {}, building.name),
      field('Name', el('input', {
        type: 'text', value: building.name,
        onInput: (e) => store.mutate((d) => { building.name = e.target.value; }, { pushHistory: false }),
      })),
      field('Breite (m)', el('input', {
        type: 'number', value: building.footprint.w, min: 3, step: 0.5,
        onChange: (e) => store.mutate((d) => { building.footprint.w = Math.max(3, +e.target.value); }),
      })),
      field('Tiefe (m)', el('input', {
        type: 'number', value: building.footprint.h, min: 3, step: 0.5,
        onChange: (e) => store.mutate((d) => { building.footprint.h = Math.max(3, +e.target.value); }),
      })),
      design.buildings.length > 1
        ? el('button', {
            class: 'danger', style: { width: '100%', marginTop: '10px' },
            onClick: () => {
              store.mutate((d) => { d.buildings = d.buildings.filter((b) => b.id !== building.id); });
              store.clearSelection();
            },
          }, 'Gebäude löschen')
        : null,
    ]);
  }

  return el('div', { class: 'muted' }, 'Nichts ausgewählt.');
}

function rotateFurniture(item, delta) {
  store.mutate((d) => { item.rot = ((item.rot + delta) % 360 + 360) % 360; }, { pushHistory: false });
}
function rotateOutdoor(item, delta) {
  store.mutate((d) => { item.rot = ((item.rot + delta) % 360 + 360) % 360; }, { pushHistory: false });
}

function renderMetricsPanel(design) {
  const m = fullMetrics(design);
  const warnings = validateDesign(design);
  return el('div', {}, [
    el('h3', {}, 'Auswertung'),
    el('div', { class: 'metric-row' }, [el('span', {}, 'Wohnfläche'), el('strong', {}, fmtM2(m.livingAreaM2))]),
    el('div', { class: 'metric-row' }, [el('span', {}, 'Bebaute Fläche'), el('strong', {}, fmtM2(m.footprintM2))]),
    el('div', { class: 'metric-row' }, [el('span', {}, 'Grundstück'), el('strong', {}, fmtM2(m.plotM2))]),
    el('div', { class: 'metric-row' }, [el('span', {}, 'Bebauung'), el('strong', {}, `${m.coveragePct}%`)]),
    el('div', { class: 'metric-row' }, [el('span', {}, 'Räume'), el('strong', {}, m.roomCount)]),
    el('div', { class: 'metric-row' }, [el('span', {}, 'Geschätzte Kosten'), el('strong', {}, fmtEUR(m.estimatedCostEUR))]),
    field('Ausbaustandard', el('select', {
      onChange: (e) => store.mutate((d) => { d.meta.budgetLevel = e.target.value; }),
    }, [
      el('option', { value: 'basic', selected: design.meta.budgetLevel === 'basic' }, 'Einfach'),
      el('option', { value: 'standard', selected: design.meta.budgetLevel === 'standard' }, 'Standard'),
      el('option', { value: 'premium', selected: design.meta.budgetLevel === 'premium' }, 'Gehoben'),
    ])),
    el('h3', { style: { marginTop: '18px' } }, `Warnungen (${warnings.length})`),
    warnings.length === 0
      ? el('div', { class: 'muted' }, 'Keine Auffälligkeiten.')
      : el('div', {}, warnings.map((w) => el('div', { class: 'warning-item' }, w.message))),
  ]);
}
