import { roomAreaM2 } from './geometry.js';
import { findRoomType, THROUGH_ROOM_TYPES } from './catalog/rooms.js';

const COST_PER_M2 = { basic: 1450, standard: 1900, premium: 2600 };

export function floorLivingArea(floor) {
  return floor.rooms.reduce((sum, r) => sum + roomAreaM2(r), 0);
}

export function buildingFootprintArea(building) {
  return building.footprint.w * building.footprint.h;
}

export function buildingLivingArea(building) {
  return building.floors.reduce((sum, f) => sum + floorLivingArea(f), 0);
}

export function designLivingArea(design) {
  return design.buildings.reduce((sum, b) => sum + buildingLivingArea(b), 0);
}

export function designFootprintArea(design) {
  return design.buildings.reduce((sum, b) => sum + buildingFootprintArea(b), 0);
}

export function plotArea(design) {
  return design.plot.w * design.plot.h;
}

export function estimatedCost(design) {
  const level = design.meta?.budgetLevel || 'standard';
  const rate = COST_PER_M2[level] || COST_PER_M2.standard;
  return Math.round(designLivingArea(design) * rate);
}

export function roomBreakdown(floor) {
  return floor.rooms.map((r) => ({
    id: r.id,
    name: findRoomType(r.typeId).name,
    typeId: r.typeId,
    area: Math.round(roomAreaM2(r) * 10) / 10,
  }));
}

export function fullMetrics(design) {
  const living = designLivingArea(design);
  const footprint = designFootprintArea(design);
  const plot = plotArea(design);
  return {
    livingAreaM2: Math.round(living * 10) / 10,
    footprintM2: Math.round(footprint * 10) / 10,
    plotM2: Math.round(plot * 10) / 10,
    coveragePct: plot > 0 ? Math.round((footprint / plot) * 1000) / 10 : 0,
    estimatedCostEUR: estimatedCost(design),
    roomCount: design.buildings.reduce(
      (sum, b) => sum + b.floors.reduce((s2, f) => s2 + f.rooms.filter((r) => !THROUGH_ROOM_TYPES.has(r.typeId)).length, 0),
      0
    ),
    buildingCount: design.buildings.length,
    floorCount: design.buildings.reduce((sum, b) => sum + b.floors.length, 0),
  };
}
