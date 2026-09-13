// Wrapped in an IIFE: this file and catalogue-data.js are both classic
// scripts sharing global scope, so top-level `const` here would collide
// with the function declarations of the same name in catalogue-data.js.
(() => {
  const { flattenCatalogue, formatPrice, loadCatalogue, showDataError } = window.RdrCatalogue;

  const SAMPLE_SIZE = 8;

  /**
   * Pick a showcase that stands up to scrutiny: nothing whose name is still
   * unverified, nothing out of stock, nothing without a price — and spread
   * across countries and categories so the strip shows the real breadth of
   * the range rather than four arbitrary bottles.
   */
  function sampleProducts(products) {
    // A name that still carries a run-together capital (PROMORêves) or no
    // lower-case at all is an import artefact, not a wine worth showing.
    const looksClean = (name) => (
      typeof name === "string"
      && name.length > 2
      && !/[A-ZÀ-Þ]{2,}[a-zà-þ]/.test(name)
      && /[a-zà-þ]/.test(name)
    );

    const sellable = products.filter((product) => (
      !product.needsReview
      && !product.outOfStock
      && !product.priceOnRequest
      && typeof product.priceEur === "number"
      && Boolean(product.producerName)
      && Boolean(product.country)
      && looksClean(product.name)
    ));

    // The same wine in two formats is one wine as far as a showcase goes.
    const seen = new Set();
    const unique = sellable.filter((product) => {
      const key = `${product.producerName}|${product.name}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // One per bucket first, in this order, so the mix is deliberate.
    const buckets = [
      (product) => product.country === "France" && product.colour === "rouge",
      (product) => product.country === "France" && product.colour === "blanc",
      (product) => product.country === "Luxembourg",
      (product) => product.country === "Italie",
      (product) => product.country === "Autriche",
      (product) => product.category === "champagne",
      (product) => product.category === "gin",
      (product) => product.category === "whisky",
    ];

    const chosen = buckets.reduce((picked, matches) => {
      const match = unique.find((product) => (
        matches(product) && !picked.some((already) => already.id === product.id)
      ));
      return match ? [...picked, match] : picked;
    }, []);

    // Top up from whatever is left if a bucket came back empty.
    const filled = unique.reduce((picked, product) => (
      picked.length >= SAMPLE_SIZE || picked.some((already) => already.id === product.id)
        ? picked
        : [...picked, product]
    ), chosen);

    return Object.freeze(filled.slice(0, SAMPLE_SIZE));
  }

  function renderSamples(host, products) {
    const list = document.createElement("ul");
    list.className = "product-strip";
    products.forEach((product) => {
      const item = document.createElement("li");
      const colourLabel = product.colour ? window.I18N.t(`colour.${product.colour}`) : window.I18N.t("colour.none");
      const marker = document.createElement("span");
      marker.className = "colour-marker";
      marker.dataset.colour = product.colour || "none";
      marker.setAttribute("aria-label", colourLabel);
      marker.title = colourLabel;
      const name = document.createElement("span");
      name.textContent = product.name;
      if (product.needsReview) {
        const flag = document.createElement("span");
        flag.className = "review-flag";
        flag.textContent = window.I18N.t("catalogue.review");
        flag.title = window.I18N.t("catalogue.reviewTip");
        name.appendChild(flag);
      }
      const producer = document.createElement("span");
      producer.className = "producer";
      producer.textContent = product.producerName;
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = formatPrice(product, window.I18N.lang) || window.I18N.t("catalogue.onRequest");
      item.append(marker, name, producer, price);
      list.appendChild(item);
    });
    host.replaceChildren(list);
  }

  async function boot() {
    const host = document.querySelector("[data-home-products]");
    if (!host) return;
    try {
      const catalogue = await loadCatalogue();
      const samples = sampleProducts(flattenCatalogue(catalogue));
      renderSamples(host, samples);
      document.addEventListener("i18n:change", () => renderSamples(host, samples));
    } catch (error) {
      showDataError(host, error);
    }
  }

  boot();

})();
