/**
 * wine.js — the single-product page (vin.html?id=…).
 *
 * Wrapped in an IIFE because this file and catalogue-data.js are both classic
 * scripts sharing global scope.
 */
(() => {
  const { flattenCatalogue, formatPrice, loadCatalogue, renderProductTable, showDataError, syncProductSchema } = window.RdrCatalogue;
  const MAX_SIBLINGS = 12;
  const FEEDBACK_MS = 4000;

  const errorHost = document.querySelector("[data-wine-error]");
  const content = document.querySelector("[data-wine-content]");

  function text(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  /** Only ever trust an id that matches a product we actually loaded. */
  function requestedId() {
    const raw = new URLSearchParams(window.location.search).get("id");
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(trimmed) ? trimmed : "";
  }

  function renderNotFound() {
    content.hidden = true;
    const panel = document.createElement("div");
    panel.className = "container empty-state";
    const heading = document.createElement("h1");
    heading.textContent = text("wine.notFoundTitle");
    const body = document.createElement("p");
    body.textContent = text("wine.notFoundBody");
    const link = document.createElement("a");
    link.className = "button";
    link.href = "catalogue.html";
    link.textContent = text("wine.backToCatalogue");
    panel.append(heading, body, link);
    errorHost.replaceChildren(panel);
  }

  function addFact(list, labelKey, value) {
    if (value === null || value === undefined || value === "") return;
    const term = document.createElement("dt");
    term.textContent = text(labelKey);
    const detail = document.createElement("dd");
    detail.textContent = value;
    list.append(term, detail);
  }

  function paint(product, siblings) {
    const lang = window.I18N?.lang || "fr";
    const colourLabel = product.colour ? text(`colour.${product.colour}`) : text("colour.none");

    document.querySelector("[data-wine-title]").textContent = product.name;
    const origin = [product.producerName, product.region, product.country].filter(Boolean).join(", ");
    document.querySelector("[data-wine-origin]").textContent = origin;

    const producerLink = document.querySelector("[data-wine-producer-link]");
    producerLink.href = `producteur.html?id=${encodeURIComponent(product.producerId)}`;
    producerLink.textContent = product.producerName;

    const meta = document.querySelector("[data-wine-meta]");
    meta.replaceChildren();
    const marker = document.createElement("span");
    marker.className = "colour-marker";
    marker.dataset.colour = product.colour || "none";
    marker.setAttribute("aria-label", colourLabel);
    marker.title = colourLabel;
    meta.append(marker, document.createTextNode(` ${colourLabel}`));
    if (product.needsReview) {
      const flag = document.createElement("span");
      flag.className = "review-flag";
      flag.textContent = text("catalogue.review");
      flag.title = text("catalogue.reviewTip");
      flag.setAttribute("aria-label", `${text("catalogue.review")}: ${text("catalogue.reviewTip")}`);
      meta.appendChild(flag);
    }

    const facts = document.querySelector("[data-wine-facts]");
    facts.replaceChildren();
    addFact(facts, "catalogue.producer", product.producerName);
    addFact(facts, "wine.country", product.country);
    addFact(facts, "wine.region", product.region);
    addFact(facts, "wine.category", text(`category.${product.category}`));
    addFact(facts, "catalogue.colour", colourLabel);
    addFact(facts, "catalogue.format", product.format);

    const price = formatPrice(product, lang);
    const priceHost = document.querySelector("[data-wine-price]");
    priceHost.replaceChildren();
    if (price) {
      priceHost.textContent = price;
    } else {
      const link = document.createElement("a");
      link.href = "contact.html";
      link.textContent = text("catalogue.onRequest");
      priceHost.appendChild(link);
    }

    const status = document.querySelector("[data-wine-status]");
    status.className = `wine-status status ${product.outOfStock ? "status-out" : "status-in"}`;
    status.textContent = text(product.outOfStock ? "catalogue.unavailable" : "catalogue.available");

    // Nothing without a price, and nothing out of stock, can be added.
    const form = document.querySelector("[data-buy-form]");
    form.hidden = product.outOfStock || !price;

    const siblingHost = document.querySelector("[data-sibling-table]");
    if (siblings.length) {
      renderProductTable(siblingHost, siblings.slice(0, MAX_SIBLINGS), { showProducer: false });
    } else {
      const note = document.createElement("p");
      note.className = "loading-state";
      note.textContent = text("wine.noSiblings");
      siblingHost.replaceChildren(note);
    }

    document.title = `${product.name} — ${product.producerName} | Rêves de Rasiguères`;
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute("content",
        `${product.name}, ${product.producerName}${product.region ? `, ${product.region}` : ""}. ${product.format}${price ? ` — ${price}` : ""}.`);
    }
    syncProductSchema([product], window.location.href);
    content.hidden = false;
  }

  function wireBuyForm(product) {
    const form = document.querySelector("[data-buy-form]");
    const feedback = document.querySelector("[data-buy-feedback]");
    let timer;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!window.RdrBasket) return;
      const quantity = Number.parseInt(new FormData(form).get("quantity"), 10);
      try {
        window.RdrBasket.add(product.id, Number.isFinite(quantity) ? quantity : 1);
        feedback.textContent = text("wine.added");
        feedback.classList.remove("is-error");
      } catch (error) {
        console.error("Could not add to basket", error);
        feedback.textContent = text("wine.addFailed");
        feedback.classList.add("is-error");
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { feedback.textContent = ""; }, FEEDBACK_MS);
    });
  }

  function boot() {
    const id = requestedId();
    if (!id) { renderNotFound(); return; }

    loadCatalogue().then((catalogue) => {
      const products = flattenCatalogue(catalogue);
      const product = products.find((candidate) => candidate.id === id);
      if (!product) { renderNotFound(); return; }
      const siblings = products.filter((candidate) => candidate.producerId === product.producerId && candidate.id !== product.id);
      paint(product, siblings);
      wireBuyForm(product);
      if (window.I18N) window.I18N.onChange(() => paint(product, siblings));
    }).catch((error) => {
      console.error("Catalogue could not be loaded.", error);
      content.hidden = true;
      showDataError(errorHost, error);
    });
  }

  boot();
})();
