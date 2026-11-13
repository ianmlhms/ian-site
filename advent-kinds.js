/* advent-kinds.js — the answer UIs of the Adventskalenner doors (simple kinds).
 * createKind(kind, content, ctx) -> { node, getGiven(), isReady(), submitLabel? }
 *   ctx.changed()  tell the door view that the answer state changed (enables/disables the submit button)
 *   ctx.submit()   submit now (Enter in a text field)
 * The map / wordsearch / slider kinds live in advent-games.js. Nothing here knows an answer: the client only
 * collects what the player entered. All server strings are set with textContent. */
import { el, asArray, asObject } from "./advent-util.js?v=1";
import { createMapKind, createWordsearchKind, createSliderKind } from "./advent-games.js?v=1";

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CIPHER_SHIFTS = 26;
const LOCK_BASE = 10;

/* ---------- text ---------- */
export function createTextInput(ctx, { placeholder = "Deng Äntwert", inputMode } = {}) {
  const input = el("input", {
    class: "gt-input adv-input", type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off",
    spellcheck: "false", maxlength: "200", placeholder, "aria-label": placeholder, ...(inputMode ? { inputmode: inputMode } : {}),
  });
  input.addEventListener("input", () => ctx.changed());
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); ctx.submit(); } });
  return input;
}

function createTextKind(content, ctx) {
  const input = createTextInput(ctx);
  return {
    node: el("div", { class: "adv-kind" }, input),
    getGiven: () => ({ text: input.value.trim() }),
    isReady: () => input.value.trim().length > 0,
  };
}

/* ---------- number ---------- */
function createNumberKind(content, ctx) {
  const input = createTextInput(ctx, { placeholder: "Zuel", inputMode: "decimal" });
  const unit = String(content.unit || "").trim();
  const normalised = () => input.value.trim().replace(",", ".");
  return {
    node: el("div", { class: "adv-kind adv-number" }, input, unit ? el("span", { class: "adv-unit", text: unit }) : null),
    getGiven: () => ({ n: normalised() }),
    isReady: () => /^-?\d+(\.\d+)?$/.test(normalised()),
  };
}

/* ---------- choice ---------- */
function createChoiceKind(content, ctx) {
  const options = asArray(content.options).filter((o) => o && o.id != null);
  let chosen = null;
  const buttons = options.map((option) => el("button", {
    type: "button", class: "adv-choice", role: "radio", "aria-checked": "false", text: String(option.label ?? option.id),
    on: { click: () => { chosen = String(option.id); paint(); ctx.changed(); } },
    data: { id: String(option.id) },
  }));
  function paint() {
    buttons.forEach((button) => {
      const on = button.dataset.id === chosen;
      button.classList.toggle("on", on);
      button.setAttribute("aria-checked", String(on));
    });
  }
  return {
    node: el("div", { class: "adv-kind adv-choices", role: "radiogroup" }, buttons),
    getGiven: () => ({ choice: chosen }),
    isReady: () => chosen !== null,
  };
}

/* ---------- order ---------- */
function createOrderKind(content, ctx) {
  const items = asArray(content.items).filter((i) => i && i.id != null);
  const labels = new Map(items.map((i) => [String(i.id), String(i.label ?? i.id)]));
  let ids = items.map((i) => String(i.id));
  const list = el("ol", { class: "adv-order" });
  const hint = String(content.order_hint || "").trim();

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    ids = next;
    draw(`${ids[target]}:${delta < 0 ? "up" : "down"}`);
    ctx.changed();
  }

  function row(id, index) {
    const label = labels.get(id);
    const button = (dir, symbol, text) => el("button", {
      type: "button", class: "adv-move", text: symbol, "aria-label": `${label}: ${text}`,
      disabled: dir === "up" ? index === 0 : index === ids.length - 1,
      data: { focus: `${id}:${dir}` }, on: { click: () => move(index, dir === "up" ? -1 : 1) },
    });
    return el("li", { class: "adv-order-row" },
      el("span", { class: "adv-order-n", text: String(index + 1) }),
      el("span", { class: "adv-order-label", text: label }),
      button("up", "▲", "no uewen"), button("down", "▼", "no ënnen"));
  }

  function draw(focusKey) {
    list.replaceChildren(...ids.map(row));
    if (!focusKey) return;
    const target = list.querySelector(`[data-focus="${CSS.escape(focusKey)}"]:not([disabled])`)
      || list.querySelector(`[data-focus^="${CSS.escape(focusKey.split(":")[0])}:"]:not([disabled])`);
    target?.focus();
  }
  draw();
  return {
    node: el("div", { class: "adv-kind" }, hint ? el("p", { class: "adv-order-hint", text: hint }) : null, list),
    getGiven: () => ({ order: [...ids] }),
    isReady: () => ids.length > 0,
  };
}

/* ---------- lock ---------- */
function createLockKind(content, ctx) {
  const count = Math.min(8, Math.max(1, Math.round(Number(content.digits)) || 3));
  let digits = Array(count).fill(0);
  const wheels = digits.map((_, index) => {
    const value = el("output", { class: "adv-wheel-digit", "aria-live": "polite", text: "0" });
    const step = (delta) => {
      digits = digits.map((d, i) => (i === index ? (d + delta + LOCK_BASE) % LOCK_BASE : d));
      value.textContent = String(digits[index]);
      ctx.changed();
    };
    const arrow = (delta, symbol, text) => el("button", {
      type: "button", class: "adv-wheel-btn", text: symbol, "aria-label": `Rad ${index + 1}: ${text}`, on: { click: () => step(delta) },
    });
    return { value, node: el("div", { class: "adv-wheel" }, arrow(1, "▲", "méi"), value, arrow(-1, "▼", "manner")) };
  });
  const clues = asArray(content.clues).filter((c) => c && c.code != null);
  return {
    node: el("div", { class: "adv-kind adv-lock" },
      clues.length ? el("ul", { class: "adv-clues" }, clues.map((clue) => el("li", {},
        el("span", { class: "adv-clue-code", text: String(clue.code) }), el("span", { text: String(clue.text ?? "") })))) : null,
      el("div", { class: "adv-wheels", role: "group", "aria-label": "Zuelenschlass" }, wheels.map((w) => w.node))),
    getGiven: () => ({ text: digits.join("") }),
    isReady: () => true,
  };
}

/* ---------- cipher ---------- */
export function caesarShift(text, shift) {
  return [...String(text)].map((char) => {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return char;
    return String.fromCharCode(65 + ((code - 65 - shift) % CIPHER_SHIFTS + CIPHER_SHIFTS) % CIPHER_SHIFTS);
  }).join("");
}

function wheelRing(radius, className) {
  const group = svgEl("g", { class: className });
  const step = 360 / CIPHER_SHIFTS;
  [...LETTERS].forEach((letter, index) => {
    const text = svgEl("text", {
      transform: `rotate(${index * step}) translate(0 ${-radius})`, "text-anchor": "middle", "dominant-baseline": "central", class: "adv-wheel-letter",
    });
    text.textContent = letter;
    group.append(text);
  });
  return group;
}

function createCipherKind(content, ctx) {
  const cipher = String(content.cipher || "").toUpperCase();
  let shift = 0;
  const input = createTextInput(ctx);
  const preview = el("p", { class: "adv-decoded", "aria-live": "polite" });
  const shiftLabel = el("span", { class: "adv-shift", text: "0" });
  const inner = wheelRing(78, "adv-ring-inner");
  const svg = svgEl("svg", { viewBox: "0 0 300 300", class: "adv-wheel-svg", role: "img", "aria-label": "Chiffrierrad" });
  const center = svgEl("g", { transform: "translate(150 150)" });
  center.append(
    svgEl("circle", { r: 142, class: "adv-ring-line" }), svgEl("circle", { r: 112, class: "adv-ring-line" }), svgEl("circle", { r: 46, class: "adv-ring-line" }),
    wheelRing(127, "adv-ring-outer"), inner,
    svgEl("path", { d: "M -7 -148 L 7 -148 L 0 -138 Z", class: "adv-ring-mark" }));
  svg.append(center);

  function paint() {
    inner.setAttribute("transform", `rotate(${shift * (360 / CIPHER_SHIFTS)})`);
    shiftLabel.textContent = String(shift);
    range.value = String(shift);
    preview.textContent = caesarShift(cipher, shift);
  }
  const setShift = (value) => { shift = ((value % CIPHER_SHIFTS) + CIPHER_SHIFTS) % CIPHER_SHIFTS; paint(); };
  const range = el("input", { type: "range", min: "0", max: String(CIPHER_SHIFTS - 1), step: "1", value: "0", class: "adv-range", "aria-label": "Verschibung",
    on: { input: () => setShift(Number(range.value)) } });
  const stepper = (delta, symbol, text) => el("button", { type: "button", class: "adv-step", text: symbol, "aria-label": text, on: { click: () => setShift(shift + delta) } });
  paint();
  return {
    node: el("div", { class: "adv-kind adv-cipher" },
      el("p", { class: "adv-cipher-text", text: cipher }),
      svg,
      el("div", { class: "adv-shift-row" }, stepper(-1, "−", "Ee Schrëtt zréck"), range, stepper(1, "+", "Ee Schrëtt viir"), el("span", { class: "adv-shift-wrap" }, "Verschibung ", shiftLabel)),
      el("p", { class: "adv-small", text: "Entschlësselt:" }), preview,
      input),
    getGiven: () => ({ text: input.value.trim() }),
    isReady: () => input.value.trim().length > 0,
  };
}

/* ---------- sudoku ---------- */
export function sudokuConflicts(cells, size, boxRows, boxCols) {
  const bad = new Set();
  const box = (i) => Math.floor(Math.floor(i / size) / boxRows) * 100 + Math.floor((i % size) / boxCols);
  for (let a = 0; a < cells.length; a++) {
    if (!cells[a]) continue;
    for (let b = a + 1; b < cells.length; b++) {
      if (cells[a] !== cells[b]) continue;
      const sameRow = Math.floor(a / size) === Math.floor(b / size);
      const sameCol = a % size === b % size;
      if (sameRow || sameCol || box(a) === box(b)) { bad.add(a); bad.add(b); }
    }
  }
  return bad;
}

function createSudokuKind(content, ctx) {
  const size = Math.min(9, Math.max(4, Math.round(Number(content.size)) || 6));
  const [boxRows, boxCols] = asArray(content.box).length === 2 ? asArray(content.box).map((n) => Math.max(1, Math.round(Number(n)) || 1)) : [2, 3];
  const starRow = Math.min(size - 1, Math.max(0, Math.round(Number(content.star_row)) || 0));
  const rows = asArray(content.grid);
  const givens = Array.from({ length: size * size }, (_, i) => {
    const ch = String(rows[Math.floor(i / size)] ?? "").charAt(i % size);
    return /^[1-9]$/.test(ch) && Number(ch) <= size ? ch : "";
  });
  let cells = [...givens];
  let selected = -1;

  const nodes = cells.map((_, i) => {
    const r = Math.floor(i / size), c = i % size;
    return el("button", {
      type: "button", class: `adv-cell${givens[i] ? " given" : ""}${r === starRow ? " star" : ""}${(c + 1) % boxCols === 0 && c < size - 1 ? " box-r" : ""}${(r + 1) % boxRows === 0 && r < size - 1 ? " box-b" : ""}`,
      on: { click: () => { selected = i; paint(); } },
    });
  });
  function paint() {
    const bad = sudokuConflicts(cells, size, boxRows, boxCols);
    nodes.forEach((node, i) => {
      node.textContent = cells[i];
      node.classList.toggle("sel", i === selected);
      node.classList.toggle("bad", bad.has(i));
      const r = Math.floor(i / size) + 1, c = (i % size) + 1;
      node.setAttribute("aria-label", `Reih ${r}, Spalt ${c}, ${cells[i] || "eidel"}${givens[i] ? ", virgi" : ""}${bad.has(i) ? ", Konflikt" : ""}`);
    });
  }
  function setCell(value) {
    if (selected < 0 || givens[selected]) return;
    cells = cells.map((v, i) => (i === selected ? value : v));
    paint();
    ctx.changed();
  }
  const pad = [...Array(size).keys()].map((n) => el("button", { type: "button", class: "adv-pad-key", text: String(n + 1), on: { click: () => setCell(String(n + 1)) } }));
  pad.push(el("button", { type: "button", class: "adv-pad-key", text: "⌫", "aria-label": "Läschen", on: { click: () => setCell("") } }));
  const grid = el("div", { class: "adv-sudoku", style: `--n:${size}`, role: "group", "aria-label": "Sudoku",
    on: { keydown: (event) => {
      if (/^[1-9]$/.test(event.key) && Number(event.key) <= size) setCell(event.key);
      else if (event.key === "Backspace" || event.key === "Delete") setCell("");
    } } }, nodes);
  const rowText = () => cells.slice(starRow * size, starRow * size + size);
  paint();
  return {
    node: el("div", { class: "adv-kind" },
      el("p", { class: "adv-small", text: "Fëll déi markéiert Reih (★) aus. Tipp eng Case, dann eng Zuel." }),
      grid, el("div", { class: "adv-pad" }, pad)),
    getGiven: () => ({ text: rowText().join("") }),
    isReady: () => rowText().every(Boolean),
    submitLabel: "Rei ofginn",
  };
}

/* ---------- registry ---------- */
const KINDS = {
  text: createTextKind,
  number: createNumberKind,
  choice: createChoiceKind,
  order: createOrderKind,
  lock: createLockKind,
  cipher: createCipherKind,
  sudoku: createSudokuKind,
  map: createMapKind,
  wordsearch: createWordsearchKind,
  slider: createSliderKind,
};

export const KIND_NAMES = Object.keys(KINDS);

export function createKind(kind, rawContent, ctx) {
  const content = asObject(rawContent);
  const factory = KINDS[kind] || createTextKind;   // unknown kind -> plain text answer
  return factory(content, { ...ctx, day: ctx.day, createTextInput: (options) => createTextInput(ctx, options) });
}
