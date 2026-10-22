/* Schueberfouer Tycoon, W2: height-tile decoding (the Luxtram LiDAR format, scripts/build_luxtram_geo.py: encode_heights).
 * Pure functions, no DOM: shared by the runtime world and by the bake helper (scripts/bake_fouer_landmarks.mjs). */
export const H0 = 150;     // metres added back to the quantised values
export const HQ = 200;     // 5 mm steps

/** Zigzag-varint, 2-D predicted height grid -> { n, h: Float32Array(n*n) } (row = +z/south, column = +x/east). */
export function decodeHeights(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const n = u8[0];
  const out = new Float32Array(n * n);
  const q = new Int32Array(n * n);
  let pos = 1;
  const next = () => {
    let x = 0; let sh = 0;
    for (;;) { const b = u8[pos++]; x += (b & 0x7f) * Math.pow(2, sh); sh += 7; if (b < 0x80) break; }
    return (x % 2 === 1) ? -(x + 1) / 2 : x / 2;
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      const v = next();
      let pred = 0;
      if (r === 0 && c === 0) pred = 0;
      else if (r === 0) pred = q[k - 1];
      else if (c === 0) pred = q[k - n];
      else pred = q[k - 1] + q[k - n] - q[k - n - 1];
      q[k] = pred + v;
      out[k] = q[k] / HQ + H0;
    }
  }
  return { n, h: out };
}

/** Bilinear sampler over a set of decoded tiles in Luxtram-local metres (x east, z south).
 *  tiles: Map "i_j" -> { n, h, step }, tileSize 128. */
export function createDem(tiles, tileSize = 128) {
  const sample = (x, z) => {
    const i = Math.floor(x / tileSize); const j = Math.floor(z / tileSize);
    const t = tiles.get(i + '_' + j);
    if (!t) return NaN;
    const step = tileSize / (t.n - 1);
    const fx = (x - i * tileSize) / step; const fz = (z - j * tileSize) / step;
    const c0 = Math.max(0, Math.min(t.n - 2, Math.floor(fx))); const r0 = Math.max(0, Math.min(t.n - 2, Math.floor(fz)));
    const ax = fx - c0; const az = fz - r0;
    const h = t.h; const n = t.n;
    const a = h[r0 * n + c0]; const b = h[r0 * n + c0 + 1]; const c = h[(r0 + 1) * n + c0]; const d = h[(r0 + 1) * n + c0 + 1];
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  };
  return { sample };
}
