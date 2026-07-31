/* Intro — round construction.
 *
 * DOM-free so it can be unit-tested in Node. The failure modes here are quiet
 * and nasty: a round whose correct answer isn't among the choices is
 * unwinnable, and a duplicated choice gives the answer away. Both are easy to
 * write and impossible to spot by looking at the screen once.
 */
(function () {
  'use strict';

  var STEPS = [1, 3, 5, 10, 15, 30];      // seconds revealed per step
  var POINTS = [6, 5, 4, 3, 2, 1];        // points for guessing at that step
  var CHOICES = 4;

  /* Fisher-Yates on a copy; rnd defaults to Math.random so tests can inject
     a deterministic source. */
  function shuffled(arr, rnd) {
    var r = rnd || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Build the round list for one category.
     Returns [{ id, ids }] where ids are the shuffled choice ids, always
     including id itself. */
  function buildRounds(cat, count, rnd) {
    if (!cat || !cat.songs || !cat.songs.length) return [];
    var songs = cat.songs;
    var picked = shuffled(songs, rnd).slice(0, Math.max(1, Math.min(count, songs.length)));

    return picked.map(function (song) {
      var others = songs.filter(function (s) { return s.id !== song.id; });
      /* A small category may not have enough distractors; take what exists
         rather than padding with duplicates, which would leak the answer. */
      var take = Math.min(CHOICES - 1, others.length);
      var ids = [song.id].concat(shuffled(others, rnd).slice(0, take)
                                  .map(function (s) { return s.id; }));
      return { id: song.id, ids: shuffled(ids, rnd) };
    });
  }

  function pointsFor(step) {
    return POINTS[Math.min(Math.max(step, 0), POINTS.length - 1)];
  }

  /* What the host should do next: 'reveal', 'advance' (longer snippet) or
     'wait'. Pulled out of the UI because the last-step case is easy to get
     wrong — revealing as soon as the *first* player answers would cut everyone
     else off mid-round.
       ids      — cids of the players still in the game
       answers  — { cid: {...} } for players who have committed an answer
       wantMore — { cid: step } for players asking for a longer snippet
       forced   — the step timer expired, so stop waiting on idle players */
  function nextAction(ids, answers, wantMore, step, forced) {
    var pending = ids.filter(function (id) { return !answers[id]; });
    if (!pending.length) return 'reveal';            // everyone has committed

    var atLast = step >= STEPS.length - 1;
    var allWantMore = pending.every(function (id) { return wantMore[id] === step; });

    if (forced || allWantMore) return atLast ? 'reveal' : 'advance';
    return 'wait';
  }

  var api = {
    STEPS: STEPS, POINTS: POINTS, CHOICES: CHOICES,
    shuffled: shuffled, buildRounds: buildRounds, pointsFor: pointsFor,
    nextAction: nextAction
  };
  if (typeof window !== 'undefined') window.INTRO_ROUNDS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
