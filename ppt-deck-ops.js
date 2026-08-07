import { validateDeck } from "./ppt-ai.js?v=6";

const DEFAULT_LAYOUT = "bullets";
const LAYOUTS = new Set([
  "title",
  "toc",
  "bullets",
  "bullets-image",
  "image-full",
  "photo-numbered",
  "example",
  "sources",
  "closing",
  "chart",
  "quiz",
  "section",
]);
const SLIDE_KEYS = new Set([
  "layout",
  "section",
  "presenter",
  "title",
  "bullets",
  "caption",
  "fields",
  "sources",
  "chart",
  "quiz",
  "imageQuery",
  "image",
  "notes",
]);
const META_KEYS = new Set(["title", "tagline", "subject", "lang"]);
const CONTENT_EXCLUSIONS = new Set(["title", "closing", "sources", "section"]);
const EMPTY_TITLES = Object.freeze({
  title: "Nei Presentatioun",
  toc: "Iwwersiicht",
  bullets: "Ouni Titel",
  "bullets-image": "Ouni Titel",
  "image-full": "Foto",
  "photo-numbered": "1 — Foto",
  example: "Beispill",
  sources: "Quellen",
  closing: "Merci",
  chart: "Daten",
  quiz: "Quiz",
  section: "Nei Sektioun",
});

function boundedIndex(value, length, allowEnd = false) {
  const maximum = allowEnd ? length : length - 1;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) {
    throw new RangeError("D'Slide-Positioun ass ongëlteg.");
  }
  return number;
}

function nextId(deck) {
  const used = new Set(deck.slides.map((slide) => slide.id));
  let counter = deck.slides.length + 1;
  while (used.has(`s${counter}`)) counter += 1;
  return `s${counter}`;
}

function emptySlide(deck, layout) {
  const resolved = LAYOUTS.has(layout) ? layout : DEFAULT_LAYOUT;
  return {
    id: nextId(deck), layout: resolved, section: null, presenter: null,
    title: EMPTY_TITLES[resolved], bullets: [], caption: null,
    fields: resolved === "example" ? [{ label: "Begrëff", value: "Wäert" }] : [],
    sources: [], chart: resolved === "chart" ? { type: "bar", title: "", categories: ["A", "B"],
      series: [{ name: "Wäert", values: [1, 2] }], unit: "" } : null,
    quiz: resolved === "quiz" ? { question: "Fro", options: ["A", "B", "C"], answerIndex: 0 } : null,
    imageQuery: null, image: null, notes: "",
  };
}

function rebuild(deck, slides, extra = {}) {
  return validateDeck({ ...deck, ...extra, slides });
}

function cleanPatch(patch, allowed) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("D'Ännerung ass ongëlteg.");
  }
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}

export function moveSlide(deck, from, to) {
  const source = boundedIndex(from, deck.slides.length);
  const target = boundedIndex(to, deck.slides.length);
  if (source === target) return rebuild(deck, deck.slides);
  const moving = deck.slides[source];
  const without = deck.slides.filter((_, index) => index !== source);
  const slides = [...without.slice(0, target), moving, ...without.slice(target)];
  return rebuild(deck, slides);
}

/** Insert a layout-aware blank without reusing any existing slide id. */
export function insertSlide(deck, index, layout = DEFAULT_LAYOUT) {
  const target = boundedIndex(index, deck.slides.length, true);
  const slide = emptySlide(deck, layout);
  const slides = [...deck.slides.slice(0, target), slide, ...deck.slides.slice(target)];
  return rebuild(deck, slides);
}

/** Duplicate nested content safely through validateDeck's normalisation boundary. */
export function duplicateSlide(deck, index) {
  const source = boundedIndex(index, deck.slides.length);
  const copy = { ...deck.slides[source], id: nextId(deck) };
  const slides = [...deck.slides.slice(0, source + 1), copy, ...deck.slides.slice(source + 1)];
  return rebuild(deck, slides);
}

/** Keep every deck renderable: refusing the last deletion is part of this transform. */
export function deleteSlide(deck, index) {
  if (deck.slides.length <= 1) throw new Error("Déi lescht Slide kann net geläscht ginn.");
  const target = boundedIndex(index, deck.slides.length);
  return rebuild(deck, deck.slides.filter((_, slideIndex) => slideIndex !== target));
}

/** Only model fields are accepted; id remains stable even if a caller includes one. */
export function updateSlide(deck, index, patch) {
  const target = boundedIndex(index, deck.slides.length);
  const changes = cleanPatch(patch, SLIDE_KEYS);
  if (changes.layout && !LAYOUTS.has(changes.layout)) throw new Error("Dat Layout gëtt et net.");
  const slides = deck.slides.map((slide, slideIndex) =>
    slideIndex === target ? { ...slide, ...changes, id: slide.id } : slide
  );
  return rebuild(deck, slides);
}

function presenterFor(index, count, names) {
  if (!count || !names.length) return null;
  const block = Math.min(names.length - 1, Math.floor(index * names.length / count));
  return names[block];
}

export function setPresenters(deck, names) {
  const cleanNames = Array.isArray(names)
    ? names.map((name) => String(name ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
  if (cleanNames.length <= 1) {
    return rebuild(deck, deck.slides.map((slide) => ({ ...slide, presenter: null })), { presenters: cleanNames });
  }
  const content = deck.slides.filter((slide) => !CONTENT_EXCLUSIONS.has(slide.layout));
  let contentIndex = 0;
  const slides = deck.slides.map((slide) => {
    if (slide.layout === "title") return { ...slide, presenter: cleanNames.join(" · ") };
    if (CONTENT_EXCLUSIONS.has(slide.layout)) return { ...slide, presenter: null };
    const presenter = presenterFor(contentIndex, content.length, cleanNames);
    contentIndex += 1;
    return { ...slide, presenter };
  });
  return rebuild(deck, slides, { presenters: cleanNames });
}

/** Deck metadata changes never rebuild individual slide objects before validation. */
export function setDeckMeta(deck, patch) {
  const changes = cleanPatch(patch, META_KEYS);
  return rebuild(deck, deck.slides, changes);
}

export const SLIDE_LAYOUTS = Object.freeze([...LAYOUTS]);
