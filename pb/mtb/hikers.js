/* Hikers on the footpaths: one or two small figures that walk along real OSM paths near the rider (never on the ridden trail), back and forth, with a swinging gait.
 * They are scenery: no collision, no effect on the game. A figure is three meshes (body with hat and backpack, two legs). */
import { Builder, V3, M, tube } from './geo-builder.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const WALK_SPEED = 1.35;
const MIN_PATH = 70;                 // m: shorter paths are not worth walking
const NEAR = 45, FAR = 260;          // a hiker's path must pass between these distances from the rider
const RESELECT_SECONDS = 25;
const JACKETS = ['#d6402d', '#e8b92e', '#2f7bd0', '#3a9d59'];

const VERTEX = `
  attribute vec3 color; varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vC = color; vWorld = wp.xyz; vec4 mv = viewMatrix * wp; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }
`;
const FRAGMENT = `
  precision highp float; varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  void main(){ vec3 c = paintLightW(vC, normalize(vN), mix(1.0, 0.8, uCloud * 0.6), 0.95, vWorld); gl_FragColor = vec4(applyFogW(pow(c, vec3(0.97)), vDist, vWorld.y), 1.0); }
`;

function capsule(b, len, r0, r1, color, sx = 1, sz = 1) {
  const t = tube([V3(0, -r0 * 0.5, 0), V3(0, 0, 0), V3(0, len, 0), V3(0, len + r1 * 0.5, 0)], [r0 * 0.3, r0, r1, r1 * 0.3], 7, false);
  for (let i = 0; i < t.pos.length; i += 3) { t.pos[i] *= sx; t.pos[i + 2] *= sz; }
  b.addArrays(t.pos, t.nor, t.idx, () => color);
}
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

export function createHikers({ scene, env, surface, paths }) {
  const material = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide });
  const lengths = paths.map((p) => { let L = 0; for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]); return L; });
  const candidates = paths.map((p, i) => i).filter((i) => lengths[i] >= MIN_PATH);
  function figure(jacket) {
    const root = new THREE.Group(); scene.add(root);
    const body = new Builder();
    capsule(body, 0.55, 0.12, 0.13, rgb(jacket), 0.8, 1.35);
    body.add(new THREE.SphereGeometry(0.1, 10, 8), M(0, 0.78, 0), () => rgb('#d9a67f'));
    body.add(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 12), M(0, 0.88, 0), () => rgb('#6b5a3c'));          // hat brim
    body.add(new THREE.CylinderGeometry(0.09, 0.1, 0.09, 10), M(0, 0.92, 0), () => rgb('#6b5a3c'));
    body.add(new THREE.BoxGeometry(0.2, 0.42, 0.3), M(-0.17, 0.32, 0), () => rgb('#444d58'));                   // backpack
    body.add(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5), M(0.18, 0.5, 0.24, 1, 1, 1, 0, 0.14, 0), () => rgb('#b9bcc0'));   // pole
    const bodyMesh = new THREE.Mesh(body.build(), material); bodyMesh.position.y = 0.82; bodyMesh.frustumCulled = false; root.add(bodyMesh);
    const legGeo = (() => { const b = new Builder(); capsule(b, 0.7, 0.07, 0.055, rgb('#4a4f3c'), 1, 1); return b.build(); })();
    const legs = [new THREE.Group(), new THREE.Group()];
    legs.forEach((g, i) => { g.position.set(0, 0.86, i === 0 ? -0.09 : 0.09); const m = new THREE.Mesh(legGeo, material); m.rotation.z = Math.PI; m.frustumCulled = false; g.add(m); root.add(g); });
    root.visible = false;
    return { root, legs, bodyMesh, path: -1, s: 0, dir: 1 };
  }
  const hikers = [figure(JACKETS[0]), figure(JACKETS[2])];
  let timer = RESELECT_SECONDS;
  let time = 0;

  const pointAt = (path, s, out) => {
    const pts = paths[path].pts;
    let rest = s;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (rest <= seg || i === pts.length - 1) { const t = seg > 0 ? Math.min(1, rest / seg) : 0; out.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t; out.z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t; out.yaw = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]); return out; }
      rest -= seg;
    }
    return out;
  };
  const tmp = { x: 0, z: 0, yaw: 0 };

  function select(rx, rz, avoid) {
    const taken = new Set(hikers.map((h) => h.path));
    const scored = [];
    for (const i of candidates) {
      if (taken.has(i) || avoid(i)) continue;
      const pts = paths[i].pts, mid = pts[Math.floor(pts.length / 2)];
      const d = Math.hypot(mid[0] - rx, mid[1] - rz);
      if (d > NEAR && d < FAR) scored.push([d, i]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    return scored.map((x) => x[1]);
  }

  return {
    hikers,
    update(dt, rx, rz) {
      time += dt; timer += dt;
      const day = env.state.night < 0.5 && env.state.rain < 0.6;
      if (timer >= RESELECT_SECONDS) {
        timer = 0;
        const options = select(rx, rz, () => false);
        for (const h of hikers) {
          const mid = h.path >= 0 ? paths[h.path].pts[Math.floor(paths[h.path].pts.length / 2)] : null;
          const far = !mid || Math.hypot(mid[0] - rx, mid[1] - rz) > FAR * 1.2;
          if (h.path < 0 || far) { const next = options.shift(); if (next !== undefined) { h.path = next; h.s = lengths[next] * (0.15 + 0.7 * ((next * 0.37) % 1)); h.dir = next % 2 ? 1 : -1; } }
        }
      }
      for (const h of hikers) {
        if (h.path < 0 || !day) { h.root.visible = false; continue; }
        h.s += h.dir * WALK_SPEED * dt;
        if (h.s > lengths[h.path]) { h.s = lengths[h.path]; h.dir = -1; } else if (h.s < 0) { h.s = 0; h.dir = 1; }
        pointAt(h.path, h.s, tmp);
        const y = surface.height(tmp.x, tmp.z);
        const phase = h.s * 2.4;
        h.root.visible = true;
        h.root.position.set(tmp.x, y + Math.abs(Math.sin(phase)) * 0.03, tmp.z);
        h.root.rotation.y = -(tmp.yaw + (h.dir > 0 ? 0 : Math.PI));
        h.legs[0].rotation.z = Math.sin(phase) * 0.55; h.legs[1].rotation.z = -Math.sin(phase) * 0.55;
        h.bodyMesh.rotation.z = -0.08;
      }
    },
  };
}
