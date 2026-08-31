import { BUDDY } from "./scripts.js?v=1";
import { UI } from "./copy.js?v=1";

const QUESTION_PAUSE_MS = 1200;
/* How long a finished answer stays up before the next turn replaces it. Long
 * enough that someone being shown the page can actually read it. */
const TURN_PAUSE_MS = 5000;
const TYPING_TICK_MS = 16;

export const meta = { badge: "demo" };

function homeworkDrawing() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("dbuddy-photo");
  svg.setAttribute("viewBox", "0 0 140 92");
  svg.setAttribute("width", "140");
  svg.setAttribute("height", "92");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", UI.photoSent);
  svg.style.display = "block";
  svg.style.maxWidth = "100%";
  svg.style.marginBottom = "7px";

  // This is deliberately a drawing, not a photograph or a real homework asset.
  svg.innerHTML = `
    <rect width="140" height="92" rx="7" fill="#cbc7bd"/>
    <rect x="9" y="7" width="122" height="78" rx="2" fill="#fffdf2" transform="rotate(-1 70 46)"/>
    <path d="M16 30H124M16 46H124M16 62H124M16 78H124" stroke="#b8d4ed" stroke-width="1"/>
    <path d="M27 12V82" stroke="#edb2b2" stroke-width="1"/>
    <text x="37" y="26" fill="#27334b" font-size="12" font-family="cursive" transform="rotate(-2 37 26)">a² + b² = c²</text>
    <text x="43" y="44" fill="#27334b" font-size="11" font-family="cursive" transform="rotate(1 43 44)">3² + 4² = 5²</text>
    <text x="50" y="61" fill="#27334b" font-size="10" font-family="cursive">9 + 16 = 25 ✓</text>
  `;
  return svg;
}

export function mount(host, opts = {}) {
  void opts;

  let destroyed = false;
  const timers = [];
  const buddy = document.createElement("div");
  buddy.className = "dbuddy";
  host.append(buddy);

  const removeTimer = (timerId) => {
    const timerIndex = timers.indexOf(timerId);
    if (timerIndex !== -1) timers.splice(timerIndex, 1);
  };

  const schedule = (callback, delay) => {
    const timerId = window.setTimeout(() => {
      removeTimer(timerId);
      if (destroyed) return;
      callback();
    }, delay);
    timers.push(timerId);
  };

  const typeAnswer = (text, onComplete) => {
    const answer = document.createElement("div");
    const caret = document.createElement("span");
    const startedAt = performance.now();
    let visibleCharacters = 0;

    answer.className = "dbuddy-a";
    caret.className = "dcaret";
    answer.append(caret);
    buddy.append(answer);

    const intervalId = window.setInterval(() => {
      if (destroyed) return;
      const dueCharacters = Math.min(
        text.length,
        Math.floor((performance.now() - startedAt) / BUDDY.charMs),
      );
      if (dueCharacters === visibleCharacters) return;

      visibleCharacters = dueCharacters;
      answer.textContent = text.slice(0, visibleCharacters);
      if (visibleCharacters < text.length) {
        answer.append(caret);
        return;
      }

      window.clearInterval(intervalId);
      removeTimer(intervalId);
      onComplete();
    }, TYPING_TICK_MS);
    timers.push(intervalId);
  };

  const playPhotoExchange = () => {
    schedule(() => {
      const photo = document.createElement("div");
      const caption = document.createElement("div");
      photo.className = "dbuddy-q";
      caption.textContent = UI.photoSent;
      photo.append(homeworkDrawing(), caption);
      buddy.append(photo);

      schedule(() => {
        typeAnswer(BUDDY.turns[1].a, () => {
          schedule(() => playTurn(0), TURN_PAUSE_MS);
        });
      }, QUESTION_PAUSE_MS);
    }, TURN_PAUSE_MS);
  };

  const playTurn = (turnIndex) => {
    if (destroyed) return;
    const turn = BUDDY.turns[turnIndex];
    const question = document.createElement("div");

    buddy.replaceChildren();
    question.className = "dbuddy-q";
    question.textContent = turn.q;
    buddy.append(question);

    schedule(() => {
      typeAnswer(turn.a, () => {
        if (turnIndex === 0) {
          playPhotoExchange();
          return;
        }
        schedule(() => playTurn((turnIndex + 1) % BUDDY.turns.length), TURN_PAUSE_MS);
      });
    }, QUESTION_PAUSE_MS);
  };

  playTurn(0);

  return {
    destroy() {
      destroyed = true;
      timers.splice(0).forEach((timerId) => {
        window.clearTimeout(timerId);
        window.clearInterval(timerId);
      });
    },
  };
}
