// Baut aus dem Zustand (Wände/Öffnungen/Dach) ein Three.js-Modell. Vereinfachungen,
// bewusst gewählt für einen Planer statt eines CAD-Systems: Fenster werden als
// halbtransparente Flächen auf die (weiterhin durchgehende) Wand gelegt statt als
// echtes Loch ausgeschnitten; nur Türen erhalten eine echte Lücke (wichtig fürs Begehen).
// Dächer mit Doppelknick (Mansard/Tonnendach) werden als einfaches Satteldach-Silhouette
// mit korrekter Firsthöhe angenähert.

import * as THREE from 'three';
import { CELL_SIZE } from '../core/geometry.js';
import { roofProfile, floorBaseElevation } from '../core/roof.js';
import { facadeMaterial3d, roofMaterial3d, floorMaterial3d, genericMaterials } from './materials3d.js';
import { buildFurnitureForFloor } from './buildFurniture.js';

function wallDirection(w) {
  const horizontal = w.a.y === w.b.y;
  return horizontal ? { x: 1, z: 0 } : { x: 0, z: 1 };
}

function computeSolidIntervals(length, gaps) {
  const sorted = gaps.slice().sort((a, b) => a[0] - b[0]);
  const result = [];
  let cursor = 0;
  for (const [s, e] of sorted) {
    if (s > cursor) result.push({ start: cursor, end: Math.min(s, length) });
    cursor = Math.max(cursor, e);
  }
  if (cursor < length) result.push({ start: cursor, end: length });
  return result.filter((r) => r.end - r.start > 0.01);
}

function addWallBox(group, startWorld, dir, segStart, segEnd, thickness, baseY, height, material) {
  const len = segEnd - segStart;
  if (len <= 0.01 || height <= 0.01) return;
  const mid = segStart + len / 2;
  const cx = startWorld.x + dir.x * mid;
  const cz = startWorld.z + dir.z * mid;
  const geomW = dir.x ? len : thickness;
  const geomD = dir.z ? len : thickness;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(geomW, height, geomD), material);
  mesh.position.set(cx, baseY + height / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addWindowDecal(group, startWorld, dir, opening, thickness, baseY) {
  const mid = opening.offset + opening.width / 2;
  const cx = startWorld.x + dir.x * mid;
  const cz = startWorld.z + dir.z * mid;
  const cy = baseY + opening.sill + opening.height / 2;
  const geomW = dir.x ? opening.width : thickness * 1.08;
  const geomD = dir.z ? opening.width : thickness * 1.08;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(geomW, opening.height, geomD), genericMaterials.glass);
  mesh.position.set(cx, cy, cz);
  group.add(mesh);
}

function shouldUseSecondary(appliesTo, level) {
  if (!appliesTo) return false;
  if (appliesTo === 'base') return level <= -1;
  if (appliesTo === 'ground') return level === 0;
  if (appliesTo === 'upper') return level >= 1;
  return false;
}

function buildWallsForFloor(building, floor) {
  const group = new THREE.Group();
  const wallHeight = floor.height;
  const baseY = floorBaseElevation(building, floor);
  const primary = facadeMaterial3d(building.facade.primary.material, building.facade.primary.color);
  const secondary = building.facade.secondary ? facadeMaterial3d(building.facade.secondary.material, building.facade.secondary.color) : null;
  const wallMat = secondary && shouldUseSecondary(building.facade.secondary.appliesTo, floor.level) ? secondary : primary;

  for (const w of floor.walls) {
    const startWorld = { x: w.a.x * CELL_SIZE, z: w.a.y * CELL_SIZE };
    const dir = wallDirection(w);
    const doorGaps = floor.openings.filter((o) => o.wallId === w.id && o.type === 'door');
    const solids = computeSolidIntervals(w.lengthM, doorGaps.map((o) => [o.offset, o.offset + o.width]));

    for (const seg of solids) addWallBox(group, startWorld, dir, seg.start, seg.end, w.thickness, baseY, wallHeight, wallMat);
    for (const d of doorGaps) {
      if (d.height < wallHeight) addWallBox(group, startWorld, dir, d.offset, d.offset + d.width, w.thickness, baseY + d.height, wallHeight - d.height, wallMat);
    }
    for (const win of floor.openings.filter((o) => o.wallId === w.id && o.type === 'window')) {
      addWindowDecal(group, startWorld, dir, win, w.thickness, baseY);
    }
  }
  return group;
}

function buildFloorSlab(building, floor) {
  const y = floorBaseElevation(building, floor);
  const thickness = 0.12;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(building.footprint.w, thickness, building.footprint.h), floorMaterial3d('parquet'));
  mesh.position.set(building.footprint.w / 2, y - thickness / 2, building.footprint.h / 2);
  mesh.receiveShadow = true;
  return mesh;
}

function triMesh(vertsFlat, idx, mat) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertsFlat, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function boxRoof(w, height, d, ox, oz, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), mat);
  mesh.position.set(ox + w / 2, height / 2, oz + d / 2);
  mesh.castShadow = true;
  return mesh;
}

function shedRoof(run, span, lowH, highH, ridgeAxis, ox, oz, mat) {
  const map = (u, v) => (ridgeAxis === 'x' ? [ox + u, oz + v] : [ox + v, oz + u]);
  const [x0, z0] = map(0, 0), [x1, z1] = map(run, 0), [x2, z2] = map(run, span), [x3, z3] = map(0, span);
  return triMesh([x0, lowH, z0, x1, lowH, z1, x2, highH, z2, x3, highH, z3], [0, 1, 2, 0, 2, 3], mat);
}

function buildGable(run, span, ridgeHeight, ridgeAxis, ox, oz, mat) {
  const map = (u, v) => (ridgeAxis === 'x' ? [ox + u, oz + v] : [ox + v, oz + u]);
  const P = (u, v, y) => { const [x, z] = map(u, v); return [x, y, z]; };
  const verts = [
    ...P(0, 0, 0), ...P(run, 0, 0), ...P(run, span, 0), ...P(0, span, 0),
    ...P(0, span / 2, ridgeHeight), ...P(run, span / 2, ridgeHeight),
  ];
  const idx = [0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 0, 4, 3, 1, 2, 5];
  return triMesh(verts, idx, mat);
}

function gableEndWalls(runF, spanF, ridgeHeight, ridgeAxis, mat) {
  const map = (u, v) => (ridgeAxis === 'x' ? [u, v] : [v, u]);
  const mk = (u) => {
    const [x1, z1] = map(u, 0), [x2, z2] = map(u, spanF), [xr, zr] = map(u, spanF / 2);
    return triMesh([x1, 0, z1, x2, 0, z2, xr, ridgeHeight, zr], [0, 1, 2], mat);
  };
  return [mk(0), mk(runF)];
}

function buildHip(run, span, ridgeHeight, ridgeAxis, ox, oz, mat, forcePoint) {
  const map = (u, v) => (ridgeAxis === 'x' ? [ox + u, oz + v] : [ox + v, oz + u]);
  const P = (u, v, y) => { const [x, z] = map(u, v); return [x, y, z]; };
  const halfSpan = span / 2;
  const ridgeLen = forcePoint ? 0 : Math.max(0, run - 2 * halfSpan);
  const u0 = (run - ridgeLen) / 2, u1 = (run + ridgeLen) / 2;
  const verts = [
    ...P(0, 0, 0), ...P(run, 0, 0), ...P(run, span, 0), ...P(0, span, 0),
    ...P(u0, span / 2, ridgeHeight), ...P(u1, span / 2, ridgeHeight),
  ];
  const idx = [0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 1, 2, 5, 3, 0, 4];
  return triMesh(verts, idx, mat);
}

function buildRoofGroup(building) {
  const totalWallsHeight = building.floors.reduce((s, f) => s + f.height, 0);
  const profile = roofProfile(building.roof, building.footprint.w, building.footprint.h);
  const mat = roofMaterial3d(building.roof.material, building.roof.color);
  mat.side = THREE.DoubleSide;
  const facadeMat = facadeMaterial3d(building.facade.primary.material, building.facade.primary.color);
  facadeMat.side = THREE.DoubleSide;

  const group = new THREE.Group();
  group.position.y = totalWallsHeight;
  const w = building.footprint.w, h = building.footprint.h;
  const overhang = building.roof.overhang ?? 0.5;
  const ow = w + 2 * overhang, oh = h + 2 * overhang;
  const ox = -overhang, oz = -overhang;
  const axis = profile.ridgeAxis;
  const run = axis === 'x' ? ow : oh;
  const span = axis === 'x' ? oh : ow;
  const runF = axis === 'x' ? w : h;
  const spanF = axis === 'x' ? h : w;

  switch (profile.shape) {
    case 'flat':
      group.add(boxRoof(ow, profile.ridgeHeight, oh, ox, oz, mat));
      break;
    case 'shed':
      group.add(shedRoof(run, span, profile.lowHeight, profile.ridgeHeight, axis, ox, oz, mat));
      break;
    case 'hip':
    case 'halfHip':
      group.add(buildHip(run, span, profile.ridgeHeight, axis, ox, oz, mat, false));
      break;
    case 'pyramid':
      group.add(buildHip(run, span, profile.ridgeHeight, axis, ox, oz, mat, true));
      break;
    case 'gable':
    case 'mansard':
    case 'gambrel':
    default:
      group.add(buildGable(run, span, profile.ridgeHeight, axis, ox, oz, mat));
      group.add(...gableEndWalls(runF, spanF, profile.ridgeHeight, axis, facadeMat));
      break;
  }

  for (const ch of building.roof.chimneys || []) {
    const cm = new THREE.Mesh(new THREE.BoxGeometry(ch.w, ch.height + profile.ridgeHeight * 0.4, ch.h), colorBrick());
    cm.position.set(ch.x, (ch.height + profile.ridgeHeight * 0.4) / 2, ch.y);
    cm.castShadow = true;
    group.add(cm);
  }
  for (const sp of building.roof.solar || []) {
    const sm = new THREE.Mesh(new THREE.BoxGeometry(sp.w, 0.06, sp.h), colorPanel());
    sm.position.set(w / 2, profile.ridgeHeight * 0.6, h / 2);
    group.add(sm);
  }

  // Gauben/Dachfenster: vereinfachte Platzierung anhand von Seite('A'/'B') + Position entlang des Firsts,
  // mit linearer Höhen-Näherung der Dachschräge (bewusste Vereinfachung, kein exaktes CSG).
  const mapF = (u, v) => (axis === 'x' ? [u, v] : [v, u]);
  const slopeY = (v) => {
    if (profile.shape === 'flat') return profile.ridgeHeight;
    const half = spanF / 2;
    return v <= half ? profile.ridgeHeight * (v / half) : profile.ridgeHeight * ((spanF - v) / half);
  };
  for (const dm of building.roof.dormers || []) {
    const u = Math.min(runF - 0.6, Math.max(0.6, dm.offset ?? runF / 2));
    const v = dm.side === 'B' ? spanF * 0.72 : spanF * 0.28;
    const [x, z] = mapF(u, v);
    const y = slopeY(v);
    const dh = dm.height || 1.1, dw = dm.width || 1.2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 1.0), facadeMat);
    box.position.set(x, y + dh * 0.35, z);
    box.castShadow = true;
    group.add(box);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(dw * 1.1, 0.12, 1.1), mat);
    cap.position.set(x, y + dh * 0.7 + 0.06, z);
    group.add(cap);
  }
  for (const sk of building.roof.skylights || []) {
    const u = Math.min(runF - 0.5, Math.max(0.5, sk.offset ?? runF / 2));
    const v = sk.side === 'B' ? spanF * 0.7 : spanF * 0.3;
    const [x, z] = mapF(u, v);
    const y = slopeY(v) + 0.04;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(sk.w || 0.8, 0.05, sk.h || 1.0), genericMaterials.glass);
    glass.position.set(x, y, z);
    group.add(glass);
  }

  return group;
}

function buildAttachments(building) {
  const group = new THREE.Group();
  const groundFloor = building.floors.find((f) => f.level === 0) || building.floors[0];
  const groundHeight = groundFloor ? groundFloor.height : 2.6;
  const mat = facadeMaterial3d(building.facade.primary.material, building.facade.primary.color);
  const w = building.footprint.w, h = building.footprint.h;

  for (const a of building.attachments || []) {
    const aw = a.w || 2, ad = a.d || 1.2;
    const along = { front: [w / 2, h + ad / 2], back: [w / 2, -ad / 2], left: [-ad / 2, h / 2], right: [w + ad / 2, h / 2] }[a.side] || [w / 2, h + ad / 2];
    const [cx, cz] = along;
    const boxW = a.side === 'left' || a.side === 'right' ? ad : aw;
    const boxD = a.side === 'left' || a.side === 'right' ? aw : ad;

    if (a.type === 'bay') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxW, groundHeight, boxD), mat);
      mesh.position.set(cx, groundHeight / 2, cz);
      mesh.castShadow = true;
      group.add(mesh);
    } else if (a.type === 'balcony') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.12, boxD), colorMaterial2('#c9c2b3'));
      slab.position.set(cx, groundHeight, cz);
      group.add(slab);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.9, 0.05), colorMaterial2('#ffffff'));
      rail.position.set(cx, groundHeight + 0.45, cz + (a.side === 'front' ? boxD / 2 : a.side === 'back' ? -boxD / 2 : 0));
      group.add(rail);
    } else if (a.type === 'canopy') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.1, boxD), mat);
      slab.position.set(cx, 2.15, cz);
      group.add(slab);
    } else if (a.type === 'terraceRoof') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.1, boxD), colorMaterial2('#8a8f99'));
      slab.position.set(cx, 2.35, cz);
      group.add(slab);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8), colorMaterial2('#8a8f99'));
        post.position.set(cx + (sx * boxW) / 2.2, 1.15, cz + (sx * boxD) / 2.2);
        group.add(post);
      }
    } else if (a.type === 'stairs') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.4, boxD), colorMaterial2('#b3a99a'));
      mesh.position.set(cx, 0.2, cz);
      group.add(mesh);
    }
  }
  return group;
}

let genericColorCache = new Map();
function colorMaterial2(hex) {
  if (!genericColorCache.has(hex)) genericColorCache.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 }));
  return genericColorCache.get(hex);
}

let brickMat = null;
function colorBrick() { return brickMat || (brickMat = new THREE.MeshStandardMaterial({ color: '#8a4a3a', roughness: 0.9 })); }
let panelMat = null;
function colorPanel() { return panelMat || (panelMat = new THREE.MeshStandardMaterial({ color: '#1c2a3a', roughness: 0.3, metalness: 0.4 })); }

export function buildBuildingGroup(building) {
  const bGroup = new THREE.Group();
  bGroup.userData = { buildingId: building.id, kind: 'building' };

  const inner = new THREE.Group();
  inner.position.set(-building.footprint.w / 2, 0, -building.footprint.h / 2);

  for (const floor of building.floors) {
    const fGroup = new THREE.Group();
    fGroup.userData = { floorId: floor.id, kind: 'floor', level: floor.level };
    fGroup.add(buildFloorSlab(building, floor));
    fGroup.add(buildWallsForFloor(building, floor));
    fGroup.add(buildFurnitureForFloor(building, floor));
    inner.add(fGroup);
  }

  const roofGroup = buildRoofGroup(building);
  roofGroup.userData = { kind: 'roof' };
  inner.add(roofGroup);
  inner.add(buildAttachments(building));

  bGroup.add(inner);
  bGroup.position.set(building.footprint.x + building.footprint.w / 2, 0, building.footprint.y + building.footprint.h / 2);
  bGroup.rotation.y = -((building.rotation || 0) * Math.PI) / 180;
  return bGroup;
}

export function buildHouseGroup(design) {
  const root = new THREE.Group();
  for (const building of design.buildings) root.add(buildBuildingGroup(building));
  return root;
}
