import * as auth from "./auth.js?v=8";
import { ingestFiles, INGEST_LIMITS } from "./ppt-ingest.js?v=3"; // Shared studio ingest; historical prefix kept intentionally.
import { createDocumentGeneration, reviseDocument, rewriteDocument } from "./doc-ai.js?v=5";
import { documentText, validateDocument } from "./doc-schema.js?v=1";
import { replaceBlock } from "./doc-ops.js?v=1";
import { exportDocumentDocx } from "./doc-export.js?v=5";
import { createHistory } from "./ppt-history.js?v=3";
import { createDocumentEditor, esc } from "./doc-editor.js?v=1";
import { createStudioShell, installStudioChrome } from "./studio-shell.js?v=1"; installStudioChrome();
import { deleteDocument, listDocuments, loadDocument, saveDocument,
  scheduleAutosave, startNewDocument } from "./doc-store.js?v=4";

const OWNER_EMAIL = "konto@ian.lu";
const DEFAULT_WORDS = 500;
const PROGRESS_HIDE_MS = 700;
const PPT_SCRIPT_SEED_KEY = "ian-doc-script-seed-v1";
const TYPES = Object.freeze([
  ["argumentation", "Argumentatioun", "Positioun, Argumenter, Géigenargument"],
  ["research", "Recherche", "Fakten, Datumen a Quellen"],
  ["script", "Sprëchtext", "Text fir eng Presentatioun"],
  ["summary", "Zesummefaassung", "Dat Wichtegst aus enger Quell"],
  ["review", "Review", "Buch oder Film bewäerten"],
  ["steckbrief", "Steckbrief", "Kloer Felder mat :"],
  ["free", "Fräi", "All aner Aufgab"],
]);
const $ = (id) => document.getElementById(id);
let selectedFiles = Object.freeze([]);
let currentDocument = null;
let currentStoreId = null;
let currentEngine = null;
let settings = Object.freeze({ schoolYear: "4e", authenticity: 75, targetWords: DEFAULT_WORDS });
let isBusy = false;
let bootNumber = 0;
let editor = null;
let activeGeneration = null;
let apiFallbackRequested = false;
const history = createHistory();

function gate(title, message, canSignIn = false) {
  $("newDocument").hidden = true;
  $("root").className = "boot-root";
  $("root").innerHTML = `<section class="gate-panel glass glass--thick"><div class="gate-icon">▤</div>
    <h1>${esc(title)}</h1><p>${esc(message)}</p>
    ${canSignIn ? '<button class="primary-button" id="signIn" type="button">Umellen</button>' : ""}</section>`;
  if (canSignIn) $("signIn").onclick = () => auth.openAuthModal();
}

function typeCards() {
  return TYPES.map(([value, label, detail], index) => `<label class="doc-type-card">
    <input type="radio" name="documentType" value="${value}"${index === 0 ? " checked" : ""}>
    <span><strong>${esc(label)}</strong><small>${esc(detail)}</small></span></label>`).join("");
}

function inputPanel() {
  return `<aside class="input-panel glass glass--thick scroll-fade" data-panel="source" tabindex="-1"><div class="panel-heading">
      <span class="eyebrow">Quell</span><h1>Wat soll geschriwwe ginn?</h1></div>
    <label class="field-label">Instruktiounen<textarea id="instructions" rows="7"
      placeholder="Aufgabestellung, Thema, wichteg Punkten…"></textarea></label>
    <div class="drop-zone" id="dropZone" tabindex="0" role="button" aria-label="Dateien dobäisetzen">
      <input id="fileInput" type="file" multiple accept=".pdf,.docx,.txt,.md,image/*">
      <span class="drop-icon">＋</span><strong>Dateien dobäisetzen</strong><small>PDF, DOCX oder Biller · max. 8</small></div>
    <div class="file-chips" id="fileChips"></div><span class="eyebrow type-eyebrow">Dokumenttyp</span>
    <div class="doc-type-grid">${typeCards()}</div>
    <div class="field-row"><label class="field-label">Sprooch<select id="lang"><option value="lb">Lëtzebuergesch</option>
      <option value="de" selected>Deutsch</option><option value="en">English</option><option value="fr">Français</option></select></label>
      <label class="field-label">Wierder<input id="targetWords" type="number" min="80" max="5000" value="${DEFAULT_WORDS}"></label></div>
    <label class="field-label">Fach<input id="subject" maxlength="120" placeholder="z. B. Geografie"></label>
    <div class="voice-box"><span class="eyebrow">Deng Stëmm</span><div class="field-row">
      <label class="field-label">Schouljoer<select id="schoolYear"><option>7e</option><option>6e</option><option>5e</option>
        <option value="4e" selected>4e · aktuell 2026–27</option><option>3e</option><option>2e</option><option>1ère</option></select></label>
      <label class="field-label authenticity-label">Authentizitéit <output id="authenticityValue">75</output>
        <input id="authenticity" type="range" min="0" max="100" value="75"></label></div></div>
    <label class="toggle-row skip-mini"><span>Mini iwwersprangen<small>Direkt iwwer d'API</small></span>
      <input id="skipMini" type="checkbox"><i aria-hidden="true"></i></label>
    <button class="primary-button generate-button" id="generate" type="button"><span>Generéieren</span><span aria-hidden="true">→</span></button>
    <div class="progress" id="progress" hidden><div class="progress-track"><i id="progressBar"></i></div><p id="progressText"></p>
      <div class="mini-actions" id="miniActions" hidden><button type="button" id="useApi">Iwwer d'API generéieren</button>
        <button type="button" id="cancelGeneration">Ofbriechen</button></div></div>
    <p class="status" id="status" role="status" aria-live="polite"></p>
    <div class="saved-heading"><span class="eyebrow">Gespäichert</span>
      <button class="icon-button" id="refreshDocuments" type="button" aria-label="Lëscht aktualiséieren">↻</button></div>
    <div class="deck-list" id="documentList"><p class="muted">Lueden…</p></div></aside>`;
}

function previewPanel() {
  return `<section class="doc-preview-column" data-panel="preview" tabindex="-1"><div class="preview-toolbar glass glass--chip"><div>
      <span class="eyebrow">Live Virschau</span><strong id="documentLabel">Nach keen Dokument</strong>
      <span class="engine-badge" id="engineLabel" hidden></span></div><div class="preview-actions">
      <button class="icon-text-button" id="undo" type="button" disabled>↶ <span>Zréck</span></button>
      <button class="icon-text-button" id="redo" type="button" disabled>↷ <span>Nees viru</span></button>
      <button class="icon-text-button" id="copyText" type="button" disabled>Kopéieren</button>
      <button class="primary-button" id="exportDocx" type="button" disabled>Word exportéieren</button></div></div>
    <form class="revision-bar" id="reviseForm"><label><span>Änner dat ganzt Dokument</span>
      <input id="reviseInstruction" maxlength="1200" placeholder="z. B. méi kuerz, ouni d'Lëtzebuerg-Beispiller"></label>
      <button class="primary-button" id="reviseDocument" type="submit" disabled>Alles mat AI änneren</button>
      <small>Opgepasst: Dëst schreift all Bléck nei. Eng Kéier „Zréck“ mécht déi ganz Ännerung réckgängeg.</small></form>
    <div class="doc-controls glass glass--chip" id="docControls" hidden></div>
    <div class="doc-preview-scroll"><div class="doc-preview-host" id="docPreviewHost">
      <div class="empty-preview"><span>▤</span><h2>Däin Dokument erschéngt hei</h2><p>Instruktiounen dobäisetzen a generéieren.</p></div>
    </div></div></section>`;
}

function renderApp() {
  editor?.dispose();
  $("root").className = "doc-studio-root";
  $("root").innerHTML = `<div class="doc-studio-grid"><nav class="panel-tabs glass glass--chip" role="tablist" aria-label="Studio Beräicher">
      <button type="button" role="tab" data-panel-target="source">Quell</button>
      <button type="button" role="tab" data-panel-target="preview">Virschau</button></nav>
      ${inputPanel()}${previewPanel()}</div>`;
  $("newDocument").hidden = false;
  bindInputs(); mountEditor(); createStudioShell($("root"), "source"); refreshDocumentList(); consumeDeckSeed();
}

function setStatus(message, error = false) {
  if (!$("status")) return;
  $("status").textContent = message; $("status").classList.toggle("is-error", error);
}

function setProgress(message, percent) {
  $("progress").hidden = false; $("progressText").textContent = message;
  $("progressBar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function elapsedText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function showMiniProgress(details) {
  setProgress(`🖥️ Mac mini · schreift… (${elapsedText(details.elapsedMs)})`, 48);
  $("miniActions").hidden = false;
}

function showEngine(engine) {
  const label = $("engineLabel");
  label.hidden = !engine; label.textContent = engine === "mini" ? "Mac mini · €0" : engine ? "API" : "";
}

function readSettings() {
  settings = Object.freeze({ schoolYear: $("schoolYear").value,
    authenticity: Number($("authenticity").value), targetWords: Number($("targetWords").value) });
  return settings;
}

function selectedType() {
  return document.querySelector('input[name="documentType"]:checked')?.value || "free";
}

function renderFileChips() {
  $("fileChips").innerHTML = selectedFiles.map((file, index) => `<span class="file-chip"><span>${esc(file.name)}</span>
    <button type="button" data-remove-file="${index}" aria-label="${esc(file.name)} ewechhuelen">×</button></span>`).join("");
  $("fileChips").querySelectorAll("[data-remove-file]").forEach((button) => button.onclick = () => {
    selectedFiles = Object.freeze(selectedFiles.filter((_, index) => index !== Number(button.dataset.removeFile)));
    renderFileChips();
  });
}

function addFiles(files) {
  const combined = [...selectedFiles, ...Array.from(files || [])];
  if (combined.length > INGEST_LIMITS.maxFiles) { setStatus(`Maximal ${INGEST_LIMITS.maxFiles} Dateie sinn erlaabt.`, true); return; }
  selectedFiles = Object.freeze(combined); renderFileChips(); setStatus("");
}

function bindDrop() {
  const zone = $("dropZone"); const input = $("fileInput");
  zone.onclick = () => input.click();
  zone.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); input.click(); } };
  input.onchange = () => { addFiles(input.files); input.value = ""; };
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("is-over"); }));
  zone.addEventListener("drop", (event) => addFiles(event.dataTransfer?.files));
}

function bindInputs() {
  bindDrop();
  $("authenticity").oninput = () => { $("authenticityValue").value = $("authenticity").value; readSettings(); };
  ["schoolYear", "targetWords"].forEach((id) => $(id).onchange = readSettings);
  $("generate").onclick = generate;
  $("useApi").onclick = () => { apiFallbackRequested = true; activeGeneration?.cancel(); };
  $("cancelGeneration").onclick = () => activeGeneration?.cancel();
  $("refreshDocuments").onclick = refreshDocumentList;
  $("undo").onclick = () => restoreHistory(history.undo());
  $("redo").onclick = () => restoreHistory(history.redo());
  $("exportDocx").onclick = exportWord;
  $("copyText").onclick = copyText;
  $("reviseForm").onsubmit = (event) => { event.preventDefault(); rewriteWhole(); };
}

function mountEditor() {
  editor = createDocumentEditor({ host: $("docPreviewHost"), controls: $("docControls"),
    getDocument: () => currentDocument, onChange: applyDocument, onRewrite: rewriteBlock });
}

function updateHistoryButtons() {
  $("undo").disabled = !history.canUndo(); $("redo").disabled = !history.canRedo();
}

function renderDocument() {
  if (!currentDocument) return;
  $("docControls").hidden = false; editor.render(); updateHistoryButtons();
  $("documentLabel").textContent = currentDocument.title;
  ["exportDocx", "copyText", "reviseDocument"].forEach((id) => $(id).disabled = false);
}

function scheduleSave() {
  if (!currentDocument) return;
  scheduleAutosave(currentDocument, settings, (stored) => { currentStoreId = stored.id; setStatus("Automatesch gespäichert ✓"); });
}

function applyDocument(document, meta = null) {
  currentDocument = validateDocument(document);
  history.push({ deck: currentDocument, style: settings }, meta); renderDocument(); scheduleSave();
}

function restoreHistory(state) {
  if (!state) return;
  currentDocument = state.deck; settings = state.style; renderDocument(); scheduleSave();
}

async function generateThroughPreferredEngine(request) {
  let force = $("skipMini").checked ? "api" : null;
  while (true) {
    apiFallbackRequested = false;
    activeGeneration = createDocumentGeneration({ ...request, force }, { onProgress: showMiniProgress });
    try { return await activeGeneration.promise; }
    catch (error) {
      if (error?.name !== "AbortError" || !apiFallbackRequested) throw error;
      force = "api"; $("miniActions").hidden = true; setProgress("Iwwer d'API schreiwen…", 42);
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
    startNewDocument(sourceText); currentStoreId = null; setProgress("Dokument schreiwen…", 42);
    const result = await generateThroughPreferredEngine({ instructions: sourceText, images: ingested.images,
      documentType: selectedType(), lang: $("lang").value, subject: $("subject").value, ...readSettings() });
    currentDocument = result.document; currentEngine = result.engine; showEngine(currentEngine);
    history.reset({ deck: currentDocument, style: settings }); renderDocument(); document.querySelector('[data-panel-target="preview"]')?.click(); setProgress("Dokument späicheren…", 92);
    const stored = await saveDocument(currentDocument, settings, currentEngine); currentStoreId = stored.id;
    setProgress("Fäerdeg", 100); setStatus(`Dokument ass prett ✓ · ${currentEngine === "mini" ? "Mac mini · €0" : "API"}`);
    await refreshDocumentList();
  } catch (error) { setStatus(error instanceof Error ? error.message : "Generéiere feelgeschloen.", true); }
  finally { isBusy = false; activeGeneration = null; $("generate").disabled = false; $("miniActions").hidden = true;
    setTimeout(() => { if ($("progress")) $("progress").hidden = true; }, PROGRESS_HIDE_MS); }
}

async function rewriteBlock(blockId, intent, custom) {
  if (!currentDocument || isBusy) return;
  isBusy = true; setStatus("AI ännert de Block…");
  try {
    const response = await rewriteDocument(currentDocument, blockId, intent, custom, readSettings());
    currentEngine = response.engine; showEngine(currentEngine);
    applyDocument(replaceBlock(currentDocument, blockId, response.result), { kind: "rewrite" }); setStatus("Block geännert ✓");
  } catch (error) { setStatus(error.message || "Ëmschreiwe feelgeschloen.", true); }
  finally { isBusy = false; }
}

async function rewriteWhole() {
  if (!currentDocument || isBusy) return;
  const custom = $("reviseInstruction").value.trim();
  if (!custom) { setStatus("Gëff eng Uweisung fir dat ganzt Dokument an.", true); return; }
  if (!confirm("Dëst schreift dat ganzt Dokument nei. Weiderfueren?")) return;
  isBusy = true; setStatus("AI ännert dat ganzt Dokument…");
  try {
    $("reviseDocument").disabled = true;
    const response = await reviseDocument(currentDocument, custom, readSettings(), { onProgress: showMiniProgress });
    currentEngine = response.engine; showEngine(currentEngine); applyDocument(response.result, { kind: "revise", instruction: custom });
    $("reviseInstruction").value = ""; setStatus("Ganzt Dokument geännert ✓ · Zréck mécht alles réckgängeg.");
  } catch (error) { setStatus(error.message || "Ëmschreiwe feelgeschloen.", true); }
  finally { isBusy = false; $("reviseDocument").disabled = !currentDocument; }
}

async function exportWord() {
  if (!currentDocument || isBusy) return;
  isBusy = true; $("exportDocx").disabled = true; setStatus("Word-Datei gëtt gebaut…");
  try { await exportDocumentDocx(currentDocument); setStatus("Word-Datei ass erofgelueden ✓"); }
  catch (error) { setStatus(error.message || "Export feelgeschloen.", true); }
  finally { isBusy = false; $("exportDocx").disabled = false; }
}

async function copyText() {
  if (!currentDocument) return;
  try { await navigator.clipboard.writeText(documentText(currentDocument)); setStatus("Text kopéiert ✓"); }
  catch { setStatus("De Text konnt net kopéiert ginn.", true); }
}

function documentRows(items) {
  if (!items.length) return '<p class="muted">Nach keen Dokument gespäichert.</p>';
  return items.map((item) => `<article class="deck-row"><button type="button" data-open="${esc(item.id)}">
    <strong>${esc(item.title)}</strong><small>${esc(item.subject || item.kind)}</small></button>
    <button class="delete-button" type="button" data-delete="${esc(item.id)}" aria-label="${esc(item.title)} läschen">×</button></article>`).join("");
}

async function refreshDocumentList() {
  if (!$("documentList")) return;
  try {
    const items = await listDocuments(); $("documentList").innerHTML = documentRows(items);
    $("documentList").querySelectorAll("[data-open]").forEach((button) => button.onclick = () => openStored(button.dataset.open));
    $("documentList").querySelectorAll("[data-delete]").forEach((button) => button.onclick = () => removeStored(button.dataset.delete));
  } catch (error) { $("documentList").innerHTML = `<p class="status is-error">${esc(error.message || "Lëscht net disponibel.")}</p>`; }
}

async function openStored(id) {
  try {
    const stored = await loadDocument(id); currentDocument = stored.document; currentEngine = stored.engine === "mini" ? "mini" : "api";
    settings = Object.freeze({ ...settings, ...stored.settings }); currentStoreId = stored.id;
    $("instructions").value = stored.sourceText; $("lang").value = currentDocument.lang; $("subject").value = currentDocument.subject || "";
    $("schoolYear").value = settings.schoolYear; $("authenticity").value = settings.authenticity;
    $("authenticityValue").value = settings.authenticity; $("targetWords").value = settings.targetWords;
    const type = document.querySelector(`input[name="documentType"][value="${currentDocument.kind}"]`); if (type) type.checked = true;
    history.reset({ deck: currentDocument, style: settings }); renderDocument(); showEngine(currentEngine); document.querySelector('[data-panel-target="preview"]')?.click(); setStatus("Dokument gelueden.");
  } catch (error) { setStatus(error.message || "Lueden feelgeschloen.", true); }
}

async function removeStored(id) {
  if (!confirm("Dëst Dokument wierklech läschen?")) return;
  try { await deleteDocument(id); if (currentStoreId === id) resetStudio(); await refreshDocumentList(); }
  catch (error) { setStatus(error.message || "Läschen feelgeschloen.", true); }
}

function consumeDeckSeed() {
  let raw = null;
  try { raw = sessionStorage.getItem(PPT_SCRIPT_SEED_KEY); sessionStorage.removeItem(PPT_SCRIPT_SEED_KEY); }
  catch { return; }
  if (!raw) return;
  try {
    const seed = JSON.parse(raw); currentDocument = validateDocument(seed.document); settings = Object.freeze({ ...settings, ...seed.settings });
    currentEngine = "api"; startNewDocument(seed.sourceText || ""); history.reset({ deck: currentDocument, style: settings });
    $("instructions").value = seed.sourceText || ""; $("lang").value = currentDocument.lang; $("subject").value = currentDocument.subject || "";
    document.querySelector('input[name="documentType"][value="script"]').checked = true; renderDocument(); setStatus("Sprëchtext aus der Präsentatioun iwwerholl ✓");
  } catch (error) { setStatus(error.message || "De Sprëchtext konnt net iwwerholl ginn.", true); }
}

function resetStudio() {
  activeGeneration?.cancel(); selectedFiles = Object.freeze([]); currentDocument = null; currentStoreId = null; currentEngine = null;
  settings = Object.freeze({ schoolYear: "4e", authenticity: 75, targetWords: DEFAULT_WORDS }); history.reset(); startNewDocument(); renderApp();
}

function keyboardHistory(event) {
  const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable;
  if (editing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault(); restoreHistory(event.shiftKey ? history.redo() : history.undo());
}

async function boot() {
  const run = ++bootNumber;
  try {
    await auth.client(); if (run !== bootNumber) return; auth.mountAccountButton($("acctHost"));
    const session = auth.session();
    if (!session?.user) { gate("Dokumentstudio", "Mell dech un, fir däi private Studio opzemaachen.", true); return; }
    if ((session.user.email || "").toLowerCase() !== OWNER_EMAIL) { gate("Dësen Outil ass privat", "De Word Builder ass nëmme fir säi Besëtzer fräigeschalt."); return; }
    renderApp();
  } catch { gate("Studio net disponibel", "D'Verbindung konnt net gestart ginn. Probéier et nach eng Kéier."); }
}

$("newDocument").onclick = resetStudio;
document.addEventListener("keydown", keyboardHistory);
window.addEventListener("doc:store-error", (event) => setStatus(event.detail?.message || "Späicherfeeler", true));
auth.onAuth(boot);
boot();
