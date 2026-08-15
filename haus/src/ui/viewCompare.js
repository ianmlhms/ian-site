import { el, mount } from './dom.js';
import { store } from '../core/state.js';
import { renderThumbnail } from '../storage/thumbnail.js';
import { diffDesigns } from '../storage/diff.js';

function resolveDesign(project, ref) {
  const variant = project.variants.find((v) => v.id === ref.variantId) || project.variants[0];
  if (!ref.snapshotId) return { design: variant.current, label: `${variant.name} — aktueller Stand` };
  const snap = variant.snapshots.find((s) => s.id === ref.snapshotId);
  return snap ? { design: snap.design, label: `${variant.name} — ${snap.label}` } : { design: variant.current, label: variant.name };
}

function picker(project, ref, onChange) {
  const options = [];
  for (const v of project.variants) {
    options.push(el('option', { value: `${v.id}::current`, selected: ref.variantId === v.id && !ref.snapshotId }, `${v.name} — aktueller Stand`));
    for (const s of v.snapshots) {
      options.push(el('option', { value: `${v.id}::${s.id}`, selected: ref.variantId === v.id && ref.snapshotId === s.id }, `${v.name} — ${s.label}`));
    }
  }
  return el('select', {
    onChange: (e) => {
      const [variantId, snapshotId] = e.target.value.split('::');
      onChange({ variantId, snapshotId: snapshotId === 'current' ? null : snapshotId });
    },
  }, options);
}

export function renderCompare(container) {
  const project = store.project;
  const left = store.ui.compareLeft;
  const right = store.ui.compareRight;

  function rerender() {
    const a = resolveDesign(project, store.ui.compareLeft);
    const b = resolveDesign(project, store.ui.compareRight);
    const diffs = diffDesigns(a.design, b.design);

    mount(container, [
      el('div', { id: 'compareView' }, [
        el('div', { class: 'compare-pane' }, [
          el('div', { class: 'pane-head row' }, [picker(project, store.ui.compareLeft, (r) => { store.ui.compareLeft = r; rerender(); })]),
          el('div', { class: 'col', style: { alignItems: 'center', padding: '18px' } }, [
            el('img', { src: renderThumbnail(a.design, 480, 340), style: { maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '8px' } }),
          ]),
        ]),
        el('div', { class: 'compare-pane' }, [
          el('div', { class: 'pane-head row' }, [picker(project, store.ui.compareRight, (r) => { store.ui.compareRight = r; rerender(); })]),
          el('div', { class: 'col', style: { alignItems: 'center', padding: '18px' } }, [
            el('img', { src: renderThumbnail(b.design, 480, 340), style: { maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '8px' } }),
          ]),
        ]),
        el('div', { class: 'diff-list' }, [
          el('div', { class: 'row' }, [el('h3', {}, 'Unterschiede'), el('div', { class: 'spacer' }), el('button', { onClick: () => store.setView('site', { buildingId: store.design.buildings[0].id, floorId: store.design.buildings[0].floors[0].id }) }, '✕ Schließen')]),
          diffs.length === 0
            ? el('p', { class: 'muted' }, 'Keine Unterschiede gefunden.')
            : el('div', {}, diffs.map((d) => el('div', { class: 'diff-entry' }, [el('strong', {}, d.label + ': '), d.detail]))),
        ]),
      ]),
    ]);
  }

  rerender();
}
