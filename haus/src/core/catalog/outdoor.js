// Gartenkatalog. Maße in Metern, platziert auf dem Lageplan (design.outdoor).

const RAW = {
  flaechen: {
    label: 'Flächen & Wege',
    items: [
      ['lawn', 'Rasen', 6, 5, '#7cb872'],
      ['flowerbed', 'Blumenbeet', 2, 1.2, '#c76b98'],
      ['vegPatch', 'Gemüsebeet', 3, 2, '#8a9a5b'],
      ['gravel', 'Kies', 3, 3, '#c9c2b3'],
      ['paving', 'Pflaster', 3, 3, '#b3a99a'],
      ['pathway', 'Gehweg', 6, 1, '#c2b8a3'],
      ['driveway', 'Einfahrt', 5, 6, '#9a9a9a'],
      ['terrace', 'Terrasse', 5, 4, '#c9b79c'],
      ['deck', 'Holzdeck', 5, 4, '#a9825a'],
    ],
  },
  bepflanzung: {
    label: 'Bepflanzung',
    items: [
      ['treeSmall', 'Baum klein', 2, 2, '#4f7a3f'],
      ['treeMedium', 'Baum mittel', 3.5, 3.5, '#3f6a34'],
      ['treeLarge', 'Baum groß', 5, 5, '#355c2c'],
      ['shrub', 'Strauch', 1, 1, '#5c8a4a'],
      ['hedgeSection', 'Hecke (Abschnitt)', 3, 0.5, '#4a7a3f'],
      ['flowerBedRound', 'Rundbeet', 1.8, 1.8, '#c76b98'],
      ['climbingPlant', 'Kletterpflanze', 0.5, 0.5, '#4f8a4a'],
      ['grassOrnamental', 'Ziergras', 1, 1, '#a8b25b'],
    ],
  },
  gebaeude: {
    label: 'Gebäude & große Objekte',
    items: [
      ['garageOut', 'Garage', 6, 6, '#8a8f99'],
      ['carport', 'Carport', 5, 3, '#a3aab3'],
      ['shed', 'Gartenhaus/Schuppen', 3, 2.5, '#9a7a52'],
      ['greenhouse', 'Gewächshaus', 3, 4, '#bfe0e0'],
      ['pool', 'Pool', 8, 4, '#5aa9c9'],
      ['pond', 'Teich', 3, 2, '#4a8ca3'],
      ['pergola', 'Pergola', 3, 3, '#9a7a52'],
      ['fenceSection', 'Zaun (Abschnitt)', 3, 0.2, '#8a7050'],
      ['wallSection', 'Mauer (Abschnitt)', 3, 0.3, '#a39a8c'],
      ['gate', 'Tor', 2, 0.3, '#6b5645'],
    ],
  },
  freizeit: {
    label: 'Freizeit & Kleinkram',
    items: [
      ['playground', 'Spielplatz', 4, 4, '#f2c14e'],
      ['trampoline', 'Trampolin', 3.6, 3.6, '#3a7a4a'],
      ['sandbox', 'Sandkasten', 2, 2, '#e0c88a'],
      ['grillArea', 'Grillplatz', 2, 2, '#8a8f99'],
      ['firepitOut', 'Feuerstelle', 1.5, 1.5, '#5c5c5c'],
      ['seatingArea', 'Sitzecke', 3, 3, '#c9b79c'],
      ['sunshade', 'Sonnenschirm', 1, 1, '#c9564d'],
      ['binStorage', 'Mülltonnenbox', 1.5, 0.8, '#6b6f70'],
      ['clothesLine', 'Wäscheständer', 2, 0.6, '#8a8f99'],
      ['outdoorLight', 'Außenbeleuchtung', 0.4, 0.4, '#e8d98a'],
      ['tennisCourt', 'Tennisplatz', 11, 24, '#3a6a8a'],
      ['helipad', 'Hubschrauberlandeplatz', 8, 8, '#4a4a4a'],
    ],
  },
};

export const OUTDOOR_GROUPS = Object.entries(RAW).map(([key, g]) => ({
  key,
  label: g.label,
  items: g.items.map(([id, name, w, h, color]) => ({ id, name, w, h, color, group: key })),
}));

export const OUTDOOR_TYPES = Object.fromEntries(
  OUTDOOR_GROUPS.flatMap((g) => g.items.map((it) => [it.id, it]))
);

export function findOutdoorType(id) {
  return OUTDOOR_TYPES[id] || { id, name: id, w: 2, h: 2, color: '#999999', group: 'flaechen' };
}
