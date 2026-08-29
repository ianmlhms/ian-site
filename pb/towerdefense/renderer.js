import { ENEMIES, TOWERS, WORLD, distance, pointOnPath } from "./content.js";
import { towerStats } from "./simulation.js";

const THREE = window.THREE;
const TILE_SIZE = 3;
const GROUND_Y = 0;
const AIR_HEIGHT = 3.2;
const CAMERA_MIN = 27;
const CAMERA_MAX = 72;

function material(colour, options = {}) {
  return new THREE.MeshStandardMaterial({ color: colour, roughness: 0.74, metalness: 0.12, ...options });
}

function mesh(geometry, colour, options = {}) {
  const item = new THREE.Mesh(geometry, material(colour, options));
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function addPart(group, geometry, colour, position, rotation = null) {
  const part = mesh(geometry, colour);
  part.position.set(position.x || 0, position.y || 0, position.z || 0);
  if (rotation) part.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
  group.add(part);
  return part;
}

function towerBase(group, colour, level) {
  addPart(group, new THREE.CylinderGeometry(0.78, 0.94, 0.36, 8), 0x25314a, { y: 0.22 });
  addPart(group, new THREE.CylinderGeometry(0.57, 0.7, 0.5 + level * 0.12, 8), colour, { y: 0.58 });
}

function rapidModel(group, colour, level) {
  towerBase(group, colour, level);
  const barrels = level >= 3 ? [-0.22, 0, 0.22] : level === 2 ? [-0.14, 0.14] : [0];
  barrels.forEach((x) => addPart(group, new THREE.BoxGeometry(0.12, 0.12, 1.25), 0xdff8ff, { x, y: 1.15, z: -0.48 }));
}

function frostModel(group, colour, level) {
  towerBase(group, colour, level);
  const crystals = level + 2;
  Array.from({ length: crystals }, (_, index) => index).forEach((index) => {
    const angle = index / crystals * Math.PI * 2;
    addPart(group, new THREE.ConeGeometry(0.2, 1.4 + level * 0.18, 5), colour,
      { x: Math.cos(angle) * 0.3, y: 1.32, z: Math.sin(angle) * 0.3 },
      { z: Math.cos(angle) * 0.14, x: Math.sin(angle) * 0.14 });
  });
}

function cannonModel(group, colour, level) {
  towerBase(group, colour, level);
  addPart(group, new THREE.SphereGeometry(0.52 + level * 0.06, 10, 8), 0x303b4d, { y: 1.08 });
  addPart(group, new THREE.CylinderGeometry(0.18 + level * 0.025, 0.22, 1.45, 10), colour,
    { y: 1.12, z: -0.68 }, { x: Math.PI / 2 });
}

function sniperModel(group, colour, level) {
  towerBase(group, colour, level);
  addPart(group, new THREE.BoxGeometry(0.32, 0.36, 1.8 + level * 0.18), colour, { y: 1.26, z: -0.63 });
  addPart(group, new THREE.CylinderGeometry(0.17, 0.17, 0.4, 10), 0xffef98, { y: 1.55, z: -0.25 }, { z: Math.PI / 2 });
}

function airModel(group, colour, level) {
  towerBase(group, colour, level);
  const offsets = level >= 3 ? [-0.42, 0, 0.42] : [-0.3, 0.3];
  offsets.forEach((x) => {
    addPart(group, new THREE.CylinderGeometry(0.12, 0.2, 1.15 + level * 0.1, 8), colour,
      { x, y: 1.28, z: -0.15 }, { x: -0.28 });
    addPart(group, new THREE.ConeGeometry(0.15, 0.35, 8), 0xf3e8ff, { x, y: 1.9, z: -0.33 }, { x: -0.28 });
  });
}

function supportModel(group, colour, level) {
  towerBase(group, colour, level);
  addPart(group, new THREE.CylinderGeometry(0.12, 0.18, 1.35 + level * 0.2, 8), 0xd6ffe2, { y: 1.45 });
  Array.from({ length: level + 1 }, (_, index) => index).forEach((index) => {
    addPart(group, new THREE.TorusGeometry(0.38 + index * 0.15, 0.055, 6, 18), colour,
      { y: 1.7 + index * 0.22 }, { x: Math.PI / 2 });
  });
}

function buildTowerModel(tower) {
  const group = new THREE.Group();
  const colour = TOWERS[tower.type].color;
  const builders = { rapid: rapidModel, frost: frostModel, cannon: cannonModel, sniper: sniperModel, air: airModel, support: supportModel };
  builders[tower.type](group, colour, tower.level);
  if (tower.level === 3) {
    const accent = tower.branch === "A" ? 0xff765f : 0x9c82ff;
    addPart(group, new THREE.TorusGeometry(0.88, 0.08, 6, 20), accent, { y: 0.3 }, { x: Math.PI / 2 });
  }
  group.position.set(tower.x - WORLD.width / 2, GROUND_Y, tower.z - WORLD.depth / 2);
  group.userData = { towerId: tower.id, level: tower.level, branch: tower.branch };
  group.traverse((child) => { child.userData.towerId = tower.id; });
  return group;
}

function enemyModel(enemy) {
  const definition = ENEMIES[enemy.type];
  const group = new THREE.Group();
  const scale = enemy.type === "boss" ? 1.45 : enemy.type === "armoured" ? 1.18 : 1;
  const body = enemy.type === "fast"
    ? new THREE.ConeGeometry(0.48, 1.1, 7)
    : new THREE.BoxGeometry(0.85 * scale, 0.85 * scale, 0.85 * scale);
  addPart(group, body, definition.colour, { y: 0.58 * scale });
  if (definition.flying) {
    addPart(group, new THREE.BoxGeometry(2.05, 0.12, 0.52), 0xead5ff, { y: 0.64 });
    addPart(group, new THREE.ConeGeometry(0.28, 0.78, 6), definition.colour, { y: 0.65, z: -0.48 }, { x: Math.PI / 2 });
  }
  if (enemy.type === "armoured" || enemy.type === "boss") {
    addPart(group, new THREE.CylinderGeometry(0.55 * scale, 0.62 * scale, 0.25, 8), 0x4a5868, { y: 1.03 * scale });
  }
  const health = new THREE.Group();
  const back = mesh(new THREE.PlaneGeometry(1.55 * scale, 0.18), 0x351c24, { depthTest: false });
  const fill = mesh(new THREE.PlaneGeometry(1.48 * scale, 0.12), 0x69e58a, { depthTest: false });
  back.renderOrder = 20;
  fill.renderOrder = 21;
  fill.position.z = 0.01;
  health.add(back, fill);
  health.position.y = 1.72 * scale;
  health.userData.fill = fill;
  group.add(health);
  group.userData = { enemyId: enemy.id, health };
  return group;
}

function heroModel() {
  const group = new THREE.Group();
  addPart(group, new THREE.CylinderGeometry(0.42, 0.52, 1.15, 8), 0x306f9f, { y: 0.72 });
  addPart(group, new THREE.SphereGeometry(0.35, 10, 8), 0xf3c99d, { y: 1.5 });
  addPart(group, new THREE.BoxGeometry(0.13, 0.13, 1.25), 0xf6f0d8, { x: 0.55, y: 1.15, z: -0.2 }, { x: -0.3 });
  addPart(group, new THREE.ConeGeometry(0.17, 0.4, 6), 0x6fe2ff, { x: 0.55, y: 1.45, z: -0.8 }, { x: -0.3 });
  const aura = mesh(new THREE.RingGeometry(5.7, 6, 48), 0x66e8ff, { transparent: true, opacity: 0.18, side: THREE.DoubleSide });
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.03;
  aura.castShadow = false;
  group.add(aura);
  return group;
}

function projectileModel(projectile) {
  const item = mesh(new THREE.SphereGeometry(projectile.splash ? 0.22 : 0.13, 7, 5), projectile.colour, { emissive: projectile.colour, emissiveIntensity: 0.7 });
  item.userData.projectileId = projectile.id;
  return item;
}

export class BattlefieldView {
  constructor(canvas, callbacks = {}) {
    if (!THREE) throw new Error("three.js r160 is required");
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x91c8df);
    this.scene.fog = new THREE.Fog(0x91c8df, 55, 105);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 180);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.cameraTarget = new THREE.Vector3(0, 0, 2);
    this.cameraDistance = 50;
    this.levelGroup = new THREE.Group();
    this.unitGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    this.scene.add(this.levelGroup, this.unitGroup, this.effectGroup);
    this.towerMeshes = new Map();
    this.enemyMeshes = new Map();
    this.projectileMeshes = new Map();
    this.effects = [];
    this.currentLevel = 0;
    this.selectedTowerId = null;
    this.pointers = new Map();
    this.dragStart = null;
    this.lastPinch = null;
    this.hero = heroModel();
    this.selection = mesh(new THREE.RingGeometry(0.96, 1, 64), 0xffe481, { transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.position.y = 0.08;
    this.selection.visible = false;
    this.selection.castShadow = false;
    this.unitGroup.add(this.hero, this.selection);
    this.setupLights();
    this.bindControls();
    this.resize();
    document.documentElement.dataset.threeReady = "true";
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xdff5ff, 0x49613e, 1.35));
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.2);
    sun.position.set(-24, 42, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    this.scene.add(sun);
  }

  clearGroup(group) {
    [...group.children].forEach((child) => {
      child.traverse((part) => {
        part.geometry?.dispose?.();
        part.material?.dispose?.();
      });
      group.remove(child);
    });
  }

  buildLevel(state) {
    this.clearGroup(this.levelGroup);
    this.currentLevel = state.level;
    for (let z = 0; z < WORLD.depth; z += TILE_SIZE) {
      for (let x = 0; x < WORLD.width; x += TILE_SIZE) {
        const colour = (x / TILE_SIZE + z / TILE_SIZE) % 2 ? 0x4f8c55 : 0x568f58;
        const tile = mesh(new THREE.BoxGeometry(TILE_SIZE - 0.05, 0.18, TILE_SIZE - 0.05), colour);
        tile.position.set(x + TILE_SIZE / 2 - WORLD.width / 2, -0.12, z + TILE_SIZE / 2 - WORLD.depth / 2);
        tile.userData.ground = true;
        this.levelGroup.add(tile);
      }
    }
    this.buildRoad(state.path);
    state.pads.forEach((pad, index) => this.buildPad(pad, index));
    this.buildGate(state.path[0], false);
    this.buildGate(state.path[state.path.length - 1], true);
  }

  buildRoad(path) {
    path.slice(1).forEach((end, index) => {
      const start = path[index];
      const length = distance(start, end);
      const road = mesh(new THREE.BoxGeometry(3.15, 0.2, length + 0.15), 0xa78e69);
      road.position.set((start.x + end.x) / 2 - WORLD.width / 2, 0.02, (start.z + end.z) / 2 - WORLD.depth / 2);
      road.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
      road.userData.ground = true;
      this.levelGroup.add(road);
    });
    path.forEach((point) => {
      const corner = mesh(new THREE.CylinderGeometry(1.58, 1.58, 0.2, 18), 0xa78e69);
      corner.position.set(point.x - WORLD.width / 2, 0.03, point.z - WORLD.depth / 2);
      corner.userData.ground = true;
      this.levelGroup.add(corner);
    });
  }

  buildPad(pad, padIndex) {
    const group = new THREE.Group();
    const disk = mesh(new THREE.CylinderGeometry(1.12, 1.28, 0.2, 10), 0x39556b);
    const ring = mesh(new THREE.TorusGeometry(0.88, 0.08, 6, 24), 0x75e4ac, { emissive: 0x214f39, emissiveIntensity: 0.5 });
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    group.add(disk, ring);
    group.position.set(pad.x - WORLD.width / 2, 0.02, pad.z - WORLD.depth / 2);
    group.userData.padIndex = padIndex;
    group.traverse((child) => { child.userData.padIndex = padIndex; });
    this.levelGroup.add(group);
  }

  buildGate(point, exit) {
    const group = new THREE.Group();
    const colour = exit ? 0xe85057 : 0x5edb99;
    addPart(group, new THREE.BoxGeometry(0.45, 2.3, 0.45), colour, { x: -1.25, y: 1.15 });
    addPart(group, new THREE.BoxGeometry(0.45, 2.3, 0.45), colour, { x: 1.25, y: 1.15 });
    addPart(group, new THREE.BoxGeometry(2.9, 0.4, 0.45), colour, { y: 2.2 });
    group.position.set(point.x - WORLD.width / 2, 0, point.z - WORLD.depth / 2);
    this.levelGroup.add(group);
  }

  sync(state, selectedTowerId = null) {
    if (state.level !== this.currentLevel) this.buildLevel(state);
    this.selectedTowerId = selectedTowerId;
    this.syncTowers(state);
    this.syncEnemies(state);
    this.syncProjectiles(state);
    this.hero.position.set(state.hero.x - WORLD.width / 2, 0, state.hero.z - WORLD.depth / 2);
    state.events.forEach((event) => this.addEffect(event));
  }

  syncTowers(state) {
    const ids = new Set(state.towers.map((tower) => tower.id));
    [...this.towerMeshes.entries()].filter(([id]) => !ids.has(id)).forEach(([id, model]) => {
      this.unitGroup.remove(model);
      this.towerMeshes.delete(id);
    });
    state.towers.forEach((tower) => {
      const current = this.towerMeshes.get(tower.id);
      if (current && current.userData.level === tower.level && current.userData.branch === tower.branch) return;
      if (current) this.unitGroup.remove(current);
      const model = buildTowerModel(tower);
      this.towerMeshes.set(tower.id, model);
      this.unitGroup.add(model);
    });
    const selected = state.towers.find((tower) => tower.id === this.selectedTowerId);
    this.selection.visible = Boolean(selected);
    if (!selected) return;
    const range = towerStats(selected).range;
    this.selection.scale.set(range, range, range);
    this.selection.position.set(selected.x - WORLD.width / 2, 0.08, selected.z - WORLD.depth / 2);
  }

  syncEnemies(state) {
    const ids = new Set(state.enemies.map((enemy) => enemy.id));
    [...this.enemyMeshes.entries()].filter(([id]) => !ids.has(id)).forEach(([id, model]) => {
      this.unitGroup.remove(model);
      this.enemyMeshes.delete(id);
    });
    state.enemies.forEach((enemy) => {
      const model = this.enemyMeshes.get(enemy.id) || enemyModel(enemy);
      if (!this.enemyMeshes.has(enemy.id)) {
        this.enemyMeshes.set(enemy.id, model);
        this.unitGroup.add(model);
      }
      const point = pointOnPath(state.path, enemy.along);
      const flying = Boolean(ENEMIES[enemy.type].flying);
      model.position.set(point.x - WORLD.width / 2, flying ? AIR_HEIGHT + Math.sin(state.time * 5 + enemy.id) * 0.24 : 0, point.z - WORLD.depth / 2);
      model.userData.health.quaternion.copy(this.camera.quaternion);
      model.userData.health.userData.fill.scale.x = Math.max(0.001, enemy.hp / enemy.maxHp);
      model.userData.health.userData.fill.position.x = -(1 - model.userData.health.userData.fill.scale.x) * 0.74;
    });
  }

  syncProjectiles(state) {
    const ids = new Set(state.projectiles.map((projectile) => projectile.id));
    [...this.projectileMeshes.entries()].filter(([id]) => !ids.has(id)).forEach(([id, model]) => {
      this.unitGroup.remove(model);
      this.projectileMeshes.delete(id);
    });
    state.projectiles.forEach((projectile) => {
      const model = this.projectileMeshes.get(projectile.id) || projectileModel(projectile);
      if (!this.projectileMeshes.has(projectile.id)) {
        this.projectileMeshes.set(projectile.id, model);
        this.unitGroup.add(model);
      }
      const target = state.enemies.find((enemy) => enemy.id === projectile.targetId);
      const height = target && ENEMIES[target.type].flying ? AIR_HEIGHT + 0.5 : 1;
      model.position.set(projectile.x - WORLD.width / 2, height, projectile.z - WORLD.depth / 2);
    });
  }

  addEffect(event) {
    if (!["impact", "meteor", "freeze", "rally", "heroStrike"].includes(event.type)) return;
    const radius = event.radius || event.splash || (event.type === "freeze" ? 18 : 2);
    const colour = event.type === "meteor" ? 0xff6b43 : event.type === "freeze" ? 0x72eaff : event.type === "rally" ? 0xffd966 : event.colour || 0xffffff;
    const ring = mesh(new THREE.RingGeometry(Math.max(0.2, radius * 0.55), radius, 32), colour, { transparent: true, opacity: 0.62, side: THREE.DoubleSide });
    ring.rotation.x = -Math.PI / 2;
    ring.position.set((event.x ?? 18) - WORLD.width / 2, 0.14, (event.z ?? 27) - WORLD.depth / 2);
    ring.castShadow = false;
    this.effectGroup.add(ring);
    this.effects = [...this.effects, { mesh: ring, life: 0.6, total: 0.6 }];
  }

  updateEffects(dt) {
    this.effects = this.effects.map((effect) => {
      const life = effect.life - dt;
      effect.mesh.material.opacity = Math.max(0, life / effect.total) * 0.62;
      effect.mesh.scale.multiplyScalar(1 + dt * 1.8);
      return { ...effect, life };
    }).filter((effect) => {
      if (effect.life > 0) return true;
      this.effectGroup.remove(effect.mesh);
      return false;
    });
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    this.cameraTarget.x = Math.max(-13, Math.min(13, this.cameraTarget.x));
    this.cameraTarget.z = Math.max(-21, Math.min(21, this.cameraTarget.z));
    this.camera.position.set(this.cameraTarget.x, this.cameraDistance * 0.76, this.cameraTarget.z + this.cameraDistance * 0.64);
    this.camera.lookAt(this.cameraTarget);
  }

  render(dt) {
    this.updateEffects(dt);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  raycast(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.unitGroup, this.levelGroup], true);
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(ground, point);
    return { hit: hits[0]?.object || null, point: { x: point.x + WORLD.width / 2, z: point.z + WORLD.depth / 2 } };
  }

  bindControls() {
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.cameraDistance = Math.max(CAMERA_MIN, Math.min(CAMERA_MAX, this.cameraDistance + event.deltaY * 0.035));
    }, { passive: false });
    this.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));
  }

  pointerDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dragStart = { x: event.clientX, y: event.clientY, targetX: this.cameraTarget.x, targetZ: this.cameraTarget.z };
    if (this.pointers.size === 2) this.lastPinch = this.pinchDistance();
  }

  pinchDistance() {
    const points = [...this.pointers.values()];
    return points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  }

  pointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const pinch = this.pinchDistance();
      if (this.lastPinch) this.cameraDistance = Math.max(CAMERA_MIN, Math.min(CAMERA_MAX, this.cameraDistance - (pinch - this.lastPinch) * 0.12));
      this.lastPinch = pinch;
      return;
    }
    if (!this.dragStart) return;
    const dx = event.clientX - this.dragStart.x;
    const dy = event.clientY - this.dragStart.y;
    if (Math.hypot(dx, dy) < 5) return;
    const factor = this.cameraDistance / Math.max(320, this.canvas.clientHeight) * 0.55;
    this.cameraTarget.x = this.dragStart.targetX - dx * factor;
    this.cameraTarget.z = this.dragStart.targetZ - dy * factor;
  }

  pointerUp(event) {
    const start = this.dragStart;
    const moved = start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) : Infinity;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.lastPinch = null;
    if (moved < 8) this.handleTap(event.clientX, event.clientY);
    this.dragStart = null;
  }

  handleTap(clientX, clientY) {
    const result = this.raycast(clientX, clientY);
    let object = result.hit;
    while (object && object !== this.scene) {
      if (Number.isFinite(object.userData.towerId)) return this.callbacks.onTower?.(object.userData.towerId);
      if (Number.isFinite(object.userData.padIndex)) return this.callbacks.onPad?.(object.userData.padIndex, result.point);
      object = object.parent;
    }
    this.callbacks.onGround?.(result.point);
  }
}
