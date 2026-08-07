const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8/+esm";
const BODY_FONT = "Aptos";
const FALLBACK_FONT = "Calibri";
const BODY_HALF_POINTS = 22;
const TITLE_HALF_POINTS = 32;
const BODY_SPACING_AFTER = 140;
const TITLE_SPACING_AFTER = 120;
const COUNT_SPACING_BEFORE = 180;
const BLOB_URL_REVOKE_MS = 1_000;
let libraryPromise = null;

export function bodyFont() {
  return { ascii: BODY_FONT, hAnsi: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT };
}

export function docxLibrary() {
  if (!libraryPromise) {
    libraryPromise = import(DOCX_URL).then((module) => {
      if (!module.Document || !module.Packer || !module.Paragraph || !module.TextRun) {
        throw new Error("D'Word-Bibliothéik ass net disponibel.");
      }
      return module;
    }).catch((error) => {
      console.error("[studio] Word-Bibliothéik", error);
      libraryPromise = null;
      throw new Error("D'Word-Bibliothéik konnt net geluede ginn.");
    });
  }
  return libraryPromise;
}

export function documentStyles() {
  return { default: { document: { run: { font: bodyFont(), size: BODY_HALF_POINTS },
    paragraph: { spacing: { after: BODY_SPACING_AFTER } } } } };
}

export function createDocument(Docx, children, metadata) {
  return new Docx.Document({ creator: "Ian", title: metadata.title, subject: metadata.subject || "",
    description: metadata.description || "Erstallt am Studio op ian.lu",
    styles: documentStyles(), sections: [{ properties: {}, children }] });
}

export function titleParagraph(Docx, title) {
  return new Docx.Paragraph({ alignment: Docx.AlignmentType.CENTER,
    spacing: { after: TITLE_SPACING_AFTER },
    children: [new Docx.TextRun({ text: title, bold: true, font: bodyFont(), size: TITLE_HALF_POINTS })] });
}

export function normalParagraph(Docx, text, options = {}) {
  return new Docx.Paragraph({ ...options, spacing: options.spacing || { after: BODY_SPACING_AFTER },
    children: options.children || [new Docx.TextRun({ text, font: bodyFont(), size: BODY_HALF_POINTS })] });
}

export function countParagraph(Docx, count) {
  return new Docx.Paragraph({ spacing: { before: COUNT_SPACING_BEFORE },
    children: [new Docx.TextRun({ text: `Words: ${count}`, font: bodyFont(), size: BODY_HALF_POINTS })] });
}

export function textParagraphs(text) {
  return String(text || "").split(/\n\s*\n/g)
    .map((part) => part.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
}

export async function packAndDownload(Docx, document, filename) {
  try { downloadBlob(await Docx.Packer.toBlob(document), filename); }
  catch (error) {
    console.error("[studio] Word-Export", error);
    throw new Error("D'Word-Datei konnt net erstallt ginn.");
  }
}

export const DOCX_BODY_HALF_POINTS = BODY_HALF_POINTS;
