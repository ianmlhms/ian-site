import { esc } from "./ppt-render-dom.js?v=5";

const INTENTS = Object.freeze([
  ["rewrite", "Nei schreiwen"], ["shorter", "Méi kuerz"], ["longer", "Méi laang"],
  ["more-data", "Méi Daten"], ["simpler", "Méi einfach"], ["custom", "Eegen Uweisung…"],
]);

function layoutOptions(slide) {
  if (slide.layout === "title") return ["title", "section", "bullets", "closing"];
  if (slide.layout === "sources" && slide.sources.length) return ["sources"];
  const options = new Set(["bullets", "toc", "section", "quiz"]);
  if (slide.bullets.length || slide.image) options.add("bullets-image");
  if (slide.image) { options.add("image-full"); options.add("photo-numbered"); }
  if (slide.fields.length) options.add("example");
  if (slide.chart) options.add("chart");
  if (!slide.bullets.length) options.add("closing");
  options.add(slide.layout);
  return [...options];
}

function layoutName(layout) {
  return ({ title: "Titel", toc: "Iwwersiicht", bullets: "Text", "bullets-image": "Text + Foto",
    "image-full": "Foto voll", "photo-numbered": "Foto nummeréiert", example: "Beispill",
    sources: "Quellen", closing: "Ofschloss", chart: "Diagramm", quiz: "Quiz",
    section: "Sektioun" })[layout] || layout;
}

function markup(deck, slide, index) {
  const presenters = ['<option value="">—</option>', ...deck.presenters.map((name) =>
    `<option value="${esc(name)}"${slide.presenter === name ? " selected" : ""}>${esc(name)}</option>`)].join("");
  const layouts = layoutOptions(slide).map((layout) =>
    `<option value="${esc(layout)}"${slide.layout === layout ? " selected" : ""}>${esc(layoutName(layout))}</option>`).join("");
  const intents = INTENTS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  return `<label>Layout<select data-slide-layout>${layouts}</select></label>
    <button type="button" data-move="-1"${index === 0 ? " disabled" : ""}>←</button>
    <button type="button" data-move="1"${index === deck.slides.length - 1 ? " disabled" : ""}>→</button>
    <button type="button" data-duplicate>Duebelen</button><button type="button" data-delete>Läschen</button>
    <label>Virdroender<select data-slide-presenter>${presenters}</select></label>
    <button type="button" data-edit-notes>Notizen</button><button type="button" data-photo-picker>Foto sichen</button>
    <label>AI<select data-rewrite-intent>${intents}</select></label><button type="button" data-rewrite>Uwenden</button>`;
}

function bindMoves(host, config) {
  host.querySelectorAll("[data-move]").forEach((button) => button.onclick = () =>
    config.onMove(Number(button.dataset.move)));
  host.querySelector("[data-duplicate]").onclick = config.onDuplicate;
  host.querySelector("[data-delete]").onclick = config.onDelete;
}

function bindRewrite(host, config) {
  const button = host.querySelector("[data-rewrite]");
  button.onclick = async () => {
    const intent = host.querySelector("[data-rewrite-intent]").value;
    const custom = intent === "custom" ? prompt("Wéi soll dës Slide geschriwwe ginn?") : "";
    if (intent === "custom" && custom == null) return;
    button.disabled = true;
    try { await config.onRewrite(intent, custom || ""); }
    finally { if (button.isConnected) button.disabled = false; }
  };
}

export function mountSlideControls(host, config) {
  host.innerHTML = markup(config.deck, config.slide, config.index);
  host.querySelector("[data-slide-layout]").onchange = (event) => config.onLayout(event.target.value);
  host.querySelector("[data-slide-presenter]").onchange = (event) => config.onPresenter(event.target.value || null);
  host.querySelector("[data-edit-notes]").onclick = config.onNotes;
  host.querySelector("[data-photo-picker]").onclick = config.onPhoto;
  bindMoves(host, config);
  bindRewrite(host, config);
}
