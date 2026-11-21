/* Village streets (roads.json from scripts/ski/bake.py: the OSM roads inside the villages and next to their houses, never on a piste),
 * draped on the ground as cleared winter streets: packed snow with two darker wet tyre tracks, a ploughed snow bank along both edges.
 * From afar they draw the street grid into the white villages, so a village reads as a town. Merged per CELL m, shown with the
 * buildings (quality.buildingRadius). Painted in one small shader (env lights + the shared fog), no textures. */
import { FOG_GLSL } from './snow-shader.js';

const THREE = window.THREE;
const CELL = 2560;
const STEP = 6;                       // m: the ribbon follows the ground at least this often
const LIFT = 0.22;                    // m above the ground (and a polygon offset): no z-fighting with the terrain
const BANK = 1.7;                     // m of ploughed snow bank beyond the edge

/** roads.json -> [{ hw, pts: [[x, z], ...] }] */
export function decodeRoads(json) {
  if (!json || !Array.isArray(json.roads)) return [];
  const unit = json.unit || 0.5;
  return json.roads.map((r) => {
    const pts = [[r[1] * unit, r[2] * unit]];
    for (let i = 3; i + 1 < r.length; i += 2) { const [x, z] = pts[pts.length - 1]; pts.push([x + r[i] * unit, z + r[i + 1] * unit]); }
    return { hw: r[0] / 10, pts };
  });
}

function densify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}

function material(env) {
  return new THREE.ShaderMaterial({
    uniforms: env.u,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 aRoad; varying vec2 vRoad; varying vec3 vW; varying vec3 vN; varying float vDist;
      void main(){ vRoad = aRoad; vW = position; vN = normal; vec4 mv = viewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uOvercast; uniform sampler2D uNoise;
      varying vec2 vRoad; varying vec3 vW; varying vec3 vN; varying float vDist;
      ${FOG_GLSL}
      void main(){
        float a = abs(vRoad.x);                                 // 0 centre, 1 the edge, > 1 the snow bank
        vec4 nz = texture2D(uNoise, vW.xz * 0.11);
        vec4 nl = texture2D(uNoise, vW.xz * 0.013 + 0.3);
        float fade = 1.0 - smoothstep(120.0, 600.0, vDist);   // tyre tracks blur into one grey far away
        vec3 packed = mix(vec3(0.74, 0.73, 0.71), vec3(0.83, 0.82, 0.8), nl.r);
        float track = smoothstep(0.18, 0.3, a) * (1.0 - smoothstep(0.42, 0.56, a)) * (0.65 + 0.35 * nz.g);
        vec3 wet = vec3(0.42, 0.41, 0.4) * (0.9 + 0.2 * nz.b);
        vec3 col = mix(packed, wet, track * mix(0.35, 0.85, fade));
        col = mix(col, vec3(0.62, 0.61, 0.6), (1.0 - fade) * 0.35);
        col = mix(col, vec3(0.93, 0.95, 0.98) * (0.96 + 0.06 * nz.r), smoothstep(0.92, 1.08, a));   // the ploughed bank
        vec3 N = normalize(vN); N *= sign(N.y + 1e-4);
        float lit = smoothstep(-0.1, 0.6, dot(N, uSunDir));
        vec3 amb = mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y);
        vec3 c = col * (amb * 0.7 + uSunColor * lit * 0.72);
        gl_FragColor = vec4(applyFog(c, vDist, uFogColor, uFogDensity), 1.0);
      }`,
  });
}

/** roads = decodeRoads(roads.json); height(x, z) = the ground. */
export function createRoads({ scene, roads, env, height }) {
  const cells = new Map();
  for (const r of roads) {
    const pts = densify(r.pts);
    if (pts.length < 2) continue;
    const [mx, mz] = pts[Math.floor(pts.length / 2)];
    const key = Math.floor(mx / CELL) + ',' + Math.floor(mz / CELL);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { pos: [], road: [], idx: [], cx: (Math.floor(mx / CELL) + 0.5) * CELL, cz: (Math.floor(mz / CELL) + 0.5) * CELL }));
    const base = c.pos.length / 3;
    // five rails across: bank out, edge, centre, edge, bank out (the bank rises a little: a ridge of ploughed snow)
    const rails = [[-(r.hw + BANK), -1.4, 0.55], [-r.hw, -1, 0], [0, 0, 0], [r.hw, 1, 0], [r.hw + BANK, 1.4, 0.55]];
    pts.forEach(([x, z], i) => {
      const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(qz - pz), nz = qx - px;
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      for (const [off, v, up] of rails) {
        const vx = x + nx * off, vz = z + nz * off;
        c.pos.push(vx, height(vx, vz) + LIFT + up, vz);
        c.road.push(v, 0);
      }
      if (i) {
        const a = base + (i - 1) * 5, b = base + i * 5;
        for (let k = 0; k < 4; k++) c.idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
      }
    });
  }
  const mat = material(env);
  const group = new THREE.Group();
  group.name = 'ski-roads';
  const list = [];
  for (const c of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(c.road, 2));
    g.setIndex(c.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = false;
    group.add(m);
    list.push({ m, cx: c.cx, cz: c.cz });
  }
  scene.add(group);
  return {
    count: roads.length, cells: list.length,
    update(px, pz, radius) {
      for (const c of list) c.m.visible = Math.hypot(c.cx - px, c.cz - pz) - CELL * 0.71 < radius;
    },
  };
}
