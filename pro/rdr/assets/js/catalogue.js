// Wrapped in an IIFE: this file and catalogue-data.js are both classic
// scripts sharing global scope, so top-level `const` here would collide
// with the function declarations of the same name in catalogue-data.js.
(() => {
  const { flattenCatalogue, loadCatalogue, normalizeSearchText, renderProductTable, showDataError, syncProductSchema } = window.RdrCatalogue;

  const UNKNOWN_VALUE = "__unknown";
  const MAX_QUERY_LENGTH = 120;
  const FILTER_KEYS = Object.freeze({
    q: "q",
    category: "categorie",
    country: "pays",
    producer: "producteur",
    colour: "couleur",
    format: "format",
    priceMin: "prixMin",
    priceMax: "prixMax",
    inStock: "stock",
  });

  function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right), "fr", { sensitivity: "base" }));
  }

  function cleanText(value) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  }

  function readPrice(params, key) {
    const raw = params.get(key);
    if (raw === null || raw === "") return "";
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 100000 ? String(value) : "";
  }

  function readAllowed(params, key, allowedValues) {
    const value = cleanText(params.get(key));
    return allowedValues.has(value) ? value : "";
  }

  function optionLabel(group, value) {
    if (group === "category") return window.I18N.t(`category.${value}`);
    if (group === "colour") return window.I18N.t(`colour.${value}`);
    if (group === "country" && value === UNKNOWN_VALUE) return window.I18N.t("catalogue.unknownCountry");
    return value;
  }

  function fillSelect(select, values, group) {
    const currentValue = select.value;
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = window.I18N.t("catalogue.all");
    const options = values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel(group, value);
      return option;
    });
    select.replaceChildren(allOption, ...options);
    if (values.includes(currentValue)) select.value = currentValue;
  }

  function createSearchableProducts(products) {
    return Object.freeze(products.map((product) => Object.freeze({
      ...product,
      searchText: normalizeSearchText([
        product.name,
        product.producerName,
        product.country,
        product.region,
      ].filter(Boolean).join(" ")),
    })));
  }

  function stateFromUrl(products) {
    const params = new URLSearchParams(window.location.search);
    const allowed = {
      category: new Set(products.map((product) => product.category)),
      country: new Set(products.map((product) => product.country || UNKNOWN_VALUE)),
      producer: new Set(products.map((product) => product.producerId)),
      colour: new Set(products.map((product) => product.colour || UNKNOWN_VALUE)),
      format: new Set(products.map((product) => product.format || UNKNOWN_VALUE)),
    };
    return Object.freeze({
      q: cleanText(params.get(FILTER_KEYS.q)),
      category: readAllowed(params, FILTER_KEYS.category, allowed.category),
      country: readAllowed(params, FILTER_KEYS.country, allowed.country),
      producer: readAllowed(params, FILTER_KEYS.producer, allowed.producer),
      colour: readAllowed(params, FILTER_KEYS.colour, allowed.colour),
      format: readAllowed(params, FILTER_KEYS.format, allowed.format),
      priceMin: readPrice(params, FILTER_KEYS.priceMin),
      priceMax: readPrice(params, FILTER_KEYS.priceMax),
      inStock: params.get(FILTER_KEYS.inStock) === "1",
    });
  }

  function stateFromForm(form) {
    const formData = new FormData(form);
    return Object.freeze({
      q: cleanText(formData.get("q")),
      category: cleanText(formData.get("category")),
      country: cleanText(formData.get("country")),
      producer: cleanText(formData.get("producer")),
      colour: cleanText(formData.get("colour")),
      format: cleanText(formData.get("format")),
      priceMin: cleanText(formData.get("priceMin")),
      priceMax: cleanText(formData.get("priceMax")),
      inStock: formData.get("inStock") === "on",
    });
  }

  function applyState(form, state) {
    Object.entries(state).forEach(([key, value]) => {
      const control = form.elements.namedItem(key);
      if (!control) return;
      if (control.type === "checkbox") control.checked = Boolean(value);
      else control.value = value;
    });
  }

  function matchesNullable(actual, expected) {
    if (!expected) return true;
    if (expected === UNKNOWN_VALUE) return !actual;
    return actual === expected;
  }

  function filterProducts(products, state) {
    const query = normalizeSearchText(state.q);
    const min = state.priceMin === "" ? null : Number(state.priceMin);
    const max = state.priceMax === "" ? null : Number(state.priceMax);
    return products.filter((product) => {
      if (query && !product.searchText.includes(query)) return false;
      if (state.category && product.category !== state.category) return false;
      if (!matchesNullable(product.country, state.country)) return false;
      if (state.producer && product.producerId !== state.producer) return false;
      if (!matchesNullable(product.colour, state.colour)) return false;
      if (!matchesNullable(product.format, state.format)) return false;
      if (min !== null && (product.priceEur === null || product.priceEur < min)) return false;
      if (max !== null && (product.priceEur === null || product.priceEur > max)) return false;
      if (state.inStock && product.outOfStock) return false;
      return true;
    });
  }

  function reflectState(state) {
    const url = new URL(window.location.href);
    Object.values(FILTER_KEYS).forEach((key) => url.searchParams.delete(key));
    if (state.q) url.searchParams.set(FILTER_KEYS.q, state.q);
    if (state.category) url.searchParams.set(FILTER_KEYS.category, state.category);
    if (state.country) url.searchParams.set(FILTER_KEYS.country, state.country);
    if (state.producer) url.searchParams.set(FILTER_KEYS.producer, state.producer);
    if (state.colour) url.searchParams.set(FILTER_KEYS.colour, state.colour);
    if (state.format) url.searchParams.set(FILTER_KEYS.format, state.format);
    if (state.priceMin) url.searchParams.set(FILTER_KEYS.priceMin, state.priceMin);
    if (state.priceMax) url.searchParams.set(FILTER_KEYS.priceMax, state.priceMax);
    if (state.inStock) url.searchParams.set(FILTER_KEYS.inStock, "1");
    history.replaceState({}, "", url);
  }

  function updateCount(element, count) {
    element.textContent = window.I18N.t("catalogue.results").replace("{count}", new Intl.NumberFormat(window.I18N.lang).format(count));
  }

  function populateFilters(form, products) {
    fillSelect(form.elements.category, uniqueSorted(products.map((product) => product.category)), "category");
    fillSelect(form.elements.country, uniqueSorted(products.map((product) => product.country || UNKNOWN_VALUE)), "country");
    const producerNames = new Map(products.map((product) => [product.producerId, product.producerName]));
    const producerIds = [...producerNames.keys()].sort((left, right) => producerNames.get(left).localeCompare(producerNames.get(right), "fr", { sensitivity: "base" }));
    fillSelect(form.elements.producer, producerIds, "producer");
    [...form.elements.producer.options].forEach((option) => {
      if (producerNames.has(option.value)) option.textContent = producerNames.get(option.value);
    });
    fillSelect(form.elements.colour, uniqueSorted(products.map((product) => product.colour || UNKNOWN_VALUE)), "colour");
    fillSelect(form.elements.format, uniqueSorted(products.map((product) => product.format || UNKNOWN_VALUE)), "format");
  }

  async function boot() {
    const form = document.querySelector("[data-catalogue-filters]");
    const tableHost = document.querySelector("[data-product-table]");
    const countHost = document.querySelector("[data-result-count]");
    const loading = document.querySelector("[data-catalogue-loading]");
    if (!form || !tableHost || !countHost) return;

    try {
      const catalogue = await loadCatalogue();
      const products = createSearchableProducts(flattenCatalogue(catalogue));
      loading?.remove();
      populateFilters(form, products);
      applyState(form, stateFromUrl(products));

      let lastFiltered = products;
      let frameId = 0;
      let hasRendered = false;
      const render = (shouldReflect = true) => {
        const state = stateFromForm(form);
        lastFiltered = Object.freeze(filterProducts(products, state));
        renderProductTable(tableHost, lastFiltered, { shouldAnimate: hasRendered });
        updateCount(countHost, lastFiltered.length);
        if (shouldReflect) reflectState(state);
        hasRendered = true;
        const empty = document.querySelector("[data-empty-state]");
        if (empty) empty.hidden = lastFiltered.length !== 0;
      };
      const scheduleRender = () => {
        cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(() => render(true));
      };

      form.addEventListener("input", scheduleRender);
      form.addEventListener("change", scheduleRender);
      form.addEventListener("reset", () => requestAnimationFrame(() => render(true)));
      render(false);
      syncProductSchema(products);

      document.addEventListener("i18n:change", () => {
        populateFilters(form, products);
        applyState(form, stateFromUrl(products));
        render(false);
        syncProductSchema(products);
      });
    } catch (error) {
      loading?.remove();
      showDataError(tableHost, error);
      countHost.textContent = "";
    }
  }

  window.RdrCatalogueFilters = Object.freeze({ filterProducts });
  boot();

})();
