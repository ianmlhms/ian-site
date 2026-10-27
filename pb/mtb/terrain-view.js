/* Terrain tiles in the scene: selects the quadtree around the rider, builds the vertex data with the pure tile builder (tile-mesh.js) and keeps one
 * THREE.Mesh per tile. A tile is rebuilt only when its stitching changes (a neighbour got finer / coarser), never just because the rider moved. */
import { selectTiles } from './quadtree.js';
import { computeTileNodes, buildTileMesh, stitchSignature } from './tile-mesh.js';

const THREE = window.THREE;
const RESELECT_DISTANCE = 4;          // m the rider moves before the tile set is re-evaluated
const CACHE_LIMIT = 700;
const TILE_BUDGET_MS = 2;             // wall-clock ms per frame spent building terrain tiles (at least one tile per frame, even if it takes longer)

export function createTerrainView({ scene, surface, field, material: initialMaterial, quality }) {
  let material = initialMaterial;
  const group = new THREE.Group();
  group.name = 'mtb-terrain';
  scene.add(group);
  const nodeCache = new Map();              // tile key -> { nodes, lastUsed }
  const tiles = new Map();                  // tile key -> { mesh, signature, leaf }
  let split = null;
  let queue = [];                           // leaves waiting for a (re)build, missing tiles first
  const sigCache = new Map();               // leaf key -> stitch signature, valid for the current split set (only leaves next to a changed node are recomputed: the full scan cost 45-75 ms every ~4 m of riding)
  let last = { x: 1e9, z: 1e9 };
  let frame = 0;
  let lastScale = quality.lodScale;
  const stats = { leaves: 0, built: 0, rebuilt: 0, pending: 0 };

  function makeGeometry(mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('aCover', new THREE.BufferAttribute(mesh.cover, 1));
    g.setAttribute('aStream', new THREE.BufferAttribute(mesh.stream, 1));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) { const y = mesh.positions[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
    const s = mesh.size;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, lo, 0), new THREE.Vector3(s, hi, s));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s / 2, (lo + hi) / 2, s / 2), Math.hypot(s / 2, s / 2, (hi - lo) / 2));
    return g;
  }

  /** Boxes of the quadtree nodes whose split state differs between two selections (null = everything changed). */
  function changedBoxes(prev, next) {
    if (!prev) return null;
    const boxes = [];
    const add = (key) => { const [size, x0, z0] = key.split(':').map(Number); boxes.push([x0 - 1e-3, z0 - 1e-3, x0 + size + 1e-3, z0 + size + 1e-3]); };
    for (const k of next) if (!prev.has(k)) add(k);
    for (const k of prev) if (!next.has(k)) add(k);
    return boxes;
  }
  const touches = (boxes, l) => boxes.some((b) => l.x0 <= b[2] && l.x0 + l.size >= b[0] && l.z0 <= b[3] && l.z0 + l.size >= b[1]);

  function nodesFor(leaf) {
    let n = nodeCache.get(leaf.key);
    if (!n) { n = { nodes: computeTileNodes(leaf, surface, field), lastUsed: frame }; nodeCache.set(leaf.key, n); }
    n.lastUsed = frame;
    return n.nodes;
  }

  /** Builds (or rebuilds) one queued leaf into its mesh. */
  function buildLeaf(leaf, have) {
    const data = buildTileMesh(leaf, nodesFor(leaf), split, field);
    const geometry = makeGeometry(data);
    if (have) { have.mesh.geometry.dispose(); have.mesh.geometry = geometry; have.signature = data.signature; stats.rebuilt++; return; }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(leaf.x0, 0, leaf.z0);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = `tile ${leaf.key}`;
    group.add(mesh);
    tiles.set(leaf.key, { mesh, signature: data.signature, leaf });
    stats.built++;
  }

  /** Re-selects the tiles when the rider has moved RESELECT_DISTANCE and queues what is missing (nearest first) or stitched wrong (a sub-pixel seam behind the skirts, so after the missing ones);
   *  every call then builds from the queue for at most `budgetMs` of wall-clock time (always at least one tile), so a tile build never stacks into one long frame. */
  function update(px, pz, budgetMs = TILE_BUDGET_MS) {
    frame += 1;
    if (Math.hypot(px - last.x, pz - last.z) > RESELECT_DISTANCE || lastScale !== quality.lodScale) {
      lastScale = quality.lodScale;
      const sel = selectTiles(px, pz, { previous: split, scale: quality.lodScale, maxDistance: quality.far * 1.45 });
      const dirty = changedBoxes(split, sel.split);
      split = sel.split;
      last = { x: px, z: pz };
      const centre = (l) => Math.hypot(l.x0 + l.size / 2 - px, l.z0 + l.size / 2 - pz);
      sel.leaves.sort((a, b) => centre(a) - centre(b));
      const wanted = new Set(sel.leaves.map((l) => l.key));
      for (const key of sigCache.keys()) if (!wanted.has(key)) sigCache.delete(key);
      for (const [key, t] of tiles) if (!wanted.has(key)) { group.remove(t.mesh); t.mesh.geometry.dispose(); tiles.delete(key); }
      const missing = [], stale = [];
      for (const leaf of sel.leaves) {
        const have = tiles.get(leaf.key);
        let sig = sigCache.get(leaf.key);
        if (sig === undefined || !dirty || touches(dirty, leaf)) { sig = stitchSignature(leaf, split); sigCache.set(leaf.key, sig); }
        if (!have) missing.push(leaf); else if (have.signature !== sig) stale.push(leaf);
      }
      queue = missing.concat(stale);
      stats.leaves = sel.leaves.length;
      if (nodeCache.size > CACHE_LIMIT) for (const [k, v] of nodeCache) if (frame - v.lastUsed > 300) nodeCache.delete(k);
    }
    const t0 = performance.now();
    let qi = 0;
    while (qi < queue.length && (qi === 0 || performance.now() - t0 < budgetMs)) {
      const leaf = queue[qi++];
      buildLeaf(leaf, tiles.get(leaf.key));
    }
    if (qi) queue = queue.slice(qi);
    stats.pending = queue.length;
    return stats;
  }

  /** Builds everything now (loading screen / harness). */
  function buildAll(px, pz) {
    last = { x: 1e9, z: 1e9 };
    update(px, pz, Infinity);
    while (stats.pending > 0) update(px, pz, Infinity);
    last = { x: px, z: pz };
    return stats;
  }

  /** Swaps the ground shader of every tile (the cheaper one for the `low` quality level). */
  function setMaterial(next) { material = next; for (const t of tiles.values()) t.mesh.material = next; }

  return { group, update, buildAll, setMaterial, tiles, stats, dispose() { for (const t of tiles.values()) t.mesh.geometry.dispose(); } };
}
