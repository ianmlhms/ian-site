/* advent-util.js — small helpers shared by the Adventskalenner (advent.js, advent-kinds.js, advent-games.js).
 * Everything that touches server strings goes through el() (textContent), never innerHTML. */

export const DOOR_COUNT = 24;
export const DEFAULT_ERROR = "Eppes ass schifgaang. Probéier nach eng Kéier.";

/* "advent: name taken" -> short Luxembourgish message */
const ERROR_TEXT = {
  "bad name": "Dësen Numm geet net. 2 bis 20 Zeechen: Buschtawen, Zuelen, Espace, . _ ' -",
  "name taken": "Dësen Numm gëtt et schonn. Huel en aneren.",
  "full": "Leider si keng Plaze méi fräi.",
  "no username": "Däi ian.lu-Kont huet nach kee Benotzernumm.",
  "locked": "Dës Dier ass nach zou.",
  "not ready": "De Kalenner ass nach net prett. Probéier méi spéit.",
  "join first": "Maach fir d'éischt mat.",
  "open the door first": "Maach d'Dier fir d'éischt op.",
  "bad day": "Dës Dier gëtt et net.",
  "bad answer": "Dës Äntwert ass net valabel.",
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
    else if (key === "style") node.style.cssText = value;
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

/* Only http(s) links from server content are ever put into href/src. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value), location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
}

/* credit line: "Foto: Name" with optional link */
export function creditNode(image) {
  const credit = String(image?.credit || "").trim();
  if (!credit) return null;
  const link = safeUrl(image?.link);
  const label = link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: credit }) : credit;
  return el("p", { class: "adv-credit" }, "Bild: ", label);
}

/* ---------- storage (every access can throw: private windows, blocked site data) ---------- */
function safely(read) {
  try { return read(); } catch (error) { console.warn("[advent] storage unavailable", error); return null; }
}
export const store = {
  get: (key) => safely(() => localStorage.getItem(key)),
  set: (key, value) => safely(() => localStorage.setItem(key, value)),
  remove: (key) => safely(() => localStorage.removeItem(key)),
};
export const session = {
  get: (key) => safely(() => sessionStorage.getItem(key)),
  set: (key, value) => safely(() => sessionStorage.setItem(key, value)),
};

export function readJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/* ---------- content validation ---------- */
export function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = readJson(value, null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return {};
}

export const asArray = (value) => (Array.isArray(value) ? value : []);

/* ---------- time ---------- */
const pad2 = (n) => String(n).padStart(2, "0");

/* 83 -> "1:23", 3725 -> "1:02:05" */
export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ms until a door opens -> "2 Deeg 3 Stonnen" / "3 Stonnen 12 Minutten" / "12 Minutten 5 Sekonnen" / "42 Sekonnen" */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${plural(days, "Dag", "Deeg")} ${plural(hours, "Stonn", "Stonnen")}`;
  if (hours > 0) return `${plural(hours, "Stonn", "Stonnen")} ${plural(minutes, "Minutt", "Minutten")}`;
  if (minutes > 0) return `${plural(minutes, "Minutt", "Minutten")} ${plural(seconds, "Sekonn", "Sekonnen")}`;
  return plural(seconds, "Sekonn", "Sekonnen");
}

export const penaltyText = (seconds) => {
  const s = Math.round(Number(seconds) || 60);
  return s % 60 === 0 ? `+${plural(s / 60, "Minutt", "Minutten")}` : `+${plural(s, "Sekonn", "Sekonnen")}`;
};

export const waitText = (seconds) => `Waart nach ${plural(Math.max(1, Math.ceil(Number(seconds) || 1)), "Sekonn", "Sekonnen")}`;

export function parseServerTime(value) {
  const ms = typeof value === "number" ? value * (value < 1e11 ? 1000 : 1) : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : NaN;
}

/* ---------- name rule (mirrors the server: 2–20 chars, letters incl. accents, digits, space . _ ' -) ---------- */
export const NAME_PATTERN = /^[\p{L}\p{N} ._'-]{2,20}$/u;
export const isValidName = (name) => NAME_PATTERN.test(name) && name.trim() === name;
