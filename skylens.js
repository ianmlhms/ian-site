/* SkyLens — live aircraft radar for ian.lu.
 * Public ADS-B positions are fetched through the ian.lu Supabase proxy first;
 * the two community feeds are used directly as a best-effort browser fallback. */
(function () {
  "use strict";

  const HOME = { lat: 49.6494, lon: 6.2571, zoom: 9 };
  const LUX_AIRPORT = { lat: 49.6266, lon: 6.2115 };
  const PROXY = "https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/skylens";
  const DIRECT_FEEDS = [
    { name: "adsb.lol", url: "https://api.adsb.lol/v2/point/" },
    { name: "airplanes.live", url: "https://api.airplanes.live/v2/point/" },
  ];
  const REFRESH_MS = 15000;
  const STALE_MS = 45000;
  const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);
  const SPECIAL_TYPES = new Set([
    "A124", "A225", "A337", "A388", "A3ST", "A400", "AN12", "AN22", "AN26",
    "BLCF", "C130", "C17", "C5M", "E3CF", "EUFI", "F16", "F18H", "K35R",
  ]);
  const CARGO_PREFIXES = [
    "ABW", "BCS", "BOX", "CKS", "CLX", "DHK", "EAT", "FDX", "GTI", "ICE",
    "MPH", "NCA", "PAC", "SRR", "TAY", "UPS",
  ];
  const TYPE_NAMES = {
    A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo",
    A319: "Airbus A319", A320: "Airbus A320", A321: "Airbus A321",
    A306: "Airbus A300-600", A332: "Airbus A330-200", A333: "Airbus A330-300",
    A339: "Airbus A330-900neo", A343: "Airbus A340-300", A346: "Airbus A340-600",
    A359: "Airbus A350-900", A35K: "Airbus A350-1000", A380: "Airbus A380",
    A388: "Airbus A380-800", A3ST: "Airbus Beluga", A337: "Airbus BelugaXL",
    A124: "Antonov An-124", A225: "Antonov An-225", A400: "Airbus A400M Atlas",
    B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9", B737: "Boeing 737-700",
    B738: "Boeing 737-800", B739: "Boeing 737-900", B744: "Boeing 747-400",
    B748: "Boeing 747-8", B752: "Boeing 757-200", B753: "Boeing 757-300",
    B763: "Boeing 767-300", B764: "Boeing 767-400", B772: "Boeing 777-200",
    B77W: "Boeing 777-300ER", B788: "Boeing 787-8", B789: "Boeing 787-9",
    B78X: "Boeing 787-10", BLCF: "Boeing Dreamlifter", C130: "Lockheed C-130",
    C17: "Boeing C-17 Globemaster", C5M: "Lockheed C-5M Super Galaxy",
    CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900",
    DH8D: "De Havilland Dash 8-400", E170: "Embraer E170", E175: "Embraer E175",
    E190: "Embraer E190", E195: "Embraer E195", E290: "Embraer E190-E2",
    E295: "Embraer E195-E2", AT72: "ATR 72", AT76: "ATR 72-600",
    C208: "Cessna 208 Caravan", PC12: "Pilatus PC-12", GLF5: "Gulfstream V",
    GLF6: "Gulfstream G650", CL35: "Bombardier Challenger 350", CL60: "Bombardier Challenger 600",
    FA7X: "Dassault Falcon 7X", H135: "Airbus Helicopters H135", H145: "Airbus Helicopters H145",
    A139: "Leonardo AW139", A169: "Leonardo AW169", S76: "Sikorsky S-76",
    B06: "Bell 206", B407: "Bell 407", R44: "Robinson R44",
  };
  const PLANE_PATH = "M12 1.5 15.2 10l7.6 3.8v2.6l-8.1-1.7-1.1 6 3.2 2.1V24L12 22.8 7.2 24v-1.2l3.2-2.1-1.1-6-8.1 1.7v-2.6L8.8 10 12 1.5Z";

  const $ = (id) => document.getElementById(id);
  const els = {
    radarMode: $("radarMode"), listMode: $("listMode"), radarView: $("radarView"), listView: $("listView"),
    search: $("flightSearch"), filterBar: $("filterBar"), countAll: $("countAll"),
    countInteresting: $("countInteresting"), visibleCount: $("visibleCount"), listSummary: $("listSummary"),
    flightList: $("flightList"), emptyState: $("emptyState"), feedStatus: $("feedStatus"),
    livePulse: $("livePulse"), refresh: $("refreshNow"), locate: $("locateMe"), home: $("homeView"),
    drawer: $("flightDrawer"), closeDrawer: $("closeDrawer"), follow: $("followFlight"), center: $("centerFlight"),
    detailState: $("detailState"), detailFlight: $("detailFlight"), detailRoute: $("detailRoute"),
    detailBadges: $("detailBadges"), detailAltitude: $("detailAltitude"), detailSpeed: $("detailSpeed"),
    detailVertical: $("detailVertical"), detailRegistration: $("detailRegistration"), detailType: $("detailType"),
    detailCallsign: $("detailCallsign"), detailHex: $("detailHex"), detailSquawk: $("detailSquawk"),
    detailDistance: $("detailDistance"), detailHeading: $("detailHeading"), headingDial: $("headingDial"),
    trailText: $("trailText"), toast: $("toast"), openAr: $("openAr"), arOverlay: $("arOverlay"),
    closeAr: $("closeAr"), startAr: $("startAr"), arPermission: $("arPermission"), arVideo: $("arVideo"),
    arSensorStatus: $("arSensorStatus"), arHeading: $("arHeading"), arTargets: $("arTargets"),
    arNearest: $("arNearest"), arCount: $("arCount"),
  };

  const params = new URLSearchParams(location.search);
  const queryLat = finite(params.get("lat"));
  const queryLon = finite(params.get("lon"));
  const queryZoom = finite(params.get("zoom"));
  const initial = {
    lat: validLat(queryLat) ? queryLat : HOME.lat,
    lon: validLon(queryLon) ? queryLon : HOME.lon,
    zoom: queryZoom !== null ? clamp(queryZoom, 3, 16) : HOME.zoom,
  };

  const state = {
    map: null,
    aircraft: new Map(),
    markers: new Map(),
    trails: new Map(),
    trailLayer: null,
    userMarker: null,
    userAccuracy: null,
    userPosition: null,
    selectedId: null,
    pendingIcao: cleanHex(params.get("icao")),
    activeFilter: "all",
    search: "",
    mode: "radar",
    follow: false,
    loading: false,
    hasLoaded: false,
    feedSource: "",
    lastUpdated: 0,
    lastQuery: null,
    lastError: "",
    refreshTimer: 0,
    moveTimer: 0,
    requestController: null,
    routeCache: loadRouteCache(),
    routePending: new Set(),
    suppressMoveRefresh: false,
    mapResizeObserver: null,
    mapResizeFrame: 0,
    toastTimer: 0,
    ar: {
      active: false, stream: null, heading: null, elevation: 0, orientationAvailable: false,
      location: null, altitudeFt: 1000, orientationHandler: null, renderFrame: 0,
    },
  };

  function finite(value) {
    if (value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function validLat(value) { return value !== null && value >= -90 && value <= 90; }
  function validLon(value) { return value !== null && value >= -180 && value <= 180; }
  function cleanHex(value) { return String(value || "").replace(/^~/, "").replace(/[^a-fA-F0-9]/g, "").toLowerCase().slice(0, 8); }
  function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
  function radians(value) { return value * Math.PI / 180; }
  function degrees(value) { return value * 180 / Math.PI; }
  function normalizeAngle(value) { return ((value % 360) + 360) % 360; }
  function signedAngle(value) { return ((value + 540) % 360) - 180; }

  function haversineNm(lat1, lon1, lat2, lon2) {
    const earthNm = 3440.065;
    const dLat = radians(lat2 - lat1);
    const dLon = radians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    const phi1 = radians(lat1);
    const phi2 = radians(lat2);
    const dLon = radians(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
    return normalizeAngle(degrees(Math.atan2(y, x)));
  }

  function cardinal(heading) {
    if (heading === null || heading === undefined) return "—";
    const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return names[Math.round(normalizeAngle(heading) / 45) % 8];
  }

  function altitudeValue(value) {
    if (typeof value === "string" && value.toLowerCase() === "ground") return 0;
    return num(value);
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function formatAltitude(value) {
    if (value === null) return "—";
    if (value <= 0) return "Ground";
    return formatNumber(Math.round(value / 25) * 25) + " ft";
  }

  function formatSpeed(value) { return value === null ? "—" : formatNumber(Math.round(value)) + " kt"; }

  function formatVertical(value) {
    if (value === null) return "—";
    if (Math.abs(value) < 64) return "Level";
    return (value > 0 ? "+" : "−") + formatNumber(Math.abs(Math.round(value / 50) * 50)) + " fpm";
  }

  function formatDistance(value) {
    if (value === null) return "—";
    return value < 10 ? value.toFixed(1) + " NM" : Math.round(value) + " NM";
  }

  function typeLabel(aircraft) {
    if (aircraft.description) return aircraft.description;
    return TYPE_NAMES[aircraft.type] || aircraft.type || "Unknown aircraft";
  }

  function routeLabel(route) {
    if (!route) return "Route unavailable";
    if (typeof route === "string") {
      const cleaned = route.trim();
      if (!cleaned || cleaned.toLowerCase() === "unknown") return "Route unavailable";
      return cleaned.replace(/\s*[-–>]\s*/g, " → ");
    }
    if (Array.isArray(route)) return route.filter(Boolean).join(" → ") || "Route unavailable";
    if (typeof route === "object") {
      const origin = route.origin || route.from || route.departure;
      const destination = route.destination || route.to || route.arrival;
      if (origin || destination) return [origin || "?", destination || "?"].join(" → ");
    }
    return "Route unavailable";
  }

  function normalizeAircraft(raw, center) {
    const lat = num(raw.lat ?? raw.latitude);
    const lon = num(raw.lon ?? raw.lng ?? raw.longitude);
    if (!validLat(lat) || !validLon(lon)) return null;
    const hex = cleanHex(raw.hex ?? raw.icao ?? raw.icao24);
    if (!hex) return null;

    const flight = String(raw.flight ?? raw.callsign ?? "").trim().toUpperCase();
    const registration = String(raw.registration ?? raw.r ?? raw.reg ?? "").trim().toUpperCase();
    const type = String(raw.type ?? raw.t ?? raw.aircraftType ?? "").trim().toUpperCase();
    const altitudeFt = altitudeValue(raw.altitudeFt ?? raw.alt_baro ?? raw.alt_geom ?? raw.altitude);
    const groundSpeedKt = num(raw.groundSpeedKt ?? raw.gs ?? raw.ground_speed);
    const trackDeg = num(raw.trackDeg ?? raw.track ?? raw.true_heading ?? raw.mag_heading);
    const verticalRateFpm = num(raw.verticalRateFpm ?? raw.baro_rate ?? raw.geom_rate);
    const squawk = String(raw.squawk ?? "").trim();
    const category = String(raw.category ?? "").trim().toUpperCase();
    const flags = num(raw.dbFlags);
    const military = Boolean(raw.military) || (Number.isInteger(flags) && Boolean(flags & 1));
    const emergencyText = String(raw.emergency ?? "").toLowerCase();
    const emergency = Boolean(raw.emergency === true) || EMERGENCY_SQUAWKS.has(squawk) || (emergencyText && emergencyText !== "none" && emergencyText !== "false");
    const excludedInteresting = flight.startsWith("CLX") || type.startsWith("B74");
    const locallyInteresting = military || emergency || (!excludedInteresting && (SPECIAL_TYPES.has(type) || (category === "A7" && altitudeFt !== null && altitudeFt < 3000)));
    const interesting = Boolean(raw.interesting) || locallyInteresting;
    const cargo = Boolean(raw.cargo) || CARGO_PREFIXES.some((prefix) => flight.startsWith(prefix)) || /^B74/.test(type);
    const distanceNm = num(raw.distanceNm ?? raw.dst) ?? haversineNm(center.lat, center.lon, lat, lon);
    const bearing = num(raw.bearingDeg ?? raw.dir) ?? bearingDeg(center.lat, center.lon, lat, lon);
    const description = String(raw.description ?? raw.desc ?? "").trim();
    let route = raw.route ?? raw._airport_codes_iata ?? null;
    if (!route && (raw.origin || raw.destination)) route = { origin: raw.origin, destination: raw.destination };

    return {
      id: hex, hex, flight, registration, type, description, lat, lon, altitudeFt,
      groundSpeedKt, trackDeg: trackDeg === null ? null : normalizeAngle(trackDeg), verticalRateFpm,
      squawk, category, military, emergency, interesting, cargo,
      low: altitudeFt !== null && altitudeFt > 0 && altitudeFt < 5000,
      distanceNm, bearingDeg: bearing, route, lastSeen: Date.now(), stale: false,
    };
  }

  function loadRouteCache() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem("skylens:routes") || "{}");
      return new Map(Object.entries(parsed));
    } catch (_) { return new Map(); }
  }

  function saveRouteCache() {
    try { sessionStorage.setItem("skylens:routes", JSON.stringify(Object.fromEntries(state.routeCache))); } catch (_) {}
  }

  function syncMapSize(map = state.map) {
    if (!map || state.map !== map || els.radarView.hidden) return;
    if (state.mapResizeFrame) cancelAnimationFrame(state.mapResizeFrame);
    state.mapResizeFrame = requestAnimationFrame(() => {
      state.mapResizeFrame = 0;
      if (state.map === map && !els.radarView.hidden) {
        map.invalidateSize({ pan: false, debounceMoveend: true });
      }
    });
  }

  function stabilizeMapSize(map = state.map) {
    syncMapSize(map);
    for (const delay of [120, 450, 1200]) {
      setTimeout(() => syncMapSize(map), delay);
    }
  }

  function initMap() {
    if (!window.L) {
      showToast("The map library could not load. The flight list is still available.");
      setMode("list");
      return;
    }
    const map = L.map("map", {
      center: [initial.lat, initial.lon], zoom: initial.zoom, zoomControl: false,
      worldCopyJump: true, preferCanvas: true, minZoom: 3, maxZoom: 17,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
      updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 5,
    }).addTo(map);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.marker([LUX_AIRPORT.lat, LUX_AIRPORT.lon], {
      icon: L.divIcon({ className: "", html: '<div class="airport-marker">LUX</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      interactive: false, zIndexOffset: -300,
    }).addTo(map);
    map.on("moveend", handleMapMove);
    map.on("click", () => { if (innerWidth > 740) closeDetails(); });
    state.map = map;
    if (window.ResizeObserver) {
      state.mapResizeObserver = new ResizeObserver(() => syncMapSize(map));
      state.mapResizeObserver.observe(els.radarView);
    }
    map.whenReady(() => stabilizeMapSize(map));
  }

  function visibleQuery() {
    if (!state.map) return { lat: initial.lat, lon: initial.lon, radius: 70 };
    const center = state.map.getCenter();
    const bounds = state.map.getBounds();
    const corner = bounds.getNorthEast();
    const radius = clamp(haversineNm(center.lat, center.lng, corner.lat, corner.lng) * 1.08, 5, 250);
    return { lat: center.lat, lon: center.lng, radius };
  }

  function handleMapMove() {
    updateShareUrl();
    if (state.suppressMoveRefresh) {
      state.suppressMoveRefresh = false;
      return;
    }
    clearTimeout(state.moveTimer);
    state.moveTimer = setTimeout(() => refreshAircraft(true), 650);
  }

  function updateShareUrl() {
    if (!state.map) return;
    const center = state.map.getCenter();
    const url = new URL(location.href);
    url.searchParams.set("lat", center.lat.toFixed(4));
    url.searchParams.set("lon", center.lng.toFixed(4));
    url.searchParams.set("zoom", String(state.map.getZoom()));
    if (state.selectedId) url.searchParams.set("icao", state.selectedId);
    else url.searchParams.delete("icao");
    history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString() + url.hash);
  }

  async function requestJson(url, outerSignal, timeoutMs) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (outerSignal) outerSignal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener("abort", abort);
    }
  }

  async function getFeed(query, signal) {
    const qs = new URLSearchParams({
      lat: query.lat.toFixed(5), lon: query.lon.toFixed(5), radius: query.radius.toFixed(1),
    });
    const errors = [];
    try {
      const payload = await requestJson(PROXY + "?" + qs, signal, 6500);
      const aircraft = Array.isArray(payload.aircraft) ? payload.aircraft : payload.ac;
      if (!Array.isArray(aircraft)) throw new Error("Unexpected proxy response");
      return { aircraft, source: payload.source || "ian.lu ADS-B", now: payload.now };
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push("proxy: " + error.message);
    }

    for (const feed of DIRECT_FEEDS) {
      try {
        const url = feed.url + [query.lat.toFixed(5), query.lon.toFixed(5), query.radius.toFixed(1)].join("/");
        const payload = await requestJson(url, signal, 8500);
        if (!Array.isArray(payload.ac)) throw new Error("Unexpected feed response");
        return { aircraft: payload.ac, source: feed.name, now: payload.now };
      } catch (error) {
        if (signal.aborted) throw error;
        errors.push(feed.name + ": " + error.message);
      }
    }
    throw new Error(errors.join(" · "));
  }

  async function refreshAircraft(fromMove) {
    if (document.hidden && !fromMove) return scheduleRefresh();
    if (state.loading) {
      if (fromMove && state.requestController) state.requestController.abort();
      else return;
    }
    clearTimeout(state.refreshTimer);
    state.loading = true;
    const controller = new AbortController();
    state.requestController = controller;
    els.refresh.classList.add("is-spinning");
    els.livePulse.className = "live-pulse is-loading";
    if (!state.hasLoaded) els.feedStatus.textContent = "Loading live traffic…";
    const query = visibleQuery();

    try {
      const result = await getFeed(query, controller.signal);
      if (state.requestController !== controller) return;
      applyFeed(result.aircraft, query);
      state.feedSource = result.source;
      state.lastUpdated = Date.now();
      state.lastError = "";
      state.hasLoaded = true;
      els.livePulse.className = "live-pulse";
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === "AbortError")) return;
      state.lastError = error && error.message ? error.message : "Feed unavailable";
      els.livePulse.className = "live-pulse is-error";
      els.feedStatus.textContent = state.hasLoaded ? "Live feed interrupted" : "Aircraft feed unavailable";
      if (!state.hasLoaded) showToast("Live aircraft could not be loaded. SkyLens will keep retrying.");
    } finally {
      if (state.requestController === controller) {
        state.loading = false;
        els.refresh.classList.remove("is-spinning");
        scheduleRefresh();
        updateStatus();
      }
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshAircraft(false), REFRESH_MS);
  }

  function applyFeed(rawAircraft, center) {
    const now = Date.now();
    const previousQuery = state.lastQuery;
    const sameArea = !previousQuery || haversineNm(previousQuery.lat, previousQuery.lon, center.lat, center.lon) <= Math.max(5, Math.min(previousQuery.radius, center.radius) * .3);
    const next = new Map();
    for (const raw of rawAircraft) {
      if (!raw || typeof raw !== "object") continue;
      const aircraft = normalizeAircraft(raw, center);
      if (!aircraft) continue;
      const previous = state.aircraft.get(aircraft.id);
      if (previous && !aircraft.route) aircraft.route = previous.route;
      const cachedRoute = state.routeCache.get(aircraft.flight);
      if (!aircraft.route && cachedRoute) aircraft.route = cachedRoute;
      next.set(aircraft.id, aircraft);
      addTrailSample(aircraft, now);
    }

    for (const [id, previous] of state.aircraft) {
      if (sameArea && !next.has(id) && now - previous.lastSeen < STALE_MS) next.set(id, { ...previous, stale: true });
    }
    state.aircraft = next;
    state.lastQuery = { ...center };

    for (const [id, marker] of state.markers) {
      if (!next.has(id)) {
        if (state.map && state.map.hasLayer(marker)) marker.remove();
        state.markers.delete(id);
      }
    }

    if (state.pendingIcao && next.has(state.pendingIcao)) {
      const id = state.pendingIcao;
      state.pendingIcao = null;
      selectFlight(id, { follow: true, center: true });
    } else if (state.pendingIcao && !state.hasLoaded) {
      setTimeout(() => {
        if (state.pendingIcao) showToast("That aircraft is not currently visible in this area. SkyLens will keep watching.");
      }, 500);
    }

    renderAll();
    if (state.selectedId) {
      const selected = next.get(state.selectedId);
      if (selected) {
        renderDetails(selected);
        drawSelectedTrail();
        if (state.follow && state.map) {
          state.suppressMoveRefresh = true;
          state.map.panTo([selected.lat, selected.lon], { animate: true, duration: .7 });
        }
      } else {
        els.detailState.textContent = "SIGNAL LOST";
        els.detailState.style.color = "var(--sky-red)";
      }
    }
    scheduleArRender();
  }

  function addTrailSample(aircraft, time) {
    const trail = state.trails.get(aircraft.id) || [];
    const last = trail[trail.length - 1];
    if (!last || haversineNm(last[0], last[1], aircraft.lat, aircraft.lon) > .015) {
      trail.push([aircraft.lat, aircraft.lon, time]);
      if (trail.length > 120) trail.splice(0, trail.length - 120);
      state.trails.set(aircraft.id, trail);
    }
  }

  function matches(aircraft) {
    const filter = state.activeFilter;
    if (filter === "interesting" && !aircraft.interesting) return false;
    if (filter === "military" && !aircraft.military) return false;
    if (filter === "emergency" && !aircraft.emergency) return false;
    if (filter === "cargo" && !aircraft.cargo) return false;
    if (filter === "low" && !aircraft.low) return false;
    if (state.search) {
      const haystack = [aircraft.flight, aircraft.registration, aircraft.type, aircraft.hex, typeLabel(aircraft), routeLabel(aircraft.route)].join(" ").toLowerCase();
      if (!haystack.includes(state.search)) return false;
    }
    return true;
  }

  function sortedVisible() {
    return [...state.aircraft.values()].filter(matches).sort((a, b) => {
      if (a.emergency !== b.emergency) return a.emergency ? -1 : 1;
      if (a.interesting !== b.interesting) return a.interesting ? -1 : 1;
      return (a.distanceNm ?? 9999) - (b.distanceNm ?? 9999);
    });
  }

  function renderAll() {
    const visible = sortedVisible();
    renderMarkers(new Set(visible.map((aircraft) => aircraft.id)));
    renderList(visible);
    const all = [...state.aircraft.values()].filter((aircraft) => !aircraft.stale);
    els.countAll.textContent = all.length;
    els.countInteresting.textContent = all.filter((aircraft) => aircraft.interesting).length;
    const label = visible.length + (visible.length === 1 ? " aircraft" : " aircraft");
    els.visibleCount.textContent = label;
    els.listSummary.textContent = label + " in view";
  }

  function markerClass(aircraft) {
    if (aircraft.emergency) return "is-emergency";
    if (aircraft.military) return "is-military";
    if (aircraft.interesting) return "is-interesting";
    return "";
  }

  function markerIcon(aircraft) {
    const selected = aircraft.id === state.selectedId ? " is-selected" : "";
    const special = markerClass(aircraft);
    const label = aircraft.flight || aircraft.registration || aircraft.hex.toUpperCase();
    const track = Math.round(aircraft.trackDeg ?? 0);
    return L.divIcon({
      className: "aircraft-marker",
      html: '<div class="plane-marker-wrap ' + special + selected + '" style="--track:' + track + 'deg">' +
        '<span class="plane-marker-ring"></span><span class="plane-marker-glyph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + PLANE_PATH + '"></path></svg></span>' +
        '<span class="plane-marker-label">' + esc(label) + '</span></div>',
      iconSize: [34, 42], iconAnchor: [17, 17], tooltipAnchor: [0, -16],
    });
  }

  function renderMarkers(visibleIds) {
    if (!state.map || !window.L) return;
    for (const aircraft of state.aircraft.values()) {
      const shouldShow = visibleIds.has(aircraft.id) || aircraft.id === state.selectedId;
      let marker = state.markers.get(aircraft.id);
      if (!shouldShow) {
        if (marker && state.map.hasLayer(marker)) marker.remove();
        continue;
      }
      const key = [Math.round(aircraft.trackDeg ?? 0), markerClass(aircraft), aircraft.id === state.selectedId, aircraft.flight, aircraft.stale].join("|");
      if (!marker) {
        marker = L.marker([aircraft.lat, aircraft.lon], {
          icon: markerIcon(aircraft), keyboard: true, title: aircraft.flight || aircraft.registration || aircraft.hex,
          zIndexOffset: aircraft.id === state.selectedId ? 800 : aircraft.emergency ? 600 : aircraft.interesting ? 300 : 0,
        });
        marker.on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          selectFlight(aircraft.id, { center: false });
        });
        marker._skyKey = key;
        state.markers.set(aircraft.id, marker);
      }
      marker.setLatLng([aircraft.lat, aircraft.lon]);
      marker.setZIndexOffset(aircraft.id === state.selectedId ? 800 : aircraft.emergency ? 600 : aircraft.interesting ? 300 : 0);
      if (marker._skyKey !== key) {
        marker.setIcon(markerIcon(aircraft));
        marker._skyKey = key;
      }
      if (!state.map.hasLayer(marker)) marker.addTo(state.map);
      if (aircraft.stale) marker.setOpacity(.48); else marker.setOpacity(1);
    }
  }

  function planeSvg(track) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" style="--track:' + Math.round(track ?? 0) + 'deg"><path d="' + PLANE_PATH + '"></path></svg>';
  }

  function renderList(aircraft) {
    els.flightList.innerHTML = aircraft.map((item) => {
      const identity = item.flight || item.registration || item.hex.toUpperCase();
      const sub = item.route ? routeLabel(item.route) : (item.registration || item.hex.toUpperCase());
      const type = item.type || "Unknown";
      const selected = item.id === state.selectedId ? " is-selected" : "";
      return '<button class="flight-card ' + markerClass(item) + selected + '" type="button" data-id="' + esc(item.id) + '">' +
        '<span class="flight-identity"><span class="list-plane">' + planeSvg(item.trackDeg) + '</span><span class="flight-main"><strong>' + esc(identity) + '</strong><span>' + esc(sub) + '</span></span></span>' +
        '<span class="flight-type"><strong>' + esc(type) + '</strong><span>' + esc(typeLabel(item)) + '</span></span>' +
        '<span class="flight-metric">' + esc(formatAltitude(item.altitudeFt)) + '<small>' + esc(formatVertical(item.verticalRateFpm)) + '</small></span>' +
        '<span class="flight-metric">' + esc(formatSpeed(item.groundSpeedKt)) + '<small>' + esc(cardinal(item.trackDeg)) + ' ' + (item.trackDeg === null ? "" : Math.round(item.trackDeg) + "°") + '</small></span>' +
        '<span class="flight-metric distance">' + esc(formatDistance(item.distanceNm)) + '<small>' + esc(cardinal(item.bearingDeg)) + ' from center</small></span>' +
      '</button>';
    }).join("");
    els.emptyState.hidden = aircraft.length > 0;
  }

  function selectFlight(id, options) {
    const aircraft = state.aircraft.get(id);
    if (!aircraft) return;
    state.selectedId = id;
    if (options && options.follow) state.follow = true;
    renderDetails(aircraft);
    els.drawer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => els.drawer.classList.add("is-open"));
    renderAll();
    drawSelectedTrail();
    updateFollowButton();
    updateShareUrl();
    enrichRoute(aircraft);
    if (options && options.center && state.map) {
      state.suppressMoveRefresh = true;
      state.map.setView([aircraft.lat, aircraft.lon], Math.max(state.map.getZoom(), 10), { animate: true });
    }
  }

  function closeDetails() {
    state.follow = false;
    state.selectedId = null;
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => { if (!els.drawer.classList.contains("is-open")) els.drawer.scrollTop = 0; }, 280);
    if (state.trailLayer && state.map) {
      state.trailLayer.remove();
      state.trailLayer = null;
    }
    updateFollowButton();
    updateShareUrl();
    renderAll();
  }

  function renderDetails(aircraft) {
    els.detailState.textContent = aircraft.stale ? "POSITION DELAYED" : aircraft.emergency ? "EMERGENCY" : "LIVE FLIGHT";
    els.detailState.style.color = aircraft.emergency ? "var(--sky-red)" : aircraft.stale ? "var(--sky-amber)" : "var(--sky-green)";
    els.detailFlight.textContent = aircraft.flight || aircraft.registration || aircraft.hex.toUpperCase();
    els.detailRoute.textContent = routeLabel(aircraft.route);
    const badges = [];
    if (aircraft.emergency) badges.push('<span class="detail-badge emergency">Emergency</span>');
    if (aircraft.military) badges.push('<span class="detail-badge military">Military</span>');
    else if (aircraft.interesting) badges.push('<span class="detail-badge interesting">★ Interesting</span>');
    if (aircraft.cargo) badges.push('<span class="detail-badge">Cargo</span>');
    if (aircraft.category) badges.push('<span class="detail-badge">' + esc(aircraft.category) + '</span>');
    els.detailBadges.innerHTML = badges.join("");
    els.detailAltitude.textContent = formatAltitude(aircraft.altitudeFt);
    els.detailSpeed.textContent = formatSpeed(aircraft.groundSpeedKt);
    els.detailVertical.textContent = formatVertical(aircraft.verticalRateFpm);
    els.detailRegistration.textContent = aircraft.registration || "Unknown";
    els.detailType.textContent = aircraft.type ? aircraft.type + " · " + typeLabel(aircraft) : "Unknown";
    els.detailType.title = typeLabel(aircraft);
    els.detailCallsign.textContent = aircraft.flight || "Unknown";
    els.detailHex.textContent = aircraft.hex.toUpperCase();
    els.detailSquawk.textContent = aircraft.squawk || "—";
    els.detailDistance.textContent = formatDistance(aircraft.distanceNm) + (aircraft.bearingDeg === null ? "" : " · " + cardinal(aircraft.bearingDeg));
    els.detailHeading.textContent = aircraft.trackDeg === null ? "—" : Math.round(aircraft.trackDeg) + "° " + cardinal(aircraft.trackDeg);
    els.headingDial.style.setProperty("--heading", (aircraft.trackDeg ?? 0) + "deg");
    const trail = state.trails.get(aircraft.id) || [];
    els.trailText.textContent = trail.length > 1 ? trail.length + " positions captured this session" : "Trail starts while SkyLens is open";
  }

  function drawSelectedTrail() {
    if (!state.map || !state.selectedId) return;
    if (state.trailLayer) state.trailLayer.remove();
    const trail = state.trails.get(state.selectedId) || [];
    if (trail.length < 2) { state.trailLayer = null; return; }
    state.trailLayer = L.polyline(trail.map((point) => [point[0], point[1]]), {
      color: "#32D6FF", weight: 3, opacity: .82, lineJoin: "round", dashArray: "1 7",
    }).addTo(state.map);
  }

  async function enrichRoute(aircraft) {
    const callsign = aircraft.flight;
    if (!callsign || state.routePending.has(callsign)) return;
    if (state.routeCache.has(callsign)) {
      aircraft.route = state.routeCache.get(callsign);
      if (state.selectedId === aircraft.id) renderDetails(aircraft);
      return;
    }
    state.routePending.add(callsign);
    const qs = new URLSearchParams({ action: "route", callsign, lat: aircraft.lat.toFixed(5), lon: aircraft.lon.toFixed(5) });
    try {
      const payload = await requestJson(PROXY + "?" + qs, null, 7000);
      let route = payload.route || null;
      if (!route && (payload.origin || payload.destination)) route = { origin: payload.origin, destination: payload.destination };
      if (route && routeLabel(route) !== "Route unavailable") {
        state.routeCache.set(callsign, route);
        saveRouteCache();
        const current = state.aircraft.get(aircraft.id);
        if (current) current.route = route;
        if (state.selectedId === aircraft.id && current) renderDetails(current);
        if (state.mode === "list") renderAll();
      }
    } catch (_) {
      // Route enrichment is deliberately best-effort; position tracking continues.
    } finally { state.routePending.delete(callsign); }
  }

  function updateFollowButton() {
    els.follow.classList.toggle("is-active", state.follow);
    els.follow.setAttribute("aria-pressed", String(state.follow));
    els.follow.lastChild.textContent = state.follow ? " Following" : " Follow";
  }

  function setMode(mode) {
    state.mode = mode === "list" ? "list" : "radar";
    const radar = state.mode === "radar";
    els.radarView.hidden = !radar;
    els.listView.hidden = radar;
    els.radarMode.classList.toggle("is-active", radar);
    els.listMode.classList.toggle("is-active", !radar);
    els.radarMode.setAttribute("aria-pressed", String(radar));
    els.listMode.setAttribute("aria-pressed", String(!radar));
    try { localStorage.setItem("skylens:view", state.mode); } catch (_) {}
    if (radar && state.map) stabilizeMapSize(state.map);
  }

  function locateUser() {
    if (!navigator.geolocation) return showToast("Location is not supported by this browser.");
    els.locate.classList.add("is-active");
    navigator.geolocation.getCurrentPosition((position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      state.userPosition = { lat, lon, altitudeFt: position.coords.altitude === null ? 1000 : position.coords.altitude * 3.28084 };
      if (state.map) {
        if (state.userMarker) state.userMarker.remove();
        if (state.userAccuracy) state.userAccuracy.remove();
        state.userMarker = L.marker([lat, lon], {
          icon: L.divIcon({ className: "", html: '<div class="user-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
          title: "Your location", zIndexOffset: 1000,
        }).addTo(state.map);
        state.userAccuracy = L.circle([lat, lon], { radius: position.coords.accuracy, color: "#3887ff", weight: 1, fillColor: "#3887ff", fillOpacity: .07 }).addTo(state.map);
        state.map.setView([lat, lon], Math.max(state.map.getZoom(), 10), { animate: true });
      }
      els.locate.classList.remove("is-active");
      showToast("Centered on your location");
    }, (error) => {
      els.locate.classList.remove("is-active");
      const denied = error && error.code === 1;
      showToast(denied ? "Location permission was not granted." : "Your location could not be found.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  function updateStatus() {
    if (!state.lastUpdated) return;
    const seconds = Math.max(0, Math.round((Date.now() - state.lastUpdated) / 1000));
    const age = seconds < 4 ? "just now" : seconds < 60 ? seconds + "s ago" : Math.floor(seconds / 60) + "m ago";
    const source = state.feedSource ? state.feedSource + " · " : "";
    els.feedStatus.textContent = source + age;
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    state.toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 3600);
  }

  function openArOverlay() {
    els.arOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      els.arPermission.querySelector("h2").textContent = "Camera view is unavailable";
      els.arPermission.querySelector("p").textContent = "Sky view needs a secure browser with camera access. The live radar and list remain available.";
      els.startAr.disabled = true;
      els.startAr.textContent = "Not supported here";
    }
  }

  async function startAr() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    els.startAr.disabled = true;
    els.startAr.textContent = "Opening camera…";

    let orientationRequest = Promise.resolve("unavailable");
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      try { orientationRequest = DeviceOrientationEvent.requestPermission(); } catch (_) {}
    } else if (window.DeviceOrientationEvent) {
      orientationRequest = Promise.resolve("granted");
    }
    const cameraRequest = navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });

    try {
      const results = await Promise.allSettled([orientationRequest, cameraRequest]);
      const orientationGranted = results[0].status === "fulfilled" && results[0].value === "granted";
      if (results[1].status !== "fulfilled") throw results[1].reason;
      state.ar.stream = results[1].value;
      els.arVideo.srcObject = state.ar.stream;
      await els.arVideo.play().catch(() => {});
      state.ar.active = true;
      state.ar.orientationAvailable = orientationGranted;
      els.arPermission.hidden = true;
      els.arSensorStatus.textContent = orientationGranted ? "Camera + live sensor alignment" : "Camera live · compass unavailable";

      if (orientationGranted) {
        state.ar.orientationHandler = handleOrientation;
        window.addEventListener("deviceorientation", state.ar.orientationHandler, true);
      }
      acquireArLocation();
      scheduleArRender();
    } catch (error) {
      els.startAr.disabled = false;
      els.startAr.textContent = "Try again";
      els.arPermission.querySelector("h2").textContent = "Camera permission needed";
      els.arPermission.querySelector("p").textContent = "Allow camera access in your browser settings, then try again. SkyLens never uploads camera frames.";
    }
  }

  function acquireArLocation() {
    if (!navigator.geolocation) {
      fallbackArLocation();
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      state.ar.location = { lat: position.coords.latitude, lon: position.coords.longitude };
      state.ar.altitudeFt = position.coords.altitude === null ? 1000 : position.coords.altitude * 3.28084;
      state.userPosition = { ...state.ar.location, altitudeFt: state.ar.altitudeFt };
      scheduleArRender();
    }, fallbackArLocation, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  function fallbackArLocation() {
    if (state.userPosition) {
      state.ar.location = { lat: state.userPosition.lat, lon: state.userPosition.lon };
      state.ar.altitudeFt = state.userPosition.altitudeFt || 1000;
    } else {
      const center = visibleQuery();
      state.ar.location = { lat: center.lat, lon: center.lon };
      state.ar.altitudeFt = 1000;
      els.arSensorStatus.textContent += " · map-center location";
    }
    scheduleArRender();
  }

  function handleOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === "number") heading = event.webkitCompassHeading;
    else if (typeof event.alpha === "number") {
      const screenAngle = (screen.orientation && Number(screen.orientation.angle)) || Number(window.orientation) || 0;
      heading = 360 - event.alpha + screenAngle;
    }
    if (heading !== null) state.ar.heading = normalizeAngle(heading);
    if (typeof event.beta === "number") state.ar.elevation = clamp(90 - event.beta, -80, 80);
    scheduleArRender();
  }

  function scheduleArRender() {
    if (!state.ar.active || state.ar.renderFrame) return;
    state.ar.renderFrame = requestAnimationFrame(() => {
      state.ar.renderFrame = 0;
      renderAr();
    });
  }

  function renderAr() {
    if (!state.ar.active) return;
    const location = state.ar.location;
    if (!location) {
      els.arHeading.textContent = "Finding your location…";
      return;
    }
    const nearby = [...state.aircraft.values()].map((aircraft) => ({
      aircraft,
      distance: haversineNm(location.lat, location.lon, aircraft.lat, aircraft.lon),
      bearing: bearingDeg(location.lat, location.lon, aircraft.lat, aircraft.lon),
    })).filter((item) => item.distance <= 80).sort((a, b) => a.distance - b.distance);
    els.arCount.textContent = nearby.length + " nearby";
    const heading = state.ar.heading;
    els.arHeading.textContent = heading === null ? "Compass unavailable · use the bearing cards" : Math.round(heading) + "° " + cardinal(heading) + " · " + Math.round(state.ar.elevation) + "° elevation";

    if (heading === null || !state.ar.orientationAvailable) {
      els.arTargets.innerHTML = "";
    } else {
      const horizontalFov = 68;
      const verticalFov = clamp(horizontalFov / Math.max(.65, innerWidth / innerHeight), 45, 70);
      const targets = [];
      for (const item of nearby.slice(0, 35)) {
        const aircraft = item.aircraft;
        const delta = signedAngle(item.bearing - heading);
        const horizontalMeters = Math.max(100, item.distance * 1852);
        const targetElevation = degrees(Math.atan2(((aircraft.altitudeFt ?? state.ar.altitudeFt) - state.ar.altitudeFt) * .3048, horizontalMeters));
        const elevationDelta = targetElevation - state.ar.elevation;
        const x = 50 + (delta / horizontalFov) * 100;
        const y = 50 - (elevationDelta / verticalFov) * 100;
        if (x < 4 || x > 96 || y < 11 || y > 88) continue;
        const classes = aircraft.emergency ? " is-emergency" : aircraft.interesting ? " is-interesting" : "";
        const name = aircraft.flight || aircraft.registration || aircraft.hex.toUpperCase();
        targets.push('<div class="ar-target' + classes + '" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%"><div class="ar-target-main"><strong>' + esc(name) + '</strong><span>' + esc(formatAltitude(aircraft.altitudeFt)) + ' · ' + esc(formatDistance(item.distance)) + '</span></div></div>');
        if (targets.length >= 12) break;
      }
      els.arTargets.innerHTML = targets.join("");
    }

    els.arNearest.innerHTML = nearby.slice(0, 8).map((item) => {
      const aircraft = item.aircraft;
      const name = aircraft.flight || aircraft.registration || aircraft.hex.toUpperCase();
      return '<div class="ar-bearing-card"><strong>' + esc(name) + ' · ' + Math.round(item.bearing) + '° ' + esc(cardinal(item.bearing)) + '</strong><span>' + esc(formatDistance(item.distance)) + ' · ' + esc(formatAltitude(aircraft.altitudeFt)) + '</span></div>';
    }).join("");
  }

  function closeAr() {
    state.ar.active = false;
    if (state.ar.renderFrame) cancelAnimationFrame(state.ar.renderFrame);
    state.ar.renderFrame = 0;
    if (state.ar.stream) state.ar.stream.getTracks().forEach((track) => track.stop());
    state.ar.stream = null;
    els.arVideo.srcObject = null;
    if (state.ar.orientationHandler) window.removeEventListener("deviceorientation", state.ar.orientationHandler, true);
    state.ar.orientationHandler = null;
    state.ar.heading = null;
    els.arTargets.innerHTML = "";
    els.arNearest.innerHTML = "";
    els.arPermission.hidden = false;
    els.startAr.disabled = false;
    els.startAr.textContent = "Start sky view";
    els.arPermission.querySelector("h2").textContent = "Identify aircraft in the sky";
    els.arPermission.querySelector("p").textContent = "SkyLens uses your rear camera, location and motion sensors to place live flight labels in the right direction.";
    els.arOverlay.hidden = true;
  }

  function bindEvents() {
    els.radarMode.addEventListener("click", () => setMode("radar"));
    els.listMode.addEventListener("click", () => setMode("list"));
    els.search.addEventListener("input", () => { state.search = els.search.value.trim().toLowerCase(); renderAll(); });
    els.filterBar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.activeFilter = button.dataset.filter;
      for (const chip of els.filterBar.querySelectorAll("[data-filter]")) chip.classList.toggle("is-active", chip === button);
      renderAll();
    });
    els.flightList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-id]");
      if (card) selectFlight(card.dataset.id, { center: false });
    });
    els.refresh.addEventListener("click", () => refreshAircraft(true));
    els.locate.addEventListener("click", locateUser);
    els.home.addEventListener("click", () => {
      if (!state.map) return;
      state.map.setView([HOME.lat, HOME.lon], HOME.zoom, { animate: true });
    });
    els.closeDrawer.addEventListener("click", closeDetails);
    els.follow.addEventListener("click", () => {
      if (!state.selectedId) return;
      state.follow = !state.follow;
      updateFollowButton();
      if (state.follow) {
        const aircraft = state.aircraft.get(state.selectedId);
        if (aircraft && state.map) state.map.panTo([aircraft.lat, aircraft.lon], { animate: true });
      }
    });
    els.center.addEventListener("click", () => {
      const aircraft = state.aircraft.get(state.selectedId);
      if (!aircraft || !state.map) return;
      setMode("radar");
      state.suppressMoveRefresh = true;
      state.map.setView([aircraft.lat, aircraft.lon], Math.max(10, state.map.getZoom()), { animate: true });
    });
    els.openAr.addEventListener("click", openArOverlay);
    els.closeAr.addEventListener("click", closeAr);
    els.startAr.addEventListener("click", startAr);
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        event.preventDefault(); els.search.focus();
      }
      if (event.key === "Escape") {
        if (!els.arOverlay.hidden) closeAr();
        else if (state.selectedId) closeDetails();
        else if (document.activeElement === els.search) els.search.blur();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        stabilizeMapSize(state.map);
        if (Date.now() - state.lastUpdated > REFRESH_MS) refreshAircraft(true);
      }
    });
    window.addEventListener("pageshow", () => stabilizeMapSize(state.map));
    window.addEventListener("beforeunload", () => {
      if (state.requestController) state.requestController.abort();
      if (state.ar.stream) state.ar.stream.getTracks().forEach((track) => track.stop());
      if (state.mapResizeObserver) state.mapResizeObserver.disconnect();
      if (state.mapResizeFrame) cancelAnimationFrame(state.mapResizeFrame);
    });
  }

  function boot() {
    initMap();
    bindEvents();
    let savedMode = "radar";
    try { savedMode = localStorage.getItem("skylens:view") || "radar"; } catch (_) {}
    setMode(location.hash === "#list" ? "list" : savedMode);
    updateFollowButton();
    refreshAircraft(false);
    setInterval(updateStatus, 1000);
  }

  boot();
})();
