import { TRAILS } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";
import { loadLeaflet } from "./leaflet.js?v=1";

const FETCH_TIMEOUT_MS = 9000;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TRAIL_COLOUR = "#1d6fce";
const MTB_COLOUR = "#fbbf24";

export const meta = { badge: null };

function validateGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) throw new TypeError("Invalid trail geometry");
  const lines = geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.type === "MultiLineString"
      ? geometry.coordinates
      : null;
  if (!lines) throw new TypeError("Unsupported trail geometry");
  const hasLine = lines.some((line) => Array.isArray(line) && line.filter((position) =>
    Array.isArray(position)
      && Number.isFinite(Number(position[0]))
      && Number.isFinite(Number(position[1])),
  ).length >= 2);
  if (!hasLine) throw new TypeError("Empty trail geometry");
}

function trailDetails(trail) {
  const row = document.createElement("div");
  row.className = "drow";
  const main = document.createElement("div");
  main.className = "drow-main";
  const title = document.createElement("div");
  title.className = "drow-title";
  title.textContent = `${trail.km} km · ${trail.time} · ${trail.grade}`;
  const note = document.createElement("div");
  note.className = "drow-sub";
  note.textContent = trail.note;
  main.append(title, note);
  row.append(main);
  return row;
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

export function mount(host, opts = {}) {
  void opts;
  let destroyed = false;
  let selectedIndex = 0;
  let requestVersion = 0;
  let activeController = null;
  let map = null;
  let routeLayer = null;
  let resizeObserver = null;
  let resizeFrame = 0;
  const geometryCache = new Map();
  const timers = new Set();

  const root = document.createElement("div");
  const chips = document.createElement("div");
  chips.className = "dchips";
  TRAILS.forEach((trail, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = index === 0 ? "dchip on" : "dchip";
    chip.dataset.trailIndex = String(index);
    chip.textContent = trail.name;
    chips.append(chip);
  });

  const body = document.createElement("div");
  const content = document.createElement("div");
  content.className = "dlist";
  const mapElement = document.createElement("div");
  mapElement.className = "dtrail-map";
  mapElement.setAttribute("aria-hidden", "true");
  sizeMapContainer(mapElement);
  const details = document.createElement("div");
  details.replaceChildren(message(UI.loading));
  const link = document.createElement("a");
  link.className = "dbtn";
  link.textContent = UI.openApp;
  link.hidden = true;
  content.append(mapElement, details, link);
  body.append(content);
  root.append(chips, body);
  host.replaceChildren(root);

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

  const ensureMap = (Leaflet) => {
    if (map) return map;
    mapElement.hidden = false;
    sizeMapContainer(mapElement);
    map = Leaflet.map(mapElement, { scrollWheelZoom: false });
    Leaflet.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    resizeObserver = window.ResizeObserver ? new ResizeObserver(scheduleInvalidate) : null;
    resizeObserver?.observe(mapElement);
    map.whenReady(scheduleInvalidate);
    const delayedInvalidate = setTimeout(scheduleInvalidate, 250);
    timers.add(delayedInvalidate);
    return map;
  };

  const render = (Leaflet, trail, geo) => {
    ensureMap(Leaflet);
    if (routeLayer) map.removeLayer(routeLayer);
    const colour = trail.cat === "mtb" ? MTB_COLOUR : TRAIL_COLOUR;
    routeLayer = Leaflet.geoJSON(geo, {
      style: { color: colour, weight: 4, opacity: 0.85 },
    }).addTo(map);
    // The legacy SVG selector is more specific than Leaflet's presentation attribute.
    routeLayer.eachLayer((layer) => layer.getElement()?.style.setProperty("stroke", colour));
    map.fitBounds(routeLayer.getBounds(), { padding: [20, 20] });
    details.replaceChildren(trailDetails(trail));
    link.href = `/${trail.cat === "mtb" ? "mtb" : "trails"}/de/${encodeURIComponent(trail.slug)}.html`;
    link.hidden = false;
    scheduleInvalidate();
  };

  const abortActive = () => {
    activeController?.abort();
    activeController = null;
  };

  const fetchGeometry = async (trail, controller) => {
    const cached = geometryCache.get(trail.slug);
    if (cached) return cached;
    const response = await fetch(`/${trail.cat}/geo/${encodeURIComponent(trail.slug)}.geojson`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    validateGeometry(payload?.geometry);
    geometryCache.set(trail.slug, payload);
    return payload;
  };

  const load = async () => {
    if (destroyed) return;
    abortActive();
    const version = ++requestVersion;
    const trail = TRAILS[selectedIndex];
    mapElement.hidden = false;
    details.replaceChildren(message(UI.loading));
    link.hidden = true;
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timers.add(timeout);

    try {
      const [Leaflet, geo] = await Promise.all([loadLeaflet(), fetchGeometry(trail, controller)]);
      if (destroyed || version !== requestVersion) return;
      render(Leaflet, trail, geo);
    } catch (error) {
      if (destroyed || version !== requestVersion) return;
      if (!map) mapElement.hidden = true;
      details.replaceChildren(failureState());
    } finally {
      clearTimeout(timeout);
      timers.delete(timeout);
      if (activeController === controller) activeController = null;
    }
  };

  const selectTrail = (event) => {
    const chip = event.target.closest("[data-trail-index]");
    if (!chip || !chips.contains(chip)) return;
    const index = Number(chip.dataset.trailIndex);
    if (!Number.isInteger(index) || !TRAILS[index] || index === selectedIndex) return;
    selectedIndex = index;
    chips.querySelectorAll(".dchip").forEach((item, itemIndex) => {
      item.classList.toggle("on", itemIndex === selectedIndex);
    });
    void load();
  };

  const retryLoad = (event) => {
    const button = event.target.closest("[data-retry]");
    if (button && body.contains(button)) void load();
  };

  chips.addEventListener("click", selectTrail);
  body.addEventListener("click", retryLoad);
  window.addEventListener("resize", onViewportResize);
  void load();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestVersion += 1;
      abortActive();
      timers.forEach(clearTimeout);
      timers.clear();
      cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      resizeObserver = null;
      chips.removeEventListener("click", selectTrail);
      body.removeEventListener("click", retryLoad);
      window.removeEventListener("resize", onViewportResize);
      if (map) map.remove();
      map = null;
      routeLayer = null;
      mapElement.remove();
      geometryCache.clear();
    },
  };
}
