/* Shared numeric score display. Keep exact server strings for titles and expansion. */
import "./i18n-dict.js?v=50";

const COMPACT_MIN = 10_000;
/* K..Dc (1e3..1e33) match the idle games' own number format. Above that the score is shown in scientific
 * notation (1.23e45): the arcade accepts any finite score up to 1e300. */
const SUFFIXES = Object.freeze(["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"]);
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

export function arcadeText(key, values = {}) {
  let lang = window.I18N?.lang;
  if (!lang) {
    try { lang = localStorage.getItem("site_lang"); }
    catch (error) { console.warn("[Arcade] score language unavailable", error); }
  }
  const entry = window.I18N_DICT?.[key];
  const copy = entry?.[lang] || entry?.lb || key;
  return copy.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}

/** 1.2345e+45 -> "1.23e45" (three significant digits, no plus sign). */
function scientific(number, digits = 3) {
  return number.toExponential(digits - 1).replace(/\.?0+e/, "e").replace("e+", "e");
}

export function compactScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  if (Math.abs(number) < COMPACT_MIN) {
    const [integer, fraction] = String(value).split(".");
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009") + (fraction ? "." + fraction : "");
  }
  const lastUnit = SUFFIXES.length - 1;
  let unit = Math.floor(Math.log10(Math.abs(number)) / 3);
  if (unit > lastUnit) return scientific(number);
  let scaled = Number((number / 1000 ** unit).toPrecision(3));
  if (Math.abs(scaled) >= 1000) {   // 999.6K -> 1M
    if (unit === lastUnit) return scientific(number);
    unit += 1;
    scaled = Number((number / 1000 ** unit).toPrecision(3));
  }
  return scaled + SUFFIXES[unit];
}

/** "185468747281" -> "185 468 747 281" (thin spaces), for the expanded/full view. From 1e21 on JavaScript prints
 * exponent form, which is shown as 1.5e45 instead of a digit string no double can honour anyway. */
function groupDigits(value) {
  let text = String(value ?? "");
  if (/e/i.test(text) && Math.abs(Number(text)) < 1e21) text = String(Number(text));   // "8.7e+15" -> "8700000000000000"
  const [integer, fraction] = text.split(".");
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) return scientific(Number(text), 6);
  if (!/^-?\d+$/.test(integer)) return text;
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009") + (fraction ? "." + fraction : "");
}

export function isCompactScore(value) {
  return Number.isFinite(Number(value)) && Math.abs(Number(value)) >= COMPACT_MIN;
}

function installScoreUi() {
  if (document.getElementById("score-format-styles")) return;
  const style = document.createElement("style");
  style.id = "score-format-styles";
  style.textContent = `.score-number{font-variant-numeric:tabular-nums;text-align:right}
    button.score-number{all:unset;box-sizing:border-box;display:inline;color:inherit;font:inherit;line-height:inherit;font-variant-numeric:tabular-nums;text-align:right;cursor:pointer;white-space:nowrap;border-radius:4px}
    button.score-number:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .score-key{color:var(--muted,var(--text2));font:400 11px/1.5 system-ui;margin:8px 0 0;overflow-wrap:anywhere}`;
  document.head.appendChild(style);
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-score-full]");
    if (!button) return;
    const full = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(full));
    button.textContent = full ? button.dataset.scoreFull : button.dataset.scoreCompact;
  });
}

export function scoreHtml(value) {
  installScoreUi();
  const exact = escapeHtml(groupDigits(value));
  const compact = escapeHtml(compactScore(value));
  if (!isCompactScore(value)) return `<span class="score-number" title="${exact}">${compact}</span>`;
  return `<button type="button" class="score-number" title="${exact}" aria-label="${escapeHtml(arcadeText("score.toggle"))}: ${exact}" aria-pressed="false" data-score-full="${exact}" data-score-compact="${compact}">${compact}</button>`;
}

export function scoreKeyHtml(values) {
  return values.some(isCompactScore) ? `<p class="score-key">${escapeHtml(arcadeText("score.key"))}</p>` : "";
}
