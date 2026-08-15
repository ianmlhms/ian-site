import { el, mount } from './dom.js';
import { store } from '../core/state.js';
import { ROOF_SHAPES, ROOF_MATERIALS, FACADE_MATERIALS } from '../core/catalog/materials.js';
import { createDormer, createChimney, createSkylight, createSolarPanel } from '../core/roof.js';
import { Scene3D } from '../three/scene.js';
import { buildBuildingGroup } from '../three/buildHouse.js';
import * as THREE from 'three';

let scene3d = null;

export function renderFacade(container) {
  const building = store.currentBuilding();
  if (!building) return null;

  const previewCanvas = el('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
  const formCol = el('div', { class: 'scroll', style: { width: '380px', flex: '0 0 auto', borderRight: '1px solid var(--border)', padding: '18px', background: 'var(--panel)' } });
  const previewCol = el('div', { style: { flex: 1, position: 'relative' } }, [previewCanvas]);

  mount(container, [el('div', { style: { display: 'flex', height: '100%' } }, [formCol, previewCol])]);

  renderForm(formCol, building);

  scene3d = new Scene3D(previewCanvas);
  refreshPreview(building);
  const size = Math.max(building.footprint.w, building.footprint.h);
  scene3d.camera.position.set(size * 1.3, size * 0.9 + 2, size * 1.3);
  scene3d.orbit.target.set(0, size * 0.35, 0);
  scene3d.orbit.update();

  return () => { scene3d?.dispose(); scene3d = null; };
}

function refreshPreview(building) {
  if (!scene3d) return;
  const group = buildBuildingGroup(building);
  group.position.set(0, 0, 0);
  scene3d.setContent(group);
}

function update(building, mutator) {
  store.mutate(() => mutator(building));
  refreshPreview(building);
}

function field(label, node) {
  return el('div', { class: 'field' }, [el('label', {}, label), node]);
}

function renderForm(container, building) {
  const roof = building.roof, facade = building.facade;

  mount(container, [
    el('h3', {}, 'Dach'),
    el('div', { class: 'option-grid' }, ROOF_SHAPES.map((s) => shapeCard(s, building))),
    field(`Neigung: ${roof.pitch}°`, el('input', { type: 'range', min: 10, max: 60, value: roof.pitch, onInput: (e) => update(building, (b) => { b.roof.pitch = +e.target.value; }) })),
    field(`Überstand: ${roof.overhang} m`, el('input', { type: 'range', min: 0, max: 1.5, step: 0.1, value: roof.overhang, onInput: (e) => update(building, (b) => { b.roof.overhang = +e.target.value; }) })),
    field('Dachmaterial', el('div', { class: 'swatches' }, ROOF_MATERIALS.map((m) => swatch(m.color, roof.material === m.id, () => update(building, (b) => { b.roof.material = m.id; b.roof.color = m.color; }))))),
    field('Dachfarbe', el('input', { type: 'color', value: roof.color, onInput: (e) => update(building, (b) => { b.roof.color = e.target.value; }) })),

    el('h3', { style: { marginTop: '18px' } }, 'Dachaufbauten'),
    el('div', { class: 'row', style: { flexWrap: 'wrap' } }, [
      el('button', { onClick: () => update(building, (b) => b.roof.dormers.push(createDormer('A', building.footprint.w / 2))) }, '+ Gaube'),
      el('button', { onClick: () => update(building, (b) => b.roof.skylights.push(createSkylight('A', building.footprint.w / 2))) }, '+ Dachfenster'),
      el('button', { onClick: () => update(building, (b) => b.roof.chimneys.push(createChimney(building.footprint.w * 0.7, building.footprint.h * 0.5))) }, '+ Schornstein'),
      el('button', { onClick: () => update(building, (b) => b.roof.solar.push(createSolarPanel('A', building.footprint.w / 2))) }, '+ Solarpanel'),
    ]),
    listEditor('Gauben', roof.dormers, (id) => update(building, (b) => { b.roof.dormers = b.roof.dormers.filter((x) => x.id !== id); })),
    listEditor('Dachfenster', roof.skylights, (id) => update(building, (b) => { b.roof.skylights = b.roof.skylights.filter((x) => x.id !== id); })),
    listEditor('Schornsteine', roof.chimneys, (id) => update(building, (b) => { b.roof.chimneys = b.roof.chimneys.filter((x) => x.id !== id); })),
    listEditor('Solarpanels', roof.solar, (id) => update(building, (b) => { b.roof.solar = b.roof.solar.filter((x) => x.id !== id); })),

    el('h3', { style: { marginTop: '18px' } }, 'Fassade'),
    field('Material', el('div', { class: 'swatches' }, FACADE_MATERIALS.map((m) => swatch(m.color, facade.primary.material === m.id, () => update(building, (b) => { b.facade.primary = { material: m.id, color: m.color }; }))))),
    field('Farbe', el('input', { type: 'color', value: facade.primary.color, onInput: (e) => update(building, (b) => { b.facade.primary.color = e.target.value; }) })),

    el('div', { class: 'row' }, [
      el('label', { class: 'row' }, [
        el('input', { type: 'checkbox', ...(facade.secondary ? { checked: true } : {}), onChange: (e) => update(building, (b) => { b.facade.secondary = e.target.checked ? { material: 'wood', color: '#8a6b4d', appliesTo: 'upper' } : null; }) }),
        'Zweites Material kombinieren',
      ]),
    ]),
    facade.secondary ? el('div', {}, [
      field('Zweites Material', el('div', { class: 'swatches' }, FACADE_MATERIALS.map((m) => swatch(m.color, facade.secondary.material === m.id, () => update(building, (b) => { b.facade.secondary.material = m.id; b.facade.secondary.color = m.color; }))))),
      field('Zuordnung', el('select', { onChange: (e) => update(building, (b) => { b.facade.secondary.appliesTo = e.target.value; }) }, [
        el('option', { value: 'ground', selected: facade.secondary.appliesTo === 'ground' }, 'Erdgeschoss'),
        el('option', { value: 'upper', selected: facade.secondary.appliesTo === 'upper' }, 'Obergeschosse'),
        el('option', { value: 'base', selected: facade.secondary.appliesTo === 'base' }, 'Sockel/Keller'),
      ])),
    ]) : null,

    el('h3', { style: { marginTop: '18px' } }, 'Fenster & Tür'),
    field('Fensterrahmen-Farbe', el('input', { type: 'color', value: facade.windowFrameColor, onInput: (e) => update(building, (b) => { b.facade.windowFrameColor = e.target.value; }) })),
    el('label', { class: 'row' }, [el('input', { type: 'checkbox', ...(facade.shutters ? { checked: true } : {}), onChange: (e) => update(building, (b) => { b.facade.shutters = e.target.checked; }) }), 'Fensterläden']),
    field('Haustürfarbe', el('input', { type: 'color', value: facade.doorColor, onInput: (e) => update(building, (b) => { b.facade.doorColor = e.target.value; }) })),

    el('h3', { style: { marginTop: '18px' } }, 'Anbauten'),
    el('div', { class: 'row', style: { flexWrap: 'wrap' } }, [
      addAttachmentBtn(building, 'balcony', 'Balkon'),
      addAttachmentBtn(building, 'bay', 'Erker'),
      addAttachmentBtn(building, 'canopy', 'Vordach'),
      addAttachmentBtn(building, 'terraceRoof', 'Terrassenüberdachung'),
      addAttachmentBtn(building, 'stairs', 'Außentreppe'),
    ]),
    ...(building.attachments || []).map((a) => attachmentRow(building, a)),
  ]);
}

function shapeCard(shape, building) {
  const selected = building.roof.shape === shape.id;
  return el('div', { class: 'option-card' + (selected ? ' selected' : ''), onClick: () => update(building, (b) => { b.roof.shape = shape.id; }) }, [el('div', { class: 'name' }, shape.name)]);
}

function swatch(color, active, onClick) {
  return el('div', { class: 'sw' + (active ? ' active' : ''), style: { background: color }, onClick });
}

function listEditor(label, list, onDelete) {
  if (!list || !list.length) return null;
  return el('div', { style: { marginBottom: '10px' } }, [
    el('div', { class: 'cat-title' }, label),
    ...list.map((item) => el('div', { class: 'row', style: { fontSize: '12px', marginBottom: '4px' } }, [
      el('span', { class: 'muted' }, item.id),
      el('div', { class: 'spacer' }),
      el('button', { class: 'icon danger', onClick: () => onDelete(item.id) }, '×'),
    ])),
  ]);
}

function addAttachmentBtn(building, type, label) {
  return el('button', { onClick: () => update(building, (b) => {
    b.attachments = b.attachments || [];
    b.attachments.push({ id: `att_${Date.now().toString(36)}`, type, side: 'front', offset: 0, w: 2.5, d: 1.2 });
  }) }, `+ ${label}`);
}

function attachmentRow(building, a) {
  return el('div', { class: 'row', style: { border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 8px', marginBottom: '6px', fontSize: '12px' } }, [
    el('span', {}, attachmentLabel(a.type)),
    el('select', { onChange: (e) => update(building, (b) => { a.side = e.target.value; }) }, ['front', 'back', 'left', 'right'].map((s) => el('option', { value: s, selected: a.side === s }, sideLabel(s)))),
    el('div', { class: 'spacer' }),
    el('button', { class: 'icon danger', onClick: () => update(building, (b) => { b.attachments = b.attachments.filter((x) => x.id !== a.id); }) }, '×'),
  ]);
}

function attachmentLabel(type) {
  return { balcony: 'Balkon', bay: 'Erker', canopy: 'Vordach', terraceRoof: 'Terrassenüberdachung', stairs: 'Außentreppe' }[type] || type;
}
function sideLabel(s) {
  return { front: 'Vorne', back: 'Hinten', left: 'Links', right: 'Rechts' }[s] || s;
}
