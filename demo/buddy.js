import { BUDDY } from "./scripts.js?v=1";

const QUESTION_PAUSE_MS = 800;
const TURN_PAUSE_MS = 1600;
const TYPING_TICK_MS = 16;

export const meta = { badge: "demo" };

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

  const playTurn = (turnIndex) => {
    if (destroyed) return;
    const turn = BUDDY.turns[turnIndex];
    const question = document.createElement("div");

    buddy.replaceChildren();
    question.className = "dbuddy-q";
    question.textContent = turn.q;
    buddy.append(question);

    schedule(() => {
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
          turn.a.length,
          Math.floor((performance.now() - startedAt) / BUDDY.charMs),
        );
        if (dueCharacters === visibleCharacters) return;

        visibleCharacters = dueCharacters;
        answer.textContent = turn.a.slice(0, visibleCharacters);
        if (visibleCharacters < turn.a.length) {
          answer.append(caret);
          return;
        }

        window.clearInterval(intervalId);
        removeTimer(intervalId);
        schedule(() => playTurn((turnIndex + 1) % BUDDY.turns.length), TURN_PAUSE_MS);
      }, TYPING_TICK_MS);
      timers.push(intervalId);
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
