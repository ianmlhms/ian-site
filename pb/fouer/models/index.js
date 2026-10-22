/* Schueberfouer Tycoon, W3 + W4: the model registry.
 *
 * MODEL CONTRACT (W3 and W4a follow it exactly)
 *   Each models file exports   MODELS = { [itemId]: { build(opts) } }   with  opts = { look: 0|1|2, level: 1..4, quality: 'low'|'medium'|'high', seed: int, [far: bool], [lang: 'lb'|'de'|'en'] }.
 *   build() returns a THREE.Group (name = itemId): origin = pitch centre on the ground (y = 0), +z = FRONT (faces the alley), inside the pitch size of data.js,
 *   geometry merged per shared material (materials.js: solid / lamp / sign / signLit meshes + `bulbs` / `fx` Points); animated pieces are child groups named
 *   `part:<name>` (also listed in group.userData.parts[name], pivot at the group origin).  userData: animate(t, dt, nightK), setNight(k), tris, bulbs, size, height,
 *   id, look, level.  `far: true` asks for the simplified static LOD (no figures, fewer bulbs / segments).
 *   Files: stalls.js (food / game stalls, museum, Hämmi statue), rides-small.js (S / M rides), W4a's wheel.js / towers.js (loaded when present).
 *
 *   buildModel(itemId, opts)          -> Group
 *   MODEL_IDS / hasModel(id) / registerModels(map)
 *   loadBigModels()                   -> dynamic import of ./wheel.js and ./towers.js if they exist (404s are swallowed); safe to call twice
 */
import { MODELS as STALLS } from './stalls.js';
import { MODELS as RIDES } from './rides-small.js';

export const MY_MODELS = Object.assign({}, STALLS, RIDES);      // W3's own models (the tests import these directly; W4a may override ids in REGISTRY)
export const REGISTRY = Object.assign({}, MY_MODELS);
export const BIG_FILES = ['./wheel.js', './towers.js'];
let bigLoaded = null;

export const hasModel = (id) => !!REGISTRY[id];
export const modelIds = () => Object.keys(REGISTRY);
export function registerModels(map) { Object.assign(REGISTRY, map); }

export function normaliseOpts(o = {}) {
  return { look: Math.max(0, Math.min(2, o.look | 0)), level: Math.max(1, Math.min(4, (o.level | 0) || 1)), quality: o.quality || 'medium', seed: o.seed | 0, far: !!o.far, lang: o.lang || 'lb' };
}

export function buildModel(itemId, opts) {
  const m = REGISTRY[itemId];
  if (!m) throw new Error('[fouer] no model for item "' + itemId + '"');
  const g = m.build(normaliseOpts(opts));
  g.name = itemId;
  return g;
}

export function loadBigModels() {
  if (bigLoaded) return bigLoaded;
  bigLoaded = Promise.all(BIG_FILES.map(async (f) => {
    try { const mod = await import(/* @vite-ignore */ f); if (mod && mod.MODELS) { registerModels(mod.MODELS); return f; } } catch (e) { /* not there (yet) */ }
    return null;
  })).then((r) => r.filter(Boolean));
  return bigLoaded;
}
