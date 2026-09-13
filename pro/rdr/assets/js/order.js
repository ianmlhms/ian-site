/**
 * order.js — the Bon de Commande.
 *
 * Reads the basket, collects the customer's details, and records the order in
 * Supabase. Payment is never taken here: an order is a reservation, settled at
 * the shop or on delivery.
 */
(() => {
  const { flattenCatalogue, loadCatalogue, showDataError } = window.RdrCatalogue;

  const form = document.querySelector("[data-order-form]");
  const itemsHost = document.querySelector("[data-order-items]");
  const confirmation = document.querySelector("[data-order-confirmation]");
  const itemError = document.querySelector("[data-item-error]");

  // Required for a delivery, ignored for a collection — matching the
  // rdr_orders_address_ck constraint in the database.
  const DELIVERY_FIELDS = ["address", "postcode", "city"];
  const REQUIRED_FIELDS = ["firstName", "lastName", "email"];
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  let catalogueProducts = [];
  let isSubmitting = false;

  function text(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  function money(value) {
    const lang = window.I18N?.lang || "fr";
    const locale = lang === "de" ? "de-LU" : lang === "en" ? "en-LU" : "fr-LU";
    return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
  }

  function chosenFulfilment() {
    return form.querySelector('input[name="fulfilment"]:checked')?.value || "collect";
  }

  function setFieldError(control, message) {
    const holder = control.closest(".field") || control.parentElement;
    const slot = holder?.querySelector(".field-error");
    if (slot) slot.textContent = message || "";
    control.setAttribute("aria-invalid", message ? "true" : "false");
  }

  /** Address fields only exist as requirements when delivery is chosen. */
  function syncDeliveryFields() {
    const isDelivery = chosenFulfilment() === "delivery";
    DELIVERY_FIELDS.forEach((name) => {
      const control = form.elements[name];
      if (!control) return;
      const holder = control.closest(".field");
      if (holder) holder.hidden = !isDelivery;
      control.required = isDelivery;
      if (!isDelivery) setFieldError(control, "");
    });
  }

  function renderItems() {
    const lines = window.RdrBasket.resolve(catalogueProducts);
    if (lines.length === 0) {
      const empty = document.createElement("p");
      empty.className = "loading-state";
      empty.textContent = text("order.basketEmpty");
      const link = document.createElement("a");
      link.href = "catalogue.html";
      link.className = "link-button";
      link.textContent = text("basket.browse");
      itemsHost.replaceChildren(empty, link);
      return;
    }

    const list = document.createElement("ul");
    list.className = "order-summary-list";
    lines.forEach((line) => {
      const item = document.createElement("li");
      const name = line.product ? `${line.product.name} — ${line.product.producerName}, ${line.product.format}` : text("basket.withdrawn");
      const total = line.lineTotal === null ? text("catalogue.onRequest") : money(line.lineTotal);
      item.textContent = `${line.quantity} × ${name} · ${total}`;
      list.appendChild(item);
    });

    const total = document.createElement("p");
    total.className = "basket-total";
    total.textContent = `${text("basket.total")} ${money(window.RdrBasket.total(catalogueProducts))}`;

    const edit = document.createElement("a");
    edit.className = "link-button";
    edit.href = "panier.html";
    edit.textContent = text("order.editBasket");

    itemsHost.replaceChildren(list, total, edit);
  }

  function validate() {
    let firstInvalid = null;
    const fail = (control, message) => {
      setFieldError(control, message);
      if (!firstInvalid) firstInvalid = control;
    };

    REQUIRED_FIELDS.forEach((name) => {
      const control = form.elements[name];
      if (!control) return;
      const value = String(control.value || "").trim();
      if (!value) fail(control, text("form.required"));
      else if (name === "email" && !EMAIL_PATTERN.test(value)) fail(control, text("form.emailInvalid"));
      else setFieldError(control, "");
    });

    if (chosenFulfilment() === "delivery") {
      DELIVERY_FIELDS.forEach((name) => {
        const control = form.elements[name];
        if (!control) return;
        if (!String(control.value || "").trim()) fail(control, text("form.required"));
        else setFieldError(control, "");
      });
    }

    const lines = window.RdrBasket.resolve(catalogueProducts);
    const sellable = lines.filter((line) => line.isAvailable);
    if (sellable.length === 0) {
      itemError.textContent = text("order.needItems");
      if (!firstInvalid) firstInvalid = itemsHost;
    } else {
      itemError.textContent = "";
    }

    return { firstInvalid, lines: sellable };
  }

  function showConfirmation(reference) {
    const heading = confirmation.querySelector("h2");
    const body = confirmation.querySelector("p");
    if (heading) heading.textContent = text("form.successTitle");
    if (body) {
      body.textContent = reference
        ? `${text("form.successRef")} ${reference}. ${text("form.successBody")}`
        : text("form.successBody");
    }
    confirmation.hidden = false;
    confirmation.focus();
  }

  function showSubmitError(message) {
    itemError.textContent = message;
  }

  /**
   * The order goes through a SECURITY DEFINER function, not a direct insert:
   * it writes the order and its items in one transaction, takes prices from
   * the catalogue rather than from this form, and returns only the reference —
   * the public can never read an order back.
   */
  async function submitOrder(lines) {
    const data = new FormData(form);
    const fulfilment = chosenFulfilment();
    const payload = {
      first_name: String(data.get("firstName") || "").trim(),
      last_name: String(data.get("lastName") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || data.get("gsm") || "").trim(),
      fulfilment,
      address: fulfilment === "delivery" ? String(data.get("address") || "").trim() : "",
      postcode: fulfilment === "delivery" ? String(data.get("postcode") || "").trim() : "",
      locality: fulfilment === "delivery" ? String(data.get("city") || "").trim() : "",
      message: String(data.get("message") || "").trim(),
      lang: window.I18N?.lang || "fr",
      items: lines.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
    };
    const reference = await window.RdrSupabase.rpc("rdr_place_order", { payload });
    if (typeof reference !== "string" || !reference) throw new Error("The order was not confirmed.");
    return reference;
  }

  function bind() {
    form.addEventListener("change", (event) => {
      if (event.target.name === "fulfilment") syncDeliveryFields();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (isSubmitting) return;

      const { firstInvalid, lines } = validate();
      if (firstInvalid) {
        firstInvalid.focus?.();
        return;
      }

      if (!window.RdrSupabase.isConfigured()) {
        showSubmitError(text("order.notConfigured"));
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      isSubmitting = true;
      if (submitButton) submitButton.disabled = true;
      showSubmitError("");

      try {
        const reference = await submitOrder(lines);
        window.RdrBasket.clear();
        form.hidden = true;
        showConfirmation(reference);
      } catch (error) {
        console.error("The order could not be sent.", error);
        showSubmitError(`${text("order.sendFailed")} ${error.message}`);
      } finally {
        isSubmitting = false;
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  loadCatalogue().then((catalogue) => {
    catalogueProducts = flattenCatalogue(catalogue);
    renderItems();
    syncDeliveryFields();
    bind();
    window.RdrBasket.subscribe(renderItems);
    if (window.I18N) window.I18N.onChange(renderItems);
  }).catch((error) => {
    console.error("Catalogue could not be loaded.", error);
    showDataError(itemsHost, error);
  });
})();
