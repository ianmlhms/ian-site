// Grundstück in 3D: Bodenfläche + Gartenobjekte als einfache, wiedererkennbare Formen.

import * as THREE from 'three';
import { findOutdoorType } from '../core/catalog/outdoor.js';
import { genericMaterials, colorMaterial } from './materials3d.js';

const FLAT_TYPES = new Set(['lawn', 'gravel', 'paving', 'pathway', 'driveway', 'terrace', 'deck', 'flowerbed', 'vegPatch', 'flowerBedRound', 'grassOrnamental']);
const WATER_TYPES = new Set(['pool', 'pond']);
const TREE_TYPES = new Set(['treeSmall', 'treeMedium', 'treeLarge']);
const BUILDING_TYPES = new Set(['garageOut', 'shed', 'greenhouse', 'carport', 'pergola']);
const LINE_TYPES = new Set(['hedgeSection', 'fenceSection', 'wallSection', 'gate']);

export function buildSiteGroup(design) {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(design.plot.w + 6, design.plot.h + 6), genericMaterials.plot);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(design.plot.w / 2, -0.03, design.plot.h / 2);
  ground.receiveShadow = true;
  group.add(ground);

  for (const o of design.outdoor) group.add(buildOutdoorItem(o));
  return group;
}

function buildOutdoorItem(o) {
  const type = findOutdoorType(o.typeId);
  const w = o.w, d = o.h;
  const inner = new THREE.Group();

  if (TREE_TYPES.has(o.typeId)) {
    const trunkH = Math.min(w, d) * 0.7;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.06, Math.min(w, d) * 0.09, trunkH, 8), genericMaterials.trunk);
    trunk.position.set(0, trunkH / 2, 0);
    const foliage = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) / 2, 10, 8), genericMaterials.foliage);
    foliage.position.set(0, trunkH + (Math.min(w, d) / 2) * 0.6, 0);
    trunk.castShadow = true; foliage.castShadow = true;
    inner.add(trunk, foliage);
  } else if (WATER_TYPES.has(o.typeId)) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), genericMaterials.water);
    mesh.position.set(0, 0.02, 0);
    inner.add(mesh);
  } else if (BUILDING_TYPES.has(o.typeId)) {
    const height = o.typeId === 'pergola' ? 2.2 : 2.4;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), colorMaterial(type.color));
    walls.position.set(0, height / 2, 0);
    walls.castShadow = true; walls.receiveShadow = true;
    inner.add(walls);
    if (o.typeId !== 'pergola') {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.22, d * 1.06), colorMaterial('#5a4a3d'));
      roof.position.set(0, height + 0.11, 0);
      inner.add(roof);
    }
  } else if (LINE_TYPES.has(o.typeId)) {
    const height = o.typeId === 'gate' ? 1.2 : o.typeId === 'wallSection' ? 0.8 : 1.0;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, Math.max(0.12, d)), colorMaterial(type.color));
    mesh.position.set(0, height / 2, 0);
    mesh.castShadow = true;
    inner.add(mesh);
  } else if (FLAT_TYPES.has(o.typeId)) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), colorMaterial(type.color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.01, 0);
    mesh.receiveShadow = true;
    inner.add(mesh);
  } else {
    const height = 0.5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), colorMaterial(type.color));
    mesh.position.set(0, height / 2, 0);
    mesh.castShadow = true;
    inner.add(mesh);
  }

  const outer = new THREE.Group();
  outer.add(inner);
  outer.position.set(o.x + w / 2, 0, o.y + d / 2);
  outer.rotation.y = -((o.rot || 0) * Math.PI) / 180;
  return outer;
}
