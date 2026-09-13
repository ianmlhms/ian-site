// Wrapped in an IIFE: this file and catalogue-data.js are both classic
// scripts sharing global scope, so top-level `const` here would collide
// with the function declarations of the same name in catalogue-data.js.
(() => {
  const { flattenCatalogue, loadCatalogue, renderProductTable, showDataError, syncProductSchema } = window.RdrCatalogue;

  const SAFE_ID = /^[a-z0-9-]{1,120}$/;

  function requestedId() {
    const value = new URLSearchParams(window.location.search).get("id") || "";
    return SAFE_ID.test(value) ? value : "";
  }

  function updateMetadata(producer) {
    const title = `${producer.name} | Rêves de Rasiguères`;
    const place = [producer.region, producer.country].filter(Boolean).join(", ");
    const description = window.I18N.lang === "de"
      ? `${producer.name}${place ? ` aus ${place}` : ""}: Produkte bei Rêves de Rasiguères in Luxemburg.`
      : window.I18N.lang === "en"
        ? `${producer.name}${place ? ` from ${place}` : ""}: products at Rêves de Rasiguères in Luxembourg.`
        : `${producer.name}${place ? `, ${place}` : ""}: ses produits chez Rêves de Rasiguères au Luxembourg.`;
    document.title = title;
    document.querySelector("meta[name='description']")?.setAttribute("content", description);
    document.querySelector("meta[property='og:title']")?.setAttribute("content", title);
    document.querySelector("meta[property='og:description']")?.setAttribute("content", description);
    const canonicalUrl = `https://ian.lu/pro/rdr/producteur.html?id=${encodeURIComponent(producer.id)}`;
    document.querySelector("link[rel='canonical']")?.setAttribute("href", canonicalUrl);
    document.querySelector("meta[property='og:url']")?.setAttribute("content", canonicalUrl);
  }

  function renderProducer(producer, products) {
    const title = document.querySelector("[data-producer-title]");
    const origin = document.querySelector("[data-producer-origin]");
    const tableHost = document.querySelector("[data-product-table]");
    if (title) title.textContent = producer.name;
    if (origin) origin.textContent = [producer.country, producer.region].filter(Boolean).join(" — ") || window.I18N.t("catalogue.unknownCountry");
    if (tableHost) renderProductTable(tableHost, products, { shouldAnimate: false });
    updateMetadata(producer);
    syncProductSchema(products);
  }

  async function boot() {
    const host = document.querySelector("[data-product-table]");
    const errorHost = document.querySelector("[data-producer-error]");
    if (!host) return;
    try {
      const catalogue = await loadCatalogue();
      const id = requestedId();
      const producer = catalogue.producers.find((entry) => entry.id === id);
      if (!producer) {
        const message = document.createElement("p");
        message.className = "error-state";
        message.setAttribute("role", "alert");
        message.textContent = window.I18N.t("producer.notFound");
        (errorHost || host).replaceChildren(message);
        document.querySelector("[data-producer-content]")?.setAttribute("hidden", "");
        return;
      }
      const products = flattenCatalogue(Object.freeze({ ...catalogue, producers: Object.freeze([producer]) }));
      renderProducer(producer, products);
      document.addEventListener("i18n:change", () => renderProducer(producer, products));
    } catch (error) {
      showDataError(errorHost || host, error);
    }
  }

  boot();

})();
