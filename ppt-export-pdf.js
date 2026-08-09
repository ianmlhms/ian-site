import { layoutSlide, slideForLayout } from "./ppt-layout.js?v=5";
import { validateDeck } from "./ppt-ai.js?v=10";
import { safeExportFilename } from "./ppt-export-pptx.js?v=9";
import { drawPdfChart } from "./ppt-chart-pdf.js?v=5";

const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2/+esm";
const PAGE_WIDTH_IN = 13.333;
const PAGE_HEIGHT_IN = 7.5;
const PDF_EXTENSION = ".pdf";
const IMAGE_MIME_PREFIX = "image/";
const PLACEHOLDER_COLOR = "#E4E7EC";
const BULLET_PREFIX = "•  ";
const BULLET_INDENT_IN = 0.24;
const BASELINE_FACTOR = 0.82;
const POINTS_PER_INCH = 72;
const MAX_RASTER_EDGE_PX = 2400;
const JPEG_QUALITY = 0.9;
const SERIF_FACES = /georgia|garamond|times|cambria|serif/i;

let libraryPromise = null;

function pdfLibrary() {
  if (!libraryPromise) {
    libraryPromise = import(JSPDF_URL).then((module) => {
      const Constructor = module.jsPDF || module.default?.jsPDF || module.default;
      if (typeof Constructor !== "function") throw new Error("jsPDF ass net disponibel.");
      return Constructor;
    }).catch((error) => {
      console.error("[ppt] PDF-Bibliothéik", error);
      libraryPromise = null;
      throw new Error("D'PDF-Bibliothéik konnt net geluede ginn.");
    });
  }
  return libraryPromise;
}

function rgb(color, fallback = [0, 0, 0]) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color || ""));
  return match ? match.slice(1).map((part) => Number.parseInt(part, 16)) : fallback;
}

function setFill(doc, color) {
  doc.setFillColor(...rgb(color, [255, 255, 255]));
}

function dataUrlFor(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("D'Foto konnt net gelies ginn."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("D'Fotoformat ass ongëlteg."));
    reader.readAsDataURL(blob);
  });
}

function decodedImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("D'Foto konnt net dekodéiert ginn."));
    image.src = dataUrl;
  });
}

async function imageAsset(url) {
  if (!url) return null;
  const response = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith(IMAGE_MIME_PREFIX)) throw new Error("Keng Bilddatei");
  return decodedImage(await dataUrlFor(blob));
}

function imageUrls(deck, tokens) {
  const urls = deck.slides.flatMap((slide, index) =>
    layoutSlide(slideForLayout(deck, slide), tokens, index + 1).boxes
      .filter((box) => box.kind === "image" && box.url)
      .map((box) => box.url));
  return [...new Set(urls)];
}

async function loadImages(deck, tokens) {
  const entries = await Promise.all(imageUrls(deck, tokens).map(async (url) => {
    try { return [url, await imageAsset(url)]; }
    catch (error) {
      console.warn("[ppt] PDF-Foto net disponibel:", url, error instanceof Error ? error.message : error);
      return [url, null];
    }
  }));
  return new Map(entries);
}

function cropGeometry(image, targetRatio) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  if (sourceRatio > targetRatio) {
    const width = image.naturalHeight * targetRatio;
    return { x: (image.naturalWidth - width) / 2, y: 0, w: width, h: image.naturalHeight };
  }
  const height = image.naturalWidth / targetRatio;
  return { x: 0, y: (image.naturalHeight - height) / 2, w: image.naturalWidth, h: height };
}

function rasterSize(crop) {
  const scale = Math.min(1, MAX_RASTER_EDGE_PX / Math.max(crop.w, crop.h));
  return { w: Math.max(1, Math.round(crop.w * scale)), h: Math.max(1, Math.round(crop.h * scale)) };
}

function croppedJpeg(image, box) {
  const crop = cropGeometry(image, box.w / box.h);
  const size = rasterSize(crop);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("D'Foto konnt net preparéiert ginn.");
  context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, size.w, size.h);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function addPlaceholder(doc, box) {
  setFill(doc, PLACEHOLDER_COLOR);
  doc.rect(box.x, box.y, box.w, box.h, "F");
}

function drawCroppedImage(doc, data, box) {
  const canClip = box.radius > 0 && typeof doc.saveGraphicsState === "function"
    && typeof doc.restoreGraphicsState === "function" && typeof doc.clip === "function";
  if (!canClip) { doc.addImage(data, "JPEG", box.x, box.y, box.w, box.h, undefined, "FAST"); return; }
  doc.saveGraphicsState();
  try {
    doc.roundedRect(box.x, box.y, box.w, box.h, box.radius, box.radius);
    doc.clip();
    doc.discardPath?.();
    doc.addImage(data, "JPEG", box.x, box.y, box.w, box.h, undefined, "FAST");
  } finally { doc.restoreGraphicsState(); }
}

function addImage(doc, box, images) {
  const image = box.url ? images.get(box.url) : null;
  if (!image) { addPlaceholder(doc, box); return; }
  try {
    const data = croppedJpeg(image, box);
    drawCroppedImage(doc, data, box);
  } catch (error) {
    console.warn("[ppt] PDF-Foto iwwersprongen:", error instanceof Error ? error.message : error);
    addPlaceholder(doc, box);
  }
}

function addRect(doc, box) {
  const opacity = Number.isFinite(Number(box.opacity)) ? Math.min(1, Math.max(0, Number(box.opacity))) : 1;
  const transparent = opacity < 1 && typeof doc.GState === "function" && typeof doc.setGState === "function";
  if (transparent) { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity })); }
  setFill(doc, box.fill);
  if (box.radius > 0) doc.roundedRect(box.x, box.y, box.w, box.h, box.radius, box.radius, "F");
  else doc.rect(box.x, box.y, box.w, box.h, "F");
  if (transparent) doc.restoreGraphicsState();
}

function fontStyle(box) {
  if (box.bold && box.italic) return "bolditalic";
  if (box.bold) return "bold";
  return box.italic ? "italic" : "normal";
}

function fontFamily(face) {
  return SERIF_FACES.test(String(face || "")) ? "times" : "helvetica";
}

function preparedLines(doc, box) {
  const text = `${box.bullet ? BULLET_PREFIX : ""}${String(box.text ?? "")}`;
  const width = box.bullet ? Math.max(0.1, box.w - BULLET_INDENT_IN) : box.w;
  const lines = doc.splitTextToSize(text, width);
  return Array.isArray(lines) && lines.length ? lines : [""];
}

function textTop(box, blockHeight) {
  if (box.valign === "middle") return box.y + Math.max(0, (box.h - blockHeight) / 2);
  if (box.valign === "bottom") return box.y + Math.max(0, box.h - blockHeight);
  return box.y;
}

function alignedX(box, lineIndex) {
  if (box.bullet) return box.x + (lineIndex ? BULLET_INDENT_IN : 0);
  if (box.align === "center") return box.x + box.w / 2;
  return box.align === "right" ? box.x + box.w : box.x;
}

function addText(doc, box) {
  doc.setFont(fontFamily(box.font), fontStyle(box));
  doc.setFontSize(Number(box.size) || 11);
  doc.setTextColor(...rgb(box.color));
  if (typeof doc.setCharSpace === "function") doc.setCharSpace(Number(box.charSpacing) || 0);
  const lines = preparedLines(doc, box);
  const fontHeight = (Number(box.size) || 11) / POINTS_PER_INCH;
  const lineHeight = fontHeight * (Number(box.lineSpacing) || 1.2);
  const top = textTop(box, lines.length * lineHeight);
  lines.forEach((line, index) => doc.text(String(line), alignedX(box, index),
    top + index * lineHeight + fontHeight * BASELINE_FACTOR,
    { align: box.bullet ? "left" : box.align || "left", baseline: "alphabetic" }));
  if (typeof doc.setCharSpace === "function") doc.setCharSpace(0);
}

function addBox(doc, box, images) {
  if (box.kind === "rect") { addRect(doc, box); return; }
  if (box.kind === "image") { addImage(doc, box, images); return; }
  if (box.kind === "text") { addText(doc, box); return; }
  if (box.kind === "chart") { drawPdfChart(doc, box); return; }
  console.warn("[ppt] Onbekannte PDF-Box iwwersprongen:", box.kind);
}

function addPage(doc, deck, slide, tokens, images, index) {
  if (index > 0) doc.addPage([PAGE_WIDTH_IN, PAGE_HEIGHT_IN], "landscape");
  const layout = layoutSlide(slideForLayout(deck, slide), tokens, index + 1);
  setFill(doc, layout.background.fill);
  doc.rect(0, 0, layout.w, layout.h, "F");
  layout.boxes.forEach((box) => addBox(doc, box, images));
}

/** Export the shared slide layout as a real landscape PDF. */
export async function exportPdf(deck, tokens) {
  const safeDeck = validateDeck(deck);
  if (!tokens || typeof tokens !== "object") throw new Error("De Präsentatiounsstil feelt.");
  const JsPdf = await pdfLibrary();
  const images = await loadImages(safeDeck, tokens);
  const doc = new JsPdf({ orientation: "landscape", unit: "in", format: [PAGE_WIDTH_IN, PAGE_HEIGHT_IN] });
  safeDeck.slides.forEach((slide, index) => addPage(doc, safeDeck, slide, tokens, images, index));
  try { await Promise.resolve(doc.save(safeExportFilename(safeDeck.title, PDF_EXTENSION), { returnPromise: true })); }
  catch (error) {
    console.error("[ppt] PDF-Export", error);
    throw new Error("D'PDF-Datei konnt net erstallt ginn.");
  }
}
