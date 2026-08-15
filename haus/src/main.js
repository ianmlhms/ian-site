import { el, mount, debounce, toast } from './ui/dom.js';
import { store } from './core/state.js';
import { storage } from './storage/adapter.js';
import { renderThumbnail } from './storage/thumbnail.js';
import { renderLibrary } from './ui/viewLibrary.js';
import { renderWizard, hideWizard } from './ui/wizard.js';
import { renderInspector } from './ui/inspector.js';

const VIEW_TABS = [
  { id: 'site', label: 'Lageplan' },
  { id: 'plan', label: 'Grundriss' },
  { id: 'furnish', label: 'Möbel' },
  { id: 'facade', label: 'Dach & Fassade' },
  { id: 'view3d', label: '3D-Ansicht' },
];

// Jede Ansicht wird erst beim Öffnen geladen. Die Pfade stehen als Literale hier,
// damit sowohl der Browser (ES-Module) als auch esbuild (Bundle) sie auflösen können.
const VIEW_LOADERS = {
  site: () => import('./ui/viewSite.js').then((m) => ({ render: m.renderSite })),
  plan: () => import('./ui/viewPlan.js').then((m) => ({ render: m.renderPlan })),
  furnish: () => import('./ui/viewFurnish.js').then((m) => ({ render: m.renderFurnish })),
  facade: () => import('./ui/viewFacade.js').then((m) => ({ render: m.renderFacade })),
  view3d: () => import('./ui/view3d.js').then((m) => ({ render: m.renderView3d })),
};

let currentUnmount = null;

function renderTopbar() {
  const topbar = document.getElementById('topbar');
  const project = store.project;

  if (!project) {
    mount(topbar, [el('div', { class: 'brand' }, '🏠 Haus-Planer')]);
    return;
  }

  const design = store.design;
  const variant = store.variant;

  mount(topbar, [
    el('div', { class: 'brand', style: { cursor: 'pointer' }, onClick: () => goLibrary() }, '🏠 Haus-Planer'),
    el('input', {
      type: 'text', value: project.name, style: { width: '160px' },
      onChange: (e) => { project.name = e.target.value; saveNow(); store.emit('project'); },
    }),
    el('select', {
      id: 'variantSelect',
      onChange: (e) => { switchVariant(e.target.value); },
    }, project.variants.map((v) => el('option', { value: v.id, selected: v.id === project.activeVariant }, v.name))),
    el('div', { class: 'views' }, VIEW_TABS.map((t) => el('button', {
      class: store.ui.view === t.id ? 'active' : '',
      onClick: () => store.setView(t.id, { buildingId: store.ui.buildingId, floorId: store.ui.floorId }),
    }, t.label))),
    el('div', { class: 'spacer' }),
    el('button', { title: 'Rückgängig (Cmd+Z)', onClick: () => store.undo() }, '↶'),
    el('button', { title: 'Wiederholen (Shift+Cmd+Z)', onClick: () => store.redo() }, '↷'),
    el('button', { onClick: () => openVersionsPanel() }, `Versionen (${variant.snapshots.length})`),
    el('button', { onClick: () => exportPNG() }, 'PNG'),
    el('button', { onClick: () => exportPDF() }, 'PDF'),
    el('button', { class: 'primary', onClick: () => saveVersionPrompt() }, 'Version sichern'),
  ]);
}

function switchVariant(variantId) {
  import('./storage/versions.js').then(({ switchVariant }) => {
    switchVariant(store.project, variantId);
    saveNow();
    store.setView('site', { buildingId: store.design.buildings[0].id, floorId: store.design.buildings[0].floors[0].id });
  });
}

async function saveVersionPrompt() {
  const label = window.prompt('Name für diesen Stand:', `Version ${store.variant.snapshots.length + 1}`);
  if (!label) return;
  const note = window.prompt('Notiz (optional):', '') || '';
  const { saveSnapshot } = await import('./storage/versions.js');
  saveSnapshot(store.project, store.variant.id, label, note);
  saveNow();
  toast('Version gesichert.');
  renderTopbar();
}

async function openVersionsPanel() {
  const { renderVersionsPanel } = await import('./ui/viewVersions.js');
  renderVersionsPanel();
}

async function exportPNG() {
  const { downloadFloorplanPNG } = await import('./ui/exporter.js');
  const building = store.currentBuilding();
  const floor = store.currentFloor();
  if (!building || !floor) { toast('Kein Grundriss zum Exportieren vorhanden.'); return; }
  downloadFloorplanPNG(store.design, building, floor);
}

async function exportPDF() {
  const { openPrintableReport } = await import('./ui/exporter.js');
  openPrintableReport(store.design);
}

function goLibrary() {
  currentUnmount?.();
  currentUnmount = null;
  store.project = null;
  store.setView('library');
}

const RESUMABLE_VIEWS = new Set(['site', 'plan', 'furnish', 'facade', 'view3d']);
const saveNow = () => {
  if (!store.project) return;
  if (RESUMABLE_VIEWS.has(store.ui.view)) {
    store.project.lastUI = { view: store.ui.view, buildingId: store.ui.buildingId, floorId: store.ui.floorId };
  }
  const design = store.design;
  storage.save(store.project, design ? renderThumbnail(design) : null);
};
const saveDebounced = debounce(saveNow, 900);

async function renderRoute() {
  document.getElementById('leftPanel').classList.toggle('hidden', !['site', 'plan', 'furnish'].includes(store.ui.view));
  document.getElementById('rightPanel').classList.toggle('hidden', !store.project || store.ui.view === 'library' || store.ui.view === 'wizard' || store.ui.view === 'compare');

  if (currentUnmount) { currentUnmount(); currentUnmount = null; }

  const canvas = document.getElementById('canvasWrap');
  const left = document.getElementById('leftPanel');
  const right = document.getElementById('rightPanel');

  if (store.ui.view !== 'wizard') hideWizard();

  if (store.ui.view === 'library') {
    renderLibrary(canvas);
    return;
  }
  if (store.ui.view === 'wizard') {
    renderWizard();
    return;
  }
  if (store.ui.view === 'compare') {
    const mod = await import('./ui/viewCompare.js');
    currentUnmount = mod.renderCompare(canvas) || null;
    return;
  }

  // Literale import()-Aufrufe, damit der Bundler sie statisch auflösen kann
  // (eine Variable als Pfad wäre für esbuild nicht analysierbar -> Ansichten fehlten im Bundle).
  const loader = VIEW_LOADERS[store.ui.view];
  if (loader) {
    const { render } = await loader();
    currentUnmount = render(canvas, left) || null;
  }
  renderInspector(right);
}

store.subscribe((reason) => {
  renderTopbar();
  if (store.project && reason !== 'selection') {
    document.documentElement.dataset.style = store.design.style;
    saveDebounced();
  }
  renderRoute();
});

document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
  if (meta && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
  if (e.key === 'Escape') store.clearSelection();
});

window.addEventListener('beforeunload', () => saveNow());

// Initialer Zustand: immer die Projektübersicht.
document.documentElement.dataset.style = 'modern';
store.setView('library');
renderTopbar();
renderRoute();
