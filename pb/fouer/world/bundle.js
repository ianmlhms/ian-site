/* Schueberfouer Tycoon, W2: loads pb/fouer/data/glacis-world.bin (scripts/bake_fouer_world.py).
 * Layout after inflate:  'FGW1' | u32 headerLen | header JSON | blob.  Header refs are [offset, length] into the blob. */
import { inflate } from './inflate.js';

export const BUNDLE_URL = '/pb/fouer/data/glacis-world.bin?v=1';

export async function loadBundle(url = BUNDLE_URL, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('world bundle HTTP ' + res.status);
  let packed;
  const total = Number(res.headers.get('content-length')) || 0;
  if (res.body && res.body.getReader && onProgress) {
    const rd = res.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length; onProgress(total ? Math.min(0.9, got / total) : 0.5);
    }
    packed = new Uint8Array(got); let o = 0; parts.forEach((p) => { packed.set(p, o); o += p.length; });
  } else packed = new Uint8Array(await res.arrayBuffer());
  const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  if (String.fromCharCode(packed[0], packed[1], packed[2], packed[3]) !== 'FGWZ') throw new Error('world bundle: bad magic');
  const rawLen = dv.getUint32(4, true);
  const raw = await inflate(packed.subarray(8), rawLen);
  if (String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'FGW1') throw new Error('world bundle: bad payload');
  const hl = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + hl)));
  if (header.v !== 1) throw new Error('world bundle: version ' + header.v);
  const base = 8 + hl;
  return {
    header,
    bytes: packed.length,
    rawBytes: rawLen,
    /** a view of one section (no copy) */
    view: (ref) => raw.subarray(base + ref[0], base + ref[0] + ref[1]),
    /** an own ArrayBuffer of one section (the Luxtram parsers want a plain ArrayBuffer) */
    copy: (ref) => raw.slice(base + ref[0], base + ref[0] + ref[1]).buffer,
  };
}
