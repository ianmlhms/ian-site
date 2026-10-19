/* Kart Lëtzebuerg — progress: personal records and the compact best-lap ghosts (one save blob, local + the arcade's cloud save),
 * the Grand Prix point table, and the leaderboard boards. Nothing here polls: boards are written once per race / GP end, only
 * when a personal best was beaten (see KL.Boards). The pure parts (merge, ghost codec, GP table) run in node for the tests. */
(function () {
  'use strict';
  const KL = window.KL;
  const { clamp } = KL;

  /* ---------- score encoding: a faster time is a HIGHER score ----------
   * The arcade keeps one score per user and board and (server side) treats "higher" as better for every game that is not in its
   * short lower-is-better list. So a time is stored as TIME_BASE - milliseconds and shown by pixelbreak-records.js (format "kt"). */
  const TIME_BASE = 1000000, MIN_MS = 5000;
  KL.TIME_BASE = TIME_BASE;
  KL.timeScore = (sec) => { const ms = Math.round(sec * 1000); return isFinite(ms) && ms >= MIN_MS && ms < TIME_BASE ? TIME_BASE - ms : null; };

  /* ---------- Grand Prix points ---------- */
  KL.GP_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
  KL.GP_RACES = 4;
  /* races of a cup: the cup's tracks that exist; while a cup has fewer than 4 tracks its tracks repeat (with other weather) */
  KL.gpRaces = function gpRaces(cup, tracks) {
    const avail = cup.tracks.filter((id) => tracks[id]);
    if (!avail.length) return [];
    const out = [];
    for (let i = 0; i < KL.GP_RACES; i++) out.push({ track: avail[i % avail.length], lapOfTrack: Math.floor(i / avail.length) });
    return out;
  };
  /* table: { [driverId]: { pts, wins, last, races } } — returns a new table, rows = [{driver, place}] */
  KL.gpAward = function gpAward(table, rows) {
    const next = {};
    for (const id in table) next[id] = { ...table[id] };
    for (const r of rows) {
      const cur = next[r.driver] || { pts: 0, wins: 0, last: 0, races: 0 };
      next[r.driver] = { pts: cur.pts + (KL.GP_POINTS[r.place - 1] || 0), wins: cur.wins + (r.place === 1 ? 1 : 0), last: r.place, races: cur.races + 1 };
    }
    return next;
  };
  KL.gpRanking = function gpRanking(table) {
    const list = Object.keys(table).map((id) => ({ driver: id, ...table[id] }));
    list.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.last - b.last);
    list.forEach((r, i) => (r.rank = i + 1));
    return list;
  };

  /* ---------- the save blob ---------- */
  const KEY = 'kl_save', GHOST_MAX = 16000;
  const emptySave = () => ({ v: 1, bests: {}, ghosts: {}, gp: { wins: 0 } });
  const okId = (s) => typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s);
  const okMs = (n) => typeof n === 'number' && isFinite(n) && n >= MIN_MS && n < TIME_BASE;
  function clean(d) {
    const out = emptySave();
    if (!d || typeof d !== 'object') return out;
    if (d.bests && typeof d.bests === 'object') for (const id in d.bests) {
      if (!okId(id) || !d.bests[id] || typeof d.bests[id] !== 'object') continue;
      const b = {}; if (okMs(d.bests[id].lap)) b.lap = Math.round(d.bests[id].lap); if (okMs(d.bests[id].race)) b.race = Math.round(d.bests[id].race);
      if (b.lap || b.race) out.bests[id] = b;
    }
    if (d.ghosts && typeof d.ghosts === 'object') for (const id in d.ghosts) {
      const g = d.ghosts[id];
      if (!okId(id) || !g || !okMs(g.ms) || typeof g.g !== 'string' || g.g.length > GHOST_MAX || !/^g1:[0-9a-z,\-]*$/.test(g.g)) continue;
      out.ghosts[id] = { ms: Math.round(g.ms), g: g.g, drv: okId(g.drv) ? g.drv : '' };
    }
    if (d.gp && Number.isSafeInteger(d.gp.wins) && d.gp.wins > 0 && d.gp.wins < 1e6) out.gp.wins = d.gp.wins;
    return out;
  }
  /* best of both: lower times, the faster ghost, more GP wins */
  function merge(a, b) {
    const x = clean(a), y = clean(b), out = emptySave();
    for (const id of new Set([...Object.keys(x.bests), ...Object.keys(y.bests)])) {
      const p = x.bests[id] || {}, q = y.bests[id] || {}, m = {};
      for (const f of ['lap', 'race']) { const v = [p[f], q[f]].filter(Boolean); if (v.length) m[f] = Math.min(...v); }
      out.bests[id] = m;
    }
    for (const id of new Set([...Object.keys(x.ghosts), ...Object.keys(y.ghosts)])) {
      const p = x.ghosts[id], q = y.ghosts[id];
      out.ghosts[id] = p && q ? (q.ms < p.ms ? q : p) : (p || q);
    }
    out.gp.wins = Math.max(x.gp.wins, y.gp.wins);
    return out;
  }
  const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

  const Save = (KL.Save = {
    data: emptySave(), merge, clean, same,
    load() {
      let d = emptySave();
      try { if (window.__pbSave) d = merge(d, window.__pbSave); } catch (e) { /* injected by the arcade */ }
      try { d = merge(d, JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { console.warn('[Kart] save not readable', e); }
      Save.data = d;
      return d;
    },
    /* a copy of the cloud save arrived: keep the better of both and push ours back when it holds more */
    adopt(remote) {
      const before = Save.data;
      Save.data = merge(before, remote);
      Save.write(!same(Save.data, remote));
    },
    write(toCloud) {
      try { localStorage.setItem(KEY, JSON.stringify(Save.data)); } catch (e) { console.warn('[Kart] save not stored', e); }
      if (toCloud && window.parent !== window) { try { window.parent.postMessage({ __pbSave: 1, data: Save.data }, '*'); } catch (e) { console.warn('[Kart] cloud save not sent', e); } }
    },
    /* records: each returns true when the personal best was beaten (a new object replaces the old one) */
    lap(track, sec) {
      const ms = Math.round(sec * 1000); if (!okMs(ms) || !okId(track)) return false;
      const cur = (Save.data.bests[track] || {}).lap;
      if (cur && cur <= ms) return false;
      Save.data = { ...Save.data, bests: { ...Save.data.bests, [track]: { ...(Save.data.bests[track] || {}), lap: ms } } };
      Save.write(false); return true;
    },
    race(track, sec) {
      const ms = Math.round(sec * 1000); if (!okMs(ms) || !okId(track)) return false;
      const cur = (Save.data.bests[track] || {}).race;
      if (cur && cur <= ms) return false;
      Save.data = { ...Save.data, bests: { ...Save.data.bests, [track]: { ...(Save.data.bests[track] || {}), race: ms } } };
      Save.write(false); return true;
    },
    ghost(track, sec, samples, drv) {
      const ms = Math.round(sec * 1000); if (!okMs(ms) || !okId(track)) return false;
      const cur = Save.data.ghosts[track];
      if (cur && cur.ms <= ms) return false;
      const g = KL.Ghost.encode(samples); if (g.length > GHOST_MAX) return false;
      Save.data = { ...Save.data, ghosts: { ...Save.data.ghosts, [track]: { ms, g, drv: okId(drv) ? drv : '' } } };
      Save.write(true);                            // the one cloud write: only when a ghost improved
      return true;
    },
    gpWin() {
      Save.data = { ...Save.data, gp: { wins: Save.data.gp.wins + 1 } };
      Save.write(true); return Save.data.gp.wins;
    },
    best(track, f) { return (Save.data.bests[track] || {})[f] || null; },
    ghostOf(track) { return Save.data.ghosts[track] || null; },
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || window.parent === window || !e.data || typeof e.data !== 'object') return;
    if (e.data.__pbLoadSave === 1) { try { Save.adopt(e.data.data); if (KL.G && KL.G.state === 'menu' && KL.G.refreshMenu) KL.G.refreshMenu(); } catch (err) { console.warn('[Kart] cloud save ignored', err); } }
  });

  /* ---------- ghost codec: a lap sampled at 10 Hz, positions in cm as base-36 deltas ---------- */
  const SAMPLE_DT = 0.1;
  const b36 = (n) => (n < 0 ? '-' : '') + Math.abs(n).toString(36);
  KL.Ghost = {
    DT: SAMPLE_DT,
    encode(samples) {
      let px = 0, py = 0, pz = 0; const out = [];
      for (const s of samples) {
        const cx = Math.round(s[0] * 100), cy = Math.round(s[1] * 100), cz = Math.round(s[2] * 100), cw = Math.round(KL.wrapAngle(s[3]) * 100);
        out.push(b36(cx - px), b36(cy - py), b36(cz - pz), b36(cw)); px = cx; py = cy; pz = cz;
      }
      return 'g1:' + out.join(',');
    },
    decode(str) {
      if (typeof str !== 'string' || !str.startsWith('g1:')) return null;
      const v = str.slice(3).split(',');
      if (v.length < 8 || v.length % 4) return null;
      const out = []; let x = 0, y = 0, z = 0;
      for (let i = 0; i < v.length; i += 4) {
        const dx = parseInt(v[i], 36), dy = parseInt(v[i + 1], 36), dz = parseInt(v[i + 2], 36), w = parseInt(v[i + 3], 36);
        if (![dx, dy, dz, w].every(isFinite)) return null;
        x += dx; y += dy; z += dz; out.push([x / 100, y / 100, z / 100, w / 100]);
      }
      return out;
    },
    /* pose at lap time t (s); holds the last sample after the end */
    poseAt(samples, t, out) {
      out = out || {};
      const n = samples.length, f = clamp(t / SAMPLE_DT, 0, n - 1), i = Math.min(n - 2, Math.floor(f)), a = samples[i], b = samples[i + 1], k = f - i;
      out.x = a[0] + (b[0] - a[0]) * k; out.y = a[1] + (b[1] - a[1]) * k; out.z = a[2] + (b[2] - a[2]) * k;
      out.yaw = a[3] + KL.wrapAngle(b[3] - a[3]) * k;
      return out;
    },
    /* samples the human kart at 10 Hz per lap; tick() returns {sec, samples} when a lap was completed */
    recorder() {
      let idx = -2, buf = [];
      return {
        reset() { idx = -2; buf = []; },
        tick(k, R) {
          let done = null;
          if (k.lapIdx !== idx) {
            if (idx >= 0 && k.lapIdx === idx + 1 && k.lapTimes.length > idx && buf.length > 3) done = { sec: k.lapTimes[idx], samples: buf };
            idx = k.lapIdx; buf = [];
          }
          if (k.lapIdx >= 0 && !k.finished) {
            const t = R.clock - k.lapStart;
            if (t >= buf.length * SAMPLE_DT) buf.push([k.x, k.y, k.z, k.yaw]);
          }
          return done;
        },
      };
    },
  };

  /* ---------- leaderboards (the arcade's own boards) ----------
   * ids: kart-letzebuerg-lap-<track>, kart-letzebuerg-race-<track>, kart-letzebuerg-gp. Written only when a personal best was
   * beaten, at the end of a race / GP; Arcade.score() is debounced by the arcade and flushes when the board changes. */
  const GAME = 'kart-letzebuerg';
  const Boards = (KL.Boards = {
    id(kind, track) { return kind === 'gp' ? GAME + '-gp' : GAME + '-' + kind + '-' + track; },
    name(kind, track) { return KL.t('title') + ' · ' + (kind === 'gp' ? KL.t('bd_gp') : KL.t('t_' + track) + ' · ' + KL.t(kind === 'lap' ? 'bd_lap' : 'bd_race')); },
    spec(kind, track) { return { id: Boards.id(kind, track), name: Boards.name(kind, track), format: kind === 'gp' ? '' : 'kt' }; },
    select(kind, track) { if (window.Arcade && Arcade.setBoard) Arcade.setBoard(Boards.spec(kind, track)); },
    /* time boards take seconds, the GP board the number of wins */
    submit(kind, track, value) {
      if (!window.Arcade || !Arcade.setBoard) return false;
      const score = kind === 'gp' ? value : KL.timeScore(value);
      if (score == null || !(score > 0)) return false;
      Arcade.setBoard(Boards.spec(kind, track)); Arcade.score(score);
      Boards.sent.push([Boards.id(kind, track), score]);
      return true;
    },
    sent: [],
    open(kind, track) {
      Boards.select(kind, track);
      setTimeout(() => {
        let pb = window.PB;
        try { if (!pb && window.parent !== window) pb = window.parent.PB; } catch (e) { /* cross-origin parent */ }
        if (pb && pb.openBoard) pb.openBoard();
      }, 80);                                   // the board choice reaches the arcade as a message first
    },
    kinds: ['lap', 'race', 'gp'],
  });

  /* what a finished race writes: personal records first, then (only for the beaten ones) the boards */
  KL.Progress = {
    onRaceDone(o) {              // { track, laps, lapTimes[], finished, time }
      const res = { lap: false, race: false };
      const best = o.lapTimes && o.lapTimes.length ? Math.min(...o.lapTimes) : null;
      if (best != null && Save.lap(o.track, best)) { res.lap = true; Boards.submit('lap', o.track, best); }
      if (o.finished && o.laps === KL.CFG.LAPS && Save.race(o.track, o.time)) { res.race = true; Boards.submit('race', o.track, o.time); }
      Boards.select('lap', o.track);
      return res;
    },
    onGpWon() { const wins = Save.gpWin(); Boards.submit('gp', null, wins); return wins; },
  };
})();
