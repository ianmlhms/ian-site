/* Loads and decodes the baked world files (pb/mtb/data/*). `read(name)` returns a Promise<Uint8Array>: the browser passes a fetch based
 * reader, the Node harness an fs based one, so both run the same decoding code. */
import { decodeGrid, decodeRle, gridChecksum } from './codec.js';

const KIND_NAMES = ['trail', 'path', 'track', 'road', 'stream', 'river', 'ditch', 'cliff'];
const FLAG_BRIDGE = 1;
const FLAG_TUNNEL = 2;
const DECIMETRE = 0.1;

function readVarint(bytes, state) {
  let result = 0, shift = 0;
  for (;;) {
    const b = bytes[state.pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return result;
    shift += 7;
    if (shift > 49) throw new Error('ways: varint too long');
  }
}
const unzigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

/** ways.bin + ways.json -> [{ id, kind, mtb, surface, bridge, tunnel, name, length, pts: [[x, z], ...] }] */
export function decodeWays(bin, meta) {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const count = view.getUint32(0, true);
  if (count !== meta.length) throw new Error(`ways: ${count} geometries but ${meta.length} attribute rows`);
  const state = { pos: 4 };
  const ways = [];
  for (let w = 0; w < count; w++) {
    const n = view.getUint16(state.pos, true);
    let x = view.getInt32(state.pos + 2, true);
    let z = view.getInt32(state.pos + 6, true);
    state.pos += 10;
    const pts = [[x * DECIMETRE, z * DECIMETRE]];
    for (let i = 1; i < n; i++) {
      x += unzigzag(readVarint(bin, state));
      z += unzigzag(readVarint(bin, state));
      pts.push([x * DECIMETRE, z * DECIMETRE]);
    }
    const m = meta[w];
    ways.push({ id: m.id, kind: KIND_NAMES[m.k], mtb: m.m === 255 ? null : m.m, surface: m.s, bridge: (m.f & FLAG_BRIDGE) !== 0, tunnel: (m.f & FLAG_TUNNEL) !== 0, name: m.n || '', length: m.len, pts });
  }
  return ways;
}

/** Canopy file: u32 length of the first grid, then the height grid and the covered-fraction grid. */
export function decodeCanopy(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstLength = view.getUint32(0, true);
  const height = decodeGrid(bytes.subarray(4, 4 + firstLength));
  const cover = decodeGrid(bytes.subarray(4 + firstLength));
  return { height, cover, step: 8 };
}

const FILES = ['terrain.json', 'terrain.bin', 'far.bin', 'ways.bin', 'ways.json', 'trails.json', 'medals.json', 'canopy.bin', 'classes.bin', 'landmarks.json', 'streams.bin', 'streams.json', 'cliffs.bin', 'cliffs.json', 'falls.json', 'buildings.json', 'leaf.bin', 'fields.bin'];
/** The optional files: a missing one is a warning, not a failure. */
const OPTIONAL = new Set(['medals.json', 'landmarks.json', 'buildings.json']);
export const WORLD_FILES = Object.freeze([...FILES]);

export async function loadWorldData(read, onProgress = () => {}) {
  // Every file is requested at once (one round trip instead of eighteen in a row, the big terrain file downloads while the small ones decode); decoding stays in the old order.
  const pending = new Map(FILES.map((name) => { const p = Promise.resolve().then(() => read(name)); p.catch(() => {}); return [name, p]; }));
  const bytes = (name) => pending.get(name);
  const json = async (name) => JSON.parse(new TextDecoder().decode(await bytes(name)));
  const optionalJson = async (name, fallback, why) => { try { return await json(name); } catch (error) { console.warn(`[mtb] ${name} missing (${why})`, error); return fallback; } };
  const info = await json('terrain.json');
  onProgress(0.02, 'terrain');
  const nearGrid = decodeGrid(await bytes('terrain.bin'));
  if (gridChecksum(nearGrid.data) !== info.terrain.checksum) throw new Error('terrain.bin: checksum mismatch (decoder and baker disagree)');
  const near = { nx: nearGrid.nx, nz: nearGrid.nz, data: nearGrid.data };
  onProgress(0.5, 'hills');
  const farGrid = decodeGrid(await bytes('far.bin'));
  if (gridChecksum(farGrid.data) !== info.far.checksum) throw new Error('far.bin: checksum mismatch');
  const far = { nx: farGrid.nx, nz: farGrid.nz, data: farGrid.data };
  onProgress(0.6, 'ways');
  const ways = decodeWays(await bytes('ways.bin'), await json('ways.json'));
  onProgress(0.7, 'trails');
  const trails = await json('trails.json');
  for (const t of trails.trails) t.ways = [{ id: `trail-${t.id}`, kind: 'trail', pts: t.line, features: t.features || [], yield: t.yield === true }];       // carved as kind 'trail' (berms, banking, features)
  const medals = await optionalJson('medals.json', {}, 'medal times fall back to the trail length');
  onProgress(0.8, 'canopy');
  const canopy = decodeCanopy(await bytes('canopy.bin'));
  onProgress(0.9, 'classes');
  const classes = decodeRle(await bytes('classes.bin'));
  const landmarks = await optionalJson('landmarks.json', [], 'no landmarks');
  // W2 features: streams (flow direction = way direction), cliff lines (the drop is on the RIGHT of the way direction), forest leaf type, field ids
  const streams = decodeWays(await bytes('streams.bin'), await json('streams.json'));
  const cliffs = decodeWays(await bytes('cliffs.bin'), await json('cliffs.json'));
  const falls = await json('falls.json');
  const buildings = await optionalJson('buildings.json', { houses: [], castles: [], churches: [], centres: {} }, 'no villages and castles');
  const leaf = decodeRle(await bytes('leaf.bin'));
  const fields = decodeRle(await bytes('fields.bin'));
  onProgress(1, 'done');
  return { info, near, far, ways, trails, canopy, classes, landmarks, streams, cliffs, falls, leaf, fields, medals, buildings };
}
