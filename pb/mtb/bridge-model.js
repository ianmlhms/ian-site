/* The Schiessentümpel footbridge: a segmental stone arch with parapets and a wooden railing, like the real one over the Black Ernz (a low humpback of dressed
 * sandstone with a rustic fence, steps up from the banks). Built relative to the water surface at the bridge (y = 0): x across the river, z along it.
 * Two geometries: the stone (closed solid whose bottom ring is marked aSkirt, so it always reaches below the banks) and the wooden railing (vertex colours). */
import { Builder, M, V3 } from './geo-builder.js';

const THREE = window.THREE;
const BASE = -2.2;                          // bottom of the solid below the water surface (the skirt goes lower still)

/** p = { span, width, abutment, rise, deck (above the water), endL, endR (bank heights above the water) } */
export function buildBridge(p) {
  const half = p.span / 2 + p.abutment;
  const Sh = p.span / 2 + 0.9;                                  // the flat top reaches this far
  const springing = 0.2, crown = springing + p.rise;
  const R = (p.span * p.span / 4 + p.rise * p.rise) / (2 * p.rise);
  // outline of the solid (x, y), counter-clockwise: bottom-left, up the left end, over the hump, down the right end, bottom-right; hole = the arch
  const shape = new THREE.Shape();
  shape.moveTo(-half, BASE);
  shape.lineTo(-half, Math.max(p.endL, 0.3));
  shape.lineTo(-Sh, p.deck);
  shape.lineTo(Sh, p.deck);
  shape.lineTo(half, Math.max(p.endR, 0.3));
  shape.lineTo(half, BASE);
  shape.lineTo(-half, BASE);
  const hole = new THREE.Path();
  const cy = crown - R, a0 = Math.asin((p.span / 2) / R);
  hole.moveTo(-p.span / 2, BASE + 0.0);
  hole.lineTo(-p.span / 2, springing);
  for (let i = 0; i <= 18; i++) { const a = -a0 + (2 * a0 * i) / 18; hole.lineTo(Math.sin(a) * R, cy + Math.cos(a) * R); }
  hole.lineTo(p.span / 2, BASE);
  hole.lineTo(-p.span / 2, BASE);
  shape.holes.push(hole);
  const extruded = new THREE.ExtrudeGeometry(shape, { depth: p.width, bevelEnabled: false, curveSegments: 10 });
  extruded.translate(0, 0, -p.width / 2);
  const stone = new Builder();
  const sk = [];
  stone.add(extruded, M(0, 0, 0), (v, n) => { const k = 0.8 + 0.3 * Math.abs(Math.sin(v.x * 7.1 + v.y * 3.3)); return [k, k, k]; });
  // parapets: low stone walls on both edges of the deck
  for (const s of [-1, 1]) {
    const wall = new THREE.BoxGeometry(2 * Sh, 0.55, 0.3);
    stone.add(wall, M(0, p.deck + 0.27, s * (p.width / 2 - 0.15)), () => [1, 1, 1]);
    for (const e of [-1, 1]) stone.add(new THREE.BoxGeometry(half - Sh + 0.4, 0.5, 0.3), M(e * (Sh + (half - Sh) / 2 - 0.2), (e < 0 ? Math.max(p.endL, 0.3) : Math.max(p.endR, 0.3)) / 2 + p.deck / 2 + 0.25, s * (p.width / 2 - 0.15), 1, 1, 1, 0, 0, e * Math.atan2(p.deck - (e < 0 ? p.endL : p.endR), half - Sh)), () => [1, 1, 1]);
  }
  const geo = stone.build();
  // skirt: everything at or below the base plane is the bottom of the solid
  const pos = geo.attributes.position, skirt = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) skirt[i] = pos.getY(i) <= BASE + 1e-3 ? 1 : 0;
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));

  // wooden railing: posts and two rails along both edges
  const wood = new Builder();
  const WOOD = [0.34, 0.26, 0.17];
  const col = (k) => () => [WOOD[0] * k, WOOD[1] * k, WOOD[2] * k];
  for (const s of [-1, 1]) {
    const z = s * (p.width / 2 - 0.15);
    const base = p.deck + 0.55;
    const posts = Math.max(2, Math.round(2 * Sh / 1.3));
    for (let i = 0; i <= posts; i++) { const x = -Sh + (2 * Sh * i) / posts; wood.add(new THREE.CylinderGeometry(0.05, 0.055, 0.95, 6), M(x, base + 0.45, z), col(0.9 + 0.2 * ((i * 7) % 3) / 3)); }
    for (const h of [0.35, 0.82]) wood.add(new THREE.CylinderGeometry(0.035, 0.04, 2 * Sh + 0.1, 5).rotateZ(Math.PI / 2), M(0, base + h, z), col(1.0));
    for (let i = 0; i < posts; i++) {                            // crossed branches between the posts, like the rustic fence of the real bridge
      const x0 = -Sh + (2 * Sh * i) / posts, x1 = -Sh + (2 * Sh * (i + 1)) / posts, len = Math.hypot(x1 - x0, 0.47), ang = Math.atan2(0.47, x1 - x0);
      wood.add(new THREE.CylinderGeometry(0.025, 0.03, len, 5).rotateZ(Math.PI / 2), M((x0 + x1) / 2, base + 0.585, z, 1, 1, 1, 0, 0, ang), col(0.9));
      wood.add(new THREE.CylinderGeometry(0.025, 0.03, len, 5).rotateZ(Math.PI / 2), M((x0 + x1) / 2, base + 0.585, z, 1, 1, 1, 0, 0, -ang), col(1.05));
    }
    for (const e of [-1, 1]) {                                  // the rails continue down the approach steps
      const len = (half - Sh) * 0.9, drop = p.deck - (e < 0 ? p.endL : p.endR), ang = Math.atan2(drop, half - Sh);
      for (const h of [0.45, 0.82]) wood.add(new THREE.BoxGeometry(len, 0.07, 0.07), M(e * (Sh + len / 2), base + h - drop * 0.5 * 0.0 - Math.tan(ang) * len / 2, z, 1, 1, 1, 0, 0, e * -ang * -1), col(0.95));
    }
  }
  return { stone: geo, wood: wood.build() };
}
