import { layoutSlide, slideForLayout } from "./ppt-layout.js?v=5";
import { validateDeck } from "./ppt-ai.js?v=10";

const PPTXGENJS_URL = "https://cdn.jsdelivr.net/npm/pptxgenjs@3/+esm";
const LAYOUT_NAME = "IANLU16x9";
const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const DEFAULT_IMAGE_FILL = "E4E7EC";
const FALLBACK_FILENAME = "Presentatioun";
const MAX_FILENAME_LENGTH = 100;
const MIME_PREFIX = "image/";
const PPTX_EXTENSION = ".pptx";

let libraryPromise = null;

function withoutHash(color, fallback = "000000") {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
    ? color.slice(1).toUpperCase()
    : fallback;
}

function pptxLibrary() {
  if (!libraryPromise) {
    libraryPromise = import(PPTXGENJS_URL).then((module) => {
      const Constructor = module.default || module.PptxGenJS || module;
      if (typeof Constructor !== "function") throw new Error("PptxGenJS ass net disponibel.");
      return Constructor;
    });
  }
  return libraryPromise;
}

function dataUrlFor(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("D'Foto konnt net agebonne ginn."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("D'Foto huet en ongëltegt Format."));
    reader.readAsDataURL(blob);
  });
}

async function embeddedImage(url) {
  if (!url) return null;
  const response = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith(MIME_PREFIX)) throw new Error("Keng Bilddatei");
  return dataUrlFor(blob);
}

function imageUrls(deck, tokens) {
  const urls = deck.slides.flatMap((slide) =>
    layoutSlide(slideForLayout(deck, slide), tokens).boxes
      .filter((box) => box.kind === "image" && box.url)
      .map((box) => box.url)
  );
  return [...new Set(urls)];
}

async function imageData(deck, tokens) {
  const urls = imageUrls(deck, tokens);
  const entries = await Promise.all(urls.map(async (url) => {
    try { return [url, await embeddedImage(url)]; }
    catch (error) {
      console.warn("[ppt] Exportfoto iwwersprongen:", url, error instanceof Error ? error.message : error);
      return [url, null];
    }
  }));
  return new Map(entries);
}

function verticalAlign(value) {
  if (value === "middle") return "mid";
  if (value === "bottom") return "bottom";
  return "top";
}

function textOptions(box) {
  return {
    x: box.x, y: box.y, w: box.w, h: box.h,
    fontFace: box.font,
    fontSize: box.size,
    bold: Boolean(box.bold),
    italic: Boolean(box.italic),
    color: withoutHash(box.color),
    align: box.align || "left",
    valign: verticalAlign(box.valign),
    charSpacing: Number(box.charSpacing) || 0,
    lineSpacingMultiple: Number(box.lineSpacing) || 1.2,
    margin: 0,
    breakLine: false,
    bullet: box.bullet ? { type: "bullet" } : undefined,
    fit: "shrink",
  };
}

function addText(pptSlide, box) {
  pptSlide.addText(String(box.text ?? ""), textOptions(box));
}

function addRect(pptx, pptSlide, box) {
  const shape = box.radius > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  const opacity = Number.isFinite(Number(box.opacity)) ? Number(box.opacity) : 1;
  pptSlide.addShape(shape, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    fill: { color: withoutHash(box.fill, "FFFFFF"),
      transparency: Math.round((1 - Math.min(1, Math.max(0, opacity))) * 100) },
    line: { color: withoutHash(box.fill, "FFFFFF"), transparency: 100 },
    radius: box.radius,
  });
}

function chartData(box) {
  const series = box.chart.type === "pie" ? box.chart.series.slice(0, 1) : box.chart.series;
  return series.map((item) => ({ name: item.name,
    labels: [...box.chart.categories], values: [...item.values] }));
}

function addChart(pptx, pptSlide, box) {
  const chartType = pptx.ChartType[box.chart.type] || pptx.ChartType.bar;
  const colors = (box.colors?.palette || []).map((color) => withoutHash(color));
  pptSlide.addChart(chartType, chartData(box), {
    x: box.x, y: box.y, w: box.w, h: box.h,
    showTitle: Boolean(box.chart.title), title: box.chart.title || "",
    showLegend: box.chart.series.length > 1 || box.chart.type === "pie",
    legendPos: "b",
    chartColors: colors, showCatName: box.chart.type === "pie",
    catAxisLabelFontFace: box.colors?.font, valAxisLabelFontFace: box.colors?.font,
    legendFontFace: box.colors?.font, dataLabelFontFace: box.colors?.font,
    titleFontFace: box.colors?.headlineFont,
    showValue: box.chart.type === "pie", showPercent: box.chart.type === "pie",
    showBorder: false,
  });
}

function addMissingImage(pptx, pptSlide, box) {
  pptSlide.addShape(pptx.ShapeType.rect, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    fill: { color: DEFAULT_IMAGE_FILL },
    line: { color: DEFAULT_IMAGE_FILL, transparency: 100 },
  });
}

function addImage(pptx, pptSlide, box, images) {
  const data = box.url ? images.get(box.url) : null;
  if (!data) { addMissingImage(pptx, pptSlide, box); return; }
  pptSlide.addImage({
    data,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    sizing: { type: "cover", w: box.w, h: box.h },
  });
}

function addBox(pptx, pptSlide, box, images) {
  if (box.kind === "text") { addText(pptSlide, box); return; }
  if (box.kind === "rect") { addRect(pptx, pptSlide, box); return; }
  if (box.kind === "image") { addImage(pptx, pptSlide, box, images); return; }
  if (box.kind === "chart") { addChart(pptx, pptSlide, box); return; }
  console.warn("[ppt] Onbekannte Export-Box gouf iwwersprongen:", box.kind);
}

function addDeckSlide(pptx, deck, sourceSlide, tokens, images, slideNumber) {
  const pptSlide = pptx.addSlide();
  const layout = layoutSlide(slideForLayout(deck, sourceSlide), tokens, slideNumber);
  pptSlide.background = { color: withoutHash(layout.background.fill, "FFFFFF") };
  layout.boxes.forEach((box) => addBox(pptx, pptSlide, box, images));
  const answer = sourceSlide.quiz?.options?.[sourceSlide.quiz.answerIndex];
  const notes = [sourceSlide.notes, answer ? `Äntwert: ${answer}` : ""].filter(Boolean).join("\n\n");
  if (notes) pptSlide.addNotes(notes);
  return pptSlide;
}

export function safeExportFilename(title, extension) {
  const cleaned = String(title || FALLBACK_FILENAME)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
  const suffix = String(extension || PPTX_EXTENSION).startsWith(".")
    ? String(extension || PPTX_EXTENSION)
    : `.${String(extension)}`;
  return `${cleaned || FALLBACK_FILENAME}${suffix}`;
}

function configurePresentation(PptxGenJS, deck, tokens) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: LAYOUT_NAME, width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN });
  pptx.layout = LAYOUT_NAME;
  pptx.author = "Ian";
  pptx.company = "ian.lu";
  pptx.subject = deck.subject || "";
  pptx.title = deck.title;
  pptx.lang = deck.lang;
  pptx.theme = {
    headFontFace: tokens.headlineFont,
    bodyFontFace: tokens.bodyFont,
    lang: deck.lang,
  };
  return pptx;
}

function announceSkipped(images) {
  const skipped = [...images.values()].filter((data) => !data).length;
  if (!skipped || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ppt:export-warning", {
    detail: Object.freeze({ message: `${skipped} Fotoe konnten net agebonne ginn; d'PPTX gouf trotzdeem erstallt.` }),
  }));
}

/** Export the exact same layout boxes used by the live DOM preview. */
export async function exportPptx(deck, tokens) {
  const safeDeck = validateDeck(deck);
  if (!tokens || typeof tokens !== "object") throw new Error("De Präsentatiounsstil feelt.");
  const PptxGenJS = await pptxLibrary();
  const images = await imageData(safeDeck, tokens);
  const pptx = configurePresentation(PptxGenJS, safeDeck, tokens);
  safeDeck.slides.forEach((slide, index) => addDeckSlide(pptx, safeDeck, slide, tokens, images, index + 1));
  announceSkipped(images);
  try { await pptx.writeFile({ fileName: safeExportFilename(safeDeck.title, PPTX_EXTENSION) }); }
  catch (error) {
    console.error("[ppt] export", error);
    throw new Error("D'PowerPoint-Datei konnt net erstallt ginn.");
  }
}
