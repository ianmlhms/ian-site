/* The terrain inside the shell of a tube is not drawn (tunnels16).
 *
 * The terrain is one height field: at the mouth of a tunnel it rises from the road to the hill over the tube in one lattice cell, and that ramp of grass stood in
 * the open mouth; where the land over a tube lies lower than its roof (the hood of a portal, the underpass under a roundabout) the hill ran through the tube.  So
 * the ground shader of the tiles that touch such a stretch drops every fragment that lies inside the shell (between its outer walls, under its roof, past the face of
 * the portal): there the tube's own walls, roof and headwalls are drawn (tunnel-view.js), so nothing is missing - the mask is a hair smaller than the shell.
 *
 * Only the tiles that touch an exposed stretch get the masked twin of the ground material (a discard costs the early depth test), and the shader tests at most
 * MASK_MAX segments, the nearest to the camera, inside one bounding box. */
import { TUBE, exposedStretches, indexAt } from './tunnel-tubes.js';

export const MASK_MAX = 40;               // segments in the shader
const SEGMENT = 4;                        // m: the length of one mask segment
const OVERLAP = 1.0;                      // m: a segment reaches this far on into its neighbour (the bends), never past a face

const MASK_GLSL = `
  uniform vec4 uTubeA[${MASK_MAX}]; uniform vec4 uTubeB[${MASK_MAX}]; uniform float uTubeN; uniform vec4 uTubeBox;
  bool tubeMasked(vec3 p){
    if (p.x < uTubeBox.x || p.x > uTubeBox.z || p.z < uTubeBox.y || p.z > uTubeBox.w) return false;
    for (int i = 0; i < ${MASK_MAX}; i++){
      if (float(i) >= uTubeN) break;
      vec4 A = uTubeA[i]; vec4 B = uTubeB[i];
      vec2 d = A.zw - A.xy;
      float t = dot(p.xz - A.xy, d) / max(dot(d, d), 1e-6);
      if (t < 0.0 || t > 1.0) continue;
      float tc = t;
      float lat = (d.x * (p.z - A.y) - d.y * (p.x - A.x)) / max(length(d), 1e-6);     // (to the right of the segment: x east, z south)
      if (lat > B.w || -lat > B.z) continue;
      if (p.y < mix(B.x, B.y, tc)) return true;
    }
    return false;
  }
`;

/** The mask segments of the tubes: [{ ax, az, bx, bz, ta, tb, halfL, halfR }] (ta / tb: the top of the shell at each end; halfL / halfR: how far to each side). */
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
          const i = indexAt(tube, q), f = Math.max(0, Math.min(1, (q - tube.s[i]) / Math.max(1e-6, tube.s[i + 1] - tube.s[i])));
          return [tube.x[i] + (tube.x[i + 1] - tube.x[i]) * f, tube.z[i] + (tube.z[i + 1] - tube.z[i]) * f, Math.max(top(i), top(i + 1)), i, f];
        };
        // (every segment ends square; one that does not end at a face reaches OVERLAP m on into the next, so the bends are covered.  A round end reached
        // 7.8 m past the face of the Rocade de Bonnevoie and hid the road in front of its portal)
        const sa = Math.abs(s - tube.sA) < 0.01 ? s : Math.max(tube.sA, s - OVERLAP), se = Math.abs(e - tube.sB) < 0.01 ? e : Math.min(tube.sB, e + OVERLAP);
        const [ax, az, ta] = at(sa), [bx, bz, tb] = at(se);
        out.push({ ax, az, bx, bz, ta, tb, halfL: tube.outerL - TUBE.maskInset, halfR: tube.outerR - TUBE.maskInset });
      }
    }
    out.push(...troughSegments(tube));
  }
  return out;
}

/**
 * The mask segments of the troughs of a tube (tunnel-tubes.js TROUGH): between its walls everything of the terrain under the wall tops is hidden (the gully, the ragged
 * paint, the slopes): the trough's own floor, kerbs and walls are drawn there.  Square segments from the face out to the outer end, never past either.
 */
function troughSegments(tube) {
  const out = [];
  const topAt = (i) => {
    let m = -Infinity;
    for (const j of [i, i + 1]) for (const arr of [tube.wallTopL, tube.wallTopR]) if (j < arr.length && !Number.isNaN(arr[j])) m = Math.max(m, arr[j]);
    return m + 0.05;
  };
  for (const [s0, s1] of [[tube.tA, tube.sA], [tube.sB, tube.tB]]) {
    if (s1 - s0 < 0.5) continue;
    for (let s = s0; s < s1 - 0.01; s += SEGMENT) {
      const e = Math.min(s1, s + SEGMENT);
      const sa = s === s0 ? s : Math.max(s0, s - OVERLAP), se = e === s1 ? e : Math.min(s1, e + OVERLAP);
      const at = (q) => {
        const i = indexAt(tube, q), f = Math.max(0, Math.min(1, (q - tube.s[i]) / Math.max(1e-6, tube.s[i + 1] - tube.s[i])));
        return [tube.x[i] + (tube.x[i + 1] - tube.x[i]) * f, tube.z[i] + (tube.z[i + 1] - tube.z[i]) * f, i];
      };
      const [ax, az, ia] = at(sa), [bx, bz, ib] = at(se);
      let top = -Infinity;
      for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) top = Math.max(top, topAt(i));
      if (!Number.isFinite(top)) continue;
      out.push({ ax, az, bx, bz, ta: top, tb: top, halfL: tube.outerL - TUBE.maskInset, halfR: tube.outerR - TUBE.maskInset });
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
      const r = Math.max(g.halfL, g.halfR) + 1;
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
      uniforms.uTubeB.value[k].set(g.ta, g.tb, g.halfL, g.halfR);
      const r = Math.max(g.halfL, g.halfR);
      x0 = Math.min(x0, g.ax - r, g.bx - r); x1 = Math.max(x1, g.ax + r, g.bx + r);
      z0 = Math.min(z0, g.az - r, g.bz - r); z1 = Math.max(z1, g.az + r, g.bz + r);
    });
    uniforms.uTubeN.value = near.length;
    uniforms.uTubeBox.value.set(x0, z0, x1, z1);
    return near.length;
  }
  return { twin, needsMask, update, segments, uniforms };
}
