/* Burger-Restaurant: every Luxembourgish sentence of the game (checked with spellchecker.lu / lod.lu, Nov 2026). */
import {ITEMS, RECIPES, TOPPINGS, UNLOCKS} from "/pb/burger/data.js?v=2";
import {levelFor, recipeOnBoard} from "/pb/burger/sim.js?v=3";

const NEW_ITEM_HINT_MS = 10_000;
const TUTORIAL_LAST_DAY = 2;
const FRIES_TUTORIAL_DAY = 3;

export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
export const coinsText = (count) => plural(count, "Mënz", "Mënzen");

const unlockName = (id) => ITEMS[id]?.name || TOPPINGS.find((topping) => topping.id === id)?.name || id;
const newToday = (day) => [
  ...RECIPES.filter((recipe) => recipe.day === day && day > 1).map((recipe) => recipe.id),
  ...Object.entries(UNLOCKS).filter(([id, unlockDay]) => unlockDay === day && !RECIPES.some((recipe) => recipe.id === id)).map(([id]) => id),
].map(unlockName);

function tutorialHint(session) {
  const wanted = session.customers.flatMap((customer) => customer.left);
  if (session.tray.some((item) => wanted.includes(item.id))) return "Tipp op de Plateau oder op de Client, fir ze zerwéieren.";
  if (recipeOnBoard(session)) return "De Burger ass prett: tipp op „Zerwéieren“.";
  if (session.grill.some((slot) => slot.state === "burnt")) return "Verbrannt! Tipp drop, fir et ewechzegeheien.";
  if (session.grill.some((slot) => slot.state === "ready")) return "D'Fleesch ass fäerdeg: tipp drop!";
  if (session.grill.some((slot) => slot.state === "cooking")) return "D'Fleesch brutzelt ...";
  if (wanted.length) return "Tipp op de Grill, fir Fleesch ze broden.";
  return "Gläich kënnt deen éischte Client.";
}

function friesHint(session) {
  const wanted = session.customers.flatMap((customer) => customer.left);
  if (session.fryer.some((slot) => slot.state === "ready")) return "D'Fritte si fäerdeg: tipp drop!";
  if (wanted.includes("fries") && session.fryer.every((slot) => slot.state === "empty") && !session.tray.some((item) => item.id === "fries")) {
    return "Fritten: tipp op d'Friteuse.";
  }
  return "";
}

export const MESSAGES = Object.freeze({
  trayEmpty:"Eidel Plaz um Plateau",
  serve:(name) => `${name} zerwéieren`,
  guestWants:(names) => `Client wëll: ${names.join(", ")}`,
  tapToCook:"+ tippen",
  cooking:"brutzelt",
  readyPatty:"fäerdeg!",
  readyFries:"fäerdeg!",
  burnt:"verbrannt",
  readyDrink:"fäerdeg!",
  filling:"leeft",
  pickDrink:"eidel",
  tap:"Krunn",
  fromDay:(day) => `Vun Dag ${day} un`,
  dayShort:(day) => `Dag ${day}`,
  plate:"Op de Plateau",
  plateRecipe:(name) => `${name}: op de Plateau`,
  serveRecipe:(name) => `${name} zerwéieren`,
  noRecipe:"Kee Rezept",
  boost:"Turbo",
  boostOn:"Turbo!",
  walkedOut:"fortgaang",
  refused:Object.freeze({
    "board-full":"De Burger huet scho genuch Fleesch.",
    cooking:"",
    locked:"Dat ass nach net fräigeschalt.",
    "tray-full":"De Plateau ass voll: zerwéier fir d'éischt eppes.",
    "taps-busy":"All Krunne lafen: huel fir d'éischt e fäerdegt Gedrénks.",
    "no-patty":"Fir d'éischt fäerdegt Fleesch vum Grill drop.",
    "no-recipe":"Esou e Burger steet net op der Kaart. Kuck d'Bestellung oder gehei en ewech.",
    unwanted:"Kee Client wëll dat. Nach eng Kéier tippen: ewechgeheien.",
    "nothing-ready":"Fir dëse Client ass nach näischt um Plateau.",
    "boost-cooldown":"Den Turbo ass nach net prett.",
    busy:"",
    max:"Méi geet net.",
    "no-coins":"Net genuch Mënzen.",
    "no-stars":"Net genuch Stären.",
  }),

  hintFor(state) {
    const session = state.session;
    if (!session) return "";
    if (session.day <= TUTORIAL_LAST_DAY) return tutorialHint(session);
    if (session.day === FRIES_TUTORIAL_DAY) {
      const hint = friesHint(session);
      if (hint) return hint;
    }
    const fresh = newToday(session.day);
    return fresh.length && session.t < NEW_ITEM_HINT_MS ? `Nei haut: ${fresh.join(", ")}` : "";
  },

  panel(state) {
    const {progress, session, screen} = state;
    if (screen === "paused") {
      return {title:"Paus", message:"D'Zäit steet, bis du weiderspills.", detail:"", howto:false, start:"Weider", stars:null};
    }
    const result = screen === "summary" ? session?.result : null;
    if (result) {
      const lastDay = result.hasPassed && progress.day === result.day;
      const detail = [
        `${plural(result.served, "Client", "Clienten")} zefridden`,
        `${result.walkouts} fortgaang`,
        result.rating === 3 ? "+1 Stär" : result.hasPassed ? "3 Stären: 150 % vum Zil a keen, deen fortgeet" : "",
      ].filter(Boolean).join(" · ");
      return {
        title:result.hasPassed ? (lastDay ? `All ${result.day} Deeg gepackt!` : "Dag gepackt!") : "Zil verpasst",
        message:result.hasPassed
          ? `Verdéngt: ${coinsText(result.earned)} (Zil ${result.goal}).`
          : `${result.earned} vun ${result.goal} Mënzen. Du behäls se: probéier den Dag nach eng Kéier.`,
        detail,
        howto:false,
        start:result.hasPassed && !lastDay ? `Dag ${progress.day} ufänken` : "Nach eng Kéier",
        stars:result.rating,
      };
    }
    const fresh = newToday(progress.day);
    return {
      title:`Dag ${progress.day}`,
      message:`Zil: ${coinsText(levelFor(progress.day).goal)}.`,
      detail:fresh.length ? `Nei haut: ${fresh.join(", ")}` : "",
      howto:progress.day <= TUTORIAL_LAST_DAY,
      start:`Dag ${progress.day} ufänken`,
      stars:null,
    };
  },
});

