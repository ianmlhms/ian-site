/* Schueberfouer Tycoon, W2: raw DEFLATE (RFC 1951) decoder, ~100 lines, no dependencies.
 * The world bundle is one deflate stream (scripts/bake_fouer_world.py).  DecompressionStream('deflate-raw') exists in current Chromium / Safari 16.4+,
 * but the school iPads are not always up to date, so the JS decoder is the fallback (and is the one the tests exercise). */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Canonical Huffman table: counts per length + symbols sorted by code (the classic "puff" decoder). */
function makeTable(lengths, n) {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

const FIXED = (() => {
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  const d = new Uint8Array(30).fill(5);
  return { lit: makeTable(l, 288), dist: makeTable(d, 30) };
})();

/** @param {Uint8Array} src raw deflate bytes @param {number} outLen exact decompressed size @returns {Uint8Array} */
export function inflateRaw(src, outLen) {
  const out = new Uint8Array(outLen);
  let pos = 0; let bitBuf = 0; let bitCnt = 0; let o = 0;
  const bits = (need) => {
    while (bitCnt < need) {
      if (pos >= src.length) throw new Error('inflate: unexpected end');
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << need) - 1);
    bitBuf >>>= need; bitCnt -= need;
    return v;
  };
  const decode = (t) => {
    let code = 0; let first = 0; let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = t.count[len];
      if (code - c < first) return t.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      out.set(src.subarray(pos, pos + len), o); pos += len; o += len;
      continue;
    }
    if (type === 3) throw new Error('inflate: bad block');
    let lit = FIXED.lit; let dist = FIXED.dist;
    if (type === 2) {
      const nlen = bits(5) + 257; const ndist = bits(5) + 1; const ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
      const clt = makeTable(cl, 19);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(clt);
        if (sym < 16) { lengths[i++] = sym; continue; }
        let prev = 0; let rep;
        if (sym === 16) { prev = lengths[i - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
        while (rep--) lengths[i++] = prev;
      }
      lit = makeTable(lengths.subarray(0, nlen), nlen);
      dist = makeTable(lengths.subarray(nlen), ndist);
    }
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) { out[o++] = sym; continue; }
      if (sym === 256) break;
      const s = sym - 257;
      const len = LEN_BASE[s] + bits(LEN_EXTRA[s]);
      const ds = decode(dist);
      const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
      for (let k = 0; k < len; k++) { out[o] = out[o - d]; o++; }
    }
  }
  if (o !== outLen) throw new Error('inflate: size mismatch ' + o + ' / ' + outLen);
  return out;
}

/** Inflate with the native stream when it exists, else the JS decoder. */
export async function inflate(src, outLen) {
  if (typeof DecompressionStream === 'function' && !(typeof location !== 'undefined' && /[?&]fouerJsInflate=1/.test(location.search))) {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(src); w.close();
      const buf = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      if (buf.length === outLen) return buf;
    } catch (e) { /* fall through to the JS decoder */ }
  }
  return inflateRaw(src, outLen);
}
