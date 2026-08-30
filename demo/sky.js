import { SKY } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";

const FETCH_TIMEOUT_MS = 9000;
const CLIMB_THRESHOLD_FPM = 250;

export const meta = { badge: "live" };

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function skeleton() {
  const loading = document.createElement("div");
  loading.className = "dskel";
  for (let index = 0; index < 3; index += 1) {
    const row = document.createElement("div");
    row.className = "dskel-row";
    loading.append(row);
  }
  return loading;
}

function altitudeText(altitudeFt) {
  const altitude = Number(altitudeFt);
  if (!Number.isFinite(altitude)) return "—";
  return `${Math.round(altitude).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009")} ft`;
}

function verticalArrow(verticalRateFpm) {
  const rate = Number(verticalRateFpm);
  if (!Number.isFinite(rate) || Math.abs(rate) <= CLIMB_THRESHOLD_FPM) return "→";
  return rate > 0 ? "↑" : "↓";
}

function aircraftRow(aircraft) {
  const row = document.createElement("div");
  row.className = "drow";

  const main = document.createElement("div");
  main.className = "drow-main";
  const title = document.createElement("div");
  title.className = "drow-title";
  const identifier = cleanText(aircraft.flight)
    || cleanText(aircraft.registration)
    || cleanText(aircraft.hex)
    || "—";
  const icons = ["✈", aircraft.cargo && "📦", aircraft.military && "🎖", aircraft.special && "⭐"]
    .filter(Boolean)
    .join("");
  title.textContent = `${icons} ${identifier}`;

  const sub = document.createElement("div");
  sub.className = "drow-sub";
  sub.textContent = [cleanText(aircraft.type), cleanText(aircraft.registration)].filter(Boolean).join(" · ");
  main.append(title, sub);

  const side = document.createElement("div");
  side.className = "drow-side";
  const altitude = document.createElement("div");
  altitude.className = "drow-big";
  altitude.textContent = `${altitudeText(aircraft.altitudeFt)} ${verticalArrow(aircraft.verticalRateFpm)}`;
  const distance = document.createElement("div");
  distance.className = "drow-small";
  const distanceNm = Number(aircraft.distanceNm);
  distance.textContent = Number.isFinite(distanceNm) ? `${Math.round(distanceNm)} NM` : "—";
  side.append(altitude, distance);
  row.append(main, side);
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
  let activeController = null;
  let hasGoodList = false;
  const timers = new Set();

  const body = document.createElement("div");
  body.replaceChildren(skeleton());
  host.replaceChildren(body);

  const renderList = (aircraft) => {
    const visible = aircraft
      .filter((item) => item && item.onGround !== true)
      .slice()
      .sort((left, right) => {
        const leftDistance = Number(left.distanceNm);
        const rightDistance = Number(right.distanceNm);
        return (Number.isFinite(leftDistance) ? leftDistance : Infinity)
          - (Number.isFinite(rightDistance) ? rightDistance : Infinity);
      })
      .slice(0, SKY.maxRows);

    const list = document.createElement("div");
    list.className = "dlist";
    list.append(...visible.map(aircraftRow));
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dmuted";
      empty.textContent = UI.skyEmpty;
      body.replaceChildren(list, empty);
    } else {
      body.replaceChildren(list);
    }
  };

  const markStale = () => {
    body.querySelector("[data-stale]")?.remove();
    const stale = document.createElement("p");
    stale.className = "dmuted";
    stale.dataset.stale = "true";
    stale.textContent = UI.failed;
    body.append(stale);
  };

  const load = async () => {
    if (destroyed || activeController) return;
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
      renderList(payload.aircraft);
      hasGoodList = true;
    } catch (error) {
      if (destroyed) return;
      if (hasGoodList) {
        markStale();
      } else {
        body.replaceChildren(failureState());
      }
    } finally {
      clearTimeout(timeout);
      timers.delete(timeout);
      if (activeController === controller) activeController = null;
    }
  };

  const retryLoad = (event) => {
    const button = event.target.closest("[data-retry]");
    if (button && body.contains(button)) load();
  };

  body.addEventListener("click", retryLoad);
  load();
  const refreshTimer = setInterval(load, SKY.refreshMs);
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
      body.removeEventListener("click", retryLoad);
    },
  };
}
