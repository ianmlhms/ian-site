const ALLOWED_LENGTHS = Object.freeze([4, 6]);
/* Most people here pick 4, so every dialog opens on it and 6 stays one tap away.
 * The 4-digit warning under the length tabs still says why 6 is safer. */
export const DEFAULT_PIN_LENGTH = 4;
const DIGITS = /\d/g;

export function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[character]));
}

function preferredLanguage() {
  if (window.I18N?.lang) return window.I18N.lang;
  try {
    const stored = localStorage.getItem("site_lang");
    if (["lb", "de", "en"].includes(stored)) return stored;
  } catch { /* private mode */ }
  const browser = (navigator.language || "en").slice(0, 2);
  return ["lb", "de"].includes(browser) ? browser : "en";
}

export function translate(key, fallback) {
  try {
    const translated = window.I18N?.t?.(key);
    if (translated && translated !== key) return translated;
  } catch { /* use the dictionary directly */ }
  const entry = window.I18N_DICT?.[key];
  if (!entry) return fallback;
  const language = preferredLanguage();
  return entry[language] || entry.en || fallback;
}

function validLength(value) {
  return ALLOWED_LENGTHS.includes(Number(value))
    ? Number(value)
    : DEFAULT_PIN_LENGTH;
}

function digitsFrom(value, limit) {
  return (String(value || "").match(DIGITS) || [])
    .join("")
    .slice(0, limit);
}

function boxMarkup(index, label) {
  const safeLabel = String(label || "PIN digit")
    .replace(/[&<>"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    }[character]));
  return `<input class="pin-box" type="password" ` +
    `inputmode="numeric" autocomplete="one-time-code" ` +
    `maxlength="1" pattern="[0-9]" ` +
    `aria-label="${safeLabel} ${index + 1}" ` +
    `data-pin-index="${index}">`;
}

function pinInputs(root) {
  return Array.from(root.querySelectorAll(".pin-box"));
}

function focusAt(inputs, index) {
  const bounded = Math.max(0, Math.min(index, inputs.length - 1));
  inputs[bounded]?.focus();
  inputs[bounded]?.select();
}

function readValue(root) {
  return pinInputs(root).map((input) => input.value).join("");
}

function writeValue(root, value) {
  const inputs = pinInputs(root);
  const digits = digitsFrom(value, inputs.length);
  inputs.forEach((input, index) => {
    input.value = digits[index] || "";
  });
  return digits;
}

function nextEmpty(inputs) {
  const index = inputs.findIndex((input) => !input.value);
  return index < 0 ? inputs.length - 1 : index;
}

function handlePaste(event, root, complete) {
  event.preventDefault();
  const text = event.clipboardData?.getData("text") || "";
  const value = writeValue(root, text);
  const inputs = pinInputs(root);
  focusAt(inputs, nextEmpty(inputs));
  if (value.length === inputs.length) complete(value);
}

function handleInput(event, root, complete) {
  const input = event.currentTarget;
  const inputs = pinInputs(root);
  const index = Number(input.dataset.pinIndex);
  const entered = digitsFrom(input.value, inputs.length);
  if (entered.length > 1) {
    const prefix = readValue(root).slice(0, index);
    writeValue(root, prefix + entered);
  } else {
    input.value = entered;
  }
  const value = readValue(root);
  if (value.length === inputs.length) {
    complete(value);
    return;
  }
  if (input.value) focusAt(inputs, index + 1);
}

function handleKey(event, root) {
  const input = event.currentTarget;
  const inputs = pinInputs(root);
  const index = Number(input.dataset.pinIndex);
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    focusAt(inputs, index - 1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    focusAt(inputs, index + 1);
    return;
  }
  if (event.key !== "Backspace" || input.value) return;
  event.preventDefault();
  const previous = inputs[index - 1];
  if (!previous) return;
  previous.value = "";
  focusAt(inputs, index - 1);
}

function wire(root, complete) {
  pinInputs(root).forEach((input) => {
    input.addEventListener("input", (event) => {
      handleInput(event, root, complete);
    });
    input.addEventListener("keydown", (event) => {
      handleKey(event, root);
    });
    input.addEventListener("paste", (event) => {
      handlePaste(event, root, complete);
    });
    input.addEventListener("focus", () => input.select());
  });
}

function render(root, length, label, complete) {
  root.innerHTML = Array.from(
    { length },
    (_, index) => boxMarkup(index, label),
  ).join("");
  wire(root, complete);
}

export function createPinPad(options = {}) {
  const root = document.createElement("div");
  root.className = "pin-pad";
  let length = validLength(options.length);
  let lastCompleted = "";
  const complete = (value) => {
    if (value === lastCompleted) return;
    lastCompleted = value;
    if (typeof options.onComplete === "function") {
      options.onComplete(value);
    }
  };
  const draw = () => {
    lastCompleted = "";
    render(root, length, options.label, complete);
  };
  draw();
  return Object.freeze({
    element: root,
    get length() { return length; },
    value: () => readValue(root),
    focus: () => pinInputs(root)[0]?.focus(),
    clear: () => {
      lastCompleted = "";
      writeValue(root, "");
      pinInputs(root)[0]?.focus();
    },
    setLength: (next) => {
      length = validLength(next);
      draw();
    },
  });
}

export function pinDigits(value, length) {
  return digitsFrom(value, validLength(length));
}
