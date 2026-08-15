// Vereinfachte Möbeldarstellung als eingefärbte Quader — reicht für die Puppenhaus-
// Ansicht und zur Orientierung beim Begehen, ohne für jedes der ~110 Katalogteile
// ein eigenes 3D-Modell pflegen zu müssen.

import * as THREE from 'three';
import { findFurnitureType } from '../core/catalog/furniture.js';
import { floorBaseElevation } from '../core/roof.js';
import { colorMaterial } from './materials3d.js';

const TALL = ['wardrobe', 'bookshelf', 'fridge', 'pantry', 'closet', 'shelving', 'filing', 'wineRack'];
const LOW = ['rug', 'playRug'];

function heightFor(typeId) {
  if (TALL.some((k) => typeId.toLowerCase().includes(k.toLowerCase()))) return 1.9;
  if (LOW.some((k) => typeId.toLowerCase().includes(k.toLowerCase()))) return 0.02;
  if (typeId.includes('table') || typeId.includes('Table')) return 0.5;
  if (typeId === 'toilet' || typeId === 'sinkVanity' || typeId === 'bidet') return 0.42;
  return 0.55;
}

export function buildFurnitureForFloor(building, floor) {
  const group = new THREE.Group();
  const baseY = floorBaseElevation(building, floor);
  for (const item of floor.furniture) {
    const type = findFurnitureType(item.typeId);
    const height = heightFor(item.typeId);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.w, height, item.h), colorMaterial(type.color));
    mesh.position.set(item.x + item.w / 2, baseY + height / 2, item.y + item.h / 2);
    mesh.rotation.y = -((item.rot || 0) * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
