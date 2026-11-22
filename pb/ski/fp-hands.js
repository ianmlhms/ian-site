/* R8c (QA: in first person the poles floated without hands): the skier's own hands in the first-person view. A padded glove closed
 * round each pole grip (fist, thumb over the knuckles, a cuff) and the jacket sleeve from the cuff back to below the bottom edge of the
 * picture, so the poles are held. Camera space (firstperson.js: x right, y up, -z ahead); grip = where the pole's grip sits.
 *   handParts(side, grip, colours) -> [[BufferGeometry, hex], ...]   (side -1 left, +1 right) */
const THREE = window.THREE;

export const HAND_COLOURS = Object.freeze({ glove: 0x23262b, cuff: 0x3a3f48, sleeve: 0xb8322b, sleeveDark: 0x7f221d });

/** A cylinder from a to b (radius r0 at a, r1 at b). */
function limb(a, b, r0, r1, seg = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a[0], a[1], a[2]);
  return g;
}

export function handParts(side, grip, colours = HAND_COLOURS) {
  const [gx, gy, gz] = grip;
  const out = [];
  // the fist round the grip: a padded ellipsoid, the knuckle roll in front, the thumb over it, a cuff
  const fist = new THREE.SphereGeometry(0.048, 12, 8); fist.scale(0.9, 1.08, 1.2); fist.translate(gx, gy + 0.012, gz + 0.008); out.push([fist, colours.glove]);
  const fingers = new THREE.CylinderGeometry(0.024, 0.024, 0.078, 10); fingers.rotateZ(Math.PI / 2); fingers.translate(gx, gy + 0.01, gz - 0.036); out.push([fingers, colours.glove]);
  const thumb = new THREE.CylinderGeometry(0.014, 0.012, 0.05, 8); thumb.rotateX(Math.PI / 2 - 0.4); thumb.rotateY(side * 0.45); thumb.translate(gx - side * 0.026, gy + 0.05, gz - 0.02); out.push([thumb, colours.glove]);
  // the cuff and the sleeve, down and a little back towards the camera, out of the bottom of the picture (the elbow is off screen; the
  // sleeve stays > 0.3 m in front of the camera: the near plane)
  const wrist = [gx + side * 0.008, gy - 0.035, gz + 0.05];
  const cuffEnd = [gx + side * 0.02, gy - 0.1, gz + 0.1];
  const elbow = [gx + side * 0.1, gy - 0.44, gz + 0.19];
  out.push([limb(wrist, cuffEnd, 0.04, 0.046), colours.cuff]);
  out.push([limb(cuffEnd, elbow, 0.053, 0.068), colours.sleeve]);
  out.push([limb(cuffEnd, [cuffEnd[0] + side * 0.003, cuffEnd[1] - 0.02, cuffEnd[2] + 0.012], 0.055, 0.056), colours.sleeveDark]);
  return out;
}
