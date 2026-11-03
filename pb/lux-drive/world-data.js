/* Loads and decodes the baked world files (pb/lux-drive/data/*).  `read(name)` returns a Promise<Uint8Array>: the browser
 * passes a fetch based reader, the Node harness an fs based one, so both run exactly the same decoding code. */
import { decodeGrid, decodeClassRle, gridChecksum } from './codec.js';
import { decodeRoads } from './roads.js';
import { decodeDecks } from './decks.js';

const DECIMETRE = 0.1;

function readVarint(bytes, state) {
  let result = 0, shift = 0;
  for (;;) {
    const b = bytes[state.pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return result;
    shift += 7;
    if (shift > 49) throw new Error('lines: varint too long');
  }
}
const unzigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

/** The canopy file: u32 length of the first grid, then the height grid and the covered-fraction grid. */
export function decodeCanopy(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstLength = view.getUint32(0, true);
  const height = decodeGrid(bytes.subarray(4, 4 + firstLength));
  const cover = decodeGrid(bytes.subarray(4 + firstLength));
  return { height, cover };
}

/** The buildings: the LOD2 footprints with their roof shape. */
export function decodeBuildings(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const state = { pos: 4 };
  const out = [];
  for (let b = 0; b < count; b++) {
    const roof = view.getUint8(state.pos);
    const style = view.getUint8(state.pos + 1);
    const ridgeDir = view.getUint8(state.pos + 2);
    const levels = view.getUint8(state.pos + 3);
    const eave = view.getUint16(state.pos + 4, true) * DECIMETRE;
    const ridge = view.getUint16(state.pos + 6, true) * DECIMETRE;
    const n = view.getUint16(state.pos + 8, true);
    let x = view.getInt32(state.pos + 10, true);
    let z = view.getInt32(state.pos + 14, true);
    state.pos += 18;
    const pts = new Float32Array(n * 2);
    pts[0] = x * DECIMETRE; pts[1] = z * DECIMETRE;
    for (let i = 1; i < n; i++) {
      x += unzigzag(readVarint(bytes, state));
      z += unzigzag(readVarint(bytes, state));
      pts[i * 2] = x * DECIMETRE; pts[i * 2 + 1] = z * DECIMETRE;
    }
    out.push({ id: b, roof, style, ridgeDir: (ridgeDir * 2 * Math.PI) / 256, levels, eave, ridge, pts });
  }
  return out;
}

/** The tram and rail lines: the rails the tram runs on and the railway tracks. */
export function decodeLines(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const state = { pos: 4 };
  const out = [];
  for (let l = 0; l < count; l++) {
    const kind = view.getUint8(state.pos);
    const flags = view.getUint8(state.pos + 1);
    const n = view.getUint16(state.pos + 2, true);
    let x = view.getInt32(state.pos + 4, true);
    let z = view.getInt32(state.pos + 8, true);
    state.pos += 12;
    const pts = new Float32Array(n * 2);
    pts[0] = x * DECIMETRE; pts[1] = z * DECIMETRE;
    for (let i = 1; i < n; i++) {
      x += unzigzag(readVarint(bytes, state));
      z += unzigzag(readVarint(bytes, state));
      pts[i * 2] = x * DECIMETRE; pts[i * 2 + 1] = z * DECIMETRE;
    }
    out.push({ id: l, kind, inStreet: (flags & 1) !== 0, pts });
  }
  return out;
}

/** The public transport stops (tram, train, bus) with their names. */
export function decodeStops(bytes, names) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const state = { pos: 4 };
  const out = [];
  for (let s = 0; s < count; s++) {
    const kind = view.getUint8(state.pos);
    const nameId = view.getUint16(state.pos + 1, true);
    const x = view.getInt32(state.pos + 3, true) * DECIMETRE;
    const z = view.getInt32(state.pos + 7, true) * DECIMETRE;
    state.pos += 11;
    out.push({ kind, name: names[nameId] || '', x, z });
  }
  return out;
}

export async function loadWorldData(read, onProgress = () => {}) {
  const json = async (name) => JSON.parse(new TextDecoder().decode(await read(name)));
  const info = await json('terrain.json');
  onProgress(0.02, 'terrain');
  const nearGrid = decodeGrid(await read('terrain.bin'));
  if (gridChecksum(nearGrid.data) !== info.terrain.checksum) throw new Error('terrain.bin: checksum mismatch (decoder and baker disagree)');
  const near = { nx: nearGrid.nx, nz: nearGrid.nz, data: nearGrid.data };
  onProgress(0.4, 'hills');
  const farGrid = decodeGrid(await read('far.bin'));
  if (gridChecksum(farGrid.data) !== info.far.checksum) throw new Error('far.bin: checksum mismatch');
  const far = { nx: farGrid.nx, nz: farGrid.nz, data: farGrid.data };
  onProgress(0.5, 'roads');
  const names = await json('names.json');
  const roads = decodeRoads(await read('roads.bin'), names);
  onProgress(0.65, 'bridges');
  const decks = decodeDecks(await read('decks.bin'));
  onProgress(0.7, 'canopy');
  const canopy = decodeCanopy(await read('canopy.bin'));
  if (gridChecksum(canopy.height.data) !== info.canopy.checksumHeight) throw new Error('canopy.bin: the height grid does not match terrain.json');
  if (gridChecksum(canopy.cover.data) !== info.canopy.checksumCover) throw new Error('canopy.bin: the cover grid does not match terrain.json');
  onProgress(0.8, 'classes');
  const classInfo = await json('classes.json');
  const classes = decodeClassRle(await read('classes.bin'), classInfo.nx, classInfo.nz);
  onProgress(0.85, 'city');
  const buildings = decodeBuildings(await read('buildings.bin'));
  const lines = decodeLines(await read('lines.bin'));
  const stopNames = await json('stopnames.json');
  const stops = decodeStops(await read('stops.bin'), stopNames);
  const places = await json('places.json');
  onProgress(1, 'done');
  return { info, near, far, roads, decks, canopy, classes, classInfo, buildings, lines, stops, places, names };
}
