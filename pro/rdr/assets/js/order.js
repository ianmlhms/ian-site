// Wrapped in an IIFE: this file and catalogue-data.js are both classic
// scripts sharing global scope, so top-level `const` here would collide
// with the function declarations of the same name in catalogue-data.js.
(() => {
  const { flattenCatalogue, formatPrice, loadCatalogue, showDataError } = window.RdrCatalogue;

  const REQUIRED_FIELDS = Object.freeze(["lastName", "firstName", "address", "postcode", "city", "gsm", "email"]);
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function productOption(product) {
    const option = document.createElement("option");
    option.value = product.id;
    const price = formatPrice(product, window.I18N.lang) || window.I18N.t("catalogue.onRequest");
    option.textContent = `${product.name} — ${product.producerName} — ${product.format || "—"} — ${price}`;
    option.disabled = product.outOfStock;
    return option;
  }

  function createOrderRow(products, selectedId = "") {
    const row = document.createElement("div");
    row.className = "order-row";
    const productField = document.createElement("div");
    productField.className = "field";
    const productLabel = document.createElement("label");
    productLabel.textContent = window.I18N.t("form.product");
    const select = document.createElement("select");
    select.name = "product";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = window.I18N.t("form.product");
    select.append(placeholder, ...products.map(productOption));
    select.value = selectedId;
    productLabel.appendChild(select);
    productField.appendChild(productLabel);

    const quantityField = document.createElement("div");
    quantityField.className = "field";
    const quantityLabel = document.createElement("label");
    quantityLabel.textContent = window.I18N.t("form.quantity");
    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.name = "quantity";
    quantity.min = "1";
    quantity.max = "999";
    quantity.value = "1";
    quantityLabel.appendChild(quantity);
    quantityField.appendChild(quantityLabel);

    const remove = document.createElement("button");
    remove.className = "remove-row";
    remove.type = "button";
    remove.dataset.removeOrderRow = "true";
    remove.setAttribute("aria-label", window.I18N.t("form.remove"));
    remove.title = window.I18N.t("form.remove");
    remove.textContent = "×";
    row.append(productField, quantityField, remove);
    return row;
  }

  function setFieldError(control, message) {
    const error = document.getElementById(`${control.id}-error`);
    control.setAttribute("aria-invalid", message ? "true" : "false");
    if (error) error.textContent = message;
  }

  function validateForm(form) {
    let isValid = true;
    REQUIRED_FIELDS.forEach((name) => {
      const control = form.elements.namedItem(name);
      const isEmpty = !control.value.trim();
      setFieldError(control, isEmpty ? window.I18N.t("form.required") : "");
      if (isEmpty) isValid = false;
    });
    const email = form.elements.namedItem("email");
    if (email.value.trim() && !EMAIL_PATTERN.test(email.value.trim())) {
      setFieldError(email, window.I18N.t("form.emailError"));
      isValid = false;
    }
    const selectedProducts = [...form.querySelectorAll("select[name='product']")].filter((select) => select.value);
    const itemError = document.querySelector("[data-item-error]");
    if (itemError) itemError.textContent = selectedProducts.length ? "" : window.I18N.t("form.itemError");
    return isValid && selectedProducts.length > 0;
  }

  function bindForm(form, itemsHost, products) {
    const addButton = document.querySelector("[data-add-order-row]");
    addButton?.addEventListener("click", () => itemsHost.appendChild(createOrderRow(products)));
    itemsHost.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-order-row]");
      if (!button) return;
      const rows = itemsHost.querySelectorAll(".order-row");
      if (rows.length === 1) {
        rows[0].querySelector("select").value = "";
        rows[0].querySelector("input").value = "1";
        return;
      }
      button.closest(".order-row")?.remove();
    });
    form.addEventListener("input", (event) => {
      if (event.target.id) setFieldError(event.target, "");
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      // Demo only: intentionally no request, email, or other network submission is made.
      if (!validateForm(form)) {
        form.querySelector("[aria-invalid='true']")?.focus();
        return;
      }
      const confirmation = document.querySelector("[data-order-confirmation]");
      if (confirmation) {
        confirmation.hidden = false;
        confirmation.focus();
        confirmation.scrollIntoView({ block: "center" });
      }
    });
  }

  async function boot() {
    const form = document.querySelector("[data-order-form]");
    const itemsHost = document.querySelector("[data-order-items]");
    if (!form || !itemsHost) return;
    try {
      const catalogue = await loadCatalogue();
      const products = flattenCatalogue(catalogue).slice().sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
      const requestedProduct = new URLSearchParams(window.location.search).get("product") || "";
      const safeProduct = products.some((product) => product.id === requestedProduct && !product.outOfStock) ? requestedProduct : "";
      itemsHost.replaceChildren(createOrderRow(products, safeProduct));
      bindForm(form, itemsHost, products);
      document.addEventListener("i18n:change", () => {
        const selections = [...itemsHost.querySelectorAll(".order-row")].map((row) => ({
          product: row.querySelector("select").value,
          quantity: row.querySelector("input").value,
        }));
        itemsHost.replaceChildren(...selections.map((selection) => {
          const row = createOrderRow(products, selection.product);
          row.querySelector("input").value = selection.quantity;
          return row;
        }));
      });
    } catch (error) {
      showDataError(itemsHost, error);
      form.querySelector("button[type='submit']")?.setAttribute("disabled", "");
    }
  }

  boot();

})();
