/* Mordsfall — all words: object names, clue sentences, stories and the interface dictionary (lb / de / en).
 * Pure functions, no DOM, so scripts/mordsfall_check.mjs can render every clue of every case. */
export const LANGS = ["lb", "de", "en"];

/* name = what the legend shows, a = "a/an …" in the dative (after beside / not beside), on = the whole "was on …" phrase */
export const OBJECTS = {
  table:    { block: true,  name: { lb: "Dësch", de: "Tisch", en: "Table" }, a: { lb: "engem Dësch", de: "einem Tisch", en: "a table" } },
  shelf:    { block: true,  name: { lb: "Regal", de: "Regal", en: "Shelf" }, a: { lb: "engem Regal", de: "einem Regal", en: "a shelf" } },
  tree:     { block: true,  name: { lb: "Bam", de: "Baum", en: "Tree" }, a: { lb: "engem Bam", de: "einem Baum", en: "a tree" } },
  rock:     { block: true,  name: { lb: "Fiels", de: "Felsbrocken", en: "Boulder" }, a: { lb: "engem Fiels", de: "einem Felsbrocken", en: "a boulder" } },
  car:      { block: true,  name: { lb: "Auto", de: "Auto", en: "Car" }, a: { lb: "engem Auto", de: "einem Auto", en: "a car" } },
  fountain: { block: true,  name: { lb: "Brunnen", de: "Brunnen", en: "Fountain" }, a: { lb: "engem Brunnen", de: "einem Brunnen", en: "a fountain" } },
  barrel:   { block: true,  name: { lb: "Fass", de: "Fass", en: "Barrel" }, a: { lb: "engem Fass", de: "einem Fass", en: "a barrel" } },
  plant:    { block: true,  name: { lb: "Planz", de: "Pflanze", en: "Plant" }, a: { lb: "enger Planz", de: "einer Pflanze", en: "a plant" } },
  crate:    { block: true,  name: { lb: "Këscht", de: "Kiste", en: "Crate" }, a: { lb: "enger Këscht", de: "einer Kiste", en: "a crate" } },
  stove:    { block: true,  name: { lb: "Uewen", de: "Herd", en: "Stove" }, a: { lb: "engem Uewen", de: "einem Herd", en: "a stove" } },
  chair:    { block: false, name: { lb: "Stull", de: "Stuhl", en: "Chair" }, a: { lb: "engem Stull", de: "einem Stuhl", en: "a chair" },
    on: { lb: "souz op engem Stull", de: "saß auf einem Stuhl", en: "sat on a chair" } },
  carpet:   { block: false, name: { lb: "Teppech", de: "Teppich", en: "Carpet" }, a: { lb: "engem Teppech", de: "einem Teppich", en: "a carpet" },
    on: { lb: "stoung op engem Teppech", de: "stand auf einem Teppich", en: "stood on a carpet" } },
  bench:    { block: false, name: { lb: "Bank", de: "Bank", en: "Bench" }, a: { lb: "enger Bank", de: "einer Bank", en: "a bench" },
    on: { lb: "souz op enger Bank", de: "saß auf einer Bank", en: "sat on a bench" } },
  bed:      { block: false, name: { lb: "Bett", de: "Bett", en: "Bed" }, a: { lb: "engem Bett", de: "einem Bett", en: "a bed" },
    on: { lb: "louch op engem Bett", de: "lag auf einem Bett", en: "lay on a bed" } },
  hay:      { block: false, name: { lb: "Heeballen", de: "Heuballen", en: "Hay bale" }, a: { lb: "engem Heeballen", de: "einem Heuballen", en: "a hay bale" },
    on: { lb: "souz op engem Heeballen", de: "saß auf einem Heuballen", en: "sat on a hay bale" } },
};

export const objName = (type, lang) => OBJECTS[type].name[lang];
export const roomName = (cs, id, lang) => cs.rooms[id][lang];
export const caseTitle = (cs, lang) => cs.title[lang];

/* Luxembourgish puts an article before a first name: "de Pol", "d'Lis", "den Henri" (Eifel rule: n stays before
 * vowels and d h n t z). Dative: "dem Pol" / "der Lis". */
const EIFEL_N = /^[aeiouäëéèêàâîïôöüûhdntzAEIOUÄËÉHDNTZ]/;
function lbArticle(person, dative) {
  if (person.g === "f") return dative ? "der " + person.name : "d'" + person.name;
  if (dative) return "dem " + person.name;
  return (EIFEL_N.test(person.name) ? "den " : "de ") + person.name;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* How a person is named inside a sentence. */
export function personRef(cs, p, lang, dative = false) {
  const person = cs.people[p];
  return lang === "lb" ? lbArticle(person, dative) : person.name;
}

/* The clue as a sentence fragment that goes under the person's name (no subject: "Was beside a table"). */
export function clueText(cs, clue, lang) {
  const ord = (k) => k + 1;
  switch (clue.t) {
    case "victim": return { lb: "Wor eleng mam Mäerder", de: "War allein mit dem Mörder", en: "Was alone with the murderer" }[lang];
    case "alone": return { lb: "Wor eleng am Beräich", de: "War allein im Bereich", en: "Was alone in their area" }[lang];
    case "in": return { lb: `Wor am Beräich „${roomName(cs, clue.room, lang)}“`, de: `War im Bereich „${roomName(cs, clue.room, lang)}“`, en: `Was in the ${roomName(cs, clue.room, lang)}` }[lang];
    case "notin": return { lb: `Wor net am Beräich „${roomName(cs, clue.room, lang)}“`, de: `War nicht im Bereich „${roomName(cs, clue.room, lang)}“`, en: `Was not in the ${roomName(cs, clue.room, lang)}` }[lang];
    case "near": return { lb: `Wor nieft ${OBJECTS[clue.obj].a.lb}`, de: `Stand neben ${OBJECTS[clue.obj].a.de}`, en: `Was beside ${OBJECTS[clue.obj].a.en}` }[lang];
    case "notnear": return { lb: `Wor net nieft ${OBJECTS[clue.obj].a.lb}`, de: `Stand nicht neben ${OBJECTS[clue.obj].a.de}`, en: `Was not beside ${OBJECTS[clue.obj].a.en}` }[lang];
    case "on": return cap(OBJECTS[clue.obj].on[lang]);
    case "row":
      if (clue.k === 0) return { lb: "Wor an der alleréischter Rei (uewen)", de: "War in der obersten Zeile", en: "Was in the top row" }[lang];
      if (clue.k === cs.n - 1) return { lb: "Wor an der leschter Rei (ënnen)", de: "War in der untersten Zeile", en: "Was in the bottom row" }[lang];
      return { lb: `Wor an der ${ord(clue.k)}. Rei`, de: `War in Zeile ${ord(clue.k)}`, en: `Was in row ${ord(clue.k)}` }[lang];
    case "col":
      if (clue.k === 0) return { lb: "Wor an der alleréischter Kolonn (lénks)", de: "War in der linken Spalte", en: "Was in the left-most column" }[lang];
      if (clue.k === cs.n - 1) return { lb: "Wor an der leschter Kolonn (riets)", de: "War in der rechten Spalte", en: "Was in the right-most column" }[lang];
      return { lb: `Wor an der ${ord(clue.k)}. Kolonn`, de: `War in Spalte ${ord(clue.k)}`, en: `Was in column ${ord(clue.k)}` }[lang];
    case "north": case "south": case "east": case "west": {
      const dir = {
        north: { lb: "nërdlech", de: "nördlich", en: "north" }, south: { lb: "südlech", de: "südlich", en: "south" },
        east: { lb: "ëstlech", de: "östlich", en: "east" }, west: { lb: "westlech", de: "westlich", en: "west" },
      }[clue.t][lang];
      if (lang === "lb") return `Wor iergendwou ${dir} ${cs.people[clue.p].g === "f" ? "vun der" : "vum"} ${cs.people[clue.p].name}`;
      if (lang === "de") return `War irgendwo ${dir} von ${cs.people[clue.p].name}`;
      return `Was somewhere ${dir} of ${cs.people[clue.p].name}`;
    }
    case "same": return {
      lb: `Wor am selwechte Beräich ewéi ${personRef(cs, clue.p, "lb")}`, de: `War im selben Bereich wie ${cs.people[clue.p].name}`, en: `Was in the same area as ${cs.people[clue.p].name}`,
    }[lang];
  }
  return "";
}

/* Closing story with {K}/{k} murderer, {V}/{v} victim, {kd}/{vd} dative (Luxembourgish article form). */
export function storyText(cs, lang, murdererIndex) {
  const v = cs.victim;
  let k = murdererIndex;
  if (k === undefined) { // the other person in the victim's room
    const roomAt = ([r, c]) => parseInt(cs.grid[r][c], 36), vroom = roomAt(cs.sol[v]);
    k = cs.sol.findIndex((cell, i) => i !== v && roomAt(cell) === vroom);
  }
  const sub = (kind, i) => {
    if (lang !== "lb") return cs.people[i].name;
    return kind === "d" ? lbArticle(cs.people[i], true) : lbArticle(cs.people[i], false);
  };
  return cs.story[lang]
    .replace(/\{K\}/g, cap(sub("n", k))).replace(/\{k\}/g, sub("n", k)).replace(/\{kd\}/g, sub("d", k))
    .replace(/\{V\}/g, cap(sub("n", v))).replace(/\{v\}/g, sub("n", v)).replace(/\{vd\}/g, sub("d", v));
}

export const TIER_KEYS = ["ve", "ea", "me", "ha", "ex"];

/* ---------------- interface dictionary ---------------- */
const D = (lb, de, en) => ({ lb, de, en });
export const UI = {
  title: D("Mordsfall", "Mordsfall", "Mordsfall"),
  subtitle: D("Wien wor et? Setz jiddereen op säi Plaz a fann de Mäerder.", "Wer war es? Setze jeden an seinen Platz und finde den Mörder.", "Who did it? Put everybody in their place and find the murderer."),
  how: D("Spillregelen", "Spielregeln", "How to play"),
  cases: D("Fäll", "Fälle", "Cases"),
  allCases: D("All Fäll", "Alle Fälle", "All cases"),
  filterAll: D("All", "Alle", "All"),
  tier_ve: D("Ganz einfach", "Sehr leicht", "Very easy"),
  tier_ea: D("Einfach", "Leicht", "Easy"),
  tier_me: D("Mëttel", "Mittel", "Medium"),
  tier_ha: D("Schwéier", "Schwer", "Hard"),
  tier_ex: D("Expert", "Experte", "Expert"),
  progress: D("{n} vu {t} Fäll geléist · {p} Punkten", "{n} von {t} Fällen gelöst · {p} Punkte", "{n} of {t} cases solved · {p} points"),
  solved: D("Geléist", "Gelöst", "Solved"),
  best: D("Beschtzäit", "Bestzeit", "Best"),
  open: D("Opmaachen", "Öffnen", "Open"),
  size: D("{n}×{n}", "{n}×{n}", "{n}×{n}"),
  victim: D("Affer", "Opfer", "Victim"),
  suspect: D("Verdächtegen", "Verdächtige", "Suspect"),
  suspects: D("Verdächteger", "Verdächtige", "Suspects"),
  notPlaced: D("Nach net gesat", "Noch nicht gesetzt", "Not placed yet"),
  placedAt: D("Rei {r} · Kolonn {c}", "Zeile {r} · Spalte {c}", "Row {r} · column {c}"),
  cluesNone: D("Keng Hiweiser", "Keine Hinweise", "No clues"),
  undo: D("Zréck", "Zurück", "Undo"),
  hint: D("Hiweis", "Hinweis", "Hint"),
  notes: D("Notizen", "Notizen", "Notes"),
  check: D("Kontroll", "Prüfen", "Check"),
  reset: D("Zrécksetzen", "Zurücksetzen", "Reset"),
  cases2: D("‹ Fäll", "‹ Fälle", "‹ Cases"),
  autoGrey: D("Besat Reien a Kolonnen grau", "Belegte Zeilen und Spalten grau", "Grey out used rows and columns"),
  assistTick: D("✓ bei erfëllten Hiweiser", "✓ bei erfüllten Hinweisen", "Tick satisfied clues"),
  timeShown: D("Zäit uweisen", "Zeit anzeigen", "Show timer"),
  legend: D("Legend", "Legende", "Legend"),
  legendBlock: D("Blockéiert: do kann keen stoen", "Blockiert: hier kann niemand stehen", "Blocks the way: nobody can stand here"),
  legendStand: D("Betrietbar: do däerf een stoen", "Betretbar: hier darf man stehen", "Standable: you can stand here"),
  rooms: D("Beräicher", "Bereiche", "Areas"),
  pickPerson: D("Wiel fir d'éischt eng Persoun.", "Wähle zuerst eine Person.", "Pick a person first."),
  cannotStand: D("Op „{o}“ kann keen stoen.", "Auf „{o}“ kann niemand stehen.", "Nobody can stand on “{o}”."),
  rowTaken: D("Hei ass d'Rei oder d'Kolonn scho besat.", "Hier ist die Zeile oder Spalte schon belegt.", "That row or column is already taken."),
  placeAll: D("Setz fir d'éischt all Persounen.", "Setze zuerst alle Personen.", "Place everybody first."),
  wrong1: D("1 Persoun steet nach um falsche Plaz.", "1 Person steht noch am falschen Platz.", "1 person is still in the wrong place."),
  wrongN: D("{n} Persounen stinn nach um falsche Plaz.", "{n} Personen stehen noch am falschen Platz.", "{n} people are still in the wrong place."),
  hintWrong: D("{name} steet net um richtege Plaz. (+60 s)", "{name} steht nicht am richtigen Platz. (+60 s)", "{name} is not in the right place. (+60 s)"),
  hintDeduce: D("{name} kann nëmmen nach op ee Feld: Rei {r}, Kolonn {c}. (+30 s)", "{name} kann nur noch auf ein Feld: Zeile {r}, Spalte {c}. (+30 s)", "{name} can only be on one cell now: row {r}, column {c}. (+30 s)"),
  hintReveal: D("Dat kritt een net mat bloer Logik: {name} steet op Rei {r}, Kolonn {c}. (+60 s)", "Das lässt sich nicht mehr einfach ableiten: {name} steht in Zeile {r}, Spalte {c}. (+60 s)", "Nothing simple is left: {name} stands in row {r}, column {c}. (+60 s)"),
  hintBecause: D("Dofir:", "Denn:", "Because:"),
  hintPlace: D("Setzen", "Platzieren", "Place it"),
  hintDone: D("Alles ass richteg gesat.", "Alles ist richtig gesetzt.", "Everyone is placed correctly."),
  rOwn: D("{name}: {clue}", "{name}: {clue}", "{name}: {clue}"),
  rTaken: D("Rei a Kolonn vu {names} sinn schonn besat", "Zeile und Spalte von {names} sind schon belegt", "the rows and columns of {names} are already used"),
  rHiddenRow: D("nëmmen hatt/hien kann nach an d'Rei {k}", "nur diese Person passt noch in Zeile {k}", "only this person can still go in row {k}"),
  rHiddenCol: D("nëmmen hatt/hien kann nach an d'Kolonn {k}", "nur diese Person passt noch in Spalte {k}", "only this person can still go in column {k}"),
  rBin: D("Hiweis vu {name}: {clue}", "Hinweis von {name}: {clue}", "{name}'s clue: {clue}"),
  rRoom: D("d'Zuel vun de Leit am Beräich vun {name} ({clue})", "die Anzahl der Leute im Bereich von {name} ({clue})", "the head-count in {name}'s area ({clue})"),
  win: D("Fall geléist!", "Fall gelöst!", "Case closed!"),
  murdererIs: D("De Mäerder ass {name}!", "Der Mörder ist {name}!", "The murderer is {name}!"),
  time: D("Zäit", "Zeit", "Time"),
  hintsUsed: D("Hiweiser", "Hinweise", "Hints"),
  points: D("Punkten", "Punkte", "Points"),
  newBest: D("Nei Beschtzäit!", "Neue Bestzeit!", "New best time!"),
  nextCase: D("Nächste Fall ›", "Nächster Fall ›", "Next case ›"),
  replay: D("Nach eng Kéier", "Nochmal spielen", "Play again"),
  close: D("Zoumaachen", "Schließen", "Close"),
  gotIt: D("Verstan, lass!", "Verstanden, los!", "Got it, let's go!"),
  testBadge: D("Testmodus: näischt gëtt gespäichert", "Testmodus: nichts wird gespeichert", "Test mode: nothing is saved"),
  paused: D("Pause", "Pause", "Paused"),
  northLabel: D("N", "N", "N"),
  confirmReset: D("Alles zrécksetzen?", "Alles zurücksetzen?", "Reset everything?"),
  yes: D("Jo", "Ja", "Yes"),
  no: D("Nee", "Nein", "No"),
  selectedNone: D("Keng Persoun ausgewielt", "Keine Person ausgewählt", "No person selected"),
  notesOn: D("Notiz-Modus: tipp op Felder fir Kräizer ze setzen", "Notiz-Modus: Tippe auf Felder, um Kreuze zu setzen", "Notes mode: tap cells to cross them out"),
  rulesTitle: D("Sou spills du Mordsfall", "So spielst du Mordsfall", "How to play Mordsfall"),
  rules: [
    D("<b>Ziel:</b> Eng Persoun ass de Mäerder. Setz alleguer Leit op d'Feld, esou datt all Hiweis stëmmt – dann weist sech, wien et war.",
      "<b>Ziel:</b> Eine der Personen ist der Mörder. Setze alle Leute so aufs Feld, dass jeder Hinweis stimmt – dann zeigt sich, wer es war.",
      "<b>Goal:</b> One of the people is the murderer. Place everybody on the grid so that every clue is true – then you will see who did it."),
    D("<b>Eng pro Rei, eng pro Kolonn:</b> All Persoun kritt e Feld. An all Rei a all Kolonn steet genee eng Persoun (wéi bei Sudoku). D'Feld ass an Beräicher mat décke Grenzen opgedeelt.",
      "<b>Eine pro Zeile, eine pro Spalte:</b> Jede Person bekommt ein Feld. In jeder Zeile und jeder Spalte steht genau eine Person (wie bei Sudoku). Das Spielfeld ist durch dicke Linien in benannte Bereiche geteilt.",
      "<b>One per row, one per column:</b> Everybody gets one cell, and every row and every column holds exactly one person (like sudoku). Thick lines split the grid into named areas."),
    D("<b>Objeten:</b> Op blockéierende Saachen (Dësch, Regal, Bam, Fiels, Auto, Brunnen, Fass, Planz, Këscht, Uewen) kann <b>keen</b> stoen. Op Stull, Teppech, Bank, Bett an Heeballen däerf een stoen.",
      "<b>Objekte:</b> Auf blockierenden Dingen (Tisch, Regal, Baum, Felsbrocken, Auto, Brunnen, Fass, Pflanze, Kiste, Herd) kann <b>niemand</b> stehen. Auf Stuhl, Teppich, Bank, Bett und Heuballen darf man stehen.",
      "<b>Objects:</b> <b>Nobody</b> can stand on blocking things (table, shelf, tree, boulder, car, fountain, barrel, plant, crate, stove). You may stand on chair, carpet, bench, bed and hay bale."),
    D("<b>Niewendrun</b> heescht: ee vun den 8 Felder ronderëm, och diagonal. <b>Nord</b> ass uewen. „Nërdlech vum Pol“ heescht iergendwou méi wäit uewen, net just direkt driwwer.",
      "<b>Daneben</b> heißt: eines der 8 umliegenden Felder, auch diagonal. <b>Norden</b> ist oben. „Nördlich von Pol“ heißt irgendwo weiter oben, nicht nur direkt darüber.",
      "<b>Beside</b> means one of the 8 surrounding cells, diagonals included. <b>North</b> is up. “North of Pol” means anywhere further up, not only straight above."),
    D("<b>Dat Affer</b> seet ëmmer: „Wor eleng mam Mäerder.“ Am Beräich vum Affer stinn also genee zwou Persounen – déi aner ass de Mäerder.",
      "<b>Das Opfer</b> sagt immer: „War allein mit dem Mörder.“ Im Bereich des Opfers stehen also genau zwei Personen – die andere ist der Mörder.",
      "<b>The victim</b> always says: “Was alone with the murderer.” So exactly two people stand in the victim's area – the other one is the murderer."),
    D("<b>Bedienung:</b> Tipp eng Persoun un, dann e Feld. Nach eng Kéier op d'Persoun tippen (oder se erausdroen) hëlt se erof. Mam Notiz-Modus setz s du Kräizer, wou eng Persoun net hi ka. Mat „Hiweis“ gëtt et Hëllef, awer et kascht Zäit.",
      "<b>Bedienung:</b> Tippe eine Person an, dann ein Feld. Nochmal auf die Person tippen (oder sie hinausziehen) nimmt sie wieder weg. Im Notiz-Modus setzt du Kreuze, wo eine Person nicht sein kann. Der „Hinweis“ hilft, kostet aber Zeit.",
      "<b>Controls:</b> Tap a person, then a cell. Tap the person again (or drag them out) to take them off. Notes mode lets you cross out cells where a person cannot be. The hint helps, but costs time."),
    D("<b>Tastatur:</b> Pfeiltasten bewegen den Cursor, 1–9 wielt eng Persoun, Leertaste setzt, N = Notizen, U = Zréck, H = Hiweis.",
      "<b>Tastatur:</b> Pfeiltasten bewegen den Cursor, 1–9 wählt eine Person, Leertaste setzt, N = Notizen, U = Zurück, H = Hinweis.",
      "<b>Keyboard:</b> arrow keys move the cursor, 1–9 pick a person, space places, N = notes, U = undo, H = hint."),
  ],
};
export const T = (key, lang, vars) => {
  const entry = UI[key];
  let s = entry ? (entry[lang] ?? entry.en) : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
};
