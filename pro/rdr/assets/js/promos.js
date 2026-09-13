/**
 * promos.js — renders the shop's promotions from the database.
 *
 * Promotions are created and dated in the admin dashboard (rdr_promos). If
 * none is active, the home page hides its band entirely and the news page says
 * so plainly, rather than leaving a stale offer on the site.
 */
(() => {
  const band = document.querySelector("[data-promo-band]");
  const section = document.querySelector("[data-promo-section]");
  const list = document.querySelector("[data-promo-list]");
  if (!band && !list) return;

  function text(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  /** Pick the field for the active language, falling back to French. */
  function localised(row, base) {
    const lang = window.I18N?.lang || "fr";
    return row[`${base}_${lang}`] || row[`${base}_fr`] || "";
  }

  function isLive(row) {
    if (row.is_active === false) return false;
    const today = new Date().toISOString().slice(0, 10);
    if (row.starts_on && row.starts_on > today) return false;
    if (row.ends_on && row.ends_on < today) return false;
    return true;
  }

  function renderBand(promos) {
    if (!band || !section) return;
    const promo = promos[0];
    if (!promo) { section.hidden = true; return; }
    const title = document.createElement("h2");
    title.className = "promo-title";
    title.textContent = localised(promo, "title");
    const copy = document.createElement("p");
    copy.className = "promo-copy";
    copy.textContent = localised(promo, "body");
    band.replaceChildren(title, copy);
    section.hidden = false;
  }

  function renderList(promos) {
    if (!list) return;
    if (promos.length === 0) {
      const empty = document.createElement("p");
      empty.className = "loading-state";
      empty.textContent = text("news.noPromos");
      list.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    promos.forEach((promo) => {
      const article = document.createElement("article");
      article.className = "news-item";
      const when = document.createElement("time");
      if (promo.starts_on) when.dateTime = promo.starts_on;
      when.textContent = promo.starts_on || text("news.now");
      const body = document.createElement("div");
      const title = document.createElement("h2");
      title.textContent = localised(promo, "title");
      const copy = document.createElement("p");
      copy.textContent = localised(promo, "body");
      const link = document.createElement("a");
      link.className = "text-link";
      link.href = "contact.html";
      link.textContent = text("nav.contact");
      body.append(title, copy, link);
      article.append(when, body);
      fragment.appendChild(article);
    });
    list.replaceChildren(fragment);
  }

  function paint(promos) {
    renderBand(promos);
    renderList(promos);
  }

  if (!window.RdrSupabase?.isConfigured?.()) { paint([]); return; }

  window.RdrSupabase.select("rdr_promos", { select: "*", order: "sort_key.asc" })
    .then((rows) => {
      const live = (rows || []).filter(isLive);
      paint(live);
      if (window.I18N) window.I18N.onChange(() => paint(live));
    })
    .catch((error) => {
      // A promotion is decoration: if it cannot load, say nothing rather than
      // break the page.
      console.warn("Promotions could not be loaded.", error);
      paint([]);
    });
})();
