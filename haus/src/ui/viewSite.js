import { el, mount, toast } from './dom.js';
import { store } from '../core/state.js';
import { attachDrag, attachResizeHandle, attachPaletteDrag, attachDropZone } from './dragdrop.js';
import { OUTDOOR_GROUPS, findOutdoorType } from '../core/catalog/outdoor.js';
import { createBuilding, createOutdoorItem, uid } from '../core/model.js';
import { totalBuildingHeight } from '../core/roof.js';
import { sunPosition, shadowOffset2D } from '../core/sun.js';
import { snap } from '../core/geometry.js';

const PXPM = 18; // Pixel pro Meter im Lageplan
const SNAP_M = 0.25;

let sunHour = 13;
let showShadows = false;
let paletteFilter = '';

function m2px(m) { return m * PXPM; }
function px2m(px) { return px / PXPM; }

export function renderSite(container, leftPanel) {
  const design = store.design;
  renderPalette(leftPanel);
  renderCanvas(container, design);
  return null;
}

function renderPalette(leftPanel) {
  const groups = OUTDOOR_GROUPS.map((g) => {
    const items = g.items.filter((it) => !paletteFilter || it.name.toLowerCase().includes(paletteFilter.toLowerCase()));
    if (!items.length) return null;
    return el('div', { class: 'palette-cat' }, [
      el('div', { class: 'cat-title' }, g.label),
      ...items.map((it) => {
        const node = el('div', { class: 'palette-item' }, [
          el('div', { class: 'swatch', style: { background: it.color } }),
          el('span', {}, it.name),
          el('span', { class: 'dim' }, `${it.w}×${it.h}m`),
        ]);
        attachPaletteDrag(node, () => ({ kind: 'outdoor', typeId: it.id }));
        return node;
      }),
    ]);
  }).filter(Boolean);

  mount(leftPanel, [
    el('input', { class: 'palette-search', type: 'text', placeholder: 'Garten durchsuchen…', value: paletteFilter,
      onInput: (e) => { paletteFilter = e.target.value; renderPalette(leftPanel); } }),
    el('div', { class: 'row', style: { marginBottom: '14px' } }, [
      el('button', { style: { flex: 1 }, onClick: () => addBuilding('garage', 'Garage') }, '+ Garage'),
      el('button', { style: { flex: 1 }, onClick: () => addBuilding('shed', 'Gartenhaus') }, '+ Gartenhaus'),
    ]),
    ...groups,
  ]);
}

function addBuilding(kind, name) {
  store.mutate((d) => {
    const b = createBuilding(kind, name);
    b.footprint = { x: 1, y: 1, w: kind === 'garage' ? 6 : 3, h: kind === 'garage' ? 6 : 2.5 };
    d.buildings.push(b);
  });
}

function renderCanvas(container, design) {
  const w = m2px(design.plot.w), h = m2px(design.plot.h);

  const surface = el('div', {
    class: 'grid-surface', id: 'siteSurface',
    style: { position: 'relative', width: w + 'px', height: h + 'px', margin: '40px', backgroundSize: `${PXPM}px ${PXPM}px` },
  });

  // Kompass
  const north = design.plot.north || 0;
  surface.appendChild(el('div', {
    style: { position: 'absolute', top: '-34px', left: '0', fontSize: '11px', color: 'var(--muted)', transform: `rotate(${north}deg)`, transformOrigin: '10px 30px' },
  }, '↑ N'));

  if (showShadows) {
    const { elevationDeg, azimuthDeg } = sunPosition(new Date(), sunHour);
    if (elevationDeg > 0) {
      for (const b of design.buildings) {
        surface.appendChild(shadowShape(b.footprint, totalBuildingHeight(b), elevationDeg, azimuthDeg, north));
      }
    }
  }

  for (const b of design.buildings) surface.appendChild(buildingBlock(b, design));
  for (const o of design.outdoor) surface.appendChild(outdoorBlock(o, design));

  attachDropZone(surface, (data, xPx, yPx) => {
    if (data.kind !== 'outdoor') return;
    const type = findOutdoorType(data.typeId);
    const x = snap(px2m(xPx) - type.w / 2, SNAP_M);
    const y = snap(px2m(yPx) - type.h / 2, SNAP_M);
    store.mutate((d) => {
      d.outdoor.push(createOutdoorItem(data.typeId, Math.max(0, x), Math.max(0, y), type.w, type.h));
    });
  });

  surface.addEventListener('mousedown', (e) => { if (e.target === surface) store.clearSelection(); });

  const toolbar = el('div', { class: 'row', style: { padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' } }, [
    el('span', { class: 'chip' }, `Grundstück ${design.plot.w} × ${design.plot.h} m`),
    el('label', { class: 'row', style: { gap: '6px' } }, [
      el('input', { type: 'checkbox', ...(showShadows ? { checked: true } : {}), onChange: (e) => { showShadows = e.target.checked; renderCanvas(container, store.design); } }),
      'Schatten',
    ]),
    showShadows ? el('div', { class: 'row', style: { gap: '6px' } }, [
      el('span', { class: 'muted' }, `${String(Math.floor(sunHour)).padStart(2, '0')}:${String(Math.round((sunHour % 1) * 60)).padStart(2, '0')} Uhr`),
      el('input', { type: 'range', min: 5, max: 21, step: 0.25, value: sunHour, style: { width: '160px' },
        onInput: (e) => { sunHour = +e.target.value; renderCanvas(container, store.design); } }),
    ]) : null,
    el('div', { class: 'spacer' }),
    el('span', { class: 'muted' }, 'Doppelklick auf ein Gebäude öffnet den Grundriss'),
  ]);

  mount(container, [toolbar, el('div', { style: { padding: '0' } }, [surface])]);
}

function shadowShape(footprint, heightM, elevationDeg, azimuthDeg, north) {
  const { dx, dy } = shadowOffset2D(elevationDeg, azimuthDeg, north, heightM);
  const corners = [
    { x: 0, y: 0 }, { x: footprint.w, y: 0 }, { x: footprint.w, y: footprint.h }, { x: 0, y: footprint.h },
  ];
  const shifted = corners.map((c) => ({ x: c.x + dx, y: c.y + dy }));
  const hull = convexHull([...corners, ...shifted]);
  const points = hull.map((p) => `${m2px(p.x)},${m2px(p.y)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', `position:absolute; left:${m2px(footprint.x)}px; top:${m2px(footprint.y)}px; overflow:visible; pointer-events:none;`);
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'rgba(20,20,30,0.16)');
  svg.appendChild(poly);
  return svg;
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function buildingBlock(b, design) {
  const selected = store.ui.selection?.kind === 'building' && store.ui.selection.id === b.id;
  const node = el('div', {
    class: 'block' + (selected ? ' selected' : ''),
    style: {
      left: m2px(b.footprint.x) + 'px', top: m2px(b.footprint.y) + 'px',
      width: m2px(b.footprint.w) + 'px', height: m2px(b.footprint.h) + 'px',
      background: b.kind === 'main' ? '#d8c7a1' : '#c7c2b2',
      transform: `rotate(${b.rotation || 0}deg)`,
    },
  }, [
    el('span', {}, `${b.name}${b.kind !== 'main' ? '' : ''}`),
  ]);

  attachDrag(node, {
    onClick: () => store.select({ kind: 'building', id: b.id }),
    onMove: (dx, dy) => {
      node.style.left = snap(m2px(b.footprint.x) + dx, PXPM * SNAP_M) + 'px';
      node.style.top = snap(m2px(b.footprint.y) + dy, PXPM * SNAP_M) + 'px';
    },
    onEnd: (dx, dy) => {
      store.mutate((d) => {
        const bb = d.buildings.find((x) => x.id === b.id);
        bb.footprint.x = Math.max(0, snap(bb.footprint.x + px2m(dx), SNAP_M));
        bb.footprint.y = Math.max(0, snap(bb.footprint.y + px2m(dy), SNAP_M));
      });
    },
  });
  node.addEventListener('dblclick', () => {
    store.setView('plan', { buildingId: b.id, floorId: b.floors[0].id });
  });

  if (selected) {
    const resize = el('div', { class: 'resize-handle' });
    attachResizeHandle(resize, {
      onMove: (dx, dy) => {
        node.style.width = Math.max(PXPM * 3, m2px(b.footprint.w) + dx) + 'px';
        node.style.height = Math.max(PXPM * 3, m2px(b.footprint.h) + dy) + 'px';
      },
      onEnd: (dx, dy) => {
        store.mutate((d) => {
          const bb = d.buildings.find((x) => x.id === b.id);
          bb.footprint.w = Math.max(3, snap(bb.footprint.w + px2m(dx), SNAP_M));
          bb.footprint.h = Math.max(3, snap(bb.footprint.h + px2m(dy), SNAP_M));
        });
      },
    });
    const rot = el('div', { class: 'rot-handle', title: 'Drehen' });
    rot.addEventListener('click', (e) => { e.stopPropagation(); store.mutate((d) => { d.buildings.find((x) => x.id === b.id).rotation = ((b.rotation || 0) + 15) % 360; }); });
    const del = el('div', { class: 'del-btn' }, '×');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (design.buildings.length <= 1) { toast('Mindestens ein Gebäude muss bestehen bleiben.'); return; }
      if (!window.confirm(`${b.name} wirklich löschen?`)) return;
      store.mutate((d) => { d.buildings = d.buildings.filter((x) => x.id !== b.id); });
      store.clearSelection();
    });
    node.append(resize, rot, del);
  }

  return node;
}

function outdoorBlock(o, design) {
  const type = findOutdoorType(o.typeId);
  const selected = store.ui.selection?.kind === 'outdoor' && store.ui.selection.id === o.id;
  const node = el('div', {
    class: 'block' + (selected ? ' selected' : ''),
    style: {
      left: m2px(o.x) + 'px', top: m2px(o.y) + 'px',
      width: m2px(o.w) + 'px', height: m2px(o.h) + 'px',
      background: type.color, opacity: '0.85',
      transform: `rotate(${o.rot || 0}deg)`, fontSize: '10px',
    },
  }, type.name);

  attachDrag(node, {
    onClick: () => store.select({ kind: 'outdoor', id: o.id }),
    onMove: (dx, dy) => {
      node.style.left = snap(m2px(o.x) + dx, PXPM * SNAP_M) + 'px';
      node.style.top = snap(m2px(o.y) + dy, PXPM * SNAP_M) + 'px';
    },
    onEnd: (dx, dy) => {
      store.mutate((d) => {
        const oo = d.outdoor.find((x) => x.id === o.id);
        oo.x = Math.max(0, snap(oo.x + px2m(dx), SNAP_M));
        oo.y = Math.max(0, snap(oo.y + px2m(dy), SNAP_M));
      }, { pushHistory: false });
    },
  });

  if (selected) {
    const resize = el('div', { class: 'resize-handle' });
    attachResizeHandle(resize, {
      onMove: (dx, dy) => {
        node.style.width = Math.max(PXPM * 0.5, m2px(o.w) + dx) + 'px';
        node.style.height = Math.max(PXPM * 0.5, m2px(o.h) + dy) + 'px';
      },
      onEnd: (dx, dy) => {
        store.mutate((d) => {
          const oo = d.outdoor.find((x) => x.id === o.id);
          oo.w = Math.max(0.5, snap(oo.w + px2m(dx), SNAP_M));
          oo.h = Math.max(0.5, snap(oo.h + px2m(dy), SNAP_M));
        });
      },
    });
    const del = el('div', { class: 'del-btn' }, '×');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      store.mutate((d) => { d.outdoor = d.outdoor.filter((x) => x.id !== o.id); });
      store.clearSelection();
    });
    node.append(resize, del);
  }

  return node;
}
