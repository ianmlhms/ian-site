/* Beam — QR decoding back-end selection.
 *
 * Everything here returns raw frame BYTES, not a string: the wire format is
 * binary now, which is worth a third of every frame. That rules out
 * BarcodeDetector, whose only output is a DOMString — it was the fastest
 * option on Android but cannot carry binary, and it never existed on iOS
 * anyway. So, best first:
 *
 *   1. worker pool  — zxing-cpp (WASM) in N workers, decoding in parallel
 *   2. inline zxing — same decoder on the main thread, if workers are blocked
 *   3. jsQR         — pure JS, slowest, but its binaryData does carry bytes
 *
 * Every back-end exposes the same shape:
 *   { name, capacity, free(), submit(imageLike) -> Promise<Uint8Array|null> }
 */
(function () {
  'use strict';

  var ZXING_BASE = 'https://cdn.jsdelivr.net/npm/zxing-wasm@1.3.4/dist/';
  var WORKER_URL = 'beam-worker.js?v=1';
  var BOOT_TIMEOUT_MS = 8000;
  var MAX_WORKERS = 4;

  function workerCount() {
    var cores = navigator.hardwareConcurrency || 2;
    /* Leave a core for capture and rendering; more workers than that just adds
       WASM instances (a few MB each) without decoding more frames. */
    return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
  }

  /* ---- 1. worker pool ---- */

  function tryPool() {
    if (typeof Worker === 'undefined') return Promise.resolve(null);

    var slots = [];
    try {
      for (var i = 0; i < workerCount(); i++) {
        slots.push({ w: new Worker(WORKER_URL, { type: 'module' }), busy: false, resolve: null });
      }
    } catch (e) {
      slots.forEach(function (s) { try { s.w.terminate(); } catch (e2) {} });
      return Promise.resolve(null);
    }

    var booted = slots.map(function (slot) {
      return new Promise(function (done) {
        var settled = false;
        var timer = setTimeout(function () {
          if (!settled) { settled = true; done(false); }
        }, BOOT_TIMEOUT_MS);

        slot.w.onmessage = function (e) {
          var msg = e.data || {};
          if (msg.ready !== undefined) {
            if (!settled) { settled = true; clearTimeout(timer); done(!!msg.ready); }
            return;
          }
          var r = slot.resolve;
          slot.resolve = null; slot.busy = false;
          if (r) r(msg.bytes ? new Uint8Array(msg.bytes) : null);
        };
        slot.w.onerror = function () {
          if (!settled) { settled = true; clearTimeout(timer); done(false); }
          var r = slot.resolve;
          slot.resolve = null; slot.busy = false;
          if (r) r(null);
        };
      });
    });

    return Promise.all(booted).then(function (oks) {
      var live = slots.filter(function (_, i) { return oks[i]; });
      slots.filter(function (_, i) { return !oks[i]; })
           .forEach(function (s) { try { s.w.terminate(); } catch (e) {} });
      if (!live.length) return null;

      var seq = 0;
      return {
        name: 'zxing ×' + live.length,
        capacity: live.length,
        free: function () {
          var n = 0;
          for (var i = 0; i < live.length; i++) if (!live[i].busy) n++;
          return n;
        },
        submit: function (img) {
          var slot = null;
          for (var i = 0; i < live.length; i++) { if (!live[i].busy) { slot = live[i]; break; } }
          if (!slot) return Promise.resolve(null);
          slot.busy = true;
          return new Promise(function (resolve) {
            slot.resolve = resolve;
            try {
              var buf = img.data.buffer;
              slot.w.postMessage({ id: ++seq, buf: buf, width: img.width, height: img.height }, [buf]);
            } catch (e) {
              slot.busy = false; slot.resolve = null; resolve(null);
            }
          });
        }
      };
    }).catch(function () { return null; });
  }

  /* ---- 2. inline zxing ---- */

  function tryInline() {
    if (typeof WebAssembly === 'undefined') return Promise.resolve(null);
    return import(/* webpackIgnore: true */ ZXING_BASE + 'es/reader/index.js').then(function (mod) {
      if (!mod || !mod.readBarcodesFromImageData) return null;
      if (mod.setZXingModuleOverrides) {
        mod.setZXingModuleOverrides({
          locateFile: function (path, prefix) {
            return /\.wasm$/.test(path) ? ZXING_BASE + 'reader/' + path : prefix + path;
          }
        });
      }
      var opts = { formats: ['QRCode'], maxNumberOfSymbols: 1,
                   tryHarder: false, tryRotate: false, tryInvert: false };
      var inFlight = 0;
      var api = {
        name: 'zxing',
        capacity: 1,
        free: function () { return inFlight ? 0 : 1; },
        submit: function (img) {
          inFlight++;
          return mod.readBarcodesFromImageData(img, opts).then(function (res) {
            var hit = res && res.filter(function (r) { return r.bytes && r.bytes.length; })[0];
            return hit ? new Uint8Array(hit.bytes) : null;
          }).catch(function () { return null; })
            .then(function (v) { inFlight--; return v; });
        }
      };
      /* Compile now and prove it runs, rather than failing on the first frame. */
      return mod.readBarcodesFromImageData(new ImageData(8, 8), opts)
        .then(function () { return api; })
        .catch(function () { return null; });
    }).catch(function () { return null; });
  }

  /* ---- 3. jsQR ---- */

  function tryJsQR() {
    if (!window.jsQR) return null;
    return {
      name: 'jsQR',
      capacity: 1,
      free: function () { return 1; },
      submit: function (img) {
        var code = window.jsQR(img.data, img.width, img.height,
                               { inversionAttempts: 'dontInvert' });
        /* binaryData is what keeps jsQR usable now the wire format is binary;
           its .data string would mangle every byte above 0x7F. */
        if (code && code.binaryData && code.binaryData.length) {
          return Promise.resolve(new Uint8Array(code.binaryData));
        }
        return Promise.resolve(null);
      }
    };
  }

  function create() {
    return tryPool().then(function (pool) {
      if (pool) return pool;
      return tryInline().then(function (inline) { return inline || tryJsQR(); });
    });
  }

  window.BEAM_DECODE = { create: create };
})();
