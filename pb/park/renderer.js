import { TILE, PHASE, RULES } from "/pb/park/data.js";
import { GRID, GATE, KINDS, isOwned, footprint } from "/pb/park/build.js";

const THREE = window.THREE;
const GUEST_CAPACITY = 256;
const MIN_VIEW = 7;
const MAX_VIEW = 30;
const DEFAULT_VIEW = 12.5;
const FRAME_MARGIN = 2.25;
const EMPTY_PARK_DEPTH = 8;
const BUILDER_CAMERA_OFFSET = Object.freeze({ x: 24, y: 32, z: 28 });
const DRAG_THRESHOLD = 7;
const WALK_EYE_HEIGHT = 1.45;
const WALK_FIELD_OF_VIEW = 68;
const WALK_SPEED = 4.2;
const WALK_RADIUS = 0.22;
const WALK_STEP = 0.12;
const WALK_LOOK_SPEED = 0.004;
const WALK_PITCH_LIMIT = Math.PI * 0.42;
const WALK_PAD_RADIUS = 38;
const RIDE_COLORS = [0xf26f91, 0x9c7ef0, 0x4cbaca, 0xffb953, 0x638af1, 0xec7360];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class ParkRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks ?? {};
    this.engine = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.engine.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.engine.setClearColor(0xb8dcdf);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb8dcdf);
    this.scene.fog = new THREE.Fog(0xb8dcdf, 34, 105);
    this.builderCamera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 180);
    this.walkCamera = new THREE.PerspectiveCamera(WALK_FIELD_OF_VIEW, 1, 0.05, 140);
    this.walkCamera.rotation.order = "YXZ";
    this.camera = this.builderCamera;
    this.target = new THREE.Vector3(RULES.gateX + 0.5, 0, EMPTY_PARK_DEPTH / 2);
    this.view = DEFAULT_VIEW;
    this.isWalkMode = false;
    this.walkYaw = 0;
    this.walkPitch = 0;
    this.walkKeys = new Set();
    this.walkStick = { x: 0, y: 0, pointerId: null };
    this.walkLookPointer = null;
    this.state = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.panStart = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    this.cone = new THREE.ConeGeometry(0.5, 1, 10);
    this.torus = new THREE.TorusGeometry(0.5, 0.055, 7, 18);
    this.materials = new Map();
    this.objects = new Map();
    this.pointers = new Map();
    this.guestKeys = new Map();
    this.guestFrom = new Float32Array(GUEST_CAPACITY * 2);
    this.guestTo = new Float32Array(GUEST_CAPACITY * 2);
    this.guestCurrent = new Float32Array(GUEST_CAPACITY * 2);
    this.nextKeys = new Map();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x647e59, 2.3));
    const sun = new THREE.DirectionalLight(0xffefd4, 2.1);
    sun.position.set(-15, 40, 20);
    this.scene.add(sun);
    this.createTerrain();
    this.createMarkers();
    this.bindControls();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  material(color) {
    if (!this.materials.has(color)) this.materials.set(color,
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
    return this.materials.get(color);
  }

  part(parent, geometry, color, x, y, z, width, height, depth) {
    const mesh = new THREE.Mesh(geometry, this.material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    parent.add(mesh);
    return mesh;
  }

  createTerrain() {
    // The larger base keeps the horizon grounded without adding another scene or skybox.
    this.part(this.scene, this.box, 0x64836d, 20, -0.42, 20, 150, 0.7, 150);
    this.land = new THREE.InstancedMesh(this.box, this.material(0xffffff), 16);
    this.scene.add(this.land);
    this.paths = new THREE.InstancedMesh(this.box, this.material(0xf1dfb6), GRID.width * GRID.height);
    this.paths.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.paths);
    const grid = new THREE.GridHelper(40, 40, 0x689373, 0x83aa7c);
    grid.position.set(20, 0.014, 20);
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    this.scene.add(grid);
    const gateX = GATE % GRID.width + 0.5;
    this.part(this.scene, this.box, 0x285e69, gateX - 0.65, 0.85, 0.2, 0.15, 1.7, 0.2);
    this.part(this.scene, this.box, 0x285e69, gateX + 0.65, 0.85, 0.2, 0.15, 1.7, 0.2);
    this.part(this.scene, this.box, 0xffcf70, gateX, 1.6, 0.2, 1.5, 0.4, 0.3);
  }

  createMarkers() {
    this.guests = new THREE.InstancedMesh(this.cylinder, this.material(0xffffff), GUEST_CAPACITY);
    this.guests.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.guests.count = 0;
    this.guests.frustumCulled = false;
    this.scene.add(this.guests);
    this.ghost = new THREE.Mesh(this.box, new THREE.MeshBasicMaterial({
      color: 0x41eba0, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.entry = new THREE.Mesh(this.cylinder, this.material(0xffffff));
    this.entry.scale.set(0.4, 0.08, 0.4);
    this.entry.visible = false;
    this.scene.add(this.entry);
    this.selection = new THREE.BoxHelper(new THREE.Mesh(this.box), 0xffe58c);
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.guestColor = new THREE.Color();
  }

  createWheel(group, moving, color, width) {
    const radius = Math.max(1.45, width * 0.58);
    for (const side of [-0.34, 0.34]) {
      const support = this.part(group, this.box, 0xf7efe0, side * 0.8, 1.35, 0, 0.16, 2.7, 0.16);
      support.rotation.z = side * -0.34;
    }
    const wheel = new THREE.Group();
    wheel.position.y = radius + 0.72;
    moving.add(wheel);
    this.part(wheel, this.torus, color, 0, 0, 0, radius * 2, radius * 2, radius * 2);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const spoke = this.part(wheel, this.box, 0xffe4a1, 0, 0, 0, radius * 1.9, 0.07, 0.07);
      spoke.rotation.z = angle;
      this.part(wheel, this.box, i % 2 ? 0xffffff : color,
        Math.cos(angle) * radius, Math.sin(angle) * radius, 0, 0.36, 0.3, 0.42);
    }
  }

  createCarousel(group, moving, color, width, depth) {
    this.part(group, this.cylinder, 0xf7efe0, 0, 1.15, 0, 0.16, 2.25, 0.16);
    this.part(moving, this.cylinder, color, 0, 0.36, 0, width * 0.9, 0.28, depth * 0.9);
    this.part(moving, this.cone, color, 0, 2.05, 0, width * 0.98, 0.8, depth * 0.98);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      this.part(moving, this.cylinder, 0xffefca, Math.cos(angle) * width * 0.3,
        1.05, Math.sin(angle) * depth * 0.3, 0.06, 1.25, 0.06);
      this.part(moving, this.box, i % 2 ? 0xffffff : 0xffd477,
        Math.cos(angle) * width * 0.3, 0.72, Math.sin(angle) * depth * 0.3, 0.42, 0.3, 0.2);
    }
  }

  createTowerRide(group, moving, kind, color, width, depth) {
    const isDropTower = kind.id === "drop-tower";
    const height = isDropTower ? 6.3 : 4.5;
    this.part(group, this.cylinder, 0xf7efe0, 0, height / 2, 0, 0.24, height, 0.24);
    this.part(group, this.cone, color, 0, height + 0.38, 0, 0.65, 0.75, 0.65);
    if (isDropTower) {
      this.part(moving, this.cylinder, color, 0, 3.7, 0, width * 0.8, 0.38, depth * 0.65);
      return;
    }
    for (let level = 0; level < 4; level++) {
      const ramp = this.part(group, this.torus, level % 2 ? 0xffe4a1 : color,
        0, 0.85 + level * 0.85, 0, width * 0.72, width * 0.72, width * 0.72);
      ramp.rotation.x = Math.PI / 2;
    }
    this.part(group, this.cone, color, 0, height, 0, width * 0.9, 0.95, depth * 0.9);
  }

  createCanopyRide(group, moving, kind, color, width, depth) {
    const isSwing = kind.id === "swing";
    const mastHeight = isSwing ? 4.2 : 1.7;
    this.part(group, this.cylinder, 0xf7efe0, 0, mastHeight / 2, 0, 0.18, mastHeight, 0.18);
    this.part(moving, this.cylinder, color, 0, isSwing ? 3.55 : 0.35, 0,
      width * 0.9, 0.25, depth * 0.9);
    this.part(moving, this.cone, color, 0, isSwing ? 4.15 : 1.9, 0,
      width * 0.94, 0.72, depth * 0.94);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const radius = width * 0.31;
      const seatY = isSwing ? 2.65 : 0.8;
      if (isSwing) this.part(moving, this.cylinder, 0xffefca,
        Math.cos(angle) * radius, 3.18, Math.sin(angle) * radius, 0.035, 1.05, 0.035);
      this.part(moving, this.box, i % 2 ? 0xffffff : 0xffd477,
        Math.cos(angle) * radius, seatY, Math.sin(angle) * radius, 0.38, 0.32, 0.38);
    }
  }

  createTrackRide(group, moving, kind, color, width, depth) {
    const isShip = kind.id === "pirate-ship";
    if (isShip) {
      for (const side of [-1, 1]) {
        const support = this.part(group, this.box, 0xf7efe0, side * width * 0.32, 1.35, 0, 0.18, 2.8, 0.18);
        support.rotation.z = side * -0.42;
      }
      const hull = this.part(moving, this.box, color, 0, 1.15, 0, width * 0.78, 0.55, depth * 0.62);
      hull.rotation.z = 0.08;
      this.part(moving, this.cylinder, 0xffefca, 0, 2.15, 0, 0.08, 2.5, 0.08);
      return;
    }
    const railHeight = kind.id.includes("coaster") ? 2.8 : kind.id === "log-flume" ? 1.55 : 0.65;
    for (const x of [-width * 0.34, width * 0.34]) {
      for (const z of [-depth * 0.3, depth * 0.3]) {
        this.part(group, this.box, 0xf7efe0, x, railHeight / 2, z, 0.12, railHeight, 0.12);
      }
    }
    for (const z of [-depth * 0.32, depth * 0.32]) {
      this.part(group, this.box, color, 0, railHeight, z, width * 0.86, 0.16, 0.16);
    }
    this.part(group, this.box, color, -width * 0.38, railHeight * 0.72, 0, 0.16, railHeight * 0.58, depth * 0.72);
    this.part(moving, this.box, 0xffd477, 0, railHeight + 0.22, -depth * 0.3,
      Math.min(1.35, width * 0.42), 0.34, 0.42);
  }

  createEnclosedRide(group, moving, kind, color, width, depth) {
    const isDodgems = kind.id === "dodgems";
    this.part(group, this.box, isDodgems ? 0xf1dfb6 : 0x4a4860, 0, 1.25, 0,
      width * 0.9, 2.3, depth * 0.9);
    this.part(group, this.cone, color, 0, 2.75, 0, width, 0.72, depth);
    if (isDodgems) {
      for (const x of [-0.65, 0.65]) this.part(moving, this.box, x < 0 ? 0x63cbd5 : 0xffd477,
        x, 0.35, 0, 0.62, 0.3, 0.82);
    } else {
      this.part(group, this.box, 0x241f35, 0, 1.05, depth * 0.46, width * 0.45, 1.15, 0.08);
    }
  }

  createRide(group, moving, kind, color, width, depth) {
    if (kind.id === "wheel") { this.createWheel(group, moving, color, width); return; }
    if (kind.id === "carousel") { this.createCarousel(group, moving, color, width, depth); return; }
    if (["slide", "drop-tower"].includes(kind.id)) {
      this.createTowerRide(group, moving, kind, color, width, depth); return;
    }
    if (["teacups", "swing"].includes(kind.id)) {
      this.createCanopyRide(group, moving, kind, color, width, depth); return;
    }
    if (["dodgems", "ghost-train"].includes(kind.id)) {
      this.createEnclosedRide(group, moving, kind, color, width, depth); return;
    }
    this.createTrackRide(group, moving, kind, color, width, depth);
  }

  createObject(object) {
    const kind = KINDS[object.k];
    const [w, d] = kind.footprint;
    const group = new THREE.Group();
    const color = kind.type === "ride" ? RIDE_COLORS[object.k % RIDE_COLORS.length]
      : kind.type === "stall" ? 0xe99859 : kind.type === "facility" ? 0xa7bac5 : 0x41966d;
    this.part(group, this.box, 0xe9d6af, 0, 0.12, 0, w - 0.1, 0.2, d - 0.1);
    const moving = new THREE.Group();
    group.add(moving);
    if (kind.type === "ride") {
      this.createRide(group, moving, kind, color, w, d);
    } else if (kind.type === "scenery") {
      const low = kind.id === "flowers" || kind.id === "fountain";
      this.part(group, this.cylinder, low ? 0x63cbd5 : 0x916b47, 0, 0.5, 0, low ? w * 0.8 : 0.2, low ? 0.4 : 0.9, low ? d * 0.8 : 0.2);
      this.part(group, this.cone, kind.id === "flowers" ? 0xef8ba0 : color,
        0, low ? 0.65 : 1.35, 0, w * 0.8, low ? 0.35 : 1.45, d * 0.8);
    } else {
      this.part(group, this.box, color, 0, 0.8, 0, w * 0.82, 1.35, d * 0.82);
      this.part(group, this.cone, kind.type === "stall" ? 0xffd585 : 0xe7eef0,
        0, 1.75, 0, w, 0.62, d);
      this.part(group, this.box, 0x355568, 0, 0.92, d * 0.42, w * 0.5, 0.45, 0.04);
    }
    const warning = new THREE.Group();
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const bar = this.part(warning, this.box, 0xff243f, 0, 2.6, 0, 1.3, 0.24, 0.24);
      bar.rotation.z = angle;
    }
    group.add(warning);
    const shape = footprint(kind, object.p % GRID.width, Math.floor(object.p / GRID.width), object.r);
    group.position.set(object.p % GRID.width + shape.width / 2, 0, Math.floor(object.p / GRID.width) + shape.height / 2);
    group.rotation.y = -object.r * Math.PI / 2;
    const ex = shape.entrance % GRID.width + 0.5 - group.position.x;
    const ez = Math.floor(shape.entrance / GRID.width) + 0.5 - group.position.z;
    const angle = object.r * Math.PI / 2;
    this.part(group, this.cylinder, 0xffffff, Math.cos(angle) * ex + Math.sin(angle) * ez,
      0.27, -Math.sin(angle) * ex + Math.cos(angle) * ez, 0.38, 0.1, 0.38);
    this.scene.add(group);
    return { group, moving, warning, signature: `${object.k}:${object.p}:${object.r}`, broken: false, active: false, wheel: kind.id === "wheel" };
  }

  sync(state) {
    this.state = state;
    const { saved, derived } = state;
    if (this.landMask !== saved.l) {
      for (let i = 0; i < 16; i++) {
        const x = i % 4 * RULES.parcelSize;
        const y = Math.floor(i / 4) * RULES.parcelSize;
        this.dummy.position.set(x + 5, -0.055, y + 5);
        this.dummy.scale.set(9.94, 0.1, 9.94);
        this.dummy.updateMatrix();
        this.land.setMatrixAt(i, this.dummy.matrix);
        this.land.setColorAt(i, this.guestColor.setHex(isOwned(saved, x, y) ? 0xa2c988 : 0x6d937c));
      }
      this.land.instanceMatrix.needsUpdate = true;
      this.land.instanceColor.needsUpdate = true;
      this.landMask = saved.l;
    }
    if (this.grid !== saved.g) {
      let count = 0;
      for (let p = 0; p < saved.g.length; p++) {
        if (saved.g[p] !== TILE.PATH) continue;
        this.dummy.position.set(p % GRID.width + 0.5, 0.055, Math.floor(p / GRID.width) + 0.5);
        this.dummy.scale.set(0.96, 0.1, 0.96);
        this.dummy.updateMatrix();
        this.paths.setMatrixAt(count++, this.dummy.matrix);
      }
      this.paths.count = count;
      this.paths.instanceMatrix.needsUpdate = true;
      this.paths.computeBoundingSphere();
      this.grid = saved.g;
    }
    for (const [id, item] of this.objects) {
      const object = derived.objects[id];
      if (object && item.signature === `${object.k}:${object.p}:${object.r}`) continue;
      this.scene.remove(item.group);
      this.objects.delete(id);
    }
    for (const object of derived.objects) {
      if (!object) continue;
      if (!this.objects.has(object.id)) this.objects.set(object.id, this.createObject(object));
      const item = this.objects.get(object.id);
      if (item.broken !== (object.b > 0)) item.moving.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.userData.originalMaterial ??= mesh.material;
        mesh.material = object.b ? this.material(0x7c434c) : mesh.userData.originalMaterial;
      });
      item.broken = object.b > 0;
      item.active = object.t > 0;
      item.warning.visible = item.broken;
    }
    this.syncGuests(state);
  }

  syncGuests(state) {
    this.nextKeys.clear();
    this.guests.count = Math.min(GUEST_CAPACITY, state.derived.guests.length);
    for (let i = 0; i < this.guests.count; i++) {
      const guest = state.derived.guests[i];
      const key = state.saved.t - guest.age;
      const old = this.guestKeys.get(key);
      const x = guest.p % GRID.width + 0.3 + i % 3 * 0.18;
      const z = Math.floor(guest.p / GRID.width) + 0.3 + Math.floor(i / 3) % 3 * 0.18;
      const nearby = old !== undefined && Math.abs(this.guestCurrent[old * 2] - x)
        + Math.abs(this.guestCurrent[old * 2 + 1] - z) < 2.5;
      this.guestFrom[i * 2] = nearby ? this.guestCurrent[old * 2] : x;
      this.guestFrom[i * 2 + 1] = nearby ? this.guestCurrent[old * 2 + 1] : z;
      this.guestTo[i * 2] = x;
      this.guestTo[i * 2 + 1] = z;
      this.nextKeys.set(key, i);
      this.guests.setColorAt(i, this.guestColor.setHex(guest.phase === PHASE.LEAVE ? 0x697282
        : guest.phase === PHASE.QUEUE ? 0xf4b842 : guest.phase === PHASE.USE ? 0xa57bf3 : 0x295d87));
    }
    const oldKeys = this.guestKeys;
    this.guestKeys = this.nextKeys;
    this.nextKeys = oldKeys;
    if (this.guests.instanceColor) this.guests.instanceColor.needsUpdate = true;
  }

  preview(preview) {
    this.ghost.visible = Boolean(preview);
    this.entry.visible = Boolean(preview?.entrance !== undefined);
    if (!preview) return;
    this.ghost.position.set(preview.x + preview.width / 2, 0.22, preview.y + preview.height / 2);
    this.ghost.scale.set(preview.width - 0.08, 0.4, preview.height - 0.08);
    this.ghost.material.color.setHex(preview.ok ? 0x33e797 : 0xff3856);
    if (this.entry.visible) this.entry.position.set(preview.entrance % GRID.width + 0.5, 0.47, Math.floor(preview.entrance / GRID.width) + 0.5);
  }

  select(id) {
    const item = this.objects.get(id);
    this.selection.visible = Boolean(item);
    if (item) this.selection.setFromObject(item.group);
  }

  resize() {
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    this.engine.setSize(this.width, this.height, false);
    this.walkCamera.aspect = this.width / this.height;
    this.walkCamera.updateProjectionMatrix();
    this.updateCamera();
  }

  updateCamera() {
    this.target.x = clamp(this.target.x, 0, GRID.width);
    this.target.z = clamp(this.target.z, 0, GRID.height);
    const half = this.view / 2;
    const aspect = this.width / this.height;
    this.builderCamera.left = -half * aspect;
    this.builderCamera.right = half * aspect;
    this.builderCamera.top = half;
    this.builderCamera.bottom = -half;
    this.builderCamera.position.set(this.target.x + BUILDER_CAMERA_OFFSET.x,
      BUILDER_CAMERA_OFFSET.y, this.target.z + BUILDER_CAMERA_OFFSET.z);
    this.builderCamera.lookAt(this.target);
    this.builderCamera.updateProjectionMatrix();
    this.builderCamera.updateMatrixWorld();
  }

  frameState(state) {
    if (!state?.saved) return;
    const gateX = GATE % GRID.width;
    const gateY = Math.floor(GATE / GRID.width);
    let minX = gateX;
    let maxX = gateX + 1;
    let minZ = gateY;
    let maxZ = gateY + 1;
    let hasBuiltContent = false;
    for (let p = 0; p < state.saved.g.length; p++) {
      if (state.saved.g[p] !== TILE.PATH || p === GATE) continue;
      const x = p % GRID.width;
      const z = Math.floor(p / GRID.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + 1);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z + 1);
      hasBuiltContent = true;
    }
    for (const object of state.derived.objects) {
      if (!object) continue;
      const x = object.p % GRID.width;
      const z = Math.floor(object.p / GRID.width);
      const shape = footprint(KINDS[object.k], x, z, object.r);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + shape.width);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z + shape.height);
      hasBuiltContent = true;
    }
    if (!hasBuiltContent) {
      minX = gateX - EMPTY_PARK_DEPTH / 2;
      maxX = gateX + 1 + EMPTY_PARK_DEPTH / 2;
      maxZ = gateY + EMPTY_PARK_DEPTH;
    }
    this.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.view = DEFAULT_VIEW;
    this.updateCamera();
    const right = new THREE.Vector3().setFromMatrixColumn(this.builderCamera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.builderCamera.matrixWorld, 1);
    const corners = [[minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ]];
    const horizontal = corners.map(([x, z]) => new THREE.Vector3(x - this.target.x, 0, z - this.target.z).dot(right));
    const vertical = corners.map(([x, z]) => new THREE.Vector3(x - this.target.x, 0, z - this.target.z).dot(up));
    const horizontalSpan = Math.max(...horizontal) - Math.min(...horizontal) + FRAME_MARGIN * 2;
    const verticalSpan = Math.max(...vertical) - Math.min(...vertical) + FRAME_MARGIN * 2;
    this.view = clamp(Math.max(DEFAULT_VIEW, verticalSpan, horizontalSpan / (this.width / this.height)), MIN_VIEW, MAX_VIEW);
    this.updateCamera();
  }

  findWalkStart(state) {
    const originX = GATE % GRID.width + 0.5;
    const originZ = Math.floor(GATE / GRID.width) + 1.5;
    if (this.canWalkAt(originX, originZ, state)) return { x: originX, z: originZ };
    const maxRadius = Math.max(GRID.width, GRID.height);
    for (let radius = 1; radius < maxRadius; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = originX + dx;
          const z = originZ + dz;
          if (this.canWalkAt(x, z, state)) return { x, z };
        }
      }
    }
    return { x: originX, z: originZ };
  }

  setWalkMode(isActive, state = this.state) {
    if (this.isWalkMode === isActive) return;
    if (this.walkLookPointer && this.canvas.hasPointerCapture?.(this.walkLookPointer.id)) {
      this.canvas.releasePointerCapture(this.walkLookPointer.id);
    }
    this.isWalkMode = isActive;
    this.walkKeys.clear();
    this.resetWalkStick();
    this.walkLookPointer = null;
    this.pointers.clear();
    if (isActive) {
      const start = this.findWalkStart(state);
      this.walkCamera.position.set(start.x, WALK_EYE_HEIGHT, start.z);
      this.walkYaw = 0;
      this.walkPitch = 0;
      this.updateWalkCamera();
      this.camera = this.walkCamera;
    } else {
      this.camera = this.builderCamera;
      this.updateCamera();
    }
  }

  updateWalkCamera() {
    this.walkCamera.rotation.set(this.walkPitch, Math.PI + this.walkYaw, 0);
    this.walkCamera.updateMatrixWorld();
  }

  canWalkAt(x, z, state = this.state) {
    if (!state?.saved) return false;
    const samples = [[0, 0], [WALK_RADIUS, 0], [-WALK_RADIUS, 0], [0, WALK_RADIUS], [0, -WALK_RADIUS]];
    return samples.every(([dx, dz]) => {
      const tileX = Math.floor(x + dx);
      const tileZ = Math.floor(z + dz);
      if (!isOwned(state.saved, tileX, tileZ)) return false;
      return state.saved.g[tileZ * GRID.width + tileX] !== TILE.OCCUPIED;
    });
  }

  moveWalker(deltaX, deltaZ) {
    const distance = Math.hypot(deltaX, deltaZ);
    const steps = Math.max(1, Math.ceil(distance / WALK_STEP));
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;
    for (let step = 0; step < steps; step++) {
      const nextX = this.walkCamera.position.x + stepX;
      if (this.canWalkAt(nextX, this.walkCamera.position.z)) this.walkCamera.position.x = nextX;
      const nextZ = this.walkCamera.position.z + stepZ;
      if (this.canWalkAt(this.walkCamera.position.x, nextZ)) this.walkCamera.position.z = nextZ;
    }
  }

  updateWalker(delta) {
    if (!this.isWalkMode || delta <= 0) return;
    const forward = Number(this.walkKeys.has("KeyW") || this.walkKeys.has("ArrowUp"))
      - Number(this.walkKeys.has("KeyS") || this.walkKeys.has("ArrowDown")) + this.walkStick.y;
    const strafe = Number(this.walkKeys.has("KeyD") || this.walkKeys.has("ArrowRight"))
      - Number(this.walkKeys.has("KeyA") || this.walkKeys.has("ArrowLeft")) + this.walkStick.x;
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude <= 0) return;
    const normalizedForward = forward / Math.max(1, magnitude);
    const normalizedStrafe = strafe / Math.max(1, magnitude);
    const sin = Math.sin(this.walkYaw);
    const cos = Math.cos(this.walkYaw);
    const distance = WALK_SPEED * delta;
    this.moveWalker((sin * normalizedForward + cos * normalizedStrafe) * distance,
      (cos * normalizedForward - sin * normalizedStrafe) * distance);
    this.updateWalkCamera();
  }

  groundPoint(clientX, clientY, output) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, output);
  }

  pick(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    if (!this.groundPoint(clientX, clientY, this.hit)) return null;
    return { x: Math.floor(this.hit.x), y: Math.floor(this.hit.z) };
  }

  bindControls() {
    this.canvas.addEventListener("wheel", event => {
      if (this.isWalkMode) return;
      event.preventDefault();
      this.view = clamp(this.view * Math.exp(clamp(event.deltaY, -100, 100) * 0.002), MIN_VIEW, MAX_VIEW);
      this.updateCamera();
    }, { passive: false });
    this.canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      this.canvas.setPointerCapture(event.pointerId);
      if (this.isWalkMode) {
        this.walkLookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        return;
      }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
      if (this.pointers.size === 1) this.dragged = false;
      else this.dragged = true;
    });
    this.canvas.addEventListener("pointermove", event => this.pointerMove(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.canvas.addEventListener(type, event => {
        if (this.walkLookPointer?.id === event.pointerId) {
          this.walkLookPointer = null;
          return;
        }
        const point = this.pointers.get(event.pointerId);
        if (!point) return;
        this.pointers.delete(event.pointerId);
        const tap = Math.hypot(event.clientX - point.startX, event.clientY - point.startY) < DRAG_THRESHOLD;
        if (type === "pointerup" && !this.dragged && tap) this.callbacks.onTap?.(this.pick(event.clientX, event.clientY));
      });
    }
    window.addEventListener("keydown", event => {
      if (!this.isWalkMode) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.callbacks.onExitWalk?.();
        return;
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        this.walkKeys.add(event.code);
      }
    });
    window.addEventListener("keyup", event => this.walkKeys.delete(event.code));
    window.addEventListener("blur", () => this.walkKeys.clear());
    this.bindWalkPad();
  }

  bindWalkPad() {
    const pad = document.getElementById("walkPad");
    if (!pad) return;
    const update = event => {
      const rect = pad.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const scale = Math.min(1, WALK_PAD_RADIUS / Math.max(WALK_PAD_RADIUS, Math.hypot(dx, dy)));
      const knobX = dx * scale;
      const knobY = dy * scale;
      this.walkStick.x = knobX / WALK_PAD_RADIUS;
      this.walkStick.y = -knobY / WALK_PAD_RADIUS;
      const knob = document.getElementById("walkKnob");
      if (knob) knob.style.transform = `translate(${knobX}px, ${knobY}px)`;
    };
    pad.addEventListener("pointerdown", event => {
      if (!this.isWalkMode || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pad.setPointerCapture(event.pointerId);
      this.walkStick.pointerId = event.pointerId;
      update(event);
    });
    pad.addEventListener("pointermove", event => {
      if (this.walkStick.pointerId !== event.pointerId) return;
      event.preventDefault();
      update(event);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      pad.addEventListener(type, event => {
        if (this.walkStick.pointerId !== event.pointerId) return;
        this.resetWalkStick();
      });
    }
  }

  resetWalkStick() {
    this.walkStick.x = 0;
    this.walkStick.y = 0;
    this.walkStick.pointerId = null;
    const knob = document.getElementById("walkKnob");
    if (knob) knob.style.transform = "translate(0, 0)";
  }

  pointerMove(event) {
    if (this.isWalkMode) {
      if (!this.walkLookPointer || this.walkLookPointer.id !== event.pointerId) return;
      const deltaX = event.clientX - this.walkLookPointer.x;
      const deltaY = event.clientY - this.walkLookPointer.y;
      this.walkLookPointer.x = event.clientX;
      this.walkLookPointer.y = event.clientY;
      this.walkYaw += deltaX * WALK_LOOK_SPEED;
      this.walkPitch = clamp(this.walkPitch - deltaY * WALK_LOOK_SPEED, -WALK_PITCH_LIMIT, WALK_PITCH_LIMIT);
      this.updateWalkCamera();
      return;
    }
    const point = this.pointers.get(event.pointerId);
    if (!point) { this.callbacks.onHover?.(this.pick(event.clientX, event.clientY)); return; }
    let other;
    for (const [id, value] of this.pointers) if (id !== event.pointerId) { other = value; break; }
    const moved = Math.hypot(event.clientX - point.startX, event.clientY - point.startY);
    if (moved >= DRAG_THRESHOLD) this.dragged = true;
    if (!this.dragged) return;
    const startX = other ? (point.x + other.x) / 2 : point.x;
    const startY = other ? (point.y + other.y) / 2 : point.y;
    this.groundPoint(startX, startY, this.panStart);
    if (other) {
      const before = Math.hypot(point.x - other.x, point.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (after > 4) this.view = clamp(this.view * before / after, MIN_VIEW, MAX_VIEW);
      this.updateCamera();
    }
    point.x = event.clientX;
    point.y = event.clientY;
    this.groundPoint(other ? (point.x + other.x) / 2 : point.x, other ? (point.y + other.y) / 2 : point.y, this.hit);
    this.target.add(this.panStart.sub(this.hit));
    this.updateCamera();
  }

  render(alpha, dt, walkDelta = dt) {
    this.updateWalker(walkDelta);
    for (let i = 0; i < this.guests.count; i++) {
      const offset = i * 2;
      const x = this.guestFrom[offset] + (this.guestTo[offset] - this.guestFrom[offset]) * alpha;
      const z = this.guestFrom[offset + 1] + (this.guestTo[offset + 1] - this.guestFrom[offset + 1]) * alpha;
      this.guestCurrent[offset] = x;
      this.guestCurrent[offset + 1] = z;
      this.dummy.position.set(x, 0.29, z);
      this.dummy.scale.set(0.19, 0.42, 0.19);
      this.dummy.updateMatrix();
      this.guests.setMatrixAt(i, this.dummy.matrix);
    }
    this.guests.instanceMatrix.needsUpdate = true;
    for (const item of this.objects.values()) {
      if (!item.broken && item.active && !item.wheel) item.moving.rotation.y += dt * 0.65;
    }
    this.engine.render(this.scene, this.camera);
  }
}
