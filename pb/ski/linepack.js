/* R7-D: compact piste lines in resort.json (pure: the browser loader and the Node scripts both use it).
 * The piste centre lines ("line") and the painted network ("p") are long [x, z, x, z, ...] lists in metres with one decimal: about
 * two thirds of resort.json. scripts/ski/linepack.py stores them as "lz" / "pz": decimetres, second differences (the lines are resampled
 * at a steady step, so these are tiny), zigzag varints, base64. Lossless at 0.1 m. 3 Vallées: resort.json 440 -> 178 KB gzipped.
 * unpackResort(r) turns them back into "line" / "p" in place; data without them (older bakes) passes through unchanged. */
import { normaliseLifts } from './lift-path.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();

function fromBase64(s) {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_INDEX[clean.charCodeAt(i)];
    if (v < 0) throw new Error('linepack: bad base64');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

/** "lz" string -> [x, z, x, z, ...] in metres (one decimal) */
export function unpackLine(s) {
  const bytes = fromBase64(s);
  const out = [];
  const prev = [0, 0], prevD = [0, 0];
  let k = 0, i = 0;
  while (i < bytes.length) {
    let z = 0, mul = 1, b;
    do { b = bytes[i++]; z += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
    const dd = z % 2 ? -(z + 1) / 2 : z / 2;
    const d = prevD[k] + dd;
    const q = prev[k] + d;
    prevD[k] = d; prev[k] = q;
    out.push(q / 10);
    k ^= 1;
  }
  return out;
}

/** [x, z, ...] -> "lz" (the Node tests check the round trip; the bake packs in Python) */
export function packLine(arr) {
  const bytes = [];
  const prev = [0, 0], prevD = [0, 0];
  arr.forEach((v, j) => {
    const k = j % 2, q = Math.round(v * 10), d = q - prev[k], dd = d - prevD[k];
    prev[k] = q; prevD[k] = d;
    let z = dd < 0 ? -2 * dd - 1 : 2 * dd;
    do { const b = z % 128; z = Math.floor(z / 128); bytes.push(z ? b | 0x80 : b); } while (z);
  });
  let s = '', acc = 0, bits = 0;
  for (const b of bytes) { acc = ((acc << 8) | b) & 0xffffff; bits += 8; while (bits >= 6) { bits -= 6; s += B64[(acc >> bits) & 63]; } }
  if (bits) s += B64[(acc << (6 - bits)) & 63];
  while (s.length % 4) s += '=';
  return s;
}

/** R8c (QA: a piste called "0" in the HUD: OSM puts the piste number in name=): a name that is only a number / a number with a letter /
 *  a single letter ("0", "2a", "G", "3J", "3000") is the piste's ref, shown as "<colour> <ref>" ("Rout 12", "Blo 0"); an empty name
 *  with a ref the same; anything else as it is. The same rule as scripts/ski/bake.py display_name. */
export const DIFF_WORD = Object.freeze({ green: 'Gréng', blue: 'Blo', red: 'Rout', black: 'Schwaarz' });
const BARE_REF = /^(?:\d+[a-z]?|[a-z]\d?|\d[a-z]\d?)$/i;
const ZERO_PREFIX = /^0+\s+(?=\S)/;  // launch: OSM "0 Lumen" (Kronplatz) = piste number 0 glued to the name -> "Lumen"
export function pisteDisplayName(name, ref, diff) {
  const raw = String(name || '').trim(), r = String(ref || '').trim();
  const stripped = raw.replace(ZERO_PREFIX, '');
  const n = BARE_REF.test(stripped) ? raw : stripped;
  const word = DIFF_WORD[diff] || 'Pist';
  if (n && !BARE_REF.test(n)) return n;
  const id = n || r;
  return id ? `${word} ${id}` : `${word} Pist`;
}

/** resort.json object: "lz" -> "line" on pistes, "pz" -> "p" on the network (in place; returns it); R8c: piste display names */
export function unpackResort(r) {
  for (const p of r.pistes || []) {
    if (typeof p.lz === 'string' && !p.line) { p.line = unpackLine(p.lz); delete p.lz; }
    const shown = pisteDisplayName(p.name, p.ref, p.diff);
    if (shown !== p.name) { p.osmName = p.name; p.name = shown; }
  }
  // R8c: two pistes of one colour with the same name ("Doron (Variante)" twice) are numbered: "Doron (Variante 2)"
  const count = new Map();
  for (const p of r.pistes || []) {
    const k = `${p.name.toLowerCase()}|${p.diff}`, n = (count.get(k) || 0) + 1;
    count.set(k, n);
    if (n > 1) { p.osmName = p.osmName || p.name; p.name = p.name.endsWith(')') ? `${p.name.slice(0, -1)} ${n})` : `${p.name} (${n})`; }
  }
  for (const n of r.network || []) if (typeof n.pz === 'string' && !n.p) { n.p = unpackLine(n.pz); delete n.pz; }
  normaliseLifts(r);                                                       // R8e: funitels / DMCs are twin-rope gondolas (lift-path.js)
  return r;
}
