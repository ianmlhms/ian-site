/* Beam — QR decode worker.
 *
 * Decoding is the entire bottleneck: the sender can paint frames far faster
 * than a phone can read them, so throughput is simply "frames decoded per
 * second". Running zxing on the main thread caps that at whatever is left
 * over after rendering; several workers decode in parallel instead.
 *
 * One frame in flight per worker. Frames are disposable — the fountain code
 * does not care which ones are dropped — so the main thread simply skips a
 * frame when every worker is busy rather than queueing.
 */
const BASE = 'https://cdn.jsdelivr.net/npm/zxing-wasm@1.3.4/dist/';

const OPTS = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1,
  tryHarder: false,      // at 30 fps we want speed; a missed frame costs nothing
  tryRotate: false,
  tryInvert: false
};

let read = null;

/* Reconstruct the frame the main thread transferred to us. ImageData is not
   guaranteed to exist in every worker scope, and zxing only reads
   data/width/height, so duck-type it when the constructor is missing. */
function asImage(buf, width, height) {
  const px = new Uint8ClampedArray(buf);
  if (typeof ImageData !== 'undefined') {
    try { return new ImageData(px, width, height); } catch (e) { /* fall through */ }
  }
  return { data: px, width: width, height: height, colorSpace: 'srgb' };
}

async function boot() {
  const mod = await import(BASE + 'es/reader/index.js');
  if (mod.setZXingModuleOverrides) {
    mod.setZXingModuleOverrides({
      locateFile: (path, prefix) =>
        /\.wasm$/.test(path) ? BASE + 'reader/' + path : prefix + path
    });
  }
  read = mod.readBarcodesFromImageData;
  /* Compile the WASM now and prove it decodes, rather than discovering it is
     broken on the first real frame. */
  await read(asImage(new ArrayBuffer(8 * 8 * 4), 8, 8), OPTS);
  self.postMessage({ ready: true });
}

boot().catch((e) => {
  self.postMessage({ ready: false, error: String((e && e.message) || e) });
});

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.buf === undefined) return;
  if (!read) { self.postMessage({ id: msg.id, bytes: null }); return; }

  try {
    const results = await read(asImage(msg.buf, msg.width, msg.height), OPTS);
    const hit = results && results.find((r) => r.bytes && r.bytes.length);
    if (hit) {
      const bytes = hit.bytes instanceof Uint8Array ? hit.bytes : new Uint8Array(hit.bytes);
      self.postMessage({ id: msg.id, bytes: bytes }, [bytes.buffer]);
    } else {
      self.postMessage({ id: msg.id, bytes: null });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, bytes: null });
  }
};
