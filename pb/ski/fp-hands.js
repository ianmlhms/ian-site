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
  // the fist round the grip: palm block, the four fingers as a rounded roll in front, the thumb over them
  const fist = new THREE.BoxGeometry(0.085, 0.1, 0.1); fist.translate(gx, gy + 0.01, gz + 0.012); out.push([fist, colours.glove]);
  const fingers = new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8); fingers.rotateZ(Math.PI / 2); fingers.translate(gx, gy + 0.015, gz - 0.045); out.push([fingers, colours.glove]);
  const thumb = new THREE.BoxGeometry(0.03, 0.03, 0.06); thumb.rotateY(side * 0.5); thumb.translate(gx - side * 0.03, gy + 0.06, gz - 0.025); out.push([thumb, colours.glove]);
  // the cuff and the sleeve, back towards the camera and down out of the picture (the elbow is off screen)
  const wrist = [gx + side * 0.01, gy - 0.02, gz + 0.07];
  const cuffEnd = [gx + side * 0.025, gy - 0.07, gz + 0.16];
  const elbow = [gx + side * 0.09, gy - 0.32, gz + 0.5];
  out.push([limb(wrist, cuffEnd, 0.042, 0.048), colours.cuff]);
  out.push([limb(cuffEnd, elbow, 0.055, 0.07), colours.sleeve]);
  const band = limb([cuffEnd[0], cuffEnd[1], cuffEnd[2]], [cuffEnd[0] + side * 0.004, cuffEnd[1] - 0.012, cuffEnd[2] + 0.025], 0.057, 0.058);
  out.push([band, colours.sleeveDark]);
  return out;
}
