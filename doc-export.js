import { blockText, validateDocument, wordCount } from "./doc-schema.js?v=1";
import { safeExportFilename } from "./ppt-export-pptx.js?v=5";
import { bodyFont, countParagraph, createDocument, docxLibrary, normalParagraph,
  packAndDownload, titleParagraph } from "./docx-primitives.js?v=1";

const DOCX_EXTENSION = ".docx";
const BODY_HALF_POINTS = 22;
const PARAGRAPH_AFTER = 140;

function textRun(Docx, text, extra = {}) {
  return new Docx.TextRun({ text, font: bodyFont(), size: BODY_HALF_POINTS, ...extra });
}

function heading(Docx, block) {
  return new Docx.Paragraph({ text: block.text,
    heading: block.level === 2 ? Docx.HeadingLevel.HEADING_2 : Docx.HeadingLevel.HEADING_1 });
}

function bullets(Docx, block) {
  return block.items.map((item) => new Docx.Paragraph({ bullet: { level: 0 },
    spacing: { after: PARAGRAPH_AFTER }, children: [textRun(Docx, item)] }));
}

function fields(Docx, block) {
  return block.items.map((item) => normalParagraph(Docx, "", {
    children: [textRun(Docx, `- ${item.label} : `), textRun(Docx, item.value)] }));
}

function quote(Docx, block) {
  const children = [textRun(Docx, block.text, { italics: true })];
  if (block.source) children.push(textRun(Docx, ` — ${block.source}`, { italics: true }));
  return [normalParagraph(Docx, "", { indent: { left: 520 }, children })];
}

function sources(Docx, block) {
  return block.items.map((item) => normalParagraph(Docx,
    [item.text, item.accessed].filter(Boolean).join(" — ")));
}

function vocab(Docx, block) {
  return block.items.map((item) => normalParagraph(Docx, "", {
    children: [textRun(Docx, item, { highlight: Docx.HighlightColor.YELLOW })] }));
}

function blockParagraphs(Docx, block) {
  if (block.type === "heading") return [heading(Docx, block)];
  if (block.type === "paragraph") return [normalParagraph(Docx, block.text)];
  if (block.type === "bullets") return bullets(Docx, block);
  if (block.type === "fields") return fields(Docx, block);
  if (block.type === "quote") return quote(Docx, block);
  if (block.type === "sources") return sources(Docx, block);
  return vocab(Docx, block);
}

function documentChildren(Docx, document) {
  return [titleParagraph(Docx, document.title),
    ...document.blocks.flatMap((block) => blockParagraphs(Docx, block)),
    countParagraph(Docx, wordCount(document))];
}

export async function exportDocumentDocx(document) {
  const safe = validateDocument(document);
  const Docx = await docxLibrary();
  const artifact = createDocument(Docx, documentChildren(Docx, safe), {
    title: safe.title, subject: safe.subject, description: "Erstallt mam Word Builder op ian.lu",
  });
  await packAndDownload(Docx, artifact, safeExportFilename(safe.title, DOCX_EXTENSION));
}

export function plainDocumentBlock(block) {
  return blockText(block);
}
