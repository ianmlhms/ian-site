/* Texts. Luxembourgish first, then German, English and French (the same four languages as the other arcade games). `t(lang, key, params)` fills {name} placeholders.
 * The harness checks that every key exists in all four languages and that every placeholder of the Luxembourgish text is present in the others. */
export const LANGS = ['lb', 'de', 'en', 'fr'];
export const LANG_NAMES = Object.freeze({ lb: 'Lëtzebuergesch', de: 'Deutsch', en: 'English', fr: 'Français' });

const STR = {
  lb: {
    title: 'MTB Mëllerdall', loading: 'D\'Mëllerdall gëtt gelueden …', 'load.terrain': 'Terrain', 'load.hills': 'Hiwwelen', 'load.ways': 'Weeër', 'load.trails': 'Trailen', 'load.canopy': 'Bësch', 'load.classes': 'Land', 'load.build': 'Welt gëtt gebaut …',
    'load.done': 'Fäerdeg', 'load.slow': 'Dauert méi laang wéi gewinnt …', 'load.retry': 'Nei probéieren', 'load.error': 'D\'Spill konnt net gelueden ginn. Iwwerpréif d\'Verbindung.',
    'hud.speed': 'km/h', 'hud.trail': 'Trail', 'hint.pedal': 'Trëppelen', 'hint.steer': 'Lenken', 'hint.jump': 'Sprangen', 'hint.brake': 'Bremsen', 'hint.touch': 'Lénks lenken, riets trëppelen',
    'hint.keys': 'W / ↑ trëppelen · A D / ← → lenken · S / ↓ bremsen · Espace sprangen', 'hud.reset': 'R: zréck op de Wee',
    go: 'Lass!', start: 'Fueren', 'card.length': 'Längt', 'card.drop': 'Erof', 'card.best': 'Dëse Rekord', 'card.none': 'nach keen', 'card.medals': 'Medaillen', 'card.trails': 'Trailen', 'card.bike': 'Vëlo', 'card.ride': 'Fräi Fuerten',
    'card.daily': 'Dagesausfuerderung', 'card.ghost': 'Däi Geescht fiert mat', 'card.locked': 'Gespaart', 'card.unlockBy': 'Gewann eng Medaille um Trail „{trail}“',
    'medal.gold': 'Gold', 'medal.silver': 'Sëlwer', 'medal.bronze': 'Bronze', 'medal.none': 'keng Medaille',
    'hud.time': 'Zäit', 'hud.cp': 'Kontroll {n}/{total}', 'hud.lap': 'Zäit', 'hud.found': 'Aussiichtspunkten', 'hud.menu': 'Menü', 'hud.weather': 'Wieder', 'hud.timeOfDay': 'Dageszäit', 'hud.camera': 'Kamera', 'hud.sound': 'Toun', 'hud.retry': 'Nei', 'hud.fullscreen': 'Ganze Schierm',
    'hud.crash': 'Hoppla! Zréck op de Kontrollpunkt …', 'hud.rescue': 'Zréck um Wee', 'hud.missed': 'Kontrollpunkt {n} feelt: zréck dohin', 'finish.invalid': 'Dës Zäit zielt net (z\'séier fir de Wee)', 'hud.perfect': 'Perfekt Landung!', 'hud.good': 'Gutt Landung', 'hud.rough': 'Haart Landung', 'hud.pump': 'Pump!',
    'finish.title': 'Am Zil!', 'finish.time': 'Zäit', 'finish.best': 'Rekord', 'finish.newBest': 'Neie Rekord!', 'finish.medal': 'Medaille', 'finish.again': 'Nach eng Kéier', 'finish.next': 'Nächsten Trail', 'finish.menu': 'Menü', 'finish.fold': 'Kaart zouklappen', 'finish.crashes': 'Stürz', 'finish.top': 'Topgeschwindegkeet', 'finish.ghostWon': 'Däi Geescht geschloen!', 'finish.ghostLost': 'Däi Geescht war méi séier',
    'finish.nextMedal': 'Fir {medal}: {time}', 'finish.unlocked': 'Fräigeschalt: {what}',
    'menu.title': 'Menü', 'menu.trails': 'Trailen', 'menu.map': 'Kaart', 'menu.bikes': 'Vëloen', 'menu.settings': 'Astellungen', 'menu.help': 'Hëllef', 'menu.close': 'Zou', 'menu.resume': 'Weider', 'menu.restart': 'Trail nei starten',
    'menu.ride': 'Fräi Fuerten duerch d\'Mëllerdall', 'menu.rideInfo': 'Fann d\'Aussiichtspunkten', 'menu.daily': 'Dagesausfuerderung', 'menu.dailyInfo': '{trail} · {time} · {weather}', 'menu.dailyDone': 'Haut: {time}', 'menu.dailyBoard': 'Rangiliss',
    'bike.hardtail': 'Hardtail', 'bike.trail': 'Trail-Vëlo', 'bike.enduro': 'Enduro', 'bike.downhill': 'Downhill', 'bike.travel': 'Federweg', 'bike.weight': 'Gewiicht', 'bike.grip': 'Gripp', 'bike.climb': 'Bierg erop', 'bike.landing': 'Landungen', 'bike.unlockAt': 'Fräi mat {n} Medaillepunkten', 'bike.points': 'Medaillepunkten: {n}',
    'bike.hardtail.info': 'Liicht a séier bierg erop, haart op Wuerzelen.', 'bike.trail.info': 'Gutt fir alles. Dat richtegt Vëlo fir unzefänken.', 'bike.enduro.info': 'Méi Federweg, méi Gripp, schwéier bierg erop.', 'bike.downhill.info': 'Schléit alles ewech, awer schwéier a lues erop.',
    'set.time': 'Dageszäit', 'set.weather': 'Wieder', 'set.season': 'Joreszäit', 'set.quality': 'Qualitéit', 'set.language': 'Sprooch', 'set.sound': 'Toun', 'set.controls': 'Steierung', 'set.random': 'Zoufall', 'set.auto': 'Automatesch', 'set.on': 'un', 'set.off': 'aus',
    'time.dawn': 'Moies fréi', 'time.morning': 'Moien', 'time.noon': 'Mëttes', 'time.evening': 'Owes', 'time.dusk': 'Owendämmerung', 'time.night': 'Nuecht',
    'weather.clear': 'Klor', 'weather.cloudy': 'Bedeckt', 'weather.fog': 'Niwwel', 'weather.rain': 'Reen', 'season.summer': 'Summer', 'season.autumn': 'Hierscht', 'quality.low': 'Niddereg', 'quality.medium': 'Mëttel', 'quality.high': 'Héich',
    'set.note': 'Wieder a Dageszäit änneren d\'Aussiicht an d\'Gripp, ni d\'Medaillen oder d\'Punkten.',
    'help.keys': 'Tastatur', 'help.pedal': 'W / ↑  trëppelen', 'help.steer': 'A D / ← →  lenken', 'help.brake': 'S / ↓  bremsen (béid Brems) · Q hannen · E vir', 'help.jump': 'Espace  halen = duckelen, lassloossen = sprangen oder pumpen', 'help.other': 'R zréck um Wee · C Kamera · T Dageszäit · G Wieder · V Joreszäit · M Toun · Esc Menü',
    'help.touch': 'Touch', 'help.touch1': 'Lénks Daum: lenken. Riets: Pedal, Brems, Sprong.', 'help.tip1': 'Pump op Hiwwelen: halen iwwer dem Kamm, lassloossen am Dall.', 'help.tip2': 'Bremsen virun der Kéier, net dran. D\'Vir-Brems gräift stäerkst.', 'help.tip3': 'Reen mécht Fiels, Holz a Wuerzelen glat.',
    'unlock.trail': 'Neien Trail: {name}', 'unlock.bike': 'Neit Vëlo: {name}', 'unlock.colour': 'Nei Faarf', 'unlock.helmet': 'Neien Helm',
    'free.title': 'Fräi Fuerten', 'free.found': 'Aussiichtspunkt fonnt: {name}', 'free.count': '{n} vun {total} fonnt', 'free.all': 'All Aussiichtspunkten fonnt!', 'free.back': 'Zréck op den Trail',
    'vp.unnamed': 'Aussiichtspunkt', 'vp.falls': 'Schiessentümpel', 'vp.castle': 'Buerg Beefort', 'vp.village': 'Bäerdrefer Kierch', 'vp.hint': 'Roudi de Fuuss sëtzt op den Aussiichtspunkten',
    'daily.title': 'Dagesausfuerderung', 'daily.locked': 'Muss nach fräigeschalt ginn', 'daily.fair': 'Haut: {trail}, {weather}, {time}', 'daily.signin': 'Mell dech un, fir an d\'Rangiliss ze kommen', 'daily.sent': 'An d\'Rangiliss geschéckt',
    'save.local': 'Gespäichert op dësem Apparat', 'save.cloud': 'Cloud-Späichere mat dengem Kont',
    'ghost.name': 'Geescht', 'sound.on': 'Toun un', 'sound.off': 'Toun aus', 'fs.enter': 'Ganze Schierm', 'touch.pedal': 'Trëppelen', 'touch.brake': 'Bremsen', 'touch.jump': 'Sprangen', 'touch.steer': 'Lenken',
    'card.hintTitle': 'Esou fiers du:', 'card.kb': 'Tastatur', 'card.tc': 'Touch', 'card.tapToStart': 'Tipp op „Fueren“', 'trail.green': 'Gréng · einfach', 'trail.blue': 'Blo · mëttel', 'trail.red': 'Rout · schwéier', 'trail.black': 'Schwaarz · extrem',
    'grade.green': 'Gréng', 'grade.blue': 'Blo', 'grade.red': 'Rout', 'grade.black': 'Schwaarz', 'map.title': 'D\'Mëllerdall', 'map.pick': 'Wiel een Trail', 'toast.respawn': 'Zréck um Kontrollpunkt', 'toast.split': 'Kontroll {n}', 'orient.rotate': 'Dréi den iPad ze Quer fir besser Sicht',
    'tip.pump': 'Pump op de Hiwwelen!', 'tip.brake': 'Bremsen virun der Kéier!', 'tip.rain': 'Et ass rutscheg!', 'speed.limit': 'Uewergrenz', 'err.storage': 'Späicheren net méiglech', 'trail.length': '{km} km', 'trail.drop': '{m} m erof',
  },
  de: {
    title: 'MTB Mëllerdall', loading: 'Das Müllerthal wird geladen …', 'load.terrain': 'Gelände', 'load.hills': 'Hügel', 'load.ways': 'Wege', 'load.trails': 'Trails', 'load.canopy': 'Wald', 'load.classes': 'Land', 'load.build': 'Welt wird gebaut …',
    'load.done': 'Fertig', 'load.slow': 'Dauert länger als sonst …', 'load.retry': 'Nochmal versuchen', 'load.error': 'Das Spiel konnte nicht geladen werden. Prüfe die Verbindung.',
    'hud.speed': 'km/h', 'hud.trail': 'Trail', 'hint.pedal': 'Treten', 'hint.steer': 'Lenken', 'hint.jump': 'Springen', 'hint.brake': 'Bremsen', 'hint.touch': 'Links lenken, rechts treten',
    'hint.keys': 'W / ↑ treten · A D / ← → lenken · S / ↓ bremsen · Leertaste springen', 'hud.reset': 'R: zurück auf den Weg',
    go: 'Los!', start: 'Fahren', 'card.length': 'Länge', 'card.drop': 'Gefälle', 'card.best': 'Dein Rekord', 'card.none': 'noch keiner', 'card.medals': 'Medaillen', 'card.trails': 'Trails', 'card.bike': 'Rad', 'card.ride': 'Freie Fahrt',
    'card.daily': 'Tagesherausforderung', 'card.ghost': 'Dein Geist fährt mit', 'card.locked': 'Gesperrt', 'card.unlockBy': 'Gewinne eine Medaille auf dem Trail „{trail}“',
    'medal.gold': 'Gold', 'medal.silver': 'Silber', 'medal.bronze': 'Bronze', 'medal.none': 'keine Medaille',
    'hud.time': 'Zeit', 'hud.cp': 'Kontrolle {n}/{total}', 'hud.lap': 'Zeit', 'hud.found': 'Aussichtspunkte', 'hud.menu': 'Menü', 'hud.weather': 'Wetter', 'hud.timeOfDay': 'Tageszeit', 'hud.camera': 'Kamera', 'hud.sound': 'Ton', 'hud.retry': 'Neu', 'hud.fullscreen': 'Vollbild',
    'hud.crash': 'Hoppla! Zurück zum Kontrollpunkt …', 'hud.rescue': 'Zurück auf den Weg', 'hud.missed': 'Kontrollpunkt {n} fehlt: zurück dorthin', 'finish.invalid': 'Diese Zeit zählt nicht (zu schnell für den Weg)', 'hud.perfect': 'Perfekte Landung!', 'hud.good': 'Gute Landung', 'hud.rough': 'Harte Landung', 'hud.pump': 'Pump!',
    'finish.title': 'Im Ziel!', 'finish.time': 'Zeit', 'finish.best': 'Rekord', 'finish.newBest': 'Neuer Rekord!', 'finish.medal': 'Medaille', 'finish.again': 'Nochmal', 'finish.next': 'Nächster Trail', 'finish.menu': 'Menü', 'finish.fold': 'Karte einklappen', 'finish.crashes': 'Stürze', 'finish.top': 'Höchstgeschwindigkeit', 'finish.ghostWon': 'Du hast deinen Geist geschlagen!', 'finish.ghostLost': 'Dein Geist war schneller',
    'finish.nextMedal': 'Für {medal}: {time}', 'finish.unlocked': 'Freigeschaltet: {what}',
    'menu.title': 'Menü', 'menu.trails': 'Trails', 'menu.map': 'Karte', 'menu.bikes': 'Räder', 'menu.settings': 'Einstellungen', 'menu.help': 'Hilfe', 'menu.close': 'Schließen', 'menu.resume': 'Weiter', 'menu.restart': 'Trail neu starten',
    'menu.ride': 'Freie Fahrt durchs Müllerthal', 'menu.rideInfo': 'Finde die Aussichtspunkte', 'menu.daily': 'Tagesherausforderung', 'menu.dailyInfo': '{trail} · {time} · {weather}', 'menu.dailyDone': 'Heute: {time}', 'menu.dailyBoard': 'Rangliste',
    'bike.hardtail': 'Hardtail', 'bike.trail': 'Trailbike', 'bike.enduro': 'Enduro', 'bike.downhill': 'Downhill', 'bike.travel': 'Federweg', 'bike.weight': 'Gewicht', 'bike.grip': 'Grip', 'bike.climb': 'Bergauf', 'bike.landing': 'Landungen', 'bike.unlockAt': 'Frei mit {n} Medaillenpunkten', 'bike.points': 'Medaillenpunkte: {n}',
    'bike.hardtail.info': 'Leicht und schnell bergauf, hart auf Wurzeln.', 'bike.trail.info': 'Gut für alles. Das richtige Rad zum Anfangen.', 'bike.enduro.info': 'Mehr Federweg, mehr Grip, schwerer bergauf.', 'bike.downhill.info': 'Schluckt alles, ist aber schwer und langsam bergauf.',
    'set.time': 'Tageszeit', 'set.weather': 'Wetter', 'set.season': 'Jahreszeit', 'set.quality': 'Qualität', 'set.language': 'Sprache', 'set.sound': 'Ton', 'set.controls': 'Steuerung', 'set.random': 'Zufall', 'set.auto': 'Automatisch', 'set.on': 'an', 'set.off': 'aus',
    'time.dawn': 'Früher Morgen', 'time.morning': 'Morgen', 'time.noon': 'Mittag', 'time.evening': 'Abend', 'time.dusk': 'Dämmerung', 'time.night': 'Nacht',
    'weather.clear': 'Klar', 'weather.cloudy': 'Bewölkt', 'weather.fog': 'Nebel', 'weather.rain': 'Regen', 'season.summer': 'Sommer', 'season.autumn': 'Herbst', 'quality.low': 'Niedrig', 'quality.medium': 'Mittel', 'quality.high': 'Hoch',
    'set.note': 'Wetter und Tageszeit ändern Aussicht und Grip, nie die Medaillen oder Punkte.',
    'help.keys': 'Tastatur', 'help.pedal': 'W / ↑  treten', 'help.steer': 'A D / ← →  lenken', 'help.brake': 'S / ↓  bremsen (beide Bremsen) · Q hinten · E vorn', 'help.jump': 'Leertaste  halten = in die Hocke, loslassen = springen oder pumpen', 'help.other': 'R zurück auf den Weg · C Kamera · T Tageszeit · G Wetter · V Jahreszeit · M Ton · Esc Menü',
    'help.touch': 'Touch', 'help.touch1': 'Linker Daumen: lenken. Rechts: Pedal, Bremse, Sprung.', 'help.tip1': 'Pumpe auf Hügeln: über der Kuppe halten, im Tal loslassen.', 'help.tip2': 'Bremse vor der Kurve, nicht mittendrin. Die Vorderbremse greift am stärksten.', 'help.tip3': 'Regen macht Fels, Holz und Wurzeln glatt.',
    'unlock.trail': 'Neuer Trail: {name}', 'unlock.bike': 'Neues Rad: {name}', 'unlock.colour': 'Neue Farbe', 'unlock.helmet': 'Neuer Helm',
    'free.title': 'Freie Fahrt', 'free.found': 'Aussichtspunkt gefunden: {name}', 'free.count': '{n} von {total} gefunden', 'free.all': 'Alle Aussichtspunkte gefunden!', 'free.back': 'Zurück zum Trail',
    'vp.unnamed': 'Aussichtspunkt', 'vp.falls': 'Schiessentümpel', 'vp.castle': 'Burg Beaufort', 'vp.village': 'Kirche Berdorf', 'vp.hint': 'Roudi der Fuchs sitzt an den Aussichtspunkten',
    'daily.title': 'Tagesherausforderung', 'daily.locked': 'Muss noch freigeschaltet werden', 'daily.fair': 'Heute: {trail}, {weather}, {time}', 'daily.signin': 'Melde dich an, um in die Rangliste zu kommen', 'daily.sent': 'In die Rangliste geschickt',
    'save.local': 'Auf diesem Gerät gespeichert', 'save.cloud': 'Cloud-Speicher mit deinem Konto',
    'ghost.name': 'Geist', 'sound.on': 'Ton an', 'sound.off': 'Ton aus', 'fs.enter': 'Vollbild', 'touch.pedal': 'Treten', 'touch.brake': 'Bremsen', 'touch.jump': 'Springen', 'touch.steer': 'Lenken',
    'card.hintTitle': 'So fährst du:', 'card.kb': 'Tastatur', 'card.tc': 'Touch', 'card.tapToStart': 'Tippe auf „Fahren“', 'trail.green': 'Grün · leicht', 'trail.blue': 'Blau · mittel', 'trail.red': 'Rot · schwer', 'trail.black': 'Schwarz · extrem',
    'grade.green': 'Grün', 'grade.blue': 'Blau', 'grade.red': 'Rot', 'grade.black': 'Schwarz', 'map.title': 'Das Müllerthal', 'map.pick': 'Wähle einen Trail', 'toast.respawn': 'Zurück am Kontrollpunkt', 'toast.split': 'Kontrolle {n}', 'orient.rotate': 'Drehe das iPad quer für bessere Sicht',
    'tip.pump': 'Pumpe auf den Hügeln!', 'tip.brake': 'Bremse vor der Kurve!', 'tip.rain': 'Es ist rutschig!', 'speed.limit': 'Höchstgrenze', 'err.storage': 'Speichern nicht möglich', 'trail.length': '{km} km', 'trail.drop': '{m} m bergab',
  },
  en: {
    title: 'MTB Mëllerdall', loading: 'Loading the Mullerthal …', 'load.terrain': 'Terrain', 'load.hills': 'Hills', 'load.ways': 'Paths', 'load.trails': 'Trails', 'load.canopy': 'Forest', 'load.classes': 'Land', 'load.build': 'Building the world …',
    'load.done': 'Done', 'load.slow': 'Taking longer than usual …', 'load.retry': 'Try again', 'load.error': 'The game could not be loaded. Check your connection.',
    'hud.speed': 'km/h', 'hud.trail': 'Trail', 'hint.pedal': 'Pedal', 'hint.steer': 'Steer', 'hint.jump': 'Jump', 'hint.brake': 'Brake', 'hint.touch': 'Steer on the left, pedal on the right',
    'hint.keys': 'W / ↑ pedal · A D / ← → steer · S / ↓ brake · Space jump', 'hud.reset': 'R: back to the trail',
    go: 'Go!', start: 'Ride', 'card.length': 'Length', 'card.drop': 'Descent', 'card.best': 'Your best', 'card.none': 'none yet', 'card.medals': 'Medals', 'card.trails': 'Trails', 'card.bike': 'Bike', 'card.ride': 'Free ride',
    'card.daily': 'Daily challenge', 'card.ghost': 'Your ghost rides along', 'card.locked': 'Locked', 'card.unlockBy': 'Win a medal on the trail “{trail}”',
    'medal.gold': 'Gold', 'medal.silver': 'Silver', 'medal.bronze': 'Bronze', 'medal.none': 'no medal',
    'hud.time': 'Time', 'hud.cp': 'Checkpoint {n}/{total}', 'hud.lap': 'Time', 'hud.found': 'Viewpoints', 'hud.menu': 'Menu', 'hud.weather': 'Weather', 'hud.timeOfDay': 'Time of day', 'hud.camera': 'Camera', 'hud.sound': 'Sound', 'hud.retry': 'Retry', 'hud.fullscreen': 'Fullscreen',
    'hud.crash': 'Oops! Back to the checkpoint …', 'hud.rescue': 'Back on the trail', 'hud.missed': 'Checkpoint {n} missed: back to it', 'finish.invalid': 'This time does not count (too fast for the trail)', 'hud.perfect': 'Perfect landing!', 'hud.good': 'Good landing', 'hud.rough': 'Rough landing', 'hud.pump': 'Pump!',
    'finish.title': 'Finished!', 'finish.time': 'Time', 'finish.best': 'Best', 'finish.newBest': 'New best!', 'finish.medal': 'Medal', 'finish.again': 'Again', 'finish.next': 'Next trail', 'finish.menu': 'Menu', 'finish.fold': 'Fold the card', 'finish.crashes': 'Crashes', 'finish.top': 'Top speed', 'finish.ghostWon': 'You beat your ghost!', 'finish.ghostLost': 'Your ghost was faster',
    'finish.nextMedal': 'For {medal}: {time}', 'finish.unlocked': 'Unlocked: {what}',
    'menu.title': 'Menu', 'menu.trails': 'Trails', 'menu.map': 'Map', 'menu.bikes': 'Bikes', 'menu.settings': 'Settings', 'menu.help': 'Help', 'menu.close': 'Close', 'menu.resume': 'Resume', 'menu.restart': 'Restart trail',
    'menu.ride': 'Free ride through the Mullerthal', 'menu.rideInfo': 'Find the viewpoints', 'menu.daily': 'Daily challenge', 'menu.dailyInfo': '{trail} · {time} · {weather}', 'menu.dailyDone': 'Today: {time}', 'menu.dailyBoard': 'Leaderboard',
    'bike.hardtail': 'Hardtail', 'bike.trail': 'Trail bike', 'bike.enduro': 'Enduro', 'bike.downhill': 'Downhill', 'bike.travel': 'Travel', 'bike.weight': 'Weight', 'bike.grip': 'Grip', 'bike.climb': 'Climbing', 'bike.landing': 'Landings', 'bike.unlockAt': 'Unlocks at {n} medal points', 'bike.points': 'Medal points: {n}',
    'bike.hardtail.info': 'Light and quick uphill, harsh on roots.', 'bike.trail.info': 'Good at everything. The right bike to start.', 'bike.enduro.info': 'More travel, more grip, heavier uphill.', 'bike.downhill.info': 'Eats everything, but heavy and slow uphill.',
    'set.time': 'Time of day', 'set.weather': 'Weather', 'set.season': 'Season', 'set.quality': 'Quality', 'set.language': 'Language', 'set.sound': 'Sound', 'set.controls': 'Controls', 'set.random': 'Random', 'set.auto': 'Automatic', 'set.on': 'on', 'set.off': 'off',
    'time.dawn': 'Early morning', 'time.morning': 'Morning', 'time.noon': 'Noon', 'time.evening': 'Evening', 'time.dusk': 'Dusk', 'time.night': 'Night',
    'weather.clear': 'Clear', 'weather.cloudy': 'Cloudy', 'weather.fog': 'Fog', 'weather.rain': 'Rain', 'season.summer': 'Summer', 'season.autumn': 'Autumn', 'quality.low': 'Low', 'quality.medium': 'Medium', 'quality.high': 'High',
    'set.note': 'Weather and time of day change the view and the grip, never the medals or the scores.',
    'help.keys': 'Keyboard', 'help.pedal': 'W / ↑  pedal', 'help.steer': 'A D / ← →  steer', 'help.brake': 'S / ↓  brake (both brakes) · Q rear · E front', 'help.jump': 'Space  hold = crouch, release = jump or pump', 'help.other': 'R back on the trail · C camera · T time of day · G weather · V season · M sound · Esc menu',
    'help.touch': 'Touch', 'help.touch1': 'Left thumb: steer. Right: pedal, brake, jump.', 'help.tip1': 'Pump the rollers: hold over the crest, release in the dip.', 'help.tip2': 'Brake before the corner, not in it. The front brake bites hardest.', 'help.tip3': 'Rain makes rock, wood and roots slippery.',
    'unlock.trail': 'New trail: {name}', 'unlock.bike': 'New bike: {name}', 'unlock.colour': 'New colour', 'unlock.helmet': 'New helmet',
    'free.title': 'Free ride', 'free.found': 'Viewpoint found: {name}', 'free.count': '{n} of {total} found', 'free.all': 'All viewpoints found!', 'free.back': 'Back to the trail',
    'vp.unnamed': 'Viewpoint', 'vp.falls': 'Schiessentümpel', 'vp.castle': 'Beaufort Castle', 'vp.village': 'Berdorf Church', 'vp.hint': 'Roudi the fox sits at the viewpoints',
    'daily.title': 'Daily challenge', 'daily.locked': 'Not unlocked yet', 'daily.fair': 'Today: {trail}, {weather}, {time}', 'daily.signin': 'Sign in to join the leaderboard', 'daily.sent': 'Sent to the leaderboard',
    'save.local': 'Saved on this device', 'save.cloud': 'Cloud save with your account',
    'ghost.name': 'Ghost', 'sound.on': 'Sound on', 'sound.off': 'Sound off', 'fs.enter': 'Fullscreen', 'touch.pedal': 'Pedal', 'touch.brake': 'Brake', 'touch.jump': 'Jump', 'touch.steer': 'Steer',
    'card.hintTitle': 'How to ride:', 'card.kb': 'Keyboard', 'card.tc': 'Touch', 'card.tapToStart': 'Tap “Ride”', 'trail.green': 'Green · easy', 'trail.blue': 'Blue · medium', 'trail.red': 'Red · hard', 'trail.black': 'Black · extreme',
    'grade.green': 'Green', 'grade.blue': 'Blue', 'grade.red': 'Red', 'grade.black': 'Black', 'map.title': 'The Mullerthal', 'map.pick': 'Pick a trail', 'toast.respawn': 'Back at the checkpoint', 'toast.split': 'Checkpoint {n}', 'orient.rotate': 'Turn the iPad sideways for a better view',
    'tip.pump': 'Pump the rollers!', 'tip.brake': 'Brake before the corner!', 'tip.rain': 'It is slippery!', 'speed.limit': 'Limit', 'err.storage': 'Saving is not possible', 'trail.length': '{km} km', 'trail.drop': '{m} m down',
  },
  fr: {
    title: 'MTB Mëllerdall', loading: 'Chargement du Mullerthal …', 'load.terrain': 'Terrain', 'load.hills': 'Collines', 'load.ways': 'Chemins', 'load.trails': 'Pistes', 'load.canopy': 'Forêt', 'load.classes': 'Sols', 'load.build': 'Construction du monde …',
    'load.done': 'Prêt', 'load.slow': 'Plus long que d\'habitude …', 'load.retry': 'Réessayer', 'load.error': 'Le jeu n\'a pas pu être chargé. Vérifie la connexion.',
    'hud.speed': 'km/h', 'hud.trail': 'Piste', 'hint.pedal': 'Pédaler', 'hint.steer': 'Diriger', 'hint.jump': 'Sauter', 'hint.brake': 'Freiner', 'hint.touch': 'Diriger à gauche, pédaler à droite',
    'hint.keys': 'W / ↑ pédaler · A D / ← → diriger · S / ↓ freiner · Espace sauter', 'hud.reset': 'R : retour sur la piste',
    go: 'Partez !', start: 'Rouler', 'card.length': 'Longueur', 'card.drop': 'Descente', 'card.best': 'Ton record', 'card.none': 'pas encore', 'card.medals': 'Médailles', 'card.trails': 'Pistes', 'card.bike': 'Vélo', 'card.ride': 'Balade libre',
    'card.daily': 'Défi du jour', 'card.ghost': 'Ton fantôme roule avec toi', 'card.locked': 'Verrouillée', 'card.unlockBy': 'Gagne une médaille sur la piste « {trail} »',
    'medal.gold': 'Or', 'medal.silver': 'Argent', 'medal.bronze': 'Bronze', 'medal.none': 'pas de médaille',
    'hud.time': 'Temps', 'hud.cp': 'Contrôle {n}/{total}', 'hud.lap': 'Temps', 'hud.found': 'Points de vue', 'hud.menu': 'Menu', 'hud.weather': 'Météo', 'hud.timeOfDay': 'Moment', 'hud.camera': 'Caméra', 'hud.sound': 'Son', 'hud.retry': 'Encore', 'hud.fullscreen': 'Plein écran',
    'hud.crash': 'Oups ! Retour au contrôle …', 'hud.rescue': 'Retour sur la piste', 'hud.missed': 'Contrôle {n} manqué : retour', 'finish.invalid': 'Ce temps ne compte pas (trop rapide pour la piste)', 'hud.perfect': 'Atterrissage parfait !', 'hud.good': 'Bon atterrissage', 'hud.rough': 'Atterrissage dur', 'hud.pump': 'Pump !',
    'finish.title': 'Arrivée !', 'finish.time': 'Temps', 'finish.best': 'Record', 'finish.newBest': 'Nouveau record !', 'finish.medal': 'Médaille', 'finish.again': 'Encore une fois', 'finish.next': 'Piste suivante', 'finish.menu': 'Menu', 'finish.fold': 'Replier la carte', 'finish.crashes': 'Chutes', 'finish.top': 'Vitesse max', 'finish.ghostWon': 'Tu as battu ton fantôme !', 'finish.ghostLost': 'Ton fantôme était plus rapide',
    'finish.nextMedal': 'Pour {medal} : {time}', 'finish.unlocked': 'Débloqué : {what}',
    'menu.title': 'Menu', 'menu.trails': 'Pistes', 'menu.map': 'Carte', 'menu.bikes': 'Vélos', 'menu.settings': 'Réglages', 'menu.help': 'Aide', 'menu.close': 'Fermer', 'menu.resume': 'Reprendre', 'menu.restart': 'Recommencer la piste',
    'menu.ride': 'Balade libre dans le Mullerthal', 'menu.rideInfo': 'Trouve les points de vue', 'menu.daily': 'Défi du jour', 'menu.dailyInfo': '{trail} · {time} · {weather}', 'menu.dailyDone': 'Aujourd\'hui : {time}', 'menu.dailyBoard': 'Classement',
    'bike.hardtail': 'Semi-rigide', 'bike.trail': 'Vélo trail', 'bike.enduro': 'Enduro', 'bike.downhill': 'Descente', 'bike.travel': 'Débattement', 'bike.weight': 'Poids', 'bike.grip': 'Adhérence', 'bike.climb': 'Montée', 'bike.landing': 'Réceptions', 'bike.unlockAt': 'Débloqué à {n} points de médaille', 'bike.points': 'Points de médaille : {n}',
    'bike.hardtail.info': 'Léger et vif en montée, dur sur les racines.', 'bike.trail.info': 'Bon partout. Le bon vélo pour débuter.', 'bike.enduro.info': 'Plus de débattement, plus d\'adhérence, plus lourd en montée.', 'bike.downhill.info': 'Avale tout, mais lourd et lent en montée.',
    'set.time': 'Moment du jour', 'set.weather': 'Météo', 'set.season': 'Saison', 'set.quality': 'Qualité', 'set.language': 'Langue', 'set.sound': 'Son', 'set.controls': 'Commandes', 'set.random': 'Au hasard', 'set.auto': 'Automatique', 'set.on': 'oui', 'set.off': 'non',
    'time.dawn': 'Petit matin', 'time.morning': 'Matin', 'time.noon': 'Midi', 'time.evening': 'Soir', 'time.dusk': 'Crépuscule', 'time.night': 'Nuit',
    'weather.clear': 'Dégagé', 'weather.cloudy': 'Nuageux', 'weather.fog': 'Brouillard', 'weather.rain': 'Pluie', 'season.summer': 'Été', 'season.autumn': 'Automne', 'quality.low': 'Basse', 'quality.medium': 'Moyenne', 'quality.high': 'Haute',
    'set.note': 'La météo et le moment du jour changent la vue et l\'adhérence, jamais les médailles ni les scores.',
    'help.keys': 'Clavier', 'help.pedal': 'W / ↑  pédaler', 'help.steer': 'A D / ← →  diriger', 'help.brake': 'S / ↓  freiner (les deux freins) · Q arrière · E avant', 'help.jump': 'Espace  maintenir = s\'accroupir, relâcher = sauter ou pomper', 'help.other': 'R retour sur la piste · C caméra · T moment · G météo · V saison · M son · Échap menu',
    'help.touch': 'Tactile', 'help.touch1': 'Pouce gauche : diriger. Droite : pédale, frein, saut.', 'help.tip1': 'Pompe les bosses : maintiens sur la crête, relâche dans le creux.', 'help.tip2': 'Freine avant le virage, pas dedans. Le frein avant mord le plus.', 'help.tip3': 'La pluie rend roche, bois et racines glissants.',
    'unlock.trail': 'Nouvelle piste : {name}', 'unlock.bike': 'Nouveau vélo : {name}', 'unlock.colour': 'Nouvelle couleur', 'unlock.helmet': 'Nouveau casque',
    'free.title': 'Balade libre', 'free.found': 'Point de vue trouvé : {name}', 'free.count': '{n} sur {total} trouvés', 'free.all': 'Tous les points de vue trouvés !', 'free.back': 'Retour sur la piste',
    'vp.unnamed': 'Point de vue', 'vp.falls': 'Schiessentümpel', 'vp.castle': 'Château de Beaufort', 'vp.village': 'Église de Berdorf', 'vp.hint': 'Roudi le renard est assis aux points de vue',
    'daily.title': 'Défi du jour', 'daily.locked': 'Pas encore débloqué', 'daily.fair': 'Aujourd\'hui : {trail}, {weather}, {time}', 'daily.signin': 'Connecte-toi pour rejoindre le classement', 'daily.sent': 'Envoyé au classement',
    'save.local': 'Enregistré sur cet appareil', 'save.cloud': 'Sauvegarde cloud avec ton compte',
    'ghost.name': 'Fantôme', 'sound.on': 'Son activé', 'sound.off': 'Son coupé', 'fs.enter': 'Plein écran', 'touch.pedal': 'Pédaler', 'touch.brake': 'Freiner', 'touch.jump': 'Sauter', 'touch.steer': 'Diriger',
    'card.hintTitle': 'Comment rouler :', 'card.kb': 'Clavier', 'card.tc': 'Tactile', 'card.tapToStart': 'Touche « Rouler »', 'trail.green': 'Verte · facile', 'trail.blue': 'Bleue · moyenne', 'trail.red': 'Rouge · difficile', 'trail.black': 'Noire · extrême',
    'grade.green': 'Verte', 'grade.blue': 'Bleue', 'grade.red': 'Rouge', 'grade.black': 'Noire', 'map.title': 'Le Mullerthal', 'map.pick': 'Choisis une piste', 'toast.respawn': 'De retour au contrôle', 'toast.split': 'Contrôle {n}', 'orient.rotate': 'Tourne l\'iPad en mode paysage pour mieux voir',
    'tip.pump': 'Pompe les bosses !', 'tip.brake': 'Freine avant le virage !', 'tip.rain': 'C\'est glissant !', 'speed.limit': 'Limite', 'err.storage': 'Sauvegarde impossible', 'trail.length': '{km} km', 'trail.drop': '{m} m de descente',
  },
};

/** Text for `key` in `lang` (falls back to English, then to the key itself); {name} placeholders are replaced from `params`. */
export function t(lang, key, params) {
  const raw = (STR[lang] && STR[lang][key]) || STR.en[key] || key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined ? m : String(params[name])));
}

/** All keys of one language (the harness compares the four). */
export const keysOf = (lang) => Object.keys(STR[lang] || {});
export const placeholders = (lang, key) => ((STR[lang] && STR[lang][key]) || '').match(/\{\w+\}/g) || [];

/** Name of a trail in the player's language (the baked trails carry lb / de / en / fr). */
export function trailName(trail, lang) {
  return (trail.name && (trail.name[lang] || trail.name.en)) || trail.id;
}
export function trailBlurb(trail, lang) {
  return (trail.blurb && (trail.blurb[lang] || trail.blurb.en)) || '';
}

/** m:ss.t (tenths) for the HUD and the cards; the finish screen shows milliseconds. */
export function formatTime(ms, precise = false) {
  if (!Number.isFinite(ms) || ms < 0) return '–:––';
  const total = Math.floor(ms / 1000), m = Math.floor(total / 60), s = total % 60;
  const frac = precise ? `.${String(Math.floor(ms % 1000)).padStart(3, '0')}` : `.${Math.floor((ms % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, '0')}${frac}`;
}
export function formatSplit(deltaMs) {
  const sign = deltaMs <= 0 ? '−' : '+';
  const a = Math.abs(deltaMs) / 1000;
  return `${sign}${a.toFixed(1)}`;
}
