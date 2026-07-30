/* Partyspill — engine.
 *
 * One device, passed around. Nine round archetypes drive all fifteen games
 * (see partyspill-games.js). Everything is local: no account, no network, no
 * storage beyond the player names.
 */
(function () {
  'use strict';

  var C = window.PS_CONTENT, GAMES = window.PS_GAMES;

  var UI = {
    lede: {
      lb: "15 Partyspiller op engem eenzegen Handy. 3 bis 12 Spiller, gitt d'Handy ronderëm. Keng Installatioun, kee Kont.",
      de: "15 Partyspiele auf einem einzigen Handy. 3 bis 12 Spieler, gebt das Handy herum. Keine Installation, kein Konto.",
      en: "15 party games on a single phone. 3 to 12 players, pass it around. No install, no account.",
    },
    players: { lb: "Spiller", de: "Spieler", en: "Players" },
    needMore: { lb: "Dëst Spill brauch op mannst {n} Spiller.", de: "Dieses Spiel braucht mindestens {n} Spieler.", en: "This game needs at least {n} players." },
    start: { lb: "Lass!", de: "Los!", en: "Start" },
    back: { lb: "Zréck", de: "Zurück", en: "Back" },
    next: { lb: "Weider", de: "Weiter", en: "Next" },
    again: { lb: "Nach eng Ronn", de: "Noch eine Runde", en: "Another round" },
    menu: { lb: "Zréck zum Menü", de: "Zurück zum Menü", en: "Back to menu" },
    handTo: { lb: "Gëff d'Handy un", de: "Gib das Handy an", en: "Pass the phone to" },
    tapReveal: { lb: "Tipp fir ze kucken", de: "Tippen zum Ansehen", en: "Tap to reveal" },
    hide: { lb: "Verstopp a weiderginn", de: "Verbergen und weitergeben", en: "Hide and pass on" },
    youAreImpostor: { lb: "Du bass den Impostor", de: "Du bist der Impostor", en: "You are the impostor" },
    impostorHint: { lb: "Du weess d'Wuert net. Dot esou wéi wann.", de: "Du kennst das Wort nicht. Tu so als ob.", en: "You don't know the word. Bluff." },
    blindHint: { lb: "Denk drun: vläicht bass du deen deen d'Wuert net huet.", de: "Denk dran: vielleicht bist du derjenige ohne Wort.", en: "Remember: maybe you're the one without a word." },
    category: { lb: "Kategorie", de: "Kategorie", en: "Category" },
    allSeen: { lb: "Jiddereen huet gekuckt", de: "Alle haben gesehen", en: "Everyone has looked" },
    discuss: { lb: "Elo diskutéieren: jiddereen seet ee Wuert zum Begrëff.", de: "Jetzt diskutieren: jeder sagt ein Wort zum Begriff.", en: "Now discuss: everyone says one word about it." },
    whoImpostor: { lb: "Wien ass den Impostor?", de: "Wer ist der Impostor?", en: "Who is the impostor?" },
    itWas: { lb: "Den Impostor war", de: "Der Impostor war", en: "The impostor was" },
    wordWas: { lb: "D'Wuert war", de: "Das Wort war", en: "The word was" },
    caught: { lb: "Erwëscht! D'Grupp gewënnt.", de: "Erwischt! Die Gruppe gewinnt.", en: "Caught! The group wins." },
    escaped: { lb: "Falsch! Den Impostor gewënnt.", de: "Falsch! Der Impostor gewinnt.", en: "Wrong! The impostor wins." },
    pass: { lb: "Weiderginn", de: "Weitergeben", en: "Pass on" },
    boom: { lb: "💥 Boum!", de: "💥 Bumm!", en: "💥 Boom!" },
    holding: { lb: "hat d'Bomm.", de: "hatte die Bombe.", en: "was holding it." },
    bombHow: { lb: "Sot e Wuert an dëser Kategorie a gitt d'Handy direkt weider.", de: "Sag ein Wort in dieser Kategorie und gib das Handy sofort weiter.", en: "Say a word in this category and pass the phone on straight away." },
    yourTurn: { lb: "Du bass drun", de: "Du bist dran", en: "Your turn" },
    rushHow: { lb: "Nenn esou vill wéi méiglech. Ee Frënd zielt mat.", de: "Nenne so viele wie möglich. Ein Freund zählt mit.", en: "Name as many as you can. A friend counts." },
    counted: { lb: "Gezielt", de: "Gezählt", en: "Counted" },
    done: { lb: "Fäerdeg", de: "Fertig", en: "Done" },
    guess: { lb: "Däi Schätzung", de: "Deine Schätzung", en: "Your estimate" },
    answerWas: { lb: "Richteg Äntwert", de: "Richtige Antwort", en: "Correct answer" },
    closest: { lb: "Am noosten", de: "Am nächsten", en: "Closest" },
    clueFor: { lb: "Däin Hiweis fir", de: "Dein Hinweis für", en: "Your clue for" },
    secretPoint: { lb: "Deen geheime Punkt", de: "Der geheime Punkt", en: "The secret point" },
    giveClue: { lb: "Sot EE Wuert dat dëse Punkt beschreift.", de: "Sag EIN Wort das diesen Punkt beschreibt.", en: "Say ONE word describing this point." },
    guessNow: { lb: "Zitt de Reegler dohin wou der mengt.", de: "Zieht den Regler dahin wo ihr denkt.", en: "Drag the slider to where you think it is." },
    off: { lb: "Ofwäichung", de: "Abweichung", en: "Off by" },
    describeWithout: { lb: "Erklär dëst — ouni dës Wierder:", de: "Erkläre das — ohne diese Wörter:", en: "Describe this — without these words:" },
    correct: { lb: "Richteg", de: "Richtig", en: "Correct" },
    skip: { lb: "Iwwersprangen", de: "Überspringen", en: "Skip" },
    twoHow: { lb: "seet dräi Saachen iwwer sech: zwou stëmmen, eng ass gelunn. D'Grupp rot wéi eng.", de: "sagt drei Dinge über sich: zwei stimmen, eine ist gelogen. Die Gruppe rät welche.", en: "says three things about themselves: two true, one a lie. The group guesses which." },
    reveal: { lb: "Opléisen", de: "Auflösen", en: "Reveal" },
    score: { lb: "Punkten", de: "Punkte", en: "Score" },
    rounds: { lb: "Ronn", de: "Runde", en: "Round" },
  };

  var lang = detectLang();
  var players = loadPlayers();
  var game = null;
  var R = {};
  var ticker = null;

  /* ---------------- helpers ---------------- */

  function detectLang() {
    try { var s = localStorage.getItem('ps_lang'); if (s && UI.lede[s]) return s; } catch (e) {}
    var n = (navigator.language || 'lb').slice(0, 2).toLowerCase();
    return UI.lede[n] ? n : 'lb';
  }
  function t(key, vars) {
    var s = (UI[key] && (UI[key][lang] || UI[key].en)) || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  function tx(obj) { return obj ? (obj[lang] || obj.en || obj.lb) : ''; }
  function $(id) { return document.getElementById(id); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loadPlayers() {
    try { return JSON.parse(localStorage.getItem('ps_players') || '[]'); } catch (e) { return []; }
  }
  function savePlayers() {
    try { localStorage.setItem('ps_players', JSON.stringify(players)); } catch (e) {}
  }
  function stopTimer() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function show(id) {
    ['s-home', 's-players', 's-play'].forEach(function (s) {
      $(s).classList.toggle('on', s === id);
    });
    window.scrollTo(0, 0);
  }

  /* Render a stage from an HTML string, then wire buttons by id. */
  function stage(html, wires) {
    $('stage').innerHTML = html;
    if (wires) Object.keys(wires).forEach(function (id) {
      var el = $(id);
      if (el) el.onclick = wires[id];
    });
  }

  /* ---------------- home ---------------- */

  function renderHome() {
    stopTimer();
    $('lede').textContent = t('lede');
    $('barTitle').textContent = 'Partyspill';
    $('grid').innerHTML = GAMES.map(function (g) {
      return '<button class="tile" data-id="' + g.id + '" style="border-color:' + g.accent + '33">' +
        '<span class="em">' + g.emoji + '</span>' +
        '<span class="nm">' + esc(tx(g.name)) + '</span>' +
        '<span class="tg">' + esc(tx(g.tag)) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call($('grid').children, function (btn) {
      btn.onclick = function () { openSetup(btn.dataset.id); };
    });
    show('s-home');
  }

  /* ---------------- player setup ---------------- */

  function openSetup(id) {
    game = GAMES.filter(function (g) { return g.id === id; })[0];
    document.documentElement.style.setProperty('--accent', game.accent);
    $('pEm').textContent = game.emoji;
    $('pName').textContent = tx(game.name);
    $('pTag').textContent = tx(game.tag);
    $('pStart').textContent = t('start');
    $('pBack').textContent = t('back');
    renderPlayers();
    show('s-players');
  }

  function renderPlayers() {
    $('plist').innerHTML = players.map(function (p, i) {
      return '<span class="chip">' + esc(p) + '<button data-i="' + i + '" aria-label="x">✕</button></span>';
    }).join('') || '<span class="tg" style="color:var(--muted);font-size:13px">—</span>';
    Array.prototype.forEach.call($('plist').querySelectorAll('button'), function (b) {
      b.onclick = function () { players.splice(+b.dataset.i, 1); savePlayers(); renderPlayers(); };
    });
    var ok = players.length >= game.min;
    $('pStart').disabled = !ok;
    $('pWarn').textContent = ok ? '' : t('needMore', { n: game.min });
  }

  function addPlayer() {
    var v = $('pInput').value.trim();
    if (!v || players.length >= 12) return;
    players.push(v);
    savePlayers();
    $('pInput').value = '';
    renderPlayers();
  }

  /* ---------------- round entry ---------------- */

  function startGame() {
    $('gEm').textContent = game.emoji;
    $('gName').textContent = tx(game.name);
    $('barTitle').textContent = tx(game.name);
    R = { scores: {}, round: 0 };
    players.forEach(function (p) { R.scores[p] = 0; });
    show('s-play');
    nextRound();
  }

  function nextRound() {
    stopTimer();
    R.round++;
    ({
      secret: roundSecret, bomb: roundBomb, rush: roundRush, circa: roundCirca,
      prompt: roundPrompt, twotruths: roundTwoTruths, taboo: roundTaboo,
      spectrum: roundSpectrum, quiz: roundQuiz,
    })[game.archetype]();
  }

  function endButtons() {
    return '<button class="btn" id="again">' + t('again') + '</button>' +
           '<button class="btn ghost" id="menu">' + t('menu') + '</button>';
  }
  var endWires = { again: function () { nextRound(); }, menu: function () { stopTimer(); renderHome(); } };

  function scoreboard() {
    var names = Object.keys(R.scores);
    if (!names.length) return '';
    names.sort(function (a, b) { return R.scores[b] - R.scores[a]; });
    return '<div class="card">' + names.map(function (n) {
      return '<div class="score"><span>' + esc(n) + '</span><b>' + R.scores[n] + '</b></div>';
    }).join('') + '</div>';
  }

  /* ---------------- archetype: secret word ---------------- */

  function roundSecret() {
    var group = pick(C.words);
    R.word = pick(group.items);
    R.cat = group.cat;
    R.order = shuffled(players);
    R.impostor = pick(R.order);
    R.idx = 0;
    secretHandOff();
  }

  function secretHandOff() {
    if (R.idx >= R.order.length) return secretDiscuss();
    var who = R.order[R.idx];
    stage(
      '<div class="card"><p class="tiny">' + t('handTo') + '</p>' +
      '<p class="big">' + esc(who) + '</p></div>' +
      '<button class="btn big" id="rev">' + t('tapReveal') + '</button>',
      { rev: secretReveal }
    );
  }

  function secretReveal() {
    var who = R.order[R.idx];
    var isImp = who === R.impostor;
    var body;
    if (isImp && game.impostorKnowsRole) {
      body = '<p class="big">🕵️ ' + t('youAreImpostor') + '</p><p class="tiny">' + t('impostorHint') + '</p>';
    } else if (isImp) {
      // Guess What: the impostor is not told — they just get no word.
      body = '<p class="big">…</p><p class="tiny">' + t('blindHint') + '</p>';
    } else {
      body = '<p class="tiny">' + t('category') + ': ' + esc(tx(R.cat)) + '</p>' +
             '<p class="big">' + esc(tx(R.word)) + '</p>';
    }
    stage('<div class="card">' + body + '</div>' +
          '<button class="btn" id="hide">' + t('hide') + '</button>',
      { hide: function () { R.idx++; secretHandOff(); } });
  }

  function secretDiscuss() {
    var timed = game.roundSeconds > 0;
    stage(
      '<div class="card"><p class="mid">' + t('allSeen') + '</p>' +
      '<p class="tiny" style="margin-top:10px">' + t('discuss') + '</p>' +
      (timed ? '<p class="timer" id="clock">' + game.roundSeconds + '</p>' : '') +
      '</div><button class="btn" id="vote">' + t('whoImpostor') + '</button>',
      { vote: secretVote }
    );
    if (timed) countdown(game.roundSeconds, $('clock'), secretVote);
  }

  function secretVote() {
    stopTimer();
    stage('<p class="sub">' + t('whoImpostor') + '</p><div class="choices">' +
      players.map(function (p) {
        return '<button class="choice" data-p="' + esc(p) + '">' + esc(p) + '</button>';
      }).join('') + '</div>',
      null);
    Array.prototype.forEach.call($('stage').querySelectorAll('.choice'), function (b) {
      b.onclick = function () { secretResult(b.dataset.p); };
    });
  }

  function secretResult(votedFor) {
    var caught = votedFor === R.impostor;
    if (caught) {
      players.forEach(function (p) { if (p !== R.impostor) R.scores[p] += 1; });
    } else {
      R.scores[R.impostor] += 2;
    }
    stage(
      '<div class="card">' +
      '<p class="big">' + (caught ? '✅ ' : '❌ ') + t(caught ? 'caught' : 'escaped') + '</p>' +
      '<p class="tiny">' + t('itWas') + ': <b>' + esc(R.impostor) + '</b></p>' +
      '<p class="tiny">' + t('wordWas') + ': <b>' + esc(tx(R.word)) + '</b></p></div>' +
      scoreboard() + endButtons(), endWires);
  }

  /* ---------------- archetype: bomb ---------------- */

  function roundBomb() {
    R.cat = pick(C.categories);
    R.order = shuffled(players);
    R.idx = 0;
    R.fuse = game.minSeconds + Math.random() * (game.maxSeconds - game.minSeconds);
    R.deadline = Date.now() + R.fuse * 1000;
    bombTurn();
    ticker = setInterval(function () {
      if (Date.now() >= R.deadline) bombBoom();
    }, 200);
  }

  function bombTurn() {
    var who = R.order[R.idx % R.order.length];
    stage(
      '<div class="card"><p class="tiny">' + t('category') + '</p>' +
      '<p class="big">' + esc(tx(R.cat)) + '</p>' +
      '<p class="tiny">' + t('bombHow') + '</p></div>' +
      '<div class="card"><p class="mid">' + t('yourTurn') + ': ' + esc(who) + '</p></div>' +
      '<button class="btn big" id="pass">💣 ' + t('pass') + '</button>',
      { pass: function () { R.idx++; bombTurn(); } }
    );
  }

  function bombBoom() {
    stopTimer();
    var loser = R.order[R.idx % R.order.length];
    players.forEach(function (p) { if (p !== loser) R.scores[p] += 1; });
    stage('<div class="card"><p class="big">' + t('boom') + '</p>' +
      '<p class="mid">' + esc(loser) + ' ' + t('holding') + '</p></div>' +
      scoreboard() + endButtons(), endWires);
  }

  /* ---------------- archetype: word rush ---------------- */

  function roundRush() {
    R.cat = pick(C.categories);
    R.who = players[(R.round - 1) % players.length];
    R.count = 0;
    stage(
      '<div class="card"><p class="tiny">' + t('handTo') + '</p>' +
      '<p class="big">' + esc(R.who) + '</p>' +
      '<p class="tiny">' + t('rushHow') + '</p></div>' +
      '<button class="btn big" id="go">' + t('start') + '</button>',
      { go: rushRun });
  }

  function rushRun() {
    stage(
      '<div class="card"><p class="tiny">' + t('category') + '</p>' +
      '<p class="big">' + esc(tx(R.cat)) + '</p>' +
      '<p class="timer" id="clock">' + game.seconds + '</p></div>' +
      '<div class="card"><p class="big" id="cnt">0</p><p class="tiny">' + t('counted') + '</p></div>' +
      '<button class="btn big" id="plus">+1</button>',
      { plus: function () { R.count++; $('cnt').textContent = R.count; } }
    );
    countdown(game.seconds, $('clock'), rushDone);
  }

  function rushDone() {
    stopTimer();
    R.scores[R.who] += R.count;
    stage('<div class="card"><p class="tiny">' + esc(R.who) + '</p>' +
      '<p class="big">' + R.count + '</p><p class="tiny">' + t('counted') + '</p></div>' +
      scoreboard() + endButtons(), endWires);
  }

  /* ---------------- archetype: circa ---------------- */

  function roundCirca() {
    R.item = pick(C.circa);
    R.order = shuffled(players);
    R.idx = 0;
    R.guesses = {};
    circaAsk();
  }

  function circaAsk() {
    if (R.idx >= R.order.length) return circaResult();
    var who = R.order[R.idx];
    stage(
      '<div class="card"><p class="tiny">' + t('handTo') + ': <b>' + esc(who) + '</b></p>' +
      '<p class="mid" style="margin-top:12px">' + esc(tx(R.item.q)) + '</p></div>' +
      '<div class="card"><p class="tiny">' + t('guess') + '</p>' +
      '<input type="number" id="g" inputmode="numeric"></div>' +
      '<button class="btn" id="ok">' + t('next') + '</button>',
      { ok: function () {
          var v = parseFloat($('g').value);
          if (isNaN(v)) return;
          R.guesses[who] = v; R.idx++; circaAsk();
        } }
    );
    $('g').focus();
  }

  function circaResult() {
    var best = null, bestDiff = Infinity;
    Object.keys(R.guesses).forEach(function (p) {
      var d = Math.abs(R.guesses[p] - R.item.a);
      if (d < bestDiff) { bestDiff = d; best = p; }
    });
    if (best) R.scores[best] += 2;
    var rows = Object.keys(R.guesses).sort(function (a, b) {
      return Math.abs(R.guesses[a] - R.item.a) - Math.abs(R.guesses[b] - R.item.a);
    }).map(function (p) {
      return '<div class="score"><span>' + esc(p) + '</span><b>' + R.guesses[p] + '</b></div>';
    }).join('');
    stage('<div class="card"><p class="tiny">' + t('answerWas') + '</p>' +
      '<p class="big">' + R.item.a.toLocaleString() + '</p>' +
      '<p class="tiny">' + t('closest') + ': <b>' + esc(best || '—') + '</b></p></div>' +
      '<div class="card">' + rows + '</div>' + scoreboard() + endButtons(), endWires);
  }

  /* ---------------- archetype: prompt cards ---------------- */

  function roundPrompt() {
    var item = pick(C[game.bank]);
    var text = tx(item);
    if (game.prefix) text = tx(game.prefix) + ' ' + text;
    stage(
      '<div class="card"><p class="big">' + esc(text) + '</p></div>' +
      '<div class="card"><p class="tiny">' + esc(tx(game.how)) + '</p></div>' +
      '<button class="btn" id="again">' + t('next') + '</button>' +
      '<button class="btn ghost" id="menu">' + t('menu') + '</button>', endWires);
  }

  /* ---------------- archetype: two truths ---------------- */

  function roundTwoTruths() {
    R.who = players[(R.round - 1) % players.length];
    stage(
      '<div class="card"><p class="big">' + esc(R.who) + '</p>' +
      '<p class="tiny">' + t('twoHow') + '</p></div>' +
      '<button class="btn" id="rev">' + t('reveal') + '</button>',
      { rev: function () {
          stage('<div class="card"><p class="mid">' + esc(R.who) + '</p>' +
            '<p class="tiny">' + t('twoHow') + '</p></div>' + endButtons(), endWires);
        } });
  }

  /* ---------------- archetype: taboo ---------------- */

  function roundTaboo() {
    R.card = pick(C.taboo);
    R.who = players[(R.round - 1) % players.length];
    R.count = 0;
    stage(
      '<div class="card"><p class="tiny">' + t('handTo') + '</p>' +
      '<p class="big">' + esc(R.who) + '</p></div>' +
      '<button class="btn big" id="go">' + t('start') + '</button>', { go: tabooRun });
  }

  function tabooRun() {
    stage(
      '<div class="card"><p class="tiny">' + t('describeWithout') + '</p>' +
      '<p class="big">' + esc(tx(R.card.word)) + '</p>' +
      '<div class="banned">' + R.card.ban.map(function (b) {
        return '<span>' + esc(tx(b)) + '</span>';
      }).join('') + '</div></div>' +
      '<div class="card"><p class="timer" id="clock">' + game.seconds + '</p></div>' +
      '<div class="row"><button class="btn" id="ok">✅ ' + t('correct') + '</button>' +
      '<button class="btn ghost" id="skip">' + t('skip') + '</button></div>',
      { ok: function () { R.count++; nextTabooCard(); },
        skip: nextTabooCard }
    );
    countdown(game.seconds, $('clock'), tabooDone);
  }

  function nextTabooCard() {
    R.card = pick(C.taboo);
    var el = $('stage');
    el.querySelector('.big').textContent = tx(R.card.word);
    el.querySelector('.banned').innerHTML = R.card.ban.map(function (b) {
      return '<span>' + esc(tx(b)) + '</span>';
    }).join('');
  }

  function tabooDone() {
    stopTimer();
    R.scores[R.who] += R.count;
    stage('<div class="card"><p class="tiny">' + esc(R.who) + '</p>' +
      '<p class="big">' + R.count + '</p><p class="tiny">' + t('correct') + '</p></div>' +
      scoreboard() + endButtons(), endWires);
  }

  /* ---------------- archetype: spectrum ---------------- */

  function roundSpectrum() {
    R.pair = pick(C.spectrum);
    R.target = Math.floor(Math.random() * 101);
    R.who = players[(R.round - 1) % players.length];
    stage(
      '<div class="card"><p class="tiny">' + t('handTo') + '</p>' +
      '<p class="big">' + esc(R.who) + '</p></div>' +
      '<button class="btn big" id="rev">' + t('tapReveal') + '</button>',
      { rev: spectrumClue });
  }

  function spectrumClue() {
    stage(
      '<div class="card"><p class="tiny">' + t('clueFor') + '</p>' +
      '<div class="poles"><span>' + esc(tx(R.pair.a)) + '</span><span>' + esc(tx(R.pair.b)) + '</span></div>' +
      '<input type="range" min="0" max="100" value="' + R.target + '" disabled>' +
      '<p class="tiny">' + t('secretPoint') + ': <b>' + R.target + '%</b></p>' +
      '<p class="tiny" style="margin-top:10px">' + t('giveClue') + '</p></div>' +
      '<button class="btn" id="go">' + t('hide') + '</button>', { go: spectrumGuess });
  }

  function spectrumGuess() {
    stage(
      '<div class="card"><p class="tiny">' + t('guessNow') + '</p>' +
      '<div class="poles"><span>' + esc(tx(R.pair.a)) + '</span><span>' + esc(tx(R.pair.b)) + '</span></div>' +
      '<input type="range" min="0" max="100" value="50" id="sl"></div>' +
      '<button class="btn" id="ok">' + t('reveal') + '</button>',
      { ok: function () {
          var g = +$('sl').value, off = Math.abs(g - R.target);
          var pts = off <= 5 ? 4 : off <= 12 ? 3 : off <= 25 ? 2 : off <= 40 ? 1 : 0;
          R.scores[R.who] += pts;
          stage('<div class="card"><p class="tiny">' + t('secretPoint') + '</p>' +
            '<p class="big">' + R.target + '%</p>' +
            '<p class="tiny">' + t('off') + ': <b>' + off + '</b> · +' + pts + ' ' + t('score') + '</p></div>' +
            scoreboard() + endButtons(), endWires);
        } });
  }

  /* ---------------- archetype: quiz ---------------- */

  function roundQuiz() {
    var q = pick(C.quiz);
    R.q = q;
    stage('<div class="card"><p class="mid">' + esc(tx(q.q)) + '</p></div>' +
      '<div class="choices">' + q.o.map(function (o, i) {
        return '<button class="choice" data-i="' + i + '">' + esc(tx(o)) + '</button>';
      }).join('') + '</div>');
    Array.prototype.forEach.call($('stage').querySelectorAll('.choice'), function (b) {
      b.onclick = function () {
        var i = +b.dataset.i;
        Array.prototype.forEach.call($('stage').querySelectorAll('.choice'), function (x, xi) {
          // classList.add('') throws, so only add a class when there is one.
          if (xi === R.q.c) x.classList.add('right');
          else if (xi === i) x.classList.add('wrong');
          x.onclick = null;
        });
        $('stage').insertAdjacentHTML('beforeend', endButtons());
        $('again').onclick = endWires.again;
        $('menu').onclick = endWires.menu;
      };
    });
  }

  /* ---------------- shared countdown ---------------- */

  function countdown(seconds, el, onEnd) {
    stopTimer();
    var left = seconds;
    el.textContent = left;
    ticker = setInterval(function () {
      left--;
      if (el) {
        el.textContent = left;
        el.classList.toggle('low', left <= 5);
      }
      if (left <= 0) { stopTimer(); onEnd(); }
    }, 1000);
  }

  /* ---------------- boot ---------------- */

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('ps_lang', l); } catch (e) {}
    document.documentElement.lang = l;
    Array.prototype.forEach.call($('langs').children, function (b) {
      b.classList.toggle('on', b.dataset.l === l);
    });
    renderHome();
  }

  Array.prototype.forEach.call($('langs').children, function (b) {
    b.onclick = function () { setLang(b.dataset.l); };
  });
  $('pAdd').onclick = addPlayer;
  $('pInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') addPlayer(); });
  $('pStart').onclick = startGame;
  $('pBack').onclick = renderHome;

  setLang(lang);
})();
