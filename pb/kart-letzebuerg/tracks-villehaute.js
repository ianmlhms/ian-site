/* Kart Lëtzebuerg — track 1: Uewerstad (Ville Haute, Luxembourg City).
 * Layout follows real streets (OpenStreetMap, ODbL): Boulevard Roosevelt past the Gëlle Fra, Rue de l'Ancien Athénée,
 * Rue Notre-Dame along the cathedral, Rue du Fossé, Place Guillaume II (Hôtel de Ville), Place d'Armes, Avenue Monterey, Avenue de la Porte-Neuve.
 * Coordinates are metres from 49.6105 N / 6.1295 E (x east, z south). */
(function () {
  'use strict';
  const KL = window.KL;
  KL.registerTrack({
    id: 'villehaute', hw: 9, r: 26, origin: [49.6105, 6.1295],
    theme: { facade: 'old', verge: 'slabs', ground: 'slabs', groundTint: '#cfcac2', farColor: '#b9b4ab', weathers: ['day', 'sunset', 'night', 'rain'], startText: 'UEWERSTAD · KART LËTZEBUERG', wallColor: '#d3c9b6', wallTop: '#e6dfcf' },
    pts: [
      [-232, 100, { r: 34, hw: 10 }], [-120, 104, { hw: 11 }], [-62, 106, { r: 16 }], [-37, 122, { r: 12 }], [-31, 148, { r: 16 }], [-10, 164, { r: 20 }], [14, 148, { r: 16 }], [18, 122, { r: 12 }], [40, 106, { r: 16 }], [61, 104, { r: 18 }],
      [62, 56, { r: 20 }], [190, 45, { r: 34 }], [162, -24, { r: 46 }], [50, -24, { r: 30 }], [56, -78, { r: 24 }], [12, -66, { r: 30 }],
      [-100, -50], [-180, -38, { hw: 10 }], [-232, -30, { r: 34 }], [-232, 50],
    ],
    pads: [[330, 0, 9], [860, 0, 9]],
    decorate(S) { /* landmarks are added in phase-1 step 2 */ },
  });
})();
