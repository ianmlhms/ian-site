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

export async function loadWorldData(read, onProgress = () => {}) {
  const json = async (name) => JSON.parse(new TextDecoder().decode(await read(name)));
  const info = await json('terrain.json');
  onProgress(0.02, 'terrain');
  const nearGrid = decodeGrid(await read('terrain.bin'));
  if (gridChecksum(nearGrid.data) !== info.terrain.checksum) throw new Error('terrain.bin: checksum mismatch (decoder and baker disagree)');
  const near = { nx: nearGrid.nx, nz: nearGrid.nz, data: nearGrid.data };
  onProgress(0.5, 'hills');
  const farGrid = decodeGrid(await read('far.bin'));
  if (gridChecksum(farGrid.data) !== info.far.checksum) throw new Error('far.bin: checksum mismatch');
  const far = { nx: farGrid.nx, nz: farGrid.nz, data: farGrid.data };
  onProgress(0.6, 'ways');
  const ways = decodeWays(await read('ways.bin'), await json('ways.json'));
  onProgress(0.7, 'trails');
  const trails = await json('trails.json');
  for (const t of trails.trails) t.ways = [{ id: `trail-${t.id}`, kind: 'trail', pts: t.line }];       // carved as kind 'trail' (berms, banking)
  onProgress(0.8, 'canopy');
  const canopy = decodeCanopy(await read('canopy.bin'));
  onProgress(0.9, 'classes');
  const classes = decodeRle(await read('classes.bin'));
  let landmarks = [];
  try { landmarks = await json('landmarks.json'); } catch (error) { console.warn('[mtb] landmarks.json missing', error); }
  // W2 features: streams (flow direction = way direction), cliff lines (the drop is on the RIGHT of the way direction), forest leaf type, field ids
  const streams = decodeWays(await read('streams.bin'), await json('streams.json'));
  const cliffs = decodeWays(await read('cliffs.bin'), await json('cliffs.json'));
  const falls = await json('falls.json');
  const leaf = decodeRle(await read('leaf.bin'));
  const fields = decodeRle(await read('fields.bin'));
  onProgress(1, 'done');
  return { info, near, far, ways, trails, canopy, classes, landmarks, streams, cliffs, falls, leaf, fields };
}
