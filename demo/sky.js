import { SKY } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";
import { loadLeaflet } from "./leaflet.js?v=1";

const FETCH_TIMEOUT_MS = 9000;
const MAP_ZOOM = 9;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const PLANE_PATH = "M12 1.5 15.2 10l7.6 3.8v2.6l-8.1-1.7-1.1 6 3.2 2.1V24L12 22.8 7.2 24v-1.2l3.2-2.1-1.1-6-8.1 1.7v-2.6L8.8 10 12 1.5Z";

export const meta = { badge: "live" };

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function altitudeText(altitudeFt) {
  const altitude = finiteNumber(altitudeFt);
  if (altitude === null) return "—";
  return `${Math.round(altitude).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009")} ft`;
}

function speedText(speedKt) {
  const speed = finiteNumber(speedKt);
  return speed === null ? "—" : `${Math.round(speed)} kt`;
}

function message(text, className = "dmuted") {
  const paragraph = document.createElement("p");
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function failureState() {
  const failure = message(UI.failed, "dfail");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbtn";
  button.dataset.retry = "true";
  button.textContent = UI.retry;
  failure.append(button);
  return failure;
}

function sizeMapContainer(element) {
  element.className = "dmap";   // height and radius live in demo.css
}

function aircraftId(aircraft) {
  return cleanText(aircraft.hex).toLowerCase();
}

function visibleAircraft(aircraft) {
  return aircraft
    .filter((item) => item && item.onGround !== true)
    .map((item) => ({
      item,
      id: aircraftId(item),
      lat: finiteNumber(item.lat),
      lon: finiteNumber(item.lon),
    }))
    .filter(({ id, lat, lon }) => id && lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    .sort((left, right) => {
      const leftDistance = finiteNumber(left.item.distanceNm);
      const rightDistance = finiteNumber(right.item.distanceNm);
      return (leftDistance ?? Infinity) - (rightDistance ?? Infinity);
    })
    .slice(0, Math.max(0, Number(SKY.maxRows) || 0));
}

function markerColour(aircraft) {
  // Visual priority when flags overlap: military, special, interesting, cargo, ordinary.
  if (aircraft.military) return "#ef4444";
  if (aircraft.special) return "#c084fc";
  if (aircraft.interesting) return "#facc15";
  if (aircraft.cargo) return "#fb923c";
  return "#1d6fce";
}

function markerIcon(Leaflet, aircraft) {
  const track = finiteNumber(aircraft.trackDeg) ?? 0;
  const colour = markerColour(aircraft);
  const html = `<svg viewBox="0 0 24 25" aria-hidden="true" style="display:block;width:30px;height:31px;transform:rotate(${track}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.75))"><path style="fill:${colour};stroke:#ffffff;stroke-width:.7;stroke-linejoin:round;stroke-linecap:round;paint-order:stroke" d="${PLANE_PATH}"></path></svg>`;
  return Leaflet.divIcon({
    className: "",
    html,
    iconSize: [30, 31],
    iconAnchor: [15, 15],
    popupAnchor: [0, -13],
  });
}

function popupContent(aircraft) {
  const popup = document.createElement("div");
  const identity = document.createElement("strong");
  identity.textContent = cleanText(aircraft.flight)
    || cleanText(aircraft.registration)
    || cleanText(aircraft.hex)
    || "—";
  const details = document.createElement("div");
  details.textContent = [cleanText(aircraft.registration), cleanText(aircraft.type)].filter(Boolean).join(" · ") || "—";
  const metrics = document.createElement("div");
  metrics.textContent = `${altitudeText(aircraft.altitudeFt)} · ${speedText(aircraft.groundSpeedKt)}`;
  popup.append(identity, details, metrics);
  return popup;
}

export function mount(host, opts = {}) {
  void opts;
  let destroyed = false;
  let activeController = null;
  let hasGoodFeed = false;
  let map = null;
  let resizeObserver = null;
  let resizeFrame = 0;
  const markerStates = new Map();
  const timers = new Set();

  const body = document.createElement("div");
  body.className = "dlist";
  const mapElement = document.createElement("div");
  mapElement.className = "dtrail-map";
  mapElement.setAttribute("aria-label", UI.loading);
  sizeMapContainer(mapElement);
  const status = document.createElement("div");
  status.replaceChildren(message(UI.loading));
  body.append(mapElement, status);
  host.replaceChildren(body);

  const scheduleInvalidate = () => {
    if (!map || destroyed) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!map || destroyed) return;
      const bounds = mapElement.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) map.invalidateSize({ pan: false });
    });
  };

  const onViewportResize = () => {
    sizeMapContainer(mapElement);
    scheduleInvalidate();
  };

  const ensureMap = async () => {
    if (map) return map;
    mapElement.hidden = false;
    sizeMapContainer(mapElement);
    const Leaflet = await loadLeaflet();
    if (destroyed) return null;
    if (map) return map;
    map = Leaflet.map(mapElement, {
      center: [SKY.lat, SKY.lon],
      zoom: MAP_ZOOM,
      scrollWheelZoom: false,
    });
    Leaflet.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    resizeObserver = window.ResizeObserver ? new ResizeObserver(scheduleInvalidate) : null;
    resizeObserver?.observe(mapElement);
    map.whenReady(scheduleInvalidate);
    const delayedInvalidate = setTimeout(scheduleInvalidate, 250);
    timers.add(delayedInvalidate);
    return map;
  };

  const syncMarkers = (Leaflet, aircraft) => {
    const visible = visibleAircraft(aircraft);
    const nextIds = new Set(visible.map(({ id }) => id));

    markerStates.forEach(({ marker }, id) => {
      if (nextIds.has(id)) return;
      marker.remove();
      markerStates.delete(id);
    });

    visible.forEach(({ item, id, lat, lon }) => {
      const colour = markerColour(item);
      const iconKey = `${Math.round(finiteNumber(item.trackDeg) ?? 0)}|${colour}`;
      const existing = markerStates.get(id);
      if (!existing) {
        const marker = Leaflet.marker([lat, lon], {
          icon: markerIcon(Leaflet, item),
          title: cleanText(item.flight) || cleanText(item.registration) || cleanText(item.hex),
        }).addTo(map);
        marker.bindPopup(popupContent(item));
        markerStates.set(id, { marker, iconKey });
        return;
      }

      existing.marker.setLatLng([lat, lon]);
      if (existing.iconKey !== iconKey) {
        existing.marker.setIcon(markerIcon(Leaflet, item));
        existing.iconKey = iconKey;
      }
      existing.marker.getPopup()?.setContent(popupContent(item));
    });

    status.replaceChildren(visible.length === 0 ? message(UI.skyEmpty) : document.createTextNode(""));
  };

  const markStale = () => {
    status.replaceChildren(message(UI.failed));
  };

  const load = async () => {
    if (destroyed || activeController) return;
    const activeMap = await ensureMap();
    if (!activeMap || destroyed || activeController) return;
    const controller = new AbortController();
    activeController = controller;
    const url = new URL(SKY.proxy);
    url.searchParams.set("lat", SKY.lat.toFixed(5));
    url.searchParams.set("lon", SKY.lon.toFixed(5));
    url.searchParams.set("radius", SKY.radiusNm.toFixed(1));
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timers.add(timeout);

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.aircraft)) throw new TypeError("Invalid aircraft payload");
      if (destroyed) return;
      syncMarkers(window.L, payload.aircraft);
      hasGoodFeed = true;
    } catch (error) {
      if (destroyed) return;
      if (hasGoodFeed) markStale();
      else status.replaceChildren(failureState());
    } finally {
      clearTimeout(timeout);
      timers.delete(timeout);
      if (activeController === controller) activeController = null;
    }
  };

  const start = async () => {
    try {
      await load();
    } catch (error) {
      if (!destroyed) {
        if (!map) mapElement.hidden = true;
        status.replaceChildren(failureState());
      }
    }
  };

  const retryLoad = (event) => {
    const button = event.target.closest("[data-retry]");
    if (button && body.contains(button)) void start();
  };

  body.addEventListener("click", retryLoad);
  window.addEventListener("resize", onViewportResize);
  void start();
  const refreshTimer = setInterval(() => void start(), SKY.refreshMs);
  timers.add(refreshTimer);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeController?.abort();
      activeController = null;
      timers.forEach((timer) => {
        clearTimeout(timer);
        clearInterval(timer);
      });
      timers.clear();
      cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      resizeObserver = null;
      body.removeEventListener("click", retryLoad);
      window.removeEventListener("resize", onViewportResize);
      markerStates.clear();
      if (map) map.remove();
      map = null;
      mapElement.remove();
    },
  };
}
