const BODY_PT = 20;
const BODY_LINE_SPACING = 1.16;
const AVERAGE_CHARACTER_EM = 0.5;

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function safeText(value) {
  return typeof value === "string" ? value : "";
}

export function estimatedLines(text, width, size) {
  const averageCharacterIn = size / 72 * AVERAGE_CHARACTER_EM;
  const charactersPerLine = Math.max(1, Math.floor(width / averageCharacterIn));
  return safeText(text).split("\n").reduce((sum, line) =>
    sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

export function fitTextSize(text, preferred, minimum, width, height, spacing, step) {
  let size = preferred;
  while (size > minimum) {
    const requiredHeight = estimatedLines(text, width, size) * (size / 72) * spacing;
    if (requiredHeight <= height) return size;
    size -= step;
  }
  return minimum;
}

export function textBox(text, x, y, w, h, options = {}) {
  return {
    kind: "text", x, y, w, h, text: safeText(text),
    font: options.font || "Calibri", size: options.size || BODY_PT,
    bold: Boolean(options.bold), italic: Boolean(options.italic),
    color: options.color || "#111111", align: options.align || "left",
    valign: options.valign || "top", lineSpacing: options.lineSpacing || BODY_LINE_SPACING,
    charSpacing: options.charSpacing || 0, bullet: Boolean(options.bullet),
  };
}

export function imageBox(url, x, y, w, h, radius) {
  return { kind: "image", x, y, w, h, url: url || null, radius, fit: "cover" };
}

export function rectBox(x, y, w, h, fill, radius = 0, opacity = 1) {
  return { kind: "rect", x, y, w, h, fill, radius, opacity };
}

export function chartBox(chart, x, y, w, h, colors) {
  return { kind: "chart", x, y, w, h, chart, colors };
}
