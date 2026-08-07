import { spring } from "./ppt-motion.js?v=3";
import { applyThemeContrast } from "./glass-contrast.js?v=1";

const NARROW_QUERY = "(max-width: 70rem)";
const PANEL_DURATION = 0.36;
const PANEL_BOUNCE = 0.04;
let contrastObserver = null;
let themeUpgradeQueued = false;

function themeColours(root) {
  const styles = getComputedStyle(root);
  return { palette: { "--card": styles.getPropertyValue("--card").trim(),
    "--bg": styles.getPropertyValue("--bg").trim() },
  accent: styles.getPropertyValue("--accent").trim() };
}

function refreshContrast(root) {
  const { palette, accent } = themeColours(root);
  if (!/^#[\da-f]{3,6}$/i.test(accent)) return;
  try { applyThemeContrast(root, palette, accent); }
  catch (error) { console.error("studio contrast", error); }
}

function installContrast() {
  const root = document.documentElement;
  refreshContrast(root);
  if (contrastObserver) return;
  contrastObserver = new MutationObserver(() => refreshContrast(root));
  contrastObserver.observe(root, { attributes: true, attributeFilter: ["style", "data-theme"] });
}

function upgradeThemeControls() {
  document.querySelectorAll("#themePop .th-sw").forEach((swatch) => {
    swatch.setAttribute("role", "button");
    swatch.setAttribute("tabindex", "0");
    swatch.setAttribute("aria-label", `Accent ${swatch.dataset.acc || ""}`);
    swatch.onkeydown = (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault(); swatch.click();
    };
  });
}

function ensureThemeControls() {
  if (document.getElementById("themePop")) { upgradeThemeControls(); return; }
  if (themeUpgradeQueued) return;
  themeUpgradeQueued = true;
  document.addEventListener("DOMContentLoaded", upgradeThemeControls, { once: true });
}

function panelButtons(root) {
  return [...root.querySelectorAll("[data-panel-target]")];
}

function validPanel(root, requested) {
  return panelButtons(root).some((button) => button.dataset.panelTarget === requested)
    ? requested : panelButtons(root)[0]?.dataset.panelTarget || "preview";
}

function syncTabs(root, panel) {
  panelButtons(root).forEach((button) => {
    const selected = button.dataset.panelTarget === panel;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function panelElement(root, panel) {
  return root.querySelector(`[data-panel="${panel}"]`);
}

function settle(element) {
  if (!element) return;
  spring(element, { y: 0, scale: 1, opacity: 1 }, {
    duration: PANEL_DURATION,
    bounce: PANEL_BOUNCE,
  });
}

function selectPanel(root, requested, focus = false) {
  const panel = validPanel(root, requested);
  root.dataset.activePanel = panel;
  syncTabs(root, panel);
  settle(panelElement(root, panel));
  if (focus) panelElement(root, panel)?.focus({ preventScroll: true });
}

function moveTab(root, event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const buttons = panelButtons(root);
  const current = buttons.indexOf(event.currentTarget);
  const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  selectPanel(root, buttons[target].dataset.panelTarget);
  buttons[target].focus();
}

function bindTabs(root) {
  panelButtons(root).forEach((button) => {
    button.onclick = () => selectPanel(root, button.dataset.panelTarget, true);
    button.onkeydown = (event) => moveTab(root, event);
  });
}

function bindInspector(root) {
  const trigger = root.querySelector("[data-toggle-inspector]");
  if (!trigger) return;
  trigger.onclick = () => {
    if (matchMedia(NARROW_QUERY).matches) { selectPanel(root, "inspector", true); return; }
    const closed = root.dataset.inspector === "closed";
    root.dataset.inspector = closed ? "open" : "closed";
    trigger.setAttribute("aria-expanded", String(closed));
    if (closed) settle(panelElement(root, "inspector"));
  };
}

function settleSurfaces(root) {
  root.querySelectorAll(".glass").forEach((surface) => settle(surface));
}

/** Bind responsive studio panels and return a small immutable controller. */
export function createStudioShell(root, defaultPanel = "preview") {
  if (!(root instanceof Element)) throw new TypeError("De Studio-Shell feelt.");
  installStudioChrome();
  bindTabs(root);
  bindInspector(root);
  selectPanel(root, defaultPanel);
  requestAnimationFrame(() => settleSurfaces(root));
  return Object.freeze({
    select: (panel, focus = false) => selectPanel(root, panel, focus),
    inspectorOpen: () => root.dataset.inspector !== "closed",
  });
}

export function installStudioChrome() {
  document.body.classList.add("studio-active");
  installContrast();
  ensureThemeControls();
}
