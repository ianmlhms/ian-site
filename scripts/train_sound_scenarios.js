/* Zuchsimulator audio test scenarios (browser side, plain script).
 * Used by scripts/train_sound_render.mjs (offline WAV rendering for A/B listening) and by the audio flow check.
 * window.TS_SCEN.build(name, camera) -> { dur, frames: [{t, p}], events: [{t, fn, args}] }
 *   frames: audio.update params at 30 Hz; events: one-shot calls on the audio object (horn(true/false), doorOpen ...).
 * Deterministic: a tiny kinematic model drives speed / lever / acceleration like the sim would. */
(function () {
  'use strict';
  const TRAINS = {
    tram: { id: 'tram', sound: 'tram', accel: 1.2, brake: 1.3, vmax: 70 },
    railcar: { id: 'railcar', sound: 'diesel', accel: 0.9, brake: 1.1, vmax: 90 },
    emu: { id: 'emu', sound: 'electric', accel: 1.0, brake: 1.15, vmax: 140 },
    kiss: { id: 'kiss', sound: 'electric', accel: 0.95, brake: 1.15, vmax: 160 },
    ic: { id: 'ic', sound: 'electric', accel: 0.75, brake: 1.0, vmax: 200 },
    hst: { id: 'hst', sound: 'hst', accel: 0.65, brake: 0.95, vmax: 320 },
  };
  const DT = 1 / 30;

  /* A scenario is a list of steps. Step: { lever, until(s) | for: seconds, curv, events: [[afterS, fn, ...args]], tunnel, bridge, doors, park }.
   * s = { v, t, tStep }. */
  function run(trainId, camera, steps, opts) {
    opts = opts || {};
    const tr = TRAINS[trainId], boost = opts.accelBoost || 1;
    let t = 0, v = 0, a = 0, doors = 0, doorsTarget = 0, trac = 0;
    const frames = [], events = [];
    let parking = true;
    for (const st of steps) {
      const t0 = t;
      (st.events || []).forEach((e) => events.push({ t: t0 + e[0], fn: e[1], args: e.slice(2) }));
      if (st.doors != null) doorsTarget = st.doors;
      if (st.park != null) parking = !!st.park;
      for (let guard = 0; guard < 60 * 30; guard++) {
        const s = { v, t, tStep: t - t0 };
        if (st.for != null ? s.tStep >= st.for : st.until && st.until(s)) break;
        const lever = typeof st.lever === 'function' ? st.lever(s) : st.lever || 0;
        if (doors !== doorsTarget) doors = doors < doorsTarget ? Math.min(doorsTarget, doors + DT / 2) : Math.max(doorsTarget, doors - DT / 2);
        const vmax = tr.vmax / 3.6;
        let acc = 0;
        if (lever > 0 && !parking && doors === 0) acc = tr.accel * boost * (lever / 5) * Math.max(0.12, 1 - Math.pow(v / vmax, 2.2) * 0.9);
        else if (lever < 0) acc = -tr.brake * Math.sqrt(boost) * Math.min(1, -lever / 7) * (lever <= -8 ? 1.5 : 1);
        else acc = -0.012 * (v > 0.1 ? 1 : 0) - 0.00008 * v * v;   // coasting drag
        const tracTarget = lever > 0 && !parking && doors === 0 ? lever / 5 : 0;
        trac += Math.max(-3 * DT, Math.min(0.9 * DT, tracTarget - trac));
        const nv = st.holdV != null ? st.holdV : Math.max(0, v + acc * DT);
        a = (nv - v) / DT; v = nv;
        frames.push({
          t,
          p: {
            speedMs: v, lever, accelMs2: a, sound: tr.sound, train: tr.id, camera, curvature: typeof st.curv === 'function' ? st.curv(s) : st.curv || 0,
            inTunnel: !!st.tunnel, onBridge: !!st.bridge, rain: st.rain || 0, doorsOpen01: doors, parkingBrake: parking && v < 0.05, brakePct: lever < 0 ? Math.min(1, -lever / 8) : 0, traction: trac, weather: st.rain ? 'rain' : 'clear', timeScale: 1,
          },
        });
        t += DT;
      }
    }
    return { dur: t + (opts.tail == null ? 1.5 : opts.tail), frames, events };
  }

  const stopStation = (open) => [
    { for: 0.4, lever: -2, doors: 0, park: true },
    { for: open ? 1.0 : 0.2, lever: 0, events: [[0.1, 'doorOpen']], doors: 1, park: true },
  ];

  /* The Luxtram: standing at a stop, doors close, 0 -> 50 km/h, bell, tight curve, braking to a stop, doors open. */
  function tramCity(camera) {
    return run('tram', camera, [
      { for: 0.5, lever: 0, doors: 1, park: true, events: [[0.2, 'doorOpen']] },
      { for: 2.0, lever: 0, doors: 1, park: true },
      { for: 2.4, lever: 0, events: [[0.0, 'doorChime']], doors: 1, park: true },
      { for: 2.2, lever: 0, doors: 0, park: true, events: [[0.0, 'doorClose']] },
      { for: 1.5, lever: 0, doors: 0, park: true },
      { for: 0.1, lever: 1, doors: 0, park: false },
      { until: (s) => s.v >= 13.6, lever: 5, events: [[2.0, 'horn', true], [3.6, 'horn', false], [5.0, 'horn', true], [5.5, 'horn', false]] },
      { for: 3.5, lever: 1 },
      { until: (s) => s.v <= 6.2, lever: -4 },
      { for: 4.0, lever: (s) => (s.v < 5.5 ? 1 : 0), curv: 1 / 32 },
      { until: (s) => s.v <= 0.01, lever: -4 },
      { for: 0.6, lever: -4 },
      { for: 2.2, lever: 0, doors: 1, park: true, events: [[0.8, 'doorOpen']] },
    ], { tail: 2.5 });
  }

  /* A CFL train: doors close, accelerate to the cruise speed, horn, a curve, brake to a stop, doors open. */
  function railRun(trainId, cruiseKmh, camera, opts) {
    const cv = cruiseKmh / 3.6;
    opts = opts || {};
    return run(trainId, camera, [
      { for: 0.5, lever: 0, doors: 1, park: true, events: [[0.2, 'doorOpen']] },
      { for: 1.2, lever: 0, doors: 1, park: true },
      { for: 2.4, lever: 0, events: [[0.0, 'doorChime']], doors: 1, park: true },
      { for: 2.2, lever: 0, doors: 0, park: true, events: [[0.0, 'doorClose']] },
      { for: 1.5, lever: 0, doors: 0, park: true },
      { for: 0.1, lever: 1, doors: 0, park: false },
      { until: (s) => s.v >= cv * 0.55, lever: 5, events: [[3.0, 'horn', true], [4.6, 'horn', false]] },
      { until: (s) => s.v >= cv, lever: 3 },
      { for: 4.0, lever: (s) => (s.v < cv ? 1 : 0), bridge: true },
      { for: 5.0, lever: 0, curv: 1 / (opts.curveR || 450) },
      { until: (s) => s.v <= 4.5, lever: -4 },
      { until: (s) => s.v <= 0.01, lever: -3 },
      { for: 0.6, lever: -3 },
      { for: 2.4, lever: 0, doors: 1, park: true, events: [[0.8, 'doorOpen']] },
    ], { tail: 2.5, accelBoost: opts.accelBoost || 1 });
  }

  /* Some rain + a tunnel (single scenario that exercises the rest of the mixer). */
  function tunnelRain(camera) {
    return run('emu', camera, [
      { for: 0.1, lever: 1, doors: 0, park: false, rain: 1 },
      { until: (s) => s.v >= 20, lever: 5, rain: 1 },
      { for: 6, lever: 0, tunnel: true, rain: 1 },
      { for: 6, lever: 0, rain: 1 },
      { until: (s) => s.v <= 0.01, lever: -5, rain: 1 },
    ], { tail: 1.5 });
  }

  /* Every one-shot of every vehicle, one after the other (horn / bell, door chime, door open + close, announcement gong, crossing bell, emergency brake). */
  function oneshots(camera) {
    const all = [];
    const seg = (id, speed, ev, len) => { const frames = run(id, camera, [{ for: len, lever: 0, holdV: speed, doors: 0, park: false, events: ev }], { tail: 0 }); all.push({ id, frames }); };
    ['tram', 'railcar', 'emu', 'kiss', 'ic', 'hst'].forEach((id) => {
      const fast = id === 'tram' ? 14 : 0;   // the tram uses the bell below 30 km/h and the horn above
      seg(id, id === 'tram' ? 3 : 0, [[0.4, 'horn', true], [2.2, 'horn', false], [2.8, 'doorChime'], [5.6, 'doorOpen'], [8.4, 'doorClose'], [11.0, id === 'tram' ? 'gong' : 'signalBell', 3, 1]], 13.5);
      if (id === 'tram') seg(id, fast, [[0.4, 'horn', true], [1.6, 'horn', false]], 2.6);
    });
    // stitch: shift times, concatenate frames/events
    const frames = [], events = []; let off = 0, tNow = 0;
    all.forEach(({ id, frames: f }) => {
      f.frames.forEach((fr) => frames.push({ t: fr.t + off, p: fr.p }));
      f.events.forEach((e) => events.push({ ...e, t: e.t + off }));
      off += f.dur; tNow = off;
    });
    return { dur: tNow + 1, frames, events };
  }

  const NAMES = {
    oneshots: (c) => oneshots(c),
    tram_city: (c) => tramCity(c),
    railcar: (c) => railRun('railcar', 80, c, { accelBoost: 1.25 }),
    emu: (c) => railRun('emu', 120, c, { accelBoost: 2.2 }),
    kiss: (c) => railRun('kiss', 140, c, { accelBoost: 2.4 }),
    ic: (c) => railRun('ic', 160, c, { accelBoost: 2.8, curveR: 800 }),
    hst: (c) => railRun('hst', 220, c, { accelBoost: 4, curveR: 2500 }),
    tunnel_rain: (c) => tunnelRain(c),
  };
  window.TS_SCEN = { names: Object.keys(NAMES), trains: TRAINS, build: (name, camera) => NAMES[name](camera || 'cab') };
})();
