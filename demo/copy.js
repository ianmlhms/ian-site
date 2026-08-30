/* Luxembourgish copy for the three demo pages.
 *
 * Two audiences, one language. /demo1 talks to classmates: short, "du", the
 * game first. /demo2 talks to adults: the same showcases in the same order,
 * but each one also says what it is built on, because that is the part an
 * adult asks about. /demo3 narrates the same eight showcases one at a time.
 *
 * Keeping all three sets of words in one file is deliberate — when a showcase
 * is renamed it has to be renamed in three places, and they are next to each
 * other here rather than scattered across three pages. */

/* Every showcase, in the order the pages lay them out. `id` is the mount point
 * a page renders and the module key showcase.js dispatches on. */
export const SHOWCASE_ORDER = Object.freeze([
  "games", "transit", "sky", "chat", "buddy", "wuertspill", "trails", "maps",
]);

export const COPY = Object.freeze({
  friends: {
    lang: "lb",
    kicker: "Demo",
    title: "ian.lu",
    sub: "Alles hei leeft live. Näischt ze installéieren, keng Umeldung.",
    hint: "Scroll erof — a spill roueg matten dran.",
    footer: "Dat ass just en Ausschnëtt. Op ian.lu ass nach vill méi.",
    cta: "Ganze Site opmaachen",
    cards: {
      games:      { t: "Spill elo direkt",        s: "34 Spiller am PixelBreak. Dëst hei leeft direkt op der Säit." },
      transit:    { t: "Bus & Zuch",              s: "Richteg Zäiten, elo. Wiel e Wee — hie gëtt live gesicht." },
      sky:        { t: "Wat fléit iwwer eis?",    s: "All Fliger ronderëm Nidderaanwen, live vum Radar." },
      chat:       { t: "Messenger & Uruff",       s: "Chat an Uruff tëscht Frënn — hei als Demo." },
      buddy:      { t: "Study Buddy",             s: "Frot stellen, Äntwert kritt. Fir Hausaufgaben an Tester." },
      wuertspill: { t: "Wuertspill",              s: "Lëtzebuergesch Wierder roden. Sechs Versich." },
      trails:     { t: "Wanderen & MTB",          s: "105 Auto-Pédestren an 37 MTB-Touren, mat Kaart a Bus." },
      maps:       { t: "Geoportal",               s: "Biller vu uewen a Kadaster vu ganz Lëtzebuerg." },
    },
  },
  adults: {
    lang: "lb",
    kicker: "Demo",
    title: "ian.lu",
    sub: "E puer vun de Saachen, déi op dësem Site lafen — mat echten, live Donnéeën.",
    hint: "All Beispill hei drënner ass net gestallt, ausser wou et als Demo markéiert ass.",
    footer: "Alles selwer gebaut: statesch Säiten, Supabase am Hannergrond, kee Build-Prozess.",
    cta: "Ganze Site opmaachen",
    cards: {
      games:      { t: "PixelBreak Arcade",   s: "34 Spiller, all am Browser. Dëst hei leeft direkt op der Säit.",
                    how: "All Spill ass eng eegestänneg HTML-Datei; Scores a Fortschrëtt ginn iwwer Supabase gespäichert." },
      transit:    { t: "Bus & Zuch",          s: "Bus, Zuch an Tram fir de ganze Land.",
                    how: "Routing iwwer MOTIS (transitous), Departen iwwer HAFAS vum Verkéiersbond, Haltestellen aus dem offizielle GTFS." },
      sky:        { t: "SkyLens",             s: "All Fliger ronderëm Nidderaanwen, live.",
                    how: "ADS-B-Positioune vun adsb.lol, iwwer eng eege Supabase Edge Function gefiltert." },
      chat:       { t: "Messenger & Uruff",   s: "Chat, Gruppen an Uruff tëscht de Benotzer vum Site.",
                    how: "Supabase Realtime fir d'Noriichten, WebRTC fir de Ruff. Hei als Demo ofgespillt, well een zweete Benotzer feelt." },
      buddy:      { t: "Study Buddy",         s: "En Assistent fir Hausaufgaben, Tester a Resuméen.",
                    how: "Leeft iwwer eng Edge Function; d'Äntwert hei ass eng Demo." },
      wuertspill: { t: "Wuertspill",          s: "Lëtzebuergesch a Däitsch Wierder roden, all Dag een neit.",
                    how: "D'Wuert vum Dag kënnt aus enger fester Lëscht, gerechent no der Lëtzebuerger Zäit." },
      trails:     { t: "Wanderen & MTB",      s: "105 Auto-Pédestren an 37 MTB-Touren, all mat Kaart, Zäit a Bus.",
                    how: "Dräisproocheg generéiert (DE/FR/EN) aus OpenStreetMap; d'Streck hei drënner ass déi richteg Geometrie." },
      maps:       { t: "Geoportal",           s: "Biller vu uewen, Kadaster an topographesch Kaarte vu Lëtzebuerg.",
                    how: "Kaarten direkt vum geoportail.lu, mat LUREF-Koordinaten." },
    },
  },
});

/* The guided tour. Same showcases, one screen at a time, with a line of
 * narration that a card on a scrolling page does not have room for. */
export const TOUR = Object.freeze({
  lang: "lb",
  intro: {
    kicker: "Guidéiert Tour",
    title: "ian.lu an aacht Schrëtt",
    sub: "Klick dech duerch. All Beispill ass live.",
    start: "Lass",
  },
  outro: {
    title: "Dat war d'Tour",
    sub: "Nach vill méi um Site selwer — Noten, Stonneplang, Kaarten, Hotel-Simulator.",
    cta: "ian.lu opmaachen",
    again: "Nach eng Kéier",
  },
  nav: { next: "Weider", prev: "Zréck", step: "Schrëtt" },
  steps: Object.freeze([
    { id: "games",      t: "34 Spiller",          n: "De PixelBreak Arcade. All Spill leeft am Browser, ouni Installatioun — dëst hei kanns du elo spillen." },
    { id: "transit",    t: "Bus & Zuch",          n: "E kompletten Wee-Sicher fir Lëtzebuerg. D'Zäiten hei ënnendrënner ginn an dësem Moment gesicht." },
    { id: "sky",        t: "Fliger iwwer eis",    n: "Live-Radar. All Fliger an 40 Séimeile ronderëm Nidderaanwen, mat Typ, Héicht a Geschwindegkeet." },
    { id: "chat",       t: "Messenger",           n: "Chat an Uruff tëscht de Benotzer. Wat s du hei gesäis, ass eng Demo." },
    { id: "buddy",      t: "Study Buddy",         n: "En Assistent fir Hausaufgaben an Tester. Och dës Äntwert ass eng Demo." },
    { id: "wuertspill", t: "Wuertspill",          n: "Lëtzebuergesch Wierder roden — sechs Versich, all Dag e neit Wuert. Probéier et." },
    { id: "trails",     t: "Wanderen & MTB",      n: "105 Auto-Pédestren an 37 MTB-Touren. D'Streck gëtt aus den echte Kaarte gezeechent." },
    { id: "maps",       t: "Geoportal",           n: "Biller vu uewen a Kadaster vu ganz Lëtzebuerg, direkt am Browser." },
  ]),
});

/* Shared bits every demo page needs. */
export const UI = Object.freeze({
  loading: "Lueden…",
  failed: "Elo net verfügbar.",
  retry: "Nach eng Kéier",
  demoBadge: "Demo",
  liveBadge: "Live",
  openApp: "App opmaachen",
  /* Short strings the showcase modules need. They live here rather than in the
   * modules so that every Luxembourgish word on these pages is in one file and
   * can be proofread in one pass. */
  direct: "direkt",
  transfers: "× ëmklammen",              // rendered after the count: "1× ëmklammen"
  skyEmpty: "Elo fléit näischt driwwer.",
  won: "Gewonnen!",
  lost: "Verluer — d'Wuert war",         // followed by the answer word
  chooser: {
    title: "ian.lu · Demoen",
    sub: "Dräi Weeër, fir de Site ze weisen.",
    items: Object.freeze([
      { href: "/demo1/", icon: "🎮", t: "Fir Kolleegen",   s: "Kuerz, séier, Spill als éischt." },
      { href: "/demo2/", icon: "🧭", t: "Fir Erwuessener", s: "Déiselwecht Saachen, mat der Technik dohannert." },
      { href: "/demo3/", icon: "▶️", t: "Guidéiert Tour",  s: "Schrëtt fir Schrëtt, ee Bildschierm no deem aneren." },
    ]),
  },
});
