/* Quizbrett — a host-driven quiz-show board.
 *
 * 5 categories x 5 point values. The host picks a bank and team names, then
 * drives the whole thing from one phone: tap a cell, read the clue aloud, show
 * the answer, award or deduct the points. One cell per game is a double.
 *
 * Everything is local — no account, no network, no storage.
 */
(function () {
  'use strict';

  var BANKS = window.JQ_BANKS;
  var VALUES = [100, 200, 300, 400, 500];
  var MAX_TEAMS = 6, MIN_TEAMS = 2;

  var UI = {
    pickBank: { lb: "Wiel e Fragenset", de: "Wähle ein Fragenset", en: "Pick a question set" },
    pickBankSub: { lb: "5 Kategorien, 5 Punktewäerter — 25 Froen pro Spill.",
                   de: "5 Kategorien, 5 Punktewerte — 25 Fragen pro Spiel.",
                   en: "5 categories, 5 point values — 25 clues per game." },
    teams: { lb: "Equipen", de: "Teams", en: "Teams" },
    teamsSub: { lb: "2 bis 6 Equipen. Ee Handy geneicht — du steiers alles.",
                de: "2 bis 6 Teams. Ein Handy genügt — du steuerst alles.",
                en: "2 to 6 teams. One phone is enough — you drive it all." },
    teamName: { lb: "Numm vun der Equipe", de: "Teamname", en: "Team name" },
    needTeams: { lb: "Op mannst {n} Equipen.", de: "Mindestens {n} Teams.", en: "At least {n} teams." },
    start: { lb: "Spill starten", de: "Spiel starten", en: "Start game" },
    cats: { lb: "Kategorien", de: "Kategorien", en: "Categories" },
    showAnswer: { lb: "Äntwert weisen", de: "Antwort zeigen", en: "Show answer" },
    whoGot: { lb: "Wien hat se richteg?", de: "Wer hatte sie richtig?", en: "Who got it right?" },
    nobody: { lb: "Keen — keng Punkten", de: "Niemand — keine Punkte", en: "Nobody — no points" },
    minus: { lb: "−{v} fir", de: "−{v} für", en: "−{v} for" },
    double: { lb: "★ Duebel Punkten ★", de: "★ Doppelte Punkte ★", en: "★ Double points ★" },
    back: { lb: "Zréck zum Brett", de: "Zurück zum Brett", en: "Back to the board" },
    quit: { lb: "Spill ofbrechen", de: "Spiel abbrechen", en: "End game" },
    done: { lb: "Alles gespillt!", de: "Alles gespielt!", en: "Board cleared!" },
    winner: { lb: "Gewënner", de: "Gewinner", en: "Winner" },
    draw: { lb: "Gläichstand!", de: "Gleichstand!", en: "It's a tie!" },
    again: { lb: "Nach eng Ronn", de: "Noch eine Runde", en: "Play again" },
    menu: { lb: "Zréck zum Ufank", de: "Zurück zum Anfang", en: "Back to start" },
    hintAward: { lb: "Falsch geroden? Zéi d'Punkten of.", de: "Falsch geraten? Punkte abziehen.",
                 en: "Guessed wrong? Deduct the points." },
  };

  var lang = detectLang();
  var bank = BANKS[0];
  var teams = [];
  var scores = {};
  var used = {};          // "cat,row" -> true
  var doubleCell = null;  // "cat,row"
  var openCell = null;

  /* ---------------- helpers ---------------- */

  function detectLang() {
    try { var s = localStorage.getItem('qb_lang'); if (s && UI.start[s]) return s; } catch (e) {}
    var n = (navigator.language || 'lb').slice(0, 2).toLowerCase();
    return UI.start[n] ? n : 'lb';
  }
  function t(k, vars) {
    var s = (UI[k] && (UI[k][lang] || UI[k].en)) || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.replace('{' + v + '}', vars[v]); });
    return s;
  }
  function tx(o) { return o ? (o[lang] || o.en || o.lb) : ''; }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(id) {
    ['s-setup', 's-board', 's-clue', 's-end'].forEach(function (s) {
      $(s).classList.toggle('on', s === id);
    });
    window.scrollTo(0, 0);
  }
  function loadTeams() {
    try { return JSON.parse(localStorage.getItem('qb_teams') || '[]'); } catch (e) { return []; }
  }
  function saveTeams() {
    try { localStorage.setItem('qb_teams', JSON.stringify(teams)); } catch (e) {}
  }

  /* ---------------- setup ---------------- */

  function renderSetup() {
    $('tBank').textContent = t('pickBank');
    $('tBankSub').textContent = t('pickBankSub');
    $('tTeams').textContent = t('teams');
    $('tTeamsSub').textContent = t('teamsSub');
    $('tInput').placeholder = t('teamName');
    $('start').textContent = t('start');
    $('quit').textContent = t('quit');

    $('banks').innerHTML = BANKS.map(function (b) {
      var names = b.cats.map(function (c) { return tx(c.name); }).join(' · ');
      return '<button class="bank" data-id="' + b.id + '" aria-pressed="' + (b.id === bank.id) + '">' +
        '<b>' + esc(tx(b.name)) + '</b><span>' + esc(names) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call($('banks').children, function (el) {
      el.onclick = function () {
        bank = BANKS.filter(function (b) { return b.id === el.dataset.id; })[0];
        renderSetup();
      };
    });

    renderChips();
    show('s-setup');
  }

  function renderChips() {
    $('chips').innerHTML = teams.map(function (n, i) {
      return '<span class="chip">' + esc(n) + '<button data-i="' + i + '" aria-label="x">✕</button></span>';
    }).join('');
    Array.prototype.forEach.call($('chips').querySelectorAll('button'), function (b) {
      b.onclick = function () { teams.splice(+b.dataset.i, 1); saveTeams(); renderChips(); };
    });
    var ok = teams.length >= MIN_TEAMS;
    $('start').disabled = !ok;
    $('tWarn').textContent = ok ? '' : t('needTeams', { n: MIN_TEAMS });
  }

  function addTeam() {
    var v = $('tInput').value.trim();
    if (!v || teams.length >= MAX_TEAMS) return;
    teams.push(v);
    saveTeams();
    $('tInput').value = '';
    renderChips();
  }

  /* ---------------- game ---------------- */

  function startGame() {
    scores = {};
    teams.forEach(function (n) { scores[n] = 0; });
    used = {};
    // One random cell per game is worth double.
    doubleCell = Math.floor(Math.random() * 5) + ',' + Math.floor(Math.random() * 5);
    renderBoard();
  }

  function renderBoard() {
    var html = bank.cats.map(function (c) {
      return '<div class="cat">' + esc(tx(c.name)) + '</div>';
    }).join('');
    for (var row = 0; row < VALUES.length; row++) {
      for (var col = 0; col < bank.cats.length; col++) {
        var key = col + ',' + row;
        var gone = !!used[key];
        html += '<button class="cellbtn" data-k="' + key + '"' + (gone ? ' disabled' : '') + '>' +
                (gone ? '·' : VALUES[row]) + '</button>';
      }
    }
    $('board').innerHTML = html;
    Array.prototype.forEach.call($('board').querySelectorAll('.cellbtn'), function (b) {
      if (b.disabled) return;
      b.onclick = function () { openClue(b.dataset.k); };
    });
    renderScores();
    show('s-board');

    if (Object.keys(used).length === bank.cats.length * VALUES.length) endGame();
  }

  function renderScores() {
    $('scores').innerHTML = teams.map(function (n) {
      var v = scores[n];
      return '<div class="sc' + (v < 0 ? ' neg' : '') + '">' + esc(n) + '<b>' + v + '</b></div>';
    }).join('');
  }

  function valueOf(key) {
    var row = +key.split(',')[1];
    return VALUES[row] * (key === doubleCell ? 2 : 1);
  }

  function openClue(key) {
    openCell = key;
    var parts = key.split(',');
    var clue = bank.cats[+parts[0]].clues[+parts[1]];
    var val = valueOf(key);
    $('clue').innerHTML =
      '<p class="val">' + esc(tx(bank.cats[+parts[0]].name)) + ' · ' + val + '</p>' +
      (key === doubleCell ? '<p class="dd">' + t('double') + '</p>' : '') +
      '<p class="q">' + esc(tx(clue.q)) + '</p>' +
      '<button class="btn" id="reveal">' + t('showAnswer') + '</button>';
    $('reveal').onclick = function () { revealAnswer(key, clue, val); };
    show('s-clue');
  }

  function revealAnswer(key, clue, val) {
    var who = teams.map(function (n) {
      return '<button data-n="' + esc(n) + '" data-d="1">+' + val + ' — ' + esc(n) + '</button>';
    }).join('') +
    teams.map(function (n) {
      return '<button class="minus" data-n="' + esc(n) + '" data-d="-1">' +
             t('minus', { v: val }) + ' ' + esc(n) + '</button>';
    }).join('') +
    '<button data-n="" data-d="0">' + t('nobody') + '</button>';

    $('clue').innerHTML =
      '<p class="val">' + val + '</p>' +
      '<p class="q">' + esc(tx(clue.q)) + '</p>' +
      '<p class="a">' + esc(tx(clue.a)) + '</p>' +
      '<p class="val">' + t('whoGot') + '</p>' +
      '<div class="who">' + who + '</div>' +
      '<p class="hint">' + t('hintAward') + '</p>';

    Array.prototype.forEach.call($('clue').querySelectorAll('.who button'), function (b) {
      b.onclick = function () {
        var n = b.dataset.n, d = +b.dataset.d;
        if (n && d) scores[n] += val * d;
        used[key] = true;
        openCell = null;
        renderBoard();
      };
    });
  }

  function endGame() {
    var best = -Infinity, winners = [];
    teams.forEach(function (n) {
      if (scores[n] > best) { best = scores[n]; winners = [n]; }
      else if (scores[n] === best) winners.push(n);
    });
    var order = teams.slice().sort(function (a, b) { return scores[b] - scores[a]; });
    $('final').innerHTML =
      '<p class="val">' + t('done') + '</p>' +
      '<p class="win">' + (winners.length > 1 ? t('draw') : esc(winners[0]) ) + '</p>' +
      (winners.length > 1 ? '<p class="val">' + winners.map(esc).join(' · ') + '</p>' : '') +
      '<div class="scores" style="justify-content:center">' + order.map(function (n) {
        return '<div class="sc' + (scores[n] < 0 ? ' neg' : '') + '">' + esc(n) +
               '<b>' + scores[n] + '</b></div>';
      }).join('') + '</div>' +
      '<button class="btn" id="again">' + t('again') + '</button>' +
      '<button class="btn ghost" id="menu">' + t('menu') + '</button>';
    $('again').onclick = startGame;
    $('menu').onclick = renderSetup;
    show('s-end');
  }

  /* ---------------- boot ---------------- */

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('qb_lang', l); } catch (e) {}
    document.documentElement.lang = l;
    Array.prototype.forEach.call($('langs').children, function (b) {
      b.classList.toggle('on', b.dataset.l === l);
    });
    // Re-render whatever is on screen so the switch takes effect immediately.
    if ($('s-clue').classList.contains('on') && openCell) openClue(openCell);
    else if ($('s-board').classList.contains('on')) renderBoard();
    else if ($('s-end').classList.contains('on')) endGame();
    else renderSetup();
  }

  Array.prototype.forEach.call($('langs').children, function (b) {
    b.onclick = function () { setLang(b.dataset.l); };
  });
  $('tAdd').onclick = addTeam;
  $('tInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTeam(); });
  $('start').onclick = startGame;
  $('quit').onclick = renderSetup;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('s-clue').classList.contains('on')) renderBoard();
  });

  teams = loadTeams();
  setLang(lang);
})();
