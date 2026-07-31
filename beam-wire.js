/* Beam — wire format.
 *
 * Everything that turns bytes into the text inside a QR code and back again.
 * Kept DOM-free so it can be unit-tested in Node: a bug here corrupts files
 * silently, which is far worse than a bug that simply fails to decode.
 *
 * Frame text is base64 with a one-char kind prefix:
 *   "D" + base64( size(4) | blockSize(2) | seed(2) | payload )
 *   "M" + base64( utf8 JSON {n:name, t:mime, s:size} )
 *
 * base64 (not raw binary) because QR byte mode round-trips through the
 * decoders as a UTF-8 *string*; non-ASCII bytes would be mangled.
 */
(function () {
  'use strict';

  var HEADER_BYTES = 8;
  var MAX_DECLARED_SIZE = 8 * 1024 * 1024;   // sanity bound on a decoded header
  var MAX_BLOCK_SIZE = 2048;

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64INV = (function () {
    var t = {};
    for (var i = 0; i < B64.length; i++) t[B64.charAt(i)] = i;
    return t;
  })();

  function toBase64(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) +
             B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
    }
    var rest = bytes.length - i;
    if (rest === 1) {
      out += B64.charAt(bytes[i] >> 2) + B64.charAt((bytes[i] << 4) & 63) + '==';
    } else if (rest === 2) {
      var m = (bytes[i] << 8) | bytes[i + 1];
      out += B64.charAt(m >> 10) + B64.charAt((m >> 4) & 63) + B64.charAt((m << 2) & 63) + '=';
    }
    return out;
  }

  /* Returns null on anything malformed. A camera pointed at the world will
     hand us junk strings constantly; none of them may throw. */
  function fromBase64(str) {
    if (typeof str !== 'string') return null;
    var clean = str.replace(/=+$/, '');
    var out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    var acc = 0, bits = 0, p = 0;
    for (var i = 0; i < clean.length; i++) {
      var v = B64INV[clean.charAt(i)];
      if (v === undefined) return null;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[p++] = (acc >>> bits) & 255; }
    }
    return out.subarray(0, p);
  }

  function utf8Bytes(str) {
    var esc = encodeURIComponent(str), out = [];
    for (var i = 0; i < esc.length; i++) {
      if (esc.charAt(i) === '%') { out.push(parseInt(esc.substr(i + 1, 2), 16)); i += 2; }
      else out.push(esc.charCodeAt(i));
    }
    return new Uint8Array(out);
  }

  function utf8String(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += '%' + ('0' + bytes[i].toString(16)).slice(-2);
    try { return decodeURIComponent(s); } catch (e) { return null; }
  }

  /* ---- frames ---- */

  function dataFrame(size, blockSize, seed, payload) {
    var body = new Uint8Array(HEADER_BYTES + payload.length);
    body[0] = (size >>> 24) & 255; body[1] = (size >>> 16) & 255;
    body[2] = (size >>> 8) & 255;  body[3] = size & 255;
    body[4] = (blockSize >>> 8) & 255; body[5] = blockSize & 255;
    body[6] = (seed >>> 8) & 255;      body[7] = seed & 255;
    body.set(payload, HEADER_BYTES);
    return 'D' + toBase64(body);
  }

  function metaFrame(name, mime, size) {
    return 'M' + toBase64(utf8Bytes(JSON.stringify({ n: name, t: mime, s: size })));
  }

  /* Parse any frame text. Returns {kind:'data',...}, {kind:'meta',...} or null. */
  function parseFrame(text) {
    if (typeof text !== 'string' || text.length < 2) return null;
    var kind = text.charAt(0);
    if (kind !== 'D' && kind !== 'M') return null;

    var bytes = fromBase64(text.substring(1));
    if (!bytes) return null;

    if (kind === 'M') {
      var json = utf8String(bytes);
      if (!json) return null;
      var m;
      try { m = JSON.parse(json); } catch (e) { return null; }
      if (!m || typeof m.n !== 'string') return null;
      return { kind: 'meta', name: m.n, mime: typeof m.t === 'string' ? m.t : '', size: m.s };
    }

    if (bytes.length <= HEADER_BYTES) return null;
    var size = (bytes[0] * 16777216) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    var blockSize = (bytes[4] << 8) + bytes[5];
    var seed = (bytes[6] << 8) + bytes[7];
    if (size <= 0 || size > MAX_DECLARED_SIZE) return null;
    if (blockSize <= 0 || blockSize > MAX_BLOCK_SIZE) return null;
    /* The payload must be exactly one block: a truncated or padded read is a
       misdecode, and feeding it to the fountain would corrupt real blocks. */
    if (bytes.length - HEADER_BYTES !== blockSize) return null;

    return { kind: 'data', size: size, blockSize: blockSize, seed: seed,
             payload: bytes.subarray(HEADER_BYTES) };
  }

  var api = {
    HEADER_BYTES: HEADER_BYTES,
    toBase64: toBase64, fromBase64: fromBase64,
    utf8Bytes: utf8Bytes, utf8String: utf8String,
    dataFrame: dataFrame, metaFrame: metaFrame, parseFrame: parseFrame
  };
  if (typeof window !== 'undefined') window.BEAM_WIRE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
