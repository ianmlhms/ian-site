// Verwaltung von Varianten und gesicherten Ständen innerhalb eines Projekts.
// Reine Zustandsmanipulation; das Aufrufen von store.emit() übernimmt der Aufrufer in der UI.

import { uid, createVariant } from '../core/model.js';
import { migrateDesign } from '../core/migrate.js';
import { renderThumbnail } from './thumbnail.js';
import { fullMetrics } from '../core/metrics.js';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function duplicateVariant(project, variantId, newName) {
  const source = project.variants.find((v) => v.id === variantId);
  if (!source) return null;
  const design = clone(source.current);
  design.id = uid('design');
  const variant = createVariant(newName || `${source.name} (Kopie)`, design);
  project.variants.push(variant);
  return variant;
}

export function renameVariant(project, variantId, name) {
  const v = project.variants.find((x) => x.id === variantId);
  if (v) v.name = name;
}

export function deleteVariant(project, variantId) {
  if (project.variants.length <= 1) return false;
  project.variants = project.variants.filter((v) => v.id !== variantId);
  if (project.activeVariant === variantId) {
    project.activeVariant = project.variants[0].id;
  }
  return true;
}

export function switchVariant(project, variantId) {
  if (project.variants.some((v) => v.id === variantId)) {
    project.activeVariant = variantId;
  }
}

export function saveSnapshot(project, variantId, label, note = '') {
  const v = project.variants.find((x) => x.id === variantId);
  if (!v) return null;
  const snapshot = {
    id: uid('snap'),
    label: label || `Version ${v.snapshots.length + 1}`,
    note,
    createdAt: Date.now(),
    thumb: renderThumbnail(v.current),
    metrics: fullMetrics(v.current),
    design: clone(v.current),
  };
  v.snapshots.unshift(snapshot);
  return snapshot;
}

export function restoreSnapshot(project, variantId, snapshotId) {
  const v = project.variants.find((x) => x.id === variantId);
  if (!v) return false;
  const snap = v.snapshots.find((s) => s.id === snapshotId);
  if (!snap) return false;
  // aktuellen Stand vorher selbst sichern, damit nichts verloren geht
  saveSnapshot(project, variantId, 'Vor dem Zurückladen', `automatisch gesichert vor „${snap.label}“`);
  v.current = clone(snap.design);
  return true;
}

export function renameSnapshot(project, variantId, snapshotId, label) {
  const v = project.variants.find((x) => x.id === variantId);
  const s = v?.snapshots.find((x) => x.id === snapshotId);
  if (s) s.label = label;
}

export function deleteSnapshot(project, variantId, snapshotId) {
  const v = project.variants.find((x) => x.id === variantId);
  if (!v) return;
  v.snapshots = v.snapshots.filter((s) => s.id !== snapshotId);
}

export function exportSnapshotJSON(snapshot) {
  return JSON.stringify(snapshot.design, null, 2);
}

export function exportVariantJSON(variant) {
  return JSON.stringify(variant.current, null, 2);
}

export function importDesignAsVariant(project, jsonText, name) {
  const raw = JSON.parse(jsonText);
  const design = migrateDesign(raw);
  design.id = uid('design');
  const variant = createVariant(name || design.name || 'Importierte Variante', design);
  project.variants.push(variant);
  return variant;
}
