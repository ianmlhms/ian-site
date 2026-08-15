import { el, mount, fmtDate, toast } from './dom.js';
import { store } from '../core/state.js';
import { storage } from '../storage/adapter.js';
import { createProject } from '../core/model.js';
import { renderThumbnail } from '../storage/thumbnail.js';
import { activeDesignOf } from '../core/model.js';

export function openProject(id) {
  const project = storage.load(id);
  if (!project) { toast('Projekt konnte nicht geladen werden.'); return; }
  store.setProject(project);
  const design = activeDesignOf(project);
  const saved = project.lastUI;
  const building = (saved && design.buildings.find((b) => b.id === saved.buildingId)) || design.buildings[0];
  const floor = (saved && building.floors.find((f) => f.id === saved.floorId)) || building.floors[0];
  const view = (saved && saved.view) || 'site';
  store.setView(view, { buildingId: building.id, floorId: floor.id });
}

export function saveActiveProject() {
  if (!store.project) return;
  const design = store.design;
  const thumb = design ? renderThumbnail(design) : null;
  storage.save(store.project, thumb);
}

export function renderLibrary(container) {
  const list = storage.list();

  const grid = el('div', { class: 'lib-grid' }, [
    el('button', { class: 'lib-card new-card', onClick: () => startWizard() }, '+ Neues Projekt'),
    ...list.map((entry) => renderCard(entry)),
  ]);

  const importInput = el('input', {
    type: 'file', accept: '.json', class: 'hidden',
    onChange: (e) => handleImport(e.target.files[0]),
  });

  mount(container, [
    el('div', { id: 'libraryView' }, [
      el('div', { class: 'row', style: { marginBottom: '22px', alignItems: 'baseline' } }, [
        el('h1', {}, 'Deine Bauprojekte'),
        el('div', { class: 'spacer' }),
        el('button', { onClick: () => importInput.click() }, 'JSON importieren'),
        importInput,
      ]),
      list.length === 0
        ? el('p', { class: 'muted' }, 'Noch keine Projekte gespeichert — leg mit „Neues Projekt“ los.')
        : null,
      grid,
    ]),
  ]);
}

function renderCard(entry) {
  const card = el('div', { class: 'lib-card' }, [
    el('div', { class: 'thumb' }, entry.thumb ? el('img', { src: entry.thumb }) : 'Keine Vorschau'),
    el('div', { class: 'meta' }, [
      el('div', { class: 'name' }, entry.name),
      el('div', { class: 'sub' }, `${styleLabel(entry.style)} · ${entry.variantCount} Variante${entry.variantCount === 1 ? '' : 'n'} · ${fmtDate(entry.updatedAt)}`),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'icon', title: 'Umbenennen', onClick: (ev) => { ev.stopPropagation(); renamePrompt(entry); } }, '✎'),
      el('button', { class: 'icon', title: 'Duplizieren', onClick: (ev) => { ev.stopPropagation(); duplicateProject(entry); } }, '⧉'),
      el('button', { class: 'icon danger', title: 'Löschen', onClick: (ev) => { ev.stopPropagation(); deleteProject(entry); } }, '🗑'),
    ]),
  ]);
  card.addEventListener('click', () => openProject(entry.id));
  return card;
}

function styleLabel(style) {
  return { modern: 'Modern', classic: 'Landhaus', scandi: 'Skandinavisch', mediterranean: 'Mediterran' }[style] || style;
}

function renamePrompt(entry) {
  const name = window.prompt('Neuer Projektname:', entry.name);
  if (!name) return;
  const project = storage.load(entry.id);
  if (!project) return;
  project.name = name;
  storage.save(project, entry.thumb);
  refreshLibrary();
}

function duplicateProject(entry) {
  const project = storage.load(entry.id);
  if (!project) return;
  const copy = JSON.parse(JSON.stringify(project));
  copy.id = project.id + '_copy_' + Date.now().toString(36);
  copy.name = project.name + ' (Kopie)';
  storage.save(copy, entry.thumb);
  refreshLibrary();
  toast('Projekt dupliziert.');
}

function deleteProject(entry) {
  if (!window.confirm(`„${entry.name}“ endgültig löschen?`)) return;
  storage.remove(entry.id);
  refreshLibrary();
}

function handleImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const project = storage.importProjectJSON(reader.result);
      storage.save(project, renderThumbnail(activeDesignOf(project)));
      refreshLibrary();
      toast('Projekt importiert.');
    } catch (e) {
      toast('Import fehlgeschlagen: ungültige Datei.');
    }
  };
  reader.readAsText(file);
}

function refreshLibrary() {
  const container = document.getElementById('canvasWrap');
  if (container) renderLibrary(container);
}

export function startWizard() {
  store.setView('wizard');
}

export function createAndOpenProject(name, style) {
  const project = createProject(name, style);
  storage.save(project, null);
  store.setProject(project);
  return project;
}
