/* R8d: driver body: the memory after putting the skier down at village centre number window.__memI (-1 = just the readout): JS heap,
 * three's geometries / textures, the bytes of the scene's vertex attributes (JS side). One spot per call (a job may be killed). */
const S = window.__ski;
const rid = new URLSearchParams(location.search).get('resort');
const r = await (await fetch(`/pb/ski/data/${rid}/resort.json`)).json();
const spots = (r.places || []).filter((p) => /village|town/.test(p.kind) && p.x > 0 && p.z > 0 && p.x < S.field.width && p.z < S.field.depth);
const i = window.__memI;
if (i >= 0 && spots[i]) await window.__r8.spot(spots[i].x, spots[i].z, 0);
let bytes = 0, objs = 0;
const by = {};
S.scene.traverse((o) => {
  objs++;
  if (!o.geometry || !o.geometry.attributes) return;
  let b = 0;
  for (const a of Object.values(o.geometry.attributes)) b += a.array ? a.array.byteLength : 0;
  if (o.geometry.index) b += o.geometry.index.array.byteLength;
  bytes += b;
  let k = o.name || (o.parent && o.parent.name) || 'scene'; k = k.replace(/[-_ :]?[\d.,:]+$/, '').replace(/^tile.*/, 'tile');
  by[k] = (by[k] || 0) + b;
});
const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(v / 1048576)}`).join(', ');
return { at: i >= 0 && spots[i] ? spots[i].name.slice(0, 18) : 'now', n: spots.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, geo: S.renderer.info.memory.geometries, tex: S.renderer.info.memory.textures, objs, attrMB: Math.round(bytes / 1048576), top };
