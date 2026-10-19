/* Kart Lëtzebuerg — fantasy track 3: Äisbierg (ice mountain). Original design. */
(function () {
  'use strict';
  const KL = window.KL;
  KL.registerTrack({
    id: 'aisbierg',
    theme: { weathers: ['day', 'sunset', 'night', 'snow'], startText: 'ÄISBIERG', buildings: false, lamps: false, skyline: false, ground: 'grass', verge: 'grass' },
    /* ski jump over a crevasse on the descent (bed = deep snow: slow if you fall in); snow-bank hops */
    ramps: [{ s: 105, k: [[0, 0], [10, 2.6], [11.5, -1.6], [13, -3.2], [28, -3.2], [38, 0]] }, { s: 255, k: [[0, 0], [8, 1.7], [9.5, 0]] }, { s: 1380, k: [[0, 0], [8, 1.7], [9.5, 0]] }],
    patches: [{ s0: 548, s1: 640, d0: -12, d1: 12, kind: 'ice' }, { s0: 1110, s1: 1178, d0: -11, d1: 3, kind: 'ice' }, { s0: 118, s1: 134, d0: -12, d1: 12, kind: 'goo' }],
    pads: [[190, 0, 10], [545, 0, 9], [88, 0, 10], [1380, 0, 8], [874, -37.6, 9, 0.8], [977, -29.9, 9, -0.5]],
    extraBoxes: [[915, -40], [920, -37]],
    alts: [{ hw: 4.6, pts: [[-69.9, -251.2], [-183.6, -241.4]] }],
    speedMul: 1.05,
    decorate(S) {},
  });
})();
