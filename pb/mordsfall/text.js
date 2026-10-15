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
  heater:   { block: true,  name: { lb: "Saunauewen", de: "Saunaofen", en: "Sauna heater" }, a: { lb: "engem Saunauewen", de: "einem Saunaofen", en: "a sauna heater" } },
  bucket:   { block: true,  name: { lb: "Eemer", de: "Eimer", en: "Bucket" }, a: { lb: "engem Eemer", de: "einem Eimer", en: "a bucket" } },
  fridge:   { block: true,  name: { lb: "Frigo", de: "Kühlschrank", en: "Fridge" }, a: { lb: "engem Frigo", de: "einem Kühlschrank", en: "a fridge" } },
  counter:  { block: true,  name: { lb: "Theke", de: "Theke", en: "Counter" }, a: { lb: "enger Theke", de: "einer Theke", en: "a counter" } },
  parasol:  { block: true,  name: { lb: "Sonneschierm", de: "Sonnenschirm", en: "Parasol" }, a: { lb: "engem Sonneschierm", de: "einem Sonnenschirm", en: "a parasol" } },
  tent:     { block: true,  name: { lb: "Zelt", de: "Zelt", en: "Tent" }, a: { lb: "engem Zelt", de: "einem Zelt", en: "a tent" } },
  campfire: { block: true,  name: { lb: "Lagerfeier", de: "Lagerfeuer", en: "Campfire" }, a: { lb: "engem Lagerfeier", de: "einem Lagerfeuer", en: "a campfire" } },
  tap:      { block: true,  name: { lb: "Waasserhunn", de: "Wasserhahn", en: "Water tap" }, a: { lb: "engem Waasserhunn", de: "einem Wasserhahn", en: "a water tap" } },
  desk:     { block: true,  name: { lb: "Schreifdësch", de: "Schreibtisch", en: "Desk" }, a: { lb: "engem Schreifdësch", de: "einem Schreibtisch", en: "a desk" } },
  copier:   { block: true,  name: { lb: "Kopéierer", de: "Kopierer", en: "Copier" }, a: { lb: "engem Kopéierer", de: "einem Kopierer", en: "a copier" } },
  board:    { block: true,  name: { lb: "Tafel", de: "Tafel", en: "Board" }, a: { lb: "enger Tafel", de: "einer Tafel", en: "a board" } },
  stall:    { block: true,  name: { lb: "Stand", de: "Stand", en: "Stall" }, a: { lb: "engem Stand", de: "einem Stand", en: "a stall" } },
  bin:      { block: true,  name: { lb: "Poubelle", de: "Mülleimer", en: "Bin" }, a: { lb: "enger Poubelle", de: "einem Mülleimer", en: "a bin" } },
  carousel: { block: true,  name: { lb: "Karussell", de: "Karussell", en: "Carousel" }, a: { lb: "engem Karussell", de: "einem Karussell", en: "a carousel" } },
  press:    { block: true,  name: { lb: "Wäinpress", de: "Weinpresse", en: "Wine press" }, a: { lb: "enger Wäinpress", de: "einer Weinpresse", en: "a wine press" } },
  sink:     { block: true,  name: { lb: "Wäschbecken", de: "Waschbecken", en: "Sink" }, a: { lb: "engem Wäschbecken", de: "einem Waschbecken", en: "a sink" } },
  grill:    { block: true,  name: { lb: "Grill", de: "Grill", en: "Barbecue" }, a: { lb: "engem Grill", de: "einem Grill", en: "a barbecue" } },
  slide:    { block: true,  name: { lb: "Rutsch", de: "Rutsche", en: "Slide" }, a: { lb: "enger Rutsch", de: "einer Rutsche", en: "a slide" } },
  stool:    { block: false, name: { lb: "Hocker", de: "Hocker", en: "Stool" }, a: { lb: "engem Hocker", de: "einem Hocker", en: "a stool" },
    on: { lb: "souz op engem Hocker", de: "saß auf einem Hocker", en: "sat on a stool" } },
  deckchair:{ block: false, name: { lb: "Liggstull", de: "Liegestuhl", en: "Deckchair" }, a: { lb: "engem Liggstull", de: "einem Liegestuhl", en: "a deckchair" },
    on: { lb: "louch op engem Liggstull", de: "lag auf einem Liegestuhl", en: "lay on a deckchair" } },
  mat:      { block: false, name: { lb: "Turnmatt", de: "Turnmatte", en: "Gym mat" }, a: { lb: "enger Turnmatt", de: "einer Turnmatte", en: "a gym mat" },
    on: { lb: "stoung op enger Turnmatt", de: "stand auf einer Turnmatte", en: "stood on a gym mat" } },
  sandbox:  { block: false, name: { lb: "Sandkaul", de: "Sandkasten", en: "Sandpit" }, a: { lb: "enger Sandkaul", de: "einem Sandkasten", en: "a sandpit" },
    on: { lb: "stoung an enger Sandkaul", de: "stand in einem Sandkasten", en: "stood in a sandpit" } },
  sofa:     { block: false, name: { lb: "Sofa", de: "Sofa", en: "Sofa" }, a: { lb: "engem Sofa", de: "einem Sofa", en: "a sofa" },
    on: { lb: "souz op engem Sofa", de: "saß auf einem Sofa", en: "sat on a sofa" } },
  bumper:   { block: false, name: { lb: "Autoscooter", de: "Autoscooter", en: "Bumper car" }, a: { lb: "engem Autoscooter", de: "einem Autoscooter", en: "a bumper car" },
    on: { lb: "souz an engem Autoscooter", de: "saß in einem Autoscooter", en: "sat in a bumper car" } },
  stain:    { block: false, name: { lb: "Uelegfleck", de: "Ölfleck", en: "Oil stain" }, a: { lb: "engem Uelegfleck", de: "einem Ölfleck", en: "an oil stain" },
    on: { lb: "stoung op engem Uelegfleck", de: "stand auf einem Ölfleck", en: "stood on an oil stain" } },
  puddle:   { block: false, name: { lb: "Pëtz", de: "Pfütze", en: "Puddle" }, a: { lb: "enger Pëtz", de: "einer Pfütze", en: "a puddle" },
    on: { lb: "stoung an enger Pëtz", de: "stand in einer Pfütze", en: "stood in a puddle" } },
  blanket:  { block: false, name: { lb: "Picknickdeck", de: "Picknickdecke", en: "Picnic blanket" }, a: { lb: "enger Picknickdeck", de: "einer Picknickdecke", en: "a picnic blanket" },
    on: { lb: "souz op enger Picknickdeck", de: "saß auf einer Picknickdecke", en: "sat on a picnic blanket" } },
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

/* The clue as a sentence fragment that goes under the person's name (no subject: "Was beside a table").
 * clueRich marks the key words with \u0001 … \u0002; clueText strips the marks, clueHTML turns them into <b>. */
const B = (x) => "\u0001" + x + "\u0002";
const boldNoun = (phrase, noun) => { const i = phrase.toLowerCase().indexOf(noun.toLowerCase()); return i < 0 ? phrase : phrase.slice(0, i) + B(phrase.slice(i, i + noun.length)) + phrase.slice(i + noun.length); };
const objA = (type, lang) => boldNoun(OBJECTS[type].a[lang], OBJECTS[type].name[lang]);
export function clueRich(cs, clue, lang) {
  const ord = (k) => k + 1;
  const R = (id) => B(roomName(cs, id, lang));
  switch (clue.t) {
    case "victim": return { lb: `Wor ${B("eleng mam Mäerder")}`, de: `War ${B("allein mit dem Mörder")}`, en: `Was ${B("alone with the murderer")}` }[lang];
    case "alone": return { lb: `Wor ${B("eleng")} am Beräich`, de: `War ${B("allein")} im Bereich`, en: `Was ${B("alone")} in their area` }[lang];
    case "in": return { lb: `Wor am Beräich „${R(clue.room)}“`, de: `War im Bereich „${R(clue.room)}“`, en: `Was in the ${R(clue.room)}` }[lang];
    case "notin": return { lb: `Wor ${B("net")} am Beräich „${R(clue.room)}“`, de: `War ${B("nicht")} im Bereich „${R(clue.room)}“`, en: `Was ${B("not")} in the ${R(clue.room)}` }[lang];
    case "near": return { lb: `Wor nieft ${objA(clue.obj, "lb")}`, de: `Stand neben ${objA(clue.obj, "de")}`, en: `Was beside ${objA(clue.obj, "en")}` }[lang];
    case "notnear": return { lb: `Wor ${B("net")} nieft ${objA(clue.obj, "lb")}`, de: `Stand ${B("nicht")} neben ${objA(clue.obj, "de")}`, en: `Was ${B("not")} beside ${objA(clue.obj, "en")}` }[lang];
    case "on": { const ph = boldNoun(OBJECTS[clue.obj].on[lang], OBJECTS[clue.obj].name[lang]); return ph.charAt(0).toUpperCase() + ph.slice(1); }
    case "row":
      if (clue.k === 0) return { lb: `Wor an der ${B("alleréischter Rei")} (uewen)`, de: `War in der ${B("obersten Zeile")}`, en: `Was in the ${B("top row")}` }[lang];
      if (clue.k === cs.n - 1) return { lb: `Wor an der ${B("leschter Rei")} (ënnen)`, de: `War in der ${B("untersten Zeile")}`, en: `Was in the ${B("bottom row")}` }[lang];
      return { lb: `Wor an der ${B(ord(clue.k) + ". Rei")}`, de: `War in ${B("Zeile " + ord(clue.k))}`, en: `Was in ${B("row " + ord(clue.k))}` }[lang];
    case "col":
      if (clue.k === 0) return { lb: `Wor an der ${B("alleréischter Kolonn")} (lénks)`, de: `War in der ${B("linken Spalte")}`, en: `Was in the ${B("left-most column")}` }[lang];
      if (clue.k === cs.n - 1) return { lb: `Wor an der ${B("leschter Kolonn")} (riets)`, de: `War in der ${B("rechten Spalte")}`, en: `Was in the ${B("right-most column")}` }[lang];
      return { lb: `Wor an der ${B(ord(clue.k) + ". Kolonn")}`, de: `War in ${B("Spalte " + ord(clue.k))}`, en: `Was in ${B("column " + ord(clue.k))}` }[lang];
    case "north": case "south": case "east": case "west": {
      const dir = {
        north: { lb: "nërdlech", de: "nördlich", en: "north" }, south: { lb: "südlech", de: "südlich", en: "south" },
        east: { lb: "ëstlech", de: "östlich", en: "east" }, west: { lb: "westlech", de: "westlich", en: "west" },
      }[clue.t][lang];
      const who = cs.people[clue.p];
      if (lang === "lb") return `Wor iergendwou ${B(dir)} ${who.g === "f" ? "vun der" : "vum"} ${B(who.name)}`;
      if (lang === "de") return `War irgendwo ${B(dir)} von ${B(who.name)}`;
      return `Was somewhere ${B(dir)} of ${B(who.name)}`;
    }
    case "same": {
      const who = cs.people[clue.p];
      return { lb: `Wor am ${B("selwechte Beräich")} ewéi ${personRef(cs, clue.p, "lb").replace(who.name, B(who.name))}`, de: `War im ${B("selben Bereich")} wie ${B(who.name)}`, en: `Was in the ${B("same area")} as ${B(who.name)}` }[lang];
    }
  }
  return "";
}
const strip = (s) => s.replace(/[\u0001\u0002]/g, "");
export const clueText = (cs, clue, lang) => strip(clueRich(cs, clue, lang));
const escHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/* "Was in a <b>car</b>." — key words bold, closing full stop */
export const clueHTML = (cs, clue, lang) => escHtml(clueRich(cs, clue, lang)).replace(/\u0001/g, "<b>").replace(/\u0002/g, "</b>") + ".";

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
    D("<b>Eng pro Rei, eng pro Kolonn:</b> All Persoun kritt e Feld. An all Rei a all Kolonn steet genee eng Persoun (wéi bei Sudoku). Déck Maueren deelen d'Feld a benannt Beräicher.",
      "<b>Eine pro Zeile, eine pro Spalte:</b> Jede Person bekommt ein Feld. In jeder Zeile und jeder Spalte steht genau eine Person (wie bei Sudoku). Dicke Wände teilen das Spielfeld in benannte Bereiche.",
      "<b>One per row, one per column:</b> Everybody gets one cell, and every row and every column holds exactly one person (like sudoku). Thick walls split the grid into named areas."),
    D("<b>Objeten:</b> Op blockéierende Saachen (Dësch, Regal, Bam, Auto, Fass, Uewen …) kann <b>keen</b> stoen. Op Stull, Sofa, Bank, Bett, Teppech, Uelegfleck an Autoscooter däerf een stoen. Vill Saachen si méi Felder grouss (en Auto zwee, eng Theke dräi) – all Feld dovun zielt.",
      "<b>Objekte:</b> Auf blockierenden Dingen (Tisch, Regal, Baum, Auto, Fass, Herd …) kann <b>niemand</b> stehen. Auf Stuhl, Sofa, Bank, Bett, Teppich, Ölfleck und Autoscooter darf man stehen. Viele Dinge sind mehrere Felder groß (ein Auto zwei, eine Theke drei) – jedes Feld davon zählt.",
      "<b>Objects:</b> <b>Nobody</b> can stand on blocking things (table, shelf, tree, car, barrel, stove …). You may stand on a chair, sofa, bench, bed, carpet, oil stain or bumper car. Many things cover several cells (a car two, a counter three) – every one of those cells counts."),
    D("<b>Niewendrun</b> heescht: ee vun den 8 Felder ronderëm, och diagonal (ouni dat Ding, op deem s du stees). <b>Nord</b> ass uewen. „Nërdlech vum Pol“ heescht iergendwou méi wäit uewen.",
      "<b>Daneben</b> heißt: eines der 8 umliegenden Felder, auch diagonal (nicht das Ding, auf dem man selbst steht). <b>Norden</b> ist oben. „Nördlich von Pol“ heißt irgendwo weiter oben.",
      "<b>Beside</b> means one of the 8 surrounding cells, diagonals included (not the thing you stand on yourself). <b>North</b> is up. “North of Pol” means anywhere further up."),
    D("<b>Dat Affer</b> seet ëmmer: „Wor eleng mam Mäerder.“ Am Beräich vum Affer stinn also genee zwou Persounen – déi aner ass de Mäerder.",
      "<b>Das Opfer</b> sagt immer: „War allein mit dem Mörder.“ Im Bereich des Opfers stehen also genau zwei Personen – die andere ist der Mörder.",
      "<b>The victim</b> always says: “Was alone with the murderer.” So exactly two people stand in the victim's area – the other one is the murderer."),
    D("<b>Bedienung:</b> Wiel eng Persoun. <b>Tippen</b> = kleng Buschtaf am Feld, <b>Wëschen</b> = Buschtawen op ville Felder, <b>laang drécken</b> (oder duebel tippen) = d'Persoun setzen. Mam ✕ markéiers du Felder, wou keen hi ka. De Gummi läscht d'Notize vum Feld (laang drécken = all Notizen).",
      "<b>Bedienung:</b> Wähle eine Person. <b>Tippen</b> = kleiner Buchstabe im Feld, <b>Wischen</b> = Buchstaben auf vielen Feldern, <b>lange drücken</b> (oder Doppeltipp) = Person setzen. Mit ✕ markierst du Felder, auf denen niemand sein kann. Der Radierer löscht die Notizen des Feldes (lange drücken = alle Notizen).",
      "<b>Controls:</b> Pick a person. <b>Tap</b> = a small letter in the cell, <b>swipe</b> = letters on many cells, <b>hold</b> (or double-tap) = place the person. ✕ marks cells where nobody can be. The eraser clears a cell's notes (hold = clear all notes)."),
    D("<b>Tastatur:</b> D'Buschtaf vun enger Persoun schreift eng Notiz op dat Feld ënnert der Maus, 1–9 wielt eng Persoun, Enter setzt, X = ✕, Backspace = radéieren, Ctrl+Z = zréck, ? = Hiweis.",
      "<b>Tastatur:</b> Der Buchstabe einer Person schreibt eine Notiz auf das Feld unter der Maus, 1–9 wählt eine Person, Enter setzt, X = ✕, Rücktaste = radieren, Strg+Z = zurück, ? = Hinweis.",
      "<b>Keyboard:</b> a person's letter writes a note on the cell under the mouse, 1–9 pick a person, Enter places, X = ✕, Backspace = erase, Ctrl+Z = undo, ? = hint."),
  ],
  erase: D("Gummi", "Radierer", "Eraser"),
  settings: D("Astellungen", "Einstellungen", "Settings"),
  cross: D("Kräiz", "Kreuz", "Cross"),
  checkLocked: D("Setz fir d'éischt jiddereen", "Erst alle platzieren", "Place everyone first"),
  clearOnPlace: D("Notize vun enger Persoun läschen, wann se gesat gëtt", "Notizen einer Person löschen, wenn sie gesetzt wird", "Clear a person's notes when they are placed"),
  victimLead: D("D'Affer.", "Das Opfer.", "The victim."),
  holdHint: D("Laang drécken fir ze setzen", "Lange drücken zum Setzen", "Hold to place"),
  caseFile: D("Fall", "Fall", "Case"),
  stamp: D("GELÉIST", "GELÖST", "SOLVED"),
  who: D("Wien wor et?", "Wer war es?", "Who did it?"),
};
export const T = (key, lang, vars) => {
  const entry = UI[key];
  let s = entry ? (entry[lang] ?? entry.en) : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
};
