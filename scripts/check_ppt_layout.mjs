import assert from "node:assert/strict";
import { layoutSlide } from "../ppt-layout.js";
import { resolveTokens, STYLE_PACKS } from "../ppt-style-packs.js";
import { validateDeck } from "../ppt-ai-schema.js";

const BASE = Object.freeze({ id: "s1", section: "2", presenter: "Ian", title: "E bewosst laangen Titel fir d'Typografie ze testen",
  bullets: ["Kuerz", "Méi laange Punkt mat enger konkret Zuel = 12,5 %", "Folleg → kloer Ännerung"],
  caption: "2", fields: [{ label: "Ort", value: "Lëtzebuerg" }],
  sources: [{ text: "data.public.lu", accessed: "7. August 2026" }],
  chart: null, quiz: null, imageQuery: null, image: null, notes: "Notizen" });
const CHART = Object.freeze({ type: "bar", title: "Entwécklung", categories: ["2023", "2024", "2025"],
  series: [{ name: "Wäert", values: [12, 18, 27] }], unit: "%" });
const QUIZ = Object.freeze({ question: "Wéi eng Äntwert ass richteg?", options: ["Éischt", "Zweet", "Drëtt"], answerIndex: 1 });
const LAYOUTS = ["title", "toc", "bullets", "bullets-image", "image-full", "photo-numbered",
  "example", "sources", "closing", "section", "chart", "quiz"];

function slideFor(layout) {
  return { ...BASE, layout, chart: layout === "chart" ? CHART : null, quiz: layout === "quiz" ? QUIZ : null };
}

function assertBox(box, layout, pack) {
  ["x", "y", "w", "h"].forEach((key) => assert(Number.isFinite(box[key]), `${pack}/${layout} ${key}`));
  assert(box.w >= 0 && box.h >= 0, `${pack}/${layout} negative size`);
  assert(box.x >= -1e-6 && box.y >= -1e-6, `${pack}/${layout} starts off-slide`);
  assert(box.x + box.w <= 13.333 + 1e-6, `${pack}/${layout} exceeds width`);
  assert(box.y + box.h <= 7.5 + 1e-6, `${pack}/${layout} exceeds height`);
}

for (const pack of Object.keys(STYLE_PACKS)) {
  const tokens = resolveTokens({ pack, headlineFont: "Futura", bodyFont: "Verdana" });
  assert.equal(tokens.headlineFont, "Futura");
  assert.equal(tokens.bodyFont, "Verdana");
  for (const layout of LAYOUTS) {
    const snapshot = layoutSlide(slideFor(layout), tokens, 2);
    assert(Object.isFrozen(snapshot), `${pack}/${layout} is not frozen`);
    snapshot.boxes.forEach((box) => assertBox(box, layout, pack));
    if (layout === "chart") assert(snapshot.boxes.some((box) => box.kind === "chart"));
    if (layout === "quiz") assert(!snapshot.boxes.some((box) => box.text === QUIZ.options[QUIZ.answerIndex]));
  }
}

const invalid = layoutSlide({ ...slideFor("chart"), chart: { ...CHART,
  series: [{ name: "Broken", values: [1] }] } }, resolveTokens(), 2);
assert(!invalid.boxes.some((box) => box.kind === "chart"), "invalid chart did not degrade");
const degraded = validateDeck({ version: 1, title: "Test", lang: "de", presenters: [], slides: [{
  ...slideFor("chart"), chart: { ...CHART, series: [{ name: "Broken", values: [1] }] },
}] });
assert.equal(degraded.slides[0].layout, "bullets", "schema did not degrade invalid chart");
const dense = layoutSlide({ ...slideFor("bullets"), bullets: Array.from({ length: 8 }, (_, index) =>
  `${index + 1} · ${"Ganz laange gemëschte Bullet mat Daten ".repeat(12)}`) }, resolveTokens({ density: 8 }), 2);
dense.boxes.forEach((box) => assertBox(box, "dense-bullets", "office"));
console.log(`PPT layouts OK: ${Object.keys(STYLE_PACKS).length} packs × ${LAYOUTS.length} layouts`);
