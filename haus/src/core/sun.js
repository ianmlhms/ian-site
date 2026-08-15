// Vereinfachte Sonnenstandsberechnung (NOAA-Näherung) für den Schatten-Overlay im Lageplan
// und die Sonnenausrichtung in der 3D-Ansicht. Kein DOM.

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DEFAULT_LAT = 48.2; // Mitteleuropa als Annahme

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

// hourFloat: Stunde des Tages als Dezimalzahl (z.B. 14.5 = 14:30), lokale Zeit.
export function sunPosition(date, hourFloat, lat = DEFAULT_LAT) {
  const n = dayOfYear(date);
  const gamma = ((2 * Math.PI) / 365) * (n - 1 + (hourFloat - 12) / 24);

  const eqTime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqTime; // Zeitzonen-/Längengrad-Korrektur vernachlässigt (grobe Näherung)
  const trueSolarTime = hourFloat * 60 + timeOffset;
  let hourAngleDeg = trueSolarTime / 4 - 180;
  const hourAngle = hourAngleDeg * DEG2RAD;

  const latRad = lat * DEG2RAD;
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = 90 - zenith * RAD2DEG;

  let cosAzimuth =
    (Math.sin(decl) - Math.sin(latRad) * Math.cos(zenith)) / (Math.cos(latRad) * Math.sin(zenith));
  cosAzimuth = Math.min(1, Math.max(-1, cosAzimuth));
  let azimuth = Math.acos(cosAzimuth) * RAD2DEG;
  if (hourAngleDeg > 0) azimuth = 360 - azimuth; // Nachmittag: Sonne im Westen

  return { elevationDeg: elevation, azimuthDeg: azimuth };
}

// Richtungsvektor für die 3D-Beleuchtung (Y = oben). northOffsetDeg dreht die Szene
// relativ zur echten Nordrichtung des Grundstücks.
export function sunDirectionVector(elevationDeg, azimuthDeg, northOffsetDeg = 0) {
  const el = elevationDeg * DEG2RAD;
  const az = (azimuthDeg + northOffsetDeg) * DEG2RAD;
  return {
    x: Math.sin(az) * Math.cos(el),
    y: Math.sin(el),
    z: -Math.cos(az) * Math.cos(el),
  };
}

// Schattenlänge relativ zur Objekthöhe (für den 2D-Overlay im Lageplan).
export function shadowLengthFactor(elevationDeg) {
  if (elevationDeg <= 1) return 20; // sehr flacher Stand -> sehr langer Schatten, gedeckelt
  return Math.min(20, 1 / Math.tan(elevationDeg * DEG2RAD));
}

export function shadowOffset2D(elevationDeg, azimuthDeg, northOffsetDeg, heightM) {
  const factor = shadowLengthFactor(elevationDeg);
  const dir = sunDirectionVector(elevationDeg, azimuthDeg, northOffsetDeg);
  // Schatten fällt entgegengesetzt zur Sonnenrichtung, auf der xz-Ebene (Grundriss).
  return { dx: -dir.x * factor * heightM, dy: -dir.z * factor * heightM };
}
