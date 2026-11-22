/* R8f (memory): geometry that is only ever drawn (never read back, never raycast, never changed) keeps its vertex data on the GPU
 * only: three drops the JS copy right after the upload. The village meshes alone held ~107 MB of vertex arrays in JS.
 * A lost WebGL context can't be restored for such a geometry (three would upload it again from the dropped array), so main.js
 * reloads the page instead when released() is true. */
let count = 0;
// tests that read the vertices back (scripts/ski/ground-check.mjs) open the page with ?debug=1&keep=1
const KEEP = (() => { try { const q = new URLSearchParams(location.search); return q.get('debug') === '1' && q.get('keep') === '1'; } catch (error) { return false; } })();

function dropArray() { this.array = null; }        // three calls onUploadCallback on the attribute (this = the attribute)

/** Marks every attribute (and the index) of geometry g to drop its JS array after the upload. Returns g. */
export function gpuOnly(g) {
  if (KEEP) return g;
  for (const a of Object.values(g.attributes)) a.onUpload(dropArray);
  if (g.index) g.index.onUpload(dropArray);
  count++;
  return g;
}

/** The same for a DataTexture that is uploaded once (the far normal map, the forest raster: 3-7 MB each): its pixels go after the
 *  upload (three calls texture.onUpdate then). Returns tex. */
export function textureGpuOnly(tex) {
  if (KEEP) return tex;
  tex.onUpdate = () => { const im = tex.image; if (im && im.data) tex.image = { data: null, width: im.width, height: im.height }; };
  count++;
  return tex;
}

/** True when some geometry lives on the GPU only (a context loss means a reload). */
export const released = () => count > 0;

/** three uploads a geometry only when it is first drawn, so a far village cell would keep its JS copy until the skier comes near:
 *  draws every mesh under `root` once now (culling off, into a 1 x 1 target, a scene of its own: no lights, no shadow pass), so the
 *  gpuOnly() copies go at once. `root` goes back to its parent, visibility and culling as they were. */
export function uploadNow(renderer, root, camera) {
  const THREE = window.THREE;
  if (KEEP || !root) return;
  const parent = root.parent;
  const saved = [];
  root.traverse((o) => { saved.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
  const tmp = new THREE.Scene();
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const before = renderer.getRenderTarget();
  try {
    tmp.add(root);
    renderer.setRenderTarget(target);
    renderer.render(tmp, camera);
  } catch (error) {
    console.warn('[ski] geometry upload failed', error);
  } finally {
    renderer.setRenderTarget(before);
    if (parent) parent.add(root);
    for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
    target.dispose();
  }
}
