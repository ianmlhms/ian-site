/* Beam — LT fountain codec.
 *
 * The point of a fountain code here: the receiver is a camera pointed at a
 * looping animation. It WILL miss frames, and it cannot ask for a re-send.
 * So instead of numbered chunks, the sender emits an endless stream of random
 * XOR combinations of the file's blocks. Any sufficiently large subset — no
 * matter which frames were missed — reconstructs the file.
 *
 * Pure logic, no DOM: this file is unit-tested in Node.
 */
(function () {
  'use strict';

  /* Deterministic PRNG. The sender puts only a 16-bit seed in each packet;
     the receiver replays the exact same block choice from it. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Degree distribution: mostly ideal-soliton, with a deliberate spike of
     degree-1 packets. Without that spike the peeling decoder has nothing to
     start from and stalls forever. */
  function degreeFor(rand, k) {
    if (k <= 1) return 1;
    if (rand() < 0.08) return 1;
    var u = rand();
    var d = Math.floor(1 / Math.max(u, 1e-9)) + 1;
    return Math.min(d, k);
  }

  /* Which block indices this seed mixes together. Must be identical on both
     sides, so it depends only on (seed, k). */
  function blocksFor(seed, k) {
    var rand = mulberry32(seed);
    var d = degreeFor(rand, k);
    var picked = {}, list = [];
    var guard = 0;
    while (list.length < d && guard++ < d * 40) {
      var i = Math.floor(rand() * k) % k;
      if (!picked[i]) { picked[i] = 1; list.push(i); }
    }
    return list;
  }

  function xorInto(target, source) {
    for (var i = 0; i < target.length; i++) target[i] ^= source[i];
  }

  /* ---- encoder ---- */

  function Encoder(bytes, blockSize) {
    this.blockSize = blockSize;
    this.size = bytes.length;
    this.k = Math.max(1, Math.ceil(bytes.length / blockSize));
    this.blocks = [];
    for (var i = 0; i < this.k; i++) {
      var b = new Uint8Array(blockSize);
      b.set(bytes.subarray(i * blockSize, Math.min((i + 1) * blockSize, bytes.length)));
      this.blocks.push(b);
    }
    this.seed = 0;
  }

  /* Next packet payload for a given seed (caller supplies/rotates the seed so
     the stream is reproducible and testable). */
  Encoder.prototype.packet = function (seed) {
    var idx = blocksFor(seed, this.k);
    var out = new Uint8Array(this.blockSize);
    for (var i = 0; i < idx.length; i++) xorInto(out, this.blocks[idx[i]]);
    return out;
  };

  /* ---- decoder ---- */

  function Decoder(k, blockSize, size) {
    this.k = k; this.blockSize = blockSize; this.size = size;
    this.solved = new Array(k);      // index -> Uint8Array
    this.solvedCount = 0;
    this.pending = [];               // {idx:Set-ish array, data:Uint8Array}
    this.seen = {};
  }

  Decoder.prototype.isComplete = function () { return this.solvedCount >= this.k; };
  Decoder.prototype.progress = function () { return this.solvedCount / this.k; };

  /* Has this packet already been counted? Callers use it to report how many
     *distinct* frames have landed, which is the only smooth progress signal
     a fountain decoder offers. */
  Decoder.prototype.hasSeen = function (seed) { return !!this.seen[seed]; };

  /* Feed one received packet. Returns true if it advanced decoding. */
  Decoder.prototype.add = function (seed, data) {
    if (this.seen[seed]) return false;
    this.seen[seed] = 1;
    var entry = { idx: blocksFor(seed, this.k), data: new Uint8Array(data) };
    this.pending.push(entry);
    return this.reduce();
  };

  /* Peeling: strip already-known blocks out of every pending packet; any
     packet reduced to a single unknown block solves it, which may cascade. */
  Decoder.prototype.reduce = function () {
    var progressed = false, changed = true;
    while (changed) {
      changed = false;
      for (var p = 0; p < this.pending.length; p++) {
        var e = this.pending[p];
        var unknown = [];
        for (var i = 0; i < e.idx.length; i++) {
          var b = e.idx[i];
          if (this.solved[b]) xorInto(e.data, this.solved[b]);
          else unknown.push(b);
        }
        e.idx = unknown;
        if (unknown.length === 0) {
          this.pending.splice(p--, 1);            // redundant packet
        } else if (unknown.length === 1) {
          this.solved[unknown[0]] = e.data;
          this.solvedCount++;
          this.pending.splice(p--, 1);
          changed = true; progressed = true;
        }
      }
    }
    return progressed;
  };

  Decoder.prototype.result = function () {
    if (!this.isComplete()) return null;
    var out = new Uint8Array(this.k * this.blockSize);
    for (var i = 0; i < this.k; i++) out.set(this.solved[i], i * this.blockSize);
    return out.subarray(0, this.size);
  };

  var api = { Encoder: Encoder, Decoder: Decoder, blocksFor: blocksFor, mulberry32: mulberry32 };
  if (typeof window !== 'undefined') window.BEAM_FOUNTAIN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
