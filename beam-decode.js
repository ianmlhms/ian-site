/* Beam — QR decoding back-end selection.
 *
 * Decode speed is the whole bottleneck of this app: the sender can paint
 * frames far faster than a phone can read them, so throughput is simply
 * "how many frames per second can we decode". Three back-ends, best first:
 *
 *   1. BarcodeDetector  — native, hardware-accelerated. Android Chrome.
 *   2. zxing-cpp (WASM) — fast C++ decoder. Works everywhere, notably iOS
 *                         Safari, which has never shipped BarcodeDetector.
 *   3. jsQR             — pure JS, slowest. Last-resort fallback so the page
 *                         still works if the CDN or WASM is blocked.
 *
 * Every back-end is wrapped to the same shape: detect(canvas, imageData)
 * resolving to a string or null. Failures degrade to the next back-end rather
 * than breaking the page.
 */
(function () {
  'use strict';

  var ZXING_BASE = 'https://cdn.jsdelivr.net/npm/zxing-wasm@1.3.4/dist/';

  function fromBarcodeDetector() {
    if (!window.BarcodeDetector) return null;
    var det;
    try { det = new window.BarcodeDetector({ formats: ['qr_code'] }); }
    catch (e) { return null; }
    return {
      name: 'BarcodeDetector',
      /* Reads the <video> element straight off the compositor, so the caller
         can skip drawImage + getImageData entirely — both are expensive per
         frame and pure waste here. */
      needsImageData: false,
      detect: function (source) {
        return det.detect(source).then(function (codes) {
          return codes && codes.length ? codes[0].rawValue : null;
        });
      }
    };
  }

  /* Dynamic import of an ES module from inside a classic script. The WASM
     binary lives next to the module on the CDN, so point locateFile at it. */
  function fromZxing() {
    if (typeof WebAssembly === 'undefined') return Promise.resolve(null);
    var url = ZXING_BASE + 'es/reader/index.js';
    return import(/* webpackIgnore: true */ url).then(function (mod) {
      if (!mod || !mod.readBarcodesFromImageData) return null;
      if (mod.setZXingModuleOverrides) {
        mod.setZXingModuleOverrides({
          locateFile: function (path, prefix) {
            return /\.wasm$/.test(path) ? ZXING_BASE + 'reader/' + path : prefix + path;
          }
        });
      }
      var opts = {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
        tryHarder: false,      // at 24 fps we want speed; a miss costs nothing
        tryRotate: false,
        tryInvert: false
      };
      var wrapper = {
        name: 'zxing-wasm',
        needsImageData: true,
        detect: function (source, imageData) {
          return mod.readBarcodesFromImageData(imageData, opts).then(function (res) {
            if (!res || !res.length) return null;
            return res[0].text != null ? res[0].text : res[0].rawValue;
          });
        }
      };
      /* Force the module to compile now and prove it actually decodes,
         rather than discovering it is broken mid-transfer. */
      var probe = new ImageData(new Uint8ClampedArray(4 * 4 * 4).fill(255), 4, 4);
      return wrapper.detect(null, probe).then(function () { return wrapper; })
        .catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function fromJsQR() {
    if (!window.jsQR) return null;
    return {
      name: 'jsQR',
      needsImageData: true,
      detect: function (source, imageData) {
        var code = window.jsQR(imageData.data, imageData.width, imageData.height,
                               { inversionAttempts: 'dontInvert' });
        return Promise.resolve(code ? code.data : null);
      }
    };
  }

  /* Resolves to the fastest working back-end, or null if none work. */
  function create() {
    var native = fromBarcodeDetector();
    if (native) return Promise.resolve(native);
    return fromZxing().then(function (zx) {
      return zx || fromJsQR();
    });
  }

  window.BEAM_DECODE = { create: create };
})();
