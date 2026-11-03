/* MBG1 block-packed grids and the Lux Drive class raster: the browser/Node decoder of the files that
 * scripts/luxdrive/bake_*.py writes. The format is described in scripts/luxdrive/codec.py
 * (planar prediction, 8x8 blocks, 4-bit width + zigzag residuals, LSB first). */

const MAGIC = 'MBG1';
const HEADER_BYTES = 18;
const BLOCK_SIDE = 8;
const WIDTH_BITS = 4;

/** Decodes one MBG1 grid. Returns { nx, nz, step, h0, data: Float32Array (row-major, z rows) }. Throws a descriptive Error on a corrupt file. */
export function decodeGrid(bytes, offset = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC) throw new Error(`terrain grid: bad magic "${magic}" at offset ${offset}`);
  const nx = view.getUint16(4, true);
  const nz = view.getUint16(6, true);
  const step = view.getFloat32(8, true);
  const h0 = view.getFloat32(12, true);
  const block = view.getUint8(16);
  if (block !== BLOCK_SIDE || nx < 2 || nz < 2) throw new Error(`terrain grid: unsupported header (block ${block}, ${nx}x${nz})`);
  const src = new Uint8Array(bytes.buffer, bytes.byteOffset + offset + HEADER_BYTES, bytes.byteLength - offset - HEADER_BYTES);
  const q = new Int32Array(nx * nz);
  let bytePos = 0;
  let acc = 0;       // bit accumulator (at most 32 bits live)
  let nacc = 0;
  const need = (n) => { while (nacc < n) { if (bytePos >= src.length) throw new Error('terrain grid: data ends early'); acc += src[bytePos++] * 2 ** nacc; nacc += 8; } };
  const take = (n) => {            // n <= 16
    need(n);
    const mask = 2 ** n;
    const value = acc % mask;
    acc = Math.floor(acc / mask);
    nacc -= n;
    return value;
  };
  for (let by = 0; by < nz; by += block) {
    const hh = Math.min(block, nz - by);
    for (let bx = 0; bx < nx; bx += block) {
      const ww = Math.min(block, nx - bx);
      const w = take(WIDTH_BITS);
      for (let yy = 0; yy < hh; yy++) {
        const y = by + yy;
        for (let xx = 0; xx < ww; xx++) {
          const x = bx + xx;
          const v = w ? take(w) : 0;
          const r = (v >>> 1) ^ -(v & 1);
          let p;
          if (y === 0 && x === 0) p = 0;
          else if (y === 0) p = q[x - 1];
          else if (x === 0) p = q[(y - 1) * nx];
          else p = q[y * nx + x - 1] + q[(y - 1) * nx + x] - q[(y - 1) * nx + x - 1];
          q[y * nx + x] = p + r;
        }
      }
    }
  }
  const data = new Float32Array(nx * nz);
  for (let i = 0; i < data.length; i++) data[i] = Math.fround(h0 + q[i] * step);
  return { nx, nz, step, h0, data };
}

/** The Lux Drive class raster: a run length encoding of the class bytes, row major, north to south.
 *  Each run is a varint (length - 1) followed by the class byte. Returns { nx, nz, data: Uint8Array }. */
export function decodeClassRle(bytes, nx, nz) {
  const data = new Uint8Array(nx * nz);
  let pos = 0, out = 0;
  while (out < data.length) {
    if (pos >= bytes.length) throw new Error('class raster: data ends early');
    let run = 0, shift = 0;
    for (;;) {
      if (pos >= bytes.length) throw new Error('class raster: data ends early');
      const b = bytes[pos++];
      run += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) break;
      shift += 7;
      if (shift > 49) throw new Error('class raster: run length too long');
    }
    const value = bytes[pos++];
    const length = run + 1;
    if (out + length > data.length) throw new Error('class raster: run overflows the grid');
    data.fill(value, out, out + length);
    out += length;
  }
  return { nx, nz, data };
}

/** Cheap order-sensitive checksum of a Float32Array (the bake writes the same number into terrain.json: it proves decoder == encoder). */
export function gridChecksum(data) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.round(data[i] * 64);
    a = (a + v) % 1000003;
    b = (b + a) % 1000033;
  }
  return a * 1000033 + b;
}
