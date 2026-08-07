const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const DEFAULT_RADIUS_PX = 8;
const DEFAULT_DENSITY = 5;
const DEFAULT_IMAGE_AREA = 0.45;
const DEFAULT_TITLE_SCALE = 1;
const DEFAULT_SCHOOL_YEAR = "4e";
const DEFAULT_AUTHENTICITY = 75;
const FONT_CHOICES = new Set([
  "Calibri", "Aptos", "Georgia", "Garamond", "Helvetica Neue",
  "Avenir Next", "Futura", "Times New Roman", "Verdana", "Trebuchet MS",
]);

const OFFICE = {
  id: "office",
  name: "Office",
  description: "Calibri, blo a propper",
  headlineFont: "Calibri Light",
  bodyFont: "Calibri",
  primary: "#1F497D",
  secondary: "#44546A",
  accent: "#ED7D31",
  accent2: "#4472C4",
  background: "#FFFFFF",
  backgroundLight: "#FFFFFF",
  backgroundDark: "#1F497D",
  text: "#111111",
  textOnLight: "#111111",
  textOnDark: "#FFFFFF",
  footerColor: "#44546A",
  alternating: false,
  chartColors: ["#ED7D31", "#4472C4", "#70AD47", "#A5A5A5"],
};

const APTOS = {
  id: "aptos",
  name: "Aptos",
  description: "Modern, roueg a prezis",
  headlineFont: "Aptos Display",
  bodyFont: "Aptos",
  primary: "#0E2841",
  secondary: "#156082",
  accent: "#E97132",
  accent2: "#156082",
  background: "#FFFFFF",
  backgroundLight: "#FFFFFF",
  backgroundDark: "#0E2841",
  text: "#111111",
  textOnLight: "#111111",
  textOnDark: "#FFFFFF",
  footerColor: "#156082",
  alternating: false,
  chartColors: ["#E97132", "#156082", "#0E2841", "#78A7BA"],
};

const NAVY = {
  id: "navy",
  name: "Navy",
  description: "Georgia, donkelblo a crème",
  headlineFont: "Georgia",
  bodyFont: "Calibri",
  primary: "#1B2A4A",
  secondary: "#33466F",
  accent: "#C8102E",
  accent2: "#C8102E",
  background: "#F5F0E8",
  backgroundLight: "#F5F0E8",
  backgroundDark: "#1B2A4A",
  text: "#111827",
  textOnLight: "#111827",
  textOnDark: "#FFFFFF",
  footerColor: "#999999",
  alternating: true,
  chartColors: ["#C8102E", "#33466F", "#D6A84B", "#7282A4"],
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const STYLE_PACKS = deepFreeze({
  office: OFFICE,
  aptos: APTOS,
  navy: NAVY,
});

export const DEFAULT_STYLE = deepFreeze({
  pack: "office",
  accent: null,
  headlineFont: null,
  bodyFont: null,
  schoolYear: DEFAULT_SCHOOL_YEAR,
  authenticity: DEFAULT_AUTHENTICITY,
  titleScale: DEFAULT_TITLE_SCALE,
  density: DEFAULT_DENSITY,
  imageArea: DEFAULT_IMAGE_AREA,
  radius: DEFAULT_RADIUS_PX,
  alternating: null,
  footer: true,
  photoTreatment: "inset",
});

function finiteNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function packFor(style) {
  const requested = typeof style?.pack === "string" ? style.pack : DEFAULT_STYLE.pack;
  return STYLE_PACKS[requested] || STYLE_PACKS[DEFAULT_STYLE.pack];
}

function validHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function photoTreatment(value) {
  const allowed = new Set(["inset", "rounded", "full-bleed"]);
  return allowed.has(value) ? value : DEFAULT_STYLE.photoTreatment;
}

function fontChoice(value) {
  return FONT_CHOICES.has(value) ? value : null;
}

function schoolYear(value) {
  return new Set(["7e", "6e", "5e", "4e", "3e", "2e", "1ère"]).has(value) ? value : DEFAULT_SCHOOL_YEAR;
}

function overlayFor(style, pack) {
  const input = style && typeof style === "object" ? style : {};
  return {
    accent: validHex(input.accent) ? input.accent.toUpperCase() : pack.accent,
    headlineFont: fontChoice(input.headlineFont),
    bodyFont: fontChoice(input.bodyFont),
    schoolYear: schoolYear(input.schoolYear),
    authenticity: Math.round(finiteNumber(input.authenticity, DEFAULT_AUTHENTICITY, 0, 100)),
    titleScale: finiteNumber(input.titleScale, DEFAULT_STYLE.titleScale, 0.8, 1.3),
    density: Math.round(finiteNumber(input.density, DEFAULT_STYLE.density, 3, 8)),
    imageArea: finiteNumber(input.imageArea, DEFAULT_STYLE.imageArea, 0.25, 0.65),
    radius: finiteNumber(input.radius, DEFAULT_STYLE.radius, 0, 24),
    alternating: typeof input.alternating === "boolean" ? input.alternating : pack.alternating,
    footer: typeof input.footer === "boolean" ? input.footer : DEFAULT_STYLE.footer,
    photoTreatment: photoTreatment(input.photoTreatment),
  };
}

/**
 * Resolve a pack plus the tunable editor overlay into one immutable token set.
 * Rendering modules deliberately know nothing about style-pack inheritance.
 */
export function resolveTokens(style = DEFAULT_STYLE) {
  const pack = packFor(style);
  const overlay = overlayFor(style, pack);
  return deepFreeze({
    pack: pack.id,
    packName: pack.name,
    width: SLIDE_WIDTH_IN,
    height: SLIDE_HEIGHT_IN,
    headlineFont: overlay.headlineFont || pack.headlineFont,
    bodyFont: overlay.bodyFont || pack.bodyFont,
    primary: pack.primary,
    secondary: pack.secondary,
    accent: overlay.accent,
    accent2: pack.accent2,
    background: pack.background,
    backgroundLight: pack.backgroundLight,
    backgroundDark: pack.backgroundDark,
    text: pack.text,
    textOnLight: pack.textOnLight,
    textOnDark: pack.textOnDark,
    footerColor: pack.footerColor,
    chartColors: [overlay.accent, ...pack.chartColors.filter((color) => color !== overlay.accent)],
    alternating: overlay.alternating,
    footer: overlay.footer,
    titleScale: overlay.titleScale,
    density: overlay.density,
    imageArea: overlay.imageArea,
    radius: overlay.radius,
    photoTreatment: overlay.photoTreatment,
    schoolYear: overlay.schoolYear,
    authenticity: overlay.authenticity,
  });
}

export function styleForPack(pack) {
  const requested = STYLE_PACKS[pack] ? pack : DEFAULT_STYLE.pack;
  return deepFreeze({ ...DEFAULT_STYLE, pack: requested });
}

export const CURATED_FONTS = Object.freeze([...FONT_CHOICES]);
