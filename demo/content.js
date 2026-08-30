/* Demo content — the things the /demo pages show off.
 *
 * Everything here is REAL: the itineraries hit the same keyless MOTIS routing
 * engine bus.html uses, the trail geometry is the geojson the /trails and /mtb
 * pages already ship, and the games are the arcade's own payloads. Only the
 * chat / call / Study Buddy scripts in scripts.js are staged, and those are
 * labelled as demos on screen.
 *
 * Absolute paths throughout: the demo pages live at /demo1/, /demo2/ and
 * /demo3/, so a relative "../pb/..." would be one more thing to get wrong. */

/* Stops come from moien-stops.json — [id, "City, Stop", lat, lon]. The route
 * planner only ever needs lat/lon, but the id is kept so a stop can be traced
 * back to the GTFS feed. */
export const STOPS = Object.freeze({
  laach:    { id: "200504002", name: "Nidderaanwen, Laach",        lat: 49.65153, lon: 6.25472 },
  school:   { id: "200420006", name: "Merl, Geesseknäppchen",   lat: 49.60172, lon: 6.11348 },
  gare:     { id: "200405060", name: "Lëtzebuerg, Gare Centrale",  lat: 49.59997, lon: 6.13424 },
  findel:   { id: "200501001", name: "Fluchhafen Findel",          lat: 49.63486, lon: 6.21561 },
  clervaux: { id: "200101016", name: "Klierf, Gare",               lat: 50.06158, lon: 6.02463 },
  echt:     { id: "170501005", name: "Iechternach, Zentrum",       lat: 49.81181, lon: 6.41894 },
});

/* Ready-made itineraries. `when` decides the moment the plan is made for:
 *   "now"     — this second, so the times on screen are the real next ones
 *   "school"  — the next school-day morning at 07:00, because an 8pm plan for
 *               the school run routes through half the country and looks silly
 * The school anchor is what makes this a demo rather than a lottery. */
export const ITINERARIES = Object.freeze([
  { key: "school", icon: "🎒", from: "laach",  to: "school",   when: "school",
    label: "Doheem → Schoul",        note: "moies um 7 Auer" },
  { key: "city",   icon: "🏙️", from: "laach",  to: "gare",     when: "now",
    label: "Nidderaanwen → Stad",    note: "elo direkt" },
  { key: "air",    icon: "✈️", from: "gare",   to: "findel",   when: "now",
    label: "Gare → Fluchhafen",      note: "elo direkt" },
  { key: "north",  icon: "🚆", from: "gare",   to: "clervaux", when: "now",
    label: "Stad → Klierf",          note: "mam Zuch an den Éislek" },
  { key: "east",   icon: "🥾", from: "gare",   to: "echt",     when: "now",
    label: "Stad → Iechternach",     note: "op Mëllerdall" },
]);

export const PLAN_ENDPOINT = "https://api.transitous.org/api/v1/plan";
export const SCHOOL_HOUR = 7;          // the school anchor, in Europe/Luxembourg

/* The school run is only a school run while school is running. During the summer
 * holidays the RGTR school lines do not operate at all, so MOTIS answers the
 * 07:00 Laach → Geesseknäppchen query with two city buses and a transfer: 68
 * minutes instead of the direct D02 in 28. Verified against the live feed on
 * 30 Aug 2026 — 31 Aug returns 311 + 6 (68 min), 15 Sept returns D02 (28 min).
 * Flooring the anchor at the first day of term makes the card show the journey
 * Ian actually makes. The constant expires by itself: once the date has passed
 * it is always in the past and the plain "next weekday" rule takes over. */
export const SCHOOL_TERM_START = "2026-09-15";
export const MAX_ITINERARIES = 3;      // per route card — three is a board, six is a wall

/* SkyLens: the same Supabase relay skylens.js calls, centred on Niederanven.
 * 40 NM keeps it to aircraft that are genuinely overhead rather than a list of
 * everything between Brussels and Frankfurt. */
export const SKY = Object.freeze({
  proxy: "https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/skylens",
  lat: 49.6494, lon: 6.2571, radiusNm: 40,
  refreshMs: 20000,
  maxRows: 6,
});

/* Trails: slug + the geojson the real page already loads, so the mini map is
 * drawn from the true geometry and not a decorative squiggle. */
export const TRAILS = Object.freeze([
  { slug: "senningerberg", cat: "trails", name: "Auto-Pédestre Senningerberg",
    km: 11.0, time: "3 Std.", grade: "mëttel", note: "Wäit Vue iwwer d'Syrdall" },
  { slug: "altrier", cat: "trails", name: "Auto-Pédestre Altrier",
    km: 12.7, time: "3½ Std.", grade: "schwéier", note: "Kuelscheier Fielsspalten" },
  { slug: "wiltz", cat: "trails", name: "Auto-Pédestre Wolz",
    km: 13.5, time: "4 Std.", grade: "mëttel", note: "Éislek mat déiwen Däller" },
  { slug: "grengewald", cat: "mtb", name: "MTB Gréngewald",
    km: 23.0, time: "2½ Std.", grade: "mëttel", note: "Schlass Walfer" },
  { slug: "vianden", cat: "mtb", name: "MTB Veianen",
    km: 22.6, time: "3 Std.", grade: "mëttel", note: "Point de Vue Victor Hugo" },
  { slug: "redrock-ellergrond", cat: "mtb", name: "MTB RedRock Ellergrond",
    km: 28.9, time: "3 Std.", grade: "mëttel", note: "Minett, Polverhaischen" },
]);

export const TRAIL_COUNTS = Object.freeze({ trails: 105, mtb: 37 });

/* Arcade payloads. These pages run standalone — the arcade's save/sound shim is
 * injected by pixelbreak.html, and every game guards its absence — so a plain
 * iframe is enough here. `feature` is the one embedded big; the rest are chips. */
export const GAMES = Object.freeze([
  { id: "burger",       name: "Burger Rush",  emoji: "🍔", feature: true,
    desc: "Grillen, servéieren, upgraden" },
  { id: "towerdefense", name: "Tower Defense", emoji: "🏰", feature: false,
    desc: "15 Level Wellen, an 3D" },
  { id: "chill-drive",  name: "Chill Drive",   emoji: "🚗", feature: false,
    desc: "Rou fueren, ouni Stress" },
  { id: "idle-empire",  name: "Idle Empire",   emoji: "💰", feature: false,
    desc: "Tycoon mat Manager a Prestige" },
  { id: "2048",         name: "2048",          emoji: "🔢", feature: false,
    desc: "Ee Klassiker fir tëschendrënner" },
]);

export const ARCADE_COUNT = 34;

/* The two-device showcase. These are the games that normally need two iPads and
 * two people: one browser joins a room as host, the other as guest, and they
 * talk over a Supabase realtime broadcast channel. The demo opens BOTH sides in
 * the same page, so one person can play both and watch the moves cross — which
 * is the whole point of the feature and impossible to show with one board.
 * game-common.js reads ?room= and ?role=, defaulting the room to "demo". */
export const DUO_GAMES = Object.freeze([
  { id: "connect4", name: "4 Gewënnt", emoji: "🔴" },
  { id: "dots",     name: "Dots & Boxes", emoji: "⬛" },
]);

/* A fresh room per page load, so two visitors never land in the same game. */
export const DUO_ROOM_PREFIX = "pbdemo";

/* Bundled line index, the same file bus.html uses: line -> one entry per
 * direction, each with a headsign `h`, an origin stop `o` and the stop list `s`.
 * 776 KB raw / ~115 KB gzipped, so it is fetched only when the line search is
 * actually opened — never on page load. */
export const LINES_URL = "/moien-lines.json";
export const LINE_RESULT_LIMIT = 8;

/* The demo Wuertspill uses the same Luxembourgish list as wordle.html, so a
 * word that shows up here is a word that shows up in the real game. */
export const WORDS_LB = Object.freeze([
  "MOIEN", "MERCI", "KLENG", "ÄPPEL", "KAFFI", "FRËNN", "DËSCH", "ËMMER",
  "HÄERZ", "VÉIER", "WÄISS", "GRÉNG", "PÄERD", "FËSCH", "SPILL", "DAACH",
  "BAACH", "MOUND", "LAANG", "KUERZ", "WUERT", "BLUMM", "OWEND", "STUFF",
  "GAART", "BRÉIF", "BROUT", "FEIER", "BËSCH", "STEEN", "FAARF", "MUSEK",
  "GLÉCK", "FOUSS", "MOUNT", "BAUCH", "KLEED", "HAART", "WEECH", "KRÄIZ",
  "BUERG", "ENGEL", "DUERF", "SCHOF", "MAUER", "GEESS", "IESEL", "KUERF",
  "GAASS", "BRONG", "SIWEN", "AACHT", "FUUSS", "BLËTZ", "HÉICH", "KRANK",
  "INSEL",
]);

export const WORDLE_ROWS = 6;
export const WORDLE_COLS = 5;

/* Geoportal is an iframe of the real app — it is entirely client-side and has
 * no auth, so it drops straight in. */
export const GEOPORTAL_SRC = "/geoportal/";
