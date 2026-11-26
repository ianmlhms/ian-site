/* arcade-catalogue.js — the ONE list of arcade games (25 Nov 2026).
 *
 * Used by pixelbreak.html (the arcade hub) and by the home page (home-games.js), so a new game shows up in both.
 * Plain <script> (no module): it must be there before the pages draw their tiles. Bump its ?v= in BOTH pages (and in the flows' list
 * in HANDOFF.md) when it changes.
 *
 * ADD A GAME: one line in GAMES (with a `group`), its texts in DESC_I18N, the picture pb/thumbs/<id>.webp (640 x 400), then
 * `python3 scripts/make_small_thumbs.py` for the small one. check_site.py complains when one of these is missing.
 *
 *   id      arcade id (?g=<id>, scores, saves, picture)      name / short   full name / name on a small tile (no emoji)
 *   group   the one home section it belongs to (GROUPS)      cats           search genres of the hub ("webcam" has its own chip)
 *   src     opens inside the hub (pixelbreak.html?g=<id>)    go             its own page
 *   href    online game, its own page; the hub shows its room dialog first. Also in mp-games.js
 *   app     its url in apps-catalog.js, when it has one
 *   desc    English text, DESC_I18N has lb + de
 *
 * The entries are not frozen on purpose: scripts/flows/train_sim.mjs changes one (careerLock). */
(function () {
  "use strict";

/* Sections, in page order. `drive` … `online` are the groups of the games; the home page puts the most played ones first ("top"). */
var GROUPS=Object.freeze([
{id:"drive",label:"games.g.drive"},
{id:"build",label:"games.g.build"},
{id:"action",label:"games.g.action"},
{id:"puzzle",label:"games.g.puzzle"},
{id:"duo",label:"games.g.duo"},
{id:"online",label:"games.g.online"}
].map(Object.freeze));

var GAMES=[
{id:"park",name:"Schueberfouer Tycoon",emoji:"🎡",short:"Schueberfouer",group:"build",thumb:"pb/thumbs/park.webp",desc:"Run the Schueberfouer on the Glacis — rent pitches, build rides and stalls, walk through your fair and join the real fair days with the Hämmelsmarsch and fireworks",cats:["sim","creative"],tags:[],src:"pb/fouer.html"},
{id:"mtb",name:"MTB Mëllerdall",emoji:"🚵",group:"drive",thumb:"pb/thumbs/mtb.webp",desc:"Mountain biking through the real Mullerthal in 3D: six trails from green to black with medals, a ghost of your best run, free ride to find the viewpoints, a daily challenge and four bikes",cats:["driving","action"],tags:[],src:"pb/mtb.html"},
{id:"ski",name:"Ski Alpen",emoji:"⛷️",group:"drive",thumb:"pb/thumbs/ski.webp",lowerIsBetter:true,desc:"Ski the real pistes of 10 real ski areas in 3D: Espace Killy, Les 3 Vallées, Zermatt–Cervinia, Ski Arlberg, Kronplatz, Via Lattea, Obertauern, Livigno, Davos Klosters and Laax. Free ride with the real lifts, challenges against the clock, a snowpark with tricks and online with friends",cats:["driving","action"],tags:[],src:"pb/ski.html"},
{id:"lux-drive",name:"Lux Drive",emoji:"🚗",group:"drive",thumb:"pb/thumbs/lux-drive.webp",desc:"Free driving through Luxembourg City and Niederanven in 3D: real roads, bridges and tunnels, rain or sunshine, day or night, with a map to jump to any street",cats:["driving"],tags:[],src:"pb/lux-drive.html"},
{id:"geometrydash",name:"Geometry Dash",emoji:"🟧",group:"action",thumb:"pb/thumbs/geometrydash.webp",desc:"Rhythm auto-runner with 15 levels — jump spikes, gaps and orbs, flip gravity, fly a ship, all to the beat",cats:["action"],tags:[],go:"geometrydash.html"},
{id:"drive-mad",name:"Stunt-Foerer",emoji:"🚗",group:"drive",thumb:"pb/thumbs/drive-mad.webp",desc:"3D stunt driving — 24 levels of see-saws, hammers and crushers",cats:["action","driving"],tags:[],src:"pb/drive-mad.html"},
{id:"paket-express",name:"Paket Express",emoji:"📦",group:"drive",thumb:"pb/thumbs/paket-express.webp",desc:"Deliver parcels through a Luxembourg town — timed shifts, free driving and three unlockable vehicles",cats:["sim"],tags:[],src:"pb/paket-express.html"},
{id:"kart-letzebuerg",name:"Kart Lëtzebuerg",emoji:"🏎️",group:"drive",thumb:"pb/thumbs/kart-letzebuerg.webp",desc:"Kart racing through Luxembourg City, Kirchberg, Grund and Belval plus a fantasy cup of candy land, ice mountain, volcano and haunted castle — jumps, shortcuts, items, Grand Prix cups, time trial against your ghost, and online races for up to 8",cats:["driving","action"],tags:["mp"],src:"pb/kart-letzebuerg.html"},
{id:"train-sim",name:"Zuchsimulator Lëtzebuerg",emoji:"🚆",short:"Zuchsimulator",group:"drive",thumb:"pb/thumbs/train-sim.webp",desc:"Drive Luxembourg's trains from the cab: stop at the platform, obey signals and speed limits, earn € and upgrade your trains",cats:["sim"],tags:[],src:"pb/train-sim.html",careerLock:"rail"},
{id:"tram-sim",name:"Tramsimulator Lëtzebuerg",emoji:"🚊",short:"Tramsimulator",group:"drive",thumb:"pb/thumbs/tram-sim.webp",desc:"Drive the real Luxtram T1 through Luxembourg City from the cab: stop at every tram stop, watch traffic and signals, earn € and upgrade the tram",cats:["sim"],tags:[],src:"pb/train-sim.html",saveAs:"train-sim",careerLock:"tram"},
{id:"chill-drive",pad:true,name:"3D Cruiser",emoji:"🛣️",group:"drive",thumb:"pb/thumbs/chill-drive.webp",desc:"True 3D cruising — 3 endless worlds + 20 levels",cats:["driving"],tags:[],src:"pb/chill-drive.html"},
{id:"cookie-clicker",name:"Cookie Clicker",emoji:"🍪",group:"build",thumb:"pb/thumbs/cookie-clicker.webp",desc:"Build a cookie empire — 24 production tiers up to Cookie Infinity, click upgrades and rebirth",cats:["idle"],tags:[],src:"pb/cookie-clicker.html"},
{id:"crossy-road",pad:true,name:"Stross iwwerquéieren",emoji:"🐔",group:"action",thumb:"pb/thumbs/crossy-road.webp",desc:"20 levels + endless — dodge cars, trains and rivers",cats:["action"],tags:[],src:"pb/crossy-road.html"},
{id:"burger",name:"Burger-Restaurant",emoji:"🍔",group:"build",thumb:"pb/thumbs/burger.webp",desc:"Cook, serve and upgrade your burger restaurant",cats:["sim"],tags:[],src:"pb/burger.html"},
{id:"towerdefense",name:"Tower Defense",emoji:"🏰",group:"build",thumb:"pb/thumbs/towerdefense.webp",desc:"Build towers, command a hero, survive 15 levels of waves",cats:["action"],tags:[],src:"pb/towerdefense.html"},
{id:"idle-empire",name:"Business Empire",emoji:"💰",group:"build",thumb:"pb/thumbs/idle-empire.webp",desc:"Business tycoon idle game — 18 businesses from Lemonade Stand to Galactic Exchange, managers, milestones, prestige",cats:["idle"],tags:[],src:"pb/idle-empire.html"},
{id:"bus-tycoon",name:"Bus Tycoon 🚌",emoji:"🚌",short:"Bus Tycoon",group:"build",thumb:"pb/thumbs/bus-tycoon.webp",desc:"Build Luxembourg’s transport network — welcome passengers, open lines and rebirth for stars",cats:["idle"],tags:[],src:"pb/bus-tycoon.html"},
{id:"tictactoe",name:"Dräi an enger Rei",emoji:"❌",group:"duo",thumb:"pb/thumbs/tictactoe.webp",noScore:true,desc:"Three in a row — play the computer (Easy, Medium, Impossible) or a friend on the same screen",cats:["puzzle","2player"],tags:["mp"],src:"pb/tictactoe.html"},
{id:"pong",pad:true,name:"Pong",emoji:"🏓",group:"duo",thumb:"pb/thumbs/pong.webp",desc:"Neon pong — 2 players, vs AI, or online on two iPads",cats:["2player"],tags:["mp"],src:"pb/pong.html"},
{id:"o-connect4",name:"Véier gewënnt",emoji:"🔴",group:"online",thumb:"pb/thumbs/o-connect4.webp",noScore:true,desc:"Drop discs, connect four — online on two iPads or vs AI",cats:["online","puzzle"],tags:["mp"],href:"connect4.html",ai:true},
{id:"tank-wars",pad:true,name:"Panzerschluechten",emoji:"💥",short:"Panzer\u00adschluechten",group:"duo",thumb:"pb/thumbs/tank-wars.webp",desc:"Tank battles — 2 players, vs AI, or online on two iPads",cats:["2player","action"],tags:["mp"],src:"pb/tank-wars.html"},
{id:"fighters",pad:true,name:"Plattform-Kämpfer",emoji:"🥊",group:"duo",thumb:"pb/thumbs/fighters.webp",desc:"Platform fighting — 2 players, vs AI, or online on two iPads",cats:["2player","action"],tags:["mp"],src:"pb/fighters.html"},
{id:"o-battleship",name:"Schëffer versenken",emoji:"🚢",group:"online",thumb:"pb/thumbs/o-battleship.webp",noScore:true,desc:"Sink the fleet — online on two iPads or vs AI",cats:["online"],tags:["mp"],href:"battleship.html",ai:true},
{id:"o-dots",name:"Punkten a Këschten",emoji:"🟦",group:"online",thumb:"pb/thumbs/o-dots.webp",noScore:true,desc:"Claim the boxes — online on two iPads or vs AI",cats:["online","puzzle"],tags:["mp"],href:"dots.html",ai:true},
{id:"o-color",name:"Faarf roden",emoji:"🎨",group:"online",thumb:"pb/thumbs/o-color.webp",noScore:true,desc:"Guess the colour together — online or vs AI",cats:["online"],tags:["mp"],href:"color.html",ai:true},
{id:"o-draw",name:"Zeechnen a roden",emoji:"✏️",group:"online",thumb:"pb/thumbs/o-draw.webp",noScore:true,desc:"Draw and guess with a friend — online on two iPads",cats:["online","creative"],tags:["mp"],href:"draw.html"},
{id:"o-intro",name:"Lidd roden",emoji:"🎵",group:"online",thumb:"pb/thumbs/o-intro.webp",noScore:true,desc:"Guess the song from 1 second — then 3, then 5…",cats:["online"],tags:["mp"],href:"intro.html"},
{id:"o-meme",name:"Meme-Party",emoji:"😂",group:"online",thumb:"pb/thumbs/o-meme.webp",noScore:true,desc:"Caption the same meme, vote for the funniest — 3+ players",cats:["online","creative"],tags:["mp"],href:"meme.html"},
{id:"o-checkers",name:"Dammspill",emoji:"🟠",group:"online",thumb:"pb/thumbs/o-checkers.webp",noScore:true,desc:"Jump, chain captures, crown kings — online on two iPads or vs AI",cats:["online","puzzle"],tags:["mp"],href:"checkers.html",ai:true},
{id:"o-dice-duel",name:"Kniffel",emoji:"🎲",group:"online",thumb:"pb/thumbs/o-dice-duel.webp",noScore:true,desc:"Roll, hold and score — online or vs AI",cats:["online"],tags:["mp"],href:"dice-duel.html",ai:true},
{id:"o-slf",name:"Stadt-Land-Fluss",emoji:"🔤",group:"online",thumb:"pb/thumbs/o-slf.webp",noScore:true,desc:"Name a city, country and river for each letter — 2+ players join the same code",cats:["online"],tags:["mp"],href:"slf.html"},
{id:"o-roulette",name:"Roulette",emoji:"🎰",group:"online",thumb:"pb/thumbs/o-roulette.webp",noScore:true,desc:"European roulette with play chips — everybody bets at the same table, 2–8 players or alone",cats:["online"],tags:["mp"],href:"roulette.html",ai:true},
{id:"o-blackjack",name:"Blackjack",emoji:"♠️",group:"online",thumb:"pb/thumbs/o-blackjack.webp",noScore:true,desc:"Blackjack with play chips — up to 7 friends at one table against the dealer, or alone",cats:["online"],tags:["mp"],href:"blackjack.html",ai:true},
{id:"air-hockey",pad:true,name:"Air Hockey",emoji:"🥅",group:"duo",thumb:"pb/thumbs/air-hockey.webp",desc:"Air hockey — 2 players, vs AI, or online on two iPads",cats:["2player"],tags:["mp"],src:"pb/air-hockey.html"},
{id:"webcam",name:"Kamera-Arcade",emoji:"📷",group:"action",thumb:"pb/thumbs/webcam.webp",desc:"Six mini-games you play with your hands and body through the webcam: pop balloons, rock-paper-scissors, strike a pose to fit through the wall, jump and duck, two-hand Pong and drawing in the air. Your video never leaves your device",cats:["action","webcam"],tags:[],go:"pb/webcam.html"},
{id:"flappy",name:"Flappy Bird",emoji:"🐤",group:"action",thumb:"pb/thumbs/flappy.webp",desc:"Tap to fly through pipes",cats:["action"],tags:[],src:"pb/flappy.html"},
{id:"typing",name:"Tipp-Test",emoji:"⌨️",group:"puzzle",thumb:"pb/thumbs/typing.webp",desc:"Test how many words you can type per minute",cats:["action"],tags:[],src:"pb/typing.html"},
{id:"doodle-jump",pad:true,name:"Plattform-Sprénger",emoji:"🐸",group:"action",thumb:"pb/thumbs/doodle-jump.webp",desc:"Jump upward from platform to platform",cats:["action"],tags:[],src:"pb/doodle-jump.html"},
{id:"color-clash",name:"Colour Word Match",emoji:"🎨",group:"puzzle",thumb:"pb/thumbs/color-clash.webp",desc:"Match colour words against the clock",cats:["puzzle"],tags:[],src:"pb/color-clash.html"},
{id:"whack-a-mole",name:"Whack-a-Mole",emoji:"🐹",group:"action",thumb:"pb/thumbs/whack-a-mole.webp",desc:"Whack moles for points!",cats:["action"],tags:[],src:"pb/whack-a-mole.html"},
{id:"run-3",pad:true,name:"Space Tunnel Runner",emoji:"🚀",short:"Space Tunnel",group:"action",thumb:"pb/thumbs/run-3.webp",desc:"Run through a rotating space tunnel",cats:["action"],tags:[],src:"pb/run-3.html"},
{id:"tetris",pad:true,name:"Tetris",emoji:"🧱",group:"puzzle",thumb:"pb/thumbs/tetris.webp",desc:"Clear lines in a falling-block puzzle",cats:["puzzle"],tags:[],src:"pb/tetris.html"},
{id:"2048",name:"2048",emoji:"🔢",group:"puzzle",thumb:"pb/thumbs/2048.webp",desc:"Slide and merge numbers",cats:["puzzle"],tags:[],src:"pb/2048.html"},
{id:"snake",pad:true,name:"Snake",emoji:"🐍",group:"action",thumb:"pb/thumbs/snake.webp",desc:"Eat apples and grow — choose the speed, board size and mode: Classic, Walls, Portal or Borderless",cats:["action"],tags:[],src:"pb/snake.html"},
{id:"pacman",pad:true,name:"Pac-Man",emoji:"🟡",group:"action",thumb:"pb/thumbs/pacman.webp",desc:"Eat every dot, dodge the four ghosts and grab the power pellets",cats:["action"],tags:[],src:"pb/pacman.html"},
{id:"dino",name:"Dino Run",emoji:"🦖",group:"action",thumb:"pb/thumbs/dino.webp",desc:"Jump the cacti and duck the birds — the offline-browser dinosaur",cats:["action"],tags:[],src:"pb/dino.html"},
{id:"solitaire",name:"Solitaire",emoji:"♠️",group:"puzzle",thumb:"pb/thumbs/solitaire.webp",desc:"Klondike solitaire — Easy (draw 1) or Hard (draw 3), with undo",cats:["puzzle"],tags:[],src:"pb/solitaire.html"},
{id:"bubble-shooter",name:"Bubble Shooter",emoji:"🫧",group:"puzzle",thumb:"pb/thumbs/bubble-shooter.webp",desc:"Shoot and match bubbles",cats:["puzzle"],tags:[],src:"pb/bubble-shooter.html"},
{id:"space-invaders",pad:true,name:"Space Invaders",emoji:"👾",group:"action",thumb:"pb/thumbs/space-invaders.webp",desc:"Defend Earth from descending alien waves",cats:["action"],tags:[],src:"pb/space-invaders.html"},
{id:"breakout",name:"Brick Breaker",emoji:"🧱",group:"action",thumb:"pb/thumbs/breakout.webp",desc:"Bounce the ball to break every brick",cats:["action"],tags:[],src:"pb/breakout.html"},
{id:"asteroids",pad:true,name:"Asteroids",emoji:"☄️",group:"action",thumb:"pb/thumbs/asteroids.webp",desc:"Pilot a ship and blast incoming asteroids",cats:["action"],tags:[],src:"pb/asteroids.html"},
{id:"minesweeper",name:"Minesweeper",emoji:"💣",group:"puzzle",thumb:"pb/thumbs/minesweeper.webp",desc:"Flag the mines and clear the board — Easy, Medium or Hard, faster is better",cats:["puzzle"],tags:[],src:"pb/minesweeper.html"},
{id:"memory",name:"Memory",emoji:"🃏",group:"puzzle",thumb:"pb/thumbs/memory.webp",lowerIsBetter:true,desc:"Match every pair in as few moves as possible",cats:["puzzle"],tags:[],src:"pb/memory.html"},
{id:"maze",pad:true,name:"Labyrinth",emoji:"🏁",group:"puzzle",thumb:"pb/thumbs/maze.webp",lowerIsBetter:true,desc:"Escape each procedural maze against the clock",cats:["puzzle"],tags:[],src:"pb/maze.html"},
{id:"gravity-ball",pad:true,name:"Gravity Switch",emoji:"🔮",group:"puzzle",thumb:"pb/thumbs/gravity-ball.webp",desc:"Change gravity to guide the ball to each goal",cats:["puzzle"],tags:[],src:"pb/gravity-ball.html"},
{id:"tower-stack",name:"Tuerm stapelen",emoji:"🏗️",group:"action",thumb:"pb/thumbs/tower-stack.webp",desc:"Stack blocks as high as you can",cats:["action"],tags:[],src:"pb/tower-stack.html"},
{id:"fruit-slash",name:"Fruit Slicer",emoji:"🍉",group:"action",thumb:"pb/thumbs/fruit-slash.webp",desc:"Slice fruit and avoid bombs",cats:["action"],tags:[],src:"pb/fruit-slash.html"},
{id:"reaction",name:"Reaktiounszäit",emoji:"⚡",group:"action",thumb:"pb/thumbs/reaction.webp",lowerIsBetter:true,desc:"Measure your fastest reaction in milliseconds",cats:["action"],tags:[],src:"pb/reaction.html"},
{id:"word-scramble",name:"Wierder sortéieren",emoji:"📝",group:"puzzle",thumb:"pb/thumbs/word-scramble.webp",desc:"Unscramble words before time runs out",cats:["puzzle"],tags:[],src:"pb/word-scramble.html"},
{id:"pixel-painter",name:"Pixel Art Painter",emoji:"🖌️",group:"build",thumb:"pb/thumbs/pixel-painter.webp",noScore:true,desc:"Draw pixel art creations",cats:["creative"],tags:[],src:"pb/pixel-painter.html"},
{id:"o-wordle",name:"Wuertspill",app:"wordle.html",emoji:"🟩",group:"puzzle",thumb:"pb/thumbs/o-wordle.webp",noScore:true,desc:"Wordle in Lëtzebuergesch and German — a new word every day",cats:["puzzle"],tags:[],go:"wordle.html"},
{id:"mordsfall",name:"Mordsfall 🔎",emoji:"🔎",short:"Mordsfall",group:"puzzle",thumb:"pb/thumbs/mordsfall.webp",desc:"Murder-mystery logic puzzle — place every suspect so all clues are true, then unmask the murderer (30 cases, 5×5 to 9×9)",cats:["puzzle"],tags:[],go:"mordsfall.html"}
];

var DESC_I18N={
"train-sim":{"lb":"Fuer Lëtzebuerger Zich vum Féierstand aus: hal um Quai, oppass op Signaler a Limitten, verdéng € a kaaf Upgrades","de":"Fahre Luxemburger Züge aus dem Führerstand: halte am Bahnsteig, beachte Signale und Tempolimits, verdiene € und kaufe Upgrades","en":"Drive Luxembourg's trains from the cab: stop at the platform, obey signals and speed limits, earn € and upgrade your trains"},
"tram-sim":{"lb":"Fuer déi richteg Luxtram T1 vum Féierstand duerch d'Stad Lëtzebuerg: hal un all Arrêt, oppass op de Verkéier a Signaler, verdéng € a kaaf Upgrades","de":"Fahre die echte Luxtram T1 aus dem Führerstand durch Luxemburg-Stadt: halte an jeder Haltestelle, achte auf Verkehr und Signale, verdiene € und kaufe Upgrades","en":"Drive the real Luxtram T1 through Luxembourg City from the cab: stop at every tram stop, watch traffic and signals, earn € and upgrade the tram"},
"kart-letzebuerg":{"lb":"Kartrennen duerch d’Stad Lëtzebuerg, de Kierchbierg, de Gronn an Esch-Belval plus e Fantasy-Cup mam Zockerland, Äisbierg, Feierbierg a Geeschterschlass: Sprénk, Ofkierzungen, Objeten, Grand-Prix-Cupen, Zäitfueren géint däi Geescht an Online-Rennen fir bis zu 8","de":"Kartrennen durch Luxemburg-Stadt, Kirchberg, Grund und Esch-Belval plus ein Fantasy-Cup mit Zuckerland, Eisberg, Feuerberg und Geisterschloss: Sprünge, Abkürzungen, Items, Grand-Prix-Cups, Zeitfahren gegen deinen Geist und Online-Rennen für bis zu 8","en":"Kart racing through Luxembourg City, Kirchberg, Grund and Belval plus a fantasy cup of candy land, ice mountain, volcano and haunted castle — jumps, shortcuts, items, Grand Prix cups, time trial against your ghost, and online races for up to 8"},
"paket-express":{"lb":"Liwwer Päck duerch eng Lëtzebuerger Stad: Schichten géint d’Auer, fräi fueren an dräi Gefierer fir fräizeschalten","de":"Liefere Pakete durch eine Luxemburger Stadt: Schichten gegen die Uhr, freie Fahrt und drei freischaltbare Fahrzeuge","en":"Deliver parcels through a Luxembourg town — timed shifts, free driving and three unlockable vehicles"},
"bus-tycoon":{"lb":"Bau däi Lëtzebuerger Transportnetz: begréiss Passagéier, maach Linnen op a sammelt Stäre mam Rebirth","de":"Baue Luxemburgs Verkehrsnetz: begrüße Fahrgäste, eröffne Linien und sammle Sterne durch Rebirth","en":"Build Luxembourg’s transport network — welcome passengers, open lines and rebirth for stars"},
"ski":{"lb":"Fuer déi richteg Pisten vu 10 richtege Skigebidder a 3D erof: Espace Killy, Les 3 Vallées, Zermatt–Cervinia, Ski Arlberg, Kronplatz, Via Lattea, Obertauern, Livigno, Davos Klosters a Laax. Fuer fräi mat de richtege Liften, Challengen géint d'Auer, e Snowpark mat Tricks an online mat Frënn","de":"Fahre die echten Pisten von 10 echten Skigebieten in 3D hinunter: Espace Killy, Les 3 Vallées, Zermatt–Cervinia, Ski Arlberg, Kronplatz, Via Lattea, Obertauern, Livigno, Davos Klosters und Laax. Freie Fahrt mit den echten Liften, Challenges gegen die Uhr, ein Snowpark mit Tricks und online mit Freunden","en":"Ski the real pistes of 10 real ski areas in 3D: Espace Killy, Les 3 Vallées, Zermatt–Cervinia, Ski Arlberg, Kronplatz, Via Lattea, Obertauern, Livigno, Davos Klosters and Laax. Free ride with the real lifts, challenges against the clock, a snowpark with tricks and online with friends"},
"mtb":{"lb":"Mountainbike duerch dat richtegt Mëllerdall a 3D: sechs Trailen vu gréng bis schwaarz mat Medaillen, e Geescht vun dengem beschte Lauf, fräi Fuerten fir d'Aussiichtspunkten ze fannen, eng Dagesausfuerderung a véier Vëloen","de":"Mountainbike durch das echte Müllerthal in 3D: sechs Trails von Grün bis Schwarz mit Medaillen, ein Geist deiner besten Fahrt, freie Fahrt zum Finden der Aussichtspunkte, eine Tagesherausforderung und vier Räder","en":"Mountain biking through the real Mullerthal in 3D: six trails from green to black with medals, a ghost of your best run, free ride to find the viewpoints, a daily challenge and four bikes"},
"lux-drive":{"lb":"Fräi Fuerte mam Auto duerch Lëtzebuerg-Stad an Nidderaanwen a 3D: richteg Stroossen, Brécken an Tunnellen, Reen oder Sonn, Dag oder Nuecht, an eng Kaart fir op all Strooss ze sprangen","de":"Freie Fahrt durch Luxemburg-Stadt und Niederanven in 3D: echte Straßen, Brücken und Tunnel, Regen oder Sonne, Tag oder Nacht, mit einer Karte, um zu jeder Straße zu springen","en":"Free driving through Luxembourg City and Niederanven in 3D: real roads, bridges and tunnels, rain or sunshine, day or night, with a map to jump to any street"},
"park":{"lb":"Féier d'Schueberfouer um Glacis: lounen Plazen, bau Fahrgeschäfter a Stänn, gang duerch deng Fouer a feier déi richteg Fouerdeeg mam Hämmelsmarsch a mam Feierwierk","de":"Betreibe die Schueberfouer auf dem Glacis: miete Plätze, baue Fahrgeschäfte und Stände, geh durch deine Fouer und feiere die echten Fouertage mit Hämmelsmarsch und Feuerwerk","en":"Run the Schueberfouer on the Glacis — rent pitches, build rides and stalls, walk through your fair and join the real fair days with the Hämmelsmarsch and fireworks"},
"geometrydash":{"lb":"Rhythmus-Runner mat 15 Level: sprang iwwer Spikes, Lächer an Orben, dréi d'Schwéierkraaft ëm a fléi mat engem Schëff, alles am Takt","de":"Rhythmus-Runner mit 15 Leveln: spring über Stacheln, Lücken und Orbs, dreh die Schwerkraft um und flieg mit einem Schiff, alles im Takt"},
"drive-mad":{"lb":"3D-Stunt-Fueren: 24 Level mat Wippen, Hummeren a Pressen","de":"3D-Stunt-Fahren: 24 Level mit Wippen, Hämmern und Pressen"},
"chill-drive":{"lb":"Richteg 3D-Cruisen: 3 endlos Welten + 20 Level","de":"Echtes 3D-Cruisen: 3 Endlos-Welten + 20 Level"},
"cookie-clicker":{"lb":"Bau en Cookie-Räich duerch Klicken a Verbesserungen kafen — 24 Produktiounsstufen bis Cookie Infinity, Klick-Upgrades a Rebirth","de":"Baue ein Cookie-Imperium durch Klicken und Upgrades — 24 Produktionsstufen bis Cookie Infinity, Klick-Upgrades und Rebirth"},
"crossy-road":{"lb":"20 Level + endlos: weich Autoen, Zich a Flëss aus","de":"20 Level + endlos: weiche Autos, Zügen und Flüssen aus"},
"burger":{"lb":"Kach, zerwéier a verbessert däi Burger-Restaurant","de":"Koche, serviere und verbessere dein Burger-Restaurant"},
"towerdefense":{"lb":"Bau Tierm, kommandéier en Held a stoh 15 Level vu Wellen duer","de":"Baue Türme, befehlige einen Helden und überstehe 15 Level voller Wellen"},
"idle-empire":{"lb":"Business-Tycoon-Idle-Spill: 18 Betriber vum Limonadestand bis zur Galaktescher Bourse, Manager, Etappen, Prestige","de":"Business-Tycoon-Idle-Spiel: 18 Unternehmen vom Limonadenstand bis zur Galaktischen Börse, Manager, Meilensteine, Prestige"},
"tictactoe":{"lb":"Dräi an enger Rei: spill géint de Computer (Einfach, Mëttel, Onméiglech) oder géint e Frënd um selwechte Schierm","de":"Drei in einer Reihe: spiel gegen den Computer (Leicht, Mittel, Unmöglich) oder gegen einen Freund am selben Bildschirm"},
"pong":{"lb":"Neon-Pong: zu zweet, géint d'KI oder online op zwee iPads","de":"Neon-Pong: zu zweit, gegen die KI oder online auf zwei iPads"},
"o-connect4":{"lb":"Looss Scheiwen falen, verbann véier: online op zwee iPads oder géint d'KI","de":"Wirf Scheiben ein, verbinde vier: online auf zwei iPads oder gegen die KI"},
"tank-wars":{"lb":"Panzerschluechten: zu zweet, géint d'KI oder online op zwee iPads","de":"Panzerschlachten: zu zweit, gegen die KI oder online auf zwei iPads"},
"fighters":{"lb":"Plattform-Kämpfer: zu zweet, géint d'KI oder online op zwee iPads","de":"Plattform-Kämpfer: zu zweit, gegen die KI oder online auf zwei iPads"},
"o-battleship":{"lb":"Versenk d'Flott: online op zwee iPads oder géint d'KI","de":"Versenke die Flotte: online auf zwei iPads oder gegen die KI"},
"o-dots":{"lb":"Hol der d'Këschten: online op zwee iPads oder géint d'KI","de":"Sichere dir die Kästchen: online auf zwei iPads oder gegen die KI"},
"o-color":{"lb":"Errot zesumme d'Faarf: online oder géint d'KI","de":"Errate gemeinsam die Farbe: online oder gegen die KI"},
"o-draw":{"lb":"Zeechne a roden: mat engem Frënd online op zwee iPads","de":"Zeichne und rate: mit einem Freund online auf zwei iPads"},
"o-intro":{"lb":"Errot d'Lidd no 1 Sekonn, dann no 3, dann no 5…","de":"Errate den Song nach 1 Sekunde, dann nach 3, dann nach 5…"},
"o-meme":{"lb":"Schreif eng Ënnerschrëft zum selwechte Meme a vot fir déi lëschtegst: 3+ Spiller","de":"Schreibe eine Bildunterschrift zum selben Meme und stimme für die lustigste ab: 3+ Spieler"},
"o-checkers":{"lb":"Sprang, schlag méi Steng hannereneen a kroun Kinneken: online op zwee iPads oder géint d'KI","de":"Springe, schlage mehrere Steine hintereinander und kröne Könige: online auf zwei iPads oder gegen die KI"},
"o-dice-duel":{"lb":"Würfel, haal a punkt: online oder géint d'KI","de":"Würfeln, halten und punkten: online oder gegen die KI"},
"o-roulette":{"lb":"Roulette mat Spill-Jetonen: jiddereen setzt um selwechten Dësch, 2–8 Spiller oder eleng","de":"Roulette mit Spielchips: alle setzen am selben Tisch, 2–8 Spieler oder allein"},
"o-blackjack":{"lb":"Blackjack mat Spill-Jetonen: bis zu 7 Frënn um selwechten Dësch géint den Dealer, oder eleng","de":"Blackjack mit Spielchips: bis zu 7 Freunde am selben Tisch gegen den Dealer, oder allein"},
"o-slf":{"lb":"Nenn fir all Buschtaf eng Stad, e Land an e Floss: 2+ Spiller am selwechte Code","de":"Nenne zu jedem Buchstaben eine Stadt, ein Land und einen Fluss: 2+ Spieler im selben Code"},
"air-hockey":{"lb":"Air Hockey: zu zweet, géint d'KI oder online op zwee iPads","de":"Air Hockey: zu zweit, gegen die KI oder online auf zwei iPads"},
"flappy":{"lb":"Tipp, fir duerch d'Päifen ze fléien","de":"Tippe, um durch die Rohre zu fliegen"},
"typing":{"lb":"Test, wéi vill Wierder s du pro Minutt tippe kanns","de":"Teste, wie viele Wörter du pro Minute tippen kannst"},
"doodle-jump":{"lb":"Sprang vu Plattform zu Plattform no uewen","de":"Spring von Plattform zu Plattform nach oben"},
"color-clash":{"lb":"Passt Faarfwierder géint d'Auer zesummen","de":"Ordne Farbwörter gegen die Uhr zu"},
"whack-a-mole":{"lb":"Schlag d'Maulwërf fir Punkten","de":"Hau die Maulwürfe für Punkte"},
"run-3":{"lb":"Lafe duerch en dréienden Weltraumtunnel","de":"Renne durch einen rotierenden Weltraumtunnel"},
"tetris":{"lb":"Läsch Reien an engem Puzzle mat falende Bléck","de":"Lösche Reihen in einem Puzzle mit fallenden Blöcken"},
"2048":{"lb":"Schief a fusionéier Zuelen","de":"Schiebe und verschmelze Zahlen"},
"snake":{"lb":"Iess Äppel a wuess: wiel d'Geschwindegkeet, d'Brettgréisst an de Modus: Classic, Walls, Portal oder Borderless","de":"Iss Äpfel und wachse: wähle Tempo, Spielfeldgröße und Modus: Classic, Walls, Portal oder Borderless"},
"pacman":{"lb":"Iess all Punkt, weich de véier Geeschter aus a schnapp d'Power-Pellets","de":"Iss jeden Punkt, weiche den vier Geistern aus und schnapp dir die Power-Pellets"},
"dino":{"lb":"Sprang iwwer d'Kaktusen a bück dech virun de Vullen: den Offline-Dino aus dem Browser","de":"Spring über Kakteen und duck dich vor den Vögeln: der Offline-Dino aus dem Browser"},
"solitaire":{"lb":"Klondike-Solitaire: Einfach (1 Kaart zéien) oder Schwéier (3 Kaarten), mat Réckgängeg","de":"Klondike-Solitaire: Leicht (1 Karte ziehen) oder Schwer (3 Karten), mit Rückgängig"},
"bubble-shooter":{"lb":"Schéiss a passt Bubbelen zesummen","de":"Schieße und ordne Blasen zusammen"},
"space-invaders":{"lb":"Verdeedeg d'Äerd géint erofkommend Auslänner-Wellen","de":"Verteidige die Erde gegen anrückende Alien-Wellen"},
"breakout":{"lb":"Looss de Ball sprangen a briech all Steng","de":"Lass den Ball springen und zerbrich alle Steine"},
"asteroids":{"lb":"Fléi e Schëff a schéiss op d'Asteroiden","de":"Steuere ein Schiff und schieße auf die Asteroiden"},
"minesweeper":{"lb":"Markéier d'Minen a raum d'Feld: Einfach, Mëttel oder Schwéier, séier ass besser","de":"Markiere die Minen und räume das Feld: Leicht, Mittel oder Schwer, schneller ist besser"},
"memory":{"lb":"Fann all Pär mat sou wéineg Zich wéi méiglech","de":"Finde alle Paare mit möglichst wenigen Zügen"},
"maze":{"lb":"Entkomm all zoufälleg Labyrinth géint d'Auer","de":"Entkomme jedem zufälligen Labyrinth gegen die Uhr"},
"gravity-ball":{"lb":"Wiessel d'Schwéierkraaft a féier de Ball an all Zil","de":"Wechsle die Schwerkraft und führe den Ball zu jedem Ziel"},
"tower-stack":{"lb":"Stapel Bléck sou héich wéi s du kanns","de":"Stapele Blöcke so hoch du kannst"},
"fruit-slash":{"lb":"Schneid Uebst a weich de Bomben aus","de":"Schneide Obst und weiche den Bomben aus"},
"reaction":{"lb":"Moss deng séierst Reaktioun a Millisekonnen","de":"Miss deine schnellste Reaktion in Millisekunden"},
"word-scramble":{"lb":"Bréng d'Wierder an d'Rei, ier d'Zäit eriwwer ass","de":"Entwirre die Wörter, bevor die Zeit abläuft"},
"pixel-painter":{"lb":"Zeechent Pixel-Konscht","de":"Zeichne Pixel-Art"},
"o-wordle":{"lb":"Wordle op Lëtzebuergesch an Däitsch: all Dag en neit Wuert","de":"Wordle auf Luxemburgisch und Deutsch: jeden Tag ein neues Wort"},
"mordsfall":{"lb":"Krimi-Logikrätsel: setz all Verdächtegen esou, dass all Hiweiser stëmmen, a fannt de Mäerder (30 Fäll, vu 5×5 bis 9×9)","de":"Krimi-Logikrätsel: Setze alle Verdächtigen so, dass jeder Hinweis stimmt, und entlarve den Mörder (30 Fälle, von 5×5 bis 9×9)"},
"webcam":{"lb":"Sechs Mini-Spiller, déi s du mat den Hänn an dem ganze Kierper virun der Kamera spills: Ballonen zerplatzen, Steen-Pabeier-Schéier, duerch d'Mauer passen, sprangen a bécken, Pong mat zwou Hänn a Molen an der Loft. De Video verléisst däin Apparat ni","de":"Sechs Minispiele, die du mit Händen und Körper vor der Kamera spielst: Ballons platzen lassen, Schere-Stein-Papier, durch die Wand passen, springen und ducken, Pong mit zwei Händen und Malen in der Luft. Das Video verlässt dein Gerät nie"}
};

/* <usage> written by scripts/fetch_game_plays.py: id -> [opens in 90 days, opens in 30 days, players on the score board] */
/* generated 2026-11-25 */
var OPENS={
"cookie-clicker":[549,332,68],
"idle-empire":[467,172,43],
"park":[261,154,55],
"bus-tycoon":[201,128,44],
"kart-letzebuerg":[193,123,13],
"train-sim":[169,75,50],
"chill-drive":[149,54,63],
"tetris":[166,65,34],
"crossy-road":[117,71,48],
"mtb":[96,96,16],
"flappy":[108,43,50],
"drive-mad":[97,31,67],
"dino":[95,57,37],
"doodle-jump":[78,54,41],
"paket-express":[84,32,32],
"lux-drive":[73,73,0],
"snake":[81,38,27],
"ski":[53,53,36],
"tram-sim":[78,62,0],
"o-wordle":[76,47,0],
"space-invaders":[61,5,29],
"burger":[54,13,27],
"towerdefense":[45,10,28],
"bubble-shooter":[49,7,27],
"pacman":[45,18,16],
"o-slf":[51,20,0],
"breakout":[44,17,9],
"reaction":[43,11,16],
"run-3":[32,13,23],
"color-clash":[23,7,28],
"typing":[24,7,26],
"o-dots":[42,13,0],
"asteroids":[34,10,11],
"tower-stack":[33,9,12],
"o-meme":[37,13,0],
"o-draw":[35,13,0],
"pong":[41,5,0],
"gravity-ball":[25,13,8],
"whack-a-mole":[16,4,20],
"word-scramble":[22,8,9],
"air-hockey":[28,8,2],
"geometrydash":[0,0,37],
"solitaire":[18,9,9],
"fighters":[23,5,7],
"fruit-slash":[20,6,9],
"tictactoe":[16,3,15],
"2048":[22,6,6],
"maze":[23,5,6],
"memory":[19,7,6],
"o-roulette":[15,15,0],
"minesweeper":[18,4,7],
"tank-wars":[17,4,6],
"pixel-painter":[19,6,0],
"o-color":[16,4,0],
"o-checkers":[13,3,0],
"o-connect4":[11,3,0],
"o-battleship":[9,1,0],
"o-dice-duel":[7,1,0],
"o-blackjack":[4,4,0],
"mordsfall":[0,0,7],
"o-intro":[0,0,0],
"webcam":[0,0,0]
};
/* </usage> */

var TOP_COUNT=8;    // "Meescht gespillt" on the home page
/* Real use: opens of the last 90 days, the last 30 days counting double, plus the players on the score board (pages of their own,
   like Geometry Dash, have no opens in the counter). */
function usage(id){var o=OPENS[id];return o?o[0]+o[1]+o[2]:0}
var ORDER={};
GAMES.forEach(function(g,i){ORDER[g.id]=i});
function byUse(a,b){return usage(b.id)-usage(a.id)||ORDER[a.id]-ORDER[b.id]}
function rankedCopy(games){return games.slice().sort(byUse)}
function byId(id){return GAMES.find(function(g){return g.id===id})||null}
function hubUrl(id){return "pixelbreak.html?g="+encodeURIComponent(id)}
/* where a tile leads: the hub with the game open, or the game's own page (an online game's page sends a plain visit to its lobby,
   which also offers the computer: mp-gate.js) */
function gameLink(g){return g.go||g.href||hubUrl(g.id)}
function tileName(g){return g.short||g.name}
function descOf(g,lang){return lang==="en"?g.desc:((DESC_I18N[g.id]||{})[lang]||g.desc)}
/* the home page's sections: the most played first, then every group, each game exactly once (`taken` = games already shown above them) */
function homeSections(taken){
var ranked=rankedCopy(GAMES).filter(function(g){return (taken||[]).indexOf(g)<0});
var top=ranked.slice(0,TOP_COUNT);
return [{id:"top",label:"games.g.top",games:top}].concat(GROUPS.map(function(group){
return {id:group.id,label:group.label,games:ranked.filter(function(g){return g.group===group.id&&top.indexOf(g)<0})};
}));
}
function smallThumb(id){return "pb/thumbs/s/"+id+".webp"}

window.ArcadeCatalogue=Object.freeze({GAMES:GAMES,GROUPS:GROUPS,DESC_I18N:DESC_I18N,byId:byId,usage:usage,rankedCopy:rankedCopy,homeSections:homeSections,
gameLink:gameLink,tileName:tileName,descOf:descOf,smallThumb:smallThumb});
window.arcadeGameById=byId;   // arcade-weekly.js, pixelbreak-records.js
})();
