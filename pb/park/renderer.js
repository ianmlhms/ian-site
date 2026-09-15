import { TILE, PHASE, RULES } from "/pb/park/data.js";
import { GRID, GATE, KINDS, isOwned, footprint } from "/pb/park/build.js";

const THREE = window.THREE;
const GUEST_CAPACITY = 256;
const MIN_VIEW = 7;
const MAX_VIEW = 46;
const DRAG_THRESHOLD = 7;
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
    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 180);
    this.target = new THREE.Vector3(20, 0, 9);
    this.view = 24;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.panStart = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    this.cone = new THREE.ConeGeometry(0.5, 1, 10);
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
    this.part(this.scene, this.box, 0x64836d, 20, -0.28, 20, 40.4, 0.5, 40.4);
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
      const tower = kind.id === "drop-tower" || kind.id === "slide";
      const wheel = kind.id === "wheel";
      this.part(group, this.cylinder, 0xf7efe0, 0, tower ? 1.6 : 0.8, 0, 0.28, tower ? 3 : 1.5, 0.28);
      this.part(moving, this.cylinder, color, 0, tower ? 2.7 : 0.42, 0, w * 0.85, 0.2, d * 0.85);
      const roof = this.part(moving, this.cone, color, 0, tower ? 3.3 : 1.65, 0, w * 0.92, 0.65, d * 0.92);
      if (wheel) {
        roof.visible = false;
        const ring = this.part(moving, this.cylinder, color, 0, 1.85, 0, 2.5, 0.16, 2.5);
        ring.rotation.x = Math.PI / 2;
      }
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        this.part(moving, this.box, i % 2 ? 0xffe596 : 0xffffff,
          Math.cos(angle) * w * 0.31, wheel ? 1.85 + Math.sin(angle) : 0.7,
          wheel ? 0 : Math.sin(angle) * d * 0.31, 0.35, 0.35, 0.35);
      }
    } else if (kind.type === "scenery") {
      const low = kind.id === "flowers" || kind.id === "fountain";
      this.part(group, this.cylinder, low ? 0x63cbd5 : 0x916b47, 0, 0.5, 0, low ? w * 0.8 : 0.2, low ? 0.4 : 0.9, low ? d * 0.8 : 0.2);
      this.part(group, this.cone, kind.id === "flowers" ? 0xef8ba0 : color,
        0, low ? 0.65 : 1.35, 0, w * 0.8, low ? 0.35 : 1.45, d * 0.8);
    } else {
      this.part(group, this.box, color, 0, 0.6, 0, w * 0.82, 0.95, d * 0.82);
      this.part(group, this.cone, kind.type === "stall" ? 0xffd585 : 0xe7eef0,
        0, 1.3, 0, w, 0.5, d);
      this.part(group, this.box, 0x355568, 0, 0.75, d * 0.42, w * 0.5, 0.35, 0.04);
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
    this.updateCamera();
  }

  updateCamera() {
    this.target.x = clamp(this.target.x, 0, GRID.width);
    this.target.z = clamp(this.target.z, 0, GRID.height);
    const half = this.view / 2;
    const aspect = this.width / this.height;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.position.set(this.target.x + 24, 32, this.target.z + 28);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
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
      event.preventDefault();
      this.view = clamp(this.view * Math.exp(clamp(event.deltaY, -100, 100) * 0.002), MIN_VIEW, MAX_VIEW);
      this.updateCamera();
    }, { passive: false });
    this.canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      this.canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
      if (this.pointers.size === 1) this.dragged = false;
      else this.dragged = true;
    });
    this.canvas.addEventListener("pointermove", event => this.pointerMove(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.canvas.addEventListener(type, event => {
        const point = this.pointers.get(event.pointerId);
        if (!point) return;
        this.pointers.delete(event.pointerId);
        const tap = Math.hypot(event.clientX - point.startX, event.clientY - point.startY) < DRAG_THRESHOLD;
        if (type === "pointerup" && !this.dragged && tap) this.callbacks.onTap?.(this.pick(event.clientX, event.clientY));
      });
    }
  }

  pointerMove(event) {
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

  render(alpha, dt) {
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
