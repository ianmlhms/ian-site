const SCRIPT_URL = new URL(document.currentScript.src);
const CATALOGUE_URL = new URL("../../data/catalogue.json", SCRIPT_URL);
const ALLOWED_COLOURS = new Set([null, "blanc", "rose", "rouge"]);
let cataloguePromise;

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function assertNullableString(value, label) {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string or null.`);
  return value;
}

function validateProduct(product, producerId, productIndex) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw new TypeError(`Product ${productIndex} for ${producerId} is invalid.`);
  }
  const label = `Product ${productIndex} for ${producerId}`;
  const priceEur = product.priceEur;
  if (priceEur !== null && (typeof priceEur !== "number" || !Number.isFinite(priceEur) || priceEur < 0)) {
    throw new TypeError(`${label} has an invalid price.`);
  }
  if (!ALLOWED_COLOURS.has(product.colour)) throw new TypeError(`${label} has an invalid colour.`);
  ["priceOnRequest", "outOfStock", "needsReview"].forEach((key) => {
    if (typeof product[key] !== "boolean") throw new TypeError(`${label}.${key} must be boolean.`);
  });
  return Object.freeze({
    id: assertString(product.id, `${label}.id`),
    name: assertString(product.name, `${label}.name`),
    category: assertString(product.category, `${label}.category`),
    colour: product.colour,
    format: assertNullableString(product.format, `${label}.format`),
    priceEur,
    priceOnRequest: product.priceOnRequest,
    outOfStock: product.outOfStock,
    needsReview: product.needsReview,
  });
}

function validateProducer(producer, producerIndex) {
  if (!producer || typeof producer !== "object" || Array.isArray(producer)) {
    throw new TypeError(`Producer ${producerIndex} is invalid.`);
  }
  const label = `Producer ${producerIndex}`;
  if (!Array.isArray(producer.products)) throw new TypeError(`${label}.products must be an array.`);
  return Object.freeze({
    id: assertString(producer.id, `${label}.id`),
    name: assertString(producer.name, `${label}.name`),
    country: assertNullableString(producer.country, `${label}.country`),
    region: assertNullableString(producer.region, `${label}.region`),
    page: typeof producer.page === "number" ? producer.page : null,
    products: Object.freeze(producer.products.map((product, index) => validateProduct(product, producer.id, index))),
  });
}

function validateCatalogue(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Catalogue root is invalid.");
  if (!Array.isArray(payload.producers)) throw new TypeError("Catalogue producers must be an array.");
  if (!payload.reliability || typeof payload.reliability !== "object") throw new TypeError("Catalogue reliability block is missing.");
  if (payload.currency !== "EUR") throw new TypeError("Catalogue currency must be EUR.");
  return Object.freeze({
    source: assertString(payload.source, "source"),
    importedAt: assertString(payload.importedAt, "importedAt"),
    currency: payload.currency,
    priceNote: assertString(payload.priceNote, "priceNote"),
    reliability: Object.freeze({ ...payload.reliability }),
    ordering: Object.freeze({ ...payload.ordering }),
    producers: Object.freeze(payload.producers.map(validateProducer)),
  });
}

function loadCatalogueFromFrame() {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.onload = () => {
      try {
        const raw = frame.contentDocument?.body?.textContent || "";
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Local catalogue could not be read: ${error.message}`));
      } finally {
        frame.remove();
      }
    };
    frame.onerror = () => {
      frame.remove();
      reject(new Error("Local catalogue file could not be opened."));
    };
    frame.src = CATALOGUE_URL.href;
    document.body.appendChild(frame);
  });
}

/**
 * Shape a row of rdr_catalogue_view like the JSON file, so every page that
 * already consumes the catalogue keeps working unchanged.
 */
function catalogueFromRows(rows) {
  const producers = new Map();
  rows.forEach((row) => {
    if (!producers.has(row.producer_id)) {
      producers.set(row.producer_id, {
        id: row.producer_id,
        name: row.producer_name,
        country: row.country_name || null,
        region: row.region || null,
        products: [],
      });
    }
    const hasReduction = row.reduced_price_eur !== null && row.reduced_price_eur !== undefined;
    producers.get(row.producer_id).products.push({
      id: row.id,
      name: row.name,
      category: row.category,
      colour: row.colour,
      format: row.format,
      priceEur: hasReduction ? Number(row.reduced_price_eur) : (row.price_eur === null ? null : Number(row.price_eur)),
      fullPriceEur: hasReduction && row.price_eur !== null ? Number(row.price_eur) : null,
      reductionLabel: row.reduction_label || null,
      priceOnRequest: Boolean(row.price_on_request),
      outOfStock: Boolean(row.out_of_stock),
      needsReview: Boolean(row.needs_review),
    });
  });
  return {
    source: "rdr_catalogue_view",
    importedAt: new Date().toISOString(),
    currency: "EUR",
    priceNote: "Tous nos prix sont indiqués en TTC",
    reliability: { status: "live", productNames: "edited in the admin dashboard" },
    ordering: {
      email: "commande@rdr.lu",
      gsm: "+352 621 777 057",
      telephone: "26 37 09 15 - 60",
      deliveryNote: "Livraison gratuite",
    },
    producers: [...producers.values()],
  };
}

/** Prefer the live database; fall back to the bundled JSON if it is unreachable. */
function requestFromDatabase() {
  return window.RdrSupabase.select("rdr_catalogue_view", {
    select: "*", order: "sort_key.asc", limit: 2000,
  }).then(catalogueFromRows);
}

function requestCatalogue() {
  if (window.RdrSupabase?.isConfigured?.()) {
    // Validate here too, so a shape problem falls back rather than failing the page.
    return requestFromDatabase()
      .then((payload) => { validateCatalogue(payload); return payload; })
      .catch((error) => {
        console.warn("Live catalogue unavailable; using the bundled copy.", error);
        return requestCatalogueFromFile();
      });
  }
  return requestCatalogueFromFile();
}

function requestCatalogueFromFile() {
  if (window.location.protocol === "file:") return loadCatalogueFromFrame();
  return fetch(CATALOGUE_URL).then((response) => {
    if (!response.ok) throw new Error(`Catalogue request failed with HTTP ${response.status}.`);
    return response.json();
  });
}

function loadCatalogue() {
  if (!cataloguePromise) {
    cataloguePromise = requestCatalogue()
      .then(validateCatalogue)
      .catch((error) => {
        cataloguePromise = undefined;
        throw error;
      });
  }
  return cataloguePromise;
}

function flattenCatalogue(catalogue) {
  return Object.freeze(catalogue.producers.flatMap((producer) => producer.products.map((product) => Object.freeze({
    ...product,
    producerId: producer.id,
    producerName: producer.name,
    country: producer.country,
    region: producer.region,
  }))));
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();
}

function formatPrice(product, lang = "fr") {
  if (product.priceOnRequest || product.priceEur === null) return null;
  const locale = lang === "de" ? "de-LU" : lang === "en" ? "en-LU" : "fr-LU";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(product.priceEur);
}

function text(key) {
  return window.I18N ? window.I18N.t(key) : key;
}

function createCell(className, label) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.dataset.label = label;
  return cell;
}

function createReviewFlag() {
  const flag = document.createElement("span");
  flag.className = "review-flag";
  flag.textContent = text("catalogue.review");
  flag.title = text("catalogue.reviewTip");
  flag.setAttribute("aria-label", `${text("catalogue.review")}: ${text("catalogue.reviewTip")}`);
  return flag;
}

function createProductRow(product, options) {
  const row = document.createElement("tr");
  row.id = product.id;
  row.classList.toggle("is-unavailable", product.outOfStock);

  const colourLabel = product.colour ? text(`colour.${product.colour}`) : text("colour.none");
  const colourCell = createCell("colour-cell", text("catalogue.colour"));
  const marker = document.createElement("span");
  marker.className = "colour-marker";
  marker.dataset.colour = product.colour || "none";
  marker.setAttribute("aria-label", colourLabel);
  marker.title = colourLabel;
  colourCell.appendChild(marker);

  // The product name is the way into the detail page from every listing on the
  // site, so it is a link here rather than in each caller.
  const productCell = createCell("product-cell", text("catalogue.product"));
  const productLink = document.createElement("a");
  productLink.className = "product-link";
  productLink.href = `vin.html?id=${encodeURIComponent(product.id)}`;
  productLink.textContent = product.name;
  productCell.appendChild(productLink);
  if (product.needsReview) productCell.appendChild(createReviewFlag());

  const producerCell = createCell("producer-cell", text("catalogue.producer"));
  if (options.showProducer === false) producerCell.textContent = product.region || "";
  else {
    const link = document.createElement("a");
    link.href = `producteur.html?id=${encodeURIComponent(product.producerId)}`;
    link.textContent = product.producerName;
    producerCell.appendChild(link);
  }

  const formatCell = createCell("format-cell", text("catalogue.format"));
  formatCell.textContent = product.format || "—";

  const priceCell = createCell("price-cell", text("catalogue.price"));
  const displayPrice = formatPrice(product, window.I18N?.lang || "fr");
  if (displayPrice) priceCell.textContent = displayPrice;
  else {
    const contactLink = document.createElement("a");
    contactLink.href = "contact.html";
    contactLink.textContent = text("catalogue.onRequest");
    priceCell.appendChild(contactLink);
  }

  const statusCell = createCell("status-cell", text("catalogue.availability"));
  const status = document.createElement("span");
  status.className = `status ${product.outOfStock ? "status-out" : "status-in"}`;
  status.textContent = text(product.outOfStock ? "catalogue.unavailable" : "catalogue.available");
  statusCell.appendChild(status);

  [colourCell, productCell, producerCell, formatCell, priceCell, statusCell].forEach((cell) => row.appendChild(cell));
  return row;
}

function renderProductTable(host, products, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", text("catalogue.title"));

  const table = document.createElement("table");
  table.className = `product-table${options.shouldAnimate ? " is-settling" : ""}`;
  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = text("catalogue.title");
  table.appendChild(caption);

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["catalogue.colour", "catalogue.product", "catalogue.producer", "catalogue.format", "catalogue.price", "catalogue.availability"].forEach((key) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text(key);
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");
  const fragment = document.createDocumentFragment();
  products.forEach((product) => fragment.appendChild(createProductRow(product, options)));
  body.appendChild(fragment);
  table.appendChild(body);
  wrapper.appendChild(table);

  host.replaceChildren(wrapper);
  if (options.shouldAnimate) window.setTimeout(() => table.classList.remove("is-settling"), 300);
  return table;
}

function syncProductSchema(products, pageUrl = window.location.href) {
  const previous = document.querySelector("script[data-product-schema]");
  if (previous) previous.remove();
  const baseUrl = new URL(pageUrl);
  baseUrl.hash = "";
  const graph = products.map((product) => {
    const offer = {
      "@type": "Offer",
      priceCurrency: "EUR",
      availability: product.outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: `${baseUrl.href}#${encodeURIComponent(product.id)}`,
    };
    if (product.priceOnRequest || product.priceEur === null) offer.description = text("catalogue.onRequest");
    else offer.price = product.priceEur.toFixed(2);
    return {
      "@type": "Product",
      "@id": `${baseUrl.href}#${encodeURIComponent(product.id)}`,
      name: product.name,
      category: product.category,
      brand: { "@type": "Brand", name: product.producerName },
      offers: offer,
    };
  });
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.dataset.productSchema = "true";
  script.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
  document.head.appendChild(script);
}

function showDataError(host, error) {
  console.error("Catalogue data could not be loaded.", error);
  const message = document.createElement("p");
  message.className = "error-state";
  message.setAttribute("role", "alert");
  message.textContent = text("catalogue.error");
  host.replaceChildren(message);
}

window.RdrCatalogue = Object.freeze({
  flattenCatalogue,
  formatPrice,
  loadCatalogue,
  normalizeSearchText,
  renderProductTable,
  showDataError,
  syncProductSchema,
});
