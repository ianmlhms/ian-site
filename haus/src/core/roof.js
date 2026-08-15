// Reine Dachgeometrie-Berechnung (keine Three.js-Abhängigkeit). Liefert die Maße,
// aus denen three/buildHouse.js die tatsächlichen 3D-Formen baut.

const DEG2RAD = Math.PI / 180;

// Liefert Höhe und Achsrichtung des Dachs abhängig von Form/Neigung/Grundriss.
// w, h = Außenmaße des Gebäudes (Meter, inkl. Wandstärke grob), pitch in Grad, overhang in Metern.
export function roofProfile(roof, footprintW, footprintH) {
  const pitch = roof.pitch ?? 35;
  const overhang = roof.overhang ?? 0.5;
  const w = footprintW + overhang * 2;
  const h = footprintH + overhang * 2;
  const ridgeAxis = w >= h ? 'x' : 'y'; // First verläuft entlang der längeren Seite
  const halfSpan = (ridgeAxis === 'x' ? h : w) / 2;
  const tan = Math.tan(pitch * DEG2RAD);

  switch (roof.shape) {
    case 'flat':
      return { shape: 'flat', ridgeHeight: 0.25, parapet: 0.25, ridgeAxis, w, h, overhang };
    case 'shed': {
      const rise = (ridgeAxis === 'x' ? h : w) * tan;
      return { shape: 'shed', ridgeHeight: rise, lowHeight: 0.15, ridgeAxis, w, h, overhang };
    }
    case 'gable':
      return { shape: 'gable', ridgeHeight: halfSpan * tan, ridgeAxis, w, h, overhang };
    case 'hip':
      return { shape: 'hip', ridgeHeight: halfSpan * tan, ridgeAxis, w, h, overhang };
    case 'halfHip':
      return { shape: 'halfHip', ridgeHeight: halfSpan * tan, ridgeAxis, w, h, overhang, clip: 0.35 };
    case 'mansard': {
      const lowerHeight = halfSpan * 0.55 * Math.tan(65 * DEG2RAD);
      const upperHeight = halfSpan * 0.35 * tan;
      return { shape: 'mansard', ridgeHeight: lowerHeight + upperHeight, lowerHeight, upperHeight, ridgeAxis, w, h, overhang };
    }
    case 'pyramid':
      return { shape: 'pyramid', ridgeHeight: (Math.min(w, h) / 2) * tan, ridgeAxis, w, h, overhang };
    case 'gambrel': {
      const lowerHeight = halfSpan * 0.5 * Math.tan(60 * DEG2RAD);
      const upperHeight = halfSpan * 0.5 * Math.tan(20 * DEG2RAD);
      return { shape: 'gambrel', ridgeHeight: lowerHeight + upperHeight, lowerHeight, upperHeight, ridgeAxis, w, h, overhang };
    }
    default:
      return { shape: 'gable', ridgeHeight: halfSpan * tan, ridgeAxis, w, h, overhang };
  }
}

export function totalBuildingHeight(building) {
  const wallsHeight = building.floors.reduce((sum, f) => sum + f.height, 0);
  const profile = roofProfile(building.roof, building.footprint.w, building.footprint.h);
  return wallsHeight + profile.ridgeHeight;
}

export function floorBaseElevation(building, floor) {
  let z = 0;
  for (const f of building.floors) {
    if (f.id === floor.id) return z;
    z += f.height;
  }
  return z;
}

export function createDormer(side, offset) {
  return { id: `dm_${Date.now().toString(36)}`, side, offset, width: 1.2, height: 1.3 };
}
export function createChimney(x, y) {
  return { id: `ch_${Date.now().toString(36)}`, x, y, w: 0.5, h: 0.5, height: 1.2 };
}
export function createSkylight(side, offset) {
  return { id: `sk_${Date.now().toString(36)}`, side, offset, w: 0.8, h: 1.0 };
}
export function createSolarPanel(side, offset) {
  return { id: `sp_${Date.now().toString(36)}`, side, offset, w: 1.6, h: 1.0 };
}
