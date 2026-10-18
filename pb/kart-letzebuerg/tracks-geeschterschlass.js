(function () {
  'use strict';
  const KL = window.KL;
  KL.registerTrack({
    id: 'geeschterschlass', mode: 'spline', hw: 9, wl: 3, wr: 3,
    theme: { facade: 'old', ground: 'grass', verge: 'grass', buildings: false, weathers: ['night', 'fog', 'rain', 'sunset'], startText: 'GEESCHTERSCHLASS' },
    pts: [[0, 0], [90, -10], [160, 50], [150, 140], [70, 190], [-30, 170], [-90, 110], [-70, 30]],
    decorate(S) { },
  });
})();
