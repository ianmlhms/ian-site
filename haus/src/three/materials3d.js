import * as THREE from 'three';
import { findFacadeMaterial, findRoofMaterial, findFloorMaterial } from '../core/catalog/materials.js';

const cache = new Map();
function cached(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const m = factory();
  cache.set(key, m);
  return m;
}

export function facadeMaterial3d(materialId, colorOverride) {
  const m = findFacadeMaterial(materialId);
  const color = colorOverride || m.color;
  return cached(`facade:${materialId}:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: m.roughness ?? 0.85, metalness: m.metalness ?? 0 }));
}

export function roofMaterial3d(materialId, colorOverride) {
  const m = findRoofMaterial(materialId);
  const color = colorOverride || m.color;
  return cached(`roof:${materialId}:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: m.roughness ?? 0.75, metalness: m.metalness ?? 0 }));
}

export function floorMaterial3d(materialId) {
  const m = findFloorMaterial(materialId);
  return cached(`floor:${materialId}`, () => new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.9 }));
}

export const genericMaterials = {
  get glass() { return cached('glass', () => new THREE.MeshPhysicalMaterial({ color: '#bcdcea', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, transmission: 0.5 })); },
  get windowFrame() { return cached('windowFrame', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })); },
  get door() { return cached('door', () => new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.7 })); },
  get lawn() { return cached('lawn', () => new THREE.MeshStandardMaterial({ color: '#7cb872', roughness: 1 })); },
  get plot() { return cached('plot', () => new THREE.MeshStandardMaterial({ color: '#8fae6f', roughness: 1 })); },
  get water() { return cached('water', () => new THREE.MeshStandardMaterial({ color: '#4a8ca3', roughness: 0.2, metalness: 0.1 })); },
  get paving() { return cached('paving', () => new THREE.MeshStandardMaterial({ color: '#b3a99a', roughness: 0.9 })); },
  get wood() { return cached('wood', () => new THREE.MeshStandardMaterial({ color: '#8a6b4d', roughness: 0.8 })); },
  get foliage() { return cached('foliage', () => new THREE.MeshStandardMaterial({ color: '#4f7a3f', roughness: 1 })); },
  get trunk() { return cached('trunk', () => new THREE.MeshStandardMaterial({ color: '#6b4a30', roughness: 1 })); },
  get generic() { return cached('generic-furn', () => new THREE.MeshStandardMaterial({ color: '#9a8f7c', roughness: 0.8 })); },
};

export function colorMaterial(hex) {
  return cached(`color:${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 }));
}
