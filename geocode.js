/* Address and place lookup for Luxembourg, over the geoportail.lu open search.
 *
 * bus.html's stop list is local (moien-stops.json), so it can only ever find a
 * stop by its own name — "Laach", "Niederanven". This adds the other half: type
 * a street, a house number, a village or a lieu-dit and get a coordinate back,
 * which the page turns into the nearest stops or a route endpoint.
 *
 * No key, CORS open, Luxembourg only. Nothing is sent but the typed query. */

const ENDPOINT = "https://apiv3.geoportail.lu/fulltextsearch";
const LIMIT = 6;

/* The search also answers with cadastral parcels, flight corridors and the like.
 * These five layers are the ones a person means by "a place", labelled the way
 * the rest of bus.html speaks. */
const LAYERS = Object.freeze({
  Adresse: "Adress",
  nom_de_rue: "Strooss",
  Localité: "Uertschaft",
  Commune: "Gemeng",
  lieu_dit: "Uert",
});

/** Middle of whatever geometry came back: streets and communes are polygons,
 *  addresses are points. The bbox is the cheap answer when there is one. */
function centre(feature) {
  const box = feature.bbox;
  if (Array.isArray(box) && box.length >= 4) {
    return { lat: (box[1] + box[3]) / 2, lon: (box[0] + box[2]) / 2 };
  }
  const geometry = feature.geometry || {};
  if (geometry.type === "Point") {
    return { lat: geometry.coordinates[1], lon: geometry.coordinates[0] };
  }
  const ring = geometry.coordinates?.[0];
  if (!Array.isArray(ring) || !ring.length) return null;
  const sum = ring.reduce(
    (acc, [lon, lat]) => ({ lat: acc.lat + lat, lon: acc.lon + lon }),
    { lat: 0, lon: 0 },
  );
  return { lat: sum.lat / ring.length, lon: sum.lon / ring.length };
}

function toPlace(feature) {
  const kind = LAYERS[feature.properties?.layer_name];
  const label = feature.properties?.label;
  if (!kind || !label) return null;
  const point = centre(feature);
  if (!point || !isFinite(point.lat) || !isFinite(point.lon)) return null;
  return Object.freeze({
    // "geo:" so a place can sit next to a stop in the recents and favourites
    // lists without ever colliding with a national stop id.
    id: `geo:${point.lat.toFixed(5)},${point.lon.toFixed(5)}`,
    name: label,
    kind,
    lat: point.lat,
    lon: point.lon,
  });
}

/**
 * @param {string} query   what the user typed
 * @param {AbortSignal=} signal  to drop the answer to a stale keystroke
 * @returns {Promise<Array>} places, empty on any failure — a dead geocoder must
 *   never take the local stop search down with it.
 */
export async function searchPlaces(query, signal) {
  const text = String(query || "").trim();
  if (text.length < 3) return [];
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", text);
  url.searchParams.set("limit", String(LIMIT));
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.features || []).map(toPlace).filter(Boolean).slice(0, LIMIT);
  } catch {
    return [];   // offline, blocked, or simply superseded by the next keystroke
  }
}
