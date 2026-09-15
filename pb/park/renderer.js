import { TILE, PHASE, RULES } from "/pb/park/data.js";
import { GRID, GATE, KINDS, isOwned, footprint } from "/pb/park/build.js";
import { animateParkModel, createGuestGeometries, createModelLibrary, createParkModel,
  createPathGeometry, disposeModelLibrary } from "/pb/park/models.js?v=1";
import { createParkWorld } from "/pb/park/world.js?v=1";

const THREE = window.THREE;
const GUEST_CAPACITY = 256;
const CAMERA_PAN_MARGIN = 16;
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
const SHADOW_MAP_SIZE = 1024;
const SKY_HORIZON = 0xcfe8df;
const SKY_ZENITH = 0x76b9de;
const GRASS_TEXTURE_SIZE = 128;
const PATH_TEXTURE_SIZE = 96;
const MAX_TEXTURE_RATIO = 1.75;
const SKIN_TONES = [0x6f4432, 0x9a6247, 0xc98e68, 0xe2b184, 0xf2cba1];
const CLOTHING_COLORS = [0x337da8, 0xe9616f, 0x62a957, 0x8067bd, 0xe59a3b, 0x2d9e9a, 0xd65791];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function createCanvasTexture(size, painter) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are not supported");
  painter(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function paintGrass(context, size) {
  context.fillStyle = "#79a966";
  context.fillRect(0, 0, size, size);
  let seed = 0x2f6e2b1;
  for (let index = 0; index < 520; index++) {
    seed = seed * 1664525 + 1013904223 >>> 0;
    const x = seed % size;
    seed = seed * 1664525 + 1013904223 >>> 0;
    const y = seed % size;
    const lightness = 34 + seed % 18;
    context.fillStyle = `hsla(${92 + seed % 18},35%,${lightness}%,.22)`;
    context.fillRect(x, y, 1 + seed % 3, 1 + (seed >>> 4) % 3);
  }
}

function paintPavers(context, size) {
  context.fillStyle = "#d8c9aa";
  context.fillRect(0, 0, size, size);
  const course = 16;
  context.lineWidth = 1;
  context.strokeStyle = "rgba(101,92,77,.24)";
  for (let y = 0; y <= size; y += course) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size, y);
    context.stroke();
    const offset = y / course % 2 ? course / 2 : 0;
    for (let x = offset; x <= size; x += course) {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, Math.min(size, y + course));
      context.stroke();
    }
  }
  context.fillStyle = "rgba(255,255,255,.1)";
  for (let index = 0; index < 38; index++) context.fillRect(index * 29 % size, index * 47 % size, 3, 2);
}

export class ParkRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks ?? {};
    this.engine = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.engine.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_TEXTURE_RATIO));
    this.engine.setClearColor(SKY_HORIZON);
    this.engine.shadowMap.enabled = true;
    this.engine.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON);
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 38, 92);
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
    this.textures = [];
    this.objects = new Map();
    this.pointers = new Map();
    this.guestKeys = new Map();
    this.guestFrom = new Float32Array(GUEST_CAPACITY * 2);
    this.guestTo = new Float32Array(GUEST_CAPACITY * 2);
    this.guestCurrent = new Float32Array(GUEST_CAPACITY * 2);
    this.nextKeys = new Map();
    this.visualTime = 0;
    this.scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x587052, 1.65));
    this.sun = new THREE.DirectionalLight(0xffeed0, 2.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 92;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.025;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;
    this.modelMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.02, flatShading: true,
    });
    this.brokenMaterial = new THREE.MeshStandardMaterial({
      color: 0x844650, vertexColors: true, roughness: 0.9, flatShading: true,
    });
    this.modelLibrary = createModelLibrary(KINDS, this.modelMaterial);
    this.createTerrain();
    this.world = createParkWorld(this.scene);
    this.createMarkers();
    this.bindControls();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.onPageHide = event => {
      if (!event.persisted) this.dispose();
    };
    window.addEventListener("pagehide", this.onPageHide);
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  createTerrain() {
    const grassTexture = createCanvasTexture(GRASS_TEXTURE_SIZE, paintGrass);
    grassTexture.repeat.set(18, 18);
    const parcelGrassTexture = grassTexture.clone();
    parcelGrassTexture.repeat.set(3, 3);
    parcelGrassTexture.needsUpdate = true;
    const pathTexture = createCanvasTexture(PATH_TEXTURE_SIZE, paintPavers);
    pathTexture.repeat.set(1.5, 1.5);
    this.textures.push(grassTexture, parcelGrassTexture, pathTexture);
    const grassMaterial = new THREE.MeshStandardMaterial({ map: grassTexture, color: 0x6f9870, roughness: 1 });
    const parcelMaterial = new THREE.MeshStandardMaterial({ map: parcelGrassTexture,
      color: 0xffffff, roughness: 1, vertexColors: false });
    const pathMaterial = new THREE.MeshStandardMaterial({ map: pathTexture,
      color: 0xffffff, vertexColors: true, roughness: 0.96 });
    const ground = new THREE.Mesh(this.box, grassMaterial);
    ground.position.set(20, -0.42, 20);
    ground.scale.set(GRID.width + 2, 0.7, GRID.height + 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.land = new THREE.InstancedMesh(this.box, parcelMaterial, 16);
    this.land.receiveShadow = true;
    this.scene.add(this.land);
    this.pathGeometry = createPathGeometry();
    this.paths = new THREE.InstancedMesh(this.pathGeometry, pathMaterial, GRID.width * GRID.height);
    this.paths.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.paths.receiveShadow = true;
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
    this.createSky();
  }

  createSky() {
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        horizon: { value: new THREE.Color(SKY_HORIZON) },
        zenith: { value: new THREE.Color(SKY_ZENITH) },
      },
      vertexShader: "varying float skyHeight; void main(){skyHeight=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform vec3 horizon;uniform vec3 zenith;varying float skyHeight;void main(){float mixAmount=smoothstep(-.12,.72,skyHeight);gl_FragColor=vec4(mix(horizon,zenith,mixAmount),1.0);}",
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 20, 12), skyMaterial);
    sky.position.set(20, -3, 20);
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  createMarkers() {
    const guestGeometries = createGuestGeometries();
    this.guestBodyGeometry = guestGeometries.body;
    this.guestHeadGeometry = guestGeometries.head;
    this.guests = new THREE.InstancedMesh(this.guestBodyGeometry, this.material(0xffffff), GUEST_CAPACITY);
    this.guestHeads = new THREE.InstancedMesh(this.guestHeadGeometry, this.material(0xffffff), GUEST_CAPACITY);
    this.guests.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.guestHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.guests.count = 0;
    this.guestHeads.count = 0;
    this.guests.frustumCulled = false;
    this.guestHeads.frustumCulled = false;
    this.guests.castShadow = true;
    this.guestHeads.castShadow = true;
    this.scene.add(this.guests, this.guestHeads);
    this.objectEntrances = new THREE.InstancedMesh(this.cylinder, this.material(0xffffff), RULES.maxObjects);
    this.objectEntrances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.objectEntrances.count = 0;
    this.objectEntrances.castShadow = true;
    this.scene.add(this.objectEntrances);
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
    const group = new THREE.Group();
    const model = createParkModel(this.modelLibrary, kind, object.id);
    group.add(model);
    const warning = new THREE.Group();
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const bar = this.part(warning, this.box, 0xff243f, 0, 2.6, 0, 1.3, 0.24, 0.24);
      bar.rotation.z = angle;
    }
    group.add(warning);
    const shape = footprint(kind, object.p % GRID.width, Math.floor(object.p / GRID.width), object.r);
    group.position.set(object.p % GRID.width + shape.width / 2, 0, Math.floor(object.p / GRID.width) + shape.height / 2);
    group.rotation.y = -object.r * Math.PI / 2;
    this.scene.add(group);
    return { group, model, moving: model.userData.model.moving, warning,
      signature: `${object.k}:${object.p}:${object.r}`, broken: false };
  }

  sync(state) {
    this.state = state;
    const { saved, derived } = state;
    this.world.sync(saved.l);
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
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
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
        mesh.material = object.b ? this.brokenMaterial : this.modelMaterial;
      });
      item.broken = object.b > 0;
      item.warning.visible = item.broken;
    }
    let entranceCount = 0;
    for (const object of derived.objects) {
      if (!object) continue;
      const kind = KINDS[object.k];
      const shape = footprint(kind, object.p % GRID.width, Math.floor(object.p / GRID.width), object.r);
      this.dummy.position.set(shape.entrance % GRID.width + 0.5, 0.25,
        Math.floor(shape.entrance / GRID.width) + 0.5);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(0.38, 0.1, 0.38);
      this.dummy.updateMatrix();
      this.objectEntrances.setMatrixAt(entranceCount++, this.dummy.matrix);
    }
    this.objectEntrances.count = entranceCount;
    this.objectEntrances.instanceMatrix.needsUpdate = true;
    this.syncGuests(state);
  }

  syncGuests(state) {
    this.nextKeys.clear();
    this.guests.count = Math.min(GUEST_CAPACITY, state.derived.guests.length);
    this.guestHeads.count = this.guests.count;
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
      const phaseOffset = guest.phase === PHASE.LEAVE ? 2 : guest.phase === PHASE.QUEUE ? 4
        : guest.phase === PHASE.USE ? 6 : 0;
      this.guests.setColorAt(i, this.guestColor.setHex(CLOTHING_COLORS[(i + phaseOffset) % CLOTHING_COLORS.length]));
      this.guestHeads.setColorAt(i, this.guestColor.setHex(SKIN_TONES[i * 3 % SKIN_TONES.length]));
    }
    const oldKeys = this.guestKeys;
    this.guestKeys = this.nextKeys;
    this.nextKeys = oldKeys;
    if (this.guests.instanceColor) this.guests.instanceColor.needsUpdate = true;
    if (this.guestHeads.instanceColor) this.guestHeads.instanceColor.needsUpdate = true;
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
    // Panning used to stop dead at the grid edge, so at every zoom level the
    // builder view showed nothing but the park -- the surrounding countryside was
    // structurally unreachable from above. A margin lets you pan out over the
    // hedge and see it, without shrinking the park by widening the zoom range.
    this.target.x = clamp(this.target.x, -CAMERA_PAN_MARGIN, GRID.width + CAMERA_PAN_MARGIN);
    this.target.z = clamp(this.target.z, -CAMERA_PAN_MARGIN, GRID.height + CAMERA_PAN_MARGIN);
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
    this.updateShadowCamera();
  }

  updateShadowCamera() {
    const size = clamp(this.view * Math.max(0.62, this.width / this.height * 0.55), 7, 30);
    this.sunTarget.position.set(this.target.x, 0, this.target.z);
    this.sun.position.set(this.target.x - 18, 34, this.target.z + 16);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -size;
    shadowCamera.right = size;
    shadowCamera.top = size;
    shadowCamera.bottom = -size;
    shadowCamera.updateProjectionMatrix();
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
    this.world.setWalkMode(isActive);
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
    // The camera's forward is (sin yaw, cos yaw), so its right is
    // cross(forward, up) = (-cos yaw, sin yaw). The strafe terms used the negative
    // of that, which put D on the walker's left and A on their right.
    this.moveWalker((sin * normalizedForward - cos * normalizedStrafe) * distance,
      (cos * normalizedForward + sin * normalizedStrafe) * distance);
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
    this.visualTime += Math.max(0, walkDelta);
    for (let i = 0; i < this.guests.count; i++) {
      const offset = i * 2;
      const x = this.guestFrom[offset] + (this.guestTo[offset] - this.guestFrom[offset]) * alpha;
      const z = this.guestFrom[offset + 1] + (this.guestTo[offset + 1] - this.guestFrom[offset + 1]) * alpha;
      this.guestCurrent[offset] = x;
      this.guestCurrent[offset + 1] = z;
      const step = Math.sin(this.visualTime * 7 + i * 1.7) * 0.025;
      const directionX = this.guestTo[offset] - this.guestFrom[offset];
      const directionZ = this.guestTo[offset + 1] - this.guestFrom[offset + 1];
      this.dummy.position.set(x, 0.02 + Math.abs(step), z);
      this.dummy.rotation.set(0, Math.atan2(directionX, directionZ), step * 1.4);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.guests.setMatrixAt(i, this.dummy.matrix);
      this.guestHeads.setMatrixAt(i, this.dummy.matrix);
    }
    this.guests.instanceMatrix.needsUpdate = true;
    this.guestHeads.instanceMatrix.needsUpdate = true;
    for (const item of this.objects.values()) {
      animateParkModel(item.model, this.visualTime);
    }
    this.world.update(this.visualTime, this.camera);
    this.engine.render(this.scene, this.camera);
  }

  performanceSnapshot() {
    const { calls, triangles, points, lines } = this.engine.info.render;
    return { calls, triangles, points, lines, objects: this.objects.size, guests: this.guests.count };
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    window.removeEventListener("pagehide", this.onPageHide);
    this.observer.disconnect();
    this.world.dispose();
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    disposeModelLibrary(this.modelLibrary);
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.engine.dispose();
  }
}
