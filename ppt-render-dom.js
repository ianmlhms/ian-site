const CSS_PIXELS_PER_INCH = 96;
const POINTS_PER_INCH = 72;
const DEFAULT_SCALE = 1;
const THUMB_WIDTH_PX = 176;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
const ALIGNMENTS = new Set(["left", "center", "right"]);
const VERTICAL_ALIGNMENTS = new Set(["top", "middle", "bottom"]);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[character]));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, finite(scale, DEFAULT_SCALE)));
}

function pixels(inches, scale) {
  return finite(inches) * CSS_PIXELS_PER_INCH * scale;
}

function pointPixels(points, scale) {
  return finite(points) * (CSS_PIXELS_PER_INCH / POINTS_PER_INCH) * scale;
}

function applyPosition(element, box, scale) {
  const style = element.style;
  style.position = "absolute";
  style.left = `${pixels(box.x, scale)}px`;
  style.top = `${pixels(box.y, scale)}px`;
  style.width = `${pixels(box.w, scale)}px`;
  style.height = `${pixels(box.h, scale)}px`;
  style.boxSizing = "border-box";
  style.overflow = "hidden";
}

function textAlignment(value) {
  return ALIGNMENTS.has(value) ? value : "left";
}

function flexAlignment(value) {
  if (!VERTICAL_ALIGNMENTS.has(value)) return "flex-start";
  if (value === "middle") return "center";
  return value === "bottom" ? "flex-end" : "flex-start";
}

function textContent(box) {
  const prefix = box.bullet ? "• " : "";
  return esc(`${prefix}${box.text ?? ""}`).replace(/\n/g, "<br>");
}

function renderText(box, scale) {
  const element = document.createElement("div");
  applyPosition(element, box, scale);
  element.className = "ppt-box ppt-box--text";
  element.innerHTML = textContent(box);
  element.style.display = "flex";
  element.style.alignItems = flexAlignment(box.valign);
  element.style.justifyContent = box.align === "center" ? "center" : "flex-start";
  element.style.fontFamily = `${esc(box.font)}, sans-serif`;
  element.style.fontSize = `${pointPixels(box.size, scale)}px`;
  element.style.fontWeight = box.bold ? "700" : "400";
  element.style.fontStyle = box.italic ? "italic" : "normal";
  element.style.color = box.color;
  element.style.textAlign = textAlignment(box.align);
  element.style.lineHeight = String(finite(box.lineSpacing, 1.2));
  element.style.letterSpacing = `${finite(box.charSpacing) * scale}px`;
  element.style.whiteSpace = "normal";
  element.style.overflowWrap = "break-word";
  return element;
}

function renderRect(box, scale) {
  const element = document.createElement("div");
  applyPosition(element, box, scale);
  element.className = "ppt-box ppt-box--rect";
  element.style.background = box.fill;
  element.style.borderRadius = `${pixels(box.radius, scale)}px`;
  return element;
}

function skeleton(box, scale, message = "Foto gëtt gesicht…") {
  const element = document.createElement("div");
  applyPosition(element, box, scale);
  element.className = "ppt-box ppt-box--image ppt-box--skeleton";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", message);
  element.innerHTML = `<span>${esc(message)}</span>`;
  element.style.display = "grid";
  element.style.placeItems = "center";
  element.style.padding = `${pixels(0.2, scale)}px`;
  element.style.color = "rgba(127,127,127,.8)";
  element.style.background = "linear-gradient(110deg, rgba(127,127,127,.12) 8%, rgba(127,127,127,.24) 18%, rgba(127,127,127,.12) 33%)";
  element.style.backgroundSize = "200% 100%";
  element.style.fontSize = `${pointPixels(10, scale)}px`;
  element.style.borderRadius = `${pixels(box.radius, scale)}px`;
  return element;
}

function renderImage(box, scale) {
  if (!box.url) return skeleton(box, scale);
  const element = document.createElement("img");
  applyPosition(element, box, scale);
  element.className = "ppt-box ppt-box--image";
  element.alt = "";
  element.decoding = "async";
  element.loading = "eager";
  element.referrerPolicy = "no-referrer";
  element.src = box.url;
  element.style.objectFit = box.fit === "cover" ? "cover" : "contain";
  element.style.borderRadius = `${pixels(box.radius, scale)}px`;
  element.addEventListener("error", () => {
    console.warn("[ppt] D'Foto konnt net geluede ginn:", box.url);
    element.replaceWith(skeleton(box, scale, "Foto net disponibel"));
  }, { once: true });
  return element;
}

function renderBox(box, scale) {
  if (!box || typeof box !== "object") return null;
  if (box.kind === "text") return renderText(box, scale);
  if (box.kind === "image") return renderImage(box, scale);
  if (box.kind === "rect") return renderRect(box, scale);
  console.warn("[ppt] Onbekannte Box gouf iwwersprongen.", box.kind);
  return null;
}

function stageFor(layout, scale, className) {
  const stage = document.createElement("div");
  stage.className = className;
  stage.style.position = "relative";
  stage.style.width = `${pixels(layout.w, scale)}px`;
  stage.style.height = `${pixels(layout.h, scale)}px`;
  stage.style.flex = "0 0 auto";
  stage.style.overflow = "hidden";
  stage.style.background = layout.background?.fill || "#FFFFFF";
  stage.style.isolation = "isolate";
  return stage;
}

/** Render one immutable layout snapshot into a freshly replaced DOM stage. */
export function renderSlide(layout, hostEl, scale = DEFAULT_SCALE) {
  if (!(hostEl instanceof Element)) throw new Error("D'Virschau-Zil feelt.");
  if (!layout || !Array.isArray(layout.boxes)) throw new Error("D'Slide-Layout ass ongëlteg.");
  const resolvedScale = safeScale(scale);
  const stage = stageFor(layout, resolvedScale, "ppt-dom-stage");
  const children = layout.boxes.map((box) => renderBox(box, resolvedScale)).filter(Boolean);
  stage.append(...children);
  hostEl.replaceChildren(stage);
  return stage;
}

/** Render a filmstrip thumbnail using the same boxes as the main preview. */
export function renderThumb(layout, hostEl, scale = null) {
  if (!layout?.w) throw new Error("D'Miniatur huet kee gëltegt Layout.");
  const automaticScale = THUMB_WIDTH_PX / (layout.w * CSS_PIXELS_PER_INCH);
  const stage = renderSlide(layout, hostEl, scale == null ? automaticScale : scale);
  stage.classList.add("ppt-dom-stage--thumb");
  stage.setAttribute("aria-hidden", "true");
  return stage;
}

export { esc };
