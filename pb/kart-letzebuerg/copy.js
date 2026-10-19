/* Kart Lëtzebuerg — texts (lb default, de, en). KL.t(key, {vars}) */
(function () {
  'use strict';
  const KL = window.KL;
  const TXT = {
    lb: {
      title: 'Kart Lëtzebuerg', tagline: "Drift duerch d'Stad, schnapp d'Boxen a gewënn d'Rennen.",
      play: 'Rennen', playDesc: 'Solo géint 7 Bots', gp: 'Grand Prix', gpDesc: '4 Rennen, Punkten', tt: 'Zäitfueren', ttDesc: 'Géint däin Geescht', online: 'Online', onlineDesc: 'Mat Frënn',
      track: 'Streck', weather: 'Wieder', difficulty: 'Schwieregkeet', driver: 'Fuerer', laps: 'Ronnen', start: 'Lass!', back: 'Zréck', soon: 'Kënnt geschwënn',
      w_random: 'Zoufall', w_day: 'Dag', w_sunset: 'Sonnenënnergang', w_night: 'Nuecht', w_rain: 'Reen', w_fog: 'Niwwel',
      d_easy: 'Einfach', d_normal: 'Mëttel', d_hard: 'Schwéier',
      t_villehaute: 'Uewerstad', t_geeschterschlass: 'Geeschterschlass',
      t_villehaute_d: 'Gëlle Fra, Kathedral an Place Guillaume II duerch d\'Alstad', t_geeschterschlass_d: 'En ale Schlass am Niwwel: Kierfecht, Käerbessen a Fliedermais',
      cup_letzebuerg: 'Lëtzebuerg Cup', cup_fantasy: 'Fantasy Cup',
      lap: 'Ronn', place: 'Plaz', time: 'Zäit', best: 'Beschte', speed: 'km/h', go: 'LASS!', wrong: 'Falsch Richtung!', lastlap: 'Lescht Ronn!', newbest: 'Nei Bestzäit!',
      item_oil: 'Uelleg', item_orb: 'Kugel', item_rocket: 'Rakéit', item_shield: 'Schëld', item_boost: 'Turbo', item_boost3: '3× Turbo', item_comet: 'Komet',
      cometWarn: 'Komet kënnt!', rocketStart: 'Rakéitestart!',
      pause: 'Paus', resume: 'Weiderfueren', restart: 'Nei starten', quit: 'Zréck an de Menü', quality: 'Qualitéit', q_auto: 'Auto', q_low: 'Niddreg', q_medium: 'Mëttel', q_high: 'Héich',
      sound: 'Toun', sound_on: 'Toun un', sound_off: 'Toun aus', language: 'Sprooch', reset: 'Zréck op d\'Strooss',
      results: 'Resultat', raceTime: 'Rennzäit', bestLap: 'Beschte Ronn', again: 'Nach eng Kéier', menu: 'Menü', calc: 'Resultater gi berechent…',
      you: 'Du', dnf: 'net fäerdeg',
      controls: 'Pfeiltasten / WASD fueren · Leertaste Drift · E Objet · R Reset · P Paus · C Wieder',
      touchHint: 'Lénks wëschen = steieren',
      btn_drift: 'Drift', btn_item: 'Objet', btn_brake: 'Brems', btn_gas: 'Gas',
      loading: "D'Stad gëtt opgebaut…", engineError: "Den 3D-Motor konnt net starten. Probéier d'Säit nei ze lueden.",
      place1: '1.', fin: 'Am Zil!', hintDrift: 'Halt Drift an dréi: laang drifte gëtt e Turbo.', changeWeather: 'Wieder änneren',
    },
    de: {
      title: 'Kart Lëtzebuerg', tagline: 'Driftе durch die Stadt, schnapp dir die Boxen und gewinne das Rennen.',
      play: 'Rennen', playDesc: 'Solo gegen 7 Bots', gp: 'Grand Prix', gpDesc: '4 Rennen, Punkte', tt: 'Zeitfahren', ttDesc: 'Gegen deinen Geist', online: 'Online', onlineDesc: 'Mit Freunden',
      track: 'Strecke', weather: 'Wetter', difficulty: 'Schwierigkeit', driver: 'Fahrer', laps: 'Runden', start: 'Los!', back: 'Zurück', soon: 'Kommt bald',
      w_random: 'Zufall', w_day: 'Tag', w_sunset: 'Sonnenuntergang', w_night: 'Nacht', w_rain: 'Regen', w_fog: 'Nebel',
      d_easy: 'Leicht', d_normal: 'Mittel', d_hard: 'Schwer',
      t_villehaute: 'Oberstadt', t_geeschterschlass: 'Geisterschloss',
      t_villehaute_d: 'Gëlle Fra, Kathedrale und Place Guillaume II durch die Altstadt', t_geeschterschlass_d: 'Ein altes Schloss im Nebel: Friedhof, Kürbisse und Fledermäuse',
      cup_letzebuerg: 'Luxemburg-Cup', cup_fantasy: 'Fantasy-Cup',
      lap: 'Runde', place: 'Platz', time: 'Zeit', best: 'Beste', speed: 'km/h', go: 'LOS!', wrong: 'Falsche Richtung!', lastlap: 'Letzte Runde!', newbest: 'Neue Bestzeit!',
      item_oil: 'Öl', item_orb: 'Kugel', item_rocket: 'Rakete', item_shield: 'Schild', item_boost: 'Turbo', item_boost3: '3× Turbo', item_comet: 'Komet',
      cometWarn: 'Komet im Anflug!', rocketStart: 'Raketenstart!',
      pause: 'Pause', resume: 'Weiterfahren', restart: 'Neu starten', quit: 'Zurück zum Menü', quality: 'Qualität', q_auto: 'Auto', q_low: 'Niedrig', q_medium: 'Mittel', q_high: 'Hoch',
      sound: 'Ton', sound_on: 'Ton an', sound_off: 'Ton aus', language: 'Sprache', reset: 'Zurück auf die Straße',
      results: 'Ergebnis', raceTime: 'Rennzeit', bestLap: 'Beste Runde', again: 'Noch einmal', menu: 'Menü', calc: 'Ergebnisse werden berechnet…',
      you: 'Du', dnf: 'nicht im Ziel',
      controls: 'Pfeiltasten / WASD fahren · Leertaste Drift · E Item · R Reset · P Pause · C Wetter',
      touchHint: 'Links wischen = lenken',
      btn_drift: 'Drift', btn_item: 'Item', btn_brake: 'Bremse', btn_gas: 'Gas',
      loading: 'Die Stadt wird aufgebaut…', engineError: 'Die 3D-Engine konnte nicht starten. Lade die Seite neu.',
      place1: '1.', fin: 'Im Ziel!', hintDrift: 'Halte Drift und lenke: langes Driften gibt einen Turbo.', changeWeather: 'Wetter ändern',
    },
    en: {
      title: 'Kart Lëtzebuerg', tagline: 'Drift through the city, grab the boxes and win the race.',
      play: 'Race', playDesc: 'Solo against 7 bots', gp: 'Grand Prix', gpDesc: '4 races, points', tt: 'Time trial', ttDesc: 'Against your ghost', online: 'Online', onlineDesc: 'With friends',
      track: 'Track', weather: 'Weather', difficulty: 'Difficulty', driver: 'Driver', laps: 'Laps', start: 'Go!', back: 'Back', soon: 'Coming soon',
      w_random: 'Random', w_day: 'Day', w_sunset: 'Sunset', w_night: 'Night', w_rain: 'Rain', w_fog: 'Fog',
      d_easy: 'Easy', d_normal: 'Normal', d_hard: 'Hard',
      t_villehaute: 'Upper Town', t_geeschterschlass: 'Ghost Castle',
      t_villehaute_d: 'Gëlle Fra, the cathedral and Place Guillaume II through the old town', t_geeschterschlass_d: 'An old castle in the fog: graveyard, pumpkins and bats',
      cup_letzebuerg: 'Luxembourg Cup', cup_fantasy: 'Fantasy Cup',
      lap: 'Lap', place: 'Place', time: 'Time', best: 'Best', speed: 'km/h', go: 'GO!', wrong: 'Wrong way!', lastlap: 'Final lap!', newbest: 'New best!',
      item_oil: 'Oil', item_orb: 'Orb', item_rocket: 'Rocket', item_shield: 'Shield', item_boost: 'Boost', item_boost3: '3× Boost', item_comet: 'Comet',
      cometWarn: 'Comet incoming!', rocketStart: 'Rocket start!',
      pause: 'Pause', resume: 'Resume', restart: 'Restart', quit: 'Back to menu', quality: 'Quality', q_auto: 'Auto', q_low: 'Low', q_medium: 'Medium', q_high: 'High',
      sound: 'Sound', sound_on: 'Sound on', sound_off: 'Sound off', language: 'Language', reset: 'Back on the road',
      results: 'Results', raceTime: 'Race time', bestLap: 'Best lap', again: 'Race again', menu: 'Menu', calc: 'Calculating results…',
      you: 'You', dnf: 'did not finish',
      controls: 'Arrow keys / WASD drive · Space drift · E item · R reset · P pause · C weather',
      touchHint: 'Swipe on the left to steer',
      btn_drift: 'Drift', btn_item: 'Item', btn_brake: 'Brake', btn_gas: 'Gas',
      loading: 'Building the city…', engineError: 'The 3D engine could not start. Reload the page.',
      place1: '1st', fin: 'Finished!', hintDrift: 'Hold drift and steer: long drifts give a boost.', changeWeather: 'Change weather',
    },
  };
  const ON = {
    lb: {
      onlineDesc: 'Bis zu 8 Kärelen', olTitle: 'Online', olName: 'Däin Numm', olCreate: 'Lobby opmaachen', olCreateD: 'Du bass Host a wiels d\'Streck', olJoin: 'Matmaachen', olCode: 'Code vun de Frënn', olQuick: 'Schnellspill', olQuickD: 'Direkt an eng oppen Lobby',
      olHint: 'Bots fëllen déi fräi Plazen. Zum Matspillen brauchs de keen Account.', olBack: 'Zréck',
      lobby: 'Lobby', lbCode: 'Code', lbCopy: 'Link kopéieren', lbCopied: 'Link kopéiert!', lbInvite: 'Frënn invitéieren', lbPlayers: 'Spiller', lbPublic: 'Oppe fir Schnellspill',
      lbReady: 'Prett!', lbNotReady: 'Net méi prett', lbStart: 'Rennen starten', lbLeave: 'Verloossen', lbWaitHost: 'Waart bis den Host d\'Rennen start…', lbWaitReady: 'Waart op déi aner Spiller…',
      lbHost: 'Host', lbBots: 'Bots fëllen op bis 8', lbSolo: 'Nach keen do — d\'Bots fueren mat.',
      pReady: 'prett', pWait: 'net prett', pConn: 'verbënnt…', pSlow: 'Lues Verbindung', pAway: 'ewech',
      nvConnecting: 'Verbindung mam Server…', nvFindLobby: 'Sich eng Lobby…', nvCreating: 'Lobby gëtt opgemaach…', nvJoining: 'Trëtt der Lobby bäi…', nvLinking: 'Verbënnt d\'Spiller…', nvLoading: 'Streck lued… ({n}/{m})', nvStarting: 'Rennen fänkt un…',
      eNoServer: 'Online-Modus ass grad net erreechbar.', eNoRtc: 'Dësen Browser ënnerstëtzt kee Live-Spill (WebRTC).', eNotFound: 'Dës Lobby gëtt et net — oder d\'Rennen huet schonn ugefaangen.', eFull: 'D\'Lobby ass voll.', eLocked: 'D\'Rennen huet schonn ugefaangen.',
      eConn: 'Keng direkt Verbindung méiglech (Firewall oder Netz?).', eHostGone: 'Den Host huet d\'Lobby zougemaach.', eKicked: 'Du goufs aus der Lobby geholl.', eRelayOff: 'Keng direkt Verbindung — Relay ass ausgeschalt.',
      rHostLeft: 'Den Host ass fort. {n} hëlt iwwer.', rEnded: 'De Host ass fort — d\'Rennen ass eriwwer.', rYouNewHost: 'Den Host ass fort. Du féiers d\'Rennen weider.', rLeft: '{n} huet d\'Rennen verlooss.', rLost: 'D\'Verbindung ass ofgebrach.', rAway: 'Du warst ewech — d\'Rennen ass weidergaangen.', rSlow: 'Lues Verbindung',
      waitOthers: 'Waart op déi aner… ({n}/{m} am Zil)', backLobby: 'Zréck an d\'Lobby', friendsTitle: 'Frënn invitéieren', friendsNone: 'Nach keng Frënn. Deel de Link.', friendsSignIn: 'Mell dech op ian.lu un fir Frënn z\'invitéieren — oder deel de Link.', invited: 'Invitéiert', inviteBtn: 'Invitéieren', inviteFail: 'Invitatioun net méiglech — deel de Link.', close: 'Zoumaachen',
      resultsOnline: 'Resultat', rank: 'Plaz',
    },
    de: {
      onlineDesc: 'Bis zu 8 Fahrer', olTitle: 'Online', olName: 'Dein Name', olCreate: 'Lobby erstellen', olCreateD: 'Du bist Host und wählst die Strecke', olJoin: 'Beitreten', olCode: 'Code von Freunden', olQuick: 'Schnellspiel', olQuickD: 'Direkt in eine offene Lobby',
      olHint: 'Bots füllen freie Plätze auf. Zum Mitspielen brauchst du keinen Account.', olBack: 'Zurück',
      lobby: 'Lobby', lbCode: 'Code', lbCopy: 'Link kopieren', lbCopied: 'Link kopiert!', lbInvite: 'Freunde einladen', lbPlayers: 'Spieler', lbPublic: 'Offen für Schnellspiel',
      lbReady: 'Bereit!', lbNotReady: 'Doch nicht bereit', lbStart: 'Rennen starten', lbLeave: 'Verlassen', lbWaitHost: 'Warte, bis der Host das Rennen startet…', lbWaitReady: 'Warte auf die anderen Spieler…',
      lbHost: 'Host', lbBots: 'Bots füllen bis 8 auf', lbSolo: 'Noch niemand da — die Bots fahren mit.',
      pReady: 'bereit', pWait: 'nicht bereit', pConn: 'verbindet…', pSlow: 'Langsame Verbindung', pAway: 'weg',
      nvConnecting: 'Verbinde mit dem Server…', nvFindLobby: 'Suche eine Lobby…', nvCreating: 'Lobby wird erstellt…', nvJoining: 'Trete der Lobby bei…', nvLinking: 'Verbinde die Spieler…', nvLoading: 'Strecke lädt… ({n}/{m})', nvStarting: 'Rennen beginnt…',
      eNoServer: 'Der Online-Modus ist gerade nicht erreichbar.', eNoRtc: 'Dieser Browser unterstützt kein Live-Spiel (WebRTC).', eNotFound: 'Diese Lobby gibt es nicht — oder das Rennen läuft schon.', eFull: 'Die Lobby ist voll.', eLocked: 'Das Rennen hat schon begonnen.',
      eConn: 'Keine direkte Verbindung möglich (Firewall oder Netz?).', eHostGone: 'Der Host hat die Lobby geschlossen.', eKicked: 'Du wurdest aus der Lobby entfernt.', eRelayOff: 'Keine direkte Verbindung — der Relay ist ausgeschaltet.',
      rHostLeft: 'Der Host ist weg. {n} übernimmt.', rEnded: 'Der Host ist weg — das Rennen ist vorbei.', rYouNewHost: 'Der Host ist weg. Du führst das Rennen weiter.', rLeft: '{n} hat das Rennen verlassen.', rLost: 'Die Verbindung ist abgebrochen.', rAway: 'Du warst weg — das Rennen ging weiter.', rSlow: 'Langsame Verbindung',
      waitOthers: 'Warte auf die anderen… ({n}/{m} im Ziel)', backLobby: 'Zurück zur Lobby', friendsTitle: 'Freunde einladen', friendsNone: 'Noch keine Freunde. Teile den Link.', friendsSignIn: 'Melde dich auf ian.lu an, um Freunde einzuladen — oder teile den Link.', invited: 'Eingeladen', inviteBtn: 'Einladen', inviteFail: 'Einladung nicht möglich — teile den Link.', close: 'Schließen',
      resultsOnline: 'Ergebnis', rank: 'Platz',
    },
    en: {
      onlineDesc: 'Up to 8 racers', olTitle: 'Online', olName: 'Your name', olCreate: 'Create lobby', olCreateD: 'You host and pick the track', olJoin: 'Join', olCode: 'Code from a friend', olQuick: 'Quick match', olQuickD: 'Straight into an open lobby',
      olHint: 'Bots fill the empty slots. No account needed to play.', olBack: 'Back',
      lobby: 'Lobby', lbCode: 'Code', lbCopy: 'Copy link', lbCopied: 'Link copied!', lbInvite: 'Invite friends', lbPlayers: 'Players', lbPublic: 'Open for quick match',
      lbReady: 'Ready!', lbNotReady: 'Not ready', lbStart: 'Start race', lbLeave: 'Leave', lbWaitHost: 'Waiting for the host to start the race…', lbWaitReady: 'Waiting for the other players…',
      lbHost: 'Host', lbBots: 'Bots fill up to 8', lbSolo: 'Nobody here yet — the bots race along.',
      pReady: 'ready', pWait: 'not ready', pConn: 'connecting…', pSlow: 'Slow connection', pAway: 'away',
      nvConnecting: 'Connecting to the server…', nvFindLobby: 'Looking for a lobby…', nvCreating: 'Creating the lobby…', nvJoining: 'Joining the lobby…', nvLinking: 'Linking the players…', nvLoading: 'Loading the track… ({n}/{m})', nvStarting: 'Race is starting…',
      eNoServer: 'Online mode is not reachable right now.', eNoRtc: 'This browser does not support live play (WebRTC).', eNotFound: 'That lobby does not exist, or the race has already started.', eFull: 'The lobby is full.', eLocked: 'The race has already started.',
      eConn: 'No direct connection possible (firewall or network?).', eHostGone: 'The host closed the lobby.', eKicked: 'You were removed from the lobby.', eRelayOff: 'No direct connection, and the relay is switched off.',
      rHostLeft: 'The host left. {n} takes over.', rEnded: 'The host left, so the race is over.', rYouNewHost: 'The host left. You are running the race now.', rLeft: '{n} left the race.', rLost: 'The connection dropped.', rAway: 'You were away, the race went on without you.', rSlow: 'Slow connection',
      waitOthers: 'Waiting for the others… ({n}/{m} finished)', backLobby: 'Back to lobby', friendsTitle: 'Invite friends', friendsNone: 'No friends yet. Share the link.', friendsSignIn: 'Sign in on ian.lu to invite friends, or share the link.', invited: 'Invited', inviteBtn: 'Invite', inviteFail: 'Could not invite, share the link instead.', close: 'Close',
      resultsOnline: 'Results', rank: 'Place',
    },
  };
  /* Grand Prix, time trial, records and leaderboards (phase 3) */
  const GP = {
    lb: {
      cup: 'Cup', cupDesc: '{n} Rennen', gpRace: 'Rennen {n}/{m}', gpTable: 'Grand Prix Stand', gpFinal: 'Grand Prix Resultat', gpNext: 'Nächst Rennen', gpWon: 'Grand Prix gewonnen! 🏆', gpRank: 'Du bass {n}. am Grand Prix', gpPts: 'Pkt', gpTotal: 'Total',
      gpPlace: '{n}. Plaz: +{p} Punkten', gpLeave: 'Grand Prix verloossen', gpWins: '{n} GP-Siger',
      ttGhost: 'Däi Geescht', ttNoGhost: 'Nach kee Geescht: fuer eng séier Ronn!', ttAhead: 'virun dem Geescht', ttBehind: 'hannert dem Geescht', ttLaps: 'Rondenzäiten', ttBest: 'Bestzäit',
      newBestLap: 'Nei perséinlech Bestzäit (Ronn)!', newBestRace: 'Nei perséinlech Bestzäit (Rennen)!', yourBest: 'Däi Rekord', bestLapShort: 'Ronn', bestRaceShort: 'Rennen',
      boards: 'Ranglëschten', bdOpen: 'Ranglëscht weisen', bd_lap: 'Beschte Ronn', bd_race: 'Beschte Rennzäit', bd_gp: 'GP-Siger', bdClose: 'Zoumaachen',
      lbMode: 'Modus', lbModeRace: 'Rennen', lbModeGp: 'Grand Prix', lbCup: 'Cup',
    },
    de: {
      cup: 'Cup', cupDesc: '{n} Rennen', gpRace: 'Rennen {n}/{m}', gpTable: 'Grand-Prix-Stand', gpFinal: 'Grand-Prix-Ergebnis', gpNext: 'Nächstes Rennen', gpWon: 'Grand Prix gewonnen! 🏆', gpRank: 'Du bist {n}. im Grand Prix', gpPts: 'Pkt', gpTotal: 'Gesamt',
      gpPlace: '{n}. Platz: +{p} Punkte', gpLeave: 'Grand Prix verlassen', gpWins: '{n} GP-Siege',
      ttGhost: 'Dein Geist', ttNoGhost: 'Noch kein Geist: fahr eine schnelle Runde!', ttAhead: 'vor dem Geist', ttBehind: 'hinter dem Geist', ttLaps: 'Rundenzeiten', ttBest: 'Bestzeit',
      newBestLap: 'Neue persönliche Bestzeit (Runde)!', newBestRace: 'Neue persönliche Bestzeit (Rennen)!', yourBest: 'Däi Rekord', bestLapShort: 'Runde', bestRaceShort: 'Rennen',
      boards: 'Bestenlisten', bdOpen: 'Bestenliste zeigen', bd_lap: 'Beste Runde', bd_race: 'Beste Rennzeit', bd_gp: 'GP-Siege', bdClose: 'Schließen',
      lbMode: 'Modus', lbModeRace: 'Rennen', lbModeGp: 'Grand Prix', lbCup: 'Cup',
    },
    en: {
      cup: 'Cup', cupDesc: '{n} races', gpRace: 'Race {n}/{m}', gpTable: 'Grand Prix standings', gpFinal: 'Grand Prix result', gpNext: 'Next race', gpWon: 'Grand Prix won! 🏆', gpRank: 'You are {n} in the Grand Prix', gpPts: 'pts', gpTotal: 'Total',
      gpPlace: 'Place {n}: +{p} points', gpLeave: 'Leave Grand Prix', gpWins: '{n} GP wins',
      ttGhost: 'Your ghost', ttNoGhost: 'No ghost yet: drive a fast lap!', ttAhead: 'ahead of the ghost', ttBehind: 'behind the ghost', ttLaps: 'Lap times', ttBest: 'Best',
      newBestLap: 'New personal best (lap)!', newBestRace: 'New personal best (race)!', yourBest: 'Your record', bestLapShort: 'Lap', bestRaceShort: 'Race',
      boards: 'Leaderboards', bdOpen: 'Show leaderboard', bd_lap: 'Best lap', bd_race: 'Best race time', bd_gp: 'GP wins', bdClose: 'Close',
      lbMode: 'Mode', lbModeRace: 'Race', lbModeGp: 'Grand Prix', lbCup: 'Cup',
    },
  };
  for (const l in GP) Object.assign(TXT[l], GP[l]);
  for (const l in ON) Object.assign(TXT[l], ON[l]);
  TXT.de.tagline = 'Drifte durch die Stadt, schnapp dir die Boxen und gewinne das Rennen.';
  let lang = 'lb';
  KL.lang = () => lang;
  KL.setLang = (l) => { if (TXT[l]) { lang = l; document.documentElement.lang = l; try { localStorage.setItem('site_lang', l); } catch (e) { /* storage may be blocked */ } } };
  KL.t = (key, vars) => {
    let s = (TXT[lang] && TXT[lang][key]) || TXT.en[key] || key;
    if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
    return s;
  };
  KL.copy = TXT;
  try { const l = localStorage.getItem('site_lang'); if (TXT[l]) lang = l; } catch (e) { /* ignore */ }
  document.documentElement.lang = lang;
})();
