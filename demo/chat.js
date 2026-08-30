import { CALL, CHAT } from "./scripts.js?v=1";

export const meta = { badge: "demo" };

export function mount(host, opts = {}) {
  void opts;

  let destroyed = false;
  const timers = [];
  const room = document.createElement("div");
  const thread = document.createElement("div");

  room.className = "dmuted";
  room.textContent = CHAT.room;
  thread.className = "dchat";
  host.append(room, thread);

  const schedule = (callback, delay) => {
    const timerId = window.setTimeout(() => {
      const timerIndex = timers.indexOf(timerId);
      if (timerIndex !== -1) timers.splice(timerIndex, 1);
      if (destroyed) return;
      callback();
    }, delay);
    timers.push(timerId);
  };

  const scrollToLatest = () => {
    thread.scrollTop = thread.scrollHeight;
  };

  const makeMessage = (message, typing = false) => {
    const person = CHAT.people[message.from];
    const row = document.createElement("div");
    const avatar = document.createElement("div");
    const bubble = document.createElement("div");

    row.className = `dmsg${message.from === CHAT.me ? " me" : ""}`;
    avatar.className = "davatar";
    avatar.style.backgroundColor = person.color;
    avatar.textContent = person.initial;
    bubble.className = `dbubble${typing ? " typing" : ""}`;

    if (typing) {
      bubble.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    } else {
      bubble.textContent = message.text;
    }

    row.append(avatar, bubble);
    return row;
  };

  const playMessage = (messageIndex) => {
    if (destroyed) return;
    if (messageIndex >= CHAT.messages.length) {
      schedule(playCall, CHAT.loopPauseMs);
      return;
    }

    const message = CHAT.messages[messageIndex];
    schedule(() => {
      if (message.typing <= 0) {
        thread.append(makeMessage(message));
        scrollToLatest();
        playMessage(messageIndex + 1);
        return;
      }

      const typingRow = makeMessage(message, true);
      thread.append(typingRow);
      scrollToLatest();
      schedule(() => {
        typingRow.remove();
        thread.append(makeMessage(message));
        scrollToLatest();
        playMessage(messageIndex + 1);
      }, message.typing);
    }, message.delay);
  };

  const clock = (seconds) => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };

  const restartChat = () => {
    thread.replaceChildren();
    playMessage(0);
  };

  function playCall() {
    if (destroyed) return;
    const person = CHAT.people[CALL.caller];
    const call = document.createElement("div");
    const avatar = document.createElement("div");
    const name = document.createElement("div");
    const state = document.createElement("div");
    const buttons = document.createElement("div");
    const accept = document.createElement("button");
    const decline = document.createElement("button");

    call.className = "dcall";
    avatar.className = "dcall-ava ringing";
    avatar.style.backgroundColor = person?.color ?? "";
    avatar.textContent = person?.initial ?? CALL.caller.slice(0, 1);
    name.className = "dcall-name";
    name.textContent = CALL.caller;
    state.className = "dcall-state";
    state.textContent = CALL.subtitle;
    buttons.className = "dcall-btns";
    accept.type = "button";
    accept.className = "dcall-btn accept";
    accept.textContent = "📞";
    decline.type = "button";
    decline.className = "dcall-btn decline";
    decline.textContent = "✕";
    buttons.append(decline, accept);
    call.append(avatar, name, state, buttons);
    thread.replaceChildren(call);

    /* One interval drives the on-screen clock, so hanging up — by tapping, by
     * the call running its course, or by destroy() — has exactly one timer to
     * clear rather than one per second. */
    let ticker = null;
    const stopTicker = () => {
      if (ticker === null) return;
      window.clearInterval(ticker);
      const at = timers.indexOf(ticker);
      if (at !== -1) timers.splice(at, 1);
      ticker = null;
    };

    const hangUp = () => {
      stopTicker();
      if (destroyed) return;
      restartChat();
    };

    const answer = () => {
      if (destroyed || ticker !== null) return;
      avatar.classList.remove("ringing");
      accept.remove();
      const startedAt = performance.now();
      state.textContent = clock(0);
      ticker = window.setInterval(() => {
        if (destroyed) { stopTicker(); return; }
        const elapsed = performance.now() - startedAt;
        if (elapsed >= CALL.talkMs) { hangUp(); return; }
        state.textContent = clock(elapsed / 1000);
      }, 1000);
      timers.push(ticker);
    };

    accept.addEventListener("click", answer);
    decline.addEventListener("click", hangUp);
    schedule(() => { if (ticker === null) answer(); }, CALL.ringMs);
  }

  playMessage(0);

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
