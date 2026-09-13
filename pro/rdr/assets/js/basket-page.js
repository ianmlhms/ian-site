/**
 * basket-page.js — renders panier.html from the stored basket joined to the
 * live catalogue. Wrapped in an IIFE (classic scripts share global scope).
 */
(() => {
  const { flattenCatalogue, loadCatalogue, showDataError } = window.RdrCatalogue;
  const host = document.querySelector("[data-basket-host]");

  function text(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  function money(value) {
    const lang = window.I18N?.lang || "fr";
    const locale = lang === "de" ? "de-LU" : lang === "en" ? "en-LU" : "fr-LU";
    return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
  }

  function renderEmpty() {
    const panel = document.createElement("div");
    panel.className = "empty-state";
    const heading = document.createElement("h2");
    heading.textContent = text("basket.emptyTitle");
    const body = document.createElement("p");
    body.textContent = text("basket.emptyBody");
    const link = document.createElement("a");
    link.className = "button";
    link.href = "catalogue.html";
    link.textContent = text("basket.browse");
    panel.append(heading, body, link);
    host.replaceChildren(panel);
  }

  function lineRow(line) {
    const row = document.createElement("tr");
    row.classList.toggle("is-unavailable", !line.isAvailable);

    const nameCell = document.createElement("td");
    nameCell.className = "product-cell";
    nameCell.dataset.label = text("catalogue.product");
    if (line.product) {
      const link = document.createElement("a");
      link.className = "product-link";
      link.href = `vin.html?id=${encodeURIComponent(line.productId)}`;
      link.textContent = line.product.name;
      nameCell.appendChild(link);
      const small = document.createElement("small");
      small.className = "basket-producer";
      small.textContent = `${line.product.producerName} · ${line.product.format}`;
      nameCell.appendChild(small);
    } else {
      // The product has left the catalogue since it was added.
      nameCell.textContent = text("basket.withdrawn");
    }

    const qtyCell = document.createElement("td");
    qtyCell.className = "qty-cell";
    qtyCell.dataset.label = text("basket.quantity");
    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "1";
    qty.max = String(window.RdrBasket.MAX_QUANTITY);
    qty.step = "1";
    qty.value = String(line.quantity);
    qty.setAttribute("aria-label", text("basket.quantity"));
    qty.addEventListener("change", () => window.RdrBasket.setQuantity(line.productId, qty.value));
    qtyCell.appendChild(qty);

    const priceCell = document.createElement("td");
    priceCell.className = "price-cell";
    priceCell.dataset.label = text("basket.lineTotal");
    priceCell.textContent = line.lineTotal === null ? text("catalogue.onRequest") : money(line.lineTotal);

    const removeCell = document.createElement("td");
    removeCell.className = "remove-cell";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button";
    remove.textContent = text("basket.remove");
    remove.setAttribute("aria-label", `${text("basket.remove")}: ${line.product ? line.product.name : line.productId}`);
    remove.addEventListener("click", () => window.RdrBasket.remove(line.productId));
    removeCell.appendChild(remove);

    row.append(nameCell, qtyCell, priceCell, removeCell);
    return row;
  }

  function render(products) {
    const lines = window.RdrBasket.resolve(products);
    if (lines.length === 0) { renderEmpty(); return; }

    const table = document.createElement("table");
    table.className = "product-table basket-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["catalogue.product", "basket.quantity", "basket.lineTotal", "basket.actions"].forEach((key, index) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = text(key);
      if (index === 3) th.className = "visually-hidden";
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    lines.forEach((line) => body.appendChild(lineRow(line)));
    table.append(head, body);

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.appendChild(table);

    const summary = document.createElement("div");
    summary.className = "basket-summary";
    const totalLine = document.createElement("p");
    totalLine.className = "basket-total";
    totalLine.textContent = `${text("basket.total")} ${money(window.RdrBasket.total(products))}`;
    const note = document.createElement("p");
    note.className = "basket-note";
    note.textContent = text("basket.paymentNote");
    const actions = document.createElement("div");
    actions.className = "basket-actions";
    const order = document.createElement("a");
    order.className = "button";
    order.href = "commander.html";
    order.textContent = text("basket.checkout");
    const keep = document.createElement("a");
    keep.className = "link-button";
    keep.href = "catalogue.html";
    keep.textContent = text("basket.continue");
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "link-button";
    clear.textContent = text("basket.clear");
    clear.addEventListener("click", () => {
      if (window.confirm(text("basket.clearConfirm"))) window.RdrBasket.clear();
    });
    actions.append(order, keep, clear);
    summary.append(totalLine, note, actions);

    host.replaceChildren(wrap, summary);
  }

  loadCatalogue().then((catalogue) => {
    const products = flattenCatalogue(catalogue);
    const paint = () => render(products);
    paint();
    window.RdrBasket.subscribe(paint);
    if (window.I18N) window.I18N.onChange(paint);
  }).catch((error) => {
    console.error("Catalogue could not be loaded.", error);
    showDataError(host, error);
  });
})();
