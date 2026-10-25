/* Terrain tiles in the scene: selects the quadtree around the rider, builds the vertex data with the pure tile builder (tile-mesh.js) and keeps one
 * THREE.Mesh per tile. A tile is rebuilt only when its stitching changes (a neighbour got finer / coarser), never just because the rider moved. */
import { QUADTREE } from './config.js';
import { selectTiles } from './quadtree.js';
import { computeTileNodes, buildTileMesh, stitchSignature } from './tile-mesh.js';

const THREE = window.THREE;
const RESELECT_DISTANCE = 4;          // m the rider moves before the tile set is re-evaluated
const CACHE_LIMIT = 700;

export function createTerrainView({ scene, surface, field, material, quality }) {
  const group = new THREE.Group();
  group.name = 'mtb-terrain';
  scene.add(group);
  const nodeCache = new Map();              // tile key -> { nodes, lastUsed }
  const tiles = new Map();                  // tile key -> { mesh, signature, leaf }
  let split = null;
  let last = { x: 1e9, z: 1e9 };
  let frame = 0;
  let lastScale = quality.lodScale;
  const stats = { leaves: 0, built: 0, rebuilt: 0, pending: 0 };

  function makeGeometry(mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('aCover', new THREE.BufferAttribute(mesh.cover, 1));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) { const y = mesh.positions[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
    const s = mesh.size;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, lo, 0), new THREE.Vector3(s, hi, s));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s / 2, (lo + hi) / 2, s / 2), Math.hypot(s / 2, s / 2, (hi - lo) / 2));
    return g;
  }

  function nodesFor(leaf) {
    let n = nodeCache.get(leaf.key);
    if (!n) { n = { nodes: computeTileNodes(leaf, surface, field), lastUsed: frame }; nodeCache.set(leaf.key, n); }
    n.lastUsed = frame;
    return n.nodes;
  }

  /** Re-select the tiles for the rider position; builds at most `budget` meshes now, the rest in the next calls. Returns the stats. */
  function update(px, pz, budget = QUADTREE.maxBuiltPerFrame) {
    frame += 1;
    if (Math.hypot(px - last.x, pz - last.z) <= RESELECT_DISTANCE && stats.pending === 0 && lastScale === quality.lodScale) return stats;
    lastScale = quality.lodScale;
    const sel = selectTiles(px, pz, { previous: split, scale: 1 / quality.lodScale, maxDistance: quality.far * 1.45 });
    split = sel.split;
    last = { x: px, z: pz };
    const centre = (l) => Math.hypot(l.x0 + l.size / 2 - px, l.z0 + l.size / 2 - pz);
    sel.leaves.sort((a, b) => centre(a) - centre(b));
    const wanted = new Set(sel.leaves.map((l) => l.key));
    for (const [key, t] of tiles) if (!wanted.has(key)) { group.remove(t.mesh); t.mesh.geometry.dispose(); tiles.delete(key); }
    let built = 0, pending = 0;
    for (const leaf of sel.leaves) {
      const have = tiles.get(leaf.key);
      const sig = stitchSignature(leaf, split);
      if (have && have.signature === sig) continue;
      if (built >= budget && have) continue;               // a stale stitch is only a skirt-covered sub-pixel seam; a MISSING tile is built first
      if (built >= budget * 4) { pending++; continue; }
      const data = buildTileMesh(leaf, nodesFor(leaf), split, field);
      const geometry = makeGeometry(data);
      if (have) { have.mesh.geometry.dispose(); have.mesh.geometry = geometry; have.signature = data.signature; stats.rebuilt++; }
      else {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(leaf.x0, 0, leaf.z0);
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        mesh.name = `tile ${leaf.key}`;
        group.add(mesh);
        tiles.set(leaf.key, { mesh, signature: data.signature, leaf });
        stats.built++;
      }
      built++;
    }
    stats.leaves = sel.leaves.length; stats.pending = pending;
    if (nodeCache.size > CACHE_LIMIT) for (const [k, v] of nodeCache) if (frame - v.lastUsed > 300) nodeCache.delete(k);
    return stats;
  }

  /** Builds everything now (loading screen / harness). */
  function buildAll(px, pz) {
    last = { x: 1e9, z: 1e9 };
    do { update(px, pz, 1e9); last = { x: 1e9, z: 1e9 }; } while (stats.pending > 0);
    last = { x: px, z: pz };
    return stats;
  }

  return { group, update, buildAll, tiles, stats, dispose() { for (const t of tiles.values()) t.mesh.geometry.dispose(); } };
}
