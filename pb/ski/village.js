/* The villages (Val d'Isère, La Daille, Le Fornet, Tignes le Lac, Val Claret, Tignes 1800, Les Brévières ...) from the OSM footprints:
 * one oriented box per building with a gable roof along its long side, painted in the shader: stone ground floor and larch-wood upper
 * floors for chalets, cream plaster with wooden balcony bands for the apartment blocks, white for chapels, snow on every roof with a dark
 * fascia, window rows (warm light in the evening). Merged per 1280 m cell: one draw call per cell, cells beyond quality.buildingRadius hidden. */
const THREE = window.THREE;
const CELL = 1280;

function addBuilding(out, row, seed) {
  const [cx, cz, L, W, ang, eave, ridge, ground, kind] = row;
  const c = Math.cos(ang), s = Math.sin(ang);
  const g0 = ground - 1.5;
  const hl = L / 2, hw = W / 2;
  const P = (u, v, y) => [cx + u * c - v * s, y, cz + u * s + v * c];
  const quad = (a, b, cc, d, n, uv, isRoof) => {
    for (const [p, t] of [[a, uv[0]], [b, uv[1]], [cc, uv[2]], [a, uv[0]], [cc, uv[2]], [d, uv[3]]]) {
      out.pos.push(p[0], p[1], p[2]); out.nrm.push(n[0], n[1], n[2]); out.uv.push(t[0], t[1]); out.info.push(kind, eave, seed, isRoof);
    }
  };
  const tri = (a, b, cc, n, uv) => {
    for (const [p, t] of [[a, uv[0]], [b, uv[1]], [cc, uv[2]]]) { out.pos.push(p[0], p[1], p[2]); out.nrm.push(n[0], n[1], n[2]); out.uv.push(t[0], t[1]); out.info.push(kind, eave, seed, 0); }
  };
  const e = ground + eave, r = ground + ridge, gH = ground;     // eave / ridge are stored as heights above the ground
  const nx = [c, 0, s], nz = [-s, 0, c];
  // long walls (v = +-hw), gable walls (u = +-hl); uv = (metres along the wall, metres above the ground)
  quad(P(-hl, hw, g0), P(hl, hw, g0), P(hl, hw, e), P(-hl, hw, e), nz, [[0, g0 - gH], [L, g0 - gH], [L, e - gH], [0, e - gH]], 0);
  quad(P(hl, -hw, g0), P(-hl, -hw, g0), P(-hl, -hw, e), P(hl, -hw, e), [-nz[0], 0, -nz[2]], [[0, g0 - gH], [L, g0 - gH], [L, e - gH], [0, e - gH]], 0);
  quad(P(hl, hw, g0), P(hl, -hw, g0), P(hl, -hw, e), P(hl, hw, e), nx, [[0, g0 - gH], [W, g0 - gH], [W, e - gH], [0, e - gH]], 0);
  quad(P(-hl, -hw, g0), P(-hl, hw, g0), P(-hl, hw, e), P(-hl, -hw, e), [-nx[0], 0, -nx[2]], [[0, g0 - gH], [W, g0 - gH], [W, e - gH], [0, e - gH]], 0);
  // gable triangles
  tri(P(hl, hw, e), P(hl, -hw, e), P(hl, 0, r), nx, [[0, e - gH], [W, e - gH], [W / 2, r - gH]]);
  tri(P(-hl, -hw, e), P(-hl, hw, e), P(-hl, 0, r), [-nx[0], 0, -nx[2]], [[0, e - gH], [W, e - gH], [W / 2, r - gH]]);
  // roof with overhangs
  const o = 0.7, ol = hl + o, ow = hw + o, eo = e - o * (r - e) / hw;
  const slope = Math.hypot(hw, r - e);
  const k = (r - e) / slope;
  const nA = [-s * k, hw / slope, c * k], nB = [s * k, hw / slope, -c * k];
  quad(P(-ol, ow, eo), P(ol, ow, eo), P(ol, 0, r + 0.05), P(-ol, 0, r + 0.05), nA, [[0, 0], [2 * ol, 0], [2 * ol, slope + o], [0, slope + o]], 1);
  quad(P(ol, -ow, eo), P(-ol, -ow, eo), P(-ol, 0, r + 0.05), P(ol, 0, r + 0.05), nB, [[0, 0], [2 * ol, 0], [2 * ol, slope + o], [0, slope + o]], 1);
}

function material(env) {
  return new THREE.ShaderMaterial({
    uniforms: env.u,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 aUv; attribute vec4 aInfo;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vN; varying float vDist; varying vec2 vXZ;
      void main(){ vUv = aUv; vInfo = aInfo; vN = normal; vXZ = position.xz; vec4 mv = viewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uGlow, uOvercast, uShadowOn; uniform sampler2D uShadow; uniform vec4 uShadowRect;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vN; varying float vDist; varying vec2 vXZ;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec3 N = normalize(vN);
        float kind = vInfo.x, eaveH = vInfo.y, seed = vInfo.z, roof = vInfo.w;
        vec3 col;
        float glow = 0.0;
        if (roof > 0.5) {
          col = vec3(0.95, 0.96, 0.99);
          float fascia = 1.0 - step(0.35, vUv.y);
          col = mix(col, vec3(0.28, 0.2, 0.16), fascia);
        } else {
          vec3 wood = mix(vec3(0.46, 0.3, 0.18), vec3(0.6, 0.4, 0.24), h1(seed * 91.0));
          vec3 stone = mix(vec3(0.55, 0.53, 0.5), vec3(0.66, 0.63, 0.58), h1(seed * 17.0));
          vec3 plaster = mix(vec3(0.86, 0.8, 0.7), vec3(0.93, 0.88, 0.8), h1(seed * 53.0));
          if (kind < 0.5) col = vUv.y < 2.8 ? stone : wood;                          // chalet
          else if (kind < 1.5) {                                                    // big block: plaster or Savoy stone-and-wood, wooden balcony bands
            col = h1(seed * 7.0) < 0.5 ? plaster : (vUv.y < 3.0 ? stone : wood);
            float band = fract((vUv.y - 0.2) / 2.9);
            if (vUv.y > 3.0 && band < 0.16) col = wood * 0.9;
          } else if (kind < 2.5) col = vec3(0.93, 0.92, 0.88);                      // chapel
          else col = wood * 0.85;                                                   // hut / shed
          // windows
          float fu = fract(vUv.x / 2.6), fv = fract((vUv.y - 0.6) / 2.9);
          float floorIx = floor((vUv.y - 0.6) / 2.9);
          float winFade = 1.0 - smoothstep(180.0, 420.0, vDist);       // far away the window rows would shimmer: the wall takes their average tone
          col = mix(col, col * 0.78, (1.0 - winFade) * step(0.9, vUv.y) * step(kind, 2.5) * 0.6);
          float win = winFade * step(0.32, fu) * step(fu, 0.7) * step(0.3, fv) * step(fv, 0.78) * step(0.9, vUv.y) * step(vUv.y, eaveH - 0.6) * step(kind, 2.5);
          float on = step(0.45, h1(floor(vUv.x / 2.6) * 7.3 + floorIx * 3.1 + seed * 13.0));
          col = mix(col, vec3(0.2, 0.24, 0.3), win);
          glow = win * on * uGlow;
        }
        float lit = smoothstep(-0.1, 0.6, dot(N, uSunDir)) * mix(1.0, texture2D(uShadow, (vXZ - uShadowRect.xy) / uShadowRect.zw).r, uShadowOn);
        lit = mix(lit, floor(lit * 3.0 + 0.5) / 3.0, 0.3);
        vec3 amb = mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y);
        vec3 c = col * (amb * 0.62 + uSunColor * lit * 0.82) + glow * vec3(1.0, 0.72, 0.36) * 0.9;
        float f = 1.0 - exp(-pow(uFogDensity * vDist, 2.0));
        float aerial = (1.0 - exp(-vDist * 0.000045)) * 0.38;
        gl_FragColor = vec4(mix(c, uFogColor, clamp(max(f, aerial), 0.0, 1.0)), 1.0);
      }`,
  });
}

export function createVillage({ scene, rows, env }) {
  const cells = new Map();
  rows.forEach((row, i) => {
    const k = Math.floor(row[0] / CELL) + ',' + Math.floor(row[1] / CELL);
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = { pos: [], nrm: [], uv: [], info: [], cx: (Math.floor(row[0] / CELL) + 0.5) * CELL, cz: (Math.floor(row[1] / CELL) + 0.5) * CELL }));
    addBuilding(cell, row, (i * 0.618034) % 1);
  });
  const mat = material(env);
  const group = new THREE.Group();
  group.name = 'ski-village';
  const meshes = [];
  for (const cell of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cell.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cell.nrm, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(cell.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(cell.info, 4));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.userData.c = [cell.cx, cell.cz];
    group.add(m);
    meshes.push(m);
  }
  scene.add(group);
  return {
    group, count: rows.length,
    update(px, pz, radius) { for (const m of meshes) m.visible = Math.hypot(m.userData.c[0] - px, m.userData.c[1] - pz) < radius + CELL * 0.71; },
  };
}
