/* Kart Lëtzebuerg — street furniture for the real-street tracks: benches, litter bins, red-white bollards, bus stops with a shelter, bike racks,
 * planters and road signs. Everything is merged into ONE static batch (one extra draw call per track), placed on the pavement strip between the
 * kerb and the wall line (the same strip the lamps stand on), facing the road. Loaded on demand with the track that uses it (tracks-index.js). */
(function () {
  'use strict';
  const KL = window.KL, col = KL.col, L = KL.lm;
  const F = (KL.furniture = {});
  const K = 1.45;                                   // a little oversized, like everything in the game: the kart is big, so small things must still read
  const Lb = (B, f, lx, ly, lz, sx, sy, sz, yaw, c) => L.box(B, f, lx * K, ly * K, lz * K, sx * K, sy * K, sz * K, yaw, c);
  const Lc = (B, f, lx, ly, lz, r0, r1, h, seg, c) => L.cyl(B, f, lx * K, ly * K, lz * K, r0 * K, r1 * K, h * K, seg, c);
  const wood = col('#8b5a34'), woodD = col('#6d4526'), steel = col('#3a3f47'), green = col('#2f5a3e'), greenD = col('#244632'), red = col('#d33a3a'), white = col('#f1efe9');
  const blue = col('#2b63b8'), glass = col('#9fc3d6'), stone = col('#b9b4aa'), leaf = col('#5f9a44'), yellow = col('#f2c230');

  F.bench = (B, f) => {                          // local +z points at the road
    Lb(B, f, 0, 0.44, 0.0, 1.7, 0.07, 0.46, 0, wood);
    Lb(B, f, 0, 0.62, -0.22, 1.7, 0.36, 0.06, 0, woodD);
    for (const sx of [-0.7, 0.7]) Lb(B, f, sx, 0, -0.02, 0.07, 0.44, 0.4, 0, steel);
  };
  F.bin = (B, f) => {
    Lc(B, f, 0, 0, 0, 0.26, 0.26, 0.86, 8, green); Lc(B, f, 0, 0.86, 0, 0.29, 0.29, 0.07, 8, greenD); Lb(B, f, 0, 0.5, 0.25, 0.22, 0.14, 0.04, 0, white);
  };
  F.bollard = (B, f) => { Lc(B, f, 0, 0, 0, 0.11, 0.11, 0.86, 6, white); Lc(B, f, 0, 0.5, 0, 0.115, 0.115, 0.14, 6, red); Lc(B, f, 0, 0.78, 0, 0.12, 0.12, 0.08, 6, red); };
  F.planter = (B, f) => { Lb(B, f, 0, 0, 0, 1.0, 0.55, 1.0, 0, stone); B.sphere(...L.frame(f)(0, 0.85 * K, 0), 0.55 * K, 6, leaf, { noise: 1, sy: 0.8 }); };
  F.bikeRack = (B, f) => { for (let i = 0; i < 4; i++) { const x = -0.9 + i * 0.6; Lb(B, f, x, 0, 0, 0.05, 0.8, 0.05, 0, steel); Lb(B, f, x, 0.8, 0, 0.05, 0.05, 0.5, 0, steel); Lb(B, f, x, 0, 0.25, 0.05, 0.8, 0.05, 0, steel); } };
  F.sign = (B, f, c) => { Lc(B, f, 0, 0, 0, 0.04, 0.04, 2.3, 5, steel); Lc(B, f, 0, 1.95, 0.06, 0.34, 0.34, 0.05, 10, red); Lc(B, f, 0, 1.97, 0.065, 0.26, 0.26, 0.05, 10, c || blue); };
  F.busStop = (B, f) => {                       // shelter with a glass back, a timetable post with the yellow "H" plate and a bench
    for (const sx of [-1.6, 1.6]) Lb(B, f, sx, 0, -0.55, 0.1, 2.4, 0.1, 0, steel);
    Lb(B, f, 0, 2.4, -0.25, 3.8, 0.1, 1.5, 0, steel); Lb(B, f, 0, 2.5, -0.25, 3.5, 0.04, 1.3, 0, glass);
    Lb(B, f, 0, 0.5, -0.56, 3.1, 1.85, 0.05, 0, glass);
    Lb(B, f, 0, 0.45, -0.3, 2.2, 0.06, 0.4, 0, wood);
    Lc(B, f, 2.5, 0, 0.1, 0.04, 0.04, 2.7, 5, steel); Lb(B, f, 2.5, 2.2, 0.1, 0.5, 0.5, 0.05, 0, yellow); Lb(B, f, 2.5, 1.5, 0.1, 0.4, 0.55, 0.04, 0, white);
  };

  /* S: the decorate() context; o = { sFrom, sTo, skip: [[s0, s1]], bench, bin, bollard, planter, bikes (every N metres), busStops: [s...], signs: [s...], seed } */
  F.street = function (S, o) {
    const { track } = S, rnd = KL.rng(o.seed || 5), B = new KL.Batch();
    const inSkip = (s) => (o.skip || []).some(([a, b]) => s >= a && s <= b);
    const frame = (s, side, inset) => {
      const i = Math.floor(s / track.step) % track.N, lim = track.HW[i] + (side < 0 ? track.WL[i] : track.WR[i]);
      const p = track.at(s, side * Math.max(1.1, lim - inset));
      return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(p.tz * side, -p.tx * side), lim };
    };
    const place = (fn, s, side, inset) => { if (inSkip(s)) return; const f = frame(s, side, inset); if (f.lim < 2.1) return; fn(B, f); };
    const a = o.sFrom != null ? o.sFrom : 20, b = o.sTo != null ? o.sTo : track.length - 20;
    let side = 1;
    for (let s = a; s < b; s += o.bench || 44) { place(F.bench, s + rnd() * 10, side, 1.2); side = -side; }
    for (let s = a + 22; s < b; s += o.bin || 40) place(F.bin, s + rnd() * 6, rnd() < 0.5 ? 1 : -1, 0.8);
    for (let s = a + 9; s < b; s += o.planter || 61) place(F.planter, s, rnd() < 0.5 ? 1 : -1, 1.5);
    for (let s = a + 35; s < b; s += o.bikes || 190) place(F.bikeRack, s, rnd() < 0.5 ? 1 : -1, 1.3);
    for (const s of o.busStops || []) place(F.busStop, s, 1, 1.7);
    for (const s of o.signs || []) place((BB, f) => F.sign(BB, f, rnd() < 0.5 ? blue : red), s, rnd() < 0.5 ? 1 : -1, 0.7);
    // bollard rows at the corners of the kerb: every ~14 m for a stretch, both sides
    for (const [s0, s1] of o.bollards || []) for (let s = s0; s < s1; s += 3.2) for (const sd of [-1, 1]) place(F.bollard, s, sd, 0.5);
    S.add(B, S.mats.plain);
    return B;
  };
})();
