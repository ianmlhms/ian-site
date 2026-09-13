/**
 * basket.js — the customer's basket, kept in localStorage.
 *
 * Only product ids and quantities are stored. Names, prices and availability
 * are resolved from the catalogue at render time, so a basket can never show a
 * stale price or a product that has since been withdrawn.
 *
 * Nothing here is ever charged: payment happens in the shop or on delivery.
 */
(() => {
  const STORAGE_KEY = "rdr-basket";
  const SCHEMA_VERSION = 1;
  const MAX_QUANTITY = 99;
  const MIN_QUANTITY = 1;

  const listeners = new Set();

  /** localStorage throws in private mode, so every access is guarded. */
  function readRaw() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn("Basket could not be read from this browser.", error);
      return null;
    }
  }

  function writeRaw(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
      return true;
    } catch (error) {
      console.warn("Basket could not be saved in this browser.", error);
      return false;
    }
  }

  function isValidLine(line) {
    return Boolean(line)
      && typeof line.productId === "string"
      && line.productId.length > 0
      && Number.isInteger(line.quantity)
      && line.quantity >= MIN_QUANTITY
      && line.quantity <= MAX_QUANTITY;
  }

  /** Anything unrecognised is discarded rather than allowed to crash a page. */
  function load() {
    const raw = readRaw();
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("Basket content was not readable and has been ignored.", error);
      return [];
    }
    if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.lines)) return [];
    return parsed.lines.filter(isValidLine).map((line) => Object.freeze({
      productId: line.productId,
      quantity: line.quantity,
    }));
  }

  let lines = load();

  function notify() {
    const snapshot = items();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("A basket listener failed.", error);
      }
    });
  }

  function commit(nextLines) {
    lines = Object.freeze(nextLines.map((line) => Object.freeze({ ...line })));
    writeRaw(JSON.stringify({ version: SCHEMA_VERSION, lines }));
    notify();
    return items();
  }

  function clampQuantity(value) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return MIN_QUANTITY;
    return Math.min(Math.max(number, MIN_QUANTITY), MAX_QUANTITY);
  }

  function items() {
    return lines.map((line) => ({ ...line }));
  }

  function count() {
    return lines.reduce((total, line) => total + line.quantity, 0);
  }

  /** Adding a product already in the basket increases its quantity. */
  function add(productId, quantity = 1) {
    const id = String(productId || "").trim();
    if (!id) throw new TypeError("add() needs a product id.");
    const wanted = clampQuantity(quantity);
    const existing = lines.find((line) => line.productId === id);
    if (!existing) return commit([...lines, { productId: id, quantity: wanted }]);
    return commit(lines.map((line) => (
      line.productId === id
        ? { ...line, quantity: clampQuantity(line.quantity + wanted) }
        : line
    )));
  }

  function setQuantity(productId, quantity) {
    const id = String(productId || "").trim();
    const wanted = clampQuantity(quantity);
    return commit(lines.map((line) => (
      line.productId === id ? { ...line, quantity: wanted } : line
    )));
  }

  function remove(productId) {
    const id = String(productId || "").trim();
    return commit(lines.filter((line) => line.productId !== id));
  }

  function clear() {
    return commit([]);
  }

  function has(productId) {
    return lines.some((line) => line.productId === String(productId || "").trim());
  }

  /**
   * Join the stored lines to the live catalogue.
   * A product that no longer exists comes back with `isAvailable: false` so the
   * basket page can show it as withdrawn instead of failing.
   */
  function resolve(products) {
    const byId = new Map(products.map((product) => [product.id, product]));
    return lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product) {
        return {
          productId: line.productId,
          quantity: line.quantity,
          product: null,
          isAvailable: false,
          lineTotal: null,
        };
      }
      const unitPrice = product.priceOnRequest ? null : product.priceEur;
      return {
        productId: line.productId,
        quantity: line.quantity,
        product,
        isAvailable: !product.outOfStock && unitPrice !== null,
        unitPrice,
        lineTotal: unitPrice === null ? null : Math.round(unitPrice * line.quantity * 100) / 100,
      };
    });
  }

  /** Sum of the lines that actually carry a price. */
  function total(products) {
    return resolve(products).reduce(
      (sum, line) => (line.lineTotal === null ? sum : sum + line.lineTotal),
      0,
    );
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("subscribe() needs a function.");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // A basket changed in another tab should be reflected here.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    lines = load();
    notify();
  });

  window.RdrBasket = Object.freeze({
    MAX_QUANTITY,
    add,
    clear,
    count,
    has,
    items,
    remove,
    resolve,
    setQuantity,
    subscribe,
    total,
  });
})();
