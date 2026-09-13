// Wrapped in an IIFE: this file and catalogue-data.js are both classic
// scripts sharing global scope, so top-level `const` here would collide
// with the function declarations of the same name in catalogue-data.js.
(() => {
  const { flattenCatalogue, formatPrice, loadCatalogue, showDataError } = window.RdrCatalogue;

  function sampleProducts(products) {
    const criteria = [
      (product) => product.country === "France" && product.category === "vin",
      (product) => product.country === "Autriche",
      (product) => product.country === "Italie",
      (product) => product.producerId === "domaine-alice-hartmann" && !product.needsReview,
      (product) => product.category === "gin",
    ];
    return Object.freeze(criteria.reduce((samples, predicate) => {
      const match = products.find((product) => predicate(product) && !samples.some((sample) => sample.id === product.id));
      return match ? [...samples, match] : samples;
    }, []));
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
