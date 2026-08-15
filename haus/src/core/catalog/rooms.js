// Raumkatalog. w/h in Grundriss-Zellen (1 Zelle = 0.5 m) als Standardgröße beim Platzieren.
// furnitureGroup verweist auf eine Gruppe in furniture.js, damit der Möbel-Editor passend filtert.

export const ROOM_CATEGORIES = [
  {
    cat: 'Wohnbereich',
    items: [
      { id: 'living', name: 'Wohnzimmer', color: '#f2c14e', w: 8, h: 6, furnitureGroup: 'wohnen' },
      { id: 'dining', name: 'Esszimmer', color: '#f2a154', w: 6, h: 5, furnitureGroup: 'essen' },
      { id: 'kitchen', name: 'Küche', color: '#e07a5f', w: 6, h: 5, furnitureGroup: 'kueche' },
      { id: 'openKitchen', name: 'Offene Wohnküche', color: '#e08e5f', w: 10, h: 7, furnitureGroup: 'kueche' },
      { id: 'conservatory', name: 'Wintergarten', color: '#8fd3c8', w: 6, h: 5, furnitureGroup: 'wohnen' },
      { id: 'fireplace', name: 'Kaminzimmer', color: '#d98a5f', w: 5, h: 5, furnitureGroup: 'wohnen' },
    ],
  },
  {
    cat: 'Schlafen',
    items: [
      { id: 'bedroom', name: 'Schlafzimmer', color: '#a1c6ea', w: 6, h: 5, furnitureGroup: 'schlafen' },
      { id: 'kidsRoom', name: 'Kinderzimmer', color: '#a8d8b9', w: 5, h: 5, furnitureGroup: 'kinder' },
      { id: 'guestRoom', name: 'Gästezimmer', color: '#b7c9ea', w: 5, h: 4, furnitureGroup: 'schlafen' },
      { id: 'closet', name: 'Ankleide', color: '#c7b8e0', w: 3, h: 3, furnitureGroup: 'schlafen' },
    ],
  },
  {
    cat: 'Sanitär',
    items: [
      { id: 'bathroom', name: 'Badezimmer', color: '#7fb8c4', w: 4, h: 4, furnitureGroup: 'bad' },
      { id: 'guestWc', name: 'Gäste-WC', color: '#8fc4cf', w: 2, h: 3, furnitureGroup: 'bad' },
      { id: 'ensuite', name: 'En-suite-Bad', color: '#6fa8b8', w: 4, h: 3, furnitureGroup: 'bad' },
      { id: 'sauna', name: 'Sauna', color: '#b08968', w: 3, h: 3, furnitureGroup: 'bad' },
    ],
  },
  {
    cat: 'Arbeiten & Sonstiges',
    items: [
      { id: 'office', name: 'Arbeitszimmer', color: '#9fa8da', w: 4, h: 4, furnitureGroup: 'buero' },
      { id: 'library', name: 'Bibliothek', color: '#8d7b68', w: 5, h: 4, furnitureGroup: 'buero' },
      { id: 'hobby', name: 'Hobbyraum', color: '#c9ada7', w: 5, h: 5, furnitureGroup: 'wohnen' },
      { id: 'gym', name: 'Fitnessraum', color: '#e5989b', w: 5, h: 5, furnitureGroup: 'technik' },
      { id: 'musicRoom', name: 'Musikzimmer', color: '#b5838d', w: 4, h: 4, furnitureGroup: 'wohnen' },
    ],
  },
  {
    cat: 'Technik & Nutzräume',
    items: [
      { id: 'hallway', name: 'Flur/Diele', color: '#d9d0c1', w: 4, h: 2, furnitureGroup: 'wohnen' },
      { id: 'stairwell', name: 'Treppenhaus', color: '#c2b8a3', w: 3, h: 4, furnitureGroup: 'technik', through: true },
      { id: 'storage', name: 'Abstellraum', color: '#bdb2a7', w: 2, h: 2, furnitureGroup: 'technik' },
      { id: 'laundry', name: 'Waschküche', color: '#a3b8c2', w: 3, h: 3, furnitureGroup: 'technik' },
      { id: 'utility', name: 'Technikraum', color: '#9aa5a5', w: 3, h: 3, furnitureGroup: 'technik' },
      { id: 'pantry', name: 'Vorratskammer', color: '#c9b79c', w: 2, h: 3, furnitureGroup: 'kueche' },
      { id: 'garageRoom', name: 'Garage (integriert)', color: '#8a8f99', w: 6, h: 6, furnitureGroup: 'technik' },
      { id: 'cellarStorage', name: 'Keller-Lager', color: '#7a7166', w: 4, h: 4, furnitureGroup: 'technik' },
      { id: 'wineCellar', name: 'Weinkeller', color: '#5b3a4a', w: 3, h: 4, furnitureGroup: 'technik' },
      { id: 'chimney', name: 'Schornstein', color: '#5c5c5c', w: 1, h: 1, furnitureGroup: 'technik', through: true },
      { id: 'elevator', name: 'Aufzug', color: '#6c7a89', w: 2, h: 2, furnitureGroup: 'technik', through: true },
    ],
  },
];

export const ROOM_TYPES = Object.fromEntries(
  ROOM_CATEGORIES.flatMap((cat) => cat.items.map((item) => [item.id, item]))
);

export const THROUGH_ROOM_TYPES = new Set(
  ROOM_CATEGORIES.flatMap((cat) => cat.items).filter((i) => i.through).map((i) => i.id)
);

export function findRoomType(id) {
  return ROOM_TYPES[id] || { id, name: id, color: '#cccccc', w: 3, h: 3, furnitureGroup: 'wohnen' };
}
