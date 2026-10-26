/* Draws the built places: one mesh per 192 m cell (town-model.js), shown within a reach that depends on the quality level (the fog hides the rest). One shared material. */
import { buildTownCells } from './town-model.js';
import { createTownMaterial } from './town-material.js';

const THREE = window.THREE;
const REACH = Object.freeze({ low: 300, medium: 520, high: 800 });          // m from the camera to the middle of a cell

export function createTownView({ scene, env, quality, houses }) {
  const group = new THREE.Group();
  group.name = 'mtb-town';
  scene.add(group);
  const material = createTownMaterial(env, quality);
  const cells = [];
  for (const [key, c] of buildTownCells(houses)) {
    const mesh = new THREE.Mesh(c.geometry, material);
    mesh.name = `town ${key}`; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    cells.push({ mesh, centre: c.centre, radius: c.geometry.boundingSphere.radius, count: c.count });
  }
  const stats = { cells: cells.length, visible: 0, triangles: cells.reduce((a, c) => a + c.mesh.geometry.index.count / 3, 0) };
  return {
    group, material, stats, cells,
    update(cx, cz) {
      const reach = REACH[quality.id] || REACH.medium;
      let visible = 0;
      for (const c of cells) {
        const on = Math.hypot(c.centre[0] - cx, c.centre[1] - cz) - c.radius < reach;
        c.mesh.visible = on; if (on) visible++;
      }
      stats.visible = visible;
    },
    dispose() { for (const c of cells) c.mesh.geometry.dispose(); material.dispose(); },
  };
}
