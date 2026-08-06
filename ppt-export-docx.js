import { validateDeck } from "./ppt-ai.js?v=3";
import { safeExportFilename } from "./ppt-export-pptx.js?v=3";

const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8/+esm";
const DOCX_EXTENSION = ".docx";
const BODY_FONT = "Aptos";
const FALLBACK_FONT = "Calibri";
const BODY_HALF_POINTS = 22;
const CUE_HALF_POINTS = 32;
const CUE_TITLE_HALF_POINTS = 40;
const TITLE_HALF_POINTS = 32;
const BODY_SPACING_AFTER = 140;
const TITLE_SPACING_AFTER = 120;
const CARD_SPACING_AFTER = 180;
const MIN_CUES = 3;
const MAX_CUES = 6;
const MAX_CUE_CHARACTERS = 72;
const MAX_CUE_WORDS = 11;
const BLOB_URL_REVOKE_MS = 1000;
const SCRIPT_LABEL = "Vollstännegen Text";
const CUES_LABEL = "Stëchwierder";
const FILLER_PREFIX = /^(?:also|an dann|dat heescht|dofir|effektiv|fir datt|haaptsächlech|mir gesinn|well|wichteg|zum beispill|beispill)\s*[:;,–—-]?\s*/i;
const STOP_WORDS = new Set(["an", "a", "am", "ass", "bei", "datt", "de", "déi", "den", "der", "des", "d'", "duerch", "eng", "et", "fir", "gëtt", "huet", "mat", "net", "oder", "op", "vun", "wéi", "zu"]);
const GENERIC_CUES = Object.freeze({
  title: ["Thema", "Zil", "Iwwerbléck"], closing: ["Merci", "Froen", "Ofschloss"],
  sources: ["Quellen", "Zougrëff", "Nokucken"], default: ["Haaptiddi", "Beispill", "Iwwergang"],
});

let libraryPromise = null;

function docxLibrary() {
  if (!libraryPromise) {
    libraryPromise = import(DOCX_URL).then((module) => {
      if (!module.Document || !module.Packer || !module.Paragraph || !module.TextRun) {
        throw new Error("D'Word-Bibliothéik ass net disponibel.");
      }
      return module;
    }).catch((error) => {
      console.error("[ppt] Word-Bibliothéik", error);
      libraryPromise = null;
      throw new Error("D'Word-Bibliothéik konnt net geluede ginn.");
    });
  }
  return libraryPromise;
}

function bodyFont() {
  return { ascii: BODY_FONT, hAnsi: BODY_FONT, cs: FALLBACK_FONT, eastAsia: FALLBACK_FONT };
}

function textParagraphs(text) {
  return String(text || "").split(/\n\s*\n/g)
    .map((part) => part.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}

function words(text) {
  return String(text || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
}

function wordCount(parts) {
  return parts.reduce((total, part) => total + words(part).length, 0);
}

function presenterFor(deck, slide) {
  return slide.presenter || deck.presenters[0] || "";
}

function speakerBlocks(deck) {
  return deck.slides.reduce((blocks, slide, index) => {
    const name = presenterFor(deck, slide) || "—";
    const previous = blocks[blocks.length - 1];
    if (previous?.name === name) {
      return [...blocks.slice(0, -1), { ...previous, end: index + 1 }];
    }
    return [...blocks, { name, start: index + 1, end: index + 1 }];
  }, []);
}

function slideRange(block) {
  return block.start === block.end ? `Slide ${block.start}` : `Slides ${block.start}–${block.end}`;
}

function speakerLine(deck) {
  const assignments = speakerBlocks(deck).map((block) => `${block.name}: ${slideRange(block)}`);
  return `Virdroender · ${assignments.join(" · ")}`;
}

function documentStyles() {
  return {
    default: {
      document: {
        run: { font: bodyFont(), size: BODY_HALF_POINTS },
        paragraph: { spacing: { after: BODY_SPACING_AFTER } },
      },
    },
  };
}

function createDocument(Docx, children, title, subject) {
  return new Docx.Document({
    creator: "Ian",
    title,
    subject,
    description: "Erstallt mam PPT Builder op ian.lu",
    styles: documentStyles(),
    sections: [{ properties: {}, children }],
  });
}

function titleParagraph(Docx, title) {
  return new Docx.Paragraph({
    alignment: Docx.AlignmentType.CENTER,
    spacing: { after: TITLE_SPACING_AFTER },
    children: [new Docx.TextRun({ text: title, bold: true, font: bodyFont(), size: TITLE_HALF_POINTS })],
  });
}

function taglineParagraph(Docx, tagline) {
  if (!tagline) return [];
  return [new Docx.Paragraph({
    alignment: Docx.AlignmentType.CENTER,
    spacing: { after: CARD_SPACING_AFTER },
    children: [new Docx.TextRun({ text: tagline, italics: true, font: bodyFont(), size: BODY_HALF_POINTS })],
  })];
}

function speakersParagraph(Docx, deck) {
  if (deck.presenters.length < 2) return [];
  return [new Docx.Paragraph({
    alignment: Docx.AlignmentType.CENTER,
    spacing: { after: CARD_SPACING_AFTER },
    children: [new Docx.TextRun({ text: speakerLine(deck), font: bodyFont(), size: BODY_HALF_POINTS })],
  })];
}

function scriptHeading(Docx, deck, slide, index) {
  const suffix = deck.presenters.length >= 2 ? ` — ${presenterFor(deck, slide)}` : "";
  return new Docx.Paragraph({
    text: `${index + 1} · ${slide.title}${suffix}`,
    heading: Docx.HeadingLevel.HEADING_1,
  });
}

function normalParagraph(Docx, text) {
  return new Docx.Paragraph({
    spacing: { after: BODY_SPACING_AFTER },
    children: [new Docx.TextRun({ text, font: bodyFont(), size: BODY_HALF_POINTS })],
  });
}

function countParagraph(Docx, count) {
  return new Docx.Paragraph({
    spacing: { before: CARD_SPACING_AFTER },
    children: [new Docx.TextRun({ text: `Words: ${count}`, font: bodyFont(), size: BODY_HALF_POINTS })],
  });
}

function scriptChildren(Docx, deck) {
  const content = deck.slides.flatMap((slide, index) => {
    if (!slide.notes.trim()) return [];
    return [scriptHeading(Docx, deck, slide, index), ...textParagraphs(slide.notes).map((text) => normalParagraph(Docx, text))];
  });
  const count = wordCount(deck.slides.map((slide) => slide.notes).filter(Boolean));
  return [titleParagraph(Docx, deck.title), ...taglineParagraph(Docx, deck.tagline),
    ...speakersParagraph(Docx, deck), ...content, countParagraph(Docx, count)];
}

function compactCue(text) {
  const stripped = String(text || "").replace(/^\s*[-•*]\s*/, "").replace(FILLER_PREFIX, "").trim();
  const short = stripped.split(/\s+/).slice(0, MAX_CUE_WORDS).join(" ");
  if (!short) return "";
  return short.length <= MAX_CUE_CHARACTERS ? short : `${short.slice(0, MAX_CUE_CHARACTERS - 1).trim()}…`;
}

function noteFragments(notes) {
  return String(notes || "").split(/(?:\n+|[.!?;]+)\s*/g).map(compactCue).filter(Boolean);
}

function keywordFallback(slide) {
  const vocabulary = words(`${slide.notes} ${slide.caption || ""} ${slide.title}`)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word.toLowerCase()));
  return Array.from({ length: Math.ceil(vocabulary.length / 3) }, (_, index) =>
    vocabulary.slice(index * 3, index * 3 + 3).join(" ")).filter(Boolean);
}

function fieldCues(slide) {
  return slide.fields.map((field) => compactCue(`${field.label} = ${field.value}`)).filter(Boolean);
}

function genericCues(slide) {
  return GENERIC_CUES[slide.layout] || GENERIC_CUES.default;
}

function uniqueCues(cues) {
  return cues.reduce((result, cue) => {
    const key = cue.toLocaleLowerCase();
    return cue && !result.keys.includes(key)
      ? { values: [...result.values, cue], keys: [...result.keys, key] }
      : result;
  }, { values: [], keys: [] }).values;
}

function slideCues(slide) {
  const bullets = slide.bullets.map(compactCue).filter(Boolean);
  const supplements = [...fieldCues(slide), ...noteFragments(slide.notes), compactCue(slide.caption),
    ...keywordFallback(slide), ...genericCues(slide)].filter(Boolean);
  const cues = uniqueCues([...bullets, ...supplements]);
  const target = Math.max(MIN_CUES, Math.min(MAX_CUES, bullets.length || MIN_CUES));
  return cues.slice(0, Math.min(MAX_CUES, Math.max(target, cues.length >= MIN_CUES ? MIN_CUES : cues.length)));
}

function pageBreak(Docx, index) {
  if (!index) return [];
  return [new Docx.Paragraph({ children: [new Docx.PageBreak()] })];
}

function cueTitle(Docx, deck, slide, index) {
  const speaker = deck.presenters.length >= 2 ? ` · ${presenterFor(deck, slide)}` : "";
  return new Docx.Paragraph({
    spacing: { after: CARD_SPACING_AFTER },
    children: [new Docx.TextRun({ text: `${index + 1} · ${slide.title}${speaker}`,
      bold: true, font: bodyFont(), size: CUE_TITLE_HALF_POINTS })],
  });
}

function cueBullet(Docx, cue) {
  return new Docx.Paragraph({
    bullet: { level: 0 },
    spacing: { after: CARD_SPACING_AFTER },
    children: [new Docx.TextRun({ text: cue, font: bodyFont(), size: CUE_HALF_POINTS })],
  });
}

function cuesChildren(Docx, deck) {
  const cards = deck.slides.flatMap((slide, index) => [
    ...pageBreak(Docx, index), cueTitle(Docx, deck, slide, index),
    ...slideCues(slide).map((cue) => cueBullet(Docx, cue)),
  ]);
  const count = wordCount(deck.slides.flatMap(slideCues));
  return [titleParagraph(Docx, `${deck.title} — ${CUES_LABEL}`), ...cards, countParagraph(Docx, count)];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
}

async function packAndDownload(Docx, document, filename) {
  try {
    const blob = await Docx.Packer.toBlob(document);
    downloadBlob(blob, filename);
  } catch (error) {
    console.error("[ppt] Word-Export", error);
    throw new Error("D'Word-Datei konnt net erstallt ginn.");
  }
}

/** Download the complete spoken script as a Word document. */
export async function exportScriptDocx(deck) {
  const safeDeck = validateDeck(deck);
  const Docx = await docxLibrary();
  const document = createDocument(Docx, scriptChildren(Docx, safeDeck), safeDeck.title, SCRIPT_LABEL);
  await packAndDownload(Docx, document, safeExportFilename(`${safeDeck.title} — ${SCRIPT_LABEL}`, DOCX_EXTENSION));
}

/** Download one large, skimmable cue card per slide. */
export async function exportCuesDocx(deck) {
  const safeDeck = validateDeck(deck);
  const Docx = await docxLibrary();
  const document = createDocument(Docx, cuesChildren(Docx, safeDeck), safeDeck.title, CUES_LABEL);
  await packAndDownload(Docx, document, safeExportFilename(`${safeDeck.title} — ${CUES_LABEL}`, DOCX_EXTENSION));
}
