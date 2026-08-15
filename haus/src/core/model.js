// Fabrikfunktionen für das Datenmodell. Kein DOM, keine Rendering-Logik.

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
}

export const FLOOR_PRESETS = [
  { level: -1, name: 'Keller', height: 2.4 },
  { level: 0, name: 'Erdgeschoss', height: 2.6 },
  { level: 1, name: 'Obergeschoss', height: 2.6 },
  { level: 2, name: 'Dachgeschoss', height: 2.3 },
];

export function createFloor(level) {
  const preset = FLOOR_PRESETS.find((f) => f.level === level) || { name: `Ebene ${level}`, height: 2.6 };
  return {
    id: uid('floor'),
    name: preset.name,
    level,
    height: preset.height,
    rooms: [],
    walls: [],
    openings: [],
    furniture: [],
  };
}

export function createBuilding(kind = 'main', name = 'Haupthaus') {
  return {
    id: uid('bld'),
    name,
    kind, // 'main' | 'garage' | 'shed'
    footprint: { x: 4, y: 4, w: 10, h: 8 }, // Meter auf dem Grundstück
    rotation: 0,
    floors: [createFloor(0)],
    shafts: [],
    roof: {
      shape: 'gable', // Satteldach
      pitch: 35,
      overhang: 0.5,
      material: 'tile_red',
      color: '#8a3324',
      dormers: [],
      skylights: [],
      chimneys: [],
      solar: [],
    },
    facade: {
      primary: { material: 'plaster', color: '#e8e2d5' },
      secondary: null, // { material, color, appliesTo: 'ground'|'upper'|'base' }
      windowStyle: 'plain',
      windowFrameColor: '#ffffff',
      shutters: false,
      doorStyle: 'modern',
      doorColor: '#5a4632',
    },
    attachments: [],
  };
}

export function createDesign(style = 'modern', name = 'Neues Haus') {
  return {
    id: uid('design'),
    name,
    style,
    version: 1,
    plot: { w: 25, h: 35, north: 0, terrain: 'flat' },
    buildings: [createBuilding('main', 'Haupthaus')],
    outdoor: [],
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      budgetLevel: 'standard',
    },
  };
}

export function createVariant(name, design) {
  return {
    id: uid('variant'),
    name,
    current: design,
    snapshots: [],
  };
}

export function createProject(name, style) {
  const design = createDesign(style, name);
  const variant = createVariant('Hauptvariante', design);
  return {
    id: uid('project'),
    name,
    style,
    variants: [variant],
    activeVariant: variant.id,
    lastOpenedAt: Date.now(),
  };
}

export function createRoom(typeId, x, y, w, h) {
  return { id: uid('room'), typeId, x, y, w, h };
}

export function createFurnitureItem(typeId, x, y, w, h, rot = 0) {
  return { id: uid('furn'), typeId, x, y, w, h, rot };
}

export function createOutdoorItem(typeId, x, y, w, h, rot = 0) {
  return { id: uid('out'), typeId, x, y, w, h, rot, variant: 0 };
}

export function activeVariantOf(project) {
  return project.variants.find((v) => v.id === project.activeVariant) || project.variants[0];
}

export function activeDesignOf(project) {
  const v = activeVariantOf(project);
  return v ? v.current : null;
}

export function mainBuildingOf(design) {
  return design.buildings.find((b) => b.kind === 'main') || design.buildings[0];
}
