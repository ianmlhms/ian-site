// Overlay-Panel: Varianten verwalten + Zeitachse gesicherter Stände.
// Eigenes DOM-Element, unabhängig vom Wizard-Overlay, damit Router-Wechsel es nicht schließen.

import { el, mount, fmtDate, toast } from './dom.js';
import { store } from '../core/state.js';
import { storage } from '../storage/adapter.js';
import { renderThumbnail } from '../storage/thumbnail.js';
import {
  duplicateVariant, renameVariant, deleteVariant, switchVariant,
  saveSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot,
  exportSnapshotJSON, exportVariantJSON, importDesignAsVariant,
} from '../storage/versions.js';

let overlay = null;
function getOverlay() {
  if (!overlay) {
    overlay = el('div', { id: 'versionsOverlay', style: {
      position: 'fixed', inset: '0', background: 'rgba(10,12,16,.5)',
      display: 'none', alignItems: 'center', justifyContent: 'center', zIndex: '150',
    } });
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
  return overlay;
}

function close() {
  getOverlay().style.display = 'none';
}

function persistAndRefresh() {
  storage.save(store.project, renderThumbnail(store.design));
  store.emit('project');
  render();
}

export function renderVersionsPanel() {
  const ov = getOverlay();
  ov.style.display = 'flex';
  render();
}

function render() {
  const project = store.project;
  if (!project) return;
  const variant = store.variant;
  const usage = storage.usage();

  const card = el('div', { class: 'wizard-card', style: { width: '640px' } }, [
    el('div', { class: 'row' }, [el('h2', {}, 'Varianten & Versionen'), el('div', { class: 'spacer' }), el('button', { class: 'icon', onClick: close }, '✕')]),

    el('h3', {}, 'Varianten'),
    ...project.variants.map((v) => el('div', { class: 'version-item' }, [
      el('div', { class: 'info' }, [
        el('div', { class: 'name' }, v.name + (v.id === project.activeVariant ? '  •  aktiv' : '')),
        el('div', { class: 'date' }, `${v.snapshots.length} gesicherte Stände`),
      ]),
      v.id !== project.activeVariant ? el('button', { onClick: () => { switchVariant(project, v.id); persistAndRefresh(); } }, 'Aktivieren') : null,
      el('button', { onClick: () => { const n = window.prompt('Name der Variante:', v.name); if (n) { renameVariant(project, v.id, n); persistAndRefresh(); } } }, 'Umbenennen'),
      el('button', { onClick: () => { const n = window.prompt('Name der neuen Variante:', v.name + ' (Kopie)'); if (n) { duplicateVariant(project, v.id, n); persistAndRefresh(); toast('Variante dupliziert.'); } } }, 'Duplizieren'),
      project.variants.length > 1 ? el('button', { class: 'danger', onClick: () => { if (window.confirm('Variante wirklich löschen?')) { deleteVariant(project, v.id); persistAndRefresh(); } } }, 'Löschen') : null,
      el('button', { onClick: () => downloadText(`${project.name}-${v.name}.json`, exportVariantJSON(v)) }, 'Export'),
    ])),

    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      el('button', { onClick: () => { const n = window.prompt('Name der neuen Variante:', 'Neue Variante'); if (n) { const nv = duplicateVariant(project, variant.id, n); switchVariant(project, nv.id); persistAndRefresh(); } } }, '+ Neue Variante (Kopie)'),
      importVariantButton(project),
    ]),

    el('h3', { style: { marginTop: '18px' } }, `Gesicherte Stände — ${variant.name}`),
    el('button', { class: 'primary', style: { marginBottom: '10px' }, onClick: () => {
      const label = window.prompt('Name für diesen Stand:', `Version ${variant.snapshots.length + 1}`);
      if (!label) return;
      const note = window.prompt('Notiz (optional):', '') || '';
      saveSnapshot(project, variant.id, label, note);
      persistAndRefresh();
      toast('Version gesichert.');
    } }, 'Version sichern'),
    variant.snapshots.length === 0
      ? el('p', { class: 'muted' }, 'Noch keine gesicherten Stände für diese Variante.')
      : el('div', {}, variant.snapshots.map((s) => el('div', { class: 'version-item' }, [
          s.thumb ? el('img', { class: 'thumb', src: s.thumb }) : el('div', { class: 'thumb' }),
          el('div', { class: 'info' }, [
            el('div', { class: 'name' }, s.label),
            el('div', { class: 'date' }, `${fmtDate(s.createdAt)}${s.note ? ' · ' + s.note : ''}${s.metrics ? ' · ' + s.metrics.livingAreaM2 + ' m²' : ''}`),
          ]),
          el('button', { onClick: () => { restoreSnapshot(project, variant.id, s.id); persistAndRefresh(); toast('Stand zurückgeladen.'); } }, 'Zurückladen'),
          el('button', { onClick: () => { const n = window.prompt('Neuer Name:', s.label); if (n) { renameSnapshot(project, variant.id, s.id, n); persistAndRefresh(); } } }, 'Umbenennen'),
          el('button', { onClick: () => downloadText(`${project.name}-${s.label}.json`, exportSnapshotJSON(s)) }, 'Export'),
          el('button', { class: 'danger', onClick: () => { if (window.confirm('Version löschen?')) { deleteSnapshot(project, variant.id, s.id); persistAndRefresh(); } } }, 'Löschen'),
        ]))),

    el('div', { class: 'field', style: { marginTop: '18px' } }, [
      el('label', {}, `Gespeicherte Projektdaten: ${(usage.bytes / 1024).toFixed(0)} KB`),
    ]),

    el('button', { style: { marginTop: '10px' }, onClick: () => openCompare(project, variant) }, 'Zwei Stände vergleichen →'),
  ]);

  mount(getOverlay(), card);
}

function importVariantButton(project) {
  const input = el('input', { type: 'file', accept: '.json', class: 'hidden', onChange: (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importDesignAsVariant(project, reader.result, 'Importierte Variante');
        persistAndRefresh();
        toast('Als neue Variante importiert.');
      } catch { toast('Import fehlgeschlagen.'); }
    };
    reader.readAsText(file);
  } });
  return el('button', { onClick: () => input.click() }, ['Variante importieren', input]);
}

function openCompare(project, variant) {
  const left = { variantId: variant.id, snapshotId: null };
  const right = { variantId: variant.id, snapshotId: variant.snapshots[0]?.id || null };
  close();
  store.setView('compare', { compareLeft: left, compareRight: right });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
