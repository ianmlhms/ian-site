/* Staged scripts for the three showcases that cannot run on live data.
 *
 * Messenger, the call ring and Study Buddy all need a signed-in account and a
 * real second person, which a demo page has neither of. So these three play a
 * written script instead. Every one of them is labelled "Demo" in the UI: the
 * point is to show what the app looks like in use, never to pass a staged
 * conversation off as a real one.
 *
 * The people are invented. No classmate's name, handle or message appears here
 * — the repo is public. */

export const DEMO_BADGE = "Demo";

/* Messenger. `delay` is the pause BEFORE the message lands, in ms; `typing` is
 * how long the "…" bubble shows first (0 = the message just appears, which is
 * what your own sent messages do). */
export const CHAT = Object.freeze({
  room: "4C6 · Klass-Chat",
  me: "Ian",
  people: Object.freeze({
    Lea: { color: "#f0a6c8", initial: "L" },
    Tom: { color: "#8fd4ff", initial: "T" },
    Ian: { color: "#ffd479", initial: "I" },
  }),
  messages: Object.freeze([
    { from: "Lea", text: "Moien! Kënnt der haut den Owend?", delay: 400,  typing: 900 },
    { from: "Tom", text: "Jo, mee ech si bis 18:00 am Training", delay: 700, typing: 1100 },
    { from: "Ian", text: "Ech bréngen d'Kaarte mat 🃏", delay: 900, typing: 0 },
    { from: "Lea", text: "Perfekt 😄", delay: 600, typing: 500 },
    { from: "Tom", text: "Wien huet d'Mathe-Hausaufgabe fir muer?", delay: 900, typing: 1200 },
    { from: "Ian", text: "Säit 42, Nummer 3 an 4", delay: 800, typing: 0 },
    { from: "Lea", text: "Merci! 🙏", delay: 600, typing: 600 },
  ]),
  loopPauseMs: 4000,
});

/* The incoming-call ring. The real thing is rtc-ring.js on a WebRTC channel;
 * here the same UI runs off a timer so it can be shown without a second phone. */
export const CALL = Object.freeze({
  caller: "Lea",
  subtitle: "Uruff · ian.lu",
  ringMs: 3200,
  talkMs: 12000,
});

/* Study Buddy. The real app streams an answer from an Edge Function; this
 * replays a fixed answer at a typing speed that reads like the live one. */
export const BUDDY = Object.freeze({
  charMs: 30,          // ms per character — half the old speed, so it reads as thinking
  turns: Object.freeze([
    {
      q: "Erkläer mir de Pythagoras a einfache Wierder.",
      a: "An engem rechtwénklegen Dräieck gëllt: a² + b² = c².\n\n" +
         "c ass ëmmer déi längst Säit, also déi géintiwwer vum rechte Wénkel " +
         "(d'Hypotenus). a an b sinn déi zwou kuerz Säiten.\n\n" +
         "Beispill: a = 3, b = 4 → 9 + 16 = 25 → c = 5.",
    },
    {
      q: "Ginn mer 3 Froen fir de Bio-Test iwwer d'Zell.",
      a: "1. Wat ass den Ënnerscheed tëscht enger Planzenzell an enger Déierenzell?\n" +
         "2. Wéi eng Aufgab huet de Mitochondrium?\n" +
         "3. Firwat huet eng Planzenzell Chloroplasten, eng Déierenzell awer net?",
    },
  ]),
});
