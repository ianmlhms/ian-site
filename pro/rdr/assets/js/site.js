(function () {
  "use strict";

  var NAV_ITEMS = [
    ["index.html", "nav.home"],
    ["catalogue.html", "nav.catalogue"],
    ["producteurs.html", "nav.producers"],
    ["degustations.html", "nav.tastings"],
    ["nous-trouver.html", "nav.find"],
    ["actualites.html", "nav.news"],
    ["contact.html", "nav.contact"],
  ];

  function currentFile() {
    var file = window.location.pathname.split("/").pop();
    return file || "index.html";
  }

  function navMarkup() {
    var activeFile = currentFile();
    return NAV_ITEMS.map(function (item) {
      var isCurrent = item[0] === activeFile;
      return '<li><a href="' + item[0] + '" data-i18n="' + item[1] + '"' +
        (isCurrent ? ' aria-current="page"' : "") + ">" + item[1] + "</a></li>";
    }).join("");
  }

  function headerMarkup() {
    return '<a class="skip-link" href="#main" data-i18n="skip.content">Aller au contenu</a>' +
      '<header class="site-header">' +
        '<div class="container header-main">' +
          '<a class="brand" href="index.html" aria-label="Rêves de Rasiguères, accueil" data-i18n-attr="aria-label:brand.home">' +
            '<span class="brand-mark">RdR</span>' +
            '<span class="brand-name">Rêves de Rasiguères</span>' +
          '</a>' +
          '<div class="header-actions">' +
            '<a class="basket-link" href="panier.html" data-i18n-attr="aria-label:basket.open">' +
              '<span data-i18n="basket.label">Panier</span>' +
              '<span class="basket-count" id="basketCount" hidden>0</span>' +
            '</a>' +
            '<a class="button header-order" href="commander.html" data-i18n="nav.order">Commander</a>' +
            '<div id="langSw"></div>' +
            '<button class="menu-toggle" type="button" aria-controls="site-nav" aria-expanded="false" data-i18n="nav.open">Menu</button>' +
          '</div>' +
        '</div>' +
        '<nav class="site-nav" id="site-nav" aria-label="Navigation principale" data-i18n-attr="aria-label:nav.primary"><div class="container"><ul>' + navMarkup() + '</ul></div></nav>' +
      '</header>';
  }

  function footerMarkup() {
    return '<footer class="site-footer"><div class="container">' +
      '<div class="footer-grid">' +
        '<section><h2 class="footer-title">Rêves de Rasiguères</h2><p data-i18n="brand.tagline">Notre Rêve, votre découverte…</p></section>' +
        '<section><h2 class="footer-title" data-i18n="footer.visit">Vinothèque</h2><p data-i18n-html="footer.visitText">17-19, avenue de la Libération<br>L-3850 Schifflange<br>Samedi 10.00–12.30 et sur rendez-vous</p></section>' +
        '<section><h2 class="footer-title" data-i18n="footer.contact">Commande et contact</h2>' +
          '<ul class="footer-links"><li><a href="mailto:commande@rdr.lu">commande@rdr.lu</a></li><li><a href="tel:+352621777057">+352 621 777 057</a></li><li><a href="mailto:info@rdr.lu">info@rdr.lu</a></li><li><a href="tel:+3522637091560">+352 26 37 09 15 60</a></li></ul></section>' +
      '</div>' +
      '<div class="footer-grid footer-secondary">' +
        '<section><h2 class="footer-title" data-i18n="footer.legal">Informations</h2><ul class="footer-links"><li><a href="mentions-legales.html" data-i18n="footer.legalNotice">Mentions légales</a></li><li><a href="confidentialite.html" data-i18n="footer.privacy">Confidentialité</a></li></ul></section>' +
        '<section><ul class="footer-links"><li><a href="https://letzshop.lu/fr/vendors/les-reves-de-rasigueres" rel="external">Letzshop</a></li><li><a href="https://facebook.com/revesderasigueres" rel="external">Facebook</a></li><li><a href="https://instagram.com/les_reves_de_rasigueres" rel="external">Instagram</a></li></ul></section>' +
      '</div>' +
      '<div class="footer-bottom"><p data-i18n="footer.alcohol">L’abus d’alcool est dangereux pour la santé. À consommer avec modération.</p><p data-i18n="footer.age">Vente d’alcool réservée aux personnes de 18 ans et plus.</p></div>' +
    '</div></footer>';
  }

  function mountChrome() {
    var headerHost = document.querySelector("[data-site-header]");
    var footerHost = document.querySelector("[data-site-footer]");
    if (headerHost) headerHost.innerHTML = headerMarkup();
    if (footerHost) footerHost.innerHTML = footerMarkup();
  }

  function bindMenu() {
    var button = document.querySelector(".menu-toggle");
    var nav = document.querySelector(".site-nav");
    if (!button || !nav) return;
    button.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  }

  function bindDismissibleNotices() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-dismiss]");
      if (!button) return;
      var target = document.getElementById(button.getAttribute("data-dismiss"));
      if (target) target.hidden = true;
    });
  }

  function bindHomeSearch() {
    var form = document.querySelector("[data-home-search]");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = form.querySelector("input[name='q']");
      var query = input ? input.value.trim().slice(0, 120) : "";
      var url = new URL("catalogue.html", window.location.href);
      if (query) url.searchParams.set("q", query);
      if (window.I18N && window.I18N.lang !== "fr") url.searchParams.set("lang", window.I18N.lang);
      window.location.href = url.href;
    });
  }

  function syncAlternateLinks() {
    document.querySelectorAll("link[rel='alternate'][hreflang]").forEach(function (link) {
      var targetLang = link.getAttribute("hreflang");
      var url = new URL(link.getAttribute("href"), "https://ian.lu/pro/rdr/");
      var currentParams = new URLSearchParams(window.location.search);
      currentParams.delete("lang");
      currentParams.forEach(function (value, key) { url.searchParams.set(key, value); });
      if (targetLang === "x-default" || targetLang === "fr") url.searchParams.delete("lang");
      else url.searchParams.set("lang", targetLang);
      link.href = url.href;
    });
  }

  function injectBusinessSchema() {
    var schema = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Rêves de Rasiguères S.à r.l.",
      slogan: "Notre Rêve, votre découverte…",
      url: "https://ian.lu/pro/rdr/",
      telephone: "+352 26 37 09 15 60",
      email: "info@rdr.lu",
      vatID: "LU30488964",
      sameAs: [
        "https://facebook.com/revesderasigueres",
        "https://instagram.com/les_reves_de_rasigueres",
        "https://letzshop.lu/fr/vendors/les-reves-de-rasigueres"
      ],
      department: [
        {
          "@type": "LiquorStore",
          name: "Vinothèque Rêves de Rasiguères — Schifflange",
          address: {
            "@type": "PostalAddress",
            streetAddress: "17-19, avenue de la Libération",
            postalCode: "L-3850",
            addressLocality: "Schifflange",
            addressCountry: "LU"
          },
          openingHoursSpecification: [{
            "@type": "OpeningHoursSpecification",
            dayOfWeek: "https://schema.org/Saturday",
            opens: "10:00",
            closes: "12:30"
          }]
        },
        {
          "@type": "LocalBusiness",
          name: "Rêves de Rasiguères — Hagen",
          address: {
            "@type": "PostalAddress",
            streetAddress: "51A, rue Principale",
            postalCode: "L-8367",
            addressLocality: "Hagen",
            addressCountry: "LU"
          },
          openingHoursSpecification: [{
            "@type": "OpeningHoursSpecification",
            description: "By appointment"
          }]
        }
      ]
    };
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  function boot() {
    mountChrome();
    bindMenu();
    bindDismissibleNotices();
    bindHomeSearch();
    syncAlternateLinks();
    injectBusinessSchema();
    if (window.I18N) window.I18N.apply(document);
    document.addEventListener("i18n:change", syncAlternateLinks);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  /** Keep the header badge in step with the basket, on every page. */
  function mountBasketCount() {
    const badge = document.getElementById("basketCount");
    if (!badge || !window.RdrBasket) return;
    const paint = () => {
      const count = window.RdrBasket.count();
      badge.textContent = String(count);
      badge.hidden = count === 0;
    };
    paint();
    window.RdrBasket.subscribe(paint);
    if (window.I18N) window.I18N.onChange(paint);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBasketCount);
  } else {
    mountBasketCount();
  }
})();
