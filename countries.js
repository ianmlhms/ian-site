"use strict";

const COUNTRIES_URL = "data/countries.json?v=1";
const METRICS_URL = "data/country-metrics.json?v=1";
const DEFAULT_COUNTRY_CODES = Object.freeze(["LU", "DE", "FR", "BE"]);
const DEFAULT_METRIC_KEYS = new Set(["population", "area_km2", "density", "gdp_usd"]);
const GDP_BILLION = 1e9;
const GDP_TRILLION = 1e12;
const INPUT_FLASH_MS = 2000;
const MINIMUM_BAR_PERCENT = 0.5;

// Chart data colors deliberately stay independent from the site's chrome accent.
const BAR_COLORS = Object.freeze([
  "#3b5bdb", "#f03e3e", "#2f9e44", "#f59f00", "#ae3ec9",
  "#1098ad", "#e67700", "#d6336c", "#0c8599", "#5c7cfa",
]);

let state = {
  lang: window.I18N.lang,
  allCountries: [],
  metrics: [],
  selectedCodes: [],
  activeMetrics: new Set(),
  chartSortOrder: {},
};

let inputFlashTimer = 0;

function updateState(patch) {
  state = { ...state, ...patch };
}

function byId(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function tr(key) {
  return window.I18N.t(key);
}

function trWith(key, replacements) {
  return Object.entries(replacements).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    tr(key),
  );
}

function dataLanguage() {
  return state.lang === "en" ? "en" : "de";
}

function numberLocale() {
  return state.lang === "en" ? "en-US" : "de-DE";
}

function flagEmoji(code) {
  if (!code || code.length !== 2) return "🏳️";
  return Array.from(code.toUpperCase(), (character) =>
    String.fromCodePoint(0x1F1E6 + character.charCodeAt(0) - 65)).join("");
}

function countryName(country) {
  return country[`name_${dataLanguage()}`] || country.name_en || country.code || "";
}

function metricLabel(metric) {
  return tr(`countries.metric.${metric.key}`);
}

function metricUnit(metric) {
  if (metric.type !== "number") return "";
  return tr(`countries.unit.${metric.key}`);
}

function metricValue(country, metric) {
  const language = dataLanguage();
  switch (metric.key) {
    case "name": return country[`name_${language}`] || null;
    case "continent": return country[`continent_${language}`] || null;
    case "capital": return country[`capital_${language}`] || null;
    case "languages": return country[`languages_${language}`] || null;
    case "calling_code": return country.calling_code || null;
    case "currency": {
      const name = country[`currency_${language}`] || "";
      return country.currency_code ? `${name} (${country.currency_code})` : name;
    }
    case "density": {
      if (!country.population || !country.area_km2) return null;
      return Math.round((country.population / country.area_km2) * 10) / 10;
    }
    default: return country[metric.key] ?? null;
  }
}

function formatNumber(value, metricKey) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (metricKey === "gdp_usd" && Math.abs(number) >= GDP_BILLION) {
    return formatLargeGdp(number);
  }
  if (metricKey === "density") {
    return new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 1 }).format(number);
  }
  if (metricKey === "forest_percent") {
    return new Intl.NumberFormat(numberLocale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(number);
  }
  return new Intl.NumberFormat(numberLocale()).format(number);
}

function formatLargeGdp(value) {
  const isTrillion = Math.abs(value) >= GDP_TRILLION;
  const divisor = isTrillion ? GDP_TRILLION : GDP_BILLION;
  const digits = isTrillion ? 2 : 1;
  const suffix = tr(isTrillion
    ? "countries.number.trillionShort"
    : "countries.number.billionShort");
  const formatted = (value / divisor).toLocaleString(numberLocale(), {
    maximumFractionDigits: digits,
  });
  return `${formatted} ${suffix}`;
}

function selectedCountries() {
  return state.selectedCodes
    .map((code) => state.allCountries.find((country) => country.code === code))
    .filter(Boolean);
}

function sortCountries(countries) {
  return countries.toSorted((left, right) =>
    countryName(left).localeCompare(countryName(right), numberLocale()));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function loadData() {
  setLoading(true);
  hideError();
  try {
    const [countriesData, metricsData] = await Promise.all([
      fetchJson(COUNTRIES_URL),
      fetchJson(METRICS_URL),
    ]);
    if (!Array.isArray(countriesData?.countries) || !Array.isArray(metricsData)) {
      throw new TypeError("Country or metric data has an unexpected shape");
    }
    const allCountries = sortCountries(countriesData.countries);
    updateState({
      allCountries,
      metrics: metricsData,
      selectedCodes: readSelection(allCountries),
      activeMetrics: new Set(DEFAULT_METRIC_KEYS),
    });
    setLoading(false);
    buildCountrySearch();
    buildMetricToggles();
    render();
  } catch (error) {
    showLoadFailure();
    console.error("[countries] Could not load data", error);
  }
}

function setLoading(loading) {
  byId("loading").classList.toggle("hidden", !loading);
  byId("app-content").classList.toggle("hidden", loading);
}

function hideError() {
  byId("error-banner").classList.add("hidden");
}

function showLoadFailure() {
  byId("loading").classList.add("hidden");
  byId("app-content").classList.add("hidden");
  byId("error-banner").classList.remove("hidden");
}

function readSelection(countries) {
  const params = new URL(location.href).searchParams;
  const validCodes = new Set(countries.map((country) => country.code));
  const source = params.has("c")
    ? params.get("c").split(",")
    : DEFAULT_COUNTRY_CODES;
  return [...new Set(source
    .map((code) => code.trim().toUpperCase())
    .filter((code) => validCodes.has(code)))];
}

function syncSelectionUrl() {
  try {
    const url = new URL(location.href);
    // An empty selection drops the parameter rather than leaving a bare "?c=",
    // so a cleared page reloads into the default selection instead of nothing.
    if (state.selectedCodes.length) url.searchParams.set("c", state.selectedCodes.join(","));
    else url.searchParams.delete("c");
    const query = url.searchParams.toString().replaceAll("%2C", ",");
    history.replaceState(null, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
  } catch (error) {
    console.warn("[countries] Could not update comparison URL", error);
  }
}

function buildCountrySearch() {
  const datalist = byId("country-options");
  const fragment = document.createDocumentFragment();
  state.allCountries.forEach((country) => {
    const option = document.createElement("option");
    // Value only, never `label`: datalist rendering is UA-defined, and Firefox
    // shows the label INSTEAD of the value — a dropdown of bare ISO codes.
    option.value = countryName(country);
    fragment.appendChild(option);
  });
  datalist.replaceChildren(fragment);
}

function initCountrySearch() {
  const input = byId("country-input");
  byId("add-country-btn").addEventListener("click", addCountryFromInput);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCountryFromInput();
  });
}

function addCountryFromInput() {
  const input = byId("country-input");
  const query = input.value.trim();
  if (!query) return;
  const country = state.allCountries.find((candidate) =>
    countryName(candidate).toLocaleLowerCase(numberLocale()) === query.toLocaleLowerCase(numberLocale())
    || candidate.code.toUpperCase() === query.toUpperCase());
  if (!country) return flashInput(tr("countries.notFound"));
  if (state.selectedCodes.includes(country.code)) {
    return flashInput(tr("countries.alreadyAdded"));
  }
  updateState({ selectedCodes: [...state.selectedCodes, country.code] });
  input.value = "";
  render();
}

function flashInput(message) {
  const input = byId("country-input");
  clearTimeout(inputFlashTimer);
  input.value = "";
  input.placeholder = message;
  input.classList.add("input-error");
  input.setAttribute("aria-invalid", "true");
  inputFlashTimer = setTimeout(() => {
    input.placeholder = tr("countries.searchPlaceholder");
    input.classList.remove("input-error");
    input.removeAttribute("aria-invalid");
  }, INPUT_FLASH_MS);
}

function renderChips() {
  const fragment = document.createDocumentFragment();
  selectedCountries().forEach((country) => {
    const name = countryName(country);
    const removeLabel = trWith("countries.removeCountry", { name });
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.setAttribute("role", "listitem");
    chip.innerHTML = `<span class="chip-flag">${esc(flagEmoji(country.code))}</span>`
      + `<span class="chip-name">${esc(name)}</span>`
      + `<button class="chip-remove" type="button" title="${esc(removeLabel)}"`
      + ` aria-label="${esc(removeLabel)}">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      updateState({ selectedCodes: state.selectedCodes.filter((code) => code !== country.code) });
      render();
    });
    fragment.appendChild(chip);
  });
  byId("country-chips").replaceChildren(fragment);
}

function getContinents() {
  const continents = new Map();
  state.allCountries.forEach((country) => {
    const key = country.continent_en || country.continent_de || "?";
    const previous = continents.get(key) || {
      key,
      de: country.continent_de,
      en: country.continent_en,
      codes: [],
    };
    continents.set(key, { ...previous, codes: [...previous.codes, country.code] });
  });
  return [...continents.values()].toSorted((left, right) =>
    continentName(left).localeCompare(continentName(right), numberLocale()));
}

function continentName(continent) {
  return continent[dataLanguage()] || continent.en || continent.key;
}

function addCountries(codes) {
  const selected = new Set(state.selectedCodes);
  const additions = codes.filter((code) => !selected.has(code));
  if (!additions.length) return;
  updateState({ selectedCodes: [...state.selectedCodes, ...additions] });
  render();
}

function removeCountries(codes) {
  const removals = new Set(codes);
  updateState({ selectedCodes: state.selectedCodes.filter((code) => !removals.has(code)) });
  render();
}

function buildContinentButtons() {
  const fragment = document.createDocumentFragment();
  getContinents().forEach((continent) => {
    const name = continentName(continent);
    const isSelected = continent.codes.every((code) => state.selectedCodes.includes(code));
    const button = document.createElement("button");
    button.type = "button";
    button.className = `continent-btn${isSelected ? " active" : ""}`;
    button.textContent = name;
    button.title = trWith(isSelected
      ? "countries.removeContinent"
      : "countries.addContinent", { name });
    button.setAttribute("aria-pressed", String(isSelected));
    button.addEventListener("click", () => {
      if (isSelected) removeCountries(continent.codes);
      else addCountries(continent.codes);
    });
    fragment.appendChild(button);
  });
  byId("continent-buttons").replaceChildren(fragment);
}

function initBulkControls() {
  byId("select-all-btn").addEventListener("click", () =>
    addCountries(state.allCountries.map((country) => country.code)));
  byId("clear-selection-btn").addEventListener("click", () => {
    if (!state.selectedCodes.length) return;
    updateState({ selectedCodes: [] });
    render();
  });
}

function buildMetricToggles() {
  const fragment = document.createDocumentFragment();
  state.metrics.forEach((metric) => fragment.appendChild(buildMetricToggle(metric)));
  byId("metrics-toggles").replaceChildren(fragment);
}

function buildMetricToggle(metric) {
  const label = document.createElement("label");
  label.className = "metric-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = metric.key;
  checkbox.checked = state.activeMetrics.has(metric.key);
  checkbox.addEventListener("change", () => toggleMetric(metric.key, checkbox.checked));
  const pill = document.createElement("span");
  pill.className = "metric-pill";
  pill.textContent = metricLabel(metric);
  if (metric.computed) pill.appendChild(buildComputedBadge());
  label.append(checkbox, pill);
  return label;
}

function buildComputedBadge() {
  const badge = document.createElement("span");
  badge.className = "computed-badge";
  badge.title = tr("countries.computed");
  badge.textContent = "∑";
  return badge;
}

function toggleMetric(key, checked) {
  const activeMetrics = new Set(state.activeMetrics);
  if (checked) activeMetrics.add(key);
  else activeMetrics.delete(key);
  updateState({ activeMetrics });
  renderTable();
  renderCharts();
}

function render() {
  syncSelectionUrl();
  buildContinentButtons();
  renderChips();
  renderTable();
  renderCharts();
}

function activeMetricList() {
  return state.metrics.filter((metric) => state.activeMetrics.has(metric.key));
}

function setPlaceholder(container, icon, message) {
  container.innerHTML = `<div class="placeholder"><div class="ph-icon">${esc(icon)}</div>`
    + `<p>${esc(message)}</p></div>`;
}

function renderTable() {
  const container = byId("table-container");
  const countries = selectedCountries();
  const metrics = activeMetricList();
  if (!countries.length) return setPlaceholder(container, "🌍", tr("countries.noCountries"));
  if (!metrics.length) return setPlaceholder(container, "🌍", tr("countries.noMetrics"));
  const table = document.createElement("table");
  table.id = "comparison-table";
  table.append(buildTableHead(countries), buildTableBody(countries, metrics));
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  wrapper.appendChild(table);
  container.replaceChildren(wrapper);
}

function buildTableHead(countries) {
  const head = document.createElement("thead");
  const row = document.createElement("tr");
  const metricHeading = document.createElement("th");
  metricHeading.textContent = tr("countries.metricsHeading");
  row.appendChild(metricHeading);
  countries.forEach((country) => {
    const heading = document.createElement("th");
    heading.innerHTML = `<span class="table-flag"><span class="flag">${esc(flagEmoji(country.code))}</span>`
      + `<span>${esc(countryName(country))}</span></span>`;
    row.appendChild(heading);
  });
  head.appendChild(row);
  return head;
}

function buildTableBody(countries, metrics) {
  const body = document.createElement("tbody");
  metrics.forEach((metric) => {
    const row = document.createElement("tr");
    const label = document.createElement("td");
    label.className = "metric-cell";
    const unit = metricUnit(metric);
    label.textContent = metricLabel(metric) + (unit ? ` (${unit})` : "");
    row.appendChild(label);
    countries.forEach((country) => row.appendChild(buildValueCell(country, metric)));
    body.appendChild(row);
  });
  return body;
}

function buildValueCell(country, metric) {
  const cell = document.createElement("td");
  const raw = metricValue(country, metric);
  if (raw === null || raw === undefined || raw === "") {
    cell.innerHTML = `<span class="null-value">${esc(tr("countries.noData"))}</span>`;
    return cell;
  }
  if (metric.type !== "number") {
    cell.textContent = raw;
    return cell;
  }
  const formatted = formatNumber(raw, metric.key);
  cell.textContent = formatted ?? tr("countries.noData");
  return cell;
}

function renderCharts() {
  const container = byId("charts-container");
  const countries = selectedCountries();
  const metrics = activeMetricList().filter((metric) => metric.type === "number");
  if (!countries.length) return setPlaceholder(container, "📊", tr("countries.noCountries"));
  if (!metrics.length) return setPlaceholder(container, "📊", tr("countries.noCharts"));
  const grid = document.createElement("div");
  grid.className = "charts-grid";
  metrics.forEach((metric) => grid.appendChild(buildChartCard(metric, countries)));
  container.replaceChildren(grid);
}

function buildChartCard(metric, countries) {
  const card = document.createElement("div");
  const sortOrder = state.chartSortOrder[metric.key] || "desc";
  const rows = chartRows(metric, countries, sortOrder);
  const values = rows.filter((row) => row.value !== null).map((row) => row.value);
  const maximum = values.length ? Math.max(...values) : 1;
  card.className = "chart-card";
  card.append(buildChartHeader(metric, sortOrder));
  const body = document.createElement("div");
  body.className = "chart-body";
  rows.forEach((row) => body.appendChild(buildBarRow(row, metric, maximum)));
  card.appendChild(body);
  return card;
}

function chartRows(metric, countries, sortOrder) {
  return countries.map((country, index) => ({
    code: country.code,
    name: countryName(country),
    flag: flagEmoji(country.code),
    value: metricValue(country, metric),
    color: BAR_COLORS[index % BAR_COLORS.length],
  })).toSorted((left, right) => compareChartRows(left, right, sortOrder));
}

function compareChartRows(left, right, sortOrder) {
  if (left.value === null && right.value === null) return 0;
  if (left.value === null) return 1;
  if (right.value === null) return -1;
  return sortOrder === "desc" ? right.value - left.value : left.value - right.value;
}

function buildChartHeader(metric, sortOrder) {
  const header = document.createElement("div");
  header.className = "chart-header";
  const heading = document.createElement("div");
  heading.className = "chart-heading";
  const title = document.createElement("span");
  title.className = "chart-title";
  title.textContent = metricLabel(metric);
  heading.appendChild(title);
  const unit = metricUnit(metric);
  if (unit) heading.appendChild(buildUnitBadge(unit));
  header.append(heading, buildSortControls(metric.key, sortOrder));
  return header;
}

function buildUnitBadge(unit) {
  const badge = document.createElement("span");
  badge.className = "chart-unit";
  badge.textContent = unit;
  return badge;
}

function buildSortControls(metricKey, sortOrder) {
  const controls = document.createElement("div");
  controls.className = "sort-controls";
  ["desc", "asc"].forEach((direction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sort-btn${sortOrder === direction ? " active" : ""}`;
    button.textContent = tr(direction === "desc" ? "countries.sortDesc" : "countries.sortAsc");
    button.title = tr(direction === "desc" ? "countries.sortDescTitle" : "countries.sortAscTitle");
    button.addEventListener("click", () => setChartSort(metricKey, direction));
    controls.appendChild(button);
  });
  return controls;
}

function setChartSort(metricKey, direction) {
  updateState({ chartSortOrder: { ...state.chartSortOrder, [metricKey]: direction } });
  renderCharts();
}

function buildBarRow(row, metric, maximum) {
  const barRow = document.createElement("div");
  barRow.className = "bar-row";
  const label = document.createElement("div");
  label.className = "bar-label";
  label.title = row.name;
  label.innerHTML = `<span class="flag">${esc(row.flag)}</span><span>${esc(row.name)}</span>`;
  barRow.appendChild(label);
  if (row.value === null) {
    const empty = document.createElement("span");
    empty.className = "bar-null";
    empty.textContent = tr("countries.noData");
    barRow.appendChild(empty);
    return barRow;
  }
  const formatted = formatNumber(row.value, metric.key);
  barRow.append(buildBarTrack(row, maximum, formatted), buildBarValue(formatted));
  return barRow;
}

function buildBarTrack(row, maximum, formatted) {
  const track = document.createElement("div");
  track.className = "bar-track";
  track.title = formatted || "";
  const fill = document.createElement("div");
  const percent = maximum > 0 ? (row.value / maximum) * 100 : 0;
  fill.className = "bar-fill";
  fill.style.background = row.color;
  fill.style.width = "0%";
  requestAnimationFrame(() => {
    fill.style.width = `${Math.max(percent, MINIMUM_BAR_PERCENT)}%`;
  });
  track.appendChild(fill);
  return track;
}

function buildBarValue(formatted) {
  const value = document.createElement("div");
  value.className = "bar-value";
  value.textContent = formatted || tr("countries.noData");
  return value;
}

function handleLanguageChange(lang) {
  updateState({ lang });
  if (!state.allCountries.length) return;
  updateState({ allCountries: sortCountries(state.allCountries) });
  buildCountrySearch();
  buildMetricToggles();
  render();
}

function boot() {
  initCountrySearch();
  initBulkControls();
  window.I18N.onChange(handleLanguageChange);
  loadData();
}

boot();
