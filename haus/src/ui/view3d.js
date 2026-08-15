import { el, mount } from './dom.js';
import { store } from '../core/state.js';
import { Scene3D } from '../three/scene.js';
import { buildHouseGroup } from '../three/buildHouse.js';
import { buildSiteGroup } from '../three/buildSite.js';
import { sunPosition, sunDirectionVector } from '../core/sun.js';
import * as THREE from 'three';

let scene3d = null;
let refs = null;
let currentMode = 'outer';
let sunHour = 13;

function collectRefs(houseGroup) {
  const map = new Map();
  for (const bGroup of houseGroup.children) {
    const buildingId = bGroup.userData.buildingId;
    const inner = bGroup.children[0];
    const floors = new Map();
    let roof = null;
    for (const child of inner.children) {
      if (child.userData.kind === 'floor') floors.set(child.userData.floorId, child);
      if (child.userData.kind === 'roof') roof = child;
    }
    map.set(buildingId, { floors, roof, bGroup });
  }
  return map;
}

export function renderView3d(container) {
  const design = store.design;
  const building = store.currentBuilding();

  const canvas = el('canvas', { id: 'view3dCanvas' });
  const modesBar = el('div', { class: 'v3-modes' }, [
    modeBtn('outer', 'Außen'),
    modeBtn('dollhouse', 'Puppenhaus'),
    modeBtn('walk', 'Begehen'),
  ]);
  const hint = el('div', { class: 'v3-hint' }, hintText());
  const floorsPanel = el('div', { class: 'v3-floors hidden' });

  const wrap = el('div', { style: { position: 'relative', width: '100%', height: '100%' } }, [canvas, modesBar, floorsPanel, hint]);
  mount(container, [wrap]);

  scene3d = new Scene3D(canvas);
  rebuildScene(design);
  focusOnBuilding(building);
  applyMode(currentMode);
  updateSun();

  function modeBtn(id, label) {
    return el('button', { class: currentMode === id ? 'active' : '', onClick: () => { currentMode = id; setModeUI(); applyMode(id); } }, label);
  }

  function setModeUI() {
    mount(modesBar, [modeBtn('outer', 'Außen'), modeBtn('dollhouse', 'Puppenhaus'), modeBtn('walk', 'Begehen')]);
    hint.textContent = hintText();
    floorsPanel.classList.toggle('hidden', currentMode !== 'dollhouse');
    if (currentMode === 'dollhouse') renderFloorsPanel(floorsPanel, building);
  }

  function applyMode(mode) {
    const ref = refs.get(building.id);
    if (mode === 'outer') {
      scene3d.setMode('orbit');
      if (ref) { ref.roof.visible = true; for (const f of ref.floors.values()) f.visible = true; }
    } else if (mode === 'dollhouse') {
      scene3d.setMode('orbit');
      if (ref) { ref.roof.visible = false; for (const f of ref.floors.values()) f.visible = true; }
    } else if (mode === 'walk') {
      scene3d.setMode('orbit'); // erst orbit, Klick auf die Fläche aktiviert Pointer-Lock
      if (ref) { ref.roof.visible = true; for (const f of ref.floors.values()) f.visible = true; }
      const center = { x: building.footprint.x + building.footprint.w / 2, z: building.footprint.y + 1 };
      scene3d.setMode('walk', center);
    }
    setModeUI();
  }

  setModeUI();

  return () => {
    scene3d?.dispose();
    scene3d = null;
  };
}

function renderFloorsPanel(panel, building) {
  const ref = refs.get(building.id);
  mount(panel, [
    el('label', { class: 'row' }, [
      el('input', { type: 'checkbox', ...(ref.roof.visible ? { checked: true } : {}), onChange: (e) => { ref.roof.visible = e.target.checked; } }),
      'Dach',
    ]),
    ...building.floors.map((f) => el('label', { class: 'row' }, [
      el('input', { type: 'checkbox', ...(ref.floors.get(f.id)?.visible !== false ? { checked: true } : {}), onChange: (e) => { const fg = ref.floors.get(f.id); if (fg) fg.visible = e.target.checked; } }),
      f.name,
    ])),
  ]);
}

function hintText() {
  if (currentMode === 'walk') return 'Klick in die Ansicht zum Steuern · WASD bewegen · Maus umsehen · Shift = schneller · Esc zum Verlassen';
  if (currentMode === 'dollhouse') return 'Dach/Geschosse rechts oben ein-/ausblenden · Ziehen zum Drehen';
  return 'Ziehen zum Drehen · Scrollen zum Zoomen';
}

function rebuildScene(design) {
  const houseGroup = buildHouseGroup(design);
  refs = collectRefs(houseGroup);
  const siteGroup = buildSiteGroup(design);
  const root = new THREE.Group();
  root.add(siteGroup, houseGroup);
  scene3d.setContent(root);
}

function focusOnBuilding(building) {
  const cx = building.footprint.x + building.footprint.w / 2;
  const cz = building.footprint.y + building.footprint.h / 2;
  const size = Math.max(building.footprint.w, building.footprint.h);
  scene3d.orbit.target.set(cx, 1.4, cz);
  scene3d.camera.position.set(cx + size * 1.1, size * 0.9 + 3, cz + size * 1.1);
  scene3d.orbit.update();
}

function updateSun() {
  const { elevationDeg, azimuthDeg } = sunPosition(new Date(), sunHour);
  const dir = sunDirectionVector(Math.max(5, elevationDeg), azimuthDeg, store.design?.plot.north || 0);
  scene3d?.setSunDirection(dir);
}
