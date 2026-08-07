import { rewriteSlide, translateDeck } from "./ppt-ai.js?v=5";
import { updateSlide } from "./ppt-deck-ops.js?v=5";

const LANGUAGE_NAMES = Object.freeze({ lb: "Lëtzebuergesch", de: "Deutsch", en: "English", fr: "Français" });

function message(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function progressLabel(details, action) {
  const seconds = Math.max(0, Math.floor(Number(details?.elapsedMs) / 1000));
  return `${action} um Mac mini… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

class AiActions {
  constructor(config) {
    this.config = config;
    this.running = false;
  }

  async rewrite(index, intent, custom) {
    if (this.running || !this.config.getDeck()) return;
    this.running = true;
    this.config.setStatus("Slide gëtt nei geschriwwen…");
    try {
      const deck = this.config.getDeck();
      const replacement = await rewriteSlide(deck, index, intent, custom, this.config.getStyle(), {
        onProgress: (details) => this.config.setStatus(progressLabel(details, "Slide")),
      });
      const next = updateSlide(deck, index, replacement);
      this.config.onDeck(next, { kind: "rewrite", slideId: deck.slides[index].id, intent }, index);
      this.config.setStatus("Nëmmen dës Slide gouf aktualiséiert ✓");
    } catch (error) { this.config.setStatus(message(error, "D'Slide konnt net nei geschriwwe ginn."), true); }
    finally { this.running = false; }
  }

  async translate(targetLang) {
    const deck = this.config.getDeck();
    if (this.running || !deck || targetLang === deck.lang) return;
    const name = LANGUAGE_NAMES[targetLang] || targetLang;
    if (!confirm(`Dëst ersetzt den aktuellen Text duerch ${name}. Weiderfueren?`)) return;
    this.running = true;
    this.toggleTranslation(true);
    this.config.setStatus(`Ganz Präsentatioun op ${name} iwwersetzen…`);
    try {
      const translated = await translateDeck(deck, targetLang, this.config.getStyle(), {
        onProgress: (details) => this.config.setStatus(progressLabel(details, "Iwwersetzung")),
      });
      this.config.onDeck(translated, { kind: "translate", from: deck.lang, to: targetLang }, this.config.getIndex());
      this.config.setLanguage(targetLang);
      this.config.setStatus(`Op ${name} iwwersat ✓ · Zréck mécht alles réckgängeg.`);
    } catch (error) { this.config.setStatus(message(error, "D'Iwwersetzung ass feelgeschloen."), true); }
    finally { this.running = false; this.toggleTranslation(false); }
  }

  toggleTranslation(disabled) {
    const button = document.getElementById("translateDeck");
    const select = document.getElementById("translateLang");
    if (button) button.disabled = disabled || this.running || !this.config.getDeck();
    if (select) select.disabled = disabled || this.running;
  }

  bind() {
    const button = document.getElementById("translateDeck");
    const select = document.getElementById("translateLang");
    if (!button || !select) return;
    button.onclick = () => this.translate(select.value);
  }
}

export function createAiActions(config) {
  const actions = new AiActions(config);
  actions.bind();
  return Object.freeze({ rewrite: (index, intent, custom) => actions.rewrite(index, intent, custom),
    refresh: () => actions.toggleTranslation(false) });
}
