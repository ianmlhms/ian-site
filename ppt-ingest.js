const PDF_MODULE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/+esm";
const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";
const MAMMOTH_BROWSER_URL = "https://cdn.jsdelivr.net/npm/mammoth@1/mammoth.browser.min.js";
const MAX_FILES = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_IMAGE_EDGE_PX = 1568;
const JPEG_QUALITY = 0.85;
const JPEG_MEDIA_TYPE = "image/jpeg";
const TEXT_EXTENSIONS = new Set(["txt", "md"]);
const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "txt", "md"]);

let pdfModulePromise = null;
let mammothPromise = null;

function extension(file) {
  const name = typeof file?.name === "string" ? file.name : "";
  return name.includes(".") ? name.split(".").at(-1).toLowerCase() : "";
}

function isImage(file) {
  const type = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  return type.startsWith("image/") || new Set(["heic", "heif", "jpg", "jpeg", "png", "webp"]).has(extension(file));
}

function validateFiles(files) {
  if (files.length > MAX_FILES) throw new Error(`Maximal ${MAX_FILES} Dateie sinn erlaabt.`);
  const oversized = files.find((file) => Number(file?.size) > MAX_FILE_BYTES);
  if (oversized) throw new Error(`${oversized.name}: Datei ass méi grouss wéi 20 MB.`);
  const unsupported = files.find((file) => !isImage(file) && !SUPPORTED_EXTENSIONS.has(extension(file)));
  if (unsupported) throw new Error(`${unsupported.name}: Dëst Dateiformat gëtt net ënnerstëtzt.`);
  const images = files.filter(isImage);
  if (images.length > MAX_IMAGES) {
    const offending = images[MAX_IMAGES];
    throw new Error(`${offending.name}: Maximal ${MAX_IMAGES} Biller sinn erlaabt.`);
  }
}

async function pdfLibrary() {
  if (!pdfModulePromise) {
    pdfModulePromise = import(PDF_MODULE_URL).then((module) => {
      if (!module?.getDocument || !module?.GlobalWorkerOptions) throw new Error("pdf.js ass net disponibel.");
      module.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return module;
    });
  }
  return pdfModulePromise;
}

async function mammothLibrary() {
  if (!mammothPromise) {
    mammothPromise = import(MAMMOTH_BROWSER_URL).then((module) => {
      const library = module?.default?.extractRawText ? module.default : window.mammoth;
      if (!library?.extractRawText) throw new Error("Mammoth ass net disponibel.");
      return library;
    });
  }
  return mammothPromise;
}

function pageText(content) {
  const items = Array.isArray(content?.items) ? content.items : [];
  return items.map((item) => typeof item?.str === "string" ? item.str : "").filter(Boolean).join(" ");
}

async function readPdf(file) {
  const pdfjs = await pdfLibrary();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
    const page = await document.getPage(index + 1);
    return pageText(await page.getTextContent());
  }));
  return pages.map((text, index) => `Säit ${index + 1}\n${text}`).join("\n\n").trim();
}

async function readDocx(file) {
  const mammoth = await mammothLibrary();
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  if (!result || typeof result.value !== "string") throw new Error("DOCX-Text ass ongëlteg.");
  return result.value.trim();
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("D'Bild konnt net ëmgewandelt ginn.")), JPEG_MEDIA_TYPE, JPEG_QUALITY);
  });
}

function dataUrlFor(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("D'Bild konnt net gelies ginn."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("D'Bildresultat ass ongëlteg."));
    reader.readAsDataURL(blob);
  });
}

function scaledDimensions(width, height) {
  const longest = Math.max(width, height);
  if (!longest) throw new Error("D'Bild huet keng gëlteg Gréisst.");
  const scale = Math.min(1, MAX_IMAGE_EDGE_PX / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function imageBitmap(file) {
  if (typeof createImageBitmap !== "function") throw new Error("Dëse Browser kann d'Bild net opmaachen.");
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("Bildformat net liesbar; HEIC w.e.g. als JPEG exportéieren."); }
}

async function readImage(file) {
  const bitmap = await imageBitmap(file);
  try {
    const dimensions = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Bildveraarbechtung ass net disponibel.");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const dataUrl = await dataUrlFor(await canvasBlob(canvas));
    const match = /^data:image\/jpeg;base64,(.+)$/i.exec(dataUrl);
    if (!match) throw new Error("D'Bild konnt net als JPEG kodéiert ginn.");
    return Object.freeze({ media_type: JPEG_MEDIA_TYPE, data: match[1] });
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

async function readTextFile(file) {
  const ext = extension(file);
  if (ext === "pdf") return readPdf(file);
  if (ext === "docx") return readDocx(file);
  if (TEXT_EXTENSIONS.has(ext)) return (await file.text()).trim();
  return "";
}

async function ingestOne(file) {
  try {
    if (isImage(file)) return { text: "", image: await readImage(file) };
    const text = await readTextFile(file);
    return { text: text ? `${file.name}\n${text}` : "", image: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekannte Feeler";
    throw new Error(`${file.name}: ${message}`);
  }
}

/** Read all teacher material locally; no source file is uploaded or persisted here. */
export async function ingestFiles(fileList) {
  const files = Array.from(fileList || []);
  validateFiles(files);
  const results = await Promise.all(files.map(ingestOne));
  const text = results.map((result) => result.text).filter(Boolean).join("\n\n").trim();
  const images = results.map((result) => result.image).filter(Boolean);
  return Object.freeze({ text, images: Object.freeze(images) });
}

export const INGEST_LIMITS = Object.freeze({
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxImages: MAX_IMAGES,
  maxImageEdge: MAX_IMAGE_EDGE_PX,
});
