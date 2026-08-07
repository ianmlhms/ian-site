const DECK_VERSION = 1;
const DEFAULT_LANG = "de";
const DEFAULT_LAYOUT = "bullets";
const DEFAULT_SLIDE_TITLE = "Ouni Titel";
const MIN_SLIDES = 1;
const MAX_SLIDES = 60;
const ALLOWED_LANGS = new Set(["lb", "de", "en", "fr"]);
const ALLOWED_LAYOUTS = new Set([
  "title", "toc", "bullets", "bullets-image", "image-full",
  "photo-numbered", "example", "sources", "closing", "chart", "quiz", "section",
]);
const CHART_TYPES = new Set(["bar", "line", "pie"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableString(value) {
  const text = stringValue(value);
  return text || null;
}

function stringArray(value, maximum = 100) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean).slice(0, maximum);
}

function pairArray(value, first, second, maximum) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const left = stringValue(item[first]);
    const right = stringValue(item[second]);
    if (!left && !right) return [];
    return [{ [first]: left, [second]: right }];
  }).slice(0, maximum);
}

function httpUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

function normaliseImage(value) {
  if (!value || typeof value !== "object") return null;
  const url = httpUrl(value.url);
  const thumb = httpUrl(value.thumb) || url;
  const link = httpUrl(value.link) || url;
  const credit = stringValue(value.credit);
  const source = value.source === "pexels" || value.source === "wikimedia" ? value.source : null;
  if (!url || !thumb || !link || !credit || !source) return null;
  return { url, thumb, credit, source, link };
}

function finiteValues(value) {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "number" && Number.isFinite(item)) ? [...value] : null;
}

export function normaliseChart(value) {
  if (!value || typeof value !== "object" || !CHART_TYPES.has(value.type)) return null;
  const categories = stringArray(value.categories, 20);
  if (!categories.length || !Array.isArray(value.series) || !value.series.length) return null;
  if (value.type === "pie" && value.series.length !== 1) return null;
  const series = value.series.slice(0, 8).flatMap((item) => {
    const values = finiteValues(item?.values);
    const name = stringValue(item?.name);
    return name && values?.length === categories.length ? [{ name, values }] : [];
  });
  if (series.length !== Math.min(8, value.series.length)) return null;
  return { type: value.type, title: stringValue(value.title), categories,
    series, unit: stringValue(value.unit) };
}

function normaliseQuiz(value) {
  if (!value || typeof value !== "object") return null;
  const question = stringValue(value.question);
  const options = stringArray(value.options, 4);
  const answerIndex = Number(value.answerIndex);
  if (!question || options.length < 3 || options.length > 4) return null;
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return null;
  return { question, options, answerIndex };
}

function stableId(rawId, index, usedIds) {
  const candidate = stringValue(rawId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (candidate && !usedIds.includes(candidate)) return candidate;
  let id = `s${index + 1}`;
  let suffix = 1;
  while (usedIds.includes(id)) { suffix += 1; id = `s${index + 1}-${suffix}`; }
  return id;
}

function normaliseSlide(raw, index, usedIds) {
  const source = raw && typeof raw === "object" ? raw : {};
  const chart = normaliseChart(source.chart);
  const quiz = normaliseQuiz(source.quiz);
  const requested = ALLOWED_LAYOUTS.has(source.layout) ? source.layout : DEFAULT_LAYOUT;
  const layout = requested === "chart" && !chart || requested === "quiz" && !quiz ? DEFAULT_LAYOUT : requested;
  return {
    id: stableId(source.id, index, usedIds), layout,
    section: nullableString(source.section), presenter: nullableString(source.presenter),
    title: stringValue(source.title, DEFAULT_SLIDE_TITLE) || DEFAULT_SLIDE_TITLE,
    bullets: stringArray(source.bullets, 12), caption: nullableString(source.caption),
    fields: pairArray(source.fields, "label", "value", 10),
    sources: pairArray(source.sources, "text", "accessed", 40),
    chart, quiz, imageQuery: nullableString(source.imageQuery),
    image: normaliseImage(source.image), notes: stringValue(source.notes),
  };
}

function sourceDeck(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("D'AI huet keng gëlteg Präsentatioun zeréckginn.");
  }
  if (!Array.isArray(raw.slides)) throw new Error("D'AI-Äntwert enthält keng Slides.");
  if (raw.slides.length < MIN_SLIDES) throw new Error("D'AI-Äntwert enthält keng Slide.");
  if (raw.slides.length > MAX_SLIDES) throw new Error("D'AI-Äntwert enthält ze vill Slides.");
  const invalid = raw.slides.findIndex((slide) => !slide || typeof slide !== "object"
    || Array.isArray(slide) || typeof slide.title !== "string");
  if (invalid >= 0) throw new Error(`Slide ${invalid + 1} ass ongëlteg.`);
  return raw;
}

export function validateSlide(raw, fallbackId = "s1") {
  const slide = normaliseSlide({ ...raw, id: fallbackId }, 0, []);
  return deepFreeze(slide);
}

/** Strict boundary validator that returns a normalised, recursively frozen deck. */
export function validateDeck(raw) {
  const source = sourceDeck(raw);
  const title = stringValue(source.title);
  if (!title) throw new Error("D'Präsentatioun huet keen Titel.");
  const normalised = source.slides.reduce((state, slide, index) => {
    const next = normaliseSlide(slide, index, state.ids);
    return { slides: [...state.slides, next], ids: [...state.ids, next.id] };
  }, { slides: [], ids: [] });
  return deepFreeze({ version: DECK_VERSION, title, tagline: nullableString(source.tagline),
    subject: nullableString(source.subject), lang: ALLOWED_LANGS.has(source.lang) ? source.lang : DEFAULT_LANG,
    presenters: stringArray(source.presenters, 12), slides: normalised.slides });
}

export const DECK_LANGS = Object.freeze([...ALLOWED_LANGS]);
export const DECK_LAYOUTS = Object.freeze([...ALLOWED_LAYOUTS]);
