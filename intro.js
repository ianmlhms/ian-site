/* Intro — guess the song from a growing snippet.
 *
 * Host-authoritative, same shape as the other online games here: Supabase
 * broadcast only, no DB state. The host owns the round list, the clock and the
 * scoring; guests send answers and render what they are told.
 *
 * The one non-obvious constraint: the iTunes API throttles at roughly 20
 * requests/minute (HTTP 403), so preview URLs are fetched ONCE per game, by
 * the host only, in a single batch lookup — never per song and never per
 * player. Everything else comes from the local catalogue.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var room = (params.get('room') || 'demo').toLowerCase();
  var role = params.get('role') === 'guest' ? 'guest' : 'host';
  var cid = Math.random().toString(36).slice(2, 10);
  var isHost = role === 'host';

  var CATALOG = window.INTRO_CATALOG || [];
  var BY_ID = {};
  CATALOG.forEach(function (c) {
    c.songs.forEach(function (s) { BY_ID[s.id] = { song: s, cat: c }; });
  });

  var R = window.INTRO_ROUNDS;            // round building, unit-tested
  var STEPS = R.STEPS;                    // seconds of song revealed per step
  var STEP_TIMEOUT_MS = 30000;            // don't let one idle player stall it

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ---------- state ---------- */

  var name = 'Spiller';
  var phase = 'lobby';
  var catIdx = 0, songCount = 5, audioMode = 'speaker';
  var rounds = [];          // host only: [{id, url, art, choices:[ids]}]
  var roundIdx = 0, step = 0;
  var current = null;       // {ids:[4], url} as broadcast
  var myAnswer = null;      // song id I picked this round
  var answers = {}, wantMore = {}, scores = {}, gained = {};
  var stepTimer = null, stopTimer = null;
  var revealed = null;

  var cfg = window.PB_CONFIG;
  var sb = supabase.createClient(cfg.url.replace(/\/$/, ''), cfg.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } });
  var ch = sb.channel('intro:' + room, {
    config: { broadcast: { self: false }, presence: { key: cid } }
  });

  function send(event, payload) { ch.send({ type: 'broadcast', event: event, payload: payload || {} }); }

  function players() {
    var st = ch.presenceState() || {};
    return Object.keys(st).map(function (k) {
      return { cid: k, name: (st[k][0] || {}).name || '?' };
    }).sort(function (a, b) { return a.cid < b.cid ? -1 : 1; });
  }

  /* ---------- audio ---------- */

  var audio = $('player');
  var audioReady = false;

  /* Mobile browsers refuse to play until a real user gesture, so spend the
     first tap unlocking the element. Without this the first snippet is
     silently swallowed and the round looks broken. */
  function unlockAudio() {
    if (audioReady) return;
    audioReady = true;
    audio.muted = true;
    var p = audio.play();
    if (p && p.then) p.then(function () { audio.pause(); audio.muted = false; })
                      .catch(function () { audio.muted = false; });
    else { audio.pause(); audio.muted = false; }
  }

  function shouldPlayHere() {
    return audioMode === 'each' || isHost;
  }

  function playSnippet(url, secs) {
    if (!shouldPlayHere() || !url) return;
    clearTimeout(stopTimer);
    try {
      if (audio.src !== url) { audio.src = url; audio.load(); }
      audio.currentTime = 0;
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* blocked; the UI still works */ });
      stopTimer = setTimeout(function () { audio.pause(); }, secs * 1000);
    } catch (e) { /* never let audio break the round */ }
  }

  function stopAudio() { clearTimeout(stopTimer); try { audio.pause(); } catch (e) {} }

  /* ---------- lobby ---------- */

  var COUNT_OPTIONS = [3, 5, 8, 10];
  var MODE_OPTIONS = [
    { id: 'speaker', label: '📢 Ee Lautsprecher', note: 'Nëmmen den Host spillt de Toun of. Fir wann der all am selwechten Raum sidd — synchron a kee Widderhall.' },
    { id: 'each', label: '🎧 All Handy', note: 'Jiddereen héiert op sengem eegenen Handy. Och op Distanz spillbar; am selwechte Raum hallt et awer.' }
  ];

  function renderLobby() {
    $('roomCode').textContent = isHost ? 'Code: ' + room : room;
    $('hostCfg').style.display = isHost ? '' : 'none';
    $('startBtn').style.display = isHost ? '' : 'none';

    if (isHost) {
      $('cats').innerHTML = CATALOG.map(function (c, i) {
        return '<button class="pick' + (i === catIdx ? ' on' : '') + '" data-cat="' + i + '">' +
               c.emoji + ' ' + esc(c.name) + '<br><small style="opacity:.7">' +
               c.songs.length + ' Lidder</small></button>';
      }).join('');
      $('counts').innerHTML = COUNT_OPTIONS.map(function (n) {
        return '<button class="pick' + (n === songCount ? ' on' : '') + '" data-count="' + n + '">' + n + '</button>';
      }).join('');
      $('modes').innerHTML = MODE_OPTIONS.map(function (m) {
        return '<button class="pick' + (m.id === audioMode ? ' on' : '') + '" data-mode="' + m.id + '">' +
               m.label + '</button>';
      }).join('');
      var mo = MODE_OPTIONS.filter(function (m) { return m.id === audioMode; })[0];
      $('modeNote').textContent = mo ? mo.note : '';
    }

    var ps = players();
    $('lobbyPlayers').innerHTML = ps.length
      ? ps.map(function (p) {
          return '<div class="sc' + (p.cid === cid ? ' me' : '') + '"><span>' + esc(p.name) +
                 (p.cid === cid ? '<span class="tag">du</span>' : '') + '</span></div>';
        }).join('')
      : '<div class="sub" style="margin:0">Nach keen do…</div>';

    if (isHost) {
      var url = location.origin + location.pathname + '?room=' + encodeURIComponent(room) + '&role=guest';
      $('joinHint').innerHTML = 'Deel dëse Link: <b>' + esc(url) + '</b>';
      $('startBtn').disabled = false;
      $('lobbyNote').textContent = ps.length < 2
        ? 'Du kanns och eleng spillen.' : '';
    } else {
      $('joinHint').textContent = '';
      $('lobbyNote').textContent = 'Waart bis den Host start…';
    }
  }

  $('cats').onclick = function (e) {
    var b = e.target.closest('[data-cat]'); if (!b) return;
    catIdx = +b.dataset.cat; renderLobby(); sendCfg();
  };
  $('counts').onclick = function (e) {
    var b = e.target.closest('[data-count]'); if (!b) return;
    songCount = +b.dataset.count; renderLobby(); sendCfg();
  };
  $('modes').onclick = function (e) {
    var b = e.target.closest('[data-mode]'); if (!b) return;
    audioMode = b.dataset.mode; renderLobby(); sendCfg();
  };
  function sendCfg() { if (isHost) send('cfg', { catIdx: catIdx, songCount: songCount, audioMode: audioMode }); }

  /* ---------- screens ---------- */

  function show(id) {
    ['s-lobby', 's-play', 's-reveal', 's-final'].forEach(function (s) {
      $(s).classList.toggle('on', s === id);
    });
  }

  /* ---------- host: build the round list ---------- */

  function pickRounds() {
    return R.buildRounds(CATALOG[catIdx], songCount);
  }

  function resolvePreviews(ids) {
    var url = 'https://itunes.apple.com/lookup?id=' + ids.join(',') + '&country=LU&entity=song';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var map = {};
      (j.results || []).forEach(function (x) {
        if (x.trackId && x.previewUrl) {
          map[x.trackId] = {
            url: x.previewUrl,
            art: (x.artworkUrl100 || '').replace('100x100', '300x300')
          };
        }
      });
      return map;
    });
  }

  $('startBtn').onclick = function () {
    if (!isHost) return;
    unlockAudio();
    $('startBtn').disabled = true;
    $('lobbyNote').textContent = 'Lidder gi gelueden…';

    var picked = pickRounds();
    resolvePreviews(picked.map(function (r) { return r.id; }))
      .then(function (map) {
        rounds = picked.filter(function (r) { return map[r.id]; })
                       .map(function (r) {
                         return { id: r.id, ids: r.ids, url: map[r.id].url, art: map[r.id].art };
                       });
        if (!rounds.length) throw new Error('keng Previews');
        scores = {}; roundIdx = 0;
        send('begin', { audioMode: audioMode, total: rounds.length });
        startRound(0);
      })
      .catch(function (e) {
        $('startBtn').disabled = false;
        $('lobbyNote').className = 'note warn';
        $('lobbyNote').textContent = 'Konnt d’Lidder net lueden (' + e.message +
          '). Apple limitéiert d’Ufroen — waart e Moment a probéier nach eng Kéier.';
      });
  };

  function startRound(i) {
    roundIdx = i; step = 0; answers = {}; wantMore = {}; gained = {}; revealed = null;
    var r = rounds[i];
    send('round', { i: i, ids: r.ids, url: r.url, total: rounds.length });
    applyRound({ i: i, ids: r.ids, url: r.url, total: rounds.length });
    beginStep();
  }

  function beginStep() {
    send('step', { step: step });
    applyStep(step);
    if (isHost) {
      clearTimeout(stepTimer);
      stepTimer = setTimeout(function () { advance(true); }, STEP_TIMEOUT_MS);
    }
  }

  /* Host decides when the snippet grows or the answer is revealed. The
     decision itself lives in intro-rounds.js so it can be unit-tested. */
  function advance(forced) {
    if (!isHost || revealed) return;
    var ids = players().map(function (p) { return p.cid; });
    var action = R.nextAction(ids, answers, wantMore, step, !!forced);
    if (action === 'reveal') return doReveal();
    if (action === 'advance') { step++; beginStep(); }
  }

  function doReveal() {
    if (!isHost) return;
    clearTimeout(stepTimer);
    var r = rounds[roundIdx];
    var g = {};
    players().forEach(function (p) {
      var a = answers[p.cid];
      if (a && a.id === r.id) {
        var pts = R.pointsFor(a.step);
        scores[p.cid] = (scores[p.cid] || 0) + pts;
        g[p.cid] = pts;
      }
    });
    var payload = {
      correct: r.id, art: r.art, scores: scores, gained: g,
      names: playerNames(), last: roundIdx >= rounds.length - 1
    };
    send('reveal', payload);
    applyReveal(payload);
  }

  function playerNames() {
    var m = {};
    players().forEach(function (p) { m[p.cid] = p.name; });
    return m;
  }

  /* ---------- everyone: render a round ---------- */

  function applyRound(p) {
    current = p; myAnswer = null; step = 0; revealed = null;
    phase = 'play';
    show('s-play');
    renderPlay();
  }

  function applyStep(s) {
    step = s;
    if (!revealed && current) playSnippet(current.url, STEPS[s]);
    renderPlay();
  }

  function renderPlay() {
    if (!current) return;
    var secs = STEPS[step];
    $('secs').textContent = secs + 's';
    $('disc').classList.toggle('spin', shouldPlayHere());
    $('stepbar').innerHTML = STEPS.map(function (_, i) {
      return '<i class="' + (i <= step ? 'done' : '') + '"></i>';
    }).join('');
    $('playSub').textContent = 'Lidd ' + (current.i + 1) + ' vun ' + current.total +
      (shouldPlayHere() ? '' : ' · Lauschter beim Host');

    $('answers').innerHTML = current.ids.map(function (id) {
      var e = BY_ID[id];
      if (!e) return '';
      var sel = myAnswer === id ? ' sel' : '';
      return '<button class="ans' + sel + '" data-id="' + id + '"' +
             (myAnswer ? ' disabled' : '') + '><b>' + esc(e.song.t) + '</b>' +
             '<small>' + esc(e.song.a) + '</small></button>';
    }).join('');

    $('moreBtn').style.display = myAnswer ? 'none' : '';
    $('moreBtn').disabled = wantMore[cid] === step || step >= STEPS.length - 1;
    $('moreBtn').textContent = step >= STEPS.length - 1
      ? 'Ganzt Lidd gespillt — wiel elo'
      : (wantMore[cid] === step ? 'Waart op déi aner…' : 'Méi héieren ▸');
    renderScores($('playScores'), scores, null);
  }

  $('answers').onclick = function (e) {
    var b = e.target.closest('[data-id]');
    if (!b || myAnswer || revealed) return;
    unlockAudio();
    myAnswer = +b.dataset.id;
    var payload = { cid: cid, id: myAnswer, step: step };
    answers[cid] = payload;
    send('answer', payload);
    renderPlay();
    if (isHost) advance(false);
  };

  $('moreBtn').onclick = function () {
    if (myAnswer || revealed) return;
    unlockAudio();
    wantMore[cid] = step;
    send('more', { cid: cid, step: step });
    renderPlay();
    if (isHost) advance(false);
  };

  /* ---------- reveal ---------- */

  function applyReveal(p) {
    revealed = p;
    stopAudio();
    clearTimeout(stepTimer);
    scores = p.scores || {};
    var e = BY_ID[p.correct];
    $('revArt').src = p.art || '';
    $('revArt').alt = e ? e.song.t : '';
    $('revTitle').textContent = e ? e.song.t : '?';
    $('revArtist').textContent = e ? e.song.a : '';

    var names = p.names || {};
    var winners = Object.keys(p.gained || {});
    $('revWho').innerHTML = winners.length
      ? winners.map(function (k) {
          return esc(names[k] || '?') + ' <b>+' + p.gained[k] + '</b>';
        }).join(' · ')
      : 'Keen huet et erkannt.';

    renderScores($('revScores'), scores, names);
    $('nextBtn').style.display = isHost ? '' : 'none';
    $('nextBtn').textContent = p.last ? 'Resultat weisen ▸' : 'Weider ▸';
    show('s-reveal');
    if (!isHost) $('nextBtn').style.display = 'none';
  }

  $('nextBtn').onclick = function () {
    if (!isHost) return;
    if (revealed && revealed.last) { showFinal(scores, playerNames()); send('final', { scores: scores, names: playerNames() }); }
    else startRound(roundIdx + 1);
  };

  function renderScores(el, sc, names) {
    var nm = names || playerNames();
    var ps = players();
    if (!ps.length) ps = Object.keys(sc).map(function (k) { return { cid: k, name: nm[k] || '?' }; });
    var rows = ps.map(function (p) { return { cid: p.cid, name: nm[p.cid] || p.name, pts: sc[p.cid] || 0 }; })
                 .sort(function (a, b) { return b.pts - a.pts; });
    el.innerHTML = rows.map(function (r) {
      return '<div class="sc' + (r.cid === cid ? ' me' : '') + '"><span>' + esc(r.name) +
             '</span><b>' + r.pts + '</b></div>';
    }).join('') || '<div class="sub" style="margin:0">—</div>';
  }

  function showFinal(sc, names) {
    stopAudio();
    var rows = Object.keys(names).map(function (k) { return { cid: k, name: names[k], pts: sc[k] || 0 }; })
                     .sort(function (a, b) { return b.pts - a.pts; });
    $('winner').textContent = rows.length ? (rows[0].name + ' — ' + rows[0].pts + ' Punkten') : '—';
    renderScores($('finalScores'), sc, names);
    $('againBtn').style.display = isHost ? '' : 'none';
    show('s-final');
    recordResult(rows);
  }

  function recordResult(rows) {
    try {
      var a = window.__pbAuth;
      if (!a || !a.session || !a.sb || rows.length < 2) return;
      var mine = rows.filter(function (r) { return r.cid === cid; })[0];
      if (!mine) return;
      a.sb.rpc('record_match', { p_game: 'intro', p_result: rows[0].cid === cid ? 'win' : 'loss' });
    } catch (e) { /* leaderboard is optional */ }
  }

  $('againBtn').onclick = function () {
    if (!isHost) return;
    scores = {}; roundIdx = 0; revealed = null;
    send('again', {});
    phase = 'lobby'; show('s-lobby'); renderLobby();
    $('startBtn').disabled = false;
    $('lobbyNote').className = 'note';
    $('lobbyNote').textContent = '';
  };

  /* ---------- channel ---------- */

  ch.on('broadcast', { event: 'cfg' }, function (m) {
      catIdx = m.payload.catIdx; songCount = m.payload.songCount; audioMode = m.payload.audioMode;
      if (phase === 'lobby') renderLobby();
    })
    .on('broadcast', { event: 'begin' }, function (m) {
      audioMode = m.payload.audioMode || audioMode;
      scores = {};
    })
    .on('broadcast', { event: 'round' }, function (m) { applyRound(m.payload); })
    .on('broadcast', { event: 'step' }, function (m) { applyStep(m.payload.step); })
    .on('broadcast', { event: 'answer' }, function (m) {
      answers[m.payload.cid] = m.payload;
      if (isHost) advance(false);
    })
    .on('broadcast', { event: 'more' }, function (m) {
      wantMore[m.payload.cid] = m.payload.step;
      if (isHost) advance(false);
    })
    .on('broadcast', { event: 'reveal' }, function (m) { applyReveal(m.payload); })
    .on('broadcast', { event: 'final' }, function (m) { showFinal(m.payload.scores, m.payload.names); })
    .on('broadcast', { event: 'again' }, function () {
      scores = {}; revealed = null; phase = 'lobby'; show('s-lobby'); renderLobby();
    })
    .on('presence', { event: 'sync' }, function () {
      if (phase === 'lobby') renderLobby();
      else if (revealed) renderScores($('revScores'), scores, null);
      else renderScores($('playScores'), scores, null);
    })
    .subscribe(async function (s) {
      if (s !== 'SUBSCRIBED') return;
      name = await getName();
      await ch.track({ name: name, role: role });
      renderLobby();
    });

  async function getName() {
    var n = localStorage.getItem('playerName');
    if (!n) { try { n = window.__pbAuth && window.__pbAuth.session &&
                        window.__pbAuth.session.user.user_metadata.username; } catch (e) {} }
    if (!n) { n = (prompt('Däin Numm fir d’Spill:') || 'Spiller').slice(0, 20); }
    localStorage.setItem('playerName', n);
    return n;
  }

  document.addEventListener('click', unlockAudio, { once: true });
  renderLobby();
})();
