/* The built things of the world (bridge decks, tunnel portals) in CHUNKS instead of one mesh for the whole country.
 *
 * One mesh over 16 km can never be culled: the 68 000 triangles of every bridge in the commune were drawn in every frame, even
 * with the nearest bridge a kilometre behind the car.  Here every thing goes into the chunk of its own 512 m cell, each chunk is
 * its own mesh with its own bounding sphere (the frustum culls it), and `update(x, z, radius)` hides the chunks beyond a
 * distance (the quality level).  Nothing is built per frame: the chunks are made once, at the start. */
import { FlatBuilder } from './flat-builder.js';

const THREE = window.THREE;
const CELL = 1024;                         // m: the size of a chunk (a bridge or a portal is small: fewer, bigger chunks keep the draw calls down)

/**
 * @param {{ scene, material, name: string, makeBuilder?: () => FlatBuilder }} options (makeBuilder: a builder with more attributes, e.g. the walls')
 * @returns {{ builderAt(x, z): FlatBuilder, finish(): void, update(x, z, radius): number, meshes: THREE.Mesh[] }}
 */
export function createChunkedFlat({ scene, material, name, makeBuilder = () => new FlatBuilder() }) {
  const builders = new Map();
  const meshes = [];
  const key = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
  let finished = false;
  return {
    meshes,
    /** The builder of the chunk that holds the point (x, z): everything of one deck / portal goes to the same builder. */
    builderAt(x, z) {
      if (finished) throw new Error(`${name}: the chunks are already built`);
      const k = key(x, z);
      let b = builders.get(k);
      if (!b) { b = makeBuilder(); builders.set(k, b); }
      return b;
    },
    /** Turns every builder into a mesh. */
    finish() {
      finished = true;
      for (const [k, b] of builders) {
        if (b.count === 0) continue;
        const mesh = new THREE.Mesh(b.build(), material);
        mesh.name = `${name} ${k}`;
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        meshes.push(mesh);
      }
    },
    /** Hides the chunks whose bounding sphere is farther than `radius` from (x, z). Returns the number that stay visible. */
    update(x, z, radius) {
      let shown = 0;
      for (const mesh of meshes) {
        const s = mesh.geometry.boundingSphere;
        const near = Math.hypot(s.center.x - x, s.center.z - z) - s.radius < radius;
        mesh.visible = near;
        if (near) shown += 1;
      }
      return shown;
    },
  };
}
