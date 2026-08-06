import { DEFAULT_STYLE, STYLE_PACKS, resolveTokens, styleForPack } from "./ppt-style-packs.js?v=3";
import { esc } from "./ppt-render-dom.js?v=3";

const CONTROLS = Object.freeze([
  { key: "titleScale", label: "Titelgréisst", min: 0.8, max: 1.3, step: 0.05 },
  { key: "density", label: "Textdicht", min: 3, max: 8, step: 1 },
  { key: "imageArea", label: "Bildfläch", min: 0.25, max: 0.65, step: 0.01 },
  { key: "radius", label: "Eckeradius", min: 0, max: 24, step: 1 },
]);
const PHOTO_OPTIONS = Object.freeze([
  ["inset", "Inset"], ["rounded", "Ronn"], ["full-bleed", "Vollfläch"],
]);

function styleCards(style) {
  return Object.values(STYLE_PACKS).map((pack) => {
    const selected = style.pack === pack.id;
    return `<button class="style-card${selected ? " is-selected" : ""}" type="button"
      data-inspector-pack="${esc(pack.id)}" aria-pressed="${selected}">
      <span class="style-preview style-preview--${esc(pack.id)}"><i>Aa</i><b></b><b></b></span>
      <strong>${esc(pack.name)}</strong><small>${esc(pack.description)}</small></button>`;
  }).join("");
}

function numberText(key, value) {
  if (key === "titleScale") return `${Math.round(value * 100)}%`;
  if (key === "imageArea") return `${Math.round(value * 100)}%`;
  if (key === "radius") return `${Math.round(value)} px`;
  return String(Math.round(value));
}

function rangeMarkup(control, style) {
  const value = Number(style[control.key] ?? DEFAULT_STYLE[control.key]);
  return `<label class="inspector-control"><span>${esc(control.label)}
      <output data-value-for="${esc(control.key)}">${esc(numberText(control.key, value))}</output></span>
    <input type="range" data-style-key="${esc(control.key)}" min="${control.min}" max="${control.max}"
      step="${control.step}" value="${value}"></label>`;
}

function toggleMarkup(key, label, checked, inherited = false) {
  return `<label class="toggle-row"><span>${esc(label)}${inherited ? "<small> · Pack</small>" : ""}</span>
    <input type="checkbox" data-style-toggle="${esc(key)}"${checked ? " checked" : ""}><i></i></label>`;
}

function treatmentMarkup(style) {
  return PHOTO_OPTIONS.map(([value, label]) => `<button type="button" data-treatment="${esc(value)}"
    class="${style.photoTreatment === value ? "is-selected" : ""}" aria-pressed="${style.photoTreatment === value}">
    ${esc(label)}</button>`).join("");
}

function inspectorMarkup(style) {
  const tokens = resolveTokens(style);
  const inherited = style.alternating == null;
  return `<div class="inspector-heading"><span class="eyebrow">Designer</span><h2>Stil</h2></div>
    <div class="style-grid inspector-packs">${styleCards(style)}</div>
    <div class="inspector-section"><label class="inspector-control accent-control"><span>Akzentfaarf
      <output>${esc(tokens.accent)}</output></span><span><input type="color" data-style-color value="${esc(tokens.accent)}">
      <button type="button" data-reset-accent>Pack</button></span></label>
      ${CONTROLS.map((control) => rangeMarkup(control, style)).join("")}
      ${toggleMarkup("alternating", "Ofwiesselnd Sektiounen", tokens.alternating, inherited)}
      <button class="inherit-style" type="button" data-inherit-alternating>Vum Pack iwwerhuelen</button>
      ${toggleMarkup("footer", "Virdroender-Fouss", tokens.footer)}
      <div class="inspector-control"><span>Fotobehandlung</span>
        <div class="segmented" role="group" aria-label="Fotobehandlung">${treatmentMarkup(style)}</div></div>
    </div>
    <button class="reset-style" type="button" data-reset-style>Zerécksetzen</button>`;
}

function frozenStyle(style, patch) {
  return Object.freeze({ ...DEFAULT_STYLE, ...style, ...patch });
}

class StyleInspector {
  constructor(host, getStyle, onChange) {
    if (!(host instanceof Element) || typeof getStyle !== "function" || typeof onChange !== "function") {
      throw new Error("De Stil-Inspector kann net gestart ginn.");
    }
    this.host = host;
    this.getStyle = getStyle;
    this.onChange = onChange;
  }

  emit(patch, meta = null) {
    const next = frozenStyle(this.getStyle(), patch);
    this.onChange(next, meta);
    return next;
  }

  bindRanges() {
    this.host.querySelectorAll("[data-style-key]").forEach((input) => {
      input.oninput = () => {
        const key = input.dataset.styleKey;
        const value = Number(input.value);
        const output = this.host.querySelector(`[data-value-for="${key}"]`);
        if (output) output.value = numberText(key, value);
        this.emit({ [key]: value }, { kind: "style", field: key });
      };
    });
  }

  bindPacks() {
    this.host.querySelectorAll("[data-inspector-pack]").forEach((button) => {
      button.onclick = () => {
        const next = styleForPack(button.dataset.inspectorPack);
        this.onChange(next, { kind: "style", field: "pack" });
        this.render();
      };
    });
  }

  bindToggles() {
    this.host.querySelectorAll("[data-style-toggle]").forEach((input) => {
      input.oninput = () => {
        const key = input.dataset.styleToggle;
        this.emit({ [key]: input.checked }, { kind: "style", field: key });
        this.render();
      };
    });
  }

  bindColour() {
    const colour = this.host.querySelector("[data-style-color]");
    colour.oninput = () => {
      const meta = { kind: "style", field: "accent" };
      const next = this.emit({ accent: colour.value.toUpperCase() }, meta);
      colour.closest("label").querySelector("output").value = resolveTokens(next).accent;
    };
    this.host.querySelector("[data-reset-accent]").onclick = () => {
      this.emit({ accent: null }, { kind: "style", field: "accent" });
      this.render();
    };
  }

  bindTreatment() {
    this.host.querySelectorAll("[data-treatment]").forEach((button) => {
      button.onclick = () => {
        const meta = { kind: "style", field: "photoTreatment" };
        this.emit({ photoTreatment: button.dataset.treatment }, meta);
        this.render();
      };
    });
  }

  bindReset() {
    this.host.querySelector("[data-inherit-alternating]").onclick = () => {
      this.emit({ alternating: null }, { kind: "style", field: "alternating" });
      this.render();
    };
    this.host.querySelector("[data-reset-style]").onclick = () => {
      const next = styleForPack(this.getStyle().pack);
      this.onChange(next, { kind: "style", field: "reset" });
      this.render();
    };
  }

  render() {
    this.host.innerHTML = inspectorMarkup(frozenStyle(this.getStyle(), {}));
    this.bindRanges();
    this.bindPacks();
    this.bindToggles();
    this.bindColour();
    this.bindTreatment();
    this.bindReset();
  }
}

/** Mount live style controls without putting a debounce in the render path. */
export function createInspector(host, { getStyle, onChange }) {
  const inspector = new StyleInspector(host, getStyle, onChange);
  inspector.render();
  return Object.freeze({ render: () => inspector.render() });
}
