const BODY_TEXT_RATIO = 4.5;
const UI_RATIO = 3;
const DARK_FOREGROUND = "#000000";
const LIGHT_FOREGROUND = "#ffffff";

function channel(value) {
  const normalised = value / 255;
  return normalised <= 0.04045
    ? normalised / 12.92
    : ((normalised + 0.055) / 1.055) ** 2.4;
}

function expandedHex(value) {
  const raw = String(value || "").trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(raw)) return raw.split("").map((part) => part + part).join("");
  return /^[\da-f]{6}$/i.test(raw) ? raw : null;
}

/** Return WCAG relative luminance for a six- or three-digit hex colour. */
export function relativeLuminance(value) {
  const hex = expandedHex(value);
  if (!hex) throw new TypeError(`Invalid hex colour: ${String(value)}`);
  const parts = hex.match(/.{2}/g).map((part) => channel(Number.parseInt(part, 16)));
  return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
}

/** Calculate the WCAG contrast ratio between two opaque hex colours. */
export function contrastRatio(first, second) {
  const left = relativeLuminance(first);
  const right = relativeLuminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

/** Choose a near-black or near-white foreground that clears the requested ratio. */
export function foregroundFor(background, minimum = BODY_TEXT_RATIO) {
  const darkRatio = contrastRatio(background, DARK_FOREGROUND);
  const lightRatio = contrastRatio(background, LIGHT_FOREGROUND);
  const choice = darkRatio >= lightRatio ? DARK_FOREGROUND : LIGHT_FOREGROUND;
  const ratio = Math.max(darkRatio, lightRatio);
  if (ratio < minimum) throw new Error(`${background} cannot reach ${minimum}:1 with the studio foregrounds.`);
  return choice;
}

/** Mix two opaque hex colours. Weight is the share of the foreground colour. */
export function mixHex(foreground, background, weight) {
  const first = expandedHex(foreground);
  const second = expandedHex(background);
  const amount = Math.min(1, Math.max(0, Number(weight)));
  if (!first || !second || !Number.isFinite(amount)) throw new TypeError("Invalid colour mix.");
  const mixed = first.match(/.{2}/g).map((part, index) => {
    const other = Number.parseInt(second.slice(index * 2, index * 2 + 2), 16);
    return Math.round(Number.parseInt(part, 16) * amount + other * (1 - amount));
  });
  return `#${mixed.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

export function themeContrastValues(palette, accent) {
  const card = palette?.["--card"];
  const background = palette?.["--bg"];
  if (!expandedHex(card) || !expandedHex(background)) throw new TypeError("Theme palette is incomplete.");
  const glass = mixHex(card, background, 0.9);
  return Object.freeze({
    accentForeground: foregroundFor(accent, BODY_TEXT_RATIO),
    accentBorder: contrastRatio(accent, glass) >= UI_RATIO ? accent : foregroundFor(glass, UI_RATIO),
    focusRing: foregroundFor(glass, UI_RATIO),
    glass,
  });
}

/** Apply computed contrast tokens without changing the user's chosen accent. */
export function applyThemeContrast(root, palette, accent) {
  if (!root?.style?.setProperty) throw new TypeError("A styleable theme root is required.");
  const values = themeContrastValues(palette, accent);
  setToken(root, "--accent-foreground", values.accentForeground);
  setToken(root, "--accent-border", values.accentBorder);
  setToken(root, "--focus-ring", values.focusRing);
  setToken(root, "--glass-composite", values.glass);
  return values;
}

function setToken(root, name, value) {
  if (root.style.getPropertyValue(name).trim() === value) return;
  root.style.setProperty(name, value);
}

export const CONTRAST = Object.freeze({
  body: BODY_TEXT_RATIO,
  ui: UI_RATIO,
  darkForeground: DARK_FOREGROUND,
  lightForeground: LIGHT_FOREGROUND,
  glassTintFloor: 0.9,
});
