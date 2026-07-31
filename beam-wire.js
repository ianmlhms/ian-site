/* Beam — wire format (binary).
 *
 * Frames are raw bytes in QR byte mode. An earlier version base64'd them,
 * which cost 33% of every frame for nothing but decoder compatibility:
 * BarcodeDetector only hands back a string, so binary was unreadable there.
 * Dropping BarcodeDetector in favour of zxing-cpp (faster anyway, and the only
 * option on iOS regardless) buys that third of the payload back — measured:
 * 2953 usable bytes in a v40 code instead of 2100.
 *
 * Layout, data frame:
 *   [0]     0xB3        magic
 *   [1]     0x44 'D'    kind
 *   [2..5]  size        total file bytes, big-endian
 *   [6..7]  blockSize
 *   [8..9]  seed
 *   [10..]  payload     exactly blockSize bytes
 *
 * Meta frame: magic, 0x4D 'M', then UTF-8 JSON {n,t,s}.
 *
 * DOM-free so it can be unit-tested in Node: a bug here corrupts files
 * silently, which is far worse than a bug that simply fails to decode.
 */
(function () {
  'use strict';

  var MAGIC = 0xB3;
  var KIND_DATA = 0x44;                      // 'D'
  var KIND_META = 0x4D;                      // 'M'
  var HEADER_BYTES = 10;
  var META_HEADER_BYTES = 2;
  var MAX_DECLARED_SIZE = 512 * 1024 * 1024; // sanity bound on a decoded header
  var MAX_BLOCK_SIZE = 4096;                 // QR v40 at ECC L holds 2953 bytes

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

  /* ---- building ---- */

  function dataFrame(size, blockSize, seed, payload) {
    var out = new Uint8Array(HEADER_BYTES + payload.length);
    out[0] = MAGIC; out[1] = KIND_DATA;
    out[2] = (size >>> 24) & 255; out[3] = (size >>> 16) & 255;
    out[4] = (size >>> 8) & 255;  out[5] = size & 255;
    out[6] = (blockSize >>> 8) & 255; out[7] = blockSize & 255;
    out[8] = (seed >>> 8) & 255;      out[9] = seed & 255;
    out.set(payload, HEADER_BYTES);
    return out;
  }

  /* padTo: pad the JSON so the meta frame is the same length as a data frame,
     which pins every frame in the stream to one QR version. A code that
     changes size makes the receiving camera refocus, costing far more frames
     than the padding does. Trailing whitespace is legal JSON, so the padding
     needs no handling on the way back. */
  function metaFrame(name, mime, size, padTo) {
    var body = utf8Bytes(JSON.stringify({ n: name, t: mime, s: size }));
    var room = padTo ? padTo - META_HEADER_BYTES : 0;

    if (room && body.length > room) {
      /* Too long to pad: shorten the name rather than let the frame grow back
         to a different QR version. */
      var fixed = utf8Bytes(JSON.stringify({ n: '', t: mime, s: size })).length;
      var cut = name;
      while (cut.length > 1 && utf8Bytes(cut).length > Math.max(0, room - fixed)) {
        cut = cut.slice(0, -1);
      }
      body = utf8Bytes(JSON.stringify({ n: cut, t: mime, s: size }));
    }

    var len = room > body.length ? room : body.length;
    var out = new Uint8Array(META_HEADER_BYTES + len);
    out[0] = MAGIC; out[1] = KIND_META;
    out.fill(32, META_HEADER_BYTES);         // spaces
    out.set(body, META_HEADER_BYTES);
    return out;
  }

  /* ---- parsing ---- */

  /* Returns {kind:'data'|'meta', ...} or null. A camera pointed at the world
     produces junk constantly; none of it may throw, and none of it may be
     mistaken for a frame. */
  function parseFrame(bytes) {
    if (!bytes || typeof bytes.length !== 'number') return null;
    if (bytes.length < META_HEADER_BYTES + 1) return null;
    if (bytes[0] !== MAGIC) return null;

    if (bytes[1] === KIND_META) {
      var json = utf8String(bytes.subarray(META_HEADER_BYTES));
      if (!json) return null;
      var m;
      try { m = JSON.parse(json); } catch (e) { return null; }
      if (!m || typeof m.n !== 'string') return null;
      return { kind: 'meta', name: m.n, mime: typeof m.t === 'string' ? m.t : '', size: m.s };
    }

    if (bytes[1] !== KIND_DATA) return null;
    if (bytes.length <= HEADER_BYTES) return null;

    var size = (bytes[2] * 16777216) + (bytes[3] << 16) + (bytes[4] << 8) + bytes[5];
    var blockSize = (bytes[6] << 8) + bytes[7];
    var seed = (bytes[8] << 8) + bytes[9];
    if (size <= 0 || size > MAX_DECLARED_SIZE) return null;
    if (blockSize <= 0 || blockSize > MAX_BLOCK_SIZE) return null;
    /* The payload must be exactly one block: a truncated or padded read is a
       misdecode, and feeding it to the fountain would corrupt real blocks. */
    if (bytes.length - HEADER_BYTES !== blockSize) return null;

    return { kind: 'data', size: size, blockSize: blockSize, seed: seed,
             payload: bytes.subarray(HEADER_BYTES) };
  }

  /* qrcode-generator takes a string; in byte mode each char maps to one byte,
     so latin1 round-trips binary exactly. Chunked because apply() blows the
     argument limit on a full-size v40 frame. */
  function toLatin1(bytes) {
    var s = '', CHUNK = 8192;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return s;
  }

  var api = {
    MAGIC: MAGIC, HEADER_BYTES: HEADER_BYTES, META_HEADER_BYTES: META_HEADER_BYTES,
    MAX_BLOCK_SIZE: MAX_BLOCK_SIZE,
    utf8Bytes: utf8Bytes, utf8String: utf8String,
    dataFrame: dataFrame, metaFrame: metaFrame, parseFrame: parseFrame,
    toLatin1: toLatin1
  };
  if (typeof window !== 'undefined') window.BEAM_WIRE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
