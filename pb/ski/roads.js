/* Village streets (roads.json from scripts/ski/bake.py: the OSM roads inside the villages and next to their houses, never on a piste),
 * draped on the ground as cleared winter streets: packed snow with two darker wet tyre tracks, a ploughed snow bank along both edges.
 * From afar they draw the street grid into the white villages, so a village reads as a town. Merged per CELL m, shown with the
 * buildings (quality.buildingRadius). Painted in one small shader (env lights + the shared fog), no textures. */
import { FOG_GLSL } from './snow-shader.js';

const THREE = window.THREE;
const CELL = 640;                      // round 7 (A): smaller merge cells: the far streets drop out (triangles)
const LIFT = 0.03;                    // m above the ground; far away the vertex shader pulls the street towards the camera instead
const BANK = 1.1;                     // m of ploughed snow bank beyond the edge (painted, flat: round 7, no raised ridge)

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

function material(env) {
  return new THREE.ShaderMaterial({
    uniforms: env.u,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 aRoad; varying vec2 vRoad; varying vec3 vW; varying vec3 vN; varying float vDist;
      void main(){ vRoad = aRoad; vW = position; vN = normal; vec4 mv = viewMatrix * vec4(position, 1.0); vDist = -mv.z;
        // round 7: exact close by; farther away (coarser terrain tiles) pulled along the view ray towards the camera so it stays on top
        mv.xyz *= 1.0 - clamp((vDist - 40.0) * 0.00004, 0.0, 0.05);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uOvercast; uniform sampler2D uNoise;
      varying vec2 vRoad; varying vec3 vW; varying vec3 vN; varying float vDist;
      ${FOG_GLSL}
      void main(){
        float a = abs(vRoad.x);                                 // 0 centre, 1 the edge, > 1 the snow bank
        if (a > 1.37) discard;                                  // round 7: the bank is a painted strip just past the edge
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

/* Round 7 (A): the streets are drawn ON THE PHYSICS LATTICE. A ribbon with its own vertices cut across the 2.5 m triangles of the
 * ground and stood up to 10 cm above them between its vertices (Ian, Safari: the skier's feet in the street). Now every 2.5 m cell a
 * street touches is emitted with the ground's own two triangles (surface.js diagonalIsMain, the same node heights) a hair above it, and
 * the shader paints the street from the distance to the street's centre line (aRoad.x = across / half width; fragments beyond the bank
 * are discarded, so the edges stay smooth). Where streets cross, the nearest one paints. */
import { diagonalIsMain } from './surface.js';
const LAT = 2.5;
/** roads = decodeRoads(roads.json); height(x, z) = the PHYSICS ground (surface.height: exact at the lattice nodes). */
export function createRoads({ scene, roads, env, height }) {
  const cells = new Map();                    // render cell key -> { nodes: Map(nodeKey -> index), pos, road, idx, mark: Set(cellKey) }
  const nodeVal = new Map();                  // lattice node key -> [|across| / hw, along] of the nearest street
  const covered = new Set();                  // lattice cells touched by a street (+ its bank)
  const nk = (i, j) => i * 200003 + j;
  for (const r of roads) {
    const pts = r.pts;
    if (pts.length < 2) continue;
    const reach = r.hw + BANK + LAT;
    let along = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const i0 = Math.floor((Math.min(ax, bx) - reach) / LAT), i1 = Math.ceil((Math.max(ax, bx) + reach) / LAT);
      const j0 = Math.floor((Math.min(az, bz) - reach) / LAT), j1 = Math.ceil((Math.max(az, bz) + reach) / LAT);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * LAT, z = j * LAT;
        const t = Math.max(0, Math.min(L, (x - ax) * ux + (z - az) * uz));
        const px = ax + ux * t, pz = az + uz * t;
        const d = Math.hypot(x - px, z - pz) / r.hw;
        const key = nk(i, j);
        const old = nodeVal.get(key);
        if (!old || d < old[0]) nodeVal.set(key, [d, along + t]);
        // the cell (i, j) (nodes i..i+1, j..j+1) is touched when the street passes within its half diagonal of the cell's middle
        const cx = x + LAT / 2, cz = z + LAT / 2, tc = Math.max(0, Math.min(L, (cx - ax) * ux + (cz - az) * uz));
        if (Math.hypot(cx - (ax + ux * tc), cz - (az + uz * tc)) <= r.hw + BANK * 0.6 + LAT * 0.71) covered.add(key);
      }
      along += L;
    }
  }
  const nodeOf = (c, i, j) => {
    const key = nk(i, j);
    let v = c.nodes.get(key);
    if (v !== undefined) return v;
    v = c.pos.length / 3;
    const x = i * LAT, z = j * LAT;
    c.pos.push(x, height(x, z) + LIFT, z);
    const nv = nodeVal.get(key) || [9, 0];
    c.road.push(nv[0], nv[1]);
    c.nodes.set(key, v);
    return v;
  };
  for (const key of covered) {
    const i = Math.floor(key / 200003), j = key - i * 200003;
    // the cell (i, j) spans nodes i..i+1, j..j+1; skip cells whose four nodes are all beyond the bank
    const vals = [nodeVal.get(nk(i, j)), nodeVal.get(nk(i + 1, j)), nodeVal.get(nk(i, j + 1)), nodeVal.get(nk(i + 1, j + 1))];
    if (vals.every((v) => !v || v[0] > 1.45)) continue;
    const ck = Math.floor((i * LAT) / CELL) + ',' + Math.floor((j * LAT) / CELL);
    let c = cells.get(ck);
    if (!c) cells.set(ck, (c = { nodes: new Map(), pos: [], road: [], idx: [], cx: (Math.floor((i * LAT) / CELL) + 0.5) * CELL, cz: (Math.floor((j * LAT) / CELL) + 0.5) * CELL }));
    const a = nodeOf(c, i, j), b = nodeOf(c, i + 1, j), cc = nodeOf(c, i, j + 1), d = nodeOf(c, i + 1, j + 1);
    if (diagonalIsMain(i, j)) c.idx.push(a, d, b, a, cc, d);          // split along 00-11 (surface.js)
    else c.idx.push(a, cc, b, b, cc, d);                                 // split along 10-01
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
