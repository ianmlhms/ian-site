// Supabase Edge Function: skylens
// Stable, CORS-friendly aircraft contract shared by the ian.lu, iOS and
// Connect IQ SkyLens clients. Live positions come from the open ADSB.lol feed,
// with airplanes.live as an automatic fallback.
//
// Deploy:
//   supabase functions deploy skylens --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//
// Nearby aircraft:
//   ?lat=49.6494&lon=6.2571&radius=30&limit=150
// Route enrichment for one selected flight:
//   ?action=route&callsign=CLX123&lat=49.6&lon=6.2
// Photo enrichment for one selected aircraft:
//   ?action=photo&hex=4D0111&registration=LX-VCB

// Data: ADSB.lol / airplanes.live. ADSB.lol public data is ODbL 1.0.

const PRIMARY = "https://api.adsb.lol";
const FALLBACK = "https://api.airplanes.live";
const ROUTES = `${PRIMARY}/api/0/routeset`;
const PHOTOS = "https://api.planespotters.net/pub/photos";
const USER_AGENT = "SkyLens/1.0 (https://ian.lu/skylens.html)";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200, cacheSeconds = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheSeconds > 0
        ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`
        : "no-store",
    },
  });

const SPECIAL_TYPES = new Set(["A124", "A225", "A3ST", "A337", "A388", "C5M", "BLCF"]);
const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);
const CARGO_PREFIXES = ["CLX", "FDX", "UPS", "GTI", "BOX", "BCS", "DHL", "ABR", "ASL"];

const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const from = radians(lat1), to = radians(lat2), delta = radians(lon2 - lon1);
  const y = Math.sin(delta) * Math.cos(to);
  const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(delta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function flags(raw: Record<string, unknown>) {
  const flight = upper(raw.flight);
  const type = upper(raw.t);
  const squawk = upper(raw.squawk);
  const emergencyText = upper(raw.emergency);
  const altitude = numeric(raw.alt_baro);
  const dbFlags = numeric(raw.dbFlags) ?? 0;
  const emergency = EMERGENCY_SQUAWKS.has(squawk)
    || (!!emergencyText && emergencyText !== "NONE");
  const military = (Math.trunc(dbFlags) & 1) !== 0;
  const excludedRoutine = flight.startsWith("CLX") || type.startsWith("B74");
  const lowRotorcraft = upper(raw.category) === "A7" && altitude !== null && altitude < 3000;
  const special = !excludedRoutine && (SPECIAL_TYPES.has(type) || lowRotorcraft);
  const cargo = CARGO_PREFIXES.some((prefix) => flight.startsWith(prefix))
    || type.startsWith("B74") || type === "BLCF";
  return { emergency, military, special, interesting: emergency || military || special, cargo };
}

function normalize(raw: Record<string, unknown>, centerLat: number, centerLon: number) {
  const lat = numeric(raw.lat);
  const lon = numeric(raw.lon);
  if (lat === null || lon === null || !upper(raw.hex)) return null;
  const altitude = numeric(raw.alt_baro);
  const status = flags(raw);
  return {
    hex: upper(raw.hex),
    flight: upper(raw.flight),
    registration: upper(raw.r),
    type: upper(raw.t),
    description: text(raw.desc),
    lat,
    lon,
    altitudeFt: altitude,
    onGround: upper(raw.alt_baro) === "GROUND",
    groundSpeedKt: numeric(raw.gs),
    trackDeg: numeric(raw.track),
    verticalRateFpm: numeric(raw.baro_rate) ?? numeric(raw.geom_rate),
    squawk: upper(raw.squawk),
    category: upper(raw.category),
    seenSeconds: numeric(raw.seen),
    distanceNm: Number(distanceNm(centerLat, centerLon, lat, lon).toFixed(2)),
    bearingDeg: Number(bearingDeg(centerLat, centerLon, lat, lon).toFixed(1)),
    ...status,
  };
}

async function fetchFeed(host: string, lat: number, lon: number, radius: number) {
  const response = await fetch(`${host}/v2/point/${lat}/${lon}/${radius}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${host} ${response.status}`);
  const body = await response.json();
  if (!body || !Array.isArray(body.ac)) throw new Error(`${host} invalid response`);
  return body.ac.filter((item: unknown) => item && typeof item === "object") as Record<string, unknown>[];
}

async function nearby(lat: number, lon: number, radius: number) {
  const failures: string[] = [];
  for (const [source, host] of [["adsb.lol", PRIMARY], ["airplanes.live", FALLBACK]] as const) {
    try {
      return { source, aircraft: await fetchFeed(host, lat, lon, radius) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error("skylens feed", message);
    }
  }
  throw new Error(failures.join("; "));
}

async function route(url: URL) {
  const callsign = upper(url.searchParams.get("callsign"));
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!callsign || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "callsign, lat and lon are required" }, 400);
  }
  try {
    const response = await fetch(ROUTES, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ planes: [{ callsign, lat, lng: lon }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`route ${response.status}`);
    const result = await response.json();
    const item = Array.isArray(result) && result[0] && typeof result[0] === "object" ? result[0] : {};
    const routeText = text(item._airport_codes_iata ?? item.airport_codes_iata);
    const parts = routeText.split(/[-–>]/).map((part) => part.trim().toUpperCase()).filter(Boolean);
    return json({
      callsign,
      route: routeText && routeText.toLowerCase() !== "unknown" ? routeText : null,
      origin: parts[0] ?? null,
      destination: parts.length > 1 ? parts[parts.length - 1] : null,
    }, 200, 5);
  } catch (error) {
    console.error("skylens route", error instanceof Error ? error.message : String(error));
    return json({ callsign, route: null, origin: null, destination: null }, 200, 5);
  }
}

type PhotoResult = {
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  link: string;
  photographer: string;
  provider: "Planespotters.net";
};

async function fetchPhoto(kind: "hex" | "reg", value: string): Promise<PhotoResult | null> {
  const response = await fetch(`${PHOTOS}/${kind}/${encodeURIComponent(value)}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`photo ${response.status}`);
  const body = await response.json();
  const item = body && Array.isArray(body.photos) ? body.photos[0] : null;
  if (!item || typeof item !== "object") return null;
  const thumbnail = item.thumbnail_large ?? item.thumbnail;
  const thumbnailUrl = text(thumbnail?.src);
  const link = text(item.link);
  const photographer = text(item.photographer);
  if (!thumbnailUrl || !link || !photographer) return null;
  return {
    thumbnailUrl,
    width: numeric(thumbnail?.size?.width),
    height: numeric(thumbnail?.size?.height),
    link,
    photographer,
    provider: "Planespotters.net",
  };
}

async function photo(url: URL) {
  const hex = upper(url.searchParams.get("hex")).replace(/^~/, "");
  const registration = upper(url.searchParams.get("registration"));
  const lookups: Array<["hex" | "reg", string]> = [];
  if (/^[0-9A-F]{6}$/.test(hex)) lookups.push(["hex", hex]);
  if (registration && registration.length <= 20) lookups.push(["reg", registration]);
  if (!lookups.length) return json({ error: "a valid hex or registration is required" }, 400);

  try {
    for (const [kind, value] of lookups) {
      const result = await fetchPhoto(kind, value);
      if (result) {
        return json({ photo: result }, 200, 3600);
      }
    }
    return json({ photo: null }, 200, 3600);
  } catch (error) {
    console.error("skylens photo", error instanceof Error ? error.message : String(error));
    return json({ photo: null }, 200, 60);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  const url = new URL(request.url);
  if (url.searchParams.get("action") === "route") return route(url);
  if (url.searchParams.get("action") === "photo") return photo(url);

  const lat = Number(url.searchParams.get("lat") ?? "49.6494");
  const lon = Number(url.searchParams.get("lon") ?? "6.2571");
  const radius = clamp(Number(url.searchParams.get("radius") ?? "30"), 1, 250);
  const limit = Math.trunc(clamp(Number(url.searchParams.get("limit") ?? "200"), 1, 250));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return json({ error: "invalid latitude or longitude" }, 400);
  }

  try {
    const feed = await nearby(lat, lon, radius);
    const aircraft = feed.aircraft
      .map((item) => normalize(item, lat, lon))
      .filter((item) => item !== null)
      .sort((a, b) => Number(b.interesting) - Number(a.interesting) || a.distanceNm - b.distanceNm)
      .slice(0, limit);
    return json({
      now: new Date().toISOString(),
      source: feed.source,
      center: { lat, lon },
      radiusNm: radius,
      count: aircraft.length,
      aircraft,
      attribution: "Live ADS-B data: ADSB.lol / airplanes.live",
    }, 200, 5);
  } catch (error) {
    console.error("skylens", error instanceof Error ? error.message : String(error));
    return json({ error: "live aircraft feed unavailable", aircraft: [] }, 502);
  }
});
