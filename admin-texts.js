/* Shared helpers of the admin tabs "Kart" and "Saves" (admin-kart.js, admin-saves.js):
 * lb / de / en texts (Luxembourgish default, like the rest of the site), number and
 * time formatting, HTML escaping. No network, no DOM. */

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
));

export const lang = () => {
  const current = window.I18N?.lang;
  return current === "de" || current === "en" ? current : "lb";
};

/* key: [lb, de, en]. {name} placeholders are filled by at(key, { name }). */
const TEXTS = {
  "tab.kart": ["🏎️ Kart", "🏎️ Kart", "🏎️ Kart"],
  "tab.saves": ["💾 Saves", "💾 Saves", "💾 Saves"],
  "common.refresh": ["🔄 Aktualiséieren", "🔄 Aktualisieren", "🔄 Refresh"],
  "common.loading": ["Gëtt gelueden…", "Wird geladen…", "Loading…"],
  "common.cancel": ["Ofbriechen", "Abbrechen", "Cancel"],
  "common.close": ["Zoumaachen", "Schließen", "Close"],
  "common.never": ["nach ni", "noch nie", "never"],
  "common.unknown": ["onbekannt", "unbekannt", "unknown"],
  "common.s": ["{n} s", "{n} s", "{n} s"],
  "ago.now": ["grad eben", "gerade eben", "just now"],
  "ago.s": ["viru {n} s", "vor {n} s", "{n} s ago"],
  "ago.m": ["viru {n} min", "vor {n} min", "{n} min ago"],
  "ago.h": ["viru {n} h", "vor {n} h", "{n} h ago"],
  "ago.d": ["viru {n} Deeg", "vor {n} Tagen", "{n} d ago"],

  /* ---------------- Kart ---------------- */
  "kart.title": ["Online-Rennen", "Online-Rennen", "Online races"],
  "kart.filterName": ["Spiller sichen…", "Spieler suchen…", "Find a player…"],
  "kart.filterNameLabel": ["Spiller", "Spieler", "Player"],
  "kart.filterDay": ["Dag", "Tag", "Day"],
  "kart.clear": ["Filteren zrécksetzen", "Filter zurücksetzen", "Clear filters"],
  "kart.more": ["Méi eeler Rennen lueden", "Ältere Rennen laden", "Load older races"],
  "kart.count": ["{shown} vun {total} gelueden Rennen", "{shown} von {total} geladenen Rennen", "{shown} of {total} loaded races"],
  "kart.hint": ["D'Filteren gëllen nëmmen fir déi gelueden Rennen.", "Die Filter gelten nur für die geladenen Rennen.", "Filters only apply to the races loaded so far."],
  "kart.empty": ["Nach keng Online-Rennen.", "Noch keine Online-Rennen.", "No online races yet."],
  "kart.noMatch": ["Kee Rennen passt zu de Filteren.", "Kein Rennen passt zu den Filtern.", "No race matches the filters."],
  "kart.error": ["D'Rennen konnten net gelueden ginn. Probéier et glaich nach eng Kéier.", "Die Rennen konnten nicht geladen werden. Versuch es gleich nochmal.", "Couldn’t load the races. Try again shortly."],
  "kart.humans": ["{n} Mënschen", "{n} Menschen", "{n} humans"],
  "kart.laps": ["{n} Ronnen", "{n} Runden", "{n} laps"],
  "kart.race": ["Rennen", "Rennen", "Race"],
  "kart.gp": ["Grand Prix", "Grand Prix", "Grand Prix"],
  "kart.round": ["Ronn {n}", "Runde {n}", "Round {n}"],
  "kart.room": ["Raum {code}", "Raum {code}", "Room {code}"],
  "kart.issues": ["Verbindungsprobleemer", "Verbindungsprobleme", "Connection issues"],
  "kart.col.place": ["Plaz", "Platz", "Place"],
  "kart.col.name": ["Numm", "Name", "Name"],
  "kart.col.time": ["Zäit", "Zeit", "Time"],
  "kart.col.best": ["Beschte Tour", "Beste Runde", "Best lap"],
  "kart.col.link": ["Verbindung", "Verbindung", "Connection"],
  "kart.col.dropped": ["Erausgefall", "Rausgeflogen", "Dropped"],
  "kart.col.away": ["Bot-gesteiert", "Bot-gesteuert", "Bot-driven"],
  "kart.bot": ["Bot", "Bot", "Bot"],
  "kart.guest": ["Gaascht", "Gast", "Guest"],
  "kart.droppedAt": ["bei {n} s", "bei {n} s", "at {n} s"],
  "kart.link.p2p": ["P2P", "P2P", "P2P"],
  "kart.link.relay": ["Relay", "Relay", "Relay"],
  "kart.link.mixed": ["Gemëscht", "Gemischt", "Mixed"],
  "kart.openSaves": ["Späicherstänn vu(n) {name} opmaachen", "Spielstände von {name} öffnen", "Open saves of {name}"],
  "kart.noTime": ["ouni Zäit", "ohne Zeit", "no time"],
  "kart.expand": ["Spiller weisen", "Spieler anzeigen", "Show players"],

  /* ---------------- Saves ---------------- */
  "saves.title": ["Späicherstänn vun engem Benotzer", "Spielstände eines Benutzers", "A user’s saves"],
  "saves.search": ["Benotzernumm sichen…", "Benutzernamen suchen…", "Find a username…"],
  "saves.searchBtn": ["Sichen", "Suchen", "Search"],
  "saves.searchHint": ["Gëff op d'mannst een Buschtaf vum Benotzernumm an.", "Gib mindestens einen Buchstaben des Benutzernamens ein.", "Type at least one letter of the username."],
  "saves.noUsers": ["Kee Benotzer fonnt.", "Kein Benutzer gefunden.", "No user found."],
  "saves.games": ["{n} Spiller", "{n} Spiele", "{n} games"],
  "saves.games1": ["1 Spill", "1 Spiel", "1 game"],
  "saves.pickGame": ["Wielt e Spill", "Wähl ein Spiel", "Pick a game"],
  "saves.noGames": ["Dëse Benotzer huet keng Späicherstänn.", "Dieser Benutzer hat keine Spielstände.", "This user has no saves."],
  "saves.error": ["Daten konnten net gelueden ginn. Probéier et gleich nach eng Kéier.", "Daten konnten nicht geladen werden. Versuch es gleich nochmal.", "Couldn’t load the data. Try again shortly."],
  "saves.live": ["Aktuelle Späicherstand (Cloud)", "Aktueller Spielstand (Cloud)", "Current save (cloud)"],
  "saves.noLive": ["Keen aktuelle Cloud-Späicherstand, nëmmen de Verlaf.", "Kein aktueller Cloud-Spielstand, nur der Verlauf.", "No current cloud save, history only."],
  "saves.updated": ["Lescht Kéier gespäichert", "Zuletzt gespeichert", "Last saved"],
  "saves.presence": ["Online-Status", "Online-Status", "Online status"],
  "saves.presenceNone": ["Keng Aktivitéit gespäichert.", "Keine Aktivität gespeichert.", "No activity recorded."],
  "saves.presenceOn": ["op {page}, gesinn {ago}", "auf {page}, gesehen {ago}", "on {page}, seen {ago}"],
  "saves.onGame": ["um Spill", "im Spiel", "in the game"],
  "saves.history": ["Verlaf", "Verlauf", "History"],
  "saves.noHistory": ["Nach kee Verlaf fir dëst Spill.", "Noch kein Verlauf für dieses Spiel.", "No history for this game yet."],
  "saves.recorded": ["Gespäichert um", "Aufgezeichnet um", "Recorded at"],
  "saves.stateFrom": ["Stand vum", "Stand vom", "State from"],
  "saves.reason.rolling": ["automatesch", "automatisch", "automatic"],
  "saves.reason.drop": ["grousse Réckgang", "großer Rückgang", "big drop"],
  "saves.reason.before-restore": ["virum Restore", "vor Wiederherstellung", "before restore"],
  "saves.reason.before-gift": ["virum Kaddo", "vor Geschenk", "before gift"],
  "saves.vsLive": ["Géint live:", "Gegen live:", "Against live:"],
  "saves.sameAsLive": ["Gläich wéi de live Stand.", "Gleich wie der Live-Stand.", "Same as the live state."],
  "saves.noLiveToCompare": ["Kee live Stand zum Vergläichen.", "Kein Live-Stand zum Vergleichen.", "No live state to compare."],
  "saves.liveLower": ["live méi niddreg:", "live niedriger:", "live is lower:"],
  "saves.liveHigher": ["live méi héich:", "live höher:", "live is higher:"],
  "saves.raw": ["JSON weisen", "JSON anzeigen", "Show JSON"],
  "saves.restore": ["Restore", "Wiederherstellen", "Restore"],
  "saves.restoreTitle": ["Späicherstand zeréckspillen?", "Spielstand zurückspielen?", "Restore this save?"],
  "saves.restoreBody": ["{game} vu(n) {user}: Stand vum {when} ({summary}) gëtt de live Späicherstand. Dee leschten live Stand kënnt virdru als «virum Restore» an de Verlaf.",
    "{game} von {user}: Der Stand vom {when} ({summary}) wird zum Live-Spielstand. Der bisherige Live-Stand kommt vorher als „vor Wiederherstellung“ in den Verlauf.",
    "{game} of {user}: the state from {when} ({summary}) becomes the live save. The current live state goes to the history first as “before restore”."],
  "saves.caveat": ["Opgepasst: Wann dem Spiller säi Gerät d'Spill oppen huet oder eng méi nei lokal Kopie huet, kann et dëse Stand iwwerschreiwen. Maach säi Spill fir d'éischt zou.",
    "Achtung: Wenn das Gerät des Spielers das Spiel offen hat oder eine neuere lokale Kopie besitzt, kann es diesen Stand überschreiben. Schließ sein Spiel zuerst.",
    "Careful: if the player’s device has the game open or a newer local copy, it may overwrite this state. Close their game first."],
  "saves.closeFirst": ["Fir d'éischt säi Spill zoumaachen", "Zuerst sein Spiel schließen", "Close their game first"],
  "saves.restoreNow": ["Direkt zeréckspillen", "Jetzt zurückspielen", "Restore now"],
  "saves.giftNow": ["Direkt an de Späicherstand (Spill zou)", "Direkt in den Spielstand (Spiel zu)", "Write into the save now (game closed)"],
  "saves.stopWaiting": ["Waarden ofbriechen", "Warten abbrechen", "Stop waiting"],
  "saves.wait.start": ["Kommando «Spill zoumaachen» geschéckt. Mir waarden, bis de Spiller dru ass.", "Befehl „Spiel schließen“ gesendet. Wir warten auf den Spieler.", "“Close game” command sent. Waiting for the player."],
  "saves.wait.quiet": ["Spiller ass schonn aus dem Spill an de Späicherstand ass roueg.", "Spieler ist schon aus dem Spiel und der Spielstand ist ruhig.", "The player is already out of the game and the save is quiet."],
  "saves.wait.idle": ["Späicherstand roueg: {s} / {need} s", "Spielstand ruhig: {s} / {need} s", "Save idle: {s} / {need} s"],
  "saves.wait.onPage": ["Spiller ass nach um Spill", "Spieler ist noch im Spiel", "Player is still in the game"],
  "saves.wait.offPage": ["Spiller ass net méi um Spill", "Spieler ist nicht mehr im Spiel", "Player has left the game"],
  "saves.wait.timeout": ["Zäitiwwerschreidung: de Spiller ass nach um Spill. Näischt gouf geännert.", "Zeitüberschreitung: Der Spieler ist noch im Spiel. Nichts wurde geändert.", "Timed out: the player is still in the game. Nothing was changed."],
  "saves.wait.cancelled": ["Ofgebrach. Näischt gouf geännert.", "Abgebrochen. Nichts wurde geändert.", "Cancelled. Nothing was changed."],
  "saves.wait.cmdFail": ["De Kommando konnt net geschéckt ginn.", "Der Befehl konnte nicht gesendet werden.", "Couldn’t send the command."],
  "saves.restored": ["Restore gemaach ✓. De Spiller muss d'Spill nei opmaachen.", "Wiederherstellung erledigt ✓. Der Spieler muss das Spiel neu öffnen.", "Restore done ✓. The player has to reopen the game."],
  "saves.restoreFail": ["Restore ass feelgeschloen: {err}", "Wiederherstellung fehlgeschlagen: {err}", "Restore failed: {err}"],
  "saves.gift": ["Kaddo (Idle-Spiller)", "Geschenk (Idle-Spiele)", "Gift (idle games)"],
  "saves.giftAmount": ["Betrag ({what})", "Betrag ({what})", "Amount ({what})"],
  "saves.giftAmountHint": ["z. B. 5000, 2,5M, 3B oder 1e12 (K M B T Qa Qi Sx Sp Oc No)", "z. B. 5000, 2,5M, 3B oder 1e12 (K M B T Qa Qi Sx Sp Oc No)", "e.g. 5000, 2.5M, 3B or 1e12 (K M B T Qa Qi Sx Sp Oc No)"],
  "saves.giftBtn": ["🎁 Schenken", "🎁 Schenken", "🎁 Gift"],
  "saves.giftBad": ["Ongültege Betrag (méi wéi 0 a héchstens 1e30).", "Ungültiger Betrag (größer als 0 und höchstens 1e30).", "Invalid amount (more than 0 and at most 1e30)."],
  "saves.giftTitle": ["Kaddo schécken?", "Geschenk senden?", "Send this gift?"],
  "saves.giftBody": ["{user} kritt {amount} {what} am Spill {game}. D'Gesamtzuel ({lifetime}) klëmmt ëm ca. {bump}, esou datt d'Cloud-Kopie gewënnt. Dat zielt och fir de Leaderboard. De Stand vu virdrun kënnt als «virum Kaddo» an de Verlaf.",
    "{user} bekommt {amount} {what} im Spiel {game}. Die Gesamtzahl ({lifetime}) steigt um ca. {bump}, damit die Cloud-Kopie gewinnt. Das zählt auch fürs Leaderboard. Der bisherige Stand kommt als „vor Geschenk“ in den Verlauf.",
    "{user} gets {amount} {what} in {game}. The lifetime total ({lifetime}) rises by about {bump} so the cloud copy wins. That also counts for the leaderboard. The previous state goes to the history as “before gift”."],
  "saves.giftCaveat": ["Gëlt nëmmen, wann de Spiller säi Spill zou ass (≥ 90 s roueg). De Server kontrolléiert dat och. De Spiller soll d'Spill bannent ca. 10 Minutten nees opmaachen.", "Gilt nur, wenn das Spiel des Spielers zu ist (≥ 90 s ruhig). Der Server prüft das auch. Der Spieler soll das Spiel innerhalb von ca. 10 Minuten wieder öffnen.", "Only works while the player’s game is closed (idle for 90 s). The server checks that too. The player should reopen the game within about 10 minutes."],
  "saves.gifted": ["Kaddo geschéckt ✓: {what} {before} → {after}. De Spiller soll d'Spill nei opmaachen.", "Geschenk gesendet ✓: {what} {before} → {after}. Der Spieler soll das Spiel neu öffnen.", "Gift sent ✓: {what} {before} → {after}. The player should reopen the game."],
  "saves.giftFail": ["Kaddo ass feelgeschloen: {err}", "Geschenk fehlgeschlagen: {err}", "Gift failed: {err}"],
  /* live gifts: the game is open, the gift arrives within ~1 min */
  "saves.giftLive": ["⚡ Direkt schécken (live)", "⚡ Jetzt senden (live)", "⚡ Send now (live)"],
  "saves.giftLiveBody": ["{user} kritt {amount} {what} am Spill {game}, während d'Spill oppen ass. D'Gesamtzuel an de Leaderboard bleiwen onberéiert. Ass d'Spill grad net op, kënnt de Kaddo, soubal de Spiller et nees opmaacht.",
    "{user} bekommt {amount} {what} im Spiel {game}, während das Spiel offen ist. Gesamtzahl und Leaderboard bleiben unberührt. Ist das Spiel gerade nicht offen, kommt das Geschenk, sobald der Spieler es wieder öffnet.",
    "{user} gets {amount} {what} in {game} while the game is open. The lifetime total and the leaderboard are not touched. If the game isn’t open right now, the gift arrives as soon as the player opens it again."],
  "saves.giftAlt": ["Oder bei zouenem Spill: ", "Oder bei geschlossenem Spiel: ", "Or, for a closed game: "],
  "saves.live.waiting": ["Waart, bis d'Spill de Kaddo ofhëlt… (en oppent Spill hëlt en bannent ca. 1 Min. of)", "Warte, bis das Spiel das Geschenk abholt… (ein offenes Spiel holt es innerhalb von ca. 1 Min. ab)", "Waiting for the game to pick it up… (open game picks it up within ~1 min)"],
  "saves.live.claimed": ["D'Spill huet de Kaddo geholl, waart op d'Bestätegung…", "Das Spiel hat das Geschenk abgeholt, warte auf die Bestätigung…", "The game picked it up, waiting for confirmation…"],
  "saves.live.done": ["Geliwwert ✓ {amount} {what} sinn am Spill ukomm.", "Zugestellt ✓ {amount} {what} sind im Spiel angekommen.", "Delivered ✓ {amount} {what} arrived in the game."],
  "saves.live.timeout": ["Nach net ofgeholl. De Kaddo bleift ausstoend a kënnt, soubal de Spiller d'Spill d'nächst Kéier opmaacht.", "Noch nicht abgeholt. Das Geschenk bleibt offen und kommt, sobald der Spieler das Spiel das nächste Mal öffnet.", "Not picked up yet. The gift stays pending and arrives the next time the player opens the game."],
  "saves.live.stopped": ["Mam Waarden opgehalen. De Kaddo bleift ausstoend (an der Lëscht kann e ofgebrach ginn).", "Warten beendet. Das Geschenk bleibt offen (in der Liste lässt es sich abbrechen).", "Stopped waiting. The gift stays pending (it can be cancelled in the list)."],
  "saves.live.cancelled": ["De Kaddo gouf ofgebrach.", "Das Geschenk wurde abgebrochen.", "The gift was cancelled."],
  "saves.live.expired": ["De Kaddo ass ofgelaf.", "Das Geschenk ist abgelaufen.", "The gift expired."],
  "saves.gifts": ["Lescht Kaddoen", "Letzte Geschenke", "Recent gifts"],
  "saves.gifts.none": ["Nach keng Kaddoen.", "Noch keine Geschenke.", "No gifts yet."],
  "saves.gifts.unavailable": ["D'Kaddo-Lëscht ass net verfügbar.", "Die Geschenkliste ist nicht verfügbar.", "The gift list isn’t available."],
  "saves.gifts.cancel": ["Ofbriechen", "Abbrechen", "Cancel"],
  "saves.gifts.cancelFail": ["Ofbriechen ass feelgeschloen (schonn ofgeholl?): {err}", "Abbrechen fehlgeschlagen (schon abgeholt?): {err}", "Couldn’t cancel (already picked up?): {err}"],
  "saves.gstatus.pending": ["ausstoend", "ausstehend", "pending"],
  "saves.gstatus.claimed": ["ofgeholl", "abgeholt", "picked up"],
  "saves.gstatus.applied": ["geliwwert", "zugestellt", "delivered"],
  "saves.gstatus.cancelled": ["ofgebrach", "abgebrochen", "cancelled"],
  "saves.gstatus.expired": ["ofgelaf", "abgelaufen", "expired"],
  "saves.err.notIdle": ["De Späicherstand ass net roueg (d'Spill ass oppen?).", "Der Spielstand ist nicht ruhig (Spiel offen?).", "The save isn’t idle (game open?)."],
  "saves.err.onPage": ["De Spiller ass um Spill.", "Der Spieler ist im Spiel.", "The player is in the game."],

  /* game metrics */
  "m.cash": ["Cash", "Cash", "Cash"],
  "m.lifetime": ["Insgesamt", "Insgesamt", "Lifetime"],
  "m.investors": ["Investisseuren", "Investoren", "Investors"],
  "m.stars": ["Stären", "Sterne", "Stars"],
  "m.rebirths": ["Rebirths", "Rebirths", "Rebirths"],
  "m.owned": ["Besëtz (Total)", "Besitz (gesamt)", "Owned (total)"],
  "m.managers": ["Manager", "Manager", "Managers"],
  "m.baked": ["Gebak (insgesamt)", "Gebacken (insgesamt)", "Baked (total)"],
  "m.cookies": ["Cookien", "Cookies", "Cookies"],
  "m.clicks": ["Klicken", "Klicks", "Clicks"],
  "m.buildings": ["Gebaier (Total)", "Gebäude (gesamt)", "Buildings (total)"],
  "m.passengers": ["Passagéier", "Passagiere", "Passengers"],
  "m.drivers": ["Chauffeuren", "Fahrer", "Drivers"],
  "m.upgrades": ["Upgrades", "Upgrades", "Upgrades"],
  "m.items": ["{n} Elementer", "{n} Elemente", "{n} items"],
  "what.idle-empire": ["Cash", "Cash", "cash"],
  "what.cookie-clicker": ["Cookien", "Cookies", "cookies"],
  "what.bus-tycoon": ["Passagéier", "Passagiere", "passengers"],

  /* tracks, cups, weather */
  "t.villehaute": ["Uewerstad", "Oberstadt", "Upper Town"],
  "t.kirchberg": ["Kierchbierg", "Kirchberg", "Kirchberg"],
  "t.grund": ["Gronn & Corniche", "Grund & Corniche", "Grund & Corniche"],
  "t.belval": ["Esch-Belval", "Esch-Belval", "Esch-Belval"],
  "t.zockerland": ["Zockerland", "Zuckerland", "Candy Land"],
  "t.aisbierg": ["Äisbierg", "Eisberg", "Ice Mountain"],
  "t.vulkan": ["Feierbierg", "Feuerberg", "Fire Mountain"],
  "t.geeschterschlass": ["Geeschterschlass", "Geisterschloss", "Ghost Castle"],
  "cup.letzebuerg": ["Lëtzebuerg Cup", "Luxemburg-Cup", "Luxembourg Cup"],
  "cup.fantasy": ["Fantasy Cup", "Fantasy-Cup", "Fantasy Cup"],
  "w.day": ["Dag", "Tag", "Day"],
  "w.sunset": ["Sonnenënnergang", "Sonnenuntergang", "Sunset"],
  "w.night": ["Nuecht", "Nacht", "Night"],
  "w.rain": ["Reen", "Regen", "Rain"],
  "w.fog": ["Niwwel", "Nebel", "Fog"],
  "w.snow": ["Schnéi", "Schnee", "Snow"],
};

/* at("key", { n: 3 }); a missing key returns the key itself so it shows up in the UI. */
export function at(key, vars = {}) {
  const entry = TEXTS[key];
  if (!entry) return key;
  const text = entry[{ lb: 0, de: 1, en: 2 }[lang()]] || entry[2];
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/* id → label from the TEXTS table; an unknown id (a new track) is shown as it is */
export const label = (prefix, id) => (TEXTS[`${prefix}.${id}`] ? at(`${prefix}.${id}`) : String(id ?? "—"));

const LOCALES = { lb: "de-LU", de: "de-LU", en: "en-GB" };
const locale = () => LOCALES[lang()];

export function fmtDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" });
}

/* local calendar day as yyyy-mm-dd (what <input type="date"> uses) */
export function localDayKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ago(iso, nowMs = Date.now()) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return at("common.unknown");
  const seconds = Math.max(0, Math.round((nowMs - time) / 1000));
  if (seconds < 5) return at("ago.now");
  if (seconds < 90) return at("ago.s", { n: seconds });
  if (seconds < 90 * 60) return at("ago.m", { n: Math.round(seconds / 60) });
  if (seconds < 36 * 3600) return at("ago.h", { n: Math.round(seconds / 3600) });
  return at("ago.d", { n: Math.round(seconds / 86400) });
}

/* 83456 ms → 1:23.456 */
export function fmtRaceTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

const SUFFIXES = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
/* the games' own short scale (K M B T Qa …); beyond Dc plain exponent notation */
export function fmtNum(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 1000) return value.toLocaleString(locale(), { maximumFractionDigits: abs < 10 && !Number.isInteger(value) ? 2 : 0 });
  const tier = Math.floor(Math.log10(abs) / 3);
  if (tier > SUFFIXES.length) return value.toExponential(2).replace("e+", "e");
  const scaled = value / 1000 ** tier;
  return `${scaled.toLocaleString(locale(), { maximumFractionDigits: 2 })} ${SUFFIXES[tier - 1]}`;
}

/* "5000", "2,5M", "3 B", "1e12" → number or null. */
export function parseAmount(text) {
  const match = /^\s*([0-9]+(?:[.,][0-9]+)?(?:e[+-]?[0-9]+)?)\s*([a-z]{0,2})\s*$/i.exec(String(text ?? ""));
  if (!match) return null;
  const base = Number(match[1].replace(",", "."));
  const suffix = match[2].toLowerCase();
  let factor = 1;
  if (suffix) {
    const tier = SUFFIXES.findIndex((name) => name.toLowerCase() === suffix);
    if (tier < 0) return null;
    factor = 1000 ** (tier + 1);
  }
  const amount = base * factor;
  return Number.isFinite(amount) ? amount : null;
}
