/* Kart Lëtzebuerg — fantasy track 2: Zockerland (candy land). Original design. */
(function () {
  'use strict';
  const KL = window.KL;
  KL.registerTrack({
    id: 'zockerland',
    theme: { weathers: ['day', 'sunset', 'night', 'rain'], startText: 'ZOCKERLAND', buildings: false, lamps: false, skyline: false, ground: 'grass', verge: 'grass' },
    /* the chocolate ford on the last straight: kicker (rise 9 m, lip), river bed 15 m wide (chocolate goo: slow if you fall in), exit ramp; a small marshmallow hop mid-lap */
    ramps: [{ s: 1388, k: [[0, 0], [9, 2.2], [10.5, -1.8], [12, -3.2], [27, -3.2], [36, 0]] }, { s: 804, k: [[0, 0], [8, 1.7], [9.5, 0]] }],
    patches: [{ s0: 1399, s1: 1417, d0: -12, d1: 12, kind: 'goo' }, { s0: 696, s1: 742, d0: -11, d1: -3, kind: 'goo' }, { s0: 970, s1: 1010, d0: 2, d1: 10, kind: 'goo' }],
    pads: [[170, 0, 10], [1372, 0, 10], [800, 0, 8], [426, 31.6, 9, -0.62], [497, 28.9, 9, 0.23]],
    extraBoxes: [[460, 33], [465, 30]],
    speedMul: 1.04,
    alts: [{ hw: 4.6, pts: [[266.9, 90.6], [229, 189.9]] }],
    decorate(S) {},
  });
})();
