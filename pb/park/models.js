const THREE = window.THREE;

const TAU = Math.PI * 2;
const TRACK_SEGMENTS = 20;
const WHEEL_CABINS = 10;
const CAROUSEL_HORSES = 8;
const SWING_SEATS = 10;
const STALL_COUNTER_HEIGHT = 0.72;
const COLORS = Object.freeze({
  cream: 0xfff2cf, white: 0xfffbef, charcoal: 0x334552, steel: 0x73919c,
  darkSteel: 0x405b66, wood: 0x8f603c, darkWood: 0x5d3d2c, gold: 0xffc857,
  red: 0xe95757, blue: 0x43a7d5, cyan: 0x58d5d3, green: 0x4a9f63,
  darkGreen: 0x276742, leaf: 0x5eaf59, lime: 0x9dcc58, pink: 0xf47fa2,
  purple: 0x8c6ed1, orange: 0xf18b45, yellow: 0xffdc64, water: 0x52b8dc,
  paleWater: 0x9ce5ee, stone: 0xc3b79b, darkStone: 0x817966, black: 0x292735,
});

const RIDE_PALETTES = Object.freeze([
  [0xe95f7d, 0xffc857, 0x4aa9d6], [0x876dcc, 0x5bd1c9, 0xffd66b],
  [0x38a4bd, 0xff8b62, 0xffda73], [0xf39c45, 0x65b96f, 0x6f82d8],
  [0x557fd0, 0xf26c61, 0xffd366], [0xd75e76, 0x65bdb1, 0xf7c95c],
]);

class GeometryCollector {
  constructor(primitives) {
    this.primitives = primitives;
    this.parts = [];
  }

  add(shape, color, x, y, z, width, height, depth, rotationX = 0, rotationY = 0, rotationZ = 0) {
    const source = this.primitives[shape];
    if (!source) throw new Error(`Unknown model primitive: ${shape}`);
    const object = new THREE.Object3D();
    object.position.set(x, y, z);
    object.rotation.set(rotationX, rotationY, rotationZ);
    object.scale.set(width, height, depth);
    object.updateMatrix();
    const transformed = source.clone();
    transformed.applyMatrix4(object.matrix);
    const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
    if (geometry !== transformed) transformed.dispose();
    const vertexCount = geometry.getAttribute("position").count;
    const shade = new THREE.Color(color);
    const colors = new Float32Array(vertexCount * 3);
    for (let index = 0; index < vertexCount; index++) {
      colors[index * 3] = shade.r;
      colors[index * 3 + 1] = shade.g;
      colors[index * 3 + 2] = shade.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }

  beam(shape, color, start, end, thickness) {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length <= 0) return;
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), direction.normalize());
    const object = new THREE.Object3D();
    object.position.copy(midpoint);
    object.quaternion.copy(quaternion);
    object.scale.set(thickness, length, thickness);
    object.updateMatrix();
    const source = this.primitives[shape];
    const transformed = source.clone();
    transformed.applyMatrix4(object.matrix);
    const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
    if (geometry !== transformed) transformed.dispose();
    const vertexCount = geometry.getAttribute("position").count;
    const shade = new THREE.Color(color);
    const colors = new Float32Array(vertexCount * 3);
    for (let index = 0; index < vertexCount; index++) {
      colors[index * 3] = shade.r;
      colors[index * 3 + 1] = shade.g;
      colors[index * 3 + 2] = shade.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }

  finish(label) {
    if (!this.parts.length) throw new Error(`${label} has no geometry`);
    const positions = [];
    const normals = [];
    const colors = [];
    const uvs = [];
    for (const geometry of this.parts) {
      positions.push(...geometry.getAttribute("position").array);
      normals.push(...geometry.getAttribute("normal").array);
      colors.push(...geometry.getAttribute("color").array);
      const uv = geometry.getAttribute("uv");
      if (uv) uvs.push(...uv.array);
      else uvs.push(...new Float32Array(geometry.getAttribute("position").count * 2));
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
    geometry.name = label;
    return geometry;
  }
}

function addPlatform(parts, width, depth, color = 0xd9c8a5) {
  parts.add("box", color, 0, 0.1, 0, width - 0.08, 0.2, depth - 0.08);
  parts.add("box", COLORS.darkStone, 0, 0.025, depth * 0.46, width - 0.04, 0.05, 0.08);
}

function addStripedCanopy(parts, radius, y, primary, secondary, height = 0.65, segments = 12) {
  parts.add("cylinder", COLORS.cream, 0, y - height * 0.42, 0, radius * 2.04, 0.12, radius * 2.04);
  for (let index = 0; index < segments; index++) {
    const angle = index / segments * TAU;
    parts.add("cone", index % 2 ? secondary : primary,
      Math.cos(angle) * radius * 0.38, y, Math.sin(angle) * radius * 0.38,
      radius * 0.64, height, radius * 0.64, 0, -angle, 0);
  }
}

function addHorse(parts, x, y, z, color, facing = 0) {
  parts.add("cylinder", COLORS.gold, x, y + 0.32, z, 0.045, 1.25, 0.045);
  parts.add("box", color, x, y, z, 0.42, 0.26, 0.2, 0, facing, 0);
  const forwardX = Math.sin(facing) * 0.22;
  const forwardZ = Math.cos(facing) * 0.22;
  parts.add("sphere", COLORS.cream, x + forwardX, y + 0.13, z + forwardZ, 0.18, 0.22, 0.18);
  parts.add("cone", COLORS.darkWood, x - forwardX * 0.8, y + 0.1, z - forwardZ * 0.8,
    0.12, 0.28, 0.12, Math.PI / 2, facing, 0);
  for (const side of [-1, 1]) parts.add("cylinder", COLORS.darkWood,
    x + Math.cos(facing) * side * 0.11, y - 0.2, z - Math.sin(facing) * side * 0.11,
    0.045, 0.42, 0.045, 0, 0, side * 0.08);
}

function carouselBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth);
  staticParts.add("cylinder", COLORS.gold, 0, 1.15, 0, 0.14, 2.3, 0.14);
  movingParts.add("cylinder", palette[0], 0, 0.3, 0, width * 0.88, 0.32, depth * 0.88);
  addStripedCanopy(movingParts, width * 0.48, 2.02, palette[0], COLORS.cream, 0.72);
  for (let index = 0; index < CAROUSEL_HORSES; index++) {
    const angle = index / CAROUSEL_HORSES * TAU;
    addHorse(movingParts, Math.cos(angle) * width * 0.31, 0.83 + index % 2 * 0.13,
      Math.sin(angle) * depth * 0.31, index % 2 ? palette[1] : palette[2], -angle + Math.PI / 2);
  }
  meta.animation = "spin";
  meta.speed = 0.45;
}

function teacupsBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth, 0xe9d9b8);
  movingParts.add("cylinder", palette[1], 0, 0.25, 0, width * 0.9, 0.24, depth * 0.9);
  movingParts.add("cylinder", COLORS.cream, 0, 0.42, 0, 0.28, 0.42, 0.28);
  for (let index = 0; index < 5; index++) {
    const angle = index / 5 * TAU;
    const x = Math.cos(angle) * 0.57;
    const z = Math.sin(angle) * 0.57;
    movingParts.add("cylinder", index % 2 ? palette[0] : palette[2], x, 0.48, z, 0.52, 0.35, 0.52);
    movingParts.add("torus", COLORS.cream, x, 0.66, z, 0.42, 0.42, 0.42, Math.PI / 2, 0, 0);
    movingParts.add("cylinder", COLORS.gold, x, 0.67, z, 0.05, 0.3, 0.05);
  }
  meta.animation = "spin";
  meta.speed = -0.62;
}

function trackPoint(meta, progress) {
  const angle = progress * TAU;
  const x = Math.cos(angle) * meta.trackRadiusX;
  const z = Math.sin(angle) * meta.trackRadiusZ;
  const wave = Math.max(0, Math.sin(angle + meta.hillOffset));
  return new THREE.Vector3(x, meta.trackBase + wave * meta.hillHeight, z);
}

function addTrackLoop(staticParts, movingParts, kind, palette, meta, options = {}) {
  const [width, depth] = kind.footprint;
  meta.trackRadiusX = width * (options.radiusX ?? 0.38);
  meta.trackRadiusZ = depth * (options.radiusZ ?? 0.35);
  meta.trackBase = options.base ?? 0.62;
  meta.hillHeight = options.hill ?? 0.35;
  meta.hillOffset = options.hillOffset ?? 0;
  meta.animation = "track";
  meta.speed = options.speed ?? 0.08;
  meta.inverted = Boolean(options.inverted);
  const railColor = options.railColor ?? palette[0];
  const supportColor = options.supportColor ?? COLORS.steel;
  const gauge = options.gauge ?? 0.16;
  const points = Array.from({ length: TRACK_SEGMENTS }, (_, index) => trackPoint(meta, index / TRACK_SEGMENTS));
  for (let index = 0; index < TRACK_SEGMENTS; index++) {
    const point = points[index];
    const next = points[(index + 1) % TRACK_SEGMENTS];
    const tangent = next.clone().sub(point).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(gauge);
    staticParts.beam("cylinder", railColor, point.clone().add(normal).toArray(), next.clone().add(normal).toArray(), 0.055);
    staticParts.beam("cylinder", railColor, point.clone().sub(normal).toArray(), next.clone().sub(normal).toArray(), 0.055);
    if (index % 2 === 0) {
      staticParts.beam("box", COLORS.darkWood, point.clone().add(normal.clone().multiplyScalar(1.35)).toArray(),
        point.clone().sub(normal.clone().multiplyScalar(1.35)).toArray(), 0.065);
    }
    if (index % 3 === 0) {
      staticParts.beam("box", supportColor, [point.x, 0.17, point.z],
        [point.x, Math.max(0.25, point.y - 0.05), point.z], 0.075);
      if (options.lattice) {
        const spread = 0.22;
        staticParts.beam("box", supportColor, [point.x - spread, 0.17, point.z], [point.x + spread, point.y, point.z], 0.045);
        staticParts.beam("box", supportColor, [point.x + spread, 0.17, point.z], [point.x - spread, point.y, point.z], 0.045);
      }
    }
  }
  const carY = options.inverted ? -0.25 : 0.14;
  for (let car = 0; car < (options.cars ?? 3); car++) {
    const offset = -car * 0.34;
    movingParts.add("box", car % 2 ? palette[1] : palette[2], offset, carY, 0, 0.3, 0.24, 0.42);
    movingParts.add("box", COLORS.black, offset, carY + 0.13, -0.03, 0.22, 0.12, 0.22);
    if (options.inverted) movingParts.add("cylinder", COLORS.darkSteel, offset, 0.05, 0, 0.045, 0.34, 0.045);
  }
  staticParts.add("box", COLORS.cream, 0, 0.58, depth * 0.38, width * 0.58, 0.88, depth * 0.18);
  staticParts.add("box", palette[1], 0, 1.08, depth * 0.38, width * 0.64, 0.14, depth * 0.22);
  staticParts.add("box", COLORS.darkSteel, 0, 0.62, depth * 0.48, width * 0.34, 0.54, 0.04);
}

function miniTrainBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint, 0x87b879);
  addTrackLoop(staticParts, movingParts, kind, palette, meta,
    { base: 0.38, hill: 0.06, radiusX: 0.39, radiusZ: 0.32, cars: 3, speed: 0.065, railColor: COLORS.darkSteel });
  movingParts.add("cylinder", COLORS.black, 0.18, 0.33, 0, 0.15, 0.38, 0.15);
  movingParts.add("cone", palette[0], 0.18, 0.56, 0, 0.2, 0.22, 0.2);
}

function slideBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint);
  staticParts.add("cylinder", COLORS.cream, 0, 1.9, 0, 0.5, 3.8, 0.5);
  staticParts.add("cone", palette[0], 0, 4.05, 0, 0.9, 0.62, 0.9);
  for (let level = 0; level < 5; level++) {
    const radius = 0.62 - level * 0.045;
    staticParts.add("torus", level % 2 ? palette[1] : palette[2], 0, 0.68 + level * 0.63, 0,
      radius * 2, radius * 2, radius * 2, Math.PI / 2, 0, level * 0.45);
    staticParts.add("box", palette[0], radius * Math.cos(level), 0.78 + level * 0.63,
      radius * Math.sin(level), 0.22, 0.12, 0.6, 0, level, -0.16);
  }
  staticParts.add("box", COLORS.darkWood, 0.62, 1.5, 0, 0.12, 2.8, 0.12);
  meta.animation = "none";
}

function wheelBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth);
  const radius = 1.55;
  const hubY = 1.92;
  for (const z of [-0.32, 0.32]) {
    staticParts.beam("box", COLORS.cream, [-0.95, 0.18, z], [0, hubY, z], 0.12);
    staticParts.beam("box", COLORS.cream, [0.95, 0.18, z], [0, hubY, z], 0.12);
  }
  staticParts.add("cylinder", COLORS.gold, 0, hubY, 0, 0.24, 0.82, 0.24, Math.PI / 2, 0, 0);
  movingParts.add("torus", palette[0], 0, 0, 0, radius * 2, radius * 2, radius * 2);
  movingParts.add("torus", palette[2], 0, 0, 0.22, radius * 1.84, radius * 1.84, radius * 1.84);
  for (let index = 0; index < WHEEL_CABINS; index++) {
    const angle = index / WHEEL_CABINS * TAU;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    movingParts.beam("box", index % 2 ? COLORS.cream : palette[1], [0, 0, 0], [x, y, 0], 0.045);
    movingParts.add("cylinder", COLORS.darkSteel, x, y - 0.18, 0, 0.035, 0.36, 0.035);
    movingParts.add("box", index % 3 === 0 ? palette[1] : index % 3 === 1 ? palette[2] : COLORS.cream,
      x, y - 0.4, 0, 0.38, 0.3, 0.46);
    movingParts.add("box", COLORS.darkSteel, x, y - 0.3, 0, 0.42, 0.05, 0.5);
  }
  meta.animation = "wheel";
  meta.speed = 0.22;
  meta.movingOrigin = [0, hubY, 0];
}

function dodgemsBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth, 0x4e5a68);
  for (const x of [-1.3, 1.3]) for (const z of [-1.3, 1.3]) {
    staticParts.add("cylinder", COLORS.gold, x, 1.15, z, 0.08, 2.2, 0.08);
  }
  staticParts.add("box", palette[0], 0, 2.25, 0, width * 0.94, 0.18, depth * 0.94);
  staticParts.add("cone", palette[1], 0, 2.55, 0, width * 0.98, 0.58, depth * 0.98);
  for (let index = 0; index < 6; index++) {
    const x = (index % 3 - 1) * 0.72;
    const z = (Math.floor(index / 3) - 0.5) * 0.82;
    movingParts.add("box", index % 2 ? palette[1] : palette[2], x, 0.35, z, 0.58, 0.24, 0.72, 0, index * 0.38, 0);
    movingParts.add("torus", COLORS.black, x, 0.34, z, 0.62, 0.62, 0.62, Math.PI / 2, 0, 0);
    movingParts.add("cylinder", COLORS.steel, x, 1.25, z, 0.025, 1.6, 0.025);
  }
  meta.animation = "jitter";
  meta.speed = 1.7;
}

function swingBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint);
  staticParts.add("cylinder", COLORS.cream, 0, 2.15, 0, 0.2, 4.3, 0.2);
  staticParts.add("cylinder", COLORS.gold, 0, 0.35, 0, 0.74, 0.48, 0.74);
  addStripedCanopy(movingParts, 1.25, 3.8, palette[0], palette[1], 0.7);
  movingParts.add("cylinder", COLORS.gold, 0, 3.36, 0, 0.16, 0.82, 0.16);
  for (let index = 0; index < SWING_SEATS; index++) {
    const angle = index / SWING_SEATS * TAU;
    const innerX = Math.cos(angle) * 0.94;
    const innerZ = Math.sin(angle) * 0.94;
    const outerX = Math.cos(angle) * 1.35;
    const outerZ = Math.sin(angle) * 1.35;
    movingParts.beam("cylinder", COLORS.darkSteel, [innerX, 3.48, innerZ], [outerX, 2.2, outerZ], 0.018);
    movingParts.add("box", index % 2 ? palette[2] : palette[1], outerX, 2.08, outerZ, 0.3, 0.16, 0.3, 0, -angle, 0.1);
  }
  meta.animation = "spin";
  meta.speed = 0.72;
}

function ghostTrainBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth, 0x4b4656);
  staticParts.add("box", 0x3a3549, 0, 1.45, 0, width * 0.92, 2.7, depth * 0.9);
  staticParts.add("cone", palette[0], 0, 3.05, 0, width, 0.75, depth);
  staticParts.add("box", COLORS.black, 0, 1.05, depth * 0.46, 1.18, 1.42, 0.08);
  for (const x of [-1.35, 1.35]) staticParts.add("cone", COLORS.cream, x, 2.35, depth * 0.47, 0.45, 0.75, 0.25);
  staticParts.add("sphere", COLORS.white, 0, 2.3, depth * 0.5, 0.7, 0.62, 0.2);
  for (const x of [-0.2, 0.2]) staticParts.add("sphere", COLORS.black, x, 2.4, depth * 0.61, 0.11, 0.14, 0.08);
  movingParts.add("box", palette[2], 0, 0.42, depth * 0.56, 0.7, 0.35, 0.52);
  meta.animation = "ghost";
  meta.speed = 1.4;
}

function logFlumeBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth, 0x739a68);
  addTrackLoop(staticParts, movingParts, kind, palette, meta,
    { base: 0.55, hill: 1.65, hillOffset: -0.8, radiusX: 0.39, radiusZ: 0.36, cars: 1,
      speed: 0.075, railColor: COLORS.water, supportColor: COLORS.wood, gauge: 0.25, lattice: true });
  movingParts.add("box", COLORS.darkWood, 0, 0.12, 0, 0.36, 0.28, 0.72);
  movingParts.add("sphere", palette[1], 0, 0.33, -0.06, 0.22, 0.25, 0.22);
  staticParts.add("box", COLORS.paleWater, 0, 0.22, 0, width * 0.52, 0.08, depth * 0.42);
}

function pirateShipBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth);
  for (const x of [-1.25, 1.25]) {
    staticParts.beam("box", COLORS.cream, [x, 0.16, -0.55], [0, 2.65, -0.2], 0.12);
    staticParts.beam("box", COLORS.cream, [x, 0.16, 0.55], [0, 2.65, 0.2], 0.12);
  }
  staticParts.add("cylinder", COLORS.gold, 0, 2.65, 0, 0.2, 0.72, 0.2, Math.PI / 2, 0, 0);
  movingParts.add("box", COLORS.darkWood, 0, -0.72, 0, width * 0.7, 0.54, depth * 0.64);
  movingParts.add("cone", palette[0], -width * 0.36, -0.58, 0, 0.62, 0.8, depth * 0.64, 0, 0, -Math.PI / 2);
  movingParts.add("cone", palette[0], width * 0.36, -0.58, 0, 0.62, 0.8, depth * 0.64, 0, 0, Math.PI / 2);
  movingParts.add("cylinder", COLORS.darkWood, 0, 0.08, 0, 0.06, 2.3, 0.06);
  movingParts.add("box", COLORS.cream, 0.45, 0.42, 0, 0.9, 0.72, 0.04, 0, 0, 0.12);
  movingParts.add("box", palette[1], 0.46, 0.38, 0.03, 0.72, 0.48, 0.025, 0, 0, 0.12);
  meta.animation = "swing";
  meta.speed = 1.15;
  meta.movingOrigin = [0, 2.65, 0];
}

function wildMouseBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint, 0x8dbb75);
  addTrackLoop(staticParts, movingParts, kind, palette, meta,
    { base: 1.15, hill: 0.65, hillOffset: 0.4, radiusX: 0.4, radiusZ: 0.38, cars: 1,
      speed: 0.13, railColor: palette[1], supportColor: COLORS.darkSteel, gauge: 0.13, lattice: true });
  for (const z of [-0.7, 0, 0.7]) {
    staticParts.add("box", palette[0], 0, 1.65 + z * 0.25, z, 2.8, 0.06, 0.06, 0, 0, z * 0.08);
  }
  movingParts.add("sphere", COLORS.black, 0, 0.34, 0, 0.16, 0.16, 0.16);
}

function dropTowerBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint);
  const height = 6.4;
  for (const x of [-0.16, 0.16]) for (const z of [-0.16, 0.16]) {
    staticParts.add("box", COLORS.steel, x, height / 2, z, 0.07, height, 0.07);
  }
  for (let level = 0; level < 8; level++) {
    const y = 0.45 + level * 0.75;
    staticParts.beam("box", COLORS.darkSteel, [-0.16, y, -0.16], [0.16, y + 0.45, -0.16], 0.035);
    staticParts.beam("box", COLORS.darkSteel, [0.16, y, 0.16], [-0.16, y + 0.45, 0.16], 0.035);
  }
  staticParts.add("cone", palette[0], 0, height + 0.35, 0, 0.65, 0.72, 0.65);
  staticParts.add("cylinder", COLORS.gold, 0, height + 0.1, 0, 0.22, 0.3, 0.22);
  movingParts.add("torus", palette[1], 0, 1.2, 0, 1.45, 1.45, 1.45, Math.PI / 2, 0, 0);
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * TAU;
    movingParts.add("box", index % 2 ? palette[2] : palette[0], Math.cos(angle) * 0.62,
      1.08, Math.sin(angle) * 0.62, 0.28, 0.34, 0.28, 0, -angle, 0);
  }
  staticParts.beam("cylinder", COLORS.black, [-0.05, height + 0.08, 0], [-0.05, 1.4, 0], 0.018);
  staticParts.beam("cylinder", COLORS.black, [0.05, height + 0.08, 0], [0.05, 1.4, 0], 0.018);
  meta.animation = "drop";
  meta.speed = 0.62;
}

function woodenCoasterBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint, 0x78a866);
  addTrackLoop(staticParts, movingParts, kind, palette, meta,
    { base: 0.72, hill: 2.8, hillOffset: -0.65, radiusX: 0.41, radiusZ: 0.38, cars: 4,
      speed: 0.09, railColor: COLORS.darkWood, supportColor: COLORS.wood, gauge: 0.18, lattice: true });
}

function rapidsBuilder(staticParts, movingParts, kind, palette, meta) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth, 0x76a96b);
  meta.trackRadiusX = width * 0.36;
  meta.trackRadiusZ = depth * 0.34;
  meta.trackBase = 0.36;
  meta.hillHeight = 0.08;
  meta.hillOffset = 0;
  meta.animation = "track";
  meta.speed = 0.055;
  for (const scale of [1, 0.72]) staticParts.add("torus", scale === 1 ? COLORS.stone : COLORS.water,
    0, 0.34 + (1 - scale) * 0.02, 0, width * 0.74 * scale, depth * 0.68 * scale,
    Math.min(width, depth) * 0.74 * scale, Math.PI / 2, 0, 0);
  movingParts.add("cylinder", palette[0], 0, 0.1, 0, 0.75, 0.22, 0.75);
  movingParts.add("torus", palette[1], 0, 0.22, 0, 0.72, 0.72, 0.72, Math.PI / 2, 0, 0);
  for (let index = 0; index < 5; index++) {
    const angle = index / 5 * TAU;
    movingParts.add("sphere", COLORS.cream, Math.cos(angle) * 0.23, 0.38,
      Math.sin(angle) * 0.23, 0.14, 0.16, 0.14);
  }
  for (let index = 0; index < 9; index++) {
    const angle = index / 9 * TAU;
    const radius = index % 2 ? 1.85 : 1.45;
    staticParts.add("sphere", COLORS.darkStone, Math.cos(angle) * radius, 0.32,
      Math.sin(angle) * radius * 0.82, 0.28, 0.34, 0.3, 0, angle, 0);
  }
}

function invertedCoasterBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint, 0x82af70);
  addTrackLoop(staticParts, movingParts, kind, palette, meta,
    { base: 2.35, hill: 1.35, hillOffset: 0.2, radiusX: 0.4, radiusZ: 0.38, cars: 4,
      speed: 0.1, railColor: palette[2], supportColor: COLORS.steel, gauge: 0.2, lattice: true, inverted: true });
}

function launchCoasterBuilder(staticParts, movingParts, kind, palette, meta) {
  addPlatform(staticParts, ...kind.footprint, 0x7baa6b);
  addTrackLoop(staticParts, movingParts, kind, palette, meta,
    { base: 0.82, hill: 3.55, hillOffset: -1.05, radiusX: 0.42, radiusZ: 0.36, cars: 5,
      speed: 0.145, railColor: palette[0], supportColor: COLORS.darkSteel, gauge: 0.18, lattice: true });
  staticParts.add("box", palette[1], 0, 0.64, kind.footprint[1] * 0.23,
    kind.footprint[0] * 0.64, 0.1, 0.18);
  for (let index = -4; index <= 4; index++) staticParts.add("box", COLORS.gold,
    index * 0.3, 0.71, kind.footprint[1] * 0.23, 0.08, 0.08, 0.28);
}

function addKiosk(staticParts, kind, palette, options = {}) {
  const [width, depth] = kind.footprint;
  const wallColor = options.wall ?? COLORS.cream;
  addPlatform(staticParts, width, depth, options.floor ?? 0xd6c49f);
  staticParts.add("box", wallColor, 0, 0.82, -0.08, width * 0.82, 1.35, depth * 0.72);
  staticParts.add("box", COLORS.darkWood, 0, STALL_COUNTER_HEIGHT, depth * 0.38, width * 0.76, 0.14, 0.28);
  staticParts.add("box", COLORS.black, 0, 1.0, depth * 0.3, width * 0.5, 0.48, 0.04);
  staticParts.add("box", palette[0], 0, 1.62, depth * 0.38, width * 0.92, 0.12, 0.5, 0.12, 0, 0);
  for (let stripe = -2; stripe <= 2; stripe++) staticParts.add("box", stripe % 2 ? COLORS.cream : palette[1],
    stripe * width * 0.17, 1.66, depth * 0.47, width * 0.16, 0.08, 0.18, 0.12, 0, 0);
  staticParts.add("box", palette[0], 0, 1.98, -depth * 0.03, width * 0.74, 0.36, 0.12);
  staticParts.add("box", COLORS.cream, 0, 1.98, depth * 0.04, width * 0.56, 0.14, 0.03);
}

function popcornBuilder(staticParts, movingParts, kind, palette) {
  addKiosk(staticParts, kind, palette, { wall: 0xe85d57 });
  for (let index = 0; index < 7; index++) staticParts.add("sphere", index % 2 ? COLORS.white : COLORS.yellow,
    (index % 3 - 1) * 0.14, 2.28 + Math.floor(index / 3) * 0.1, 0, 0.17, 0.15, 0.17);
  staticParts.add("cylinder", COLORS.red, 0, 2.12, 0, 0.52, 0.42, 0.52);
}

function lemonadeBuilder(staticParts, movingParts, kind, palette) {
  addKiosk(staticParts, kind, [COLORS.yellow, COLORS.cream, COLORS.green], { wall: 0xffefa8 });
  for (const x of [-0.2, 0.2]) {
    staticParts.add("cylinder", COLORS.yellow, x, 2.27, 0, 0.35, 0.08, 0.35, Math.PI / 2, 0, 0);
    staticParts.add("cylinder", COLORS.white, x, 2.27, 0.05, 0.23, 0.09, 0.23, Math.PI / 2, 0, 0);
  }
  staticParts.add("cylinder", COLORS.paleWater, 0.22, 1.08, 0.49, 0.18, 0.4, 0.18);
}

function balloonsBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint);
  staticParts.add("box", COLORS.wood, 0, 0.55, 0, 0.72, 0.65, 0.56);
  staticParts.add("box", COLORS.cream, 0, 0.92, 0, 0.82, 0.13, 0.65);
  const shades = [COLORS.red, COLORS.blue, COLORS.yellow, COLORS.purple, COLORS.green, COLORS.pink];
  for (let index = 0; index < shades.length; index++) {
    const angle = index / shades.length * TAU;
    const x = Math.cos(angle) * 0.3;
    const z = Math.sin(angle) * 0.22;
    staticParts.beam("cylinder", COLORS.darkSteel, [0, 0.88, 0], [x, 1.55 + index % 2 * 0.26, z], 0.012);
    staticParts.add("sphere", shades[index], x, 1.72 + index % 2 * 0.26, z, 0.28, 0.38, 0.28);
  }
}

function burgersBuilder(staticParts, movingParts, kind, palette) {
  addKiosk(staticParts, kind, [COLORS.red, COLORS.yellow, COLORS.orange], { wall: 0xffdf87 });
  staticParts.add("sphere", COLORS.orange, 0, 2.3, 0, 0.72, 0.28, 0.52);
  staticParts.add("box", COLORS.green, 0, 2.24, 0, 0.72, 0.06, 0.5);
  staticParts.add("cylinder", COLORS.darkWood, 0, 2.18, 0, 0.66, 0.12, 0.48);
  staticParts.add("sphere", COLORS.orange, 0, 2.12, 0, 0.72, 0.22, 0.52);
}

function juiceBuilder(staticParts, movingParts, kind) {
  addKiosk(staticParts, kind, [COLORS.green, COLORS.lime, COLORS.yellow], { wall: 0xdff0a4 });
  for (let index = -1; index <= 1; index++) {
    staticParts.add("cylinder", index === 0 ? COLORS.orange : COLORS.green, index * 0.28, 2.24, 0,
      0.24, 0.45, 0.24);
    staticParts.beam("cylinder", COLORS.white, [index * 0.28, 2.4, 0], [index * 0.35, 2.66, 0], 0.018);
  }
}

function giftsBuilder(staticParts, movingParts, kind, palette) {
  addKiosk(staticParts, kind, [COLORS.purple, COLORS.pink, COLORS.gold], { wall: 0xf0d5eb });
  staticParts.add("box", COLORS.pink, 0, 2.35, 0, 0.72, 0.58, 0.62);
  staticParts.add("box", COLORS.gold, 0, 2.35, 0, 0.14, 0.62, 0.66);
  staticParts.add("box", COLORS.gold, 0, 2.35, 0, 0.76, 0.12, 0.66);
  for (const x of [-0.16, 0.16]) staticParts.add("torus", COLORS.gold, x, 2.72, 0, 0.32, 0.28, 0.32, 0, 0, x * 2.2);
}

function pizzaBuilder(staticParts, movingParts, kind) {
  addKiosk(staticParts, kind, [COLORS.red, COLORS.cream, COLORS.green], { wall: 0xf2d19a });
  staticParts.add("cone", COLORS.orange, 0, 2.4, 0, 0.92, 0.22, 0.68, Math.PI / 2, 0, 0);
  for (const [x, z] of [[-0.2, 0.05], [0.16, -0.04], [0.02, 0.12]]) {
    staticParts.add("cylinder", COLORS.red, x, 2.52, z, 0.15, 0.05, 0.15);
  }
}

function smoothiesBuilder(staticParts, movingParts, kind) {
  addKiosk(staticParts, kind, [COLORS.pink, COLORS.lime, COLORS.purple], { wall: 0xe4f1ce });
  for (let index = -1; index <= 1; index++) {
    staticParts.add("cone", index === 0 ? COLORS.purple : COLORS.pink, index * 0.3, 2.3, 0, 0.3, 0.5, 0.3);
    staticParts.add("sphere", COLORS.lime, index * 0.3, 2.55, 0, 0.14, 0.14, 0.14);
  }
  staticParts.add("sphere", COLORS.green, -0.65, 0.58, 0.4, 0.48, 0.62, 0.48);
}

function emporiumBuilder(staticParts, movingParts, kind, palette) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth);
  staticParts.add("box", 0xe9d1b7, 0, 1.25, 0, width * 0.88, 2.3, depth * 0.8);
  staticParts.add("box", palette[0], 0, 2.58, 0, width * 0.96, 0.24, depth * 0.9);
  staticParts.add("cone", palette[1], 0, 2.96, 0, width * 0.98, 0.7, depth * 0.96);
  for (const x of [-0.92, 0, 0.92]) {
    staticParts.add("box", COLORS.darkWood, x, 1.12, depth * 0.42, 0.52, 1.32, 0.05);
    staticParts.add("box", x === 0 ? COLORS.gold : COLORS.paleWater, x, 1.12, depth * 0.46, 0.38, 1.12, 0.03);
  }
  staticParts.add("box", COLORS.purple, 0, 2.2, depth * 0.45, 1.7, 0.44, 0.12);
  staticParts.add("torus", COLORS.gold, 0, 3.25, 0, 0.62, 0.62, 0.62);
}

function toiletBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint);
  staticParts.add("box", 0x83b7c9, 0, 0.88, 0, 0.78, 1.48, 0.76);
  staticParts.add("cone", COLORS.cream, 0, 1.78, 0, 0.92, 0.5, 0.9);
  staticParts.add("box", COLORS.white, 0, 1.1, 0.4, 0.46, 0.5, 0.05);
  for (const x of [-0.13, 0.13]) staticParts.add("sphere", COLORS.blue, x, 1.18, 0.45, 0.08, 0.08, 0.04);
  staticParts.add("box", COLORS.blue, 0, 1.0, 0.45, 0.24, 0.05, 0.04);
}

function binBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint, 0xa8c783);
  staticParts.add("cylinder", COLORS.darkGreen, 0, 0.45, 0, 0.5, 0.78, 0.5);
  staticParts.add("torus", COLORS.gold, 0, 0.83, 0, 0.52, 0.52, 0.52, Math.PI / 2, 0, 0);
  staticParts.add("cylinder", COLORS.black, 0, 0.84, 0, 0.36, 0.06, 0.36);
  staticParts.add("box", COLORS.cream, 0, 0.45, 0.26, 0.24, 0.26, 0.03);
}

function firstAidBuilder(staticParts, movingParts, kind) {
  addKiosk(staticParts, kind, [COLORS.white, COLORS.red, COLORS.red], { wall: COLORS.white });
  staticParts.add("box", COLORS.red, 0, 2.22, 0.08, 0.62, 0.18, 0.08);
  staticParts.add("box", COLORS.red, 0, 2.22, 0.08, 0.18, 0.62, 0.08);
  staticParts.add("cylinder", COLORS.red, 0.67, 1.05, 0.5, 0.16, 0.42, 0.16);
}

function flowersBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint, 0x6d9b58);
  const shades = [COLORS.pink, COLORS.yellow, COLORS.purple, COLORS.white, COLORS.red];
  for (let index = 0; index < 12; index++) {
    const angle = index * 2.4;
    const radius = 0.12 + index % 4 * 0.1;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    staticParts.add("cylinder", COLORS.darkGreen, x, 0.34, z, 0.025, 0.4 + index % 3 * 0.08, 0.025);
    staticParts.add("sphere", shades[index % shades.length], x, 0.58 + index % 3 * 0.04, z, 0.14, 0.1, 0.14);
  }
}

function treeBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint, 0x7ead62);
  staticParts.add("cylinder", COLORS.darkWood, 0, 0.92, 0, 0.2, 1.7, 0.2);
  staticParts.add("cone", COLORS.darkGreen, 0, 1.7, 0, 1.08, 1.35, 1.08);
  staticParts.add("cone", COLORS.leaf, 0, 2.28, 0, 0.92, 1.25, 0.92);
  staticParts.add("cone", COLORS.lime, 0, 2.78, 0, 0.64, 1.0, 0.64);
}

function fountainBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint, 0x87ad72);
  staticParts.add("cylinder", COLORS.stone, 0, 0.3, 0, 1.55, 0.36, 1.55);
  staticParts.add("cylinder", COLORS.water, 0, 0.5, 0, 1.3, 0.12, 1.3);
  staticParts.add("torus", COLORS.cream, 0, 0.55, 0, 1.48, 1.48, 1.48, Math.PI / 2, 0, 0);
  staticParts.add("cylinder", COLORS.stone, 0, 0.92, 0, 0.24, 0.78, 0.24);
  staticParts.add("cylinder", COLORS.water, 0, 1.55, 0, 0.06, 1.0, 0.06);
  for (let index = 0; index < 6; index++) {
    const angle = index / 6 * TAU;
    staticParts.beam("cylinder", COLORS.paleWater, [0, 1.62, 0],
      [Math.cos(angle) * 0.56, 0.72, Math.sin(angle) * 0.56], 0.025);
  }
  staticParts.add("sphere", COLORS.paleWater, 0, 1.92, 0, 0.14, 0.2, 0.14);
}

function topiaryBuilder(staticParts, movingParts, kind) {
  addPlatform(staticParts, ...kind.footprint, 0x88ad68);
  for (const x of [-0.55, 0.55]) {
    staticParts.add("cylinder", COLORS.darkWood, x, 0.74, 0, 0.13, 1.12, 0.13);
    staticParts.add("sphere", COLORS.darkGreen, x, 1.35, 0, 0.68, 0.78, 0.68);
    staticParts.add("sphere", COLORS.leaf, x, 1.92, 0, 0.46, 0.55, 0.46);
    staticParts.add("cone", COLORS.darkGreen, x, 2.38, 0, 0.34, 0.75, 0.34);
  }
  staticParts.add("box", COLORS.leaf, 0, 0.42, 0.72, 1.7, 0.52, 0.24);
}

function castleBuilder(staticParts, movingParts, kind) {
  const [width, depth] = kind.footprint;
  addPlatform(staticParts, width, depth, 0x8caf70);
  staticParts.add("box", 0xd8c1a0, 0, 1.2, 0, width * 0.76, 2.0, depth * 0.54);
  const towers = [[-1.05, -0.72], [1.05, -0.72], [-1.05, 0.72], [1.05, 0.72]];
  for (let index = 0; index < towers.length; index++) {
    const [x, z] = towers[index];
    staticParts.add("cylinder", index % 2 ? 0xcab293 : 0xe0c9a8, x, 1.55, z, 0.7, 2.8, 0.7);
    staticParts.add("cone", index % 2 ? COLORS.purple : COLORS.blue, x, 3.22, z, 0.92, 1.08, 0.92);
    staticParts.add("cylinder", COLORS.gold, x, 3.86, z, 0.04, 0.62, 0.04);
    staticParts.add("box", index % 2 ? COLORS.yellow : COLORS.pink, x + 0.12, 4.02, z, 0.3, 0.22, 0.025);
  }
  staticParts.add("box", COLORS.black, 0, 0.88, depth * 0.3, 0.72, 1.35, 0.06);
  staticParts.add("torus", COLORS.stone, 0, 1.48, depth * 0.33, 0.82, 0.9, 0.82);
  for (let x = -0.75; x <= 0.75; x += 0.5) staticParts.add("box", COLORS.stone,
    x, 2.42, depth * 0.31, 0.28, 0.34, 0.28);
}

const MODEL_BUILDERS = Object.freeze({
  carousel: carouselBuilder,
  teacups: teacupsBuilder,
  "mini-train": miniTrainBuilder,
  slide: slideBuilder,
  wheel: wheelBuilder,
  dodgems: dodgemsBuilder,
  swing: swingBuilder,
  "ghost-train": ghostTrainBuilder,
  "log-flume": logFlumeBuilder,
  "pirate-ship": pirateShipBuilder,
  "wild-mouse": wildMouseBuilder,
  "drop-tower": dropTowerBuilder,
  "wooden-coaster": woodenCoasterBuilder,
  rapids: rapidsBuilder,
  "inverted-coaster": invertedCoasterBuilder,
  "launch-coaster": launchCoasterBuilder,
  popcorn: popcornBuilder,
  lemonade: lemonadeBuilder,
  balloons: balloonsBuilder,
  burgers: burgersBuilder,
  juice: juiceBuilder,
  gifts: giftsBuilder,
  pizza: pizzaBuilder,
  smoothies: smoothiesBuilder,
  emporium: emporiumBuilder,
  toilet: toiletBuilder,
  bin: binBuilder,
  "first-aid": firstAidBuilder,
  flowers: flowersBuilder,
  tree: treeBuilder,
  fountain: fountainBuilder,
  topiary: topiaryBuilder,
  castle: castleBuilder,
});

function createPrimitives() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    cone: new THREE.ConeGeometry(0.5, 1, 10),
    sphere: new THREE.SphereGeometry(0.5, 10, 7),
    torus: new THREE.TorusGeometry(0.5, 0.055, 6, 16),
  };
}

function validateDefinition(kind, definition) {
  const position = definition.staticGeometry.getAttribute("position");
  const bounds = definition.staticGeometry.boundingBox;
  if (!position || position.count <= 0 || !bounds || bounds.isEmpty()) {
    throw new Error(`Model ${kind.id} produced empty geometry`);
  }
  const size = bounds.getSize(new THREE.Vector3());
  const footprintLimit = Math.max(...kind.footprint) * 2.2;
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0
    || size.z <= 0 || size.x > footprintLimit || size.z > footprintLimit || size.y > 9) {
    throw new Error(`Model ${kind.id} produced invalid bounds`);
  }
}

export function createModelLibrary(kinds, material) {
  const primitives = createPrimitives();
  const definitions = new Map();
  for (let index = 0; index < kinds.length; index++) {
    const kind = kinds[index];
    const builder = MODEL_BUILDERS[kind.id];
    if (!builder) throw new Error(`Missing model builder for ${kind.id}`);
    const staticParts = new GeometryCollector(primitives);
    const movingParts = new GeometryCollector(primitives);
    const meta = { animation: "none", speed: 0, movingOrigin: [0, 0, 0] };
    builder(staticParts, movingParts, kind, RIDE_PALETTES[index % RIDE_PALETTES.length], meta);
    const definition = {
      staticGeometry: staticParts.finish(`${kind.id}-static`),
      movingGeometry: movingParts.parts.length ? movingParts.finish(`${kind.id}-moving`) : null,
      meta: Object.freeze({ ...meta, movingOrigin: [...meta.movingOrigin] }),
    };
    validateDefinition(kind, definition);
    definitions.set(kind.id, definition);
  }
  for (const geometry of Object.values(primitives)) geometry.dispose();
  if (definitions.size !== kinds.length || definitions.size !== Object.keys(MODEL_BUILDERS).length) {
    throw new Error(`Model library expected ${kinds.length} unique kinds; built ${definitions.size}`);
  }
  const library = { definitions, material };
  for (let index = 0; index < kinds.length; index++) {
    const model = createParkModel(library, kinds[index], index);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (!model.children.length || bounds.isEmpty()) {
      throw new Error(`Model ${kinds[index].id} could not be instantiated`);
    }
  }
  return library;
}

export function createParkModel(library, kind, variant = 0) {
  const definition = library.definitions.get(kind.id);
  if (!definition) throw new Error(`No model definition for ${kind.id}`);
  const group = new THREE.Group();
  group.name = `${kind.id}-model`;
  const staticMesh = new THREE.Mesh(definition.staticGeometry, library.material);
  staticMesh.castShadow = kind.id !== "flowers";
  staticMesh.receiveShadow = true;
  group.add(staticMesh);
  const moving = new THREE.Group();
  moving.position.fromArray(definition.meta.movingOrigin);
  if (definition.movingGeometry) {
    const movingMesh = new THREE.Mesh(definition.movingGeometry, library.material);
    movingMesh.castShadow = true;
    movingMesh.receiveShadow = true;
    moving.add(movingMesh);
  }
  group.add(moving);
  if (kind.id === "tree") {
    const scale = 0.88 + variant % 5 * 0.045;
    group.scale.set(scale, 0.92 + variant % 4 * 0.065, scale);
    group.rotation.y = variant * 2.39996;
  }
  group.userData.model = { definition, moving, staticMesh };
  return group;
}

export function animateParkModel(model, elapsed) {
  const record = model.userData.model;
  if (!record) return;
  const { meta } = record.definition;
  const moving = record.moving;
  if (meta.animation === "spin") {
    moving.rotation.y = elapsed * meta.speed;
  } else if (meta.animation === "wheel") {
    moving.rotation.z = elapsed * meta.speed;
  } else if (meta.animation === "swing") {
    moving.rotation.z = Math.sin(elapsed * meta.speed) * 0.68;
  } else if (meta.animation === "drop") {
    const cycle = (elapsed * meta.speed) % 1;
    const lift = cycle < 0.72 ? cycle / 0.72 : Math.max(0, 1 - (cycle - 0.72) / 0.28);
    moving.position.y = lift * lift * 4.6;
  } else if (meta.animation === "track") {
    const progress = elapsed * meta.speed % 1;
    const point = trackPoint(meta, progress);
    const next = trackPoint(meta, (progress + 0.01) % 1);
    moving.position.copy(point);
    moving.position.y += meta.inverted ? -0.18 : 0.12;
    moving.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
    moving.rotation.z = -Math.atan2(next.y - point.y, next.distanceTo(point));
  } else if (meta.animation === "jitter") {
    moving.rotation.y = Math.sin(elapsed * meta.speed) * 0.12;
    moving.position.x = Math.sin(elapsed * meta.speed * 1.7) * 0.08;
  } else if (meta.animation === "ghost") {
    moving.position.x = Math.sin(elapsed * meta.speed) * 0.7;
  }
}

export function disposeModelLibrary(library) {
  for (const definition of library.definitions.values()) {
    definition.staticGeometry.dispose();
    definition.movingGeometry?.dispose();
  }
  library.definitions.clear();
}

export function createPathGeometry() {
  const primitives = createPrimitives();
  const parts = new GeometryCollector(primitives);
  parts.add("box", COLORS.white, 0, 0, 0, 0.94, 0.1, 0.94);
  for (const x of [-0.47, 0.47]) parts.add("box", 0xd4c7a9, x, 0.075, 0, 0.06, 0.15, 1);
  for (const z of [-0.47, 0.47]) parts.add("box", 0xd4c7a9, 0, 0.075, z, 0.88, 0.15, 0.06);
  const geometry = parts.finish("paved-path-tile");
  for (const primitive of Object.values(primitives)) primitive.dispose();
  return geometry;
}

export function createGuestGeometries() {
  const primitives = createPrimitives();
  const bodyParts = new GeometryCollector(primitives);
  bodyParts.add("box", COLORS.white, 0, 0.66, 0, 0.22, 0.42, 0.16);
  bodyParts.add("cylinder", COLORS.white, -0.16, 0.65, 0, 0.055, 0.42, 0.055, 0, 0, -0.28);
  bodyParts.add("cylinder", COLORS.white, 0.16, 0.65, 0, 0.055, 0.42, 0.055, 0, 0, 0.28);
  bodyParts.add("cylinder", COLORS.white, -0.07, 0.27, 0, 0.065, 0.42, 0.065, 0, 0, 0.05);
  bodyParts.add("cylinder", COLORS.white, 0.07, 0.27, 0, 0.065, 0.42, 0.065, 0, 0, -0.05);
  const headParts = new GeometryCollector(primitives);
  headParts.add("sphere", COLORS.white, 0, 0.98, 0, 0.23, 0.25, 0.23);
  const result = {
    body: bodyParts.finish("guest-body-arms-legs"),
    head: headParts.finish("guest-head"),
  };
  for (const primitive of Object.values(primitives)) primitive.dispose();
  return result;
}

export const MODEL_KIND_IDS = Object.freeze(Object.keys(MODEL_BUILDERS));
