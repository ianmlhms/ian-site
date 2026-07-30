/* Partyspill — content banks. Pure data, no logic.
 *
 * Every entry is {lb, de, en}. Luxembourgish first: this is built for Ian's
 * class. Content is deliberately school-appropriate (13+, no alcohol, nothing
 * that singles a person out nastily) — it is meant to be playable in a
 * classroom or on a bus, not a drinking game.
 *
 * All banks are plain arrays, so adding more is just appending lines.
 */
window.PS_CONTENT = {

  /* ---- Secret-word games: Impostor, Guess What, Buzzer ---- */
  words: [
    { cat: { lb: "Uecht", de: "Orte", en: "Places" }, items: [
      { lb: "Schoul", de: "Schule", en: "School" },
      { lb: "Schwämm", de: "Schwimmbad", en: "Swimming pool" },
      { lb: "Fluchhafen", de: "Flughafen", en: "Airport" },
      { lb: "Kino", de: "Kino", en: "Cinema" },
      { lb: "Supermarché", de: "Supermarkt", en: "Supermarket" },
      { lb: "Bibliothéik", de: "Bibliothek", en: "Library" },
      { lb: "Bushaltestell", de: "Bushaltestelle", en: "Bus stop" },
      { lb: "Zänndokter", de: "Zahnarzt", en: "Dentist" },
      { lb: "Fussballstadion", de: "Fußballstadion", en: "Football stadium" },
      { lb: "Bäckerei", de: "Bäckerei", en: "Bakery" },
    ]},
    { cat: { lb: "Iessen", de: "Essen", en: "Food" }, items: [
      { lb: "Pizza", de: "Pizza", en: "Pizza" },
      { lb: "Gromperekichelcher", de: "Kartoffelpuffer", en: "Potato fritters" },
      { lb: "Spaghetti", de: "Spaghetti", en: "Spaghetti" },
      { lb: "Zapp", de: "Suppe", en: "Soup" },
      { lb: "Schockela", de: "Schokolade", en: "Chocolate" },
      { lb: "Äppel", de: "Apfel", en: "Apple" },
      { lb: "Kéis", de: "Käse", en: "Cheese" },
      { lb: "Glace", de: "Eis", en: "Ice cream" },
      { lb: "Bulli", de: "Brötchen", en: "Bread roll" },
      { lb: "Popcorn", de: "Popcorn", en: "Popcorn" },
    ]},
    { cat: { lb: "Déieren", de: "Tiere", en: "Animals" }, items: [
      { lb: "Pinguin", de: "Pinguin", en: "Penguin" },
      { lb: "Elefant", de: "Elefant", en: "Elephant" },
      { lb: "Kaz", de: "Katze", en: "Cat" },
      { lb: "Päerd", de: "Pferd", en: "Horse" },
      { lb: "Delfin", de: "Delfin", en: "Dolphin" },
      { lb: "Spann", de: "Spinne", en: "Spider" },
      { lb: "Adler", de: "Adler", en: "Eagle" },
      { lb: "Fuuss", de: "Fuchs", en: "Fox" },
      { lb: "Schlaang", de: "Schlange", en: "Snake" },
      { lb: "Igel", de: "Igel", en: "Hedgehog" },
    ]},
    { cat: { lb: "Saachen", de: "Gegenstände", en: "Objects" }, items: [
      { lb: "Handy", de: "Handy", en: "Phone" },
      { lb: "Parapli", de: "Regenschirm", en: "Umbrella" },
      { lb: "Zännbierst", de: "Zahnbürste", en: "Toothbrush" },
      { lb: "Schlëssel", de: "Schlüssel", en: "Key" },
      { lb: "Kopfhörer", de: "Kopfhörer", en: "Headphones" },
      { lb: "Spigel", de: "Spiegel", en: "Mirror" },
      { lb: "Rucksak", de: "Rucksack", en: "Backpack" },
      { lb: "Bic", de: "Kugelschreiber", en: "Pen" },
      { lb: "Kaddo", de: "Geschenk", en: "Present" },
      { lb: "Wecker", de: "Wecker", en: "Alarm clock" },
    ]},
    { cat: { lb: "Sport", de: "Sport", en: "Sport" }, items: [
      { lb: "Fussball", de: "Fußball", en: "Football" },
      { lb: "Basket", de: "Basketball", en: "Basketball" },
      { lb: "Schwammen", de: "Schwimmen", en: "Swimming" },
      { lb: "Tennis", de: "Tennis", en: "Tennis" },
      { lb: "Vëlo fueren", de: "Radfahren", en: "Cycling" },
      { lb: "Karting", de: "Kartfahren", en: "Karting" },
      { lb: "Danzen", de: "Tanzen", en: "Dancing" },
      { lb: "Klammen", de: "Klettern", en: "Climbing" },
      { lb: "Ski fueren", de: "Skifahren", en: "Skiing" },
      { lb: "Lafen", de: "Laufen", en: "Running" },
    ]},
    { cat: { lb: "Lëtzebuerg", de: "Luxemburg", en: "Luxembourg" }, items: [
      { lb: "Adolphe-Bréck", de: "Adolphe-Brücke", en: "Adolphe Bridge" },
      { lb: "Schueberfouer", de: "Schueberfouer", en: "Schueberfouer" },
      { lb: "Vianden", de: "Vianden", en: "Vianden" },
      { lb: "Mullerthal", de: "Müllerthal", en: "Mullerthal" },
      { lb: "Gratis Bus", de: "Gratis Bus", en: "Free bus" },
      { lb: "Groussherzog", de: "Großherzog", en: "Grand Duke" },
      { lb: "Kirchbierg", de: "Kirchberg", en: "Kirchberg" },
      { lb: "Nationalfeierdag", de: "Nationalfeiertag", en: "National Day" },
    ]},
  ],

  /* ---- Categories for Bomb + Word Rush ---- */
  categories: [
    { lb: "En Auto", de: "Ein Automarke", en: "A car brand" },
    { lb: "E Land an Europa", de: "Ein Land in Europa", en: "A country in Europe" },
    { lb: "Eng Uebstzort", de: "Eine Obstsorte", en: "A kind of fruit" },
    { lb: "E Beruff", de: "Ein Beruf", en: "A job" },
    { lb: "Eppes am Klassesall", de: "Etwas im Klassenzimmer", en: "Something in a classroom" },
    { lb: "En Déier mat véier Been", de: "Ein Tier mit vier Beinen", en: "An animal with four legs" },
    { lb: "Eng Faarf", de: "Eine Farbe", en: "A colour" },
    { lb: "E Film", de: "Ein Film", en: "A film" },
    { lb: "Eppes wat fléien kann", de: "Etwas das fliegen kann", en: "Something that can fly" },
    { lb: "En Numm mat A", de: "Ein Name mit A", en: "A name starting with A" },
    { lb: "Eng Uucht zu Lëtzebuerg", de: "Ein Ort in Luxemburg", en: "A place in Luxembourg" },
    { lb: "Eppes am Frigo", de: "Etwas im Kühlschrank", en: "Something in a fridge" },
    { lb: "E Sport", de: "Eine Sportart", en: "A sport" },
    { lb: "Eng App um Handy", de: "Eine App auf dem Handy", en: "An app on your phone" },
    { lb: "Eppes wat wéi deet", de: "Etwas das wehtut", en: "Something that hurts" },
    { lb: "E Schoulfach", de: "Ein Schulfach", en: "A school subject" },
    { lb: "Eppes Waarmes", de: "Etwas Warmes", en: "Something warm" },
    { lb: "En Instrument", de: "Ein Instrument", en: "An instrument" },
  ],

  /* ---- Prompt games ---- */
  mostLikely: [
    { lb: "… kënnt am spéitsten an d'Schoul", de: "… kommt am spätesten zur Schule", en: "… is most likely to be late for school" },
    { lb: "… gëtt berühmt", de: "… wird berühmt", en: "… will become famous" },
    { lb: "… vergësst säin Handy doheem", de: "… vergisst sein Handy zu Hause", en: "… forgets their phone at home" },
    { lb: "… laacht am éischten", de: "… lacht als Erstes", en: "… laughs first" },
    { lb: "… géif sech op enger Wanderung verlafen", de: "… würde sich beim Wandern verlaufen", en: "… would get lost on a hike" },
    { lb: "… schléift am längsten", de: "… schläft am längsten", en: "… sleeps the longest" },
    { lb: "… gëtt Millionär", de: "… wird Millionär", en: "… becomes a millionaire" },
    { lb: "… iesst déi ganz Pizza eleng", de: "… isst die ganze Pizza allein", en: "… eats a whole pizza alone" },
    { lb: "… hëlleft engem Frënd ëmmer direkt", de: "… hilft einem Freund sofort", en: "… always helps a friend instantly" },
    { lb: "… ka guer net stillschweigen", de: "… kann nicht still sein", en: "… can never stay quiet" },
    { lb: "… gëtt Proff", de: "… wird Lehrer", en: "… becomes a teacher" },
    { lb: "… gewënnt e Quiz", de: "… gewinnt ein Quiz", en: "… wins a quiz" },
  ],

  wouldYouRather: [
    { lb: "Ëmmer ze spéit oder ëmmer eng Stonn ze fréi?", de: "Immer zu spät oder immer eine Stunde zu früh?", en: "Always late, or always an hour early?" },
    { lb: "Fléien kënnen oder onsiichtbar sinn?", de: "Fliegen können oder unsichtbar sein?", en: "Be able to fly, or be invisible?" },
    { lb: "Ni méi Wifi oder ni méi waarmt Waasser?", de: "Nie mehr WLAN oder nie mehr warmes Wasser?", en: "Never have wifi again, or never have hot water?" },
    { lb: "Ëmmer d'Wourecht soen oder ni méi schwätzen?", de: "Immer die Wahrheit sagen oder nie mehr sprechen?", en: "Always tell the truth, or never speak again?" },
    { lb: "An der Vergaangenheet oder an der Zukunft liewen?", de: "In der Vergangenheit oder in der Zukunft leben?", en: "Live in the past or the future?" },
    { lb: "Nëmme Pizza oder nëmme Glace iessen?", de: "Nur Pizza oder nur Eis essen?", en: "Only eat pizza, or only eat ice cream?" },
    { lb: "All Sprooch schwätzen oder all Instrument spillen?", de: "Jede Sprache sprechen oder jedes Instrument spielen?", en: "Speak every language, or play every instrument?" },
    { lb: "Ëmmer Summer oder ëmmer Wanter?", de: "Immer Sommer oder immer Winter?", en: "Always summer, or always winter?" },
    { lb: "Gedanke liese kënnen oder an d'Zukunft kucken?", de: "Gedanken lesen oder in die Zukunft sehen?", en: "Read minds, or see the future?" },
    { lb: "Ni méi Hausaufgaben oder ni méi Tester?", de: "Nie mehr Hausaufgaben oder nie mehr Tests?", en: "Never homework again, or never tests again?" },
  ],

  neverHave: [
    { lb: "… am Bus schlofen ageschlof", de: "… im Bus eingeschlafen", en: "… fallen asleep on the bus" },
    { lb: "… en Test vergiess", de: "… einen Test vergessen", en: "… forgotten about a test" },
    { lb: "… mech an der Schoul verlaf", de: "… mich in der Schule verlaufen", en: "… got lost in my own school" },
    { lb: "… engem Proff \"Mamm\" gesot", de: "… einem Lehrer \"Mama\" gesagt", en: "… called a teacher \"mum\"" },
    { lb: "… e ganze Film verschlof", de: "… einen ganzen Film verschlafen", en: "… slept through an entire film" },
    { lb: "… géint eng Glasdier gelaf", de: "… gegen eine Glastür gelaufen", en: "… walked into a glass door" },
    { lb: "… d'Hausaufgabe vun engem anere kopéiert", de: "… Hausaufgaben abgeschrieben", en: "… copied someone's homework" },
    { lb: "… mäin eegene Gebuertsdag vergiess", de: "… meinen eigenen Geburtstag vergessen", en: "… forgotten my own birthday" },
    { lb: "… e ganzen Dag am Pyjama bliwwen", de: "… den ganzen Tag im Pyjama geblieben", en: "… stayed in pyjamas all day" },
    { lb: "… engem gewénkt deen net gemengt war", de: "… jemandem gewunken der nicht gemeint war", en: "… waved at someone who wasn't waving at me" },
  ],

  paranoia: [
    { lb: "Wien hei laacht am meeschten?", de: "Wer hier lacht am meisten?", en: "Who here laughs the most?" },
    { lb: "Wien géif een Trip komplett vergiessen ze plangen?", de: "Wer würde vergessen eine Reise zu planen?", en: "Who would forget to plan a trip entirely?" },
    { lb: "Wien ass am beschten am Erklären?", de: "Wer erklärt am besten?", en: "Who explains things best?" },
    { lb: "Wien hätt d'beschte Chance an enger Quizshow?", de: "Wer hätte die besten Chancen in einer Quizshow?", en: "Who'd do best on a quiz show?" },
    { lb: "Wien ass am meeschten op sengem Handy?", de: "Wer ist am meisten am Handy?", en: "Who is on their phone the most?" },
    { lb: "Wien géif als éischten hëllefen?", de: "Wer würde als Erster helfen?", en: "Who would help first?" },
    { lb: "Wien huet déi bescht Iddien?", de: "Wer hat die besten Ideen?", en: "Who has the best ideas?" },
    { lb: "Wien kann am beschten kachen?", de: "Wer kann am besten kochen?", en: "Who is the best cook?" },
    { lb: "Wien bleift am rouegsten?", de: "Wer bleibt am ruhigsten?", en: "Who stays calmest?" },
    { lb: "Wien erzielt déi bescht Geschichten?", de: "Wer erzählt die besten Geschichten?", en: "Who tells the best stories?" },
  ],

  storyStarters: [
    { lb: "Et war eng Kéier en Hond deen…", de: "Es war einmal ein Hund der…", en: "Once there was a dog that…" },
    { lb: "Mëttes an der Schoul ass op eemol…", de: "Mittags in der Schule passierte plötzlich…", en: "At lunchtime in school, suddenly…" },
    { lb: "De Bus ass net stoe bliwwen, well…", de: "Der Bus hielt nicht an, weil…", en: "The bus didn't stop, because…" },
    { lb: "Ech hunn eng Dier opgemaach an dohannert war…", de: "Ich öffnete eine Tür und dahinter war…", en: "I opened a door and behind it was…" },
    { lb: "Den éischten Dag um Mars huet ugefaang mat…", de: "Der erste Tag auf dem Mars begann mit…", en: "The first day on Mars began with…" },
    { lb: "Keen huet gemierkt datt d'Kaz…", de: "Niemand merkte dass die Katze…", en: "Nobody noticed that the cat…" },
  ],

  /* ---- Circa: numeric estimation ---- */
  circa: [
    { q: { lb: "Wéi vill Awunner huet Lëtzebuerg ongeféier?", de: "Wie viele Einwohner hat Luxemburg ungefähr?", en: "Roughly how many people live in Luxembourg?" }, a: 670000 },
    { q: { lb: "Wéi laang ass den Adolphe-Bréck a Meter?", de: "Wie lang ist die Adolphe-Brücke in Metern?", en: "How long is the Adolphe Bridge, in metres?" }, a: 153 },
    { q: { lb: "Wéi vill Schlësselen huet e Piano?", de: "Wie viele Tasten hat ein Klavier?", en: "How many keys does a piano have?" }, a: 88 },
    { q: { lb: "Wéi vill Been huet eng Spann?", de: "Wie viele Beine hat eine Spinne?", en: "How many legs does a spider have?" }, a: 8 },
    { q: { lb: "Wéi vill Kilometer ass de Mound vun der Äerd ewech (Dausend km)?", de: "Wie weit ist der Mond entfernt (Tausend km)?", en: "How far away is the Moon (thousand km)?" }, a: 384 },
    { q: { lb: "Wéi vill Grad huet e Krees?", de: "Wie viele Grad hat ein Kreis?", en: "How many degrees in a circle?" }, a: 360 },
    { q: { lb: "Wéi vill Kanton huet Lëtzebuerg?", de: "Wie viele Kantone hat Luxemburg?", en: "How many cantons does Luxembourg have?" }, a: 12 },
    { q: { lb: "Wéi vill Sekonnen huet en Dag (Dausend)?", de: "Wie viele Sekunden hat ein Tag (Tausend)?", en: "How many seconds in a day (thousands)?" }, a: 86 },
    { q: { lb: "Wéi héich ass den Eiffelturm a Meter?", de: "Wie hoch ist der Eiffelturm in Metern?", en: "How tall is the Eiffel Tower, in metres?" }, a: 330 },
    { q: { lb: "Wéi vill Spiller stinn beim Fussball pro Equipe um Terrain?", de: "Wie viele Spieler pro Team stehen beim Fußball auf dem Feld?", en: "How many football players per team are on the pitch?" }, a: 11 },
  ],

  /* ---- Taboo: describe without the banned words ---- */
  taboo: [
    { word: { lb: "Schoulbus", de: "Schulbus", en: "School bus" }, ban: [
      { lb: "Schoul", de: "Schule", en: "School" }, { lb: "Bus", de: "Bus", en: "Bus" },
      { lb: "giel", de: "gelb", en: "yellow" }, { lb: "fueren", de: "fahren", en: "drive" }] },
    { word: { lb: "Pizza", de: "Pizza", en: "Pizza" }, ban: [
      { lb: "Kéis", de: "Käse", en: "Cheese" }, { lb: "Italien", de: "Italien", en: "Italy" },
      { lb: "ronn", de: "rund", en: "round" }, { lb: "Uewen", de: "Ofen", en: "Oven" }] },
    { word: { lb: "Handy", de: "Handy", en: "Phone" }, ban: [
      { lb: "uruffen", de: "anrufen", en: "call" }, { lb: "App", de: "App", en: "App" },
      { lb: "Ecran", de: "Bildschirm", en: "Screen" }, { lb: "SMS", de: "SMS", en: "Text" }] },
    { word: { lb: "Vëlo", de: "Fahrrad", en: "Bicycle" }, ban: [
      { lb: "Rad", de: "Rad", en: "Wheel" }, { lb: "trëppelen", de: "treten", en: "pedal" },
      { lb: "fueren", de: "fahren", en: "ride" }, { lb: "Kette", de: "Kette", en: "Chain" }] },
    { word: { lb: "Wanterschnéi", de: "Schnee", en: "Snow" }, ban: [
      { lb: "wäiss", de: "weiß", en: "white" }, { lb: "kal", de: "kalt", en: "cold" },
      { lb: "Wanter", de: "Winter", en: "Winter" }, { lb: "Äis", de: "Eis", en: "Ice" }] },
    { word: { lb: "Proff", de: "Lehrer", en: "Teacher" }, ban: [
      { lb: "Schoul", de: "Schule", en: "School" }, { lb: "Klass", de: "Klasse", en: "Class" },
      { lb: "léieren", de: "lernen", en: "learn" }, { lb: "Tafel", de: "Tafel", en: "Board" }] },
    { word: { lb: "Fussball", de: "Fußball", en: "Football" }, ban: [
      { lb: "Ball", de: "Ball", en: "Ball" }, { lb: "Goal", de: "Tor", en: "Goal" },
      { lb: "Equipe", de: "Mannschaft", en: "Team" }, { lb: "Fouss", de: "Fuß", en: "Foot" }] },
    { word: { lb: "Glace", de: "Eis", en: "Ice cream" }, ban: [
      { lb: "kal", de: "kalt", en: "cold" }, { lb: "Summer", de: "Sommer", en: "Summer" },
      { lb: "séiss", de: "süß", en: "sweet" }, { lb: "Kugel", de: "Kugel", en: "Scoop" }] },
  ],

  /* ---- Spektrum: two opposites, hit the hidden point ---- */
  spectrum: [
    { a: { lb: "kal", de: "kalt", en: "cold" }, b: { lb: "waarm", de: "warm", en: "hot" } },
    { a: { lb: "langweileg", de: "langweilig", en: "boring" }, b: { lb: "spannend", de: "spannend", en: "exciting" } },
    { a: { lb: "bëlleg", de: "billig", en: "cheap" }, b: { lb: "deier", de: "teuer", en: "expensive" } },
    { a: { lb: "einfach", de: "einfach", en: "easy" }, b: { lb: "schwéier", de: "schwer", en: "hard" } },
    { a: { lb: "roueg", de: "ruhig", en: "quiet" }, b: { lb: "haart", de: "laut", en: "loud" } },
    { a: { lb: "ongesond", de: "ungesund", en: "unhealthy" }, b: { lb: "gesond", de: "gesund", en: "healthy" } },
    { a: { lb: "al", de: "alt", en: "old" }, b: { lb: "modern", de: "modern", en: "modern" } },
    { a: { lb: "nëtzlech", de: "nützlich", en: "useful" }, b: { lb: "onnëtz", de: "nutzlos", en: "useless" } },
  ],

  /* ---- Quiz: 4 options, index of the correct one ---- */
  quiz: [
    { q: { lb: "Wat ass d'Haaptstad vu Lëtzebuerg?", de: "Was ist die Hauptstadt von Luxemburg?", en: "What is the capital of Luxembourg?" },
      o: [{ lb: "Esch", de: "Esch", en: "Esch" }, { lb: "Lëtzebuerg-Stad", de: "Luxemburg-Stadt", en: "Luxembourg City" },
          { lb: "Diekirch", de: "Diekirch", en: "Diekirch" }, { lb: "Wolz", de: "Wiltz", en: "Wiltz" }], c: 1 },
    { q: { lb: "Wéi vill Säiten huet en Sechseck?", de: "Wie viele Seiten hat ein Sechseck?", en: "How many sides does a hexagon have?" },
      o: [{ lb: "5", de: "5", en: "5" }, { lb: "6", de: "6", en: "6" }, { lb: "7", de: "7", en: "7" }, { lb: "8", de: "8", en: "8" }], c: 1 },
    { q: { lb: "Wéi ee Planéit ass de rouden?", de: "Welcher Planet ist der rote?", en: "Which planet is the red one?" },
      o: [{ lb: "Venus", de: "Venus", en: "Venus" }, { lb: "Mars", de: "Mars", en: "Mars" },
          { lb: "Jupiter", de: "Jupiter", en: "Jupiter" }, { lb: "Saturn", de: "Saturn", en: "Saturn" }], c: 1 },
    { q: { lb: "Wéi vill Faarwen huet de Reebou traditionell?", de: "Wie viele Farben hat ein Regenbogen traditionell?", en: "How many colours does a rainbow traditionally have?" },
      o: [{ lb: "5", de: "5", en: "5" }, { lb: "6", de: "6", en: "6" }, { lb: "7", de: "7", en: "7" }, { lb: "9", de: "9", en: "9" }], c: 2 },
    { q: { lb: "Wéi ee Land grenzt NET u Lëtzebuerg?", de: "Welches Land grenzt NICHT an Luxemburg?", en: "Which country does NOT border Luxembourg?" },
      o: [{ lb: "Belsch", de: "Belgien", en: "Belgium" }, { lb: "Frankräich", de: "Frankreich", en: "France" },
          { lb: "Holland", de: "Niederlande", en: "Netherlands" }, { lb: "Däitschland", de: "Deutschland", en: "Germany" }], c: 2 },
    { q: { lb: "Wéi vill Minutten huet e Fussballmatch (ouni Verlängerung)?", de: "Wie viele Minuten hat ein Fußballspiel (ohne Verlängerung)?", en: "How many minutes in a football match (no extra time)?" },
      o: [{ lb: "60", de: "60", en: "60" }, { lb: "80", de: "80", en: "80" }, { lb: "90", de: "90", en: "90" }, { lb: "120", de: "120", en: "120" }], c: 2 },
    { q: { lb: "Wat ass H₂O?", de: "Was ist H₂O?", en: "What is H₂O?" },
      o: [{ lb: "Salz", de: "Salz", en: "Salt" }, { lb: "Waasser", de: "Wasser", en: "Water" },
          { lb: "Zocker", de: "Zucker", en: "Sugar" }, { lb: "Loft", de: "Luft", en: "Air" }], c: 1 },
    { q: { lb: "Wéi vill Kontinenter ginn et?", de: "Wie viele Kontinente gibt es?", en: "How many continents are there?" },
      o: [{ lb: "5", de: "5", en: "5" }, { lb: "6", de: "6", en: "6" }, { lb: "7", de: "7", en: "7" }, { lb: "8", de: "8", en: "8" }], c: 2 },
  ],
};
