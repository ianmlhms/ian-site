import { TRAILS } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";

const FETCH_TIMEOUT_MS = 9000;
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 180;
const VIEWBOX_PADDING = 12;

export const meta = { badge: null };

function geometryLines(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) throw new TypeError("Invalid trail geometry");
  const rawLines = geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.type === "MultiLineString"
      ? geometry.coordinates
      : null;
  if (!rawLines) throw new TypeError("Unsupported trail geometry");

  const lines = rawLines
    .map((line) => line
      .filter((position) => Array.isArray(position)
        && Number.isFinite(Number(position[0]))
        && Number.isFinite(Number(position[1])))
      .map((position) => [Number(position[0]), Number(position[1])]))
    .filter((line) => line.length >= 2);
  if (lines.length === 0) throw new TypeError("Empty trail geometry");
  return lines;
}

function projectLines(lines) {
  const points = lines.flat();
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const meanLatitude = (minLatitude + maxLatitude) / 2;
  const longitudeScale = Math.cos(meanLatitude * Math.PI / 180);
  const geographicWidth = Math.max((maxLongitude - minLongitude) * longitudeScale, Number.EPSILON);
  const geographicHeight = Math.max(maxLatitude - minLatitude, Number.EPSILON);
  const availableWidth = VIEWBOX_WIDTH - (2 * VIEWBOX_PADDING);
  const availableHeight = VIEWBOX_HEIGHT - (2 * VIEWBOX_PADDING);
  const scale = Math.min(availableWidth / geographicWidth, availableHeight / geographicHeight);
  const drawnWidth = geographicWidth * scale;
  const drawnHeight = geographicHeight * scale;
  const offsetX = (VIEWBOX_WIDTH - drawnWidth) / 2;
  const offsetY = (VIEWBOX_HEIGHT - drawnHeight) / 2;

  return lines.map((line) => line.map(([longitude, latitude]) => ({
    x: offsetX + ((longitude - minLongitude) * longitudeScale * scale),
    y: offsetY + ((maxLatitude - latitude) * scale),
  })));
}

function trailMap(lines, category) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "dtrail-map");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`);
  svg.setAttribute("aria-hidden", "true");

  projectLines(lines).forEach((line) => {
    const path = document.createElementNS(SVG_NS, "path");
    if (category === "mtb") path.setAttribute("class", "mtb");
    path.setAttribute("d", line
      .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" "));
    svg.append(path);
  });

  return svg;
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

function failureState() {
  const failure = document.createElement("p");
  failure.className = "dfail";
  failure.append(document.createTextNode(UI.failed));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dbtn";
  button.dataset.retry = "true";
  button.textContent = UI.retry;
  failure.append(button);
  return failure;
}

export function mount(host, opts = {}) {
  void opts;
  let destroyed = false;
  let selectedIndex = 0;
  let requestVersion = 0;
  let activeController = null;
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
  const loading = document.createElement("p");
  loading.className = "dmuted";
  loading.textContent = UI.loading;
  body.replaceChildren(loading);
  root.append(chips, body);
  host.replaceChildren(root);

  const render = (trail, lines) => {
    const content = document.createElement("div");
    content.className = "dlist";
    const link = document.createElement("a");
    link.className = "dbtn";
    link.href = `/${trail.cat === "mtb" ? "mtb" : "trails"}/de/${encodeURIComponent(trail.slug)}.html`;
    link.textContent = UI.openApp;
    content.append(trailMap(lines, trail.cat), trailDetails(trail), link);
    body.replaceChildren(content);
  };

  const abortActive = () => {
    activeController?.abort();
    activeController = null;
  };

  const load = async () => {
    abortActive();
    const version = ++requestVersion;
    const trail = TRAILS[selectedIndex];
    const cached = geometryCache.get(trail.slug);
    if (cached) {
      render(trail, cached);
      return;
    }

    const pending = document.createElement("p");
    pending.className = "dmuted";
    pending.textContent = UI.loading;
    body.replaceChildren(pending);
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timers.add(timeout);

    try {
      const response = await fetch(`/${trail.cat}/geo/${encodeURIComponent(trail.slug)}.geojson`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const lines = geometryLines(payload?.geometry);
      if (destroyed || version !== requestVersion) return;
      geometryCache.set(trail.slug, lines);
      render(trail, lines);
    } catch (error) {
      if (destroyed || version !== requestVersion) return;
      body.replaceChildren(failureState());
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
    if (!Number.isInteger(index) || !TRAILS[index]) return;
    selectedIndex = index;
    chips.querySelectorAll(".dchip").forEach((item, itemIndex) => {
      item.classList.toggle("on", itemIndex === selectedIndex);
    });
    load();
  };

  const retryLoad = (event) => {
    const button = event.target.closest("[data-retry]");
    if (button && body.contains(button)) load();
  };

  chips.addEventListener("click", selectTrail);
  body.addEventListener("click", retryLoad);
  load();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestVersion += 1;
      abortActive();
      timers.forEach(clearTimeout);
      timers.clear();
      geometryCache.clear();
      chips.removeEventListener("click", selectTrail);
      body.removeEventListener("click", retryLoad);
    },
  };
}
