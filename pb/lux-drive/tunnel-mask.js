/* The terrain inside the shell of a tube is not drawn (tunnels16).
 *
 * The terrain is one height field: at the mouth of a tunnel it rises from the road to the hill over the tube in one lattice cell, and that ramp of grass stood in
 * the open mouth; where the land over a tube lies lower than its roof (the hood of a portal, the underpass under a roundabout) the hill ran through the tube.  So
 * the ground shader of the tiles that touch such a stretch drops every fragment that lies inside the shell (between its outer walls, under its roof, past the face of
 * the portal): there the tube's own walls, roof and headwalls are drawn (tunnel-view.js), so nothing is missing - the mask is a hair smaller than the shell.
 *
 * Only the tiles that touch an exposed stretch get the masked twin of the ground material (a discard costs the early depth test), and the shader tests at most
 * MASK_MAX segments, the nearest to the camera, inside one bounding box. */
import { TUBE, exposedStretches } from './tunnel-tubes.js';

export const MASK_MAX = 24;               // segments in the shader
const SEGMENT = 4;                        // m: the length of one mask segment
const CAP_START = 1, CAP_END = 2;         // the segment ends flat at the face of a portal (the mouth is open there, the road outside is drawn)

const MASK_GLSL = `
  uniform vec4 uTubeA[${MASK_MAX}]; uniform vec4 uTubeB[${MASK_MAX}]; uniform float uTubeN; uniform vec4 uTubeBox;
  bool tubeMasked(vec3 p){
    if (p.x < uTubeBox.x || p.x > uTubeBox.z || p.z < uTubeBox.y || p.z > uTubeBox.w) return false;
    for (int i = 0; i < ${MASK_MAX}; i++){
      if (float(i) >= uTubeN) break;
      vec4 A = uTubeA[i]; vec4 B = uTubeB[i];
      vec2 d = A.zw - A.xy;
      float t = dot(p.xz - A.xy, d) / max(dot(d, d), 1e-6);
      if (t < 0.0 && mod(B.w, 2.0) > 0.5) continue;
      if (t > 1.0 && B.w > 1.5) continue;
      float tc = clamp(t, 0.0, 1.0);
      vec2 q = p.xz - (A.xy + d * tc);
      if (dot(q, q) > B.z * B.z) continue;
      if (p.y < mix(B.x, B.y, tc)) return true;
    }
    return false;
  }
`;

/** The mask segments of the tubes: [{ ax, az, bx, bz, ta, tb, half, caps }] (ta / tb: the top of the shell at each end). */
export function maskSegments(tubes, heightAt) {
  const out = [];
  for (const tube of tubes) {
    const top = (i) => tube.floor[i] + Math.abs(tube.cross[i]) * tube.outerHalf + tube.roofDepth + TUBE.maskLift + 0.02;
    for (const st of exposedStretches(tube, heightAt)) {
      // (a stretch that reaches a face starts exactly at the face, flat)
      const s0 = Math.max(tube.sA, tube.s[st.i0] - 1), s1 = Math.min(tube.sB, tube.s[st.i1] + 1);
      for (let s = s0; s < s1 - 0.01; s += SEGMENT) {
        const e = Math.min(s1, s + SEGMENT);
        const at = (q) => {
          const i = Math.max(0, Math.min(tube.s.length - 2, Math.floor(q))), f = Math.max(0, Math.min(1, q - tube.s[i]));
          return [tube.x[i] + (tube.x[i + 1] - tube.x[i]) * f, tube.z[i] + (tube.z[i + 1] - tube.z[i]) * f, Math.max(top(i), top(i + 1)), i, f];
        };
        const [ax, az, ta] = at(s), [bx, bz, tb] = at(e);
        const caps = (Math.abs(s - tube.sA) < 0.01 ? CAP_START : 0) | (Math.abs(e - tube.sB) < 0.01 ? CAP_END : 0);
        out.push({ ax, az, bx, bz, ta, tb, half: tube.outerHalf - TUBE.maskInset, caps });
      }
    }
  }
  return out;
}

/**
 * The mask: the masked twin of a ground material, which tiles need it, and the per-frame choice of the segments near the camera.
 * Returns { twin(material), needsMask(leaf), update(x, z), segments }.
 */
export function createTubeMask(THREE, tubes, heightAt) {
  const segments = maskSegments(tubes, heightAt);
  const uniforms = {
    uTubeA: { value: Array.from({ length: MASK_MAX }, () => new THREE.Vector4()) },
    uTubeB: { value: Array.from({ length: MASK_MAX }, () => new THREE.Vector4()) },
    uTubeN: { value: 0 },
    uTubeBox: { value: new THREE.Vector4(1, 1, -1, -1) },
  };
  const twins = new Map();
  /** The masked twin of a ground material (made once per material; its uniforms are the same objects, so the env and the quality reach it). */
  function twin(material) {
    if (!segments.length) return material;
    let t = twins.get(material);
    if (t) return t;
    const fs = material.fragmentShader;
    const at = fs.indexOf('void main(){');
    if (at < 0) throw new Error('tunnel-mask: the ground shader has no main()');
    const body = `${fs.slice(0, at)}${MASK_GLSL}\n  void main(){\n    if (tubeMasked(vWorld)) discard;${fs.slice(at + 'void main(){'.length)}`;
    t = new THREE.ShaderMaterial({ uniforms: { ...material.uniforms, ...uniforms }, vertexShader: material.vertexShader, fragmentShader: body, side: material.side });
    twins.set(material, t);
    return t;
  }
  /** Does the tile (leaf: x0, z0, size) touch a mask segment? */
  function needsMask(leaf) {
    return segments.some((g) => {
      const r = g.half + 1;
      return Math.max(g.ax, g.bx) + r >= leaf.x0 && Math.min(g.ax, g.bx) - r <= leaf.x0 + leaf.size && Math.max(g.az, g.bz) + r >= leaf.z0 && Math.min(g.az, g.bz) - r <= leaf.z0 + leaf.size;
    });
  }
  /** The MASK_MAX segments nearest to (x, z) into the uniforms. */
  function update(x, z) {
    if (!segments.length) return 0;
    const near = segments.map((g) => [Math.hypot((g.ax + g.bx) / 2 - x, (g.az + g.bz) / 2 - z), g]).sort((p, q) => p[0] - q[0]).slice(0, MASK_MAX);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    near.forEach(([, g], k) => {
      uniforms.uTubeA.value[k].set(g.ax, g.az, g.bx, g.bz);
      uniforms.uTubeB.value[k].set(g.ta, g.tb, g.half, g.caps);
      x0 = Math.min(x0, g.ax - g.half, g.bx - g.half); x1 = Math.max(x1, g.ax + g.half, g.bx + g.half);
      z0 = Math.min(z0, g.az - g.half, g.bz - g.half); z1 = Math.max(z1, g.az + g.half, g.bz + g.half);
    });
    uniforms.uTubeN.value = near.length;
    uniforms.uTubeBox.value.set(x0, z0, x1, z1);
    return near.length;
  }
  return { twin, needsMask, update, segments };
}
