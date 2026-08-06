const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const PX_PER_IN = 96;
const PAGE_MARGIN_IN = 0.68;
const FOOTER_Y_IN = 7.13;
const FOOTER_H_IN = 0.18;
const FOOTER_PT = 10;
const SLIDE_NUMBER_X_IN = 12.34;
const TITLE_PT = 32;
const COVER_TITLE_PT = 42;
const CLOSING_TITLE_PT = 38;
const BODY_PT = 21;
const SOURCE_PT = 13;
const CAPTION_PT = 17;
const FIELD_LABEL_PT = 12;
const MIN_TITLE_PT = 22;
const MIN_BODY_PT = 13;
const MIN_SOURCE_PT = 9;
const TITLE_STEP_PT = 2;
const BODY_STEP_PT = 1;
const TITLE_LINE_SPACING = 1.03;
const BODY_LINE_SPACING = 1.18;
const SMALL_LINE_SPACING = 1.12;
const IMAGE_GAP_IN = 0.42;
const TITLE_TOP_IN = 0.58;
const TITLE_HEIGHT_IN = 0.72;
const CONTENT_TOP_IN = 1.58;
const CONTENT_BOTTOM_IN = 6.82;
const ACCENT_BAR_H_IN = 0.1;
const CARD_GAP_IN = 0.16;
const AVERAGE_CHARACTER_EM = 0.52;
const BULLET_TEXT_INSET_IN = 0.22;
const COVER_CHAR_SPACING = -0.25;
const SECTION_LAYOUTS = new Set(["title", "closing"]);
const UNNUMBERED_LAYOUTS = new Set(["title", "closing"]);
const GEO = Object.freeze({
  coverImageWidth: 5.25, coverAccentY: 1.2, coverAccentW: 0.1, coverAccentH: 3.75,
  coverTextX: 1.03, coverTitleY: 1.32, coverTitleH: 2.25, coverTaglineY: 3.72,
  coverTaglineH: 1.05, coverTextInset: 0.35,
  tocX: 1.18, tocW: 10.95, tocH: 4.85, tocAccentY: 1.38, tocAccentW: 1.15,
  bulletsX: 0.96, bulletsW: 11.45, contentH: 4.95, sectionAccentY: 2.05,
  sectionAccentW: 1.25, sectionTitleY: 2.32, sectionTitleW: 11.4, sectionTitleH: 2.2, sectionFitW: 10.7,
  imageColumnY: 1.25, imageColumnH: 5.55,
  fullOverlayY: 5.02, fullOverlayH: 2.48, fullTitleY: 5.28, fullTitleW: 11.75,
  fullTitleH: 1.15, fullFitW: 11.1, fullFitH: 1.35, fullCaptionY: 6.48, fullCaptionH: 0.38,
  photoFullX: 5.3, photoInsetX: 5.15, photoInsetY: 0.72, photoInsetW: 7.5,
  photoInsetH: 5.95, photoTitleY: 1.15, photoTextW: 3.95, photoTitleH: 2.4,
  photoAccentY: 3.82, photoAccentW: 1.05, photoCaptionY: 4.12, photoCaptionH: 1.4,
  exampleMaxFields: 6, exampleColumnThreshold: 3, exampleColumns: 2, exampleWidth: 7.55,
  exampleImageX: 8.6, exampleImageW: 4.05, fieldInsetX: 0.18, fieldLabelY: 0.13,
  fieldLabelH: 0.3, fieldValueY: 0.48, fieldBottomInset: 0.58,
  sourcesMax: 40, sourcesColumnThreshold: 10, sourcesColumns: 2, sourcesWidth: 11.85,
  sourcesRowMaxH: 0.48, closingAccentX: 5.95, closingAccentY: 1.25,
  closingAccentW: 1.4, closingTitleX: 1.3, closingTitleY: 2.05,
  closingTitleW: 10.73, closingTitleH: 2.45, closingTaglineX: 2.2,
  closingTaglineY: 4.65, closingTaglineW: 8.93, closingTaglineH: 0.65,
  footerPresenterW: 4.2, slideNumberW: 0.32,
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function estimatedLines(text, width, size) {
  const averageCharacterIn = size / 72 * AVERAGE_CHARACTER_EM;
  const charactersPerLine = Math.max(1, Math.floor(width / averageCharacterIn));
  return safeText(text).split("\n").reduce((sum, line) =>
    sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

function fitTextSize(text, preferred, minimum, width, height, spacing, step) {
  let size = preferred;
  while (size > minimum) {
    const requiredHeight = estimatedLines(text, width, size) * (size / 72) * spacing;
    if (requiredHeight <= height) return size;
    size -= step;
  }
  return minimum;
}

function textBox(text, x, y, w, h, options = {}) {
  return {
    kind: "text", x, y, w, h, text: safeText(text),
    font: options.font || "Calibri",
    size: options.size || BODY_PT,
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    color: options.color || "#111111",
    align: options.align || "left",
    valign: options.valign || "top",
    lineSpacing: options.lineSpacing || BODY_LINE_SPACING,
    charSpacing: options.charSpacing || 0,
    bullet: Boolean(options.bullet),
  };
}

function imageBox(url, x, y, w, h, radius) {
  return { kind: "image", x, y, w, h, url: url || null, radius, fit: "cover" };
}

function rectBox(x, y, w, h, fill, radius = 0) {
  return { kind: "rect", x, y, w, h, fill, radius };
}

function isDarkSlide(slide, tokens) {
  if (!tokens.alternating) return false;
  if (SECTION_LAYOUTS.has(slide.layout)) return true;
  return slide.layout === "bullets" && Boolean(slide.section) && !(slide.bullets || []).length;
}

function palette(slide, tokens) {
  const isDark = isDarkSlide(slide, tokens);
  return {
    isDark,
    background: isDark ? tokens.backgroundDark : tokens.backgroundLight,
    text: isDark ? tokens.textOnDark : tokens.textOnLight,
    muted: isDark ? tokens.textOnDark : tokens.secondary,
    title: isDark ? tokens.textOnDark : tokens.primary,
  };
}

function titleBox(slide, tokens, colors, width = SLIDE_WIDTH_IN - PAGE_MARGIN_IN * 2) {
  const preferred = TITLE_PT * tokens.titleScale;
  const size = fitTextSize(slide.title, preferred, MIN_TITLE_PT, width, TITLE_HEIGHT_IN, TITLE_LINE_SPACING, TITLE_STEP_PT);
  return textBox(slide.title, PAGE_MARGIN_IN, TITLE_TOP_IN, width, TITLE_HEIGHT_IN, {
    font: tokens.headlineFont, size, bold: false, color: colors.title,
    lineSpacing: TITLE_LINE_SPACING, valign: "middle",
  });
}

function bulletBoxes(slide, tokens, colors, x, y, w, h) {
  const bullets = (Array.isArray(slide.bullets) ? slide.bullets : []).slice(0, tokens.density);
  if (!bullets.length) return [];
  const rowHeight = h / bullets.length;
  const longest = bullets.reduce((current, item) => item.length > current.length ? item : current, "");
  const size = fitTextSize(longest, BODY_PT, MIN_BODY_PT, w - BULLET_TEXT_INSET_IN, rowHeight, BODY_LINE_SPACING, BODY_STEP_PT);
  return bullets.map((bullet, index) => textBox(bullet, x, y + rowHeight * index, w, rowHeight, {
    font: tokens.bodyFont, size, color: colors.text, bullet: true,
    valign: "middle", lineSpacing: BODY_LINE_SPACING,
  }));
}

function titleLayout(slide, tokens, colors) {
  const imageWidth = slide.image ? GEO.coverImageWidth : 0;
  const textWidth = SLIDE_WIDTH_IN - PAGE_MARGIN_IN * 2 - imageWidth - (imageWidth ? IMAGE_GAP_IN : 0);
  const preferred = COVER_TITLE_PT * tokens.titleScale;
  const size = fitTextSize(slide.title, preferred, MIN_TITLE_PT, textWidth, GEO.coverTitleH, TITLE_LINE_SPACING, TITLE_STEP_PT);
  const boxes = [
    rectBox(PAGE_MARGIN_IN, GEO.coverAccentY, GEO.coverAccentW, GEO.coverAccentH, tokens.accent),
    textBox(slide.title, GEO.coverTextX, GEO.coverTitleY, textWidth - GEO.coverTextInset, GEO.coverTitleH, {
      font: tokens.headlineFont, size, bold: false, color: colors.title,
      valign: "middle", lineSpacing: TITLE_LINE_SPACING, charSpacing: COVER_CHAR_SPACING,
    }),
    textBox(slide.tagline || "", GEO.coverTextX, GEO.coverTaglineY, textWidth - GEO.coverTextInset, GEO.coverTaglineH, {
      font: tokens.bodyFont, size: CAPTION_PT, color: colors.muted,
      valign: "top", lineSpacing: BODY_LINE_SPACING,
    }),
  ];
  if (!imageWidth) return boxes;
  return [...boxes, imageBox(slide.image?.url, SLIDE_WIDTH_IN - imageWidth, 0, imageWidth, SLIDE_HEIGHT_IN, 0)];
}

function tocLayout(slide, tokens, colors) {
  const body = bulletBoxes(slide, tokens, colors, GEO.tocX, CONTENT_TOP_IN, GEO.tocW, GEO.tocH);
  return [
    titleBox(slide, tokens, colors),
    rectBox(PAGE_MARGIN_IN, GEO.tocAccentY, GEO.tocAccentW, ACCENT_BAR_H_IN, tokens.accent),
    ...body,
  ];
}

function bulletsLayout(slide, tokens, colors) {
  const body = bulletBoxes(slide, tokens, colors, GEO.bulletsX, CONTENT_TOP_IN, GEO.bulletsW, GEO.contentH);
  if (body.length) return [titleBox(slide, tokens, colors), ...body];
  const size = fitTextSize(slide.title, COVER_TITLE_PT * tokens.titleScale, MIN_TITLE_PT, GEO.sectionFitW, GEO.sectionTitleH, TITLE_LINE_SPACING, TITLE_STEP_PT);
  return [
    rectBox(PAGE_MARGIN_IN, GEO.sectionAccentY, GEO.sectionAccentW, ACCENT_BAR_H_IN, tokens.accent),
    textBox(slide.title, PAGE_MARGIN_IN, GEO.sectionTitleY, GEO.sectionTitleW, GEO.sectionTitleH, {
      font: tokens.headlineFont, size, color: colors.title,
      valign: "middle", lineSpacing: TITLE_LINE_SPACING,
    }),
  ];
}

function imagePlacement(tokens, columnX, columnWidth) {
  const radius = tokens.radius / PX_PER_IN;
  if (tokens.photoTreatment === "full-bleed") return { x: columnX, y: 0, w: SLIDE_WIDTH_IN - columnX, h: SLIDE_HEIGHT_IN, radius: 0 };
  if (tokens.photoTreatment === "rounded") return { x: columnX, y: GEO.imageColumnY, w: columnWidth, h: GEO.imageColumnH, radius };
  return { x: columnX, y: GEO.imageColumnY, w: columnWidth, h: GEO.imageColumnH, radius: 0 };
}

function bulletsImageLayout(slide, tokens, colors) {
  const usableWidth = SLIDE_WIDTH_IN - PAGE_MARGIN_IN * 2;
  const imageWidth = usableWidth * tokens.imageArea;
  const textWidth = usableWidth - imageWidth - IMAGE_GAP_IN;
  const imageX = PAGE_MARGIN_IN + textWidth + IMAGE_GAP_IN;
  const placement = imagePlacement(tokens, imageX, imageWidth);
  return [
    titleBox(slide, tokens, colors, textWidth),
    ...bulletBoxes(slide, tokens, colors, PAGE_MARGIN_IN, CONTENT_TOP_IN, textWidth, GEO.contentH),
    imageBox(slide.image?.url, placement.x, placement.y, placement.w, placement.h, placement.radius),
  ];
}

function imageFullLayout(slide, tokens, colors) {
  const title = slide.title || slide.caption || "";
  const size = fitTextSize(title, COVER_TITLE_PT * tokens.titleScale, MIN_TITLE_PT, GEO.fullFitW, GEO.fullFitH, TITLE_LINE_SPACING, TITLE_STEP_PT);
  return [
    imageBox(slide.image?.url, 0, 0, SLIDE_WIDTH_IN, SLIDE_HEIGHT_IN, 0),
    rectBox(0, GEO.fullOverlayY, SLIDE_WIDTH_IN, GEO.fullOverlayH, tokens.backgroundDark),
    textBox(title, PAGE_MARGIN_IN, GEO.fullTitleY, GEO.fullTitleW, GEO.fullTitleH, {
      font: tokens.headlineFont, size, color: tokens.textOnDark,
      valign: "middle", lineSpacing: TITLE_LINE_SPACING,
    }),
    textBox(slide.caption || "", PAGE_MARGIN_IN, GEO.fullCaptionY, GEO.fullTitleW, GEO.fullCaptionH, {
      font: tokens.bodyFont, size: CAPTION_PT, color: tokens.textOnDark,
    }),
  ];
}

function photoNumberedLayout(slide, tokens, colors) {
  const radius = tokens.photoTreatment === "rounded" ? tokens.radius / PX_PER_IN : 0;
  const isFull = tokens.photoTreatment === "full-bleed";
  const image = isFull
    ? imageBox(slide.image?.url, GEO.photoFullX, 0, SLIDE_WIDTH_IN - GEO.photoFullX, SLIDE_HEIGHT_IN, 0)
    : imageBox(slide.image?.url, GEO.photoInsetX, GEO.photoInsetY, GEO.photoInsetW, GEO.photoInsetH, radius);
  const size = fitTextSize(slide.title, COVER_TITLE_PT * tokens.titleScale, MIN_TITLE_PT, GEO.photoTextW, GEO.photoTitleH, TITLE_LINE_SPACING, TITLE_STEP_PT);
  return [
    textBox(slide.title, PAGE_MARGIN_IN, GEO.photoTitleY, GEO.photoTextW, GEO.photoTitleH, {
      font: tokens.headlineFont, size, color: colors.title,
      valign: "middle", lineSpacing: TITLE_LINE_SPACING,
    }),
    rectBox(PAGE_MARGIN_IN, GEO.photoAccentY, GEO.photoAccentW, ACCENT_BAR_H_IN, tokens.accent),
    textBox(slide.caption || "", PAGE_MARGIN_IN, GEO.photoCaptionY, GEO.photoTextW, GEO.photoCaptionH, {
      font: tokens.bodyFont, size: CAPTION_PT, color: colors.text,
      lineSpacing: BODY_LINE_SPACING,
    }),
    image,
  ];
}

function exampleLayout(slide, tokens, colors) {
  const fields = (Array.isArray(slide.fields) ? slide.fields : []).slice(0, GEO.exampleMaxFields);
  const columns = fields.length > GEO.exampleColumnThreshold ? GEO.exampleColumns : 1;
  const rows = Math.max(1, Math.ceil(fields.length / columns));
  const totalWidth = GEO.exampleWidth;
  const cardWidth = (totalWidth - CARD_GAP_IN * (columns - 1)) / columns;
  const cardHeight = GEO.contentH / rows - CARD_GAP_IN;
  const cards = fields.flatMap((field, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = PAGE_MARGIN_IN + column * (cardWidth + CARD_GAP_IN);
    const y = CONTENT_TOP_IN + row * (cardHeight + CARD_GAP_IN);
    return [
      rectBox(x, y, cardWidth, cardHeight, colors.isDark ? tokens.secondary : "#FFFFFF", tokens.radius / PX_PER_IN),
      textBox(field.label, x + GEO.fieldInsetX, y + GEO.fieldLabelY, cardWidth - GEO.fieldInsetX * 2, GEO.fieldLabelH, {
        font: tokens.bodyFont, size: FIELD_LABEL_PT, bold: true, color: tokens.accent,
      }),
      textBox(field.value, x + GEO.fieldInsetX, y + GEO.fieldValueY, cardWidth - GEO.fieldInsetX * 2, cardHeight - GEO.fieldBottomInset, {
        font: tokens.bodyFont, size: CAPTION_PT, color: colors.text, valign: "middle",
      }),
    ];
  });
  const visual = imageBox(slide.image?.url, GEO.exampleImageX, CONTENT_TOP_IN, GEO.exampleImageW, GEO.contentH, tokens.radius / PX_PER_IN);
  return [titleBox(slide, tokens, colors), ...cards, visual];
}

function sourcesLayout(slide, tokens, colors) {
  const sources = (Array.isArray(slide.sources) ? slide.sources : []).slice(0, GEO.sourcesMax);
  const rows = sources.map((source) => `${source.text}${source.accessed ? ` — ${source.accessed}` : ""}`);
  const columns = rows.length > GEO.sourcesColumnThreshold ? GEO.sourcesColumns : 1;
  const rowsPerColumn = Math.max(1, Math.ceil(rows.length / columns));
  const columnWidth = (GEO.sourcesWidth - CARD_GAP_IN * (columns - 1)) / columns;
  const rowHeight = Math.min(GEO.sourcesRowMaxH, GEO.contentH / rowsPerColumn);
  const longest = rows.reduce((current, row) => row.length > current.length ? row : current, "");
  const size = fitTextSize(longest, SOURCE_PT, MIN_SOURCE_PT, columnWidth, rowHeight, SMALL_LINE_SPACING, BODY_STEP_PT);
  return [
    titleBox(slide, tokens, colors),
    ...rows.map((source, index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      const x = PAGE_MARGIN_IN + column * (columnWidth + CARD_GAP_IN);
      return textBox(source, x, CONTENT_TOP_IN + rowHeight * row, columnWidth, rowHeight, {
        font: tokens.bodyFont, size, color: colors.text, lineSpacing: SMALL_LINE_SPACING,
      });
    }),
  ];
}

function closingLayout(slide, tokens, colors) {
  const size = fitTextSize(slide.title, CLOSING_TITLE_PT * tokens.titleScale, MIN_TITLE_PT, GEO.closingTitleW, GEO.closingTitleH, TITLE_LINE_SPACING, TITLE_STEP_PT);
  return [
    rectBox(GEO.closingAccentX, GEO.closingAccentY, GEO.closingAccentW, ACCENT_BAR_H_IN, tokens.accent),
    textBox(slide.title, GEO.closingTitleX, GEO.closingTitleY, GEO.closingTitleW, GEO.closingTitleH, {
      font: tokens.headlineFont, size, color: colors.title, align: "center",
      valign: "middle", lineSpacing: TITLE_LINE_SPACING,
    }),
    textBox(slide.tagline || "", GEO.closingTaglineX, GEO.closingTaglineY, GEO.closingTaglineW, GEO.closingTaglineH, {
      font: tokens.bodyFont, size: CAPTION_PT, color: colors.muted, align: "center",
    }),
  ];
}

function baseBoxes(slide, tokens, colors) {
  const layouts = {
    title: titleLayout, toc: tocLayout, bullets: bulletsLayout,
    "bullets-image": bulletsImageLayout, "image-full": imageFullLayout,
    "photo-numbered": photoNumberedLayout, example: exampleLayout,
    sources: sourcesLayout, closing: closingLayout,
  };
  return (layouts[slide.layout] || bulletsLayout)(slide, tokens, colors);
}

function footerBoxes(slide, tokens, colors, slideNumber) {
  const presenter = tokens.footer && slide.presenter ? [textBox(slide.presenter, PAGE_MARGIN_IN, FOOTER_Y_IN, GEO.footerPresenterW, FOOTER_H_IN, {
    font: tokens.bodyFont, size: FOOTER_PT, color: colors.isDark ? tokens.textOnDark : tokens.footerColor,
    valign: "middle",
  })] : [];
  const isNumbered = Number.isInteger(slideNumber) && slideNumber > 0 && !UNNUMBERED_LAYOUTS.has(slide.layout);
  const number = isNumbered ? [textBox(String(slideNumber), SLIDE_NUMBER_X_IN, FOOTER_Y_IN, GEO.slideNumberW, FOOTER_H_IN, {
    font: tokens.bodyFont, size: FOOTER_PT, color: colors.isDark ? tokens.textOnDark : tokens.footerColor,
    align: "right", valign: "middle",
  })] : [];
  return [...presenter, ...number];
}

/** The deck-level tagline is shown on the cover; slides never carry one themselves. */
export function slideForLayout(deck, slide) {
  if (!slide || slide.layout !== "title") return slide;
  return { ...slide, tagline: deck?.tagline ?? null };
}

/**
 * Pure: a slide plus resolved style tokens becomes positioned boxes in inches.
 * `slideNumber` is the 1-based position in the deck — pass it, never derive it from
 * the slide id, so numbering stays correct once slides can be reordered.
 */
export function layoutSlide(slide, tokens, slideNumber = null) {
  const safeSlide = slide && typeof slide === "object" ? slide : { layout: "bullets", title: "", bullets: [] };
  const colors = palette(safeSlide, tokens);
  const boxes = [
    ...baseBoxes(safeSlide, tokens, colors),
    ...footerBoxes(safeSlide, tokens, colors, slideNumber),
  ];
  return deepFreeze({
    w: SLIDE_WIDTH_IN,
    h: SLIDE_HEIGHT_IN,
    background: { fill: colors.background },
    boxes,
  });
}
