// lb / de / en strings for everything W1 produces. The lb texts are drafts for Ian to proofread.
// Placeholders look like {name}; all three languages must use the same placeholders (harness.js checks this).

export const LANGS = Object.freeze(["lb", "de", "en"]);
export const DEFAULT_LANG = "lb";

const lb = {
  "game.title": "Schueberfouer Tycoon",
  "game.pitch": "Bau deng Plaz op der Schueberfouer op: vum Gromperekichelcher-Stand bis zum Riserad.",
  "item.kachel": "Gromperekichelcher", "item.fritten": "Fritten", "item.lous": "Lotteriebud",
  "item.kanner": "Kannerkarussell", "item.wurscht": "Grillwurscht", "item.zocker": "Zockerwatt",
  "item.lukas": "Haut de Lukas", "item.mandel": "Mandelen & Magenbrout", "item.waffel": "Eisekuch",
  "item.fesch": "Fouerfësch", "item.kette": "Kettekarussell", "item.scooter": "Autoscooter",
  "item.crepes": "Crêpes", "item.schiess": "Schéissbud", "item.bayern": "Bayern-Kurve",
  "item.happy": "Schëffskarussell", "item.break": "Break Dance", "item.musik": "Musik Express",
  "item.takeoff": "Kippkarussell", "item.tent": "Bierzelt a Restaurant", "item.wheel": "Riserad",
  "item.maus": "Wëll Maus", "item.geister": "Geeschterbunn", "item.jules": "Tuerm-Schaukel",
  "item.hangover": "Fallturm", "item.splash": "Waasserbunn", "item.booster": "Booster",
  "item.alpina": "Alpebunn", "item.looping": "Looping-Bunn", "item.infinity": "Pendelarm",
  "item.gold": "Gëllent Karussell", "item.museum": "Mäin ale Park", "item.lammy": "Hämmi-Statu",
  "cat.ride": "Fahrgeschäfter", "cat.food": "Iessen", "cat.game": "Spiller", "cat.deco": "Dekoratioun",
  "level.0": "Niveau 1", "level.1": "Niveau 2", "level.2": "Niveau 3", "level.3": "Gëllen",
  "look.traditioun": "Traditioun", "look.neon": "Neon", "look.retro": "Retro",
  "verb.build": "Opbauen", "verb.upgrade": "Verbessere", "verb.walk": "Ëmgesinn", "verb.replace": "Ersetzen",
  "ui.free": "gratis", "ui.starterGift": "gratis (Kaddo vum Hämmi)", "ui.upgradeFor": "Verbessere ({cost})",
  "ui.refund": "Réckerstattung: {amount}", "ui.pitchLocked": "ab ⭐{stars}", "ui.voucherFree": "Gutschäin: gratis",
  "ui.voucherHalf": "Gutschäin: hallwe Präis ({cost})", "ui.queue": "D'Leit stinn un. Verbessert de Stand oder bau e zweeten.",
  "ui.incomePerMin": "+{amount} pro Minutt",
  "goal.firstBuild": "Bau däi Stand op déi gëllen Plaz.",
  "goal.voucher": "Setz däi Gutschäin fir {item} op eng Plaz.",
  "goal.star": "Ziel: ⭐{stars}, nach {points} Punkten",
  "goal.tip.build": "Tipp: {item} opbauen ({cost})", "goal.tip.upgrade": "Tipp: {item} verbessere ({cost})",
  "goal.tip.replace": "Tipp: {item} amplaz vun engem klenge Stand ({cost})",
  "goal.fill": "Bau {item} op eng fräi Plaz ({cost}).", "goal.replace": "Ersetz e Stand duerch {item} ({cost}), fir méi Akommes.", "goal.upgrade": "Verbessert {item} ({cost}).",
  "goal.gold": "Maach {item} gëllen ({cost}).", "goal.maxed": "Alles ass gëllen. Du bass de Kinnek vun der Fouer!",
  "tutorial.1": "Tipp op déi gëllen Plaz.", "tutorial.2": "Tipp op „Opbauen“.",
  "tutorial.3": "Gesäis de? D'Leit bezuele.", "tutorial.4": "Bau e zweete Stand: d'Kannerkarussell.",
  "tutorial.5": "Tipp op däi Stand a verbessert en.", "tutorial.6": "Hei steet däi Ziel.",
  "tutorial.7": "Tipp op 👣 a gank selwer duerch d'Fouer.", "tutorial.skip": "Ech weess et",
  "hammi.welcome": "Moien! D'Fouer fänkt un. Dëst ass deng Plaz.", "hammi.firstCoin": "Gesäis de? D'Leit bezuele.",
  "event.fouer": "D'Fouer leeft!", "event.opening": "Ouverture vun der Fouer", "event.familljendag": "Familljendag",
  "event.fouersonndeg": "Fouersonndeg", "event.haemmelsmarsch": "Hämmelsmarsch", "event.lastday": "Lescht Dag",
  "event.fireworks": "Feierwierk",
  "event.nextFouer": "Nächst Fouer: {date} ({days} Deeg)", "event.nextFouerToday": "D'Fouer fänkt haut un!",
  "event.stamp.title": "Fouer-Stempelkaart", "event.stamp.count": "{count} vun 20 Stempelen",
  "event.stamp.reward.5": "5 Stempelen: gëllene Glühbirnen-Pak", "event.stamp.reward.10": "10 Stempelen: Hämmi-Statu",
  "event.stamp.reward.15": "15 Stempelen: gëllene Ticketshäische", "event.stamp.reward.20": "20 Stempelen: Kroun a Plakett „Fouer {year}“",
  "event.fireworksGift": "Feierwierk-Kaddo: +{amount}",
  "offline.title": "Wëllkomm zeréck", "offline.body": "Dei Stänn hu während {duration} {amount} verdéngt.",
  "offline.claim": "Hol of", "offline.fouer": "D'Fouer leeft! Extra Verdéngscht wärend Du fort bass.",
  "offline.cap": "Héchstens {hours} Stonnen ginn ugerechent.",
  "gift.toast": "🎁 Kaddo: +{amount} {what}", "gift.what": "Suen",
  "letter.title": "Bréif vum Hämmi", "letter.body": "Däi Park ass op de Glacis geplënnert! Alles wat s de gebaut hues, kënnt mat.",
  "letter.pioneerValue": "Pionéier-Wäert +{value}", "letter.cash": "Cash {amount}",
  "letter.rating": "Rating-Bonus +{points} (⭐{stars})", "letter.vouchers": "Deng Gutschäiner",
  "letter.gold": "Gëllent Karussell", "letter.kiosk": "Mäin ale Park (Kiosk)", "letter.go": "Op d'Fouer!",
  "letter.topup": "Däi zweete Park gouf och matgeholl.",
  "letter.corrupt": "Mir konnten däi ale Park net liesen. Hei ass awer e klenge Merci:",
  "letter.stub": "Däi ale Park ass op dësem Apparat net méi do, mä däi Score ass matkomm.",
  "pioneer.badge": "Pionéier", "museum.title": "Mäin ale Park", "museum.empty": "Et ass kee ale Park gespäichert.",
  "reason.no-pitch": "Dës Plaz gëtt et net.", "reason.unknown-item": "Dat gëtt et net.",
  "reason.bad-look": "Dëse Look gëtt et net.", "reason.occupied": "Op där Plaz steet schonn eppes.",
  "reason.wrong-size": "Dat passt net op dës Plaz.", "reason.max-copies": "Dat kanns de héchstens dräimol hunn.",
  "reason.pitch-locked": "Dës Plaz gëtt méi spéit fräi.", "reason.item-locked": "Dat gëtt et nach net: sammel méi Stären.",
  "reason.unaffordable": "Du hues net genuch Suen.", "reason.empty": "Do steet näischt.",
  "reason.maxed": "Méi gëtt et net ze verbesseren.", "reason.no-voucher": "Du hues kee Gutschäin dofir.",
  "reason.not-claimable": "Elo gëtt et näischt ofzehuelen.", "reason.already-claimed": "Dat hues du schonn ofgeholl.",
};

const de = {
  "game.title": "Schueberfouer Tycoon",
  "game.pitch": "Baue deinen Stand auf der echten Schueberfouer auf: vom Kartoffelpuffer-Stand bis zum Riesenrad.",
  "item.kachel": "Kartoffelpuffer", "item.fritten": "Pommes", "item.lous": "Losbude",
  "item.kanner": "Kinderkarussell", "item.wurscht": "Grillwurst", "item.zocker": "Zuckerwatte",
  "item.lukas": "Hau den Lukas", "item.mandel": "Gebrannte Mandeln & Magenbrot", "item.waffel": "Eisenkuchen (Waffeln)",
  "item.fesch": "Backfisch", "item.kette": "Kettenkarussell", "item.scooter": "Autoscooter",
  "item.crepes": "Crêpes", "item.schiess": "Schießbude", "item.bayern": "Bayern-Kurve",
  "item.happy": "Schiffskarussell", "item.break": "Break Dance", "item.musik": "Musik Express",
  "item.takeoff": "Kipp-Fahrgeschäft", "item.tent": "Bierzelt & Restaurant", "item.wheel": "Riesenrad",
  "item.maus": "Wilde Maus", "item.geister": "Geisterbahn", "item.jules": "Turmschaukel",
  "item.hangover": "Fallturm", "item.splash": "Wildwasserbahn", "item.booster": "Booster",
  "item.alpina": "Alpenbahn", "item.looping": "Looping-Bahn", "item.infinity": "Pendelarm",
  "item.gold": "Goldenes Karussell", "item.museum": "Mein alter Park", "item.lammy": "Hämmi-Statue",
  "cat.ride": "Fahrgeschäfte", "cat.food": "Essen", "cat.game": "Spiele", "cat.deco": "Dekoration",
  "level.0": "Stufe 1", "level.1": "Stufe 2", "level.2": "Stufe 3", "level.3": "Gold",
  "look.traditioun": "Tradition", "look.neon": "Neon", "look.retro": "Retro",
  "verb.build": "Aufbauen", "verb.upgrade": "Verbessern", "verb.walk": "Umsehen", "verb.replace": "Ersetzen",
  "ui.free": "gratis", "ui.starterGift": "gratis (Geschenk von Hämmi)", "ui.upgradeFor": "Verbessern ({cost})",
  "ui.refund": "Rückerstattung: {amount}", "ui.pitchLocked": "ab ⭐{stars}", "ui.voucherFree": "Gutschein: gratis",
  "ui.voucherHalf": "Gutschein: halber Preis ({cost})", "ui.queue": "Die Leute stehen an. Verbessere den Stand oder baue einen zweiten.",
  "ui.incomePerMin": "+{amount} pro Minute",
  "goal.firstBuild": "Baue deinen Stand auf dem goldenen Platz.",
  "goal.voucher": "Setze deinen Gutschein für {item} auf einen Platz.",
  "goal.star": "Ziel: ⭐{stars}, noch {points} Punkte",
  "goal.tip.build": "Tipp: {item} aufbauen ({cost})", "goal.tip.upgrade": "Tipp: {item} verbessern ({cost})",
  "goal.tip.replace": "Tipp: {item} statt eines kleinen Stands ({cost})",
  "goal.fill": "Baue {item} auf einen freien Platz ({cost}).", "goal.replace": "Ersetze einen Stand durch {item} ({cost}) für mehr Einnahmen.", "goal.upgrade": "Verbessere {item} ({cost}).",
  "goal.gold": "Mach {item} golden ({cost}).", "goal.maxed": "Alles ist golden. Du bist der König der Fouer!",
  "tutorial.1": "Tippe auf den goldenen Platz.", "tutorial.2": "Tippe auf „Aufbauen“.",
  "tutorial.3": "Siehst du? Die Leute bezahlen.", "tutorial.4": "Baue einen zweiten Stand: das Kinderkarussell.",
  "tutorial.5": "Tippe auf deinen Stand und verbessere ihn.", "tutorial.6": "Hier steht dein Ziel.",
  "tutorial.7": "Tippe auf 👣 und geh selbst über die Fouer.", "tutorial.skip": "Ich weiß es schon",
  "hammi.welcome": "Moin! Die Fouer geht los. Das ist dein Platz.", "hammi.firstCoin": "Siehst du? Die Leute bezahlen.",
  "event.fouer": "Die Fouer läuft!", "event.opening": "Eröffnung der Fouer", "event.familljendag": "Familljendag",
  "event.fouersonndeg": "Fouersonndeg", "event.haemmelsmarsch": "Hämmelsmarsch", "event.lastday": "Letzter Tag",
  "event.fireworks": "Feuerwerk",
  "event.nextFouer": "Nächste Fouer: {date} (in {days} Tagen)", "event.nextFouerToday": "Die Fouer beginnt heute!",
  "event.stamp.title": "Fouer-Stempelkarte", "event.stamp.count": "{count} von 20 Stempeln",
  "event.stamp.reward.5": "5 Stempel: goldenes Glühbirnen-Paket", "event.stamp.reward.10": "10 Stempel: Hämmi-Statue",
  "event.stamp.reward.15": "15 Stempel: goldenes Kassenhäuschen", "event.stamp.reward.20": "20 Stempel: Krone und Plakette „Fouer {year}“",
  "event.fireworksGift": "Feuerwerk-Geschenk: +{amount}",
  "offline.title": "Willkommen zurück", "offline.body": "Deine Stände haben in {duration} {amount} verdient.",
  "offline.claim": "Abholen", "offline.fouer": "Die Fouer läuft! Extra-Verdienst, während du weg warst.",
  "offline.cap": "Höchstens {hours} Stunden werden angerechnet.",
  "gift.toast": "🎁 Geschenk: +{amount} {what}", "gift.what": "Geld",
  "letter.title": "Brief von Hämmi", "letter.body": "Dein Park ist auf den Glacis umgezogen! Alles, was du gebaut hast, kommt mit.",
  "letter.pioneerValue": "Pionier-Wert +{value}", "letter.cash": "Bargeld {amount}",
  "letter.rating": "Rating-Bonus +{points} (⭐{stars})", "letter.vouchers": "Deine Gutscheine",
  "letter.gold": "Goldenes Karussell", "letter.kiosk": "Mein alter Park (Kiosk)", "letter.go": "Auf zur Fouer!",
  "letter.topup": "Dein zweiter Park wurde auch übernommen.",
  "letter.corrupt": "Wir konnten deinen alten Park nicht lesen. Hier ist trotzdem ein kleines Dankeschön:",
  "letter.stub": "Dein alter Park ist auf diesem Gerät nicht mehr da, aber dein Punktestand ist mitgekommen.",
  "pioneer.badge": "Pionier", "museum.title": "Mein alter Park", "museum.empty": "Es ist kein alter Park gespeichert.",
  "reason.no-pitch": "Diesen Platz gibt es nicht.", "reason.unknown-item": "Das gibt es nicht.",
  "reason.bad-look": "Diesen Look gibt es nicht.", "reason.occupied": "Auf diesem Platz steht schon etwas.",
  "reason.wrong-size": "Das passt nicht auf diesen Platz.", "reason.max-copies": "Davon darfst du höchstens drei haben.",
  "reason.pitch-locked": "Dieser Platz wird später frei.", "reason.item-locked": "Das gibt es noch nicht: sammle mehr Sterne.",
  "reason.unaffordable": "Du hast nicht genug Geld.", "reason.empty": "Dort steht nichts.",
  "reason.maxed": "Mehr Verbesserungen gibt es nicht.", "reason.no-voucher": "Du hast dafür keinen Gutschein.",
  "reason.not-claimable": "Im Moment gibt es nichts abzuholen.", "reason.already-claimed": "Das hast du schon abgeholt.",
};

const en = {
  "game.title": "Schueberfouer Tycoon",
  "game.pitch": "Build your own corner of the real Schueberfouer, from a potato-fritter stall to the big wheel.",
  "item.kachel": "Potato fritters", "item.fritten": "Chips", "item.lous": "Lottery stall",
  "item.kanner": "Kids' carousel", "item.wurscht": "Grilled sausage", "item.zocker": "Candy floss",
  "item.lukas": "Strength tester", "item.mandel": "Roasted almonds & Magenbrot", "item.waffel": "Waffles (Eisekuch)",
  "item.fesch": "Fried fish with chips", "item.kette": "Chain swing ride", "item.scooter": "Bumper cars",
  "item.crepes": "Crêpes", "item.schiess": "Shooting gallery", "item.bayern": "Bavarian curve",
  "item.happy": "Boat carousel", "item.break": "Break Dance", "item.musik": "Music Express",
  "item.takeoff": "Tilt ride", "item.tent": "Beer tent & restaurant", "item.wheel": "Big wheel",
  "item.maus": "Wild mouse", "item.geister": "Ghost train", "item.jules": "Tower swing",
  "item.hangover": "Drop tower", "item.splash": "Log flume", "item.booster": "Booster",
  "item.alpina": "Alpine coaster", "item.looping": "Five-loop coaster", "item.infinity": "Giant pendulum arm",
  "item.gold": "Gold carousel", "item.museum": "My old park", "item.lammy": "Hämmi statue",
  "cat.ride": "Rides", "cat.food": "Food", "cat.game": "Games", "cat.deco": "Decoration",
  "level.0": "Level 1", "level.1": "Level 2", "level.2": "Level 3", "level.3": "Gold",
  "look.traditioun": "Tradition", "look.neon": "Neon", "look.retro": "Retro",
  "verb.build": "Build", "verb.upgrade": "Upgrade", "verb.walk": "Look around", "verb.replace": "Replace",
  "ui.free": "free", "ui.starterGift": "free (a gift from Hämmi)", "ui.upgradeFor": "Upgrade ({cost})",
  "ui.refund": "Refund: {amount}", "ui.pitchLocked": "from ⭐{stars}", "ui.voucherFree": "Voucher: free",
  "ui.voucherHalf": "Voucher: half price ({cost})", "ui.queue": "People are queueing. Upgrade the stall or build a second one.",
  "ui.incomePerMin": "+{amount} per minute",
  "goal.firstBuild": "Build your stall on the golden pitch.",
  "goal.voucher": "Place your voucher for {item} on a pitch.",
  "goal.star": "Goal: ⭐{stars}, {points} points to go",
  "goal.tip.build": "Tip: build {item} ({cost})", "goal.tip.upgrade": "Tip: upgrade {item} ({cost})",
  "goal.tip.replace": "Tip: put {item} in place of a small stall ({cost})",
  "goal.fill": "Build {item} on a free pitch ({cost}).", "goal.replace": "Swap a stall for {item} ({cost}) to earn more.", "goal.upgrade": "Upgrade {item} ({cost}).",
  "goal.gold": "Make {item} gold ({cost}).", "goal.maxed": "Everything is gold. You are the king of the Fouer!",
  "tutorial.1": "Tap the golden pitch.", "tutorial.2": "Tap “Build”.",
  "tutorial.3": "See? The guests pay.", "tutorial.4": "Build a second attraction: the kids' carousel.",
  "tutorial.5": "Tap your stall and upgrade it.", "tutorial.6": "Your goal is right here.",
  "tutorial.7": "Tap 👣 and walk around the Fouer yourself.", "tutorial.skip": "I know it already",
  "hammi.welcome": "Hello! The Fouer is about to begin. This is your pitch.", "hammi.firstCoin": "See? The guests pay.",
  "event.fouer": "The Fouer is on!", "event.opening": "Opening of the Fouer", "event.familljendag": "Family day",
  "event.fouersonndeg": "Fouer Sunday", "event.haemmelsmarsch": "Hämmelsmarsch", "event.lastday": "Last day",
  "event.fireworks": "Fireworks",
  "event.nextFouer": "Next Fouer: {date} (in {days} days)", "event.nextFouerToday": "The Fouer opens today!",
  "event.stamp.title": "Fouer stamp card", "event.stamp.count": "{count} of 20 stamps",
  "event.stamp.reward.5": "5 stamps: golden bulb pack", "event.stamp.reward.10": "10 stamps: Hämmi statue",
  "event.stamp.reward.15": "15 stamps: golden ticket booth", "event.stamp.reward.20": "20 stamps: crown and “Fouer {year}” plaque",
  "event.fireworksGift": "Fireworks gift: +{amount}",
  "offline.title": "Welcome back", "offline.body": "Your stalls earned {amount} in {duration}.",
  "offline.claim": "Collect", "offline.fouer": "The Fouer is on! Extra earnings while you were away.",
  "offline.cap": "At most {hours} hours are counted.",
  "gift.toast": "🎁 Gift: +{amount} {what}", "gift.what": "cash",
  "letter.title": "Letter from Hämmi", "letter.body": "Your park has moved to the Glacis! Everything you built came with you.",
  "letter.pioneerValue": "Pioneer value +{value}", "letter.cash": "Cash {amount}",
  "letter.rating": "Rating bonus +{points} (⭐{stars})", "letter.vouchers": "Your vouchers",
  "letter.gold": "Gold carousel", "letter.kiosk": "My old park (kiosk)", "letter.go": "To the Fouer!",
  "letter.topup": "Your second park came along too.",
  "letter.corrupt": "We could not read your old park. Here is a small thank-you anyway:",
  "letter.stub": "Your old park is no longer on this device, but your score came along.",
  "pioneer.badge": "Pioneer", "museum.title": "My old park", "museum.empty": "No old park is stored.",
  "reason.no-pitch": "There is no such pitch.", "reason.unknown-item": "That does not exist.",
  "reason.bad-look": "There is no such look.", "reason.occupied": "Something already stands on this pitch.",
  "reason.wrong-size": "That does not fit this pitch.", "reason.max-copies": "You can have at most three of those.",
  "reason.pitch-locked": "This pitch opens later.", "reason.item-locked": "Not available yet: collect more stars.",
  "reason.unaffordable": "You do not have enough money.", "reason.empty": "There is nothing there.",
  "reason.maxed": "There is nothing left to upgrade.", "reason.no-voucher": "You have no voucher for that.",
  "reason.not-claimable": "There is nothing to collect right now.", "reason.already-claimed": "You already collected that.",
};

export const STRINGS = Object.freeze({ lb: Object.freeze(lb), de: Object.freeze(de), en: Object.freeze(en) });

export const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

/** Look up a string, falling back to English and then to the key itself (with a console warning). */
export function t(lang, key, params = {}) {
  const text = STRINGS[lang]?.[key] ?? STRINGS.en[key];
  if (text === undefined) { console.warn(`[fouer] missing string "${key}"`); return key; }
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    if (params[name] === undefined) { console.warn(`[fouer] string "${key}" is missing {${name}}`); return match; }
    return String(params[name]);
  });
}

const MONTHS = Object.freeze({
  lb: ["Jan.", "Feb.", "Mäe.", "Abr.", "Mee", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."],
  de: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
});

/** "20. Aug. 2027" (lb, de) or "20 Aug 2027" (en). */
export function formatDate(lang, { year, month, day }) {
  const name = (MONTHS[lang] ?? MONTHS.lb)[month - 1];
  return lang === "en" ? `${day} ${name} ${year}` : `${day}. ${name} ${year}`;
}

/** Euro amounts with thousands commas ("€4,380"), compact above 100,000 ("€1.2M"). */
export function formatMoney(amount) {
  const value = Math.floor(Math.max(0, amount));
  if (value >= 1e9) return `€${(value / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (value >= 1e6) return `€${(value / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (value >= 1e5) return `€${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `€${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** "6 h 12 min", "45 min", "40 s": the same shape in every language. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}
