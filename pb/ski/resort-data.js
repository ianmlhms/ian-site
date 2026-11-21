/* Loads one resort: resort.json + far.bin + classes.bin at once (small, about 1.3 MB), then the 5 m height tiles streamed nearest-first
 * around a point of interest (the start gate of the chosen piste, then the skier). Only the chosen resort is ever loaded.
 * The page may have started the first files already (window.__skiPre, see ski.html): they are taken from there. */
import { DATA } from './config.js';
import { decodeGrid, decodeRle } from './codec.js';

export const RESORTS = Object.freeze([
  { id: 'killy', name: "Val d'Isère · Tignes", short: 'Espace Killy', country: 'FR', ready: true },
  { id: '3vallees', name: 'Les 3 Vallées', short: 'Courchevel · Méribel · Val Thorens', country: 'FR', ready: true },
  { id: 'zermatt', name: 'Zermatt · Cervinia', short: 'Matterhorn', country: 'CH', ready: true },
  { id: 'arlberg', name: 'St. Anton · Arlberg', short: 'Ski Arlberg', country: 'AT', ready: true },
  { id: 'kronplatz', name: 'Kronplatz', short: 'Plan de Corones', country: 'IT', ready: true },
]);

const base = (rid) => new URL(`./data/${rid}/`, import.meta.url).href;

async function fetchBytes(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url.split('/').slice(-2).join('/')}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function preloaded(rid, name) {
  const pre = window.__skiPre;
  if (!pre || pre.resort !== rid || !pre.files || !pre.files[name]) return null;
  const p = pre.files[name];
  delete pre.files[name];
  return p;
}

/* classes.z = classes.bin deflated (zlib): about half the bytes on the first play (the server sends .bin files uncompressed). Browsers
 * without DecompressionStream, or data baked without classes.z, take classes.bin. */
export const CLASSES_Z = typeof DecompressionStream === 'function';

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** { resort, far, classes } (decoded) for one resort. */
export async function loadResortCore(rid, onProgress = () => {}) {
  const root = base(rid);
  const get = (name) => preloaded(rid, name) || fetchBytes(root + name);
  const getClasses = async () => {
    if (CLASSES_Z) {
      try { return await inflate(await get('classes.z')); } catch (error) { console.warn('[ski] classes.z unusable, taking classes.bin', error.message); }
    }
    return get('classes.bin');
  };
  const [jsonBytes, farBytes, classBytes] = await Promise.all([get('resort.json'), get('far.bin'), getClasses()]);
  onProgress(0.5);
  const resort = JSON.parse(new TextDecoder().decode(jsonBytes));
  const far = decodeGrid(farBytes);
  if (far.nx !== resort.far.nx || far.nz !== resort.far.nz) throw new Error(`far.bin does not match resort.json (${far.nx}x${far.nz})`);
  const classes = decodeRle(classBytes);
  onProgress(1);
  return { resort, far, classes, root };
}

/**
 * Streams the height tiles of a resort into the field.
 *   focus(x, z)       sets the point the queue is sorted around (nearest tiles first)
 *   hold(r)           until release(): only tiles within r m of the focus (or of a ready() waiter) load, so the first play fetches
 *                     just the tiles around the start and the CPU is not busy decoding / meshing the rest (start <= 10 s on an iPad)
 *   release()         the rest of the resort streams in the background, nearest the focus first (the focus follows the player)
 *   ready(x, z, r)    resolves when every shipped tile within r m of (x, z) is in
 *   onTile(fn)        fn(rect) after a tile was added (the caller invalidates its terrain caches)
 */
export function createTileStreamer({ resort, field, root }) {
  const list = resort.tiles.list.map(([tx, tz, bytes]) => ({ tx, tz, bytes, state: 'wait' }));
  const size = DATA.tileSize;
  let fx = resort.width / 2, fz = resort.depth / 2;
  let active = 0;
  let reach = Infinity;                                              // m around the focus that may load (hold / release)
  const listeners = new Set();
  const waiters = [];
  const stats = { loaded: 0, bytes: 0, failed: 0, total: list.length };

  const dist = (t) => {
    const dx = Math.max(t.tx * size - fx, 0, fx - (t.tx + 1) * size), dz = Math.max(t.tz * size - fz, 0, fz - (t.tz + 1) * size);
    return Math.hypot(dx, dz);
  };
  function pump() {
    while (active < DATA.fetchConcurrency) {
      let best = null, bd = Infinity;
      for (const t of list) {
        if (t.state !== 'wait') continue;
        const d = dist(t);
        if (d < bd && (d <= reach || waiters.some((w) => within(t, w.x, w.z, w.r)))) { bd = d; best = t; }
      }
      if (!best) return;
      best.state = 'load';
      active++;
      fetchBytes(`${root}t/${best.tx}_${best.tz}.bin`).then((bytes) => {
        const grid = decodeGrid(bytes);
        if (grid.nx !== DATA.tileCells + 1 || grid.nz !== DATA.tileCells + 1) throw new Error(`tile ${best.tx}_${best.tz}: ${grid.nx}x${grid.nz}`);
        const rect = field.addTile(best.tx, best.tz, grid);
        best.state = 'done';
        stats.loaded++; stats.bytes += bytes.length;
        for (const fn of listeners) { try { fn(rect); } catch (error) { console.error('[ski] tile listener failed', error); } }
      }).catch((error) => {
        console.warn('[ski] height tile failed, retrying later', best.tx, best.tz, error.message);
        stats.failed++;
        best.state = stats.failed > 40 ? 'dead' : 'wait';            // a dead tile: the far grid stays there (no hole, just coarser)
      }).finally(() => { active--; checkWaiters(); pump(); });
    }
  }
  function within(t, x, z, r) {
    const dx = Math.max(t.tx * size - x, 0, x - (t.tx + 1) * size), dz = Math.max(t.tz * size - z, 0, z - (t.tz + 1) * size);
    return Math.hypot(dx, dz) <= r;
  }
  function checkWaiters() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (list.every((t) => !within(t, w.x, w.z, w.r) || t.state === 'done' || t.state === 'dead')) { waiters.splice(i, 1); w.resolve(); }
    }
  }
  return {
    stats,
    focus(x, z) { fx = x; fz = z; pump(); },
    hold(r) { reach = r; },
    release() { if (reach !== Infinity) { reach = Infinity; pump(); } },
    get held() { return reach !== Infinity; },
    ready(x, z, r = DATA.startRadius) {
      return new Promise((resolve) => { waiters.push({ x, z, r, resolve }); checkWaiters(); pump(); });
    },
    pendingNear(x, z, r) { return list.filter((t) => within(t, x, z, r) && t.state !== 'done' && t.state !== 'dead').length; },
    onTile(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    done: () => list.every((t) => t.state === 'done' || t.state === 'dead'),
  };
}

/** Buildings and the painted map come after the start (not needed for the first run). */
export async function loadExtras(root) {
  const [res, streets] = await Promise.all([fetch(root + 'buildings.json'), fetch(root + 'roads.json').catch(() => null)]);
  if (!res.ok) throw new Error(`buildings.json: HTTP ${res.status}`);
  let roads = null;
  try { if (streets && streets.ok) roads = await streets.json(); } catch (error) { console.warn('[ski] roads.json unreadable', error.message); }
  return { buildings: await res.json(), roads };            // roads.json is optional (data baked before round 3 has none)
}
