/* Jeopardy — engine: theme, category picking, the board, and play.
 * Custom categories and the Word export live in jeopardy-edit.js.
 */
(function () {
  'use strict';

  var POOL = window.JQ_CATEGORIES, TOPICS = window.JQ_TOPICS, ED = window.JQ_EDIT;
  var VALUES = [100, 200, 300, 400, 500];
  var PICK = 5, MIN_TEAMS = 2, MAX_TEAMS = 6;
  var THEMES = ['classic', 'forest', 'crimson', 'paper'];

  var UI = {
    theme: { lb: "Theme", de: "Theme", en: "Theme" },
    pick: { lb: "Kategorien", de: "Kategorien", en: "Categories" },
    pickSub: { lb: "Wiel genau {n} aus {t}. Tipp fir un- an ofzewielen.",
               de: "Wähle genau {n} von {t}. Tippen zum An- und Abwählen.",
               en: "Pick exactly {n} of {t}. Tap to select and deselect." },
    teams: { lb: "Equipen", de: "Teams", en: "Teams" },
    teamName: { lb: "Numm vun der Equipe", de: "Teamname", en: "Team name" },
    need: { lb: "Wiel {n} Kategorien an op mannst {m} Equipen.",
            de: "Wähle {n} Kategorien und mindestens {m} Teams.",
            en: "Pick {n} categories and at least {m} teams." },
    start: { lb: "Spill starten", de: "Spiel starten", en: "Start game" },
    edit: { lb: "✎ Eege Kategorien", de: "✎ Eigene Kategorien", en: "✎ Your categories" },
    word: { lb: "⬇ Als Word", de: "⬇ Als Word", en: "⬇ To Word" },
    showAnswer: { lb: "Äntwert weisen", de: "Antwort zeigen", en: "Show answer" },
    whoGot: { lb: "Wien hat se richteg?", de: "Wer hatte sie richtig?", en: "Who got it right?" },
    nobody: { lb: "Keen — keng Punkten", de: "Niemand — keine Punkte", en: "Nobody — no points" },
    minus: { lb: "−{v} fir", de: "−{v} für", en: "−{v} for" },
    double: { lb: "★ Duebel Punkten ★", de: "★ Doppelte Punkte ★", en: "★ Double points ★" },
    quit: { lb: "Spill ofbrechen", de: "Spiel abbrechen", en: "End game" },
    done: { lb: "Alles gespillt!", de: "Alles gespielt!", en: "Board cleared!" },
    draw: { lb: "Gläichstand!", de: "Gleichstand!", en: "It's a tie!" },
    again: { lb: "Nach eng Ronn", de: "Noch eine Runde", en: "Play again" },
    menu: { lb: "Zréck zum Ufank", de: "Zurück zum Anfang", en: "Back to start" },
    hintAward: { lb: "Falsch geroden? Zéi d'Punkten of.", de: "Falsch geraten? Punkte abziehen.",
                 en: "Guessed wrong? Deduct the points." },
    editT: { lb: "Eege Kategorien", de: "Eigene Kategorien", en: "Your own categories" },
    editSub: { lb: "Eng Kategorie huet genau 5 Froen — eng pro Punktewäert. Alles bleift nëmmen an dësem Browser.",
               de: "Eine Kategorie hat genau 5 Fragen — eine pro Punktewert. Alles bleibt nur in diesem Browser.",
               en: "A category has exactly 5 clues — one per point value. Everything stays in this browser only." },
    catName: { lb: "Numm vun der Kategorie", de: "Name der Kategorie", en: "Category name" },
    question: { lb: "Fro", de: "Frage", en: "Clue" },
    answer: { lb: "Äntwert", de: "Antwort", en: "Answer" },
    saveCat: { lb: "Kategorie späicheren", de: "Kategorie speichern", en: "Save category" },
    newCat: { lb: "+ Nei Kategorie", de: "+ Neue Kategorie", en: "+ New category" },
    noneYet: { lb: "Nach keng eege Kategorien.", de: "Noch keine eigenen Kategorien.", en: "No custom categories yet." },
    fillAll: { lb: "Fëll den Numm an all 5 Froen an Äntwerten aus.",
               de: "Fülle den Namen und alle 5 Fragen und Antworten aus.",
               en: "Fill in the name and all 5 clues and answers." },
    back: { lb: "Zréck", de: "Zurück", en: "Back" },
    expJson: { lb: "⬇ JSON", de: "⬇ JSON", en: "⬇ JSON" },
    impJson: { lb: "⬆ JSON", de: "⬆ JSON", en: "⬆ JSON" },
    imported: { lb: "{n} Kategorien importéiert.", de: "{n} Kategorien importiert.", en: "Imported {n} categories." },
    badJson: { lb: "Datei konnt net gelies ginn.", de: "Datei konnte nicht gelesen werden.", en: "Could not read that file." },
    needFive: { lb: "Wiel genau {n} Kategorien fir den Export.",
                de: "Wähle genau {n} Kategorien für den Export.",
                en: "Pick exactly {n} categories to export." },
    wordTitle: { lb: "Jeopardy — Spillbrett", de: "Jeopardy — Spielbrett", en: "Jeopardy — Game board" },
    wordSub: { lb: "Brett zum Ausdrécken, dono d'Léisungen pro Kategorie.",
               de: "Brett zum Ausdrucken, danach die Lösungen pro Kategorie.",
               en: "Board to print, then the answer key per category." },
    wordBoard: { lb: "Spillbrett", de: "Spielbrett", en: "Game board" },
  };

  var lang = detect(), theme = loadTheme();
  var picked = [], teams = loadTeams();
  var scores = {}, used = {}, doubleCell = null, openCell = null, board = [];
  var editing = null;

  function detect() {
    try { var s = localStorage.getItem('jq_lang'); if (s && UI.start[s]) return s; } catch (e) {}
    var n = (navigator.language || 'lb').slice(0, 2).toLowerCase();
    return UI.start[n] ? n : 'lb';
  }
  function loadTheme() {
    try { var t = localStorage.getItem('jq_theme'); if (THEMES.indexOf(t) >= 0) return t; } catch (e) {}
    return 'classic';
  }
  function loadTeams() {
    try { return JSON.parse(localStorage.getItem('jq_teams') || '[]'); } catch (e) { return []; }
  }
  function saveTeams() { try { localStorage.setItem('jq_teams', JSON.stringify(teams)); } catch (e) {} }

  function t(k, v) {
    var s = (UI[k] && (UI[k][lang] || UI[k].en)) || k;
    if (v) Object.keys(v).forEach(function (x) { s = s.replace('{' + x + '}', v[x]); });
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
    ['s-setup', 's-board', 's-clue', 's-end', 's-edit'].forEach(function (s) {
      $(s).classList.toggle('on', s === id);
    });
    window.scrollTo(0, 0);
  }
  function allCats() { return POOL.concat(ED.all()); }

  /* ---------------- setup ---------------- */

  function renderSetup() {
    $('tTheme').textContent = t('theme');
    $('tPick').textContent = t('pick');
    $('tTeams').textContent = t('teams');
    $('tInput').placeholder = t('teamName');
    $('start').textContent = t('start');
    $('toEdit').textContent = t('edit');
    $('toWord').textContent = t('word');
    $('quit').textContent = t('quit');

    var cats = allCats();
    $('tPickSub').textContent = t('pickSub', { n: PICK, t: cats.length });

    $('themes').innerHTML = THEMES.map(function (th) {
      return '<button class="th" data-t="' + th + '" aria-pressed="' + (th === theme) +
             '" style="background:' + themeSwatch(th) + '" aria-label="' + th + '"></button>';
    }).join('');
    Array.prototype.forEach.call($('themes').children, function (b) {
      b.onclick = function () { setTheme(b.dataset.t); };
    });

    var byTopic = {};
    cats.forEach(function (c) { (byTopic[c.topic] = byTopic[c.topic] || []).push(c); });
    $('catgroups').innerHTML = Object.keys(TOPICS).filter(function (k) { return byTopic[k]; })
      .map(function (k) {
        return '<div class="grp">' + esc(tx(TOPICS[k])) + '</div><div class="cats">' +
          byTopic[k].map(function (c) {
            return '<button class="catbtn" data-id="' + esc(c.id) + '" aria-pressed="' +
              (picked.indexOf(c.id) >= 0) + '">' + esc(tx(c.name)) +
              '<small>' + c.clues.length + ' × ' + (c.custom ? '✎' : '') + '</small></button>';
          }).join('') + '</div>';
      }).join('');
    Array.prototype.forEach.call($('catgroups').querySelectorAll('.catbtn'), function (b) {
      b.onclick = function () { toggleCat(b.dataset.id); };
    });

    renderChips();
    show('s-setup');
  }

  function themeSwatch(th) {
    return { classic: '#15326b', forest: '#1d3a27', crimson: '#4d1119', paper: '#e9e4d4' }[th];
  }

  function setTheme(th) {
    theme = th;
    document.body.setAttribute('data-jq', th);
    try { localStorage.setItem('jq_theme', th); } catch (e) {}
    renderSetup();
  }

  function toggleCat(id) {
    var i = picked.indexOf(id);
    if (i >= 0) picked.splice(i, 1);
    else if (picked.length < PICK) picked.push(id);
    renderSetup();
  }

  function renderChips() {
    $('chips').innerHTML = teams.map(function (n, i) {
      return '<span class="chip">' + esc(n) + '<button data-i="' + i + '">✕</button></span>';
    }).join('');
    Array.prototype.forEach.call($('chips').querySelectorAll('button'), function (b) {
      b.onclick = function () { teams.splice(+b.dataset.i, 1); saveTeams(); renderChips(); };
    });
    var ok = picked.length === PICK && teams.length >= MIN_TEAMS;
    $('start').disabled = !ok;
    $('tWarn').textContent = ok ? '' : t('need', { n: PICK, m: MIN_TEAMS });
  }

  function addTeam() {
    var v = $('tInput').value.trim();
    if (!v || teams.length >= MAX_TEAMS) return;
    teams.push(v); saveTeams(); $('tInput').value = ''; renderChips();
  }

  /* ---------------- play ---------------- */

  function pickedCats() {
    var map = {};
    allCats().forEach(function (c) { map[c.id] = c; });
    return picked.map(function (id) { return map[id]; }).filter(Boolean);
  }

  function startGame() {
    board = pickedCats();
    scores = {}; teams.forEach(function (n) { scores[n] = 0; });
    used = {};
    doubleCell = Math.floor(Math.random() * board.length) + ',' + Math.floor(Math.random() * VALUES.length);
    renderBoard();
  }

  function renderBoard() {
    $('board').style.gridTemplateColumns = 'repeat(' + board.length + ',1fr)';
    var html = board.map(function (c) { return '<div class="cat">' + esc(tx(c.name)) + '</div>'; }).join('');
    for (var r = 0; r < VALUES.length; r++) {
      for (var col = 0; col < board.length; col++) {
        var key = col + ',' + r, gone = !!used[key];
        html += '<button class="cellbtn" data-k="' + key + '"' + (gone ? ' disabled' : '') + '>' +
                (gone ? '·' : VALUES[r]) + '</button>';
      }
    }
    $('board').innerHTML = html;
    Array.prototype.forEach.call($('board').querySelectorAll('.cellbtn'), function (b) {
      if (!b.disabled) b.onclick = function () { openClue(b.dataset.k); };
    });
    renderScores();
    show('s-board');
    if (Object.keys(used).length === board.length * VALUES.length) endGame();
  }

  function renderScores() {
    $('scores').innerHTML = teams.map(function (n) {
      return '<div class="sc' + (scores[n] < 0 ? ' neg' : '') + '">' + esc(n) +
             '<b>' + scores[n] + '</b></div>';
    }).join('');
  }

  function valueOf(key) {
    return VALUES[+key.split(',')[1]] * (key === doubleCell ? 2 : 1);
  }

  function openClue(key) {
    openCell = key;
    var p = key.split(','), cat = board[+p[0]], clue = cat.clues[+p[1]], val = valueOf(key);
    $('clue').innerHTML =
      '<p class="val">' + esc(tx(cat.name)) + ' · ' + val + '</p>' +
      (key === doubleCell ? '<p class="dd">' + t('double') + '</p>' : '') +
      '<p class="q">' + esc(tx(clue.q)) + '</p>' +
      '<button class="btn" id="reveal">' + t('showAnswer') + '</button>';
    $('reveal').onclick = function () { reveal(key, clue, val); };
    show('s-clue');
  }

  function reveal(key, clue, val) {
    $('clue').innerHTML =
      '<p class="val">' + val + '</p>' +
      '<p class="q">' + esc(tx(clue.q)) + '</p>' +
      '<p class="a">' + esc(tx(clue.a)) + '</p>' +
      '<p class="val">' + t('whoGot') + '</p><div class="who">' +
      teams.map(function (n) {
        return '<button data-n="' + esc(n) + '" data-d="1">+' + val + ' — ' + esc(n) + '</button>';
      }).join('') +
      teams.map(function (n) {
        return '<button class="minus" data-n="' + esc(n) + '" data-d="-1">' +
               t('minus', { v: val }) + ' ' + esc(n) + '</button>';
      }).join('') +
      '<button data-n="" data-d="0">' + t('nobody') + '</button></div>' +
      '<p class="hint">' + t('hintAward') + '</p>';
    Array.prototype.forEach.call($('clue').querySelectorAll('.who button'), function (b) {
      b.onclick = function () {
        if (b.dataset.n && +b.dataset.d) scores[b.dataset.n] += val * (+b.dataset.d);
        used[key] = true; openCell = null; renderBoard();
      };
    });
  }

  function endGame() {
    var best = -Infinity, win = [];
    teams.forEach(function (n) {
      if (scores[n] > best) { best = scores[n]; win = [n]; }
      else if (scores[n] === best) win.push(n);
    });
    var order = teams.slice().sort(function (a, b) { return scores[b] - scores[a]; });
    $('final').innerHTML =
      '<p class="val">' + t('done') + '</p>' +
      '<p class="win">' + (win.length > 1 ? t('draw') : esc(win[0])) + '</p>' +
      (win.length > 1 ? '<p class="val">' + win.map(esc).join(' · ') + '</p>' : '') +
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

  /* ---------------- custom category editor ---------------- */

  function renderEditor() {
    $('tEdit').textContent = t('editT');
    $('tEditSub').textContent = t('editSub');
    $('backSetup').textContent = t('back');
    $('expJson').textContent = t('expJson');
    $('impJson').textContent = t('impJson');

    var mine = ED.load();
    $('mine').innerHTML = mine.length ? mine.map(function (c) {
      return '<div class="mine"><span>' + esc(c.name) + '</span><span>' +
        '<button data-e="' + esc(c.id) + '">✎</button>' +
        '<button data-d="' + esc(c.id) + '">🗑</button></span></div>';
    }).join('') : '<p class="hint">' + t('noneYet') + '</p>';
    Array.prototype.forEach.call($('mine').querySelectorAll('button'), function (b) {
      b.onclick = function () {
        if (b.dataset.d) {
          ED.remove(b.dataset.d);
          picked = picked.filter(function (p) { return p !== b.dataset.d; });
          renderEditor();
        } else {
          editing = ED.load().filter(function (c) { return c.id === b.dataset.e; })[0];
          renderForm();
        }
      };
    });
    renderForm();
    show('s-edit');
  }

  function renderForm() {
    var c = editing || { name: '', clues: [] };
    var rows = '';
    for (var i = 0; i < 5; i++) {
      var cl = c.clues[i] || { q: '', a: '' };
      rows += '<div class="qrow"><b>' + VALUES[i] + '</b>' +
        '<div class="field"><label>' + t('question') + '</label>' +
        '<textarea id="q' + i + '">' + esc(cl.q) + '</textarea></div>' +
        '<div class="field"><label>' + t('answer') + '</label>' +
        '<input id="a' + i + '" value="' + esc(cl.a) + '"></div></div>';
    }
    $('form').innerHTML =
      '<div class="field"><label>' + t('catName') + '</label>' +
      '<input id="cname" maxlength="28" value="' + esc(c.name) + '"></div>' + rows +
      '<p class="hint" id="formWarn"></p>' +
      '<button class="btn" id="saveCat">' + t('saveCat') + '</button>' +
      (editing ? '<button class="btn ghost small" id="newCat">' + t('newCat') + '</button>' : '');

    $('saveCat').onclick = saveForm;
    if ($('newCat')) $('newCat').onclick = function () { editing = null; renderForm(); };
  }

  function saveForm() {
    var entry = {
      id: (editing && editing.id) || 'c' + Date.now().toString(36),
      name: $('cname').value.trim(),
      clues: [0, 1, 2, 3, 4].map(function (i) {
        return { q: $('q' + i).value.trim(), a: $('a' + i).value.trim() };
      }),
    };
    if (ED.validate(entry)) { $('formWarn').textContent = t('fillAll'); return; }
    ED.upsert(entry);
    editing = null;
    renderEditor();
  }

  /* ---------------- word export ---------------- */

  function doWordExport() {
    var cats = pickedCats();
    if (cats.length !== PICK) { alert(t('needFive', { n: PICK })); return; }
    ED.exportWord(cats, VALUES, tx, {
      title: t('wordTitle'), subtitle: t('wordSub'), board: t('wordBoard'),
    });
  }

  /* ---------------- boot ---------------- */

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('jq_lang', l); } catch (e) {}
    document.documentElement.lang = l;
    Array.prototype.forEach.call($('langs').children, function (b) {
      b.classList.toggle('on', b.dataset.l === l);
    });
    if ($('s-clue').classList.contains('on') && openCell) openClue(openCell);
    else if ($('s-board').classList.contains('on')) renderBoard();
    else if ($('s-end').classList.contains('on')) endGame();
    else if ($('s-edit').classList.contains('on')) renderEditor();
    else renderSetup();
  }

  Array.prototype.forEach.call($('langs').children, function (b) {
    b.onclick = function () { setLang(b.dataset.l); };
  });
  $('tAdd').onclick = addTeam;
  $('tInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTeam(); });
  $('start').onclick = startGame;
  $('quit').onclick = renderSetup;
  $('toEdit').onclick = function () { editing = null; renderEditor(); };
  $('toWord').onclick = doWordExport;
  $('backSetup').onclick = renderSetup;
  $('expJson').onclick = ED.exportJson;
  $('impJson').onclick = function () { $('fileIn').click(); };
  $('fileIn').onchange = function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { alert(t('imported', { n: ED.importJson(r.result) })); }
      catch (e) { alert(t('badJson')); }
      renderEditor();
    };
    r.readAsText(f);
    this.value = '';
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('s-clue').classList.contains('on')) renderBoard();
  });

  document.body.setAttribute('data-jq', theme);
  setLang(lang);
})();
