// Ergänzt fehlende Felder in geladenen/importierten Projekten (Abwärtskompatibilität).
// Wird sowohl auf ganze Projekte als auch auf importierte Einzel-Entwürfe angewendet.

import { createDesign, createBuilding, createFloor, createVariant, createProject, uid } from './model.js';
import { regenerateAllWalls } from './walls.js';

function fillFloor(raw, level) {
  const base = createFloor(level);
  return {
    ...base,
    ...raw,
    rooms: Array.isArray(raw?.rooms) ? raw.rooms : [],
    walls: Array.isArray(raw?.walls) ? raw.walls : [],
    openings: Array.isArray(raw?.openings) ? raw.openings : [],
    furniture: Array.isArray(raw?.furniture) ? raw.furniture : [],
  };
}

function fillBuilding(raw) {
  const base = createBuilding(raw?.kind, raw?.name);
  const floors = Array.isArray(raw?.floors) && raw.floors.length
    ? raw.floors.map((f, i) => fillFloor(f, f?.level ?? i))
    : base.floors;
  return {
    ...base,
    ...raw,
    footprint: { ...base.footprint, ...(raw?.footprint || {}) },
    floors,
    shafts: Array.isArray(raw?.shafts) ? raw.shafts : [],
    roof: { ...base.roof, ...(raw?.roof || {}) },
    facade: { ...base.facade, ...(raw?.facade || {}) },
    attachments: Array.isArray(raw?.attachments) ? raw.attachments : [],
  };
}

export function migrateDesign(raw) {
  if (!raw) return createDesign();
  const base = createDesign(raw.style, raw.name);
  const buildings = Array.isArray(raw.buildings) && raw.buildings.length
    ? raw.buildings.map(fillBuilding)
    : base.buildings;
  const design = {
    ...base,
    ...raw,
    plot: { ...base.plot, ...(raw.plot || {}) },
    buildings,
    outdoor: Array.isArray(raw.outdoor) ? raw.outdoor : [],
    meta: { ...base.meta, ...(raw.meta || {}) },
  };
  regenerateAllWalls(design);
  return design;
}

export function migrateVariant(raw) {
  const design = migrateDesign(raw?.current);
  return {
    id: raw?.id || uid('variant'),
    name: raw?.name || 'Variante',
    current: design,
    snapshots: Array.isArray(raw?.snapshots)
      ? raw.snapshots.map((s) => ({
          id: s.id || uid('snap'),
          label: s.label || 'Version',
          note: s.note || '',
          createdAt: s.createdAt || Date.now(),
          thumb: s.thumb || null,
          metrics: s.metrics || null,
          design: migrateDesign(s.design),
        }))
      : [],
  };
}

export function migrateProject(raw) {
  if (!raw) return createProject('Neues Haus', 'modern');
  const variants = Array.isArray(raw.variants) && raw.variants.length
    ? raw.variants.map(migrateVariant)
    : [createVariant('Hauptvariante', migrateDesign(raw.design || raw.current))];
  return {
    id: raw.id || uid('project'),
    name: raw.name || 'Unbenanntes Projekt',
    style: raw.style || variants[0]?.current?.style || 'modern',
    variants,
    activeVariant: variants.find((v) => v.id === raw.activeVariant) ? raw.activeVariant : variants[0].id,
    lastOpenedAt: raw.lastOpenedAt || Date.now(),
    lastUI: raw.lastUI || null,
  };
}
