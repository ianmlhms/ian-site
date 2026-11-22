/* Village streets (roads.json from scripts/ski/bake.py: the OSM roads inside the villages and next to their houses, never on a piste),
 * draped on the ground as cleared winter streets: packed snow with two darker wet tyre tracks, a ploughed snow bank along both edges.
 * From afar they draw the street grid into the white villages, so a village reads as a town. Merged per CELL m, shown with the
 * buildings (quality.buildingRadius). Painted in one small shader (env lights + the shared fog), no textures. */
import { FOG_GLSL } from './snow-shader.js';

const THREE = window.THREE;
const CELL = 640;                      // round 7 (A): smaller merge cells: the far streets drop out (triangles)
const LIFT = 0.006;                   // R8 (QA: the skis sank into the street): a hair over the ground, the polygon offset does the rest; m above the ground; far away the vertex shader pulls the street towards the camera instead
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
    transparent: true, depthWrite: false,          // R8c (3V QA: sawtooth street edges, faceted banks): the bank fades into the snow
    vertexShader: `
      attribute vec4 aSegA; attribute vec4 aSegB; attribute float aHw;
      varying vec4 vSegA; varying vec4 vSegB; varying float vHw; varying vec3 vW; varying vec3 vN; varying float vDist;
      void main(){ vSegA = aSegA; vSegB = aSegB; vHw = aHw; vW = position; vN = normal; vec4 mv = viewMatrix * vec4(position, 1.0); vDist = -mv.z;
        // round 7: exact close by; farther away (coarser terrain tiles) pulled along the view ray towards the camera so it stays on top
        mv.xyz *= 1.0 - clamp((vDist - 40.0) * 0.00004, 0.0, 0.05);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uOvercast; uniform sampler2D uNoise;
      varying vec4 vSegA; varying vec4 vSegB; varying float vHw; varying vec3 vW; varying vec3 vN; varying float vDist;
      ${FOG_GLSL}
      float segD(vec2 p, vec4 s){ vec2 ab = s.zw - s.xy; float t = clamp(dot(p - s.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0); return length(p - s.xy - ab * t); }
      void main(){
        // R8 (early QA: zigzag bands along the streets): the distance to the street's centre line per PIXEL (the cell's nearest segment and
        // its neighbour, the same for all of the cell's vertices), no longer interpolated between lattice nodes
        float a = min(segD(vW.xz, vSegA), segD(vW.xz, vSegB)) / vHw;      // 0 centre, 1 the edge, > 1 the snow bank
        if (a > 1.37) discard;                                  // round 7: the bank is a painted strip just past the edge
        float edgeA = 1.0 - smoothstep(0.98, 1.36, a);           // R8c: soft, no hard lattice-stepped rim
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
        gl_FragColor = vec4(applyFog(c, vDist, uFogColor, uFogDensity), edgeA);
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
/* R8c (QA: 494-645k triangles in the villages; the streets were 40-90k of them): two levels per render cell. Near (FINE_RADIUS m from
 * the camera to the cell) the street on the 2.5 m physics lattice as before (skis on it); farther a COARSE copy on a 10 m lattice (1/16 of
 * the triangles; the vertex shader's pull towards the camera keeps it on top of the far, coarser terrain tiles). */
const LAT_FAR = 10;
export const FINE_RADIUS = Object.freeze({ low: 150, medium: 360, high: 650 });          // R8d: main.js passes the level (low 260 -> 150)

/** The cells of one lattice (lat m): Map key -> { pos, nrm, segA, segB, hw, cx, cz }. ground = true: the ground's own triangle split. */
function latticeCells(roads, lat, height, ground) {
  const cells = new Map();
  const nodeVal = new Map();                  // lattice node key -> [|across| / hw] of the nearest street
  const covered = new Map();                  // lattice cells touched by a street (+ its bank) -> [d, road, segment] nearest its middle
  const nk = (i, j) => i * 200003 + j;
  for (let ri = 0; ri < roads.length; ri++) {
    const r = roads[ri];
    const pts = r.pts;
    if (pts.length < 2) continue;
    const reach = r.hw + BANK + lat;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const i0 = Math.floor((Math.min(ax, bx) - reach) / lat), i1 = Math.ceil((Math.max(ax, bx) + reach) / lat);
      const j0 = Math.floor((Math.min(az, bz) - reach) / lat), j1 = Math.ceil((Math.max(az, bz) + reach) / lat);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * lat, z = j * lat;
        const t = Math.max(0, Math.min(L, (x - ax) * ux + (z - az) * uz));
        const d = Math.hypot(x - (ax + ux * t), z - (az + uz * t)) / r.hw;
        const key = nk(i, j);
        const old = nodeVal.get(key);
        if (!old || d < old[0]) nodeVal.set(key, [d]);
        // the cell (i, j) (nodes i..i+1, j..j+1) is touched when the street passes within its half diagonal of the cell's middle
        const cx = x + lat / 2, cz = z + lat / 2, tc = Math.max(0, Math.min(L, (cx - ax) * ux + (cz - az) * uz));
        const dc = Math.hypot(cx - (ax + ux * tc), cz - (az + uz * tc));
        if (dc <= r.hw + BANK * 0.6 + lat * 0.71) { const o = covered.get(key); if (!o || dc / r.hw < o[0]) covered.set(key, [dc / r.hw, ri, k]); }
      }
    }
  }
  const hCache = new Map();
  const hAt = (i, j) => { const key = nk(i, j); let h = hCache.get(key); if (h === undefined) { h = height(i * lat, j * lat) + LIFT; hCache.set(key, h); } return h; };
  for (const [key, near] of covered) {
    const i = Math.floor(key / 200003), j = key - i * 200003;
    // skip cells whose four nodes are all beyond the bank (the coarse lattice keeps every touched cell: its nodes are far apart)
    if (ground) {
      const vals = [nodeVal.get(nk(i, j)), nodeVal.get(nk(i + 1, j)), nodeVal.get(nk(i, j + 1)), nodeVal.get(nk(i + 1, j + 1))];
      if (vals.every((v) => !v || v[0] > 1.45)) continue;
    }
    const ci = Math.floor((i * lat) / CELL), cj = Math.floor((j * lat) / CELL), ck = ci + ',' + cj;
    let c = cells.get(ck);
    if (!c) cells.set(ck, (c = { pos: [], nrm: [], segA: [], segB: [], hw: [], x0: ci * CELL, z0: cj * CELL }));
    // the nearest segment to the cell's middle and the nearer of its two neighbours (a bend stays round)
    const r = roads[near[1]], k = near[2], P = r.pts;
    const mx = (i + 0.5) * lat, mz = (j + 0.5) * lat;
    const segDist = (q) => { if (q < 0 || q + 1 >= P.length) return Infinity; const [ax, az] = P[q], [bx, bz] = P[q + 1]; const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-6; const t = Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (mz - az) * (bz - az)) / L2)); return Math.hypot(mx - ax - (bx - ax) * t, mz - az - (bz - az) * t); };
    const k2 = segDist(k - 1) < segDist(k + 1) ? k - 1 : k + 1 < P.length - 1 ? k + 1 : k;
    const A = [P[k][0], P[k][1], P[k + 1][0], P[k + 1][1]];
    const B = k2 >= 0 && k2 + 1 < P.length ? [P[k2][0], P[k2][1], P[k2 + 1][0], P[k2 + 1][1]] : A;
    const corner = { a: [i, j], b: [i + 1, j], c: [i, j + 1], d: [i + 1, j + 1] };
    const tri = !ground || diagonalIsMain(i, j) ? ['a', 'd', 'b', 'a', 'c', 'd'] : ['a', 'c', 'b', 'b', 'c', 'd'];      // the ground's own split (surface.js)
    for (const n of tri) {
      const [ii, jj] = corner[n];
      c.pos.push(ii * lat, hAt(ii, jj), jj * lat);
      const nx = hAt(ii - 1, jj) - hAt(ii + 1, jj), nz = hAt(ii, jj - 1) - hAt(ii, jj + 1), nl = Math.hypot(nx, 2 * lat, nz);
      c.nrm.push(nx / nl, 2 * lat / nl, nz / nl);                       // smooth: the ground's slope at the node
      c.segA.push(...A); c.segB.push(...B); c.hw.push(r.hw);
    }
  }
  return cells;
}

/** R8c (3V QA: street pieces at 25-45 deg, a street climbing a wall at Brides): a street is drawn only where it runs gently with the
 *  ground: segments steeper than MAX_GRADE (sampled every <= 5 m) are cut out, pieces shorter than MIN_PIECE m dropped. Pure. */
export const MAX_GRADE = 0.3;          // ~17 deg
const MIN_PIECE = 8;
export function gentleRoads(roads, height) {
  const out = [];
  for (const r of roads) {
    let cur = [];
    const flush = () => { let L = 0; for (let i = 1; i < cur.length; i++) L += Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1]); if (cur.length > 1 && L >= MIN_PIECE) out.push({ hw: r.hw, pts: cur }); cur = []; };
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 5));
      let steep = false;
      for (let i = 0; i < n && !steep; i++) {
        const x0 = ax + (bx - ax) * (i / n), z0 = az + (bz - az) * (i / n), x1 = ax + (bx - ax) * ((i + 1) / n), z1 = az + (bz - az) * ((i + 1) / n);
        steep = Math.abs(height(x1, z1) - height(x0, z0)) > MAX_GRADE * (L / n);
      }
      if (steep) { flush(); continue; }
      if (!cur.length) cur.push([ax, az]);
      cur.push([bx, bz]);
    }
    flush();
  }
  return out;
}

/** roads = decodeRoads(roads.json); height(x, z) = the PHYSICS ground (surface.height: exact at the lattice nodes); level = quality. */
export function createRoads({ scene, roads, env, height, level = 'medium' }) {
  const gentle = gentleRoads(roads, height);
  const fine = latticeCells(gentle, LAT, height, true), coarse = latticeCells(gentle, LAT_FAR, height, false);
  const mat = material(env);
  const group = new THREE.Group();
  group.name = 'ski-roads';
  const mesh = (c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('aSegA', new THREE.Float32BufferAttribute(c.segA, 4));
    g.setAttribute('aSegB', new THREE.Float32BufferAttribute(c.segB, 4));
    g.setAttribute('aHw', new THREE.Float32BufferAttribute(c.hw, 1));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nrm, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = false;
    group.add(m);
    return m;
  };
  const list = [];
  for (const [key, c] of fine) {
    const far = coarse.get(key);
    list.push({ fine: mesh(c), coarse: far ? mesh(far) : null, x0: c.x0, z0: c.z0 });
  }
  for (const [key, c] of coarse) if (!fine.has(key)) list.push({ fine: null, coarse: mesh(c), x0: c.x0, z0: c.z0 });
  scene.add(group);
  let fineR = FINE_RADIUS[level] || FINE_RADIUS.medium;
  const tris = (m) => (m ? m.geometry.attributes.position.count / 3 : 0);
  const stats = { cells: list.length, fineTriangles: list.reduce((a, c) => a + tris(c.fine), 0), coarseTriangles: list.reduce((a, c) => a + tris(c.coarse), 0), triangles: 0 };
  return {
    count: roads.length, cells: list.length, stats,
    update(px, pz, radius) {
      let t = 0;
      for (const c of list) {
        const dx = Math.max(c.x0 - px, 0, px - c.x0 - CELL), dz = Math.max(c.z0 - pz, 0, pz - c.z0 - CELL), d = Math.hypot(dx, dz);
        const nearCell = d < fineR && !!c.fine;
        if (c.fine) c.fine.visible = nearCell;
        if (c.coarse) c.coarse.visible = !nearCell && d < radius;
        t += (nearCell ? tris(c.fine) : 0) + (!nearCell && d < radius ? tris(c.coarse) : 0);
      }
      stats.triangles = t;
    },
    setLevel(next) { fineR = FINE_RADIUS[next] || FINE_RADIUS.medium; },
  };
}
