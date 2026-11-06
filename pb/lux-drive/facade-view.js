/* The real façades in the scene (houses17): the atlases of the façade area are streamed with the car.  A pack (the walls and roofs
 * of one 256 m cell, one WebP page) is fetched when the car comes within LOAD_RADIUS of its cell and thrown away - mesh,
 * texture and GPU memory - beyond UNLOAD_RADIUS, so the iPad only ever holds the few pages around the car.  One draw call
 * per page.  Low quality draws no photos (the painted walls in the measured colours stay).  Everywhere outside the area
 * nothing changes: the index only knows the area. */
import { buildFacadePack, parseFacadeIndex } from './facade-data.js';
import { createFacadeMaterial } from './facade-material.js';

const THREE = window.THREE;
const LOAD_RADIUS = 420;        // m from the middle of a pack's cell: the photos are there before the car is near (the cell edge is ~240 m away)
const UNLOAD_RADIUS = 560;      // m: hysteresis, a car driving along the border does not reload the same pack
const ANISOTROPY = 4;           // the walls are seen at a grazing angle down a street: without it the façades blur to mush
const BYTES_PER_TEXEL = 4 * 4 / 3;   // RGBA8 plus the mip chain

/** The façade index (null when the game has none: the façade data is optional). */
export async function loadFacadeIndex(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`facades: ${url}: HTTP ${res.status}`);
  return parseFacadeIndex(await res.json());
}

export function createFacadeView({ scene, index, baseUrl, buildings, field, env, renderer, quality, hidden = null }) {
  const group = new THREE.Group();
  group.name = 'luxdrive-facades';
  scene.add(group);
  const heightAt = (x, z) => field.height(x, z);
  const landAt = (x, z) => field.baseHeight(x, z);
  const anisotropy = Math.min(ANISOTROPY, renderer.capabilities.getMaxAnisotropy());
  const live = new Map();          // pack key -> { token, meshes, textures, bytes, state }
  const stats = { packs: index.packs.length, live: 0, pending: 0, failed: 0, walls: 0, gpuBytes: 0 };
  let token = 0;

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error(`facades: could not load ${url}`)));
    });
  }

  async function load(pack, entry) {
    const textures = await Promise.all(pack.pages.map((pg) => loadTexture(new URL(pg.file, baseUrl).href)));
    if (live.get(pack.key) !== entry) { for (const t of textures) t.dispose(); return; }        // unloaded while it was on the way
    const built = buildFacadePack(pack, buildings, heightAt, landAt, hidden);
    textures.forEach((tex, k) => {
      tex.colorSpace = THREE.NoColorSpace;              // the game shades in display space (the painted look): the photo is used as it is
      tex.anisotropy = anisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
      const page = built.pages[k];
      if (!page.idx.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(page.pos, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(page.nor, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(page.uv, 2));
      geometry.setIndex(page.idx);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, createFacadeMaterial(env, tex));
      mesh.name = `facades ${pack.key}/${k}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      entry.meshes.push(mesh);
    });
    entry.textures = textures;
    entry.bytes = pack.pages.reduce((s, pg) => s + pg.w * pg.h * BYTES_PER_TEXEL, 0);
    entry.walls = built.drawn;
    entry.state = 'ready';
  }

  function unload(key) {
    const entry = live.get(key);
    live.delete(key);
    if (!entry) return;
    for (const m of entry.meshes) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const t of entry.textures) t.dispose();
  }

  /** Loads the packs near (px, pz), drops the far ones. */
  function update(px, pz) {
    const enabled = quality.id !== 'low';
    for (const pack of index.packs) {
      const d = Math.hypot(pack.centre[0] - px, pack.centre[1] - pz);
      const has = live.has(pack.key);
      if (has && (!enabled || d > UNLOAD_RADIUS)) unload(pack.key);
      else if (!has && enabled && d < LOAD_RADIUS) {
        const entry = { token: ++token, meshes: [], textures: [], bytes: 0, walls: 0, state: 'loading' };
        live.set(pack.key, entry);
        load(pack, entry).catch((error) => {
          // a pack that does not load leaves the painted walls in place: the game goes on, the reason goes to the console
          console.error(`[luxdrive] façade pack ${pack.key} failed`, error);
          if (live.get(pack.key) === entry) entry.state = 'failed';
        });
      }
    }
    let pending = 0, failed = 0, walls = 0, bytes = 0;
    for (const e of live.values()) {
      if (e.state === 'loading') pending += 1;
      else if (e.state === 'failed') failed += 1;
      walls += e.walls; bytes += e.bytes;
    }
    stats.live = live.size; stats.pending = pending; stats.failed = failed; stats.walls = walls; stats.gpuBytes = Math.round(bytes);
    return stats;
  }

  function dispose() {
    for (const key of [...live.keys()]) unload(key);
    scene.remove(group);
  }

  return { group, update, dispose, stats };
}
