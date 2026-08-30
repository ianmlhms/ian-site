import {
  ITINERARIES,
  MAX_ITINERARIES,
  PLAN_ENDPOINT,
  SCHOOL_HOUR,
  SCHOOL_TERM_START,
  STOPS,
} from "./content.js?v=1";
import { UI } from "./copy.js?v=1";
import { failedState, loadingState } from "./states.js?v=1";
import { attachExpandable, makeExpandableRow } from "./expand.js?v=1";
import { mountLineSearch } from "./lines.js?v=1";

const FETCH_TIMEOUT_MS = 9000;
const LUXEMBOURG_TIME_ZONE = "Europe/Luxembourg";
const MINUTES_PER_HOUR = 60;
const WEEKDAY_START = 1;
const WEEKDAY_END = 5;

const localPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LUXEMBOURG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const clockFormatter = new Intl.DateTimeFormat("lb-LU", {
  timeZone: LUXEMBOURG_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const meta = { badge: "live" };

function getLocalParts(date) {
  return Object.fromEntries(
    localPartsFormatter.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

function zonedDateTimeToIso({ year, month, day, hour, minute = 0, second = 0 }) {
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wantedAsUtc;

  // A fixed +01/+02 offset is wrong across Luxembourg's DST boundary, so derive
  // the offset by formatting the candidate instant in the target time zone.
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = getLocalParts(new Date(instant));
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant += wantedAsUtc - actualAsUtc;
  }

  return new Date(instant).toISOString();
}

// Self-check: 2026-07-01 07:00 → 2026-07-01T05:00:00.000Z; 2026-01-01 07:00 → 2026-01-01T06:00:00.000Z.
function nextSchoolTime(now = new Date()) {
  const local = getLocalParts(now);
  const today = Date.UTC(local.year, local.month - 1, local.day);
  // Never plan the school run for a day the school buses do not run — see the
  // note on SCHOOL_TERM_START. Date.parse of a plain YYYY-MM-DD is UTC midnight,
  // which is the same basis `today` uses, so the two are comparable.
  const termStart = Date.parse(SCHOOL_TERM_START);
  const date = new Date(Number.isFinite(termStart) ? Math.max(today, termStart) : today);
  const weekday = date.getUTCDay();
  const minutesNow = (local.hour * MINUTES_PER_HOUR) + local.minute;
  const isSchoolDay = weekday >= WEEKDAY_START && weekday <= WEEKDAY_END;
  // Only "is it already past 07:00" logic applies to today; a floored future
  // date has no time-of-day to be past yet.
  const isToday = date.getTime() === today;

  if (!isSchoolDay || (isToday && minutesNow >= SCHOOL_HOUR * MINUTES_PER_HOUR)) {
    do {
      date.setUTCDate(date.getUTCDate() + 1);
    } while (date.getUTCDay() < WEEKDAY_START || date.getUTCDay() > WEEKDAY_END);
  }

  return zonedDateTimeToIso({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: SCHOOL_HOUR,
  });
}

function minutes(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value >= 0 ? Math.max(1, Math.round(value / 60)) : 0;
}

function legDuration(leg) {
  if (Number.isFinite(Number(leg.duration))) return Number(leg.duration);
  const start = Date.parse(leg.startTime ?? leg.from?.departure);
  const end = Date.parse(leg.endTime ?? leg.to?.arrival);
  return Number.isFinite(start) && Number.isFinite(end) ? (end - start) / 1000 : 0;
}

function appendLegChain(target, legs) {
  let walkingSeconds = 0;

  const appendWalk = () => {
    if (walkingSeconds <= 0) return;
    const walk = document.createElement("span");
    walk.className = "dwalk";
    walk.textContent = `🚶 ${minutes(walkingSeconds)} min`;
    target.append(walk);
    walkingSeconds = 0;
  };

  for (const leg of legs) {
    if (leg?.mode === "WALK") {
      walkingSeconds += legDuration(leg);
      continue;
    }

    appendWalk();
    const wrapper = document.createElement("span");
    wrapper.className = "dleg";
    const line = document.createElement("span");
    const railModes = new Set(["RAIL", "TRAM", "SUBWAY"]);
    line.className = railModes.has(leg?.mode) ? "dline rail" : "dline";
    line.textContent = leg?.routeShortName ?? "";
    wrapper.append(line);
    target.append(wrapper);
  }

  appendWalk();
}

function formattedTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : clockFormatter.format(date);
}

function stopTimeRow(stopName, time) {
  const row = document.createElement("div");
  row.className = "drow-sub";
  const clock = document.createElement("span");
  clock.className = "drow-small";
  clock.textContent = formattedTime(time);
  const stop = document.createElement("span");
  stop.className = "drow-title";
  stop.textContent = stopName ?? "";
  row.append(clock, document.createTextNode(" "), stop);
  return row;
}

function itineraryDetail(itinerary) {
  const detail = document.createElement("div");
  detail.className = "dlist";
  for (const leg of Array.isArray(itinerary.legs) ? itinerary.legs : []) {
    const entry = document.createElement("div");
    entry.className = "dleg dleg-block";

    if (leg?.mode === "WALK") {
      const walk = document.createElement("div");
      walk.className = "dwalk";
      walk.textContent = `🚶 ${minutes(legDuration(leg))} min`;
      entry.append(walk);
    } else {
      const line = document.createElement("span");
      line.className = ["RAIL", "TRAM", "SUBWAY"].includes(leg?.mode)
        ? "dline rail"
        : "dline";
      line.textContent = leg?.routeShortName ?? "";
      entry.append(line);
    }

    entry.append(
      stopTimeRow(leg?.from?.name, leg?.from?.departure),
      stopTimeRow(leg?.to?.name, leg?.to?.arrival),
    );
    detail.append(entry);
  }
  return detail;
}

function itineraryRow(itinerary) {
  const { row, detail } = makeExpandableRow();

  const main = document.createElement("div");
  main.className = "drow-main";
  const title = document.createElement("div");
  title.className = "drow-title";
  title.textContent = `${clockFormatter.format(new Date(itinerary.startTime))} → ${clockFormatter.format(new Date(itinerary.endTime))}`;
  const sub = document.createElement("div");
  sub.className = "drow-sub";
  appendLegChain(sub, Array.isArray(itinerary.legs) ? itinerary.legs : []);
  main.append(title, sub);

  const side = document.createElement("div");
  side.className = "drow-side";
  const total = document.createElement("div");
  total.className = "drow-big";
  total.textContent = `${minutes(itinerary.duration)} min`;
  const transferCount = Number(itinerary.transfers) || 0;
  const transfers = document.createElement("div");
  transfers.className = "drow-small";
  transfers.textContent = transferCount === 0
    ? UI.direct
    : `${transferCount}${UI.transfers}`;
  side.append(total, transfers);
  row.append(main, side, detail);
  return { row, build: () => itineraryDetail(itinerary) };
}

export function mount(host, opts = {}) {
  void opts;
  let destroyed = false;
  let selectedIndex = 0;
  let requestVersion = 0;
  let activeController = null;
  const timers = new Set();
  const detailBuilders = new WeakMap();

  const root = document.createElement("div");
  const chips = document.createElement("div");
  chips.className = "dchips";
  ITINERARIES.forEach((itinerary, index) => {
    const chip = document.createElement("button");
    chip.className = index === 0 ? "dchip on" : "dchip";
    chip.type = "button";
    chip.dataset.itineraryIndex = String(index);
    chip.textContent = `${itinerary.icon} ${itinerary.label}`;
    chips.append(chip);
  });

  const note = document.createElement("p");
  note.className = "dmuted";
  note.textContent = ITINERARIES[0].note;
  const tripHint = document.createElement("p");
  tripHint.className = "dmuted";
  tripHint.textContent = UI.tripDetail;
  const results = document.createElement("div");
  results.replaceChildren(loadingState());

  root.append(chips, tripHint, note, results);
  host.replaceChildren(root);

  // The line search is the card's second, independent tool — it owns its own
  // lazy 776 KB index, its own debounce and its own teardown.
  const lineSearch = mountLineSearch(root);
  const expandable = attachExpandable(results, detailBuilders);

  const abortActive = () => {
    activeController?.abort();
    activeController = null;
  };

  const plan = async () => {
    abortActive();
    const version = ++requestVersion;
    const itinerary = ITINERARIES[selectedIndex];
    const from = STOPS[itinerary.from];
    const to = STOPS[itinerary.to];
    const controller = new AbortController();
    activeController = controller;
    results.replaceChildren(loadingState());

    const url = new URL(PLAN_ENDPOINT);
    url.searchParams.set("fromPlace", `${from.lat},${from.lon}`);
    url.searchParams.set("toPlace", `${to.lat},${to.lon}`);
    url.searchParams.set("arriveBy", "false");
    if (itinerary.when === "school") url.searchParams.set("time", nextSchoolTime());

    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timers.add(timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.itineraries)) throw new TypeError("Invalid itinerary payload");
      if (destroyed || version !== requestVersion) return;

      const entries = payload.itineraries.slice(0, MAX_ITINERARIES).map(itineraryRow);
      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "dmuted";
        empty.textContent = UI.failed;
        results.replaceChildren(empty);
      } else {
        const list = document.createElement("div");
        list.className = "dlist";
        for (const entry of entries) {
          detailBuilders.set(entry.row, entry);
          list.append(entry.row);
        }
        results.replaceChildren(list);
      }
    } catch (error) {
      if (destroyed || version !== requestVersion) return;
      results.replaceChildren(failedState());
    } finally {
      clearTimeout(timeout);
      timers.delete(timeout);
      if (activeController === controller) activeController = null;
    }
  };

  const selectItinerary = (event) => {
    const chip = event.target.closest("[data-itinerary-index]");
    if (!chip || !chips.contains(chip)) return;
    const index = Number(chip.dataset.itineraryIndex);
    if (!Number.isInteger(index) || !ITINERARIES[index]) return;
    selectedIndex = index;
    chips.querySelectorAll(".dchip").forEach((item, itemIndex) => {
      item.classList.toggle("on", itemIndex === selectedIndex);
    });
    note.textContent = ITINERARIES[selectedIndex].note;
    plan();
  };

  const retryPlan = (event) => {
    const button = event.target.closest('[data-retry="plan"]');
    if (button && results.contains(button)) plan();
  };

  chips.addEventListener("click", selectItinerary);
  results.addEventListener("click", retryPlan);
  plan();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestVersion += 1;
      abortActive();
      timers.forEach(clearTimeout);
      timers.clear();
      chips.removeEventListener("click", selectItinerary);
      results.removeEventListener("click", retryPlan);
      expandable.detach();
      lineSearch.destroy();
    },
  };
}
