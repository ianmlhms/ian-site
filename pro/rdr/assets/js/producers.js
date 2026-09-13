// Wrapped in an IIFE: this file and catalogue-data.js are both classic
// scripts sharing global scope, so top-level `const` here would collide
// with the function declarations of the same name in catalogue-data.js.
(() => {
  const { loadCatalogue, showDataError } = window.RdrCatalogue;

  const UNKNOWN_COUNTRY = "__unknown";

  function countryKey(country) {
    return country ? country.trim().toLocaleLowerCase("fr") : UNKNOWN_COUNTRY;
  }

  function groupProducers(producers) {
    const groups = producers.reduce((map, producer) => {
      const key = countryKey(producer.country);
      const current = map.get(key) || Object.freeze({ label: producer.country || null, producers: Object.freeze([]) });
      const next = Object.freeze({
        label: current.label || producer.country || null,
        producers: Object.freeze([...current.producers, producer]),
      });
      const copy = new Map(map);
      copy.set(key, next);
      return copy;
    }, new Map());
    return [...groups.values()].sort((left, right) => {
      if (!left.label) return 1;
      if (!right.label) return -1;
      return left.label.localeCompare(right.label, "fr", { sensitivity: "base" });
    });
  }

  function render(host, producers) {
    const fragment = document.createDocumentFragment();
    groupProducers(producers).forEach((group) => {
      const section = document.createElement("section");
      section.className = "country-group";
      const heading = document.createElement("h2");
      heading.textContent = group.label || window.I18N.t("catalogue.unknownCountry");
      const list = document.createElement("ul");
      list.className = "producer-list";
      group.producers
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }))
        .forEach((producer) => {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = `producteur.html?id=${encodeURIComponent(producer.id)}`;
          link.textContent = producer.name;
          const meta = document.createElement("span");
          meta.className = "producer-meta";
          const region = producer.region ? `${producer.region} — ` : "";
          meta.textContent = region + window.I18N.t("producers.count").replace("{count}", producer.products.length);
          item.append(link, meta);
          list.appendChild(item);
        });
      section.append(heading, list);
      fragment.appendChild(section);
    });
    host.replaceChildren(fragment);
  }

  async function boot() {
    const host = document.querySelector("[data-producer-list]");
    if (!host) return;
    try {
      const catalogue = await loadCatalogue();
      render(host, catalogue.producers);
      document.addEventListener("i18n:change", () => render(host, catalogue.producers));
    } catch (error) {
      showDataError(host, error);
    }
  }

  boot();

})();
