import { roomAreaM2 } from './geometry.js';
import { findRoomType } from './catalog/rooms.js';

const MIN_AREA = {
  bedroom: 8, kidsRoom: 8, guestRoom: 7, bathroom: 4, guestWc: 1.5,
  kitchen: 6, living: 12, office: 6,
};

const NEEDS_WINDOW = new Set(['bedroom', 'kidsRoom', 'guestRoom', 'living', 'office', 'dining', 'openKitchen', 'kitchen']);
const WET_ROOMS = new Set(['bathroom', 'guestWc', 'ensuite']);

function roomHasWindow(floor, roomId) {
  const wallIds = new Set(floor.walls.filter((w) => w.roomA === roomId || w.roomB === roomId).map((w) => w.id));
  return floor.openings.some((o) => o.type === 'window' && wallIds.has(o.wallId));
}

export function validateDesign(design) {
  const warnings = [];

  for (const b of design.buildings) {
    for (const f of b.floors) {
      for (const r of f.rooms) {
        const rt = findRoomType(r.typeId);
        const area = roomAreaM2(r);
        const min = MIN_AREA[r.typeId];
        if (min && area < min) {
          warnings.push({
            id: `warn_area_${r.id}`,
            severity: 'warn',
            message: `${rt.name} in ${f.name} ist mit ${area.toFixed(1)} m² recht klein (empfohlen ab ${min} m²).`,
            buildingId: b.id, floorId: f.id, roomId: r.id,
          });
        }
        if (NEEDS_WINDOW.has(r.typeId) && !roomHasWindow(f, r.id)) {
          warnings.push({
            id: `warn_window_${r.id}`,
            severity: 'warn',
            message: `${rt.name} in ${f.name} hat kein Fenster nach außen.`,
            buildingId: b.id, floorId: f.id, roomId: r.id,
          });
        }
        if (WET_ROOMS.has(r.typeId) && !roomHasWindow(f, r.id)) {
          warnings.push({
            id: `info_window_${r.id}`,
            severity: 'info',
            message: `${rt.name} in ${f.name} hat kein Fenster (mit Lüftung meist unbedenklich).`,
            buildingId: b.id, floorId: f.id, roomId: r.id,
          });
        }
      }
    }

    if (b.floors.length > 1) {
      const hasStairs = b.shafts.some((s) => s.typeId === 'stairwell');
      if (!hasStairs) {
        warnings.push({
          id: `warn_stairs_${b.id}`,
          severity: 'warn',
          message: `${b.name} hat mehrere Geschosse, aber kein Treppenhaus.`,
          buildingId: b.id,
        });
      } else {
        const stairShafts = b.shafts.filter((s) => s.typeId === 'stairwell').length;
        if (stairShafts < 2) {
          warnings.push({
            id: `info_escape_${b.id}`,
            severity: 'info',
            message: `${b.name} hat nur einen Fluchtweg über ein Treppenhaus.`,
            buildingId: b.id,
          });
        }
      }
    }

    const kitchenFloor = findRoomFloorLevel(b, ['kitchen', 'openKitchen']);
    const diningFloor = findRoomFloorLevel(b, ['dining']);
    if (kitchenFloor !== null && diningFloor !== null && kitchenFloor !== diningFloor) {
      warnings.push({
        id: `info_kitchen_dining_${b.id}`,
        severity: 'info',
        message: `Küche und Esszimmer liegen in ${b.name} auf unterschiedlichen Geschossen.`,
        buildingId: b.id,
      });
    }
  }

  return warnings;
}

function findRoomFloorLevel(building, typeIds) {
  for (const f of building.floors) {
    if (f.rooms.some((r) => typeIds.includes(r.typeId))) return f.level;
  }
  return null;
}
