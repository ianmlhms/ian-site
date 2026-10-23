/* Seat anchors for the rideable models (models/*.js call these; THREE comes from the page global, nothing here runs in the node harness).
 *
 *   ud.rideSeat = { count, preferred, frame(i, out) }     out = { position, forward, up } (THREE.Vector3, world space), filled from the model's CURRENT animated pose
 * `attachSeats` hangs one invisible Object3D per seat inside an animated part group (model-space rest position + facing yaw; the part's pivot is subtracted),
 * so the camera follows exactly what the part meshes do. Analytic models (towers: CPU skinned seats, pure functions of the phase) build their own `frame`. */

/** world frame of an Object3D whose +z is the rider's forward and +y the rider's up */
export function frameOfObject(obj, out) {
  obj.updateWorldMatrix(true, false);
  const e = obj.matrixWorld.elements;
  out.position.set(e[12], e[13], e[14]);
  out.forward.set(e[8], e[9], e[10]).normalize();
  out.up.set(e[4], e[5], e[6]).normalize();
  return out;
}

/** model-space seat list for one part: [{ p: [x, y, z] eye position at rest, yaw: heading (forward = (sin yaw, 0, cos yaw)) }] */
export function attachSeats(group, partName, seats, preferred = 0) {
  const T = globalThis.THREE;
  const part = group.userData.parts[partName];
  if (!part) throw new Error(`[fouer] no part "${partName}" for the seats of ${group.name}`);
  const pivot = part.userData.pivot || [0, 0, 0];
  const anchors = seats.map(seat => {
    const o = new T.Object3D(); o.name = "seat";
    o.position.set(seat.p[0] - pivot[0], seat.p[1] - pivot[1], seat.p[2] - pivot[2]);
    o.rotation.y = seat.yaw || 0;
    part.add(o);
    return o;
  });
  const rideSeat = { count: anchors.length, preferred, anchors, frame: (i, out) => frameOfObject(anchors[i % anchors.length], out) };
  group.userData.rideSeat = rideSeat;
  return rideSeat;
}

/** heading (yaw) whose forward (sin yaw, 0, cos yaw) equals the tangent of a circle at angle a travelling in the direction of increasing a */
export const tangentYaw = a => Math.PI / 2 + a;
/** point of a circle: angle a (0 = +z, increasing towards +x) */
export const onCircle = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
