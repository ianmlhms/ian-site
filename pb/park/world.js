import { GRID, GATE } from "/pb/park/build.js";

const THREE = window.THREE;
const TAU = Math.PI * 2;
const WORLD_CENTER_X = GRID.width / 2;
const WORLD_CENTER_Z = GRID.height / 2;
const WORLD_SIZE = 170;
const WORLD_SEGMENTS = 34;
const WORLD_MIN_X = WORLD_CENTER_X - WORLD_SIZE / 2;
const WORLD_MIN_Z = WORLD_CENTER_Z - WORLD_SIZE / 2;
// Distance OUTSIDE the buildable grid, so this is a ring beyond the hedge, not
// inside the park. Kept small on purpose: at max zoom-out the camera only sees a
// few units past the boundary, so anything further away is never seen in play.
const PARK_CLEAR_MARGIN = 2;
const HILL_FADE_DISTANCE = 16;
const LAKE_CENTER_X = 66;
const LAKE_CENTER_Z = 58;
const LAKE_RADIUS_X = 20;
const LAKE_RADIUS_Z = 11;
const LAKE_LEVEL = -0.05;
const TREE_ATTEMPTS = 1100;
const TREE_LIMIT = 300;
const TREE_SEED = 0x51c3a927;
// Uniform sampling over the whole world puts almost every tree far away, because
// the outer region has so much more area than the band next to the park -- with
// density weighting alone only 28 of 340 trees landed within 8 units. These are
// placed along the perimeter instead, so there is an actual treeline past the hedge.
const TREELINE_COUNT = 110;
const TREELINE_MIN_OFFSET = 2.5;
const TREELINE_MAX_OFFSET = 11;
const PARCEL_SIZE = 10;
const PARCEL_COLUMNS = GRID.width / PARCEL_SIZE;
const PARCEL_ROWS = GRID.height / PARCEL_SIZE;
const BOUNDARY_CAPACITY = PARCEL_COLUMNS * PARCEL_ROWS * PARCEL_SIZE * 4;
const TRAFFIC_COUNT = 8;
const TRAFFIC_MIN_X = WORLD_MIN_X + 8;
const TRAFFIC_MAX_X = WORLD_MIN_X + WORLD_SIZE - 8;
const TRAFFIC_SPAN = TRAFFIC_MAX_X - TRAFFIC_MIN_X;
const TRAFFIC_SPEED = 2.4;
const ROAD_Z = 63;
const CLOUD_COUNT = 24;
const WORLD_DRAW_CALLS = 10;
const COLORS = Object.freeze({
  hillLow: 0x709665, hillHigh: 0x8aac70, hillFar: 0x5f845e,
  water: 0x66b9c8, trunk: 0x6d5136, leaf: 0x477a45, leafLight: 0x679951,
  hedge: 0x315f3e, gate: 0xd9aa45, road: 0x6c706b, roadEdge: 0xb7aa88,
  wall: 0xd8c69c, wallWarm: 0xc89272, roof: 0x9d5547, roofDark: 0x654751,
  church: 0xe7d8b6, cloud: 0xfff9e9, sun: 0xffe19a,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (min, max, value) => {
  const amount = clamp((value - min) / (max - min), 0, 1);
  return amount * amount * (3 - 2 * amount);
};

function parkDistance(x, z) {
  return Math.max(0, -x, x - GRID.width, -z, z - GRID.height);
}

function lakeDistance(x, z) {
  return Math.hypot((x - LAKE_CENTER_X) / LAKE_RADIUS_X, (z - LAKE_CENTER_Z) / LAKE_RADIUS_Z);
}

function terrainHeight(x, z) {
  const distance = parkDistance(x, z);
  const hillAmount = smoothstep(PARK_CLEAR_MARGIN, HILL_FADE_DISTANCE, distance);
  const broadRoll = Math.sin(x * 0.075 + 0.7) * Math.cos(z * 0.061 - 0.4);
  const crossRoll = Math.sin((x + z) * 0.043) * 0.65 + Math.cos((x - z) * 0.052) * 0.42;
  const hillHeight = -0.24 + hillAmount * (2.35 + broadRoll * 1.45 + crossRoll);
  const basinAmount = 1 - smoothstep(0.72, 1.18, lakeDistance(x, z));
  return hillHeight * (1 - basinAmount) + (LAKE_LEVEL - 0.42) * basinAmount;
}

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function addVertexColors(geometry, color) {
  const vertexCount = geometry.getAttribute("position").count;
  const shade = new THREE.Color(color);
  const colors = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index++) {
    colors[index * 3] = shade.r;
    colors[index * 3 + 1] = shade.g;
    colors[index * 3 + 2] = shade.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

class StaticGeometryBuilder {
  constructor(primitives) {
    this.primitives = primitives;
    this.parts = [];
  }

  add(shape, color, x, y, z, width, height, depth, rotationY = 0, rotationZ = 0) {
    const source = this.primitives[shape];
    if (!source) throw new Error(`Unknown world primitive: ${shape}`);
    const transform = new THREE.Object3D();
    transform.position.set(x, y, z);
    transform.rotation.set(0, rotationY, rotationZ);
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    const clone = source.clone();
    clone.applyMatrix4(transform.matrix);
    const geometry = clone.index ? clone.toNonIndexed() : clone;
    if (geometry !== clone) clone.dispose();
    addVertexColors(geometry, color);
    this.parts.push(geometry);
  }

  finish(name) {
    if (!this.parts.length) throw new Error(`${name} has no geometry`);
    const positions = [];
    const normals = [];
    const colors = [];
    const uvs = [];
    for (const geometry of this.parts) {
      const position = geometry.getAttribute("position");
      positions.push(...position.array);
      normals.push(...geometry.getAttribute("normal").array);
      colors.push(...geometry.getAttribute("color").array);
      const uv = geometry.getAttribute("uv");
      uvs.push(...(uv?.array ?? new Float32Array(position.count * 2)));
      geometry.dispose();
    }
    this.parts.length = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = name;
    return geometry;
  }
}

function createTerrainGeometry() {
  const positions = [];
  const colors = [];
  const indices = [];
  const low = new THREE.Color(COLORS.hillLow);
  const high = new THREE.Color(COLORS.hillHigh);
  const far = new THREE.Color(COLORS.hillFar);
  const shade = new THREE.Color();
  for (let row = 0; row <= WORLD_SEGMENTS; row++) {
    const z = WORLD_MIN_Z + row / WORLD_SEGMENTS * WORLD_SIZE;
    for (let column = 0; column <= WORLD_SEGMENTS; column++) {
      const x = WORLD_MIN_X + column / WORLD_SEGMENTS * WORLD_SIZE;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);
      const heightMix = smoothstep(-0.4, 4.2, y);
      shade.copy(low).lerp(high, heightMix).lerp(far, smoothstep(42, 78, parkDistance(x, z)) * 0.48);
      const variation = 0.94 + Math.sin(x * 0.31 + z * 0.27) * 0.035;
      colors.push(shade.r * variation, shade.g * variation, shade.b * variation);
    }
  }
  const rowWidth = WORLD_SEGMENTS + 1;
  for (let row = 0; row < WORLD_SEGMENTS; row++) {
    for (let column = 0; column < WORLD_SEGMENTS; column++) {
      const a = row * rowWidth + column;
      const b = a + 1;
      const c = a + rowWidth;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = "surrounding terrain";
  return geometry;
}

function createLakeGeometry() {
  const segments = 40;
  const positions = [LAKE_CENTER_X, LAKE_LEVEL, LAKE_CENTER_Z];
  for (let index = 0; index <= segments; index++) {
    const angle = index / segments * TAU;
    const ripple = 1 + Math.sin(angle * 5) * 0.025;
    positions.push(LAKE_CENTER_X + Math.cos(angle) * LAKE_RADIUS_X * ripple,
      LAKE_LEVEL, LAKE_CENTER_Z + Math.sin(angle) * LAKE_RADIUS_Z * ripple);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const indices = [];
  for (let index = 1; index <= segments; index++) indices.push(0, index, index + 1);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "country lake";
  return geometry;
}

function createTreePositions() {
  const random = createRandom(TREE_SEED);
  const trees = [];
  for (let attempt = 0; attempt < TREE_ATTEMPTS && trees.length < TREE_LIMIT; attempt++) {
    const x = WORLD_MIN_X + 7 + random() * (WORLD_SIZE - 14);
    const z = WORLD_MIN_Z + 7 + random() * (WORLD_SIZE - 14);
    const distance = parkDistance(x, z);
    const density = smoothstep(PARK_CLEAR_MARGIN, 12, distance) * 0.88;
    const isLake = lakeDistance(x, z) < 1.32;
    const isVillage = x > -49 && x < -8 && z > 48 && z < 78;
    const isRoad = Math.abs(z - ROAD_Z) < 4;
    if (distance < PARK_CLEAR_MARGIN || random() > density || isLake || isVillage || isRoad) continue;
    const nearness = smoothstep(PARK_CLEAR_MARGIN, 10, distance);
    trees.push({ x, z, scale: (0.72 + random() * 0.72) * (0.68 + nearness * 0.32),
      rotation: random() * TAU, colorMix: random() });
  }
  addTreeline(trees, random);
  return trees;
}

// Walk the park's perimeter and drop trees just outside it, so the countryside
// starts at the hedge instead of only appearing near the fog line.
function addTreeline(trees, random) {
  const perimeter = 2 * (GRID.width + GRID.height);
  for (let index = 0; index < TREELINE_COUNT; index++) {
    const along = (index + random() * 0.85) / TREELINE_COUNT * perimeter;
    const offset = TREELINE_MIN_OFFSET + random() * (TREELINE_MAX_OFFSET - TREELINE_MIN_OFFSET);
    let x;
    let z;
    if (along < GRID.width) { x = along; z = -offset; }
    else if (along < GRID.width + GRID.height) { x = GRID.width + offset; z = along - GRID.width; }
    else if (along < 2 * GRID.width + GRID.height) { x = 2 * GRID.width + GRID.height - along; z = GRID.height + offset; }
    else { x = -offset; z = perimeter - along; }
    if (lakeDistance(x, z) < 1.32 || Math.abs(z - ROAD_Z) < 4) continue;
    trees.push({ x, z, scale: 0.6 + random() * 0.5, rotation: random() * TAU,
      colorMix: random() });
  }
}

function configureTrees(group, resources) {
  const trees = createTreePositions();
  const trunkGeometry = new THREE.CylinderGeometry(0.11, 0.16, 1, 7);
  const crownGeometry = new THREE.ConeGeometry(0.72, 1.9, 7);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: COLORS.trunk, roughness: 1, flatShading: true });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length);
  const dummy = new THREE.Object3D();
  const leafDark = new THREE.Color(COLORS.leaf);
  const leafLight = new THREE.Color(COLORS.leafLight);
  const leafColor = new THREE.Color();
  trees.forEach((tree, index) => {
    const groundY = terrainHeight(tree.x, tree.z);
    const trunkHeight = 1.25 * tree.scale;
    dummy.position.set(tree.x, groundY + trunkHeight / 2, tree.z);
    dummy.rotation.set(0, tree.rotation, 0);
    dummy.scale.set(tree.scale, trunkHeight, tree.scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.set(tree.x, groundY + trunkHeight + 0.66 * tree.scale, tree.z);
    dummy.rotation.set(0, tree.rotation, 0);
    dummy.scale.set(tree.scale, tree.scale, tree.scale);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, leafColor.copy(leafDark).lerp(leafLight, tree.colorMix * 0.75));
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  group.add(trunks, crowns);
  resources.geometries.add(trunkGeometry);
  resources.geometries.add(crownGeometry);
  resources.materials.add(trunkMaterial);
  resources.materials.add(crownMaterial);
}

function createRoadGeometry(primitives) {
  const builder = new StaticGeometryBuilder(primitives);
  const roadSegments = 30;
  const segmentLength = TRAFFIC_SPAN / roadSegments;
  for (let index = 0; index < roadSegments; index++) {
    const x = TRAFFIC_MIN_X + (index + 0.5) * segmentLength;
    const y = terrainHeight(x, ROAD_Z) + 0.055;
    builder.add("box", COLORS.road, x, y, ROAD_Z, segmentLength + 0.05, 0.08, 5.2);
    builder.add("box", COLORS.roadEdge, x, y + 0.045, ROAD_Z, segmentLength * 0.42, 0.015, 0.13);
  }
  const gateX = GATE % GRID.width + 0.5;
  builder.add("box", COLORS.roadEdge, gateX, -0.16, -9.5, 4.2, 0.16, 19);
  builder.add("box", COLORS.road, gateX, -0.065, -9.5, 3.35, 0.08, 19);
  return builder.finish("country roads");
}

function createVillageGeometry(primitives) {
  const builder = new StaticGeometryBuilder(primitives);
  const random = createRandom(0x731da42f);
  const houses = 17;
  for (let index = 0; index < houses; index++) {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const x = -43 + column * 5.7 + (random() - 0.5) * 1.1;
    const z = 51 + row * 8.1 + (random() - 0.5) * 1.2;
    const width = 2.4 + random() * 1.4;
    const depth = 2.4 + random() * 1.3;
    const height = 1.8 + random() * 1.4;
    const baseY = terrainHeight(x, z);
    const wallColor = index % 3 === 0 ? COLORS.wallWarm : COLORS.wall;
    const roofColor = index % 4 === 0 ? COLORS.roofDark : COLORS.roof;
    builder.add("box", wallColor, x, baseY + height / 2, z, width, height, depth, (random() - 0.5) * 0.18);
    builder.add("cone", roofColor, x, baseY + height + 0.72, z, width * 0.78, 1.45, depth * 0.78,
      Math.PI / 4 + (random() - 0.5) * 0.18);
  }
  const churchX = -12;
  const churchZ = 68;
  const churchY = terrainHeight(churchX, churchZ);
  builder.add("box", COLORS.church, churchX, churchY + 2.7, churchZ, 3.3, 5.4, 3.3);
  builder.add("cone", COLORS.roofDark, churchX, churchY + 6.9, churchZ, 2.2, 3.1, 2.2, Math.PI / 4);
  builder.add("box", COLORS.church, churchX - 2.5, churchY + 1.55, churchZ, 3.4, 3.1, 5.2);
  builder.add("cone", COLORS.roof, churchX - 2.5, churchY + 3.75, churchZ, 2.5, 1.5, 3.5, Math.PI / 4);
  return builder.finish("distant village");
}

function isParcelOwned(landMask, x, z) {
  if (x < 0 || z < 0 || x >= GRID.width || z >= GRID.height) return false;
  const parcel = Math.floor(z / PARCEL_SIZE) * PARCEL_COLUMNS + Math.floor(x / PARCEL_SIZE);
  return Boolean(landMask & (1 << parcel));
}

function createBoundary(group, resources) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const boundary = new THREE.InstancedMesh(geometry, material, BOUNDARY_CAPACITY);
  boundary.count = 0;
  boundary.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let currentLandMask = null;

  function addSegment(x, z, rotationY, isGate = false) {
    const index = boundary.count;
    if (index >= BOUNDARY_CAPACITY) throw new Error("Park boundary exceeded its instance capacity");
    dummy.position.set(x, isGate ? 0.36 : 0.39, z);
    dummy.rotation.set(0, rotationY, 0);
    dummy.scale.set(isGate ? 0.86 : 0.94, isGate ? 0.16 : 0.78, isGate ? 0.14 : 0.3);
    dummy.updateMatrix();
    boundary.setMatrixAt(index, dummy.matrix);
    boundary.setColorAt(index, color.setHex(isGate ? COLORS.gate : COLORS.hedge));
    boundary.count++;
  }

  function sync(landMask) {
    if (landMask === currentLandMask) return;
    currentLandMask = landMask;
    boundary.count = 0;
    const gateX = GATE % GRID.width;
    const gateZ = Math.floor(GATE / GRID.width);
    for (let z = 0; z < GRID.height; z++) {
      for (let x = 0; x < GRID.width; x++) {
        if (!isParcelOwned(landMask, x, z)) continue;
        if (!isParcelOwned(landMask, x, z - 1)) addSegment(x + 0.5, z,
          0, x === gateX && z === gateZ);
        if (!isParcelOwned(landMask, x, z + 1)) addSegment(x + 0.5, z + 1, 0);
        if (!isParcelOwned(landMask, x - 1, z)) addSegment(x, z + 0.5, Math.PI / 2);
        if (!isParcelOwned(landMask, x + 1, z)) addSegment(x + 1, z + 0.5, Math.PI / 2);
      }
    }
    boundary.instanceMatrix.needsUpdate = true;
    if (boundary.instanceColor) boundary.instanceColor.needsUpdate = true;
  }

  group.add(boundary);
  resources.geometries.add(geometry);
  resources.materials.add(material);
  return sync;
}

function createTraffic(group, resources) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, flatShading: true });
  const traffic = new THREE.InstancedMesh(geometry, material, TRAFFIC_COUNT);
  const colors = [0xc75f50, 0xe1b84f, 0x4c8193, 0xe7e1cc, 0x788756, 0xa66779, 0x53738f, 0xd17b45];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let index = 0; index < TRAFFIC_COUNT; index++) traffic.setColorAt(index, color.setHex(colors[index]));
  if (traffic.instanceColor) traffic.instanceColor.needsUpdate = true;

  function update(time) {
    for (let index = 0; index < TRAFFIC_COUNT; index++) {
      const direction = index % 2 ? -1 : 1;
      const progress = ((index / TRAFFIC_COUNT * TRAFFIC_SPAN + time * TRAFFIC_SPEED * direction)
        % TRAFFIC_SPAN + TRAFFIC_SPAN) % TRAFFIC_SPAN;
      const x = TRAFFIC_MIN_X + progress;
      const z = ROAD_Z + (direction > 0 ? -1.25 : 1.25);
      dummy.position.set(x, terrainHeight(x, ROAD_Z) + 0.42, z);
      dummy.rotation.set(0, direction > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.scale.set(1.05, 0.48, 0.58);
      dummy.updateMatrix();
      traffic.setMatrixAt(index, dummy.matrix);
    }
    traffic.instanceMatrix.needsUpdate = true;
  }

  update(0);
  traffic.frustumCulled = false;
  group.add(traffic);
  resources.geometries.add(geometry);
  resources.materials.add(material);
  return update;
}

function createSkyDetails(group, resources) {
  const cloudGeometry = new THREE.IcosahedronGeometry(1, 1);
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.cloud, transparent: true, opacity: 0.72, depthWrite: false,
  });
  const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, CLOUD_COUNT);
  const random = createRandom(0x9ae13b6d);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < CLOUD_COUNT; index++) {
    const cluster = Math.floor(index / 3);
    const puff = index % 3;
    const angle = cluster / (CLOUD_COUNT / 3) * TAU + 0.28;
    const distance = 43 + cluster % 3 * 8;
    dummy.position.set(WORLD_CENTER_X + Math.cos(angle) * distance + (puff - 1) * 2.4,
      19 + cluster % 4 * 2.8 + random() * 1.8, WORLD_CENTER_Z + Math.sin(angle) * distance);
    dummy.rotation.set(0, random() * TAU, 0);
    dummy.scale.set(3.8 + random() * 2.2, 1.15 + random() * 0.7, 1.7 + random() * 1.3);
    dummy.updateMatrix();
    clouds.setMatrixAt(index, dummy.matrix);
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.computeBoundingSphere();
  clouds.renderOrder = -1;
  group.add(clouds);

  const sunGeometry = new THREE.CircleGeometry(3.1, 28);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.sun, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  });
  const sun = new THREE.Mesh(sunGeometry, sunMaterial);
  sun.position.set(-4, 45, 42);
  sun.renderOrder = -1;
  group.add(sun);
  resources.geometries.add(cloudGeometry);
  resources.geometries.add(sunGeometry);
  resources.materials.add(cloudMaterial);
  resources.materials.add(sunMaterial);
  return { sun, clouds };
}

function addMesh(group, resources, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);
  resources.geometries.add(geometry);
  resources.materials.add(material);
  return mesh;
}

export function createParkWorld(scene) {
  if (!scene?.isScene) throw new Error("A three.js scene is required to create the park world");
  const group = new THREE.Group();
  group.name = "park surroundings";
  const resources = { geometries: new Set(), materials: new Set() };
  const primitives = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 4),
  };

  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, flatShading: false,
  });
  addMesh(group, resources, createTerrainGeometry(), terrainMaterial);
  const lakeMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.water, roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.86,
  });
  addMesh(group, resources, createLakeGeometry(), lakeMaterial);
  const staticMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.92, flatShading: true,
  });
  addMesh(group, resources, createRoadGeometry(primitives), staticMaterial);
  addMesh(group, resources, createVillageGeometry(primitives), staticMaterial);
  for (const primitive of Object.values(primitives)) primitive.dispose();
  configureTrees(group, resources);
  const syncBoundary = createBoundary(group, resources);
  const updateTraffic = createTraffic(group, resources);
  const { sun, clouds } = createSkyDetails(group, resources);
  // The game boots in the builder view, and the renderer only calls setWalkMode on
  // a change, so these have to start hidden rather than waiting to be switched off.
  clouds.visible = false;
  sun.visible = false;
  scene.add(group);

  let isDisposed = false;
  return Object.freeze({
    drawCalls: WORLD_DRAW_CALLS,
    sync(landMask) {
      if (isDisposed) return;
      syncBoundary(landMask);
    },
    update(time, camera) {
      if (isDisposed) return;
      updateTraffic(time);
      if (camera?.isCamera) sun.lookAt(camera.position);
    },
    setWalkMode(isWalking) {
      if (isDisposed) return;
      // Clouds sit at y~24 and read against the sky at eye level, but the
      // orthographic builder camera looks down at 45 degrees and projects them
      // onto the grass as white blobs. Only show them while walking.
      clouds.visible = Boolean(isWalking);
      sun.visible = Boolean(isWalking);
    },
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      scene.remove(group);
      resources.geometries.forEach(geometry => geometry.dispose());
      resources.materials.forEach(material => material.dispose());
      resources.geometries.clear();
      resources.materials.clear();
    },
  });
}
