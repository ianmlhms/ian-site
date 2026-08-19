const ALLOWED_LENGTHS = Object.freeze([4, 6]);
/* Most people here pick 4, so every dialog opens on it and 6 stays one tap away.
 * The 4-digit warning under the length tabs still says why 6 is safer. */
export const DEFAULT_PIN_LENGTH = 4;
const DIGITS = /\d/g;
const COMMON_4 = new Set([
  "1234", "1111", "0000", "1212", "7777",
  "1004", "2000", "4444", "2222", "6969",
  "9999", "3333", "5555", "6666", "1122",
  "1313", "8888", "2001", "4321", "1010",
  "0909", "2580", "0007", "1818", "1230",
  "1984", "1986", "0070", "1985", "0987",
  "1000", "1231", "1987", "1999", "2468",
  "2002", "2323", "0123", "1123", "1233",
  "1357", "1221", "1324", "1988", "2112",
  "2121", "5150", "1024", "1112", "1224",
  "1969", "1225", "1235", "1982", "1983",
  "1001", "1978", "1979", "7410", "1020",
  "1223", "1974", "1975", "1977", "1980",
  "1981", "1029", "1121", "1213", "1973",
  "1976", "2020", "2345", "2424", "2525",
  "1515", "1970", "1972", "1989", "0001",
  "1023", "1414", "9876", "0101", "0907",
  "1245", "1966", "1967", "1971", "8520",
  "1964", "1968", "4545", "1318", "5678",
  "1011", "1124", "1211", "1963", "4200",
]);
const COMMON_6 = new Set([
  "123456", "696969", "111111", "654321",
  "123123", "666666", "121212", "131313",
  "000000", "112233", "222222", "777777",
  "987654", "232323", "555555", "123321",
  "999999", "333333", "888888", "444444",
  "101010", "420420", "147147", "212121",
  "242424", "007007", "123654", "789456",
  "252525", "159753", "141414", "202020",
  "151515", "323232", "314159", "246810",
  "111222", "181818", "171717", "147258",
  "102030", "363636", "343434", "454545",
  "424242", "272727", "098765", "159357",
  "147852", "191919",
]);

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

function allSame(value) {
  return Boolean(value) && value.split("")
    .every((digit) => digit === value[0]);
}

function run(value) {
  return "01234567890".includes(value) ||
    "09876543210".includes(value);
}

function repeatedChunk(value) {
  for (let size = 1; size <= value.length / 2; size += 1) {
    if (value.length % size !== 0) continue;
    const chunk = value.slice(0, size);
    if (chunk.repeat(value.length / size) === value) return true;
  }
  return false;
}

function repeatedGroups(value) {
  return [2, 3].some((size) => {
    if (value.length % size !== 0) return false;
    const groups = value.match(new RegExp(`.{${size}}`, "g")) || [];
    return groups.length > 1 && groups.every(allSame);
  });
}

function leapYear(year) {
  return year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);
}

function validDate(day, month, year) {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [
    31, leapYear(year) ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31,
  ];
  return day <= days[month - 1];
}

function datePin(value) {
  if (!/^\d{6}$/.test(value)) return false;
  const first = Number(value.slice(0, 2));
  const second = Number(value.slice(2, 4));
  const year = 2000 + Number(value.slice(4));
  return validDate(first, second, year) ||
    validDate(second, first, year);
}

export function weakPin(value) {
  const pin = String(value || "");
  if (COMMON_4.has(pin) || COMMON_6.has(pin)) return true;
  if (run(pin) || repeatedChunk(pin)) return true;
  if (repeatedGroups(pin)) return true;
  if (/^(19|20)\d{2}$/.test(pin)) return true;
  return datePin(pin);
}
