/* The buildings in the scene: the LOD2 footprints around the car become one mesh per 256 m cell (one draw call per
 * cell).  The cells are built when the car comes near them and thrown away when it goes away, so the memory of the
 * iPad stays small; the cells are built with a budget per frame, so the game never stops for a city. */
import { buildCellMesh, groupByCell, CELL } from './building-mesh.js';
import { createBuildingMaterial } from './building-material.js';
import { createPartMaterial } from './part-material.js';          // the cheap material of the far cells (city LOD)

const THREE = window.THREE;
const BUILD_BUDGET_MS = 2.5;         // the wall-clock time per frame spent building the cells (at least one per frame)
const CELL_RADIUS = CELL * 0.71;     // m, the half diagonal of a cell (the distance from the middle to its corner)
const WALL_DROP = 2.5;               // m: the walls go this far under the ground (the far cells stand on coarse terrain tiles; nobody sees this part)
const LOD_HYSTERESIS = 40;           // m: a cell changes its material only when it is this much past the border (no flicker at the edge)

export function createBuildingView({ scene, buildings, field, env, noiseTexture, quality }) {
  const group = new THREE.Group();
  group.name = 'luxdrive-buildings';
  scene.add(group);
  const material = createBuildingMaterial(env, noiseTexture, quality);
  // The city LOD.  The cells near the car are painted by the full building shader (the windows, the shutters, the roof tiles:
  // expensive per pixel).  The cells beyond `buildingRadius` use the same mesh with a vertex-colour material: no window bands,
  // a flat painted wall and roof, a fraction of the fragment cost.  That is what lets the city reach ~3x as far on the same
  // frame budget (the old town and Kirchberg stay smooth, and the ground never shows a grey plain where the houses are).
  const cheapMaterial = createPartMaterial(env);
  // the bottom of the walls stands on the ground as the game draws it (the land with the roads carved into it), so a
  // building never hovers; the top of the walls is the height of the eaves above the LAND, the height the bake measured.
  const heightAt = (x, z) => field.height(x, z);
  const landAt = (x, z) => field.baseHeight(x, z);
  const cells = groupByCell(buildings.buildings);
  const live = new Map();                     // the cell key -> the mesh in the scene
  let lastX = 0, lastZ = 0;
  let queue = [];
  const stats = { cells: cells.size, visible: 0, pending: 0, triangles: 0 };

  /** Does the cell at `centre` get the full building shader (near the car) or the cheap one (far)?  `current` adds the hysteresis. */
  function lastDetail(centre, current = null) {
    const d = Math.hypot(centre[0] - lastX, centre[1] - lastZ) - CELL_RADIUS;
    const edge = quality.buildingRadius + (current === null ? 0 : current ? LOD_HYSTERESIS : -LOD_HYSTERESIS);
    return d < edge;
  }

  /** Builds one cell: the mesh of the buildings of that cell. */
  function buildCell(key) {
    const cell = cells.get(key);
    const data = buildCellMesh(cell.ids, buildings.buildings, heightAt, landAt, WALL_DROP);
    if (!data.idx.length) { live.set(key, null); return; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.nor, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.col, 3));
    geometry.setAttribute('aInfo', new THREE.Float32BufferAttribute(data.info, 4));
    geometry.setAttribute('aGeo', new THREE.Float32BufferAttribute(data.geo, 2));
    geometry.setAttribute('aStyle', new THREE.Float32BufferAttribute(data.sty, 2));
    geometry.setIndex(data.idx);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, lastDetail(cell.centre) ? material : cheapMaterial);
    mesh.userData.detailed = mesh.material === material;
    mesh.userData.centre = cell.centre;
    mesh.name = `buildings ${key}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    live.set(key, mesh);
  }

  /** The cells around the car: the ones whose middle is within the reach of the quality level. */
  function wantedCells(px, pz) {
    const reach = quality.buildingFarRadius || quality.buildingRadius;
    const out = [];
    for (const [key, cell] of cells) {
      if (Math.hypot(cell.centre[0] - px, cell.centre[1] - pz) - CELL_RADIUS < reach) out.push([key, cell]);
    }
    out.sort((a, b) => Math.hypot(a[1].centre[0] - px, a[1].centre[1] - pz) - Math.hypot(b[1].centre[0] - px, b[1].centre[1] - pz));
    return out;
  }

  /** Shows the cells around the car and builds the missing ones, at most for the time of the budget. */
  function update(px, pz, budgetMs = BUILD_BUDGET_MS) {
    lastX = px; lastZ = pz;
    const wanted = wantedCells(px, pz);
    const keep = new Set(wanted.map((w) => w[0]));
    for (const [key, mesh] of live) {
      if (keep.has(key)) continue;
      if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
      live.delete(key);
    }
    // the material of the cells that stay: full detail near the car, the cheap one far from it
    for (const mesh of live.values()) {
      if (!mesh) continue;
      const detailed = lastDetail(mesh.userData.centre, mesh.userData.detailed);
      if (detailed !== mesh.userData.detailed) { mesh.userData.detailed = detailed; mesh.material = detailed ? material : cheapMaterial; }
    }
    queue = wanted.filter((w) => !live.has(w[0])).map((w) => w[0]);
    const t0 = performance.now();
    let done = 0;
    while (queue.length && (done === 0 || performance.now() - t0 < budgetMs)) {
      buildCell(queue.shift());
      done += 1;
    }
    stats.visible = live.size;
    stats.detailed = [...live.values()].filter((m) => m && m.userData.detailed).length;
    stats.pending = queue.length;
    return stats;
  }

  /** Builds everything now (the loading screen, the harness). */
  function buildAll(px, pz) {
    update(px, pz, Infinity);
    while (stats.pending > 0) update(px, pz, Infinity);
    return stats;
  }

  function dispose() {
    for (const mesh of live.values()) if (mesh) { group.remove(mesh); mesh.geometry.dispose(); }
    live.clear();
    material.dispose(); cheapMaterial.dispose();
  }

  return { group, material, update, buildAll, dispose, stats, cells };
}
