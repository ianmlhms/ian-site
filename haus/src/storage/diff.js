import { fullMetrics } from '../core/metrics.js';
import { findRoomType } from '../core/catalog/rooms.js';
import { findOutdoorType } from '../core/catalog/outdoor.js';
import { ROOF_SHAPES } from '../core/catalog/materials.js';

function countBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

function diffCounts(mapA, mapB, nameFn) {
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const out = [];
  for (const k of keys) {
    const a = mapA.get(k) || 0;
    const b = mapB.get(k) || 0;
    if (a === b) continue;
    const delta = b - a;
    out.push(`${nameFn(k)}: ${a} → ${b} (${delta > 0 ? '+' : ''}${delta})`);
  }
  return out;
}

function allRooms(design) {
  return design.buildings.flatMap((b) => b.floors.flatMap((f) => f.rooms));
}
function allFurniture(design) {
  return design.buildings.flatMap((b) => b.floors.flatMap((f) => f.furniture));
}

export function diffDesigns(a, b) {
  const entries = [];
  const ma = fullMetrics(a);
  const mb = fullMetrics(b);

  pushIfChanged(entries, 'Wohnfläche', `${ma.livingAreaM2} m²`, `${mb.livingAreaM2} m²`, ma.livingAreaM2 !== mb.livingAreaM2);
  pushIfChanged(entries, 'Bebaute Fläche', `${ma.footprintM2} m²`, `${mb.footprintM2} m²`, ma.footprintM2 !== mb.footprintM2);
  pushIfChanged(entries, 'Geschätzte Kosten', `${ma.estimatedCostEUR.toLocaleString('de-DE')} €`, `${mb.estimatedCostEUR.toLocaleString('de-DE')} €`, ma.estimatedCostEUR !== mb.estimatedCostEUR);
  pushIfChanged(entries, 'Räume gesamt', ma.roomCount, mb.roomCount, ma.roomCount !== mb.roomCount);
  pushIfChanged(entries, 'Geschosse gesamt', ma.floorCount, mb.floorCount, ma.floorCount !== mb.floorCount);
  pushIfChanged(entries, 'Gebäude', ma.buildingCount, mb.buildingCount, ma.buildingCount !== mb.buildingCount);

  const roomCountsA = countBy(allRooms(a), (r) => r.typeId);
  const roomCountsB = countBy(allRooms(b), (r) => r.typeId);
  for (const line of diffCounts(roomCountsA, roomCountsB, (id) => findRoomType(id).name)) {
    entries.push({ label: 'Raum geändert', detail: line });
  }

  const outCountsA = countBy(a.outdoor, (o) => o.typeId);
  const outCountsB = countBy(b.outdoor, (o) => o.typeId);
  for (const line of diffCounts(outCountsA, outCountsB, (id) => findOutdoorType(id).name)) {
    entries.push({ label: 'Garten geändert', detail: line });
  }

  const furnA = allFurniture(a).length;
  const furnB = allFurniture(b).length;
  pushIfChanged(entries, 'Möbelstücke', furnA, furnB, furnA !== furnB);

  const mainA = a.buildings[0], mainB = b.buildings[0];
  if (mainA && mainB) {
    if (mainA.roof.shape !== mainB.roof.shape) {
      const nameOf = (id) => ROOF_SHAPES.find((s) => s.id === id)?.name || id;
      entries.push({ label: 'Dachform', detail: `${nameOf(mainA.roof.shape)} → ${nameOf(mainB.roof.shape)}` });
    }
    if (mainA.roof.pitch !== mainB.roof.pitch) {
      entries.push({ label: 'Dachneigung', detail: `${mainA.roof.pitch}° → ${mainB.roof.pitch}°` });
    }
    if (mainA.facade.primary.material !== mainB.facade.primary.material || mainA.facade.primary.color !== mainB.facade.primary.color) {
      entries.push({ label: 'Fassade', detail: 'Material oder Farbe geändert' });
    }
  }

  if (a.plot.w !== b.plot.w || a.plot.h !== b.plot.h) {
    entries.push({ label: 'Grundstück', detail: `${a.plot.w}×${a.plot.h} m → ${b.plot.w}×${b.plot.h} m` });
  }

  return entries;
}

function pushIfChanged(entries, label, from, to, changed) {
  if (changed) entries.push({ label, detail: `${from} → ${to}` });
}
