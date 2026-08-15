import { el, mount } from './dom.js';
import { store } from '../core/state.js';
import { createFloor, FLOOR_PRESETS } from '../core/model.js';
import { createAndOpenProject } from './viewLibrary.js';
import { regenerateAllWalls } from '../core/walls.js';
import { ROOF_SHAPES, FACADE_MATERIALS } from '../core/catalog/materials.js';
import { activeDesignOf } from '../core/model.js';

const STYLES = [
  { id: 'modern', name: 'Modern', desc: 'Klare Linien, Flachdach-Optik, große Fenster.' },
  { id: 'classic', name: 'Landhaus / Klassisch', desc: 'Warme Töne, Holz, Sprossenfenster, Satteldach.' },
  { id: 'scandi', name: 'Skandinavisch', desc: 'Hell, Holz und Weiß, ruhig und minimal.' },
  { id: 'mediterranean', name: 'Mediterran', desc: 'Ockertöne, Terrakotta-Ziegel, Terrassen.' },
];

const HOUSE_PRESETS = [
  { id: 'bungalow', name: 'Bungalow', desc: '10 × 9 m, ebenerdig', w: 10, h: 9, levels: [0] },
  { id: 'efh', name: 'Einfamilienhaus', desc: '10 × 9 m, EG + OG', w: 10, h: 9, levels: [0, 1] },
  { id: 'villa', name: 'Stadtvilla', desc: '12 × 10 m, Keller + EG + OG', w: 12, h: 10, levels: [-1, 0, 1] },
  { id: 'tiny', name: 'Tiny House', desc: '6 × 4 m, ebenerdig', w: 6, h: 4, levels: [0] },
  { id: 'custom', name: 'Eigene Maße', desc: 'Breite, Tiefe und Geschosse frei wählen', w: 10, h: 9, levels: [0, 1] },
];

let draft = null;
let step = 0;

function resetDraft() {
  draft = {
    name: 'Mein Haus',
    style: 'modern',
    plotW: 25, plotH: 35, north: 0,
    house: 'efh',
    footprintW: 10, footprintH: 9,
    levels: [0, 1],
    floorHeights: { '-1': 2.4, '0': 2.6, '1': 2.6, '2': 2.3 },
    roofShape: 'gable', pitch: 35, overhang: 0.5,
    facadeMaterial: 'plaster', facadeColor: '#e8e2d5',
  };
  step = 0;
}

export function renderWizard(container) {
  if (!draft) resetDraft();
  const overlay = document.getElementById('wizardOverlay');
  overlay.classList.remove('hidden');
  mount(overlay, buildCard());
}

export function hideWizard() {
  document.getElementById('wizardOverlay').classList.add('hidden');
}

function rerender() {
  mount(document.getElementById('wizardOverlay'), buildCard());
}

const STEPS = ['Stil', 'Grundstück', 'Haustyp', 'Geschosse', 'Dach', 'Fassade'];

function buildCard() {
  const body = stepBody();
  return el('div', { class: 'wizard-card' }, [
    el('div', { class: 'wizard-steps' }, STEPS.map((_, i) => el('div', { class: 'dot' + (i <= step ? ' done' : '') }))),
    el('h2', {}, `Schritt ${step + 1} von ${STEPS.length}: ${STEPS[step]}`),
    body,
    el('div', { class: 'row', style: { marginTop: '22px' } }, [
      step > 0 ? el('button', { onClick: () => { step -= 1; rerender(); } }, '← Zurück') : el('div'),
      el('div', { class: 'spacer' }),
      step > 0 ? el('button', { onClick: () => { resetDraft(); hideWizard(); store.setView('library'); } }, 'Abbrechen') : null,
      step < STEPS.length - 1
        ? el('button', { class: 'primary', onClick: () => { step += 1; rerender(); } }, 'Weiter →')
        : el('button', { class: 'primary', onClick: finishWizard }, 'Projekt anlegen'),
    ]),
  ]);
}

function stepBody() {
  if (step === 0) return stepStyle();
  if (step === 1) return stepPlot();
  if (step === 2) return stepHouse();
  if (step === 3) return stepFloors();
  if (step === 4) return stepRoof();
  return stepFacade();
}

function stepStyle() {
  return el('div', {}, [
    el('div', { class: 'field' }, [
      el('label', {}, 'Projektname'),
      el('input', { type: 'text', value: draft.name, onInput: (e) => { draft.name = e.target.value; } }),
    ]),
    el('div', { class: 'option-grid' }, STYLES.map((s) => optionCard(s.name, s.desc, draft.style === s.id, () => { draft.style = s.id; rerender(); }))),
  ]);
}

function stepPlot() {
  return el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, `Grundstücksbreite: ${draft.plotW} m`), rangeInput(10, 80, draft.plotW, (v) => { draft.plotW = v; })]),
    el('div', { class: 'field' }, [el('label', {}, `Grundstückstiefe: ${draft.plotH} m`), rangeInput(10, 100, draft.plotH, (v) => { draft.plotH = v; })]),
    el('div', { class: 'field' }, [el('label', {}, `Nordrichtung: ${draft.north}°`), rangeInput(0, 359, draft.north, (v) => { draft.north = v; }, 1)]),
  ]);
}

function rangeInput(min, max, value, onChange, step = 1) {
  return el('input', { type: 'range', min, max, step, value, onInput: (e) => { onChange(+e.target.value); rerenderValueOnly(); } });
}
function rerenderValueOnly() { rerender(); }

function stepHouse() {
  return el('div', {}, [
    el('div', { class: 'option-grid' }, HOUSE_PRESETS.map((p) => optionCard(p.name, p.desc, draft.house === p.id, () => {
      draft.house = p.id;
      if (p.id !== 'custom') { draft.footprintW = p.w; draft.footprintH = p.h; draft.levels = [...p.levels]; }
      rerender();
    }))),
    draft.house === 'custom' ? el('div', { class: 'row', style: { marginTop: '12px' } }, [
      el('div', { class: 'field', style: { flex: 1 } }, [el('label', {}, 'Breite (m)'), el('input', { type: 'number', value: draft.footprintW, min: 4, onInput: (e) => { draft.footprintW = +e.target.value; } })]),
      el('div', { class: 'field', style: { flex: 1 } }, [el('label', {}, 'Tiefe (m)'), el('input', { type: 'number', value: draft.footprintH, min: 4, onInput: (e) => { draft.footprintH = +e.target.value; } })]),
    ]) : null,
  ]);
}

function stepFloors() {
  return el('div', {}, FLOOR_PRESETS.map((preset) => {
    const checked = draft.levels.includes(preset.level);
    return el('div', { class: 'row', style: { marginBottom: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px' } }, [
      el('input', {
        type: 'checkbox', ...(checked ? { checked: true } : {}),
        onChange: (e) => {
          if (e.target.checked) draft.levels.push(preset.level);
          else draft.levels = draft.levels.filter((l) => l !== preset.level);
          rerender();
        },
      }),
      el('div', { style: { flex: 1 } }, preset.name),
      checked ? el('input', {
        type: 'number', step: 0.1, value: draft.floorHeights[preset.level], style: { width: '80px' },
        onInput: (e) => { draft.floorHeights[preset.level] = +e.target.value; },
      }) : null,
      checked ? el('span', { class: 'muted' }, 'm Höhe') : null,
    ]);
  }));
}

function stepRoof() {
  return el('div', {}, [
    el('div', { class: 'option-grid' }, ROOF_SHAPES.map((s) => optionCard(s.name, '', draft.roofShape === s.id, () => { draft.roofShape = s.id; rerender(); }))),
    el('div', { class: 'field', style: { marginTop: '14px' } }, [el('label', {}, `Dachneigung: ${draft.pitch}°`), rangeInput(10, 60, draft.pitch, (v) => { draft.pitch = v; })]),
    el('div', { class: 'field' }, [el('label', {}, `Dachüberstand: ${draft.overhang} m`), rangeInput(0, 1.5, draft.overhang, (v) => { draft.overhang = v; }, 0.1)]),
  ]);
}

function stepFacade() {
  return el('div', {}, [
    el('div', { class: 'field' }, [
      el('label', {}, 'Fassadenmaterial'),
      el('div', { class: 'option-grid' }, FACADE_MATERIALS.map((m) => optionCard(m.name, '', draft.facadeMaterial === m.id, () => { draft.facadeMaterial = m.id; draft.facadeColor = m.color; rerender(); }))),
    ]),
    el('div', { class: 'field' }, [
      el('label', {}, 'Fassadenfarbe'),
      el('input', { type: 'color', value: draft.facadeColor, onInput: (e) => { draft.facadeColor = e.target.value; } }),
    ]),
  ]);
}

function optionCard(name, desc, selected, onClick) {
  return el('div', { class: 'option-card' + (selected ? ' selected' : ''), onClick }, [
    el('div', { class: 'name' }, name),
    desc ? el('div', { class: 'desc' }, desc) : null,
  ]);
}

function finishWizard() {
  const project = createAndOpenProject(draft.name || 'Neues Haus', draft.style);
  const design = activeDesignOf(project);
  design.plot.w = draft.plotW;
  design.plot.h = draft.plotH;
  design.plot.north = draft.north;

  const building = design.buildings[0];
  building.footprint = { x: Math.max(2, (design.plot.w - draft.footprintW) / 2), y: Math.max(2, (design.plot.h - draft.footprintH) / 2), w: draft.footprintW, h: draft.footprintH };
  const levels = draft.levels.length ? [...draft.levels].sort((a, b) => a - b) : [0];
  building.floors = levels.map((level) => {
    const f = createFloor(level);
    f.height = draft.floorHeights[level] || f.height;
    return f;
  });
  building.roof = { ...building.roof, shape: draft.roofShape, pitch: draft.pitch, overhang: draft.overhang };
  building.facade = { ...building.facade, primary: { material: draft.facadeMaterial, color: draft.facadeColor } };
  regenerateAllWalls(design);

  resetDraft();
  hideWizard();
  store.setView('site', { buildingId: building.id, floorId: building.floors[0].id });
  store.emit('project');
}
