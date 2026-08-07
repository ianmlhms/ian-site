import * as auth from "./auth.js?v=5";
import { DEFAULT_STYLE, resolveTokens } from "./ppt-style-packs.js?v=6";
import { ingestFiles, INGEST_LIMITS } from "./ppt-ingest.js?v=3";
import { createDeckGeneration } from "./ppt-ai.js?v=6";
import { fillDeckImages } from "./ppt-images.js?v=5";
import { exportPptx } from "./ppt-export-pptx.js?v=5";
import { exportPdf } from "./ppt-export-pdf.js?v=5";
import { exportCuesDocx, exportScriptDocx } from "./ppt-export-docx.js?v=6";
import { startPresenting } from "./ppt-present.js?v=5";
import { listDecks, loadDeck, saveDeck, deleteDeck, startNewDeck, scheduleAutosave } from "./ppt-store.js?v=5";
import { createHistory } from "./ppt-history.js?v=3";
import { createEditor } from "./ppt-editor.js?v=6";
import { createInspector } from "./ppt-inspector.js?v=6";
import { createAiActions } from "./ppt-ai-actions-ui.js?v=6";
import { createStudioShell, installStudioChrome } from "./studio-shell.js?v=2"; installStudioChrome();
const OWNER_EMAIL = "konto@ian.lu", DEFAULT_SLIDE_COUNT = 12;
const MAX_PRESENTERS = 6;
const RESIZE_WAIT_MS = 120;
const PROGRESS_HIDE_MS = 700;
const MENU_CLOSE_MS = 220, PPT_SCRIPT_SEED_KEY = "ian-doc-script-seed-v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[character]));
let selectedFiles = Object.freeze([]), currentDeck = null, currentStoreId = null;
let currentEngine = null, currentStyle = Object.freeze({ ...DEFAULT_STYLE }), selectedSlide = 0;
let isBusy = false, bootNumber = 0, resizeTimer = null;
let editor = null, inspector = null, aiActions = null, activeGeneration = null;
let apiFallbackRequested = false;
const history = createHistory();
function gate(title, message, canSignIn = false) {
  $("newDeck").hidden = true;
  $("root").className = "boot-root";
  $("root").innerHTML = `<section class="gate-panel glass glass--thick"><div class="gate-icon">▣</div>
    <h1>${esc(title)}</h1><p>${esc(message)}</p>
    ${canSignIn ? '<button class="primary-button" id="signIn" type="button">Umellen</button>' : ""}</section>`;
  if (canSignIn) $("signIn").onclick = () => auth.openAuthModal();
}
function inputPanelMarkup() {
  return `<aside class="input-panel glass glass--thick scroll-fade" data-panel="source" tabindex="-1">
      <div class="panel-heading"><span class="eyebrow">Quell</span><h1>Wat soll dran?</h1></div>
      <label class="field-label">Instruktiounen
        <textarea id="instructions" rows="7" placeholder="Aufgabestellung, Thema, wichteg Punkten…"></textarea></label>
      <div class="drop-zone" id="dropZone" tabindex="0" role="button" aria-label="Dateien dobäisetzen">
        <input id="fileInput" type="file" multiple accept=".pdf,.docx,.txt,.md,image/*">
        <span class="drop-icon">＋</span><strong>Dateien dobäisetzen</strong><small>PDF, DOCX oder Biller · max. 8</small></div>
      <div class="file-chips" id="fileChips"></div>
      <div class="field-row"><label class="field-label">Sproch<select id="lang"><option value="lb">Lëtzebuergesch</option>
        <option value="de" selected>Deutsch</option><option value="en">English</option><option value="fr">Français</option></select></label>
        <label class="field-label">Slides<input id="slideCount" type="number" min="10" max="30" value="${DEFAULT_SLIDE_COUNT}"></label></div>
      <label class="field-label">Fach<input id="subject" maxlength="120" placeholder="z. B. Geografie"></label>
      <label class="field-label">Virdroender<input id="presenterCount" type="number" min="1" max="${MAX_PRESENTERS}" value="1"></label>
      <div class="presenter-fields" id="presenterFields"></div>
      <label class="toggle-row skip-mini"><span>Mini iwwersprangen<small>Direkt iwwer d'API</small></span>
        <input id="skipMini" type="checkbox"><i aria-hidden="true"></i></label>
      <button class="primary-button generate-button" id="generate" type="button"><span>Generëieren</span><span aria-hidden="true">→</span></button>
      <div class="progress" id="progress" hidden><div class="progress-track"><i id="progressBar"></i></div><p id="progressText"></p>
        <div class="mini-actions" id="miniActions" hidden><button type="button" id="useApi">Iwwer d'API generéieren</button>
          <button type="button" id="cancelGeneration">Ofbriechen</button></div></div>
      <p class="status" id="status" role="status" aria-live="polite"></p>
      <div class="saved-heading"><span class="eyebrow">Gespäichert</span>
        <button class="icon-button" id="refreshDecks" type="button" aria-label="Lëscht aktualiséieren">↻</button></div>
      <div class="deck-list" id="deckList"><p class="muted">Lueden…</p></div>
    </aside>`;
}
function designerMarkup() {
  return `<section class="preview-column" data-panel="preview" tabindex="-1">
      <div class="preview-toolbar glass glass--chip"><div><span class="eyebrow">Live Virschau</span><strong id="slideLabel">Nach keng Slide</strong>
        <span class="engine-badge" id="engineLabel" hidden></span></div>
        <div class="preview-actions"><button class="icon-text-button" id="undo" type="button" disabled>↶ <span>Zréck</span></button>
          <button class="icon-text-button" id="redo" type="button" disabled>↷ <span>Nees viru</span></button>
          <div class="translate-control"><select id="translateLang" aria-label="Zilsprooch"><option value="lb">LB</option>
            <option value="de">DE</option><option value="en">EN</option><option value="fr">FR</option></select>
            <button class="icon-text-button" id="translateDeck" type="button" disabled>Iwwersetzen</button></div>
          <button class="icon-text-button" type="button" data-toggle-inspector aria-expanded="true">Designer</button>
          <div class="export-menu" id="exportMenu"><button class="icon-text-button export-button" id="exportTrigger" type="button"
            aria-haspopup="menu" aria-expanded="false" disabled>Exportéieren <span aria-hidden="true">⌄</span></button>
            <div class="export-popover solid-surface" id="exportPopover" role="menu" hidden>
              <button type="button" role="menuitem" data-export="pptx">PowerPoint (.pptx)</button>
              <button type="button" role="menuitem" data-export="pdf">PDF</button>
              <button type="button" role="menuitem" data-export="script">Word — Vollstännegen Text</button>
              <button type="button" role="menuitem" data-export="cues">Word — Stëchwierder</button>
              <button type="button" role="menuitem" data-export="doc">Schreif de Sprëchtext</button>
            </div></div>
          <button class="primary-button present-button" id="present" type="button" disabled>Presentéieren</button></div></div>
      <form class="revision-bar" id="reviseForm"><label><span>Änner déi ganz Präsentatioun</span>
        <input id="reviseInstruction" maxlength="1200" placeholder="z. B. méi kuerz, ouni d'Lëtzebuerg-Beispiller"></label>
        <button class="primary-button" id="reviseDeck" type="submit" disabled>Alles mat AI änneren</button>
        <small>Opgepasst: Dëst schreift all Slides nei. Eng Kéier „Zréck“ mécht déi ganz Ännerung réckgängeg.</small></form>
      <div class="slide-controls glass glass--chip" id="slideControls" hidden></div>
      <div class="preview-scroll scroll-fade"><div class="preview-host" id="previewHost">
        <div class="empty-preview"><span>▣</span><h2>Deng Präsentatioun erschéngt hei</h2><p>Instruktiounen dobäisetzen a generéieren.</p></div>
      </div></div>
    </section>
    <aside class="inspector-panel glass glass--thick scroll-fade" id="inspector" data-panel="inspector" tabindex="-1"></aside>`;
}
function appMarkup() {
  return `<div class="studio-grid" data-inspector="open"><nav class="panel-tabs glass glass--chip" role="tablist" aria-label="Studio Beräicher">
      <button type="button" role="tab" data-panel-target="source">Quell</button>
      <button type="button" role="tab" data-panel-target="preview">Virschau</button>
      <button type="button" role="tab" data-panel-target="inspector">Designer</button></nav>
      ${inputPanelMarkup()}${designerMarkup()}</div>
    <nav class="filmstrip glass glass--thick" id="filmstrip" aria-label="Slides">
      <div class="filmstrip-empty">Nach keng Slides</div></nav>`;
}
function setStatus(message, isError = false) {
  const element = $("status");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}
function setProgress(message, percent) {
  $("progress").hidden = false;
  $("progressText").textContent = message;
  $("progressBar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
function engineText(engine) {
  return engine === "mini" ? "Mac mini · €0" : "API";
}
function showEngine(engine) {
  const label = $("engineLabel");
  if (!label) return;
  label.hidden = !engine; label.textContent = engine ? engineText(engine) : "";
}
function elapsedText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function showMiniProgress(details) {
  setProgress(`🖥️ Mac mini · generéiert… (${elapsedText(details.elapsedMs)})`, 48);
  $("miniActions").hidden = false;
}
function presenterNames() {
  return Array.from($("presenterFields").querySelectorAll("input"))
    .map((input) => input.value.trim()).filter(Boolean);
}
function renderPresenters() {
  const count = Math.min(MAX_PRESENTERS, Math.max(1, Number($("presenterCount").value) || 1));
  const previous = presenterNames();
  $("presenterFields").innerHTML = Array.from({ length: count }, (_, index) => `<label class="field-label compact">Numm ${index + 1}
    <input maxlength="80" value="${esc(previous[index] || "")}" placeholder="Numm"></label>`).join("");
}
function renderFileChips() {
  $("fileChips").innerHTML = selectedFiles.map((file, index) => `<span class="file-chip"><span>${esc(file.name)}</span>
    <button type="button" data-remove-file="${index}" aria-label="${esc(file.name)} ewechhuelen">×</button></span>`).join("");
  $("fileChips").querySelectorAll("[data-remove-file]").forEach((button) => button.onclick = () => {
    selectedFiles = Object.freeze(selectedFiles.filter((_, index) => index !== Number(button.dataset.removeFile)));
    renderFileChips();
  });
}
function addFiles(fileList) {
  const combined = [...selectedFiles, ...Array.from(fileList || [])];
  if (combined.length > INGEST_LIMITS.maxFiles) {
    setStatus(`Maximal ${INGEST_LIMITS.maxFiles} Dateie sinn erlaabt.`, true); return;
  }
  selectedFiles = Object.freeze(combined); renderFileChips(); setStatus("");
}
function bindDropZone() {
  const zone = $("dropZone"); const input = $("fileInput");
  zone.onclick = () => input.click();
  zone.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); input.click(); } };
  input.onchange = () => { addFiles(input.files); input.value = ""; };
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("is-over"); }));
  zone.addEventListener("drop", (event) => addFiles(event.dataTransfer?.files));
}
function updateLabel() {
  const slide = currentDeck?.slides[selectedSlide];
  $("slideLabel").textContent = slide ? `${selectedSlide + 1} / ${currentDeck.slides.length} · ${slide.title}` : "Nach keng Slide";
}
function updateHistoryButtons() {
  $("undo").disabled = !history.canUndo();
  $("redo").disabled = !history.canRedo();
}
function scheduleSave() {
  if (!currentDeck) return;
  scheduleAutosave(currentDeck, currentStyle, (stored) => { currentStoreId = stored.id; setStatus("Automatesch gespäichert ✓"); });
}
function renderDesigner(index = selectedSlide) {
  if (!currentDeck) return;
  selectedSlide = Math.max(0, Math.min(index, currentDeck.slides.length - 1));
  $("slideControls").hidden = false;
  editor.render(selectedSlide); updateLabel(); updateHistoryButtons();
  aiActions?.refresh();
  $("exportTrigger").disabled = false; $("present").disabled = false;
}
function applyDeck(deck, meta, index) {
  currentDeck = deck; selectedSlide = index;
  history.push({ deck: currentDeck, style: currentStyle }, meta);
  renderDesigner(index); scheduleSave();
}
function applyStyle(style, meta) {
  currentStyle = style;
  if (!currentDeck) return;
  history.push({ deck: currentDeck, style: currentStyle }, meta);
  renderDesigner(); scheduleSave();
}
function restoreHistory(state) {
  if (!state) return;
  currentDeck = state.deck; currentStyle = state.style;
  selectedSlide = Math.min(selectedSlide, currentDeck.slides.length - 1);
  inspector.render(); renderDesigner(); scheduleSave();
}
function mountDesigner() {
  aiActions = createAiActions({ getDeck: () => currentDeck, getStyle: () => currentStyle,
    getIndex: () => selectedSlide, onDeck: applyDeck, setStatus,
    setLanguage: (lang) => { if ($("lang")) $("lang").value = lang; } });
  editor = createEditor({ previewHost: $("previewHost"), filmstrip: $("filmstrip"), controlsHost: $("slideControls"),
    getDeck: () => currentDeck, getStyle: () => currentStyle, onChange: applyDeck,
    onSelect: (index) => { selectedSlide = index; updateLabel(); },
    onRewrite: (index, intent, custom) => aiActions.rewrite(index, intent, custom) });
  inspector = createInspector($("inspector"), { getStyle: () => currentStyle, onChange: applyStyle });
}
function bindInputs() {
  bindDropZone();
  $("presenterCount").oninput = renderPresenters;
  $("generate").onclick = () => generate();
  $("useApi").onclick = () => { apiFallbackRequested = true; activeGeneration?.cancel(); };
  $("cancelGeneration").onclick = () => activeGeneration?.cancel();
  $("exportTrigger").onclick = toggleExportMenu;
  $("exportPopover").querySelectorAll("[data-export]").forEach((button) =>
    button.onclick = () => runExport(button.dataset.export, button));
  $("present").onclick = presentDeck;
  $("refreshDecks").onclick = refreshDeckList;
  $("undo").onclick = () => restoreHistory(history.undo());
  $("redo").onclick = () => restoreHistory(history.redo());
}
function renderApp() {
  editor?.dispose();
  $("root").className = "studio-root";
  $("root").innerHTML = appMarkup();
  $("newDeck").hidden = false;
  bindInputs(); renderPresenters(); mountDesigner(); createStudioShell($("root"), "source"); refreshDeckList();
}
async function generateOutline(request) {
  let force = $("skipMini").checked ? "api" : null;
  while (true) {
    apiFallbackRequested = false;
    activeGeneration = createDeckGeneration({ ...request, force }, { onProgress: showMiniProgress });
    try { return await activeGeneration.promise; }
    catch (error) {
      if (error?.name !== "AbortError" || !apiFallbackRequested) throw error;
      force = "api"; $("miniActions").hidden = true; setProgress("Iwwer d'API generéieren…", 42);
    } finally { activeGeneration = null; }
  }
}
async function generate() {
  if (isBusy) return;
  isBusy = true; $("generate").disabled = true; setStatus("");
  try {
    setProgress("Instruktioune liesen…", 14);
    const ingested = await ingestFiles(selectedFiles);
    const sourceText = [$("instructions").value.trim(), ingested.text].filter(Boolean).join("\n\n");
    startNewDeck(sourceText); currentStoreId = null;
    setProgress("Slides schreiwen…", 42);
    const result = await generateOutline({ instructions: sourceText, lang: $("lang").value, subject: $("subject").value,
      slideCount: Number($("slideCount").value), presenters: presenterNames(), images: ingested.images,
      schoolYear: currentStyle.schoolYear, authenticity: currentStyle.authenticity });
    const outline = result.deck; currentEngine = result.engine; showEngine(currentEngine);
    setProgress("Fotoe sichen…", 72);
    currentDeck = await fillDeckImages(outline); selectedSlide = 0;
    history.reset({ deck: currentDeck, style: currentStyle }); renderDesigner(0); document.querySelector('[data-panel-target="preview"]')?.click();
    setProgress("Präsentatioun späicheren…", 94);
    const stored = await saveDeck(currentDeck, currentStyle, currentEngine); currentStoreId = stored.id;
    setProgress("Fäerdeg", 100); setStatus(`Präsentatioun ass prett ✓ · ${engineText(currentEngine)}`); await refreshDeckList();
  } catch (error) { setStatus(error instanceof Error ? error.message : "Generéiere feelgeschloen.", true); }
  finally { isBusy = false; activeGeneration = null; $("generate").disabled = false; $("miniActions").hidden = true;
    setTimeout(() => { if ($("progress")) $("progress").hidden = true; }, PROGRESS_HIDE_MS); }
}
function setExportMenu(open, focusFirst = false) {
  const trigger = $("exportTrigger"); const popover = $("exportPopover");
  if (!trigger || !popover) return;
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    popover.hidden = false;
    requestAnimationFrame(() => { popover.classList.add("is-open"); if (focusFirst) popover.querySelector("button")?.focus(); });
    return;
  }
  popover.classList.remove("is-open");
  setTimeout(() => { if (trigger.getAttribute("aria-expanded") === "false") popover.hidden = true; }, MENU_CLOSE_MS);
}
function toggleExportMenu() {
  setExportMenu($("exportTrigger").getAttribute("aria-expanded") !== "true");
}
function exportDetails(kind) {
  const options = {
    pptx: { progress: "PowerPoint gëtt gebaut…", success: "PowerPoint ass erofgelueden ✓", run: () => exportPptx(currentDeck, resolveTokens(currentStyle)) },
    pdf: { progress: "PDF gëtt gebaut…", success: "PDF ass erofgelueden ✓", run: () => exportPdf(currentDeck, resolveTokens(currentStyle)) },
    script: { progress: "Vollstännegen Text gëtt gebaut…", success: "Vollstännegen Text ass erofgelueden ✓", run: () => exportScriptDocx(currentDeck) },
    cues: { progress: "Stëchwierder ginn gebaut…", success: "Stëchwierder sinn erofgelueden ✓", run: () => exportCuesDocx(currentDeck) },
    doc: { progress: "Sprëchtext gëtt virbereet…", success: "Word Builder gëtt opgemaach…", run: openScriptDocument },
  };
  return options[kind] || null;
}
function scriptSeedBlocks(deck) {
  const content = deck.slides.flatMap((slide, index) => {
    if (!slide.notes.trim()) return [];
    return [{ id: `${slide.id}-heading`, type: "heading", level: 2, text: `${index + 1} · ${slide.title}` }, { id: `${slide.id}-notes`, type: "paragraph", text: slide.notes }];
  });
  return content.length ? content : [{ id: "b1", type: "paragraph", text: "Nach kee Sprëchtext disponibel." }];
}
function openScriptDocument() {
  const sourceText = currentDeck.slides.map((slide) => `${slide.title}\n${slide.notes}`).join("\n\n");
  const words = sourceText.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length || 0;
  const seed = { document: { version: 1, kind: "script", title: `${currentDeck.title} — Sprëchtext`,
    subject: currentDeck.subject, lang: currentDeck.lang, blocks: scriptSeedBlocks(currentDeck) }, sourceText,
    settings: { schoolYear: currentStyle.schoolYear, authenticity: currentStyle.authenticity, targetWords: Math.max(80, words) } };
  sessionStorage.setItem(PPT_SCRIPT_SEED_KEY, JSON.stringify(seed)); window.location.href = "doc.html";
}
async function runExport(kind, button) {
  const details = exportDetails(kind);
  if (!currentDeck || !details || isBusy) return;
  isBusy = true; button.disabled = true; $("exportTrigger").disabled = true; $("present").disabled = true;
  setExportMenu(false); setStatus(details.progress);
  try { await details.run(); setStatus(details.success); }
  catch (error) { setStatus(error instanceof Error ? error.message : "Export feelgeschloen.", true); }
  finally {
    isBusy = false; button.disabled = false; $("exportTrigger").disabled = false; $("present").disabled = false; $("exportTrigger").focus();
  }
}
function presentDeck() {
  if (!currentDeck || isBusy) return;
  setExportMenu(false);
  try { startPresenting(currentDeck, resolveTokens(currentStyle), selectedSlide); setStatus("Presentatioun gestart."); }
  catch (error) { setStatus(error instanceof Error ? error.message : "Presentéiere feelgeschloen.", true); }
}
function deckRows(items) {
  if (!items.length) return '<p class="muted">Nach keng Präsentatioun gespäichert.</p>';
  return items.map((item) => `<article class="deck-row"><button type="button" data-open="${esc(item.id)}">
    <strong>${esc(item.title)}</strong><small>${esc(item.subject || item.lang.toUpperCase())}</small></button>
    <button class="delete-button" type="button" data-delete="${esc(item.id)}" aria-label="${esc(item.title)} läschen">×</button></article>`).join("");
}
async function refreshDeckList() {
  if (!$("deckList")) return;
  try {
    const items = await listDecks(); $("deckList").innerHTML = deckRows(items);
    $("deckList").querySelectorAll("[data-open]").forEach((button) => button.onclick = () => openStored(button.dataset.open));
    $("deckList").querySelectorAll("[data-delete]").forEach((button) => button.onclick = () => removeStored(button.dataset.delete));
  } catch (error) { $("deckList").innerHTML = `<p class="status is-error">${esc(error.message || "Lëscht net disponibel.")}</p>`; }
}
async function openStored(id) {
  try {
    const stored = await loadDeck(id); currentDeck = stored.deck; currentEngine = stored.engine === "mini" ? "mini" : "api";
    currentStyle = Object.freeze({ ...DEFAULT_STYLE, ...stored.style }); currentStoreId = stored.id; selectedSlide = 0;
    $("instructions").value = stored.sourceText; $("lang").value = currentDeck.lang; $("subject").value = currentDeck.subject || "";
    if ($("translateLang")) $("translateLang").value = currentDeck.lang;
    history.reset({ deck: currentDeck, style: currentStyle }); inspector.render(); renderDesigner(0); showEngine(currentEngine); document.querySelector('[data-panel-target="preview"]')?.click();
    setStatus(`Präsentatioun gelueden · ${engineText(currentEngine)}`);
  } catch (error) { setStatus(error.message || "Lueden feelgeschloen.", true); }
}
async function removeStored(id) {
  if (!confirm("Dës Präsentatioun wierklech läschen?")) return;
  try { await deleteDeck(id); if (currentStoreId === id) resetStudio(); await refreshDeckList(); }
  catch (error) { setStatus(error.message || "Läschen feelgeschloen.", true); }
}
function resetStudio() {
  activeGeneration?.cancel(); selectedFiles = Object.freeze([]); currentDeck = null; currentStoreId = null; currentEngine = null;
  aiActions = null;
  currentStyle = Object.freeze({ ...DEFAULT_STYLE }); selectedSlide = 0;
  history.reset(); startNewDeck(); renderApp();
}
function keyboardHistory(event) {
  const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable;
  if (editing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault(); restoreHistory(event.shiftKey ? history.redo() : history.undo());
}
function keyboardExportMenu(event) {
  const trigger = $("exportTrigger");
  if (!trigger) return;
  const open = trigger.getAttribute("aria-expanded") === "true";
  if (event.key === "ArrowDown" && event.target === trigger) {
    event.preventDefault(); setExportMenu(true, true); return;
  }
  if (event.key !== "Escape" || !open) return;
  event.preventDefault(); setExportMenu(false); trigger.focus();
}
function closeExportMenuOutside(event) {
  const menu = $("exportMenu");
  if (menu && !menu.contains(event.target)) setExportMenu(false);
}
async function boot() {
  const run = ++bootNumber;
  try {
    await auth.client(); if (run !== bootNumber) return;
    auth.mountAccountButton($("acctHost"));
    const session = auth.session();
    if (!session?.user) { gate("Presentatiounsstudio", "Mell dech un, fir däi private Studio opzemaachen.", true); return; }
    if ((session.user.email || "").toLowerCase() !== OWNER_EMAIL) { gate("Dësen Outil ass privat", "De PPT Builder ass nëmme fir säi Besëtzer fräigeschalt."); return; }
    renderApp();
  } catch { gate("Studio net disponibel", "D'Verbindung konnt net gestart ginn. Probéier et nach eng Kéier."); }
}
$("newDeck").onclick = resetStudio;
document.addEventListener("keydown", keyboardHistory);
document.addEventListener("keydown", keyboardExportMenu);
document.addEventListener("pointerdown", closeExportMenuOutside);
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => editor?.renderPreview(), RESIZE_WAIT_MS); });
window.addEventListener("ppt:store-error", (event) => setStatus(event.detail?.message || "Späicherfeeler", true));
window.addEventListener("ppt:export-warning", (event) => setStatus(event.detail?.message || "Fotoe feelen.", true));
auth.onAuth(boot);
boot();
