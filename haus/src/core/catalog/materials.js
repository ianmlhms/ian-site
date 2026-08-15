// Materialkatalog für Fassade, Dach und Boden. color = 2D-Vorschaufarbe;
// die 3D-Schicht (three/materials3d.js) liest dieselben IDs und legt Textur-Parameter drauf.

export const FACADE_MATERIALS = [
  { id: 'plaster', name: 'Putz', color: '#e8e2d5', roughness: 0.9, metalness: 0.0 },
  { id: 'brick', name: 'Klinker/Backstein', color: '#a9503b', roughness: 0.85, metalness: 0.0 },
  { id: 'wood', name: 'Holzverschalung', color: '#8a6b4d', roughness: 0.7, metalness: 0.0 },
  { id: 'stone', name: 'Naturstein', color: '#8a8478', roughness: 0.95, metalness: 0.0 },
  { id: 'concrete', name: 'Sichtbeton', color: '#a3a3a0', roughness: 0.8, metalness: 0.0 },
  { id: 'slate', name: 'Schiefer', color: '#4a4f52', roughness: 0.6, metalness: 0.05 },
];

export const ROOF_MATERIALS = [
  { id: 'tile_red', name: 'Ziegel rot', color: '#8a3324', roughness: 0.8 },
  { id: 'tile_anthracite', name: 'Ziegel anthrazit', color: '#3a3d40', roughness: 0.75 },
  { id: 'tile_black', name: 'Ziegel schwarz', color: '#26262a', roughness: 0.7 },
  { id: 'tile_grey', name: 'Ziegel grau', color: '#767a7d', roughness: 0.8 },
  { id: 'metal', name: 'Metalldach', color: '#8f9599', roughness: 0.4, metalness: 0.5 },
];

export const FLOOR_MATERIALS = [
  { id: 'parquet', name: 'Parkett', color: '#c2955f' },
  { id: 'tileFloor', name: 'Fliesen', color: '#d8d4c8' },
  { id: 'laminate', name: 'Laminat', color: '#cba876' },
  { id: 'carpet', name: 'Teppichboden', color: '#a8a09a' },
  { id: 'concreteFloor', name: 'Beton geschliffen', color: '#b0aea8' },
  { id: 'stoneFloor', name: 'Naturstein', color: '#9a9488' },
  { id: 'vinylFloor', name: 'Vinyl', color: '#bfa07a' },
  { id: 'coldStore', name: 'Estrich (unbehandelt)', color: '#c7c3ba' },
];

export const ROOF_SHAPES = [
  { id: 'gable', name: 'Satteldach' },
  { id: 'hip', name: 'Walmdach' },
  { id: 'flat', name: 'Flachdach' },
  { id: 'shed', name: 'Pultdach' },
  { id: 'halfHip', name: 'Krüppelwalmdach' },
  { id: 'mansard', name: 'Mansarddach' },
  { id: 'pyramid', name: 'Zeltdach' },
  { id: 'gambrel', name: 'Tonnendach' },
];

export function findFacadeMaterial(id) {
  return FACADE_MATERIALS.find((m) => m.id === id) || FACADE_MATERIALS[0];
}
export function findRoofMaterial(id) {
  return ROOF_MATERIALS.find((m) => m.id === id) || ROOF_MATERIALS[0];
}
export function findFloorMaterial(id) {
  return FLOOR_MATERIALS.find((m) => m.id === id) || FLOOR_MATERIALS[0];
}
