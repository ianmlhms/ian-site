/* Partyspill — the 15 games.
 *
 * Each game is a thin config over a shared ARCHETYPE, so the engine implements
 * nine round shapes rather than fifteen separate games:
 *
 *   secret   one player secretly differs, then everyone votes   (3 games)
 *   bomb     hidden timer, pass the phone, do not be holding it
 *   rush     one player names as many as possible before time
 *   circa    everyone estimates a number, closest wins
 *   prompt   read a card aloud and talk                          (5 games)
 *   twotruths each player invents two truths and a lie
 *   taboo    describe a word without saying the banned ones
 *   spectrum secret point between two opposites, give one clue
 *   quiz     four options, one right
 *
 * `min` is the smallest player count the round actually works with.
 */
window.PS_GAMES = [
  {
    id: "impostor", emoji: "🕵️", archetype: "secret", min: 3, accent: "#ff6b9d",
    name: { lb: "Impostor", de: "Impostor", en: "Impostor" },
    tag: { lb: "Ee weess d'Wuert net — fann eraus wien.",
           de: "Einer kennt das Wort nicht — finde heraus wer.",
           en: "One player doesn't know the word — find out who." },
    // The impostor is told they are the impostor, and sees nothing else.
    impostorSeesWord: false, impostorKnowsRole: true, roundSeconds: 0,
  },
  {
    id: "guesswhat", emoji: "❓", archetype: "secret", min: 3, accent: "#4de8ff",
    name: { lb: "Roud Mol", de: "Rate mal", en: "Guess What?" },
    tag: { lb: "Du weess net wat d'Wuert ass — dot esou wéi wann.",
           de: "Du kennst das Wort nicht — tu so als ob.",
           en: "You don't know the word — bluff until you do." },
    // Same reveal, but the impostor is NOT told: they must work out that they
    // are the odd one out from what everyone else says.
    impostorSeesWord: false, impostorKnowsRole: false, roundSeconds: 0,
  },
  {
    id: "buzzer", emoji: "🔔", archetype: "secret", min: 4, accent: "#ffcc00",
    name: { lb: "Buzzer", de: "Buzzer", en: "Buzzer" },
    tag: { lb: "Ee Wuert pro Persoun, dann direkt ofstëmmen.",
           de: "Ein Wort pro Person, dann sofort abstimmen.",
           en: "One word each, then vote immediately." },
    impostorSeesWord: false, impostorKnowsRole: true, roundSeconds: 60,
  },
  {
    id: "bomb", emoji: "💣", archetype: "bomb", min: 3, accent: "#ff5a5a",
    name: { lb: "Bomm", de: "Bombe", en: "Bomb" },
    tag: { lb: "Sot e Wuert, gitt weider — hal se net wann se knuppt.",
           de: "Sag ein Wort, gib weiter — halte sie nicht wenn sie knallt.",
           en: "Say a word, pass it on — don't be holding it when it blows." },
    minSeconds: 20, maxSeconds: 60,
  },
  {
    id: "wordrush", emoji: "⚡", archetype: "rush", min: 2, accent: "#44ff88",
    name: { lb: "Wuertsprint", de: "Wortsprint", en: "Word Rush" },
    tag: { lb: "Esou vill Wierder wéi méiglech an 30 Sekonnen.",
           de: "So viele Wörter wie möglich in 30 Sekunden.",
           en: "As many words as you can in 30 seconds." },
    seconds: 30,
  },
  {
    id: "circa", emoji: "🎯", archetype: "circa", min: 2, accent: "#f5b43c",
    name: { lb: "Circa", de: "Circa", en: "Circa" },
    tag: { lb: "Rot d'Zuel — dee mat der nooster gewënnt.",
           de: "Schätze die Zahl — die nächste gewinnt.",
           en: "Estimate the number — closest wins." },
  },
  {
    id: "mostlikely", emoji: "👉", archetype: "prompt", min: 3, accent: "#6ea8fe",
    name: { lb: "Am éischsten", de: "Am ehesten", en: "Most Likely To" },
    tag: { lb: "Op dräi weist jiddereen op een.",
           de: "Auf drei zeigen alle auf jemanden.",
           en: "On three, everyone points at someone." },
    bank: "mostLikely",
    how: { lb: "Op 3 weist jiddereen op eng Persoun. Déi mat de meeschte Fangeren dorop erkläert sech.",
           de: "Auf 3 zeigen alle auf eine Person. Wer die meisten Finger abbekommt, erklärt sich.",
           en: "On 3, everyone points. Whoever gets the most fingers has to explain themselves." },
  },
  {
    id: "wouldyourather", emoji: "⚖️", archetype: "prompt", min: 2, accent: "#c084fc",
    name: { lb: "Wat léiwer?", de: "Was lieber?", en: "Would You Rather" },
    tag: { lb: "Zwou Méiglechkeeten, keng gutt.",
           de: "Zwei Möglichkeiten, keine gut.",
           en: "Two options, neither good." },
    bank: "wouldYouRather",
    how: { lb: "Jiddereen seet séng Wiel — an dann muss ee se verdeedegen.",
           de: "Alle sagen ihre Wahl — und müssen sie verteidigen.",
           en: "Everyone picks — then has to defend it." },
  },
  {
    id: "neverhave", emoji: "🙈", archetype: "prompt", min: 3, accent: "#58b385",
    name: { lb: "Ech hu nach ni…", de: "Ich hab noch nie…", en: "Never Have I Ever" },
    tag: { lb: "Wien et scho gemaach huet, hieft d'Hand.",
           de: "Wer es schon gemacht hat, hebt die Hand.",
           en: "If you've done it, raise your hand." },
    bank: "neverHave",
    prefix: { lb: "Ech hu nach ni…", de: "Ich hab noch nie…", en: "Never have I ever…" },
    how: { lb: "Wien et scho gemaach huet, hieft d'Hand a kritt e Punkt.",
           de: "Wer es schon gemacht hat, hebt die Hand und bekommt einen Punkt.",
           en: "If you've done it, raise your hand and take a point." },
  },
  {
    id: "paranoia", emoji: "🤫", archetype: "prompt", min: 3, accent: "#e8944e",
    name: { lb: "Paranoia", de: "Paranoia", en: "Paranoia" },
    tag: { lb: "Fro flüsteren, Äntwert haart soen.",
           de: "Frage flüstern, Antwort laut sagen.",
           en: "Whisper the question, say the answer out loud." },
    bank: "paranoia",
    how: { lb: "Lies d'Fro flüsternd fir däin Noper. Hie seet den Numm haart — awer keen weess d'Fro.",
           de: "Lies die Frage flüsternd deinem Nachbarn vor. Er sagt den Namen laut — aber niemand kennt die Frage.",
           en: "Whisper the question to your neighbour. They say a name out loud — but nobody else hears the question." },
  },
  {
    id: "story", emoji: "📖", archetype: "prompt", min: 2, accent: "#9fb0c0",
    name: { lb: "Geschicht", de: "Geschichte", en: "Story Chain" },
    tag: { lb: "Jiddereen setzt ee Saz derbäi.",
           de: "Jeder fügt einen Satz hinzu.",
           en: "Everyone adds one sentence." },
    bank: "storyStarters",
    how: { lb: "Ee fänkt un ze liesen, dann setzt jiddereen ee Saz derbäi. Keen dierf ophalen.",
           de: "Einer liest vor, dann fügt jeder einen Satz hinzu. Niemand darf abbrechen.",
           en: "One player reads it out, then everyone adds a sentence. Nobody may stop." },
  },
  {
    id: "twotruths", emoji: "🎭", archetype: "twotruths", min: 3, accent: "#f472b6",
    name: { lb: "Zwou Wourechten", de: "Zwei Wahrheiten", en: "Two Truths & a Lie" },
    tag: { lb: "Zwee stëmmen, ee net. Wéi een?",
           de: "Zwei stimmen, eine nicht. Welche?",
           en: "Two are true, one isn't. Which?" },
  },
  {
    id: "taboo", emoji: "🚫", archetype: "taboo", min: 3, accent: "#e5484d",
    name: { lb: "Tabu", de: "Tabu", en: "Taboo" },
    tag: { lb: "Erkläer d'Wuert — awer net mat dëse Wierder.",
           de: "Erkläre das Wort — aber nicht mit diesen Wörtern.",
           en: "Describe the word — without using these." },
    seconds: 60,
  },
  {
    id: "spektrum", emoji: "🌡️", archetype: "spectrum", min: 3, accent: "#3cd2dc",
    name: { lb: "Spektrum", de: "Spektrum", en: "Spectrum" },
    tag: { lb: "Ee Wuert als Hiweis — wéi wäit ass et?",
           de: "Ein Wort als Hinweis — wie weit ist es?",
           en: "One word as a clue — how far along is it?" },
  },
  {
    id: "quiz", emoji: "🧠", archetype: "quiz", min: 1, accent: "#46c46e",
    name: { lb: "Quiz", de: "Quiz", en: "Quiz" },
    tag: { lb: "Véier Äntwerten, eng richteg.",
           de: "Vier Antworten, eine richtig.",
           en: "Four answers, one right." },
  },
];
