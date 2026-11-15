/* advent-util.js — small pure helpers for the Adventskalenner (advent.js): DOM builder, Luxembourgish number format,
 * countdown text, error mapping. Server strings only ever go through el() (textContent), never innerHTML. */

export const DOOR_COUNT = 24;
export const DEFAULT_ERROR = "Eppes ass schifgaang. Probéier nach eng Kéier.";

/* "advent: locked" -> short Luxembourgish message */
const ERROR_TEXT = {
  signin: "Mell dech fir d'éischt un.",
  day: "Dës Dier gëtt et net.",
  locked: "Dës Dier ass nach zou.",
  over: "De Kalenner ass eriwwer. Dës Dier geet net méi op.",
};

export class AdventError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdventError";
    const match = /advent:\s*(.+)$/i.exec(String(message || ""));
    this.code = match ? match[1].trim().toLowerCase() : "";
  }
}

export const errorText = (error) => ERROR_TEXT[error?.code] || DEFAULT_ERROR;

/* The four gift games: display name, what the gift is, where to play (pixelbreak.html?g=<id>). */
export const GAMES = Object.freeze({
  "cookie-clicker": { name: "Cookie Clicker", unit: "Cookien", emoji: "🍪" },
  "bus-tycoon": { name: "Bus Tycoon", unit: "Passagéier", emoji: "🚌" },
  "idle-empire": { name: "Business Empire", unit: "Cash", emoji: "💰" },
  "park": { name: "Schueberfouer Tycoon", unit: "Suen", emoji: "🎡" },
});
export const gameInfo = (id) => GAMES[id] || { name: String(id || "Spill"), unit: "", emoji: "🎁" };
export const gameUrl = (id) => (GAMES[id] ? `pixelbreak.html?g=${id}` : "pixelbreak.html");

/* ---------- DOM ---------- */
/* el("button", { class: "x", text: "Hi", on: { click: fn }, aria: { label: "…" }, data: { day: 3 }, type: "button" }, ...children) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "on") for (const [name, handler] of Object.entries(value)) node.addEventListener(name, handler);
    else if (key === "aria") for (const [name, val] of Object.entries(value)) node.setAttribute(`aria-${name}`, String(val));
    else if (key === "data") for (const [name, val] of Object.entries(value)) node.dataset[name] = String(val);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => { node.replaceChildren(); return node; };
export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/* ---------- storage (every access can throw: private windows, blocked site data) ---------- */
export const store = {
  remove(key) { try { localStorage.removeItem(key); } catch (error) { console.warn("[advent] storage unavailable", error); } },
};

/* ---------- numbers ---------- */
/* Luxembourgish uses the long scale: 1e6 Millioun, 1e9 Milliard, 1e12 Billioun, 1e15 Billiard, 1e18 Trillioun … */
const SCALE_NAMES = ["Millioun", "Milliard", "Billioun", "Billiard", "Trillioun", "Trilliard", "Quadrillioun", "Quadrilliard",
  "Quintillioun", "Quintilliard", "Sextillioun", "Sextilliard", "Septillioun", "Septilliard", "Oktillioun", "Oktilliard",
  "Nonillioun", "Nonilliard", "Dezillioun"];   // first = 1e6, last = 1e60
const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n) => String(n).replace(/\d/g, (c) => SUPERSCRIPT[c]);
const NBSP = " ";

/* 3 significant digits, decimal comma, no trailing zeros: 6.03 -> "6,03", 12 -> "12", 100.4 -> "100" */
const mantissa = (value) => String(Number(value.toPrecision(3))).replace(".", ",");
const round3 = (value) => Number(value.toPrecision(3));

/* 6.03e12 -> "6,03 Billiounen"; 12345 -> "12 345"; 1e220 -> "1 × 10²²⁰". Never raw exponent text. */
export function formatAmount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1e6) return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  let index = Math.floor(Math.log10(value) / 3) - 2;      // 0 = Millioun (1e6)
  let scaled = value / 10 ** (3 * (index + 2));
  if (round3(scaled) >= 1000) { index += 1; scaled = value / 10 ** (3 * (index + 2)); }
  if (index < SCALE_NAMES.length) {
    const name = SCALE_NAMES[index];
    return `${mantissa(scaled)}${NBSP}${round3(scaled) === 1 ? name : `${name}en`}`;
  }
  let exp = Math.floor(Math.log10(value));
  if (round3(value / 10 ** exp) >= 10) exp += 1;
  return `${mantissa(value / 10 ** exp)}${NBSP}×${NBSP}10${sup(exp)}`;
}

/* ---------- time ---------- */
const count = (n, one, many) => `${n}${NBSP}${n === 1 ? one : many}`;

/* ms -> "3 Deeg 5 Stonnen" / "5 Stonnen 3 Minutten" / "3 Minutten 12 Sekonnen" / "42 Sekonnen" */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${count(days, "Dag", "Deeg")} ${count(hours, "Stonn", "Stonnen")}`;
  if (hours > 0) return `${count(hours, "Stonn", "Stonnen")} ${count(minutes, "Minutt", "Minutten")}`;
  if (minutes > 0) return `${count(minutes, "Minutt", "Minutten")} ${count(seconds, "Sekonn", "Sekonnen")}`;
  return count(seconds, "Sekonn", "Sekonnen");
}

export function parseServerTime(value) {
  const ms = typeof value === "number" ? value * (value < 1e11 ? 1000 : 1) : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : NaN;
}
