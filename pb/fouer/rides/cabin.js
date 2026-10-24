/* Schueberfouer Tycoon: the first-person cabin of the Riserad ride.
 *
 * The ridden gondola of the wheel model is hidden (its outside would be all around the camera), so the ride puts this light interior shell on the gondola's anchor:
 * floor with a mat, kick panels, window pillars and mullions, the upper fascia and the roof edge, a bench along the back and one on each side, the safety bar across the
 * front window, the door on the right wall, a small lamp over the front window.  Cabin colours come from the wheel (`ud.gondolaStyle`, the same body / band / roof / trim as the 44 gondolas).
 *
 * Frame: origin = the cabin floor at its middle (the anchor's `position`), +y up, +z = outward (the anchor's `forward`, toward the field), x = the cabin's width.  The shell
 * is placed with the anchor's position and quaternion (the group's yaw only, so it is always upright) every frame, the camera sits at the anchor's `eye`: seated on the back
 * bench, eye 1.2 m above the floor, centred, looking out of the front window.
 * Two meshes (shell + lamp), vertex colours, MeshBasicMaterial (the shell is dimmed by the night factor, the lamp keeps its glow), no frustum culling, double-sided.
 * Pure geometry + THREE objects: no DOM. */

const INNER_X = 0.93, INNER_Z = 0.68;             // the glass planes of the gondola model (models/wheel.js GONDOLA)
const SILL = 0.7, HEAD = 1.7, CEIL = 1.9125;     // window opening from SILL to HEAD, the ceiling (the roof slab's underside)
const WALL = 0.04;
const CHROME = 0xdfe4e8, BASE_DARKEN = 0.62;
/** shade per face direction: the interior has no lights, so the box faces get a fixed brightness (top light, bottom dark) */
const SHADE = { py: 1.0, ny: 0.72, px: 0.86, nx: 0.76, pz: 0.94, nz: 0.72 };

/** look limits inside the cabin (radians): relative to the seat, the head turns about 100 degrees each way, a bit more down than up */
export const CABIN_LOOK = Object.freeze({ yaw: 100 * Math.PI / 180, pitchDown: -48 * Math.PI / 180, pitchUp: 55 * Math.PI / 180 });
/** how dark the shell is at full night (the lamp stays bright) */
const NIGHT_DIM = 0.42;

const scaleHex = (T, hex, k) => { const c = new T.Color(hex); return [Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k)]; };

function boxBuilder(T) {
  const pos = [], col = [];
  const face = (a, b, c, d, rgb) => { for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); col.push(rgb[0], rgb[1], rgb[2]); } };
  /** an axis-aligned box: centre, size, colour (hex) */
  function box(cx, cy, cz, sx, sy, sz, hex) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const c = (k) => scaleHex(T, hex, k);
    face([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], c(SHADE.py));
    face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c(SHADE.ny));
    face([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], c(SHADE.px));
    face([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], c(SHADE.nx));
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c(SHADE.pz));
    face([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], c(SHADE.nz));
  }
  function geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
  return { box, geometry };
}

/** the cabin shell: `style` = { body, band, roof, trim, gold, floor } (hex colours of the wheel's gondolas) */
export function createCabin(T, style) {
  const s = { body: 0x2e8d4f, band: 0xe3b86a, roof: 0xa9c1a0, trim: 0xe07a2c, gold: null, floor: 0x44494d, ...(style ?? {}) };
  const B = boxBuilder(T);
  const { box } = B;
  const mid = (SILL + HEAD) / 2, open = HEAD - SILL;
  const body = s.body, dark = scaleHex(T, body, BASE_DARKEN), darkHex = new T.Color(dark[0], dark[1], dark[2]).getHex();
  const cushion = new T.Color(s.trim).multiplyScalar(0.82).getHex();

  // floor, a mat, a floor pan edge
  box(0, -0.04, 0, 2 * INNER_X + 0.04, 0.08, 2 * INNER_Z + 0.04, s.floor);
  box(0, 0.006, 0.08, 1.3, 0.012, 0.92, darkHex);
  box(0, 0.008, 0.08, 1.1, 0.012, 0.72, s.band);
  // kick panels below the windows (front, back, left, right) with a cream sill rail on top
  box(0, SILL / 2, INNER_Z - WALL / 2, 2 * INNER_X, SILL, WALL, body);
  box(0, SILL / 2, -INNER_Z + WALL / 2, 2 * INNER_X, SILL, WALL, body);
  for (const sx of [-1, 1]) box(sx * (INNER_X - WALL / 2), SILL / 2, 0, WALL, SILL, 2 * INNER_Z, body);
  box(0, SILL + 0.012, INNER_Z - 0.03, 2 * INNER_X, 0.05, 0.08, s.band);
  box(0, SILL + 0.012, -INNER_Z + 0.03, 2 * INNER_X, 0.05, 0.08, s.band);
  for (const sx of [-1, 1]) box(sx * (INNER_X - 0.03), SILL + 0.012, 0, 0.08, 0.05, 2 * INNER_Z, s.band);
  // the upper fascia above the windows, with the roof-edge trim under the ceiling
  const fh = CEIL - HEAD;
  box(0, HEAD + fh / 2, INNER_Z - WALL / 2, 2 * INNER_X, fh, WALL, body);
  box(0, HEAD + fh / 2, -INNER_Z + WALL / 2, 2 * INNER_X, fh, WALL, body);
  for (const sx of [-1, 1]) box(sx * (INNER_X - WALL / 2), HEAD + fh / 2, 0, WALL, fh, 2 * INNER_Z, body);
  box(0, HEAD + 0.015, INNER_Z - 0.03, 2 * INNER_X, 0.04, 0.07, s.trim);
  box(0, HEAD + 0.015, -INNER_Z + 0.03, 2 * INNER_X, 0.04, 0.07, s.trim);
  for (const sx of [-1, 1]) box(sx * (INNER_X - 0.03), HEAD + 0.015, 0, 0.07, 0.04, 2 * INNER_Z, s.trim);
  box(0, CEIL - 0.025, INNER_Z - 0.03, 2 * INNER_X, 0.05, 0.08, s.gold ?? s.band);
  box(0, CEIL - 0.025, -INNER_Z + 0.03, 2 * INNER_X, 0.05, 0.08, s.gold ?? s.band);
  for (const sx of [-1, 1]) box(sx * (INNER_X - 0.03), CEIL - 0.025, 0, 0.08, 0.05, 2 * INNER_Z, s.gold ?? s.band);
  // the roof slab (its underside is the ceiling)
  box(0, CEIL + 0.0625, 0, 2.15, 0.125, 1.675, s.roof);
  if (s.gold) box(0, CEIL + 0.005, 0, 2.2, 0.03, 1.72, s.gold);
  // window pillars: four corners, mullions at x = +-0.45 on the front and the back (none in the middle: the view is free), one in the middle of each side
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * (INNER_X - 0.05), mid, sz * (INNER_Z - 0.05), 0.1, open, 0.1, body);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) box(sx * 0.45, mid, sz * (INNER_Z - 0.03), 0.06, open, 0.05, body);
  for (const sx of [-1, 1]) box(sx * (INNER_X - 0.03), mid, 0, 0.05, open, 0.07, body);
  // benches: one along the back wall (you sit here), a short one on each side wall
  box(0, 0.19, -0.45, 1.76, 0.36, 0.4, darkHex);
  box(0, 0.41, -0.44, 1.76, 0.1, 0.44, cushion);
  box(0, 0.8, -INNER_Z + 0.1, 1.76, 0.5, 0.1, cushion);
  for (const sx of [-1, 1]) {
    box(sx * 0.7, 0.19, 0.12, 0.4, 0.36, 0.66, darkHex);
    box(sx * 0.7, 0.41, 0.12, 0.42, 0.1, 0.68, cushion);
    box(sx * (INNER_X - 0.1), 0.65, 0.12, 0.07, 0.38, 0.68, cushion);
  }
  // the safety bar across the front window (chrome, with two posts) and the door on the right wall (frame, latch, handle)
  box(0, 0.96, 0.52, 1.76, 0.03, 0.03, CHROME);
  for (const sx of [-1, 1]) box(sx * 0.82, (SILL + 0.96) / 2, 0.52, 0.035, 0.96 - SILL, 0.035, CHROME);
  const dx = INNER_X - 0.045;
  for (const z of [-0.26, 0.5]) box(dx, mid, z, 0.05, open, 0.04, s.trim);
  box(dx, HEAD - 0.02, 0.12, 0.05, 0.04, 0.78, s.trim);
  box(dx - 0.015, 1.02, 0.4, 0.04, 0.05, 0.14, CHROME);                             // the door handle
  box(dx - 0.01, 0.9, 0.4, 0.035, 0.1, 0.05, CHROME);                               // the latch
  const shellGeometry = B.geometry();

  // the lamp: a chrome housing under the front fascia, a warm glass dome
  const L = boxBuilder(T);
  const LAMP_Z = INNER_Z - 0.1;                                                    // under the upper fascia of the front window, in the middle: always in the top of the view
  L.box(0, HEAD - 0.012, LAMP_Z, 0.13, 0.024, 0.1, CHROME);
  const housing = L.geometry();
  const dome = new T.SphereGeometry(0.042, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);      // the lower half: the dome hangs down
  dome.translate(0, HEAD - 0.024, LAMP_Z);

  const shellMaterial = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false });
  shellMaterial.name = "fouer-cabin-shell";
  const lampMaterial = new T.MeshBasicMaterial({ color: 0xfff1c4, side: T.DoubleSide, fog: false });
  lampMaterial.name = "fouer-cabin-lamp";
  const group = new T.Group(); group.name = "ride-cabin";
  const shell = new T.Mesh(shellGeometry, shellMaterial); shell.name = "cabin-shell";
  const housingMesh = new T.Mesh(housing, shellMaterial); housingMesh.name = "cabin-lamp-housing";
  const lamp = new T.Mesh(dome, lampMaterial); lamp.name = "cabin-lamp";
  for (const m of [shell, housingMesh, lamp]) { m.frustumCulled = false; m.matrixAutoUpdate = true; group.add(m); }
  group.visible = false;
  const tmp = new T.Color();

  return {
    group,
    meshes: [shell, housingMesh, lamp],
    /** put the shell on the gondola's anchor and light it (night: 0..1) */
    place(anchor, night = 0) {
      group.position.copy(anchor.position); group.quaternion.copy(anchor.quaternion);
      const k = 1 - (1 - NIGHT_DIM) * Math.max(0, Math.min(1, night));
      shellMaterial.color.setScalar(k);
      lampMaterial.color.copy(tmp.set(0xfff1c4).multiplyScalar(0.85 + 0.15 * night));
    },
    show() { group.visible = true; },
    hide() { group.visible = false; },
    dispose() {
      if (group.parent) group.parent.remove(group);
      shellGeometry.dispose(); housing.dispose(); dome.dispose(); shellMaterial.dispose(); lampMaterial.dispose();
    },
  };
}
