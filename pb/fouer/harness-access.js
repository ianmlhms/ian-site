// Access wave, Node side: build the REAL NPC fair, props and clutter (models/npc.js, props.js, clutter.js) with a tiny stand-in for THREE (the builders only need
// matrices and vectors to place stalls; the geometry they emit is thrown away) and run the layout validator on the footprints they produce.  Test-only: nothing here ships.
import * as layout from "./layout.js";

const proxyHandler = {
  get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === "then") return undefined; return t[k] ?? (t[k] = stub()); },
  set(t, k, v) { try { Object.defineProperty(t, k, { value: v, writable: true, configurable: true, enumerable: true }); } catch { /* read-only stub members */ } return true; },
  apply() { return stub(); }, construct() { return stub(); },
};
function stub() { return new Proxy(function () {}, proxyHandler); }

class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  multiply(b) { const a = this.elements, c = b.elements, o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * c[j * 4 + k]; this.elements = o; return this; }
  makeTranslation(x, y, z) { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; return this; }
  makeRotationX(a) { const c = Math.cos(a), s = Math.sin(a); this.elements = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; return this; }
  makeRotationY(a) { const c = Math.cos(a), s = Math.sin(a); this.elements = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; return this; }
  makeRotationZ(a) { const c = Math.cos(a), s = Math.sin(a); this.elements = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; return this; }
  makeScale(x, y, z) { this.elements = [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; return this; }
  clone() { const m = new Matrix4(); m.elements = [...this.elements]; return m; }
  copy(m) { this.elements = [...m.elements]; return this; }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; } add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); } lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; } multiplyScalar(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; } dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  applyMatrix4(m) { const e = m.elements, x = this.x, y = this.y, z = this.z; this.x = e[0] * x + e[4] * y + e[8] * z + e[12]; this.y = e[1] * x + e[5] * y + e[9] * z + e[13]; this.z = e[2] * x + e[6] * y + e[10] * z + e[14]; return this; }
}
class Color {
  constructor(c = 0xffffff) { this.set(c); }
  set(c) { if (typeof c === "number") { this.r = (c >> 16 & 255) / 255; this.g = (c >> 8 & 255) / 255; this.b = (c & 255) / 255; } else if (c && c.r !== undefined) { this.r = c.r; this.g = c.g; this.b = c.b; } return this; }
  setHex(c) { return this.set(c); } setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } clone() { return new Color().set(this); } copy(c) { return this.set(c); }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; } multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; }
  getHex() { return ((this.r * 255) << 16) | ((this.g * 255) << 8) | (this.b * 255); }
}

/** run `fn` with a stand-in THREE / document on globalThis (the model modules keep their own reference to it, so it stays installed for the whole run) */
export async function withStandInThree(fn) {
  const saved = { THREE: globalThis.THREE, document: globalThis.document, window: globalThis.window };
  const T = new Proxy({ Matrix4, Vector3, Color }, proxyHandler);
  globalThis.THREE = T; globalThis.document = new Proxy({}, proxyHandler); globalThis.window = globalThis;
  try { return await fn(T); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
}

/** Build the NPC fair + props + clutter for a pitch list and return everything the validator needs (call inside withStandInThree). */
export async function buildFairFootprints({ T, pitches, seed = 1, quality = "medium" }) {
  {
    const npc = await import("./models/npc.js"); const props = await import("./models/props.js"); const clutter = await import("./models/clutter.js");
    const defs = pitches.map(p => ({ id: p.id, u: p.u, w: p.w, size: p.size, face: p.face, star: p.star }));
    const common = { T, fieldPoly: [...layout.FIELD_POLY], groundY: () => 0, seed, quality };
    const fair = npc.buildNpcFair({ ...common, pitches: defs, lane: [] });
    const pr = props.buildProps({ ...common, pitches: defs });
    const cl = clutter.buildClutter({ ...common, grid: fair.grid, gridDims: fair.gridDims, pitches: defs, stalls: fair.stalls });
    return { stalls: fair.stalls, solids: [...pr.solids, ...cl.solids], boxes: [...pr.boxes, ...cl.boxes], count: fair.count, corridors: npc.CORRIDORS };
  }
}

/** the whole run (fresh process: the model modules read THREE when they are first imported): prints one JSON line { errors: { name: [...] }, stalls, solids, reach } */
async function childRun() {
  const [{ PITCHES }, walk] = await Promise.all([import("./data.js"), import("./walk.js")]);
  const pitches = PITCHES.map(p => ({ ...p }));
  const out = { errors: {}, runs: [], reach: null };
  let last = null;
  await withStandInThree(async T => {
    for (const [seed, quality] of [[1, "medium"], [2, "medium"], [3, "medium"], [4, "medium"], [5, "medium"], [6, "medium"], [7, "medium"], [8, "medium"], [3, "low"], [5, "low"]]) {
      const built = await buildFairFootprints({ T, pitches, seed, quality });
      out.errors[`seed ${seed} ${quality}`] = [...layout.validateFootprints({ pitches, stalls: built.stalls, solids: built.solids, boxes: built.boxes }), ...layout.validateStallFaces({ stalls: built.stalls })];
      out.runs.push({ seed, quality, stalls: built.stalls.length, solids: built.solids.length, boxes: built.boxes.length });
      last = built;
    }
  });
  const bfs = layout.validateLayout({ pitches, stalls: last.stalls, solids: last.solids, boxes: last.boxes, createMask: walk.createMask, pitchSolids: walk.pitchSolids, stars: [1, 3, 5] });
  out.errors["reach (real stalls, props, clutter)"] = bfs.errors; out.reach = bfs.stats.reach;
  console.log("ACCESS-JSON " + JSON.stringify(out));
}
if (process.argv[1] && process.argv[1].endsWith("harness-access.js")) await childRun();
