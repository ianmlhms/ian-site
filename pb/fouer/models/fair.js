/* Schueberfouer Tycoon, W3: the fair layer = everything that stands on the Glacis (NPC background fair, alley props, the 34 pitches).
 *
 *   const fair = await createFairLayer({ T, root: renderer.gameRoot, pitches, groundY, quality, fieldPoly });
 *   fair.setPitch('P01', { state: 'locked' });                                  // NPC stall + padlock plate "ab * N"
 *   fair.setPitch('P01', { state: 'open' });                                    // empty (W2's pitch marker glows)
 *   fair.setPitch('P01', { state: 'built', item: 'kachel', look: 0, level: 2 }); // a player model (any registered item id)
 *   fair.setNight(k)  fair.update(dt, camera)  fair.stats()  fair.flush()
 *
 * Why a layer: 34 models x 3-4 draw calls would blow the draw budget, so every static mesh of every model is MERGED per shared material into a handful
 * of meshes (batch "pitches"), the NPC fair + props into another (batch "base"), all bulbs into one Points, all steam into one Points.  Rides keep their
 * moving `part:*` groups: the nearest N rides inside the live radius are LIVE (their parts are drawn as separate animated meshes), every other ride is
 * FROZEN (its parts are merged at rest pose into batch "frozen").  Beyond `farDist` a model is rebuilt with `far: true` (no figures, half the segments).
 * W4a's tall models (wheel, towers) use their own materials: they are added as opaque groups and driven through userData.setLOD / setAnimated / animate. */
import { getMaterials } from './materials.js';
import { buildModel, hasModel } from './index.js';
import { ITEM_BY_ID } from '../data.js';
import { buildPitchNpc } from './npc.js';
import { createGlow } from '../world/glow.js';
import { dressPitch } from './clutter.js';

const QUALITY = {
  low: { farDist: 55, live: 6, hyst: 1.15 },
  medium: { farDist: 80, live: 10, hyst: 1.15 },
  high: { farDist: 140, live: 40, hyst: 1.15 },
};
const YAW = { '+w': 0, '-w': Math.PI, '+u': Math.PI / 2, '-u': -Math.PI / 2 };

/* ------------------------------------------------------------------ batching */
function transformInto(dst, off, src, count, m, isNormal) {
  const e = m.elements;
  for (let i = 0; i < count; i++) {
    const x = src[i * 3]; const y = src[i * 3 + 1]; const z = src[i * 3 + 2];
    let X = e[0] * x + e[4] * y + e[8] * z; let Y = e[1] * x + e[5] * y + e[9] * z; let Z = e[2] * x + e[6] * y + e[10] * z;
    if (isNormal) { const l = Math.hypot(X, Y, Z) || 1; X /= l; Y /= l; Z /= l; } else { X += e[12]; Y += e[13]; Z += e[14]; }
    dst[(off + i) * 3] = X; dst[(off + i) * 3 + 1] = Y; dst[(off + i) * 3 + 2] = Z;
  }
}
function mergeEntries(T, entries) {
  let nv = 0; const sizes = new Map();
  entries.forEach((e) => { const a = e.geo.attributes; nv += a.position.count; for (const k of Object.keys(a)) sizes.set(k, a[k].itemSize); });
  const out = {}; sizes.forEach((size, k) => { out[k] = new Float32Array(nv * size); });
  let off = 0;
  entries.forEach((e) => {
    const a = e.geo.attributes; const n = a.position.count;
    transformInto(out.position, off, a.position.array, n, e.m, false);
    if (out.normal && a.normal) transformInto(out.normal, off, a.normal.array, n, e.m, true);
    for (const k of Object.keys(a)) { if (k === 'position' || k === 'normal') continue; out[k].set(a[k].array, off * a[k].itemSize); }
    off += n;
  });
  const geo = new T.BufferGeometry();
  sizes.forEach((size, k) => geo.setAttribute(k, new T.BufferAttribute(out[k], size)));
  geo.computeBoundingSphere();
  return geo;
}

class Batch {
  constructor(T, M, name) { this.T = T; this.M = M; this.name = name; this.group = new T.Group(); this.group.name = 'fouer-batch-' + name; this.tris = 0; this.objects = 0; }
  /** rebuild from a list of mesh / points objects whose matrixWorld is final */
  build(objs) {
    const { T, M } = this; this.clear();
    const byMat = new Map();
    objs.forEach((o) => { const k = o.material; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push({ geo: o.geometry, m: o.matrixWorld }); });
    let tris = 0;
    byMat.forEach((entries, mat) => {
      const geo = mergeEntries(T, entries);
      if (mat === M.bulbs || mat === M.fx) {
        const p = new T.Points(geo, mat); p.frustumCulled = false; p.name = this.name + '-' + (mat === M.bulbs ? 'bulbs' : 'fx');
        p.onBeforeRender = (renderer, scene, camera) => M.feed(renderer, scene, camera); this.group.add(p);
      } else {
        const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false; mesh.name = this.name + '-' + mat.name; this.group.add(mesh); tris += geo.attributes.position.count / 3;
      }
    });
    this.tris = tris; this.objects = objs.length;
  }
  clear() { this.group.children.slice().forEach((c) => { this.group.remove(c); if (c.geometry) c.geometry.dispose(); }); this.tris = 0; }
}

const isFairObj = (M, o) => (o.isMesh || o.isPoints) && o.material && M.all().includes(o.material);
function collect(M, root, filter) { const out = []; root.updateMatrixWorld(true); root.traverse((o) => { if (isFairObj(M, o) && (!filter || filter(o, root))) out.push(o); }); return out; }
const isPartObj = (o, root) => { let p = o.parent; while (p && p !== root) { if (p.name && p.name.startsWith('part:')) return true; p = p.parent; } return false; };

/* ------------------------------------------------------------------ the layer */
/** centre line of the tram track (Allée Scheffer lane) in the game frame, every `step` metres: [{ u, w, tu, tw }] (tu, tw = unit tangent) */
export function sampleLane(world, step = 5) {
  const tr = world && world.parts && world.parts.tram && world.parts.tram.track; if (!tr) return [];
  const out = [];
  for (let s = 8470; s <= 8910; s += step) {
    const a = tr.place(s, 0, 0); const c = tr.place(s + 1, 0, 0); const A = world.toGame(a[0], a[2]); const B = world.toGame(c[0], c[2]);
    const l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; out.push({ u: A[0], w: A[1], tu: (B[0] - A[0]) / l, tw: (B[1] - A[1]) / l });
  }
  return out;
}

export async function createFairLayer({ T, root, pitches, groundY, quality = 'medium', fieldPoly, buildBase = true, seed = 1, renderer = null, world = null, lane = null, glow: glowOpt = true }) {
  const M = getMaterials();
  const group = new T.Group(); group.name = 'fouer-fair'; root.add(group);
  const baseBatch = new Batch(T, M, 'base'); const pitchBatch = new Batch(T, M, 'pitches'); const frozenBatch = new Batch(T, M, 'frozen');
  group.add(baseBatch.group, pitchBatch.group, frozenBatch.group);
  let Q = QUALITY[quality] || QUALITY.medium;
  const pits = new Map();
  pitches.forEach((p) => {
    const rect = { id: p.id, u: p.u, w: p.w, size: p.size, star: p.star, face: p.face || '+w', y: groundY(p.u, p.w) };
    const holder = new T.Object3D(); holder.position.set(rect.u, rect.y, rect.w); holder.rotation.y = YAW[rect.face] || 0; holder.name = 'pitch-' + p.id;
    pits.set(p.id, { rect, holder, spec: { state: 'open' }, near: null, farG: null, cur: null, far: false, live: false, opaque: false });
  });
  const dirty = { pitch: true, frozen: true };
  /* the night light of the fair (world/glow.js): halos of the big rides, a baked light map for the painted surfaces and the asphalt */
  const glow = glowOpt === false ? null : createGlow({ T, root, groundY, fieldPoly, quality });
  let night = 0; let time = 0; let accLod = 9; let lastLiveKey = '';
  const opaque = new Set();

  /* ---- base batch: NPC background fair + props (built once) */
  const baseInfo = { npc: null, props: null };
  if (buildBase) {
    const npcMod = await import('./npc.js'); const propMod = await import('./props.js');
    const holders = [];
    const laneSamples = lane || sampleLane(world);
    baseInfo.npc = npcMod.buildNpcFair({ T, pitches: [...pits.values()].map((q) => q.rect), fieldPoly, groundY, seed, quality, lane: laneSamples });
    baseInfo.props = propMod.buildProps({ T, pitches: [...pits.values()].map((q) => q.rect), fieldPoly, groundY, seed, quality });
    const clutterMod = await import('./clutter.js');
    baseInfo.clutter = clutterMod.buildClutter({ T, fieldPoly, groundY, seed, quality, grid: baseInfo.npc.grid, gridDims: baseInfo.npc.gridDims });
    [baseInfo.npc.group, baseInfo.props.group, baseInfo.clutter.group].forEach((g) => holders.push(g));
    const tmp = new T.Group(); holders.forEach((g) => tmp.add(g));
    baseBatch.build(collect(M, tmp)); tmp.clear();
    if (glow) glow.setLightsFrom(group, true);
  }

  /* ---- content of one pitch: pit.near (full detail) / pit.farG (simplified static LOD, built lazily) / pit.cur = the one in pit.holder now */
  function specKey(spec) { return spec.state === 'built' ? `${spec.item}|${spec.look | 0}|${spec.level | 0 || 1}` : spec.state; }
  function makeModel(pit, far) {
    const spec = pit.spec; const sd = (hashStr(pit.rect.id) % 997) + seed; let g = null;
    if (spec.state === 'locked') g = buildPitchNpc({ T, rect: pit.rect, seed: sd, far });
    else if (spec.state === 'built') {
      const item = ITEM_BY_ID[spec.item];
      if (hasModel(spec.item)) g = buildModel(spec.item, { look: spec.look | 0, level: spec.level | 0 || 1, quality, seed: sd, far });
      else g = buildPitchNpc({ T, rect: pit.rect, seed: sd, far, bigFor: item ? item.size : pit.rect.size, noLock: true });
    }
    if (g && glow && g.userData.kit !== 'w3') glow.attachHalos(g);          // W4a / W4b rides: bloom points from their lamp vertices
    if (g && g.userData.kit === 'w3' && !far && pit.rect.size !== 'XL') { const d = dressPitch({ T, size: pit.rect.size, g, seed: sd }); if (d) d.children.slice().forEach((c) => g.add(c)); }   // crates / tables / bins in the slack of the slot
    return g;
  }
  const disposeGroup = (g) => { if (!g) return; if (g.userData.dispose) g.userData.dispose(); else g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); };
  function clearPit(pit) {
    disposeGroup(pit.near); disposeGroup(pit.farG);
    pit.near = pit.farG = pit.cur = null; group.remove(pit.holder); pit.holder.clear(); pit.live = false; pit.opaque = false; pit.far = false; opaque.delete(pit);
  }
  function showCur(pit) {
    const g = pit.far ? (pit.farG || (pit.farG = makeModel(pit, true))) : pit.near;
    if (g !== pit.cur) { pit.holder.clear(); pit.cur = g; if (g) pit.holder.add(g); }
  }
  function applySpec(pit) {
    clearPit(pit); dirty.pitch = dirty.frozen = true;
    if (pit.spec.state === 'open') return;
    pit.near = makeModel(pit, false); if (!pit.near) return;
    pit.opaque = pit.near.userData.kit !== 'w3';
    showCur(pit);
    if (pit.opaque) { group.add(pit.holder); opaque.add(pit); }
  }

  /* ---- rebuild of the merged batches */
  function rebuildPitchBatch() {
    const objs = [];
    pits.forEach((pit) => {
      if (!pit.cur || pit.opaque) return;
      const g = pit.cur; pit.holder.updateMatrixWorld(true);
      collect(M, pit.holder, (o) => !isPartObj(o, g)).forEach((o) => objs.push(o));
    });
    pitchBatch.build(objs); dirty.pitch = false; if (glow) glow.setLightsFrom(group);
  }
  function rebuildFrozen() {
    const objs = [];
    pits.forEach((pit) => {
      if (!pit.cur || pit.opaque || pit.live) return;
      const g = pit.cur;
      if (g.userData.animate) g.userData.animate(0, 0, night);
      collect(M, pit.holder, (o) => isPartObj(o, g)).forEach((o) => objs.push(o));
    });
    frozenBatch.build(objs); dirty.frozen = false; if (glow) glow.setLightsFrom(group);
  }

  /* ---- LOD: far models, live rides */
  function lodUpdate(camera) {
    const cp = camera.position; const list = [];
    pits.forEach((pit) => {
      if (!pit.near || pit.opaque) return;
      const d = Math.hypot(pit.rect.u - cp.x, pit.rect.w - cp.z, (pit.rect.y - cp.y) * 0.6);
      const wantFar = d > (pit.far ? Q.farDist / Q.hyst : Q.farDist);
      if (wantFar !== pit.far) { pit.far = wantFar; showCur(pit); dirty.pitch = dirty.frozen = true; }
      if (!pit.far && pit.near.userData.animated) list.push({ pit, d });
    });
    list.sort((a, b) => a.d - b.d);
    const liveSet = new Set(list.slice(0, Q.live).map((e) => e.pit));
    const key = [...liveSet].map((p) => p.rect.id).sort().join(',');
    if (key !== lastLiveKey) {
      lastLiveKey = key;
      pits.forEach((pit) => {
        if (pit.opaque || !pit.near) return;
        const on = liveSet.has(pit);
        if (on !== pit.live) {
          pit.live = on;
          if (on) { group.add(pit.holder); pit.cur.children.forEach((c) => { if (!c.name.startsWith('part:')) c.visible = false; }); }
          else { group.remove(pit.holder); pit.cur.children.forEach((c) => { c.visible = true; }); }
        }
      });
      dirty.frozen = true;
    }
    // W4a models: the nearest 3 animate and get the full LOD within 80 m
    const ranked = [...opaque].map((pit) => ({ pit, d: Math.hypot(pit.rect.u - cp.x, pit.rect.w - cp.z) })).sort((a, b) => a.d - b.d);
    ranked.forEach((e, i) => { const ud = e.pit.near.userData; if (ud.setLOD) ud.setLOD(e.d < (ud.lod === 1 ? 88 : 80) ? 1 : 0); if (ud.setAnimated) ud.setAnimated(i < 3 || Q.live > 12); });
  }

  /* ---- public api */
  const api = {
    group, pits, baseInfo, glow, batches: { base: baseBatch, pitches: pitchBatch, frozen: frozenBatch }, quality: () => quality,
    pitchIds: () => [...pits.keys()],
    getPitch: (id) => (pits.get(id) ? Object.assign({}, pits.get(id).spec) : null),
    setPitch(id, spec) {
      const pit = pits.get(id); if (!pit) throw new Error('[fouer] unknown pitch ' + id);
      const next = Object.assign({ state: 'open' }, spec);
      if (specKey(next) === specKey(pit.spec)) { pit.spec = next; return; }
      pit.spec = next; applySpec(pit);
    },
    setAll(map) { Object.entries(map).forEach(([id, spec]) => api.setPitch(id, spec)); },
    /** swap one pitch between NPC background and player content (locked pitches show an NPC stall + padlock) */
    toNpc(id) { const p = pits.get(id); api.setPitch(id, { state: 'locked' }); return p ? p.rect.star : 0; },
    flush(camera) { if (camera) lodUpdate(camera); if (dirty.pitch) rebuildPitchBatch(); if (dirty.frozen) rebuildFrozen(); },
    setNight(k) { night = k; M.setNight(k); if (glow) glow.setNight(k); opaque.forEach((pit) => pit.near.userData.setNight && pit.near.userData.setNight(k)); },
    setQuality(q) { if (QUALITY[q]) { Q = QUALITY[q]; quality = q; lastLiveKey = ''; accLod = 9; if (glow) glow.setQuality(q); } },
    update(dt, camera) {
      time += dt; M.tick(time); accLod += dt; if (glow) glow.update(dt);
      if (camera && accLod > 0.3) { accLod = 0; lodUpdate(camera); }
      if (dirty.pitch) rebuildPitchBatch();
      if (dirty.frozen) rebuildFrozen();
      pits.forEach((pit) => {
        if (!pit.near) return;
        if ((pit.opaque || pit.live) && pit.near.userData.animate) pit.near.userData.animate(time, dt, night);
      });
    },
    stats() {
      let liveObjs = 0; let liveTris = 0; let opq = 0;
      pits.forEach((pit) => { if (pit.live && pit.cur) pit.cur.traverse((o) => { if (o.visible && (o.isMesh || o.isPoints) && isPartObj(o, pit.cur)) { liveObjs++; if (o.isMesh) liveTris += o.geometry.attributes.position.count / 3; } }); if (pit.opaque) opq++; });
      return {
        base: { tris: baseBatch.tris, draws: baseBatch.group.children.length }, pitches: { tris: pitchBatch.tris, draws: pitchBatch.group.children.length }, frozen: { tris: frozenBatch.tris, draws: frozenBatch.group.children.length },
        live: { rides: [...pits.values()].filter((p) => p.live).length, draws: liveObjs, tris: liveTris }, opaque: opq,
        totalDraws: baseBatch.group.children.length + pitchBatch.group.children.length + frozenBatch.group.children.length + liveObjs,
        totalTris: baseBatch.tris + pitchBatch.tris + frozenBatch.tris + liveTris,
        atlas: M.atlasStats(),
      };
    },
    dispose() { pits.forEach(clearPit); [baseBatch, pitchBatch, frozenBatch].forEach((b) => b.clear()); if (glow) glow.dispose(); root.remove(group); },
  };
  return api;
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100000; }

/* ------------------------------------------------------------------ preview helper: the "full fair" of ?models=1&view=fair */
const SHOW = {
  S: ['kachel', 'fritten', 'lous', 'kanner', 'wurscht', 'zocker', 'lukas', 'mandel', 'waffel', 'crepes', 'schiess', 'lammy', 'museum'],
  M: ['fesch', 'kette', 'bayern', 'happy', 'break', 'musik', 'takeoff', 'gold', 'jules', 'hangover', 'infinity'],
  L: ['scooter', 'tent', 'maus', 'geister', 'splash', 'booster'],
  XL: ['alpina', 'looping'],
  W: ['wheel'],
};
export function fillShowcase(layer, { level = 4, look = 'mixed', seed = 1 } = {}) {
  const used = { S: 0, M: 0, L: 0, XL: 0, W: 0 }; const map = {}; let n = 0;
  layer.pitchIds().forEach((id) => {
    const rect = layer.pits.get(id).rect; const list = SHOW[rect.size] || SHOW.M; const item = list[used[rect.size]++ % list.length];
    map[id] = { state: 'built', item, look: look === 'mixed' ? (n++ % 3) : look, level };
  });
  layer.setAll(map);
  return map;
}
