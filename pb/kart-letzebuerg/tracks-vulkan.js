/* Kart Lëtzebuerg — fantasy track 4: Vulkanbierg (volcano). Original design. */
(function () {
  'use strict';
  const KL = window.KL;
  KL.registerTrack({
    id: 'vulkan',
    theme: { weathers: ['day', 'sunset', 'night', 'fog'], startText: 'VULKANBIERG', buildings: false, lamps: false, skyline: false, ground: 'grass', verge: 'grass' },
    ramps: [{ s: 330, k: [[0, 0], [9, 2.3], [10.5, -1.8], [12, -3.4], [27, -3.4], [36, 0]] }, { s: 1030, k: [[0, 0], [10, 2.6], [11.5, -1.6], [13, -3.4], [30, -3.4], [40, 0]] }],
    patches: [{ s0: 342, s1: 358, d0: -12, d1: 12, kind: 'lava' }, { s0: 1044, s1: 1062, d0: -12, d1: 12, kind: 'lava' }],
    hazards: [{ s: 1215, d: 6, r: 4, period: 5.4, on: 1, phase: 0 }, { s: 1240, d: -6, r: 4, period: 5.4, on: 1, phase: 2.7 }, { s: 235, d: 6, r: 4, period: 5.4, on: 1, phase: 1.35 }, { s: 262, d: -6, r: 4, period: 5.4, on: 1, phase: 4.05 }, { s: 960, d: 5, r: 3.6, period: 5.4, on: 1, phase: 0.7 }, { s: 985, d: -5, r: 3.6, period: 5.4, on: 1, phase: 3.4 }],
    pads: [[310, 0, 8], [1016, 0, 10], [727, -3.2, 9, -0.15], [759, -34.4, 9, 0.89]],
    extraBoxes: [[790, -30], [795, -28]],
    alts: [{ hw: 4.6, pts: [[-194.7, 0.7], [-89.6, -72.6]] }],
    decorate(S) {},
  });
})();
