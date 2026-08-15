// Möbelkatalog. Maße in Metern (Breite x Tiefe), Rasterschritt ist FURN_GRID (0.125 m).
// Kompakte Tabellenform: [id, name, w, h, color] je Gruppe.

const RAW = {
  wohnen: {
    label: 'Wohnen',
    items: [
      ['sofa2', 'Sofa 2-Sitzer', 1.6, 0.9, '#7d6b5d'],
      ['sofa3', 'Sofa 3-Sitzer', 2.1, 0.9, '#7d6b5d'],
      ['sofaCorner', 'Ecksofa', 2.6, 2.0, '#7d6b5d'],
      ['armchair', 'Sessel', 0.8, 0.8, '#8a7561'],
      ['coffeeTable', 'Couchtisch', 1.1, 0.6, '#a9866b'],
      ['tvUnit', 'TV-Board', 1.6, 0.4, '#5a4a3d'],
      ['bookshelf', 'Bücherregal', 1.0, 0.35, '#6b5645'],
      ['rug', 'Teppich', 2.0, 1.4, '#c2a878'],
      ['fireplaceUnit', 'Kamin', 1.0, 0.5, '#4a3f3a'],
      ['sideTable', 'Beistelltisch', 0.5, 0.5, '#a9866b'],
      ['floorLamp', 'Stehlampe', 0.4, 0.4, '#d9c9a3'],
      ['pianoUpright', 'Klavier', 1.5, 0.6, '#2e2622'],
      ['plantLarge', 'Grünpflanze groß', 0.5, 0.5, '#4f7a3f'],
    ],
  },
  essen: {
    label: 'Essen',
    items: [
      ['diningTable4', 'Esstisch 4 Personen', 1.4, 0.8, '#8a6b4d'],
      ['diningTable6', 'Esstisch 6 Personen', 1.8, 0.9, '#8a6b4d'],
      ['diningTable8', 'Esstisch 8 Personen', 2.2, 1.0, '#8a6b4d'],
      ['chair', 'Stuhl', 0.45, 0.45, '#6b5645'],
      ['sideboard', 'Sideboard', 1.6, 0.45, '#5a4a3d'],
      ['barCart', 'Barwagen', 0.6, 0.4, '#7d6b5d'],
      ['diningBench', 'Sitzbank', 1.4, 0.4, '#7d6b5d'],
    ],
  },
  kueche: {
    label: 'Küche',
    items: [
      ['counterStraight', 'Küchenzeile gerade', 2.4, 0.6, '#c9c2b3'],
      ['counterCornerL', 'Küchenzeile L-Form', 2.4, 2.4, '#c9c2b3'],
      ['kitchenIsland', 'Kücheninsel', 1.8, 0.9, '#c9c2b3'],
      ['stove', 'Herd', 0.6, 0.6, '#3a3a3a'],
      ['sink', 'Spüle', 0.8, 0.6, '#b8c4c9'],
      ['fridge', 'Kühlschrank', 0.7, 0.7, '#dfe3e6'],
      ['fridgeBig', 'Side-by-Side-Kühlschrank', 0.9, 0.7, '#dfe3e6'],
      ['dishwasher', 'Spülmaschine', 0.6, 0.6, '#c4cbcf'],
      ['ovenTower', 'Backofenturm', 0.6, 0.6, '#3a3a3a'],
      ['pantryUnit', 'Vorratsschrank', 0.6, 0.6, '#c9c2b3'],
      ['kitchenTableSmall', 'Küchentisch klein', 1.0, 0.7, '#8a6b4d'],
      ['barStool', 'Barhocker', 0.35, 0.35, '#6b5645'],
      ['extractorHood', 'Dunstabzug', 0.6, 0.4, '#8a8f99'],
    ],
  },
  schlafen: {
    label: 'Schlafen',
    items: [
      ['bedSingle', 'Einzelbett', 1.0, 2.0, '#c7b8a3'],
      ['bedDouble', 'Doppelbett 1.6m', 1.6, 2.0, '#c7b8a3'],
      ['bedKing', 'Bett 1.8m', 1.8, 2.0, '#c7b8a3'],
      ['nightstand', 'Nachttisch', 0.45, 0.4, '#a9866b'],
      ['wardrobe2', 'Kleiderschrank 2-türig', 1.0, 0.6, '#5a4a3d'],
      ['wardrobe3', 'Kleiderschrank 3-türig', 1.5, 0.6, '#5a4a3d'],
      ['dresser', 'Kommode', 1.0, 0.45, '#6b5645'],
      ['vanity', 'Schminktisch', 1.0, 0.5, '#a9866b'],
      ['benchBed', 'Bettbank', 1.2, 0.4, '#7d6b5d'],
      ['mirrorStand', 'Standspiegel', 0.5, 0.1, '#c4c4c4'],
      ['closetIslandUnit', 'Ankleide-Insel', 1.2, 0.6, '#5a4a3d'],
    ],
  },
  kinder: {
    label: 'Kinder',
    items: [
      ['bedChild', 'Kinderbett', 0.9, 1.6, '#f4c95d'],
      ['bunkBed', 'Etagenbett', 1.0, 2.0, '#f4c95d'],
      ['deskChild', 'Kinderschreibtisch', 1.0, 0.55, '#e5989b'],
      ['toyShelf', 'Spielregal', 0.9, 0.35, '#8fd3c8'],
      ['toyBox', 'Spielzeugkiste', 0.6, 0.4, '#f2a154'],
      ['wardrobeChild', 'Kinderschrank', 0.9, 0.55, '#a8d8b9'],
      ['playRug', 'Spielteppich', 1.6, 1.2, '#c9ada7'],
      ['changingTable', 'Wickeltisch', 0.8, 0.5, '#f7e1d7'],
      ['crib', 'Babybett', 0.7, 1.3, '#f7e1d7'],
    ],
  },
  bad: {
    label: 'Bad',
    items: [
      ['toilet', 'WC', 0.4, 0.6, '#e8ecee'],
      ['sinkVanity', 'Waschbecken', 0.6, 0.45, '#e8ecee'],
      ['sinkDouble', 'Doppelwaschbecken', 1.2, 0.5, '#e8ecee'],
      ['bathtub', 'Badewanne', 1.7, 0.75, '#e8ecee'],
      ['bathtubFree', 'Freistehende Wanne', 1.6, 0.7, '#f4f6f7'],
      ['shower', 'Dusche', 0.9, 0.9, '#cfe0e5'],
      ['showerLarge', 'Dusche groß', 1.2, 1.0, '#cfe0e5'],
      ['towelRadiator', 'Handtuchheizkörper', 0.5, 0.1, '#c4c4c4'],
      ['bathCabinet', 'Badschrank', 0.6, 0.35, '#e0d8c8'],
      ['saunaBench', 'Saunabank', 1.8, 0.6, '#b08968'],
      ['bidet', 'Bidet', 0.4, 0.55, '#e8ecee'],
    ],
  },
  buero: {
    label: 'Büro',
    items: [
      ['deskL', 'Schreibtisch L-Form', 1.6, 1.6, '#8a6b4d'],
      ['desk', 'Schreibtisch', 1.4, 0.7, '#8a6b4d'],
      ['officeChair', 'Bürostuhl', 0.6, 0.6, '#3a3a3a'],
      ['bookshelfTall', 'Regalwand', 2.0, 0.35, '#6b5645'],
      ['filingCabinet', 'Aktenschrank', 0.5, 0.5, '#5a4a3d'],
      ['meetingTable', 'Besprechungstisch', 1.6, 0.9, '#8a6b4d'],
      ['readingChair', 'Lesesessel', 0.8, 0.8, '#8a7561'],
      ['printerStand', 'Druckertisch', 0.5, 0.4, '#a9866b'],
    ],
  },
  technik: {
    label: 'Technik & Nutzräume',
    items: [
      ['washer', 'Waschmaschine', 0.6, 0.6, '#dfe3e6'],
      ['dryer', 'Trockner', 0.6, 0.6, '#dfe3e6'],
      ['laundrySink', 'Ausgussbecken', 0.5, 0.45, '#c4cbcf'],
      ['boiler', 'Heizkessel', 0.6, 0.6, '#8a8f99'],
      ['waterTank', 'Warmwasserspeicher', 0.6, 0.6, '#8a8f99'],
      ['shelvingUnit', 'Lagerregal', 1.0, 0.4, '#a08f74'],
      ['freezer', 'Gefriertruhe', 1.2, 0.65, '#dfe3e6'],
      ['workbench', 'Werkbank', 1.6, 0.6, '#7d6b5d'],
      ['treadmill', 'Laufband', 1.6, 0.7, '#3a3a3a'],
      ['weightBench', 'Trainingsbank', 1.2, 0.5, '#3a3a3a'],
      ['wineRack', 'Weinregal', 1.0, 0.35, '#5b3a4a'],
      ['coatRack', 'Garderobe', 1.0, 0.3, '#5a4a3d'],
      ['shoeBench', 'Schuhbank', 0.9, 0.35, '#8a7561'],
      ['stairsUnit', 'Treppe (Möbel-Symbol)', 1.0, 3.0, '#a08f74'],
    ],
  },
  aussen: {
    label: 'Außen',
    items: [
      ['patioTable', 'Gartentisch', 1.4, 0.8, '#8a6b4d'],
      ['patioChair', 'Gartenstuhl', 0.55, 0.55, '#6b5645'],
      ['loungerOut', 'Liegestuhl', 1.9, 0.65, '#d9c9a3'],
      ['bbqGrill', 'Grill', 0.7, 0.5, '#3a3a3a'],
      ['parasol', 'Sonnenschirm', 0.3, 0.3, '#c9564d'],
      ['outdoorSofa', 'Loungemöbel', 2.0, 0.9, '#7d6b5d'],
      ['firepit', 'Feuerstelle', 0.8, 0.8, '#5c5c5c'],
    ],
  },
};

export const FURNITURE_GROUPS = Object.entries(RAW).map(([key, g]) => ({
  key,
  label: g.label,
  items: g.items.map(([id, name, w, h, color]) => ({ id, name, w, h, color, group: key })),
}));

export const FURNITURE_TYPES = Object.fromEntries(
  FURNITURE_GROUPS.flatMap((g) => g.items.map((it) => [it.id, it]))
);

export function findFurnitureType(id) {
  return FURNITURE_TYPES[id] || { id, name: id, w: 0.6, h: 0.6, color: '#999999', group: 'wohnen' };
}

// Komplett-Vorlagen: setzen mehrere Möbel relativ zu einem Ankerpunkt (0,0 = obere linke Raumecke, Meter).
export const FURNITURE_TEMPLATES = [
  {
    id: 'tpl_bedroom_double',
    name: 'Schlafzimmer komplett (Doppelbett)',
    room: 'bedroom',
    items: [
      { typeId: 'bedDouble', x: 0.3, y: 0.3, rot: 0 },
      { typeId: 'nightstand', x: 0.0, y: 0.3, rot: 0 },
      { typeId: 'nightstand', x: 2.0, y: 0.3, rot: 0 },
      { typeId: 'wardrobe3', x: 0.3, y: 2.6, rot: 0 },
    ],
  },
  {
    id: 'tpl_bedroom_single',
    name: 'Gästezimmer komplett (Einzelbett)',
    room: 'guestRoom',
    items: [
      { typeId: 'bedSingle', x: 0.3, y: 0.3, rot: 0 },
      { typeId: 'nightstand', x: 1.4, y: 0.3, rot: 0 },
      { typeId: 'dresser', x: 0.3, y: 2.5, rot: 0 },
    ],
  },
  {
    id: 'tpl_kitchen_l',
    name: 'Küchenzeile L-Form komplett',
    room: 'kitchen',
    items: [
      { typeId: 'counterCornerL', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'fridge', x: 2.7, y: 0.2, rot: 0 },
      { typeId: 'stove', x: 0.6, y: 0.2, rot: 0 },
      { typeId: 'sink', x: 1.4, y: 0.2, rot: 0 },
    ],
  },
  {
    id: 'tpl_living_basic',
    name: 'Wohnzimmer komplett',
    room: 'living',
    items: [
      { typeId: 'sofa3', x: 0.3, y: 0.3, rot: 0 },
      { typeId: 'coffeeTable', x: 0.5, y: 1.5, rot: 0 },
      { typeId: 'tvUnit', x: 0.3, y: 3.2, rot: 0 },
      { typeId: 'armchair', x: 2.6, y: 0.3, rot: 90 },
      { typeId: 'rug', x: 0.4, y: 1.4, rot: 0 },
    ],
  },
  {
    id: 'tpl_bathroom_basic',
    name: 'Badezimmer komplett',
    room: 'bathroom',
    items: [
      { typeId: 'toilet', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'sinkVanity', x: 1.0, y: 0.2, rot: 0 },
      { typeId: 'shower', x: 0.2, y: 1.2, rot: 0 },
    ],
  },
  {
    id: 'tpl_dining_6',
    name: 'Esszimmer komplett (6 Personen)',
    room: 'dining',
    items: [
      { typeId: 'diningTable6', x: 0.5, y: 0.6, rot: 0 },
      { typeId: 'chair', x: 0.5, y: 0.1, rot: 180 },
      { typeId: 'chair', x: 1.1, y: 0.1, rot: 180 },
      { typeId: 'chair', x: 1.7, y: 0.1, rot: 180 },
      { typeId: 'chair', x: 0.5, y: 1.6, rot: 0 },
      { typeId: 'chair', x: 1.1, y: 1.6, rot: 0 },
      { typeId: 'chair', x: 1.7, y: 1.6, rot: 0 },
      { typeId: 'sideboard', x: 0.3, y: 2.6, rot: 0 },
    ],
  },
  {
    id: 'tpl_office_basic',
    name: 'Arbeitszimmer komplett',
    room: 'office',
    items: [
      { typeId: 'deskL', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'officeChair', x: 0.6, y: 1.0, rot: 0 },
      { typeId: 'bookshelfTall', x: 2.0, y: 0.2, rot: 0 },
    ],
  },
  {
    id: 'tpl_kids_basic',
    name: 'Kinderzimmer komplett',
    room: 'kidsRoom',
    items: [
      { typeId: 'bedChild', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'deskChild', x: 1.4, y: 0.2, rot: 0 },
      { typeId: 'toyShelf', x: 0.2, y: 2.0, rot: 0 },
      { typeId: 'playRug', x: 0.3, y: 1.9, rot: 0 },
    ],
  },
  {
    id: 'tpl_laundry_basic',
    name: 'Waschküche komplett',
    room: 'laundry',
    items: [
      { typeId: 'washer', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'dryer', x: 0.85, y: 0.2, rot: 0 },
      { typeId: 'laundrySink', x: 1.6, y: 0.2, rot: 0 },
    ],
  },
  {
    id: 'tpl_home_gym',
    name: 'Fitnessraum komplett',
    room: 'gym',
    items: [
      { typeId: 'treadmill', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'weightBench', x: 2.0, y: 0.2, rot: 0 },
      { typeId: 'shelvingUnit', x: 0.2, y: 2.2, rot: 0 },
    ],
  },
  {
    id: 'tpl_wine_cellar',
    name: 'Weinkeller komplett',
    room: 'wineCellar',
    items: [
      { typeId: 'wineRack', x: 0.2, y: 0.2, rot: 0 },
      { typeId: 'wineRack', x: 0.2, y: 0.8, rot: 0 },
      { typeId: 'barStool', x: 1.6, y: 0.3, rot: 0 },
    ],
  },
  {
    id: 'tpl_terrace_basic',
    name: 'Terrasse komplett',
    room: null,
    items: [
      { typeId: 'patioTable', x: 0.3, y: 0.3, rot: 0 },
      { typeId: 'patioChair', x: 0.2, y: 0.9, rot: 0 },
      { typeId: 'patioChair', x: 1.1, y: 0.9, rot: 0 },
      { typeId: 'parasol', x: 0.9, y: 0.5, rot: 0 },
    ],
  },
];

export function templatesForRoom(roomTypeId) {
  return FURNITURE_TEMPLATES.filter((t) => t.room === roomTypeId);
}
